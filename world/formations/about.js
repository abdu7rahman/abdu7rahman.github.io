/* Formation 02 -- the same machine, and everywhere it could have gone.
 *
 * This stands at the manipulator's own anchor, and that is the whole idea.
 * Four of the six crossings on this page are journeys: the camera flies six
 * metres and finds a different thing waiting. This one is not. The eye takes
 * half a step in and the matter does all of the work -- the arm's skin, which
 * is what the substrate was a moment ago, leaves the arm and becomes the
 * volume the arm can reach, around the arm, in place.
 *
 * The envelope is neither a sphere nor a blob. Every point of it is a tool
 * position out of the same forward kinematics the mesh is posed by, for a
 * joint vector drawn from the box below, so the shell has the shape the
 * hardware gives it: thick where a lot of joint space maps to one region,
 * thin where the arm has to be nearly straight to get there, cut off flat
 * where it would have to reach through the plate it is bolted to, and hollow,
 * because a six-axis arm cannot fold its own tool back into its own shoulder.
 *
 * And it is reached into rather than displayed. A shell of points standing
 * still states a fact about the hardware; the same shell with the base joint
 * mapped onto the substrate's travelling band is the machine finding that
 * fact out. A plane of solutions sweeps the volume once every lap, the way
 * the arm would cover it: by slewing.
 *
 * The accent arrives from the manipulator as one executed trajectory. Here it
 * becomes the fan that trajectory was chosen out of: that same move and six
 * others between the same two poses, every one of them something the arm
 * could have been told to do instead, and all seven rolled out at once rather
 * than one at a time. The copy in this section is about deciding where a
 * robot goes next, and a decision drawn as a single line is not a decision.
 */
import * as THREE from "three";
import { bands, polyline, rng, STRUCTURE, PATH } from "./lib.js";
import { RUN_SHARE, runTriad } from "./hero.js";
import { linkFrames, toolPoint, poseAt, POSES, TCP_Z } from "../kinematics.js";

/* Offsets from the station anchor; the caller adds it. A step in from the
   manipulator's 2.30 and a little round it, which is as far as this station
   is allowed to move -- the transformation is the subject and a camera that
   travels while the matter reorganises steals the reorganisation.

   Solved rather than nudged, against the envelope this file actually writes.
   Re-measured off the buffer rather than off this paragraph, because this
   paragraph had drifted: it read 1.75 wide, 1.36 tall and 1.68 deep with a
   centre of mass 0.19 above the base plate, and boxing the 41921 envelope
   points the fill hands the substrate at the high tier gives 2.604 wide,
   1.653 tall and 2.275 deep, centred 0.740 above the plate, 0.209 in front of
   it and 0.448 to its left. The 0.19 was the centroid's world y read as a
   height, and the plate is at -0.55. Either way the conclusion it was drawn
   for stands harder than it did: this is a much bigger object than the arm
   that generated it, and at the manipulator's own standoff it overflows the
   frame on three sides. The NDC readings below are framing.js's and were
   never in doubt; the dimensions were.

   1.62 of standoff did not solve that, it only moved where the overflow
   landed, and the 0.6 of leftward aim that went with it was not about the
   envelope at all -- it was pushing the subject out from behind the panel by
   swinging the camera, which framing.js now does in NDC for every station at
   once. Left in, the two corrections stacked: measured off a render at
   1440x960, the *arm* ran to +1.57 in NDC, so more than half the machine this
   section is about was outside the frame and what remained was a fragment
   seen from underneath.

   So: aimed at the envelope, and far enough back to hold it. From 3.80 the
   whole reachable volume lands inside the frame at every aspect the page will
   stage -- x from -0.08 to +0.86 at 1440x960 and -0.01 to +0.70 at 1916x953,
   y within +/-0.61 of centre -- with the arm that generated it sitting inside
   that at [+0.13, +0.61]. It is 1.53 of travel from the hero's eye on the
   same 42-to-45 of lens, which is the move the section is: the same machine,
   stepped back from, with everything it can reach drawn around it. */
export const VIEW = { pos: [0.55, 0.05, 3.80], look: [0.35, -0.10, -0.06], fov: 45 };

/* The joint box the envelope is sampled over.
 *
 * These are not the hardware's limits. Nothing in this repository carries
 * them -- the kinematics module is origins and a tool offset, and the baked
 * mesh is triangles -- and a limit invented here would be a specification
 * claim with nothing behind it. So the box is the hero move's own joint
 * range, widened per joint by the amounts below, and it is a working region
 * rather than a datasheet.
 *
 * The widening is not uniform because the joints do not do the same job. The
 * three that carry the arm out into the room get the most, because they are
 * what makes the envelope an envelope. The base gets least: swung a full turn
 * it sweeps the same shell round twice and fills the left of the frame, which
 * belongs to the type. The last joint gets none at all, and loses nothing by
 * it -- it turns the tool about its own approach axis, the tool point sits on
 * that axis, and so every sample of it lands exactly where some other sample
 * already wrote. */
const WIDEN = [0.45, 1.05, 1.30, 1.55, 1.55, 0];
const LO = WIDEN.map((w, k) => Math.min(...POSES.map(p => p[k])) - w);
const HI = WIDEN.map((w, k) => Math.max(...POSES.map(p => p[k])) + w);

/* How far above the plate a tool position has to be to count. Exactly at it
   is a solution that grazes the floor; below it is one that reaches through
   the floor, and the arm is standing on that floor. The same test is put to
   every joint origin, because an elbow underground is no more available than
   a gripper underground. */
const CLEAR = 0.015;

/* And how far the tool has to stay off the arm carrying it. This is where the
   hole in the middle of the volume comes from, and it is worth being exact
   about why, because the kinematics on its own does not produce one: on these
   origins the shoulder and wrist offsets very nearly cancel, and a tool point
   can be brought within about a centimetre of the base axis by a chain that
   is folded straight through its own forearm. Those are solutions of the
   equations and not places the arm can go.

   The clearance is the tool's own length, which is the single dimension of
   the gripper this repository actually carries -- the mesh is decimated
   triangles and there is no collision model anywhere in it. Used this way it
   makes one claim and only one: the gripper cannot be inside a link. */
const SELF = TCP_Z;

/* Distance from a point to a segment, which is all the collision geometry
   above needs: an arm link is a rod, and a rod is a segment with a radius. */
const ROOT = new THREE.Matrix4();         // the base plate, where the chain starts
function toSeg(p, a, b) {
  const dx = b.elements[12] - a.elements[12];
  const dy = b.elements[13] - a.elements[13];
  const dz = b.elements[14] - a.elements[14];
  const L = dx * dx + dy * dy + dz * dz;
  let t = L > 0 ? ((p.x - a.elements[12]) * dx + (p.y - a.elements[13]) * dy +
                   (p.z - a.elements[14]) * dz) / L : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(p.x - (a.elements[12] + dx * t),
                    p.y - (a.elements[13] + dy * t),
                    p.z - (a.elements[14] + dz * t));
}

/* Whether a solved chain is somewhere the arm could actually be. In the arm's
   own frame, where the floor is z = 0 and the model is Z-up, so every one of
   these is a comparison rather than a transform. The last two links are not
   tested against the tool: the tool is bolted to them. */
function reachable(p, frames) {
  if (p.z < CLEAR) return false;
  for (let k = 0; k < 6; k++) if (frames[k].elements[14] < 0) return false;
  if (toSeg(p, ROOT, frames[0]) < SELF) return false;
  for (let k = 0; k < 3; k++) if (toSeg(p, frames[k], frames[k + 1]) < SELF) return false;
  return true;
}

/* Accepted tool positions held in the pool. More than the largest tier draws
   of them, so the walk in fill thins the envelope rather than writing the
   same solution twice, and enough that the shell's thin regions are still
   populated once the volume has been divided by them. Solving for it costs
   the boot a few tens of milliseconds, once: 17000 accepted out of 24349
   draws, a 69.8% acceptance rate. */
const POOL = 17000;

/* The fan, and how far off the executed move its alternates are allowed to
   bow. Seven routes: one that was run and six that were not. Fewer and the
   strand reads as a thick line rather than a set of choices; more and the
   band is divided so finely that no single route is continuous any more,
   which is the one property a trajectory has to keep. */
const ROUTES = 7;
const BOW = [0.34, 0.46, 0.52, 0.60, 0.34, 0.0];

export function build(ctx) {
  const { anchor, arm } = ctx;
  // Where the machine stands, taken off the arm rather than from anywhere
  // else, for the same reason the manipulator's own formation takes it off
  // the arm: if the mesh fetch fails both formations have to be wrong in the
  // same way, or the crossing between them turns into a quarter-turn of the
  // world. Everything below comes out of the joint chain, so a failed fetch
  // costs this formation nothing at all.
  const upright = (arm && arm.upright) || new THREE.Matrix4();
  const base = (arm && arm.base) || new THREE.Vector3();
  const place = new THREE.Matrix4()
    .makeTranslation(anchor.x + base.x, anchor.y + base.y, anchor.z + base.z)
    .multiply(upright);
  const floorY = anchor.y + base.y;

  const q = new Array(6);
  const frames = Array.from({ length: 6 }, () => new THREE.Matrix4());
  const v = new THREE.Vector3();
  const r = rng(0x1F0C7);

  /* The envelope. Uniform in joint space rather than uniform in the room,
     which is the whole reason to do it this way round: the density that comes
     out is the density of solutions, so the cloud is thickest exactly where
     the arm has the most ways to be. That is a fact about the machine and not
     a shading decision.

     Every test below is made in the arm's own frame, before the placement is
     applied, so a rejected sample costs a comparison rather than a matrix. */
  const env = new Float32Array(POOL * 3);
  /* And where in the sweep each accepted solution belongs: its base joint,
     normalised over the base's own range in the box.
   *
   * This is the parameter the volume is reached into on, and the choice is
   * forced rather than picked. Of the six joints the base is the only one the
   * acceptance test above cannot see: every line of `reachable` is either a
   * height in the arm's frame or a distance between two things in it, and
   * rotating the whole chain about the base axis changes neither. Nothing is
   * ever rejected for the value of q[0]. So the accepted pool is uniform in
   * it -- measured, the deciles of this array come out 1713 1643 1672 1645
   * 1716 1691 1721 1738 1723 1738 of 17000, flat to within the 2.4% that one
   * standard deviation of 1700 draws is worth -- and a band advancing at a
   * constant rate through it covers the volume at a constant rate. Map any
   * other joint and the sweep stalls wherever that joint's solutions were
   * being thrown away.
   *
   * It is also the joint that means something to look at. q[0] is what
   * carries the whole arm round the room; the other five decide the shape of
   * the cross-section it carries. Mapped this way the lit matter is a plane
   * of solutions slewing about the base axis, which is the motion the machine
   * would actually make to cover its own envelope. Ordered on reach, or on
   * height, or on nothing at all, the same points arrive as a bubble or as a
   * dissolve, and a dissolve is what this was trying to stop being.
   *
   * The base range is 1.7300 wide -- -0.76 to 0.97 -- and the substrate's
   * 0.16 is where the band falls to nothing, so it is at half strength 0.08
   * either side of its centre. That half-strength window is 0.16 of the base
   * range: 0.277 of rotation, 15.9 degrees. What it holds, measured on the
   * pool, is 16.0% of it, and the shape of that 16% is the whole argument --
   * a slab 2.517 wide and 1.643 tall against a volume that is 2.594 and
   * 1.643, and 0.935 deep against 2.269. Full width, full height, 41% of the
   * depth. It reads as a plane because it is one.
   *
   * The lap does not close, and is not pretended to: the band leaves at 0.97
   * and comes back at -0.76, a 99 degree jump. That is the same jump the
   * tool's route makes when it runs off the end of the move and starts again,
   * and it is what it looks like -- a program repeating, not a wheel turning. */
  const envF = new Float32Array(POOL);
  let n = 0;
  const cen = new THREE.Vector3();
  let fSum = 0;
  // Bounded, because rejection sampling has no upper bound of its own and a
  // boot is not allowed to be unlucky.
  for (let tries = 0; n < POOL && tries < POOL * 12; tries++) {
    for (let k = 0; k < 6; k++) q[k] = LO[k] + r() * (HI[k] - LO[k]);
    linkFrames(q, frames);
    toolPoint(frames, v);
    if (!reachable(v, frames)) continue;
    v.applyMatrix4(place);
    env[n * 3] = v.x; env[n * 3 + 1] = v.y; env[n * 3 + 2] = v.z;
    envF[n] = (q[0] - LO[0]) / (HI[0] - LO[0]);
    fSum += envF[n];
    cen.add(v);
    n++;
  }
  const NENV = n;
  cen.multiplyScalar(1 / Math.max(1, NENV));
  // Where in the lap the sweeping plane is passing through the middle of the
  // range that made the volume. 0.504 at this seed, which is 0.5 plus the
  // noise on 17000 uniform draws, and it is the tick the volume's own frame
  // is given below.
  const meanF = fSum / Math.max(1, NENV);

  /* The routes. The first is the move the manipulator actually played, so the
     strand that arrives from the previous formation stays exactly where it
     was and the other six grow out of it; the rest run between the same two
     poses through a via point pushed off the straight joint-space line.

     They are candidates, so they are held to what a candidate has to satisfy.
     A route that puts the tool through the floor or through the arm is not
     something anybody would offer, and it is redrawn rather than shown -- the
     same test the envelope is built out of, which is the point: the fan is
     drawn through the volume, not over it. */
  const routes = [];
  for (let i = 0; i <= 96; i++) {
    poseAt(i / 96, q);
    linkFrames(q, frames);
    routes.push(toolPoint(frames, new THREE.Vector3()).applyMatrix4(place));
  }
  const fan = [routes];
  const off = new Array(6);
  for (let a = 1; a < ROUTES; a++) {
    for (let attempt = 0; attempt < 40; attempt++) {
      for (let k = 0; k < 6; k++) off[k] = (r() * 2 - 1) * BOW[k];
      const alt = [];
      let ok = true;
      for (let i = 0; i <= 64 && ok; i++) {
        const u = i / 64;
        // A hump that is zero at both ends, so every route in the fan leaves
        // and arrives at the two poses the move was actually between. A fan
        // whose members start in different places is a set of unrelated
        // trajectories rather than a set of options.
        const bow = Math.sin(Math.PI * u);
        for (let k = 0; k < 6; k++)
          q[k] = POSES[0][k] + (POSES[POSES.length - 1][k] - POSES[0][k]) * u + off[k] * bow;
        linkFrames(q, frames);
        const p = toolPoint(frames, new THREE.Vector3());
        if (!reachable(p, frames)) ok = false;
        else alt.push(p.applyMatrix4(place));
      }
      if (ok) { fan.push(alt); break; }
    }
  }

  /* The joint frames, at the pose the manipulator's own triads are taken at,
     so the teal does not move at all across the crossing. It is the one thing
     in the frame that does not: the skin flies out into the envelope and the
     accent opens into a fan around six coordinate frames that stay nailed
     exactly where they were, which is what "in place" is supposed to mean.
     They keep the manipulator's phases too, k/6 down the chain, so the pulse
     that was running base to wrist over there is the same pulse over here. */
  poseAt(0, q);
  linkFrames(q, frames);
  const joints = frames.map(f => new THREE.Matrix4().copy(place).multiply(f));

  /* The floor. The same floor the manipulator stood on, resampled a little
     finer: it is the one part of the previous formation that has no business
     moving, and a volume with nothing underneath it hangs rather than stands.
     Thinning outwards for the reason it thinned there -- an even lattice
     reads as graph paper and one that falls off reads as a room. It carries
     no flow for the same reason it carries none there. */
  const floor = [];
  const STEP = 0.075, HALF = 18;
  for (let ix = -HALF; ix <= HALF; ix++) {
    for (let iz = -HALF; iz <= HALF; iz++) {
      const d = Math.hypot(ix, iz) / HALF;
      if (d > 1 || r() > 1.0 - d * d * 0.80) continue;
      floor.push(anchor.x + base.x + ix * STEP, floorY, anchor.z + base.z + iz * STEP);
    }
  }
  const FL = Float32Array.from(floor), NFL = FL.length / 3;

  /* One table of noise, read three at a time, with two entries of overrun so
     the read past the wrap is a read rather than a bounds check. */
  const JN = 4096, JM = JN - 1;
  const jit = new Float32Array(JN + 2);
  for (let i = 0; i < JN; i++) jit[i] = r() * 2 - 1;
  jit[JN] = jit[0]; jit[JN + 1] = jit[1];

  return function fill(pos, kind, size, count, flow) {
    const { S, P, F } = bands(pos, kind, size, count, flow);

    /* The envelope, in two passes over one pool: the share that runs first,
       at exactly the count the manipulator gave its body sweep, then the rest.
       Same solutions, same volume, same jitter -- the only difference between
       the two passes is that the first carries its sample's base angle and
       the second carries nothing. First because the manipulator's running
       matter is first: RUN_SHARE is imported rather than repeated, and taken
       off a full band in both files, so the two counts are the same integer
       and the sweep is written onto the indices the body sweep was written
       onto. What crosses is then one band handing over to another band rather
       than one lighting up while the other goes out.

       The two passes take disjoint parts of the pool, the head and the tail,
       rather than both walking all of it. Drawn from the same entries, every
       swept point would have had two or three unswept twins written 6mm off
       it -- four device pixels, inside a splat this shader draws twelve
       across at this standoff -- and each twin would have sat dark while it
       lit, which is most of the contrast the sweep has to spend. Head and
       tail are both uniform samples of the volume, because the pool is in the
       order it was solved and that is the order the joint vectors were drawn:
       splitting it anywhere splits the volume nowhere. */
    const nRun = S.share(RUN_SHARE);
    const nEnv = Math.floor((S.room - nRun) * 0.82);
    const cut = Math.max(1, Math.min(NENV - 1, nRun));

    /* 0.62 against the 0.85 the rest of the shell is drawn at, and that is
       the whole exposure argument. The crossing into this station is the
       brightest moment on the page -- two clouds centred on the same machine,
       passing through each other -- so a sweep is only allowed here if it
       pays for itself rather than being added on top.

       It does, by construction. Under the band the shader multiplies a point
       by 1.55 in size and 2.5 in colour, so a 0.62 point at the peak is 0.96
       across and 3.2 times the light of a settled 0.85 one; off the band it
       is 0.53 of one, and the band's support is 0.32 of the lap. Integrated
       over a lap a swept point averages 0.90 of a settled one, and the shell
       as a whole comes out 1.7% under a shell with no sweep in it.

       Measured, at 1916x953 on the high tier, over the right-hand render half
       that tools/exposure.js crops to: settled About was 0.0295 of the frame
       above 140 before the sweep existed and 0.0298 after, p99 164 against
       166, each the mean of five consecutive settled frames. Level, not 1.7%
       down, and the gap is the point -- the threshold counts concentration,
       and what the band does is gather light rather than add it. Intro went
       0.0227 to 0.0228. The frame caught on arrival, still in the tail of the
       crossing, is the one that moved, and it moved down: 0.042, 0.086 and
       0.099 on three runs of the old build against 0.030, 0.031 and 0.030 on
       three of this one. The old spread is too wide to put a single figure
       on, which is itself the finding.

       What moves is not the total but where it is: the slab under the band
       carries about a third more light than the shell around it, and it is
       the only thing in the frame that is moving, which is worth several
       times its brightness. */
    const perRun = cut / Math.max(1, nRun);
    for (let k = 0; k < nRun; k++) {
      const e = (k * perRun) | 0, o = e * 3, j = (k * 3 + 2417) & JM;
      S.put(env[o]     + jit[j]     * 0.006,
            env[o + 1] + jit[j + 1] * 0.006,
            env[o + 2] + jit[j + 2] * 0.006, STRUCTURE, 0.62, envF[e]);
    }
    const perEnv = (NENV - cut) / Math.max(1, nEnv);
    for (let k = 0; k < nEnv; k++) {
      const e = cut + ((k * perEnv) | 0), o = e * 3, j = (k * 3) & JM;
      S.put(env[o]     + jit[j]     * 0.006,
            env[o + 1] + jit[j + 1] * 0.006,
            env[o + 2] + jit[j + 2] * 0.006, STRUCTURE, 0.85);
    }
    // Fainter and jittered wider, so a lattice node reads as a soft mark: the
    // floor is what the volume stands over, not part of the measurement of
    // where the arm can go.
    const nFl = S.share(0.86), perFl = NFL / Math.max(1, nFl);
    for (let k = 0; k < nFl; k++) {
      const o = ((k * perFl) | 0) * 3, j = (k * 3 + 977) & JM;
      S.put(FL[o]     + jit[j]     * 0.024,
            FL[o + 1] + jit[j + 1] * 0.006,
            FL[o + 2] + jit[j + 2] * 0.024, STRUCTURE, 0.60);
    }
    S.pad(0.02);

    /* The executed move keeps the front of the band and a little more size,
       because it is the strand that arrived and the one that leaves for the
       occupancy grid. The six it was chosen over share the rest evenly: they
       were alternatives to each other as much as to it.
     *
     * All seven run, and they run together. Every route in the fan leaves the
     * first pose and arrives at the last -- that is what the sin hump is for
     * -- so seven bands at one phase leave the start as a single point,
     * separate across the middle where the routes differ, and converge again
     * at the end. That is a batch of rollouts being scored, which is what a
     * planner does with a fan, and it is the sentence the crossing wants: the
     * one tool point that was travelling the manipulator's trajectory becomes
     * seven, on seven routes, between the same two poses.
     *
     * In turn was the other option and it does not survive arithmetic. Slice
     * the lap seven ways and each route owns 0.143 of it, against a band
     * whose support is 0.32 of a lap -- more than twice a route's whole share
     * of it. Every route would light whole and hand over to the next rather
     * than be travelled, which loses the one property a trajectory has. It
     * costs nothing in exposure either way: the support is the same 0.32 of
     * whatever carries a flow, whether that is one curve or seven.
     *
     * Both formations parameterise the executed move the same way, by its own
     * arc length from 0 to 1, so the band sits at the same distance along the
     * same curve either side of the crossing. Only the number of points the
     * curve is drawn with changes. */
    polyline(fan[0], P.share(0.30), P, PATH, 1.55, 0.005, 0x77, true);
    const per = Math.floor(P.share(0.94) / Math.max(1, fan.length - 1));
    for (let i = 1; i < fan.length; i++)
      polyline(fan[i], per, P, PATH, 1.10, 0.008, 0x4100 + i * 31, true);
    P.pad(0.02);

    const each = Math.floor(F.room / (joints.length + 2));
    for (let k = 0; k < joints.length; k++)
      runTriad(joints[k], each, F, 0.11, 1.1, k / joints.length);
    /* The volume's own frame, at its centre of mass, on the world axes: a
       reachable set is a region rather than a body and has no orientation to
       borrow. Longer than the joint triads because it measures all of them.

       It ticks once a lap, whole, at the phase the sweeping plane is passing
       through the middle of the base range that generated the volume --
       measured at 0.504, which is 0.5 and the noise on 17000 draws. A frame
       is a claim about one place, so it does not get a band crawling through
       it; it gets the beat the sweep passes its own centre on. */
    runTriad(new THREE.Matrix4().makeTranslation(cen.x, cen.y, cen.z),
             F.share(0.92), F, 0.30, 1.2, meanF);
    F.pad(0.01);
  };
}
