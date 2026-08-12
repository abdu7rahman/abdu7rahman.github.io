#!/usr/bin/env python3
"""Contrast gates for the site's palette, read out of style.css.

The tokens are not picked by eye. Every pair that carries text is checked at
the floor its role needs: body prose at 7:1, muted and secondary text at 4.5:1,
the accent at 4.5:1 because it is what links are set in, and the hairlines
inside a band where they must be visible without becoming a divider.

Reads style.css directly, so the check cannot drift from what ships.

    python3 tools/check_contrast.py
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
CSS = (ROOT / "style.css").read_text()


def tokens():
    block = re.search(r":root\s*\{(.*?)\n\}", CSS, re.S).group(1)
    return {m.group(1): m.group(2).strip()
            for m in re.finditer(r"(--[\w-]+):\s*(#[0-9a-fA-F]{3,8})\s*;", block)}


def srgb_to_lin(c):
    c /= 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def lum(h):
    h = h.lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    r, g, b = (srgb_to_lin(int(h[i:i + 2], 16)) for i in (0, 2, 4))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(a, b):
    la, lb = lum(a), lum(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


# (foreground, background, floor, what it carries)
PAIRS = [
    ("--ink",       "--paper",   7.0,  "body prose on the page"),
    ("--ink",       "--paper-2", 7.0,  "body prose on a band"),
    ("--ink",       "--paper-3", 7.0,  "body prose on a card"),
    ("--ink-2",     "--paper",   7.0,  "secondary prose"),
    ("--ink-2",     "--paper-3", 7.0,  "secondary prose on a card"),
    ("--ink-3",     "--paper",   4.5,  "muted labels"),
    ("--ink-3",     "--paper-2", 4.5,  "muted labels on a band"),
    ("--ink-3",     "--paper-3", 4.5,  "muted labels on a card"),
    ("--signal",    "--paper",   4.5,  "links"),
    ("--signal",    "--paper-3", 4.5,  "links on a card"),
    ("--signal",    "--signal-w", 4.5, "a link on its own wash"),
    ("--accent",    "--paper",   4.5,  "the second categorical"),
    ("--night-ink", "--night",   7.0,  "prose on a black band"),
    ("--night-mut", "--night",   4.5,  "muted on a black band"),
    ("--paper",     "--signal",  4.5,  "a solid button's label"),
]

# Hairlines are meant to be felt, not seen. Too low and they vanish; too high
# and they become the dividers this design deliberately stopped using.
HAIRLINES = [("--rule", "--paper", 1.05, 1.35),
             ("--rule-2", "--paper", 1.15, 1.9),
             ("--rule", "--paper-2", 1.02, 1.3)]


def main():
    _sig()
    T = tokens()
    bad = 0
    print("%-12s %-12s %8s %7s   %s" % ("fg", "bg", "ratio", "floor", "carries"))
    for fg, bg, floor, what in PAIRS:
        c = contrast(T[fg], T[bg])
        ok = c >= floor
        bad += not ok
        print("%-12s %-12s %7.2f:1 %7.1f   %s%s"
              % (fg, bg, c, floor, what, "" if ok else "   <-- TOO LOW"))
    print()
    for fg, bg, lo, hi in HAIRLINES:
        c = contrast(T[fg], T[bg])
        ok = lo <= c <= hi
        bad += not ok
        print("%-12s %-12s %7.2f:1  %.2f-%.2f   hairline%s"
              % (fg, bg, c, lo, hi, "" if ok else
                 ("   <-- TOO LOUD" if c > hi else "   <-- INVISIBLE")))
    print("\n%s" % ("all gates pass" if not bad else "%d problems" % bad))
    return 1 if bad else 0


def _sig():
    """Author signature. stderr, tty-only, so redirected output stays clean."""
    import os, sys
    if os.environ.get("NO_BANNER") == "1" or not sys.stderr.isatty():
        return
    print("  " + "".join(chr(c - 7) for c in
          (104,105,107,124,115,39,121,104,111,116,104,117)), file=sys.stderr)


if __name__ == "__main__":
    sys.exit(main())
