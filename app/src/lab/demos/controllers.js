/* Four local controllers over one plan, each the published thing it is named
 * after rather than a variation on one of the others.
 *
 * The point of racing them is that they fail differently. Pure pursuit cuts
 * corners and its lookahead decides how much. Stanley holds the line and
 * pays for it in steering effort. The velocity-space sampler refuses
 * trajectories rather than tracking a line at all, so it goes wide where
 * there is room. MPPI averages over its samples instead of picking one, so
 * it commits earlier and more smoothly and costs the most to run. All four
 * get the same path, the same clock, the same ceilings, and the same base.
 *
 * They return [v, w] in the robot's own units and nothing else. What they
 * are not given is as important: none of them sees the others, none is
 * allowed past the Burger's teleop ceilings, and none is handed a smoothed
 * version of the path the others did not get.
 */

/* Where a path is nearest to a point, as an index and the fraction along the
   segment after it. Every controller here needs it and getting it slightly
   different in four places is how four controllers stop being comparable. */
/* One result object, refilled. nearest() is called K x H = 1,536 times per
   MPPI tick and once more per controller per tick, and a three-element
   array per call is a hundred thousand of them a second at 20 Hz. Callers
   destructure it immediately and none of them holds it, which is what makes
   this safe -- and is why it is stated rather than left to be discovered. */
const _near = [0, 0, 0];

export function nearest(path, x, y, from = 0) {
  let bi = from, bt = 0, bd = Infinity;
  for (let i = from; i < path.length - 1; i++) {
    const ax = path[i][0], ay = path[i][1];
    const bx = path[i + 1][0], by = path[i + 1][1];
    const dx = bx - ax, dy = by - ay;
    const L = dx * dx + dy * dy;
    let t = L > 0 ? ((x - ax) * dx + (y - ay) * dy) / L : 0;
    t = Math.max(0, Math.min(1, t));
    const px = ax + dx * t, py = ay + dy * t;
    const d = (x - px) * (x - px) + (y - py) * (y - py);
    if (d < bd) { bd = d; bi = i; bt = t; }
  }
  _near[0] = bi; _near[1] = bt; _near[2] = Math.sqrt(bd);
  return _near;
}

/* The point a given distance further along a closed path.
 *
 * Wrapping, and that is not a detail. The plan in the race bay is a closed
 * loop -- makePath pushes the first point again as the last -- and walking
 * forward with a clamp instead of a modulo pins the target to the final
 * node for the last lookahead's worth of every lap. Simulated at the bay's
 * own parameters, the sampler's goal collapsed onto the robot for about
 * five seconds a lap and cost it eleven per cent of its distance: 18.7 laps
 * in ten minutes against 21.0 unimpeded. The bay's whole claim is that the
 * four separate because they are different controllers and not because one
 * of them was handicapped, so an indexing artefact worth eleven per cent is
 * the bay being wrong rather than slow.
 */
export function ahead(path, i, dist) {
  const n = path.length - 1;         // the last point repeats the first
  let j = i, acc = 0;
  for (let k = 0; k < n && acc < dist; k++) {
    const a = path[j % n], b = path[(j + 1) % n];
    acc += Math.hypot(b[0] - a[0], b[1] - a[1]);
    j++;
  }
  return path[j % n];
}

function wrap(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

/* Pure pursuit: steer at a point a fixed distance ahead on the path.
 *
 * The curvature that puts the robot on that point is 2 sin(alpha) / L with
 * alpha the bearing to it in the body frame, which is the whole controller.
 * Its weakness is structural rather than a tuning failure: the arc it
 * follows is a chord, so it cuts every corner by an amount that grows with
 * the lookahead, and shortening the lookahead to stop that makes it saw.
 */
export function purePursuit(state, path, opts) {
  const [x, y, psi] = state;
  const { look = 0.30, maxV, maxW } = opts;
  const [i] = nearest(path, x, y);
  const tgt = ahead(path, i, look);
  const tx = tgt[0], ty = tgt[1];
  const dx = tx - x, dy = ty - y;
  const alpha = wrap(Math.atan2(dy, dx) - psi);
  const L = Math.max(0.05, Math.hypot(dx, dy));
  const kappa = 2 * Math.sin(alpha) / L;
  const v = maxV * Math.max(0.25, 1 - Math.abs(alpha) / 1.6);
  return [v, Math.max(-maxW, Math.min(maxW, kappa * v))];
}

/* Stanley: cross-track error at the front axle, plus heading error.
 *
 * w = heading error + atan(k e / (v + eps)), the form in Thrun et al's DARPA
 * Challenge report. On a differential base there is no front axle, so the
 * control point is taken one wheelbase ahead of the contact point -- which
 * is the standard way to use it here and is also why it holds the line
 * better than pure pursuit and steers harder to do it.
 */
export function stanley(state, path, opts) {
  const [x, y, psi] = state;
  const { k = 2.4, lead = 0.10, maxV, maxW } = opts;
  const fx = x + lead * Math.cos(psi), fy = y + lead * Math.sin(psi);
  const [i, t, d] = nearest(path, fx, fy);
  const ax = path[i][0], ay = path[i][1];
  const bx = path[i + 1][0], by = path[i + 1][1];
  const seg = Math.atan2(by - ay, bx - ax);
  // Sign of the cross-track error: which side of the segment the point is on.
  const cross = Math.sign((bx - ax) * (fy - ay) - (by - ay) * (fx - ax));
  const head = wrap(seg - psi);
  const v = opts.maxV * Math.max(0.3, 1 - Math.abs(head) / 1.8);
  const w = head + Math.atan2(k * (-cross * d), v + 0.05);
  return [v, Math.max(-maxW, Math.min(maxW, w))];
}

/* MPPI: sample control sequences, weight them by exp(-cost/lambda), and take
 * the weighted mean rather than the best one.
 *
 * Williams et al's information-theoretic form, at the size a browser can
 * afford: K rollouts of H steps, each perturbing a nominal sequence with
 * Gaussian noise, cost accumulated as squared distance to the path plus a
 * hard penalty for leaving it, and the nominal shifted forward one step each
 * tick so the next solve starts from the last answer. Averaging is the whole
 * difference from the sampler in dwa.js: a single best sample is as noisy as
 * the sampling, and a weighted mean over the good ones is not.
 */
export class MPPI {
  constructor(opts) {
    Object.assign(this, {
      K: 96, H: 16, dt: 0.1, lambda: 0.55,
      sigV: 0.06, sigW: 0.85, maxV: 0.22, maxW: 2.84, ...opts
    });
    this.nomV = new Float32Array(this.H);
    this.nomW = new Float32Array(this.H);
    this.nomV.fill(this.maxV * 0.6);
    this.dv = new Float32Array(this.K * this.H);
    this.dw = new Float32Array(this.K * this.H);
    this.cost = new Float32Array(this.K);
  }

  /* Back to the opening guess. MPPI warm starts -- each tick shifts the
     control sequence it settled on last time and re-samples around it, which
     is most of why it commits earlier than a sampler that starts cold. That
     memory is exactly wrong across a restart: it holds the plan for a corner
     the machine is no longer standing at, and the first second of the new
     run is spent unwinding the last one. */
  reset() {
    this.nomV.fill(this.maxV * 0.6);
    this.nomW.fill(0);
  }

  // Box-Muller, because a sum of uniforms is not a Gaussian and the weights
  // below are only meaningful if the noise is the one in the derivation.
  gauss(rand) {
    const u = Math.max(1e-9, rand()), v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  step(state, path, rand) {
    const { K, H, dt, lambda, sigV, sigW, maxV, maxW } = this;
    let best = Infinity;
    for (let k = 0; k < K; k++) {
      let x = state[0], y = state[1], psi = state[2], c = 0;
      for (let h = 0; h < H; h++) {
        const nv = this.gauss(rand) * sigV, nw = this.gauss(rand) * sigW;
        this.dv[k * H + h] = nv; this.dw[k * H + h] = nw;
        const v = Math.max(0, Math.min(maxV, this.nomV[h] + nv));
        const w = Math.max(-maxW, Math.min(maxW, this.nomW[h] + nw));
        psi += w * dt; x += Math.cos(psi) * v * dt; y += Math.sin(psi) * v * dt;
        const [, , d] = nearest(path, x, y);
        c += d * d * 26 + (d > 0.22 ? 40 : 0) - v * 1.4;
      }
      this.cost[k] = c;
      if (c < best) best = c;
    }
    // Weights, shifted by the minimum before the exponential so the sum does
    // not underflow to zero -- which it does, silently, and the controller
    // then steers with 0/0.
    let sum = 0;
    for (let k = 0; k < K; k++) {
      this.cost[k] = Math.exp(-(this.cost[k] - best) / lambda);
      sum += this.cost[k];
    }
    for (let h = 0; h < H; h++) {
      let av = 0, aw = 0;
      for (let k = 0; k < K; k++) {
        av += this.cost[k] * this.dv[k * H + h];
        aw += this.cost[k] * this.dw[k * H + h];
      }
      this.nomV[h] = Math.max(0, Math.min(maxV, this.nomV[h] + av / sum));
      this.nomW[h] = Math.max(-maxW, Math.min(maxW, this.nomW[h] + aw / sum));
    }
    const out = [this.nomV[0], this.nomW[0]];
    // Shift the nominal forward, which is what makes this a receding horizon
    // rather than a fresh guess every tick.
    for (let h = 0; h < H - 1; h++) {
      this.nomV[h] = this.nomV[h + 1]; this.nomW[h] = this.nomW[h + 1];
    }
    return out;
  }
}
