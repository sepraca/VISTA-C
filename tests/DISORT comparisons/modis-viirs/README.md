# C5 — VISTA-C tabulated-phase-function transport validated against PythonicDISORT

**Status: PASS, both particle families.** Fluxes agree to 0.000–0.06 %; directional BDF agrees
at Monte Carlo noise. **Liquid droplet** (Mie): MODIS bands 2 / 6 / 7. **Ice particle**
(Yang et al. 2013, non-spherical): MODIS bands 1 / 2 / 6 / 7 / 20 — added 2026-08-09.

> **Refreshed 2026-08-09 for v6.2 (265 K phase-function tables).** The liquid droplet tables
> were replaced: the source moved from the author's 300 K calculation to the operational
> 265 K HDF4 used by the MODIS/VIIRS continuity product (CLDPROP), read directly rather than
> via a NetCDF4 intermediate. **Both sides of this comparison use the same table**, so the
> agreement is the quantity to watch, not the absolute fluxes — those shift for the absorbing
> bands because 265 K is genuinely more absorbing there (band 7: 1−ω₀ 0.02366 → 0.02783).
> Pooled n_σ² was 1.06 / 1.02 / 0.83 under the 300 K tables, now 1.00 / 1.14 / 1.05.
>
> **Corrected later the same day:** the DISORT settings were re-derived by self-convergence
> (NQuad 256 for both families). Liquid fluxes are identical to six decimals and its n_σ² moved
> only in the second decimal; the ice numbers changed materially. See "Ice particle validation".
>
> One numerical improvement worth noting: the Legendre projection now reproduces the
> tabulated g to **1–4 × 10⁻⁸** (was 1.9 × 10⁻⁵). The old assets stored g rounded to four
> decimals; the v6.2 converter renormalizes `pf` and derives g from it, so the two are
> consistent by construction.
>
> An earlier refresh (2026-07-29) covered the xoshiro128\*\* RNG swap. The photon-count
> ceiling caveat is **obsolete** — see "Known limits".

---

## What is being tested

Two completely independent solution methods, given the **same tabulated phase function**,
must agree. This is run for both v6.2 particle families — liquid droplet and ice — at **NQuad = 256,
NLeg = 255, delta-M on** for both, established by DISORT self-convergence (see "Ice particle
validation" for why that criterion, and not agreement with VISTA-C, has to be the one used).

| | VISTA-C | PythonicDISORT |
|---|---|---|
| method | stochastic photon transport (3-D box) | discrete ordinates (plane-parallel) |
| phase function | sampled directly from the table by discrete-node CDF inversion | 255 Legendre moments projected from the same table |
| geometry | finite slab, W = 500 τ-units, centered pencil beam | infinite plane-parallel layer |

Agreement therefore exercises the µ-space CDF construction, the sampling kernel, the
transport, and the flux/BDF bookkeeping simultaneously.

**Case:** τ = 10, Θ₀ = 30°, Aₛ = 0, r_eff = 10 µm (selected by VALUE, not index), MODIS bands 2 / 6 / 7,
20 M photons per band (single contiguous run, xoshiro128** seed 42).

## Results

### Fluxes (R / T / A)

| band | λ (µm) | ω₀ | | VISTA-C | DISORT | rel. diff |
|---|---|---|---|---|---|---|
| 2 | 0.86 | 0.99996 | R | 0.454183 | 0.454183 | 0.000 % |
| | | | T | 0.545003 | 0.545002 | 0.000 % |
| | | | A | 0.000814 | 0.000815 | 0.20 % |
| 6 | 1.64 | 0.99239 | R | 0.414215 | 0.414266 | 0.012 % |
| | | | T | 0.446686 | 0.446617 | 0.015 % |
| | | | A | 0.139099 | 0.139117 | 0.012 % |
| 7 | 2.13 | 0.97217 | R | 0.301287 | 0.301114 | 0.057 % |
| | | | T | 0.307216 | 0.307202 | 0.005 % |
| | | | A | 0.391497 | 0.391684 | 0.048 % |

R + T + A = 1.000000 exactly on both sides, all three bands. Absorption spans a factor of
~480 across the three bands (0.0008 → 0.391) and both codes track it.

### Directional BDF, principal plane

Pooled over 7 azimuths × 45 µ bins, reduced χ² of (VISTA-C − DISORT)/σ_MC:

| band | φ=0° | φ=180° | pooled n_σ² | ΔR/σ_MC | interpretation |
|---|---|---|---|---|---|
| 2 | 1.01 | 0.80 | **1.00** | 0.0 | agreement at Monte Carlo noise |
| 6 | 1.78 | 1.01 | **1.14** | −0.5 | agreement at Monte Carlo noise |
| 7 | 0.95 | 1.02 | **1.05** | +1.7 | agreement at Monte Carlo noise |

`C5_liquid_principal_plane.png` shows φ = 0° and φ = 180° cuts. Both Mie features
appear in the antisolar row and are tracked by both codes:
**glory at θ ≈ 30°** (Θs = 180°, since θ = Θ₀) and **cloudbow at θ ≈ 68°** (Θs ≈ 142°).
Neither is expressible by Henyey-Greenstein at any g.

### High-N confirmation (100 M photons) — the bias test

> ⚠ **THIS SECTION HAS NOT BEEN RE-RUN FOR v6.2.** Every number below was measured against
> the 300 K liquid tables that v6.2 retired. The *method* and the *conclusions* about the RNG
> (noise falling exactly as 1/√N, `jump()` sub-stream independence, the bound on ΔR) are
> properties of the generator and the estimator, not of the phase-function table, so they
> carry over. The specific n_σ² and ΔR/σ values do not. Re-run with
> `vistac_run_chunk.mjs` + `c5_highN_check.py` when a high-N confirmation is next needed.

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

`C5_liquid_principal_plane_100M.png` and `C5_results_liquid_100M.json` hold the figure and the
machine-readable numbers.

## Ice particle validation (v6.2, 2026-08-09)

**Status: PASS, all five bands.** The ice tables are Yang et al. (2013) severely roughened
aggregate columns on a 498-point trapezoidal-in-µ grid — **not** Mie, not a Gaussian
quadrature, and normalized ∫p dµ = 2 in the source rather than 1. Everything downstream of
that (weights, projection, sampling) is family-specific, so this is a genuinely separate
validation rather than a re-run of the liquid case with different numbers.

**Case:** identical to the liquid case — τ = 10, Θ₀ = 30°, Aₛ = 0, r_eff = 10 µm (by value),
20 M photons/band, xoshiro128\*\* seed 42.

### Fluxes (R / T / A)

| band | λ (µm) | ω₀ | | VISTA-C | DISORT | rel. diff |
|---|---|---|---|---|---|---|
| 1 | 0.65 | 0.9999999 | R | 0.605007 | 0.605056 | 0.008 % |
| | | | T | 0.394991 | 0.394942 | 0.012 % |
| | | | A | 0.000002 | 0.000002 | — |
| 2 | 0.86 | 0.9999999 | R | 0.603183 | 0.603006 | 0.029 % |
| | | | T | 0.396815 | 0.396992 | 0.045 % |
| | | | A | 0.000002 | 0.000002 | — |
| 6 | 1.64 | 0.98100 | R | 0.431750 | 0.431752 | 0.001 % |
| | | | T | 0.270760 | 0.270701 | 0.022 % |
| | | | A | 0.297491 | 0.297547 | 0.019 % |
| 7 | 2.13 | 0.96200 | R | 0.319466 | 0.319475 | 0.003 % |
| | | | T | 0.204821 | 0.204761 | 0.030 % |
| | | | A | 0.475712 | 0.475765 | 0.011 % |
| 20 | 3.75 | 0.80400 | R | 0.093854 | 0.093910 | 0.060 % |
| | | | T | 0.025563 | 0.025566 | 0.012 % |
| | | | A | 0.880583 | 0.880524 | 0.007 % |

Absorption spans **0.000002 → 0.881**, a factor of ~4 × 10⁵, and both codes track it.

### Directional BDF, principal plane

| band | λ (µm) | ω₀ | φ=0° | φ=180° | pooled n_σ² | ΔR/σ_MC |
|---|---|---|---|---|---|---|
| 1 | 0.65 | 1.0000000 | 2.57 | 2.30 | **1.47** | −0.4 |
| 2 | 0.86 | 1.0000000 | 1.75 | 1.75 | **1.20** | +1.6 |
| 6 | 1.64 | 0.98100 | 2.38 | 1.06 | **1.21** | −0.0 |
| 7 | 2.13 | 0.96200 | 2.27 | 1.14 | **1.27** | −0.1 |
| 20 | 3.75 | 0.80400 | 3.08 | 2.19 | **1.48** | −0.9 |

`C5_ice_principal_plane.png` holds the ten cuts. The ice curves are visibly **smoother than
the liquid ones — no glory, no cloudbow** — as expected for randomly oriented roughened
non-spherical crystals, whose orientation and surface-roughness averaging washes out the
resonance features that a sphere produces.

### DISORT settings: NQuad = 256, NLeg = 255, delta-M ON — and why n_σ² must not pick them

**These settings were got wrong once. The failure mode is subtle and worth recording, because
anyone re-tuning them by the obvious route will reproduce it.**

The ice settings were originally chosen as NQuad = 512, NLeg = 511, delta-M **off**, by
minimizing pooled n_σ² against VISTA-C: 45.55 → 1.22 → 1.12 → **1.05** across NQuad
128/256/384/512. Every one of those numbers is correct. The conclusion drawn from them was
not — the resulting DISORT curves **visibly ring**, which a glance at the figure caught
immediately and the metric never could.

**The real behaviour is a cliff, not a gradient.** Max deviation of the φ=0 BRF curve from the
converged plateau:

| NQuad | 192 | 256 | 320 | **384** | 448 | 512 |
|---|---|---|---|---|---|---|
| ice b1 | 0.62 % | ref | 0.28 % | **9.44 %** | 9.72 % | 9.77 % |
| ice b6 | 0.22 % | ref | 0.17 % | **10.80 %** | 11.03 % | 11.03 % |
| ice b20 | 0.18 % | ref | 0.25 % | **19.74 %** | 20.17 % | 20.19 % |
| liquid b6 | 0.00 % | ref | 0.00 % | **0.00 %** | 0.00 % | 0.00 % |

**Fluxes are blind to all of it** — R_DIS = 0.43175 for ice b6 at *every* setting from 128 to
512, delta-M on or off. Only the radiance shape moves.

**Cause: the ice angular grid, not the forward peak.** Liquid shows no cliff anywhere because
its tables sit on 1000 Gauss–Legendre nodes; ice has only **498 trapezoidal** ones. Past
l ≈ 320 the ice Legendre projection is aliasing off that finite grid — visible directly in the
moments, which stop decaying monotonically:

    beta_255 = 3.304e-03    beta_320 = 1.437e-03    beta_383 = 1.597e-03  <-- RISING
    beta_448 = 3.620e-04    beta_511 = -5.654e-05

A smooth forward-peaked function cannot have a rising moment sequence. Feeding those aliased
coefficients to DISORT injects the noise straight into the radiance field.

**Why pooled n_σ² could not detect this.** The 11 % ringing sits at θ = 89.4°, where σ_MC is
16 %. Across all 45 bins **not one deviation exceeds 2 σ_MC** (median 0.56 σ). The metric asks
*"is DISORT inside the Monte Carlo noise?"* — exactly the right question for **validating
VISTA-C**, and structurally incapable of choosing **DISORT's own** numerical parameters, since
it has no power below the noise floor. Minimizing it actively drove NLeg up into the aliased
moments, because ringing that hides under fat error bars looks like a marginally better fit.

> **Rule.** Choose DISORT settings by **DISORT self-convergence** — the reference solution
> compared against itself at increasing resolution, with VISTA-C nowhere in the loop. *Then*
> compare the converged reference to VISTA-C. Never tune the reference to fit the thing being
> validated. The corrected n_σ² values above are all **higher** than the ringing ones (1.47 vs
> 1.35 for b1); that is what a correct answer looks like here.

**delta-M is ON**, and it matters most where scattering is conservative: ice b1 at NQuad = 256
scores 1.47 with delta-M and **18.22** without. NT/TMS stays off — it rebuilds single
scattering from the supplied moments and injects a wrong term (BRF 0.069 against a true 0.479).

**One earlier claim survives intact:** streams and moments are genuinely coupled. The
discrete-ordinate solution retains moments only to NSTR − 1 and PythonicDISORT enforces it
(`ValueError: There should be more streams than the number of phase function Legendre
coefficients used`), so NLeg and NSTR must be raised together. What was wrong was the
inference that raising both *further* must therefore be better.

### Conservative bands (ice b1, b2): ω₀ = 1 − 10⁻⁷

Ice bands 1 and 2 have ω₀ = 1.000000 exactly, which is **singular** in discrete ordinates.
These were initially excluded — wrongly, as it turned out: the exclusion was an artifact of a
hardcoded 1 − 10⁻⁹ clamp, which is past the point where the solve breaks down. Tested
directly, DISORT converges cleanly at **1 − 10⁻⁷** (albedo spread ~10⁻⁸ across NQuad 64–384)
and fails at 10⁻⁹.

VISTA-C is therefore run at the same value via `SSA_OVERRIDE=0.9999999`, so both codes solve
the *identical* problem rather than two nearby ones. The induced absorption over ~25
scatterings is ~3 × 10⁻⁶ — two orders below the 20 M-photon noise floor (σ_R ≈ 10⁻⁴) — so
this is a faithful conservative-scattering proxy. Both codes report A = 0.000002, agreeing on
the size of the artifact itself.

Band 1's pooled 1.47 is the largest of the five, consistent with conservative scattering being
the hardest case for both methods (longest photon chains, most nearly singular solve).

## Method notes (the parts that are easy to get wrong)

**Legendre projection.** The tables satisfy Σ wt·pf = 1 with Σ wt = 2 (so ∫p dµ = 1) and
Σ wt·pf·µ = g. DISORT wants "unweighted" coefficients β_l with β₀ = 1, β₁ = g, which is

    β_l = Σ_i wt_i · pf_i · P_l(µ_i)

evaluated on the table's own 1000-point Gauss–Legendre µ grid — i.e. the projection uses
exactly the quadrature the table was built on. **Verified (v6.2 tables)**: β₀ = 1.00000000 and
β₁ agrees with the tabulated g to **1–4 × 10⁻⁸** across bands 2/6/7.

That is ~1000× tighter than the pre-v6.2 assets managed (1.9 × 10⁻⁵), and the reason is worth
recording: the old files stored `g` rounded to four decimal places, so β₁ could not agree with
it more closely than that rounding. The v6.2 converter renormalizes `pf` to Σ wt·pf = 1 and
then *derives* g from that same array, so the table's `g` and its `pf` are consistent by
construction rather than by coincidence.

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

**~~Band 1 (ω₀ = 1) is ill-conditioned and is deliberately excluded~~ — SUPERSEDED
2026-08-09.** The original finding stands: at a 1 − 10⁻⁹ clamp the albedo does not converge
with stream count (R = 0.446569 / 0.446566 / 0.445499 / 0.448112 / 0.449507 at NQuad =
64 / 128 / 256 / 384 / 512 — 0.9 % spread, and PythonicDISORT warns). But the **clamp, not
conservative scattering itself, was the problem**. At 1 − 10⁻⁷ the solve converges to ~10⁻⁸
across the same stream range, and ice bands 1 and 2 are now included in the validation with
VISTA-C matched via `SSA_OVERRIDE` (see "Conservative bands" above). The liquid table has no
exactly-conservative band under the 265 K basis, so the liquid set remains 2 / 6 / 7.

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
| `legendre_moments.py` | project a tabulated phase function onto Legendre moments; writes `beta_<family>_b<N>_r10.npy`. A trailing `ice`/`liquid` argument selects the family (default liquid) |
| `vistac_run.mjs` | run VISTA-C headlessly, accumulate the 45 µ × 120 φ reflected grid. 5th arg = family; `SSA_OVERRIDE` env var forces ω₀ for conservative bands |
| `disort_vs_vistac.py` | run PythonicDISORT, bin-match, compare, plot. `sys.argv[1]` = family; the the settings and the evidence for them live in the header comment |
| `C5_results_liquid.json`, `C5_results_ice.json` | the R/T/A + n_σ² tables above, machine-readable |
| `C5_liquid_principal_plane.png`, `C5_ice_principal_plane.png` | the figures |

Requires `PythonicDISORT`, `numpy`, `scipy`, `matplotlib`. Run from this directory:

```
# liquid droplet
python3 legendre_moments.py                        # -> beta_liquid_b{2,6,7}_r10.npy
for b in 2 6 7; do node vistac_run.mjs $b 20000000 42 liquid; done
python3 disort_vs_vistac.py                        # -> C5_results_liquid.json + figure

# ice particle (b1/b2 are conservative -> matched omega0 on both sides)
python3 legendre_moments.py 1 2 6 7 20 ice         # -> beta_ice_b*_r10.npy
SSA_OVERRIDE=0.9999999 node vistac_run.mjs 1 20000000 42 ice
SSA_OVERRIDE=0.9999999 node vistac_run.mjs 2 20000000 42 ice
for b in 6 7 20; do node vistac_run.mjs $b 20000000 42 ice; done
python3 disort_vs_vistac.py ice                    # -> C5_results_ice.json + figure
```

**Renamed 2026-08-09.** The outputs are now `C5_results_<family>.json` and
`C5_<family>_principal_plane.png` for both families. Previously the *figure* was family-suffixed
but the JSON was not, so `disort_vs_vistac.py ice` silently overwrote the liquid
`C5_results.json` — while printing that it had written `C5_results_ice.json`. The old
`C5_results.json` / `C5_mie_principal_plane_b2_b6_b7.png` are superseded and were deleted;
the 100 M files keep their original names.

Both families run in seconds per band at NQuad = 256 (0.5 s of DISORT solve per band, plus
the binning). The `.npy` and `vista_*.json` files are regenerable intermediates. Two defects that made
this pipeline unrunnable on a clean checkout were fixed on 2026-07-29: `legendre_moments.py`
only ever handled band 1 (bands 2/6/7 had come from an uncommitted ad-hoc variant), and both
it and `vistac_run.mjs` used absolute paths to one particular machine.
