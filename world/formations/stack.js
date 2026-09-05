/* Formation 04 -- the bundle, and the one route out of it that was driven.
 *
 * This stands at the benchmark rig's own anchor, which is the point: the
 * instrument does not fly away and get replaced, it comes apart where it
 * stood. A plate, a plane and five volumes standing 1.6 up collapse onto the
 * floor they were bolted to and spread out across it. Nothing here travels
 * except the matter.
 *
 * The section is a list of what the work was built with, and its planning row
 * is almost entirely samplers -- A*, Theta*, SMAC, RRT and RRT-Connect, BIT*,
 * DWA, Pure Pursuit, Stanley, TEB, MPPI. Drawn as a wall of labels that is a
 * word cloud; drawn as bars it is the previous formation again with different
 * numbers. So it is drawn as the thing every one of those names actually
 * does, which they all do the same way: propose many futures from the state
 * you are in, price them, and commit to one. That is a rollout bundle, and it
 * is the only picture on this page that could not be any other section.
 *
 * The geometry is a dynamic-window fan, generated the way a dynamic-window
 * fan is generated: a grid over the velocity window, each cell held constant
 * and forward-simulated through a unicycle for a fixed horizon. Nothing in
 * this file is a measurement and nothing in it is reporting a result. The
 * cost is a shape -- it decides how much of the budget a candidate is worth
 * drawing with, and that is all it decides.
 *
 * The accent arrives from the rig as the profile across the five bars and
 * leaves as the route through the corridor. In between it is the rollout that
 * won: one unbroken strand out of several hundred that did not.
 */
import * as THREE from "three";
import { bands, polyline, axisTriad, rng, STRUCTURE, PATH, FRAME } from "./lib.js";

/* Offsets from the station anchor; the caller adds it. The rig was read from
   2.78 back and level with the bars, because a bar you look down on is a
   graphic; this is the opposite problem. A fan lying on the floor, read from
   the height of the floor, is a line -- every candidate in it is edge-on and
   the spread, which is the entire content, projects to nothing.

   So the eye lifts to 1.05 and comes round to 0.86, about thirty degrees off
   the plate and thirty above it, which is far enough over the bundle to open
   the whole spread and far enough off axis that the fan is not symmetric
   about the frame's own centre line. Solved against what this file writes:
   the bundle is 1.28 across and 0.92 deep and it does not stand up at all, so
   the standoff comes in from 2.78 to 1.72 -- the closest this station is
   allowed to move, and still a fifth of the distance to the next one. That
   framing puts 99% of the written points inside a 1440x900 frame with their
   weight at 0.24 across it, right of centre and clear of the panel, which at
   this width owns the left 54% of the glass. */
export const VIEW = { pos: [0.86, 1.05, 1.72], look: [-0.34, 0.02, 0.02], fov: 44 };

/* The velocity window, and the clock it is rolled out on.
 *
 * Neither is invented for the picture. 0.5 m/s and 1.5 rad/s are the linear
 * and angular scales the cloned controller in assets/dwa_clone.json
 * normalises its two outputs by, and the same two numbers demo.js falls back
 * to when it asks the node for its own limits; 0.1 s is the period that node
 * publishes at, which is the 10 Hz the cursor chase on that page runs the
 * whole stack at.
 *
 * The horizon is the one number here chosen for the drawing rather than taken
 * from the package, and it is chosen for a reason worth stating: at 1.6 s the
 * sharpest arc in the window turns through about 140 degrees, so the fan has
 * hooked edges and still reads as a fan. Much past two seconds those edges
 * close into loops, and a loop reads as a mistake rather than as a candidate
 * nobody was going to pick. */
const V_MAX = 0.5, W_MAX = 1.5;
const TICK = 0.1, HORIZON = 1.6;
const STEPS = Math.round(HORIZON / TICK);

/* How the window is sampled: a regular grid, because a dynamic window is a
   rectangle in (v, omega) and the honest way to show a rectangle being
   searched is to search all of it. 20 x 17 is enough that neighbouring arcs
   are within a few millimetres of each other at the start of the horizon, so
   the bundle reads as a swept region near the robot and as separate choices
   out at the ends, which is exactly the thing that makes sampling worth
   drawing. The angular axis is odd so that straight ahead is one of the
   candidates rather than something the grid straddles. */
const NV = 20, NW = 17;

/* Where the fan is aimed. A waypoint ahead and off to one side -- a tracker
   is never steering at the goal, it is steering at the next point of a plan
   somebody handed it -- and one disc sitting in the way of the candidates
   that would cut the corner to reach it. Both are given in the robot's own
   frame at the moment it decides: x to its right, z straight ahead.

   Nothing draws the disc. A candidate that runs into it is not a candidate,
   and is dropped here as it is dropped in the controller, which leaves a
   wedge missing out of the fan -- and a wedge missing out of a fan is the
   only mark an obstacle needs to leave on a picture whose subject is the
   sampling rather than the map.

   Both sit to the robot's left, which from this camera is the far side of
   the frame from the panel: the winning strand should lead the eye across
   open glass, not under the column of type. */
const WAYPOINT = { x: -0.30, z: 0.74 };
const BLOCK = { x: -0.09, z: 0.44, r: 0.20 };

/* The three terms every dynamic-window cost has had since the paper: how
   close this candidate ends to where you are trying to go, how much of the
   turn towards it is still outstanding when the horizon runs out, and how
   much speed it gives up to get there. The weights are a shape and not a
   tuning -- they set how quickly the bundle thins away from the route that
   wins, and nothing on this page reads a number off them. */
const W_GOAL = 1.0, W_HEAD = 0.22, W_SLOW = 0.30;

/* Points held in the bundle's pool, more than the largest tier draws of them
   so the walk in fill thins the fan rather than writing the same candidate
   twice. */
const POOL = 30000;

/* Where the robot is standing when it has to decide, relative to the anchor,
   and which way it is facing. Set back towards the reader and pointing away,
   so the fan opens into the room rather than across the frame: a bundle that
   opens sideways puts half of itself behind the panel. */
const START_Z = 0.58;

export function build(ctx) {
  const anchor = ctx.anchor;
  const y0 = anchor.y;                    // the floor the rig stood on
  const sx = anchor.x, sz = anchor.z + START_Z;

  /* Forward simulation. The unicycle, integrated at the controller's own
     tick with (v, omega) held constant across the horizon, which is what a
     dynamic-window candidate is: not a trajectory anybody optimised, but the
     answer to "what happens if I hold this command". Heading is measured
     about world Y from the robot's own forward, so the pose triads later can
     be built from the same angle without converting anything. */
  const heading0 = Math.PI;               // facing away from the reader, down -Z
  // Robot frame to world: forward is (sin, cos) of the heading and right is
  // that turned a quarter clockwise, which is what "right" means for a body
  // standing on Y.
  const fx = Math.sin(heading0), fz = Math.cos(heading0);
  const local = (a, b) => [sx + a * fz + b * fx, sz - a * fx + b * fz];
  const [gx, gz] = local(WAYPOINT.x, WAYPOINT.z);
  const [bx, bz] = local(BLOCK.x, BLOCK.z);

  const traj = [], cost = [], cmd = [];
  for (let iv = 0; iv < NV; iv++) {
    const v = V_MAX * (iv + 1) / NV;
    for (let iw = 0; iw < NW; iw++) {
      const w = W_MAX * (2 * iw / (NW - 1) - 1);
      let x = sx, z = sz, th = heading0, hit = false;
      const pts = [new THREE.Vector3(x, y0, z)];
      for (let s = 0; s < STEPS; s++) {
        x += v * Math.sin(th) * TICK;
        z += v * Math.cos(th) * TICK;
        th += w * TICK;
        // Tested tick by tick along the body's own path rather than at the
        // end of it, because an arc whose two ends are clear of a disc can
        // still have gone straight through the middle of it.
        if (Math.hypot(x - bx, z - bz) < BLOCK.r) { hit = true; break; }
        pts.push(new THREE.Vector3(x, y0, z));
      }
      if (hit) continue;
      const dx = gx - x, dz = gz - z;
      // The residual turn, wrapped, so a candidate three degrees the wrong
      // side of the waypoint is not priced as though it were nearly a full
      // turn away from it.
      let err = Math.atan2(dx, dz) - th;
      err = Math.abs(Math.atan2(Math.sin(err), Math.cos(err)));
      traj.push(pts);
      cmd.push({ v, w, th });
      cost.push(W_GOAL * Math.hypot(dx, dz) + W_HEAD * err + W_SLOW * (1 - v / V_MAX));
    }
  }

  /* The commitment. One candidate out of the bundle, and every other line in
     the picture is there to make it clear that it was picked rather than
     drawn. */
  let best = 0;
  for (let i = 1; i < cost.length; i++) if (cost[i] < cost[best]) best = i;

  /* Cost as a share of the budget rather than as a figure: normalised across
     the surviving bundle, then spent. A cheap candidate gets more of the
     points and a slightly larger splat, an expensive one gets fewer and
     smaller, so the fan has a bright core that falls away towards its edges
     instead of being an even spray with a highlight laid over it. The floor
     under the weight keeps the outermost candidates on the page -- a bundle
     you can only see the good half of is not a bundle. */
  let lo = Infinity, hi = -Infinity;
  for (const c of cost) { if (c < lo) lo = c; if (c > hi) hi = c; }
  const range = Math.max(1e-6, hi - lo);
  const weight = cost.map(c => 0.28 + 0.72 * (1 - (c - lo) / range));
  let wsum = 0;
  for (const w of weight) wsum += w;

  /* The pool: every surviving candidate resampled into its share of the
     points. Uniform in step index is uniform in arc length here, because the
     command is held constant and the body therefore covers the same distance
     every tick -- which is the one simplification a constant-velocity rollout
     is allowed to make. */
  const P3 = new Float32Array(POOL * 3);
  const PS = new Float32Array(POOL);
  let n = 0;
  for (let j = 0; j < traj.length && n < POOL; j++) {
    const pts = traj[j];
    const share = j === traj.length - 1 ? POOL - n
                : Math.min(POOL - n, Math.round(POOL * weight[j] / wsum));
    const sz = 0.62 + 0.78 * (weight[j] - 0.28) / 0.72;
    for (let k = 0; k < share; k++) {
      const t = share < 2 ? 0 : (k / (share - 1)) * (pts.length - 1);
      const i0 = Math.min(pts.length - 2, t | 0), f = t - i0;
      const a = pts[i0], b = pts[i0 + 1];
      P3[n * 3]     = a.x + (b.x - a.x) * f;
      P3[n * 3 + 1] = a.y + (b.y - a.y) * f;
      P3[n * 3 + 2] = a.z + (b.z - a.z) * f;
      PS[n] = sz;
      n++;
    }
  }
  const NP = n;

  /* The poses. One where the decision is taken, one where the chosen rollout
     ends, and three along it -- a controller does not produce a curve, it
     produces a command that a body is in some pose under at every tick, and
     the triads are where those poses are. */
  const chosen = traj[best];
  const marks = [{ x: sx, z: sz, yaw: heading0, len: 0.26, sz: 1.2 }];
  for (let k = 1; k <= 3; k++) {
    const i = Math.round((k / 4) * (chosen.length - 1));
    marks.push({ x: chosen[i].x, z: chosen[i].z,
                 yaw: heading0 + cmd[best].w * i * TICK, len: 0.11, sz: 0.95 });
  }
  const tail = chosen[chosen.length - 1];
  marks.push({ x: tail.x, z: tail.z, yaw: cmd[best].th, len: 0.24, sz: 1.2 });

  /* One table of noise, read three at a time, with two entries of overrun so
     the read past the wrap is a read rather than a bounds check. */
  const r = rng(0x7A11);
  const JN = 4096, JM = JN - 1;
  const jit = new Float32Array(JN + 2);
  for (let i = 0; i < JN; i++) jit[i] = r() * 2 - 1;
  jit[JN] = jit[0]; jit[JN + 1] = jit[1];

  return function fill(pos, kind, size, count) {
    const { S, P, F } = bands(pos, kind, size, count);

    const nB = S.share(1.0), per = NP / Math.max(1, nB);
    for (let k = 0; k < nB; k++) {
      const i = (k * per) | 0, o = i * 3, j = (k * 3) & JM;
      // Jittered a couple of millimetres across the floor and a shade less
      // through it: the fan is flat because the robot is on the ground, and a
      // mathematical plane of sixty thousand additive points is a sheet of
      // light rather than a set of arcs.
      S.put(P3[o]     + jit[j]     * 0.007,
            P3[o + 1] + jit[j + 1] * 0.004,
            P3[o + 2] + jit[j + 2] * 0.007, STRUCTURE, PS[i]);
    }
    S.pad(0.02);

    polyline(chosen, P.share(0.94), P, PATH, 1.7, 0.006, 0x2b4d);
    P.pad(0.012);

    const each = Math.floor(F.share(0.92) / marks.length);
    for (const m of marks) axisTriad(m.x, y0, m.z, m.yaw, each, F, m.len, m.sz);
    F.pad(0.01);
  };
}
