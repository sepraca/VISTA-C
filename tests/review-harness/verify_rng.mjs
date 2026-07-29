// verify_rng.mjs — gates for the random number generator itself. Run from repo root:
//   node tests/review-harness/verify_rng.mjs
//
// WHY THIS EXISTS. The RNG has been the source of two distinct, hard-to-see defects, both
// of which left MEANS unbiased while corrupting VARIANCE -- so every physics/conservation
// gate in the suite passed throughout. These gates target that blind spot directly.
//
//   2026-07-27, mulberry32 state overflow: `t += 0x6D2B79F5` was a float64 add that lost
//     integer exactness past 2^53 (after 4,917,758 draws ~ 175k photons), progressively
//     zeroing the low state bits. BDF mirror-symmetry chi^2 grew 0.99 -> 11.5 between 3M
//     and 12M photons. Fixed by masking, then superseded by the generator swap.
//   2026-07-28, mulberry32 seed-phase collisions: its state is a counter, so all seeds lie
//     on ONE cycle and "independent" sub-streams derived by arithmetic offset can overlap
//     silently. 20M-photon chunks consume 1.65e9 draws but were seeded 600M apart -> 64%
//     overlap, rho ~ 0.32, and a spurious ~2% "residual" against DISORT.
//
// Both were 32-bit-state problems. The generator is now xoshiro128** (128-bit state,
// 2^128 period) seeded by SplitMix32. Gate 4 is the regression test for the second defect
// and FAILS (0.362 vs a 1.0 expectation) if anything reintroduces a counter-based RNG.

const BASE = new URL("../../js/", import.meta.url).href;
const { RNG } = await import(`${BASE}rng.js`);

let fails = 0;
const check = (name, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) fails++; };

// ---- Gate 1: fixed reproducibility vector -------------------------------------
// These values were reproduced by an INDEPENDENT Python implementation written from the
// xoshiro128**/SplitMix32 algorithm (not ported from this file), so they pin the exact
// arithmetic. Any change here means the stream changed and every golden must be
// regenerated deliberately.
{
  RNG.reset(42);
  const out = [];
  for (let i = 0; i < 8; i++) out.push(Math.round(RNG.rand() * 4294967296));
  const EXP = [660444221, 3652823732, 77672526, 910233633,
               2297337756, 3786072677, 3123505064, 1891482476];
  const EXP_STATE = [2382219267, 1337384895, 3454353073, 311600339];
  const st = RNG.state();
  check(`seed 42 -> fixed 8-output vector (${RNG.name()})`,
        out.every((v, i) => v === EXP[i]));
  check("seed 42 -> fixed state after 8 draws",
        st.every((v, i) => v === EXP_STATE[i]));
}

// ---- Gate 2: state stays exact uint32 far into the stream ----------------------
// The 2026-07-27 failure mode. xoshiro's update is xor/shift/rotate only -- no additions
// -- so it is structurally immune, but assert it rather than trust it.
{
  RNG.reset(42);
  for (let i = 0; i < 100_000_000; i++) RNG.rand();
  const st = RNG.state();
  check(`state still exact uint32 after 100M draws [${st.join(", ")}]`,
        st.every(v => Number.isInteger(v) && v >= 0 && v <= 0xFFFFFFFF));
}

// ---- Gate 3: determinism + basic stream quality deep in the sequence ------------
{
  const W = 200000;
  function windowStats(skip) {
    RNG.reset(42);
    for (let i = 0; i < skip; i++) RNG.rand();
    const seen = new Set();
    const H = new Float64Array(64);
    for (let i = 0; i < W; i++) {
      const u = RNG.rand();
      seen.add((u * 4294967296) >>> 0);
      H[Math.min(63, Math.floor(u * 64))]++;
    }
    const e = W / 64;
    let c = 0;
    for (let i = 0; i < 64; i++) c += (H[i] - e) ** 2 / e;
    return { distinct: seen.size, uniChi2: c / 63 };
  }
  const shallow = windowStats(0);
  const deep = windowStats(50_000_000);
  check(`deep-stream uniformity chi2/dof = ${deep.uniChi2.toFixed(3)} in [0.6, 1.6]`,
        deep.uniChi2 > 0.6 && deep.uniChi2 < 1.6);
  check(`deep-stream distinct values ${deep.distinct}/${W} ~ shallow ${shallow.distinct}/${W}`,
        Math.abs(deep.distinct - shallow.distinct) < 0.001 * W);
  RNG.reset(7);
  const a = []; for (let i = 0; i < 100000; i++) a.push(RNG.rand());
  RNG.reset(7);
  let same = true;
  for (let i = 0; i < 100000; i++) if (RNG.rand() !== a[i]) { same = false; break; }
  check("determinism: same seed reproduces the stream exactly", same);
}

// ---- Gate 4: SEED INDEPENDENCE (regression test for the 2026-07-28 defect) ------
// Two transport runs with different seeds, differenced bin-by-bin. Under independent
// Poisson statistics mean (dA-dB)^2/(dA+dB) = 1. Overlapping streams push it BELOW 1
// (mulberry32 with 600M-draw offsets measured 0.362); a correlated or degenerate
// generator would show up here and nowhere else in the suite.
{
  const { Physics } = await import(`${BASE}physics.js`);
  const { BDF_MU_BINS, BDF_PHI_BINS } = await import(`${BASE}simstats.js`);
  const nT = BDF_MU_BINS, nP = BDF_PHI_BINS;
  const p = { tauCloud: 4, slabW: 500, slabD: 500, theta0: 30 * Math.PI / 180,
              g: 0.85, omega0: 1.0, surfaceAlbedo: 0, betaExt: 10,
              surfaceDistanceKm: 0.5, entryMode: "center" };
  const N = 2_000_000;
  function run(seed) {
    const w = new Float64Array(nT * nP);
    RNG.reset(seed);
    for (let i = 0; i < N; i++) {
      const r = Physics.simulatePhoton(p, false);
      if (r.status !== "reflected") continue;
      const mu = Math.abs(r.dirZ);
      let phi = Math.atan2(r.dirY, r.dirX);
      if (phi < 0) phi += 2 * Math.PI;
      const ir = Math.min(nT - 1, Math.max(0, Math.floor((1 - mu) * nT)));
      const dPhi = 2 * Math.PI / nP;
      const ip = Math.min(nP - 1, Math.floor(((phi + dPhi / 2) % (2 * Math.PI)) / dPhi));
      w[ir * nP + ip]++;
    }
    return w;
  }
  const wA = run(42), wB = run(43);
  let s = 0, n = 0;
  for (let i = 0; i < wA.length; i++) {
    const d = wA[i] - wB[i], t = wA[i] + wB[i];
    if (t > 0) { s += d * d / t; n++; }
  }
  const chi2 = s / n;
  check(`seed independence: two-seed differenced chi2 = ${chi2.toFixed(3)} in [0.80, 1.25] (=1 for independent streams)`,
        chi2 > 0.80 && chi2 < 1.25);
}

// ---- Gate 5: BDF mirror symmetry stays Poisson at high N ------------------------
// The physical consequence of a sound generator. Illumination is centered and every
// VISTA-C geometry is mirror-symmetric about the principal plane (dir.y = 0), so
// BDF(theta,phi) must equal BDF(theta,360-phi) in expectation. With the 2026-07-27 bug
// this read 5.0 at 6M photons and 11.5 at 12M; it must NOT drift upward with N.
{
  const { Physics } = await import(`${BASE}physics.js`);
  const { BDF_MU_BINS, BDF_PHI_BINS } = await import(`${BASE}simstats.js`);
  const nT = BDF_MU_BINS, nP = BDF_PHI_BINS;
  const w = new Float64Array(nT * nP);
  const p = { tauCloud: 4, slabW: 500, slabD: 500, theta0: 30 * Math.PI / 180,
              g: 0.85, omega0: 1.0, surfaceAlbedo: 0, betaExt: 10,
              surfaceDistanceKm: 0.5, entryMode: "center" };
  const N = 6_000_000;
  RNG.reset(42);
  for (let i = 0; i < N; i++) {
    const r = Physics.simulatePhoton(p, false);
    if (r.status !== "reflected") continue;
    const mu = Math.abs(r.dirZ);
    let phi = Math.atan2(r.dirY, r.dirX);
    if (phi < 0) phi += 2 * Math.PI;
    const ir = Math.min(nT - 1, Math.max(0, Math.floor((1 - mu) * nT)));
    const dPhi = 2 * Math.PI / nP;
    const ip = Math.min(nP - 1, Math.floor(((phi + dPhi / 2) % (2 * Math.PI)) / dPhi));
    w[ir * nP + ip]++;
  }
  let s = 0, n = 0;
  for (let ir = 0; ir < nT; ir++) {
    for (let ip = 1; ip < nP / 2; ip++) {
      const a = w[ir * nP + ip], b = w[ir * nP + (nP - ip) % nP];
      if (a + b > 0) { s += (a - b) * (a - b) / (a + b); n++; }
    }
  }
  const chi2 = s / n;
  check(`BDF mirror chi2 at ${N / 1e6}M photons = ${chi2.toFixed(2)} in [0.80, 1.30] (Poisson=1)`,
        chi2 > 0.80 && chi2 < 1.30);
}

// ---- Gate 6: jump() yields a distinct, valid sub-stream --------------------------
// jump() is the ONLY supported way to derive independent sub-streams (chunked
// accumulation, per-worker streams). Arithmetic seed offsets are what failed in 2026-07.
{
  RNG.reset(42);
  const before = RNG.state().join(",");
  RNG.jump();
  const after = RNG.state();
  RNG.reset(42);
  const head = []; for (let i = 0; i < 1000; i++) head.push(RNG.rand());
  RNG.reset(42); RNG.jump();
  const jumped = []; for (let i = 0; i < 1000; i++) jumped.push(RNG.rand());
  check("jump() moves to a different state, still valid uint32",
        before !== after.join(",") &&
        after.every(v => Number.isInteger(v) && v >= 0 && v <= 0xFFFFFFFF));
  check("jump() sub-stream does not overlap the head of the base stream",
        jumped.every((v, i) => v !== head[i]));
}

console.log(fails === 0 ? "\nALL RNG GATES PASS" : `\n${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
