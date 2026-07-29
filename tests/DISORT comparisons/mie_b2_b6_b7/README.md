# C5 — VISTA-C Mie transport validated against PythonicDISORT

**Status: PASS.** Fluxes agree to 0.006–0.05 % in R and T; directional BDF agrees at Monte
Carlo noise.

> **Refreshed 2026-07-29 for the xoshiro128\*\* RNG (TODO §R).** The generator swap changed
> the random stream by design, so every number below was re-measured. The method and the
> conclusions stand, and agreement is marginally *better* than the mulberry32 run
> (pooled n_σ² was 1.07 / 1.05 / 1.15, now 1.06 / 1.02 / 0.83). The photon-count ceiling
> caveat is now **obsolete** — see "Known limits".

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
20 M photons per band (single contiguous run, xoshiro128** seed 42).

## Results

### Fluxes (R / T / A)

| band | λ (µm) | ω₀ | | VISTA-C | DISORT | rel. diff |
|---|---|---|---|---|---|---|
| 2 | 0.86 | 0.99995 | R | 0.454131 | 0.454162 | 0.007 % |
| | | | T | 0.544859 | 0.544819 | 0.007 % |
| | | | A | 0.001010 | 0.001019 | 0.86 % |
| 6 | 1.64 | 0.99393 | R | 0.426634 | 0.426660 | 0.006 % |
| | | | T | 0.459866 | 0.459810 | 0.012 % |
| | | | A | 0.113500 | 0.113530 | 0.027 % |
| 7 | 2.13 | 0.97634 | R | 0.321538 | 0.321385 | 0.048 % |
| | | | T | 0.328942 | 0.328864 | 0.023 % |
| | | | A | 0.349520 | 0.349750 | 0.066 % |

R + T + A = 1.000000 exactly on both sides, all three bands. Absorption spans a factor of
~340 across the three bands (0.001 → 0.350) and both codes track it.

### Directional BDF, principal plane

Pooled over 7 azimuths × 45 µ bins, reduced χ² of (VISTA-C − DISORT)/σ_MC:

| band | φ=0° | φ=180° | pooled n_σ² | ΔR/σ_MC | interpretation |
|---|---|---|---|---|---|
| 2 | 1.31 | 0.62 | **1.06** | −0.3 | agreement at Monte Carlo noise |
| 6 | 0.96 | 0.76 | **1.02** | −0.2 | agreement at Monte Carlo noise |
| 7 | 0.98 | 0.85 | **0.83** | +1.5 | agreement at Monte Carlo noise |

`C5_mie_principal_plane_b2_b6_b7.png` shows φ = 0° and φ = 180° cuts. Both Mie features
appear in the antisolar row and are tracked by both codes:
**glory at θ ≈ 30°** (Θs = 180°, since θ = Θ₀) and **cloudbow at θ ≈ 68°** (Θs ≈ 142°).
Neither is expressible by Henyey-Greenstein at any g.

### High-N confirmation (100 M photons) — the bias test

20 M agreement is weak evidence on its own: a systematic smaller than σ_MC is invisible.
Raising N to 100 M shrinks σ_MC by √5, making any **fixed** bias 5× more significant in n_σ².
So n_σ² staying ≈1 is the result that matters; n_σ² climbing toward 5 would mean 20 M was
simply too noisy to see a real error. This is also how the mulberry32 defects were caught —
past its ~52 M-photon period, added photons carried no new information and the noise stopped
falling as 1/√N.

Run as 5 × 20 M `RNG.jump()` sub-streams (`vistac_run_chunk.mjs`, analysed by
`c5_highN_check.py`).

> **20 M is not a limit — it is an artifact of how these runs were executed.** The chunking
> exists only because the automation driving this comparison caps a single command at ~45 s,
> while a contiguous 100 M-photon band takes ~165 s in Node. **Run 100 M contiguously if you
> can**; nothing in VISTA-C or in xoshiro128\*\* discourages it. The period is 2¹²⁸ ≈ 3.4×10³⁸
> draws — at ~83 draws/photon (τ=10) that is ~4×10³⁶ photons, some 10²⁸ times the app's own
> 100 M cap. **The only practical limit is wall-clock**: at the measured ~0.88 M photons/s a
> 100 M run takes about two minutes in the browser.
>
> Chunking did earn a second keep: it re-runs the accumulation pattern that failed under
> mulberry32, and `jump()` is the primitive a future Web Worker implementation would use. But
> that is a bonus, not the reason.

| | band 2 | band 6 | band 7 |
|---|---|---|---|
| σ(100 M)/σ(20 M) — ideal 1/√5 = 0.4472 | **0.447** | **0.448** | **0.448** |
| n_σ² at 20 M | 1.06 | 1.02 | 0.83 |
| n_σ² at 100 M | **1.07** | **0.93** | **1.08** |
| `jump()` chunk independence, 10 pairs (Poisson = 1) | 1.017 | 0.995 | 1.000 |

Noise falls **exactly** as 1/√N and n_σ² is flat, so there is no directional bias down to the
100 M noise floor. Chunk 0 performs no jumps and reproduces the contiguous 20 M grid
bin-for-bin, which validates the chunking machinery itself.

**On the integrated albedo.** ΔR/σ grew from −0.27 / −0.23 / +1.47 at 20 M to +2.19 / +0.83 /
+2.05 at 100 M — all positive, ≈ +1 × 10⁻⁴. That looks like three independent 2σ events but is
not: the three bands share one random stream (same seed, same jumps; only the phase function
and ω₀ differ), so they are strongly correlated. Re-running band 2 on an unrelated stream
(seed 777, 60 M) gave **+0.51σ**, against +2.19σ for seed 42. Pooling all 8 independent 20 M
chunks (160 M photons): **+0.72 ± 0.31 σ**, i.e. ~2.3σ for a +0.018 % offset.

Both plausible systematic explanations were tested and **ruled out**:

- *DISORT discretization.* R is converged to **3 × 10⁻⁹** across NQuad = 64 → 512. That sweep
  also varies the delta-M truncation fraction f = β_NLeg over a huge range (0.15 → 0.006 →
  clamped at 0), so delta-M is excluded as well.
- *Finite-slab proxy.* W = 500 and W = 2000 give **bit-identical** results under common random
  numbers (same 4,540,988 reflected photons of 10 M), so no photon reaches the side boundary
  and the finite slab is an exact stand-in for a plane-parallel layer in this configuration.

Conclusion: a residual at 2.3σ over 160 M photons, with no identified mechanism, is not
evidence of a defect. What the high-N run buys is a much tighter bound than 20 M could give:
**|ΔR| < 1.5 × 10⁻⁴ (3σ), i.e. < 0.035 %.**

`C5_mie_principal_plane_b2_b6_b7_100M.png` and `C5_results_100M.json` hold the figure and the
machine-readable numbers.

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

**~~Photon-count ceiling~~ — OBSOLETE as of 2026-07-29, retained as history.** Under
mulberry32 a photon consumed ~83 random draws at τ = 10, so the 2³² period was exhausted at
**~52 M photons** — below the app's own 100 M cap — and runs above that repeated trajectories
without improving. Worse, offset seeds in mulberry32 are phases of ONE cycle and overlapped
silently (measured ρ ≈ 0.32 for 600 M-draw offsets against 1.65 × 10⁹ draws consumed),
inflating the variance of a chunk sum as 1 + (k−1)ρ and manufacturing a spurious ~2 %
"residual" against DISORT. That is what motivated TODO §R.

xoshiro128\*\* has a 2¹²⁸ period — **~4 × 10³⁶ photons at τ = 10**, so the ceiling is now
wall-clock, not arithmetic — and its seeds are independent streams. The runs here are still
20 M contiguous (for continuity with the mulberry32 table, not out of necessity). N may now
be raised freely. Sub-streams must still be derived with `RNG.jump()`, never by arithmetic
seed offsets; `tests/review-harness/verify_rng.mjs` gates this (two-seed differenced χ²:
mulberry32 0.362, xoshiro128\*\* 1.008 against a Poisson expectation of 1).

## Files

| file | purpose |
|---|---|
| `legendre_moments.py` | project the tabulated phase function onto Legendre moments; writes `beta_b<N>_r10.npy` for bands 2/6/7 (or one band, with diagnostics, if given an argument) |
| `vistac_run.mjs` | run VISTA-C headlessly, accumulate the 45 µ × 120 φ reflected grid |
| `disort_vs_vistac.py` | run PythonicDISORT, bin-match, compare, plot |
| `C5_results.json` | the R/T/A + n_σ² table above, machine-readable |
| `C5_mie_principal_plane_b2_b6_b7.png` | the figure |

Requires `PythonicDISORT`, `numpy`, `scipy`, `matplotlib`. Run from this directory:

```
python3 legendre_moments.py                 # -> beta_b{2,6,7}_r10.npy
node vistac_run.mjs 2 20000000 42           # -> vista_b2.json   (repeat for 6 and 7)
node vistac_run.mjs 6 20000000 42
node vistac_run.mjs 7 20000000 42
python3 disort_vs_vistac.py                 # -> C5_results.json + the figure
```

The `.npy` and `vista_b*.json` files are regenerable intermediates. Two defects that made
this pipeline unrunnable on a clean checkout were fixed on 2026-07-29: `legendre_moments.py`
only ever handled band 1 (bands 2/6/7 had come from an uncommitted ad-hoc variant), and both
it and `vistac_run.mjs` used absolute paths to one particular machine.
