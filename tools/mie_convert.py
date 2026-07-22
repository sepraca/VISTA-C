#!/usr/bin/env python3
"""
mie_convert.py — offline converter: MODIS Mie phase-function netCDF4 → browser assets.

VISTA-C is a no-bundler, browser-native ES-module app, and browsers cannot read
netCDF. This script (run once, offline; its OUTPUT is committed, its INPUT is the
gitignored source folder) turns the five MODIS-band `.nc` files into compact JSON
the app fetches on demand.

Design (see TODO-post-v6.0.7.md, section C):
  * The scattering-angle grid (xmu = cos θ, forward-first +1→−1) and the Gaussian
    quadrature weights (wt) are IDENTICAL across all bands (verified), so they are
    written ONCE to a shared grid file rather than duplicated per band.
  * Per band: the sampling CDF `pf_cumul`, the phase function `pf` (for the in-app
    plot and validation), and the per-r_eff scalars cer/ssa/g/qext. The 2-D arrays
    are TRANSPOSED to [radius][angle] so the runtime kernel can slice one radius's
    1000-point CDF as a contiguous array: `band.pf_cumul[reffIndex]`.
  * A manifest lists the bands (with nominal wavelength labels) and the r_eff grid,
    so the UI can build its band/r_eff selectors without fetching any band data.

Normalization convention IN THESE FILES (verified, not assumed — see the asserts):
  Σ_i wt_i · pf_i = 1  per radius   (matches the file's `pf_norm`)
  g = Σ_i wt_i · pf_i · µ_i         (no ½ factor; reproduces tabulated `g`)

SAMPLING CDF — a deliberate design decision (2026-07-22): this converter does NOT
ship the file's `pf_cumul`. That variable is the cumulative of `pf` ALONE (no
quadrature weights); inverting it in µ over-weights the forward peak and yields a
sampled ⟨µ⟩ ≈ 0.96 instead of the tabulated g ≈ 0.80 (found via the ⟨µ⟩-vs-g gate in
verify_mie_sampling.mjs). The CORRECT µ-space CDF weights each node by wt·pf. We emit
`pf` (needed for the plot anyway) and let the browser build the CDF = cumsum(wt·pf)/T
at band selection (Physics.buildMieCdf) — so there is a single CDF construction, no
redundant/possibly-stale stored CDF, and ~half the per-band file size. This converter
ASSERTS that discrete-node inversion of that CDF reproduces g, so the emitted `pf` is
proven sampling-ready.

Usage:
    python3 tools/mie_convert.py
      [--src "MODIS_Phase Functions_netCDF4"] [--out data/mie] [--sigfigs 7]

Re-running on the same source produces byte-identical output (provenance uses the
source file's own creation_date, not the converter run time).
"""
import argparse, json, os, sys
import numpy as np

try:
    import xarray as xr
except ImportError:
    sys.exit("needs xarray + netCDF4:  pip install xarray netCDF4 --break-system-packages")

# MODIS cloud-retrieval bands present, with NOMINAL band-center wavelengths (µm,
# 2 decimals — author-confirmed sufficient) for UI labels only. The .nc integrates
# over each band's full RSR, so there is no single λ in the file.
BANDS = [1, 2, 6, 7, 20]
WAVELENGTH_UM = {1: 0.65, 2: 0.86, 6: 1.64, 7: 2.13, 20: 3.75}

TOL_G = 5e-3       # |g_computed − g_tabulated| — the phase function is float32-tabulated
TOL_NORM = 1e-3    # |Σ wt·pf − 1|
TOL_CDF = 1e-4     # |pf_cumul[-1] − 1|


def sig(a, n):
    """Round an array to n significant figures via float(f'{v:.{n}g}') — compact JSON,
    lossless relative to the float32 source (float32 carries ~7 sig figs)."""
    return [float(f"{v:.{n}g}") for v in np.asarray(a, dtype=float).ravel()]


def main():
    ap = argparse.ArgumentParser()
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # repo root
    ap.add_argument("--src", default=os.path.join(here, "MODIS_Phase Functions_netCDF4"))
    ap.add_argument("--out", default=os.path.join(here, "data", "mie"))
    ap.add_argument("--sigfigs", type=int, default=7)
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)

    print(f"source: {args.src}\noutput: {args.out}\n" + "-" * 64)
    ref_xmu = ref_wt = ref_ang = ref_cer = None
    manifest_bands = []
    all_ok = True

    for b in BANDS:
        path = os.path.join(args.src, f"phase_function_MODIS_b{b}.nc")
        ds = xr.open_dataset(path)
        xmu = np.array(ds.xmu, dtype=np.float64)
        ang = np.array(ds.ang, dtype=np.float64)
        wt  = np.array(ds.wt,  dtype=np.float64)
        pf  = np.array(ds.pf,  dtype=np.float64)      # [angle, radius]
        cer = np.array(ds.cer, dtype=np.float64)
        ssa = np.array(ds.ssa, dtype=np.float64)
        g   = np.array(ds.g,   dtype=np.float64)
        qext= np.array(ds.Qext,dtype=np.float64)
        creation = str(ds.attrs.get("creation_date", "unknown"))
        ds.close()

        n_ang, n_rad = pf.shape
        issues = []

        # --- provenance asserts (fail loud rather than emit a wrong asset) ---
        if not np.all(np.diff(xmu) < 0):
            issues.append("xmu not strictly descending (expected forward-first +1→−1)")
        if abs(xmu[0] - 1.0) > 1e-3 or abs(xmu[-1] + 1.0) > 1e-3:
            issues.append(f"xmu endpoints {xmu[0]:.6f}..{xmu[-1]:.6f} not ≈ +1..−1")
        if abs(wt.sum() - 2.0) > 1e-5:
            issues.append(f"Σwt = {wt.sum():.8f} ≠ 2")
        if ref_xmu is None:
            ref_xmu, ref_wt, ref_ang, ref_cer = xmu, wt, ang, cer
        else:
            if not np.array_equal(xmu.astype(np.float32), ref_xmu.astype(np.float32)):
                issues.append("xmu grid differs from band 1 (shared-grid assumption broken)")
            if not np.array_equal(cer.astype(np.float32), ref_cer.astype(np.float32)):
                issues.append("cer grid differs from band 1")

        if np.any(pf <= 0):
            issues.append("pf has non-positive entries")

        # normalization Σwt·pf == 1 and g == Σwt·pf·µ, per radius (the strong check)
        norm  = (wt[:, None] * pf).sum(axis=0)
        gcalc = (wt[:, None] * pf * xmu[:, None]).sum(axis=0)
        dnorm = np.max(np.abs(norm - 1))
        dg = np.max(np.abs(gcalc - g))
        if dnorm > TOL_NORM: issues.append(f"max|Σwt·pf − 1| = {dnorm:.2e} > {TOL_NORM}")
        if dg > TOL_G:       issues.append(f"max|g_calc − g_tab| = {dg:.2e} > {TOL_G}")

        # SAMPLING-READY: the browser builds cdf = cumsum(wt·pf)/T; discrete-node
        # inversion has ⟨µ⟩ = Σ mass_i·µ_i = g. Assert it here so the emitted `pf`
        # is proven to sample correctly (this is what pf_cumul failed to do).
        mass = wt[:, None] * pf                         # [angle, radius]
        T = mass.sum(axis=0)
        disc_mean = (mass * xmu[:, None]).sum(axis=0) / T
        dgs = np.max(np.abs(disc_mean - g))
        if dgs > TOL_G:
            issues.append(f"max|discrete-sampled ⟨µ⟩ − g| = {dgs:.2e} > {TOL_G} (CDF not sampling-ready)")

        status = "OK  " if not issues else "FAIL"
        if issues: all_ok = False
        print(f"{status} band {b:2d} (λ~{WAVELENGTH_UM[b]} µm): "
              f"{n_rad} r_eff, ssa {ssa.min():.3f}..{ssa.max():.3f}, "
              f"g {g.min():.3f}..{g.max():.3f} | max|g_calc−g|={dg:.1e} "
              f"max|⟨µ⟩_sample−g|={dgs:.1e} max|norm−1|={dnorm:.1e}")
        for it in issues:
            print("       ! " + it)

        # --- write per-band asset (transpose pf to [radius][angle]) ---
        # `pf[k]` is radius k's phase function at the shared angle nodes; the
        # browser builds the sampling CDF from it + grid `wt`. The file's
        # pf_cumul is intentionally NOT emitted (see module docstring).
        band_obj = {
            "band": b,
            "wavelength_um": WAVELENGTH_UM[b],
            "source_creation_date": creation,
            "n_radii": n_rad,
            "n_angles": n_ang,
            "cer_um": sig(cer, args.sigfigs),
            "ssa": sig(ssa, args.sigfigs),
            "g": sig(g, args.sigfigs),
            "qext": sig(qext, args.sigfigs),
            "pf": [sig(pf[:, k], args.sigfigs) for k in range(n_rad)],
        }
        with open(os.path.join(args.out, f"mie_band_{b}.json"), "w") as f:
            json.dump(band_obj, f, separators=(",", ":"))

        manifest_bands.append({
            "band": b, "wavelength_um": WAVELENGTH_UM[b],
            "label": f"MODIS band {b} — {WAVELENGTH_UM[b]:.2f} µm",
            "file": f"mie_band_{b}.json",
        })

    # --- shared grid + manifest ---
    with open(os.path.join(args.out, "mie_grid.json"), "w") as f:
        json.dump({"n_angles": len(ref_xmu),
                   "xmu": sig(ref_xmu, args.sigfigs),
                   "ang_deg": sig(ref_ang, args.sigfigs),
                   "wt": sig(ref_wt, args.sigfigs)},
                  f, separators=(",", ":"))
    with open(os.path.join(args.out, "manifest.json"), "w") as f:
        json.dump({"format": "vista-c-mie", "version": 1,
                   "source": "MODIS_Phase Functions_netCDF4 / write_phase_function_nc4.py",
                   "note": "Wavelengths are nominal MODIS band centers (UI labels); the "
                           "phase functions are RSR-band-integrated. ssa and g vary with r_eff.",
                   "n_angles": len(ref_xmu), "n_radii": len(ref_cer),
                   "cer_um": sig(ref_cer, args.sigfigs),
                   "grid_file": "mie_grid.json", "bands": manifest_bands},
                  f, indent=2)

    print("-" * 64)
    sizes = {fn: os.path.getsize(os.path.join(args.out, fn))
             for fn in sorted(os.listdir(args.out)) if fn.endswith(".json")}
    for fn, sz in sizes.items():
        print(f"  {fn:24s} {sz/1024:7.1f} kB")
    print(f"  {'TOTAL':24s} {sum(sizes.values())/1024:7.1f} kB")
    print("\n" + ("ALL BANDS OK" if all_ok else "SOME BANDS FAILED — assets NOT trustworthy"))
    sys.exit(0 if all_ok else 1)


if __name__ == "__main__":
    main()
