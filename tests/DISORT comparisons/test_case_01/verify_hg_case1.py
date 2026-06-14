"""Verification for COT=10, g=0.85, SSA=1, A_sfc=0, mu0=1:
(1) delta-Eddington closed form (Joseph et al. 1976 scaling + Meador-Weaver 1980 conservative-limit solution)
(2) independent vectorized Monte Carlo, 1e7 photons
"""
import numpy as np

tau, g, mu0 = 10.0, 0.85, 1.0

# --- (1) delta-Eddington, conservative limit ---
f = g**2
tau_s = (1.0 - f) * tau          # omega=1
g_s = (g - f) / (1.0 - f)
gam1 = (7.0 - (4.0 + 3.0*g_s)) / 4.0
gam3 = (2.0 - 3.0*g_s*mu0) / 4.0
# Meador & Weaver (1980), conservative (omega=1) two-stream solution:
R_dE = (gam1*tau_s + (gam3 - gam1*mu0)*(1.0 - np.exp(-tau_s/mu0))) / (1.0 + gam1*tau_s)
print(f"delta-Eddington: tau*={tau_s:.4f} g*={g_s:.5f}  R={R_dE:.5f}  T={1-R_dE:.5f}")

# --- (2) independent Monte Carlo ---
rng = np.random.default_rng(12345)
N = 10_000_000
z   = np.zeros(N)                # optical depth coordinate, 0=top, tau=bottom
mu  = np.full(N, mu0)            # downward positive
Rc = Tc = 0
Tdir = 0
first = np.ones(N, bool)
while N > 0:
    s = -np.log(rng.random(N))
    z = z + mu*s
    out_top = z < 0.0
    out_bot = z > tau
    Rc += out_top.sum()
    Tc += out_bot.sum()
    Tdir += (out_bot & first).sum()
    keep = ~(out_top | out_bot)
    z, mu, first = z[keep], mu[keep], np.zeros(keep.sum(), bool)
    N = z.size
    if N == 0: break
    # HG scattering: sample cos(theta_scat), then new mu via random azimuth
    u = rng.random(N)
    ct = (1.0 + g*g - ((1.0 - g*g)/(1.0 - g + 2.0*g*u))**2) / (2.0*g)
    st = np.sqrt(np.maximum(0.0, 1.0 - ct*ct))
    phi = 2.0*np.pi*rng.random(N)
    smu = np.sqrt(np.maximum(0.0, 1.0 - mu*mu))
    mu = mu*ct + smu*st*np.cos(phi)   # rotate polar cosine (azimuth-symmetric problem)
Ntot = 10_000_000
R_mc, T_mc, Tdir_mc = Rc/Ntot, Tc/Ntot, Tdir/Ntot
err = np.sqrt(R_mc*(1-R_mc)/Ntot)
print(f"Monte Carlo (1e7): R={R_mc:.5f} +/- {err:.5f}  T={T_mc:.5f}  T_dir={Tdir_mc:.2e}")
print(f"exp(-tau/mu0) = {np.exp(-tau/mu0):.4e}")
