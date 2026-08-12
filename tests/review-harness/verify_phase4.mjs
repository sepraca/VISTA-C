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
const { SimStats, BDF_MU_BINS, BDF_PHI_BINS } = await import(`${BASE}simstats.js`);
const { BottomPanel } = await import(`${BASE}bottomPanel.js`);
// Never hardcode the BDF grid shape here — it changed 19θ×72φ (uniform θ) →
// 45µ×120φ (uniform µ) on 2026-07-27 and silently broke Gate 3's azimuth.
const NPHI = BDF_PHI_BINS;

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
    const expect = old.bdf[ir][ip] / SimStats.aProjOverTop(info.mu, ip * (2 * Math.PI / NPHI));
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
// This equivalence only holds at theta0=0. Under the N2 ground-domain
// design (2026-07-19; and equally under the pre-N2 extension it replaced),
// the open-boundary launch window at theta0>0 is the M*W domain translated
// upwind by s = (tauCloud + betaExt*surfaceDistanceKm)*tan(theta0) -- at
// M=1 that shifted window no longer coincides with the cloud's top face, so
// launches genuinely differ from legacy "top". That is the raw kernel
// behavior at M below M_min = 1 + 2s/W (~2.3 at these params), which the
// UI's getEffectiveDomainFactor() auto-clamp raises before any real run
// reaches physics.js; this harness calls Physics.simulatePhoton directly,
// bypassing the clamp, so it can (correctly) observe the divergence. At
// theta0=0, s=0 (tan 0 = 0): the window is exactly the cloud top face and
// the equivalence holds bit-for-bit -- tested there.
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
const tMid = t.bdf.slice(4, 13).flat().reduce((a, b) => a + b) / (9 * NPHI);
run({ ...P0, theta0: 0, surfaceAlbedo: 0.5, entryMode: "uniform_domain", domainFactor: 4 }, 400000);
const u = BottomPanel.computeBdfGrid(SimStats.reflectedBdfWeights(), { nRef: SimStats.nTopIncident() });
const uMid = u.bdf.slice(4, 13).flat().reduce((a, b) => a + b) / (9 * NPHI);
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
  const mid = g => g.bdf.slice(2, 12).flat().reduce((a, b) => a + b) / (10 * NPHI);
  const ratio = mid(pix) / mid(full);
  check(`f_pix=0.5 pixel BRF / whole-face BRF = ${ratio.toFixed(3)} in [1.00, 1.35] (center brighter than edges)`,
        ratio >= 1.0 && ratio <= 1.35);
}
domValues.pixelFraction = "1.0";

// ---- Gate: principal-plane folding is DISPLAY-ONLY and behaves (v6.4) -------------
//
// WHY A GATE. Folding is a one-line temptation to "clean up" the accumulator. If it ever
// migrates there, verify_rng.mjs Gate 5 goes to zero BY CONSTRUCTION and the project loses
// the only test sensitive to the RNG state-overflow bug class (that gate read chi2
// 0.99 -> 11.5 between 3M and 12M photons while every physics gate still passed).
//
// These checks are on the HELPERS, not on a rendered panel: they assert the properties the
// display path relies on, and that the diagnostic can actually FAIL (an artifact-free test
// is not a test -- see the analytic <mu>=g gate that passed an entire sampler rewrite).
{
  const { SimStats, BDF_MU_BINS: nT, BDF_PHI_BINS: nP } =
        await import(new URL("../../js/simstats.js", import.meta.url));

  let sd = 987654321;
  const u = () => ((sd = (1103515245 * sd + 12345) & 0x7fffffff) / 0x7fffffff);
  const gauss = () => { const a = Math.max(u(), 1e-12), b = u();
                        return Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * b); };
  const pois = m => Math.max(0, Math.round(m + Math.sqrt(m) * gauss()));
  const mk = f => { const w = new Float64Array(nT * nP);
    for (let ir = 0; ir < nT; ir++) for (let ip = 0; ip < nP; ip++) w[ir * nP + ip] = pois(f(ir, ip));
    return w; };

  const base = (ir, ip) => 200 + 50 * Math.cos(2 * Math.PI * ip / nP);   // symmetric in phi
  const A = mk(base);
  const c2A = SimStats.bdfMirrorChi2(A);
  check(`mirror chi2 ~ 1 on a symmetric field (got ${c2A.toFixed(3)})`, c2A > 0.75 && c2A < 1.35);

  // The statistic MUST be able to fail, or it is not a diagnostic.
  const B = mk((ir, ip) => base(ir, ip) + (ip < nP / 2 ? 12 : 0));
  const c2B = SimStats.bdfMirrorChi2(B);
  check(`mirror chi2 RISES on an injected asymmetry (${c2A.toFixed(2)} -> ${c2B.toFixed(2)})`,
        c2B > c2A + 0.2);

  // Fold: unbiased (total preserved), pairs equalized, self-paired bins untouched.
  const F = SimStats.foldBdfWeightsMirror(A);
  const sum = a => Array.from(a).reduce((x, y) => x + y, 0);
  check("fold preserves total counts (unbiased)", Math.abs(sum(A) - sum(F)) < 1e-9);
  check("fold equalizes mirror pairs (chi2 -> 0)", SimStats.bdfMirrorChi2(F) < 1e-12);
  let selfOk = true;
  for (let ir = 0; ir < nT; ir++)
    if (A[ir * nP] !== F[ir * nP] || A[ir * nP + nP / 2] !== F[ir * nP + nP / 2]) selfOk = false;
  check("fold leaves the self-paired phi=0 and phi=180 bins untouched", selfOk);

  // The input array must not be mutated -- the accumulator is shared, live state.
  const A2 = mk(base); const before = Array.from(A2);
  SimStats.foldBdfWeightsMirror(A2);
  check("fold does NOT mutate its input (accumulator is shared live state)",
        before.every((v, i) => v === A2[i]));

  // Precision readout tracks 100/sqrt(counts).
  const flat = new Float64Array(nT * nP).fill(400);
  const p = SimStats.bdfMedianRelNoisePct(flat);
  check(`precision readout = 100/sqrt(counts) (400 counts -> ${p.toFixed(2)}%, expect 5.00%)`,
        Math.abs(p - 5) < 1e-9);
}

console.log(fails === 0 ? "\nALL PHASE-4 GATES PASS" : `\n${fails} FAILURES`);
process.exitCode = fails ? 1 : 0;
