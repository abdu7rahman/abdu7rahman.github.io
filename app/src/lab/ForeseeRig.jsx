import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import UR12e from "./UR12e.jsx";
import { linkFrames, toolPoint } from "../../../world/kinematics.js";
import { solve } from "../sim/ik.js";
import { lerpQ, clear, clearance, replan } from "./demos/via.js";
import { Track, timeToCollision } from "./demos/predict.js";
import { register, isLive } from "./console.js";
import { useSim } from "../sim/useSim.js";
import { replanScene } from "../sim/models.js";
import { P } from "../lib/palette.js";
import { WORK } from "../lib/plan.js";

/* The replan cell, replanning -- and now executing what it replans.
 *
 * The arm runs between two of its own poses on a straight line in joint
 * space. Put something in the way -- the cursor is the something -- and the
 * plan in flight is checked, found dead, cancelled, and replaced by the
 * cheapest clear detour a sampler can find.
 *
 * What changed is the half after the plan. The plan used to be written
 * straight into the joint angles the mesh was drawn at, so the arm was
 * exactly where the planner said and could not be anywhere else. It is a
 * command now: sim/models.js builds this cell as MJCF, MuJoCo integrates a
 * 20.7 kg arm on position servos, and the mesh is drawn at whatever the
 * simulation says the joints actually are. The difference is on the console
 * as `lag`, and it is never zero -- a servo tracking a moving target runs
 * behind it, and an arm holding a horizontal pose sags into it. Neither of
 * those was expressible before because there was nothing to disagree with.
 *
 * The obstacle is a mocap body, so it moves the robot and the robot does not
 * move it. Which means the failure this cell exists to show is now a real
 * one: if the planner misses, the arm hits the sphere, the solver resolves
 * the contact, and the contact count on the console goes up. It used to pass
 * through it.
 *
 * The planner is unchanged and still runs on the analytic kinematics rather
 * than on the simulation. That is not laziness, it is the architecture every
 * real system has: a planner reasons about a model, a controller commands a
 * plant, and the plant is the part that is allowed to disagree.
 *
 * What changed after that is the half that makes this worth a bay.
 *
 * It checked where the obstacle was. An arm that cancels the moment
 * something is already in its path is a reflex, and a reflex is what the
 * repository this comes from is a paper against: predictive_replanning
 * tracks the obstacle with a constant-velocity Kalman filter and cancels
 * against where it is going to be. demos/predict.js is that filter, and the
 * cone drawn ahead of the ball is its forecast -- a sphere per horizon,
 * widened by two standard deviations of the filter's own uncertainty, which
 * grows the further ahead you ask.
 *
 * The switch on the console turns it off, and that is the bay: reactive, the
 * arm cancels when the ball reaches it and the contact counter goes up;
 * predictive, it cancels while the ball is still a hand's width away and the
 * counter mostly does not.
 *
 * Measured in the page by tools/test_replan.js, 600 simulated seconds of
 * the same drifting obstacle on each setting: reactive finished 256
 * end-to-end moves and took 635 contacts, predictive finished 202 and took
 * 57. A ninth of the contacts per finished move, for four moves in five of
 * the work. The filter is not magic and the 57 is the honest half -- a
 * constant-velocity model is wrong about anything that changes direction,
 * which is why the tube widens with the horizon rather than tracking a
 * point, and it still gets caught.
 *
 * Reported in six segments rather than as one number, because one run of
 * this is not a measurement: an arm on a repeating plan and a ball on a
 * Lissajous are a chaotic pair, and two builds differing only in whether a
 * frame accumulator was cleared on restart once gave the reactive setting 55
 * contacts and 2. The segments here are 88 to 116 against 5 to 16, which is
 * a result.
 *
 * Those rows have read almost anything at various times, and twice the
 * reason was the cell rather than the controller: once when the arm worked
 * on the opposite side of its own base from the obstacle so almost nothing
 * could reach it, and once when the obstacle was slower than the arm so a
 * reflex handled it perfectly. See FACE and DRIFT_W.
 *
 * The finished moves are in that sentence because a contact count on its own
 * ranks a stopped arm first, and this cell spent a long time being one: the
 * note at the tube's own two constants is what that cost and how it was
 * found. The readout carries both numbers so nobody has to take either on
 * faith.
 */
const TICK = 1 / 30;
/* How much of the forecast's own uncertainty the arm is made to respect: the
   width of the tube it will not plan through, in standard deviations, and the
   metres at which that width stops growing. Named here rather than written
   into the call because they are the one pair of numbers in this cell that
   decides what it does, and the long note at the call site is about how they
   were chosen. */
const N_SIGMA = 2, CAP = 0.10;
const SPEED = 0.55;          // fraction of the plan traversed per second
const OBS_R = 0.20;          // metres, and the console scales from it
const TUBE_R = 0.011;        // the drawn plan, in metres

/* Which way this arm works, and it is the opposite of the way the cell was
 * drawn.
 *
 * A UR's upper arm runs down the -x of its shoulder frame -- ORIGINS[2] in
 * world/kinematics.js is -0.6127, straight out of the URDF -- so a base at
 * zero puts the tool behind the base and not in front of it, and sim/ik.js
 * holds the base inside +-pi to keep the arm in one configuration branch.
 * Every pose this cell can reach therefore lives on the arm's own -x.
 *
 * The cell was built as if the opposite were true. Measured off the arm's
 * own kinematics rather than from the picture: the two typed poses this
 * replaces swept the tool from cell x = +0.08 round to -1.06, and the elbow
 * with it, while the reader stands at cell +x. The entire move happened
 * behind the machine, so the aisle got the back of an arm folded over its
 * own base -- reported, twice, as the arm being backwards, which is exactly
 * what it was.
 *
 * So the assembly is turned half round in the cell and FACE carries the
 * sign. REACH, SPAN and LIFT are distances along the arm's own working
 * direction; FACE is the one place they become a coordinate.
 */
const FACE = -1;
const REACH = 0.62;          // how far out from the base the tool traverses
const SPAN = 0.42;           // how far either side of the centre line
const LIFT = 0.30;           // and how high above the bench it runs

/* The two ends of the move, solved rather than typed.
 *
 * sim/ik.js exists because a cell full of six-number poses that were solved
 * once, offline, and pasted in is a cell that goes silently wrong the moment
 * anything it was solved against moves -- and that is what happened here.
 * These three constants say where the tool should go; the joint angles are
 * whatever gets it there, in the branch the solver's own limits allow.
 *
 * A traverse across the front of the base, tool down, wide enough that
 * something in the middle of it is genuinely in the way: measured on the
 * sheet the cursor drives, 161 of 255 sampled ball positions block the
 * straight line and 61 of those have a detour the sampler can find, so the
 * reader gets both halves of what this cell is for rather than one. */
const ENDS = (() => {
  const seed = Float32Array.from([0, -1.1, 1.4, -1.85, -1.57, 0]);
  const mid = new Float32Array(6), a = new Float32Array(6), b = new Float32Array(6);
  solve(seed, new THREE.Vector3(FACE * REACH, 0, LIFT), mid, 300);
  solve(mid, new THREE.Vector3(FACE * REACH, SPAN, LIFT), a, 300);
  solve(mid, new THREE.Vector3(FACE * REACH, -SPAN, LIFT), b, 300);
  return [a, b];
})();

function seeded(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* Where the cursor's sheet stands, in the arm's own frame: on the traverse
   itself, so a ball dropped on it is a ball in the arm's way rather than one
   floating in front of a machine that works somewhere else. It used to stand
   at 0.34 m on the +x side, which is the side this arm cannot reach, and the
   only thing the obstacle could touch there was the shoulder it was sitting
   next to. The height is the traverse's, raised by a quarter of the sheet so
   the arm sits in its lower half and there is somewhere clear above it. */
const PAD_Z = LIFT + 0.25;
const PAD_W = 1.5, PAD_H = 1.1;

/* And where it drifts to when nobody is pointing at it: an orbit standing a
 * ball's radius beyond the sheet, leaning into the traverse and back out
 * again.
 *
 * A ball parked on the traverse is a cell that never gets anything done. The
 * first version of this drift was centred on the traverse itself and
 * measured that way -- blocked for 73 per cent of a cycle, and only 22 per
 * cent of those blockings had a detour, so the arm managed 13 end-to-end
 * moves in 90 s where an unobstructed one takes 1.8 s. An arm held still
 * three quarters of the time is not showing anybody a replanner.
 *
 * Sitting the orbit off the end of it and letting it lean in gives 35 per
 * cent blocked with 69 per cent of those detourable, measured over five
 * turns of the cycle against this cell's own clear() and replan() with the
 * default 0.20 m ball: the arm mostly works, is stopped often enough to
 * watch, and usually finds a way round rather than only ever holding. The
 * ball stays 0.17 m clear of the bench at its lowest and 0.56 m off the base
 * column, so nothing it does unattended is a contact the reader did not
 * ask for. */
const DRIFT = REACH + 0.24;
const DRIFT_Y = 0.60;        // how far it swings either side of the centre line

/* How fast the orbit runs, and it is the number that decides whether this
 * bay says anything at all.
 *
 * A reactive controller cancels when the obstacle is already in its path.
 * That is only a mistake if the obstacle can get there faster than the arm
 * can leave, so an obstacle slower than the arm is one a reflex handles
 * perfectly well -- and at the 0.55 rad/s this orbit was first written at,
 * the ball's fastest point is 0.28 m/s against a tool doing 0.47, and the
 * reactive setting took two contacts in 600 s. It was not being caught
 * because it was never being asked a question it could get wrong.
 *
 * Swept with tools/test_replan.js, 240 s at each rate, contacts per finished
 * move, and the shape of it is a band rather than a slope:
 *
 *     rad/s   ball peak   predictive   reactive
 *      0.55      0.28         0.34       0.02
 *      0.95      0.49         1.21       1.39
 *      1.35      0.70         0.46       2.55
 *      1.80      0.93         1.18       1.41
 *
 * Below the arm's own speed the reflex wins because there is nothing to
 * predict. Far above it prediction stops paying too, and that is the honest
 * half: a constant-velocity forecast over a 1.6 s horizon is a claim about a
 * thing that has not changed direction, and a ball at 0.93 m/s on this orbit
 * changes direction inside the horizon. 1.35 is where the question is worth
 * asking -- a ball half again as fast as the tool, caught 0.46 times a move
 * against a reflex's 2.55. */
const DRIFT_W = 1.35;

/* The horizons the forecast is drawn at, in seconds. timeToCollision checks
   ten of them; four is what a reader can tell apart. */
const HORIZONS = [0.3, 0.7, 1.1, 1.6];

export default function ForeseeRig({ stop }) {
  const s = stop.side;
  const x = s * WORK;

  const kit = useMemo(() => {
    const frames = Array.from({ length: 6 }, () => new THREE.Matrix4());
    /* Five points down the arm, not two: the elbow and the three wrist
       origins as well as the tool centre. The two-point version let an elbow
       sweep straight through the obstacle while the console reported the
       plan as direct -- invisible until the cell started simulating, and
       then extremely visible, because MuJoCo resolved the contact. */
    const pts = Array.from({ length: 5 }, () => new THREE.Vector3());
    const scratch = { q: new Float32Array(6) };
    const fk = (q) => {
      linkFrames(q, frames);
      for (let i = 0; i < 4; i++) pts[i].setFromMatrixPosition(frames[i + 2]);
      toolPoint(frames, pts[4]);
      return pts;
    };
    /* The arm's own thickness at each sampled point, from
       predictive_replanning/predict.py's LINK_RADIUS, which reads them off
       UR's collision meshes: upper arm 0.090, forearm 0.068, wrist one
       0.067, wrist two 0.055, wrist three and the gripper 0.050. A skeleton
       is a centreline and the planner believing a 68 mm forearm is a line is
       most of why an arm "clears" something it is four centimetres inside. */
    const radii = [0.090, 0.068, 0.067, 0.055, 0.050];
    /* Somewhere for the forecast's arm samples to land, so a check at ten
       horizons a tick allocates nothing. */
    const armPts = Array.from({ length: 5 }, () => new THREE.Vector3());
    /* The sampler's stream is part of the experiment, so the seed is kept
       and not just used: Reset re-seeds from it, which is what makes the two
       settings on the switch comparable at all. Without that, reactive is
       always measured on whatever random numbers predictive happened to
       leave behind -- and it showed, in the only place it could. Over five
       otherwise identical 150 s runs the reactive setting finished 63 or 64
       moves every time, and collected 27, 45, 50, 56 and 82 contacts. The
       moves are deterministic and the contacts were being drawn from five
       different streams. */
    const SEED = 0x1F2E3D4C;
    return { frames, scratch, fk, radii, armPts, seed: SEED, rand: seeded(SEED),
             a: Float32Array.from(ENDS[0]), b: Float32Array.from(ENDS[1]),
             via: null, u: 0, dead: false, hold: 0, acc: 0, dir: 1,
             r: OBS_R, lag: 0, touch: 0, gap: 0, ready: false,
             /* The tracker, and what it is telling the planner. `ttc` is the
                horizon at which the arm enters the predicted tube, in
                seconds, or -1 for clear; `warned` is how long before the
                obstacle actually arrived that the plan was cancelled, which
                is the number the whole cell is for. */
             clock: 0,
             track: new Track([FACE * (DRIFT + 0.10), 0.0, PAD_Z]), ttc: -1, warned: 0,
             /* And how much work it got done while doing it.
              *
              * Contacts on their own rank a stopped arm first, which is not
              * a hypothetical: at the tube this cell used to carry, measured
              * over 300 unattended seconds, the predictive setting held
              * position for 86 per cent of ticks and finished one
              * end-to-end move while collecting 16 contacts, and the
              * reactive one finished 156 and collected 74. Sixteen contacts
              * a move against half of one. The count of finished moves
              * beside the count of contacts is what makes that visible, on
              * the readout and to the harness. */
             moves: 0,
             predict: true, hits: 0, saves: 0 };
  }, []);

  /* Two joint vectors now, and keeping them apart is the point. `cmd` is
     what the planner wants and what goes to the actuators; `act` is what the
     simulation says the arm did, and it is the one the mesh is drawn at. */
  const cmd = useRef(Float32Array.from(ENDS[0]));
  const act = useRef(Float32Array.from(ENDS[0]));
  const [sim, simReady] = useSim(replanScene, []);
  /* Where the drift has it at t = 0, so the ball does not jump the first
     time nobody is pointing at it -- and off the traverse, so the cell does
     not open with the arm already inside the obstacle. It did: the ball
     started on the line, the solver resolved the contact on frame one, and
     the arm was shoved flat onto the bench before anybody had touched
     anything. */
  const obs = useRef(new THREE.Vector3(FACE * (DRIFT + 0.10), 0.0, PAD_Z));
  const held = useRef(99);
  const ball = useRef();
  const cone = useRef([]);
  const over = useRef(false);
  const mat = useRef();
  const _fc = useMemo(() => [0, 0, 0, 0], []);
  const _fpt = useMemo(() => new THREE.Vector3(), []);
  const _vel = useMemo(() => new THREE.Vector3(), []);

  /* The plan is drawn as a tube and not as a line, because WebGL ignores
     linewidth: a LineBasicMaterial is one device pixel wide however near the
     camera is, and one pixel of orange on a lit bench four metres away is
     nothing. A tube is real geometry, it takes the cell's own light, and it
     reads as something the arm is following. Rebuilt on each replan, which
     is a few times a second at worst and not once a frame. */
  const tube = useRef();
  const geoRef = useRef(null);

  /* The plan, as the tool centre walks it. Rebuilt whenever the plan changes
     and not every frame: it is the executed path, so if it were rebuilt from
     the current state each frame it would be a trail rather than a plan. */
  function paintPlan() {
    if (!tube.current) return;
    const segs = kit.via ? [[kit.a, kit.via], [kit.via, kit.b]] : [[kit.a, kit.b]];
    const pts = [];
    for (const [from, to] of segs) {
      for (let k = 0; k <= 24; k++) {
        lerpQ(from, to, k / 24, kit.scratch.q);
        const [, t] = kit.fk(kit.scratch.q);
        pts.push(t.clone());
      }
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const next = new THREE.TubeGeometry(curve, pts.length, TUBE_R, 8, false);
    if (geoRef.current) geoRef.current.dispose();
    geoRef.current = next;
    tube.current.geometry = next;
  }

  /* The obstacle's size is the control, because it is the thing the planner
     is arguing with. Small and every straight line is clear and the cell
     never does what it is named after; large and nothing sampled is clear
     and the arm holds, which is the other end of the same behaviour and
     worth being able to see on purpose. */
  /* Has anybody actually reached into this cell yet. The console shows the
     hint as a lit call to action until the first pointer event lands on the
     bench and as a quiet footnote after, because an instruction that is still
     shouting once it has been followed is noise. */
  const touched = useRef(false);

  /* Back to the start, all of it: the plan, the arm, the counters, the
     filter and the sampler's own stream. Named rather than inlined into the
     button because the mode switch needs the same thing -- see the note
     there for what happens when only some of it is reset. */
  function restart() {
    kit.a = Float32Array.from(ENDS[0]); kit.b = Float32Array.from(ENDS[1]);
    kit.via = null; kit.u = 0; kit.dead = false; kit.dir = 1;
    kit.hits = 0; kit.saves = 0; kit.moves = 0;
    kit.rand = seeded(kit.seed); kit.clock = 0; kit.acc = 0;
    /* The ball goes back to the top of its orbit before the filter is told
       where it is, and that is what makes a restart mean something.
     *
     * Resetting the clock alone puts the ball back on the next tick but
     * seeds the tracker with wherever the last run left it, so the filter
     * opens holding a velocity across a jump -- and the whole cell follows
     * from what the filter believes. Measured: two 600 s runs of the same
     * build, differing only in how many frames the page had rendered before
     * the harness started, gave the predictive setting 71 contacts and 107
     * over an identical 204 finished moves. The reactive setting gave 635
     * both times, because it never asks the filter anything. */
    obs.current.set(FACE * (DRIFT + 0.10), 0, PAD_Z);
    kit.track.reset(obs.current);
    cmd.current.set(ENDS[0]); act.current.set(ENDS[0]); painted.current = false;
    if (sim.current) { sim.current.reset(); for (let i = 0; i < 6; i++) sim.current.qpos[i] = ENDS[0][i]; }
  }

  useEffect(() => register(stop.id, {
    title: "Cancel and replan",
    actions: [{ label: "Reset", on: () => restart() }],
    choice: {
      get: () => kit.predict,
      /* The whole cell, not just the counters.
       *
       * Zeroing three numbers and leaving everything else where the last
       * setting left it is not a comparison: the arm is mid-move, the ball is
       * wherever its clock had drifted it to, the filter is holding a velocity
       * estimate it learned under the other setting, and the detour sampler
       * is however many draws into its stream the previous run took it. That
       * last one showed, in the only place it could -- five otherwise
       * identical 150 s reactive runs, whose finished-move count came out 63,
       * 63, 66, 66, 66 every time and whose contact count came out 32, 41, 45,
       * 77 and 83, because each was drawing from wherever the predictive run
       * before it had left the sampler.
       *
       * So the switch restarts the experiment, which is also what a reader
       * means by it. */
      set: (v) => { kit.predict = v; restart(); },
      options: [
        { value: true, label: "Predictive" },
        { value: false, label: "Reactive" }
      ]
    },
    slider: {
      label: "Ball", min: 0.10, max: 0.32, step: 0.01,
      get: () => kit.r,
      set: (v) => { kit.r = v; },
      fmt: (v) => (v * 2).toFixed(2) + " m"
    },
    /* Four numbers, and two of them could not exist before there was a
       simulation to read them off. `lag` is the worst joint's distance from
       its own command in millidegrees -- a servo behind a moving target --
       and `touching` is how many contacts the solver is resolving, which is
       zero unless the planner has actually failed and the arm has actually
       hit something. */
    readout: () => [
      ["plan", kit.dead ? "blocked" : kit.via ? "detoured" : "direct"],
      ["time to collision", kit.ttc >= 0 ? (kit.ttc * 1000).toFixed(0) + " ms" : "clear"],
      ["it is moving at", (kit.track.speed * 1000).toFixed(0) + " mm/s"],
      ["cancelled early", kit.warned > 0 ? (kit.warned * 1000).toFixed(0) + " ms" : "--"],
      ["clearance", kit.ready ? (kit.gap * 100).toFixed(0) + " cm" : "--"],
      ["touching", kit.ready ? String(kit.touch) : "--"],
      ["hit / avoided", kit.hits + " / " + kit.saves],
      /* Because the row above is not a score on its own: an arm standing
         still is never hit. Switch modes and read both rows -- reading only
         the first is how this cell came to carry a forecast tube that held
         the arm still for 86 per cent of a run and was called four times
         safer for it. */
      ["moves finished", String(kit.moves)]
    ],
    /* What it is doing, in words. The whole point of this bay is a moment
       that lasts about a second, and a readout row that flickers from
       "direct" to "around" is not a way to notice it. */
    say: () => {
      if (kit.touch) return kit.predict
        ? "It has been hit. The forecast missed this one -- a constant-velocity filter is wrong about a hand that changes direction, which is exactly why the tube widens with the horizon."
        : "It has been hit. Reactive: it cancels when the obstacle is already in its path, which on a moving obstacle is too late.";
      if (kit.dead && kit.warned > 0)
        return `Cancelled ${(kit.warned * 1000).toFixed(0)} ms before the ball gets there. `
             + `Nothing is in the way yet -- the filter says it will be.`;
      if (kit.dead) return "Something is in the way. Cancelling the move and planning around it.";
      if (!kit.predict) return "Reactive. It will not move until the ball is already in its path -- switch to predictive and watch the difference.";
      return over.current
        ? "Tracking your hand and forecasting where it goes. The cone is two standard deviations of the filter's own uncertainty, which is why it opens."
        : "Tracking the ball and forecasting where it goes. The cone is the filter's own uncertainty, widening the further ahead it is asked.";
    },
    touched: () => touched.current,
    /* Steppable from outside, like the rest of them. This cell ran only
       inside its own frame callbacks, so a harness could watch the tracker
       and not advance it -- and a predictive controller that is never
       stepped forecasts nothing. */
    tick: (d) => { plan(d); plant(d); },
    sim: () => !!sim.current,
    hint: "Move the cursor across the cell to put your hand in the way. The cone ahead of it is where the filter thinks it is going; switch to reactive and the arm waits until it is already there.",
    /* Where the obstacle actually is, so a probe outside the page can check
       the one thing this cell is about and cannot be photographed: that the
       pointer reaches the sheet at all. It did not -- the sheet is a
       single-sided plane and three.js will not raycast the back of one, so
       on a cell turned away from the aisle the cursor missed it entirely and
       the ball drifted on its own timer whatever the reader did. */
    state: () => ({
      x: +obs.current.x.toFixed(3), y: +obs.current.y.toFixed(3),
      z: +obs.current.z.toFixed(3), over: over.current ? 1 : 0,
      dead: kit.dead ? 1 : 0, via: kit.via ? 1 : 0, touch: kit.touch,
      ttc: +kit.ttc.toFixed(3), warned: +kit.warned.toFixed(3),
      speed: +kit.track.speed.toFixed(3), predict: kit.predict ? 1 : 0,
      hits: kit.hits, saves: kit.saves, moves: kit.moves
    })
  }), [stop.id, kit, sim]);

  /* The planner's half of a frame, out of useFrame so a harness can drive
     it. The drift clock is the cell's own rather than the renderer's, for
     the same reason. */
  function plan(d) {
    if (!painted.current && tube.current) { paintPlan(); painted.current = true; }
    /* Drifts when nobody is pointing at it, and "nobody is pointing at it"
       means the cursor has left the cell -- not that it has stopped moving.
       Holding the pointer over one spot to keep the arm blocked and watching
       the ball wander off after a second and a half is the whole of the
       complaint that the cursor does not control it. */
    if (!over.current) held.current += d; else held.current = 0;

    // Through the workspace rather than around its edge, or it would never
    // block anything and the bay would never do the thing it is named after.
    if (held.current > 1.2) {
      const t = (kit.clock += d) * DRIFT_W;
      obs.current.set(FACE * (DRIFT + 0.10 * Math.cos(t)),
                      DRIFT_Y * Math.sin(t * 0.8),
                      PAD_Z + 0.18 * Math.sin(t));
    }
    if (ball.current) {
      ball.current.position.copy(obs.current);
      ball.current.scale.setScalar(kit.r / OBS_R);
    }

    kit.acc += d;
    if (kit.acc >= TICK) {
      /* The interval that actually passed, not the one this cell would like
         to be running at.
       *
       * The tracker was fed TICK every time, and TICK is only what elapsed
       * on a machine holding 60 fps. Anywhere slower the obstacle had moved
       * further than a thirtieth of a second's worth and the filter was told
       * otherwise, so it read the difference as speed: on this project's own
       * software-rasterised harness, where a frame is capped at 0.1 s, the
       * console reported the ball doing 739 mm/s against a drift whose
       * fastest point is 280. A velocity estimate three times too large is a
       * forecast three times too far ahead, which is what put the cone
       * hanging in the air off the end of the bench.
       *
       * Zeroed rather than decremented for the same reason: carrying the
       * remainder keeps the nominal rate and makes the next interval a lie
       * as well. What this gives up is a fixed tick, which nothing here
       * needs -- the planner's own rate is a fraction of the plan per second
       * and the horizon is in seconds. */
      const dt = kit.acc;
      kit.acc = 0;
      /* Check the part of the plan that has not been executed yet, which is
         the only part that can still be cancelled. Checking the whole plan
         would keep reporting a collision the arm has already driven past. */
      /* From where the arm is, not from where it was told to be. Those are
         the same number only when nothing is disagreeing with the command,
         and the whole reason this cell now runs a simulation is that
         something is. Replanning from the command would plan a detour
         starting from a pose the arm is not in. */
      const from = Float32Array.from(act.current);
      const rest = kit.via && kit.u < 0.5
        ? [[from, kit.via], [kit.via, kit.b]]
        : [[from, kit.b]];
      let ok = true;
      for (const [p0, p1] of rest)
        if (!clear(p0, p1, obs.current, kit.r, kit.fk, kit.scratch)) { ok = false; break; }

      /* And the same question asked of where the obstacle is going.
       *
       * The filter is fed the obstacle's position every tick whether or not
       * the prediction is switched on, because a tracker that only runs when
       * somebody is watching has no history when they start watching. What
       * the switch changes is whether its answer is allowed to cancel a
       * plan. */
      kit.track.update([obs.current.x, obs.current.y, obs.current.z], dt);
      /* The arm's sample points at a fraction of what is left of the plan.
         The horizon is in seconds and the plan is executed at a known rate,
         so timeToCollision converts one to the other. */
      const seg = rest[rest.length - 1];
      const armAt = (u, out) => {
        lerpQ(seg[0], seg[1], u, kit.scratch.q);
        const p = kit.fk(kit.scratch.q);
        for (let i = 0; i < p.length; i++) out[i] = p[i];
        return out;
      };
      kit.ttc = timeToCollision(armAt, kit.armPts, kit.radii, kit.track, {
        /* Two sigmas and a 0.10 m cap, against predictive_replanning/run.py's
           one and 0.10 -- checked, not remembered: run_one() declares
           n_sigma=1.0 and sigma_cap=0.10, and the clearance of 0.02 this call
           passes is its default too. The horizon is the one number here that
           differs without being argued: 1.6 s against the reference's
           ttc_threshold of 2.0, which is the threshold its own proposal set. The filter itself does not diverge -- accel_std 1.2
           and meas_std 0.02 are the module's own, and a constant-velocity
           forecast at that process noise grows as about 0.6 t squared.
           Measured off this cell's own filter rather than off the module's
           note: sigma is 0.106 m at 0.4 s, 0.872 at 1.2 and 1.543 at 1.6, so
           a cap of 0.10 binds at 0.39 s and one of 0.35 at 0.76, and either
           is binding before the 1.6 s horizon is half spent. The numbers do
           not move with how long the filter has been tracking -- 0.5 s of
           history and 60 s give the same curve, because the forward
           covariance is dominated by the process noise over the horizon and
           not by what the filter has learned. What these two decide is how
           much of that uncertainty the arm is made to respect.

           The cap was 0.35 once, and it was chosen on contacts alone.
           Contacts alone rank a stopped arm first, and that is not a
           hypothetical: a 0.20 m ball plus two sigmas of 0.35 is a 0.90 m
           radius inside a workspace about 1.2 m across, so nothing was ever
           clear. It held position for 86 per cent of ticks and finished one
           end-to-end move in 300 s against a reactive arm's 156. "16
           contacts against 74" was never a result; it was the ratio of two
           machines doing wildly different amounts of work. So the number to
           rank on is contacts per finished move, and the cell counts moves.

           It is 0.10 because the reference declares 0.10 and because the
           sweep agrees. tools/test_replan.js, 240 s at each cap against the
           same obstacle, predictive, with reactive at 260 contacts over 102
           finished moves -- 2.55 each -- for scale:

                      contacts  moves  per move
             0.02           41     82      0.50
             0.03           54     83      0.65
             0.05           34     80      0.42
             0.10           30     79      0.38
             0.14           26     80      0.33
             0.20           28     66      0.42

           Flat through the middle and then it turns: at 0.20 the arm is
           still avoiding things but has lost a fifth of its work, which is
           the old failure creeping back. 0.14 is a contact or two ahead of
           0.10 and inside the spread the harness's own per-segment rows
           show, so there is nothing there to prefer it for; 0.10 is the
           reference's value and has a provenance. Two sigmas of it rather
           than the reference's one is the deliberately conservative half,
           and this table is what says the cell can afford it.

           An earlier version of this comment argued for 0.03 off a table
           with the same shape and different numbers, and what changed is not
           the tube. The obstacle was slower than the arm then, so the width
           of the forecast was the only thing that could stop anything -- see
           DRIFT_W for that, and for the measurement that found it.

           The earlier note here said the cap was "the cell's own" because
           the workspace is 1.2 m across. That was not a reason, it was an
           arithmetic error -- and the arithmetic was wrong twice over: two
           sigmas of 0.35 around a 0.20 m ball is a 1.80 m tube, not the
           1.58 m that note went on to quote. 1.58 is what the same sum gives
           for a 0.09 m obstacle, which is the radius cell.py's build_mjcf
           declares -- though a trial never uses it, because run.py builds the
           model from the obstacle track's own radius and that defaults to
           0.07. Either way the figure came from the reference's obstacle and
           not from this cell's 0.20 m ball. */
        base: kit.r, nSigma: N_SIGMA, clearance: 0.02, horizon: 1.6, steps: 10,
        cap: CAP,
        rate: SPEED / Math.max(0.05, 1 - kit.u)
      });
      const soon = kit.predict && kit.ttc >= 0;

      /* The cone, off the same filter that just answered. Hidden when the
         prediction is switched off, because a cell that draws a forecast it
         is not using is a cell lying about what it is doing. */
      for (let i = 0; i < HORIZONS.length; i++) {
        const m = cone.current[i];
        if (!m) continue;
        m.visible = kit.predict;
        if (!kit.predict) continue;
        // The same two numbers the cancel test above is using. They were
        // written out here as literals, so changing the tube would have
        // changed what the arm avoids and not what the reader is shown.
        const r = kit.track.radiusAt(HORIZONS[i], kit.r, N_SIGMA, CAP, _fc);
        m.position.set(_fc[0], _fc[1], _fc[2]);
        /* Square to the way the ball is going, which is what a section of a
           tube is. A torus is drawn about its own z, and these were left at
           the identity -- so every ring lay flat however the obstacle was
           moving, and four horizontal hoops climbing into the roof is what a
           forecast of a rising ball looked like. lookAt points the local z
           down the velocity; below about a millimetre a tick there is no
           direction to point it at and the last one is kept. */
        _vel.set(kit.track.x[3], kit.track.x[4], kit.track.x[5]);
        if (_vel.lengthSq() > 1e-6) m.lookAt(_vel.add(m.position));
        /* The ring's own tube stays the thickness it was authored at while
           its radius scales, or a far horizon comes out as a fat doughnut
           rather than as a wider circle. */
        m.scale.set(r, r, 1);
      }

      if ((!ok || soon) && !kit.dead) {
        kit.dead = true; kit.hold = 0;
        /* How much warning the filter bought. Zero when the arm cancelled
           because the obstacle was already in the way, which is what the
           reactive setting always does. */
        kit.warned = ok && soon ? kit.ttc : 0;
        if (kit.warned > 0) kit.saves++;
      }
      /* And back the other way. The obstacle moves, so a plan that was dead
         can become live again -- and nothing cleared the flag, so the arm
         went on holding and went on paying for a replan it no longer needed
         until the sampler happened to find a detour around empty air. */
      if (ok && !soon && kit.dead) { kit.dead = false; kit.hold = 0; }

      if (kit.dead) {
        /* The real interval as well, for the same reason as the filter's:
           a beat measured in ticks is a beat that gets longer the slower the
           machine is. */
        kit.hold += dt;
        // A beat of held position before the detour, because a controller
        // that cancels and re-accelerates inside one frame is a controller
        // nobody can see cancel.
        if (kit.hold > 0.22) {
          /* Around the forecast, not around the ball.
           *
           * This asked for a detour clear of where the obstacle is, at the
           * ball's own radius, while the test that had just cancelled the
           * plan was about where the obstacle will be, at the width of the
           * filter's uncertainty. Two different obstacles, so the sampler
           * certified a detour and timeToCollision cancelled it on the next
           * tick for a reason the sampler had never been told about, and the
           * cell went round that loop for as long as anybody watched.
           *
           * The detour is planned around the forecast at the horizon that
           * cancelled the plan now, at the radius that forecast justifies.
           * The two tests are still not identical -- clear() measures to the
           * arm's centreline and timeToCollision carries a radius per link
           * -- but they are about the same obstacle in the same place. */
          let at = obs.current, rad = kit.r + 0.02;
          if (kit.predict && kit.ttc >= 0) {
            // radiusAt fills _fc with the forecast before returning the
            // radius, so the point has to be read after the call.
            rad = kit.track.radiusAt(kit.ttc, kit.r, N_SIGMA, CAP, _fc) + 0.02;
            at = _fpt.set(_fc[0], _fc[1], _fc[2]);
          }
          const via = replan(from, kit.b, at, rad,
                             kit.fk, kit.scratch, kit.rand);
          if (via) {
            kit.a = from; kit.via = via; kit.u = 0; kit.dead = false;
            paintPlan();
          }
        }
      }
    }

    /* The colour, written before the early return and not after it.
    
       It was the last statement in the callback and the callback returns
       above it while dead, so the one state it exists to show was the one
       state it never showed: the tube bent and never went red. */
    if (mat.current) {
      mat.current.color.set(kit.dead ? "#d94b2b" : P.hazard);
      mat.current.emissive.set(kit.dead ? "#d94b2b" : P.hazard);
    }

    if (kit.dead) return;      // holding: nothing clear to move along yet

    kit.u += SPEED * d;
    if (kit.u >= 1) {
      /* Arrived. The next move starts from where the arm actually is rather
         than from the goal it was aiming at -- after a detour those are the
         same to within float error, and after a cancelled detour they are
         not, and starting from the goal would teleport it. */
      kit.dir = -kit.dir;
      kit.moves++;
      kit.a = Float32Array.from(act.current);
      kit.b = Float32Array.from(ENDS[kit.dir > 0 ? 1 : 0]);
      kit.via = null; kit.u = 0;
      paintPlan();
    }

    const u = kit.u;
    if (kit.via) {
      if (u < 0.5) lerpQ(kit.a, kit.via, u * 2, cmd.current);
      else lerpQ(kit.via, kit.b, (u - 0.5) * 2, cmd.current);
    } else {
      lerpQ(kit.a, kit.b, u, cmd.current);
    }

  }

  useFrame(({ camera }, dt) => {
    if (!isLive(stop, camera)) return;
    plan(Math.min(0.1, dt));
  });

  /* The plant's half, separate because an arm holding a cancelled plan is
     still an arm holding itself up against gravity, and that is exactly the
     interval this cell is about. */
  function plant(d) {
    const sm = sim.current;
    if (!sm) return;
    sm.setMocap("hand", obs.current.x, obs.current.y, obs.current.z);
    /* The obstacle's size is a console control, and a geom's size is model
       data rather than state, so it is written where the reader changes it
       rather than being baked at compile time. */
    if (kit.geomR !== kit.r) {
      const g = sm.model.geom("handgeom");
      g.size[0] = kit.r;
      if (g.delete) g.delete();
      kit.geomR = kit.r;
    }
    sm.command(cmd.current);
    sm.step(d);
    let worst = 0;
    for (let i = 0; i < 6; i++) {
      act.current[i] = sm.qpos[i];
      worst = Math.max(worst, Math.abs(act.current[i] - cmd.current[i]));
    }
    kit.lag = worst;
    const was = kit.touch;
    kit.touch = sm.touching("handgeom");
    // A contact that has just started is one the planner failed to avoid.
    if (kit.touch && !was) kit.hits++;
    kit.gap = clearance(act.current, obs.current, kit.r, kit.fk);
    kit.ready = true;
  }

  useFrame(({ camera }, dt) => {
    if (!isLive(stop, camera)) return;
    plant(Math.min(0.1, dt));
  });

  // First paint happens on the first frame instead of in a memo: the mesh
  // the tube is assigned to does not exist until React has committed.
  const painted = useRef(false);

  return (
    /* Which way the cell faces, and the rule is the opposite of the one that
       was here.
    
       Every rig used to place itself at x = side * WORK with no rotation, so
       all of them pointed the same absolute way and which side of the lane a
       cell stood on decided whether a visitor met its front or its back. The
       first fix turned the cells on side -1, which is backwards: the reader
       stands in the aisle at x = -0.95 for a cell whose origin is at -4.9, so
       the direction from cell to reader is +x, and a cell whose work happens
       on its own +x wants no rotation there and half a turn on the other
       side. Measured, because this is the kind of sign that argues either
       way: the replan cell's cursor sheet sits along the cell's own +x, and
       under the old rule it came out at world x = -5.24 against a camera at
       -0.95 -- a third of a metre further off than the arm's own base, with
       the machine standing between the reader and the thing they are meant to
       reach into.
    
       This decides where the cell's own front is and nothing else. Which way
       the machine inside it points is a separate question with a separate
       answer, and getting the two confused is what left this arm working
       behind itself for as long as it did -- see FACE at the top of the
       file. */
    <group position={[x, 0.9, 0]} rotation-y={s > 0 ? Math.PI : 0}>
      {/* And then half round again, because this arm's work is on its own -x
          and the cell rotation above only decides which way the cell faces.
          Everything the planner talks about is inside this group with the
          machine, so turning it turns the arm, the plan, the ball and the
          forecast together and the planner's own frame is untouched: FACE is
          still the arm's working direction, it is just pointing at the aisle
          now. The sorting cell does the same thing to each of its two arms,
          a quarter turn each, for the same reason. */}
      <group rotation-y={FACE < 0 ? Math.PI : 0}>
        <group rotation-x={-Math.PI / 2}>
        {/* What the cursor talks to: an invisible sheet standing through the
            workspace, so a pointer moving across the bay maps to a point in
            the arm's own frame with no picking arithmetic here. Vertical and
            not flat, because the thing being put in the way is at arm height
            and a floor plane would only ever place it under the bench.
            visible false still takes pointer events -- what it must not do
            is draw. */}
        <mesh
          name={"pad-" + stop.id}
          visible={false}
          position={[FACE * REACH, 0, PAD_Z]}
          rotation={[Math.PI / 2, Math.PI / 2, 0]}
          onPointerMove={(e) => {
            touched.current = true;
            e.stopPropagation();
            const p = e.object.worldToLocal(e.point.clone());
            /* The sheet is square to the aisle now, and the mapping below is
               the one this comment always claimed: across is the arm's y and
               up is its z, and how far out the ball sits is the one axis the
               reader cannot point at -- it rides at the depth of the sheet,
               which is what the sheet is for.
            
               It was neither of those things. The plane carried a quarter
               turn about x, which put its normal along the arm's y: a sheet
               in the arm's own sagittal plane, running away from the reader
               rather than across the cell, and meeting the arrival camera's
               ray fifteen degrees off grazing. So `p.x` was depth and not
               across, `p.y` was depth-wise height read upside down, and both
               were written into the mapping meant for a sheet facing the
               aisle. The three-axis Euler here is the rotation that actually
               sends the plane's own x to the arm's y and its y to the arm's
               z; it is checked in tools/test_lab.js rather than trusted. */
            obs.current.set(FACE * REACH, p.x, PAD_Z + p.y);
            over.current = true;
            held.current = 0;
          }}
          /* A click on the course is a click on the course.
             
             R3F walks the ray and delivers a click to the first object that
             has a handler for one -- so a pad carrying only pointer-move
             handlers is transparent to clicks, and the next thing along the
             ray from the bench is the monitor standing behind it, whose click
             opens the cell full screen. Measured: clicking the middle of the
             terrain course put a scrim over the whole page. Stopping it here
             costs nothing and is what "this surface is the control" means. */
          onClick={(e) => e.stopPropagation()}
          onPointerOver={() => { over.current = true; held.current = 0; }}
          onPointerOut={() => { over.current = false; }}
        >
          <planeGeometry args={[PAD_W, PAD_H]} />
          <meshBasicMaterial side={THREE.DoubleSide} />
        </mesh>

        <mesh ref={tube} frustumCulled={false}>
          <meshStandardMaterial ref={mat} color={P.hazard}
            emissive={P.hazard} emissiveIntensity={0.55} roughness={0.5} />
        </mesh>
        {/* Scaled every frame rather than through a prop. kit.r is set
            imperatively by the console, which re-renders itself and not
            this tree -- so a scale written as JSX stayed at whatever it was
            on mount, and picking Large made the planner refuse paths around
            a 0.30 m sphere while a 0.20 m one was drawn. */}
        <mesh ref={ball}>
          <sphereGeometry args={[OBS_R, 22, 16]} />
          <meshStandardMaterial color={P.teal} roughness={0.3} metalness={0.1}
                                transparent opacity={0.42} />
        </mesh>

        {/* The forecast, as one ring per horizon: the tube's own section at
            the plane through each predicted centre, at the radii the
            filter's covariance gives. Not a decoration -- these are the
            spheres timeToCollision is checking the arm against, so what the
            reader sees is what the planner is arguing with, and they open
            with the horizon because the uncertainty does.
        
            Drawn as sections and not as the spheres themselves, which was
            the first version and is what a screenshot settled: the tube was
            0.90 m of radius at the cap then, on a 3 m bench, so four
            translucent domes stacked over the whole cell and the arm inside
            them was gone. The cap is 0.10 now and the radius with it, 0.40 m
            at the default ball and 0.52 at the slider's largest, which is
            small enough to draw either way -- but a section still carries
            the same number and leaves the machine visible, and that is the
            only reason the number is worth drawing at all. */}
        {HORIZONS.map((h, i) => (
          <mesh key={i} ref={el => (cone.current[i] = el)}>
            <torusGeometry args={[1, 0.012, 6, 48]} />
            <meshBasicMaterial color={P.accent} transparent
              opacity={0.55} depthWrite={false} />
          </mesh>
        ))}
        </group>
        {/* Drawn at what the simulation says, which is the whole change.
            Until the engine has loaded there is nothing to say, so UR12e
            falls back to its own baked cycle -- the same thing it does in
            every cell that is not driving it. */}
        <UR12e q={simReady ? act : undefined} />
      </group>
    </group>
  );
}
