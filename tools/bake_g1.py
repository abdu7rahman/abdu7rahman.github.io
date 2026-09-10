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

#: Triangles per link after the weld. The G1's hands alone are twelve
#: megabytes of STL and read, at the size a guide is ever seen, as a mitten;
#: the pelvis and torso carry the silhouette and get the budget.
BUDGET = {"default": 420, "torso_link": 1400, "pelvis": 900,
          "left_rubber_hand": 260, "right_rubber_hand": 260}

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


def decimate(mesh, target, weld):
    """Weld coincident vertices, drop degenerate faces, then decimate."""
    m = mesh.copy()
    m.merge_vertices(merge_tex=True, merge_norm=True, digits_vertex=weld)
    m.update_faces(m.nondegenerate_faces())
    m.remove_unreferenced_vertices()
    if len(m.faces) <= target or len(m.faces) < 8:
        return m
    ratio = 1.0 - target / len(m.faces)
    v, f = fast_simplification.simplify(
        np.asarray(m.vertices, dtype=np.float32),
        np.asarray(m.faces, dtype=np.int32), ratio)
    return trimesh.Trimesh(vertices=v, faces=f, process=False)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True,
                    help="directory holding g1.xml and assets/")
    ap.add_argument("--weld", type=int, default=5,
                    help="decimal places the weld rounds vertices to")
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
            budget = BUDGET.get(body.get("name"), BUDGET["default"])
            budget = BUDGET.get(name, budget)
            m = decimate(mesh, budget, a.weld)
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


if __name__ == "__main__":
    main()
