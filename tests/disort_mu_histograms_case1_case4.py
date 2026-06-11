"""Azimuthally-averaged energy vs mu histograms from DISORT (PythonicDISORT),
replicating the html MC layout: 20 mu bins, x from 1 (left) to 0 (right).
Bar = fraction of incident energy (mu0*F0=1) exiting in that mu bin:
E_i = 2*pi * int_{bin} u0bar(mu) * mu dmu ;  sum_i E_i = R (or T_diffuse).
Case 1: COT=10, g=0.85, SSA=1.00, mu0=1.0, Asfc=0
Case 4: COT=10, g=0.85, SSA=0.98, mu0=0.5, Asfc=0
"""
import warnings; warnings.filterwarnings("ignore")
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from scipy.interpolate import PchipInterpolator
from PythonicDISORT import pydisort

NQ = 48
NBINS = 20
bin_edges = np.linspace(0.0, 1.0, NBINS + 1)

def mu_histogram(tau_c, g, omega, mu0):
    Leg = (g ** np.arange(2*NQ))[None, :]
    om = min(omega, 1.0 - 1e-9)
    mu_arr, fu, fd, u0, u = pydisort(
        np.array([tau_c]), np.array([om]), NQ, Leg, mu0, 1.0/mu0, 0.0,
        f_arr=float(g**NQ), NT_cor=True)
    up = mu_arr > 0
    # azimuthally averaged intensity at quadrature nodes
    I0_top = np.atleast_2d(u0(0.0).T).T[:, 0] if u0(0.0).ndim > 1 else u0(0.0)
    I0_bot = np.atleast_2d(u0(tau_c).T).T[:, 0] if u0(tau_c).ndim > 1 else u0(tau_c)
    R_flux, Tdif_flux = float(fu(0.0)), float(fd(tau_c)[0])
    out = {}
    for key, I, mus in (("R", I0_top[up], mu_arr[up]), ("T", I0_bot[~up], -mu_arr[~up])):
        s = np.argsort(mus)
        mus, I = mus[s], I[s]
        # interpolate I(mu)*mu (zero at mu=0) over (0,1]; pin endpoints
        x = np.concatenate([[0.0], mus, [1.0]])
        y = np.concatenate([[0.0], I*mus, [I[-1]*1.0]])
        f = PchipInterpolator(x, y)
        E = np.array([2*np.pi*f.integrate(a, b) for a, b in zip(bin_edges[:-1], bin_edges[1:])])
        flux = R_flux if key == "R" else Tdif_flux
        E *= flux / E.sum()        # remove ~0.5% interpolation-quadrature residual
        out[key] = E
    return out, R_flux, Tdif_flux

cases = [("Case 1  (SSA=1.00, mu0=1.0)", 10.0, 0.85, 1.00, 1.0),
         ("Case 4  (SSA=0.98, mu0=0.5)", 10.0, 0.85, 0.98, 0.5)]

fig, axes = plt.subplots(2, 2, figsize=(11, 7), facecolor="black")
centers = 0.5*(bin_edges[:-1] + bin_edges[1:])
width = bin_edges[1] - bin_edges[0]
for row, (label, tau_c, g, om, mu0) in enumerate(cases):
    H, R, T = mu_histogram(tau_c, g, om, mu0)
    for col, (key, color, ttl) in enumerate(
            [("R", "#5b8ff9", f"Reflected   R={R:.5f}"),
             ("T", "#90ee90", f"Transmitted (diffuse, net downward)   T={T:.5f}")]):
        ax = axes[row, col]
        ax.set_facecolor("black")
        ax.bar(centers, H[key], width=width*0.92, color=color, edgecolor="black", lw=0.4)
        ax.set_xlim(1.0, 0.0)                      # 1 on left, 0 on right (MC convention)
        ax.set_xticks([1.0, 0.5, 0.0])
        ax.set_xlabel(r"$\mu = |\cos\Theta|$", color="white")
        ax.set_ylabel("energy fraction / bin", color="white", fontsize=9)
        ax.set_title(f"{ttl}", color="white", fontsize=10)
        ax.tick_params(colors="white")
        for sp in ax.spines.values(): sp.set_color("white")
    axes[row, 0].text(-0.22, 0.5, label.split("  ")[0], transform=axes[row,0].transAxes,
                      color="white", fontsize=13, rotation=90, va="center")
fig.suptitle("DISORT azimuthally-averaged exit energy vs $\\mu$  (COT=10, HG g=0.85, A_sfc=0; 20 bins;\n"
             "bar heights are fractions of incident energy — multiply by MC photon count N to compare with MC histograms)",
             color="white", fontsize=10)
fig.tight_layout(rect=[0.02, 0, 1, 0.93])
fig.savefig("disort_mu_histograms.png", dpi=150, facecolor="black", bbox_inches="tight")

# CSV for quantitative comparison
import csv
rows = []
H1, _, _ = mu_histogram(10.0, 0.85, 1.00, 1.0)
H4, _, _ = mu_histogram(10.0, 0.85, 0.98, 0.5)
np.savetxt("disort_mu_histograms.csv",
           np.column_stack([bin_edges[:-1], bin_edges[1:], H1["R"], H1["T"], H4["R"], H4["T"]]),
           delimiter=",", header="mu_lo,mu_hi,case1_R,case1_T,case4_R,case4_T", comments="")
print("sums:", H1["R"].sum(), H1["T"].sum(), H4["R"].sum(), H4["T"].sum())
print("saved disort_mu_histograms.png / .csv")
