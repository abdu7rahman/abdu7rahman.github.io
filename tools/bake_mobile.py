#!/usr/bin/env python3
"""Bake the TurtleBot3 and Go2 visual meshes into the format bake_arm.py writes.

Three cells in the lab -- drive, race and cost -- were standing a UR12e in
place of a TurtleBot and a Go2, which `Rig.jsx` admitted to in a comment
because there was nothing else to be done about it without these two files.
This is the something else.

Everything that matters is borrowed. `bake_arm` already welds, de-slivers,
decimates to a triangle budget, quantises to int16 and splits a link's budget
across its materials by area weighted by curvature, and every one of those
decisions is written down in that file with the measurement that settled it.
Reimplementing any of it here would produce a second set of constants that
could disagree with the first, so this module imports them and only supplies
what is genuinely different about a mobile base and a quadruped:

  * The TurtleBot meshes are STL, in millimetres, and carry no material at
    all. So they are scaled to metres on load and painted from the `material`
    each `<visual>` names in `turtlebot3_burger.urdf` -- the vendor's own
    numbers, just kept in the URDF rather than in the mesh.
  * The Go2's four legs reuse six meshes between them: one hip flipped four
    ways, a thigh and its mirror, a calf and its mirror, one foot. Baking per
    link would put the hip in the file four times. So the Go2's `links` are
    named for the *mesh* rather than for a robot link, and Go2.jsx instantiates
    each one where the URDF's joint tree puts it. Same schema, different thing
    in the `name` field, which the asset's `note` says out loud.

What produced the two assets in this repository, and what came out:

    tools/bake_mobile.py --robot turtlebot3 --src <turtlebot3 checkout> \
        --budget 9000 --out assets/turtlebot3.json
        -> 15542 triangles, 309 KiB
    tools/bake_mobile.py --robot go2 --src <unitree_ros checkout> \
        --budget 20000 --out assets/go2.json
        -> 19678 triangles, 372 KiB

Both budgets were chosen by measuring rather than by eye. Deviation is the
mean distance from a point sampled on the decimated surface back to the
source, over 40000 samples. The Go2's shell has a knee and the Burger's does
not, and the budgets sit on opposite sides of that fact:

    go2 base shell   2500 tris  6.43 mm | 4500  1.80 | 6800  1.26 | 10000  1.10
    burger base      5220 tris  1.54 mm | 7540  1.42 | 11300  1.53(whole mesh)

6800 is where the Go2 stops improving; past it, 47% more triangles buy
0.16 mm. The Burger has no such point -- so it gets the smaller number, and
the 57 KiB that 7540 would have cost buys 0.12 mm on a robot 203 mm tall.

The sentence that used to sit in that last paragraph -- that the Burger is
flat plate and flat plate holds its shape at any count -- was wrong, and a
mean was what hid it. Rendered close up the Burger's decks come out torn:
spikes along the rims, holes through the plate, standoffs ending in nothing.
Measured against the source, which is watertight with no open edge anywhere:

    burger base   5220 tris   579 open edges   84.1% of the source area
                  9000       640               88.3
                 20000       678               94.1

So a fifth of the deck is simply gone, and more budget does not close the
tears -- it opens more of them, because they are not the decimator's doing.
They come from `bake_arm._cluster`, the half-millimetre lattice that exists to
de-sliver COLLADA: half the triangles in a UR link are slivers and it cannot
be decimated without one, but only 4.6 per cent of this STL's are, and snapping
a clean 96524-triangle tessellation onto a lattice a quarter the thickness of
its own plate drops triangles that were holding the surface together. At a
tenth of a millimetre the tears roughly halve, to 310.

Neither asset is re-baked for it, and that is a measurement too rather than a
shrug. In the cells that draw them -- the Burger in search, drive and race,
the Go2 in cost -- the camera stands where `standFor` puts a visitor, and at
1440x900 the Burger comes out 20 pixels tall and the Go2 15. A torn rim on a
203 mm robot drawn 20 pixels high is well under a pixel, and re-baking to fix
it would cost bandwidth to change nothing anybody sees. It is written down
here so that the first person to put a close camera on one of these knows
what they are looking at and where the fix goes: `bake_arm.WELD`, lowered for
sources that are not full of slivers, and then a budget the tears can survive.

Both licences were read before anything was vendored. TurtleBot3 is Apache-2.0
(`LICENSE` at the repository root, and `<license>Apache 2.0</license>` in
`turtlebot3_description/package.xml`). unitree_ros is BSD 3-Clause, copyright
2016-2022 HangZhou YuShu TECHNOLOGY CO.,LTD. Both permit redistribution; the
BSD text requires the copyright notice to travel with the bytes, so it is
copied into the asset's `sources` block rather than left in a checkout nobody
ships.

Same dependencies as bake_arm: numpy, trimesh, fast-simplification.
"""
import argparse
import json
import pathlib
import subprocess
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import bake_arm as ba

__author__ = "".join(
    chr(c - 7) for c in (104, 105, 107, 124, 115, 39, 121, 104, 111, 116, 104, 117)
)

ROOT = pathlib.Path(__file__).resolve().parent.parent

#: Millimetres to metres. Every `<mesh>` in turtlebot3_burger.urdf carries
#: scale="0.001 0.001 0.001"; the STL files are modelled in millimetres and
#: the bounds confirm it -- burger_base.stl spans 137.5 mm in x, against the
#: 140 mm collision box the same URDF gives that link.
STL_SCALE = 1e-3

#: What each `<visual>` in turtlebot3_burger.urdf names, resolved through the
#: `<material>` blocks at the top of that same file. STL carries no colour, so
#: without this every part comes out of `bake_arm._colour` as its 128 grey
#: fallback and the robot is one flat tone. These are the vendor's numbers:
#: light_black is rgba 0.4 0.4 0.4, dark is 0.3 0.3 0.3.
TB3_MATERIAL = {"light_black": [102, 102, 102], "dark": [76, 76, 76]}

#: link name -> (mesh path, material name, visual origin xyz, visual origin rpy,
#: share of the budget). Every geometric number is read straight off
#: turtlebot3_burger.urdf; nothing here is measured by this script.
#:
#: The share is not the raw triangle split. burger_base.stl is 96524 of the
#: 154434 triangles in the set, but two thirds of those are threads on M3
#: standoffs and the chamfers on laser-cut plate, none of which survives a
#: 0.1 mm quantisation at this size. The tyres and the scanner are the round
#: things, and roundness is the only thing a triangle budget actually buys.
TB3 = {
    "base_link": ("meshes/bases/burger_base.stl", "light_black",
                  (-0.032, 0.0, 0.0), (0.0, 0.0, 0.0), 0.58),
    "wheel_left_link": ("meshes/wheels/left_tire.stl", "dark",
                        (0.0, 0.0, 0.0), (1.57, 0.0, 0.0), 0.15),
    "wheel_right_link": ("meshes/wheels/right_tire.stl", "dark",
                         (0.0, 0.0, 0.0), (1.57, 0.0, 0.0), 0.15),
    "base_scan": ("meshes/sensors/lds.stl", "dark",
                  (0.0, 0.0, 0.0), (0.0, 0.0, 0.0), 0.12),
}

#: mesh name -> (path, share). The Go2's `<visual>` origins are all the
#: identity except for three hips, which the URDF flips by rpy rather than by
#: shipping a second mesh -- FR is rpy="3.1415 0 0", RL is "0 3.1415 0", RR is
#: "3.1415 3.1415 0". Those belong to the leg, not to the geometry, so they
#: stay in Go2.jsx and every mesh here is baked exactly as it was modelled.
#:
#: The base gets the largest share because it is the largest single object and
#: the only one not repeated; the hip, drawn four times, gets the next. The
#: foot is a 40 mm rubber ball and holds its shape at almost nothing.
GO2 = {
    "base": ("meshes/base.dae", 0.40),
    "hip": ("meshes/hip.dae", 0.15),
    "thigh": ("meshes/thigh.dae", 0.125),
    "thigh_mirror": ("meshes/thigh_mirror.dae", 0.125),
    "calf": ("meshes/calf.dae", 0.075),
    "calf_mirror": ("meshes/calf_mirror.dae", 0.075),
    "foot": ("meshes/foot.dae", 0.05),
}

GO2_PKG = "robots/go2_description"

#: Copied out of unitree_ros/LICENSE, because BSD 3-Clause requires the notice
#: to be reproduced by anything that redistributes the material and a checkout
#: in somebody's scratch directory does not travel with assets/go2.json.
GO2_COPYRIGHT = ("Copyright (c) 2016-2022 HangZhou YuShu TECHNOLOGY CO.,LTD. "
                 "(\"Unitree Robotics\"). All rights reserved. Redistributed "
                 "under the BSD 3-Clause License; see the LICENSE file in "
                 "unitreerobotics/unitree_ros at the commit named here.")


def _head(repo):
    """The source checkout's commit, when there is one.

    A checkout is the usual way these meshes arrive and its commit is the
    tidiest thing to name. It is not the thing that identifies them, though:
    `ba.CONSUMED` carries a sha256 of every file actually read, which pins the
    exact bytes this asset was built from, where a branch tip moves. So when
    the sources were fetched by file rather than cloned -- github.com's commit
    metadata is not always reachable where raw file content is -- this says so
    instead of refusing to bake.
    """
    try:
        return subprocess.run(["git", "-C", str(repo), "rev-parse", "HEAD"],
                              capture_output=True, text=True,
                              check=True).stdout.strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        return "not a checkout; see sha256 below for what was read"


def _paint(groups, rgb):
    """Force one colour onto everything `bake_arm._group` handed back.

    Only used on the STL side. An STL is a single unmaterialled body, so
    `_group` always returns exactly one colour group and this replaces the
    128-grey fallback with what the URDF says. Asserting the count rather than
    looping quietly is deliberate: if a future TurtleBot mesh arrives with two
    bodies in it, this should stop rather than paint them the same.
    """
    assert len(groups) == 1, f"expected one colour group from an STL, got {len(groups)}"
    return [(list(rgb), groups[0][1])]


def bake_turtlebot3(src, budget):
    pkg = src / "turtlebot3_description"
    if not pkg.is_dir():
        raise SystemExit(f"{pkg} is missing; this wants a turtlebot3 checkout")
    links, tris = [], 0
    for name, (path, mat, xyz, rpy, share) in TB3.items():
        parts = ba._parts(("turtlebot3_description", pkg), path)
        for m in parts:
            m.apply_scale(STL_SCALE)             # mm -> m, before the weld
        T = ba._xform(*xyz, *rpy)
        baked = []
        # split=True: four 2 mm laser-cut plates on M3 standoffs is the exact
        # assembly a whole-mesh quadric collapse ruins. bake_arm._split_decimate
        # carries the measurement.
        groups = ba._group(parts, budget * share, split=True)
        for colour, m in _paint(groups, TB3_MATERIAL[mat]):
            v, f = ba._bake(m, T)
            baked.append({"c": colour, "v": v, "f": f})
            tris += len(f) // 3
        links.append({"name": name, "parts": baked})
    return links, tris


def bake_go2(src, budget):
    pkg = src / GO2_PKG
    if not pkg.is_dir():
        raise SystemExit(f"{pkg} is missing; this wants a unitree_ros checkout")
    links, tris = [], 0
    for name, (path, share) in GO2.items():
        parts = ba._parts(("go2_description", pkg), path)
        baked = []
        for colour, m in ba._group(parts, budget * share):
            v, f = ba._bake(m, ba._xform(0, 0, 0, 0, 0, 0))
            baked.append({"c": colour, "v": v, "f": f})
            tris += len(f) // 3
        links.append({"name": name, "parts": baked})
    return links, tris


TB3_NOTE = (
    "TurtleBot3 Burger visual meshes, decimated. Vertices are int16 multiples "
    "of `unit` metres in the named URDF link frame, already carrying the "
    "<visual> origin from turtlebot3_burger.urdf, so a page applies only the "
    "joint transforms; `f` indexes them in threes. The source STL is "
    "millimetres and carries no material, so it is scaled by the URDF's own "
    "0.001 and painted from the <material> each <visual> names: light_black "
    "(0.4 0.4 0.4) for the base, dark (0.3 0.3 0.3) for the tyres and the "
    "scanner. Burger rather than Waffle because the Waffle base is 16.3 MB "
    "against the Burger's 4.8 MB for the same silhouette at this size."
)

GO2_NOTE = (
    "Unitree Go2 visual meshes, decimated. `name` is the mesh, not a robot "
    "link: the four legs share one hip (flipped by the <visual> rpy the URDF "
    "gives FR, RL and RR), a thigh and its mirror, a calf and its mirror, and "
    "one foot, so baking per link would put the same triangles in this file "
    "four times. Every <visual> origin in go2_description.urdf is the identity "
    "apart from those hip flips, so the vertices are the vendor's own, "
    "quantised to int16 multiples of `unit` metres and nothing else; `f` "
    "indexes them in threes. Colours are read out of the COLLADA effects, "
    "which is where Unitree put them."
)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--robot", required=True, choices=("turtlebot3", "go2"))
    ap.add_argument("--src", required=True, type=pathlib.Path,
                    help="checkout of ROBOTIS-GIT/turtlebot3 or unitreerobotics/unitree_ros")
    ap.add_argument("--budget", type=int, required=True,
                    help="triangles across the whole robot; the decimator "
                         "honours it loosely, so read the printed total")
    ap.add_argument("--weld", type=float, default=ba.HERO_WELD,
                    help="vertex snap lattice in metres before decimating")
    ap.add_argument("--out", type=pathlib.Path, required=True)
    args = ap.parse_args()
    # _decimate reads this as a module global in bake_arm, the same way
    # bake_arm's own main() sets it.
    ba.WELD = args.weld

    src = args.src.resolve()
    if args.robot == "turtlebot3":
        links, tris = bake_turtlebot3(src, args.budget)
        key, note = "turtlebot3_description", TB3_NOTE
        source = {
            "url": "https://github.com/ROBOTIS-GIT/turtlebot3.git",
            "commit": _head(src),
            "licence": "Apache-2.0 (LICENSE at the repository root; "
                       "turtlebot3_description/package.xml agrees)",
            "sha256": ba.CONSUMED[key],
        }
    else:
        links, tris = bake_go2(src, args.budget)
        key, note = "go2_description", GO2_NOTE
        source = {
            "url": "https://github.com/unitreerobotics/unitree_ros.git",
            "commit": _head(src),
            "licence": "BSD-3-Clause (LICENSE at the repository root)",
            "copyright": GO2_COPYRIGHT,
            "sha256": ba.CONSUMED[key],
        }

    doc = {
        "unit": ba.UNIT,
        "triangles": tris,
        "note": note,
        "sources": {key: source},
        "links": links,
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(doc, separators=(",", ":")))
    size = args.out.stat().st_size
    try:
        shown = args.out.relative_to(ROOT)
    except ValueError:
        shown = args.out
    print(f"{shown}  {tris} triangles  {size / 1024:.0f} KiB")
    for lk in links:
        print("  %-18s %s" % (lk["name"], "  ".join(
            "%s x%d" % ("#%02x%02x%02x" % tuple(p["c"]), len(p["f"]) // 3)
            for p in lk["parts"])))


if __name__ == "__main__":
    main()
