import * as THREE from "three";

/* Per-face normals welded only across shallow creases.
 *
 * The same routine world/world.js uses on this mesh, written out again here
 * rather than imported because it is a private function in that file. Worth
 * the duplication in a way the kinematics are not: this is thirty lines of
 * geometry with no measured constants in it, so the two copies cannot
 * disagree about anything that matters, while a second copy of the link
 * frames could quietly disagree about where the robot is.
 *
 * A UR's caps are turned surfaces meeting flanges at a hard edge. Smooth
 * everything and the flanges melt; smooth nothing and the turned surfaces
 * facet. Welding under a threshold keeps both.
 *
 * Which corners are the same vertex is the part worth being careful about.
 * Given only the expanded triangle soup there is nothing to go on but
 * position, and position has to be rounded to be a key -- so two points a
 * third of a millimetre apart on opposite sides of a panel gap land in the
 * same bucket and get each other's normals averaged in. On the G1 that is
 * 6295 of 40007 vertices, sixteen per cent, and where two shells run close
 * together -- the shoulder cap against the chest, the neck seam -- it shows
 * as a dark zigzag along the join. So callers that know the answer pass it:
 * `groups` is the source index of each corner, which is exact, has no
 * threshold in it, and costs nothing to use.
 */
export function creaseNormals(pos, degrees = 78, groups = null) {
  const n = pos.length / 3;
  const out = new Float32Array(pos.length);
  const cos = Math.cos((degrees * Math.PI) / 180);
  const faceN = new Float32Array((n / 3) * 3);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), f = new THREE.Vector3();

  /* One integer per corner saying which vertex it is. From the caller when
     it knows, otherwise from a half-millimetre grid over the positions. */
  const gid = new Int32Array(n);
  let count = 0;
  if (groups) {
    for (let i = 0; i < n; i++) {
      const g = groups[i];
      gid[i] = g;
      if (g >= count) count = g + 1;
    }
  } else {
    const key = new Map();
    for (let i = 0; i < n; i++) {
      const q = `${Math.round(pos[i*3]*2e3)},${Math.round(pos[i*3+1]*2e3)},${Math.round(pos[i*3+2]*2e3)}`;
      let g = key.get(q);
      if (g === undefined) key.set(q, g = count++);
      gid[i] = g;
    }
  }

  /* The corners sharing each vertex, as a linked list threaded through two
     typed arrays rather than an array of arrays -- one allocation instead of
     one per vertex, which on a 90,000 triangle robot is the difference
     between a hitch and not. */
  const head = new Int32Array(count).fill(-1);
  const next = new Int32Array(n).fill(-1);

  for (let t = 0; t < n; t += 3) {
    a.fromArray(pos, t * 3); b.fromArray(pos, (t + 1) * 3); c.fromArray(pos, (t + 2) * 3);
    e1.subVectors(b, a); e2.subVectors(c, a);
    f.crossVectors(e1, e2).normalize();
    faceN[t] = f.x; faceN[t + 1] = f.y; faceN[t + 2] = f.z;
    for (let k = 0; k < 3; k++) {
      const i = t + k;
      next[i] = head[gid[i]];
      head[gid[i]] = i;
    }
  }
  for (let t = 0; t < n; t += 3) {
    for (let k = 0; k < 3; k++) {
      const i = t + k;
      let x = 0, y = 0, z = 0;
      for (let j = head[gid[i]]; j >= 0; j = next[j]) {
        const s = j - (j % 3);
        const d = faceN[t] * faceN[s] + faceN[t+1] * faceN[s+1] + faceN[t+2] * faceN[s+2];
        if (d >= cos) { x += faceN[s]; y += faceN[s+1]; z += faceN[s+2]; }
      }
      const L = Math.hypot(x, y, z) || 1;
      out[i*3] = x / L; out[i*3+1] = y / L; out[i*3+2] = z / L;
    }
  }
  return out;
}
