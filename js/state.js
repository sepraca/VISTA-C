// state.js — Shared mutable application state and scene constants.
// All cross-module mutable variables live here as properties of `state`
// so ES module imports can read and write them without reassignment restrictions.

export const state = {
  // Three.js core objects (populated by RunControl.init)
  scene:    null,
  camera:   null,
  renderer: null,
  controls: null,

  // Three.js scene groups
  cloudGroup:     null,
  pathGroup:      null,
  endpointGroup:  null,
  histogramGroup: null,

  // Endpoint markers: plain data records {x, y, z, color, radius} (oldest
  // first), rendered as a single InstancedMesh by Photons.syncEndpointMesh().
  endpointData:       [],
  endpointInstanced:  null,

  // Photon animation tracking
  lastScatterMarker:     null,
  nextPhotonId:          1,
  isAnimating:           false,
  isPaused:              false,
  stepRequested:         false,
  activePhotonID:        null,
  activePhotonStep:      0,
  activePhotonTotalSteps: 0,
  activePhotonStatus:    "none",
};

// Cloud geometry and optical properties (mutated by Scene.updateWorld).
export const world = { tauCloud: 10, slabW: 40, slabD: 40, slabH: 10, zScale: 1 };

// Maximum endpoint sphere markers shown in the 3D view.
export const DEFAULT_ENDPOINT_MARKERS = 6000;

// Left UI-panel footprint in CSS pixels — the x-offset where the 3-D viewport
// begins. Dynamic: RunControl.applyUiScale() shrinks it with the overlay
// "--ui-scale" so the 3-D view reclaims the freed space on smaller screens.
// Exported as a live binding; importers see updates via setUiPanelWidth().
export let UI_PANEL_WIDTH = 418;
export function setUiPanelWidth(w) { UI_PANEL_WIDTH = w; }
