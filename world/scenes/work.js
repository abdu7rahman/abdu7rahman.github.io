/* Scene 02 -- the work, as objects you pass through.
 *
 * Ten projects, ten slabs, arranged down the corridor the camera is already
 * flying. They are not cards and they are not screenshots: the readable
 * version of a project is the DOM card scrolling past on the left, and this
 * is the thing it is a card about. One InstancedMesh, one draw call.
 *
 * Which one is lit comes from scroll position, so the object that is lit is
 * the object whose text you are reading.
 */
import * as THREE from "three";
import { makeArtifactMaterial, seedInstances } from "../materials/artifact.js";
import { makeFrame } from "../flightframe.js";

/* Where the camera is when this scene begins and where it has got to when
   the scene is done. The rig builds its keyframes from these and the bands
   measured off the DOM, so nothing anywhere is a hand-picked scroll fraction. */
export const FLIGHT = {
  enter: { pos: [ 0.05, -0.20,  0.55], look: [ 0.00, -0.30, -2.10], fov: 50 },
  exit:  { pos: [-0.10, -0.15, -5.30], look: [ 0.10, -0.28, -7.10], fov: 46 }
};


const N = 10;

export async function create(ctx) {
  const { pal, flight } = ctx;
  const frame = makeFrame(flight);
  const group = new THREE.Group();

  const geo = new THREE.BoxGeometry(0.46, 0.66, 0.035, 1, 1, 1);
  seedInstances(geo, N, (i, n) => (i / n) * 0.5);
  const mat = makeArtifactMaterial({
    base: "#cfd3dc", accent: pal["--landing-accent"], teal: pal["--landing-teal"]
  });
  const mesh = new THREE.InstancedMesh(geo, mat, N);
  mesh.frustumCulled = false;

  // Down the corridor, alternating either side of the flight path and tipped
  // slightly to catch the key light. Deterministic: a field that reshuffles on
  // reload is a field nobody can learn.
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  const pos = new THREE.Vector3(), scl = new THREE.Vector3(1, 1, 1);
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    const side = i % 2 === 0 ? 1 : -1;
    // Strung along the route the camera takes through this scene: a little to
    // one side, a little off the eyeline, and always a fixed distance ahead so
    // each one is met rather than passed at random.
    // Far enough ahead to be seen coming and small enough to be an object in
    // a room rather than a wall across it: at 1.5 ahead a 0.8m slab filled the
    // frame and read as a mistake.
    pos.copy(frame.place(t, side * (1.28 + Math.sin(i * 1.7) * 0.22),
                            -0.06 + Math.cos(i * 0.9) * 0.34, 2.9));
    e.set(0.05 * side, -0.42 * side, 0.02 * side);
    q.setFromEuler(e);
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
      // The lit one tracks the scroll across the band, so it is the project
      // whose card is level with the reader.
      u.uFocus.value = local * (N - 1);
      u.uCharge.value = Math.min(1, pointer.speed * 2.0);
    },
    dispose() { geo.dispose(); mat.dispose(); }
  };
}
