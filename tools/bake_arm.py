#!/usr/bin/env python3
"""Bake the vendor UR12e and Hand-E visual meshes into one asset the page draws.

The predictive-replanning demo used to draw the arm as a polyline through the
joint origins. That is the skeleton the planner reasons about, not the robot,
and it reads as a stick figure. This script produces the robot: the same
COLLADA files `Universal_Robots_ROS2_Description` and `robotiq_hande_description`
ship, placed by the same `visual_parameters.yaml` offsets the URDF uses,
decimated to something a browser can redraw sixty times a second.

Nothing is modelled here. The only new numbers are the triangle budget and the
quantisation step; every vertex is the vendor's, moved by the vendor's offset.

Two facts the description package settles, which are why a UR12e is drawn from
`meshes/ur10e/`: `config/ur12e/default_kinematics.yaml` is byte-identical to
`ur10e`, and `config/ur12e/visual_parameters.yaml` names `meshes/ur10e/...` for
every link. There is no `meshes/ur12e/` directory at all.

Materials are kept apart rather than merged. One UR link carries up to four --
LinkGrey, JointGrey, Black and URBlue -- and painting the link one flat colour
throws away the arm's actual appearance. The RGB comes out of the file.

Run it against a checkout of the replanning repo that has its `third_party/`
submodules present and its venv on the path:

    /path/to/reactive-replanning-ur12e/.venv/bin/python tools/bake_arm.py \
        --src /path/to/reactive-replanning-ur12e

Requires numpy, trimesh and fast-simplification, which is why it runs out of
that venv rather than this repo -- the site has no Python runtime of its own.
"""
import argparse
import hashlib
import json
import pathlib
import subprocess
import sys

__author__ = "".join(
    chr(c - 7) for c in (104, 105, 107, 124, 115, 39, 121, 104, 111, 116, 104, 117)
)

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "ur12e.json"

#: int16 units per metre. 0.1 mm resolution over a +-3.2 m range; the largest
#: link-local coordinate on this arm is 0.67 m, so nothing clips.
UNIT = 1e-4

#: Triangles asked for across the whole robot; the decimator stalls on some
#: parts, so the bake comes out somewhat above it. Painter's algorithm in a 2D
#: canvas costs a fill per visible triangle and roughly half survive backface
#: culling, so this is about 4500 fills a frame. Measured in headless Chromium,
#: which rasterises in software and is therefore the pessimistic case: 4000
#: filled triangles take 1.7 ms, 8000 take 3.6 ms. That leaves the frame to
#: Pyodide, where the actual work is.
BUDGET = 10000

#: The hero on index.html renders the same robot on the GPU with a depth
#: buffer, where the reasoning above does not apply at all: there is no fill
#: per triangle to pay and twice the geometry costs nothing measurable. At
#: 10000 its joint caps came out as cut gems -- a silhouette no amount of
#: normal smoothing can round -- so it gets its own bake, from the same pinned
#: meshes through the same pipeline:
#:
#:   python3 tools/bake_arm.py --src <checkout> --budget 26000 \
#:                             --out assets/ur12e-hero.json
#:
#: 20751 triangles, 138 KiB gzipped. The decimator stalls at about 31600 no
#: matter how high the budget goes, which is the source meshes' own ceiling
#: after the 0.5 mm weld; 26000 is where the caps stop reading as faceted and
#: the file is still worth its bytes. hero-arm.js does not fetch it below
#: 901px, where landing.css hides the robot outright.
HERO_BUDGET = 26000

#: How that is split. The links a viewer reads as "the arm" get the triangles;
#: the base is half-hidden by the shoulder and the coupler is 17 mm tall.
SHARE = {
    "base": 0.06, "shoulder": 0.15, "upper_arm": 0.20, "forearm": 0.20,
    "wrist_1": 0.11, "wrist_2": 0.11, "wrist_3": 0.03,
    "io_coupler": 0.01, "hande": 0.09, "finger": 0.04,
}

#: A part below this many triangles is passed through untouched. Decimating a
#: 24-triangle ring does not save anything worth the shape it costs.
FLOOR = 24

#: Lattice the vertices are snapped to before decimating, in metres. Half a
#: millimetre is below what the drawing can resolve -- the arm is about a metre
#: across a canvas some hundreds of pixels wide -- and it is what makes the
#: decimator work at all. See `_cluster`.
WELD = 5e-4


def _rpy(roll, pitch, yaw):
    import numpy as np
    cr, sr = np.cos(roll), np.sin(roll)
    cp, sp = np.cos(pitch), np.sin(pitch)
    cy, sy = np.cos(yaw), np.sin(yaw)
    return np.array([
        [cy * cp, cy * sp * sr - sy * cr, cy * sp * cr + sy * sr],
        [sy * cp, sy * sp * sr + cy * cr, sy * sp * cr - cy * sr],
        [-sp,     cp * sr,                cp * cr],
    ])


def _xform(x, y, z, roll, pitch, yaw):
    import numpy as np
    T = np.eye(4)
    T[:3, :3] = _rpy(roll, pitch, yaw)
    T[:3, 3] = (x, y, z)
    return T


#: Filled as files are read: {"ur_description": {"meshes/...dae": sha256}}.
CONSUMED: dict = {}


def _parts(repo, path):
    """Every geometry in a COLLADA file, with its scene transform applied.

    trimesh's `dump` walks the scene graph, which matters: the UR files carry
    node transforms, and reading the raw vertex arrays puts the shoulder in the
    wrong place with no error to say so.

    Each file is hashed on the way through, so the asset can name the bytes it
    was made from and not just the commit they came from.
    """
    import trimesh
    full = repo[1] / path
    CONSUMED.setdefault(repo[0], {})[str(path)] = hashlib.sha256(full.read_bytes()).hexdigest()
    scene = trimesh.load(str(full))
    return scene.dump(concatenate=False) if hasattr(scene, "dump") else [scene]


def _colour(mesh):
    mat = getattr(mesh.visual, "material", None)
    for attr in ("baseColorFactor", "diffuse", "main_color"):
        c = getattr(mat, attr, None)
        if c is not None:
            return [int(v) for v in c[:3]]
    return [128, 128, 128]


def _cluster(v, f, h):
    """Vertex clustering on an `h`-metre lattice, degenerates dropped.

    This is here because quadric decimation alone could not touch these files.
    Over half the triangles in a UR link are slivers -- 1969 of the upper arm's
    3860 black faces have a longest edge more than fifty times their own
    altitude -- and an edge collapse next to a sliver flips a normal, which the
    decimator refuses. It stalled at 3520 of 3860 no matter how aggressive the
    setting. Snapping to a half-millimetre lattice first removes the slivers
    outright, and the same decimator then takes the same part to 593.
    """
    import numpy as np
    key = np.floor(v / h).astype(np.int64)
    uk, inv = np.unique(key, axis=0, return_inverse=True)
    nv = np.zeros((len(uk), 3))
    cnt = np.zeros(len(uk))
    np.add.at(nv, inv, v)
    np.add.at(cnt, inv, 1.0)
    nv /= cnt[:, None]
    nf = inv[f]
    nf = nf[(nf[:, 0] != nf[:, 1]) & (nf[:, 1] != nf[:, 2]) & (nf[:, 2] != nf[:, 0])]
    _, first = np.unique(np.sort(nf, axis=1), axis=0, return_index=True)
    nf = nf[np.sort(first)]                      # keep the first winding seen
    used, inv2 = np.unique(nf, return_inverse=True)
    return nv[used], inv2.reshape(-1, 3).astype(np.int64)


def _decimate(mesh, target):
    """Weld, de-sliver, then decimate to `target` triangles.

    Normals are re-derived at the end: collapsing edges can leave a face wound
    the other way round, and a backface cull then punches a hole in the link.
    `fix_normals` re-orients from the winding of the surviving surface rather
    than trusting the input.
    """
    import numpy as np
    import trimesh
    m = mesh.copy()
    # Welding first is not tidiness. The COLLADA loader hands back one vertex
    # per corner, so a 12 000-triangle link arrives as 12 000 disconnected
    # triangles, and an edge-collapse decimator has no edge to collapse.
    m.merge_vertices(merge_tex=True, merge_norm=True)
    v, f = _cluster(np.asarray(m.vertices), np.asarray(m.faces), WELD)
    target = int(max(target, FLOOR))
    # The decimator honours the target loosely in both directions: it stalls
    # above it on awkward geometry, and undershoots it badly on clean geometry
    # -- the shoulder's blue cap was asked for 312 triangles and came back with
    # 108, which is where the hexagonal facets came from. So the request is
    # steered by what the last one returned, rather than trusted.
    ask = target
    for _ in range(5):
        if len(f) <= target:
            break
        d = trimesh.Trimesh(v, f, process=False).simplify_quadric_decimation(
            face_count=int(ask), aggression=8)
        got = len(d.faces)
        if got >= len(f):                        # stalled; nothing more to give
            break
        if got < 0.75 * target and ask < 20 * target:
            ask = max(ask + 1, int(ask * target / max(got, 1)))
            continue                             # overshot: ask again, higher
        v, f = np.asarray(d.vertices), np.asarray(d.faces)
        if len(f) <= target:
            break
        ask = target
    out = trimesh.Trimesh(v, f, process=False)
    out.merge_vertices()
    out.fix_normals()
    return out


def _bake(mesh, T):
    """Vertices through `T`, quantised, as (int16 xyz list, index list)."""
    import numpy as np
    v = mesh.vertices @ T[:3, :3].T + T[:3, 3]
    q = np.rint(v / UNIT).astype(np.int32)
    if np.abs(q).max() > 32767:
        raise SystemExit("vertex out of int16 range; lower UNIT")
    # Quantising can merge two vertices onto one lattice point, which turns a
    # triangle into a line. Those draw as nothing but still cost a fill.
    f = mesh.faces
    keep = ~((q[f[:, 0]] == q[f[:, 1]]).all(1)
             | (q[f[:, 1]] == q[f[:, 2]]).all(1)
             | (q[f[:, 2]] == q[f[:, 0]]).all(1))
    f = f[keep]
    used, inv = np.unique(f, return_inverse=True)
    return q[used].ravel().tolist(), inv.astype(np.int32).ravel().tolist()


def _group(link_parts, budget):
    """Merge a link's parts by colour, then decimate each colour to budget.

    A UR forearm arrives as seven geometries but only four materials; three of
    the seven are the same black. Merging first means the budget is spent on
    four shapes instead of seven, and the decimator gets to collapse across the
    seams where two geometries meet.

    The budget is split by surface area, not by triangle count. Triangle count
    is what the exporter happened to spend, and it spent most of it on slivers
    in trim that is a few millimetres wide; area is what the reader sees.
    """
    import trimesh
    by_colour = {}
    for m in link_parts:
        by_colour.setdefault(tuple(_colour(m)), []).append(m)
    merged = {c: trimesh.util.concatenate(ms) for c, ms in by_colour.items()}
    total = sum(float(m.area) for m in merged.values())
    out = []
    for c, m in sorted(merged.items(), key=lambda kv: -float(kv[1].area)):
        share = float(m.area) / total if total else 0.0
        out.append((list(c), _decimate(m, round(budget * share))))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True, type=pathlib.Path,
                    help="checkout of reactive-replanning-ur12e with third_party/ present")
    ap.add_argument("--budget", type=int, default=BUDGET)
    ap.add_argument("--out", type=pathlib.Path, default=OUT)
    args = ap.parse_args()

    sys.path.insert(0, str(args.src.resolve()))
    import numpy as np
    from predictive_replanning.assets import HANDE, SOURCES, visual_params

    tp = args.src.resolve() / "third_party"
    ur, hd = tp / "ur_description", tp / "hande_description"
    for d in (ur, hd):
        if not d.is_dir():
            raise SystemExit(f"{d} is missing; clone the submodules first")

    vp = visual_params()
    links, tris = [], 0

    # ── the six arm links, placed by the vendor's own mesh_offset ──────
    # The frame each one lands in is the joint frame `ur12e.link_frames`
    # returns, so the page multiplies by exactly the transform the planner
    # already computes. base_link_inertia is the identity, which is the frame
    # that FK starts from.
    for name, frame in (("base", "base_link_inertia"), ("shoulder", "shoulder_link"),
                        ("upper_arm", "upper_arm_link"), ("forearm", "forearm_link"),
                        ("wrist_1", "wrist_1_link"), ("wrist_2", "wrist_2_link"),
                        ("wrist_3", "wrist_3_link")):
        off = vp[name]["mesh_offset"]
        T = _xform(off["x"], off["y"], off["z"], off["roll"], off["pitch"], off["yaw"])
        parts = _parts(("ur_description", ur), vp[name]["visual"]["mesh"]["path"])
        baked = []
        for colour, m in _group(parts, args.budget * SHARE[name]):
            v, f = _bake(m, T)
            baked.append({"c": colour, "v": v, "f": f})
            tris += len(f) // 3
        links.append({"name": frame, "parts": baked})

    # ── the gripper ───────────────────────────────────────────────────
    # Coupler and body are rigid in tool0. The two fingers are their own links,
    # baked in the tool0 frame at the closed position with the Hand-E's own
    # coupler and body heights and the right one's half turn already applied,
    # so a page that wants to open them slides each by the joint value along
    # tool0's x -- one number, and no gripper geometry on the page's side.
    tool = []
    for name, T in (("io_coupler", np.eye(4)),
                    ("hande", _xform(0, 0, HANDE["coupler_height"], 0, 0, 0))):
        for colour, m in _group(_parts(("hande_description", hd), f"meshes/{name}.dae"),
                                args.budget * SHARE[name]):
            v, f = _bake(m, T)
            tool.append({"c": colour, "v": v, "f": f})
            tris += len(f) // 3
    links.append({"name": "tool0", "parts": tool})

    jaw = HANDE["coupler_height"] + HANDE["hande_height"]
    for side, yaw in (("finger_l", 0.0), ("finger_r", np.pi)):
        parts = []
        for colour, m in _group(_parts(("hande_description", hd), "meshes/finger.dae"),
                                args.budget * SHARE["finger"] / 2):
            v, f = _bake(m, _xform(0, 0, jaw, 0, 0, yaw))
            parts.append({"c": colour, "v": v, "f": f})
            tris += len(f) // 3
        links.append({"name": side, "parts": parts})

    def head(repo):
        return subprocess.run(["git", "-C", str(repo), "rev-parse", "HEAD"],
                              capture_output=True, text=True, check=True).stdout.strip()

    doc = {
        "unit": UNIT,
        "triangles": tris,
        #: How far each finger slides along tool0's x to open, in metres. The
        #: baked pose is the closed one, so this is the whole range.
        "grip_max": HANDE["grip_max"],
        "note": ("UR12e and Hand-E visual meshes, decimated. Vertices are int16 "
                 "multiples of `unit` metres in the named link frame, already "
                 "carrying the URDF mesh_offset; `f` indexes them in threes. "
                 "A UR12e is drawn from meshes/ur10e because that is the path "
                 "config/ur12e/visual_parameters.yaml names."),
        "sources": {
            "ur_description": {"url": SOURCES["ur_description"], "commit": head(ur),
                               "sha256": CONSUMED["ur_description"]},
            "hande_description": {"url": SOURCES["hande_description"], "commit": head(hd),
                                  "sha256": CONSUMED["hande_description"]},
        },
        "links": links,
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(doc, separators=(",", ":")))
    size = args.out.stat().st_size
    try:
        shown = args.out.relative_to(ROOT)
    except ValueError:                           # --out somewhere else entirely
        shown = args.out
    print(f"{shown}  {tris} triangles  {size / 1024:.0f} KiB")
    print(f"  sha256 {hashlib.sha256(args.out.read_bytes()).hexdigest()[:16]}")
    for lk in links:
        print("  %-22s %s" % (lk["name"], "  ".join(
            "%s x%d" % ("#%02x%02x%02x" % tuple(p["c"]), len(p["f"]) // 3) for p in lk["parts"])))


if __name__ == "__main__":
    main()
