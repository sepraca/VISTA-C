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
  // is destroyed and rebuilt every Scene.rebuildHistograms() call (now just
  // the lightweight heatmap frame outlines; the surface-interaction marker
  // spheres moved to a persistent InstancedMesh here too, 2026-07-19 review
  // P1), which is fine for those
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
  // Surface-interaction event markers (purple reflected / brown absorbed
  // spheres at the surface plane): one persistent InstancedMesh living in
  // heatmapMeshGroup (2026-07-19, review P1) -- previously up to 1,200
  // individual Mesh+SphereGeometry+MeshStandardMaterial triples rebuilt into
  // histogramGroup on EVERY heavy refresh (~120k transient objects per
  // 1M-photon Aₛ>0 run, plus 1,200 draw calls whenever shown). Same stable-
  // identity/fixed-capacity design as endpointInstanced above, for the same
  // transparent-sort reasons. Cleared (nulled) only on genuine scene reset
  // via Scene.clearHeatmapMeshes().
  surfaceMarkerMesh: null,

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
  // True only while a fast-mode batch is suppressing live display (review P4).
  // Set/cleared by RunControl.showFastCounter/hideFastCounter, read by
  // RunControl.animate to throttle the render loop -- see there for why.
  fastRunActive:         false,

  // Run timer (added 2026-07-20 during the P4 performance work; kept as a
  // permanent feature 2026-07-21). Wall-clock timing of the last/current
  // instant batch, surfaced in the stats panel (StatsPanel.runTimingLine) and
  // on the fast-mode counter. It earns its place: browser run-to-run spread at
  // 20M photons is ~4 s of thermal drift, the same size as the effects a user
  // comparing settings or builds would try to read off a stopwatch, so an
  // in-app elapsed+rate readout is the only reliable measurement. Written by
  // RunControl.runInstantBatch (three touch points: start, pause accounting,
  // end); pausedMs is excluded from the reported elapsed time. Costs two
  // performance.now() calls per run.
  runTiming: { startMs: 0, endMs: 0, pausedMs: 0, photons: 0, fastMode: false, running: false },
  stepRequested:         false,
  activePhotonID:        null,
  activePhotonStep:      0,
  activePhotonTotalSteps: 0,
  activePhotonStatus:    Status.NONE,
};

// Cloud geometry and optical properties (mutated by Scene.updateWorld).
// domainW/domainD: full illumination-domain extent (M·W x M·D under "Uniform
// domain" illumination; equal to slabW/slabD for legacy modes). The domain is
// always centered on the cloud (N2 ground-domain design, 2026-07-19).
export const world = { tauCloud: 10, slabW: 40, slabD: 40, slabH: 10, zScale: 1,
                       domainW: 40, domainD: 40 };

// Maximum endpoint sphere markers shown in the 3D view.
export const DEFAULT_ENDPOINT_MARKERS = 6000;

// Left UI-panel footprint in CSS pixels — the x-offset where the 3-D viewport
// begins. Dynamic: RunControl.applyUiScale() shrinks it with the overlay
// "--ui-scale" so the 3-D view reclaims the freed space on smaller screens.
// Exported as a live binding; importers see updates via setUiPanelWidth().
export let UI_PANEL_WIDTH = 418;
export function setUiPanelWidth(w) { UI_PANEL_WIDTH = w; }
