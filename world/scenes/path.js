/* Scene 04 -- the path, as a corridor.
 *
 * One ring per year the site's timeline actually lists, threaded along the
 * camera's flight so you fly through them in order. Passing through a marker
 * rather than looking at a list is the whole point: the section is called
 * Path and this is the only reading of it that is spatial.
 */
import * as THREE from "three";
import { makeArtifactMaterial, seedInstances } from "../materials/artifact.js";
import { makeFrame } from "../flightframe.js";

/* Where the camera is when this scene begins and where it has got to when
   the scene is done. The rig builds its keyframes from these and the bands
   measured off the DOM, so nothing anywhere is a hand-picked scroll fraction. */
export const FLIGHT = {
  enter: { pos: [ 0.10,  0.42, -8.70], look: [ 0.05,  0.58, -10.6], fov: 46 },
  exit:  { pos: [ 0.00,  0.60, -14.5], look: [ 0.00,  0.55, -16.2], fov: 42 }
};


const N = 7;

export async function create(ctx) {
  const { pal, flight } = ctx;
  const frame = makeFrame(flight);
  const group = new THREE.Group();

  const geo = new THREE.TorusGeometry(0.62, 0.012, 6, 44);
  seedInstances(geo, N, (i, n) => (i / n) * 0.55);
  const mat = makeArtifactMaterial({
    base: "#c8ccd6", accent: pal["--landing-accent"], teal: pal["--landing-teal"]
  });
  const mesh = new THREE.InstancedMesh(geo, mat, N);
  mesh.frustumCulled = false;

  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  const pos = new THREE.Vector3(), scl = new THREE.Vector3();
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    // A gentle drift off the axis so it reads as a route rather than a tunnel.
    // Threaded onto the route itself: the camera goes through each ring.
    pos.copy(frame.place(t, Math.sin(t * 3.1) * 0.30, Math.cos(t * 2.2) * 0.16, 1.2));
    const f = frame.forwardAt(t);
    e.set(Math.asin(-f.y) + Math.PI / 2, Math.atan2(f.x, f.z), t * 0.4);
    q.setFromEuler(e);
    scl.setScalar(1 + t * 0.42);
    m.compose(pos, q, scl);
    mesh.setMatrixAt(i, m);
  }
  mesh.instanceMatrix.needsUpdate = true;
  group.add(mesh);

  return {
    group,
    update({ local, weight, t, pointer }) {
      const u = mat.userData.uniforms;
      u.uTime.value = t;
      u.uWeight.value = weight;
      u.uFocus.value = local * (N - 1);
      u.uCharge.value = Math.min(1, pointer.speed * 2.0);
      group.rotation.z = Math.sin(t * 0.12) * 0.03;   // the whole corridor breathing
    },
    dispose() { geo.dispose(); mat.dispose(); }
  };
}
