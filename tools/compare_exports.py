#!/usr/bin/env python3
"""Compare two VISTA-C JSON exports for numerical identity.

Why this exists
---------------
`shasum` is the WRONG tool for VISTA-C JSON exports. Every export carries a
`generated` wall-clock timestamp, so two exports of the identical run always
have different digests. On 2026-08-12 that cost a round of confusion: exports
from a MacBook and an iPad hashed differently and looked the same by eye, and
the only actual difference in the entire file was that one field.

This script hashes the export with volatile metadata removed, so a match means
the physics content is identical. When they differ it reports WHICH leaves
differ, which is the thing you actually want to know.

PNG exports have no embedded timestamp, so plain `shasum -a 256` is correct for
those. This script is only for the JSON.

Usage
-----
    python3 tools/compare_exports.py A.json B.json
    python3 tools/compare_exports.py A.json B.json --keep-generated
    python3 tools/compare_exports.py A.json            # canonical hash only
    python3 tools/compare_exports.py A.json B.json --max-diffs 200

Exit status: 0 if canonically identical (or single-file mode), 1 if they differ.
Suitable for scripting a reproducibility check.
"""

import argparse
import hashlib
import json
import sys

# Fields excluded from the canonical hash: present in every export, expected to
# vary between two runs of the SAME configuration, and carrying no physics.
# Keep this list minimal -- anything excluded here is something the comparison
# can no longer detect.
VOLATILE_TOP_LEVEL = ("generated",)


def canonical_bytes(doc, keep_generated=False):
    """Deterministic serialization with volatile fields stripped.

    sort_keys makes the result independent of key insertion order, so two
    exports written by different code paths still compare equal if their
    content matches.
    """
    d = dict(doc)
    if not keep_generated:
        for k in VOLATILE_TOP_LEVEL:
            d.pop(k, None)
    return json.dumps(d, sort_keys=True, separators=(",", ":")).encode("utf-8")


def canonical_hash(doc, keep_generated=False):
    return hashlib.sha256(canonical_bytes(doc, keep_generated)).hexdigest()


def diff_leaves(x, y, path="", out=None, cap=100):
    """Collect differing leaves as (kind, path, a, b), depth-first.

    Ints and floats are compared by value, so 1 and 1.0 do not register as a
    type difference -- JSON round-tripping can legitimately change which one a
    whole number lands as.
    """
    if out is None:
        out = []
    if len(out) >= cap:
        return out

    numeric = isinstance(x, (int, float)) and isinstance(y, (int, float))
    if type(x) is not type(y) and not numeric:
        out.append(("TYPE", path, type(x).__name__, type(y).__name__))
        return out

    if isinstance(x, dict):
        for k in sorted(set(x) | set(y)):
            if len(out) >= cap:
                return out
            p = f"{path}/{k}"
            if k not in x:
                out.append(("ONLY-IN-B", p, "", ""))
            elif k not in y:
                out.append(("ONLY-IN-A", p, "", ""))
            else:
                diff_leaves(x[k], y[k], p, out, cap)
    elif isinstance(x, list):
        if len(x) != len(y):
            out.append(("LENGTH", path, len(x), len(y)))
            return out
        for i, (u, v) in enumerate(zip(x, y)):
            if len(out) >= cap:
                return out
            diff_leaves(u, v, f"{path}[{i}]", out, cap)
    else:
        if x != y:
            out.append(("DIFF", path, x, y))
    return out


def load(path):
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except FileNotFoundError:
        sys.exit(f"error: no such file: {path}")
    except json.JSONDecodeError as e:
        sys.exit(f"error: {path} is not valid JSON: {e}")


def main():
    ap = argparse.ArgumentParser(
        description="Compare VISTA-C JSON exports, ignoring the 'generated' timestamp.")
    ap.add_argument("files", nargs="+", metavar="FILE", help="one or two .json exports")
    ap.add_argument("--keep-generated", action="store_true",
                    help="include the 'generated' timestamp in the hash (will almost always differ)")
    ap.add_argument("--max-diffs", type=int, default=40,
                    help="maximum differing leaves to print (default 40)")
    args = ap.parse_args()

    if len(args.files) > 2:
        sys.exit("error: compare at most two files")

    docs = [load(f) for f in args.files]
    for f, d in zip(args.files, docs):
        print(f"{canonical_hash(d, args.keep_generated)}  {f}")

    if len(docs) == 1:
        return 0

    a, b = docs
    if canonical_hash(a, args.keep_generated) == canonical_hash(b, args.keep_generated):
        note = "" if args.keep_generated else "  (ignoring 'generated')"
        print(f"\nIDENTICAL{note}")
        for k in VOLATILE_TOP_LEVEL:
            if not args.keep_generated and a.get(k) != b.get(k):
                print(f"  {k}: {a.get(k)}  vs  {b.get(k)}")
        return 0

    # Diff the SAME view of the documents that was hashed. Otherwise a run that
    # the hash calls identical-but-for-the-timestamp would still list
    # /generated among its differences, which reads as a contradiction.
    a_cmp, b_cmp = dict(a), dict(b)
    if not args.keep_generated:
        for k in VOLATILE_TOP_LEVEL:
            a_cmp.pop(k, None)
            b_cmp.pop(k, None)

    diffs = diff_leaves(a_cmp, b_cmp, cap=max(args.max_diffs, 1) + 1)
    shown = diffs[:args.max_diffs]
    print(f"\nDIFFER — showing {len(shown)} differing leaf/leaves"
          f"{' (more exist)' if len(diffs) > args.max_diffs else ''}:")
    for kind, path, u, v in shown:
        print(f"  {kind:<10} {path or '/'}   {u!r}  vs  {v!r}")

    print("\nA is the first file, B the second.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
