// exportUtils.js — PNG download and diagnostic header generation.

import { state, UI_PANEL_WIDTH } from './state.js';
import { SimStats, MU_BINS, BDF_THETA_BINS, BDF_PHI_BINS } from './simstats.js';
import { UI, showLimitWarning } from './ui.js';
import { RNG } from './rng.js';
import { EntryMode } from './constants.js';
import { BottomPanel } from './bottomPanel.js';

// Legend box geometry (2026-07 relayout, driven by a user PPT mockup
// iteration). The previous layout was one flat row-major grid across all 16
// entries; the user asked to condense the box's overall vertical footprint,
// which meant restructuring into three purpose-built blocks instead of one
// uniform grid:
//   - Intermediate events: single stacked column (3 items)
//   - Animation photon paths: 2-column grid (6 items, row-major, sits beside
//     Intermediate in a shared top row rather than stacked below it)
//   - Terminal events: 3 INDEPENDENTLY-stacked columns of uneven height
//     (3/2/2 items -- each column pairs a terminal dot with its own
//     footprint square where one exists, e.g. "reflected" + "reflected 2D
//     top footprint" share column 1)
// A single generic row-major grid can't express uneven column heights, so
// LEGEND_LAYOUT below replaces the old flat LEGEND_ENTRIES array with this
// explicit block/column structure, and measureLegendGeometry independently
// measures each column's real ctx.measureText() width -- same reasoning as
// the old measureLegendColumnWidths (a hand-guessed width previously caused
// two separate clipping/asymmetry bugs), just generalized to N independent
// columns across 3 blocks instead of a fixed 2. See index.html's #legend
// CSS (.legendIntermediate / .legendAnimationGrid / .legendTerminalCols /
// .legendCol) for the on-screen mirror of this exact structure.
const LEGEND_ROW_H = 28;
const LEGEND_TITLE_H = 24;
const LEGEND_PAD = 12;
const LEGEND_COL_GAP = 28;
const LEGEND_BLOCK_GAP = 26;
const LEGEND_SECTION_GAP = 18;
// Extra breathing room after the longest label in a column, before the
// gutter to the next column (or the box's outer edge) -- NOT a glyph-width
// guess (ctx.measureText already gives the exact width); just visual
// spacing so text doesn't touch the edge it's closest to.
const LEGEND_COL_BUFFER = 24;
// Horizontal offset from a column's left edge to where its label text
// starts, matching drawLegendDot's own layout (icon/swatch region + gap).
const LEGEND_LABEL_OFFSET = 28;

// All three surface-absorbed markers (path line, endpoint dot, footprint)
// share one unified brown, #8a6f53 (user-picked) -- see ui.js's
// getOutcomeColor, photons.js's addEndpoint, and scene.js's surfAbs heatmap
// for the other three places this color lives.
const LEGEND_LAYOUT = {
  intermediate: {
    title: "Intermediate events (can recur, photon continues)",
    items: [
      ["#a855f7", "surface reflected event", "dot"],
      ["#22c55e", "downward cloud-base crossing", "dot"],
      ["#86efac", "downward cloud-base crossings 2D footprint", "square"]
    ]
  },
  animation: {
    // Labels drop "photon paths" here (redundant with the section title) --
    // Terminal entries below keep their fuller wording since they stand
    // alone without a shared title supplying that context.
    title: "Animation photon paths",
    items: [
      ["#60a5fa", "Reflected", "line"],
      ["#86efac", "Transmitted", "line"],
      ["#f97316", "Side-escape", "line"],
      ["#f9a8d4", "Surface-reflected escape", "line"],
      ["#8a6f53", "Incident surface-absorbed", "line"],
      ["#94a3b8", "Absorbed (cloud)", "line"]
    ]
  },
  terminal: {
    title: "Terminal events (end the photon's simulated path)",
    columns: [
      [
        ["#60a5fa", "reflected (upward cloud-top crossing)", "dot"],
        ["#60a5fa", "reflected 2D top footprint", "square"],
        ["#f9a8d4", "surface-reflected escape (no cloud face)", "dot"]
      ],
      [
        ["#8a6f53", "surface absorbed endpoint", "dot"],
        ["#8a6f53", "surface-absorbed 2D footprint", "square"]
      ],
      [
        ["#111827", "cloud absorption location", "dot"],
        ["#f97316", "side boundary escape", "dot"]
      ]
    ]
  }
};

function measureItemWidth(ctx, label) {
  return LEGEND_LABEL_OFFSET + ctx.measureText(label).width + LEGEND_COL_BUFFER;
}

// Single source of truth for the legend box's full geometry (widths of every
// independent column + overall box size), computed once per draw from real
// font metrics, so drawExportLegend and drawExportLegendBottomCentered can
// never see two different sizes for the same content.
function measureLegendGeometry(ctx) {
  ctx.save();
  ctx.font = "20px system-ui, -apple-system, Segoe UI, sans-serif";

  const intermediateW = Math.max(...LEGEND_LAYOUT.intermediate.items.map(it => measureItemWidth(ctx, it[1])));

  // Animation grid fills row-major, 2 columns -- even indices land in col 0,
  // odd indices in col 1 (matches index.html's CSS Grid auto-flow).
  const animItems = LEGEND_LAYOUT.animation.items;
  const animCol0W = Math.max(...animItems.filter((_, i) => i % 2 === 0).map(it => measureItemWidth(ctx, it[1])));
  const animCol1W = Math.max(...animItems.filter((_, i) => i % 2 === 1).map(it => measureItemWidth(ctx, it[1])));

  const termColWidths = LEGEND_LAYOUT.terminal.columns.map(col =>
    Math.max(...col.map(it => measureItemWidth(ctx, it[1])))
  );

  // Canvas text never auto-wraps (drawSectionTitle is a single fillText
  // call), so a block's own title -- not just its item labels -- must fit
  // within the width that block is given, or it would silently run past
  // the block into whatever sits next to it. Measured in the same bold
  // font drawSectionTitle actually renders in, uppercased to match.
  ctx.font = "700 15px system-ui, -apple-system, Segoe UI, sans-serif";
  const intermediateTitleW = ctx.measureText(LEGEND_LAYOUT.intermediate.title.toUpperCase()).width;
  const animationTitleW = ctx.measureText(LEGEND_LAYOUT.animation.title.toUpperCase()).width;
  const terminalTitleW = ctx.measureText(LEGEND_LAYOUT.terminal.title.toUpperCase()).width;

  ctx.restore();

  const intermediateBlockW = Math.max(intermediateW, intermediateTitleW);
  // Item positions within a block are always laid out from real item widths
  // only (animCol0W/animCol1W/termColWidths) -- a title wider than its
  // block's items just reserves extra trailing whitespace after the last
  // item, exactly like a CSS block whose heading is wider than its content.
  // Only intermediateBlockW is actually used for positioning downstream (the
  // vertical divider and the animation block's start x both key off it).
  const animationItemsW = animCol0W + LEGEND_COL_GAP + animCol1W;
  const animationBlockW = Math.max(animationItemsW, animationTitleW);

  const topRowW = intermediateBlockW + LEGEND_BLOCK_GAP + animationBlockW;
  const terminalItemsW = termColWidths.reduce((a, b) => a + b, 0) + LEGEND_COL_GAP * (termColWidths.length - 1);
  const terminalRowW = Math.max(terminalItemsW, terminalTitleW);
  const boxW = 2 * LEGEND_PAD + Math.max(topRowW, terminalRowW);

  const intermediateRows = LEGEND_LAYOUT.intermediate.items.length;
  const animationRows = Math.ceil(animItems.length / 2);
  const topBandRows = Math.max(intermediateRows, animationRows);
  const terminalRows = Math.max(...LEGEND_LAYOUT.terminal.columns.map(c => c.length));

  const topBandH = LEGEND_TITLE_H + topBandRows * LEGEND_ROW_H;
  const terminalH = LEGEND_TITLE_H + terminalRows * LEGEND_ROW_H;
  const boxH = 2 * LEGEND_PAD + topBandH + LEGEND_SECTION_GAP + terminalH;

  return {boxW, boxH, intermediateBlockW, animCol0W, animCol1W, termColWidths, topBandH, terminalH};
}

// Manual rounded-rect path (arcTo-based rather than ctx.roundRect()) so this
// draws identically on any canvas implementation, matching index.html's
// #legend border-radius:12px on-screen.
function tracePath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

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

      // Match the left-hand diagnostic panel: R/T/A/S are the OBSERVED budget
      // under the active observation geometry (Phase 1 = "a", cloud top/base
      // faces only — T base-derived, downward side exits in S). F_down_sfc is the
      // physical (total) surface quantity.
      const R_count = SimStats.reflectedCount();
      const T_count = SimStats.transmittedNetCount();
      const side_count = SimStats.sideExitCount();

      const R = R_count / launched;
      const T = T_count / launched;
      const A = SimStats.stats.absorbed / launched;
      const S = side_count / launched;
      const Term = SimStats.stats.terminated / launched;
      const T_base = SimStats.stats.transmitted / launched;
      const surfaceRefl = SimStats.stats.surfaceReflected / launched;

      // Compact R/T/A/S symbols (header is width-limited; the stats panel and
      // README carry the full "Normalized … flux" definitions).
      return [
        `R=${R.toFixed(3)} (${R_count})`,
        `T=${T.toFixed(3)} (${T_count})`,
        `A=${A.toFixed(3)} (${SimStats.stats.absorbed})`,
        `S=${S.toFixed(3)} (${side_count})`,
        `R+T+A+S+Term=${(R + T + A + S + Term).toFixed(3)}`,
        `F_down_sfc=${T_base.toFixed(3)} (${SimStats.stats.transmitted})`,
        `F_up_sfc=${surfaceRefl.toFixed(3)} (${SimStats.stats.surfaceReflected})`,
        `Term (event cap)=${Term.toFixed(3)} (${SimStats.stats.terminated})`
      ];
    },

    // Human-readable label for the cloud-top photon-illumination mode.
    photonEntryLabel: function(mode) {
      return mode === EntryMode.TOP            ? "uniform top"
           : mode === EntryMode.TOP_SIDE       ? "uniform top+side"
           : mode === EntryMode.UNIFORM_DOMAIN ? "uniform domain"
           : "centered";
    },

    // Domain-block lines for PNG headers (v6.0 Phase 2): empty array unless
    // Illumination = "Uniform domain", so legacy-mode PNG exports are pixel-
    // identical to before this feature existed.
    //
    // Deliberately NOT folded into "Obs geometry" (see getExportParameterLines
    // below): that line describes the Observation-geometry dropdown, which
    // still drives the FINAL OUTCOMES numbers (the blue R/T/A/S box) even when
    // "Show entire-domain plots" is checked -- those two settings are
    // independent by design (TODO decision #6), so relabeling "Obs geometry"
    // to "entire domain" would misrepresent what the blue box's numbers
    // actually are (they'd still be e.g. cloud top/base faces, not domain-wide
    // -- R_domain/T_domain on THIS line are the true domain-wide numbers).
    // Third line here is the correct place instead: it only describes the
    // bottom-panel PLOTS specifically, which is exactly what it's true of.
    getDomainOutputLines: function() {
      if (UI.getPhotonEntryMode() !== EntryMode.UNIFORM_DOMAIN) return [];
      const launched = Math.max(SimStats.stats.launched, 1);
      const M = UI.getDomainFactor();
      const fc = UI.getCloudFraction();
      const boundary = UI.getDomainBoundary();
      const Rd = SimStats.domainReflectedCount() / launched;
      const Td = SimStats.domainTransmittedNetCount() / launched;
      const Ad = SimStats.domainAbsorbedCount() / launched;
      const lines = [
        `Domain factor M=${M.toFixed(2)} (f_c=${fc.toFixed(4)}), boundary: ${boundary}`,
        `R_domain=${Rd.toFixed(3)}   T_domain=${Td.toFixed(3)}   R+T+A_cloud=${(Rd + Td + Ad).toFixed(3)}`
      ];
      if (UI.getShowEntireDomainPlots()) {
        lines.push("Bottom-panel plots: entire domain (Reflected + Net Transmitted)");
      }
      return lines;
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
        `Photon illumination: ${Export.photonEntryLabel(UI.getPhotonEntryMode())}`,
        // f_pix appended to this line (not its own row) so the header stays at
        // 12 lines -- downloadBottomPanel slices rows in fixed groups of 3.
        // APPLIED value (SimStats._pixelFrac), not the live input: the header
        // must describe the run as accumulated (deferred-application design).
        `Obs geometry: ${SimStats.observationGeometryLabel()}` +
          ((SimStats._pixelFrac ?? 1) < 1
            ? `; f_pix=${SimStats._pixelFrac.toFixed(2)}` : "")
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

    // Plain section-title text (2026-07 relayout): the divider rule that
    // used to be baked into this function is now drawn separately by
    // drawExportLegend itself (drawDivider below), since dividers here sit
    // BETWEEN blocks rather than always directly above a title -- e.g. the
    // vertical divider between Intermediate and Animation runs alongside
    // both titles, not above either one.
    drawSectionTitle: function(ctx, x, y, text) {
      ctx.save();
      ctx.fillStyle = "#cbd5e1";
      ctx.font = "700 15px system-ui, -apple-system, Segoe UI, sans-serif";
      ctx.fillText(text.toUpperCase(), x, y);
      ctx.restore();
    },

    drawDivider: function(ctx, x1, y1, x2, y2) {
      ctx.save();
      ctx.strokeStyle = "rgba(203, 213, 225, 0.6)";
      ctx.lineWidth = 1;
      ctx.setLineDash([1, 3]);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.restore();
    },

    // Draws a single stacked column of dot/square entries starting just
    // below a title, top to bottom -- used for the Intermediate block and
    // each of the Terminal block's 3 independent columns.
    drawLegendColumn: function(ctx, x, topY, items) {
      items.forEach((it, i) => {
        Export.drawLegendDot(ctx, x, topY + i * LEGEND_ROW_H + 14, it[0], it[1], it[2]);
      });
    },

    // Legend box (2026-07 relayout -- see LEGEND_LAYOUT/measureLegendGeometry
    // above for the full rationale): Intermediate events and Animation photon
    // paths sit side by side in a top row; Terminal events spans the full
    // width below as 3 independently-stacked columns. Rounded corners match
    // index.html's #legend (border-radius: 12px).
    drawExportLegend: function(ctx, x, y) {
      const geo = measureLegendGeometry(ctx);
      const pad = LEGEND_PAD;

      ctx.save();
      tracePath(ctx, x, y, geo.boxW, geo.boxH, 12);
      ctx.fillStyle = "rgba(71, 85, 105, 0.88)";
      ctx.fill();
      ctx.strokeStyle = "rgba(203, 213, 225, 0.7)";
      ctx.lineWidth = 1;
      ctx.stroke();

      // --- Top row: Intermediate (left) | Animation (right) ---
      const topY = y + pad;
      const rowsTopY = topY + LEGEND_TITLE_H;

      Export.drawSectionTitle(ctx, x + pad, topY + 14, LEGEND_LAYOUT.intermediate.title);
      Export.drawLegendColumn(ctx, x + pad, rowsTopY, LEGEND_LAYOUT.intermediate.items);

      const dividerX = x + pad + geo.intermediateBlockW + LEGEND_BLOCK_GAP / 2;
      Export.drawDivider(ctx, dividerX, topY, dividerX, topY + geo.topBandH);

      const animX = x + pad + geo.intermediateBlockW + LEGEND_BLOCK_GAP;
      Export.drawSectionTitle(ctx, animX, topY + 14, LEGEND_LAYOUT.animation.title);
      LEGEND_LAYOUT.animation.items.forEach((it, i) => {
        const row = Math.floor(i / 2);
        const col = i % 2;
        const colX = col === 0 ? animX : animX + geo.animCol0W + LEGEND_COL_GAP;
        Export.drawLegendDot(ctx, colX, rowsTopY + row * LEGEND_ROW_H + 14, it[0], it[1], it[2]);
      });

      // --- Horizontal divider, full box width ---
      const hDividerY = topY + geo.topBandH + LEGEND_SECTION_GAP / 2;
      Export.drawDivider(ctx, x + pad, hDividerY, x + geo.boxW - pad, hDividerY);

      // --- Terminal events: 3 independent columns ---
      const termTopY = topY + geo.topBandH + LEGEND_SECTION_GAP;
      const termRowsTopY = termTopY + LEGEND_TITLE_H;
      Export.drawSectionTitle(ctx, x + pad, termTopY + 14, LEGEND_LAYOUT.terminal.title);

      let colX = x + pad;
      LEGEND_LAYOUT.terminal.columns.forEach((col, i) => {
        Export.drawLegendColumn(ctx, colX, termRowsTopY, col);
        colX += geo.termColWidths[i] + LEGEND_COL_GAP;
      });

      ctx.restore();

      return {width: geo.boxW, height: geo.boxH};
    },

    // Bottom-of-image legend layout (v6.0 follow-up): the top-right corner
    // couldn't reliably fit both the legend AND the parameter/stat/domain
    // column without either overlapping (original bug) or running off the
    // right edge of the canvas (a first fix's failure mode -- confirmed by the
    // user's Θ₀=60°, M=2 export, where the legend's right column got clipped).
    // A second attempt split the legend into two boxes anchored to opposite
    // edges at the bottom -- user feedback: keep it as ONE box (same layout as
    // drawExportLegend above), just moved to the bottom and horizontally
    // centered. Moving it off the top row at all still sidesteps the whole
    // overlap-vs-clipping class of bug, since it no longer competes for
    // horizontal space with the parameter/stat/domain column, which now lives
    // entirely at the top (see download3DView -- stat/domain boxes right-
    // justified there instead).
    drawExportLegendBottomCentered: function(ctx, canvasWidth, canvasHeight) {
      const margin = 60;
      // Both width and height now come from measureLegendGeometry(ctx) --
      // real measured text, real row counts -- so this can never see a
      // different box size than what drawExportLegend actually draws.
      const {boxW, boxH} = measureLegendGeometry(ctx);
      const x = (canvasWidth - boxW) / 2;
      const y = canvasHeight - boxH - margin;
      return Export.drawExportLegend(ctx, x, y);
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

        // Add context overlays: key run inputs (top-left), outcome statistics
        // and the entire-domain box (top-right, right-justified), and the
        // legend (bottom, centered as one box -- see
        // drawExportLegendBottomCentered). Three separate regions that never
        // compete for the same horizontal space, which is what the earlier
        // top-right-corner arrangement got wrong (first overlapped, then, after
        // a partial fix, could clip off the right edge instead -- confirmed by
        // the user's Θ₀=60°, M=2 export). Per user feedback, the stat/domain
        // boxes are right-justified to the canvas edge (not just pushed clear
        // of the legend), and the legend stays a single box, just moved down
        // and centered rather than split in two.
        //
        // Left/right margins share one value (`margin`) so the parameter box's
        // distance from the left edge visually matches the stat/domain boxes'
        // distance from the right edge -- symmetric framing, per user request,
        // and it maximizes the untouched 3D-view space between them.
        const margin = 60;
        const paramBox = Export.drawExportParameterBox(ctx, margin, 55, {fontSize: 26});

        const outcome = Export.getOutcomeStatisticLines();
        const statFontSize = 24;
        const statLineH = Math.round(statFontSize * 1.38);
        const statY = 55;
        ctx.save();
        ctx.font = `700 ${statFontSize}px system-ui, -apple-system, Segoe UI, sans-serif`;
        const statColor = "#bfdbfe";
        // Measure width from the longest of the 3 rows
        const row1 = outcome.slice(0, 4).join(" ,   ");
        const row2 = outcome.slice(4, 6).join(" ,   ");
        const row3 = outcome.slice(6, 9).join(" ,   ");
        const statPad = 10;
        const statW = Math.max(ctx.measureText(row1).width,
                               ctx.measureText(row2).width,
                               ctx.measureText(row3).width) + 2 * statPad;
        const statH = 3 * statLineH + 2 * statPad;
        ctx.restore();
        // Right-justified: right edge flush with the same margin as the
        // parameter box's left edge, regardless of measured width (a "ragged
        // left, flush right" stack with the domain box below) -- clamped to
        // never sit left of the parameter box's own right edge, in case a
        // narrow export width or unusually long text would otherwise push the
        // two into each other.
        const leftBoundary = margin + paramBox.width + 12;
        const statX = Math.max(canvasOut.width - statW - margin, leftBoundary);

        // "Entire domain" box (v6.0 Phase 2): only present for "Uniform domain"
        // illumination (getDomainOutputLines returns [] otherwise), so legacy-mode
        // exports are pixel-identical to before this feature existed.
        const domainLines = Export.getDomainOutputLines();
        let domainW = 0, domainH = 0, domainX = 0;
        if (domainLines.length > 0) {
          ctx.save();
          ctx.font = `700 ${statFontSize}px system-ui, -apple-system, Segoe UI, sans-serif`;
          domainW = Math.max(...domainLines.map(l => ctx.measureText(l).width)) + 2 * statPad;
          domainH = domainLines.length * statLineH + 2 * statPad;
          ctx.restore();
          domainX = Math.max(canvasOut.width - domainW - margin, leftBoundary);
        }
        const domainY = statY + statH + 12;

        // Legend: single box, bottom-centered.
        Export.drawExportLegendBottomCentered(ctx, canvasOut.width, canvasOut.height);

        // Now draw the stat box (right-justified position from above).
        ctx.save();
        ctx.font = `700 ${statFontSize}px system-ui, -apple-system, Segoe UI, sans-serif`;
        ctx.fillStyle = "rgba(15, 23, 42, 0.82)";
        ctx.strokeStyle = "rgba(226, 232, 240, 0.75)";
        ctx.lineWidth = 1;
        ctx.fillRect(statX, statY, statW, statH);
        ctx.strokeRect(statX, statY, statW, statH);
        ctx.fillStyle = statColor;
        ctx.fillText(row1, statX + statPad, statY + statPad + statFontSize);
        ctx.fillText(row2, statX + statPad, statY + statPad + statFontSize + statLineH);
        ctx.fillText(row3, statX + statPad, statY + statPad + statFontSize + 2 * statLineH);
        ctx.restore();

        // And the domain box, right-justified independently (its width usually
        // differs from the stat box above it, so this is "ragged left, flush
        // right" for the pair, not a shared left edge).
        if (domainLines.length > 0) {
          ctx.save();
          ctx.font = `700 ${statFontSize}px system-ui, -apple-system, Segoe UI, sans-serif`;
          ctx.fillStyle = "rgba(15, 23, 42, 0.82)";
          ctx.strokeStyle = "rgba(226, 232, 240, 0.75)";
          ctx.lineWidth = 1;
          ctx.fillRect(domainX, domainY, domainW, domainH);
          ctx.strokeRect(domainX, domainY, domainW, domainH);
          ctx.fillStyle = "#fde68a";
          domainLines.forEach((line, i) => {
            ctx.fillText(line, domainX + statPad, domainY + statPad + statFontSize + i * statLineH);
          });
          ctx.restore();
        }

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

        const mode = document.getElementById("bottomPanelMode")?.value ?? "mu";   // same fallback as drawBottomPanel (review E11)

        // Export at the panel's high-DPI native resolution.
        // Header is large enough for key settings plus outcome diagnostics.
        const scale = canvas2.width / 700;
        // Domain lines (v6.0 Phase 2): [] unless Illumination = "Uniform domain",
        // so legacy-mode exports keep the exact same header height as before.
        const domainLines = Export.getDomainOutputLines();
        const domainLineH = Math.round(18 * scale);

        // When "Show entire-domain plots" is active, the dropdown-driven Obs
        // geometry setting and its associated outcome stats (R/T/A/S/Term,
        // F_down_sfc/F_up_sfc) describe a DIFFERENT combiner than what's
        // actually plotted below them in this export -- they don't change when
        // the checkbox is toggled, but the plots do. Showing them invites
        // exactly the misreading the domain block's own "Bottom-panel plots:
        // entire domain" line exists to prevent, just one level more directly
        // (numbers, not just a label). So: drop the Obs-geometry settings line
        // and skip the outcome-stats rows entirely in that case -- the domain
        // block's own R_domain/T_domain/closure numbers are what's actually
        // relevant, and are already shown. Every other combination (legacy
        // modes; Uniform Domain with the checkbox unchecked) is unaffected --
        // pixel-identical to before.
        const showEntireDomain = UI.getPhotonEntryMode() === EntryMode.UNIFORM_DOMAIN && UI.getShowEntireDomainPlots();

        const allLines = Export.getExportParameterLines();
        const lines = showEntireDomain ? allLines.slice(0, -1) : allLines;   // drop trailing "Obs geometry" line
        const outcome = showEntireDomain ? [] : Export.getOutcomeStatisticLines();

        // Last settings row sits at y=140 regardless (its content just has one
        // fewer item when Obs geometry is dropped); the outcome rows normally
        // run through y=220. When outcome rows are skipped, the domain lines
        // start right after the settings rows instead, one row-height down.
        const domainStartY = showEntireDomain ? 166 : 220;
        const headerH = Math.round((domainStartY + 16) * scale) + (domainLines.length > 0 ? domainLines.length * domainLineH + Math.round(8 * scale) : 0);
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

        // Settings rows (11 or 12 lines depending on whether Obs geometry was
        // dropped: 3 / 3 / 3 / 3-or-2 across four rows)
        ctx.fillText(lines.slice(0, 3).join(" ,   "), 14 * scale, 62 * scale);
        ctx.fillText(lines.slice(3, 6).join(" ,   "), 14 * scale, 88 * scale);
        ctx.fillText(lines.slice(6, 9).join(" ,   "), 14 * scale, 114 * scale);
        ctx.fillText(lines.slice(9, 12).join(" ,   "), 14 * scale, 140 * scale);

        // Outcome statistics rows (3 lines to prevent truncation) -- skipped
        // entirely when they'd describe a different combiner than the plots
        // below (see above).
        if (outcome.length > 0) {
          ctx.fillStyle = "#bfdbfe";
          ctx.font = `bold ${Math.round(13 * scale)}px system-ui, -apple-system, Segoe UI, sans-serif`;
          ctx.fillText(outcome.slice(0, 4).join(" ,   "), 14 * scale, 168 * scale);
          ctx.fillText(outcome.slice(4, 6).join(" ,   "), 14 * scale, 194 * scale);
          ctx.fillText(outcome.slice(6, 9).join(" ,   "), 14 * scale, 220 * scale);
        }

        // "Entire domain" lines, in the extra header space reserved above.
        if (domainLines.length > 0) {
          ctx.fillStyle = "#fde68a";
          domainLines.forEach((line, i) => {
            ctx.fillText(line, 14 * scale, domainStartY * scale + (i + 1) * domainLineH);
          });
        }

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
    //   * BDF is exported as BOTH the raw, non-negative terminal-event bin
    //     weights (v6.0.1, review E3/E4: one +1 tally per photon at its
    //     actual terminal exit/arrival direction; reflections along the way
    //     are never binned -- this replaced an earlier signed ±1 running-
    //     ledger scheme, so "raw" no longer means "signed") and the
    //     normalized BDF = (W/N)·π/(µ·Δµ·Δφ). The normalized grid is the
    //     UNSMOOTHED quantity (near-nadir azimuthal averaging is a
    //     display-only cosmetic), so it is the ground truth for DISORT
    //     comparison.
    //   * Path-length distributions are exported as fixed-bin histograms that
    //     reproduce the on-screen panel exactly (24 bins, same adaptive max,
    //     long tail clipped into the final overflow bin) plus the true means.
    // 1.1 (v6.0 Phase 2): added inputs.domain_factor/domain_boundary and
    // outputs.cloud_fraction/uniform_domain_outputs, all conditional on
    // Illumination = "Uniform domain" -- purely additive, no existing field
    // removed or renamed, so 1.0 readers remain compatible.
    // 1.2 (v6.0.1, review E2-E4): path-length bin_max now shared with the
    // panel's axis logic (SimStats.pathAxisMax -- genuine-population scale,
    // matching the figure again); mu/BDF descriptions rewritten for the
    // terminal-event-only (non-negative) bin construction; for "Uniform
    // domain" runs only, added mu_histograms.net_transmitted_counts_cloud_only
    // /_domain_wide_cloud_only/_N_cloud_only/clear_direct_count/
    // clear_direct_mu_bin_index and bdf.net_transmitted_weights_cloud_only/
    // _domain_wide_cloud_only/clear_direct_count. Purely additive; 1.0/1.1
    // readers remain compatible.
    // 1.3 (Phase 4): rigorous BRF/BTF. Added outputs.counts.launched_cloud_top/
    // _wall/_clear (realized first-hit tallies; top is the BRF reference
    // N_top), bdf.reflected_brf/net_transmitted_brf (normalized by
    // N_top·A_proj/W² -- matches the on-screen panels for every illumination
    // mode; omitted with a note when N_top=0), bdf.n_top_incident, and -- when
    // the sub-cloud pixel is active (f_pix < 1) -- inputs.pixel_fraction,
    // bdf.reflected_weights_pixel/reflected_brf_pixel/n_pixel_incident and
    // mu_histograms.reflected_counts_pixel. Purely additive; 1.0-1.2 readers
    // remain compatible (the historical N-normalized *_bdf grids are
    // unchanged -- they remain the correct domain-mean quantity).
    SCHEMA_VERSION: "1.3",

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
        photon_illumination: UI.getPhotonEntryMode(),   // "center" | "top" | "top_side" | "uniform_domain"
        rng_seed: RNG.currentSeed(),
        units: {
          tau_cloud: "optical depth (dimensionless)",
          horizontal_extent: "optical depth (slab width in τ-units)",
          theta0_deg: "degrees", mu0: "cos(zenith)",
          beta_ext_km: "km^-1", surface_distance_km: "km"
        }
      };

      // domain_factor/domain_boundary only meaningful under "Uniform domain"
      // illumination -- omitted otherwise rather than exported as meaningless.
      const isDomain = UI.getPhotonEntryMode() === EntryMode.UNIFORM_DOMAIN;
      if (isDomain) {
        inputs.domain_factor = UI.getDomainFactor();
        inputs.domain_boundary = UI.getDomainBoundary();   // "open" | "periodic" (Phase 3)
        inputs.units.domain_factor = "dimensionless (domain width = M × cloud width; cloud fraction f_c = 1/M²)";
      }

      // --- Outputs (counts + normalized fluxes; mirrors the stats panel) ---
      // R/T/A/S are the OBSERVED budget under the active observation geometry.
      // Phase 1 = consistent "a" (cloud top/base faces only): T is base-derived,
      // downward side-wall exits are reassigned to S. F_down_surface and
      // surface_reflected remain the physical (total) surface quantities.
      const netTransCount = SimStats.transmittedNetCount();   // observation-geometry aware
      const sideCount     = SimStats.sideExitCount();
      const reflCount     = SimStats.reflectedCount();        // observation-geometry aware
      const R = reflCount / launched;
      const Tnet = netTransCount / launched;
      const A = s.absorbed / launched;
      const S = sideCount / launched;
      const Term = s.terminated / launched;
      const outputs = {
        observation_geometry: SimStats.observationGeometryKey(),   // "top-base_faces" (a) or "all_faces" (b)
        counts: {
          launched: s.launched,
          // Phase 4: realized first-hit tallies (sum to launched). "top" is
          // the rigorous-BRF reference count N_top.
          launched_cloud_top: s.launchedCloudTop,
          launched_cloud_wall: s.launchedCloudWall,
          launched_clear: s.launchedClear,
          reflected: SimStats.reflectedCount(),
          transmitted_down_at_surface: s.transmitted,
          final_transmitted_black_surface: s.finalTransmitted,
          cloud_absorbed: s.absorbed,
          side_exit: sideCount,
          terminated_event_cap: s.terminated,
          surface_reflected: s.surfaceReflected,
          surface_absorbed: s.surfaceAbsorbed,
          net_transmitted: netTransCount
        },
        fluxes: {
          R_reflected: R,                 // normalized reflected flux = cloud albedo (hemispheric); distinct from the directional BDF
          T_net_transmitted: Tnet,        // net normalized flux transmittance (surface absorption), base-derived
          A_cloud_absorbed: A,            // normalized cloud absorption
          S_side_exit: S,                 // normalized flux exiting cloud sides (incl. side exits reaching the surface)
          Term_event_cap: Term,
          closure_R_T_A_S_Term: R + Tnet + A + S + Term,
          F_down_surface: s.transmitted / launched,   // normalized downward flux at the surface plane (total, physical)
          surface_reflections_per_photon: s.surfaceReflected / launched
        },
        mean_scatterings_per_photon: s.totalScatterings / launched,
        mean_optical_path_per_photon: s.totalPath / launched,
        notes: "Fluxes are normalized per launched photon (analog MC, weight 1). " +
               "'observation_geometry' sets how exits are bucketed: 'top-base_faces' = R/T from the " +
               "cloud top/base faces only (side exits, surface-reflected upward bypass, and side-derived " +
               "surface absorption all go to S); 'all_faces' = the cloud element (top/base/side faces → " +
               "R/T), with only the surface-reflected upward bypass in S. Under 'Uniform domain' " +
               "illumination this budget is still cloud-normalized (same denominator, all launched " +
               "photons) -- see 'uniform_domain_outputs' below for the always-on, geometry-independent " +
               "domain-wide total."
      };

      // --- "Entire domain" outputs (v6.0 Phase 2) ---
      // Only present when Illumination = "Uniform domain"; omitted otherwise since
      // there is no domain concept for point-source/top/top_side launches. See TODO
      // "Draft: panel & export wording" for the schema this mirrors.
      if (isDomain) {
        outputs.cloud_fraction = UI.getCloudFraction();

        const RdCount = SimStats.domainReflectedCount();
        const TdCount = SimStats.domainTransmittedNetCount();
        const AdCount = SimStats.domainAbsorbedCount();
        const Rd = RdCount / launched, Td = TdCount / launched, Ad = AdCount / launched;
        const rc = SimStats.rComponents(), tc = SimStats.tComponents(), ac = SimStats.aComponents();
        const flux = (count) => ({ flux: count / launched, count });

        outputs.uniform_domain_outputs = {
          domain_boundary: UI.getDomainBoundary(),   // "open" | "periodic" (Phase 3)
          R_domain: flux(RdCount),
          R_components: {
            cloud_top: flux(rc.cloudTop),
            cloud_side: flux(rc.cloudSide),
            clear_direct: flux(rc.clearDirect),
            clear_via_cloud: flux(rc.clearViaCloud)
          },
          T_domain: flux(TdCount),
          T_components: {
            // 3 terms only -- T has no clear-via-cloud analogue to R's (d); see
            // TODO "T and A component decomposition". via_cloud_base/via_cloud_side
            // each still mix directly-cloud-incident with clear-sky-recycled
            // origins (not split further here).
            via_cloud_base: flux(tc.viaBase),
            via_cloud_side: flux(tc.viaSide),
            clear_direct: flux(tc.clearDirect)
          },
          A_cloud_domain: flux(AdCount),
          A_cloud_components: {
            cloud_incident: flux(ac.cloudIncident),
            clear_recycled: flux(ac.clearRecycled)
          },
          closure_R_T_Acloud: Rd + Td + Ad
        };
      }

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
                     "net_transmitted_counts are terminal-event-only, non-negative " +
                     "counts (v6.0.1): each photon contributes +1 at the angle of its " +
                     "terminal downward surface arrival ('transmitted' at A_s=0, " +
                     "'surface_absorbed' at A_s>0); surface reflections are never " +
                     "binned. The bin totals equal the net (down−up) counts by " +
                     "construction. Under 'Uniform domain' illumination AND " +
                     "observation_geometry='all_faces' (sides included), these raw " +
                     "counts include the clear-sky-direct population -- an unscattered " +
                     "delta function at exactly Θ₀ confined to one bin (under " +
                     "'top-base_faces' the raw counts are base-derived only, so the " +
                     "spike is absent). See the *_cloud_only variants and " +
                     "clear_direct_* fields (present only for Uniform-domain runs) " +
                     "for the decontaminated views the panels plot.",
        n_bins: MU_BINS,
        mu_bin_edges: muEdges,           // length n_bins+1, descending 1→0
        mu_bin_centers: muCenters,       // length n_bins
        reflected_counts: Array.from(SimStats.reflectedMuBins()),
        net_transmitted_counts: Array.from(SimStats.transmittedMuBins()),
        reflected_N: SimStats.reflectedCount(),
        net_transmitted_N: netTransCount
      };

      // Uniform-domain-only additions (schema 1.2, review E4): the on-screen
      // panels never plot the raw transmitted arrays for these runs (default
      // view is cloud-only; the entire-domain toggle plots domain-wide
      // cloud-only), so export those views too, plus enough clear-direct
      // information for a reader to locate/remove the delta spike from the raw
      // arrays. Purely additive -- 1.0/1.1 readers unaffected.
      if (isDomain) {
        const tcMu = SimStats.tComponents();
        // Same arithmetic path as the accumulator: clear-direct arrivals have
        // dirZ = cos(theta0) exactly (never scattered), so this reproduces the
        // bin index bit-for-bit (FP-sensitive at bin edges, e.g. Θ₀=60°).
        const muClearDirect = Math.max(0, Math.min(1, Math.abs(Math.cos(theta0Rad))));
        mu_histograms.net_transmitted_counts_cloud_only =
          Array.from(SimStats.transmittedMuBinsCloudOnly());          // matches default panel view
        mu_histograms.net_transmitted_counts_domain_wide_cloud_only =
          Array.from(SimStats.transmittedMuBinsDomainWideCloudOnly()); // matches entire-domain toggle bars
        // Domain-wide REFLECTED (side exits + surface bypass, dropdown-independent)
        // -- what the "Show entire-domain plots" toggle plots for the Reflected
        // panel (no cloud-only variant needed: the bypass population is
        // Lambertian-diffuse, no delta spike -- see TODO "3.A" follow-up).
        mu_histograms.reflected_counts_domain_wide =
          Array.from(SimStats.reflectedMuBinsDomainWide());
        mu_histograms.net_transmitted_N_cloud_only = SimStats.transmittedNetCountCloudOnly();
        mu_histograms.clear_direct_count = tcMu.clearDirect;
        mu_histograms.clear_direct_mu_bin_index =
          Math.min(MU_BINS - 1, Math.floor((1 - muClearDirect) * MU_BINS));
      }

      // --- BDF (bidirectional distribution function) ---
      // Reuse the display grid builder to guarantee identical normalization,
      // but take the UNSMOOTHED grids (no near-nadir averaging) as ground truth.
      const reflGrid = BottomPanel.computeBdfGrid(SimStats.reflectedBdfWeights());
      const netGrid  = BottomPanel.computeBdfGrid(SimStats.transmittedBdfWeights());

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
                     "bins (0,5,…,355°). 'weights' are raw, non-negative " +
                     "terminal-event bin tallies W (v6.0.1: each photon +1 at its " +
                     "terminal exit/arrival direction; surface reflections are never " +
                     "binned); 'bdf' is the normalized function. Transmitted grids " +
                     "count terminal downward surface arrivals (equal to net down−up " +
                     "by construction). Under 'Uniform domain' illumination with " +
                     "observation_geometry='all_faces', the raw transmitted grids " +
                     "include the clear-sky-direct delta spike at " +
                     "exactly Θ₀ -- see net_transmitted_weights_cloud_only / " +
                     "_domain_wide_cloud_only (present only for such runs) for the " +
                     "decontaminated tallies the panels plot; normalized BDF is " +
                     "exported for the raw grid only (renormalize the cloud-only " +
                     "weights with the same (W/N)·π/(µ·Δµ·Δφ) if needed). These " +
                     "values are raw/unsmoothed; the PNG figure φ-averages the " +
                     "innermost near-nadir ring (θ<5°) for display only, so the PNG " +
                     "and this JSON differ at that ring.",
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

      // Uniform-domain-only additions (schema 1.2, review E4) -- the raw weight
      // tallies for the two decontaminated views the panels actually plot.
      if (isDomain) {
        bdf.net_transmitted_weights_cloud_only =
          BottomPanel.computeBdfGrid(SimStats.transmittedBdfWeightsCloudOnly()).weights;
        bdf.net_transmitted_weights_domain_wide_cloud_only =
          BottomPanel.computeBdfGrid(SimStats.transmittedBdfWeightsDomainWideCloudOnly()).weights;
        bdf.reflected_weights_domain_wide =
          BottomPanel.computeBdfGrid(SimStats.reflectedBdfWeightsDomainWide()).weights;
        bdf.clear_direct_count = SimStats.tComponents().clearDirect;
      }

      // --- Rigorous BRF/BTF grids (schema 1.3, Phase 4) ---
      // Same weights the panels plot (dropdown-aware; cloud-only transmitted
      // for Uniform-domain runs), normalized by N_top·A_proj(θᵥ,φᵥ)/W² with
      // the realized top-face-incident reference count. A_proj/W² = 1 +
      // (τ_cloud/W)·tanθᵥ·(|cosφᵥ|+|sinφᵥ|) under side-inclusive observation
      // ('all_faces'), and ≡ 1 under 'top-base_faces' (flat-top footprint) --
      // uncapped, equivalent-uniform-beam convention. Omitted (with note) if
      // N_top = 0.
      const nTop = SimStats.nTopIncident();
      if (nTop > 0) {
        const brfOpts = { nRef: nTop, sidesIncluded: SimStats._sidesIncluded() };
        bdf.n_top_incident = nTop;
        bdf.reflected_brf =
          BottomPanel.computeBdfGrid(SimStats.reflectedBdfWeights(), brfOpts).bdf;
        bdf.net_transmitted_brf =
          BottomPanel.computeBdfGrid(
            isDomain ? SimStats.transmittedBdfWeightsCloudOnly() : SimStats.transmittedBdfWeights(),
            brfOpts).bdf;
      } else {
        bdf.brf_note = "N_top = 0 (no top-face-incident photons realized) -- BRF/BTF undefined for this run.";
      }

      // --- Sub-cloud observation pixel (schema 1.3, Phase 4; f_pix < 1 only) ---
      // APPLIED value (cached at run start), not the live input -- the export
      // must describe the data as accumulated (deferred-application design).
      const fPix = SimStats._pixelFrac ?? 1;
      if (fPix < 1) {
        inputs.pixel_fraction = fPix;   // pixel width = f_pix × cloud width, centered
        mu_histograms.reflected_counts_pixel = Array.from(SimStats.muReflPixelBins);
        bdf.reflected_weights_pixel =
          BottomPanel.computeBdfGrid(SimStats.bdfReflPixelWeights).weights;
        bdf.n_pixel_incident = SimStats.nPixelIncident();
        if (SimStats.nPixelIncident() > 0) {
          bdf.reflected_brf_pixel =
            BottomPanel.computeBdfGrid(SimStats.bdfReflPixelWeights,
              { nRef: SimStats.nPixelIncident(), sidesIncluded: false }).bdf;
        }
      }

      // --- Optical path-length histograms (binned + true means) ---
      // Reproduce the bottom-panel computation exactly so the file matches the
      // figure: 24 bins on [0, niceMax], values ≥ niceMax clipped into bin 23.
      // Axis (niceMax) and binning come from the SAME SimStats helpers the
      // panel uses (review E2/R2): the axis is scaled from the genuine
      // (touchedCloud=true) path population, independent of the Observation-
      // geometry dropdown -- it is NOT derived from the exported segments'
      // own means, so it always matches the on-screen figure's axis.
      // Path arrays as observation-geometry segments (iterated, not concatenated).
      const reflSegs  = SimStats.reflectedPathSegments();
      const netSegs   = SimStats.transmittedPathSegments();
      const segLen  = segs => { let n=0; for (const a of segs) n+=a.length; return n; };
      const meanR = SimStats.segMean(reflSegs), meanT = SimStats.segMean(netSegs);
      const niceMax = SimStats.pathAxisMax();
      const PATH_BINS = 24;
      const pathEdges = [];
      for (let i = 0; i <= PATH_BINS; i++) pathEdges.push(i * niceMax / PATH_BINS);
      const path_length_histograms = {
        description: "Optical path-length distributions (units of optical depth). " +
                     "Photons with path ≥ bin_max are accumulated in the final " +
                     "(overflow) bin, matching the on-screen panel. bin_max is " +
                     "scaled from the genuine (cloud-touched) path population, " +
                     "matching the on-screen axis exactly; exact-zero paths " +
                     "(clear-sky-direct photons, Uniform domain only) are not " +
                     "binned (none occur in the segment lists exported here). " +
                     "*_mean are the true means over the exported photons (not " +
                     "affected by clipping).",
        n_bins: PATH_BINS,
        bin_max: niceMax,
        bin_edges: pathEdges,            // length n_bins+1; last bin is overflow
        overflow_in_last_bin: true,
        reflected_counts: SimStats.pathHistogramCounts(reflSegs, niceMax, PATH_BINS),
        reflected_N: segLen(reflSegs),
        reflected_mean: meanR,
        net_transmitted_counts: SimStats.pathHistogramCounts(netSegs, niceMax, PATH_BINS),
        net_transmitted_N: segLen(netSegs),
        net_transmitted_mean: meanT
      };

      return {
        format: "mc_cloud_rt_export",
        schema_version: Export.SCHEMA_VERSION,
        generated: new Date().toISOString(),
        generator: "VISTA-C — browser Monte Carlo cloud radiative transfer",
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
