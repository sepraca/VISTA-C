// ui.js — All DOM input readers. Only namespace that touches the DOM for input.

import { DEFAULT_ENDPOINT_MARKERS } from './state.js';
import { EntryMode, DEFAULT_ENTRY_MODE, DEFAULT_OBS_GEOM, DomainBoundary, DEFAULT_DOMAIN_BOUNDARY, Status } from './constants.js';

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
    getPhotonCount:       function() { return UI._getClampedInput("photonCount", 1, 10000000, 10000, "Photons", true); },
    getTauCloud:          function() { return UI._getClampedInput("tauCloud", 0.01, 100, 10, "Cloud optical thickness τ"); },
    getHorizontalExtent:  function() { return UI._getClampedInput("hExtent", 2, 500, 40, "Horizontal extent"); },
    getTheta0Rad:         function() { return UI._getClampedInput("theta0", 0, 89, 0, "Incident zenith Θ₀") * Math.PI / 180; },
    getG:                 function() { return UI._getClampedInput("gValue", -0.99, 0.99, 0.85, "HG asymmetry g"); },
    getOmega0:            function() { return UI._getClampedInput("omega0", 0, 1, 1, "Single-scattering albedo ω₀"); },
    getSurfaceAlbedo:     function() { return UI._getClampedInput("surfaceAlbedo", 0, 1, 0, "Surface albedo A_s"); },
    getCloudBetaExt:      function() { return UI._getClampedInput("cloudBetaExt", 0.001, 1000, 10.0, "Cloud extinction β_ext"); },
    getSurfaceDistanceKm: function() { return UI._getClampedInput("surfaceDistanceKm", 0, 20, 0.5, "Cloud-base to surface distance"); },

    // Cloud-top incident entry mode:
    //   "center"         — all photons enter at (x,y)=(0,0)  [default; reproducible]
    //   "top"            — uniform over the cloud-top face
    //   "top_side"       — uniform over top + sunward side wall, projected-area weighted
    //   "uniform_domain" — TOA-uniform launch over the full M·W x M·D domain (see
    //                      getDomainFactor); ray-cast to the first surface (cloud
    //                      top / sunward side / ground). Subsumes "top" at M = 1.
    getPhotonEntryMode:   function() { return document.getElementById("photonEntry")?.value ?? DEFAULT_ENTRY_MODE; },

    // Domain factor M (dimensionless, M >= 1): full domain width = M x cloud
    // width W, centered on the cloud (M x W/2 on each side). Only meaningful
    // when illumination = "uniform_domain"; see TODO-direct-surface-
    // illumination.md, "The core knob: domain factor".
    getDomainFactor:      function() { return UI._getClampedInput("domainFactor", 1, 50, 4, "Domain factor M"); },

    // Cloud fraction f_c = 1/M^2 (areal, 2D) -- NOT the same scaling as M (1D,
    // linear). See TODO "The core knob: domain factor".
    getCloudFraction: function() {
      const M = UI.getDomainFactor();
      return 1 / (M * M);
    },

    // Domain boundary condition (Phase 3), selectable only under "Uniform
    // domain" illumination (same gating as domainFactor): "open" (baseline --
    // isolated launch region in an otherwise-dark infinite clear surface) or
    // "periodic" (the same finite domain tiled infinitely in both horizontal
    // directions -- a regular/broken cloud field; M does double duty as the
    // tile period). See TODO "Domain boundary condition: open vs. periodic".
    getDomainBoundary: function() { return document.getElementById("domainBoundary")?.value ?? DEFAULT_DOMAIN_BOUNDARY; },

    // "Show R/T/A components" checkbox (default off; id retained as
    // "showDomainComponents" for continuity): expands the (a)/(b)/(c)/(d)-style
    // R/T/A component breakdown, same collapsed-by-default pattern as "Show
    // surface heatmap". Two call sites, mutually exclusive per run (see
    // StatsPanel.updateDisplay()): under Illumination = "Uniform domain", expands
    // the ENTIRE DOMAIN block; under any other (legacy) illumination mode,
    // appends the breakdown under FINAL OUTCOMES instead (v6.0.1 -- see TODO
    // "2.B/2.C" discussion). The underlying counters are general-purpose and
    // meaningful whenever A_s > 0, regardless of illumination mode.
    getShowDomainComponents: function() { return document.getElementById("showDomainComponents")?.checked ?? false; },

    // "Show entire-domain plots" checkbox (default off; Illumination = "Uniform
    // domain" only): swaps the bottom panel's Reflected/Net-Transmitted
    // mu-histograms and BDF polar plots from the cloud-element view to the
    // bypass-inclusive, domain-wide view (SimStats.*DomainWide() functions),
    // independent of the Observation-geometry dropdown -- same "always
    // available, unconditional" design as the ENTIRE DOMAIN scalar block. See
    // TODO "Second round of live-UI feedback" for why this exists (the dropdown
    // cleanup had silently removed the only way to see this in the plots).
    getShowEntireDomainPlots: function() { return document.getElementById("showEntireDomainPlots")?.checked ?? false; },

    // Minimum domain factor that avoids under-sampling direct sunward-wall
    // illumination AND keeps ground illumination uniform over the M-domain
    // regardless of tauCloud (2026-07 fix, see TODO "Sunward illumination
    // asymmetry / TOA-altitude coupling"). The domain must extend at least
    // (tau_cloud + beta_ext*d_sfc)*tan(theta0) beyond the cloud edge on the
    // upwind side -- the FULL ballistic throw a photon experiences between
    // cloud-top (tau=0, the launch reference) and the true surface, not just
    // the tau_cloud portion. Derived from
    // M*halfW >= halfW + (tauCloud + betaExt*d_sfc)*tan(theta0)
    //   => M >= 1 + 2*(tauCloud + betaExt*d_sfc)/slabW * tan(theta0).
    // Previously this omitted the beta_ext*d_sfc term entirely, which
    // silently under-flagged cases where the surface gap contributed a
    // non-trivial share of the total throw (e.g. tauCloud=10, theta0=60,
    // default d_sfc=0.5km/betaExt=10 gave a true margin of 2.6km against a
    // 2km buffer at M=2, but the old formula's M_min=1.87 never fired).
    // See TODO, "The core knob: domain factor" for the full derivation and
    // worked examples. RunControl.getSimParams()-equivalent margin is also
    // used directly by Physics.sampleEntryPoint's sunward shift -- keep the
    // two formulas' margin term in sync if either changes.
    //
    // The raw margin term is factored out into getSunwardMargin() (2026-07)
    // so the surface-heatmap/ground-plane rendering fix can share the exact
    // same value (a third consumer, alongside this function and
    // Physics.sampleEntryPoint) instead of risking a fourth hand-copied
    // formula drifting out of sync.
    getMinDomainFactor: function() {
      const slabW = UI.getHorizontalExtent();
      return 1 + 2 * UI.getSunwardMargin() / slabW;
    },

    // The full ballistic sunward throw a photon experiences between cloud-top
    // (tau=0, the launch reference) and the true surface: (tau_cloud +
    // beta_ext*d_sfc)*tan(theta0). Meaningful only under Uniform domain +
    // open boundary (see getMinDomainFactor above and Physics.sampleEntryPoint's
    // sunward shift, which this exact term feeds); callers outside that
    // context should treat it as not applicable rather than calling this
    // unconditionally.
    getSunwardMargin: function() {
      const tauCloud = UI.getTauCloud();
      const theta0   = UI.getTheta0Rad();
      const betaExt  = UI.getCloudBetaExt();
      const dSfc     = UI.getSurfaceDistanceKm();
      return (tauCloud + betaExt * dSfc) * Math.tan(theta0);
    },

    // Live, persistent warning (not the transient showLimitWarning banner):
    // shown whenever illumination = "uniform_domain" and the current M is
    // below getMinDomainFactor() for the current theta0/tauCloud/slabW. Call
    // after any change to photonEntry, domainFactor, domainBoundary, theta0,
    // tauCloud, betaExt, surfaceDistanceKm, or hExtent.
    //
    // 2026-07: getEffectiveDomainFactor() now auto-clamps M up to
    // getMinDomainFactor() at run time, so this box is informational (telling
    // the user what will happen when they run) rather than a "please fix
    // this" alarm -- kept because between runs the displayed M can be stale
    // relative to a just-changed Θ₀/τ_cloud until the next run recomputes it.
    //
    // Open-boundary-only (CODE-REVIEW P2): under periodic tiling there is no
    // under-sampling to warn about -- a TOA point near the tile's leeward
    // edge whose descending ray would miss the home tile's cloud is instead
    // resolved by the wrap-and-retest logic clipping the NEIGHBORING tile's
    // cloud image (the "sunward-wall reservoir" is supplied by the neighbor
    // tile, not absent). See physics.js's third wrap site.
    updateDomainMarginWarning: function() {
      const box = document.getElementById("domainMarginWarning");
      if (!box) return;
      if (UI.getPhotonEntryMode() !== EntryMode.UNIFORM_DOMAIN || UI.getDomainBoundary() === DomainBoundary.PERIODIC) {
        box.style.display = "none";
        return;
      }
      const mMin = UI.getMinDomainFactor();
      const m    = UI.getDomainFactor();
      if (m < mMin - 1e-9) {
        box.textContent = `M = ${m.toFixed(2)} is below M ≈ ${mMin.toFixed(2)}, the minimum needed at this Θ₀/τ_cloud/W to keep sunward-side surface illumination uniform (open boundary). M will be raised to ${mMin.toFixed(2)} automatically when you run.`;
        box.style.display = "block";
      } else {
        box.style.display = "none";
      }
    },

    // Effective domain factor for a run: UI.getDomainFactor(), auto-clamped up
    // to getMinDomainFactor() when illumination = uniform_domain and boundary
    // = open (2026-07 fix -- see TODO "Sunward illumination asymmetry /
    // TOA-altitude coupling"). Previously an under-sized M silently ran with
    // sunward-side illumination under-sampled (verified: COT=10, Θ₀=60°,
    // M=2, default β_ext/d_sfc gave a true margin of 2.6km against a 2km
    // buffer, and the pre-fix M_min formula -- missing the β_ext*d_sfc term
    // -- evaluated to 1.87, below M=2, so it never even warned). Writes the
    // raised value back to the domainFactor input (same convention as
    // _getClampedInput) and surfaces a transient note so the change is
    // visible rather than silent. Periodic boundary is exempt -- no
    // under-sampling to correct there (Physics.wrapAndFindBoxEntry already
    // gives exact, tauCloud-independent uniform coverage via wraparound).
    getEffectiveDomainFactor: function() {
      const m = UI.getDomainFactor();
      if (UI.getPhotonEntryMode() !== EntryMode.UNIFORM_DOMAIN || UI.getDomainBoundary() === DomainBoundary.PERIODIC) {
        return m;
      }
      const mMin = UI.getMinDomainFactor();
      if (m < mMin - 1e-9) {
        const el = document.getElementById("domainFactor");
        if (el) el.value = mMin;
        showLimitWarning(`Domain factor M raised from ${m.toFixed(2)} to ${mMin.toFixed(2)} -- the minimum needed at this Θ₀/τ_cloud/W to keep sunward-side illumination uniform (open boundary).`);
        UI.updateDomainMarginWarning();
        return mMin;
      }
      return m;
    },

    // Show/hide the domain-factor input row: only relevant when illumination
    // = "uniform_domain". Called on photonEntry's onchange (and once at
    // RunControl.init() to sync everything to the loaded selection).
    onIlluminationChange: function() {
      const group = document.getElementById("domainFactorGroup");
      const isUniformDomain = UI.getPhotonEntryMode() === EntryMode.UNIFORM_DOMAIN;
      if (group) group.style.display = isUniformDomain ? "contents" : "none";
      const boundaryGroup = document.getElementById("domainBoundaryGroup");
      if (boundaryGroup) boundaryGroup.style.display = isUniformDomain ? "contents" : "none";
      UI.updateDomainMarginWarning();

      // "Show entire-domain plots" only has any effect under "Uniform domain"
      // illumination (see getShowEntireDomainPlots). Force it off and disable
      // it otherwise, so it can't be left checked-but-inert when switching to a
      // legacy illumination mode -- user feedback: a stale-looking checked box
      // that silently does nothing was confusing. Re-enabled (still unchecked)
      // when switching back to "Uniform domain"; the user re-opts-in each time,
      // same as it starts unchecked on first load.
      const entireDomainBox = document.getElementById("showEntireDomainPlots");
      if (entireDomainBox) {
        if (!isUniformDomain) entireDomainBox.checked = false;
        entireDomainBox.disabled = !isUniformDomain;
      }
      // Dim the label too (see CSS .controls label.dimmed) -- it's a plain
      // sibling element, not a <label for=>-bound control, so disabling the
      // checkbox alone doesn't visually dim it; native disabled-checkbox
      // rendering was also too subtle on its own (see index.html CSS comment).
      const entireDomainLabel = document.getElementById("showEntireDomainPlotsLabel");
      if (entireDomainLabel) entireDomainLabel.classList.toggle("dimmed", !isUniformDomain);

      // Sub-cloud pixel (Phase 4): N_pixel = N_top·f_pix² requires UNIFORM
      // illumination of the top face -- true for "top", "top_side" (its
      // top-face portion is uniform in area), and "uniform_domain"
      // (TOA-uniform); false only for "center" (a point source has no
      // per-area flux to apportion to a pixel). Disable + reset to 1 for
      // centered illumination (same disable/dim pattern as
      // showEntireDomainPlots above). The paired resetScene() on this
      // dropdown's onchange refreshes the record-time cache.
      const pixelOk = UI.getPhotonEntryMode() !== EntryMode.CENTER;
      const pixelInput = document.getElementById("pixelFraction");
      if (pixelInput) {
        if (!pixelOk) pixelInput.value = "1.00";
        pixelInput.disabled = !pixelOk;
      }
      const pixelLabel = document.getElementById("pixelFractionLabel");
      if (pixelLabel) pixelLabel.classList.toggle("dimmed", !pixelOk);
    },

    // Observation geometry: how exits are aggregated into the R/T/S budget and
    // the µ/BDF/path distributions (a pure post-processing choice; does not
    // affect the simulated trajectories). Only 2 values -- the old third value
    // ("Entire scene") never fit as a peer of these two (it needs a clear-sky-
    // sourced photon population that only exists under "Uniform domain"
    // illumination); it's now the always-shown "ENTIRE DOMAIN" stats-panel block
    // instead (see StatsPanel.buildDomainBlockText), independent of this selector.
    //   "top-base_faces" (a) — cloud top/base faces only (sides + surface bypass → S)
    //   "all_faces"      (b) — cloud element: top/base/side faces → R/T; surface-
    //                          reflected upward bypass (no cloud face) stays in S
    getObservationGeometry: function() { return document.getElementById("observationGeometry")?.value ?? DEFAULT_OBS_GEOM; },

    // Sub-cloud observation pixel fraction f_pix (Phase 4): the Reflected
    // μ/BRF panels restrict to cloud-TOP-face exits within the centered pixel
    // |x|,|y| ≤ f_pix·W/2 when f_pix < 1 (pixel area fraction = f_pix²; same
    // 1D-linear/2D-areal relationship as domain factor M / cloud fraction
    // f_c). 1.0 = whole face (bit-identical to the unpixelated view). A pure
    // post-processing-style filter in principle, but the accumulators are
    // gated at record time (fixed pixel size per run -- TODO decision), so
    // changing it resets the run like the other geometry inputs. Available
    // under EVERY illumination mode; BRF normalization uses
    // N_pixel = N_top·f_pix² (approximate for "center", as documented).
    getPixelFraction: function() { return UI._getClampedInput("pixelFraction", 0.05, 1, 1, "Obs pixel fraction f_pix"); },

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
    getBottomPanelMode:   function() { return document.getElementById("bottomPanelMode")?.value ?? "mu"; },
    getBdfColorScaleMode: function() { return document.getElementById("bdfColorScale")?.value ?? "linear"; },
    getShowSurfaceHeatmap: function() { return document.getElementById("showSurfaceHeatmap")?.checked ?? true; },

    // --- Outcome color map ---
    // Maps a photon exit status string to a Three.js hex color.
    getOutcomeColor: function(status) {
      if (status === Status.REFLECTED)       return 0x60a5fa;
      if (status === Status.TRANSMITTED)     return 0x86efac;
      if (status === Status.SIDE_ESCAPE)     return 0xf97316;
      // Surface-absorbed paths (Aₛ>0 terminal event at the Lambertian
      // surface) previously fell through to the same gray as cloud-absorbed
      // ("absorbed") -- indistinguishable in the 3D path view. Match the dark
      // brown already used for these events' markers (Scene.
      // addSurfaceInteractionMarkers()'s non-reflected sphere color; R8,
      // CODE-REVIEW). Cloud-absorbed ("absorbed") intentionally stays gray.
      if (status === Status.SURFACE_ABSORBED) return 0x7c2d12;
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
