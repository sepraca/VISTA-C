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
      totalPath: 0
    },

    // --- Incremental bin accumulators ---
    muReflBins:     new Float64Array(MU_BINS),
    muNetTransBins: new Float64Array(MU_BINS),          // signed (+down, -up) — TOTAL (base + side)
    muSideTransBins: new Float64Array(MU_BINS),         // side-derived subset of muNetTransBins
    bdfReflWeights: new Float64Array(BDF_THETA_BINS * BDF_PHI_BINS),
    bdfNetWeights:  new Float64Array(BDF_THETA_BINS * BDF_PHI_BINS),   // TOTAL (base + side)
    bdfSideWeights: new Float64Array(BDF_THETA_BINS * BDF_PHI_BINS),   // side-derived subset
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
    sideTransmittedPathLengths: [],         // side-derived surface-deposited paths (reassigned to S under "a", back to T under "b")
    sideEscapeUpPaths: [],                  // GENUINE upward side-wall escapes (join R under all_faces/scene)
    sideEscapeDownPaths: [],                // terminal downward side escapes (join T under all_faces/scene)
    bypassPaths: [],                        // surface-reflected upward bypass (join R only under scene)
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
      SimStats.muReflBins.fill(0);
      SimStats.muNetTransBins.fill(0);
      SimStats.muSideTransBins.fill(0);
      SimStats.bdfReflWeights.fill(0);
      SimStats.bdfNetWeights.fill(0);
      SimStats.bdfSideWeights.fill(0);
      SimStats.muSideEscUpBins.fill(0);
      SimStats.muSideEscDownBins.fill(0);
      SimStats.bdfSideEscUpWeights.fill(0);
      SimStats.bdfSideEscDownWeights.fill(0);
      SimStats.muBypassBins.fill(0);
      SimStats.bdfBypassWeights.fill(0);
      SimStats.footRefl  = {nBins: 0, counts: null};
      SimStats.footTrans = {nBins: 0, counts: null};
      SimStats.footSurfAbs = {nBins: 0, counts: null};
      SimStats.ensureFootprintGrids();
      SimStats.surfaceInteractionEvents = [];
      SimStats.reflectedPathLengths = [];  SimStats.netTransmittedPathLengths = [];
      SimStats.sideTransmittedPathLengths = [];
      SimStats.sideEscapeUpPaths = [];  SimStats.sideEscapeDownPaths = [];
      SimStats.bypassPaths = [];
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
      if (!SimStats._sidesIncluded()) return SimStats.muReflBins;
      const byp = SimStats._bypassInReflected();
      const out = new Float64Array(MU_BINS);
      for (let i = 0; i < MU_BINS; i++)
        out[i] = SimStats.muReflBins[i] + SimStats.muSideEscUpBins[i] + (byp ? SimStats.muBypassBins[i] : 0);
      return out;
    },
    transmittedMuBins() {
      const out = new Float64Array(MU_BINS);
      if (SimStats._sidesIncluded()) {
        for (let i = 0; i < MU_BINS; i++) out[i] = SimStats.muNetTransBins[i] + SimStats.muSideEscDownBins[i];
      } else {
        for (let i = 0; i < MU_BINS; i++) out[i] = SimStats.muNetTransBins[i] - SimStats.muSideTransBins[i];
      }
      return out;
    },
    reflectedBdfWeights() {
      if (!SimStats._sidesIncluded()) return SimStats.bdfReflWeights;
      const byp = SimStats._bypassInReflected();
      const out = new Float64Array(SimStats.bdfReflWeights.length);
      for (let i = 0; i < out.length; i++)
        out[i] = SimStats.bdfReflWeights[i] + SimStats.bdfSideEscUpWeights[i] + (byp ? SimStats.bdfBypassWeights[i] : 0);
      return out;
    },
    transmittedBdfWeights() {
      const out = new Float64Array(SimStats.bdfNetWeights.length);
      if (SimStats._sidesIncluded()) {
        for (let i = 0; i < out.length; i++) out[i] = SimStats.bdfNetWeights[i] + SimStats.bdfSideEscDownWeights[i];
      } else {
        for (let i = 0; i < out.length; i++) out[i] = SimStats.bdfNetWeights[i] - SimStats.bdfSideWeights[i];
      }
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
    // Path-length constituent arrays for the active geometry (returned as a
    // list of segments so consumers iterate without allocating a concat copy).
    reflectedPathSegments() {
      if (!SimStats._sidesIncluded()) return [SimStats.reflectedPathLengths];
      const segs = [SimStats.reflectedPathLengths, SimStats.sideEscapeUpPaths];
      if (SimStats._bypassInReflected()) segs.push(SimStats.bypassPaths);   // scene only
      return segs;
    },
    transmittedPathSegments() {
      return SimStats._sidesIncluded()
        ? [SimStats.netTransmittedPathLengths, SimStats.sideTransmittedPathLengths, SimStats.sideEscapeDownPaths]
        : [SimStats.netTransmittedPathLengths];
    },

    // Record a downward arrival at the surface plane (independent of surface
    // outcome): a downward cloud-base crossing, or (A_s > 0) a downward
    // side-wall exit that proceeds through clear air to the infinite surface.
    // Called once per arrival, even if the photon is reflected back up.
    // Contributes weight +1 to the net-transmitted µ and BDF accumulators.
    registerCloudBaseTransmission(result) {
      SimStats.stats.transmitted++;
      SimStats._addFootprint(SimStats.footTrans, result.xExit, result.yExit);
      const i = muBinIndex(Math.abs(result.dirZ ?? 0));
      const b = bdfBinIndex(result.dirX, result.dirY, result.dirZ);
      SimStats.muNetTransBins[i] += 1;
      SimStats.bdfNetWeights[b] += 1;
      if (result.viaSide) {
        SimStats.stats.transmittedSide++;
        SimStats.muSideTransBins[i] += 1;
        SimStats.bdfSideWeights[b] += 1;
      }
    },

    // Record a Lambertian surface reflection direction: weight -1 in the
    // net-transmitted µ and BDF accumulators (net = down - up). Side-derived
    // reflections (d.viaSide) are also tracked in the side-derived subset.
    registerSurfaceReflection(d) {
      const i = muBinIndex(Math.abs(d.z ?? 0));
      const b = bdfBinIndex(d.x, d.y, d.z);
      SimStats.muNetTransBins[i] -= 1;
      SimStats.bdfNetWeights[b] -= 1;
      if (d.viaSide) {
        SimStats.stats.surfaceReflectedSide++;
        SimStats.muSideTransBins[i] -= 1;
        SimStats.bdfSideWeights[b] -= 1;
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

      if (result.status === "reflected") {
        SimStats.stats.reflected++;
        SimStats._addFootprint(SimStats.footRefl, result.xExit, result.yExit);
        SimStats.muReflBins[muBinIndex(Math.abs(result.dirZ ?? 0))] += 1;
        SimStats.bdfReflWeights[bdfBinIndex(result.dirX, result.dirY, result.dirZ)] += 1;
        SimStats.reflectedPathLengths.push(result.totalPath ?? 0);
      } else if (result.status === "transmitted") {
        SimStats.stats.finalTransmitted++;
        SimStats.netTransmittedPathLengths.push(result.totalPath ?? 0);
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
        // Route the path by terminal geometry: a surface absorption reached via
        // a side wall belongs to S under geometry "a", not the transmitted path
        // histogram. (At A_s = 0 there are no surface absorptions, so this path
        // is never side-derived and the example cases are unaffected.)
        if (result.viaSide) SimStats.sideTransmittedPathLengths.push(result.totalPath ?? 0);
        else                SimStats.netTransmittedPathLengths.push(result.totalPath ?? 0);
      } else if (result.status === "terminated") {
        // Photon hit the maxEvents safety cap in physics.js. Counted
        // separately so it can never masquerade as cloud absorption.
        SimStats.stats.terminated++;
      } else {
        SimStats.stats.absorbed++;
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
      const bottomMode   = document.getElementById("bottomPanelMode")?.value ?? "mu";

      document.getElementById("stats").textContent =
`Launched: ${s.launched}

FINAL OUTCOMES (observation geometry: ${SimStats.observationGeometryLabel()})
Reflected flux (albedo), R: ${Rfinal.toFixed(3)} (${Rcount})
Net flux transmittance (surface absorption), T: ${Tnet.toFixed(3)} (${Tcount})
Cloud absorption, A: ${Acloud.toFixed(3)} (${s.absorbed})
Flux exiting cloud sides, S: ${Sfinal.toFixed(3)} (${Scount})
Terminated (event cap): ${Tterm.toFixed(3)} (${s.terminated})
R + T + A + S + Term: ${finalSumRTAS.toFixed(3)}

SURFACE FLUX DIAGNOSTICS (total, physical surface; geometry-independent)
F_down_sfc: ${EdownSfc.toFixed(3)} (${s.transmitted})
F_up_sfc: ${EupSfc.toFixed(3)} (${s.surfaceReflected})
Net surface absorption (F_down_sfc - F_up_sfc): ${totalSfcAbs.toFixed(3)} (${totalSfcAbsCount})

Mean scatterings / photon: ${meanScat.toFixed(2)}
Mean optical path / photon: ${meanPath.toFixed(2)}

τ: ${UI.getTauCloud().toFixed(2)}
Horizontal extent: ${UI.getHorizontalExtent().toFixed(1)}
Θ₀: ${(UI.getTheta0Rad() * 180 / Math.PI).toFixed(1)}°
g: ${UI.getG().toFixed(2)}
ω₀: ${UI.getOmega0().toFixed(2)}
Surface A_s: ${UI.getSurfaceAlbedo().toFixed(2)}

Endpoint caps shown: ${endpointShown}/${endpointCap}
Fade endpoints: ${UI.getFadeEndpoints() ? "on" : "off"}
Bottom panel: ${bottomMode}
Animate: ${UI.getAnimatePaths() ? "on" : "off"}
Speed: ${UI.getAnimSpeed().toFixed(1)}
Tail length: ${UI.getTailLength()}
Scatter flashes: ${UI.getScatterFlashes() ? "on" : "off"}

${activeInfo}`;
    }

  };
