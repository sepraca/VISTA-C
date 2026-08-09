// vistac_run.mjs -- headless VISTA-C run for the C5 DISORT comparison.
//   node vistac_run.mjs <band> <N> [seed]     writes vista_b<band>.json
//
// Paths are resolved RELATIVE to this file. They were previously absolute to one
// particular sandbox (/sessions/...), which meant the C5 pipeline could not be rerun on
// any other machine -- found and fixed during the 2026-07-29 xoshiro128** rerun.
import { readFileSync, writeFileSync } from "node:fs";
const B=new URL("../../../js/", import.meta.url);
const {RNG}=await import(new URL("rng.js", B));
const {Physics}=await import(new URL("physics.js", B));
const D=new URL("../../../data/phase/", import.meta.url);
const gridName=(process.argv[5]||"liquid")==="ice"?"grid_ice.json":"grid_liquid.json";
const grid=JSON.parse(readFileSync(new URL(gridName, D)));
const band=Number(process.argv[2]), N=Number(process.argv[3]), seed=Number(process.argv[4]||42);
// FAMILY (v6.2): "liquid" (default, unchanged for every existing caller) or "ice".
// The two use different angular grids AND different quadrature weights, both of which live
// in the per-family grid file -- so switching family must switch BOTH, never just the table.
const family=process.argv[5]||"liquid";
const bb=JSON.parse(readFileSync(new URL(`${family}_modis_b${band}.json`, D)));
const WT=Float64Array.from(grid.wt), XMU=Float64Array.from(grid.xmu);
// SELECT r_eff BY VALUE, NEVER BY A HARDCODED INDEX (2026-08-08).
// This was `k=8`, which is 10 um in the 24-radius grid of the older per-band assets but
// **12 um** in the 18-radius grid of the operational HDF4 tables (which omit r_eff = 3, 11,
// 13, 15, 17, 19 um). Swapping the asset set would therefore have silently validated a 12 um
// droplet while every label still said 10 um. Look the value up and assert it.
const R_EFF_UM = 10.0;
const k = bb.cer_um.findIndex(v => Math.abs(v - R_EFF_UM) < 1e-9);
if (k < 0) throw new Error(`r_eff ${R_EFF_UM} um not in band ${band}: ${bb.cer_um}`);
const cdf=Physics.buildMieCdf(Float64Array.from(bb.pf[k]),WT);
// SSA_OVERRIDE (v6.2): match DISORT exactly for CONSERVATIVE bands. DISORT cannot solve
// omega0 = 1 (the discrete-ordinate system is singular); it converges down to 1-1e-7 and
// fails at 1-1e-9. For ice bands 1/2 (ssa = 1.000000 exactly) both codes are therefore run
// at 1-1e-7 so they solve the IDENTICAL problem. The induced absorption over ~25
// scatterings is ~3e-6, far below the 20M-photon noise floor (sigma_R ~ 1e-4), so this is a
// faithful conservative-scattering proxy rather than a different physical case.
const ssaUsed = process.env.SSA_OVERRIDE ? Number(process.env.SSA_OVERRIDE) : bb.ssa[k];
const p={tauCloud:10,slabW:500,slabD:500,theta0:30*Math.PI/180,g:bb.g[k],omega0:ssaUsed,
  surfaceAlbedo:0.0,betaExt:10.0,surfaceDistanceKm:0.5,entryMode:"center",mieCdf:cdf,mieXmu:XMU};
const nMU=45,nPHI=120,w=new Float64Array(nMU*nPHI);
RNG.reset(seed); let refl=0, abs_=0, trans=0;
for(let i=0;i<N;i++){
  const r=Physics.simulatePhoton(p,false);
  if(r.status==="absorbed") abs_++;
  else if(r.status==="transmitted"||r.status==="surface_absorbed") trans++;
  if(r.status!=="reflected") continue; refl++;
  const mu=Math.abs(r.dirZ);
  let phi=Math.atan2(r.dirY,r.dirX); if(phi<0)phi+=2*Math.PI;
  const ir=Math.min(nMU-1,Math.max(0,Math.floor((1-mu)*nMU)));
  const dP=2*Math.PI/nPHI;
  const ip=Math.min(nPHI-1,Math.floor(((phi+dP/2)%(2*Math.PI))/dP));
  w[ir*nPHI+ip]++;
}
writeFileSync(new URL(`vista_${family}_b${band}.json`, import.meta.url),JSON.stringify({family,band,N,refl,abs:abs_,trans,nMU,nPHI,w:Array.from(w),
  ssa:ssaUsed,ssa_table:bb.ssa[k],g:bb.g[k]}));
console.log(`${family} band ${band}: ssa=${ssaUsed}  N=${N/1e6}M  R=${(refl/N).toFixed(6)}  A=${(abs_/N).toFixed(6)}  T=${(trans/N).toFixed(6)}  sum=${((refl+abs_+trans)/N).toFixed(6)}`);
