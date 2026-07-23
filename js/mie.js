// mie.js — browser-side loader + CDF cache for MODIS Mie phase functions (v6.1).
//
// Fetches the committed assets in data/mie/ on demand and hands the transport
// kernel a ready-to-sample µ-CDF. Nothing here runs per photon: assets load
// once (manifest + shared grid), each band file loads once on first use, and
// each (band, r_eff) CDF is built once (Physics.buildMieCdf) and cached.
//
//   await Mie.ensureCore();            // manifest + grid (xmu, wt) — once
//   const sel = await Mie.select(band, reffIndex);
//   // sel = { band, reffIndex, cer, ssa, g, wavelength_um, cdf, xmu }
//   // pass sel.cdf / sel.xmu into RunControl.getSimParams → simulatePhoton;
//   // show sel.ssa / sel.g read-only in the UI.
//
// The CDF is built browser-side (not shipped) so there is a single, tested
// construction of the sampling measure cumsum(wt·pf)/T — see the C4 notes on
// why the file's pf_cumul is NOT that CDF.

import { Physics } from './physics.js';

const BASE = 'data/mie/';   // relative to the served index.html (repo root)

export const Mie = {
  _core: null,              // { manifest, xmu, wt, angDeg, cer }
  _bands: new Map(),        // band(int) -> parsed band JSON
  _cdfCache: new Map(),     // `${band}:${k}` -> Float64Array

  // Load manifest + shared grid once. Idempotent.
  async ensureCore() {
    if (this._core) return this._core;
    const [manifest, grid] = await Promise.all([
      fetch(BASE + 'manifest.json').then(r => r.json()),
      fetch(BASE + 'mie_grid.json').then(r => r.json()),
    ]);
    this._core = {
      manifest,
      xmu: Float64Array.from(grid.xmu),
      wt: Float64Array.from(grid.wt),
      angDeg: Float64Array.from(grid.ang_deg),
      cer: manifest.cer_um,          // shared r_eff grid (24 values)
    };
    return this._core;
  },

  // Band list for building the UI selector (label, band, wavelength). Requires
  // ensureCore() to have completed.
  bands() {
    return this._core ? this._core.manifest.bands : [];
  },
  cerGrid() {
    return this._core ? this._core.cer : [];
  },

  // Load one band file once. Idempotent; returns the parsed object.
  async ensureBand(band) {
    if (this._bands.has(band)) return this._bands.get(band);
    const core = await this.ensureCore();
    const entry = core.manifest.bands.find(b => b.band === band);
    if (!entry) throw new Error(`Mie: no such band ${band}`);
    const obj = await fetch(BASE + entry.file).then(r => r.json());
    this._bands.set(band, obj);
    return obj;
  },

  // Build (once) and cache the sampling CDF for (band, r_eff index). Sync;
  // requires the band to be loaded (call after ensureBand / select).
  cdfFor(band, k) {
    const key = band + ':' + k;
    let cdf = this._cdfCache.get(key);
    if (!cdf) {
      const obj = this._bands.get(band);
      cdf = Physics.buildMieCdf(Float64Array.from(obj.pf[k]), this._core.wt);
      this._cdfCache.set(key, cdf);
    }
    return cdf;
  },

  // Everything the kernel + UI need for one (band, r_eff) selection.
  async select(band, k) {
    const obj = await this.ensureBand(band);
    return {
      band,
      reffIndex: k,
      cer: obj.cer_um[k],
      ssa: obj.ssa[k],
      g: obj.g[k],
      wavelength_um: obj.wavelength_um,
      cdf: this.cdfFor(band, k),
      xmu: this._core.xmu,
      pf: obj.pf[k],          // for the in-app phase-function plot (C6-D)
      angDeg: this._core.angDeg,
    };
  },
};
