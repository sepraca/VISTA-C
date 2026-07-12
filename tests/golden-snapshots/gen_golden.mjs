// Golden-snapshot generator for v5.4.0 legacy Illumination x Observation geometries.
// Imports the REAL app modules directly (no browser) so the pipeline exactly
// matches runControl.js's simulation loop. Minimal DOM stub only supports what
// record()/register*()/combiner methods actually touch.

const domValues = { observationGeometry: "top-base_faces" };
globalThis.document = {
  getElementById(id) {
    if (id in domValues) return { value: domValues[id], checked: false };
    return null; // footprintGrid, stats, limitWarning, etc. -> safe fallbacks
  }
};

// Portable import path (relative to this file), so the harness runs on any
// machine/checkout — an earlier version hardcoded an absolute path from a
// specific dev sandbox and silently broke everywhere else (review finding E6).
const BASE = new URL("../../js/", import.meta.url).href;
const { RNG } = await import(`${BASE}rng.js`);
const { Physics } = await import(`${BASE}physics.js`);
const { SimStats } = await import(`${BASE}simstats.js`);

const ILLUM_MODES = ["center", "top", "top_side"];
const THETA0_DEG = [0, 60];
const AS_VALUES = [0.0, 0.5, 1.0];
const OBS_GEOMS = [
  ["top-base_faces", "Cloud top/base faces only"],
  ["all_faces",       "Cloud top/base/side faces"],
  ["scene",            "Entire scene"]
];
const N_PHOTONS = 500000;
const SEED = 42;

const FIXED = { tauCloud: 10, slabW: 40, slabD: 40, g: 0.85, omega0: 1.0,
                 betaExt: 10.0, surfaceDistanceKm: 0.5 };

const results = [];
const t0 = Date.now();

for (const mode of ILLUM_MODES) {
  for (const th0 of THETA0_DEG) {
    for (const As of AS_VALUES) {
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
      const netSfcAbs = EdownSfc - EupSfc;
      const netSfcAbsCount = s.transmitted - s.surfaceReflected;
      const meanScat = s.totalScatterings / launched;
      const meanPath = s.totalPath / launched;

      for (const [key, label] of OBS_GEOMS) {
        domValues.observationGeometry = key;
        const Rcount = SimStats.reflectedCount();
        const Tcount = SimStats.transmittedNetCount();
        const Scount = SimStats.sideExitCount();
        const Acloud = s.absorbed / launched;
        const Rfrac = Rcount / launched, Tfrac = Tcount / launched, Sfrac = Scount / launched;
        const Tterm = s.terminated / launched;
        const closure = Rfrac + Tfrac + Acloud + Sfrac + Tterm;
        results.push({
          illum: mode, theta0_deg: th0, As, obsGeom: key, obsGeomLabel: label,
          seed: SEED, N: N_PHOTONS,
          rawStats: { ...s },
          Rcount, Rfrac, Tcount, Tfrac, Acloud_count: s.absorbed, Acloud,
          Scount, Sfrac, Tterm_count: s.terminated, Tterm, closure,
          EdownSfc, EupSfc, netSfcAbs, netSfcAbsCount,
          meanScat, meanPath
        });
      }
    }
  }
}

console.error("Total time (ms):", Date.now() - t0, "| runs:", ILLUM_MODES.length*THETA0_DEG.length*AS_VALUES.length);
console.log(JSON.stringify({ generated: new Date().toISOString(), appVersion: "5.4.0", seed: SEED, N_photons: N_PHOTONS, fixedParams: FIXED, results }, null, 2));
