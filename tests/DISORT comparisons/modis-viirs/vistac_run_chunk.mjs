// vistac_run_chunk.mjs -- one jump()-derived chunk of a large C5 run.
//
//   node vistac_run_chunk.mjs <band> <chunkIndex> <photonsPerChunk> [seed] [family]
//       -> writes vista_<family>_b<band>_c<chunkIndex>.json
//
// FAMILY (added 2026-08-11): "liquid" (default) or "ice". This file hardcoded the liquid
// grid and the pre-v6.2 output name long after the two-family split landed, so it could not
// be run at all against the current asset layout -- and c5_highN_check.py looked for the
// retired name vista_b<band>.json, which would have crashed on the first line it reached.
// Same staleness class as the regen_exports.py schema-1.7 bug: a script only reachable by
// running it, and nobody ran it for two releases.
//
// WHY CHUNKED -- AND WHAT THIS DOES *NOT* MEAN. Chunking here is purely an execution
// workaround: the automation used to produce the C5 comparison caps a single command at
// ~45 s, while a contiguous 100 M-photon band takes ~165 s in Node. It is NOT a limit of
// VISTA-C or of the generator, and nothing here implies 20 M is a practical ceiling.
// xoshiro128**'s period is 2^128 ~ 3.4e38 draws; at ~83 draws/photon (tau=10) that is
// ~4e36 photons, roughly 1e28 times the app's own 100 M cap. The only real constraint is
// wall-clock: ~0.88 M photons/s, so 100 M is about two minutes. Use vistac_run.mjs for a
// single contiguous run whenever you can.
//
// Chunking does earn a second keep: it is the exact accumulation pattern that FAILED under
// mulberry32 and produced the spurious ~2 % "residual" against DISORT (TODO section R), and
// jump() is the primitive a future Web Worker implementation would use -- so running the
// high-N confirmation this way also tests the fix in the place it actually broke.
//
// HOW THE SUB-STREAMS ARE DERIVED -- this is the whole point. Chunk k is
// RNG.reset(seed) followed by k calls to RNG.jump(), each advancing 2^64 draws. The chunks
// are therefore disjoint by construction. This is NOT the same as seeding chunk k with
// seed+k*offset: mulberry32's seeds are phases of ONE cycle, so arithmetic offsets overlap
// whenever the offset is smaller than the draws consumed (measured rho ~ 0.32 for 600 M
// offsets against 1.65e9 draws), which inflates the variance of the sum as 1+(k-1)rho.
// Never reintroduce that shortcut.
//
// SELF-CHECK BUILT IN: chunk 0 performs no jumps, so its stream is identical to a plain
// contiguous run at the same seed. merge_chunks.mjs asserts chunk 0's grid equals the
// committed vista_b<band>.json grid bin-for-bin -- if the chunking machinery were wrong,
// that equality would break.
import { readFileSync, writeFileSync } from "node:fs";
const B = new URL("../../../js/", import.meta.url);
const { RNG } = await import(new URL("rng.js", B));
const { Physics } = await import(new URL("physics.js", B));
const D = new URL("../../../data/phase/", import.meta.url);

const band = Number(process.argv[2]);
const chunk = Number(process.argv[3]);
const N = Number(process.argv[4]);
const seed = Number(process.argv[5] || 42);

const family = process.argv[6] || "liquid";
const grid = JSON.parse(readFileSync(new URL(`grid_${family}.json`, D)));
const bb = JSON.parse(readFileSync(new URL(`${family}_modis_b${band}.json`, D)));
const WT = Float64Array.from(grid.wt), XMU = Float64Array.from(grid.xmu);
// SELECT r_eff BY VALUE, NEVER BY A HARDCODED INDEX (2026-08-08).
// This was `k = 8`, which is 10 um in the 24-radius grid of the older per-band assets but
// **12 um** in the 18-radius grid of the operational HDF4 tables (which omit r_eff = 3, 11,
// 13, 15, 17, 19 um). Swapping the asset set would therefore have silently validated a 12 um
// droplet while every label still said 10 um. Look the value up and assert it.
const R_EFF_UM = 10.0;
const k = bb.cer_um.findIndex(v => Math.abs(v - R_EFF_UM) < 1e-9);
if (k < 0) throw new Error(`r_eff ${R_EFF_UM} um not in band ${band}: ${bb.cer_um}`);
const cdf = Physics.buildMieCdf(Float64Array.from(bb.pf[k]), WT);
// SSA_OVERRIDE: mirrors vistac_run.mjs. Ice b1/b2 are EXACTLY conservative (ssa = 1), which
// is singular in discrete ordinates -- DISORT converges only down to 1-1e-7. Both codes must
// therefore solve the identical problem, so these bands are run with SSA_OVERRIDE=0.9999999.
// Missing here until 2026-08-11, which would have made a 100 M ice b1/b2 run compare a
// conservative MC against a slightly absorbing DISORT and manufactured a fake bias.
const ssaUsed = process.env.SSA_OVERRIDE ? Number(process.env.SSA_OVERRIDE) : bb.ssa[k];

// Identical to vistac_run.mjs -- the plane-parallel proxy case.
const p = { tauCloud: 10, slabW: 500, slabD: 500, theta0: 30 * Math.PI / 180,
            g: bb.g[k], omega0: ssaUsed, surfaceAlbedo: 0.0, betaExt: 10.0,
            surfaceDistanceKm: 0.5, entryMode: "center", mieCdf: cdf, mieXmu: XMU };

const nMU = 45, nPHI = 120, w = new Float64Array(nMU * nPHI);
RNG.reset(seed);
for (let j = 0; j < chunk; j++) RNG.jump();
const stateAtStart = RNG.state();

let refl = 0, abs_ = 0, trans = 0;
for (let i = 0; i < N; i++) {
  const r = Physics.simulatePhoton(p, false);
  if (r.status === "absorbed") abs_++;
  else if (r.status === "transmitted" || r.status === "surface_absorbed") trans++;
  if (r.status !== "reflected") continue;
  refl++;
  const mu = Math.abs(r.dirZ);
  let phi = Math.atan2(r.dirY, r.dirX); if (phi < 0) phi += 2 * Math.PI;
  const ir = Math.min(nMU - 1, Math.max(0, Math.floor((1 - mu) * nMU)));
  const dP = 2 * Math.PI / nPHI;
  const ip = Math.min(nPHI - 1, Math.floor(((phi + dP / 2) % (2 * Math.PI)) / dP));
  w[ir * nPHI + ip]++;
}

writeFileSync(new URL(`vista_${family}_b${band}_c${chunk}${seed===42?"":"_s"+seed}.json`, import.meta.url),
  JSON.stringify({ band, chunk, seed, N, refl, abs: abs_, trans, nMU, nPHI,
    family, ssa: ssaUsed, ssa_table: bb.ssa[k], g: bb.g[k],
                   w: Array.from(w),
                   stateAtStart, stateAtEnd: RNG.state() }));
console.log(`b${band} c${chunk}: N=${N / 1e6}M R=${(refl / N).toFixed(6)} `
          + `A=${(abs_ / N).toFixed(6)} T=${(trans / N).toFixed(6)} `
          + `sum=${((refl + abs_ + trans) / N).toFixed(6)}`);
