/* Formation 04 -- the path, as a corridor somebody drove.
 *
 * The formation before this was a rig standing still around the thing it was
 * measuring. This one is the route the whole page has been travelling, and
 * the only record a robot keeps of a route is the one it takes itself: a
 * sweep of the room at each place it stopped, and the pose each sweep was
 * taken from. Six stops, one per entry in the Path list, threaded onto the
 * route so the camera goes through them in order rather than past them.
 *
 * The walls come out of one shared field rather than being invented per
 * station, so the six sweeps agree about where the corridor is and their
 * union is a map instead of six rings. That agreement is the entire reason
 * the accumulated cloud reads as a map being built.
 *
 * And it runs. Six sweeps baked at once and all lit at once is a photograph
 * of a survey; what a survey looks like is one sensor going round, at one
 * place at a time, in the order it drove. The flow channel is what says so,
 * and every decision about it is below under "what runs".
 *
 * What changed: the corridor was one length of room with four openings in it,
 * and flying half of it showed you everything flying all of it did. A
 * timeline is not one room, it is a sequence of places, so it is built as one
 * now -- six bays, one per entry, divided by five gantries you pass under and
 * closed at the far end by a bulkhead with a door in it. The count each bay
 * carries is the only number in this file that is about the page rather than
 * about the geometry, and it is read off the page: see YEARS.
 */
import * as THREE from "three";
import { bands, polyline, triad, rng, STRUCTURE, PATH } from "./lib.js";

/* Offsets from the station anchor; the caller adds the anchor. Back far
   enough that the first sweep is a ring you are about to enter rather than
   one you are already inside, and a head's height above the scanner rather
   than level with it: level, the six sweeps are edge-on and the whole
   corridor collapses into one bright rule across the middle of the frame.
   Half a metre up and pitched down a few degrees opens them, and puts the
   route where a route belongs, under you and running away. Off the corridor's
   centreline by as much as the route is, so the strand comes out from under
   the eye rather than off a corner: the reading is that you are on it. */
export const VIEW = { pos: [0.30, 0.70, 3.85], look: [0.02, 0.30, -1.90], fov: 47 };

/* How many calendar years each entry of the Path list names, in the order
   index.html lists them, taken from the `path__when` line of each <li> and
   counted inclusive -- an open end names only its start year. Nothing here is
   chosen:

     2026 -      Siemens, Berkeley, from June 2026                        1
     2026        Northeastern, graduate lab assistant                     1
     2025 - 27   MS Robotics, ECE, expected May 2027                      3
     2020 - 25   Team Robocon MJCET, five ABU Robocon seasons             6
     2020 - 24   BE Computer Science and Engineering, Osmania             5
     2022        Consciente Technologies, robotics engineer intern        1

   Seventeen years over six entries, and the shape of that -- one, one, three,
   six, five, one -- is the only thing the corridor's bays differ by that a
   reader can count. It is drawn as a stack of ledges on the wall of each bay,
   and the stack is not a stylistic choice: it is the one arrangement whose
   count survives the corridor's own perspective. Laid *along* a bay at the
   0.17 m the bays have room for, marks sit on a surface that is nearly
   edge-on to the lens and they collapse into it: measured at the composed
   shot, bay 4's five spanned 23 px and bay 2's three 33 px -- a comb, not a
   count. Stacked up the wall the same marks are 0.135 m apart across the
   short axis of the frame, which foreshortens far less. On a 1916x953 frame
   bay 3's six make a 168 px stack with 33 px between ledges, bay 4's five
   105 px against that layout's 23, and at bay 5, the furthest away, a single
   step would still be 23 px. */
const YEARS = [1, 1, 3, 6, 5, 1];

const STATIONS = YEARS.length;   // one bay and one stop per entry, so six
const RAYS = 180;        // beams in a revolution, so two degrees between them
const NODS = 5;          // and revolutions per stop, so nine hundred beams a stop
const NOD = 0.24;        // how far the nod carries the plane off level, in radians
const RANGE = 3.9;       // how far a beam travels before it comes back empty
const RUN = 3.4;         // half the travelled stretch, either side of the anchor
const RIDE = 0.40;       // where the sweep plane sits above the floor
const SAMPLES = 384;     // route samples: fine enough that the tangent is smooth

/* ── the corridor, shared ───────────────────────────────────────────────
   Everything the solid at this station also has to know: where the walls
   are, where the openings are, where the bays divide, where the ledges
   stand, and what a beam is allowed to pass through. It used to be written
   out twice -- once here for the raycast, once in world/solids/path.js for
   the geometry -- with a paragraph at the top of the solid saying nothing in
   the block may be tuned on its own. That instruction held for four
   constants and would not have survived the twenty-odd this now needs, so
   the block is exported instead and the solid imports it. One source, and a
   wall the beams cannot miss by a construction difference because there is
   only one construction.

   The one thing this must stay is cheap: it is called twice at boot and the
   raycast calls free() 460172 times to bake the six sweeps, which is 49 ms
   measured on this machine. */

const GRID = 0.025, NZ = 561;          // the field's spacing and its length in Z
const SPAN = (NZ - 1) * GRID * 0.5;    // so the table reaches this far either side

/* The half-width field, and the one term in it that is new: a taper. Three
   sines at three scales are alcoves and pillars and stop the corridor
   scanning as a perfect circle, but they are periodic, and a periodic room is
   a room where the far half looks like the near half. 0.075 m of half-width
   per metre toward the camera is 0.497 m of narrowing across the 6.632 m of
   corridor that is built: 3.14 m wide at the near edge of the first bay and
   2.70 m at the door. Enough that the walls converge faster than perspective
   alone would take them, and not so much that the route, which wanders
   0.587 m off the centreline, ever runs out of room -- with the gantry legs
   counted in, the machine's worst clearance over the whole drive is 0.611 m,
   at the leg of the fifth gantry. */
const TAPER = 0.075;

const TICK_D = 0.11;     // how far a tally ledge stands proud of the wall face
const TICK_L = 0.44;     // its length along the corridor
const TICK_H = 0.055;    // and its thickness
const TICK_0 = 0.24;     // the bottom of a stack, above the floor
const TICK_P = 0.135;    // and the rise between ledges, so six reach 0.915

const PIER_D = 0.16;     // a gantry leg, proud of the wall face
const PIER_W = 0.20;     // and along the corridor

const ALCOVE_HALF = 0.36;
/* One opening per bay, alternating sides. A corridor a sensor can see out of
   is a corridor; one it cannot is a pipe, and a pipe scans as a tube of
   returns at one radius. There were four and they fell where they fell; at
   one per bay, centred on the stop, each sweep looks straight into its own
   recess and the deepest thing in every bay is a different distance away.
   The depths are not derived from anything and do not claim to be. They are
   chosen so that the range from a stop to the back of its own recess is
   different in every bay and inside the sensor's reach in all six: 2.646,
   3.769, 2.669, 3.125, 2.939 and 2.503 m against a range of 3.9. A corridor
   whose openings all bottom out at the same distance scans as a corridor with
   one opening drawn six times. */
const ALCOVE_DEPTH = [1.45, 1.70, 1.30, 1.55, 1.40, 1.60];

/* The far end. It used to be 8.4 m of straight wall each way running out
   into fog, which is the honest way to end a corridor you have nothing to put
   at the end of, and it meant the deepest thing at this station was an
   absence. Now the record stops where the list does: a bulkhead across the
   corridor with a door in it, and behind it a room wider and taller than the
   corridor is.

   The bulkhead is placed off the route rather than off the field. Its 0.22 m
   of thickness straddles the route's own last sample -- 0.11 m of it in
   front, 0.11 behind -- and the doorway is 0.40 m off the corridor's axis on
   the side the route leaves by, so that sample lands inside the opening at
   x = -0.545 against a door running -0.950 to 0.150. The machine on the solid
   layer starts its lap there, invisible, and is fully formed 0.415 m later
   and 0.305 m clear of the bulkhead: it comes through the door rather than
   condensing out of empty corridor, which is what the arrival always wanted
   to be and had nothing to be it against.

   Measured at the composed shot: the bulkhead is 7.27 m from the lens and
   0.32 into the fog, the doorway is 168 px wide and 213 tall on a 1916x953
   frame, and the chamber's back wall is 9.19 m out and 0.52 fogged -- dim,
   and structure rather than nothing. It is inside the sensor too: the last
   stop stands 2.54 m from that back wall against a range of 3.9, so the
   sweeps reach through the door and 265 of the 4277 returns are inside the
   room rather than in the corridor. The cloud has a far end as well as the
   geometry. */
const TERM_T = 0.22;         // the bulkhead's thickness
const DOOR_HALF = 0.55;      // half the doorway, so 1.10 m of clear opening
const DOOR_OFF = -0.40;      // and where it sits off the corridor's centreline
const CHAMBER_HALF = 2.30, CHAMBER_D = 1.80;
/* And its floor is 0.14 up on the corridor's. A doorway at seven metres is a
   dark slot in a lit wall whatever is behind it -- the wall faces the key and
   anything two metres further back is both turned away and further into the
   fog -- so the one surface that can carry the far end is a floor, which is
   the brightest orientation there is here: 0.78 onto the key against 0.46 for
   a wall facing the lens. Stepping the room up puts a riser across the base
   of the opening and a lit deck behind it, and free() knows about it, so of
   the 265 returns that reach the room 36 come back off the deck's top face
   rather than passing through where its floor used to be. */
const CHAMBER_RISE = 0.14;

export function corridor(anchor) {
  const Z0 = anchor.z - SPAN;
  const wall = new Float32Array(NZ);
  for (let i = 0; i < NZ; i++) {
    const t = Z0 + i * GRID - anchor.z;
    wall[i] = 1.55 + 0.19 * Math.sin(t * 1.35) + 0.10 * Math.sin(t * 2.9 + 1.7)
                   + 0.05 * Math.sin(t * 6.1 + 0.4) + TAPER * t;
  }
  // Clamped rather than extended past the table, which is what the raycast
  // does, so the wall out at the ends is where a beam would have found it.
  function halfAt(z) {
    let g = (z - Z0) / GRID;
    if (g < 0) g = 0; else if (g > NZ - 1.001) g = NZ - 1.001;
    const i = g | 0;
    return wall[i] + (wall[i + 1] - wall[i]) * (g - i);
  }

  /* The route. Two lateral sines that do not come back into phase inside the
     run, so the drift never repeats and the line never straightens into a
     rail; the vertical term is small because this is a floor, not a ramp. */
  const route = [];
  for (let i = 0; i < SAMPLES; i++) {
    const u = i / (SAMPLES - 1);
    route.push(new THREE.Vector3(
      anchor.x + 0.44 * Math.sin(u * 4.1 + 0.6) + 0.17 * Math.sin(u * 9.7 + 2.2),
      anchor.y + RIDE + 0.05 * Math.sin(u * 5.3 + 1.1) + 0.022 * Math.sin(u * 12.6),
      anchor.z + RUN - u * 2 * RUN
    ));
  }

  /* Arc length, because the stations want to be evenly spaced in metres
     driven. Spacing them in Z would bunch them wherever the route swings. */
  const cum = new Float64Array(SAMPLES);
  for (let i = 1; i < SAMPLES; i++) cum[i] = cum[i - 1] + route[i].distanceTo(route[i - 1]);
  const span = cum[SAMPLES - 1];

  // Held off both ends: the camera keyframe sits behind the first sweep, and
  // the last stop has to leave the bulkhead far enough away that its sweep is
  // taken in a room rather than against an end wall. 0.514 m as it falls out,
  // against the 0.542 m the same stop stands from the gantry on its other
  // side -- so it is as near the middle of its own bay as every other stop is
  // of its own.
  const fwd = new THREE.Vector3();
  const stops = [];
  for (let k = 0; k < STATIONS; k++) {
    const at = 0.09 + (k / (STATIONS - 1)) * 0.82, s = at * span;
    let i = 1;
    while (i < SAMPLES - 1 && cum[i] < s) i++;
    const f = (s - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1]);
    const o = route[i - 1].clone().lerp(route[i], f);
    fwd.copy(route[Math.min(SAMPLES - 1, i + 1)]).sub(route[Math.max(0, i - 2)]).normalize();
    stops.push({ at, o, fwd: fwd.clone() });
  }

  /* Where one bay stops and the next starts: halfway between two stops, in Z
     rather than in arc length, because a gantry is a thing built across a
     room and the room is measured in Z. Seven edges for six bays. The near
     one is not a gantry -- it is 0.51 m from the lens and would be a wall of
     geometry across the frame -- so the reader stands in bay 0 with it open
     behind them, and the count on screen is five gantries and a door. */
  const edge = new Float64Array(STATIONS + 1);
  for (let k = 1; k < STATIONS; k++) edge[k] = (stops[k - 1].o.z + stops[k].o.z) * 0.5;
  edge[0] = stops[0].o.z + (stops[0].o.z - edge[1]);
  const termFace = route[SAMPLES - 1].z + TERM_T * 0.5;
  edge[STATIONS] = termFace;
  const doorX = anchor.x + DOOR_OFF;

  const DOORS = [];
  for (let k = 0; k < STATIONS; k++)
    DOORS.push({ z: stops[k].o.z, side: k % 2 ? -1 : 1, half: ALCOVE_HALF,
                 depth: ALCOVE_DEPTH[k], bay: k });

  /* The tally, one stack per bay, on the wall opposite that bay's opening --
     so the count is never read across a hole, and the two walls alternate
     which of them is carrying it. */
  const ticks = [];
  for (let k = 0; k < STATIONS; k++) {
    const side = -DOORS[k].side, zc = (edge[k] + edge[k + 1]) * 0.5;
    for (let j = 0; j < YEARS[k]; j++)
      ticks.push({ bay: k, side, j, of: YEARS[k],
                   z0: zc - TICK_L * 0.5, z1: zc + TICK_L * 0.5,
                   y: TICK_0 + j * TICK_P });
  }

  /* What stands proud of each wall, as sorted intervals in Z, so the raycast
     answers "is this beam already inside a ledge" with a binary search rather
     than a scan over every piece of relief in the corridor. Two lists, since
     a stack of ledges is on one wall only. */
  const relief = [[], []];   // [0] is the -x wall, [1] the +x wall
  for (const t of ticks)
    relief[t.side > 0 ? 1 : 0].push([t.z0, t.z1, TICK_D, t.y - TICK_H * 0.5, t.y + TICK_H * 0.5]);
  // A gantry leg runs the whole height of the room, so its band is opened
  // wider than anything a beam can reach rather than being given bounds it
  // would then have to be checked against.
  for (let k = 1; k < STATIONS; k++)
    for (const r of relief)
      r.push([edge[k] - PIER_W * 0.5, edge[k] + PIER_W * 0.5, PIER_D, -1, 9]);
  for (const r of relief) r.sort((a, b) => a[0] - b[0]);

  /* How far into the corridor the wall on `side` comes at (y, z). A ledge is
     0.055 m thick and a beam passing above or below one has to reach the wall
     behind it, so this is the one place the raycast stopped being flat: the
     walls are vertical and the openings are full height, but a stack of
     ledges is neither, and modelling it in plan alone would have moved every
     return at that bay 0.11 m in. */
  function proud(y, z, side) {
    const iv = relief[side > 0 ? 1 : 0];
    let lo = 0, hi = iv.length - 1;
    while (lo <= hi) {
      const m = (lo + hi) >> 1, r = iv[m];
      if (z < r[0]) hi = m - 1;
      else if (z > r[1]) lo = m + 1;
      else return (y >= r[3] && y <= r[4]) ? r[2] : 0;
    }
    return 0;
  }

  /* Free space, in the sensor's terms. Three regions: the corridor with its
     relief and its openings, the bulkhead with its door, and the chamber
     behind. Everything past the chamber's back wall is solid, which is what
     ends the corridor -- before, a beam fired down it simply ran out of range
     and the wedge fore and aft of every stop came back empty. */
  function free(x, y, z) {
    const lat = x - anchor.x;
    const a = lat < 0 ? -lat : lat;
    if (z < termFace) {
      if (z > termFace - TERM_T) {
        const d = lat - DOOR_OFF;
        return (d < 0 ? -d : d) < DOOR_HALF;
      }
      if (z > termFace - TERM_T - CHAMBER_D)
        return a < CHAMBER_HALF && y - anchor.y > CHAMBER_RISE;
      return false;
    }
    const wide = halfAt(z);
    if (a < wide - proud(y - anchor.y, z, lat < 0 ? -1 : 1)) return true;
    // An opening is a gap in the wall backed by a pocket, so the beams that
    // find it come back much longer than their neighbours.
    for (let d = 0; d < DOORS.length; d++) {
      const o = DOORS[d];
      if (o.side * lat > 0 && Math.abs(z - o.z) < o.half && a < wide + o.depth) return true;
    }
    return false;
  }

  return {
    anchor, YEARS, STATIONS, GRID, NZ, Z0, wall, halfAt, free,
    route, cum, span, stops, edge, DOORS, ticks,
    TICK_D, TICK_L, TICK_H, TICK_0, TICK_P, PIER_D, PIER_W,
    termFace, doorX, TERM_T, DOOR_HALF, DOOR_OFF,
    CHAMBER_HALF, CHAMBER_D, CHAMBER_RISE
  };
}

/* ── what runs ──────────────────────────────────────────────────────────
   `uRun` walks 0..1 in five seconds and the substrate lights every point
   whose flow lands within uRunWidth -- 0.16 -- of it. So flow is not a
   decoration, it is a schedule: whatever is happening now carries a value
   near uRun, whatever is not carries one far from it, and -1 means the point
   is not part of anything that happens at all. The corridor's accumulated
   map is written with -1 for exactly that reason. A wall is not moving.

   The schedule is the drive, and the drive runs from the far end of the
   corridor back toward the eye. That direction is chosen by where the loop's
   seam can be hidden, because a seam is the one thing a five-second loop
   cannot have in the open: the route's far end is 7.30 m from the camera and
   32% into the fog, and its near end is 0.46 m from the lens, 36 degrees
   wide and only two and a half degrees clear of the bottom of the frame.
   Whatever appears has to appear at the far end. So flow 0 is the far end of
   the route and flow 1 is the near end -- the reverse of the route's own arc
   length -- and the six stops are swept last-to-first, 5 through 0.

   Each stop gets a slice of that schedule rather than an instant, and inside
   its slice a return's flow is its own azimuth. That is the whole difference
   between six sweeps flashing in turn and one sensor going round: of the 628
   to 786 returns a stop gets back from the 900 beams it fires -- the count
   climbs the further down the corridor the stop is, because the far end is
   closed now and the near end is not -- the ones lit at any moment are a
   single vertical fan, and it travels round the room once per slice. It
   pinches to nothing fore and aft, where a roll about the heading leaves the
   beam where it was, and opens to full height on both walls, which is the
   shape a nodding planar scanner actually paints.

   Half-width 0.082, so the six slices tile the 0.82 of the route the stops
   are spread over without gapping or overlapping. Against a band that
   reaches 0.16 either side that means two stops are in the light at once and
   one ring runs 1.00 at its middle to 0.48 at its ends: a gradient crossing
   a ring, rather than a ring switching on. At the wrap those two stops are
   the two ends of the corridor rather than neighbours -- the last sweep
   handing over to the first -- which is the one place in the lap the
   schedule is not local, and the place the machine on the solid layer is
   deliberately not standing. */
const SLICE = 0.82 / (STATIONS - 1) * 0.5;

export function build(ctx) {
  const anchor = ctx.anchor;
  const jr = rng(0x9e37f1);
  const C = corridor(anchor);
  const { route, cum, span, stops, free } = C;

  /* The same route, decimated, for drawing. The arc-length sampler walks its
     table from the start for every point it places, so handing it all 384
     costs more than everything else in this formation put together; every
     sixth is the coarsest strand whose chords stay inside the jitter the
     sampler adds anyway. The dense one is kept, because the tangents the
     poses are built from want it. */
  const strand = [];
  for (let i = 0; i < SAMPLES; i += 6) strand.push(route[i]);
  strand.push(route[SAMPLES - 1]);

  /* March until the beam leaves free space, then bisect: the step is coarse
     enough to be cheap and the walls are a half-space boundary, so there is
     nothing thin enough to step over -- except a ledge, which is 0.055 m
     thick and would be, so the ledges are 0.44 m long in Z and the march is
     across their length rather than through their thickness. `far` is where
     the floor already caught this beam, or the sensor's range if it did not;
     a beam that gets there still inside the corridor returns nothing at all,
     which used to be the wedge straight up the corridor and straight back
     down it from every stop. The bulkhead closes the forward one for the four
     stops within range of it -- the third is 3.78 m off against a range of
     3.9 -- and leaves it open for the two nearest, which are 4.93 and 6.06 m
     away. Behind is still open at every stop, and has to be: it is where the
     camera is standing. */
  const STEP = 0.03;
  function cast(ox, oy, oz, dx, dy, dz, far) {
    let t = 0.12;                                  // past the sensor's own housing
    if (!free(ox + dx * t, oy + dy * t, oz + dz * t)) return -1;
    let prev = t;
    while (t < far) {
      t += STEP;
      if (!free(ox + dx * t, oy + dy * t, oz + dz * t)) {
        let lo = prev, hi = t;
        for (let b = 0; b < 5; b++) {
          const mid = (lo + hi) * 0.5;
          if (free(ox + dx * mid, oy + dy * mid, oz + dz * mid)) lo = mid; else hi = mid;
        }
        return (lo + hi) * 0.5;
      }
      prev = t;
    }
    return -1;
  }

  /* ── the six sweeps ─────────────────────────────────────────────────── */
  const SIG_R = 0.016;      // spread along the beam, revolution to revolution
  const SIG_A = 0.006;      // and across it, since the scanner's phase is free
  const hit = [];           // hx hy hz | radial | in-plane transverse
  const hf = [];            // and where each of them falls in the schedule
  const map = [];           // the same returns, each sweep registered a little wrong
  const first = new Int32Array(STATIONS), last = new Int32Array(STATIONS);
  const poses = [], origins = [];
  const fwd = new THREE.Vector3(), left = new THREE.Vector3(), up = new THREE.Vector3();
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  const WORLD_UP = new THREE.Vector3(0, 1, 0);

  for (let k = 0; k < STATIONS; k++) {
    const at = stops[k].at;
    /* This stop's slice, centred on where the stop actually stands in the
       drive rather than on an even sixth of the clock: spaced by metres
       driven, the stops are 1.145 m and 0.820 s apart, and a schedule that
       ignored that would light a sweep before or after the machine got to
       it. `1 - at` because the flow runs against the arc length. */
    const c0 = 1 - at - SLICE, cw = SLICE * 2;
    const o = stops[k].o;
    fwd.copy(stops[k].fwd);
    left.crossVectors(WORLD_UP, fwd).normalize();
    up.crossVectors(fwd, left).normalize();
    origins.push(o);
    // x forward, y left, z up, so the six frames read as robot poses rather
    // than as three sticks that happen to meet.
    poses.push(new THREE.Matrix4().makeBasis(fwd, left, up).setPosition(o));

    // Registration error for this sweep: a couple of centimetres and a
    // fraction of a degree of yaw, which is what a loop nobody has closed yet
    // looks like when you draw all of it at once.
    const ey = (jr() - 0.5) * 0.024, ce = Math.cos(ey), se = Math.sin(ey);
    const ex = (jr() - 0.5) * 0.05, ez = (jr() - 0.5) * 0.05, eh = (jr() - 0.5) * 0.02;
    const rock = (jr() - 0.5) * 0.05, pitch = (jr() - 0.5) * 0.05;

    first[k] = hit.length / 9;
    for (let d = 0; d < NODS; d++) {
      // The scanner nods between revolutions. A plane of beams held level
      // paints one line at exactly the sensor's height, and a corridor read
      // out of it is a horizontal rule seen edge-on from inside; rolled
      // through a nod it paints a fan up both walls and across the floor,
      // which is why a planar scanner ends up on a servo the moment anyone
      // wants a map out of it. `rock` is the floor the base is standing on.
      const roll = (d / (NODS - 1) - 0.5) * 2 * NOD + rock;
      e1.copy(left).multiplyScalar(-Math.cos(roll)).addScaledVector(up, Math.sin(roll));
      e2.copy(fwd).multiplyScalar(Math.cos(pitch)).addScaledVector(up, Math.sin(pitch));

      for (let b = 0; b < RAYS; b++) {
        const th = (b / RAYS) * Math.PI * 2, c = Math.cos(th), sn = Math.sin(th);
        const dx = e1.x * c + e2.x * sn, dy = e1.y * c + e2.y * sn, dz = e1.z * c + e2.z * sn;
        // Whichever the beam meets first: the floor, a wall, or nothing.
        const drop = dy < -1e-4 ? (o.y - anchor.y) / -dy : RANGE;
        const far = drop < RANGE ? drop : RANGE;
        let r = cast(o.x, o.y, o.z, dx, dy, dz, far);
        if (r < 0) { if (far >= RANGE) continue; r = far; }
        const hx = o.x + dx * r, hy = o.y + dy * r, hz = o.z + dz * r;
        hit.push(hx, hy, hz,
                 dx * SIG_R, dy * SIG_R, dz * SIG_R,
                 (-e1.x * sn + e2.x * c) * r * SIG_A,
                 (-e1.y * sn + e2.y * c) * r * SIG_A,
                 (-e1.z * sn + e2.z * c) * r * SIG_A);
        // Azimuth, not revolution: all five nods of one stop share a beam's
        // bearing, so what lights up together is the fan the servo swept
        // through at that bearing. Keying it on `d` instead would have put
        // five whole rings inside the band at once, which is a stop
        // brightening and dimming -- the thing this is here to stop being.
        hf.push(c0 + (b / RAYS) * cw);
        map.push(o.x + (hx - o.x) * ce - (hz - o.z) * se + ex,
                 hy + eh,
                 o.z + (hx - o.x) * se + (hz - o.z) * ce + ez);
      }
    }
    last[k] = hit.length / 9;
  }
  const H = Float32Array.from(hit), M = Float32Array.from(map);
  const HF = Float32Array.from(hf);
  const HITS = H.length / 9;

  /* A few beams drawn all the way out at each station. A return with no ray
     to it is a dot on a wall; the ray is what says the dot was sensed from
     somewhere. Stopped short of the hit so the beam and its own return stay
     legible as two things. */
  const PER_STATION = 5, ALONG = 26;
  const beam = [], bf = [];
  for (let k = 0; k < STATIONS; k++) {
    const o = origins[k], n = last[k] - first[k];
    if (n <= 0) continue;
    for (let j = 0; j < PER_STATION; j++) {
      const g = first[k] + ((((j * n / PER_STATION) | 0) + k * 37) % n), h = g * 9;
      for (let s = 0; s < ALONG; s++) {
        const t = 0.03 + (s / (ALONG - 1)) * 0.59;
        beam.push(o.x + (H[h] - o.x) * t, o.y + (H[h + 1] - o.y) * t, o.z + (H[h + 2] - o.z) * t);
        // The whole ray carries its own return's place in the schedule, not a
        // ramp along its length: a beam is emitted at one bearing at one
        // instant, so it lights with the return it made and goes out with it.
        // Ramping it would have drawn the ray as though the light took a
        // fifth of a second to travel two metres.
        bf.push(HF[g]);
      }
    }
  }
  const B = Float32Array.from(beam), BF = Float32Array.from(bf), BEAMS = B.length / 3;

  /* The tally, in the accent, along the top-inner edge of every ledge -- the
     edge that catches the key light on the solid, so the accent is drawn
     where the geometry is already brightest rather than beside it. Seventeen
     strokes in six stacks, and the count is the count above.

     Each stroke carries its bay's own slice of the schedule, spread up the
     stack, so a bar fills from the bottom while the sweep at that stop goes
     round. That is the only reason the accent here is worth more than a
     colour: the number and the sensor that measured the room it is written
     in are on the same clock. */
  const rail = [];
  for (const t of C.ticks) {
    const c0 = 1 - stops[t.bay].at - SLICE, cw = SLICE * 2;
    rail.push({ side: t.side, y: anchor.y + t.y + TICK_H * 0.5, z0: t.z0, z1: t.z1,
                f: c0 + ((t.j + 0.5) / t.of) * cw });
  }

  /* One table of noise, read three at a time from a stride coprime with its
     length so the triples never repeat inside a band. Two entries of overrun
     on the end, so the read past the wrap is a read rather than a bounds
     check. All the trigonometry is above this line; what is left for fill is
     a walk down these arrays with a multiply-add on each axis. */
  const JN = 4096, JM = JN - 1;
  const jit = new Float32Array(JN + 2);
  for (let i = 0; i < JN; i++) jit[i] = jr() * 2 - 1;
  jit[JN] = jit[0]; jit[JN + 1] = jit[1];

  return function fill(pos, kind, size, count, flow) {
    const { S, P, F } = bands(pos, kind, size, count, flow);

    /* The returns. A stop is not one revolution: the scanner keeps turning
       while the base stands still, and each turn puts the return in a
       slightly different place -- along the beam by the range noise, across
       it because the phase is free between revolutions. So the same return
       is drawn as many times as the buffer can afford, and the quality tier
       ends up deciding how long the sensor stood there. */
    // The step through the returns is hoisted because a divide is the one
    // thing in this loop that is not a multiply-add.
    const nRet = S.share(0.78);
    const perRet = HITS / Math.max(1, nRet);
    for (let k = 0; k < nRet; k++) {
      const g = (k * perRet) | 0, o = g * 9, j = (k * 3) & JM;
      const a = jit[j], b = jit[j + 1], c = jit[j + 2];
      // Every copy of a return carries the same schedule value as the return
      // it was drawn from, so the range noise spreads the fan in space and
      // not in time: a fan 16 mm thick, which is what SIG_R says, rather than
      // a fan smeared across the slice it was fired in.
      S.put(H[o]     + H[o + 3] * a + H[o + 6] * b,
            H[o + 1] + H[o + 4] * a + H[o + 7] * b + c * 0.010,
            H[o + 2] + H[o + 5] * a + H[o + 8] * b,
            STRUCTURE, 1.0, HF[g]);
    }
    /* The map: all six sweeps in one frame at once, each one off by its own
       registration error, so the walls come out as a band rather than a line.
       Faint, because it is the accumulation and not the reading.

       And no flow, deliberately. This is the corridor -- what has already
       been measured and is not being measured again -- and a wall that
       brightens as something passes it is a wall that is doing something.
       Only the live returns run; the room they land on stands still. */
    const nMap = S.room, perMap = HITS / Math.max(1, nMap);
    for (let k = 0; k < nMap; k++) {
      const o = ((k * perMap) | 0) * 3, j = (k * 3 + 977) & JM;
      S.put(M[o]     + jit[j]     * 0.028,
            M[o + 1] + jit[j + 1] * 0.014,
            M[o + 2] + jit[j + 2] * 0.028,
            STRUCTURE, 0.55);
    }
    S.pad();

    /* One strand, unbroken, for the same reason it was unbroken when it was a
       planned route and a result profile: the accent has to arrive here as
       the same thing it left as, or the morph reads as a cut.

       [1, 0] rather than `true`: the strand is stored from the near end
       outward, and the drive runs the other way. Handed `true` the band would
       travel away down the corridor while the machine on the solid layer came
       up it, which is two systems disagreeing about which way the robot went
       -- worse than neither of them moving. */
    const nBeam = P.share(0.20), perBeam = BEAMS / Math.max(1, nBeam);
    /* The tally gets a fixed share of what is left rather than a count, so it
       thins with the tier along with everything else. A quarter: 17 strokes
       over 7.48 m of edge is 555 points a metre at the high tier, which is
       dense enough that a 0.44 m ledge is a line and not a dotted one, and it
       leaves the route strand -- the thing that has to survive the morph --
       with 12492 points against the 15600 it had, four fifths. */
    const nRail = Math.floor((P.room - nBeam) * 0.25);
    const perStroke = Math.max(2, Math.floor(nRail / Math.max(1, rail.length)));
    polyline(strand, P.room - nBeam - perStroke * rail.length, P, PATH, 1.5, 0.012, 0x51c7, [1, 0]);
    /* Each point's lateral position off the field rather than lerped between
       the stroke's two ends, and that is not a nicety: the wall bends 62.7 mm
       away from a chord drawn over a ledge's 0.44 m, against a ledge that only
       stands 0.11 m proud of it, so a straight stroke would have been buried
       in the wall at the middle of every one of the seventeen. The solid lays
       its ledges on three chords for the same reason; halfAt is a table
       lookup and this is 4148 of them, once. */
    for (let i = 0; i < rail.length; i++) {
      const r = rail[i];
      for (let s = 0; s < perStroke; s++) {
        const t = s / (perStroke - 1), j = (i * 7 + s * 3) & JM;
        const z = r.z0 + (r.z1 - r.z0) * t;
        P.put(anchor.x + r.side * (C.halfAt(z) - TICK_D) + jit[j] * 0.004,
              r.y + jit[j + 1] * 0.004,
              z + jit[j + 2] * 0.004,
              PATH, 1.15, r.f);
      }
    }
    for (let k = 0; k < nBeam; k++) {
      const g = (k * perBeam) | 0, o = g * 3, j = (k * 3 + 2311) & JM;
      P.put(B[o]     + jit[j]     * 0.006,
            B[o + 1] + jit[j + 1] * 0.006,
            B[o + 2] + jit[j + 2] * 0.006,
            PATH, 0.85, BF[g]);
    }
    P.pad();

    /* Six poses, in the order the timeline lists them. Short arms: a frame is
       punctuation, and at half a metre it would be a windmill.

       No flow either. A pose is a number that was written down, and the six
       of them are the output of the drive rather than part of it; running
       them would say the frames were being re-measured. */
    const per = Math.floor(F.room / STATIONS);
    for (let k = 0; k < STATIONS; k++) triad(poses[k], per, F, 0.20, 1.15);
    F.pad();
  };
}
