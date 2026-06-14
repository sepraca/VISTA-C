"""Case 4 bidirectional functions from DISORT (PythonicDISORT).
COT=10, HG g=0.85, SSA=0.98, A_sfc=0, mu0=0.5 (Theta0=60 deg), phi0=0.
BDF = pi*I/(mu0*F0). Azimuth-dependent (non-overhead sun).
"""
import warnings; warnings.filterwarnings("ignore")
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from PythonicDISORT import pydisort

tau_c, g, omega, mu0 = 10.0, 0.85, 0.98, 0.5
NQ = 48
Leg = (g ** np.arange(2*NQ))[None, :]
Nphi = 72
phi = np.linspace(0, 2*np.pi, Nphi, endpoint=False)

mu_arr, fu, fd, u0, u = pydisort(
    np.array([tau_c]), np.array([omega]), NQ, Leg, mu0, 1.0/mu0, 0.0,
    f_arr=float(g**NQ), NT_cor=True)

I_top, I_bot = u(0.0, phi), u(tau_c, phi)
up = mu_arr > 0
mu_up, mu_dn = mu_arr[up], -mu_arr[~up]
BRF, BTF = np.pi*I_top[up, :], np.pi*I_bot[~up, :]
iu, idn = np.argsort(mu_up), np.argsort(mu_dn)
mu_up, BRF = mu_up[iu], BRF[iu, :]
mu_dn, BTF = mu_dn[idn], BTF[idn, :]
vza_up, vza_dn = np.degrees(np.arccos(mu_up)), np.degrees(np.arccos(mu_dn))

# flux closure (trapezoid in mu, exact in phi via mean)
R_int = 2*np.pi*np.trapz(BRF.mean(axis=1)/np.pi*mu_up, mu_up)
T_int = 2*np.pi*np.trapz(BTF.mean(axis=1)/np.pi*mu_dn, mu_dn)
print(f"intensity-integrated: R={R_int:.5f} (flux 0.44907)  T_dif={T_int:.5f} (flux 0.25053)")
print(f"BRF range {BRF.min():.3f}-{BRF.max():.3f}; BTF range {BTF.min():.3f}-{BTF.max():.3f}")

phi_edges = np.linspace(0, 2*np.pi, Nphi+1) - np.pi/Nphi
def edges(c):
    e = np.zeros(c.size+1); e[1:-1]=0.5*(c[1:]+c[:-1]); e[0]=2*c[0]-e[1]; e[-1]=2*c[-1]-e[-2]
    return np.clip(e, 0, 90)

fig = plt.figure(figsize=(13, 5.5), facecolor="black")
for k, (vza, F, ttl) in enumerate([(vza_up, BRF, "Reflected BRF (DISORT)"),
                                   (vza_dn, BTF, "Transmitted diffuse BTF (DISORT)")]):
    ax = fig.add_subplot(1, 2, k+1, projection="polar")
    ax.set_facecolor("black")
    pm = ax.pcolormesh(phi_edges, edges(vza), F, cmap="jet", vmin=0, vmax=1)
    ax.set_theta_zero_location("N"); ax.set_theta_direction(-1)
    ax.set_rlim(0, 90); ax.set_rticks([30, 60])
    ax.tick_params(colors="white"); ax.set_title(ttl + (f"  (max {F.max():.2f}, clipped at 1)" if F.max()>1 else ""), color="white", pad=18, fontsize=10)
    ax.grid(color="white", alpha=0.4)
cb = fig.colorbar(pm, ax=fig.axes, shrink=0.8, pad=0.08)
cb.set_label("BDF", color="white"); cb.ax.tick_params(colors="white")
fig.suptitle("Case 4: COT=10, HG g=0.85, SSA=0.98, A_sfc=0, mu0=0.5 (sun azimuth 0°)",
             color="white", y=0.98)
fig.savefig("disort_case4_bdf_polar.png", dpi=150, facecolor="black", bbox_inches="tight")

# principal-plane profiles (phi=0 forward, phi=180 backward)
i0, i180 = 0, Nphi//2
fig2, ax2 = plt.subplots(figsize=(8, 5))
ax2.plot(vza_up, BRF[:, i0], "o-", label="BRF, $\\phi$=0° (forward)")
ax2.plot(vza_up, BRF[:, i180], "o--", label="BRF, $\\phi$=180° (backward)")
ax2.plot(vza_dn, BTF[:, i0], "s-", label="BTF, $\\phi$=0°")
ax2.plot(vza_dn, BTF[:, i180], "s--", label="BTF, $\\phi$=180°")
ax2.axvline(60, color="gray", ls=":", label="$\\Theta_0$=60°")
ax2.set_xlabel("View zenith angle (deg)"); ax2.set_ylabel("BDF = $\\pi I/(\\mu_0 F_0)$")
ax2.set_title("Case 4 principal-plane profiles")
ax2.grid(alpha=0.3); ax2.legend(); ax2.set_ylim(bottom=0)
fig2.savefig("disort_case4_bdf_pplane.png", dpi=150, bbox_inches="tight")

# full 2D grids
hdr = "VZA_deg," + ",".join(f"phi{np.degrees(p):.0f}" for p in phi)
np.savetxt("disort_case4_brf.csv", np.column_stack([vza_up, BRF]), delimiter=",", header=hdr, comments="")
np.savetxt("disort_case4_btf.csv", np.column_stack([vza_dn, BTF]), delimiter=",", header=hdr, comments="")
print("saved: disort_case4_bdf_polar.png, disort_case4_bdf_pplane.png, disort_case4_brf.csv, disort_case4_btf.csv")
