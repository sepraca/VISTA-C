# VISTA-C v6.0.3: Sunward ground-illumination fix, rendering-toggle fixes, and correctness cleanup

Patch release. No new capabilities — every change below is a bug fix, documentation
correction, or internal refactor on top of v6.0.2. The headline item is a real physics
fix: open-boundary Uniform-domain runs were silently under-illuminating the sunward
side of the surface at large cloud optical thickness and solar zenith angle, an effect
that scaled with τ_cloud and had gone unnoticed until a direct visual comparison caught
it. See [CHANGELOG.md](https://github.com/sepraca/VISTA-C/blob/main/CHANGELOG.md) for
the full, session-dated development history behind this release.

### Fixed

- **Sunward ground-illumination asymmetry under Uniform domain (open boundary).**
  Reported symptom: at large τ_cloud and Θ₀ (e.g. τ_cloud=10, Θ₀=60°), almost no direct
  surface illumination reached the sunward side of the cloud, though periodic boundary
  showed no such asymmetry at the same settings. Root cause: the rendering convention
  `world.slabH = τ_cloud` combines with the fixed τ=0 cloud-top launch reference so that
  a clear-sky photon's ballistic sideways drift before reaching the ground grows with
  τ_cloud — a thicker cloud silently shrinks the fixed launch domain's effective
  sunward ground coverage, independent of the domain factor M. Verified quantitatively:
  the closed-form prediction for minimum reachable sunward ground position matched
  observed values to 2 decimal places across five τ_cloud values. Periodic boundary
  needed no fix — confirmed by reading the wrap-and-retest transport code, not just the
  empirical symptom: the τ_cloud-scaling part of the drift is already absorbed exactly
  by wraparound. Fixed by extending (not shifting) the sunward launch-sampling bound by
  the exact ballistic margin, correcting a previously-incomplete `M_min` formula (was
  missing a surface-gap term), and moving the domain factor M from a passive warning to
  an active auto-clamp at run time. Legacy and periodic golden suites remain
  byte-identical; the open-boundary Uniform-domain golden snapshot was regenerated and
  the new baseline reviewed and signed off before committing. Full derivation and the
  design alternatives considered and ruled out are documented in
  `TODO-direct-surface-illumination.md`.
- **Endpoint-marker and footprint-heatmap rendering depended on UI slider/adjustment
  history**, not just its current value — two exports of the identical completed run
  at the same "Endpoint caps shown" setting could render visibly different marker
  density/brightness depending on what the slider had been set to earlier in the
  session, and a live run could flicker between dense/sparse renderings. Traced through
  several false leads (capacity-reuse, ambiguous three.js paint-order ties) to the real
  root cause: `computeBoundingSphere()` calls recompute frustum-culling bounds from
  whatever instance subset happened to be live at that moment, so a mesh's culling
  behavior silently depended on prior renders rather than only its current state. Fixed
  by removing those calls and using `frustumCulled = false` instead, plus stabilizing
  both the endpoint mesh's and the three footprint-heatmap meshes' identity across a run
  (never recreated mid-run) with an explicit 3-tier `renderOrder` (ground/heatmap <
  markers < cloud volume) to make transparent-object paint order deterministic. Rendering-
  only change — all three golden suites unaffected throughout.
- **Periodic-boundary photon paths silently dropped from the 3D view.** The dominant
  population under periodic boundary (a 2-vertex clear-air leg from TOA to the surface)
  was being discarded by the path-segment-splitting logic whenever no genuine tile wrap
  was needed — the common case, since the clear-air gap is usually small relative to the
  domain. Root cause: every wrap-site caller was unconditionally marking points as
  post-wrap, when only genuine tile-boundary crossings should be. Fixed by threading a
  real `wrapped` boolean through `wrapAndFindBoxEntry()` instead. Rendering-only
  (`wrapBreak` is unread by any aggregate statistic) — all three golden suites
  unaffected.
- **Surface-absorption heatmap** was hidden entirely under Uniform-domain illumination
  at Aₛ=0, even though genuine surface-absorption events (and the cloud's shadow
  structure) occur there; its grid extent was also a fixed 2× cloud width, clamping
  almost every landing to the edge cells at moderate-to-large domain factor M. Both
  fixed — display now gates on `Aₛ > 0 OR Uniform domain`, and the grid extent tracks M
  (capped at 10×). Separately, the Aₛ=0 fast path was recording the wrong (x,y) position
  for cloud-base crossings (the cloud-base point instead of the true surface-plane
  landing), so even the correctly-displayed heatmap was placing points wrong; fixed with
  no added RNG draw (the reflection coin-flip is deterministic at Aₛ=0). Display/binning-
  only in all cases — all three golden suites exact-match throughout, confirming zero
  RNG-stream or bookkeeping impact.
- **Wrapped-leg path visualization under periodic boundary** previously drew one
  straight line/curve from the pre-wrap point directly to the post-wrap point, visually
  implying the photon crossed the entire domain in a single jump. Each of the three wrap
  sites now flags the vertex pushed immediately after a genuine wrap, and path rendering
  draws one line per contiguous segment instead of one line through the whole
  trajectory. Path arrays are not part of any exported statistic — all three golden
  suites unaffected.
- **Legend gaps**, found in two independent places: the on-screen `#legend` div and the
  separate, hardcoded legend array `exportUtils.js` draws into exported PNGs were both
  missing the Side-escape and Surface-absorbed path-color entries (`getOutcomeColor()`
  has returned five distinct path colors since an earlier session, but both legends
  still only listed three/four). Both fixed independently, since fixing one didn't touch
  the other.
- **Documentation corrections**: README's Data export section described mu-histogram
  and BDF export values as "signed" — stale since an earlier session replaced that
  construction with a non-negative, terminal-event-only one; the same stale language was
  also found one level deeper, in `exportUtils.js`'s own design-notes comment. Both
  fixed. Also added a reproducibility caveat: exports taken after one or more "Launch
  One" clicks are not reproducible from the recorded `rng_seed` alone, since the RNG
  stream has already advanced past the seed — only Launch Ensemble/Reset genuinely
  restart from it.

### Changed

- **R6 — removed dead "scene" observation-geometry plumbing**: `_bypassInReflected()`
  and its dead conditional arms deleted from `simstats.js`; the same dead path retired
  from the golden-snapshot test harnesses, which regenerated `golden_v5.4.0.json` from
  54 to 36 rows (dropping the rows that drove the now-nonexistent option — all 36
  surviving rows and every raw per-photon stat verified byte-identical to before).
- **R7 — shared constants module**: added `js/constants.js` with four frozen enums
  (`EntryMode`, `ObsGeom`, `DomainBoundary`, `Status`), replacing live literal-string
  comparisons for these categories across nine files. Caught two real latent bugs along
  the way (`state.js`/`runControl.js` referenced `Status.NONE` without importing
  `constants.js` — a `ReferenceError` at runtime that `node --check` alone can't catch).

---

**Verification.** All changes re-verified against the three mandatory golden regression
suites (legacy, Uniform-domain open boundary, Uniform-domain periodic boundary) and the
`verify_phase3.mjs`/`verify_phase4.mjs` gate suites in `tests/review-harness/` after
every step. The sunward-illumination fix required updating one Phase-4 gate
("Uniform-domain M=1 ≡ legacy top") whose Θ₀=60° case no longer holds by construction
post-fix — a real, expected consequence documented at the point of change, not a
suppressed regression; the gate still holds exactly at Θ₀=0°, where the fix is a no-op.
The comparison figures in `tests/Illumination comparisons/` that embed open-boundary
Uniform-domain data at Θ₀=60° were regenerated to match; their Θ₀=0° counterparts came
back byte-identical, confirming the fix stayed precisely scoped to where it was needed.

**Full changelog:** [v6.0.2...v6.0.3](https://github.com/sepraca/VISTA-C/compare/v6.0.2...v6.0.3)
