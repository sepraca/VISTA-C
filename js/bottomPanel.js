// bottomPanel.js — Canvas-based plot drawing: μ histograms, BDF, path-length.

import { SimStats, MU_BINS, BDF_THETA_BINS, BDF_PHI_BINS } from './simstats.js';
import { UI } from './ui.js';
import { state } from './state.js';

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
        title.textContent = "BDF polar plots: exit zenith angle Θ and azimuth φ";
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

      // Bins are accumulated incrementally in SimStats. The net-transmitted
      // bins carry signed weights (+1 per downward base/surface arrival,
      // -1 per surface reflection), so the bars show net (down − up) energy
      // per µ bin; identical to a gross histogram when A_s = 0.
      const nNetTrans = SimStats.stats.transmitted - SimStats.stats.surfaceReflected;
      BottomPanel.drawMuOverlayHistogram(ctx2, SimStats.muReflBins, 70, 42, 260, 118, "#60a5fa", "Reflected", SimStats.stats.reflected);
      BottomPanel.drawMuOverlayHistogram(ctx2, SimStats.muNetTransBins, 390, 42, 260, 118, "#86efac", "Transmitted (net downward)", nNetTrans);

      ctx2.fillStyle = "#e2e8f0";
      ctx2.font = "12px system-ui";
      ctx2.textAlign = "center";
      ctx2.fillText("μ = 1: perpendicular / vertical exit", 200, 224);
      ctx2.fillText("μ = 0: near-horizontal exit", 520, 224);
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
      // many φ bins correspond to almost the same direction. Average across φ
      // for near-nadir rings to suppress Monte Carlo bin noise.
      if (!UI.getAvgNearNadirBdf()) return grid;

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

      function mean(arr) {
        return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
      }

      const meanR = mean(SimStats.reflectedPathLengths);
      const meanT = mean(SimStats.netTransmittedPathLengths);
      const scaleMean = Math.max(meanR, meanT);

      // Use a representative path-length scale rather than the rare-event maximum.
      // This keeps the bulk of the reflected/transmitted distributions visible.
      // Long-tail photons are clipped into the last bin.
      const niceMax = Math.max(
        10,
        Math.ceil((2.5 * Math.max(scaleMean, 1)) / 10) * 10
      );

      function drawPathHistogram(data, x0, y0, width, height, color, title, nOverride=null) {
        const nBins = 24;
        const counts = new Array(nBins).fill(0);

        for (const vRaw of data) {
          const v = Math.max(0, vRaw || 0);
          const idx = Math.min(nBins - 1, Math.floor((v / niceMax) * nBins));
          counts[idx] += 1; // current analog photons have W = 1
        }

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

        // Title
        ctx2.fillStyle = "#f8fafc";
        ctx2.font = "bold 13px system-ui";
        ctx2.textAlign = "center";
        ctx2.textBaseline = "alphabetic";
        ctx2.fillText(`${title}  N=${nOverride !== null ? nOverride : data.length}`, x0 + width / 2, y0 - 12);

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
      drawPathHistogram(SimStats.reflectedPathLengths, 70, 42, 260, 118, "#60a5fa", "Reflected");
      drawPathHistogram(SimStats.netTransmittedPathLengths, 390, 42, 260, 118, "#86efac", "Net transmitted (surface-deposited)");

      ctx2.fillStyle = "#e2e8f0";
      ctx2.font = "11px system-ui";
      ctx2.textAlign = "center";
      ctx2.fillText(
        `Mean reflected path=${mean(SimStats.reflectedPathLengths).toFixed(2)}   |   Mean surface-deposited path=${mean(SimStats.netTransmittedPathLengths).toFixed(2)}   |   W=1 per photon`,
        w / 2,
        224
      );
    },

    drawBdfOverlay: function() {
      const canvas2 = document.getElementById("muCanvas");
      if (!canvas2) return;

      const { ctx2, w, h } = BottomPanel.getHiDpiPanelContext(canvas2);

      ctx2.clearRect(0, 0, w, h);

      ctx2.fillStyle = "#000000";
      ctx2.fillRect(0, 0, w, h);

      const reflectedGrid = BottomPanel.smoothNearNadirAzimuth(BottomPanel.computeBdfGrid(SimStats.bdfReflWeights));
      const transmittedGrid = BottomPanel.smoothNearNadirAzimuth(BottomPanel.computeBdfGrid(SimStats.bdfNetWeights));

      BottomPanel.drawBdfPolarPlot(ctx2, reflectedGrid, BDF_LAYOUT.reflectedX, BDF_LAYOUT.y, BDF_LAYOUT.radius, "Reflected");
      BottomPanel.drawBdfPolarPlot(ctx2, transmittedGrid, BDF_LAYOUT.transmittedX, BDF_LAYOUT.y, BDF_LAYOUT.radius, "Net Transmitted");
      BottomPanel.drawColorBar(ctx2, BDF_LAYOUT.colorbarX, BDF_LAYOUT.colorbarY, BDF_LAYOUT.colorbarW, BDF_LAYOUT.colorbarH, "BDF");

      ctx2.fillStyle = "#e2e8f0";
      ctx2.font = "11px system-ui";
      ctx2.textAlign = "center";
      const scaleTxt = UI.getBdfColorScaleMode() === "log" ? "log BDF scale: 0.01–1" : "linear BDF scale: 0–1";
      const avgTxt = UI.getAvgNearNadirBdf() ? "; near-nadir φ averaged" : "";
      ctx2.fillText(`Transmitted panel is net down−up at surface; ${scaleTxt}${avgTxt}.`, w / 2, 212);
    },

    // Build the displayable BDF grid from a flat incremental weight array
    // (length BDF_THETA_BINS * BDF_PHI_BINS, accumulated in SimStats).
    computeBdfGrid: function(weightsFlat) {
      const thetaBins = BDF_THETA_BINS;
      const phiBins = BDF_PHI_BINS;
      const weights = Array.from({ length: thetaBins }, (_, ir) =>
        Array.from({ length: phiBins }, (_, ip) => weightsFlat[ir * phiBins + ip]));
      const bdf = Array.from({ length: thetaBins }, () => Array(phiBins).fill(0));
      const binInfo = Array.from({ length: thetaBins }, () => Array(phiBins).fill(null));

      const nIncident = Math.max(SimStats.stats.launched, 1);
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
          const value = (weights[ir][ip] / nIncident) * normFactor;
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
      ctx2.fillText(isLog ? "Log BDF" : "BDF", 0, 0);
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
