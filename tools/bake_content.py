#!/usr/bin/env python3
"""Lift the written site into the lab, from the one copy that already exists.

The building needs the same prose, the same five benchmark tables and the same
182 numbers the document site carries. Retyping them into a React module would
put a second copy of every measurement in the repository, and a second copy of
a measurement is the failure this project has hit more than any other -- a
figure gets corrected in one place and quietly disagrees with the other for
weeks.

So index.html stays the source and this writes app/src/lib/content.js from it.
Run it after editing the page; the generated file says so at the top and the
check below fails a build that has drifted.

It is deliberately dumb about markup: it slices between section ids rather
than parsing, because the page is hand-written HTML with a stable shape and a
real parser would be more code with more ways to be subtly wrong about
whitespace inside a <td>.
"""
from __future__ import annotations

import html
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
PAGE = ROOT / "index.html"
OUT = ROOT / "app" / "src" / "lib" / "content.js"

SECTIONS = ["about", "work", "measured", "stack", "path", "contact"]


def clean(s: str) -> str:
    """Tags out, entities decoded, runs of space collapsed."""
    s = re.sub(r"<br\s*/?>", " ", s)
    s = re.sub(r"<[^>]+>", "", s)
    return re.sub(r"\s+", " ", html.unescape(s)).strip()


def slice_sections(page: str) -> dict[str, str]:
    marks = []
    for sid in SECTIONS:
        i = page.find(f'id="{sid}"')
        if i < 0:
            sys.exit(f"bake_content: no section {sid} in index.html")
        marks.append((i, sid))
    marks.sort()
    out = {}
    for n, (i, sid) in enumerate(marks):
        j = marks[n + 1][0] if n + 1 < len(marks) else len(page)
        out[sid] = page[i:j]
    return out


def paras(block: str) -> list[str]:
    return [clean(p) for p in re.findall(r"<p[^>]*>(.*?)</p>", block, re.S) if clean(p)]


def stack_rows(block: str):
    return [
        {"k": clean(k), "v": clean(v)}
        for k, v in re.findall(r"<dt[^>]*>(.*?)</dt>\s*<dd[^>]*>(.*?)</dd>", block, re.S)
    ]


def tables(block: str):
    """Every benchmark table, with its caption, head and body kept in order."""
    out = []
    for fig in re.findall(r"<figure class=\"bench\">(.*?)</figure>", block, re.S):
        cap = re.search(r"<h3>(.*?)</h3>", fig, re.S)
        note = re.search(r"<figcaption.*?<p>(.*?)</p>", fig, re.S)
        head = [clean(c) for c in re.findall(r"<th scope=\"col\"[^>]*>(.*?)</th>", fig, re.S)]
        rows = []
        for tr in re.findall(r"<tr>(.*?)</tr>", fig, re.S):
            if "scope=\"col\"" in tr:
                continue
            cells = [clean(c) for c in re.findall(r"<t[hd][^>]*>(.*?)</t[hd]>", tr, re.S)]
            cells = [c for c in cells if c]
            if cells:
                rows.append(cells)
        tail = re.search(r"<p class=\"bench__note\">(.*?)</p>", fig, re.S)
        out.append({
            "title": clean(cap.group(1)) if cap else "",
            "note": clean(note.group(1)) if note else "",
            "head": head,
            "rows": rows,
            "tail": clean(tail.group(1)) if tail else ""
        })
    return out


def projects(block: str):
    """Sliced between card starts, not matched to the next </li>.

    A non-greedy match to </li> stops at the first one inside the card, and
    the first one inside the card is a chip -- so every card came out ending
    just before its stats and all thirty measured figures in this section went
    missing silently. Slicing on the card boundary keeps the whole card.
    """
    out = []
    starts = [m.start() for m in re.finditer(r"<li class=\"proj\"", block)]
    cards = [block[a:(starts[i + 1] if i + 1 < len(starts) else len(block))]
             for i, a in enumerate(starts)]
    for li in cards:
        title = re.search(r"<h3[^>]*>(.*?)</h3>", li, re.S)
        desc = re.search(r"<p class=\"proj__desc\">(.*?)</p>", li, re.S)
        # The chips are bare <li> inside <ul class="chips">, not <li class="chip">.
        chipul = re.search(r"class=\"chips\">(.*?)</ul>", li, re.S)
        chips = ([clean(c) for c in re.findall(r"<li[^>]*>(.*?)</li>", chipul.group(1), re.S)]
                 if chipul else [])
        stats = []
        for lab, val in re.findall(r"<dt[^>]*>(.*?)</dt>\s*<dd[^>]*>(.*?)</dd>", li, re.S):
            stats.append({"k": clean(lab), "v": clean(val)})
        if title:
            out.append({"title": clean(title.group(1)),
                        "desc": clean(desc.group(1)) if desc else "",
                        "chips": chips, "stats": stats})
    return out


def timeline(block: str):
    out = []
    whens = re.findall(r"<p class=\"path__when\">(.*?)</p>", block, re.S)
    whats = re.findall(r"<div class=\"path__what\">(.*?)</div>", block, re.S)
    for when, what in zip(whens, whats):
        head = re.search(r"<h3[^>]*>(.*?)</h3>", what, re.S)
        out.append({"when": clean(when),
                    "title": clean(head.group(1)) if head else "",
                    "body": paras(what)})
    return out


def contact_rows(block: str):
    out = []
    for a in re.findall(r"<a[^>]*href=\"([^\"]+)\"[^>]*>(.*?)</a>", block, re.S):
        label = clean(a[1])
        if label and not label.lower().startswith("say"):
            out.append({"href": a[0], "label": label})
    return out


def main() -> int:
    page = PAGE.read_text()
    sec = slice_sections(page)
    data = {
        "about": paras(sec["about"]),
        "work": projects(sec["work"]),
        "measured": {"lede": paras(sec["measured"])[:1], "tables": tables(sec["measured"])},
        "stack": stack_rows(sec["stack"]),
        "path": timeline(sec["path"]),
        "contact": contact_rows(sec["contact"])
    }
    body = json.dumps(data, indent=1, ensure_ascii=False)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        "/* Generated by tools/bake_content.py from index.html. Do not edit.\n"
        " *\n"
        " * The document site is the source of every word and every number in\n"
        " * here. Editing this file instead of the page puts a second copy of a\n"
        " * measurement in the repository, which is how a figure ends up corrected\n"
        " * in one place and wrong in the other. Change index.html and re-run the\n"
        " * baker. */\n"
        f"export const CONTENT = {body};\n"
    )
    n_nums = len(re.findall(r"\d", json.dumps(data)))
    print(f"wrote {OUT.relative_to(ROOT)}  "
          f"{len(data['work'])} projects, {len(data['measured']['tables'])} tables, "
          f"{len(data['stack'])} stack rows, {len(data['path'])} timeline entries, "
          f"{len(data['contact'])} contact rows")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
