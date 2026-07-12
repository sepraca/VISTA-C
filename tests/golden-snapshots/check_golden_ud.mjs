// check_golden_ud.mjs — regenerate the uniform-domain golden suite with the
// CURRENT code and diff it against the committed snapshot. Run after any
// change that could touch the uniform-domain path (Phase 3 especially — with
// the boundary set to open, every byte must still match).
//   node tests/golden-snapshots/check_golden_ud.mjs
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// fileURLToPath (NOT URL.pathname) so paths containing spaces or other
// URL-encoded characters resolve correctly — .pathname leaves them
// percent-encoded (%20), which broke this script on a repo path with spaces.
const here = fileURLToPath(new URL(".", import.meta.url));
const fresh = JSON.parse(execFileSync(process.execPath, [here + "gen_golden_ud.mjs"],
                                      { maxBuffer: 1 << 26, encoding: "utf8" }));
const golden = JSON.parse(readFileSync(here + "golden_ud_v6.0-phase2.json", "utf8"));

for (const o of [fresh, golden]) { delete o.generated; delete o.appVersion; }
const a = JSON.stringify(fresh), b = JSON.stringify(golden);
if (a === b) {
  console.log(`PASS — exact match, ${golden.results.length} rows (uniform_domain golden).`);
} else {
  console.log("FAIL — differences found. Row scan:");
  for (let i = 0; i < Math.max(fresh.results.length, golden.results.length); i++) {
    if (JSON.stringify(fresh.results[i]) !== JSON.stringify(golden.results[i])) {
      const r = golden.results[i] ?? fresh.results[i];
      console.log(`  row ${i}: M=${r.M} th0=${r.theta0_deg} As=${r.As} ${r.obsGeom}`);
    }
  }
  process.exitCode = 1;
}
