# Golden snapshot — Uniform domain illumination, PERIODIC boundary (v6.0.0-dev, post-Phase-3)

Generated: 2026-07-19T17:16:39.843Z (tables regenerated post-N1 fix, 2026-07-19) | seed 42 | N=500,000 photons/run | 18 runs (M in {1,2,4} x Th0 in {0,60} deg x As in {0,0.5,1}) x 2 observation geometries = 36 rows.

> **RNG swap regeneration (TODO section R, 2026-07-29).** Every count in this file changed
> because the generator was replaced (Mulberry32 -> xoshiro128\*\*, `js/rng.js`); the physics
> is untouched. Mulberry32's 2^32 period is exhausted after ~52 M photons at tau=10, and its
> "different seeds" are phases of ONE cycle, so seed-offset chunks overlap silently.
>
> Regeneration followed D1: before overwriting, old and new were shown to differ only as two
> seeds of the same code differ, using `d1_noise_check.py`, which measures the null
> empirically from 8 extra realizations rather than assuming a sigma. Result: spread ratios 0.45-1.03, all biases below gate, path-histogram chi^2 = 0.998 over 1413 bins.
>
> **The tables below are generated, not hand-maintained** -- rebuilt from the .json by
> `refresh_snapshot_md.py` (run with `--check` to verify no drift). They HAD drifted: the
> .json was regenerated 2026-07-27 for the Mulberry32 state-mask fix while these tables were
> last edited 2026-07-21.

> **Path-histogram fields added (review B, 2026-07-21).** Each row now also carries a
> `pathHist` object (`bin_max` + 24 integer bin counts, reflected and net-transmitted,
> under that row's observation geometry), locking the streaming path-length binning.
> Purely additive: all pre-existing fields verified byte-identical (36/36 rows); budget
> tables below unchanged, not regenerated.

Companion to golden_ud_v6.0-phase2.json (same matrix, open boundary). Regenerate with gen_golden_periodic.mjs and diff -- every raw count must match exactly (deterministic RNG, seed 42). Cross-checks at generation time (all 36 rows, tests/review-harness or check_golden_periodic.mjs): all component-sum identities exact; R_domain+T_domain+A_cloud+terminated == launched exactly (terminated absorbs both the MAX_EVENTS and MAX_WRAPS safety caps -- see wrapCapped column); terminal sideEscapeDown === 0 in every row (the TODO's "must become identically 0, migrates into T" claim, gate-verified); S(all_faces) == surfaceBypassUp exactly in every row; wrapCapped negligible (< 0.1% of N) even in the worst case (tightest tiling, M=1).

Two implementation-history notes this snapshot's generation caught (see TODO "Phase 3" and CHANGELOG for detail): (1) the direct upward-side-escape wrap site initially only handled dir.z < 0 -- the dir.z > 0 (downward) / Aₛ = 0 case needed the identical adjacency test, since it's a purely geometric question independent of surface albedo; (2) that same downward-miss case must proceed to the surface UNCONDITIONALLY on Aₛ (not just when Aₛ > 0), matching how the uniform_domain clear-miss launch branch already treats Aₛ = 0 -- otherwise terminal sideEscapeDown never actually reached zero at Aₛ = 0. Both are fixed in the current code; this snapshot reflects the corrected behavior.

## Domain-wide budget (geometry-independent)

| M | f_c | Th0 | As | R_domain | T_domain | A_cloud | closure* | R comps (top/side/clearDir/viaCloud) | T comps (base/side/clearDir) | wrapCapped |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 1.0000 | 0 | 0 | 0.420442 (210221) | 0.579558 (289779) | 0.000000 | 1.000000 | 210221/0/0/0 | 289779/0/0 | 0 |
| 1 | 1.0000 | 0 | 0.5 | 0.607480 (303740) | 0.392520 (196260) | 0.000000 | 1.000000 | 298060/0/0/5680 | 196260/0/0 | 0 |
| 1 | 1.0000 | 0 | 1 | 1.000000 (500000) | 0.000000 (0) | 0.000000 | 1.000000 | 479471/0/0/20529 | 0/0/0 | 0 |
| 1 | 1.0000 | 60 | 0 | 0.602810 (301405) | 0.397190 (198595) | 0.000000 | 1.000000 | 301405/0/0/0 | 198595/0/0 | 0 |
| 1 | 1.0000 | 60 | 0.5 | 0.730708 (365354) | 0.269292 (134646) | 0.000000 | 1.000000 | 361458/0/0/3896 | 134646/0/0 | 0 |
| 1 | 1.0000 | 60 | 1 | 1.000000 (500000) | 0.000000 (0) | 0.000000 | 1.000000 | 485715/0/0/14285 | 0/0/0 | 0 |
| 2 | 0.2500 | 0 | 0 | 0.097474 (48737) | 0.902526 (451263) | 0.000000 | 1.000000 | 37109/11628/0/0 | 53509/23030/374724 | 0 |
| 2 | 0.2500 | 0 | 0.5 | 0.518494 (259247) | 0.481506 (240753) | 0.000000 | 1.000000 | 63915/26311/148665/20356 | 38120/15446/187187 | 0 |
| 2 | 0.2500 | 0 | 1 | 1.000000 (500000) | 0.000000 (0) | 0.000000 | 1.000000 | 99787/46039/297060/57114 | 0/0/0 | 0 |
| 2 | 0.2500 | 60 | 0 | 0.167360 (83680) | 0.832640 (416320) | 0.000000 | 1.000000 | 65889/17791/0/0 | 60379/35148/320793 | 0 |
| 2 | 0.2500 | 60 | 0.5 | 0.549582 (274791) | 0.450418 (225209) | 0.000000 | 1.000000 | 92997/34332/121109/26353 | 43081/21640/160488 | 0 |
| 2 | 0.2500 | 60 | 1 | 1.000000 (500000) | 0.000000 (0) | 0.000000 | 1.000000 | 130817/57078/241265/70840 | 0/0/0 | 0 |
| 4 | 0.0625 | 0 | 0 | 0.024498 (12249) | 0.975502 (487751) | 0.000000 | 1.000000 | 9044/3205/0/0 | 13010/6110/468631 | 0 |
| 4 | 0.0625 | 0 | 0.5 | 0.505102 (252551) | 0.494898 (247449) | 0.000000 | 1.000000 | 15725/6978/223762/6086 | 9357/4072/234020 | 0 |
| 4 | 0.0625 | 0 | 1 | 1.000000 (500000) | 0.000000 (0) | 0.000000 | 1.000000 | 24259/12013/447103/16625 | 0/0/0 | 0 |
| 4 | 0.0625 | 60 | 0 | 0.041482 (20741) | 0.958518 (479259) | 0.000000 | 1.000000 | 16077/4664/0/0 | 14863/9335/455061 | 0 |
| 4 | 0.0625 | 60 | 0.5 | 0.512736 (256368) | 0.487264 (243632) | 0.000000 | 1.000000 | 23148/8951/216222/8047 | 10443/5782/227407 | 0 |
| 4 | 0.0625 | 60 | 1 | 1.000000 (500000) | 0.000000 (0) | 0.000000 | 1.000000 | 31890/14863/432188/21059 | 0/0/0 | 0 |

\* closure = (R_domain_count + T_domain_count + A_cloud_count + terminated_count) / launched -- includes the safety-cap residual (terminated, which folds in wrapCapped); should be 1.000000 in every row (verified).

## Observation-geometry budgets (R/T/A/S per dropdown)

| M | Th0 | As | Obs geometry | R | T | A | S | closure |
|---|---|---|---|---|---|---|---|---|
| 1 | 0 | 0 | top-base_faces | 0.420442 (210221) | 0.579558 (289779) | 0.000000 | 0.000000 (0) | 1.000000 |
| 1 | 0 | 0 | all_faces | 0.420442 (210221) | 0.579558 (289779) | 0.000000 | 0.000000 (0) | 1.000000 |
| 1 | 0 | 0.5 | top-base_faces | 0.596120 (298060) | 0.392520 (196260) | 0.000000 | 0.011360 (5680) | 1.000000 |
| 1 | 0 | 0.5 | all_faces | 0.596120 (298060) | 0.392520 (196260) | 0.000000 | 0.011360 (5680) | 1.000000 |
| 1 | 0 | 1 | top-base_faces | 0.958942 (479471) | 0.000000 (0) | 0.000000 | 0.041058 (20529) | 1.000000 |
| 1 | 0 | 1 | all_faces | 0.958942 (479471) | 0.000000 (0) | 0.000000 | 0.041058 (20529) | 1.000000 |
| 1 | 60 | 0 | top-base_faces | 0.602810 (301405) | 0.397190 (198595) | 0.000000 | 0.000000 (0) | 1.000000 |
| 1 | 60 | 0 | all_faces | 0.602810 (301405) | 0.397190 (198595) | 0.000000 | 0.000000 (0) | 1.000000 |
| 1 | 60 | 0.5 | top-base_faces | 0.722916 (361458) | 0.269292 (134646) | 0.000000 | 0.007792 (3896) | 1.000000 |
| 1 | 60 | 0.5 | all_faces | 0.722916 (361458) | 0.269292 (134646) | 0.000000 | 0.007792 (3896) | 1.000000 |
| 1 | 60 | 1 | top-base_faces | 0.971430 (485715) | 0.000000 (0) | 0.000000 | 0.028570 (14285) | 1.000000 |
| 1 | 60 | 1 | all_faces | 0.971430 (485715) | 0.000000 (0) | 0.000000 | 0.028570 (14285) | 1.000000 |
| 2 | 0 | 0 | top-base_faces | 0.074218 (37109) | 0.107018 (53509) | 0.000000 | 0.818764 (409382) | 1.000000 |
| 2 | 0 | 0 | all_faces | 0.097474 (48737) | 0.902526 (451263) | 0.000000 | 0.000000 (0) | 1.000000 |
| 2 | 0 | 0.5 | top-base_faces | 0.127830 (63915) | 0.076240 (38120) | 0.000000 | 0.795930 (397965) | 1.000000 |
| 2 | 0 | 0.5 | all_faces | 0.180452 (90226) | 0.481506 (240753) | 0.000000 | 0.338042 (169021) | 1.000000 |
| 2 | 0 | 1 | top-base_faces | 0.199574 (99787) | 0.000000 (0) | 0.000000 | 0.800426 (400213) | 1.000000 |
| 2 | 0 | 1 | all_faces | 0.291652 (145826) | 0.000000 (0) | 0.000000 | 0.708348 (354174) | 1.000000 |
| 2 | 60 | 0 | top-base_faces | 0.131778 (65889) | 0.120758 (60379) | 0.000000 | 0.747464 (373732) | 1.000000 |
| 2 | 60 | 0 | all_faces | 0.167360 (83680) | 0.832640 (416320) | 0.000000 | 0.000000 (0) | 1.000000 |
| 2 | 60 | 0.5 | top-base_faces | 0.185994 (92997) | 0.086162 (43081) | 0.000000 | 0.727844 (363922) | 1.000000 |
| 2 | 60 | 0.5 | all_faces | 0.254658 (127329) | 0.450418 (225209) | 0.000000 | 0.294924 (147462) | 1.000000 |
| 2 | 60 | 1 | top-base_faces | 0.261634 (130817) | 0.000000 (0) | 0.000000 | 0.738366 (369183) | 1.000000 |
| 2 | 60 | 1 | all_faces | 0.375790 (187895) | 0.000000 (0) | 0.000000 | 0.624210 (312105) | 1.000000 |
| 4 | 0 | 0 | top-base_faces | 0.018088 (9044) | 0.026020 (13010) | 0.000000 | 0.955892 (477946) | 1.000000 |
| 4 | 0 | 0 | all_faces | 0.024498 (12249) | 0.975502 (487751) | 0.000000 | 0.000000 (0) | 1.000000 |
| 4 | 0 | 0.5 | top-base_faces | 0.031450 (15725) | 0.018714 (9357) | 0.000000 | 0.949836 (474918) | 1.000000 |
| 4 | 0 | 0.5 | all_faces | 0.045406 (22703) | 0.494898 (247449) | 0.000000 | 0.459696 (229848) | 1.000000 |
| 4 | 0 | 1 | top-base_faces | 0.048518 (24259) | 0.000000 (0) | 0.000000 | 0.951482 (475741) | 1.000000 |
| 4 | 0 | 1 | all_faces | 0.072544 (36272) | 0.000000 (0) | 0.000000 | 0.927456 (463728) | 1.000000 |
| 4 | 60 | 0 | top-base_faces | 0.032154 (16077) | 0.029726 (14863) | 0.000000 | 0.938120 (469060) | 1.000000 |
| 4 | 60 | 0 | all_faces | 0.041482 (20741) | 0.958518 (479259) | 0.000000 | 0.000000 (0) | 1.000000 |
| 4 | 60 | 0.5 | top-base_faces | 0.046296 (23148) | 0.020886 (10443) | 0.000000 | 0.932818 (466409) | 1.000000 |
| 4 | 60 | 0.5 | all_faces | 0.064198 (32099) | 0.487264 (243632) | 0.000000 | 0.448538 (224269) | 1.000000 |
| 4 | 60 | 1 | top-base_faces | 0.063780 (31890) | 0.000000 (0) | 0.000000 | 0.936220 (468110) | 1.000000 |
| 4 | 60 | 1 | all_faces | 0.093506 (46753) | 0.000000 (0) | 0.000000 | 0.906494 (453247) | 1.000000 |

**Snapshot refresh (2026-07-19, review N1 fix):** the M=1 rows previously locked in a cloud-box tunneling bug (a wrapped point landing exactly ON the cloud wall at M=1 -- where the tile edge coincides with the wall -- was rejected by rayBoxEntry's tEnter>1e-12 guard, letting photons cross the box interior unextinguished). Fixed via an additive minT parameter (relaxed to -1e-9 on post-wrap iterations only). All 12 M=1 rows changed (e.g. th0=0/As=0/all_faces: terminal side escapes 51,019 -> 0 exactly; R 0.3911 -> 0.4236, now matching an open-top W=2000 plane-parallel proxy to 1e-4); all 24 M=2/4 rows verified bit-identical pre/post (wrapped points there sit (M-1)*halfW from the wall, so the relaxed floor never engages). M=1 periodic is now the permanent plane-parallel regression anchor via verify_phase3 Gates 8-9.

**Bit-reproducibility caveat (2026-07-19):** the four longest-trajectory rows (Th0=60, As=1, M=1 and M=4 -- conservative cloud AND surface, so photons only terminate by escape; ~1e9+ transcendental calls per row) can sample last-ulp differences in V8 Math functions between Node versions (observed: Node 22 Linux vs Node 26 macOS). Verified impact: totalPath/meanPath wobble at ~2e-16 RELATIVE while every count in all 36 rows stays bit-identical -- the trajectories are identical; only the real-valued path SUM differs at machine epsilon. The check_golden_* harnesses therefore compare counts exactly and totalPath/meanPath to 1e-9 relative (see compare_golden.mjs), so one committed snapshot verifies on every platform/Node version. Any genuine physics change still fails the exact tier (counts move).
