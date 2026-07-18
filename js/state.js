// state.js — Shared mutable application state and scene constants.
// All cross-module mutable variables live here as properties of `state`
// so ES module imports can read and write them without reassignment restrictions.

import { Status } from './constants.js';

export const state = {
  // Three.js core objects (populated by RunControl.init)
  scene:    null,
  camera:   null,
  renderer: null,
  controls: null,

  // Three.js scene groups
  cloudGroup:      null,
  pathGroup:       null,
  endpointGroup:   null,
  histogramGroup:  null,
  // Persistent footprint-heatmap InstancedMeshes (reflected/transmitted/
  // surface-absorbed) live here, NOT inside histogramGroup -- histogramGroup
  // is destroyed and rebuilt every Scene.rebuildHistograms() call (frame
  // outlines, surface-interaction marker spheres), which is fine for those
  // lightweight per-call objects, but was also destroying and recreating the
  // heatmap meshes themselves on that same cadence. Each recreation gives a
  // mesh a fresh, ever-increasing three.js object id, which flips the
  // ambiguous tie-break three.js uses to order same-renderOrder transparent
  // objects -- the same root cause diagnosed for the endpoint marker mesh
  // (see Photons._ensureEndpointMesh). Keeping the heatmap meshes here, with
  // stable identity across rebuilds (see Scene._heatmapMeshFor), fixes a
  // 2026-07 user report of the 3D view flashing between dense/sparse
  // renderings during a live run and continuing to toggle when adjusting the
  // endpoint-cap slider under periodic-boundary domains.
  heatmapMeshGroup: null,
  heatmapMeshes:    {},

  // Endpoint markers: plain data records {x, y, z, color, radius} (oldest
  // first), rendered as a single InstancedMesh by Photons.syncEndpointMesh().
  endpointData:       [],
  endpointInstanced:  null,

  // Photon animation tracking
  lastScatterMarker:     null,
  nextPhotonId:          1,
  isAnimating:           false,
  isPaused:              false,
  isStopped:             false,
  stepRequested:         false,
  activePhotonID:        null,
  activePhotonStep:      0,
  activePhotonTotalSteps: 0,
  activePhotonStatus:    Status.NONE,
};

// Cloud geometry and optical properties (mutated by Scene.updateWorld).
// domainW/domainD: full illumination-domain extent (M·W x M·D under "Uniform
// domain" illumination; equal to slabW/slabD for legacy modes). domainMarginX:
// leeward (+x) ground-footprint overshoot beyond domainW under Uniform domain
// + open boundary only (2026-07 rendering fix -- see Scene.updateWorld and
// SimStats.surfaceFootMarginX()); zero otherwise. Declared here (not added
// dynamically in updateWorld) for shape stability/discoverability.
export const world = { tauCloud: 10, slabW: 40, slabD: 40, slabH: 10, zScale: 1,
                       domainW: 40, domainD: 40, domainMarginX: 0 };

// Maximum endpoint sphere markers shown in the 3D view.
export const DEFAULT_ENDPOINT_MARKERS = 6000;

// Left UI-panel footprint in CSS pixels — the x-offset where the 3-D viewport
// begins. Dynamic: RunControl.applyUiScale() shrinks it with the overlay
// "--ui-scale" so the 3-D view reclaims the freed space on smaller screens.
// Exported as a live binding; importers see updates via setUiPanelWidth().
export let UI_PANEL_WIDTH = 418;
export function setUiPanelWidth(w) { UI_PANEL_WIDTH = w; }
