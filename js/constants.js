// constants.js — frozen string-literal enums shared across UI, physics,
// stats, export, and rendering modules. Introduced under CODE-REVIEW R7 to
// remove the typo class where a mistyped mode/status string previously
// silently fell through to a default/legacy branch instead of erroring.
//
// Scope (R7, 2026-07-14): the four USER/PHYSICS-facing enums the CODE-REVIEW
// note called out by name (entry mode, observation geometry, domain
// boundary, terminal status). Physics-internal per-photon derived tags
// (launchFace/launchRegion: "top"/"wall"/"clear") are intentionally left as
// plain literals -- they're physics.js-internal (2 files, not the ~7-file
// spread R7 targets), and one value ("top") textually collides with
// EntryMode.TOP despite being a different concept; merging them into shared
// constants would risk conflating two unrelated enums. See
// CODE-REVIEW-v6.0-handoff.md, R7, for the full survey this module is based on.
//
// index.html's three <select> blocks (photonEntry, domainBoundary,
// observationGeometry) cannot import this module -- their <option value="...">
// literals are markup, not JS. They remain a manual sync point by convention;
// if any value here ever changes, the corresponding <option value="..."> in
// index.html must be updated to match by hand.

// ---------------------------------------------------------------------------------
// APP VERSION — the single source of truth (v6.3.1, 2026-08-11).
//
// Until now the version lived ONLY in prose: CHANGELOG.md, README.md and CITATION.cff
// each carried it independently, and nothing in js/ or index.html knew it at all. Two
// consequences, both of which actually happened:
//   * CITATION.cff sat at 6.0.7 through the v6.1.0 AND v6.2.0 releases, because nothing
//     tied it to anything;
//   * with several browser windows open on different builds, the app itself gave no way
//     to tell them apart (author-reported, 2026-08-11).
//
// Everything version-facing now derives from this constant: the <h1> header, the JSON
// export (`app_version`) and the PNG diagnostic header. tests/review-harness/
// verify_version.mjs asserts that CHANGELOG's newest entry, README's "Latest tagged
// release", and CITATION.cff all agree with it, so the drift above cannot recur silently.
//
// WHEN BUMPING: change it HERE, then run the test suite. The gate names any file that
// disagrees. Do not hardcode the version anywhere else.
export const APP_VERSION = "6.5.0";

// Photon entry/illumination mode (UI.getPhotonEntryMode(), physics.js entryMode param).
export const EntryMode = Object.freeze({
  CENTER:         "center",
  TOP:            "top",
  TOP_SIDE:       "top_side",
  UNIFORM_DOMAIN: "uniform_domain",
});
export const DEFAULT_ENTRY_MODE = EntryMode.CENTER;

// Observation-geometry dropdown (UI.getObservationGeometry(), SimStats._obsGeom()).
// NB: TOP_BASE_FACES uses a hyphen, not an underscore, unlike every other
// multi-word value in this file -- exactly the kind of inconsistency R7
// exists to make a one-time fix for instead of a recurring typo risk.
export const ObsGeom = Object.freeze({
  TOP_BASE_FACES: "top-base_faces",
  ALL_FACES:      "all_faces",
});
export const DEFAULT_OBS_GEOM = ObsGeom.TOP_BASE_FACES;

// Domain boundary condition (UI.getDomainBoundary(), physics.js domainBoundary param).
export const DomainBoundary = Object.freeze({
  OPEN:     "open",
  PERIODIC: "periodic",
});
export const DEFAULT_DOMAIN_BOUNDARY = DomainBoundary.OPEN;

// Terminal photon status -- the full set of physics.js simulatePhoton()/
// surfaceInteraction() return values, plus the UI-only sentinel default.
export const Status = Object.freeze({
  REFLECTED:        "reflected",
  TRANSMITTED:       "transmitted",
  SIDE_ESCAPE:       "side_escape",
  SURFACE_ABSORBED:  "surface_absorbed",
  ABSORBED:          "absorbed",
  TERMINATED:        "terminated",
  WRAP_CAPPED:       "wrap_capped",
  NONE:              "none",   // state.activePhotonStatus sentinel only -- never physics-returned
});
