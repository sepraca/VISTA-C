# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/), and the project follows
[Semantic Versioning](https://semver.org/).

## [5.3.0] — 2026-06-18

Observation-geometry correction. The old "cloud top/base + sides" was mislabeled:
it actually collected the **entire scene** (folding surface-reflected upward-bypass
flux into R). It is split into three correctly-labeled geometries, with a new
cloud-element geometry in the middle.

### Changed
- **Observation geometry is now a three-way choice** (was two):
  - **`top-base_faces`** (a) — cloud top/base faces only. Unchanged from the old
    `faces` / "cloud top/base faces only."
  - **`all_faces`** (b) — NEW, the "cloud element": photons leaving any cloud face
    go to R (upward: top + sides) or T (downward: base + sides), but
    surface-reflected photons that escape upward *without re-entering the cloud*
    stay in **S** (they left no cloud face).
  - **`scene`** (c) — entire scene: all upwelling → R, all downwelling → T, S = 0.
    This is exactly the old `faces_sides` behavior, renamed and relabeled. R here
    includes surface-bypass reflections, so it is the whole-scene albedo, not pure
    cloud-top reflectance.
  The only difference between b and c is the surface-reflected upward bypass
  (S under b, R under c); T and A are identical across b and c.
- **JSON `observation_geometry` keys** are now `top-base_faces` / `all_faces` /
  `scene` (were `cloud_top_base_faces_only` / `cloud_top_base_and_sides`). Old
  exports still load — only the label string changed (old "…and_sides" ≡ `scene`).

### Fixed
- **Path-length x-axis is now observation-geometry-independent.** Its scale is
  taken from the full (all-channel) path set rather than the active geometry's
  subset, so a/b/c share identical bin edges. Previously the axis could tip across
  a decade boundary between geometries (e.g. >60 vs >70), making the *identical*
  b/c transmitted distributions appear different.

## [5.2.0] — 2026-06-18

Visualization clarity improvements. Consistent visualization colors, better description of 3-D exit markers, added surface absorption heatmap, several rendering/usability fixes.

### Added
- **Surface-absorption heatmap** (Aₛ > 0): a 2-D map of photon surface absorption, on a grid 2× the cloud extent to better indicate absorption from cloud side leakage. Absorption beyond the surface grid clamps to the nearest boundary cell (a corner only when it overshoots the grid in both axes; the corners thus tend to be the brightest overflow bins). Geometry-independent. A **"Show surface heatmap"** toggle (default on) can be used to avoid overlap with the cloud base crossing footprint, and removes its rendering cost when off.

### Changed
- **Exit-marker legend descriptions.** Green markers are now
  drawn at *every* downward cloud-base crossing (consistent with the base footprint heatmap),
  relabeled **"downward cloud-base crossings"** (was "bottom transmitted
  endpoints"): unchanged at Aₛ = 0, but now also shown at Aₛ > 0. Blue markers
  relabeled **"upward cloud-top crossings"** (was "top reflected endpoints").
  Footprint legend "transmitted 2-D footprint" → **"downward cloud-base crossings
  footprint"**; "surface absorbed events" → **"surface absorbed endpoints"**.
- **Reflected endpoints recolored** from yellow to blue (`#60a5fa`) to match the
  reflected paths and footprint.
- **Surface-heatmap relief** matched to the reflected/base heatmaps so all three
  share one height scale (heights remain self-normalized within each map).
- **"Endpoint caps shown" is now a non-destructive display filter** — lowering
  then raising it reveals the same markers (retained, not discarded), even when a
  run finished with the slider at zero. The slider counts *markers* (crossings +
  endpoints), which exceed the photon count.

### Fixed
- **Surface absorptions were drawn twice** (a terminal endpoint plus a redundant
  surface event); now drawn once, as the dark brown endpoint, consistent with how cloud
  absorption is shown. Mid-trajectory surface *reflections* remain events (purple).

## [5.1.0] — 2026-06-17

Usability and limiting-case release: a true-angle incident-beam arrow, access to
the optically-thin / conservative-scattering regime, and a simpler Plot panel.

### Added
- **Cloud optical thickness now reaches 0.01** (was 0.1), with the input step
  tightened to 0.01. This makes the optically-thin limit reachable — e.g.
  confirming reflected flux → surface albedo as COT → 0 (validated against
  DISORT) — and supports pristine-aerosol cases (low AOD).

### Changed
- **Incident-direction arrow redrawn as solid geometry** (cylinder shaft + cone
  head, unlit red) so it stays clearly visible against dense photon paths during
  large ensembles, instead of a hairline that WebGL renders 1 px wide.
- **Near-nadir BDF azimuthal averaging is now always on**, and its toggle was
  removed from the Plot panel. The averaging only ever affected the innermost
  ring (θ < 5°) and is display-only; the JSON export remains raw/unsmoothed, and
  its `bdf` description now notes that the PNG and JSON differ at that ring.

### Fixed
- **Incident-zenith (Θ₀) arrow orientation** now points along the true incident
  direction, so its tilt equals Θ₀ across the full 0–89° range. Previously a
  fixed vertical component compressed the apparent angle (≈35° at 60°, ≈39° at
  89°), making the arrow look frozen at large Θ₀. Rendering-only; the simulated
  photon directions were always correct.

## [5.0.0] — 2026-06-15

Major capability release: quantitative data export, finite-cloud illumination
and observation-geometry controls, a DISORT validation suite, and a
radiative-transfer terminology pass. **Breaking:** the JSON export key names and
the side-exit accounting changed, so files written by v4.x do not round-trip
through the v5 reader unchanged.

### Added
- **Quantitative data export** — a "Download Data (JSON)" button writes
  full-precision µ histograms, BDF arrays, path-length distributions, and the run
  inputs/outputs. Companion `mc_export_reader.py` loads the JSON into NumPy/xarray
  and optionally converts to a CF-style NetCDF file.
- **Photon-illumination modes** — centered (pencil beam), uniform cloud-top, and
  uniform cloud-top + sunward side wall (projected-area weighting), for studying
  finite-cloud / 3-D illumination effects.
- **Observation-geometry control** — aggregate exits over the cloud top/base
  faces only ("a") or also include side-wall exits ("b": upward → R, downward → T,
  so S → 0). A pure post-processing choice that re-bins a completed run instantly
  with no re-simulation.
- **Validation & analysis tooling** — a `tests/` suite comparing MC fluxes and
  BDFs against DISORT (PythonicDISORT), and `illumination_comparison.py`, a 4×2
  comparison figure (µ / path / BDF-vs-zenith / BDF-polar).
- Horizontal extent raised to 500 optical depths.

### Changed
- **Radiative-transfer terminology** made consistent across the stats panel, PNG
  headers, JSON keys, and the reader: an explicit flux-vs-radiance distinction,
  F (flux) in place of E (energy), and "normalized flux" labels. JSON dataset keys
  were renamed accordingly (e.g. `R_top_reflected` → `R_reflected`).
- **Left-panel inputs** regrouped into Photon/Model, Plot, and Visualization
  sections with clearer labels (e.g. "Photon illumination", "Footprint grid size").
- Large-run handling: incremental binning (O(1) memory) and throttled display
  refreshes, enabling runs up to 10⁷ photons.

### Fixed
- **3-D cloud-box aspect ratio** now scales the vertical dimension with cloud
  optical thickness, instead of a fixed render height that was only correct at
  COT = 10.
- Reflecting-surface physics: boundary-crossing order and infinite-surface
  side-wall re-entry.
- BDF panel: removed the redundant on-plot normalization formula and corrected the
  near-nadir-averaging annotation.

## [4.0.0] — 2026-06-03

Initial public release. Modular ES-module architecture; physics/stats decoupling;
corrected net transmittance (T = E↓ − E↑); consistent N counts across all displays.

## [3.2] — pre-release

Monolithic single-file implementation; surface geometry and export statistics.
