/* The search bay's course: how a map gets laid, what a planner is allowed to
 * call free, and where the two ends go.
 *
 * Its own file because two things need it and they run in different places.
 * lab/SearchRig.jsx lays courses in a browser; tools/test_search.mjs drives
 * the same courses through the same physics in node to count how many of
 * them the machine actually gets across. A copy of this in the harness would
 * be a harness that tests a different generator than the one that ships.
 */

// Mulberry32: four lines, a full 2^32 period, and reproducible from a seed.
export function seeded(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* Three to five slabs at grid-aligned positions with a gap left through
 * each, from a seeded generator so a reader who comes back to this bay does
 * not get the same course twice and the sequence is still reproducible.
 *
 * Three numbers here are the robot's rather than nice ones, and all three
 * arrived the same way: a course is only a course if the machine can get
 * across it, and with the drive on physics that stopped being an opinion.
 * Measured over 400 seeded maps, with the reachable fraction being how often
 * an inflated map still had a path across it at all:
 *
 *   gap 3 cells, bars anywhere      20%
 *   gap 4-6, bars anywhere          23%
 *   gap 4-6, parallel bars >= 4     32%
 *   ... and the same again with the ends chosen properly   100%
 *
 * So: the gap is four to six cells, which is 0.40 to 0.60 m, because one
 * cell of inflation either side costs 0.20 m of it and pure pursuit needs
 * what is left to be wider than the machine. Parallel slabs stand at least
 * four cells apart, because two closer than that have an inflated corridor
 * between them with nothing down the middle. And a gap stays a gap: the
 * cells of every hole are cleared after all the slabs are down, so a slab
 * laid across an earlier one cannot seal it.
 *
 * The last row of that table is the ends() below, not this function,
 * and it is the one that did the work -- see there.
 */
export function layout(rand, wall, nx, ny) {
  wall.fill(0);
  const bars = 3 + Math.floor(rand() * 3);
  const rows = [], cols = [], holes = [];
  for (let b = 0; b < bars; b++) {
    const horizontal = rand() < 0.5;
    const lines = horizontal ? rows : cols;
    const n = horizontal ? ny : nx, span = horizontal ? nx : ny;
    let line = -1;
    for (let t = 0; t < 16; t++) {
      const c = 3 + Math.floor(rand() * (n - 6));
      if (lines.every(l => Math.abs(l - c) >= 4)) { line = c; break; }
    }
    // Nowhere left to stand: three slabs on a bench this size is already a
    // course, so a fourth that cannot be placed is simply not placed.
    if (line < 0) continue;
    lines.push(line);
    const gw = 4 + Math.floor(rand() * 3);
    const gap = 2 + Math.floor(rand() * (span - 4 - gw));
    for (let k = 0; k < span; k++) {
      const i = horizontal ? line * nx + k : k * nx + line;
      if (k < gap || k >= gap + gw) wall[i] = 1; else holes.push(i);
    }
  }
  for (const i of holes) wall[i] = 0;
  // The rim, so a path cannot leave the bench.
  for (let x = 0; x < nx; x++) { wall[x] = 1; wall[(ny - 1) * nx + x] = 1; }
  for (let y = 0; y < ny; y++) { wall[y * nx] = 1; wall[y * nx + nx - 1] = 1; }
}

/* The obstacle layer, dilated by one cell, which is what the planner
 * searches over.
 *
 * A* plans for a point and the thing that drives the path is 0.178 m wide on
 * a 0.10 m grid. Without this, a path is free to run along a wall face: the
 * cell centre is 0.05 m off it and the machine is 0.089 m to its own edge,
 * so the robot ends up 39 mm inside the wall. The plot looked fine, because
 * a plot of a point path is fine. One cell of dilation puts the nearest wall
 * face 0.15 m from any cell the planner may use, and one cell is the
 * smallest honest number here -- two would close every gap this course
 * generates.
 *
 * What that leaves is 46 mm, not the 61 this used to claim: 61 is against
 * the base plate's half-width and the number that matters is the swept
 * radius, which lab/TurtleBot.jsx measures off the vendor's own mesh at
 * 0.104 m. Measured in the page over 500 simulated seconds of the search
 * cell driving its own plans, the worst the machine came to a wall was
 * 46 mm and it was never inside one -- which is the design's own prediction
 * to the millimetre, and is the answer to a report that this cell collides.
 * It does not. It passes close, because one cell of collar on a 0.10 m grid
 * is as close as a 0.104 m robot can be planned for without closing the
 * course.
 */
export function inflate(wall, out, nx, ny) {
  out.set(wall);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      if (wall[j * nx + i]) continue;
      let hit = 0;
      for (let dj = -1; dj <= 1 && !hit; dj++)
        for (let di = -1; di <= 1; di++) {
          const y = j + dj, x = i + di;
          if (x < 0 || y < 0 || x >= nx || y >= ny) continue;
          if (wall[y * nx + x]) { hit = 1; break; }
        }
      if (hit) out[j * nx + i] = 1;
    }
  }
}

/* Breadth first over four-connected free cells, returning the cell it got
   furthest from the seed and how many it reached. */
function sweep(free, nx, ny, seed, dist, queue) {
  dist.fill(0xffff);
  dist[seed] = 0; queue[0] = seed;
  let head = 0, tail = 1, far = seed;
  while (head < tail) {
    const c = queue[head++];
    far = c;
    const i = c % nx, j = (c - i) / nx;
    if (i + 1 < nx) { const k = c + 1;  if (!free[k] && dist[k] === 0xffff) { dist[k] = dist[c] + 1; queue[tail++] = k; } }
    if (i > 0)      { const k = c - 1;  if (!free[k] && dist[k] === 0xffff) { dist[k] = dist[c] + 1; queue[tail++] = k; } }
    if (j + 1 < ny) { const k = c + nx; if (!free[k] && dist[k] === 0xffff) { dist[k] = dist[c] + 1; queue[tail++] = k; } }
    if (j > 0)      { const k = c - nx; if (!free[k] && dist[k] === 0xffff) { dist[k] = dist[c] + 1; queue[tail++] = k; } }
  }
  return [far, tail];
}

/* Where the start and the goal go: the two ends of the longest run through
 * the largest connected piece of free floor.
 *
 * This bay used to take the first free cell scanning from the top and the
 * last scanning from the bottom, and that is where four in five of its
 * courses went. With the slabs inflated, the first free cell from the top is
 * usually in a pocket the rim and the nearest slab have closed off, so the
 * search ran, expanded the pocket, reported unreachable, and the bay threw
 * the map away and laid another -- 400 seeded maps, 80% discarded. A reader
 * watching would have seen the course flicker.
 *
 * Flood fill for the biggest component, then the standard two-sweep
 * approximation of its diameter: breadth first from anywhere in it to find
 * the cell furthest away, then breadth first from that one. On 400 maps
 * this reaches 100%, with a mean path of 32 cells across a mean component
 * of 188. It also puts the ends somewhere different every time, which the
 * corner-to-corner rule never did.
 */
export function ends(free, nx, ny) {
  const n = nx * ny;
  const dist = new Uint16Array(n), queue = new Int32Array(n);
  const seen = new Uint8Array(n);
  let bestN = 0, bestSeed = -1;
  for (let s = 0; s < n; s++) {
    if (free[s] || seen[s]) continue;
    const [, reached] = sweep(free, nx, ny, s, dist, queue);
    for (let k = 0; k < reached; k++) seen[queue[k]] = 1;
    if (reached > bestN) { bestN = reached; bestSeed = s; }
  }
  if (bestSeed < 0 || bestN < 2) return null;
  const [a] = sweep(free, nx, ny, bestSeed, dist, queue);
  const [b] = sweep(free, nx, ny, a, dist, queue);
  return [a % nx, Math.floor(a / nx), b % nx, Math.floor(b / nx)];
}
