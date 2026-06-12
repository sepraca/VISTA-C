# Code review — mc_cloud_rt_v4

Scope: all `js/` modules + `index.html`. Priority order: physics accuracy → functionality → efficiency → maintainability. Reviewed June 2026, after the Launch One / animation-cap / Pause-Step fixes.

## Verified correct (worth stating explicitly)

The physics kernel is sound. HG inverse-CDF sampling is exact (limits μ_s → ±1 check out at ξ = 0, 1, isotropic branch for |g| < 10⁻⁶). The scattering rotation builds a proper orthonormal basis with a well-conditioned helper-vector switch at |w.z| = 0.9. Free paths are −ln(ξ) with ξ clamped open. The Lambertian reflection samples μ = √ξ (cosine law). The sub-cloud-gap lateral displacement converts km → τ-units correctly (β_ext·d/μ). The BDF normalization π·W/(N·μΔμΔφ) is consistent between bin assignment (round to centers at 0°, 5°, …, 90°) and the half-width end bins, and is correct for oblique sun — all confirmed against converged DISORT to ~1σ at 10⁶ photons. Energy bookkeeping (R + T_net + A + S = 1, with surfaceReflected counted before side-escape checks) is self-consistent including multi-bounce surface cases. Three.js resources are conscientiously disposed. The RNG is a deterministic, seedable Mulberry32 single stream.

## Accuracy / functionality findings

**A1. Boundary-crossing order bug (physics.js ~line 118).** Side boundaries are tested before the top/base planes. A free-path segment that crosses *both* a lateral boundary and τ = 0 (or τ_cloud) is always classified `side_escape`, even when the τ-plane crossing happens first along the segment (smaller fractional distance f). Consequences: R (or T) biased low / S biased high by a fraction of the ~0.05–0.1% side-escape rate, and the recorded exit point can lie above cloud top or below cloud base (τ_b outside [0, τ_cloud]), which also misplaces endpoint markers. Fix: compute crossing fractions f_side, f_top, f_base for all violated boundaries and classify by the minimum.

**A2. `terminated` photons are silently counted as cloud-absorbed (simstats.js record(), else branch).** The maxEvents = 25000 cap in physics.js returns status `terminated`, which falls into the `absorbed` counter. At τ = 10 this never triggers (mean ~10² events), but at the UI maximum τ = 100 with ω₀ = 1, mean scatterings ~(1−g)τ² ≈ 1500 with a long tail — rare terminations would masquerade as absorption in a conservatively-scattering cloud, which should be impossible (A ≡ 0). Recommend: count `terminated` separately, display it if nonzero, and/or raise maxEvents.

**A3. µ-histogram "Transmitted (net downward)" is gross, not net, when A_s > 0 (bottomPanel.js drawMuOverlay).** The bars bin `transmittedMu` (every downward base crossing, +1 each), while the N label shows the *net* count (transmitted − surfaceReflected). The BDF panel handles net correctly via ±1 weights; the µ histogram does not subtract the upwelling. For A_s = 0 they coincide (your validation runs were fine). Fix: also push surface-reflection μ values with weight −1 (mirroring netTransmittedDirs), or relabel the panel "downward crossings."

**A4. Sub-cloud gap ignores lateral boundaries (physics.js surface branch).** With A_s > 0, the slant path from cloud base to surface can land (x_s, y_s) outside the slab footprint, the photon still reflects/absorbs there, and only the *re-entry* point is side-escape-checked. Surface markers can render outside the domain frame. This is a defensible "infinite surface, finite cloud" model — but it's undocumented, and the asymmetry (re-entry checked, descent not) is a choice worth a comment. Note the re-entry side-escape exits at tau = τ_cloud with an *upward* direction; it is counted in S.

**A5. BDF footnote never shows the near-nadir-averaging note (bottomPanel.js drawBdfOverlay).** `typeof getAvgNearNadirBdf === "function"` tests a nonexistent *global*; the function lives on `UI`. The condition is always false, so the "; near-nadir φ averaged" annotation never appears even when averaging is active — the exported plot under-documents itself. Fix: `UI.getAvgNearNadirBdf()`.

**A6. Multi-line 3D annotation renders on one line (scene.js makeTextSprite).** `text.split("\\n")` splits on the literal two-character sequence backslash-n, but the caller passes a string containing a real newline. The two-line sub-cloud-gap note is drawn as a single overlong line. Fix: `split("\n")`.

**A7. Minor:** T_net is clamped at 0 in the stats display (`Math.max(0, …)`), which would mask a bookkeeping bug that drove it negative; `photonCount` HTML attribute says max 100000 while ui.js clamps at 1000000 (JS wins — align them); the export legend color for reflected endpoints (#f7ee0a) doesn't match the actual endpoint color (0xfacc15); the export header reports `RNG seed: DEFAULT_SEED` — correct today, but will silently lie if a seed input is ever added (report the seed actually used).

## Efficiency findings

**E1. Per-photon endpoint maintenance is O(n²) (photons.js addEndpoint).** Every endpoint added (one per photon in instant mode) calls `trimEndpointMarkers` plus a duplicate while-loop, each `shift()` is O(n) on the children array, and then `applyEndpointFade` iterates *all* markers (cap default 6000) writing material opacity and scale. At 10⁵–10⁶ photons this is hundreds of millions of operations plus constant GPU buffer churn. Recommend: batch — add endpoints without fading during a run, apply trim+fade once per chunk (or per rebuildHistograms), and consider a single THREE.Points / InstancedMesh instead of 6000 individual SphereGeometry meshes (6000 draw calls).

**E2. Full scene-histogram rebuild per 1000-photon chunk (runControl.runInstantBatch → Scene.rebuildHistograms).** Each chunk disposes and recreates up to footprintGrid² (784–3600) box meshes with fresh geometries/materials, up to 1200 surface-marker spheres, and redraws the bottom panel — and `computeBdfGrid` re-bins the *entire* accumulated direction history every call, making cumulative work quadratic in photon count. For a 10⁶-photon run that's ~10⁹ re-binning operations. Recommend: throttle display updates (e.g., every 10 chunks and once at completion), accumulate BDF/µ/footprint bin counts incrementally as photons finish, and use InstancedMesh for the heatmap cells.

**E3. Minor:** `simulatePhoton` allocates a result object, three arrays, and a path array per photon even with storePath = false — acceptable GC pressure for an educational tool, but a typed-array rewrite of the hot loop would give ~5–10× if you ever want 10⁷ photons in-browser.

## Maintainability findings

**M1. Hidden global dependencies.** `simstats.js` calls `UI.getEndpointCap()` etc. without importing UI, and `scene.js` calls `BottomPanel.drawBottomPanel()` without importing BottomPanel — both work only because main.js sets `window.UI` / `window.BottomPanel`. This breaks under bundling, unit testing, or import reordering, and is invisible to static analysis. Neither import would create a cycle (bottomPanel imports SimStats/UI/state only); import them explicitly, or use the callback-injection pattern simstats.js already uses for the panel.

**M2. Dead code.** `BottomPanel.getBinNearDirection`/`getBinNearMuPhi` (only reference each other), `Scene.addTextSprite`, `SimStats.transmittedDirs` (write-only; already commented as reserved), and the unused `commonMax` parameter of `mapBdfToColorFraction`. Either wire up the bin-inspector these imply, or delete.

**M3. Duplicated cap-trim logic in addEndpoint** (calls trimEndpointMarkers, then repeats the same while-loop inline with ≥ vs >). Consolidate to one helper with an explicit off-by-one policy.

**M4. Magic numbers.** UI_PANEL_WIDTH = 418 appears in runControl.js (twice) and exportUtils.js and must match the CSS; chunkSize = 1000, maxEvents = 25000, the 3500 path-length cap, and slabH = 10 deserve named constants in one place (state.js would do).

**M5. index.html embeds behavior in attributes** (onclick/onblur strings) requiring the window.* global bridge in main.js. Migrating to addEventListener in main.js would remove the whole "legacy shorthands" layer. Low urgency; the current pattern is at least centralized and commented.

## Suggested priority

1. A1 (boundary ordering) — small fix, real bias, affects the quantity you validate against DISORT.
2. A3 (net-vs-gross µ histogram) — matters for the A_s > 0 cases you plan to compare.
3. A2 (terminated accounting) + A5/A6 one-liners.
4. E1/E2 throttling + instancing — biggest UX win for 10⁵–10⁶-photon runs.
5. M1 explicit imports — cheap insurance.
