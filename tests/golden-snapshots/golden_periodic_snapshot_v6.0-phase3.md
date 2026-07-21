# Golden snapshot — Uniform domain illumination, PERIODIC boundary (v6.0.0-dev, post-Phase-3)

Generated: 2026-07-19T17:16:39.843Z (tables regenerated post-N1 fix, 2026-07-19) | seed 42 | N=500,000 photons/run | 18 runs (M in {1,2,4} x Th0 in {0,60} deg x As in {0,0.5,1}) x 2 observation geometries = 36 rows.

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
| 1 | 1.0000 | 0 | 0 | 0.423626 (211813) | 0.576374 (288187) | 0.000000 | 1.000000 | 211813/0/0/0 | 288187/0/0 | 0 |
| 1 | 1.0000 | 0 | 0.5 | 0.607160 (303580) | 0.392840 (196420) | 0.000000 | 1.000000 | 298152/0/0/5428 | 196420/0/0 | 0 |
| 1 | 1.0000 | 0 | 1 | 1.000000 (500000) | 0.000000 (0) | 0.000000 | 1.000000 | 479450/0/0/20550 | 0/0/0 | 0 |
| 1 | 1.0000 | 60 | 0 | 0.605132 (302566) | 0.394868 (197434) | 0.000000 | 1.000000 | 302566/0/0/0 | 197434/0/0 | 0 |
| 1 | 1.0000 | 60 | 0.5 | 0.731644 (365822) | 0.268356 (134178) | 0.000000 | 1.000000 | 362037/0/0/3785 | 134178/0/0 | 0 |
| 1 | 1.0000 | 60 | 1 | 1.000000 (500000) | 0.000000 (0) | 0.000000 | 1.000000 | 485949/0/0/14051 | 0/0/0 | 0 |
| 2 | 0.2500 | 0 | 0 | 0.097568 (48784) | 0.902432 (451216) | 0.000000 | 1.000000 | 37273/11511/0/0 | 53025/23108/375083 | 0 |
| 2 | 0.2500 | 0 | 0.5 | 0.516598 (258299) | 0.483402 (241701) | 0.000000 | 1.000000 | 63807/26110/148113/20269 | 38439/15252/188010 | 0 |
| 2 | 0.2500 | 0 | 1 | 1.000000 (500000) | 0.000000 (0) | 0.000000 | 1.000000 | 100089/46067/296483/57361 | 0/0/0 | 0 |
| 2 | 0.2500 | 60 | 0 | 0.166262 (83131) | 0.833738 (416869) | 0.000000 | 1.000000 | 65582/17549/0/0 | 60772/34805/321292 | 0 |
| 2 | 0.2500 | 60 | 0.5 | 0.549954 (274977) | 0.450046 (225023) | 0.000000 | 1.000000 | 93216/34337/120902/26522 | 43044/21488/160491 | 0 |
| 2 | 0.2500 | 60 | 1 | 1.000000 (500000) | 0.000000 (0) | 0.000000 | 1.000000 | 130817/56697/241329/71157 | 0/0/0 | 0 |
| 4 | 0.0625 | 0 | 0 | 0.024490 (12245) | 0.975510 (487755) | 0.000000 | 1.000000 | 9024/3221/0/0 | 13041/5962/468752 | 0 |
| 4 | 0.0625 | 0 | 0.5 | 0.504836 (252418) | 0.495164 (247582) | 0.000000 | 1.000000 | 15598/6917/223994/5909 | 9431/4070/234081 | 0 |
| 4 | 0.0625 | 0 | 1 | 1.000000 (500000) | 0.000000 (0) | 0.000000 | 1.000000 | 24327/11998/446891/16784 | 0/0/0 | 0 |
| 4 | 0.0625 | 60 | 0 | 0.041592 (20796) | 0.958408 (479204) | 0.000000 | 1.000000 | 16109/4687/0/0 | 14564/9313/455327 | 0 |
| 4 | 0.0625 | 60 | 0.5 | 0.512230 (256115) | 0.487770 (243885) | 0.000000 | 1.000000 | 23193/9080/215682/8160 | 10522/5710/227653 | 0 |
| 4 | 0.0625 | 60 | 1 | 1.000000 (500000) | 0.000000 (0) | 0.000000 | 1.000000 | 31909/14974/431840/21277 | 0/0/0 | 0 |

\* closure = (R_domain_count + T_domain_count + A_cloud_count + terminated_count) / launched -- includes the safety-cap residual (terminated, which folds in wrapCapped); should be 1.000000 in every row (verified).

## Observation-geometry budgets (R/T/A/S per dropdown)

| M | Th0 | As | Obs geometry | R | T | A | S | closure |
|---|---|---|---|---|---|---|---|---|
| 1 | 0 | 0 | top-base_faces | 0.423626 (211813) | 0.576374 (288187) | 0.000000 | 0.000000 (0) | 1.000000 |
| 1 | 0 | 0 | all_faces | 0.423626 (211813) | 0.576374 (288187) | 0.000000 | 0.000000 (0) | 1.000000 |
| 1 | 0 | 0.5 | top-base_faces | 0.596304 (298152) | 0.392840 (196420) | 0.000000 | 0.010856 (5428) | 1.000000 |
| 1 | 0 | 0.5 | all_faces | 0.596304 (298152) | 0.392840 (196420) | 0.000000 | 0.010856 (5428) | 1.000000 |
| 1 | 0 | 1 | top-base_faces | 0.958900 (479450) | 0.000000 (0) | 0.000000 | 0.041100 (20550) | 1.000000 |
| 1 | 0 | 1 | all_faces | 0.958900 (479450) | 0.000000 (0) | 0.000000 | 0.041100 (20550) | 1.000000 |
| 1 | 60 | 0 | top-base_faces | 0.605132 (302566) | 0.394868 (197434) | 0.000000 | 0.000000 (0) | 1.000000 |
| 1 | 60 | 0 | all_faces | 0.605132 (302566) | 0.394868 (197434) | 0.000000 | 0.000000 (0) | 1.000000 |
| 1 | 60 | 0.5 | top-base_faces | 0.724074 (362037) | 0.268356 (134178) | 0.000000 | 0.007570 (3785) | 1.000000 |
| 1 | 60 | 0.5 | all_faces | 0.724074 (362037) | 0.268356 (134178) | 0.000000 | 0.007570 (3785) | 1.000000 |
| 1 | 60 | 1 | top-base_faces | 0.971898 (485949) | 0.000000 (0) | 0.000000 | 0.028102 (14051) | 1.000000 |
| 1 | 60 | 1 | all_faces | 0.971898 (485949) | 0.000000 (0) | 0.000000 | 0.028102 (14051) | 1.000000 |
| 2 | 0 | 0 | top-base_faces | 0.074546 (37273) | 0.106050 (53025) | 0.000000 | 0.819404 (409702) | 1.000000 |
| 2 | 0 | 0 | all_faces | 0.097568 (48784) | 0.902432 (451216) | 0.000000 | 0.000000 (0) | 1.000000 |
| 2 | 0 | 0.5 | top-base_faces | 0.127614 (63807) | 0.076878 (38439) | 0.000000 | 0.795508 (397754) | 1.000000 |
| 2 | 0 | 0.5 | all_faces | 0.179834 (89917) | 0.483402 (241701) | 0.000000 | 0.336764 (168382) | 1.000000 |
| 2 | 0 | 1 | top-base_faces | 0.200178 (100089) | 0.000000 (0) | 0.000000 | 0.799822 (399911) | 1.000000 |
| 2 | 0 | 1 | all_faces | 0.292312 (146156) | 0.000000 (0) | 0.000000 | 0.707688 (353844) | 1.000000 |
| 2 | 60 | 0 | top-base_faces | 0.131164 (65582) | 0.121544 (60772) | 0.000000 | 0.747292 (373646) | 1.000000 |
| 2 | 60 | 0 | all_faces | 0.166262 (83131) | 0.833738 (416869) | 0.000000 | 0.000000 (0) | 1.000000 |
| 2 | 60 | 0.5 | top-base_faces | 0.186432 (93216) | 0.086088 (43044) | 0.000000 | 0.727480 (363740) | 1.000000 |
| 2 | 60 | 0.5 | all_faces | 0.255106 (127553) | 0.450046 (225023) | 0.000000 | 0.294848 (147424) | 1.000000 |
| 2 | 60 | 1 | top-base_faces | 0.261634 (130817) | 0.000000 (0) | 0.000000 | 0.738366 (369183) | 1.000000 |
| 2 | 60 | 1 | all_faces | 0.375028 (187514) | 0.000000 (0) | 0.000000 | 0.624972 (312486) | 1.000000 |
| 4 | 0 | 0 | top-base_faces | 0.018048 (9024) | 0.026082 (13041) | 0.000000 | 0.955870 (477935) | 1.000000 |
| 4 | 0 | 0 | all_faces | 0.024490 (12245) | 0.975510 (487755) | 0.000000 | 0.000000 (0) | 1.000000 |
| 4 | 0 | 0.5 | top-base_faces | 0.031196 (15598) | 0.018862 (9431) | 0.000000 | 0.949942 (474971) | 1.000000 |
| 4 | 0 | 0.5 | all_faces | 0.045030 (22515) | 0.495164 (247582) | 0.000000 | 0.459806 (229903) | 1.000000 |
| 4 | 0 | 1 | top-base_faces | 0.048654 (24327) | 0.000000 (0) | 0.000000 | 0.951346 (475673) | 1.000000 |
| 4 | 0 | 1 | all_faces | 0.072650 (36325) | 0.000000 (0) | 0.000000 | 0.927350 (463675) | 1.000000 |
| 4 | 60 | 0 | top-base_faces | 0.032218 (16109) | 0.029128 (14564) | 0.000000 | 0.938654 (469327) | 1.000000 |
| 4 | 60 | 0 | all_faces | 0.041592 (20796) | 0.958408 (479204) | 0.000000 | 0.000000 (0) | 1.000000 |
| 4 | 60 | 0.5 | top-base_faces | 0.046386 (23193) | 0.021044 (10522) | 0.000000 | 0.932570 (466285) | 1.000000 |
| 4 | 60 | 0.5 | all_faces | 0.064546 (32273) | 0.487770 (243885) | 0.000000 | 0.447684 (223842) | 1.000000 |
| 4 | 60 | 1 | top-base_faces | 0.063818 (31909) | 0.000000 (0) | 0.000000 | 0.936182 (468091) | 1.000000 |
| 4 | 60 | 1 | all_faces | 0.093766 (46883) | 0.000000 (0) | 0.000000 | 0.906234 (453117) | 1.000000 |

**Snapshot refresh (2026-07-19, review N1 fix):** the M=1 rows previously locked in a cloud-box tunneling bug (a wrapped point landing exactly ON the cloud wall at M=1 -- where the tile edge coincides with the wall -- was rejected by rayBoxEntry's tEnter>1e-12 guard, letting photons cross the box interior unextinguished). Fixed via an additive minT parameter (relaxed to -1e-9 on post-wrap iterations only). All 12 M=1 rows changed (e.g. th0=0/As=0/all_faces: terminal side escapes 51,019 -> 0 exactly; R 0.3911 -> 0.4236, now matching an open-top W=2000 plane-parallel proxy to 1e-4); all 24 M=2/4 rows verified bit-identical pre/post (wrapped points there sit (M-1)*halfW from the wall, so the relaxed floor never engages). M=1 periodic is now the permanent plane-parallel regression anchor via verify_phase3 Gates 8-9.

**Bit-reproducibility caveat (2026-07-19):** the four longest-trajectory rows (Th0=60, As=1, M=1 and M=4 -- conservative cloud AND surface, so photons only terminate by escape; ~1e9+ transcendental calls per row) can sample last-ulp differences in V8 Math functions between Node versions (observed: Node 22 Linux vs Node 26 macOS). Verified impact: totalPath/meanPath wobble at ~2e-16 RELATIVE while every count in all 36 rows stays bit-identical -- the trajectories are identical; only the real-valued path SUM differs at machine epsilon. The check_golden_* harnesses therefore compare counts exactly and totalPath/meanPath to 1e-9 relative (see compare_golden.mjs), so one committed snapshot verifies on every platform/Node version. Any genuine physics change still fails the exact tier (counts move).
