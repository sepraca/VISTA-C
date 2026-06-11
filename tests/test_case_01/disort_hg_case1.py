import warnings; warnings.filterwarnings("ignore")
"""DISORT (PythonicDISORT) test case: HG phase function cloud layer.
Case: COT=10, g=0.85, SSA=1.0, A_sfc=0, mu0=1.0
Fluxes normalized to incident flux mu0*I0 = 1.
"""
import numpy as np
from PythonicDISORT import pydisort

def run_case(tau_tot, g, omega, mu0, NQuad, NLeg=None):
    if NLeg is None:
        NLeg = NQuad
    ells = np.arange(NLeg)
    Leg_coeffs = (g ** ells)[None, :]          # HG: chi_l = g^l, unweighted
    I0 = 1.0 / mu0                             # incident flux mu0*I0 = 1
    # cap omega just below 1 (DISORT-style handling of conservative scattering)
    om = min(omega, 1.0 - 1e-9)
    mu_arr, flux_up, flux_down, u0 = pydisort(
        np.array([tau_tot]), np.array([om]), NQuad, Leg_coeffs,
        mu0, I0, 0.0,
        f_arr=float(Leg_coeffs[0, NQuad]) if NLeg > NQuad else 0.0,  # delta-M scaling
        only_flux=True,
    )
    R = float(flux_up(0.0))                 # reflected flux at TOA
    down_diffuse, down_direct = flux_down(tau_tot)
    Tdif = float(down_diffuse)
    Tdir = float(down_direct)
    T = Tdif + Tdir
    A = 1.0 - R - T                            # absorptance (A_sfc=0 -> no sfc absorption)
    return R, T, Tdir, Tdif, A

tau, g, omega, mu0 = 10.0, 0.85, 1.0, 1.0
print(f"Case: COT={tau}, g={g}, SSA={omega}, A_sfc=0, mu0={mu0}  (HG phase function)")
print(f"{'NQuad':>6} {'R':>12} {'T_total':>12} {'T_direct':>12} {'T_diffuse':>12} {'1-R-T':>12}")
for NQ in (16, 32, 48, 64):
    # use more Legendre moments than streams; delta-M handles the truncation
    R, T, Tdir, Tdif, A = run_case(tau, g, omega, mu0, NQ, NLeg=2*NQ)
    print(f"{NQ:>6} {R:>12.8f} {T:>12.8f} {Tdir:>12.4e} {Tdif:>12.8f} {A:>12.2e}")
