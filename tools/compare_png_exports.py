#!/usr/bin/env python3
"""Compare two VISTA-C PNG exports (3-D view or bottom panel).

Answers the two questions that actually come up:

  * SAME DEVICE, before vs after a code change -> are the pixels identical?
    Byte comparison (`shasum`) is the stricter test and is usually right, but
    two different PNG encoder entry points (toDataURL vs toBlob) can emit
    different bytes for identical pixels. If shasum differs, check here before
    concluding anything is broken.

  * DIFFERENT DEVICES -> pixel comparison is undefined. Export size scales with
    devicePixelRatio (dpr = clamp(devicePixelRatio, 2, 4)), so a dpr-3 phone
    writes a PNG 1.5x the linear size of a dpr-2 desktop. This script reports
    the dimension ratio instead, which should be exactly that factor.

Usage:  python3 tools/compare_png_exports.py A.png B.png
Exit:   0 if identical (or a clean dpr scale), 1 otherwise.

Requires Pillow and numpy. For JSON exports use compare_json_exports.py.
"""

import sys
from fractions import Fraction

try:
    import numpy as np
    from PIL import Image
except ImportError as e:
    sys.exit(f"error: needs Pillow and numpy ({e})")


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)

    pa, pb = sys.argv[1], sys.argv[2]
    a = np.array(Image.open(pa).convert("RGBA"))
    b = np.array(Image.open(pb).convert("RGBA"))

    print(f"A  {a.shape[1]} x {a.shape[0]}  {pa}")
    print(f"B  {b.shape[1]} x {b.shape[0]}  {pb}")

    if a.shape != b.shape:
        rw = Fraction(b.shape[1], a.shape[1])
        rh = Fraction(b.shape[0], a.shape[0])
        print(f"\nDIFFERENT SIZE — B/A = {rw} wide, {rh} tall")
        if rw == rh:
            print(f"Consistent scale factor {float(rw):.4g}. Expected between devices of "
                  f"different devicePixelRatio (e.g. 3/2 for a dpr-3 phone vs dpr-2 desktop); "
                  f"NOT expected between two exports from the same device.")
        else:
            print("Width and height scale differently — that is not a dpr difference.")
        return 1

    if (a == b).all():
        print("\nIDENTICAL — same dimensions, every pixel equal.")
        return 0

    diff = (a != b).any(axis=2)
    n = int(diff.sum())
    ys, xs = np.nonzero(diff)
    maxdev = int(np.abs(a.astype(int) - b.astype(int)).max())
    print(f"\nDIFFER — {n} of {diff.size} pixels ({100.0 * n / diff.size:.4f}%)")
    print(f"max channel deviation: {maxdev}")
    print(f"bounding box: x {xs.min()}–{xs.max()}, y {ys.min()}–{ys.max()}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
