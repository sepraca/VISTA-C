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
      totalScatterings: 0,
      totalPath: 0
    },

    // --- Incremental bin accumulators ---
    muReflBins:     new Float64Array(MU_BINS),
    muNetTransBins: new Float64Array(MU_BINS),          // signed (+down, -up)
    bdfReflWeights: new Float64Array(BDF_THETA_BINS * BDF_PHI_BINS),
    bdfNetWeights:  new Float64Array(BDF_THETA_BINS * BDF_PHI_BINS),
    // Footprint count grids at the current "Footprint grid" resolution.
    footRefl:  {nBins: 0, counts: null},
    footTrans: {nBins: 0, counts: null},

    // Per-photon arrays retained only where the display needs raw values
    // (path-length axis range adapts to the run); these store plain numbers
    // (compact in JS engines), not objects.
    reflectedPathLengths: [],
    // Optical paths of photons that delivered energy to the surface:
    // terminal "transmitted" (A_s = 0) or "surface_absorbed" (A_s > 0).
    // Count identically equals the net-transmittance count
    // (transmitted - surfaceReflected), photon for photon.
    netTransmittedPathLengths: [],
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
    },

    _addFootprint(f, x, y) {
      if (!f.counts) return;
      const n = f.nBins;
      const ix = Math.floor(((x + world.slabW / 2) / world.slabW) * n);
      const iy = Math.floor(((y + world.slabD / 2) / world.slabD) * n);
      if (ix >= 0 && ix < n && iy >= 0 && iy < n) f.counts[ix * n + iy]++;
    },

    // Reset all counters and accumulators to their initial empty state.
    reset() {
      const s = SimStats.stats;
      s.launched = 0; s.reflected = 0; s.transmitted = 0; s.finalTransmitted = 0;
      s.absorbed = 0; s.side = 0; s.terminated = 0; s.surfaceReflected = 0; s.surfaceAbsorbed = 0;
      s.totalScatterings = 0; s.totalPath = 0;
      SimStats.muReflBins.fill(0);
      SimStats.muNetTransBins.fill(0);
      SimStats.bdfReflWeights.fill(0);
      SimStats.bdfNetWeights.fill(0);
      SimStats.footRefl  = {nBins: 0, counts: null};
      SimStats.footTrans = {nBins: 0, counts: null};
      SimStats.ensureFootprintGrids();
      SimStats.surfaceInteractionEvents = [];
      SimStats.reflectedPathLengths = [];  SimStats.netTransmittedPathLengths = [];
    },

    // Record a downward arrival at the surface plane (independent of surface
    // outcome): a downward cloud-base crossing, or (A_s > 0) a downward
    // side-wall exit that proceeds through clear air to the infinite surface.
    // Called once per arrival, even if the photon is reflected back up.
    // Contributes weight +1 to the net-transmitted µ and BDF accumulators.
    registerCloudBaseTransmission(result) {
      SimStats.stats.transmitted++;
      SimStats._addFootprint(SimStats.footTrans, result.xExit, result.yExit);
      SimStats.muNetTransBins[muBinIndex(Math.abs(result.dirZ ?? 0))] += 1;
      SimStats.bdfNetWeights[bdfBinIndex(result.dirX, result.dirY, result.dirZ)] += 1;
    },

    // Record a Lambertian surface reflection direction: weight -1 in the
    // net-transmitted µ and BDF accumulators (net = down - up).
    registerSurfaceReflection(d) {
      SimStats.muNetTransBins[muBinIndex(Math.abs(d.z ?? 0))] -= 1;
      SimStats.bdfNetWeights[bdfBinIndex(d.x, d.y, d.z)] -= 1;
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
      } else if (result.status === "surface_absorbed") {
        SimStats.stats.surfaceAbsorbed++;
        SimStats.netTransmittedPathLengths.push(result.totalPath ?? 0);
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

      // Cloud transmittance: normalized net transmitted energy at the surface.
      //   T_net = E_down_sfc - E_up_sfc
      // For A_s = 0 this reduces to the original black-surface transmittance.
      const EdownSfc = s.transmitted / launched;
      const EupSfc   = s.surfaceReflected / launched;
      const Rfinal   = s.reflected / launched;
      // No clamp: T_net = A_sfc holds exactly, so a negative value would
      // indicate a bookkeeping bug and should be visible, not masked.
      const Tnet     = EdownSfc - EupSfc;
      const Acloud   = s.absorbed / launched;
      const Asurface = s.surfaceAbsorbed / launched;
      const Sfinal   = s.side / launched;
      const Tterm    = s.terminated / launched;

      const finalSumRTAS = Rfinal + Tnet + Acloud + Sfinal + Tterm;
      const meanScat = s.totalScatterings / launched;
      const meanPath = s.totalPath / launched;

      const activeInfo = state.activePhotonID
        ? `Active photon: #${state.activePhotonID}, step ${state.activePhotonStep}/${state.activePhotonTotalSteps}, status=${state.activePhotonStatus}`
        : "Active photon: none";

      const endpointCap  = UI.getEndpointCap();
      const endpointShown = state.endpointData ? state.endpointData.length : 0;
      const bottomMode   = document.getElementById("bottomPanelMode")?.value ?? "mu";

      document.getElementById("stats").textContent =
`Launched: ${s.launched}

FINAL OUTCOMES
Top reflected R: ${Rfinal.toFixed(3)} (${s.reflected})
Net surface transmittance T: ${Tnet.toFixed(3)} (${(s.transmitted - s.surfaceReflected)})
Cloud absorbed A: ${Acloud.toFixed(3)} (${s.absorbed})
Side escape S: ${Sfinal.toFixed(3)} (${s.side})
Terminated (event cap): ${Tterm.toFixed(3)} (${s.terminated})
R + T + A + S + Term: ${finalSumRTAS.toFixed(3)}

SURFACE ENERGY DIAGNOSTICS
E_down_sfc: ${EdownSfc.toFixed(3)} (${s.transmitted})
E_up_sfc: ${EupSfc.toFixed(3)} (${s.surfaceReflected})
E_down_sfc - E_up_sfc: ${Tnet.toFixed(3)}
Surface absorbed A_sfc: ${Asurface.toFixed(3)} (${s.surfaceAbsorbed})

BOUNDARY / MULTI-PASS DIAGNOSTICS
Down at sfc plane: ${EdownSfc.toFixed(3)} (${s.transmitted})
Surface reflections / photon: ${EupSfc.toFixed(3)} (${s.surfaceReflected})

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
