/* Formation 01 -- the manipulator, and everything a manipulator implies.
 *
 * The arm itself is drawn twice: once as Universal Robots' own triangles,
 * solid, and once as matter in the substrate sampled off those same
 * triangles. That doubling is the point. As the page scrolls the solid mesh
 * erodes away and what is left is the cloud, which then goes on to become the
 * occupancy grid -- so the machine does not cut to the map, it *becomes* it.
 *
 * Around it: the swept trajectory its tool actually traces, the corridor of
 * tool points reachable either side of that trajectory, a coordinate frame on
 * every joint, and a floor for it all to stand on. Nothing here is decorative
 * geometry standing in for robotics; every position comes out of the same
 * forward kinematics the mesh is posed by.
 */
import * as THREE from "three";
import { bands, polyline, triad, sampleSoup, rng, STRUCTURE, PATH, FRAME } from "./lib.js";
import { linkFrames, toolPoint, poseAt, POSES } from "../kinematics.js";

/* Offsets from the station anchor; the caller adds it. Solved rather than
   nudged: upright, the arm's bounding box over the whole pose sequence is
   1.27 x 0.83 x 0.99 centred 0.44 behind and 0.42 above its base plate. At 42
   degrees vertical a 2.3m standoff puts that 0.83 of height at just under
   two-thirds of the frame, and looking a little left of the arm leaves the
   left of the frame to the type, which has always owned it. */
export const VIEW = { pos: [0.24, 0.06, 2.30], look: [0.50, -0.12, 0.04], fov: 42 };

/* This station covers two states, and each gets its own key. Intro is the
   standoff the arm was framed at; About is a step in toward the wrist -- the
   copy there is about writing the software that decides where a robot goes
   next, and the place to be reading it from is close enough to see the joint
   the decision comes out of. A single key for both would have interpolated
   from Intro's framing straight to the next station's and spent the whole of
   About drifting past. */
export const VIEWS = [
  VIEW,
  { pos: [0.62, -0.08, 1.42], look: [1.02, -0.30, -0.16], fov: 47 }
];

/* How far off the trajectory the corridor is sampled, in radians per joint.
   Only the three joints that carry the arm out into the world are perturbed:
   swinging the wrist as well produces a cloud that is mostly the tool
   spinning in place, which says nothing about where the arm can reach. */
const SPREAD = [0.10, 0.17, 0.17, 0.06, 0.0, 0.0];

export function build(ctx) {
  const { anchor, arm } = ctx;
  // Without the mesh there is still an arm here: the kinematics is the arm,
  // the triangles are only its skin. Everything below except the surface
  // sample comes out of the joint chain, so a failed fetch costs the cloud its
  // shell and nothing else.
  const soup = arm && arm.soup;
  const upright = (arm && arm.upright) || new THREE.Matrix4();
  const base = (arm && arm.base) || new THREE.Vector3();

  /* The tool's actual route across the move, in world space. */
  const q = new Array(6);
  const frames = Array.from({ length: 6 }, () => new THREE.Matrix4());
  const v = new THREE.Vector3();
  const route = [];
  for (let i = 0; i <= 96; i++) {
    poseAt(i / 96, q);
    linkFrames(q, frames);
    route.push(toolPoint(frames, new THREE.Vector3()).applyMatrix4(upright).add(base));
  }

  /* The corridor: tool points for poses either side of the route. This is a
     reachable-region sample, not a blur applied to the line -- each point is
     a real solution of the same kinematics with the joints moved a little,
     so where the cloud is thin is where the arm genuinely has less room. */
  const corridor = [];
  const r = rng(0xA71E);
  // 2600 of these filled the same third of a cubic metre the trajectory
  // already occupies and came out as an orange smudge with the route lost
  // inside it. The corridor is context; the route is the thing being said.
  for (let i = 0; i < 1400; i++) {
    poseAt(r(), q);
    for (let k = 0; k < 6; k++) q[k] += (r() * 2 - 1) * SPREAD[k];
    linkFrames(q, frames);
    corridor.push(toolPoint(frames, new THREE.Vector3()).applyMatrix4(upright).add(base));
  }

  /* The joint frames at the pose the solid mesh rests at, so the triads sit
     on the joints rather than near them. */
  poseAt(0, q);
  linkFrames(q, frames);
  const joints = frames.map(f =>
    new THREE.Matrix4().makeTranslation(base.x, base.y, base.z)
      .multiply(upright).multiply(f));

  /* The floor. Denser under the arm and thinning outwards, because a lattice
     of even density reads as graph paper and a lattice that falls off reads
     as a room the light does not reach the edges of. */
  const floor = [];
  const step = 0.135, half = 15;
  for (let ix = -half; ix <= half; ix++) {
    for (let iz = -half; iz <= half; iz++) {
      const x = anchor.x + base.x + ix * step;
      const z = anchor.z + base.z + iz * step;
      const d = Math.hypot(ix, iz) / half;
      if (r() > 1.0 - d * d * 0.86) continue;
      floor.push(x, base.y + anchor.y, z);
    }
  }

  return function fill(pos, kind, size, count) {
    const { S, P, F } = bands(pos, kind, size, count);

    // The machine's own surface, area-weighted so a 2mm bevel does not get as
    // many points as the whole upper arm.
    if (soup) sampleSoup(soup, S.share(0.68), S, STRUCTURE, 0.95, 0x1234);
    for (let i = 0; i + 2 < floor.length && S.room > (count * 0.02); i += 3)
      S.put(floor[i], floor[i + 1], floor[i + 2], STRUCTURE, 0.55);
    S.pad(0.02);

    polyline(route, P.share(0.62), P, PATH, 1.7, 0.005, 0x77);
    const take = Math.min(corridor.length, P.share(1.0));
    for (let i = 0; i < take; i++) P.v(corridor[i], PATH, 0.5);
    P.pad(0.03);

    const per = Math.floor(F.room / (joints.length + 1));
    for (const m of joints) triad(m, per, F, 0.11, 1.1);
    F.pad(0.01);
  };
}
