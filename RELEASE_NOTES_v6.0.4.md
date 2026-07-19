# VISTA-C v6.0.4: Periodic side-escape marker fix, legend overhaul, and layout robustness

Patch release. No new capabilities and no physics/statistics changes — every item below
is a rendering fix, a legend/labeling clarification, or an internal cleanup on top of
v6.0.3. Full golden-snapshot and gate-suite regression (legacy, Uniform-domain open
boundary, Uniform-domain periodic boundary, Phase 3/4 gates) re-verified exact-match
after every change in this release. See
[CHANGELOG.md](https://github.com/sepraca/VISTA-C/blob/main/CHANGELOG.md) for the full,
session-dated development history behind this release.

### Fixed

- **Periodic-boundary SIDE_ESCAPE endpoint markers rendered at cloud-top height instead
  of the cloud's own side wall.** Under Uniform domain + periodic boundary, the terminal
  SIDE_ESCAPE outcome reports the wrapped τ=0 clearance point (correct for R/T/A/S
  bookkeeping) rather than any location on a cloud wall, so markers visually read as
  top-face escapes instead of side escapes. Fixed with a minimal, deliberately scoped
  `physics.js` addition — `lastWallCrossing`, a single `{x,y,tau}` value overwritten (not
  appended) at every cloud-side-wall crossing, populated unconditionally regardless of
  the pre-existing `storePath` performance cap, with zero RNG or statistics impact.
  Verified directly: 100% of 327 sampled periodic side-escapes now land exactly on a
  cloud wall face at genuine mid-depth τ (previously 100% at τ≈0).
- **`SIDE_ESCAPE` rendering conflated two physically distinct events.** A genuine
  cloud-side-wall crossing and a surface-reflected photon that ascends without ever
  touching a cloud face again ("bypass," only possible at Aₛ>0) were colored and
  labeled identically, even though `simstats.js` has bucketed them separately since the
  Aₛ>0 feature was added. Bypass landings are effectively unbounded (measured range:
  x from −1387 to +36865 in one test geometry) since the modeled surface is infinite
  and the Lambertian reflection angle can approach grazing — rendering them as
  ordinary "side boundary escape" made no sense once Aₛ>0 made the population visible.
  Bypass events now render in a distinct pink (`#f9a8d4`) with their own "Surface-reflected
  escape (no cloud face)" legend entry, in both the on-screen view and exported PNGs.
- **Legend reorganized into Intermediate/Terminal event sections**, clarifying which
  markers end a photon's simulated path (reflected, side escape, bypass escape,
  surface-absorbed, cloud-absorbed) versus which are non-terminal and can recur any
  number of times while the photon keeps going (downward base-crossings, surface-reflection
  bounces). Applied identically to the on-screen legend and the exported-PNG legend,
  which previously drifted out of sync with each other (a fixed 18-entry array with a
  hand-maintained row-count constant that had already gone stale once this session).
- **Legend relayout to condense its vertical footprint**, iterated directly with the user
  via a shared, editable PowerPoint mockup. Restructured from one tall stacked column-pair
  into three purpose-built blocks: Intermediate events and a newly-titled "Animation photon
  paths" section sit side by side in a top row, and Terminal events spans the full width
  below as 3 independently-stacked columns of uneven height, each pairing a terminal dot
  with its own footprint square where one exists. Both the on-screen CSS and the
  exported-PNG canvas layout were rewritten around this same explicit block/column
  structure (replacing a generic row-major grid that couldn't express uneven column
  heights), and the exported PNG's legend box now has the same rounded corners as the
  on-screen box, which it previously lacked.
- **Legend/footprint label consistency pass**, at the user's request: dropped redundant
  "photon paths" wording from the Animation section's entries (e.g. "Reflected photon
  paths" → "Reflected"), clarified "Surface-absorbed photon paths" to "Incident
  surface-absorbed photon paths" (verified by simulation that this path color is
  specifically the Uniform-Domain clear-launch-miss case, never reachable from legacy
  illumination modes at Aₛ=0), and standardized all three footprint entries to a
  consistent "2D" spelling (was a mix of "2D" and "2-D").
- **Legend and section titles could wrap to a second line**, compressing below their
  natural content width against a fixed box max-width. Removed the cap and forced
  single-line rendering (`white-space: nowrap`) so the box now grows to fit its content;
  the export-canvas geometry calculation was also hardened to account for a section
  title's own width, not just its item labels, since canvas text never auto-wraps the
  way CSS does.
- **Export-button stacking used a fixed, now-stale viewport-width breakpoint**
  (`@media (max-width: 1700px)`), hand-picked against the legend's old, narrower
  footprint. Once the legend relayout above widened it, narrowing the browser window no
  longer stacked the download buttons until the legend was already overlapping them.
  Replaced with a real-time collision check (`getBoundingClientRect()` on both elements,
  re-run on every resize), which also correctly accounts for the UI's zoom-style
  `transform: scale()`, unlike a viewport-width media query — and won't go stale again
  if either element's size changes in the future.
- Several smaller rendering-only fixes carried over from earlier in this session's work:
  the domain-factor auto-clamp not being reflected in the rendered ground plane/heatmap
  extent at Θ₀>0; the surface-absorption heatmap checkbox being inert at Aₛ=0 for legacy
  illumination modes; the surface heatmap/ground plane and their outline frame not
  covering the true leeward ground footprint at Θ₀>0 (open boundary) or wrapping
  correctly (periodic boundary); periodic surface-landing endpoint markers not being
  wrapped into their canonical tile; and Uniform-domain sub-menu labels not being
  visually distinguished from other controls.

### Refactored

- **Stats-panel/accumulation split (R3):** moved all DOM/presentation code out of
  `simstats.js` into a new `js/statsPanel.js`, leaving `simstats.js` with only the
  accumulator, bin arrays, and pure combiner functions. Pure code organization — no
  change to RNG draws, physics, or accumulated statistics; verified bit-identical across
  all golden suites and gate checks.

---

**Verification.** As with prior patch releases, every change here was re-verified
against the three mandatory golden regression suites (legacy, Uniform-domain open
boundary, Uniform-domain periodic boundary) and the `verify_phase3.mjs`/`verify_phase4.mjs`
gate suites after each step — all pass exact-match, confirming this release touches
rendering and labeling only, with zero effect on the underlying Monte Carlo transport,
RNG stream, or reported statistics. No changes were needed in `/tests` for this
release: nothing in it altered simulated physics or accumulated statistics, and the
existing golden/gate suites already re-confirmed that at every step.

**Full changelog:** [v6.0.3...v6.0.4](https://github.com/sepraca/VISTA-C/compare/v6.0.3...v6.0.4)
