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

// Instant-mode batching (review P4, 2026-07-20 — replaces the fixed
// CHUNK_SIZE = 1000 photons / DISPLAY_EVERY_CHUNKS = 10 pair).
//
// WHY TIME-BUDGETED SLICES. The batch loop yields to the browser between
// slices via setTimeout(0), but browsers CLAMP nested zero-delay timers to
// ~4 ms. A 1000-photon slice needs only ~0.5-1.5 ms of compute, so the old
// loop spent the large majority of its wall time waiting on the scheduler,
// not simulating: a 5M-photon run paid 5,000 x ~4 ms = ~20 s of pure dead
// time against a ~8 s compute floor (measured; see the P4 notes in
// CODE-REVIEW-2026-07-19). Sizing each slice by WALL TIME instead makes the
// yield count fall by ~1-2 orders of magnitude and self-tunes across
// machines, parameter regimes (photons/s varies ~3x with illumination mode
// and Aₛ) and run sizes -- no constant to re-tune per device.
//
// Two budgets: normal mode keeps slices short so the rAF render loop still
// gets frames and orbit/camera interaction stays smooth while photons
// accumulate on screen; fast mode (see UI.getFastMode) has no live display to
// keep smooth, so it uses a longer slice and yields correspondingly less.
const SLICE_MS_NORMAL = 12;
const SLICE_MS_FAST   = 40;
// Photons simulated between wall-clock checks inside a slice. performance.now()
// per photon would itself become a hot-path cost at these rates; 256 photons is
// ~0.1-0.4 ms, far finer than either budget, so overshoot is negligible.
const SLICE_CLOCK_GRANULARITY = 256;
// Hard upper bound on one slice, independent of the clock. Privacy-hardened
// browsers deliberately coarsen performance.now() (Firefox's
// resistFingerprinting rounds it to 100 ms; some builds clamp harder), and a
// budget check against a clock that barely advances would otherwise let a
// single slice run an entire multi-million-photon batch without yielding --
// freezing the tab and the Stop button with it. 200k photons is ~0.3 s at the
// measured 0.64M photons/s worst case: still responsive, still ~2 orders of
// magnitude fewer yields than the pre-P4 fixed 1000.
const MAX_SLICE_PHOTONS = 200000;
// Normal mode uses a SPLIT display cadence (2026-07-20, user feedback: a
// single 400 ms gate made the run's progression too choppy to watch), which
// the P3 text/panel split already made possible:
//   * stats TEXT (the R/T/A/S counts and fractions the eye actually tracks)
//     refreshes every slice -- ~80 Hz, two innerHTML writes, no re-binning,
//     no canvas work, no 3D rebuild. Effectively free, and smoother than the
//     pre-P4 chunk-counted cadence ever was.
//   * HEAVY work (3D histogram rebuild + bottom-panel redraw) stays gated,
//     because each of those re-bins the FULL accumulated history: their cost
//     grows with N, which is exactly why a fixed chunk cadence degraded late
//     in long runs while a wall-clock gate holds the feel constant.
const REFRESH_HEAVY_MIN_MS = 200;
// Fast mode only: repaint the (static) 3D scene every Nth animation frame
// instead of every frame -- see RunControl.animate.
const FAST_RENDER_EVERY_N_FRAMES = 3;

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
      RunControl.updateExportButtonsLayout();
    },

    // Stacks #exportButtons vertically once its row form would actually
    // collide with #legend, measured live via getBoundingClientRect() rather
    // than a fixed viewport-width breakpoint (see index.html's #exportButtons
    // CSS comment for why: a hand-picked breakpoint goes stale the moment
    // either element's real size changes, which is exactly what happened
    // when the legend's 2026-07 relayout widened it). Removing the
    // "stacked" class before measuring gives the row form's true natural
    // width even if it's currently stacked -- synchronous, so no visible
    // flash before the class is reapplied (or not) in the same frame.
    updateExportButtonsLayout: function() {
      const btns = document.getElementById("exportButtons");
      const legend = document.getElementById("legend");
      if (!btns || !legend) return;

      const GAP_PX = 24; // minimum breathing room between the two, in real screen px
      btns.classList.remove("stacked");
      const btnsRect = btns.getBoundingClientRect();
      const legendRect = legend.getBoundingClientRect();
      if (btnsRect.right + GAP_PX > legendRect.left) {
        btns.classList.add("stacked");
      }
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
      const total = n;

      // Fast mode (review P4): suppress ALL live display for the duration of
      // the batch -- no histogram rebuilds, no bottom-panel redraws, no stats
      // text -- and show only a coarse photon counter in the 3D view, with a
      // single full refresh at the end. Read ONCE here, like simParams below:
      // toggling the checkbox mid-run must not switch modes underneath a run
      // in flight (it takes effect at the next launch, same contract as every
      // other input). Photon-to-scene work (endpoint markers, capped paths)
      // KEEPS running in fast mode -- it is cap-bounded and cheap, and it
      // means the finished 3D view is already correct at the end with no
      // second pass over the run.
      const fastMode = UI.getFastMode();
      const sliceMs  = fastMode ? SLICE_MS_FAST : SLICE_MS_NORMAL;
      let lastRefresh = performance.now();
      let pauseShown = false;   // fast mode: full refresh done for this pause?

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

      if (fastMode) RunControl.showFastCounter(0, total);

      // Simulate exactly k photons. Identical work and identical ORDER in both
      // modes -- the RNG stream, and therefore every count, is untouched by
      // slice sizing or display cadence (goldens/gates unaffected by P4).
      function runPhotons(k) {
        for (let i = 0; i < k; i++) {
          const drawPath = allowPaths && state.pathGroup.children.length < maxPaths;
          const result = Physics.simulatePhoton(simParams, drawPath);
          result.photonId = state.nextPhotonId++;
          SimStats.record(result);
          for (const t of result.cloudBaseTransmissions) SimStats.registerCloudBaseTransmission(t);
          for (const e of result.surfaceEvents)          SimStats.registerSurfaceEvent(e);
          for (const d of result.surfaceReflectionDirs)  SimStats.registerSurfaceReflection(d);
          Photons.addPhotonToScene(result, drawPath);
        }
      }

      // Full display refresh + counter teardown; used at completion, Stop, and
      // on entering Pause (so a paused fast run can still be inspected).
      // finalizeEndpoints() belongs here, not per slice -- see the trim-only
      // call in chunk() below.
      function fullRefresh() {
        RunControl.hideFastCounter();
        Photons.finalizeEndpoints();
        Scene.rebuildHistograms();
        StatsPanel.updateDisplay();
      }

      function chunk() {
        // Honor Stop first, even over Pause: a stopped run must not resume
        // simply because Pause/Resume gets toggled again. Leaves the photon
        // count wherever it stood at the moment Stop was clicked; Reset is
        // the only way forward from here.
        if (state.isStopped) {
          fullRefresh();
          return;
        }
        // Honor Pause/Step in instant mode: while paused, idle until Resume
        // or a single Step request (Step advances exactly one photon).
        // Latency is one slice (<=40 ms in fast mode) -- imperceptible.
        if (state.isPaused && !state.stepRequested) {
          // Fast mode: pausing is the user asking to LOOK at the run, so pay
          // for one full refresh on entry (once per pause, not per idle tick)
          // and restore the counter when they resume.
          if (fastMode && !pauseShown) {
            pauseShown = true;
            fullRefresh();
          }
          setTimeout(chunk, 100);
          return;
        }
        if (fastMode && pauseShown) {
          pauseShown = false;
          RunControl.showFastCounter(total - remaining, total);
        }

        const steppingOnce = state.stepRequested;
        state.stepRequested = false;

        let m = 0;
        if (steppingOnce) {
          m = Math.min(1, remaining);
          runPhotons(m);
        } else {
          // Run photons until this slice's wall-clock budget is spent, in
          // SLICE_CLOCK_GRANULARITY sub-batches so the clock check itself
          // stays off the per-photon path.
          const sliceStart = performance.now();
          const sliceCap = Math.min(remaining, MAX_SLICE_PHOTONS);
          while (m < sliceCap) {
            const k = Math.min(SLICE_CLOCK_GRANULARITY, sliceCap - m);
            runPhotons(k);
            m += k;
            if (performance.now() - sliceStart >= sliceMs) break;
          }
        }

        remaining -= m;
        const finished = remaining <= 0;
        const now = performance.now();
        const heavyDue = !fastMode && (now - lastRefresh >= REFRESH_HEAVY_MIN_MS);

        // Endpoint maintenance is now SPLIT the same way the panel is
        // (2026-07-20 follow-up): the trim is O(overshoot) bookkeeping that
        // bounds memory and must run every slice, but the instanced-mesh
        // SYNC rewrites up to `Endpoint caps shown` instances (6000 default,
        // 20000 max) with a matrix + color each, and only matters when
        // something is actually drawn. Running it per slice meant ~780 slices
        // x 6000 instances = ~4.7M redundant matrix writes over a 20M
        // fast-mode run, none of which were ever displayed. Now it runs only
        // when a heavy refresh does (normal mode) or at the end/Stop/Pause
        // (fast mode) -- markers update ~5/s instead of ~80/s, visually
        // identical, and free in fast mode.
        if (finished || steppingOnce || heavyDue) {
          Photons.finalizeEndpoints();
        } else {
          Photons.trimEndpointMarkers();
        }

        if (finished || steppingOnce) {
          fullRefresh();
        } else if (fastMode) {
          RunControl.updateFastCounter(total - remaining, total);
        } else {
          // Split cadence (see REFRESH_HEAVY_MIN_MS): cheap text every slice,
          // expensive rebuilds on the wall-clock gate. Order matters only in
          // that updateDisplay() below already includes the text write, so the
          // gated branch doesn't repeat it.
          if (now - lastRefresh >= REFRESH_HEAVY_MIN_MS) {
            lastRefresh = now;
            Scene.rebuildHistograms();
            StatsPanel.updateDisplay();
          } else {
            StatsPanel.updateStatsText();
          }
        }

        if (!finished) {
          setTimeout(chunk, 0);
        }
      }

      chunk();
    },

    // ---- Fast-mode photon counter overlay (review P4) --------------------
    // Deliberately the cheapest possible live feedback: two text-node writes
    // per slice (~25/s), no layout thrash, no canvas work, no per-photon DOM
    // access. Resolution is 0.1M (100k photons) as specified -- finer would
    // just flicker at these rates and imply a precision the coarse slice
    // cadence doesn't have.
    _formatFastCount: function(v) {
      return (Math.floor(v / 1e5) / 10).toFixed(1) + "M";
    },

    showFastCounter: function(done, total) {
      state.fastRunActive = true;
      const box = document.getElementById("fastModeCounter");
      if (!box) return;
      box.style.display = "block";
      RunControl.updateFastCounter(done, total);
    },

    updateFastCounter: function(done, total) {
      const box = document.getElementById("fastModeCounter");
      if (!box || box.style.display === "none") return;
      const valueEl = document.getElementById("fastModeCounterValue");
      const subEl   = document.getElementById("fastModeCounterSub");
      if (valueEl) {
        valueEl.textContent =
          `${RunControl._formatFastCount(done)} / ${RunControl._formatFastCount(total)} photons`;
      }
      if (subEl) {
        const pct = total > 0 ? Math.floor(100 * done / total) : 0;
        subEl.textContent = `${pct}% — display paused (fast mode)`;
      }
    },

    hideFastCounter: function() {
      state.fastRunActive = false;
      const box = document.getElementById("fastModeCounter");
      if (box) box.style.display = "none";
    },

    resetScene: function() {
      RNG.reset();
      RunControl.hideFastCounter();   // review P4: never leave the overlay stranded
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

    // Render loop. Throttled during a fast-mode batch (review P4 follow-up):
    // with live display suppressed AND the endpoint-mesh sync deferred, the
    // scene is genuinely static between the start and end of the run, so a
    // full 60 fps repaint of it is pure competition for the same main thread
    // the photon slices run on (~1500 wasted frames over a 25 s run).
    // controls.update() still runs every frame so camera damping stays smooth
    // and drag input is never dropped -- only the repaint is decimated, to
    // ~20 fps, which is still fluid for orbiting while waiting.
    _renderFrame: 0,
    animate: function() {
      requestAnimationFrame(RunControl.animate);
      state.controls.update();
      if (state.fastRunActive) {
        RunControl._renderFrame = (RunControl._renderFrame + 1) % FAST_RENDER_EVERY_N_FRAMES;
        if (RunControl._renderFrame !== 0) return;
      }
      state.renderer.render(state.scene, state.camera);
    }
  };
