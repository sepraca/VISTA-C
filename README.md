# VISTA-C: An Interactive 3D Monte Carlo Visualization of Cloud Radiative Transfer

VISTA-C (Visualization of Interactive Stochastic Transport in Atmospheres–Clouds) is an interactive 3D Monte Carlo (MC) simulator of solar photon transport through a finite plane-parallel cloud layer.

The simulator combines physically based radiative transfer with real-time 3D visualization of individual photon trajectories. Current capabilities include Henyey-Greenstein scattering plus tabulated liquid-droplet (Mie) and non-spherical ice-particle phase functions for MODIS and VIIRS cloud-retrieval bands, Lambertian surface reflection, and user-selectable illumination and viewing geometries, allowing users to explore the influence of cloud optical properties and scene geometry on photon transport and radiative outcomes.

Originally developed as an intuitive educational tool for students, scientists, and engineers working in cloud remote sensing and atmospheric radiative transfer, VISTA-C has evolved to represent increasingly realistic three-dimensional radiative transfer scenarios. Nevertheless, the code remains primarily a visualization and educational platform and has only been numerically validated against PythonicDISORT for a limited set of plane-parallel benchmark cases (see the tests/ directory). 

---

## Live Demo

Open `index.html` via a local server (see [Running Locally](#running-locally) below).  
A hosted version is available at: https://sepraca.github.io/VISTA-C/  
*(The hosted version tracks `main`, which is currently at the tagged **v6.3.1** release
— see Version History below. All tagged releases are available from the
[Releases](https://github.com/sepraca/VISTA-C/releases) page.)*

---

## Features

- **Reproducible MC statistics**: deterministic xoshiro128** RNG with fixed seed (42)
- **3D photon path visualization**: animated and static path rendering with colored crossing and endpoint markers by outcome
- **Three phase-function families**: analytic **Henyey-Greenstein**; tabulated **liquid water
  droplet** (Mie) and **ice particle** (Yang et al. 2013, non-spherical) phase functions for
  MODIS bands 1/2/6/7/20 and VIIRS M11, selectable by band and effective radius — all sampled
  by exact inverse-CDF inversion
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
- **Bottom panel plots**: μ = |cos Θ| exit-angle histograms, BRF/BTF polar plots (linear/log scale), optical path-length distributions — the polar plots are **bilinearly interpolated between bin centres** for display *(v6.3)*; see the note below
- **PNG plot export**: 3D view and bottom panel with diagnostic parameter headers
- **Quantitative data export (JSON)**: full-precision µ histograms, BDF arrays, path-length distributions, and run inputs/outputs for comparison against other codes (e.g. DISORT); a companion Python reader converts the JSON file to NetCDF
- **Fully modular ES module architecture**: 15 focused JavaScript files, no bundler required

---

## A note on reading the BRF/BTF polar plots

**The polar plots are smoothed for display; the exported JSON is not.** As of v6.3 the panel
interpolates bilinearly between bin centres rather than flat-shading each bin. This is
**cosmetic only** — it adds no information, and every number in the JSON export, in the PNG
header, and in every test gate comes from the raw unsmoothed 45 µ × 120 φ grid.

Two consequences worth knowing:

- **A feature you see in the plot may be smoother than the underlying bins.** If you are
  reading structure off the image quantitatively, use the exported `bdf` / `brf` arrays
  instead. `mc_export_reader.py` gives them to you directly.
- **Plots from v6.2 and earlier look different** for the same data — they were flat-shaded, so
  sharp features appeared as hard-edged annuli and, where a feature crossed the grid
  obliquely, as a beaded arc. Nothing about the physics changed between those images and
  these.

**Why interpolation was added.** The µ bins are uniform in µ, so Δθ = Δµ/sin θ **diverges at
nadir**: bin 0 spans θ = 0–12.1° while bin 44 spans 1.3°, and the φ bins near nadir subtend
only 0.45° of arc — a 27:1 anisotropy. A sharp scattering-angle feature (the liquid
**cloudbow**, Θs ≈ 138°) crossing that grid obliquely was rendered as a beaded chain. That is
display resolution, not a physics or sampling error — it is identical under both samplers,
absent for smooth Henyey-Greenstein at the same *g*, and vanishes at Θ₀ = 0° where the
feature's locus coincides with the bin rings. Interpolation makes the display stop advertising
the grid; it does not add resolution the run does not have.

---

## Physics Overview

Each photon is launched into the cloud at a user-specified solar zenith angle Θ₀. Free paths are sampled from an exponential distribution with extinction coefficient β_ext. Scattering directions are drawn from the analytic Henyey-Greenstein phase function via exact inverse-CDF sampling:

$$\cos\theta = \frac{1}{2g}\left[1 + g^2 - \left(\frac{1-g^2}{1-g+2g\xi}\right)^2\right]$$

### Phase functions: Henyey-Greenstein, liquid droplets, and ice particles

Henyey-Greenstein is the analytic default and remains available unchanged. VISTA-C also
ships **tabulated phase functions for real cloud particles**, selectable per spectral band
and effective radius, sampled from the table by inverse-CDF inversion (one random draw per
scattering, exactly as for HG). **As of v6.3 the draw is continuous within each table cell**:
node *i* stands for an interval of µ of width `wt[i]` centred on `xmu[i]`, and the sampler
returns a value from inside that interval rather than the node itself. Centring on the node
keeps the sampled ⟨µ⟩ equal to the tabulated asymmetry parameter *g* exactly. Returning node
values instead quantizes the scattering angle onto the table lattice, which aliased against the
BDF's µ bins and produced spurious rings — see CHANGELOG `[v6.3.0]`.

**Liquid water droplets.** Computed from Mie theory — the scattering formulation for
*spherical* particles — band-integrated over each instrument's spectral response function.
These are the phase functions used by the MODIS cloud optical and microphysical property
retrievals; see Platnick et al. (2017) below. Tabulated on 1000 Gauss-Legendre scattering
angles for effective radii 2–30 µm.

**Ice particles.** Necessarily *not* Mie calculations: ice crystals are non-spherical. These
come from the Yang et al. (2013) database (severely roughened aggregate columns, gamma size
distribution with variance 0.10), tabulated on 498 scattering angles spanning 0°–180°
exactly, for effective radii 5–60 µm. Because that grid is not a Gaussian quadrature and no
weights are distributed with it, VISTA-C constructs trapezoidal weights in µ; the resulting
sampling distribution reproduces the tabulated asymmetry parameter to ~1e-7, which is
gate-checked on every run of the test battery.

Selecting a tabulated phase function replaces the editable HG *g* and ω₀ inputs with the
read-only band-averaged values for that (band, r_eff), so the coupling is visible rather
than hidden. Reverting to HG restores the user's own inputs untouched.

#### Available bands

| Instrument / band | λ (µm) | Liquid droplets | Ice particles |
|---|---|---|---|
| MODIS 1 | 0.65 | ✓ | ✓ |
| MODIS 2 | 0.86 | ✓ | ✓ |
| MODIS 6 | 1.64 | ✓ | ✓ |
| MODIS 7 | 2.13 | ✓ | ✓ |
| **VIIRS M11** | **2.25** | ✓ | ✓ |
| MODIS 20 | 3.75 | ✓ | ✓ |

**Why VIIRS M11 is included even though MODIS band 7 is only 0.12 µm away.** The two are not
near-duplicates: band 7 lies on the long-wavelength wing of the ~1.9 µm liquid-water
absorption band, while M11 falls further into the relatively transparent window before
absorption climbs again toward ~3 µm. The imaginary part of the refractive index — and hence
the single-scattering co-albedo — is therefore materially larger at 2.13 µm than at 2.25 µm.
At r_eff = 10 µm the tabulated values are

| band | λ (µm) | 1 − ω₀ |
|---|---|---|
| MODIS 6 | 1.64 | 0.00761 |
| MODIS 7 | 2.13 | **0.02783** |
| VIIRS M11 | 2.25 | 0.01843 |
| MODIS 20 | 3.75 | 0.08796 |

M11 absorbs about a third less than band 7 at every radius, and it is the only
non-monotonic step in the sequence. Since absorption at these wavelengths is what drives the
effective-radius retrieval, M11 is a genuinely distinct band for both liquid and ice — which
is the reason it is offered separately rather than treated as a stand-in for band 7.

All tabulated phase functions use a consistent refractive-index dataset (265 K), matching the
MODIS/VIIRS continuity product (CLDPROP; Platnick et al. 2020) so that the MODIS and VIIRS
bands can be compared against one another on equal footing.

#### References for the tabulated phase functions

> Yang, P., et al. (2013). Spectrally consistent scattering, absorption, and polarization
> properties of atmospheric ice crystals at wavelengths from 0.2 to 100 µm. *Journal of the
> Atmospheric Sciences*, **70**(1), 330–347. — *ice particle phase functions*

> Platnick, S., Meyer, K. G., King, M. D., Wind, G., Amarasinghe, N., Marchant, B., Arnold,
> G. T., Zhang, Z., Hubanks, P. A., Holz, R. E., Yang, P., Ridgway, W. L., & Riedi, J.
> (2017). The MODIS cloud optical and microphysical products: Collection 6 updates and
> examples from Terra and Aqua. *IEEE Transactions on Geoscience and Remote Sensing*,
> **55**(1), 502–525. [doi:10.1109/TGRS.2016.2610522](https://doi.org/10.1109/TGRS.2016.2610522)
> — *liquid droplet phase functions*

> Platnick, S., et al. (2021). The NASA MODIS-VIIRS continuity cloud optical properties
> products. *Remote Sensing*, **13**(1), 2.
> [doi:10.3390/rs13010002](https://doi.org/10.3390/rs13010002) — *CLDPROP; the 265 K
> refractive-index basis used here*

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
  or **periodic**, tiled cloud field) governs what lies beyond the domain — see
  next.

  **The domain and the launch window, precisely** *(v6.0.5 ground-domain redesign — see
  [CHANGELOG](CHANGELOG.md))*: the accounting domain — what f_c = 1/M² refers to, what
  R_domain/T_domain normalize over, and what the ground plane and heatmaps display — is
  the M·W × M·W **ground cell centered on the cloud** (identical semantics for both
  boundary modes). Because launch happens at a fixed reference (cloud-top, τ=0) and the
  ground sits `τ_cloud + β_ext·d_sfc` optical depths below it, a clear-sky photon drifts
  sideways by s = (τ_cloud + β_ext·d_sfc)·tanΘ₀ before landing. Under the **open**
  boundary the TOA launch window is therefore the domain's exact *preimage* under the
  slant beam: the same M·W × M·W square **translated upwind by s** (a pure shift, not a
  widening). Window area = domain area, so every launch maps 1:1 to a domain ground
  point, **f_c = 1/M² is exact by construction**, and the cloud shadows exactly what it
  physically shadows regardless of τ_cloud. The single condition **M ≥ M_min =
  1 + 2·s/W** then guarantees at once that the shifted window still fully lights the
  cloud's top face, that the sunward-wall reservoir strip is captured, and that the
  cloud's complete ground shadow fits inside the domain. Practically:
  **open-boundary uniform_domain runs auto-raise M to M_min** (rounded up to 2
  decimals) with a note when this happens; the live `#domainMarginWarning` banner
  previews it before you run. The **periodic** boundary needs no shift and no M_min —
  wraparound supplies sunward illumination from the neighboring tile image at any
  M ≥ 1 (M = 1 is the plane-parallel limit), and a transient note in the same banner
  says so when you type an M below the open-boundary minimum.

#### Domain boundary: open/isolated vs. periodic (v6.0.2)

The **open/isolated** boundary treats the far clear sky beyond the launch window as
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

**See also**: [`docs/illumination-observation-geometry.pdf`](docs/illumination-observation-geometry.pdf) — a
graphical reference table cross-referencing every Illumination-geometry × Observation-geometry
combination (which panel/control is available vs. N/A under each, and how Final Outcome vs.
Radiative Components each relate to the Observation-geometry dropdown), verified cell-by-cell
against this codebase (2026-07-18).

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
  of the cloud base. Here, the markers show **each** downward crossings, e.g., a trajectory where a surface reflected photon re-enters the cloud and scatters back towards the surface again (or multiple times). The marker numbers are 1:1 with the green *downward cloud-base crossings 2D footprint* heat map up to the number indicated in the "Endpoint caps shown" selection. For Aₛ = 0, each transmitted photon crosses the cloud base only once, so a crossing coincides with a photon's termination.
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
| Photons | Number of photons to simulate (max 10⁸; see **Fast mode** below for large runs) | 10000 |
| Cloud optical thickness τ | Total cloud optical thickness (0.01-100) | 10 |
| Horizontal extent | Slab width in optical path units (2-500) | 40 |
| Incident zenith Θ₀ | Solar zenith angle (degrees) | 0 |
| Photon illumination | Cloud-top entry: Centered (point source), Uniform cloud top, Uniform cloud top + sunward side, Uniform domain (v6.0.2, see above) | Centered |
| Domain factor M | Domain width = M × cloud width; shown only for Uniform domain illumination. Open boundary: auto-raised at run time to M_min = 1 + 2·(τ_cloud + β_ext·d_sfc)·tanΘ₀/W, the minimum for the upwind-shifted launch window to fully light the cloud top and contain its ground shadow (v6.0.5 ground-domain redesign, see above and [CHANGELOG](CHANGELOG.md)); periodic boundary: any M ≥ 1 valid | 4 |
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
| Fast mode (large runs) | Suppress live display during a run — no 3D histogram rebuilds, bottom-panel redraws, or stats updates — showing only a photon counter (0.1M resolution) in the 3D view, then refreshing everything once at the end. Physics and statistics are untouched: a fast-mode run is bit-identical to the same run with it off. Recommended above ~1M photons (v6.0.6) | off |

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
│   ├── constants.js    # Frozen string-literal enums shared across modules
│   ├── rng.js          # xoshiro128** deterministic RNG (seed = 42)
│   ├── coords.js       # Simulation ↔ Three.js world coordinate transforms
│   ├── physics.js      # Pure MC photon transport kernel (no DOM/stats deps)
│   ├── simstats.js     # Photon outcome statistics accumulation (+ combiners)
│   ├── statsPanel.js   # Left-panel stats text presentation (DOM/HTML only)
│   ├── ui.js           # DOM input readers and limit-warning utility
│   ├── scene.js        # Three.js geometry builders and camera helpers
│   ├── photons.js      # Per-photon 3D rendering: paths, endpoints, animation
│   ├── bottomPanel.js  # Canvas plot drawing: μ histograms, BDF, path-length
│   ├── exportUtils.js  # PNG download and diagnostic header generation
│   ├── phase.js        # Tabulated phase-function loader: per-family grids, CDF cache
│   └── runControl.js   # Simulation loop, init, run/ensemble/batch, scene reset
├── data/
│   └── phase/          # Tabulated phase-function assets (v6.2, 265 K CLDPROP basis)
│       ├── grid_liquid.json      # 1000-node Gauss-Legendre µ grid + quadrature weights
│       ├── grid_ice.json         # 498-node trapezoidal µ grid + weights
│       ├── liquid_modis_b{1,2,6,7,20}.json,  liquid_viirs_M11.json
│       ├── ice_modis_b{1,2,6,7,20}.json,     ice_viirs_M11.json
│       └── manifest.json         # per-instrument provenance of the source HDF4 files
├── tools/
│   ├── phase_convert.py   # HDF4 → JSON converter for the phase-function assets
│   └── inspect_hdf4.py    # Structure dump (SDs, Vgroups, attributes) for the sources
├── docs/
│   └── illumination-observation-geometry.pdf
├── README.md
├── CHANGELOG.md
├── CITATION.cff
├── mc_export_reader.py    # Reads JSON exports → NumPy/xarray, optional NetCDF
└── tests/
    ├── run_all.mjs                # one-command runner for the full suite (11 gates)
    ├── review-harness/            # correctness gates (physics, RNG, assets, BRF/BTF)
    │   ├── verify_rng.mjs           # xoshiro128** integrity + sub-stream independence
    │   ├── verify_phase_assets.mjs  # Σw·pf = 1, g = Σw·pf·µ, ⟨µ⟩ from CDF = g
    │   ├── verify_phase3/4.mjs      # periodic boundary; rigorous BRF/BTF normalization
    │   └── ...
    ├── golden-snapshots/          # locked regression baselines + drift gates
    ├── DISORT comparisons/
    │   └── modis-viirs/           # C5: VISTA-C vs PythonicDISORT, liquid + ice
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
state ← phase
state, ui, coords, physics, simstats, scene, photons, bottomPanel, exportUtils, phase ← runControl ← main
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

Because the xoshiro128** RNG is deterministic, two runs at the same seed, photon
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

A full set of tests v. DISORT (PythonicDISORT, D. Ho 2024, JOSS) are detailed in
`tests/DISORT comparisons/modis-viirs/`, covering both tabulated particle families.

That folder's README also records a methodological trap worth reading before re-tuning any
reference-solution parameters: the DISORT stream/moment settings were once chosen by
minimizing χ² against VISTA-C, which silently selected a **ringing** solution. Agreement with
the code under test has no resolving power below its own noise floor, so the reference must be
converged against *itself* first, and only then compared.

---

## Version History

See [CHANGELOG.md](CHANGELOG.md) for the full, dated change history, and the
[Releases](https://github.com/sepraca/VISTA-C/releases) page for
tagged versions.

Latest tagged release: **v6.3.1** (2026-08-11, interface and provenance patch — no physics
change; every count and exported array is bit-identical to v6.3.0). `js/constants.js` now
exports `APP_VERSION` as the single source of truth for the version: it is rendered in the app
header, stamped into the JSON export (`app_version`) and the PNG header, and gated by
`verify_version.mjs` against CHANGELOG, README and CITATION.cff. Previously the version lived
only in prose, which is how CITATION.cff came to sit at 6.0.7 through two releases. Also fixed:
the HG phase-function plot not redrawing when *g* is edited; the bottom panel now defaults to
the phase-function plot (populated at startup rather than blank); and the band-averaged *g*
readout shows 4 decimals. See CHANGELOG.md's `[v6.3.1]` section.

Previous release: **v6.3.0** (2026-08-11, continuous phase-function sampling).
Tabulated (liquid and ice) phase functions are now sampled **continuously within each table
cell** rather than snapped to node values. Node *i* represents a cell of µ of width `wt[i]`
centred on `xmu[i]`; drawing from within that cell removes an angular-quantization artifact
that produced **period-3 rings** in the ice BDF reaching **±37σ** at 50 M photons (radial ring
residual 18.23 → 1.25). Centring the cell on its node keeps ⟨µ⟩ = g **exactly**, for any grid
and any weights, so one code path serves the Gauss-Legendre liquid grid and the trapezoidal ice
grid alike. Cost ≈ **+2.7 % run time**; pre-refining the table instead was measured and rejected
(3.3× more expensive). **Henyey-Greenstein is bit-identical**; all tabulated results change.
C5 ice pooled n_σ² improved 1.47/1.20/1.21/1.27/1.48 → **1.02/1.06/0.92/1.03/1.05**. See
CHANGELOG.md's `[v6.3.0]` section.

Previous release: **v6.2.0** (2026-08-09, ice particle phase functions and VIIRS M11).
VISTA-C now offers three phase-function families: analytic Henyey-Greenstein, tabulated
**liquid water droplet** (Mie) and tabulated **non-spherical ice particle** (Yang et al. 2013,
severely roughened aggregate columns) — the latter two for MODIS bands 1/2/6/7/20 and
**VIIRS M11**, selectable by band and effective radius. All tables now share one refractive
index basis (265 K, the CLDPROP MODIS/VIIRS continuity basis) so the two instruments are
directly comparable; the liquid tables consequently changed from the previous 300 K set, which
moves results for the absorbing bands (MODIS b7 absorption +12.5 %) while leaving the
non-absorbing bands statistically identical and Henyey-Greenstein bit-identical. Export schema
1.7 renames `phase_function.type` "mie" → "liquid"/"ice" (breaking). C5 DISORT validation now
covers **both particle families** and passes: fluxes to 0.000–0.06 %, pooled n_σ²
1.00 / 1.14 / 1.05 (liquid, bands 2/6/7) and 1.47 / 1.20 / 1.21 / 1.27 / 1.48 (ice, bands
1/2/6/7/20, including both exactly-conservative bands). See CHANGELOG.md's `[v6.2.0]` section.
*(These n_σ² values were superseded by v6.3.0 — see above.)*

Previous release: **v6.1.0** (2026-07-29, random-number generator replacement —
**every stochastic result changed**, though no physics did). Mulberry32 was retired for
xoshiro128\*\*: its 32-bit state exhausted its 2³² period after only ~52 M photons at τ=10
(a photon consumes ~83 draws), below the app's own 100 M cap, and because its state is a
counter its "different seeds" are phases of one cycle that overlap silently — measured
ρ ≈ 0.32 between chunks that were supposed to be independent. xoshiro128\*\* has a 2¹²⁸
period (~4×10³⁶ photons at τ=10), genuinely independent sub-streams via `RNG.jump()`, and is
~20 % faster. Export schema 1.6 records `inputs.rng = {name, seed}`, since a seed alone no
longer identifies a stream. Skipping the absorption draw at ω₀ = 1 cut draws/photon 25 %.
All goldens, all 26 illumination-comparison exports, all 18 figures and the C5 DISORT
validation were regenerated; C5 agreement is marginally better than before (R and T to
0.006–0.05 %, pooled n_σ² 1.06 / 1.02 / 0.83). See CHANGELOG.md's `[v6.1.0]` section.

Previous release: **v6.0.7** (2026-07-20, performance and hygiene patch completing
the 2026-07-19 code review — no physics or statistics changes; every count, mean, and
exported histogram bin is bit-identical to v6.0.6). The per-photon path-length arrays
(1.27 entries/photon, 200+ MB at 20M photons) are replaced by **fixed 4.2 MB streaming
histograms**, independent of photon count, with bit-identical output: display refreshes
that re-binned the full history in 17.6 ms now take 0.02 ms. Short runs regained their
progressive on-screen build-up (a purely wall-clock slice budget had collapsed a 10k
run into a single flash), a run-time readout was added to the stats panel, and
allocation micro-fixes in the transport kernel lifted periodic-boundary throughput ~7%.
See CHANGELOG.md's `[v6.0.7]` section and the
[v6.0.7 release notes](https://github.com/sepraca/VISTA-C/releases/tag/v6.0.7).

**v6.0.6** (2026-07-20, performance patch — no physics or
statistics changes; every count is bit-identical to v6.0.5). The instant-batch run loop
is now time-budgeted rather than fixed-chunk (browsers clamp nested zero-delay timers to
~4 ms, so most of a large run's wall time was spent waiting on the scheduler rather than
simulating), display refreshes use a split cadence (stats text every slice, heavy
rebuilds wall-clock gated), the endpoint instanced-mesh sync moved off the per-slice
path, and a new **Fast mode (large runs)** checkbox suppresses live display entirely in
favor of a photon counter, refreshing once at the end. Measured on an M4 laptop
(top_side, Aₛ=0.5, Θ₀=60°, τ=10, W=40): **5M photons 43 s → 9 s**; **20M photons ~3 min
→ 28 s normal, 22 s fast (~8×)**. The photon-count cap is raised 10M → 100M. See
CHANGELOG.md's `[v6.0.6]` section and the
[v6.0.6 release notes](https://github.com/sepraca/VISTA-C/releases/tag/v6.0.6).

**v6.0.5** (2026-07-19). Headline items, from a full code/physics
review of the post-Phase-3/4 state: the **ground-domain redesign** of open-boundary
Uniform-domain illumination (the launch window is now a pure upwind *shift* of the
cloud-centered M·W domain rather than a sunward *extension*, making f_c = 1/M² and the
domain-mean normalizations exact by construction and re-centering the rendered
domain/heatmaps on the cloud; export schema 1.4; open-boundary Θ₀>0 uniform-domain
results are not numerically comparable to earlier versions); a **plane-parallel-limit
physics fix** (at M = 1 periodic, wrapped photons landing exactly on the cloud wall
tunneled through the box as clear air — M = 1 periodic now matches the wide-cloud
plane-parallel proxy to ~10⁻⁴ in R and is locked by new gates); analytic
launch-fraction gates; Node-version-robust golden checkers; and a set of rendering/
performance items (instanced surface-interaction markers, per-photon DOM reads and
per-vertex panel redraws removed from hot paths, periodic display wrap extended to y).
See CHANGELOG.md's `[v6.0.5]` section and the
[v6.0.5 release notes](https://github.com/sepraca/VISTA-C/releases/tag/v6.0.5).
Recent history: **v6.0.4** (2026-07-18) — UI/rendering and legend/labeling fixes;
**v6.0.3** (2026-07-14) — sunward ground-illumination asymmetry fix (superseded by the
v6.0.5 redesign); **v6.0.2** (2026-07-14) — Uniform domain illumination with
open/periodic boundary, R/T/A component breakdown, rigorous BRF/BTF (Phase 4).
v6.3.1 is the version currently on `main` and in the hosted demo.

---

## License

MIT License — see [LICENSE](LICENSE) for details.

---

## Development Notes

VISTA-C was developed using a combination of human-authored scientific design and AI-assisted software development tools (principally ChatGPT 5.4, Claude Opus 4.8). AI assistance was used for the JavaScript implementation, overall code refactoring, PythonicDISORT validation testing, and draft documentation. Development through **v6.0.2** (Phase 3: periodic domain boundary; Phase 4: rigorous BRF/BTF normalization) additionally used Claude Sonnet 5 for implementation and testing, with an independent code-review pass by Claude Fable 5. **v6.0.3** (bug-fix/refactor patch release, no new capabilities) continued this pattern: Claude Sonnet 5 for implementation, diagnosis, and testing, driven throughout by the project author's physical reasoning and verification. **v6.0.5** originated from a second independent code/physics review pass by Claude Fable 5, which also implemented the resulting fixes and the ground-domain redesign; the redesign itself, and all physical-consistency judgments, were decided by the project author. **v6.0.6** (performance patch) followed the same pattern: Claude Fable 5 for the run-loop profiling, implementation, and regression gates, with the fast-mode concept, the design decisions, and all browser timing measurements provided by the project author. **v6.0.7** completed that review's remaining performance and hygiene items on the same basis. **v6.1.0** (random-number generator replacement) followed the same pattern: Claude Fable 5 diagnosed the period-exhaustion and seed-correlation defects, implemented the xoshiro128** swap and the verification gates, and regenerated every stochastic artifact; the decision to pin down the underlying micro-mechanism rather than assume it, the choice of diagnostic tests, and all acceptance judgments were the project author's. **v6.2.0** (ice phase functions, VIIRS M11) continued in the same way: Claude Fable 5 wrote the HDF4→JSON converter, the two-family kernel/UI wiring, the schema-1.7 migration and the asset gates, and re-ran the DISORT validation. The scientific decisions were the project author's throughout — identifying that "Mie" was the wrong term once non-spherical ice was in scope, choosing the 265 K CLDPROP basis for MODIS/VIIRS consistency, supplying the spectral-absorption rationale for M11, catching an incorrect g calculation by checking it independently, and rejecting a DISORT stream/moment configuration that had been selected by a chi-squared criterion but produced visibly ringing radiance profiles — a correction that identified Legendre aliasing off the finite ice angular grid and established that a reference solution must be converged against itself rather than tuned to agree with the code under test.

The assessment of radiative transfer algorithms, physical assumptions and their implementation, scientific confidence checks/validation, and final review were performed
by the project author.

---

## Citation / Attribution

If you use this simulator in teaching or research, please cite as:

> Platnick, S. (2026). *VISTA-C: An Interactive 3D Monte Carlo Visualization of Cloud Radiative Transfer* (v6.3.1). GitHub. https://github.com/sepraca/VISTA-C
pl