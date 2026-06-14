# 3D Monte Carlo Cloud Radiative Transfer Simulator

An interactive 3D Monte Carlo (MC) simulation of photon transport through a finite plane-parallel cloud layer, with Henyey-Greenstein phase function scattering, optional Lambertian surface reflection, and real-time Three.js visualization.

Designed primarily as an educational tool for students and scientists working in cloud remote sensing and atmospheric radiative transfer, but numerically verified for scientific use.

---

## Live Demo

Open `index.html` via a local server (see [Running Locally](#running-locally) below).  
A hosted version is available at: https://sepraca.github.io/mc_cloud_rt_visualization/

---

## Features

- **Reproducible MC statistics** — deterministic Mulberry32 RNG with fixed seed (42)
- **3D photon path visualization** — animated and static path rendering with colored endpoints by outcome
- **Henyey-Greenstein phase function** — exact inverse-CDF sampling for the scattering angle
- **Lambertian surface reflection** — configurable surface albedo Aₛ with geometric sub-cloud gap propagation
- **Finite-cloud illumination modes** — pencil-beam (centered) entry, or uniform illumination of the cloud top, optionally including the sunward side wall, to study 3D edge effects
- **Net transmittance** — correctly accounts for multiple surface bounces: T = E↓ − E↑ at surface
- **Bottom panel plots** — μ = |cos Θ| exit-angle histograms, BDF polar plots (linear/log scale), optical path-length distributions
- **PNG export** — 3D view and bottom panel with diagnostic parameter headers
- **Quantitative data export (JSON)** — full-precision µ histograms, BDF arrays, path-length distributions, and run inputs/outputs for comparison against other codes (e.g. DISORT); a companion Python reader converts to NetCDF
- **Fully modular ES module architecture** — 12 focused JavaScript files, no bundler required

---

## Physics Overview

Each photon is launched from cloud top at a user-specified solar zenith angle Θ₀. Free paths are sampled from an exponential distribution with extinction coefficient β_ext. Scattering directions are drawn from the Henyey-Greenstein phase function via exact inverse-CDF sampling:

$$\cos\theta = \frac{1}{2g}\left[1 + g^2 - \left(\frac{1-g^2}{1-g+2g\xi}\right)^2\right]$$

At the cloud base, photons are propagated geometrically through a clear sub-cloud gap to a Lambertian surface with albedo Aₛ. Net surface transmittance is:

$$T_{\text{net}} = \frac{E_{\downarrow} - E_{\uparrow}}{N_{\text{launched}}}$$

where E↓ and E↑ are total downward and upward cloud-base crossings respectively.

Photon outcomes: **Reflected** (exits cloud top) | **Net transmitted** (absorbed at surface) | **Cloud absorbed** | **Side escape**

Conservation check: R + T + A + S = 1.0

### Photon entry: pencil vs. finite-cloud illumination

The **Photon entry** control sets where photons enter the cloud top:

- **Centered (point source)** *(default)* — every photon enters at (x, y) = (0, 0),
  the classic plane-parallel pencil-beam launch. This is the only mode guaranteed
  bit-reproducible against the seed-42 reference cases.
- **Uniform — cloud top** — entry points are drawn uniformly over the cloud-top
  face, simulating full illumination of a finite cloud. For a large horizontal
  extent this converges to the plane-parallel result; at finite extent it reveals
  3D edge leakage (photons launched near the edges escape out the sides), which
  the centered launch does not capture.
- **Uniform — cloud top + sunward side** — additionally illuminates the sunward
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

### Diagnostic plots: flux vs. radiance

The bottom-panel diagnostics are two physically distinct quantities, so their
y-axes are not interchangeable:

- The **μ = |cos Θ| exit-angle histograms** and the **optical path-length
  distributions** are **flux (energy) distributions** — their y-values are
  photon counts (∝ energy) per bin, i.e. the number of photons exiting in each
  μ or path-length interval.
- The **BDF** is a **radiance** quantity: BDF = (W/N)·π/(μ·Δμ·Δφ), normalized
  per unit projected solid angle, which introduces an explicit 1/μ factor
  relative to the photon count.

As a result the two are *consistent but not identical* representations of the
same exit-direction data. Azimuthally averaging the BDF and converting back to
the flux (count) density recovers the μ histogram exactly:

$$\frac{1}{N}\frac{dN}{d\mu} = 2\mu\,\overline{\text{BDF}}(\theta), \qquad \mu=\cos\theta$$

so the cos Θ enters as a multiplicative weighting of the y-axis (flux ↔ radiance),
not merely as an x-axis change of variable.

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
| Cloud optical thickness τ | Total cloud optical depth | 10 |
| Horizontal extent | Slab width in optical path units (range 2–500) | 40 |
| Incident zenith Θ₀ | Solar zenith angle (degrees) | 0 |
| Photon entry | Cloud-top entry: Centered (point source) / Uniform — cloud top / Uniform — cloud top + sunward side | Centered |
| HG asymmetry g | Henyey-Greenstein asymmetry parameter (−1 to 1) | 0.85 |
| Single-scattering albedo ω₀ | SSA (0 = fully absorbing, 1 = conservative) | 1.0 |
| Surface albedo Aₛ | Lambertian surface reflectance (0 = black, 1 = mirror) | 0.0 |
| Cloud β_ext (km⁻¹) | Volume extinction coefficient | 10.0 |
| Cloud-base to surface (km) | Geometric gap thickness | 0.5 |
| Max paths drawn | Maximum photon paths rendered in 3D view | 250 |

**Buttons:** Launch One (single animated photon) | Launch Ensemble | Reset | Pause/Resume | Step

**Bottom panel:** μ histograms | BDF polar plots | Optical path-length distributions

---

## File Structure

```
mc_cloud_rt_visualization/
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
  sub-cloud gap, the photon-entry mode (`center` / `top` / `top_side`), and the RNG seed.
- **Outputs** — all outcome counts and normalized fluxes (R, T_net, A, S, Aₛ_fc),
  with the R + T + A + S energy-closure sum.
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
print(exp.fluxes["R_top_reflected"])
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
while the BDF rows are absolute (radiance); see *Diagnostic plots: flux vs. radiance*
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

A full set of tests v. DISORT (PythonicDISORT, D. Ho 2024, Joss) are detailed in the `tests/DISORT comparisons/` folder.

---

## Version History

| Version | Description |
|---|---|
| v3.2 | Monolithic single-file implementation; surface geometry, export stats |
| v4.0 | Modular ES module architecture; physics/stats decoupling; corrected net transmittance (T = E↓ − E↑); consistent N counts across all displays |

---

## License

MIT License — see [LICENSE](LICENSE) for details.

---

## Citation / Attribution

If you use this simulator in teaching or research, please cite as:

> Platnick, S. (2026). *3D Monte Carlo Cloud Radiative Transfer Simulator* (v4.0). GitHub. https://github.com/sepraca/mc_cloud_rt_visualization
