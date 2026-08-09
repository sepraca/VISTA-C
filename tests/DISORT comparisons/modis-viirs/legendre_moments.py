#!/usr/bin/env python3
"""legendre_moments.py -- project a tabulated Mie phase function onto Legendre moments
and write the beta arrays PythonicDISORT consumes.

Usage (run from this directory):
    python3 legendre_moments.py            # bands 2, 6, 7 (the C5 set) -> beta_b<N>_r10.npy
    python3 legendre_moments.py 1          # one band, plus the reconstruction diagnostics

WHY. VISTA-C samples the tabulated phase function directly; DISORT needs it as Legendre
moments. Agreement between the two only means something if the moments are a faithful
projection of the SAME table -- so this script both writes the moments and prints the checks
that prove the projection is right.

The projection. The tables satisfy sum(wt*pf) = 1 with sum(wt) = 2 (so integral p dmu = 1)
and sum(wt*pf*mu) = g. DISORT wants "unweighted" coefficients with beta_0 = 1, beta_1 = g:

    beta_l = sum_i wt_i * pf_i * P_l(mu_i)

evaluated on the table's OWN 1000-point Gauss-Legendre mu grid -- i.e. using exactly the
quadrature the table was built on, which is why beta_0 returns 1 to 8 decimals rather than
approximately.

Two traps, both checked/annotated below:
  * beta goes slightly NEGATIVE at high l. delta-M's truncation fraction is f = beta_NLeg and
    PythonicDISORT rejects f < 0 outright, so f must be clamped to >= 0. (This is why
    NQuad = 512 fails without the clamp.)
  * NT_cor (Nakajima-Tanaka) must NOT be used at low NLeg with these tables: it rebuilds the
    single-scattering term from the same truncated moments that misrepresent p there, and
    produced BRF 0.069 against a true 0.479 at NLeg = 128.

FIXED 2026-07-29 (during the xoshiro128** C5 rerun), two defects that made this pipeline
unreproducible:
  1. It handled ONLY band 1, while the C5 comparison needs 2/6/7 -- those .npy files had been
     produced by an uncommitted ad-hoc variant, so a clean checkout could not regenerate them.
  2. Paths were absolute to one particular sandbox (/sessions/...), so it could not run on
     any other machine. Paths are now relative to this file.
"""
import json, os, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
D = os.path.join(HERE, "..", "..", "..", "data", "phase")
R_EFF_UM = 10.0   # selected BY VALUE below; index 8 was 10 um in the old 24-radius
                  # grid but is 12 um in the 18-radius operational grid.

# FAMILY (v6.2): trailing "ice"/"liquid" argument; default liquid (unchanged for callers).
argv = sys.argv[1:]
FAMILY = "liquid"
if argv and argv[-1] in ("ice", "liquid"):
    FAMILY = argv.pop()
args = [int(a) for a in argv]
bands = args or [2, 6, 7]
verbose = bool(args)

grid = json.load(open(os.path.join(D, f"grid_{FAMILY}.json")))
mu = np.array(grid["xmu"])
wt = np.array(grid["wt"])

for band in bands:
    b = json.load(open(os.path.join(D, f"{FAMILY}_modis_b{band}.json")))
    try:
        K = b["cer_um"].index(R_EFF_UM)
    except ValueError:
        sys.exit(f"r_eff {R_EFF_UM} um not in band {band} grid: {b['cer_um']}")
    pf = np.array(b["pf"][K])
    g = b["g"][K]

    NM = 1000
    beta = np.zeros(NM)
    Pm1 = np.ones_like(mu)
    P = mu.copy()
    beta[0] = np.sum(wt * pf * Pm1)
    beta[1] = np.sum(wt * pf * P)
    for l in range(1, NM - 1):
        Pp1 = ((2 * l + 1) * mu * P - l * Pm1) / (l + 1)
        beta[l + 1] = np.sum(wt * pf * Pp1)
        Pm1, P = P, Pp1

    # beta_1 tolerance is set by how precisely the TABLE stores g, not by the projection:
    # the assets round g to 4 decimals (band 7 stores 0.8418), so |beta_1 - g| up to 5e-5 is
    # rounding alone. Band 7 projects to 0.84181902 -- a 1.9e-5 residual that a naive 1e-5
    # gate rejected as a failure. A genuine mis-projection (wrong quadrature, wrong
    # normalization, off-by-one in the recursion) is orders of magnitude larger than this,
    # so 1e-4 loses no real sensitivity. beta_0 has no such limit -- it must be 1 by
    # construction and lands within 2e-8.
    ok0 = abs(beta[0] - 1.0) < 1e-6
    ok1 = abs(beta[1] - g) < 1e-4
    print(f"band {band}  lambda={b['wavelength_um']} um  r_eff={b['cer_um'][K]} um  "
          f"ssa={b['ssa'][K]:.6f}")
    print(f"  norm   sum(wt)={wt.sum():.6f}   sum(wt*pf)={np.sum(wt * pf):.8f}")
    print(f"  beta_0 = {beta[0]:.8f}   {'OK' if ok0 else 'FAIL (must be 1)'}")
    print(f"  beta_1 = {beta[1]:.8f}  vs tabulated g = {g:.8f}  "
          f"diff = {abs(beta[1] - g):.2e}   {'OK' if ok1 else 'FAIL'}")
    if not (ok0 and ok1):
        sys.exit("Legendre projection failed its own normalization checks -- not writing")

    if verbose:
        for L in (16, 32, 64, 128, 256, 512, 999):
            print(f"    beta_{L} = {beta[L]:+.5f}")

        def recon(L):
            Pm1 = np.ones_like(mu)
            P = mu.copy()
            s = beta[0] * Pm1 + 3.0 * beta[1] * P
            for l in range(1, L):
                Pp1 = ((2 * l + 1) * mu * P - l * Pm1) / (l + 1)
                s = s + (2 * (l + 1) + 1) * beta[l + 1] * Pp1
                Pm1, P = P, Pp1
            return s / 2.0    # back to the table's integral-p-dmu = 1 normalization

        ang = np.degrees(np.arccos(np.clip(mu, -1, 1)))
        i140 = int(np.argmin(abs(ang - 140)))
        i0 = int(np.argmax(mu))
        i90 = int(np.argmin(abs(ang - 90)))
        print("\n  reconstruction vs table (ratio recon/table):")
        print("   NLeg    fwd peak     90 deg    cloudbow(140)   min ratio")
        for L in (64, 128, 256, 512, 999):
            r = recon(L) / pf
            print(f"   {L:4d}   {r[i0]:8.4f}   {r[i90]:8.4f}   {r[i140]:8.4f}      {r.min():8.4f}")

    negs = np.nonzero(beta < 0)[0]
    if negs.size:
        print(f"  note: beta first goes negative at l={negs[0]} "
              f"-> delta-M f must be clamped >= 0")
    out = os.path.join(HERE, f"beta_{FAMILY}_b{band}_r10.npy")
    np.save(out, beta)
    print(f"  wrote {os.path.basename(out)}\n")
