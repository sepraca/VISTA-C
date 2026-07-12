// verify_review_findings.mjs — Node harness reproducing the numerical findings in
// CODE-REVIEW-v6.0-handoff.md (2026-07-12 review). Run from anywhere:
//   node tests/review-harness/verify_review_findings.mjs
// Imports the real app modules via a path relative to this file (portable —
// unlike gen_golden.mjs's hardcoded absolute path, see review finding E6).

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

function run(params, N, seed = 42) {
  RNG.reset(seed);
  SimStats.reset();
  for (let i = 0; i < N; i++) {
    const r = Physics.simulatePhoton(params, false);
    SimStats.record(r);
    for (const t of r.cloudBaseTransmissions) SimStats.registerCloudBaseTransmission(t);
    for (const e of r.surfaceEvents)          SimStats.registerSurfaceEvent(e);
    for (const d of r.surfaceReflectionDirs)  SimStats.registerSurfaceReflection(d);
  }
}

const sum = a => a.reduce((x, y) => x + y, 0);

// ---------- E1: mu-histogram N-label mismatch (uniform_domain + top-base_faces,
// entire-domain toggle off). The plotted bins are base-only under that dropdown,
// but the N label (transmittedNetCountCloudOnly) is viaBase + viaSide always. ----------
const P = { tauCloud: 10, slabW: 40, slabD: 40, g: 0.85, omega0: 1.0,
            betaExt: 10.0, surfaceDistanceKm: 0.5,
            theta0: 60 * Math.PI / 180, surfaceAlbedo: 0.5,
            entryMode: "uniform_domain", domainFactor: 2 };
run(P, 300000);

console.log("=== E1: N-label vs plotted-bin sum (uniform_domain, M=2, th0=60, As=0.5) ===");
for (const geom of ["top-base_faces", "all_faces"]) {
  domValues.observationGeometry = geom;
  const bins = SimStats.transmittedMuBinsCloudOnly();
  const label = SimStats.transmittedNetCountCloudOnly();
  const tc = SimStats.tComponents();
  console.log(`${geom}: sum(plotted bins)=${sum(Array.from(bins))}  N-label=${label}  (viaBase=${tc.viaBase}, viaSide=${tc.viaSide})`);
}
// PRE-FIX: mismatch under top-base_faces (22179 vs 35240 at these settings).
// POST-FIX (review E1): sums and labels must match under BOTH geometries.

// ---------- E3/E4: JSON export carries the raw (clear-direct-spiked) transmitted
// mu bins for uniform_domain runs, while the panel shows the cloud-only view. ----------
domValues.observationGeometry = "all_faces";
const rawBins = Array.from(SimStats.transmittedMuBins());        // what exportUtils exports
const cloudOnly = Array.from(SimStats.transmittedMuBinsCloudOnly()); // what the panel plots
console.log("\n=== E3/E4: exported transmittedMuBins vs panel cloud-only (all_faces) ===");
console.log("exported:", rawBins.map(Math.round).join(","));
console.log("panel   :", cloudOnly.map(Math.round).join(","));

// ---------- E5: at As=0 under uniform_domain, clear-direct photons terminate as
// "surface_absorbed" (the record() comment claiming that branch is unreachable at
// As=0 is stale), and the budget still closes. ----------
const P0 = { ...P, surfaceAlbedo: 0.0, domainFactor: 4, theta0: 0 };
run(P0, 100000);
const s = SimStats.stats;
domValues.observationGeometry = "top-base_faces";
const closure = (SimStats.reflectedCount() + SimStats.transmittedNetCount() +
                 s.absorbed + SimStats.sideExitCount() + s.terminated) / s.launched;
console.log("\n=== E5: As=0, uniform_domain, M=4, th0=0 ===");
console.log(`surfaceAbsorbed=${s.surfaceAbsorbed}  transmittedClearDirect=${s.transmittedClearDirect}  finalTransmitted=${s.finalTransmitted}  closure=${closure}`);

// ---------- E2: path-length bin_max — exported JSON vs on-screen panel.
// PRE-FIX this diverged (export used dropdown-segment means; the panel, since
// the 3.B fix, uses the genuine-population scale): e.g. 50 vs 40
// (uniform_domain) and 60 vs 50 (legacy "top") at these settings. POST-FIX
// (review E2/R2) both call SimStats.pathAxisMax(), so this drives the REAL
// export pipeline and must print equal values in both cases. ----------
globalThis.window = { devicePixelRatio: 2 };
const { Export } = await import(`${BASE}exportUtils.js`);
// exportUtils's UI getters need these inputs; values match the run parameters.
Object.assign(domValues, { photonEntry: "uniform_domain", theta0: "60",
  surfaceAlbedo: "0.5", tauCloud: "10", hExtent: "40", gValue: "0.85",
  omega0: "1.0", cloudBetaExt: "10.0", surfaceDistanceKm: "0.5", domainFactor: "2" });

run(P, 300000);
domValues.observationGeometry = "top-base_faces";
console.log("\n=== E2: path-length axis, export vs panel (must be equal post-fix) ===");
console.log(`uniform_domain (top-base_faces): export bin_max=${Export.getExportDataObject().path_length_histograms.bin_max}  panel bin_max=${SimStats.pathAxisMax()}`);

const PL = { ...P, entryMode: "top", domainFactor: 1 };
domValues.photonEntry = "top";
run(PL, 300000);
console.log(`legacy "top"  (top-base_faces): export bin_max=${Export.getExportDataObject().path_length_histograms.bin_max}  panel bin_max=${SimStats.pathAxisMax()}`);
