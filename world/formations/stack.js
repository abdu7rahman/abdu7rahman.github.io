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
 * And it is a decision being taken rather than a decision already taken. The
 * substrate carries a travelling band -- every point knows where along its own
 * feature it sits, and the band passes over it once a lap -- so the bundle is
 * swept out of the body along the horizon it was simulated over, and the one
 * candidate that won is driven afterwards rather than at the same time. That
 * ordering is the whole subject. A fan that is simply *there* is a photograph
 * of a controller; a window searched and then committed to is the controller.
 *
 * The accent arrives from the rig as the profile across the five bars and
 * leaves as the route through the corridor. In between it is the rollout that
 * won: one unbroken strand out of several hundred that did not.
 */
import * as THREE from "three";
import { bands, polyline, rng, STRUCTURE, PATH, FRAME } from "./lib.js";

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
 * Two things about it are choices rather than quotations, and both are worth
 * saying out loud. The first is that this draws the whole velocity window --
 * every command the controller is able to issue -- rather than the sliver of
 * it reachable within one tick of a standing start, which is a single line
 * and says nothing about sampling. The second is the horizon: at 2.0 s the
 * sharpest arc in the window turns through just under half a circle, so the
 * fan has hooked edges and still reads as a fan. Much past that they close
 * into loops, and a loop reads as a mistake rather than as a candidate nobody
 * was ever going to pick. */
const V_MAX = 0.5, W_MAX = 1.5;
const TICK = 0.1, HORIZON = 2.0;
const STEPS = Math.round(HORIZON / TICK);
/* How far the worst candidate in the window rides above the floor by the end
   of its horizon. 0.55 over a fan about two metres across is enough spread to
   read the surface from the side without the bundle becoming a wall. */
const LIFT = 0.55;

/* How the window is sampled: a regular grid, because a dynamic window is a
   rectangle in (v, omega) and the honest way to show a rectangle being
   searched is to search all of it. 20 x 17 is enough that neighbouring arcs
   are within a few millimetres of each other at the start of the horizon, so
   the bundle reads as a swept region near the robot and as separate choices
   out at the ends, which is exactly the thing that makes sampling worth
   drawing. The angular axis is odd so that straight ahead is one of the
   candidates rather than something the grid straddles. */
const NV = 20, NW = 17;

/* The control cycle, laid out along the substrate's travelling band.
 *
 * The band is one parameter shared by the whole world: a point carries where
 * along its own feature it sits, world.js advances uRun at 0.2 feature-lengths
 * a second, and anything within 0.16 of it -- the substrate's uRunWidth -- is
 * drawn brighter and a little larger. One lap is therefore five seconds, and
 * the two halves of it here are the two halves of one decision.
 *
 * The first half sweeps the window. A candidate's flow is the fraction of its
 * own horizon, and since every one of the 246 arcs that survive the disc is
 * integrated with the same 0.1 s tick over the same 2.0 s -- 21 poses each,
 * no exceptions, because a candidate that hits the disc is dropped rather
 * than truncated -- that fraction *is* simulated time. The band is the
 * isochrone of the forward simulation: where the body would be at that
 * instant under every command in the window at once. It is not a ring. At the
 * end of the horizon the slowest candidate has covered 0.05 m and the fastest
 * a full metre, so the front leaves the body as a blade and stretches out
 * into the far edge of the fan, which is what searching a velocity window
 * looks like when it is drawn honestly.
 *
 * The second half drives the one that won, and splitting the lap rather than
 * running both at once is the whole point: for two and a half seconds the
 * window is being priced, and for the next two and a half the body is on the
 * route that came out of it. Both halves carry the same 2.0 s of horizon so
 * both get the same half of the lap, which plays them at 0.8 of real time --
 * as fast as this is allowed to be while still reading as a machine working
 * rather than as a progress bar. The wrap closes it: the band leaves the end
 * of the driven route and reappears at the body, which is a controller
 * reaching its horizon and searching again, so the loop needs no seam.
 *
 * 0.16 of a lap is 0.32 of a candidate's horizon, which puts 0.64 s of
 * simulated time inside the front on either side. Wide, deliberately: 246
 * arcs converge on one origin, and a hairline drawn across them would be
 * invisible for the first third of the horizon and a dotted line for the
 * rest. What is wanted is a wave with a bright leading edge. */
const SEARCH = [0.00, 0.50];
const COMMIT = [0.50, 1.00];

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

   Which side each is on is a composition decision and not a coincidence. The
   waypoint is off to the robot's left, which from this camera is the open
   half of the frame, so the strand that wins leads the eye across clear glass
   rather than under the column of type; the disc is off to its right, so the
   wedge it takes out of the bundle is taken out of the half the panel is
   standing in. */
const WAYPOINT = { x: -0.34, z: 0.92 };
const BLOCK = { x: 0.26, z: 0.44, r: 0.22 };

/* The three terms every dynamic-window cost has had since the paper: how
   close this candidate ends to where you are trying to go, how much of the
   turn towards it is still outstanding when the horizon runs out, and how
   much speed it gives up to get there. The weights are a shape and not a
   tuning -- they set how quickly the bundle thins away from the route that
   wins, and nothing on this page reads a number off them. */
const W_GOAL = 1.0, W_HEAD = 0.22, W_SLOW = 0.30;

/* Points held in the bundle's pool, more than the largest tier draws of them
   so the walk in fill thins the fan rather than writing the same candidate
   twice. 30000 was not more: the structure band is 62% of 80000 at the high
   tier, which is 49600, so every candidate was being written to the page one
   and a half times over -- half the bundle drawn twice on top of itself, in a
   picture whose whole subject is how densely the window was sampled. */
const POOL = 60000;

/* Where the robot is standing when it has to decide, relative to the anchor,
   and which way it is facing. Set back towards the reader and pointing away,
   so the fan opens into the room rather than across the frame: a bundle that
   opens sideways puts half of itself behind the panel. */
const START_Z = 0.52;

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
  // Where along its own horizon each pooled point sits, mapped onto the half
  // of the lap the window is searched in. Written here because the parameter
  // is already computed to place the point at all.
  const PF = new Float32Array(POOL);
  let n = 0;
  for (let j = 0; j < traj.length && n < POOL; j++) {
    const pts = traj[j];
    const share = j === traj.length - 1 ? POOL - n
                : Math.min(POOL - n, Math.round(POOL * weight[j] / wsum));
    const wN = (weight[j] - 0.28) / 0.72;      // 1 is the cheapest candidate
    /* Splat size, and it has to be read against this station's own camera
       rather than against the material's defaults. The substrate sizes a point
       as sz * dpr * (26 / depth) and ceilings it at 7 * dpr; this eye stands
       2.32 from the bundle, so the bracket was 13.9 to 31.4 pixels and every
       one of them clamped to 14. Two things followed. The cost encoding was
       dead -- the cheapest candidate and the dearest drew exactly the same
       width -- and, worse, three hundred candidates spread across 1.28 m at
       508 px/m sit 2.2 pixels apart, so a 14-pixel splat covered its six
       nearest neighbours and the fan could not have resolved into arcs at any
       brightness at all. At 0.10 to 0.23 the same bracket is 2.2 to 5.2
       pixels, the cheap candidates are the thick ones again, and the sampling
       is drawn at the scale it was sampled at. */
    const sz = 0.10 + 0.13 * wN;
    for (let k = 0; k < share; k++) {
      const t = share < 2 ? 0 : (k / (share - 1)) * (pts.length - 1);
      const i0 = Math.min(pts.length - 2, t | 0), f = t - i0;
      const a = pts[i0], b = pts[i0 + 1];
      // How far through its own horizon this point is: 0 at the body, 1 at
      // the end of the 2.0 s. Uniform in step index, so it is uniform in both
      // arc length and simulated time, which is why it can be read as either.
      const u = t / Math.max(1, pts.length - 1);
      /* Cost spent as height as well as as density. A dynamic window is a
         planar thing and drawing it planar is honest and unreadable: thirty
         seven thousand additive points on one mathematical plane is a sheet of
         light with no arcs left in it, which is what this rendered as. Lifting
         each candidate by what it costs turns the same data into the surface
         the scoring actually is -- every rollout leaves the floor together at
         the body and separates by how bad it is getting, so the one that wins
         is the one that stays down. Nothing here is a measurement; the height
         is the cost function's shape, which is the point of drawing it. */
      const lift = LIFT * (1 - wN) * u;
      P3[n * 3]     = a.x + (b.x - a.x) * f;
      P3[n * 3 + 1] = a.y + (b.y - a.y) * f + lift;
      P3[n * 3 + 2] = a.z + (b.z - a.z) * f;
      PS[n] = sz;
      PF[n] = SEARCH[0] + (SEARCH[1] - SEARCH[0]) * u;
      n++;
    }
  }
  const NP = n;

  /* The poses. One where the decision is taken, one where the chosen rollout
     ends, and three along it -- a controller does not produce a curve, it
     produces a command that a body is in some pose under at every tick, and
     the triads are where those poses are.

     Each carries the moment of the drive its own tick falls at, so a pose
     lights as the body reaches it instead of all five standing lit at once.
     The three intermediate ones are ticks 5, 10 and 15 of the twenty, half a
     second of simulated time apart, which is 0.63 s of page time at this
     lap -- slow enough to read one frame arriving after another rather than
     as a strobe down the route. The first sits at the start of the drive
     because that is where the decision is taken: the window has just been
     priced, and the body has not moved yet. */
  const chosen = traj[best];
  const span = COMMIT[1] - COMMIT[0];
  const marks = [{ x: sx, z: sz, yaw: heading0, len: 0.26, sz: 1.2, f: COMMIT[0] }];
  for (let k = 1; k <= 3; k++) {
    const i = Math.round((k / 4) * (chosen.length - 1));
    marks.push({ x: chosen[i].x, z: chosen[i].z,
                 yaw: heading0 + cmd[best].w * i * TICK, len: 0.11, sz: 0.95,
                 f: COMMIT[0] + span * (i / (chosen.length - 1)) });
  }
  const tail = chosen[chosen.length - 1];
  marks.push({ x: tail.x, z: tail.z, yaw: cmd[best].th, len: 0.24, sz: 1.2, f: COMMIT[1] });

  /* A pose, written here rather than through lib's axisTriad, which has no
     flow to give: it draws through `triad`, and a triad is three strokes out
     of an origin with nothing to be partway along. So each axis is its own
     two-point stroke carrying a single constant slice, which lights the whole
     frame at once as the band reaches it. That is the honest reading of a
     pose -- the body is at that tick or it is not, there is no being halfway
     through one. The three directions are the columns of a yaw about world Y,
     written out because there is no matrix here to read them off. */
  const A = new THREE.Vector3(), B = new THREE.Vector3();
  function pose(m, n, w) {
    const c = Math.cos(m.yaw), s = Math.sin(m.yaw);
    const ax = [[c, 0, -s], [0, 1, 0], [s, 0, c]];
    const per = Math.max(3, Math.floor(n / 3));
    for (let k = 0; k < 3; k++) {
      A.set(m.x, y0, m.z);
      B.set(m.x + ax[k][0] * m.len, y0 + ax[k][1] * m.len, m.z + ax[k][2] * m.len);
      polyline([A, B], per, w, FRAME, m.sz, 0, 0x51a0 + k * 13, [m.f, m.f]);
    }
  }

  /* One table of noise, read three at a time, with two entries of overrun so
     the read past the wrap is a read rather than a bounds check. */
  const r = rng(0x7A11);
  const JN = 4096, JM = JN - 1;
  const jit = new Float32Array(JN + 2);
  for (let i = 0; i < JN; i++) jit[i] = r() * 2 - 1;
  jit[JN] = jit[0]; jit[JN + 1] = jit[1];

  return function fill(pos, kind, size, count, flow) {
    const { S, P, F } = bands(pos, kind, size, count, flow);

    const nB = S.share(1.0), per = NP / Math.max(1, nB);
    for (let k = 0; k < nB; k++) {
      const i = (k * per) | 0, o = i * 3, j = (k * 3) & JM;
      // Jittered a couple of millimetres across the floor and a shade less
      // through it: the fan is flat because the robot is on the ground, and a
      // mathematical plane of sixty thousand additive points is a sheet of
      // light rather than a set of arcs.
      S.put(P3[o]     + jit[j]     * 0.007,
            P3[o + 1] + jit[j + 1] * 0.004,
            P3[o + 2] + jit[j + 2] * 0.007, STRUCTURE, PS[i], PF[i]);
    }
    S.pad(0.02);

    // The route that won, on the second half of the lap. It is driven after
    // the window has been searched rather than while it is being searched,
    // which is the order the controller does it in and the only order in
    // which the commitment reads as one.
    /* 0.40, not the 1.7 this was drawn at, and for the same reason the bundle
       itself had to be rescaled: the substrate sizes a point as
       sz * dpr * (26 / depth) and ceilings it at 7 * dpr, and from this
       station's 2.32 m eye 1.7 is 38 pixels before the clamp. The travelling
       band widens a point it is over by 55%, which at 1.7 is 59 pixels -- also
       clamped to 14. So the entire size half of the band was being thrown away
       on the one strand it most needed to be visible on, and what was left of
       it was a colour boost landing on pixels that were already saturated.
       Frame-differenced over a lap, the search half of the cycle moved 12.4%
       of its pixels and the drive half 3.5%, most of that the cloud's own
       drift. At 0.40 the strand is 9.0 pixels at rest and 13.9 under the band,
       so the boost survives whole and the commitment reads as a thing being
       driven rather than as a line that is merely present. */
    polyline(chosen, P.share(0.94), P, PATH, 0.40, 0.006, 0x2b4d, COMMIT);
    P.pad(0.012);

    const each = Math.floor(F.share(0.92) / marks.length);
    for (const m of marks) pose(m, each, F);
    F.pad(0.01);
  };
}
