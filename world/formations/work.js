/* Formation 02 -- the room as the robot has it, and a route planned through
 * it.
 *
 * The manipulator ahead of this eroded into matter; here that same matter
 * becomes the map. A 56 x 44 costmap at 15 cm lies on the floor: every free
 * cell is one faint point, so the grid reads as a lattice, and every cell
 * something is standing in is a short column instead, so the lattice has
 * things in it. Ten posts stand in the open, one per project -- the cards
 * scrolling past on the left are cards *about* these.
 *
 * The route is not drawn, it is planned. An 8-connected A* with an octile
 * heuristic runs over this grid once at boot, on a cost that rises near
 * obstacles the way an inflation layer does, and both of its answers are
 * shown at once: the grid-locked cell path underneath, faint, and the
 * shortcut-and-smoothed curve a controller would actually drive over the top
 * of it. The gap between those two strands is the entire reason a local
 * planner exists, and it is the only honest way to draw a plan.
 *
 * Nothing here is a measurement of anything. It is a room that behaves like a
 * room a planner has been given.
 */
import * as THREE from "three";
import { bands, polyline, axisTriad, rng, STRUCTURE, PATH, FRAME } from "./lib.js";

/* Offsets from the station anchor; the caller adds it. The grid is 8.4 m
   across and 6.6 m deep and it is flat, which is a hard thing to frame: from
   anywhere low the near edge is twice as wide as the frame and from anywhere
   high the flight has to climb a storey to get here.

   Solved rather than nudged, but for the flight rather than for this shot
   alone. 62 degrees framed it and was the wrong answer: hero is 42 and path
   is 47, so arriving here meant a twenty-degree zoom out and leaving meant a
   fifteen-degree zoom back in, which reads as the lens lurching rather than
   as the camera moving. At 52 the standoff has to do that work instead, and
   it can -- 2.7 up and 5.6 back holds 98% of the written points inside the
   frustum, with the map spanning the full width of it and straddling the
   middle. The look point sits just short of the map's centre, which is enough
   pitch to put the horizon at the very top of the frame rather than a fifth
   of the way down it: above that line there is nothing to look at, and at 5.0
   back the frame was giving a quarter of itself to it. */
export const VIEW = { pos: [0, 2.70, 5.60], look: [0, 0.02, -0.20], fov: 52 };

/* The costmap. 15 cm is about where a metre-scale base is planned: fine
   enough that a gap between two blocks is a gap rather than a rounding error,
   coarse enough that the whole floor is 2464 cells and A* over it is not
   something the boot has to budget for. */
const NX = 56, NZ = 44, CELL = 0.15;
const FREE = 0, OBSTACLE = 1, MARKER = 2;

const PROJECTS = 10;      // one per <li class="proj"> in the Work section
const POST = 0.55;        // how tall a project stands
const BLOCKS = 9;         // rectangular obstacles, before the loose cells
const SCATTER = 74;       // single occupied cells, none of them touching

/* The inflation layer: how much a step costs at an obstacle's edge, and how
   many cells the penalty reaches. It is added to a unit step cost and is
   never negative, which is what keeps the octile heuristic admissible and A*
   exact rather than merely fast. */
const INFLATE = 2.4, CLEAR = 3;

/* Both strands ride above the lattice so they are not fighting the floor
   points for the same pixels; the executed one rides above the planned one,
   because it is the one that won. */
const PLAN_LIFT = 0.030, RUN_LIFT = 0.075;

const SQ2 = Math.SQRT2;

export function build(ctx) {
  const anchor = ctx.anchor;
  const floorY = anchor.y;
  const X0 = anchor.x - (NX - 1) * 0.5 * CELL;
  const Z0 = anchor.z - (NZ - 1) * 0.5 * CELL;
  const wx = cx => X0 + cx * CELL;
  const wz = cz => Z0 + cz * CELL;

  const cell = new Uint8Array(NX * NZ);
  const r = rng(0x0CC4);

  /* Nine rectangles, rejected if they come within two cells of one another.
     Obstacles that touch are one obstacle, and a costmap whose blocks have
     fused has no gaps left for the planner to find -- which is how a
     formation like this ends up shipping an empty path band. The three rows
     at either end are left alone so the start and the goal have clear floor
     to stand on. */
  for (let tries = 0, made = 0; tries < 600 && made < BLOCKS; tries++) {
    const w = 3 + ((r() * 9) | 0);
    const h = 2 + ((r() * 7) | 0);
    const x = 2 + ((r() * (NX - 4 - w)) | 0);
    const z = 3 + ((r() * (NZ - 6 - h)) | 0);
    let clash = false;
    for (let j = z - 1; j <= z + h && !clash; j++)
      for (let i = x - 1; i <= x + w; i++)
        if (i >= 0 && i < NX && j >= 0 && j < NZ && cell[j * NX + i] !== FREE) { clash = true; break; }
    if (clash) continue;
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) cell[(z + j) * NX + (x + i)] = OBSTACLE;
    made++;
  }

  /* A cell with nothing in any of its eight neighbours. Every loose cell and
     every post is placed under this rule and it is not fussiness: a single
     occupied cell in open floor can never disconnect an 8-connected grid,
     while one welded to the corner of a block can plug the only way past it.
     This is the difference between scenery and an unsolvable map. */
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

  for (let tries = 0, made = 0; tries < 4000 && made < SCATTER; tries++) {
    const cx = 1 + ((r() * (NX - 2)) | 0);
    const cz = 3 + ((r() * (NZ - 6)) | 0);
    if (!isolated(cx, cz)) continue;
    cell[cz * NX + cx] = OBSTACLE;
    made++;
  }

  /* Ten posts, one per band of the corridor so they come up in step with the
     cards going past, alternating sides of the centreline so they read as
     objects standing in a room rather than as a fence down the middle of it.
     They are blocked for the planner as well as drawn: a post is a thing in
     the room, and a route that goes through one is a route that has not
     noticed the project. */
  const posts = [];
  for (let p = 0; p < PROJECTS; p++) {
    const side = (p & 1) ? 1 : -1;
    const cx = Math.round(NX * (0.5 + side * (0.13 + 0.22 * r())));
    const cz = NZ - 5 - Math.round(p * (NZ - 10) / (PROJECTS - 1));
    const at = nearestOpen(cx, cz);
    if (at < 0) continue;
    cell[at] = MARKER;
    posts.push(at);
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
        // A diagonal is only refused when both of the cells it squeezes
        // between are occupied. Refusing it whenever either one is turns
        // every inside corner into a two-step detour and the plan comes out
        // looking like it was drawn on graph paper by hand.
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

  /* The route runs the way the reader is travelling: it starts at the near
     edge, closest to the eye, and ends at the far one. Both ends sit off the
     centreline and on opposite sides of it, so the plan has to cross the map
     rather than run down the middle of it and never meet anything. */
  const start = nearestOpen(Math.round(NX * 0.22), NZ - 2);
  const goal = nearestOpen(Math.round(NX * 0.78), 1);
  const cells = plan(start, goal);

  /* Line of sight between two cells, sampled at a third of a cell so nothing
     thinner than an obstacle can be stepped over. */
  function sight(a, b) {
    const ax = a % NX, az = (a / NX) | 0, bx = b % NX, bz = (b / NX) | 0;
    const n = Math.max(Math.abs(bx - ax), Math.abs(bz - az)) * 3;
    for (let k = 1; k < n; k++) {
      const t = k / n;
      const x = Math.round(ax + (bx - ax) * t), z = Math.round(az + (bz - az) * t);
      if (cell[z * NX + x] !== FREE) return false;
    }
    return true;
  }

  /* The cell path kept only at its corners. Every cell in the middle of a
     straight run lies exactly on the chord between that run's ends, so
     keeping it changes nothing about the strand and costs the arc-length
     sampler a longer table -- and that table is walked from the start again
     for every single point it places. */
  const staircase = [];
  for (let i = 0; i < cells.length; i++) {
    if (i > 0 && i < cells.length - 1) {
      const a = cells[i - 1], b = cells[i], c = cells[i + 1];
      if ((b % NX) - (a % NX) === (c % NX) - (b % NX) &&
          ((b / NX) | 0) - ((a / NX) | 0) === ((c / NX) | 0) - ((b / NX) | 0)) continue;
    }
    staircase.push(new THREE.Vector3(wx(cells[i] % NX), floorY + PLAN_LIFT, wz((cells[i] / NX) | 0)));
  }

  /* Shortcut: from each waypoint kept, the furthest cell further along that
     can still see it. What survives is the sequence of straight runs the
     staircase was approximating all along. */
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

  /* Two rounds of Chaikin over those runs. A shortcut path is drivable but
     its corners are instantaneous changes of heading, which no base executes;
     rounding them is what makes the second strand read as something that was
     driven rather than something that was computed. */
  for (let pass = 0; pass < 2 && curve.length > 2; pass++) {
    const out = [curve[0]];
    for (let i = 0; i < curve.length - 1; i++) {
      out.push(curve[i].clone().lerp(curve[i + 1], 0.25),
               curve[i].clone().lerp(curve[i + 1], 0.75));
    }
    out.push(curve[curve.length - 1]);
    curve = out;
  }

  /* Then thinned again, for the same reason the staircase was: a vertex the
     line would pass within a centimetre of anyway is a vertex the sampler
     pays for on every point and the eye never sees, and a centimetre is
     under the jitter the sampler adds. */
  const run = [];
  if (curve.length) {
    run.push(curve[0]);
    for (let i = 1; i < curve.length - 1; i++) {
      const a = run[run.length - 1], b = curve[i], c = curve[i + 1];
      const ax = c.x - a.x, az = c.z - a.z;
      const len = Math.hypot(ax, az);
      const off = len < 1e-6 ? 0 : Math.abs((b.x - a.x) * az - (b.z - a.z) * ax) / len;
      if (off > 0.012) run.push(b);
    }
    run.push(curve[curve.length - 1]);
  }

  /* Eight poses on the executed curve, evenly spaced by arc length rather
     than by index so they do not bunch wherever Chaikin left vertices close
     together: the two ends, and the six the base passes through between
     them. Yaw is the tangent, and the triad's own x axis is laid along it,
     which is the axis a mobile base drives down. */
  const cum = [0];
  for (let i = 1; i < run.length; i++) cum.push(cum[i - 1] + run[i].distanceTo(run[i - 1]));
  const total = cum[cum.length - 1] || 1;
  const poses = [];
  for (let k = 0; k < 8; k++) {
    const s = (k / 7) * total;
    let i = 1;
    while (i < cum.length - 1 && cum[i] < s) i++;
    const a = run[i - 1], b = run[i];
    const t = Math.min(1, Math.max(0, (s - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1])));
    poses.push(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t,
               Math.atan2(-(b.z - a.z), b.x - a.x));
  }

  /* The grid, flattened once. Occupied cells carry their own height so the
     costmap has relief -- a field of columns all the same height reads as a
     texture, and one that varies reads as a room with different things in
     it. */
  const heights = rng(0x5A1D);
  const open = [], solid = [], stands = [];
  for (let cz = 0; cz < NZ; cz++)
    for (let cx = 0; cx < NX; cx++) {
      const id = cz * NX + cx, x = wx(cx), z = wz(cz);
      if (cell[id] === OBSTACLE) solid.push(x, z, 0.10 + heights() * 0.24);
      else if (cell[id] === MARKER) stands.push(x, z);
      else open.push(x, z);
    }
  const freeXZ = Float32Array.from(open);
  const occXZH = Float32Array.from(solid);
  const postXZ = Float32Array.from(stands);
  const nFree = freeXZ.length >> 1, nOcc = occXZH.length / 3;

  return function fill(pos, kind, size, count) {
    const { S, P, F } = bands(pos, kind, size, count);

    /* A free cell is one point by definition and the cell count is fixed by
       the resolution, so the only knob the grid has for spending its budget
       is how finely a column is sampled. Capped, because past about two dozen
       rungs on a 20 cm column the extra matter is brightness rather than
       shape and pad() spends it better, spreading each cell into a cell. */
    const rungs = Math.max(3, Math.min(26,
      Math.floor((S.share(0.70) - nFree) / Math.max(1, nOcc))));
    for (let i = 0; i < freeXZ.length; i += 2)
      S.put(freeXZ[i], floorY, freeXZ[i + 1], STRUCTURE, 0.5);
    for (let i = 0; i < occXZH.length; i += 3) {
      const h = occXZH[i + 2];
      for (let k = 0; k < rungs; k++)
        S.put(occXZH[i], floorY + h * k / (rungs - 1), occXZH[i + 1], STRUCTURE, 0.9);
    }

    // One emphatic point on top of each post, because ten of anything in a
    // field of thousands needs a reason to be found.
    const tall = Math.max(10, Math.min(72, Math.floor(S.share(0.55) / PROJECTS)));
    for (let i = 0; i < postXZ.length; i += 2)
      for (let k = 0; k < tall; k++)
        S.put(postXZ[i], floorY + POST * k / (tall - 1), postXZ[i + 1],
              STRUCTURE, k === tall - 1 ? 1.8 : 0.85);
    // A third of a cell, so what is left over fills the cells it came from
    // rather than blurring across the ones next door.
    S.pad(0.05);

    polyline(staircase, P.share(0.40), P, PATH, 0.70, 0.012, 0x2A17);
    polyline(run, P.share(1.0), P, PATH, 1.50, 0.016, 0x2B44);
    P.pad(0.02);

    const arms = Math.floor(F.room / (poses.length / 4 + 1));
    for (let i = 0; i < poses.length; i += 4)
      axisTriad(poses[i], poses[i + 1], poses[i + 2], poses[i + 3], arms, F, 0.16, 1.0);
    F.pad(0.01);
  };
}
