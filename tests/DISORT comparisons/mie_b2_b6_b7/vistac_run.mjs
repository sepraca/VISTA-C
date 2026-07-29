import { readFileSync, writeFileSync } from "node:fs";
const B="/sessions/dreamy-keen-mccarthy/mnt/VISTA-C/js/";
const {RNG}=await import(`file://${B}rng.js`);
const {Physics}=await import(`file://${B}physics.js`);
const D="/sessions/dreamy-keen-mccarthy/mnt/VISTA-C/data/mie/";
const grid=JSON.parse(readFileSync(D+"mie_grid.json"));
const band=Number(process.argv[2]), N=Number(process.argv[3]), seed=Number(process.argv[4]||42);
const bb=JSON.parse(readFileSync(D+`mie_band_${band}.json`));
const WT=Float64Array.from(grid.wt), XMU=Float64Array.from(grid.xmu), k=8;
const cdf=Physics.buildMieCdf(Float64Array.from(bb.pf[k]),WT);
const p={tauCloud:10,slabW:500,slabD:500,theta0:30*Math.PI/180,g:bb.g[k],omega0:bb.ssa[k],
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
writeFileSync(`vista_b${band}.json`,JSON.stringify({band,N,refl,abs:abs_,trans,nMU,nPHI,w:Array.from(w),
  ssa:bb.ssa[k],g:bb.g[k]}));
console.log(`band ${band}: ssa=${bb.ssa[k]}  N=${N/1e6}M  R=${(refl/N).toFixed(6)}  A=${(abs_/N).toFixed(6)}  T=${(trans/N).toFixed(6)}  sum=${((refl+abs_+trans)/N).toFixed(6)}`);
