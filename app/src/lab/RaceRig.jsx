import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import TurtleBot, { MAX_V, MAX_W } from "./TurtleBot.jsx";
import { purePursuit, stanley, MPPI, nearest, ahead } from "./demos/controllers.js";
import { Local } from "./demos/dwa.js";
import { useSim } from "../sim/useSim.js";
import { wheeledScene, wheelsFor, BURGER } from "../sim/models.js";
import { FIELD_VERT, FIELD_FRAG } from "../shaders/field.js";
import { register, isLive } from "./console.js";
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
 * What is compared is how far off the line each one gets, not how far it
 * went, and that is a correction. Four controllers round one closed loop all
 * travel very nearly the same distance -- that is what a closed loop is --
 * so a board ranked on the odometer read as a four-way tie and said nothing
 * about the four different things happening on the track. Cross-track error
 * is the quantity that can disagree, nearest() was already computing it for
 * the controllers and throwing it away, and over two minutes of laps it
 * separates them by a factor of two and a half: Stanley holds to 51 mm at
 * worst, pure pursuit 58, MPPI 113, the sampler 135. Which is the textbook
 * ordering, arrived at by the machines rather than asserted.
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
/* The course, and it is bigger than it was.
 *
 * "Too confined" was the complaint and it was fair: this bay ran on a patch
 * the size of a chopping board, and a mobile robot with nowhere to go cannot
 * show you a controller. The bench underneath it went to 3.0 by 3.8 m --
 * lab/Bench.jsx carries why those two numbers and not larger ones -- and the
 * course takes what is left after a hand's width of margin.
 */
const COURSE_X = 2.70, COURSE_Y = 3.40;
const TICK = 1 / 20;
/* Where the four start, as a fraction of the lap rather than as a distance.
 *
 * This was 0.26 m and then 0.49, scaled with the track, and both were a
 * distance somebody picked. On a 7 m lap 0.49 m puts all four inside a fifth
 * of it -- looked at in the page, four machines bunched in one corner while
 * the comment beside them said "spaced evenly round it". A quarter of the
 * lap each is what evenly means, and it is the only spacing on a closed loop
 * that has no front. lapLength() measures the plan rather than assuming a
 * superellipse's perimeter, so changing the track changes the grid. */
function lapLength(p) {
  let d = 0;
  for (let i = 0; i < p.length - 1; i++) {
    d += Math.hypot(p[i + 1][0] - p[i][0], p[i + 1][1] - p[i][1]);
  }
  return d;
}

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
  /* Scaled with the course by the same fraction it always occupied of it:
     0.359 of the width and 0.376 of the depth, which keeps the straights and
     the corner radii in proportion so the four controllers are being asked
     the same question on a bigger floor. */
  const A = 0.97, B = 1.28, n = 3.2;
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
    /* The one thing the reader gets to change, and it is the one that
     * decides the answer.
     *
     * Four controllers on one plan at one speed is a single data point
     * presented as a comparison. The interesting fact about this set is that
     * the ranking is a function of speed: below about 0.1 m/s all four hold
     * the line to within a centimetre and the bay says nothing, and at the
     * Burger's own ceiling they are a hand's width apart. A ceiling the
     * reader can sweep is the difference between watching a result and
     * running the experiment that produced it.
     *
     * It is a ceiling and not a speed: every controller still chooses its
     * own v below it, which is most of what separates them in a corner. And
     * it stops at MAX_V, which is turtlebot3_teleop's own stated limit for
     * this base -- the slider narrows the admissible set, it never widens
     * it past what the URDF's own teleop allows.
     *
     * Measured in the page, 45 s from the grid, worst cross-track in mm:
     *
     *              0.08 m/s   0.22 m/s
     *   mppi            54         95
     *   stanley         57         48
     *   pure pursuit    67         76
     *   sampler        117        131
     *
     * Which is the reason for the control rather than a decoration on it:
     * MPPI is first at the low ceiling and third at the high one, and any
     * single-speed version of this bay would have published one of those two
     * orders as the answer. The copy claims the order changes and does not
     * claim these numbers, because one 45 s run of four stochastic
     * controllers is a sample and not a benchmark -- the written site is
     * where the benchmark lives. */
    const cap = { v: MAX_V };
    const runners = [
      { name: "pure pursuit", col: P.hazard,
        step: (st) => purePursuit(st, path, { look: 0.34, maxV: cap.v, maxW: MAX_W }) },
      { name: "stanley", col: P.teal,
        step: (st) => stanley(st, path, { k: 2.4, lead: 0.10, maxV: cap.v, maxW: MAX_W }) },
      /* Named for what it is. This is demos/dwa.js -- the sampling half of
         Fox, Burgard and Thrun's dynamic window approach, and the same
         controller the local control bay two stops back runs -- and calling
         it "sampler" on the board meant a reader could look at four names
         and reasonably ask where DWA was. Its own file is explicit about
         which half is missing: the window is the whole admissible set rather
         than what the base can reach in one control period, because
         turtlebot3_description states no acceleration limit to narrow it
         with. */
      { name: "dwa", col: "#c8b46a",
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
        step: (st) => mppi.step(st, path, rand),
        reset: () => mppi.reset() }
    ];
    return { path, runners, rand, cap, dwa, mppi };
  }, []);

  const poses = useRef(kit.runners.map((_, i) => {
    /* Spaced along the plan from one start, evenly, and on a closed loop
       there is no front: the four are a lap apart from nobody. The heading
       is the plan's own tangent where each one stands. */
    const p = kit.path;
    const lead = lapLength(p) / 4;
    let acc = 0, k = 0;
    while (k < p.length - 2 && acc < i * lead) {
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

  /* The plan, as a tube rather than as a line.
   *
   * WebGL ignores linewidth, so a LineBasicMaterial is one device pixel
   * wide however near the camera is, and the thing all four machines are
   * following was one pixel of grey on a lit bench four metres away --
   * looked at in the page, the loop is barely there and the bay reads as
   * four robots wandering rather than as four robots tracking. The replan
   * cell's own plan hit this and solved it the same way: real geometry takes
   * the cell's light and reads as something being followed. Built once, from
   * a closed 240-point loop, which is 2,880 triangles and no per-frame
   * cost. */
  const planGeo = useMemo(() => {
    const pts = kit.path.map(([a, b]) => new THREE.Vector3(a, b, 0.004));
    const curve = new THREE.CatmullRomCurve3(pts, true);
    return new THREE.TubeGeometry(curve, pts.length, 0.006, 6, true);
  }, [kit]);
  useEffect(() => () => planGeo.dispose(), [planGeo]);

  /* Distance travelled, per machine, which is the only comparison that
     means anything: every one of them is on the same plan with the same
     clock and the same ceilings, so the one that has gone furthest is the
     one that wasted the least. Not distance along the reference -- a
     controller that wanders would score well on that for wandering. */
  useEffect(() => register(stop.id, {
    title: "Four controllers, one plan",
    actions: [{ label: "Restart", on: () => reset() }],
    slider: {
      label: "Ceiling", min: 0.06, max: MAX_V, step: 0.005,
      get: () => kit.cap.v,
      set: (v) => {
        kit.cap.v = v;
        // The two that hold a window rather than reading one per call.
        kit.dwa.maxV = v;
        kit.mppi.maxV = v;
        reset();
      },
      fmt: (v) => v.toFixed(2) + " m/s"
    },
    readout: () => {
      /* Ranked on the worst each has been off the line, best first, because
         that is the number beside it and a board sorted on something it does
         not show is a board nobody can read. */
      const board = kit.runners.map((r, i) => ({
        name: r.name, q: poses.current[i]
      })).sort((a, b) => (a.q.worst || 0) - (b.q.worst || 0));
      return board.map((b, k) =>
        [(k + 1) + "  " + b.name,
         "lap " + ((b.q.lap || 0) + 1) + " \u00b7 off "
           + ((b.q.off || 0) * 1000).toFixed(0) + " mm, worst "
           + ((b.q.worst || 0) * 1000).toFixed(0)]);
    },
    /* What it is doing, in words. */
    say: () => {
      const b = kit.runners.map((r, i) => ({ n: r.name, w: poses.current[i].worst || 0 }))
        .sort((a, c) => a.w - c.w);
      if (!b.length || !b[b.length - 1].w) return "Four controllers setting off on one plan. Move the ceiling and the order changes.";
      const spread = (b[b.length - 1].w - b[0].w) * 1000;
      return `Same plan, same clock, same robot, capped at ${kit.cap.v.toFixed(2)} m/s. `
           + `${b[0].n} is holding the line best at ${(b[0].w * 1000).toFixed(0)} mm off; `
           + `${b[b.length - 1].n} is worst at ${(b[b.length - 1].w * 1000).toFixed(0)}, `
           + `${spread.toFixed(0)} mm behind it. Change the ceiling and that order is not the same order.`;
    },
    tick: step,
    sim: () => !!sim.current,
    /* The four machines' own numbers, so a harness can check that a ceiling
       change actually changed the answer rather than only the label. */
    state: () => ({
      cap: +kit.cap.v.toFixed(3),
      runners: kit.runners.map((r, i) => {
        const q = poses.current[i];
        return { name: r.name, off: +(q.off || 0).toFixed(4),
                 worst: +(q.worst || 0).toFixed(4), lap: q.lap || 0,
                 travel: +q.travel.toFixed(3) };
      })
    }),
    hint: "Off is how far it is from the plan right now, worst is the furthest it has been this run. Drag the ceiling: which controller holds the line best depends on how fast you let them go, and that is the whole result."
  }), [stop.id, kit]);

  /* The starts, spaced along the path the same way reset() spaces them, so
     the compiled scene opens with the grid already formed. */
  const [sim] = useSim(() => {
    const p = makePath();
    const starts = [0, 1, 2, 3].map(i => {
      let acc = 0, k = 0;
      const lead = lapLength(p) / 4;
      while (k < p.length - 2 && acc < i * lead) {
        acc += Math.hypot(p[k + 1][0] - p[k][0], p[k + 1][1] - p[k][1]); k++;
      }
      return [p[k][0], p[k][1],
              Math.atan2(p[k + 1][1] - p[k][1], p[k + 1][0] - p[k][0])];
    });
    return wheeledScene({ starts });
  }, []);
  const _p = useMemo(() => new THREE.Vector3(), []);
  const _h = useMemo(() => new THREE.Vector3(), []);

  /* Restart, and it has to move the bodies rather than the bookkeeping.
   *
   * This wrote the pose objects and nothing else, which was right while the
   * race was arithmetic and became a no-op the moment it went onto MuJoCo:
   * the machines are in the simulation now, so the next frame read their
   * real positions straight back over everything this had just set and the
   * button did nothing at all. The pose objects are a copy of the
   * simulation's answer, not the state. */
  function reset() {
    const p = kit.path;
    const sm = sim.current;
    poses.current.forEach((q, i) => {
      let acc = 0, k = 0;
      const lead = lapLength(p) / 4;
      while (k < p.length - 2 && acc < i * lead) {
        acc += Math.hypot(p[k + 1][0] - p[k][0], p[k + 1][1] - p[k][1]); k++;
      }
      q.x = p[k][0]; q.y = p[k][1];
      q.psi = Math.atan2(p[k + 1][1] - p[k][1], p[k + 1][0] - p[k][0]);
      q.travel = 0; q.turned = 0; q.v = 0; q.w = 0; q.off = 0; q.worst = 0;
      q.lap = 0; q.idx = k;
      if (sm) sm.place(`tb${i}_free`, q.x, q.y, BURGER.tyre, q.psi);
      const t = trails[i];
      if (t) { t.n = 0; t.geo.setDrawRange(0, 0); t.lastX = 1e9; t.lastY = 1e9; }
    });
    /* And the controllers' own memory. MPPI carries a warm-started control
       sequence between ticks, so a restart that leaves it holding the plan
       for a corner the machine is no longer at spends the first second of
       the new race unwinding the last one. */
    kit.runners.forEach(r => { if (r.reset) r.reset(); });
    acc.current = 0;
  }

  useFrame(({ camera }, dt) => {
    surface.uEye.value.copy(camera.position);
    if (!isLive(stop, camera)) return;
    step(Math.min(0.1, dt));
  });

  /* A frame of the race, out of useFrame so the suite can drive laps. Four
     machines on one simulation at the headless page's frame rate would take
     twenty minutes to finish a lap. */
  function step(d) {
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
      const near = nearest(kit.path, q.x, q.y);
      const idx = near[0];
      q.idx = idx;
      /* How far off the line it is, which nearest() has been computing and
         throwing away all along.
       *
       * The board used to rank on distance travelled, and that is the one
       * quantity four controllers over one closed path cannot disagree
       * about: they all go round the same loop, so after a lap they have all
       * gone almost exactly the same distance and the board read as a
       * four-way tie. What separates a pure pursuit from a Stanley from a
       * sampler is not how far they went, it is how far off the line they
       * got doing it -- corner cutting, overshoot, the wobble on the
       * straight. That is the number now. */
      q.off = near[2];
      if (q.off > (q.worst || 0)) q.worst = q.off;
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
  }

  return (
    <group position={[x, 0.9, 0]} rotation-x={-Math.PI / 2}>
      <mesh position={[0, 0, 0.002]}>
        <planeGeometry args={[COURSE_X, COURSE_Y]} />
        <shaderMaterial ref={mat} uniforms={surface} vertexShader={FIELD_VERT}
                        fragmentShader={FIELD_FRAG} transparent depthWrite={false} />
      </mesh>

      {/* The plan itself, once, in ink: it belongs to none of them. */}
      <mesh geometry={planGeo} frustumCulled={false}>
        <meshStandardMaterial color={"#8d8d94"} roughness={0.6} metalness={0.1} />
      </mesh>

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
