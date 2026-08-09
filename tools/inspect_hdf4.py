#!/usr/bin/env python3
"""inspect_hdf4.py -- dump the structure of an HDF4 phase-function file.

Run ON THE MAC (where pyhdf is installed), from anywhere:

    python3 inspect_hdf4.py /path/to/IceAndWaterPhaseFunctionData_v6.MODIS.hdf
    python3 inspect_hdf4.py /path/to/IceAndWaterPhaseFunctionData_v6.VIIRS.hdf

Send the output back and it becomes the spec for the HDF4 -> JSON converter.

WHY THIS EXISTS. HDF4 has no netCDF-style groups, so the liquid/ice separation that appears
in the NetCDF4 files must live either in the SDS names or in Vgroups. This script reports
both, plus every SDS's shape, dtype, attributes and a small value sample, so the converter can
be written against the real layout rather than a guess.

NOTE: written without being able to execute it (the authoring sandbox has no HDF4 library),
so it is deliberately defensive -- every section is wrapped so that one unavailable interface
does not abort the rest of the dump.
"""
import sys

try:
    from pyhdf.SD import SD, SDC
except ImportError:
    sys.exit("pyhdf not found.  conda install -c conda-forge pyhdf   (or: pip install pyhdf)")

if len(sys.argv) < 2:
    sys.exit(__doc__)
path = sys.argv[1]

SDC_TYPE = {}
for nm in dir(SDC):
    if not nm.startswith("_"):
        v = getattr(SDC, nm)
        if isinstance(v, int):
            SDC_TYPE.setdefault(v, nm)


def sample(arr):
    """A few values, first and last, without dumping a 1000-point array."""
    import numpy as np
    a = np.asarray(arr).ravel()
    if a.size <= 8:
        return np.array2string(a, precision=6, max_line_width=200)
    head = np.array2string(a[:4], precision=6, max_line_width=200)
    tail = np.array2string(a[-4:], precision=6, max_line_width=200)
    return f"{head} ... {tail}"


print("=" * 78)
print(f"FILE: {path}")
print("=" * 78)

# ---------------------------------------------------------------- SD interface
sd = SD(path, SDC.READ)

print("\n--- GLOBAL ATTRIBUTES ---")
try:
    for k, v in sd.attributes().items():
        s = str(v).replace("\n", " ")
        print(f"  {k} = {s[:150]}")
except Exception as e:
    print(f"  (could not read global attributes: {e})")

info = sd.datasets()
print(f"\n--- SCIENTIFIC DATASETS ({len(info)}) ---")
for name in sorted(info):
    dims, shape, dtype, idx = info[name]
    tname = SDC_TYPE.get(dtype, str(dtype))
    print(f"\n  {name}")
    print(f"      dim names : {dims}")
    print(f"      shape     : {shape}")
    print(f"      dtype     : {tname} ({dtype})")
    try:
        v = sd.select(name)
        atts = v.attributes()
        if atts:
            for ak, av in atts.items():
                print(f"      attr {ak} = {str(av)[:110]}")
        # Only sample arrays small enough to read cheaply.
        import numpy as np
        n = int(np.prod(shape)) if shape else 0
        if n and n <= 4_000_000:
            data = v.get()
            print(f"      values    : {sample(data)}")
            if hasattr(data, "min"):
                print(f"      min/max   : {float(data.min()):.6g} / {float(data.max()):.6g}")
        else:
            print(f"      values    : (skipped, {n} elements)")
        v.endaccess()
    except Exception as e:
        print(f"      (could not read: {e})")

sd.end()

# ------------------------------------------------------- Vgroup / Vdata layout
print("\n--- VGROUPS (how liquid/ice may be separated) ---")
try:
    from pyhdf.HDF import HDF, HC
    from pyhdf.V import V
    from pyhdf.VS import VS

    h = HDF(path, HC.READ)
    v = h.vgstart()
    ref = -1
    found = 0
    while True:
        try:
            ref = v.getid(ref)
        except Exception:
            break
        try:
            vg = v.attach(ref)
        except Exception:
            continue
        found += 1
        print(f"\n  Vgroup '{vg._name}'  (class '{vg._class}', ref {ref})")
        try:
            members = vg.tagrefs()
            print(f"      {len(members)} member(s)")
            for tag, mref in members[:40]:
                label = {HC.DFTAG_NDG: "SDS", HC.DFTAG_VG: "Vgroup",
                         HC.DFTAG_VH: "Vdata"}.get(tag, f"tag {tag}")
                print(f"        {label} ref={mref}")
        except Exception as e:
            print(f"      (could not list members: {e})")
        vg.detach()
    if not found:
        print("  none found -- liquid/ice must be distinguished by SDS name instead")
    v.end()
    h.close()
except ImportError:
    print("  (pyhdf.V not available; skipping)")
except Exception as e:
    print(f"  (Vgroup scan failed: {e})")

print("\nDone.  Please send this entire output back.")
