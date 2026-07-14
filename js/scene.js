// scene.js — Three.js scene geometry builders and camera helpers.

import * as THREE from 'three';
import { state, world } from './state.js';
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
          // Shared materials (e.g. the reused heatmap material) are kept across
          // rebuilds so their compiled shader program isn't thrown away each time;
          // skip disposing them. Per-object materials are disposed normally.
          if (Array.isArray(obj.material)) obj.material.forEach(m => { if (!m.userData?.shared) m.dispose(); });
          else if (!obj.material.userData?.shared) obj.material.dispose();
        }
        group.remove(obj);
      }
    },

    // Sync the world object with current UI inputs.
    // Must be called before Scene.buildCloudBox() and at state.scene reset.
    updateWorld: function() {
      world.tauCloud = UI.getTauCloud();
      // Render height = cloud optical depth, so 1 τ maps to 1 world unit on the
      // vertical axis exactly as the horizontal extent does. The box then shows
      // the cloud's true optical aspect ratio (COT = extent renders as a cube),
      // instead of squeezing every COT into a fixed render height.
      world.slabH = world.tauCloud;
      world.zScale = world.slabH / world.tauCloud;   // = 1
      const L = UI.getHorizontalExtent();
      world.slabW = L;
      world.slabD = L;

      // Full illumination-domain extent (M·W x M·D), used to size the rendered
      // Lambertian surface plane so it visually matches the region photons are
      // actually launched over. Legacy illumination modes (center/top/top_side)
      // collapse to M=1, so domainW/domainD === slabW/slabD and rendering is
      // unchanged from before this was added. See TODO-direct-surface-
      // illumination.md, "Uniform domain" section, for the M·W domain definition.
      const isUniformDomain = UI.getPhotonEntryMode() === "uniform_domain";
      const M = isUniformDomain ? UI.getDomainFactor() : 1;
      world.domainW = M * L;
      world.domainD = M * L;
    },

    // Reset state.camera to the default view position.
    resetCamera: function() {
      // state.camera.position.set(0, -90, 33);   // +15 vs target keeps the angle; pans the cloud down, clear of the legend
      state.camera.position.set(0, -90, 21);   // +15 vs target keeps the angle; pans the cloud down, clear of the legend
      state.camera.up.set(0, 0, 1);
      state.controls.target.set(0, 0, -12);
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
      // is subtle while brighter surfaces are visually obvious. Sized to the
      // full illumination-domain extent (world.domainW/domainD), NOT the cloud
      // extent, so that under "Uniform domain" illumination the drawn surface
      // visually matches the M·W x M·D region photons are actually launched
      // over. For legacy modes domainW/domainD === slabW/slabD, so this is
      // pixel-identical to the pre-existing fixed-extent rendering.
      const surfaceAlbedo = UI.getSurfaceAlbedo();
      const domainPlaneGeom = new THREE.PlaneGeometry(world.domainW, world.domainD);
      const surfaceMat = new THREE.MeshBasicMaterial({
        color: surfaceAlbedo > 0 ? 0xa855f7 : 0x1f2937,
        transparent: true,
        opacity: surfaceAlbedo > 0 ? 0.18 + 0.35 * surfaceAlbedo : 0.10,
        side: THREE.DoubleSide,
        depthWrite: false
      });
      const surfacePlane = new THREE.Mesh(domainPlaneGeom, surfaceMat);
      surfacePlane.position.z = Coords.tauToZ(Coords.getSurfaceTau());
      state.cloudGroup.add(surfacePlane);

      const surfaceEdges = new THREE.EdgesGeometry(domainPlaneGeom);
      const surfaceEdgeMat = new THREE.LineBasicMaterial({
        color: surfaceAlbedo > 0 ? 0xc084fc : 0x64748b,
        transparent: true,
        opacity: surfaceAlbedo > 0 ? 0.9 : 0.45
      });
      const surfaceEdge = new THREE.LineSegments(surfaceEdges, surfaceEdgeMat);
      surfaceEdge.position.z = Coords.tauToZ(Coords.getSurfaceTau()) + 0.005;
      state.cloudGroup.add(surfaceEdge);

      // When the surface domain is wider than the cloud (M>1), also outline the
      // cloud's own footprint AT the surface plane's z-level, dimly, so users can
      // see where the (much smaller) cloud sits inside the wider launch domain —
      // otherwise the size jump between cloud box and surface plane can read as
      // just "the surface got bigger" rather than "here's the cloud within it."
      if (world.domainW > world.slabW + 1e-9) {
        const cloudFootprintGeom = new THREE.EdgesGeometry(planeGeom);
        const cloudFootprintMat = new THREE.LineBasicMaterial({
          color: 0x7dd3fc,
          transparent: true,
          opacity: 0.55
        });
        const cloudFootprintOutline = new THREE.LineSegments(cloudFootprintGeom, cloudFootprintMat);
        cloudFootprintOutline.position.z = Coords.tauToZ(Coords.getSurfaceTau()) + 0.006;
        state.cloudGroup.add(cloudFootprintOutline);
      }

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
    // The arrow points along the TRUE incident direction so its tilt from
    // vertical equals Θ₀ (0° → straight down, 89° → nearly horizontal). In world
    // space the beam travels +x (toward the sunward side) and −z (downward, since
    // τ increases as world z decreases); the sun therefore sits up and to the −x.
    addIncidentArrow: function() {
      const theta = UI.getTheta0Rad();
      const dir = new THREE.Vector3(Math.sin(theta), 0, -Math.cos(theta));  // unit incident direction
      const length = 5;
      const headLength = 1.4, headRadius = 0.66, shaftRadius = 0.26;
      const shaftLength = Math.max(0.1, length - headLength);
      const tip = new THREE.Vector3(0, 0, world.slabH / 2 + 0.25);          // apex, just above top-centre

      // Solid-geometry arrow (cylinder shaft + cone head) so it stays clearly
      // visible against dense photon paths — a Line shaft can't be thickened
      // because WebGL ignores linewidth. MeshBasic = unlit, full-brightness red.
      const mat = new THREE.MeshBasicMaterial({ color: 0xef4444 });
      const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);

      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(shaftRadius, shaftRadius, shaftLength, 16), mat);
      shaft.quaternion.copy(quat);
      shaft.position.copy(tip).addScaledVector(dir, -(headLength + shaftLength / 2));
      state.cloudGroup.add(shaft);

      const head = new THREE.Mesh(new THREE.ConeGeometry(headRadius, headLength, 16), mat);
      head.quaternion.copy(quat);
      head.position.copy(tip).addScaledVector(dir, -headLength / 2);
      state.cloudGroup.add(head);
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

      // Surface-absorption heatmap: where photons are absorbed at the
      // Lambertian surface. Shown whenever Aₛ>0 (any mode) OR under Uniform
      // domain illumination even at Aₛ=0 (CODE-REVIEW P6) — the direct
      // clear-sky beam still gets bookkept as a genuine surface-absorption
      // event there (Aₛ=0 just means it doesn't reflect), and the resulting
      // pattern shows the cloud's shadow, which is pedagogically useful in
      // its own right. Grid extent is SimStats._surfFootFactor× the cloud
      // extent (far/out-of-grid landings clamp to the edge cells) — cached at
      // run start so it can track the domain factor M under Uniform domain
      // instead of the legacy fixed 2× (see surfaceFootFactor() in
      // simstats.js); it rises UP from the surface plane. Relief matches the
      // reflected/base heatmaps (2.8) so all three share one height scale.
      // Trade-off: at a small sub-cloud gap (low d_sfc / β_ext) this can
      // overlap the base-crossing footprint in mid-gap — acceptable since
      // both are translucent. Light brown, geometry-independent.
      if ((UI.getSurfaceAlbedo() > 0 || UI.getPhotonEntryMode() === "uniform_domain") && UI.getShowSurfaceHeatmap()) {
        Scene.addFootprintHeatmap(
          SimStats.footSurfAbs,
          Coords.tauToZ(Coords.getSurfaceTau()) + 0.02,
          0xc8a27a,
          true,
          world.slabW * SimStats._surfFootFactor,
          world.slabD * SimStats._surfFootFactor,
          2.8
        );
      }

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

    // Shared material for every footprint heatmap. InstancedMesh draws all cells of
    // a heatmap with ONE material, but three.js per-instance color is RGB-only — no
    // per-instance opacity or emissive. We add those two via onBeforeCompile:
    //   instanceAlpha  -> scales the fragment alpha (old per-cell opacity)
    //   instanceEmis   -> scales an emissive term tinted by the instance color
    //                     (vColor, supplied by three's USE_INSTANCING_COLOR path)
    // so the look is identical to the old per-cell MeshStandardMaterial. One lazy
    // singleton, reused across rebuilds and all three heatmaps, so the shader
    // compiles once; clearGroup keeps it (userData.shared) instead of disposing it.
    _heatMat: null,
    _heatmapMaterial: function() {
      if (Scene._heatMat) return Scene._heatMat;
      const mat = new THREE.MeshStandardMaterial({
        color: 0xffffff,      // modulated per instance by setColorAt
        emissive: 0x000000,   // per-instance glow added in the shader
        roughness: 0.45,
        transparent: true,
        depthWrite: false
      });
      mat.onBeforeCompile = (shader) => {
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>',
            '#include <common>\nattribute float instanceAlpha;\nattribute float instanceEmis;\nvarying float vAlpha;\nvarying float vEmis;')
          .replace('#include <begin_vertex>',
            '#include <begin_vertex>\nvAlpha = instanceAlpha;\nvEmis = instanceEmis;');
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>',
            '#include <common>\nvarying float vAlpha;\nvarying float vEmis;')
          .replace('#include <emissivemap_fragment>',
            '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vColor * vEmis;')
          .replace('#include <dithering_fragment>',
            'gl_FragColor.a *= vAlpha;\n#include <dithering_fragment>');
      };
      mat.customProgramCacheKey = () => 'vista-heatmap-v1';
      mat.userData.shared = true;   // clearGroup must not dispose this
      Scene._heatMat = mat;
      return mat;
    },

    // Build a footprint heatmap on the cloud top or base plane from an
    // incremental count grid ({nBins, counts: Float64Array(nBins*nBins)},
    // accumulated in SimStats). All non-empty cells render as a single
    // InstancedMesh (a shared unit box scaled per instance) — formerly one
    // Mesh+geometry+material per cell (thousands of objects, rebuilt each refresh).
    addFootprintHeatmap: function(foot, zPlane, color, isTop, extentW, extentD, maxHeight) {
      if (!foot || !foot.counts) return;
      const nBins = foot.nBins;
      const counts = foot.counts;
      const fullW = extentW ?? world.slabW;   // domain width (defaults to cloud extent)
      const fullD = extentD ?? world.slabD;
      const halfW = fullW / 2;
      const halfD = fullD / 2;

      let maxCount = 1, nCells = 0;
      for (let i = 0; i < counts.length; i++) {
        if (counts[i] > maxCount) maxCount = counts[i];
        if (counts[i] > 0) nCells++;
      }

      const cellW = fullW / nBins;
      const cellD = fullD / nBins;
      // AESTHETIC: max relief height. Original 2.8; tried 1.2 to keep boxes
      // from burying the co-planar endpoint dots. Caller may override — the
      // surface heatmap uses a smaller relief so it doesn't collide with the
      // base-crossing footprint that hangs down into the gap.
      const reliefHeight = maxHeight ?? 2.8;
      const baseColor = new THREE.Color(color);

      if (nCells > 0) {
        // Unit box scaled per instance by the instance matrix (cell footprint ×
        // bar height). Per-instance color/opacity/glow are filled below.
        const geom = new THREE.BoxGeometry(1, 1, 1);
        const cw = Math.max(0.02, cellW * 0.92);
        const cd = Math.max(0.02, cellD * 0.92);
        const mesh = new THREE.InstancedMesh(geom, Scene._heatmapMaterial(), nCells);
        mesh.frustumCulled = false;   // cells span the whole domain

        const alpha = new Float32Array(nCells);
        const emis  = new Float32Array(nCells);
        const m4 = new THREE.Matrix4();
        const col = new THREE.Color();
        const white = new THREE.Color(0xffffff);

        let i = 0;
        for (let ix = 0; ix < nBins; ix++) {
          for (let iy = 0; iy < nBins; iy++) {
            const c = counts[ix * nBins + iy];
            if (c === 0) continue;

            const frac = c / maxCount;
            const h = 0.045 + reliefHeight * frac;
            const x = -halfW + cellW * (ix + 0.5);
            const y = -halfD + cellD * (iy + 0.5);
            const z = isTop ? zPlane + h / 2 : zPlane - h / 2;

            m4.makeScale(cw, cd, h);
            m4.setPosition(x, y, z);
            mesh.setMatrixAt(i, m4);

            col.copy(baseColor).lerp(white, 0.18 + 0.45 * frac);
            mesh.setColorAt(i, col);

            alpha[i] = 0.22 + 0.30 * frac;   // old per-cell opacity (see history below)
            emis[i]  = 0.25 + 0.9 * frac;    // old emissiveIntensity
            i++;
          }
        }
        // AESTHETIC history: max opacity was lowered from (0.42 + 0.48*frac, peak
        // 0.90) so the heatmap is more translucent and the endpoint dots show
        // through. To REVERT, set alpha[i] back to 0.42 + 0.48 * frac.
        geom.setAttribute('instanceAlpha', new THREE.InstancedBufferAttribute(alpha, 1));
        geom.setAttribute('instanceEmis',  new THREE.InstancedBufferAttribute(emis, 1));
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        state.histogramGroup.add(mesh);
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
