// Golden-snapshot generator for the v6.0 "Uniform domain" illumination mode
// (open boundary) — the pre-Phase-3 lock recommended by CODE-REVIEW-v6.0-handoff.md
// (P1). The legacy golden (gen_golden.mjs / golden_v5.4.0.json) covers only
// center/top/top_side; this one locks the entire v6.0 feature surface — the
// domain launch resolution, the touchedCloud/launchRegion flags, all six
// Phase-2 component counters, and the domain-wide R/T/A budget + component
// breakdowns — so Phase 3's open-boundary code path can be regression-checked
// bit-for-bit (periodic off) before/while the transport loop is touched.
//
// Usage (from repo root):
//   node tests/golden-snapshots/gen_golden_ud.mjs > /tmp/golden_ud_new.json
//   diff /tmp/golden_ud_new.json tests/golden-snapshots/golden_ud_v6.0-phase2.json
// (after stripping the "generated" timestamp line — or use jq/node; every other
// byte must match: same seed, deterministic RNG.)
//
// Matrix: uniform_domain x M in {1,2,4} x theta0 in {0,60} deg x A_s in
// {0, 0.5, 1.0} = 18 runs x 500,000 photons, seed 42; each run reported under
// both remaining Observation geometries (36 rows) plus the geometry-independent
// domain block. The M=1 rows at theta0=0 must reproduce the legacy "top" runs
// bit-for-bit (the Phase-1 gate, re-asserted as verify_phase4.mjs Gate 5).
//
// RAW-M KERNEL LOCK (deliberate, kept through the 2026-07-19 N2 redesign):
// this generator passes M straight to Physics.simulatePhoton, bypassing the
// app's UI.getEffectiveDomainFactor() auto-clamp. Rows with M < M_min(th0) =
// 1 + 2s/W (at th0=60 here: M=1 and M=2, M_min = 2.299) therefore capture
// clamp-bypassed physics -- the upwind-shifted launch window misses part of
// the leeward cloud top, exactly the configuration the app prevents. That is
// the point: the snapshot locks the KERNEL's raw behavior; app-level policy
// is tested separately (ui.js clamp + verify_phase3 Gate 6).

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
                betaExt: 10.0, surfaceDistanceKm: 0.5, entryMode: "uniform_domain" };

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

      // Geometry-independent domain block (the "scene"-combiner math applied
      // unconditionally) + component breakdowns. These are the v6.0 quantities
      // the legacy golden never covered.
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
        // T components carry float-exact net counts (arrivals - reflections)
        T_components: { viaBase: tc.viaBase, viaSide: tc.viaSide, clearDirect: tc.clearDirect },
        A_components: { ...ac },
        // Internal-consistency identities (must hold exactly, every run):
        checks: {
          rComponentsSumOk: rc.cloudTop + rc.cloudSide + rc.clearDirect + rc.clearViaCloud === RdCount,
          tComponentsSumOk: tc.viaBase + tc.viaSide + tc.clearDirect === TdCount,
          aComponentsSumOk: ac.cloudIncident + ac.clearRecycled === AdCount,
          bypassSplitOk: s.bypassClearDirect + s.bypassViaCloud === s.surfaceBypassUp
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
        // Path-length histogram (review B, 2026-07-21) — see gen_golden.mjs for
        // the rationale; UD exercises the clear-direct zero-path spike, the
        // edge case most likely to hide a binning bug.
        const _nm = SimStats.pathAxisMax();
        const pathHist = {
          bin_max: _nm,
          reflected_counts: SimStats.pathHistogramCounts(SimStats.reflectedPathSegments(), _nm),
          net_transmitted_counts: SimStats.pathHistogramCounts(SimStats.transmittedPathSegments(), _nm)
        };
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
          domain, pathHist
        });
      }
    }
  }
}

console.error("Total time (ms):", Date.now() - t0, "| runs:", M_VALUES.length * THETA0_DEG.length * AS_VALUES.length);
console.log(JSON.stringify({
  generated: new Date().toISOString(),
  appVersion: "6.0.0-dev (post-Phase-2, post-2026-07-12-review; open boundary)",
  seed: SEED, N_photons: N_PHOTONS, fixedParams: FIXED, results
}, null, 2));
