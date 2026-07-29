# C5 — VISTA-C Mie transport validated against PythonicDISORT

**Status: PASS.** Fluxes agree to 0.03–0.13 %; directional BDF agrees at Monte Carlo noise.

> ⚠ **NUMBERS WILL BE REFRESHED.** These runs use the mulberry32 RNG. The planned
> xoshiro128\*\* replacement (TODO §R) changes the random stream by design, so every number
> here moves within Monte Carlo noise and this document must be regenerated. The *method*
> and the *conclusions* are expected to stand. See "Known limits" below.

---

## What is being tested

Two completely independent solution methods, given the **same tabulated Mie phase
function**, must agree:

| | VISTA-C | PythonicDISORT |
|---|---|---|
| method | stochastic photon transport (3-D box) | discrete ordinates (plane-parallel) |
| phase function | sampled directly from the table by discrete-node CDF inversion | 128 Legendre moments projected from the same table |
| geometry | finite slab, W = 500 τ-units, centered pencil beam | infinite plane-parallel layer |

Agreement therefore exercises the µ-space CDF construction, the sampling kernel, the
transport, and the flux/BDF bookkeeping simultaneously.

**Case:** τ = 10, Θ₀ = 30°, Aₛ = 0, r_eff = 10 µm, MODIS bands 2 / 6 / 7,
20 M photons per band (single contiguous run, seed 42).

## Results

### Fluxes (R / T / A)

| band | λ (µm) | ω₀ | | VISTA-C | DISORT | rel. diff |
|---|---|---|---|---|---|---|
| 2 | 0.86 | 0.99995 | R | 0.454080 | 0.454162 | 0.018 % |
| | | | T | 0.544898 | 0.544819 | 0.015 % |
| | | | A | 0.001023 | 0.001019 | 0.4 % |
| 6 | 1.64 | 0.99393 | R | 0.426606 | 0.426660 | 0.013 % |
| | | | T | 0.459734 | 0.459810 | 0.017 % |
| | | | A | 0.113660 | 0.113530 | 0.11 % |
| 7 | 2.13 | 0.97634 | R | 0.321202 | 0.321385 | 0.057 % |
| | | | T | 0.329079 | 0.328864 | 0.065 % |
| | | | A | 0.349719 | 0.349750 | 0.009 % |

R + T + A = 1.000000 exactly on both sides, all three bands. Absorption spans a factor of
~340 across the three bands (0.001 → 0.350) and both codes track it.

### Directional BDF, principal plane

Pooled over 7 azimuths × 45 µ bins, reduced χ² of (VISTA-C − DISORT)/σ_MC:

| band | pooled n_σ² | interpretation |
|---|---|---|
| 2 | **1.07** | agreement at Monte Carlo noise |
| 6 | **1.05** | agreement at Monte Carlo noise |
| 7 | **1.15** | agreement at Monte Carlo noise |

`C5_mie_principal_plane_b2_b6_b7.png` shows φ = 0° and φ = 180° cuts. Both Mie features
appear in the antisolar row and are tracked by both codes:
**glory at θ ≈ 30°** (Θs = 180°, since θ = Θ₀) and **cloudbow at θ ≈ 68°** (Θs ≈ 142°).
Neither is expressible by Henyey-Greenstein at any g.

## Method notes (the parts that are easy to get wrong)

**Legendre projection.** The tables satisfy Σ wt·pf = 1 with Σ wt = 2 (so ∫p dµ = 1) and
Σ wt·pf·µ = g. DISORT wants "unweighted" coefficients β_l with β₀ = 1, β₁ = g, which is

    β_l = Σ_i wt_i · pf_i · P_l(µ_i)

evaluated on the table's own 1000-point Gauss–Legendre µ grid — i.e. the projection uses
exactly the quadrature the table was built on. **Verified**: β₀ = 1.00000002 and
β₁ = 0.86180134 against the tabulated g = 0.861800 (1.3 × 10⁻⁶).

**delta-M is inert at the NLeg these tables need.** The truncation fraction is f = β_NLeg,
and the moments decay β₃₂ = 0.386 → β₁₂₈ = 0.111 → β₂₅₆ = 0.006 → β₅₁₂ ≈ −1 × 10⁻⁵. At
NLeg = 32 delta-M shifts R by 1.3 × 10⁻⁴; by NLeg = 128 with/without agree to 5 decimals.
Note β goes slightly **negative** at high l, so f must be clamped to ≥ 0 — DISORT rejects
f < 0 outright (this is why NQuad = 512 fails without the clamp).

**Comparing a Gauss-node radiance to uniform-µ MC bins.** VISTA-C's BDF estimator is
π·(W/N)/(µ_c·Δµ·Δφ) with µ_c the bin's µ *midpoint*. The DISORT side is therefore
integrated the same way — π·∫L·µ dµ over the bin, divided by µ_c·Δµ — using PCHIP
interpolation of the radiance across the upward Gauss nodes, and averaging 9 samples across
each 3° φ bin. Verified insensitive to NQuad (128 → 512), NLeg (255 → 599), NFourier
(32 → 255) and the integration granularity.

**Conventions confirmed, not assumed.** +µ is upward in PythonicDISORT, and φ − φ₀ = 180°
is backscatter (Θs = 179.3° at µ = µ₀) — matching VISTA-C's φ = 180° antisolar direction.

## Known limits and caveats

**Band 1 (ω₀ = 1) is ill-conditioned in DISORT and is deliberately excluded.** With
conservative scattering the albedo does not converge with stream count: R = 0.446569 /
0.446566 / 0.445499 / 0.448112 / 0.449507 at NQuad = 64 / 128 / 256 / 384 / 512 — a 0.9 %
spread with no convergence, and PythonicDISORT warns about it. Band 2 (ω₀ = 0.99995) is
physically almost identical but ~36× better conditioned (spread 4.5 × 10⁻⁷), and is the
recommended near-conservative reference case.

**`NT_cor` (Nakajima–Tanaka) must not be used at low NLeg with these tables.** At NLeg = 128
it produced clearly wrong radiances (BRF 0.069 vs 0.479) because it reconstructs the
single-scattering term from the same truncated moments that misrepresent p there.

**Photon-count ceiling (mulberry32 only).** At τ = 10 a photon consumes ~83 random draws, so
the 2³² period is exhausted at **~52 M photons** — below the app's own 100 M cap. Runs above
that repeat trajectories and stop improving. **All runs here are 20 M contiguous (38 % of
the period), well inside the limit.** Do not "improve" these results by naively raising N or
by summing seed-offset chunks: offset seeds in mulberry32 are phases of ONE cycle and
overlap silently (measured ρ ≈ 0.32 for 600 M-draw offsets against 1.65 × 10⁹ draws
consumed), which inflates the variance of the sum as 1 + (k−1)ρ and manufactures a spurious
~2 % "residual". TODO §R removes this entirely.

## Files

| file | purpose |
|---|---|
| `legendre_moments.py` | project the tabulated phase function onto Legendre moments; writes `beta_b<N>_r10.npy` |
| `vistac_run.mjs` | run VISTA-C headlessly, accumulate the 45 µ × 120 φ reflected grid |
| `disort_vs_vistac.py` | run PythonicDISORT, bin-match, compare, plot |
| `C5_results.json` | the R/T/A + n_σ² table above, machine-readable |
| `C5_mie_principal_plane_b2_b6_b7.png` | the figure |

Requires `PythonicDISORT`, `numpy`, `scipy`, `matplotlib`.
