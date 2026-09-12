import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import Go2 from "./Go2.jsx";
import { Search } from "./demos/astar.js";
import { heights, COSTS, RELIEF } from "./demos/terrain.js";
import { Crawl, HOME, STAND } from "./demos/crawl.js";
import { useSim } from "../sim/useSim.js";
import { terrainScene } from "../sim/models.js";
import { register, isRunning } from "./console.js";
import { detect } from "../lib/capability.js";
import { P } from "../lib/palette.js";
import { WORK } from "../lib/plan.js";

/* The cost bay: one piece of ground, four opinions about how to cross it.
 *
 * The bench top is a displaced mesh whose vertices are the height field
 * itself, so the terrain is not a texture of terrain -- the Go2's feet stand
 * on the same samples the planner reads. Four A* runs go over it, one per
 * cost function, from the same start to the same goal, and the four paths
 * are drawn together. They disagree because the questions disagree: the
 * distance field goes straight over a ridge, low ground goes round through
 * the valley, flat ground contours across the side of it, and no-ledges
 * refuses a step the slope average would have averaged away.
 *
 * What they disagree about is climb and not distance. On an eight-connected
 * grid every monotone staircase between two cells is the same length, so
 * four planners over one grid will hand back four paths of very nearly the
 * same length whatever they were optimising -- measured over three goals,
 * within 4 cm of each other on length and 25 to 31 cm apart on climb. The
 * console reports the number that can actually differ.
 *
 * And the dog walks it, which it did not.
 *
 * The Go2 used to slide: the body was placed a fraction along the chosen
 * path every frame, the legs held the stance lab/Go2.jsx derives from the
 * URDF, and the ground it was crossing had no say in any of it. So the one
 * claim this bay makes -- that the four costs disagree about what it takes
 * to cross this ground -- was untestable, because nothing was crossing
 * anything. It is twelve joints on MuJoCo now, over a height field built
 * from the same samples the planners read and the bench top is displaced
 * by, driven by the crawl in demos/crawl.js, and where it ends up is
 * wherever its feet leave it.
 *
 * Walking all four of its own planned paths in a browser, on the ground the
 * planners read, it crosses every one of them without falling: 25 to 42
 * seconds each, worst trunk tilt anywhere on any of them 7.6 degrees.
 *
 * That tilt is higher than the joint-servo version this replaced managed on
 * these same four, which held 2.7 -- and it is the right trade rather than a
 * regression. A servo stiff enough to hold a trunk to 2.7 degrees over easy
 * ground is the same servo that cannot hold it at all over hard ground: on
 * the harder pair of ends tools/test_crawl.mjs drives, it reached 40 degrees
 * where the wrench reached 29, and fell over outright when it had to turn
 * before setting off. Seven degrees of body roll on a walking quadruped is
 * also what a walking quadruped does.
 *
 * It is worth being careful about which number this bay is actually for.
 * The climb in the readout is measured off the height field and is the
 * comparison the four cost functions exist to make. Trunk tilt is a property
 * of the controller, it moved by a factor of five when the path follower was
 * fixed and again when the actuators changed, and it is not evidence about
 * cost functions at all.
 *
 * Driven corner to corner by tools/test_crawl.mjs, which picks a harder
 * pair of ends than the cell ever does, it crosses 4 of 4 -- and does it
 * from a cold start, facing the wrong way, which is what a reader makes
 * every time they move the goal. Getting there took force control rather
 * than tuning: see demos/crawl.js for the two laws measured side by side.
 *
 * The goal is the cursor, which is what the written section says it is.
 */
/* One lattice for the mesh and the samples, which it was not.
 *
 * CELL was 0.075 and the plane was PlaneGeometry(2.30, 2.70, NX-1, NY-1),
 * whose vertices are 2.30/30 and 2.70/35 apart -- so the height a cell
 * carries was drawn 12 mm out in x and 37 mm out in y by the far edge, and
 * the paths could sink into ground the planner thought was under them. The
 * course size is derived from the cell now instead of the other way round,
 * so the two cannot disagree. */
const NX = 31, NY = 36;
const CELL = 0.075;
const COURSE_X = NX * CELL;   // 2.325
const COURSE_Y = NY * CELL;   // 2.700
const TUBE_R = 0.009;
/* What the gait is asked for, and what it holds. Both measured in
   tools/test_crawl.mjs on this bay's own terrain: at 0.30 m/s commanded it
   makes 0.244 and stays inside 3.1 degrees of trunk tilt; at 0.35 it starts
   veering, a metre sideways over twelve seconds. Turning degrades earlier --
   0.4 rad/s asked returns about two thirds, and past that it leans instead
   of turning. The path follower closes on the measured pose, so what these
   cost is time and not accuracy. */
const WALK = 0.30;              // metres per second asked of the gait
const TURN = 0.8;               // and radians per second
/* How fast the commanded speed falls off with heading error. At 1.4 rad the
   machine still carries 0.15 m/s into a 40 degree error, which at a 0.8 rad/s
   turn is a 0.4 m radius -- wider than the lookahead, so it orbits the target
   instead of reaching it. Measured, two of the four paths did exactly that,
   4 per cent along after 90 seconds and 13 m of walking. At 0.7 it stops and
   turns. */
const FALLOFF = 0.7;
const LOOK = 0.30;              // pure pursuit lookahead, metres
/* How far ahead the nearest-node search may look, in nodes. Unbounded, it
   can teleport: a path that comes back near its own start has a late node
   within a few centimetres of an early one, so the search jumps the machine
   most of the way along the route on the first tick and it sets off at the
   wrong heading. Measured unbounded, the ridge path fell 4 per cent in.
   Twelve nodes is 0.9 m of path, which is three lookaheads and far more than
   the 0.6 mm the machine covers between ticks. */
const WINDOW = 12;
const ARRIVE = 0.16;            // close enough to the last node to be there
const DRIVE_MAX = 90;           // seconds before a crossing is given up on
const SHOW = 5.5;               // seconds it stands at the end before repeating
const UP_MIN = Math.cos(55 * Math.PI / 180);   // trunk z, below which it is over
const HZ = 0.002;               // the controller's tick, which is the model's
/* The twelve actuators, in the order sim/models.js declares them and
   demos/crawl.js writes them. */
const ACT = ["FL", "FR", "RL", "RR"].flatMap(
  k => [`dog_${k}_hip`, `dog_${k}_thigh`, `dog_${k}_calf`]);

/* The physical ground runs wider than the drawn course, and it has to.
 *
 * A MuJoCo height field is finite: past its last row there is no ground at
 * all, not a drop but an absence. The course's cell centres land exactly on
 * the field's outer vertices, so a path along the rim puts the dog's centre
 * on the last sample -- and a Go2 reaches 0.193 m to its own hip, plus up to
 * 0.089 m of Raibert foot placement ahead of it at the speed this bay walks,
 * plus a 0.022 m foot. Something over 0.30 m of robot was being placed off
 * the end of the world, which is not a stumble, it is a fall with nothing
 * under it. Measured in a browser before this: 7 falls in 120 seconds and it
 * never got a quarter of the way along anything.
 *
 * Six cells of margin is 0.45 m, which covers that with room. The pad is
 * filled by clamping to the nearest real sample, so the ground continues out
 * of the course at the height the course ends at rather than dropping to
 * zero and making a cliff out of the fix. Nothing is drawn out there; it is
 * bench, not terrain. */
const HPAD = 6;
const HNX = NX + HPAD * 2, HNY = NY + HPAD * 2;

const gx = (i) => (i + 0.5) * CELL - COURSE_X / 2;
const gy = (j) => (j + 0.5) * CELL - COURSE_Y / 2;

/* Four colours that survive being laid on lit sand and crossing each other.
   Not the ink the rest of the building writes in: white on a bench that
   renders at 200 of 255 under the task light is invisible, which is what it
   was. */
const HUES = ["#5f8cff", P.teal, "#f2c14e", P.hazard];

export default function TerrainRig({ stop }) {
  const s = stop.side;
  const x = s * WORK;

  const kit = useMemo(() => {
    const h = heights(NX, NY);
    const wall = new Uint8Array(NX * NY);   // no walls here: cost is the map
    const fields = COSTS.map(c => c.build(h, NX, NY));
    return { h, wall, fields, lastGoal: -1,
             searches: fields.map(f => new Search(NX, NY, wall, f)),
             paths: COSTS.map(() => []), lastSolve: -1 };
  }, []);

  /* The bench top, displaced. A plane with NX by NY segments and its vertex
     heights read straight out of the field -- not a normal map, not a
     texture: real geometry, so it self-shadows under the cell's task light
     and the paths lie on it instead of floating over a flat board. */
  const ground = useMemo(() => {
    // NX by NY vertices, so a vertex is a cell centre and the spacing is
    // exactly CELL: the plane spans one cell less than the course in each
    // axis, which is what puts the outer vertices on the outer cell centres.
    const g = new THREE.PlaneGeometry(COURSE_X - CELL, COURSE_Y - CELL,
                                      NX - 1, NY - 1);
    const pos = g.attributes.position;
    const col = new Float32Array(pos.count * 3);
    /* Darker than they look. These are albedos and the cell's task light is
       210 candela at three metres, so the pale end was arriving at the top
       of the range and the relief was being flattened by its own lighting --
       the terrain read as a white sheet with soft dents in it. */
    const lo = new THREE.Color("#161310"), hi = new THREE.Color("#3a332b");
    const c = new THREE.Color();
    for (let k = 0; k < pos.count; k++) {
      const i = k % NX, j = NY - 1 - Math.floor(k / NX);
      const z = kit.h[j * NX + i];
      pos.setZ(k, z);
      c.copy(lo).lerp(hi, z / RELIEF);
      col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b;
    }
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    return g;
  }, [kit]);

  /* The ground under a point, sampled the way the physics builds it.
   *
   * This was bilinear, which is what the bench top's own vertices draw and
   * is the obvious thing to interpolate four samples with. MuJoCo does not
   * build a height field that way: it splits every quad into two triangles,
   * and a bilinear surface sits above the triangulated one on one diagonal
   * and below it on the other. Measured over this bay's grid, the two differ
   * by up to 11.8 mm, mean 3.7.
   *
   * Which matters because the gait places its feet at whatever this returns.
   * Where the bilinear value is low, the swing foot is commanded into the
   * hill: the leg drives it under the surface, the contact solver loads up,
   * and when it lets go it throws the robot. That is precisely what the
   * ridge path did -- fourteen seconds walking on the spot at 9 to 12 degrees
   * of trunk tilt, then 172 degrees, which is upside down.
   *
   * So take the larger of the two triangulations. Whichever diagonal MuJoCo
   * chose, its surface is one of them, so the maximum is never below the
   * real ground -- and an error that is only ever high means a foot lands a
   * fraction early, which is nothing, instead of landing inside something,
   * which is everything. Where the two agree, as on any quad without twist,
   * this is exactly the bilinear answer. */
  const height = (px, py) => {
    const u = Math.max(0, Math.min(NX - 1.001, (px + COURSE_X / 2) / CELL - 0.5));
    const v = Math.max(0, Math.min(NY - 1.001, (py + COURSE_Y / 2) / CELL - 0.5));
    const i = Math.floor(u), j = Math.floor(v), s = u - i, t = v - j;
    const a = kit.h[j * NX + i], b = kit.h[j * NX + i + 1];
    const c = kit.h[(j + 1) * NX + i], d = kit.h[(j + 1) * NX + i + 1];
    // Split (0,0)-(1,1), then split (1,0)-(0,1).
    const p = s >= t ? a + (b - a) * s + (d - b) * t
                     : a + (c - a) * t + (d - c) * s;
    const q = s + t <= 1 ? a + (b - a) * s + (c - a) * t
                         : d + (c - d) * (1 - s) + (b - d) * (1 - t);
    return p > q ? p : q;
  };

  const goal = useRef(new THREE.Vector2(0.75, 0.95));
  const held = useRef(99);
  const over = useRef(false);
  const tubes = useRef([]);
  const geos = useRef([]);
  const dog = useRef();
  /* `path` is a snapshot, and that is a fix rather than a detail. The goal
     orbits when nobody is pointing at the bench and the four searches re-run
     twice a second, which is the comparison this bay is for -- but it means
     kit.paths[k] is a different array every half second. Walking it directly
     handed the dog a new route mid-stride with its node index still pointing
     into the old one: measured in a browser, 29 falls in 120 seconds and it
     never got past 26 per cent of anything. The four drawn paths still update
     live; the one the machine is on is the one it was given when it set off,
     and it takes the next one when it arrives.
  
     The one thing that does replace it mid-stride is retarget(), and that is
     safe for the reason the naive version was not: it searches from the
     dog's own cell, so the new path starts under the machine and the node
     index starts at zero because there is nowhere else it could start. */
  const walk = useRef({ which: 0, at: 0, t: 0, fell: 0, done: 0, travel: 0,
                        path: null, px: 0, py: 0 });
  const start = useMemo(() => [2, 2], []);

  /* The physics, and the gait that drives it. One scene for the life of the
     cell: new ground rewrites the height field in place rather than
     recompiling, which is what a height field is for. */
  const [sim, simReady] = useSim(() => terrainScene({
    nx: HNX, ny: HNY, cell: CELL, relief: RELIEF, start: [gx(2), gy(2), 0]
  }), []);
  // The padded samples, allocated once and refilled whenever the ground is.
  const pad = useMemo(() => new Float32Array(HNX * HNY), []);
  /* Eight sub-ticks is one 60 Hz frame of simulated time; the cap is what a
     frame may buy back after a stall, scaled so a weak machine falls behind
     in slow motion rather than integrating a second of physics at once. */
  const subMax = useMemo(() => Math.max(4, Math.round(16 * detect().quality.work)), []);
  const gait = useMemo(() => new Crawl({
    period: 0.7, duty: 0.85, lift: 0.05, height: STAND
  }), []);
  /* The twelve measured joint angles, handed to Go2 so the drawing follows
     the simulation rather than the command. */
  const joints = useRef(new Float64Array(12));
  const _acc = useRef(0);
  /* Scratch for the controller, so a 500 Hz inner loop allocates nothing. */
  const _jq = useMemo(() => new Float64Array(12), []);
  const _jqd = useMemo(() => new Float64Array(12), []);
  const _at = useMemo(() => ({}), []);

  function solve() {
    const gi = Math.max(1, Math.min(NX - 2,
      Math.round((goal.current.x + COURSE_X / 2) / CELL - 0.5)));
    const gj = Math.max(1, Math.min(NY - 2,
      Math.round((goal.current.y + COURSE_Y / 2) / CELL - 0.5)));
    kit.searches.forEach((se, k) => {
      se.start(start[0], start[1], gi, gj);
      // Run to completion here rather than a few nodes a frame: four
      // searches over 1,116 cells is well inside a frame, and a bay about
      // comparing four answers wants the four to appear together.
      se.step(NX * NY * 4);
      kit.paths[k] = se.found ? se.path.map(([i, j]) => [gx(i), gy(j)]) : [];
      const mesh = tubes.current[k];
      if (!mesh) return;
      if (kit.paths[k].length < 2) { mesh.visible = false; return; }
      mesh.visible = true;
      const pts = kit.paths[k].map(([px, py]) =>
        new THREE.Vector3(px, py, height(px, py) + 0.016));
      const next = new THREE.TubeGeometry(
        new THREE.CatmullRomCurve3(pts), pts.length, TUBE_R, 7, false);
      if (geos.current[k]) geos.current[k].dispose();
      geos.current[k] = next;
      mesh.geometry = next;
    });
  }

  /* Replan the path the dog is walking, from where the dog is.
   *
   * Moving the goal used to redraw four tubes and nothing else. The machine
   * kept walking the snapshot it set off with and took the new one only when
   * it arrived, so the cursor -- the cell's one control -- had no visible
   * effect for however long the current run had left. That is the whole of
   * "this bay is not interactive", and it is fair.
   *
   * Handing over a new array mid-stride is what the snapshot exists to
   * prevent, and for a real reason: the node index pointed into the old path
   * and the dog was suddenly several nodes ahead of or behind itself, which
   * measured 29 falls in 120 seconds. Searching from the dog's own cell
   * instead of from the bay's start makes that impossible rather than
   * unlikely -- the new path begins under the machine, so the index begins
   * at zero and is correct by construction.
   *
   * Only the path being walked is re-searched here. The other three are
   * redrawn by solve() from the bay's start, because the comparison this bay
   * is for is four costs over one route and not four costs from wherever a
   * dog happens to be standing.
   */
  function retarget() {
    const sm = sim.current, w = walk.current;
    if (!sm) return;
    const a = sm.jointAdr("dog_free"), q = sm.qpos;
    const si = Math.max(1, Math.min(NX - 2,
      Math.round((q[a.q] + COURSE_X / 2) / CELL - 0.5)));
    const sj = Math.max(1, Math.min(NY - 2,
      Math.round((q[a.q + 1] + COURSE_Y / 2) / CELL - 0.5)));
    const gi = Math.max(1, Math.min(NX - 2,
      Math.round((goal.current.x + COURSE_X / 2) / CELL - 0.5)));
    const gj = Math.max(1, Math.min(NY - 2,
      Math.round((goal.current.y + COURSE_Y / 2) / CELL - 0.5)));
    if (si === gi && sj === gj) return;
    const se = kit.searches[w.which];
    se.start(si, sj, gi, gj);
    se.step(NX * NY * 4);
    if (!se.found || se.path.length < 2) return;
    w.path = se.path.map(([i, j]) => [gx(i), gy(j)]);
    w.at = 0; w.t = 0; w.done = 0;
  }

  const solved = useRef(false);

  /* The terrain, written into the model once it exists. MJCF cannot carry
     hfield samples, so this is where the ground the planners read becomes
     the ground the feet touch -- one array, no second copy to drift. */
  useEffect(() => {
    const sm = sim.current;
    if (!simReady || !sm) return;
    pushGround();
    restart();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simReady]);

  /* The course's samples into the middle of the padded field, and the rim
     clamped outward into the margin. */
  function pushGround() {
    const sm = sim.current;
    if (!sm) return;
    for (let J = 0; J < HNY; J++) {
      const j = Math.max(0, Math.min(NY - 1, J - HPAD));
      for (let I = 0; I < HNX; I++) {
        const i = Math.max(0, Math.min(NX - 1, I - HPAD));
        pad[J * HNX + I] = kit.h[j * NX + i];
      }
    }
    sm.hfield(pad, RELIEF);
  }

  /* Which cost the machine is actually walking, chosen rather than cycled.
     The four paths are all drawn all the time -- that is the comparison --
     but only one of them is being driven, and being able to say which is
     the difference between watching four lines and asking a question about
     one of them. New ground rebuilds the field from a fresh seed, because a
     cost function that only ever gets one terrain has not been tested. */
  /* Has anybody actually reached into this cell yet. The console shows the
     hint as a lit call to action until the first pointer event lands on the
     bench and as a quiet footnote after, because an instruction that is still
     shouting once it has been followed is noise. */
  const touched = useRef(false);

  useEffect(() => register(stop.id, {
    title: "Four costs, one ground",
    actions: [{ label: "New ground", on: () => reseed() }],
    choice: {
      get: () => walk.current.which,
      set: (v) => { walk.current.which = v; restart(); },
      options: COSTS.map((c, i) => ({ value: i, label: c.label }))
    },
    /* Climb, not length, and that correction is the bay.
    
       Every one of these paths is very nearly the same length, and not by
       accident: on an eight-connected grid any monotone staircase between
       two cells has identical geometric length, so length is the one
       quantity four cost functions over the same ground cannot disagree
       about. Measured on three goals, the four came out within 4 cm of each
       other on length and 25 to 31 cm apart on climb.
    
       Climb is total ascent plus descent along the path, which is what a
       legged base pays and what three of the four functions are arguing
       about. It is measured off the same height field the mesh is built
       from, so the number is the ground the machine walks and not a
       property of the planner. */
    readout: () => {
      const w = walk.current;
      return COSTS.map((c, i) => {
        const path = kit.paths[i];
        return [(i === w.which ? "> " : "") + c.label,
                path && path.length > 1
                  ? (climbOf(path, ([px, py]) => height(px, py)) * 100).toFixed(1) + " cm"
                  : "--"];
      });
    },
    /* The dog's own frame of the run, for the interaction suite. Every number
       is read out of the simulation rather than out of the command: the joint
       angles are the ones the model is holding, the tilt is the trunk's own,
       and travel is how far it went and not how far it was told to go. */
    tick: step,
    sim: () => !!sim.current,
    state: () => {
      const w = walk.current, sm = sim.current;
      const out = {
        which: w.which, fell: w.fell, done: w.done,
        travel: +w.travel.toFixed(3),
        frac: w.path && w.path.length > 1
          ? +(w.at / (w.path.length - 1)).toFixed(3) : 0,
        sim: sm ? 1 : 0
      };
      if (sm) {
        const a = sm.jointAdr("dog_free"), q = sm.qpos;
        out.z = +q[a.q + 2].toFixed(4);
        const qx = q[a.q + 4], qy = q[a.q + 5];
        out.tilt = +(Math.acos(Math.max(-1, Math.min(1, 1 - 2 * (qx * qx + qy * qy))))
                     * 57.3).toFixed(1);
        /* One knee, because a dog whose legs are a frozen stance has a knee
           that never moves and a dog that is walking has one that does. It is
           the cheapest thing to ask that separates the two. */
        out.knee = +q[a.q + 9].toFixed(3);
      }
      return out;
    },
    /* What it is doing, in words. */
    say: () => {
      const w = walk.current;
      const label = COSTS[w.which] && COSTS[w.which].label;
      if (w.fell) return `Walking the ${label} path. It has gone over ${w.fell} time`
                       + (w.fell === 1 ? "" : "s") + " on this ground and got back up.";
      if (w.done) return `Across. That was the ${label} path.`;
      return `Walking the ${label} path -- one leg up at a time, feet on the ground the `
           + `planners read. ${w.travel.toFixed(2)} m so far.`;
    },
    touched: () => touched.current,
    hint: "Hover the ground to move the goal -- the dog replans from where it is standing and goes there. The four lines are the four costs answering from the bay's start, and climb is what each one costs to walk."
  }), [stop.id, kit]);

  function reseed() {
    const h = heights(NX, NY, (Math.random() * 1e9) | 0);
    kit.h.set(h);
    kit.fields.forEach((f, k) => f.set(COSTS[k].build(kit.h, NX, NY)));
    const pos = ground.attributes.position;
    const col = ground.attributes.color.array;
    const lo = new THREE.Color("#161310"), hi = new THREE.Color("#3a332b");
    const c = new THREE.Color();
    for (let k = 0; k < pos.count; k++) {
      const i = k % NX, j = NY - 1 - Math.floor(k / NX);
      const z = kit.h[j * NX + i];
      pos.setZ(k, z);
      c.copy(lo).lerp(hi, z / RELIEF);
      col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b;
    }
    pos.needsUpdate = true;
    ground.attributes.color.needsUpdate = true;
    ground.computeVertexNormals();
    pushGround();
    solve();
    restart();
  }

  useFrame(({ clock }, dt) => {
    const d = Math.min(0.1, dt);
    if (!isRunning(stop.id)) return;
    /* Only once the cursor has left the course, not merely stopped on it.
       The same fault the drive and replan cells had: park the pointer on the
       spot you want them to walk to and the goal wanders off. */
    if (!over.current) held.current += d; else held.current = 0;
    if (!solved.current && tubes.current[3]) { solve(); solved.current = true; }

    if (held.current > 1.5) {
      // A slow tour of the far half of the bench when nobody is pointing, so
      // the four answers keep changing and the disagreement is visible.
      const a = clock.elapsedTime * 0.28;
      goal.current.set(0.72 * Math.cos(a), 0.55 + 0.55 * Math.sin(a * 0.7));
      /* On the edge, twice a second, and not on a 50% duty cycle -- which is
         what the modulo was: it ran four complete A* passes over 1,116 cells
         and rebuilt four tube geometries on half of every second's frames,
         thirty times a second, whether or not anybody was in this bay. */
      // Twice a second at the top tier and less often below it. What is
      // being cut is how often the four answers are refreshed while the
      // goal wanders on its own, not the searches themselves: an A* run
      // with fewer nodes is a different answer, and this bay is about the
      // answers.
      const tick = Math.floor(clock.elapsedTime * 2 * detect().quality.work);
      if (tick !== kit.lastSolve) { kit.lastSolve = tick; solve(); }
    }

    step(d);
  });

  /* One frame of the walk, taken out of useFrame so the suite can drive it.
   *
   * The controller runs at the physics rate and not the frame rate, and that
   * is measured rather than tidy. Driven at one tick per browser frame the
   * dog crossed 2 of the bay's own 4 planned paths and fell on the other
   * two; at 120 Hz it crossed 4 but rolled to 45 degrees doing it; at the
   * 500 Hz the model steps at, 4 of 4 with a worst trunk tilt of 25. A crawl
   * is a sequence of catches and a catch that arrives 16 ms late is a catch
   * that missed.
   *
   * The number of sub-ticks a frame may buy is capped, and scales with the
   * tier, so a slow machine walks the dog slowly instead of dropping it. */
  function step(d) {
    const w = walk.current;
    w.t += d;
    const sm = sim.current;
    if (!sm) return;
    if (!w.path || w.path.length < 2) { restart(); if (!w.path) return; }

    _acc.current = Math.min(_acc.current + d, 0.2);
    let n = 0;
    while (_acc.current >= HZ && n < subMax) { _acc.current -= HZ; sub(); n++; }
    if (n === subMax) _acc.current = 0;

    /* And the drawing, from the simulation. The trunk's pose is read out of
       qpos rather than through Sim.point, because this group is already in
       the model's own frame -- the rig is rotated once and everything inside
       it is z-up -- so the conversion three.js wants has already happened. */
    const a = sm.jointAdr("dog_free"), q = sm.qpos;
    if (dog.current) {
      dog.current.position.set(q[a.q], q[a.q + 1], q[a.q + 2]);
      dog.current.quaternion.set(q[a.q + 4], q[a.q + 5], q[a.q + 6], q[a.q + 3]);
    }
    for (let i = 0; i < 12; i++) joints.current[i] = q[a.q + 7 + i];
    /* How far it went, sampled once a frame rather than once a sub-tick. A
       trunk carrying a gait jiggles at the physics rate, and summing that at
       500 Hz measures the jiggle rather than the ground covered. */
    w.travel += Math.hypot(q[a.q] - w.px, q[a.q + 1] - w.py);
    w.px = q[a.q]; w.py = q[a.q + 1];
  }

  /* One controller tick, at the rate the model steps at. */
  function sub() {
    const sm = sim.current, w = walk.current;
    const path = w.path;
    const a = sm.jointAdr("dog_free"), q = sm.qpos;
    const qw = q[a.q + 3], qx = q[a.q + 4], qy = q[a.q + 5], qz = q[a.q + 6];
    const v = sm.qvel;
    /* Everything the controller closes on, in one object built into the same
       scratch each tick so a bay running at 500 Hz allocates nothing. */
    const at = _at;
    at.x = q[a.q]; at.y = q[a.q + 1]; at.z = q[a.q + 2];
    at.vx = v[a.d]; at.vy = v[a.d + 1]; at.vz = v[a.d + 2];
    at.wx = v[a.d + 3]; at.wy = v[a.d + 4]; at.wz = v[a.d + 5];
    at.yaw = Math.atan2(2 * (qw * qz + qx * qy), 1 - 2 * (qy * qy + qz * qz));
    at.roll = Math.atan2(2 * (qw * qx + qy * qz), 1 - 2 * (qx * qx + qy * qy));
    at.pitch = Math.asin(Math.max(-1, Math.min(1, 2 * (qw * qy - qz * qx))));
    at.ground = height(at.x, at.y);
    const up = 1 - 2 * (qx * qx + qy * qy);

    /* On its side. A dog that has gone over is not a failure of the bay --
       it is the bay's own answer about that path over that ground, and the
       readout says so -- but it has to get up, because the next thing a
       reader does is pick a different cost. */
    if (up < UP_MIN) { w.fell++; restart(); return; }

    /* Pure pursuit, the same shape as the wheeled cells', with the speed and
       the turn rate held inside what the gait measured it can hold: past
       0.30 m/s it veers, and past 0.4 rad/s it stops turning as much as it
       is asked and starts leaning instead. */
    /* Pure pursuit, by arc length from the nearest node ahead.
     *
     * Written first the usual quick way -- advance the node index while the
     * current node is inside the lookahead, aim at whatever index that lands
     * on -- and that formulation can circle. A machine whose turn rate is
     * capped gets beside a node, the index advance stops because the node is
     * no longer inside the lookahead once it is behind, and it orbits it. It
     * never falls and it never arrives: measured on two of this bay's own
     * four courses, 19 and 20 per cent of the path in 70 simulated seconds,
     * upright the whole time.
     *
     * So: take the nearest node ahead of where it has already got to, which
     * is monotone and cannot be captured by a node it has passed, then walk
     * forward along the path until a lookahead of arc length has been spent.
     * The target is then always in front of the machine by construction. */
    let c = w.at, cd = Infinity;
    for (let k = w.at; k < Math.min(path.length, w.at + WINDOW); k++) {
      const dd = Math.hypot(path[k][0] - at.x, path[k][1] - at.y);
      if (dd < cd) { cd = dd; c = k; }
    }
    w.at = c;
    let arc = 0, j = c;
    while (j < path.length - 1 && arc < LOOK) {
      arc += Math.hypot(path[j + 1][0] - path[j][0], path[j + 1][1] - path[j][1]);
      j++;
    }
    const tgt = path[j];
    let err = Math.atan2(tgt[1] - at.y, tgt[0] - at.x) - at.yaw;
    while (err > Math.PI) err -= 2 * Math.PI;
    while (err < -Math.PI) err += 2 * Math.PI;
    const last = path[path.length - 1];
    const home = Math.hypot(last[0] - at.x, last[1] - at.y) < ARRIVE;
    if (home && !w.done) { w.done = 1; w.t = 0; }
    const cmd = home || w.t > DRIVE_MAX
      ? { v: 0, w: 0 }
      : { v: WALK * Math.max(0, 1 - Math.abs(err) / FALLOFF),
          w: Math.max(-TURN, Math.min(TURN, 1.1 * err)) };

    /* The gait decides where the feet go; the controller decides what the
       legs push with to get them there and hold the trunk over them. Both
       run every tick and the torques are what reach the model. */
    gait.step(HZ, cmd, height, at);
    for (let i = 0; i < 12; i++) {
      _jq[i] = q[a.q + 7 + i];
      _jqd[i] = sm.qvel[a.d + 6 + i];
    }
    const tau = gait.control(_jq, _jqd, at, cmd);
    for (let i = 0; i < 12; i++) sm.actuate(ACT[i], tau[i]);
    sm.step(HZ);

    // Round again, once it has stood at the end long enough to be seen.
    if ((w.done || w.t > DRIVE_MAX) && w.t > SHOW) restart();
  }

  /* Stand the dog on the first cell of the path it is walking, facing the
     second, with the gait's own clock back at the start of a cycle. */
  function restart() {
    const sm = sim.current, w = walk.current;
    const path = kit.paths[w.which];
    // A copy, so a later solve cannot reach it even if solve() ever
    // starts writing in place instead of reassigning.
    w.path = path && path.length > 1 ? path.slice() : null;
    if (!sm || !w.path) return;
    const yaw = Math.atan2(path[1][1] - path[0][1], path[1][0] - path[0][0]);
    sm.place("dog_free", path[0][0], path[0][1],
             height(path[0][0], path[0][1]) + STAND, yaw);
    const a = sm.jointAdr("dog_free");
    for (let i = 0; i < 12; i++) {
      sm.qpos[a.q + 7 + i] = HOME[i % 3];
      sm.qvel[a.d + 6 + i] = 0;
      sm.actuate(ACT[i], 0);
    }
    gait.reset();
    w.at = 0; w.t = 0; w.done = 0; w.travel = 0;
    w.px = w.path[0][0]; w.py = w.path[0][1];
    _acc.current = 0;
  }

  return (
    <group position={[x, 0.9, 0]} rotation-x={-Math.PI / 2}>
      <mesh
        name={"pad-" + stop.id}
        geometry={ground}
        receiveShadow
        onPointerMove={(e) => {
          touched.current = true;
          e.stopPropagation();
          const p = e.object.worldToLocal(e.point.clone());
          goal.current.set(p.x, p.y);
          over.current = true;
          held.current = 0;
          /* Both, and they are not the same question. solve() redraws the
             four answers from the bay's start, which is the comparison.
             retarget() sends the machine at the new goal from where it
             stands, which is the thing the reader just asked for. Only when
             the goal has actually changed cell: a dragged cursor fires this
             every frame and a search per frame is four hundred a second. */
          const cell = Math.round((p.x + COURSE_X / 2) / CELL) * 1000
                     + Math.round((p.y + COURSE_Y / 2) / CELL);
          if (cell !== kit.lastGoal) { kit.lastGoal = cell; solve(); retarget(); }
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
        <meshStandardMaterial vertexColors roughness={0.94} metalness={0.04} />
      </mesh>

      {COSTS.map((c, k) => (
        <mesh key={c.id} ref={el => (tubes.current[k] = el)} frustumCulled={false}>
          <meshStandardMaterial color={HUES[k]} emissive={HUES[k]}
            emissiveIntensity={0.45} roughness={0.5} />
        </mesh>
      ))}

      <group ref={dog}>
        <group rotation-x={Math.PI / 2}>
          <Go2 phase={0} joints={joints} />
        </group>
      </group>
    </group>
  );
}

/* Total ascent plus descent along a path, in metres, sampled from the same
   height field the ground mesh is displaced by. */
function climbOf(p, at) {
  let c = 0;
  for (let i = 1; i < p.length; i++) c += Math.abs(at(p[i]) - at(p[i - 1]));
  return c;
}

