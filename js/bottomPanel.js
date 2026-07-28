// bottomPanel.js — Canvas-based plot drawing: μ histograms, BDF, path-length.

import { SimStats, MU_BINS, BDF_MU_BINS, BDF_PHI_BINS } from './simstats.js';
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
      } else if (mode === "phase") {
        // No panel heading: p(Θs) depends only on the scattering medium, so the
        // run-context heading every other mode carries would be misleading here.
        // The plot's own in-canvas title states band / wavelength / r_eff (or g).
        title.textContent = "";
        BottomPanel.drawPhaseOverlay();
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

    // RETIRED 2026-07-27 (uniform-µ BDF binning).
    //
    // This used to average the BDF across all φ for near-nadir rings, because the old
    // uniform-θ grid gave the θ≈0 rings a vanishing Δµ (~0.001) and therefore almost no
    // photons — the plot centre was pure Monte Carlo noise and had to be cosmetically
    // smoothed. Under uniform-µ binning every bin subtends the SAME solid angle, so the
    // nadir cap collects as many photons as any other bin and needs no special casing.
    // Kept as an identity pass-through so any external caller keeps working; delete once
    // no callers remain.
    smoothNearNadirAzimuth: function(grid) {
      return grid;
    },

    // Colour-scale maximum in use for the CURRENT draw. Set once per overlay by
    // resolveBdfScaleMax() so the polar plots and the colour bar cannot disagree.
    _activeScaleMax: 1.0,

    // Resolve the colour-scale max from the UI. Manual: the user's value.
    // Auto: the 99th percentile of positive bins across the displayed grids --
    // deliberately NOT the raw maximum, since a single sparse bin (common near
    // the limb, or at small f_pix) would otherwise compress everything else.
    resolveBdfScaleMax: function(grids) {
      if (!UI.getBdfScaleAuto()) return UI.getBdfScaleMax();

      const vals = [];
      for (const g of grids) {
        if (!g || !g.bdf) continue;
        for (let ir = 0; ir < g.thetaBins; ir++) {
          for (let ip = 0; ip < g.phiBins; ip++) {
            const v = g.bdf[ir][ip];
            if (v > 0 && Number.isFinite(v)) vals.push(v);
          }
        }
      }
      if (!vals.length) return 1.0;
      vals.sort((a, b) => a - b);
      const p99 = vals[Math.min(vals.length - 1, Math.floor(0.99 * vals.length))];
      return p99 > 0 ? p99 : 1.0;
    },

    mapBdfToColorFraction: function(value) {
      if (value <= 0) return 0;
      // Linear BDF display from 0 to the active scale max, values above clipped.
      const vmax = BottomPanel._activeScaleMax > 0 ? BottomPanel._activeScaleMax : 1.0;
      return Math.max(0, Math.min(1, value / vmax));
    },

    // ---- C6-D: scattering phase function, polar (2026-07-27) ----------------
    //
    // Conventions deliberately match the author's read_pf_netcdf_file.ipynb so the
    // in-app panel and his existing figures are directly comparable:
    //   * polar projection, 0° at TOP, increasing CLOCKWISE
    //     (matplotlib set_theta_zero_location("N") + set_theta_direction(-1))
    //   * theta grid every 45°
    //   * LOG radial axis, 1e-3 … 1e4 (plt.yscale("log"); plt.ylim(1e-3, 1e4))
    //   * the tabulated 0…180° curve MIRRORED into 0…360° so the lobe is drawn
    //     whole (notebook: ang_360 = concat(ang, 360 - ang[-2::-1]))
    //   * radial tick labels offset off-axis (notebook: set_rlabel_position(125))
    //
    // Under Mie the selected (band, r_eff) curve is drawn solid, with an HG curve
    // at the SAME band-averaged g dashed on top -- that comparison is the whole
    // point of the option: HG cannot express the cloudbow (~140°) or the glory
    // (→180°) at ANY g, and the panel makes that immediately visible.
    // Under HG only the analytic curve is drawn.
    //
    // Normalization note -- VERIFIED NUMERICALLY against the shipped tables, because
    // getting it wrong puts the two curves a clean factor of 2 apart and invites a
    // false conclusion about the Mie/HG difference.
    //
    // The Mie tables satisfy Σ wt·pf = 1 with Σ wt = 2 (so the weights carry the
    // ∫dµ measure) and Σ wt·pf·µ = g. Matching that requires the HALF form:
    //   p(µ) = ½ (1−g²)/(1+g²−2gµ)^{3/2}
    // Measured for band 1, r_eff = 10 µm (g = 0.861800): with the ½,
    // Σ wt·pf_HG = 1.000000 and Σ wt·pf_HG·µ = 0.861800 = g exactly; without it,
    // those come out 2.000000 and 1.723600 = 2g.
    _hgPhase: function(muS, g) {
      const d = 1 + g * g - 2 * g * muS;
      return 0.5 * (1 - g * g) / Math.pow(Math.max(d, 1e-12), 1.5);
    },

    drawPhaseOverlay: function() {
      const canvas2 = document.getElementById("muCanvas");
      if (!canvas2) return;
      const { ctx2, w, h } = BottomPanel.getHiDpiPanelContext(canvas2);
      ctx2.clearRect(0, 0, w, h);
      ctx2.fillStyle = "#000000";
      ctx2.fillRect(0, 0, w, h);

      const sel = (state.mie && state.mie.active && state.mie.ready) ? state.mie.sel : null;
      const gHG = sel ? sel.g : UI.getG();

      const cx = w / 2, cy = h / 2 + 6, R = 96;
      const RMIN = 1e-3, RMAX = 1e4;
      const L0 = Math.log10(RMIN), L1 = Math.log10(RMAX);
      const rOf = (p) => {
        if (!(p > 0)) return 0;
        const f = (Math.log10(p) - L0) / (L1 - L0);
        return R * Math.max(0, Math.min(1, f));
      };
      // Θs measured from screen-up, increasing clockwise (see conventions above).
      const pt = (thDeg, p) => {
        const a = -Math.PI / 2 + thDeg * Math.PI / 180;
        const r = rOf(p);
        return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
      };

      // --- decade rings + radial labels ---
      ctx2.strokeStyle = "rgba(226,232,240,0.30)";
      ctx2.lineWidth = 1;
      ctx2.font = "9px system-ui";
      ctx2.textAlign = "left";
      ctx2.textBaseline = "middle";
      // Start one decade in: the innermost decade collapses to r = 0, so its ring
      // is a dot and its label lands on the origin under the curve. Matplotlib
      // suppresses it too, which is why the notebook figure shows 7 labelled
      // decades (1e-2 … 1e4) over the same 1e-3 … 1e4 range.
      for (let e = Math.log10(RMIN) + 1; e <= Math.log10(RMAX); e++) {
        const r = rOf(Math.pow(10, e));
        ctx2.beginPath();
        ctx2.arc(cx, cy, r, 0, 2 * Math.PI);
        ctx2.stroke();
        // rlabel_position(125): labels along the 125° spoke, off the data lobes.
        const a = -Math.PI / 2 + 125 * Math.PI / 180;
        ctx2.fillStyle = "rgba(148,163,184,0.85)";
        ctx2.fillText(`1e${e}`, cx + r * Math.cos(a) + 2, cy + r * Math.sin(a));
      }
      // --- 45° spokes ---
      for (let d = 0; d < 360; d += 45) {
        const a = -Math.PI / 2 + d * Math.PI / 180;
        ctx2.beginPath();
        ctx2.moveTo(cx, cy);
        ctx2.lineTo(cx + R * Math.cos(a), cy + R * Math.sin(a));
        ctx2.stroke();
        ctx2.fillStyle = "#cbd5e1";
        ctx2.textAlign = "center";
        ctx2.fillText(`${d}°`, cx + (R + 13) * Math.cos(a), cy + (R + 13) * Math.sin(a));
      }

      // Draw one curve, mirroring the tabulated 0…180° into 0…360°.
      const drawCurve = (angDeg, pAt, color, dash, width) => {
        ctx2.save();
        ctx2.strokeStyle = color;
        ctx2.lineWidth = width;
        ctx2.setLineDash(dash);
        ctx2.beginPath();
        let started = false;
        const emit = (thDeg, p) => {
          const q = pt(thDeg, p);
          if (!started) { ctx2.moveTo(q.x, q.y); started = true; } else ctx2.lineTo(q.x, q.y);
        };
        for (let i = 0; i < angDeg.length; i++) emit(angDeg[i], pAt(i));
        // mirror: 360 − θ, skipping the 180° endpoint to avoid duplication
        for (let i = angDeg.length - 2; i >= 0; i--) emit(360 - angDeg[i], pAt(i));
        ctx2.closePath();
        ctx2.stroke();
        ctx2.restore();
      };

      if (sel) {
        const ang = sel.angDeg, pf = sel.pf;
        // HG at matched g first, so the Mie curve reads on top.
        drawCurve(ang, (i) => BottomPanel._hgPhase(Math.cos(ang[i] * Math.PI / 180), gHG),
                  "#f97316", [4, 3], 1.0);
        drawCurve(ang, (i) => pf[i], "#e2e8f0", [], 1.4);
      } else {
        const n = 721, ang = new Float64Array(n);
        for (let i = 0; i < n; i++) ang[i] = i * 180 / (n - 1);
        drawCurve(ang, (i) => BottomPanel._hgPhase(Math.cos(ang[i] * Math.PI / 180), gHG),
                  "#f97316", [], 1.4);
      }

      // --- title + legend ---
      ctx2.textAlign = "left";
      ctx2.textBaseline = "alphabetic";
      ctx2.font = "11px system-ui";
      ctx2.fillStyle = "#e2e8f0";
      ctx2.fillText(sel
        ? `Phase Function: MODIS band ${sel.band} (${sel.wavelength_um.toFixed(2)} µm), CER = ${sel.cer.toFixed(1)} µm`
        : `Phase Function: Henyey-Greenstein, g = ${gHG.toFixed(3)}`, 10, 16);
      ctx2.font = "10px system-ui";
      ctx2.fillStyle = "#94a3b8";
      ctx2.fillText("Scattering angle Θs (deg), log radial scale", 10, 31);

      const lx = 10, ly = h - 30;
      const key = (yy, color, dash, label) => {
        ctx2.save();
        ctx2.strokeStyle = color; ctx2.lineWidth = 1.6; ctx2.setLineDash(dash);
        ctx2.beginPath(); ctx2.moveTo(lx, yy); ctx2.lineTo(lx + 22, yy); ctx2.stroke();
        ctx2.restore();
        ctx2.fillStyle = "#cbd5e1";
        ctx2.font = "10px system-ui";
        ctx2.fillText(label, lx + 28, yy + 3);
      };
      if (sel) {
        key(ly, "#e2e8f0", [], `Mie  (g = ${sel.g.toFixed(4)}, ω₀ = ${sel.ssa.toFixed(5)})`);
        key(ly + 14, "#f97316", [4, 3], `Henyey-Greenstein at matched g = ${gHG.toFixed(4)}`);
      } else {
        key(ly + 7, "#f97316", [], `Henyey-Greenstein, g = ${gHG.toFixed(3)}`);
      }
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
      // bars. bypassPathHistCloudOnly/sideTransmittedPathHistCloudOnly hold the
      // touchedCloud=true (genuine) subset; the length difference from the raw
      // arrays is exactly the clear-direct count (see TODO "3.B" verification).
      // `.n` (was `.length`): these are streaming accumulators since review P5;
      // `n` counts every recorded path, zeros included, exactly as the array
      // length did -- so this difference is still the clear-direct count.
      const reflZeroCount  = showEntireDomainPath ? (SimStats.bypassPathHist.n - SimStats.bypassPathHistCloudOnly.n) : 0;
      const transZeroCount = showEntireDomainPath ? (SimStats.sideTransmittedPathHist.n - SimStats.sideTransmittedPathHistCloudOnly.n) : 0;
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

      const reflectedGrid = BottomPanel.computeBdfGrid(reflWeightsUsed, reflOpts);
      const transmittedGrid = BottomPanel.computeBdfGrid(transmittedWeights, transOpts);

      // Resolve the colour-scale max ONCE, from both grids together, so the two
      // polar plots and the shared colour bar are all on the same scale.
      BottomPanel._activeScaleMax =
        BottomPanel.resolveBdfScaleMax([reflectedGrid, transmittedGrid]);

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
      ctx2.fillText(`${transCaption}; uniform-µ bins (equal solid angle).`, w / 2, 212);

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
        // an average of 2 counts/bin over the 45×120 grid.
        const pixExits = pixelActiveBdf ? SimStats.pixelReflectedCount() : 0;
        const sparse = pixelActiveBdf && pixExits < 2 * BDF_MU_BINS * BDF_PHI_BINS;
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
    // (length BDF_MU_BINS * BDF_PHI_BINS, accumulated in SimStats).
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
      const thetaBins = BDF_MU_BINS;
      const phiBins = BDF_PHI_BINS;
      const weights = Array.from({ length: thetaBins }, (_, ir) =>
        Array.from({ length: phiBins }, (_, ip) => weightsFlat[ir * phiBins + ip]));
      const bdf = Array.from({ length: thetaBins }, () => Array(phiBins).fill(0));
      const binInfo = Array.from({ length: thetaBins }, () => Array(phiBins).fill(null));

      const nIncident = Math.max(opts.nRef ?? SimStats.stats.launched, 1);
      const sidesIncluded = opts.sidesIncluded ?? false;
      const dPhi = 2 * Math.PI / phiBins;

      // Uniform-µ grid (2026-07-27): Δµ is CONSTANT, so every bin has the same solid
      // angle Δω = Δµ·Δφ. Row ir spans µ ∈ [1−(ir+1)Δµ, 1−ir·Δµ], nadir-first — this
      // must stay in lockstep with bdfBinIndex() in simstats.js.
      const deltaMu = 1 / thetaBins;

      let maxValue = 0;

      for (let ir = 0; ir < thetaBins; ir++) {
        const muUpper = 1 - ir * deltaMu;              // closer to nadir
        const muLower = Math.max(0, 1 - (ir + 1) * deltaMu);

        const theta0 = Math.acos(Math.max(0, Math.min(1, muUpper)));
        const theta1 = Math.acos(Math.max(0, Math.min(1, muLower)));

        // Midpoint in µ-space = the solid-angle-weighted mean µ of the bin.
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

      // ---- Pixel rasterization (2026-07-27), replacing per-cell sector fills ----
      //
      // The old code stroked one filled canvas path per bin. At 19×72 that was fine
      // (~45 device px² per cell), but the uniform-µ grid puts 5400 cells into the same
      // 70-px-radius disc (~11 px²/cell), and because uniform-µ rings thin toward the
      // limb the outer rings fall to ~2 device px. Canvas anti-aliases every one of
      // those 5400 paths, so each shared edge leaves a partial-coverage seam — 5400
      // seams beating against the pixel grid produced a very visible moiré /
      // "interference" texture in the panel and the exported PNG.
      //
      // Instead we rasterize the disc directly: for every DEVICE pixel, map (x,y) →
      // (θ,φ) → bin, supersampled SS×SS and averaged. There are no paths to anti-alias,
      // so there are no seams; sub-pixel cells area-average correctly instead of
      // aliasing; and it is faster than 5400 arc() fills. Rendering happens on an
      // offscreen canvas at device resolution and is then drawn through the existing
      // transform, so it composites normally over the panel background.
      const deltaMu = 1 / thetaBins;
      const dPhi = 2 * Math.PI / phiBins;

      const dpr = (ctx2.getTransform ? (ctx2.getTransform().a || 1) : 1);
      const size = Math.max(2, Math.ceil(2 * radius * dpr));
      const Rd = size / 2;
      // 3×3 samples/pixel normally; drop to 2×2 on very high-DPI canvases so the
      // per-redraw cost stays bounded (cost ∝ size²·SS²).
      const SS = size > 420 ? 2 : 3;
      const inv = 1 / SS;

      // 257-entry colour LUT so bdfColorMap() (which builds a CSS string) is called
      // once per level rather than once per pixel.
      if (!BottomPanel._lut) {
        BottomPanel._lut = new Uint8Array(258 * 3);
        for (let i = 0; i <= 257; i++) {
          const m = /rgb\((\d+),(\d+),(\d+)\)/.exec(BottomPanel.bdfColorMap(i / 257));
          if (m) {
            BottomPanel._lut[i * 3]     = +m[1];
            BottomPanel._lut[i * 3 + 1] = +m[2];
            BottomPanel._lut[i * 3 + 2] = +m[3];
          }
        }
      }
      const lut = BottomPanel._lut;

      // PERFORMANCE (2026-07-27): the pixel→bin mapping depends ONLY on
      // (size, SS, thetaBins, phiBins) — all constant for the whole run — yet the
      // first version recomputed sqrt/cos/atan2 for every subsample on EVERY
      // redraw. Measured 21 ms per redraw at dpr=2 and 41 ms at dpr=4 (two plots,
      // 3×3 or 2×2 supersampling), which at the panel's refresh cadence is a large
      // share of wall-clock during a live run. It is now precomputed ONCE into a
      // flat Int32Array of bin indices (−1 = outside the disc) and reused, so each
      // redraw is table lookups and adds with no transcendental calls.
      const cache = BottomPanel._rasterCache;
      if (!cache || cache.size !== size || cache.SS !== SS ||
          cache.nT !== thetaBins || cache.nP !== phiBins) {
        const TWO_PI2 = 2 * Math.PI;
        const idx = new Int32Array(size * size * SS * SS);
        let q = 0;
        for (let iy = 0; iy < size; iy++) {
          for (let ix = 0; ix < size; ix++) {
            for (let sy = 0; sy < SS; sy++) {
              const y = iy + (sy + 0.5) * inv - Rd;
              for (let sx = 0; sx < SS; sx++) {
                const x = ix + (sx + 0.5) * inv - Rd;
                const r = Math.sqrt(x * x + y * y);
                if (r > Rd) { idx[q++] = -1; continue; }
                // radius is linear in θ; screen +y is down and φ=0 points "up"
                const theta = (r / Rd) * (Math.PI / 2);
                const mu = Math.cos(theta);
                const ir = Math.min(thetaBins - 1, Math.max(0, Math.floor((1 - mu) * thetaBins)));
                let phi = Math.atan2(x, -y);          // 0 at screen-up, increasing CW
                if (phi < 0) phi += TWO_PI2;
                const ip = Math.min(phiBins - 1, Math.floor(((phi + dPhi / 2) % TWO_PI2) / dPhi));
                idx[q++] = ir * phiBins + ip;
              }
            }
          }
        }
        BottomPanel._rasterCache = { size, SS, nT: thetaBins, nP: phiBins, idx };
      }
      const idx = BottomPanel._rasterCache.idx;

      // Flatten the grid once per redraw (5400 reads) so the inner loop is a
      // single indexed lookup rather than a nested array deref.
      const flat = BottomPanel._flatBuf && BottomPanel._flatBuf.length === thetaBins * phiBins
        ? BottomPanel._flatBuf
        : (BottomPanel._flatBuf = new Float64Array(thetaBins * phiBins));
      for (let ir = 0; ir < thetaBins; ir++) {
        const row = grid.bdf[ir], base = ir * phiBins;
        for (let ip = 0; ip < phiBins; ip++) flat[base + ip] = row[ip];
      }

      // Reuse the offscreen canvas AND its ImageData across redraws. Allocating a
      // fresh <canvas> element plus a size×size ImageData on every redraw is cheap
      // in Node (where neither exists, which is why the first benchmark missed it
      // entirely) but expensive in a browser: at dpr=2 that is a DOM element plus
      // ~313 kB of pixel buffer per plot, twice per redraw, tens of times a second.
      // Keyed on size alone — everything else about the buffer is size-invariant.
      let ob = BottomPanel._offBuf;
      if (!ob || ob.size !== size) {
        const c = document.createElement("canvas");
        c.width = size; c.height = size;
        const cx2 = c.getContext("2d");
        ob = BottomPanel._offBuf = { size, canvas: c, ctx: cx2, img: cx2.createImageData(size, size) };
      }
      const off = ob.canvas, octx = ob.ctx, img = ob.img;
      const px = img.data;

      const SS2 = SS * SS;
      for (let p = 0, q = 0; p < size * size; p++) {
        let acc = 0, hits = 0;
        for (let s = 0; s < SS2; s++, q++) {
          const b = idx[q];
          if (b >= 0) { acc += flat[b]; hits++; }
        }
        if (!hits) continue;                         // outside the disc: leave transparent
        const frac = BottomPanel.mapBdfToColorFraction(acc / hits);
        const li = Math.max(0, Math.min(257, Math.round(frac * 257))) * 3;
        const o = p * 4;
        px[o]     = lut[li];
        px[o + 1] = lut[li + 1];
        px[o + 2] = lut[li + 2];
        px[o + 3] = 255;
      }
      octx.putImageData(img, 0, 0);
      ctx2.drawImage(off, cx - radius, cy - radius, 2 * radius, 2 * radius);

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
      const vmax = BottomPanel._activeScaleMax > 0 ? BottomPanel._activeScaleMax : 1.0;

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

      function drawTick(frac01, labelText) {
        const yTick = y + h * (1 - Math.max(0, Math.min(1, frac01)));

        ctx2.strokeStyle = "#e2e8f0";
        ctx2.lineWidth = 1.0;
        ctx2.beginPath();
        ctx2.moveTo(x + w, yTick);
        ctx2.lineTo(x + w + 4, yTick);
        ctx2.stroke();

        ctx2.fillStyle = "#e2e8f0";
        ctx2.fillText(labelText, x + w + 7, yTick);
      }

      // Ticks are fractions of the active max, labelled with the ABSOLUTE value
      // so the reader always sees real BDF numbers regardless of the scale set.
      const fmt = (v) => (vmax >= 1 ? v.toFixed(2) : vmax >= 0.1 ? v.toFixed(3) : v.toExponential(1));
      for (const f of [1.0, 0.75, 0.5, 0.25, 0.0]) {
        drawTick(f, f === 0 ? "0" : fmt(f * vmax));
      }

      ctx2.save();
      ctx2.translate(x - 28, y + h / 2);
      ctx2.rotate(-Math.PI / 2);
      ctx2.textAlign = "center";
      ctx2.textBaseline = "middle";
      ctx2.fillText(UI.getBdfScaleAuto() ? `${label} (auto)` : label, 0, 0);
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
