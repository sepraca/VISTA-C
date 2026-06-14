"""DISORT (PythonicDISORT) 8-case matrix: HG cloud over Lambertian surface.
Reports: R = upward flux at TOA / (mu0*F0);  T_net = net downward flux at base
(= F_down(tau) - F_up(tau), i.e., flux absorbed by surface).
"""
import warnings; warnings.filterwarnings("ignore")
import numpy as np
from PythonicDISORT import pydisort

def run_case(tau_tot, g, omega, mu0, Asfc, NQuad=48):
    NLeg = 2 * NQuad
    Leg = (g ** np.arange(NLeg))[None, :]
    om = min(omega, 1.0 - 1e-9)
    bdrf = [Asfc] if Asfc > 0 else []     # Lambertian: constant 0th Fourier mode
    mu_arr, fu, fd, u0 = pydisort(
        np.array([tau_tot]), np.array([om]), NQuad, Leg,
        mu0, 1.0/mu0, 0.0,
        f_arr=float(Leg[0, NQuad]),
        BDRF_Fourier_modes=bdrf,
        only_flux=True,
    )
    R = float(fu(0.0))
    dn_dif, dn_dir = fd(tau_tot)
    up_bot = float(fu(tau_tot))
    T_dn = float(dn_dif) + float(dn_dir)
    T_net = T_dn - up_bot
    return R, T_dn, T_net, 1.0 - R - T_net   # last = cloud absorptance

cases = [  # (label, omega, mu0, Asfc)
    (1, 1.00, 1.0, 0.0), (2, 1.00, 0.5, 0.0),
    (3, 0.98, 1.0, 0.0), (4, 0.98, 0.5, 0.0),
    (5, 1.00, 1.0, 0.5), (6, 1.00, 0.5, 0.5),
    (7, 0.98, 1.0, 0.5), (8, 0.98, 0.5, 0.5),
]
tau, g = 10.0, 0.85
print(f"{'Case':>4} {'omega':>6} {'mu0':>5} {'Asfc':>5} {'R':>10} {'T_down':>10} {'T_net':>10} {'A_cloud':>10}")
for c, om, mu0, A in cases:
    R, T_dn, T_net, Acld = run_case(tau, g, om, mu0, A)
    print(f"{c:>4} {om:>6.2f} {mu0:>5.2f} {A:>5.2f} {R:>10.5f} {T_dn:>10.5f} {T_net:>10.5f} {Acld:>10.5f}")
