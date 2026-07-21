// bottomPanel.js — Canvas-based plot drawing: μ histograms, BDF, path-length.

import { SimStats, MU_BINS, BDF_THETA_BINS, BDF_PHI_BINS } from './simstats.js';
import { UI } from './ui.js';
import { state } from './state.js';
import { EntryMode } from './constants.js';

const BDF_LAYOUT = {
    reflectedX:  158,
    transmittedX: 448,
    y:           108,
    radius:       70,
    colorbarX:   594,
    colorbarY:    44,
    colorbarW:    14,
    colorbarH:   125
  };

export const BottomPanel = {
    getHiDpiPanelContext: function(canvas2) {
      // Draw bottom-panel plots at higher internal resolution while preserving
      // the same on-screen CSS size. This keeps text/labels sharper when zoomed
      // and gives cleaner downloaded PNGs.
      const logicalW = 700;
      const logicalH = 245;
      const dpr = Math.max(2, Math.min(4, window.devicePixelRatio || 1));

      const targetW = Math.round(logicalW * dpr);
      const targetH = Math.round(logicalH * dpr);

      if (canvas2.width !== targetW || canvas2.height !== targetH) {
        canvas2.width = targetW;
        canvas2.height = targetH;
        canvas2.style.width = logicalW + "px";
        canvas2.style.height = logicalH + "px";
      }

      const ctx2 = canvas2.getContext("2d");
      ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx2.imageSmoothingEnabled = true;
      ctx2.imageSmoothingQuality = "high";

      return { ctx2, w: logicalW, h: logicalH, dpr };
    },

    drawBottomPanel: function() {
      const panel = document.getElementById("muPanel");
      const title = document.getElementById("muPanelTitle");
      const canvas2 = document.getElementById("muCanvas");
      if (!panel || !canvas2 || !title) return;

      const mode = document.getElementById("bottomPanelMode")?.value ?? "mu";

      if (mode === "hidden") {
        panel.style.display = "none";
        return;
      }

      panel.style.display = "block";

      if (mode === "bdf") {
        // Panel header tracks the active quantity: rigorous BRF/BTF (Phase 4,
        // all illumination modes) vs the domain-mean BDF (entire-domain view).
        const entire = UI.getPhotonEntryMode() === EntryMode.UNIFORM_DOMAIN && UI.getShowEntireDomainPlots();
        title.textContent = entire
          ? "Domain-mean BDF polar plots: exit zenith angle Θ and azimuth φ"
          : "BRF / BTF polar plots: exit zenith angle Θ and azimuth φ";
        BottomPanel.drawBdfOverlay();
      } else if (mode === "path") {
        title.textContent = "Optical path-length distributions";
        BottomPanel.drawPathOverlay();
      } else {
        title.textContent = "Exit-angle histograms: |μ| = |cos(Θ)|";
        BottomPanel.drawMuOverlay();
      }
    },

    drawMuOverlay: function() {
      const canvas2 = document.getElementById("muCanvas");
      if (!canvas2) return;

      const { ctx2, w, h } = BottomPanel.getHiDpiPanelContext(canvas2);

      ctx2.clearRect(0, 0, w, h);

      ctx2.fillStyle = "#000000";
      ctx2.fillRect(0, 0, w, h);

      // Bins are accumulated incrementally in SimStats via a terminal-event-only
      // construction (v6.0.1 -- each photon contributes at most one +1, at the
      // angle of its actual terminal downward arrival; reflections are never
      // binned -- see TODO "3.A"). Under "Uniform domain" illumination, use the
      // cloud-only subset (excludes the clear-direct component, which arrives
      // unscattered at exactly Θ0 and would otherwise dominate this plot as a
      // single degenerate spike). Bit-identical to the full count for legacy
      // illumination modes (touchedCloud is always true there).
      // "Show entire-domain plots" (v6.0) overrides both to the bypass-inclusive,
      // domain-wide view -- independent of the Observation-geometry dropdown,
      // same as the ENTIRE DOMAIN scalar block. Reflected's bypass population is
      // smooth (Lambertian-diffuse escape angle, verified max/median bin ratio
      // 1.67 -- no spike, no fix needed). Net Transmitted's clear-direct
      // population IS a true delta function at Θ0 (verified ~50x the
      // neighboring bins) that would otherwise dominate the bars regardless of
      // scale, so it's excluded from the bars here too (same treatment as the
      // path-length panel, TODO "3.B") and reported as a separate text count
      // instead -- see the clear-direct annotation below.
      const isDomain = UI.getPhotonEntryMode() === EntryMode.UNIFORM_DOMAIN;
      const showEntireDomain = isDomain && UI.getShowEntireDomainPlots();
      // Sub-cloud pixel (Phase 4): when f_pix < 1 the Reflected panel
      // restricts to top-face exits inside the centered pixel (the
      // Observation-geometry dropdown does not apply -- a pixel is only
      // geometrically well-posed on the flat top face). Inert under the
      // entire-domain view.
      // APPLIED pixel fraction (SimStats._pixelFrac, cached at run start) --
      // NOT the live input value, which is only a request until the next
      // Launch Ensemble/Reset (deferred application; editing the input must
      // never invalidate or misdescribe a finished run).
      const fPix = SimStats._pixelFrac ?? 1;
      // Pixel VIEW renders only under "cloud top/base faces only" observation
      // -- a planar pixel is only geometrically well-posed on the flat top
      // face (user feedback 2026-07-16; the TODO's original scoping). The
      // pixel ACCUMULATORS fill whenever f_pix < 1 regardless of the
      // dropdown (f_pix is an acquisition setting; the dropdown is a
      // display-time choice), so toggling the dropdown swaps between the
      // pixel view and the standard side-inclusive view with no re-run.
      const pixelActive = fPix < 1 && !showEntireDomain && !SimStats._sidesIncluded();
      let reflMuBins = showEntireDomain ? SimStats.reflectedMuBinsDomainWide() : SimStats.reflectedMuBins();
      let reflN = showEntireDomain ? SimStats.domainReflectedCount() : SimStats.reflectedCount();
      if (pixelActive) {
        reflMuBins = SimStats.muReflPixelBins;
        reflN = SimStats.pixelReflectedCount();
      }
      // nNetTrans is always the TRUE total (matches the scalar T_domain count),
      // even though the clear-direct spike isn't drawn as a bar under entire domain.
      const nNetTrans = showEntireDomain ? SimStats.domainTransmittedNetCount()
                      : isDomain ? SimStats.transmittedNetCountCloudOnly() : SimStats.transmittedNetCount();
      const transMuBins = showEntireDomain ? SimStats.transmittedMuBinsDomainWideCloudOnly()
                        : isDomain ? SimStats.transmittedMuBinsCloudOnly() : SimStats.transmittedMuBins();
      // "(entire domain)"/"(cloud-only)" per-title suffixes were dropped for
      // the entire-domain case: the exported PNG's domain box now states
      // "Bottom-panel plots: entire domain" once (see getDomainOutputLines in
      // exportUtils.js), so repeating it in both titles was redundant AND was
      // the direct cause of a title-overlap bug the user reported (the two
      // panels sit only 320px apart center-to-center; the longer suffixed
      // titles were long enough to bridge that gap). Same titles now regardless
      // of Observation geometry/entire-domain state, other than the pre-existing
      // "(cloud-only)" note for the default uniform-domain-but-unchecked case.
      const reflLabel = pixelActive ? `Reflected (for f_pix=${fPix.toFixed(2)})` : "Reflected";
      const transMuLabel = (isDomain && !showEntireDomain) ? "Transmitted (net downward, cloud-only)" : "Transmitted (net downward)";
      BottomPanel.drawMuOverlayHistogram(ctx2, reflMuBins, 70, 42, 260, 118, "#60a5fa", reflLabel, reflN);
      BottomPanel.drawMuOverlayHistogram(ctx2, transMuBins, 390, 42, 260, 118, "#86efac", transMuLabel, nNetTrans);

      ctx2.fillStyle = "#e2e8f0";
      ctx2.font = "12px system-ui";
      ctx2.textAlign = "center";
      ctx2.fillText("μ = 1: perpendicular / vertical exit", 200, 222);
      ctx2.fillText("μ = 0: near-horizontal exit", 520, 222);

      // Clear-sky direct count, shown only when relevant (entire-domain view
      // AND at least one such photon exists) -- see the comment above; same
      // pattern as the path-length panel's clear-sky text line.
      if (showEntireDomain) {
        const clearDirectCount = SimStats.tComponents().clearDirect;
        if (clearDirectCount > 0) {
          const pct = nNetTrans ? (100 * clearDirectCount / nNetTrans).toFixed(1) : "0.0";
          ctx2.font = "10px system-ui";
          ctx2.fillStyle = "#94a3b8";
          ctx2.fillText(
            `Clear-sky direct (arrives at exactly Θ₀, excluded from Transmitted bars above): N=${clearDirectCount.toFixed(0)} (${pct}% of total)`,
            w / 2,
            236
          );
        }
      } else if (pixelActive) {
        // (mutually exclusive with the entire-domain note above)
        ctx2.font = "10px system-ui";
        ctx2.fillStyle = "#94a3b8";
        ctx2.fillText(
          `Pixel: cloud-top-face exits with |x|,|y| ≤ f_pix·W/2`,
          w / 2,
          236
        );
      } else if (fPix < 1 && !showEntireDomain) {
        // f_pix accumulated but the side-inclusive observation is selected:
        // point the user at the dropdown setting that shows the pixel view.
        ctx2.font = "10px system-ui";
        ctx2.fillStyle = "#94a3b8";
        ctx2.fillText(
          `f_pix=${fPix.toFixed(2)} accumulated — pixel view shows under Obs geometry "cloud top/base faces only"`,
          w / 2,
          236
        );
      }
    },

    // binCounts: pre-accumulated bin array (length MU_BINS), bin 0 = µ near 1
    // (reversed x-axis). nLabel: the photon/weight count to display as N.
    drawMuOverlayHistogram: function(ctx2, binCounts, x0, y0, width, height, color, title, nLabel) {
      const nBins = MU_BINS;

      // Negative net bins (more upwelling than downwelling) display as zero,
      // consistent with the BDF panel's treatment.
      const counts = Array.from(binCounts, c => Math.max(0, c));

      const maxC = Math.max(...counts, 1);
      const binW = width / nBins;

      // Frame
      ctx2.strokeStyle = "rgba(226,232,240,0.85)";
      ctx2.lineWidth = 1.2;
      ctx2.strokeRect(x0, y0, width, height);

      // Bars
      ctx2.fillStyle = color;
      for (let i = 0; i < nBins; i++) {
        const bh = counts[i] / maxC * (height - 8);
        ctx2.fillRect(x0 + i * binW + 1, y0 + height - bh, Math.max(1, binW - 2), bh);
      }

      // Title and sample count
      ctx2.fillStyle = "#f8fafc";
      ctx2.font = "bold 13px system-ui";
      ctx2.textAlign = "center";
      ctx2.fillText(`${title}  N=${nLabel}`, x0 + width / 2, y0 - 12);

      // Axis tick marks and labels: μ = 1, 0.5, 0.
      const yAxis = y0 + height;
      const xMu1 = x0;
      const xMu05 = x0 + width / 2;
      const xMu0 = x0 + width;

      ctx2.strokeStyle = "rgba(226,232,240,0.65)";
      ctx2.lineWidth = 1.0;
      ctx2.beginPath();
      for (const xTick of [xMu1, xMu05, xMu0]) {
        ctx2.moveTo(xTick, yAxis);
        ctx2.lineTo(xTick, yAxis + 6);
      }
      ctx2.stroke();

      ctx2.fillStyle = "#e2e8f0";
      ctx2.font = "12px system-ui";
      ctx2.textAlign = "center";
      ctx2.fillText("1", xMu1, yAxis + 18);
      ctx2.fillText("0.5", xMu05, yAxis + 18);
      ctx2.fillText("0", xMu0, yAxis + 18);

      // Lowered axis label to avoid overlap with the 0.5 tick label.
      ctx2.fillText("μ = |cos(Θ)|", x0 + width / 2, yAxis + 36);
    },

    smoothNearNadirAzimuth: function(grid, maxThetaDeg=5.0) {
      // At very small zenith angles, azimuth is physically ill-conditioned:
      // many φ bins correspond to almost the same direction (and at θ=0 they all
      // collapse to one direction). Always average across φ for near-nadir rings
      // to suppress Monte Carlo bin noise — this is a display-only cosmetic; the
      // JSON export uses the raw, unaveraged grid.
      for (let ir = 0; ir < grid.thetaBins; ir++) {
        let rowTheta = null;
        for (let ip = 0; ip < grid.phiBins; ip++) {
          const info = grid.binInfo[ir][ip];
          if (info) {
            rowTheta = info.thetaDeg;
            break;
          }
        }

        if (rowTheta === null || rowTheta > maxThetaDeg) continue;

        let sum = 0;
        for (let ip = 0; ip < grid.phiBins; ip++) sum += grid.bdf[ir][ip];
        const avg = sum / grid.phiBins;

        for (let ip = 0; ip < grid.phiBins; ip++) {
          grid.bdf[ir][ip] = avg;
          if (grid.binInfo[ir][ip]) {
            grid.binInfo[ir][ip].bdf = avg;
          }
        }
      }

      // Recompute max after smoothing.
      grid.maxValue = 0;
      for (let ir = 0; ir < grid.thetaBins; ir++) {
        for (let ip = 0; ip < grid.phiBins; ip++) {
          if (grid.bdf[ir][ip] > grid.maxValue) grid.maxValue = grid.bdf[ir][ip];
        }
      }

      return grid;
    },

    mapBdfToColorFraction: function(value) {
      if (value <= 0) return 0;

      // Absolute BDF display:
      // color scale is true BDF from 0 to 1, with values above 1 clipped.
      let x = Math.max(0, Math.min(1, value));

      if (UI.getBdfColorScaleMode() !== "log") {
        return x;
      }

      // Log display from BDF = 0.01 to 1.
      const floor = 0.01;
      const clipped = Math.max(floor, x);
      return Math.log10(clipped / floor) / Math.log10(1 / floor);
    },

    drawPathOverlay: function() {
      const canvas2 = document.getElementById("muCanvas");
      if (!canvas2) return;

      const { ctx2, w, h } = BottomPanel.getHiDpiPanelContext(canvas2);

      ctx2.clearRect(0, 0, w, h);
      ctx2.fillStyle = "#000000";
      ctx2.fillRect(0, 0, w, h);

      // Path arrays are kept per-photon; the active observation geometry returns
      // them as a list of segments (e.g. base-surface paths + downward side
      // escapes under "b"), iterated without allocating a concatenated copy.
      // segMean/axis/binning live in SimStats (shared with the JSON export --
      // review R2), so figure and export can never disagree on the histogram spec.
      const segMean = SimStats.segMean;
      // "Show entire-domain plots" (v6.0) overrides the Observation-geometry
      // dropdown here too, same as the mu-histogram/BDF panels -- always
      // includes side exits + bypass, independent of which of the two dropdown
      // options is selected. See TODO "Second round of live-UI feedback" /
      // the follow-up note on drawPathOverlay() not being wired up initially.
      const isDomainPath = UI.getPhotonEntryMode() === EntryMode.UNIFORM_DOMAIN;
      const showEntireDomainPath = isDomainPath && UI.getShowEntireDomainPlots();
      const reflSegs  = showEntireDomainPath ? SimStats.reflectedPathSegmentsDomainWide() : SimStats.reflectedPathSegments();
      const transSegs = showEntireDomainPath ? SimStats.transmittedPathSegmentsDomainWide() : SimStats.transmittedPathSegments();
      const meanR = segMean(reflSegs);          // TRUE total mean (includes the clear-sky zero-path spike when entire-domain)
      const meanT = segMean(transSegs);

      // Clear-sky direct (touchedCloud=false) photons travel exactly zero
      // optical path (no extinction in the clear-air gap), so under "entire
      // domain" they show up as an exact-zero spike that's real, not a
      // bookkeeping artifact -- and, per TODO "3.B", grows with the domain
      // factor M to the point of eventually dominating the total count. No
      // axis choice can show it proportionally alongside genuine structure, so
      // it's reported as a separate count instead of being forced into the
      // bars. bypassPathsCloudOnly/sideTransmittedPathLengthsCloudOnly hold the
      // touchedCloud=true (genuine) subset; the length difference from the raw
      // arrays is exactly the clear-direct count (see TODO "3.B" verification).
      // `.n` (was `.length`): these are streaming accumulators since review P5;
      // `n` counts every recorded path, zeros included, exactly as the array
      // length did -- so this difference is still the clear-direct count.
      const reflZeroCount  = showEntireDomainPath ? (SimStats.bypassPaths.n - SimStats.bypassPathsCloudOnly.n) : 0;
      const transZeroCount = showEntireDomainPath ? (SimStats.sideTransmittedPathLengths.n - SimStats.sideTransmittedPathLengthsCloudOnly.n) : 0;
      // `.n` (was `.length`): streaming accumulators since review P5. Missing
      // this call site made both panel titles read "N=NaN" (user report,
      // 2026-07-20) -- undefined propagates silently through +, so it is worth
      // grepping for `.length` on any SimStats path population before shipping.
      const reflTotalCount  = reflSegs.reduce((n, h) => n + h.n, 0);
      const transTotalCount = transSegs.reduce((n, h) => n + h.n, 0);

      // The x-axis scale comes from SimStats.pathAxisMax() -- the GENUINE
      // (touchedCloud=true) population, shared with the JSON export (review
      // E2/R2); see that function for the full rationale (TODO "3.B").
      const niceMax = SimStats.pathAxisMax();

      function drawPathHistogram(segs, x0, y0, width, height, color, title, totalCount) {
        const nBins = 24;
        // Shared binning (zero-path entries skipped -- clear-sky direct
        // population, reported separately as text below, not drawn as a bar).
        const counts = SimStats.pathHistogramCounts(segs, niceMax, nBins);

        const maxC = Math.max(1, ...counts);
        const binW = width / nBins;

        // Frame
        ctx2.strokeStyle = "rgba(226,232,240,0.85)";
        ctx2.lineWidth = 1.2;
        ctx2.strokeRect(x0, y0, width, height);

        // Bars
        ctx2.fillStyle = color;
        for (let i = 0; i < nBins; i++) {
          const bh = counts[i] / maxC * (height - 8);
          ctx2.fillRect(x0 + i * binW + 1, y0 + height - bh, Math.max(1, binW - 2), bh);
        }

        // Title -- N is the TRUE total (matching the scalar R_domain/T_domain
        // counts), even though zero-path entries aren't drawn as bars.
        ctx2.fillStyle = "#f8fafc";
        ctx2.font = "bold 13px system-ui";
        ctx2.textAlign = "center";
        ctx2.textBaseline = "alphabetic";
        ctx2.fillText(`${title}  N=${totalCount}`, x0 + width / 2, y0 - 12);

        // Axis ticks and labels
        const yAxis = y0 + height;
        ctx2.strokeStyle = "rgba(226,232,240,0.65)";
        ctx2.lineWidth = 1.0;
        ctx2.beginPath();
        for (const frac of [0, 0.5, 1]) {
          const xTick = x0 + frac * width;
          ctx2.moveTo(xTick, yAxis);
          ctx2.lineTo(xTick, yAxis + 6);
        }
        ctx2.stroke();

        ctx2.fillStyle = "#e2e8f0";
        ctx2.font = "11px system-ui";
        ctx2.textAlign = "center";
        ctx2.fillText("0", x0, yAxis + 18);
        ctx2.fillText((niceMax / 2).toFixed(0), x0 + width / 2, yAxis + 18);
        ctx2.fillText(">" + niceMax.toFixed(0), x0 + width, yAxis + 18);
        ctx2.fillText("optical path length", x0 + width / 2, yAxis + 36);
      }

      // Per-photon paths of energy delivered to the surface: photons whose
      // terminal status is "transmitted" (A_s = 0) or "surface_absorbed"
      // (A_s > 0). Count equals the net-transmittance count exactly.
      // No "(entire domain)" suffix here (see the mu-histogram's reflLabel
      // comment above): the exported PNG's domain box states it once now, so
      // the titles are the same regardless of the toggle -- this also removes
      // the title-overlap risk entirely, rather than just shrinking it (the
      // two panels are centered only 320px apart).
      const reflPathTitle = "Reflected";
      const transPathTitle = "Net transmitted (surface-deposited)";
      drawPathHistogram(reflSegs, 70, 42, 260, 118, "#60a5fa", reflPathTitle, reflTotalCount);
      drawPathHistogram(transSegs, 390, 42, 260, 118, "#86efac", transPathTitle, transTotalCount);

      ctx2.fillStyle = "#e2e8f0";
      ctx2.font = "11px system-ui";
      ctx2.textAlign = "center";
      ctx2.fillText(
        `Mean reflected path=${meanR.toFixed(2)}   |   Mean surface-deposited path=${meanT.toFixed(2)}`,
        w / 2,
        222
      );

      // Clear-sky direct count, shown only when relevant (entire-domain view
      // AND at least one such photon exists) -- see the comment above on why
      // this is reported as text rather than forced into the bars.
      if (showEntireDomainPath && (reflZeroCount > 0 || transZeroCount > 0)) {
        const reflPct  = reflTotalCount  ? (100 * reflZeroCount  / reflTotalCount).toFixed(1)  : "0.0";
        const transPct = transTotalCount ? (100 * transZeroCount / transTotalCount).toFixed(1) : "0.0";
        ctx2.font = "10px system-ui";
        ctx2.fillStyle = "#94a3b8";
        ctx2.fillText(
          `Clear-sky direct (path=0, excluded from bars above): Reflected N=${reflZeroCount} (${reflPct}%)   |   Transmitted N=${transZeroCount} (${transPct}%)`,
          w / 2,
          236
        );
      }
    },

    drawBdfOverlay: function() {
      const canvas2 = document.getElementById("muCanvas");
      if (!canvas2) return;

      const { ctx2, w, h } = BottomPanel.getHiDpiPanelContext(canvas2);

      ctx2.clearRect(0, 0, w, h);

      ctx2.fillStyle = "#000000";
      ctx2.fillRect(0, 0, w, h);

      // Under "Uniform domain" illumination, plot the cloud-only subset (see the
      // mu-histogram comment above for why) -- bit-identical to the full weights
      // for legacy illumination modes. "Show entire-domain plots" (v6.0)
      // overrides both Reflected and Net Transmitted to the bypass-inclusive,
      // domain-wide view. Reflected's bypass population is smooth (Lambertian-
      // diffuse escape angle -- verified, no spike); Net Transmitted's
      // clear-direct population IS a true delta function at Θ0 that would
      // otherwise saturate one bin (verified ~50x its neighbors), so it's
      // excluded from the plotted grid here too (same treatment as the mu-
      // histogram and path-length panels, TODO "3.A"/"3.B") and reported as a
      // separate text count instead.
      const isDomainBdf = UI.getPhotonEntryMode() === EntryMode.UNIFORM_DOMAIN;
      const showEntireDomainBdf = isDomainBdf && UI.getShowEntireDomainPlots();
      const reflectedWeights = showEntireDomainBdf ? SimStats.reflectedBdfWeightsDomainWide() : SimStats.reflectedBdfWeights();
      // No "(entire domain)" suffix (see the mu-histogram's reflLabel comment):
      // the exported PNG's domain box states it once now.
      const reflectedTitle = "Reflected";
      const transmittedWeights = showEntireDomainBdf ? SimStats.transmittedBdfWeightsDomainWideCloudOnly()
                               : isDomainBdf ? SimStats.transmittedBdfWeightsCloudOnly() : SimStats.transmittedBdfWeights();
      const transmittedTitle = (isDomainBdf && !showEntireDomainBdf) ? "Net Transmitted (cloud-only)" : "Net Transmitted";

      // Rigorous BRF/BTF normalization (Phase 4, ALL illumination modes):
      // reference = realized top-face-incident count N_top; side-inclusive
      // observation additionally gets the per-bin A_proj(θᵥ,φᵥ) projection
      // correction. The ENTIRE-DOMAIN view deliberately keeps the historical
      // N-normalization -- for a whole-domain FOV the f_c-diluted value IS the
      // correct domain-mean BDF (see TODO "PHASE ORDER CHANGE" note). For
      // center/top illumination under top-face observation, N_top === N and
      // A_proj ≡ W², so BRF/BTF are bit-identical to the historical BDF (the
      // DISORT-validated cases are unchanged by construction). Guard: N_top
      // can be 0 (pathological but possible at tiny N with large M) -- fall
      // back to the N-normalized BDF with a caption note.
      const nTop = SimStats.nTopIncident();
      const rigorous = !showEntireDomainBdf && nTop > 0;
      const qtyLabel = rigorous ? "BRF / BTF" : "BDF";

      // Sub-cloud pixel (Phase 4): when f_pix < 1, the REFLECTED panel swaps
      // to the pixel-gated weights with N_pixel = N_top·f_pix² as its BRF
      // reference and top-face observation (A_proj ≡ W², sidesIncluded false
      // -- a pixel is only well-posed on the flat top face, so the dropdown
      // does not apply). The transmitted panel is unaffected. Inert under the
      // entire-domain view.
      // APPLIED pixel fraction (see drawMuOverlay) -- not the live input.
      const fPixBdf = SimStats._pixelFrac ?? 1;
      // Same view-gating as drawMuOverlay: pixel view only under top-base
      // observation (planar pixel well-posed on the flat top face only);
      // accumulators are dropdown-independent, so no re-run to toggle.
      const pixelActiveBdf = fPixBdf < 1 && !showEntireDomainBdf && !SimStats._sidesIncluded();
      let reflWeightsUsed = reflectedWeights;
      let reflTitleUsed = reflectedTitle;
      let reflOpts = rigorous
        ? { nRef: nTop, sidesIncluded: SimStats._sidesIncluded() }
        : {};
      if (pixelActiveBdf) {
        reflWeightsUsed = SimStats.bdfReflPixelWeights;
        reflTitleUsed = "Reflected (for f_pix)";
        reflOpts = rigorous ? { nRef: SimStats.nPixelIncident(), sidesIncluded: false } : {};
      }
      const transOpts = rigorous
        ? { nRef: nTop, sidesIncluded: SimStats._sidesIncluded() }
        : {};

      const reflectedGrid = BottomPanel.smoothNearNadirAzimuth(BottomPanel.computeBdfGrid(reflWeightsUsed, reflOpts));
      const transmittedGrid = BottomPanel.smoothNearNadirAzimuth(BottomPanel.computeBdfGrid(transmittedWeights, transOpts));

      BottomPanel.drawBdfPolarPlot(ctx2, reflectedGrid, BDF_LAYOUT.reflectedX, BDF_LAYOUT.y, BDF_LAYOUT.radius, reflTitleUsed);
      BottomPanel.drawBdfPolarPlot(ctx2, transmittedGrid, BDF_LAYOUT.transmittedX, BDF_LAYOUT.y, BDF_LAYOUT.radius, transmittedTitle);
      BottomPanel.drawColorBar(ctx2, BDF_LAYOUT.colorbarX, BDF_LAYOUT.colorbarY, BDF_LAYOUT.colorbarW, BDF_LAYOUT.colorbarH, qtyLabel);

      ctx2.fillStyle = "#e2e8f0";
      ctx2.font = "11px system-ui";
      ctx2.textAlign = "center";
      // Scale text ("linear/log BDF scale: 0-1") dropped (v6.0.1) -- it ran the
      // combined caption off both edges of the export canvas at 700px width,
      // and it's redundant with the color bar's own labeled ticks (0, 0.25,
      // 0.5, 0.75, 1) drawn right next to it. Caption also shortened ("Net
      // down-up at surface..." rather than "Transmitted panel is net
      // down-up...") -- the panel title directly above already says "Net
      // Transmitted", so restating "Transmitted panel is" was redundant too.
      const transCaption = showEntireDomainBdf
        ? "Net down−up at surface (entire domain; excludes clear-direct, see below)"
        : isDomainBdf
        ? "Net down−up at surface (cloud-touched only; excludes clear-direct)"
        : "Net down−up at surface";
      ctx2.fillText(`${transCaption}; near-nadir φ averaged.`, w / 2, 212);

      // Normalization note (Phase 4). The 226-line is free in the rigorous
      // case (the clear-direct note below only draws for entire-domain views).
      if (rigorous) {
        const sideNote = SimStats._sidesIncluded()
          ? "A_proj(θᵥ,φᵥ) side-view corrected"
          : "top-face obs: A_proj=W²";
        ctx2.font = "10px system-ui";
        ctx2.fillStyle = "#94a3b8";
        // Sparse-statistics warning (user feedback, 2026-07-16): at small
        // f_pix (and/or diluted illumination like UD at large M) the pixel
        // grid can hold <2 counts/bin -- the map then reads as clipped
        // speckle (empty bins black, single counts ≥1), not a smooth BRF.
        // The normalization is fine; the statistics aren't. Warn below
        // an average of 2 counts/bin over the 19×72 grid.
        const pixExits = pixelActiveBdf ? SimStats.pixelReflectedCount() : 0;
        const sparse = pixelActiveBdf && pixExits < 2 * BDF_THETA_BINS * BDF_PHI_BINS;
        ctx2.fillText(
          pixelActiveBdf
            ? `BRF(pixel): N_pixel=${SimStats.nPixelIncident().toFixed(0)}, exits=${pixExits}` +
              (sparse ? " — SPARSE (<2/bin): raise N or f_pix" : "") +
              `; BTF: N_top=${nTop}`
            : `BRF/BTF: normalized by top-face-incident N_top=${nTop} (${sideNote})`,
          w / 2,
          226
        );
      } else if (!showEntireDomainBdf) {
        ctx2.font = "10px system-ui";
        ctx2.fillStyle = "#94a3b8";
        ctx2.fillText("N_top=0 — BRF undefined; showing N-normalized BDF.", w / 2, 226);
      }

      // Clear-sky direct count, shown only when relevant -- same pattern as the
      // mu-histogram and path-length panels (TODO "3.A"/"3.B").
      if (showEntireDomainBdf) {
        const clearDirectCount = SimStats.tComponents().clearDirect;
        if (clearDirectCount > 0) {
          const total = SimStats.domainTransmittedNetCount();
          const pct = total ? (100 * clearDirectCount / total).toFixed(1) : "0.0";
          ctx2.font = "10px system-ui";
          ctx2.fillStyle = "#94a3b8";
          ctx2.fillText(
            `Clear-sky direct (arrives at exactly Θ₀, excluded from Transmitted grid above): N=${clearDirectCount.toFixed(0)} (${pct}% of total)`,
            w / 2,
            226
          );
        }
      }
    },

    // Build the displayable BDF/BRF grid from a flat incremental weight array
    // (length BDF_THETA_BINS * BDF_PHI_BINS, accumulated in SimStats).
    //
    // opts (Phase 4, all optional -- omitting them reproduces the historical
    // N-normalized BDF exactly, which remains the correct DOMAIN-MEAN quantity
    // for the entire-domain view and the legacy JSON grids):
    //   nRef          reference incident count (default: all launched photons).
    //                 For the rigorous BRF/BTF this is the realized top-face
    //                 count SimStats.nTopIncident().
    //   sidesIncluded when true, each bin's value is additionally divided by
    //                 A_proj(θᵥ,φᵥ)/W² (SimStats.aProjOverTop) -- the observed
    //                 cloud element includes the side walls, whose ground-
    //                 projected footprint grows with view zenith. For top-face-
    //                 only observation A_proj ≡ W², so this stays false and the
    //                 formula collapses to the plain 1/nRef normalization.
    computeBdfGrid: function(weightsFlat, opts = {}) {
      const thetaBins = BDF_THETA_BINS;
      const phiBins = BDF_PHI_BINS;
      const weights = Array.from({ length: thetaBins }, (_, ir) =>
        Array.from({ length: phiBins }, (_, ip) => weightsFlat[ir * phiBins + ip]));
      const bdf = Array.from({ length: thetaBins }, () => Array(phiBins).fill(0));
      const binInfo = Array.from({ length: thetaBins }, () => Array(phiBins).fill(null));

      const nIncident = Math.max(opts.nRef ?? SimStats.stats.launched, 1);
      const sidesIncluded = opts.sidesIncluded ?? false;
      const dPhi = 2 * Math.PI / phiBins;
      const dTheta = (Math.PI / 2) / (thetaBins - 1);

      let maxValue = 0;

      for (let ir = 0; ir < thetaBins; ir++) {
        const theta0 = Math.max(0, (ir - 0.5) * dTheta);
        const theta1 = Math.min(Math.PI / 2, (ir + 0.5) * dTheta);

        // μ decreases from cos(theta0) to cos(theta1).
        const muUpper = Math.cos(theta0);
        const muLower = Math.cos(theta1);
        const deltaMu = Math.max(1e-12, muUpper - muLower);

        // Use area-weighted mean μ for the bin, i.e. the midpoint in μ-space.
        // This is better behaved than cos(theta_center), especially for wide θ bins.
        const muCenter = Math.max(1e-6, 0.5 * (muUpper + muLower));

        const thetaCenter = Math.acos(Math.max(0, Math.min(1, muCenter)));
        const normFactor = Math.PI / (muCenter * deltaMu * dPhi);

        for (let ip = 0; ip < phiBins; ip++) {
          // Per-bin view-projection correction (1 unless sidesIncluded).
          const aProj = sidesIncluded
            ? SimStats.aProjOverTop(muCenter, ip * dPhi)
            : 1;
          const value = (weights[ir][ip] / (nIncident * aProj)) * normFactor;
          bdf[ir][ip] = value;
          binInfo[ir][ip] = {
            W: weights[ir][ip],
            N: nIncident,
            mu: muCenter,
            deltaMu,
            deltaPhi: dPhi,
            thetaDeg: thetaCenter * 180 / Math.PI,
            phiDeg: ip * 360 / phiBins,
            bdf: value
          };
          if (value > maxValue) maxValue = value;
        }
      }

      let signedWeightSum = 0;
      for (let i = 0; i < weightsFlat.length; i++) signedWeightSum += weightsFlat[i];

      return {
        bdf,
        weights,
        binInfo,
        maxValue,
        signedWeightSum,
        thetaBins,
        phiBins
      };
    },

    drawBdfPolarPlot: function(ctx2, grid, cx, cy, radius, title) {
      const thetaBins = grid.thetaBins;
      const phiBins = grid.phiBins;
      const dTheta = (Math.PI / 2) / (thetaBins - 1);

      // Draw cells as polar annular sectors.
      for (let ir = 0; ir < thetaBins; ir++) {
        const theta0 = Math.max(0, (ir - 0.5) * dTheta);
        const theta1 = Math.min(Math.PI / 2, (ir + 0.5) * dTheta);
        const r0 = radius * theta0 / (Math.PI / 2);
        const r1 = radius * theta1 / (Math.PI / 2);

        for (let ip = 0; ip < phiBins; ip++) {
          const value = grid.bdf[ir][ip];
          if (value <= 0) continue;

          const frac = BottomPanel.mapBdfToColorFraction(value);

          // Draw sector centered at φ = ip * Δφ.
          const dPhi = 2 * Math.PI / phiBins;
          const a0 = -Math.PI / 2 + (ip - 0.5) * dPhi;
          const a1 = -Math.PI / 2 + (ip + 0.5) * dPhi;

          ctx2.beginPath();
          ctx2.arc(cx, cy, r1, a0, a1, false);
          ctx2.arc(cx, cy, r0, a1, a0, true);
          ctx2.closePath();

          ctx2.fillStyle = BottomPanel.bdfColorMap(frac);
          ctx2.fill();
        }
      }

      // Grid rings and spokes
      ctx2.strokeStyle = "rgba(226,232,240,0.62)";
      ctx2.lineWidth = 1;

      for (const deg of [30, 60, 90]) {
        const r = radius * deg / 90;
        ctx2.beginPath();
        ctx2.arc(cx, cy, r, 0, 2 * Math.PI);
        ctx2.stroke();
      }

      for (let deg = 0; deg < 360; deg += 45) {
        const a = -Math.PI / 2 + deg * Math.PI / 180;
        ctx2.beginPath();
        ctx2.moveTo(cx, cy);
        ctx2.lineTo(cx + radius * Math.cos(a), cy + radius * Math.sin(a));
        ctx2.stroke();
      }

      // Outer frame
      ctx2.strokeStyle = "rgba(248,250,252,0.9)";
      ctx2.lineWidth = 1.3;
      ctx2.beginPath();
      ctx2.arc(cx, cy, radius, 0, 2 * Math.PI);
      ctx2.stroke();

      // Labels
      ctx2.fillStyle = "#f8fafc";
      ctx2.font = "bold 13px system-ui";
      ctx2.textAlign = "center";
      ctx2.textBaseline = "middle";
      ctx2.fillText(`${title}  N=${Math.round(grid.signedWeightSum)}`, cx, cy - radius - 28);

      // Angular labels: give them enough clearance from the polar-frame circle.
      ctx2.fillStyle = "#e2e8f0";
      ctx2.font = "10px system-ui";
      ctx2.textAlign = "center";
      ctx2.textBaseline = "middle";
      ctx2.fillText("0°", cx, cy - radius - 12);
      ctx2.fillText("90°", cx + radius + 24, cy);
      ctx2.fillText("180°", cx, cy + radius + 18);
      ctx2.fillText("270°", cx - radius - 28, cy);

      // Radial zenith-angle labels stay inside the plot, offset from the x-axis.
      ctx2.font = "10px system-ui";
      ctx2.fillText("30", cx + radius * 30 / 90 + 10, cy - 4);
      ctx2.fillText("60", cx + radius * 60 / 90 + 12, cy - 4);

      // Restore default baseline for any subsequent canvas text.
      ctx2.textBaseline = "alphabetic";
    },

    drawColorBar: function(ctx2, x, y, w, h, label) {
      const steps = 120;
      const isLog = UI.getBdfColorScaleMode() === "log";

      for (let i = 0; i < steps; i++) {
        const t = i / (steps - 1);
        ctx2.fillStyle = BottomPanel.bdfColorMap(1 - t);
        ctx2.fillRect(x, y + i * h / steps, w, h / steps + 1);
      }

      ctx2.strokeStyle = "#e2e8f0";
      ctx2.lineWidth = 1.0;
      ctx2.strokeRect(x, y, w, h);

      ctx2.fillStyle = "#e2e8f0";
      ctx2.font = "10px system-ui";
      ctx2.textAlign = "left";
      ctx2.textBaseline = "middle";

      function drawTick(value, labelText) {
        let yTick;

        if (isLog) {
          const floor = 0.01;
          const v = Math.max(floor, Math.min(1, value));
          const frac = Math.log10(v / floor) / Math.log10(1 / floor);
          yTick = y + h * (1 - frac);
        } else {
          const frac = Math.max(0, Math.min(1, value));
          yTick = y + h * (1 - frac);
        }

        ctx2.strokeStyle = "#e2e8f0";
        ctx2.lineWidth = 1.0;
        ctx2.beginPath();
        ctx2.moveTo(x + w, yTick);
        ctx2.lineTo(x + w + 4, yTick);
        ctx2.stroke();

        ctx2.fillStyle = "#e2e8f0";
        ctx2.fillText(labelText, x + w + 7, yTick);
      }

      if (isLog) {
        drawTick(1.0, "1.0");
        drawTick(0.1, "0.1");
        drawTick(0.01, "0.01");
      } else {
        drawTick(1.0, "1");
        drawTick(0.75, "0.75");
        drawTick(0.5, "0.5");
        drawTick(0.25, "0.25");
        drawTick(0.0, "0");
      }

      ctx2.save();
      ctx2.translate(x - 28, y + h / 2);
      ctx2.rotate(-Math.PI / 2);
      ctx2.textAlign = "center";
      ctx2.textBaseline = "middle";
      ctx2.fillText(isLog ? `Log ${label}` : label, 0, 0);
      ctx2.restore();
    },


    bdfColorMap: function(t) {
      // Approximate turbo-like map; t in [0,1].
      t = Math.max(0, Math.min(1, t));
      const stops = [
        [0.00, [37, 36, 128]],
        [0.18, [49, 130, 246]],
        [0.38, [34, 211, 238]],
        [0.58, [163, 230, 53]],
        [0.75, [250, 204, 21]],
        [0.90, [249, 115, 22]],
        [1.00, [153, 27, 27]]
      ];

      for (let i = 0; i < stops.length - 1; i++) {
        const [t0, c0] = stops[i];
        const [t1, c1] = stops[i + 1];

        if (t >= t0 && t <= t1) {
          const f = (t - t0) / (t1 - t0);
          const r = Math.round(c0[0] + f * (c1[0] - c0[0]));
          const g = Math.round(c0[1] + f * (c1[1] - c0[1]));
          const b = Math.round(c0[2] + f * (c1[2] - c0[2]));
          return `rgb(${r},${g},${b})`;
        }
      }

      return "rgb(153,27,27)";
    }
  };
