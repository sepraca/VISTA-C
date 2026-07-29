# Golden snapshot — Uniform domain illumination (v6.0.5, open boundary, N2 shifted-window design)

Generated: 2026-07-19T23:20:06.416Z | seed 42 | N=500,000 photons/run | 18 runs (M in {1,2,4} x Th0 in {0,60} deg x As in {0,0.5,1}) x 2 observation geometries = 36 rows.

> **RNG swap regeneration (TODO section R, 2026-07-29).** Every count in this file changed
> because the generator was replaced (Mulberry32 -> xoshiro128\*\*, `js/rng.js`); the physics
> is untouched. Mulberry32's 2^32 period is exhausted after ~52 M photons at tau=10, and its
> "different seeds" are phases of ONE cycle, so seed-offset chunks overlap silently.
>
> Regeneration followed D1: before overwriting, old and new were shown to differ only as two
> seeds of the same code differ, using `d1_noise_check.py`, which measures the null
> empirically from 8 extra realizations rather than assuming a sigma. Result: spread ratios 0.62-1.41, all biases below gate, path-histogram chi^2 = 0.968 over 1428 bins.
>
> **The tables below are generated, not hand-maintained** -- rebuilt from the .json by
> `refresh_snapshot_md.py` (run with `--check` to verify no drift). They HAD drifted: the
> .json was regenerated 2026-07-27 for the Mulberry32 state-mask fix while these tables were
> last edited 2026-07-21.

> **Path-histogram fields added (review B, 2026-07-21).** Each row now also carries a
> `pathHist` object — `bin_max` plus the 24 integer bin counts for the reflected and
> net-transmitted views, computed under that row's observation geometry. Purely additive:
> every pre-existing field verified byte-identical before replacement (36/36 rows). This
> locks the streaming path-length binning, which had no golden coverage — the P5
> fine-bin-boundary bug passed every prior suite. The budget tables below are unchanged
> (derived from the unchanged budget fields), so they were not regenerated.

Companion to golden_v5.4.0.json (legacy modes). Regenerate/verify with one command: node tests/golden-snapshots/check_golden_ud.mjs (counts exact; totalPath/meanPath to 1e-9 relative for cross-Node last-ulp wobble). NOTE: this generator passes the RAW M to the kernel (no UI auto-clamp) -- it is a kernel lock, so rows at M < M_min(Th0=60) = 2.299 (i.e. M=1 and M=2 at Th0=60) deliberately capture clamp-bypassed physics with a partially unlit leeward cloud top; the app itself raises M to M_min before running.

## Domain-wide budget (geometry-independent)

| M | f_c | Th0 | As | R_domain | T_domain | A_cloud | closure | R comps (top/side/clearDir/viaCloud) | T comps (base/side/clearDir) |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 1.0000 | 0 | 0 | 0.388802 (194401) | 0.611198 (305599) | 0.000000 | 1.000000 | 143513/50888/0/0 | 207256/98343/0 |
| 1 | 1.0000 | 0 | 0.5 | 0.650758 (325379) | 0.349242 (174621) | 0.000000 | 1.000000 | 174995/72178/0/78206 | 121058/53563/0 |
| 1 | 1.0000 | 0 | 1 | 1.000000 (500000) | 0.000000 (0) | 0.000000 | 1.000000 | 217573/99982/0/182445 | 0/0/0 |
| 1 | 1.0000 | 60 | 0 | 0.336836 (168418) | 0.663164 (331582) | 0.000000 | 1.000000 | 126822/41596/0/0 | 164626/58036/108920 |
| 1 | 1.0000 | 60 | 0.5 | 0.616706 (308353) | 0.383294 (191647) | 0.000000 | 1.000000 | 162309/71264/16119/58661 | 102322/35100/54225 |
| 1 | 1.0000 | 60 | 1 | 1.000000 (500000) | 0.000000 (0) | 0.000000 | 1.000000 | 210615/108602/32200/148583 | 0/0/0 |
| 2 | 0.2500 | 0 | 0 | 0.097122 (48561) | 0.902878 (451439) | 0.000000 | 1.000000 | 35886/12675/0/0 | 51908/24513/375018 |
| 2 | 0.2500 | 0 | 0.5 | 0.524788 (262394) | 0.475212 (237606) | 0.000000 | 1.000000 | 55742/25478/158378/22796 | 34865/15339/187402 |
| 2 | 0.2500 | 0 | 1 | 1.000000 (500000) | 0.000000 (0) | 0.000000 | 1.000000 | 81305/41913/316892/59890 | 0/0/0 |
| 2 | 0.2500 | 60 | 0 | 0.154972 (77486) | 0.845028 (422514) | 0.000000 | 1.000000 | 60610/16876/0/0 | 57456/25590/339468 |
| 2 | 0.2500 | 60 | 0.5 | 0.551280 (275640) | 0.448720 (224360) | 0.000000 | 1.000000 | 81370/31814/137759/24697 | 38768/16106/169486 |
| 2 | 0.2500 | 60 | 1 | 1.000000 (500000) | 0.000000 (0) | 0.000000 | 1.000000 | 108527/50653/274803/66017 | 0/0/0 |
| 4 | 0.0625 | 0 | 0 | 0.024196 (12098) | 0.975804 (487902) | 0.000000 | 1.000000 | 8865/3233/0/0 | 12875/6160/468867 |
| 4 | 0.0625 | 0 | 0.5 | 0.505570 (252785) | 0.494430 (247215) | 0.000000 | 1.000000 | 15150/6837/224754/6044 | 9112/4010/234093 |
| 4 | 0.0625 | 0 | 1 | 1.000000 (500000) | 0.000000 (0) | 0.000000 | 1.000000 | 22949/11570/449110/16371 | 0/0/0 |
| 4 | 0.0625 | 60 | 0 | 0.041078 (20539) | 0.958922 (479461) | 0.000000 | 1.000000 | 15931/4608/0/0 | 14694/9327/455440 |
| 4 | 0.0625 | 60 | 0.5 | 0.512888 (256444) | 0.487112 (243556) | 0.000000 | 1.000000 | 22569/8980/216824/8071 | 10120/5722/227714 |
| 4 | 0.0625 | 60 | 1 | 1.000000 (500000) | 0.000000 (0) | 0.000000 | 1.000000 | 30592/14303/434478/20627 | 0/0/0 |

## Observation-geometry budgets (R/T/A/S per dropdown)

| M | Th0 | As | Obs geometry | R | T | A | S | closure |
|---|---|---|---|---|---|---|---|---|
| 1 | 0 | 0 | top-base_faces | 0.287026 (143513) | 0.414512 (207256) | 0.000000 | 0.298462 (149231) | 1.000000 |
| 1 | 0 | 0 | all_faces | 0.388802 (194401) | 0.611198 (305599) | 0.000000 | 0.000000 (0) | 1.000000 |
| 1 | 0 | 0.5 | top-base_faces | 0.349990 (174995) | 0.242116 (121058) | 0.000000 | 0.407894 (203947) | 1.000000 |
| 1 | 0 | 0.5 | all_faces | 0.494346 (247173) | 0.349242 (174621) | 0.000000 | 0.156412 (78206) | 1.000000 |
| 1 | 0 | 1 | top-base_faces | 0.435146 (217573) | 0.000000 (0) | 0.000000 | 0.564854 (282427) | 1.000000 |
| 1 | 0 | 1 | all_faces | 0.635110 (317555) | 0.000000 (0) | 0.000000 | 0.364890 (182445) | 1.000000 |
| 1 | 60 | 0 | top-base_faces | 0.253644 (126822) | 0.329252 (164626) | 0.000000 | 0.417104 (208552) | 1.000000 |
| 1 | 60 | 0 | all_faces | 0.336836 (168418) | 0.663164 (331582) | 0.000000 | 0.000000 (0) | 1.000000 |
| 1 | 60 | 0.5 | top-base_faces | 0.324618 (162309) | 0.204644 (102322) | 0.000000 | 0.470738 (235369) | 1.000000 |
| 1 | 60 | 0.5 | all_faces | 0.467146 (233573) | 0.383294 (191647) | 0.000000 | 0.149560 (74780) | 1.000000 |
| 1 | 60 | 1 | top-base_faces | 0.421230 (210615) | 0.000000 (0) | 0.000000 | 0.578770 (289385) | 1.000000 |
| 1 | 60 | 1 | all_faces | 0.638434 (319217) | 0.000000 (0) | 0.000000 | 0.361566 (180783) | 1.000000 |
| 2 | 0 | 0 | top-base_faces | 0.071772 (35886) | 0.103816 (51908) | 0.000000 | 0.824412 (412206) | 1.000000 |
| 2 | 0 | 0 | all_faces | 0.097122 (48561) | 0.902878 (451439) | 0.000000 | 0.000000 (0) | 1.000000 |
| 2 | 0 | 0.5 | top-base_faces | 0.111484 (55742) | 0.069730 (34865) | 0.000000 | 0.818786 (409393) | 1.000000 |
| 2 | 0 | 0.5 | all_faces | 0.162440 (81220) | 0.475212 (237606) | 0.000000 | 0.362348 (181174) | 1.000000 |
| 2 | 0 | 1 | top-base_faces | 0.162610 (81305) | 0.000000 (0) | 0.000000 | 0.837390 (418695) | 1.000000 |
| 2 | 0 | 1 | all_faces | 0.246436 (123218) | 0.000000 (0) | 0.000000 | 0.753564 (376782) | 1.000000 |
| 2 | 60 | 0 | top-base_faces | 0.121220 (60610) | 0.114912 (57456) | 0.000000 | 0.763868 (381934) | 1.000000 |
| 2 | 60 | 0 | all_faces | 0.154972 (77486) | 0.845028 (422514) | 0.000000 | 0.000000 (0) | 1.000000 |
| 2 | 60 | 0.5 | top-base_faces | 0.162740 (81370) | 0.077536 (38768) | 0.000000 | 0.759724 (379862) | 1.000000 |
| 2 | 60 | 0.5 | all_faces | 0.226368 (113184) | 0.448720 (224360) | 0.000000 | 0.324912 (162456) | 1.000000 |
| 2 | 60 | 1 | top-base_faces | 0.217054 (108527) | 0.000000 (0) | 0.000000 | 0.782946 (391473) | 1.000000 |
| 2 | 60 | 1 | all_faces | 0.318360 (159180) | 0.000000 (0) | 0.000000 | 0.681640 (340820) | 1.000000 |
| 4 | 0 | 0 | top-base_faces | 0.017730 (8865) | 0.025750 (12875) | 0.000000 | 0.956520 (478260) | 1.000000 |
| 4 | 0 | 0 | all_faces | 0.024196 (12098) | 0.975804 (487902) | 0.000000 | 0.000000 (0) | 1.000000 |
| 4 | 0 | 0.5 | top-base_faces | 0.030300 (15150) | 0.018224 (9112) | 0.000000 | 0.951476 (475738) | 1.000000 |
| 4 | 0 | 0.5 | all_faces | 0.043974 (21987) | 0.494430 (247215) | 0.000000 | 0.461596 (230798) | 1.000000 |
| 4 | 0 | 1 | top-base_faces | 0.045898 (22949) | 0.000000 (0) | 0.000000 | 0.954102 (477051) | 1.000000 |
| 4 | 0 | 1 | all_faces | 0.069038 (34519) | 0.000000 (0) | 0.000000 | 0.930962 (465481) | 1.000000 |
| 4 | 60 | 0 | top-base_faces | 0.031862 (15931) | 0.029388 (14694) | 0.000000 | 0.938750 (469375) | 1.000000 |
| 4 | 60 | 0 | all_faces | 0.041078 (20539) | 0.958922 (479461) | 0.000000 | 0.000000 (0) | 1.000000 |
| 4 | 60 | 0.5 | top-base_faces | 0.045138 (22569) | 0.020240 (10120) | 0.000000 | 0.934622 (467311) | 1.000000 |
| 4 | 60 | 0.5 | all_faces | 0.063098 (31549) | 0.487112 (243556) | 0.000000 | 0.449790 (224895) | 1.000000 |
| 4 | 60 | 1 | top-base_faces | 0.061184 (30592) | 0.000000 (0) | 0.000000 | 0.938816 (469408) | 1.000000 |
| 4 | 60 | 1 | all_faces | 0.089790 (44895) | 0.000000 (0) | 0.000000 | 0.910210 (455105) | 1.000000 |

**Snapshot refresh (Phase 4.1/4.2, 2026-07-16):** three additive first-hit launch-face tallies (`launchedCloudTop`/`launchedCloudWall`/`launchedClear`, summing to `launched`) were added to `rawStats` for the rigorous-BRF reference count N_top. All pre-existing fields verified byte-identical to the previous snapshot before replacement.

**Snapshot refresh (review N2, 2026-07-19):** the open-boundary launch window changed from a sunward EXTENSION (window wider than the domain by s = (tau_cloud + beta_ext*d_sfc)*tan(Th0), breaking f_c = 1/M^2) to a pure upwind SHIFT of the cloud-centered M*W domain by the same s (window area = domain area, f_c exact by construction). All 18 Th0=0 rows verified bit-identical (s=0 there; the only per-row delta was the additive `wrapCapped` field, absent from the pre-Phase-3 snapshot shape and now stored as 0). All 18 Th0=60 rows regenerated; launch fractions verified against the closed forms P(top)=f_c (M >= M_min), P(wall)=f_c*(tau/W)*tan(Th0) in verify_phase3.mjs Gate 6.
