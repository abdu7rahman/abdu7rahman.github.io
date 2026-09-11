#!/usr/bin/env python3
"""Bake the Unitree G1's visual meshes and its kinematic tree into one asset.

The building needs somebody in it. A guide that walks a visitor to a cell has
to be a robot rather than a sprite, and it has to be a real one -- this site's
whole argument is that the machines in it are the vendors' own triangles moved
by the vendors' own kinematics, and a humanoid drawn from primitives would be
the one thing on the page that is a drawing.

So this takes MuJoCo Menagerie's `unitree_g1` -- Unitree's own STLs and
Menagerie's MJCF -- and produces what the page draws: twenty-nine links, each
with its parent, its joint axis and limits, and its geometry welded and
decimated to something a browser redraws sixty times a second.

Nothing is modelled here. Every vertex is Unitree's, moved by the offset in
the MJCF's own geom. The only new numbers are the triangle budget and the
quantisation step, and both are arguments.

    python3 tools/bake_g1.py --src <dir with g1.xml and assets/>

Requires numpy, trimesh and fast-simplification.

The tree is carried in the output because, unlike the UR12e, there is no
hand-written kinematics module for this robot to disagree with. The bake is
the single source: app/src/lab/G1.jsx walks `links` and composes exactly the
product the MJCF describes.
"""
import argparse
import json
import pathlib
import sys
import xml.etree.ElementTree as ET

import numpy as np
import trimesh
import fast_simplification

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "g1.json"

#: The triangle budget, and it is three rules rather than a table of counts.
#:
#: A table of counts was what this had, and a count says nothing about how big
#: a part is. It gave every limb link 420 triangles, so the collar around the
#: waist -- a ring the size of a coaster -- came out at 13 triangles per square
#: centimetre while the hip casting, the size of a dinner plate, came out at
#: 0.33, a 43-fold spread in the one number that decides whether a surface
#: reads as a curve or as a polygon. It also cut the head from Unitree's 18,654
#: triangles to 1,400, which is past where quadric decimation degrades
#: gracefully: the visor opening collapses and the helmet comes out creased.
#:
#:   KEEP   the fraction of Unitree's own tessellation that survives. A CAD
#:          exporter already put triangles where the shape bends, so a flat
#:          fraction inherits that judgement instead of second-guessing it.
#:   FLOOR  triangles per square centimetre nothing may fall below, which is
#:          what stops a large smooth shell -- the chest is 7,529 cm2 and the
#:          source tessellates it at only 6.8/cm2 -- from being reduced to
#:          facets just because it was cheap to begin with.
#:   CAP    triangles per square centimetre nothing may exceed. The hands are
#:          148/cm2 in the source, moulded finger by finger, and no part of
#:          this robot is ever drawn large enough to need that.
#:
#: The three numbers are set from the largest the robot is ever drawn, not
#: from a close-up. The nearest the camera comes is the follow shot, 2.35 m in
#: front of a 1.32 m machine, which puts the head across about 86 pixels of a
#: 900 pixel frame. Baked at 84,791 triangles and again at 53,847 and rendered
#: at exactly that framing, the two differ on 0.16 per cent of pixels by more
#: than 24/255, with a mean absolute difference of 0.16 -- the extra 31,000
#: triangles are 200 KB on the wire and are not visible. So the lower one,
#: which comes to 53,847 triangles and 339 KB gzipped, spread between 1.2 and
#: 11 per square centimetre rather than 0.33 and 13.
KEEP = 0.14
FLOOR = 1.2
CAP = 5.0
MIN_FACES = 200


def budget_for(mesh, keep, floor, cap, floor_faces):
    """How many triangles this part is worth, by the three rules above."""
    have = len(mesh.faces)
    cm2 = mesh.area * 1e4
    want = keep * have
    if cm2 > 0:
        want = min(max(want, floor * cm2), cap * cm2)
    return int(min(have, max(floor_faces, round(want))))

#: Vertices are stored as int16 in units of this many per metre, which is
#: 0.06 mm and finer than the robot repeats.
UNIT = 16000


def quat_of(el, key="quat"):
    q = el.get(key)
    if q:
        w, x, y, z = (float(v) for v in q.split())
        return [w, x, y, z]
    e = el.get("euler")
    if e:
        # MJCF's default eulerseq is xyz intrinsic.
        rx, ry, rz = (float(v) for v in e.split())
        cx, sx = np.cos(rx / 2), np.sin(rx / 2)
        cy, sy = np.cos(ry / 2), np.sin(ry / 2)
        cz, sz = np.cos(rz / 2), np.sin(rz / 2)
        return [cx * cy * cz - sx * sy * sz, sx * cy * cz + cx * sy * sz,
                cx * sy * cz - sx * cy * sz, cx * cy * sz + sx * sy * cz]
    return [1.0, 0.0, 0.0, 0.0]


def vec_of(el, key="pos", default=(0.0, 0.0, 0.0)):
    v = el.get(key)
    return [float(x) for x in v.split()] if v else list(default)


def quat_matrix(q):
    w, x, y, z = q
    return np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
        [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
        [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)],
    ])


#: How hard the quadric decimator is allowed to push. The library's default
#: is 7 and it is the wrong default for these meshes: on the pelvis contour
#: casting -- 35,741 triangles, not watertight, two shells -- agg 7 reaches
#: its floor of 8,588 triangles having thrown away 22 per cent of the surface
#: area, while agg 3 reaches the same 8,646 keeping 98.7 per cent. Swept over
#: all thirty-five meshes: agg 3 hits its target on thirty-four of them, the
#: same thirty-four agg 7 hits, and the worst part keeps 98.7 per cent of its
#: area rather than 77.6. Below that it stops reaching targets at all -- at
#: agg 1 every part overshoots and the robot comes to 146,000 triangles.
AGG = 3.0


def decimate(mesh, target, weld, agg=AGG):
    """Weld coincident vertices, drop degenerate faces, then decimate."""
    m = mesh.copy()
    m.merge_vertices(merge_tex=True, merge_norm=True, digits_vertex=weld)
    m.update_faces(m.nondegenerate_faces())
    m.remove_unreferenced_vertices()
    if len(m.faces) <= target or len(m.faces) < 8:
        return m
    v, f = fast_simplification.simplify(
        np.asarray(m.vertices, dtype=np.float32),
        np.asarray(m.faces, dtype=np.int32), target_count=target, agg=agg)
    return trimesh.Trimesh(vertices=v, faces=f, process=False)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True,
                    help="directory holding g1.xml and assets/")
    ap.add_argument("--weld", type=int, default=5,
                    help="decimal places the weld rounds vertices to")
    ap.add_argument("--keep", type=float, default=KEEP,
                    help="fraction of the source tessellation to survive")
    ap.add_argument("--floor", type=float, default=FLOOR,
                    help="triangles per cm2 no part may fall below")
    ap.add_argument("--cap", type=float, default=CAP,
                    help="triangles per cm2 no part may exceed")
    ap.add_argument("--min-faces", type=int, default=MIN_FACES)
    ap.add_argument("--agg", type=float, default=AGG,
                    help="how hard the quadric decimator may push")
    ap.add_argument("--out", default=str(OUT))
    a = ap.parse_args()

    src = pathlib.Path(a.src)
    root = ET.parse(src / "g1.xml").getroot()

    # asset name -> file, and the material colours the MJCF names.
    files, colours = {}, {}
    for m in root.iter("mesh"):
        f = m.get("file")
        if not f:
            continue
        # MJCF lets a mesh omit its name, in which case MuJoCo derives it from
        # the file stem -- which is what this model does for all thirty-five.
        files[m.get("name") or pathlib.PurePath(f).stem] = f
    for m in root.iter("material"):
        rgba = m.get("rgba")
        if m.get("name") and rgba:
            colours[m.get("name")] = [float(v) for v in rgba.split()][:3]

    links, order = [], []

    def walk(body, parent):
        idx = len(links)
        joint = body.find("joint")
        rec = {
            "name": body.get("name"),
            "parent": parent,
            "pos": vec_of(body),
            "quat": quat_of(body),
            "joint": None if joint is None else {
                "name": joint.get("name"),
                "axis": vec_of(joint, "axis", (0, 0, 1)),
                "range": [float(v) for v in (joint.get("range") or "-3.15 3.15").split()],
            },
            "parts": [],
        }
        links.append(rec)
        order.append(body)
        for g in body.findall("geom"):
            # Visual geoms only: the collision copies are the same shape at a
            # lower fidelity and drawing both doubles the cost for nothing.
            if g.get("class") == "collision" or not g.get("mesh"):
                continue
            name = g.get("mesh")
            fname = files.get(name)
            path = (src / "assets" / fname) if fname else None
            if path is None or not path.is_file():
                print(f"  missing {name}", file=sys.stderr)
                continue
            mesh = trimesh.load(path, force="mesh")
            T = np.eye(4)
            T[:3, :3] = quat_matrix(quat_of(g))
            T[:3, 3] = vec_of(g)
            mesh.apply_transform(T)
            m = decimate(mesh, budget_for(mesh, a.keep, a.floor, a.cap,
                                          a.min_faces), a.weld, a.agg)
            mat = g.get("material") or "metal"
            rgb = colours.get(mat, [0.7, 0.72, 0.74])
            v = np.round(np.asarray(m.vertices) * UNIT).astype(np.int32)
            rec["parts"].append({
                "v": v.reshape(-1).tolist(),
                "f": np.asarray(m.faces, dtype=np.int32).reshape(-1).tolist(),
                "c": [int(round(c * 255)) for c in rgb],
            })
        for child in body.findall("body"):
            walk(child, idx)

    wb = root.find("worldbody")
    for b in wb.findall("body"):
        walk(b, -1)

    tris = sum(len(p["f"]) // 3 for l in links for p in l["parts"])
    out = {
        "unit": 1.0 / UNIT,
        "source": "mujoco_menagerie/unitree_g1, Unitree's own visual meshes",
        "links": links,
    }
    path = pathlib.Path(a.out)
    path.write_text(json.dumps(out, separators=(",", ":")))
    kb = path.stat().st_size / 1024
    print(f"wrote {path.relative_to(ROOT)}  {kb:.0f} KB  "
          f"{len(links)} links, {tris} triangles")

    # The density spread, printed because it is the number this budget exists
    # to control and a regression in it would otherwise be silent.
    rows = []
    for l in links:
        for i, p in enumerate(l["parts"]):
            v = np.asarray(p["v"], dtype=np.float64).reshape(-1, 3) / UNIT
            f = np.asarray(p["f"], dtype=np.int64).reshape(-1, 3)
            if len(f) < 4:
                continue
            cm2 = trimesh.Trimesh(vertices=v, faces=f, process=False).area * 1e4
            if cm2 > 0:
                rows.append((len(f) / cm2, len(f), cm2, f"{l['name']}[{i}]"))
    rows.sort()
    d = np.array([r[0] for r in rows])
    print(f"  tri/cm2  min {d.min():.2f}  median {np.median(d):.2f}  "
          f"max {d.max():.2f}  spread {d.max() / d.min():.1f}x")
    for r in rows[:2] + rows[-2:]:
        print(f"    {r[0]:6.2f}  {r[1]:>6} tri {r[2]:8.1f} cm2  {r[3]}")


if __name__ == "__main__":
    main()
