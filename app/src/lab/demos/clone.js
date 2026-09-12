import { ASSET } from "../../lib/paths.js";

/* The behaviour-cloned controller, run in the page.
 *
 * assets/dwa_clone.json is a real checkpoint: a 15-64-64-2 network that
 * tools/train_clone.py trained on 29,813 samples of this project's own DWA
 * driving 157 random maps, then improved over four rounds of DAgger. It is
 * the only learned thing in this building and it was living on the document
 * site, where it drives a 2D canvas; the bay it is missing from is the one
 * where the reader can put it next to the controller it was copied from and
 * watch the two disagree.
 *
 * Nothing here re-derives anything. The observation is the training script's
 * observe() transcribed, the activation is its tanh, and the scales are the
 * ones it wrote into the file. A clone driven on a slightly different
 * observation is a different policy, and it would fail in a way that looked
 * like the network being bad rather than like this file being wrong.
 */

let pending = null;

export function clone() {
  if (pending) return pending;
  pending = fetch(ASSET("dwa_clone.json"))
    .then(r => (r.ok ? r.json() : Promise.reject(new Error(r.status))))
    /* Only what the page reads. The checkpoint also carries its
       architecture, its training curve and a note about where it came from;
       carrying those into a live object nobody looks at is three fields that
       exist to be found dead later. */
    .then(j => ({
      W: j.W, b: j.b,
      bearings: j.obs.bearings, ranges: j.obs.ranges,
      vScale: j.obs.v_scale, wScale: j.obs.w_scale,
      train: j.train, evalu: j.eval
    }));
  return pending;
}

/* What the policy is allowed to know, which is costmap reads and its own
 * twist -- no path, no plan, no obstacle list.
 *
 * Four numbers about the goal and the body, then one clearance per bearing:
 * march out along the bearing through the range bands and report the band it
 * first hits something in, as a fraction. Unobstructed is 1. This is
 * train_clone.py's observe() line for line, including that the range index
 * is divided by the number of bands rather than by the last index, so a hit
 * in the first band reads 0 and a hit in the last reads 0.75.
 */
export function observe(net, x, y, yaw, v, w, gx, gy, blocked, out) {
  const dx = gx - x, dy = gy - y;
  const rng = Math.hypot(dx, dy);
  let brg = Math.atan2(dy, dx) - yaw;
  brg = Math.atan2(Math.sin(brg), Math.cos(brg));
  out[0] = Math.min(rng, 4) / 4;
  out[1] = brg / Math.PI;
  out[2] = v / net.vScale;
  out[3] = w / net.wScale;
  const R = net.ranges, n = R.length;
  for (let i = 0; i < net.bearings.length; i++) {
    const a = yaw + net.bearings[i];
    const ca = Math.cos(a), sa = Math.sin(a);
    let clear = 1;
    for (let k = 0; k < n; k++) {
      if (blocked(x + R[k] * ca, y + R[k] * sa)) { clear = k / n; break; }
    }
    out[4 + i] = clear;
  }
  return out;
}

/* Forward pass. tanh on the hidden layers and linear out, which is what the
   training script's own forward is, and then the twist back out of the
   normalised units the network was trained in. */
export function act(net, o, scratch) {
  let a = o;
  for (let L = 0; L < net.W.length; L++) {
    const Wl = net.W[L], bl = net.b[L], nOut = bl.length;
    const z = scratch[L];
    for (let j = 0; j < nOut; j++) {
      let s = bl[j];
      for (let i = 0; i < a.length; i++) s += a[i] * Wl[i][j];
      z[j] = L < net.W.length - 1 ? Math.tanh(s) : s;
    }
    a = z;
  }
  return [a[0] * net.vScale, a[1] * net.wScale];
}

export function scratchFor(net) {
  return net.b.map(b => new Float64Array(b.length));
}
