// Diff a fresh gen_golden output against golden_v5.4.0.json, stripping the six
// v6.0-Phase-2 additive raw-stat fields (all zero for legacy modes except
// bypassViaCloud == surfaceBypassUp) plus generation timestamps/appVersion.
import { readFileSync } from "node:fs";

const NEW_FIELDS = ["bypassClearDirect", "bypassViaCloud", "transmittedClearDirect",
                    "surfaceReflectedClearDirect", "absorbedCloudIncident", "absorbedClearRecycled",
                    // Phase 4 additive first-hit tallies:
                    "launchedCloudTop", "launchedCloudWall", "launchedClear"];

function normalize(obj) {
  const o = JSON.parse(JSON.stringify(obj));
  delete o.generated; delete o.appVersion;
  for (const r of o.results) {
    for (const f of NEW_FIELDS) {
      if (f in r.rawStats) {
        // sanity: additive fields must be zero for legacy modes, except
        // bypassViaCloud which must equal surfaceBypassUp
        if (f === "bypassViaCloud") {
          if (r.rawStats[f] !== r.rawStats.surfaceBypassUp)
            console.error(`MISMATCH: ${r.illum}/${r.theta0_deg}/${r.As}: bypassViaCloud ${r.rawStats[f]} != surfaceBypassUp ${r.rawStats.surfaceBypassUp}`);
        } else if (f === "launchedCloudTop") {
          // Legacy modes: top + wall must sum to launched (wall > 0 only for
          // top_side at theta0 > 0); launchedClear must be 0 (else branch).
          if (r.rawStats.launchedCloudTop + r.rawStats.launchedCloudWall !== r.rawStats.launched)
            console.error(`MISMATCH: ${r.illum}/${r.theta0_deg}/${r.As}: top+wall != launched`);
        } else if (f === "launchedCloudWall") {
          // checked via launchedCloudTop above; nonzero is expected for top_side
        } else if (r.rawStats[f] !== 0) {
          console.error(`NONZERO additive field ${f}=${r.rawStats[f]} in ${r.illum}/${r.theta0_deg}/${r.As}`);
        }
        delete r.rawStats[f];
      }
    }
  }
  return o;
}

const a = normalize(JSON.parse(readFileSync(process.argv[2], "utf8")));
const b = normalize(JSON.parse(readFileSync(process.argv[3], "utf8")));
const sa = JSON.stringify(a), sb = JSON.stringify(b);
if (sa === sb) { console.log("EXACT MATCH (after stripping additive fields):", a.results.length, "rows"); }
else {
  console.log("DIFFER. Row-by-row scan:");
  for (let i = 0; i < Math.max(a.results.length, b.results.length); i++) {
    const ra = JSON.stringify(a.results[i]), rb = JSON.stringify(b.results[i]);
    if (ra !== rb) { console.log("row", i, a.results[i]?.illum, a.results[i]?.theta0_deg, a.results[i]?.As, a.results[i]?.obsGeom); }
  }
}
