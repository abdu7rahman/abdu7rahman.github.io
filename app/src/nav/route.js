import { Search } from "../lab/demos/astar.js";

/* A route across the building, on the building's own map, with the
 * building's own search.
 *
 * The A* in lab/demos/astar.js is the one the Search cell puts on a bench
 * with its frontier crawling across a 2.7 m grid. This is the same class,
 * given the 244 x 833 grid of the actual floor. That is the whole idea: the
 * thing demonstrated in a cell is the thing the site runs to get you to the
 * cell. Nothing here reimplements it.
 *
 * Three pieces on top of the search, and each of them is there because the
 * raw output of a grid search is not something to walk:
 *
 *   - the goal is snapped to somewhere a body of this radius fits, because a
 *     click lands on a bench as often as on the floor;
 *   - cells are priced by clearance, so the path runs down the middle of the
 *     aisle rather than along the guarding, which is free -- the distance
 *     field is already there;
 *   - the result is string-pulled, because an eight-connected path is a
 *     staircase and a machine that walks a staircase down an empty aisle
 *     looks like it is following a grid, which it is, and which is the one
 *     thing it should not look like.
 */

/* Nearest cell a body of `radius` fits in, breadth-first from the ask. Used
   on both ends: a click on a bench should walk you to the front of the
   bench, and a guide standing half inside a doorway should still be able to
   plan out of it. Returns null if nothing within `limit` metres works. */
export function nearestFree(grid, x, z, radius, limit = 6) {
  const i0 = grid.col(x), j0 = grid.row(z);
  const R = Math.ceil(limit / grid.cell);
  let best = -1, bestD = Infinity;
  for (let r = 0; r <= R; r++) {
    // Ring by ring, so the first ring with anything in it holds the answer
    // and the search stops one ring later rather than sweeping a disc.
    let found = false;
    for (let dj = -r; dj <= r; dj++) {
      for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const i = i0 + di, j = j0 + dj;
        if (!grid.inside(i, j)) continue;
        const k = j * grid.w + i;
        if (grid.dist[k] <= radius) continue;
        found = true;
        const d = di * di + dj * dj;
        if (d < bestD) { bestD = d; best = k; }
      }
    }
    if (found && r > 0) break;
  }
  return best < 0 ? null : [best % grid.w, (best / grid.w) | 0];
}

/* Is the straight segment between two world points walkable by a body of
 * this radius?
 *
 * Sampled along the segment at half a cell, against the distance field
 * rather than against the occupancy. That is exact enough for the purpose
 * and much stronger than a supercover line over the cells: the field already
 * knows how far the nearest obstacle is, so one sample rules out a whole
 * disc of radius `clearance` around it -- which is why the step can be as
 * coarse as it is and still not miss a post.
 */
export function visible(grid, ax, az, bx, bz, radius) {
  const dx = bx - ax, dz = bz - az;
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return grid.clearance(ax, az) > radius;
  let t = 0;
  while (t < len) {
    const c = grid.clearance(ax + dx * (t / len), az + dz * (t / len));
    if (c <= radius) return false;
    // Advance by the clearance we just proved, so open ground costs one
    // sample and a tight gap costs many. Floor so a grazing pass still steps.
    t += Math.max(grid.cell * 0.5, c - radius);
  }
  return grid.clearance(bx, bz) > radius;
}

/* String-pulling: keep a waypoint only when the corner it turns is one the
   body could not have cut. Greedy from the start, which is the standard
   funnel shortcut on a grid and gives the same answer as the full funnel for
   a path this shape at a fraction of the code. */
export function shortcut(grid, pts, radius) {
  if (pts.length < 3) return pts.slice();
  const out = [pts[0]];
  let i = 0;
  while (i < pts.length - 1) {
    let j = pts.length - 1;
    for (; j > i + 1; j--) {
      if (visible(grid, pts[i][0], pts[i][1], pts[j][0], pts[j][1], radius)) break;
    }
    out.push(pts[j]);
    i = j;
  }
  return out;
}

/* The whole thing: two world points in, a list of world waypoints out.
 *
 * `budget` caps the number of expansions, and it is a real cap rather than a
 * formality -- the grid is 203,252 cells and an unreachable goal would
 * otherwise expand every free one of them on the frame it is asked for. The
 * building's longest honest walk, door to office, expands far fewer than
 * this; the number is set from that measurement rather than guessed.
 */
export function route(grid, from, to, {
  radius = 0.30, soft = 1.1, peak = 5, budget = 120000, smooth = true
} = {}) {
  const s = nearestFree(grid, from[0], from[1], radius);
  const g = nearestFree(grid, to[0], to[1], radius);
  if (!s || !g) return { ok: false, why: s ? "goal" : "start", path: [], expanded: 0 };

  const walls = grid.walls(radius, grid._walls);
  grid._walls = walls;
  const costs = grid.costs(radius, soft, peak, grid._costs);
  grid._costs = costs;

  const search = new Search(grid.w, grid.h, walls, costs);
  search.start(s[0], s[1], g[0], g[1]);
  search.step(budget);
  if (!search.found) {
    return { ok: false, why: search.done ? "unreachable" : "budget",
             path: [], expanded: search.expanded };
  }
  let pts = search.path.map(([i, j]) => [grid.worldX(i), grid.worldZ(j)]);
  const raw = pts.length;
  if (smooth) pts = shortcut(grid, pts, radius);
  // The caller asked to get to a point, not to the centre of the cell the
  // point fell in, so long as the last hop is walkable.
  const last = pts[pts.length - 1];
  if (visible(grid, last[0], last[1], to[0], to[1], radius)) pts[pts.length - 1] = [to[0], to[1]];
  return { ok: true, path: pts, raw, expanded: search.expanded,
           length: pathLength(pts) };
}

export function pathLength(pts) {
  let d = 0;
  for (let i = 1; i < pts.length; i++) {
    d += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  }
  return d;
}

/* The same search, spread over frames, so the frontier is something you
 * watch.
 *
 * The one-shot above costs 15 ms for the length of the building, which is a
 * quarter of a frame and would show as a hitch the moment somebody clicks.
 * More to the point, a search that completes between two frames is a search
 * nobody sees, and this building's first cell is about watching one happen.
 * So the guide's own planning runs at a budget per frame and the expanded
 * set is drawn on the slab while it does.
 */
export class Router {
  constructor(grid) {
    this.grid = grid;
    this.search = null;
    this.done = false;
    this.found = false;
    this.path = [];
    this.radius = 0.3;
  }

  begin(from, to, { radius = 0.30, soft = 1.1, peak = 5 } = {}) {
    const g = this.grid;
    this.radius = radius;
    this.done = false; this.found = false; this.path = []; this.goal = to;
    const s = nearestFree(g, from[0], from[1], radius);
    const e = nearestFree(g, to[0], to[1], radius);
    if (!s || !e) { this.done = true; this.why = s ? "goal" : "start"; return false; }
    g._walls = g.walls(radius, g._walls);
    g._costs = g.costs(radius, soft, peak, g._costs);
    this.search = new Search(g.w, g.h, g._walls, g._costs);
    this.search.start(s[0], s[1], e[0], e[1]);
    return true;
  }

  step(budget = 4000) {
    if (this.done || !this.search) return this.done;
    this.search.step(budget);
    if (!this.search.done) return false;
    this.done = true;
    this.found = this.search.found;
    if (this.found) {
      const g = this.grid;
      let pts = this.search.path.map(([i, j]) => [g.worldX(i), g.worldZ(j)]);
      this.raw = pts.length;
      pts = shortcut(g, pts, this.radius);
      const last = pts[pts.length - 1];
      if (this.goal && visible(g, last[0], last[1], this.goal[0], this.goal[1], this.radius)) {
        pts[pts.length - 1] = [this.goal[0], this.goal[1]];
      }
      this.path = pts;
      this.length = pathLength(pts);
    } else this.why = "unreachable";
    return true;
  }

  /* The cells expanded so far, for drawing. A view onto the search's own
     state array rather than a copy. */
  get state() { return this.search ? this.search.state : null; }
  get expanded() { return this.search ? this.search.expanded : 0; }
}
