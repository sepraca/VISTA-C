// verify_phase3.mjs — ad hoc gate suite for the Phase 3 periodic domain
// boundary, run directly against js/physics.js + js/simstats.js (no browser).
// Checks the gates listed in TODO-direct-surface-illumination.md's Phase 3
// section and CODE-REVIEW-v6.0-handoff.md's P2/P4:
//   1. Budget closes under periodic (R+T+A+S+Term = launched, both obs
//      geometries; R_domain+T_domain+A_cloud = launched).
//   2. S(all_faces) == surfaceBypassUp exactly.
//   3. Terminal sideEscapeDown count === 0 under periodic (that population
//      must migrate into T -- every downward photon now reaches the surface
//      or a neighbor image).
//   4. wrapCapped === 0 at these (non-extreme) parameters.
//   5. Periodic and open converge at large M.
//   6. At M slightly below M_min(theta0), periodic shows MORE sunward-wall
//      entries (launchedCloudWall) than open -- the third-wrap-site
//      signature (CODE-REVIEW P2).
//   7. S(periodic) <= S(open) at matched settings (top-base_faces).
//
// Usage (from repo root): node tests/review-harness/verify_phase3.mjs
//
// Every derived quantity that depends on SimStats' LIVE accumulators
// (sideExitCount(), domainReflectedCount(), etc. -- these read current
// state, not a snapshot) is captured immediately after its own run(),
// before any other run() overwrites SimStats via reset(). Also snapshot
// {...SimStats.stats} rather than returning the live object by reference --
// a second run() would otherwise silently mutate the first result out from
// under it.

const domValues = { observationGeometry: "top-base_faces" };
globalThis.document = {
  getElementById(id) {
    if (id in domValues) return { value: domValues[id], checked: false };
    return null;
  }
};

const BASE = new URL("../../js/", import.meta.url).href;
const { RNG } = await import(`${BASE}rng.js`);
const { Physics } = await import(`${BASE}physics.js`);
const { SimStats } = await import(`${BASE}simstats.js`);

const SEED = 42;

// Runs N photons and returns a self-contained snapshot: the raw stats
// (cloned) plus every combiner-derived quantity needed below, all read
// while this run's accumulators are still the live ones.
function runFull(N, params) {
  RNG.reset(SEED);
  SimStats.reset();
  for (let i = 0; i < N; i++) {
    const r = Physics.simulatePhoton(params, false);
    SimStats.record(r);
    for (const t of r.cloudBaseTransmissions) SimStats.registerCloudBaseTransmission(t);
    for (const e of r.surfaceEvents)          SimStats.registerSurfaceEvent(e);
    for (const d of r.surfaceReflectionDirs)  SimStats.registerSurfaceReflection(d);
  }
  const s = { ...SimStats.stats };
  const launched = Math.max(s.launched, 1);

  domValues.observationGeometry = "top-base_faces";
  const R_topbase = SimStats.reflectedCount(), T_topbase = SimStats.transmittedNetCount(), S_topbase = SimStats.sideExitCount();

  domValues.observationGeometry = "all_faces";
  const R_all = SimStats.reflectedCount(), T_all = SimStats.transmittedNetCount(), S_all = SimStats.sideExitCount();

  const Rd = SimStats.domainReflectedCount(), Td = SimStats.domainTransmittedNetCount(), Ad = SimStats.domainAbsorbedCount();

  return { s, launched, R_topbase, T_topbase, S_topbase, R_all, T_all, S_all, Rd, Td, Ad };
}

let allPass = true;
function check(ok, label) { console.log(`${ok ? "PASS" : "FAIL"}  ${label}`); allPass = ok && allPass; return ok; }

// --- Gates 1-4, 7: M=2, theta0=60, As=0.5, N=300k ---
const FIXED = { tauCloud: 10, slabW: 40, slabD: 40, g: 0.85, omega0: 1.0,
                betaExt: 10.0, surfaceDistanceKm: 0.5, entryMode: "uniform_domain",
                theta0: 60 * Math.PI / 180, surfaceAlbedo: 0.5, domainFactor: 2 };
const N1 = 300000;

const P = runFull(N1, { ...FIXED, domainBoundary: "periodic" });
const O = runFull(N1, { ...FIXED, domainBoundary: "open" });

console.log("=== Gate 1: budget closure (periodic, M=2, th0=60, As=0.5) ===");
check(P.R_topbase + P.T_topbase + P.s.absorbed + P.S_topbase + P.s.terminated === P.launched,
      `top-base_faces: R+T+A+S+Term = ${P.R_topbase + P.T_topbase + P.s.absorbed + P.S_topbase + P.s.terminated} (launched=${P.launched})`);
check(P.R_all + P.T_all + P.s.absorbed + P.S_all + P.s.terminated === P.launched,
      `all_faces: R+T+A+S+Term = ${P.R_all + P.T_all + P.s.absorbed + P.S_all + P.s.terminated} (launched=${P.launched})`);
check(P.Rd + P.Td + P.Ad === P.launched,
      `R_domain+T_domain+A_cloud = ${P.Rd + P.Td + P.Ad} (launched=${P.launched})`);

console.log("\n=== Gate 2: S(all_faces) === surfaceBypassUp (periodic) ===");
check(P.S_all === P.s.surfaceBypassUp, `S(all_faces)=${P.S_all}  surfaceBypassUp=${P.s.surfaceBypassUp}`);

console.log("\n=== Gate 3: terminal sideEscapeDown === 0 under periodic ===");
check(P.s.sideEscapeDown === 0, `sideEscapeDown=${P.s.sideEscapeDown}`);

console.log("\n=== Gate 4: wrapCapped === 0 (non-extreme params) ===");
check(P.s.wrapCapped === 0, `wrapCapped=${P.s.wrapCapped}`);

console.log("\n=== Gate 7: S(periodic) <= S(open) at matched settings (top-base_faces) ===");
check(P.S_topbase <= O.S_topbase, `S(periodic)=${P.S_topbase}  S(open)=${O.S_topbase}`);

// --- Gate 5: periodic and open converge at large M ---
console.log("\n=== Gate 5: periodic/open convergence at large M (th0=60, As=0.5) ===");
{
  const N2 = 200000;
  for (const M of [2, 8, 32]) {
    const p = runFull(N2, { ...FIXED, domainFactor: M, domainBoundary: "periodic" });
    const o = runFull(N2, { ...FIXED, domainFactor: M, domainBoundary: "open" });
    const RdP = p.Rd / p.launched, TdP = p.Td / p.launched;
    const RdO = o.Rd / o.launched, TdO = o.Td / o.launched;
    const diffR = Math.abs(RdP - RdO), diffT = Math.abs(TdP - TdO);
    console.log(`  M=${M}: R_domain periodic=${RdP.toFixed(4)} open=${RdO.toFixed(4)} |diff|=${diffR.toFixed(4)}   T_domain periodic=${TdP.toFixed(4)} open=${TdO.toFixed(4)} |diff|=${diffT.toFixed(4)}`);
  }
  console.log("  (expect |diff| shrinking toward 0 as M grows -- reservoir becomes a vanishing fraction of the domain either way)");
}

// --- Gate 6: below M_min, periodic shows more sunward-wall entries ---
console.log("\n=== Gate 6: below M_min(th0), periodic launchedCloudWall > open (third wrap site) ===");
{
  const th0 = 60, tauCloud = 10, slabW = 40;
  const Mmin = 1 + 2 * (tauCloud / slabW) * Math.tan(th0 * Math.PI / 180);
  const Mtest = Math.max(1.01, Mmin - 0.3);
  console.log(`  M_min(60deg) = ${Mmin.toFixed(3)}, testing at M=${Mtest.toFixed(3)}`);
  const N3 = 300000;
  const p = runFull(N3, { ...FIXED, domainFactor: Mtest, domainBoundary: "periodic" });
  const o = runFull(N3, { ...FIXED, domainFactor: Mtest, domainBoundary: "open" });
  check(p.s.launchedCloudWall > o.s.launchedCloudWall,
        `launchedCloudWall periodic=${p.s.launchedCloudWall}  open=${o.s.launchedCloudWall}`);
  console.log(`  (sanity: launchedCloudTop periodic=${p.s.launchedCloudTop} open=${o.s.launchedCloudTop}, launchedClear periodic=${p.s.launchedClear} open=${o.s.launchedClear})`);
}

// --- Gates 8-9 (2026-07-19, review N1): the M = 1 periodic plane-parallel
// anchor. M = 1 periodic tiles the cloud flush against itself -- TRUE
// plane-parallel radiative transfer, the single cleanest validation limit
// the periodic feature has. Before the N1 fix (rayBoxEntry minT: a wrapped
// point landing exactly ON the cloud wall at M = 1 was rejected as an entry,
// letting photons tunnel through the box interior as clear air), this
// configuration produced 10.3% terminal side escapes (geometrically
// impossible) and R_domain 0.028 BELOW the finite-extent proxy it must
// exceed. Post-fix calibration (2026-07-19, seed 42, N=300k, th0=0, As=0):
// M=1 periodic R_domain = 0.4231 vs open-top W=2000 proxy 0.4232.
console.log("\n=== Gate 8: M=1 periodic -- terminal side escapes impossible (N1) ===");
{
  const N4 = 300000;
  const ppParams = { tauCloud: 10, slabW: 40, slabD: 40, g: 0.85, omega0: 1.0,
                     betaExt: 10.0, surfaceDistanceKm: 0.5, entryMode: "uniform_domain",
                     theta0: 0, surfaceAlbedo: 0, domainFactor: 1, domainBoundary: "periodic" };
  const pp = runFull(N4, ppParams);
  check(pp.s.side === 0, `M=1 periodic: stats.side=${pp.s.side} (must be exactly 0 -- every side exit wraps onto the flush neighbor image)`);
  check(pp.s.wrapCapped === 0, `M=1 periodic: wrapCapped=${pp.s.wrapCapped}`);

  console.log("\n=== Gate 9: M=1 periodic === plane-parallel limit (N1) ===");
  // Proxy for W -> infinity: open "top" at W=2000 (residual side leakage
  // ~0.7% at these params biases its R_domain LOW by <~0.005). MC sigma_R at
  // N=300k is ~0.0009 per run. Tolerance 0.01 comfortably covers both while
  // remaining ~30x tighter than the pre-fix error (0.031 vs W=2000).
  const pw = runFull(N4, { ...ppParams, entryMode: "top", slabW: 2000, slabD: 2000 });
  const Rpp = pp.Rd / pp.launched, Rw = pw.Rd / pw.launched;
  check(Math.abs(Rpp - Rw) < 0.01,
        `R_domain: M=1 periodic=${Rpp.toFixed(4)}  open-top W=2000=${Rw.toFixed(4)}  |diff|=${Math.abs(Rpp - Rw).toFixed(4)} (< 0.01)`);
  // Directional check against the FINITE proxy: periodic recovers the side
  // leakage that W=500 still loses, so it must sit strictly above.
  const p500 = runFull(N4, { ...ppParams, entryMode: "top", slabW: 500, slabD: 500 });
  const R500 = p500.Rd / p500.launched;
  check(Rpp > R500, `R_domain: M=1 periodic=${Rpp.toFixed(4)} > open-top W=500=${R500.toFixed(4)} (recovers finite-extent leakage)`);
  // (A DISORT plane-parallel anchor would be even stronger -- the tabulated
  // cases in tests/DISORT comparisons/ are at different th0/As combinations,
  // so this suite keeps the self-contained MC-vs-MC limit instead; see the
  // 2026-07-19 review notes.)
}

console.log(allPass ? "\nALL PHASE-3 GATES PASS" : "\nSOME PHASE-3 GATES FAILED");
process.exitCode = allPass ? 0 : 1;
