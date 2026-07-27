// verify_rng.mjs — gates for the Mulberry32 generator itself. Run from repo root:
//   node tests/review-harness/verify_rng.mjs
//
// WHY THIS EXISTS (2026-07-27). js/rng.js advanced its state with a bare
// `t += 0x6D2B79F5`. JavaScript has no integer type, so `t` was a float64 that grew
// without bound instead of wrapping mod 2^32. Past 2^53 -- after 4,917,758 draws,
// i.e. ~175k photons -- the addition rounds, the low bits of the state are forced to
// zero, and because the mixing step reads `t mod 2^32` the effective state space
// collapses from 2^32 to 2^(32-k). Means stayed unbiased, but Monte Carlo VARIANCE
// inflated with run length: the BDF mirror-symmetry reduced-chi^2 went 0.99 -> 11.5
// between 3M and 12M photons. Nothing in the suite caught it, because every existing
// gate checks means/conservation, and the goldens are only 500k photons.
//
// Gate 1 is the one that would have caught it: it compares the SHIPPED generator
// against a reference implementation that masks correctly, far beyond the 4.9M-draw
// divergence point. Gate 3 is the end-to-end consequence.

const BASE = new URL("../../js/", import.meta.url).href;
const { RNG } = await import(`${BASE}rng.js`);

let fails = 0;
const check = (name, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) fails++; };

// Reference Mulberry32 with the state correctly held in uint32.
function reference(seed) {
  let t = seed >>> 0;
  return function () {
    t = (t + 0x6D2B79F5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- Gate 1: shipped RNG === correctly-masked reference, well past 2^53/C ----
// The unmasked bug diverges at draw 4,917,758 = floor(2^53 / 0x6D2B79F5), so 20M
// draws clears it by 4x. Checked for several seeds.
{
  const DRAWS = 20_000_000;
  let firstDiff = -1, seedOfDiff = null;
  for (const seed of [42, 7, 1, 4294967295]) {
    RNG.reset(seed);
    const ref = reference(seed);
    for (let i = 0; i < DRAWS; i++) {
      if (RNG.rand() !== ref()) { firstDiff = i; seedOfDiff = seed; break; }
    }
    if (firstDiff >= 0) break;
  }
  check(`state stays uint32: ${(20).toFixed(0)}M draws x 4 seeds match masked reference` +
        (firstDiff >= 0 ? ` — DIVERGED at draw ${firstDiff} (seed ${seedOfDiff})` : ""),
        firstDiff < 0);
}

// ---- Gate 2: no degeneracy deep in the stream ----
// With the bug, the low bits of the state are zeroed, so the reachable state space
// shrinks. Marginal uniformity survives that (which is why it hid), but exact
// duplicate outputs in a window grow. Compare a deep window against a shallow one.
{
  function windowStats(skip, W) {
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
  const W = 200000;
  const shallow = windowStats(0, W);
  const deep = windowStats(30_000_000, W);   // ~1M photons' worth, far past 2^53/C
  check(`deep-stream distinct values ${deep.distinct}/${W} ≈ shallow ${shallow.distinct}/${W}`,
        Math.abs(deep.distinct - shallow.distinct) < 0.001 * W);
  check(`deep-stream uniformity chi2/dof = ${deep.uniChi2.toFixed(3)} in [0.6, 1.6]`,
        deep.uniChi2 > 0.6 && deep.uniChi2 < 1.6);
}

// ---- Gate 3: end-to-end — BDF mirror symmetry stays Poisson at high N ----
// The physical consequence. Illumination is centered and every VISTA-C geometry is
// mirror-symmetric about the principal plane (dir.y = 0), so BDF(theta,phi) must equal
// BDF(theta,360-phi) in expectation. The reduced chi^2 of the mirror differences is
// therefore ~1 for a sound generator. With the RNG bug this read 5.0 at 6M photons and
// 11.5 at 12M; it must NOT drift upward with N.
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
  // Slightly sub-Poisson is EXPECTED and correct: masked Mulberry32 is a bijection on
  // 2^32 states, so draws sample without replacement -> finite-population factor (1-f),
  // f = draws/2^32 (~0.04 here). Upper bound is the real regression guard.
  check(`BDF mirror chi2 at ${N / 1e6}M photons = ${chi2.toFixed(2)} in [0.80, 1.30] (Poisson=1)`,
        chi2 > 0.80 && chi2 < 1.30);
}

console.log(fails === 0 ? "\nALL RNG GATES PASS" : `\n${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
