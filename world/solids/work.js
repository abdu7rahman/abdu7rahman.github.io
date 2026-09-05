/* Station 02, solid: the room the robot has, with surfaces on it.
 *
 * world/formations/work.js builds this same room out of points -- a 56 x 44
 * costmap at 15 cm with five obstacles reaching in from alternating sides,
 * ten posts standing in the aisles those leave, and an 8-connected A* route
 * planned over a cost that rises near everything solid. This is that room
 * settled: a box where that file draws a column of points, a slab under the
 * free cells it spends one point each on, a pillar where it stands a bright
 * column, and a ribbon along the curve it draws as a strand of accent. Scroll
 * away and these erode into exactly those points, on the same noise field the
 * points are released on, so the change of state is one event seen twice.
 *
 * Which is why the map is constructed here a second time rather than imported:
 * that file exports a view and a fill and nothing else, and it is not this
 * file's to change. So the construction is repeated -- same seeds, same
 * constants, same order of draws from the stream, including the four draws
 * every rejected block still costs it -- and that it is the *same* room is a
 * checkable claim rather than a hope: cell for cell and height for height, the
 * occupied set built here is the occupied set built there, and every point
 * that file stands clear of the floor lands in the footprint of one of these
 * boxes. Change
 * a mirrored constant on one side only and the matter dissolves into a room
 * that is not the one it came out of. Change both files or neither.
 *
 * Nothing here is a measurement of anything. It is scenery that obeys the
 * rules a costmap obeys.
 */
import * as THREE from "three";
import { makeSurface, seedSurface } from "../materials/surface.js";
import { rng } from "../formations/lib.js";

/* ── mirrored from the formation ─────────────────────────────────────────
   Not free parameters. Most of them feed a single random stream in a fixed
   order, so a number moved on this side alone does not shift one block -- it
   re-rolls the whole room, and the cloud keeps the old one. */
const NX = 56, NZ = 44, CELL = 0.15;
const FREE = 0, OBSTACLE = 1, MARKER = 2;
const PROJECTS = 10, POST = 0.55, WALLS = 5, BLOCKS = 4, SCATTER = 74;
const INFLATE = 2.4, CLEAR = 3;
const RUN_LIFT = 0.075;
const SQ2 = Math.SQRT2;

/* ── this side only ──────────────────────────────────────────────────── */

/* A column stops just short of the cell it fills, so two neighbours in a wall
   meet at a seam instead of in a shared plane. Coplanar faces under a
   transparent material are a stripe of z-fighting down the length of every
   wall in the room, and the 6 mm this costs reads at this standoff as blocks
   stacked against each other, which is what they are. */
const FOOT = 0.96;

/* How far anything standing is planted into the floor. A foot resting exactly
   on the plane shows daylight under it from an eye this low, and obstacles
   with light under them are obstacles hovering over the costmap. */
const SINK = 0.02;

/* The floor slab. Its top sits a hair under the plane the free cells' points
   are written on: level with them it fights them for the same pixels, and
   much lower the lattice starts to float. Thick enough to have an edge --
   the near rim is the closest thing in this frame, and a plane seen at 25
   degrees has no edge to catch light on at all. */
const SLAB = 0.05, SLAB_GAP = 0.005;

/* A post is slimmer than its cell. Ten of these are the only things in the
   room that are about something, and they have to read as objects standing on
   the floor rather than as its tallest blocks. */
const POST_W = 0.09;

/* The executed strand, as a solid. Thinner than this and it is a wire that
   aliases into a dotted line at the far end of the map; thicker and it stops
   being a plan and becomes a kerb. */
const TUBE_R = 0.02;

export function build(ctx) {
  const anchor = ctx.anchor;
  const pal = ctx.pal || {};
  const floorY = anchor.y;
  const X0 = anchor.x - (NX - 1) * 0.5 * CELL;
  const Z0 = anchor.z - (NZ - 1) * 0.5 * CELL;
  const wx = cx => X0 + cx * CELL;
  const wz = cz => Z0 + cz * CELL;

  /* ── the room, transcribed ───────────────────────────────────────────
     Why the walls reach in from alternating sides, why a loose cell may not
     touch anything, why the inflation is added to the step rather than
     multiplied into it -- all of that is argued in the formation and is not
     worth arguing twice. The only thing that matters on this side is that the
     transcription is faithful. */
  const cell = new Uint8Array(NX * NZ);
  const r = rng(0x0CC4);

  function mark(x, z, w, h) {
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) cell[(z + j) * NX + (x + i)] = OBSTACLE;
  }

  for (let b = 0; b < WALLS; b++) {
    const reach = 8 + ((r() * 11) | 0);
    const w = (NX >> 1) + reach - 1;
    const h = 2 + ((r() * 2) | 0);
    mark((b & 1) ? NX - w : 0, 5 + Math.round(b * (NZ - 14) / (WALLS - 1)), w, h);
  }

  for (let tries = 0, made = 0; tries < 600 && made < BLOCKS; tries++) {
    const w = 3 + ((r() * 9) | 0);
    const h = 2 + ((r() * 5) | 0);
    const x = 2 + ((r() * (NX - 4 - w)) | 0);
    const z = 3 + ((r() * (NZ - 6 - h)) | 0);
    let clash = false;
    for (let j = z - 1; j <= z + h && !clash; j++)
      for (let i = x - 1; i <= x + w; i++)
        if (i >= 0 && i < NX && j >= 0 && j < NZ && cell[j * NX + i] !== FREE) { clash = true; break; }
    if (clash) continue;
    mark(x, z, w, h);
    made++;
  }

  function isolated(cx, cz) {
    if (cx < 1 || cz < 1 || cx > NX - 2 || cz > NZ - 2) return false;
    for (let j = -1; j <= 1; j++)
      for (let i = -1; i <= 1; i++)
        if (cell[(cz + j) * NX + (cx + i)] !== FREE) return false;
    return true;
  }

  function nearestOpen(cx, cz) {
    for (let ring = 0; ring < 14; ring++)
      for (let j = -ring; j <= ring; j++)
        for (let i = -ring; i <= ring; i++) {
          if (Math.max(Math.abs(i), Math.abs(j)) !== ring) continue;
          if (isolated(cx + i, cz + j)) return (cz + j) * NX + (cx + i);
        }
    return -1;
  }

  for (let tries = 0, made = 0; tries < 4000 && made < SCATTER; tries++) {
    const cx = 1 + ((r() * (NX - 2)) | 0);
    const cz = 3 + ((r() * (NZ - 6)) | 0);
    if (!isolated(cx, cz)) continue;
    cell[cz * NX + cx] = OBSTACLE;
    made++;
  }

  /* Kept in the order they were asked for rather than in the order the grid
     is scanned, because that order is the reading order of the cards going
     past and uFocus is an index into it. */
  const postAt = new Int32Array(PROJECTS).fill(-1);
  for (let p = 0; p < PROJECTS; p++) {
    const side = (p & 1) ? 1 : -1;
    const cx = Math.round(NX * (0.5 + side * (0.13 + 0.22 * r())));
    const cz = NZ - 5 - Math.round(p * (NZ - 10) / (PROJECTS - 1));
    const at = nearestOpen(cx, cz);
    if (at >= 0) { cell[at] = MARKER; postAt[p] = at; }
  }

  const cost = new Float32Array(NX * NZ);
  for (let cz = 0; cz < NZ; cz++)
    for (let cx = 0; cx < NX; cx++) {
      const id = cz * NX + cx;
      if (cell[id] !== FREE) continue;
      let near = Math.min(CLEAR, cx, cz, NX - 1 - cx, NZ - 1 - cz);
      for (let j = -CLEAR; j <= CLEAR; j++) {
        const z = cz + j;
        if (z < 0 || z >= NZ) continue;
        for (let i = -CLEAR; i <= CLEAR; i++) {
          const x = cx + i;
          if (x < 0 || x >= NX || cell[z * NX + x] === FREE) continue;
          const d = Math.hypot(i, j);
          if (d < near) near = d;
        }
      }
      cost[id] = INFLATE * (1 - near / CLEAR);
    }

  function heap() {
    const id = [], key = [];
    return {
      get size() { return id.length; },
      push(n, k) {
        let i = id.length;
        id.push(n); key.push(k);
        while (i > 0) {
          const p = (i - 1) >> 1;
          if (key[p] <= key[i]) break;
          const a = id[p], b = key[p];
          id[p] = id[i]; key[p] = key[i]; id[i] = a; key[i] = b;
          i = p;
        }
      },
      pop() {
        const top = id[0], n = id.pop(), k = key.pop();
        if (id.length) {
          id[0] = n; key[0] = k;
          for (let i = 0;;) {
            const l = i * 2 + 1, rr = l + 1;
            let m = i;
            if (l < id.length && key[l] < key[m]) m = l;
            if (rr < id.length && key[rr] < key[m]) m = rr;
            if (m === i) break;
            const a = id[m], b = key[m];
            id[m] = id[i]; key[m] = key[i]; id[i] = a; key[i] = b;
            i = m;
          }
        }
        return top;
      }
    };
  }

  function octile(a, b) {
    const dx = Math.abs((a % NX) - (b % NX));
    const dz = Math.abs(((a / NX) | 0) - ((b / NX) | 0));
    return (dx + dz) + (SQ2 - 2) * Math.min(dx, dz);
  }

  const STEP = [1, 0, -1, 0, 0, 1, 0, -1, 1, 1, 1, -1, -1, 1, -1, -1];

  function plan(from, to) {
    const g = new Float32Array(NX * NZ).fill(Infinity);
    const came = new Int32Array(NX * NZ).fill(-1);
    const closed = new Uint8Array(NX * NZ);
    const open = heap();
    g[from] = 0;
    open.push(from, octile(from, to));
    let found = false;
    while (open.size) {
      const cur = open.pop();
      if (cur === to) { found = true; break; }
      if (closed[cur]) continue;
      closed[cur] = 1;
      const cx = cur % NX, cz = (cur / NX) | 0;
      for (let k = 0; k < 16; k += 2) {
        const dx = STEP[k], dz = STEP[k + 1];
        const x = cx + dx, z = cz + dz;
        if (x < 0 || x >= NX || z < 0 || z >= NZ) continue;
        const nid = z * NX + x;
        if (cell[nid] !== FREE || closed[nid]) continue;
        if (dx && dz && cell[cz * NX + x] !== FREE && cell[z * NX + cx] !== FREE) continue;
        const step = (dx && dz ? SQ2 : 1) * (1 + cost[nid]);
        const t = g[cur] + step;
        if (t >= g[nid]) continue;
        g[nid] = t; came[nid] = cur;
        open.push(nid, t + octile(nid, to));
      }
    }
    if (!found) return [];
    const out = [];
    for (let n = to; n !== -1; n = came[n]) out.push(n);
    return out.reverse();
  }

  const start = nearestOpen(Math.round(NX * 0.22), NZ - 2);
  const goal = nearestOpen(Math.round(NX * 0.78), 1);
  const cells = plan(start, goal);

  const MARGIN = 0.02;
  const REACH = 0.5 + MARGIN / CELL;
  function clearRun(ax, az, bx, bz) {
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(bx - ax), Math.abs(bz - az)) / (CELL / 3)));
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const gx = (ax + (bx - ax) * t - X0) / CELL;
      const gz = (az + (bz - az) * t - Z0) / CELL;
      for (let z = Math.ceil(gz - REACH); z <= gz + REACH; z++)
        for (let x = Math.ceil(gx - REACH); x <= gx + REACH; x++) {
          if (x < 0 || x >= NX || z < 0 || z >= NZ) return false;
          if (cell[z * NX + x] !== FREE) return false;
        }
    }
    return true;
  }
  const sight = (a, b) =>
    clearRun(wx(a % NX), wz((a / NX) | 0), wx(b % NX), wz((b / NX) | 0));

  /* Only the executed strand is built solid. The grid-locked plan under it is
     the formation's to draw and it is drawn faint on purpose -- a second
     ribbon a centimetre below this one would read as a mistake in the mesh
     rather than as the gap a local planner exists to close. */
  const key = [];
  if (cells.length) {
    key.push(cells[0]);
    for (let i = 0; i < cells.length - 1;) {
      let j = cells.length - 1;
      while (j > i + 1 && !sight(cells[i], cells[j])) j--;
      key.push(cells[j]);
      i = j;
    }
  }
  let curve = key.map(n => new THREE.Vector3(wx(n % NX), floorY + RUN_LIFT, wz((n / NX) | 0)));

  for (let pass = 0; pass < 2 && curve.length > 2; pass++) {
    const out = [curve[0]];
    for (let i = 1; i < curve.length - 1; i++) {
      const a = curve[i - 1].clone().lerp(curve[i], 0.75);
      const b = curve[i].clone().lerp(curve[i + 1], 0.25);
      if (clearRun(a.x, a.z, b.x, b.z)) out.push(a, b); else out.push(curve[i]);
    }
    out.push(curve[curve.length - 1]);
    curve = out;
  }

  const run = [];
  if (curve.length) {
    run.push(curve[0]);
    for (let i = 1; i < curve.length - 1; i++) {
      const a = run[run.length - 1], b = curve[i], c = curve[i + 1];
      const ax = c.x - a.x, az = c.z - a.z;
      const len = Math.hypot(ax, az);
      const off = len < 1e-6 ? 0 : Math.abs((b.x - a.x) * az - (b.z - a.z) * ax) / len;
      if (off > 0.012 || !clearRun(a.x, a.z, c.x, c.z)) run.push(b);
    }
    run.push(curve[curve.length - 1]);
  }

  /* Heights come off their own stream and are drawn only where a cell is
     occupied, in the order the grid is scanned -- so this loop scans it the
     same way, or every column ends up wearing another cell's height. */
  const heights = rng(0x5A1D);
  const occ = [];
  for (let cz = 0; cz < NZ; cz++)
    for (let cx = 0; cx < NX; cx++)
      if (cell[cz * NX + cx] === OBSTACLE)
        occ.push(wx(cx), wz(cz), 0.10 + heights() * 0.24);

  /* ── what is drawn ───────────────────────────────────────────────────
     Three draws for the whole station, and the tier only reaches the third of
     them. Dropping cells on a slow machine would be the obvious saving and it
     is not available: the cloud this erodes into has all of them, so a low
     tier that skipped a hundred would be watching one room become a different
     one. Boxes are cheap; the tube is the only thing here whose cost is a
     choice. */
  const tier = (ctx.quality && ctx.quality.substrate) || 60000;
  const low = tier <= 9000, high = tier >= 60000;

  const grey = makeSurface({
    base: "#c9ccd4", accent: pal["--landing-accent"],
    teal: pal["--landing-teal"], fog: pal["--landing-bg"]
  });

  /* The ruling is the lattice. Free cells are not geometry on this side --
     the formation spends a point on each of them and this spends a rule -- so
     the pitch is the grid's own rather than the material's default, and at
     that pitch it phase-locks to it: the ruling is darkest halfway between
     multiples of the pitch, and one rule per cell puts that exactly on the
     cell centres, in both axes, to within a float. The default 6.5 is 54.6
     rules across a map 56 cells wide, so the lines slide a full half-cell
     over the course of the floor and no two blocks are marked alike. Darker
     than the default as well, because these lines are carrying seventeen
     hundred free cells that have no vertices anywhere. */
  grey.userData.uniforms.uPitch.value = 1 / CELL;
  grey.userData.uniforms.uGrid.value = 0.075;

  /* Fog sized to the room rather than to the corridor. From this station's eye
     the near rim of the floor is 3.5 m away and the far corners 10.2, so on
     the material's 3-to-26 the entire map sits inside the first fifth of the
     ramp and comes back uniformly near. Ending it at 19 spends a third of the
     ramp across the floor, which is the only depth cue a flat thing has. */
  grey.userData.uniforms.uFogNear.value = 3.4;
  grey.userData.uniforms.uFogFar.value = 19.0;

  /* One unit box scaled per instance, which is what keeps the costmap in a
     single draw. Box for a reason beyond tidiness: the material rotates
     normals by the instance matrix itself rather than by its inverse
     transpose, and a box is the shape that survives that -- its normals are
     the axes the scale is along, so a non-uniform scale changes their length
     and not their direction, and the fragment shader normalises anyway. */
  const cellGeo = new THREE.BoxGeometry(1, 1, 1);
  const nCells = occ.length / 3 + 1;

  /* A seed of nothing, deliberately. The dissolve is a world-space field, and
     with every instance reading it unshifted the erosion comes apart in
     patches that carry from the floor up into whatever is standing on it --
     a room coming apart, rather than every box in it coming apart
     privately. */
  seedSurface(cellGeo, nCells, () => 0);
  /* Nothing in the costmap is a project, and this mesh shares its material,
     and so its uFocus, with the posts. Left as 0..n the ninth block of the
     floor would light every time the ninth card was read. */
  cellGeo.getAttribute("aIndex").array.fill(-1);

  const cells3d = new THREE.InstancedMesh(cellGeo, grey, nCells);
  const m = new THREE.Matrix4();

  /* The floor is one more instance of the same box rather than a mesh of its
     own: same material, different scale, and a second draw call for one slab
     buys nothing. Exactly the map's footprint, so the free cells read as floor
     out to the last one and no further -- past the rim is not more floor, it
     is ground nobody has looked at. */
  m.makeScale(NX * CELL, SLAB, NZ * CELL);
  m.setPosition(anchor.x, floorY - SLAB_GAP - SLAB * 0.5, anchor.z);
  cells3d.setMatrixAt(0, m);
  for (let i = 0, k = 1; i < occ.length; i += 3, k++) {
    const h = occ[i + 2];
    m.makeScale(CELL * FOOT, h + SINK, CELL * FOOT);
    m.setPosition(occ[i], floorY + (h - SINK) * 0.5, occ[i + 1]);
    cells3d.setMatrixAt(k, m);
  }
  cells3d.instanceMatrix.needsUpdate = true;

  const postGeo = new THREE.BoxGeometry(1, 1, 1);
  const stood = [];
  for (let p = 0; p < PROJECTS; p++) if (postAt[p] >= 0) stood.push(p);
  seedSurface(postGeo, stood.length, () => 0);
  /* The index a post carries is its project's, not its slot's. A post the
     placer could not fit is a post that is not drawn, and if the ones after it
     shuffled down a slot every card past that point would light the wrong
     pillar. */
  postGeo.getAttribute("aIndex").array.set(stood);

  const posts3d = new THREE.InstancedMesh(postGeo, grey, stood.length);
  for (let k = 0; k < stood.length; k++) {
    const at = postAt[stood[k]];
    m.makeScale(POST_W, POST + SINK, POST_W);
    m.setPosition(wx(at % NX), floorY + (POST - SINK) * 0.5, wz((at / NX) | 0));
    posts3d.setMatrixAt(k, m);
  }
  posts3d.instanceMatrix.needsUpdate = true;

  const group = new THREE.Group();
  /* Built in world coordinates, like the formation it has to agree with, so
     the group is an identity transform that never changes -- and the ruling in
     the material is world-space too, which is the other half of why it lands
     on the cells rather than on the screen. */
  group.matrixAutoUpdate = false;
  group.add(cells3d, posts3d);

  const us = [grey.userData.uniforms];
  let route = null, tubeGeo = null;
  if (run.length > 1) {
    /* Straight segments rather than a spline through them. The route was
       proved clear as a sequence of straight runs and the corners it was
       allowed to round have already been rounded against that same map; a
       spline laid over the result would bow off the segments that were
       checked, and the two or three corners the base was not allowed to cut
       are exactly the ones it would cut. */
    const path = new THREE.CurvePath();
    for (let i = 1; i < run.length; i++)
      path.add(new THREE.LineCurve3(run[i - 1], run[i]));

    route = makeSurface({
      base: pal["--landing-accent"], accent: pal["--landing-accent"],
      teal: pal["--landing-teal"], fog: pal["--landing-bg"], instanced: false
    });
    /* The rules are 15 cm apart and this strand is 4 cm across, so at the
       material's default darkness the plan arrives dashed -- and a plan
       arriving in pieces is the one thing this must not be. */
    route.userData.uniforms.uGrid.value = 0.015;
    route.userData.uniforms.uFogNear.value = 3.4;
    route.userData.uniforms.uFogFar.value = 19.0;

    /* Sampled along its length rather than by a fixed count, because the plan
       is a different length every time the map is: a fixed count would put
       forty segments into a corner on one build and four on the next. */
    const along = low ? 0.14 : high ? 0.05 : 0.09;
    tubeGeo = new THREE.TubeGeometry(path, Math.max(16, Math.round(path.getLength() / along)),
                                     TUBE_R, low ? 4 : high ? 8 : 6, false);
    group.add(new THREE.Mesh(tubeGeo, route));
    us.push(route.userData.uniforms);
  }

  return {
    group,
    /* Nothing in this room has a degree of freedom, so a frame is four uniform
       writes per material and no matrix work at all. The charge arrives ready
       when the caller has other stations to spend it on; the fallback is for
       a caller that only has this one. */
    update({ t, cut, focus, pointer, charge }) {
      const c = charge === undefined
        ? Math.min(1, (pointer ? pointer.speed : 0) * 2.2) : charge;
      for (let i = 0; i < us.length; i++) {
        const u = us[i];
        u.uTime.value = t;
        u.uCut.value = cut;
        u.uFocus.value = focus;
        u.uCharge.value = c;
      }
    },
    dispose() {
      cellGeo.dispose();
      postGeo.dispose();
      if (tubeGeo) tubeGeo.dispose();
      grey.dispose();
      if (route) route.dispose();
    }
  };
}
