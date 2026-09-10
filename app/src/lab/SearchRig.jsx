import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import TurtleBot, { MAX_V, MAX_W } from "./TurtleBot.jsx";
import { FIELD_VERT, FIELD_FRAG } from "../shaders/field.js";
import { Search, FREE, WALL, OPEN, CLOSED, PATH, ENDS } from "./demos/astar.js";
import { register, isRunning } from "./console.js";
import { P } from "../lib/palette.js";
import { WORK } from "../lib/plan.js";

/* The search bay, running the search.
 *
 * This cell used to be a machine doing a canned traverse next to a monitor
 * showing a plot of a search happening somewhere else. The plot was 1.18 m
 * wide in a building 66 m long, which is to say it was about ninety pixels
 * of the frame, and the thing it was a picture of is the thing the bay is
 * named after. So the search moved onto the bench: a real occupancy grid, a
 * real A* expanding a few hundred nodes a second where you can watch the
 * frontier crawl round an obstacle, and the real TurtleBot driving the path
 * that comes out of it.
 *
 * Nothing here is animation. lab/demos/astar.js is an ordinary
 * eight-connected A* with an octile heuristic and a binary heap; the cells
 * that light up are its own open and closed sets, the path is its parent
 * chain, and if the goal is walled off the run ends unreachable and the bay
 * lays a new map. The robot follows with pure pursuit at the Burger's own
 * teleop ceilings, so its wheels turn at the speed its odometry says.
 */

/* The bench is 2.6 by 3.0 m. The course is inset from that so the machine
   never overhangs, and the cell is 0.1 m -- a Burger is 0.14 m across, so a
   cell is a little under a footprint and the one-cell inflation below is the
   honest amount to keep it off a wall. */
const COURSE_X = 2.30, COURSE_Y = 2.70;
const CELL = 0.10;
const NX = Math.round(COURSE_X / CELL);   // 23
const NY = Math.round(COURSE_Y / CELL);   // 27

/* How many nodes come off the open list per second. Fast enough that a run
   finishes while somebody is standing there, slow enough that the frontier
   is a moving edge rather than a result. */
const POPS_PER_S = 420;
const HOLD_FOUND = 1.1;    // seconds the finished path sits before the drive
const HOLD_END = 2.2;      // seconds after arrival before the next map

/* Grid to bench-local metres. The model frame is Z-up inside UPRIGHT, so the
   course lives in its x and y and the y axis is the one that runs along the
   aisle. */
const gx = (i) => (i + 0.5) * CELL - COURSE_X / 2;
const gy = (j) => (j + 0.5) * CELL - COURSE_Y / 2;

/* A map, laid rather than drawn: three to five slabs at grid-aligned
   positions with a gap left through them, from a seeded generator so a
   reader who comes back to this bay does not get the same course twice and
   the sequence is still reproducible. */
function layout(rand, wall) {
  wall.fill(0);
  const bars = 3 + Math.floor(rand() * 3);
  for (let b = 0; b < bars; b++) {
    const horizontal = rand() < 0.5;
    if (horizontal) {
      const y = 3 + Math.floor(rand() * (NY - 6));
      const gap = 2 + Math.floor(rand() * (NX - 6));
      const gw = 3 + Math.floor(rand() * 2);
      for (let x = 0; x < NX; x++)
        if (x < gap || x >= gap + gw) wall[y * NX + x] = 1;
    } else {
      const x = 3 + Math.floor(rand() * (NX - 6));
      const gap = 2 + Math.floor(rand() * (NY - 6));
      const gw = 3 + Math.floor(rand() * 2);
      for (let y = 0; y < NY; y++)
        if (y < gap || y >= gap + gw) wall[y * NX + x] = 1;
    }
  }
  // The rim, so a path cannot leave the bench.
  for (let x = 0; x < NX; x++) { wall[x] = 1; wall[(NY - 1) * NX + x] = 1; }
  for (let y = 0; y < NY; y++) { wall[y * NX] = 1; wall[y * NX + NX - 1] = 1; }
}

// Mulberry32: four lines, a full 2^32 period, and reproducible from a seed.
function seeded(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export default function SearchRig({ stop }) {
  const s = stop.side;
  const x = s * WORK;

  const kit = useMemo(() => {
    const wall = new Uint8Array(NX * NY);
    const cells = new Uint8Array(NX * NY);
    const tex = new THREE.DataTexture(cells, NX, NY, THREE.RedFormat,
                                      THREE.UnsignedByteType);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    return { wall, cells, tex, search: new Search(NX, NY, wall),
             rand: seeded(0x5EA12C) };
  }, []);

  const uniforms = useMemo(() => ({
    tCells:   { value: kit.tex },
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
  }), [kit]);

  const pose = useRef({ x: 0, y: 0, psi: 0, travel: 0, turned: 0 });
  const run = useRef({ phase: "search", t: 0, seed: 1, at: 0, pts: [] });
  const walls = useRef();
  const mat = useRef();
  // 1 while painting walls, 0 while erasing, null when not dragging.
  const paint = useRef(null);

  /* Lay the first map before the first frame, so the bay is never blank.
     The frame loop guards on r.sx anyway, because R3F's loop is already
     running when React commits and a frame can land in between. */
  useEffect(() => { newRun(); /* eslint-disable-next-line */ }, []);

  /* What this cell can be told to do. A new map is the interesting one: the
     course is generated, so laying another is the difference between a demo
     and a thing you can put a question to. Step runs a single frame's worth
     of expansion while paused, which is how anybody actually reads a search
     -- watching it at four hundred nodes a second tells you the shape and
     nothing about the order. */
  useEffect(() => register(stop.id, {
    title: "A* over a costmap",
    actions: [
      { label: "New map", on: () => newRun() },
      { label: "Clear", on: () => {
          // Everything but the rim, so what is left is a course and not the
          // aisle.
          for (let j = 1; j < NY - 1; j++)
            for (let i = 1; i < NX - 1; i++) kit.wall[j * NX + i] = 0;
          paintWalls(); replan();
        } },
      { label: "Step", on: () => step(12) }
    ],
    readout: () => {
      const r = run.current, se = kit.search;
      return [
        ["state", r.phase === "search" ? (se.done ? "done" : "expanding")
               : r.phase === "drive" ? "driving" : "holding"],
        ["expanded", String(se.expanded)],
        ["open", String(se.heap.size)],
        ["path", se.found ? se.path.length + " cells" : "--"]
      ];
    },
    hint: "Drag on the grid to build walls, drag from a wall to knock them down. It re-searches on every edit."
  }), [stop.id, kit]);

  /* The obstacles as real boxes, not only as cells in the texture. They cast
     into the bay's own task light, which is what makes the course read as
     something standing on a bench rather than as a diagram printed on one.

     Written from newRun rather than from an effect, because the map changes
     inside a frame and not inside a render -- an effect would repaint the
     blocks one render late, or never, since nothing re-renders. */
  function paintWalls() {
    const inst = walls.current;
    if (!inst) return;
    const m = new THREE.Matrix4();
    let n = 0;
    for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
      if (!kit.wall[j * NX + i]) continue;
      m.makeTranslation(gx(i), gy(j), 0.0375);
      inst.setMatrixAt(n++, m);
    }
    inst.count = n;
    inst.instanceMatrix.needsUpdate = true;
    /* And the bounds, which nothing else invalidates. An InstancedMesh
       computes its bounding sphere once, lazily, and needsUpdate on the
       matrices does not clear it -- so a sphere cached before the first
       paint is a 78 mm ball at the course centre, and the whole run of
       walls gets frustum culled the moment the camera is near the edge of
       the bench. Which is exactly where this bay's camera stands. */
    inst.computeBoundingSphere();
  }

  /* The texture, from the search's own state array. A copy rather than a
     second piece of bookkeeping: the algorithm's open and closed sets are
     the truth and this is a view of them. */
  function repaint() {
    const { cells, search } = kit, r = run.current;
    if (r.sx === undefined) return;
    for (let i = 0; i < cells.length; i++) {
      if (kit.wall[i]) { cells[i] = WALL; continue; }
      const st = search.state[i];
      cells[i] = st === OPEN ? OPEN : st === CLOSED ? CLOSED : FREE;
    }
    cells[r.sy * NX + r.sx] = ENDS; cells[r.ey * NX + r.ex] = ENDS;
    kit.tex.needsUpdate = true;
  }

  /* One frame's worth of expansion, wherever it is called from.
  
     Step used to call search.step and repaint directly, and repaint rebuilds
     every cell from the search's own state array -- which has no PATH value
     in it, because the path is written once, on the transition to holding.
     So pressing Step during the drive wiped the orange path off the bench,
     and stepping all the way to the goal while paused left the readout
     saying done with nothing drawn. The transition belongs with the step and
     not with the frame that happened to notice it. */
  function step(budget) {
    const r = run.current, se = kit.search;
    if (r.sx === undefined || r.phase !== "search") return;
    se.step(budget);
    repaint();
    if (!se.done) return;
    if (!se.found) { newRun(); return; }
    r.pts = se.path.map(([i, j]) => [gx(i), gy(j)]);
    for (const [i, j] of se.path) kit.cells[j * NX + i] = PATH;
    kit.cells[r.sy * NX + r.sx] = ENDS; kit.cells[r.ey * NX + r.ex] = ENDS;
    kit.tex.needsUpdate = true;
    r.phase = "hold"; r.t = 0;
  }

  /* Which cell a pointer event landed on, in the grid's own indices, or null
     if it is outside or on the rim. The rim is not editable: a course whose
     edge can be opened is a course a path can leave, and the search would
     then be searching the aisle. */
  function cellAt(e) {
    const p = e.object.worldToLocal(e.point.clone());
    const i = Math.floor((p.x + COURSE_X / 2) / CELL);
    const j = Math.floor((p.y + COURSE_Y / 2) / CELL);
    if (i < 1 || j < 1 || i >= NX - 1 || j >= NY - 1) return null;
    return j * NX + i;
  }

  function edit(c) {
    const r = run.current;
    if (kit.wall[c] === paint.current) return;
    // Neither end can be built on: a start or a goal inside a wall is a
    // search that reports unreachable and tells you nothing about the map.
    if (c === r.sy * NX + r.sx || c === r.ey * NX + r.ex) return;
    kit.wall[c] = paint.current;
    paintWalls();
    replan();
  }

  /* Re-search the current start and goal over whatever the map is now. */
  function replan() {
    const r = run.current;
    kit.search.start(r.sx, r.sy, r.ex, r.ey);
    r.phase = "search"; r.t = 0; r.at = 0; r.pts = [];
    pose.current = { x: gx(r.sx), y: gy(r.sy), psi: 0, travel: 0, turned: 0 };
    repaint();
  }

  function newRun() {
    const { wall, cells, search, rand } = kit;
    for (let tries = 0; tries < 24; tries++) {
      layout(rand, wall);
      // Start and goal at opposite ends, on the first free cell found.
      let sx = -1, sy = -1, ex = -1, ey = -1;
      for (let y = 1; y < NY - 1 && sy < 0; y++)
        for (let xx = 1; xx < NX - 1; xx++)
          if (!wall[y * NX + xx]) { sx = xx; sy = y; break; }
      for (let y = NY - 2; y > 0 && ey < 0; y--)
        for (let xx = NX - 2; xx > 0; xx--)
          if (!wall[y * NX + xx]) { ex = xx; ey = y; break; }
      if (sx < 0 || ex < 0 || (sx === ex && sy === ey)) continue;
      search.start(sx, sy, ex, ey);
      cells.set(wall);
      cells[sy * NX + sx] = ENDS; cells[ey * NX + ex] = ENDS;
      kit.tex.needsUpdate = true;
      run.current = { phase: "search", t: 0, at: 0, pts: [],
                      sx, sy, ex, ey };
      pose.current = { x: gx(sx), y: gy(sy), psi: 0, travel: 0, turned: 0 };
      paintWalls();
      return;
    }
  }

  useFrame(({ camera }, dt) => {
    const d = Math.min(0.1, dt);
    if (mat.current) mat.current.uniforms.uEye.value.copy(camera.position);

    const { cells, search } = kit;
    const r = run.current;
    if (r.sx === undefined) return;
    if (!isRunning(stop.id)) return;
    r.t += d;

    if (r.phase === "search") {
      step(Math.max(1, Math.round(POPS_PER_S * d)));
      return;
    }

    if (r.phase === "hold") {
      if (r.t > HOLD_FOUND) { r.phase = "drive"; r.t = 0; }
      return;
    }

    if (r.phase === "drive") {
      /* Pure pursuit, at the Burger's own ceilings.
      
         The lookahead is 0.24 m, which is a little over one and a half
         footprints: shorter and it saws at every grid corner, longer and it
         cuts them. Heading error drives w, and v is throttled by that error
         so the machine slows into a turn rather than understeering through
         it -- which is the whole reason a pure pursuit controller needs a
         speed term at all. */
      const q = pose.current;
      const pts = r.pts;
      const LOOK = 0.24;
      while (r.at < pts.length - 1 &&
             Math.hypot(pts[r.at][0] - q.x, pts[r.at][1] - q.y) < LOOK) r.at++;
      const tgt = pts[Math.min(r.at, pts.length - 1)];
      const dx = tgt[0] - q.x, dy = tgt[1] - q.y;
      const want = Math.atan2(dy, dx);
      let err = want - q.psi;
      while (err > Math.PI) err -= 2 * Math.PI;
      while (err < -Math.PI) err += 2 * Math.PI;

      const w = Math.max(-MAX_W, Math.min(MAX_W, 3.2 * err));
      const v = MAX_V * Math.max(0.12, 1 - Math.abs(err) / 1.2);

      q.psi += w * d; q.turned += w * d;
      q.x += Math.cos(q.psi) * v * d;
      q.y += Math.sin(q.psi) * v * d;
      q.travel += v * d;

      const last = pts[pts.length - 1];
      if (Math.hypot(last[0] - q.x, last[1] - q.y) < 0.06 || r.t > 26) {
        r.phase = "rest"; r.t = 0;
      }
      return;
    }

    if (r.t > HOLD_END) newRun();
  });

  const wallMesh = useMemo(() => new THREE.BoxGeometry(CELL, CELL, 0.075), []);

  return (
    /* The whole rig sits on the bench top and shares the machine's frame:
       Z-up inside UPRIGHT, so the course is laid in x and y and the aisle
       runs along y. One rotation for the group means the grid, the walls and
       the robot cannot disagree about which way the course faces. */
    <group position={[x, 0.9, 0]} rotation-x={-Math.PI / 2}>
      {/* The map is drawn on, which is what the written Search section says
          this is: draw a map and search it. Dragging paints walls, dragging
          from a wall erases -- the mode is decided by the first cell you
          touch, which is how every tile editor has worked since anybody
          made one, and means there is no mode to be in by mistake.

          Each edit re-runs the search from scratch rather than repairing
          it. D* Lite would repair it and would be the right answer for a
          robot that has driven half the path already; for 621 cells it is
          a millisecond either way, and a full re-run is the one that cannot
          be quietly wrong. */}
      <mesh
        position={[0, 0, 0.003]}
        onPointerDown={(e) => {
          e.stopPropagation();
          const c = cellAt(e);
          if (!c) return;
          paint.current = kit.wall[c] ? 0 : 1;
          e.target.setPointerCapture(e.pointerId);
          edit(c);
        }}
        onPointerMove={(e) => {
          if (paint.current === null) return;
          e.stopPropagation();
          const c = cellAt(e);
          if (c !== null) edit(c);
        }}
        onPointerUp={(e) => { paint.current = null; }}
        onPointerOut={() => { paint.current = null; }}
      >
        <planeGeometry args={[COURSE_X, COURSE_Y]} />
        <shaderMaterial
          ref={mat}
          uniforms={uniforms}
          vertexShader={FIELD_VERT}
          fragmentShader={FIELD_FRAG}
          transparent
          depthWrite={false}
        />
      </mesh>

      <instancedMesh ref={walls} args={[wallMesh, undefined, NX * NY]}
                     castShadow receiveShadow>
        <meshStandardMaterial color={P.steel} roughness={0.85} metalness={0.12} />
      </instancedMesh>

      <group rotation-x={Math.PI / 2}>
        <TurtleBot pose={pose} />
      </group>
    </group>
  );
}
