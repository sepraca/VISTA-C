// diff_golden_rows.mjs — generic row-by-row field diff between two golden
// snapshot files (any of the gen_golden*.mjs outputs: same `results` array
// schema). Prints every differing field per row, with values from both files,
// so the MAGNITUDE of a divergence is visible — not just its existence
// (check_golden_*.mjs answer "identical or not?"; this answers "how different,
// and where?"). Added 2026-07-19 while diagnosing a Node/V8-version
// bit-reproducibility difference confined to the longest-trajectory periodic
// rows (Θ₀=60°, Aₛ=1) — see golden_periodic_snapshot_v6.0-phase3.md.
//
// Usage (from repo root):
//   node tests/review-harness/diff_golden_rows.mjs <fileA> <fileB>
// e.g.
//   node tests/golden-snapshots/gen_golden_periodic.mjs > /tmp/gper_mac.json
//   node tests/review-harness/diff_golden_rows.mjs /tmp/gper_mac.json \
//        tests/golden-snapshots/golden_periodic_v6.0-phase3.json

import { readFileSync } from "node:fs";

const [fa, fb] = process.argv.slice(2);
if (!fa || !fb) {
  console.error("usage: node diff_golden_rows.mjs <fileA> <fileB>");
  process.exit(1);
}
const A = JSON.parse(readFileSync(fa, "utf8"));
const B = JSON.parse(readFileSync(fb, "utf8"));

const rowKey = r =>
  `M=${r.M ?? "-"} illum=${r.illum ?? "-"} th0=${r.theta0_deg} As=${r.As} ${r.obsGeom}`;

let diffRows = 0, diffFields = 0;
const n = Math.max(A.results.length, B.results.length);
for (let i = 0; i < n; i++) {
  const ra = A.results[i], rb = B.results[i];
  if (!ra || !rb) { console.log(`row ${i}: present in only one file`); diffRows++; continue; }
  const lines = [];
  const cmp = (label, va, vb) => {
    if (JSON.stringify(va) !== JSON.stringify(vb)) {
      const delta = (typeof va === "number" && typeof vb === "number")
        ? `  (A-B = ${va - vb})` : "";
      lines.push(`   ${label}: A=${JSON.stringify(va)}  B=${JSON.stringify(vb)}${delta}`);
    }
  };
  for (const k of new Set([...Object.keys(ra), ...Object.keys(rb)])) {
    if (k === "rawStats" || k === "domain") continue;
    cmp(k, ra[k], rb[k]);
  }
  for (const k of new Set([...Object.keys(ra.rawStats ?? {}), ...Object.keys(rb.rawStats ?? {})])) {
    cmp(`rawStats.${k}`, ra.rawStats?.[k], rb.rawStats?.[k]);
  }
  if (ra.domain || rb.domain) {
    for (const k of ["R_domain_count", "T_domain_count", "A_cloud_count", "cloud_fraction"]) {
      cmp(`domain.${k}`, ra.domain?.[k], rb.domain?.[k]);
    }
  }
  if (lines.length) {
    diffRows++; diffFields += lines.length;
    console.log(`row ${i}: ${rowKey(ra)} — ${lines.length} differing fields`);
    for (const L of lines) console.log(L);
  }
}
console.log(diffRows === 0
  ? `\nIDENTICAL: all ${n} rows match field-for-field.`
  : `\n${diffRows} differing rows, ${diffFields} differing fields total (of ${n} rows).`);
