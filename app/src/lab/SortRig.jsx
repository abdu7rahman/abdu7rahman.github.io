import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import UR12e from "./UR12e.jsx";
import { register, isRunning } from "./console.js";
import { useSim } from "../sim/useSim.js";
import { sortScene, SORT } from "../sim/models.js";
import { solve, roll, tcp } from "../sim/ik.js";
import { P } from "../lib/palette.js";
import { WORK } from "../lib/plan.js";

/* Two arms sorting a bench of tools, which is the task this project actually
 * collected data on.
 *
 * This cell used to be an eight-phase handover of one block, played back from
 * poses solved offline. It could not drop anything, could not fail, and was
 * not the task any of the recordings in abdu7rahman/bimanual-ur5-tools-* are
 * of. It is the real one now: six tools scattered on a bench, long ones to
 * the far bin and short ones to the near one, two arms working at the same
 * time.
 *
 * Nothing here is choreographed. Each arm runs its own small state machine
 * and takes whatever unsorted tool is nearest it that the other has not
 * already claimed, so which arm does what changes with where things end up.
 * MuJoCo owns the rest: every tool is a free body with a real shape and a
 * real mass distribution, so a hammer held at the middle of its handle swings
 * about its head, a tool released early lands where it lands, and a tool that
 * misses the bin is still on the bench to be picked up again.
 *
 * The grippers are adhesion actuators -- a force with a ceiling, not a
 * constraint -- so a grasp is something that can be lost. The console counts
 * what has been sorted and what has been dropped, and both are readings
 * rather than declarations: a tool counts as sorted when the simulation says
 * it is inside a bin, not when the sequence says it should be.
 */

const CLEAR = 0.26;          // how far above a tool an arm stands off
/* Zero, because the jaws have to straddle the tool rather than hover over it.
   This was 0.046 while the gripper was an adhesion actuator with a 50 mm
   detection margin, where hovering was the whole idea. With fingers it means
   closing on air: measured, the cell ran 140 simulated seconds, nudged four
   tools and picked up none. The pads are centred on the tool point to within
   2 mm by construction (see sim/models.js), so commanding the tool point to
   the tool's own centre puts them either side of it.
  
   0.012 rather than 0, because a pad centred on a tool lying on a bench has
   half its height below the bench top: measured at 0, the jaws drove into the
   bench and shoved four of the six tools around without lifting any. Twelve
   millimetres up puts a 32 mm pad from 4 mm to 36 mm above the slab, which
   still overlaps every tool here and clears the bench. */
const TOUCH = 0.012;
const REACH = 0.95;          // how far from its own base an arm will go
/* Half the gap between the pads, in metres, which is what one finger joint
   travels. Shut is narrower than the thinnest tool here -- a 20 mm
   screwdriver shaft -- so the fingers always close onto something rather than
   onto each other, and the position servo's force limit is what holds it.
   Open is wide enough to drop over the widest. */
/* How far each jaw slides out, in metres, so the gap between the pads is
 * twice this. 0.044 of a possible 0.046: as near open as the joint goes.
 *
 * It was 0.028 -- a 56 mm gap -- and that is what stopped the cell working.
 * The widest tool on the bench is a 22 mm capsule, so 56 mm leaves 17 mm of
 * clearance either side, and the arm does not arrive within 17 mm: a position
 * servo reaching out over a bench droops, and measured at the end of an
 * approach it was 20 to 27 mm off laterally. So one pad came down on the tool
 * instead of beside it.
 *
 * What that looks like from outside is not a gripper fault at all, which is
 * why it survived four rounds of looking. Watched frame by frame: the tool
 * point descends cleanly from 262 mm to 47, one pad touches, and then it
 * stops -- and stays at 47 mm while the descent trim winds its target down
 * to -38 mm and the wrist saturates at half a radian of lag trying to push
 * through. Every later symptom follows from that. The jaws close on the top
 * edge of a tool they are resting on, the lift pulls it out of them, and six
 * tools get swept around a bench for a minute without one of them being
 * lifted by a millimetre.
 *
 * At 0.044 the gap is 88 mm and the clearance either side is 33 mm, which is
 * wider than the droop. It is also what anybody does before a blind approach:
 * open the hand all the way.
 */
/* How fast each joint's command may walk, in rad/s, and these are Universal
 * Robots' own published maxima rather than one number for all six.
 *
 * It was a single 1.9 for every joint, which is a reasonable stand-in for the
 * three big ones and less than two thirds of what the three wrists can do --
 * a UR12e is specified at 120 degrees a second on the base, shoulder and
 * elbow and 180 on the wrists. A cell whose every reorientation ran at the
 * shoulder's limit was slow for no reason anybody could point at: the wrist
 * roll that turns the jaw square to a tool is most of the move between
 * picking one up and putting it down, and it was crawling.
 *
 * So the table is the machine's. It is both faster and more nearly true,
 * which is the only kind of speed-up worth making here.
 */
const RATE = [2.094, 2.094, 2.094, 3.142, 3.142, 3.142];

const GRIP_OPEN = 0.044, GRIP_SHUT = 0.002;

/* Scene coordinates from simulation coordinates: MuJoCo is z-up, the scene is
   y-up, and this is the same quarter turn sim/engine.js applies to a body. */
const toScene = (x, y, z) => [x, z, -y];

/* One arm's programme, and the states that are moves advance on arriving
 * rather than on a stopwatch.
 *
 * They used to advance purely on elapsed time: approach ran for 2.0 s and
 * then the cell descended whether or not the arm had got to the tool. A
 * position servo on a 40 Nm wrist does not always cross 0.3 m in two
 * seconds, and when it does not, every state after it happens somewhere
 * else -- the jaws close on air, the lift lifts nothing, and the cycle ends
 * as a failed attempt for reasons that have nothing to do with grasping.
 * Measured on a 140 second soak, the cell got four of six tools into bins.
 *
 * So a move carries a tolerance as well as a timeout. It ends when the tool
 * point is within that tolerance of what it was sent to, or when the timeout
 * runs out, whichever is first -- and the timeouts are a backstop rather
 * than the mechanism.
 *
 * They have to be generous to stay a backstop, and the first attempt at them
 * was not. Traced at four samples a second through one cycle: approach ended
 * 426 mm from the tool because 3.2 s ran out, descend started from there and
 * ended 51 mm short because 2.6 s ran out, and the jaw closed on air half a
 * hand's width from the thing it was sent to pick up. Every timeout was
 * firing, which is to say the tolerances were decoration. A UR12e crossing
 * half a metre with its command rate limited to 1.9 rad/s takes a few
 * seconds, so these are a few seconds. The dwells (closing,
 * opening) have no tolerance because they are not going anywhere: what they
 * are waiting for is the gripper, and that is a time.
 *
 * Each state names where to go, whether the gripper is
   on, and what ends it -- either arriving or running out of patience. A
   timeout is not a nicety: a grasp that fails leaves an arm reaching for a
   tool it will never lift, and without one the cell stops for good. */
const PLAN = {
  seek:     { grip: 0, secs: 0.4 },
  /* 12 mm, not 35. The approach ends when it is inside its tolerance, so the
     tolerance is not a nicety -- it is the error the descent starts with, and
     the descent goes straight down. Measured, the lateral error at the moment
     a pad first touched was 35 mm, which is the old tolerance to the
     millimetre: the arm was doing exactly what it was told and being told the
     wrong thing. The jaw is 88 mm wide and the widest tool is 22, so a pad
     clears the work by 33 mm; 12 leaves that clearance most of its margin and
     is reachable now that the standing error is trimmed out on the way in as
     well as on the way down. */
  approach: { grip: 0, secs: 9.0, at: "tool", dz: CLEAR, tol: 0.012 },
  /* A pre-grasp pose, and it is the phase this cell was missing.
   *
   * The approach converges to within a few millimetres at 260 mm up, and
   * then the descent throws that away: reaching a quarter of a metre lower
   * is a different arm configuration carrying its own sag, and measured, the
   * lateral error grew from 2 mm at the end of the approach to 33 mm by the
   * time the jaws were at the work. That is more than the 33 mm a pad clears
   * the tool by, so a pad landed on it -- 0.2 seconds into a seven second
   * descent, long before any trim could notice.
   *
   * So the arm stops 60 mm up first and settles there. At 60 mm the pads
   * reach down to 44 mm and the tallest tool on the bench stands 22, so
   * nothing can be touched however far out the arm is; the standing error at
   * very nearly the grasp pose is free to be measured and trimmed out. The
   * descent that follows is a 48 mm move rather than a 250 mm one, and it
   * starts from a pose that has already been corrected. */
  poise:    { grip: 0, secs: 6.0, at: "tool", dz: 0.060, tol: 0.010 },
  descend:  { grip: 0, secs: 7.0, at: "tool", dz: TOUCH, tol: 0.014 },
  /* 1.7 s, not 0.6. This is a dwell, so its number is a time, and the time
     it has to cover is the jaw's own travel. Opening the gripper wide enough
     to clear the work doubled that travel -- 88 mm of gap to shut instead of
     56 -- and nobody extended the dwell to match: measured at the end of a
     close, the jaw still read 45 to 58 mm when a 22 mm tool between the pads
     would read 22. The jaws were still moving when the lift began, the arm
     went up, and the tool came out of a hand that had not finished closing.
     Every grasp in the cell failed this way, and the jaw command at the top
     of the lift read 4 mm -- shut on nothing. */
  close:    { grip: 1, secs: 1.7, at: "tool", dz: TOUCH },
  lift:     { grip: 1, secs: 6.0, at: "claim", dz: CLEAR + 0.08, tol: 0.05 },
  carry:    { grip: 1, secs: 9.0, at: "bin", dz: 0.34, tol: 0.055 },
  /* Down to 0.16 and held for 1.6 s before opening. A tool is grasped
     wherever the gripper happened to land on it, so it hangs off centre and
     swings -- released from 0.20 m up while still swinging, a wrench landed
     0.08 m outside its bin, stayed unsorted, and the arm re-claimed it and
     failed the same way for the rest of the run. Lower and settled first. */
  place:    { grip: 1, secs: 6.0, at: "bin", dz: 0.16, tol: 0.03, min: 0.6 },
  open:     { grip: 0, secs: 0.8, at: "bin", dz: 0.16 },
  back:     { grip: 0, secs: 5.0, at: "home", dz: 0, tol: 0.11 }
};
const NEXT = { seek: "approach", approach: "poise", poise: "descend", descend: "close", close: "lift",
               lift: "carry", carry: "place", place: "open", open: "back", back: "seek" };

export default function SortRig({ stop }) {
  const s = stop.side;
  const x = s * WORK;
  const [sim, ready] = useSim(sortScene, []);

  const kit = useMemo(() => ({
    cmd: [new Float32Array([0, -1.2, 1.4, -1.75, -1.57, 0]),
          new Float32Array([0, -1.2, 1.4, -1.75, -1.57, 0])],
    /* Six joints and the jaw. The seventh is what lab/UR12e.jsx slides the
       drawn fingers by; without it the gripper was drawn shut whatever the
       two simulated slide joints were doing. */
    act: [new Float32Array(7), new Float32Array(7)],
    /* Per arm: what it is doing, how long it has been doing it, and which
       tool it has claimed. The claim is what keeps two arms off one tool
       without either of them knowing about the other's programme. */
    state: ["seek", "seek"], t: [0, 0], claim: [null, null],
    /* Where each arm was sent last frame, in scene coordinates, and how far
       it is from it. The readout carries the error because a cell that says
       "descend" and nothing else cannot be told apart from a cell that has
       been saying "descend" for two seconds because it cannot get there. */
    lastTgt: [new THREE.Vector3(), new THREE.Vector3()],
    err: [0, 0], res: [0, 0], lag: [0, 0],
    want: [new Float64Array(6), new Float64Array(6)],
    jaw: new THREE.Vector3(),
    /* Integral trim on the descent, per arm, in metres.
    
       A position servo reaching down under gravity settles short of its
       command, and how short depends on how far out the arm is -- measured
       on this cell, about 2 cm at the bench, which is more than the
       thickness of half the tools here. So the jaws closed above the work.
       Commanding a fixed amount lower would be a guess that is wrong
       everywhere except where it was measured; this accumulates the
       difference between where the tool point was asked to be and where the
       simulation says it is, and is capped so a blocked arm cannot wind it
       up. It is the integral term of a controller, and it is here for the
       reason integral terms are always here: there is a standing error and
       proportional action cannot remove it. */
    trim: [new THREE.Vector3(), new THREE.Vector3()],
    /* This frame's target in the cell's own frame, per arm, kept because the
       trim is wound from the error against it after the physics has stepped
       and `tgt` is a scratch vector both arms write. */
    simTgt: [new THREE.Vector3(), new THREE.Vector3()],
    /* Where the grasp happened, in the cell's frame, taken once as the jaws
       shut. The lift goes straight up from here. */
    held: [new THREE.Vector3(), new THREE.Vector3()],
    tp: new THREE.Vector3(),
    lastTP: [new THREE.Vector3(), new THREE.Vector3()],
    haveTP: [false, false],
    terr: [new THREE.Vector3(), new THREE.Vector3()],
    /* How many times each arm has tried and failed on a given tool. An arm
       that keeps choosing the nearest thing will choose the same unreachable
       or un-grippable thing forever, and measured, that is exactly what
       happened: one wrench landed short of its bin and the left arm spent the
       remaining sixty seconds re-attempting it while a second wrench nobody
       else could reach sat untouched. After two goes a tool goes to the back
       of the queue rather than being abandoned, so the cell always has
       something to do and never gives up on anything permanently. */
    tries: new Map(),
    sorted: new Set(), floor: new Set(), cycles: 0,
    tgt: new THREE.Vector3(), base: new THREE.Vector3(),
    a: new THREE.Vector3(), b: new THREE.Vector3()
  }), []);

  const armRefs = [useRef(kit.act[0]), useRef(kit.act[1])];
  const toolRefs = useRef([]);

  useEffect(() => { armRefs[0].current = kit.act[0]; armRefs[1].current = kit.act[1]; }, [kit]);

  useEffect(() => register(stop.id, {
    title: "Bimanual tool sorting",
    actions: [
      { label: "Reset", on: () => {
        kit.state = ["seek", "seek"]; kit.t = [0, 0]; kit.claim = [null, null];
        kit.sorted.clear(); kit.floor.clear(); kit.cycles = 0;
        if (sim.current) sim.current.reset();
      } }
    ],
    readout: () => [
      ["sorted", `${kit.sorted.size} / ${SORT.tools.length}`],
      ["left arm", kit.state[0] + (isFinite(kit.err[0]) ? "  " + (kit.err[0] * 1000).toFixed(0) + " mm" : "")],
      ["right arm", kit.state[1] + (isFinite(kit.err[1]) ? "  " + (kit.err[1] * 1000).toFixed(0) + " mm" : "")],
      ["on the floor", String(kit.floor.size)]
    ],
    /* What it is doing, in words, per arm. */
    say: () => {
      const done = kit.sorted ? kit.sorted.size : 0;
      const w = (i) => {
        const st = kit.state && kit.state[i];
        const t = kit.claim && kit.claim[i];
        if (!st) return "waiting";
        if (st === "seek") return "looking for a tool";
        if (st === "approach" || st === "poise" || st === "descend")
          return "reaching for the " + (t || "next tool");
        if (st === "close") return "closing on the " + (t || "tool");
        if (st === "lift" || st === "carry") return "carrying the " + (t || "tool") + " to a bin";
        if (st === "place" || st === "open") return "letting go over the bin";
        return "going home";
      };
      return `${done} of ${SORT.tools.length} sorted. Left arm is ${w(0)}; `
           + `right arm is ${w(1)}. `
           + `Every tool is a free body, so a grasp can miss.`;
    },
    hint: "Long tools to the far bin, short to the near one. Each arm takes whatever is nearest it.",
    /* Steppable from outside. See the note on tick(). */
    tick: (d) => { if (sim.current) tick(d); },
    /* The compiled scene itself, for a probe that needs to ask the physics a
       question the cell does not expose -- how wide the jaw actually opens
       for a given command, for instance. */
    sim: () => sim.current,
    /* And the cell's own working state, for the same reason. The readout
       carries a phase and one scalar error, which is enough to see that a
       move did not arrive and not enough to see which way it missed. */
    kit: () => kit,
    /* What the solver thinks an arm's joints do against what the simulation
       does with the same joints, in the arm's own base frame. Two kinematic
       models that disagree look exactly like a servo that will not track,
       and telling them apart from the outside is otherwise guesswork. */
    fk: () => [0, 1].map(arm => {
      const sm = sim.current;
      if (!sm) return null;
      const pre = arm === 0 ? "l" : "r";
      const q = new Float64Array(6);
      for (let i = 0; i < 6; i++) q[i] = sm.jointAt(`${pre}_j${i}`);
      const model = tcp(q, new THREE.Vector3());
      sm.point(`${pre}_tcp`, kit.a);
      /* The tcp body into the arm's base frame: the mount is at the cell's
         centre line, `SORT.base` to this arm's side and `SORT.mount` up, and
         the arm is turned a quarter turn to face across the bench. */
      const by = arm === 0 ? SORT.base : -SORT.base;
      const cx = kit.a.x, cy = -kit.a.z - by, cz = kit.a.y - SORT.mount;
      const yaw = arm === 0 ? -Math.PI / 2 : Math.PI / 2;
      const c = Math.cos(-yaw), sn = Math.sin(-yaw);
      const real = new THREE.Vector3(cx * c - cy * sn, cx * sn + cy * c, cz);
      return {
        q: [...q].map(v => +v.toFixed(3)),
        model: [+model.x.toFixed(4), +model.y.toFixed(4), +model.z.toFixed(4)],
        realTcpBody: [+real.x.toFixed(4), +real.y.toFixed(4), +real.z.toFixed(4)],
        diff_mm: [+((model.x - real.x) * 1000).toFixed(1),
                  +((model.y - real.y) * 1000).toFixed(1),
                  +((model.z - real.z) * 1000).toFixed(1)]
      };
    })
  }), [stop.id, kit, sim]);

  /* Where the gripper's tool point is, in three's coordinates.
   *
   * sim/models.js puts the `_tcp` body 46 mm short of TCP_Z along the tool's
   * own z, so that the pads' centre lands on the point sim/ik.js solves for.
   * Taking that back out by subtracting 46 mm from the world height is only
   * right when the tool is pointing exactly straight down, and on the way in
   * it is not -- the arm is still turning. A 12 degree tilt is 10 mm of
   * horizontal error and it does not go away, which is fatal to an integral
   * term: measured, the trim's own error settled at a standing [-6, 8, -10]
   * mm that no amount of winding removed, so it wound to its cap and dragged
   * the target out from under the arm while the arm dutifully followed.
   *
   * Offset along the tool's actual axis instead, which is right at any
   * orientation and is the same three numbers the simulator already has. */
  function toolPointOf(sm, arm, out) {
    const pre = arm === 0 ? "l" : "r";
    sm.point(`${pre}_tcp`, out);
    sm.dir(`${pre}_tcp`, 2, kit.b);
    return out.addScaledVector(kit.b, 0.046);
  }

  /* Where a tool is, right now, in simulation coordinates. Read every time
     rather than cached: these are free bodies and the whole point is that
     they end up somewhere the cell did not choose. */
  function toolAt(sm, id, out) {
    sm.point(id, kit.a);
    return out.set(kit.a.x, -kit.a.z, kit.a.y);
  }

  /* Is this tool in its bin. The test is the bin's own footprint and a
     height, so a tool balanced on the rim does not count and a tool that
     bounced out stops counting. */
  function inBin(p, binIndex) {
    const [bx, by] = SORT.bin[binIndex];
    return Math.abs(p.x - bx) < 0.21
        && (Math.abs(p.y - by) < 0.17 || Math.abs(p.y + by) < 0.17)
        && p.z < 0.14;
  }

  /* Did the arm's claim end up where it was supposed to. Asked at the end of
     a cycle, off the simulation, not off the plan. */
  function claimFailed(arm, where) {
    const id = kit.claim[arm];
    if (!id) return false;
    const i = SORT.tools.findIndex(t => t.id === id);
    return i >= 0 && !inBin(where[i], SORT.tools[i].bin);
  }

  /* The whole cell, as one step of a given length, so it can be driven by
   * something other than the frame clock.
   *
   * A pick-and-place cycle is twelve simulated seconds, and this building
   * renders at about one and a half frames a second under a software
   * rasteriser with the step capped at 0.1 s -- eight simulated seconds per
   * minute of waiting. Soaking the cell for the hundred and fifty seconds it
   * takes to sort six tools would be twenty minutes of wall clock per
   * attempt, and it is not possible to fix something you can only observe
   * once every twenty minutes. So the body of the frame callback is a
   * function, the console registry carries it, and a probe can run it at
   * whatever rate it likes. What gets skipped is the rendering; the cell is
   * the same cell.
   */
  /* A fixed control rate, whatever the frame rate.
   *
   * This used to do one pass of control and then hand the whole frame to the
   * physics, which makes the cell a different machine on every device: at
   * 240 Hz the controller sees the arm four times as often as at 60, and
   * everything in here that is rate limited or integrated -- the command
   * walk, the descent trim, the dwell timers -- lands somewhere different.
   * It is not a subtle difference. Driven at 1/240 the cell sorted two tools
   * of six in 200 simulated seconds; driven at 1/60, the rate a browser
   * actually delivers, the same build sorted none.
   *
   * So time is accumulated and spent in fixed 1/120 s steps. A slow frame
   * runs several and a fast one runs none, which is what makes the result
   * the same either way. Capped at eight steps so a tab returning from the
   * background catches up rather than freezing while it replays a minute.
   */
  const HZ = 1 / 120;
  let acc = 0;

  function tick(dt) {
    if (!sim.current) return;
    acc += Math.min(0.25, Math.max(0, dt));
    let n = 0;
    while (acc >= HZ && n < 8) { acc -= HZ; step1(HZ); n++; }
    if (n === 8) acc = 0;
  }

  function step1(dt) {
    const sm = sim.current;
    if (!sm) return;
    const d = dt;
    const run = isRunning(stop.id);

    // Where everything is, once, before either arm decides anything.
    const where = SORT.tools.map(t => toolAt(sm, t.id, new THREE.Vector3()));
    SORT.tools.forEach((t, i) => {
      if (inBin(where[i], t.bin)) kit.sorted.add(t.id); else kit.sorted.delete(t.id);
      if (where[i].z < -0.5) kit.floor.add(t.id); else kit.floor.delete(t.id);
    });

    for (const arm of [0, 1]) {
      const by = arm === 0 ? SORT.base : -SORT.base;
      const st = kit.state[arm];
      const step = PLAN[st];
      if (run) kit.t[arm] += d;

      /* How far the tool point is from the last thing it was sent to.
         Measured against the previous frame's target because this frame's is
         not chosen until the state is, and a state that is deciding whether
         to end cannot be asked about where it is going next. The 46 mm is
         the offset sim/models.js puts between the tcp body and the tool
         point, taken out in the same place the descent trim takes it out. */
      let err = Infinity;
      const lastT = kit.lastTgt[arm];
      if (lastT) {
        toolPointOf(sm, arm, kit.a);
        err = Math.hypot(kit.a.x - lastT.x, kit.a.y - lastT.y, kit.a.z - lastT.z);
      }
      kit.err[arm] = err;
      /* A move ends on arriving, but not before it has had time to move.
         Half a second, because the first frame of a state measures against a
         target the arm may already be standing on -- a lift that begins
         where the descent ended is, for one frame, "arrived" -- and without
         a floor the cell chained close, lift, carry and place in 1.5 s and
         released over the bench it had just picked from. */
      const done = step.tol
        ? (err < step.tol && kit.t[arm] >= (step.min || 0.5)) || kit.t[arm] >= step.secs
        : kit.t[arm] >= step.secs;

      if (st === "seek") {
        /* Nearest unsorted, unclaimed, still-on-the-bench tool within reach.
           Nearest to this arm's own base, which is what makes the two of them
           divide the bench between themselves without being told to. */
        let best = null, bestD = Infinity;
        SORT.tools.forEach((t, i) => {
          if (kit.sorted.has(t.id) || kit.floor.has(t.id)) return;
          if (kit.claim[1 - arm] === t.id) return;
          const dist = Math.hypot(where[i].x, where[i].y - by, where[i].z - SORT.mount);
          const penalty = (kit.tries.get(t.id) || 0) * 0.6;
          if (dist < REACH && dist + penalty < bestD) { bestD = dist + penalty; best = t.id; }
        });
        kit.claim[arm] = best;
        if (best && kit.t[arm] >= step.secs) { kit.state[arm] = "approach"; kit.t[arm] = 0; }
        if (!best) kit.t[arm] = 0;
      } else if (done) {
        /* Remember where the tool was at the instant the jaws shut, because
           from here on it is not a thing in the world, it is a thing in the
           hand. */
        if (st === "close") {
          const k = kit.claim[arm] ? SORT.tools.findIndex(t => t.id === kit.claim[arm]) : -1;
          if (k >= 0) kit.held[arm].copy(where[k]);
        }
        kit.state[arm] = NEXT[st];
        kit.t[arm] = 0;
        if (kit.state[arm] === "seek") {
          // A cycle that ended with the tool still out of its bin was a
          // failed attempt, and the count is what stops it repeating.
          if (claimFailed(arm, where)) kit.tries.set(kit.claim[arm], (kit.tries.get(kit.claim[arm]) || 0) + 1);
          kit.claim[arm] = null; kit.cycles++; kit.trim[arm].set(0, 0, 0);
        }
      }

      // Where this arm is reaching, in simulation coordinates.
      const claim = kit.claim[arm];
      const spec = PLAN[kit.state[arm]];
      const idx = claim ? SORT.tools.findIndex(t => t.id === claim) : -1;
      if (spec.at === "tool" && idx >= 0) {
        kit.tgt.copy(where[idx]).setZ(where[idx].z + spec.dz).sub(kit.trim[arm]);
      }
      else if (spec.at === "claim" && idx >= 0) {
        /* Straight up from where it was picked, not from where it is.
         *
         * This read the tool's live position, and the moment the jaws close
         * the tool's live position is wherever the gripper has carried it --
         * so the arm was chasing the thing in its own hand. Every step out
         * moved the target another step out, and measured, tools ended the
         * run at 1200 mm and more across a bench whose furthest bin is at
         * 760, flung there by an arm following itself. The grasp point is
         * taken once, as the hand shuts, and the lift is vertical from it. */
        kit.tgt.copy(kit.held[arm]).setZ(SORT.mount + spec.dz);
      }
      else if (spec.at === "bin" && idx >= 0) {
        // This arm's own bin for that class of tool, on this arm's own side.
        const [bx, bY] = SORT.bin[SORT.tools[idx].bin];
        kit.tgt.set(bx, arm === 0 ? bY : -bY, spec.dz);
      } else {
        kit.tgt.set(0.36, by * 0.72, SORT.mount + 0.30);
      }

      /* Into the arm's own base frame: the two stand facing each other, so
         the transform is a translation and a quarter turn. */
      kit.lastTgt[arm].set(kit.tgt.x, kit.tgt.z, -kit.tgt.y);
      kit.simTgt[arm].copy(kit.tgt);

      const yaw = arm === 0 ? -Math.PI / 2 : Math.PI / 2;
      const c = Math.cos(-yaw), sn = Math.sin(-yaw);
      const dx0 = kit.tgt.x, dy0 = kit.tgt.y - by;
      kit.base.set(dx0 * c - dy0 * sn, dx0 * sn + dy0 * c, kit.tgt.z - SORT.mount);
      /* Solve to where it should end up, then walk the command there at a
       * speed the arm can hold.
       *
       * The solve used to be written straight into the command, which moves
       * the set point the whole way in one frame. A position servo given a
       * set point two radians away saturates, and what the arm does is an
       * exponential lunge that is behind the command the entire time:
       * measured, the tool point sat 100 to 180 mm from where it had been
       * sent for the whole of every descent, while the solver's own residual
       * was under 2 mm. The gap was not the kinematics, it was asking a
       * 40 Nm wrist to be somewhere instantly.
       *
       * 1.9 rad/s is inside what a UR12e does (its published joint maximum
       * is pi) and turns the command into a trajectory rather than a step.
       */
      kit.res[arm] = solve(kit.cmd[arm], kit.base, kit.want[arm], 20);
      /* Turn the jaws across the tool, not along it.
       *
       * sim/ik.js has exported roll() for this since the gripper stopped
       * being an adhesion pad, with a comment describing exactly what
       * happens without it -- the jaws line up with the bar's length, one pad
       * lands on it, the other goes past, and the tool is dragged sideways
       * instead of lifted. Nothing called it. Measured over 150 simulated
       * seconds, no tool was ever lifted higher than 30 mm.
       *
       * The wanted jaw direction is the horizontal perpendicular to the
       * tool's own long axis, read off the simulation and taken into the
       * arm's base frame by the same quarter turn the target is. */
      if (idx >= 0 && (spec.at === "tool")) {
        sm.dir(SORT.tools[idx].id, 0, kit.a);      // scene coordinates
        const ax = kit.a.x, ay = -kit.a.z;         // -> simulation, horizontal
        const m = Math.hypot(ax, ay);
        if (m > 1e-6) {
          // Perpendicular, in the cell frame, then into the arm's frame.
          const px = -ay / m, py = ax / m;
          kit.jaw.set(px * c - py * sn, px * sn + py * c, 0);
          roll(kit.want[arm], kit.jaw);
        }
      }
      /* How fast the command may walk. Gentler while something is
         held: a tool is gripped wherever the jaws happened to land on it,
         which on a 22 mm bar lying on a bench is a pinch near its top, and a
         pinch survives being carried but not being thrown. Measured, tools
         that were properly in the jaws at the end of the close were out of
         them by the end of the lift -- the jaw command reads 4 mm, fully
         shut on nothing, at the top of a 620 mm move made at full command
         rate. Half rate while the gripper is closed. */
      const hold = spec.grip ? 0.5 : 1;
      for (let i = 0; i < 6; i++) {
        const lim = RATE[i] * hold * d;
        const e = kit.want[arm][i] - kit.cmd[arm][i];
        kit.cmd[arm][i] += Math.max(-lim, Math.min(lim, e));
      }
      /* By name, not by index. The arms carry eight actuators each now -- six
         joints and two fingers -- so arm * 6 + i quietly addressed the wrong
         arm's shoulder the moment the gripper stopped being an adhesion
         actuator appended after both arms. */
      const a = arm === 0 ? "l" : "r";
      for (let i = 0; i < 6; i++) sm.actuate(`${a}_a${i}`, kit.cmd[arm][i]);
      // The finger command is a jaw opening in metres, not a flag.
      const jaw = spec.grip ? GRIP_SHUT : GRIP_OPEN;
      sm.actuate(`${a}_ga`, jaw);
      sm.actuate(`${a}_gb`, jaw);
    }

    sm.step(d);

    /* Wind the trim: three axes, and gated on the command rather than on the
       error.
     *
     * This was one number and it was the vertical one, on the argument that
     * gravity acts down and so that is the axis with a standing offset. The
     * argument is half right. Gravity is why the shoulder sags, but a sagging
     * shoulder does not move the tool point straight down -- it swings it
     * along an arc, and the arm is reaching out across a bench, so the error
     * comes out in all three. Measured at the end of a descent, with the old
     * single-axis trim at its cap: the tool point sat 28 mm above the tool it
     * was reaching for, 27 mm out in x and 20 mm out in z. The jaws closed on
     * the top edge of a 22 mm capsule, the lift pulled it out of them, and
     * the cell sorted nothing -- six tools, zero lifted by so much as a
     * millimetre over a minute of simulated time.
     *
     * The cap was the other half. The droop measured 46 mm and the trim
     * could not exceed 30, so even the one axis it did correct could not
     * close. Raising it is only safe with a gate that cannot mistake travel
     * for sag, which is where the old gate -- wind only inside 25 mm -- came
     * from, and it is circular in exactly the way its own comment worried
     * about: it is the error being corrected that decides whether to correct
     * it, so anything drooping further than the gate stays drooped forever.
     *
     * The non-circular discriminator is the command. `want` is where the
     * solver says the joints should be and `cmd` is where they have been
     * walked to at 1.9 rad/s; while those differ the arm is still on its way
     * and any error is travel. Once they agree the set point has stopped
     * moving, and whatever error is left is standing error by definition --
     * which is the thing an integral term exists to remove. So it winds only
     * then, and the cap is 60 mm: over the 46 mm measured, under the 68 mm
     * that used to put the commanded tool point through the bench. */
    for (const arm of [0, 1]) {
      const st = kit.state[arm];
      if (st !== "descend" && st !== "approach" && st !== "poise") continue;
      const idx = kit.claim[arm] ? SORT.tools.findIndex(t => t.id === kit.claim[arm]) : -1;
      if (idx < 0) continue;
      /* Wind only when the arm has stopped, and "the arm" means the arm.
       *
       * The gate used to be that the command had arrived at the solver's
       * answer, on the argument that a set point which has stopped moving
       * leaves only standing error behind. The argument is right and the
       * measurement is not what it predicts: the command is walked at
       * 1.9 rad/s and a 48 mm descent is 0.08 rad, so it arrives in forty
       * milliseconds, while the arm it is dragging takes half a second to
       * follow. In that gap the gate is open and the whole of an ordinary
       * travel error is read as sag -- measured, the trim went from 2 mm at
       * the end of the pre-grasp pose to 40 by the bottom of a descent that
       * only had 48 mm to cover, and shoved the arm that far sideways.
       *
       * So the tool point's own speed decides. It is already being read here
       * every frame; two frames of it is a velocity, and an arm under 10 mm
       * a second has arrived at whatever it was going to arrive at. */
      /* And only once the command has stopped moving: while the solver's
         answer and the walked command still differ the arm is on its way,
         and where it is on the way is not a standing error. */
      let moving = 0;
      for (let i = 0; i < 6; i++) {
        moving = Math.max(moving, Math.abs(kit.want[arm][i] - kit.cmd[arm][i]));
      }
      if (moving > 0.03) continue;
      toolPointOf(sm, arm, kit.a);
      kit.tp.set(kit.a.x, -kit.a.z, kit.a.y);
      /* And not while a pad is against something. An integral term assumes
         that moving the set point moves the thing it is measuring; a jaw
         resting on the work breaks that assumption, and what the term does
         then is wind to its cap and saturate a wrist against a tool it is
         standing on. Contact means the arm is not short, it is blocked, and
         the answer to blocked is not more command. */
      const pre = arm === 0 ? "l" : "r";
      if (sm.touching(`${pre}_pa`) || sm.touching(`${pre}_pb`)) continue;
      kit.tp.sub(kit.simTgt[arm]);
      kit.terr[arm].copy(kit.tp);
      /* 0.35 a second, not 1.6.
       *
       * An integral term has to be slower than the thing it is correcting or
       * it does not converge, it hunts -- and this one is correcting an arm
       * whose command is rate limited to 1.9 rad/s and which then has its own
       * servo lag on top, so the loop it closes around is a few tenths of a
       * second wide. At 1.6 it slewed the target 160 mm a second, faster than
       * the arm could follow: measured, it drove to its 60 mm cap in every
       * axis, sat there while the arm caught up, and the standing error it
       * was meant to remove came back as a 40 mm lateral miss -- which is
       * what put a jaw pad on top of the tool. */
      /* Three axes, slowly, and cleared every cycle.
       *
       * Every one of those three is a fix for a way this wound up instead of
       * converging. Slowly, at 0.35 a second, because the arm it is steering
       * has its command rate limited to 1.9 rad/s and a servo lag on top, and
       * an integral faster than its plant hunts: at 1.6 it slewed the target
       * 160 mm a second and drove every axis to its cap. Cleared every cycle,
       * because carrying the estimate forward carried the wind-up forward
       * with it and the arm got worse the longer it ran. And capped at 40 mm,
       * which is more than the error ever is once the servos are stiff enough
       * and less than the distance that would put a commanded tool point
       * through the bench. */
      const t = kit.trim[arm], g = d * 0.35, C = 0.04;
      t.set(Math.max(-C, Math.min(C, t.x + kit.tp.x * g)),
            Math.max(-C, Math.min(C, t.y + kit.tp.y * g)),
            Math.max(-C, Math.min(C, t.z + kit.tp.z * g)));
    }

    /* What each arm is actually holding, read by joint name.
     *
     * This was sm.qpos[i * 6 + j], which is the model's qpos laid out six per
     * arm -- true while a gripper was an adhesion actuator with no joints of
     * its own, and false the moment each arm grew two finger slides. The
     * second arm's shoulder moved from 6 to 8, so the right arm was being
     * drawn from the left arm's fingers and its own first four joints:
     * measured, it sat 3.5 to 6.0 rad from everything it had been commanded
     * while the left arm tracked to 0.01, and what was on screen was a
     * machine flailing next to one that worked.
     */
    for (const i of [0, 1]) {
      const a = i === 0 ? "l" : "r";
      let worst = 0;
      for (let j = 0; j < 6; j++) {
        kit.act[i][j] = sm.jointAt(`${a}_j${j}`);
        const e = Math.abs(kit.act[i][j] - kit.cmd[i][j]);
        if (e > worst) worst = e;
      }
      /* And the jaw, as the simulation has it rather than as it was asked
         for: a gripper closing on a tool stops where the tool is. */
      kit.act[i][6] = sm.jointAt(`${a}_ga`);
      kit.lag[i] = worst;
    }
    SORT.tools.forEach((t, i) => {
      const o = toolRefs.current[i];
      if (o) sm.pose(t.id, o);
    });
  }

  useFrame((_, dt) => tick(dt));

  const bin = (bx, yy, key, label) => (
    <group key={key} position={toScene(bx, yy, 0)}>
      <mesh position={[0, 0.012, 0]} receiveShadow>
        <boxGeometry args={[0.32, 0.024, 0.26]} />
        <meshStandardMaterial color={P.steelDk} roughness={0.8} metalness={0.2} />
      </mesh>
      {[[0.16, 0, 0.024, 0.26], [-0.16, 0, 0.024, 0.26],
        [0, 0.13, 0.32, 0.024], [0, -0.13, 0.32, 0.024]].map(([dx, dz, w, dd], i) => (
        <mesh key={i} position={[dx, 0.075, dz]} castShadow receiveShadow>
          <boxGeometry args={[w, 0.15, dd]} />
          <meshStandardMaterial color={P.steel} roughness={0.7} metalness={0.35} />
        </mesh>
      ))}
      {/* The one painted line in the cell, on the lip of the bin, because the
          bins are the only thing here that means anything. */}
      <mesh position={[0, 0.152, label === 0 ? 0.13 : -0.13]}>
        <boxGeometry args={[0.32, 0.008, 0.03]} />
        <meshStandardMaterial color={P.hazard} roughness={0.8} />
      </mesh>
    </group>
  );

  return (
    /* Turned to face the aisle, by the same rule as the other arm cells:
       every rig placed itself with x = side * WORK and no rotation, so all
       seven pointed the same absolute way and which side of the lane a cell
       stood on decided whether a visitor met its front or its back. */
    <group position={[x, 0.9, 0]} rotation-y={s < 0 ? Math.PI : 0}>
      {[SORT.base, -SORT.base].map((b, i) => (
        <mesh key={i} position={toScene(0, b, SORT.mount / 2)} castShadow receiveShadow>
          <cylinderGeometry args={[0.09, 0.09, SORT.mount, 12]} />
          <meshStandardMaterial color={P.steelDk} roughness={0.7} metalness={0.4} />
        </mesh>
      ))}
      {bin(SORT.bin[0][0], SORT.bin[0][1], "ll", 0)}
      {bin(SORT.bin[1][0], SORT.bin[1][1], "sl", 1)}
      {bin(SORT.bin[0][0], -SORT.bin[0][1], "lr", 0)}
      {bin(SORT.bin[1][0], -SORT.bin[1][1], "sr", 1)}

      {/* The tools. Drawn to the same dimensions the simulation collides with,
          which is why the shapes are read off SORT rather than chosen here:
          a hammer whose picture is longer than its collision proxy is a
          hammer that visibly passes through the bench. */}
      {SORT.tools.map((t, i) => (
        <group key={t.id} ref={el => (toolRefs.current[i] = el)}>
          {t.kind === "hammer" ? (
            <>
              {/* MuJoCo's capsules run along local x and three's cylinders
                  along local y, so every round tool here is turned a quarter
                  about z to agree with the body it is drawn for. The handle
                  is also off centre, because its capsule runs from -half to
                  +0.65 half and the head takes the rest. */}
              <mesh rotation-z={Math.PI / 2} position={[-t.len * 0.0875, 0, 0]}
                    castShadow receiveShadow>
                <cylinderGeometry args={[0.011, 0.011, t.len * 0.825, 8]} />
                <meshStandardMaterial color={"#8c6b47"} roughness={0.85} />
              </mesh>
              <mesh position={[t.len * 0.41, 0, 0]} castShadow receiveShadow>
                <boxGeometry args={[0.052, 0.032, 0.032]} />
                <meshStandardMaterial color={P.steel} roughness={0.45} metalness={0.7} />
              </mesh>
            </>
          ) : t.kind === "bar" ? (
            <mesh castShadow receiveShadow>
              <boxGeometry args={[t.len, 0.032, 0.016]} />
              <meshStandardMaterial color={P.machine} roughness={0.35} metalness={0.75} />
            </mesh>
          ) : (
            <mesh rotation-z={Math.PI / 2} castShadow receiveShadow>
              <cylinderGeometry args={[0.010, 0.010, t.len, 8]} />
              <meshStandardMaterial color={P.hazard} roughness={0.6} metalness={0.2} />
            </mesh>
          )}
        </group>
      ))}

      {[0, 1].map(i => (
        <group key={i}
          position={toScene(0, i === 0 ? SORT.base : -SORT.base, SORT.mount)}
          rotation-y={i === 0 ? -Math.PI / 2 : Math.PI / 2}>
          <UR12e q={ready ? armRefs[i] : undefined} phase={i * 0.6} />
        </group>
      ))}
    </group>
  );
}
