# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/), and the project follows
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed (CODE-REVIEW P4 — wrapped-leg path visualization)

- Under periodic domain boundary, a photon path that wraps to a neighboring
  cloud image previously rendered as one continuous straight line/curve from
  the pre-wrap point to the post-wrap point — visually implying the photon
  crossed the entire rendered domain in a single jump, when only its
  horizontal position wrapped (a deferred/cosmetic item from Phase 3, no
  physics/bookkeeping was ever affected). Fixed per CODE-REVIEW P4's
  suggested treatment: a visible line break at every wrap vertex instead of a
  connecting segment.
- `physics.js`: every one of the three wrap sites now flags the vertex it
  pushes immediately after a wrap (`wrapBreak: true`) — both the wrap-hit and
  wrap-miss cases at the initial TOA launch resolution and the surface-
  reflection re-entry site, and the wrap-hit case in the main transport
  loop's side-escape branch. The two miss-branch cases that resolve through
  the shared `surfaceInteraction` closure use a new optional `afterWrap`
  parameter so the closure's own path push carries the flag instead of
  duplicating its geometry-computation logic at each call site.
- `photons.js`: new `Photons.splitPathSegments()` splits a photon's path into
  contiguous sub-arrays at every `wrapBreak` vertex. `addStaticPath` (used for
  both the final full-path render and non-animated batch runs) now draws one
  `THREE.Line` per segment instead of a single line through the whole path.
  The animated tail tube (`replaceActiveTail`, a smooth `CatmullRomCurve3`
  which can't have an internal seam) instead clamps its sliding window to
  never start before the most recent wrap vertex, so the curve only ever
  spans one tile at a time.
- Open boundary is entirely unaffected (no vertex is ever flagged there) and
  legacy modes never call the changed code paths at all.
- Verified: all three golden suites (legacy 54/54 via `diff_golden.mjs`,
  uniform-domain-open 36/36, uniform-domain-periodic 36/36) still pass
  exact-match — purely a rendering change, the `path` array was never part of
  any exported/golden-checked statistic. A dedicated harness confirms
  `physics.js` genuinely emits `wrapBreak` vertices under realistic periodic
  conditions (192/500 photons at M=1, Θ₀=60°, Aₛ=0.5), never at the first
  (launch) vertex, and a hand-traced synthetic case (including two wraps back
  to back with no vertex between them) confirms `splitPathSegments` drops
  degenerate single-point segments and splits everything else correctly.
  (`photons.js` itself can't be imported into the Node test harness — it
  loads `three` from a CDN in the browser — so the segment-splitting logic
  was verified as an extracted copy of the algorithm, not the live import;
  the live version is otherwise unchanged from what was verified.)

### Fixed (CODE-REVIEW P6 — surface-absorption heatmap under Uniform domain)

- The surface-absorption heatmap was gated on `surfaceAlbedo > 0`, so it never
  displayed under Uniform domain illumination at Aₛ = 0 — even though every
  clear-sky-direct photon that reaches the surface there genuinely terminates
  `surface_absorbed` (a black surface reflects nothing), and the resulting map
  traces the cloud's shadow, which CODE-REVIEW called out as "pedagogically
  valuable." Display gate is now `surfaceAlbedo > 0 || entryMode ===
  "uniform_domain"`.
- The heatmap's grid was a fixed 2× cloud-extent regardless of illumination
  mode. Under Uniform domain the direct beam can land anywhere across the full
  M-times-wider domain, so at moderate-to-large M almost every landing clamped
  to the grid's edge cells, destroying the structure the fix above was meant
  to reveal. The grid extent now tracks the domain factor M under Uniform
  domain (`SimStats.surfaceFootFactor()`, capped at 10× to bound memory/
  rebuild cost), read once per run (cached in `SimStats._surfFootFactor`, same
  acquisition-time-gate convention as `_pixelFrac`) — never per-photon, so the
  hot loop (`_addSurfaceFootprint`) gained no new DOM reads. At M ≤ 2 this is
  numerically identical to the legacy fixed 2× grid. All three call sites
  (`ensureFootprintGrids`, `_addSurfaceFootprint`, `Scene.rebuildHistograms`)
  now read the same cached property instead of three independently-maintained
  hardcoded constants that had to be kept in sync by convention.
- Purely a display/binning change — verified no physics/RNG impact: legacy
  golden (54/54, via `diff_golden.mjs`), uniform-domain-open golden (36/36),
  and uniform-domain-periodic golden (36/36) all still pass exact-match, and a
  dedicated smoke test confirms the factor/grid-size table (legacy modes and
  Uniform domain at M≤2 stay at factor 2; M=4 → factor 4; M≥10 clamps to the
  cap) and that a landing point which the old fixed-2× grid would have
  edge-clamped now lands in its true bin at M=4.

## [v6.0.2] — 2026-07-14

Tagged and pushed to GitHub (`origin/main` and tag `v6.0.2`). Direct clear-sky
(surface) illumination for a non-black surface (Aₛ > 0), plus a general-purpose R/T/A
component breakdown. Both the **open/isolated** and **periodic** (tiled cloud field)
domain boundaries are implemented, with test-folder coverage (golden snapshots +
Illumination-comparisons imagery) for both (see `TODO-direct-surface-illumination.md`).
Also includes a UI pass: a Stop control for the run loop, and clearer visual grouping
of the Uniform-domain sub-options.

### Added (2026-07-14 session — run-control UI)

- **Stop button**: hard-terminates the in-flight run (instant-batch chunk loop or
  animated sequence), checked ahead of Pause so it wins even while paused. Unlike
  Pause, there is no Resume from Stop — only Reset (which now also clears the new
  `state.isStopped` flag) starts a clean run, picking up any input changes made in
  the meantime.
- Font color-coding for the run-control row: Pause light orange (`#fdba74`), Stop
  red (`#f87171`), Reset yellow (`#fde047`), against the existing blue button fill.
- The "Domain factor M" and "Domain boundary" labels (shown only under Uniform
  domain illumination) are now indented via `padding-left` on the `<label>` so
  wrapped text stays indented on every line, marking them visually as sub-options.

### Added (2026-07-14 session — Phase 3: periodic domain boundary)

- **Periodic domain boundary**, selectable alongside the existing open/isolated boundary
  whenever Illumination = "Uniform domain" (new `#domainBoundary` selector). Tiles the
  M·W × M·D domain infinitely in both horizontal directions (a regular/broken cloud
  field), reusing `rayBoxEntry` unchanged at each tile via a new wrap-and-retest helper
  (`Physics.wrapAndFindBoxEntry`). Wired into all **three** sites a photon can encounter a
  neighboring cloud image: the surface-reflection re-entry path, the direct
  upward-side-escape branch in the main transport loop, and — easy to miss, caught by
  external code review (P2) — the initial TOA descending ray-cast in the uniform-domain
  launch resolution (the "sunward-wall reservoir" a leeward-edge point would otherwise
  miss under open boundary is supplied by the neighbor tile under periodic, so the M_min
  under-sampling warning is now suppressed under periodic).
- `rayBoxEntry` additionally returns `tEnter` (additive); new wrap-iteration safety cap
  `MAX_WRAPS = 10000`, capped photons tallied in a new `wrapCapped` counter (folded into
  `terminated` for closure, tracked separately so it's never silently conflated with a
  MAX_EVENTS cap — verified 0 at realistic parameters).
- S bookkeeping under periodic (decided 2026-07-12, see CODE-REVIEW P4) verified exactly:
  S does not go to zero (all_faces reduces to exactly the surface bypass; top-base_faces
  stays substantial — "escape to space through the gaps between clouds"); terminal
  downward side escapes are identically 0 (migrate into T, as required).
- New gate suite `tests/review-harness/verify_phase3.mjs` (7 gates, all passing): budget
  closure under periodic; S(all_faces) == surfaceBypassUp exactly (88,171 = 88,171);
  S(periodic) ≤ S(open) at matched settings (218,064 ≤ 230,321); terminal
  sideEscapeDown ≡ 0; wrapCapped = 0 at N=300k; periodic/open convergence at large M
  (confirms the "approximation improves with M" claim holds under periodic tiling too);
  and the third-wrap-site signature directly (below M_min(60°)=1.866, at M=1.566 periodic
  recovers 52,934 sunward-wall entries vs. open's 34,496 for the identical launch-point
  sequence). `gen_golden.mjs` (54/54) and `check_golden_ud.mjs` (36/36) both still pass
  exact-match under open boundary — Phase 3 only changes behavior when
  `domainBoundary === "periodic"`.

### Fixed (2026-07-14 session, caught by the 3c golden-snapshot matrix)

- The direct upward-side-escape wrap site initially only handled `dir.z < 0`.
  `gen_golden_periodic.mjs`'s 18-run x 500k-photon matrix (M∈{1,2,4} × Θ₀∈{0,60} ×
  Aₛ∈{0,0.5,1}) failed its embedded `terminalSideEscapeDownIsZero` gate at every
  Aₛ=0 row: a downward-moving (`dir.z > 0`) side-wall exit at Aₛ=0 has no surface to
  bounce off, but is still geometrically able to clip a neighboring cloud image,
  exactly like the upward case — the fix needed to be direction-independent. A
  second, related bug: once wrapped, a genuine miss on a downward leg must proceed
  to the surface unconditionally on Aₛ (not just when Aₛ > 0) — under periodic there
  is no "escape to nowhere" sideways, the physical ground is always present
  everywhere, same reasoning already applied to the uniform_domain clear-miss
  launch branch. Both fixed; all 36 golden rows pass their embedded gates; open
  boundary re-verified completely unaffected (both existing goldens still
  exact-match; the Illumination-comparisons open-boundary JSON export is
  byte-identical, timestamp aside, to the pre-Phase-3 committed export).

### Added (2026-07-14 session — task 3c: periodic test coverage)

- `tests/golden-snapshots/gen_golden_periodic.mjs` / `golden_periodic_v6.0-phase3.json`
  / `golden_periodic_snapshot_v6.0-phase3.md` / `check_golden_periodic.mjs`: locks the
  periodic-boundary case bit-for-bit, same 36-row M×Θ₀×Aₛ matrix as the open-boundary
  golden, with embedded Phase-3 gate assertions (budget closure incl. safety-cap
  residual, S(all_faces)==surfaceBypassUp, terminal sideEscapeDown≡0, wrapCapped
  negligible) checked at generation time — all pass.
- Four new open-vs-periodic comparison figures in `tests/Illumination comparisons/`
  (M=4, Aₛ=0.5, Θ₀∈{0,60}, geomB + entireDomain views) as the Phase-3 counterpart of
  the existing uniform-top-vs-uniform-domain figures.
- `tests/review-harness/gen_export.mjs` gained an optional 8th CLI arg
  (`[boundary]`, default `open`) to drive periodic-boundary exports.

### Fixed (2026-07-14 session, caught during Phase 3 export review)

- `exportUtils.js`'s `outputs.uniform_domain_outputs.domain_boundary` was a second,
  independent hardcoded `"open"` string (separate from `inputs.domain_boundary`, which was
  correctly wired) — missed on the first Phase 3 pass. This is the field
  `mc_export_reader.py`'s `to_xarray()`/`to_netcdf()` actually reads for the primary
  `domain_boundary` NetCDF attribute, so periodic-boundary runs were silently exported
  (and would have written to NetCDF) mislabeled `"open"`. Fixed; verified end-to-end
  (`gen_export.mjs uniform_domain 60 0.5 all_faces 2 200000 1.0 periodic` →
  `mc_export_reader.py --netcdf`): JSON shows `"periodic"` in both locations, the printed
  summary shows "domain boundary : periodic", and the written NetCDF's `domain_boundary`
  global attribute reads `"periodic"`. No `mc_export_reader.py` changes were needed — it
  already reads `domain_boundary` as a plain string with no periodic-specific parsing, and
  Phase 3 added no new JSON fields (schema stays 1.3, only an existing field's *value* was
  wrong for one export path).

### Added (2026-07-16 session — Phase 4: rigorous BRF/BTF + sub-cloud observation pixel)

- **Rigorous BRF/BTF normalization, all illumination modes** (user decision: not limited
  to Uniform domain). The BDF polar panels now display BRF (reflected) / BTF (net
  transmitted) = π·N_ij/(N_top·A_proj/W²·µΔµΔφ), where **N_top is the realized
  top-face-incident photon count** (new first-hit tallies, ratio-estimator design) and
  **A_proj(θᵥ,φᵥ)/W² = 1 + (τ_cloud/W)·tanθᵥ·(|cosφᵥ|+|sinφᵥ|)** is the view-projected
  cloud-element footprint, applied under side-inclusive observation and ≡ 1 for top-face
  observation. **Uncapped** (equivalent-uniform-beam convention; reverses the TODO's
  earlier cap-at-A_domain note — preserves UD(M=1) ≡ legacy-top bit-identity and cross-M
  comparability). The **entire-domain view keeps N-normalization** — the f_c-diluted
  value is the correct domain-mean BDF for a whole-domain FOV. Verified gates: legacy
  top/centered under top-face observation are **bit-identical to the historical BDF**
  (DISORT-validated cases unchanged by construction); UD(M=1) ≡ top; and the headline
  physics: UD M=4, Θ₀=0, Aₛ=0.5 reflected BRF exceeds uniform-top by **1.375×** — the
  surface-recycling brightening, previously hidden under the 16× f_c dilution.
- **First-hit launch tallies**: `launchedCloudTop`/`launchedCloudWall`/`launchedClear`
  (sum = launched; physics.js now reports the first-hit face top/wall/clear). Verified:
  wall counts match the sunward-reservoir expectation within 1σ; both golden snapshots
  regenerated with pre-existing fields byte-identical.
- **Sub-cloud observation pixel**: new "Obs pixel fraction (f_pix)" input (0.05–1,
  default 1 = whole face; changing it resets the run, like τ/extent/M). At f_pix < 1 the
  Reflected μ/BRF panels restrict to cloud-top-face exits inside the centered pixel
  |x|,|y| ≤ f_pix·W/2 (fixed pixel per run; Obs-geometry dropdown not applied — a pixel
  is only well-posed on the flat top face), normalized by N_pixel = N_top·f_pix².
  Verified: f_pix = 1 is bit-identical to the whole-face view; at f_pix = 0.5, Θ₀=0,
  extent 40 the central pixel is ~1.29× brighter than the face average (edge darkening).
- **JSON schema 1.2 → 1.3 (additive)**: `outputs.counts.launched_cloud_top/_wall/_clear`,
  `bdf.n_top_incident`, `bdf.reflected_brf`/`net_transmitted_brf` (panel-matching
  normalization; omitted with a note when N_top = 0), and — when f_pix < 1 —
  `inputs.pixel_fraction`, `mu_histograms.reflected_counts_pixel`,
  `bdf.reflected_weights_pixel`/`reflected_brf_pixel`/`n_pixel_incident`. The historical
  N-normalized `*_bdf` grids are unchanged (domain-mean quantity). `mc_export_reader.py`
  updated (summary lines, properties, xarray variables); round-trip tested for
  uniform-domain, legacy, and pixel runs. PNG headers carry f_pix on the Obs-geometry
  line. New gate suite: `tests/review-harness/verify_phase4.mjs` (13 gates, all passing).
- **Pixel follow-ups from live-browser review** (user's 2M-photon UD M=4, f_pix=0.10 run):
  (i) confirmed NOT a normalization bug — the reproduced run gives pixel BRF = 1.09× the
  whole-face BRF, exactly as expected; the speckled map is pure sparseness (640 exits
  over 1,368 bins → ~⅔ empty, occupied single-count bins clip at ≥1). A
  **sparse-statistics warning** now appears in the BRF caption when the pixel holds
  < 2 counts/bin on average. (ii) f_pix is now **disabled (and reset to 1) under
  Centered illumination** — N_pixel = N_top·f_pix² requires uniform top-face
  illumination, which holds for uniform-top, top+side, and uniform-domain but not for a
  point source. Same disable/dim pattern as the entire-domain checkbox. (iii) control
  renamed "Reflected observation pixel fraction (f_pix)" (and the stats-panel line to
  match) — the pixel applies to the Reflected channel only, so the BTF panel remains
  dropdown-aware, which is why it shifts when toggling the Observation geometry while
  the pixel view does not. (iv) **Pixel view now renders only under Obs geometry "cloud
  top/base faces only"** (user-caught disconnect: the pixel view previously overrode a
  side-inclusive dropdown selection silently). A planar pixel is geometrically well-posed
  on the flat top face only (the TODO's original scoping); under "top/base/side faces"
  the Reflected panel shows the standard side-inclusive view with a caption pointing at
  the dropdown setting that exposes the pixel. The accumulators remain dropdown-
  independent (f_pix is an acquisition setting, the dropdown a display-time choice), so
  one run serves both views with no re-run. (v) Pixel panel titles reworded "Reflected
  (for f_pix=…)" / "Reflected (for f_pix)". (vi) **Deferred f_pix application** (second
  iteration after live testing — a change-detection guard still wiped the run on any
  genuine edit): editing f_pix now NEVER resets anything. The input is a request; the
  value governing accumulators, panels, stats line, PNG headers, and JSON export is the
  one cached at run start (`SimStats._pixelFrac`); an edited value is shown as
  "pending … (applies at next Launch Ensemble/Reset)" in the stats panel until then.
  Unlike τ/extent/M (which invalidate the whole scene), f_pix only governs an auxiliary
  accumulator set, so the destructive-reset convention was the wrong fit. (vii) The
  **τ / horizontal-extent / domain-factor-M inputs got change-detection guards**: a
  genuine edit still resets (required — the scene geometry is baked into every
  trajectory), but focus-in/focus-out with no change no longer wipes a finished run.
  Guards compare against the applied values in `world` (synced at every run start;
  `world` now exposed on `window` for the inline handlers).
- **`tests/` regenerated for Phase 4**: golden snapshots re-confirmed exact (54 legacy
  rows via strip-diff; 36 uniform-domain rows, refreshed in P4.2 with the additive
  tallies). All 14 `tests/Illumination comparisons/` JSONs regenerated at schema 1.3;
  `illumination_comparison.py` gained a `--brf` flag (rows 3–4 plot the rigorous
  BRF/BTF grids, axis/colorbar labels follow; ignored with a warning under
  `--entire-domain`, whose domain-mean view is N-normalized by design). All 10 figures
  regenerated: the 8 cloud-element figures with `--brf` (geomA/test values unchanged by
  construction, labels now BRF/BTF; geomB figures gain the A_proj correction — the old
  grazing radiance spike is gone, as a finite-target reflectance factor should behave);
  the 2 UD figures now display the dilution-free comparison (UD ≈ 1.4× uniform-top,
  the surface-recycling brightening); the 2 entire-domain figures keep the domain-mean
  BDF with suptitles saying so.

### Fixed / changed (2026-07-12 code-review session)

*(The E#/R#/P# identifiers below refer to a local development review document not tracked
in the repository, same as the TODO dev journals; the substantive content of each fix is
summarized here.)*
- **μ-histogram N label** (Net Transmitted, Uniform domain + "cloud top/base faces only"):
  the displayed N overstated the plotted-bin population (it ignored the Observation-
  geometry dropdown); now matches the plotted bins exactly under both geometries. (E1)
- **JSON path-length histograms match the on-screen panel again**: the exported `bin_max`
  now comes from the same shared axis logic the figure uses (genuine, cloud-touched
  population), fixing a divergence introduced when the panel's axis was decontaminated —
  which had silently affected legacy-mode exports too. Shared helpers
  (`SimStats.segMean/pathAxisMax/pathHistogramCounts`) are now the single owner of the
  histogram spec for both figure and file. (E2/R2)
- **JSON schema 1.1 → 1.2 (additive)**: stale "signed ±1 ledger" descriptions rewritten
  for the terminal-event-only bin construction; Uniform-domain runs now also export the
  decontaminated `net_transmitted_counts_cloud_only`/`_domain_wide_cloud_only` μ arrays,
  the matching BDF weight grids, and `clear_direct_count`/`clear_direct_mu_bin_index`, so
  the clear-sky-direct delta spike in the raw arrays is documented and removable by any
  reader. (E3/E4)
- **`mc_export_reader.py` updated for schemas 1.1/1.2**: reads `uniform_domain_outputs`,
  domain inputs, cloud fraction, and the new arrays; prints an ENTIRE DOMAIN summary block
  with exact component-sum consistency checks; passes an end-to-end round-trip test driven
  by the real browser export pipeline (`tests/review-harness/gen_export_roundtrip.mjs`). (E8)
- **Green base-crossing footprint is now structurally 1:1 with the green 3D markers**
  (both skip `viaSide` surface arrivals). For legacy modes this is bit-identical (verified:
  0 in-grid viaSide landings). For Uniform-domain runs at oblique sun it fixes a real
  contamination: clear-sky-direct rays steep enough to cross the footprint edge below cloud
  base traverse the sub-cloud clear gap and land under the cloud (e.g. 2,834 of 105,873
  viaSide arrivals in-grid at Θ₀=60°, M=3) — these were wrongly binned into the
  base-crossing footprint despite never crossing the base. (E12)
- **Changing the Illumination geometry now resets the scene and statistics** (same
  convention as τ/extent/M changes): the surface plane resizes to/from the M-factor domain
  immediately, and photons from different illumination modes can no longer be mixed into
  one statistics set via successive "Launch One" clicks. (E7)
- `tests/golden-snapshots/gen_golden.mjs`: portable relative import path (was hardcoded to
  a dev-machine absolute path, breaking the regression gate everywhere else). (E6)
- Stale comments corrected (clear-direct photons DO reach `surface_absorbed` at Aₛ = 0
  under Uniform domain; the albedo RNG draw there is deliberate — do not optimize away). (E5)
- Legacy stats panel (d)-component label: briefly renamed "surface bypass (no cloud
  re-entry)" during the review, then REVERTED to the original "from clear sky, via cloud"
  (user decision, 2026-07-14): in the panel's parallel "from X" structure, "from" denotes
  the final exit pathway (per the component-definition rule), and one bucket should have
  one name in both panels. The origin-ambiguity concern is addressed in the README
  instead — whose (d) description was found to be outright wrong ("re-enters the cloud
  and then escapes upward" — that photon belongs to the cloud-top/side components) and is
  now corrected. (E9)
- PNG 3D-view export legend: added the surface-reflected (purple) and surface-absorbed
  (brown) marker entries that were drawn in Aₛ > 0 exports but missing from the legend. (E10)
- Batch of small consistency fixes: `generator` string renamed to VISTA-C; bottom-panel
  export mode fallback aligned; combiners now always return copies (never the live
  accumulator); `world.domainW/domainD` declared in `state.js`; checkbox labels
  click-bound via `for=`; `units.domain_factor` documented in the JSON. (E11)
- Default photon count raised 400 → 10,000 (`index.html` input default, `ui.js` fallback,
  README Controls table).
- New verification tooling in `tests/review-harness/` (`verify_review_findings.mjs` —
  post-fix assertions; `gen_export_roundtrip.mjs` — JSON export/reader round-trip;
  `diff_golden.mjs`, `golden_one.mjs`). The review write-up itself is kept as a local
  dev document (untracked, like the TODO journals).
- Repo hygiene: removed a stray zero-byte file named `git` from the repository root.
- **`tests/Illumination comparisons/` regenerated with the v6.0.1 code** (2026-07-14):
  all 12 legacy JSON exports rebuilt at schema 1.2 via the real export pipeline in Node
  (`tests/review-harness/gen_export.mjs`, new parametrized generator; 2×10⁶ photons,
  seed 42, same parameters as the originals). Verified against the committed originals:
  physics-level counts bit-identical; expected differences only — schema 1.0→1.2,
  net-transmitted μ arrays now terminal-event-only (a residual negative bin in one old
  export is gone), and geomB R/S counts shifted by exactly the surface-bypass population
  (the documented v6.0 Observation-geometry redesign: old geomB ≡ "scene" with S≡0; new
  "all_faces" keeps bypass in S). All 6 comparison PNGs regenerated, plus **2 new
  Uniform-domain figures** (`illumination_comparison_UD_M4_As0.5_geomB_theta0={0,60}.png`,
  uniform-top vs uniform-domain M=4) with net-transmitted shown cloud-only.
- `illumination_comparison.py`: optional CLI arguments (`--file-a/-b`, `--label-a/-b`,
  `--outfile`, `--suptitle`, `--transmitted-cloud-only`) for batch figure generation —
  fully backward-compatible (no arguments = the CONFIG block, as before). The
  `--transmitted-cloud-only` flag uses the schema-1.2 cloud-only arrays (and renormalizes
  the cloud-only BDF), matching what the in-app panels plot for Uniform-domain runs;
  polar-plot short titles now use two words (fixes "uniform" vs "uniform" ambiguity).
  Axis-label corrections (all 8 figures regenerated): the BDF row was tagged
  "(radiance)" as if a unit — BDF = (W/N)·π/(μΔμΔφ) is dimensionless (π·L/F₀, a
  reflectance-factor-type quantity), now "(dimensionless, ∝ radiance)"; the flux rows
  now state "(area-normalized: shape only)" so absolute-total differences between runs
  (side-leakage R deficit) are read from the BDF rows, not row 1. Consistency of the
  flux and BDF rows verified to machine epsilon via (1/N)·dN/dμ = 2μ·B̄DF; the mid-range
  BDF offset between illumination modes equals the total-R ratio (e.g. 1.35 at Θ₀=0).
- JSON export (still schema 1.2, additive): Uniform-domain runs now also carry the
  domain-wide REFLECTED arrays (`mu_histograms.reflected_counts_domain_wide`,
  `bdf.reflected_weights_domain_wide` — side exits + surface bypass), completing export
  parity with the in-app "Show entire-domain plots" toggle. New `--entire-domain` flag in
  `illumination_comparison.py` uses them (and the domain-wide cloud-only transmitted
  arrays), and two new figures were added:
  `illumination_comparison_UD_M4_As0.5_entireDomain_theta0={0,60}.png`. The Θ₀=0 one
  shows the expected whole-domain-FOV signature: near-flat UD reflected BDF ≈ R_domain
  (quasi-Lambertian bright-surface-dominated scene).
- **Uniform-domain golden snapshot (pre-Phase-3 regression lock)**:
  `tests/golden-snapshots/gen_golden_ud.mjs` + `golden_ud_v6.0-phase2.json` (+ `.md`
  summary) — 18 runs (M∈{1,2,4} × Θ₀∈{0°,60°} × Aₛ∈{0,0.5,1}, 500k photons each, seed 42)
  locking all v6.0 counters, the domain budget, and component breakdowns bit-for-bit;
  M=1 verified to reproduce legacy "top" exactly (240/240 fields vs `golden_v5.4.0.json`).
  Re-verify anytime with `node tests/golden-snapshots/check_golden_ud.mjs`.

### Added
- **New "Uniform domain" illumination mode.** Every previous illumination mode (centered,
  uniform cloud-top, uniform cloud-top + sunward side) launches photons only onto the
  cloud itself. "Uniform domain" instead launches a TOA-uniform beam over a domain
  **M times wider than the cloud** (new **domain factor M ≥ 1** input) and ray-casts each
  photon to its first surface — cloud top, sunward side wall, or, new, the clear ground.
  This is what lets a reflective surface (Aₛ > 0) be illuminated directly by the sun, not
  only through the cloud, closing a real physics gap: R/T/A previously described only what
  the cloud does to light that already hits the cloud, not what a satellite pixel or model
  grid cell sees over cloud plus bright clear sky.
- **Cloud fraction f_c = 1/M²**, reported alongside the domain factor. Note M is a **1D**
  (linear) scaling and f_c is **2D** (areal) — M = 2 means f_c = 0.25, not "half the cloud
  fraction."
- **"ENTIRE DOMAIN" report block** (Uniform domain illumination only): an always-shown
  domain-normalized R_domain/T_domain/A_cloud budget (fractions of the *entire* launched
  domain, closing to 1.000), independent of the Observation-geometry dropdown. A **"Show
  R/T/A components"** checkbox expands it to a full breakdown of each component's origin
  (see below) — see the illumination × observation-geometry × outcome table below for how
  this relates to the existing Observation-geometry-driven R/T/A/S numbers.
- **R/T/A component breakdown**, under the same "Show R/T/A components" checkbox —
  available for **every** illumination mode, not just Uniform domain: Reflected splits into
  cloud-top / cloud-side / clear-sky-direct / clear-sky-via-cloud; Net transmitted splits
  into cloud-base / cloud-side / clear-sky-direct; Cloud absorption splits into
  cloud-incident vs. clear-sky-incident origins. (The clear-sky components are always zero
  for legacy illumination modes, which have no clear-sky photon source; the breakdown is
  otherwise identical for those modes and directly explains why, e.g., "cloud top/base/side
  faces" R can exceed "cloud top/base faces only" R — see the table below.)
- **"Show entire-domain plots" toggle** (bottom panel, Uniform domain only): swaps the
  Reflected and Net Transmitted μ-histogram / BDF / path-length plots from the
  cloud-element-only population to the domain-wide one. The domain-wide Net Transmitted
  view excludes the clear-sky-direct population from the plotted bars/mean (it's a true
  delta-function spike at exactly Θ₀ that no shared axis could show proportionally
  alongside real structure) and reports its count as separate text instead.
- **Domain-margin warning**: a live banner flags when the chosen M is smaller than the
  minimum needed to fully capture direct sunward-wall illumination at the current
  Θ₀/τ_cloud/horizontal-extent combination (M_min = 1 + 2·(τ_cloud/W)·tanΘ₀).
- JSON export: `domain_factor`/`domain_boundary` inputs and `cloud_fraction`/
  `uniform_domain_outputs` (nested R/T/A component breakdowns) outputs, present only for
  Uniform domain runs. Schema version 1.0 → 1.1 (additive only; 1.0 readers unaffected).

### Changed
- **Net Transmitted μ-histogram/BDF now use terminal-event-only binning.** The previous
  construction (an arrival/reflection running ledger) could show spurious negative bins
  under Uniform domain, where the clear-sky-direct population's exit angle is a true delta
  function; every mode and geometry is now guaranteed non-negative bins by construction.
  Legacy-mode outputs are unchanged (bit-identical).
- Path-length distributions decontaminate the clear-sky-direct (exactly-zero optical path)
  population from the plotted bars and reported mean under Uniform domain, instead of
  crushing the axis scale and biasing the mean toward zero; its count is reported as
  separate text. Legacy-mode outputs are unchanged.
- PNG exports: an entire-domain-plots export no longer shows Observation-geometry-driven
  stats that don't describe what's actually plotted below them; the on-screen 3D-view
  legend moved to a bottom-center band and widened (previously could overlap or clip past
  the canvas edge at some export widths); parameter/stat/domain boxes now share symmetric
  margins; BDF plot captions shortened so they no longer run off the canvas edges.
- Stats panel: FINAL OUTCOMES, SURFACE FLUX DIAGNOSTICS, and the new RADIATIVE COMPONENTS /
  ENTIRE DOMAIN sections reformatted with consistent indentation and bold section titles;
  "Active photon" moved near the top of the panel (previously at the very bottom); "Show
  R/T/A components" checkbox relocated next to the text it controls (previously grouped
  with unrelated Visualization-only toggles).
- 3D view: the rendered surface plane now scales with the Uniform domain's M-factor domain
  width (previously always rendered at the cloud's own footprint size regardless of M), with
  a thin outline marking the cloud's own footprint for scale reference at M > 1.

### Fixed
- `photonEntryLabel()` had no case for the new "uniform_domain" mode (silently fell back to
  "centered" in exports).

### New illumination × observation-geometry × outcome bookkeeping

The table below summarizes which outcome bucket (R/T/S/A) each kind of photon exit is
assigned to, for every combination now available — verified against the actual counter
identities in `simstats.js` (`reflectedCount()`/`transmittedNetCount()`/`sideExitCount()`/
`domain*Count()`), not just derived by inspection. "Bypass" is a surface-reflected photon
that escapes upward without ever (re-)touching a cloud face (only possible for Aₛ > 0, any
illumination mode); "clear-sky-direct" only exists under Uniform domain illumination.

| Exit / event | Obs. geometry: top/base faces only | Obs. geometry: top/base/side faces | ENTIRE DOMAIN (Uniform domain only, dropdown-independent) |
|---|---|---|---|
| Cloud-top exit (upward) | R | R | R |
| Cloud-side exit (upward) | S | R | R |
| Cloud-base-derived net surface absorption | T | T | T |
| Cloud-side-derived net surface absorption | S | T | T |
| Clear-sky-direct net surface absorption (Uniform domain only) | S | T | T |
| Surface bypass (reflects, escapes upward, never (re-)touches cloud) | S | S | R |
| Cloud interior absorption | A | A | A |

Two verified identities fall out of this: **R_domain = R(top/base/side faces) + bypass** —
"entire domain" R exceeds "top/base/side faces" R by exactly the bypass count, nothing
else — and **T(top/base/side faces) already equals T_domain exactly**; there is no
further T gain from selecting "entire domain," because "top/base/side faces" already
folds in cloud-side- *and* clear-sky-direct-derived surface absorption. Only "top/base
faces only" excludes those two from T (folding both into S instead) — confirmed
numerically (Θ₀=60°, Aₛ=0.5, M=3): S under "top/base/side faces" equals the bypass count
exactly, with nothing else left in S. This is also why "top/base/side faces" R can be
noticeably larger than "top/base faces only" R under Uniform domain illumination: the gap
is exactly the cloud-side-exit population, now visible directly in the R/T/A component
breakdown above. Full derivation (including the underlying per-crossing counters) is in
`TODO-direct-surface-illumination.md`'s "Component / outcome bookkeeping" and "T and A
component decomposition" sections.

## [5.4.0] — 2026-06-29

Rendering-performance release. No change to the physics, statistics, or any exported
output — the visualization is byte-for-byte identical.

### Changed
- **Footprint heatmaps now render as a single `InstancedMesh` each** (reflected,
  base-crossing, and surface). Previously each non-empty grid cell was its own
  `Mesh` + `BoxGeometry` + `MeshStandardMaterial` — ~3700 objects at 100k photons,
  rebuilt on every display refresh; now three instanced meshes draw all cells from a
  shared unit box scaled per instance. Per-cell color, opacity, and emissive glow are
  preserved exactly: color via `setColorAt`, and per-instance opacity + emissive
  (which three.js `instanceColor` cannot carry) via two `InstancedBufferAttribute`s
  injected through `material.onBeforeCompile`. The look is unchanged; 1M-photon runs
  are ~15–25% faster and allocate/free far fewer objects, so orbit/pan stays smoother
  during and after large runs.

## [5.3.0] — 2026-06-18

Observation-geometry correction. The old "cloud top/base + sides" was mislabeled:
it actually collected the **entire scene** (folding surface-reflected upward-bypass
flux into R). It is split into three correctly-labeled geometries, with a new
cloud-element geometry in the middle.

### Changed
- **Observation geometry is now a three-way choice** (was two):
  - **`top-base_faces`** (a) — cloud top/base faces only. Unchanged from the old
    `faces` / "cloud top/base faces only."
  - **`all_faces`** (b) — NEW, the "cloud element": photons leaving any cloud face
    go to R (upward: top + sides) or T (downward: base + sides), but
    surface-reflected photons that escape upward *without re-entering the cloud*
    stay in **S** (they left no cloud face).
  - **`scene`** (c) — entire scene: all upwelling → R, all downwelling → T, S = 0.
    This is exactly the old `faces_sides` behavior, renamed and relabeled. R here
    includes surface-bypass reflections, so it is the whole-scene albedo, not pure
    cloud-top reflectance.
  The only difference between b and c is the surface-reflected upward bypass
  (S under b, R under c); T and A are identical across b and c.
- **JSON `observation_geometry` keys** are now `top-base_faces` / `all_faces` /
  `scene` (were `cloud_top_base_faces_only` / `cloud_top_base_and_sides`). Old
  exports still load — only the label string changed (old "…and_sides" ≡ `scene`).
- **Responsive overlay UI** — the control panel, header, legend, and bottom-panel
  plots now scale proportionally to fit smaller laptop/desktop windows (the 3-D
  canvas stays native resolution and reclaims the freed space). Presentation only;
  no effect on the simulation or its outputs.
- **Default cloud framing lowered** so the visualization sits clear of the legend on
  load (the camera and its target are panned down together, so the view angle is
  unchanged). Presentation only.

### Fixed
- **Path-length x-axis is now observation-geometry-independent.** Its scale is
  taken from the full (all-channel) path set rather than the active geometry's
  subset, so a/b/c share identical bin edges. Previously the axis could tip across
  a decade boundary between geometries (e.g. >60 vs >70), making the *identical*
  b/c transmitted distributions appear different.

## [5.2.0] — 2026-06-18

Visualization clarity improvements. Consistent visualization colors, better description of 3-D exit markers, added surface absorption heatmap, several rendering/usability fixes.

### Added
- **Surface-absorption heatmap** (Aₛ > 0): a 2-D map of photon surface absorption, on a grid 2× the cloud extent to better indicate absorption from cloud side leakage. Absorption beyond the surface grid clamps to the nearest boundary cell (a corner only when it overshoots the grid in both axes; the corners thus tend to be the brightest overflow bins). Geometry-independent. A **"Show surface heatmap"** toggle (default on) can be used to avoid overlap with the cloud base crossing footprint, and removes its rendering cost when off.

### Changed
- **Exit-marker legend descriptions.** Green markers are now
  drawn at *every* downward cloud-base crossing (consistent with the base footprint heatmap),
  relabeled **"downward cloud-base crossings"** (was "bottom transmitted
  endpoints"): unchanged at Aₛ = 0, but now also shown at Aₛ > 0. Blue markers
  relabeled **"upward cloud-top crossings"** (was "top reflected endpoints").
  Footprint legend "transmitted 2-D footprint" → **"downward cloud-base crossings
  footprint"**; "surface absorbed events" → **"surface absorbed endpoints"**.
- **Reflected endpoints recolored** from yellow to blue (`#60a5fa`) to match the
  reflected paths and footprint.
- **Surface-heatmap relief** matched to the reflected/base heatmaps so all three
  share one height scale (heights remain self-normalized within each map).
- **"Endpoint caps shown" is now a non-destructive display filter** — lowering
  then raising it reveals the same markers (retained, not discarded), even when a
  run finished with the slider at zero. The slider counts *markers* (crossings +
  endpoints), which exceed the photon count.

### Fixed
- **Surface absorptions were drawn twice** (a terminal endpoint plus a redundant
  surface event); now drawn once, as the dark brown endpoint, consistent with how cloud
  absorption is shown. Mid-trajectory surface *reflections* remain events (purple).

## [5.1.0] — 2026-06-17

Usability and limiting-case release: a true-angle incident-beam arrow, access to
the optically-thin / conservative-scattering regime, and a simpler Plot panel.

### Added
- **Cloud optical thickness now reaches 0.01** (was 0.1), with the input step
  tightened to 0.01. This makes the optically-thin limit reachable — e.g.
  confirming reflected flux → surface albedo as COT → 0 (validated against
  DISORT) — and supports pristine-aerosol cases (low AOD).

### Changed
- **Incident-direction arrow redrawn as solid geometry** (cylinder shaft + cone
  head, unlit red) so it stays clearly visible against dense photon paths during
  large ensembles, instead of a hairline that WebGL renders 1 px wide.
- **Near-nadir BDF azimuthal averaging is now always on**, and its toggle was
  removed from the Plot panel. The averaging only ever affected the innermost
  ring (θ < 5°) and is display-only; the JSON export remains raw/unsmoothed, and
  its `bdf` description now notes that the PNG and JSON differ at that ring.

### Fixed
- **Incident-zenith (Θ₀) arrow orientation** now points along the true incident
  direction, so its tilt equals Θ₀ across the full 0–89° range. Previously a
  fixed vertical component compressed the apparent angle (≈35° at 60°, ≈39° at
  89°), making the arrow look frozen at large Θ₀. Rendering-only; the simulated
  photon directions were always correct.

## [5.0.0] — 2026-06-15

Major capability release: quantitative data export, finite-cloud illumination
and observation-geometry controls, a DISORT validation suite, and a
radiative-transfer terminology pass. **Breaking:** the JSON export key names and
the side-exit accounting changed, so files written by v4.x do not round-trip
through the v5 reader unchanged.

### Added
- **Quantitative data export** — a "Download Data (JSON)" button writes
  full-precision µ histograms, BDF arrays, path-length distributions, and the run
  inputs/outputs. Companion `mc_export_reader.py` loads the JSON into NumPy/xarray
  and optionally converts to a CF-style NetCDF file.
- **Photon-illumination modes** — centered (pencil beam), uniform cloud-top, and
  uniform cloud-top + sunward side wall (projected-area weighting), for studying
  finite-cloud / 3-D illumination effects.
- **Observation-geometry control** — aggregate exits over the cloud top/base
  faces only ("a") or also include side-wall exits ("b": upward → R, downward → T,
  so S → 0). A pure post-processing choice that re-bins a completed run instantly
  with no re-simulation.
- **Validation & analysis tooling** — a `tests/` suite comparing MC fluxes and
  BDFs against DISORT (PythonicDISORT), and `illumination_comparison.py`, a 4×2
  comparison figure (µ / path / BDF-vs-zenith / BDF-polar).
- Horizontal extent raised to 500 optical depths.

### Changed
- **Radiative-transfer terminology** made consistent across the stats panel, PNG
  headers, JSON keys, and the reader: an explicit flux-vs-radiance distinction,
  F (flux) in place of E (energy), and "normalized flux" labels. JSON dataset keys
  were renamed accordingly (e.g. `R_top_reflected` → `R_reflected`).
- **Left-panel inputs** regrouped into Photon/Model, Plot, and Visualization
  sections with clearer labels (e.g. "Photon illumination", "Footprint grid size").
- Large-run handling: incremental binning (O(1) memory) and throttled display
  refreshes, enabling runs up to 10⁷ photons.

### Fixed
- **3-D cloud-box aspect ratio** now scales the vertical dimension with cloud
  optical thickness, instead of a fixed render height that was only correct at
  COT = 10.
- Reflecting-surface physics: boundary-crossing order and infinite-surface
  side-wall re-entry.
- BDF panel: removed the redundant on-plot normalization formula and corrected the
  near-nadir-averaging annotation.

## [4.0.0] — 2026-06-03

Initial public release. Modular ES-module architecture; physics/stats decoupling;
corrected net transmittance (T = E↓ − E↑); consistent N counts across all displays.

## [3.2] — pre-release

Monolithic single-file implementation; surface geometry and export statistics.
