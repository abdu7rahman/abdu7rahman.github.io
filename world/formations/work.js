/* Formation 02 -- the room as the robot has it, and the search that crosses
 * it.
 *
 * The manipulator ahead of this eroded into matter; here that same matter
 * becomes the map. A 144 x 64 costmap at 15 cm lies on the floor -- 21.6 m
 * across and 9.6 m deep, 3.7 times the area this station used to carry -- and
 * every one of its 6748 free cells is one point, sized by what it costs to
 * enter, so the lattice is not a texture: it is the inflation layer, brightest
 * where the planner least wants to be. Every cell something is standing in is a
 * short column instead, and there are 2458 of those, so the lattice has a city
 * in it. Ten posts stand in the aisles, one per project, spread by depth so
 * nine of the ten land out past the reading rather than behind it -- the cards
 * paging past are cards *about* these, and a post nobody can see is a light
 * nobody can follow.
 *
 * The routes are not drawn, they are planned, and there are three of them
 * because the section's own copy is about four global planners behind one
 * interface. An 8-connected A* with an octile heuristic runs over this grid
 * once at boot, on a cost that rises near obstacles the way an inflation layer
 * does, and comes back with 187 cells and 31.26 m. Theta* runs over the same
 * grid and the same cost, differing in one rule -- a cell may take its parent's
 * parent when it can see it -- which is the whole of any-angle planning, and
 * comes back with 30.53 m. And the A* answer is shortcut and smoothed into the
 * 29.27 m curve a controller would actually drive. Three answers to one
 * question, at three heights, and the distances between them are the entire
 * reason a local planner exists: Theta*'s route runs 10.6 cm from the executed
 * one at the mean and 46 at its furthest, and the grid-locked chain of cells
 * 14.4 and 55.
 *
 * The search is drawn as well as its answer. Each of the 5546 cells A* closed
 * carries the moment it closed as its flow, so the substrate's travelling band
 * is the expansion wavefront crossing the floor -- and the 1131 cells the
 * heuristic saved it carry no flow at all and never light, which is the part of
 * an admissible heuristic you can actually see. The walls still do not run. A
 * costmap with a light travelling through its blocks is not a costmap being
 * searched, it is a screensaver, and the distinction is exactly the one this
 * file kept the first time round: what runs is the work, not the matter.
 *
 * Nothing here is a measurement of anything. It is a room that behaves like a
 * room a planner has been given.
 */
import * as THREE from "three";
import { bands, polyline, axisTriad, rng, STRUCTURE, PATH, FRAME } from "./lib.js";

/* Offsets from the station anchor; the caller adds it. The map is flat and
   21.6 m across, which is a hard thing to frame: from anywhere low the near
   edge is three times the width of the frame and from anywhere high the flight
   has to climb a storey to get here.

   Solved rather than nudged, and solved twice, because the frame moved under
   it. 62 degrees framed the old small map and was the wrong answer for the
   flight -- hero is 42 and path is 47, so arriving meant a twenty-degree zoom
   out and leaving a fifteen-degree zoom back in, which reads as the lens
   lurching rather than as the camera moving. At 52 the standoff does that work
   instead.

   The second solve is the layout. The reading column is no longer a slab down
   the left edge: it is 1060px biased inward, opaque over its own width and
   fading at both gutters, so the frame is two margins with the world running
   under the type between them -- and world/framing.js shears the projection by
   the area-weighted centre of what is uncovered, which for this state is 0.061
   at 1916 x 953. Measured through that shear, the map this station used to
   carry put 95.6% of its written points behind the type, 4.3% in the right
   margin and 0.1% in the left. It was not badly composed for one margin; it
   was composed for a frame that no longer existed, and almost all of it was
   under the paragraph.

   So the map is 3.7 times the area and the key was re-solved against it: 8.8%
   of the cloud now lands in the left margin and 22.8% in the right -- the two
   margins are 355 and 501 px wide, so that is 0.023 and 0.046 of the cloud per
   pixel of margin, and the lean to the right is the shear -- and the floor runs
   from 305 px down the frame to past the bottom edge. The near corners leave
   the frame at the sides and the near rim leaves it at the bottom, which is
   what a floor is meant to do: a map that ends inside the frame on all four
   sides is a diagram of a room and not a room.

   The depth is spent rather than left: the near rim is 3.4 m from the eye and
   the far one 12.0, and the solid layer's fog runs 3.6 to 15.5, so the far rank
   comes back 65% gone and the map fades out instead of stopping at a line.

   And it is spent at the near end rather than wasted there. Fourteen rows of
   the grid this started from projected below y = 953 at 1916 x 953 -- floor
   nobody can see, and a tile of search each -- so the grid is eight rows
   shorter and the eye is 0.6 m further back, which takes 1.2 m off the near end
   and leaves the far rim at exactly the distance it was. That is 1152 cells
   back, and the six rows still under the frame edge are what keeps the rim out
   of it. 17.5% of the cloud is off the frame at the sides, and that is the part
   that should be. */
export const VIEW = { pos: [0, 3.42, 6.90], look: [0, 0.02, -0.70], fov: 52 };

/* The costmap. 15 cm is about where a metre-scale base is planned: fine enough
   that a gap between two blocks is a gap rather than a rounding error, coarse
   enough that the whole floor is 9216 cells and the two searches over it are
   not something the boot has to budget for -- measured, the generator and the
   inflation are 18 ms, A* and the smoothing 15, and Theta* 20, so the whole map
   arrives in 53 ms, once, for both files. Held at 15 cm while the map grew
   rather than coarsened to keep the cell count down, because the resolution is
   the one number here that is a claim about how a robot plans. */
const NX = 144, NZ = 64, CELL = 0.15;
const FREE = 0, OBSTACLE = 1, MARKER = 2;

/* What made each occupied cell, kept alongside `cell` because height is not a
   free choice: a wall reaching across the floor and a lone block standing in
   an aisle are different objects and reading them at one height turns the city
   into a texture. */
const W_WALL = 1, W_BLOCK = 2, W_LOOSE = 3;

const PROJECTS = 10;      // one per <li class="proj"> in the Work section
const POST = 0.62;        // how tall a project stands
const WALLS = 4;          // obstacles that reach in from alternating sides
const BLOCKS = 41;        // free-standing rectangles between them
const SCATTER = 73;       // single occupied cells, none of them touching

/* The inflation layer: how much a step costs at an obstacle's edge, and how
   many cells the penalty reaches. It is added to a unit step cost and is never
   negative, which is what keeps the octile heuristic admissible and A* exact
   rather than merely fast.

   Four cells rather than three, and the reason is that the skirt is now drawn
   -- as point size here and as relief in the solid layer -- so the number of
   steps in it is the difference between a gradient and a staircase. The cost is
   a function of the distance to the nearest obstacle, and that distance takes
   discrete values: at CLEAR = 3 there are 7 of them across the whole field and
   at 4 there are 10. At this obstacle density it is not a halo either way --
   92.3% of the free cells are within 60 cm of something solid, against 77.2%
   within 45 -- so what varies is the value and not the coverage, and more
   levels is a smoother ramp into every block. 60 cm is also about the
   half-width of the base this would be planning for, which is the honest reason
   to inflate that far. */
const INFLATE = 2.4, CLEAR = 4;

/* The three answers, at three heights, ordered by how much each has been
   allowed to leave the grid: the A* cell path is grid-locked and lowest, Theta*
   left the grid during the search, and the shortcut-and-smoothed curve is what
   is actually driven and rides over both.

   The heights are a stack, not a preference, and the solid layer is the reason
   they are this far apart. It raises the closed set by what each cell cost, to
   49 mm above the floor at the most, and stands the A* answer's own cells at 52
   in accent -- so a strand any lower than that is a strand inside the geometry
   it is meant to be lying on. 24 mm from there to Theta*'s ribbon and another
   36 to the executed one. Tighter and two planners' answers read as one answer
   drawn twice. */
const PLAN_LIFT = 0.052, THETA_LIFT = 0.076, RUN_LIFT = 0.112;

const SQ2 = Math.SQRT2;

/* ── the map, built once ─────────────────────────────────────────────────

   world/solids/work.js draws this same room with surfaces on it and used to
   transcribe the whole construction a second time -- same seeds, same
   constants, same order of draws from the stream, including the four draws
   every rejected block still cost it -- on the grounds that this file exported
   a view and a fill and nothing else. That was true and it was a liability: two
   hundred lines of generator and a search that had to stay character for
   character identical, with the comment defending it saying in as many words
   that changing a mirrored constant on one side only dissolves the matter into
   a room it did not come out of. Theta* would have made it two searches.

   Both files are one station, so the room is built here and imported there.
   "The same room" is now a property of the program rather than a claim about
   two copies of it. Memoised on the anchor, so the formation's bake and the
   solid's build share one map, one A* and one Theta* instead of running each
   twice at boot. */
let cached = null, cachedKey = "";

export function costmap(anchor) {
  const at = anchor.x + "," + anchor.y + "," + anchor.z;
  if (cached && cachedKey === at) return cached;

  const floorY = anchor.y;
  const X0 = anchor.x - (NX - 1) * 0.5 * CELL;
  const Z0 = anchor.z - (NZ - 1) * 0.5 * CELL;
  const wx = cx => X0 + cx * CELL;
  const wz = cz => Z0 + cz * CELL;

  const cell = new Uint8Array(NX * NZ);
  const made = new Uint8Array(NX * NZ);
  const r = rng(0x0CC4);

  function mark(x, z, w, h, what) {
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) {
        const id = (z + j) * NX + (x + i);
        cell[id] = OBSTACLE; made[id] = what;
      }
  }

  /* Four obstacles that reach in from alternating sides, spaced down the room
     with room between them to cross.

     Rectangles dropped at random over the floor was the obvious way to do this
     and it is wrong, for the reason an empty path band would have been wrong: a
     map that sparse leaves a clear diagonal from one end to the other, and A*
     handed a clear diagonal returns a clear diagonal. Correct, and nothing to
     look at -- the shortcut collapsed a fifty-one cell plan to four waypoints
     and every pose along it pointed the same way. Reaching walls take the
     diagonal away. Getting from the near edge to the far one now means going
     round the end of one thing and then round the next the other way, which is
     the shape of a plan rather than the shape of an empty room.

     The reach is a share of the width rather than a count of cells, which is
     the one change the wider map forced. At 8-to-18 cells past the centreline a
     wall covered 62 to 80% of a floor 56 cells wide; the same rule on a floor
     144 wide covers 55 to 62%, which is a boulevard rather than an aisle and a
     plan that walks down the middle of the map without turning. As a share of
     the width the four walls this seed produces cover 67 to 74% -- 14.4 to
     15.9 m of a 21.6 m floor, leaving gaps of 5.7 to 7.2 m to cross at -- and
     the room is the room it was.

     Four of them where the old map had five, because the blocks below went from
     four to forty-one. Nine walls on this floor was tried first and it is a
     maze, not a room: measured on this map, the plan came out at 68.2 m of
     switchback over a floor 9.6 m deep, and a search squeezed into a
     one-aisle corridor has no wavefront to speak of -- the open list ran at 21
     cells at the median against the 65 it holds now. */
  for (let b = 0; b < WALLS; b++) {
    const reach = Math.round(NX * (0.14 + 0.20 * r()));
    const w = (NX >> 1) + reach - 1;
    const h = 2 + ((r() * 2) | 0);
    // Flush to the edge it grows from. A wall stood one cell short of the rim
    // leaves a one-cell corridor running the whole length of the map, and A*
    // will happily take it: the plan came out as a straight run down the very
    // edge of the floor, past everything it was supposed to be avoiding.
    mark((b & 1) ? NX - w : 0, 4 + Math.round(b * (NZ - 12) / (WALLS - 1)), w, h, W_WALL);
  }

  /* Forty-one more standing free in the aisles those leave, rejected if they
     come within a cell of anything already placed. Obstacles that touch are one
     obstacle, and a costmap whose blocks have fused has no gaps left for the
     planner to find. Blocks rather than walls are what make this read as a city
     instead of a maze, and they are what the front has to bend around: 2458
     occupied cells over 9216, or 27% of the floor. */
  for (let tries = 0, n = 0; tries < 2000 && n < BLOCKS; tries++) {
    const w = 3 + ((r() * 13) | 0);
    const h = 2 + ((r() * 7) | 0);
    const x = 2 + ((r() * (NX - 4 - w)) | 0);
    const z = 3 + ((r() * (NZ - 6 - h)) | 0);
    let clash = false;
    for (let j = z - 1; j <= z + h && !clash; j++)
      for (let i = x - 1; i <= x + w; i++)
        if (i >= 0 && i < NX && j >= 0 && j < NZ && cell[j * NX + i] !== FREE) { clash = true; break; }
    if (clash) continue;
    mark(x, z, w, h, W_BLOCK);
    n++;
  }

  /* A cell with nothing in any of its eight neighbours. Every loose cell and
     every post is placed under this rule and it is not fussiness: a single
     occupied cell in open floor can never disconnect an 8-connected grid, while
     one welded to the corner of a block can plug the only way past it. This is
     the difference between scenery and an unsolvable map. */
  function isolated(cx, cz) {
    if (cx < 1 || cz < 1 || cx > NX - 2 || cz > NZ - 2) return false;
    for (let j = -1; j <= 1; j++)
      for (let i = -1; i <= 1; i++)
        if (cell[(cz + j) * NX + (cx + i)] !== FREE) return false;
    return true;
  }

  /* The nearest cell to a wanted one that satisfies that rule, searched by
     expanding ring so a post lands as close to where it was asked for as the
     obstacles allow. */
  function nearestOpen(cx, cz) {
    for (let ring = 0; ring < 14; ring++)
      for (let j = -ring; j <= ring; j++)
        for (let i = -ring; i <= ring; i++) {
          if (Math.max(Math.abs(i), Math.abs(j)) !== ring) continue;
          if (isolated(cx + i, cz + j)) return (cz + j) * NX + (cx + i);
        }
    return -1;
  }

  for (let tries = 0, n = 0; tries < 12000 && n < SCATTER; tries++) {
    const cx = 1 + ((r() * (NX - 2)) | 0);
    const cz = 3 + ((r() * (NZ - 6)) | 0);
    if (!isolated(cx, cz)) continue;
    cell[cz * NX + cx] = OBSTACLE; made[cz * NX + cx] = W_LOOSE;
    n++;
  }

  /* Ten posts, one per band of the room so they come up in step with the cards
     going past, alternating sides of the centreline so they read as objects
     standing in a room rather than as a fence down the middle of it. They are
     blocked for the planner as well as drawn: a post is a thing in the room,
     and a route that goes through one is a route that has not noticed the
     project.

     Spread by depth, which is a composition decision as much as a scattering
     one, and the frame is the reason. uFocus lights the post belonging to the
     card being read, and measured through this station's shear the middle 55%
     of the frame is under a panel at 94% opacity, so a post inside that strip
     lights something nobody can see. But the frame is a trapezoid: the far rank
     is in it across the whole width of the map and the row the nearest post
     stands in is in it from 31% to 66%, so a fixed offset from the centreline
     cannot be right at both ends. At a flat 0.16-to-0.46 three of the ten stood
     outside the frame entirely and four were behind the type. Growing the
     offset with depth -- 0.095 of the width at the nearest post and 0.405 at
     the furthest, times a spread of 0.88 to 1.12 -- puts nine of the ten in a
     margin and all ten inside the frame. */
  const postAt = new Int32Array(PROJECTS).fill(-1);
  for (let p = 0; p < PROJECTS; p++) {
    const side = (p & 1) ? 1 : -1;
    const cx = Math.round(NX * (0.5 + side * (0.095 + 0.31 * p / (PROJECTS - 1)) * (0.88 + 0.24 * r())));
    const cz = NZ - 5 - Math.round(p * (NZ - 10) / (PROJECTS - 1));
    const at = nearestOpen(cx, cz);
    // Kept in the order they were asked for rather than in the order the grid
    // is scanned, because that order is the reading order of the cards going
    // past and uFocus is an index into it.
    if (at >= 0) { cell[at] = MARKER; made[at] = W_LOOSE; postAt[p] = at; }
  }

  /* Cost to enter a cell, over and above the step itself. The map edge counts
     as an obstacle: past it is not free floor, it is floor nobody has looked
     at, and a plan that hugs the rim of what it knows is a plan that has
     understood neither. */
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

  /* A binary heap for the open set. A linear scan is quadratic in expansions
     and this runs on the main thread while the page is still assembling
     itself. */
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

  /* Octile, which is the exact cost of an unobstructed 8-connected run and so
     is the tightest heuristic that never overestimates one. */
  function octile(a, b) {
    const dx = Math.abs((a % NX) - (b % NX));
    const dz = Math.abs(((a / NX) | 0) - ((b / NX) | 0));
    return (dx + dz) + (SQ2 - 2) * Math.min(dx, dz);
  }

  const STEP = [1, 0, -1, 0, 0, 1, 0, -1, 1, 1, 1, -1, -1, 1, -1, -1];

  /* Whether a straight run between two points on the floor stays in free
     space, sampled at a third of a cell so nothing as thin as one obstacle can
     be stepped over. Every route here asks this and that is the point: the same
     test that decides a Theta* parent is visible decides whether a shortcut is
     legal and whether the corner it produces may be rounded.

     Each sample is a disc rather than a point, because a point test lets a line
     clip the corner of a cell between two samples -- the smoothed run came out
     five millimetres inside a shelf, which is nothing to look at and still a
     route through an obstacle. MARGIN stands in for the footprint the thing
     driving this has; nothing with a footprint is planned to graze. */
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

  /* ── A*, with the search itself recorded ───────────────────────────────
     Two arrays beyond the plan, and they are what turns a picture of an answer
     into a record of the work that produced it: the step at which each cell
     first entered the open list, and the step at which it was closed. A cell is
     on the open list at step s exactly when opened[c] <= s < closed[c], which
     is the true membership of the true list rather than a window slid over the
     expansion order -- the solid layer used to draw the frontier as a band 82
     cells wide in *order* space and call it a wavefront, which is a fair sketch
     of one and is not the thing itself.

     Two ints a cell is all it costs, where storing the list per step would be
     quadratic. The plan that comes back is unchanged and that is checkable: the
     recorder sits where closed[] is already being written, reads no cost and
     touches no heap. */
  function plan(from, to) {
    const g = new Float32Array(NX * NZ).fill(Infinity);
    const came = new Int32Array(NX * NZ).fill(-1);
    const closed = new Uint8Array(NX * NZ);
    const openedAt = new Int32Array(NX * NZ).fill(-1);
    const closedAt = new Int32Array(NX * NZ).fill(-1);
    const order = [];
    const open = heap();
    g[from] = 0;
    openedAt[from] = 0;
    open.push(from, octile(from, to));
    let found = false;
    while (open.size) {
      const cur = open.pop();
      // The goal is never closed -- the loop breaks on it -- so it is recorded
      // here or the front stops one cell short of the thing it was sent for.
      if (cur === to) { found = true; closedAt[cur] = order.length; order.push(cur); break; }
      if (closed[cur]) continue;
      closed[cur] = 1;
      closedAt[cur] = order.length;
      order.push(cur);
      const cx = cur % NX, cz = (cur / NX) | 0;
      for (let k = 0; k < 16; k += 2) {
        const dx = STEP[k], dz = STEP[k + 1];
        const x = cx + dx, z = cz + dz;
        if (x < 0 || x >= NX || z < 0 || z >= NZ) continue;
        const nid = z * NX + x;
        if (cell[nid] !== FREE || closed[nid]) continue;
        // A diagonal is only refused when both of the cells it squeezes
        // between are occupied. Refusing it whenever either one is turns every
        // inside corner into a two-step detour and the plan comes out looking
        // like it was drawn on graph paper by hand.
        if (dx && dz && cell[cz * NX + x] !== FREE && cell[z * NX + cx] !== FREE) continue;
        const step = (dx && dz ? SQ2 : 1) * (1 + cost[nid]);
        const t = g[cur] + step;
        if (t >= g[nid]) continue;
        g[nid] = t; came[nid] = cur;
        // First insertion only. A cell whose g improves is pushed again and is
        // not newly open -- it has been on the list since the first push, and
        // dating it from the last one would draw a frontier that jumps
        // backwards whenever the search found a better way to somewhere it had
        // already reached.
        if (openedAt[nid] < 0) openedAt[nid] = order.length;
        open.push(nid, t + octile(nid, to));
      }
    }
    const out = [];
    if (found) for (let n = to; n !== -1; n = came[n]) out.push(n);
    return { cells: out.reverse(), order, openedAt, closedAt, closed };
  }

  /* ── Theta*, over the same grid and the same cost ──────────────────────
     One rule different from the search above, and it is the whole of any-angle
     planning: when a cell is relaxed, if the parent of the cell being expanded
     can see it, the parent is adopted directly and the intervening cell is
     skipped. The result leaves the grid during the search rather than after it,
     which is what separates it from the shortcut pass further down -- that one
     takes an 8-connected answer and straightens what it can, and this one never
     commits to the 8-connected answer in the first place.

     The edge cost integrates the same inflation the A* step charges, averaged
     over the line at one sample per cell rather than charged at the
     destination. Without that, a straight run is priced as bare distance and
     Theta* will happily take a long line through the expensive skirt of an
     obstacle to save a corner -- which looks like a smoothing bug and is really
     a planner optimising a cost nobody asked for.

     Line of sight is `clearRun`, the same disc-sampled test the shortcut uses.
     Textbook Theta* uses a bare Bresenham supercover, which is cheaper and lets
     the route graze a corner by up to half a cell; with a footprint in the
     test, all three routes here answer to one clearance and none of them
     touches anything. Measured, this search costs 20 ms at boot against A* and
     the smoothing at 15 on the same map -- the price of up to eight
     line-of-sight tests an expansion -- and it is paid once, memoised, for both
     files. */
  function thetaPlan(from, to) {
    const g = new Float32Array(NX * NZ).fill(Infinity);
    const parent = new Int32Array(NX * NZ).fill(-1);
    const closed = new Uint8Array(NX * NZ);
    const open = heap();
    g[from] = 0; parent[from] = from;
    open.push(from, octile(from, to));
    let found = false;
    // Average of (1 + cost) along a straight run between two cells, one sample
    // per cell of its length, both ends included.
    function charge(a, b) {
      const ax = a % NX, az = (a / NX) | 0, bx = b % NX, bz = (b / NX) | 0;
      const len = Math.hypot(bx - ax, bz - az);
      const n = Math.max(1, Math.round(len));
      let sum = 0;
      for (let k = 0; k <= n; k++) {
        const t = k / n;
        const x = Math.round(ax + (bx - ax) * t), z = Math.round(az + (bz - az) * t);
        sum += 1 + cost[z * NX + x];
      }
      return len * sum / (n + 1);
    }
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
        const par = parent[cur];
        let via = cur, t = g[cur] + (dx && dz ? SQ2 : 1) * (1 + cost[nid]);
        if (par >= 0 && sight(par, nid)) {
          const alt = g[par] + charge(par, nid);
          if (alt < t) { via = par; t = alt; }
        }
        if (t >= g[nid]) continue;
        g[nid] = t; parent[nid] = via;
        open.push(nid, t + octile(nid, to));
      }
    }
    if (!found) return [];
    const out = [];
    for (let n = to; ; n = parent[n]) { out.push(n); if (parent[n] === n) break; }
    return out.reverse();
  }

  /* The route runs the way the reader is travelling: it starts at the near edge,
     closest to the eye, and ends at the far one. Both ends sit off the
     centreline and on opposite sides of it, so the plan has to cross the map
     rather than run down the middle of it and never meet anything -- and on
     this map that crossing is the composition. Measured at 1916 x 953, the
     start lands at (143, 833) and the goal at (1579, 348): the plan leaves the
     bottom of the left margin, passes behind the reading and arrives high in
     the right one.

     It costs something and the cost is worth writing down. A* fills outward
     from the start, and the floor around the start is the near rank, which is
     the part of a trapezoid that runs off the sides -- so 63% of the expansions
     land inside the frame and the rest do not, and taken in tenths of the sweep
     that is 79, 47, 42, 45, 21, 24, 77, 100, 100, 94 per cent. There is a
     second of the five where the front is mostly off the picture. Starting at
     the far rank instead puts 84% of it in view and was rejected: it also
     shortens the plan to 18 m and lands it across the top third of the frame,
     and a plan that crosses the whole picture is worth more than a search that
     is uniformly visible. */
  const start = nearestOpen(Math.round(NX * 0.31), Math.round(NZ * 0.86));
  const goal = nearestOpen(Math.round(NX * 0.82), 2);
  const A = plan(start, goal);
  const cells = A.cells;
  const theta = thetaPlan(start, goal);

  /* The cell path kept only at its corners. Every cell in the middle of a
     straight run lies exactly on the chord between that run's ends, so keeping
     it changes nothing about the strand and costs the arc-length sampler a
     longer table -- and that table is walked from the start again for every
     single point it places. */
  const staircase = [];
  for (let i = 0; i < cells.length; i++) {
    if (i > 0 && i < cells.length - 1) {
      const a = cells[i - 1], b = cells[i], c = cells[i + 1];
      if ((b % NX) - (a % NX) === (c % NX) - (b % NX) &&
          ((b / NX) | 0) - ((a / NX) | 0) === ((c / NX) | 0) - ((b / NX) | 0)) continue;
    }
    staircase.push(new THREE.Vector3(wx(cells[i] % NX), floorY + PLAN_LIFT, wz((cells[i] / NX) | 0)));
  }

  const anyAngle = theta.map(n =>
    new THREE.Vector3(wx(n % NX), floorY + THETA_LIFT, wz((n / NX) | 0)));

  /* Shortcut: from each waypoint kept, the furthest cell further along that can
     still see it. What survives is the sequence of straight runs the staircase
     was approximating all along. */
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

  /* Two rounds of Chaikin over those runs, each corner replaced by the pair of
     points a quarter in from it along its two segments. A shortcut path is
     drivable but its corners are instantaneous changes of heading, which no
     base executes; rounding them is what makes the third strand read as
     something driven rather than something computed.

     The rounding is checked, corner by corner, against the same map that
     produced the plan. Cutting a corner moves the route off the segments the
     shortcut proved clear, and a route that leaves the free space to look
     smooth is a lie about both. A corner the base could not round is a corner
     it does not round -- it takes it square. */
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

  /* Then thinned again, for the same reason the staircase was: a vertex the
     line would pass within a centimetre of anyway is a vertex the sampler pays
     for on every point and the eye never sees, and a centimetre is under the
     jitter the sampler adds.

     Dropping a vertex replaces two segments with one, so it is a shortcut like
     any other and it answers to the same test. Without that it is not a
     thinning, it is a second round of corner-cutting with nothing checking it,
     and it put the route back through the obstacles the guarded smoothing had
     just kept it out of. */
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

  /* Eight poses on the executed curve, evenly spaced by arc length rather than
     by index so they do not bunch wherever Chaikin left vertices close
     together: the two ends, and the six the base passes through between them.
     Yaw is the tangent, and the triad's own x axis is laid along it, which is
     the axis a mobile base drives down. */
  const cum = [0];
  for (let i = 1; i < run.length; i++) cum.push(cum[i - 1] + run[i].distanceTo(run[i - 1]));
  const total = cum[cum.length - 1] || 1;
  const poses = [];
  for (let k = 0; run.length > 1 && k < 8; k++) {
    const s = (k / 7) * total;
    let i = 1;
    while (i < cum.length - 1 && cum[i] < s) i++;
    const a = run[i - 1], b = run[i];
    const t = Math.min(1, Math.max(0, (s - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1])));
    poses.push(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t,
               Math.atan2(-(b.z - a.z), b.x - a.x));
  }

  /* The grid, flattened once.

     Occupied cells carry their own height, and which generator made a cell
     decides the range it is drawn from: a wall reaching across the floor is low
     and long, a free-standing block is the tallest thing that is not a project,
     and a loose cell is somewhere between. One stream, drawn in scan order, so
     the heights are the same wherever they are asked for -- and drawn for every
     occupied cell whether or not its range differs, because a stream consumed
     conditionally is a stream that gives a different room to whoever asks
     second.

     Free cells carry their cost and the moment the search closed them: the two
     numbers the lattice is drawn from, and the two the solid layer raises its
     relief from. A cell A* never reached carries -1 and is floor nobody
     looked at. */
  const heights = rng(0x5A1D);
  const nOrder = Math.max(1, A.order.length - 1);
  const flat = [], solid = [], stands = [];
  for (let cz = 0; cz < NZ; cz++)
    for (let cx = 0; cx < NX; cx++) {
      const id = cz * NX + cx, x = wx(cx), z = wz(cz);
      const u = heights();
      if (cell[id] === OBSTACLE) {
        const h = made[id] === W_WALL ? 0.10 + u * 0.16
                : made[id] === W_BLOCK ? 0.16 + u * 0.26
                : 0.10 + u * 0.20;
        solid.push(x, z, h);
      } else if (cell[id] === MARKER) stands.push(x, z);
      else flat.push(x, z, cost[id] / INFLATE,
                     A.closedAt[id] < 0 ? -1 : A.closedAt[id] / nOrder);
    }

  /* What the two files share. Not a copy of the generator's working state --
     the heaps, the g scores and the came-from chains are gone with the
     functions that made them -- but the room, the field, the search's own
     record of itself, and the three answers.

     openedAt and closedAt are the whole of the search as far as anything
     downstream is concerned: a cell is on the open list at step s exactly when
     opened <= s < closed, so two ints a cell carry a set that changes 11163
     times over the search -- 5617 cells opened, 5546 of them closed -- without
     either file ever storing the set. 71 cells were
     still on the list when the goal came off the heap, which is the boundary of
     what the planner bothered to look at, and it falls out of the same pair. */
  cached = {
    NX, NZ, CELL, X0, Z0, wx, wz, floorY, INFLATE, POST, PROJECTS,
    cell, cost, postAt, start, goal,
    order: Int32Array.from(A.order),
    openedAt: A.openedAt, closedAt: A.closedAt,
    cells, staircase, anyAngle, run, poses,
    free: Float32Array.from(flat),
    occ: Float32Array.from(solid),
    post: Float32Array.from(stands)
  };
  cachedKey = at;
  return cached;
}

export function build(ctx) {
  const map = costmap(ctx.anchor);
  const floorY = map.floorY;
  const freeXZ = map.free, occXZH = map.occ, postXZ = map.post;
  const nFree = freeXZ.length >> 2, nOcc = occXZH.length / 3;

  return function fill(pos, kind, size, count, flow) {
    const { S, P, F } = bands(pos, kind, size, count, flow);

    /* A free cell is one point by definition and the cell count is fixed by the
       resolution, so the grid's knobs are how finely a column is sampled and --
       new, and forced by the map's size -- how many free cells the lattice
       draws at all. The floor is 6748 cells against a structure band of 49600
       at the high tier and 7440 at the low one, so a lattice that always drew
       every cell would spend nine tenths of a phone's budget on floor and leave
       the 2458 columns standing in it with nothing to be drawn out of. The
       columns may not be thinned -- the solid layer builds a box for every one
       of them, and a tier that dropped a hundred would be watching one room
       erode into a different one -- so it is the floor that thins, to every
       third cell at the low tier and every cell at the other two, which is the
       same floor sampled coarsely. Measured across the three: 12 rungs a column
       and a quarter of the band left over for pad() at 80000 points, 4 rungs at
       34000, and 2 rungs with a third of the floor drawn at 12000.

       Two points per column is the floor of the other knob, not three: at three
       the low tier could not fit the columns at all and truncated them silently
       partway across the room. */
    const forFloor = Math.max(0, S.room - nOcc * 2 - PROJECTS * 10);
    const step = Math.max(1, Math.ceil(nFree / Math.max(1, Math.min(forFloor, S.room * 0.42))));
    for (let i = 0; i < nFree; i += step) {
      const c = freeXZ[i * 4 + 2];
      /* Sized by what the cell costs to enter, which is the whole inflation
         layer drawn in one number: 0.30 out in the open and 1.10 hard against a
         block, and an additive point is brighter as well as bigger, so the
         skirt around every obstacle reads as a skirt rather than as floor. The
         cost was computed here from the first version of this station and never
         once drawn -- the planner used it and the picture did not, which is the
         precise definition of a number the reader has to take on trust.

         Squared, and that is not decoration. 92.3% of the free cells carry some
         cost at this density and the mean is 0.54, so a linear ramp lifts the
         whole floor and the ridges do not separate from it; squaring leaves the
         open aisles at the bottom of the range and spends the top of it on the
         cells actually against something.

         In size rather than in height, and not because height would be too
         small to see -- 3 cm of lift is 7.2 px at the nearest rank in frame and
         2.4 at the far one, which is plenty. It is that the solid layer already
         raises this same field as relief, from 15 to 49 mm, and a lattice
         lifted into that range is two readings of one number fighting each
         other in the same 5 cm of air. Size is the channel the solid layer does
         not use. */
      S.put(freeXZ[i * 4], floorY, freeXZ[i * 4 + 1], STRUCTURE, 0.30 + 0.80 * c * c,
            freeXZ[i * 4 + 3]);
    }

    /* Capped, because past about twenty rungs on a column 10 to 42 cm tall the
       extra matter is brightness rather than shape and pad() spends it better,
       spreading each cell into a cell.

       Five arguments, which is how the writer is told a point does not run. A
       block does not travel and neither does a post; what travels is the search
       across the floor and the three plans it produced. */
    const rungs = Math.max(2, Math.min(20,
      Math.floor((S.share(0.74) - PROJECTS * 10) / Math.max(1, nOcc))));
    for (let i = 0; i < occXZH.length; i += 3) {
      const h = occXZH[i + 2];
      for (let k = 0; k < rungs; k++)
        S.put(occXZH[i], floorY + h * k / (rungs - 1), occXZH[i + 1], STRUCTURE, 0.9);
    }

    // One emphatic point on top of each post, because ten of anything in a
    // field of thousands needs a reason to be found.
    const tall = Math.max(8, Math.min(72, Math.floor(S.share(0.55) / PROJECTS)));
    for (let i = 0; i < postXZ.length; i += 2)
      for (let k = 0; k < tall; k++)
        S.put(postXZ[i], floorY + POST * k / (tall - 1), postXZ[i + 1],
              STRUCTURE, k === tall - 1 ? 1.8 : 0.85);
    // A third of a cell, so what is left over fills the cells it came from
    // rather than blurring across the ones next door.
    S.pad(0.05);

    /* Two of the three routes are the accent band; the third is teal and is
       written with the frames, which is a colour decision and an honest one.
       The accent in this world is the plan being driven -- the grid-locked
       answer underneath and the smoothed curve the base actually follows -- and
       Theta* is neither. It is a second planner's answer to the same question,
       shown beside the first, and the substrate has exactly one colour for a
       thing that is neither the matter nor the route being executed.

       Each runs on its own arc length rather than on a shared slice of one.
       They are three answers to one question and they are not the same length
       -- 31.26 m of grid-locked staircase, 30.53 of Theta*, 29.27 of the
       shortcut-and-smoothed curve, so what the corners are worth over this map
       is two metres -- and mapping each onto 0..1 separately is what puts the
       band at the same *fraction of the journey* on all three at the same
       moment. Sharing one parameter by length instead would have the band
       leading on the short strand and lagging on the long one, which draws them
       as being at different points of the same drive. They are not. They are
       one drive, drawn three times. */
    polyline(map.staircase, P.share(0.30), P, PATH, 0.62, 0.012, 0x2A17, true);
    polyline(map.run, P.share(1.0), P, PATH, 1.45, 0.016, 0x2B44, true);
    P.pad(0.02);

    polyline(map.anyAngle, F.share(0.44), F, FRAME, 0.85, 0.014, 0x2C61, true);

    /* The eight poses light in turn as the band reaches each of them, which is
       the one thing in this formation that reads as a base rather than as a
       plan. Their flow is the number their position already came from: the k-th
       pose is placed at k/7 of the executed curve's arc length, so k/7 is where
       it is, and it comes up when the band is standing on it and not a moment
       either side. At the substrate's 0.16 band width, 1/7 apart, two are lit
       at a time and the handover between them is smooth, which is what makes
       eight discrete markers read as one thing passing through them.

       Constant across all three arms on purpose. A pose is a place the base
       goes through, not a route of its own, and running a band up each arm
       would have drawn three little journeys at right angles to the one that
       matters.

       lib's triad takes no flow argument and lib is not this file's to change,
       so the flow is attached to the writer rather than to the call: triad
       reaches the buffer only through put(), so a writer that fills in the
       sixth argument on the way past is the whole of the change. */
    const poses = map.poses;
    let poseAt = -1;
    const driven = { put: (x, y, z, k, s) => F.put(x, y, z, k, s, poseAt) };
    const arms = Math.floor(F.room / (poses.length / 4 + 1));
    for (let i = 0, k = 0; i < poses.length; i += 4, k++) {
      poseAt = k / (poses.length / 4 - 1);
      axisTriad(poses[i], poses[i + 1], poses[i + 2], poses[i + 3], arms, driven, 0.20, 1.0);
    }
    F.pad(0.01);
  };
}
