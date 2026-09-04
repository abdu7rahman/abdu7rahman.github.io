/* The camera, flown along the scroll.
 *
 * Keyframes in config.js, interpolated here. Catmull-Rom rather than linear
 * between the positions: linear gives a corner at every key, and a camera
 * that changes direction abruptly reads as a cut even when it is continuous.
 * The look-at target is interpolated on the same spline, so the eye and what
 * it is watching arrive together.
 */
import * as THREE from "three";
import { CAMERA } from "./config.js";

/* Built at boot from each scene's declared flight and the band it was measured
   to occupy. The old fixed key list drifted the moment a paragraph changed
   length: the camera was still arriving at the projects while the reader was
   a screen into the benchmarks. */
let keys = CAMERA.keys;
export function setKeys(k) { if (k && k.length >= 2) keys = k; }

function catmull(p0, p1, p2, p3, t, out) {
  const t2 = t * t, t3 = t2 * t;
  for (let i = 0; i < 3; i++) {
    out[i] = 0.5 * ((2 * p1[i]) +
      (-p0[i] + p2[i]) * t +
      (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * t2 +
      (-p0[i] + 3 * p1[i] - 3 * p2[i] + p3[i]) * t3);
  }
  return out;
}

export function makeCameraRig(camera) {
  const pos = [0, 0, 0], look = [0, 0, 0];
  const at = new THREE.Vector3(), eye = new THREE.Vector3();
  const shake = new THREE.Vector3();

  function sample(p) {
    let i = 0;
    while (i < keys.length - 2 && p > keys[i + 1].at) i++;
    const a = keys[Math.max(0, i - 1)], b = keys[i], c = keys[i + 1],
          d = keys[Math.min(keys.length - 1, i + 2)];
    const span = Math.max(1e-6, c.at - b.at);
    const t = Math.min(1, Math.max(0, (p - b.at) / span));
    catmull(a.pos, b.pos, c.pos, d.pos, t, pos);
    catmull(a.look, b.look, c.look, d.look, t, look);
    return { fov: b.fov + (c.fov - b.fov) * (t * t * (3 - 2 * t)) };
  }

  return {
    update(p, pointer, dt) {
      const { fov } = sample(p);
      const R = CAMERA.pointer;
      // The pointer moves the eye, never the target: swinging both is how a
      // scene ends up feeling like it is on a turntable.
      eye.set(pos[0] + pointer.x * R.reach,
              pos[1] - pointer.y * R.lift,
              pos[2]);
      camera.position.copy(eye);
      at.set(look[0], look[1], look[2]);
      camera.lookAt(at);
      if (Math.abs(camera.fov - fov) > 0.01) {
        camera.fov += (fov - camera.fov) * Math.min(1, dt * 6);
        camera.updateProjectionMatrix();
      }
    },
    /* Where the camera is heading, so scenes can place things in front of it
       rather than guessing. */
    at(p) { const f = sample(p); return { pos: pos.slice(), look: look.slice(), fov: f.fov }; }
  };
}
