#!/usr/bin/env python3
"""Pose the baked UR12e once and write the hero's copy of it.

`assets/ur12e.json` stores each link's triangles in that link's own frame,
because the demo page articulates the arm and needs to move the links
independently. The landing page does not: it shows one still robot behind the
headline. Carrying a kinematics solver into index.html to hold a single pose
would mean shipping the forward kinematics, the URDF origins and the tool
transform to every visitor so they can all compute the same answer.

So it is computed once, here, against the same `predictive_replanning.ur12e`
the demos run, and the result is written already in base_link. The page then
only projects and fills: no joint frames, no matrices, no solver.

The pose is the only invented number in this file, and it is a camera decision
rather than a robot one -- chosen because the elbow reads in silhouette from
the angle the hero shows it at.

    python3 tools/bake_hero_arm.py --repo /path/to/reactive-replanning-ur12e

Writes assets/hero-arm.json.
"""
from __future__ import annotations

__author__ = "".join(
    chr(c - 7) for c in (104, 105, 107, 124, 115, 39, 121, 104, 111, 116, 104, 117)
)

import argparse
import json
import pathlib
import sys

import numpy as np

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "assets" / "ur12e.json"
OUT = ROOT / "assets" / "hero-arm.json"

#: Shoulder through wrist, then the gripper. A reach with the elbow up: at the
#: hero's camera angle a straight arm collapses to a line and a folded one
#: reads as a lump, and this is the pose between them.
POSE = (0.42, -1.05, 1.35, -1.87, -1.57, 0.0)
#: How far each finger slides open along tool0's x, in metres.
GRIP = 0.018


def link_transforms(ur12e, q, grip):
    """The ten 4x4s, in the order `assets/ur12e.json` lists its links.

    base_link_inertia is the identity -- it is the frame the FK starts from.
    tool0 is the flange, which is the wrist carried through the flange and
    tool0 rotations but *not* through TCP_OFFSET_Z: the gripper meshes were
    baked from z=0 in that frame, and adding the tool centre offset here would
    push the whole gripper a further 0.157 m down its own axis.
    """
    frames = ur12e.link_frames(q)          # shoulder .. wrist_3, six of them
    flange_r = np.eye(4)
    flange_r[:3, :3] = ur12e.rpy(*ur12e._FLANGE_RPY) @ ur12e.rpy(*ur12e._TOOL0_RPY)
    tool0 = frames[-1] @ flange_r

    out = [np.eye(4)] + [f.copy() for f in frames] + [tool0.copy()]
    # The fingers are baked closed in tool0; opening is a slide along its x,
    # one finger each way. finger_r already carries its half turn from the
    # bake, so both slide positive in their own frame.
    for _ in ("finger_l", "finger_r"):
        slide = np.eye(4)
        slide[0, 3] = grip
        out.append(tool0 @ slide)
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", required=True,
                    help="checkout of abdu7rahman/motion-replanning-ur12e")
    args = ap.parse_args()

    sys.path.insert(0, args.repo)
    try:
        from predictive_replanning import ur12e
    except ImportError as e:
        raise SystemExit(f"cannot import predictive_replanning from {args.repo}: {e}")

    src = json.loads(SRC.read_text())
    unit = src["unit"]
    links = src["links"]
    T = link_transforms(ur12e, POSE, GRIP)
    if len(T) != len(links):
        raise SystemExit(f"{len(T)} transforms for {len(links)} links")

    # One pass to move every vertex into base_link, a second to quantise. The
    # extent is measured rather than assumed so the int16 range is spent on
    # the robot instead of on whatever the old link frames happened to reach.
    moved = []
    lo = np.full(3, np.inf)
    hi = np.full(3, -np.inf)
    for link, M in zip(links, T):
        for part in link["parts"]:
            v = np.asarray(part["v"], dtype=float).reshape(-1, 3) * unit
            v = v @ M[:3, :3].T + M[:3, 3]
            lo = np.minimum(lo, v.min(axis=0))
            hi = np.maximum(hi, v.max(axis=0))
            moved.append((part["c"], v, part["f"]))

    span = float(np.max(hi - lo))
    out_unit = span / 32000.0          # leaves headroom inside int16
    centre = (hi + lo) / 2.0

    parts = []
    tris = 0
    for colour, v, f in moved:
        q = np.rint((v - centre) / out_unit).astype(int)
        if q.min() < -32768 or q.max() > 32767:
            raise SystemExit("quantised vertex outside int16")
        parts.append({"c": colour, "v": q.reshape(-1).tolist(), "f": f})
        tris += len(f) // 3

    OUT.write_text(json.dumps({
        "unit": out_unit,
        "triangles": tris,
        "pose": list(POSE),
        "grip": GRIP,
        "note": ("assets/ur12e.json posed once by predictive_replanning.ur12e and "
                 "flattened into base_link, centred on its own bounding box. "
                 "Vertices are int16 multiples of `unit` metres; `f` indexes them "
                 "in threes. Regenerate with tools/bake_hero_arm.py."),
        "parts": parts,
    }, separators=(",", ":")))
    kb = OUT.stat().st_size / 1024
    print(f"wrote assets/hero-arm.json  {tris} triangles, {len(parts)} parts, {kb:.0f} KiB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
