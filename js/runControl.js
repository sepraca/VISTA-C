// runControl.js — Simulation loop, init, run/ensemble/batch, scene reset.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { state, world } from './state.js';
import { RNG } from './rng.js';
import { Coords } from './coords.js';
import { Physics } from './physics.js';
import { SimStats } from './simstats.js';
import { UI, showLimitWarning } from './ui.js';
import { Scene } from './scene.js';
import { Photons } from './photons.js';
import { BottomPanel } from './bottomPanel.js';
import { Export } from './exportUtils.js';

export const RunControl = {
    init: function() {
      state.scene = new THREE.Scene();
      state.scene.background = new THREE.Color(0x0f172a);

      state.camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 2000);
      state.camera.position.set(-10, -72, 24);

      state.renderer = new THREE.WebGLRenderer({antialias: true, preserveDrawingBuffer: true});
      state.renderer.setSize(window.innerWidth, window.innerHeight);
      state.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      document.body.appendChild(state.renderer.domElement);

      state.controls = new OrbitControls(state.camera, state.renderer.domElement);
      state.controls.enableDamping = true;
      state.camera.up.set(0, 0, 1);
      state.controls.target.set(-10, 0, -4);

      const hemi = new THREE.HemisphereLight(0xffffff, 0x334155, 1.8);
      state.scene.add(hemi);

      const dirLight = new THREE.DirectionalLight(0xffffff, 1.6);
      dirLight.position.set(20, 30, 15);
      state.scene.add(dirLight);

      state.cloudGroup = new THREE.Group();
      state.pathGroup = new THREE.Group();
      state.endpointGroup = new THREE.Group();
      state.histogramGroup = new THREE.Group();

      state.scene.add(state.cloudGroup);
      state.scene.add(state.pathGroup);
      state.scene.add(state.endpointGroup);
      state.scene.add(state.histogramGroup);

      Scene.buildCloudBox();
      RunControl.refreshEndpointDisplay();
      SimStats.updateDisplay();

      window.addEventListener("resize", RunControl.onWindowResize);
    },

    onWindowResize: function() {
      state.camera.aspect = window.innerWidth / window.innerHeight;
      state.camera.updateProjectionMatrix();
      state.renderer.setSize(window.innerWidth, window.innerHeight);
    },


    refreshEndpointDisplay: function() {
      const valueEl = document.getElementById("endpointCapValue");
      if (valueEl) valueEl.textContent = String(UI.getEndpointCap());

      Photons.trimEndpointMarkers();
      Photons.applyEndpointFade();
      SimStats.updateDisplay();
    },

    togglePause: function() {
      state.isPaused = !state.isPaused;
      const btn = document.getElementById("pauseBtn");
      if (btn) btn.textContent = state.isPaused ? "Resume" : "Pause";
      SimStats.updateDisplay();
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
        surfaceDistanceKm: UI.getSurfaceDistanceKm()
      };
    },

    runOne: async function() {
      // Reproducible single-photon mode:
      // each Launch One starts from the same seed and a clean state.
      RunControl.resetScene();
      RNG.reset();

      Scene.updateWorld();
      Scene.buildCloudBox();

      const result = Physics.simulatePhoton(RunControl.getSimParams(), true);
      result.photonId = state.nextPhotonId++;
      SimStats.record(result);
      for (const t of result.cloudBaseTransmissions) SimStats.registerCloudBaseTransmission(t);
      for (const e of result.surfaceEvents)          SimStats.surfaceInteractionEvents.push(e);
      for (const d of result.surfaceReflectionDirs)  SimStats.netTransmittedDirs.push(d);

      if (UI.getAnimatePaths()) {
        state.isAnimating = true;
        await Photons.addAnimatedPath(result);
        state.isAnimating = false;
      } else {
        Photons.addPhotonToScene(result, true);
      }

      Scene.rebuildHistograms();
      SimStats.updateDisplay();
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

        // Animate a manageable number of visible paths sequentially.
        // Additional photons, if requested, are simulated statistically after the visible sequence.
        const nAnimated = Math.min(n, maxPaths, 80);

        for (let i = 0; i < nAnimated; i++) {
          const result = Physics.simulatePhoton(RunControl.getSimParams(), true);
          result.photonId = state.nextPhotonId++;
          SimStats.record(result);
          for (const t of result.cloudBaseTransmissions) SimStats.registerCloudBaseTransmission(t);
          for (const e of result.surfaceEvents)          SimStats.surfaceInteractionEvents.push(e);
          for (const d of result.surfaceReflectionDirs)  SimStats.netTransmittedDirs.push(d);
          await Photons.addAnimatedPath(result);
          Scene.rebuildHistograms();
          SimStats.updateDisplay();
        }

        const remaining = n - nAnimated;
        if (remaining > 0) {
          RunControl.runInstantBatch(remaining, false);
        }

        state.isAnimating = false;
        Scene.rebuildHistograms();
        SimStats.updateDisplay();
        return;
      }

      RunControl.runInstantBatch(n, true);
    },

    runInstantBatch: function(n, allowPaths) {
      let remaining = n;
      const chunkSize = 1000;

      function chunk() {
        const m = Math.min(chunkSize, remaining);

        for (let i = 0; i < m; i++) {
          const drawPath = allowPaths && state.pathGroup.children.length < UI.getMaxPaths();
          const result = Physics.simulatePhoton(RunControl.getSimParams(), drawPath);
          result.photonId = state.nextPhotonId++;
          SimStats.record(result);
          for (const t of result.cloudBaseTransmissions) SimStats.registerCloudBaseTransmission(t);
          for (const e of result.surfaceEvents)          SimStats.surfaceInteractionEvents.push(e);
          for (const d of result.surfaceReflectionDirs)  SimStats.netTransmittedDirs.push(d);
          Photons.addPhotonToScene(result, drawPath);
        }

        remaining -= m;
        Scene.rebuildHistograms();
        SimStats.updateDisplay();

        if (remaining > 0) {
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
      state.activePhotonStatus = "none";
      state.isPaused = false;
      state.stepRequested = false;
      const pauseBtn = document.getElementById("pauseBtn");
      if (pauseBtn) pauseBtn.textContent = "Pause";
      Photons.clearLastScatterMarker();

      Scene.clearGroup(state.pathGroup);
      Scene.clearGroup(state.endpointGroup);
      Scene.clearGroup(state.histogramGroup);
      BottomPanel.drawBottomPanel();
      Scene.buildCloudBox();
      RunControl.refreshEndpointDisplay();
      SimStats.updateDisplay();
    },

    animate: function() {
      requestAnimationFrame(RunControl.animate);
      state.controls.update();
      state.renderer.render(state.scene, state.camera);
    }
  };
