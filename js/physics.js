// physics.js — Pure MC photon transport kernel.
// No SimStats dependency: caller handles all stat updates.

import { RNG } from './rng.js';

// Safety cap on transport events per photon; photons hitting it return
// status "terminated" and are tallied separately by SimStats.
const MAX_EVENTS = 25000;

// Cap on stored path vertices per photon (visualization only; the physics
// continues past this — later vertices are simply not recorded).
const MAX_PATH_POINTS = 3500;

export const Physics = {

    // Normalize a direction vector {x, y, z} to unit length.
    normalize(v) {
      const mag = Math.sqrt(v.x*v.x + v.y*v.y + v.z*v.z);
      if (mag <= 0) return {x: 0, y: 0, z: 1};
      return {x: v.x/mag, y: v.y/mag, z: v.z/mag};
    },

    // Sample exponentially-distributed free path: s = -ln(ξ), <s> = 1.
    sampleFreePath() {
      return -Math.log(RNG.randOpen01());
    },

    // Sample cosine of scattering angle from Henyey-Greenstein phase function.
    sampleHGCosTheta(g) {
      const xi = RNG.rand();
      if (Math.abs(g) < 1e-6) return 2 * xi - 1;
      const term = (1 - g * g) / (1 - g + 2 * g * xi);
      return (1 + g * g - term * term) / (2 * g);
    },

    // Rotate direction vector dir into a new direction sampled from the
    // HG phase function with asymmetry parameter g.
    scatterDirectionHG(dir, g) {
      const muS = Physics.sampleHGCosTheta(g);
      const sinS = Math.sqrt(Math.max(0, 1 - muS * muS));
      const phi = 2 * Math.PI * RNG.rand();
      const cosPhi = Math.cos(phi);
      const sinPhi = Math.sin(phi);

      const w = Physics.normalize(dir);

      let helper;
      if (Math.abs(w.z) < 0.9) {
        helper = {x: 0, y: 0, z: 1};
      } else {
        helper = {x: 1, y: 0, z: 0};
      }

      let u = {
        x: helper.y * w.z - helper.z * w.y,
        y: helper.z * w.x - helper.x * w.z,
        z: helper.x * w.y - helper.y * w.x
      };
      u = Physics.normalize(u);

      const v = {
        x: w.y * u.z - w.z * u.y,
        y: w.z * u.x - w.x * u.z,
        z: w.x * u.y - w.y * u.x
      };

      return Physics.normalize({
        x: muS * w.x + sinS * (cosPhi * u.x + sinPhi * v.x),
        y: muS * w.y + sinS * (cosPhi * u.y + sinPhi * v.y),
        z: muS * w.z + sinS * (cosPhi * u.z + sinPhi * v.z)
      });
    },

    // First intersection of a ray with the cloud box
    // [-halfW, halfW] x [-halfD, halfD] x [0, tauCloud] (slab method).
    // Used for surface-reflected photons ascending from the infinite surface
    // (p.tau > tauCloud, dir.z < 0): the entry face is the cloud base or a
    // side wall, never the top. Returns the entry point {x, y, tau} clamped
    // onto the box, or null if the ray misses the box.
    rayBoxEntry(p, dir, halfW, halfD, tauCloud) {
      let tEnter = -Infinity, tExit = Infinity;
      const axes = [
        [p.x,   dir.x, -halfW, halfW],
        [p.y,   dir.y, -halfD, halfD],
        [p.tau, dir.z, 0,      tauCloud]
      ];
      for (const [o, d, lo, hi] of axes) {
        if (Math.abs(d) < 1e-15) {
          if (o < lo || o > hi) return null;
        } else {
          let t0 = (lo - o) / d;
          let t1 = (hi - o) / d;
          if (t0 > t1) { const tmp = t0; t0 = t1; t1 = tmp; }
          if (t0 > tEnter) tEnter = t0;
          if (t1 < tExit)  tExit  = t1;
          if (tEnter > tExit) return null;
        }
      }
      if (!(tEnter > 1e-12) || !isFinite(tEnter)) return null;
      return {
        x:   Math.max(-halfW, Math.min(halfW, p.x + tEnter * dir.x)),
        y:   Math.max(-halfD, Math.min(halfD, p.y + tEnter * dir.y)),
        tau: Math.max(0, Math.min(tauCloud, p.tau + tEnter * dir.z))
      };
    },

    // Sample a cosine-weighted upward direction for Lambertian surface reflection.
    // Upward means dir.z < 0 in cloud optical-depth coordinates.
    sampleLambertianUpwardDirection() {
      const mu = Math.sqrt(RNG.rand()); // p(mu) = 2μ (cosine-weighted)
      const sinTheta = Math.sqrt(Math.max(0, 1 - mu * mu));
      const phi = 2 * Math.PI * RNG.rand();
      return {
        x: sinTheta * Math.cos(phi),
        y: sinTheta * Math.sin(phi),
        z: -mu
      };
    },

    // Sample a photon's cloud-top (or side-wall) entry point.
    //   entryMode "center"   : (0, 0, 0) — no RNG draws, so the deterministic
    //                          stream is unchanged from the legacy point launch.
    //   entryMode "top"      : uniform over the cloud-top face (τ = 0).
    //   entryMode "top_side" : uniform over the top face OR the sunward side
    //                          wall (x = −W/2), chosen with probability equal to
    //                          each face's beam-projected area. For a collimated
    //                          beam d = (sinΘ₀, 0, cosΘ₀) the projected areas are
    //                          top ∝ W·cosΘ₀ and side ∝ τ_cloud·sinΘ₀ (the common
    //                          depth D cancels), so
    //                              p_side = τ_cloud·sinΘ₀
    //                                       ─────────────────────────────
    //                                       W·cosΘ₀ + τ_cloud·sinΘ₀ .
    //   Within the chosen face the point is uniform in true area, and the entry
    //   direction is unchanged. At Θ₀ = 0, p_side = 0 and "top_side" reduces to
    //   "top". The entry point is the photon's origin; optical path is measured
    //   from there (the clear-air travel before the cloud is not counted, exactly
    //   as for top-face photons).
    //   entryMode "uniform_domain" : TOA-uniform launch over the full domain
    //                          [-halfW·M, halfW·M] x [-halfD·M, halfD·M] at τ = 0
    //                          (M = domain factor, M ≥ 1) -- NOT restricted to the
    //                          cloud's own footprint. At M = 1 the domain equals
    //                          the cloud footprint exactly and this is identical,
    //                          term for term, to the "top" formula above (same two
    //                          draws), so legacy "top" statistics are reproduced
    //                          bit-for-bit. For M > 1, points landing outside the
    //                          cloud footprint are resolved in simulatePhoton (not
    //                          here) via a ray-cast to the sunward wall or the
    //                          surface, since that needs the surfaceInteraction
    //                          closure defined there. See TODO-direct-surface-
    //                          illumination.md, "The core knob: domain factor",
    //                          for the M_min margin needed so the domain doesn't
    //                          under-sample direct sunward-wall illumination.
    sampleEntryPoint(params) {
      const { entryMode, slabW, slabD, tauCloud, theta0, domainFactor } = params;
      const halfW = slabW / 2, halfD = slabD / 2;

      if (entryMode === "top" || entryMode === "top_side") {
        if (entryMode === "top_side") {
          const wTop  = slabW   * Math.cos(theta0);   // ∝ W·cosΘ₀
          const wSide = tauCloud * Math.sin(theta0);  // ∝ τ·sinΘ₀
          const denom = wTop + wSide;
          const pSide = denom > 0 ? wSide / denom : 0;
          if (RNG.rand() < pSide) {
            // Sunward vertical wall at x = −W/2; uniform in (y, τ).
            return { x: -halfW, y: (RNG.rand() - 0.5) * slabD, tau: RNG.rand() * tauCloud };
          }
        }
        // Cloud-top face at τ = 0; uniform in (x, y).
        return { x: (RNG.rand() - 0.5) * slabW, y: (RNG.rand() - 0.5) * slabD, tau: 0 };
      }

      if (entryMode === "uniform_domain") {
        const M = domainFactor ?? 1;
        // Uniform over the full M·W x M·D domain at τ = 0 (the TOA plane,
        // coincident with cloud-top height -- there is no clear-air optical
        // depth above the cloud in this model). Whether this point lands on
        // the cloud or in the clear region is resolved in simulatePhoton.
        return { x: (RNG.rand() - 0.5) * slabW * M, y: (RNG.rand() - 0.5) * slabD * M, tau: 0 };
      }

      // "center" (default): legacy single-point launch.
      return { x: 0, y: 0, tau: 0 };
    },

    // Full Monte Carlo photon transport through the cloud slab.
    // params: { tauCloud, slabW, slabD, theta0, g, omega0,
    //           surfaceAlbedo, betaExt, surfaceDistanceKm }
    // storePath: whether to accumulate the path array for visualization.
    simulatePhoton(params, storePath = true) {
      // Accumulate mid-loop events locally so simulatePhoton has no
      // direct SimStats dependency — caller handles all stat updates.
      const cloudBaseTransmissions = [];
      const localSurfaceEvents     = [];
      const surfaceReflectionDirs  = [];

      const { tauCloud, slabW, slabD, theta0, g, omega0,
              surfaceAlbedo, betaExt, surfaceDistanceKm, entryMode } = params;

      const entry = Physics.sampleEntryPoint(params);
      let x = entry.x, y = entry.y, tau = entry.tau;
      let dir = {
        x: Math.sin(theta0),
        y: 0,
        z: Math.cos(theta0)
      };

      let path = [{x, y, tau}];
      let totalPath = 0;
      let scatterings = 0;
      let surfaceBounceCount = 0;

      const halfW = slabW / 2;
      const halfD = slabD / 2;

      // Launch-region / touched-cloud-box bookkeeping (v6.0; see TODO
      // "T and A component decomposition"). Legacy launch modes (center/top/
      // top_side) always originate ON the cloud, so both flags start -- and
      // stay -- at their "cloud" defaults for them. Only "uniform_domain" mode
      // can launch into the clear region (launchRegion is fixed at launch and
      // never changes; touchedCloud can flip false -> true if a clear-launched
      // photon is later reflected by the surface back into the cloud box).
      let launchRegion = "cloud";   // "cloud" | "clear"
      let touchedCloud = true;

      // --- Clear-air transport over the INFINITE Lambertian surface ---
      // Model (A_s > 0): the cloud box is finite but the surface below it is
      // infinite. The clear gap has geometric displacement only (zero optical
      // path). A photon leaving the cloud heading downward — through the base
      // OR through a side wall — descends in a straight line to the surface
      // plane (possibly outside the slab footprint), takes the albedo coin
      // flip there, and if Lambertian-reflected may re-enter the cloud through
      // the base or a side wall (ray-box test) or escape upward to space
      // (terminal side_escape, reported where it passes cloud-base altitude).
      // countDownArrival: side-wall exits did not cross the cloud base, so
      // their downward arrival at the surface plane is registered here to keep
      // the identity T_net = F_down - F_up = surface absorption, exact.
      // For A_s = 0 this handler is not used by the LEGACY paths (base/side
      // exits are gated on surfaceAlbedo > 0 and terminate at the cloud
      // boundary as before). EXCEPTION (v6.0): the "uniform_domain" clear-miss
      // launch branch below calls this with no A_s gate, so at A_s = 0 every
      // clear-direct photon still arrives here and terminates
      // "surface_absorbed" (the albedo draw below can never succeed). Note
      // that draw consumes one RNG number even at A_s = 0 -- deliberate and
      // stream-consistent within uniform_domain runs; do NOT "optimize" it
      // away later, as that would silently shift every uniform_domain RNG
      // stream while leaving legacy modes untouched (golden-snapshot trap --
      // see review finding E5).
      const surfaceInteraction = (cx, cy, ctau, countDownArrival) => {
        const tauSurface = tauCloud + betaExt * surfaceDistanceKm;
        const tDown = (tauSurface - ctau) / Math.max(dir.z, 1e-12);
        const xs = cx + tDown * dir.x;
        const ys = cy + tDown * dir.y;
        if (storePath && path.length < MAX_PATH_POINTS) path.push({x: xs, y: ys, tau: tauSurface});

        // viaSide tags the OBSERVATION-GEOMETRY origin of each surface-plane leg:
        // countDownArrival is true only when surfaceInteraction is reached from a
        // downward side-wall exit, false when reached from a cloud-base crossing.
        // simstats uses it to split the net surface flux into base-derived (the
        // transmitted channel under geometry "a") vs. side-derived (reassigned to
        // S under "a"). Trajectories are unaffected.
        if (countDownArrival) {
          cloudBaseTransmissions.push({xExit: xs, yExit: ys, tauExit: tauSurface, dirX: dir.x, dirY: dir.y, dirZ: dir.z, totalPath, viaSide: true, touchedCloud, launchRegion});
        }

        if (RNG.rand() < surfaceAlbedo) {
          localSurfaceEvents.push({x: xs, y: ys, tau: tauSurface, type: "surface_reflected"});
          dir = Physics.sampleLambertianUpwardDirection();
          surfaceReflectionDirs.push({x: dir.x, y: dir.y, z: dir.z, weight: -1, viaSide: countDownArrival, touchedCloud, launchRegion});
          surfaceBounceCount++;

          const entry = Physics.rayBoxEntry({x: xs, y: ys, tau: tauSurface}, dir, halfW, halfD, tauCloud);
          if (entry) {
            if (storePath && path.length < MAX_PATH_POINTS) path.push({x: entry.x, y: entry.y, tau: entry.tau});
            return {reenter: entry};
          }

          // Escapes upward to space without re-entering the cloud.
          const tUp = (tauCloud - tauSurface) / Math.min(dir.z, -1e-12);
          const xe = xs + tUp * dir.x;
          const ye = ys + tUp * dir.y;
          if (storePath && path.length < MAX_PATH_POINTS) path.push({x: xe, y: ye, tau: tauCloud});
          // bypass: surface-reflected photon escaping UPWARD without re-entering the
          // cloud (it never left a cloud face). Geometry "all_faces" routes these to
          // S; "scene" keeps them in R. Distinguishes this from a genuine side-wall exit.
          return {result: {status: "side_escape", bypass: true, xExit: xe, yExit: ye, tauExit: tauCloud, dirX: dir.x, dirY: dir.y, dirZ: dir.z, path, totalPath, scatterings, surfaceBounceCount, cloudBaseTransmissions, surfaceEvents: localSurfaceEvents, surfaceReflectionDirs, touchedCloud, launchRegion}};
        }

        // A terminal surface absorption is drawn ONCE, as a brown endpoint (see
        // Photons.addEndpoint), consistent with how cloud absorption is shown.
        // It is deliberately NOT also pushed as a surface event, which would
        // double-mark the same point. Only mid-trajectory surface reflections
        // are recorded as events.
        return {result: {status: "surface_absorbed", xExit: xs, yExit: ys, tauExit: tauSurface, dirX: dir.x, dirY: dir.y, dirZ: dir.z, path, totalPath, scatterings, surfaceBounceCount, cloudBaseTransmissions, surfaceEvents: localSurfaceEvents, surfaceReflectionDirs, viaSide: countDownArrival, touchedCloud, launchRegion}};
      };

      // --- Uniform-domain launch resolution (v6.0) ---
      // sampleEntryPoint already drew the TOA-domain-uniform (x, y, tau=0). If
      // that point lies within the cloud's own footprint it's a top-face entry
      // and is already handled below identically to legacy "top" mode -- no
      // extra work needed. If it lies outside the footprint, resolve here
      // (reusing rayBoxEntry / surfaceInteraction, exactly as the existing
      // surface-bounce re-entry logic already does) whether the descending ray
      // clips the sunward wall (cloud-incident) or misses the cloud entirely
      // and goes straight to the surface (clear-incident). See TODO, "The core
      // knob: domain factor" for the M_min margin needed to avoid
      // under-sampling direct sunward-wall illumination.
      if (entryMode === "uniform_domain" && (Math.abs(x) > halfW || Math.abs(y) > halfD)) {
        const hit = Physics.rayBoxEntry({x, y, tau}, dir, halfW, halfD, tauCloud);
        if (hit) {
          // Clips the sunward wall directly -- cloud-incident, same physical
          // outcome as a legacy "top_side" side-wall entry. launchRegion and
          // touchedCloud stay at their "cloud" / true defaults.
          x = hit.x; y = hit.y; tau = hit.tau;
          if (storePath && path.length < MAX_PATH_POINTS) path.push({x, y, tau});
        } else {
          // Never touches the cloud box on the way down -- clear-incident.
          // countDownArrival MUST be true here: unlike the cloud-base-crossing
          // branch in the main loop (which pushes to cloudBaseTransmissions
          // BEFORE calling surfaceInteraction with false, to avoid a double
          // count), this clear-direct arrival has no earlier push anywhere --
          // passing false here would silently drop it from F_down_sfc (a bug
          // caught by a negative net-transmittance / non-closing budget at
          // A_s > 0). This temporarily tags clear-direct arrivals with
          // viaSide=true (a stand-in until Phase 2 gives them their own
          // touched-cloud-based bucket instead of reusing the side-derived
          // one) -- harmless for now: it doesn't affect the top-level T count
          // under "all_faces"/"scene" (both sum base + side unconditionally),
          // and under "top-base_faces" it's conservatively folded into S
          // rather than T, so the overall budget still closes exactly.
          launchRegion = "clear";
          touchedCloud = false;
          const out = surfaceInteraction(x, y, tau, true);
          if (out.result) return out.result;
          touchedCloud = true; // reflected by the surface and re-entered the cloud
          x = out.reenter.x; y = out.reenter.y; tau = out.reenter.tau;
        }
      }

      for (let event = 0; event < MAX_EVENTS; event++) {
        const s = Physics.sampleFreePath();

        const xNew = x + s * dir.x;
        const yNew = y + s * dir.y;
        const tauNew = tau + s * dir.z;

        // First-crossing boundary test. The straight segment endpoint may lie
        // beyond several boundary planes at once (corner regions outside the
        // box). The photon exits through whichever violated plane it pierces
        // FIRST along the segment, i.e. the smallest fractional distance f.
        // Note tau is monotonic along a straight segment, so at most one of
        // the top/base planes can be crossed.
        let fSide = Infinity;
        if (Math.abs(xNew) > halfW || Math.abs(yNew) > halfD) {
          let fx = Infinity, fy = Infinity;
          if (Math.abs(xNew) > halfW) { const boundX = dir.x > 0 ? halfW : -halfW; fx = (boundX - x) / (xNew - x); }
          if (Math.abs(yNew) > halfD) { const boundY = dir.y > 0 ? halfD : -halfD; fy = (boundY - y) / (yNew - y); }
          fSide = Math.min(fx, fy);
        }
        const fTop  = tauNew < 0        ? (0 - tau) / (tauNew - tau)        : Infinity;
        const fBase = tauNew > tauCloud ? (tauCloud - tau) / (tauNew - tau) : Infinity;

        // Top boundary escape (reflected): crossed at or before any side plane.
        if (fTop !== Infinity && fTop <= fSide) {
          const f = fTop;
          const xb = x + f * (xNew - x);
          const yb = y + f * (yNew - y);
          totalPath += s * f;
          if (storePath) path.push({x: xb, y: yb, tau: 0});
          return {status: "reflected", xExit: xb, yExit: yb, tauExit: 0, dirX: dir.x, dirY: dir.y, dirZ: dir.z, path, totalPath, scatterings, surfaceBounceCount, cloudBaseTransmissions, surfaceEvents: localSurfaceEvents, surfaceReflectionDirs, touchedCloud, launchRegion};
        }

        // Side boundary escape: crossed strictly before the top/base planes.
        if (fSide !== Infinity && fSide < fBase) {
          const f = fSide;
          const xb = x + f * (xNew - x);
          const yb = y + f * (yNew - y);
          const taub = tau + f * (tauNew - tau);
          totalPath += s * f;
          if (storePath) path.push({x: xb, y: yb, tau: taub});

          // Over a reflective surface, a DOWNWARD side-escaper continues
          // through the clear air beside the cloud to the infinite surface
          // and may be reflected back into the cloud.
          if (surfaceAlbedo > 0 && dir.z > 0) {
            const out = surfaceInteraction(xb, yb, taub, true);
            if (out.result) return out.result;
            x = out.reenter.x; y = out.reenter.y; tau = out.reenter.tau;
            continue;
          }

          return {status: "side_escape", xExit: xb, yExit: yb, tauExit: taub, dirX: dir.x, dirY: dir.y, dirZ: dir.z, path, totalPath, scatterings, surfaceBounceCount, cloudBaseTransmissions, surfaceEvents: localSurfaceEvents, surfaceReflectionDirs, touchedCloud, launchRegion};
        }

        // Cloud-base crossing.
        if (fBase !== Infinity) {
          const f = fBase;
          const xb = x + f * (xNew - x);
          const yb = y + f * (yNew - y);
          totalPath += s * f;
          if (storePath) path.push({x: xb, y: yb, tau: tauCloud});

          cloudBaseTransmissions.push({xExit: xb, yExit: yb, tauExit: tauCloud, dirX: dir.x, dirY: dir.y, dirZ: dir.z, totalPath, viaSide: false, touchedCloud, launchRegion});

          if (surfaceAlbedo > 0) {
            // Descend the clear gap to the infinite surface; the base crossing
            // was already registered above, so countDownArrival = false.
            const out = surfaceInteraction(xb, yb, tauCloud, false);
            if (out.result) return out.result;
            x = out.reenter.x; y = out.reenter.y; tau = out.reenter.tau;
            continue;
          }

          // A_s = 0: photon terminates at cloud base.
          return {status: "transmitted", xExit: xb, yExit: yb, tauExit: tauCloud, dirX: dir.x, dirY: dir.y, dirZ: dir.z, path, totalPath, scatterings, surfaceBounceCount, cloudBaseTransmissions, surfaceEvents: localSurfaceEvents, surfaceReflectionDirs, touchedCloud, launchRegion};
        }

        // Interior scattering event.
        x = xNew; y = yNew; tau = tauNew;
        totalPath += s;
        if (storePath && path.length < MAX_PATH_POINTS) path.push({x, y, tau});

        if (RNG.rand() > omega0) {
          return {status: "absorbed", xExit: x, yExit: y, tauExit: tau, dirX: dir.x, dirY: dir.y, dirZ: dir.z, path, totalPath, scatterings, surfaceBounceCount, cloudBaseTransmissions, surfaceEvents: localSurfaceEvents, surfaceReflectionDirs, touchedCloud, launchRegion};
        }

        dir = Physics.scatterDirectionHG(dir, g);
        scatterings++;
      }

      return {status: "terminated", xExit: x, yExit: y, tauExit: tau, dirX: dir.x, dirY: dir.y, dirZ: dir.z, path, totalPath, scatterings, surfaceBounceCount, cloudBaseTransmissions, surfaceEvents: localSurfaceEvents, surfaceReflectionDirs, touchedCloud, launchRegion};
    }

  };
