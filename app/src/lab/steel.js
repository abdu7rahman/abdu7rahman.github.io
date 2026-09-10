/* Structural members as instances of one box, placed by where they run.
 *
 * A member is a length of steel between two points with a section. That is
 * all any of the arithmetic here is: given the two ends and a section, work
 * out the matrix that takes a unit box to it. Everything the building is
 * made of -- chords, diagonals, purlins, bracing, the crane girder -- goes
 * through this, so the whole steel frame is one InstancedMesh and one draw
 * call, including into the shadow map.
 *
 * Which is also what makes a lattice affordable. A truss drawn as a solid
 * box is one member and reads as a beam; drawn properly it is about
 * twenty-seven members and reads as a truss, and the difference between
 * those two is most of what makes a shed look like a shed. At one draw call
 * for three hundred of them there is no reason to draw the beam.
 */
import * as THREE from "three";

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _d = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _m = new THREE.Matrix4();

/* One member, as a matrix for a unit box centred on the origin.
 *
 * The box's local y is its length, so the rotation is whatever takes +y onto
 * the member's direction -- setFromUnitVectors, which handles the antiparallel
 * case that a naive lookAt gets wrong and which happens here every time a
 * member runs straight down.
 */
export function member(out, ax, ay, az, bx, by, bz, w, t) {
  _a.set(ax, ay, az); _b.set(bx, by, bz);
  _d.subVectors(_b, _a);
  const len = _d.length();
  if (len < 1e-6) return out.identity();
  _d.divideScalar(len);
  _q.setFromUnitVectors(_up, _d);
  _s.set(w, len, t === undefined ? w : t);
  return out.compose(_a.addScaledVector(_d, len / 2), _q, _s);
}

/* A parallel-chord lattice truss in the x-y plane at a given z, as a list of
 * member end pairs.
 *
 * Warren, with verticals: diagonals alternating direction between the chords
 * plus a post at every panel point. It is the pattern almost every portal
 * frame shed in the world is built from, and the reason is that a Warren
 * truss puts every diagonal into pure tension or pure compression, so the
 * members can be thin -- which is exactly why it looks like this and why a
 * solid beam of the same depth would be absurd.
 */
export function truss(span, depth, panels, yTop, z) {
  const out = [];
  const half = span / 2;
  const step = span / panels;
  const yBot = yTop - depth;
  // Chords, in one length each: a chord is continuous steel and drawing it
  // as panels would put a joint where there is none.
  out.push([-half, yTop, z, half, yTop, z]);
  out.push([-half, yBot, z, half, yBot, z]);
  for (let i = 0; i < panels; i++) {
    const x0 = -half + i * step, x1 = x0 + step;
    // Alternating diagonal, which is what makes it a Warren and not a Pratt.
    if (i % 2 === 0) out.push([x0, yBot, z, x1, yTop, z]);
    else out.push([x0, yTop, z, x1, yBot, z]);
    if (i > 0) out.push([x0, yBot, z, x0, yTop, z]);
  }
  return out;
}

/* An I-section, as three members: two flanges and a web. Not a box.
 *
 * A universal column seen from the aisle is a pair of bright flange edges
 * with a shadowed web between them, and that is the whole read -- a box
 * catches one highlight and reads as a post. Three instances instead of
 * one, eleven frames, twenty-two columns: sixty-six members, still one
 * draw call.
 */
export function column(x, z, height, d, bf, tf, tw) {
  return [
    [x, 0, z - d / 2 + tf / 2, x, height, z - d / 2 + tf / 2, bf, tf],
    [x, 0, z + d / 2 - tf / 2, x, height, z + d / 2 - tf / 2, bf, tf],
    [x, 0, z, x, height, z, tw, d - 2 * tf]
  ];
}
