# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/), and the project follows
[Semantic Versioning](https://semver.org/).

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
