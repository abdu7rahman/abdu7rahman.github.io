/* Would lanes be fair?
 *
 * Giving each controller its own concentric lane stops four machines on one
 * closed loop ever meeting, which is the whole problem. The cost is that the
 * lanes are not the same test: an inner lane has tighter corners. This asks
 * how much that costs, by running every controller in every lane and
 * comparing the spread across lanes against the spread across controllers.
 * If the lane effect is small next to the 8-to-89 mm the controllers already
 * differ by, lanes are fair enough; if it is not, they are not.
 *
 * Kinematic rather than MuJoCo: the question is geometry and control law, and
 * the unicycle here is the model MPPI rolls out internally anyway. */
import { purePursuit, stanley, MPPI, nearest, ahead } from
  '../app/src/lab/demos/controllers.js';
import { Local } from '../app/src/lab/demos/dwa.js';

const MAX_V = 0.22, MAX_W = 2.84;
const A0 = 0.97, B0 = 1.28, NN = 3.2;

function makePath(dA, dB) {
  const pts = [];
  for (let i = 0; i < 240; i++) {
    const t = (i / 240) * Math.PI * 2;
    const c = Math.cos(t), s = Math.sin(t);
    pts.push([(A0 + dA) * Math.sign(c) * Math.pow(Math.abs(c), 2 / NN),
              (B0 + dB) * Math.sign(s) * Math.pow(Math.abs(s), 2 / NN)]);
  }
  pts.push(pts[0].slice());
  return pts;
}
function lapLen(p) {
  let d = 0;
  for (let i = 0; i < p.length - 1; i++) d += Math.hypot(p[i+1][0]-p[i][0], p[i+1][1]-p[i][1]);
  return d;
}
function seeded(a) {
  return function () { a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/* The same integration, but keeping the whole track rather than only the
   worst error, so two of them can be compared against each other. */
function trace(makeCtl, path, secs) {
  const rand = seeded(0xC0FFEE11);
  const ctl = makeCtl(path, rand);
  const p0 = path[0], p1 = path[1];
  let x = p0[0], y = p0[1], psi = Math.atan2(p1[1]-p0[1], p1[0]-p0[0]);
  const out = [];
  const d = 1 / 20;
  for (let i = 0; i < secs * 20; i++) {
    const [v, w] = ctl([x, y, psi]);
    psi += w * d; x += Math.cos(psi) * v * d; y += Math.sin(psi) * v * d;
    out.push([x, y]);
  }
  return out;
}

function run(makeCtl, path, secs = 200) {
  const rand = seeded(0xC0FFEE11);
  const ctl = makeCtl(path, rand);
  const p0 = path[0], p1 = path[1];
  let x = p0[0], y = p0[1], psi = Math.atan2(p1[1]-p0[1], p1[0]-p0[0]);
  let worst = 0;
  const d = 1 / 20;
  for (let i = 0; i < secs * 20; i++) {
    const [v, w] = ctl([x, y, psi]);
    psi += w * d; x += Math.cos(psi) * v * d; y += Math.sin(psi) * v * d;
    const off = nearest(path, x, y)[2];
    if (i > 40 && off > worst) worst = off;      // skip the first two seconds
  }
  return worst * 1000;                            // mm
}

const CTL = {
  'pure pursuit': (path) => (st) => purePursuit(st, path, { look: 0.34, maxV: MAX_V, maxW: MAX_W }),
  'stanley':      (path) => (st) => stanley(st, path, { k: 2.4, lead: 0.10, maxV: MAX_V, maxW: MAX_W }),
  'dwa':          (path) => { const g = new Local({ maxV: MAX_V, maxW: MAX_W, horizon: 1.9, nv: 5, nw: 15 });
                              return (st) => { const [i] = nearest(path, st[0], st[1]);
                                               return g.plan(st, ahead(path, i, 0.58), []); }; },
  'mppi':         (path, rand) => { const m = new MPPI({ maxV: MAX_V, maxW: MAX_W, K: 96 });
                                    return (st) => { const [i] = nearest(path, st[0], st[1]);
                                                     return m.step(st, path, rand, ahead(path, i, 0.58)); }; }
};

// Four concentric lanes, 0.25 m apart, centred on the plan the bay uses now.
const OFF = [-0.375, -0.125, 0.125, 0.375];
const lanes = OFF.map(o => makePath(o, o));
console.log('lane offsets (m): ' + OFF.join(', '));
console.log('lap lengths (m):  ' + lanes.map(p => lapLen(p).toFixed(2)).join('  '));
console.log('outer extent:     ' + (2 * (A0 + 0.375)).toFixed(2) + ' by '
            + (2 * (B0 + 0.375)).toFixed(2) + ' m, course is 2.70 by 3.40\n');
console.log('worst cross-track, mm            lane -0.375  -0.125   +0.125   +0.375   spread');
for (const [name, mk] of Object.entries(CTL)) {
  const row = lanes.map(p => run(mk, p));
  const spread = Math.max(...row) - Math.min(...row);
  console.log('  ' + name.padEnd(30) + row.map(v => String(Math.round(v)).padStart(7)).join('')
              + String(Math.round(spread)).padStart(9));
}

/* And the question the fairness table does not answer: can two of them touch.
 *
 * Lanes only replace the collision mask if the machines cannot reach each
 * other, and 0.25 m of lane spacing is not obviously enough -- the sampler is
 * 126 mm off its line at worst on the inner lane, so two neighbours leaning
 * toward each other at the same moment close 252 mm of a 250 mm gap before
 * either body is counted. A Burger is 0.178 m across, so the centres have to
 * stay further apart than that.
 *
 * Every rotation, not just the one arrangement: the rotation puts each
 * controller next to each of the others, and the pair that can touch is the
 * pair that is worst in the lanes it is worst in.
 */
const NAMES = Object.keys(CTL);
const SECS = 200;
console.log('\nclosest two machines ever get, centre to centre, over ' + SECS + ' s');
console.log('  a Burger is 0.178 m across, so anything above that cannot touch\n');
let worstPair = null, worstGap = Infinity;
for (let race = 0; race < 4; race++) {
  const tr = NAMES.map((n, i) => trace(CTL[n], lanes[(i + race) % 4], SECS));
  let gap = Infinity, who = '';
  for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) {
    for (let k = 0; k < tr[a].length; k++) {
      const d = Math.hypot(tr[a][k][0] - tr[b][k][0], tr[a][k][1] - tr[b][k][1]);
      if (d < gap) { gap = d; who = NAMES[a] + ' / ' + NAMES[b]; }
    }
  }
  console.log('  race ' + (race + 1) + ': ' + gap.toFixed(3) + ' m  (' + who + ')');
  if (gap < worstGap) { worstGap = gap; worstPair = who; }
}
console.log('\n  closest over all four races: ' + worstGap.toFixed(3) + ' m, '
            + worstPair + ' -- ' + (worstGap > 0.178
              ? 'clear by ' + ((worstGap - 0.178) * 1000).toFixed(0) + ' mm'
              : 'THEY TOUCH'));
