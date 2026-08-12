# C5 — VISTA-C tabulated-phase-function transport validated against PythonicDISORT

**Status: PASS, both particle families.** Fluxes agree to 0.01–0.06 %; directional BDF agrees
at Monte Carlo noise, confirmed at 100 M photons/band (see "High-N confirmation" — the
long-suspected ~1.05 pooled floor turned out to be noise, and |ΔR| is now bounded below
0.03 %). **Liquid droplet** (Mie): MODIS bands 2 / 6 / 7. **Ice particle**
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
| 2 | 0.86 | 0.99996 | R | 0.454136 | 0.454183 | 0.010 % |
| | | | T | 0.545054 | 0.545002 | 0.010 % |
| | | | A | 0.000810 | 0.000815 | 0.6 % |
| 6 | 1.64 | 0.99239 | R | 0.414150 | 0.414266 | 0.028 % |
| | | | T | 0.446760 | 0.446617 | 0.032 % |
| | | | A | 0.139090 | 0.139117 | 0.019 % |
| 7 | 2.13 | 0.97217 | R | 0.301280 | 0.301114 | 0.055 % |
| | | | T | 0.307169 | 0.307202 | 0.011 % |
| | | | A | 0.391552 | 0.391684 | 0.034 % |

R + T + A = 1.000000 exactly on both sides, all three bands. Absorption spans a factor of
~480 across the three bands (0.0008 → 0.391) and both codes track it. *(Values are v6.3
centred-cell sampling; the v6.2 discrete-node numbers differed in the 4th–5th decimal —
statistically identical, not bit-identical, since any table-sampling change decorrelates the
photon stream.)*

### Directional BDF, principal plane

Pooled over 7 azimuths × 45 µ bins, reduced χ² of (VISTA-C − DISORT)/σ_MC:

| band | φ=0° | φ=180° | pooled n_σ² | ΔR/σ_MC | interpretation |
|---|---|---|---|---|---|
| 2 | 1.08 | 0.77 | **1.06** | −0.4 | agreement at Monte Carlo noise |
| 6 | 1.89 | 1.32 | **1.24** | −1.1 | fluctuation — falls to 0.94 at 100 M, see below |
| 7 | 0.86 | 0.95 | **1.01** | +1.6 | agreement at Monte Carlo noise |

`C5_liquid_principal_plane.png` shows φ = 0° and φ = 180° cuts. Both Mie features
appear in the antisolar row and are tracked by both codes:
**glory at θ ≈ 30°** (Θs = 180°, since θ = Θ₀) and **cloudbow at θ ≈ 68°** (Θs ≈ 142°).
Neither is expressible by Henyey-Greenstein at any g.

### High-N confirmation (100 M photons/band) — the bias test

**Refreshed 2026-08-11 against the 265 K tables and the v6.3 centred-cell sampler.** The
previous numbers here were 300 K *and* pre-sampler — two changes out of date. Every value
below is current. Run as 5 x 20 M `RNG.jump()` sub-streams per band
(`vistac_run_chunk.mjs`), all **eight** bands, both families; regenerate the figures with
`HIGHN=1 python3 disort_vs_vistac.py [ice]`.

**Why this test exists.** Agreement at 20 M is weak evidence on its own: a systematic smaller
than sigma_MC is invisible. Raising N to 100 M shrinks sigma_MC by sqrt(5), so a FIXED bias b
becomes 5x more significant in n_sigma^2 = 1 + b^2/sigma^2, while noise stays at 1.

#### Check A — chunk self-consistency

Chunk 0 performs no jumps, so it must reproduce the contiguous 20 M reference **exactly**.
It does, bin for bin (liquid b6: 8,282,992 reflected photons in both).

#### Check B — does noise still fall as 1/sqrt(N)?

    sigma(100M)/sigma(20M) = 0.4473    ideal 1/sqrt(5) = 0.4472

Exact. This is the check that caught mulberry32, whose period was exhausted at ~52 M photons
at tau = 10, so added photons carried no new information and the ratio departed from ideal.
xoshiro128** shows no such saturation.

#### Check C — directional BDF: the residual was NOISE

Pooled n_sigma^2, 20 M -> 100 M. A fixed sub-noise bias would GROW by ~5x here.

| band | 20 M | 100 M |
|---|---|---|
| liquid b2 / b6 / b7 | 1.06 / 1.24 / 1.01 | **1.02 / 0.94 / 0.98** |
| ice b1 / b2 / b6 / b7 / b20 | 1.02 / 1.06 / 0.92 / 1.03 / 1.05 | **0.95 / 1.14 / 1.00 / 0.93 / 1.16** |

Nothing grew. Values scatter about 1.0 in **both** directions, which is what noise looks like.
Two things this settles:

* The long-suspected **~1.05 "pooled floor" was noise**, not a systematic. It does not survive
  a 5x reduction in sigma.
* **liquid b6's 1.24 (and its 1.89 at phi=0) was a fluctuation**, not a defect: it fell to 0.94
  and 1.24 respectively.

#### The apparent theta-dependence in the figures — resolved

The plots show deviations from the DISORT curve growing markedly toward the horizon, most
visibly in the ice phi=180 row. That is real but is **not** disagreement. The BDF estimator is
pi(W/N)/(mu_c*dmu*dphi), so as mu_c -> 0 the value AND its noise are both amplified by 1/mu_c:

| ice, theta band | mean abs dBDF | mean sigma | ratio | RMS z |
|---|---|---|---|---|
| 0-30 | 0.00700 | 0.00712 | 0.98 | 1.22 |
| 30-60 | 0.00704 | 0.00879 | 0.80 | 1.00 |
| 60-80 | 0.01036 | 0.01323 | 0.78 | 1.01 |
| 80-90 | **0.02225** | 0.02910 | 0.76 | 0.98 |

Absolute deviation grows 3.2x from nadir to horizon; sigma grows 4.1x over the same range, so
significance is FLAT. For pure Gaussian scatter E|z| = 0.798, so a ratio of 0.80 is exactly
right -- and that is what every band beyond 30 deg gives.

**Read the ratio column, not the eye.** With 1-sigma bars, 31.7 % of points SHOULD fall
outside them. Measured over all 720 principal-plane points, both families: 33.3 % outside
1 sigma (expect 31.7 %, p = 0.36) and **mean z = -0.018 +/- 0.037**, i.e. no bias whatsoever.

#### Check D — integrated reflectance: a bound, not a bias

This is the one quantity that did NOT simply behave. At seed 42, dR/sigma at 100 M came out
positive in 7 of 8 bands, mean **+1.21 +/- 0.35 (+3.4 sigma)**.

**That significance is an artifact of stream correlation.** All eight bands share ONE photon
stream (same seed, same jumps; only the phase function and omega0 differ), so they are not
eight independent measurements -- one correlated fluctuation was being counted eight times.
This is the same trap the 2026-07-29 analysis fell into and escaped by re-running on an
unrelated seed.

Re-run on **seed 777** (no jump() relation to 42):

| case | seed 42 | seed 777 |
|---|---|---|
| liquid b7 | +3.27 sigma | +1.78 sigma |
| ice b6 | +2.48 sigma | +0.44 sigma |
| **mean** | **+2.87** | **+1.11** |

Both shrink by ~60 %. The +3.4 sigma does not survive.

What remains is weaker but not zero: both streams give a positive mean, and the seed-777 value
sits on top of the historical **+0.72 +/- 0.31 sigma** measured over 160 M photons in the
300 K era. So a real residual of order **dR ~ +0.02-0.03 %** may exist -- but two streams whose
means differ by 1.8 sigma-units cannot establish it, because that spread IS the per-stream
scatter.

**Conclusion: this run tightened a bound rather than finding a bias.**

    |dR| < ~1e-4  (0.03 %) in integrated reflectance, with NO significant
    directional structure anywhere in the BDF.

Previously ruled out as mechanisms: DISORT discretization (R converged to 3e-9 across
NQuad 64-512, which also sweeps the delta-M truncation fraction over a huge range) and the
finite-slab proxy (W = 500 and W = 2000 give bit-identical results under common random
numbers). Remaining candidates, untested: the MC flux bookkeeping, and the comparison's own
bin integration.

Artifacts: `C5_{liquid,ice}_principal_plane_100M.png`, `C5_results_{liquid,ice}_100M.json`.

#### Reproducing this WITHOUT chunking

**Chunking is not a requirement.** It is an artifact of the automation that produced these
results, which caps a single command at ~45 s while 100 M photons takes ~2 min in Node.
Nothing in VISTA-C or in xoshiro128\*\* needs it, and the app's own 100 M cap is ~10^28 times
below the generator's period. Run it contiguously instead:

```
node vistac_run.mjs 6 100000000 42 liquid
mv vista_liquid_b6.json vista_liquid_b6_100M.json     # keeps the 20 M reference intact
HIGHN=1 python3 disort_vs_vistac.py
```

`HIGHN=1` prefers `vista_<family>_b<band>_100M.json` when present and only falls back to
summing chunks. The chunked path is retained because it is how the committed artifacts were
made, and because chunk 0 performs no jumps and so reproduces the contiguous 20 M reference
exactly -- the identity that makes summing trustworthy in the first place.

The raw chunk files are **gitignored**: ~1.4 MB per campaign, fully regenerable, and never
tracked historically. The committed artifacts are the summed results and the figures.

> **Two scripts had rotted past the v6.2 family split and were fixed on 2026-08-11 to make
> this run possible at all.** `c5_highN_check.py` still looked for `vista_b<band>.json`, a
> filename retired two releases earlier, and would have crashed on its first read;
> `vistac_run_chunk.mjs` hardcoded the liquid grid and had no `SSA_OVERRIDE`, so a 100 M ice
> b1/b2 run would have compared a conservative MC against a slightly absorbing DISORT and
> manufactured a fake bias. Same class as the `regen_exports.py` schema-1.7 bug: code only
> reachable by running it, and nobody ran it for two releases.

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
