// simstats.js — Photon outcome statistics accumulation.
// BottomPanel is wired via setDrawPanelCallback() in main.js
// to avoid a circular import.
//
// INCREMENTAL BINNING: angular and spatial distributions are accumulated
// directly into fixed-size bin arrays as each photon completes, instead of
// storing per-photon records and re-binning the full history on every
// display refresh. This makes memory O(1) in photon count and display
// refreshes O(bins), enabling runs up to 10^7 photons. Consequence: changing
// the footprint grid resolution applies to subsequently accumulated photons
// only (re-run for a clean histogram at the new resolution).

import { state, world } from './state.js';
import { UI } from './ui.js';

let _drawPanelCallback = () => {};
export function setDrawPanelCallback(fn) { _drawPanelCallback = fn; }

// Bin-layout constants (shared with bottomPanel.js).
export const MU_BINS = 20;          // exit-angle histograms
export const BDF_THETA_BINS = 19;   // zenith bins centered at 0,5,...,90 deg
export const BDF_PHI_BINS = 72;     // azimuth bins centered at 0,5,...,355 deg

// µ histogram bin index. Reversed axis: µ=1 in bin 0, µ=0 in the last bin.
// Must match the historical binning in drawMuOverlayHistogram exactly.
function muBinIndex(mu) {
  const m = Math.max(0, Math.min(1, mu));
  return Math.min(MU_BINS - 1, Math.floor((1 - m) * MU_BINS));
}

// BDF grid bin indices for an exit direction {x, y, z}.
// Must match the historical binning in computeBdfGrid exactly.
function bdfBinIndex(dx, dy, dz) {
  const muAbs = Math.max(0, Math.min(1, Math.abs(dz ?? 0)));
  const theta = Math.acos(muAbs);

  let phi = Math.atan2(dy ?? 0, dx ?? 0);
  if (phi < 0) phi += 2 * Math.PI;

  const dTheta = (Math.PI / 2) / (BDF_THETA_BINS - 1);
  const ir = Math.min(BDF_THETA_BINS - 1, Math.max(0, Math.round(theta / dTheta)));

  const dPhi = 2 * Math.PI / BDF_PHI_BINS;
  const phiCentered = (phi + dPhi / 2) % (2 * Math.PI);
  const ip = Math.min(BDF_PHI_BINS - 1, Math.floor(phiCentered / dPhi));

  return ir * BDF_PHI_BINS + ip;
}

// Cap on stored surface-interaction events (3D markers show at most the
// most recent 1200; storing more is wasted memory at large photon counts).
const SURFACE_EVENT_CAP = 1200;
const SURFACE_FOOT_EXTENT = 2;      // surface-absorption grid spans 2× the cloud extent

export const SimStats = {

    // Photon outcome counters
    stats: {
      launched: 0,
      reflected: 0,
      transmitted: 0,       // cloud-base boundary crossings
      finalTransmitted: 0,  // terminal bottom exit when A_s = 0
      absorbed: 0,
      side: 0,
      terminated: 0,        // hit the maxEvents safety cap (should be ~0)
      surfaceReflected: 0,
      surfaceAbsorbed: 0,
      // Side-derived subset of the surface-plane tallies: downward side-wall
      // exits that reached the surface (transmittedSide) and their surface
      // reflections (surfaceReflectedSide). Used by the observation-geometry
      // logic to peel the side contribution out of the transmitted channel.
      transmittedSide: 0,
      surfaceReflectedSide: 0,
      // Terminal side-wall escapes split by vertical direction. Geometries
      // "all_faces"/"scene" reassign upward escapes to R and downward to T.
      // sideEscapeUp counts GENUINE upward cloud-side-wall exits only; the
      // surface-reflected upward bypass (no cloud face) is tallied separately
      // in surfaceBypassUp so "all_faces" can keep it in S while "scene" → R.
      sideEscapeUp: 0,
      sideEscapeDown: 0,
      surfaceBypassUp: 0,
      totalScatterings: 0,
      totalPath: 0,
      // --- v6.0 "Uniform domain" component bookkeeping (Phase 2) ---
      // R's (c)/(d) split: surfaceBypassUp (existing, unsplit total) divides into
      // bypassClearDirect (touchedCloud=false, never touched the cloud box -- new
      // "clear-direct" component (c)) and bypassViaCloud (touchedCloud=true, today's
      // "clear-via-cloud" component (d)). Sum always equals surfaceBypassUp.
      bypassClearDirect: 0,
      bypassViaCloud: 0,
      // T's (c) split: transmittedSide/surfaceReflectedSide (existing) mix genuine
      // cloud-side arrivals with clear-direct arrivals (both tagged viaSide=true --
      // see physics.js's uniform-domain launch resolution). These new counters
      // isolate the touchedCloud=false subset so genuine "via cloud side" can be
      // recovered as transmittedSide - transmittedClearDirect (and likewise for
      // reflections), without changing the existing viaSide-based fields at all.
      transmittedClearDirect: 0,
      surfaceReflectedClearDirect: 0,
      // A_cloud origin split (launch-region, not touched-cloud): cloud-incident
      // (directly illuminated) vs. clear-recycled (clear-launched, bounced off the
      // surface, re-entered the cloud, and was absorbed inside it). Sum always
      // equals stats.absorbed.
      absorbedCloudIncident: 0,
      absorbedClearRecycled: 0,
      // --- Phase 4: realized first-hit launch-face tallies (rigorous BRF) ---
      // Which surface each photon's FIRST ray-cast strikes: cloud-top face,
      // sunward side wall (top_side / uniform_domain), or clear ground
      // (uniform_domain only). Sum always equals launched.
      // launchedCloudTop is the BRF reference denominator N_top (realized
      // count, ratio-estimator design -- see TODO "Normalization / BRDF").
      launchedCloudTop: 0,
      launchedCloudWall: 0,
      launchedClear: 0
    },

    // --- Incremental bin accumulators ---
    muReflBins:     new Float64Array(MU_BINS),
    // Net-Transmitted / surface-absorbed angular distributions (v6.0.1 rewrite --
    // see TODO "3.A" discussion). TERMINAL-EVENT-ONLY construction: each photon
    // contributes at most one +1 entry, at the angle of its actual terminal
    // downward arrival at the surface (status "transmitted" at A_s=0, or
    // "surface_absorbed" at A_s>0) -- reflections along the way are NOT binned
    // at all. This replaces an earlier ±1 running-ledger scheme (arrival +1 at
    // its own angle, reflection -1 at a DIFFERENT, freshly-resampled Lambertian
    // angle) that summed to the right scalar total but could produce spurious
    // negative bins wherever a bin's reflection subtraction outweighed its local
    // arrival population -- most severely for Uniform Domain's clear-direct
    // population (a true delta function at exactly Θ₀, so every OTHER bin had
    // no matching arrivals to absorb the broadly-scattered Lambertian
    // reflections). The new construction is a genuine non-negative count in
    // every bin, for every illumination mode and every A_s, by construction --
    // not just "doesn't happen to trigger" the old scheme's failure mode.
    // muTransBaseBins: base-derived (viaSide=false )terminal arrivals -- always
    // touchedCloud=true (only genuine cloud-base crossings reach this branch).
    muTransBaseBins: new Float64Array(MU_BINS),
    // muTransSideBins: side-derived (viaSide=true) terminal arrivals, RAW --
    // mixes genuine cloud-side-wall arrivals with clear-direct arrivals (both
    // tagged viaSide=true, see physics.js's uniform-domain launch resolution).
    muTransSideBins: new Float64Array(MU_BINS),
    // Decontaminated (touchedCloud=true only) subset of muTransSideBins, so the
    // "cloud-only" views (default Uniform Domain display, sides included) show
    // genuine cloud-transmitted structure, not the clear-direct population's
    // degenerate single-angle spike. For legacy illumination modes (touchedCloud
    // always true) this is bit-identical to muTransSideBins.
    muTransSideCloudOnlyBins: new Float64Array(MU_BINS),
    bdfReflWeights: new Float64Array(BDF_THETA_BINS * BDF_PHI_BINS),
    bdfTransBaseWeights: new Float64Array(BDF_THETA_BINS * BDF_PHI_BINS),
    bdfTransSideWeights: new Float64Array(BDF_THETA_BINS * BDF_PHI_BINS),
    bdfTransSideCloudOnlyWeights: new Float64Array(BDF_THETA_BINS * BDF_PHI_BINS),
    // Terminal side-wall escape angular distributions, split by vertical
    // direction. Used only by observation geometry "b": upward escapes join the
    // reflected channel, downward escapes join the transmitted channel.
    muSideEscUpBins:   new Float64Array(MU_BINS),
    muSideEscDownBins: new Float64Array(MU_BINS),
    bdfSideEscUpWeights:   new Float64Array(BDF_THETA_BINS * BDF_PHI_BINS),
    bdfSideEscDownWeights: new Float64Array(BDF_THETA_BINS * BDF_PHI_BINS),
    // Surface-reflected upward bypass (no cloud face): a subset peeled out of the
    // upward-escape pool. Joins R only under "scene"; stays in S under "all_faces".
    muBypassBins:     new Float64Array(MU_BINS),
    bdfBypassWeights: new Float64Array(BDF_THETA_BINS * BDF_PHI_BINS),
    // Sub-cloud observation pixel (Phase 4): cloud-TOP-face exits whose exit
    // position falls inside the centered pixel |x|,|y| ≤ f_pix·W/2. One
    // parallel accumulator set, gated by an exact geometric test at record
    // time (fixed pixel size per run -- the fully-general joint spatial×
    // angular grid is deferred, see TODO "Sub-cloud observation pixel").
    // Top-face exits only by construction (status "reflected"), so the
    // Observation-geometry dropdown does not apply to the pixel view.
    // At f_pix = 1 these are bit-identical to muReflBins/bdfReflWeights.
    muReflPixelBins:     new Float64Array(MU_BINS),
    bdfReflPixelWeights: new Float64Array(BDF_THETA_BINS * BDF_PHI_BINS),
    // Cached at reset() (record() must not read the DOM per photon): pixel
    // half-width in position units, and f_pix for the N_pixel reference.
    _pixelFrac: 1,
    _pixelHalfW: 20,
    // Footprint count grids at the current "Footprint grid" resolution.
    footRefl:  {nBins: 0, counts: null},
    footTrans: {nBins: 0, counts: null},
    footSurfAbs: {nBins: 0, counts: null},

    // Per-photon arrays retained only where the display needs raw values
    // (path-length axis range adapts to the run); these store plain numbers
    // (compact in JS engines), not objects.
    reflectedPathLengths: [],
    // Optical paths of photons that delivered energy to the surface:
    // terminal "transmitted" (A_s = 0) or "surface_absorbed" (A_s > 0).
    // Count identically equals the net-transmittance count
    // (transmitted - surfaceReflected), photon for photon.
    netTransmittedPathLengths: [],          // base-derived (geometry "a") surface-deposited paths
    sideTransmittedPathLengths: [],         // side-derived surface-deposited paths, RAW (mixes genuine cloud-side arrivals with clear-direct's trivial zero-path arrivals -- see TODO "3.B")
    // Decontaminated (touchedCloud=true only) subset of sideTransmittedPathLengths,
    // used by the default (non-domain-wide) Transmitted path view so a clear-direct
    // photon's exact-zero path (no optical depth in the clear-air gap) doesn't
    // crash the reported mean. For legacy illumination modes (touchedCloud always
    // true) this is bit-identical to sideTransmittedPathLengths.
    sideTransmittedPathLengthsCloudOnly: [],
    sideEscapeUpPaths: [],                  // GENUINE upward side-wall escapes (join R under all_faces/scene)
    sideEscapeDownPaths: [],                // terminal downward side escapes (join T under all_faces/scene)
    bypassPaths: [],                        // surface-reflected upward bypass, RAW (mixes genuine clear-via-cloud paths with clear-direct's trivial zero-path entries -- see TODO "3.B")
    // Decontaminated (touchedCloud=true only) subset of bypassPaths -- the
    // "clear-via-cloud" (d) component only, excluding clear-direct (c). Used to
    // scale the entire-domain Reflected path-length panel's axis without being
    // crushed by the (legitimate, but panel-breaking) clear-direct zero-spike.
    bypassPathsCloudOnly: [],
    surfaceInteractionEvents: [],   // capped at SURFACE_EVENT_CAP

    // (Re)create footprint grids at the current UI resolution. Called on
    // reset and on display rebuilds — NOT per photon (avoids DOM reads in
    // the hot loop). A resolution change clears accumulated footprints.
    ensureFootprintGrids() {
      const nBins = UI.getFootprintGrid();
      for (const f of [SimStats.footRefl, SimStats.footTrans]) {
        if (f.nBins !== nBins || !f.counts) {
          f.nBins = nBins;
          f.counts = new Float64Array(nBins * nBins);
        }
      }
      // Surface-absorption grid spans 2× the cloud extent (to capture finite-cloud
      // side leakage that lands beyond the cloud footprint); 2× bins keeps the
      // cell size equal to the cloud footprint. The factor 2 MUST match the one
      // in _addSurfaceFootprint and in Scene.rebuildHistograms.
      const nSurf = nBins * SURFACE_FOOT_EXTENT;
      const fs = SimStats.footSurfAbs;
      if (fs.nBins !== nSurf || !fs.counts) {
        fs.nBins = nSurf;
        fs.counts = new Float64Array(nSurf * nSurf);
      }
    },

    _addFootprint(f, x, y) {
      if (!f.counts) return;
      const n = f.nBins;
      const ix = Math.floor(((x + world.slabW / 2) / world.slabW) * n);
      const iy = Math.floor(((y + world.slabD / 2) / world.slabD) * n);
      if (ix >= 0 && ix < n && iy >= 0 && iy < n) f.counts[ix * n + iy]++;
    },

    // Surface-absorption footprint: bins (x,y) over a grid SURFACE_FOOT_EXTENT×
    // the cloud extent. Landings beyond the grid (far side-wall leakage) clamp
    // to the nearest edge cell — preserving direction rather than being dropped.
    _addSurfaceFootprint(x, y) {
      const f = SimStats.footSurfAbs;
      if (!f.counts) return;
      const n = f.nBins;
      const extW = world.slabW * SURFACE_FOOT_EXTENT;
      const extD = world.slabD * SURFACE_FOOT_EXTENT;
      let ix = Math.floor(((x + extW / 2) / extW) * n);
      let iy = Math.floor(((y + extD / 2) / extD) * n);
      ix = Math.max(0, Math.min(n - 1, ix));
      iy = Math.max(0, Math.min(n - 1, iy));
      f.counts[ix * n + iy]++;
    },

    // Reset all counters and accumulators to their initial empty state.
    reset() {
      const s = SimStats.stats;
      s.launched = 0; s.reflected = 0; s.transmitted = 0; s.finalTransmitted = 0;
      s.absorbed = 0; s.side = 0; s.terminated = 0; s.surfaceReflected = 0; s.surfaceAbsorbed = 0;
      s.transmittedSide = 0; s.surfaceReflectedSide = 0;
      s.sideEscapeUp = 0; s.sideEscapeDown = 0; s.surfaceBypassUp = 0;
      s.totalScatterings = 0; s.totalPath = 0;
      s.bypassClearDirect = 0; s.bypassViaCloud = 0;
      s.transmittedClearDirect = 0; s.surfaceReflectedClearDirect = 0;
      s.absorbedCloudIncident = 0; s.absorbedClearRecycled = 0;
      s.launchedCloudTop = 0; s.launchedCloudWall = 0; s.launchedClear = 0;
      SimStats.muReflBins.fill(0);
      SimStats.muTransBaseBins.fill(0);
      SimStats.muTransSideBins.fill(0);
      SimStats.muTransSideCloudOnlyBins.fill(0);
      SimStats.bdfReflWeights.fill(0);
      SimStats.bdfTransBaseWeights.fill(0);
      SimStats.bdfTransSideWeights.fill(0);
      SimStats.bdfTransSideCloudOnlyWeights.fill(0);
      SimStats.muSideEscUpBins.fill(0);
      SimStats.muSideEscDownBins.fill(0);
      SimStats.bdfSideEscUpWeights.fill(0);
      SimStats.bdfSideEscDownWeights.fill(0);
      SimStats.muBypassBins.fill(0);
      SimStats.bdfBypassWeights.fill(0);
      SimStats.muReflPixelBins.fill(0);
      SimStats.bdfReflPixelWeights.fill(0);
      // Cache the pixel gate for the run (world.slabW is already current --
      // resetScene calls Scene.updateWorld() before SimStats.reset()).
      SimStats._pixelFrac = UI.getPixelFraction ? UI.getPixelFraction() : 1;
      SimStats._pixelHalfW = SimStats._pixelFrac * world.slabW / 2;
      SimStats.footRefl  = {nBins: 0, counts: null};
      SimStats.footTrans = {nBins: 0, counts: null};
      SimStats.footSurfAbs = {nBins: 0, counts: null};
      SimStats.ensureFootprintGrids();
      SimStats.surfaceInteractionEvents = [];
      SimStats.reflectedPathLengths = [];  SimStats.netTransmittedPathLengths = [];
      SimStats.sideTransmittedPathLengths = [];  SimStats.sideTransmittedPathLengthsCloudOnly = [];
      SimStats.sideEscapeUpPaths = [];  SimStats.sideEscapeDownPaths = [];
      SimStats.bypassPaths = [];  SimStats.bypassPathsCloudOnly = [];
    },

    // --- Observation geometry combiners ------------------------------------
    // Every exit is accumulated unconditionally above; the observation geometry
    // only chooses how to COMBINE the accumulators, so switching modes re-bins
    // the SAME run with no re-simulation. Footprints are left as plane
    // projections (unchanged) per design. Observation geometry — one of three keys:
    //   "top-base_faces" (a): cloud top/base faces only; sides → S.
    //   "all_faces"      (b): cloud element (top/base/side faces). Genuine upward
    //                         side exits → R, downward side → T, but surface-
    //                         reflected upward bypass (no cloud face) stays in S.
    //   "scene"          (c): entire scene — all upwelling → R, all downwelling
    //                         absorption + downward side → T, S → 0 (bypass → R).
    // T-side helpers are identical for all_faces and scene ("sides included");
    // only the R/S split differs (whether the bypass pool joins R).
    _obsGeom() { return (UI.getObservationGeometry ? UI.getObservationGeometry() : "top-base_faces"); },
    _sidesIncluded() { return SimStats._obsGeom() !== "top-base_faces"; },        // all_faces or scene
    _bypassInReflected() { return SimStats._obsGeom() === "scene"; },             // scene only
    observationGeometryLabel() {
      const g = SimStats._obsGeom();
      return g === "scene"     ? "entire scene"
           : g === "all_faces" ? "cloud top/base/side faces"
                               : "cloud top/base faces";
    },
    observationGeometryKey() {
      const g = SimStats._obsGeom();
      return g === "scene" || g === "all_faces" ? g : "top-base_faces";
    },

    reflectedMuBins() {
      // Copy (not the live accumulator) in both branches, matching every
      // sibling combiner -- a caller mutating the returned array must never be
      // able to corrupt the accumulator (review E11).
      if (!SimStats._sidesIncluded()) return Float64Array.from(SimStats.muReflBins);
      const byp = SimStats._bypassInReflected();
      const out = new Float64Array(MU_BINS);
      for (let i = 0; i < MU_BINS; i++)
        out[i] = SimStats.muReflBins[i] + SimStats.muSideEscUpBins[i] + (byp ? SimStats.muBypassBins[i] : 0);
      return out;
    },
    transmittedMuBins() {
      const out = new Float64Array(MU_BINS);
      if (SimStats._sidesIncluded()) {
        for (let i = 0; i < MU_BINS; i++) out[i] = SimStats.muTransBaseBins[i] + SimStats.muTransSideBins[i] + SimStats.muSideEscDownBins[i];
      } else {
        for (let i = 0; i < MU_BINS; i++) out[i] = SimStats.muTransBaseBins[i];
      }
      return out;
    },
    reflectedBdfWeights() {
      // Copy, not the live accumulator -- see reflectedMuBins (review E11).
      if (!SimStats._sidesIncluded()) return Float64Array.from(SimStats.bdfReflWeights);
      const byp = SimStats._bypassInReflected();
      const out = new Float64Array(SimStats.bdfReflWeights.length);
      for (let i = 0; i < out.length; i++)
        out[i] = SimStats.bdfReflWeights[i] + SimStats.bdfSideEscUpWeights[i] + (byp ? SimStats.bdfBypassWeights[i] : 0);
      return out;
    },
    transmittedBdfWeights() {
      const out = new Float64Array(SimStats.bdfTransBaseWeights.length);
      if (SimStats._sidesIncluded()) {
        for (let i = 0; i < out.length; i++) out[i] = SimStats.bdfTransBaseWeights[i] + SimStats.bdfTransSideWeights[i] + SimStats.bdfSideEscDownWeights[i];
      } else {
        for (let i = 0; i < out.length; i++) out[i] = SimStats.bdfTransBaseWeights[i];
      }
      return out;
    },
    // Cloud-only variants of the above (v6.0 Phase 2): identical to
    // transmittedMuBins/transmittedBdfWeights but built from the touchedCloud=true
    // subset, so the clear-direct population (a delta function at exactly Θ₀ for
    // unscattered domain launches) doesn't dominate/degenerate the plot. For
    // legacy illumination modes (touchedCloud always true) this is bit-identical to
    // the non-cloud-only version. bottomPanel.js uses these for the "Net
    // Transmitted" plots; the domain-wide T_domain scalar (domainTransmittedNetCount)
    // still reports the true total including clear-direct.
    transmittedMuBinsCloudOnly() {
      const out = new Float64Array(MU_BINS);
      if (SimStats._sidesIncluded()) {
        for (let i = 0; i < MU_BINS; i++) out[i] = SimStats.muTransBaseBins[i] + SimStats.muTransSideCloudOnlyBins[i] + SimStats.muSideEscDownBins[i];
      } else {
        for (let i = 0; i < MU_BINS; i++) out[i] = SimStats.muTransBaseBins[i];
      }
      return out;
    },
    transmittedBdfWeightsCloudOnly() {
      const out = new Float64Array(SimStats.bdfTransBaseWeights.length);
      if (SimStats._sidesIncluded()) {
        for (let i = 0; i < out.length; i++) out[i] = SimStats.bdfTransBaseWeights[i] + SimStats.bdfTransSideCloudOnlyWeights[i] + SimStats.bdfSideEscDownWeights[i];
      } else {
        for (let i = 0; i < out.length; i++) out[i] = SimStats.bdfTransBaseWeights[i];
      }
      return out;
    },
    // Domain-wide (bypass-inclusive) variants of the Reflected / Net-Transmitted
    // mu/BDF views (v6.0, "Show entire-domain plots" toggle -- see TODO
    // "Second round of live-UI feedback"). Deliberately independent of the
    // Observation-geometry dropdown, exactly like domainReflectedCount()/
    // domainTransmittedNetCount() above (same "always-shown, unconditional"
    // design as the ENTIRE DOMAIN scalar block) -- always includes side exits
    // AND surface bypass, regardless of which of the two dropdown options is
    // selected. Reflected's bypass population (Lambertian-diffuse surface
    // reflection) is smooth, not degenerate. Net Transmitted's domain-wide view
    // legitimately includes the clear-direct population's true zero-path/exact-Θ₀
    // spike (see TODO "3.B" -- that spike is real, not a bookkeeping artifact,
    // and the terminal-event-only construction above means it no longer produces
    // spurious negative bins elsewhere, just a large genuine count at one angle).
    reflectedMuBinsDomainWide() {
      const out = new Float64Array(MU_BINS);
      for (let i = 0; i < MU_BINS; i++)
        out[i] = SimStats.muReflBins[i] + SimStats.muSideEscUpBins[i] + SimStats.muBypassBins[i];
      return out;
    },
    reflectedBdfWeightsDomainWide() {
      const out = new Float64Array(SimStats.bdfReflWeights.length);
      for (let i = 0; i < out.length; i++)
        out[i] = SimStats.bdfReflWeights[i] + SimStats.bdfSideEscUpWeights[i] + SimStats.bdfBypassWeights[i];
      return out;
    },
    transmittedMuBinsDomainWide() {
      const out = new Float64Array(MU_BINS);
      for (let i = 0; i < MU_BINS; i++) out[i] = SimStats.muTransBaseBins[i] + SimStats.muTransSideBins[i] + SimStats.muSideEscDownBins[i];
      return out;
    },
    transmittedBdfWeightsDomainWide() {
      const out = new Float64Array(SimStats.bdfTransBaseWeights.length);
      for (let i = 0; i < out.length; i++) out[i] = SimStats.bdfTransBaseWeights[i] + SimStats.bdfTransSideWeights[i] + SimStats.bdfSideEscDownWeights[i];
      return out;
    },
    // Cloud-only variants of the domain-wide Net Transmitted views (v6.0.1 --
    // see TODO "3.A"/"3.B" follow-up). Unlike Reflected's domain-wide bypass
    // population (Lambertian-diffuse escape angle -- smooth, not degenerate,
    // verified via harness: max/median bin ratio 1.67), Net Transmitted's
    // clear-direct population arrives at exactly Θ₀ (unscattered), a true
    // delta function that dominates one bin by ~50x over its neighbors (same
    // verification). No axis/display choice can show that spike proportionally
    // alongside genuine structure (same conclusion as the path-length fix), so
    // these exclude it from the bars; the caller reports the excluded count as
    // text via tComponents().clearDirect, same pattern as the path-length
    // panel's clear-sky text line. Always side/escDown-inclusive, independent
    // of the Observation-geometry dropdown -- same "entire domain" contract as
    // transmittedMuBinsDomainWide() above, just decontaminated.
    transmittedMuBinsDomainWideCloudOnly() {
      const out = new Float64Array(MU_BINS);
      for (let i = 0; i < MU_BINS; i++) out[i] = SimStats.muTransBaseBins[i] + SimStats.muTransSideCloudOnlyBins[i] + SimStats.muSideEscDownBins[i];
      return out;
    },
    transmittedBdfWeightsDomainWideCloudOnly() {
      const out = new Float64Array(SimStats.bdfTransBaseWeights.length);
      for (let i = 0; i < out.length; i++) out[i] = SimStats.bdfTransBaseWeights[i] + SimStats.bdfTransSideCloudOnlyWeights[i] + SimStats.bdfSideEscDownWeights[i];
      return out;
    },
    reflectedCount() {
      const s = SimStats.stats;
      if (!SimStats._sidesIncluded()) return s.reflected;
      return s.reflected + s.sideEscapeUp + (SimStats._bypassInReflected() ? s.surfaceBypassUp : 0);
    },
    transmittedNetCount() {
      const s = SimStats.stats;
      if (SimStats._sidesIncluded()) {
        return (s.transmitted - s.surfaceReflected) + s.sideEscapeDown;
      }
      return (s.transmitted - s.transmittedSide) - (s.surfaceReflected - s.surfaceReflectedSide);
    },
    sideExitCount() {
      const s = SimStats.stats;
      if (!SimStats._sidesIncluded()) {
        return s.side + (s.transmittedSide - s.surfaceReflectedSide);   // "a": sides + bypass + side-absorption
      }
      // residual ≈ 0 (genuine up/down + bypass all accounted). "all_faces" keeps
      // bypass in S; "scene" reassigns it to R, leaving only the residual.
      const residual = s.side - s.sideEscapeUp - s.sideEscapeDown - s.surfaceBypassUp;
      return residual + (SimStats._bypassInReflected() ? 0 : s.surfaceBypassUp);
    },

    // --- v6.0 "Uniform domain" domain-wide totals and component breakdowns ---
    // (Phase 2). These do NOT read the Observation-geometry dropdown at all --
    // per TODO "Illumination / Observation geometry naming", the domain-wide
    // (a)+(b)+(c)+(d) total is an always-shown report, independent of and in
    // parallel with the dropdown-driven cloud-normalized R/T/A/S above. The
    // formulas are exactly today's "scene" combiner math (all upwelling -> R, all
    // net-downward -> T), just applied unconditionally instead of gated behind a
    // removed dropdown value.
    domainReflectedCount() {
      const s = SimStats.stats;
      return s.reflected + s.sideEscapeUp + s.surfaceBypassUp;
    },
    domainTransmittedNetCount() {
      const s = SimStats.stats;
      return (s.transmitted - s.surfaceReflected) + s.sideEscapeDown;
    },
    domainAbsorbedCount() {
      return SimStats.stats.absorbed;
    },
    // Net transmitted count for the cloud-only mu/BDF views (excludes the
    // clear-direct (c) component) -- matches what transmittedMuBinsCloudOnly()/
    // transmittedBdfWeightsCloudOnly() actually plot, for a consistent N label.
    // Must respect the Observation-geometry dropdown exactly like the bin
    // functions it labels: under "top-base_faces" the plotted bins are
    // base-only, so the label must be viaBase only (v6.0.1 fix -- review
    // finding E1: the label previously returned viaBase + viaSide
    // unconditionally, overstating N vs. the plotted-bin sum whenever
    // Illumination = "Uniform domain" with the default dropdown selection).
    transmittedNetCountCloudOnly() {
      const tc = SimStats.tComponents();
      return SimStats._sidesIncluded() ? tc.viaBase + tc.viaSide : tc.viaBase;
    },

    // --- Phase 4: rigorous BRF/BTF normalization helpers -------------------
    // Reference count N_top: the REALIZED number of photons whose first
    // ray-cast hit the cloud-top face. Using the realized count (not the
    // expected N·A_top/A_domain) is a deliberate ratio-estimator choice: the
    // per-bin exit counts N_ij are driven by this same realized population,
    // so common-mode MC noise cancels (TODO "Normalization / BRDF", step 2).
    // For center/top illumination N_top === launched; for top_side it is the
    // realized N·(1−p_side); for uniform_domain ≈ N·f_c. Returns 0 when no
    // top-face photon has been launched -- callers MUST guard (divide-by-zero
    // gate) and fall back to N with an "approximate" label.
    nTopIncident() {
      return SimStats.stats.launchedCloudTop;
    },

    // N_pixel: incident-flux-equivalent reference count for the sub-cloud
    // pixel BRF -- the pixel receives an f_pix² share of the (uniform)
    // top-face incident flux: N_pixel = N_top·f_pix². Exact for top/top_side/
    // uniform_domain (uniform-in-area face illumination); the documented
    // plane-parallel-equivalent approximation for "center" (a point source
    // has no per-area flux). May be non-integer; callers guard > 0.
    nPixelIncident() {
      return SimStats.stats.launchedCloudTop * SimStats._pixelFrac * SimStats._pixelFrac;
    },

    // Pixel exit count (for N labels): total top-face exits inside the pixel.
    pixelReflectedCount() {
      let n = 0;
      for (let i = 0; i < MU_BINS; i++) n += SimStats.muReflPixelBins[i];
      return n;
    },

    // A_proj(θᵥ,φᵥ)/A_top: the cloud element's silhouette projected onto the
    // horizontal (ground) plane along the view direction, relative to the top
    // face's own footprint W·D. For W = D (enforced by the single
    // horizontal-extent input):
    //     A_proj/W² = 1 + (τ_cloud/W)·tanθᵥ·(|cosφᵥ| + |sinφᵥ|)
    // Collapses to exactly 1 (i.e. A_proj = W²) for top-face-only observation
    // -- the flat top's ground footprint is W² from ANY view angle (Phase-4
    // gate). NO cap is applied (2026-07-16 user decision, reversing the TODO's
    // earlier "cap at A_domain" note): the reference is the equivalent-uniform-
    // beam convention (radiance of a perfect Lambertian target under the same
    // beam), which preserves the UD(M=1) ≡ legacy-top identity and cross-M
    // comparability; at grazing view angles the large ratio is the physically
    // real stretched footprint (same effect as limb distortion in
    // geostationary imagery). mu is the bin's area-weighted |cosθᵥ| center
    // (floored at 1e-6 upstream), phiRad the bin-center azimuth.
    aProjOverTop(mu, phiRad) {
      const tanTheta = Math.sqrt(Math.max(0, 1 - mu * mu)) / Math.max(mu, 1e-6);
      return 1 + (world.tauCloud / world.slabW) * tanTheta *
                 (Math.abs(Math.cos(phiRad)) + Math.abs(Math.sin(phiRad)));
    },

    // R components (a) cloud top, (b) cloud side, (c) clear-direct, (d)
    // clear-via-cloud. Sum = domainReflectedCount(). Scalar counts only (see TODO
    // Handoff decision 8 -- no new per-component angular/path bins).
    rComponents() {
      const s = SimStats.stats;
      return {
        cloudTop: s.reflected,
        cloudSide: s.sideEscapeUp,
        clearDirect: s.bypassClearDirect,
        clearViaCloud: s.bypassViaCloud
      };
    },
    // T components: via cloud base, via cloud side (genuine, decontaminated),
    // clear-direct. Each is a NET (arrivals - reflections) count, so they sum
    // exactly to domainTransmittedNetCount(). Base/side each still mix
    // directly-cloud-incident with clear-sky-recycled origins (see TODO -- that
    // finer split isn't tracked for T, only for A_cloud below).
    tComponents() {
      const s = SimStats.stats;
      const viaBase = (s.transmitted - s.transmittedSide) - (s.surfaceReflected - s.surfaceReflectedSide);
      const viaSide = (s.transmittedSide - s.transmittedClearDirect) - (s.surfaceReflectedSide - s.surfaceReflectedClearDirect) + s.sideEscapeDown;
      const clearDirect = s.transmittedClearDirect - s.surfaceReflectedClearDirect;
      return { viaBase, viaSide, clearDirect };
    },
    // A_cloud components: cloud-incident vs. clear-sky recycled (by launch
    // region, not touched-cloud -- see TODO "T and A component decomposition").
    // Sum = stats.absorbed exactly.
    aComponents() {
      const s = SimStats.stats;
      return { cloudIncident: s.absorbedCloudIncident, clearRecycled: s.absorbedClearRecycled };
    },

    // Build the "ENTIRE DOMAIN" stats-panel block text (only called when
    // Illumination = "Uniform domain"; see updateDisplay). Collapsed by default;
    // the component breakdown is appended when "Show domain components" is
    // checked (UI.getShowDomainComponents()), same pattern as "Show surface
    // heatmap". Domain boundary is hardcoded to "open" until Phase 3 adds the
    // periodic option.
    buildDomainBlockText(launched) {
      const M = UI.getDomainFactor();
      const fc = UI.getCloudFraction();
      const RdCount = SimStats.domainReflectedCount();
      const TdCount = SimStats.domainTransmittedNetCount();
      const AdCount = SimStats.domainAbsorbedCount();
      const Rd = RdCount / launched, Td = TdCount / launched, Ad = AdCount / launched;
      const closure = Rd + Td + Ad;
      // Indentation uses non-breaking spaces, and the header is broken into
      // short explicit lines rather than one long one -- same reasoning/fix
      // as buildComponentBreakdownText above: this panel's `white-space:
      // pre-line` CSS trims plain leading spaces at the start of a rendered
      // line, and a single long line auto-wraps wherever it happens to
      // overflow rather than at a chosen point. Sub-item wording/labels also
      // brought in line with buildComponentBreakdownText's "from cloud top:"
      // / "clear-sky incident:" style for consistency between the two panels.
      const IND = "  ";

      let text =
`<b>RADIATIVE COMPONENTS: ENTIRE DOMAIN</b>
 (Uniform domain illumination; domain boundary: open;
 domain factor M=${M.toFixed(2)}, cloud fraction f_c=${fc.toFixed(4)})

R_domain (all upwelling): ${Rd.toFixed(3)} (${RdCount})`;

      if (UI.getShowDomainComponents()) {
        const rc = SimStats.rComponents();
        text += `
${IND}from cloud top: ${(rc.cloudTop/launched).toFixed(3)} (${rc.cloudTop})
${IND}from cloud side: ${(rc.cloudSide/launched).toFixed(3)} (${rc.cloudSide})
${IND}from clear sky, direct: ${(rc.clearDirect/launched).toFixed(3)} (${rc.clearDirect})
${IND}from clear sky, via cloud: ${(rc.clearViaCloud/launched).toFixed(3)} (${rc.clearViaCloud})`;
      }

      text += `
${UI.getShowDomainComponents() ? "\n" : ""}T_domain (all surface-absorbed): ${Td.toFixed(3)} (${TdCount})`;

      if (UI.getShowDomainComponents()) {
        const tc = SimStats.tComponents();
        text += `
${IND}from cloud base: ${(tc.viaBase/launched).toFixed(3)} (${tc.viaBase.toFixed(0)})
${IND}from cloud side: ${(tc.viaSide/launched).toFixed(3)} (${tc.viaSide.toFixed(0)})
${IND}(base/side mix cloud- and clear-sky-incident photons)
${IND}from clear sky, direct: ${(tc.clearDirect/launched).toFixed(3)} (${tc.clearDirect.toFixed(0)})`;
      }

      text += `
${UI.getShowDomainComponents() ? "\n" : ""}A_cloud (domain-normalized): ${Ad.toFixed(3)} (${AdCount})`;

      if (UI.getShowDomainComponents()) {
        const ac = SimStats.aComponents();
        text += `
${IND}cloud-incident: ${(ac.cloudIncident/launched).toFixed(3)} (${ac.cloudIncident})
${IND}clear-sky incident: ${(ac.clearRecycled/launched).toFixed(3)} (${ac.clearRecycled})`;
      }

      text += `
${UI.getShowDomainComponents() ? "\n" : ""}R_domain + T_domain + A_cloud: ${closure.toFixed(3)}`;

      return text;
    },

    // Build the R/T/A component-breakdown text appended under FINAL OUTCOMES
    // for LEGACY illumination modes only (see updateDisplay() -- Uniform Domain
    // already gets the equivalent breakdown via the ENTIRE DOMAIN block above,
    // so this would just duplicate it there). Shown when "Show domain
    // components" is checked (UI.getShowDomainComponents()).
    //
    // rComponents()/tComponents()/aComponents() are general-purpose: they just
    // read raw counters populated by surfaceInteraction()'s Lambertian-bounce
    // logic, which runs for any cloud-base crossing or downward side exit
    // whenever A_s > 0, regardless of launch mode (verified: Illumination=top,
    // A_s=0.5 gives clearDirect=0 (trivially, no clear-launched population is
    // possible outside Uniform Domain) but clearViaCloud nonzero and meaningful
    // -- see TODO "2.B/2.C" discussion). At A_s=0 every bypass/clear-recycled
    // term is trivially zero (surfaceInteraction never triggers), which is
    // harmless -- just uninformative.
    //
    // Label note (review E9, RESOLVED 2026-07-14 -- user decision): the
    // rc.clearViaCloud bucket is labeled "from clear sky, via cloud" here,
    // matching buildDomainBlockText, so the same physical bucket has ONE name
    // in both panels. The review briefly renamed it "surface bypass (no cloud
    // re-entry)" out of concern that "from clear sky" reads as a LAUNCH-origin
    // claim (wrong under legacy modes, which have no clear-sky source) -- but
    // in this panel's parallel structure ("from cloud top / from cloud side /
    // from clear sky, direct / from clear sky, via cloud") "from" denotes the
    // FINAL EXIT PATHWAY, consistent with the TODO's rule that components are
    // defined by final exit location. Mechanism, for the record: a photon
    // whose last event is a surface reflection that escapes to space through
    // the clear sky WITHOUT re-entering the cloud (its energy reached the
    // surface via the cloud). Do not read "from clear sky" as launch origin;
    // origin-based labels exist only in the A_cloud split below.
    //
    // R and T are restated here because they differ from the dropdown-driven
    // FINAL OUTCOMES R/T above whenever the Observation-geometry dropdown
    // excludes some faces, or excludes the surface-bounce "bypass" channel (see
    // TODO "2.A" -- "all_faces" keeps bypass in S; this breakdown always
    // includes it in R, matching the old "scene" combiner). A is NOT restated
    // (cloud absorption has no geometry dependence at all -- domainAbsorbedCount()
    // is always identical to the A already shown above), only its origin split.
    buildComponentBreakdownText(launched) {
      const RdCount = SimStats.domainReflectedCount();
      const TdCount = SimStats.domainTransmittedNetCount();
      const rc = SimStats.rComponents();
      const tc = SimStats.tComponents();
      const ac = SimStats.aComponents();

      // Indentation uses non-breaking spaces ( ), not plain ASCII spaces.
      // This panel's CSS is `white-space: pre-line`, which preserves forced
      // newlines but -- per ordinary CSS whitespace-collapsing rules --
      // trims plain collapsible spaces at the start of every rendered line
      // (wrapped or forced). A leading "  from cloud top:" therefore rendered
      // flush-left with no visible indent.   is explicitly excluded from
      // that collapsing/trimming behavior, so it survives and shows as a
      // real indent. Line breaks in the header below are also placed at the
      // user's own specified points (verified short enough per-line to avoid
      // additional mid-phrase auto-wrap in the panel).
      const IND = "  ";

      // Title wrapped in <b> -- the stats panel now renders via innerHTML
      // (see updateDisplay) specifically so this and the FINAL OUTCOMES/
      // SURFACE FLUX DIAGNOSTICS titles can be bold-faced; this function's
      // return value has no other consumer (only updateDisplay calls it),
      // so embedding a literal HTML tag here is safe.
      return `<b>RADIATIVE COMPONENTS</b>
 (independent of Observation-geometry dropdown selection;
 can differ from R/T above when dropdown excludes some
 faces or surface-reflected terms):

R (all upwelling): ${(RdCount/launched).toFixed(3)} (${RdCount})
${IND}from cloud top: ${(rc.cloudTop/launched).toFixed(3)} (${rc.cloudTop})
${IND}from cloud side: ${(rc.cloudSide/launched).toFixed(3)} (${rc.cloudSide})
${IND}from clear sky, direct: ${(rc.clearDirect/launched).toFixed(3)} (${rc.clearDirect})
${IND}from clear sky, via cloud: ${(rc.clearViaCloud/launched).toFixed(3)} (${rc.clearViaCloud})

T (surface-absorbed): ${(TdCount/launched).toFixed(3)} (${TdCount})
${IND}from cloud base: ${(tc.viaBase/launched).toFixed(3)} (${tc.viaBase.toFixed(0)})
${IND}from cloud side: ${(tc.viaSide/launched).toFixed(3)} (${tc.viaSide.toFixed(0)})
${IND}from clear sky, direct: ${(tc.clearDirect/launched).toFixed(3)} (${tc.clearDirect.toFixed(0)})

Cloud absorption, A (see above):
${IND}cloud-incident: ${(ac.cloudIncident/launched).toFixed(3)} (${ac.cloudIncident})
${IND}clear-sky incident: ${(ac.clearRecycled/launched).toFixed(3)} (${ac.clearRecycled})`;
    },

    // Path-length constituent arrays for the active geometry (returned as a
    // list of segments so consumers iterate without allocating a concat copy).
    reflectedPathSegments() {
      if (!SimStats._sidesIncluded()) return [SimStats.reflectedPathLengths];
      const segs = [SimStats.reflectedPathLengths, SimStats.sideEscapeUpPaths];
      if (SimStats._bypassInReflected()) segs.push(SimStats.bypassPaths);   // scene only
      return segs;
    },
    transmittedPathSegments() {
      // Uses the cloud-only decontaminated side array (v6.0.1, see TODO "3.B") so
      // a clear-direct photon's trivial zero path (no optical depth in the
      // clear-air gap) doesn't crash the reported mean. For legacy modes this is
      // bit-identical (touchedCloud always true, so no entries are excluded).
      return SimStats._sidesIncluded()
        ? [SimStats.netTransmittedPathLengths, SimStats.sideTransmittedPathLengthsCloudOnly, SimStats.sideEscapeDownPaths]
        : [SimStats.netTransmittedPathLengths];
    },
    // Domain-wide (bypass-inclusive) path-segment variants for the "Show
    // entire-domain plots" toggle (v6.0) -- same pattern as
    // reflectedMuBinsDomainWide()/transmittedMuBinsDomainWide() above, added
    // after the user noticed the path-length panel still tracked the
    // Observation-geometry dropdown even with the toggle checked (bottomPanel.js's
    // drawPathOverlay() wasn't wired up the first time around). Always includes
    // side exits + bypass, independent of the dropdown, matching
    // domainReflectedCount()/domainTransmittedNetCount() exactly. Transmitted's
    // domain-wide list is identical in form to the existing sidesIncluded=true
    // branch above (T-side handling has always been the same for all_faces and
    // the old "scene" -- see _obsGeom() comment) -- called out as its own
    // function anyway so it's independent of the dropdown, not just coincidentally
    // matching one of its settings.
    // NOTE (v6.0.1, TODO "3.B"): these deliberately return the RAW bypassPaths/
    // sideTransmittedPathLengths arrays, including the clear-direct population's
    // exact-zero-path entries -- unlike transmittedPathSegments() above, this is
    // NOT decontaminated, because "entire domain" is supposed to show the true,
    // complete population. That zero-path spike is a real physical fact (clear-
    // sky photons genuinely travel zero optical path before reaching the
    // surface), not a bookkeeping artifact, and it grows with the domain factor
    // M. bottomPanel.js's drawPathOverlay() separates it from the plotted bars
    // and reports its count as text instead, using SimStats.bypassPathsCloudOnly/
    // sideTransmittedPathLengthsCloudOnly (length difference = clear-direct count).
    reflectedPathSegmentsDomainWide() {
      return [SimStats.reflectedPathLengths, SimStats.sideEscapeUpPaths, SimStats.bypassPaths];
    },
    transmittedPathSegmentsDomainWide() {
      return [SimStats.netTransmittedPathLengths, SimStats.sideTransmittedPathLengths, SimStats.sideEscapeDownPaths];
    },

    // --- Shared path-histogram spec (v6.0.1, review R2) -------------------
    // Single owner of the path-length histogram construction, used by BOTH
    // bottomPanel.drawPathOverlay() (the figure) and exportUtils.
    // getExportDataObject() (the JSON), so the two can never drift apart
    // again. (Review finding E2: the 3.B axis fix changed the panel's scale
    // to the genuine-population mean but exportUtils kept the old
    // dropdown-segment-mean scale, so every exported path histogram at
    // A_s > 0 -- legacy modes included -- used a different bin_max than the
    // on-screen figure it documents.)

    // Mean over a list of per-photon path arrays (segments), no concat copy.
    segMean(segs) {
      let sum = 0, n = 0;
      for (const arr of segs) { for (const v of arr) sum += v; n += arr.length; }
      return n ? sum / n : 0;
    },

    // Histogram x-axis maximum. Scaled from the GENUINE (touchedCloud=true)
    // path population only, independent of the Observation-geometry dropdown
    // and the entire-domain toggle: reflectedPathLengths/sideEscapeUpPaths/
    // netTransmittedPathLengths/sideEscapeDownPaths are always clean by
    // construction; bypassPathsCloudOnly/sideTransmittedPathLengthsCloudOnly
    // exclude the clear-direct zero-path spike (see TODO "3.B"). Scaling from
    // the raw, contaminated arrays would crush the axis toward zero and clip
    // most of the genuine population into the overflow bin.
    pathAxisMax() {
      const scaleMean = Math.max(
        SimStats.segMean([SimStats.reflectedPathLengths, SimStats.sideEscapeUpPaths, SimStats.bypassPathsCloudOnly]),
        SimStats.segMean([SimStats.netTransmittedPathLengths, SimStats.sideTransmittedPathLengthsCloudOnly, SimStats.sideEscapeDownPaths]));
      // Representative scale rather than the rare-event maximum: keeps the bulk
      // of the distributions visible; long-tail photons clip into the last bin.
      return Math.max(10, Math.ceil((2.5 * Math.max(scaleMean, 1)) / 10) * 10);
    },

    // Fill fixed-width bins on [0, niceMax], overflow into the last bin.
    // Exact-zero entries are skipped: they are exclusively the clear-direct
    // population (a genuine photon cannot have zero optical path -- free paths
    // are strictly positive), reported as a separate text count by the panel
    // rather than drawn as a bar (TODO "3.B"). For every segment list in use
    // today except the *DomainWide() ones, zeros cannot occur at all.
    pathHistogramCounts(segs, niceMax, nBins = 24) {
      const counts = new Array(nBins).fill(0);
      for (const arr of segs) for (const vRaw of arr) {
        if (vRaw === 0) continue;
        const v = Math.max(0, vRaw || 0);
        counts[Math.min(nBins - 1, Math.floor((v / niceMax) * nBins))] += 1;
      }
      return counts;
    },

    // Record a downward arrival at the surface plane (independent of surface
    // outcome): a downward cloud-base crossing, or (A_s > 0) a downward
    // side-wall exit that proceeds through clear air to the infinite surface.
    // Called once per arrival, even if the photon is reflected back up and
    // arrives again later. Scalar counters only -- angular (mu/BDF) binning for
    // the "Net Transmitted" plots is done ONLY at a photon's actual terminal
    // downward arrival (see record()'s "transmitted"/"surface_absorbed"
    // branches), not here, since a non-terminal arrival that goes on to be
    // reflected was never actually "transmitted" (see TODO "3.A").
    registerCloudBaseTransmission(result) {
      SimStats.stats.transmitted++;
      // Footprint: genuine cloud-base crossings only (viaSide=false), keeping
      // the green footprint 1:1 with the green 3D base-crossing markers
      // STRUCTURALLY (photons.js skips viaSide the same way). Previously this
      // binned every surface arrival and relied on geometry to keep
      // side-derived/clear-direct landings out of the cloud-extent grid
      // (side exits move outward in their exit axis; clear-direct launches
      // are outside the footprint by construction) -- true today, but fragile:
      // Phase 3's periodic wrap can put a viaSide arrival inside the
      // footprint, which would have silently broken the 1:1 claim (review
      // finding E12). Legacy output is bit-identical either way.
      if (!result.viaSide) {
        SimStats._addFootprint(SimStats.footTrans, result.xExit, result.yExit);
      }
      if (result.viaSide) {
        SimStats.stats.transmittedSide++;
      }
      // touchedCloud=false => this arrival is the "clear-direct" (c) component
      // (see TODO "T and A component decomposition"), tagged viaSide=true above as
      // a bookkeeping stand-in (physics.js has no other pre-existing slot for it)
      // -- isolate it here so genuine "via cloud side" = transmittedSide -
      // transmittedClearDirect.
      if (!result.touchedCloud) {
        SimStats.stats.transmittedClearDirect++;
      }
    },

    // Record a Lambertian surface reflection direction. Scalar counters only --
    // see registerCloudBaseTransmission above: reflections are never terminal
    // downward arrivals, so they no longer touch the Net Transmitted mu/BDF bins
    // at all (v6.0.1 -- see TODO "3.A").
    registerSurfaceReflection(d) {
      if (d.viaSide) {
        SimStats.stats.surfaceReflectedSide++;
      }
      if (!d.touchedCloud) {
        SimStats.stats.surfaceReflectedClearDirect++;
      }
    },

    // Store a surface interaction event for the 3D markers, keeping only
    // the most recent SURFACE_EVENT_CAP entries.
    registerSurfaceEvent(e) {
      const arr = SimStats.surfaceInteractionEvents;
      arr.push(e);
      if (arr.length > 2 * SURFACE_EVENT_CAP) arr.splice(0, arr.length - SURFACE_EVENT_CAP);
    },

    // Record the final outcome of a completed photon trajectory.
    record(result) {
      SimStats.stats.launched++;
      SimStats.stats.totalScatterings += result.scatterings;
      SimStats.stats.totalPath += result.totalPath;
      SimStats.stats.surfaceReflected += result.surfaceBounceCount ?? 0;
      // Phase 4: first-hit launch-face tally (defaults to "top" for
      // robustness -- every legacy center/top launch is a top-face entry).
      const lf = result.launchFace ?? "top";
      if (lf === "wall")       SimStats.stats.launchedCloudWall++;
      else if (lf === "clear") SimStats.stats.launchedClear++;
      else                     SimStats.stats.launchedCloudTop++;

      if (result.status === "reflected") {
        SimStats.stats.reflected++;
        SimStats._addFootprint(SimStats.footRefl, result.xExit, result.yExit);
        const mi = muBinIndex(Math.abs(result.dirZ ?? 0));
        const bi = bdfBinIndex(result.dirX, result.dirY, result.dirZ);
        SimStats.muReflBins[mi] += 1;
        SimStats.bdfReflWeights[bi] += 1;
        // Sub-cloud pixel (Phase 4): exact exit-position gate. At f_pix = 1
        // every top-face exit passes (|xExit| ≤ W/2 by the crossing math), so
        // the pixel arrays are bit-identical to the full ones.
        if (Math.abs(result.xExit) <= SimStats._pixelHalfW &&
            Math.abs(result.yExit) <= SimStats._pixelHalfW) {
          SimStats.muReflPixelBins[mi] += 1;
          SimStats.bdfReflPixelWeights[bi] += 1;
        }
        SimStats.reflectedPathLengths.push(result.totalPath ?? 0);
      } else if (result.status === "transmitted") {
        // Terminal at A_s = 0 only: a genuine cloud-base crossing (never
        // clear-direct -- at A_s = 0, surfaceInteraction always returns
        // "surface_absorbed" instead, since the albedo draw can never succeed).
        SimStats.stats.finalTransmitted++;
        SimStats.netTransmittedPathLengths.push(result.totalPath ?? 0);
        SimStats.muTransBaseBins[muBinIndex(Math.abs(result.dirZ ?? 0))] += 1;
        SimStats.bdfTransBaseWeights[bdfBinIndex(result.dirX, result.dirY, result.dirZ)] += 1;
      } else if (result.status === "side_escape") {
        SimStats.stats.side++;
        // Record the escape direction so geometry "b" can reassign it: upward
        // escapes (dirZ < 0) join the reflected channel, downward escapes
        // (dirZ > 0) join the transmitted channel. Geometry "a" ignores these.
        const ei = muBinIndex(Math.abs(result.dirZ ?? 0));
        const eb = bdfBinIndex(result.dirX, result.dirY, result.dirZ);
        if ((result.dirZ ?? 0) < 0) {
          if (result.bypass) {
            // Surface-reflected upward bypass (no cloud face): separate pool so
            // "all_faces" keeps it in S while "scene" folds it into R.
            SimStats.stats.surfaceBypassUp++;
            SimStats.muBypassBins[ei] += 1;
            SimStats.bdfBypassWeights[eb] += 1;
            SimStats.bypassPaths.push(result.totalPath ?? 0);
            // R's (c)/(d) split (see TODO "Component / outcome bookkeeping"):
            // touchedCloud=false => (c) clear-direct (never touched the cloud box
            // at all); touchedCloud=true => (d) today's clear-via-cloud meaning.
            if (result.touchedCloud) {
              SimStats.stats.bypassViaCloud++;
              SimStats.bypassPathsCloudOnly.push(result.totalPath ?? 0);
            } else {
              SimStats.stats.bypassClearDirect++;
            }
          } else {
            SimStats.stats.sideEscapeUp++;
            SimStats.muSideEscUpBins[ei] += 1;
            SimStats.bdfSideEscUpWeights[eb] += 1;
            SimStats.sideEscapeUpPaths.push(result.totalPath ?? 0);
          }
        } else {
          SimStats.stats.sideEscapeDown++;
          SimStats.muSideEscDownBins[ei] += 1;
          SimStats.bdfSideEscDownWeights[eb] += 1;
          SimStats.sideEscapeDownPaths.push(result.totalPath ?? 0);
        }
      } else if (result.status === "surface_absorbed") {
        SimStats.stats.surfaceAbsorbed++;
        // Where the photon was absorbed at the surface (net transmittance, one
        // per absorbed photon). Geometry-independent: all physical landings are
        // binned, including side-derived ones that land beyond the cloud.
        SimStats._addSurfaceFootprint(result.xExit, result.yExit);
        // Route the path AND the angular bin by terminal geometry: a surface
        // absorption reached via a side wall belongs to S under geometry "a",
        // not the transmitted path/angle histograms. (At A_s = 0 this branch
        // is unreachable for the legacy illumination modes -- but NOT for
        // "Uniform domain": clear-direct photons reach surfaceInteraction with
        // no A_s gate, so at A_s = 0 every clear-launched, cloud-missing
        // photon terminates here (verified: ~(1-1/M²)·N of them at Θ₀=0).
        // See review finding E5.)
        // Terminal-event-only mu/BDF binning (v6.0.1 -- see TODO "3.A"): this IS
        // the actual terminal downward arrival (the albedo draw failed, so no
        // further reflection/continuation happens), so its incoming direction
        // (result.dirZ/dirX/dirY, still the arrival direction -- physics.js only
        // reassigns `dir` to the Lambertian direction in the reflection branch)
        // is exactly what should be binned, weight +1, no subtraction ever.
        const ai = muBinIndex(Math.abs(result.dirZ ?? 0));
        const ab = bdfBinIndex(result.dirX, result.dirY, result.dirZ);
        if (result.viaSide) {
          SimStats.sideTransmittedPathLengths.push(result.totalPath ?? 0);
          SimStats.muTransSideBins[ai] += 1;
          SimStats.bdfTransSideWeights[ab] += 1;
          if (result.touchedCloud) {
            SimStats.sideTransmittedPathLengthsCloudOnly.push(result.totalPath ?? 0);
            SimStats.muTransSideCloudOnlyBins[ai] += 1;
            SimStats.bdfTransSideCloudOnlyWeights[ab] += 1;
          }
        } else {
          SimStats.netTransmittedPathLengths.push(result.totalPath ?? 0);
          SimStats.muTransBaseBins[ai] += 1;
          SimStats.bdfTransBaseWeights[ab] += 1;
        }
      } else if (result.status === "terminated") {
        // Photon hit the maxEvents safety cap in physics.js. Counted
        // separately so it can never masquerade as cloud absorption.
        SimStats.stats.terminated++;
      } else {
        SimStats.stats.absorbed++;
        // A_cloud origin split (see TODO "T and A component decomposition"): uses
        // launchRegion (fixed at launch), not touchedCloud, since every A_cloud
        // photon trivially has touchedCloud=true (it's absorbed inside the cloud
        // box) -- the meaningful split is whether it got there directly or was a
        // clear-sky photon recycled in via a surface reflection.
        if (result.launchRegion === "clear") SimStats.stats.absorbedClearRecycled++;
        else                                 SimStats.stats.absorbedCloudIncident++;
      }
    },

    // Recompute and render the left-panel stats text and bottom panel.
    updateDisplay() {
      _drawPanelCallback();

      const s = SimStats.stats;
      const launched = Math.max(s.launched, 1);

      // SURFACE FLUX DIAGNOSTICS are the PHYSICAL surface balance (total, both
      // base- and side-derived), independent of observation geometry.
      const EdownSfc = s.transmitted / launched;
      const EupSfc   = s.surfaceReflected / launched;
      const totalSfcAbs = EdownSfc - EupSfc;           // total surface absorption
      const totalSfcAbsCount = s.transmitted - s.surfaceReflected;

      // FINAL OUTCOMES use the OBSERVED budget under the active observation
      // geometry. Phase 1 = consistent "a": T is base-derived (excludes downward
      // side-wall exits, which move to S). At A_s = 0 these reduce to the totals.
      const Rcount   = SimStats.reflectedCount();
      const Rfinal   = Rcount / launched;
      const Tcount   = SimStats.transmittedNetCount();
      const Tnet     = Tcount / launched;
      const Acloud   = s.absorbed / launched;
      const Scount   = SimStats.sideExitCount();
      const Sfinal   = Scount / launched;
      const Tterm    = s.terminated / launched;

      const finalSumRTAS = Rfinal + Tnet + Acloud + Sfinal + Tterm;
      const meanScat = s.totalScatterings / launched;
      const meanPath = s.totalPath / launched;

      const activeInfo = state.activePhotonID
        ? `Active photon: #${state.activePhotonID}, step ${state.activePhotonStep}/${state.activePhotonTotalSteps}, status=${state.activePhotonStatus}`
        : "Active photon: none";

      const endpointCap  = UI.getEndpointCap();
      // Stored buffer can exceed the display cap (non-destructive filter); the
      // "shown" count is what's actually drawn = min(cap, stored).
      const endpointStored = state.endpointData ? state.endpointData.length : 0;
      const endpointShown = Math.min(endpointCap, endpointStored);
      const bottomMode   = UI.getBottomPanelMode();

      // "ENTIRE DOMAIN" block: only shown for "Uniform domain" illumination (see
      // TODO "Draft: panel & export wording"), independent of the Observation
      // geometry dropdown above.
      const isUniformDomain = UI.getPhotonEntryMode() === "uniform_domain";
      const domainSection = isUniformDomain
        ? "\n" + SimStats.buildDomainBlockText(launched) + "\n\n"
        : "\n";

      // R/T/A component breakdown under FINAL OUTCOMES, for LEGACY illumination
      // modes only (v6.0.1 -- see TODO "2.B/2.C" discussion; Uniform Domain gets
      // the equivalent breakdown via the ENTIRE DOMAIN block above already, so
      // this is skipped there to avoid showing the same numbers twice). Placed
      // AFTER "SURFACE FLUX DIAGNOSTICS" (same slot as domainSection, which it
      // is concatenated with below) so both illumination families order their
      // sections identically: FINAL OUTCOMES -> SURFACE FLUX DIAGNOSTICS ->
      // RADIATIVE COMPONENTS (legacy) / RADIATIVE COMPONENTS: ENTIRE DOMAIN
      // (Uniform Domain) -- per user request, matching the order Uniform
      // Domain already had.
      const componentSection = (!isUniformDomain && UI.getShowDomainComponents())
        ? "\n" + SimStats.buildComponentBreakdownText(launched) + "\n"
        : "";

      // Rendered via innerHTML (not textContent) so the section titles below
      // can be bold-faced with <b>; every interpolated value here is a
      // formatted number, fixed English label, or Greek/Unicode symbol --
      // none can contain "<"/">"/"&", so this is safe without escaping.
      // Indentation below uses non-breaking spaces (same reasoning as
      // buildComponentBreakdownText/buildDomainBlockText -- plain leading
      // spaces are trimmed by this panel's `white-space: pre-line` CSS), and
      // each header's title/parenthetical-subtitle now sit on their own
      // lines (matching the RADIATIVE COMPONENTS style) rather than sharing
      // one line, per user request for visual consistency across sections.
      const IND = "  ";
      // Sub-cloud pixel line (Phase 4). APPLIED value = _pixelFrac (cached at
      // run start); the input is only a request until the next Launch
      // Ensemble/Reset (deferred application), so a pending edit is shown as
      // such rather than resetting the run or mislabeling its data.
      const fPixApplied = SimStats._pixelFrac ?? 1;
      const fPixRequested = UI.getPixelFraction ? UI.getPixelFraction() : 1;
      const pending = Math.abs(fPixRequested - fPixApplied) > 1e-12
        ? ` — pending f_pix=${fPixRequested.toFixed(2)} (applies at next Launch Ensemble/Reset)`
        : "";
      const fPixLine = (fPixApplied < 1 || pending)
        ? `\nReflected obs pixel f_pix: ${fPixApplied.toFixed(2)} (top-face exits in pixel: ${SimStats.pixelReflectedCount()})${pending}`
        : "";
      // Split across two persistent divs (statsTop / statsMain) with the
      // "Show R/T/A components" checkbox as static HTML sitting between them
      // in index.html (see .component-checkbox-row) -- per user request, so
      // the checkbox lives next to the FINAL OUTCOMES/RADIATIVE COMPONENTS
      // text it controls instead of buried in the Visualization section.
      // Splitting this way (rather than string-embedding the checkbox inside
      // one rebuilt innerHTML block) keeps the checkbox a single stable DOM
      // node -- never destroyed/recreated -- so its checked state and
      // keyboard focus survive every updateDisplay() call untouched.
      document.getElementById("statsTop").innerHTML =
`Launched: ${s.launched}
${activeInfo}`;

      document.getElementById("statsMain").innerHTML =
`<b>FINAL OUTCOMES</b>
(observation geometry: ${SimStats.observationGeometryLabel()})
${IND}Reflected flux (albedo), R: ${Rfinal.toFixed(3)} (${Rcount})
${IND}Net flux transmittance (surface absorption), T: ${Tnet.toFixed(3)} (${Tcount})
${IND}Cloud absorption, A: ${Acloud.toFixed(3)} (${s.absorbed})
${IND}Flux exiting cloud sides, S: ${Sfinal.toFixed(3)} (${Scount})
${IND}Terminated (event cap): ${Tterm.toFixed(3)} (${s.terminated})
${IND}R + T + A + S + Term: ${finalSumRTAS.toFixed(3)}

<b>SURFACE FLUX DIAGNOSTICS</b>
(total, physical surface; geometry-independent)
${IND}F_down_sfc: ${EdownSfc.toFixed(3)} (${s.transmitted})
${IND}F_up_sfc: ${EupSfc.toFixed(3)} (${s.surfaceReflected})
${IND}Net surface absorption (F_down_sfc - F_up_sfc): ${totalSfcAbs.toFixed(3)} (${totalSfcAbsCount})
${componentSection}${domainSection}Mean scatterings / photon: ${meanScat.toFixed(2)}
Mean optical path / photon: ${meanPath.toFixed(2)}

τ: ${UI.getTauCloud().toFixed(2)}
Horizontal extent: ${UI.getHorizontalExtent().toFixed(1)}
Θ₀: ${(UI.getTheta0Rad() * 180 / Math.PI).toFixed(1)}°
g: ${UI.getG().toFixed(2)}
ω₀: ${UI.getOmega0().toFixed(2)}
Surface A_s: ${UI.getSurfaceAlbedo().toFixed(2)}${fPixLine}

Endpoint caps shown: ${endpointShown}/${endpointCap}
Fade endpoints: ${UI.getFadeEndpoints() ? "on" : "off"}
Bottom panel: ${bottomMode}
Animate: ${UI.getAnimatePaths() ? "on" : "off"}
Speed: ${UI.getAnimSpeed().toFixed(1)}
Tail length: ${UI.getTailLength()}
Scatter flashes: ${UI.getScatterFlashes() ? "on" : "off"}`;
    }

  };
