/* A height field, and four costs over it that disagree about what a good
 * path is.
 *
 * The terrain is value noise on a grid -- three octaves, cosine
 * interpolated, from a seed, so a given seed always gives the same ground. It is
 * not a picture of terrain: the mesh on the bench is displaced by these exact
 * samples and the Go2's feet are placed on them, so a path that looks like it
 * climbs is one that climbs.
 *
 * The four costs are the point of the bay. They are functions of the same
 * field and they are genuinely different questions:
 *
 *   distance   nothing but length. The straight line, terrain ignored.
 *   height     prefer low ground. Follows valleys and will go a long way
 *              round to stay in one.
 *   slope      prefer flat. Contours across a hillside instead of climbing
 *              it, which is what a legged base actually wants.
 *   step       prefer smooth. Penalises the largest single change between
 *              neighbouring cells rather than the average, so it refuses
 *              ledges a slope average would let through.
 *
 * Every one is floored at 1, because A* here uses an octile heuristic and a
 * cell cheaper than its own distance makes that heuristic inadmissible --
 * see the note on Search's constructor.
 */

function fade(t) { return 0.5 - 0.5 * Math.cos(t * Math.PI); }

function hash2(ix, iy, seed) {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function value(x, y, seed) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = fade(x - ix), fy = fade(y - iy);
  const a = hash2(ix, iy, seed), b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed), d = hash2(ix + 1, iy + 1, seed);
  return (a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fy;
}

/* Metres of relief across the bench, and the number is chosen for the four
   cost functions rather than for the picture. At 0.09 the ground was real
   and the four answers were nearly the same line: a field that gentle has
   no ledge for the step cost to refuse and no hillside for the slope cost to
   contour across, so the bay showed four colours lying on top of each other.
   0.16 over the course's 2.85 m is a five and a half per cent grade in the
   large and considerably steeper across the third octave, which is ground a
   legged base has to think about and still not ground it would fall off --
   a Go2 stands about 0.32 m at the hip. It read seven per cent here until
   the bench grew and the course with it; the relief did not move, so the
   grade did. */
export const RELIEF = 0.16;

/* The ground's own grid, here rather than in the rig that draws it.
 *
 * It was in lab/TerrainRig.jsx and copied into tools/test_crawl.mjs, and the
 * copies drifted: the cell went from 0.075 m to 0.092 when the benches grew,
 * the harness kept 0.075, and it went on walking a 2.33 by 2.70 m course
 * while the site shipped 2.85 by 3.31. The harness's own comment says what
 * that is -- "a harness whose defaults drift from the rig is a harness that
 * tests a robot the site does not ship" -- and the only way to mean it is
 * one definition.
 *
 * Same cell count either side of the resize, because the search over it and
 * the height field MuJoCo integrates both cost what the count says and
 * nothing about the extent. */
export const NX = 31, NY = 36, CELL = 0.092;
export const COURSE_X = NX * CELL;   // 2.852
export const COURSE_Y = NY * CELL;   // 3.312

export function heights(nx, ny, seed = 1337) {
  const h = new Float32Array(nx * ny);
  let lo = Infinity, hi = -Infinity;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const x = i / nx, y = j / ny;
    /* Three octaves, not two. The third is what puts local structure in --
       the abrupt neighbour-to-neighbour changes the step cost exists to
       refuse. With two octaves the worst step and the average slope were
       almost the same number everywhere, which made two of the four cost
       functions the same question asked twice. */
    const v = value(x * 3.1, y * 3.4, seed) * 0.56
            + value(x * 7.3, y * 8.1, seed + 91) * 0.29
            + value(x * 15.7, y * 17.3, seed + 613) * 0.15;
    h[j * nx + i] = v;
    if (v < lo) lo = v; if (v > hi) hi = v;
  }
  // Normalised to the full relief, so the four costs see the same spread
  // whatever the noise happened to produce.
  const k = RELIEF / Math.max(1e-6, hi - lo);
  for (let i = 0; i < h.length; i++) h[i] = (h[i] - lo) * k;
  return h;
}

const NB4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/* Slope and step at a cell, in metres per cell and metres. Both are taken
   over the four orthogonal neighbours: a diagonal neighbour is 1.41 cells
   away and mixing the two without dividing by the distance is the classic
   way to make a slope field that is quietly anisotropic. */
function local(h, nx, ny, i, j) {
  let sum = 0, n = 0, worst = 0;
  for (const [dx, dy] of NB4) {
    const x = i + dx, y = j + dy;
    if (x < 0 || y < 0 || x >= nx || y >= ny) continue;
    const d = Math.abs(h[y * nx + x] - h[j * nx + i]);
    sum += d; n++; if (d > worst) worst = d;
  }
  return [n ? sum / n : 0, worst];
}

export const COSTS = [
  { id: "distance", label: "distance",
    build: (h, nx, ny) => new Float32Array(nx * ny).fill(1) },
  { id: "height", label: "low ground",
    build: (h, nx, ny) => {
      const c = new Float32Array(nx * ny);
      for (let i = 0; i < c.length; i++) c[i] = 1 + (h[i] / RELIEF) * 3.2;
      return c;
    } },
  { id: "slope", label: "flat ground",
    build: (h, nx, ny) => {
      const c = new Float32Array(nx * ny);
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const [avg] = local(h, nx, ny, i, j);
        c[j * nx + i] = 1 + (avg / (RELIEF * 0.25)) * 3.6;
      }
      return c;
    } },
  { id: "step", label: "no ledges",
    build: (h, nx, ny) => {
      const c = new Float32Array(nx * ny);
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const [, worst] = local(h, nx, ny, i, j);
        // Cubed, so a ledge is refused rather than merely discouraged: the
        // difference between this and the slope field is entirely in how
        // hard the worst case is punished relative to the average.
        const u = worst / (RELIEF * 0.30);
        c[j * nx + i] = 1 + u * u * u * 4.0;
      }
      return c;
    } }
];
