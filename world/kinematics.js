/* UR12e forward kinematics, as a module.
 *
 * The six joint origins are config/ur12e/default_kinematics.yaml from
 * Universal_Robots_ROS2_Description, by way of predictive_replanning.ur12e --
 * the same numbers the baked hero motion was computed from, and checked
 * against it to 4.7e-06, which is float32 storage precision.
 *
 * Three.js-shaped rather than the flat 3x4 the old renderer used: these come
 * out as Matrix4 so a Group hierarchy can take them directly.
 */
import * as THREE from "three";

const ORIGINS = [
  [0, 0, 0.1807, 0, 0, 0],
  [0, 0, 0, Math.PI / 2, 0, 0],
  [-0.6127, 0, 0, 0, 0, 0],
  [-0.57155, 0, 0.17415, 0, 0, 0],
  [0, -0.11985, 0, Math.PI / 2, 0, 0],
  [0, 0.11655, 0, Math.PI / 2, Math.PI, Math.PI]
];
export const TCP_Z = 0.1565;
export const REST = [0.52, -1.02, 1.3, -1.86, -1.57, 0];

/* The model is Z-up, the way every URDF is; the world is Y-up, the way every
   renderer is. Rotating -90 about X sends the model's +Z to world +Y, which
   also puts the base plate exactly on y=0 -- measured, not assumed: the
   bounding box over the whole pose sequence has min.y = -0.000. Without this
   the arm lies on its side pointing at the camera, which is what it was
   doing. */
export const UPRIGHT = new THREE.Matrix4().makeRotationX(-Math.PI / 2);

/* The move the hero plays. Four waypoints, interpolated with a smoothstep so
   the arm eases in and out of each rather than arriving at constant velocity
   and stopping dead. */
export const POSES = [
  [ 0.52, -1.02, 1.30, -1.86, -1.57,  0.00],
  [ 0.16, -1.28, 1.62, -1.92, -1.57, -0.22],
  [-0.31, -0.96, 1.21, -1.79, -1.57, -0.44],
  [-0.05, -1.10, 1.42, -1.88, -1.57, -0.10]
];

export function poseAt(u, out) {
  const q = out || new Array(6);
  const f = Math.min(1, Math.max(0, u)) * (POSES.length - 1);
  const i = Math.min(POSES.length - 2, Math.floor(f));
  let t = f - i;
  t = t * t * (3 - 2 * t);
  for (let k = 0; k < 6; k++) q[k] = POSES[i][k] + (POSES[i + 1][k] - POSES[i][k]) * t;
  return q;
}

/* URDF fixed-axis XYZ: R = Rz(yaw) Ry(pitch) Rx(roll). Three's default Euler
   order is XYZ *intrinsic*, which is not the same thing; ZYX intrinsic is. */
function originMatrix([x, y, z, r, p, yw]) {
  const m = new THREE.Matrix4();
  m.makeRotationFromEuler(new THREE.Euler(r, p, yw, "ZYX"));
  m.setPosition(x, y, z);
  return m;
}
const O = ORIGINS.map(originMatrix);

export function linkFrames(q, out) {
  const frames = out || Array.from({ length: 6 }, () => new THREE.Matrix4());
  const cur = new THREE.Matrix4();
  const rot = new THREE.Matrix4();
  for (let i = 0; i < 6; i++) {
    rot.makeRotationZ(q[i]);
    if (i === 0) cur.copy(O[0]).multiply(rot);
    else cur.multiply(O[i]).multiply(rot);
    frames[i].copy(cur);
  }
  return frames;
}

/* Tool point, in the base frame: the gripper origin carried down its own z. */
export function toolPoint(frames, v) {
  const m = frames[5].elements;
  const out = v || new THREE.Vector3();
  return out.set(m[12] + m[8] * TCP_Z, m[13] + m[9] * TCP_Z, m[14] + m[10] * TCP_Z);
}
