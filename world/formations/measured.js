/* Formation 03 -- the instrument, and the five numbers it read.
 *
 * The section this stands in is the one where a claim off a résumé was
 * checked instead of repeated, so this is not a chart hung in space. It is a
 * rig: a plate on the floor, a reference plane behind it, a logarithmic scale
 * ruled across that plane, and five measured volumes standing in it. The
 * camera comes level with the bars for the same reason -- a bar you look down
 * on is a graphic, a bar you look across at is an object in a room, and only
 * one of those feels like walking into an instrument.
 *
 * Every height comes off the page's own tables. The five speedups below are
 * the only figures in this file, they carry the labels the document gives
 * them, and the two ends of the scale are the smallest and largest of the
 * five rather than round numbers -- choosing the ends of a log axis is
 * choosing the shape it draws, and the shape here has to be the measurement.
 *
 * The accent arrives from the occupancy grid as a route somebody planned and
 * leaves for the corridor as a route somebody drove. In between it is this:
 * one unbroken polyline over the tops of the bars. Unbroken is not a detail.
 * Five separate strokes would cross the boundary as five things appearing,
 * which is the cut the whole substrate exists to avoid.
 *
 * And it is drawn rather than standing already drawn. The substrate carries a
 * travelling band -- a point knows where along its own feature it sits and the
 * band passes over it once a lap -- so the profile is laid across the caps
 * left to right, in the order the table reports the five runs, once every five
 * seconds. That is the whole of the motion this station is allowed, and it is
 * the right one: a rig somebody walks into does not animate itself, but an
 * instrument standing in a room is an instrument taking a reading.
 *
 * The rig carries the same parameter as the stroke over it, and that is not
 * decoration either. A settled station is always the far end of a pair -- the
 * substrate holds formation k-1 and formation k and sits at mix 1 -- and a
 * point only runs where both ends of that pair give it a flow, so whatever
 * this file leaves unwritten is a thing the *next* station cannot move. The
 * bundle of rollouts that Stack forms out of these same points is swept out
 * of the body along its horizon, and it is swept because the bars and the
 * chassis it is swept out of carry a reading of their own.
 */
import * as THREE from "three";
import { bands, polyline, rng, STRUCTURE, PATH, FRAME } from "./lib.js";

/* Offsets from the station anchor; the caller adds it. Solved against the
   rig's own extents rather than nudged. The plate is 2.44 across and the
   scale stands 1.60 off it, which at 44 degrees wants 2.6 of standoff before
   the corners clear the frame. The eye then sits at 0.74, a shade under the
   middle of the scale and above only the shortest of the five caps, so the
   bars are stood among and looked up rather than looked down into -- the
   whole difference between an object in a room and a chart pasted on the
   glass. The 0.45 of offset earns more than it costs: square on, the bars are
   five rectangles and their depth is a claim nobody can check, and ten
   degrees round is enough to open a side face on every one of them. In a
   16:10 window all of that lands across 84% of the frame and 90% of the way
   down it, centred, with nothing outside it at all.

   The look point used to sit half a metre left of that, which was not about
   the rig at all -- it was pushing the bars out from behind the panel by
   swinging the camera. That correction is framing.js's now, and it belongs
   there: an offset in metres is an offset in NDC only after dividing by
   `tan(fov/2) * aspect`, so half a metre framed correctly at 16:10 and
   nowhere else. The key aims at the instrument again. */
export const VIEW = { pos: [0.30, 0.74, 2.78], look: [0, 0.72, -0.24], fov: 44 };

/* Two states, and the second needs a key of its own. Stack is the same rig
   from further out and above: the section is a list of what the numbers were
   taken with, and the reading is the instrument entire rather than any one
   bar. Without a key the camera spent Stack flying four metres onward and
   finished inside the rig, which is the smear of white that state was
   rendering.

   Both aim at the instrument rather than left of it, for the reason above:
   getting clear of the panel is a job done in NDC, once, for every station. */
export const VIEWS = [
  VIEW,
  { pos: [1.42, 1.48, 3.55], look: [0, 0.52, -0.34], fov: 40 }
];

/* The measurements, exactly as the Measured tables report them: A* on three
   costmaps, DWA on the two windows the controller actually evaluates. The
   labels travel with the numbers so that a table edited upstairs and a rig
   drawn down here cannot quietly disagree about what is being shown. */
const RUNS = [
  { label: "A* 128",    speedup: 163 },
  { label: "A* 256",    speedup: 99  },
  { label: "A* 384",    speedup: 192 },
  { label: "DWA accel", speedup: 26  },
  { label: "DWA full",  speedup: 4   }
];

/* The rig, in metres. A bar has a depth because it is a volume standing on a
   plate, not a rectangle drawn on one; the plate and the plane reach past the
   bars on every side because a bench always does. */
const SPAN = 2.40;                       // across the five cells
const BAR_W = 0.30, BAR_D = 0.26;
const HALF_W = 1.22;                     // plate and plane, wider than the bars
const BACK_Z = -0.62, FRONT_Z = 0.46;
const WALL_H = 1.80;
const LATTICE = 0.05;                    // node spacing of both sparse lattices

/* Heights. 4x and 192x do not share a linear axis anyone can read: on one,
   four of the five bars are a smear along the plate and the only thing the
   picture says is that 384 was slow in Python. So the axis is logarithmic,
   its ends are the extremes of the data, and the foot of the scale is
   deliberately not the floor -- the worst of these ports is still four times
   the Python it replaced, and a bar of zero height would say it was nothing. */
const MIN = Math.min(...RUNS.map(r => r.speedup));
const MAX = Math.max(...RUNS.map(r => r.speedup));
const LO = Math.log(MIN), HI = Math.log(MAX);
const FOOT = 0.18, RISE = 1.42;
function height(x) { return FOOT + (Math.log(x) - LO) / (HI - LO) * RISE; }

/* Where the scale is ruled: the decade stops that fall inside the range, and
   its two ends. A log axis with no decade on it is a line somebody drew. */
const TICKS = [MIN, 10, 100, MAX];
const TICK_OUT = 0.13;                   // how far a tick steps off the plane

/* More surface samples than the largest tier will ever draw, so the walk in
   fill thins the skin rather than placing the same point twice. */
const POOL = 28000;

export function build(ctx) {
  const anchor = ctx.anchor;
  const r = rng(0x8ea51);
  const y0 = anchor.y;

  const cell = SPAN / RUNS.length;
  const bars = RUNS.map((run, i) => ({
    x: anchor.x - SPAN / 2 + (i + 0.5) * cell,
    h: height(run.speedup)
  }));

  /* The bars, as skin rather than solid. Filling the volume spends most of
     the budget behind two faces nobody can see through, and the silhouette is
     the entire content of a bar -- so: four sides and a cap, area-weighted,
     and no underside because it is standing on the plate. Each face is an
     origin and the two edges that span it, which makes the sample two
     multiply-adds per axis. */
  const face = [], area = [];
  let total = 0;
  for (const b of bars) {
    const x0 = b.x - BAR_W / 2, z0 = anchor.z - BAR_D / 2, top = y0 + b.h;
    const add = (o, u, v, a) => { face.push(...o, ...u, ...v); area.push(a); total += a; };
    add([x0, y0, z0 + BAR_D], [BAR_W, 0, 0], [0, b.h, 0], BAR_W * b.h);
    add([x0, y0, z0],         [BAR_W, 0, 0], [0, b.h, 0], BAR_W * b.h);
    add([x0, y0, z0],         [0, 0, BAR_D], [0, b.h, 0], BAR_D * b.h);
    add([x0 + BAR_W, y0, z0], [0, 0, BAR_D], [0, b.h, 0], BAR_D * b.h);
    add([x0, top, z0],        [BAR_W, 0, 0], [0, 0, BAR_D], BAR_W * BAR_D);
  }
  const skin = new Float32Array(POOL * 3);
  for (let f = 0, n = 0, acc = 0; f < area.length; f++) {
    acc += area[f];
    // The last face takes whatever rounding left over, so the pool is exactly
    // full and fill never reads past what was written.
    const upto = f === area.length - 1 ? POOL : Math.round(POOL * acc / total);
    const o = f * 9;
    while (n < upto) {
      const u = r(), v = r();
      skin[n * 3]     = face[o]     + face[o + 3] * u + face[o + 6] * v;
      skin[n * 3 + 1] = face[o + 1] + face[o + 4] * u + face[o + 7] * v;
      skin[n * 3 + 2] = face[o + 2] + face[o + 5] * u + face[o + 8] * v;
      n++;
    }
  }

  /* The chassis: the plate the bars stand on and the plane they are read
     against. Without it five columns hang in a void and the section reads as
     a graphic; with it they are mounted in something, which is what the
     numbers actually came out of. Both lattices thin outward from the
     measurement, so the rig has an edge that fades rather than a border that
     stops -- the same reason the manipulator's floor thins. */
  const NX = Math.round(2 * HALF_W / LATTICE);
  const NZ = Math.round((FRONT_Z - BACK_Z) / LATTICE);
  const NY = Math.round(WALL_H / LATTICE);
  const rig = [];
  for (let ix = 0; ix <= NX; ix++) {
    const x = -HALF_W + (ix / NX) * 2 * HALF_W;
    for (let iz = 0; iz <= NZ; iz++) {
      const z = BACK_Z + (iz / NZ) * (FRONT_Z - BACK_Z);
      const d = Math.max(Math.abs(x) / HALF_W, Math.abs(z) / -BACK_Z);
      if (r() > 1 - d * d * 0.74) continue;
      rig.push(anchor.x + x, y0, anchor.z + z);
    }
    for (let iy = 0; iy <= NY; iy++) {
      const y = (iy / NY) * WALL_H;
      const d = Math.max(Math.abs(x) / HALF_W, y / WALL_H);
      if (r() > 1 - d * d * 0.82) continue;
      rig.push(anchor.x + x, y0 + y, anchor.z + BACK_Z);
    }
  }
  const CH = Float32Array.from(rig), NCH = CH.length / 3;

  /* The profile. Across a bar's cap at its own height, on across the gap, and
     then straight up or down the face of the next one -- a step function,
     because that is what five separate measurements are. It runs on past both
     end bars so the strand enters and leaves the rig rather than starting in
     mid-air, and it sits just proud of the front faces so it reads as drawn
     on the instrument instead of buried inside it. */
  const PZ = anchor.z + BAR_D / 2 + 0.03, LEAD = 0.19;
  const profile = [new THREE.Vector3(bars[0].x - BAR_W / 2 - LEAD, y0 + bars[0].h, PZ)];
  for (let i = 1; i < bars.length; i++) {
    const edge = bars[i].x - BAR_W / 2;
    profile.push(new THREE.Vector3(edge, y0 + bars[i - 1].h, PZ));
    profile.push(new THREE.Vector3(edge, y0 + bars[i].h, PZ));
  }
  const last = bars[bars.length - 1];
  profile.push(new THREE.Vector3(last.x + BAR_W / 2 + LEAD, y0 + last.h, PZ));

  /* Each gridline and its tick are one stroke, drawn the way a hand draws
     them: out from the plane at the left edge, back to it, then away across
     the full width. One polyline each, so the sampler puts about a twentieth
     of the stroke on the tick, which is what a tick is. */
  const rules = TICKS.map(v => {
    const y = y0 + height(v);
    return [new THREE.Vector3(anchor.x - HALF_W, y, anchor.z + BACK_Z + TICK_OUT),
            new THREE.Vector3(anchor.x - HALF_W, y, anchor.z + BACK_Z),
            new THREE.Vector3(anchor.x + HALF_W, y, anchor.z + BACK_Z)];
  });

  /* The corner the whole rig is measured from: left end of the axis, on the
     plate, against the plane. Unrotated, because for once the world axes are
     the right ones -- X runs along the five runs, Y is the scale itself, Z
     comes off the plane towards the reader. */
  const org = new THREE.Vector3(anchor.x - HALF_W, y0, anchor.z + BACK_Z);

  /* How far along the reading a piece of the instrument stands: 0 at the left
     end of the plate, 1 at the right. The axis is the reading -- five runs
     laid out in the order the table reports them -- so the one honest
     parameter for a lump of the rig is where along that axis it is, and the
     band then crosses plate, bars and plane together instead of the accent
     stroke travelling over a rig that is standing still underneath it.

     Taken off the scattered position rather than the lattice node it came
     from, and then clamped, which is not defensive: the chassis is jittered by
     up to 11 mm and that is 0.0045 of the 2.44 the plate spans, so a node on
     the left edge comes out at -0.0045. The substrate reads anything below
     zero as a point that does not run at all rather than as a point at the
     start of the run, so without the clamp the near edge of the plate would
     be the one part of the rig that stays dead. */
  const X0 = anchor.x - HALF_W, XW = 2 * HALF_W;
  const across = x => Math.min(1, Math.max(0, (x - X0) / XW));

  /* The corner is written here rather than through lib's axisTriad, which has
     no flow to give: it draws through `triad`, and a triad is three strokes
     out of an origin with nothing to be partway along. Each axis is its own
     two-point stroke at one constant value instead, so the frame lights whole
     as the band reaches the end of the plate it stands on.

     1 rather than 0, which is the same instant on a wrapped lap and the reason
     it is worth choosing between them: these same points are the pose at the
     far end of Stack's committed rollout, which carries 1 as well, so the
     value is constant across the crossing. Written as 0 it would read the same
     standing still and lerp through every phase of the lap on the way over. */
  const CORNER = 1.0;
  const A = new THREE.Vector3(), B = new THREE.Vector3();
  function corner(n, w, len, sz) {
    const per = Math.max(3, Math.floor(n / 3));
    for (let k = 0; k < 3; k++) {
      A.copy(org);
      B.set(org.x + (k === 0 ? len : 0), org.y + (k === 1 ? len : 0), org.z + (k === 2 ? len : 0));
      polyline([A, B], per, w, FRAME, sz, 0, 0x4d10 + k * 13, [CORNER, CORNER]);
    }
  }

  /* One table of noise, read three at a time, with two entries of overrun so
     the read past the wrap is a read rather than a bounds check. */
  const JN = 4096, JM = JN - 1;
  const jit = new Float32Array(JN + 2);
  for (let i = 0; i < JN; i++) jit[i] = r() * 2 - 1;
  jit[JN] = jit[0]; jit[JN + 1] = jit[1];

  return function fill(pos, kind, size, count, flow) {
    const { S, P, F } = bands(pos, kind, size, count, flow);

    const nBar = S.share(0.70), perBar = POOL / Math.max(1, nBar);
    for (let k = 0; k < nBar; k++) {
      const o = ((k * perBar) | 0) * 3, j = (k * 3) & JM;
      const x = skin[o] + jit[j] * 0.004;
      S.put(x,
            skin[o + 1] + jit[j + 1] * 0.004,
            skin[o + 2] + jit[j + 2] * 0.004, STRUCTURE, 1.0, across(x));
    }
    // Fainter than the bars and jittered wider, so a lattice node reads as a
    // soft dot: the chassis is what the numbers are mounted in, not one of
    // them, and a rig drawn as crisply as its own measurements competes.
    const nCh = S.share(0.80), perCh = NCH / Math.max(1, nCh);
    for (let k = 0; k < nCh; k++) {
      const o = ((k * perCh) | 0) * 3, j = (k * 3 + 1289) & JM;
      const x = CH[o] + jit[j] * 0.011;
      S.put(x,
            CH[o + 1] + jit[j + 1] * 0.011,
            CH[o + 2] + jit[j + 2] * 0.011, STRUCTURE, 0.55, across(x));
    }
    S.pad(0.02);

    /* The reading. `true` maps the stroke's own arc length onto the whole lap,
       so the band comes in along the lead off the 163x bar, crosses the five
       caps in the order the table reports them, and leaves past the 4x one --
       five seconds for the 4.45 m the profile runs, which is 0.89 m/s of
       stroke. 0.16 of a lap is the substrate's band width, so 0.71 m of the
       profile is lit at once: about one cap and the step down off it, which
       makes what travels a reading head with a bar inside it rather than a
       spark running along a wire. And it dwells where a step function dwells.
       42% of the length is vertical -- the drop from 192x to 26x is 0.73 m of
       it on its own, the tallest single move in the picture -- so the band
       spends nearly half its pass on the differences between the runs rather
       than on the runs, which is what the profile was drawn to show. */
    polyline(profile, P.share(0.92), P, PATH, 1.6, 0.010, 0x2b4d, true);
    P.pad(0.014);

    /* Each rule on its own arc length, which starts at the tick and runs the
       width of the plane, so the four of them are ruled left to right with the
       bars rather than across them: the scale and the thing it measures are
       one instrument and they are read in one pass. */
    const per = Math.floor(F.share(0.74) / rules.length);
    for (let i = 0; i < rules.length; i++)
      polyline(rules[i], per, F, FRAME, 0.8, 0.004, 0x3100 + i * 7, true);
    corner(F.share(0.92), F, 0.28, 1.15);
    F.pad(0.01);
  };
}
