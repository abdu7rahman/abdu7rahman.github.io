#!/usr/bin/env python3
"""Are the GLSL template literals actually closed where they look closed?

This failure has cost this repository more than any other. A backtick written
inside a comment *within* a tagged template -- naming a uniform, say, the way
you would in prose -- closes the template early. What follows is still valid
JavaScript often enough that `node --check` passes, so the file parses, the
module fails at import time or produces a shader with the wrong source, and
world.js forgives a solid that will not load. The page then renders perfectly
happily with a whole layer missing and nothing anywhere says so.

Counting backticks does not catch it either: a comment containing a pair of
them is even, and an even number of stray backticks inside a template breaks
it exactly as thoroughly as an odd one. So this does not count. It walks the
file, tracks whether it is inside a template literal, and reports any backtick
that is inside one and is not the character closing it.

    python3 tools/check_shaders.py [paths...]        default: world/**/*.js
"""
import sys, pathlib, re

def scan(text):
    """Yield (line, kind) for every suspicious backtick."""
    bad = []
    i, n = 0, len(text)
    line = 1
    in_tpl = False
    in_line_comment = in_block_comment = False
    in_str = None
    while i < n:
        c = text[i]
        nxt = text[i + 1] if i + 1 < n else ''
        if c == '\n':
            line += 1
            in_line_comment = False
            i += 1
            continue
        if in_line_comment:
            if c == '`' and in_tpl:
                bad.append((line, 'backtick in a // comment inside a template'))
            i += 1
            continue
        if in_block_comment:
            if c == '`' and in_tpl:
                bad.append((line, 'backtick in a /* */ comment inside a template'))
            if c == '*' and nxt == '/':
                in_block_comment = False
                i += 2
                continue
            i += 1
            continue
        if in_str:
            if c == '\\':
                i += 2
                continue
            if c == in_str:
                in_str = None
            i += 1
            continue
        if not in_tpl and c in '"\'':
            in_str = c
            i += 1
            continue
        if c == '/' and nxt == '/':
            in_line_comment = True
            i += 2
            continue
        if c == '/' and nxt == '*':
            in_block_comment = True
            i += 2
            continue
        if c == '\\':
            i += 2
            continue
        if c == '`':
            in_tpl = not in_tpl
            i += 1
            continue
        # ${ } inside a template is JavaScript again, but nothing in this
        # repository puts a backtick in one, and treating it as template text
        # only ever produces a false positive nobody would then ignore.
        i += 1
    if in_tpl:
        bad.append((line, 'file ends inside an unclosed template literal'))
    return bad


def main(argv):
    paths = [pathlib.Path(a) for a in argv] or sorted(pathlib.Path('world').rglob('*.js'))
    fails = 0
    checked = 0
    for p in paths:
        if not p.is_file():
            continue
        text = p.read_text(encoding='utf-8')
        if '`' not in text:
            continue
        checked += 1
        for line, why in scan(text):
            print('%s:%d: %s' % (p, line, why))
            fails += 1
    if fails:
        print('\n%d suspicious backtick%s. A template closed early does not fail '
              'loudly -- it drops a layer off the page in silence.'
              % (fails, '' if fails == 1 else 's'))
        return 1
    print('%d files with template literals, all closed where they look closed' % checked)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
