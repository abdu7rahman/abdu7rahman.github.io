/* Formation 03 -- the instrument, and the ten numbers it read.
 *
 * The section this stands in is the one where a claim off a résumé was
 * checked instead of repeated, so this is not a chart hung in space. It was a
 * rig -- a plate, a plane, five bars standing on it -- and the trouble with a
 * rig is that a reader is always outside one. Composed against the panel the
 * page actually stages, that rig came back a ghost. Measured off the render at
 * 1440x900, the clear frame to the left of the reading column had a mean
 * luminance of 7.0 out of 255 and a p90 of 10, and the strip on the right 7.6
 * and 11 -- against Path's 24.0 and 62 across the same left-hand strip.
 * Nothing was wrong with the rig. There was simply nothing of it where the
 * frame was open, because the reading column is 1180px wide here -- the widest
 * on the page, what a five-column table needs -- and everything the rig had to
 * say was behind the type.
 *
 * So it is an enclosure now and the reader is inside it. A bed underfoot,
 * two side rails running from behind the measurement out past the eye, portal
 * frames threaded on them, a ruled graticule the camera sits in the middle of,
 * and an overhead gantry receding into the fog behind. The parts that carry
 * the composition are the parts that leave the frame: a rail that runs out of
 * shot at the edge is the one thing a 65-pixel margin can hold, and it says
 * enclosure in a way an object standing in the middle distance cannot. Those
 * two strips now measure 21.2 mean and 44 at p90 on the left and 22.4 and 61
 * on the right, three times what they were, with the fraction above 40 going
 * from nothing at all to 0.150 and 0.212 -- and the fraction of the whole
 * frame above 140 unchanged at 0.022, so none of it was bought by blowing
 * something out.
 *
 * What is drawn has changed with it, and this is the more important half.
 *
 * The five bars used to be five *speedups* -- 163, 99, 192, 26, 4. A speedup
 * is a quotient of two things that were timed; it is not itself a
 * measurement. The tables upstairs draw the measurements: a Python bar and a
 * C++ bar per row, on a log axis, in the two swatch colours. So this draws
 * those. Ten members, five pairs, each pair one row of a table, heights off
 * the ten latencies in milliseconds. The axis runs 0.0098 ms to 884.21 ms --
 * the fastest and the slowest thing on the page -- which is 4.955 decades, and
 * five of them fall inside it.
 *
 * That is not a demotion of the speedup. On a logarithmic axis the vertical
 * gap between a pair *is* the speedup, exactly: 0.339 m per decade, so 0.750 m
 * at 128 squared, 0.676 at 256, 0.774 at 384, 0.506 on the accel-limited DWA
 * window, and 0.204 on the full one. The claim the section makes -- that the
 * port buys the most where it matters least -- is that last stub against the
 * other four, and it is now a length the eye compares rather than a number the
 * eye is told.
 *
 * One figure has to be said out loud because a reader with a ruler will find
 * it. The gap on the accel-limited row is log(0.3037 / 0.0098) = 31, and the
 * table publishes 26. The table is right and so is the gap: the speedup column
 * is per trajectory, and numpy sweeps 36 candidates where the C++ loop sweeps
 * 30, because the numpy window is built with arange against a stop of
 * v_max + resolution. The two times are the two times. The ratio of them is
 * 31 and the honest comparison of the two implementations is 26.
 *
 * Every number here comes off the page's own tables and carries the label the
 * document gives it, so that a table edited upstairs and an instrument drawn
 * down here cannot quietly disagree about what is being shown. Nothing is
 * displayed that was not measured, and the axis ends are the extremes of the
 * data rather than round numbers -- choosing the ends of a log axis is
 * choosing the shape it draws, and the shape here has to be the measurement.
 *
 * The accent arrives from the occupancy grid as a route somebody planned and
 * leaves for the corridor as a route somebody drove. In between it is the C++
 * envelope: a step profile over the caps of the five C++ members. The teal it
 * was ruled against becomes the Python envelope over the other five. That is
 * the page's own colour coding -- .bar--cpp is the accent, .bar--py is the
 * teal -- and it means the two lines in the world and the two bars in the
 * table are the same two things.
 *
 * Both envelopes break at the assembly boundary, because the two benchmarks
 * are two experiments. A* on three costmaps is one bay of the instrument and
 * DWA on two windows is the other; they share a bed, a graticule and a frame,
 * and nothing else. Run as one line they cross -- A* 384 in C++ takes 4.598 ms
 * and the accel-limited DWA window takes 0.3037 in Python, so the C++ line
 * passes above the Python one in the gap between the families -- and a
 * crossing there means nothing at all, because no quantity is shared across
 * it. Four strokes, two bays, one frame.
 *
 * And it is drawn rather than standing already drawn. The substrate carries a
 * travelling band -- a point knows where along its own feature it sits and the
 * band passes over it once a lap. Every part of the instrument carries the
 * same parameter now, and it is not arc length any more, it is *x*: how far
 * across the reading a lump of matter stands. So what travels is a plane
 * sweeping the instrument left to right, and it lights the bed, the members,
 * the rules and both envelopes at the same station at the same instant.
 *
 * That is a correction, and worth saying so. The old profile ran on its own
 * arc length, which meant it dwelled on its vertical steps -- 42% of the
 * stroke -- while the rig underneath stood still. It read as a spark going
 * along a wire over a static chart. Swept in x, a riser lights all at once as
 * the head crosses it, which is right: the difference between Python and C++
 * at 128 squared happens at 128 squared, not over a stretch of time. The band
 * is 0.16 of a lap wide and the instrument is 4.72 m across, so 0.755 m is lit
 * at once -- nine tenths of the 0.816 a cell spans. The reading head is one
 * run wide to within six centimetres, and it crosses the whole instrument in
 * five seconds at 0.94 m/s.
 *
 * One old claim in this header was simply wrong and is deleted rather than
 * moved: it said a point only runs where both ends of the morph give it a
 * flow, so anything left unwritten here was a thing Stack could not animate.
 * That was true of the first version of the band and has not been true since.
 * The substrate ramps the weight with the morph instead of gating on it -- a
 * point running at one end runs, at the weight that end has -- so this file
 * owes its neighbour nothing except the one value the two of them share, which
 * is the corner, and that is still written at 1.0 on purpose.
 */
import * as THREE from "three";
import { bands, polyline, rng, STRUCTURE, PATH, FRAME } from "./lib.js";

/* Offsets from the station anchor; the caller adds it.
 *
 * The eye is at 0.83, and that is not a composition decision, it is the height
 * of one millisecond. The scale puts 1 ms at 0.8310 off the bed and the camera
 * looks along it dead level, so the 1 ms decade is a perfectly flat line
 * across the middle of the frame and every other decade converges on it. Two
 * of the five ruled planes are seen from above and two from below. There is no
 * cheaper way to say "you are standing inside the axis" than to put the reader
 * on one of its lines.
 *
 * 3.42 of standoff at 47 degrees, which is a metre closer and three degrees
 * wider than the shot this replaced. Both moves do the same job: they put the
 * frame edge inside the instrument instead of outside it. Solved against the
 * live projection, shear included, the side rails sit at NDC -0.972 and +1.012
 * level with the members -- on the two edges of the picture -- and are out of
 * shot by z = +0.09. The portal beams follow at +0.50 and the bed at +1.65.
 * That is the whole of what "inside" means here, and it is why the floor is
 * the only thing carrying the enclosure the last metre and a half.
 *
 * The instrument is 4.72 m across so that the outermost member of each
 * assembly clears the type at both window sizes the page stages. At 1440x900
 * the A* 128 Python member runs from -0.874 to -0.761 against an opaque
 * reading column starting at -0.842, and the DWA full C++ member from +0.800
 * to +0.914 against a column ending at +0.797 -- the whole of that one is in
 * the clear. At 1916x953 the two are -0.698 to -0.608 and +0.635 to +0.725,
 * against a column of -0.679 to +0.552. One measurement emerges into each
 * margin at both sizes and they are the right two: on the left the pair that
 * came out best, 163x on the smallest costmap, and on the right the one that
 * came out worst, 4x on the full velocity space. The section's whole argument
 * is those two, one either side of the reading.
 *
 * One thing the eye will notice and should not be corrected. The tallest cap
 * projects 35 pixels above the top edge of the panel behind it, although the
 * panel is 1.94 tall and the member only 1.83. It is nearer by 0.88, and that
 * is what standing inside something does to the things in front of you. Making
 * the panel tall enough to contain it in projection would take it to 2.14,
 * which is over the far gantry beam and would delete the depth behind.
 *
 * The lateral offset of 0.30 is kept and still earns its keep: square on, ten
 * members are ten rectangles and their depth is a claim nobody can check. It
 * is not a framing correction and has not been one since framing.js took that
 * over -- an offset in metres is an offset in NDC only after dividing by
 * tan(fov/2) * aspect, so a hand-tuned metre frames correctly at one aspect
 * and nowhere else. The key aims at the instrument. */
export const VIEW = { pos: [0.16, 0.83, 3.42], look: [0.16, 0.83, -0.88], fov: 47 };

/* The measurements, exactly as the Measured tables report them: A* on three
   costmaps, DWA on the two windows the controller actually evaluates. Both
   times per row, in milliseconds, because both times are what was measured.
   The labels travel with the numbers. */
const RUNS = [
  { bay: 0, label: "A* 128",    py:   7.5000, cpp: 0.0460 },
  { bay: 0, label: "A* 256",    py: 110.2600, cpp: 1.1150 },
  { bay: 0, label: "A* 384",    py: 884.2100, cpp: 4.5980 },
  { bay: 1, label: "DWA accel", py:   0.3037, cpp: 0.0098 },
  { bay: 1, label: "DWA full",  py:   4.2121, cpp: 1.0570 }
];

/* The instrument, in metres.
 *
 * Two assemblies on one bed: three cells of A* and two of DWA, with a gap
 * between them wide enough to stand a standard in. A cell is 0.74 and holds a
 * pair 0.29 apart, so a run is one object -- two members on one saddle --
 * rather than two bars that happen to be adjacent. The bed and the housing
 * reach 0.37 past the outermost member on each side, because a bench always
 * does, and the reference panels reach 0.26 past it, because a panel is
 * mounted in a frame rather than being the frame. */
const RUN_HALF = 2.24;                   // half the width the five runs occupy
const BAY_GAP = 0.40;                    // between the two assemblies
const CELL = (2 * RUN_HALF - BAY_GAP) / 5;   // 0.816
const BAR_W = 0.27, BAR_D = 0.28, PAIR = 0.16;
const SADDLE_H = 0.04, CAP_H = 0.05;

const HALF_W = 2.36;                     // bed, side rails, portal frames
const BACK_Z = -0.88, FRONT_Z = 0.72;    // the measuring section, front and back
const BED_Z = 2.20;                      // and how far forward the bed carries on
const MOUTH_Z = 3.90;                    // the rails' forward end, 0.48 past the eye
const WALL_H = 1.94;                     // the reference panels
const RAIL_Y = 2.10;                     // the portal beams overhead
const SIDE_Z = 1.40;                     // how far forward the side graticule runs
const LATTICE = 0.035;                   // node spacing of the plate lattices

/* Heights, and why the axis is what it is. 0.0098 ms and 884.21 ms do not
   share a linear axis anyone can read: on one, nine of the ten members are a
   smear along the bed and the only thing the picture says is that 384 was slow
   in Python. So it is logarithmic, its ends are the extremes of the data, and
   the foot of the scale is deliberately not the bed -- the fastest thing on
   the page still took 9.8 microseconds, and a member of zero height would say
   it took none. 4.955 decades over 1.68 m puts a decade at 0.3390. */
const MS = RUNS.flatMap(r => [r.py, r.cpp]);
const LO = Math.log10(Math.min(...MS)), HI = Math.log10(Math.max(...MS));
const FOOT = 0.15, RISE = 1.68;
function height(v) { return FOOT + (Math.log10(v) - LO) / (HI - LO) * RISE; }

/* Where the scale is ruled: every decade stop that falls inside the range, and
   there are five of them, which is what a five-decade instrument should look
   like. The two ends of the axis get no rule of their own and want none -- the
   extremes are marked by the members that set them, the C++ member of the
   accel-limited window sitting on the foot and the Python member of the 384
   costmap reaching the head. The 0.01 ms rule lands 3 mm above that foot,
   which is not a coincidence to be tidied away: the fastest measurement on the
   page is 0.0098 ms, and the instrument agreeing with the data to three
   millimetres is the instrument being right. */
const DECADES = [0.01, 0.1, 1, 10, 100];
const RULE = 0.028, RUNNER = 0.014;      // the cross rules, and the lines that recede
const TICK_OUT = 0.15;                   // how far a tick steps off a panel

/* The two reference panels, one behind each assembly, and the slot between
   them. Two panels rather than one wall, because the families are two
   experiments and the frame they share is the graticule, not the backing. The
   slot is also the only sightline in the instrument that reaches past its own
   back, which is what stops the depth stopping at a wall. */
const PANEL = [[-2.24, 0.21], [0.61, 2.24]];
const DIVX = -RUN_HALF + 3 * CELL + BAY_GAP / 2;   // 0.408, the standard between the bays

/* Where the graticule's longitudinal lines run: the two bed shoulders, outside
   the panels, and every cell boundary inside an assembly. A ruled plane needs
   lines going away from the reader as well as across, or it is four stripes on
   a wall; put on the boundaries between runs it also never crosses a member. */
const RUNNERS = [-2.30, -1.424, -0.608, 1.424, 2.30];

/* The portal frames threaded on the side rails. Only the first two are ever in
   shot: the beam at z = +0.10 crosses the top of the frame at NDC 0.880 and
   the one at +1.20 has gone over it at 1.316. The other two are there because
   a housing that stops where the frame stops is a flat, and because they are
   what the reader passes through on the way in. */
const PORTALS = [BACK_Z, 0.10, 1.20, 2.10];

/* Transverse ribs standing proud of the bed, forward of the measurement. They
   are the only structure that can be near the reader and still be in the
   picture, and that is a fact about the frame rather than a preference: a side
   rail 2.36 out is on the edge of the shot level with the members and gone by
   z = +0.09, and a portal beam 1.27 above the eye leaves the top of it at
   z = +0.50. Both are limited by how far off the camera axis they
   sit, and everything close to the reader is a long way off it. The bed is
   limited by neither: it does not leave the bottom of the frame until z =
   +1.65. So the floor is what carries the enclosure forward past the reader
   and the ribs are what give it a rhythm to converge along. Of the four, the
   first two are in shot at NDC -0.717 and -0.835 and the third has already
   gone under the bottom edge at -1.042. */
const RIBS = [0.95, 1.30, 1.72, 2.12];

/* A kerb down each side of the bed was tried here and taken out again, and it
   is worth saying why, because the reasoning that suggested it was sound and
   the measurement disagreed. The key sits well off the vertical, so an
   up-facing surface lands at 0.52 of the base against 0.12 for a side face on
   the left of the instrument -- which argues for putting more up-facing strip
   in the margins. But the bed is already up-facing, and it is read at 14
   degrees of grazing, so a riser 60 mm tall hides 246 mm of the bed behind it.
   The kerbs replaced bright floor with their own dark inner faces: measured
   over the clear strip left of the reading column, mean luminance went from
   14.9 out of 255 to 13.8 and the fraction above 40 nearly halved. The ribs
   stay because they buy a rhythm for the floor to converge along, and they are
   60 mm rather than 90 for exactly this reason. */

/* The gantry overhead and behind, and it exists for a geometric reason rather
   than an atmospheric one. A panel 4.3 m away fills its own silhouette, and
   nothing at the instrument's own height ever clears it from behind, because
   the further a thing is the lower in frame it sits: the panel's top edge
   lands at 0.594 in NDC and a beam at the same height 2.4 m further back
   lands under it. Only something taller clears it. 3.15 is the height at
   which the second and third cross-beams come out at 0.794 and 0.657, above
   the panels and below the top of the frame; the first has gone off the top by
   then, which is right, because a hall you are inside does not show you its
   own ceiling all the way to the wall. 3.40 across is wider than the
   instrument on purpose -- it is the room the bench stands in and not a lid on
   it -- and at 0.29 to 0.88 of the material's fog, what is behind the
   measurement resolves into more structure instead of into nothing. */
const GANTRY_Y = 3.15, GANTRY_HALF = 3.40;
const GANTRY_Z = [-1.90, -3.30, -4.70];

/* Surface pools. Fewer samples than the high tier draws, on purpose: the bars
   take 46% of the structure band, and that band is 49,600 points at 80k, so
   22,816 draws walk a 20,000-entry pool at a stride of 0.877 and an eighth of
   the entries are placed twice. The jitter is indexed by the draw rather than
   by the entry, so the two copies land 4 mm apart and the skin reads as a
   skin. A pool is a cap on how much surface has to be parameterised at boot,
   not a guarantee of distinctness.

   And the oversubscription costs less than it did. The splat is clamped at
   7 pixels and at this standoff every point in the instrument is against that
   clamp, so the arithmetic is fixed: a square metre of skin covers about
   120,000 pixels from this eye and a splat covers 38, which means the old
   rig's 5,260 points to the square metre painted it 1.7 times over. This
   spreads the same budget across three times as much surface -- 1,860 to the
   square metre, six tenths of a covering -- and six tenths is a skin with
   grain in it where 1.7 was a patch of solid light. */
const POOL_BAR = 20000, POOL_RIG = 12000, POOL_SKY = 2600;

/* ── quads ──────────────────────────────────────────────────────────── */

/* An axis-aligned box, as the faces you can actually see. Filling the volume
   spends most of the budget behind two faces nobody can see through, and the
   silhouette is the entire content of a member -- so each face is an origin
   and the two edges that span it, which makes the sample two multiply-adds per
   axis. `drop` is a mask over the six, one bit per face in the order
   +x -x +y -y +z -z: a member standing on the bed has no underside. */
const NO_DOWN = 1 << 3;
function quads() { return { f: [], a: [], total: 0 }; }
function box(q, cx, cy, cz, sx, sy, sz, drop) {
  const h = [sx / 2, sy / 2, sz / 2], c = [cx, cy, cz], s = [sx, sy, sz];
  for (let k = 0; k < 6; k++) {
    if (drop & (1 << k)) continue;
    const ax = k >> 1, sign = k & 1 ? -1 : 1;
    const u = (ax + 1) % 3, v = (ax + 2) % 3;
    const o = [c[0] - h[0], c[1] - h[1], c[2] - h[2]];
    o[ax] = c[ax] + sign * h[ax];
    const eu = [0, 0, 0], ev = [0, 0, 0];
    eu[u] = s[u]; ev[v] = s[v];
    q.f.push(o[0], o[1], o[2], eu[0], eu[1], eu[2], ev[0], ev[1], ev[2]);
    const area = s[u] * s[v];
    q.a.push(area); q.total += area;
  }
}

/* Area-weighted over the whole soup, so a 2 mm tick gets 2 mm worth of points
   and not the same share as a bed. The last face takes whatever rounding left
   over, so the pool is exactly full and the fill never reads past what was
   written. */
function surface(q, n, seed) {
  const out = new Float32Array(n * 3);
  if (q.total <= 0) return out;
  const r = rng(seed);
  for (let i = 0, k = 0, acc = 0; i < q.a.length; i++) {
    acc += q.a[i];
    const upto = i === q.a.length - 1 ? n : Math.round(n * acc / q.total);
    const o = i * 9;
    while (k < upto) {
      const u = r(), v = r();
      out[k * 3]     = q.f[o]     + q.f[o + 3] * u + q.f[o + 6] * v;
      out[k * 3 + 1] = q.f[o + 1] + q.f[o + 4] * u + q.f[o + 7] * v;
      out[k * 3 + 2] = q.f[o + 2] + q.f[o + 5] * u + q.f[o + 8] * v;
      k++;
    }
  }
  return out;
}

export function build(ctx) {
  const anchor = ctx.anchor;
  const r = rng(0x8ea51);
  const y0 = anchor.y;

  /* Where each run stands, and where the two members of it stand within that.
     A cell's index inside its own assembly plus the gap ahead of the second
     one; nothing here is spaced by eye. */
  const runs = RUNS.map((run, i) => {
    const cx = anchor.x - RUN_HALF + (i < 3 ? 0 : BAY_GAP) + (i + 0.5) * CELL;
    return { cx, xpy: cx - PAIR, xcpp: cx + PAIR,
             hpy: height(run.py), hcpp: height(run.cpp), bay: run.bay };
  });

  /* The ten members, their caps and the five saddles they are mounted on.
     A member is placed by its foot and not by its middle, which is the whole
     difference between a volume standing on a saddle and a rectangle lying
     across one, and the cap is a plate at the measured height: the cap is the
     reading, so it is the cap and not the top of the extrusion that lands on
     the number. */
  const barQ = quads();
  for (const b of runs) {
    box(barQ, b.cx, y0 + SADDLE_H / 2, anchor.z,
        2 * PAIR + BAR_W + 0.06, SADDLE_H, BAR_D + 0.08, NO_DOWN);
    for (const [x, h] of [[b.xpy, b.hpy], [b.xcpp, b.hcpp]]) {
      const top = h - CAP_H;
      box(barQ, x, y0 + (SADDLE_H + top) / 2, anchor.z,
          BAR_W, top - SADDLE_H, BAR_D, NO_DOWN);
      box(barQ, x, y0 + top + CAP_H / 2, anchor.z,
          BAR_W + 0.05, CAP_H, BAR_D + 0.05, NO_DOWN);
    }
  }
  const SKIN = surface(barQ, POOL_BAR, 0x11a7);

  /* The housing. Two side rails from behind the panels out past the eye, four
     portal frames threaded on them, two floor ties forward of the bed where
     there is no bed left to stand on, and the standard between the bays. This
     is the part the reader is inside: the rails are the only geometry on the
     station that reaches the edge of the frame, and everything about the shot
     being an enclosure rather than an object depends on them. */
  const rigQ = quads();
  const RAIL = 0.08, POST = 0.06, TIE = 0.06;
  for (const sx of [-1, 1]) {
    const x = anchor.x + sx * HALF_W;
    const z0 = anchor.z + BACK_Z - 0.10, z1 = anchor.z + MOUTH_Z;
    box(rigQ, x, y0 - RAIL / 2, (z0 + z1) / 2, RAIL, RAIL, z1 - z0, 0);
    box(rigQ, x, y0 + RAIL_Y, (z0 + z1) / 2, RAIL, RAIL, z1 - z0, 0);
    for (const pz of PORTALS)
      box(rigQ, x, y0 + RAIL_Y / 2, anchor.z + pz, POST, RAIL_Y, POST, 0);
  }
  for (const pz of PORTALS)
    box(rigQ, anchor.x, y0 + RAIL_Y, anchor.z + pz, 2 * HALF_W, POST, POST, 0);
  for (const rz of RIBS)
    box(rigQ, anchor.x, y0 + TIE / 2, anchor.z + rz, 2 * HALF_W, TIE, TIE, NO_DOWN);
  box(rigQ, anchor.x + DIVX, y0 + RAIL_Y / 2, anchor.z + BACK_Z + 0.10,
      POST + 0.02, RAIL_Y, POST + 0.02, 0);
  const RIG = surface(rigQ, POOL_RIG, 0x2c05);

  /* The hall the instrument stands in. Two stringers and three cross-beams,
     high enough to clear the panels and far enough back to be most of the way
     into the fog. Nothing about it is measured and nothing about it pretends
     to be: it is the one part of this station that is scenery, and it is here
     because a bench in a void has no scale. */
  const skyQ = quads();
  for (const sx of [-1, 1])
    box(skyQ, anchor.x + sx * GANTRY_HALF, y0 + GANTRY_Y,
        anchor.z + (GANTRY_Z[0] + GANTRY_Z[2]) / 2, 0.07, 0.07,
        GANTRY_Z[0] - GANTRY_Z[2] + 0.4, 0);
  for (const gz of GANTRY_Z)
    box(skyQ, anchor.x, y0 + GANTRY_Y, anchor.z + gz,
        2 * GANTRY_HALF + 0.5, 0.07, 0.07, 0);
  const SKY = surface(skyQ, POOL_SKY, 0x63b1);

  /* The bed and the two panels, as lattices rather than as sampled faces.
     A plate is a plane and a plane of nodes reads as one; more to the point,
     both lattices thin outward from the measurement, so the instrument has an
     edge that fades rather than a border that stops -- the same reason the
     manipulator's floor thins. The falloff is measured from the middle of the
     bed, not from a corner, because the middle of the bed is where the runs
     are. */
  const plate = [];
  const NX = Math.round(2 * HALF_W / LATTICE), NZ = Math.round((BED_Z - BACK_Z) / LATTICE);
  const zc = (BACK_Z + BED_Z) / 2, zh = (BED_Z - BACK_Z) / 2;
  for (let ix = 0; ix <= NX; ix++) {
    const x = -HALF_W + (ix / NX) * 2 * HALF_W;
    for (let iz = 0; iz <= NZ; iz++) {
      const z = BACK_Z + (iz / NZ) * (BED_Z - BACK_Z);
      const d = Math.max(Math.abs(x) / HALF_W, Math.abs(z - zc) / zh);
      if (r() > 1 - d * d * 0.72) continue;
      plate.push(anchor.x + x, y0, anchor.z + z);
    }
  }
  const NY = Math.round(WALL_H / LATTICE);
  for (const [pa, pb] of PANEL) {
    const pw = pb - pa, pc = (pa + pb) / 2, ph = pw / 2;
    const PX = Math.max(2, Math.round(pw / LATTICE));
    for (let ix = 0; ix <= PX; ix++) {
      const x = pa + (ix / PX) * pw;
      for (let iy = 0; iy <= NY; iy++) {
        const y = (iy / NY) * WALL_H;
        const d = Math.max(Math.abs(x - pc) / ph, y / WALL_H);
        if (r() > 1 - d * d * 0.80) continue;
        plate.push(anchor.x + x, y0 + y, anchor.z + BACK_Z);
      }
    }
  }
  const PL = Float32Array.from(plate), NPL = PL.length / 3;

  /* The two envelopes, per assembly. Across a cap at its own height, on to the
     midpoint of the gap, then straight up or down to the next -- a step
     function, because that is what separate measurements are. Each runs on
     past both end members of its own bay so the stroke enters and leaves the
     assembly rather than starting in mid-air, and it sits 0.035 proud of the
     front faces so it reads as drawn on the instrument instead of buried in
     it. */
  const PZ = anchor.z + BAR_D / 2 + 0.035, LEAD = 0.22, HALFCAP = BAR_W / 2 + 0.02;
  function envelope(idx, key) {
    const xs = idx.map(i => runs[i][key === "py" ? "xpy" : "xcpp"]);
    const ys = idx.map(i => y0 + runs[i][key === "py" ? "hpy" : "hcpp"]);
    const p = [new THREE.Vector3(xs[0] - HALFCAP - LEAD, ys[0], PZ)];
    for (let i = 1; i < xs.length; i++) {
      const mid = ((xs[i - 1] + HALFCAP) + (xs[i] - HALFCAP)) / 2;
      p.push(new THREE.Vector3(mid, ys[i - 1], PZ));
      p.push(new THREE.Vector3(mid, ys[i], PZ));
    }
    p.push(new THREE.Vector3(xs[xs.length - 1] + HALFCAP + LEAD, ys[ys.length - 1], PZ));
    return p;
  }
  const BAY = [[0, 1, 2], [3, 4]];
  const cppEnv = BAY.map(b => envelope(b, "cpp"));
  const pyEnv = BAY.map(b => envelope(b, "py"));

  /* Each decade, as a plane rather than as a line: the cross rule over both
     panels and the slot between them, five lines receding from the panels to
     the front edge of the bed, and a tick stepping off each of the four panel
     edges. Four ticks and not two, because the two assemblies each have two
     ends and the scale belongs to both -- lines that stop at the edge of a
     panel are a texture, lines with an origin at every edge are a scale. */
  const rules = [];
  for (const v of DECADES) {
    const y = y0 + height(v);
    /* And the same decade carried down both sides of the housing, level with
       the reader, which is the one part of the graticule that is not on a
       panel at all. It is what makes this a scale the camera is standing
       inside rather than a scale it is looking at: four of the five decades
       run past the eye on the left and the right, the 0.1 ms line seen from
       above and the 10 and 100 ms lines from underneath, all four converging
       on the 1 ms line the eye is sitting on. The bottom decade is left off --
       at 0.153 it is inside the bed's own edge rail. */
    if (v > 0.01) for (const sx of [-1, 1])
      rules.push([new THREE.Vector3(anchor.x + sx * HALF_W, y, anchor.z + BACK_Z - 0.10),
                  new THREE.Vector3(anchor.x + sx * HALF_W, y, anchor.z + SIDE_Z)]);
    rules.push([new THREE.Vector3(anchor.x + PANEL[0][0], y, anchor.z + BACK_Z),
                new THREE.Vector3(anchor.x + PANEL[1][1], y, anchor.z + BACK_Z)]);
    for (const rx of RUNNERS)
      rules.push([new THREE.Vector3(anchor.x + rx, y, anchor.z + BACK_Z + RULE),
                  new THREE.Vector3(anchor.x + rx, y, anchor.z + FRONT_Z)]);
    for (const [pa, pb] of PANEL) for (const px of [pa, pb])
      rules.push([new THREE.Vector3(anchor.x + px, y, anchor.z + BACK_Z),
                  new THREE.Vector3(anchor.x + px, y, anchor.z + BACK_Z + TICK_OUT)]);
  }

  /* The corner the whole instrument is measured from: the outer edge of the
     first panel, on the bed, against it. Unrotated, because for once the world
     axes are the right ones -- X runs along the ten members, Y is the scale
     itself, Z comes off the panels towards the reader. */
  const org = new THREE.Vector3(anchor.x + PANEL[0][0], y0, anchor.z + BACK_Z);

  /* How far across the reading a piece of the instrument stands: 0 at the left
     end of the bed, 1 at the right. The axis is the reading, so the one honest
     parameter for a lump of matter here is where along it that lump is, and
     the band then crosses bed, members, rules and both envelopes together
     instead of a stroke travelling over an instrument that is standing still
     underneath it.

     Taken off the scattered position rather than the lattice node it came
     from, and then clamped, which is not defensive: the bed is jittered by up
     to 11 mm and that is 0.0023 of the 4.84 it spans, so a node on the left
     edge comes out at -0.0023. The substrate reads anything below zero as a
     point that does not run at all rather than as a point at the start of the
     run, so without the clamp the near edge of the bed would be the one part
     of the instrument that stays dead. */
  const X0 = anchor.x - HALF_W, XW = 2 * HALF_W;
  const across = x => Math.min(1, Math.max(0, (x - X0) / XW));

  /* One stroke, segment by segment, each segment carrying the x it spans
     rather than its own arc length. lib's polyline takes a pair for exactly
     this, and the pair is what makes several separate strokes one thing that
     is read in a single pass: a cap gets a ramp across its own width, a riser
     gets a constant, so the step between two runs lights whole as the head
     reaches it. Points are handed out by length so a long lead is not drawn as
     densely as a short cap. */
  function stroke(pts, n, w, kind, sz, jit, seed) {
    let total = 0;
    const seg = [];
    for (let i = 1; i < pts.length; i++) {
      const d = pts[i].distanceTo(pts[i - 1]);
      seg.push(d); total += d;
    }
    if (total <= 0) return;
    for (let i = 1; i < pts.length; i++) {
      const share = Math.floor(n * seg[i - 1] / total);
      if (share < 1) continue;
      polyline([pts[i - 1], pts[i]], share, w, kind, sz, jit, seed + i * 31,
               [across(pts[i - 1].x), across(pts[i].x)]);
    }
  }

  /* 1 rather than 0, which is the same instant on a wrapped lap and the reason
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

  /* Walks a pool at whatever stride the tier's budget implies, jittering by
     the draw so a doubly-placed entry lands somewhere else. */
  function scatter(src, w, n, sz, amp, salt) {
    const per = (src.length / 3) / Math.max(1, n);
    for (let k = 0; k < n; k++) {
      const o = ((k * per) | 0) * 3, j = (k * 3 + salt) & JM;
      const x = src[o] + jit[j] * amp;
      w.put(x, src[o + 1] + jit[j + 1] * amp, src[o + 2] + jit[j + 2] * amp,
            STRUCTURE, sz, across(x));
    }
  }

  return function fill(pos, kind, size, count, flow) {
    const { S, P, F } = bands(pos, kind, size, count, flow);

    scatter(SKIN, S, S.share(0.46), 1.0, 0.004, 0);
    // Fainter than the members and jittered wider, so a node reads as a soft
    // dot: the housing is what the numbers are mounted in, not one of them,
    // and an instrument drawn as crisply as its own measurements competes with
    // them.
    scatter(RIG, S, S.share(0.50), 0.72, 0.009, 1289);
    scatter(PL, S, S.share(0.62), 0.50, 0.011, 2411);
    /* The hall does not run. It is the only matter on this station that is not
       part of the reading, and a point with no flow is exactly how the
       substrate is told so -- lit by nothing, moved by nothing, present. */
    {
      const n = S.share(0.55), per = (SKY.length / 3) / Math.max(1, n);
      for (let k = 0; k < n; k++) {
        const o = ((k * per) | 0) * 3, j = (k * 3 + 733) & JM;
        S.put(SKY[o] + jit[j] * 0.010, SKY[o + 1] + jit[j + 1] * 0.010,
              SKY[o + 2] + jit[j + 2] * 0.010, STRUCTURE, 0.42);
      }
    }
    S.pad(0.02);

    /* The C++ reading. Two strokes, one per assembly, sharing the band's
       budget by length so the three-run bay is not drawn thinner than the
       two-run one. The accent is the C++ swatch on the page and this is the
       C++ line; nothing about that correspondence is decorative.

       0.75 rather than the 1.6 a single profile used to be drawn at, and the
       reason is the splat clamp rather than taste. gl_PointSize is capped at
       seven pixels and at this standoff a size of 0.92 already reaches it, so
       anything above that buys no width -- only more points landing inside the
       same seven pixels of additive blending. Cutting the *share* does not
       help either, and that is the part worth writing down: whatever a band
       does not spend, pad scatters back over what it did, so the accent puts
       its twenty thousand points on this stroke however few of them are asked
       for. Size is the only lever there is. At 1.6 the two envelopes came out
       as a pair of glowing tubes over the numbers they were reporting -- read
       off a frame with the reading column's backing removed, the accent
       crossed the 128-costmap cap at 212 of 255. At 0.75 it is 5.7 pixels of
       line, and in the frame a reader actually gets it peaks at 193 in the
       clear right-hand margin with 0.9% of that strip above 140. */
    {
      const n = P.share(0.90), len = cppEnv.map(e => arc(e));
      const tot = len[0] + len[1];
      for (let i = 0; i < cppEnv.length; i++)
        stroke(cppEnv[i], Math.floor(n * len[i] / tot), P, PATH, 0.75, 0.008, 0x2b4d + i * 97);
    }
    P.pad(0.014);

    /* The scale, and the Python reading, which share the frame band because
       they are the same colour on the page and the same kind of thing in the
       world: the teal is what a measurement is read *against*. Fifty-eight
       strokes of it: five decades of cross rule, runner and tick on the
       panels, and the four upper decades carried down both sides of the
       housing past the reader.

       The two envelopes cannot be drawn at the same weight and it is worth
       being honest about why. The accent has 26% of the buffer to itself and
       the teal has 12% shared with fifty strokes of graticule, so the C++ line
       comes out about 2.3 times the coverage of the Python one however the
       shares are set. That is left rather than fought: the accent is the
       journey's through-line -- it arrives here as a planned route and leaves
       as a driven one -- and the C++ line is the one this section is about.
       The Python line is what it is measured against, and being the quieter of
       the two is what that means. */
    {
      const n = F.share(0.52), len = pyEnv.map(e => arc(e));
      const tot = len[0] + len[1];
      for (let i = 0; i < pyEnv.length; i++)
        stroke(pyEnv[i], Math.floor(n * len[i] / tot), F, FRAME, 1.0, 0.007, 0x5e21 + i * 97);
    }
    {
      /* Each rule on the x it spans, so the graticule is swept left to right
         with the members rather than across them: the scale and the thing it
         measures are one instrument and they are read in one pass. A runner
         and a tick stand at one x, so both light whole. */
      const n = F.share(0.86), total = rules.reduce((a, p) => a + arc(p), 0);
      for (let i = 0; i < rules.length; i++) {
        const share = Math.floor(n * arc(rules[i]) / total);
        if (share > 0) stroke(rules[i], share, F, FRAME, 0.8, 0.004, 0x3100 + i * 7);
      }
    }
    corner(F.share(0.50), F, 0.34, 1.15);
    F.pad(0.01);
  };
}

/* The length of a polyline, which the two allocators above both need and
   neither should be measuring by hand. */
function arc(p) {
  let d = 0;
  for (let i = 1; i < p.length; i++) d += p[i].distanceTo(p[i - 1]);
  return d;
}
