// check_golden_ud.mjs — regenerate the uniform-domain golden suite with the
// CURRENT code and diff it against the committed snapshot. Run after any
// change that could touch the uniform-domain path (Phase 3 especially — with
// the boundary set to open, every byte must still match).
//   node tests/golden-snapshots/check_golden_ud.mjs
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { compareGolden } from "./compare_golden.mjs";

// fileURLToPath (NOT URL.pathname) so paths containing spaces or other
// URL-encoded characters resolve correctly — .pathname leaves them
// percent-encoded (%20), which broke this script on a repo path with spaces.
const here = fileURLToPath(new URL(".", import.meta.url));
const fresh = JSON.parse(execFileSync(process.execPath, [here + "gen_golden_ud.mjs"],
                                      { maxBuffer: 1 << 26, encoding: "utf8" }));
const golden = JSON.parse(readFileSync(here + "golden_ud_v6.0-phase2.json", "utf8"));

for (const o of [fresh, golden]) { delete o.generated; delete o.appVersion; }

// Phase 3 additive wrap-cap diagnostic (physics.js/simstats.js): always 0
// here, since this suite never sets domainBoundary="periodic" (isPeriodic is
// false for every row). Strip before comparing, same pattern diff_golden.mjs
// uses for the Phase-2/Phase-4 additive fields -- keeps the committed golden
// JSON itself untouched (open-boundary behavior is bit-identical; only the
// rawStats *shape* gained a field).
for (const r of fresh.results) {
  if (r.rawStats.wrapCapped !== 0) {
    console.error(`NONZERO wrapCapped=${r.rawStats.wrapCapped} in M=${r.M} th0=${r.theta0_deg} As=${r.As} ${r.obsGeom}`);
  }
  delete r.rawStats.wrapCapped;
}

// Tolerant comparison (2026-07-19, see compare_golden.mjs): counts exact,
// totalPath/meanPath to 1e-9 relative -- cross-Node/V8 last-ulp Math
// differences can wobble the run-total path sum at machine epsilon in the
// longest-trajectory rows while every count stays bit-identical.
const { pass, diffs } = compareGolden(fresh, golden);
if (pass) {
  console.log(`PASS — match (counts exact; float accumulators ≤1e-9 rel), ${golden.results.length} rows (uniform_domain golden).`);
} else {
  console.log(`FAIL — ${diffs.length} differences:`);
  for (const d of diffs.slice(0, 40)) console.log("  " + d);
  if (diffs.length > 40) console.log(`  ... and ${diffs.length - 40} more`);
  process.exitCode = 1;
}
