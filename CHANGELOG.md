# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/), and the project follows
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Tests (2026-07-21 — pre-v6.1 refactoring pass, items A3 + B)

- **One-command test runner** (`tests/run_all.mjs`): runs the whole battery (phase 3/4
  gates, P4/P5 gates, the three golden checks) as child processes, judged by exit code,
  with one PASS/FAIL line and wall time per suite and a nonzero exit on any failure.
  Optional name-filter args (`node tests/run_all.mjs p4 p5`) run a subset for the inner
  loop. Replaces the seven-plus hand-pasted commands, where a skipped suite was a live
  risk. Also gave `diff_golden.mjs` a nonzero exit code on DIFFER — it previously only
  printed, so an automated runner would have read a mismatch as success.
- **Path-length histograms added to all three golden snapshots** (legacy, uniform-domain,
  periodic): each row now carries a `pathHist` object (`bin_max` + 24 integer bin counts
  for the reflected and net-transmitted views, under that row's observation geometry).
  This closes a real coverage gap — the streaming path-length binning had no golden, and
  the P5 fine-bin-boundary bug passed all prior suites. Verified by reintroducing that
  bug: the golden now DIFFERs on `pathHist` bins 14/15. Purely additive — every
  pre-existing field byte-identical across all 36 rows in each file (D1 discipline).

### Fixed (2026-07-21)

- `.gitignore` pattern for the in-repo MODIS phase-function source folder had a typo
  (`netCDDF4` vs the actual `netCDF4`), so the ~0.8 MB of `.nc` files were not being
  ignored. Corrected.

## [v6.0.7] — 2026-07-20

Performance and hygiene release, completing the 2026-07-19 review's remaining items
(P4 follow-ups, P5, P6, N4, D1). No physics or statistics changes: every count, mean,
axis max, and exported histogram bin is bit-identical to v6.0.6, verified by the full
golden and gate battery after each item. Headline: the per-photon path-length arrays
(200+ MB at 20M photons) are replaced by fixed 4.2 MB streaming histograms with
bit-identical output, and short runs regained their progressive on-screen build-up.

### Performance (2026-07-20 session, P6 — allocation micro-items)

- **`rayBoxEntry` no longer allocates per call.** It built a 3×4 nested array and
  destructured it in a `for…of` — four allocations plus an iterator on every call, and
  the periodic wrap loop calls it repeatedly per photon. Unrolled per axis with
  identical arithmetic in identical order: **periodic throughput +7%** (0.975 → 1.047M
  photons/s at M=2; 0.372 → 0.396M at M=1), open boundary unchanged (~1%, noise), all
  goldens bit-identical.
- **The visualization path array is only allocated when it will be used.** Every
  `path.push` was already gated on `storePath`, but the array and its seed vertex were
  built for every photon regardless — two allocations per photon of pure GC pressure in
  a 10⁷-photon batch, where paths are never drawn.
- Deliberately **not** done, with rationale recorded: making the three heatmap frame
  outlines persistent. The review note also cited a per-refresh text sprite, but that
  sprite is built in `buildCloudBox` (once per scene build), not per refresh; the frames
  are three small line objects per rebuild at ~5 rebuilds/s. The gain is unmeasurable and
  the persistent-object pattern is precisely the class that produced the earlier
  paint-order/flicker bugs.

### Documentation (2026-07-20, N4 + D1)

- **N4**: recorded, at the periodic bypass exit site, that two exit-reporting conventions
  coexist on purpose — periodic reports the wrapped τ=0 clearance point, open-boundary
  bypass reports τ=τ_cloud — with what consumes each (μ/BDF are direction-based;
  side-escape markers are repositioned via `lastWallCrossing`), so neither gets "fixed"
  to match the other by mistake.
- **D1**: recorded `golden_v5.4.0.json`'s provenance in its snapshot `.md` — regenerated
  at the R6 commit (54 → 36 rows) and field-verified bit-identical across all 1,404
  shared v5.4.0-era fields, with only additive fields differing. A naive whole-file diff
  shows ~216 apparent mismatches that are all additive-field artifacts; use
  `diff_golden.mjs`, which strips them.

### Performance (2026-07-20 session, P5 — streaming path-length histograms)

- **The per-photon path-length arrays are gone**, replaced by fixed-size streaming
  accumulators. Eight populations (reflected, net-transmitted, side-escape up/down,
  bypass, and the cloud-only twins) each retained every photon's raw optical path —
  measured at 1.27 entries per photon, so ~25M values (200+ MB of doubles before JS
  array overhead) at 20M photons — because the panel's x-axis adapts to the run and the
  binning therefore could not be fixed in advance. Each population is now a fine-grained
  fixed histogram plus a running sum and count: **4.2 MB total, independent of photon
  count** (measured heap growth over a 3M-photon run fell from ~84 MB to 0.6 MB; ~4 MB
  extrapolated to 20M, versus ~560 MB before). Display refreshes no longer re-walk the
  history: `pathHistogramCounts` went from **17.6 ms to 0.02 ms** per call at 3M photons,
  and is now O(occupied bins) rather than O(N), so it no longer grows with run length.
- **Bit-identical output, not an approximation.** Two properties make the streaming form
  lossless: the adaptive axis depends only on means, which stream exactly from a running
  sum and count; and the fine bin width is chosen as 10/(24·M) so that every possible
  display-bin edge — the axis max is always a multiple of 10, over 24 bins — is an exact
  multiple of it, making re-aggregation a pure regrouping with no boundary reassignment.
  The mapping uses integer division: doing it in floating point misplaced a whole fine
  bin at boundaries where the product rounds down (~644 photons at `bin_max = 50` in a
  2M run — found by regenerating a committed export and diffing it, and now covered by a
  gate that sweeps every axis value from 10 to 2000 rather than only the few a sample run
  happens to produce). Exported `bin_max` and all 24 bin counts are unchanged, so the
  export schema stays at 1.4 and existing files remain directly comparable. One
  exception: **multi-segment `*_mean` values differ in the last digit or two** (~1e-14
  relative) because the pre-P5 code kept one running total across all segments while
  streaming sums each population separately and adds the totals — same terms, same order,
  different association. Irrelevant against MC error of ~1e-3, but stated for provenance.
- The fine grid **self-scales with optical thickness**: it starts at ~6,800 optical
  depths and, on meeting a longer path, halves its resolution in place to double the
  range (to ~54,600 at the limit). This is exactness-preserving, because the nesting
  property needs only that the fine width be 10/(24·m) for integer m, and halving maps
  m → m/2 (8 → 4 → 2 → 1). Measured scaling is linear in τ (axis ≈ 12.5·τ worst case), so
  the final range corresponds to τ ≈ 4,000 — far beyond the τ ≤ 100 input clamp. Paths
  beyond the range fold into the final display bin, exactly as the pre-P5 code clipped
  them.
- **Fixed: path-panel titles read "N=NaN"** (user report). Two count call sites in
  `bottomPanel.js` still used `.length` on what are now accumulator objects; `undefined`
  propagates silently through `+`, so the titles rendered NaN while every plotted number
  stayed correct. A static-scan gate now fails the suite if any module reads `.length`
  on a path population.
- New `tests/review-harness/verify_p5.mjs` proves it against a reference implementation
  of the pre-P5 formulas run on the same photons: per-population counts and means, the
  axis max, and all 6 segment views × 24 bins match exactly (worst per-bin difference 0)
  across three regimes — mixed populations, the Uniform-domain zero-path clear-direct
  spike, and τ=100/W=500/Aₛ=1 where individual paths (up to ~10⁴) overflow the fine grid.
  Full golden and Phase 3/4/P4 battery re-verified green.

### Added (2026-07-20, test aid — run timer)

- **Run-time readout in the stats panel**: wall-clock elapsed for the current/last
  ensemble plus the achieved rate (e.g. `Run time: 21.80 s @ 0.92M photons/s [fast
  mode]`), live during normal-mode runs and echoed on the fast-mode counter (the only
  live readout there). Time spent paused is excluded. Added because browser run-to-run
  spread at 20M photons is ~4 s — thermal drift on sustained runs — which is the same
  size as the performance differences being compared, making stopwatch timing unable to
  resolve them. Marked `TEST AID` in the source (`state.runTiming`, three call sites in
  `runControl.js`, `StatsPanel.runTimingLine`) so it can be removed cleanly when no
  longer needed.

### Fixed (2026-07-20, P4 follow-up — small-run visual evolution)

- **Short runs regained their photon-by-photon build-up.** A purely wall-clock slice
  budget is the wrong shape for small runs: at ~0.7M photons/s a 12 ms slice holds
  ~8000 photons, so the default 10k-photon run completed in one or two slices and ~20 ms
  — the browser never got a frame in between and the 200 ms refresh gate never fired, so
  it rendered as a single flash of the final state rather than the progressive
  accumulation v6.0.5 showed. Normal mode now also floors the cadence on photon count:
  each slice is capped at n/40 photons and a heavy refresh is forced every n/40 photons,
  guaranteeing ~40 visible steps regardless of how fast the run is. For large runs both
  photon-based triggers are strictly looser than the wall-clock ones (at 20M they would
  fire every 500k photons versus the time gate's ~140k), so they cost nothing there and
  the v6.0.6 timing is unchanged. Fast mode is unaffected — it has nothing to show.
  New regression gates in `verify_p4.mjs` pin both ends: a 10k run must yield ~40 times,
  and a 20M run must still be governed by the clock (~2400 slices, ~8400 photons each).

## [v6.0.6] — 2026-07-20

Performance patch, resolving review item P4. No physics or statistics changes: slice
sizing and display cadence consume no RNG draws, so every count is bit-identical to
v6.0.5 (proven directly by the new `verify_p4.mjs` Gate 1, plus the full golden and
Phase 3/4 battery). Measured on an M4 laptop (top_side, Aₛ=0.5, Θ₀=60°, τ=10, W=40):
**5M photons 43 s → 9 s**; **20M photons ~3 min → 28.2 s normal, 21.8 s fast (~8×)**.

### Performance (2026-07-20 session, P4 — time-budgeted run loop + fast mode)

- **The instant-batch loop is now time-budgeted instead of chunk-counted.** It ran a
  fixed 1000 photons per `setTimeout(0)` yield, but browsers clamp nested zero-delay
  timers to ~4 ms while 1000 photons need only ~0.5–1.5 ms — so most of a large run's
  wall time was spent waiting on the scheduler, not simulating (measured: a 5M-photon
  run paid ~5,000 × 4 ms ≈ 20 s of dead time against an ~8 s compute floor). Slices are
  now sized by wall clock (12 ms normal, 40 ms fast mode; checked every 256 photons so
  the clock stays off the per-photon path), cutting yields by 1–2 orders of magnitude
  and self-tuning across machines, illumination regimes (photons/s varies ~3×), and run
  sizes. A `MAX_SLICE_PHOTONS = 200000` bound keeps a slice finite even under a
  deliberately coarsened `performance.now()` (Firefox `resistFingerprinting` rounds it
  to 100 ms), so Stop always stays responsive.
- **Normal-mode display now uses a split cadence**: the stats text (the R/T/A/S counts
  and fractions) refreshes every slice — ~80 Hz, two innerHTML writes, no re-binning —
  while the heavy work (3D histogram rebuild + bottom-panel redraw) is wall-clock gated
  at `REFRESH_HEAVY_MIN_MS = 200` rather than every 10th chunk. Those rebuilds re-bin
  the full accumulated history, so a fixed chunk cadence made the live-run feel degrade
  as a run got longer, while a single coarse gate made the progression too choppy to
  watch; the split gives smoother number progression than the pre-P4 cadence while
  keeping the expensive redraws bounded. (Made possible by the P3 text/panel split.)
- **New "Fast mode (large runs)" checkbox**: suppresses all live display for the batch —
  no histogram rebuilds, no bottom-panel redraws, no stats text — showing only a photon
  counter (0.1M resolution) centered in the 3D view, with one full refresh at the end.
  Photon-to-scene work still runs (cap-bounded and cheap), so the finished 3D view is
  correct immediately with no second pass. Pause still works: it pays for one full
  refresh on entry so a paused fast run can be inspected, and restores the counter on
  resume. Read once per batch, like the physics parameters — toggling it mid-run never
  switches modes underneath a run in flight.
- **Endpoint instanced-mesh sync moved off the per-slice path** onto the same gate as
  the heavy refreshes (the O(overshoot) buffer trim still runs every slice, bounding
  memory). The sync rewrites up to `Endpoint caps shown` instance matrices + colors
  (6000 default, 20000 max) and only matters when something is drawn — running it per
  slice meant ~4.7M redundant matrix writes over a 20M fast-mode run, none of them ever
  displayed. Markers now update ~5/s in normal mode (visually identical) and once at the
  end in fast mode.
- **Render loop throttled to ~20 fps during fast mode.** With display suppressed and the
  endpoint sync deferred, the scene is static for the whole run, so full-rate repaints
  were pure competition for the thread running the photon slices (~1500 wasted frames
  over a 25 s run). `controls.update()` still runs every frame, so camera damping and
  drag input are unaffected — only the repaint is decimated.
- **Photon-count cap raised 10M → 100M.** Memory (the P5 O(N) path arrays), not wall
  time, is now the binding constraint at the top of that range.
- Presentation-only: slice sizing and display cadence consume no RNG draws and change
  no counts. New `tests/review-harness/verify_p4.mjs` proves it directly — 200k photons
  run as one loop vs. fixed 1000-photon chunks vs. wildly varied slices give
  bit-identical values for all 26 accumulators — plus control-flow gates (exact photon
  totals, termination, frozen-clock bound, Step semantics). Full golden + Phase 3/4
  battery re-verified green.

## [v6.0.5] — 2026-07-19

Patch release assembled from the 2026-07-19 full code/physics review of the
post-Phase-3/4 state (all items below accumulated under `[Unreleased]` during that
review's fix sessions). Headline: the N2 **ground-domain redesign** (a physics/
bookkeeping change for open-boundary Uniform-domain runs at Θ₀ > 0; export schema 1.4)
and the N1 **plane-parallel-limit tunneling fix** (M = 1 periodic). Full golden-snapshot
and gate-suite regression (legacy, UD open, UD periodic, Phase 3/4 gates — including
new analytic launch-fraction gates) verified green after every item.

### Changed (2026-07-19 review session, N2 — open-boundary launch window: shift, not extend)

- **The Uniform-domain open-boundary launch window is now a pure upwind SHIFT of the
  cloud-centered M·W×M·W accounting domain** by the full ballistic throw
  s = (τ_cloud + β_ext·d_sfc)·tanΘ₀, replacing the previous sunward EXTENSION (which
  widened the window to area (M·W+s)·M·W while every normalization still assumed
  (M·W)²). Consequences of the old design: f_c = 1/M² overstated the cloud's true
  window share by s/(M·W) (16.2% at defaults M=4, Θ₀=60°), biasing every f_c-scaled
  quantity, and the ground footprint/heatmap/surface plane were asymmetric (cloud
  shadow centered, cloud vertical projection off-center). Under the shift, window
  area = domain area, so **f_c = 1/M² and the domain-mean normalizations are exact by
  construction**, and every unscattered direct landing tiles the ground domain exactly.
  The single condition M ≥ M_min = 1 + 2s/W (formula unchanged; UI auto-clamp retained)
  now provably guarantees full cloud-top lighting, sunward-wall reservoir capture, and
  complete shadow containment at once. Removed with the redesign: the leeward
  grid-extension/offset machinery (`SimStats.surfaceFootMarginX`, `world.domainMarginX`,
  heatmap `offsetX`) — the rendered domain, ground plane, and heatmaps are again
  symmetric and centered on the cloud. Periodic boundary untouched (wraparound needs no
  shift; goldens bit-identical). Θ₀ = 0 open-boundary results bit-identical (s = 0).
  Export schema 1.3 → **1.4**: additive `inputs.launch_window_shift` (open UD only);
  open-boundary Θ₀>0 uniform-domain results are not numerically comparable across this
  change. UD golden regenerated (18 Θ₀=60 rows; 18 Θ₀=0 rows verified bit-identical);
  `verify_phase3.mjs` Gate 6 reworked to closed-form launch-fraction checks
  (P(top) = f_c, P(wall) = f_c·(τ/W)·tanΘ₀, window-preimage containment) — all green.
  Follow-up (browser-verification feedback): `getMinDomainFactor()` now returns M_min
  rounded UP to 2 decimals (ceiling preserves the M ≥ M_min guarantee), so the
  auto-clamp writes a clean 2-decimal value into the M input and the displayed M,
  effective M, and f_c agree exactly. Under periodic boundary the same inline box now
  shows a muted, transient (6 s) informational note ("any M ≥ 1 valid — no M_min
  restriction; M = 1 is the plane-parallel limit"), and only when the typed M is below
  the open-boundary M_min — exactly when a user might wonder why no warning fired —
  making the deliberate open-vs-periodic M_min asymmetry self-documenting without
  being chatty.

### Performance (2026-07-19 review session, P3)

- **Animation stepping no longer redraws the bottom panel per path vertex.** The
  animated-photon loop called `StatsPanel.updateDisplay()` on every animation frame
  (~55 fps) purely to advance the "Active photon: step i/j" line — and `updateDisplay()`
  unconditionally redraws the bottom panel (a 19×72 BDF-grid recompute + polar canvas
  repaint, or the μ/path canvas re-render) on each call. New
  `StatsPanel.updateStatsText()` rebuilds only the two stats-panel text blocks;
  `updateDisplay()` is now panel-redraw + text (unchanged semantics for every other
  caller). The animation loop's three in-flight call sites use the text-only variant;
  the panel still refreshes at every chunk boundary, animation finish, and explicit
  refresh — nothing the plots display can change mid-photon, since each photon is
  recorded before its animation begins. Verified via DOM-stub test (text-only call
  fires zero panel redraws; full call exactly one); gates green.

### Fixed (2026-07-19 review session, N3 — periodic display wrap now covers y)

- The periodic-boundary canonical-tile wrap for the surface-absorption heatmap binning
  and the surface-landing endpoint markers applied to **x only** (justified by
  "dir.y = 0 always" — true only for the unscattered direct beam). Scattered side exits
  and Lambertian surface bounces carry dir.y ≠ 0, and their periodic landings stray in y
  exactly as in x (measured: 1.7% of surface landings at M=2, Θ₀=60°, Aₛ=0.8, reaching
  ~6 tiles out) — those were clamped to the heatmap's y-edge cells and drawn as stranded
  markers. `wrapPeriodicX` → `wrapPeriodic` (one helper for both axes; the tile is
  square), applied to y in `_addSurfaceFootprint` and `Photons.addEndpoint`. The physics
  wrap (`wrapAndFindBoxEntry`) always handled y correctly — this is display/binning
  only; no RNG, count, or golden impact (all verified green).

### Performance (2026-07-19 review session, P1)

- **Surface-interaction event markers converted to one persistent InstancedMesh** — the
  last un-instanced marker system. `Scene.addSurfaceInteractionMarkers()` previously
  built up to 1,200 individual Mesh+SphereGeometry+MeshStandardMaterial triples into
  `histogramGroup` on EVERY heavy refresh and disposed them on the next (~120k transient
  GPU-visible objects over a 1M-photon Aₛ>0 run, plus 1,200 persistent draw calls
  whenever shown). Now a single fixed-capacity (SURFACE_EVENT_CAP, exported from
  simstats.js) InstancedMesh with per-instance color (purple reflected / brown absorbed)
  and per-instance scale for the two radii — one draw call, zero per-refresh allocation
  churn. Follows every hard-won decision from the endpoint-mesh work verbatim: stable
  identity across syncs, `frustumCulled=false` with no bounding-sphere recomputes,
  `depthWrite=false`, explicit `renderOrder=1` (markers tier); lives in
  `heatmapMeshGroup` and clears only on genuine scene reset. Material change:
  MeshStandardMaterial(emissiveIntensity 1.1) → unlit MeshBasicMaterial at the same
  0.75 opacity — visually near-identical since the old look was emissive-dominated.
  Display-only; all gates + goldens verified green.

### Performance (2026-07-19 review session, P2)

- **Removed per-photon DOM reads from the endpoint hot path.** `Photons.addEndpoint()`
  (once per photon in the instant-batch loop) read `UI.getPhotonEntryMode()` +
  `UI.getDomainBoundary()` per photon — two `getElementById` calls + string compares,
  ~2×10⁷ DOM hits in a 10⁷-photon run, the same per-photon DOM-read class the R4 hoist
  removed from `runInstantBatch`. Now uses the per-run cached
  `SimStats._surfFootPeriodicWrap` (identical uniform_domain-AND-periodic condition,
  refreshed in `SimStats.reset()`; freshness guaranteed because both the illumination
  and domain-boundary selectors reset the scene on change). Display-only — no RNG,
  physics, or golden impact (all gates + goldens verified green).

### Fixed (2026-07-19 review session — periodic-boundary plane-parallel limit)

- **Cloud-box tunneling at M = 1 periodic (physics bug, high severity).** At M = 1 the
  domain tile edge coincides with the cloud wall, so every periodic wrap landed a photon
  exactly ON the opposite wall — where `rayBoxEntry`'s `tEnter > 1e-12` guard (which
  correctly prevents a photon from re-detecting the box it just exited) rejected the
  genuine re-entry. The wrap loop then treated the cloud interior as clear air:
  side-wall exits tunneled unextinguished through the box. Verified pre-fix (Θ₀=0,
  Aₛ=0, τ=10, N=300k): 10.3% terminal side escapes in a configuration where zero are
  geometrically possible; R_domain 0.392 sitting *below* the finite W=500 proxy (0.419)
  when the plane-parallel limit requires it above; mean scatterings 20.0 → 15.7.
  **Fix**: additive `minT` parameter on `rayBoxEntry` (default 1e-12 preserves every
  existing call site), relaxed to −1e-9 by the wrap loop on post-wrap iterations only —
  a wrapped point moving inward is a genuine entry even at tEnter = 0. Post-fix:
  terminal side escapes **exactly 0**; R_domain = 0.4231 vs 0.4232 for an open-top
  W=2000 plane-parallel proxy (agreement to 1×10⁻⁴); mean scatterings restored.
  M = 1 periodic — true plane-parallel RT, the cleanest validation limit the periodic
  feature has — now anchors two new permanent gates (verify_phase3 Gates 8–9:
  `side === 0` exact, and R_domain within 0.01 of the W=2000 proxy plus strictly above
  the W=500 one). `golden_periodic_v6.0-phase3.json` regenerated: all 12 M=1 rows
  corrected (e.g. side 51,019 → 0; R 0.3911 → 0.4236), all 24 M=2/4 rows verified
  **bit-identical** pre/post (wrapped points there sit (M−1)·W/2 from the wall, so the
  relaxed floor never engages); legacy/UD/open-boundary goldens all exact (default
  `minT` untouched on every non-wrap path).
- **Golden checkers made Node/V8-version-robust** (found during the fix's cross-machine
  verification): the four longest-trajectory periodic rows (Θ₀=60°, Aₛ=1, M=1/4 —
  ~10⁹⁺ transcendental calls each) sample last-ulp `Math.*` differences between Node
  versions, wobbling `totalPath`/`meanPath` at ~2×10⁻¹⁶ relative while **every count in
  every row stays bit-identical** (trajectories identical; only the real-valued path sum
  differs at machine epsilon). New shared `tests/golden-snapshots/compare_golden.mjs`:
  counts and all other fields compared exactly, `totalPath`/`meanPath` to 1e-9 relative
  — one committed snapshot now verifies on every platform/Node version, and any genuine
  physics change still fails the exact tier. Wired into `check_golden_ud`,
  `check_golden_periodic`, and `diff_golden`; new `diff_golden_rows.mjs` field-level
  diff tool (prints magnitudes, not just row indices) added to `tests/review-harness/`.

## [v6.0.4] — 2026-07-18

### Fixed (UI/rendering tweaks)

- **Export-button stacking breakpoint replaced with a real collision check (user report):**
  `#exportButtons` used a fixed `@media (max-width: 1700px)` rule to stack its 3 download
  buttons vertically once they'd otherwise collide with `#legend` -- hand-picked against
  the legend's OLD, narrower footprint. This session's legend relayout widened it, and the
  user correctly diagnosed the result: narrowing the browser window no longer stacked the
  buttons until the legend was already overlapping the JSON button, well past where the old
  1700px threshold assumed the collision would start. Rather than re-tuning the same magic
  number against the new width (which would just go stale again the next time the legend's
  content changes), replaced it with `RunControl.updateExportButtonsLayout()`
  (`runControl.js`), called at the end of `applyUiScale()` (so it re-runs on every resize
  and at init): it measures the REAL rendered gap between `#exportButtons` and `#legend` via
  `getBoundingClientRect()` -- which also correctly accounts for `--ui-scale`'s
  `transform: scale()`, unlike a viewport-width media query -- and toggles a `.stacked`
  class only when the two would actually be closer than 24px apart. No physics/stats
  impact; not covered by the golden/gate suite (pure DOM layout), but the suite was
  re-run anyway to confirm the unrelated `runControl.js` edit didn't disturb the
  simulation loop -- still exact-match.
- **Footprint labels standardized to "2D" (user request, for labeling consistency):**
  "surface-absorbed footprint" -> "surface-absorbed 2D footprint" and "downward
  cloud-base crossings footprint" -> "downward cloud-base crossings 2D footprint," in
  both `index.html` and `exportUtils.js`'s `LEGEND_LAYOUT`. The third footprint entry
  already read "reflected 2-D top footprint" (hyphenated) -- flagged the mismatch and,
  per the user's choice, dropped the hyphen there too so all three footprint entries now
  share the identical "2D" spelling. Text-only change; full golden/gate regression suite
  re-verified exact-match.
- **Legend titles/entries forced to a single line, box widens instead of wrapping (user
  follow-up):** "Intermediate events (can recur, photon continues)" was wrapping to 2
  lines on-screen, and long entries like "Incident surface-absorbed" risked the same,
  because #legend's `max-width: 760px` could compress a flex/grid item below its natural
  content width. Removed the cap and added `white-space: nowrap` on `#legend` (inherited by
  every title and entry) -- the box now grows to fit its content instead of a fixed width
  forcing a wrap, per user request. On the canvas side, `measureLegendGeometry()` in
  `exportUtils.js` previously sized each block from its item labels only, never checking
  whether a block's OWN section title was wider than its items -- harmless by luck so far,
  but canvas text never auto-wraps (unlike CSS), so a wide-enough title would have silently
  overrun into whatever sat next to it with no warning. Now measures each title in its
  actual bold 15px font and widens the block (`intermediateBlockW`, `animationBlockW`,
  `terminalRowW`) to fit if the title is the wider of the two, closing off that latent
  overflow case before it could ever surface. Full golden/gate regression suite
  re-verified exact-match.
- **Legend box relayout to condense vertical footprint (user request, iterated via a
  shared PPT mockup):** the legend was one flat, tall column-pair stack (16 entries + 2
  headers, 11 effective rows). Restructured into three purpose-built blocks instead: (1)
  Intermediate events -- single stacked column, 3 items; (2) Animation photon paths -- a
  new section (previously the 6 path-line entries had no header at all) sitting BESIDE
  Intermediate events in a shared top row rather than stacked below it, 2-column grid, and
  with "photon paths" dropped from each label (e.g. "Reflected photon paths" ->
  "Reflected") since it's redundant with the section title -- Terminal entries keep their
  fuller wording since they stand alone; (3) Terminal events -- 3 INDEPENDENTLY-stacked
  columns of uneven height (3/2/2 items), each pairing a terminal dot with its own
  footprint square where one exists (e.g. "reflected" + "reflected 2-D top footprint"
  share a column), rather than a plain row-major fill. `index.html`'s `#legend` moved from
  a single CSS Grid to a flex column of purpose-built sub-containers
  (`.legendIntermediate`, `.legendAnimationGrid`, `.legendTerminalCols` > `.legendCol`) --
  a plain grid can't express uneven column heights, but independent flex-column stacks
  support any item count per column with no extra layout math.
  `exportUtils.js` mirrors the same structure: the old flat `LEGEND_ENTRIES` array +
  generic row-major `buildLegendLayout()` are replaced by an explicit `LEGEND_LAYOUT`
  (blocks/columns spelled out directly) and `measureLegendGeometry()`, which still uses
  real `ctx.measureText()` per independent column (not a hand-guessed width) and adds a
  manual rounded-rect path (`tracePath()`, arcTo-based) so the exported PNG's legend box
  now has the same 12px rounded corners as the on-screen box, which it previously lacked.
  Net effect: legend box height in the mock geometry check drops from ~372px to ~258px
  (~31% shorter) for equivalent content. No physics/stats impact -- full golden/gate
  regression suite (`gen_golden`, `check_golden_ud`, `check_golden_periodic`,
  `verify_phase3`, `verify_phase4`) re-verified exact-match after the rewrite.
- **"Surface-absorbed photon paths" legend label clarified to "Incident surface-absorbed
  photon paths" (user follow-up):** the brown path-line legend entry was ambiguous about
  when it's actually reachable. At Aₛ=0, legacy illumination modes (center/top/top_side)
  never produce a brown path — every surface landing there goes through physics.js's
  dedicated cloud-base "fast path" and returns `Status.TRANSMITTED` (green), since the
  reflection draw could never succeed anyway (verified: 0% `SURFACE_ABSORBED` across four
  legacy-mode/Θ₀ configurations, 20,000 photons each). The only route that calls
  `surfaceInteraction()` unconditionally regardless of Aₛ is Uniform Domain's clear-direct
  launch — a photon launched outside the cloud's own footprint, missing it entirely, landing
  directly on open ground (verified: 17,439 `SURFACE_ABSORBED` vs. 846 `TRANSMITTED` under
  UD/open/Θ₀=60°/Aₛ=0). So the brown path is specifically the *incident*-on-open-ground case,
  not a general "reached the surface" case — relabeled in both `index.html` and
  `exportUtils.js`'s `LEGEND_ENTRIES` to say so. Text-only change; full golden/gate
  regression suite re-verified exact-match.
- **Domain-factor auto-clamp not reflected in rendering:** `scene.js`'s `updateWorld()`
  (rendered ground plane) and `simstats.js`'s `surfaceFootFactor()` (surface-absorption
  heatmap grid) both sized themselves off the raw, typed `UI.getDomainFactor()` instead of
  `UI.getEffectiveDomainFactor()` — the auto-clamped M that `RunControl.getSimParams()`
  actually simulates with whenever Θ₀>0 (open boundary) needs a wider sunward margin than
  the typed M provides. Invisible at Θ₀=0 (M_min=1, so the two agree) but increasingly
  wrong as Θ₀ grows, clipping the true M·W ground illumination in both the 3D plane and the
  heatmap. Both now use the effective factor.
- **Surface-absorption heatmap checkbox inert at Aₛ=0 for legacy illumination modes:**
  `Scene.rebuildHistograms()`'s render gate (`Aₛ>0 || uniform_domain`) left the checkbox
  checked-but-silently-showing-nothing for center/top/top_side at Aₛ=0, even though
  `SimStats._addSurfaceFootprint()` is populated unconditionally in every mode (a black
  surface still genuinely absorbs 100% of what reaches it — the same reasoning already
  applied to uniform_domain in the earlier P6 fix, just never extended to legacy modes).
  Gate removed; the checkbox now works for every illumination mode.
- **Surface heatmap/ground plane don't cover the true leeward ground footprint at Θ₀>0,
  open boundary (rendering-only fix, no physics.js change):** the sunward-illumination fix
  extends the *launch* window's sunward edge by `margin = (τ_cloud + β_ext·d_sfc)·tanΘ₀` so
  the ground gets full coverage on that edge, but every photon then drifts by this same
  margin before reaching the true surface — so the actual ground footprint is
  `[-M·halfW, +M·halfW + margin]`, flush on the sunward side and overshooting by `margin`
  on the leeward side. The rendered surface plane and the heatmap grid were both still
  sized symmetrically at `±M·halfW`, leaving genuine surface-absorbed landings (visible as
  endpoint markers) stranded outside the drawn box/grid. Both are now widened and shifted
  on the leeward side by the same margin (`UI.getSunwardMargin()`, factored out of
  `getMinDomainFactor()` for reuse). Periodic boundary needed a different fix: its own,
  smaller residual overshoot comes from the sub-cloud clear-air gap only (not itself
  subject to the periodic wraparound, which covers just the cloud-image τ range) — the
  landing x is instead wrapped modulo the domain width into its canonical-tile equivalent
  before binning, which by periodicity is exactly correct rather than an approximation.
  Verified by direct simulation at the reported settings (UD, M=3, Θ₀=60°, τ=10, W=40,
  β_ext=10, d_sfc=0.5): 20.5% of open-boundary surface-absorbed landings and 8.7% of
  periodic landings fell outside the old symmetric grid; 0% fall outside after the fix.
- **Periodic surface-absorbed endpoint markers not wrapped (follow-up, same session):** the
  fix above wrapped the heatmap's own per-cell binning (`SimStats._addSurfaceFootprint`),
  but the per-photon endpoint marker (`Photons.addEndpoint`) still placed its dot at the
  raw, unwrapped `xExit`, so individual markers still landed past the leeward edge even
  after the grid itself was corrected (user report, follow-up screenshot). Factored the
  wrap into a shared `SimStats.wrapPeriodicX()`, using the TRUE simulated tile half-width
  (`_periodicWrapHalfW`, cached from the effective M) rather than the heatmap's own
  display-clamped extent, and applied it to both the heatmap bin and the
  TRANSMITTED/SURFACE_ABSORBED endpoint marker positions. Verified: 8.2% of surface-landing
  endpoints fell outside the tile before, 0% after. (Also investigated a visually "empty"
  band the user flagged in the open-boundary heatmap: direct inspection of the accumulated
  grid's column sums shows a smooth density gradient with no true zero-count band — a
  soft-edged cloud shadow, physically expected at COT=10 with forward-peaked g=0.85
  scattering, not a rendering artifact.)
- **Surface-heatmap outline frame not shifted with the widened grid (follow-up, same
  session):** `Scene.addFootprintHeatmap()` draws its own outline frame around each
  heatmap's cells (colored per-heatmap — `0xc8a27a`, tan/gold, for `surfAbs`), separate
  from the ground-plane edge in `Scene.buildCloudBox()`. The `offsetX` shift added for the
  open-boundary widening was applied to the per-cell positions but missed this frame, so it
  stayed drawn at the old symmetric bounds while the cells themselves were correctly
  widened and shifted — visually detaching the frame from the actual cell coverage on both
  edges (user report: the frame appeared offset from the heatmap on both the sunward and
  leeward zoom). Frame corner points now use the same `offsetX`; since its width/offset
  formulas reduce to exactly the ground plane's, the two now coincide for any M within the
  normal display-clamp range.
- **UD sub-menu labels not visually distinguished:** "Domain factor M" and "Domain
  boundary" labels now render in the same yellow (`#f7f44a`) as the Reset button when
  Illumination = Uniform domain (the only time they're shown at all).
- **Periodic-boundary SIDE_ESCAPE endpoint marker rendered at cloud-top height instead of
  the cloud's own side wall (small, deliberate physics.js addition — see below):** under
  Uniform domain + periodic boundary, `wrapAndFindBoxEntry`'s only terminal SIDE_ESCAPE
  outcome is an upward ray genuinely clearing τ=0 (cloud-top height) after exhausting every
  neighboring-tile re-entry attempt — correct for the R/T/A/S bucket, but `xExit/yExit/
  tauExit` reports that wrapped τ=0 clearance point, not a location on any cloud wall, so
  the marker visually read as a top-face escape rather than a side escape (user report,
  2026-07). A first attempt repositioned the marker to `result.path`'s last vertex, which is
  correct in principle (physics.js already computes the true wall-crossing point, `xb,yb,
  taub`, before the periodic wrap search runs) but broke for the vast majority of photons in
  a real run: `runControl.js` only passes `storePath=true` for the first ~`maxPaths`
  (default 250) photons — a pre-existing performance cap — so `path` never accumulates past
  its single launch-point element for everything beyond that, and the fix silently fell back
  to plotting the launch position instead (a differently-distributed but still-scattered
  field at ~cloud-top height, which is why it looked like the artifact had just moved sides
  rather than being fixed). Root-caused via direct simulation with `storePath=false` — the
  actual condition ~99% of photons in a typical run experience — reproducing the exact
  visual symptom before touching any code.
  Fixed properly with a minimal, deliberately scoped physics.js addition: `lastWallCrossing`,
  a single `{x,y,tau}` object overwritten (not appended) at every cloud-side-wall crossing,
  populated unconditionally regardless of `storePath` (O(1) per photon — no array growth, no
  RNG draws, not read by any SimStats accumulation, so no golden-snapshot or gate-suite
  impact — confirmed exact-match on the full regression suite after the change). Falls back
  to the wrapped τ=0 point on the rare periodic SIDE_ESCAPE that never touched a cloud wall
  at all (a surface-reflection-driven escape, Aₛ>0, launched directly into the clear region)
  — an honest description of that specific event. Verified directly: with `storePath=false`,
  100% of 327 sampled periodic side-escapes landed exactly on a cloud wall face (|x| or |y|
  = halfW) at genuine mid-depth τ (previously 100% at τ≈0).
- **SIDE_ESCAPE rendering conflated two physically distinct events (follow-up, same
  session):** verifying the fix above at Aₛ≠0 (not previously tested in this thread) surfaced
  a separate, pre-existing issue — not a regression, confirmed by diffing today's physics.js
  changes against the prior commit — affecting every illumination mode and both domain
  boundaries. `Status.SIDE_ESCAPE` covers two different terminal events that physics.js
  already tags separately (`result.bypass`; `simstats.js` has kept these in separate
  R/T/A/S buckets and separate path-length pools, `sideEscapeUpPaths` vs. `bypassPaths`,
  since the Aₛ>0 feature was added): a genuine cloud-side-wall crossing (bounded to the
  cloud's own wall) vs. a surface-reflected photon that ascends without ever touching a
  cloud face again (`bypass: true`). Because the modeled surface is infinite and the
  Lambertian reflection angle can be arbitrarily close to grazing, the latter's landing
  position is effectively unbounded — measured directly (Aₛ=0.3, same test geometry): legacy
  top-face launch mode alone produced bypass escapes with x ranging from −1387 to +36865.
  The rendering layer (and the on-screen/export legends) never read `bypass`, coloring and
  labeling both "side boundary escape" identically — nonsensical once Aₛ>0 makes the bypass
  population visible (orange dots scattered across a huge area at a fixed height, nowhere
  near any cloud side; user report, 2026-07). `UI.getOutcomeColor()` now takes an optional
  `bypass` argument and returns a distinct pink (`#f9a8d4` — lightened from an initial `#f472b6`
  per user follow-up: too close to the orange `#f97316` genuine-side-escape color to
  distinguish on their monitor) for bypass events; `photons.js`'s
  `addEndpoint()`/`addStaticPath()` and both the on-screen (`index.html`) and export-canvas
  (`exportUtils.js` — a separate hardcoded legend array, previously missed by an earlier
  legend fix for the same reason) legends now carry a distinct "Surface-reflected escape (no
  cloud face)" entry alongside "Side boundary escape." Also closed a related gap the review
  surfaced: the periodic wall-crossing repositioning fix above did not originally exclude
  bypass events, so a photon that touched a cloud wall earlier in its trajectory and only
  later reflected off the surface and escaped could have had its marker misplaced at that
  stale, unrelated crossing point; `useWallCrossing` now requires `!result.bypass`. Verified
  directly: of 1942 sampled periodic bypass escapes, 73 did carry a stale `lastWallCrossing`
  from earlier in their trajectory, and 100% correctly used their true exit position instead;
  all 190 sampled genuine periodic side-escapes still land exactly on a wall face, colored
  orange. Full golden/gate regression suite re-verified exact-match after this fix too.
- **Lightened bypass-escape color (follow-up):** `#f472b6` was too close to the genuine
  side-escape orange (`#f97316`) to distinguish at a glance; changed to a lighter
  `#f9a8d4` across `ui.js`, `photons.js`, both legends, and the CHANGELOG entry above.
- **On-screen legend reorganized into Intermediate/Terminal event sections (user request):**
  clarifying which dot markers end a photon's simulated path (blue reflected, orange side
  escape, pink bypass escape, brown surface-absorbed, black cloud-absorbed — each drawn
  exactly once, via `Photons.addEndpoint()`, always the last thing recorded for that photon)
  versus which are non-terminal events that can recur any number of times while the photon
  keeps going (green downward base-crossings, purple surface-reflection bounces). Added a
  `.legendHeader` CSS class (spans both grid columns) and two header rows to `index.html`'s
  `#legend`; the export-canvas legend (`exportUtils.js`) was left in its existing flat order
  for now, pending discussion — its fixed 2-column layout splits entries strictly by index
  (`col = idx < rows ? 0 : 1`), so inserting full-width header rows there needs real
  restructuring, not just new entries.
- **Fixed a stale `LEGEND_ROWS` mismatch in the export-canvas legend (caught during the
  reorg above):** `LEGEND_ROWS` (used only to size `LEGEND_BOX_H`, the background
  rectangle) was left at `8` when the bypass-escape path/dot entries were added earlier this
  session, growing `entries.length` from 16 to 18 without updating this hand-maintained
  constant — exactly the class of bug its own comment already warned about. With 18 entries
  needing `Math.ceil(18/2)=9` rows, the box was one row too short, so the last legend row
  ("Scattering flash" / "Surface absorbed endpoints") would have drawn below the background
  box's bottom edge in exported PNGs. Corrected to `9`.
- **Trimmed 3 self-evident on-screen legend entries (user request):** "glowing photon head /
  active trail," "scattering-event flash," and "last scatter marker while paused" removed
  from `index.html`'s `#legend` — all three are only visible during live photon animation,
  where they're self-explanatory to a user watching it happen, so the legend entries were
  redundant screen real estate. `index.html`'s `#legend` now has 16 entries (was 19); the
  export-canvas legend (`exportUtils.js`) is untouched by this — it never carried the
  screen-only "last scatter marker while paused" entry to begin with, and still lists
  "Photon tracer" / "Scattering flash" pending a decision on whether those two make sense to
  keep for a static PNG export.
- **Export-canvas legend now matches the on-screen legend exactly (user request):** same 16
  entries, same "Intermediate events" / "Terminal events" section headers, same order,
  including "Photon tracer" and "Scattering flash" now dropped there too (consistent with the
  trim above). Rewrote `exportUtils.js`'s legend around a shared `LEGEND_ENTRIES` array and a
  new `buildLegendLayout()` that replicates the on-screen CSS grid's actual row-major,
  2-column flow (`grid-template-columns: auto auto`) — entries fill left-to-right then wrap,
  and a `{header}` entry forces a full-width row, closing out any dangling single-item row
  first — rather than the old fixed 2-column split (first half of the array in column 0,
  second half in column 1), which had no way to represent header rows at all. Box height is
  now derived from the layout's actual row count (`legendBoxHeight()`) instead of a
  hand-maintained `LEGEND_ROWS` constant, permanently closing the "forgot to update the row
  count" bug class this file has been bitten by twice this session (once causing the
  right-edge-clipping fix, and again for the just-fixed stale-height bug above). Verified the
  layout algorithm directly: 16 entries + 2 headers, 11 total rows, zero (row,col) collisions,
  and the one dangling single-item row ("Surface reflected event") correctly does not bleed
  into the following header's row — matching the on-screen grid's actual behavior.
- **"Surface absorbed endpoint" recolored from `#7c2d12` to `#c8a27a` (user report: it read as
  red, not brown):** changed in `photons.js`'s `addEndpoint()` for both branches that produce
  it — the `SURFACE_ABSORBED` terminal status and the A_s=0 fast-path `TRANSMITTED` branch
  (documented as sharing the same color/radius since they're the same physical event reached
  two different ways) — now matching "Surface-absorbed footprint"'s color exactly, per the
  user's specific request for consistency between those two markers. Deliberately left the
  PATH LINE color unchanged (`ui.js`'s `getOutcomeColor()`, "Surface-absorbed photon paths" in
  both legends, still `#7c2d12`) since the user's report was specifically about the endpoint
  dot, not the path line — the path and its own terminal dot now render in two different
  browns. Both legends' swatches updated to `#c8a27a` to match. No physics/stats impact
  (purely a Three.js material color); full golden/gate regression suite re-verified
  exact-match.
- **Moved "downward cloud-base crossings footprint" into the Intermediate events section
  (user follow-up):** this footprint accumulates the same non-terminal, can-recur downward
  base-crossing population as the green dot right above it, unlike "reflected 2-D top
  footprint" and "surface-absorbed footprint," which accumulate terminal-event populations —
  moved in both `index.html` and the now-matching export-canvas legend so footprints sit next
  to the dot/event type they actually visualize.
- **Surface-absorbed brown fully unified to `#8a6f53` (user follow-up, user-picked color):**
  the previous fix left the path-line color at `#7c2d12` and only recolored the endpoint dot
  to `#c8a27a` (matching the footprint); the user then asked for full consistency across all
  three. All three — `ui.js`'s `getOutcomeColor()` (path line / "Surface-absorbed photon
  paths" in both legends), `photons.js`'s `addEndpoint()` (both branches producing the
  endpoint dot), and `scene.js`'s `surfAbs` heatmap (which also drives its outline frame,
  same color parameter) — now render `#8a6f53`. No physics/stats impact; full golden/gate
  regression suite re-verified exact-match.
- **Export-canvas legend box sizing switched from a hand-guessed width to real
  `ctx.measureText()` (user report: exported PNG showed a visibly asymmetric, unused margin
  on the right side of the legend box):** the previous `LEGEND_COL_W=560` was a deliberately
  generous fixed guess (~14px/character), sized once against the single longest label known
  at the time — safe against clipping, but far more generous than most labels actually need,
  which is exactly why the box looked loose/unbalanced once shorter labels landed in the
  right column. Replaced with `measureLegendColumnWidths()`, which uses the real browser
  canvas context's `ctx.measureText()` (available at actual runtime even though this
  sandbox's Node environment lacks a headless canvas to test it directly) to size each
  column independently to its own actual widest label — matching how a CSS grid with `auto`
  columns already behaves on-screen. `legendBoxSize()` is now the single shared source for
  both width and height across `drawExportLegend()` and `drawExportLegendBottomCentered()`,
  so the two can't drift apart the way the old fixed constants already had (twice this
  session). Sanity-checked the layout algorithm with a mocked measureText (~10.5px/char):
  produced independently-sized columns (472 / 535 in the mock) and a narrower total box
  (1027 vs. the old fixed 1140) — real browser metrics will differ slightly, but the
  algorithm self-corrects to whatever they actually are rather than needing another manual
  re-guess.

### Refactored

- **R3 (stats-panel/accumulation split):** moved all DOM/presentation code out of
  `simstats.js` into a new `js/statsPanel.js`. `updateDisplay()`, `buildDomainBlockText()`,
  and `buildComponentBreakdownText()` — along with the BottomPanel draw-callback wiring
  (`setDrawPanelCallback`/`_drawPanelCallback`) — now live in `StatsPanel`; `simstats.js`
  keeps only the `stats` accumulator, bin arrays, `reset()`/`record()`/`register*()`, and
  the pure combiner functions (`rComponents`, `tComponents`, `reflectedMuBins`, etc.), with
  zero remaining `document.*` references. `main.js`, `runControl.js`, `photons.js`, and
  `index.html`'s inline `onchange`/`onblur` handlers now call `StatsPanel.updateDisplay()`
  instead of `SimStats.updateDisplay()`; `window.StatsPanel` is exposed alongside
  `window.SimStats`. Pure code-organization move — no change to RNG draws, physics, or
  accumulated statistics. Verified bit-identical: legacy/UD/periodic golden snapshots and
  the Phase 3 + Phase 4 gate suites all pass exact-match, unchanged from pre-refactor.

## [v6.0.3] — 2026-07-14

### Fixed (sunward ground-illumination asymmetry under Uniform domain, open boundary, user report)

- User report: at open-boundary uniform_domain illumination, COT=10, Θ₀=60°, M=2, almost
  no surface-absorption events landed on the sunward side of the cloud, though both
  lateral sides were well populated, and periodic boundary at the same settings showed no
  such asymmetry. A COT=1 vs. COT=10 comparison at the same Θ₀/M (user's own diagnostic
  run) showed the asymmetry present at COT=10 but absent at COT=1, correctly narrowing
  the cause to something scaling with τ_cloud itself.
- Root cause: `world.slabH = world.tauCloud` (a rendering convention: 1 τ maps to 1 world
  unit vertically) combines with `sampleEntryPoint`'s fixed τ=0 "cloud-top = TOA" launch
  reference so that a photon which never touches the cloud still falls the full
  `τ_cloud + β_ext·surfaceDistanceKm` optical depth before reaching the ground, drifting
  `(τ_cloud + β_ext·surfaceDistanceKm)·tanΘ₀` downwind in the process. Because this throw
  scales with τ_cloud, a thicker cloud silently increases it for every launched photon —
  even ones nowhere near the cloud — against the fixed M·W sampling domain, so the
  domain's sunward edge progressively loses ground coverage as τ_cloud grows. Verified
  quantitatively: the closed-form prediction for the minimum reachable sunward landing
  position matched observed values to 2 decimal places across τ_cloud ∈
  {0.001, 2, 5, 10, 20}; at the user's exact reported settings the true sunward margin
  (2.6 km) exceeded the available buffer (2.0 km) by 0.6 km, reproducing the reported
  gap.
- Periodic boundary needed no change — confirmed by reading
  `Physics.wrapAndFindBoxEntry`, not just by re-checking the empirical report: the
  τ_cloud-scaling part of the throw is already absorbed exactly by wraparound (a
  uniformly-shifted uniform distribution, wrapped modulo the domain width, is itself
  exactly uniform — no edge to lose coverage against).
- Fix (`js/physics.js`, `sampleEntryPoint`'s `uniform_domain` branch): the τ=0
  sampling window's sunward (-x) bound is now *extended* by
  `margin = (tauCloud + betaExt*surfaceDistanceKm) * tan(theta0)`, leaving the leeward
  (+x) bound unchanged at `M*halfW`. Extending (rather than shifting both bounds, an
  alternative design discussed and checked numerically against the user's own worked
  example) avoids retreating the leeward bound into the cloud's own footprint, which
  would silently under-sample the cloud's own leeward-top face for large-margin cases.
  Zero shift applied under periodic boundary (see above). y is unaffected (no lateral
  throw in y in this model's slant geometry).
- `js/ui.js`: `UI.getMinDomainFactor()` corrected to include the previously-missing
  `β_ext·surfaceDistanceKm` surface-gap term (was `1 + 2*(tauCloud/W)*tan(theta0)`, now
  `1 + 2*(tauCloud + betaExt*surfaceDistanceKm)/W * tan(theta0)`) — the old formula
  under-flagged cases where the surface gap contributed a non-trivial share of the true
  margin (e.g. the user's reported case: old M_min=1.87 never fired against M=2, though
  M=2 was already insufficient; corrected M_min=2.30 correctly flags it). New
  `UI.getEffectiveDomainFactor()` auto-clamps M up to the corrected M_min at run time
  (superseding the prior warn-only design for the domain-factor minimum), writes the
  raised value back to the `domainFactor` input, and surfaces a transient note via
  `showLimitWarning()`. `RunControl.getSimParams()` now calls this instead of
  `UI.getDomainFactor()` directly. The live `#domainMarginWarning` banner is kept
  (now informational rather than an alarm, since runs self-correct) and is now also
  recomputed on `cloudBetaExt`/`surfaceDistanceKm` change (`index.html`), since M_min
  depends on them now.
- Scope: only `uniform_domain` + open boundary touched. All three legacy launch modes
  and periodic boundary are provably unaffected (no code path change reaches them).
  Golden regression: `gen_golden.mjs` (legacy) and `check_golden_periodic.mjs` both
  exact-match, unchanged. `check_golden_ud.mjs` (open-boundary uniform_domain) required a
  new baseline — Θ₀=0° rows are byte-identical to the old snapshot (tan(0)=0, zero shift,
  confirming the fix is precisely scoped), Θ₀=60° rows changed at every M/A_s tested.
  Direct re-check of the user's reported case: minimum sunward `xExit` for clear-direct
  surface-absorbed photons now reaches exactly the true domain edge (-40.00, was -14.02).
  Domain-wide budget shift for the same case (A_s=0, all_faces): R_domain 0.1650 → 0.1250,
  T_domain 0.8350 → 0.8750 (expected direction: previously-missing sunward-direct-to-
  ground photons dilute the reflected fraction and raise the transmitted fraction). New
  `golden_ud_v6.0-phase2.json` baseline reviewed and signed off by the user before
  committing. Full derivation and the design alternatives considered/ruled out are in
  `TODO-direct-surface-illumination.md`, "Sunward ground-illumination asymmetry /
  TOA-altitude coupling".
- Follow-up (same session, test-suite and figure sweep): `tests/review-harness/verify_phase4.mjs`'s
  "UD M=1 ≡ legacy top" gate started failing at Θ₀=60° — a real, expected consequence of
  the fix, not a false alarm. The sunward extension in `sampleEntryPoint` is applied
  unconditionally (independent of M), so at M=1 (τ_cloud=10, Θ₀=60°, defaults) roughly 40%
  of launches now fall outside the cloud's own footprint, where previously 0% did —
  meaning the "M=1 reproduces legacy top bit-for-bit at any Θ₀" invariant only ever held
  because the pre-fix code had no sunward-margin mechanism at all. Since Θ₀=60°/M=1 is
  well below the corrected M_min (~2.3) — exactly the regime `getEffectiveDomainFactor()`
  now auto-raises before a real UI-driven run ever reaches `physics.js` — this divergence
  is expected and correct, the same category of correction as the earlier "M=1 reproduces
  top+side" gate fix (see TODO, "core knob: domain factor"). Gate 5 now tests at Θ₀=0
  (margin=0, still holds exactly, unaffected by the fix) with an explanatory comment; all
  13 Phase 4 gates pass. Also regenerated the stale `tests/Illumination comparisons/`
  artifacts that embed open-boundary uniform_domain data at Θ₀=60°: `uniform_domain_M4_As0.5_
  {geomB,open}_theta0=60.json` and the four dependent PNGs
  (`illumination_comparison_UD_M4_As0.5_{geomB,entireDomain}_theta0=60.png` and
  `illumination_comparison_periodic_M4_As0.5_{geomB,entireDomain}_theta0=60.png`, the
  latter since they use the open-boundary export as their "file A"). Θ₀=0° counterparts
  regenerated too and confirmed byte-identical to the pre-fix files (sanity check that the
  fix is precisely scoped). `verify_phase3.mjs` (periodic gates) and all three golden
  suites re-verified passing after every change in this follow-up.

### Fixed (endpoint-marker density/brightness depended on "Endpoint caps shown" slider history, user report)

- `Photons._ensureEndpointMesh()` in `photons.js` only ever grew the endpoint
  InstancedMesh's allocated capacity, never shrank it. Raising the "Endpoint
  caps shown" slider (e.g. to 20000) then lowering it again (e.g. back to
  5000) reused the same oversized 20000-capacity mesh with `mesh.count`
  pulled back down to 5000 -- while `mesh.count` alone should gate the draw
  range, the oversized mesh also carried a frustum-culling bounding sphere
  computed once, lazily, from the larger instance set and never recomputed,
  plus stale high-index instance-buffer data left resident in the GPU
  buffers. Net effect, confirmed via a side-by-side pair of exported PNGs at
  identical parameters/seed: a run held at cap=5000 throughout rendered a
  sparse marker scatter, while the same run's cap cycled 5000 -> 20000 ->
  5000 afterward rendered visibly denser, brighter, more saturated markers
  covering far more of the surface/wall area -- despite both showing the
  same "5000" in the slider and the live stats-panel readout (confirmed by
  the user in real time, ruling out a stale DOM/UI read).
- Fix: `_ensureEndpointMesh()` now reallocates an exactly-sized mesh both on
  growth (previous behavior) and on large shrinkage (new capacity request
  below half the currently allocated capacity), instead of silently reusing
  an oversized buffer. `syncEndpointMesh()` now also calls
  `mesh.computeBoundingSphere()` after every write, so frustum culling
  always reflects the current instance set rather than a stale one from a
  prior, larger/differently-positioned write. The endpoint material also now
  sets `depthWrite: false` (previously defaulted to `true` under
  `transparent: true`) -- standard practice for overlapping semi-transparent
  instanced markers, removing draw-order-dependent occlusion/contrast as a
  contributing factor.
- Scope: rendering-only change in `photons.js`; does not touch `physics.js`
  or `simstats.js`. All three golden regression suites (legacy, uniform-
  domain open, uniform-domain periodic) still pass exact-match, as expected.
- Follow-up (same day): the above did not fully resolve the symptom. Four
  further exports of the identical completed run at cap=5000/6000/7500/16000
  (slider only ever raised, never lowered, so every step reallocates the
  mesh cleanly under the fix above) showed a non-monotonic, seemingly
  toggling dense/sparse/dense/sparse pattern uncorrelated with cap magnitude
  -- ruling out both the capacity-reuse theory above and a data/count
  explanation (a strictly increasing `shown` cannot produce a sparser render
  than a smaller one under `syncEndpointMesh()`'s logic). Root cause
  isolated to three.js's automatic transparent-object paint-order sort: at
  equal `renderOrder` (the default, unset, for every object in the scene),
  ties are broken by each object's own `matrixWorld` origin distance to
  camera -- not by instance positions or bounding volume -- so the endpoint
  InstancedMesh (whose own local origin never moves) has no principled,
  stable ordering relative to the translucent cloud/surface/heatmap
  geometry it overlaps. Fix: `mesh.renderOrder = 1` set on the endpoint mesh
  in `_ensureEndpointMesh()` (all other scene objects remain at the default
  0), forcing markers to always paint after -- i.e. on top of -- that
  geometry, deterministically, regardless of camera distance or any prior
  slider/cap history. Golden suites re-verified exact-match after this
  change as well.
- Second follow-up (same day): renderOrder=1 fixed the toggle but also
  removed the soft "seen through the translucent cloud" look markers
  previously had most of the time (user feedback: always-on-top markers are
  "too distracting"). scene.js's cloud box/top/bottom faces and surface
  plane all already use depthWrite:false at the scene-wide default
  renderOrder (0) -- the original softening came from THAT geometry
  painting over the markers, which only stopped happening reliably once the
  endpoint mesh's tie-breaking began flipping unpredictably. Changed
  `mesh.renderOrder` from 1 to -1: markers now always draw BEFORE the
  cloud/surface geometry instead of after, so that geometry consistently
  paints over (softens) any marker under its on-screen footprint, restoring
  the original look, while remaining fully deterministic (renderOrder still
  always wins over the ambiguous distance-tie that caused the original
  toggle). Golden suites re-verified exact-match again.
- Third follow-up (same day): renderOrder=-1 still wasn't quite
  right -- it uniformly forces markers before *every* translucent scene
  layer (cloud box, top/bottom faces, surface plane, footprint heatmap
  cells), not just the one or two a given marker actually sits behind, so
  markers under multiple stacked layers (e.g. green cloud-base-crossing
  markers inside the cloud box's full 3D volume) got compounded/over-
  attenuated to near invisibility, and surface markers picked up a visible
  color shift from the footprint-heatmap layer now reliably painting over
  them (user report: remaining visible endpoints looked "more like orange
  ... than red surface absorption"). Root issue with renderOrder pinning:
  it's a global override, blunter than the original per-object distance
  sort it replaced. Real fix: address the actual instability (recreating
  the mesh on every capacity change gives it a fresh, ever-increasing
  THREE.Object3D id each time, which is what flipped the ambiguous
  distance-tie unpredictably) instead of overriding the sort outright.
  `_ensureEndpointMesh()` now allocates the InstancedMesh ONCE per run, at
  the full fixed `ENDPOINT_BUFFER_MAX` (20000) capacity, and reuses that
  same mesh object for the rest of the run regardless of slider changes --
  only `mesh.count` (and the per-instance data for the currently-shown
  window) changes per sync; the mesh's identity, and hence its tie-break
  outcome against other scene geometry, never does. `renderOrder` is no
  longer set at all, restoring the scene's original natural sort order
  exactly as it was before any of today's endpoint-rendering fixes. Golden
  suites re-verified exact-match a third time.
- Fourth follow-up (same day, final): stabilizing the endpoint mesh's
  identity fixed its half of the problem, but the user then reported (a)
  high-frequency flashing between dense/sparse renderings *during a live
  run* (not just when touching the cap slider on a completed run), and (b)
  continued toggling under periodic-boundary domains specifically.
  `Scene.rebuildHistograms()` (scene.js) was the other offender: it calls
  `Scene.clearGroup(state.histogramGroup)` and rebuilds the three footprint-
  heatmap InstancedMeshes (reflected/transmitted/surface-absorbed) from
  scratch on every call -- the same destroy-and-recreate-every-refresh
  pattern already diagnosed and fixed for the endpoint mesh -- and
  `rebuildHistograms()` fires periodically *during* a run (every
  `DISPLAY_EVERY_CHUNKS` chunks in `runControl.js`'s `runInstantBatch`
  loop), not just once at the end. Each heatmap-mesh recreation got a fresh,
  ever-increasing id, flipping the same ambiguous transparent-sort tie-break
  against the (now-stable) endpoint mesh on that live cadence -- explaining
  both the in-run flashing and the still-present periodic-domain toggle.
  Fix: introduced `state.heatmapMeshGroup`, a scene-level sibling of
  `histogramGroup` (added in `runControl.js`'s init, cleared only on a
  genuine `resetScene()` via new `Scene.clearHeatmapMeshes()`) holding three
  persistent InstancedMeshes, one per heatmap, each sized to its full grid
  (`nBins x nBins`) rather than only the currently-populated cell count.
  `Scene.addFootprintHeatmap()` now takes a `key` ('refl' | 'trans' |
  'surfAbs') and reuses/rewrites its mesh via new `Scene._heatmapMeshFor()`
  instead of allocating a new one every rebuild -- only `mesh.count` and the
  populated-cell instance data change per call; the mesh's identity never
  does, and is only reallocated on genuine grid-resolution growth (a rare,
  user-driven change, not part of the routine per-chunk rebuild cadence).
  New `Scene.hideFootprintHeatmap()` sets a heatmap's mesh count to 0
  (rather than skip building it) when a rebuild's conditions mean it
  shouldn't currently be shown (e.g. the surface heatmap toggled off),
  preserving its identity for if/when it's shown again. `histogramGroup`
  itself is still cleared and rebuilt every call as before, for the
  lighter-weight per-call content that remains in it (frame outlines,
  surface-interaction marker spheres). Golden suites re-verified exact-match
  a fourth time (this change touches only scene.js/state.js/runControl.js,
  not physics.js/simstats.js).
- Fifth follow-up (same day, root cause): stabilizing BOTH the endpoint- and
  heatmap-mesh identities did not stop the flashing/toggling -- user report:
  live-run flashing persisted, and the completed-run cap-slider toggle
  persisted identically in open AND periodic domains. This was the decisive
  falsification of the identity-churn theory: `RunControl.
  refreshEndpointDisplay()` (the cap slider's oninput handler) only ever
  touches the endpoint mesh, never calls `Scene.rebuildHistograms()`, and by
  this point the endpoint mesh's identity never changes -- yet the toggle
  still occurred on every slider adjustment. The one remaining thing both
  meshes' sync paths still recomputed on every single call (every chunk
  during a live run, every slider tick on a completed run) was the explicit
  `mesh.computeBoundingSphere()` added in the original two fixes above, to
  keep frustum culling accurate after instance updates. That recompute
  changes the mesh's centroid every time even when its identity is stable,
  and that changing centroid -- not a changing id -- is what was flipping
  the transparent-object paint-order tie-break against other scene geometry
  on every sync. Fix: removed both `computeBoundingSphere()` calls entirely
  and set `mesh.frustumCulled = false` on the endpoint mesh (in
  `photons.js`'s `_ensureEndpointMesh`), matching the footprint-heatmap
  meshes, which already used this exact pattern for the same reason ("cells
  span the whole domain") and were never the ones calling
  computeBoundingSphere until this session's earlier fix added it to them
  too. Golden suites re-verified exact-match a fifth time.
- Sixth follow-up (same day, final): the flashing/toggling was gone, but the
  user reported periodic-boundary domains consistently rendered the "dense"
  (unsoftened) look while open boundary consistently rendered the desired
  "sparse" one -- stable now, not flickering, but still wrong, and different
  per domain type. Explanation: every relevant object (endpoint mesh, cloud
  box/top/bottom faces, ground plane, heatmap meshes) sits at an identical,
  never-translated matrixWorld origin -- their real spatial extent lives
  entirely in instance/vertex data, not the object's own transform -- so the
  natural transparent-object sort is an exact tie among all of them, broken
  only by object id (creation order). Open and periodic domains construct
  their scenes via slightly different call sequences, so they land on
  opposite, internally-consistent sides of that tie. Fix: an explicit
  3-tier `renderOrder`, replacing reliance on creation order entirely.
  Ground plane and footprint-heatmap meshes stay at the default (0);
  `photons.js`'s endpoint mesh is now `renderOrder = 1`; `scene.js`'s cloud
  box, top face, and bottom face (the cloud volume specifically -- NOT the
  ground/surface plane) are now `renderOrder = 2`. Net paint order: ground/
  heatmap first, so markers are always clearly visible and untinted on top
  of them (matching every case where that already looked right); markers
  next; the cloud volume last, so it consistently -- and only -- softens
  whatever marker or heatmap cell happens to fall under its on-screen
  footprint. This sidesteps both earlier renderOrder attempts' failure
  modes (pinning markers uniformly before everything caused heatmap
  tinting; uniformly after removed the cloud's softening entirely) by
  putting markers in an explicit middle tier instead. Deterministic
  regardless of domain type, camera position, or object creation order.
  Golden suites re-verified exact-match a sixth time.

### Fixed (periodic-boundary photon paths silently dropped from the 3D view, user report)

- `Physics.wrapAndFindBoxEntry()`'s three call sites in `physics.js` all
  marked the returned hit/miss point `wrapBreak: true` unconditionally,
  regardless of whether a genuine cross-tile wrap actually occurred. In this
  app's actual geometry (a small clear-air gap relative to the M-scaled
  domain), the large majority of calls resolve on the FIRST loop iteration
  without ever wrapping -- the ray reaches the surface, or hits the home
  tile's own cloud, well before crossing any tile boundary. Marking these
  `wrapBreak: true` anyway meant `Photons.splitPathSegments()` (added under
  CODE-REVIEW P4) silently discarded the entire path whenever the wrapBreak
  point was the ONLY point following the start of a segment -- exactly the
  case for a simple two-vertex clear-air leg (TOA launch to surface), which
  is the *dominant* drawn-path population under Uniform domain illumination.
  Net effect: under periodic boundary, essentially none of these paths were
  ever visible in the 3D view (silently replaced by whatever other path
  types remained under the "Max paths drawn" cap), while the identical
  population rendered normally under open boundary -- reported by the user
  as "obvious red photon tracks in the open image not seen in the periodic
  image."
- Fix: `wrapAndFindBoxEntry()` now returns a `wrapped` boolean (true only if
  the loop actually advanced past a tile boundary at least once); all three
  call sites now pass `wrapBreak: wrapResult.wrapped` / `afterWrap:
  wrapResult.wrapped` instead of a hardcoded `true`.
- Verified: with the user's exact reported parameters (COT=0.10, M=2,
  θ₀=60°, A_s=0), periodic boundary's first-250-drawn-path composition now
  exactly matches open boundary's (67 transmitted / 183 surface-absorbed
  paths, previously 245 transmitted / 5 reflected / 0 surface-absorbed for
  periodic). A separate stress test (grazing θ₀=85°, tight M=1 domain, thick
  τ=10 cloud, A_s=0.9 multi-bounce -- designed to force genuine cross-tile
  teleports) confirms `wrapped` still correctly fires: 1,031 of 5,000
  photons got at least one real `wrapBreak` vertex, so the original P4
  teleport-break behavior is preserved, not just disabled. `wrapBreak` is a
  path-vertex-only visualization flag, read by nothing in the aggregate
  accumulation path, so this is a pure rendering fix; confirmed via all
  three mandatory golden regression suites (legacy v5.4.0, uniform-domain
  open, uniform-domain periodic) remaining byte-identical.

### Fixed (surface-absorption heatmap missing the dominant population at A_s=0, user report)

- Under Uniform domain illumination at A_s=0, `physics.js`'s cloud-base-
  crossing fast path (deterministic 100% surface absorption when A_s=0, so
  it skips the reflection RNG draw) returned `xExit`/`yExit`/`tauExit` at the
  cloud-base plane instead of the true surface-plane landing position. Since
  `simstats.js`'s surface-footprint accumulator only ever binned the
  `surface_absorbed` status branch, this fast-path population (`transmitted`
  status) was invisible to the surface-absorption heatmap — at low COT this
  is the *dominant* surface-reaching population (verified: ~24.6% of all
  launches, essentially the entire cloud-incident population at COT=0.1),
  leaving the heatmap empty directly under the cloud shadow where the
  strongest signal should be.
- Fix: the fast path now computes the true surface-plane (x,y) using the
  same clear-gap projection `surfaceInteraction()` already uses, without
  drawing from RNG (the reflection coin-flip is deterministic — always false
  — when A_s=0, so skipping it changes no physics but keeps the RNG stream,
  and therefore every golden snapshot, byte-identical). `simstats.js` now
  bins this corrected position into the surface heatmap; `photons.js` now
  draws the corresponding surface-absorbed endpoint marker (previously
  skipped, relying only on the separate green cloud-base-crossing marker).
- Verified: status counts and all three golden regression suites (legacy
  v5.4.0, uniform-domain open, uniform-domain periodic) are byte-identical
  before/after — confirming zero impact on R/T/A/S/Term bookkeeping or the
  RNG stream. `footSurfAbs` grid total now equals `transmitted +
  surface_absorbed` exactly (previously equaled `surface_absorbed` alone).
- Knock-on fix: `index.html`'s legend only listed 3 path-line colors
  (Reflected/Transmitted/Absorbed); `getOutcomeColor()` has actually
  returned 5 distinct path colors since the R8 pass added a
  `surface_absorbed` case, so `side_escape` (orange) and `surface_absorbed`
  (dark maroon) photon paths were rendering with no legend entry — user
  report ("red paths in the cloud not in the legend"). Added both missing
  swatches; relabeled the gray entry "Absorbed (cloud) photon paths" to
  disambiguate from the new surface-absorbed entry.
- Second knock-on fix (user report, follow-up): the on-screen `#legend` fix
  above didn't appear in exported PNGs even after a full hard-refresh +
  cache clear, because `exportUtils.js`'s `drawExportLegend()` draws from a
  **completely separate, independently-hardcoded** `entries` array baked
  into the export-canvas rendering code -- not the on-screen `#legend` div's
  HTML. Added the same two missing entries there ("Side-escape paths",
  "Surface-absorbed paths") and bumped `LEGEND_ROWS` from 7 to 8 (16 entries
  / 2 columns now, up from 14) -- this constant does not auto-derive from
  `entries.length`, so it has to be kept in sync by hand; this exact
  duplicated-constant mismatch class of bug already bit this same file once
  before (see the review E10 note a few lines above it in the source).

### Changed (CODE-REVIEW R7 — shared constants module)

- Added `js/constants.js`: four frozen string-literal enums (`EntryMode`,
  `ObsGeom`, `DomainBoundary`, `Status`) with their default values, for the
  photon entry mode, observation geometry, domain boundary, and terminal
  photon status categories that were previously string-matched independently
  across `physics.js`, `simstats.js`, `ui.js`, `photons.js`,
  `exportUtils.js`, `bottomPanel.js`, `scene.js`, `runControl.js`, and
  `state.js`. A mistyped literal in any of these files previously fell
  through silently to a default/legacy branch rather than erroring; every
  live comparison/definition site is now a reference into one shared,
  frozen source of truth instead.
- Pure refactor, no behavioral change: every constant evaluates to the exact
  same string value it replaced. Verified via `node --check` on all files, a
  runtime smoke-import of every three.js-independent module (catching two
  missing-`import` `ReferenceError`s that `node --check` alone couldn't
  detect), and all three mandatory golden-snapshot regression suites
  (exact-match, no change).
- `launchFace`/`launchRegion` (physics.js-internal per-photon derived tags)
  intentionally left as plain literals — out of scope for this pass; see
  `constants.js`'s header comment for the rationale.

### Changed (CODE-REVIEW R8 — presentation nits)

- `ui.js`'s `getOutcomeColor()` gained a distinct `"surface_absorbed"` case
  (dark brown, `0x7c2d12`) — previously these paths fell through to the same
  gray used for cloud-absorbed (`"absorbed"`) paths, making the two outcomes
  visually indistinguishable in the 3D path view. The new color matches the
  one already used for surface-absorbed event markers
  (`Scene.addSurfaceInteractionMarkers()`).
- Removed a duplicated, stale commented-out camera-position line that had
  been independently copy-pasted into both `RunControl.init()`
  (`runControl.js`) and `Scene.resetCamera()` (`scene.js`).
- `Photons.addStaticPath` (`photons.js`) now shares one `LineBasicMaterial`
  per outcome color, cached in `Photons._pathMatCache`, instead of
  allocating a fresh material for every path segment drawn (previously up to
  ~1000/run, one per path up to the "Max paths drawn" cap). Marked as a
  shared material so `Scene.clearGroup()` doesn't dispose it on Reset,
  matching the existing pattern used for the shared heatmap material.

### Changed (CODE-REVIEW R6 — delete dead "scene" observation-geometry plumbing)

- Removed `simstats.js`'s `_bypassInReflected()` and all call sites. It only
  ever returned `true` for the "Entire scene" observation-geometry option,
  which was removed from the UI dropdown pre-v6.0 and had been permanently
  unreachable (always `false`) ever since — simplified
  `observationGeometryLabel()`/`observationGeometryKey()` and
  `reflectedMuBins()/reflectedBdfWeights()/reflectedCount()/sideExitCount()/
  reflectedPathSegments()` to drop their now-dead conditional arms. No
  behavioral change for either live observation geometry
  (`top-base_faces`/`all_faces`).
- Rewrote stale prose comments (in `simstats.js` and `physics.js`) that still
  described "scene" as a live, selectable option, to instead reference the
  always-shown, dropdown-independent ENTIRE DOMAIN block that is the real
  successor to that removed geometry's math.
- The golden-snapshot test harnesses (`gen_golden.mjs`, `golden_one.mjs`) were
  independently driving the dead `"scene"` combiner path directly (bypassing
  the UI). Removed it from both; regenerated `golden_v5.4.0.json` from 54 to
  36 rows accordingly (the 12 removed rows were the now-meaningless "scene"
  combinations at A_s > 0). The surviving 36 rows and all raw per-photon
  stats are verified byte-identical to before this change. Historical
  "scene" values preserved in an appendix table in
  `golden_snapshot_v5.4.0.md` for reference.

### Fixed (CODE-REVIEW P7 — documentation corrections)

- README's "Data export" section still described µ-histogram and BDF export
  values as "signed" ("reflected and net-transmitted (signed, down − up)";
  "raw signed bin weights") — stale since the v6.0.1 review (E3/E4) replaced
  that earlier signed ±1 running-ledger scheme with a non-negative,
  terminal-event-only construction (each photon contributes exactly one +1
  tally, at the angle of its actual terminal exit/arrival; reflections along
  the way are never binned). Rewritten to describe the actual current scheme.
- Found the same staleness one level deeper while fixing the above:
  `exportUtils.js`'s own top-of-function design-notes comment still said "BDF
  is exported as BOTH the raw signed bin weights..." — inconsistent with the
  actually-generated `bdf.description` JSON field a few lines below it, which
  already correctly said "non-negative". Fixed the comment to match.
- Added a reproducibility caveat to the same README section: an export taken
  after one or more **Launch One** clicks is not reproducible from `rng_seed`
  alone, since each click draws new photons from the advancing RNG stream
  onto the running statistics — only a fresh **Launch Ensemble** or **Reset**
  restarts from the seed's initial state.
- The other two CODE-REVIEW P7 items needed no change: the marker/footprint
  "1:1 with the green downward cloud-base crossings footprint" claim was
  already accurate (E12, which the note was sequenced after, landed well
  before this pass), and the "Display updates during large runs" cadence
  section remains correctly deferred until the TODO-perf-refresh-cadence.md
  work lands (it doesn't currently claim anything that work would falsify).

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
