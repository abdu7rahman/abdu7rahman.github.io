import * as THREE from "three";
import { linkFrames, toolPoint, TCP_Z } from "../../../world/kinematics.js";

/* Inverse kinematics for the arm, so a cell can say where it wants the tool
 * instead of remembering what joint angles once put it there.
 *
 * Every arm cell in this building used to be a list of six-number poses that
 * had been solved once, offline, and typed in. That works and it is brittle
 * in a specific way: move the bench, move the part, move a base, and every
 * pose is silently wrong and the only way to find out is to look. Worse, it
 * makes a pick-and-place cell a puppet show -- the arm goes to the pose,
 * whether or not the thing it is picking up is there.
 *
 * This closes the loop the other way round. A phase says "put the tool here,
 * pointing that way"; the point is read off the simulation -- where the tool
 * actually is, where the bin actually is -- and the joint command comes out
 * of the solve. Move anything and the arm follows it.
 *
 * Damped least squares on the analytic Jacobian, position and direction.
 *
 * Direction, and not just position, is the whole difference between this
 * working and not. The first version solved position with four joints and
 * held the wrist at the pair a UR uses when its tool faces the bench -- on
 * the assumption that holding those two angles keeps the tool pointing down.
 * It does not: the tool's direction is a product of all six joints, so the
 * solver was free to reach a point with the gripper lying on its side. It
 * did, and then the gripper ploughed into the bench trying to descend.
 * Measured on the sorting cell: the IK residual was 7.4e-06 m -- a perfect
 * positional solve -- while the wrist sat 1.10 rad away from its command
 * because it was jammed, and the cell picked up nothing at all in 140
 * simulated seconds.
 *
 * So the error is six numbers now: three of position and three of the cross
 * product between where the tool points and where it should. The cross
 * product is the right form because it is perpendicular to the tool axis,
 * which leaves rotation about that axis unconstrained -- a gripper does not
 * care how it is rolled, and constraining it would waste the one redundancy
 * a six-axis arm has.
 *
 * The Jacobian is exact rather than finite-differenced. For a revolute chain
 * the linear column of joint i is z_i x (p_tool - p_i) and the angular column
 * is z_i itself, both read straight off the frames linkFrames() already
 * computed, so a solve costs one forward kinematics call and one six by six
 * solve per iteration.
 */

const _frames = Array.from({ length: 6 }, () => new THREE.Matrix4());
const _tool = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _z = new THREE.Vector3();
const _p = new THREE.Vector3();
const _lin = Array.from({ length: 6 }, () => new THREE.Vector3());
const _ang = Array.from({ length: 6 }, () => new THREE.Vector3());
const _err = new Float64Array(6);
const _A = new Float64Array(36);
const _w = new Float64Array(6);

/* Straight down in the arm's own base frame, which is where every target in
   this building is expressed. A UR's base z is up, so its tool faces the
   bench when the tool axis is -z. */
export const DOWN = new THREE.Vector3(0, 0, -1);

const LAMBDA = 0.05;      // damping, in the units of the error it regularises
const TILT = 0.35;        // how hard the direction term pulls against position

/* Joint limits, and they are what make this usable by a controller rather
 * than merely correct.
 *
 * A UR turns plus or minus two pi on every axis, so a position-and-direction
 * solve has an enormous number of exact answers and a local method will
 * happily walk to whichever one it drifts toward. Measured on the sorting
 * cell's own waypoints: every target solved to about 1e-4 m, and the answers
 * came back with the shoulder at -5.3 rad for one and -0.66 for the next --
 * both valid, a full turn apart, and no servo can cross that between two
 * waypoints. The arm never got anywhere near the bench.
 *
 * These keep it in one configuration branch: shoulder down, elbow one way,
 * wrist near the pose that faces the tool at the work. It is the same
 * restriction a real cell is commissioned into and for the same reason --
 * not because the other solutions are wrong but because a machine that
 * chooses between them mid-task is a machine nobody can stand next to.
 */
const LO = [-Math.PI, -2.9, 0.05, -3.4, -2.6, -Math.PI];
const HI = [Math.PI, -0.10, 2.9, 0.4, -0.5, Math.PI];

/* Solve A w = e in place by Gaussian elimination with partial pivoting. Six
   by six, so an explicit inverse would be more arithmetic and more code. */
function solve6(A, e, w) {
  const n = 6;
  for (let c = 0; c < n; c++) {
    let piv = c, best = Math.abs(A[c * n + c]);
    for (let r = c + 1; r < n; r++) {
      const v = Math.abs(A[r * n + c]);
      if (v > best) { best = v; piv = r; }
    }
    if (best < 1e-12) return false;
    if (piv !== c) {
      for (let k = 0; k < n; k++) {
        const t = A[c * n + k]; A[c * n + k] = A[piv * n + k]; A[piv * n + k] = t;
      }
      const t = e[c]; e[c] = e[piv]; e[piv] = t;
    }
    const d = A[c * n + c];
    for (let r = c + 1; r < n; r++) {
      const m = A[r * n + c] / d;
      if (m === 0) continue;
      for (let k = c; k < n; k++) A[r * n + k] -= m * A[c * n + k];
      e[r] -= m * e[c];
    }
  }
  for (let r = n - 1; r >= 0; r--) {
    let s = e[r];
    for (let k = r + 1; k < n; k++) s -= A[r * n + k] * w[k];
    w[r] = s / A[r * n + r];
  }
  return true;
}

/* One step toward the target. Returns the positional error in metres, which
   is what a caller wants to threshold on -- the direction term is a means and
   not the thing being asked for. */
function step(q, target, dir, gain) {
  linkFrames(q, _frames);
  toolPoint(_frames, _tool);
  const m5 = _frames[5].elements;
  _axis.set(m5[8], m5[9], m5[10]);

  _err[0] = target.x - _tool.x;
  _err[1] = target.y - _tool.y;
  _err[2] = target.z - _tool.z;
  const perr = Math.hypot(_err[0], _err[1], _err[2]);
  // sin of the angle between the tool axis and where it should point, as a
  // rotation vector about the axis that closes the gap.
  _z.copy(_axis).cross(dir).multiplyScalar(TILT);
  _err[3] = _z.x; _err[4] = _z.y; _err[5] = _z.z;
  if (perr < 1e-5 && _z.lengthSq() < 1e-8) return perr;

  for (let i = 0; i < 6; i++) {
    const m = _frames[i].elements;
    _z.set(m[8], m[9], m[10]);
    _p.set(m[12], m[13], m[14]);
    _ang[i].copy(_z);
    _lin[i].subVectors(_tool, _p).cross(_z).multiplyScalar(-1);
  }

  /* A = J J^T + lambda^2 I. Damped rather than pseudo-inverted, because the
     arm passes through configurations where columns are parallel and an
     undamped solve there asks for an infinite joint rate. */
  for (let r = 0; r < 6; r++) {
    for (let c = 0; c < 6; c++) {
      let s = 0;
      for (let i = 0; i < 6; i++) {
        const jr = r < 3 ? _lin[i].getComponent(r) : _ang[i].getComponent(r - 3);
        const jc = c < 3 ? _lin[i].getComponent(c) : _ang[i].getComponent(c - 3);
        s += jr * jc;
      }
      _A[r * 6 + c] = s + (r === c ? LAMBDA * LAMBDA : 0);
    }
  }
  if (!solve6(_A, _err, _w)) return perr;
  for (let i = 0; i < 6; i++) {
    let d = 0;
    for (let r = 0; r < 3; r++) d += _lin[i].getComponent(r) * _w[r];
    for (let r = 3; r < 6; r++) d += _ang[i].getComponent(r - 3) * _w[r];
    // A step cap as well as the limits: an ill-conditioned solve near a
    // singularity asks for a large joint change, and taking it lands
    // somewhere the next iteration has to undo.
    q[i] = Math.min(HI[i], Math.max(LO[i], q[i] + Math.max(-0.25, Math.min(0.25, gain * d))));
  }
  return perr;
}

/* Solve from a seed, in the arm's own base frame. The seed matters: this is
   a local method and it returns the solution nearest what it was given, which
   is exactly what a controller wants -- the arm should get to the next point
   from where it is rather than flipping through the shoulder to a mirror
   configuration that happens to be one iteration closer. */
export function solve(seed, target, out, iters = 24, dir = DOWN) {
  if (out !== seed) for (let i = 0; i < 6; i++) out[i] = seed[i];
  for (let i = 0; i < 6; i++) out[i] = Math.min(HI[i], Math.max(LO[i], out[i]));
  let err = Infinity;
  for (let k = 0; k < iters; k++) {
    err = step(out, target, dir, 0.8);
    if (err < 1e-4) break;
  }
  return err;
}

/* Where the tool is for a configuration, for a caller that has a joint vector
   and wants a point without keeping its own frames around. */
export function tcp(q, out) {
  linkFrames(q, _frames);
  return toolPoint(_frames, out || new THREE.Vector3());
}

/* And which way it is pointing, for anything that needs to know whether the
   gripper is actually facing the work. */
export function tcpAxis(q, out) {
  linkFrames(q, _frames);
  const m = _frames[5].elements;
  return (out || new THREE.Vector3()).set(m[8], m[9], m[10]);
}

export { TCP_Z };
