/* Station 02, solid: the room the robot has, with surfaces on it, and the
 * search that crosses it.
 *
 * world/formations/work.js builds the map and plans over it -- a 144 x 64
 * costmap at 15 cm with four walls reaching in from alternating sides,
 * forty-one blocks standing in the aisles they leave, ten posts one per
 * project, an inflation layer four cells deep, and three routes across it. This
 * is that room settled: a box where the formation draws a column of points, a
 * slab under the 6748 free cells it spends one point each on, a pillar where it
 * stands a bright column, and a ribbon along each of the two curves it draws as
 * strands. Scroll away and these erode into exactly those points, on the same
 * noise field the points are released on, so the change of state is one event
 * seen twice.
 *
 * The map is imported rather than transcribed, and that is a change. This file
 * used to build the whole thing a second time -- same seeds, same constants,
 * same order of draws from the stream, including the four draws every rejected
 * block still cost it -- because the formation exported a view and a fill and
 * nothing else. The comment defending that said, correctly, that changing a
 * mirrored constant on one side only dissolves the matter into a room it did
 * not come out of. Two searches and a generator held identical by discipline is
 * a bet you lose eventually; both files are one station, so the formation
 * exports the map and this reads it. Cell for cell and height for height it is
 * the same room because it is the same array.
 *
 * And it runs, on the world's own travelling band and on nothing else. One
 * cycle is three laps of that band and each lap is one thing the planner does:
 *
 *   lap 0  the search. 5546 cells close in the order A* closed them, each
 *          rising by what it cost to enter, so the closed set is not a plateau
 *          -- it is the inflation layer, read out by the thing that paid for
 *          it. The open list rides the leading edge in accent, drawn from the
 *          list itself rather than from a window slid over the expansion order.
 *   lap 1  the answer. The ribbon lays in backwards from the goal along the
 *          came-from chain, because that is the direction the answer exists in,
 *          and the 187 cells of the A* plan stand up in the same accent as it
 *          reaches them: the grid-locked answer in the grid's own units, under
 *          the smoothed curve a controller would actually drive.
 *   lap 2  the drive. The band runs the route, the ribbon is retired from
 *          behind at exactly the point the band has driven to, the plan's cells
 *          drop back, and the closed set sinks over the last half of the lap so
 *          the cycle closes on an empty floor rather than on a cut.
 *
 * Nothing here is on a clock of its own and nothing here counts frames.
 *
 * Nothing here is a measurement of anything. It is scenery that obeys the rules
 * a costmap obeys.
 */
import * as THREE from "three";
import { makeSurface, seedSurface } from "../materials/surface.js";
import { costmap } from "../formations/work.js";

/* A column stops just short of the cell it fills, so two neighbours in a wall
   meet at a seam instead of in a shared plane. Coplanar faces are a stripe of
   z-fighting down the length of every wall in the room, and the 6 mm this costs
   reads at this standoff as blocks stacked against each other, which is what
   they are. */
const FOOT = 0.96;

/* How far anything standing is planted into the floor. A foot resting exactly
   on the plane shows daylight under it from an eye this low, and obstacles with
   light under them are obstacles hovering over the costmap. */
const SINK = 0.02;

/* The floor slab. Its top sits a hair under the plane the free cells' points
   are written on: level with them it fights them for the same pixels, and much
   lower the lattice starts to float. Thick enough to have an edge -- the near
   rim is the closest thing in this frame, and a plane seen at 25 degrees has no
   edge to catch light on at all. */
const SLAB = 0.05, SLAB_GAP = 0.005;

/* A post is slimmer than its cell. Ten of these are the only things in the room
   that are about something, and they have to read as objects standing on the
   floor rather than as its tallest blocks. */
const POST_W = 0.09;

/* The two ribbons. The executed curve is the thicker of them because it is the
   one being driven; thinner than this and it is a wire that aliases into a
   dotted line at the far end of the map, thicker and it stops being a plan and
   becomes a kerb. Theta*'s is half of it, which is what keeps two routes that
   run 10.6 cm apart on average -- 20 px at the nearest rank in frame and 9 at
   the far one -- from reading as one route drawn twice. */
const TUBE_R = 0.020, THETA_R = 0.011;

/* ── the search, as relief ───────────────────────────────────────────────
   A* closed 5546 of this map's 6748 free cells before the goal came off the
   heap, and the order it closed them in is the only honest record of what the
   planner did: a front that leaves the start, bends round the end of every wall
   it meets, and reaches the goal 5546 expansions later without ever having
   looked at the 1131 cells the heuristic saved it. So every expanded cell gets
   a tile, and a tile stands as the front arrives and stays standing, because
   that is what a closed set is -- A* closes cells and never re-opens them, so a
   costmap being searched is a region filling in and not a wave passing
   through.

   How far it stands is what it cost to enter. The inflation layer is computed
   for the planner and, until this, was never drawn: the search used it and the
   picture did not, which is the precise definition of a number the reader has
   to take on trust. Now a cell out in the open rises 28 mm and one hard against
   a block 62, so the closed region is a relief map of the cost field, with ridges
   banked up against everything solid. Measured at this station's key on a
   1916 x 953 window, that 34 mm of range is 8.2 px at the nearest rank the
   frame actually contains and 2.8 at the far one, on cells that are 36 and 12
   px across.

   Drawn with the instance matrix, and only after the cheaper thing was tried.
   The material's one per-instance switch is uFocus, which lights a single index
   and cannot express a set of four hundred cells, aSeed is spoken for by the
   dissolve -- it is deliberately zero here so the room erodes as one room --
   and materials/surface.js is not this file's to extend. Matrices are what that
   leaves, and they are cheap at this size.

   A tile is an obstacle column's footprint, so a cell that stands is the same
   size as a cell that is occupied, and it rests buried: its top sits 8 mm under
   the top of a slab 50 mm thick, so a cell at rest is not drawn rather than
   drawn flat and fighting the floor for the same pixels. */
const TILE_H = 0.05, TILE_HIDE = 0.008, TILE_LIFT = 0.062;

/* ── what the planner is asserting ───────────────────────────────────────
   Everything the planner is currently standing behind is drawn in the accent,
   and it is drawn twice over because there are two of them. On lap 0 it is the
   open list; on laps 1 and 2 it is the cells of the A* answer, which arrive
   backwards from the goal as the ribbon lays in and retire from the start as
   the band drives it off. They overlap for three quarters of a second at the
   handover and not otherwise, because the planner is never doing both: it
   returns a path and drops its open list.

   Both are one instance per cell with a count that changes every frame, which
   is the cheapest thing an InstancedMesh can be asked to do. The room is the
   page's cream; anything the search asserts is the accent.

   The frontier is the list itself. Every cell carries the step it first entered
   the open list and the step it was closed, so membership at step s is
   opened <= s < closed -- the true set, not a band of fixed width slid over the
   expansion order, which is what this used to draw and call a wavefront.

   With one qualification, and it is a shutter rather than a lie about the set.
   The search plays back over one 5 s lap, which is 1109 expansions a second,
   and the median cell is on the list for 61 of them: 55 ms, or three frames at
   60. The list holds 65 cells at the median and 111 at its widest, and 111
   things blinking for three frames each is static, not a front. So a pin also
   stands for 139 steps -- an eighth of a second -- after its cell is closed,
   fading as it goes. The leading edge of the band is the open list exactly;
   behind it is the last eighth of a second of it. Swept over the whole search
   that draws 204 pins at the median and 250 at the widest, which is a front you
   can see. The tail was a fifth of a second first, which on this map is 287 pins
   at the median, drawn at a cell's full footprint -- too many and too big:
   looked at, the frontier came out as a wall of red blocks standing in the room
   rather than as a mark on it.

   Which is also why a pin is not a cell. It is 45 mm across against the cell's
   144 and it stands 145 tall, so it reads as something planted in the map --
   the shape says marker and the colour says planner. A plan cell is the
   opposite and for the same reason: full footprint, 57 mm, because the
   grid-locked answer *is* cells, and the whole distinction between it and the
   ribbon over it is that one is made of cells and the other is not. */
const PIN_W = 0.30, PIN_H = 0.145, PIN_TAIL = 0.025;
const PLAN_W = 0.96, PLAN_H = 0.057;

/* ── the cycle ───────────────────────────────────────────────────────────
   Three laps of the world's travelling band, one job each, and the phase inside
   a lap is the band's own position. Counted in laps rather than in seconds on
   purpose -- the loop advances that band with dt and slows it to a quarter rate
   while this station is coming apart, so anything counted in laps of it is
   frame-rate independent and stops when the station stops, without this file
   holding a copy of either number.

   The sweep is exactly lap 0, and that is the one number this layer and the
   cloud share. The formation gives every closed cell a flow equal to the moment
   it closed, so the substrate's band -- 0.16 of a feature either side of where
   it has got to -- lights a span of the expansion order centred on the cell
   this layer is raising at that instant. One event, drawn twice, in two
   materials. It was three laps of 0.72 of a cycle before, which was an
   arbitrary window that happened to look right and could not agree with
   anything.

   The plan is laid over the first 0.30 of lap 1: 1.5 s for 29.3 m of route is
   20 m/s, which is far too fast for anything to be moving at and about right
   for something being remembered. Then the whole of lap 2 is the drive, and the
   closed set sinks over the last half of it, so the floor is flat at the moment
   the next search starts. */
const LAPS = 3, LAY = 0.30, SINK0 = 0.5;

/* How much of the order rises at once. The front is a step in the data -- a
   cell is closed or it is not -- and a step in the geometry is a click, so a
   tile takes 0.04 of the order to reach its height, which at 1109 expansions a
   second is 200 ms. That is also the width of the write set: 222 tiles a frame
   through the sweep, against 111 cells on the open list at its widest. */
const RISE = 0.04;

export function build(ctx) {
  const map = costmap(ctx.anchor);
  const pal = ctx.pal || {};
  const anchor = ctx.anchor;
  const { NX, NZ, CELL, INFLATE, PROJECTS, POST, floorY, wx, wz,
          cost, postAt, order, openedAt, closedAt, occ, run, anyAngle } = map;

  /* ── what is drawn ───────────────────────────────────────────────────
     Five draws for the whole station: the room, the open list, the plan in
     cells, and a ribbon each for the two curved answers. Dropping blocks on
     a slow machine would be the obvious saving and it is not available -- the
     cloud this erodes into has all of them, so a low tier that skipped a
     hundred would be watching one room become a different one. Boxes are cheap.
     What the tier reaches is the tiles, which are a playback and not the room,
     and the two tubes, which are the only things here whose vertex count is a
     choice. */
  const tier = (ctx.quality && ctx.quality.substrate) || 60000;
  /* `low` was `tier <= 9000` and TIERS.low.substrate is 12000, so it never
     fired: the low tier silently took the medium branch everywhere it was read.
     Keyed off the budget the tier actually has. */
  const low = tier <= 20000, high = tier >= 60000;

  /* One tile per expanded cell, in the order they were expanded, so an index
     into this array is a moment in the search.

     Thinned on the low tier, and this is the one thing in the room that may be
     thinned. Nothing in the cloud stands where a tile stands -- the formation
     spends a single point on each free cell and leaves it on the floor -- so
     half the tiles is half a search over the same map, not another map: 2773
     of them against 5546. */
  const stride = low ? 2 : 1;
  const nTiles = Math.ceil(order.length / stride);
  const tileXZ = new Float32Array(nTiles * 2);
  // How high each tile stands once it is closed, and when in the order that
  // happens. Per tile rather than per cell, because the update walks tiles.
  const tileTop = new Float32Array(nTiles);
  const tileWhen = new Float32Array(nTiles);
  const lastStep = Math.max(1, order.length - 1);
  for (let k = 0, i = 0; k < nTiles; k++, i += stride) {
    const id = order[i];
    tileXZ[k * 2] = wx(id % NX);
    tileXZ[k * 2 + 1] = wz((id / NX) | 0);
    /* 28 mm out in the open, 62 hard against a block. Not 0-to-62: a closed
       cell that cost nothing still has to be visibly closed, and at the bottom
       of that range its top sits under the slab and the room fills in with
       holes in it wherever the floor was cheap. */
    tileTop[k] = TILE_LIFT * (0.45 + 0.55 * cost[id] / INFLATE);
    tileWhen[k] = i / lastStep;
  }

  /* Every cell that was ever opened, in the order it was first opened, so the
     frontier at step s is a prefix of this filtered by whether it has closed
     yet. A prefix scan rather than a set: it is one pass over the 5617 cells
     that were ever opened, it allocates nothing, and it cannot drift out of
     step with the search the way an incrementally maintained list can. */
  const opened = [];
  for (let id = 0; id < NX * NZ; id++) if (openedAt[id] >= 0) opened.push(id);
  opened.sort((a, b) => openedAt[a] - openedAt[b]);
  const openedIds = Int32Array.from(opened);

  /* How many pins can be up at once, counted rather than guessed: the same
     open-plus-tail membership the update draws, swept over the whole search.
     Counted here because it decides an allocation, and an InstancedMesh cannot
     grow. */
  let pinCap = 0;
  {
    const tail = Math.round(PIN_TAIL * order.length);
    const ev = new Int32Array(order.length + tail + 2);
    for (let id = 0; id < NX * NZ; id++) {
      if (openedAt[id] < 0) continue;
      const a = openedAt[id];
      const b = closedAt[id] < 0 ? order.length : closedAt[id] + tail;
      ev[a]++; if (b < ev.length) ev[b]--;
    }
    let cur = 0;
    for (let s = 0; s < ev.length; s++) { cur += ev[s]; if (cur > pinCap) pinCap = cur; }
    pinCap += 8;
  }

  const grey = makeSurface({
    base: "#c9ccd4", accent: pal["--landing-accent"],
    teal: pal["--landing-teal"], fog: pal["--landing-bg"]
  });

  /* The ruling is the lattice. Free cells are not geometry on this side -- the
     formation spends a point on each of them and this spends a rule -- so the
     pitch is the grid's own rather than the material's default, and at that
     pitch it phase-locks to it: the ruling is darkest halfway between multiples
     of the pitch, and one rule per cell puts that exactly on the cell centres,
     in both axes, to within a float. The material's default 6.5 rules a metre is
     140.4 of them across a map 144 cells wide, so the lines would slide half a
     cell over the length of the floor and no two blocks would be marked alike.
     Darker than the default as well, because these lines are carrying 6748 free
     cells that have no vertices anywhere. */
  grey.userData.uniforms.uPitch.value = 1 / CELL;
  grey.userData.uniforms.uGrid.value = 0.075;

  /* Fog sized to the room. From this station's eye the near rim of the floor is
     3.4 m away and the far one 12.0, and the material's default 3-to-26 would
     put the entire map inside the first two fifths of the ramp and bring it
     back uniformly near. Ending it at 15.5 spends most of the ramp across the
     floor instead: the near ranks are unfogged and the far one comes back 65%
     gone, so the map fades out rather than stopping at a line. That is the only
     depth cue a flat thing has, and it is why the map is drawn deep enough to
     need one. */
  const FOG_NEAR = 3.6, FOG_FAR = 15.5;
  grey.userData.uniforms.uFogNear.value = FOG_NEAR;
  grey.userData.uniforms.uFogFar.value = FOG_FAR;

  /* One unit box scaled per instance, which is what keeps the costmap in a
     single draw. Box for a reason beyond tidiness: the material rotates normals
     by the instance matrix itself rather than by its inverse transpose, and a
     box is the shape that survives that -- its normals are the axes the scale
     is along, so a non-uniform scale changes their length and not their
     direction, and the fragment shader normalises anyway. */
  const cellGeo = new THREE.BoxGeometry(1, 1, 1);
  /* Slab, blocks, posts, then tiles, and the layout is fixed because the update
     walks it by index. The posts used to be a mesh of their own, for one
     reason: they carry a project index and the costmap does not, and aIndex is
     a geometry attribute. That is an argument for a different *attribute
     value*, not for a different draw -- they are the same box under the same
     material at a different scale, and the whole point of an instanced
     attribute is that instances may differ in it. */
  const nOcc = occ.length / 3;
  const POST0 = 1 + nOcc;
  const TILE0 = POST0 + PROJECTS;
  const nCells = TILE0 + nTiles;

  /* A seed of nothing, deliberately. The dissolve is a world-space field, and
     with every instance reading it unshifted the erosion comes apart in patches
     that carry from the floor up into whatever is standing on it -- a room
     coming apart, rather than every box in it coming apart privately. */
  seedSurface(cellGeo, nCells, () => 0);
  /* Nothing in the costmap is a project. Left as 0..n the ninth block of the
     floor would light every time the ninth card was read -- so the whole array
     is -1 and the ten posts are written back over it. */
  const aIndex = cellGeo.getAttribute("aIndex");
  aIndex.array.fill(-1);
  for (let p = 0; p < PROJECTS; p++) if (postAt[p] >= 0) aIndex.array[POST0 + p] = p;

  const cells3d = new THREE.InstancedMesh(cellGeo, grey, nCells);
  const m = new THREE.Matrix4();

  /* The floor is one more instance of the same box rather than a mesh of its
     own: same material, different scale, and a second draw call for one slab
     buys nothing. Exactly the map's footprint, so the free cells read as floor
     out to the last one and no further -- past the rim is not more floor, it is
     ground nobody has looked at. */
  m.makeScale(NX * CELL, SLAB, NZ * CELL);
  m.setPosition(anchor.x, floorY - SLAB_GAP - SLAB * 0.5, anchor.z);
  cells3d.setMatrixAt(0, m);
  for (let i = 0, k = 1; i < occ.length; i += 3, k++) {
    const h = occ[i + 2];
    m.makeScale(CELL * FOOT, h + SINK, CELL * FOOT);
    m.setPosition(occ[i], floorY + (h - SINK) * 0.5, occ[i + 1]);
    cells3d.setMatrixAt(k, m);
  }
  for (let p = 0; p < PROJECTS; p++) {
    const at = postAt[p];
    if (at < 0) { m.makeScale(0, 0, 0); m.setPosition(0, -400, 0); }
    else {
      m.makeScale(POST_W, POST + SINK, POST_W);
      m.setPosition(wx(at % NX), floorY + (POST - SINK) * 0.5, wz((at / NX) | 0));
    }
    cells3d.setMatrixAt(POST0 + p, m);
  }

  /* Where a tile sits when the search is nowhere near it, and the one call that
     moves one -- `h` is 0 at rest and 1 at the top of what that cell costs. The
     scale is written every time rather than once at build because makeScale
     writes the whole matrix, so it is also what clears the previous position
     out of it; the two calls in this order are the entire composition, with no
     rotation to carry and nothing to invert. The Matrix4 is the one the loops
     above filled the room with, reused, which is what keeps this free of
     allocation at a few hundred calls a frame. */
  const TILE_REST = floorY - SLAB_GAP - TILE_HIDE - TILE_H * 0.5;
  const wrote = new Float32Array(nTiles).fill(-1);
  function tileAt(k, h) {
    if (Math.abs(wrote[k] - h) < 0.0004) return false;
    wrote[k] = h;
    m.makeScale(CELL * FOOT, TILE_H, CELL * FOOT);
    m.setPosition(tileXZ[k * 2], TILE_REST + h, tileXZ[k * 2 + 1]);
    cells3d.setMatrixAt(TILE0 + k, m);
    return true;
  }
  /* What a tile wants to be, in metres above its rest position: the cost relief
     it earns by being closed, eased in over the rise window and scaled by
     whatever the sink and the erosion have left. Out here rather than inside
     update() because a closure over the frame's own variables is an allocation
     a frame, and this whole update is 0.03 ms at the mean, 0.14 at p90 and 0.61
     at its worst -- measured by driving it through four cycles at 60 fps
     outside a browser, where the worst frame is the sink rewriting the room. */
  function wantH(k, front, gain) {
    const when = tileWhen[k];
    if (when > front) return 0;
    return tileTop[k] * Math.min(1, (front - when) / RISE) * gain;
  }

  for (let k = 0; k < nTiles; k++) tileAt(k, 0);
  cells3d.instanceMatrix.needsUpdate = true;

  const hot = makeSurface({
    base: pal["--landing-accent"], accent: pal["--landing-accent"],
    teal: pal["--landing-teal"], fog: pal["--landing-bg"]
  });
  // A 15 cm rule drawn across a 4.5 cm pin is a pin with a dark stripe on it.
  hot.userData.uniforms.uGrid.value = 0.0;
  hot.userData.uniforms.uFogNear.value = FOG_NEAR;
  hot.userData.uniforms.uFogFar.value = FOG_FAR;

  /* Two meshes under it, and the second one is a shape argument rather than a
     bookkeeping one. They could share a geometry -- both are one instance per
     cell, both change count every frame -- and the frontier would then be a
     little box, which is what it was and what was wrong with it. A cell is
     square because the map is square; the frontier is not a cell, it is a mark
     on one, so it is a six-sided prism.

     It is also the only way to get any light on it. The palette's accent is
     linear (1.00, 0.25, 0.11), luminance 0.40 against the room's 0.60, so a
     face of accent lit by the same key as a face of the room's grey comes back
     a third darker -- the thing the search is doing reads dimmer than the floor
     it is doing it on. Measured off a render, the pins came back at (113, 38,
     19) against lit block tops at about (158, 160, 166). The surface material's
     fresnel is what pays that back, and it is gated on `length(fwidth(n))`, so
     it fires nowhere on a box -- normals are constant across a flat face -- and
     everywhere on a cylinder, whose normals turn continuously around it. On a
     pin 4.5 cm across, which is four pixels at the far rank of this map and
     eleven at the nearest one in frame, almost every pixel is near the
     silhouette. */
  const pinGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 6);
  seedSurface(pinGeo, pinCap, () => 0);
  pinGeo.getAttribute("aIndex").array.fill(-1);
  const planGeo = new THREE.BoxGeometry(1, 1, 1);
  seedSurface(planGeo, map.cells.length, () => 0);
  planGeo.getAttribute("aIndex").array.fill(-1);
  const pins3d = new THREE.InstancedMesh(pinGeo, hot, pinCap);
  const plan3d = new THREE.InstancedMesh(planGeo, hot, map.cells.length);
  pins3d.count = 0;
  plan3d.count = 0;
  /* An InstancedMesh culls on a bounding sphere it computes from the instances
     it has, and these have none until a frame writes some -- so the sphere
     would be computed empty, once, and neither would ever be drawn again. There
     are two of them and the map they stand on fills the frame, so there is
     nothing for a cull to save here. */
  pins3d.frustumCulled = false;
  plan3d.frustumCulled = false;

  /* The frontier, written into the accent mesh from index `n` on. A cell is on
     it while the search has opened it and not yet closed it, plus the tail. The
     prefix scan is over the 5617 cells that were ever opened and allocates
     nothing; walking it from the start every frame rather than maintaining a
     live set is what makes it impossible for the drawn list to drift out of
     step with the recorded search. */
  function frontier(step, gain) {
    const tail = PIN_TAIL * lastStep;
    let n = 0;
    for (let i = 0; i < openedIds.length; i++) {
      const id = openedIds[i];
      if (openedAt[id] > step) break;
      const c2 = closedAt[id];
      if (c2 >= 0 && c2 + tail < step) continue;
      if (n >= pinCap) break;
      const age = c2 < 0 || c2 > step ? 0 : (step - c2) / tail;
      const h = PIN_H * (1 - age * age) * gain;
      m.makeScale(CELL * PIN_W, h, CELL * PIN_W);
      m.setPosition(wx(id % NX), floorY - SINK * 0.5 + h * 0.5, wz((id / NX) | 0));
      pins3d.setMatrixAt(n++, m);
    }
    return n;
  }

  /* The A* answer in the grid's own units, into the same mesh. Two windows over
     the same chain and they are the planner's own two directions: it arrives
     from the goal along the came-from chain, so the cell at u along the plan is
     placed once the lay-in has come 1 - u of the way back, and it leaves from
     the start under the band, so it goes once the drive has passed it. Both
     eased over a twentieth of the plan, which is nine cells -- a step would be a
     row of boxes appearing in one frame -- and both ramps run a twentieth past
     their ends, or the nine cells at each end of the chain would never quite
     arrive and never quite leave. */
  const EDGE = 0.05;
  const ramp = x => Math.min(1, Math.max(0, x / EDGE));
  function planCells(laid, driven, gain) {
    const plan = map.cells, last = Math.max(1, plan.length - 1);
    let n = 0;
    for (let i = 0; i < plan.length; i++) {
      const u = i / last;
      const on = ramp(laid * (1 + EDGE) - (1 - u)) * ramp(u + EDGE - driven * (1 + EDGE));
      if (on <= 0.002) continue;
      const id = plan[i], h = PLAN_H * on * gain;
      m.makeScale(CELL * PLAN_W, h, CELL * PLAN_W);
      m.setPosition(wx(id % NX), floorY - SINK * 0.5 + h * 0.5, wz((id / NX) | 0));
      plan3d.setMatrixAt(n++, m);
    }
    return n;
  }

  const group = new THREE.Group();
  /* Built in world coordinates, like the formation it has to agree with, so the
     group is an identity transform that never changes -- and the ruling in the
     material is world-space too, which is the other half of why it lands on the
     cells rather than on the screen. */
  group.matrixAutoUpdate = false;
  group.add(cells3d, pins3d, plan3d);

  const us = [grey.userData.uniforms, hot.userData.uniforms];

  /* The two curved answers, as tubes. Straight segments rather than a spline
     through them: both routes were proved clear as sequences of straight runs
     -- one by the shortcut, one by Theta*'s own line-of-sight test -- and a
     spline laid over either would bow off the segments that were checked, in
     exactly the corners the planner was not allowed to cut.

     The grid-locked A* answer is not a tube and must not be one. It is a chain
     of cells, so it is drawn as cells, in the accent mesh above. */
  function ribbon(pts, colour, radius, ribs) {
    if (pts.length < 2) return null;
    const path = new THREE.CurvePath();
    for (let i = 1; i < pts.length; i++)
      path.add(new THREE.LineCurve3(pts[i - 1], pts[i]));
    const mat = makeSurface({
      base: colour, accent: pal["--landing-accent"],
      teal: pal["--landing-teal"], fog: pal["--landing-bg"], instanced: false
    });
    /* The rules are 15 cm apart and these strands are 4 and 2 cm across, so at
       the material's default darkness a plan arrives dashed -- and a plan
       arriving in pieces is the one thing this must not be. */
    mat.userData.uniforms.uGrid.value = 0.015;
    mat.userData.uniforms.uFogNear.value = FOG_NEAR;
    mat.userData.uniforms.uFogFar.value = FOG_FAR;
    /* Sampled along its length rather than by a fixed count, because a plan is
       a different length every time the map is: a fixed count would put forty
       segments into a corner on one build and four on the next. */
    const along = low ? 0.14 : high ? 0.05 : 0.09;
    const rings = Math.max(16, Math.round(path.getLength() / along));
    const geo = new THREE.TubeGeometry(path, rings, radius, ribs, false);
    us.push(mat.userData.uniforms);
    group.add(new THREE.Mesh(geo, mat));
    return { geo, mat, rings, perRing: ribs * 6 };
  }
  const ribs = low ? 4 : high ? 8 : 6;
  const route = ribbon(run, pal["--landing-accent"], TUBE_R, ribs);
  /* Theta*'s answer is teal, which is the palette's colour for a thing that is
     neither the room nor the route being driven -- and that is exactly what a
     second planner's answer is. The two agree to 10.6 cm on average over this
     map and disagree by up to 46, which is the comparison the section's copy is
     about and is only visible if the two are told apart at a glance. */
  const other = ribbon(anyAngle, pal["--landing-teal"], THETA_R, Math.max(4, ribs - 2));

  /* How much of the ribbon is drawn is a draw range on its geometry, which works
     because of two properties that are worth writing down since they are relied
     on rather than checked at run time. A tube emits its indices ring by ring
     along its length, six per rib per ring, so the indices from j * perRing
     onwards are the tube from ring j to its end and nothing else. And a
     CurvePath maps its parameter through the cumulative lengths of the curves
     in it, so ring j sits at j/rings of the arc length -- the same arc length
     the cloud's band is parameterised on, over the same vertices, which is why
     a cut at the band's position lands on the band rather than near it.

     A range rather than a second material or a second mesh, because the station
     has a budget of five draws and these are two of them. */
  function cut(r, gone) {
    if (!r) return;
    // Clamped rather than trusted. The band arrives from the loop and a frame
    // whose dt came back negative -- a clock stepping backwards behind a
    // headless renderer does exactly this -- would otherwise ask for a draw
    // range starting before the buffer.
    const j = Math.max(0, Math.min(r.rings, Math.round(gone * r.rings)));
    r.geo.setDrawRange(j * r.perRing, (r.rings - j) * r.perRing);
  }

  // Nothing is drawn until a frame asks for it. A tube arrives with its whole
  // index range live, so without this the plan is standing there complete for
  // however long it takes the first update to run.
  cut(route, 1); cut(other, 1);

  /* What has to survive between frames: which lap of the band this is, where
     the band was when it was last asked -- the only way to notice a lap turning
     over -- how far through the order the rise window had got, and the erosion
     the tiles were last flattened for. */
  let lap = 0, was = 0, swept = -1, cutAt = -1;

  return {
    group,
    update({ t, run: band0, cut: erode, focus, pointer, charge }) {
      const c = charge === undefined
        ? Math.min(1, (pointer ? pointer.speed : 0) * 2.2) : charge;
      for (let i = 0; i < us.length; i++) {
        const u = us[i];
        u.uTime.value = t;
        u.uCut.value = erode;
        u.uFocus.value = focus;
        u.uCharge.value = c;
      }

      /* Where the station is in its own cycle. The band laps once every five
         seconds; this counts the laps, so the phase inside a lap is the band
         itself. Exactly, and not an accumulator advanced by dt, because an
         accumulator drifts against the very thing it is supposed to be a
         multiple of -- and two of the three laps here are pinned to the band's
         own position, the search on lap 0 and the retirement of the ribbon on
         lap 2. An accumulator a tenth of a lap out would put the cut two metres
         from the light it is supposed to be following.

         Parked at the middle of the first lap when there is no band to read,
         because a caller without a world around it should get a still of this
         station being searched and not an empty floor. */
      const band = band0 === undefined ? 0.5 : band0;
      if (band < was) lap = (lap + 1) % LAPS;
      was = band;

      /* Flattened as the room comes apart: a cell standing on a floor that is
         eroding out from under it is a cell floating, and the crossing is the
         one moment this station is not a costmap. Quantised to twelve steps of
         the erosion, because the alternative is rewriting all 5546 tiles on
         every frame of a crossing -- for a difference of 5 mm of lift per step,
         which is under a pixel at this standoff. */
      const rise = 1 - Math.round(erode * 12) / 12;
      const reset = rise !== cutAt;
      cutAt = rise;

      // Where the search has got to, as a share of the expansion order, and how
      // much of the plan has been laid in and then driven off. Each lap owns
      // one of them and says nothing about the other two.
      const front = lap === 0 ? band : 1;
      const laid = lap === 0 ? 0 : lap === 1 ? Math.min(1, band / LAY) : 1;
      const driven = lap === 2 ? band : 0;
      // How much of the closed set is still standing: all of it until the last
      // half of the drive, then eased to nothing so the loop closes on
      // stillness rather than on a cut.
      const s = lap === 2 ? Math.min(1, Math.max(0, (band - SINK0) / (1 - SINK0))) : 0;
      const standing = 1 - s * s * (3 - 2 * s);

      const gain = standing * rise;
      let moved = false;
      if (reset || standing < 0.9995) {
        for (let k = 0; k < nTiles; k++) moved = tileAt(k, wantH(k, front, gain)) || moved;
      } else {
        /* Only the window the front is currently inside. Everything behind it
           is already at its closed height and everything ahead of it is at
           rest, so the write set is the rise window: 222 tiles a frame against
           5546 in the room. */
        const lo = Math.max(0, Math.ceil((front - RISE) * lastStep / stride));
        const hi = Math.min(nTiles - 1, Math.floor(front * lastStep / stride));
        for (let k = lo; k <= hi; k++) moved = tileAt(k, wantH(k, front, gain)) || moved;
        // A lap that has just turned over leaves the whole room standing and
        // the front back at nothing, so what is ahead of it has to be put down.
        if (swept > hi) for (let k = hi + 1; k < nTiles; k++) moved = tileAt(k, 0) || moved;
        swept = hi;
      }
      if (moved) cells3d.instanceMatrix.needsUpdate = true;

      /* The two accent sets, each into a mesh whose count is the answer, so
         instances past the end are not drawn rather than parked somewhere
         harmless.

         The list does not cut out at the lap boundary, it is dropped: over the
         first 0.15 of lap 1 the frontier sinks while the plan is being laid
         over it. That is the one moment both are on screen, and it is the
         handover it draws -- a planner returning a path and letting go of its
         open list. */
      const held = lap === 0 ? 1 : lap === 1 ? Math.max(0, 1 - band / 0.15) : 0;
      const nPin = held > 0.002 && gain > 0.002 ? frontier(front * lastStep, held * gain) : 0;
      const nPlan = lap > 0 && gain > 0.002 ? planCells(laid, driven, gain) : 0;
      if (nPin || pins3d.count) { pins3d.count = nPin; pins3d.instanceMatrix.needsUpdate = true; }
      if (nPlan || plan3d.count) { plan3d.count = nPlan; plan3d.instanceMatrix.needsUpdate = true; }

      /* How much of each ribbon has gone, measured from its start. The plan
         arrives backwards from the goal along the came-from chain, it stands
         through the rest of lap 1, and on lap 2 it is retired from behind at
         `band` itself -- not a rescaling of it, because a plan consumed a
         little ahead of or behind the light running down it is two events where
         there should be one. Quantised to a ring on the way out -- 5 cm of
         route at the high tier, 9 at the middle one and 14 at the low -- against
         a travelling band
         that is 4.7 m of route from its middle to its edge.

         Theta*'s ribbon is laid in and retired on the same schedule. It is not
         the route being driven, and the band is not running down it, but a
         second answer that appeared and vanished on a clock of its own would
         read as two systems rather than as one planner shown twice. */
      const gone = lap === 1 ? 1 - laid : lap === 2 ? driven : 1;
      cut(route, gone);
      cut(other, gone);
    },
    dispose() {
      cellGeo.dispose();
      pinGeo.dispose();
      planGeo.dispose();
      if (route) { route.geo.dispose(); route.mat.dispose(); }
      if (other) { other.geo.dispose(); other.mat.dispose(); }
      grey.dispose();
      hot.dispose();
    }
  };
}
