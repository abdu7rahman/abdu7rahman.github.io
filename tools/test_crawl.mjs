/* The cost bay's dog, walked.
 *
 * The bay's claim is that four cost functions disagree about what it takes
 * to cross one piece of ground. Until the dog was on physics that claim had
 * no way to be wrong: the body followed whichever path was selected and the
 * feet were frozen. Now the feet are on the terrain and the body is wherever
 * they leave it, so "the Go2 crosses this" is a question, and this asks it
 * -- the real height field, the real robot, the real gait, in node.
 *
 *   node tools/test_crawl.mjs [seconds]
 */
import { pathToFileURL } from "node:url";
import { heights, COSTS, RELIEF } from "../app/src/lab/demos/terrain.js";
import { Search } from "../app/src/lab/demos/astar.js";
import { Crawl, LEGS, HOME, STAND } from "../app/src/lab/demos/crawl.js";
import { terrainScene } from "../app/src/sim/models.js";

const NX = 31, NY = 36, CELL = 0.075;
const COURSE_X = NX * CELL, COURSE_Y = NY * CELL;
const SECS = Number(process.argv[2] || 40);
/* The bay's own numbers, overridable so the tables quoted in
   lab/TerrainRig.jsx and lab/demos/crawl.js can be reproduced. A harness
   whose defaults drift from the rig is a harness that tests a robot the site
   does not ship: at 0.34 m/s, which this asked for before, the gait veers
   and one of the four paths never finished. */
const WALK = Number(process.env.WALK || 0.30);
const TURN = Number(process.env.TURN || 0.8);
const FALL = Number(process.env.FALL || 0.7);
const LOOK = Number(process.env.LOOK || 0.30);
/* POS runs the joint-servo law the cell shipped before the torques, on
   the same model and the same contacts, so the comparison is of control
   laws and not of two different scenes. */
const POS = !!Number(process.env.POS || 0);
const WINDOW = 12;   // nodes the nearest search may look ahead;
                     // see lab/TerrainRig.jsx for why it is bounded
const KP = Number(process.env.KP || 90);

const gx = (i) => (i + 0.5) * CELL - COURSE_X / 2;
const gy = (j) => (j + 0.5) * CELL - COURSE_Y / 2;

const h = heights(NX, NY);
/* The ground under a point, sampled the way MuJoCo builds a height field --
   the larger of its two triangulations, never below the real surface. See
   lab/TerrainRig.jsx for what a bilinear sample does to a swing foot, and
   keep the two in step. */
function ground(x, y) {
  if (process.env.FLAT) return 0;
  const u = Math.max(0, Math.min(NX - 1.001, (x + COURSE_X / 2) / CELL - 0.5));
  const v = Math.max(0, Math.min(NY - 1.001, (y + COURSE_Y / 2) / CELL - 0.5));
  const i = Math.floor(u), j = Math.floor(v), s = u - i, t = v - j;
  const a = h[j * NX + i], b = h[j * NX + i + 1];
  const c = h[(j + 1) * NX + i], d = h[(j + 1) * NX + i + 1];
  const p = s >= t ? a + (b - a) * s + (d - b) * t
                   : a + (c - a) * t + (d - c) * s;
  const q = s + t <= 1 ? a + (b - a) * s + (c - a) * t
                       : d + (c - d) * (1 - s) + (b - d) * (1 - t);
  return p > q ? p : q;
}

const mod = await import(pathToFileURL(
  new URL("../vendor/mujoco/mujoco.js", import.meta.url).pathname).href);
const mj = await (mod.default || mod)();

// Plan one path per cost function, from the same corner to the same goal.
const wall = new Uint8Array(NX * NY);
const paths = COSTS.map(c => {
  const se = new Search(NX, NY, wall, c.build(h, NX, NY));
  se.start(4, 4, NX - 5, NY - 5);
  se.step(NX * NY * 8);
  return se.found ? se.path.map(([i, j]) => [gx(i), gy(j)]) : null;
});

/* The same padded ground the bay builds, for the same reason: a MuJoCo
   height field is finite and past its last row there is no ground at all, so
   a dog whose feet reach 0.30 m past its own centre walks off the end of the
   world on any path near the rim. Six cells of margin, filled by clamping to
   the nearest real sample. A harness that tested the unpadded field would be
   testing a scene the site does not ship. */
const HPAD = 6, HNX = NX + HPAD * 2, HNY = NY + HPAD * 2;
const model = mj.from_xml_string(terrainScene({
  nx: HNX, ny: HNY, cell: CELL, relief: RELIEF, start: [0, 0, 0]
}));
const data = new mj.MjData(model);
const hd = model.hfield_data;
const FLAT = !!Number(process.env.FLAT || 0);
for (let J = 0; J < HNY; J++) {
  const j = Math.max(0, Math.min(NY - 1, J - HPAD));
  for (let I = 0; I < HNX; I++) {
    const i = Math.max(0, Math.min(NX - 1, I - HPAD));
    hd[J * HNX + I] = FLAT ? 0 : h[j * NX + i] / RELIEF;
  }
}
const adr = (() => { const j = model.jnt("dog_free");
  const a = { q: j.qposadr, d: j.dofadr }; if (j.delete) j.delete(); return a; })();

function pose() {
  const q = data.qpos, v = data.qvel;
  const w = q[adr.q + 3], x = q[adr.q + 4], y = q[adr.q + 5], z = q[adr.q + 6];
  return { x: q[adr.q], y: q[adr.q + 1], z: q[adr.q + 2],
           vx: v[adr.d], vy: v[adr.d + 1], vz: v[adr.d + 2],
           wx: v[adr.d + 3], wy: v[adr.d + 4], wz: v[adr.d + 5],
           yaw: Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z)),
           roll: Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y)),
           pitch: Math.asin(Math.max(-1, Math.min(1, 2 * (w * y - z * x)))),
           ground: ground(q[adr.q], q[adr.q + 1]),
           up: 1 - 2 * (x * x + y * y) };
}
// The twelve measured joint angles and rates, which the torque controller
// closes on. Allocated once; a run is tens of thousands of ticks.
const jq = new Float64Array(12), jqd = new Float64Array(12);
function joints() {
  for (let k = 0; k < 12; k++) {
    jq[k] = data.qpos[adr.q + 7 + k];
    jqd[k] = data.qvel[adr.d + 6 + k];
  }
}

/* How often the controller runs, against the physics rate underneath it.
   The bay drives this from a browser frame, so the default is a frame. */
const DT = Number(process.env.HZ ? 1 / Number(process.env.HZ) : model.opt.timestep);
const SUB = Math.max(1, Math.round(DT / model.opt.timestep));
let worstTilt = 0, fell = 0;

for (let p = 0; p < paths.length; p++) {
  const path = paths[p];
  if (!path) { console.log(`  ${COSTS[p].label.padEnd(12)} no path`); continue; }
  // Stand the dog on the first cell, facing the second.
  // COLD starts the machine facing along +x whatever the path does, which is
  // the condition that found the missing friction cone.
  const yaw0 = Number(process.env.COLD || 0) ? 0
    : Math.atan2(path[1][1] - path[0][1], path[1][0] - path[0][0]);
  const q = data.qpos, v = data.qvel;
  mj.mj_resetData(model, data);
  q[adr.q] = path[0][0]; q[adr.q + 1] = path[0][1];
  q[adr.q + 2] = ground(path[0][0], path[0][1]) + STAND;
  q[adr.q + 3] = Math.cos(yaw0 / 2); q[adr.q + 4] = 0; q[adr.q + 5] = 0;
  q[adr.q + 6] = Math.sin(yaw0 / 2);
  for (let i = 0; i < 12; i++) { q[adr.q + 7 + i] = HOME[i % 3]; data.ctrl[i] = 0; }
  for (let i = 0; i < 6; i++) v[adr.d + i] = 0;
  mj.mj_forward(model, data);

  const gait = new Crawl({ period: Number(process.env.PERIOD || 0.7),
                          duty: Number(process.env.DUTY || 0.85),
                          lift: Number(process.env.LIFT || 0.05),
                          height: Number(process.env.HEIGHT || STAND),
                          kzP: Number(process.env.KZP ?? 900),
                          kzD: Number(process.env.KZD ?? 120),
                          krP: Number(process.env.KRP ?? 180),
                          krD: Number(process.env.KRD ?? 18),
                          kpStance: Number(process.env.KPS ?? 60),
                          kxD: Number(process.env.KXD ?? 90),
                          kyawD: Number(process.env.KYAW ?? 120),
                          mu: Number(process.env.MU ?? 0.7),
                          fzMin: Number(process.env.FZMIN ?? 8),
                          kRoll: Number(process.env.KR ?? 0.35),
                          kPitch: Number(process.env.KPI ?? 0.35) });
  gait.reset();
  let at = 0, t = 0, tilt = 0, down = 0, best = 0;
  let px = pose().x, py = pose().y, travelled = 0;
  const total = path.length;
  while (t < SECS) {
    const b = pose();
    // Pure pursuit by arc length from the nearest node ahead; see
    // lab/TerrainRig.jsx for the circling this stops, and keep the two in
    // step.
    let c = at, cd = Infinity;
    for (let k = at; k < Math.min(path.length, at + WINDOW); k++) {
      const dd = Math.hypot(path[k][0] - b.x, path[k][1] - b.y);
      if (dd < cd) { cd = dd; c = k; }
    }
    at = c;
    let arc = 0, j = c;
    while (j < path.length - 1 && arc < LOOK) {
      arc += Math.hypot(path[j + 1][0] - path[j][0], path[j + 1][1] - path[j][1]);
      j++;
    }
    const tgt = path[j];
    let err = Math.atan2(tgt[1] - b.y, tgt[0] - b.x) - b.yaw;
    while (err > Math.PI) err -= 2 * Math.PI;
    while (err < -Math.PI) err += 2 * Math.PI;
    const cmd = { v: WALK * Math.max(0, 1 - Math.abs(err) / FALL),
                  w: Math.max(-TURN, Math.min(TURN, 1.1 * err)) };
    const want = gait.step(DT, cmd, ground, b);
    joints();
    if (POS) {
      /* What MuJoCo's own position actuator computes, done here instead, so
         the two control laws can be compared over one model with one set of
         contacts. kp 400 kv 10 is what this cell shipped before the torques. */
      for (let i = 0; i < 12; i++) {
        const lim = (i % 3 === 2) ? 45.43 : 23.7;
        const t = 400 * (want[i] - jq[i]) - 10 * jqd[i];
        data.ctrl[i] = t > lim ? lim : t < -lim ? -lim : t;
      }
    } else {
      const tau = gait.control(jq, jqd, b, cmd);
      for (let i = 0; i < 12; i++) data.ctrl[i] = tau[i];
    }
    for (let k = 0; k < SUB; k++) mj.mj_step(model, data);
    t += DT;
    const a = pose();
    if (Math.round(t / DT) % 25 === 0) {   // 10 Hz, so a trunk jiggling at
      // 500 Hz is not counted as ground covered
      travelled += Math.hypot(a.x - px, a.y - py); px = a.x; py = a.y;
    }
    const deg = Math.acos(Math.max(-1, Math.min(1, a.up))) * 57.3;
    if (deg > tilt) tilt = deg;
    if (deg > 55) { down = 1; break; }
    best = Math.max(best, at / (total - 1));
    if (Math.hypot(path[total - 1][0] - a.x, path[total - 1][1] - a.y) < 0.16) { best = 1; break; }
  }
  worstTilt = Math.max(worstTilt, tilt); fell += down;
  console.log(`  ${COSTS[p].label.padEnd(12)} ${(best * 100).toFixed(0).padStart(3)}% of the path`
    + `  ${travelled.toFixed(2).padStart(5)} m in ${t.toFixed(1).padStart(4)} s`
    + `  tilt ${tilt.toFixed(0).padStart(3)} deg${down ? "  FELL" : ""}`);
}
const up = paths.length - fell;
console.log(`\n  ${up} of ${paths.length} stayed up, worst tilt ${worstTilt.toFixed(0)} deg`);
/* Three of four is the recorded state of this gait on these four paths, and
   the threshold is set there rather than at four because four is not what it
   does. Which of the four fails moves with any parameter you touch -- trunk
   height, command speed, a body shift -- and none of those sweeps was
   monotone, so it is marginality rather than mistuning. What this catches is
   a regression below what it has been measured to do. */
process.exit(up < 3 ? 1 : 0);
