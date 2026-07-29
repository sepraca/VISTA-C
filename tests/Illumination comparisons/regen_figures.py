#!/usr/bin/env python3
"""regen_figures.py -- rebuild every comparison figure in this folder.

Usage:
    python3 regen_figures.py --plan          # print commands, run nothing
    python3 regen_figures.py                 # rebuild all 18
    python3 regen_figures.py --only HGvsMie  # rebuild matching outfiles

WHY THIS EXISTS. The 18 PNGs here were produced by 18 long one-off invocations of
illumination_comparison.py that were never recorded anywhere complete -- only 2 of the 18
appear in TODO-direct-surface-illumination.md, and the flag choices (--brf vs
--entire-domain vs --transmitted-cloud-only) were scattered through CHANGELOG prose. When
the RNG swap (TODO section R, 2026-07-29) invalidated every figure, that meant 18 commands
had to be reconstructed by hand -- the kind of step where one wrong flag produces a figure
that looks fine and means something else. This manifest makes the set explicit and
reproducible.

SUPTITLES ARE NOW GENERATED, not hand-written. Each caption is built from the exports' own
`inputs` blocks by describe(), so a caption can no longer disagree with the data it labels
(the previous hand-written captions had to be retyped whenever a parameter changed). Wording
therefore differs slightly from the pre-2026-07-29 figures; the stated physics does not.

FLAGS -- why each figure gets what it gets:
  --brf                     rows 3-4 show the rigorous BRF/BTF (normalized by realized
                            N_top, and by A_proj under side-inclusive observation). This is
                            what the in-app panels show, so it is the default for every
                            cloud-element figure.
  --entire-domain           domain-mean view (side exits + surface bypass). Deliberately
                            N-normalized, so --brf is NOT combined with it -- the script
                            warns and ignores --brf if you try.
  --transmitted-cloud-only  drops the clear-sky-direct delta spike from the transmitted
                            histogram. Only meaningful for uniform-domain runs, where that
                            spike exists; matches the in-app panels.
"""
import os, subprocess, sys, json, glob

HERE = os.path.dirname(os.path.abspath(__file__))
PLAN = "--plan" in sys.argv
ONLY = sys.argv[sys.argv.index("--only") + 1] if "--only" in sys.argv else None

# (out_stem, file_a_stem, file_b_stem, label_a, label_b, headline, flags)
# {t} is substituted with the theta0 value; every entry is generated at both 0 and 60.
FAMILIES = [
    ("illumination_comparison_test_theta0={t}",
     "center_point_illumination_test_theta0={t}", "uniform_top_illumination_test_theta0={t}",
     "centered (pencil)", "uniform top",
     "Pencil vs uniform-top illumination", ["--brf"]),

    ("illumination_comparison_As0.5_geomA_theta0={t}",
     "center_point_As0.5_geomA_theta0={t}", "uniform_top_As0.5_geomA_theta0={t}",
     "centered (pencil)", "uniform top",
     "Pencil vs uniform-top illumination — cloud top/base faces", ["--brf"]),

    ("illumination_comparison_As0.5_geomB_theta0={t}",
     "center_point_As0.5_geomB_theta0={t}", "uniform_top_As0.5_geomB_theta0={t}",
     "centered (pencil)", "uniform top",
     "Pencil vs uniform-top illumination — cloud top/base/side faces", ["--brf"]),

    ("illumination_comparison_UD_M4_As0.5_geomB_theta0={t}",
     "uniform_top_As0.5_geomB_theta0={t}", "uniform_domain_M4_As0.5_geomB_theta0={t}",
     "uniform top", "uniform domain M=4",
     "Uniform-top vs uniform-domain illumination — cloud top/base/side faces",
     ["--brf", "--transmitted-cloud-only"]),

    ("illumination_comparison_UD_M4_As0.5_entireDomain_theta0={t}",
     "uniform_top_As0.5_geomB_theta0={t}", "uniform_domain_M4_As0.5_geomB_theta0={t}",
     "uniform top", "uniform domain M=4",
     "Uniform-top vs uniform-domain illumination — entire-domain view (domain-mean BDF)",
     ["--entire-domain"]),

    ("illumination_comparison_periodic_M4_As0.5_geomB_theta0={t}",
     "uniform_domain_M4_As0.5_open_theta0={t}", "uniform_domain_M4_As0.5_periodic_theta0={t}",
     "open boundary", "periodic boundary",
     "Open vs periodic domain boundary — cloud top/base/side faces",
     ["--brf", "--transmitted-cloud-only"]),

    ("illumination_comparison_periodic_M4_As0.5_entireDomain_theta0={t}",
     "uniform_domain_M4_As0.5_open_theta0={t}", "uniform_domain_M4_As0.5_periodic_theta0={t}",
     "open boundary", "periodic boundary",
     "Open vs periodic domain boundary — entire-domain view (domain-mean BDF)",
     ["--entire-domain"]),

    ("illumination_comparison_HGvsMie_b1_reff10um_theta0={t}",
     "hg_g0.8618_As0.5_topbase_theta0={t}", "mie_b1_reff10um_As0.5_topbase_theta0={t}",
     "HG (g=0.8618)", "Mie b1, r$_{eff}$=10 µm",
     "Henyey-Greenstein vs tabulated Mie at MATCHED g — phase-function shape only",
     ["--brf"]),

    ("illumination_comparison_HGvsMie_b1_reff10um_tau4_As0_theta0={t}",
     "hg_g0.8618_tau4_As0_topbase_theta0={t}", "mie_b1_reff10um_tau4_As0_topbase_theta0={t}",
     "HG (g=0.8618)", "Mie b1, r$_{eff}$=10 µm",
     "Henyey-Greenstein vs tabulated Mie at MATCHED g — thin cloud (cloudbow/glory survive)",
     ["--brf"]),
]


def describe(stem):
    """Second caption line, built from the export's OWN inputs so it cannot go stale."""
    d = json.load(open(os.path.join(HERE, stem + ".json")))
    i = d["inputs"]
    rng = i.get("rng", {"name": "mulberry32"})
    bits = [f"τ={i['tau_cloud']:g}",
            f"W={i['horizontal_extent']:g}τ",
            f"A$_s$={i['surface_albedo']:g}",
            f"Θ₀={i['theta0_deg']:.0f}°",
            f"N={i['photons'] / 1e6:g}×10⁶",
            f"{rng['name']} seed {rng.get('seed')}"]
    if i.get("photon_illumination") == "uniform_domain":
        bits.insert(2, f"M={i.get('domain_factor'):g}")
    return "(" + ",  ".join(bits) + ")"


jobs = []
for stem, fa, fb, la, lb, head, flags in FAMILIES:
    for t in ("0", "60"):
        out = stem.format(t=t) + ".png"
        if ONLY and ONLY not in out:
            continue
        a, b = fa.format(t=t), fb.format(t=t)
        for f in (a, b):
            if not os.path.exists(os.path.join(HERE, f + ".json")):
                sys.exit(f"missing export: {f}.json (run regen_exports.py first)")
        jobs.append((out, a, b, la, lb, head, flags))

if not jobs:
    sys.exit("no figures matched")

print(f"{len(jobs)} figure(s){' [PLAN ONLY]' if PLAN else ''}\n")
failures = []
for out, a, b, la, lb, head, flags in jobs:
    sup = head + "\\n" + describe(a)
    cmd = ["python3", "illumination_comparison.py",
           "--file-a", a + ".json", "--file-b", b + ".json",
           "--label-a", la, "--label-b", lb,
           "--outfile", out, "--suptitle", sup] + flags
    print("  " + out)
    if PLAN:
        print("    " + " ".join(f'"{c}"' if " " in c else c for c in cmd[1:]))
        continue
    r = subprocess.run(cmd, cwd=HERE, capture_output=True, text=True)
    if r.returncode != 0 or not os.path.exists(os.path.join(HERE, out)):
        print(f"    FAILED: {(r.stderr or r.stdout).strip()[:300]}")
        failures.append(out)
    else:
        kb = os.path.getsize(os.path.join(HERE, out)) // 1024
        print(f"    ok ({kb} KB)")

if failures:
    sys.exit(f"\n{len(failures)} FAILED: {', '.join(failures)}")
print("\nall figures regenerated" if not PLAN else "\nplan only; nothing written")
