/* Tracking the obstacle, and turning the track into a time to collision.
 *
 * This is predictive_replanning/predict.py, in the page. The replan cell
 * used to check where the obstacle *is*: an arm that cancels the moment
 * something is already in its path, which is a reflex and not a plan. What
 * the repository actually contributes is the other thing -- estimating where
 * the obstacle will be, and cancelling before it gets there.
 *
 * The tracker is a constant-velocity Kalman filter over [x, y, z, vx, vy, vz]
 * watching noisy positions, and CV is deliberately the wrong model: a hand
 * moving across a workspace does not hold a constant velocity. The mismatch
 * is the point. The robot is not told the process that generates the motion,
 * it has to estimate it, and what the filter carries correctly is the growth
 * of its own uncertainty.
 *
 * So a prediction is not a point. At horizon h the obstacle is a sphere of
 *
 *     r(h) = r_obstacle + n_sigma * sigma_pos(h)
 *
 * and avoiding it means avoiding a cone that opens with time. Checking the
 * predicted mean alone would make this exactly as brittle as the reflex it
 * replaces, only earlier.
 *
 * The sigma cap is not a fudge and predict.py says why: a constant-velocity
 * filter extrapolates without bound, so its two-second covariance implies a
 * sphere wider than the cell -- 2.40 m against a true mean error of 0.98 --
 * and inflating by that marks the whole workspace blocked and the arm stops
 * dead. A cell knows the volume its obstacles are confined to, so the tube
 * saturates there instead of growing forever.
 */

/* Six by six, row major, because a 36-element array with explicit indices is
   a smaller thing to read than a matrix library and this file needs exactly
   three operations from one. */
function matmul(A, B, out) {
  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < 6; j++) {
      let s = 0;
      for (let k = 0; k < 6; k++) s += A[i * 6 + k] * B[k * 6 + j];
      out[i * 6 + j] = s;
    }
  }
  return out;
}

function matmulT(A, B, out) {          // A * B^T
  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < 6; j++) {
      let s = 0;
      for (let k = 0; k < 6; k++) s += A[i * 6 + k] * B[j * 6 + k];
      out[i * 6 + j] = s;
    }
  }
  return out;
}

/* Inverse of a symmetric 3x3, by cofactors. The measurement is position
   only, so this is the whole of the gain's matrix inversion. */
function inv3(m, out) {
  const a = m[0], b = m[1], c = m[2], d = m[3], e = m[4], f = m[5],
        g = m[6], h = m[7], i = m[8];
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-18) return null;
  const k = 1 / det;
  out[0] = A * k;                 out[1] = -(b * i - c * h) * k; out[2] = (b * f - c * e) * k;
  out[3] = B * k;                 out[4] = (a * i - c * g) * k;  out[5] = -(a * f - c * d) * k;
  out[6] = C * k;                 out[7] = -(a * h - b * g) * k; out[8] = (a * e - b * d) * k;
  return out;
}

export class Track {
  constructor(pos, { measStd = 0.02, accelStd = 1.2 } = {}) {
    this.x = new Float64Array([pos[0], pos[1], pos[2], 0, 0, 0]);
    this.P = new Float64Array(36);
    for (let i = 0; i < 3; i++) this.P[i * 6 + i] = measStd * measStd;
    for (let i = 3; i < 6; i++) this.P[i * 6 + i] = 0.25;
    this.measVar = measStd * measStd;
    this.accelStd = accelStd;
    this._F = new Float64Array(36);
    this._Q = new Float64Array(36);
    this._A = new Float64Array(36);
    this._B = new Float64Array(36);
    this._S = new Float64Array(9);
    this._Si = new Float64Array(9);
    this._K = new Float64Array(18);     // 6 x 3
    this._xf = new Float64Array(6);
  }

  F(dt, out) {
    out.fill(0);
    for (let i = 0; i < 6; i++) out[i * 6 + i] = 1;
    for (let i = 0; i < 3; i++) out[i * 6 + (i + 3)] = dt;
    return out;
  }

  /* White-noise-acceleration process noise, the CV model's own. */
  Q(dt, out) {
    out.fill(0);
    const q = this.accelStd * this.accelStd;
    const a = dt ** 4 / 4 * q, b = dt ** 3 / 2 * q, c = dt * dt * q;
    for (let i = 0; i < 3; i++) {
      out[i * 6 + i] = a;
      out[i * 6 + (i + 3)] = b;
      out[(i + 3) * 6 + i] = b;
      out[(i + 3) * 6 + (i + 3)] = c;
    }
    return out;
  }

  update(pos, dt) {
    if (!(dt > 0)) return;
    const F = this.F(dt, this._F), Q = this.Q(dt, this._Q);
    // x <- F x
    const xf = this._xf;
    for (let i = 0; i < 6; i++) {
      let s = 0;
      for (let k = 0; k < 6; k++) s += F[i * 6 + k] * this.x[k];
      xf[i] = s;
    }
    this.x.set(xf);
    // P <- F P F^T + Q
    matmul(F, this.P, this._A);
    matmulT(this._A, F, this._B);
    for (let i = 0; i < 36; i++) this.P[i] = this._B[i] + Q[i];
    // S = H P H^T + R, with H picking the first three
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++)
        this._S[i * 3 + j] = this.P[i * 6 + j] + (i === j ? this.measVar : 0);
    const Si = inv3(this._S, this._Si);
    if (!Si) return;
    // K = P H^T S^-1, six by three
    for (let i = 0; i < 6; i++)
      for (let j = 0; j < 3; j++) {
        let s = 0;
        for (let k = 0; k < 3; k++) s += this.P[i * 6 + k] * Si[k * 3 + j];
        this._K[i * 3 + j] = s;
      }
    // x <- x + K (z - H x)
    const r0 = pos[0] - this.x[0], r1 = pos[1] - this.x[1], r2 = pos[2] - this.x[2];
    for (let i = 0; i < 6; i++) {
      this.x[i] += this._K[i * 3] * r0 + this._K[i * 3 + 1] * r1 + this._K[i * 3 + 2] * r2;
    }
    // P <- (I - K H) P
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 6; j++) {
        let s = 0;
        for (let k = 0; k < 3; k++) s += this._K[i * 3 + k] * this.P[k * 6 + j];
        this._B[i * 6 + j] = this.P[i * 6 + j] - s;
      }
    }
    this.P.set(this._B);
  }

  /* Where it will be at horizon h, and how uncertain that is. The sigma is
     the mean position standard deviation, which is the trace of the position
     block over three -- one number for a sphere, as predict.py takes it. */
  forecast(h, out) {
    for (let i = 0; i < 3; i++) out[i] = this.x[i] + this.x[i + 3] * h;
    const F = this.F(h, this._F), Q = this.Q(h, this._Q);
    matmul(F, this.P, this._A);
    matmulT(this._A, F, this._B);
    let tr = 0;
    for (let i = 0; i < 3; i++) tr += this._B[i * 6 + i] + Q[i * 6 + i];
    out[3] = Math.sqrt(Math.max(0, tr / 3));
    return out;
  }

  /* The tube's radius at a horizon: the obstacle, plus n sigmas of where the
     filter thinks it might be, capped at the volume the cell confines it to. */
  radiusAt(h, base, nSigma, cap, out) {
    this.forecast(h, out);
    const sig = cap !== undefined ? Math.min(out[3], cap) : out[3];
    return base + nSigma * sig;
  }

  get speed() { return Math.hypot(this.x[3], this.x[4], this.x[5]); }
}

/* The earliest horizon at which the arm enters the predicted tube.
 *
 * `at(u, pts)` fills and returns the arm's sample points at fraction u of the
 * remaining plan; `radii` is what each of those points has to carry to cover
 * the real robot, because a skeleton is a centreline and a forearm is not.
 * Returns the horizon in seconds, or -1 for clear.
 */
export function timeToCollision(at, pts, radii, track, opts) {
  const { base, nSigma = 2, clearance = 0.02, horizon = 2.5, steps = 12,
          cap, rate } = opts;
  const p = [0, 0, 0, 0];
  for (let k = 1; k <= steps; k++) {
    const h = (k / steps) * horizon;
    const r = track.radiusAt(h, base, nSigma, cap, p) + clearance;
    /* Where the arm will be then: the plan is executed at a known rate, so a
       horizon in seconds is a fraction along it. */
    const u = Math.min(1, h * rate);
    const arm = at(u, pts);
    let worst = Infinity;
    for (let i = 0; i < arm.length; i++) {
      const d = Math.hypot(arm[i].x - p[0], arm[i].y - p[1], arm[i].z - p[2]) - radii[i];
      if (d < worst) worst = d;
    }
    if (worst < r) return h;
  }
  return -1;
}
