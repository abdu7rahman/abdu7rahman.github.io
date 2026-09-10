/* A local controller that samples velocity space, rolls each candidate out
 * and drives the best one. The fan you see on the bench is the rollout set,
 * not a drawing of one.
 *
 * This is the sampling half of Fox, Burgard and Thrun's dynamic window
 * approach: a grid over (v, w), a forward simulation of the unicycle model
 * for each pair over a fixed horizon, and a cost made of heading, clearance
 * and speed. Every arc drawn is a trajectory that was scored; the highlighted
 * one is the argmin, and it is what the wheels are given.
 *
 * The dynamic part -- narrowing the window to what the base can reach within
 * one control period given its acceleration -- is not here, and that is a
 * deliberate omission rather than a simplification nobody noticed. It needs
 * an acceleration limit, turtlebot3_description states none, and the teleop
 * node's 0.01 m/s keypress step is a step size and not an acceleration. So
 * the window is the whole admissible set: v in [0, MAX_V] and w in
 * [-MAX_W, MAX_W], which are the ceilings the URDF's own teleop does state.
 * Sampling the full set is a superset of the right answer, so the controller
 * is optimistic about what the base can do between ticks and never
 * pessimistic about where it can go, which is the safe direction for the one
 * thing this is showing.
 */

/* The unicycle, integrated exactly rather than with Euler steps.
 *
 * Over a constant (v, w) the exact solution is a circular arc, and using it
 * instead of small forward steps matters here for a reason that is visible:
 * at MAX_W the base turns 2.84 rad/s, so a 1.5 s horizon in ten Euler steps
 * accumulates several degrees of error and the drawn arc stops being the
 * trajectory that was scored. The straight-line case is the w -> 0 limit and
 * is taken separately because the arc form divides by w.
 */
export function arc(x, y, psi, v, w, t) {
  if (Math.abs(w) < 1e-4) {
    return [x + v * t * Math.cos(psi), y + v * t * Math.sin(psi), psi];
  }
  const p2 = psi + w * t, r = v / w;
  return [x + r * (Math.sin(p2) - Math.sin(psi)),
          y - r * (Math.cos(p2) - Math.cos(psi)),
          p2];
}

export function rollout(state, v, w, horizon, steps, out) {
  const [x, y, psi] = state;
  for (let k = 0; k <= steps; k++) {
    const t = (k / steps) * horizon;
    const p = arc(x, y, psi, v, w, t);
    out[k * 2] = p[0]; out[k * 2 + 1] = p[1];
  }
  return out;
}

/* Nearest obstacle along a rolled-out path, in metres, capped so a wide open
   trajectory does not out-score a merely adequate one on clearance alone.
   Returns -1 when the path hits something, which is a refusal and not a
   score: an admissible trajectory is one that does not collide. */
export function clearance(pts, steps, obs, radius, cap) {
  let worst = cap;
  for (let k = 0; k <= steps; k++) {
    const x = pts[k * 2], y = pts[k * 2 + 1];
    for (let i = 0; i < obs.length; i++) {
      const o = obs[i];
      const d = Math.hypot(x - o[0], y - o[1]) - o[2] - radius;
      if (d <= 0) return -1;
      if (d < worst) worst = d;
    }
  }
  return worst;
}

export class Local {
  constructor(opts) {
    Object.assign(this, {
      maxV: 0.22, maxW: 2.84, nv: 7, nw: 21,
      horizon: 1.5, steps: 12, radius: 0.09, clearCap: 0.5,
      wHead: 1.0, wClear: 0.55, wSpeed: 0.22, ...opts
    });
    this.buf = new Float32Array((this.steps + 1) * 2);
    // One flat array of every sampled path, refilled each tick. Held so the
    // rig can draw exactly what was scored rather than re-simulating it.
    this.fan = new Float32Array(this.nv * this.nw * (this.steps + 1) * 2);
    this.fanOk = new Uint8Array(this.nv * this.nw);
    this.count = 0;
  }

  plan(state, goal, obs) {
    const { nv, nw, steps, horizon, radius, clearCap } = this;
    const span = (steps + 1) * 2;
    let best = null, bestCost = Infinity, n = 0;
    const gx = goal[0], gy = goal[1];
    const d0 = Math.hypot(gx - state[0], gy - state[1]);

    for (let a = 0; a < nv; a++) {
      // Zero is in the set on purpose: a base that cannot choose to stop
      // cannot refuse a trajectory, and refusing is most of what this does.
      const v = (a / (nv - 1)) * this.maxV;
      for (let b = 0; b < nw; b++) {
        const w = ((b / (nw - 1)) * 2 - 1) * this.maxW;
        rollout(state, v, w, horizon, steps, this.buf);
        this.fan.set(this.buf, n * span);

        const cl = clearance(this.buf, steps, obs, radius, clearCap);
        this.fanOk[n] = cl < 0 ? 0 : 1;
        if (cl >= 0) {
          const ex = this.buf[steps * 2], ey = this.buf[steps * 2 + 1];
          // Heading: how much of the distance to the goal this arc closes,
          // normalised so it does not swamp the others when the goal is far.
          const head = (Math.hypot(gx - ex, gy - ey) - d0) / Math.max(0.2, d0);
          const cost = this.wHead * head
                     - this.wClear * Math.min(cl, clearCap) / clearCap
                     - this.wSpeed * (v / this.maxV);
          if (cost < bestCost) { bestCost = cost; best = [v, w, n]; }
        }
        n++;
      }
    }
    this.count = n;
    /* Nothing admissible: back out, which is the honest response to being
       boxed in and the one case a fan of forward arcs cannot express.
    
       It is also the one command here that was not collision checked, and
       it cannot be by this method: every arc in the fan goes forward, so
       there is nothing in the sampled set that describes reversing. A base
       that has just been told nothing ahead of it is clear is a base whose
       last known clear ground is behind it, which is the argument for
       reversing slowly and the whole of it. Slowly: 0.06 m/s is a quarter
       of the ceiling. */
    return best || [-0.06, this.maxW * 0.35, -1];
  }
}
