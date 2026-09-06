/* Formation 01 -- the manipulator, and everything a manipulator implies.
 *
 * The arm itself is drawn twice: once as Universal Robots' own triangles,
 * solid, and once as matter in the substrate sampled off those same
 * triangles. That doubling is the point. As the page scrolls the solid mesh
 * erodes away and what is left is the cloud, which then goes on to become the
 * occupancy grid -- so the machine does not cut to the map, it *becomes* it.
 *
 * Around it: the swept trajectory its tool actually traces, the corridor of
 * tool points reachable either side of that trajectory, the body that carries
 * the tool along it, a coordinate frame on every joint, and a floor for it all
 * to stand on. Nothing here is decorative geometry standing in for robotics;
 * every position comes out of the same forward kinematics the mesh is posed
 * by.
 *
 * And it executes. Until the substrate grew a flow channel this station was a
 * diorama of a machine mid-move: a ribbon of trajectory lying in space with
 * nothing on it. Now every point of the route, of the corridor around it, of
 * the body sweeping along it and of the six joint frames carries the fraction
 * of the move it belongs to, and the travelling band lights that fraction as
 * `uRun` advances -- one pass of the whole move in five seconds at the rate
 * the loop drives it. The arm's sampled *shell* carries no flow and is not
 * going to: a machine's skin does not flow, and a band running across a
 * shell reads as a texture crawling over a body rather than as a body.
 */
import * as THREE from "three";
import { bands, polyline, sampleSoup, rng, STRUCTURE, PATH, FRAME } from "./lib.js";
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

/* The share of the structure band that is matter with a flow on it, written
   at the front of the band before anything else.
 *
 * This is the one number this formation and About have to agree on, and it is
 * exported rather than written down twice because agreeing by coincidence is
 * not agreeing. The bands exist so that point 900 is structure in every
 * formation and cream stays cream through a morph; the flow channel is the
 * same discipline applied to what the matter is doing, and it wants the same
 * treatment. About is loaded against this formation the whole time it is on
 * screen -- settled About is span 0 at mix 0.99, not span 1 at mix 0 -- so
 * whatever this file writes at index j is what About's point j is coming out
 * of, flow included.
 *
 * Left to fall where they wanted, the two front-of-band features are the arm's
 * shell here and the reachable envelope there. The shell must not run and the
 * envelope must, so every point of the sweep would have spent the crossing
 * changing its mind: the substrate weights the band by which end of the morph
 * has a flow, so a point running at one end only ramps its band from nothing
 * as the mix carries it in. Matter arriving with a light switching on is not
 * the same thing as matter arriving lit. So both formations now put their
 * running matter first, at the same count, and everything that must not run
 * goes behind it -- and the band that was travelling the manipulator's body
 * sweep is the band travelling About's envelope, at full weight, the whole
 * way across.
 *
 * 0.14 of the high tier's 49600 structure points is 6944. What it costs is
 * shell density: the shell keeps 29006 direct samples of a 21010-triangle
 * mesh where it had 33728, which is 1.38 samples a triangle rather than 1.61,
 * and the padding scatters both back up to the same total. Over one point per
 * triangle either way, across 26 parts, and area-weighted so the density is
 * the surface's rather than the tessellation's: not a difference you can find
 * by looking at the arm. */
export const RUN_SHARE = 0.14;

/* Poses the body is drawn at, across the move.
 *
 * The band reaches 0.16 either side of its centre, so at 48 poses 7.7 of them
 * are lit at half strength or better and 15 carry any light at all, and the
 * lit stretch steps 9.6 poses a second at the rate the loop advances `uRun`.
 * That is what makes it read as the arm moving rather than as configurations
 * being ticked off one at a time.
 *
 * What 48 does not do is close the sheet, and it is worth being exact about
 * that rather than claiming a swept surface. The wrist travels 1.1487 across
 * the move and the elbow 0.5354, so consecutive poses are 0.0239 and 0.0112
 * apart. At this station's 2.30 standoff a 42 degree lens is 1.766 of frame
 * height, which at the high tier's device pixel ratio is 26 and 12 pixels
 * against a splat this shader will not draw wider than 14. So it closes at
 * the elbow and opens into separate configurations out at the wrist, which is
 * what it is: a train of poses, dense where the chain moves least.
 *
 * Closing it at the wrist end takes 89 poses, and the budget does not move
 * when the pose count does -- at 89 each pose is 78 points along 1.4467 of
 * chain, one every 20 pixels, and the lines break into dots. The same
 * coverage, arranged so that neither the pose nor the sheet reads. */
const GHOST = 48;

export function build(ctx) {
  const { anchor, arm } = ctx;
  // Without the mesh there is still an arm here: the kinematics is the arm,
  // the triangles are only its skin. Everything below except the surface
  // sample comes out of the joint chain, so a failed fetch costs the cloud its
  // shell and nothing else. The running matter is written before the shell for
  // that reason as well as for the band discipline: the indices that carry the
  // flow are the same whether or not the fetch came back.
  const soup = arm && arm.soup;
  const upright = (arm && arm.upright) || new THREE.Matrix4();
  const base = (arm && arm.base) || new THREE.Vector3();

  /* The tool's actual route across the move, in world space. */
  const q = new Array(6);
  const frames = Array.from({ length: 6 }, () => new THREE.Matrix4());
  const route = [];
  for (let i = 0; i <= 96; i++) {
    poseAt(i / 96, q);
    linkFrames(q, frames);
    route.push(toolPoint(frames, new THREE.Vector3()).applyMatrix4(upright).add(base));
  }

  /* The body, across the move: the kinematic chain from the shoulder to the
     tool flange, drawn once per pose, every point of one pose carrying that
     pose's own place in the move.
   *
   * This is what the move actually sweeps: the tool's route is what the
   * program says, and the chain carrying it is what has to be clear for the
   * program to run. Centrelines and not a volume, and the difference is not
   * glossed -- the swept volume is this with the link radii on it, there is
   * no collision model anywhere in this repository to take those from, and
   * inventing them would be a clearance claim with nothing behind it. It is
   * also the honest thing to hand About: what one move sweeps opens into what
   * every move can reach, which is the crossing this station makes.
   *
   * Origins rather than links, and only these five. The first two joint
   * origins do not move at all -- measured over 97 samples of the move, both
   * trace 0.0000 -- because they sit on the base axis and a rotation about it
   * leaves them where they are, so a segment drawn from the plate would be 48
   * copies of one bar. At the far end the chain stops at the flange: the
   * three wrist origins hold 0.2982, 0.2730 and 0.1565 from the tool point at
   * every one of those 97 samples, min equal to max, so past the flange this
   * would be the tool's own route redrawn in cream 0.16 to the side of the
   * accent already carrying it. What is left is 1.4467 of chain per pose, of
   * which the upper arm and forearm are 0.6127 and 0.5975. */
  const ghost = [];
  for (let j = 0; j < GHOST; j++) {
    poseAt(j / GHOST, q);
    linkFrames(q, frames);
    const chain = [];
    for (let k = 1; k < 6; k++) {
      const e = frames[k].elements;
      chain.push(new THREE.Vector3(e[12], e[13], e[14]).applyMatrix4(upright).add(base));
    }
    ghost.push(chain);
  }

  /* The corridor: tool points for poses either side of the route. This is a
     reachable-region sample, not a blur applied to the line -- each point is
     a real solution of the same kinematics with the joints moved a little,
     so where the cloud is thin is where the arm genuinely has less room.

     The pose fraction each one was solved at is kept rather than thrown away,
     because it is the corridor's flow: as the band travels the route it
     lights the tool positions that belong to the instant it is passing, so
     what runs is not a line but the set of places the tool could be *now*. A
     corridor lit all at once is a region; a corridor lit in step with the
     route is a region the arm is moving through. */
  const corridor = [], corridorU = [];
  const r = rng(0xA71E);
  // 2600 of these filled the same third of a cubic metre the trajectory
  // already occupies and came out as an orange smudge with the route lost
  // inside it. The corridor is context; the route is the thing being said.
  for (let i = 0; i < 1400; i++) {
    const u = r();
    poseAt(u, q);
    for (let k = 0; k < 6; k++) q[k] += (r() * 2 - 1) * SPREAD[k];
    linkFrames(q, frames);
    corridor.push(toolPoint(frames, new THREE.Vector3()).applyMatrix4(upright).add(base));
    corridorU.push(u);
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
     as a room the light does not reach the edges of. It does not run: a floor
     that pulses is a dance floor. */
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

  return function fill(pos, kind, size, count, flow) {
    const { S, P, F } = bands(pos, kind, size, count, flow);

    /* The body sweep, first, at the count About also takes first.
     *
     * Each pose is one stroke with one flow value, so the band does not crawl
     * along a pose, it selects poses: the arm's own chain lights where the
     * move has got to. Sampled by arc length, so the forearm is not denser
     * than the upper arm.
     *
     * Poses at j/48 rather than j/47, which leaves the last pose one step
     * short of the end of the move instead of on top of the first. Sharing an
     * endpoint would have lit the start and end configurations together on
     * every lap -- fract(1 - uRun) and fract(0 - uRun) are the same distance
     * from the band -- and the arm would have appeared to be in two places at
     * the top of every pass. The route, which is written over the closed
     * interval, covers the last stretch. */
    const nRun = S.share(RUN_SHARE);
    let left = nRun;
    for (let j = 0; j < GHOST; j++) {
      const take = Math.floor(left / (GHOST - j));
      // 0.62 against the shell's 0.95: the sweep is the body's history, not
      // the body. At the band's peak the shader multiplies it by 1.55, which
      // is 0.96 -- the shell's own size -- and by 2.5 in colour. Off the band
      // it is two thirds of the shell and reads as a trace.
      polyline(ghost[j], take, S, STRUCTURE, 0.62, 0.006, 0x5C01 + j * 37,
               [j / GHOST, j / GHOST]);
      left -= take;
    }

    // The machine's own surface, area-weighted so a 2mm bevel does not get as
    // many points as the whole upper arm. No flow, in either formation: this
    // is the one feature on the page that is a machine rather than something
    // a machine is doing.
    if (soup) sampleSoup(soup, S.share(0.68), S, STRUCTURE, 0.95, 0x1234);
    for (let i = 0; i + 2 < floor.length && S.room > (count * 0.02); i += 3)
      S.put(floor[i], floor[i + 1], floor[i + 2], STRUCTURE, 0.55);
    S.pad(0.02);

    // The route, running end to end: a tool point on it rather than a ribbon
    // of one. The corridor runs with it, each point at the instant it was
    // solved for.
    polyline(route, P.share(0.62), P, PATH, 1.7, 0.005, 0x77, true);
    const take = Math.min(corridor.length, P.share(1.0));
    for (let i = 0; i < take; i++) P.v(corridor[i], PATH, 0.5, corridorU[i]);
    P.pad(0.03);

    /* The six joint frames, pulsing down the chain: joint k at k/6 of the
       lap, so the band reaches the base, then the shoulder, then the elbow,
       then the three wrist joints, and wraps back to the base as the tool
       reaches the end of its route. That is the order `linkFrames` composes
       them in, and it is not an arbitrary order to have picked: where the
       sixth frame lands is a function of the five before it and of nothing
       after it, so down the chain is the direction the information in a joint
       vector actually travels. k/6 rather than k/5 so the wrap has the same
       1/6 gap as every other step; at k/5 the base and the wrist would carry
       flow 0 and flow 1, which the shader's fract puts at the same place, and
       the two ends of the machine would light together. */
    const per = Math.floor(F.room / (joints.length + 1));
    for (let k = 0; k < joints.length; k++)
      runTriad(joints[k], per, F, 0.11, 1.1, k / joints.length);
    F.pad(0.01);
  };
}

/* A coordinate frame that carries a flow, which lib's own `triad` cannot: it
   writes with five arguments and five arguments means -1.
 *
 * Three strokes out of the origin along the columns of the rotation, exactly
 * as lib draws one, but each stroke is handed a degenerate slice [f, f] so
 * every point of the frame sits at the same place in the lap and the whole
 * triad brightens and fades as one. A frame is a claim about a single pose;
 * a band crawling out along its axes would say the pose was being assembled
 * one axis at a time, which is not a thing that happens. */
export function runTriad(m, n, w, len, sz, f) {
  const e = m.elements;
  const o = new THREE.Vector3(e[12], e[13], e[14]);
  const per = Math.max(3, Math.floor(n / 3));
  for (let axis = 0; axis < 3; axis++) {
    const c = axis * 4;
    polyline([o, new THREE.Vector3(o.x + e[c] * len, o.y + e[c + 1] * len, o.z + e[c + 2] * len)],
             per, w, FRAME, sz, 0, 0x3A17 + axis * 911 + Math.round(f * 1000), [f, f]);
  }
}
