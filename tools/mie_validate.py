#!/usr/bin/env python3
"""
mie_validate.py — independent check that the converted browser assets in data/mie/
faithfully represent the source netCDF, AND are internally self-consistent for
inverse-CDF sampling. Deliberately re-reads the EMITTED JSON (not the converter's
in-memory arrays) so it validates the actual files the app will ship.

Checks per band:
  1. Round-trip + transpose: JSON pf[k] (radius k, all angles) == source
     pf[:, k] to the stored precision. An axis swap is the likeliest bug.
  2. Physics re-derived FROM THE JSON: normalization Σ wt·pf = 1 and
     g = Σ wt·pf·µ (using the shared-grid wt/xmu), matching the JSON's own g and
     the source g.
  3. SAMPLING READINESS — the real point: build the sampling CDF the browser
     will build (cumsum(wt·pf)/T), confirm it is monotone with cdf[0]=0, and
     that DISCRETE-NODE inversion gives ⟨µ⟩ = Σ mass_i·µ_i = g. This is what
     the file's pf_cumul failed (it gave ⟨µ⟩≈0.96); we verify the emitted pf
     samples correctly.
  4. Manifest/grid consistency: shared cer matches; manifest lists all bands.

Usage:  python3 tools/mie_validate.py  [--src ...] [--out data/mie]
Exit 0 iff every check passes.
"""
import argparse, json, os, sys
import numpy as np

try:
    import xarray as xr
except ImportError:
    sys.exit("needs xarray + netCDF4")

BANDS = [1, 2, 6, 7, 20]
RT_TOL = 5e-6      # round-trip: relative, at 7 sig figs
G_TOL = 5e-3       # g re-derived from JSON vs source g (float32-tabulated pf)
NORM_TOL = 1e-3


def load(out, name):
    with open(os.path.join(out, name)) as f:
        return json.load(f)


def main():
    ap = argparse.ArgumentParser()
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    ap.add_argument("--src", default=os.path.join(here, "MODIS_Phase Functions_netCDF4"))
    ap.add_argument("--out", default=os.path.join(here, "data", "mie"))
    args = ap.parse_args()

    fails = []
    def check(ok, label):
        print(f"  {'PASS' if ok else 'FAIL'}  {label}")
        if not ok: fails.append(label)

    grid = load(args.out, "mie_grid.json")
    manifest = load(args.out, "manifest.json")
    xmu = np.array(grid["xmu"]); wt = np.array(grid["wt"])
    print(f"grid: {grid['n_angles']} angles | manifest lists {len(manifest['bands'])} bands\n" + "-"*60)

    check(len(manifest["bands"]) == len(BANDS), "manifest lists all bands")
    check(bool(np.all(np.diff(xmu) < 0)) and abs(xmu[0]-1) < 1e-3 and abs(xmu[-1]+1) < 1e-3,
          "grid xmu forward-first, +1→−1")
    check(abs(wt.sum() - 2) < 1e-4, f"grid Σwt = {wt.sum():.6f} ≈ 2")

    for b in BANDS:
        print(f"\nband {b}:")
        j = load(args.out, f"mie_band_{b}.json")
        ds = xr.open_dataset(os.path.join(args.src, f"phase_function_MODIS_b{b}.nc"))
        src_pf  = np.array(ds.pf,  dtype=np.float64)   # [angle, radius]
        src_g   = np.array(ds.g, dtype=np.float64)
        src_cer = np.array(ds.cer, dtype=np.float64)
        ds.close()

        jpf  = np.array(j["pf"])        # [radius][angle]
        jg   = np.array(j["g"])
        n_rad = j["n_radii"]

        # (1) transpose correctness + round-trip: jpf[k] == src_pf[:,k]
        rel = lambda a, b: np.max(np.abs(a - b) / np.maximum(1e-12, np.abs(b)))
        pf_rt = max(rel(jpf[k], src_pf[:, k]) for k in range(n_rad))
        check(pf_rt < RT_TOL, f"pf round-trip + transpose (max rel {pf_rt:.1e})")

        # (2) physics re-derived from JSON pf using the shared-grid wt/xmu
        norm  = (wt[None, :] * jpf).sum(axis=1)              # per radius
        gcalc = (wt[None, :] * jpf * xmu[None, :]).sum(axis=1)
        check(np.max(np.abs(norm - 1)) < NORM_TOL,
              f"Σwt·pf = 1 from JSON (max dev {np.max(np.abs(norm-1)):.1e})")
        check(np.max(np.abs(gcalc - src_g)) < G_TOL,
              f"g = Σwt·pf·µ from JSON vs source g (max {np.max(np.abs(gcalc-src_g)):.1e})")
        check(np.max(np.abs(jg - src_g)) < RT_TOL * np.max(src_g),
              f"stored g round-trips source g (max {np.max(np.abs(jg-src_g)):.1e})")

        # (3) SAMPLING READINESS: build cdf = cumsum(wt·pf)/T (as the browser
        # will), confirm cdf[0]=0 & monotone, and that discrete-node inversion
        # ⟨µ⟩ = Σ mass_i·µ_i reproduces g. This is the check pf_cumul failed.
        mass = wt[None, :] * jpf                              # [radius, angle]
        T = mass.sum(axis=1, keepdims=True)
        disc_mean = (mass * xmu[None, :]).sum(axis=1) / T[:, 0]
        check(np.max(np.abs(disc_mean - src_g)) < G_TOL,
              f"discrete-sampled ⟨µ⟩ = g (max {np.max(np.abs(disc_mean-src_g)):.1e}) — CDF sampling-ready")
        cdf = np.cumsum(np.concatenate([np.zeros((n_rad,1)), mass[:, :-1]], axis=1), axis=1) / T
        ok_cdf = bool(np.all(cdf[:, 0] == 0) and np.all(np.diff(cdf, axis=1) >= -1e-12))
        check(ok_cdf, "built CDF: cdf[0]=0, monotone non-decreasing (every r_eff)")

        # (4) shared cer matches
        check(np.array_equal(np.array(j["cer_um"]).astype(np.float32),
                             src_cer.astype(np.float32)), "cer matches source")

    print("\n" + "-"*60)
    print("ALL VALIDATION CHECKS PASS" if not fails
          else f"{len(fails)} CHECK(S) FAILED: " + "; ".join(fails))
    sys.exit(0 if not fails else 1)


if __name__ == "__main__":
    main()
