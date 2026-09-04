/* Scene 03 -- the measurements, as the thing they measure.
 *
 * The bars are the numbers. Their heights are the speedups off the site's own
 * benchmark tables -- 163, 99 and 192 for the planner, 26 and 4 for the
 * controller -- on a log scale, because 4 and 192 do not share a linear axis
 * anyone can read. Nothing here is decorative geometry standing in for data;
 * change the table and this changes.
 */
import * as THREE from "three";
import { makeArtifactMaterial, seedInstances } from "../materials/artifact.js";
import { makeFrame } from "../flightframe.js";

/* Where the camera is when this scene begins and where it has got to when
   the scene is done. The rig builds its keyframes from these and the bands
   measured off the DOM, so nothing anywhere is a hand-picked scroll fraction. */
export const FLIGHT = {
  enter: { pos: [ 0.05, -0.35, -5.55], look: [ 0.10, -0.30, -6.90], fov: 44 },
  exit:  { pos: [ 0.10, -0.10, -7.70], look: [ 0.05,  0.25, -9.60], fov: 44 }
};


//: Straight off the Measured section. Label kept so the two cannot drift
//: without someone noticing.
const SPEEDUPS = [
  { label: "A* 128",        x: 163 },
  { label: "A* 256",        x:  99 },
  { label: "A* 384",        x: 192 },
  { label: "DWA accel",     x:  26 },
  { label: "DWA full",      x:   4 }
];

export async function create(ctx) {
  const { pal, flight } = ctx;
  const frame = makeFrame(flight);
  const group = new THREE.Group();
  const N = SPEEDUPS.length;

  const geo = new THREE.BoxGeometry(0.19, 1, 0.19);
  geo.translate(0, 0.5, 0);                 // grow from the floor, not the middle
  seedInstances(geo, N, (i, n) => (i / n) * 0.4);
  const mat = makeArtifactMaterial({
    base: "#9fb7bd", accent: pal["--landing-accent"], teal: pal["--landing-teal"]
  });
  const mesh = new THREE.InstancedMesh(geo, mat, N);
  mesh.frustumCulled = false;

  const lo = Math.log(4), hi = Math.log(192);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion();
  const pos = new THREE.Vector3(), scl = new THREE.Vector3();
  const heights = SPEEDUPS.map(s => 0.22 + (Math.log(s.x) - lo) / (hi - lo) * 1.35);
  for (let i = 0; i < N; i++) {
    // A rank standing off to one side, a third of the way along, so the camera
    // comes level with them rather than driving through the middle.
    pos.copy(frame.place(0.42, 0.74 + i * 0.30, -0.92, 3.3));
    scl.set(1, heights[i] * 1.25, 1);
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
    },
    dispose() { geo.dispose(); mat.dispose(); }
  };
}
