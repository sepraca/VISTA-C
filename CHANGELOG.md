# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/), and the project follows
[Semantic Versioning](https://semver.org/).

## [Unreleased] — work in progress toward v6.0.0

**Not yet tagged/released.** Direct clear-sky (surface) illumination for a non-black
surface (Aₛ > 0), plus a general-purpose R/T/A component breakdown. Only the **open/
isolated** domain boundary is implemented so far — periodic domain tiling and a rigorous
sub-domain BRDF/observation-pixel treatment are planned but not yet built (see
`TODO-direct-surface-illumination.md`), so any of the below is still subject to change
before the v6.0.0 tag.

### Added
- **New "Uniform domain" illumination mode.** Every previous illumination mode (centered,
  uniform cloud-top, uniform cloud-top + sunward side) launches photons only onto the
  cloud itself. "Uniform domain" instead launches a TOA-uniform beam over a domain
  **M times wider than the cloud** (new **domain factor M ≥ 1** input) and ray-casts each
  photon to its first surface — cloud top, sunward side wall, or, new, the clear ground.
  This is what lets a reflective surface (Aₛ > 0) be illuminated directly by the sun, not
  only through the cloud, closing a real physics gap: R/T/A previously described only what
  the cloud does to light that already hits the cloud, not what a satellite pixel or model
  grid cell sees over cloud plus bright clear sky.
- **Cloud fraction f_c = 1/M²**, reported alongside the domain factor. Note M is a **1D**
  (linear) scaling and f_c is **2D** (areal) — M = 2 means f_c = 0.25, not "half the cloud
  fraction."
- **"ENTIRE DOMAIN" report block** (Uniform domain illumination only): an always-shown
  domain-normalized R_domain/T_domain/A_cloud budget (fractions of the *entire* launched
  domain, closing to 1.000), independent of the Observation-geometry dropdown. A **"Show
  R/T/A components"** checkbox expands it to a full breakdown of each component's origin
  (see below) — see the illumination × observation-geometry × outcome table below for how
  this relates to the existing Observation-geometry-driven R/T/A/S numbers.
- **R/T/A component breakdown**, under the same "Show R/T/A components" checkbox —
  available for **every** illumination mode, not just Uniform domain: Reflected splits into
  cloud-top / cloud-side / clear-sky-direct / clear-sky-via-cloud; Net transmitted splits
  into cloud-base / cloud-side / clear-sky-direct; Cloud absorption splits into
  cloud-incident vs. clear-sky-incident origins. (The clear-sky components are always zero
  for legacy illumination modes, which have no clear-sky photon source; the breakdown is
  otherwise identical for those modes and directly explains why, e.g., "cloud top/base/side
  faces" R can exceed "cloud top/base faces only" R — see the table below.)
- **"Show entire-domain plots" toggle** (bottom panel, Uniform domain only): swaps the
  Reflected and Net Transmitted μ-histogram / BDF / path-length plots from the
  cloud-element-only population to the domain-wide one. The domain-wide Net Transmitted
  view excludes the clear-sky-direct population from the plotted bars/mean (it's a true
  delta-function spike at exactly Θ₀ that no shared axis could show proportionally
  alongside real structure) and reports its count as separate text instead.
- **Domain-margin warning**: a live banner flags when the chosen M is smaller than the
  minimum needed to fully capture direct sunward-wall illumination at the current
  Θ₀/τ_cloud/horizontal-extent combination (M_min = 1 + 2·(τ_cloud/W)·tanΘ₀).
- JSON export: `domain_factor`/`domain_boundary` inputs and `cloud_fraction`/
  `uniform_domain_outputs` (nested R/T/A component breakdowns) outputs, present only for
  Uniform domain runs. Schema version 1.0 → 1.1 (additive only; 1.0 readers unaffected).

### Changed
- **Net Transmitted μ-histogram/BDF now use terminal-event-only binning.** The previous
  construction (an arrival/reflection running ledger) could show spurious negative bins
  under Uniform domain, where the clear-sky-direct population's exit angle is a true delta
  function; every mode and geometry is now guaranteed non-negative bins by construction.
  Legacy-mode outputs are unchanged (bit-identical).
- Path-length distributions decontaminate the clear-sky-direct (exactly-zero optical path)
  population from the plotted bars and reported mean under Uniform domain, instead of
  crushing the axis scale and biasing the mean toward zero; its count is reported as
  separate text. Legacy-mode outputs are unchanged.
- PNG exports: an entire-domain-plots export no longer shows Observation-geometry-driven
  stats that don't describe what's actually plotted below them; the on-screen 3D-view
  legend moved to a bottom-center band and widened (previously could overlap or clip past
  the canvas edge at some export widths); parameter/stat/domain boxes now share symmetric
  margins; BDF plot captions shortened so they no longer run off the canvas edges.
- Stats panel: FINAL OUTCOMES, SURFACE FLUX DIAGNOSTICS, and the new RADIATIVE COMPONENTS /
  ENTIRE DOMAIN sections reformatted with consistent indentation and bold section titles;
  "Active photon" moved near the top of the panel (previously at the very bottom); "Show
  R/T/A components" checkbox relocated next to the text it controls (previously grouped
  with unrelated Visualization-only toggles).
- 3D view: the rendered surface plane now scales with the Uniform domain's M-factor domain
  width (previously always rendered at the cloud's own footprint size regardless of M), with
  a thin outline marking the cloud's own footprint for scale reference at M > 1.

### Fixed
- `photonEntryLabel()` had no case for the new "uniform_domain" mode (silently fell back to
  "centered" in exports).

### New illumination × observation-geometry × outcome bookkeeping

The table below summarizes which outcome bucket (R/T/S/A) each kind of photon exit is
assigned to, for every combination now available — verified against the actual counter
identities in `simstats.js` (`reflectedCount()`/`transmittedNetCount()`/`sideExitCount()`/
`domain*Count()`), not just derived by inspection. "Bypass" is a surface-reflected photon
that escapes upward without ever (re-)touching a cloud face (only possible for Aₛ > 0, any
illumination mode); "clear-sky-direct" only exists under Uniform domain illumination.

| Exit / event | Obs. geometry: top/base faces only | Obs. geometry: top/base/side faces | ENTIRE DOMAIN (Uniform domain only, dropdown-independent) |
|---|---|---|---|
| Cloud-top exit (upward) | R | R | R |
| Cloud-side exit (upward) | S | R | R |
| Cloud-base-derived net surface absorption | T | T | T |
| Cloud-side-derived net surface absorption | S | T | T |
| Clear-sky-direct net surface absorption (Uniform domain only) | S | T | T |
| Surface bypass (reflects, escapes upward, never (re-)touches cloud) | S | S | R |
| Cloud interior absorption | A | A | A |

Two verified identities fall out of this: **R_domain = R(top/base/side faces) + bypass** —
"entire domain" R exceeds "top/base/side faces" R by exactly the bypass count, nothing
else — and **T(top/base/side faces) already equals T_domain exactly**; there is no
further T gain from selecting "entire domain," because "top/base/side faces" already
folds in cloud-side- *and* clear-sky-direct-derived surface absorption. Only "top/base
faces only" excludes those two from T (folding both into S instead) — confirmed
numerically (Θ₀=60°, Aₛ=0.5, M=3): S under "top/base/side faces" equals the bypass count
exactly, with nothing else left in S. This is also why "top/base/side faces" R can be
noticeably larger than "top/base faces only" R under Uniform domain illumination: the gap
is exactly the cloud-side-exit population, now visible directly in the R/T/A component
breakdown above. Full derivation (including the underlying per-crossing counters) is in
`TODO-direct-surface-illumination.md`'s "Component / outcome bookkeeping" and "T and A
component decomposition" sections.

## [5.4.0] — 2026-06-29

Rendering-performance release. No change to the physics, statistics, or any exported
output — the visualization is byte-for-byte identical.

### Changed
- **Footprint heatmaps now render as a single `InstancedMesh` each** (reflected,
  base-crossing, and surface). Previously each non-empty grid cell was its own
  `Mesh` + `BoxGeometry` + `MeshStandardMaterial` — ~3700 objects at 100k photons,
  rebuilt on every display refresh; now three instanced meshes draw all cells from a
  shared unit box scaled per instance. Per-cell color, opacity, and emissive glow are
  preserved exactly: color via `setColorAt`, and per-instance opacity + emissive
  (which three.js `instanceColor` cannot carry) via two `InstancedBufferAttribute`s
  injected through `material.onBeforeCompile`. The look is unchanged; 1M-photon runs
  are ~15–25% faster and allocate/free far fewer objects, so orbit/pan stays smoother
  during and after large runs.

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
- **Responsive overlay UI** — the control panel, header, legend, and bottom-panel
  plots now scale proportionally to fit smaller laptop/desktop windows (the 3-D
  canvas stays native resolution and reclaims the freed space). Presentation only;
  no effect on the simulation or its outputs.
- **Default cloud framing lowered** so the visualization sits clear of the legend on
  load (the camera and its target are panned down together, so the view angle is
  unchanged). Presentation only.

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
