// photons.js — Per-photon 3D rendering: paths, endpoints, animation.

import * as THREE from 'three';
import { state, world } from './state.js';
import { UI } from './ui.js';
import { Coords } from './coords.js';
import { SimStats } from './simstats.js';
import { Status } from './constants.js';

// Stored-endpoint buffer cap = the "Endpoint caps shown" slider maximum. Storage
// is bounded by THIS (not the live display cap), so dragging the slider down and
// back up is a non-destructive show/hide: markers are retained and re-rendered.
const ENDPOINT_BUFFER_MAX = 20000;

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

    // CODE-REVIEW P4: split a photon's recorded path into contiguous visual
    // segments, breaking immediately BEFORE any vertex flagged `wrapBreak`
    // (physics.js sets this on every vertex that lands after a periodic-
    // boundary teleport -- see the wrap sites in simulatePhoton). Without
    // this, a wrapped leg draws as one straight line/curve connecting a point
    // in the original tile to a point in a neighboring cloud image, which
    // reads as the photon crossing the whole rendered domain in one jump --
    // physically wrong (only its horizontal position wrapped; nothing
    // actually traveled that distance). Segments of length 1 (two wraps back
    // to back with no point between them) are dropped -- nothing to draw.
    splitPathSegments: function(path) {
      const segments = [];
      let current = [path[0]];
      for (let i = 1; i < path.length; i++) {
        if (path[i].wrapBreak) {
          if (current.length > 1) segments.push(current);
          current = [path[i]];
        } else {
          current.push(path[i]);
        }
      }
      if (current.length > 1) segments.push(current);
      return segments;
    },

    // One LineBasicMaterial per outcome color (not per path/segment), reused
    // across the whole session. Previously addStaticPath allocated a fresh
    // material for every segment of every path -- up to ~maxPaths (1000)
    // distinct materials per run, all identical apart from `color`, none of
    // them ever needing per-path variation. R8, CODE-REVIEW. Marked
    // userData.shared so Scene.clearGroup (called on every Reset) skips
    // disposing them, matching the existing pattern used for the shared
    // heatmap material in scene.js.
    _pathMatCache: {},
    _pathMaterial: function(color) {
      let mat = Photons._pathMatCache[color];
      if (!mat) {
        mat = new THREE.LineBasicMaterial({color, transparent: true, opacity: 0.48});
        mat.userData.shared = true;
        Photons._pathMatCache[color] = mat;
      }
      return mat;
    },

    addStaticPath: function(result) {
      const color = UI.getOutcomeColor(result.status);
      const mat = Photons._pathMaterial(color);
      for (const seg of Photons.splitPathSegments(result.path)) {
        const pts = seg.map(Coords.simToWorldPoint);
        const geom = new THREE.BufferGeometry().setFromPoints(pts);
        state.pathGroup.add(new THREE.Line(geom, mat));
      }
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

    _ensureEndpointMesh: function() {
      // Allocate once, at the full fixed buffer capacity (ENDPOINT_BUFFER_
      // MAX), and reuse that SAME mesh object for the entire run -- never
      // dispose/recreate it just because the display-cap slider changes.
      // Only mesh.count (and the per-instance data for indices 0..count-1)
      // changes per sync; the mesh's identity, position, and geometry never
      // do.
      //
      // This replaces two earlier designs, both dead ends, kept here as the
      // record of what was tried (2026-07, user report):
      //
      // 1. Reallocate only when the requested capacity grew (original code),
      //    later also on a large shrink (a same-day follow-up). Reallocating
      //    on every change turned out to BE the bug: recreating the mesh
      //    gives it a fresh, ever-increasing THREE.Object3D id each time.
      //    Three.js sorts transparent objects at the same renderOrder (the
      //    default, unset, used scene-wide) by distance from camera to each
      //    object's own matrixWorld origin -- NOT by instance positions or
      //    bounding volume -- so for a mesh like this one, whose own local
      //    origin never moves, that distance is tied with other scene
      //    geometry (cloud box, surface plane, etc.), and ties are broken by
      //    object id. A constantly-changing id flips that tie-break
      //    unpredictably relative to the cloud/surface geometry -- exactly a
      //    toggle, uncorrelated with the cap's magnitude, confirmed with
      //    four side-by-side exports of the identical completed run at
      //    cap=5000/6000/7500/16000 that came out non-monotonically dense/
      //    sparse/dense/sparse.
      // 2. Pin renderOrder explicitly (=1, then =-1) to force a deterministic
      //    paint order regardless of that tie. This did remove the toggle,
      //    but uniformly forced markers before or after EVERY other
      //    transparent layer in the scene (cloud box, top/bottom faces,
      //    surface plane, footprint heatmap cells) -- blunter than the
      //    original behavior. Markers under multiple stacked translucent
      //    layers (e.g. green cloud-base-crossing markers sitting inside the
      //    cloud box's full 3D volume) got compounded/over-attenuated to
      //    near invisibility, and surface markers picked up a visible color
      //    shift from the footprint-heatmap layer now reliably painting over
      //    them ("remaining visible endpoints looked more like orange...
      //    than red surface absorption").
      //
      // Keeping the mesh's identity permanently stable removes the actual
      // instability (the id-based tie-break) without overriding the natural
      // per-object distance sort at all, so markers interact with every
      // other layer of scene geometry exactly as they did before any of
      // today's fixes -- restoring the original soft/translucent look while
      // still being deterministic, since nothing about the mesh's identity
      // changes between syncs anymore.
      if (state.endpointInstanced) return state.endpointInstanced;

      const geom = new THREE.SphereGeometry(1, 10, 10);
      // depthWrite:false -- standard practice for semi-transparent instanced
      // markers: with the default depthWrite:true, overlapping instances
      // depth-test against each other in draw-index order instead of
      // blending, producing order-dependent occlusion/contrast among the
      // markers rather than consistent alpha compositing (contributed to
      // the same 2026-07 user report above).
      const mat = new THREE.MeshBasicMaterial({transparent: true, opacity: 0.95, depthWrite: false});
      const mesh = new THREE.InstancedMesh(geom, mat, ENDPOINT_BUFFER_MAX);
      mesh.count = 0;
      // Markers can appear anywhere across the (possibly M-scaled) domain, so
      // disable frustum culling rather than rely on InstancedMesh's bounding
      // sphere -- same reasoning, and same pattern, as the footprint-heatmap
      // meshes in scene.js ("cells span the whole domain"). This replaces an
      // explicit mesh.computeBoundingSphere() call made on every sync, which
      // turned out to be the actual remaining cause of the flashing/toggling
      // reported after the mesh-identity fixes below: recomputing the
      // bounding sphere on every sync (every chunk during a live run, every
      // slider tick on a completed one) changes ITS centroid each time even
      // though the mesh's identity no longer does, and that recomputed value
      // is what was flipping the transparent-object paint-order tie-break
      // against other scene geometry -- not the identity churn originally
      // suspected (2026-07 user report: fixing both the endpoint- and
      // heatmap-mesh identity churn did not stop the flashing/toggling,
      // which persisted identically in open AND periodic domains and
      // independent of whether Scene.rebuildHistograms() was even invoked,
      // ruling the identity theory out and pointing at the one thing left
      // that both meshes' sync paths still recomputed on every call).
      mesh.frustumCulled = false;
      // Explicit renderOrder=1 (paired with cloudGroup's box/top/bottom
      // faces at renderOrder=2 in scene.js's buildCloudBox, and the
      // ground/heatmap layers left at the default 0): with the flashing/
      // toggling itself fixed above, the remaining symptom (2026-07 user
      // report) was that the *stable* natural sort still landed on
      // different, domain-dependent outcomes for open vs. periodic boundary
      // -- periodic consistently rendered the "dense" (unsoftened) look,
      // open the "sparse" one. Both are plausible under an unpinned sort:
      // every relevant object here (this mesh, the cloud faces, the ground
      // plane, the heatmap meshes) sits at an identical, un-translated
      // matrixWorld origin, since none of them call .position.set() on
      // themselves -- their real spatial extent lives entirely in instance/
      // vertex data. That's an exact tie, broken only by object id (creation
      // order), and open vs. periodic domains construct their scenes via
      // slightly different call sequences, so they land on opposite,
      // internally-consistent sides of that tie. A 3-tier explicit
      // renderOrder removes the ambiguity outright rather than relying on
      // creation order: ground/heatmap (0) paint first, so markers are
      // always clearly visible and untinted on top of them (matches every
      // screenshot where that already looked right); markers (1) paint
      // next; the cloud volume (2) paints last, so it always -- and only --
      // softens whatever marker or heatmap cell happens to sit under its
      // on-screen footprint, restoring the translucent look without the
      // earlier renderOrder attempts' failure modes (uniformly-before caused
      // heatmap tinting of markers; uniformly-after removed the softening
      // entirely).
      mesh.renderOrder = 1;
      state.endpointInstanced = mesh;
      Photons._endpointCapacity = ENDPOINT_BUFFER_MAX;
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
      // Bound storage by the fixed buffer max, NOT the live display cap, so the
      // slider only changes how many are drawn (see syncEndpointMesh), never how
      // many are kept. This makes lowering then raising the slider reversible.
      const excess = state.endpointData.length - ENDPOINT_BUFFER_MAX;
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
      // Display the most recent `cap` markers from the (larger) stored buffer;
      // the rest are retained, just not drawn. cap=0 draws nothing but keeps all.
      const cap = Math.max(UI.getEndpointCap(), 0);
      const shown = Math.min(cap, data.length);
      const start = data.length - shown;
      const mesh = Photons._ensureEndpointMesh();
      const fade = UI.getFadeEndpoints();
      const m4 = new THREE.Matrix4();
      const col = new THREE.Color();

      for (let i = 0; i < shown; i++) {
        const d = data[start + i];
        // Oldest drawn markers are at low index; newest are brightest/largest.
        const ageFrac = (!fade || shown <= 1) ? 1 : i / (shown - 1);
        const s = d.radius * (0.65 + 0.35 * ageFrac);
        m4.makeScale(s, s, s).setPosition(d.x, d.y, d.z);
        mesh.setMatrixAt(i, m4);
        col.setHex(d.color).multiplyScalar(0.35 + 0.65 * ageFrac);
        mesh.setColorAt(i, col);
      }

      mesh.count = shown;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      // No computeBoundingSphere() call here -- see the frustumCulled=false
      // comment in _ensureEndpointMesh for why, and why an earlier version
      // of this fix that DID call it on every sync was itself the remaining
      // cause of a flashing/toggling symptom.
    },

    // Adds a marker only; cap-trimming and fading are deferred to
    // finalizeEndpoints() so per-photon cost stays O(1).
    addEndpoint: function(result) {
      // Markers are always stored (bounded by ENDPOINT_BUFFER_MAX in
      // trimEndpointMarkers); the display cap only decides how many are drawn
      // (syncEndpointMesh). So even at cap=0 they accumulate and can be revealed.

      // Green markers at every DOWNWARD cloud-base crossing (viaSide:false), so
      // green is defined consistently as a base-crossing event — 1:1 with the
      // transmitted footprint. At A_s=0 a transmitted photon crosses the base
      // exactly once, reproducing the previous single green endpoint; at A_s>0 a
      // photon may cross several times (bouncing off a reflective surface) and
      // each crossing is marked. viaSide:true entries are surface arrivals off a
      // side-wall exit — they never touch the base plane, so they are skipped.
      if (result.cloudBaseTransmissions) {
        for (const t of result.cloudBaseTransmissions) {
          if (t.viaSide) continue;
          const b = Coords.simToWorldPoint({x: t.xExit, y: t.yExit, tau: t.tauExit});
          state.endpointData.push({x: b.x, y: b.y, z: b.z, color: 0x22c55e, radius: 0.16});
        }
      }

      let color, radius;

      if (result.status === Status.REFLECTED) {
        color = 0x60a5fa;
        radius = 0.16;
      } else if (result.status === Status.TRANSMITTED) {
        // A_s=0 fast path: the photon crosses the cloud base (already marked
        // green above) and is then deterministically absorbed at the surface
        // (no reflection possible when A_s=0). physics.js now computes the
        // real surface-plane (x,y) for this branch (previously it stayed at
        // the cloud-base point, so no surface endpoint was ever drawn here --
        // user report, 2026-07, matching the surface-heatmap fix above this
        // marker is the same color/radius as SURFACE_ABSORBED since it's the
        // same physical event, just reached via this A_s=0 shortcut instead
        // of surfaceInteraction()). Distinct point from the green base-
        // crossing marker, not a duplicate of it.
        color = 0x7c2d12;
        radius = 0.18;
      } else if (result.status === Status.SIDE_ESCAPE) {
        color = 0xf97316;
        radius = 0.14;
      } else if (result.status === Status.SURFACE_ABSORBED) {
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

        // CODE-REVIEW P4: indices in result.path where a periodic-boundary
        // wrap landed (see splitPathSegments above for the static-path
        // counterpart). The animated tail is a single smooth CatmullRom
        // curve, so it can't "break" mid-tube the way separate Line segments
        // can -- instead, clamp the tail window so it never starts before
        // the most recent wrap, i.e. the curve only ever spans one tile.
        const wrapBreakIndices = [];
        for (let k = 0; k < result.path.length; k++) {
          if (result.path[k].wrapBreak) wrapBreakIndices.push(k);
        }

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
          let start = Math.max(0, points.length - tailLength);
          // CODE-REVIEW P4: never let the tube curve span a periodic-boundary
          // wrap -- clamp the window to start at the most recent wrap vertex
          // at or before the current position, if that's more restrictive
          // than the plain tail length. wrapBreakIndices is ascending, so the
          // first hit scanning from the end is the closest one.
          for (let k = wrapBreakIndices.length - 1; k >= 0; k--) {
            const b = wrapBreakIndices[k];
            if (b > points.length - 1) continue; // wrap hasn't happened yet at this step
            if (b > start) start = b;
            break; // closest wrap at or before the current position found
          }
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
