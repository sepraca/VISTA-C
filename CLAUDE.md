# Working notes for Claude on VISTA-C

Read this before touching anything. It is not a description of the code — `README.md` does
that — it is how to work on it without repeating mistakes that have already been made here.

---

## 1. The rule that matters most: look at the picture

**Most of the real defects in this project were found by the author looking at a plot and not
believing a clean number.** Every one of them was invisible to the statistic being run at the
time:

| found by eye | the statistic said |
|---|---|
| period-3 rings in the ice BDF | pooled n_σ² = 1.05 — "agreement at Monte Carlo noise" |
| beaded cloudbow arc | n_σ² within its 2σ band on every band |
| θ-dependent scatter growing toward the horizon | flat significance, mean z = −0.018 |
| DISORT curves ringing after a settings change | χ² *improved* — that is what selected the bad settings |

So: **when a result is plottable, plot it and look at it, before and after any change.** A
metric that reports "fine" is not evidence unless you can say what it would have looked like
had the answer been "not fine". Two of the four above were cases where the metric could not
have detected the defect *even in principle*.

Corollary, learned the hard way twice in one day: **do not tell the author a number is
reassuring until you have looked at the same thing they are looking at.** When their visual
read conflicts with your statistic, the default assumption is that you are measuring a
different quantity than they are — not that they are mistaken. (Absolute deviation vs
deviation-in-σ was exactly this: both readings were correct and described different axes.)

## 2. Statistical discipline

1. **State the detectable effect size BEFORE declaring a null result.** At N photons the
   per-bin noise is 100/√counts %. Anything below that is invisible however clean the
   statistic looks. Two wrong "liquid is fine" calls came from skipping this.
2. **Never tune a reference solution to agree with the code under test.** DISORT settings were
   once chosen by minimizing χ² against VISTA-C; that selected a *ringing* solution, because
   the metric has no resolving power below the Monte Carlo noise floor. Converge the reference
   against **itself**, then compare.
3. **A gate that cannot fail is not a gate.** `verify_phase_assets.mjs` once computed ⟨µ⟩
   analytically from the table, so it passed an entire sampler rewrite without executing one
   line of the new code. If a test would pass with the feature deleted, it is not testing it.
4. **A systematic artifact gets WORSE with more photons.** Noise falls as 1/√N; a fixed bias
   does not. N-independence of a visible pattern is strong evidence *against* noise, and
   n_σ² = 1 + b²/σ² is the formal version: raise N and see whether it grows.
5. **Symmetry is a free, powerful test.** At Θ₀ ≠ 0 the field is exactly mirror-symmetric
   about the principal plane, so correlating a residual with its mirror separates real
   structure from noise at zero cost. Used twice to settle questions no χ² could.
6. **Common random numbers make an A/B far sharper** than an independence-based σ implies.
   RMS z well below 1 in a paired comparison is the signature that CRN is in play — not a bug.
7. **Correlated measurements are not independent evidence.** Eight bands sharing one RNG
   stream gave a "+3.4σ" offset that collapsed on an unrelated seed. Before believing a pooled
   significance, ask what is shared between the samples.

## 3. Repository discipline

- **A test that has not been RUN since a refactor is not a test.** Three offline scripts broke
  silently across the v6.2 family rename (`regen_exports.py`, `c5_highN_check.py`,
  `vistac_run_chunk.mjs`) and none was caught, because none is in `tests/run_all.mjs`. Two
  would have produced *plausible wrong numbers* rather than crashing. After any rename, run
  the offline generators, not just the suite.
- **Identity guards earn their keep.** `verify_inputs_match` in `regen_exports.py` is the only
  reason four reference exports were not silently converted from tabulated to HG.
- **Regenerate-and-verify (D1):** regenerate artifacts, then verify against the *previous*
  values with an explicit tolerance and a stated reason for any change. Never regenerate and
  assume.
- **Provenance beats convenience.** When a change makes two files indistinguishable but not
  equivalent, record the distinguishing field: `inputs.rng` (schema 1.6, generator swap),
  `phase_function.sampling` (schema 1.8, sampler change), `app_version` (which build).
  `CITATION.cff` sat two releases stale because nothing tied it to anything —
  `verify_version.mjs` now gates that.
- **One source of truth per fact.** `js/constants.js` `APP_VERSION` is the version; everything
  else derives from it.

## 4. Conventions specific to this project

- **The author runs all git commands** from his Mac, with explicit `git add` paths. Never
  commit. Prepare the exact commands and hand them over.
- **Gitignored working docs:** `TODO-*.md`, `CODE-REVIEW-*.md`, `RELEASE_NOTES*.md`. They
  persist locally and travel between sessions — read them first; they carry decisions you must
  not re-derive.
- **Every release gets a `RELEASE_NOTES_vX.Y.Z.md`**, patches included, pasted into the GitHub
  Release by the author.
- **Browser verification is the author's step.** Headless tests do not exercise the renderer,
  the module graph, or the DOM wiring; a change that passes 12/12 can still leave the app inert
  (a stale cached ES module makes the whole graph fail to link, silently).
- **The author is a remote-sensing scientist.** Give the physical mechanism, not just the
  number. Analogies help; speculation does not. If a claim is not measured, say so.

## 5. Where the reasoning lives

- `tests/DISORT comparisons/modis-viirs/README.md` — the C5 validation, including why the
  DISORT settings are what they are and the high-N bias analysis.
- `TODO-phase-functions-2026-08-07.md` §7A–§7C — the ice sampling investigation end to end,
  including the wrong turns and why they were wrong.
- `CHANGELOG.md` — every release records not just what changed but what was measured.
