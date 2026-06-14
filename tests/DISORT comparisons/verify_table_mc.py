import numpy as np
def mc(tau, g, omega, mu0, Asfc, N=10_000_000, seed=7):
    rng = np.random.default_rng(seed)
    z = np.zeros(N); mu = np.full(N, mu0)
    Rc = 0; Snet = 0  # photons out top; photons absorbed by surface
    while z.size:
        s = -np.log(rng.random(z.size))
        z = z + mu*s
        top = z < 0
        Rc += top.sum()
        bot = z > tau
        if bot.any():
            nb = bot.sum()
            refl = rng.random(nb) < Asfc
            Snet += (~refl).sum()
            # reflected: Lambertian upward, restart at z=tau
            zb = np.full(refl.sum(), tau)
            mub = -np.sqrt(rng.random(refl.sum()))
            keep = ~(top | bot)
            z = np.concatenate([z[keep], zb]); mu = np.concatenate([mu[keep], mub])
            # reflected photons skip this round's scattering (they just left surface)
            nscat = keep.sum()
        else:
            keep = ~top
            z, mu = z[keep], mu[keep]
            nscat = z.size
        if z.size == 0: break
        # scatter only the first nscat (in-cloud) photons; absorb with prob 1-omega
        zi, mi = z[:nscat], mu[:nscat]
        alive = rng.random(nscat) < omega
        zi, mi = zi[alive], mi[alive]
        u = rng.random(zi.size)
        ct = (1+g*g-((1-g*g)/(1-g+2*g*u))**2)/(2*g)
        st = np.sqrt(np.maximum(0,1-ct*ct))
        phi = 2*np.pi*rng.random(zi.size)
        smu = np.sqrt(np.maximum(0,1-mi*mi))
        mi = mi*ct + smu*st*np.cos(phi)
        z = np.concatenate([zi, z[nscat:]]); mu = np.concatenate([mi, mu[nscat:]])
    return Rc/N, Snet/N
for (label, om, mu0, A) in [("Case 2",1.0,0.5,0.0), ("Case 7",0.98,1.0,0.5)]:
    R, Tnet = mc(10.0, 0.85, om, mu0, A)
    print(f"{label}: MC R={R:.5f} (+/-{np.sqrt(R*(1-R)/1e7):.5f})  T_net={Tnet:.5f}")
