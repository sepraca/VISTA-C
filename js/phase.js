// phase.js — browser-side loader + CDF cache for tabulated cloud phase functions (v6.2).
//
// Supersedes js/mie.js. That module handled one family (liquid droplets), one instrument
// (MODIS) and ONE shared angular grid; this one handles two families with genuinely
// different grids and quadrature rules, two instruments, and per-family r_eff grids.
//
//   await Phase.ensureCore();                          // manifest + both grids — once
//   const sel = await Phase.select("liquid", "modis", "b6", reffIndex);
//   // sel = { family, instrument, band, reffIndex, cer, ssa, g, qext,
//   //         wavelength_um, cdf, xmu, pf, angDeg }
//
// WHY "Mie" IS NO LONGER THE NAME. Mie theory describes scattering by SPHERES, so it is the
// right word for liquid droplets and simply wrong for the ice tables, which come from the
// Yang et al. (2013) non-spherical (severely roughened aggregate columns) computations. The
// module, the export schema (1.7) and the UI all say liquid / ice now.
//
// ---------------------------------------------------------------------------------------
// THE TWO FAMILIES ARE NOT INTERCHANGEABLE — this is the whole reason for the rewrite
// ---------------------------------------------------------------------------------------
//                        liquid                          ice
//   angular grid         1000 Gauss-Legendre nodes       498 near-uniform-in-theta nodes
//   theta range          0.137 .. 179.863 deg            0.00 .. 180.00 deg EXACTLY
//   quadrature weights   Gauss-Legendre                  trapezoidal in mu
//   r_eff grid           18 values, 2-30 um              12 values, 5-60 um
//   source integral      ~1                              ~2
//
// Every one of those differs, so a single shared grid/weight/r_eff assumption — which is
// what mie.js was built on — cannot work. The weights live in the per-family grid file and
// are passed explicitly into Physics.buildMieCdf, which already took them as an argument.
//
// The normalization difference is NOT handled here: tools/phase_convert.py renormalizes
// every radius to sum(w*pf) = 1 at conversion time, so by the time the browser sees `pf`
// both families share VISTA-C's convention. tests/review-harness/verify_phase_assets.mjs
// gates that (measured: |sum(w*pf) - 1| <= 8.8e-8, the 7-significant-figure storage floor).
//
// SAMPLING CDF IS STILL BUILT HERE, NOT SHIPPED. The correct mu-space measure is
// cumsum(w*pf)/T. A cumulative of `pf` alone over-weights the forward peak and yields
// sampled <mu> ~ 0.96 against a tabulated g ~ 0.80 (measured 2026-07-22). Building it in one
// place, from the same weights the gate checks, keeps that single tested construction.

import { Physics } from './physics.js';

const BASE = 'data/phase/';   // relative to the served index.html (repo root)

export const Phase = {
  _core: null,               // { manifest, grids: {liquid:{...}, ice:{...}} }
  _bands: new Map(),         // "family/instrument/band" -> parsed band JSON
  _cdfCache: new Map(),      // "family/instrument/band:k" -> Float64Array

  key(family, instrument, band) { return `${family}/${instrument}/${band}`; },

  // Load the manifest and BOTH grid files once. Idempotent.
  async ensureCore() {
    if (this._core) return this._core;
    const manifest = await fetch(BASE + 'manifest.json').then(r => r.json());
    const grids = {};
    await Promise.all(Object.entries(manifest.families).map(async ([family, f]) => {
      const g = await fetch(BASE + f.grid_file).then(r => r.json());
      grids[family] = {
        xmu: Float64Array.from(g.xmu),
        wt: Float64Array.from(g.wt),
        angDeg: Float64Array.from(g.ang_deg),
        cer: f.cer_um,                 // PER-FAMILY r_eff grid, not shared
      };
    }));
    this._core = { manifest, grids };
    return this._core;
  },

  // ---- UI helpers (all require ensureCore) ----------------------------------
  instruments() {
    return this._core ? Object.keys(this._core.manifest.instruments) : [];
  },
  families() {
    return this._core ? Object.keys(this._core.manifest.families) : [];
  },
  // Bands offered for one (family, instrument), as [{band, wavelength_um, nominal_um}].
  bands(family, instrument) {
    const inst = this._core?.manifest.instruments?.[instrument];
    const b = inst?.families?.[family];
    if (!b) return [];
    return Object.entries(b).map(([band, meta]) => ({ band, ...meta }));
  },
  // Every (instrument, band) pair for a family, flattened for a single dropdown.
  bandChoices(family) {
    const out = [];
    for (const instrument of this.instruments()) {
      for (const b of this.bands(family, instrument)) {
        out.push({ instrument, ...b });
      }
    }
    // Order by wavelength so the menu reads as a spectrum. VIIRS M11 (2.25 µm) therefore
    // lands between MODIS b7 (2.13) and b20 (3.75), which is where it belongs physically.
    out.sort((p, q) => p.wavelength_um - q.wavelength_um);
    return out;
  },
  // r_eff grid for a family. Liquid and ice differ (2-30 µm vs 5-60 µm) because ice
  // crystals are physically larger — there is no shared grid to fall back on.
  cerGrid(family) {
    return this._core?.grids?.[family]?.cer ?? [];
  },
  grid(family) {
    return this._core?.grids?.[family] ?? null;
  },

  // ---- Assets ---------------------------------------------------------------
  async ensureBand(family, instrument, band) {
    const k = this.key(family, instrument, band);
    if (this._bands.has(k)) return this._bands.get(k);
    await this.ensureCore();
    const file = `${family}_${instrument}_${band}.json`;
    const obj = await fetch(BASE + file).then(r => {
      if (!r.ok) throw new Error(`Phase: cannot load ${file} (${r.status})`);
      return r.json();
    });
    this._bands.set(k, obj);
    return obj;
  },

  // Build (once) and cache the sampling CDF. Uses THIS FAMILY'S weights — passing the
  // liquid weights to an ice table (or vice versa) would silently produce a wrong
  // distribution that no conservation check would catch.
  cdfFor(family, instrument, band, k) {
    const bk = this.key(family, instrument, band);
    const ck = bk + ':' + k;
    let cdf = this._cdfCache.get(ck);
    if (!cdf) {
      const obj = this._bands.get(bk);
      cdf = Physics.buildMieCdf(Float64Array.from(obj.pf[k]), this._core.grids[family].wt);
      this._cdfCache.set(ck, cdf);
    }
    return cdf;
  },

  async select(family, instrument, band, k) {
    const obj = await this.ensureBand(family, instrument, band);
    const grid = this._core.grids[family];
    if (k < 0 || k >= obj.cer_um.length) {
      throw new Error(`Phase: r_eff index ${k} out of range for ${family} `
                    + `(${obj.cer_um.length} radii: ${obj.cer_um[0]}-`
                    + `${obj.cer_um[obj.cer_um.length - 1]} um)`);
    }
    return {
      family, instrument, band,
      reffIndex: k,
      cer: obj.cer_um[k],
      ssa: obj.ssa[k],
      g: obj.g[k],
      qext: obj.qext?.[k],
      wavelength_um: obj.wavelength_um,
      cdf: this.cdfFor(family, instrument, band, k),
      xmu: grid.xmu,
      pf: obj.pf[k],            // for the in-app phase-function plot
      angDeg: grid.angDeg,
    };
  },

  // Human-readable label for panels, PNG headers and the export. "Mie" appears only as a
  // parenthetical on the liquid side, where it is actually the right word.
  label(sel) {
    if (!sel) return "Henyey-Greenstein";
    const inst = sel.instrument === "viirs" ? "VIIRS" : "MODIS";
    const band = sel.band.startsWith("b") ? `band ${sel.band.slice(1)}` : sel.band;
    const kind = sel.family === "ice" ? "ice particle" : "liquid droplet";
    return `${inst} ${band} ${kind}, r_eff=${sel.cer} µm`;
  },
};
