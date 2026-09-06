#!/usr/bin/env python3
"""Contrast gates for the site's palette, read out of style.css and landing.css.

The tokens are not picked by eye. Every pair that carries text is checked at
the floor its role needs: body prose at 7:1, muted and secondary text at 4.5:1,
the accent at 4.5:1 because it is what links are set in, and the hairlines
inside a band where they must be visible without becoming a divider.

Reads both files directly, so the check cannot drift from what ships.
landing.css's tokens (the dark, shader.se-influenced landing page) sit in
their own :root block, same as style.css's -- adding a second file here beat
adding a body.home-scoped duplicate to style.css's, which would have mixed
two visual languages in one token block.

    python3 tools/check_contrast.py
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
FILES = [ROOT / "style.css", ROOT / "landing.css"]
LANDING = ROOT / "landing.css"


def tokens():
    # The first `:root { ... }` per file only. Both files also carry a second
    # one nested inside `@media (prefers-contrast: more)` that overrides a
    # handful of tokens for that one preference -- a `finditer` over every
    # match would let that override clobber the default it is conditional on,
    # gating the page against a palette nothing sees by default.
    out = {}
    for f in FILES:
        block = re.search(r":root\s*\{(.*?)\n\}", f.read_text(), re.S).group(1)
        for m in re.finditer(r"(--[\w-]+):\s*(#[0-9a-fA-F]{3,8})\s*;", block):
            out[m.group(1)] = m.group(2).strip()
    return out


def scrim_alpha():
    """How much of the page's own background the world's scrim lays down.

    Read out of landing.css rather than written here, because it is the whole
    contract: the world draws bright points wherever it likes, and the only
    reason text stays readable over it is that no more than (1 - alpha) of any
    world pixel can ever reach the eye. If someone lifts the scrim to let more
    of the render through, this gate has to move with them.
    """
    css = LANDING.read_text()
    m = re.search(r"#world-mount::after\s*\{(.*?)\}", css, re.S)
    if not m:
        raise SystemExit("check_contrast: no #world-mount::after scrim in landing.css")
    o = re.search(r"opacity:\s*([0-9.]+)", m.group(1))
    if not o:
        raise SystemExit("check_contrast: the world scrim has no opacity")
    return float(o.group(1))


def panel_alpha():
    """The least backing a word can sit on once the page is staged.

    Staged, the canvas scrim comes off entirely -- the world runs at full
    strength across the frame -- and what protects the text is the panel it is
    set in. So the bound moves with it, and it is read out of the stylesheet
    for the same reason the scrim's is: a gate that keeps its own copy of the
    number stops being a gate the first time someone changes the other one.
    """
    css = LANDING.read_text()
    # Every rule written in that shape, not the first one. A second rule with
    # the same selector prefix -- a reduced-motion override, say -- used to
    # shadow the one this is actually for, and the gate then failed with "no
    # backing" against a stylesheet whose backing was perfectly correct. A
    # false alarm on a load-bearing gate is worse than no gate, because it is
    # the kind of failure somebody eventually silences.
    rules = re.findall(r"is-staged #main > \.sec,\s*\n[^{]*\{(.*?)\n\}", css, re.S)
    if not rules:
        raise SystemExit("check_contrast: no staged panel rule in landing.css")
    stops = []
    for body in rules:
        stops += re.findall(r"rgba\(\s*10,\s*10,\s*10,\s*(\.\d+|[01](?:\.\d+)?)\s*\)", body)
    if not stops:
        raise SystemExit("check_contrast: the staged panel has no backing")
    # The fade to nothing at the outer edge is margin the grid's padding keeps
    # empty, so the floor that matters is the strongest stop, not the weakest.
    return max(float(v) for v in stops)


def over(a, b, alpha):
    """`a` at `alpha` over `b`, as a hex string."""
    a, b = a.lstrip("#"), b.lstrip("#")
    ch = [round(alpha * int(a[i:i + 2], 16) + (1 - alpha) * int(b[i:i + 2], 16))
          for i in (0, 2, 4)]
    return "#%02x%02x%02x" % tuple(ch)


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

    # landing.css -- the dark, shader.se-influenced page.
    # --signal was tried here first and rejected: 3.68-3.90:1 on black,
    # below every one of these floors. --landing-accent is demo.js's own
    # preempt/alert colour (#ff8a5c, reused rather than invented).
    ("--landing-fg",     "--landing-bg",   7.0, "prose on the landing page"),
    ("--landing-fg",     "--landing-bg-2", 7.0, "prose on a landing band"),
    ("--landing-fg",     "--landing-card", 7.0, "prose on a landing card"),
    ("--landing-mut",    "--landing-bg",   4.5, "muted labels on the landing page"),
    ("--landing-mut",    "--landing-bg-2", 4.5, "muted labels on a landing band"),
    ("--landing-mut",    "--landing-card", 4.5, "muted labels on a landing card"),
    ("--landing-accent", "--landing-bg",   4.5, "links on the landing page"),
    ("--landing-accent", "--landing-bg-2", 4.5, "links on a landing band"),
    ("--landing-accent", "--landing-card", 4.5, "links on a landing card"),
]

# Over the world. The landing page's canvas is not a background image with a
# known colour -- it is a live render, and the brightest thing it can put
# behind a line of text is a saturated patch of --landing-fg. So the surface
# these are measured against is not a token at all: it is that worst case seen
# through the scrim, which is the one number bounding how much of the render
# reaches the page. Every pair that carries text is checked there as well as on
# the solid tokens above, because on this page both surfaces really occur.
WORLD = [
    ("--landing-fg",     7.0, "prose over the world"),
    ("--landing-mut",    4.5, "muted labels over the world"),
    ("--landing-accent", 4.5, "links over the world"),
]

# Hairlines are meant to be felt, not seen. Too low and they vanish; too high
# and they become the dividers this design deliberately stopped using.
HAIRLINES = [("--rule", "--paper", 1.05, 1.35),
             ("--rule-2", "--paper", 1.15, 1.9),
             ("--rule", "--paper-2", 1.02, 1.3),
             ("--landing-rule", "--landing-bg", 1.05, 1.35)]


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
    print()
    a = scrim_alpha()
    lit = over(T["--landing-bg"], T["--landing-fg"], a)
    for fg, floor, what in WORLD:
        c = contrast(T[fg], lit)
        ok = c >= floor
        bad += not ok
        print("%-12s %-12s %7.2f:1 %7.1f   %s%s"
              % (fg, lit, c, floor, what, "" if ok else "   <-- TOO LOW"))
    print("%-12s %-12s %7s %7s   scrim at %.2f over a fully lit world"
          % ("", "", "", "", a))

    print()
    pa = panel_alpha()
    lit2 = over(T["--landing-bg"], T["--landing-fg"], pa)
    for fg, floor, what in WORLD:
        c = contrast(T[fg], lit2)
        ok = c >= floor
        bad += not ok
        print("%-12s %-12s %7.2f:1 %7.1f   %s, staged%s"
              % (fg, lit2, c, floor, what.replace(" over the world", ""),
                 "" if ok else "   <-- TOO LOW"))
    print("%-12s %-12s %7s %7s   panel at %.2f over a fully lit world"
          % ("", "", "", "", pa))

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
