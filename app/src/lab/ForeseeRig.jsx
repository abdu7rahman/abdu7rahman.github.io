import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import UR12e from "./UR12e.jsx";
import { linkFrames, toolPoint, REST } from "../../../world/kinematics.js";
import { lerpQ, clear, clearance, replan } from "./demos/via.js";
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
 */
const TICK = 1 / 30;
const SPEED = 0.55;          // fraction of the plan traversed per second
const OBS_R = 0.20;          // metres, and the console scales from it
const TUBE_R = 0.011;        // the drawn plan, in metres

/* The two ends of the move, and they are wider apart than the baked hero
   sequence's. That move is four poses within about a third of a radian of
   each other -- right for a machine idling in a hero shot, and useless here,
   because a tool path that short can be missed by an obstacle drifting
   through the middle of the workspace and this bay only says something when
   it is not. These are REST with the base swung either way and the shoulder
   and elbow opened, so the tool crosses most of the bench and anything in
   the middle of it is genuinely in the way. */
const ENDS = [
  Float32Array.from([REST[0] + 0.95, -1.15, 1.42, -1.86, -1.57, 0]),
  Float32Array.from([REST[0] - 1.15, -0.86, 1.05, -1.79, -1.57, 0])
];

function seeded(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* How far out from the arm the cursor's sheet stands, in the arm's own
   frame. The pad is drawn at this depth and the obstacle rides on it. */
const OBS_DEPTH = 0.34;

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
    return { frames, scratch, fk, rand: seeded(0x1F2E3D4C),
             a: Float32Array.from(ENDS[0]), b: Float32Array.from(ENDS[1]),
             via: null, u: 0, dead: false, hold: 0, acc: 0, dir: 1,
             r: OBS_R, lag: 0, touch: 0, gap: 0, ready: false };
  }, []);

  /* Two joint vectors now, and keeping them apart is the point. `cmd` is
     what the planner wants and what goes to the actuators; `act` is what the
     simulation says the arm did, and it is the one the mesh is drawn at. */
  const cmd = useRef(Float32Array.from(ENDS[0]));
  const act = useRef(Float32Array.from(ENDS[0]));
  const [sim, simReady] = useSim(replanScene, []);
  const obs = useRef(new THREE.Vector3(0.45, 0.0, 0.55));
  const held = useRef(99);
  const ball = useRef();
  const over = useRef(false);
  const mat = useRef();

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

  useEffect(() => register(stop.id, {
    title: "Cancel and replan",
    actions: [{ label: "Reset", on: () => {
      kit.a = Float32Array.from(ENDS[0]); kit.b = Float32Array.from(ENDS[1]);
      kit.via = null; kit.u = 0; kit.dead = false; kit.dir = 1;
      cmd.current.set(ENDS[0]); act.current.set(ENDS[0]); painted.current = false;
      if (sim.current) { sim.current.reset(); for (let i = 0; i < 6; i++) sim.current.qpos[i] = ENDS[0][i]; }
    } }],
    choice: {
      get: () => kit.r,
      set: (v) => { kit.r = v; },
      options: [
        { value: 0.13, label: "Small" },
        { value: 0.20, label: "Medium" },
        { value: 0.30, label: "Large" }
      ]
    },
    /* Four numbers, and two of them could not exist before there was a
       simulation to read them off. `lag` is the worst joint's distance from
       its own command in millidegrees -- a servo behind a moving target --
       and `touching` is how many contacts the solver is resolving, which is
       zero unless the planner has actually failed and the arm has actually
       hit something. */
    readout: () => [
      ["plan", kit.dead ? "blocked" : kit.via ? "detoured" : "direct"],
      ["obstacle", (kit.r * 2).toFixed(2) + " m"],
      ["lag", kit.ready ? (kit.lag * 1000).toFixed(0) + " mdeg" : "--"],
      ["clearance", kit.ready ? (kit.gap * 100).toFixed(0) + " cm" : "--"],
      ["touching", kit.ready ? String(kit.touch) : "--"]
    ],
    /* What it is doing, in words. The whole point of this bay is a moment
       that lasts about a second, and a readout row that flickers from
       "direct" to "around" is not a way to notice it. */
    say: () => {
      if (kit.touch) return "Your hand is touching the arm. It has stopped.";
      if (kit.blocked) return "Your hand is in the way. Cancelling the move and planning around it.";
      return over.current
        ? "Clear. Move across the cell and it will have to go round you."
        : "Clear. The ball is drifting through the workspace on its own -- watch it cut the path.";
    },
    touched: () => touched.current,
    hint: "Move the cursor across the cell to put your hand in the way.",
    /* Where the obstacle actually is, so a probe outside the page can check
       the one thing this cell is about and cannot be photographed: that the
       pointer reaches the sheet at all. It did not -- the sheet is a
       single-sided plane and three.js will not raycast the back of one, so
       on a cell turned away from the aisle the cursor missed it entirely and
       the ball drifted on its own timer whatever the reader did. */
    state: () => ({
      x: +obs.current.x.toFixed(3), y: +obs.current.y.toFixed(3),
      z: +obs.current.z.toFixed(3), over: over.current ? 1 : 0,
      dead: kit.dead ? 1 : 0, via: kit.via ? 1 : 0, touch: kit.touch
    })
  }), [stop.id, kit, sim]);

  useFrame(({ clock, camera }, dt) => {
    const d = Math.min(0.1, dt);
    if (!isLive(stop, camera)) return;
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
      const t = clock.elapsedTime * 0.55;
      obs.current.set(0.30 + 0.26 * Math.cos(t), 0.30 * Math.sin(t * 0.8),
                      0.62 + 0.20 * Math.sin(t));
    }
    if (ball.current) {
      ball.current.position.copy(obs.current);
      ball.current.scale.setScalar(kit.r / OBS_R);
    }

    kit.acc += d;
    if (kit.acc >= TICK) {
      kit.acc -= TICK;
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

      if (!ok && !kit.dead) { kit.dead = true; kit.hold = 0; }
      /* And back the other way. The obstacle moves, so a plan that was dead
         can become live again -- and nothing cleared the flag, so the arm
         went on holding and went on paying for a replan it no longer needed
         until the sampler happened to find a detour around empty air. */
      if (ok && kit.dead) { kit.dead = false; kit.hold = 0; }

      if (kit.dead) {
        kit.hold += TICK;
        // A beat of held position before the detour, because a controller
        // that cancels and re-accelerates inside one frame is a controller
        // nobody can see cancel.
        if (kit.hold > 0.22) {
          const via = replan(from, kit.b, obs.current, kit.r + 0.02,
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

  });

  /* The plant, in its own frame callback so it runs whether or not the
     planner did anything this tick -- an arm holding a cancelled plan is
     still an arm holding itself up against gravity, and that is exactly the
     interval this cell is about. */
  useFrame((_, dt) => {
    const sm = sim.current;
    if (!sm) return;
    const d = Math.min(0.1, dt);
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
    kit.touch = sm.touching("handgeom");
    kit.gap = clearance(act.current, obs.current, kit.r, kit.fk);
    kit.ready = true;
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
       way: the replan cell's cursor sheet sits 0.34 m along the cell's own
       +x, and under the old rule it came out at world x = -5.24 against a
       camera at -0.95 -- a third of a metre further off than the arm's own
       base, with the machine standing between the reader and the thing they
       are meant to reach into. */
    <group position={[x, 0.9, 0]} rotation-y={s > 0 ? Math.PI : 0}>
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
          position={[0.34, 0, 0.62]}
          rotation-x={Math.PI / 2}
          onPointerMove={(e) => {
            touched.current = true;
            e.stopPropagation();
            const p = e.object.worldToLocal(e.point.clone());
            /* p.y * 0.0 was in here, which is a multiply by zero: the
               obstacle's distance from the arm was pinned at 0.34 m and the
               cursor could only ever move it in two of the three axes it
               appears to move in. The pad is a vertical sheet through the
               workspace, so across is the arm's y and up is its z, and how
               far out it sits is the one thing the reader cannot point at --
               it rides at the depth of the sheet, which is what the sheet is
               for. Said with a constant rather than with arithmetic that
               cancels. */
            obs.current.set(OBS_DEPTH, p.x, 0.62 - p.y);
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
          <planeGeometry args={[1.5, 1.4]} />
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
      </group>
      {/* Drawn at what the simulation says, which is the whole change. Until
          the engine has loaded there is nothing to say, so UR12e falls back
          to its own baked cycle -- the same thing it does in every cell that
          is not driving it. */}
      <UR12e q={simReady ? act : undefined} />
    </group>
  );
}
