// verify_p5.mjs — gates for the P5 streaming path-length histograms
// (2026-07-20). The per-photon path arrays (O(N) memory, re-walked on every
// display refresh) were replaced by fixed-size streaming accumulators. The
// claim being tested is strong: not "close enough" but BIT-IDENTICAL output.
//
// Reference implementation: this harness re-derives, from the same photons,
// what the pre-P5 code would have produced -- it collects the raw path values
// into plain arrays exactly as record() used to, then applies the OLD
// segMean/pathHistogramCounts formulas to them. The streaming result must
// match that reference exactly for the means, the axis max, and every one of
// the 24 display-bin counts.
//
// Usage (from repo root): node tests/review-harness/verify_p5.mjs

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

// ---- pre-P5 reference formulas, verbatim ---------------------------------
function refSegMean(arrays) {
  let sum = 0, n = 0;
  for (const arr of arrays) { for (const v of arr) sum += v; n += arr.length; }
  return n ? sum / n : 0;
}
function refPathHistogramCounts(arrays, niceMax, nBins = 24) {
  const counts = new Array(nBins).fill(0);
  for (const arr of arrays) for (const vRaw of arr) {
    if (vRaw === 0) continue;
    const v = Math.max(0, vRaw || 0);
    counts[Math.min(nBins - 1, Math.floor((v / niceMax) * nBins))] += 1;
  }
  return counts;
}
function refAxisMax(refl3, trans3) {
  const scaleMean = Math.max(refSegMean(refl3), refSegMean(trans3));
  return Math.max(10, Math.ceil((2.5 * Math.max(scaleMean, 1)) / 10) * 10);
}

// The eight populations, in the order record() feeds them.
const NAMES = ["reflectedPathLengths", "netTransmittedPathLengths",
               "sideTransmittedPathLengths", "sideTransmittedPathLengthsCloudOnly",
               "sideEscapeUpPaths", "sideEscapeDownPaths",
               "bypassPaths", "bypassPathsCloudOnly"];

// Run N photons, capturing BOTH the streaming accumulators (from SimStats)
// and a raw-array shadow copy built by watching the same per-photon values.
// The shadow is built by diffing each accumulator's `n` before/after the
// photon -- so it sees exactly what record() routed where, with no
// duplication of record()'s branching logic here.
function runWithShadow(N, params) {
  RNG.reset(SEED);
  SimStats.reset();
  const shadow = {};
  for (const nm of NAMES) shadow[nm] = [];
  const prevN = {};

  for (let i = 0; i < N; i++) {
    for (const nm of NAMES) prevN[nm] = SimStats[nm].n;
    const r = Physics.simulatePhoton(params, false);
    SimStats.record(r);
    for (const t of r.cloudBaseTransmissions) SimStats.registerCloudBaseTransmission(t);
    for (const e of r.surfaceEvents)          SimStats.registerSurfaceEvent(e);
    for (const d of r.surfaceReflectionDirs)  SimStats.registerSurfaceReflection(d);
    // Whichever populations grew this photon received result.totalPath.
    for (const nm of NAMES) {
      const grew = SimStats[nm].n - prevN[nm];
      for (let g = 0; g < grew; g++) shadow[nm].push(r.totalPath ?? 0);
    }
  }
  return shadow;
}

const CASES = [
  { label: "top_side, Aₛ=0.5, Θ₀=60° (mixed populations)",
    N: 150000,
    p: { tauCloud: 10, slabW: 40, slabD: 40, g: 0.85, omega0: 1.0, betaExt: 10.0,
         surfaceDistanceKm: 0.5, entryMode: "top_side", theta0: 60 * Math.PI / 180,
         surfaceAlbedo: 0.5 } },
  { label: "uniform_domain M=4 open, Aₛ=0.5 (zero-path clear-direct spike)",
    N: 150000,
    p: { tauCloud: 10, slabW: 40, slabD: 40, g: 0.85, omega0: 1.0, betaExt: 10.0,
         surfaceDistanceKm: 0.5, entryMode: "uniform_domain", theta0: 60 * Math.PI / 180,
         surfaceAlbedo: 0.5, domainFactor: 4, domainBoundary: "open" } },
  { label: "τ=100, W=500, Aₛ=1 (long tails past the fine grid → overflow)",
    N: 20000,
    p: { tauCloud: 100, slabW: 500, slabD: 500, g: 0.85, omega0: 1.0, betaExt: 10.0,
         surfaceDistanceKm: 0.5, entryMode: "top", theta0: 0, surfaceAlbedo: 1.0 } },
  { label: "τ=100, W=500, Aₛ=1, g=0 (paths to ~25k → grid coarsening triggered)",
    N: 20000,
    p: { tauCloud: 100, slabW: 500, slabD: 500, g: 0.0, omega0: 1.0, betaExt: 10.0,
         surfaceDistanceKm: 0.5, entryMode: "top", theta0: 0, surfaceAlbedo: 1.0 } }
];

for (const c of CASES) {
  console.log(`\n=== ${c.label} ===`);
  const shadow = runWithShadow(c.N, c.p);

  // Every population: streaming n/sum/mean must equal the array's.
  let nOk = true, meanOk = true;
  for (const nm of NAMES) {
    const h = SimStats[nm];
    if (h.n !== shadow[nm].length) nOk = false;
    const refMean = refSegMean([shadow[nm]]);
    const strMean = SimStats.segMean([h]);
    if (!Object.is(refMean, strMean)) meanOk = false;
  }
  check(nOk, "per-population counts (n) match the array lengths exactly");
  check(meanOk, "per-population means bit-identical to the array means");

  // MULTI-SEGMENT means are NOT bit-identical, by construction, and that is
  // worth pinning rather than glossing: the pre-P5 code accumulated one
  // running total across all segments in sequence, while streaming sums each
  // population separately and adds the totals. Same terms, same order,
  // different association -- so floating-point rounding differs in the last
  // digit or two (measured ~1e-14 relative, e.g. 15.459869928343418 vs
  // ...885 in a 2M-photon export). Physically irrelevant (MC error is ~1e-3
  // relative), but exported *_mean values from before and after P5 can differ
  // in their final digits; bin counts and bin_max do not.
  {
    let worstRel = 0;
    for (const combo of [["reflectedPathLengths", "sideEscapeUpPaths"],
                         ["netTransmittedPathLengths", "sideTransmittedPathLengthsCloudOnly", "sideEscapeDownPaths"],
                         ["reflectedPathLengths", "sideEscapeUpPaths", "bypassPaths"]]) {
      const ref = refSegMean(combo.map(nm => shadow[nm]));
      const str = SimStats.segMean(combo.map(nm => SimStats[nm]));
      if (ref !== 0) worstRel = Math.max(worstRel, Math.abs(ref - str) / Math.abs(ref));
    }
    check(worstRel < 1e-12,
          `multi-segment means agree to ${worstRel.toExponential(1)} relative (summation-association change, not bit-identical — see comment)`);
  }

  // Axis max: the value that drives bin_max in every export and figure.
  const refl3  = [shadow.reflectedPathLengths, shadow.sideEscapeUpPaths, shadow.bypassPathsCloudOnly];
  const trans3 = [shadow.netTransmittedPathLengths, shadow.sideTransmittedPathLengthsCloudOnly, shadow.sideEscapeDownPaths];
  const refMax = refAxisMax(refl3, trans3);
  const strMax = SimStats.pathAxisMax();
  check(refMax === strMax, `pathAxisMax bit-identical: ${strMax} (reference ${refMax})`);

  // The histograms themselves, over every segment combination the app can
  // ask for: the two dropdown views and the two entire-domain views.
  const COMBOS = [
    ["reflected (top-base)",      ["reflectedPathLengths"]],
    ["reflected (all_faces)",     ["reflectedPathLengths", "sideEscapeUpPaths"]],
    ["reflected (domain-wide)",   ["reflectedPathLengths", "sideEscapeUpPaths", "bypassPaths"]],
    ["transmitted (top-base)",    ["netTransmittedPathLengths"]],
    ["transmitted (all_faces)",   ["netTransmittedPathLengths", "sideTransmittedPathLengthsCloudOnly", "sideEscapeDownPaths"]],
    ["transmitted (domain-wide)", ["netTransmittedPathLengths", "sideTransmittedPathLengths", "sideEscapeDownPaths"]]
  ];
  let histOk = true, worstDiff = 0, totalBinned = 0;
  for (const [label, names] of COMBOS) {
    const refCounts = refPathHistogramCounts(names.map(nm => shadow[nm]), strMax);
    const strCounts = SimStats.pathHistogramCounts(names.map(nm => SimStats[nm]), strMax);
    for (let i = 0; i < refCounts.length; i++) {
      const d = Math.abs(refCounts[i] - strCounts[i]);
      if (d > worstDiff) worstDiff = d;
      if (d !== 0) histOk = false;
    }
    totalBinned += refCounts.reduce((a, b) => a + b, 0);
    // Conservation: every non-zero path must appear in exactly one bin.
    const expect = names.reduce((a, nm) => a + shadow[nm].filter(v => v !== 0).length, 0);
    const got = strCounts.reduce((a, b) => a + b, 0);
    if (expect !== got) { histOk = false; console.log(`    conservation FAIL in ${label}: ${got} binned vs ${expect} non-zero paths`); }
  }
  check(histOk, `all 6 segment views × 24 bins bit-identical (${totalBinned} photons binned, worst per-bin diff ${worstDiff})`);

  // Grid self-scaling: report the resolution each population settled at, and
  // assert the nesting invariant that makes exactness structural rather than
  // resolution-dependent -- width must remain 10/(24*m) for integer m, so a
  // display bin (k*10/24 wide) is always a whole number of fine bins.
  const ms = NAMES.map(nm => SimStats[nm].m);
  const nestOk = NAMES.every(nm => {
    const h = SimStats[nm];
    return Number.isInteger(h.m) && h.m >= 1 &&
           Math.abs(h.width - 10 / (24 * h.m)) < 1e-15;
  });
  check(nestOk, `fine-grid nesting invariant holds for all populations (m = ${[...new Set(ms)].sort((a,b)=>b-a).join(", ")}; ` +
                `range ${(SimStats.reflectedPathLengths.width * (1 << 17)).toFixed(0)} optical depths)`);
}

// ---- Memory / scaling claim ----------------------------------------------
console.log("\n=== Fixed-size storage (the point of P5) ===");
{
  const h = SimStats.reflectedPathLengths;
  const bytesEach = h.counts.BYTES_PER_ELEMENT * h.counts.length;
  const totalMB = (bytesEach * NAMES.length) / 1e6;
  check(h.counts.length === (1 << 17) && totalMB < 6,
        `8 populations × ${h.counts.length} fine bins = ${totalMB.toFixed(1)} MB, independent of N ` +
        `(pre-P5: ~1.27 arrays entries/photon ⇒ ~200 MB of doubles at 20M photons)`);
}

// ---- Axis sweep: every bin_max the app can produce ------------------------
// The gates above only exercise whatever bin_max the sample runs happen to
// produce (40, 680, 780). That is how a real bug slipped through: the
// re-aggregation mapped fine bins to display bins in floating point, which
// misplaced a whole fine bin at boundaries where the product rounds down --
// invisible at bin_max = 40 (where the arithmetic happens to be exact) but
// wrong at bin_max = 50, where 600*0.0520833... = 31.249999999999996 floors
// into bin 14 instead of 15 (~644 photons in a 2M run). Found only by
// regenerating a committed export and diffing it. This sweep walks EVERY
// bin_max pathAxisMax can return over a wide range, so no such value can hide.
console.log("\n=== Axis sweep: bin_max = 10 … 2000 (every multiple of 10) ===");
{
  // One population, filled once with a broad spread of paths, then re-binned
  // at every axis value against the reference formula.
  RNG.reset(SEED);
  SimStats.reset();
  const p = { tauCloud: 20, slabW: 200, slabD: 200, g: 0.85, omega0: 1.0, betaExt: 10.0,
              surfaceDistanceKm: 0.5, entryMode: "top", theta0: 0, surfaceAlbedo: 1.0 };
  const raw = [];
  for (let i = 0; i < 120000; i++) {
    const r = Physics.simulatePhoton(p, false);
    SimStats.record(r);
    for (const t of r.cloudBaseTransmissions) SimStats.registerCloudBaseTransmission(t);
    for (const e of r.surfaceEvents)          SimStats.registerSurfaceEvent(e);
    for (const d of r.surfaceReflectionDirs)  SimStats.registerSurfaceReflection(d);
    if (r.status === "reflected") raw.push(r.totalPath ?? 0);
  }
  const h = SimStats.reflectedPathLengths;
  let bad = [], checked = 0;
  for (let niceMax = 10; niceMax <= 2000; niceMax += 10) {
    const ref = refPathHistogramCounts([raw], niceMax);
    const got = SimStats.pathHistogramCounts([h], niceMax);
    checked++;
    for (let i = 0; i < ref.length; i++) {
      if (ref[i] !== got[i]) { bad.push(`bin_max=${niceMax} bin ${i}: ${got[i]} vs ${ref[i]}`); break; }
    }
  }
  for (const b of bad.slice(0, 6)) console.log("    " + b);
  check(bad.length === 0,
        `all ${checked} axis values give bit-identical 24-bin histograms (${raw.length} reflected paths, n=${h.n})`);
}

// ---- No stale `.length` on a path population -----------------------------
// Regression gate for a real bug (user report, 2026-07-20): bottomPanel's two
// panel-title counts still read `.length` on what are now accumulator objects,
// which is `undefined` -- and undefined propagates silently through `+`, so
// both titles rendered "N=NaN" rather than throwing. Nothing else in the suite
// could catch it, since the numbers themselves were all correct. A source scan
// is crude but it is exactly targeted at the failure mode: `.length` on a path
// population is now always a bug, in any module.
console.log("\n=== No stale `.length` on path populations (static scan) ===");
{
  const { readFileSync, readdirSync } = await import("node:fs");
  const dir = new URL("../../js/", import.meta.url);
  const POPS = /(reflectedPathLengths|netTransmittedPathLengths|sideTransmittedPathLengths(CloudOnly)?|sideEscapeUpPaths|sideEscapeDownPaths|bypassPaths(CloudOnly)?|reflSegs|transSegs|netSegs|Segments\(\))/;
  const offenders = [];
  for (const f of readdirSync(dir).filter(f => f.endsWith(".js"))) {
    const src = readFileSync(new URL(f, dir), "utf8");
    src.split("\n").forEach((line, i) => {
      if (line.trim().startsWith("//") || line.trim().startsWith("*")) return;
      if (POPS.test(line) && /\.length/.test(line)) offenders.push(`${f}:${i + 1}: ${line.trim().slice(0, 90)}`);
    });
  }
  for (const o of offenders) console.log("    " + o);
  check(offenders.length === 0, `no module reads .length on a path population (use .n) — ${offenders.length} found`);
}

console.log(allPass ? "\nALL P5 GATES PASS" : "\nSOME P5 GATES FAILED");
process.exitCode = allPass ? 0 : 1;
