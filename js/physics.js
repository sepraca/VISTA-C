// physics.js — Pure MC photon transport kernel.
// No SimStats dependency: caller handles all stat updates.

import { RNG } from './rng.js';

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
              surfaceAlbedo, betaExt, surfaceDistanceKm } = params;

      let x = 0, y = 0, tau = 0;
      let dir = {
        x: Math.sin(theta0),
        y: 0,
        z: Math.cos(theta0)
      };

      let path = [{x, y, tau}];
      let totalPath = 0;
      let scatterings = 0;
      let surfaceBounceCount = 0;

      const maxEvents = 25000;

      for (let event = 0; event < maxEvents; event++) {
        const s = Physics.sampleFreePath();

        const xNew = x + s * dir.x;
        const yNew = y + s * dir.y;
        const tauNew = tau + s * dir.z;

        const halfW = slabW / 2;
        const halfD = slabD / 2;

        // Side boundary escape.
        if (Math.abs(xNew) > halfW || Math.abs(yNew) > halfD) {
          let fx = Infinity, fy = Infinity;
          if (dir.x !== 0) { const boundX = dir.x > 0 ? halfW : -halfW; fx = (boundX - x) / (xNew - x); }
          if (dir.y !== 0) { const boundY = dir.y > 0 ? halfD : -halfD; fy = (boundY - y) / (yNew - y); }
          const f = Math.min(fx, fy);
          const xb = x + f * (xNew - x);
          const yb = y + f * (yNew - y);
          const taub = tau + f * (tauNew - tau);
          totalPath += s * f;
          if (storePath) path.push({x: xb, y: yb, tau: taub});
          return {status: "side_escape", xExit: xb, yExit: yb, tauExit: taub, dirX: dir.x, dirY: dir.y, dirZ: dir.z, path, totalPath, scatterings, surfaceBounceCount, cloudBaseTransmissions, surfaceEvents: localSurfaceEvents, surfaceReflectionDirs};
        }

        // Top boundary escape (reflected).
        if (tauNew < 0) {
          const f = (0 - tau) / (tauNew - tau);
          const xb = x + f * (xNew - x);
          const yb = y + f * (yNew - y);
          totalPath += s * f;
          if (storePath) path.push({x: xb, y: yb, tau: 0});
          return {status: "reflected", xExit: xb, yExit: yb, tauExit: 0, dirX: dir.x, dirY: dir.y, dirZ: dir.z, path, totalPath, scatterings, surfaceBounceCount, cloudBaseTransmissions, surfaceEvents: localSurfaceEvents, surfaceReflectionDirs};
        }

        // Cloud-base crossing.
        if (tauNew > tauCloud) {
          const f = (tauCloud - tau) / (tauNew - tau);
          const xb = x + f * (xNew - x);
          const yb = y + f * (yNew - y);
          totalPath += s * f;
          if (storePath) path.push({x: xb, y: yb, tau: tauCloud});

          cloudBaseTransmissions.push({xExit: xb, yExit: yb, tauExit: tauCloud, dirX: dir.x, dirY: dir.y, dirZ: dir.z, totalPath});

          if (surfaceAlbedo > 0) {
            // Surface tau computed directly from params (avoids Coords dependency).
            const tauSurface = tauCloud + betaExt * surfaceDistanceKm;

            // Geometric lateral displacement through the clear sub-cloud gap.
            const muDown = Math.max(dir.z, 1e-9);
            const horizontalFactorDown = surfaceDistanceKm * betaExt / muDown;
            const xs = xb + horizontalFactorDown * dir.x;
            const ys = yb + horizontalFactorDown * dir.y;
            if (storePath && path.length < 3500) path.push({x: xs, y: ys, tau: tauSurface});

            // Analog Lambertian surface decision.
            if (RNG.rand() < surfaceAlbedo) {
              localSurfaceEvents.push({x: xs, y: ys, tau: tauSurface, type: "surface_reflected"});
              dir = Physics.sampleLambertianUpwardDirection();

              surfaceReflectionDirs.push({x: dir.x, y: dir.y, z: dir.z, weight: -1});
              surfaceBounceCount++; // increment before side-escape check so stats.surfaceReflected
                                    // correctly counts ALL surface reflections, including those
                                    // followed by a lateral side escape from the cloud.

              const muUp = Math.max(-dir.z, 1e-9);
              const horizontalFactorUp = surfaceDistanceKm * betaExt / muUp;
              const xEnter = xs + horizontalFactorUp * dir.x;
              const yEnter = ys + horizontalFactorUp * dir.y;
              if (storePath && path.length < 3500) path.push({x: xEnter, y: yEnter, tau: tauCloud});

              if (Math.abs(xEnter) > halfW || Math.abs(yEnter) > halfD) {
                return {status: "side_escape", xExit: xEnter, yExit: yEnter, tauExit: tauCloud, dirX: dir.x, dirY: dir.y, dirZ: dir.z, path, totalPath, scatterings, surfaceBounceCount, cloudBaseTransmissions, surfaceEvents: localSurfaceEvents, surfaceReflectionDirs};
              }

              x = xEnter; y = yEnter; tau = tauCloud;
              continue;
            }

            localSurfaceEvents.push({x: xs, y: ys, tau: tauSurface, type: "surface_absorbed"});
            return {status: "surface_absorbed", xExit: xs, yExit: ys, tauExit: tauSurface, dirX: dir.x, dirY: dir.y, dirZ: dir.z, path, totalPath, scatterings, surfaceBounceCount, cloudBaseTransmissions, surfaceEvents: localSurfaceEvents, surfaceReflectionDirs};
          }

          // A_s = 0: photon terminates at cloud base.
          return {status: "transmitted", xExit: xb, yExit: yb, tauExit: tauCloud, dirX: dir.x, dirY: dir.y, dirZ: dir.z, path, totalPath, scatterings, surfaceBounceCount, cloudBaseTransmissions, surfaceEvents: localSurfaceEvents, surfaceReflectionDirs};
        }

        // Interior scattering event.
        x = xNew; y = yNew; tau = tauNew;
        totalPath += s;
        if (storePath && path.length < 3500) path.push({x, y, tau});

        if (RNG.rand() > omega0) {
          return {status: "absorbed", xExit: x, yExit: y, tauExit: tau, dirX: dir.x, dirY: dir.y, dirZ: dir.z, path, totalPath, scatterings, surfaceBounceCount, cloudBaseTransmissions, surfaceEvents: localSurfaceEvents, surfaceReflectionDirs};
        }

        dir = Physics.scatterDirectionHG(dir, g);
        scatterings++;
      }

      return {status: "terminated", xExit: x, yExit: y, tauExit: tau, dirX: dir.x, dirY: dir.y, dirZ: dir.z, path, totalPath, scatterings, surfaceBounceCount, cloudBaseTransmissions, surfaceEvents: localSurfaceEvents, surfaceReflectionDirs};
    }

  };
