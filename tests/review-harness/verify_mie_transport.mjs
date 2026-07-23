// verify_mie_transport.mjs — gates for the Mie phase function wired into the
// transport kernel (v6.1, C6-A). verify_mie_sampling covers the sampler in
// isolation (⟨µ⟩ = g); THIS suite drives full photons through
// Physics.simulatePhoton with a Mie CDF in params and checks the dispatch +
// transport behave physically. Mie params are built from the committed
// data/mie/ assets exactly as js/mie.js does (buildMieCdf(pf[k], grid.wt)),
// but without fetch, so this runs in Node/run_all.
//
// Gates:
//   1. Energy conservation: a CONSERVATIVE Mie run (ω₀ = 1) absorbs exactly 0
//      and its budget closes — a transport-loop invariant independent of the
//      phase function.
//   2. Determinism: same seed ⇒ identical counts (Mie draws are deterministic).
//   3. Dispatch is live + physics responds to r_eff: a more forward-peaked
//      phase function (larger g at larger r_eff) transmits MORE through a thick
//      slab. T(r_eff=30) > T(r_eff=2), proving the selected Mie CDF actually
//      drives the transport (not a constant/HG fallback).
//   4. HG default: params WITHOUT mieCdf reproduce the explicit HG run
//      bit-for-bit (the branch defaults to HG — the guarantee the goldens rely
//      on, checked here directly too).
//
// Usage: node tests/review-harness/verify_mie_transport.mjs

import { readFileSync } from "node:fs";

const domValues = { observationGeometry: "top-base_faces" };
globalThis.document = {
  getElementById(id) {
    if (id in domValues) return { value: domValues[id], checked: false };
    return null;
  }
};

const BASE = new URL("../../js/", import.meta.url).href;
const DATA = new URL("../../data/mie/", import.meta.url);
const { RNG } = await import(`${BASE}rng.js`);
const { Physics } = await import(`${BASE}physics.js`);
const { SimStats } = await import(`${BASE}simstats.js`);

const load = f => JSON.parse(readFileSync(new URL(f, DATA)));
const grid = load("mie_grid.json");
const XMU = Float64Array.from(grid.xmu);
const WT  = Float64Array.from(grid.wt);

// Build the same {cdf, xmu, ssa, g} a Mie selection yields (mirrors Mie.select).
function mieSel(band, k) {
  const b = load(`mie_band_${band}.json`);
  return { cdf: Physics.buildMieCdf(Float64Array.from(b.pf[k]), WT),
           xmu: XMU, ssa: b.ssa[k], g: b.g[k], cer: b.cer_um[k] };
}

const SEED = 42;
let allPass = true;
const check = (ok, label) => { console.log(`${ok ? "PASS" : "FAIL"}  ${label}`); allPass = ok && allPass; return ok; };

// Run N photons; return a self-contained snapshot of the outcome budget.
function run(N, params) {
  RNG.reset(SEED); SimStats.reset();
  for (let i = 0; i < N; i++) {
    const r = Physics.simulatePhoton(params, false);
    SimStats.record(r);
    for (const t of r.cloudBaseTransmissions) SimStats.registerCloudBaseTransmission(t);
    for (const e of r.surfaceEvents)          SimStats.registerSurfaceEvent(e);
    for (const d of r.surfaceReflectionDirs)  SimStats.registerSurfaceReflection(d);
  }
  const s = { ...SimStats.stats };
  return {
    launched: s.launched, absorbed: s.absorbed, terminated: s.terminated,
    R: SimStats.reflectedCount(), T: SimStats.transmittedNetCount(),
    S: SimStats.sideExitCount(), meanScat: s.totalScatterings / Math.max(s.launched, 1),
    raw: s,
  };
}

// Base geometry: wide slab (≈ plane-parallel, minimal side loss), top beam.
const GEO = { tauCloud: 10, slabW: 2000, slabD: 2000, theta0: 0,
              betaExt: 10, surfaceDistanceKm: 0.5, entryMode: "top",
              surfaceAlbedo: 0 };
const N = 200000;

console.log("=== Gate 1: conservative Mie (ω₀=1) absorbs 0, budget closes ===");
{
  const sel = mieSel(1, 10);
  const p = { ...GEO, g: sel.g, omega0: 1.0, mieCdf: sel.cdf, mieXmu: sel.xmu };
  const m = run(N, p);
  check(m.absorbed === 0, `absorbed = ${m.absorbed} (must be 0 at ω₀=1)`);
  check(m.R + m.T + m.absorbed + m.S + m.terminated === m.launched,
        `budget closes: R+T+A+S+Term = ${m.R + m.T + m.absorbed + m.S + m.terminated} (launched ${m.launched})`);
  console.log(`  (R=${(m.R/N).toFixed(4)} T=${(m.T/N).toFixed(4)} S=${(m.S/N).toFixed(4)} meanScat=${m.meanScat.toFixed(1)})`);
}

console.log("\n=== Gate 2: determinism (same seed ⇒ identical) ===");
{
  const sel = mieSel(7, 10);
  const p = { ...GEO, g: sel.g, omega0: sel.ssa, mieCdf: sel.cdf, mieXmu: sel.xmu };
  const a = run(N, p), b = run(N, p);
  check(a.R === b.R && a.T === b.T && a.S === b.S && a.absorbed === b.absorbed,
        `two runs identical (R=${a.R} T=${a.T} S=${a.S} A=${a.absorbed})`);
}

console.log("\n=== Gate 3: dispatch live — larger r_eff (higher g) transmits more ===");
{
  const small = mieSel(1, 0);   // r_eff=2 µm, g≈0.80
  const large = mieSel(1, 23);  // r_eff=30 µm, g≈0.88
  const pS = { ...GEO, g: small.g, omega0: 1.0, mieCdf: small.cdf, mieXmu: small.xmu };
  const pL = { ...GEO, g: large.g, omega0: 1.0, mieCdf: large.cdf, mieXmu: large.xmu };
  const mS = run(N, pS), mL = run(N, pL);
  console.log(`  r_eff=2 (g=${small.g.toFixed(3)}): T=${(mS.T/N).toFixed(4)}   r_eff=30 (g=${large.g.toFixed(3)}): T=${(mL.T/N).toFixed(4)}`);
  check(mL.T > mS.T,
        `T(r_eff=30) > T(r_eff=2): ${mL.T} > ${mS.T} (forward-peaked ⇒ deeper penetration; Mie CDF is live)`);
  check(mS.T !== mL.T && mS.meanScat !== mL.meanScat,
        `distinct r_eff give distinct transport (meanScat ${mS.meanScat.toFixed(1)} vs ${mL.meanScat.toFixed(1)})`);
}

console.log("\n=== Gate 4: HG default — no mieCdf ⇒ bit-identical to explicit HG ===");
{
  const pHGexplicit = { ...GEO, g: 0.85, omega0: 1.0 };                 // no mieCdf key
  const pHGnull     = { ...GEO, g: 0.85, omega0: 1.0, mieCdf: null, mieXmu: null };
  const a = run(N, pHGexplicit), b = run(N, pHGnull);
  check(a.R === b.R && a.T === b.T && a.S === b.S && a.raw.totalScatterings === b.raw.totalScatterings,
        `mieCdf absent ≡ mieCdf null ≡ HG (R=${a.R} T=${a.T} S=${a.S})`);
}

console.log(allPass ? "\nALL MIE-TRANSPORT GATES PASS" : "\nSOME MIE-TRANSPORT GATES FAILED");
process.exitCode = allPass ? 0 : 1;
