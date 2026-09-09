/* Formation 05 -- the origin, and a room that has finished.
 *
 * Everything above this was measured against something. This is the thing
 * they were measured against: one coordinate frame, at full size, standing
 * where the page stops.
 *
 * It is the only formation that ends with less than it started with, and that
 * is the job rather than a shortfall. The contact details are the last thing
 * anyone reads and the world's remaining duty is to stop competing with them,
 * so the structure band -- most of the cloud -- is sent out to a horizon seven
 * to thirteen metres away at half the size of ordinary matter, and what is
 * left standing in the middle of the room is the frame, the floor's set-out,
 * and the route that arrives at it and stops.
 *
 * The horizon is the arc the camera is actually facing rather than a full
 * ring. A ring puts four fifths of the band behind the reader's head, which
 * costs the whole page's budget to render nothing; drawn as an arc whose ends
 * run off both edges of the frame it reads as a ring anyway, because that is
 * all you would ever see of one.
 *
 * That last clause stopped being true and nobody could see it, which is the
 * dangerous kind. It used to hold because world/framing.js sheared the
 * projection 0.286 to the right at this width, which took the arc's right end
 * to 1.05 in NDC and its left end to -0.48, behind the opaque part of the
 * panel. The reading column is centred now and the shear is area-weighted, so
 * it measures 0.052 on the same window -- and at 0.62 of sweep the arc's
 * inner rim ended at +0.82 and -0.72, both of them comfortably inside the
 * picture. A horizon that stops inside the frame is a disc and reads as one.
 * Solved again against the frame rather than against the old number, SWEEP
 * has to be 0.802 at 1916x953, 0.639 at 1440x900 and 0.728 at 2560x1440, so
 * 0.82 covers the three shapes a desktop reader is likely to have. It does
 * not cover 3440x1440, which wants 0.912; that is a fifth more arc again for
 * an aspect almost nobody reads this at, and the trade goes the other way.
 * See SWEEP for what the 0.82 already costs.
 *
 * What the band stands on is world/solids/contact.js, and that file has grown
 * a set-out since: the two floor axes scribed the width of the room, a circle
 * at the arm's own length, and two ranges -- 6.2 metres back to Path, 12.8
 * back to Measured and Stack -- marked with blocks. The cloud carries the
 * scribes and the two circles, because a station is supposed to be the same
 * room whether it is solid or dust, and it does not carry the marks: the far
 * range stands at 12.8 and this formation's haze already runs from 7 to 13,
 * so out there the cloud is the room's edge rather than something standing on
 * it.
 */
import * as THREE from "three";
import { bands, triad, polyline, rng, STRUCTURE, PATH, FRAME } from "./lib.js";

/* Offsets from the station anchor; the caller adds it. 34 degrees, where the
   hero station is 42 and the corridor 47: the page ends on a longer lens than
   it travelled on, because a long lens flattens what is left and stops the
   last screen feeling like it is still going somewhere. Symmetric on X --
   this is the one station with nothing to stand out of the way of, and a
   frame that is symmetric deserves to be photographed as one. The eye at 0.60
   and the target at 0.40 split the difference between the origin and the top
   of the vertical arm, so the triad sits centred rather than hanging off the
   bottom; 2.90 is as close as 1.1 metres of arm will stand before the tail of
   the trajectory leaves the bottom of the frame. The horizon overruns both
   edges on purpose, which is why this station frames at 96% where the others
   make 100: a horizon that stops inside the frame is a disc, and reads as
   one. At 1916x953 and the sweep below the band's inner rim reaches -1.03 and
   +1.13 in NDC and its outer rim -1.26 and +1.37, so all four ends are past
   the glass -- the asymmetry is the 0.052 of shear world/framing.js still
   spends on a centred reading column, and it is small enough to leave alone
   rather than aim off for. */
export const VIEW = { pos: [0.0, 0.60, 2.90], look: [0.0, 0.40, -0.35], fov: 34 };

/* The frame. Long arms, because for once it is not punctuation on something
   else -- every other formation's triads are 0.11 to 0.28 and sit on a joint
   or a corner. Yawed three-eighths of a turn so both floor arms lie at 45
   degrees to the view: square on, one of them points down the barrel of the
   lens and reads as a dot. */
const ARM = 1.10, YAW = Math.PI * 0.75;

/* The horizon: how far out it stands, the half-angle it is drawn through, and
   how high it banks off the floor. Nothing at all between the frame and seven
   metres except the set-out lying on the ground: the emptiness is most of the
   composition and the marks in it are flat.

   The sweep runs wider than the lens holds -- the visible half-angle narrows
   as the radius grows, so the far rim is what spills first, and letting it
   spill is the difference between a horizon and a disc lying on the floor
   with an edge you can see. 0.82, and it was 0.62, which was solved against a
   projection shear of 0.286 that world/framing.js no longer produces. The
   header has the three window shapes it was re-solved against.

   Widening is not free and the bill is worth writing down: the arc is 32%
   longer and the band has also given 18% of itself to the set-out, so the
   horizon is left at 62% of the density it had. That cannot be measured off a
   settled render, and it is honest to say so -- over a solid the substrate
   sits at 0.07 of fade and the haze is already under the atmosphere at that
   point; sampled across the frame at rows 395 to 428 the profile is a smooth
   vignette curve with no sign of either end of the arc in it. The number is
   argued from the geometry, which is what it was always argued from, and it
   is spent in the crossing, where the cloud comes up to six times the settled
   haze and is the only thing there is to look at.

   The bank is what makes the band a horizon rather than a rule drawn across
   the middle of the picture. It used to be 0.10 of thickness centred on the
   anchor, which at ten metres out is sixteen rows of a 953-row frame: too
   thin to be weather and too even to be anything else, and half of it is now
   under the solid floor and depth-rejected in any case.

   0.18, and it was 0.34 first, which is the useful half of that. Twelve
   thousand points are a fixed amount of light and a band is as bright as the
   light divided by the area it covers: at 0.34 the same points spread over
   fifty-three rows at ten metres and the haze measured 7 of 255 where the
   0.10 slab it replaced had measured 12. Higher is not more, it is thinner.
   0.18 covers twenty-eight rows, which is wide enough to be weather and
   narrow enough to still be a line. Squared, because r*r puts three quarters
   of the band in its lower half: a horizon is dense where it sits and thin
   where it lifts, and a uniform column would read as a wall. */
const R0 = 7.0, R1 = 13.0, SWEEP = 0.82, BANK = 0.18;
const HORIZON = 12000;

/* The floor's own height, how far over it the cloud's set-out lies, and the
   one circle on it that is not already a number in this file. All copied from
   world/solids/contact.js the way ARM and YAW are copied the other way: the
   solid publishes a group and an update and nothing else, and a formation
   that guessed at any of these would be drawing a second room in the same
   place. -0.028 is the shaft's root radius, which is the one height at which
   the arms are tangent to the ground; 6.2 is the distance back to Path's
   anchor, which world/config.js puts at z = -19.8 against this station's
   -26.0. The other circle is ARM, and the scribes run from the knot out to
   R1, which is this file's own horizon and where the solid's disc ends.

   Six millimetres over the surface, against the solid's three: the cloud lies
   on its own marks rather than in them. Points are depth-tested against the
   floor -- that is what keeps the bottom of the haze bank an edge -- and a
   sprite whose centre is level with a face it is meant to be sitting on is
   half swallowed by it. */
const FLOOR = -0.028, LIFT = 0.006, RANGE = 6.2;

/* What is left of the route, and it is the whole of the last leg now.
 *
 * It was 1.20 metres, which put its oldest end in mid-air at row 877 of a
 * 953-row frame: a strand that begins 1.8 metres in front of the reader,
 * eight centimetres above the floor, for no reason anybody could give. 6.20
 * is the distance from Path's anchor to this one, so the track now runs from
 * the station you were reading a minute ago to the origin and stops, and it
 * leaves the bottom of the frame 1.44 metres out rather than starting inside
 * it.
 *
 * Sampled cubed rather than evenly, because five times the length out of a
 * fixed band is a fifth of the density, and the visible metre and a half is
 * the part that matters. At (1-u)^3 the samples bunch toward the arrival:
 * 61.5% of them fall inside the 1.44 metres the frame holds, which comes to
 * 51% of the density the 1.20 stub had there -- the cost of the extra five
 * metres, paid where it cannot be seen. It thins as it arrives, and the taper
 * is the ending: putting the taper at the far end instead would read as
 * something approaching. */
const STUB = 6.20, TRAIL = 512, TRAIL_BIAS = 3;

export function build(ctx) {
  const anchor = ctx.anchor;
  const r = rng(0xc047ac);

  /* Uniform in radius rather than in area. Area-weighted puts most of the
     points on the outer rim, which then compresses into a bright line at the
     far edge under perspective -- the opposite of a horizon receding. Spread
     evenly in radius, the on-screen density comes out roughly flat. */
  const ring = new Float32Array(HORIZON * 3);
  for (let i = 0; i < HORIZON; i++) {
    const rad = R0 + (R1 - R0) * r();
    const th = (r() * 2 - 1) * SWEEP;
    const up = r();
    ring[i * 3]     = anchor.x + rad * Math.sin(th);
    ring[i * 3 + 1] = anchor.y + BANK * up * up;
    ring[i * 3 + 2] = anchor.z - rad * Math.cos(th);
  }

  /* The set-out, as six curves on the floor. Four scribes out of the knot
     along the two floor axes -- the axes both ways, because a line ruled in a
     floor is a line and only the shaft on it says which end is positive --
     and the two circles. They are built as polylines and sampled by arc
     length at fill time, so the points are as dense on the seven metres of
     the ARM circle as on the thirteen of a scribe. */
  const ax = [[Math.cos(YAW), -Math.sin(YAW)], [Math.sin(YAW), Math.cos(YAW)]];
  const on = (x, z) => new THREE.Vector3(anchor.x + x, anchor.y + FLOOR + LIFT,
                                         anchor.z + z);
  const net = [];
  for (const d of ax) for (const s of [1, -1])
    net.push([on(d[0] * s * 0.055, d[1] * s * 0.055), on(d[0] * s * R1, d[1] * s * R1)]);
  for (const rad of [ARM, RANGE]) {
    const c = [];
    for (let i = 0; i <= 96; i++) {
      const t = (i / 96) * Math.PI * 2;
      c.push(on(rad * Math.cos(t), rad * Math.sin(t)));
    }
    net.push(c);
  }
  const netLen = net.map(c => {
    let L = 0;
    for (let i = 1; i < c.length; i++) L += c[i].distanceTo(c[i - 1]);
    return L;
  });
  const netTotal = netLen.reduce((a, b) => a + b, 0);

  /* The centreline of the stub, with the width of the band around it. Wide
     where the route is old and tight where it has just arrived, which is the
     honest shape of a pose estimate looked at backwards: the further back
     along your own track you look, the less sure you are you were there. The
     lateral drift falls to nothing at the origin so the route lands on the
     frame rather than near it.

     `a` is how far back along the track a sample sits, 0 at the arrival and 1
     at the oldest end, and everything about the point is a function of it --
     including the flow, which is 1 - a rather than the sample index. Those
     were the same number while the sampling was even and they are not any
     more: mapped off the index the travelling band would sprint through the
     old track and crawl the last metre, which is a band that changes speed
     for reasons to do with the buffer rather than with the route. */
  const trail = new Float32Array(TRAIL * 6);
  for (let i = 0; i < TRAIL; i++) {
    const u = i / (TRAIL - 1);
    const a = Math.pow(1 - u, TRAIL_BIAS);
    const s = a * STUB;                  // metres still to run
    trail[i * 6]     = anchor.x + 0.13 * Math.sin(s * 2.4);
    trail[i * 6 + 1] = anchor.y + 0.05 * a;
    trail[i * 6 + 2] = anchor.z + s;
    trail[i * 6 + 3] = 0.55 + 0.95 * a;              // size
    trail[i * 6 + 4] = 0.004 + 0.055 * Math.pow(a, 0.8); // half-width
    trail[i * 6 + 5] = 1 - a;                        // flow, in arc length
  }

  /* The frame's own pose, built once. axisTriad would compose the same
     matrix on every crossing; there is exactly one frame here and it never
     moves, so it is composed at boot and fill only reads it. */
  const frame = new THREE.Matrix4().makeRotationY(YAW);
  frame.setPosition(anchor.x, anchor.y, anchor.z);

  const JN = 4096, JM = JN - 1;
  const jit = new Float32Array(JN + 2);
  for (let i = 0; i < JN; i++) jit[i] = r() * 2 - 1;
  jit[JN] = jit[0]; jit[JN + 1] = jit[1];

  return function fill(pos, kind, size, count, flow) {
    const { S, P, F } = bands(pos, kind, size, count, flow);

    /* The set-out first, at 0.18 of the structure band. Ninety-eight metres
       of line at that share is ninety-one points to the metre, eleven
       millimetres apart in the world, and what that comes to on screen is
       worth knowing before anybody spends more of the band on it: two pixels
       along the whole of the 6.2 circle, a quarter of a pixel where a scribe
       runs out to the far range, and 10.5 where the same scribe leaves the
       frame through a bottom corner. Sampling by arc length is the wrong
       distribution for a line read almost end-on -- it is oversampled to the
       point of waste at the far end and just short of dotted at the near one
       -- and it is the distribution this can afford. The alternative is a
       per-point screen-space density, which bakes this station's camera into
       its own geometry, and that is a worse thing to own than a slightly
       coarse bottom corner.

       Structure and not frame, which is the same call the solid makes: its
       set-out is cut from the floor's material and not the monument's,
       because a mark on a floor is a paler patch of floor. The teal is for
       the thing standing at the origin. */
    const nNet = S.share(0.18);
    for (let i = 0; i < net.length; i++) {
      const n = Math.round(nNet * netLen[i] / netTotal);
      if (n > 0) polyline(net[i], n, S, STRUCTURE, 0.45, 0.012, 0xc047b0 + i);
    }

    /* Everything else is the horizon, and it is all placed rather than half
       placed and half scattered back over itself.

       Padding was the right tool while the horizon was the only thing in this
       band. It is not now, and the reason it never quite was is worth
       recording: writer.pad is isotropic, so 0.18 of scatter spent half of
       itself vertically -- fourteen rows of a 953-row frame in each direction
       -- across a bank only 0.18 high whose bottom edge, where the haze meets
       the ground, is the one hard edge a horizon has. The previous note here
       argued 0.18 down from 0.35 on exactly that ground and then kept
       spending it. Asking the ring for the whole band instead costs nothing:
       HORIZON is 12000 positions and what is left of the band is three and a
       half times that, so the loop walks each position several times and
       jitters it differently every time, which is the same thickening by a
       different route -- except that it is the horizon's own jitter, 0.09
       across and 0.03 up, so the bank keeps its edge. And it would have
       thrown a 180 mm haze around a line drawn 12 mm wide, which is the
       immediate reason it had to go.

       The 0.03 of vertical jitter stays: the few points it takes under -0.028
       are rejected by the floor's own depth, which is exactly what a bank of
       haze sitting on a surface should do.

       What the horizon is left with is 82% of the band over an arc 32%
       longer, so 62% of the density it had. That buys the set-out and an arc
       that runs off both edges of the frame again. */
    const nRing = S.room, perRing = HORIZON / Math.max(1, nRing);
    for (let k = 0; k < nRing; k++) {
      const o = ((k * perRing) | 0) * 3, j = (k * 3) & JM;
      S.put(ring[o]     + jit[j]     * 0.09,
            ring[o + 1] + jit[j + 1] * 0.03,
            ring[o + 2] + jit[j + 2] * 0.09, STRUCTURE, 0.5);
    }
    // Nothing is left by now and that is the point; the call stays because a
    // band that is not filled to the last index is a clot at the world origin.
    S.pad(0.18);

    /* The stub runs, and only the stub. Everything else at this station is
       deliberately still -- the frame does not turn, the set-out does not
       drift and the horizon does not move, because the last thing anybody
       reads here is an email address and the world's remaining duty is to
       stop competing with it. But the accent arriving from the corridor has
       been a swept trajectory, a planned route, a benchmark profile and a
       driven corridor at the four stations before this one, and in every one
       of them it is something being travelled. If it stopped travelling on
       arrival it would not read as the same strand coming to rest, it would
       read as a different strand that happens to be the same colour. So it
       keeps its parameter and the band runs out along it to the origin and
       ends. */
    const nTr = P.room, perTr = TRAIL / Math.max(1, nTr);
    for (let k = 0; k < nTr; k++) {
      const o = ((k * perTr) | 0) * 6, j = (k * 3) & JM;
      const w = trail[o + 4];
      P.put(trail[o]     + jit[j]     * w,
            trail[o + 1] + jit[j + 1] * w * 0.55,
            trail[o + 2] + jit[j + 2] * w, PATH, trail[o + 3], trail[o + 5]);
    }
    P.pad(0.02);

    /* The hero of the formation, and the densest frame on the page: a twelfth
       of the cloud on three arms and the knot where they meet, when every
       other station spreads the same twelfth over half a dozen small ones. */
    triad(frame, F.share(0.80), F, ARM, 1.5);
    const nOrg = F.share(0.62);
    for (let k = 0; k < nOrg; k++) {
      const j = (k * 3 + 613) & JM;
      F.put(anchor.x + jit[j]     * 0.055,
            anchor.y + jit[j + 1] * 0.055,
            anchor.z + jit[j + 2] * 0.055, FRAME, 1.7);
    }
    F.pad(0.008);
  };
}
