import json,sys,numpy as np,warnings; warnings.filterwarnings("ignore")
# FAMILY (v6.2): "liquid" (default) or "ice". Selects the asset set, the beta files and the
# band list. ICE EXCLUDES BANDS 1 AND 2: both are exactly conservative (ssa = 1.000000) and
# DISORT does not converge there -- measured spread 1.1e-5 across NQuad 64..384, against
# ~1e-7 for the absorbing bands. Same pathology that excluded liquid band 1.
FAMILY = sys.argv[1] if len(sys.argv) > 1 and sys.argv[1] in ("liquid","ice") else "liquid"
from PythonicDISORT import pydisort
from scipy.interpolate import PchipInterpolator
import matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt
mu0=np.cos(np.radians(30.0)); nMU,nPHI=45,120; dmu=1.0/nMU; dphi=2*np.pi/nPHI
mu_lo=np.array([max(0,1-(i+1)*dmu) for i in range(nMU)]); mu_hi=np.array([1-i*dmu for i in range(nMU)])
mu_c=0.5*(mu_lo+mu_hi); theta=np.degrees(np.arccos(np.clip(mu_c,0,1)))
WL={1:0.65,2:0.86,6:1.64,7:2.13,20:3.75}
# PER-FAMILY DISORT SETTINGS (established 2026-08-09 by direct measurement, not assumption):
#
#   liquid: NQuad=128, NLeg=127, delta-M ON.  Converged; pooled n_sigma^2 ~1.0.
#   ice:    NQuad=512, NLeg=511, delta-M OFF.
#
# WHY ICE DIFFERS. Ice has a ~5x stronger forward peak than liquid but is otherwise SMOOTHER
# (no cloudbow or glory), so it needs high NLeg for the peak alone. Measured pooled n_sigma^2
# for ice b6 with delta-M off, sweeping the coupled pair NSTR=NLeg+1:
#     NQuad 128 -> 45.55 | 256 -> 1.22 | 384 -> 1.12 | 512 -> 1.05
# The phase function needs ~383 moments; NSTR must then be >= NLeg+1, a constraint
# PythonicDISORT enforces ("There should be more streams than the number of phase function
# Legendre coefficients used"). Streams and moments are therefore NOT independently tunable.
#
# delta-M is OFF for ice because at NLeg=511 there is no peak left to truncate, and delta-M's
# radiance error (it is exact for FLUX, not radiance) is then pure loss. At LOW NLeg the
# opposite holds -- ice at NQuad=128 scores 2.42 with delta-M and 45.55 without it.
# NT_cor stays off: it rebuilds single scattering from the supplied moments, so at low NLeg
# it injects a wrong term (measured 42.57/158.80 for ice, BRF 0.069 vs 0.479 for liquid).
DISORT_CFG = {"liquid": dict(NQ=128, deltaM=True),
              "ice":    dict(NQ=512, deltaM=False)}

# Conservative bands (omega0 = 1) are SINGULAR in discrete ordinates. Measured: DISORT
# converges down to 1-1e-7 (spread ~1e-8 across NQuad 64..384) and fails at 1-1e-9.
# vistac_run.mjs is run with SSA_OVERRIDE=0.9999999 for these so BOTH codes solve the
# identical problem; the induced absorption (~3e-6 over ~25 scatterings) is far below the
# 20M-photon noise floor.
SSA_CONSERVATIVE = 1.0 - 1e-7

def get(band,NQ=None):
    cfg=DISORT_CFG[FAMILY]
    if NQ is None: NQ=cfg["NQ"]
    V=json.load(open(f"vista_{FAMILY}_b{band}.json")); N=V["N"]; w=np.array(V["w"],float).reshape(nMU,nPHI)
    BV=np.pi*(w/N)/(mu_c[:,None]*dmu*dphi); SV=np.pi*(np.sqrt(np.maximum(w,1))/N)/(mu_c[:,None]*dmu*dphi)
    beta=np.load(f"beta_{FAMILY}_b{band}_r10.npy"); NL=NQ-1
    ss=V["ssa"] if V["ssa"]<1 else SSA_CONSERVATIVE
    o=pydisort(np.array([10.0]),np.array([ss]),NQ,np.atleast_2d(beta[:NL+1]),mu0,1.0,0.0,
               NLeg=NL,NFourier=min(64,NL),
               f_arr=np.array([max(0.0,float(beta[NL]))]) if cfg["deltaM"] else np.array([0.0]))
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
             'τ=10, Θ₀=30°, A$_s$=0, r$_{eff}$=10 µm;  plane-parallel proxy W=500, centered beam, 20M photons (xoshiro128** seed 42)',
             fontsize=12.5, y=1.02)
fig.tight_layout()
fig.savefig(f"C5_{FAMILY}_principal_plane.png",dpi=125,bbox_inches='tight')
json.dump({"family":FAMILY,"rng":{"name":"xoshiro128**","seed":42},"bands":RESULTS},open(f"C5_results_{FAMILY}.json","w"),indent=2)
print(f"wrote C5_results_{FAMILY}.json")
print(f"\nwrote C5_{FAMILY}_principal_plane.png")
