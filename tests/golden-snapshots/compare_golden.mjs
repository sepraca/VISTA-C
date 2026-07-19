// compare_golden.mjs — shared snapshot comparator for the check_golden_*.mjs
// harnesses (and diff_golden.mjs). Compares two golden-snapshot objects with
// the policy established 2026-07-19:
//
//   * INTEGER TALLIES AND EVERYTHING ELSE: exact (bit-for-bit). Any real
//     physics/bookkeeping change moves at least one count, and counts are
//     integer-exact across platforms and Node/V8 versions (Mulberry32 is
//     integer arithmetic; boundary comparisons are IEEE-deterministic).
//
//   * FLOATING ACCUMULATORS (`totalPath`, `meanPath`, wherever nested):
//     relative tolerance 1e-9. Diagnosed cross-machine (Mac/Node 26 vs
//     Linux/Node 22, 2026-07-19): in the longest-trajectory rows (periodic,
//     Θ₀=60°, Aₛ=1 — ~10⁹⁺ transcendental calls), a last-ulp difference in a
//     V8 Math function shifted the run-total optical path by ~2×10⁻¹⁶
//     RELATIVE, with every count in all 36 rows still bit-identical — i.e.
//     the trajectories were identical; only the real-valued sum wobbled at
//     machine epsilon. Comparing those two fields exactly made one snapshot
//     unverifiable across Node versions for no physical reason. 1e-9 is ~7
//     orders of magnitude above the observed wobble and ~7 below anything a
//     genuine change would produce (which would, in any case, also move
//     counts and fail the exact tier).
//
// Returns { pass, diffs } where diffs is a list of human-readable strings.

const FLOAT_TOL_KEYS = new Set(["totalPath", "meanPath"]);
const REL_TOL = 1e-9;

function close(a, b) {
  return Math.abs(a - b) <= REL_TOL * Math.max(1, Math.abs(a), Math.abs(b));
}

function walk(a, b, path, diffs) {
  if (typeof a === "number" && typeof b === "number") {
    const key = path.split(".").pop();
    if (FLOAT_TOL_KEYS.has(key) ? !close(a, b) : a !== b) {
      diffs.push(`${path}: ${a} vs ${b}`);
    }
    return;
  }
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") {
    if (a !== b) diffs.push(`${path}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
    return;
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) walk(a[k], b[k], path ? `${path}.${k}` : k, diffs);
}

export function compareGolden(fresh, golden) {
  const diffs = [];
  walk(fresh, golden, "", diffs);
  return { pass: diffs.length === 0, diffs };
}
