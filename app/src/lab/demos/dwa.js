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

/* The same question asked of a distance field instead of a list of circles.
 *
 * A cell's obstacle course is a handful of discs and looping over them is
 * the honest cost of the answer. A building is not: the guide walking the
 * aisle is up against benches, racking, guarding, partitions and the
 * envelope, which is 26,973 blocked cells, and no controller is going to
 * check a trajectory against those one at a time. The distance transform
 * over the occupancy grid has already done the work -- it says, for any
 * point, how far the nearest solid thing is -- so a rollout costs one
 * bilinear sample per step whatever the building contains.
 *
 * Identical semantics to the circle form: -1 for a collision, otherwise the
 * worst clearance along the path capped at `cap`. The controller above
 * cannot tell which one it is talking to, which is the point.
 */
export function fieldClearance(pts, steps, field, radius, cap) {
  let worst = cap;
  for (let k = 0; k <= steps; k++) {
    const d = field.clearance(pts[k * 2], pts[k * 2 + 1]) - radius;
    if (d <= 0) return -1;
    if (d < worst) worst = d;
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

  /* `obs` is either a list of circles or, when this controller was built
     with a `field`, ignored in favour of it. */
  plan(state, goal, obs) {
    const { nv, nw, steps, horizon, radius, clearCap } = this;
    /* The radius the rollouts are actually checked against, which is the
     * machine's own plus half the gap between the points it is sampled at.
     *
     * A rollout is a handful of points on an arc, not the arc: at this bay's
     * numbers, 12 steps over a 2.6 s horizon at 0.22 m/s is a point every
     * 48 mm. Checking clearance at the points and nowhere between them means
     * an arc can pass within a couple of centimetres of a drum and still
     * come back clear, which is how a controller that rejects every
     * colliding trajectory still grazes things. Half the spacing is the most
     * the true path can bow away from the samples, so adding it makes the
     * discrete check a sound test of the continuous arc rather than an
     * optimistic one. It is the same correction as the one-cell inflation in
     * the search bay and for the same reason: a plan for a point is not a
     * plan for a robot. */
    const grip = radius + (this.maxV * horizon) / Math.max(1, steps) / 2;
    const field = this.field;
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

        const cl = field ? fieldClearance(this.buf, steps, field, grip, clearCap)
                         : clearance(this.buf, steps, obs, grip, clearCap);
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
