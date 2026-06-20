# VISTA-C: An Interactive 3D Monte Carlo Visualization of Cloud Radiative Transfer

VISTA-C (Visualization of Interactive Stochastic Transport in Atmospheres–Clouds) is an interactive 3D Monte Carlo (MC) simulator of solar photon transport through a finite plane-parallel cloud layer.

The simulator combines physically based radiative transfer with real-time 3D visualization of individual photon trajectories. Current capabilities include Henyey-Greenstein scattering, Lambertian surface reflection, and user-selectable illumination and viewing geometries, allowing users to explore the influence of cloud optical properties and scene geometry on photon transport and radiative outcomes.

Originally developed as an intuitive educational tool for students, scientists, and engineers working in cloud remote sensing and atmospheric radiative transfer, VISTA-C has evolved to represent increasingly realistic three-dimensional radiative transfer scenarios. Nevertheless, the code remains primarily a visualization and educational platform and has only been numerically validated against PythonicDISORT for a limited set of plane-parallel benchmark cases (see the tests/ directory). 

---

## Live Demo

Open `index.html` via a local server (see [Running Locally](#running-locally) below).  
A hosted version is available at: https://sepraca.github.io/VISTA-C/

---

## Features

- **Reproducible MC statistics**: deterministic Mulberry32 RNG with fixed seed (42)
- **3D photon path visualization**: animated and static path rendering with colored crossing and endpoint markers by outcome
- **Henyey-Greenstein phase function**: exact inverse-CDF sampling for the scattering angle
- **Lambertian surface reflection**: configurable surface albedo Aₛ with geometric sub-cloud gap propagation
- **Finite-cloud illumination modes**: pencil-beam (centered) entry, or uniform illumination of the cloud top, optionally including the sunward side wall, to study 3D edge effects
- **Observation-geometry controls**: post-processing selection to aggregate statistics for photons exiting the cloud top/base faces only or also include cloud side photon exits
- **Surface-absorption heatmap** (Aₛ > 0): toggleable 2-D map of where photons are absorbed at the Lambertian surface, on a grid 2× the cloud extent to capture finite-cloud side leakage
- **Net normalized flux transmittance (surface absorption)**: correctly accounts for surface reflections: T = F↓ − F↑ at surface
- **Bottom panel plots**: μ = |cos Θ| exit-angle histograms, BDF polar plots (linear/log scale), optical path-length distributions
- **PNG plot export**: 3D view and bottom panel with diagnostic parameter headers
- **Quantitative data export (JSON)**: full-precision µ histograms, BDF arrays, path-length distributions, and run inputs/outputs for comparison against other codes (e.g. DISORT); a companion Python reader converts the JSON file to NetCDF
- **Fully modular ES module architecture**: 12 focused JavaScript files, no bundler required

---

## Physics Overview

Each photon is launched into the cloud at a user-specified solar zenith angle Θ₀. Free paths are sampled from an exponential distribution with extinction coefficient β_ext. Scattering directions are drawn from the analytic Henyey-Greenstein phase function via exact inverse-CDF sampling:

$$\cos\theta = \frac{1}{2g}\left[1 + g^2 - \left(\frac{1-g^2}{1-g+2g\xi}\right)^2\right]$$

At the cloud base, photons are propagated geometrically through a clear sub-cloud gap to a Lambertian surface with albedo Aₛ. Net normalized flux transmittance (surface absorption) is:

$$T_{\text{net}} = \frac{F_{\downarrow} - F_{\uparrow}}{N_{\text{launched}}}$$

where F↓ and F↑ are total downward and upward cloud-base flux crossings, respectively.

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

The centered launch draws no extra random numbers, so it leaves the RNG stream
unchanged; the uniform modes consume entry draws. Note that at Θ₀ = 0 the *top* and
*top + side* modes are statistically identical but **not** bit-identical — *top +
side* consumes one extra face-selection draw per photon, offsetting the stream, so
their integer counts differ at the ~1σ Monte Carlo level. The horizontal extent may
be set up to 500 optical depths to push the uniform modes toward the plane-parallel
limit.

### Observation geometry: exit photon aggregation choices

With the code's ability to simulate 3D radiative transfer, an unambiguous aggregation of exiting photon statistics is no longer possible. A finite cloud loses photons through its **sides** as well as its top and base. Whether those side exits should be counted depends on the observer's position and field of view. The **Observation geometry** control selects one of two self-consistent conventions, applied identically to the reflected and transmitted channels:

- **Cloud top/base faces only** *(default, "a")* — only photons whose final trajectory leaves through the cloud top or reaches the surface via the base are aggregated; every side-wall exit is counted separately and bookkept under S. This is appropriate for an observer (instrument) that can resolve the cloud top/base field of view.
- **Cloud top/base + sides ("b")** — final trajectory side-wall exits are included in the reflected and transmitted flux aggregations, i.e., upward side escapes are aggregated into R and downward escapes into T. Appropriate for an oblique viewing observer (e.g., satellite) that lacks the spatial resolution to distinguish the cloud top from cloud sides. Here S → 0 and the budget closes as R + T + A = 1.

This is a pure **post-processing choice**: it changes only how the accumulated
photon exit counts are aggregated, not the simulated trajectories. Switching the selection re-bins the current run instantly with no re-run. The two modes converge as the horizontal extent grows (side leakage → 0). The exported JSON records the active choice in `observation_geometry`. The 2-D footprint heatmaps are always top/base-plane
projections and are unaffected by this control.

Note that a single instrument (observer) can only sample a small part of the geometries given by these simulations. The full geometries are given so that the output can be filtered for a users specific use cases.

### Diagnostic plots: flux vs. Bidirectional Distribution Function (BDF)

The bottom-panel plots/diagnostics of the histograms and BDFs contain two physically distinct quantities, so their y-axes are not interchangeable:

- The **μ = |cos Θ| exit-angle histograms** and the **optical path-length
  distributions** are **flux (energy) distributions** with y-values equal to
  photon counts (∝ energy) per bin, i.e. the number of photons exiting in each
  μ or path-length interval.
- The **BDF** is a quantity proportional to **radiance**: BDF = (W/N)·π/(μ·Δμ·Δφ), which is normalized per unit projected solid angle. In particular, this introduces an explicit 1/μ factor relative to the photon count in the µ histograms.

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
- **Terminal endpoints**: surface-absorbed (brown) only when Aₛ > 0, cloud-absorbed
  (black), and side-escape (orange). Mid-trajectory surface *reflections* are
  shown separately as events (purple).

The **surface-absorption heatmap** (Aₛ > 0; toggle "Show surface heatmap") shows
where photons are absorbed at the surface. It uses a grid 2× the cloud extent to
capture surface absorption from cloud side leakage. Absorption beyond the surface
grid is clamped to the nearest boundary cell, each axis independently: a landing
past the grid in one axis goes to the nearest edge cell, and one past it in both
axes goes to a corner. The four corners therefore tend to be the brightest overflow
bins, since each collects an entire far-field corner region. This is geometry-independent, 
i.e., every physical landing is binned, regardless of the Observation geometry choice.

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
| Photons | Number of photons to simulate | 400 |
| Cloud optical thickness τ | Total cloud optical thickness (0.01-100) | 10 |
| Horizontal extent | Slab width in optical path units (2-500) | 40 |
| Incident zenith Θ₀ | Solar zenith angle (degrees) | 0 |
| Photon illumination | Cloud-top entry: Centered (point source), Uniform cloud top, Uniform cloud top + sunward side | Centered |
| Observation geometry | How exits are aggregated into R/T/S: cloud top/base faces only (a), or cloud top/base + sides (b) | Cloud top/base faces only |
| HG asymmetry parameter (g) | Henyey-Greenstein asymmetry parameter (−1 to 1) | 0.85 |
| Single-scattering albedo (ω₀) | SSA (0 = fully absorbing, 1 = conservative) | 1.0 |
| Surface albedo (Aₛ) | Lambertian surface albedo (0 = black, 1 = non-absorbing) | 0.0 |
| Cloud β_ext (km⁻¹) | Volume extinction coefficient (used to set cloud-surface aspect ratio) | 10.0 |
| Cloud-base to surface (km) | Geometric gap thickness (used with β_ext to set cloud-surface aspect ratio) | 0.5 |
| Footprint grid size | number of cloud top/base grid elements | 28 |
| Show surface heatmap | Show/hide the brown surface-absorption heatmap (Aₛ>0); off also removes its render cost | on |
| Max paths drawn | Maximum photon paths rendered in 3D view | 250 |

**Other visualization buttons:** Endpoint caps shown, Fade older endpoints, Animate paths, Animation speed, Tail length, Scatter flashes, Launch One (single animated photon), Launch Ensemble, Reset, Pause/Resume, Step

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
- **µ histograms** — reflected and net-transmitted (signed, down − up) exit-angle
  vectors with explicit bin edges and centers.
- **BDF** — raw signed bin weights *and* the normalized
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
rounding in `acos`/`cos`).

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

Latest: **v5.2.0** (2026-06-18).

---

## License

MIT License — see [LICENSE](LICENSE) for details.

---

## Development Notes

VISTA-C was developed using a combination of human-authored scientific design and AI-assisted software development tools (principally ChatGPT 5.4, Claude Opus 4.8). AI assistance was used for the JavaScript implementation, overall code refactoring, PythonicDISORT validation testing, and draft documentation.

The assessment of radiative transfer algorithms, physical assumptions and their implementation, scientific confidence checks/validation, and final review were performed
by the project author.

---

## Citation / Attribution

If you use this simulator in teaching or research, please cite as:

> Platnick, S. (2026). *VISTA-C: An Interactive 3D Monte Carlo Visualization of Cloud Radiative Transfer* (v5.2.0). GitHub. https://github.com/sepraca/VISTA-C

