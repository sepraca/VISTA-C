// gen_export_roundtrip.mjs — Generate a REAL schema-1.2 JSON export in Node by
// driving the actual Export.getExportDataObject() pipeline (no browser), for
// round-trip testing against mc_export_reader.py (review E4/E8).
//   node tests/review-harness/gen_export_roundtrip.mjs > /tmp/ud_export.json
//   python3 mc_export_reader.py /tmp/ud_export.json
// Defaults produce a Uniform-domain run: M=4, Θ₀=60°, Aₛ=0.5, N=200,000,
// seed 42. Legacy round-trip: pass "top" (or "center"/"top_side") as argv[2].

const MODE = process.argv[2] ?? "uniform_domain";
const N = 200000;

// DOM stub: expose every input the exporter's UI getters read, with values
// matching the simulation parameters below, so inputs in the JSON are truthful.
const domValues = {
  observationGeometry: "top-base_faces",
  photonEntry: MODE,
  theta0: "60", surfaceAlbedo: "0.5", tauCloud: "10", hExtent: "40",
  gValue: "0.85", omega0: "1.0", cloudBetaExt: "10.0", surfaceDistanceKm: "0.5",
  domainFactor: "4", photonCount: String(N)
};
globalThis.document = {
  getElementById(id) {
    if (id in domValues) return { value: domValues[id], checked: false };
    return null;
  }
};
globalThis.window = { devicePixelRatio: 2 };

const BASE = new URL("../../js/", import.meta.url).href;
const { RNG } = await import(`${BASE}rng.js`);
const { Physics } = await import(`${BASE}physics.js`);
const { SimStats } = await import(`${BASE}simstats.js`);
const { Export } = await import(`${BASE}exportUtils.js`);

const params = {
  tauCloud: 10, slabW: 40, slabD: 40,
  theta0: 60 * Math.PI / 180,
  g: 0.85, omega0: 1.0,
  surfaceAlbedo: 0.5, betaExt: 10.0, surfaceDistanceKm: 0.5,
  entryMode: MODE, domainFactor: 4
};

RNG.reset(42);
SimStats.reset();
for (let i = 0; i < N; i++) {
  const r = Physics.simulatePhoton(params, false);
  SimStats.record(r);
  for (const t of r.cloudBaseTransmissions) SimStats.registerCloudBaseTransmission(t);
  for (const e of r.surfaceEvents)          SimStats.registerSurfaceEvent(e);
  for (const d of r.surfaceReflectionDirs)  SimStats.registerSurfaceReflection(d);
}

console.log(JSON.stringify(Export.getExportDataObject(), null, 2));
