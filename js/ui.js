// ui.js — All DOM input readers. Only namespace that touches the DOM for input.

import { DEFAULT_ENDPOINT_MARKERS } from './state.js';

export const UI = {

    // Private helper: reads a numeric input, clamps to [min,max],
    // and shows a warning banner if the value was adjusted.
    _getClampedInput: function(id, minValue, maxValue, fallback, label, integer=false) {
      const el = document.getElementById(id);
      let raw = el ? Number(el.value) : fallback;

      if (Number.isNaN(raw)) {
        raw = fallback;
        if (el) el.value = fallback;
        showLimitWarning(`${label}: invalid value; reset to ${fallback}.`);
      }

      let x = raw;

      if (x < minValue) {
        x = minValue;
        if (el) el.value = integer ? Math.round(x) : x;
        showLimitWarning(`${label}: minimum allowed value is ${minValue}.`);
      } else if (x > maxValue) {
        x = maxValue;
        if (el) el.value = integer ? Math.round(x) : x;
        showLimitWarning(`${label}: maximum allowed value is ${maxValue}.`);
      }

      if (integer) x = Math.round(x);
      return x;
    },

    // --- Physics / geometry inputs ---
    getPhotonCount:       function() { return UI._getClampedInput("photonCount", 1, 10000000, 400, "Photons", true); },
    getTauCloud:          function() { return UI._getClampedInput("tauCloud", 0.1, 100, 10, "Cloud optical thickness τ"); },
    getHorizontalExtent:  function() { return UI._getClampedInput("hExtent", 2, 500, 40, "Horizontal extent"); },
    getTheta0Rad:         function() { return UI._getClampedInput("theta0", 0, 89, 0, "Incident zenith Θ₀") * Math.PI / 180; },
    getG:                 function() { return UI._getClampedInput("gValue", -0.99, 0.99, 0.85, "HG asymmetry g"); },
    getOmega0:            function() { return UI._getClampedInput("omega0", 0, 1, 1, "Single-scattering albedo ω₀"); },
    getSurfaceAlbedo:     function() { return UI._getClampedInput("surfaceAlbedo", 0, 1, 0, "Surface albedo A_s"); },
    getCloudBetaExt:      function() { return UI._getClampedInput("cloudBetaExt", 0.001, 1000, 10.0, "Cloud extinction β_ext"); },
    getSurfaceDistanceKm: function() { return UI._getClampedInput("surfaceDistanceKm", 0, 20, 0.5, "Cloud-base to surface distance"); },

    // Cloud-top incident entry mode:
    //   "center"   — all photons enter at (x,y)=(0,0)  [default; reproducible]
    //   "top"      — uniform over the cloud-top face
    //   "top_side" — uniform over top + sunward side wall, projected-area weighted
    getPhotonEntryMode:   function() { return document.getElementById("photonEntry")?.value ?? "center"; },

    // --- Display / visualization inputs ---
    getMaxPaths:      function() { return UI._getClampedInput("maxPaths", 0, 1000, 250, "Max paths drawn", true); },
    getEndpointCap:   function() { return UI._getClampedInput("endpointCap", 0, 20000, DEFAULT_ENDPOINT_MARKERS, "Endpoint caps shown", true); },
    getFadeEndpoints: function() { const el = document.getElementById("fadeEndpoints"); return el ? el.checked : true; },
    getFootprintGrid: function() { return UI._getClampedInput("footprintGrid", 8, 60, 28, "Footprint grid", true); },

    // --- Animation inputs ---
    getAnimatePaths:  function() { return document.getElementById("animatePaths").checked; },
    getAnimSpeed:     function() { return UI._getClampedInput("animSpeed", 0.1, 10, 1.0, "Animation speed"); },
    getAnimDelay:     function() {
      // Higher speed means shorter delay between animation updates.
      return Math.max(1, Math.round(18 / UI.getAnimSpeed()));
    },
    getTailLength:     function() { return UI._getClampedInput("tailLength", 2, 80, 18, "Tail length", true); },
    getScatterFlashes: function() { return document.getElementById("scatterFlashes").checked; },

    // --- Plot control inputs ---
    getBdfColorScaleMode: function() { return document.getElementById("bdfColorScale")?.value ?? "linear"; },
    getAvgNearNadirBdf:   function() { return document.getElementById("avgNadirBdf")?.checked ?? true; },

    // --- Outcome color map ---
    // Maps a photon exit status string to a Three.js hex color.
    getOutcomeColor: function(status) {
      if (status === "reflected")   return 0x60a5fa;
      if (status === "transmitted") return 0x86efac;
      if (status === "side_escape") return 0xf97316;
      return 0x94a3b8;
    }
  };

// Standalone utility — exported here so both runControl.js and exportUtils.js
// can import it without creating a circular dependency.
export function showLimitWarning(message) {
  const box = document.getElementById("limitWarning");
  if (!box) return;
  box.textContent = message;
  box.style.display = "block";
  clearTimeout(showLimitWarning.timeoutID);
  showLimitWarning.timeoutID = setTimeout(() => {
    box.style.display = "none";
  }, 3600);
}
