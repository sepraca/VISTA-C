// simstats.js — Photon outcome statistics accumulation.
// BottomPanel is wired via setDrawPanelCallback() in main.js
// to avoid a circular import.

import { state } from './state.js';

let _drawPanelCallback = () => {};
export function setDrawPanelCallback(fn) { _drawPanelCallback = fn; }

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

    // Per-photon accumulation arrays
    reflectedEndpoints: [],
    reflectedMu: [],
    transmittedMu: [],
    reflectedDirs: [],
    transmittedDirs: [],            // write-only in current code; reserved for future use
    netTransmittedDirs: [],
    reflectedPathLengths: [],
    // Optical paths of photons that delivered energy to the surface:
    // terminal "transmitted" (A_s = 0) or "surface_absorbed" (A_s > 0).
    // Count identically equals the net-transmittance count
    // (transmitted - surfaceReflected), photon for photon.
    netTransmittedPathLengths: [],
    transmittedEndpoints: [],
    surfaceInteractionEvents: [],

    // Reset all counters and arrays to their initial empty state.
    reset() {
      const s = SimStats.stats;
      s.launched = 0; s.reflected = 0; s.transmitted = 0; s.finalTransmitted = 0;
      s.absorbed = 0; s.side = 0; s.terminated = 0; s.surfaceReflected = 0; s.surfaceAbsorbed = 0;
      s.totalScatterings = 0; s.totalPath = 0;
      SimStats.reflectedEndpoints = [];    SimStats.transmittedEndpoints = [];
      SimStats.surfaceInteractionEvents = [];
      SimStats.reflectedMu = [];           SimStats.transmittedMu = [];
      SimStats.reflectedDirs = [];         SimStats.transmittedDirs = [];
      SimStats.netTransmittedDirs = [];
      SimStats.reflectedPathLengths = [];  SimStats.netTransmittedPathLengths = [];
    },

    // Record a downward arrival at the surface plane (independent of surface
    // outcome): a downward cloud-base crossing, or (A_s > 0) a downward
    // side-wall exit that proceeds through clear air to the infinite surface.
    // Called once per arrival, even if the photon is reflected back up.
    registerCloudBaseTransmission(result) {
      SimStats.stats.transmitted++;
      SimStats.transmittedEndpoints.push({x: result.xExit, y: result.yExit});
      SimStats.transmittedMu.push(Math.abs(result.dirZ ?? 0));
      SimStats.transmittedDirs.push({
        x: result.dirX ?? 0,
        y: result.dirY ?? 0,
        z: result.dirZ ?? 0
      });
      // Downward cloud-base crossings contribute weight +1 to the net BDF.
      SimStats.netTransmittedDirs.push({
        x: result.dirX ?? 0,
        y: result.dirY ?? 0,
        z: result.dirZ ?? 0,
        weight: 1
      });
    },

    // Record the final outcome of a completed photon trajectory.
    record(result) {
      SimStats.stats.launched++;
      SimStats.stats.totalScatterings += result.scatterings;
      SimStats.stats.totalPath += result.totalPath;
      SimStats.stats.surfaceReflected += result.surfaceBounceCount ?? 0;

      if (result.status === "reflected") {
        SimStats.stats.reflected++;
        SimStats.reflectedEndpoints.push({x: result.xExit, y: result.yExit});
        SimStats.reflectedMu.push(Math.abs(result.dirZ ?? 0));
        SimStats.reflectedDirs.push({x: result.dirX ?? 0, y: result.dirY ?? 0, z: result.dirZ ?? 0});
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
      const endpointShown = state.endpointGroup ? state.endpointGroup.children.length : 0;
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
