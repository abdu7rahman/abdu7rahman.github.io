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
 * And it runs. The search is the same search the formation runs -- same map,
 * same heuristic, same 129-cell answer -- but this side keeps the order it
 * closed cells in, which turns the plan from a picture of an answer into a
 * record of the work that produced it. 1357 tiles stand and lie back down in
 * that order as the front crosses the map; the ribbon is laid in from the goal
 * backwards, the direction A* actually reconstructs a path in; and it is
 * retired from behind, at exactly the point the cloud's own travelling band
 * has driven to. One cycle is three laps of that band. Nothing here is on a
 * clock of its own and nothing here counts frames.
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

/* ── the search, as relief ───────────────────────────────────────────────
   A* closed 1357 of this map's 1773 free cells before the goal came off the
   heap, and the order it closed them in is the only honest record of what the
   planner did: a front that leaves the start, bends round the end of every
   wall it meets, and reaches the goal 1357 pops later without ever having
   looked at the 416 cells the heuristic saved it. So every expanded cell gets
   a tile, and a tile stands up as the front arrives and lies back down behind
   it. A cell the search never opened never moves, which is the part of an
   admissible heuristic you can actually see.

   Drawn with the instance matrix, and only after the cheaper thing was tried.
   The material's one per-instance switch is uFocus, which lights a single
   index and cannot express a band of eighty-two cells, aSeed is spoken for by
   the dissolve -- it is deliberately zero here so the room erodes as one room
   -- and materials/surface.js is not this file's to extend. Matrices are what
   that leaves, and they are cheap at this size: counted over a whole cycle at
   60 fps, a frame recomposes 57 of the 2039 instance matrices on average and
   84 in its worst frame, each of them a scale and a translate.

   A tile is an obstacle column's footprint, so a cell that stands is the same
   size as a cell that is occupied, and it rests buried: its top sits 8 mm
   under the top of a slab 50 mm thick, so a cell at rest is not drawn rather
   than drawn flat and fighting the floor for the same pixels. The 50 mm of
   rise puts its top 37 mm proud of the floor and still 18 mm under the ribbon,
   which is what sets the ceiling -- a tile that reaches the plan is a tile
   that punches through it. Measured off a 1916 x 953 render with the stage
   parked at this station, that rise moves a cell 7.6 px at the near edge of
   the map and 4.4 px at the far one, on cells that are 25 and 13 px across. */
const TILE_H = 0.05, TILE_HIDE = 0.008, TILE_LIFT = 0.05;

/* Half the width of the raised band, as a share of the expansion order.
   Measured rather than chosen: the open list on this map holds 21 cells at the
   median and 40 at its widest, so the frontier itself is 40 of 1357, or 0.029
   of the order. This is twice that, deliberately. At the true width the median
   cell is on the open list for 21 expansions, which at the rate below is 0.16
   s, and a floor where every cell flicks up for a sixth of a second is a boil,
   not a wave. At 0.06 of the order a cell takes 0.61 s to rise and settle, 82
   of them are up at once, and they read as one front crossing a room. */
const HALF = 0.03;

/* ── the cycle ───────────────────────────────────────────────────────────
   One cycle is three laps of the world's travelling band: 15 s where the
   band's own lap is 5. Counted in laps rather than in seconds on purpose --
   the loop advances that band with dt and slows it to a quarter rate while
   this station is coming apart, so anything counted in laps of it is
   frame-rate independent and stops when the station stops, without this file
   holding a copy of either number.

   Three laps and not one because of what the map measured. The executed route
   is 19.88 m, which the band covers in one 5 s lap at 4.0 m/s, and nothing
   solid can be put on the route at that speed: at this framing the near rim of
   the map is 178 px per metre and the far rim 89, so a marker driving the plan
   would cross the frame at up to 710 px/s, four times a lap. That is a fly in
   the room, not a base in it. What runs at the band's speed is the band, which
   is light and reads as light; the solid layer runs at a third of it and does
   the planner's work instead -- the front sweeps, the plan is laid in, the
   plan stands, and on the third lap it is retired from behind at exactly the
   point the band has driven to. That last lap is the one place the two layers
   have to agree, and it is the one place they are the same number.

   The front crosses between these two, as a share of the cycle: 0.72 of 15 s
   is 10.8 s of sweep, of which the front is over the map itself for 10.2, so
   the search is played back at 133 of its 1357 cells a second. It is done well
   before the cycle ends and it starts a beat after it begins, so the floor is
   flat at both ends and the loop closes on stillness instead of on a cut. That
   it overlaps the drive is not a compromise, it is what a costmap planner
   does: the global plan is re-searched while the last one is still being
   followed, and on a map where nothing has moved the search comes back with
   the same answer, which is why the ribbon that goes down is the ribbon that
   came off. */
const LAPS = 3;
const SWEEP0 = 0.02, SWEEP1 = 0.74;

/* How long the plan takes to arrive, as a share of the cycle. It arrives the
   way A* produces it: backwards, from the goal along the came-from chain to
   the start, because that is the direction the answer exists in. Laying it
   from the start instead would be drawing the drive, and the drive is what the
   band is already doing. 1.5 s for 19.88 m is 13 m/s, which is far too fast
   for anything to be moving at and about right for something being
   remembered. */
const LAY = 0.10;

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

  /* The one place this file's copy of the search is not character for
     character the formation's: it is handed an array and writes the order it
     closed cells in into it. An observer and nothing more -- it sits where
     closed[cur] is already being set, reads no cost, touches no heap, and
     costs one push per expansion. The plan that comes back is the same plan,
     which is checkable and was checked: 129 cells, identical to the one the
     unrecorded search returns, cell for cell. The formation is not given the
     recorder because the formation has no use for it, and a mirrored file that
     carries a line it does not need is a line that rots. */
  function plan(from, to, order) {
    const g = new Float32Array(NX * NZ).fill(Infinity);
    const came = new Int32Array(NX * NZ).fill(-1);
    const closed = new Uint8Array(NX * NZ);
    const open = heap();
    g[from] = 0;
    open.push(from, octile(from, to));
    let found = false;
    while (open.size) {
      const cur = open.pop();
      // The goal is never closed -- the loop breaks on it -- so it is recorded
      // here or the front stops one cell short of the thing it was sent for.
      if (cur === to) { found = true; order.push(cur); break; }
      if (closed[cur]) continue;
      closed[cur] = 1;
      order.push(cur);
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
  const order = [];
  const cells = plan(start, goal, order);

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

  /* One tile per expanded cell, in the order they were expanded, so an index
     into this array is a moment in the search and the band over it is a range
     of moments.

     Thinned on the low tier, and this is the one thing in the room that may be
     thinned. The blocks may not: the cloud this erodes into has every one of
     them, so a tier that dropped a hundred would be watching one room become a
     different one. Nothing in the cloud stands where a tile stands -- the
     formation spends a single point on each free cell and leaves it on the
     floor -- so half the tiles is half a wave over the same map, not another
     map. Keyed off the tier's own point budget rather than off `low`, which is
     set at 9000 and so never fires for the 12000-point tier that actually
     wants the saving. */
  const stride = tier <= 12000 ? 2 : 1;
  const nTiles = Math.ceil(order.length / stride);
  const tileXZ = new Float32Array(nTiles * 2);
  for (let k = 0, i = 0; k < nTiles; k++, i += stride) {
    tileXZ[k * 2] = wx(order[i] % NX);
    tileXZ[k * 2 + 1] = wz((order[i] / NX) | 0);
  }

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
  /* Slab, then the blocks, then the tiles, and the layout is fixed because the
     update walks it by index: instance 0 is the floor, 1..681 are the occupied
     cells in the order the grid is scanned, and everything after TILE0 is the
     search in the order it happened. */
  const TILE0 = occ.length / 3 + 1;
  const nCells = TILE0 + nTiles;

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

  /* Where a tile sits when the search is nowhere near it, and the one call
     that moves one -- `h` is 0 at rest and 1 at the top of the band. The scale
     is written every time rather than once at build because makeScale writes
     the whole matrix, so it is also what clears the previous position out of
     it; the two calls in this order are the entire composition, with no
     rotation to carry and nothing to invert. The Matrix4 is the one the loop
     above filled the blocks with, reused, which is what keeps this free of
     allocation at fifty-odd calls a frame. */
  const TILE_REST = floorY - SLAB_GAP - TILE_HIDE - TILE_H * 0.5;
  function tileAt(k, h) {
    m.makeScale(CELL * FOOT, TILE_H, CELL * FOOT);
    m.setPosition(tileXZ[k * 2], TILE_REST + h * TILE_LIFT, tileXZ[k * 2 + 1]);
    cells3d.setMatrixAt(TILE0 + k, m);
  }
  for (let k = 0; k < nTiles; k++) tileAt(k, 0);
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
  let route = null, tubeGeo = null, rings = 0, perRing = 0;
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
    rings = Math.max(16, Math.round(path.getLength() / along));
    const ribs = low ? 4 : high ? 8 : 6;
    tubeGeo = new THREE.TubeGeometry(path, rings, TUBE_R, ribs, false);

    /* How much of the ribbon is drawn is a draw range on this geometry, which
       works because of two properties that are worth writing down since they
       are relied on rather than checked at run time. A tube emits its indices
       ring by ring along its length, six per rib per ring, so the indices from
       j * perRing onwards are the tube from ring j to its end and nothing
       else. And a CurvePath maps its parameter through the cumulative lengths
       of the curves in it, so ring j sits at j/rings of the arc length -- the
       same arc length the cloud's band is parameterised on, over the same
       vertices, which is why a cut at the band's position lands on the band
       rather than near it. Both were checked against the geometry this builds:
       at 398 rings over 19.88 m, no ring's indices reach outside its own pair
       of rings, and ring j's first vertex sits one tube radius from the point
       at j/398 of the arc length to the last digit a float has.

       A range rather than a second material or a second mesh, because the
       station has a budget of three draws and the ribbon is the third of
       them. */
    perRing = ribs * 6;
    group.add(new THREE.Mesh(tubeGeo, route));
    us.push(route.userData.uniforms);
  }

  /* What has to survive between frames: which lap of the band this is, where
     the band was when it was last asked -- the only way to notice a lap turning
     over -- and the range of tiles that was standing, so this frame knows what
     it has to put back down. [0, -1] is the empty range. */
  let lap = 0, was = 0, wLo = 0, wHi = -1;

  return {
    group,
    /* This used to say that nothing in the room had a degree of freedom, so a
       frame was four uniform writes per material and no matrix work at all.
       That was the problem rather than the design: seven stations, none of
       which did anything except carry the clock into a dissolve. A frame is
       now the same four writes, plus the fifty-odd instance matrices the
       search front has moved over, plus one draw range for the ribbon. The
       charge arrives ready when the caller has other stations to spend it on;
       the fallbacks are for a caller that only has this one. */
    update({ t, run, cut, focus, pointer, charge }) {
      const c = charge === undefined
        ? Math.min(1, (pointer ? pointer.speed : 0) * 2.2) : charge;
      for (let i = 0; i < us.length; i++) {
        const u = us[i];
        u.uTime.value = t;
        u.uCut.value = cut;
        u.uFocus.value = focus;
        u.uCharge.value = c;
      }

      /* Where the station is in its own cycle. The band laps once every five
         seconds; this counts the laps, so the phase is exactly (lap + band) /
         LAPS. Exactly, and not an accumulator advanced by dt, because an
         accumulator drifts against the very thing it is supposed to be a
         multiple of, and the last lap of the cycle is the one where the ribbon
         is cut at the band's own position: an accumulator a tenth of a lap out
         would put that cut two metres from the light it is supposed to be
         following.

         Parked at the middle of a lap when there is no band to read -- the
         plan drawn, the front stopped a fifth of the way across the map --
         because a caller without a world around it should get a still of this
         station and not an empty one. */
      const band = run === undefined ? 0.5 : run;
      if (band < was) lap = (lap + 1) % LAPS;
      was = band;
      const p = (lap + band) / LAPS;

      /* The front, in expansion order. It is walked from just off one end of
         the order to just off the other, so the band is empty at both ends of
         its window instead of appearing mid-map with eighty-two cells already
         standing. -9 is "not searching", which is the last quarter of the
         cycle and the first fiftieth of it, and is why the floor is flat when
         the loop closes. */
      const swept = (p - SWEEP0) / (SWEEP1 - SWEEP0);
      const front = swept < 0 || swept > 1 ? -9 : -HALF + swept * (1 + 2 * HALF);

      /* Which tiles the band is over now against the ones it was over last
         frame. Only the union of the two is written: everything inside it is
         standing at a new height, everything that has dropped out of it has to
         be put back down, and the twelve hundred cells either side have not
         moved and are not touched. Measured over a cycle at 60 fps that union
         is 57 instances a frame and 84 in the worst one, the width of the band
         once at each end of the sweep, and never the whole array. */
      const last = Math.max(1, nTiles - 1);
      let lo = 0, hi = -1;
      if (front > -9) {
        lo = Math.max(0, Math.ceil((front - HALF) * last));
        hi = Math.min(last, Math.floor((front + HALF) * last));
      }
      let a, b;
      if (hi < lo) { a = wLo; b = wHi; }
      else if (wHi < wLo) { a = lo; b = hi; }
      else { a = Math.min(lo, wLo); b = Math.max(hi, wHi); }
      // Flattened as the room comes apart: a cell standing on a floor that is
      // eroding out from under it is a cell floating, and the crossing is the
      // one moment this station is not a costmap.
      const rise = 1 - cut;
      for (let i = a; i <= b; i++) {
        let h = 0;
        if (i >= lo && i <= hi) {
          /* Smooth at both ends of the band so a cell arrives and leaves
             rather than switching on. Squared, which is what makes it flat
             where it meets the floor: a cell that stops rising abruptly reads
             as a click, and eighty-two of them clicking is the boil this is
             meant to avoid. The rounding above keeps this term inside [0, 1]. */
          const d = i / last - front;
          const e = 1 - d * d / (HALF * HALF);
          h = e * e * rise;
        }
        tileAt(i, h);
      }
      if (b >= a) cells3d.instanceMatrix.needsUpdate = true;
      wLo = lo; wHi = hi;

      /* How much of the ribbon has gone, measured from its start. Three legs,
         and they are the planner's own three: the plan arrives backwards from
         the goal along the came-from chain, it stands while the search that
         will replace it crosses the floor, and on the last lap it is retired
         from behind at `band` itself -- not a rescaling of it, because a plan
         consumed a little ahead of or behind the light running down it is two
         events where there should be one. The cycle ends with the ribbon empty
         at the goal and begins with it empty at the goal, so the loop has no
         seam in it: there is one instant of zero-length ribbon and the next
         thing that happens is the next plan being laid. Quantised to a ring on
         the way out -- 5 cm of route at the high tier, 9 at the other two --
         which is a third of a cell, against a travelling band that is 3.2 m of
         route from its middle to its edge. */
      if (tubeGeo) {
        const gone = p < LAY ? 1 - p / LAY
                   : p < (LAPS - 1) / LAPS ? 0
                   : band;
        // Clamped rather than trusted. The band arrives from the loop and a
        // frame whose dt came back negative -- a clock stepping backwards
        // behind a headless renderer does exactly this -- would otherwise ask
        // for a draw range starting before the buffer.
        const j = Math.max(0, Math.min(rings, Math.round(gone * rings)));
        tubeGeo.setDrawRange(j * perRing, (rings - j) * perRing);
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
