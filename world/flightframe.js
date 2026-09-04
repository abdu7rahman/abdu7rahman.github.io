/* A local frame along a scene's own flight.
 *
 * `along(u)` is where the camera will be a fraction u through this scene, and
 * `place(u, right, up, ahead)` is a point offset from there in the camera's
 * own axes. Scenes lay themselves out in those terms, so content and camera
 * cannot drift apart when a band moves under them.
 */
import * as THREE from "three";

export function makeFrame(flight) {
  const a = new THREE.Vector3().fromArray(flight.enter.pos);
  const b = new THREE.Vector3().fromArray(flight.exit.pos);
  const la = new THREE.Vector3().fromArray(flight.enter.look);
  const lb = new THREE.Vector3().fromArray(flight.exit.look);
  const up = new THREE.Vector3(0, 1, 0);
  const fwd = new THREE.Vector3(), right = new THREE.Vector3(), realUp = new THREE.Vector3();

  return {
    along(u) { return a.clone().lerp(b, u); },
    place(u, r, uu, ahead) {
      const eye = a.clone().lerp(b, u);
      const look = la.clone().lerp(lb, u);
      fwd.copy(look).sub(eye).normalize();
      right.crossVectors(fwd, up).normalize();
      realUp.crossVectors(right, fwd).normalize();
      return eye.clone()
        .addScaledVector(right, r)
        .addScaledVector(realUp, uu)
        .addScaledVector(fwd, ahead);
    },
    forwardAt(u) {
      const eye = a.clone().lerp(b, u), look = la.clone().lerp(lb, u);
      return look.sub(eye).normalize();
    }
  };
}
