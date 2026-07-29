import json,numpy as np,warnings; warnings.filterwarnings("ignore")
from PythonicDISORT import pydisort
from scipy.interpolate import PchipInterpolator
import matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt
mu0=np.cos(np.radians(30.0)); nMU,nPHI=45,120; dmu=1.0/nMU; dphi=2*np.pi/nPHI
mu_lo=np.array([max(0,1-(i+1)*dmu) for i in range(nMU)]); mu_hi=np.array([1-i*dmu for i in range(nMU)])
mu_c=0.5*(mu_lo+mu_hi); theta=np.degrees(np.arccos(np.clip(mu_c,0,1)))
WL={2:0.86,6:1.64,7:2.13}
def get(band,NQ=128):
    V=json.load(open(f"vista_b{band}.json")); N=V["N"]; w=np.array(V["w"],float).reshape(nMU,nPHI)
    BV=np.pi*(w/N)/(mu_c[:,None]*dmu*dphi); SV=np.pi*(np.sqrt(np.maximum(w,1))/N)/(mu_c[:,None]*dmu*dphi)
    beta=np.load(f"beta_b{band}_r10.npy"); NL=NQ-1
    ss=V["ssa"] if V["ssa"]<1 else 1-1e-9
    o=pydisort(np.array([10.0]),np.array([ss]),NQ,np.atleast_2d(beta[:NL+1]),mu0,1.0,0.0,
               NLeg=NL,NFourier=min(64,NL),f_arr=np.array([max(0.0,float(beta[NL]))]))
    mu_arr,u=o[0],o[4]; R=float(np.ravel(o[1](np.array([0.0])))[0])/mu0
    def binned(pd):
        phis=np.radians(pd+np.linspace(-1.5,1.5,9))
        r=np.squeeze(u(np.array([0.0]),phis)); up=mu_arr>0; m=mu_arr[up]; oo=np.argsort(m)
        f=PchipInterpolator(m[oo],r[up,:].mean(axis=1)[oo],extrapolate=True)
        return np.array([np.pi*np.trapz(f(np.linspace(mu_lo[i],mu_hi[i],65))*np.linspace(mu_lo[i],mu_hi[i],65),
                        np.linspace(mu_lo[i],mu_hi[i],65))/(mu0*mu_c[i]*(mu_hi[i]-mu_lo[i])) for i in range(nMU)])
    return V,BV,SV,binned,R
bands=[2,6,7]
fig,axs=plt.subplots(2,3,figsize=(16,8.4),sharex=True)
print(f"  {'band':>5}{'wl':>6}{'ssa':>10}{'R_VC':>10}{'R_DIS':>10}{'dR/sig':>8}   phi=0 nsig2  phi=180 nsig2  pooled")
for j,band in enumerate(bands):
    V,BV,SV,binned,R=get(band)
    N=V["N"]; sR=np.sqrt((V['refl']/N)*(1-V['refl']/N)/N)
    pool=[]
    for ph in (0,30,60,90,120,150,180):
        ipb=int(round(ph/3.0))%nPHI; d=BV[:,ipb]-binned(float(ph)); pool.append(d/SV[:,ipb])
    n0=np.mean((( BV[:,0]-binned(0.0))/SV[:,0])**2)
    n180=np.mean((( BV[:,60]-binned(180.0))/SV[:,60])**2)
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
fig.suptitle('C5 validation — VISTA-C Monte Carlo vs PythonicDISORT, principal plane, absorbing MODIS bands\n'
             'τ=10, Θ₀=30°, A$_s$=0, r$_{eff}$=10 µm;  plane-parallel proxy W=500, centered beam, 20M photons',
             fontsize=12.5, y=1.02)
fig.tight_layout()
fig.savefig("C5_bands_2_6_7_principal_plane.png",dpi=125,bbox_inches='tight')
print("\nwrote C5_bands_2_6_7_principal_plane.png")
