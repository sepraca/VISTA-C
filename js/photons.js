// photons.js — Per-photon 3D rendering: paths, endpoints, animation.

import * as THREE from 'three';
import { state, world } from './state.js';
import { UI } from './ui.js';
import { Coords } from './coords.js';
import { SimStats } from './simstats.js';

export const Photons = {
    clearLastScatterMarker: function() {
      if (state.lastScatterMarker) {
        state.pathGroup.remove(state.lastScatterMarker);
        if (state.lastScatterMarker.geometry) state.lastScatterMarker.geometry.dispose();
        if (state.lastScatterMarker.material) state.lastScatterMarker.material.dispose();
        state.lastScatterMarker = null;
      }
    },

    setLastScatterMarker: function(position) {
      Photons.clearLastScatterMarker();

      const color = 0xf97316;
      const geom = new THREE.SphereGeometry(0.34, 20, 20);
      const mat = new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 2.4,
        roughness: 0.2
      });

      state.lastScatterMarker = new THREE.Mesh(geom, mat);
      state.lastScatterMarker.position.copy(position);
      state.pathGroup.add(state.lastScatterMarker);
    },

    addPhotonToScene: function(result, drawPath=true) {
      if (drawPath && result.path && result.path.length > 1) {
        Photons.addStaticPath(result);
      }
      Photons.addEndpoint(result);
    },

    addStaticPath: function(result) {
      const pts = result.path.map(Coords.simToWorldPoint);
      const geom = new THREE.BufferGeometry().setFromPoints(pts);
      const mat = new THREE.LineBasicMaterial({
        color: UI.getOutcomeColor(result.status),
        transparent: true,
        opacity: 0.48
      });
      state.pathGroup.add(new THREE.Line(geom, mat));
    },

    makeTubeFromPoints: function(points, color, radius=0.11, opacity=1.0) {
      if (!points || points.length < 2) return null;

      const curve = new THREE.CatmullRomCurve3(points);
      const tubularSegments = Math.max(8, Math.min(260, points.length * 3));
      const geom = new THREE.TubeGeometry(curve, tubularSegments, radius, 10, false);

      const mat = new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 1.6,
        transparent: false,
        roughness: 0.25,
        metalness: 0.05
      });

      return new THREE.Mesh(geom, mat);
    },

    makePhotonHead: function(color=0xfff700) {
      const geom = new THREE.SphereGeometry(0.28, 20, 20);
      const mat = new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 2.8,
        roughness: 0.18,
        metalness: 0.05
      });
      return new THREE.Mesh(geom, mat);
    },

    makeScatterFlash: function(position, color=0xfef08a) {
      const haloGeom = new THREE.SphereGeometry(0.26, 22, 22);
      const haloMat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        depthTest: false
      });

      const halo = new THREE.Mesh(haloGeom, haloMat);
      halo.position.copy(position);
      halo.renderOrder = 999;
      state.pathGroup.add(halo);

      const coreGeom = new THREE.SphereGeometry(0.11, 18, 18);
      const coreMat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 1.0,
        depthWrite: false,
        depthTest: false
      });

      const core = new THREE.Mesh(coreGeom, coreMat);
      core.position.copy(position);
      core.renderOrder = 1000;
      state.pathGroup.add(core);

      let frames = 0;
      let opacity = 1.0;

      function fade() {
        frames += 1;

        // longer hold + slower fade
        if (frames > 22) {
          opacity *= 0.94;
        }

        halo.material.opacity = 0.9 * opacity;
        core.material.opacity = opacity;

        if (opacity > 0.05) {
          requestAnimationFrame(fade);
        } else {
          state.pathGroup.remove(halo);
          state.pathGroup.remove(core);
          halo.geometry.dispose();
          halo.material.dispose();
          core.geometry.dispose();
          core.material.dispose();
        }
      }

      requestAnimationFrame(fade);
    },

    // --- Instanced endpoint markers ---
    // Endpoint spheres were previously individual Mesh objects (one geometry,
    // material, and GPU draw call each); at the default 6000-marker cap they
    // dominated both run time and render time. They are now plain records in
    // state.endpointData, rendered by a single InstancedMesh (one draw call).
    // Age fading is expressed as per-instance scale and color dimming.
    _endpointCapacity: 0,

    _ensureEndpointMesh: function(capacity) {
      if (state.endpointInstanced && Photons._endpointCapacity >= capacity) {
        return state.endpointInstanced;
      }
      if (state.endpointInstanced) {
        state.endpointGroup.remove(state.endpointInstanced);
        state.endpointInstanced.geometry.dispose();
        state.endpointInstanced.material.dispose();
      }
      const geom = new THREE.SphereGeometry(1, 10, 10);
      const mat = new THREE.MeshBasicMaterial({transparent: true, opacity: 0.95});
      const mesh = new THREE.InstancedMesh(geom, mat, capacity);
      mesh.count = 0;
      state.endpointInstanced = mesh;
      Photons._endpointCapacity = capacity;
      state.endpointGroup.add(mesh);
      return mesh;
    },

    // Reset endpoint records and instanced-mesh bookkeeping (the mesh itself
    // is disposed by Scene.clearGroup on the endpoint group).
    clearEndpoints: function() {
      state.endpointData.length = 0;
      state.endpointInstanced = null;
      Photons._endpointCapacity = 0;
    },

    trimEndpointMarkers: function() {
      const cap = UI.getEndpointCap();
      const excess = state.endpointData.length - cap;
      if (excess > 0) state.endpointData.splice(0, excess);
    },

    // Batched endpoint maintenance: trim to the cap and rewrite the instanced
    // mesh ONCE per display update (per chunk / per animated photon), instead
    // of once per added endpoint, which was O(n^2) over a run.
    finalizeEndpoints: function() {
      Photons.trimEndpointMarkers();
      Photons.syncEndpointMesh();
    },

    // Kept as an alias: callers that re-apply fading after UI changes.
    applyEndpointFade: function() {
      Photons.syncEndpointMesh();
    },

    syncEndpointMesh: function() {
      const data = state.endpointData;
      const cap = Math.max(UI.getEndpointCap(), 1);
      const mesh = Photons._ensureEndpointMesh(Math.max(cap, data.length));
      const fade = UI.getFadeEndpoints();
      const n = data.length;
      const m4 = new THREE.Matrix4();
      const col = new THREE.Color();

      for (let i = 0; i < n; i++) {
        const d = data[i];
        // Oldest markers are at low index; newest are brightest/largest.
        const ageFrac = (!fade || n <= 1) ? 1 : i / (n - 1);
        const s = d.radius * (0.65 + 0.35 * ageFrac);
        m4.makeScale(s, s, s).setPosition(d.x, d.y, d.z);
        mesh.setMatrixAt(i, m4);
        col.setHex(d.color).multiplyScalar(0.35 + 0.65 * ageFrac);
        mesh.setColorAt(i, col);
      }

      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    },

    // Adds a marker only; cap-trimming and fading are deferred to
    // finalizeEndpoints() so per-photon cost stays O(1).
    addEndpoint: function(result) {
      const cap = UI.getEndpointCap();
      if (cap <= 0) {
        return;
      }

      let color, radius;

      if (result.status === "reflected") {
        color = 0xfacc15;
        radius = 0.16;
      } else if (result.status === "transmitted") {
        color = 0x22c55e;
        radius = 0.16;
      } else if (result.status === "side_escape") {
        color = 0xf97316;
        radius = 0.14;
      } else if (result.status === "surface_absorbed") {
        color = 0x7c2d12;
        radius = 0.18;
      } else {
        color = 0x111827;
        radius = 0.20;
      }

      const p = Coords.simToWorldPoint({x: result.xExit, y: result.yExit, tau: result.tauExit});
      state.endpointData.push({x: p.x, y: p.y, z: p.z, color, radius});
    },

    addAnimatedPath: function(result) {
      return new Promise(resolve => {
        if (!result.path || result.path.length < 2) {
          Photons.addEndpoint(result);
          resolve();
          return;
        }

        const worldPts = result.path.map(Coords.simToWorldPoint);
        const activeColor = 0xfff700; // bright yellow active photon tracer

        state.activePhotonID = result.photonId ?? null;
        state.activePhotonStep = 0;
        state.activePhotonTotalSteps = worldPts.length - 1;
        state.activePhotonStatus = result.status;
        SimStats.updateDisplay();

        let activeTube = null;
        let photonHead = Photons.makePhotonHead(activeColor);
        state.pathGroup.add(photonHead);

        let finalThinLineAdded = false;
        let i = 1;

        function disposeActiveTube() {
          if (activeTube) {
            state.pathGroup.remove(activeTube);
            if (activeTube.geometry) activeTube.geometry.dispose();
            if (activeTube.material) activeTube.material.dispose();
            activeTube = null;
          }
        }

        function replaceActiveTail(points) {
          disposeActiveTube();

          // Fading-tail approximation: only show the most recent segment of the path.
          const tailLength = UI.getTailLength();
          const start = Math.max(0, points.length - tailLength);
          const tailPts = points.slice(start);

          activeTube = Photons.makeTubeFromPoints(tailPts, activeColor, 0.12, 1.0);
          if (activeTube) state.pathGroup.add(activeTube);
        }

        function finish() {
          disposeActiveTube();
          Photons.clearLastScatterMarker();

          if (photonHead) {
            state.pathGroup.remove(photonHead);
            if (photonHead.geometry) photonHead.geometry.dispose();
            if (photonHead.material) photonHead.material.dispose();
            photonHead = null;
          }

          if (!finalThinLineAdded) {
            Photons.addStaticPath(result);
            finalThinLineAdded = true;
          }

          Photons.addEndpoint(result);
          state.activePhotonStep = state.activePhotonTotalSteps;
          SimStats.updateDisplay();
          resolve();
        }

        function scheduleNext() {
          // If paused, wait until Resume or one Step request.
          if (state.isPaused && !state.stepRequested) {
            setTimeout(step, 50);
          } else {
            setTimeout(step, UI.getAnimDelay());
          }
        }

        function step() {
          if (state.isPaused && !state.stepRequested) {
            setTimeout(step, 50);
            return;
          }

          // Consume one requested single-step advance.
          const steppingOnce = state.stepRequested;
          state.stepRequested = false;

          if (i < worldPts.length) {
            const currentPts = worldPts.slice(0, i + 1);
            const currentPos = worldPts[i];

            if (photonHead) {
              photonHead.position.copy(currentPos);
            }

            replaceActiveTail(currentPts);

            state.activePhotonStep = i;
            SimStats.updateDisplay();

            // Each stored path vertex after the first corresponds to a boundary point
            // or a scattering/absorption site. Flash interior interaction points.
            const simPt = result.path[i];
            const isInterior = simPt.tau > 0 && simPt.tau < world.tauCloud;
            if (isInterior) {
              if (UI.getScatterFlashes()) {
                Photons.makeScatterFlash(currentPos);
              }

              // Persistent marker is especially useful when paused for discussion.
              if (state.isPaused) {
                Photons.setLastScatterMarker(currentPos);
              }
            }

            i++;

            // Stay paused after a single-step advance.
            if (steppingOnce) {
              setTimeout(step, 50);
            } else {
              scheduleNext();
            }
          } else {
            finish();
          }
        }

        step();
      });
    }
  };
