// runControl.js — Simulation loop, init, run/ensemble/batch, scene reset.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { state, world, UI_PANEL_WIDTH, setUiPanelWidth } from './state.js';
import { RNG } from './rng.js';
import { Coords } from './coords.js';
import { Physics } from './physics.js';
import { SimStats } from './simstats.js';
import { StatsPanel } from './statsPanel.js';
import { UI, showLimitWarning } from './ui.js';
import { Scene } from './scene.js';
import { Photons } from './photons.js';
import { BottomPanel } from './bottomPanel.js';
import { Export } from './exportUtils.js';
import { Status } from './constants.js';

// Instant-mode batching: photons simulated per setTimeout slice, and how many
// chunks pass between heavy display rebuilds (3D histograms, bottom panel).
const CHUNK_SIZE = 1000;
const DISPLAY_EVERY_CHUNKS = 10;

export const RunControl = {
    // Proportionally shrink the overlay chrome (controls, header, legend, bottom
    // plots) so the interface fits smaller laptop/desktop screens. The 3-D canvas
    // stays at native resolution; only the CSS overlays scale via --ui-scale, and
    // the 3-D viewport offset (UI_PANEL_WIDTH) shrinks with the panel.
    applyUiScale: function() {
      const BASE_W = 1550, BASE_H = 900, MIN_SCALE = 0.6;
      const scale = Math.max(MIN_SCALE,
        Math.min(1, window.innerWidth / BASE_W, window.innerHeight / BASE_H));
      const panelW = Math.round(440 * scale);   // scaled control-panel footprint
      const root = document.documentElement.style;
      root.setProperty("--ui-scale", scale.toFixed(3));
      root.setProperty("--ui-panel-w", panelW + "px");
      setUiPanelWidth(panelW);
    },

    init: function() {
      RunControl.applyUiScale();
      UI.onIlluminationChange(); // sync domain-factor row visibility + warning to the loaded illumination selection
      state.scene = new THREE.Scene();
      state.scene.background = new THREE.Color(0x0f172a);

      const view3dWidth = window.innerWidth - UI_PANEL_WIDTH;

      state.camera = new THREE.PerspectiveCamera(50, view3dWidth / window.innerHeight, 0.1, 2000);

      state.camera.position.set(0, -90, 21);   // +15 vs target keeps the angle; pans the cloud down, clear of the legend

      state.renderer = new THREE.WebGLRenderer({antialias: true, preserveDrawingBuffer: true});
      state.renderer.setSize(window.innerWidth, window.innerHeight);
      state.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      state.renderer.setViewport(UI_PANEL_WIDTH, 0, view3dWidth, window.innerHeight);
      document.body.appendChild(state.renderer.domElement);

      state.controls = new OrbitControls(state.camera, state.renderer.domElement);
      state.controls.enableDamping = true;
      state.camera.up.set(0, 0, 1);
      state.controls.target.set(0, 0, -12);

      const hemi = new THREE.HemisphereLight(0xffffff, 0x334155, 1.8);
      state.scene.add(hemi);

      const dirLight = new THREE.DirectionalLight(0xffffff, 1.6);
      dirLight.position.set(20, 30, 15);
      state.scene.add(dirLight);

      state.cloudGroup = new THREE.Group();
      state.pathGroup = new THREE.Group();
      state.endpointGroup = new THREE.Group();
      state.histogramGroup = new THREE.Group();
      // Sibling of histogramGroup, not a child of it -- Scene.clearGroup()
      // clears histogramGroup wholesale every rebuild, and the heatmap
      // meshes living here need to survive that (see state.js for why).
      state.heatmapMeshGroup = new THREE.Group();

      state.scene.add(state.cloudGroup);
      state.scene.add(state.pathGroup);
      state.scene.add(state.endpointGroup);
      state.scene.add(state.histogramGroup);
      state.scene.add(state.heatmapMeshGroup);

      Scene.buildCloudBox();
      RunControl.refreshEndpointDisplay();
      StatsPanel.updateDisplay();

      window.addEventListener("resize", RunControl.onWindowResize);
    },

    onWindowResize: function() {
      RunControl.applyUiScale();
      const view3dWidth = window.innerWidth - UI_PANEL_WIDTH;
      state.camera.aspect = view3dWidth / window.innerHeight;
      state.camera.updateProjectionMatrix();
      state.renderer.setSize(window.innerWidth, window.innerHeight);
      state.renderer.setViewport(UI_PANEL_WIDTH, 0, view3dWidth, window.innerHeight);
    },


    refreshEndpointDisplay: function() {
      const valueEl = document.getElementById("endpointCapValue");
      if (valueEl) valueEl.textContent = String(UI.getEndpointCap());

      Photons.trimEndpointMarkers();
      Photons.applyEndpointFade();
      StatsPanel.updateDisplay();
    },

    togglePause: function() {
      state.isPaused = !state.isPaused;
      const btn = document.getElementById("pauseBtn");
      if (btn) btn.textContent = state.isPaused ? "Resume" : "Pause";
      StatsPanel.updateDisplay();
    },

    // Stop: hard-terminates the in-flight run (instant-batch chunk loop or
    // animated-sequence loop). Unlike Pause, there is no Resume from here --
    // the run stays halted at its current photon count until Reset is
    // clicked, which clears isStopped and starts a clean run (picking up any
    // input changes made in the meantime, same as any other Reset).
    stopRun: function() {
      state.isStopped = true;
      state.isPaused = false;
      state.stepRequested = false;
      const pauseBtn = document.getElementById("pauseBtn");
      if (pauseBtn) pauseBtn.textContent = "Pause";
      StatsPanel.updateDisplay();
    },

    stepPhoton: function() {
      // Step mode is most useful while paused. If not paused, pause first.
      if (!state.isPaused) {
        state.isPaused = true;
        const btn = document.getElementById("pauseBtn");
        if (btn) btn.textContent = "Resume";
      }
      state.stepRequested = true;
    },

    getSimParams: function() {
      return {
        tauCloud:          world.tauCloud,
        slabW:             world.slabW,
        slabD:             world.slabD,
        theta0:            UI.getTheta0Rad(),
        g:                 UI.getG(),
        omega0:            UI.getOmega0(),
        surfaceAlbedo:     UI.getSurfaceAlbedo(),
        betaExt:           UI.getCloudBetaExt(),
        surfaceDistanceKm: UI.getSurfaceDistanceKm(),
        entryMode:         UI.getPhotonEntryMode(),
        // getEffectiveDomainFactor() (not getDomainFactor()) auto-clamps M up
        // to the sunward-illumination minimum for uniform_domain + open
        // boundary, 2026-07 fix -- see UI.getEffectiveDomainFactor doc comment.
        domainFactor:      UI.getEffectiveDomainFactor(),
        domainBoundary:    UI.getDomainBoundary()
      };
    },

    runOne: async function() {
      if (state.isAnimating) return;

      // Successive Launch One clicks draw new, distinct photons from the
      // advancing RNG stream and accumulate into the statistics.
      // Use the Reset button to start over from the base seed.
      Scene.updateWorld();
      Scene.buildCloudBox();

      const result = Physics.simulatePhoton(RunControl.getSimParams(), true);
      result.photonId = state.nextPhotonId++;
      SimStats.record(result);
      for (const t of result.cloudBaseTransmissions) SimStats.registerCloudBaseTransmission(t);
      for (const e of result.surfaceEvents)          SimStats.registerSurfaceEvent(e);
      for (const d of result.surfaceReflectionDirs)  SimStats.registerSurfaceReflection(d);

      if (UI.getAnimatePaths()) {
        state.isAnimating = true;
        await Photons.addAnimatedPath(result);
        state.isAnimating = false;
      } else {
        Photons.addPhotonToScene(result, true);
      }

      Photons.finalizeEndpoints();
      Scene.rebuildHistograms();
      StatsPanel.updateDisplay();
    },

    runEnsemble: async function() {
      if (state.isAnimating) return;

      // Reproducible ensemble mode:
      // each Launch Ensemble starts from the same seed and a clean state.
      RunControl.resetScene();
      RNG.reset();

      Scene.updateWorld();
      Scene.buildCloudBox();

      const n = UI.getPhotonCount();
      const maxPaths = UI.getMaxPaths();

      if (UI.getAnimatePaths()) {
        state.isAnimating = true;

        // Animate up to "Max paths drawn" visible paths sequentially.
        // Additional photons, if requested, are simulated statistically after the visible sequence.
        const nAnimated = Math.min(n, maxPaths);
        // Parameter snapshot for the whole animated sequence (review R4) --
        // same reproducibility contract as runInstantBatch below.
        const simParams = RunControl.getSimParams();

        for (let i = 0; i < nAnimated; i++) {
          if (state.isStopped) break;
          const result = Physics.simulatePhoton(simParams, true);
          result.photonId = state.nextPhotonId++;
          SimStats.record(result);
          for (const t of result.cloudBaseTransmissions) SimStats.registerCloudBaseTransmission(t);
          for (const e of result.surfaceEvents)          SimStats.registerSurfaceEvent(e);
          for (const d of result.surfaceReflectionDirs)  SimStats.registerSurfaceReflection(d);
          await Photons.addAnimatedPath(result);
          Photons.finalizeEndpoints();
          Scene.rebuildHistograms();
          StatsPanel.updateDisplay();
        }

        const remaining = n - nAnimated;
        if (remaining > 0 && !state.isStopped) {
          RunControl.runInstantBatch(remaining, false);
        }

        state.isAnimating = false;
        Scene.rebuildHistograms();
        StatsPanel.updateDisplay();
        return;
      }

      RunControl.runInstantBatch(n, true);
    },

    runInstantBatch: function(n, allowPaths) {
      let remaining = n;
      // Heavy display work (3D histogram rebuild, bottom-panel redraw, stats
      // text) runs every DISPLAY_EVERY_CHUNKS chunks and at completion, not
      // per chunk: those rebuilds re-bin the full accumulated history and were
      // the dominant cost of large runs. Endpoint trim/fade is cheap and runs
      // per chunk so the marker pool never grows far past the cap.
      let chunksDone = 0;

      // Snapshot the simulation parameters and path cap ONCE per batch
      // (review R4): getSimParams()/getMaxPaths() cascade through ~12 DOM
      // reads + clamp logic each, which used to run once PER PHOTON (10^6-10^7
      // times for large runs). Beyond the cost, per-photon reads meant a user
      // edit mid-run silently changed the physics mid-ensemble, so the
      // exported "inputs" no longer described the whole run — a
      // reproducibility hazard. Edits made while a run is in flight (or
      // paused) now take effect at the NEXT launch, by design.
      const simParams = RunControl.getSimParams();
      const maxPaths = UI.getMaxPaths();

      function chunk() {
        // Honor Stop first, even over Pause: a stopped run must not resume
        // simply because Pause/Resume gets toggled again. Leaves the photon
        // count wherever it stood at the moment Stop was clicked; Reset is
        // the only way forward from here.
        if (state.isStopped) {
          Scene.rebuildHistograms();
          StatsPanel.updateDisplay();
          return;
        }
        // Honor Pause/Step in instant mode: while paused, idle until Resume
        // or a single Step request (Step advances exactly one photon).
        if (state.isPaused && !state.stepRequested) {
          setTimeout(chunk, 100);
          return;
        }
        const steppingOnce = state.stepRequested;
        state.stepRequested = false;

        const m = steppingOnce ? Math.min(1, remaining) : Math.min(CHUNK_SIZE, remaining);

        for (let i = 0; i < m; i++) {
          const drawPath = allowPaths && state.pathGroup.children.length < maxPaths;
          const result = Physics.simulatePhoton(simParams, drawPath);
          result.photonId = state.nextPhotonId++;
          SimStats.record(result);
          for (const t of result.cloudBaseTransmissions) SimStats.registerCloudBaseTransmission(t);
          for (const e of result.surfaceEvents)          SimStats.registerSurfaceEvent(e);
          for (const d of result.surfaceReflectionDirs)  SimStats.registerSurfaceReflection(d);
          Photons.addPhotonToScene(result, drawPath);
        }

        remaining -= m;
        chunksDone++;
        Photons.finalizeEndpoints();

        const finished = remaining <= 0;
        if (finished || steppingOnce || chunksDone % DISPLAY_EVERY_CHUNKS === 0) {
          Scene.rebuildHistograms();
          StatsPanel.updateDisplay();
        }

        if (!finished) {
          setTimeout(chunk, 0);
        }
      }

      chunk();
    },

    resetScene: function() {
      RNG.reset();
      Scene.updateWorld();

      SimStats.reset();
      state.nextPhotonId = 1;
      state.activePhotonID = null;
      state.activePhotonStep = 0;
      state.activePhotonTotalSteps = 0;
      state.activePhotonStatus = Status.NONE;
      state.isPaused = false;
      state.isStopped = false;
      state.stepRequested = false;
      const pauseBtn = document.getElementById("pauseBtn");
      if (pauseBtn) pauseBtn.textContent = "Pause";
      Photons.clearLastScatterMarker();

      Scene.clearGroup(state.pathGroup);
      Scene.clearGroup(state.endpointGroup);
      Photons.clearEndpoints();
      Scene.clearGroup(state.histogramGroup);
      Scene.clearHeatmapMeshes();
      BottomPanel.drawBottomPanel();
      Scene.buildCloudBox();
      RunControl.refreshEndpointDisplay();
      StatsPanel.updateDisplay();
    },

    animate: function() {
      requestAnimationFrame(RunControl.animate);
      state.controls.update();
      state.renderer.render(state.scene, state.camera);
    }
  };
