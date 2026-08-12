#!/usr/bin/env python3
"""c5_highN_check.py -- does VISTA-C keep converging to DISORT at high N?

Usage (after running vistac_run_chunk.mjs for chunks 0..4 of each band):
    python3 c5_highN_check.py

WHY THIS IS THE DECISIVE TEST. Agreement at 20 M photons is weak evidence on its own: a
systematic error smaller than the Monte Carlo noise is invisible. Raising N to 100 M shrinks
sigma_MC by sqrt(5), which makes any FIXED bias 5x more significant in the reduced chi^2.
So:

    n_sigma^2 stays ~1 at 100 M   ->  the difference is noise, and any systematic is now
                                      bounded 5x more tightly than 20 M could bound it.
    n_sigma^2 grows toward ~5     ->  there IS a fixed bias; 20 M was simply too noisy to see.

This is also exactly how the mulberry32 defects were caught: under a generator whose period
was exhausted at ~52 M photons at tau=10, adding photons past that point added no new
information, so the noise stopped falling as 1/sqrt(N). Any repeat of that shows up here as
sigma_100M / sigma_20M departing from the ideal 1/sqrt(5) = 0.447.

Three independent checks are reported:
  A. Chunk self-consistency -- chunk 0 does no jumps, so it must reproduce the committed
     contiguous 20 M run bin-for-bin. Guards the chunking machinery itself.
  B. Chunk independence -- every pair of jump()-derived chunks, differenced. Poisson
     prediction 1.0. Under mulberry32 with seed-offset chunks this read 0.362.
  C. Convergence to DISORT -- n_sigma^2 and the flux residual at 20 M vs 100 M.
"""
import json, os, itertools, warnings
import numpy as np
warnings.filterwarnings("ignore")
from PythonicDISORT import pydisort
from scipy.interpolate import PchipInterpolator
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

HERE = os.path.dirname(os.path.abspath(__file__))
os.chdir(HERE)

# FAMILY (2026-08-11): this file predated the v6.2 two-family split and still looked for the
# retired filenames vista_b<band>.json / beta_b<band>_r10.npy, so it crashed before producing
# a single number. Same class of rot as the regen_exports.py schema-1.7 bug -- a script only
# reachable by running it, unrun for two releases.
FAMILY = "liquid"
BANDS = [2, 6, 7]
NCHUNK = 5
WL = {2: 0.86, 6: 1.64, 7: 2.13}
mu0 = np.cos(np.radians(30.0))
nMU, nPHI = 45, 120
dmu, dphi = 1.0 / nMU, 2 * np.pi / nPHI
mu_lo = np.array([max(0, 1 - (i + 1) * dmu) for i in range(nMU)])
mu_hi = np.array([1 - i * dmu for i in range(nMU)])
mu_c = 0.5 * (mu_lo + mu_hi)
theta = np.degrees(np.arccos(np.clip(mu_c, 0, 1)))


def bdf(w, N):
    return np.pi * (w / N) / (mu_c[:, None] * dmu * dphi)


def sig(w, N):
    return np.pi * (np.sqrt(np.maximum(w, 1)) / N) / (mu_c[:, None] * dmu * dphi)


def disort_binned(band, ssa, NQ=128):
    beta = np.load(f"beta_{FAMILY}_b{band}_r10.npy")
    NL = NQ - 1
    ss = ssa if ssa < 1 else 1 - 1e-9
    o = pydisort(np.array([10.0]), np.array([ss]), NQ, np.atleast_2d(beta[:NL + 1]),
                 mu0, 1.0, 0.0, NLeg=NL, NFourier=min(64, NL),
                 f_arr=np.array([max(0.0, float(beta[NL]))]))
    mu_arr, u = o[0], o[4]
    R = float(np.ravel(o[1](np.array([0.0])))[0]) / mu0

    def binned(pd):
        phis = np.radians(pd + np.linspace(-1.5, 1.5, 9))
        r = np.squeeze(u(np.array([0.0]), phis))
        up = mu_arr > 0
        m = mu_arr[up]
        oo = np.argsort(m)
        f = PchipInterpolator(m[oo], r[up, :].mean(axis=1)[oo], extrapolate=True)
        out = []
        for i in range(nMU):
            xs = np.linspace(mu_lo[i], mu_hi[i], 65)
            out.append(np.pi * np.trapz(f(xs) * xs, xs) / (mu0 * mu_c[i] * (mu_hi[i] - mu_lo[i])))
        return np.array(out)
    return binned, R


print("=" * 78)
print("A. CHUNK SELF-CONSISTENCY  (chunk 0 does no jumps -> must equal the contiguous run)")
print("=" * 78)
chunks = {}
for band in BANDS:
    cs = [json.load(open(f"vista_{FAMILY}_b{band}_c{c}.json")) for c in range(NCHUNK)]
    chunks[band] = cs
    ref = json.load(open(f"vista_{FAMILY}_b{band}.json"))
    same = (np.array(cs[0]["w"]) == np.array(ref["w"])).all() and cs[0]["refl"] == ref["refl"]
    print(f"  band {band}: chunk0 == vista_{FAMILY}_b{band}.json  ->  {'EXACT MATCH' if same else 'MISMATCH'}")
    assert same, "chunking machinery altered the stream"

print()
print("=" * 78)
print("B. CHUNK INDEPENDENCE  (jump()-derived pairs, differenced; Poisson = 1.000)")
print("   mulberry32 with seed-offset chunks scored 0.362 here")
print("=" * 78)
for band in BANDS:
    vals = []
    for i, j in itertools.combinations(range(NCHUNK), 2):
        a = np.array(chunks[band][i]["w"], float)
        b = np.array(chunks[band][j]["w"], float)
        m = (a + b) > 0
        vals.append(float(np.mean((a[m] - b[m]) ** 2 / (a[m] + b[m]))))
    print(f"  band {band}: {NCHUNK*(NCHUNK-1)//2} pairs  "
          f"min {min(vals):.3f}  mean {np.mean(vals):.3f}  max {max(vals):.3f}")

print()
print("=" * 78)
print("C. CONVERGENCE TO DISORT   20M -> 100M")
print("   sigma ratio ideal = 1/sqrt(5) = 0.447 ; n_sigma^2 should STAY ~1, not grow ~5x")
print("=" * 78)
print(f"  {'band':>4} {'R_20M':>9} {'R_100M':>9} {'R_DIS':>9} "
      f"{'dR/s_20':>8} {'dR/s_100':>9} {'ns2_20':>7} {'ns2_100':>8} {'sig_ratio':>10}")

results = {}
fig, axs = plt.subplots(2, 3, figsize=(16, 8.4), sharex=True)
for j, band in enumerate(BANDS):
    cs = chunks[band]
    ssa = cs[0]["ssa"]
    w20 = np.array(cs[0]["w"], float).reshape(nMU, nPHI)
    N20 = cs[0]["N"]
    r20 = cs[0]["refl"]
    w100 = sum(np.array(c["w"], float).reshape(nMU, nPHI) for c in cs)
    N100 = sum(c["N"] for c in cs)
    r100 = sum(c["refl"] for c in cs)
    t100 = sum(c["trans"] for c in cs)

    B20, S20 = bdf(w20, N20), sig(w20, N20)
    B100, S100 = bdf(w100, N100), sig(w100, N100)
    binned, Rdis = disort_binned(band, ssa)

    pool20, pool100 = [], []
    for ph in (0, 30, 60, 90, 120, 150, 180):
        ip = int(round(ph / 3.0)) % nPHI
        Dv = binned(float(ph))
        pool20.append((B20[:, ip] - Dv) / S20[:, ip])
        pool100.append((B100[:, ip] - Dv) / S100[:, ip])
    ns20 = float(np.mean(np.concatenate(pool20) ** 2))
    ns100 = float(np.mean(np.concatenate(pool100) ** 2))

    R20, R100 = r20 / N20, r100 / N100
    sR20 = np.sqrt(R20 * (1 - R20) / N20)
    sR100 = np.sqrt(R100 * (1 - R100) / N100)
    sig_ratio = float(np.mean(S100 / S20))

    print(f"  {band:>4} {R20:9.6f} {R100:9.6f} {Rdis:9.6f} "
          f"{(R20-Rdis)/sR20:8.2f} {(R100-Rdis)/sR100:9.2f} "
          f"{ns20:7.2f} {ns100:8.2f} {sig_ratio:10.3f}")

    results[str(band)] = dict(ssa=ssa, N20=N20, N100=N100,
                              R_20M=R20, R_100M=R100, R_disort=Rdis,
                              T_100M=t100 / N100, A_100M=1 - R100 - t100 / N100,
                              dR_sigma_20M=(R20 - Rdis) / sR20,
                              dR_sigma_100M=(R100 - Rdis) / sR100,
                              nsig2_20M=ns20, nsig2_100M=ns100,
                              sigma_ratio=sig_ratio)

    for i, (ph, ip, lab) in enumerate(((0.0, 0, "φ = 0°  (forward side)"),
                                       (180.0, 60, "φ = 180°  (antisolar)"))):
        ax = axs[i, j]
        Dv = binned(ph)
        ax.errorbar(theta, B100[:, ip], yerr=S100[:, ip], fmt='o', ms=3, lw=0.9,
                    capsize=2, color='#0a7d28', zorder=3, label='VISTA-C (100M)')
        ax.plot(theta, Dv, '-', color='#b00020', lw=1.7, zorder=2, label='PythonicDISORT')
        ax.grid(alpha=0.25)
        ax.legend(fontsize=8)
        if i == 1:
            ax.set_xlabel('exit zenith Θ (deg)')
        if j == 0:
            ax.set_ylabel(f'{lab}\n\nBDF / BRF')
        if i == 0:
            ax.set_title(f'MODIS band {band}  ({WL[band]:.2f} µm)   ω₀ = {ssa:.5f}',
                         fontsize=11, pad=8)
        else:
            ax.set_title(lab, fontsize=9, pad=6)

fig.suptitle('C5 validation at 100M photons — VISTA-C Monte Carlo vs PythonicDISORT, principal plane\n'
             'τ=10, Θ₀=30°, A$_s$=0, r$_{eff}$=10 µm;  plane-parallel proxy W=500, centered beam, '
             '5×20M xoshiro128** jump() sub-streams, seed 42',
             fontsize=12.5, y=1.02)
fig.tight_layout()
fig.savefig("C5_liquid_principal_plane_100M.png", dpi=125, bbox_inches='tight')
json.dump({"rng": {"name": "xoshiro128**", "seed": 42,
                   "chunking": "5 x 20M via RNG.jump()"}, "bands": results},
          open("C5_results_liquid_100M.json", "w"), indent=2)
print("\nwrote C5_liquid_principal_plane_100M.png and C5_results_liquid_100M.json")
