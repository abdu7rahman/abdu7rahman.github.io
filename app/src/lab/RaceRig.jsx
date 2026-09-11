import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import TurtleBot, { MAX_V, MAX_W } from "./TurtleBot.jsx";
import { purePursuit, stanley, MPPI, nearest, ahead } from "./demos/controllers.js";
import { Local } from "./demos/dwa.js";
import { useSim } from "../sim/useSim.js";
import { wheeledScene, wheelsFor } from "../sim/models.js";
import { FIELD_VERT, FIELD_FRAG } from "../shaders/field.js";
import { register, isRunning } from "./console.js";
import { detect } from "../lib/capability.js";
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
/* 1.45 by 1.70, in from 2.30 by 2.70, for the same reason the drive cell's
   course came in: the machines racing on it are 0.178 m Burgers and from
   where a visitor stands the four of them were a single grey knot in a
   corner of an otherwise empty table. Four robots on a 2.3 m track is four
   robots each a thirteenth of the track's width; on 1.45 they are an eighth,
   which is the difference between a cluster of shapes and a smudge.

   Nothing about the machines changes. The course is the test and the test is
   allowed to be the size that lets somebody see it; the superellipse below
   comes in with it so the corners stay the same corners. */
const COURSE_X = 1.45, COURSE_Y = 1.70;
const TICK = 1 / 20;
const LEAD = 0.26;           // metres between the machines at the start

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
  const A = 0.52, B = 0.64, n = 3.2;
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
    /* Scaled by the tier, and only the sample counts. MPPI is the expensive
       one here -- 96 sequences of 16 steps, each scoring against the plan,
       twenty times a second -- and fewer sequences is a noisier estimate of
       the same expectation, which is what a lower tier should buy. The
       horizon and the temperature are the algorithm and do not move. */
    const w = detect().quality.work;
    const odd = (x) => { const n = Math.max(3, Math.round(x)); return n % 2 ? n : n + 1; };
    const dwa = new Local({ maxV: MAX_V, maxW: MAX_W, horizon: 1.9,
                            nv: odd(5 * w), nw: odd(15 * w) });
    const mppi = new MPPI({ maxV: MAX_V, maxW: MAX_W,
                            K: Math.max(24, Math.round(96 * w)) });
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

  /* The line each machine actually took, which is the entire result and was
   * not on screen.
   *
   * Four controllers on one plan separate by centimetres in the corners and
   * by nothing at all on the straights, and four TurtleBots the size of a
   * fist crawling round a 2.3 by 2.7 m course at 0.22 m/s is a still
   * photograph to anybody who looks at it for less than a minute. What is
   * worth seeing is where they went, not where they are -- so each one draws
   * its own lap. Pure pursuit cuts inside, Stanley holds the reference, the
   * sampler bulges wide where there is room, and MPPI rounds the corner
   * early, and all four of those are visible in one frame the moment the
   * lines are there.
   *
   * One lap each, cleared as the next begins, because a trail that
   * accumulates becomes four coils of spaghetti and says less than one lap
   * does.
   */
  const TRAIL = 1400;
  const trails = useMemo(() => kit.runners.map(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(TRAIL * 3), 3));
    g.setDrawRange(0, 0);
    return { geo: g, n: 0, lastX: 1e9, lastY: 1e9 };
  }), [kit]);
  useEffect(() => () => trails.forEach(t => t.geo.dispose()), [trails]);

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
      uAir: { value: new THREE.Color(P.haze) },
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
    readout: () => {
      /* Ordered by how far round they are, which is what a race board says.
         Laps first, then position along the plan; the distance beside it is
         each machine's own odometer, so a controller that wandered pays for
         the wandering. */
      const N = kit.path.length;
      const board = kit.runners.map((r, i) => ({
        name: r.name, q: poses.current[i],
        at: (poses.current[i].lap || 0) + (poses.current[i].idx || 0) / N
      })).sort((a, b) => b.at - a.at);
      return board.map((b, k) =>
        [(k + 1) + "  " + b.name,
         "lap " + ((b.q.lap || 0) + 1) + " \u00b7 " + b.q.travel.toFixed(1) + " m"]);
    },
    hint: "Each one on its own odometer, and the line it took this lap."
  }), [stop.id, kit]);

  /* The starts, spaced along the path the same way reset() spaces them, so
     the compiled scene opens with the grid already formed. */
  const [sim] = useSim(() => {
    const p = makePath();
    const starts = [0, 1, 2, 3].map(i => {
      let acc = 0, k = 0;
      while (k < p.length - 2 && acc < i * LEAD) {
        acc += Math.hypot(p[k + 1][0] - p[k][0], p[k + 1][1] - p[k][1]); k++;
      }
      return [p[k][0], p[k][1],
              Math.atan2(p[k + 1][1] - p[k][1], p[k + 1][0] - p[k][0])];
    });
    return wheeledScene({ starts });
  }, []);
  const _p = useMemo(() => new THREE.Vector3(), []);
  const _h = useMemo(() => new THREE.Vector3(), []);

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
      q.lap = 0; q.idx = k;
      const t = trails[i];
      if (t) { t.n = 0; t.geo.setDrawRange(0, 0); t.lastX = 1e9; t.lastY = 1e9; }
    });
  }

  useFrame(({ camera }, dt) => {
    const d = Math.min(0.1, dt);
    surface.uEye.value.copy(camera.position);
    if (!isRunning(stop.id)) return;
    acc.current += d;
    const tick = acc.current >= TICK;
    if (tick) acc.current -= TICK;

    const sm = sim.current;
    /* One step for the whole world, before anybody is read back: four bodies
       in one simulation advance together or they are not in the same world. */
    if (sm) {
      poses.current.forEach((q, i) => {
        const [wl, wr] = wheelsFor(q.v, q.w);
        sm.actuate(`tb${i}_wl`, wl);
        sm.actuate(`tb${i}_wr`, wr);
      });
      sm.step(d);
    }
    const N = kit.path.length;
    poses.current.forEach((q, i) => {
      if (tick) {
        const [v, w] = kit.runners[i].step([q.x, q.y, q.psi]);
        q.v = v; q.w = w;
      }
      if (sm) {
        /* Where it actually got to. What makes this a race rather than four
           animations played side by side is that they are in one world: a
           controller that cuts a corner into the machine ahead of it now
           pays for that, and the odometer that decides the order counts the
           distance travelled rather than the distance commanded. */
        sm.point(`tb${i}`, _p);
        sm.dir(`tb${i}`, 0, _h);
        const nx = _p.x, ny = -_p.z;
        q.travel += Math.hypot(nx - q.x, ny - q.y);
        const npsi = Math.atan2(-_h.z, _h.x);
        let dp = npsi - q.psi;
        while (dp > Math.PI) dp -= Math.PI * 2;
        while (dp < -Math.PI) dp += Math.PI * 2;
        q.turned += dp;
        q.x = nx; q.y = ny; q.psi = npsi;
      } else {
        q.psi += q.w * d; q.turned += q.w * d;
        q.x += Math.cos(q.psi) * q.v * d;
        q.y += Math.sin(q.psi) * q.v * d;
        q.travel += Math.abs(q.v) * d;
      }

      /* A lap is the plan's own index wrapping, not a line crossed: the
         start is an arbitrary node on a closed loop and a finish line at it
         would be a line four machines cross at four different angles. */
      const prev = q.idx === undefined ? 0 : q.idx;
      const [idx] = nearest(kit.path, q.x, q.y);
      q.idx = idx;
      const t = trails[i];
      if (prev > N * 0.75 && idx < N * 0.25) {
        q.lap = (q.lap || 0) + 1;
        if (t) { t.n = 0; t.geo.setDrawRange(0, 0); t.lastX = 1e9; t.lastY = 1e9; }
      }

      /* One trail point every 12 mm, which is half a per cent of the
         course's short side -- fine enough that a corner is a curve and
         coarse enough that a lap fits in the buffer with room to spare. */
      if (t && Math.hypot(q.x - t.lastX, q.y - t.lastY) > 0.012 && t.n < TRAIL) {
        const a = t.geo.attributes.position;
        a.array[t.n * 3] = q.x; a.array[t.n * 3 + 1] = q.y; a.array[t.n * 3 + 2] = 0.006;
        t.n++;
        a.needsUpdate = true;
        t.geo.setDrawRange(0, t.n);
        t.lastX = q.x; t.lastY = q.y;
      }
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
        <line key={"t" + r.name} geometry={trails[i].geo} frustumCulled={false}>
          <lineBasicMaterial color={r.col} transparent opacity={0.95} />
        </line>
      ))}

      {kit.runners.map((r, i) => (
        <group key={r.name} rotation-x={Math.PI / 2}>
          <TurtleBot pose={{ current: poses.current[i] }} tint={r.col} />
        </group>
      ))}
    </group>
  );
}
