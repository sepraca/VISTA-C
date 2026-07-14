// gen_export.mjs — parametrized JSON-export generator driving the REAL
// Export.getExportDataObject() pipeline in Node (no browser). Generalizes
// gen_export_roundtrip.mjs so the tests/Illumination comparisons exports can
// be regenerated from the current code at any version.
//
//   node gen_export.mjs <mode> <theta0_deg> <As> <obsGeom> [M] [N] [f_pix] [boundary] > out.json
//
//   mode     : center | top | top_side | uniform_domain
//   obsGeom  : top-base_faces | all_faces
//   M        : domain factor (uniform_domain only; default 4)
//   N        : photons (default 2000000, matching the historical test exports)
//   boundary : open | periodic (uniform_domain only; default open -- Phase 3)
// Seed is fixed at 42 (matching every reference export in tests/).

const [mode, th0s, Ass, obsGeom, Ms, Ns, fPixS, boundaryArg] = process.argv.slice(2);
if (!mode || !th0s || Ass === undefined || !obsGeom) {
  console.error("usage: node gen_export.mjs <mode> <theta0_deg> <As> <obsGeom> [M] [N] [f_pix] [boundary]");
  process.exit(1);
}
const th0 = Number(th0s), As = Number(Ass);
const M = Ms !== undefined ? Number(Ms) : 4;
const N = Ns !== undefined ? Number(Ns) : 2000000;
const boundary = boundaryArg ?? "open";

const domValues = {
  observationGeometry: obsGeom,
  photonEntry: mode,
  theta0: String(th0), surfaceAlbedo: String(As), tauCloud: "10", hExtent: "40",
  gValue: "0.85", omega0: "1.0", cloudBetaExt: "10.0", surfaceDistanceKm: "0.5",
  domainFactor: String(M), domainBoundary: boundary, photonCount: String(N),
  pixelFraction: fPixS ?? "1.0"
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
  theta0: th0 * Math.PI / 180,
  g: 0.85, omega0: 1.0,
  surfaceAlbedo: As, betaExt: 10.0, surfaceDistanceKm: 0.5,
  entryMode: mode, domainFactor: M, domainBoundary: boundary
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
