// exportUtils.js — PNG download and diagnostic header generation.

import { state } from './state.js';
import { SimStats } from './simstats.js';
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
      const A_surface = SimStats.stats.surfaceAbsorbed / launched;
      const T_base = SimStats.stats.transmitted / launched;
      const surfaceRefl = SimStats.stats.surfaceReflected / launched;

      return [
        `R=${R.toFixed(3)} (${SimStats.stats.reflected})`,
        `T=${T.toFixed(3)} (${Tnet_count})`,
        `A=${A.toFixed(3)} (${SimStats.stats.absorbed})`,
        `S=${S.toFixed(3)} (${SimStats.stats.side})`,
        `A_sfc=${A_surface.toFixed(3)} (${SimStats.stats.surfaceAbsorbed})`,
        `R+T+A+S=${(R + T + A + S).toFixed(3)}`,
        `T_base_down=${T_base.toFixed(3)} (${SimStats.stats.transmitted})`,
        `surface refl/photon=${surfaceRefl.toFixed(3)} (${SimStats.stats.surfaceReflected})`
      ];
    },

    getExportParameterLines: function() {
      return [
        `Photons: ${SimStats.stats.launched}`,
        `COT τ: ${UI.getTauCloud().toFixed(2)}`,
        `Horizontal extent: ${UI.getHorizontalExtent().toFixed(1)}`,
        `Θ₀: ${(UI.getTheta0Rad() * 180 / Math.PI).toFixed(1)}°`,
        `HG g: ${UI.getG().toFixed(2)}`,
        `SSA ω₀: ${UI.getOmega0().toFixed(2)}`,
        `Surface A_s: ${UI.getSurfaceAlbedo().toFixed(2)}`,
        `β_ext: ${UI.getCloudBetaExt().toFixed(2)} km⁻¹`,
        `d_sfc: ${UI.getSurfaceDistanceKm().toFixed(2)} km`,
        `RNG seed: ${RNG.DEFAULT_SEED}`
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
        ["#f7ee0a", "Top reflected endpoints", "dot"],
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
        const canvasOut = document.createElement("canvas");
        canvasOut.width = source.width;
        canvasOut.height = source.height;
        const ctx = canvasOut.getContext("2d");

        ctx.drawImage(source, 0, 0);

        // Add context overlays: legend and key run inputs.
        Export.drawExportLegend(ctx, canvasOut.width - 760, 30);
        Export.drawExportParameterBox(ctx, 180, 55, {fontSize: 26});

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
        const headerH = Math.round(210 * scale);
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

        // Settings rows
        ctx.fillText(lines.slice(0, 3).join("   |   "), 14 * scale, 62 * scale);
        ctx.fillText(lines.slice(3, 6).join("   |   "), 14 * scale, 88 * scale);
        ctx.fillText(lines.slice(6, 8).join("   |   "), 14 * scale, 114 * scale);
        ctx.fillText(lines.slice(8, 10).join("   |   "), 14 * scale, 140 * scale);

        // Outcome statistics rows
        ctx.fillStyle = "#bfdbfe";
        ctx.font = `bold ${Math.round(13 * scale)}px system-ui, -apple-system, Segoe UI, sans-serif`;
        ctx.fillText(outcome.slice(0, 4).join("   |   "), 14 * scale, 168 * scale);
        ctx.fillText(outcome.slice(4, 8).join("   |   "), 14 * scale, 194 * scale);

        ctx.drawImage(canvas2, 0, headerH);

        const dataURL = canvasOut.toDataURL("image/png");
        Export.downloadDataURL(dataURL, `mc_cloud_rt_${mode}_panel_${Export.timestampForFilename()}.png`);
      } catch (err) {
        showLimitWarning("Unable to export bottom panel.");
        console.error(err);
      }
    }
  };
