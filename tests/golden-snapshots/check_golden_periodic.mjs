// check_golden_periodic.mjs — regenerate the periodic-boundary uniform-domain
// golden suite with the CURRENT code and diff it against the committed
// snapshot. Companion to check_golden_ud.mjs (open boundary). Run after any
// change that could touch the periodic transport path.
//   node tests/golden-snapshots/check_golden_periodic.mjs
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { compareGolden } from "./compare_golden.mjs";

const here = fileURLToPath(new URL(".", import.meta.url));
const fresh = JSON.parse(execFileSync(process.execPath, [here + "gen_golden_periodic.mjs"],
                                      { maxBuffer: 1 << 26, encoding: "utf8" }));
const golden = JSON.parse(readFileSync(here + "golden_periodic_v6.0-phase3.json", "utf8"));

for (const o of [fresh, golden]) { delete o.generated; delete o.appVersion; }

// Tolerant comparison (2026-07-19, see compare_golden.mjs): counts exact,
// totalPath/meanPath to 1e-9 relative -- the longest-trajectory rows here
// (Θ₀=60°, Aₛ=1) accumulate ~10⁹⁺ transcendental calls, enough to sample
// last-ulp Math differences between Node/V8 versions that wobble the path
// SUM at machine epsilon while every count stays bit-identical.
const { pass, diffs } = compareGolden(fresh, golden);
if (pass) {
  console.log(`PASS — match (counts exact; float accumulators ≤1e-9 rel), ${golden.results.length} rows (periodic-boundary uniform_domain golden).`);
} else {
  console.log(`FAIL — ${diffs.length} differences:`);
  for (const d of diffs.slice(0, 40)) console.log("  " + d);
  if (diffs.length > 40) console.log(`  ... and ${diffs.length - 40} more`);
  process.exitCode = 1;
}
