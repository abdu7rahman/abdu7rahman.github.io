/* Formation 02 -- the same machine, and everywhere it could have gone.
 *
 * This stands at the manipulator's own anchor, and that is the whole idea.
 * Four of the six crossings on this page are journeys: the camera flies six
 * metres and finds a different thing waiting. This one is not. The eye takes
 * half a step in and the matter does all of the work -- the arm's skin, which
 * is what the substrate was a moment ago, leaves the arm and becomes the
 * volume the arm can reach, around the arm, in place.
 *
 * What that volume is, drawn the way a volume is drawn.
 *
 * It used to be a scatter: seventeen thousand accepted tool positions, uniform
 * in joint space, walked at a stride and jittered into the forty-one thousand
 * draws the structure band had for them, additively. Every point of it was true
 * and the picture was not -- rendered, it was a grey cotton ball with the
 * machine lost inside it, the weakest thing on this page. A cloud of samples is a
 * measurement; it is not a shape, because a shape is a boundary and a boundary
 * is exactly what a uniform fill has no way of stating. So nothing is filled
 * here any more. Every point this formation writes is on a line, and the lines
 * are the same forward kinematics read for its edges instead of its interior.
 *
 * The reason that works is one fact, and it is worth stating before anything
 * below makes sense. The first joint origin is a pure translation up the base
 * axis, so every later frame is that translation, a rotation about it, and the
 * chain -- and rotating the whole chain about the base axis changes neither
 * the tool's height nor its distance from that axis, nor any line of the
 * reachability test, which is heights and distances and nothing else. Measured
 * over 20000 draws, re-solving the same arm with the base joint moved
 * somewhere else in its range moves the tool's (distance, height) pair by
 * 8.9e-16 and never once changes the verdict. The reachable set is therefore a
 * solid of revolution: one two-dimensional region in the half-plane, swept
 * through the base joint's own range. The sixth joint is redundant for the
 * same kind of reason -- it turns the tool about the axis the tool point sits
 * on, and over 20000 draws it moved that point by exactly 0.
 *
 * So: one region, measured once, and drawn three ways at the same time. As a
 * *section* -- the region itself, cut by a vertical plane through the base
 * axis, both sides of it, outlined and hatched, which is the oldest drawing
 * there is of a workspace and the only one that can show what is inside.
 * As a *surface* -- ten contour rings of the shape that section makes when it
 * is turned, so the flat figure is read as a solid. And as a *sweep* --
 * twenty-one half-planes of solutions at twenty-one base angles across the
 * arc the hero move's own base range covers, each carrying that angle as its
 * place in the substrate's travelling band, so once a lap a plane of solutions
 * slews about the base axis and the ground under it lights in the same wedge.
 * That is the motion the machine would actually make to cover its own
 * envelope, and it is the difference between a fact and a machine.
 *
 * Inside the section, the machine's own structure: where the wrist can be, an
 * area; where the elbow can be, which is a *line*, because one joint moves it
 * and one joint traces an arc. The outer boundary on its own says how far. A
 * workspace drawing is about what is in it.
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

/* Offsets from the station anchor; the caller adds it.

   Re-solved twice, and the second time for a reason that had nothing to do
   with this file. The first: the header used to claim the envelope was 1.75 x
   1.36 x 1.68 and it is 2.62 x 1.65 x 2.34, so every standoff before 4.60 was
   solved against an object half again smaller than the one being drawn.

   The second is the layout. The reading column is no longer pinned to the left
   edge with the world in the strip beside it: it is biased inward, 40% of the
   free frame to its left and 60% to its right, and it fades to nothing over its
   own gutter at both ends. So the world is read in two margins and runs under
   the type between them, and world/framing.js -- which shears the projection to
   clear the column -- now weights that shear by how much clear frame is on each
   side and returns 0.053 at 1916x953 and 0.072 at 1440x900, where the old sum
   returned 0.390. The subject is no longer pushed into the right margin; it
   sits very near the middle of the frame.

   That inverts the composition problem. The column covers NDC -0.629 to +0.444
   at 1916x953 and -0.754 to +0.632 at 1440x900, so a subject that fits beside
   the type is a subject nobody sees: it has to be wide enough to come out both
   sides of it. From 4.60 on a 45 degree lens the old envelope spanned -0.22 to
   +0.75 and did neither.

   Solved against the section, because the section is the figure: from 3.67 m on
   a 30 degree lens, aimed 0.73 m above the plate and 0.10 to the right of the
   base axis -- which is what leaves the axis itself on the frame's centre line
   once framing.js has sheared it -- the cut figure spans -0.76 to +0.72 in NDC
   at 1916x953 and -0.95 to +0.90 at 1440x900, and stands from -0.71 to +0.97
   vertically at both. So it clears the column by 0.13 of the frame on the left
   and 0.28 on the right at the wide window, 0.20 and 0.27 at the narrow one: a
   hatched flank in each margin, the whole figure inside the frame top to
   bottom, and the machine that generated it in the middle with the reading over
   it -- its six joint origins span [-0.47, 0.00] of NDC, which is entirely
   behind the type. That is the right way round for this station. The hero
   showed the machine; what this one has to say is the volume around it.

   The lens is the other half of it. Stepping back from 2.30 to 3.67 while going
   from 42 degrees to 30 leaves the arm itself almost exactly the size it was --
   1.27 m of machine subtends 0.715 of NDC at the hero's key and 0.643 here --
   so what the 1.74 m of travel buys is not a smaller robot, it is the room
   around one. It also keeps the eye outside the volume: the nearest point this
   formation writes is 2.30 m from the lens, which is exactly clear of the near
   fade the substrate applies under 2.2, and the furthest is 5.24. */
export const VIEW = { pos: [1.25, 0.90, 3.45], look: [1.25, 0.18, -0.15], fov: 30 };

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
 * what makes the envelope an envelope. The last gets none at all and loses
 * nothing by it, and the base's 0.45 does not bound the drawing the way the
 * others do -- both for the same reason, which is in the header: neither joint
 * moves the tool in the half-plane the region is measured in. What the base's
 * range bounds is the *working arc*, the 99.12 degrees the sheets are drawn
 * across and the band travels; the surface those solutions trace is the same
 * at every base angle and is drawn all the way round. */
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
   hole in the volume comes from, and it is worth being exact about why,
   because the kinematics on its own does not produce one: on these origins the
   shoulder and wrist offsets very nearly cancel, and a tool point can be
   brought within about a centimetre of the base axis by a chain that is folded
   straight through its own forearm. Those are solutions of the equations and
   not places the arm can go.

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

/* How many joint vectors to solve, and how finely the region they land in is
   measured.
 *
 * Only four joints are drawn, and the two left out are left out because they
 * cannot change the answer rather than to save time: the base does not move the
 * tool in the half-plane this measures and the wrist roll does not move it at
 * all, so drawing them would spend two random numbers a draw on nothing that is
 * kept. What is kept is not the positions -- there is no pool any more -- but
 * two extremes per 2 cm row of height, for the tool and for the wrist: the
 * furthest from the base axis and the nearest to it. That is the boundary,
 * which is the thing being drawn.
 *
 * 40000 draws at a measured 69.6% acceptance is 27829 solutions over the 83
 * rows the region occupies, and it is the whole cost of this file: profiled in
 * node, the sampling loop is 128 ms of a 147 ms build, and everything else --
 * the section, both hatches, the contours, the fan, the floor -- is the
 * remaining 19. Building all seven formations in one process takes 264 ms and
 * this station is 84 of them, against 37 for the fill it replaces. It is the
 * most expensive build on the page and it is paid once, before the first
 * frame.
 *
 * What it buys is checkable, because the same sampler at 1.5 million draws is
 * the reference: the outer profile at 40000, after the three-tap below, sits a
 * mean 16.6 mm inside the reference and 34 mm at its worst, which is 1.1% of a
 * 1.49 m reach and about 8 pixels at this station's standoff. A max over
 * samples can only ever under-read a boundary; the useful question is by how
 * much, and this is how much. Drawing 30000 instead moves the mean to 19.3 mm
 * and the worst row from 34 to 58 and saves about 30 ms of boot, which is where
 * the 40000 comes from: it is the point either side of which one of those two
 * gets noticeably worse.
 *
 * The three-tap is what makes it a curve rather than a picket fence. Row to row
 * the raw profile wanders 10.0 mm about its own second difference; smoothed it
 * wanders 2.5 mm, which is a pixel. Every sheet and every contour is drawn from
 * the same smoothed profile, so what wobble is left is coherent across all of
 * them -- the surface is very slightly the wrong shape rather than twenty-one
 * differently wrong shapes, and only the second of those reads as noise. */
const DRAWS = 40000;
const ZC = 0.02;
const ROWS = Math.ceil(1.9 / ZC);
/* A row with fewer solutions than this in it is where the sample ran out, not
   where the arm stops. At 40000 draws the highest row holding eight is centred
   at 1.65 against the 1.662 a 1.5-million-draw reference reaches, so the top of
   the figure is drawn 12 mm short of the arm's own reach straight up -- and the
   alternative is a boundary whose last 10 cm is the position of a single lucky
   draw. */
const MIN_N = 8;

/* Twenty-one sheets and a contour every 15 cm.
 *
 * Both are legibility numbers and both are solved against the same thing: how
 * far apart two of these land on the glass. At the key above the frame is 480
 * pixels to the metre at the volume's own depth on a 1916x953 window and 458 on
 * a 1440x900 one, and the splat this shader
 * draws here runs 2 to 7 pixels across, so anything closer together than about
 * twelve pixels is one grey area again -- which is the failure this formation
 * exists to correct, arrived at from the other direction.
 *
 * The base range is 1.7300 rad, so twenty-one sheets are 4.72 degrees apart:
 * 0.120 m between neighbours out at the floor rim, 58 pixels. The contours are
 * 15 cm of height, 71 pixels where the surface is steep, closing to nothing at
 * the top where it turns over -- which is what a contour map does at a summit,
 * and is information rather than mush.
 *
 * Sheets at the centres of twenty-one equal slices of the base range rather
 * than at its ends: the first and last would otherwise carry flow 0 and flow 1,
 * which the substrate's fract puts at the same place in the lap, and the two
 * ends of the sweep would light together. */
const SHEETS = 21;
const RING_DZ = 0.15;

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

  const q = new Array(6).fill(0);
  const frames = Array.from({ length: 6 }, () => new THREE.Matrix4());
  const v = new THREE.Vector3();
  const r = rng(0x1F0C7);

  /* ── the measurement ────────────────────────────────────────────────────
     Three loci, from one sample, all of them in the (distance from the base
     axis, height) half-plane the whole volume is a rotation of:

       tool    -- the workspace itself, a region
       wrist   -- where the last three joints meet, a region inside it
       elbow   -- where the upper arm ends, which is a *curve*, because only
                  the shoulder joint moves it and one joint traces an arc

     That the third is a line and the second an area is the machine's own
     structure showing through, and it is the reason the inside of this volume
     is worth drawing at all. */
  const tHi = new Float32Array(ROWS), tLo = new Float32Array(ROWS).fill(9);
  const wHi = new Float32Array(ROWS), wLo = new Float32Array(ROWS).fill(9);
  const tN = new Int32Array(ROWS), wN = new Int32Array(ROWS);
  let eLo = Math.PI, eHi = -Math.PI, eRad = 0, shoulderZ = 0;
  let sumR = 0, sumZ = 0, nAcc = 0;
  for (let i = 0; i < DRAWS; i++) {
    for (let k = 1; k <= 4; k++) q[k] = LO[k] + r() * (HI[k] - LO[k]);
    linkFrames(q, frames);
    toolPoint(frames, v);
    if (!reachable(v, frames)) continue;
    nAcc++;
    const rr = Math.hypot(v.x, v.y);
    sumR += rr; sumZ += v.z;
    const j = (v.z / ZC) | 0;
    if (j >= 0 && j < ROWS) {
      tN[j]++;
      if (rr > tHi[j]) tHi[j] = rr;
      if (rr < tLo[j]) tLo[j] = rr;
    }
    const e3 = frames[3].elements;
    const wr = Math.hypot(e3[12], e3[13]), jw = (e3[14] / ZC) | 0;
    if (jw >= 0 && jw < ROWS) {
      wN[jw]++;
      if (wr > wHi[jw]) wHi[jw] = wr;
      if (wr < wLo[jw]) wLo[jw] = wr;
    }
    /* The elbow, in polar about the shoulder. Its radius comes out constant
       because it is the upper arm, and the height it is measured from is the
       first joint origin -- read off the chain rather than written down here,
       so this cannot drift from the kinematics module. */
    const e2 = frames[2].elements;
    shoulderZ = frames[0].elements[14];
    const er = Math.hypot(e2[12], e2[13]), ez = e2[14] - shoulderZ;
    eRad = Math.hypot(er, ez);
    const ea = Math.atan2(ez, er);
    if (ea < eLo) eLo = ea;
    if (ea > eHi) eHi = ea;
  }

  /* A profile, as a list of (distance, height) pairs from the bottom of the
     region to the top: the smoothed extreme of every row that holds enough
     solutions to be a measurement. The floor row is pinned to the clearance
     height rather than to its own centre, because that row's samples all lie
     in the two centimetres above the plate and the plate is where the volume
     is cut off. */
  function profile(ext, n, up) {
    const rows = [];
    for (let j = 0; j < ROWS; j++) if (n[j] >= MIN_N) rows.push(j);
    if (rows.length < 2) return [];
    const out = [];
    for (let i = 0; i < rows.length; i++) {
      const a = ext[rows[Math.max(0, i - 1)]];
      const b = ext[rows[i]];
      const c = ext[rows[Math.min(rows.length - 1, i + 1)]];
      const z = i === 0 ? Math.max(CLEAR, rows[i] * ZC) : (rows[i] + 0.5) * ZC;
      out.push([(a + 2 * b + c) / 4, z]);
    }
    return up ? out : out.reverse();
  }
  const toolOut = profile(tHi, tN, true);
  const wristOut = profile(wHi, wN, true);
  const wristIn = profile(wLo, wN, false);
  const topZ = toolOut.length ? toolOut[toolOut.length - 1][1] : CLEAR;

  /* The distance from the axis the boundary stands at, at any height: the
     profile read as a curve rather than as a list. Everything below asks it
     something -- where each contour's radius is, how wide the annulus on the
     floor is, and, thirty-five thousand times, whether a candidate hatch point
     is inside the section or outside it. */
  function outerAt(z) {
    const n = toolOut.length;
    if (!n) return 0;
    if (z <= toolOut[0][1]) return toolOut[0][0];
    if (z >= toolOut[n - 1][1]) return toolOut[n - 1][0];
    // Bisected rather than walked, because the hatch asks it twice per
    // candidate and there are eighty-three rows to walk. It is worth about ten
    // milliseconds of the build and no more: profiled, the sampling loop above
    // is 128 of the 147 ms this whole function takes, and nothing else in here
    // is worth optimising until that is.
    let lo = 1, hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (toolOut[mid][1] < z) lo = mid + 1; else hi = mid;
    }
    const t = (z - toolOut[lo - 1][1]) / Math.max(1e-6, toolOut[lo][1] - toolOut[lo - 1][1]);
    return toolOut[lo - 1][0] + (toolOut[lo][0] - toolOut[lo - 1][0]) * t;
  }

  /* The hole, which is not the one the header used to claim. It said the
     volume was hollow because a six-axis arm cannot fold its tool back into
     its own shoulder, and that is measurably wrong: over a million solutions
     the tool comes within 2.0 mm of the base axis at 1.17 m of height. What it
     cannot enter is the capsule the clearance test cuts around the base
     column -- everything within one tool length of the segment from the plate
     to the first joint origin -- and the closest any accepted solution gets to
     that segment is 0.1565, which is the tool length to four figures. So the
     void is a bulb at the foot of the volume, 15.65 cm of radius, and it ends
     15.65 cm above the first joint origin. Above that the volume is solid all
     the way to the axis, and the drawing has to say so.

     Written out of the test's own two terms rather than measured, because it
     is not an empirical shape: it is a capsule about a segment, and both the
     segment and the radius are named in `reachable` twelve lines up. */
  const capsule = [];
  {
    const STEPS = 14;
    capsule.push([SELF, CLEAR], [SELF, shoulderZ]);
    for (let i = 1; i <= STEPS; i++) {
      const a = (i / STEPS) * Math.PI / 2;
      capsule.push([SELF * Math.cos(a), shoulderZ + SELF * Math.sin(a)]);
    }
  }
  function innerAt(z) {
    if (z <= shoulderZ) return SELF;
    const d = z - shoulderZ;
    return d >= SELF ? 0 : Math.sqrt(SELF * SELF - d * d);
  }

  /* The elbow's arc, at the radius and over the range the sample found. The
     radius comes back as the upper arm to four figures and the range as 5.1
     degrees below the horizontal up to exactly straight overhead -- the low
     end is where the shoulder's box stops, the high end is the arm standing
     up, past which the elbow crosses the axis and comes back down the same arc
     on the far side, which in a half-plane is the same points again. */
  const elbow = [];
  {
    const STEPS = 30;
    for (let i = 0; i <= STEPS; i++) {
      const a = eLo + (eHi - eLo) * (i / STEPS);
      elbow.push([eRad * Math.cos(a), shoulderZ + eRad * Math.sin(a)]);
    }
  }

  /* The wrist's own region, closed: out along the top of it, back along the
     bottom. Its inner edge is the thing worth having -- the wrist cannot come
     nearer the base axis than the forearm's own offset, while the tool bolted
     to it can be brought onto the axis, so the two regions are nested and not
     concentric. */
  const wrist = wristOut.concat(wristIn);
  if (wrist.length) wrist.push(wrist[0]);

  /* The section itself: the closed outline of the region, on both sides of the
     axis.

     This is the figure the whole station now hangs on, and it is the oldest
     drawing there is of a workspace -- the shape you get by cutting the volume
     with a vertical plane through the axis it is turned about. It is a bell
     standing on two feet with a rounded notch between them: up the outer
     profile on one side, across the top where the arm is standing straight up,
     down the outer profile on the other, in along the plate, round the capsule
     the tool cannot enter, and back out along the plate to where it started.
     Every metre of it was measured above.

     Both feet, one figure. The two halves join above the capsule, because the
     tool can be brought onto the base axis anywhere over 0.34 of height -- so
     this is one closed curve and not two lobes, and the notch between the feet
     is the only hole in it.

     One segment of it is a closure rather than a measurement, and it is the top:
     the figure is shut with a 0.634 m chord at 1.65 of height, and the middle
     0.14 m of that chord runs through space the arm cannot reach, because up
     there its solutions stop about 0.07 short of the axis. The rest of the
     chord is inside the region. It is drawn because at 40000 draws the inner
     edge of the last few rows is 3 to 15 cm of noise, which is not a shape
     worth drawing carefully, and a figure left open at the top is not a
     figure. */
  const section = [];
  {
    // Up the outer profile on one side, across the top, down the other side,
    // in along the plate, over the capsule, and out along the plate to where it
    // started. Written in that order because `polyline` joins what it is given:
    // an outline whose vertices are in any other order draws chords through the
    // middle of the figure, which is what the first version of this did.
    for (const p of toolOut) section.push([p[0], p[1]]);
    for (let i = toolOut.length - 1; i >= 0; i--) section.push([-toolOut[i][0], toolOut[i][1]]);
    section.push([-SELF, CLEAR]);
    for (const p of capsule) section.push([-p[0], p[1]]);
    for (let i = capsule.length - 1; i >= 0; i--) section.push([capsule[i][0], capsule[i][1]]);
    section.push([outerAt(CLEAR), CLEAR]);
  }

  /* And the face it cuts, hatched at 45 degrees the way a cut face is hatched.
     Spacing is 5 cm on the diagonal, which at this station's standoff is 24
     pixels, so it stays a hatch and does not close up into a fill -- a filled
     section would be the cotton ball again with an outline drawn round it. The
     table is walked at a stride in the fill below rather than drawn as a curve,
     because a hatch is a set of open strokes and `polyline` would join the end
     of each one to the start of the next. */
  const hatch = [];
  {
    const SPACE = 0.05 * Math.SQRT2, STEP = 0.0055;
    for (let c = CLEAR - outerAt(CLEAR); c < outerAt(CLEAR) + topZ; c += SPACE) {
      for (let u = -outerAt(CLEAR); u <= outerAt(CLEAR); u += STEP) {
        const zz = c - u;
        if (zz < CLEAR || zz > topZ) continue;
        const rr = Math.abs(u);
        if (rr > outerAt(zz) || rr < innerAt(zz)) continue;
        hatch.push(u + (r() - 0.5) * 0.004, zz + (r() - 0.5) * 0.004);
      }
    }
  }
  const HN = hatch.length / 2;

  /* The bottom face, which is the other cut in this drawing and the one that is
     not a choice: the volume is sliced off flat where the arm would have to
     reach through the plate it is bolted to. On the ground that cut is an
     annulus between the disc the tool cannot enter and the furthest it can get,
     and it is hatched with parallel chords 6 cm apart, along the base frame's
     own zero -- the one direction available that is not the camera's.

     It is also what stops the rest floating. Without a floor the contours are a
     wireframe balloon at an unknown height; with one the widest of them is
     standing on something and so is the machine in the middle of it.

     Each chord carries where it is in the base's own working arc, or nothing at
     all outside it, so the band sweeps the ground as well as the surface. */
  const ground = [];
  {
    const R = outerAt(CLEAR), SPACE = 0.06, STEP = 0.006;
    for (let y = -R; y <= R; y += SPACE) {
      for (let x = -R; x <= R; x += STEP) {
        const d = Math.hypot(x, y);
        if (d > R || d < SELF) continue;
        ground.push(x + (r() - 0.5) * 0.004, y + (r() - 0.5) * 0.004);
      }
    }
  }
  const GN = ground.length / 2;

  /* The contours of the surface the section is turned into: a ring every 15 cm
     of height, at the distance the profile stands at there. They lie on the
     boundary by construction -- the surface is a rotation of the profile and
     these are that profile's own radii.

     Whole rings, and this is the one place the drawing goes outside the box.
     Every other joint here is held to a working range because a range invented
     for it would be a specification claim with nothing behind it. The base is
     different in kind: the cross-section is provably the same at every base
     angle -- that is the fact this whole formation is built on, measured at
     8.9e-16 -- so a ring is not a claim that the joint may turn there, it is
     the section's own statement about what shape it makes when it is turned.
     What stays bounded is the *working arc*: the sheets, the lit wedge on the
     ground and the travelling band all live inside the 99.1 degrees the move's
     own base range widens to.

     Sparse, and much fainter than the section. Drawn at the density they were
     at first -- one every 5 cm, with a meridian every 13 degrees crossing them
     -- they turned into a woven ball, which is a legible object and the wrong
     one: it hid its own floor, hid the machine at its centre, and said nothing
     about where an arm can reach that a globe does not also say. What they are
     for is to tell the reader that the flat figure in front of them is turned,
     and ten of them do that. */
  const rings = [];
  for (let z = CLEAR + RING_DZ; z <= topZ; z += RING_DZ) rings.push([outerAt(z), z]);

  /* Where the drawing is put, in the base's own angle.
   *
   * A0 is the low end of the working arc, in the half-plane the tool is
   * actually in: the far side of the axis from the base angle. That is not a
   * convention -- measured over 419000 solutions, 88.5% of accepted tool points
   * sit on the far side, because the shoulder's box is nearly all negative and
   * an arm lifted that way reaches back over its own base. Put the sheets on
   * the near side and the whole volume would be drawn on the wrong side of the
   * machine.
   *
   * AMID is the middle of that arc, and the section is cut there. It is the
   * middle of the base range and nothing else, which matters: a cutting plane
   * chosen to face the camera is a plane that has to be re-chosen every time
   * the camera moves. It happens to land 6.0 degrees off square to this
   * station's eye, so the section is read very nearly face on, and that is
   * luck about where the hero move's four waypoints put the shoulder rather
   * than anything this file arranged.
   *
   * What the section leaves out, said plainly: the tool is also carried off
   * the plane of the arm by the wrist offsets, a measured 0.4471 m at most and
   * 0.186 median. The section is the volume cut, not the volume flattened, so
   * this costs it nothing -- but the sheets either side of it are that
   * projection, and they are drawn faint for exactly that reason. */
  const A0 = LO[0] + Math.PI, SPAN = HI[0] - LO[0], AMID = A0 + SPAN * 0.5;

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

  // A half-plane point, at a base angle, in world space.
  const put3 = (rr, zz, ca, sa) =>
    new THREE.Vector3(rr * ca, rr * sa, zz).applyMatrix4(place);
  const curve = (pairs, ca, sa) => pairs.map(p => put3(p[0], p[1], ca, sa));

  return function fill(pos, kind, size, count, flow) {
    const { S, P, F } = bands(pos, kind, size, count, flow);

    /* What the whole band is spent on, and what it comes back at.
     *
     * Nothing solid stands at this station except the arm the previous one
     * leaves standing, so the substrate is not held back the way it is over
     * geometry: uFade settles at 0.62 and world/config.js takes this station's
     * cloud to 0.5 on top of that, for 0.31. That 0.5 was measured against the
     * old fill, which saturated at 1.0 -- 0.129 of the frame over 140 -- and a
     * drawing made of lines does not saturate the same way. Measured on this
     * one: at a gain of 1.0 the left strip goes from 15.5 to 26.6 of mean and
     * from 101 to 148 at the 99th percentile, the fraction of the frame over
     * 140 stays put at 0.017, and the picture is a brighter drawing rather than
     * a wash. The gain lives in world/config.js and is not this file's to set,
     * but it was solved against an object that is no longer here.
     *
     * Measured off the journey at 1440x900 on the high tier, over the two
     * strips of frame the reading column does not cover, which is all of this
     * station a settled reader ever sees: 15.5 of 255 mean on the left and 17.9
     * on the right, with the left strip's 99th percentile at 101. The same walk
     * gives Work 23.9 and 29.8, Path 21.6 and 42.3, Measured 17.8 and 21.6,
     * Contact 11.3 and 17.0, Stack 7.4 and 18.6, Intro 5.9 and 23.6. So this
     * sits in the middle of the page on the mean and at the top of it on the
     * peak, which is what line work should do: the lines are bright and the
     * space between them is empty. The old fill did the reverse.
     *
     * The counts, at the high tier's 49600 structure points: 6930 on the
     * twenty-one sheets, 9387 on the section's hatch and 3661 on its outline,
     * 4442 on the wrist and 2962 on the elbow and 1184 on the void, 5463 on the
     * contours, 5294 on the ground hatch and 3512 on its rims, 3720 on the
     * floor lattice, and 3045 left for the padding to thicken all of it with. */

    /* The sheets, first, at exactly the count the manipulator gave its body
       sweep. RUN_SHARE is imported rather than repeated, and taken off a full
       band in both files, so the two counts are the same integer and the sweep
       is written onto the indices the body sweep was written onto. What crosses
       is then one band handing over to another band rather than one lighting up
       while the other goes out: over there a chain of the arm lights at the
       instant of the move it belongs to, over here a half-plane of solutions
       lights at the base angle it belongs to, and it is the same matter
       carrying the same channel.

       Each sheet is one stroke at one flow value, so the band does not crawl up
       a sheet, it selects sheets -- the same discipline the manipulator's poses
       are drawn with, and the reason the lit thing reads as a plane slewing
       rather than as a texture crawling.

       Faint, at 0.40, because twenty-one of them settled at the weight of the
       section would be the woven ball again. Under the band the shader takes a
       sheet to 0.62 across and 2.5 times the colour -- so against the hatch it
       is passing through, which is 0.60 and unlit, a lit sheet is 3% wider and
       two and a half times brighter. What the eye has at rest is one measured
       figure; what moves through it is the machine covering that figure. */
    const nSheet = S.share(RUN_SHARE), perSheet = Math.floor(nSheet / SHEETS);
    for (let i = 0; i < SHEETS; i++) {
      const u = (i + 0.5) / SHEETS;
      const a = A0 + u * SPAN;
      polyline(curve(toolOut, Math.cos(a), Math.sin(a)), perSheet, S, STRUCTURE,
               0.40, 0.004, 0x5C01 + i * 37, [u, u]);
    }

    /* The section: its cut face, then its outline over the top of that.
     *
     * The hatch is written as one walk of a table built once, at a stride that
     * spends exactly the share it is given, because a hatch is a set of open
     * strokes rather than one curve and `polyline` would join the end of each
     * line to the start of the next.
     *
     * The outline is the heaviest line in the formation and the only closed one
     * -- 0.95 against the hatch's 0.60 and the contours' 0.44 -- because it is
     * the answer to the question the section is asked. Everything else here is
     * where the arm could be; this is where it stops. Drawn over the hatch
     * rather than under it, and at 3661 points along 8.5 m of curve, which is
     * one every 2.3 mm: at this standoff that is a continuous line and not a
     * dotted one, and the boundary is the one thing here that cannot be dotted. */
    const cMid = Math.cos(AMID), sMid = Math.sin(AMID);
    const nHatch = S.share(0.22);
    {
      const stride = HN / Math.max(1, nHatch);
      for (let k = 0; k < nHatch; k++) {
        const h = ((k * stride) | 0) * 2;
        if (h + 1 >= hatch.length) break;
        S.v(put3(hatch[h], hatch[h + 1], cMid, sMid), STRUCTURE, 0.60);
      }
    }
    polyline(curve(section, cMid, sMid), S.share(0.11), S, STRUCTURE, 0.95, 0.003, 0x0B1E);

    /* And what is inside it: where the wrist can be, where the elbow can be.
     *
     * This is the half of a workspace drawing that the outer boundary cannot
     * carry. The boundary says how far; these say what the machine is. The
     * wrist's is an area that stops short of the base axis -- measured, it never
     * comes nearer than 0.1742, which is the forearm's own offset to four
     * figures, while the tool bolted to it reaches the axis, so the two regions
     * are nested and not concentric -- and the elbow's is a *line*, a circular
     * arc 0.6127 from the shoulder, which is the upper arm, because one joint
     * moves it and one joint traces an arc. A reader who sees a line inside two areas has been told
     * where the degrees of freedom went.
     *
     * Both sides of the axis, because the section has two sides. The elbow
     * carries the larger splat: it is a line among areas and a line drawn
     * thinner than what surrounds it disappears into it. */
    const nWrist = Math.floor(S.share(0.15) / 2);
    const nElbow = Math.floor(S.share(0.10) / 2);
    const nVoid = Math.floor(S.share(0.04) / 2);
    for (let side = -1; side <= 1; side += 2) {
      const flip = pairs => pairs.map(p => [side * p[0], p[1]]);
      polyline(curve(flip(wrist), cMid, sMid), nWrist, S, STRUCTURE, 0.54, 0.004, 0x3117 + side * 91);
      polyline(curve(flip(elbow), cMid, sMid), nElbow, S, STRUCTURE, 0.66, 0.004, 0x9E01 + side * 53);
      polyline(curve(flip(capsule), cMid, sMid), nVoid, S, STRUCTURE, 0.56, 0.003, 0x2C0D + side * 17);
    }

    /* The contours, running. A ring carries its own azimuth as flow over the
       working arc and nothing outside it, so what lights is the ring's crossing
       with the half-plane the sheets are lit at: the surface and the sheet
       under it move as one thing. Lit any other way they would be two.

       They run past RUN_SHARE, which is a deliberate cost and a small one. A
       point that carries flow at this end of the morph and not at the other is
       weighted by the mix -- so these are at 0.99 of full band the whole time
       anybody is reading this station, and at half strength for the half second
       of the crossing itself. The alternative is a surface whose contours stand
       dead still while a sheet sweeps through them. */
    let ringLen = 0;
    for (const g of rings) ringLen += g[0];
    const nRing = S.share(0.26);
    const arc = (rr, zz, from, to, steps) => {
      const pts = [];
      for (let i = 0; i <= steps; i++) {
        const a = from + (to - from) * (i / steps);
        pts.push(put3(rr, zz, Math.cos(a), Math.sin(a)));
      }
      return pts;
    };
    for (const g of rings) {
      const n = Math.floor(nRing * g[0] / Math.max(1e-6, ringLen));
      const seed = 0x77A1 + Math.round(g[1] * 1000);
      polyline(arc(g[0], g[1], A0, A0 + SPAN, 32), Math.round(n * SPAN / (2 * Math.PI)),
               S, STRUCTURE, 0.44, 0.004, seed, true);
      polyline(arc(g[0], g[1], A0 + SPAN, A0 + 2 * Math.PI, 72),
               Math.round(n * (2 * Math.PI - SPAN) / (2 * Math.PI)),
               S, STRUCTURE, 0.35, 0.004, seed + 7);
    }

    /* The ground: the hatched annulus, then the two rims that bound it and the
       two radii that end the working arc on it.

       The hatch carries the sweep the same way the contours do -- a chord's
       flow is where it sits in the base range, and nothing outside it -- so the
       band crosses the floor as a lit wedge turning about the base. That is the
       one part of this drawing that looks like what the machine is doing rather
       than like what it can do.

       The rims are the heaviest lines here after the section's outline, because
       they are the only two edges in the whole formation that a hand could
       touch: the circle the tool traces on the plate at full stretch, and the
       disc at the middle of it the tool cannot enter at all. */
    const nGround = S.share(0.34);
    {
      const stride = GN / Math.max(1, nGround);
      const TAU = Math.PI * 2;
      const p = new THREE.Vector3();
      for (let k = 0; k < nGround; k++) {
        const h = ((k * stride) | 0) * 2;
        if (h + 1 >= ground.length) break;
        const d = ((Math.atan2(ground[h + 1], ground[h]) - A0) % TAU + TAU) % TAU;
        p.set(ground[h], ground[h + 1], CLEAR).applyMatrix4(place);
        S.put(p.x, p.y, p.z, STRUCTURE, 0.52, d <= SPAN ? d / SPAN : undefined);
      }
    }
    const nFoot = S.share(0.30);
    {
      const rim = (rr, n, sz, seed) => {
        const pts = [];
        for (let i = 0; i <= 96; i++) {
          const a = A0 + 2 * Math.PI * (i / 96);
          pts.push(put3(rr, CLEAR, Math.cos(a), Math.sin(a)));
        }
        polyline(pts, n, S, STRUCTURE, sz, 0.003, seed);
      };
      rim(outerAt(CLEAR), Math.floor(nFoot * 0.60), 0.72, 0x4401);
      rim(SELF, Math.floor(nFoot * 0.14), 0.64, 0x4402);
      for (let e = 0; e < 2; e++) {
        const a = A0 + SPAN * e, ca = Math.cos(a), sa = Math.sin(a);
        polyline([put3(SELF, CLEAR, ca, sa), put3(outerAt(CLEAR), CLEAR, ca, sa)],
                 Math.floor(nFoot * 0.20), S, STRUCTURE, 0.58, 0.003, 0x4403 + e);
      }
    }

    // Fainter and jittered wider, so a lattice node reads as a soft mark: the
    // floor is what the volume stands over, not part of the measurement of
    // where the arm can go.
    const nFl = S.share(0.55), perFl = NFL / Math.max(1, nFl);
    for (let k = 0; k < nFl; k++) {
      const o = ((k * perFl) | 0) * 3, j = (k * 3 + 977) & JM;
      S.put(FL[o]     + jit[j]     * 0.024,
            FL[o + 1] + jit[j + 1] * 0.006,
            FL[o + 2] + jit[j + 2] * 0.024, STRUCTURE, 0.38);
    }
    // Small, because what is left over is spent thickening lines rather than
    // scattering matter beside them: at 0.006 a leftover lands inside its own
    // stroke and the curve is drawn denser, which is the only thing this
    // formation wants more of.
    S.pad(0.006);

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
    /* The volume's own frame, on the world axes: a reachable set is a region
       rather than a body and has no orientation to borrow. Longer than the
       joint triads because it measures all of them.

       At the mean of the accepted solutions -- 0.674 m from the axis and 0.740
       above the plate -- put on the plane the section is cut in, which is the
       one place a mean over a rotation can honestly be put: anywhere else it
       would be a claim about an azimuth, and the mean has none. It ticks once a
       lap, whole, as the sweep passes that plane. A frame is a claim about one
       place, so it does not get a band crawling through it; it gets the beat
       the sweep passes its own centre on. */
    const cen = put3(sumR / Math.max(1, nAcc), sumZ / Math.max(1, nAcc), cMid, sMid);
    runTriad(new THREE.Matrix4().makeTranslation(cen.x, cen.y, cen.z),
             F.share(0.92), F, 0.30, 1.2, 0.5);
    F.pad(0.01);
  };
}
