import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import Go2 from "./Go2.jsx";
import { Search } from "./demos/astar.js";
import { heights, COSTS, RELIEF } from "./demos/terrain.js";
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
 * The goal is the cursor, which is what the written section says it is.
 */
const COURSE_X = 2.30, COURSE_Y = 2.70;
const CELL = 0.075;
const NX = Math.round(COURSE_X / CELL);
const NY = Math.round(COURSE_Y / CELL);
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
             paths: COSTS.map(() => []) };
  }, []);

  /* The bench top, displaced. A plane with NX by NY segments and its vertex
     heights read straight out of the field -- not a normal map, not a
     texture: real geometry, so it self-shadows under the cell's task light
     and the paths lie on it instead of floating over a flat board. */
  const ground = useMemo(() => {
    const g = new THREE.PlaneGeometry(COURSE_X, COURSE_Y, NX - 1, NY - 1);
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
      // Run to completion here rather than a few nodes a frame: four searches
      // over 850 cells is well inside a frame, and a bay about comparing
      // four answers wants the four to appear together.
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

  useFrame(({ clock }, dt) => {
    const d = Math.min(0.1, dt);
    held.current += d;
    if (!solved.current && tubes.current[3]) { solve(); solved.current = true; }

    if (held.current > 2.0) {
      // A slow tour of the far half of the bench when nobody is pointing, so
      // the four answers keep changing and the disagreement is visible.
      const a = clock.elapsedTime * 0.28;
      goal.current.set(0.72 * Math.cos(a), 0.55 + 0.55 * Math.sin(a * 0.7));
      if (Math.floor(clock.elapsedTime * 2) % 2 === 0) solve();
    }

    const w = walk.current;
    w.t += d;
    if (w.t > SHOW) { w.t = 0; w.u = 0; w.which = (w.which + 1) % COSTS.length; }
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
