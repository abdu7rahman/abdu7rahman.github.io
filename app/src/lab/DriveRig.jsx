import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import TurtleBot, { MAX_V, MAX_W } from "./TurtleBot.jsx";
import { Local } from "./demos/dwa.js";
import { FIELD_VERT, FIELD_FRAG } from "../shaders/field.js";
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
   course comes in to 1.75 by 2.05 so that is a third of it. Neither number
   is the robot's; both are the bench's, and the bench is the only thing here
   that gets to be sized for the shot. */
const COURSE_X = 1.75, COURSE_Y = 2.05;
const HORIZON = 2.6;
const TICK = 1 / 20;          // 20 Hz, which is the rate the written
                              // benchmarks time this controller at

/* Four obstacles, on the bench and out of the way of the goal orbit. x, y,
   radius, in the bench frame. Cylinders rather than boxes because the
   clearance term is a point-to-circle distance and a circle is the shape
   that makes that exact rather than conservative. */
const OBS = [
  [-0.44,  0.42, 0.11],
  [ 0.40,  0.22, 0.13],
  [-0.14, -0.42, 0.12],
  [ 0.50, -0.62, 0.10]
];

export default function DriveRig({ stop }) {
  const s = stop.side;
  const x = s * WORK;

  const ctrl = useMemo(
    () => new Local({ maxV: MAX_V, maxW: MAX_W, horizon: HORIZON }), []);
  const pose = useRef({ x: -0.62, y: -0.80, psi: 0.6, travel: 0, turned: 0 });
  const cmd = useRef({ v: 0, w: 0, acc: 0 });
  const goal = useRef(new THREE.Vector2(0.8, 0.9));
  const held = useRef(0);          // seconds since the cursor last set it

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
      uAir:     { value: new THREE.Color(P.air) },
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

  useFrame(({ clock, camera: cam }, dt) => {
    const d = Math.min(0.1, dt);
    const q = pose.current;
    held.current += d;

    /* Back to an orbit when nobody is pointing at the bench. Slow, and wide
       enough that it has to go round the obstacles rather than between them,
       because a goal that never asks anything of the controller is a goal
       that never shows it working. */
    if (held.current > 1.6) {
      const a = clock.elapsedTime * 0.42;
      goal.current.set(Math.cos(a) * 0.62, Math.sin(a) * 0.76);
    }

    // The controller runs on its own clock, not the frame's: a 20 Hz plan is
    // what the written benchmark times, and a rig that replans once per
    // rendered frame would be reporting the browser's frame rate instead.
    cmd.current.acc += d;
    if (cmd.current.acc >= TICK) {
      cmd.current.acc -= TICK;
      const [v, w, pickIdx] = ctrl.plan([q.x, q.y, q.psi],
                                        [goal.current.x, goal.current.y], OBS);
      cmd.current.v = v; cmd.current.w = w;
      paintFan(pickIdx);
    }

    // Integrate the held command, so what the base does between plans is the
    // arc the planner scored and not an interpolation of two of them.
    const { v, w } = cmd.current;
    q.psi += w * d; q.turned += w * d;
    q.x += Math.cos(q.psi) * v * d;
    q.y += Math.sin(q.psi) * v * d;
    q.travel += Math.abs(v) * d;

    // Off the bench is not a state the machine can reach, but a numerical
    // one it can: clamp rather than let a bad tick throw it into the aisle.
    q.x = Math.max(-COURSE_X / 2, Math.min(COURSE_X / 2, q.x));
    q.y = Math.max(-COURSE_Y / 2, Math.min(COURSE_Y / 2, q.y));

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
      for (let k = 0; k < span - 1; k++) {
        for (const kk of [k, k + 1]) {
          pos[o] = ctrl.fan[(i * span + kk) * 2];
          pos[o + 1] = ctrl.fan[(i * span + kk) * 2 + 1];
          pos[o + 2] = 0.006;
          col[o] = c.r; col[o + 1] = c.g; col[o + 2] = c.b;
          o += 3;
        }
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
      <mesh
        position={[0, 0, 0.002]}
        onPointerMove={(e) => {
          e.stopPropagation();
          const p = e.object.worldToLocal(e.point.clone());
          goal.current.set(p.x, p.y);
          held.current = 0;
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

      {OBS.map((o, i) => (
        <mesh key={i} position={[o[0], o[1], 0.09]} castShadow receiveShadow>
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
