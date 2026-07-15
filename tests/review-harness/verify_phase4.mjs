// verify_phase4.mjs — gates for the Phase 4 rigorous BRF/BTF normalization
// (and, later sections, the sub-cloud observation pixel). Run from repo root:
//   node tests/review-harness/verify_phase4.mjs
// Uses the real modules; world defaults (tauCloud=10, slabW=40) match params.

const domValues = { observationGeometry: "top-base_faces" };
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
const { BottomPanel } = await import(`${BASE}bottomPanel.js`);

let fails = 0;
const check = (name, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) fails++; };

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
const P0 = { tauCloud: 10, slabW: 40, slabD: 40, g: 0.85, omega0: 1.0,
             betaExt: 10.0, surfaceDistanceKm: 0.5 };
const gridVals = g => g.bdf.flat();
const eq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

// ---- Gate 1: A_proj collapses to exactly 1 (W²) at nadir & for any mu=1 ----
check("aProjOverTop(mu=1, any phi) === 1",
      [0, 0.7, 2.1].every(p => SimStats.aProjOverTop(1, p) === 1));
// and the analytic value at 45°: 1 + 0.25·1·(|cos φ|+|sin φ|)
const a45 = SimStats.aProjOverTop(Math.SQRT1_2, 0);
check("aProjOverTop(45°, φ=0) === 1.25 (τ/W=0.25)", Math.abs(a45 - 1.25) < 1e-12);

// ---- Gate 2: legacy top + top-base obs — BRF ≡ historical BDF exactly ----
run({ ...P0, theta0: 60 * Math.PI / 180, surfaceAlbedo: 0.5, entryMode: "top" }, 200000);
domValues.observationGeometry = "top-base_faces";
{
  const w = SimStats.reflectedBdfWeights();
  const old = BottomPanel.computeBdfGrid(w);                                  // N-normalized
  const brf = BottomPanel.computeBdfGrid(w, { nRef: SimStats.nTopIncident(), sidesIncluded: SimStats._sidesIncluded() });
  check("legacy top, top-base obs: BRF grid bit-identical to historical BDF",
        SimStats.nTopIncident() === SimStats.stats.launched && eq(gridVals(old), gridVals(brf)));
}

// ---- Gate 3: all_faces obs — BRF = BDF/aProj per bin (spot check) ----
domValues.observationGeometry = "all_faces";
{
  const w = SimStats.reflectedBdfWeights();
  const old = BottomPanel.computeBdfGrid(w);
  const brf = BottomPanel.computeBdfGrid(w, { nRef: SimStats.nTopIncident(), sidesIncluded: true });
  let ok = true;
  for (const ir of [3, 10, 17]) for (const ip of [0, 18, 45]) {
    const info = old.binInfo[ir][ip];
    const expect = old.bdf[ir][ip] / SimStats.aProjOverTop(info.mu, ip * (2 * Math.PI / 72));
    if (Math.abs(brf.bdf[ir][ip] - expect) > 1e-12 * Math.max(1, expect)) ok = false;
  }
  check("all_faces obs: BRF = BDF / (A_proj/W²) per bin", ok);
}

// ---- Gate 4: top_side — N_top realized ≈ N(1−p_side); BRF = BDF·N/N_top ----
run({ ...P0, theta0: 60 * Math.PI / 180, surfaceAlbedo: 0.5, entryMode: "top_side" }, 200000);
domValues.observationGeometry = "top-base_faces";
{
  const s = SimStats.stats;
  const pSide = (10 * Math.sin(Math.PI / 3)) / (40 * Math.cos(Math.PI / 3) + 10 * Math.sin(Math.PI / 3));
  const expTop = s.launched * (1 - pSide);
  check(`top_side: N_top=${s.launchedCloudTop} ≈ N(1−p_side)=${expTop.toFixed(0)} (<4σ)`,
        Math.abs(s.launchedCloudTop - expTop) < 4 * Math.sqrt(s.launched * pSide * (1 - pSide)));
  check("top_side: top+wall+clear === launched",
        s.launchedCloudTop + s.launchedCloudWall + s.launchedClear === s.launched);
}

// ---- Gate 5: UD M=1 ≡ legacy top — identical N_top and identical BRF ----
// 2026-07 correction: this equivalence only holds when theta0=0. It used to
// also hold at theta0=60 (tested here originally) because the pre-fix
// sampleEntryPoint's uniform_domain branch sampled x over exactly
// [-halfW*M, +halfW*M] with no further adjustment -- at M=1 that window IS
// the cloud's own top face, so every launch landed exactly on the box and
// the clear/wall resolution branch in simulatePhoton was never reached,
// reproducing legacy "top" bit-for-bit at ANY theta0. The sunward
// ground-illumination-asymmetry fix (see TODO-direct-surface-illumination.md,
// "Sunward ground-illumination asymmetry / TOA-altitude coupling", and
// CHANGELOG [Unreleased]) extends that window's sunward bound by
// (tauCloud + betaExt*surfaceDistanceKm)*tan(theta0), UNCONDITIONALLY,
// regardless of M -- so at theta0=60, M=1 now launches ~40% of photons
// outside the cloud's own footprint (verified directly), genuinely differing
// from legacy "top". This is expected and correct post-fix: M=1 combined
// with theta0>0 is exactly the "M below the corrected M_min" case the fix
// targets (M_min(60deg) here is ~2.3, well above 1), which the UI's
// getEffectiveDomainFactor() auto-clamp now raises before a real run ever
// reaches physics.js -- this harness calls Physics.simulatePhoton directly,
// bypassing that clamp, so it can (correctly) observe the raw physics
// diverging here. Same category of correction as the earlier
// "M=1 reproduces top+side" gate fix in TODO's "core knob" section -- an
// invariant that was true only under an earlier, incomplete physics
// understanding. Testing at theta0=0 instead: margin = 0 there
// (tan(0)=0), so the window is unchanged from the pre-fix formula and the
// equivalence still holds exactly, unaffected by the fix.
run({ ...P0, theta0: 0, surfaceAlbedo: 0.5, entryMode: "top" }, 200000);
const topBrf = gridVals(BottomPanel.computeBdfGrid(SimStats.reflectedBdfWeights(),
               { nRef: SimStats.nTopIncident(), sidesIncluded: false }));
const topNtop = SimStats.nTopIncident();
run({ ...P0, theta0: 0, surfaceAlbedo: 0.5, entryMode: "uniform_domain", domainFactor: 1 }, 200000);
const udBrf = gridVals(BottomPanel.computeBdfGrid(SimStats.reflectedBdfWeights(),
              { nRef: SimStats.nTopIncident(), sidesIncluded: false }));
check("UD M=1 ≡ legacy top at theta0=0 (margin=0): N_top identical and BRF grid bit-identical",
      SimStats.nTopIncident() === topNtop && eq(topBrf, udBrf));

// ---- Gate 6: the anticipated physics — UD M=4, Θ₀=0, Aₛ=0.5 BRF exceeds
// uniform-top BRF by the ~1.41× surface-recycling brightening (dilution gone) ----
run({ ...P0, theta0: 0, surfaceAlbedo: 0.5, entryMode: "top" }, 400000);
const t = BottomPanel.computeBdfGrid(SimStats.reflectedBdfWeights(), { nRef: SimStats.nTopIncident() });
const tMid = t.bdf.slice(4, 13).flat().reduce((a, b) => a + b) / (9 * 72);
run({ ...P0, theta0: 0, surfaceAlbedo: 0.5, entryMode: "uniform_domain", domainFactor: 4 }, 400000);
const u = BottomPanel.computeBdfGrid(SimStats.reflectedBdfWeights(), { nRef: SimStats.nTopIncident() });
const uMid = u.bdf.slice(4, 13).flat().reduce((a, b) => a + b) / (9 * 72);
const enh = uMid / tMid;
check(`UD M=4 vs top (Θ₀=0, Aₛ=0.5): BRF enhancement ${enh.toFixed(3)} in [1.30, 1.55]`,
      enh > 1.30 && enh < 1.55);

// ---- Gate 7: pixel f_pix = 1 — pixel arrays bit-identical to full arrays ----
domValues.pixelFraction = "1.0";
run({ ...P0, theta0: 60 * Math.PI / 180, surfaceAlbedo: 0.5, entryMode: "top" }, 200000);
check("f_pix=1: muReflPixelBins ≡ muReflBins (bit-identical)",
      eq(Array.from(SimStats.muReflPixelBins), Array.from(SimStats.muReflBins)));
check("f_pix=1: bdfReflPixelWeights ≡ bdfReflWeights (bit-identical)",
      eq(Array.from(SimStats.bdfReflPixelWeights), Array.from(SimStats.bdfReflWeights)));

// ---- Gate 8: pixel f_pix = 0.5 — counts subset, N_pixel scaling, BRF sane ----
domValues.pixelFraction = "0.5";
run({ ...P0, theta0: 0, surfaceAlbedo: 0.0, entryMode: "top" }, 400000);
{
  const s = SimStats.stats;
  const nPix = SimStats.nPixelIncident();
  const cnt = SimStats.pixelReflectedCount();
  check(`f_pix=0.5: N_pixel = N_top·0.25 exactly (${nPix} vs ${s.launchedCloudTop * 0.25})`,
        Math.abs(nPix - s.launchedCloudTop * 0.25) < 1e-9);
  check(`f_pix=0.5: pixel exits (${cnt}) < total reflected (${s.reflected})`,
        cnt > 0 && cnt < s.reflected);
  // Pixel BRF vs whole-face BRF at Θ₀=0, top illumination: the central pixel
  // excludes the dimmer edge region, so its BRF should be modestly HIGHER
  // than the face average -- but within a loose physical band.
  const full = BottomPanel.computeBdfGrid(SimStats.bdfReflWeights,  { nRef: SimStats.nTopIncident() });
  const pix  = BottomPanel.computeBdfGrid(SimStats.bdfReflPixelWeights, { nRef: nPix });
  const mid = g => g.bdf.slice(2, 12).flat().reduce((a, b) => a + b) / (10 * 72);
  const ratio = mid(pix) / mid(full);
  check(`f_pix=0.5 pixel BRF / whole-face BRF = ${ratio.toFixed(3)} in [1.00, 1.35] (center brighter than edges)`,
        ratio >= 1.0 && ratio <= 1.35);
}
domValues.pixelFraction = "1.0";

console.log(fails === 0 ? "\nALL PHASE-4 GATES PASS" : `\n${fails} FAILURES`);
process.exitCode = fails ? 1 : 0;
