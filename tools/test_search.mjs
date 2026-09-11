/* The search bay's drive, counted.
 *
 * The bay lays a course, searches it, and drives the path that comes out.
 * Once the drive is physics rather than arithmetic, "drives the path" stops
 * being a statement about the code and becomes a question about the machine:
 * a 0.178 m Burger on a 0.10 m grid, following a point path with pure
 * pursuit, either gets through the gaps or clips them. There is no way to
 * read that off the source.
 *
 * So this runs the real generator (lab/demos/course.js), the real search
 * (lab/demos/astar.js) and the real scene (sim/models.js) against the
 * vendored MuJoCo, over as many seeded courses as asked, and reports how
 * many arrived, how many clipped a wall on the way, and the worst clearance
 * any of them held. Node, headless, no browser: a hundred courses in about
 * the time one takes on screen.
 *
 *   node tools/test_search.mjs [runs] [seed]
 */
import { pathToFileURL } from "node:url";
import { seeded, layout, inflate, ends } from "../app/src/lab/demos/course.js";
import { Search } from "../app/src/lab/demos/astar.js";
import { wheeledScene, wheelsFor, BURGER } from "../app/src/sim/models.js";

const RUNS = Number(process.argv[2] || 40);
const SEED = Number(process.argv[3] || 0x5EA12C);

/* The bay's own numbers, imported by hand because the bay is a React
   component and this is not a browser. Kept in one block so a drift between
   the two is one diff rather than a hunt. */
const COURSE_X = 2.30, COURSE_Y = 2.70, CELL = 0.10;
const NX = Math.round(COURSE_X / CELL), NY = Math.round(COURSE_Y / CELL);
const WIN = 4, POOL = (WIN * 2 + 1) * (WIN * 2 + 1);
/* The bay's own lookahead, overridable so the table in
   lab/SearchRig.jsx can be reproduced. */
const LOOK = Number(process.env.LOOK || 0.12);
const KW = Number(process.env.KW || 3.2);
const SLOW = Number(process.env.SLOW || 1.2);
const FLOOR = Number(process.env.FLOOR || 0.12);
const ARRIVE = 0.09;
const DT = 1 / 60, LIMIT = 60;      // simulated seconds before a run is lost
const BODY = 0.089;                 // half width across the wheels

const gx = (i) => (i + 0.5) * CELL - COURSE_X / 2;
const gy = (j) => (j + 0.5) * CELL - COURSE_Y / 2;

const mod = await import(pathToFileURL(
  new URL("../vendor/mujoco/mujoco.js", import.meta.url).pathname).href);
const mj = await (mod.default || mod)();

const model = mj.from_xml_string(wheeledScene({
  starts: [[0, 0, 0]], walls: POOL, cell: CELL
}));
const data = new mj.MjData(model);
const adr = (() => {
  const h = model.jnt("tb0_free");
  const a = { q: h.qposadr, d: h.dofadr };
  if (h.delete) h.delete();
  return a;
})();
const mocap = new Map();
function mocapId(name) {
  let m = mocap.get(name);
  if (m === undefined) {
    const b = data.body(name); m = model.body_mocapid[b.id];
    if (b.delete) b.delete();
    mocap.set(name, m);
  }
  return m;
}
function setMocap(name, x, y, z) {
  const m = mocapId(name);
  data.mocap_pos[m * 3] = x;
  data.mocap_pos[m * 3 + 1] = y;
  data.mocap_pos[m * 3 + 2] = z;
}
function place(x, y, z, yaw) {
  const q = data.qpos, v = data.qvel;
  q[adr.q] = x; q[adr.q + 1] = y; q[adr.q + 2] = z;
  q[adr.q + 3] = Math.cos(yaw / 2); q[adr.q + 4] = 0;
  q[adr.q + 5] = 0; q[adr.q + 6] = Math.sin(yaw / 2);
  for (let i = 0; i < 6; i++) v[adr.d + i] = 0;
  mj.mj_forward(model, data);
}
function readPose() {
  const q = data.qpos;
  const w = q[adr.q + 3], z = q[adr.q + 6];
  return { x: q[adr.q], y: q[adr.q + 1],
           psi: Math.atan2(2 * w * z, 1 - 2 * z * z) };
}

/* The near window, written through to the pool. Every block that could
   possibly touch the machine before this runs again, and nothing else --
   which is the same simulation as writing all 621, at an eighth of the cost.
   See lab/SearchRig.jsx for why that is exact rather than approximate. */
function writeWalls(wall, x, y) {
  const ci = Math.floor((x + COURSE_X / 2) / CELL);
  const cj = Math.floor((y + COURSE_Y / 2) / CELL);
  let n = 0;
  for (let j = cj - WIN; j <= cj + WIN; j++) {
    if (j < 0 || j >= NY) continue;
    for (let i = ci - WIN; i <= ci + WIN; i++) {
      if (i < 0 || i >= NX) continue;
      if (!wall[j * NX + i]) continue;
      setMocap(`wall${n++}`, gx(i), gy(j), 0.05);
    }
  }
  for (let k = n; k < POOL; k++) setMocap(`wall${k}`, 0, 0, -5);
}

/* How close the machine came to any wall, as a distance between its own
   circle and the block's square. Negative is inside. */
function clearance(wall, x, y) {
  const ci = Math.floor((x + COURSE_X / 2) / CELL);
  const cj = Math.floor((y + COURSE_Y / 2) / CELL);
  let best = 9;
  for (let j = cj - 2; j <= cj + 2; j++) {
    if (j < 0 || j >= NY) continue;
    for (let i = ci - 2; i <= ci + 2; i++) {
      if (i < 0 || i >= NX) continue;
      if (!wall[j * NX + i]) continue;
      const dx = Math.max(0, Math.abs(x - gx(i)) - CELL / 2);
      const dy = Math.max(0, Math.abs(y - gy(j)) - CELL / 2);
      best = Math.min(best, Math.hypot(dx, dy) - BODY);
    }
  }
  return best;
}

const wall = new Uint8Array(NX * NY);
const free = new Uint8Array(NX * NY);
const search = new Search(NX, NY, free);
const rand = seeded(SEED);

let arrived = 0, clipped = 0, lost = 0, unreachable = 0;
let worst = 9, totalT = 0, totalLen = 0, totalTurn = 0;

for (let run = 0; run < RUNS; run++) {
  layout(rand, wall, NX, NY);
  inflate(wall, free, NX, NY);
  const e = ends(free, NX, NY);
  if (!e) { unreachable++; continue; }
  const [sx, sy, ex, ey] = e;
  search.start(sx, sy, ex, ey);
  search.step(NX * NY * 8);
  if (!search.found) { unreachable++; continue; }
  const pts = search.path.map(([i, j]) => [gx(i), gy(j)]);

  place(gx(sx), gy(sy), BURGER.tyre, Number(process.env.YAW0 || 0)
    ? Math.atan2(pts[1][1] - pts[0][1], pts[1][0] - pts[0][0]) : 0);
  writeWalls(wall, gx(sx), gy(sy));
  let at = 0, t = 0, hit = 0, near = 9, len = 0, turn = 0;
  let px = gx(sx), py = gy(sy), ppsi = readPose().psi;
  while (t < LIMIT) {
    const q = readPose();
    while (at < pts.length - 1 &&
           Math.hypot(pts[at][0] - q.x, pts[at][1] - q.y) < LOOK) at++;
    const tgt = pts[Math.min(at, pts.length - 1)];
    let err = Math.atan2(tgt[1] - q.y, tgt[0] - q.x) - q.psi;
    while (err > Math.PI) err -= 2 * Math.PI;
    while (err < -Math.PI) err += 2 * Math.PI;
    const w = Math.max(-BURGER.maxW, Math.min(BURGER.maxW, KW * err));
    const v = BURGER.maxV * Math.max(FLOOR, 1 - Math.abs(err) / SLOW);
    const [wl, wr] = wheelsFor(v, w);
    data.ctrl[0] = wl; data.ctrl[1] = wr;
    writeWalls(wall, q.x, q.y);
    for (let k = 0; k < Math.round(DT / model.opt.timestep); k++)
      mj.mj_step(model, data);
    t += DT;
    const p = readPose();
    len += Math.hypot(p.x - px, p.y - py); px = p.x; py = p.y;
    let dp = p.psi - ppsi;
    while (dp > Math.PI) dp -= 2 * Math.PI;
    while (dp < -Math.PI) dp += 2 * Math.PI;
    turn += Math.abs(dp); ppsi = p.psi;
    const c = clearance(wall, p.x, p.y);
    if (c < near) near = c;
    if (c < 0) hit++;
    const last = pts[pts.length - 1];
    if (Math.hypot(last[0] - p.x, last[1] - p.y) < ARRIVE) break;
  }
  const p = readPose();
  const last = pts[pts.length - 1];
  const ok = Math.hypot(last[0] - p.x, last[1] - p.y) < ARRIVE;
  if (ok) { arrived++; totalT += t; totalLen += len; totalTurn += turn; } else lost++;
  if (hit) clipped++;
  worst = Math.min(worst, near);
}

const n = RUNS - unreachable;
console.log(`look ${LOOK}  kw ${KW}  slow ${SLOW}  floor ${FLOOR}`);
console.log(`  courses      ${n} of ${RUNS} searchable`);
console.log(`  arrived      ${arrived}/${n}`);
console.log(`  lost         ${lost}/${n}`);
console.log(`  clipped      ${clipped}/${n} touched a wall`);
console.log(`  clearance    ${(worst * 1000).toFixed(0)} mm at the worst point`);
if (arrived) console.log(`  mean drive   ${(totalT / arrived).toFixed(1)} s, `
  + `${(totalLen / arrived).toFixed(2)} m, `
  + `${(totalTurn / arrived).toFixed(1)} rad of steering`);
process.exit(lost > n * 0.1 || clipped > n * 0.25 ? 1 : 0);
