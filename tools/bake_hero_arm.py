#!/usr/bin/env python3
"""Bake the hero's robot motion: the link transforms, one set per frame.

`assets/ur12e.json` stores each link's triangles in that link's own frame. To
move the arm the page needs the transform for every link at every instant, and
there are only two ways to get them: ship the forward kinematics to the
browser and recompute what is already known, or compute them once here.

This does the second. The output is small -- ten 3x4 matrices per frame, which
is four numbers short of a 4x4 because the bottom row of a rigid transform is
never anything but (0,0,0,1) -- and it means index.html carries no solver, no
URDF origins and no tool transform. It multiplies vertices by matrices it was
handed.

The trajectory is joint-space and deliberately so. Driving it from Cartesian
waypoints would put an IK solve between the pose and the picture, and an IK
solve that fails or flips its elbow halfway is a broken hero rather than a
broken plan. These are camera decisions: the arm has to stay legible in
silhouette from one fixed viewpoint for the whole move.

    python3 tools/bake_hero_arm.py --repo /path/to/reactive-replanning-ur12e

Writes assets/hero-motion.json.
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
OUT = ROOT / "assets" / "hero-motion.json"

#: The move, as (joint angles, gripper opening in metres). Held poses at the
#: ends so the arm settles rather than stopping dead at the top and bottom of
#: the page.
KEYS = [
    ((0.52, -1.02, 1.30, -1.86, -1.57, 0.00), 0.000),
    ((0.30, -1.28, 1.66, -1.94, -1.57, 0.15), 0.020),
    ((-0.16, -1.16, 1.32, -1.70, -1.57, 0.30), 0.024),
    ((-0.34, -0.86, 0.98, -1.68, -1.57, 0.10), 0.006),
    ((-0.05, -1.10, 1.42, -1.88, -1.57, -0.10), 0.000),
]
#: How many frames the keys are resampled to. The page lerps between whichever
#: two it lands between, so this only has to be dense enough that the lerp is
#: never asked to cross a large angle.
FRAMES = 48


def smoothstep(t: float) -> float:
    return t * t * (3.0 - 2.0 * t)


def sample(i: int, n: int):
    """Key-to-key with an eased blend, so no joint changes speed abruptly."""
    u = (i / (n - 1)) * (len(KEYS) - 1)
    k = min(int(u), len(KEYS) - 2)
    t = smoothstep(u - k)
    q0, g0 = KEYS[k]
    q1, g1 = KEYS[k + 1]
    q = [a + (b - a) * t for a, b in zip(q0, q1)]
    return q, g0 + (g1 - g0) * t


def link_transforms(ur12e, q, grip):
    """The ten 4x4s, in the order `assets/ur12e.json` lists its links.

    base_link_inertia is the identity: it is the frame the FK starts from.
    tool0 is the wrist carried through the flange and tool0 rotations but
    *not* through TCP_OFFSET_Z -- the gripper meshes were baked from z=0 in
    that frame, and adding the tool centre offset would drive the whole
    gripper a further 0.157 m down its own axis.
    """
    frames = ur12e.link_frames(q)          # shoulder .. wrist_3, six of them
    flange = np.eye(4)
    flange[:3, :3] = ur12e.rpy(*ur12e._FLANGE_RPY) @ ur12e.rpy(*ur12e._TOOL0_RPY)
    tool0 = frames[-1] @ flange

    out = [np.eye(4)] + [f.copy() for f in frames] + [tool0.copy()]
    # Both fingers are baked closed in tool0 and slide along its x; the right
    # one already carries its half turn from tools/bake_arm.py, so both open
    # in the positive direction of their own frame.
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

    frames = []
    tool_pts = []
    for i in range(FRAMES):
        q, grip = sample(i, FRAMES)
        T = link_transforms(ur12e, q, grip)
        flat = []
        for M in T:
            flat.extend(round(float(x), 5) for x in np.asarray(M)[:3, :4].reshape(-1))
        frames.append(flat)
        # Where the gripper is, so the page can put a light there without
        # needing to know which link is the tool.
        tool_pts.append([round(float(x), 5) for x in np.asarray(T[7])[:3, 3]])

    OUT.write_text(json.dumps({
        "frames": FRAMES,
        "links": 10,
        "note": ("Ten 3x4 row-major link transforms per frame, in the order "
                 "assets/ur12e.json lists its links; the omitted bottom row is "
                 "(0,0,0,1). `tool` is the gripper origin per frame. Computed by "
                 "predictive_replanning.ur12e. Regenerate with "
                 "tools/bake_hero_arm.py."),
        "tool": tool_pts,
        "T": frames,
    }, separators=(",", ":")))
    kb = OUT.stat().st_size / 1024
    print(f"wrote assets/hero-motion.json  {FRAMES} frames, {kb:.0f} KiB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
