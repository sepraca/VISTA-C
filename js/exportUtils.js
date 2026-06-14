// exportUtils.js — PNG download and diagnostic header generation.

import { state, UI_PANEL_WIDTH } from './state.js';
import { SimStats, MU_BINS, BDF_THETA_BINS, BDF_PHI_BINS } from './simstats.js';
import { UI, showLimitWarning } from './ui.js';
import { RNG } from './rng.js';
import { BottomPanel } from './bottomPanel.js';

export const Export = {
    downloadDataURL: function(dataURL, filename) {
      const link = document.createElement("a");
      link.href = dataURL;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    },

    timestampForFilename: function() {
      const d = new Date();
      const pad = n => String(n).padStart(2, "0");
      return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    },

    getOutcomeStatisticLines: function() {
      const launched = Math.max(SimStats.stats.launched, 1);

      // Match the left-hand diagnostic panel exactly:
      // Net surface transmittance is downward surface energy minus upward
      // surface-reflected energy, not simply surface absorption.
      const E_down_sfc_count = SimStats.stats.transmitted;
      const E_up_sfc_count = SimStats.stats.surfaceReflected;
      const Tnet_count = E_down_sfc_count - E_up_sfc_count;

      const R = SimStats.stats.reflected / launched;
      const T = Tnet_count / launched;
      const A = SimStats.stats.absorbed / launched;
      const S = SimStats.stats.side / launched;
      const Term = SimStats.stats.terminated / launched;
      const A_surface = SimStats.stats.surfaceAbsorbed / launched;
      const T_base = SimStats.stats.transmitted / launched;
      const surfaceRefl = SimStats.stats.surfaceReflected / launched;

      return [
        `R=${R.toFixed(3)} (${SimStats.stats.reflected})`,
        `T=${T.toFixed(3)} (${Tnet_count})`,
        `A=${A.toFixed(3)} (${SimStats.stats.absorbed})`,
        `S=${S.toFixed(3)} (${SimStats.stats.side})`,
        `A_sfc=${A_surface.toFixed(3)} (${SimStats.stats.surfaceAbsorbed})`,
        `R+T+A+S+Term=${(R + T + A + S + Term).toFixed(3)}`,
        `T_down_sfc=${T_base.toFixed(3)} (${SimStats.stats.transmitted})`,
        `surface refl/photon=${surfaceRefl.toFixed(3)} (${SimStats.stats.surfaceReflected})`,
        `Term (event cap)=${Term.toFixed(3)} (${SimStats.stats.terminated})`
      ];
    },

    // Human-readable label for the cloud-top photon-entry mode.
    photonEntryLabel: function(mode) {
      return mode === "top"      ? "uniform top"
           : mode === "top_side" ? "uniform top+side"
           : "centered";
    },

    getExportParameterLines: function() {
      return [
        `Photons: ${SimStats.stats.launched}`,
        `COT (τ): ${UI.getTauCloud().toFixed(2)}`,
        `Horizontal extent: ${UI.getHorizontalExtent().toFixed(1)}`,
        `Θ₀: ${(UI.getTheta0Rad() * 180 / Math.PI).toFixed(1)}°`,
        `HG g: ${UI.getG().toFixed(2)}`,
        `SSA (ω₀): ${UI.getOmega0().toFixed(2)}`,
        `Surface Albedo A_s: ${UI.getSurfaceAlbedo().toFixed(2)}`,
        `β_ext: ${UI.getCloudBetaExt().toFixed(2)} km⁻¹`,
        `d_sfc: ${UI.getSurfaceDistanceKm().toFixed(2)} km`,
        `RNG seed: ${RNG.currentSeed()}`,
        `Photon entry: ${Export.photonEntryLabel(UI.getPhotonEntryMode())}`
      ];
    },

    drawExportParameterBox: function(ctx, x, y, options={}) {
      const lines = Export.getExportParameterLines();
      const fontSize = options.fontSize ?? 26;
      const lineH = Math.round(fontSize * 1.38);
      const pad = options.pad ?? 10;
      const title = options.title ?? "Simulation inputs";

      ctx.save();
      ctx.font = `700 ${fontSize}px system-ui, -apple-system, Segoe UI, sans-serif`;
      const titleW = ctx.measureText(title).width;
      ctx.font = `${fontSize}px system-ui, -apple-system, Segoe UI, sans-serif`;
      const maxLineW = Math.max(titleW, ...lines.map(s => ctx.measureText(s).width));
      const boxW = maxLineW + 2 * pad;
      const boxH = (lines.length + 1) * lineH + 2 * pad;

      ctx.fillStyle = options.bg ?? "rgba(15, 23, 42, 0.82)";
      ctx.strokeStyle = options.stroke ?? "rgba(226, 232, 240, 0.75)";
      ctx.lineWidth = 1;
      ctx.fillRect(x, y, boxW, boxH);
      ctx.strokeRect(x, y, boxW, boxH);

      ctx.fillStyle = options.color ?? "#f8fafc";
      ctx.font = `700 ${fontSize}px system-ui, -apple-system, Segoe UI, sans-serif`;
      ctx.fillText(title, x + pad, y + pad + fontSize);

      ctx.font = `${fontSize}px system-ui, -apple-system, Segoe UI, sans-serif`;
      lines.forEach((line, i) => {
        ctx.fillText(line, x + pad, y + pad + lineH * (i + 2));
      });

      ctx.restore();

      return {width: boxW, height: boxH};
    },

    drawLegendDot: function(ctx, x, y, color, label, kind="dot") {
      ctx.save();
      if (kind === "line") {
        ctx.strokeStyle = color;
        ctx.lineWidth = 7;
        ctx.beginPath();
        ctx.moveTo(x, y - 3);
        ctx.lineTo(x + 20, y - 3);
        ctx.stroke();
      } else if (kind === "square") {
        ctx.fillStyle = color;
        ctx.fillRect(x + 4, y - 10, 11, 11);
      } else if (kind === "star") {
        ctx.fillStyle = color;
        ctx.font = "16px system-ui";
        ctx.fillText("✦", x + 4, y - 2);
      } else {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x + 14, y - 8, 9, 0, 2 * Math.PI);
        ctx.fill();
      }
      ctx.fillStyle = "#f8fafc";
      ctx.font = "20px system-ui, -apple-system, Segoe UI, sans-serif";
      ctx.fillText(label, x + 28, y - 2);
      ctx.restore();
    },

    drawExportLegend: function(ctx, x, y) {
      const entries = [
        ["#60a5fa", "Reflected paths", "line"],
        ["#86efac", "Transmitted paths", "line"],
        ["#94a3b8", "Absorbed paths", "line"],
        ["#facc15", "Top reflected endpoints", "dot"],
        ["#22c55e", "Bottom transmitted endpoints", "dot"],
        ["#111827", "Absorption locations", "dot"],
        ["#f97316", "Side boundary escape", "dot"],
        ["#60a5fa", "Reflected 2-D footprint", "square"],
        ["#86efac", "Transmitted 2-D footprint", "square"],
        ["#fff700", "Photon tracer", "line"],
        ["#fef08a", "Scattering flash", "star"]
      ];

      const colW = 340;
      const rowH = 32;
      const rows = Math.ceil(entries.length / 2);
      const pad = 10;
      const boxW = colW * 2 + 2 * pad;
      const boxH = rows * rowH + 2 * pad;

      ctx.save();
      ctx.fillStyle = "rgba(71, 85, 105, 0.88)";
      ctx.strokeStyle = "rgba(203, 213, 225, 0.7)";
      ctx.lineWidth = 1;
      ctx.fillRect(x, y, boxW, boxH);
      ctx.strokeRect(x, y, boxW, boxH);

      entries.forEach((e, idx) => {
        const col = idx < rows ? 0 : 1;
        const row = idx < rows ? idx : idx - rows;
        Export.drawLegendDot(ctx, x + pad + col * colW, y + pad + row * rowH + 14, e[0], e[1], e[2]);
      });
      ctx.restore();

      return {width: boxW, height: boxH};
    },

    autoCropCanvas: function(canvas, options={}) {
      const ctx = canvas.getContext("2d");
      const w = canvas.width;
      const h = canvas.height;
      const img = ctx.getImageData(0, 0, w, h);
      const data = img.data;

      // Background is the dark scene color (#0f172a ~= 15,23,42).
      // Treat pixels sufficiently different from that as content.
      const bg = options.bg ?? [15, 23, 42];
      const threshold = options.threshold ?? 18;
      const pad = options.pad ?? 55;

      let minX = w, minY = h, maxX = -1, maxY = -1;

      for (let y = 0; y < h; y += 2) {
        for (let x = 0; x < w; x += 2) {
          const k = (y * w + x) * 4;
          const r = data[k], g = data[k + 1], b = data[k + 2], a = data[k + 3];

          if (a < 10) continue;

          const diff = Math.abs(r - bg[0]) + Math.abs(g - bg[1]) + Math.abs(b - bg[2]);

          if (diff > threshold) {
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
          }
        }
      }

      if (maxX < minX || maxY < minY) {
        return canvas;
      }

      minX = Math.max(0, minX - pad);
      minY = Math.max(0, minY - pad);
      maxX = Math.min(w - 1, maxX + pad);
      maxY = Math.min(h - 1, maxY + pad);

      const cropW = maxX - minX + 1;
      const cropH = maxY - minY + 1;

      const out = document.createElement("canvas");
      out.width = cropW;
      out.height = cropH;
      const outCtx = out.getContext("2d");
      outCtx.drawImage(canvas, minX, minY, cropW, cropH, 0, 0, cropW, cropH);

      return out;
    },

    download3DView: function() {
      try {
        state.renderer.render(state.scene, state.camera);

        const source = state.renderer.domElement;
        const dpr = state.renderer.getPixelRatio();
        const panelPx = Math.round(UI_PANEL_WIDTH * dpr); // UI panel width in physical pixels
        const viewW = source.width - panelPx;

        const canvasOut = document.createElement("canvas");
        canvasOut.width = viewW;
        canvasOut.height = source.height;
        const ctx = canvasOut.getContext("2d");

        // Draw only the visible 3D viewport (right of the UI panel).
        ctx.drawImage(source, panelPx, 0, viewW, source.height, 0, 0, viewW, source.height);

        // Add context overlays: legend, key run inputs, and outcome statistics.
        Export.drawExportLegend(ctx, canvasOut.width - 760, 55);
        const paramBox = Export.drawExportParameterBox(ctx, 180, 55, {fontSize: 26});

        // Outcome statistics below the parameter box.
        const outcome = Export.getOutcomeStatisticLines();
        const statFontSize = 24;
        const statLineH = Math.round(statFontSize * 1.38);
        const statX = 180 + paramBox.width + 12;
        const statY = 55;
        ctx.save();
        ctx.font = `700 ${statFontSize}px system-ui, -apple-system, Segoe UI, sans-serif`;
        const statColor = "#bfdbfe";
        ctx.fillStyle = "rgba(15, 23, 42, 0.82)";
        ctx.strokeStyle = "rgba(226, 232, 240, 0.75)";
        ctx.lineWidth = 1;
        // Measure width from the longest of the 3 rows
        const row1 = outcome.slice(0, 4).join(" ,   ");
        const row2 = outcome.slice(4, 6).join(" ,   ");
        const row3 = outcome.slice(6, 9).join(" ,   ");
        const statPad = 10;
        const statW = Math.max(ctx.measureText(row1).width,
                               ctx.measureText(row2).width,
                               ctx.measureText(row3).width) + 2 * statPad;
        const statH = 3 * statLineH + 2 * statPad;
        ctx.fillRect(statX, statY, statW, statH);
        ctx.strokeRect(statX, statY, statW, statH);
        ctx.fillStyle = statColor;
        ctx.fillText(row1, statX + statPad, statY + statPad + statFontSize);
        ctx.fillText(row2, statX + statPad, statY + statPad + statFontSize + statLineH);
        ctx.fillText(row3, statX + statPad, statY + statPad + statFontSize + 2 * statLineH);
        ctx.restore();

        const cropped = Export.autoCropCanvas(canvasOut, {pad: 70});
        const dataURL = cropped.toDataURL("image/png");
        Export.downloadDataURL(dataURL, `mc_cloud_rt_3d_view_${Export.timestampForFilename()}.png`);
      } catch (err) {
        showLimitWarning("Unable to export 3D view. Browser may be blocking canvas export.");
        console.error(err);
      }
    },

    downloadBottomPanel: function() {
      try {
        BottomPanel.drawBottomPanel();
        const canvas2 = document.getElementById("muCanvas");
        if (!canvas2) {
          showLimitWarning("Bottom panel canvas was not found.");
          return;
        }

        const mode = document.getElementById("bottomPanelMode")?.value ?? "panel";

        // Export at the panel's high-DPI native resolution.
        // Header is large enough for key settings plus outcome diagnostics.
        const scale = canvas2.width / 700;
        const headerH = Math.round(236 * scale);
        const canvasOut = document.createElement("canvas");
        canvasOut.width = canvas2.width;
        canvasOut.height = canvas2.height + headerH;
        const ctx = canvasOut.getContext("2d");

        // Black export background.
        ctx.fillStyle = "#000000";
        ctx.fillRect(0, 0, canvasOut.width, canvasOut.height);

        // Header with key run inputs.
        ctx.fillStyle = "#f8fafc";
        ctx.font = `bold ${Math.round(16 * scale)}px system-ui, -apple-system, Segoe UI, sans-serif`;
        const title = mode === "bdf" ? "BDF polar plots" : (mode === "path" ? "Optical path-length distributions" : "μ histograms");
        ctx.fillText(title, 14 * scale, 30 * scale);

        ctx.font = `${Math.round(13 * scale)}px system-ui, -apple-system, Segoe UI, sans-serif`;
        const lines = Export.getExportParameterLines();
        const outcome = Export.getOutcomeStatisticLines();

        // Settings rows (11 lines incl. Photon entry: 3 / 3 / 3 / 2 across four rows)
        ctx.fillText(lines.slice(0, 3).join(" ,   "), 14 * scale, 62 * scale);
        ctx.fillText(lines.slice(3, 6).join(" ,   "), 14 * scale, 88 * scale);
        ctx.fillText(lines.slice(6, 9).join(" ,   "), 14 * scale, 114 * scale);
        ctx.fillText(lines.slice(9, 11).join(" ,   "), 14 * scale, 140 * scale);

        // Outcome statistics rows (3 lines to prevent truncation)
        ctx.fillStyle = "#bfdbfe";
        ctx.font = `bold ${Math.round(13 * scale)}px system-ui, -apple-system, Segoe UI, sans-serif`;
        ctx.fillText(outcome.slice(0, 4).join(" ,   "), 14 * scale, 168 * scale);
        ctx.fillText(outcome.slice(4, 6).join(" ,   "), 14 * scale, 194 * scale);
        ctx.fillText(outcome.slice(6, 9).join(" ,   "), 14 * scale, 220 * scale);

        ctx.drawImage(canvas2, 0, headerH);

        const dataURL = canvasOut.toDataURL("image/png");
        Export.downloadDataURL(dataURL, `mc_cloud_rt_${mode}_panel_${Export.timestampForFilename()}.png`);
      } catch (err) {
        showLimitWarning("Unable to export bottom panel.");
        console.error(err);
      }
    },

    // ---------------------------------------------------------------------
    // Quantitative data export (JSON).
    //
    // Companion to the two PNG exporters: writes the same diagnostic content
    // in a machine-readable, full-precision form for quantitative comparison
    // against other codes (e.g. DISORT). The schema is self-describing — every
    // vector ships with its own bin coordinates/edges so it can be read with
    // no knowledge of the simulator's internals. A Python reader
    // (mc_export_reader.py) loads this file and can convert it to xarray/NetCDF.
    //
    // Design notes:
    //   * Values are exported at full double precision (NOT the toFixed(3)
    //     used in the PNG headers), since quantitative comparison is the point.
    //   * BDF is exported as BOTH the raw signed bin weights and the normalized
    //     BDF = (W/N)·π/(µ·Δµ·Δφ). The normalized grid is the UNSMOOTHED
    //     quantity (near-nadir azimuthal averaging is a display-only cosmetic),
    //     so it is the ground truth for DISORT comparison.
    //   * Path-length distributions are exported as fixed-bin histograms that
    //     reproduce the on-screen panel exactly (24 bins, same adaptive max,
    //     long tail clipped into the final overflow bin) plus the true means.
    SCHEMA_VERSION: "1.0",

    getExportDataObject: function() {
      const s = SimStats.stats;
      const launched = Math.max(s.launched, 1);

      // --- Inputs (full precision; mirrors getExportParameterLines) ---
      const theta0Rad = UI.getTheta0Rad();
      const inputs = {
        photons: s.launched,
        tau_cloud: UI.getTauCloud(),
        horizontal_extent: UI.getHorizontalExtent(),
        theta0_deg: theta0Rad * 180 / Math.PI,
        mu0: Math.cos(theta0Rad),
        hg_g: UI.getG(),
        ssa_omega0: UI.getOmega0(),
        surface_albedo: UI.getSurfaceAlbedo(),
        beta_ext_km: UI.getCloudBetaExt(),
        surface_distance_km: UI.getSurfaceDistanceKm(),
        photon_entry: UI.getPhotonEntryMode(),   // "center" | "top" | "top_side"
        rng_seed: RNG.currentSeed(),
        units: {
          tau_cloud: "optical depth (dimensionless)",
          horizontal_extent: "optical depth (slab width in τ-units)",
          theta0_deg: "degrees", mu0: "cos(zenith)",
          beta_ext_km: "km^-1", surface_distance_km: "km"
        }
      };

      // --- Outputs (counts + normalized fluxes; mirrors the stats panel) ---
      const netTransCount = s.transmitted - s.surfaceReflected;
      const R = s.reflected / launched;
      const Tnet = netTransCount / launched;
      const A = s.absorbed / launched;
      const S = s.side / launched;
      const Term = s.terminated / launched;
      const outputs = {
        counts: {
          launched: s.launched,
          reflected: s.reflected,
          transmitted_down_at_surface: s.transmitted,
          final_transmitted_black_surface: s.finalTransmitted,
          cloud_absorbed: s.absorbed,
          side_escape: s.side,
          terminated_event_cap: s.terminated,
          surface_reflected: s.surfaceReflected,
          surface_absorbed: s.surfaceAbsorbed,
          net_transmitted: netTransCount
        },
        fluxes: {
          R_top_reflected: R,
          T_net_surface: Tnet,
          A_cloud_absorbed: A,
          S_side_escape: S,
          Term_event_cap: Term,
          closure_R_T_A_S_Term: R + Tnet + A + S + Term,
          A_surface_absorbed: s.surfaceAbsorbed / launched,
          T_down_at_surface: s.transmitted / launched,
          surface_reflections_per_photon: s.surfaceReflected / launched
        },
        mean_scatterings_per_photon: s.totalScatterings / launched,
        mean_optical_path_per_photon: s.totalPath / launched,
        notes: "Fluxes are per launched photon (analog MC, weight 1). " +
               "T_net = (downward at surface − upward surface reflection) and " +
               "equals A_surface for a non-absorbing surface by energy closure."
      };

      // --- µ exit-angle histograms ---
      // Binning (must match simstats.muBinIndex): bin i covers
      //   µ ∈ ( 1 − (i+1)/MU_BINS , 1 − i/MU_BINS ];  bin 0 is µ near 1.
      const muEdges = [];
      for (let i = 0; i <= MU_BINS; i++) muEdges.push(1 - i / MU_BINS);
      const muCenters = [];
      for (let i = 0; i < MU_BINS; i++) muCenters.push(1 - (i + 0.5) / MU_BINS);
      const mu_histograms = {
        description: "Exit-angle histograms in |µ| = |cos Θ|. Reversed axis: " +
                     "bin 0 is near-vertical (µ→1), last bin near-horizontal (µ→0). " +
                     "net_transmitted_counts are signed (+1 downward arrival at " +
                     "surface, −1 surface reflection); identical to gross when A_s=0.",
        n_bins: MU_BINS,
        mu_bin_edges: muEdges,           // length n_bins+1, descending 1→0
        mu_bin_centers: muCenters,       // length n_bins
        reflected_counts: Array.from(SimStats.muReflBins),
        net_transmitted_counts: Array.from(SimStats.muNetTransBins),
        reflected_N: s.reflected,
        net_transmitted_N: netTransCount
      };

      // --- BDF (bidirectional distribution function) ---
      // Reuse the display grid builder to guarantee identical normalization,
      // but take the UNSMOOTHED grids (no near-nadir averaging) as ground truth.
      const reflGrid = BottomPanel.computeBdfGrid(SimStats.bdfReflWeights);
      const netGrid  = BottomPanel.computeBdfGrid(SimStats.bdfNetWeights);

      const thetaCentersDeg = [], muCentersBdf = [], deltaMu = [];
      for (let ir = 0; ir < BDF_THETA_BINS; ir++) {
        const info = reflGrid.binInfo[ir][0];
        thetaCentersDeg.push(info.thetaDeg);
        muCentersBdf.push(info.mu);
        deltaMu.push(info.deltaMu);
      }
      const phiCentersDeg = [];
      for (let ip = 0; ip < BDF_PHI_BINS; ip++) phiCentersDeg.push(netGrid.binInfo[0][ip].phiDeg);

      const bdf = {
        description: "Bidirectional distribution function BDF = (W/N)·π/(µ·Δµ·Δφ). " +
                     "Rows are exit zenith Θ bins (0,5,…,90°), columns azimuth φ " +
                     "bins (0,5,…,355°). 'weights' are raw signed bin tallies W; " +
                     "'bdf' is the normalized function. Transmitted panels are net " +
                     "(down−up) at the surface. Unsmoothed (display near-nadir " +
                     "averaging not applied).",
        n_theta_bins: BDF_THETA_BINS,
        n_phi_bins: BDF_PHI_BINS,
        theta_centers_deg: thetaCentersDeg,   // length n_theta_bins
        mu_centers: muCentersBdf,             // length n_theta_bins
        delta_mu: deltaMu,                    // length n_theta_bins
        phi_centers_deg: phiCentersDeg,       // length n_phi_bins
        delta_phi_rad: netGrid.binInfo[0][0].deltaPhi,
        N_incident: reflGrid.binInfo[0][0].N,
        reflected_weights: reflGrid.weights,          // [n_theta][n_phi]
        net_transmitted_weights: netGrid.weights,     // [n_theta][n_phi]
        reflected_bdf: reflGrid.bdf,                  // [n_theta][n_phi]
        net_transmitted_bdf: netGrid.bdf              // [n_theta][n_phi]
      };

      // --- Optical path-length histograms (binned + true means) ---
      // Reproduce the bottom-panel computation exactly so the file matches the
      // figure: 24 bins on [0, niceMax], values ≥ niceMax clipped into bin 23.
      const reflPaths = SimStats.reflectedPathLengths;
      const netPaths  = SimStats.netTransmittedPathLengths;
      const mean = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
      const meanR = mean(reflPaths), meanT = mean(netPaths);
      const scaleMean = Math.max(meanR, meanT);
      const niceMax = Math.max(10, Math.ceil((2.5 * Math.max(scaleMean, 1)) / 10) * 10);
      const PATH_BINS = 24;
      function pathHist(arr) {
        const counts = new Array(PATH_BINS).fill(0);
        for (const vRaw of arr) {
          const v = Math.max(0, vRaw || 0);
          counts[Math.min(PATH_BINS - 1, Math.floor((v / niceMax) * PATH_BINS))] += 1;
        }
        return counts;
      }
      const pathEdges = [];
      for (let i = 0; i <= PATH_BINS; i++) pathEdges.push(i * niceMax / PATH_BINS);
      const path_length_histograms = {
        description: "Optical path-length distributions (units of optical depth). " +
                     "Photons with path ≥ bin_max are accumulated in the final " +
                     "(overflow) bin, matching the on-screen panel. *_mean are the " +
                     "true means over all photons (not affected by clipping).",
        n_bins: PATH_BINS,
        bin_max: niceMax,
        bin_edges: pathEdges,            // length n_bins+1; last bin is overflow
        overflow_in_last_bin: true,
        reflected_counts: pathHist(reflPaths),
        reflected_N: reflPaths.length,
        reflected_mean: meanR,
        net_transmitted_counts: pathHist(netPaths),
        net_transmitted_N: netPaths.length,
        net_transmitted_mean: meanT
      };

      return {
        format: "mc_cloud_rt_export",
        schema_version: Export.SCHEMA_VERSION,
        generated: new Date().toISOString(),
        generator: "mc_cloud_rt_v4 — browser Monte Carlo cloud radiative transfer",
        inputs,
        outputs,
        mu_histograms,
        bdf,
        path_length_histograms
      };
    },

    downloadDataFile: function() {
      try {
        const data = Export.getExportDataObject();
        const json = JSON.stringify(data, null, 2);
        const blob = new Blob([json], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        Export.downloadDataURL(url, `mc_cloud_rt_data_${Export.timestampForFilename()}.json`);
        URL.revokeObjectURL(url);
      } catch (err) {
        showLimitWarning("Unable to export data file.");
        console.error(err);
      }
    }
  };
