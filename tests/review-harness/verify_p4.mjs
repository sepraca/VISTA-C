// verify_p4.mjs — gates for the P4 fast-mode / time-budgeted-slice rework
// (2026-07-20). Two independent things need to hold:
//
//   Gate 1 (REAL code): slice-invariance. The batch loop now simulates a
//     VARIABLE number of photons per setTimeout slice (whatever fits the wall
//     budget) instead of a fixed 1000, and fast mode changes when the display
//     refreshes. Neither may perturb a single count: photons are drawn from
//     one RNG stream in one order regardless of how the loop is sliced. This
//     gate exercises the real Physics/SimStats path, running the same N as a
//     single loop vs. randomly-sized sub-batches, and requires every
//     accumulator to match bit-for-bit.
//
//   Gate 2 (MIRROR): slice control-flow arithmetic. runControl.js imports
//     three.js and cannot be loaded in Node, so the slice/step/pause decision
//     logic is mirrored here and checked for the invariants that matter:
//     exactly n photons run (never n±1), termination, Step advancing exactly
//     one photon, and pause/resume not losing or duplicating work.
//     ** Keep in sync with RunControl.runInstantBatch if that loop changes. **
//
// Usage (from repo root): node tests/review-harness/verify_p4.mjs

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

let allPass = true;
function check(ok, label) { console.log(`${ok ? "PASS" : "FAIL"}  ${label}`); allPass = ok && allPass; return ok; }

const SEED = 42;
const PARAMS = { tauCloud: 10, slabW: 40, slabD: 40, g: 0.85, omega0: 1.0,
                 betaExt: 10.0, surfaceDistanceKm: 0.5, entryMode: "top_side",
                 theta0: 60 * Math.PI / 180, surfaceAlbedo: 0.5 };

// One photon's worth of the real record path (mirrors runPhotons() in
// RunControl.runInstantBatch, minus the scene call, which touches no stats).
function onePhoton(params) {
  const r = Physics.simulatePhoton(params, false);
  SimStats.record(r);
  for (const t of r.cloudBaseTransmissions) SimStats.registerCloudBaseTransmission(t);
  for (const e of r.surfaceEvents)          SimStats.registerSurfaceEvent(e);
  for (const d of r.surfaceReflectionDirs)  SimStats.registerSurfaceReflection(d);
}

// Run N photons in slices of the given sizes (a generator of slice lengths).
function runSliced(N, params, nextSliceSize) {
  RNG.reset(SEED);
  SimStats.reset();
  let done = 0;
  let slices = 0;
  while (done < N) {
    const k = Math.min(nextSliceSize(), N - done);
    for (let i = 0; i < k; i++) onePhoton(params);
    done += k;
    slices++;
  }
  return { stats: { ...SimStats.stats }, slices, done };
}

console.log("=== Gate 1: slice-invariance (real Physics/SimStats) ===");
{
  const N = 200000;

  // (a) one monolithic loop -- the reference.
  const ref = runSliced(N, PARAMS, () => N);

  // (b) fixed 1000-photon chunks -- the PRE-P4 loop's slicing.
  const old = runSliced(N, PARAMS, () => 1000);

  // (c) wildly variable slices, spanning the granularity boundary in both
  //     directions (256 is SLICE_CLOCK_GRANULARITY; real slices are whole
  //     multiples of it, but 1 and huge sizes are tested too as a superset).
  const sizes = [1, 7, 256, 512, 80000, 3, 1024, 250000];
  let si = 0;
  const varied = runSliced(N, PARAMS, () => sizes[si++ % sizes.length]);

  const keys = Object.keys(ref.stats);
  const same = (a, b) => keys.every(k => Object.is(a[k], b[k]));

  check(ref.done === N && old.done === N && varied.done === N,
        `all three runs simulated exactly N=${N} photons`);
  check(same(ref.stats, old.stats),
        `fixed 1000-photon chunks ≡ single loop (${keys.length} accumulators bit-identical)`);
  check(same(ref.stats, varied.stats),
        `variable slices [${sizes.join(",")}] ≡ single loop (bit-identical)`);
  console.log(`  (slice counts: single=${ref.slices}, old-chunked=${old.slices}, varied=${varied.slices}` +
              `; launched=${ref.stats.launched}, reflected=${ref.stats.reflected}, totalPath=${ref.stats.totalPath})`);
}

// ---------------------------------------------------------------------------
console.log("\n=== Gate 2: slice control-flow arithmetic (mirror of runInstantBatch) ===");
{
  const SLICE_CLOCK_GRANULARITY = 256;
  const MAX_SLICE_PHOTONS = 200000;

  // Mirror of the real loop with an injectable clock and no display work.
  // `costPerPhotonMs` drives the fake clock so budgets actually bite.
  const TARGET_STEPS_NORMAL = 40;

  function simulateLoop({ n, sliceMs, costPerPhotonMs, fastMode = false,
                          pauseAt = null, stepsWhilePaused = 0 }) {
    // Small-run floor: normal mode caps a slice at n/TARGET photons so short
    // runs still yield (and repaint) ~TARGET times; fast mode does not.
    const stepPhotons  = Math.max(1, Math.ceil(n / TARGET_STEPS_NORMAL));
    const slicePhotons = fastMode ? MAX_SLICE_PHOTONS
                                  : Math.min(MAX_SLICE_PHOTONS, stepPhotons);
    let remaining = n;
    let clock = 0;
    const now = () => clock;
    let ran = 0, slices = 0, steps = 0, guard = 0;
    let paused = false, stepRequested = false, resumed = false;

    while (remaining > 0) {
      if (++guard > 10_000_000) return { ran, slices, steps, runaway: true };

      // Pause trigger: enter pause after `pauseAt` photons, take N single
      // steps, then resume -- exercising the step path mid-run.
      if (pauseAt !== null && !resumed && ran >= pauseAt && !paused) { paused = true; }
      if (paused && !stepRequested) {
        if (steps < stepsWhilePaused) { stepRequested = true; continue; }
        paused = false; resumed = true; continue;
      }

      const steppingOnce = stepRequested;
      stepRequested = false;

      let m = 0;
      if (steppingOnce) {
        m = Math.min(1, remaining);
        ran += m; clock += m * costPerPhotonMs; steps++;
      } else {
        const sliceStart = now();
        const sliceCap = Math.min(remaining, slicePhotons);
        const gran = Math.min(SLICE_CLOCK_GRANULARITY, sliceCap);
        while (m < sliceCap) {
          const k = Math.min(gran, sliceCap - m);
          m += k; ran += k; clock += k * costPerPhotonMs;
          if (now() - sliceStart >= sliceMs) break;
        }
        slices++;
      }
      remaining -= m;
    }
    return { ran, slices, steps, runaway: false };
  }

  // Exact totals across budgets, costs, and awkward n values, in both modes.
  let exact = true, noRunaway = true, sliceCountSane = true;
  for (const n of [1, 39, 40, 41, 255, 256, 257, 1000, 999_999, 5_000_000]) {
    for (const [sliceMs, cost] of [[12, 0.0015], [40, 0.0015], [40, 0.02], [12, 0.5], [40, 0]]) {
      for (const fastMode of [false, true]) {
        const r = simulateLoop({ n, sliceMs, costPerPhotonMs: cost, fastMode });
        if (r.ran !== n) exact = false;
        if (r.runaway) noRunaway = false;
        // Upper bound on slices: normal mode is floored at n/TARGET-photon
        // slices, so it may yield more often than the clock alone would --
        // but never more than TARGET times (+1 for the remainder slice).
        const bound = fastMode ? Math.ceil(n / SLICE_CLOCK_GRANULARITY)
                               : Math.max(TARGET_STEPS_NORMAL + 1, Math.ceil(n / SLICE_CLOCK_GRANULARITY));
        if (r.slices > bound) sliceCountSane = false;
      }
    }
  }
  check(exact, "exactly n photons run for every (n, budget, cost, mode) combination");
  check(noRunaway, "loop always terminates (no runaway / zero-progress slice)");
  check(sliceCountSane, "slice count stays within its mode's bound (no zero-work slices)");

  // SMALL-RUN VISIBILITY (2026-07-20 regression gate). The default 10k-photon
  // run must still yield ~TARGET_STEPS_NORMAL times so the browser can paint
  // the photon-by-photon build-up. Before the small-run floor this collapsed
  // to 1-2 slices (~8000 photons fit in one 12 ms budget at ~0.7M photons/s),
  // which the user saw as a single flash of the final state.
  {
    const cost = 1 / 700;   // ms per photon at the measured ~0.7M photons/s
    const small = simulateLoop({ n: 10_000, sliceMs: 12, costPerPhotonMs: cost });
    check(small.ran === 10_000 && small.slices >= TARGET_STEPS_NORMAL - 1,
          `default 10k run yields ${small.slices} times (>= ~${TARGET_STEPS_NORMAL}) — progressive build-up preserved`);
    const tiny = simulateLoop({ n: 200, sliceMs: 12, costPerPhotonMs: cost });
    check(tiny.ran === 200 && tiny.slices >= 20,
          `tiny 200-photon run still yields ${tiny.slices} times (never one instant flash)`);
    // ...and the floor must NOT add yields to a large run: there the clock is
    // far tighter than n/TARGET, so the time budget still governs.
    const big = simulateLoop({ n: 20_000_000, sliceMs: 12, costPerPhotonMs: cost });
    check(big.ran === 20_000_000 && big.slices > 1000,
          `20M run governed by the clock, not the floor: ${big.slices} slices (~${Math.round(20_000_000 / big.slices)} photons each)`);
  }

  // Pathological clock (frozen / coarsened below the budget, as under
  // Firefox's resistFingerprinting): the wall-clock break never fires, so
  // MAX_SLICE_PHOTONS is the only thing bounding a slice. Without that cap a
  // single slice would swallow the entire run and freeze the tab (and the
  // Stop button) -- this gate is what motivated adding it.
  // Fast mode is the case MAX_SLICE_PHOTONS actually governs: no small-run
  // floor applies there, so without the cap a frozen clock would swallow the
  // whole run in one slice.
  const frozenFast = simulateLoop({ n: 1_000_000, sliceMs: 40, costPerPhotonMs: 0, fastMode: true });
  check(frozenFast.ran === 1_000_000 && frozenFast.slices === Math.ceil(1_000_000 / MAX_SLICE_PHOTONS),
        `frozen clock, fast mode: still yields every ${MAX_SLICE_PHOTONS} photons (${frozenFast.slices} slices), never one unbounded slice`);
  // Normal mode under the same frozen clock is bounded even tighter, by the
  // n/TARGET small-run floor.
  const frozenNormal = simulateLoop({ n: 1_000_000, sliceMs: 40, costPerPhotonMs: 0 });
  check(frozenNormal.ran === 1_000_000 && frozenNormal.slices === TARGET_STEPS_NORMAL,
        `frozen clock, normal mode: bounded by the n/TARGET floor (${frozenNormal.slices} slices)`);

  // Realistic budget behavior: at the measured 0.64M photons/s (1.56 µs each),
  // a 40 ms fast slice should hold ~25k photons and a 5M run ~200 slices --
  // versus 5,000 yields under the old fixed-1000 chunking.
  const fast5M = simulateLoop({ n: 5_000_000, sliceMs: 40, costPerPhotonMs: 1 / 640 });
  const perSlice = 5_000_000 / fast5M.slices;
  check(fast5M.ran === 5_000_000 && fast5M.slices < 500,
        `5M @ 0.64M photons/s, 40 ms budget: ${fast5M.slices} slices (~${Math.round(perSlice)} photons each) vs 5000 pre-P4`);

  // Step semantics: each Step advances exactly one photon, and the surrounding
  // slices still account for the rest exactly.
  const stepped = simulateLoop({ n: 100_000, sliceMs: 12, costPerPhotonMs: 0.0015,
                                 pauseAt: 5_000, stepsWhilePaused: 3 });
  check(stepped.ran === 100_000 && stepped.steps === 3,
        `pause + 3 single Steps mid-run: total still exactly 100000, steps=${stepped.steps}`);
}

console.log(allPass ? "\nALL P4 GATES PASS" : "\nSOME P4 GATES FAILED");
process.exitCode = allPass ? 0 : 1;
