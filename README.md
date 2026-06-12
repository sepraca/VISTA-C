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
- **Net transmittance** — correctly accounts for multiple surface bounces: T = E↓ − E↑ at surface
- **Bottom panel plots** — μ = |cos Θ| exit-angle histograms, BDF polar plots (linear/log scale), optical path-length distributions
- **PNG export** — 3D view and bottom panel with diagnostic parameter headers
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
| Horizontal extent | Slab half-width in optical path units | 40 |
| Incident zenith Θ₀ | Solar zenith angle (degrees) | 0 |
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
└── README.md
```

**Module dependency order (leaf → root):**
```
state ← rng
state ← ui ← coords ← physics
state, ui ← simstats ← bottomPanel ← exportUtils
state, ui, coords, physics, simstats, scene, photons, bottomPanel, exportUtils ← runControl ← main
```

---

## Verification

Two reference test cases confirm reproducibility. With RNG seed = 42:

| Test | τ | g | ω₀ | Aₛ | d (km) | Expected R | Expected T |
|---|---|---|---|---|---|---|---|
| A | 10 | 0.85 | 1.00 | 0.0 | — | ~0.321 | ~0.260¹ |
| B | 10 | 0.85 | 0.98 | 0.5 | 0.5 | ~0.321 | ~0.222² |

¹ Conservative (ω₀=1), black surface: T = direct cloud transmittance  
² Absorbing cloud, reflecting surface: T = net downward energy at surface

A full set of tests v. DISORT (PythonicDISORT, D. Ho 2024, Joss) are detailed in the tests folder.

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
