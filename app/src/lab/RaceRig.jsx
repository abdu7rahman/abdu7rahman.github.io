import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import TurtleBot, { MAX_V, MAX_W } from "./TurtleBot.jsx";
import { purePursuit, stanley, MPPI, nearest, ahead } from "./demos/controllers.js";
import { Local } from "./demos/dwa.js";
import { FIELD_VERT, FIELD_FRAG } from "../shaders/field.js";
import { register, isRunning } from "./console.js";
import { P } from "../lib/palette.js";
import { WORK } from "../lib/plan.js";

/* Four controllers, one plan, one clock.
 *
 * The same closed path, the same start, the same Burger ceilings, and four
 * machines on it that see nothing of each other. They separate because they
 * are different controllers and not because any of them was given an
 * advantage: pure pursuit cuts the corners its lookahead tells it to,
 * Stanley holds the line and steers harder to do it, the velocity-space
 * sampler goes wide where there is room because it refuses trajectories
 * rather than tracking a line, and MPPI averages over its rollouts instead
 * of picking one and commits earlier for it.
 *
 * The lap counter is what each machine's own odometer says, which is the
 * only honest way to compare them: distance travelled, not distance along
 * the reference, so a controller that wanders pays for it.
 */
const COURSE_X = 2.30, COURSE_Y = 2.70;
const TICK = 1 / 20;
const LEAD = 0.42;           // metres between the machines at the start

function seeded(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* The plan: a closed figure that has to have corners in it, because a
   controller comparison on a circle is a comparison of nothing -- every one
   of these tracks a constant-curvature arc perfectly. Sampled from a
   superellipse so the straights are straight and the corners are tight
   enough to separate a cutter from a tracker. */
function makePath() {
  const pts = [];
  const A = 0.82, B = 1.02, n = 3.2;
  for (let i = 0; i < 240; i++) {
    const t = (i / 240) * Math.PI * 2;
    const c = Math.cos(t), s = Math.sin(t);
    pts.push([A * Math.sign(c) * Math.pow(Math.abs(c), 2 / n),
              B * Math.sign(s) * Math.pow(Math.abs(s), 2 / n)]);
  }
  pts.push(pts[0].slice());
  return pts;
}

export default function RaceRig({ stop }) {
  const s = stop.side;
  const x = s * WORK;

  const kit = useMemo(() => {
    const path = makePath();
    const rand = seeded(0xC0FFEE11);
    const dwa = new Local({ maxV: MAX_V, maxW: MAX_W, horizon: 1.9, nv: 5, nw: 15 });
    const mppi = new MPPI({ maxV: MAX_V, maxW: MAX_W });
    const runners = [
      { name: "pure pursuit", col: P.hazard,
        step: (st) => purePursuit(st, path, { look: 0.34, maxV: MAX_V, maxW: MAX_W }) },
      { name: "stanley", col: P.teal,
        step: (st) => stanley(st, path, { k: 2.4, lead: 0.10, maxV: MAX_V, maxW: MAX_W }) },
      { name: "sampler", col: "#c8b46a",
        step: (st) => {
          // The sampler needs a goal, not a path: it is a local planner. The
          // goal is the point on the plan a lookahead ahead, which is the
          // fairest thing to hand it -- anything further and it is being
          // asked to do global planning it does not claim to do.
          const [i] = nearest(path, st[0], st[1]);
          // Wrapped, for the reason on ahead(): clamping pinned this goal to
          // the last node for the final stretch of every lap, which put the
          // target on top of the robot and stopped it.
          const [v, w] = dwa.plan(st, ahead(path, i, 0.58), []);
          return [v, w];
        } },
      { name: "mppi", col: "#9b8cff",
        step: (st) => mppi.step(st, path, rand) }
    ];
    return { path, runners, rand };
  }, []);

  const poses = useRef(kit.runners.map((_, i) => {
    /* Spaced along the plan from one start, evenly, and on a closed loop
       there is no front: the four are a lap apart from nobody. The heading
       is the plan's own tangent where each one stands. */
    const p = kit.path;
    let acc = 0, k = 0;
    while (k < p.length - 2 && acc < i * LEAD) {
      acc += Math.hypot(p[k + 1][0] - p[k][0], p[k + 1][1] - p[k][1]); k++;
    }
    const psi = Math.atan2(p[k + 1][1] - p[k][1], p[k + 1][0] - p[k][0]);
    return { x: p[k][0], y: p[k][1], psi, travel: 0, turned: 0, v: 0, w: 0 };
  }));
  const acc = useRef(0);
  const mat = useRef();

  const surface = useMemo(() => {
    const NX = Math.round(COURSE_X / 0.1), NY = Math.round(COURSE_Y / 0.1);
    const t = new THREE.DataTexture(new Uint8Array(NX * NY), NX, NY,
                                    THREE.RedFormat, THREE.UnsignedByteType);
    t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false; t.needsUpdate = true;
    return {
      tCells: { value: t }, uDim: { value: new THREE.Vector2(NX, NY) },
      uWall: { value: new THREE.Color(P.steelDk) },
      uOpen: { value: new THREE.Color(P.teal) },
      uClosed: { value: new THREE.Color("#1d4f57") },
      uPath: { value: new THREE.Color(P.hazard) },
      uEnds: { value: new THREE.Color(P.ink) },
      uAir: { value: new THREE.Color(P.air) },
      uFogNear: { value: 20 }, uFogFar: { value: 78 },
      uFade: { value: 1 }, uEye: { value: new THREE.Vector3() }
    };
  }, []);

  const planGeo = useMemo(() => {
    const pts = kit.path.map(([a, b]) => new THREE.Vector3(a, b, 0.004));
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    return g;
  }, [kit]);

  /* Distance travelled, per machine, which is the only comparison that
     means anything: every one of them is on the same plan with the same
     clock and the same ceilings, so the one that has gone furthest is the
     one that wasted the least. Not distance along the reference -- a
     controller that wanders would score well on that for wandering. */
  useEffect(() => register(stop.id, {
    title: "Four controllers, one plan",
    actions: [{ label: "Restart", on: () => reset() }],
    readout: () => kit.runners.map((r, i) =>
      [r.name, poses.current[i].travel.toFixed(2) + " m"]),
    hint: "Distance each has actually driven, not distance along the plan."
  }), [stop.id, kit]);

  function reset() {
    const p = kit.path;
    poses.current.forEach((q, i) => {
      let acc = 0, k = 0;
      while (k < p.length - 2 && acc < i * LEAD) {
        acc += Math.hypot(p[k + 1][0] - p[k][0], p[k + 1][1] - p[k][1]); k++;
      }
      q.x = p[k][0]; q.y = p[k][1];
      q.psi = Math.atan2(p[k + 1][1] - p[k][1], p[k + 1][0] - p[k][0]);
      q.travel = 0; q.turned = 0; q.v = 0; q.w = 0;
    });
  }

  useFrame(({ camera }, dt) => {
    const d = Math.min(0.1, dt);
    surface.uEye.value.copy(camera.position);
    if (!isRunning(stop.id)) return;
    acc.current += d;
    const tick = acc.current >= TICK;
    if (tick) acc.current -= TICK;

    poses.current.forEach((q, i) => {
      if (tick) {
        const [v, w] = kit.runners[i].step([q.x, q.y, q.psi]);
        q.v = v; q.w = w;
      }
      q.psi += q.w * d; q.turned += q.w * d;
      q.x += Math.cos(q.psi) * q.v * d;
      q.y += Math.sin(q.psi) * q.v * d;
      q.travel += Math.abs(q.v) * d;
    });
  });

  return (
    <group position={[x, 0.9, 0]} rotation-x={-Math.PI / 2}>
      <mesh position={[0, 0, 0.002]}>
        <planeGeometry args={[COURSE_X, COURSE_Y]} />
        <shaderMaterial ref={mat} uniforms={surface} vertexShader={FIELD_VERT}
                        fragmentShader={FIELD_FRAG} transparent depthWrite={false} />
      </mesh>

      {/* The plan itself, once, in ink: it belongs to none of them. */}
      <line geometry={planGeo} frustumCulled={false}>
        <lineBasicMaterial color={"#8d8d94"} transparent opacity={0.75} />
      </line>

      {kit.runners.map((r, i) => (
        <group key={r.name} rotation-x={Math.PI / 2}>
          <TurtleBot pose={{ current: poses.current[i] }} tint={r.col} />
        </group>
      ))}
    </group>
  );
}
