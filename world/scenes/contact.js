/* Scene 05 -- the end, where the world empties.
 *
 * Everything that has been built up over the journey comes apart and gathers
 * to one point ahead of the camera. It is the only scene that ends with less
 * than it started with, which is the point: the page finishes on the contact
 * details and the room around them should get out of the way rather than
 * compete for the last thing you read.
 */
import * as THREE from "three";
import { makeParticles } from "../materials/particles.js";
import { makeFrame } from "../flightframe.js";

/* Where the camera is when this scene begins and where it has got to when
   the scene is done. The rig builds its keyframes from these and the bands
   measured off the DOM, so nothing anywhere is a hand-picked scroll fraction. */
export const FLIGHT = {
  enter: { pos: [ 0.00,  0.55, -15.1], look: [ 0.00,  0.50, -16.6], fov: 38 },
  exit:  { pos: [ 0.00,  0.50, -15.9], look: [ 0.00,  0.50, -16.6], fov: 33 }
};


export async function create(ctx) {
  const { pal, quality, flight } = ctx;
  const frame = makeFrame(flight);
  const group = new THREE.Group();

  // A shell for the cloud to be seeded from and a point for it to gather to,
  // both throwaway: only their vertices are used.
  const shell = new THREE.IcosahedronGeometry(1.5, quality.particles > 8000 ? 4 : 2);
  const target = new THREE.IcosahedronGeometry(0.16, 2);

  const dust = makeParticles(Math.round(quality.particles * 0.8), {
    accent: pal["--landing-accent"], teal: pal["--landing-teal"]
  });
  dust.userData.seedFrom(shell, target);
  dust.position.copy(frame.place(0.5, 0, 0, 2.0));
  group.add(dust);

  shell.dispose(); target.dispose();

  return {
    group,
    update({ local, weight, t, pointer }) {
      const u = dust.userData.uniforms;
      u.uTime.value = t;
      // Released across the first half of the band and gathered across the
      // second, so it comes apart before it comes together.
      u.uCut.value = Math.min(1, local * 2.0);
      u.uGather.value = Math.min(1, Math.max(0, (local - 0.42) / 0.58));
      u.uDpr.value = Math.min(2, window.devicePixelRatio || 1);
      dust.material.opacity = weight;
      group.rotation.y = t * 0.035 + pointer.x * 0.06;
    },
    dispose() { dust.userData.dispose(); }
  };
}
