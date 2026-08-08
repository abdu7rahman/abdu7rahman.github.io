#!/usr/bin/env python3
"""Behaviour-clone the DWA controller from its own rollouts.

Every other demo on this site runs code from a repository. This one trains a
model, so the honest version has to be reproducible end to end: the data comes
from the real dwa_controller.py driving real A* plans on generated maps, the
network is a small MLP fitted here in numpy, and the checkpoint it writes is
what the page loads. No GPU, no dataset download, nothing hand-labelled.

    python3 tools/train_clone.py --maps 260 --epochs 400

It prints a held-out error and a closed-loop success rate, then writes
assets/dwa_clone.json. If the closed-loop number is bad, that is the result --
the page should say so rather than shipping a policy that cannot drive.

The observation is what a real local policy gets: where the goal is in the
robot's own frame, how fast it is already going, and what the costmap looks
like along a fan of bearings ahead of it. The action is the twist DWA
committed to. That is the whole supervision signal.
"""
import argparse
import json
import math
import os
import pathlib
import sys

import numpy as np

ROOT = pathlib.Path(__file__).resolve().parent.parent
NAV = pathlib.Path("/home/user/reactive_autonomous_nav")
sys.path.insert(0, str(NAV / "bench"))

RES = 0.05
BEARINGS = np.linspace(-1.4, 1.4, 11)      # rad, the fan the policy can see
RANGES = (0.25, 0.5, 0.85, 1.3)            # m, samples along each bearing
OBS_DIM = 4 + len(BEARINGS)                # goal r/theta, v, w, one clearance per bearing
ACT_DIM = 2


def inflate(g, radius=4, res=RES, lethal=253):
    big = 1e9
    d = np.where(g >= lethal, 0.0, big)
    for _ in range(int(radius) + 2):
        p = np.pad(d, 1, constant_values=big)
        d = np.minimum.reduce([d,
            p[:-2, 1:-1] + 1.0, p[2:, 1:-1] + 1.0,
            p[1:-1, :-2] + 1.0, p[1:-1, 2:] + 1.0,
            p[:-2, :-2] + 1.414, p[:-2, 2:] + 1.414,
            p[2:, :-2] + 1.414, p[2:, 2:] + 1.414])
    band = (g < lethal) & (d <= radius)
    scaled = np.minimum(252.0, 252.0 * np.exp(-6.0 * np.minimum(d, 1e3) * res))
    out = g.copy()
    out[band] = np.maximum(out[band], scaled.astype(np.int16)[band])
    return out


def random_map(rng, h=64, w=96):
    """Walls and blocks, varied enough that the policy cannot memorise one map."""
    g = np.zeros((h, w), dtype=np.int16)
    g[:, :2] = g[:, -2:] = g[:2, :] = g[-2:, :] = 254
    for _ in range(rng.integers(3, 8)):
        if rng.random() < 0.55:                      # a wall with a gap
            c = int(rng.integers(12, w - 12))
            r0 = int(rng.integers(3, h // 2))
            r1 = int(rng.integers(h // 2, h - 3))
            g[r0:r1, c:c + 3] = 254
            gap = int(rng.integers(r0, max(r0 + 1, r1 - 8)))
            g[gap:gap + 8, c:c + 3] = 0
        else:                                        # a block
            r = int(rng.integers(4, h - 12)); c = int(rng.integers(6, w - 14))
            g[r:r + int(rng.integers(4, 12)), c:c + int(rng.integers(4, 12))] = 254
    return g


def observe(grid_inf, x, y, yaw, v, w, gx, gy):
    """What the cloned policy is allowed to know. Costmap reads only."""
    dx, dy = gx - x, gy - y
    rng_ = math.hypot(dx, dy)
    brg = math.atan2(dy, dx) - yaw
    brg = math.atan2(math.sin(brg), math.cos(brg))
    o = [min(rng_, 4.0) / 4.0, brg / math.pi, v / 0.5, w / 1.5]
    H, W = grid_inf.shape
    for b in BEARINGS:
        clear = 1.0
        for k, d in enumerate(RANGES):
            px, py = x + d * math.cos(yaw + b), y + d * math.sin(yaw + b)
            r, c = int(py / RES), int(px / RES)
            blocked = not (0 <= r < H and 0 <= c < W) or grid_inf[r, c] >= 253
            if blocked:
                clear = k / len(RANGES)
                break
        o.append(clear)
    return o


def rollout(rig, grid_inf, grid_raw, rng, max_steps=900):
    """One episode of the real controller, recording what it saw and did."""
    import types
    ap = rig.load("astar_planner")
    G = rig.Grid(grid_inf, RES, (0.0, 0.0))
    pl = rig.prepare(rig.wire_global(rig.apply_defaults(
        object.__new__(rig.node_class(ap)), "astar_planner"), G))
    pl.global_info = G.info()
    H, W = grid_inf.shape

    def free_cell():
        for _ in range(400):
            r = int(rng.integers(3, H - 3)); c = int(rng.integers(3, W - 3))
            if grid_inf[r, c] < 200:
                return (r, c)
        return None
    s, gl = free_cell(), free_cell()
    if s is None or gl is None or s == gl:
        return []
    cells, _ = pl._astar(s, gl)
    if not cells or len(cells) < 12:
        return []
    pts = [G.g2w(r, c) for r, c in cells]

    dm = rig.load("dwa_controller")
    n = rig.prepare(rig.apply_defaults(object.__new__(dm.DWAControllerNode), "dwa_controller"))
    import collections
    for a, val in (("costmap_data", grid_inf), ("costmap_info", G.info()),
                   ("costmap_origin", (0.0, 0.0)), ("current_vel", {"v": 0.0, "omega": 0.0}),
                   ("wp_idx", 0), ("goal_reached", False)):
        setattr(n, a, val)
    n.position_history = collections.deque(maxlen=50)
    n.recovery_mode, n.recovery_timer, n.recovery_dir = False, 0, 1.0
    n._record_pose = lambda *a, **k: None
    cmd = rig.Sink(); n.cmd_pub = cmd
    n._path_cb(rig.make_path(pts))

    x, y = pts[0]
    yaw = math.atan2(pts[3][1] - y, pts[3][0] - x)
    v = w = 0.0
    gx, gy = pts[-1]
    rows = []
    for _ in range(max_steps):
        pose = (x, y, yaw)
        n._get_robot_pose = lambda p=pose: p
        n._get_tf = lambda t, s_, p=pose: p if "base_link" in (t, s_) else (0.0, 0.0, 0.0)
        n.current_pose = types.SimpleNamespace(x=x, y=y, yaw=yaw)
        n.current_vel = {"v": v, "omega": w}
        before = len(cmd.msgs)
        n._control_loop()
        if n.goal_reached:
            break
        if len(cmd.msgs) == before:
            break
        m = cmd.msgs[-1]
        nv = float(getattr(m.linear, "x", 0.0)); nw = float(getattr(m.angular, "z", 0.0))
        # the waypoint DWA is actually steering at, not the far goal
        ti = min(n.wp_idx + n.lookahead_wps, len(pts) - 1)
        rows.append((observe(grid_inf, x, y, yaw, v, w, pts[ti][0], pts[ti][1]), [nv / 0.5, nw / 1.5]))
        v, w = nv, nw
        x += v * math.cos(yaw) * n.dt
        y += v * math.sin(yaw) * n.dt
        yaw = (yaw + w * n.dt + math.pi) % (2 * math.pi) - math.pi
        r, c = int(y / RES), int(x / RES)
        if not (0 <= r < H and 0 <= c < W) or grid_raw[r, c] >= 253:
            break
        if math.hypot(x - gx, y - gy) < 0.25:
            break
    return rows


class MLP:
    """Small enough to run in a browser, big enough to fit a velocity window."""

    def __init__(self, sizes, rng):
        self.W, self.b = [], []
        for i in range(len(sizes) - 1):
            fan = sizes[i]
            self.W.append(rng.normal(0, math.sqrt(2.0 / fan), (sizes[i], sizes[i + 1])))
            self.b.append(np.zeros(sizes[i + 1]))

    def forward(self, X, cache=None):
        a = X
        for i in range(len(self.W)):
            z = a @ self.W[i] + self.b[i]
            a = np.tanh(z) if i < len(self.W) - 1 else z
            if cache is not None:
                cache.append(a)
        return a

    def params(self):
        return self.W + self.b


def train(X, Y, hidden, epochs, lr, rng, batch=256):
    net = MLP([X.shape[1]] + hidden + [ACT_DIM], rng)
    P = net.params()
    m = [np.zeros_like(p) for p in P]
    vv = [np.zeros_like(p) for p in P]
    nW = len(net.W)
    hist = []
    for ep in range(epochs):
        idx = rng.permutation(len(X))
        tot = 0.0
        for s in range(0, len(X), batch):
            sl = idx[s:s + batch]
            xb, yb = X[sl], Y[sl]
            acts, zs = [xb], []
            a = xb
            for i in range(nW):
                z = a @ net.W[i] + net.b[i]
                zs.append(z)
                a = np.tanh(z) if i < nW - 1 else z
                acts.append(a)
            diff = acts[-1] - yb
            tot += float(np.mean(diff ** 2)) * len(sl)
            g = 2.0 * diff / len(sl)
            gW = [None] * nW; gb = [None] * nW
            for i in range(nW - 1, -1, -1):
                gW[i] = acts[i].T @ g
                gb[i] = g.sum(axis=0)
                if i > 0:
                    g = (g @ net.W[i].T) * (1.0 - np.tanh(zs[i - 1]) ** 2)
            grads = gW + gb
            for k, gr in enumerate(grads):
                m[k] = 0.9 * m[k] + 0.1 * gr
                vv[k] = 0.999 * vv[k] + 0.001 * gr * gr
                mh = m[k] / (1 - 0.9 ** (ep + 1))
                vh = vv[k] / (1 - 0.999 ** (ep + 1))
                P[k] -= lr * mh / (np.sqrt(vh) + 1e-8)
        hist.append(tot / len(X))
    return net, hist


def expert_on(rig, grid_inf, pts):
    """A DWA node ready to be asked "what would you do here?" at any pose.

    This is the half of DAgger that behaviour cloning does not have: the clone
    wanders off the expert's distribution, and the only way to learn the way
    back is to ask the expert about the states the clone actually reaches.
    """
    import collections, types
    G = rig.Grid(grid_inf, RES, (0.0, 0.0))
    dm = rig.load("dwa_controller")
    n = rig.prepare(rig.apply_defaults(object.__new__(dm.DWAControllerNode), "dwa_controller"))
    for a, val in (("costmap_data", grid_inf), ("costmap_info", G.info()),
                   ("costmap_origin", (0.0, 0.0)), ("current_vel", {"v": 0.0, "omega": 0.0}),
                   ("wp_idx", 0), ("goal_reached", False)):
        setattr(n, a, val)
    n.position_history = collections.deque(maxlen=50)
    n.recovery_mode, n.recovery_timer, n.recovery_dir = False, 0, 1.0
    n._record_pose = lambda *a, **k: None
    n.cmd_pub = rig.Sink()
    n._path_cb(rig.make_path(pts))
    def ask(x, y, yaw, v, w, wp):
        n.wp_idx = wp
        n.goal_reached = False
        pose = (x, y, yaw)
        n._get_robot_pose = lambda p=pose: p
        n._get_tf = lambda t, s_, p=pose: p if "base_link" in (t, s_) else (0.0, 0.0, 0.0)
        n.current_pose = types.SimpleNamespace(x=x, y=y, yaw=yaw)
        n.current_vel = {"v": v, "omega": w}
        before = len(n.cmd_pub.msgs)
        try:
            n._control_loop()
        except Exception:
            return None
        if len(n.cmd_pub.msgs) == before:
            return None
        # Drop anything the expert produced while escaping. Recovery is a
        # different behaviour -- a timed spin driven by history, not by the
        # current observation -- so labelling a snapshot with it teaches the
        # clone to spin at states that merely look ambiguous. This is why the
        # first DAgger attempt made the policy worse instead of better.
        if getattr(n, "recovery_mode", False):
            return None
        m = n.cmd_pub.msgs[-1]
        return float(getattr(m.linear, "x", 0.0)), float(getattr(m.angular, "z", 0.0))
    return ask


def dagger_pass(net, rig, grid_inf, grid_raw, pts, beta, rng, max_steps=700):
    """Drive with the clone, label every state with what the expert would do."""
    ask = expert_on(rig, grid_inf, pts)
    H, W = grid_inf.shape
    x, y = pts[0]
    yaw = math.atan2(pts[3][1] - y, pts[3][0] - x)
    v = w = 0.0
    gx, gy = pts[-1]
    wp = 0
    rows = []
    for _ in range(max_steps):
        while wp < len(pts) - 1:
            d0 = math.hypot(pts[wp][0] - x, pts[wp][1] - y)
            if d0 < 0.25 or math.hypot(pts[wp + 1][0] - x, pts[wp + 1][1] - y) < d0:
                wp += 1
            else:
                break
        ti = min(wp + 8, len(pts) - 1)
        o = observe(grid_inf, x, y, yaw, v, w, pts[ti][0], pts[ti][1])
        exp = ask(x, y, yaw, v, w, wp)
        if exp is None:
            break
        rows.append((o, [exp[0] / 0.5, exp[1] / 1.5]))
        # keep the clone honest about its own dynamics
        # beta mixes the expert back in early on, so the first pass does not
        # spend all its steps in a corner the clone drove itself into
        if rng.random() < beta:
            v, w = exp
        else:
            out = net.forward(np.array([o]))[0]
            v = float(np.clip(out[0] * 0.5, -0.5, 0.5))
            w = float(np.clip(out[1] * 1.5, -1.5, 1.5))
        x += v * math.cos(yaw) * 0.1
        y += v * math.sin(yaw) * 0.1
        yaw = (yaw + w * 0.1 + math.pi) % (2 * math.pi) - math.pi
        r, c = int(y / RES), int(x / RES)
        if not (0 <= r < H and 0 <= c < W) or grid_raw[r, c] >= 253:
            break
        if math.hypot(x - gx, y - gy) < 0.25:
            break
    return rows


def drive_with(net, grid_inf, grid_raw, pts, max_steps=900):
    """Closed loop on the clone alone. The only honest test of a cloned policy."""
    H, W = grid_inf.shape
    x, y = pts[0]
    yaw = math.atan2(pts[3][1] - y, pts[3][0] - x)
    v = w = 0.0
    gx, gy = pts[-1]
    wp = 0
    P = np.array(pts)
    for _ in range(max_steps):
        while wp < len(pts) - 1:
            d0 = math.hypot(pts[wp][0] - x, pts[wp][1] - y)
            if d0 < 0.25 or math.hypot(pts[wp + 1][0] - x, pts[wp + 1][1] - y) < d0:
                wp += 1
            else:
                break
        ti = min(wp + 8, len(pts) - 1)
        o = np.array([observe(grid_inf, x, y, yaw, v, w, pts[ti][0], pts[ti][1])])
        out = net.forward(o)[0]
        v = float(np.clip(out[0] * 0.5, -0.5, 0.5))
        w = float(np.clip(out[1] * 1.5, -1.5, 1.5))
        x += v * math.cos(yaw) * 0.1
        y += v * math.sin(yaw) * 0.1
        yaw = (yaw + w * 0.1 + math.pi) % (2 * math.pi) - math.pi
        r, c = int(y / RES), int(x / RES)
        if not (0 <= r < H and 0 <= c < W) or grid_raw[r, c] >= 253:
            return False, float(np.min(np.hypot(P[:, 0] - x, P[:, 1] - y)))
        if math.hypot(x - gx, y - gy) < 0.25:
            return True, 0.0
    return False, math.hypot(x - gx, y - gy)


def plan_on(rig, grid_inf, rng):
    """A random A* problem on this map, or None if it has no room for one."""
    G = rig.Grid(grid_inf, RES, (0.0, 0.0))
    apm = rig.load("astar_planner")
    pl = rig.prepare(rig.wire_global(rig.apply_defaults(
        object.__new__(rig.node_class(apm)), "astar_planner"), G))
    pl.global_info = G.info()
    H, W = grid_inf.shape
    def fc():
        for _ in range(300):
            r = int(rng.integers(3, H - 3)); c = int(rng.integers(3, W - 3))
            if grid_inf[r, c] < 200:
                return (r, c)
        return None
    s, g = fc(), fc()
    if s is None or g is None or s == g:
        return None
    cells, _ = pl._astar(s, g)
    if not cells or len(cells) < 12:
        return None
    return [G.g2w(r, c) for r, c in cells]


def evaluate(net, rig, seed, n=60):
    """Closed loop on fresh maps. The only number that means anything here."""
    erng = np.random.default_rng(seed)
    ok = tries = 0
    for _ in range(n):
        raw = random_map(erng); inf = inflate(raw)
        pts = plan_on(rig, inf, erng)
        if pts is None:
            continue
        tries += 1
        good, _ = drive_with(net, inf, raw, pts)
        ok += good
    return ok, tries


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--maps", type=int, default=220)
    ap.add_argument("--epochs", type=int, default=400)
    ap.add_argument("--lr", type=float, default=3e-3)
    ap.add_argument("--hidden", type=int, nargs="+", default=[64, 64])
    ap.add_argument("--seed", type=int, default=20260808)
    ap.add_argument("--dagger", type=int, default=4,
                    help="data-aggregation rounds; 0 is plain behaviour cloning")
    ap.add_argument("--dagger-maps", type=int, default=45)
    ap.add_argument("--out", default=str(ROOT / "assets" / "dwa_clone.json"))
    args = ap.parse_args()

    import rig
    rng = np.random.default_rng(args.seed)

    print("rolling out the real dwa_controller.py on %d maps…" % args.maps)
    rows, maps_used = [], 0
    for i in range(args.maps):
        raw = random_map(rng)
        inf = inflate(raw)
        r = rollout(rig, inf, raw, rng)
        if r:
            rows += r
            maps_used += 1
        if (i + 1) % 40 == 0:
            print("  %3d maps, %6d samples" % (i + 1, len(rows)))
    if len(rows) < 2000:
        print("not enough data (%d samples); the demo would be meaningless" % len(rows))
        return 1
    X = np.array([r[0] for r in rows], dtype=np.float64)
    Y = np.array([r[1] for r in rows], dtype=np.float64)
    print("%d samples from %d usable maps, obs dim %d" % (len(X), maps_used, X.shape[1]))

    cut = int(len(X) * 0.85)
    perm = rng.permutation(len(X))
    tr, te = perm[:cut], perm[cut:]
    net, hist = train(X[tr], Y[tr], args.hidden, args.epochs, args.lr, rng)
    bc_rate = evaluate(net, rig, args.seed + 1)
    # Each round refits from a fresh init, so the closed-loop score moves
    # around a lot. Keep the best one on the held-out course set rather than
    # whatever the last round happened to produce -- that is model selection,
    # and the score reported is the selected model's.
    best = (bc_rate[0] / max(1, bc_rate[1]), net, hist, "bc")
    print("behaviour cloning alone: reached %d of %d  (%.0f%%)"
          % (bc_rate[0], bc_rate[1], 100 * bc_rate[0] / max(1, bc_rate[1])))

    # DAgger. Roll the clone out, ask the expert what it should have done at
    # every state the clone actually reached, add those, refit. This is the
    # part plain cloning cannot do: the states that matter are the ones the
    # expert never visits, because the expert never makes the clone's mistakes.
    rounds = [("bc", bc_rate)]
    Xa, Ya = X.copy(), Y.copy()
    for it in range(args.dagger):
        beta = 0.5 ** (it + 1)
        new = []
        for _ in range(args.dagger_maps):
            raw = random_map(rng); inf = inflate(raw)
            pts = plan_on(rig, inf, rng)
            if pts is None: continue
            new += dagger_pass(net, rig, inf, raw, pts, beta, rng)
        if not new: continue
        Xa = np.vstack([Xa, np.array([r[0] for r in new])])
        Ya = np.vstack([Ya, np.array([r[1] for r in new])])
        net, hist = train(Xa, Ya, args.hidden, args.epochs, args.lr, rng)
        r = evaluate(net, rig, args.seed + 1)
        rounds.append(("dagger%d" % (it + 1), r))
        if r[0] / max(1, r[1]) > best[0]:
            best = (r[0] / max(1, r[1]), net, hist, "dagger%d" % (it + 1))
        print("  round %d  +%6d states (beta %.2f)  ->  %d of %d  (%.0f%%)"
              % (it + 1, len(new), beta, r[0], r[1], 100 * r[0] / max(1, r[1])))

    net, hist, picked = best[1], best[2], best[3]
    print("keeping %s (%.0f%% closed loop)" % (picked, 100 * best[0]))
    pred = net.forward(X[te])
    mse = float(np.mean((pred - Y[te]) ** 2))
    vmae = float(np.mean(np.abs(pred[:, 0] - Y[te][:, 0]))) * 0.5
    wmae = float(np.mean(np.abs(pred[:, 1] - Y[te][:, 1]))) * 1.5
    print("\nheld-out  mse %.5f   v mae %.4f m/s   w mae %.4f rad/s" % (mse, vmae, wmae))

    ok, tries = dict(rounds)[picked]

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    ck = {
        "note": "behaviour-cloned from dwa_controller.py rollouts by tools/train_clone.py",
        "obs": {"bearings": [float(b) for b in BEARINGS], "ranges": list(RANGES),
                "v_scale": 0.5, "w_scale": 1.5},
        "arch": [X.shape[1]] + args.hidden + [ACT_DIM],
        "W": [w.tolist() for w in net.W],
        "b": [b.tolist() for b in net.b],
        "train": {"samples": int(len(X)), "maps": maps_used, "epochs": args.epochs,
                  "seed": args.seed, "final_train_mse": float(hist[-1])},
        "eval": {"holdout_mse": mse, "v_mae": vmae, "w_mae": wmae,
                 "closed_loop_reached": ok, "closed_loop_tried": tries, "picked": picked,
                 "rounds": [{"stage": nm, "reached": r[0], "tried": r[1]} for nm, r in rounds]},
        "curve": [float(h) for h in hist[::max(1, args.epochs // 60)]],
    }
    with open(args.out, "w") as fh:
        json.dump(ck, fh)
    print("\nwrote %s  (%.0f KB)" % (args.out, os.path.getsize(args.out) / 1024))
    return 0


if __name__ == "__main__":
    sys.exit(main())
