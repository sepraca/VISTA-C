// run_all.mjs — one-command runner for the whole VISTA-C test battery
// (review A3, 2026-07-21). Replaces the seven-plus commands that were pasted by
// hand every verification round, where a skipped suite was a live risk.
//
//   node tests/run_all.mjs            # everything
//   node tests/run_all.mjs p4 p5      # only suites whose name contains "p4" or "p5"
//
// Filter args (optional) select suites by case-insensitive substring of their
// display name — a convenience for the inner-loop (run just the fast gates)
// that does not change the default all-suites behavior.
//
// Runs every automated gate as a child process, judges each by EXIT CODE (all
// suites set process.exitCode on failure — diff_golden was given one for this),
// prints one PASS/FAIL line per suite with its wall time, and exits nonzero if
// any suite failed. The per-suite timing also surfaces a suite that quietly
// gets slower over time.
//
// This runner adds NO new checking logic of its own; it only orchestrates the
// existing suites, so it cannot itself mask or invent a result. The legacy
// golden is the one two-step case: gen_golden.mjs writes a fresh snapshot to a
// temp file, then diff_golden.mjs strips additive fields and compares it to the
// committed golden_v5.4.0.json.
//
// Excluded by design: verify_review_findings.mjs and gen_export_roundtrip.mjs
// are informational/generators (no pass/fail contract), not gates.

import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// fileURLToPath, NOT new URL(...).pathname: the latter leaves spaces
// percent-encoded (%20), so on any checkout whose path contains a space — e.g.
// ".../mc cloud simulator Claude Project/VISTA-C" — every script path would be
// wrong and Node would report MODULE_NOT_FOUND for every suite. fileURLToPath
// decodes correctly (and is cross-platform). (Missed in the sandbox, whose
// path has no spaces — a real reason to run the suite on the actual machine.)
const ROOT = fileURLToPath(new URL("..", import.meta.url));   // repo root
const NODE = process.execPath;
const tmp = mkdtempSync(join(tmpdir(), "vista-runall-"));

// Run a node script, return { code, ms, stdout }. Inherit nothing — capture so
// the runner's own output stays a clean one-line-per-suite summary; on failure
// the captured tail is printed for context.
function run(scriptRel, args = []) {
  const t0 = performance.now();
  const r = spawnSync(NODE, [join(ROOT, scriptRel), ...args],
                      { encoding: "utf8", maxBuffer: 1 << 28 });
  const ms = performance.now() - t0;
  return { code: r.status ?? 1, ms, stdout: (r.stdout || "") + (r.stderr || "") };
}

const filters = process.argv.slice(2).map(s => s.toLowerCase());
const wanted = name => filters.length === 0 || filters.some(f => name.toLowerCase().includes(f));

const results = [];
function record(name, res) {
  results.push({ name, ...res });
  const tag = res.code === 0 ? "PASS" : "FAIL";
  console.log(`${tag}  ${name.padEnd(34)} ${(res.ms / 1000).toFixed(1)}s`);
  if (res.code !== 0) {
    // Show the last few lines so a failure is diagnosable without re-running.
    const tail = res.stdout.trimEnd().split("\n").slice(-6);
    for (const line of tail) console.log("        " + line);
  }
}
// A suite runs only if it matches the filter (default: all). `gate` wraps the
// run+record so a filtered-out suite is skipped without spawning anything.
function gate(name, scriptRel, args = []) {
  if (!wanted(name)) return;
  record(name, run(scriptRel, args));
}

console.log("VISTA-C test battery\n" + "-".repeat(52));

// --- Self-contained gates (judged by exit code) ---
gate("verify_phase3 (periodic boundary)", "tests/review-harness/verify_phase3.mjs");
gate("verify_phase4 (rigorous BRF/BTF)",  "tests/review-harness/verify_phase4.mjs");
gate("verify_p4 (fast mode / slicing)",   "tests/review-harness/verify_p4.mjs");
gate("verify_p5 (streaming path hist)",   "tests/review-harness/verify_p5.mjs");
gate("verify_mie_sampling (⟨µ⟩=g)",       "tests/review-harness/verify_mie_sampling.mjs");
gate("check_golden_ud (uniform domain)",  "tests/golden-snapshots/check_golden_ud.mjs");
gate("check_golden_periodic",             "tests/golden-snapshots/check_golden_periodic.mjs");

// --- Legacy golden: generate then strip-diff against the committed snapshot ---
if (wanted("golden_v5.4.0 (legacy, strip-diff)")) {
  const t0 = performance.now();
  const gen = spawnSync(NODE, [join(ROOT, "tests/golden-snapshots/gen_golden.mjs")],
                        { encoding: "utf8", maxBuffer: 1 << 28 });
  let res;
  if (gen.status !== 0) {
    res = { code: gen.status ?? 1, ms: performance.now() - t0,
            stdout: "gen_golden.mjs failed:\n" + (gen.stderr || "") };
  } else {
    const freshPath = join(tmp, "golden_legacy_fresh.json");
    writeFileSync(freshPath, gen.stdout);
    const diff = spawnSync(NODE, [join(ROOT, "tests/review-harness/diff_golden.mjs"),
                                  freshPath, join(ROOT, "tests/golden-snapshots/golden_v5.4.0.json")],
                           { encoding: "utf8", maxBuffer: 1 << 28 });
    res = { code: diff.status ?? 1, ms: performance.now() - t0,
            stdout: (diff.stdout || "") + (diff.stderr || "") };
  }
  record("golden_v5.4.0 (legacy, strip-diff)", res);
}

rmSync(tmp, { recursive: true, force: true });

// --- Summary ---
const failed = results.filter(r => r.code !== 0);
const totalS = (results.reduce((a, r) => a + r.ms, 0) / 1000).toFixed(1);
console.log("-".repeat(52));
if (failed.length === 0) {
  console.log(`ALL ${results.length} SUITES PASS   (${totalS}s total)`);
} else {
  console.log(`${failed.length} of ${results.length} SUITES FAILED: ${failed.map(f => f.name).join(", ")}   (${totalS}s total)`);
}
process.exit(failed.length === 0 ? 0 : 1);
