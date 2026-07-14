// golden_one.mjs — run ONE golden configuration (illum mode, theta0, As) and
// print its 3 observation-geometry rows as JSON (same row schema as
// gen_golden.mjs). Lets the 18-run golden suite be executed in separate
// processes/calls and aggregated, e.g. in time-limited environments.
//   node golden_one.mjs <mode> <theta0_deg> <As>
const [mode, th0s, Ass] = process.argv.slice(2);
const th0 = Number(th0s), As = Number(Ass);

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

const N_PHOTONS = 500000, SEED = 42;
const FIXED = { tauCloud: 10, slabW: 40, slabD: 40, g: 0.85, omega0: 1.0,
                betaExt: 10.0, surfaceDistanceKm: 0.5 };
// "scene" dropped (R6, CODE-REVIEW): dead observation-geometry option, removed
// from the UI pre-v6.0 and from the combiner logic in the R6 refactor. See the
// matching comment in gen_golden.mjs.
const OBS_GEOMS = [
  ["top-base_faces", "Cloud top/base faces only"],
  ["all_faces",       "Cloud top/base/side faces"]
];

RNG.reset(SEED);
SimStats.reset();
const params = { ...FIXED, theta0: th0 * Math.PI / 180, surfaceAlbedo: As, entryMode: mode };
for (let i = 0; i < N_PHOTONS; i++) {
  const r = Physics.simulatePhoton(params, false);
  SimStats.record(r);
  for (const t of r.cloudBaseTransmissions) SimStats.registerCloudBaseTransmission(t);
  for (const e of r.surfaceEvents)          SimStats.registerSurfaceEvent(e);
  for (const d of r.surfaceReflectionDirs)  SimStats.registerSurfaceReflection(d);
}
const s = SimStats.stats;
const launched = Math.max(s.launched, 1);
const EdownSfc = s.transmitted / launched;
const EupSfc = s.surfaceReflected / launched;
const rows = [];
for (const [key, label] of OBS_GEOMS) {
  domValues.observationGeometry = key;
  const Rcount = SimStats.reflectedCount();
  const Tcount = SimStats.transmittedNetCount();
  const Scount = SimStats.sideExitCount();
  const Acloud = s.absorbed / launched;
  const Rfrac = Rcount / launched, Tfrac = Tcount / launched, Sfrac = Scount / launched;
  const Tterm = s.terminated / launched;
  rows.push({
    illum: mode, theta0_deg: th0, As, obsGeom: key, obsGeomLabel: label,
    seed: SEED, N: N_PHOTONS,
    rawStats: { ...s },
    Rcount, Rfrac, Tcount, Tfrac, Acloud_count: s.absorbed, Acloud,
    Scount, Sfrac, Tterm_count: s.terminated, Tterm,
    closure: Rfrac + Tfrac + Acloud + Sfrac + Tterm,
    EdownSfc, EupSfc, netSfcAbs: EdownSfc - EupSfc,
    netSfcAbsCount: s.transmitted - s.surfaceReflected,
    meanScat: s.totalScatterings / launched, meanPath: s.totalPath / launched
  });
}
console.log(JSON.stringify(rows));
