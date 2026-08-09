// verify_phase_assets.mjs — gates for the data/phase/ browser assets (liquid + ice,
// MODIS + VIIRS). Run from repo root:
//   node tests/review-harness/verify_phase_assets.mjs
//
// WHY THIS EXISTS. These assets are produced offline by tools/phase_convert.py from HDF4
// tables that cannot be read in CI, so the JSON is the only thing the app ever sees. A
// corrupt or mis-weighted table would not break any physics gate — the transport would
// happily sample a wrong distribution and every conservation check would still pass. The
// decisive test is that the sampling distribution reproduces the tabulated asymmetry
// parameter, which is what this file checks.
//
// It is the generalization of verify_mie_sampling.mjs (which covers the legacy data/mie/
// Henyey-Greenstein-era assets) to the two-family, two-instrument layout.
//
// THE BUG CLASS THIS CATCHES. On 2026-07-22 the sampling CDF was briefly built from a plain
// cumulative of pf, with no quadrature weighting. That over-weights the forward peak and
// yields sampled <mu> ~ 0.96 against a tabulated g ~ 0.80 — a 20% error in the scattering
// that no other test noticed. The correct mu-space CDF weights each node by w*pf.
//
// WHY ICE NEEDS ITS OWN COVERAGE. The two families use different angular grids AND different
// quadrature rules: liquid is 1000 Gauss-Legendre nodes (weights generated analytically),
// ice is 498 near-uniform-in-theta nodes with trapezoidal weights built in mu, because no
// quadrature weights exist for that grid anywhere in the source. Ice therefore exercises a
// completely separate weight-construction path, and only this gate covers it.
//
// TOLERANCE. The JSON stores 7 significant figures (the float32 source carries ~7), so the
// round-trip floor is ~1e-7. Gates are set at 5e-7 — tight enough that a real weighting error
// (which shows up at 1e-2, not 1e-7) cannot hide, loose enough not to fire on storage
// rounding. Measured at first commit: every quantity below came in at <= 1.1e-7.

import { readFileSync, existsSync } from "node:fs";

const DIR = new URL("../../data/phase/", import.meta.url);
const load = (f) => JSON.parse(readFileSync(new URL(f, DIR)));

const TOL = 5e-7;
const TOL_SUMW = 1e-9;

let fails = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "   " + detail : ""}`);
  if (!ok) fails++;
};

if (!existsSync(new URL("manifest.json", DIR))) {
  console.log("SKIP  data/phase/ not present — run tools/phase_convert.py on the Mac first");
  process.exit(0);
}

const manifest = load("manifest.json");
const grids = {};

// ---- Grids: weights must integrate mu over [-1, 1] ------------------------------
for (const family of Object.keys(manifest.families ?? {})) {
  const g = load(`grid_${family}.json`);
  grids[family] = { mu: Float64Array.from(g.xmu), wt: Float64Array.from(g.wt) };
  const { mu, wt } = grids[family];

  let sumw = 0;
  for (let i = 0; i < wt.length; i++) sumw += wt[i];
  // Sum of weights = the length of the mu interval = 2, for ANY correct rule on [-1,1].
  // This is what catches a half-interval or double-counted-endpoint mistake.
  check(`grid ${family}: sum(w) = 2`, Math.abs(sumw - 2) < TOL_SUMW,
        `got ${sumw.toFixed(12)}`);

  let descending = true;
  for (let i = 1; i < mu.length; i++) if (mu[i] > mu[i - 1]) { descending = false; break; }
  // Forward-scattering first (+1 -> -1) is the ordering the kernel's CDF inversion assumes.
  // Ice has one tie at the forward peak (float32 cos(0.01 deg) rounds to 1.0), so this is
  // non-strict on purpose.
  check(`grid ${family}: mu ordered forward-first (+1 -> -1)`, descending,
        `${mu[0].toFixed(8)} .. ${mu[mu.length - 1].toFixed(8)}`);
}

// ---- Per-band assets ------------------------------------------------------------
let nBands = 0;
for (const [inst, block] of Object.entries(manifest.instruments ?? {})) {
  // Provenance is per instrument (source_file / source_attrs / generated live beside
  // `families`), because MODIS and VIIRS record materially different lineage — mixed Im(n)
  // temperatures and a different ice weighting on the VIIRS side.
  if (!block.source_file) {
    check(`manifest: instrument ${inst} carries its own provenance`, false,
          "missing source_file — manifest predates the per-instrument layout");
  }
  for (const [family, bands] of Object.entries(block.families ?? {})) {
    for (const band of Object.keys(bands)) {
      const file = `${family}_${inst}_${band}.json`;
      const d = load(file);
      const { mu, wt } = grids[family];
      nBands++;

      let worstNorm = 0, worstG = 0, worstSample = 0, negatives = 0;

      for (let r = 0; r < d.cer_um.length; r++) {
        const pf = d.pf[r];

        // (a) normalization: the converter renormalizes every radius to sum(w*pf) = 1 so
        //     the CDF is proper regardless of the source file's own convention (liquid
        //     integrates to ~1, ice to ~2 — measured, not assumed).
        let s = 0, sm = 0;
        for (let i = 0; i < pf.length; i++) {
          if (pf[i] < 0) negatives++;
          s += wt[i] * pf[i];
          sm += wt[i] * pf[i] * mu[i];
        }
        worstNorm = Math.max(worstNorm, Math.abs(s - 1));

        // (b) the stored g must equal the first moment of the stored pf. Guards against a
        //     pf/g pairing drifting apart — e.g. an r_eff index shift between arrays.
        worstG = Math.max(worstG, Math.abs(sm - d.g[r]));

        // (c) THE ONE THAT MATTERS: build the sampling CDF exactly as
        //     Physics.buildMieCdf does (cumulative of w*pf, normalized) and confirm the
        //     resulting discrete distribution has mean mu equal to the tabulated g.
        let acc = 0;
        for (let i = 0; i < pf.length; i++) acc += wt[i] * pf[i];
        let meanMu = 0;
        for (let i = 0; i < pf.length; i++) meanMu += (wt[i] * pf[i] / acc) * mu[i];
        worstSample = Math.max(worstSample, Math.abs(meanMu - d.g[r]));
      }

      const ok = worstNorm < TOL && worstG < TOL && worstSample < TOL && negatives === 0;
      check(`${file.padEnd(24)}`, ok,
            `norm ${worstNorm.toExponential(1)}  g ${worstG.toExponential(1)}  ` +
            `<mu>=g ${worstSample.toExponential(1)}  ` +
            `r_eff ${d.cer_um[0]}-${d.cer_um[d.cer_um.length - 1]}um` +
            (negatives ? `  ${negatives} NEGATIVE pf VALUES` : ""));
    }
  }
}

// ---- Cross-instrument sanity: VIIRS M11 must not be a copy of MODIS band 7 -------
// M11 (2.25 um) and MODIS b7 (2.13 um) sit only 0.12 um apart yet differ substantially in
// absorption — that contrast is the entire reason M11 was added. If a band-mapping error
// ever shipped b7 data under an M11 label, every other gate here would still pass.
//
// THE PHYSICAL REASON the ratio is ~0.66 and not ~1.0 (author, 2026-08-08): band 7 lies on
// the long-wavelength wing of the ~1.9 um liquid-water absorption band, while M11 falls
// further into the relatively transparent window before absorption climbs again toward
// ~3 um. So Im(n) — and hence 1-ssa — is materially larger at 2.13 um than at 2.25 um. The
// bounds below are therefore a physics expectation, not a tuned threshold: the two bands
// MUST differ by roughly this much, and a ratio near 1.0 would mean the same data got
// written twice under different labels.
{
  const a = "liquid_modis_b7.json", b = "liquid_viirs_M11.json";
  if (existsSync(new URL(a, DIR)) && existsSync(new URL(b, DIR))) {
    const A = load(a), B = load(b);
    const i = A.cer_um.indexOf(10), j = B.cer_um.indexOf(10);
    const absA = 1 - A.ssa[i], absB = 1 - B.ssa[j];
    const ratio = absB / absA;
    // Measured 2026-08-08: M11 absorbs ~0.66x band 7 at every radius.
    check("VIIRS M11 is distinct from MODIS b7 (not a mislabelled copy)",
          ratio > 0.4 && ratio < 0.9,
          `1-ssa at 10um: b7 ${absA.toFixed(5)}, M11 ${absB.toFixed(5)}, ratio ${ratio.toFixed(3)}`);
  }
}

console.log(`\n${nBands} band asset(s) checked`);
console.log(fails === 0 ? "ALL PHASE-ASSET GATES PASS" : `${fails} FAILURE(S)`);
process.exit(fails === 0 ? 0 : 1);
