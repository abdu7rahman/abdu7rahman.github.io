import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import TurtleBot, { MAX_V, MAX_W } from "./TurtleBot.jsx";
import { Local } from "./demos/dwa.js";
import { Search } from "./demos/astar.js";
import { clone, observe, act, scratchFor } from "./demos/clone.js";
import { useSim } from "../sim/useSim.js";
import { wheeledScene, wheelsFor, BURGER } from "../sim/models.js";
import { register, isLive } from "./console.js";
import { P } from "../lib/palette.js";
import { WORK } from "../lib/plan.js";

/* A trained checkpoint, driving.
 *
 * Everything else in this building is a published method implemented and
 * checked. This is the one thing that was learned: assets/dwa_clone.json is
 * a 15-64-64-2 network trained by tools/train_clone.py on 29,813 samples of
 * this project's own DWA driving 157 random maps, then improved over four
 * rounds of DAgger. It existed and it was only ever run on the document
 * site. The bay it was missing from is this one -- the place where somebody
 * can put the imitation next to the thing it imitated and watch them
 * disagree, which is the only honest way to show what a cloned policy is.
 *
 * What the policy is allowed to know is drawn, and that is the point of the
 * fan. It does not get the obstacle list or the map: it gets the range and
 * bearing to one waypoint, its own twist, and eleven clearance readings, and
 * the eleven are the beams on the bench. A reader who wonders how it can
 * possibly work is looking at the entire input.
 */

/* The clone is a local controller and it needs a plan under it, which took a
 * wrong answer to establish.
 *
 * Handed the flag directly it crawled: 0.001 m/s, nose against a drum, one
 * of the eleven beams reading blocked and no idea to go around. The first
 * guess was that the course was too small for the fan and rescaling it from
 * 1.14 m to 2.30 m fixed nothing, which is what sent me back to the training
 * script instead of to the geometry.
 *
 * train_clone.py never shows the network the goal. Both its rollout and its
 * DAgger pass observe `pts[min(wp + 8, -1)]` -- a waypoint eight cells along
 * an A* plan, about 0.4 m ahead -- because that is what dwa_controller.py
 * steers at. Every sample it has ever seen has a target that is locally
 * reachable, because the planner already went around. Giving it the far goal
 * asks it to do the global avoidance it was never trained to do, and it
 * answers by stopping, which on its own observations is correct.
 *
 * So the bay plans. A* on an inflated grid, the clone on the waypoint, at
 * the resolution and control period the training used. Measured over 120
 * random start/goal pairs on this course, integrated at the controller's own
 * 10 Hz:
 *
 *      lookahead    reached      median clearance
 *          4 cells   99 / 120        47 mm
 *          6        108 / 120        40 mm
 *          8         98 / 120        40 mm
 *         10         95 / 120        28 mm
 *
 * Six measured best and eight is what is used, because eight is
 * dwa_controller.py's own lookahead_wps and the whole claim of this bay is
 * that the thing on the bench is the clone of the controller in the next
 * cell. Tuning the clone's lookahead off its teacher's would make the
 * disagreement on the readout a comparison of two different controllers.
 * 98/120 is 82 per cent; the checkpoint's own closed-loop eval is 51/56,
 * which is 91 on the wider maps it was trained on. Neither number is 100 and
 * the bay does not pretend otherwise -- it clips a drum about one run in ten
 * and you can watch it happen.
 */
/* And bigger, which for this cell is not a framing choice either.
 *
 * train_clone.py generated its 157 maps at 64 by 96 cells of 0.05 m -- a
 * 3.2 by 4.8 m field -- and the policy's own beams reach 1.3 m. A course
 * narrower than about twice that reads to it as a corridor it was never
 * driven down. 2.7 by 3.4 is what the bench holds and is the closest this
 * building gets to the field it was trained on. */
const COURSE_X = 2.70, COURSE_Y = 3.40;
const RES = 0.05;                       // train_clone.py's costmap resolution
const NX = Math.round(COURSE_X / RES), NY = Math.round(COURSE_Y / RES);
const INFLATE_CELLS = 4;                // train_clone.py: inflate(g, radius=4)
const LOOK = 8;                         // dwa_controller.py: lookahead_wps
const TICK = 0.1;                       // dwa_controller.py: dt
/* Blocks at the scale the training maps used -- 4 to 12 cells of 0.05 m is
   0.2 to 0.6 m across -- rather than the local control bay's smaller discs,
   which the fan would have resolved as a single smear. */
const OBS0 = [
  [-0.68,  0.78, 0.26],
  [ 0.61,  0.38, 0.30],
  [-0.21, -0.73, 0.28],
  [ 0.77, -1.08, 0.24]
];
const START = [-0.94, -1.32, 0.6];

function cx(x) { return Math.max(0, Math.min(NX - 1, Math.floor((x + COURSE_X / 2) / RES))); }
function cy(y) { return Math.max(0, Math.min(NY - 1, Math.floor((y + COURSE_Y / 2) / RES))); }
function wx(c) { return (c + 0.5) * RES - COURSE_X / 2; }
function wy(r) { return (r + 0.5) * RES - COURSE_Y / 2; }

/* Is there an obstacle here. Not "is the inflated map blocked here": the
   training script inflates to at most 252 and then tests `>= 253`, so the
   band it paints is invisible to observe() and only the lethal cells and the
   map border read blocked. Inflating this test was the second wrong answer
   above -- it makes the fan report a wall where the policy was trained to
   see floor. The planner below is the one that gets the inflated grid, which
   is the same split the training script has. */
function solid(px, py) {
  if (Math.abs(px) > COURSE_X / 2 - 0.02 || Math.abs(py) > COURSE_Y / 2 - 0.02) return true;
  for (let i = 0; i < OBS0.length; i++) {
    const o = OBS0[i], dx = px - o[0], dy = py - o[1];
    if (dx * dx + dy * dy < o[2] * o[2]) return true;
  }
  return false;
}

export default function PolicyRig({ stop }) {
  const s = stop.side;
  const x = s * WORK;

  const [net, setNet] = useState(null);
  useEffect(() => {
    let live = true;
    clone().then(n => { if (live) setNet(n); }).catch(() => {});
    return () => { live = false; };
  }, []);

  const [sim] = useSim(() => wheeledScene({
    starts: [START], obstacles: OBS0
  }), []);

  /* Two grids over the same course, because the training script keeps two.
     `lethal` is what the fan reads. `walk` is that dilated by four cells,
     which is what the plan is allowed to cross -- a plan for a point is not
     a plan for a 0.09 m body. */
  const grid = useMemo(() => {
    const lethal = new Uint8Array(NX * NY), walk = new Uint8Array(NX * NY);
    for (let r = 0; r < NY; r++) {
      for (let c = 0; c < NX; c++) {
        if (solid(wx(c), wy(r))) lethal[r * NX + c] = 1;
      }
    }
    walk.set(lethal);
    let cur = walk;
    for (let k = 0; k < INFLATE_CELLS; k++) {
      const next = new Uint8Array(cur);
      for (let r = 0; r < NY; r++) {
        for (let c = 0; c < NX; c++) {
          if (!cur[r * NX + c]) continue;
          if (r > 0) next[(r - 1) * NX + c] = 1;
          if (r < NY - 1) next[(r + 1) * NX + c] = 1;
          if (c > 0) next[r * NX + c - 1] = 1;
          if (c < NX - 1) next[r * NX + c + 1] = 1;
        }
      }
      cur = next;
    }
    return { lethal, walk: cur };
  }, []);

  const search = useMemo(() => new Search(NX, NY, grid.walk), [grid]);

  /* The controller it was cloned from, asked the same question every tick so
     the disagreement on the readout is measured rather than remembered. It
     gets the same waypoint, which is the only way the number means anything:
     two controllers steering at different targets disagree by construction. */
  const dwa = useMemo(() => new Local({ maxV: MAX_V, maxW: MAX_W, horizon: 1.9,
                                        nv: 5, nw: 15 }), []);
  const pose = useRef({ x: START[0], y: START[1], psi: START[2], travel: 0 });
  const goal = useRef(new THREE.Vector2(0.80, 1.00));
  const over = useRef(false);
  const cmd = useRef({ v: 0, w: 0, dv: 0, dw: 0, acc: 0, gap: 0 });
  const nav = useRef({ path: [], wp: 0, cell: -1, clipped: 0, wedged: 0,
                       stalled: 0, arrived: 0, runs: 0, worst: 9, since: 0,
                       still: 0, quiet: 0, last: 0, why: "" });
  const obs = useMemo(() => new Float64Array(15), []);
  const scratch = useRef(null);
  const beams = useRef();
  const trail = useRef();
  const flag = useRef();
  const _p = useMemo(() => new THREE.Vector3(), []);
  const _h = useMemo(() => new THREE.Vector3(), []);

  useEffect(() => { if (net) scratch.current = scratchFor(net); }, [net]);

  /* The nearest cell a plan is allowed to end on. The cursor lands wherever
     the reader puts it, including inside a drum, and a goal the planner
     cannot reach is a bay that silently stops rather than one that says no. */
  function snap(gc, gr) {
    if (!grid.walk[gr * NX + gc]) return [gc, gr];
    for (let rad = 1; rad < 20; rad++) {
      for (let d = -rad; d <= rad; d++) {
        const ring = [[gc + d, gr - rad], [gc + d, gr + rad],
                      [gc - rad, gr + d], [gc + rad, gr + d]];
        for (const [c, r] of ring) {
          if (c < 0 || r < 0 || c >= NX || r >= NY) continue;
          if (!grid.walk[r * NX + c]) return [c, r];
        }
      }
    }
    return null;
  }

  function replan() {
    const q = pose.current, n = nav.current;
    const sc = snap(cx(q.x), cy(q.y));
    const gc = snap(cx(goal.current.x), cy(goal.current.y));
    if (!sc || !gc) { n.path = []; return; }
    n.cell = gc[1] * NX + gc[0];
    search.start(sc[0], sc[1], gc[0], gc[1]);
    // The grid is 46 x 54; running it to completion costs less than drawing it.
    while (!search.done) if (search.step(2000) === 0) break;
    n.path = search.found ? search.path.map(([c, r]) => [wx(c), wy(r)]) : [];
    n.wp = 0;
    paintTrail();
  }

  /* Somewhere else worth driving, for when nobody is holding the cursor. A
     circle would have been simpler and would have spent half its time inside
     a drum; picking free cells far from here means every idle run is a real
     start-to-goal attempt, which is the thing being demonstrated. */
  function wander() {
    const q = pose.current;
    for (let t = 0; t < 200; t++) {
      const c = Math.floor(Math.random() * NX), r = Math.floor(Math.random() * NY);
      if (grid.walk[r * NX + c]) continue;
      const px = wx(c), py = wy(r);
      if (Math.hypot(px - q.x, py - q.y) < 1.2) continue;
      goal.current.set(px, py);
      return;
    }
  }

  function reset() {
    pose.current = { x: START[0], y: START[1], psi: START[2], travel: 0 };
    cmd.current = { v: 0, w: 0, dv: 0, dw: 0, acc: 0, gap: 0 };
    nav.current = { path: [], wp: 0, cell: -1, clipped: 0, wedged: 0,
                    stalled: 0, arrived: 0, runs: 0, worst: 9, since: 0,
                    still: 0, quiet: 0, last: 0, why: "" };
    const sm = sim.current;
    if (sm) sm.place("tb0_free", START[0], START[1], BURGER.tyre, START[2]);
    replan();
  }

  /* Has anybody actually reached into this cell yet. The console shows the
     hint as a lit call to action until the first pointer event lands on the
     bench and as a quiet footnote after, because an instruction that is still
     shouting once it has been followed is noise. */
  const touched = useRef(false);

  useEffect(() => register(stop.id, {
    title: "A cloned controller",
    actions: [{ label: "Reset", on: reset }],
    readout: () => {
      const c = cmd.current, n = nav.current;
      return [
        ["network", c.v.toFixed(3) + " m/s, " + c.w.toFixed(2) + " rad/s"],
        ["its teacher", c.dv.toFixed(3) + " m/s, " + c.dw.toFixed(2) + " rad/s"],
        ["disagreement", (c.gap * 1000).toFixed(0) + " mm/s"],
        ["goals reached", n.arrived + " of " + n.runs + " here"],
        ["gave up", n.clipped + " hit, " + n.wedged + " stuck, " + n.stalled + " stopped"],
        ["closest it came", n.worst < 9 ? (n.worst * 1000).toFixed(0) + " mm" : "--"],
        ["trained on", net ? net.train.samples.toLocaleString() + " samples" : "--"]
      ];
    },
    say: () => {
      if (!net) return "Loading the checkpoint.";
      const n = nav.current, c = cmd.current;
      if (!n.path.length) return "No route to the flag from here. Move it somewhere the planner can reach.";
      if (n.since < 2.5 && n.why === "hit") return "It clipped a drum. The clone does that about one run in ten, and you just watched it.";
      if (n.since < 2.5 && n.why === "stuck") return "Wedged against something. The expert it copied has a recovery behaviour -- a timed reverse and spin -- and the training script threw every recovery sample away on purpose, so the clone never learned one.";
      if (n.since < 2.5 && n.why === "stalled") return "It stopped. Nothing is in its way; it simply commanded zero and stayed there, which is what a cloned policy does at an observation its teacher never got into.";
      if (n.since < 2.5 && n.why === "goal") return "Reached. A network did that, not a controller -- 29,813 samples of watching one.";
      if (over.current) return "The flag follows your cursor. A* replans, and the network drives to the waypoint it hands over.";
      if (Math.abs(c.v) < 0.02) return "Barely moving. The fan is what it is reacting to -- every beam is a clearance reading.";
      return `Driving on a copy. Its teacher would be going ${(c.gap * 1000).toFixed(0)} mm/s different right now.`;
    },
    touched: () => touched.current,
    hint: "Move your cursor over the floor to put the flag somewhere. A* plans around the drums; the network does the driving, on eleven clearance beams and one waypoint.",
    sim: () => !!sim.current && !!net,
    tick: (d) => step(d),
    state: () => {
      const c = cmd.current, q = pose.current, n = nav.current;
      return { v: +c.v.toFixed(3), w: +c.w.toFixed(3), gap: +c.gap.toFixed(4),
               travel: +q.travel.toFixed(3), path: n.path.length, wp: n.wp,
               runs: n.runs, arrived: n.arrived,
               net: net ? 1 : 0, sim: sim.current ? 1 : 0 };
    }
  }), [stop.id, net]);

  /* Start the next attempt, and count the one that just ended. Everything
     that finishes a run comes through here so the tally on the console and
     the sentence under it cannot drift apart. */
  function finish(why) {
    const n = nav.current;
    n.runs++; n.why = why; n.since = 0; n.still = 0; n.quiet = 0;
    if (why === "goal") n.arrived++;
    else if (why === "hit") n.clipped++;
    else if (why === "stalled") n.stalled++;
    else n.wedged++;
    if (why !== "goal") {
      // Put it back on clear ground. A wedged base cannot drive out of a
      // drum on a policy with no reverse in it, and leaving it there is a
      // cell that has stopped rather than a cell showing a failure.
      const sm = sim.current, q = pose.current;
      const free = snap(cx(q.x), cy(q.y));
      if (sm && free) sm.place("tb0_free", wx(free[0]), wy(free[1]), BURGER.tyre, q.psi);
    }
    if (!over.current) wander();
    replan();
  }

  function step(d) {
    const q = pose.current, sm = sim.current, n = nav.current, c = cmd.current;
    n.since += d;
    if (flag.current) flag.current.position.set(goal.current.x, goal.current.y, 0.02);

    // Replan when the flag has moved to another cell, or when the body has
    // drifted off the plan far enough that the waypoints behind it are lies.
    const gc = cy(goal.current.y) * NX + cx(goal.current.x);
    let off = 9;
    for (let i = 0; i < n.path.length; i++) {
      const dd = Math.hypot(n.path[i][0] - q.x, n.path[i][1] - q.y);
      if (dd < off) off = dd;
    }
    if (gc !== n.cell || !n.path.length || off > 0.45) replan();

    c.acc += d;
    if (c.acc >= TICK && net && scratch.current && n.path.length) {
      c.acc = Math.min(c.acc - TICK, TICK);
      // Advance along the plan the way the training loop does: a waypoint is
      // spent once it is inside 0.25 m or the next one is nearer.
      while (n.wp < n.path.length - 1) {
        const d0 = Math.hypot(n.path[n.wp][0] - q.x, n.path[n.wp][1] - q.y);
        if (d0 < 0.25 ||
            Math.hypot(n.path[n.wp + 1][0] - q.x, n.path[n.wp + 1][1] - q.y) < d0) n.wp++;
        else break;
      }
      const ti = Math.min(n.wp + LOOK, n.path.length - 1);
      const tx = n.path[ti][0], ty = n.path[ti][1];

      observe(net, q.x, q.y, q.psi, c.v, c.w, tx, ty, solid, obs);
      const [v, w] = act(net, obs, scratch.current);
      c.v = Math.max(-MAX_V, Math.min(MAX_V, v));
      c.w = Math.max(-MAX_W, Math.min(MAX_W, w));
      /* And the teacher's answer to the same question, for the number beside
         it. It is not driving and never gets to. */
      const [dv, dw] = dwa.plan([q.x, q.y, q.psi], [tx, ty], OBS0);
      c.dv = dv; c.dw = dw;
      c.gap = Math.hypot(c.v - dv, (c.w - dw) * 0.1);
      paintBeams();
    }

    if (sm) {
      const [wl, wr] = wheelsFor(c.v, c.w);
      sm.actuate("tb0_wl", wl);
      sm.actuate("tb0_wr", wr);
      sm.step(d);
      sm.point("tb0", _p);
      sm.dir("tb0", 0, _h);
      const nx = _p.x, ny = -_p.z;
      q.travel += Math.hypot(nx - q.x, ny - q.y);
      q.x = nx; q.y = ny;
      q.psi = Math.atan2(-_h.z, _h.x);
    } else {
      q.psi += c.w * d;
      q.x += Math.cos(q.psi) * c.v * d;
      q.y += Math.sin(q.psi) * c.v * d;
      q.travel += Math.abs(c.v) * d;
    }

    /* How close it came, kept because a cloned policy's failures are the
       honest half of it. Clearance to the drum surfaces, minus the body. */
    let clear = Math.min(COURSE_X / 2 - Math.abs(q.x), COURSE_Y / 2 - Math.abs(q.y));
    for (const o of OBS0) clear = Math.min(clear, Math.hypot(q.x - o[0], q.y - o[1]) - o[2]);
    clear -= BURGER.track / 2;
    if (!n.path.length || n.since < 0.6) { n.last = q.travel; return; }
    if (clear < n.worst) n.worst = clear;

    /* Wedged: told to drive and not moving. The wheels are turning, so this
       is the base against something rather than the policy choosing to stop
       -- and the clone has no way out of it, which is a fact about the
       training set rather than about the network. train_clone.py drops every
       sample the expert produced while in recovery, because recovery is a
       timed spin driven by history and labelling a snapshot with it teaches
       the clone to spin at states that merely look ambiguous. So the
       behaviour that gets a real DWA out of a corner is exactly the
       behaviour the clone was never shown. */
    /* Two ways of not getting there, and they are different failures.
    
       Wedged is the wheels turning and the base not moving: it is against
       something. Stalled is the network commanding nothing at all with
       nothing in the way. Both are the same missing behaviour -- the expert
       has a recovery, a timed reverse and spin, and train_clone.py drops
       every sample the expert produced while in one, on purpose, because
       recovery is driven by history rather than by the current observation
       and labelling a snapshot with it teaches the clone to spin at states
       that merely look ambiguous. So the clone has no way out of either. */
    if (Math.abs(c.v) > 0.05) {
      n.quiet = 0;
      n.still = q.travel - n.last < 0.004 ? n.still + d : 0;
      if (q.travel - n.last >= 0.004) n.last = q.travel;
    } else {
      n.still = 0; n.last = q.travel;
      n.quiet = Math.abs(c.w) < 0.25 ? n.quiet + d : 0;
    }

    if (clear < 0) finish("hit");
    else if (n.still > 3) finish("stuck");
    else if (n.quiet > 4) finish("stalled");
    else if (Math.hypot(q.x - goal.current.x, q.y - goal.current.y) < 0.16) finish("goal");
    /* And a ceiling on how long one attempt gets, so a cell nobody is
       pointing at keeps starting new runs instead of circling one flag. */
    else if (!over.current && n.since > 25) finish("stalled");
  }

  /* The fan, drawn out of the observation that was just taken rather than
     recomputed, so what is on the bench is the vector that went into the
     network and not a second opinion about it. */
  function paintBeams() {
    const g = beams.current;
    if (!g || !net) return;
    const q = pose.current;
    const pos = g.geometry.attributes.position.array;
    const col = g.geometry.attributes.color.array;
    const near = new THREE.Color(P.hazard), far = new THREE.Color(P.teal);
    const c = new THREE.Color();
    const last = net.ranges[net.ranges.length - 1];
    for (let i = 0; i < net.bearings.length; i++) {
      const clear = obs[4 + i];
      const a = q.psi + net.bearings[i];
      const len = Math.max(0.06, clear * last);
      const o = i * 6;
      pos[o] = q.x; pos[o + 1] = q.y; pos[o + 2] = 0.012;
      pos[o + 3] = q.x + Math.cos(a) * len;
      pos[o + 4] = q.y + Math.sin(a) * len;
      pos[o + 5] = 0.012;
      c.copy(near).lerp(far, clear);
      col[o] = c.r; col[o + 1] = c.g; col[o + 2] = c.b;
      col[o + 3] = c.r; col[o + 4] = c.g; col[o + 5] = c.b;
    }
    g.geometry.attributes.position.needsUpdate = true;
    g.geometry.attributes.color.needsUpdate = true;
    g.geometry.computeBoundingSphere();
  }

  /* The plan, which the network never sees. It is drawn because the reader
     has to be able to tell the two apart: the line is A*'s answer and the
     machine's path is the clone's, and where they differ is the whole
     subject of the bay. */
  const TRAIL = 512;
  function paintTrail() {
    const g = trail.current;
    if (!g) return;
    const path = nav.current.path;
    const pos = g.geometry.attributes.position.array;
    const n = Math.min(path.length, TRAIL);
    for (let i = 0; i < TRAIL; i++) {
      const p = path[Math.min(i, n - 1)] || [0, 0];
      pos[i * 3] = p[0]; pos[i * 3 + 1] = p[1]; pos[i * 3 + 2] = 0.006;
    }
    g.geometry.setDrawRange(0, Math.max(2, n));
    g.geometry.attributes.position.needsUpdate = true;
    g.geometry.computeBoundingSphere();
    g.visible = n > 1;
  }

  const beamGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(11 * 6), 3));
    g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(11 * 6), 3));
    return g;
  }, []);
  const trailGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(TRAIL * 3), 3));
    g.setDrawRange(0, 0);
    return g;
  }, []);
  useEffect(() => () => { beamGeo.dispose(); trailGeo.dispose(); }, [beamGeo, trailGeo]);

  useFrame(({ camera }, dt) => {
    if (!isLive(stop, camera)) return;
    step(Math.min(0.1, dt));
  });

  return (
    <group position={[x, 0.9, 0]} rotation-y={s > 0 ? Math.PI : 0}>
      <group rotation-x={-Math.PI / 2}>
        <mesh
          name={"pad-" + stop.id}
          position={[0, 0, 0.002]}
          onPointerMove={(e) => {
            touched.current = true;
            e.stopPropagation();
            const p = e.object.worldToLocal(e.point.clone());
            goal.current.set(
              Math.max(-COURSE_X / 2 + 0.08, Math.min(COURSE_X / 2 - 0.08, p.x)),
              Math.max(-COURSE_Y / 2 + 0.08, Math.min(COURSE_Y / 2 - 0.08, p.y)));
            over.current = true;
          }}
          onClick={(e) => e.stopPropagation()}
          onPointerOver={() => { over.current = true; }}
          onPointerOut={() => { over.current = false; }}
        >
          <planeGeometry args={[COURSE_X, COURSE_Y]} />
          <meshStandardMaterial color={"#1b1d21"} roughness={0.95} metalness={0.05} />
        </mesh>

        {OBS0.map((o, i) => (
          <mesh key={i} position={[o[0], o[1], 0.09]} castShadow receiveShadow>
            <cylinderGeometry args={[o[2], o[2], 0.18, 20]} />
            <meshStandardMaterial color={P.steel} roughness={0.8} metalness={0.15} />
          </mesh>
        ))}

        <line ref={trail} geometry={trailGeo} frustumCulled={false}>
          <lineBasicMaterial color={P.accent} transparent opacity={0.55} />
        </line>

        <lineSegments ref={beams} geometry={beamGeo} frustumCulled={false}>
          <lineBasicMaterial vertexColors transparent opacity={0.95} />
        </lineSegments>

        <mesh ref={flag} position={[0.8, 1.0, 0.02]}>
          <cylinderGeometry args={[0.022, 0.022, 0.04, 14]} />
          <meshStandardMaterial color={P.hazard} emissive={P.hazard}
            emissiveIntensity={0.5} roughness={0.5} />
        </mesh>

        <group rotation-x={Math.PI / 2}>
          <TurtleBot pose={pose} />
        </group>
      </group>
    </group>
  );
}
