import * as THREE from "three";

/* Kinematics over a baked robot tree: forward, and inverse for any chain in
 * it.
 *
 * assets/g1.json carries the parent, the offset, the orientation, the joint
 * axis and the limits of all thirty links, straight out of Menagerie's MJCF.
 * That is enough to compute anything about the robot, so nothing about the
 * robot is written here as a number -- not a leg length, not a hip offset,
 * not a stance height. Every one of them is read off the tree.
 *
 * The inverse solve is general on purpose. A closed form for the G1's leg is
 * possible and it is not simple: the joint order is pitch, then roll, then
 * yaw, so the roll axis is already pitched by the time it is used, and the
 * thigh carries 54 mm of lateral offset between the hip pitch axis and the
 * knee, which means the knee and the ankle are not in a plane through the
 * hip. A closed form that ignores either of those is out by 8 per cent of the
 * leg and the feet skate. A closed form that handles both is a page of
 * trigonometry specific to this robot and useless for the next one.
 *
 * So this is damped least squares on the exact Jacobian of whatever chain it
 * is handed -- the same method app/src/sim/ik.js uses for the UR12e, and for
 * the same reason. It is seeded from the previous frame, which is what makes
 * six iterations enough: a gait moves a foot two centimetres between frames.
 * Give it a leg and it walks; give it an arm and the same code holds a sign
 * level.
 */

const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _one = new THREE.Vector3(1, 1, 1);
const _rot = new THREE.Matrix4();
const _axis = new THREE.Vector3();

/* Every link's transform relative to the root. The bake is emitted depth
   first, so a parent is always already done when its child is reached. */
export function frames(tree, q, out) {
  const links = tree.links;
  for (let i = 0; i < links.length; i++) {
    const l = links[i], qq = l.quat;
    _quat.set(qq[1], qq[2], qq[3], qq[0]);
    _pos.set(l.pos[0], l.pos[1], l.pos[2]);
    out[i].compose(_pos, _quat, _one);
    if (l.joint) {
      _axis.set(l.joint.axis[0], l.joint.axis[1], l.joint.axis[2]).normalize();
      _rot.makeRotationAxis(_axis, q[i] || 0);
      out[i].multiply(_rot);
    }
    if (l.parent >= 0) out[i].premultiply(out[l.parent]);
  }
  return out;
}

export function newFrames(tree) {
  return Array.from({ length: tree.links.length }, () => new THREE.Matrix4());
}

export function indexByLink(tree) {
  const m = {};
  tree.links.forEach((l, i) => { m[l.name] = i; });
  return m;
}

export function ancestry(tree, i) {
  const out = [];
  for (let k = i; k >= 0; k = tree.links[k].parent) out.push(k);
  return out.reverse();
}

/* Inverse kinematics for one chain: move the joints in `joints` so that the
 * origin of `end` lands on a target given in the root's frame.
 *
 * Only the chain's own links are evaluated, so a leg solve is seven matrix
 * compositions per iteration rather than thirty. The Jacobian column for a
 * revolute joint is its world axis crossed with the vector from the joint to
 * the end, which is exact and free once the frames exist.
 */
export class ChainIK {
  constructor(tree, joints, end, { lambda = 0.05, step = 0.6, limits } = {}) {
    this.tree = tree;
    this.joints = joints.slice();
    this.end = end;
    this.lambda = lambda;
    this.step = step;
    this.path = ancestry(tree, end);
    this.f = {};
    for (const i of this.path) this.f[i] = new THREE.Matrix4();
    this.cols = this.joints.map(() => new THREE.Vector3());
    /* Limits, and they are the difference between a solver that works and
     * one that is merely correct.
     *
     * The bake carries the hardware's own range for every joint, and for a
     * hip that is plus or minus about 2.7 rad -- enough that a leg can reach
     * a point below the body by folding up and pointing at it from above.
     * Damped least squares near a singularity will take that branch: measured
     * on a 0.7 m/s walk with the hardware limits, the left leg flipped to
     * straight up on frame 477 and stayed there, 1.18 m from the foot it was
     * asked for, and the walk became a machine dragging one leg over its own
     * head.
     *
     * So a caller that knows which branch it wants says so, exactly as
     * app/src/sim/ik.js does for the arm, and for the same reason: not
     * because the other solutions are wrong but because a machine that
     * chooses between them mid-step is not walking.
     */
    this.limits = joints.map((i, k) => {
      if (limits && limits[k]) return limits[k];
      const j = tree.links[i].joint;
      return j && j.range ? j.range : [-Math.PI, Math.PI];
    });
    this._p = new THREE.Vector3();
    this._e = new THREE.Vector3();
    this._a = new Float64Array(9);
    this._w = new Float64Array(3);
  }

  /* Forward, restricted to the chain. Returns the end origin. */
  fk(q, out) {
    const { tree, path, f } = this;
    for (const i of path) {
      const l = tree.links[i], qq = l.quat;
      _quat.set(qq[1], qq[2], qq[3], qq[0]);
      _pos.set(l.pos[0], l.pos[1], l.pos[2]);
      f[i].compose(_pos, _quat, _one);
      if (l.joint) {
        _axis.set(l.joint.axis[0], l.joint.axis[1], l.joint.axis[2]).normalize();
        _rot.makeRotationAxis(_axis, q[i] || 0);
        f[i].multiply(_rot);
      }
      if (l.parent >= 0 && f[l.parent]) f[i].premultiply(f[l.parent]);
    }
    return (out || this._p).setFromMatrixPosition(f[this.end]);
  }

  /* The world matrix of any link on the chain, valid after fk(). */
  frame(i) { return this.f[i]; }

  solve(q, tx, ty, tz, iters = 6) {
    const { joints, cols, f, tree } = this;
    const n = joints.length;
    let err = Infinity;
    for (let it = 0; it < iters; it++) {
      this.fk(q, this._p);
      this._e.set(tx - this._p.x, ty - this._p.y, tz - this._p.z);
      err = this._e.length();
      if (err < 1e-5) break;
      for (let c = 0; c < n; c++) {
        const i = joints[c];
        const m = f[i].elements;
        const ax = tree.links[i].joint.axis;
        // The joint's axis, taken into the root frame by its own link's
        // rotation. The link's matrix already includes the joint rotation,
        // which does not change the axis it turns about.
        _axis.set(ax[0], ax[1], ax[2]).normalize().transformDirection(f[i]);
        _pos.setFromMatrixPosition(f[i]);
        cols[c].set(this._p.x - _pos.x, this._p.y - _pos.y, this._p.z - _pos.z)
               .cross(_axis).multiplyScalar(-1);
      }
      // (J J^T + lambda^2 I) w = e, then dq = J^T w. Three by three whatever
      // the chain length, which is why this form and not the pseudo-inverse.
      const A = this._a, lam = this.lambda * this.lambda;
      for (let r = 0; r < 3; r++) {
        for (let c2 = 0; c2 < 3; c2++) {
          let s = 0;
          for (let i = 0; i < n; i++) s += cols[i].getComponent(r) * cols[i].getComponent(c2);
          A[r * 3 + c2] = s + (r === c2 ? lam : 0);
        }
      }
      if (!solve3(A, this._e, this._w)) break;
      for (let c = 0; c < n; c++) {
        const d = cols[c].x * this._w[0] + cols[c].y * this._w[1] + cols[c].z * this._w[2];
        const lim = this.limits[c];
        let v = (q[joints[c]] || 0) + Math.max(-0.35, Math.min(0.35, this.step * d));
        q[joints[c]] = v < lim[0] ? lim[0] : v > lim[1] ? lim[1] : v;
      }
    }
    return err;
  }
}

/* Three by three, Gauss with partial pivoting. */
function solve3(A, e, w) {
  const b = [e.x, e.y, e.z];
  for (let c = 0; c < 3; c++) {
    let piv = c, best = Math.abs(A[c * 3 + c]);
    for (let r = c + 1; r < 3; r++) {
      const v = Math.abs(A[r * 3 + c]);
      if (v > best) { best = v; piv = r; }
    }
    if (best < 1e-12) return false;
    if (piv !== c) {
      for (let k = 0; k < 3; k++) { const t = A[c * 3 + k]; A[c * 3 + k] = A[piv * 3 + k]; A[piv * 3 + k] = t; }
      const t = b[c]; b[c] = b[piv]; b[piv] = t;
    }
    const d = A[c * 3 + c];
    for (let r = c + 1; r < 3; r++) {
      const m = A[r * 3 + c] / d;
      if (!m) continue;
      for (let k = c; k < 3; k++) A[r * 3 + k] -= m * A[c * 3 + k];
      b[r] -= m * b[c];
    }
  }
  for (let r = 2; r >= 0; r--) {
    let s = b[r];
    for (let k = r + 1; k < 3; k++) s -= A[r * 3 + k] * w[k];
    w[r] = s / A[r * 3 + r];
  }
  return true;
}

/* The measurements a gait needs, all of them read off the tree at zero.
 *
 * `stand` is the one that matters most: how far the sole of the foot is
 * below the pelvis origin with the leg straight. Everything about the walk
 * -- how high the pelvis rides, how much it can drop into a step, how long a
 * stride can be before the leg runs out -- is a fraction of it, and it is
 * measured rather than chosen.
 */
export function measure(tree) {
  const L = indexByLink(tree);
  const zero = new Float32Array(tree.links.length);
  const f = newFrames(tree);
  frames(tree, zero, f);
  const at = n => new THREE.Vector3().setFromMatrixPosition(f[L[n]]);
  const pelvis = at("pelvis");
  const out = { link: L, legs: {}, arms: {} };
  for (const side of ["left", "right"]) {
    const hip = at(`${side}_hip_pitch_link`);
    const knee = at(`${side}_knee_link`);
    const ankle = at(`${side}_ankle_roll_link`);
    out.legs[side] = {
      hip: hip.clone().sub(pelvis),
      thigh: knee.distanceTo(hip),
      shank: ankle.distanceTo(knee),
      /* Reach is not thigh plus shank: the thigh's lateral offset means a
         straight leg is shorter than the sum of its links. Measured. */
      reach: ankle.distanceTo(hip),
      ankle: ankle.clone().sub(pelvis),
      joints: [L[`${side}_hip_pitch_link`], L[`${side}_hip_roll_link`], L[`${side}_knee_link`]],
      pitchJoints: [L[`${side}_hip_pitch_link`], L[`${side}_knee_link`], L[`${side}_ankle_pitch_link`]],
      rollJoints: [L[`${side}_hip_roll_link`], L[`${side}_ankle_roll_link`]],
      end: L[`${side}_ankle_roll_link`]
    };
    const sh = at(`${side}_shoulder_pitch_link`);
    const wr = at(`${side}_wrist_yaw_link`);
    out.arms[side] = {
      shoulder: sh.clone().sub(pelvis),
      reach: wr.distanceTo(sh),
      joints: [L[`${side}_shoulder_pitch_link`], L[`${side}_shoulder_roll_link`],
               L[`${side}_shoulder_yaw_link`], L[`${side}_elbow_link`]],
      end: L[`${side}_wrist_yaw_link`]
    };
  }
  /* Sole to ankle: the foot geometry's own lowest triangle under the ankle
     roll link, so the robot stands on the floor rather than 4 cm into it. */
  let lowest = Infinity;
  const foot = tree.links[L.left_ankle_roll_link];
  for (const part of foot.parts) {
    for (let k = 2; k < part.v.length; k += 3) {
      const z = part.v[k] * tree.unit;
      if (z < lowest) lowest = z;
    }
  }
  out.soleDrop = isFinite(lowest) ? -lowest : 0;
  out.pelvisHeight = pelvis.z;
  out.stand = pelvis.z - (at("left_ankle_roll_link").z - out.soleDrop);
  return out;
}
