/* Solid 04 -- the corridor the beams are hitting.
 *
 * The formation at this station is six nodding sweeps, and a sweep only reads
 * as a sweep if the room it is sweeping is there. A return in black is a
 * speck; the same return a centimetre off a wall is the wall. So the returns
 * stay points -- a return is a point, and giving one a surface would be a
 * claim the scanner never made -- and what gets built here is everything the
 * beams stop on: two walls, the floor they fall to, the four alcoves they see
 * out of, and a plinth at each of the six places the scanner stood.
 *
 * The camera is inside this one rather than in front of it. That is what
 * decides most of the numbers below: the walls have to be tall enough to
 * occlude from an eye seventy centimetres off the floor, the run has to go
 * far enough past the last sweep that its end is fog rather than an edge, and
 * everything the reader flies through has to be open where the field says it
 * is open.
 */
import * as THREE from "three";
import { makeSurface, seedSurface } from "../materials/surface.js";
import { rng } from "../formations/lib.js";

/* ── the formation's corridor, written out again ────────────────────────
   world/formations/path.js exports its fill and nothing else; the half-width
   field the six sweeps are raycast against is a local of its build. So the
   construction is repeated here, same constants, same 25 mm table, same four
   openings -- because the one thing this solid has to be is the surface those
   returns are already lying on. A wall built to a rounder number is a wall
   the beams miss by the difference, and then the station is a cloud next to a
   box instead of one room. Nothing in this block may be tuned on its own. */
const GRID = 0.025, NZ = 561;          // the field's spacing and its length in Z
const SPAN = (NZ - 1) * GRID * 0.5;    // so the table reaches this far either side

/* Alternating sides, as offsets from the anchor. An opening is a gap in the
   wall backed by a pocket, and the pocket is what the beams that find the gap
   come back off, so it is as much a surface here as the wall is. */
const DOORS = [
  { dz:  2.15, side:  1, half: 0.42, depth: 1.45 },
  { dz:  0.35, side: -1, half: 0.50, depth: 1.70 },
  { dz: -1.25, side:  1, half: 0.38, depth: 1.30 },
  { dz: -2.60, side: -1, half: 0.46, depth: 1.55 }
];

/* The route, only so the plinths land where the sweeps were taken from. The
   stations are spaced by metres driven rather than by Z, so the arc length
   has to come out the same to the millimetre -- which is why the drive's
   slight rise and fall is carried here too. It is worth 5 mm of route and
   moves the last stop by half a centimetre, and half a centimetre invented by
   hand is exactly the kind of difference this file exists not to have. */
const SAMPLES = 384, RUN = 3.4, RIDE = 0.40;

const STOPS = 6;                       // entries in the Path list, which has six

/* ── what the solid adds ────────────────────────────────────────────────
   Head height and a little more. The eye is 0.70 above this floor, so
   anything shorter is a kerb you see over and occludes nothing; the nodded
   sweeps paint the wall to around a metre up, so anything shorter than that
   is also a wall the returns hang above. */
const WALL_H = 1.40;
const THICK = 0.12;        // enough that the top of a wall is a surface, not a line
const SINK = 0.03;         // walls set into the floor: coplanar faces fight
const LAP = 0.006;         // and segments overlap their neighbours, so a turn in
                           // the wall cannot open a hairline of background
const FLOOR_T = 0.30;
const REACH = 8.4;         // half the run: past the field's table, where the
                           // formation's own lookup clamps and the wall goes
                           // straight, but far enough that the end of the
                           // corridor is gone in fog before you reach it
const PLINTH_H = 0.30;     // under where the sweep plane rides, so a marker
const PLINTH_W = 0.26;     // never stands up into its own scan
const BATTER = 0.78;       // narrower at the top, so six markers do not read as
                           // six more pieces of wall

export function build(ctx) {
  const anchor = ctx.anchor;
  const pal = ctx.pal || {};
  const budget = (ctx.quality && ctx.quality.substrate) || 26000;

  /* How finely the walls follow the field. The wall is a chain of chords
     across a curve, so what this buys is sagitta: at the field's sharpest the
     face departs from it by 4 mm at the top tier, 8 mm in the middle and
     21 mm at the bottom, against returns carrying a centimetre of range noise
     of their own. Finer than that is only triangles. */
  const STEP = budget >= 40000 ? 0.10 : budget >= 16000 ? 0.15 : 0.24;

  const Z0 = anchor.z - SPAN;
  const wall = new Float32Array(NZ);
  for (let i = 0; i < NZ; i++) {
    const t = Z0 + i * GRID - anchor.z;
    wall[i] = 1.55 + 0.19 * Math.sin(t * 1.35) + 0.10 * Math.sin(t * 2.9 + 1.7)
                   + 0.05 * Math.sin(t * 6.1 + 0.4);
  }
  // Clamped rather than extended past the table, which is what the raycast
  // does, so the wall out at the ends is where a beam would have found it.
  function halfAt(z) {
    let g = (z - Z0) / GRID;
    if (g < 0) g = 0; else if (g > NZ - 1.001) g = NZ - 1.001;
    const i = g | 0;
    return wall[i] + (wall[i + 1] - wall[i]) * (g - i);
  }

  const floor = anchor.y;
  const group = new THREE.Group();

  /* ── the shell ────────────────────────────────────────────────────────
     Walls, alcove backs, jambs and the floor are all one box under a matrix,
     so the whole room is a single draw whatever the tier decides its
     resolution is. Matrices are collected first because an InstancedMesh
     wants its count before it will take any of them. */
  const AXIS = new THREE.Vector3(0, 1, 0);
  const pv = new THREE.Vector3(), pq = new THREE.Quaternion(), ps = new THREE.Vector3();
  const shell = [];
  function slab(cx, cy, cz, yaw, sx, sy, sz) {
    shell.push(new THREE.Matrix4().compose(
      pv.set(cx, cy, cz), pq.setFromAxisAngle(AXIS, yaw), ps.set(sx, sy, sz)));
  }

  /* A stretch of wall on one side, its inner face on the field plus an
     offset -- zero for the corridor itself, the door's depth for the back of
     an alcove, which undulates with the same field because that is how the
     raycast reads it. Each box is laid on the chord between two samples and
     yawed to it, so consecutive faces meet on the curve instead of stepping
     past it. */
  function runWall(side, za, zb, offset) {
    const n = Math.max(1, Math.round(Math.abs(zb - za) / STEP));
    let x0 = anchor.x + side * (halfAt(za) + offset), z0 = za;
    for (let i = 1; i <= n; i++) {
      const z1 = za + (zb - za) * (i / n);
      const x1 = anchor.x + side * (halfAt(z1) + offset);
      const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz);
      // Away from the centreline, so the face stays on the field and the
      // thickness is spent outward where nothing can see it.
      const nx = side * dz / len, nz = -side * dx / len;
      slab((x0 + x1) * 0.5 + nx * THICK * 0.5,
           floor + (WALL_H - SINK) * 0.5,
           (z0 + z1) * 0.5 + nz * THICK * 0.5,
           Math.atan2(dx, dz), THICK, WALL_H + SINK, len + LAP);
      x0 = x1; z0 = z1;
    }
  }

  const zStart = anchor.z - REACH, zEnd = anchor.z + REACH;
  for (const side of [-1, 1]) {
    // Cut at the door edges rather than near them: a segment boundary landing
    // half a step inside an opening leaves a stub across the gap. The last box
    // before an edge still overruns it by its own thickness across the slope,
    // five centimetres at the steepest of the four. Trimming it back instead
    // leaves a notch, and a notch lets a beam through a wall, where a nub only
    // stops one a few centimetres early.
    const cuts = [];
    for (const d of DOORS) if (d.side === side) cuts.push(d);
    cuts.sort((a, b) => a.dz - b.dz);
    let z = zStart;
    for (const d of cuts) {
      const a = anchor.z + d.dz - d.half, b = anchor.z + d.dz + d.half;
      runWall(side, z, a, 0);
      runWall(side, a, b, d.depth);          // the back of the alcove
      // The two jambs, each one face of the gap, carried out to the back so
      // an alcove is a box with a mouth and not two walls with a hole between.
      // A jamb is square to Z while the wall it lands on is not, so it starts
      // from the widest the corridor gets under its own thickness. Taken from
      // the edge's own value it stood eight centimetres proud of the wall at
      // the steepest door -- inside the corridor, across the mouth, which is
      // the one place at this station anybody is looking.
      for (const e of [a, b]) {
        const out = e === a ? -1 : 1;
        const inner = Math.max(halfAt(e), halfAt(e + out * THICK * 0.5),
                               halfAt(e + out * THICK));
        slab(anchor.x + side * (inner + (d.depth + THICK) * 0.5),
             floor + (WALL_H - SINK) * 0.5, e + out * THICK * 0.5, 0,
             d.depth + THICK, WALL_H + SINK, THICK);
      }
      z = b;
    }
    runWall(side, z, zEnd, 0);
  }

  /* One slab, because the ruling in the surface shader is world space and
     draws the floor's grid for free -- modelled tiles would be geometry
     saying what the shader is already saying. Wide enough to run out under
     the deepest alcove, since a beam through an opening drops onto that floor
     the same as it does in the corridor. */
  let widest = 0, deepest = 0;
  for (let i = 0; i < NZ; i++) if (wall[i] > widest) widest = wall[i];
  for (const d of DOORS) if (d.depth > deepest) deepest = d.depth;
  const wide = widest + deepest + THICK + 0.08;
  slab(anchor.x, floor - FLOOR_T * 0.5, anchor.z, 0, wide * 2, FLOOR_T, REACH * 2);

  /* Seeds, not indices, are what move the dissolve field per instance, so the
     room does not come apart in one sheet. */
  const jr = rng(0x5f3c21);
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  seedSurface(boxGeo, shell.length, () => jr());
  // A slab is not one of the six things being read. -1 is the index no focus
  // ever matches, so lighting an entry cannot also light a piece of wall.
  boxGeo.getAttribute("aIndex").array.fill(-1);

  const shellMat = makeSurface({
    base: "#b9bdc7", accent: pal["--landing-accent"], teal: pal["--landing-teal"],
    fog: pal["--landing-bg"]
  });
  /* The material's defaults are for a machine part held at arm's length. This
     is a room: the ruling wants to fall at the scale of floor panels rather
     than millwork, and the far end has to be gone by the time it is twelve
     metres off or the corridor ends in a visible edge instead of in air. */
  shellMat.userData.uniforms.uPitch.value = 3.0;
  shellMat.userData.uniforms.uGrid.value = 0.065;
  shellMat.userData.uniforms.uFogNear.value = 2.2;
  shellMat.userData.uniforms.uFogFar.value = 15.0;

  const shellMesh = new THREE.InstancedMesh(boxGeo, shellMat, shell.length);
  for (let i = 0; i < shell.length; i++) shellMesh.setMatrixAt(i, shell[i]);
  shellMesh.instanceMatrix.needsUpdate = true;
  shellMesh.computeBoundingSphere();
  group.add(shellMesh);

  /* ── the six stops ────────────────────────────────────────────────────
     Where the scanner stood, which is not evenly spaced in Z: the formation
     spaces its stations by metres driven along a route that wanders, so they
     are found the same way here -- walk the arc length, then take the
     tangent the pose was built from so a marker faces the way the drive was
     going. */
  const route = [];
  for (let i = 0; i < SAMPLES; i++) {
    const u = i / (SAMPLES - 1);
    route.push(new THREE.Vector3(
      anchor.x + 0.44 * Math.sin(u * 4.1 + 0.6) + 0.17 * Math.sin(u * 9.7 + 2.2),
      anchor.y + RIDE + 0.05 * Math.sin(u * 5.3 + 1.1) + 0.022 * Math.sin(u * 12.6),
      anchor.z + RUN - u * 2 * RUN
    ));
  }
  const cum = new Float64Array(SAMPLES);
  for (let i = 1; i < SAMPLES; i++) cum[i] = cum[i - 1] + route[i].distanceTo(route[i - 1]);
  const total = cum[SAMPLES - 1];

  const stops = [];
  const fwd = new THREE.Vector3();
  for (let k = 0; k < STOPS; k++) {
    const s = (0.09 + (k / (STOPS - 1)) * 0.82) * total;
    let i = 1;
    while (i < SAMPLES - 1 && cum[i] < s) i++;
    const f = (s - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1]);
    const o = route[i - 1].clone().lerp(route[i], f);
    fwd.copy(route[Math.min(SAMPLES - 1, i + 1)]).sub(route[Math.max(0, i - 2)]).normalize();
    stops.push({ x: o.x, z: o.z, yaw: Math.atan2(fwd.x, fwd.z) });
  }

  // Four sides and a batter: a frustum, so the markers carry a different
  // silhouette from the walls without costing more than a box. The quarter
  // turn puts a face across the route rather than a corner.
  const plinthGeo = new THREE.CylinderGeometry(
    PLINTH_W * BATTER * Math.SQRT1_2, PLINTH_W * Math.SQRT1_2,
    PLINTH_H + SINK, 4, 1, false, Math.PI * 0.25);
  seedSurface(plinthGeo, STOPS, () => jr());

  const markMat = makeSurface({
    base: "#c6cad3", accent: pal["--landing-accent"], teal: pal["--landing-teal"],
    fog: pal["--landing-bg"]
  });
  // A quarter-metre object ruled at the wall's pitch gets one line across it
  // and reads as a smudge; the fog is the shell's, because they are in it.
  markMat.userData.uniforms.uPitch.value = 9.0;
  markMat.userData.uniforms.uFogNear.value = 2.2;
  markMat.userData.uniforms.uFogFar.value = 15.0;

  const markMesh = new THREE.InstancedMesh(plinthGeo, markMat, STOPS);
  for (let k = 0; k < STOPS; k++) {
    markMesh.setMatrixAt(k, new THREE.Matrix4().compose(
      pv.set(stops[k].x, floor + (PLINTH_H - SINK) * 0.5, stops[k].z),
      pq.setFromAxisAngle(AXIS, stops[k].yaw), ps.set(1, 1, 1)));
  }
  markMesh.instanceMatrix.needsUpdate = true;
  markMesh.computeBoundingSphere();
  group.add(markMesh);

  const mats = [shellMat, markMat];

  return {
    group,
    update({ t, cut, focus, local, charge }) {
      /* The station has no focus channel of its own -- the caller only sends
         one for the stations whose entries it counts -- so the entry being
         read is taken from how far into the section the reader is. Six
         markers over the band, which is the same thing the list is doing on
         the page beside it. */
      const f = focus >= 0 ? focus
              : typeof local === "number" ? local * (STOPS - 1) : -1;
      for (let i = 0; i < mats.length; i++) {
        const u = mats[i].userData.uniforms;
        u.uTime.value = t;
        u.uCut.value = cut;
        u.uFocus.value = f;
        u.uCharge.value = charge || 0;
      }
    },
    dispose() {
      group.clear();
      boxGeo.dispose();
      plinthGeo.dispose();
      shellMat.dispose();
      markMat.dispose();
    }
  };
}
