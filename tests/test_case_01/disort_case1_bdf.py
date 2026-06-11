"""Case 1 bidirectional reflectance/transmittance from DISORT (PythonicDISORT).
BRF = pi*I_up(tau=0, mu, phi) / (mu0*F0);  BTF = pi*I_dn(tau=tau_c, mu, phi) / (mu0*F0).
mu0=1 -> field is azimuthally symmetric; polar plots mimic the MC html layout.
"""
import warnings; warnings.filterwarnings("ignore")
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

from PythonicDISORT import pydisort

tau_c, g, mu0 = 10.0, 0.85, 1.0
NQ = 48
Leg = (g ** np.arange(2*NQ))[None, :]
Nphi = 72
phi = np.linspace(0, 2*np.pi, Nphi, endpoint=False)

mu_arr, fu, fd, u0, u = pydisort(
    np.array([tau_c]), np.array([1-1e-9]), NQ, Leg, mu0, 1.0/mu0, 0.0,
    f_arr=float(g**NQ), NT_cor=True)

I_top = u(0.0, phi)          # (NQ, Nphi)
I_bot = u(tau_c, phi)
up = mu_arr > 0              # PythonicDISORT: +mu = upward
mu_up = mu_arr[up]           # ascending 0->1
BRF = np.pi * I_top[up, :]                  # reflected, at TOA
BTF = np.pi * I_bot[~up, :]                 # diffuse transmitted, at base (mu<0, descending order |mu|)
mu_dn = -mu_arr[~up]
# sort both by ascending |mu| for plotting
iu, idn = np.argsort(mu_up), np.argsort(mu_dn)
mu_up, BRF = mu_up[iu], BRF[iu, :]
mu_dn, BTF = mu_dn[idn], BTF[idn, :]

print("azimuthal variation (max-min)/mean: BRF %.2e  BTF %.2e"
      % (np.ptp(BRF, axis=1).max()/BRF.mean(), np.ptp(BTF, axis=1).max()/BTF.mean()))

# flux closure check: integrate BRF/pi * mu over hemisphere == R
from numpy.polynomial.legendre import leggauss
w_half = None
# use the quadrature weights implied by Double-Gauss: just check with trapezoid on mu
R_int = np.trapz(BRF[:,0]/np.pi * mu_up, mu_up) * 2*np.pi / (2*np.pi) * 2*np.pi  # azim-symmetric: 2pi*int(I mu dmu)
R_int = 2*np.pi*np.trapz(I_top[up,0][iu]*mu_up, mu_up)
T_int = 2*np.pi*np.trapz(I_bot[~up,0][idn]*mu_dn, mu_dn)
print(f"flux from intensities: R={R_int:.5f} (DISORT flux 0.42227)  T_dif={T_int:.5f} (0.57768)")

# ---- polar plots (azimuth x view zenith angle), matching MC html style ----
vza_up = np.degrees(np.arccos(mu_up))
vza_dn = np.degrees(np.arccos(mu_dn))
phi_edges = np.linspace(0, 2*np.pi, Nphi+1)

def edges(c):
    e = np.zeros(c.size+1); e[1:-1]=0.5*(c[1:]+c[:-1]); e[0]=c[0]-(e[1]-c[0]); e[-1]=c[-1]+(c[-1]-e[-2])
    return np.clip(e, 0, 90)

fig = plt.figure(figsize=(13, 5.5), facecolor="black")
for k, (vza, F, ttl, N) in enumerate(
        [(vza_up, BRF, "Reflected BRF (DISORT)", None),
         (vza_dn, BTF, "Net Transmitted BTF (DISORT, diffuse)", None)]):
    ax = fig.add_subplot(1, 2, k+1, projection="polar")
    ax.set_facecolor("black")
    order = np.argsort(vza)
    r_e = edges(vza[order])
    pm = ax.pcolormesh(phi_edges, r_e, F[order, :][:, :], cmap="jet", vmin=0, vmax=1)
    ax.set_theta_zero_location("N"); ax.set_theta_direction(-1)
    ax.set_rlim(0, 90); ax.set_rticks([30, 60])
    ax.tick_params(colors="white"); ax.set_title(ttl, color="white", pad=18)
    ax.grid(color="white", alpha=0.4)
cb = fig.colorbar(pm, ax=fig.axes, shrink=0.8, pad=0.08)
cb.set_label("BDF", color="white"); cb.ax.tick_params(colors="white")
fig.suptitle("Case 1: COT=10, HG g=0.85, SSA=1, A_sfc=0, mu0=1   (linear 0-1 scale)",
             color="white", y=0.98)
fig.savefig("disort_case1_bdf_polar.png", dpi=150, facecolor="black", bbox_inches="tight")

# ---- quantitative profile: BDF vs VZA (the useful comparison line) ----
fig2, ax2 = plt.subplots(figsize=(8, 5))
ax2.plot(vza_up, BRF[:, 0], "o-", label="BRF (reflected, TOA)")
ax2.plot(vza_dn, BTF[:, 0], "s-", label="BTF (transmitted diffuse, base)")
ax2.set_xlabel("View zenith angle (deg)"); ax2.set_ylabel("BDF = $\\pi I / (\\mu_0 F_0)$")
ax2.set_title("Case 1 bidirectional functions vs VZA (azimuth-independent for $\\mu_0$=1)")
ax2.grid(alpha=0.3); ax2.legend(); ax2.set_ylim(bottom=0)
fig2.savefig("disort_case1_bdf_vza.png", dpi=150, bbox_inches="tight")

np.savetxt("disort_case1_bdf.csv",
           np.column_stack([vza_up, mu_up, BRF[:, 0], vza_dn, mu_dn, BTF[:, 0]]),
           delimiter=",", header="VZA_up_deg,mu_up,BRF,VZA_dn_deg,mu_dn,BTF", comments="")
print("saved: disort_case1_bdf_polar.png, disort_case1_bdf_vza.png, disort_case1_bdf.csv")
