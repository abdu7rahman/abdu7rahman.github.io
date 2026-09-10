import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import Go2 from "./Go2.jsx";
import { Search } from "./demos/astar.js";
import { heights, COSTS, RELIEF } from "./demos/terrain.js";
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
const WALK = 0.34;              // metres per second along the chosen path
const SHOW = 5.5;               // seconds each cost function leads the walk

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
    return { h, wall, fields, searches: fields.map(f => new Search(NX, NY, wall, f)),
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

  const height = (px, py) => {
    const i = Math.max(0, Math.min(NX - 1, Math.round((px + COURSE_X / 2) / CELL - 0.5)));
    const j = Math.max(0, Math.min(NY - 1, Math.round((py + COURSE_Y / 2) / CELL - 0.5)));
    return kit.h[j * NX + i];
  };

  const goal = useRef(new THREE.Vector2(0.75, 0.95));
  const held = useRef(99);
  const tubes = useRef([]);
  const geos = useRef([]);
  const dog = useRef();
  const walk = useRef({ which: 0, u: 0, t: 0 });
  const start = useMemo(() => [2, 2], []);

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

  const solved = useRef(false);

  /* Which cost the machine is actually walking, chosen rather than cycled.
     The four paths are all drawn all the time -- that is the comparison --
     but only one of them is being driven, and being able to say which is
     the difference between watching four lines and asking a question about
     one of them. New ground rebuilds the field from a fresh seed, because a
     cost function that only ever gets one terrain has not been tested. */
  useEffect(() => register(stop.id, {
    title: "Four costs, one ground",
    actions: [{ label: "New ground", on: () => reseed() }],
    choice: {
      get: () => walk.current.which,
      set: (v) => { walk.current.which = v; walk.current.u = 0; walk.current.t = 0; },
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
    hint: "Hover the ground to move the goal. Climb is what each path costs to walk."
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
    walk.current.u = 0;
    solve();
  }

  useFrame(({ clock }, dt) => {
    const d = Math.min(0.1, dt);
    if (!isRunning(stop.id)) return;
    held.current += d;
    if (!solved.current && tubes.current[3]) { solve(); solved.current = true; }

    if (held.current > 2.0) {
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

    /* The walk loops on its own path rather than stepping to the next cost
       when it finishes. Which cost is being driven belongs to the reader
       now; a timer taking it back after five seconds is the cell arguing
       with somebody who just answered it. */
    const w = walk.current;
    w.t += d;
    if (w.u >= 1 && w.t > SHOW) { w.t = 0; w.u = 0; }
    const path = kit.paths[w.which];
    if (path && path.length > 1 && dog.current) {
      w.u = Math.min(1, w.u + (WALK * d) / Math.max(0.2, pathLength(path)));
      const [px, py, psi] = along(path, w.u);
      dog.current.position.set(px, py, height(px, py));
      dog.current.rotation.z = psi;
    }
  });

  return (
    <group position={[x, 0.9, 0]} rotation-x={-Math.PI / 2}>
      <mesh
        geometry={ground}
        receiveShadow
        onPointerMove={(e) => {
          e.stopPropagation();
          const p = e.object.worldToLocal(e.point.clone());
          goal.current.set(p.x, p.y);
          held.current = 0;
          solve();
        }}
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
          <Go2 phase={0} />
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

function pathLength(p) {
  let s = 0;
  for (let i = 0; i < p.length - 1; i++)
    s += Math.hypot(p[i + 1][0] - p[i][0], p[i + 1][1] - p[i][1]);
  return s;
}

/* Where a fraction along a path is, and which way it faces there. Returns
   the tangent rather than the bearing to the next node so a machine on a
   staircase of grid cells is not snapped to eight headings. */
function along(p, u) {
  const total = pathLength(p);
  let want = u * total, acc = 0;
  for (let i = 0; i < p.length - 1; i++) {
    const seg = Math.hypot(p[i + 1][0] - p[i][0], p[i + 1][1] - p[i][1]);
    if (acc + seg >= want || i === p.length - 2) {
      const t = seg > 0 ? (want - acc) / seg : 0;
      const a = Math.max(0, i - 2), b = Math.min(p.length - 1, i + 3);
      return [p[i][0] + (p[i + 1][0] - p[i][0]) * t,
              p[i][1] + (p[i + 1][1] - p[i][1]) * t,
              Math.atan2(p[b][1] - p[a][1], p[b][0] - p[a][0])];
    }
    acc += seg;
  }
  return [p[0][0], p[0][1], 0];
}
