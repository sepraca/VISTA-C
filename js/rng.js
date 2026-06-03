// rng.js — Mulberry32 deterministic RNG with fixed default seed.

export const RNG = (() => {
    const DEFAULT_SEED = 42;

    function mulberry32(seed) {
      let t = seed >>> 0;
      return function() {
        t += 0x6D2B79F5;
        let r = Math.imul(t ^ (t >>> 15), 1 | t);
        r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
        return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
      };
    }

    let _rng = mulberry32(DEFAULT_SEED);

    function reset(seed = DEFAULT_SEED) {
      _rng = mulberry32(seed);
    }

    function rand() {
      return _rng();
    }

    // Clamp away from zero so -log() never returns Infinity
    function randOpen01() {
      return Math.max(1e-12, rand());
    }

    return { DEFAULT_SEED, reset, rand, randOpen01 };
  })();
