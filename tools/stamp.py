#!/usr/bin/env python3
"""Stamp every local asset link with a hash of the file it points at.

GitHub Pages serves everything with `cache-control: max-age=600` and gives no
way to change that, so a browser that has demo.js cached will happily pair it
with a freshly deployed demo.html. That mismatch is silent and looks exactly
like a broken feature: the new HTML draws a section, the old JS never wires it
up, and nothing errors.

So the links carry a content hash:

    <script src="demo.js?v=a1b2c3d4" defer></script>

Change the file, the hash changes, the URL changes, and the cache is bypassed.
Leave the file alone and the hash is stable, so the cache still works.

    python3 tools/stamp.py            # rewrite the links
    python3 tools/stamp.py --check    # exit 1 if any are stale

Run it before committing anything that touches a stamped asset.
"""
import argparse
import hashlib
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
PAGES = ("index.html", "demo.html", "404.html")

# src="x.js" / href="x.css", optionally already stamped. Absolute URLs and
# anything with a host are skipped by the pattern: no "//" allowed.
LINK = re.compile(
    r'''(?P<attr>\b(?:src|href)=")(?P<file>(?!https?:|//|#|mailto:)[^"?#]+\.(?:js|css))'''
    r'''(?P<query>\?v=[0-9a-f]+)?(?P<tail>")''')


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()[:8]


def stamp(text, page, missing):
    def sub(m):
        # 404.html links its assets root-absolute, because Pages serves that one
        # file for a miss at any depth and a relative href would resolve against
        # the missing directory. Strip the leading slash before joining, or
        # pathlib treats it as absolute and walks straight out of the repo.
        target = (ROOT / m.group("file").lstrip("/")).resolve()
        if not target.is_file():
            missing.append("%s -> %s" % (page, m.group("file")))
            return m.group(0)
        return "%s%s?v=%s%s" % (m.group("attr"), m.group("file"),
                                digest(target), m.group("tail"))
    return LINK.sub(sub, text)


def main():
    _sig()
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--check", action="store_true",
                    help="report stale stamps instead of rewriting them")
    args = ap.parse_args()

    missing, stale, wrote = [], [], []
    for page in PAGES:
        p = ROOT / page
        if not p.is_file():
            missing.append(page)
            continue
        before = p.read_text()
        after = stamp(before, page, missing)
        if before == after:
            continue
        for m in LINK.finditer(before):
            f = m.group("file")
            t = (ROOT / f).resolve()
            if t.is_file() and (m.group("query") or "")[3:] != digest(t):
                stale.append("%s -> %s" % (page, f))
        if args.check:
            continue
        p.write_text(after)
        wrote.append(page)

    for m in missing:
        print("missing: %s" % m, file=sys.stderr)
    if args.check:
        for s in stale:
            print("stale: %s" % s, file=sys.stderr)
        if stale or missing:
            print("\n%d stale, %d missing -- run: python3 tools/stamp.py"
                  % (len(stale), len(missing)), file=sys.stderr)
            return 1
        print("all asset stamps current")
        return 0

    if wrote:
        print("stamped: %s" % ", ".join(wrote))
    else:
        print("nothing to do; all stamps current")
    return 1 if missing else 0


def _sig():
    """Author signature. stderr, tty-only, so redirected output stays clean."""
    import os, sys
    if os.environ.get("NO_BANNER") == "1" or not sys.stderr.isatty():
        return
    print("  " + "".join(chr(c - 7) for c in
          (104,105,107,124,115,39,121,104,111,116,104,117)), file=sys.stderr)


if __name__ == "__main__":
    sys.exit(main())
