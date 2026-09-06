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

const STATIONS = 6;      // one per entry in the Path list; the list has six
const RAYS = 180;        // beams in a revolution, so two degrees between them
const NODS = 5;          // and revolutions per stop, so nine hundred beams a stop
const NOD = 0.24;        // how far the nod carries the plane off level, in radians
const RANGE = 3.9;       // how far a beam travels before it comes back empty
const RUN = 3.4;         // half the travelled stretch, either side of the anchor
const RIDE = 0.40;       // where the sweep plane sits above the floor
const SAMPLES = 384;     // route samples: fine enough that the tangent is smooth

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
   cannot have in the open: the route's far end is 7.29 m from the camera and
   32% into the fog, and its near end is 0.46 m from the lens, 36 degrees
   wide and only two and a half degrees clear of the bottom of the frame.
   Whatever appears has to appear at the far end. So flow 0 is the far end of
   the route and flow 1 is the near end -- the reverse of the route's own arc
   length -- and the six stops are swept last-to-first, 5 through 0.

   Each stop gets a slice of that schedule rather than an instant, and inside
   its slice a return's flow is its own azimuth. That is the whole difference
   between six sweeps flashing in turn and one sensor going round: of the 675
   or so returns a stop gets back from the 900 beams it fires, the ones lit at
   any moment are a single vertical fan, and it travels round the room once
   per slice -- pinching to nothing fore and aft, where a roll about the
   heading leaves the beam where it was, and opening to full height on both
   walls, which is the shape a nodding planar scanner actually paints.

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

  /* The same route, decimated, for drawing. The arc-length sampler walks its
     table from the start for every point it places, so handing it all 384
     costs more than everything else in this formation put together; every
     sixth is the coarsest strand whose chords stay inside the jitter the
     sampler adds anyway. The dense one is kept, because the tangents the
     poses are built from want it. */
  const strand = [];
  for (let i = 0; i < SAMPLES; i += 6) strand.push(route[i]);
  strand.push(route[SAMPLES - 1]);

  /* Arc length, because the stations want to be evenly spaced in metres
     driven. Spacing them in Z would bunch them wherever the route swings. */
  const cum = new Float64Array(SAMPLES);
  for (let i = 1; i < SAMPLES; i++) cum[i] = cum[i - 1] + route[i].distanceTo(route[i - 1]);
  const span = cum[SAMPLES - 1];

  /* Half the corridor's width, on a table sampled along Z. Every sweep reads
     the same table, so the second scan hits what the first one hit -- which
     is what makes the merge a map. The three terms are alcoves and pillars at
     three scales; a corridor of constant width scans as a perfect circle and
     reads as one. */
  const GRID = 0.025, Z0 = anchor.z - 7.0, NZ = 561;
  const wall = new Float32Array(NZ);
  for (let i = 0; i < NZ; i++) {
    const t = Z0 + i * GRID - anchor.z;
    wall[i] = 1.55 + 0.19 * Math.sin(t * 1.35) + 0.10 * Math.sin(t * 2.9 + 1.7)
                   + 0.05 * Math.sin(t * 6.1 + 0.4);
  }

  /* Openings, alternating sides. A corridor a sensor can see out of is a
     corridor; one it cannot is a pipe, and a pipe scans as a tube of returns
     at one radius. Each is a gap in the wall backed by a pocket, so the beams
     that find it come back much longer than their neighbours. */
  const DOORS = [
    { z: anchor.z + 2.15, side:  1, half: 0.42, depth: 1.45 },
    { z: anchor.z + 0.35, side: -1, half: 0.50, depth: 1.70 },
    { z: anchor.z - 1.25, side:  1, half: 0.38, depth: 1.30 },
    { z: anchor.z - 2.60, side: -1, half: 0.46, depth: 1.55 }
  ];

  function free(x, z) {
    let g = (z - Z0) / GRID;
    if (g < 0) g = 0; else if (g > NZ - 1.001) g = NZ - 1.001;
    const i = g | 0;
    const half = wall[i] + (wall[i + 1] - wall[i]) * (g - i);
    const lat = x - anchor.x;
    const a = lat < 0 ? -lat : lat;
    if (a < half) return true;
    for (let d = 0; d < DOORS.length; d++) {
      const o = DOORS[d];
      if (o.side * lat > 0 && Math.abs(z - o.z) < o.half && a < half + o.depth) return true;
    }
    return false;
  }

  /* March until the beam leaves free space, then bisect: the step is coarse
     enough to be cheap and the walls are a half-space boundary, so there is
     nothing thin enough to step over. `far` is where the floor already caught
     this beam, or the sensor's range if it did not; a beam that gets there
     still inside the corridor returns nothing at all, which is why the wedges
     straight up and down the corridor are empty -- the corridor is longer
     than the sensor can see down it. */
  const STEP = 0.03;
  function cast(ox, oz, dx, dz, far) {
    let t = 0.12;                                  // past the sensor's own housing
    if (!free(ox + dx * t, oz + dz * t)) return -1;
    let prev = t;
    while (t < far) {
      t += STEP;
      if (!free(ox + dx * t, oz + dz * t)) {
        let lo = prev, hi = t;
        for (let b = 0; b < 5; b++) {
          const mid = (lo + hi) * 0.5;
          if (free(ox + dx * mid, oz + dz * mid)) lo = mid; else hi = mid;
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
    // Held off both ends: the camera keyframe sits behind the first sweep and
    // the corridor has to keep running past the last one.
    const at = 0.09 + (k / (STATIONS - 1)) * 0.82;
    const s = at * span;
    /* This stop's slice, centred on where the stop actually stands in the
       drive rather than on an even sixth of the clock: spaced by metres
       driven, the stops are 1.145 m and 0.820 s apart, and a schedule that
       ignored that would light a sweep before or after the machine got to
       it. `1 - at` because the flow runs against the arc length. */
    const c0 = 1 - at - SLICE, cw = SLICE * 2;
    let i = 1;
    while (i < SAMPLES - 1 && cum[i] < s) i++;
    const f = (s - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1]);
    const o = route[i - 1].clone().lerp(route[i], f);
    fwd.copy(route[Math.min(SAMPLES - 1, i + 1)]).sub(route[Math.max(0, i - 2)]).normalize();
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
        let r = cast(o.x, o.z, dx, dz, far);
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
    const nBeam = P.share(0.25), perBeam = BEAMS / Math.max(1, nBeam);
    polyline(strand, P.room - nBeam, P, PATH, 1.5, 0.012, 0x51c7, [1, 0]);
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
