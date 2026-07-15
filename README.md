# VISTA-C: An Interactive 3D Monte Carlo Visualization of Cloud Radiative Transfer

VISTA-C (Visualization of Interactive Stochastic Transport in Atmospheres–Clouds) is an interactive 3D Monte Carlo (MC) simulator of solar photon transport through a finite plane-parallel cloud layer.

The simulator combines physically based radiative transfer with real-time 3D visualization of individual photon trajectories. Current capabilities include Henyey-Greenstein scattering, Lambertian surface reflection, and user-selectable illumination and viewing geometries, allowing users to explore the influence of cloud optical properties and scene geometry on photon transport and radiative outcomes.

Originally developed as an intuitive educational tool for students, scientists, and engineers working in cloud remote sensing and atmospheric radiative transfer, VISTA-C has evolved to represent increasingly realistic three-dimensional radiative transfer scenarios. Nevertheless, the code remains primarily a visualization and educational platform and has only been numerically validated against PythonicDISORT for a limited set of plane-parallel benchmark cases (see the tests/ directory). 

---

## Live Demo

Open `index.html` via a local server (see [Running Locally](#running-locally) below).  
A hosted version is available at: https://sepraca.github.io/VISTA-C/  
*(The hosted version tracks `main`, which is currently at the tagged **v6.0.3** release
— see Version History below. All tagged releases are available from the
[Releases](https://github.com/sepraca/VISTA-C/releases) page.)*

---

## Features

- **Reproducible MC statistics**: deterministic Mulberry32 RNG with fixed seed (42)
- **3D photon path visualization**: animated and static path rendering with colored crossing and endpoint markers by outcome
- **Henyey-Greenstein phase function**: exact inverse-CDF sampling for the scattering angle
- **Lambertian surface reflection**: configurable surface albedo Aₛ with geometric sub-cloud gap propagation
- **Finite-cloud illumination modes**: pencil-beam (centered) entry, uniform illumination of the cloud top (optionally including the sunward side wall), or a **uniform domain** launch that also illuminates the clear sky around the cloud, to study 3D edge effects and direct clear-sky surface illumination — with a selectable **open/isolated** or **periodic** (tiled cloud field) domain boundary *(v6.0.2 — see [CHANGELOG](CHANGELOG.md))*
- **Observation-geometry controls**: post-processing selection to aggregate statistics for photons exiting the cloud top/base faces only or also include cloud side photon exits
- **R/T/A component breakdown**: an optional expanded view (any illumination mode) splitting each of R, T, and A into its constituent exit/origin populations — see *Illumination and observation-geometry bookkeeping* below
- **Surface-absorption heatmap**: toggleable 2-D map of where photons are absorbed at the Lambertian surface. Shown whenever Aₛ > 0 (any illumination mode), and also under **Uniform domain** illumination at Aₛ = 0 — every clear-sky-incident photon is absorbed there by definition at a black surface, and the resulting map traces the cloud's shadow. Grid extent is 2× the cloud extent for legacy/cloud-derived landings; under Uniform domain it tracks the domain factor M instead (capped) so the grid actually covers the region the direct beam can reach
- **Net normalized flux transmittance (surface absorption)**: correctly accounts for surface reflections: T = F↓ − F↑ at surface
- **Rigorous BRF/BTF polar plots** *(v6.0.2, Phase 4)*: bidirectional reflectance/
  transmittance factors normalized by the **realized top-face-incident flux**
  (N_top·A_proj/W²), for **every** illumination mode — the domain-mean, N-normalized BDF
  remains available as the entire-domain view; see *Diagnostic plots* below
- **Sub-cloud observation pixel** *(v6.0.2, Phase 4)*: restrict the Reflected μ/BRF
  statistics to a centered pixel of width f_pix × cloud width (fixed per run), with
  N_pixel = N_top·f_pix² normalization — an imager-style effective-pixel view
- **Bottom panel plots**: μ = |cos Θ| exit-angle histograms, BRF/BTF polar plots (linear/log scale), optical path-length distributions
- **PNG plot export**: 3D view and bottom panel with diagnostic parameter headers
- **Quantitative data export (JSON)**: full-precision µ histograms, BDF arrays, path-length distributions, and run inputs/outputs for comparison against other codes (e.g. DISORT); a companion Python reader converts the JSON file to NetCDF
- **Fully modular ES module architecture**: 12 focused JavaScript files, no bundler required

---

## Physics Overview

Each photon is launched into the cloud at a user-specified solar zenith angle Θ₀. Free paths are sampled from an exponential distribution with extinction coefficient β_ext. Scattering directions are drawn from the analytic Henyey-Greenstein phase function via exact inverse-CDF sampling:

$$\cos\theta = \frac{1}{2g}\left[1 + g^2 - \left(\frac{1-g^2}{1-g+2g\xi}\right)^2\right]$$

At the cloud base, photons are propagated geometrically through a clear sub-cloud gap to a Lambertian surface with albedo Aₛ. The net (physical) surface absorption is F↓ − F↑, where F↓ and F↑ are the total downward and upward crossings of the **surface plane** — counting every photon that reaches the surface, whether it arrived through the cloud base *or* by exiting a cloud side and descending through the clear gap. This surface balance is **independent of the Observation-geometry setting**.

How that absorption is reported as the transmittance T depends on the Observation geometry. Under the side-inclusive geometry ("cloud top/base/side faces") it is the full physical absorption,

$$T_{\text{net}} = \frac{F_{\downarrow} - F_{\uparrow}}{N_{\text{launched}}}$$

while under "cloud top/base faces only" (the default) photons that reach the surface via a cloud-side exit are attributed to S instead of T, so T ≤ (F↓ − F↑)/N_launched. They converge as the horizontal extent grows and side leakage vanishes.

Photon outcomes: **Reflected** (exits cloud top) | **Net transmitted** (absorbed at surface) | **Cloud absorbed** | **Side escape**

Conservation check: R + T + A + S = 1.0

### Photon illumination: pencil beam vs. full cloud

The **Photon illumination** control sets where photons enter the cloud:

- **Centered (point source)** *(default)*: every photon enters at (x, y) = (0, 0),
  the classic plane-parallel pencil-beam launch. This is the only mode guaranteed
  bit-reproducible against the seed-42 reference cases.
- **Uniform cloud top**: entry points are selected uniformly over the cloud-top
  face, simulating full cloud-top illumination of a finite cloud. For a large horizontal
  extent this converges to the plane-parallel result; at finite extent it reveals
  3D edge leakage (photons launched near the edges escape out the sides), which
  the centered launch does not capture.
- **Uniform cloud top + sunward side**: additionally illuminates the sunward
  vertical wall at oblique sun. The two lit faces are weighted by their
  beam-projected areas, so the fraction of photons entering through the side is

$$p_{\text{side}} = \frac{\tau_{\text{cloud}}\sin\Theta_0}{W\cos\Theta_0 + \tau_{\text{cloud}}\sin\Theta_0}$$

where W is the horizontal extent. At Θ₀ = 0 this reduces exactly to the top-only mode.
- **Uniform domain** *(v6.0.2 — see note above)*: extends illumination beyond
  the cloud itself. Photons launch from a top-of-atmosphere plane uniform over a domain
  **M times wider than the cloud** (new **domain factor M ≥ 1** input, shown only in this
  mode) and are ray-cast to their first surface — cloud top, sunward side wall, or, new,
  the clear ground. This is what makes a non-black surface (Aₛ > 0) receive direct solar
  illumination as well as light diffusing out through the cloud, closing a gap in every
  other illumination mode: previously, R/T/A described only what the cloud does to light
  that already hits the cloud, not what a satellite pixel or model grid cell sees over
  cloud plus bright clear sky. Cloud fraction **f_c = 1/M²** is reported alongside M — note
  M is a **1D** (linear) scaling and f_c is **2D** (areal): M = 2 means f_c = 0.25, not
  "half the cloud fraction." A selectable **Domain boundary** control (**open/isolated**
  or **periodic**, tiled cloud field) governs what lies beyond the launch margin — see
  next.

  **What "uniform" means here, precisely** *(2026-07 fix — see
  [CHANGELOG](CHANGELOG.md))*: the surface should receive illumination that is exactly
  uniform over the full M·W × M·W domain, absent the cloud — the cloud shadows what it
  physically shadows (and nothing more), regardless of the cloud's own optical thickness
  τ_cloud. Because launch happens at a fixed reference (cloud-top, τ=0) and the ground
  sits `τ_cloud + β_ext·d_sfc` optical depths below it, a clear-sky photon's ballistic
  sideways drift before reaching the ground grows with τ_cloud — so a naively symmetric
  M·W launch window silently loses sunward-side ground coverage as the cloud gets
  optically thicker, independent of M (an under-open-boundary-only bug, since periodic
  tiling absorbs this drift exactly via wraparound and needs no correction). The fix
  widens the launch window's sunward edge only (never the leeward edge, which stays at
  the cloud's own footprint boundary) by exactly this drift, so ground illumination is
  uniform over the full domain for any τ_cloud/Θ₀/M combination, open boundary included.
  Practically: **open-boundary uniform_domain runs now auto-raise M** to the minimum that
  keeps this true for the current Θ₀/τ_cloud/β_ext/d_sfc/W combination
  (M_min = 1 + 2·(τ_cloud + β_ext·d_sfc)/W · tanΘ₀ — corrected to include the
  previously-missing surface-gap term), with a note shown when this happens; the live
  `#domainMarginWarning` banner remains as an informational preview of what will change
  before you run.

#### Domain boundary: open/isolated vs. periodic (v6.0.2)

The **open/isolated** boundary treats the far clear sky beyond the launch margin as
unilluminated by the cloud field — a single finite cloud sitting alone in an otherwise
empty domain. The **periodic** boundary instead tiles the M·W × M·W domain infinitely in
both horizontal directions — an infinite *regular field* of identical clouds at cloud
fraction f_c = 1/M², rather than the single isolated cloud of the open boundary. This is
a **physically different scene**, not merely a numerical option: a photon that would
escape sideways under the open boundary instead travels on to illuminate a neighboring
cloud (implemented by wrapping its coordinates back into the fundamental cell, the same
minimum-image technique used for periodic boundaries in molecular dynamics), so
R_domain, surface absorption, and the cloud-interaction components all genuinely change
at moderate M; the two boundaries converge only as M → ∞ (the difference is largest at
small M combined with a reflective surface, Aₛ > 0 — see the periodic-boundary golden
snapshot and Illumination-comparisons figures in `tests/`). Because every tile is
statistically identical, tallying each photon's ultimate fate in its launch cell yields
the exact per-unit-cell energy budget of the infinite field — R_domain then represents
the areal-mean albedo of the broken-cloud field. This also carries a large
variance-reduction economy: one simulated cell delivers infinite-cloud-field statistics
that would otherwise require explicitly simulating a many-cloud domain (and, per photon,
the side-escape sink vanishes, so more terminal events populate the R/T/A components
being analyzed). Caveat: the tiling is a perfectly regular lattice of identical clouds —
no clumping or size distribution, and at particular Θ₀ the sun alignment with lattice
rows can produce structured artifacts — the standard idealization for regular/broken
cloud fields in the 3-D cloud RT literature, but not "statistically realistic broken
cloudiness."

The centered launch draws no extra random numbers, so it leaves the RNG stream
unchanged; the uniform modes consume entry draws. Note that at Θ₀ = 0 the *top* and
*top + side* modes are statistically identical but **not** bit-identical — *top +
side* consumes one extra face-selection draw per photon, offsetting the stream, so
their integer counts differ at the ~1σ Monte Carlo level. The horizontal extent may
be set up to 500 optical depths to push the uniform modes toward the plane-parallel
limit.

### Observation geometry: exit photon aggregation choices

With the code's ability to simulate 3D radiative transfer, an unambiguous categorization of exiting photon statistics is no longer possible. A finite cloud loses photons through its sides as well as its top and base, and over a reflective surface photons can reflect off the surface and escape to space without ever re-interacting with the cloud. How those exits are bookkept depends on the **Observation geometry** selection, which offers two aggregations:

- **Cloud top/base faces only** *(default, "a"; key `top-base_faces`)*: only photons whose final trajectory leaves through the cloud top or reaches the surface via the base are aggregated into R or T, respectively. In this case, photons that exit a cloud-side (either reflected to space or surface-absorbed) and photons that are surface-reflected and escape to space without re-interacting with the cloud (bypass escape) are bookkept under S. Appropriate for an observer (e.g., imager) whose field of view (FOV) can resolve the cloud top or base and exclude the surrounding scene.
- **Cloud top/base/side faces** *("b"; key `all_faces`)*: photons leaving any cloud face (top, base or sides) are aggregated. Upward propagating (top + sides) → R, downward propagating (base + sides) → T. This already includes any clear-sky-direct surface absorption possible under Uniform domain illumination (see below) — the only population still excluded from both R and T here is the surface-reflected upward bypass (escapes *without re-touching the cloud*), which remains in S. Appropriate for an observer FOV that cannot distinguish the cloud top/base from its sides.

This is a pure **post-processing choice**: it changes only how the accumulated
photon exit counts are aggregated, not the simulated trajectories. A user can select either geometry without a re-run. The two converge as the horizontal extent grows (side leakage → 0). The exported JSON records the active choice in `observation_geometry`. The 2-D footprint heatmaps are always top/base-plane projections and are unaffected by this control.

*(Prior to v6.0.0, a third choice, "Entire scene," folded the surface-reflected bypass into R as well, so S = 0 by definition — but the code had no way to launch surface-incident photons, so there was no physically meaningful observation it corresponded to. It has been removed as a selectable Observation geometry. Uniform domain illumination (v6.0.2, see above) now provides an always-shown, dropdown-independent **ENTIRE DOMAIN** report block instead, described next, which finally gives that whole-scene total a real physical source population to draw from.)*

#### R/T/A component breakdown and the ENTIRE DOMAIN block

A **"Show R/T/A components"** toggle (default off) expands R, T, and A each into their
constituent populations — available under **every** illumination mode, not just Uniform
domain:

- **R** splits into: cloud-top exit, cloud-side exit (upward), clear-sky-direct bypass
  (Uniform domain only), and clear-sky-via-cloud bypass (a surface-reflected photon that
  escapes upward through the clear sky **without** re-entering the cloud — its energy
  reached the surface via the cloud; possible under any illumination mode whenever
  Aₛ > 0). Component labels denote the **final exit pathway**, not the launch origin —
  a photon that re-enters the cloud after a surface bounce and then escapes lands in the
  cloud-top or cloud-side component, not here.
- **T** splits into: cloud-base-derived, cloud-side-derived, and clear-sky-direct
  (Uniform domain only) net surface absorption.
- **A** splits into: cloud-incident (the photon's very first ray-cast hit the cloud) vs.
  clear-sky-incident (Uniform domain only: launched into clear sky, reflected by the
  surface, and recycled into the cloud before being absorbed there).

The clear-sky components are always zero for the three legacy illumination modes (they have
no clear-sky photon source); the breakdown is otherwise identical there, and directly
explains why "cloud top/base/side faces" R can exceed "cloud top/base faces only" R
whenever Aₛ > 0 (the difference is exactly the cloud-side-exit population — see the table
below).

Under **Uniform domain** illumination specifically, an always-shown **ENTIRE DOMAIN** block
reports the full-domain-normalized R_domain/T_domain/A_cloud budget (fractions of the
*entire* launched domain, closing to 1.000), independent of the Observation-geometry
dropdown above; the same "Show R/T/A components" toggle expands it to the same style of
breakdown. A **"Show entire-domain plots"** toggle (bottom panel, Uniform domain only)
similarly swaps the Reflected/Net Transmitted μ-histogram, BDF, and path-length plots from
the cloud-element-only population to the domain-wide one (the domain-wide Net Transmitted
view excludes the clear-sky-direct population — a true delta-function spike at exactly
Θ₀ — from the plotted bars/mean, reporting its count as separate text instead).

The table below summarizes which outcome bucket (R/T/S/A) each kind of photon exit is
assigned to, for every combination now available — verified directly against the
`reflectedCount()`/`transmittedNetCount()`/`sideExitCount()`/`domain*Count()` counter
identities in `simstats.js`, at multiple Θ₀/Aₛ/ω₀/M combinations and for both Uniform
domain and legacy illumination:

| Exit / event | Obs. geometry: top/base faces only | Obs. geometry: top/base/side faces | ENTIRE DOMAIN (Uniform domain only, dropdown-independent) |
|---|---|---|---|
| Cloud-top exit (upward) | R | R | R |
| Cloud-side exit (upward) | S | R | R |
| Cloud-base-derived net surface absorption | T | T | T |
| Cloud-side-derived net surface absorption | S | T | T |
| Clear-sky-direct net surface absorption (Uniform domain only) | S | T | T |
| Surface bypass (reflects, escapes upward, never (re-)touches cloud) | S | S | R |
| Cloud interior absorption | A | A | A |

Two verified identities fall out of this: **R_domain = R("top/base/side faces") + bypass**
— "entire domain" R exceeds "top/base/side faces" R by exactly the bypass count, nothing
else — and **T("top/base/side faces") already equals T_domain exactly**, since that
Observation geometry already folds in cloud-side- *and* clear-sky-direct-derived surface
absorption; only "top/base faces only" excludes those two (folding both into S instead).
Full derivation (down to the individual per-crossing counters) is in
`TODO-direct-surface-illumination.md`.

Note that a single instrument (observer) can only sample a small part of the geometries given by these simulations. The full geometries are given so that the output can be filtered for a users specific use cases.

### Diagnostic plots: flux vs. Bidirectional Distribution Function (BDF)

The bottom-panel plots/diagnostics of the histograms and BDFs contain two physically distinct quantities, so their y-axes are not interchangeable:

- The **μ = |cos Θ| exit-angle histograms** and the **optical path-length
  distributions** are **flux (energy) distributions** with y-values equal to
  photon counts (∝ energy) per bin, i.e. the number of photons exiting in each
  μ or path-length interval.
- The **BDF** is a quantity proportional to **radiance**: BDF = (W/N)·π/(μ·Δμ·Δφ), which is normalized per unit projected solid angle. In particular, this introduces an explicit 1/μ factor relative to the photon count in the µ histograms.

**BRF/BTF normalization (v6.0.2, Phase 4).** The polar panels display the rigorous
bidirectional reflectance factor (BRF) / transmittance factor (BTF):

$$\mathrm{BRF}(\mu_i,\varphi_j) = \frac{\pi}{\mu_i\,\Delta\mu_i\,\Delta\varphi_j}\cdot\frac{N_{ij}}{N_{\mathrm{top}}\cdot A_{\mathrm{proj}}(\theta_v,\varphi_v)/W^2}$$

where **N_top is the realized count of photons whose first ray-cast hit the cloud-top
face** (a ratio-estimator choice that cancels common-mode Monte Carlo noise), and
A_proj/W² = 1 + (τ_cloud/W)·tanθᵥ·(|cosφᵥ|+|sinφᵥ|) is the cloud element's ground-projected
silhouette under side-inclusive observation (≡ 1 for "top/base faces only" — a flat top's
footprint is W² from any view angle). No cap is applied (equivalent-uniform-beam
convention). Consequences worth knowing: for *uniform cloud top* and *centered*
illumination under top-face observation this reduces **exactly** to the historical BDF
(the DISORT-validated cases are unchanged); for *top+side* it supplies the
horizontal-equivalent µ₀F₀ correction 1/(1−p_side); for *Uniform domain* it removes the
cloud-fraction dilution — e.g. at M = 4, Θ₀ = 0, Aₛ = 0.5 the cloud's BRF is ~1.4× the
uniform-top value, the real brightening from surface-recycled illumination. The
**entire-domain view keeps the N-normalized BDF** deliberately: for a whole-domain FOV
the f_c-diluted value *is* the domain-mean quantity a coarse pixel measures. If
N_top = 0 (possible at tiny N with large M), the panel falls back to the N-normalized
BDF with a caption note.

As a result the BDF and µ histograms are *consistent but not identical* representations of the same exit-direction data. Azimuthally averaging the BDF and converting back to
the flux (count) density recovers the μ histogram exactly:

$$\frac{1}{N}\frac{dN}{d\mu} = 2\mu\,\overline{\text{BDF}}(\theta), \qquad \mu=\cos\theta$$

so the cos Θ enters as a multiplicative weighting of the y-axis (flux ↔ radiance),
not merely as an x-axis change of variable.

### 3-D markers: crossings vs. endpoints, and the surface heatmap

The colored spherical markers in the 3-D view indicate two distinct types of transport: *net crossings* (where a photon can pass through a plane one or more times) and *terminal endpoints* (where a photon's trajectory ends; one per photon).

- **Downward cloud-base crossings** (green) are drawn at *every* downward crossing
  of the cloud base. Here, the markers show **each** downward crossings, e.g., a trajectory where a surface reflected photon re-enters the cloud and scatters back towards the surface again (or multiple times). The marker numbers are 1:1 with the green *downward cloud-base crossings footprint* heat map up to the number indicated in the "Endpoint caps shown" selection. For Aₛ = 0, each transmitted photon crosses the cloud base only once, so a crossing coincides with a photon's termination.
- **Upward cloud-top crossings** (blue): a reflected photon crosses the cloud top boundary exactly once, so these are simultaneously a crossing *and* a terminal endpoint.
- **Terminal endpoints**: surface-absorbed (brown) — when Aₛ > 0 (any mode), or
  at Aₛ = 0 under **Uniform domain** illumination, where every clear-sky-direct
  photon that reaches the surface is absorbed there by definition (a black
  surface reflects nothing; the RNG albedo draw is still made, deliberately,
  for reproducibility) — cloud-absorbed (black), and side-escape (orange).
  Mid-trajectory surface *reflections* are shown separately as events (purple).

The **surface-absorption heatmap** (toggle "Show surface heatmap"; shown whenever
Aₛ > 0, or under Uniform domain illumination even at Aₛ = 0 — see above) shows
where photons are absorbed at the surface. For legacy/cloud-derived landings it
uses a grid 2× the cloud extent to capture surface absorption from cloud side
leakage; under Uniform domain illumination the grid instead tracks the domain
factor M (capped at 10×cloud extent) so it covers the region the direct
clear-sky beam can actually reach — at M ≤ 2 this is identical to the legacy 2×
grid. Absorption beyond the surface grid is clamped to the nearest boundary
cell, each axis independently: a landing past the grid in one axis goes to the
nearest edge cell, and one past it in both axes goes to a corner. The four
corners therefore tend to be the brightest overflow bins, since each collects
an entire far-field corner region. This is geometry-independent, i.e., every
physical landing is binned, regardless of the Observation geometry choice.

The **"Endpoint caps shown"** slider is a non-destructive display filter. Lowering the set value and then increasing it
back to its original setting reveals the same markers (they are retained, not discarded), even when a run
finished with the slider at zero. Note that the slider counts *markers* (crossings + endpoints)
that can exceed the photon count.

---

## Running Locally

ES modules require an HTTP server — browsers block `file://` imports. From the repo root:

```bash
python3 -m http.server 8000
```

Then open **http://localhost:8000/** in any modern browser (Chrome, Firefox, Safari).

Three.js is loaded from jsDelivr CDN (version 0.164.1). An internet connection is required; an error box appears if it cannot load.

---

## Controls

| Parameter | Description | Default |
|---|---|---|
| Photons | Number of photons to simulate | 10000 |
| Cloud optical thickness τ | Total cloud optical thickness (0.01-100) | 10 |
| Horizontal extent | Slab width in optical path units (2-500) | 40 |
| Incident zenith Θ₀ | Solar zenith angle (degrees) | 0 |
| Photon illumination | Cloud-top entry: Centered (point source), Uniform cloud top, Uniform cloud top + sunward side, Uniform domain (v6.0.2, see above) | Centered |
| Domain factor M | Domain width = M × cloud width; shown only for Uniform domain illumination. Open boundary: auto-raised at run time to the minimum needed for uniform sunward ground illumination at the current Θ₀/τ_cloud/β_ext/d_sfc/W (2026-07 fix, see above and [CHANGELOG](CHANGELOG.md)) | 4 |
| Domain boundary | Open/isolated or periodic (tiled cloud field); shown only for Uniform domain illumination (v6.0.2, see above) | Open (isolated cloud) |
| Observation geometry | How exits are aggregated into R/T/S: top/base faces (a), or top/base/side faces / cloud element (b) | Cloud top/base faces only |
| Reflected observation pixel fraction (f_pix) | Centered observation pixel width = f_pix × cloud width; at f_pix < 1 the **Reflected** μ/BRF panels restrict to top-face exits inside the pixel (transmitted panels unaffected; disabled for Centered illumination; a sparse-statistics warning appears below ~2 counts/bin). **Deferred application**: the pixel is fixed per run, so editing the input never clears a finished run — the new value is marked *pending* in the stats panel and takes effect at the next Launch Ensemble/Reset; panels and exports always describe the value the run was accumulated with. The pixel **view** renders only under Obs geometry "cloud top/base faces only" — a planar pixel is well-posed on the flat top face only; under "top/base/side faces" the standard side-inclusive view shows instead, and toggling the dropdown swaps between the two without a re-run (the pixel accumulators fill regardless) | 1.00 (whole face) |
| HG asymmetry parameter (g) | Henyey-Greenstein asymmetry parameter (−1 to 1) | 0.85 |
| Single-scattering albedo (ω₀) | SSA (0 = fully absorbing, 1 = conservative) | 1.0 |
| Surface albedo (Aₛ) | Lambertian surface albedo (0 = black, 1 = non-absorbing) | 0.0 |
| Cloud β_ext (km⁻¹) | Volume extinction coefficient (used to set cloud-surface aspect ratio) | 10.0 |
| Cloud-base to surface (km) | Geometric gap thickness (used with β_ext to set cloud-surface aspect ratio) | 0.5 |
| Show entire-domain plots | Bottom-panel plots use the domain-wide (not cloud-element-only) population; Uniform domain only | off |
| Footprint grid size | number of cloud top/base grid elements | 28 |
| Show surface heatmap | Show/hide the brown surface-absorption heatmap (Aₛ>0, or Uniform domain illumination even at Aₛ=0); off also removes its render cost | on |
| Show R/T/A components | Expand R/T/A into their constituent populations (any illumination mode, see above) | off |
| Max paths drawn | Maximum photon paths rendered in 3D view | 250 |

**Other visualization buttons:** Endpoint caps shown, Fade older endpoints, Animate paths, Animation speed, Tail length, Scatter flashes, Launch One (single animated photon), Launch Ensemble, Pause/Resume, Step, Stop (v6.0.2 — hard-terminates the run; only Reset resumes), Reset, Reset View

**Bottom panel choices:** μ histograms, BDF polar plots, Optical path-length distributions

---

## File Structure

```
VISTA-C/
├── index.html          # HTML shell: importmap, CSS, panel layout
├── js/
│   ├── main.js         # Entry point: imports, window globals, startup
│   ├── state.js        # Shared mutable state and scene constants
│   ├── rng.js          # Mulberry32 deterministic RNG (seed = 42)
│   ├── coords.js       # Simulation ↔ Three.js world coordinate transforms
│   ├── physics.js      # Pure MC photon transport kernel (no DOM/stats deps)
│   ├── simstats.js     # Photon outcome statistics accumulation
│   ├── ui.js           # DOM input readers and limit-warning utility
│   ├── scene.js        # Three.js geometry builders and camera helpers
│   ├── photons.js      # Per-photon 3D rendering: paths, endpoints, animation
│   ├── bottomPanel.js  # Canvas plot drawing: μ histograms, BDF, path-length
│   ├── exportUtils.js  # PNG download and diagnostic header generation
│   └── runControl.js   # Simulation loop, init, run/ensemble/batch, scene reset
├── README.md
├── mc_export_reader.py    # Reads JSON exports → NumPy/xarray, optional NetCDF
└── tests/
    ├── DISORT comparisons/        # PythonicDISORT reference cases + MC-vs-DISORT scripts
    └── Illumination comparisons/  # pencil-vs-uniform illumination study
        ├── illumination_comparison.py            # 4×2 comparison figure (µ / path / BDF / BDF-polar)
        ├── *_illumination_test_theta0=*.json     # example MC exports (centered & uniform, Θ₀ = 0°/60°)
        └── illumination_comparison_test_theta0=*.png   # generated figures
```

**Module dependency order (leaf → root):**
```
state ← rng
state ← ui ← coords ← physics
state, ui ← simstats ← bottomPanel ← exportUtils
state, ui, coords, physics, simstats, scene, photons, bottomPanel, exportUtils ← runControl ← main
```

---

## Display updates during large runs

In the instant (non-animated) mode, photons are simulated in chunks of 1,000.
To keep large runs fast, the displays refresh on two schedules:

- **Endpoint markers** (3D exit-point spheres): updated every chunk
  (1,000 photons).
- **Footprint heatmaps, bottom-panel plots, and statistics text**: updated
  every 10 chunks (10,000 photons) and once at run completion.

The 3D view itself renders continuously — you can orbit, pan, and zoom at
any time during a run. Only the displayed data advances in chunk-sized
increments; for a 1M-photon run this means ~100 progress refreshes.

Endpoint markers are drawn as a single instanced mesh (one GPU draw call),
so large marker counts (up to the endpoint cap) do not slow down rendering
or simulation. 

Final results are identical regardless of update cadence:
all photons are tallied in the statistics as they are simulated; the
refresh schedule affects only when the displays redraw.

Note: Changing the user-specified Footprint grid size between runs clears the 2D exit-location histograms at cloud-top and cloud-base; re-run (e.g., "Launch Ensemble") to begin populating the 2D histogram bins at the new resolution.

---

## Data export and analysis

In addition to the two PNG buttons, **Download Data (JSON)** writes a single
self-describing file (`mc_cloud_rt_data_<timestamp>.json`) carrying the same
diagnostic content in machine-readable, full double precision (not the rounded
values shown in the PNG headers):

- **Run inputs** — τ, horizontal extent, Θ₀ (and μ₀), g, ω₀, Aₛ, β_ext,
  sub-cloud gap, the photon-illumination mode (`center` / `top` / `top_side`), and the RNG seed.
- **Outputs** — all outcome counts and normalized fluxes (R, T, A, S),
  with the R + T + A + S flux-closure sum.
- **µ histograms** — reflected and net-transmitted exit-angle vectors, with
  explicit bin edges and centers. Counts are **non-negative, terminal-event-only**
  (v6.0.1, review E3/E4): each photon contributes exactly one +1 tally, at the
  angle of its actual terminal exit/arrival ("reflected", or "transmitted"/
  "surface_absorbed" for the net-transmitted side) — surface reflections along
  the way are never binned. The bin totals equal the net (down − up) counts by
  construction; this replaced an earlier signed ±1 running-ledger scheme, so
  despite the name these are no longer "signed" values.
- **BDF** — raw, non-negative terminal-event bin weights (same one-tally-per-photon
  construction as the µ histograms above) *and* the normalized
  BDF = (W/N)·π/(µ·Δµ·Δφ) on a 19 (zenith) × 72 (azimuth) grid, with θ, φ, and
  µ coordinates. Exported **unsmoothed** (the display's near-nadir azimuthal
  averaging is a cosmetic only), so it is the ground truth for DISORT comparison.
- **Path-length histograms** — reflected and net-transmitted binned counts plus
  true means, reproducing the on-screen panel (24 bins, long tail in the
  overflow bin).

Every vector ships with its own coordinates, so the file is readable with no
knowledge of the simulator's internals.

### Python reader

`mc_export_reader.py` loads the JSON into NumPy arrays, prints a summary
(inputs, energy closure, peak/nadir BDF, consistency checks), and optionally
converts to a CF-style NetCDF for analysis:

```bash
python mc_export_reader.py mc_cloud_rt_data_<timestamp>.json
python mc_export_reader.py mc_cloud_rt_data_<timestamp>.json --netcdf run.nc
```

NetCDF output requires `xarray` and `netCDF4` (`pip install xarray netCDF4`);
without them the reader still prints the summary and skips the NetCDF step.
Programmatic use:

```python
from mc_export_reader import MCExport
exp = MCExport.load("run.json")
ds  = exp.to_xarray()          # labeled (theta, phi, mu, path) coordinates
print(exp.fluxes["R_reflected"])
```

Because the Mulberry32 RNG is deterministic, two runs at the same seed, photon
count, and horizontal extent reproduce these exports exactly — all photon
tallies are bit-identical across browsers and platforms (only the derived BDF
floats may differ at the ~10⁻¹⁵ machine-epsilon level from cross-engine
rounding in `acos`/`cos`). Note: this only holds starting from a fresh
**Launch Ensemble** or **Reset** — successive **Launch One** clicks draw new,
distinct photons from the *advancing* RNG stream and accumulate into the
running statistics, so an export taken after one or more Launch One clicks is
not reproducible from `rng_seed` alone (the stream has moved on from its
initial state by then).

### Comparison plots

`tests/Illumination comparisons/illumination_comparison.py` builds a 4×2 figure
comparing **two** JSON exports — rows for the µ histogram, optical path-length
distribution, BDF vs. zenith, and BDF polar heatmap; columns for reflected and
net-transmitted. The µ and path rows are area-normalized (flux/shape comparison)
while the BDF rows are absolute (radiance); see *Diagnostic plots: flux vs. Bidirectional Distribution Function (BDF)*
above. Edit the CONFIG block at the top of the script to point `FILE_A`/`FILE_B` at
any two exports (e.g. centered vs. uniform illumination, or two solar zenith angles),
then run it from that folder (`python illumination_comparison.py`). Requires NumPy +
matplotlib and `mc_export_reader.py` (repo root). The folder also holds the example
exports and the resulting Θ₀ = 0° / 60° figures.

---

## Verification

Two reference test cases confirm reproducibility. With RNG seed = 42:

| Test | τ | g | ω₀ | Aₛ | d (km) | Expected R | Expected T |
|---|---|---|---|---|---|---|---|
| A | 10 | 0.85 | 1.00 | 0.0 | — | ~0.321 | ~0.260¹ |
| B | 10 | 0.85 | 0.98 | 0.5 | 0.5 | ~0.321 | ~0.222² |

¹ Conservative (ω₀=1), black surface: T = direct cloud transmittance  
² Absorbing cloud, reflecting surface: T = net downward energy at surface

A full set of tests v. DISORT (PythonicDISORT, D. Ho 2024, JOSS) are detailed in the `tests/DISORT comparisons/` folder.

---

## Version History

See [CHANGELOG.md](CHANGELOG.md) for the full, dated change history, and the
[Releases](https://github.com/sepraca/VISTA-C/releases) page for
tagged versions.

Latest tagged release: **v6.0.3** (2026-07-14, patch release — bug fixes and internal
refactors only, no new capabilities). Headline fix: a sunward ground-illumination
asymmetry under Uniform domain illumination (open boundary) at large cloud optical
thickness and solar zenith angle, decoupling the launch-domain sunward margin from the
cloud's own optical thickness — see CHANGELOG.md's `[v6.0.3]` section and
[RELEASE_NOTES_v6.0.3.md](RELEASE_NOTES_v6.0.3.md) for the full history. **v6.0.2**
(also 2026-07-14) added Uniform domain illumination (direct clear-sky surface
illumination, selectable open/isolated or periodic domain boundary), the general-purpose
R/T/A component breakdown, and rigorous BRF/BTF normalization (Phase 4) — see
CHANGELOG.md's `[v6.0.2]` section. v6.0.3 is the version currently on `main` and in the
hosted demo.

---

## License

MIT License — see [LICENSE](LICENSE) for details.

---

## Development Notes

VISTA-C was developed using a combination of human-authored scientific design and AI-assisted software development tools (principally ChatGPT 5.4, Claude Opus 4.8). AI assistance was used for the JavaScript implementation, overall code refactoring, PythonicDISORT validation testing, and draft documentation. Development through **v6.0.2** (Phase 3: periodic domain boundary; Phase 4: rigorous BRF/BTF normalization) additionally used Claude Sonnet 5 for implementation and testing, with an independent code-review pass by Claude Fable 5. **v6.0.3** (bug-fix/refactor patch release, no new capabilities) continued this pattern: Claude Sonnet 5 for implementation, diagnosis, and testing, driven throughout by the project author's physical reasoning and verification.

The assessment of radiative transfer algorithms, physical assumptions and their implementation, scientific confidence checks/validation, and final review were performed
by the project author.

---

## Citation / Attribution

If you use this simulator in teaching or research, please cite as:

> Platnick, S. (2026). *VISTA-C: An Interactive 3D Monte Carlo Visualization of Cloud Radiative Transfer* (v6.0.3). GitHub. https://github.com/sepraca/VISTA-C
