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

/* Built at boot from each formation's declared view and the band its station
   was measured to occupy. A fixed key list drifted the moment a paragraph
   changed length: the camera was still arriving at the projects while the
   reader was a screen into the benchmarks. Two keys standing on the origin
   until then, so a rig asked to sample before it is stitched returns a
   camera rather than a NaN. */
let keys = [{ at: 0, pos: [0, 0, 3], look: [0, 0, 0], fov: 42 },
            { at: 1, pos: [0, 0, 3], look: [0, 0, 0], fov: 42 }];
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

  const away = new THREE.Vector3();
  let t0 = 0;
  // How far the eye is from the thing it is pointed at. The depth of field
  // focuses on this, so the plane in focus is always whatever the camera was
  // aimed at rather than a distance somebody typed.
  let focus = 3;

  return {
    /* `back` and `lift` are the transformation's own contribution: the eye
       withdrawn along its own view axis while the cloud is mid-change, so a
       reorganisation is watched from further out than the state either side
       of it. Along the view axis rather than along world Z, or the pull-back
       would go sideways wherever the camera is not facing down the corridor. */
    update(p, pointer, dt, back, lift) {
      t0 += dt || 0;
      const { fov } = sample(p);
      const R = CAMERA.pointer;
      // The pointer moves the eye, never the target: swinging both is how a
      // scene ends up feeling like it is on a turntable.
      eye.set(pos[0] + pointer.x * R.reach,
              pos[1] - pointer.y * R.lift,
              pos[2]);
      at.set(look[0], look[1], look[2]);
      if (back || lift) {
        away.copy(eye).sub(at).normalize();
        eye.addScaledVector(away, back || 0);
        eye.y += lift || 0;
      }
      /* A breath, and a very small one. The eye is parked on its composed
         shot for the whole of a reading now -- that was the fix for a camera
         that used to drift three metres across a single state -- and a camera
         that is *exactly* still is the one thing that reads as rendered
         rather than shot. Two incommensurable periods so it never repeats,
         zero mean so it cannot accumulate into drift, and 12 millimetres of
         amplitude: at this page's typical three-metre standoff through a
         44-degree lens that is 0.004 in NDC, which is four pixels on a 1916
         frame. Below the threshold at which anybody could call it movement,
         above the threshold at which the frame looks dead. */
      eye.x += Math.sin(t0 * 0.31) * 0.012;
      eye.y += Math.sin(t0 * 0.23 + 1.7) * 0.009;
      eye.z += Math.sin(t0 * 0.19 + 3.1) * 0.010;
      camera.position.copy(eye);
      camera.lookAt(at);
      focus = eye.distanceTo(at);
      if (Math.abs(camera.fov - fov) > 0.01) {
        camera.fov += (fov - camera.fov) * Math.min(1, dt * 6);
        camera.updateProjectionMatrix();
      }
    },
    get focus() { return focus; },

    /* Where the camera is heading, so scenes can place things in front of it
       rather than guessing. */
    at(p) { const f = sample(p); return { pos: pos.slice(), look: look.slice(), fov: f.fov }; }
  };
}
