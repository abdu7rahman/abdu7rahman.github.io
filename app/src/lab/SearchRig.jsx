import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import TurtleBot, { MAX_V, MAX_W } from "./TurtleBot.jsx";
import { FIELD_VERT, FIELD_FRAG } from "../shaders/field.js";
import { Search, FREE, WALL, OPEN, CLOSED, PATH, ENDS, INFL } from "./demos/astar.js";
import { seeded, layout, inflate, ends } from "./demos/course.js";
import { useSim } from "../sim/useSim.js";
import { wheeledScene, wheelsFor, BURGER } from "../sim/models.js";
import { register, isLive } from "./console.js";
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
 * Nothing here is animation, in either half. lab/demos/astar.js is an
 * ordinary eight-connected A* with an octile heuristic and a binary heap;
 * the cells that light up are its own open and closed sets, the path is its
 * parent chain, and if the goal is walled off the run ends unreachable and
 * the bay lays a new map. And the drive is MuJoCo: the path goes to a pure
 * pursuit controller, the controller's (v, w) goes through the Burger's own
 * differential-drive geometry to two wheel speeds, and where the machine
 * ends up is wherever those wheels take it. It can clip a slab, and used to.
 *
 * That last sentence is the whole reason this was worth converting, because
 * what the physics found was not a bug in the physics. A* plans for a point;
 * the thing following the path is 0.178 m wide on a 0.10 m grid. Driven as
 * arithmetic the machine tracked the path exactly and the bay looked
 * finished. Driven as a robot, 31 of 40 seeded courses ended with the
 * TurtleBot inside a wall -- and both faults it exposed were real, had been
 * there the whole time, and are fixed in the two places they belong: the
 * planner now searches an inflated map (demos/course.js) and the lookahead
 * is the one that measures best rather than the one that sounded right.
 */

/* The bench is 2.6 by 3.0 m. The course is inset from that so the machine
   never overhangs, and the cell is 0.1 m -- a Burger is 0.178 m across the
   wheels, so a cell is about half a footprint and the one-cell inflation in
   demos/course.js is what keeps the path off a wall. */
/* The course, and it is bigger than it was.
 *
 * "Too confined" was the complaint and it was fair: this bay ran on a patch
 * the size of a chopping board, and a mobile robot with nowhere to go cannot
 * show you a controller. The bench underneath it went to 3.0 by 3.8 m --
 * lab/Bench.jsx carries why those two numbers and not larger ones -- and the
 * course takes what is left after a hand's width of margin.
 */
const COURSE_X = 2.70, COURSE_Y = 3.40;
const CELL = 0.10;
const NX = Math.round(COURSE_X / CELL);   // 27
const NY = Math.round(COURSE_Y / CELL);   // 34

/* How many nodes come off the open list per second. Fast enough that a run
   finishes while somebody is standing there, slow enough that the frontier
   is a moving edge rather than a result. */
const POPS_PER_S = 420;
const HOLD_FOUND = 1.1;    // seconds the finished path sits before the drive
const HOLD_END = 2.2;      // seconds after arrival before the next map
const DRIVE_MAX = 45;      // and the longest a drive may take before the bay
                           // gives up on it. The mean is 26 s, measured.

/* The lookahead, in metres, and it is measured rather than reasoned.
 *
 * This used to be 0.24 m, on the argument that it is a little over one and a
 * half footprints and that shorter saws at grid corners while longer cuts
 * them. The second half of that was right and the first half was worth about
 * nothing. Forty seeded courses through tools/test_search.mjs, which drives
 * the real generator and the real search through the real physics:
 *
 *   look   arrived   clipped   worst clearance   steering
 *   0.10    40/40      0/40         29 mm         8.2 rad
 *   0.12    40/40      0/40         30 mm         7.9 rad
 *   0.14    40/40      0/40         25 mm         7.7 rad
 *   0.16    40/40      0/40          9 mm         7.5 rad
 *   0.18    40/40      2/40         -0 mm         7.3 rad
 *   0.24     9/40     31/40        -64 mm            --
 *
 * Corner cutting costs clearance monotonically and sawing costs almost
 * nothing: the whole range from 0.10 to 0.18 is 0.9 rad of extra steering
 * over a 3.1 m drive, which is not a thing a reader can see. So take the
 * clearance. 0.12 m it is, and the 30 mm is what the machine actually held
 * with its own wheels on its own bench, not what the inflation promised. */
const LOOK = 0.12;

/* The physical wall pool, and why 81 blocks are the same simulation as 621.
 *
 * The map is editable, so the set of occupied cells changes while the scene
 * is running and a physics model cannot be recompiled per drag. The blocks
 * are therefore a fixed pool of mocap bodies written every frame, with the
 * unused ones parked under the floor. What the pool costs is linear in its
 * size and it is broadphase rather than contacts -- measured on this scene:
 * 0.49 ms per 60 Hz frame at zero blocks, 1.08 at 96, 5.59 at 525, 6.05 at
 * 621. A bay that spends six milliseconds a frame on walls the robot is two
 * metres away from is a bay that has given up a third of its frame to
 * nothing.
 *
 * So only the near window goes in: every cell within four of the robot's
 * own. That is exact, not an approximation. The nearest cell left out has
 * its near face 0.40 m from the machine, the machine is 0.089 m to its own
 * edge, and it travels at most 22 mm between writes even on a frame clamped
 * at 0.1 s -- fourteen times the margin. A block outside the window cannot
 * touch the robot before the next write puts it back in. */
const WIN = 4;
const POOL = (WIN * 2 + 1) * (WIN * 2 + 1);   // 81

/* Grid to bench-local metres. The model frame is Z-up inside UPRIGHT, so the
   course lives in its x and y and the y axis is the one that runs along the
   aisle. */
const gx = (i) => (i + 0.5) * CELL - COURSE_X / 2;
const gy = (j) => (j + 0.5) * CELL - COURSE_Y / 2;

export default function SearchRig({ stop }) {
  const s = stop.side;
  const x = s * WORK;

  const kit = useMemo(() => {
    const wall = new Uint8Array(NX * NY);      // what is there
    const free = new Uint8Array(NX * NY);      // and what a planner may use
    const cells = new Uint8Array(NX * NY);
    const tex = new THREE.DataTexture(cells, NX, NY, THREE.RedFormat,
                                      THREE.UnsignedByteType);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    return { wall, free, cells, tex, search: new Search(NX, NY, free),
             rand: seeded(0x5EA12C) };
  }, []);

  /* One scene for the life of the cell. Only the pool size is baked in; the
     map itself is written through mocap every frame. */
  const [sim, simReady] = useSim(() => wheeledScene({
    starts: [[0, 0, 0]], walls: POOL, cell: CELL
  }), []);

  const uniforms = useMemo(() => ({
    tCells:   { value: kit.tex },
    uDim:     { value: new THREE.Vector2(NX, NY) },
    uWall:    { value: new THREE.Color(P.steelDk) },
    uOpen:    { value: new THREE.Color(P.teal) },
    uClosed:  { value: new THREE.Color("#1d4f57") },
    uPath:    { value: new THREE.Color(P.hazard) },
    uEnds:    { value: new THREE.Color(P.ink) },
    uInfl:    { value: new THREE.Color(P.hazard) },
    uAir:     { value: new THREE.Color(P.haze) },
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
  /* Scratch for reading the simulation, so a frame allocates nothing. */
  const _p = useMemo(() => new THREE.Vector3(), []);
  const _h = useMemo(() => new THREE.Vector3(), []);

  /* The engine is a ten megabyte fetch and the bay is on screen before it
     lands, so the first seconds of a cell are driven by the fallback in
     drive(). When the scene does compile, the body is still at the origin of
     its own model while the machine is somewhere on the bench -- adopting
     the pose rather than resetting to it is the difference between the
     physics taking over and the robot jumping back to the start. */
  useEffect(() => {
    const sm = sim.current;
    if (!simReady || !sm) return;
    const q = pose.current;
    sm.place("tb0_free", q.x, q.y, BURGER.tyre, q.psi);
    pushWalls();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simReady]);

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
  /* Has anybody actually reached into this cell yet. The console shows the
     hint as a lit call to action until the first pointer event lands on the
     bench and as a quiet footnote after, because an instruction that is still
     shouting once it has been followed is noise. */
  const touched = useRef(false);

  useEffect(() => register(stop.id, {
    title: "A* over a costmap",
    actions: [
      { label: "New map", on: () => newRun() },
      { label: "Clear", on: () => {
          // Everything but the rim, so what is left is a course and not the
          // aisle.
          for (let j = 1; j < NY - 1; j++)
            for (let i = 1; i < NX - 1; i++) kit.wall[j * NX + i] = 0;
          remap(); replan();
        } },
      { label: "Step", on: () => step(12) }
    ],
    readout: () => {
      const r = run.current, se = kit.search, q = pose.current;
      return [
        ["state", r.phase === "search" ? (se.done ? "done" : "expanding")
               : r.phase === "drive" ? "driving" : "holding"],
        ["expanded", String(se.expanded)],
        ["open", String(se.heap.size)],
        ["path", se.found ? se.path.length + " cells" : "--"],
        ["driven", q.travel.toFixed(2) + " m"]
      ];
    },
    /* What the harness reads. The wheel speeds are the ones the simulation
       is turning, not the ones the controller asked for, which is the only
       way to tell from outside that the drive is physics. */
    state: () => {
      const sm = sim.current, q = pose.current, out = { phase: run.current.phase };
      out.x = +q.x.toFixed(4); out.y = +q.y.toFixed(4);
      out.travel = +q.travel.toFixed(3);
      if (sm) {
        out.wl = +sm.jointAt("tb0_wl").toFixed(2);
        out.wr = +sm.jointAt("tb0_wr").toFixed(2);
        sm.dir("tb0", 2, _h);
        out.tilt = +(Math.acos(Math.max(-1, Math.min(1, _h.y))) * 57.3).toFixed(1);
        /* How close the body came to a wall, in metres, negative inside one.
           The map is cells, so this is the distance to the nearest occupied
           cell's face less the machine's own half-width -- the same question
           the inflation collar answers for the planner, asked of where the
           robot actually is. */
        out.clear = +clearanceAt(q.x, q.y).toFixed(4);
        out.sim = 1;
      } else out.sim = 0;
      return out;
    },
    tick,
    sim: () => !!sim.current,
    /* What it is doing, in words, for somebody who has just walked up to
       a bench and does not yet know what "open 17" means. */
    say: () => {
      const r = run.current, se = kit.search;
      if (r.phase === "search")
        return se.done ? "Path found." : `Searching. ${se.expanded} cells expanded so far.`;
      if (r.phase === "hold") return "Path found. Handing it to the robot.";
      if (r.phase === "drive")
        return `Driving the path it found. ${pose.current.travel.toFixed(2)} m so far.`;
      return "Arrived. A new map in a moment.";
    },
    touched: () => touched.current,
    hint: "Drag on the grid to build walls, drag from a wall to knock them down. It re-searches on every edit, and the faint collar is the inflation the planner keeps off them."
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

  /* The near window of blocks, written through to the physics pool. See the
     POOL comment for why the window is the whole map as far as the machine
     is concerned. */
  function pushWalls() {
    const sm = sim.current;
    if (!sm) return;
    const q = pose.current;
    const ci = Math.floor((q.x + COURSE_X / 2) / CELL);
    const cj = Math.floor((q.y + COURSE_Y / 2) / CELL);
    let n = 0;
    for (let j = cj - WIN; j <= cj + WIN; j++) {
      if (j < 0 || j >= NY) continue;
      for (let i = ci - WIN; i <= ci + WIN; i++) {
        if (i < 0 || i >= NX) continue;
        if (!kit.wall[j * NX + i]) continue;
        sm.setMocap(`wall${n++}`, gx(i), gy(j), 0.05);
      }
    }
    for (let k = n; k < POOL; k++) sm.setMocap(`wall${k}`, 0, 0, -5);
  }

  /* Put the machine on a cell, standing still, and tell the physics where
     the walls round it are before anything steps. */
  function placeAt(i, j) {
    const q = pose.current;
    q.x = gx(i); q.y = gy(j); q.psi = 0; q.travel = 0; q.turned = 0;
    const sm = sim.current;
    if (sm) { sm.place("tb0_free", q.x, q.y, BURGER.tyre, 0); pushWalls(); }
  }

  // The inflated layer, from whatever the map is now.
  function remap() { inflate(kit.wall, kit.free, NX, NY); paintWalls(); }

  /* How close the machine is to a wall, in metres, negative if it is inside
   * one.
   *
   * Walls here are axis-aligned cells, so the distance to one is the
   * distance to its box, and the nearest over the map is the answer. Taken
   * off the machine's real position rather than off the path it was given,
   * because "the search cell has collisions" is a claim about the robot and
   * not about the plan, and the only way to answer it is to measure the
   * robot. Linear in the occupied cells, which on a 27 by 34 grid is
   * nothing, and asked by the probe rather than by the controller. */
  function clearanceAt(px, py) {
    let best = Math.min(COURSE_X / 2 - Math.abs(px), COURSE_Y / 2 - Math.abs(py));
    const h = CELL / 2;
    for (let j = 0; j < NY; j++) {
      for (let i = 0; i < NX; i++) {
        if (!kit.wall[j * NX + i]) continue;
        const cx = (i + 0.5) * CELL - COURSE_X / 2;
        const cy = (j + 0.5) * CELL - COURSE_Y / 2;
        const dx = Math.max(0, Math.abs(px - cx) - h);
        const dy = Math.max(0, Math.abs(py - cy) - h);
        const d = (dx === 0 && dy === 0)
          ? -Math.min(h - Math.abs(px - cx), h - Math.abs(py - cy))
          : Math.hypot(dx, dy);
        if (d < best) best = d;
      }
    }
    return best - BURGER.track / 2;
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
      cells[i] = st === OPEN ? OPEN : st === CLOSED ? CLOSED
               : kit.free[i] ? INFL : FREE;
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
    /* Nor the cell the machine is standing in. A block dropped on top of a
       robot used to be a cell in an array; it is now a box that shares space
       with one, and MuJoCo resolves that by throwing the robot out of it. */
    if (paint.current === 1) {
      const q = pose.current;
      const ci = Math.floor((q.x + COURSE_X / 2) / CELL);
      const cj = Math.floor((q.y + COURSE_Y / 2) / CELL);
      if (Math.abs((c % NX) - ci) <= 1 && Math.abs(Math.floor(c / NX) - cj) <= 1)
        return;
    }
    kit.wall[c] = paint.current;
    remap();
    replan();
  }

  /* Re-search the current start and goal over whatever the map is now. */
  function replan() {
    const r = run.current;
    kit.search.start(r.sx, r.sy, r.ex, r.ey);
    r.phase = "search"; r.t = 0; r.at = 0; r.pts = [];
    placeAt(r.sx, r.sy);
    repaint();
  }

  function newRun() {
    const { wall, free, search, rand } = kit;
    for (let tries = 0; tries < 8; tries++) {
      layout(rand, wall, NX, NY);
      inflate(wall, free, NX, NY);
      /* The two ends of the longest run through the biggest piece of free
         floor, rather than the first and last free cells. See demos/course.js
         -- corner to corner discarded four maps in five once the slabs were
         inflated, and made every course that survived look the same. */
      const e = ends(free, NX, NY);
      if (!e) continue;
      const [sx, sy, ex, ey] = e;
      search.start(sx, sy, ex, ey);
      run.current = { phase: "search", t: 0, at: 0, pts: [], sx, sy, ex, ey };
      paintWalls();
      placeAt(sx, sy);
      repaint();
      return;
    }
  }

  useFrame(({ camera }, dt) => {
    if (mat.current) mat.current.uniforms.uEye.value.copy(camera.position);
    if (!isLive(stop, camera)) return;
    tick(Math.min(0.1, dt));
  });

  /* A frame of the cell, taken out of useFrame so something else can call
     it. The interaction suite drives whole runs through here: a search and a
     drive is half a minute of cell time and the headless page renders at
     about one frame a second, so a test that waited for the renderer would
     be a test that waited eight minutes for one course. */
  function tick(d) {
    const r = run.current;
    if (r.sx === undefined) return;
    r.t += d;

    if (r.phase === "search") {
      step(Math.max(1, Math.round(POPS_PER_S * d)));
      return;
    }

    /* Pure pursuit, at the Burger's own ceilings, and only during the drive.
       Heading error drives w, and v is throttled by that error so the machine
       slows into a turn rather than understeering through it -- which is the
       whole reason a pure pursuit controller needs a speed term at all. */
    let v = 0, w = 0;
    if (r.phase === "drive") {
      const q = pose.current, pts = r.pts;
      while (r.at < pts.length - 1 &&
             Math.hypot(pts[r.at][0] - q.x, pts[r.at][1] - q.y) < LOOK) r.at++;
      const tgt = pts[Math.min(r.at, pts.length - 1)];
      let err = Math.atan2(tgt[1] - q.y, tgt[0] - q.x) - q.psi;
      while (err > Math.PI) err -= 2 * Math.PI;
      while (err < -Math.PI) err += 2 * Math.PI;
      w = Math.max(-MAX_W, Math.min(MAX_W, 3.2 * err));
      v = MAX_V * Math.max(0.12, 1 - Math.abs(err) / 1.2);
    }

    drive(v, w, d);

    if (r.phase === "hold") {
      if (r.t > HOLD_FOUND) { r.phase = "drive"; r.t = 0; }
      return;
    }

    if (r.phase === "drive") {
      const q = pose.current, pts = r.pts;
      const last = pts[pts.length - 1];
      /* 0.09 m, which is the machine's own half width: a wheel over the goal
         cell is an arrival. The timeout is the other way out, and the mean
         drive is 26 s of the 45. */
      if (Math.hypot(last[0] - q.x, last[1] - q.y) < 0.09 || r.t > DRIVE_MAX) {
        r.phase = "rest"; r.t = 0;
      }
      return;
    }

    if (r.t > HOLD_END) newRun();
  }

  /* The command to the wheels, and the pose back off them.
   *
   * These are the lines that make the cell a simulation rather than a
   * drawing of one. The conversion is exact and asks nothing of the
   * controller -- a differential drive turns (v, w) into two wheel speeds by
   * geometry -- so what the pursuit wants has not changed. What has changed
   * is that wanting is now different from getting: a machine that clips a
   * slab is stopped by it, and a wheel that slips shows up in the odometer
   * because the odometer counts where it went and not where it was sent. */
  function drive(v, w, d) {
    const q = pose.current, sm = sim.current;
    if (!sm) {
      /* Until the scene has compiled -- the engine is a WASM fetch and a cell
         can be on screen before it lands -- the unicycle keeps the machine
         moving rather than leaving it parked on a dead bench. */
      q.psi += w * d; q.turned += w * d;
      q.x += Math.cos(q.psi) * v * d;
      q.y += Math.sin(q.psi) * v * d;
      q.travel += Math.abs(v) * d;
      return;
    }
    const [wl, wr] = wheelsFor(v, w);
    sm.actuate("tb0_wl", wl);
    sm.actuate("tb0_wr", wr);
    pushWalls();
    sm.step(d);
    /* The cell's frame is the bench's -- x across, y along, z up -- and
       Sim.point answers in three's, where the bench's y is minus z. */
    sm.point("tb0", _p);
    sm.dir("tb0", 0, _h);
    const nx = _p.x, ny = -_p.z;
    q.travel += Math.hypot(nx - q.x, ny - q.y);
    const npsi = Math.atan2(-_h.z, _h.x);
    let dpsi = npsi - q.psi;
    while (dpsi > Math.PI) dpsi -= Math.PI * 2;
    while (dpsi < -Math.PI) dpsi += Math.PI * 2;
    q.turned += dpsi;
    q.x = nx; q.y = ny; q.psi = npsi;
  }

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
        name={"pad-" + stop.id}
        position={[0, 0, 0.003]}
        onPointerDown={(e) => {
          touched.current = true;
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
        /* A click on the course is a click on the course.

           R3F walks the ray and delivers a click to the first object that
           has a handler for one -- so a pad carrying only pointer-move
           handlers is transparent to clicks, and the next thing along the
           ray from the bench is the monitor standing behind it, whose click
           opens the cell full screen. Measured: clicking the middle of the
           terrain course put a scrim over the whole page. Stopping it here
           costs nothing and is what "this surface is the control" means. */
        onClick={(e) => e.stopPropagation()}
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

      {/* Named, because something outside has to be able to find it. The
          interaction suite checks that drawing on the grid changes the map,
          and it used to do that by taking the largest instance count in the
          scene -- which was this mesh right up until the building itself
          started being built out of instanced steel, and is now the catwalk.
          A test that silently starts measuring a different object is worse
          than no test: it read 432 before an edit and 432 after and called
          the editor broken. */}
      <instancedMesh ref={walls} name="search-walls"
                     args={[wallMesh, undefined, NX * NY]}
                     castShadow receiveShadow>
        <meshStandardMaterial color={P.steel} roughness={0.85} metalness={0.12} />
      </instancedMesh>

      <group rotation-x={Math.PI / 2}>
        <TurtleBot pose={pose} />
      </group>
    </group>
  );
}
