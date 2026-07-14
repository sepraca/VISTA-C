// Golden-snapshot generator for the v6.0 "Uniform domain" illumination mode
// under the PERIODIC domain boundary (Phase 3). Companion to gen_golden_ud.mjs
// (which locks the open-boundary case) -- same matrix and row schema, plus
// the Phase-3 additive `wrapCapped` raw-stat field, so the periodic transport
// path can be regression-checked bit-for-bit going forward.
//
// Usage (from repo root):
//   node tests/golden-snapshots/gen_golden_periodic.mjs > /tmp/golden_periodic_new.json
//   diff /tmp/golden_periodic_new.json tests/golden-snapshots/golden_periodic_v6.0-phase3.json
// (after stripping the "generated" timestamp line -- or use check_golden_periodic.mjs).
//
// Matrix: uniform_domain x M in {1,2,4} x theta0 in {0,60} deg x A_s in
// {0, 0.5, 1.0} = 18 runs x 500,000 photons, seed 42, domainBoundary=periodic;
// each run reported under both Observation geometries (36 rows) plus the
// geometry-independent domain block. Gate assertions embedded per run (see
// CODE-REVIEW-v6.0-handoff.md P4 / TODO "Phase 3"): S(all_faces) ==
// surfaceBypassUp exactly; terminal sideEscapeDown === 0; wrapCapped === 0 at
// this N; R_domain+T_domain+A_cloud == launched.

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

const M_VALUES = [1, 2, 4];
const THETA0_DEG = [0, 60];
const AS_VALUES = [0.0, 0.5, 1.0];
const OBS_GEOMS = [
  ["top-base_faces", "Cloud top/base faces only"],
  ["all_faces",      "Cloud top/base/side faces"]
];
const N_PHOTONS = 500000;
const SEED = 42;

const FIXED = { tauCloud: 10, slabW: 40, slabD: 40, g: 0.85, omega0: 1.0,
                betaExt: 10.0, surfaceDistanceKm: 0.5, entryMode: "uniform_domain",
                domainBoundary: "periodic" };

const results = [];
const t0 = Date.now();

for (const M of M_VALUES) {
  for (const th0 of THETA0_DEG) {
    for (const As of AS_VALUES) {
      RNG.reset(SEED);
      SimStats.reset();
      const params = { ...FIXED, theta0: th0 * Math.PI / 180, surfaceAlbedo: As, domainFactor: M };
      for (let i = 0; i < N_PHOTONS; i++) {
        const r = Physics.simulatePhoton(params, false);
        SimStats.record(r);
        for (const t of r.cloudBaseTransmissions) SimStats.registerCloudBaseTransmission(t);
        for (const e of r.surfaceEvents)          SimStats.registerSurfaceEvent(e);
        for (const d of r.surfaceReflectionDirs)  SimStats.registerSurfaceReflection(d);
      }
      const s = SimStats.stats;
      const launched = Math.max(s.launched, 1);

      const rc = SimStats.rComponents();
      const tc = SimStats.tComponents();
      const ac = SimStats.aComponents();
      const RdCount = SimStats.domainReflectedCount();
      const TdCount = SimStats.domainTransmittedNetCount();
      const AdCount = SimStats.domainAbsorbedCount();
      const domain = {
        M, cloud_fraction: 1 / (M * M),
        R_domain_count: RdCount, R_domain: RdCount / launched,
        T_domain_count: TdCount, T_domain: TdCount / launched,
        A_cloud_count: AdCount,  A_cloud: AdCount / launched,
        closure_R_T_Acloud: (RdCount + TdCount + AdCount) / launched,
        R_components: { ...rc },
        T_components: { viaBase: tc.viaBase, viaSide: tc.viaSide, clearDirect: tc.clearDirect },
        A_components: { ...ac },
        checks: {
          rComponentsSumOk: rc.cloudTop + rc.cloudSide + rc.clearDirect + rc.clearViaCloud === RdCount,
          tComponentsSumOk: tc.viaBase + tc.viaSide + tc.clearDirect === TdCount,
          aComponentsSumOk: ac.cloudIncident + ac.clearRecycled === AdCount,
          bypassSplitOk: s.bypassClearDirect + s.bypassViaCloud === s.surfaceBypassUp,
          // Phase-3-specific gates (CODE-REVIEW P4 / TODO "Phase 3"):
          // R_domain/T_domain/A_cloud only resolve for photons that reach a
          // genuine terminal outcome -- MAX_EVENTS- or MAX_WRAPS-capped
          // photons (both folded into stats.terminated) never do, exactly
          // like the existing FINAL OUTCOMES identity R+T+A+S+Term=1 already
          // accounts for Term. Expect a handful of wrapCapped at the
          // tightest tiling (M=1) -- the 1e-5ish grazing tail CODE-REVIEW P4
          // predicted, worse at small M since tile walls sit closer together.
          budgetClosesExactly: (RdCount + TdCount + AdCount + s.terminated) === launched,
          terminalSideEscapeDownIsZero: s.sideEscapeDown === 0,
          wrapCappedNegligible: s.wrapCapped / launched < 0.001
        }
      };

      const EdownSfc = s.transmitted / launched;
      const EupSfc = s.surfaceReflected / launched;

      for (const [key, label] of OBS_GEOMS) {
        domValues.observationGeometry = key;
        const Rcount = SimStats.reflectedCount();
        const Tcount = SimStats.transmittedNetCount();
        const Scount = SimStats.sideExitCount();
        const Acloud = s.absorbed / launched;
        const Rfrac = Rcount / launched, Tfrac = Tcount / launched, Sfrac = Scount / launched;
        const Tterm = s.terminated / launched;
        results.push({
          illum: "uniform_domain", M, theta0_deg: th0, As, obsGeom: key, obsGeomLabel: label,
          seed: SEED, N: N_PHOTONS,
          rawStats: { ...s },
          Rcount, Rfrac, Tcount, Tfrac, Acloud_count: s.absorbed, Acloud,
          Scount, Sfrac, Tterm_count: s.terminated, Tterm,
          closure: Rfrac + Tfrac + Acloud + Sfrac + Tterm,
          EdownSfc, EupSfc, netSfcAbs: EdownSfc - EupSfc,
          netSfcAbsCount: s.transmitted - s.surfaceReflected,
          meanScat: s.totalScatterings / launched, meanPath: s.totalPath / launched,
          domain,
          // S(all_faces) == surfaceBypassUp is a Phase-3 gate too (P4) --
          // embed the check directly on the row it applies to.
          sAllFacesEqSurfaceBypassCheck: key === "all_faces" ? (Scount === s.surfaceBypassUp) : null
        });
      }
    }
  }
}

console.error("Total time (ms):", Date.now() - t0, "| runs:", M_VALUES.length * THETA0_DEG.length * AS_VALUES.length);
console.log(JSON.stringify({
  generated: new Date().toISOString(),
  appVersion: "6.0.0-dev (post-Phase-3; periodic boundary)",
  seed: SEED, N_photons: N_PHOTONS, fixedParams: FIXED, results
}, null, 2));
