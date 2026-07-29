// rng.js — xoshiro128** deterministic RNG (128-bit state), SplitMix32 seeding.
//
// REPLACED Mulberry32 on 2026-07-28 (TODO section R). Mulberry32 had three problems, all
// stemming from its 32-bit state, and all measured rather than assumed:
//
//   (a) PERIOD TOO SHORT FOR THIS APPLICATION. A photon consumes ~83 random draws at
//       tau=10 (measured: 21.4 step-length + 20.4 scattering angle + 20.4 azimuth +
//       20.4 absorption test -- four draws per scattering, not three). The 2^32 period
//       is therefore exhausted after only ~52 MILLION photons at tau=10 -- BELOW the
//       app's own 100M cap. Past that the generator wraps and photons repeat
//       trajectories exactly, so the effective sample size stops growing no matter how
//       many photons are launched. (~150M at tau=4; the limit is tau- and omega0-
//       dependent because those set the scattering count.)
//
//   (b) "DIFFERENT SEEDS" WERE NOT INDEPENDENT STREAMS. Mulberry32's state is a counter,
//       so every seed lies on ONE cycle at a different phase. Independence then depends
//       on arithmetic offsets being larger than the draws consumed -- which silently
//       failed during the C5 validation work: 20M-photon chunks consume 1.65e9 draws but
//       were seeded 600M draws apart, giving 64% overlap and correlated chunks
//       (rho ~ 0.32). Measured, two 20M runs differenced (Poisson prediction 1.000):
//       mulberry32 0.362, xoshiro128** 0.960.
//
//   (c) IT WAS SLOWER. The RNG is 41% of per-photon cost at tau=10 (631 ns of 1538 ns).
//       Measured 7.66 ns/draw vs 4.50 for xoshiro128** -- the swap is ~20% faster
//       overall, not a tradeoff.
//
// WHY THIS GENERATOR. xoshiro128** has 128 bits of state and a 2^128 period (~4e36
// photons at tau=10 -- the ceiling reverts to wall-clock), produces 32-bit output, and
// uses only Math.imul / xor / shift / rotate. Every one of those is specified exact
// 32-bit integer arithmetic, so the sequence is bit-reproducible across engines and
// platforms. It passes BigCrush.
//
// Note the naming: xoshiro128** is the 32-bit-OUTPUT variant with 128-bit state, and its
// companion seeder is SplitMix32. SplitMix64 belongs to xoshiro256**, whose 64-bit
// arithmetic needs BigInt in JavaScript -- measured 58.28 ns/draw, 7.7x slower. Avoid.
//
// STRUCTURALLY IMMUNE TO THE 2026-07-27 BUG. That bug was `t += 0x6D2B79F5` -- a
// FLOATING-POINT addition on a value that outgrew 2^53. The state update below contains
// NO additions at all, only xor/shift/rotate, each of which forces 32-bit truncation by
// definition. Verified: all four state words are still exact uint32 after 200M draws.
//
// REPRODUCIBILITY TEST VECTOR (seed 42) -- an INDEPENDENT Python implementation written
// from the algorithm reproduces these exactly; verify_rng.mjs asserts them:
//   first 8 outputs (uint32): 660444221, 3652823732, 77672526, 910233633,
//                             2297337756, 3786072677, 3123505064, 1891482476
//   state after 8 draws:      2382219267, 1337384895, 3454353073, 311600339

export const RNG = (() => {
    const DEFAULT_SEED = 42;
    const NAME = "xoshiro128**";

    // SplitMix32 -- expands the single user-facing integer seed into the four state
    // words. Using a separate, well-mixed expander matters: seeding xoshiro directly
    // from a small integer leaves most of the state near zero and the first outputs
    // correlated across nearby seeds.
    function splitmix32(seed) {
      let z = seed >>> 0;
      return function() {
        z = (z + 0x9E3779B9) >>> 0;
        let t = z;
        t = Math.imul(t ^ (t >>> 16), 0x21F0AAAD);
        t = Math.imul(t ^ (t >>> 15), 0x735A2D97);
        return (t ^ (t >>> 15)) >>> 0;
      };
    }

    let s0 = 0, s1 = 0, s2 = 0, s3 = 0;
    let _seed = DEFAULT_SEED;

    function reset(seed = DEFAULT_SEED) {
      _seed = seed;
      const sm = splitmix32(seed);
      s0 = sm(); s1 = sm(); s2 = sm(); s3 = sm();
      // The all-zero state is a fixed point (it would emit zeros forever). SplitMix32
      // effectively never produces it, but the guard costs nothing.
      if ((s0 | s1 | s2 | s3) === 0) s0 = 1;
    }

    // Seed of the current RNG stream (for diagnostics/export headers).
    function currentSeed() { return _seed; }

    // Name of the generator (export schema 1.6: a run must record WHICH generator
    // produced it, since a seed alone no longer identifies the stream across versions).
    function name() { return NAME; }

    function rand() {
      // result = rotl(s1 * 5, 7) * 9
      const m = Math.imul(s1, 5);
      const r = Math.imul((m << 7) | (m >>> 25), 9) >>> 0;

      const t = s1 << 9;
      s2 ^= s0;
      s3 ^= s1;
      s1 ^= s2;
      s0 ^= s3;
      s2 ^= t;
      s3 = (s3 << 11) | (s3 >>> 21);

      return r / 4294967296;
    }

    // Clamp away from zero so -log() never returns Infinity
    function randOpen01() {
      return Math.max(1e-12, rand());
    }

    // Advance the state by 2^64 draws in constant time. This is the CORRECT primitive
    // for independent sub-streams -- chunked accumulation, and per-worker streams when
    // Web Workers land. Never derive sub-streams by arithmetic seed offsets: that is
    // exactly the mulberry32 trap described in (b) above, and it fails silently.
    const JUMP = [0x8764000b, 0xf542d2d3, 0x6fa035c3, 0x77f2db5b];
    function jump() {
      let a = 0, b = 0, c = 0, d = 0;
      for (let i = 0; i < 4; i++) {
        for (let bit = 0; bit < 32; bit++) {
          if (JUMP[i] & (1 << bit)) { a ^= s0; b ^= s1; c ^= s2; d ^= s3; }
          rand();
        }
      }
      s0 = a; s1 = b; s2 = c; s3 = d;
    }

    // Current state, for diagnostics and for the reproducibility gate.
    function state() { return [s0 >>> 0, s1 >>> 0, s2 >>> 0, s3 >>> 0]; }

    reset(DEFAULT_SEED);

    return { DEFAULT_SEED, NAME, reset, rand, randOpen01, currentSeed, name, jump, state };
  })();
