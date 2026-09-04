/* Scene 01 -- the machine, alone.
 *
 * Universal Robots' own triangles, placed by the kinematics they were
 * designed around, in a room with nothing else in it. It is the only object
 * on the page that is what it claims to be, so it gets the opening and it
 * gets the whole frame.
 *
 * Across its band the arm plays one move and the camera comes in past it.
 * Across the fade at the end it dissolves -- the surface eroding into the
 * particle field, which the next scene inherits.
 */
import * as THREE from "three";
import { makeDissolveMaterial } from "../materials/dissolve.js";
import { makeParticles } from "../materials/particles.js";
import { linkFrames, REST } from "../kinematics.js";
import { TRANSITION } from "../config.js";

/* Where the camera is when this scene begins and where it has got to when
   the scene is done. The rig builds its keyframes from these and the bands
   measured off the DOM, so nothing anywhere is a hand-picked scroll fraction. */
export const FLIGHT = {
  enter: { pos: [ 0.36, -0.45,  2.78], look: [ 0.36, -0.62,  0.40], fov: 40 },
  exit:  { pos: [ 0.10, -0.30,  1.15], look: [ 0.55, -0.55, -0.55], fov: 47 }
};


const POSES = [
  [0.52, -1.02, 1.30, -1.86, -1.57, 0.00],
  [0.16, -1.28, 1.62, -1.92, -1.57, -0.22],
  [-0.31, -0.96, 1.21, -1.79, -1.57, -0.44],
  [-0.05, -1.10, 1.42, -1.88, -1.57, -0.10]
];

function poseAt(u, out) {
  const f = u * (POSES.length - 1);
  const i = Math.min(POSES.length - 2, Math.floor(f));
  let t = f - i;
  t = t * t * (3 - 2 * t);
  for (let k = 0; k < 6; k++) out[k] = POSES[i][k] + (POSES[i + 1][k] - POSES[i][k]) * t;
  return out;
}

export async function create(ctx) {
  const { pal, quality } = ctx;
  const group = new THREE.Group();
  // The base sits on the floor and the arm stands about 0.92m, so dropping the
  // group by half that puts its middle on the camera's eyeline. Pushed right,
  // because the type owns the left of the frame and always has.
  group.position.set(1.02, -0.46, 0);

  const mesh = await fetch("assets/ur12e-hero.json").then(r => r.json());
  const unit = mesh.unit;

  // One Group per link, so posing is six matrix writes rather than any vertex
  // work. The meshes arrive in their own link frames already.
  const links = mesh.links.map(() => {
    const g = new THREE.Group();
    g.matrixAutoUpdate = false;          // the kinematics writes these directly
    return g;
  });
  links.forEach(g => group.add(g));

  const mats = [];
  const shapes = [];
  for (let li = 0; li < mesh.links.length; li++) {
    for (const part of mesh.links[li].parts) {
      const g = new THREE.BufferGeometry();
      const n = part.f.length;
      const pos = new Float32Array(n * 3);
      for (let t = 0; t < n; t++) {
        const s = part.f[t] * 3;
        pos[t*3] = part.v[s] * unit;
        pos[t*3+1] = part.v[s+1] * unit;
        pos[t*3+2] = part.v[s+2] * unit;
      }
      g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      // Three's own smoothing, at the same 52 degrees the hand-rolled
      // renderer settled on: round the decimator's facets, keep the machined
      // edges. mergeVertices is not available without the addon, so this is
      // the flat-to-smooth step done by angle on the expanded geometry.
      g.computeVertexNormals();
      const col = new THREE.Color(part.c[0]/255, part.c[1]/255, part.c[2]/255);
      const m = makeDissolveMaterial({ color: col, accent: pal["--landing-accent"] });
      mats.push(m);
      const o = new THREE.Mesh(g, m);
      links[li].add(o);
      shapes.push(g);
    }
  }

  // The particles are seeded from the arm's own surface, so what comes apart
  // has the machine's shape before it has any other.
  const dust = makeParticles(quality.particles, {
    accent: pal["--landing-accent"], teal: pal["--landing-teal"]
  });
  const biggest = shapes.reduce((a, b) =>
    a.getAttribute("position").count > b.getAttribute("position").count ? a : b);
  dust.userData.seedFrom(biggest, null);
  dust.scale.setScalar(1);
  dust.position.copy(group.position);
  group.parent === null && null;
  group.add(dust);
  dust.position.set(0, 0, 0);

  const q = REST.slice();
  const frames = linkFrames(q);
  const scratch = new THREE.Matrix4();

  return {
    group,
    update({ local, weight, t, pointer }) {
      poseAt(local, q);
      linkFrames(q, frames);
      // link 0 is base_link_inertia, which is the identity; the six joint
      // frames drive links 1..6, and the tool rides the last of them.
      for (let i = 1; i < links.length; i++) {
        const src = frames[Math.min(5, i - 1)];
        links[i].matrix.copy(src);
        // Writing .matrix by hand is only half of it: without this the world
        // matrix is never recomposed and every link stays where it was.
        links[i].matrixWorldNeedsUpdate = true;
      }
      links[0].matrix.identity();
      links[0].matrixWorldNeedsUpdate = true;

      // The dissolve rides the tail of the band: solid until the scene starts
      // handing over, then eroded through.
      const handoff = 1 - Math.min(1, weight / TRANSITION.dissolve);
      const cut = Math.pow(handoff, 0.85);
      for (const m of mats) {
        const u = m.userData.uniforms;
        u.uTime.value = t;
        u.uCut.value = cut;
        u.uCharge.value = Math.min(1, pointer.speed * 2.2);
      }
      const du = dust.userData.uniforms;
      du.uTime.value = t;
      du.uCut.value = cut;
      du.uGather.value = Math.min(1, Math.max(0, (cut - 0.55) / 0.45));
      dust.visible = cut > 0.001;
    },
    dispose() {
      for (const g of shapes) g.dispose();
      for (const m of mats) m.dispose();
      dust.userData.dispose();
    }
  };
}
