import * as THREE from "three";

/* Per-face normals welded only across shallow creases.
 *
 * The same routine world/world.js uses on this mesh, written out again here
 * rather than imported because it is a private function in that file. Worth
 * the duplication in a way the kinematics are not: this is twenty lines of
 * geometry with no measured constants in it, so the two copies cannot
 * disagree about anything that matters, while a second copy of the link
 * frames could quietly disagree about where the robot is.
 *
 * A UR's caps are turned surfaces meeting flanges at a hard edge. Smooth
 * everything and the flanges melt; smooth nothing and the turned surfaces
 * facet. Welding under a threshold keeps both.
 */
export function creaseNormals(pos, degrees = 78) {
  const n = pos.length / 3;
  const out = new Float32Array(pos.length);
  const cos = Math.cos((degrees * Math.PI) / 180);
  const key = new Map();
  const faceN = new Float32Array((n / 3) * 3);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), f = new THREE.Vector3();

  for (let t = 0; t < n; t += 3) {
    a.fromArray(pos, t * 3); b.fromArray(pos, (t + 1) * 3); c.fromArray(pos, (t + 2) * 3);
    e1.subVectors(b, a); e2.subVectors(c, a);
    f.crossVectors(e1, e2).normalize();
    faceN[t] = f.x; faceN[t + 1] = f.y; faceN[t + 2] = f.z;
    for (let k = 0; k < 3; k++) {
      const i = t + k;
      const q = `${Math.round(pos[i*3]*2e3)},${Math.round(pos[i*3+1]*2e3)},${Math.round(pos[i*3+2]*2e3)}`;
      let arr = key.get(q); if (!arr) key.set(q, arr = []);
      arr.push(t);
    }
  }
  for (let t = 0; t < n; t += 3) {
    for (let k = 0; k < 3; k++) {
      const i = t + k;
      const q = `${Math.round(pos[i*3]*2e3)},${Math.round(pos[i*3+1]*2e3)},${Math.round(pos[i*3+2]*2e3)}`;
      const share = key.get(q) || [t];
      let x = 0, y = 0, z = 0;
      for (const s of share) {
        const d = faceN[t] * faceN[s] + faceN[t+1] * faceN[s+1] + faceN[t+2] * faceN[s+2];
        if (d >= cos) { x += faceN[s]; y += faceN[s+1]; z += faceN[s+2]; }
      }
      const L = Math.hypot(x, y, z) || 1;
      out[i*3] = x / L; out[i*3+1] = y / L; out[i*3+2] = z / L;
    }
  }
  return out;
}
