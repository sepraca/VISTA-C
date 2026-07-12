# Code review — v6.0.0-dev (post-Phase-2), 2026-07-12

Reviewer: Claude (Fable 5), full read of all 12 `js/` modules, `index.html`,
`mc_export_reader.py`, `gen_golden.mjs`, README/CHANGELOG, and both TODO files.
Numerical findings below were **verified against the actual code** via a Node
harness (`tests/review-harness/verify_review_findings.mjs` — portable, run
`node tests/review-harness/verify_review_findings.mjs` from the repo root; it
prints the exact numbers cited here, seed 42). Findings that are inspection-only
(no run needed) are marked as such.

Handoff contract: each item has an ID (E# = error/bug, R# = refactor, P# =
plan/scope change), a severity, the file/function touched, and a suggested fix
with its verification gate. Items are independent unless noted.

---

## STATUS UPDATE (same session, 2026-07-12 — fixes applied)

The following items were **implemented and verified** in the review session
itself (details in CHANGELOG.md's `[Unreleased]` "Fixed / changed" block):

* **DONE, harness-verified**: E6 (portable gen_golden path), E1 (N-label now
  matches plotted bins under both geometries — 22179/22179, 35240/35240),
  E2+R2 (shared `SimStats.segMean/pathAxisMax/pathHistogramCounts`; export
  `bin_max` == panel `bin_max` for both uniform_domain (40=40) and legacy
  (50=50); panel values unchanged — the export moved to match the figure),
  E3/E4 option (a) (schema 1.2, cloud-only/domain-wide-cloud-only arrays +
  clear_direct fields, geometry-aware descriptions), E8 (reader handles
  1.1/1.2; end-to-end round-trip test via
  `tests/review-harness/gen_export_roundtrip.mjs` passes for uniform_domain
  and legacy, component sums exact).
* **E12 — upgraded from "fragile invariant" to LIVE BUG, then fixed.** The
  original review argued viaSide landings geometrically cannot fall in-grid;
  a post-fix harness check confirmed that for legacy modes (0 of ~30k in-grid)
  but found it FALSE for uniform_domain at oblique sun: at Θ₀=60°, M=3,
  2,834 of 105,873 viaSide arrivals landed inside the cloud-extent grid —
  clear-direct rays that cross the sunward footprint edge BELOW cloud base
  (needs Θ₀ steep enough that τ at the edge crossing exceeds τ_cloud, i.e.
  launch x < −halfW − τ_cloud·tanΘ₀) and traverse the sub-cloud clear gap
  under the cloud to land within the footprint. Under the old code these were
  binned into the green "downward cloud-base crossings footprint" despite
  never crossing the base — a real display contamination in uniform_domain
  runs. The `!viaSide` gate fixes it; legacy footprints are bit-identical.
* **DONE, inspection/convention**: E12 (footTrans gated on `!viaSide`),
  E5 (comments + RNG-draw warning), E7 (illumination change → resetScene),
  E9 (legacy bypass label), E10 (export legend rows), E11 batch (generator
  string, mode fallback, combiner copies, `world.domainW/D` init, label
  `for=` bindings, `units.domain_factor`, `UI.getBottomPanelMode`).
* `verify_review_findings.mjs` was updated to assert POST-fix behavior (E1/E2
  blocks must print equal values; E3/E4 block still shows the raw-vs-clean
  arrays by design — the raw export is ground truth, now documented + flagged).
* **Golden regression: PASSED.** Full post-fix `gen_golden.mjs` run (18
  configurations × 500k photons, seed 42) diffed against the committed
  `golden_v5.4.0.json`: **EXACT MATCH, all 54 rows**, after stripping the six
  documented additive Phase-2 raw-stat fields (verified zero for legacy modes,
  `bypassViaCloud == surfaceBypassUp` in every row — diff script:
  `tests/review-harness/diff_golden.mjs`). This simultaneously validates E6
  (the harness runs portably again) and cross-machine bit-reproducibility
  (this run was on a different machine than the one that generated the
  committed snapshot). Harness scalars were also spot-checked unchanged
  pre/post every edit (E1/E5 blocks print identical physics numbers).
* **DONE (added later in the same session)**: R4 — `getSimParams()`/
  `getMaxPaths()` snapshotted once per batch in `runInstantBatch` and once per
  animated sequence in `runEnsemble` (was once per photon: ~12 DOM reads ×
  10⁶-10⁷; also removes the mid-run parameter-drift reproducibility hazard;
  edits made mid-run/paused now take effect at the next launch, by design).
* **DONE (added later still, same session): P1's uniform-domain golden
  snapshot.** `tests/golden-snapshots/gen_golden_ud.mjs` +
  `golden_ud_v6.0-phase2.json` + human-readable
  `golden_ud_snapshot_v6.0-phase2.md`: uniform_domain × M∈{1,2,4} ×
  Θ₀∈{0°,60°} × Aₛ∈{0,0.5,1} (18 runs × 500k photons, seed 42, 36 rows),
  carrying ALL raw counters (incl. the six Phase-2 additions), the
  geometry-independent domain budget, and the full R/T/A component
  breakdowns with embedded exact-identity checks (all pass; closures exact).
  Cross-check: M=1 rows reproduce the legacy "top" rows of
  `golden_v5.4.0.json` bit-for-bit (240/240 fields). One-command
  re-verification for Phase 3: `node tests/golden-snapshots/check_golden_ud.mjs`
  (PASS = exact match against the committed snapshot; run with boundary=open
  after any transport change).
* **NOT yet done** (remaining from this document): R1 (spec-driven combiner
  table), R3 (split stats panel out of simstats), R5–R8, plan items P2–P7,
  and §5 perf items 2–5 (instanced surface markers, updateDisplay split,
  time-budgeted cadence, memory note). Suggested next: Phase 3, gated by
  check_golden_ud.mjs + gen_golden.mjs both passing at every step.

---

Original review text follows unchanged.

---

## 1. Verified bugs (harness-reproduced)

### E1 — mu-histogram N-label mismatch (uniform_domain + "top/base faces only")
**Severity: real display bug, user-visible.** `bottomPanel.js drawMuOverlay()`:
for a Uniform-domain run with the entire-domain toggle OFF, the plotted bins are
`transmittedMuBinsCloudOnly()` — which correctly respects `_sidesIncluded()` and
returns **base-only** bins under `top-base_faces` — but the N label is
`transmittedNetCountCloudOnly()`, which unconditionally returns
`tComponents().viaBase + viaSide`. Harness (M=2, Θ₀=60°, Aₛ=0.5, N=300k):
plotted-bin sum = 22,179; displayed N = 35,240. Under `all_faces` the two agree
exactly (35,240 = 35,240), confirming the bug is the missing geometry branch,
not the counters.

**Fix** (`simstats.js`): make `transmittedNetCountCloudOnly()` respect the
dropdown, mirroring the bins it labels:

```js
transmittedNetCountCloudOnly() {
  const tc = SimStats.tComponents();
  return SimStats._sidesIncluded() ? tc.viaBase + tc.viaSide : tc.viaBase;
}
```

**Gate**: harness E1 block prints matching sums/labels for BOTH geometries;
`gen_golden.mjs` unchanged (this function isn't in any scalar the snapshot
checks, but re-run anyway per standing policy). Check no other caller assumes
the old dropdown-independent meaning (currently the only caller is
`drawMuOverlay`).

### E2 — JSON path-length histograms no longer match the on-screen panel
**Severity: broken documented contract; affects legacy modes too (regression
from the 3.B fix).** `exportUtils.getExportDataObject()` still computes the
histogram axis (`niceMax`) from the means of the dropdown-selected path
segments, while `bottomPanel.drawPathOverlay()` (since the 3.B fix) computes it
from the genuine (touchedCloud=true) population including
`bypassPathsCloudOnly` and both side arrays, independent of the dropdown. The
JSON's own description says it "reproduce[s] the on-screen panel exactly" — now
false. Harness: uniform_domain (M=2, Θ₀=60°, Aₛ=0.5): export `bin_max=50` vs
panel `bin_max=40`; **legacy "top"** at the same conditions: export `bin_max=60`
vs panel `bin_max=50`. So every exported path histogram at Aₛ>0 currently uses
a different binning than the figure it claims to match. (The exported *means*
are still correct for the exported segment choice; only the binning/axis
diverges. The export also does not skip exact-zero entries the way
`drawPathHistogram` now does, but for the segment lists the export currently
uses, zeros cannot occur — `transmittedPathSegments()` is cloud-only and
`reflectedPathSegments()` never includes `bypassPaths` since `_bypassInReflected()`
is dead. So the axis is the only live divergence today.)

**Fix**: extract ONE shared helper (see R2) used by both files — e.g.
`SimStats.pathHistogramSpec()` returning `{ niceMax, scaleMean }` computed the
panel's way — and have `getExportDataObject()` consume it. Decide explicitly
whether the export should carry the panel's axis (recommended: yes, that's the
documented contract) and note in the JSON description that the axis is scaled
from the genuine/cloud-touched population.
**Gate**: harness E2 block prints equal `bin_max` for export and panel in both
legacy and uniform_domain cases; regenerate one JSON in-browser and diff
`path_length_histograms.bin_max` against the on-screen axis label.

### E3 — Stale JSON `mu_histograms.description` ("signed ±1 ledger")
**Severity: documentation error in a self-describing science export — will
mislead downstream analysis.** The description still says "net_transmitted_counts
are signed (+1 downward arrival at surface, −1 surface reflection)". After the
3.A terminal-event-only rebuild, the bins are non-negative terminal-arrival
counts; reflections are never binned. Same stale claim survives in the BDF
description ("raw signed bin tallies W" / "net (down−up)") — the weights are no
longer signed; "net" now means "terminal arrivals only," which equals net by
the telescoping identity but is constructed differently.
**Fix**: rewrite both description strings; this is exactly the kind of text
`mc_export_reader.py`'s summary echoes, so update it in the same pass as E8.

### E4 — JSON export of uniform_domain runs is inconsistent with every panel view
**Severity: design gap, needs a decision (not a one-line patch).** For
uniform_domain runs, `mu_histograms.net_transmitted_counts` and
`bdf.net_transmitted_weights/bdf` export the RAW dropdown combiners — including
the clear-direct delta spike. Harness (all_faces, M=2, Θ₀=60°, Aₛ=0.5): exported
bin 10 = 99,678 vs the panel's cloud-only 3,535 — a ~28× single-bin spike that
appears in no on-screen view (panels show cloud-only by default, or domain-wide
cloud-only under the toggle), with no flag in the file telling a reader it is
there or how to remove it. A DISORT comparison against this export would be
silently contaminated.
**Options** (pick one; my recommendation is (a)):
  (a) For uniform_domain runs, export **all three** transmitted variants —
      `..._counts` (raw, as today, ground truth), `..._counts_cloud_only`, and
      `..._counts_domain_wide_cloud_only` — plus the scalar
      `clear_direct_count` and the bin index it falls in. Purely additive;
      bump schema to 1.2. Do the same for the BDF weights (the normalized BDF
      grids can stay raw-only with a description note, since the reader can
      renormalize).
  (b) Minimal: keep arrays as-is, add a description note + `clear_direct_count`
      so a reader can subtract the spike (it is confined to one mu bin and one
      BDF (θ,φ) bin at exactly Θ₀; note the bin index is FP-sensitive at bin
      edges — at Θ₀=60° cos gives 0.4999…, landing in bin 9 not 10).
**Gate**: harness E3/E4 block; `mc_export_reader.py` round-trip (E8).

### E5 — Stale comment: "surface_absorbed never reached at Aₛ=0"
**Severity: comment-only, but it guards a correctness assumption someone will
trust later.** `simstats.record()`'s `surface_absorbed` branch comment says "At
A_s = 0 there are no surface absorptions, so this branch is never reached
there." False under uniform_domain: the clear-miss pre-loop branch calls
`surfaceInteraction()` unconditionally (no Aₛ gate), so at Aₛ=0 every
clear-direct photon terminates `surface_absorbed`. Harness (Aₛ=0, M=4, Θ₀=0,
N=100k): `surfaceAbsorbed = 93,671` (≈ (1−1/16)·N as expected), closure = 1
exactly. Two follow-ons worth a deliberate note in the code rather than a fix:
  * `surfaceInteraction` draws `RNG.rand()` for the albedo test even at Aₛ=0
    (clear-direct branch only). Harmless and stream-consistent within
    uniform_domain, but document it — it means Aₛ=0 uniform_domain runs are NOT
    RNG-stream-comparable to a hypothetical gated implementation, and any future
    "skip the draw at Aₛ=0" optimization would silently change uniform_domain
    streams (a golden-snapshot trap once P1 lands).
  * `physics.js`'s block comment above `surfaceInteraction` ("For A_s = 0 this
    handler is not used") needs the same uniform_domain exception noted.

### E6 — `gen_golden.mjs` has a hardcoded absolute path from a previous session
**Severity: the regression harness is currently broken on this machine.**
`const BASE = "/sessions/serene-brave-brahmagupta/mnt/VISTA-C/js"` — a stale
sandbox path. Every "re-run gen_golden.mjs after each phase" gate in the TODO
silently depends on fixing this first.
**Fix**: `const BASE = new URL("../../js/", import.meta.url).href;` (the pattern
used in `tests/review-harness/verify_review_findings.mjs`, which runs fine).
**Gate**: `node tests/golden-snapshots/gen_golden.mjs > /tmp/g.json` from repo
root; diff against `golden_v5.4.0.json` after stripping the six known additive
Phase-2 fields (per the TODO's documented procedure).

---

## 2. Errors / inconsistencies found by inspection (not harness-run)

### E7 — Switching Illumination mode doesn't rebuild the 3D scene or reset stats
`index.html`: `#photonEntry` onchange runs `UI.onIlluminationChange();
BottomPanel.drawBottomPanel()` only. Consequences: (i) the surface plane keeps
its previous size (switch to Uniform domain → plane stays 1×W until the next
run/reset; switch away → stays M×W); (ii) via **Launch One**, a user can
accumulate photons from different illumination modes into one statistics set
with no warning — statistically meaningless, and the panel gives no hint.
`domainFactor`/`hExtent`/`tauCloud` all call `RunControl.resetScene()` on
change; illumination arguably should too.
**Fix**: append `RunControl.resetScene()` to the illumination onchange (matches
existing convention; also fixes the plane-size staleness since resetScene →
buildCloudBox). Note Θ₀ has the same mixed-accumulation loophole (and a stale
incident arrow until next run) — decide whether to extend the same treatment.

### E8 — `mc_export_reader.py` not updated for schema 1.1
Already logged as open in the TODO (Phase 5 residue); flagging as a **release
blocker for v6.0.0**: the README markets the reader as the analysis path, and it
currently ignores `uniform_domain_outputs`, `domain_factor`, `domain_boundary`,
`cloud_fraction`. If E4 option (a) is taken, do reader support for 1.1 and 1.2
in one pass, with a round-trip test JSON committed under `tests/`.

### E9 — Misleading component label "from clear sky, via cloud" under legacy modes
`buildComponentBreakdownText()` labels `rComponents().clearViaCloud` as "from
clear sky, via cloud". Under legacy illumination, those photons were launched ON
the cloud (there is no clear-sky source); the label reads as an origin claim
(and its sibling A-split labels ARE origin-based: "cloud-incident"/"clear-sky
incident"), but for R(d) it actually describes the escape pathway (final leg
crosses clear sky after surface reflection, no cloud re-entry). The TODO 2.A
confusion this panel exists to prevent could be re-created by this wording.
**Suggestion**: legacy panel: "surface bypass (reflected at surface, escapes
without re-entering cloud)"; Uniform-domain panel can keep a "clear/via-cloud"
framing since a genuine clear-sky source exists there. Cheap, text-only, but
worth the user's sign-off on wording.

### E10 — PNG-export legend is missing three on-screen legend entries
`drawExportLegend()` has 12 entries; the live `#legend` has 15. Missing from
exports: surface-reflected events (purple dot), surface-absorbed endpoints
(brown dot), last-scatter-marker note. For Aₛ>0 exports the purple/brown markers
appear in the image but are not identified in its legend. Adding two rows keeps
LEGEND_ROWS at 7 (14 entries / 2 cols); the paused-marker note can stay
screen-only.

### E11 — Minor export/read inconsistencies (batch these)
* `getExportDataObject().generator` still says `"mc_cloud_rt_v4 — browser Monte
  Carlo…"` — predates the VISTA-C rename; README/CITATION call the tool VISTA-C.
* `downloadBottomPanel()` mode fallback is `?? "panel"`; `drawBottomPanel()`
  uses `?? "mu"` (affects only the exported filename in a can't-happen case).
* `updateDisplay()` reads `bottomPanelMode` via raw `document.getElementById`
  instead of a UI getter (lone DOM read outside `ui.js` input conventions).
* `reflectedMuBins()` returns the live `muReflBins` array (not a copy) in the
  no-sides branch while every sibling combiner returns a fresh array — a caller
  that mutates will corrupt the accumulator. Return a copy for uniformity, or
  document read-only.
* `inputs.units` in the JSON has no entries for `domain_factor` (dimensionless)
  — trivial addition alongside E4.
* "Show R/T/A components" and other checkbox labels are not `<label for=…>`
  bound — label text isn't clickable. Cosmetic.
* `state.js` `world` initializer lacks `domainW/domainD` (they're added
  dynamically by `updateWorld()`); declare them (=40) for shape stability and
  discoverability.

### E12 — Footprint/marker parity relies on unstated geometry
`registerCloudBaseTransmission()` bins EVERY surface arrival into `footTrans`
(the green "downward cloud-base crossings footprint"), including `viaSide=true`
side-derived and clear-direct arrivals, while the green 3D markers skip
`viaSide=true`. Parity holds today only because side-derived/clear-direct
landings geometrically cannot fall inside the cloud-extent grid (side exits move
outward in the exit axis; clear-direct launches are outside the footprint by
construction and Θ₀ drift is +x only), so `_addFootprint`'s bounds check drops
them. That invariant is fragile — Phase 3's periodic wrap will BREAK it (a
wrapped clear-air trajectory can put a viaSide surface arrival inside the
footprint). **Fix now, cheaply**: gate the `footTrans` binning on
`!result.viaSide` to make the 1:1 marker/footprint claim structural rather than
incidental. Verify legacy footprints bit-identical (they will be — viaSide
entries never landed in-grid).

---

## 3. Refactoring recommendations (ranked)

### R1 — Collapse the combiner-function families into one spec-driven accessor
`simstats.js` now has ~18 near-duplicate combiners: {mu, BDF, path} × {refl,
trans} × {dropdown, cloudOnly, domainWide, domainWideCloudOnly}. The Phase-2
history shows the failure mode this breeds: `drawPathOverlay()` was missed when
the toggle was added, and E1 above is the same class (a count function missing
its geometry branch). Replace with a table:

```js
const VIEWS = {
  reflected: {
    dropdown:  s => s._sidesIncluded() ? ["muReflBins","muSideEscUpBins"] : ["muReflBins"],
    domainWide: () => ["muReflBins","muSideEscUpBins","muBypassBins"],
    ...
  },
  transmitted: { ... }
};
// one accessor: SimStats.bins(channel, view) / SimStats.count(channel, view)
```

with the array-name lists shared between mu/BDF/path variants (they differ only
in which parallel accumulator set is summed). One place to add a future view;
counts and bins can never disagree because both derive from the same list.
**Risk**: medium (touches every display/export read path). **Gate**: golden
snapshot exact; plus a new small Node test asserting, for every (channel, view,
geometry) combination, `sum(bins) == count` — that single assertion would have
caught E1 and both Phase-2 wiring misses automatically.

### R2 — Extract shared path-histogram spec (fixes E2 structurally)
One function owning `segMean`, the genuine-population scale, `niceMax`, the
24-bin fill, and the zero-skip rule; `bottomPanel` and `exportUtils` both call
it. The export/panel contract then can't drift again.

### R3 — Split the stats-panel presentation out of `simstats.js`
`simstats.js` (948 lines) mixes pure accumulation (reset/record/combiners) with
DOM/HTML presentation (`updateDisplay`, `buildDomainBlockText`,
`buildComponentBreakdownText` — ~250 lines of template strings writing
innerHTML). Move presentation to a new `statsPanel.js` (simstats ← statsPanel ←
runControl). Benefits: Node harnesses stop needing a DOM stub for pure-stats
work; the innerHTML/`<b>`-tag safety reasoning is confined to one
presentation-only file; simstats returns to "accumulation + combiners" as its
header claims. **Risk**: low (pure move; the checkbox/geometry getters stay in
ui.js). Do it before Phase 3 lands more panel text.

### R4 — Hoist per-photon UI reads out of the hot loop (also a perf item, see P5)
`runControl.runInstantBatch()` calls `RunControl.getSimParams()` and
`UI.getMaxPaths()` **once per photon** — each is a cascade of
`document.getElementById` reads plus clamp logic. Beyond cost, it means a user
edit mid-run changes physics parameters mid-ensemble (a reproducibility hazard:
the exported "inputs" then don't describe the full run). Snapshot `params` and
`maxPaths` once per `runInstantBatch` call (or per `runEnsemble`). Same for the
animated loop in `runEnsemble`. **Gate**: golden snapshot exact (same RNG
consumption; parameters were only ever read, not drawn from RNG).

### R5 — Terminal-result builder in `physics.js`
Every terminal return hand-assembles the same 15-field object; the Phase-1 bug
history (missing push) and the flags threading (touchedCloud/launchRegion) show
how easy it is to miss a field on one path. A local
`terminal(status, extra)` closure capturing the common fields
(path/totalPath/scatterings/…/touchedCloud/launchRegion) removes ~10 duplicated
literals and makes adding Phase-3 fields (e.g. a wrapCount) a one-line change.
**Gate**: golden snapshot exact.

### R6 — Delete dead "scene" plumbing
`_bypassInReflected()` is now constant-false (the TODO notes it); `_obsGeom()`
comments, `observationGeometryLabel/Key()` still carry "scene" branches;
`reflectedMuBins()/reflectedBdfWeights()/reflectedPathSegments()/sideExitCount()`
all carry `byp ? … : 0` arms that can never fire (the domain-wide functions are
the live replacements). Remove after R1 (or as part of it). Keep the
"scene"-combiner MATH — it lives on, correctly, in `domain*Count()`.

### R7 — Shared constants module for mode/status strings
`"uniform_domain"`, `"top-base_faces"`, `"all_faces"`, status strings
(`"surface_absorbed"`, …) are string-matched across 7 files. One `constants.js`
with frozen enums removes the typo class entirely (a mistyped mode string today
silently falls through to "center"/legacy behavior — no error).

### R8 — Presentation nits (fold into any nearby pass)
`ui.js getOutcomeColor()` has no case for `"surface_absorbed"`/`"absorbed"`
(both fall to gray — intentional for absorbed, but surface-absorbed paths render
the same gray as cloud-absorbed; consider the brown used elsewhere for surface
absorption). `runControl.init()`/`resetCamera()` share a duplicated
commented-out camera line. `Photons.addStaticPath` allocates a material per
path (up to maxPaths=1000) — could share per-outcome materials.

---

## 4. Suggested changes to TODO-direct-surface-illumination.md

### P1 — Insert a "Phase 2.9 — consistency & hygiene" before Phase 3
Contents: E1–E6 + E12 fixes, R2, R4, and (decide) E4/E8. Rationale: Phase 3
touches the transport loop; you want the export/display layer *and the harness*
(E6!) trustworthy before physics changes, and E12's fragile invariant breaks
under periodic wrapping specifically. Also **extend the golden snapshot to
uniform_domain before Phase 3**: generate `golden_v6.0_phase2.json` covering
uniform_domain × M∈{1,2,4} × Θ₀∈{0°,60°} × Aₛ∈{0,0.5,1} with all Phase-2
component counters included. Phase 3's open-boundary code path must reproduce it
bit-for-bit (periodic off), which currently has no lock at all — the existing
golden covers legacy modes only.

### P2 — Phase 3 (periodic) is missing a third wrap site: the initial TOA ray-cast
The plan lists two wrap locations (surface-reflection re-entry; direct
upward-side-escape). There is a third: the **descending launch resolution** in
`simulatePhoton`'s uniform_domain pre-loop block. Under periodic tiling, a TOA
point near the tile's leeward edge whose descending ray exits the tile must be
wrapped and retested — that ray can clip the *neighboring* cloud image's sunward
wall. Concretely: the "sunward-wall reservoir" is supplied by the neighbor tile
under periodic tiling, so:
  * `M_min` / `updateDomainMarginWarning()` becomes an **open-boundary-only**
    concept — under periodic boundary the warning must be suppressed (there is
    no under-sampling; the reservoir wraps in). Update ui gating + README text.
  * The Phase-3 gate "periodic and open converge at large M" is right, but add
    the complementary small-M check: at M slightly **below** M_min(Θ₀), periodic
    must show MORE sunward-wall entries than open (the wrapped reservoir), a
    crisp signature that the third wrap site works.

### P3 — Phase 3 implementation detail: `rayBoxEntry` needs a t-range
The plan says "wrap coordinates at the call site, reuse rayBoxEntry unchanged."
Not quite sufficient: when stepping tile-by-tile, a hit returned by
`rayBoxEntry` is only valid if it occurs **before the ray exits the current
tile**; otherwise the true next event is the tile-boundary crossing (wrap and
retest). `rayBoxEntry` returns only the clamped entry point, not `tEnter`, so
the caller can't test that. Suggest: add an optional return of `tEnter`
(additive — existing callers ignore it) or a thin wrapper
`rayBoxEntryWithin(p, dir, …, tMax)`. The wrap loop is then: compute t to the
next tile boundary; test box entry; accept if `tEnter ≤ tBoundary`, else advance
to the boundary, wrap the coordinate, repeat.

### P4 — Phase 3: wrap-cap accounting and geometry notes
* The number of wraps per clear-air leg is analytically bounded:
  `nWraps ≤ ceil(horizontalTravel / (M·W))` with
  `horizontalTravel = Δτ_vertical · |dir_h| / |dir_z|`. For surface-reflected
  legs, `|dir_z| = μ ≥ ~1e-6` (Lambertian sample), so grazing bounces can need
  enormous wrap counts. Recommend: compute the bound per leg, cap at a constant
  (e.g. 10,000), and **tally capped photons in a new counter surfaced like
  `terminated`** (never silently mis-assign). At M·W = 80 and τ_surface = 15, a
  μ = 1e-3 bounce travels ~15,000 horizontal τ-units ≈ 190 wraps — real but
  bounded; the cap protects only the 1e-6 tail.
* Decide the **visualization semantics** of wrapped legs before implementing:
  drawing the true unwrapped trajectory sends paths far outside the rendered
  domain and re-entries happen at cloud *images* that aren't drawn; drawing
  wrapped coordinates makes trajectories teleport across the domain. Suggest
  wrapped rendering with a visible line break (two segments, no connecting
  line), and note it in the README. Also decide whether `footSurfAbs` bins
  wrapped or unwrapped landings under periodic (wrapped is the tile-consistent
  choice, and it interacts with E12/P6).
* Budget identity under periodic: R_domain + T_domain + A_cloud = 1 still holds
  (the ENTIRE DOMAIN budget never had an S — side exits were always folded into
  R_domain/T_domain).
* **S under periodic — RESOLVED (user decision, 2026-07-12): keep S binned,
  unchanged taxonomy.** Corrected analysis (supersedes an earlier "S ≡ 0 by
  construction" guess): S does NOT vanish in general. What disappears is only
  the terminal DOWNWARD side escape (every downward photon now reaches the
  surface or a neighbor image — that population migrates into T). What
  survives: under "all_faces", S = surface bypass exactly (photons threading
  the gap to space without striking any cloud image; rarer than open-boundary,
  exactly 0 only at Aₛ=0); under "top-base_faces", S stays substantial —
  genuine upward side-wall escapes that clear the lattice, plus side-derived
  surface absorption — and acquires a cleaner physical meaning than today:
  radiation escaping to space through the gaps between clouds having last left
  a cloud side (the classic broken-cumulus 3D effect). Decision: no
  reclassification, no bookkeeping surgery — S keeps its last-exit-face
  taxonomy; document the meaning shift in the README. Rationale: it is
  simultaneously (i) a sanity check on the periodic implementation, (ii) a
  reminder of the checkerboard physics of the scene, and (iii) a meaningful
  diagnostic in its own right. New Phase-3 gate assertions this enables:
  S(all_faces) == surfaceBypassUp exactly; S(periodic) ≤ S(open) at matched
  settings; open/periodic S converge at large M; terminal sideEscapeDown
  count ≡ 0 under periodic.

### P5 — Phase 4: pre-existing hooks are in place, two small notes
* The pixel filter can be implemented entirely in `record()` (exit position is
  already on every result) — no physics change; keep it that way.
* `A_proj` cap at `A_domain`: also guard `N_cloud-top = 0` (already noted) AND
  the M=1 case where `A_proj/A_domain > 1` occurs at modest θᵥ for τ/W = 0.25
  (tanθᵥ ≥ ~2, i.e. θᵥ ≥ 63° — the cap will bite at ordinary angles, not just
  the last bin; the TODO's "regularly-exercised safeguard" note is right and
  worth a unit test at exactly that crossover).

### P6 — Surface-absorption heatmap vs M (carried-forward item): concrete proposal
Rather than scaling `SURFACE_FOOT_EXTENT` with M (cell size then degrades for
the compact Aₛ-absorption structure near the cloud), keep the 2× grid for
legacy/cloud-derived landings and, under uniform_domain, size the grid to
`max(2, M)` × cloud extent **while also scaling nBins by the same factor**
(constant cell size, capped at a memory bound). At Aₛ=0 + uniform_domain the
heatmap currently never displays (`surfaceAlbedo > 0` gate in
`rebuildHistograms`) even though genuine surface absorption exists and would
show the **cloud shadow** — pedagogically valuable. Suggest changing the
display gate to `surfaceAlbedo > 0 || entryMode === "uniform_domain"`.

### P7 — Documentation corrections to fold into Phase 6
* README "Display updates during large runs": cadence numbers will change with
  the perf work (below) — rewrite then, not now.
* README markers section: "The marker numbers are 1:1 with the green downward
  cloud-base crossings footprint" — after E12's fix this becomes structurally
  true; without it, the claim is only geometrically incidental. Either way the
  sentence survives; just sequence it after E12.
* E3/E4 description rewrites propagate to README's "Data export" section
  (which repeats the "signed" language: "µ histograms — reflected and
  net-transmitted (signed, down − up)").
* Note for reproducibility text: exports produced after one or more **Launch
  One** clicks are not reproducible from `rng_seed` alone (the stream has
  advanced; only Launch Ensemble resets). One README sentence.

---

## 5. Suggested changes to TODO-perf-refresh-cadence.md

The TODO's framing (display-rebuild cadence) is correct but incomplete — two
non-cadence costs are likely as large or larger, and one of them is also a
correctness item:

1. **Per-photon DOM reads (R4 above)**: `getSimParams()` + `getMaxPaths()` per
   photon = ~12 `getElementById` + clamp calls × 10⁶–10⁷. Hoist to per-batch.
   Zero-risk, measurable, and removes the mid-run parameter-drift hazard. Do
   this FIRST — it changes the baseline any cadence experiment measures.
2. **`addSurfaceInteractionMarkers()` builds up to 1,200 individual
   `Mesh`+`SphereGeometry`+`Material` objects on every heavy refresh** (then
   disposes them all on the next). This is the same pattern v5.4.0 already
   eliminated for endpoints and heatmaps — convert to a single InstancedMesh
   (two colors/radii → per-instance color+scale, identical to the endpoint
   path). At Aₛ>0 this is plausibly the dominant per-refresh cost now.
3. **Split `updateDisplay()`**: it currently does text rebuild AND
   `_drawPanelCallback()` (full bottom-panel redraw). During path animation it
   runs **once per path vertex** (`addAnimatedPath.step()`), i.e. a full
   BDF-grid recompute + canvas redraw per animation frame. Split into
   `updateStatsText()` (cheap, per-step) and `updateDisplay()` (text + panel,
   per-chunk/finish); the animation loop calls the former.
4. **Cadence itself**: prefer the TODO's *time-budgeted* option — gate heavy
   refresh on `performance.now() - lastRefresh > 400` (plus forced refresh on
   finish/pause/step, which already exists). Simpler than the logarithmic
   schedule, self-tunes across machines, and keeps early-run liveliness
   automatically (early chunks are slow enough to pass the gate). Keep
   `CHUNK_SIZE` as the simulation slice; optionally make the chunk itself
   time-budgeted (~16 ms) later — separate change, measure independently.
5. **Memory note (not urgent)**: the per-photon path-length arrays
   (`netTransmittedPathLengths` etc., now ×2 with the CloudOnly twins) grow
   O(N); at 10⁷ photons with Aₛ>0 this is several hundred MB across arrays.
   The only consumers are means + a 24-bin histogram with an adaptive axis.
   A fixed fine histogram (e.g. 4,096 bins, τ∈[0, 4·τ_cloud + gap], overflow
   bin) + running sum/count reproduces both to display precision in O(1)
   memory. Defer until it actually hurts; note the CloudOnly twins double the
   cost added in v6.0.1.
6. Keep the TODO's invariant: cadence/perf changes must leave final numbers and
   exports bit-identical; verify with `gen_golden.mjs` (after E6) plus one
   in-browser 10⁶-photon before/after wall-clock + JSON diff.

---

## 6. Physics spot-checks performed (no errors found)

For completeness, these were checked and are correct as implemented:
HG inverse-CDF sampling including g→0 and ξ→{0,1} limits; scatter-frame
orthonormal basis construction; Lambertian cosine-weighted sampling
(μ = √ξ, upward = dir.z < 0 convention consistent throughout); first-crossing
logic in the transport loop (fractional-distance comparison, tau monotonicity
argument); `rayBoxEntry` slab test incl. parallel-axis and on-boundary launch
cases (tau=0 plane at TOA); uniform_domain M=1 bit-equivalence to "top" (same
two draws, no ray-cast branch reachable); budget closure at Aₛ=0 and Aₛ>0 under
both dropdown geometries (harness: closure = 1 exactly); the bookkeeping table
identities R_domain = R(all_faces) + bypass and T(all_faces) = T_domain
(consistent with counter definitions read directly from `record()` /
`tComponents()`); `muBinIndex`/`bdfBinIndex` bin conventions vs the
display/export descriptions; BDF normalization (area-weighted mean μ per ring;
the 1/μ flux→radiance factor consistent with the README's 2μ·BDF identity);
`M_min = 1 + 2(τ/W)tanΘ₀` derivation; footprint bounds behavior (E12 caveat).

## 7. How to re-verify

```bash
node tests/review-harness/verify_review_findings.mjs   # E1–E5 numbers above
node tests/golden-snapshots/gen_golden.mjs             # FAILS until E6 is fixed
```

Suggested fix order: E6 → E1 → E2(+R2) → E3/E4(+E8) → E12 → E5/E7/E9-E11 →
R4 → golden extension (P1) → then Phase 3.
