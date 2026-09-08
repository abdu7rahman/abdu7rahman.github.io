/* Formation 04 -- the window, priced, and the one command that came out of it.
 *
 * This stands at the benchmark rig's own anchor, which is the point: the
 * instrument does not fly away and get replaced, it comes apart where it
 * stood. A plate, a plane and five volumes standing 1.6 up collapse onto the
 * floor they were bolted to and spread out across it.
 *
 * The section is a list of what the work was built with, and its planning row
 * is almost entirely samplers -- A*, Theta*, SMAC, RRT and RRT-Connect, BIT*,
 * DWA, Pure Pursuit, Stanley, TEB, MPPI. Drawn as a wall of labels that is a
 * word cloud; drawn as bars it is the previous formation again with different
 * numbers. So it is drawn as the thing every one of those names actually
 * does, which they all do the same way: propose many futures from the state
 * you are in, price them, and commit to one.
 *
 * What is new is that it is no longer a fan invented for the picture. Every
 * number below is read off `vendor/qlc/plan/dwa.py` and the two schemas it
 * runs on -- the holonomic dynamic window this site vendors, benchmarks and
 * runs in the browser on the demo page. The window is that controller's
 * `_window`: a 3-cube over (vx, vy, wz) whose extent is one tick of the Go2's
 * acceleration limits, sampled 9 x 5 x 11 = 495. The rollouts are its
 * `_rollout`: yaw integrated in closed form, position as the running sum of
 * the rotated body velocity, twenty steps of 0.1 s. The score is its
 * `compute`: heading at closest approach, speed, the Nav2 warning band, and
 * the caution term, at the gains `DWAConfig` ships. The one thing this file
 * cannot carry is a 240 x 240 cost grid, so the hazard is a disc with Nav2's
 * inflation profile around it rather than a course; that substitution is the
 * only place the picture parts company with the controller, and it is marked
 * where it happens.
 *
 * It used to read as an undifferentiated white spray -- streaks blowing out
 * of frame with two teal marks at the root and no structure anywhere in it.
 * Three things were wrong and all three are geometry rather than exposure.
 *
 * The window was the wrong shape. 0.5 m/s and 1.5 rad/s are real numbers, the
 * scales the cloned controller in assets/dwa_clone.json normalises its two
 * outputs by, but they are the whole command envelope, and a dynamic window is
 * what an acceleration limit reaches out of that envelope in one tick. The
 * previous station's own table draws exactly this distinction and puts a
 * figure on both: 36 trajectories for the accel-limited window the controller
 * evaluates each cycle, 2,626 for the full velocity space. The old picture
 * drew the second and called it the first. Drawn as the envelope it is a
 * half-circle fan; drawn as the window it is a narrow, mostly-forward sheaf.
 *
 * The points were then spread evenly across the candidates, so the ones with
 * no room on the page got as many as the ones with room to spare. And the
 * whole thing was drawn flat, which projects a 3-cube onto a plane and asks
 * the reader to see 495 curves in it.
 *
 * One thing to be careful of if any of these numbers ever get reconciled: the
 * two DWAs on this page are not the same DWA. The harness the Measured tables
 * report was run at a 2.5 s horizon and dt = 0.1, which is 25 steps; the
 * vendored controller this formation draws ships `horizon = 2.0` and the same
 * dt, which is 20, and `_n_steps` rounds it. Twenty is right here because
 * `vendor/qlc/plan/dwa.py` is the thing being drawn.
 *
 * So: the drawn density follows the separation, along a strand and across the
 * bundle both, which is what makes the arcs arcs; and the ranking is spent as
 * height, which is what unfolds the cube. The floor carries the plan of the
 * search -- the window's two outer edges, the horizon it was simulated to,
 * the contour the controller refuses to put a body sample inside -- and the
 * sheet standing above it is the other 400, sorted by what they scored, with
 * the winner along its top edge.
 *
 * The accent arrives from the rig as the profile across the five bars and
 * leaves as the route through the corridor. In between it is the command that
 * won: one strand out of the 402 that were priced, from a window of 495 of
 * which 93 were never allowed to be candidates at all.
 */
import * as THREE from "three";
import { bands, polyline, rng, STRUCTURE, PATH, FRAME } from "./lib.js";

/* Offsets from the station anchor; the caller adds it.
 *
 * Solved against the layout in front of it rather than against the bundle
 * alone, because the reading column is no longer a wall down one side. It is
 * biased inward -- 40% of the free frame to its left, the rest to its right --
 * and it fades out over its own gutter at both ends, so the world is read in
 * two margins with the middle of it running under the type. Measured off the
 * stylesheet at 1440x900, this station's column is 998 px of the 1440 and
 * framing.js's area-weighted shear puts it at +0.072 in NDC, leaving 177 px
 * clear on the left and 265 on the right.
 *
 * A 2.4 m bundle cannot be made to fit either of those margins at 1:1. The
 * right one is 265 px, so the bundle would have to be drawn at 110 px to the
 * metre, and at this lens that is a 13.4 m standoff -- an eye back at the
 * hero's anchor, half the length of a 26 m corridor away from the thing it is
 * looking at. So it is composed across the whole frame instead, and the two ends are what the
 * reader is given. The body, its pose triad and the root of the bundle sit in
 * the left margin; the horizon, the resolved strands and the winner's last
 * pose sit in the right. What is behind the type is the transit between them,
 * and the travelling band crosses it once a lap, which is what joins the two
 * halves back up.
 *
 * The lens is the number that makes it possible. From 2.71 back at 34 degrees
 * the formation's depth runs 2.30 to 4.09, and the substrate fades everything
 * nearer than 2.2 out (`smoothstep(0.7, 2.2, depth)`), so it clears that by
 * 0.10. The same shot at 44 degrees is the same frame from 0.757 of the
 * standoff -- the ratio of the two half-angle tangents -- which puts the near
 * edge at 1.74 and a third of the bundle inside the fade. Measured off what
 * this file writes, every point of it lands at x = 73..1316 of a 1440 frame
 * with the body at 119 and the winning command's last pose at 1230, and at
 * 1916x953 the same two land at 318 and 1494 against panel edges of 355 and
 * 1383. One end in each margin at both, and nothing outside the frame at
 * either.
 *
 * The eye rises to 1.70 over the floor at 2.71 back, which is 31 degrees: far
 * enough over the sheet to open the spread and low enough that the height the
 * ranking is spent on is still a height and not a plan view. Measured is at
 * 0.80 and 3.60 on this same anchor, so the crossing between them lifts the
 * camera 0.90 and brings it forward 0.89, which is the small move that pair
 * of stations is for.
 *
 * The look point is not the middle of the bundle, and the 0.40 that lifts it
 * off the floor is not a framing decision at all. camera-rig.js hands the
 * finish pass `|eye - look|` as its focus distance, and post.js blurs by
 * `|z - focus| / z * 1.15` up to a 0.0055 ceiling in UV. Aimed at the middle
 * the focus lands at 3.17 -- and the half of this formation a reader can see
 * is not the middle, it is the two margins. The right one, where the strands
 * separate, sits at a median depth of 2.62, which at that focus is 0.00133 in
 * UV: 1.9 px across and 1.2 down, before the off-axis term adds another 0.9
 * across out there. Strands 11 px apart do not survive 2.8 px of blur, and
 * the first render of this station showed exactly that -- geometry that had
 * resolved, smeared.
 *
 * So the look point is slid along its own ray until the focus reads 2.70. It
 * is the same direction vector, shorter, so the camera's orientation and the
 * whole composition are unchanged, and the blur is spent where there is
 * nothing to lose by it: 0.3 px across in the right margin against 1.3 in the
 * left, where the only things standing are a pose triad and the root of the
 * bundle and neither has a neighbour it could be confused with. */
export const VIEW = { pos: [0.20, 1.70, 2.71], look: [0.20, 0.296, 0.404], fov: 34 };

/* ── the controller, quoted ──────────────────────────────────────────────
 *
 * Every constant in this block is read off the vendored repository and none
 * of them is chosen here. `Go2Params` is the Unitree Go2's command envelope
 * and its acceleration limits; `DWAConfig` is the controller's resolution,
 * horizon and gains. The comments on both say why each is what it is, and
 * this file is not the place to repeat them -- what matters here is that the
 * shape being drawn is theirs.
 *
 * The window's *extent* is the interesting part and it is the part that was
 * wrong before. It is not the command envelope. `_window` intersects the
 * envelope with what one tick of acceleration can reach from the velocity the
 * body is already at, so it is 2 * max_a * dt on a side: 0.30 m/s of forward,
 * 0.20 of strafe, 0.60 rad/s of yaw. That is a narrow sheaf, not a fan, and
 * the difference is the whole reason the old picture could not resolve. */
const MAX_VX = 1.20, MIN_VX = -0.60, MAX_VY = 0.60, MAX_WZ = 1.80;
const MAX_AX = 1.50, MAX_AY = 1.00, MAX_AWZ = 3.00;
const BODY_L = 0.70, BODY_W = 0.31;
const TICK = 0.1, HORIZON = 2.0;
const STEPS = Math.round(HORIZON / TICK);          // 20, as `_n_steps` computes it
const NVX = 9, NVY = 5, NWZ = 11;                  // 495 rollouts
const G_HEAD = 5.0, G_SPEED = 0.5, G_OBS = 5.0, G_CAUTION = 2.0;
const LOOKAHEAD = 0.90;
/* The cost vocabulary: DWA rejects a rollout whose swept footprint reaches
   253, prices the band from 160 up to it, and the hand-tuned legged costmap
   inflates around a wall with Nav2's own layer -- saturating at the inscribed
   radius, decaying at 3.0 per metre, reaching zero at 0.40. */
const LETHAL = 253, WARN = 160;
const INFLATION_R = 0.40, COST_SCALING = 3.0, INSCRIBED = 0.5 * BODY_W;

/* Which velocity the body is at when it has to decide, and it is derived
   rather than picked. Two of the three axes are unclamped anywhere near the
   middle of the envelope, so the only question is vx: the window is
   [vx - 0.15, vx + 0.15] intersected with [-0.60, 1.20], and the fastest
   state that still gets the whole 0.30 m/s of it is vx = max_vx - max_ax * dt
   = 1.05. So this is the biggest window the controller ever evaluates, at the
   fastest the robot can be going and still have all of it. It measures 0.90 to
   1.20 m/s, plus or minus 0.10 of strafe, plus or minus 0.30 rad/s of yaw.

   A real run does not spend much time there -- driven over course 0 of the
   suite with the hand-tuned costmap, the body reached the goal in 292 ticks
   at a median vx of -0.516, because a quadruped that can strafe has no reason
   to turn round and the scoring never asks it to. The windows it evaluated on
   the way were 0.71 to 1.49 m of ground each. This one is 1.80 to 2.41, which
   is the same window at the speed the datasheet is written about. */
const V0 = [MAX_VX - MAX_AX * TICK, 0, 0];

/* Where the body stands and which way it faces, relative to the anchor.
   Forward is +X so the bundle runs across the frame left to right, and the
   yaw spread therefore lands in Z, which from this eye is depth -- the near
   half of the fan is drawn a little larger by the substrate's own
   `26 / depth`, which is the perspective doing the work of separating the
   sheets that the projection would otherwise stack. */
const BODY_X = -1.20, BODY_Z = 0.05;

/* The two things in the scene that are not the controller.
 *
 * The local goal is where `_local_goal` puts it: `lookahead` metres along the
 * plan from the body's closest approach to it, which is 0.90 for this robot
 * and is the distance the heading term is measured against. Its *bearing* is
 * a composition decision -- the plan is not modelled here, only the point it
 * hands the controller -- and 0.10 rad puts it a little to the body's right,
 * which is the side this camera stands on, so the strand that wins comes
 * forward and down the frame rather than away up it.
 *
 * The hazard is one wall disc. The course generator scatters rectangular
 * walls between 0.04 and 0.16 of a 12 m course, so 0.24 is the half-width of
 * the smallest wall this benchmark builds. Its position is the other
 * composition decision: off to the body's left, which is the far side from
 * this camera, so the bite it takes out of the window is taken out of the
 * half the perspective already compresses and the winner keeps the open half.
 *
 * Placed there it kills 93 of the 495 -- 39 of the 45 rollouts at the hardest
 * right yaw, then 28, 17 and 9 as the yaw eases, and none at all on the other
 * six. A real tick rejects between 0 and 209 of them; over the 292 ticks of
 * that course, 161 rejected at least one and the median tick kept 479. This
 * is a harder tick than the median and an easier one than the worst. */
const GOAL_BEARING = 0.10;
const HAZARD = { x: 1.60, z: -0.70, r: 0.24 };

/* How much height the ranking is spent on. 0.40 puts 168 px between the
   bottom of the sort and the top of it at the body, and 181 out at the
   horizon where the bundle is nearer the eye. It does not make the formation
   any taller: flattened, it covers 418 px of the 900, and lifted it covers
   363, because over most of the window the ranking runs the opposite way to
   the yaw spread and the two partly cancel. What the height buys is not size.
   It is that two candidates lying on top of each other on the floor are not
   on top of each other on the page. */
const LIFT = 0.40;

/* The control cycle, laid out along the substrate's travelling band.
 *
 * The band is one parameter shared by the whole world: a point carries where
 * along its own feature it sits, world.js advances uRun at 0.2 feature-lengths
 * a second, and anything within 0.16 of it -- the substrate's uRunWidth -- is
 * drawn brighter and a little larger. One lap is five seconds and the two
 * halves of it are the two halves of one decision.
 *
 * The first half sweeps the window. A candidate's flow is the fraction of its
 * own horizon, and every rollout is integrated with the same 0.1 s tick over
 * the same 2.0 s, so that fraction is simulated time and the band is the
 * isochrone of the forward simulation: where the body would be at that
 * instant under every command in the window at once. It is not a ring. At the
 * end of the horizon the slowest candidate has covered 1.80 m and the fastest
 * 2.41, so the front leaves the body as a blade and arrives at the horizon
 * still a blade, 0.59 to 0.60 m thick -- which is the vx axis of the window,
 * made visible by the only channel that can show it.
 *
 * The second half drives the one that won, and splitting the lap rather than
 * running both at once is the point: for two and a half seconds the window is
 * being priced, and for the next two and a half the body is on the command
 * that came out of it. The wrap closes it -- the band leaves the end of the
 * driven route and reappears at the body, which is a controller reaching its
 * horizon and searching again, so the loop needs no seam.
 *
 * The moment between them is 0.50, and three things carry it: the pose the
 * decision is taken from, and the two horizon arcs the search has just
 * reached. They light together, once a lap, and that is the argmax. */
const SEARCH = [0.00, 0.50];
const COMMIT = [0.50, 1.00];

/* How the points are spread along a candidate's own horizon.
 *
 * A bundle of constant-twist rollouts does not diverge evenly, and the numbers
 * are severe. Measured across all 495 at the same moment of simulated time,
 * the median distance from a rollout to its nearest neighbour is 0.5 mm a
 * tenth of the way through the horizon, 2.5 mm a quarter, 7.9 mm at the half,
 * 8.3 mm at three quarters and 24.0 mm at the end -- 0.2 of a pixel to 11 at
 * this station's 466 to the metre. Spread the points evenly along each arc and
 * the drawn density goes as one over that, which is a white disc at the body
 * with a few threads leaving it. It is exactly what this station rendered as.
 *
 * So the density follows the separation: dN/du goes as NEAR + u*u, flat on the
 * page rather than flat along the wire. 0.047 is fitted to those measurements
 * rather than chosen: it is exact at the quarter and at the end and 14% under
 * at the half, and 68% over at three quarters, where the median separation has
 * a flat spot the lattice puts there and no quadratic is going to follow it.
 * At a tenth of the horizon it sits at over twice the measured separation, and
 * that part is deliberate: at the honest value the body has no matter on it at
 * all and the isochrone has nothing to leave from. It puts 1.3% of a
 * candidate's points inside that first tenth, where an even walk put 10%. */
const NEAR = 0.047;

/* Splat, in the size the substrate wants: it draws a point at
   `sz * dpr * (26 / depth)` device pixels and ceilings it at `7 * dpr`, so in
   CSS pixels the bracket is `sz * 26 / depth` capped at 7 whatever the display
   is. The bundle runs from 2.30 to 3.62 of depth, so this pair draws it
   between 1.0 and 3.5 px, and 5.1 at the widest under the travelling band --
   nothing in it reaches the clamp. That has to stay small: the 402 survivors
   sit 23 mm apart at the horizon, which is 11 px on the page, and a splat wide
   enough to be comfortable is a splat that covers its neighbours and hands
   back the smear this formation exists to stop being. */
const SZ_LO = 0.17, SZ_HI = 0.31;

export function build(ctx) {
  const anchor = ctx.anchor;
  const y0 = anchor.y;                       // the floor the rig stood on
  const ox = anchor.x + BODY_X, oz = anchor.z + BODY_Z;

  /* ── the window ──────────────────────────────────────────────────────
     `_window`, to the letter: each axis is the current velocity plus and
     minus one tick of its acceleration limit, intersected with the envelope,
     then `linspace`d and meshgridded. The order of the three loops is the
     order `indexing="ij"` produces, which matters only in that a candidate's
     index here is its index there. */
  const axis = (lo, hi, n) => {
    const a = [];
    for (let i = 0; i < n; i++) a.push(n === 1 ? lo : lo + (hi - lo) * i / (n - 1));
    return a;
  };
  const VX = axis(Math.max(MIN_VX, V0[0] - MAX_AX * TICK), Math.min(MAX_VX, V0[0] + MAX_AX * TICK), NVX);
  const VY = axis(Math.max(-MAX_VY, V0[1] - MAX_AY * TICK), Math.min(MAX_VY, V0[1] + MAX_AY * TICK), NVY);
  const WZ = axis(Math.max(-MAX_WZ, V0[2] - MAX_AWZ * TICK), Math.min(MAX_WZ, V0[2] + MAX_AWZ * TICK), NWZ);
  const win = [];
  for (const vx of VX) for (const vy of VY) for (const wz of WZ) win.push({ vx, vy, wz });

  /* ── the rollouts ────────────────────────────────────────────────────
     `_rollout`: yaw closed form, position the running sum of the body
     velocity rotated into the world. Holonomic, so vy is a real axis of the
     search and not a constraint violation -- a quadruped strafes, and that is
     the one extension the vendored controller makes to the diff-drive it was
     ported from.

     Written from step 1, as there, and the body's own pose prepended so the
     drawn strand starts where the body is. The prepended pose is not scored:
     the controller prices where a command *takes* it, and standing still is
     not a thing any of these commands does. */
  const traj = [], yawEnd = [];
  for (const w of win) {
    let x = 0, z = 0;
    const pts = [new THREE.Vector3(ox, y0, oz)], yaw = [];
    for (let s = 1; s <= STEPS; s++) {
      const th = w.wz * s * TICK;
      x += (w.vx * Math.cos(th) - w.vy * Math.sin(th)) * TICK;
      z += (w.vx * Math.sin(th) + w.vy * Math.cos(th)) * TICK;
      pts.push(new THREE.Vector3(ox + x, y0, oz + z));
      yaw.push(th);
    }
    traj.push({ pts, yaw });
    yawEnd.push(w.wz * HORIZON);
  }

  const gx = ox + LOOKAHEAD * Math.cos(GOAL_BEARING);
  const gz = oz + LOOKAHEAD * Math.sin(GOAL_BEARING);
  const hx = ox + HAZARD.x, hz = oz + HAZARD.z;

  /* ── the cost the sweep reads ────────────────────────────────────────
     This is the substitution, and it is the only one. The controller samples
     a 240 x 240 grid; there is no grid here, so the same field is evaluated
     in closed form around one disc. The profile is Nav2's inflation layer as
     `cost/base.py` reproduces it -- 253 inside the inscribed radius, then
     252 * exp(-3.0 * (d - r_i)) out to the inflation radius, then nothing.
     Ground away from the hazard is free, which is what the analytic costmap
     says about ground with no slope, no step and no roughness on it. */
  const cellCost = (d) => {
    if (d <= INSCRIBED) return LETHAL;
    if (d > INFLATION_R) return 0;
    return (LETHAL - 1) * Math.exp(-COST_SCALING * (d - INSCRIBED));
  };

  /* ── the score ───────────────────────────────────────────────────────
     `compute`, term for term. The footprint is swept at the three body-axis
     points `_body_offsets` returns rather than at the centre, because a 0.70 m
     body checked at its middle clears an obstacle and drags its nose through
     it. The heading term is taken at the rollout's closest approach to the
     local goal and not at where it ends, which is the fix that repository
     carries in its history: the shortest rollout in this window covers 1.80 m
     against a 0.90 m lookahead, so every one of them passes the local goal and
     keeps going, and scoring the terminal pose would rank them by how far past
     it they got. */
  const bodyOff = [-0.5 * BODY_L, 0, 0.5 * BODY_L];
  const cost = [], lethal = [];
  for (let j = 0; j < win.length; j++) {
    const { pts, yaw } = traj[j], w = win[j];
    let hit = false, band = 0, sum = 0, n = 0, near = Infinity;
    for (let s = 0; s < STEPS; s++) {
      const p = pts[s + 1], c = Math.cos(yaw[s]), sn = Math.sin(yaw[s]);
      for (const l of bodyOff) {
        const d = Math.hypot(p.x + l * c - hx, p.z + l * sn - hz) - HAZARD.r;
        const q = cellCost(d);
        if (q >= LETHAL) hit = true;
        band += Math.min(1, Math.max(0, (q - WARN) / (LETHAL - WARN)));
        sum += q; n++;
      }
      const dd = Math.hypot(p.x - gx, p.z - gz);
      if (dd < near) near = dd;
    }
    const speed = Math.hypot(w.vx, w.vy) / MAX_VX;
    lethal.push(hit);
    cost.push(G_HEAD * (1 / (1 + near)) + G_SPEED * speed
              - G_OBS * Math.min(10, band / n * 10)
              - G_CAUTION * speed * Math.min(1, sum / n / LETHAL));
  }

  /* Who survived. A rollout that reaches a lethal cell is scored -inf and is
     not drawn: it is not a candidate that came last, it is a candidate the
     controller was never allowed to consider, and the gap it leaves is the
     only mark the hazard needs on a picture whose subject is the sampling.
     The window's own edges are still drawn, on the floor, so the fan failing
     to reach one of them reads as a bite rather than as a smaller fan. */
  const live = [];
  for (let j = 0; j < win.length; j++) if (!lethal[j]) live.push(j);

  let best = live[0];
  for (const j of live) if (cost[j] > cost[best]) best = j;

  /* Rank, not score, and the measurement is what settled it. The composite
     score over the 402 survivors runs -4.557 to 5.462 and 323 of them are
     within a tenth of the top: only the 84 that graze the hazard's warning
     band are anywhere else, and only two of those fall into the bottom tenth
     of the range. Spent linearly as height that is one flat sheet with two
     strands hanging off the bottom of it, which draws the outlier and hides
     the search. Spent as rank -- where a candidate came in the
     ordering, which is the only thing `argmax` reads -- every survivor gets
     its own height and the sheet is the sort. */
  const order = live.slice().sort((a, b) => cost[a] - cost[b]);
  const rank = new Float64Array(win.length);
  for (let k = 0; k < order.length; k++) rank[order[k]] = k / Math.max(1, order.length - 1);

  /* How much room each strand has, measured rather than assumed.

     The taper above spends points along a strand in proportion to how far it
     is from its neighbours. This is the same rule turned across the bundle: a
     candidate with nothing near it gets drawn solid and one buried in the
     middle of the sheaf gets drawn sparse, because the alternative is thirty
     strands' worth of light landing on one strand's worth of page. Taken at
     steps 10, 15 and 20 -- the outer half of the horizon, where the points
     actually are. Inside that, the survivors stand 2.4 mm apart a quarter of
     the way through and 0.9 mm a tenth, which ranks them by nothing.

     Over the 402 survivors this runs 4.5 mm to 55.7 mm about a median of
     11.9, a factor of twelve, and it is what turns the 81 surviving candidates
     that do not strafe into a comb: they are the ones with a whole sheet's
     width to themselves, and at the horizon they stand 75 mm apart against the
     bundle's own 23. */
  const room = new Float64Array(win.length);
  for (const a of live) {
    let acc = 0;
    for (const s of [9, 14, 19]) {
      let m = Infinity;
      const p = traj[a].pts[s + 1];
      for (const b of live) {
        if (b === a) continue;
        const q = traj[b].pts[s + 1];
        const d = Math.hypot(p.x - q.x, p.z - q.z);
        if (d < m) m = d;
      }
      acc += m;
    }
    room[a] = acc / 3;
  }

  /* What each surviving candidate is worth of the budget: the room it has,
     times its own arc length so the points-per-metre is the same on a 1.80 m
     rollout as on a 2.41 m one, times a shallow weight on the ranking.

     The exponent on the room is the part that had to be swept. At 1.0 the top
     of the sheet stayed a smear: the strands are a two-parameter family, so a
     region with n times the strand density has n times the light even after
     each strand is thinned by its spacing, and what comes back is a bright
     ridge exactly where the winner is. Swept over the whole surviving set,
     1.0 hands out 36 points to the sparsest strand and 545 to the densest,
     1.6 hands out 16 and 1107, and 2.2 hands out 6 and 2002. 1.6 is where the
     comb resolves and the outermost strands are still strands; at 2.2 they are
     six points and a memory.

     The weight on the ranking is 0.60 to 1.00 and stays shallow for a reason
     the score itself gives: 323 of the 402 survivors are within a tenth of the
     top, and they are also the ones packed tightest around the winner, so
     anything steeper spends most of the budget on the strands with the least
     room to spend it in. The ranking is carried by height and by splat width
     instead, where it costs nothing to read. */
  const weight = new Float64Array(win.length);
  let spend = 0;
  for (const j of live) {
    const arc = Math.hypot(win[j].vx, win[j].vy) * HORIZON;
    weight[j] = Math.pow(room[j], 1.6) * arc * (0.60 + 0.40 * rank[j]);
    spend += weight[j];
  }

  /* u along a candidate, from the density at the top of this file, by
     inverting its integral. u*u*u/3 + NEAR*u is monotone and its derivative
     never falls below NEAR, so Newton from the NEAR = 0 answer converges hard:
     three passes leave a worst residual of 3.2e-6 of the range over the whole
     unit interval. Cheap enough to run per point at build and exact enough
     that the taper is the one that was solved for rather than one near it. */
  const KU = 1 / 3 + NEAR;
  function along(xi) {
    const K = xi * KU;
    let u = Math.cbrt(3 * K);
    for (let i = 0; i < 3; i++) u -= (u * u * u / 3 + NEAR * u - K) / (u * u + NEAR);
    return u < 0 ? 0 : u > 1 ? 1 : u;
  }

  /* ── the floor plan ──────────────────────────────────────────────────
     Three kinds of thing, all of them exact members or exact loci of the
     window, and all of them on the floor at zero lift so that the ground
     carries the geometry of the search and the height above it carries
     nothing but the ranking.

     The two edges are the members of the window whose horizon poses land
     furthest to either side: the outline of everything the controller was
     willing to consider, which is not the same set as the one it was allowed
     to price. One of the two is itself rejected -- the hazard sits on it --
     and that is the point of drawing them at all: the sheet stopping short of
     an edge that is still there is what a bite out of a search looks like.
     They are drawn here instead of in the bundle rather than as well as,
     because a candidate drawn twice in two colours competes with itself, which
     was true of the winner before and is true of these.

     The two horizon arcs are the terminal poses at zero strafe across the
     eleven yaw samples, at the fastest command in the window and at the
     slowest. Between them is where the body can be at 2.0 s, and they stand
     0.591 to 0.600 m apart, which is the 0.30 m/s of vx the window is wide
     spent over the two seconds. Straight between samples, because eleven
     commands is all the resolution the horizon has. */
  let edgeA = live[0], edgeB = live[0];
  {
    // Sideways is measured across the body's own forward, which is +X here.
    let lo = Infinity, hi = -Infinity;
    for (let j = 0; j < win.length; j++) {
      const z = traj[j].pts[STEPS].z;
      if (z < lo) { lo = z; edgeA = j; }
      if (z > hi) { hi = z; edgeB = j; }
    }
  }
  const arcOuter = [], arcInner = [];
  for (let k = 0; k < NWZ; k++) {
    const mid = (NVY - 1) >> 1;
    arcOuter.push(traj[(NVX - 1) * NVY * NWZ + mid * NWZ + k].pts[STEPS]);
    arcInner.push(traj[mid * NWZ + k].pts[STEPS]);
  }

  /* The contour the sweep is rejected on. Nav2's inflation saturates at 253
     inside the inscribed radius, and 253 is the threshold `compute` refuses,
     so this circle -- the hazard grown by half the body's width -- is exactly
     the locus a footprint sample may not enter. It carries no flow: it is a
     fact about the map, not a stage of the cycle, and the one thing on this
     station that does not run. */
  const ring = [];
  {
    const R = HAZARD.r + INSCRIBED, N = 72;
    for (let i = 0; i <= N; i++) {
      const a = i / N * Math.PI * 2;
      ring.push(new THREE.Vector3(hx + R * Math.cos(a), y0, hz + R * Math.sin(a)));
    }
  }

  /* The winning command, lifted onto the sheet it came top of.

     Drawn on the floor it was wrong twice over: it ran along under the bundle
     rather than along the edge of it, so the gap the bundle leaves where the
     winner used to be had nothing in it, and the one strand the whole picture
     is about was the only thing in the frame that was not where its ranking
     put it. It is at rank 1 by construction -- it is the argmax -- so its
     height is the full lift and the accent is the top edge of the sheet. */
  const chosen = traj[best].pts.map((p, i) =>
    new THREE.Vector3(p.x, y0 + LIFT * (i / STEPS), p.z));

  /* Two poses, and only two. A triad at every tick down the route was the old
     scheme and it read as a strobe; what the picture needs is where the
     decision is taken and where the horizon it was taken over runs out. The
     first carries 0.50, the instant the window has finished being priced; the
     second carries 1.00, the end of the drive, and it sits at the lifted end
     of the strand it terminates rather than under it.

     The second is under half the length of the first and drawn thinner, and
     that is a correction rather than a preference. It stands at 2.62 of depth
     against the body's 3.16, so the same 0.24 that reads as a pose in the left
     margin came out 142 by 193 px in the right one -- a teal cross laid across
     the only part of the bundle a reader can resolve, which is what the first
     render of this station showed. At 0.11 it is 64 by 86. */
  const marks = [
    { x: ox, y: y0, z: oz, yaw: 0, len: 0.24, sz: 0.38, f: COMMIT[0] },
    { x: chosen[STEPS].x, y: chosen[STEPS].y, z: chosen[STEPS].z,
      yaw: yawEnd[best], len: 0.11, sz: 0.30, f: COMMIT[1] }
  ];

  /* A pose, written here rather than through lib's axisTriad, which has no
     flow to give: it draws through `triad`, and a triad is three strokes out
     of an origin with nothing to be partway along. So each axis is its own
     two-point stroke carrying a single constant slice, which lights the whole
     frame at once as the band reaches it. That is the honest reading of a
     pose -- the body is at that tick or it is not. The three directions are
     forward, up, and forward turned a quarter, for a body whose heading is
     measured about world Y from +X. */
  const A = new THREE.Vector3(), B = new THREE.Vector3();
  function pose(m, n, w) {
    const c = Math.cos(m.yaw), s = Math.sin(m.yaw);
    const ax = [[c, 0, s], [0, 1, 0], [-s, 0, c]];
    const per = Math.max(3, Math.floor(n / 3));
    for (let k = 0; k < 3; k++) {
      A.set(m.x, m.y, m.z);
      B.set(m.x + ax[k][0] * m.len, m.y + ax[k][1] * m.len, m.z + ax[k][2] * m.len);
      polyline([A, B], per, w, FRAME, m.sz, 0, 0x51a0 + k * 13, [m.f, m.f]);
    }
  }

  /* The local goal, as a cross on the floor rather than a dot, because a dot
     in an additive cloud is indistinguishable from a dense patch of anything
     else. It is the point every one of the 495 was measured against, so it
     lights with the decision. */
  const goalCross = [
    [new THREE.Vector3(gx - 0.09, y0, gz), new THREE.Vector3(gx + 0.09, y0, gz)],
    [new THREE.Vector3(gx, y0, gz - 0.09), new THREE.Vector3(gx, y0, gz + 0.09)]
  ];

  /* One table of noise, read three at a time, with two entries of overrun so
     the read past the wrap is a read rather than a bounds check. Three
     millimetres either way across the floor and two in height: enough that
     fifty thousand additive points are not lying on a mathematical surface,
     and little enough that it does not close the 11 px the strands have
     won. */
  const r = rng(0x7A11);
  const JN = 4096, JM = JN - 1;
  const jit = new Float32Array(JN + 2);
  for (let i = 0; i < JN; i++) jit[i] = r() * 2 - 1;
  jit[JN] = jit[0]; jit[JN + 1] = jit[1];

  return function fill(pos, kind, size, count, flow) {
    const { S, P, F } = bands(pos, kind, size, count, flow);

    /* The bundle. Every survivor but the winner and the two edges, resampled
       into its share of the structure band. Uniform in step index is uniform
       in arc length here, because a constant twist is a constant speed -- the
       one simplification a constant-velocity rollout is allowed to make, and
       it is what lets the taper be applied to the step index and still mean
       what it says about the page. */
    const budget = S.room;
    let used = 0;
    for (const j of live) {
      if (j === best || j === edgeA || j === edgeB) continue;
      const share = Math.min(budget - used, Math.max(2, Math.round(budget * weight[j] / spend)));
      if (share <= 0) break;
      const pts = traj[j].pts;
      const sz = SZ_LO + (SZ_HI - SZ_LO) * rank[j];
      const lift = LIFT * rank[j];
      for (let k = 0; k < share; k++) {
        const u = along(share < 2 ? 0 : k / (share - 1));
        const t = u * STEPS;
        const i0 = Math.min(STEPS - 1, t | 0), f = t - i0;
        const a = pts[i0], b = pts[i0 + 1];
        const n = (used * 3) & JM;
        S.put(a.x + (b.x - a.x) * f + jit[n] * 0.003,
              y0 + lift * u + jit[n + 1] * 0.002,
              a.z + (b.z - a.z) * f + jit[n + 2] * 0.003,
              STRUCTURE, sz, SEARCH[0] + (SEARCH[1] - SEARCH[0]) * u);
        used++;
      }
    }
    S.pad(0.012);

    /* The command that won, on the second half of the lap. It is driven after
       the window has been searched rather than while it is being searched,
       which is the order the controller does it in and the only order in
       which the commitment reads as one. It is not in the bundle: a rollout
       that has been committed to is not a candidate any more, and the gap it
       leaves along the top edge of the sheet is the shape of the decision.

       0.40, because the substrate ceilings a splat at 7 CSS px and this
       strand sits between 2.62 and 3.16 of depth: it draws 3.3 to 4.0 px at
       rest and 5.1 to 6.2 under the travelling band, so the band's 55% of
       extra width survives whole instead of being thrown away against the
       clamp. At the 1.7 this used to be drawn at, the same strand is 16.9 px
       before the clamp and 26 under the band -- both on the wrong side of it,
       so the entire size half of the travelling band was being spent on the
       one strand that most needed it and none of it was arriving. */
    polyline(chosen, P.share(0.88), P, PATH, 0.40, 0.004, 0x2b4d, COMMIT);
    for (const seg of goalCross)
      polyline(seg, P.share(0.30), P, PATH, 0.26, 0.002, 0x2b51, [SEARCH[1], SEARCH[1]]);
    P.pad(0.010);

    /* The floor plan, in teal, at the sizes the shapes want. All of it is
       thin, and the first pass was not thin enough: the arcs went out at 0.46
       and 0.40 and came back as the brightest thing in the right margin, a
       teal rail with the strands the station exists to show reading as texture
       underneath it. The frame band is 12% of the cloud spent on five thin
       features, so it is dense per feature whatever it is told, and the only
       lever that matters is the splat. Over the 2.37 to 4.09 of depth these
       cover, this set draws between 1.3 and 3.5 CSS px, and 5.4 at the widest
       under the travelling band. The horizon arcs are still the heaviest of
       them, because they are what the search arrives at. */
    polyline(traj[edgeA].pts, F.share(0.15), F, FRAME, 0.26, 0.003, 0x9101, SEARCH);
    polyline(traj[edgeB].pts, F.share(0.18), F, FRAME, 0.26, 0.003, 0x9102, SEARCH);
    polyline(arcOuter, F.share(0.22), F, FRAME, 0.34, 0.003, 0x9103, [SEARCH[1], SEARCH[1]]);
    polyline(arcInner, F.share(0.20), F, FRAME, 0.30, 0.003, 0x9104, [SEARCH[1], SEARCH[1]]);
    polyline(ring, F.share(0.18), F, FRAME, 0.24, 0.003, 0x9105);
    const each = Math.floor(F.share(0.70) / marks.length);
    for (const m of marks) pose(m, each, F);
    F.pad(0.008);
  };
}
