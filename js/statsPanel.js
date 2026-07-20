// statsPanel.js — Left-panel stats text presentation (DOM/HTML only).
// CODE-REVIEW R3 (2026-07): split out of simstats.js, which had grown to mix
// pure accumulation (reset/record/combiners) with ~250 lines of DOM/innerHTML
// template-string building. simstats.js returns to "accumulation + combiners"
// as its header comment always claimed; every innerHTML-safety argument (which
// interpolated values can/can't contain "<"/">"/"&") now lives in exactly one
// file, and Node harnesses that only need SimStats's pure-stats surface no
// longer transitively need a `document` stub for this file (though many
// SimStats combiners still call through to UI.* getters, which do read the
// DOM -- only the raw `document.getElementById`/innerHTML calls themselves
// moved out of simstats.js). BottomPanel is wired in via setDrawPanelCallback()
// in main.js, same mechanism as before, just relocated here with the
// presentation code it triggers.
//
// Pure move: every function below is verbatim from simstats.js (only the
// SimStats.* -> StatsPanel.* renaming on the moved functions' own definitions;
// internal calls to combiners/counters like SimStats.rComponents() are
// unchanged, since those stay in simstats.js). No golden-snapshot impact --
// none of this reads/writes RNG state, physics params, or accumulator arrays.

import { state } from './state.js';
import { UI } from './ui.js';
import { SimStats } from './simstats.js';
import { EntryMode } from './constants.js';

let _drawPanelCallback = () => {};
export function setDrawPanelCallback(fn) { _drawPanelCallback = fn; }

export const StatsPanel = {

    // Build the "ENTIRE DOMAIN" stats-panel block text (only called when
    // Illumination = "Uniform domain"; see updateDisplay). Collapsed by default;
    // the component breakdown is appended when "Show domain components" is
    // checked (UI.getShowDomainComponents()), same pattern as "Show surface
    // heatmap". Domain boundary (Phase 3) reflects the actual UI selection.
    buildDomainBlockText(launched) {
      const M = UI.getDomainFactor();
      const fc = UI.getCloudFraction();
      const boundary = UI.getDomainBoundary();
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
      const IND = "  ";

      let text =
`<b>RADIATIVE COMPONENTS: ENTIRE DOMAIN</b>
 (Uniform domain illumination; domain boundary: ${boundary};
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

      // Indentation uses non-breaking spaces ( ), not plain ASCII spaces.
      // This panel's CSS is `white-space: pre-line`, which preserves forced
      // newlines but -- per ordinary CSS whitespace-collapsing rules --
      // trims plain collapsible spaces at the start of every rendered line
      // (wrapped or forced). A leading "  from cloud top:" therefore rendered
      // flush-left with no visible indent.   is explicitly excluded from
      // that collapsing/trimming behavior, so it survives and shows as a
      // real indent. Line breaks in the header below are also placed at the
      // user's own specified points (verified short enough per-line to avoid
      // additional mid-phrase auto-wrap in the panel).
      const IND = "  ";

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

    // Recompute and render the left-panel stats text AND redraw the bottom
    // panel (via the wired callback). Use this for chunk/finish/reset/
    // geometry-toggle refreshes -- anywhere the plotted bins may have changed.
    updateDisplay() {
      _drawPanelCallback();
      StatsPanel.updateStatsText();
    },

    // Text-only refresh (2026-07-19, review P3): rebuilds the two stats-panel
    // innerHTML blocks WITHOUT redrawing the bottom panel. The animation loop
    // (Photons.addAnimatedPath) calls a display update once per path vertex
    // at ~55 fps purely to advance the "Active photon: #N, step i/j" line --
    // routing that through full updateDisplay() recomputed the 19×72 BDF grid
    // (or re-rendered the μ/path canvases) plus the polar canvas repaint on
    // every animation frame. The panel redraw still happens at every chunk
    // boundary, animation finish (the caller's post-await updateDisplay), and
    // on every explicit refresh -- nothing the plots display can change
    // MID-photon, since the photon was already recorded before its animation
    // began.
    updateStatsText() {
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
      const isUniformDomain = UI.getPhotonEntryMode() === EntryMode.UNIFORM_DOMAIN;
      const domainSection = isUniformDomain
        ? "\n" + StatsPanel.buildDomainBlockText(launched) + "\n\n"
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
        ? "\n" + StatsPanel.buildComponentBreakdownText(launched) + "\n"
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
      const IND = "  ";
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
