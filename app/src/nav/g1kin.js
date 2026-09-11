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
  constructor(tree, joints, end, { lambda = 0.05, step = 0.6, limits, tip } = {}) {
    this.tree = tree;
    this.joints = joints.slice();
    this.end = end;
    this.lambda = lambda;
    this.step = step;
    /* The point being solved for, in the end link's own frame.
     *
     * Without one, a chain solves for the origin of its last link, and for a
     * hand that is the wrist: the G1's hand is a 133 mm casting hanging off
     * it, so putting the wrist on a rail puts the rail through the back of
     * the hand and out past the fingers. The offset is read off the casting
     * (see handFrame) rather than chosen. */
    this.tip = tip ? tip.clone() : null;
    this.path = ancestry(tree, end);
    this.f = {};
    for (const i of this.path) this.f[i] = new THREE.Matrix4();
    this.cols = this.joints.map(() => new THREE.Vector3());
    this.ang = this.joints.map(() => new THREE.Vector3());
    /* Which joints are further down the chain than a given link, filled in
       by the caller's first solve. A joint past the elbow cannot move it. */
    this.beyond = this.joints.map(() => false);
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
    if (this.tip) return (out || this._p).copy(this.tip).applyMatrix4(f[this.end]);
    return (out || this._p).setFromMatrixPosition(f[this.end]);
  }

  /* The world matrix of any link on the chain, valid after fk(). */
  frame(i) { return this.f[i]; }

  /* Position and orientation, over however many joints the chain has.
   *
   * The position-only solve above is the right shape for a foot: a foot has
   * to be somewhere, and which way it is turned is handled afterwards by
   * making the three pitch joints sum to the sole's pitch. A hand holding
   * something is not that. A rail lies along a direction, the fingers close
   * in a direction, and both have to be satisfied at once or the hand ends
   * up at the right point with the rail passing through the back of it.
   *
   * The error is six numbers: three of position, and the rotation vector
   * that takes the hand's frame onto the wanted one. The rotation part is
   * Siciliano's form -- half the sum of the cross products of the three
   * frame axes with their targets -- which is well behaved for the angles a
   * hand actually has to turn through and costs three cross products.
   *
   * The Jacobian gains three rows: for a revolute joint the angular column
   * is the joint's own world axis, which is already computed for the linear
   * column. So a pose solve is the same frames, the same axes, and a six by
   * six solve instead of a three by three.
   */
  /* `elbow`, when given, is a link on the chain that is pushed forward of
     the body in whatever freedom the task leaves over. See the null-space
     note below. */
  solvePose(q, pos, rot, iters = 10, elbow = -1) {
    const { joints, cols, ang, f, tree } = this;
    const n = joints.length;
    let err = Infinity;
    for (let it = 0; it < iters; it++) {
      this.fk(q, this._p);
      const m = f[this.end];
      _e6[0] = pos.x - this._p.x;
      _e6[1] = pos.y - this._p.y;
      _e6[2] = pos.z - this._p.z;
      /* The orientation error, axis by axis. `rot` is a Matrix4 whose basis
         is the frame the end link should be in. */
      let ox = 0, oy = 0, oz = 0;
      const me = m.elements, re = rot.elements;
      for (let c = 0; c < 3; c++) {
        const ax = me[c * 4], ay = me[c * 4 + 1], az = me[c * 4 + 2];
        const bx = re[c * 4], by = re[c * 4 + 1], bz = re[c * 4 + 2];
        ox += ay * bz - az * by;
        oy += az * bx - ax * bz;
        oz += ax * by - ay * bx;
      }
      _e6[3] = 0.5 * ox; _e6[4] = 0.5 * oy; _e6[5] = 0.5 * oz;
      const perr = Math.hypot(_e6[0], _e6[1], _e6[2]);
      const rerr = Math.hypot(_e6[3], _e6[4], _e6[5]);
      err = perr;
      if (perr < 1e-4 && rerr < 1e-3) break;

      for (let c = 0; c < n; c++) {
        const i = joints[c];
        const axv = tree.links[i].joint.axis;
        _axis.set(axv[0], axv[1], axv[2]).normalize().transformDirection(f[i]);
        _pos.setFromMatrixPosition(f[i]);
        ang[c].copy(_axis);
        cols[c].set(this._p.x - _pos.x, this._p.y - _pos.y, this._p.z - _pos.z)
               .cross(_axis).multiplyScalar(-1);
      }
      /* (J J^T + lambda^2 I) w = e over six rows. The orientation rows are
         weighted down: a hand is wanted in the right place first and turned
         the right way second, and an unweighted solve spends the chain's
         redundancy arguing about the last few degrees of wrist. */
      const A = _a36, lam = this.lambda * this.lambda;
      for (let r = 0; r < 6; r++) {
        for (let c2 = 0; c2 < 6; c2++) {
          let sum = 0;
          for (let i = 0; i < n; i++) {
            const jr = r < 3 ? cols[i].getComponent(r) : ang[i].getComponent(r - 3) * ORI;
            const jc = c2 < 3 ? cols[i].getComponent(c2) : ang[i].getComponent(c2 - 3) * ORI;
            sum += jr * jc;
          }
          A[r * 6 + c2] = sum + (r === c2 ? lam : 0);
        }
      }
      for (let r = 3; r < 6; r++) _e6[r] *= ORI;
      // Keep a copy: solve6 eliminates in place and the null-space step
      // below needs the same matrix again.
      if (elbow >= 0) for (let i = 0; i < 36; i++) _a36b[i] = A[i];
      if (!solve6(A, _e6, _w6)) break;

      /* The elbow, in whatever freedom is left over.
       *
       * Seven joints doing a six-number task leaves exactly one degree of
       * freedom, and on an arm it is the swivel of the elbow about the line
       * from shoulder to hand. Nothing was using it, so the solver left the
       * elbow wherever the descent happened to put it -- measured with both
       * hands on a sign's rail, that was 3 mm inside the chest on both
       * sides: the forearms went through the torso to get to the board.
       *
       * So the spare freedom is spent pushing the elbow forward of the body.
       * Projected into the null space, which is what makes it free: the
       * hands do not move to pay for it, they cannot, the projection removes
       * exactly the component of the motion that would move them.
       */
      let nx = null;
      if (elbow >= 0 && f[elbow]) {
        _ep.setFromMatrixPosition(f[elbow]);
        for (let c = 0; c < n; c++) {
          const i = joints[c];
          // Joints past the elbow cannot move it.
          if (this.beyond[c]) { _z7[c] = 0; continue; }
          const axv = tree.links[i].joint.axis;
          _axis.set(axv[0], axv[1], axv[2]).normalize().transformDirection(f[i]);
          _pos.setFromMatrixPosition(f[i]);
          _t1.set(_ep.x - _pos.x, _ep.y - _pos.y, _ep.z - _pos.z).cross(_axis).multiplyScalar(-1);
          // Forward, away from the chest.
          _z7[c] = _t1.x;
        }
        // u = (J J^T + lambda^2 I)^-1 (J z)
        for (let r = 0; r < 6; r++) {
          let sum = 0;
          for (let c = 0; c < n; c++) {
            const jr = r < 3 ? cols[c].getComponent(r) : ang[c].getComponent(r - 3) * ORI;
            sum += jr * _z7[c];
          }
          _jz[r] = sum;
        }
        nx = solve6(_a36b, _jz, _u6);
      }

      for (let c = 0; c < n; c++) {
        let d = 0;
        for (let r = 0; r < 3; r++) d += cols[c].getComponent(r) * _w6[r];
        for (let r = 3; r < 6; r++) d += ang[c].getComponent(r - 3) * ORI * _w6[r];
        if (nx) {
          // z minus its component in the task's row space.
          let back = 0;
          for (let r = 0; r < 3; r++) back += cols[c].getComponent(r) * _u6[r];
          for (let r = 3; r < 6; r++) back += ang[c].getComponent(r - 3) * ORI * _u6[r];
          d += SWIVEL * (_z7[c] - back);
        }
        const lim = this.limits[c];
        const v = (q[joints[c]] || 0) + Math.max(-0.35, Math.min(0.35, this.step * d));
        q[joints[c]] = v < lim[0] ? lim[0] : v > lim[1] ? lim[1] : v;
      }
    }
    return err;
  }

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

/* Where a bar sits in this robot's hand, measured off the hand.
 *
 * The G1's hand is a moulded rubber casting with no joints in it, so holding
 * something is a matter of putting the hand in the right place at the right
 * angle rather than of closing anything. Which means the one thing that has
 * to be right is where "the right place" is, and that is not the wrist: the
 * casting runs 133 mm past the wrist yaw origin, so a solve that puts the
 * wrist on a rail puts the whole hand through it and out the other side.
 *
 * Read off the mesh rather than typed. The hand is the larger of the two
 * parts on the wrist yaw link. Its long axis is the link's x. Slicing along
 * that axis, the far third is the fingers -- they are the part that reaches
 * off to one side in y -- and which side they reach is which way the hand
 * closes. So:
 *
 *   grip   a point 58 per cent along the casting, offset toward the fingers
 *          by half their reach: the middle of the enclosed space
 *   close  the unit vector the fingers curl along
 *   along  the link's z, which is across the palm and is therefore the
 *          direction a held bar runs
 *
 * Left and right are mirrored castings and this finds each one's own sign
 * rather than assuming the mirror.
 */
function handFrame(tree, linkIndex) {
  const parts = tree.links[linkIndex].parts;
  if (!parts.length) return null;
  let hand = parts[0];
  for (const p of parts) if (p.f.length > hand.f.length) hand = p;
  const u = tree.unit;
  let xmin = Infinity, xmax = -Infinity;
  for (let k = 0; k < hand.v.length; k += 3) {
    const x = hand.v[k] * u;
    if (x < xmin) xmin = x;
    if (x > xmax) xmax = x;
  }
  const span = xmax - xmin;
  // The fingers: the far third of the casting.
  const cut = xmin + span * 0.66;
  let far = 0, ymin = 0, ymax = 0;
  for (let k = 0; k < hand.v.length; k += 3) {
    if (hand.v[k] * u < cut) continue;
    const y = hand.v[k + 1] * u;
    if (y < ymin) ymin = y;
    if (y > ymax) ymax = y;
    far++;
  }
  // Whichever way they reach further is the way they close.
  const sign = Math.abs(ymin) >= Math.abs(ymax) ? -1 : 1;
  const reach = Math.max(Math.abs(ymin), Math.abs(ymax));
  return {
    grip: new THREE.Vector3(xmin + span * 0.58, sign * reach * 0.5, 0),
    close: new THREE.Vector3(0, sign, 0),
    along: new THREE.Vector3(0, 0, 1),
    length: span,
    fingers: far
  };
}

/* How much the orientation rows count against the position ones. A hand is
   wanted in the right place first and turned the right way second; unweighted,
   the solve spends the chain's redundancy arguing about the last few degrees
   of wrist while the palm sits a centimetre off the rail. */
const ORI = 0.45;
/* How hard the spare freedom is used.
 *
 * Small, and measured rather than picked. The projection is against a damped
 * inverse rather than a true pseudo-inverse, so it is not an exact null
 * projector and a little of the secondary motion leaks into the task. At 0.9
 * the elbow sat 187 mm in front of the chest and the palm 11.3 mm off the
 * rail; at 0.22 the elbow sits 185 mm in front and the palm 3.3 mm off. The
 * elbow ends up in the same place either way -- it is converging to a swivel
 * angle, not being shoved -- so the extra gain buys nothing and costs the
 * grip. */
const SWIVEL = 0.22;
const _e6 = new Float64Array(6);
const _a36b = new Float64Array(36);
const _jz = new Float64Array(6);
const _u6 = new Float64Array(6);
const _z7 = new Float64Array(12);
const _ep = new THREE.Vector3();
const _t1 = new THREE.Vector3();
const _w6 = new Float64Array(6);
const _a36 = new Float64Array(36);

/* Six by six, Gauss with partial pivoting -- the same routine sim/ik.js uses
   on the arm and for the same reason: at this size an explicit inverse is
   more arithmetic and more code. */
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
    let sum = e[r];
    for (let k = r + 1; k < n; k++) sum -= A[r * n + k] * w[k];
    w[r] = sum / A[r * n + r];
  }
  return true;
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
      /* Four joints place a wrist; seven place a hand. The wrist roll, pitch
         and yaw exist on this robot and were being left at zero, which is
         fine for an arm that swings and useless for one that has to hold
         something at an angle somebody chose. */
      joints: [L[`${side}_shoulder_pitch_link`], L[`${side}_shoulder_roll_link`],
               L[`${side}_shoulder_yaw_link`], L[`${side}_elbow_link`]],
      full: [L[`${side}_shoulder_pitch_link`], L[`${side}_shoulder_roll_link`],
             L[`${side}_shoulder_yaw_link`], L[`${side}_elbow_link`],
             L[`${side}_wrist_roll_link`], L[`${side}_wrist_pitch_link`],
             L[`${side}_wrist_yaw_link`]],
      end: L[`${side}_wrist_yaw_link`],
      elbow: L[`${side}_elbow_link`],
      hand: handFrame(tree, L[`${side}_wrist_yaw_link`])
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
