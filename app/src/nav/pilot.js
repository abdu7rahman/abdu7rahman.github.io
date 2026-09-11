import { Local, arc } from "../lab/demos/dwa.js";
import { Router } from "./route.js";

/* The guide's own navigation: plan a route, follow it, arrive facing the
 * thing it came to show you.
 *
 * Both halves are the site's own. The global plan is the A* from the Search
 * cell, run on the building's occupancy grid; the local controller is the
 * velocity-space sampler from the Local control cell, scoring against the
 * building's distance field. The guide is not a demonstration of them, it is
 * a user of them -- if either is wrong, the guide walks into a bench in front
 * of you, which is a stronger claim than a bench-top animation of the same
 * method could make.
 *
 * The state machine is four states and no more, because a guide that gets
 * stuck between two of them is worse than one that goes the long way round:
 *
 *   idle      standing where it is
 *   planning  the search running, a budget a frame, frontier visible
 *   walking   the controller driving, the path being consumed
 *   turning   on the spot, to face the subject
 *
 * The look-ahead is what turns a list of waypoints into something to follow.
 * The controller is given a point on the path a fixed distance in front of
 * the projection of the guide onto it -- pure pursuit's carrot, and the same
 * idea the Race cell puts on a bench -- rather than the next waypoint, which
 * would have the guide aim at a corner and cut it.
 */

const LOOK = 1.35;       // metres of carrot ahead on the path
const ARRIVE = 0.18;     // how near the last waypoint counts as there
const FACE = 0.09;       // radians of heading error that counts as facing

export class Pilot {
  constructor(grid, opts = {}) {
    this.grid = grid;
    this.radius = opts.radius ?? 0.30;
    this.pose = { x: opts.x ?? 0, z: opts.z ?? 0, yaw: opts.yaw ?? Math.PI };
    this.v = 0; this.w = 0;
    this.phase = "idle";
    this.path = [];
    this.seg = 0;
    this.goal = null;
    this.faceYaw = null;
    this.router = new Router(grid);
    /* A humanoid, not a TurtleBot: the ceilings are the guide's own and the
       body radius is measured off the robot rather than assumed -- a G1's
       shoulders span 0.45 m, so 0.30 m of radius clears them with the map's
       own half-cell bias on top. */
    this.local = new Local({
      maxV: opts.maxV ?? 0.85, maxW: opts.maxW ?? 1.5,
      nv: 6, nw: 17, horizon: 2.0, steps: 12,
      radius: this.radius, clearCap: 1.1,
      wHead: 1.0, wClear: 0.42, wSpeed: 0.30,
      field: grid
    });
    this.stuck = 0;
    this.trip = 0;
  }

  /* Ask for somewhere. `face` is the heading to hold once arrived; without
     one the guide keeps whatever heading it came in on. */
  goTo(x, z, face = null) {
    this.goal = [x, z];
    this.faceYaw = face;
    this.phase = "planning";
    this.path = [];
    this.seg = 0;
    this.stuck = 0;
    this.trip = 0;
    this.router.begin([this.pose.x, this.pose.z], this.goal, { radius: this.radius });
  }

  stop() { this.phase = "idle"; this.v = 0; this.w = 0; this.path = []; }

  /* Distance along the path from the guide's projection, and the carrot. */
  carrot(out) {
    const p = this.path, n = p.length;
    if (n < 2) { out[0] = p[n - 1][0]; out[1] = p[n - 1][1]; return 0; }
    // Advance the segment index while the guide is past the current one.
    let i = this.seg;
    let bestI = i, bestT = 0, bestD = Infinity;
    for (let k = i; k < n - 1 && k < i + 4; k++) {
      const ax = p[k][0], az = p[k][1], bx = p[k + 1][0], bz = p[k + 1][1];
      const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
      let t = L2 > 1e-9 ? ((this.pose.x - ax) * dx + (this.pose.z - az) * dz) / L2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = ax + dx * t, pz = az + dz * t;
      const d = Math.hypot(this.pose.x - px, this.pose.z - pz);
      if (d < bestD) { bestD = d; bestI = k; bestT = t; }
    }
    this.seg = bestI;
    // Walk forward LOOK metres from that projection.
    let need = LOOK;
    let k = bestI, t = bestT;
    while (k < n - 1) {
      const ax = p[k][0], az = p[k][1], bx = p[k + 1][0], bz = p[k + 1][1];
      const segLen = Math.hypot(bx - ax, bz - az);
      const left = segLen * (1 - t);
      if (left >= need) {
        const u = t + need / Math.max(1e-6, segLen);
        out[0] = ax + (bx - ax) * u;
        out[1] = az + (bz - az) * u;
        return bestD;
      }
      need -= left; k++; t = 0;
    }
    out[0] = p[n - 1][0]; out[1] = p[n - 1][1];
    return bestD;
  }

  update(dt, { budget = 5000 } = {}) {
    const g = this.grid;
    if (this.phase === "planning") {
      this.router.step(budget);
      if (this.router.done) {
        if (this.router.found && this.router.path.length) {
          this.path = this.router.path;
          this.seg = 0;
          this.phase = "walking";
        } else {
          this.phase = "idle";
          this.failed = this.router.why || "unreachable";
        }
      }
      this.v += (0 - this.v) * Math.min(1, dt * 6);
      this.w = 0;
      return this.phase;
    }

    if (this.phase === "walking") {
      const last = this.path[this.path.length - 1];
      const toEnd = Math.hypot(last[0] - this.pose.x, last[1] - this.pose.z);
      if (toEnd < ARRIVE) {
        this.phase = this.faceYaw === null ? "idle" : "turning";
        this.v = 0;
        return this.phase;
      }
      const goal = [0, 0];
      const off = this.carrot(goal);
      const cmd = this.local.plan([this.pose.x, this.pose.z, this.pose.yaw], goal, null);
      /* Slow into the last metre rather than stopping dead on the threshold.
         The gait's cadence follows speed, so this is also what makes the
         last two steps shorten the way a person's do. */
      const cap = Math.min(this.local.maxV, 0.35 + (toEnd - ARRIVE) * 0.9);
      this.v = Math.min(cmd[0], cap);
      this.w = cmd[1];
      /* Wandered off the plan, or boxed in: ask for a new one rather than
         grinding. The threshold is generous because the controller is
         allowed to leave the path to get round something. */
      if (off > 1.6 || cmd[2] < 0) this.stuck += dt; else this.stuck = 0;
      if (this.stuck > 1.2) this.goTo(this.goal[0], this.goal[1], this.faceYaw);
      this.integrate(dt);
      this.trip += Math.abs(this.v) * dt;
      return this.phase;
    }

    if (this.phase === "turning") {
      let e = this.faceYaw - this.pose.yaw;
      while (e > Math.PI) e -= Math.PI * 2;
      while (e < -Math.PI) e += Math.PI * 2;
      if (Math.abs(e) < FACE) { this.phase = "idle"; this.w = 0; this.v = 0; return this.phase; }
      this.w = Math.max(-1.1, Math.min(1.1, e * 2.2));
      this.v = 0;
      this.integrate(dt);
      return this.phase;
    }

    this.v += (0 - this.v) * Math.min(1, dt * 8);
    this.w += (0 - this.w) * Math.min(1, dt * 8);
    return this.phase;
  }

  /* Integrate the unicycle over dt, with the same exact arc the controller
     rolled out -- Euler here and arcs there would mean the guide does not go
     where the trajectory it chose said it would. */
  integrate(dt) {
    const p = arc(this.pose.x, this.pose.z, this.pose.yaw, this.v, this.w, dt);
    /* Refuse a step that would put the body inside something. The controller
       has already checked its own rollout, so this catches only the case
       where the world changed underneath it -- and refusing is the right
       answer to that, because the alternative is a machine standing inside a
       bench. */
    if (this.grid.clearance(p[0], p[1]) > this.radius * 0.82) {
      this.pose.x = p[0]; this.pose.z = p[1];
    } else {
      this.v = 0;
    }
    this.pose.yaw = p[2];
  }

  get arrived() { return this.phase === "idle" && this.goal !== null; }
}
