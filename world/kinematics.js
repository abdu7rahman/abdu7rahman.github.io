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
