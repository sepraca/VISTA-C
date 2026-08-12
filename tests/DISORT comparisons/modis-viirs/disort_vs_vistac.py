import json,sys,os,numpy as np,warnings; warnings.filterwarnings("ignore")
# FAMILY (v6.2): "liquid" (default) or "ice". Selects the asset set, the beta files and the
# band list. Ice covers bands 1/2/6/7/20; the two conservative ones (1, 2) are included via
# the SSA_CONSERVATIVE clamp below, matched on the VISTA-C side by SSA_OVERRIDE.
FAMILY = sys.argv[1] if len(sys.argv) > 1 and sys.argv[1] in ("liquid","ice") else "liquid"
# HIGHN=1 selects the 100 M dataset. It prefers a CONTIGUOUS file and falls back to summing
# the five jump()-derived 20 M chunks.
#
# CHUNKING IS NOT A REQUIREMENT -- it is an artifact of the automation that produced these
# results, which caps a single command at ~45 s while 100 M photons takes ~2 min in Node.
# Nothing in VISTA-C or xoshiro128** needs it. A user should simply run
#
#     node vistac_run.mjs <band> 100000000 42 <family>     # -> vista_<family>_b<band>.json
#
# and rename that to vista_<family>_b<band>_100M.json, which this reads directly. The chunked
# path is kept because it is how the committed artifacts were made, and because chunk 0 does
# no jumps and therefore reproduces the contiguous 20 M reference EXACTLY -- an identity
# c5_highN_check.py verifies, and the reason the sum is trustworthy at all.
HIGHN = os.environ.get("HIGHN") == "1"
NCHUNK = 5
TAG = "_100M" if HIGHN else ""
from PythonicDISORT import pydisort
from scipy.interpolate import PchipInterpolator
import matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt
mu0=np.cos(np.radians(30.0)); nMU,nPHI=45,120; dmu=1.0/nMU; dphi=2*np.pi/nPHI
mu_lo=np.array([max(0,1-(i+1)*dmu) for i in range(nMU)]); mu_hi=np.array([1-i*dmu for i in range(nMU)])
mu_c=0.5*(mu_lo+mu_hi); theta=np.degrees(np.arccos(np.clip(mu_c,0,1)))
WL={1:0.65,2:0.86,6:1.64,7:2.13,20:3.75}
# DISORT NUMERICAL SETTINGS: NQuad = 256, NLeg = 255, delta-M ON -- for BOTH families.
#
# These are chosen by DISORT SELF-CONVERGENCE, not by agreement with VISTA-C. That distinction
# is the whole point of this block and was got wrong once already (see below).
#
# Measured max deviation of the phi=0 BRF curve from the converged plateau:
#
#      NQuad      192    256    320  |   384    448    512
#      ice b1    0.62%   ref   0.28% |  9.44% 9.72%  9.77%
#      ice b6    0.22%   ref   0.17% | 10.80% 11.03% 11.03%
#      ice b20   0.18%   ref   0.25% | 19.74% 20.17% 20.19%
#      liquid b6 0.00%   ref   0.00% |  0.00%  0.00%  0.00%
#
# A CLIFF at NQuad 384 for ice, and none at all for liquid. The cause is the ANGULAR GRID the
# tables live on, not the forward peak: liquid uses 1000 Gauss-Legendre nodes, ice only 498
# trapezoidal ones. Past l ~ 320 the ice Legendre projection is aliasing off that finite grid
# -- visible directly in the moments, which stop decaying monotonically (beta_320 = 1.437e-3
# then beta_383 = 1.597e-3, RISING, which a smooth peaked function cannot do). DISORT then
# faithfully propagates the aliasing noise into the radiance field as ringing.
#
# FLUXES ARE BLIND TO ALL OF THIS. R_DIS = 0.43175 for ice b6 at every setting from 128 to 512,
# delta-M on or off. Only the radiance SHAPE moves.
#
# delta-M ON. It matters most where scattering is conservative: ice b1 at NQuad 256 scores
# pooled n_sigma^2 1.47 with delta-M and 18.22 without.
# NT_cor stays OFF: it rebuilds single scattering from the supplied moments, so it injects a
# wrong term (measured BRF 0.069 against a true 0.479 for liquid).
#
# ---------------------------------------------------------------------------------------
# HOW THIS WAS GOT WRONG THE FIRST TIME (2026-08-09), because the failure mode is subtle and
# will recur if anyone re-tunes these by the same route:
#
# The settings were originally chosen as NQuad=512, NLeg=511, delta-M OFF by MINIMIZING pooled
# n_sigma^2 against VISTA-C (45.55 -> 1.22 -> 1.12 -> 1.05 across NQuad 128/256/384/512). That
# produced visibly ringing DISORT curves that a glance at the figure caught immediately.
#
# n_sigma^2 could not have caught it. The 11% ringing sits at theta = 89.4 deg where sigma_MC
# is 16%; across all 45 bins NOT ONE deviation exceeds 2 sigma_MC (median 0.56 sigma). The
# metric asks "is DISORT inside the Monte Carlo noise" -- the right question for VALIDATING
# VISTA-C, but structurally incapable of choosing DISORT's own numerical parameters, since it
# has zero power below the noise floor. Optimizing it drove NLeg up into the aliased moments.
#
# RULE: choose DISORT settings by DISORT self-convergence (no VISTA-C involved), THEN compare.
# Never tune the reference solution to fit the thing being validated.
# ---------------------------------------------------------------------------------------
NQUAD, DELTA_M = 256, True

# Conservative bands (omega0 = 1) are SINGULAR in discrete ordinates. Measured: DISORT
# converges down to 1-1e-7 (spread ~1e-8 across NQuad 64..384) and fails at 1-1e-9.
# vistac_run.mjs is run with SSA_OVERRIDE=0.9999999 for these so BOTH codes solve the
# identical problem; the induced absorption (~3e-6 over ~25 scatterings) is far below the
# 20M-photon noise floor.
SSA_CONSERVATIVE = 1.0 - 1e-7

def get(band,NQ=None):
    if NQ is None: NQ=NQUAD
    if HIGHN and os.path.exists(f"vista_{FAMILY}_b{band}_100M.json"):
        V=json.load(open(f"vista_{FAMILY}_b{band}_100M.json")); N=V["N"]
        w=np.array(V["w"],float).reshape(nMU,nPHI)
    elif HIGHN:
        cs=[json.load(open(f"vista_{FAMILY}_b{band}_c{c}.json")) for c in range(NCHUNK)]
        V=dict(cs[0]); V["N"]=sum(c["N"] for c in cs); V["refl"]=sum(c["refl"] for c in cs)
        V["trans"]=sum(c["trans"] for c in cs)
        w=sum(np.array(c["w"],float).reshape(nMU,nPHI) for c in cs); N=V["N"]
    else:
        V=json.load(open(f"vista_{FAMILY}_b{band}.json")); N=V["N"]; w=np.array(V["w"],float).reshape(nMU,nPHI)
    BV=np.pi*(w/N)/(mu_c[:,None]*dmu*dphi); SV=np.pi*(np.sqrt(np.maximum(w,1))/N)/(mu_c[:,None]*dmu*dphi)
    beta=np.load(f"beta_{FAMILY}_b{band}_r10.npy"); NL=NQ-1
    ss=V["ssa"] if V["ssa"]<1 else SSA_CONSERVATIVE
    o=pydisort(np.array([10.0]),np.array([ss]),NQ,np.atleast_2d(beta[:NL+1]),mu0,1.0,0.0,
               NLeg=NL,NFourier=min(64,NL),
               f_arr=np.array([max(0.0,float(beta[NL]))]) if DELTA_M else np.array([0.0]))
    mu_arr,u=o[0],o[4]; R=float(np.ravel(o[1](np.array([0.0])))[0])/mu0
    def binned(pd):
        phis=np.radians(pd+np.linspace(-1.5,1.5,9))
        r=np.squeeze(u(np.array([0.0]),phis)); up=mu_arr>0; m=mu_arr[up]; oo=np.argsort(m)
        f=PchipInterpolator(m[oo],r[up,:].mean(axis=1)[oo],extrapolate=True)
        return np.array([np.pi*np.trapz(f(np.linspace(mu_lo[i],mu_hi[i],65))*np.linspace(mu_lo[i],mu_hi[i],65),
                        np.linspace(mu_lo[i],mu_hi[i],65))/(mu0*mu_c[i]*(mu_hi[i]-mu_lo[i])) for i in range(nMU)])
    return V,BV,SV,binned,R
bands=[1,2,6,7,20] if FAMILY=="ice" else [2,6,7]
RESULTS={}
fig,axs=plt.subplots(2,len(bands),figsize=(5.3*len(bands),8.4),sharex=True)
print(f"  {'band':>5}{'wl':>6}{'ssa':>10}{'R_VC':>10}{'R_DIS':>10}{'dR/sig':>8}   phi=0 nsig2  phi=180 nsig2  pooled")
for j,band in enumerate(bands):
    V,BV,SV,binned,R=get(band)
    N=V["N"]; sR=np.sqrt((V['refl']/N)*(1-V['refl']/N)/N)
    pool=[]
    for ph in (0,30,60,90,120,150,180):
        ipb=int(round(ph/3.0))%nPHI; d=BV[:,ipb]-binned(float(ph)); pool.append(d/SV[:,ipb])
    n0=np.mean((( BV[:,0]-binned(0.0))/SV[:,0])**2)
    n180=np.mean((( BV[:,60]-binned(180.0))/SV[:,60])**2)
    RESULTS[str(band)]={"wavelength_um":WL[band],"ssa":V["ssa"],"N":N,
        "R_vistac":V["refl"]/N,"R_disort":R,"A_vistac":1-(V["refl"]+V["trans"])/N,
        "T_vistac":V["trans"]/N,"nsig2_phi0":float(n0),"nsig2_phi180":float(n180),
        "nsig2_pooled":float(np.mean(np.concatenate(pool)**2))}
    print(f"  {band:5d}{WL[band]:6.2f}{V['ssa']:10.5f}{V['refl']/N:10.5f}{R:10.5f}{(V['refl']/N-R)/sR:8.1f}   {n0:11.2f}  {n180:13.2f}  {np.mean(np.concatenate(pool)**2):6.2f}")
    for i,(ph,ipb,lab) in enumerate(((0.0,0,"φ = 0°  (forward side)"),(180.0,60,"φ = 180°  (antisolar)"))):
        ax=axs[i,j]; Dv=binned(ph)
        ax.errorbar(theta,BV[:,ipb],yerr=SV[:,ipb],fmt='o',ms=3,lw=0.9,capsize=2,color='#0a7d28',zorder=3,
                    label=f'VISTA-C ({N/1e6:.0f}M)')
        ax.plot(theta,Dv,'-',color='#b00020',lw=1.7,zorder=2,label='PythonicDISORT')
        ax.grid(alpha=0.25); ax.legend(fontsize=8)
        if i==1: ax.set_xlabel('exit zenith Θ (deg)')
        if j==0: ax.set_ylabel(f'{lab}\n\nBDF / BRF')
        if i==0: ax.set_title(f'MODIS band {band}  ({WL[band]:.2f} µm)   ω₀ = {V["ssa"]:.5f}',fontsize=11,pad=8)
        else: ax.set_title(lab,fontsize=9,pad=6)
fig.suptitle(f'C5 validation ({"ice particle" if FAMILY=="ice" else "liquid droplet"}) — VISTA-C vs PythonicDISORT, principal plane\n'
             f'τ=10, Θ₀=30°, A$_s$=0, r$_{{eff}}$=10 µm;  plane-parallel proxy W=500, centered beam, '
             f'{"100M photons (5 × 20M jump() sub-streams)" if HIGHN else "20M photons"} (xoshiro128** seed 42)',
             fontsize=12.5, y=1.02)
fig.tight_layout()
fig.savefig(f"C5_{FAMILY}_principal_plane{TAG}.png",dpi=125,bbox_inches='tight')
json.dump({"family":FAMILY,"rng":{"name":"xoshiro128**","seed":42},"bands":RESULTS},open(f"C5_results_{FAMILY}{TAG}.json","w"),indent=2)
print(f"wrote C5_results_{FAMILY}{TAG}.json")
print(f"\nwrote C5_{FAMILY}_principal_plane{TAG}.png")
