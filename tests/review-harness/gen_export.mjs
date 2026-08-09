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
const { state } = await import(`${BASE}state.js`);

// Optional Mie phase function (2026-07-27, C6-C). Env-driven so the positional
// CLI contract above is unchanged for every existing caller:
//   MIE_BAND=<1|2|6|7|20> MIE_REFF_UM=<micrometres> node gen_export.mjs ...
//   MIE_BAND=<1|2|6|7|20> MIE_REFF_INDEX=<index> node gen_export.mjs ...   (legacy)
//
// PREFER MIE_REFF_UM. An index is only meaningful against a particular r_eff grid: index 8
// is 10 µm in the 24-radius assets but 12 µm in the 18-radius operational HDF4 tables, which
// omit r_eff = 3, 11, 13, 15, 17, 19 µm. Selecting by value is grid-independent; selecting by
// index silently changes the droplet size when the asset set changes.
// Unset => Henyey-Greenstein with g below, exactly as before. Sets state.mie so
// Export.getExportDataObject() emits inputs.phase_function.type = "mie" with the
// band-averaged g / ω₀, and overlays the sampling CDF into the kernel params the
// same way runControl._applyMiePhaseParams does in the browser.
const mieBand = process.env.MIE_BAND ? parseInt(process.env.MIE_BAND, 10) : null;
// MIE_REFF_UM wins if both are set; resolved against the band's own cer_um grid below.
const mieReffUm = process.env.MIE_REFF_UM ? Number(process.env.MIE_REFF_UM) : null;
let mieK = process.env.MIE_REFF_INDEX ? parseInt(process.env.MIE_REFF_INDEX, 10) : 0;
let mieSel = null;
if (mieBand !== null) {
  const { readFileSync } = await import("node:fs");
  const DATA = new URL("../../data/mie/", import.meta.url);
  const load = (f) => JSON.parse(readFileSync(new URL(f, DATA)));
  const grid = load("mie_grid.json");
  const band = load(`mie_band_${mieBand}.json`);
  if (mieReffUm !== null) {
    const found = band.cer_um.findIndex(v => Math.abs(v - mieReffUm) < 1e-9);
    if (found < 0) {
      throw new Error(`MIE_REFF_UM=${mieReffUm} not in band ${mieBand} grid: ${band.cer_um}`);
    }
    mieK = found;
  }
  const WT = Float64Array.from(grid.wt);
  const XMU = Float64Array.from(grid.xmu);
  mieSel = {
    band: mieBand, reffIndex: mieK,
    cer: band.cer_um[mieK], ssa: band.ssa[mieK], g: band.g[mieK],
    // (mieK resolved from MIE_REFF_UM just above if that was supplied)
    wavelength_um: band.wavelength_um,
    cdf: Physics.buildMieCdf(Float64Array.from(band.pf[mieK]), WT),
    xmu: XMU
  };
  state.mie.active = true; state.mie.ready = true; state.mie.sel = mieSel;
}

// HG_G lets an HG control be run at a MATCHED asymmetry parameter (e.g. the
// band-averaged g of a Mie selection), so an HG-vs-Mie comparison isolates the
// phase-function SHAPE instead of confounding it with a different g.
const hgG = process.env.HG_G ? Number(process.env.HG_G) : 0.85;

// Keep the DOM shim in lockstep with the kernel params. Export.getExportDataObject()
// reads inputs.hg_g / inputs.ssa_omega0 via UI.getG()/getOmega0(), i.e. from the shim —
// NOT from `params` — so without this the file would record g=0.85 while the run
// actually used HG_G (or, under Mie, the band-averaged values the browser writes into
// those inputs). Mirrors runControl.onMieSelectionChange.
domValues.gValue = String(mieSel ? mieSel.g : hgG);
if (mieSel) domValues.omega0 = String(mieSel.ssa);

// TAU_CLOUD overrides the default optical depth (10). Optically thinner clouds keep
// low scattering orders dominant, so single-scattering angular structure (cloudbow,
// glory) survives instead of being washed out by multiple scattering.
const tauCloud = process.env.TAU_CLOUD ? Number(process.env.TAU_CLOUD) : 10;
domValues.tauCloud = String(tauCloud);

const params = {
  tauCloud, slabW: 40, slabD: 40,
  theta0: th0 * Math.PI / 180,
  g: mieSel ? mieSel.g : hgG,
  omega0: mieSel ? mieSel.ssa : 1.0,
  surfaceAlbedo: As, betaExt: 10.0, surfaceDistanceKm: 0.5,
  entryMode: mode, domainFactor: M, domainBoundary: boundary,
  ...(mieSel ? { mieCdf: mieSel.cdf, mieXmu: mieSel.xmu } : {})
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
