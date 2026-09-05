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
 * left standing in the middle of the room is the frame, and the route that
 * arrives at it and stops.
 *
 * The horizon is the arc the camera is actually facing rather than a full
 * ring. A ring puts four fifths of the band behind the reader's head, which
 * costs the whole page's budget to render nothing; drawn as an arc whose ends
 * run off both edges of the frame it reads as a ring anyway, because that is
 * all you would ever see of one.
 */
import * as THREE from "three";
import { bands, triad, rng, STRUCTURE, PATH, FRAME } from "./lib.js";

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
   edges by about a sixth on purpose, which is why this station frames at 96%
   where the others make 100: a horizon that stops inside the frame is a disc,
   and reads as one. */
export const VIEW = { pos: [0.0, 0.60, 2.90], look: [0.0, 0.40, -0.35], fov: 34 };

/* The frame. Long arms, because for once it is not punctuation on something
   else -- every other formation's triads are 0.11 to 0.28 and sit on a joint
   or a corner. Yawed three-eighths of a turn so both floor arms lie at 45
   degrees to the view: square on, one of them points down the barrel of the
   lens and reads as a dot. */
const ARM = 1.10, YAW = Math.PI * 0.75;

/* The horizon, in metres from the anchor, and the half-angle it is drawn
   through. Nothing at all between the frame and seven metres: the emptiness
   is the composition. The sweep runs a little wider than the lens holds --
   the visible half-angle narrows as the radius grows, so the far rim is what
   spills first, and letting it spill is the difference between a horizon and
   a disc lying on the floor with an edge you can see. */
const R0 = 7.0, R1 = 13.0, SWEEP = 0.62;
const HORIZON = 12000;

/* What is left of the route. Short, and it stops: the strand that has been a
   swept trajectory, a planned route, a benchmark profile and a driven
   corridor arrives at the origin and does not continue. It thins as it
   arrives -- the taper is the ending, and putting the taper at the far end
   instead would read as something approaching. */
const STUB = 1.20, TRAIL = 512;

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
    ring[i * 3]     = anchor.x + rad * Math.sin(th);
    ring[i * 3 + 1] = anchor.y + (r() - 0.5) * 0.10;
    ring[i * 3 + 2] = anchor.z - rad * Math.cos(th);
  }

  /* The centreline of the stub, with the width of the band around it. Wide
     where the route is old and tight where it has just arrived, which is the
     honest shape of a pose estimate looked at backwards: the further back
     along your own track you look, the less sure you are you were there. The
     lateral drift falls to nothing at the origin so the route lands on the
     frame rather than near it. */
  const trail = new Float32Array(TRAIL * 5);
  for (let i = 0; i < TRAIL; i++) {
    const u = i / (TRAIL - 1);           // 0 where it is oldest, 1 where it stops
    const s = (1 - u) * STUB;            // metres still to run
    trail[i * 5]     = anchor.x + 0.13 * Math.sin(s * 2.4);
    trail[i * 5 + 1] = anchor.y + 0.05 * (1 - u);
    trail[i * 5 + 2] = anchor.z + s;
    trail[i * 5 + 3] = 0.55 + 0.95 * (1 - u);              // size
    trail[i * 5 + 4] = 0.004 + 0.055 * Math.pow(1 - u, 0.8); // half-width
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

  return function fill(pos, kind, size, count) {
    const { S, P, F } = bands(pos, kind, size, count);

    /* Half the band placed and the other half left to pad. Scattering the
       remainder over what is already there keeps the horizon a horizon: a
       second feature out here would be one more thing to look at instead of
       the type this section is actually for, and a third of a metre of
       scatter at ten metres out is under two degrees, so it thickens the haze
       without giving it a shape. */
    const nRing = S.share(0.5), perRing = HORIZON / Math.max(1, nRing);
    for (let k = 0; k < nRing; k++) {
      const o = ((k * perRing) | 0) * 3, j = (k * 3) & JM;
      S.put(ring[o]     + jit[j]     * 0.09,
            ring[o + 1] + jit[j + 1] * 0.03,
            ring[o + 2] + jit[j + 2] * 0.09, STRUCTURE, 0.5);
    }
    S.pad(0.35);

    const nTr = P.room, perTr = TRAIL / Math.max(1, nTr);
    for (let k = 0; k < nTr; k++) {
      const o = ((k * perTr) | 0) * 5, j = (k * 3) & JM;
      const w = trail[o + 4];
      P.put(trail[o]     + jit[j]     * w,
            trail[o + 1] + jit[j + 1] * w * 0.55,
            trail[o + 2] + jit[j + 2] * w, PATH, trail[o + 3]);
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
