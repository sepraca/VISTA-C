// scene.js — Three.js scene geometry builders and camera helpers.

import * as THREE from 'three';
import { state, world, SLAB_RENDER_HEIGHT } from './state.js';
import { UI } from './ui.js';
import { Coords } from './coords.js';
import { SimStats } from './simstats.js';
import { BottomPanel } from './bottomPanel.js';

export const Scene = {

    // Dispose all Three.js objects in a group and empty it.
    // Prevents GPU memory leaks when geometry is rebuilt.
    clearGroup: function(group) {
      while (group.children.length > 0) {
        const obj = group.children.pop();
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
          else obj.material.dispose();
        }
        group.remove(obj);
      }
    },

    // Sync the world object with current UI inputs.
    // Must be called before Scene.buildCloudBox() and at state.scene reset.
    updateWorld: function() {
      world.tauCloud = UI.getTauCloud();
      world.slabH = SLAB_RENDER_HEIGHT;
      world.zScale = world.slabH / world.tauCloud;
      const L = UI.getHorizontalExtent();
      world.slabW = L;
      world.slabD = L;
    },

    // Reset state.camera to the default view position.
    resetCamera: function() {
      state.camera.position.set(0, -90, 18);
      state.camera.up.set(0, 0, 1);
      state.controls.target.set(0, 0, -15);
      state.controls.update();
    },

    // Main state.scene builder: updates world state, clears state.cloudGroup, and
    // assembles cloud slab, surface plane, axes, arrows, and histograms.
    buildCloudBox: function() {
      Scene.updateWorld();
      Scene.clearGroup(state.cloudGroup);

      const boxGeom = new THREE.BoxGeometry(world.slabW, world.slabD, world.slabH);
      const boxMat = new THREE.MeshStandardMaterial({
        color: 0x7dd3fc,
        transparent: true,
        opacity: 0.18,
        roughness: 0.8,
        side: THREE.DoubleSide,
        depthWrite: false
      });

      const box = new THREE.Mesh(boxGeom, boxMat);
      state.cloudGroup.add(box);

      const edges = new THREE.EdgesGeometry(boxGeom);
      const edgeMat = new THREE.LineBasicMaterial({color: 0xe0f2fe, transparent: true, opacity: 0.9});
      state.cloudGroup.add(new THREE.LineSegments(edges, edgeMat));

      const planeGeom = new THREE.PlaneGeometry(world.slabW, world.slabD);

      const topMat = new THREE.MeshBasicMaterial({
        color: 0x60a5fa,
        transparent: true,
        opacity: 0.14,
        side: THREE.DoubleSide,
        depthWrite: false
      });
      const topPlane = new THREE.Mesh(planeGeom, topMat);
      topPlane.position.z = world.slabH / 2 + 0.004;
      state.cloudGroup.add(topPlane);

      const bottomMat = new THREE.MeshBasicMaterial({
        color: 0x86efac,
        transparent: true,
        opacity: 0.14,
        side: THREE.DoubleSide,
        depthWrite: false
      });
      const bottomPlane = new THREE.Mesh(planeGeom, bottomMat);
      bottomPlane.position.z = -world.slabH / 2 - 0.004;
      state.cloudGroup.add(bottomPlane);

      // Lambertian surface plane — opacity scales with A_s so a black surface
      // is subtle while brighter surfaces are visually obvious.
      const surfaceAlbedo = UI.getSurfaceAlbedo();
      const surfaceMat = new THREE.MeshBasicMaterial({
        color: surfaceAlbedo > 0 ? 0xa855f7 : 0x1f2937,
        transparent: true,
        opacity: surfaceAlbedo > 0 ? 0.18 + 0.35 * surfaceAlbedo : 0.10,
        side: THREE.DoubleSide,
        depthWrite: false
      });
      const surfacePlane = new THREE.Mesh(planeGeom, surfaceMat);
      surfacePlane.position.z = Coords.tauToZ(Coords.getSurfaceTau());
      state.cloudGroup.add(surfacePlane);

      const surfaceEdges = new THREE.EdgesGeometry(planeGeom);
      const surfaceEdgeMat = new THREE.LineBasicMaterial({
        color: surfaceAlbedo > 0 ? 0xc084fc : 0x64748b,
        transparent: true,
        opacity: surfaceAlbedo > 0 ? 0.9 : 0.45
      });
      const surfaceEdge = new THREE.LineSegments(surfaceEdges, surfaceEdgeMat);
      surfaceEdge.position.z = Coords.tauToZ(Coords.getSurfaceTau()) + 0.005;
      state.cloudGroup.add(surfaceEdge);

      // Vertical guide line showing the clear cloud-to-surface gap.
      const gapGuideMat = new THREE.LineBasicMaterial({
        color: surfaceAlbedo > 0 ? 0xc084fc : 0x64748b,
        transparent: true,
        opacity: surfaceAlbedo > 0 ? 0.55 : 0.28
      });
      const guideGeom = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(world.slabW / 2 + 1.2, world.slabD / 2 + 1.2, -world.slabH / 2),
        new THREE.Vector3(world.slabW / 2 + 1.2, world.slabD / 2 + 1.2, Coords.tauToZ(Coords.getSurfaceTau()))
      ]);
      state.cloudGroup.add(new THREE.Line(guideGeom, gapGuideMat));

      if (surfaceAlbedo > 0) {
        const surfaceNote = Scene.makeTextSprite(
          "Clear sub-cloud gap: geometric displacement only.\nNo extinction/scattering/absorption in the gap.",
          {fontSize: 16, padding: 4, scale: 1.1}
        );
        surfaceNote.position.set(
          0,
          -world.slabD / 2 - 3.0,
          Coords.tauToZ(Coords.getSurfaceTau()) - 0.9
        );
        state.cloudGroup.add(surfaceNote);
      }

      Scene.addAxes();
      Scene.addIncidentArrow();
      Scene.rebuildHistograms();
    },

    // Create a canvas-based text sprite for 3D annotation labels.
    makeTextSprite: function(text, options={}) {
      const fontSize = options.fontSize ?? 22;
      const padding = options.padding ?? 6;
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");

      ctx.font = `${fontSize}px system-ui, -apple-system, Segoe UI, sans-serif`;
      const lines = text.split("\n");
      const maxWidth = Math.max(...lines.map(line => ctx.measureText(line).width));

      canvas.width = Math.ceil(maxWidth + 2 * padding);
      canvas.height = Math.ceil(lines.length * fontSize * 1.35 + 2 * padding);

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.font = `${fontSize}px system-ui, -apple-system, Segoe UI, sans-serif`;
      ctx.fillStyle = "rgba(248, 250, 252, 0.92)";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";

      lines.forEach((line, i) => {
        ctx.fillText(line, canvas.width / 2, padding + i * fontSize * 1.35);
      });

      const texture = new THREE.CanvasTexture(canvas);
      texture.needsUpdate = true;

      const material = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
        depthTest: false
      });

      const sprite = new THREE.Sprite(material);
      const scale = options.scale ?? 2.2;
      sprite.scale.set(scale * canvas.width / canvas.height, scale, 1);
      return sprite;
    },

    // Create a Three.js Line from an array of Vector3 points.
    makeLine: function(points, color, opacity=1) {
      const geom = new THREE.BufferGeometry().setFromPoints(points);
      const mat = new THREE.LineBasicMaterial({color, transparent: opacity < 1, opacity});
      return new THREE.Line(geom, mat);
    },

    // Add X, Y, Z axis lines and τ tick marks along the cloud slab edges.
    addAxes: function() {
      const zBase = -world.slabH / 2;
      state.cloudGroup.add(Scene.makeLine([
        new THREE.Vector3(-world.slabW/2 - 2, -world.slabD/2 - 1, zBase),
        new THREE.Vector3(world.slabW/2 + 2, -world.slabD/2 - 1, zBase)
      ], 0xffffff, 0.8));

      state.cloudGroup.add(Scene.makeLine([
        new THREE.Vector3(-world.slabW/2 - 1, -world.slabD/2 - 2, zBase),
        new THREE.Vector3(-world.slabW/2 - 1, world.slabD/2 + 2, zBase)
      ], 0xffffff, 0.8));

      state.cloudGroup.add(Scene.makeLine([
        new THREE.Vector3(-world.slabW/2 - 1.3, -world.slabD/2 - 1.3, world.slabH/2),
        new THREE.Vector3(-world.slabW/2 - 1.3, -world.slabD/2 - 1.3, -world.slabH/2)
      ], 0xffffff, 0.8));

      const nTicks = Math.min(10, Math.ceil(world.tauCloud));
      for (let i = 0; i <= nTicks; i++) {
        const tau = world.tauCloud * i / nTicks;
        const z = Coords.tauToZ(tau);
        state.cloudGroup.add(Scene.makeLine([
          new THREE.Vector3(-world.slabW/2 - 1.7, -world.slabD/2 - 1.3, z),
          new THREE.Vector3(-world.slabW/2 - 0.9, -world.slabD/2 - 1.3, z)
        ], 0xffffff, 0.55));
      }
    },

    // Add the red incident solar direction arrow above the cloud top.
    addIncidentArrow: function() {
      const theta = UI.getTheta0Rad();
      const start = new THREE.Vector3(-Math.sin(theta) * 3, 0, world.slabH/2 + 4);
      const end = new THREE.Vector3(0, 0, world.slabH/2 + 0.25);
      const dir = new THREE.Vector3().subVectors(end, start);
      const length = dir.length();
      const arrow = new THREE.ArrowHelper(dir.clone().normalize(), start, length, 0xef4444, 0.7, 0.35);
      state.cloudGroup.add(arrow);
    },

    // Rebuild all 3D histogram geometry (footprints, surface markers).
    // Called after each run batch and when the state.scene is rebuilt.
    rebuildHistograms: function() {
      Scene.clearGroup(state.histogramGroup);
      BottomPanel.drawBottomPanel();

      // Reinitializes the footprint accumulators if the UI grid resolution
      // changed (accumulated footprint data restarts at the new resolution).
      SimStats.ensureFootprintGrids();

      Scene.addFootprintHeatmap(
        SimStats.footRefl,
        world.slabH / 2 + 0.035,
        0x60a5fa,
        true
      );

      Scene.addFootprintHeatmap(
        SimStats.footTrans,
        -world.slabH / 2 - 0.035,
        0x86efac,
        false
      );

      Scene.addSurfaceInteractionMarkers();
    },

    // Add sphere markers at the surface plane for reflected/absorbed events.
    addSurfaceInteractionMarkers: function() {
      if (!SimStats.surfaceInteractionEvents || SimStats.surfaceInteractionEvents.length === 0) return;

      const cap = Math.min(1200, SimStats.surfaceInteractionEvents.length);
      const start = Math.max(0, SimStats.surfaceInteractionEvents.length - cap);

      for (let i = start; i < SimStats.surfaceInteractionEvents.length; i++) {
        const ev = SimStats.surfaceInteractionEvents[i];
        const color = ev.type === "surface_reflected" ? 0xa855f7 : 0x7c2d12;
        const radius = ev.type === "surface_reflected" ? 0.13 : 0.16;

        const geom = new THREE.SphereGeometry(radius, 10, 10);
        const mat = new THREE.MeshStandardMaterial({
          color,
          emissive: color,
          emissiveIntensity: 1.1,
          transparent: true,
          opacity: 0.75,
          roughness: 0.4
        });

        const s = new THREE.Mesh(geom, mat);
        s.position.copy(Coords.simToWorldPoint({x: ev.x, y: ev.y, tau: ev.tau}));
        s.position.z -= 0.18;
        state.histogramGroup.add(s);
      }
    },

    // Build a footprint heatmap on the cloud top or base plane from an
    // incremental count grid ({nBins, counts: Float64Array(nBins*nBins)},
    // accumulated in SimStats).
    addFootprintHeatmap: function(foot, zPlane, color, isTop) {
      if (!foot || !foot.counts) return;
      const nBins = foot.nBins;
      const counts = foot.counts;
      const halfW = world.slabW / 2;
      const halfD = world.slabD / 2;

      let maxCount = 1;
      for (let i = 0; i < counts.length; i++)
        if (counts[i] > maxCount) maxCount = counts[i];

      const cellW = world.slabW / nBins;
      const cellD = world.slabD / nBins;
      // AESTHETIC: max relief height. Original 2.8; tried 1.2 to keep boxes
      // from burying the co-planar endpoint dots. Currently 2.8 for an
      // opacity-only A/B comparison (opacity lowered separately below).
      const maxHeight = 2.8;
      const baseColor = new THREE.Color(color);

      for (let ix = 0; ix < nBins; ix++) {
        for (let iy = 0; iy < nBins; iy++) {
          const c = counts[ix * nBins + iy];
          if (c === 0) continue;

          const frac = c / maxCount;
          const h = 0.045 + maxHeight * frac;

          const geom = new THREE.BoxGeometry(
            Math.max(0.02, cellW * 0.92),
            Math.max(0.02, cellD * 0.92),
            h
          );
          const cellColor = baseColor.clone().lerp(new THREE.Color(0xffffff), 0.18 + 0.45 * frac);
          const mat = new THREE.MeshStandardMaterial({
            color: cellColor,
            emissive: cellColor,
            emissiveIntensity: 0.25 + 0.9 * frac,
            transparent: true,
            // AESTHETIC: lowered max opacity from (0.42 + 0.48*frac, peak 0.90)
            // so the heatmap is more translucent and the endpoint dots show
            // through. To REVERT, set back to 0.42 + 0.48 * frac.
            opacity: 0.22 + 0.30 * frac,
            roughness: 0.45,
            depthWrite: false
          });

          const mesh = new THREE.Mesh(geom, mat);
          const x = -halfW + cellW * (ix + 0.5);
          const y = -halfD + cellD * (iy + 0.5);
          const z = isTop ? zPlane + h / 2 : zPlane - h / 2;
          mesh.position.set(x, y, z);
          state.histogramGroup.add(mesh);
        }
      }

      // Outline frame so the heatmap domain boundary is visually clear.
      const zFrame = isTop ? zPlane + 0.01 : zPlane - 0.01;
      const framePts = [
        new THREE.Vector3(-halfW, -halfD, zFrame),
        new THREE.Vector3( halfW, -halfD, zFrame),
        new THREE.Vector3( halfW,  halfD, zFrame),
        new THREE.Vector3(-halfW,  halfD, zFrame),
        new THREE.Vector3(-halfW, -halfD, zFrame)
      ];
      const frame = Scene.makeLine(framePts, color, 0.95);
      state.histogramGroup.add(frame);
    }
  };
