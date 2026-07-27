// rng.js — Mulberry32 deterministic RNG with fixed default seed.

export const RNG = (() => {
    const DEFAULT_SEED = 42;

    function mulberry32(seed) {
      let t = seed >>> 0;
      return function() {
        // The `>>> 0` mask is LOAD-BEARING -- do not remove it (bug fixed 2026-07-27).
        // Mulberry32 is a counter-based generator: `t` is a 32-bit register that must
        // advance modulo 2^32. JavaScript has no integer type, so without an explicit
        // mask `t += 0x6D2B79F5` never wraps -- it grows as a float64 and loses integer
        // exactness past 2^53, i.e. after 4,917,758 draws (~175k photons). Beyond that
        // the addition rounds, the low bits of `t` are progressively forced to zero, and
        // since the mixing below reads `t mod 2^32` the effective state collapses from
        // 2^32 to 2^(32-k). Symptom: Monte Carlo variance inflating with run length
        // (BDF mirror-symmetry reduced-chi^2 reached ~11-19 at 12-20M photons instead of
        // 1.0), while means stayed unbiased. Masking holds chi^2 at ~0.95 to 20M+.
        // Canonical Mulberry32 uses `| 0`; verified bit-identical to `>>> 0` here, but
        // `>>> 0` keeps the state a true unsigned counter for any future non-bitwise use
        // (e.g. per-worker sub-stream offsets). See TODO section D.0 for the full analysis.
        t = (t + 0x6D2B79F5) >>> 0;
        let r = Math.imul(t ^ (t >>> 15), 1 | t);
        r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
        return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
      };
    }

    let _seed = DEFAULT_SEED;
    let _rng = mulberry32(DEFAULT_SEED);

    function reset(seed = DEFAULT_SEED) {
      _seed = seed;
      _rng = mulberry32(seed);
    }

    // Seed of the current RNG stream (for diagnostics/export headers).
    function currentSeed() {
      return _seed;
    }

    function rand() {
      return _rng();
    }

    // Clamp away from zero so -log() never returns Infinity
    function randOpen01() {
      return Math.max(1e-12, rand());
    }

    return { DEFAULT_SEED, reset, rand, randOpen01, currentSeed };
  })();
