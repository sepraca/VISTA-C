// main.js — Entry point. Imports all modules, wires callbacks, sets up
// window.* globals for HTML event attributes, and starts the simulation.

import { setDrawPanelCallback } from './statsPanel.js';
import { world } from './state.js';
import { BottomPanel } from './bottomPanel.js';
import { RunControl } from './runControl.js';
import { Scene } from './scene.js';
import { Photons } from './photons.js';
import { Export } from './exportUtils.js';
import { UI } from './ui.js';
import { SimStats } from './simstats.js';
import { StatsPanel } from './statsPanel.js';

try {
  // Wire BottomPanel into StatsPanel.updateDisplay() without a circular import.
  setDrawPanelCallback(() => BottomPanel.drawBottomPanel());

  // Expose namespaces globally so HTML onchange/onclick/onblur attributes work.
  // `world` is exposed for the change-detection guards on the τ/extent/M
  // inputs (compare the input against the APPLIED value so a mere
  // focus-in/focus-out doesn't reset a finished run -- 2026-07-16).
  window.world       = world;
  window.UI          = UI;
  window.Scene       = Scene;
  window.Photons     = Photons;
  window.BottomPanel = BottomPanel;
  window.Export      = Export;
  window.RunControl  = RunControl;
  window.SimStats    = SimStats;
  window.StatsPanel  = StatsPanel;

  // Legacy shorthands used by some HTML event attributes.
  window.runOne                = RunControl.runOne;
  window.runEnsemble           = RunControl.runEnsemble;
  window.resetScene            = RunControl.resetScene;
  window.resetCamera           = Scene.resetCamera;
  window.togglePause           = RunControl.togglePause;
  window.stepPhoton            = RunControl.stepPhoton;
  window.refreshEndpointDisplay = RunControl.refreshEndpointDisplay;
  window.drawBottomPanel       = BottomPanel.drawBottomPanel;
  window.download3DView        = Export.download3DView;
  window.downloadBottomPanel   = Export.downloadBottomPanel;
  window.downloadDataFile      = Export.downloadDataFile;

  RunControl.init();
  RunControl.animate();

} catch (err) {
  const box = document.getElementById("errorBox");
  box.style.display = "block";
  box.innerHTML =
    "<b>Three.js failed to load.</b><br><br>" +
    "This version needs internet access to load Three.js from jsDelivr. " +
    "For offline use, run a local server:<br><br>" +
    "<code>python3 -m http.server 8000</code><br><br>" +
    "Then open <code>http://localhost:8000/</code>.<br><br>" +
    "<small>Error: " + String(err).replace(/[<>&]/g, s => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[s])) + "</small>";

  document.getElementById("statsTop").textContent = "3-D renderer failed to load.";
}
