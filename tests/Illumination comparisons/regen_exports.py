#!/usr/bin/env python3
"""regen_exports.py -- regenerate every JSON export in this folder from the CURRENT code.

Usage:
    python3 regen_exports.py --plan     # print the commands, run nothing
    python3 regen_exports.py            # regenerate all
    python3 regen_exports.py --only mie # regenerate files whose name contains "mie"

WHY THIS EXISTS. These exports are reference artifacts for the comparison figures. When the
RNG was replaced (TODO section R, 2026-07-29) all 26 had to be regenerated, and the commands
that produced them lived only in prose in TODO-direct-surface-illumination.md -- 26 long
invocations with tau, g, Mie band, domain factor, boundary and photon count all varying, and
several combinations (tau=4, matched g=0.8618, Mie bands) not described there at all.
Retyping them is exactly how an artifact silently acquires the wrong parameters.

So nothing here is hand-typed: EVERY export already records its own run parameters in its
`inputs` block, and this script reads them back and reconstructs the generator invocation.
The file is its own manifest. A regenerated export is then verified to still describe the
same configuration it did before (see verify_inputs_match), which catches both a bad
reconstruction here and an accidental change to the export schema.
"""
import json, os, subprocess, sys, glob

HERE = os.path.dirname(os.path.abspath(__file__))
GEN = os.path.join(HERE, "..", "review-harness", "gen_export.mjs")

PLAN = "--plan" in sys.argv
ONLY = None
if "--only" in sys.argv:
    ONLY = sys.argv[sys.argv.index("--only") + 1]

# Fields that must survive regeneration unchanged. Deliberately excludes anything that is
# expected to move (the numbers) or that is inherently per-run (timestamps).
# NOTE hg_g / ssa_omega0 are deliberately ABSENT. Under a tabulated phase function they are
# DERIVED from the table (band-averaged), not run configuration, so they legitimately move
# when the tables change -- as they did in v6.2 (300 K -> 265 K). Including them would make
# this guard fire on every intended table migration, training the reader to ignore it.
IDENTITY = ["photons", "tau_cloud", "theta0_deg", "surface_albedo",
            "photon_illumination", "domain_factor", "domain_boundary", "pixel_fraction"]


def command_for(path):
    """Rebuild the gen_export.mjs invocation that produced this export."""
    d = json.load(open(path))
    inp = d["inputs"]
    out = d.get("outputs", {})

    mode = inp["photon_illumination"]
    th0 = inp["theta0_deg"]
    As = inp["surface_albedo"]
    # Observation geometry is an OUTPUT field (it selects the accounting, not the physics).
    geom = out.get("observation_geometry", "top-base_faces")
    if geom not in ("top-base_faces", "all_faces"):
        sys.exit(f"{os.path.basename(path)}: unrecognized observation_geometry {geom!r}")
    M = inp.get("domain_factor", 4)
    N = inp["photons"]
    fpix = inp.get("pixel_fraction", 1.0)
    boundary = inp.get("domain_boundary", "open")

    # theta0 is stored as a float that may carry representation fuzz (60.00000000000001);
    # the generator takes degrees, so round to a clean value and assert the round-trip.
    th0r = round(th0, 6)
    args = [mode, f"{th0r:g}", f"{As:g}", geom, f"{M:g}", str(int(N)), f"{fpix:g}", boundary]

    env = {}
    pf = inp.get("phase_function", {})
    # SCHEMA 1.7 (v6.2) renamed type "mie" -> "liquid" | "ice". This test still read
    # == "mie" until 2026-08-11, so for every v6.2 export the branch silently fell through
    # to the HG path below and reconstructed a TABULATED run as a Henyey-Greenstein one.
    # Nothing caught it until these exports were next regenerated, because the bug is only
    # reachable by running this script. verify_inputs_match did its job and refused the
    # result ("phase_function band: '1' -> ''"), which is exactly why that guard exists.
    # Accept the legacy name too: pre-1.7 exports are still readable.
    if pf.get("type") in ("mie", "liquid", "ice"):
        # Schema 1.5+ names these modis_band / r_eff_index (NOT band / reff_index -- an
        # earlier version of this script guessed the shorter names and crashed, which is
        # the good outcome; silently defaulting would have regenerated every Mie export
        # as band 1 / r_eff index 0).
        if not (pf.get("modis_band") or pf.get("band")) or "r_eff_um" not in pf:
            sys.exit(f"{os.path.basename(path)}: mie export missing band/r_eff_um; "
                     "cannot reconstruct without guessing")
        env["MIE_BAND"] = str(pf.get("modis_band") or str(pf["band"]).lstrip("b"))
        # BY VALUE, never by index: r_eff_index 8 was 10 um in the retired 24-radius
        # assets but is 12 um in the v6.2 18-radius grid. Reconstructing from the index
        # would silently regenerate these exports at a different droplet size.
        env["MIE_REFF_UM"] = repr(pf["r_eff_um"])
        # Family (schema 1.7). Pre-1.7 exports have no family field and were liquid by
        # definition — ice did not exist before v6.2 — so defaulting to liquid is safe.
        env["MIE_FAMILY"] = "ice" if pf.get("type") == "ice" else "liquid"
    else:
        # Non-default HG g must be passed explicitly or the run silently reverts to 0.85.
        if abs(inp["hg_g"] - 0.85) > 1e-12:
            env["HG_G"] = repr(inp["hg_g"])
    if abs(inp["tau_cloud"] - 10.0) > 1e-12:
        env["TAU_CLOUD"] = f"{inp['tau_cloud']:g}"
    return env, args


def verify_inputs_match(before, after, name):
    """The regenerated file must describe the SAME configuration as the one it replaced."""
    bad = []
    for k in IDENTITY:
        vb, va = before.get(k), after.get(k)
        if isinstance(vb, float) and isinstance(va, float):
            if abs(vb - va) > 1e-9:
                bad.append(f"{k}: {vb} -> {va}")
        elif vb != va:
            bad.append(f"{k}: {vb!r} -> {va!r}")
    pfb = (before.get("phase_function") or {})
    pfa = (after.get("phase_function") or {})
    # Band identity across the 1.7 rename: pre-1.7 stored modis_band=6, post stores band="b6".
    bnum = lambda pf: str(pf.get("modis_band") or str(pf.get("band", "")).lstrip("b"))
    if bnum(pfb) != bnum(pfa):
        bad.append(f"phase_function band: {bnum(pfb)!r} -> {bnum(pfa)!r}")
    # r_eff by VALUE -- the index is grid-dependent and meaningless across the asset swap.
    if pfb.get("r_eff_um") != pfa.get("r_eff_um"):
        bad.append(f"phase_function.r_eff_um: {pfb.get('r_eff_um')!r} -> {pfa.get('r_eff_um')!r}")
    if bad:
        print(f"    CONFIG DRIFT in {name}:")
        for b in bad:
            print("      " + b)
        return False
    return True


files = sorted(glob.glob(os.path.join(HERE, "*.json")))
if ONLY:
    files = [f for f in files if ONLY in os.path.basename(f)]
if not files:
    sys.exit("no matching .json exports found")

print(f"{len(files)} export(s){' [PLAN ONLY]' if PLAN else ''}\n")
failures = []
for path in files:
    name = os.path.basename(path)
    before = json.load(open(path))["inputs"]
    env, args = command_for(path)
    envs = " ".join(f"{k}={v}" for k, v in env.items())
    print(f"  {name}\n    {envs + ' ' if envs else ''}node ../review-harness/gen_export.mjs "
          + " ".join(args))
    if PLAN:
        continue
    full = dict(os.environ, **env)
    r = subprocess.run(["node", GEN] + args, capture_output=True, text=True, env=full)
    if r.returncode != 0:
        print(f"    GENERATOR FAILED: {r.stderr.strip()[:300]}")
        failures.append(name)
        continue
    try:
        newdoc = json.loads(r.stdout)
    except json.JSONDecodeError as e:
        print(f"    BAD JSON: {e}")
        failures.append(name)
        continue
    if not verify_inputs_match(before, newdoc["inputs"], name):
        failures.append(name)
        continue
    open(path, "w").write(r.stdout)
    print(f"    ok  (schema {newdoc.get('schema_version')}, "
          f"rng {newdoc['inputs'].get('rng', {}).get('name')})")

if failures:
    sys.exit(f"\n{len(failures)} FAILED: {', '.join(failures)}")
print("\nall exports regenerated" if not PLAN else "\nplan only; nothing written")
