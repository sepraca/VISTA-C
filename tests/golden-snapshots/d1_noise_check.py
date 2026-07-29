#!/usr/bin/env python3
"""d1_noise_check.py -- D1 discipline: prove a golden difference is NOISE, not a bug.

Usage:
    python3 tests/golden-snapshots/d1_noise_check.py OLD.json NEW.json NULL1.json [NULL2 ...]

    OLD    the committed golden
    NEW    freshly generated with the change in place, at the golden's own seed
    NULLn  freshly generated with the change in place, at OTHER seeds (>= 2 required)

WHY THIS EXISTS. When a change alters the random stream by design (the 2026-07-29
mulberry32 -> xoshiro128** swap, TODO section R), every golden fails. The temptation is to
regenerate and move on -- which is how a real regression gets committed, because "the golden
changed" looks identical whether the cause is a new random stream or a broken estimator. D1
requires showing the difference is indistinguishable from re-running with a different seed
BEFORE overwriting anything.

  PASS = OLD->NEW is no bigger than seed-to-seed scatter -> safe to regenerate.
  FAIL = a shift survives that scatter -> STOP, investigate before touching the golden.

WHY THE NULL IS MEASURED, NOT ASSUMED -- READ BEFORE CHANGING THIS.
Two earlier versions of this script used an analytic sigma and BOTH gave wrong verdicts:

  (1) "sigma = sqrt(p(1-p)/N), so mean n_sigma should be ~0 +/- 1/sqrt(n)". Wrong: the
      generators call RNG.reset(SEED) with the SAME seed for every configuration, so the
      runs are correlated replays of ONE stream. A single stream-level fluctuation appears
      COHERENTLY across configurations and the mean does not average down. Measured null
      RMS of the per-quantity mean was ~0.5, not ~0.06 -- the gate was ~8x too tight and
      failed a difference that was pure noise.
  (2) "just use the binomial sigma for every fraction". Wrong twice over. EdownSfc/EupSfc
      are per-photon EVENT RATES (a photon can cross the surface repeatedly) and legitimately
      exceed 1, where the binomial model collapses sigma to ~1e-9 and reports +720,000 sigma
      from a 0.1% difference. And Tfrac/netSfcAbs are NET quantities (down minus up) --
      differences of strongly correlated counts, whose true variance is far BELOW Poisson,
      so the model overstated sigma and rms n_sigma came out at 0.4-0.6.

The estimators here are too heterogeneous for one closed-form sigma. So this script assumes
NOTHING about their distributions: the seed-to-seed differences ARE the null. Every quantity
is judged in its own raw units against the scatter its own null pairs exhibit.

WHAT IS TESTED, per quantity:
  spread  rms(NEW - OLD) / rms(null pair differences)  -- gate [0.4, 2.2]
          A ratio near 1 means OLD->NEW is an ordinary reseed. Two-sided on purpose: a ratio
          well BELOW 1 means OLD and NEW were CORRELATED, the 2026-07-28 mulberry32
          seed-phase defect, which is as wrong as a bias.
  bias    |mean(NEW - OLD)| / std(null pair means)     -- gate < 3.5
          Catches a coherent shift that leaves the spread intact.

Path-length histograms keep a per-bin Poisson chi^2, which needs no calibration (each bin is
an independent count) and is likewise two-sided.

WHAT THIS CAN AND CANNOT SEE -- measured, not claimed. Injecting a uniform multiplicative
shift into every scalar AND the reflected path histogram (what an estimator bug actually
looks like) into the 500k-photon legacy matrix:

    0.1% -> PASS (missed)    0.3% -> FAIL    0.5% and up -> FAIL

So the detection floor is ~0.2-0.3% on a coherent shift. A shift confined to ONE quantity is
weaker evidence and needs to be larger. This is a resolution limit of the golden matrix
itself, not a slack threshold: at N = 500k with configurations that share a seed, a 0.1%
move genuinely is smaller than reseed scatter. D1 is a guard against gross regressions;
it is not a substitute for the physics gates in tests/review-harness/.
"""
import json, sys, math
from itertools import combinations

if len(sys.argv) < 5:
    sys.exit(__doc__)

old = json.load(open(sys.argv[1]))["results"]
new = json.load(open(sys.argv[2]))["results"]
nulls = [json.load(open(p))["results"] for p in sys.argv[3:]]

# Scalars carried by the golden matrices. Deliberately a mix of binomial fractions, net
# quantities and event rates -- the empirical null handles all three without special-casing.
QUANTITIES = ["Rfrac", "Tfrac", "Sfrac", "Acloud", "Tterm", "EdownSfc", "EupSfc",
              "netSfcAbs", "meanScat", "meanPath",
              # uniform-domain / periodic goldens only; skipped when absent
              "domain.R_domain", "domain.T_domain"]

SPREAD_GATE = (0.40, 2.20)
# BIAS_GATE is NOT a normal-theory "3 sigma". The bias statistic divides by a sigma_r that
# is itself estimated from a handful of realizations, so it has heavy tails. It was
# calibrated by brute force: 8 null realizations, all 56 ordered (OLD,NEW) pairs among them,
# each judged against the remaining 6 -- i.e. 56 draws of the statistic under a guaranteed
# pure reseed. Observed per quantity (median / 90th / max):
#     Rfrac 0.83/2.60/2.65   Tfrac 0.76/1.83/2.12   Sfrac 0.80/2.03/3.54
#     EdownSfc 0.59/2.95/5.80   EupSfc 0.62/3.10/4.16   netSfcAbs 0.78/1.87/2.21
#     meanScat 0.74/2.32/4.11   meanPath 0.65/2.02/3.39
# The null reaches 5.8, so anything at or below ~3.5 would fire on clean reseeds. 6.0 sits
# just above the observed maximum. The bias test is therefore a COARSE net for gross shifts;
# the spread ratio and the path-histogram chi^2 are the sensitive gates.
BIAS_GATE = 6.0
# At least 6 null realizations. With 5 the same real comparison scored EdownSfc at 3.67
# (apparent FAIL) and with 8 it scored 1.10 -- the instability was entirely in sigma_r, not
# in the data. Fewer nulls do not make the test conservative, they make it random.
MIN_NULLS = 6
CHI2_GATE = (0.90, 1.15)


def get(rec, key):
    """Fetch a possibly-dotted field; None if any level is missing."""
    cur = rec
    for part in key.split("."):
        if not isinstance(cur, dict) or part not in cur:
            return None
        cur = cur[part]
    return cur


def check_configs(a_res, b_res, label):
    """The files must describe the SAME configurations or the comparison is meaningless.
    'domain' is NOT a config key -- despite the name it is a results block."""
    for i, (a, b) in enumerate(zip(a_res, b_res)):
        for k in ("illum", "theta0_deg", "As", "obsGeom", "M"):
            if a.get(k) != b.get(k):
                sys.exit(f"CONFIG MISMATCH ({label}) at result {i}: "
                         f"{k} {a.get(k)!r} vs {b.get(k)!r}")


def diffs(a_res, b_res, q):
    """Per-configuration b - a for quantity q, over configurations where both have it."""
    out = []
    for a, b in zip(a_res, b_res):
        va, vb = get(a, q), get(b, q)
        if va is not None and vb is not None:
            out.append(vb - va)
    return out


def rms(v):
    return math.sqrt(sum(x * x for x in v) / len(v)) if v else 0.0


def mean(v):
    return sum(v) / len(v) if v else 0.0


def std(v):
    if len(v) < 2:
        return 0.0
    m = mean(v)
    return math.sqrt(sum((x - m) ** 2 for x in v) / (len(v) - 1))


check_configs(old, new, "OLD vs NEW")
for j, nl in enumerate(nulls):
    check_configs(new, nl, f"NEW vs NULL{j + 1}")

# THE NULL MUST EXCLUDE *NEW*. An earlier version pooled NEW with the NULLn files to get
# more pairs; that silently defeated the bias test, because if NEW carries a defect then
# every pair involving NEW carries it too, inflating the null until the defect looks normal.
# Verified: a +0.3% bias injected into NEW passed the contaminated version and is caught by
# this one. The NULLn files are independent realizations of the same code, so pairs drawn
# only from them are pure seed noise regardless of whether NEW is sound.
null_pairs = list(combinations(range(len(nulls)), 2))
if len(nulls) < MIN_NULLS:
    sys.exit(f"need at least {MIN_NULLS} NULL realizations (got {len(nulls)}); "
             "see the MIN_NULLS comment -- too few makes the bias statistic random")

print(f"{len(new)} configurations | {len(nulls)} null realizations "
      f"-> {len(null_pairs)} null pairs (NEW excluded from the null)\n")
print(f"  {'quantity':<18}{'spread':>8}{'bias':>8}   verdict"
      f"   (gates: spread {SPREAD_GATE}, bias < {BIAS_GATE})")

fails = []
for q in QUANTITIES:
    real = diffs(old, new, q)
    if not real:
        continue
    null_d = [diffs(nulls[i], nulls[j], q) for i, j in null_pairs]
    null_rms = rms([x for d in null_d for x in d])
    # Bias scale: how much does a whole REALIZATION's mean move when only the seed changes?
    # sigma_r is that scatter; OLD and NEW are two realizations, so the difference of their
    # means has sd sqrt(2)*sigma_r. This is estimated from the null files alone (see above).
    per_real_means = [mean([get(r, q) for r in nl if get(r, q) is not None]) for nl in nulls]
    null_mean_sd = math.sqrt(2.0) * std(per_real_means)

    if null_rms == 0.0 and rms(real) == 0.0:
        print(f"  {q:<18}{'--':>8}{'--':>8}   identical in every realization (degenerate)")
        continue
    if null_rms == 0.0:
        fails.append(f"{q}: null is exactly zero but OLD->NEW moved by rms {rms(real):.3g}")
        print(f"  {q:<18}{'inf':>8}{'--':>8}   FLAG")
        continue

    spread = rms(real) / null_rms
    bias = abs(mean(real)) / null_mean_sd if null_mean_sd > 0 else 0.0
    ok = SPREAD_GATE[0] <= spread <= SPREAD_GATE[1] and bias < BIAS_GATE
    print(f"  {q:<18}{spread:>8.2f}{bias:>8.2f}   {'ok' if ok else 'FLAG'}")
    if not SPREAD_GATE[0] <= spread <= SPREAD_GATE[1]:
        fails.append(f"{q}: spread ratio {spread:.2f} outside {SPREAD_GATE}"
                     + ("  (streams appear CORRELATED)" if spread < SPREAD_GATE[0] else ""))
    if bias >= BIAS_GATE:
        fails.append(f"{q}: bias {bias:.2f} null-sigmas (coherent shift)")

# Path-length histograms: per-bin Poisson, no calibration needed.
num = den = 0.0
for a, b in zip(old, new):
    for h in ("reflected_counts", "net_transmitted_counts"):
        for x, y in zip(a["pathHist"][h], b["pathHist"][h]):
            if x + y > 0:
                num += (x - y) ** 2 / (x + y)
                den += 1
chi2 = num / den
print(f"\n  path-histogram chi2 : {chi2:.3f} over {int(den)} bins "
      f"(expect ~1.0; <1 means CORRELATED streams)")
if not CHI2_GATE[0] < chi2 < CHI2_GATE[1]:
    fails.append(f"path-histogram chi2 {chi2:.3f} outside {CHI2_GATE}")

if fails:
    print("\nD1 FAIL -- differences are NOT consistent with a reseed. Do NOT regenerate:")
    for f in fails:
        print("   " + f)
    sys.exit(1)
print("\nD1 PASS -- OLD->NEW is indistinguishable from a seed change; safe to regenerate.")
