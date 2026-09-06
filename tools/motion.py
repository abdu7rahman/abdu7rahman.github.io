#!/usr/bin/env python3
"""Does the world run when nobody is touching it?

This is the only question that separates the world layer from a gallery of
renders, and for a long time the answer was no: every station's update() pushed
the clock into a uniform the dissolve shader reads and changed nothing else, so
the seven stations were dioramas that crossfaded. A screenshot cannot tell you
that -- a still of a running machine and a still of a stopped one are the same
picture -- so journey.js takes the frame twice at each settled stop, roughly a
second apart, with the reader sitting still, and this reads the pairs back.

Two numbers per station and the second one is the one that matters:

  grain   the median absolute difference over the whole render half. The finish
          pass lays animated film grain over everything, so this is never zero
          and it is the floor everything else has to be read against.
  moved   the fraction of pixels that changed by more than the threshold. On a
          station where nothing but grain is happening this is a fraction of a
          percent; on one where a plan is being driven or a window re-searched
          it is percent.

    python3 tools/motion.py DIR [--thresh 14]
"""
import sys, os, struct, zlib
import numpy as np


def read_png(path):
    d = open(path, 'rb').read()
    assert d[:8] == b'\x89PNG\r\n\x1a\n', path
    i, idat, ct, w, h = 8, b'', None, None, None
    while i < len(d):
        ln = struct.unpack('>I', d[i:i + 4])[0]
        typ, body = d[i + 4:i + 8], d[i + 8:i + 8 + ln]
        i += 12 + ln
        if typ == b'IHDR':
            w, h, bd, ct, _, _, inter = struct.unpack('>IIBBBBB', body)
            assert bd == 8 and inter == 0, (bd, inter)
        elif typ == b'IDAT':
            idat += body
        elif typ == b'IEND':
            break
    ch = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[ct]
    raw = zlib.decompress(idat)
    stride = w * ch
    out = np.zeros((h, stride), dtype=np.uint8)
    prev = np.zeros(stride, dtype=np.int32)
    p = 0
    for y in range(h):
        f = raw[p]; p += 1
        cur = np.frombuffer(raw[p:p + stride], dtype=np.uint8).astype(np.int32).copy()
        p += stride
        if f == 1:
            for x in range(ch, stride):
                cur[x] = (cur[x] + cur[x - ch]) & 255
        elif f == 2:
            cur = (cur + prev) & 255
        elif f == 3:
            for x in range(stride):
                a = cur[x - ch] if x >= ch else 0
                cur[x] = (cur[x] + ((a + prev[x]) >> 1)) & 255
        elif f == 4:
            for x in range(stride):
                a = cur[x - ch] if x >= ch else 0
                b, c = prev[x], (prev[x - ch] if x >= ch else 0)
                pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
                pred = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                cur[x] = (cur[x] + pred) & 255
        elif f != 0:
            raise SystemExit('png filter %d' % f)
        out[y] = cur.astype(np.uint8)
        prev = cur
    return out.reshape(h, w, ch)[:, :, :3].astype(np.int32)


def main(argv):
    if not argv:
        raise SystemExit(__doc__)
    root = argv[0]
    thresh = 14
    if '--thresh' in argv:
        thresh = int(argv[argv.index('--thresh') + 1])
    if os.path.isdir(os.path.join(root, 'motion')):
        root = os.path.join(root, 'motion')
    tags = sorted({f[:-6] for f in os.listdir(root) if f.endswith('-a.png')})
    if not tags:
        raise SystemExit('no motion pairs in ' + root)
    print('%-14s %7s %9s   %s' % ('station', 'grain', 'moved', 'peak'))
    worst = 0.0
    for tag in tags:
        a = read_png(os.path.join(root, tag + '-a.png'))
        b = read_png(os.path.join(root, tag + '-b.png'))
        if a.shape != b.shape:
            print('%-14s shapes differ' % tag)
            continue
        d = np.abs(a - b).max(2)
        frac = float((d > thresh).mean())
        worst = max(worst, frac)
        print('%-14s %7.1f %8.2f%%   %3d' % (tag, float(np.median(d)), frac * 100, int(d.max())))
    print('\nthreshold %d; "moved" is the share of the render half that changed by more than that' % thresh)
    if worst < 0.005:
        print('nothing in this world moves while the reader is still')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
