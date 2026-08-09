#!/usr/bin/env python3
"""phase_convert.py -- HDF4 cloud phase-function tables -> VISTA-C browser JSON assets.

RUN ON THE MAC (needs pyhdf; the assistant's sandbox has no HDF4 library):

    python3 tools/phase_convert.py \
        --hdf "/path/to/IceAndWaterPhaseFunctionData_v6.MODIS.hdf" --instrument modis
    python3 tools/phase_convert.py \
        --hdf "/path/to/IceAndWaterPhaseFunctionData_v6.VIIRS.hdf" --instrument viirs

    # inspect only, write nothing:
    python3 tools/phase_convert.py --hdf ... --instrument modis --dry-run

Reads the ORIGINAL HDF4 directly, bypassing the NetCDF4 intermediates. That is deliberate:
the 2026-08 NetCDF4 conversions carry derived arrays (`pf_g`, `pf_norm`, `pf_cumul`) that do
NOT agree with the `pf` stored beside them, and reading HDF4 avoids them by construction.
`pf` itself was verified byte-faithful between HDF4 and NetCDF4 (band 1, r_eff 10 um,
first three angles matched to all printed digits), so only the derived arrays were affected.

WHAT IT EMITS (data/phase/):
    manifest.json            instruments, bands, per-family r_eff grids, provenance
    grid_liquid.json         xmu, ang_deg, wt   (1000 Gauss-Legendre nodes)
    grid_ice.json            xmu, ang_deg, wt   (498 nodes, trapezoidal weights)
    liquid_<inst>_<band>.json   per band: cer_um, ssa, g, qext, pf[radius][angle]
    ice_<inst>_<band>.json

--------------------------------------------------------------------------------------
FIVE THINGS THAT WILL BITE YOU IF CHANGED CARELESSLY -- all verified, not assumed
--------------------------------------------------------------------------------------
1. DIMENSION ORDER. HDF4 stores the phase functions as [n_cer, n_wl, n_ang]. (The 2026-08
   NetCDF4 files used [n_wl, n_cer, n_ang] -- that conversion transposed.) This script
   asserts the shapes against the radius/wavelength/angle counts so a silent transpose
   cannot happen.

2. THE TWO FAMILIES USE DIFFERENT ANGULAR GRIDS *AND* DIFFERENT NORMALIZATIONS.
     liquid: 1000 Gauss-Legendre nodes, theta 0.137 deg .. 179.863 deg, integral ~1
     ice:     498 near-uniform-in-theta nodes, theta 0.00 .. 180.00 EXACTLY, integral ~2
   The integral convention is measured per band/radius and reported; the script then
   renormalizes everything to VISTA-C's convention (sum w*pf = 1) rather than trusting
   either. Do not hard-code a factor.

3. WEIGHTS ARE NOT IN THE SOURCE FILE. The HDF4 has no `wt`.
     liquid: the 1000 angles ARE Gauss-Legendre nodes -- verified, cos(ang) matches
             numpy.polynomial.legendre.leggauss(1000) to 2.4e-7 (float32 storage limit).
             So the weights are GENERATED here, making the converter self-contained.
     ice:    not a Gaussian grid and no weights exist. Trapezoidal weights in mu are built
             instead; they give sum(w) = 2.00000000 and reproduce the ice asymmetry
             parameter to ~1e-4. Endpoints are exact (mu = +1, -1) so no extrapolation.

4. DO NOT SAMPLE FROM A CUMULATIVE OF `pf` ALONE. The correct mu-space CDF weights each
   node by w*pf. Inverting a plain cumsum(pf) over-weights the forward peak and yields
   sampled <mu> ~ 0.96 against a tabulated g ~ 0.80 (measured 2026-07-22). This script
   emits `pf` and lets the browser build cumsum(w*pf) at selection time, matching the
   existing Physics.buildMieCdf contract.

5. THE LIQUID FORWARD PEAK IS UNDER-RESOLVED AT SHORT WAVELENGTH / LARGE r_eff.
   At band 1 / 30 um the peak half-width is ~0.2 deg while the first node sits at
   0.137 deg, so ONE sample carries ~17% of the whole integral and sum(w*pf) reaches
   ~1.21 before normalization. Renormalizing makes the CDF proper, but the sampled <mu>
   then sits ~0.004 above what a better-resolved table would give. That is a property of
   the source tabulation, not of this code. The script REPORTS the raw integral per
   band/radius so the affected corner stays visible.

   CONFIRMED BY THE FIRST RUN (2026-08-08, MODIS): the liquid source integral spread is
   b1 1.0010-1.2069, b2 1.0006-1.1110, b6 1.0002-1.0296, b7 1.0002-1.0185,
   b20 1.0001-1.0068 -- monotonic in wavelength exactly as the peak-width argument
   predicts. ICE IS NOT AFFECTED: every ice band integrates to 2.0000-2.0000 flat, because
   its 0.01 deg first spacing resolves the peak ~14x better than the liquid grid despite
   having half as many points. The under-resolution flag therefore tests the SPREAD of the
   integral across radii, not its absolute value -- an absolute threshold would flag all of
   ice purely for using the integral-2 convention.
"""
import argparse, json, os, sys, datetime

import numpy as np

try:
    from pyhdf.SD import SD, SDC
except ImportError:
    sys.exit("pyhdf not found.  conda install -c conda-forge pyhdf   (or: pip install pyhdf)")

# Wavelength index -> band label. The HDF4 `WaveLengths` array is
#   [0.659, 0.865, 1.240, 1.640, {2.130 MODIS | 2.250 VIIRS}, 3.750, 11.030]
# Only the bands VISTA-C actually offers are emitted by default; --all-bands adds the rest
# with wavelength-derived labels. VIIRS labels beyond M11 are intentionally NOT guessed.
BANDS = {
    "modis": {0: "b1", 1: "b2", 3: "b6", 4: "b7", 5: "b20"},
    "viirs": {4: "M11"},
}
NOMINAL_UM = {"b1": 0.65, "b2": 0.86, "b6": 1.64, "b7": 2.13, "b20": 3.75, "M11": 2.25}

# Wavelength each band label MUST have in the source, asserted below. Index 4 is the one
# that differs between instruments -- MODIS band 7 at 2.13 um vs VIIRS M11 at 2.25 um -- and
# it is the whole reason M11 is being added (M11 absorbs ~1/3 less than b7 at every radius).
# Both files were verified correct on 2026-08-08; this assert exists so a future file with a
# mislabelled M11 fails loudly instead of silently shipping band 7 data under an M11 label.
EXPECTED_UM = {"b1": 0.659, "b2": 0.865, "b6": 1.640, "b7": 2.130,
               "b20": 3.750, "M11": 2.250}
TOL_WL = 0.005

SIGFIGS = 7          # float32 source carries ~7 significant figures
TOL_GL = 1e-5        # |cos(ang) - leggauss node|, float32 storage limited
TOL_SUMW = 1e-9      # |sum(w) - 2|
TOL_NORM = 1e-12     # |sum(w*pf) - 1| AFTER renormalization


def sig(a, n=SIGFIGS):
    """Round to n significant figures for compact JSON; lossless vs a float32 source."""
    return [float(f"{v:.{n}g}") for v in np.asarray(a, dtype=float).ravel()]


def gauss_legendre_forward(n):
    """GL nodes/weights ordered forward-scattering first: mu = +1 -> -1."""
    x, w = np.polynomial.legendre.leggauss(n)
    return x[::-1].copy(), w[::-1].copy()


def trapezoid_weights_mu(mu):
    """Trapezoidal weights in mu for an arbitrary descending grid.

    Endpoint terms extend to mu = +1 / -1. For the ice grid those extensions are exactly
    zero (theta spans 0..180 inclusive), so nothing is extrapolated; the terms are kept so
    the function stays correct if ever applied to a grid that stops short.
    """
    w = np.zeros_like(mu)
    w[1:-1] = np.abs(mu[2:] - mu[:-2]) / 2.0
    w[0] = abs(mu[1] - mu[0]) / 2.0 + abs(1.0 - mu[0])
    w[-1] = abs(mu[-1] - mu[-2]) / 2.0 + abs(-1.0 - mu[-1])
    return w


def read_hdf(path):
    """Pull the SDs we need, verbatim. Nothing derived is read."""
    sd = SD(path, SDC.READ)
    get = lambda n: np.array(sd.select(n).get(), dtype=np.float64)
    out = {
        "wl":         get("WaveLengths"),
        "ang_liquid": get("ScatAnglesWater"),
        "ang_ice":    get("ScatAnglesIce"),
        "cer_liquid": get("ParticleRadiusWater"),
        "cer_ice":    get("ParticleRadiusIce"),
        "pf_liquid":  get("WaterPhaseFuncVals"),      # [cer, wl, ang]
        "pf_ice":     get("IcePhaseFuncVals"),        # [cer, wl, ang]
        "ssa_liquid": get("SingleScatterAlbedoWater"),# [cer, wl]
        "ssa_ice":    get("SingleScatterAlbedoIce"),
        "qext_liquid":get("ExtinctionCoefficientsWater"),
        "qext_ice":   get("ExtinctionCoefficientsIce"),
        "attrs":      {k: str(v) for k, v in sd.attributes().items()},
    }
    sd.end()
    return out


def build_family(d, family, issues):
    """Return (mu, wt, ang_deg, cer, pf[cer,wl,ang], ssa, qext) with weights constructed."""
    ang = d[f"ang_{family}"]
    cer = d[f"cer_{family}"]
    pf = d[f"pf_{family}"]
    ssa = d[f"ssa_{family}"]
    qext = d[f"qext_{family}"]
    n_cer, n_wl, n_ang = pf.shape

    # --- shape asserts: catches a transposed source before any numbers are written ---
    if n_cer != len(cer) or n_ang != len(ang) or n_wl != len(d["wl"]):
        issues.append(f"{family}: pf shape {pf.shape} does not match "
                      f"(n_cer={len(cer)}, n_wl={len(d['wl'])}, n_ang={len(ang)}) "
                      "-- dimension order may differ from the expected [cer, wl, ang]")
    if ssa.shape != (n_cer, n_wl) or qext.shape != (n_cer, n_wl):
        issues.append(f"{family}: ssa/qext shape {ssa.shape}/{qext.shape} != ({n_cer},{n_wl})")

    mu = np.cos(np.radians(ang))

    if family == "liquid":
        x, w = gauss_legendre_forward(n_ang)
        dev = float(np.max(np.abs(mu - x)))
        if dev > TOL_GL:
            issues.append(f"liquid: cos(ang) deviates from Gauss-Legendre nodes by {dev:.2e} "
                          f"(> {TOL_GL:.0e}) -- grid is not GL; weights would be wrong")
        wt = w
        note = f"Gauss-Legendre, generated; max|cos(ang)-node| = {dev:.2e}"
    else:
        if abs(ang[0]) > 1e-6 or abs(ang[-1] - 180.0) > 1e-6:
            issues.append(f"ice: angles span {ang[0]}..{ang[-1]}, expected exactly 0..180")
        wt = trapezoid_weights_mu(mu)
        note = "trapezoidal in mu; endpoints exact so no extrapolation"

    if abs(wt.sum() - 2.0) > TOL_SUMW:
        issues.append(f"{family}: sum(w) = {wt.sum():.12f}, expected 2")
    return mu, wt, ang, cer, pf, ssa, qext, note


def main():
    ap = argparse.ArgumentParser()
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    ap.add_argument("--hdf", required=True)
    ap.add_argument("--instrument", required=True, choices=["modis", "viirs"])
    ap.add_argument("--out", default=os.path.join(here, "data", "phase"))
    ap.add_argument("--all-bands", action="store_true",
                    help="emit every wavelength, labelling unknown ones by wavelength")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    inst = a.instrument
    d = read_hdf(a.hdf)
    issues = []
    print(f"source     : {a.hdf}")
    print(f"instrument : {inst}")
    for k in ("Thermodynamic Phase", "Habit Type", "Date of File Created"):
        if k in d["attrs"]:
            print(f"  {k}: {d['attrs'][k]}")
    print("-" * 78)

    wl = d["wl"]
    band_map = dict(BANDS[inst])
    if a.all_bands:
        for i in range(len(wl)):
            band_map.setdefault(i, f"wl{wl[i]:g}um".replace(".", "p"))

    # PROVENANCE IS PER INSTRUMENT, NOT PER FILE.
    # The first version kept source_file/source_attrs at the top level, so running VIIRS
    # after MODIS silently overwrote... actually kept MODIS's and DISCARDED VIIRS's. That
    # matters here more than usual: the two files have materially different provenance --
    # VIIRS records mixed Im(n) temperatures ("IM(n) for band 6,7 and ch20 at 265K, 1,2,5
    # @295K") and a different ice weighting ("(sol+sensor) weighting included, CT = 230K")
    # that MODIS does not. Losing either would erase exactly the lineage detail this whole
    # conversion effort exists to get right.
    manifest = {
        "format": "vista-c-phase",
        "version": 1,
        "note": ("Converted directly from the ORIGINAL HDF4. Derived arrays present in the "
                 "2026-08 NetCDF4 intermediates (pf_g, pf_norm, pf_cumul) are deliberately "
                 "NOT used: they disagree with the pf stored beside them. Normalization, g "
                 "and the sampling CDF are computed here / in the browser from pf alone."),
        "instruments": {},
        "families": {},
    }
    inst_block = {
        "source_file": os.path.basename(a.hdf),
        "source_attrs": d["attrs"],
        "generated": datetime.datetime.now(datetime.timezone.utc)
                             .strftime("%Y-%m-%dT%H:%M:%SZ"),
        "families": {},
    }
    manifest["instruments"][inst] = inst_block

    for family in ("liquid", "ice"):
        mu, wt, ang, cer, pf, ssa, qext, wnote = build_family(d, family, issues)
        print(f"\n[{family}]  {len(ang)} angles, {len(cer)} radii  |  weights: {wnote}")

        if not a.dry_run:
            os.makedirs(a.out, exist_ok=True)
            with open(os.path.join(a.out, f"grid_{family}.json"), "w") as f:
                json.dump({"n_angles": len(ang), "xmu": sig(mu),
                           "ang_deg": sig(ang), "wt": sig(wt, 10)}, f)

        manifest["families"][family] = {
            "n_angles": int(len(ang)), "n_radii": int(len(cer)),
            "cer_um": sig(cer), "grid_file": f"grid_{family}.json",
            "weights": wnote,
        }
        bands_out = {}

        for wi, label in sorted(band_map.items()):
            # Guard the instrument-dependent slot: MODIS index 4 is 2.13 um (band 7),
            # VIIRS index 4 is 2.25 um (M11). Getting this wrong would ship band 7 data
            # labelled M11 -- invisible downstream, and the exact opposite of why M11 is
            # being added. Verified correct in both 2017 files; asserted so it stays that way.
            exp = EXPECTED_UM.get(label)
            if exp is not None and abs(float(wl[wi]) - exp) > TOL_WL:
                issues.append(f"{family}/{label}: source wavelength {wl[wi]:.3f} um "
                              f"!= expected {exp:.3f} um -- band mapping is wrong")

            block = pf[:, wi, :]                       # [cer, ang]
            raw = (wt[None, :] * block).sum(axis=1)    # source integral, per radius
            norm = block / raw[:, None]                # -> sum(w*pf) = 1 exactly
            chk = (wt[None, :] * norm).sum(axis=1)
            if np.max(np.abs(chk - 1.0)) > TOL_NORM:
                issues.append(f"{family}/{label}: renormalization failed "
                              f"(max dev {np.max(np.abs(chk-1)):.2e})")
            g = (wt[None, :] * norm * mu[None, :]).sum(axis=1)
            if np.any(g < 0) or np.any(g > 1):
                issues.append(f"{family}/{label}: g outside [0,1]: {g.min():.4f}..{g.max():.4f}")

            # UNDER-RESOLUTION TEST MUST BE CONVENTION-INDEPENDENT.
            # The first version compared raw.max() against a fixed 1.05, which flagged every
            # ice band -- ice integrates to 2 by convention, not 1, so a fixed threshold is
            # meaningless. The real signature of an under-resolved forward peak is that the
            # integral VARIES ACROSS RADII (the peak narrows as r_eff grows until one node
            # carries it), so test the spread, which needs no knowledge of the convention.
            # Liquid b1: 1.0010-1.2069 -> ratio 1.206, flagged.  Ice: 2.0000-2.0000 -> 1.000.
            spread = raw.max() / raw.min() if raw.min() > 0 else float("inf")
            print(f"   {label:>5} ({wl[wi]:6.3f} um): "
                  f"g {g.min():.4f}-{g.max():.4f}   "
                  f"ssa {ssa[:,wi].min():.5f}-{ssa[:,wi].max():.5f}   "
                  f"source integral {raw.min():.4f}-{raw.max():.4f} (spread {spread:.4f})"
                  + ("   <-- forward peak under-resolved at large r_eff"
                     if spread > 1.05 else ""))

            bands_out[label] = {"wavelength_um": float(wl[wi]),
                                "nominal_um": NOMINAL_UM.get(label),
                                "source_integral": sig(raw)}
            if not a.dry_run:
                with open(os.path.join(a.out, f"{family}_{inst}_{label}.json"), "w") as f:
                    json.dump({
                        "family": family, "instrument": inst, "band": label,
                        "wavelength_um": float(wl[wi]),
                        "cer_um": sig(cer), "ssa": sig(ssa[:, wi]),
                        "g": sig(g), "qext": sig(qext[:, wi]),
                        "source_integral": sig(raw),
                        "pf": [sig(norm[i]) for i in range(len(cer))],
                        "normalization": "sum(wt*pf) = 1 per radius",
                    }, f)
        inst_block["families"][family] = bands_out

    if not a.dry_run:
        mpath = os.path.join(a.out, "manifest.json")
        existing = {}
        if os.path.exists(mpath):                      # merge, so MODIS+VIIRS can coexist
            try:
                existing = json.load(open(mpath))
            except Exception:
                pass
        if existing.get("format") == "vista-c-phase":
            existing.setdefault("instruments", {}).update(manifest["instruments"])
            existing.setdefault("families", {}).update(manifest["families"])
            manifest = existing
        with open(mpath, "w") as f:
            json.dump(manifest, f, indent=1)

    print("\n" + "-" * 78)
    if issues:
        print(f"{len(issues)} ISSUE(S) -- nothing should be trusted until these are resolved:")
        for s in issues:
            print("  ! " + s)
        sys.exit(1)
    print("all provenance checks passed" + ("  (dry run, nothing written)" if a.dry_run
          else f"  -> {a.out}"))


if __name__ == "__main__":
    main()
