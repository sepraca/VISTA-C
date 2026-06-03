// coords.js — Simulation ↔ world coordinate transforms.

import * as THREE from 'three';

import { world } from './state.js';
import { UI } from './ui.js';

export const Coords = {

    // Optical depth τ → Three.js world Z position.
    // Cloud top is at +slabH/2; increasing τ moves downward.
    tauToZ(tau) {
      return world.slabH / 2 - tau * world.zScale;
    },

    // Simulation point {x, y, tau} → Three.js world Vector3.
    simToWorldPoint(p) {
      return new THREE.Vector3(p.x, p.y, Coords.tauToZ(p.tau));
    },

    // Physical distance in km → world Z distance (same scale as tauToZ).
    // Used for placing geometry in the clear sub-cloud gap.

    // τ position of the Lambertian surface below the cloud.
    // The clear sub-cloud gap adds β_ext * d_km to the cloud-base τ.
    getSurfaceTau() {
      return world.tauCloud + UI.getCloudBetaExt() * UI.getSurfaceDistanceKm();
    }

  };
