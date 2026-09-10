/* A*, stepped, so the expansion is something you watch rather than a result
 * that appears.
 *
 * This is the search the site's own Search section is about, run natively in
 * the building instead of drawn on a monitor: eight-connected, octile
 * heuristic, a binary heap for the open set, and a fixed number of pops per
 * frame so the frontier crawls across the bench at a speed a person can
 * follow. Nothing about it is a picture of a search. If it cannot reach the
 * goal it says so and the bay resets, which has to be possible or the rest
 * would not be honest.
 *
 * The heuristic is octile and not Euclidean, because the grid is
 * eight-connected: octile is the exact cost of the cheapest unobstructed
 * eight-connected path, so it is admissible and consistent and A* expands the
 * fewest nodes any correct heuristic can. Euclidean is admissible too but
 * loose on a grid that cannot move at arbitrary angles, and the difference is
 * visible here -- a looser heuristic is a wider blob of expanded cells, which
 * is exactly what this bay is showing.
 */
export const FREE = 0, WALL = 1, OPEN = 2, CLOSED = 3, PATH = 4, ENDS = 5;

const SQ2 = Math.SQRT2;
// dx, dy, cost. Diagonals cost sqrt(2) and are refused when either orthogonal
// neighbour is blocked, so the path never cuts a corner it could not drive.
const NB = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, SQ2], [1, -1, SQ2], [-1, 1, SQ2], [-1, -1, SQ2]
];

/* A binary min-heap keyed on f. A sorted array or a linear scan would both
   work at this size and both would be the wrong thing to show in a bay about
   search: the whole point of the open set is that the next node comes off it
   in log n. */
class Heap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(f, i) {
    const a = this.a; let k = a.length; a.push([f, i]);
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (a[p][0] <= a[k][0]) break;
      const t = a[p]; a[p] = a[k]; a[k] = t; k = p;
    }
  }
  pop() {
    const a = this.a; if (!a.length) return -1;
    const top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last;
      let k = 0;
      for (;;) {
        const l = k * 2 + 1, r = l + 1; let m = k;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === k) break;
        const t = a[m]; a[m] = a[k]; a[k] = t; k = m;
      }
    }
    return top[1];
  }
}

export function octile(ax, ay, bx, by) {
  const dx = Math.abs(ax - bx), dy = Math.abs(ay - by);
  return (dx + dy) + (SQ2 - 2) * Math.min(dx, dy);
}

export class Search {
  /* `cost` is optional and is a per-cell multiplier on the price of entering
     that cell, which is what turns one search into four different ones over
     the same ground. It must be at least 1 everywhere or the octile
     heuristic stops being admissible -- h is a distance, so a cell cheaper
     than distance means h can exceed the true remaining cost, and A* returns
     a path that is not the shortest without saying so. The cost bay builds
     its four fields with that floor and this is where the requirement
     lives. */
  constructor(w, h, wall, cost) {
    this.w = w; this.h = h;
    this.wall = wall;                       // Uint8Array, 1 where blocked
    this.cost = cost || null;               // Float32Array, >= 1, or null
    this.g = new Float32Array(w * h);
    this.from = new Int32Array(w * h);
    this.state = new Uint8Array(w * h);     // FREE / OPEN / CLOSED
    this.heap = new Heap();
    this.done = false; this.found = false;
    this.path = [];
    this.expanded = 0;
  }

  start(sx, sy, gx, gy) {
    this.g.fill(Infinity); this.from.fill(-1); this.state.fill(FREE);
    this.heap = new Heap();
    this.done = false; this.found = false; this.path = []; this.expanded = 0;
    this.sx = sx; this.sy = sy; this.gx = gx; this.gy = gy;
    const s = sy * this.w + sx;
    this.g[s] = 0; this.state[s] = OPEN;
    this.heap.push(octile(sx, sy, gx, gy), s);
  }

  /* One frame's worth. Returns how many it actually popped, which is fewer
     than asked for when the open set runs dry -- that is the unreachable
     case and it has to end the run rather than spin. */
  step(budget) {
    const { w, h, wall, g, from, state, heap } = this;
    let n = 0;
    while (n < budget && !this.done) {
      const i = heap.pop();
      if (i < 0) { this.done = true; this.found = false; break; }
      if (state[i] === CLOSED) continue;
      state[i] = CLOSED; n++; this.expanded++;
      const x = i % w, y = (i / w) | 0;
      if (x === this.gx && y === this.gy) {
        this.done = true; this.found = true;
        for (let k = i; k >= 0; k = from[k]) this.path.push([k % w, (k / w) | 0]);
        this.path.reverse();
        break;
      }
      for (const [dx, dy, c] of NB) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (wall[j]) continue;
        // No corner cutting: a diagonal needs both of its orthogonals clear.
        if (dx && dy && (wall[y * w + nx] || wall[ny * w + x])) continue;
        const ng = g[i] + c * (this.cost ? this.cost[j] : 1);
        if (ng < g[j]) {
          g[j] = ng; from[j] = i; state[j] = OPEN;
          heap.push(ng + octile(nx, ny, this.gx, this.gy), j);
        }
      }
    }
    return n;
  }
}
