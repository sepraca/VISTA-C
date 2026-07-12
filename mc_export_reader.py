#!/usr/bin/env python3
"""
mc_export_reader.py — Reader and example analysis for mc_cloud_rt_v4 JSON exports.

The browser Monte Carlo cloud RT tool's "Download Data (JSON)" button writes a
self-describing file (format "mc_cloud_rt_export") containing the simulation
inputs, the outcome fluxes/counts, the exit-angle (µ) histograms, the
bidirectional distribution functions (BDF), and the optical path-length
histograms — i.e. the quantitative content of the two diagnostic PNGs.

This module:
  * loads the JSON into a lightweight object with NumPy arrays,
  * prints an example summary (run inputs, energy closure, peak BDF, etc.),
  * optionally builds an ``xarray.Dataset`` with labeled (theta, phi, mu)
    coordinates and writes a CF-style NetCDF file for direct comparison with
    DISORT output.

Dependencies: NumPy (required); xarray + netCDF4 (optional, only for
``to_xarray`` / ``to_netcdf``).

Usage
-----
    python mc_export_reader.py mc_cloud_rt_data_YYYYMMDD_HHMMSS.json
    python mc_export_reader.py run.json --netcdf run.nc

Programmatic
------------
    from mc_export_reader import MCExport
    exp = MCExport.load("run.json")
    print(exp.fluxes["R_reflected"])
    refl_bdf = exp.reflected_bdf          # (n_theta, n_phi) ndarray
    ds = exp.to_xarray()                  # needs xarray
"""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from typing import Any

import numpy as np

EXPECTED_FORMAT = "mc_cloud_rt_export"


@dataclass
class MCExport:
    """Parsed mc_cloud_rt JSON export with arrays as NumPy ndarrays."""

    raw: dict[str, Any]

    # ---- construction -----------------------------------------------------
    @classmethod
    def load(cls, path: str) -> "MCExport":
        with open(path, "r", encoding="utf-8") as fh:
            raw = json.load(fh)
        fmt = raw.get("format")
        if fmt != EXPECTED_FORMAT:
            raise ValueError(
                f"Unexpected file format {fmt!r}; expected {EXPECTED_FORMAT!r}. "
                "Is this a Download Data (JSON) export from mc_cloud_rt_v4?"
            )
        return cls(raw)

    # ---- convenience accessors -------------------------------------------
    @property
    def schema_version(self) -> str:
        return self.raw.get("schema_version", "unknown")

    @property
    def inputs(self) -> dict[str, Any]:
        return self.raw["inputs"]

    @property
    def outputs(self) -> dict[str, Any]:
        return self.raw["outputs"]

    @property
    def fluxes(self) -> dict[str, float]:
        return self.raw["outputs"]["fluxes"]

    @property
    def counts(self) -> dict[str, int]:
        return self.raw["outputs"]["counts"]

    # ---- Uniform-domain outputs (schema >= 1.1; absent for legacy runs) ----
    @property
    def is_uniform_domain(self) -> bool:
        return self.inputs.get("photon_illumination") == "uniform_domain"

    @property
    def domain_factor(self) -> float | None:
        return self.inputs.get("domain_factor")

    @property
    def domain_boundary(self) -> str | None:
        return self.inputs.get("domain_boundary")

    @property
    def cloud_fraction(self) -> float | None:
        return self.outputs.get("cloud_fraction")

    @property
    def uniform_domain_outputs(self) -> dict[str, Any] | None:
        """Domain-wide R/T/A budget + component breakdowns (None for legacy runs)."""
        return self.outputs.get("uniform_domain_outputs")

    # ---- µ histograms -----------------------------------------------------
    @property
    def mu_bin_centers(self) -> np.ndarray:
        return np.asarray(self.raw["mu_histograms"]["mu_bin_centers"], float)

    @property
    def mu_bin_edges(self) -> np.ndarray:
        return np.asarray(self.raw["mu_histograms"]["mu_bin_edges"], float)

    @property
    def mu_reflected(self) -> np.ndarray:
        return np.asarray(self.raw["mu_histograms"]["reflected_counts"], float)

    @property
    def mu_net_transmitted(self) -> np.ndarray:
        return np.asarray(self.raw["mu_histograms"]["net_transmitted_counts"], float)

    # Schema >= 1.2, Uniform-domain runs only (None otherwise). The raw
    # net_transmitted_counts for such runs include the clear-sky-direct delta
    # spike (one bin at exactly Theta0); these are the decontaminated views the
    # on-screen panels actually plot.
    def _opt_mu(self, key: str) -> np.ndarray | None:
        v = self.raw["mu_histograms"].get(key)
        return None if v is None else np.asarray(v, float)

    @property
    def mu_net_transmitted_cloud_only(self) -> np.ndarray | None:
        return self._opt_mu("net_transmitted_counts_cloud_only")

    @property
    def mu_net_transmitted_domain_wide_cloud_only(self) -> np.ndarray | None:
        return self._opt_mu("net_transmitted_counts_domain_wide_cloud_only")

    @property
    def clear_direct_count(self) -> int | None:
        return self.raw["mu_histograms"].get("clear_direct_count")

    @property
    def clear_direct_mu_bin_index(self) -> int | None:
        return self.raw["mu_histograms"].get("clear_direct_mu_bin_index")

    # ---- BDF --------------------------------------------------------------
    @property
    def theta_centers_deg(self) -> np.ndarray:
        return np.asarray(self.raw["bdf"]["theta_centers_deg"], float)

    @property
    def phi_centers_deg(self) -> np.ndarray:
        return np.asarray(self.raw["bdf"]["phi_centers_deg"], float)

    @property
    def mu_centers_bdf(self) -> np.ndarray:
        return np.asarray(self.raw["bdf"]["mu_centers"], float)

    @property
    def reflected_bdf(self) -> np.ndarray:
        return np.asarray(self.raw["bdf"]["reflected_bdf"], float)

    @property
    def net_transmitted_bdf(self) -> np.ndarray:
        return np.asarray(self.raw["bdf"]["net_transmitted_bdf"], float)

    @property
    def reflected_bdf_weights(self) -> np.ndarray:
        return np.asarray(self.raw["bdf"]["reflected_weights"], float)

    @property
    def net_transmitted_bdf_weights(self) -> np.ndarray:
        return np.asarray(self.raw["bdf"]["net_transmitted_weights"], float)

    # Schema >= 1.2, Uniform-domain runs only (None otherwise) -- raw weight
    # tallies for the decontaminated (clear-direct-excluded) views the panels
    # plot. Renormalize with (W/N)*pi/(mu*dmu*dphi) if a BDF is needed.
    def _opt_bdf(self, key: str) -> np.ndarray | None:
        v = self.raw["bdf"].get(key)
        return None if v is None else np.asarray(v, float)

    @property
    def net_transmitted_bdf_weights_cloud_only(self) -> np.ndarray | None:
        return self._opt_bdf("net_transmitted_weights_cloud_only")

    @property
    def net_transmitted_bdf_weights_domain_wide_cloud_only(self) -> np.ndarray | None:
        return self._opt_bdf("net_transmitted_weights_domain_wide_cloud_only")

    # ---- path-length histograms ------------------------------------------
    @property
    def path_bin_edges(self) -> np.ndarray:
        return np.asarray(self.raw["path_length_histograms"]["bin_edges"], float)

    @property
    def path_bin_centers(self) -> np.ndarray:
        e = self.path_bin_edges
        return 0.5 * (e[:-1] + e[1:])

    @property
    def path_reflected(self) -> np.ndarray:
        return np.asarray(self.raw["path_length_histograms"]["reflected_counts"], float)

    @property
    def path_net_transmitted(self) -> np.ndarray:
        return np.asarray(
            self.raw["path_length_histograms"]["net_transmitted_counts"], float
        )

    # ---- xarray / NetCDF --------------------------------------------------
    def to_xarray(self):
        """Return an xarray.Dataset with labeled coordinates (needs xarray)."""
        try:
            import xarray as xr
        except ImportError as exc:  # pragma: no cover
            raise ImportError(
                "to_xarray() requires the 'xarray' package (pip install xarray netCDF4)."
            ) from exc

        theta = self.theta_centers_deg
        phi = self.phi_centers_deg
        mu = self.mu_bin_centers
        pc = self.path_bin_centers

        ds = xr.Dataset(
            data_vars=dict(
                reflected_bdf=(("theta", "phi"), self.reflected_bdf),
                net_transmitted_bdf=(("theta", "phi"), self.net_transmitted_bdf),
                reflected_bdf_weights=(("theta", "phi"), self.reflected_bdf_weights),
                net_transmitted_bdf_weights=(
                    ("theta", "phi"),
                    self.net_transmitted_bdf_weights,
                ),
                mu_reflected=(("mu",), self.mu_reflected),
                mu_net_transmitted=(("mu",), self.mu_net_transmitted),
                path_reflected=(("path",), self.path_reflected),
                path_net_transmitted=(("path",), self.path_net_transmitted),
            ),
            coords=dict(
                theta=("theta", theta, {"units": "degree", "long_name": "exit zenith angle"}),
                phi=("phi", phi, {"units": "degree", "long_name": "exit azimuth angle"}),
                mu=("mu", mu, {"long_name": "|cos(exit zenith)|"}),
                path=("path", pc, {"units": "optical_depth", "long_name": "optical path length"}),
            ),
            attrs={
                "title": "mc_cloud_rt_v4 Monte Carlo cloud RT export",
                "format": self.raw.get("format"),
                "schema_version": self.schema_version,
                "generated": self.raw.get("generated", ""),
                "generator": self.raw.get("generator", ""),
                "observation_geometry": self.outputs.get("observation_geometry", "unknown"),
                # Flatten run inputs and scalar fluxes into global attributes.
                **{f"input_{k}": v for k, v in self.inputs.items() if not isinstance(v, dict)},
                **{f"flux_{k}": v for k, v in self.fluxes.items()},
            },
        )
        ds["reflected_bdf"].attrs["long_name"] = "reflected BDF = (W/N) pi / (mu dmu dphi)"
        ds["net_transmitted_bdf"].attrs["long_name"] = "net-transmitted (down-up) BDF at surface"

        # Uniform-domain additions (schema >= 1.1/1.2) -- attached only when present.
        if self.mu_net_transmitted_cloud_only is not None:
            ds["mu_net_transmitted_cloud_only"] = (("mu",), self.mu_net_transmitted_cloud_only)
            ds["mu_net_transmitted_cloud_only"].attrs["long_name"] = (
                "terminal surface arrivals, cloud-touched photons only "
                "(clear-sky-direct delta spike excluded; matches the on-screen panel)")
        if self.mu_net_transmitted_domain_wide_cloud_only is not None:
            ds["mu_net_transmitted_domain_wide_cloud_only"] = (
                ("mu",), self.mu_net_transmitted_domain_wide_cloud_only)
        if self.net_transmitted_bdf_weights_cloud_only is not None:
            ds["net_transmitted_bdf_weights_cloud_only"] = (
                ("theta", "phi"), self.net_transmitted_bdf_weights_cloud_only)
        if self.net_transmitted_bdf_weights_domain_wide_cloud_only is not None:
            ds["net_transmitted_bdf_weights_domain_wide_cloud_only"] = (
                ("theta", "phi"), self.net_transmitted_bdf_weights_domain_wide_cloud_only)
        udo = self.uniform_domain_outputs
        if udo is not None:
            ds.attrs["cloud_fraction"] = self.cloud_fraction
            ds.attrs["domain_boundary"] = udo.get("domain_boundary", "open")
            for key in ("R_domain", "T_domain", "A_cloud_domain"):
                if key in udo:
                    ds.attrs[f"domain_{key}_flux"] = udo[key]["flux"]
                    ds.attrs[f"domain_{key}_count"] = udo[key]["count"]
            if "closure_R_T_Acloud" in udo:
                ds.attrs["domain_closure_R_T_Acloud"] = udo["closure_R_T_Acloud"]
            # Component breakdowns flattened as attrs (flux only; counts in JSON).
            for group in ("R_components", "T_components", "A_cloud_components"):
                for name, val in (udo.get(group) or {}).items():
                    ds.attrs[f"domain_{group}_{name}_flux"] = val["flux"]
        if self.clear_direct_count is not None:
            ds.attrs["clear_direct_count"] = self.clear_direct_count
        return ds

    def to_netcdf(self, path: str) -> None:
        """Write a CF-style NetCDF file (needs xarray + netCDF4)."""
        self.to_xarray().to_netcdf(path)


# ---------------------------------------------------------------------------
# Example analysis / command-line entry point
# ---------------------------------------------------------------------------
def print_summary(exp: MCExport) -> None:
    inp = exp.inputs
    flux = exp.fluxes
    cnt = exp.counts

    print("=" * 64)
    print(f"mc_cloud_rt export  (schema {exp.schema_version})")
    print(f"  generated: {exp.raw.get('generated', '?')}")
    print("-" * 64)
    print("RUN INPUTS")
    print(f"  photons            : {inp['photons']:,}")
    print(f"  cloud optical depth: {inp['tau_cloud']:.4g}")
    print(f"  horizontal extent  : {inp['horizontal_extent']:.4g} (tau-units)")
    print(f"  solar zenith Theta0: {inp['theta0_deg']:.3f} deg  (mu0 = {inp['mu0']:.4f})")
    print(f"  HG asymmetry g     : {inp['hg_g']:.4g}")
    print(f"  single-scat albedo : {inp['ssa_omega0']:.4g}")
    print(f"  surface albedo A_s : {inp['surface_albedo']:.4g}")
    print(f"  photon illumination: {inp.get('photon_illumination', 'center')}")
    if exp.is_uniform_domain:
        fc = exp.cloud_fraction
        print(f"  domain factor M    : {exp.domain_factor:.4g}"
              + (f"  (cloud fraction f_c = {fc:.4g})" if fc is not None else ""))
        print(f"  domain boundary    : {exp.domain_boundary}")
    print(f"  RNG seed           : {inp['rng_seed']}")
    print("-" * 64)
    print(f"ENERGY BUDGET (per launched photon; observation geometry: {exp.outputs.get('observation_geometry', 'n/a')})")
    print(f"  R  reflected flux (albedo) : {flux['R_reflected']:.5f}  ({cnt['reflected']:,})")
    print(f"  T  net transmitted flux    : {flux['T_net_transmitted']:.5f}  ({cnt['net_transmitted']:,})")
    print(f"  A  cloud absorption        : {flux['A_cloud_absorbed']:.5f}  ({cnt['cloud_absorbed']:,})")
    print(f"  S  flux exiting cloud sides: {flux['S_side_exit']:.5f}  ({cnt['side_exit']:,})")
    print(f"  closure R+T+A+S+Term       : {flux['closure_R_T_A_S_Term']:.5f}  (should be 1)")
    print(f"  mean scatterings/phot : {exp.outputs['mean_scatterings_per_photon']:.3f}")
    print(f"  mean optical path/phot: {exp.outputs['mean_optical_path_per_photon']:.3f}")

    # ENTIRE DOMAIN block (Uniform-domain runs, schema >= 1.1): domain-wide
    # budget, independent of the observation-geometry dropdown above.
    udo = exp.uniform_domain_outputs
    if udo is not None:
        print("-" * 64)
        print("ENTIRE DOMAIN (domain-normalized; independent of observation geometry)")
        for key, label in (("R_domain", "R_domain (all upwelling)      "),
                           ("T_domain", "T_domain (all surface-absorbed)"),
                           ("A_cloud_domain", "A_cloud (domain-normalized)   ")):
            if key in udo:
                print(f"  {label}: {udo[key]['flux']:.5f}  ({udo[key]['count']:,})")
        if "closure_R_T_Acloud" in udo:
            print(f"  closure R+T+A_cloud            : {udo['closure_R_T_Acloud']:.5f}  (should be 1)")
        for group, title in (("R_components", "R components"),
                             ("T_components", "T components"),
                             ("A_cloud_components", "A_cloud components")):
            comps = udo.get(group)
            if comps:
                parts = ", ".join(f"{k}={v['flux']:.4f}" for k, v in comps.items())
                print(f"    {title}: {parts}")
        if exp.clear_direct_count is not None:
            print(f"  clear-sky-direct photons: {exp.clear_direct_count:,} "
                  f"(delta spike at Theta0, mu bin {exp.clear_direct_mu_bin_index}; "
                  "excluded from the *_cloud_only arrays)")
    print("-" * 64)

    # Example derived quantity: integrate the reflected µ histogram and compare
    # with the reported R (both are just photon tallies, so they must match).
    mu_refl_sum = exp.mu_reflected.sum()
    print("CONSISTENCY CHECKS")
    print(f"  sum(mu reflected counts) = {mu_refl_sum:,.0f}  vs  reflected N = {cnt['reflected']:,}")

    # Uniform-domain: components must sum exactly to their domain totals.
    udo = exp.uniform_domain_outputs
    if udo is not None:
        for group, total_key in (("R_components", "R_domain"),
                                 ("T_components", "T_domain"),
                                 ("A_cloud_components", "A_cloud_domain")):
            comps, tot = udo.get(group), udo.get(total_key)
            if comps and tot:
                csum = sum(v["count"] for v in comps.values())
                ok = "OK" if csum == tot["count"] else "MISMATCH"
                print(f"  sum({group}) = {csum:,}  vs  {total_key} N = {tot['count']:,}  [{ok}]")
        if exp.mu_net_transmitted_cloud_only is not None and exp.clear_direct_count is not None:
            raw_sum = exp.mu_net_transmitted.sum()
            sides = exp.outputs.get("observation_geometry") == "all_faces"
            spike = ("includes the clear-direct spike"
                     if sides else "base-derived only (no clear-direct spike)")
            print(f"  raw mu net-transmitted is {spike}; raw sum = {raw_sum:,.0f}")

    # Peak of each BDF and the zenith/azimuth where it occurs.
    for name, grid in (("reflected", exp.reflected_bdf),
                       ("net transmitted", exp.net_transmitted_bdf)):
        if grid.size and np.nanmax(grid) > 0:
            ir, ip = np.unravel_index(np.nanargmax(grid), grid.shape)
            print(
                f"  peak {name} BDF = {grid[ir, ip]:.4f} "
                f"at Theta={exp.theta_centers_deg[ir]:.1f} deg, "
                f"phi={exp.phi_centers_deg[ip]:.1f} deg"
            )

    # Nadir-view reflected BDF (Theta ~ 0): the value most often tabulated.
    theta = exp.theta_centers_deg
    inadir = int(np.argmin(np.abs(theta)))
    nadir_refl = float(np.mean(exp.reflected_bdf[inadir, :]))
    print(f"  nadir (Theta~{theta[inadir]:.1f} deg) reflected BDF, phi-averaged = {nadir_refl:.4f}")
    print("=" * 64)


def main() -> None:
    ap = argparse.ArgumentParser(description="Read an mc_cloud_rt_v4 JSON data export.")
    ap.add_argument("json", help="Path to the exported .json file")
    ap.add_argument("--netcdf", metavar="OUT.nc",
                    help="Also write a CF-style NetCDF (requires xarray + netCDF4)")
    args = ap.parse_args()

    exp = MCExport.load(args.json)
    print_summary(exp)

    if args.netcdf:
        try:
            exp.to_netcdf(args.netcdf)
            print(f"Wrote NetCDF: {args.netcdf}")
        except ImportError as exc:
            print(f"NetCDF export skipped: {exc}")


if __name__ == "__main__":
    main()
