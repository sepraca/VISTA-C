import json, numpy as np
D="/sessions/dreamy-keen-mccarthy/mnt/VISTA-C/data/mie/"
g_=json.load(open(D+"mie_grid.json")); b=json.load(open(D+"mie_band_1.json"))
mu=np.array(g_["xmu"]); wt=np.array(g_["wt"]); k=8
pf=np.array(b["pf"][k]); g=b["g"][k]
print(f"band 1, r_eff={b['cer_um'][k]} um, tabulated g={g:.6f}, ssa={b['ssa'][k]:.6f}")
print(f"  sum(wt)={wt.sum():.6f}   sum(wt*pf)={np.sum(wt*pf):.6f}   -> integral p dmu = {np.sum(wt*pf):.6f}")
# beta_l = sum_i wt_i pf_i P_l(mu_i)   (DISORT 'unweighted' coefficients, beta_0=1, beta_1=g)
NM=1000
beta=np.zeros(NM)
Pm1=np.ones_like(mu); P=mu.copy()
beta[0]=np.sum(wt*pf*Pm1)
beta[1]=np.sum(wt*pf*P)
for l in range(1,NM-1):
    Pp1=((2*l+1)*mu*P-l*Pm1)/(l+1)
    beta[l+1]=np.sum(wt*pf*Pp1)
    Pm1,P=P,Pp1
print(f"  beta_0 = {beta[0]:.8f}  (must be 1)")
print(f"  beta_1 = {beta[1]:.8f}  vs tabulated g = {g:.8f}   diff = {abs(beta[1]-g):.2e}")
print(f"  beta in [0,1]? min={beta.min():.4f} max={beta.max():.4f}")
# how fast do moments decay -> how many are needed
for L in (16,32,64,128,256,512,999):
    print(f"    beta_{L} = {beta[L]:+.5f}")
# reconstruct p from truncated series and compare
def recon(L):
    Pm1=np.ones_like(mu); P=mu.copy()
    s=beta[0]*Pm1*(2*0+1)+beta[1]*P*(2*1+1)
    for l in range(1,L):
        Pp1=((2*l+1)*mu*P-l*Pm1)/(l+1)
        s=s+(2*(l+1)+1)*beta[l+1]*Pp1
        Pm1,P=P,Pp1
    return s/2.0     # back to the table's integral-p-dmu = 1 normalization
ang=np.degrees(np.arccos(np.clip(mu,-1,1)))
i140=int(np.argmin(abs(ang-140))); i0=int(np.argmax(mu)); i90=int(np.argmin(abs(ang-90)))
print("\n  reconstruction vs table (ratio recon/table):")
print("   NLeg    fwd peak     90 deg    cloudbow(140)   min ratio")
for L in (64,128,256,512,999):
    r=recon(L)/pf
    print(f"   {L:4d}   {r[i0]:8.4f}   {r[i90]:8.4f}   {r[i140]:8.4f}      {r.min():8.4f}")
np.save("beta_b1_r10.npy", beta)
print("\n  saved beta_b1_r10.npy")
