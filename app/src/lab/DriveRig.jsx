import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import TurtleBot, { MAX_V, MAX_W } from "./TurtleBot.jsx";
import { Local } from "./demos/dwa.js";
import { useSim } from "../sim/useSim.js";
import { wheeledScene, wheelsFor } from "../sim/models.js";
import { FIELD_VERT, FIELD_FRAG } from "../shaders/field.js";
import { register, isRunning } from "./console.js";
import { detect } from "../lib/capability.js";
import { P } from "../lib/palette.js";
import { WORK } from "../lib/plan.js";

/* The local control cell, controlling locally.
 *
 * A goal on the bench, four obstacles between the machine and it, and a
 * controller that samples velocity space every tick, rolls each candidate out
 * as an arc, throws away the ones that collide and drives the cheapest of
 * what is left. Every line on the bench is a trajectory that was scored --
 * they are the controller's own rollout buffer, drawn straight out of it --
 * and the orange one is the argmin the wheels are given.
 *
 * The cursor is the goal, which is what the written version of this section
 * says it is. Hovering the bench moves the target; taking the cursor away
 * hands it back to a slow orbit so the cell is doing something for somebody
 * who is only walking past.
 */
/* Smaller than the search bay's course, and the machine is why.

   A Burger's ceiling is 0.22 m/s. A 1.5 s rollout is 0.33 m of arc, and 0.33
   m on a 2.3 m course is a smudge in front of the robot -- the fan was there
   and it was unreadable. The horizon goes to 2.6 s, which is 0.57 m, and the
   course comes in so that is half of it. Neither number is the robot's; both
   are the bench's, and the bench is the only thing here that gets to be
   sized for the shot.

   1.14 by 1.33, which is that reasoning carried the rest of the way. At 1.75
   it was still a 0.178 m robot on a course ten times its own width, and from
   where a visitor actually stands -- nav/stations.js puts the lens about four
   metres off -- the Burger came out forty pixels across a 1440 pixel frame,
   with the fan smaller than that. The whole demo is the subject of this bay
   and it was occupying two per cent of it.

   Nothing about the robot moves for this. Its size, its top speed and the
   0.09 m the controller plans it as are a Burger's and stay a Burger's; what
   changes is how much floor it is given, which is a property of the test and
   not of the machine. A smaller course is a smaller test area, and the only
   thing that becomes untrue is nothing. */
const COURSE_X = 1.14, COURSE_Y = 1.33;
const HORIZON = 2.6;
const TICK = 1 / 20;          // 20 Hz, which is the rate the written
                              // benchmarks time this controller at

/* Four obstacles, on the bench and out of the way of the goal orbit. x, y,
   radius, in the bench frame. Cylinders rather than boxes because the
   clearance term is a point-to-circle distance and a circle is the shape
   that makes that exact rather than conservative. */
const OBS0 = [
  [-0.29,  0.27, 0.11],
  [ 0.26,  0.14, 0.13],
  [-0.09, -0.27, 0.12],
  [ 0.33, -0.40, 0.10]
];
const OBS_R = 0.12;          // what a placed one is, in metres

export default function DriveRig({ stop }) {
  const s = stop.side;
  const x = s * WORK;

  /* Fewer samples at a lower tier, never a shorter horizon: the horizon is
     what the controller is, the sample count is only how finely it looks.
     Odd counts, so zero angular velocity stays exactly in the set -- a
     sampler that cannot choose to go straight is a sampler that weaves. */
  const ctrl = useMemo(() => {
    const w = detect().quality.work;
    const odd = (x) => { const n = Math.max(3, Math.round(x)); return n % 2 ? n : n + 1; };
    return new Local({ maxV: MAX_V, maxW: MAX_W, horizon: HORIZON,
                       nv: odd(7 * w), nw: odd(21 * w) });
  }, []);
  /* The physics, built once from the obstacle layout the cell starts with.
     The obstacles are mocap bodies, so moving one later is a write and not a
     recompile -- only their number is baked in, and the cell's Reset is what
     puts that back. */
  const [sim] = useSim(() => wheeledScene({
    starts: [[-0.40, -0.52, 0.6]], obstacles: OBS0
  }), []);

  const pose = useRef({ x: -0.40, y: -0.52, psi: 0.6, travel: 0, turned: 0 });
  /* Scratch for reading the simulation, so a frame allocates nothing. */
  const _p = useMemo(() => new THREE.Vector3(), []);
  const _h = useMemo(() => new THREE.Vector3(), []);
  const cmd = useRef({ v: 0, w: 0, acc: 0 });
  const goal = useRef(new THREE.Vector2(0.40, 0.49));
  /* Seconds since the cursor left the bench, and whether it is on it at all.
   *
   * These used to be one number reset by pointer movement, which made
   * "holding the cursor still" indistinguishable from "taking the cursor
   * away": park the pointer on a spot you want the base to drive to, stop
   * moving for 1.6 seconds, and the goal walked off into its orbit while you
   * were still pointing at it. Leaving the bench is an event the browser
   * reports, so use that and nothing else. */
  const held = useRef(99);
  const over = useRef(false);
  /* The obstacles belong to the reader. A local planner is only interesting
     against a world you can change under it, and one that only ever sees
     four cylinders somebody else placed is a planner being shown rather
     than being asked anything. Held in a ref and rendered from a counter,
     because the controller reads them every tick and React re-rendering the
     scene to move a cylinder would be the tail wagging the dog. */
  const obs = useRef(OBS0.map(o => o.slice()));
  const [obsN, setObsN] = useState(0);

  const fan = useRef();
  const pick = useRef();
  const flag = useRef();

  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const span = (ctrl.steps + 1);
    // Two vertices per segment, span-1 segments, per sampled trajectory.
    const n = ctrl.nv * ctrl.nw * (span - 1) * 2;
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    return g;
  }, [ctrl]);

  const chosen = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position",
      new THREE.BufferAttribute(new Float32Array((ctrl.steps + 1) * 3), 3));
    return g;
  }, [ctrl]);

  /* The mat, drawn by the same shader the search bay's costmap uses with
     every cell free. All that leaves is the cell rule, which is what a test
     pad has printed on it and what makes two bays read as one shop rather
     than as two demos that happen to be next to each other. */
  const mat = useMemo(() => {
    const NX = Math.round(COURSE_X / 0.1), NY = Math.round(COURSE_Y / 0.1);
    const t = new THREE.DataTexture(new Uint8Array(NX * NY), NX, NY,
                                    THREE.RedFormat, THREE.UnsignedByteType);
    t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false; t.needsUpdate = true;
    return {
      tCells:   { value: t },
      uDim:     { value: new THREE.Vector2(NX, NY) },
      uWall:    { value: new THREE.Color(P.steelDk) },
      uOpen:    { value: new THREE.Color(P.teal) },
      uClosed:  { value: new THREE.Color("#1d4f57") },
      uPath:    { value: new THREE.Color(P.hazard) },
      uEnds:    { value: new THREE.Color(P.ink) },
      uAir:     { value: new THREE.Color(P.haze) },
      uFogNear: { value: 20 },
      uFogFar:  { value: 78 },
      uFade:    { value: 1 },
      uEye:     { value: new THREE.Vector3() }
    };
  }, []);

  const cols = useMemo(() => ({
    ok: new THREE.Color(P.teal).multiplyScalar(0.85),
    no: new THREE.Color("#5a2418")
  }), []);

  /* The horizon is the control worth exposing here. It is the one number in
     a sampling local planner that changes what it is: short and it is a
     reflex that cannot see a corner coming, long and it is a planner
     committing to ground it has not reached. Everything else about the fan
     is a consequence of it, which is why this cell offers that and not a
     row of sliders. */
  useEffect(() => register(stop.id, {
    title: "Velocity-space sampling",
    actions: [
      { label: "Reset", on: () => {
          pose.current = { x: -0.40, y: -0.52, psi: 0.6, travel: 0, turned: 0 };
          cmd.current = { v: 0, w: 0, acc: 0 };
          obs.current = OBS0.map(o => o.slice());
          setObsN(n => n + 1);
        } }
    ],
    choice: {
      get: () => ctrl.horizon,
      set: (v) => { ctrl.horizon = v; },
      options: [
        { value: 1.2, label: "1.2 s" },
        { value: 2.6, label: "2.6 s" },
        { value: 4.0, label: "4.0 s" }
      ]
    },
    readout: () => [
      ["horizon", ctrl.horizon.toFixed(1) + " s"],
      ["sampled", String(ctrl.count)],
      ["admissible", String(ctrl.fanOk.slice(0, ctrl.count)
        .reduce((a, b) => a + b, 0))],
      ["obstacles", String(obs.current.length)],
      ["v", cmd.current.v.toFixed(3) + " m/s"],
      ["w", cmd.current.w.toFixed(2) + " rad/s"]
    ],
    /* The base's own state, for a probe that needs to ask where it actually
       is rather than what it was told to do -- the difference between those
       two is the whole point of the cell running on physics. */
    state: () => {
      const sm = sim.current;
      const out = { ...pose.current, v: cmd.current.v, w: cmd.current.w,
                    sim: !!sm };
      if (sm) {
        sm.point("tb0", _p);
        out.z = +_p.y.toFixed(4);
        out.ncon = sm.contacts;
        out.wl = +sm.jointAt("tb0_wl").toFixed(2);
        out.wr = +sm.jointAt("tb0_wr").toFixed(2);
        // How far the body's own up-axis has fallen away from vertical.
        sm.dir("tb0", 2, _h);
        out.tilt = +(Math.acos(Math.max(-1, Math.min(1, _h.y))) * 57.3).toFixed(1);
        out.touch = (sm.touching("floor") ? 1 : 0);
      }
      return out;
    },
    /* What it is doing, in words. */
    say: () => {
      const n = ctrl.fanOk.slice(0, ctrl.count).reduce((a, b) => a + (b ? 1 : 0), 0);
      if (!ctrl.count) return "Starting up.";
      if (!n) return "Every arc it sampled hits something. Backing off.";
      return over.current
        ? `Following your cursor. ${n} of ${ctrl.count} arcs are clear; it is driving the cheapest.`
        : `Nobody pointing, so it is circling a goal of its own. ${n} of ${ctrl.count} arcs clear.`;
    },
    hint: "Hover to move the goal. Click the pad to drop an obstacle, click one to lift it."
  }), [stop.id, ctrl]);

  useFrame(({ clock, camera: cam }, dt) => {
    const d = Math.min(0.1, dt);
    if (!isRunning(stop.id)) { mat.uEye.value.copy(cam.position); return; }
    const q = pose.current;

    /* Back to an orbit when nobody is pointing at the bench. Slow, and wide
       enough that it has to go round the obstacles rather than between them,
       because a goal that never asks anything of the controller is a goal
       that never shows it working. */
    if (!over.current) held.current += d; else held.current = 0;
    if (held.current > 1.2) {
      const a = clock.elapsedTime * 0.42;
      goal.current.set(Math.cos(a) * 0.40, Math.sin(a) * 0.49);
    }

    // The controller runs on its own clock, not the frame's: a 20 Hz plan is
    // what the written benchmark times, and a rig that replans once per
    // rendered frame would be reporting the browser's frame rate instead.
    cmd.current.acc += d;
    if (cmd.current.acc >= TICK) {
      cmd.current.acc -= TICK;
      const [v, w, pickIdx] = ctrl.plan([q.x, q.y, q.psi],
                                        [goal.current.x, goal.current.y], obs.current);
      cmd.current.v = v; cmd.current.w = w;
      paintFan(pickIdx);
    }

    /* The command goes to the wheels, and where the robot ends up is
       whatever the wheels manage.
     *
     * This used to integrate the held command straight into the pose, which
     * is the unicycle the controller is written against rather than the
     * machine it is written for. A unicycle arrives wherever the arithmetic
     * says: it cannot slip, cannot be pushed, cannot fail to turn, and drives
     * through a drum without noticing. Every one of those is something this
     * bay claims to be demonstrating.
     *
     * The conversion is exact and needs nothing from the controller -- a
     * differential drive turns (v, w) into two wheel speeds by geometry --
     * so what the plan asks for has not changed. What has changed is that
     * asking is now different from getting. */
    const { v, w } = cmd.current;
    const sm = sim.current;
    if (sm) {
      const [wl, wr] = wheelsFor(v, w);
      sm.actuate("tb0_wl", wl);
      sm.actuate("tb0_wr", wr);
      /* Obstacles the reader has moved, written through to the physics.
         A mocap body takes the write and gives nothing back, which is what a
         hand in a workspace is. */
      for (let i = 0; i < obs.current.length; i++) {
        const o = obs.current[i];
        sm.setMocap(`obs${i}`, o[0], o[1], 0.09);
      }
      sm.step(d);
      /* And read the pose back out. These are the lines that make the cell a
         simulation: the drawing follows the physics rather than the physics
         being absent.
       
         The cell's frame is the bench's -- x across, y along, z up -- and
         Sim.point answers in three's, where the bench's y is minus z. */
      sm.point("tb0", _p);
      sm.dir("tb0", 0, _h);
      const nx = _p.x, ny = -_p.z;
      /* Travel is how far it went, not how far it was told to go. That is
         the whole difference between this and the arithmetic it replaces,
         and a wheel that slips should show up in the odometer. */
      q.travel += Math.hypot(nx - q.x, ny - q.y);
      const npsi = Math.atan2(-_h.z, _h.x);
      let dpsi = npsi - q.psi;
      while (dpsi > Math.PI) dpsi -= Math.PI * 2;
      while (dpsi < -Math.PI) dpsi += Math.PI * 2;
      q.turned += dpsi;
      q.x = nx; q.y = ny; q.psi = npsi;
    } else {
      /* Until the scene has compiled -- the engine is a WASM fetch and a
         cell can be on screen before it lands -- the unicycle keeps the
         machine moving rather than leaving it parked on a dead bench. */
      q.psi += w * d; q.turned += w * d;
      q.x += Math.cos(q.psi) * v * d;
      q.y += Math.sin(q.psi) * v * d;
      q.travel += Math.abs(v) * d;
      q.x = Math.max(-COURSE_X / 2, Math.min(COURSE_X / 2, q.x));
      q.y = Math.max(-COURSE_Y / 2, Math.min(COURSE_Y / 2, q.y));
    }

    if (flag.current) flag.current.position.set(goal.current.x, goal.current.y, 0.02);
    mat.uEye.value.copy(cam.position);
  });

  function paintFan(pickIdx) {
    if (!fan.current) return;
    const span = ctrl.steps + 1;

    /* The chosen arc, drawn from the same buffer the others come from and
       not re-simulated. If it were re-simulated it could differ from the one
       that was scored, and the whole claim this bay makes is that the line
       the machine follows is the line that won. A backing out has no arc in
       the fan -- it is the refusal case, index -1 -- so the highlight is
       collapsed to nothing rather than left pointing at whatever was there
       last tick. */
    const cp = chosen.attributes.position.array;
    if (pickIdx >= 0) {
      for (let k = 0; k < span; k++) {
        cp[k * 3]     = ctrl.fan[(pickIdx * span + k) * 2];
        cp[k * 3 + 1] = ctrl.fan[(pickIdx * span + k) * 2 + 1];
        cp[k * 3 + 2] = 0.012;
      }
      chosen.setDrawRange(0, span);
    } else {
      chosen.setDrawRange(0, 0);
    }
    chosen.attributes.position.needsUpdate = true;

    const pos = geo.attributes.position.array;
    const col = geo.attributes.color.array;
    let o = 0;
    for (let i = 0; i < ctrl.count; i++) {
      const c = ctrl.fanOk[i] ? cols.ok : cols.no;
      /* Unrolled, because the obvious spelling of this loop -- for (const
         kk of [k, k + 1]) -- allocates an array and an iterator per line
         segment, and there are 147 trajectories of 12 segments at 20 Hz.
         Thirty-five thousand throwaway arrays a second to draw a fan. */
      for (let k = 0; k < span - 1; k++) {
        const a = (i * span + k) * 2, b = a + 2;
        pos[o] = ctrl.fan[a]; pos[o + 1] = ctrl.fan[a + 1]; pos[o + 2] = 0.006;
        col[o] = c.r; col[o + 1] = c.g; col[o + 2] = c.b;
        o += 3;
        pos[o] = ctrl.fan[b]; pos[o + 1] = ctrl.fan[b + 1]; pos[o + 2] = 0.006;
        col[o] = c.r; col[o + 1] = c.g; col[o + 2] = c.b;
        o += 3;
      }
    }
    geo.setDrawRange(0, o / 3);
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
  }

  return (
    <group position={[x, 0.9, 0]} rotation-x={-Math.PI / 2}>
      {/* The bench surface, and the thing the cursor talks to. A plane with
          a pointer handler is the whole interaction: where it is hit in
          local space is the goal, in metres, with no picking maths of its
          own. */}
      {/* Hover moves the goal; a click puts an obstacle down, or picks one
          up if you click one. Both on the pad itself, because a control for
          placing things in a world that is not in the world is a control
          somebody has to be told about. */}
      <mesh
        name={"pad-" + stop.id}
        position={[0, 0, 0.002]}
        onPointerMove={(e) => {
          e.stopPropagation();
          const p = e.object.worldToLocal(e.point.clone());
          goal.current.set(p.x, p.y);
          over.current = true;
          held.current = 0;
        }}
        onPointerOver={() => { over.current = true; held.current = 0; }}
        onPointerOut={() => { over.current = false; }}
        onClick={(e) => {
          e.stopPropagation();
          const p = e.object.worldToLocal(e.point.clone());
          const hit = obs.current.findIndex(
            o => Math.hypot(p.x - o[0], p.y - o[1]) < o[2] + 0.03);
          if (hit >= 0) obs.current.splice(hit, 1);
          else obs.current.push([p.x, p.y, OBS_R]);
          setObsN(n => n + 1);
        }}
      >
        <planeGeometry args={[COURSE_X, COURSE_Y]} />
        <shaderMaterial
          uniforms={mat}
          vertexShader={FIELD_VERT}
          fragmentShader={FIELD_FRAG}
          transparent
          depthWrite={false}
        />
      </mesh>

      <lineSegments ref={fan} geometry={geo} frustumCulled={false}>
        <lineBasicMaterial vertexColors transparent opacity={0.75} depthWrite={false} />
      </lineSegments>

      <line ref={pick} geometry={chosen} frustumCulled={false}>
        <lineBasicMaterial color={P.hazard} depthWrite={false} />
      </line>

      {obs.current.map((o, i) => (
        <mesh key={i + ":" + obsN} position={[o[0], o[1], 0.09]}
              castShadow receiveShadow>
          <cylinderGeometry args={[o[2], o[2], 0.18, 18]} />
          <meshStandardMaterial color={P.steel} roughness={0.8} metalness={0.15} />
        </mesh>
      ))}

      {/* The goal, standing up so it is visible past an obstacle. */}
      <group ref={flag}>
        <mesh position={[0, 0, 0.11]}>
          <cylinderGeometry args={[0.006, 0.006, 0.22, 8]} />
          <meshBasicMaterial color={P.hazard} />
        </mesh>
        <mesh position={[0, 0, 0.005]} rotation-x={Math.PI / 2}>
          <ringGeometry args={[0.05, 0.062, 24]} />
          <meshBasicMaterial color={P.hazard} side={THREE.DoubleSide} />
        </mesh>
      </group>

      <group rotation-x={Math.PI / 2}>
        <TurtleBot pose={pose} />
      </group>
    </group>
  );
}
