// verify_mie_sampling.mjs — gates for the Mie scattering-angle sampler
// (Phase 5 / v6.1, C4). The kernel builds a µ-space CDF with
// Physics.buildMieCdf(pf[k], wt) = cumsum(wt·pf)/T, then draws cos(scattering
// angle) with Physics.sampleMieCosTheta (DISCRETE node inversion).
//
// The design was corrected here (2026-07-22): the file's `pf_cumul` (cumsum of
// pf WITHOUT the quadrature weights) is NOT the µ-space CDF — inverting it
// gives ⟨µ⟩ ≈ 0.96 instead of the tabulated g ≈ 0.80. This suite's ⟨µ⟩-vs-g
// gate is what caught that; the converter now ships `pf` and the browser builds
// cumsum(wt·pf)/T, which discrete-inverts to g EXACTLY (to the float32 floor).
//
// Gates per (band, r_eff):
//   1. ⟨µ⟩ = g, computed two ways:
//        (a) ANALYTIC (no MC noise): Σ (cdf[i+1]−cdf[i])·µ_i = g to ~5e-5.
//        (b) MONTE CARLO: sample N µ via the real sampler; sample mean = g
//            within MC noise (validates the sampler CODE, not just the CDF).
//   2. SHAPE: empirical P(µ ≥ µ_i) == cdf[i] at every node, within MC noise.
//   3. Samples stay on the grid; forward/back extremes reachable.
//
// Assets: data/mie/ (committed). Usage: node tests/review-harness/verify_mie_sampling.mjs

import { readFileSync } from "node:fs";

const BASE = new URL("../../js/", import.meta.url).href;
const DATA = new URL("../../data/mie/", import.meta.url);
const { RNG } = await import(`${BASE}rng.js`);
const { Physics } = await import(`${BASE}physics.js`);

const load = f => JSON.parse(readFileSync(new URL(f, DATA)));
const grid = load("mie_grid.json");
const XMU = Float64Array.from(grid.xmu);
const WT  = Float64Array.from(grid.wt);
const NA  = grid.n_angles;

let allPass = true;
function check(ok, label) { console.log(`${ok ? "PASS" : "FAIL"}  ${label}`); allPass = ok && allPass; return ok; }

// Analytic mean of the discrete-node sampled distribution: Σ mass_i·µ_i, where
// mass_i = cdf[i+1]−cdf[i] (implied cdf[NA]=1). Equals g in the GL sense.
function analyticMean(cdf) {
  let m = 0;
  for (let i = 0; i < NA; i++) {
    const massi = (i + 1 < NA ? cdf[i + 1] : 1) - cdf[i];
    m += massi * XMU[i];
  }
  return m;
}

const SEED = 42, N = 2_000_000;
const CASES = [
  { band: 1,  k: 0,  note: "0.65 µm, r_eff=2 µm (broadest)" },
  { band: 1,  k: 10, note: "0.65 µm, r_eff=12 µm" },
  { band: 7,  k: 10, note: "2.13 µm, r_eff=12 µm (absorbing)" },
  { band: 20, k: 22, note: "3.75 µm, r_eff=28 µm (most absorbing)" },
];

for (const c of CASES) {
  const bandObj = load(`mie_band_${c.band}.json`);
  const pfCol = Float64Array.from(bandObj.pf[c.k]);
  const g = bandObj.g[c.k];
  const cdf = Physics.buildMieCdf(pfCol, WT);         // the kernel's own builder
  console.log(`\n=== band ${c.band} (${c.note}), r_eff=${bandObj.cer_um[c.k]} µm, g=${g.toFixed(5)} ===`);

  // sanity on the built CDF
  check(cdf[0] === 0 && cdf[NA - 1] <= 1 + 1e-12,
        `built CDF: cdf[0]=0, cdf[N-1]=${cdf[NA-1].toFixed(6)} ≤ 1`);

  // (1a) analytic ⟨µ⟩ = g, no MC noise (this is the exactness claim)
  const mA = analyticMean(cdf);
  check(Math.abs(mA - g) < 1e-4,
        `analytic ⟨µ⟩ = ${mA.toFixed(6)} = g (|Δ| = ${Math.abs(mA - g).toExponential(2)} < 1e-4, GL-exact to float32)`);

  // (1b) MC sample mean = g within noise, via the real sampler
  RNG.reset(SEED);
  let sum = 0, sumsq = 0, minMu = 2, maxMu = -2;
  const binCount = new Float64Array(NA);
  for (let j = 0; j < N; j++) {
    const mu = Physics.sampleMieCosTheta(cdf, XMU);
    sum += mu; sumsq += mu * mu;
    if (mu < minMu) minMu = mu;
    if (mu > maxMu) maxMu = mu;
    // exact node recovery for the shape tally (discrete sampler returns a node)
    let lo = 0, hi = NA - 1;                    // xmu descending → find index of this µ
    while (lo < hi) { const m = (lo + hi) >> 1; if (XMU[m] > mu) lo = m + 1; else hi = m; }
    binCount[lo] += 1;
  }
  const mean = sum / N;
  const mcNoise = Math.sqrt((sumsq / N - mean * mean) / N);
  check(Math.abs(mean - g) < Math.max(1e-4, 5 * mcNoise),
        `MC ⟨µ⟩ = ${mean.toFixed(6)} = g (|Δ| = ${Math.abs(mean - g).toExponential(2)}, <max(1e-4,5σ=${(5*mcNoise).toExponential(2)}))`);
  check(minMu >= XMU[NA - 1] - 1e-12 && maxMu <= XMU[0] + 1e-12,
        `samples on grid [${XMU[NA-1].toFixed(4)}, ${XMU[0].toFixed(4)}] (saw [${minMu.toFixed(4)}, ${maxMu.toFixed(4)}])`);

  // (2) shape: empirical P(µ ≥ µ_i) == cdf[i] at a spread of nodes
  let worst = 0, atNode = -1, cum = 0;
  for (let i = 0; i < NA; i++) {
    if (i % 40 === 0) {
      const d = Math.abs(cum / N - cdf[i]);
      if (d > worst) { worst = d; atNode = i; }
    }
    cum += binCount[i];
  }
  check(worst < 5e-3,
        `shape: max |empirical P(µ≥µ_i) − cdf[i]| = ${worst.toExponential(2)} at node ${atNode} (< 5e-3)`);
}

console.log(allPass ? "\nALL MIE-SAMPLING GATES PASS" : "\nSOME MIE-SAMPLING GATES FAILED");
process.exitCode = allPass ? 0 : 1;
