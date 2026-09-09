/* Solid 04 -- the corridor the beams are hitting.
 *
 * The formation at this station is six nodding sweeps, and a sweep only reads
 * as a sweep if the room it is sweeping is there. A return in black is a
 * speck; the same return a centimetre off a wall is the wall. So the returns
 * stay points -- a return is a point, and giving one a surface would be a
 * claim the scanner never made -- and what gets built here is everything the
 * beams stop on: two walls, the floor they fall to, the openings they see out
 * of, the ledges they graze, a plinth at each of the six places the scanner
 * stood, and the bulkhead that ends the record.
 *
 * The camera is inside this one rather than in front of it. That is what
 * decides most of the numbers below: the walls have to be tall enough to
 * occlude from an eye seventy centimetres off the floor, everything the
 * reader flies through has to be open where the field says it is open, and
 * the far end has to be worth looking at, because the whole shot is aimed
 * down it.
 *
 * What changed: this was 6.6 m of one room, so the near half and the far half
 * were the same picture at two sizes. It is six bays now, one per entry in
 * the Path list, divided by five gantries and closed by a door. Every figure
 * that names a bay, an opening or a ledge comes from the formation, which is
 * the only place the corridor is constructed.
 */
import * as THREE from "three";
import { makeSurface, seedSurface } from "../materials/surface.js";
import { rng } from "../formations/lib.js";
import { corridor } from "../formations/path.js";

/* ── the formation's corridor, imported rather than repeated ────────────
   It used to be written out again here -- same three sines, same 25 mm
   table, same four openings -- under a paragraph saying nothing in the block
   might be tuned on its own. That instruction held while there were four
   constants to keep in step. It would not have survived the two dozen the
   corridor now needs: a taper, six openings placed off the stops, seven bay
   edges, seventeen ledges at two heights, a bulkhead and a room behind it.
   So world/formations/path.js exports its construction and this imports it.
   One source. A wall this file builds cannot miss the returns lying on it by
   a difference in construction, because there is only one construction. */

const STOPS = 6;           // entries in the Path list, which has six

/* ── what the solid adds ────────────────────────────────────────────────
   Head height and a little more. The eye is 0.70 above this floor, so
   anything shorter is a kerb you see over and occludes nothing; the nodded
   sweeps paint the wall to 1.362 m at their highest -- measured off the bake
   -- so a wall shorter than that is also a wall the returns hang above. */
const WALL_H = 1.40;
const THICK = 0.12;        // enough that the top of a wall is a surface, not a line
const SINK = 0.03;         // walls set into the floor: coplanar faces fight
const LAP = 0.006;         // and segments overlap their neighbours, so a turn in
                           // the wall cannot open a hairline of background
const FLOOR_T = 0.30;
/* How far the corridor and its floor run on past the camera. The far end is
   a bulkhead now rather than fog, so the only run left to size is the one
   behind the eye, and what sizes it is not the settled shot -- nothing back
   there is in frame -- but the flight in.

   5.0 was tried first, on the settled shot's own numbers: 1.15 m behind a
   lens the crossing pulls back by 0.55 along its view axis, which is plenty
   for anything the reader can see from where they end up. It is wrong for the
   arrival. The crossing carries the eye from z = -10.48 to -15.91, measured
   on the journey probe, and Path's solid is drawn for all of it -- eroding
   from cut 1 to 0 as it goes. At REACH 5 the floor's near edge sits at
   -14.80, which the eye crosses four fifths of the way through -- and by then
   the erosion has come down to a threshold of 0.213 on a noise field that
   runs 0 to 1, so most of the room is back. A floor that stops in mid air, in
   frame, at the one moment the station is meant to be arriving. The old
   geometry had the same edge at -11.40 and got away with it only because the
   eye passed it 17% in, at a threshold of 0.944, where almost nothing
   survives to have an edge.

   9.6 puts it at -10.20, which is 0.28 m behind where the flight starts. The
   eye never crosses it at all. It costs 92 more boxes on a mesh that was 269,
   none of which is ever drawn from the settled shot. */
const REACH = 9.6;
const PLINTH_H = 0.30;     // under where the sweep plane rides, so a marker
const PLINTH_W = 0.26;     // never stands up into its own scan
const BATTER = 0.78;       // narrower at the top, so six markers do not read as
                           // six more pieces of wall

/* ── the gantries ───────────────────────────────────────────────────────
   A leg on each wall and a beam across, at the five places one bay becomes
   the next. This is the whole reason the corridor is countable: the walls
   converge, so anything laid *along* them compresses into the vanishing
   point, and anything laid *across* them does not. Measured at the composed
   shot on a 1916x953 frame, the five soffits sit at y = 20, 177, 242, 277 and
   298 px -- a ladder up the top of the picture, and five gaps between six
   bays. The near edge of bay 0 gets no gantry: it is 0.51 m from the lens and
   would be a wall of geometry across the frame, so the reader stands in the
   first bay with it open behind them.

   1.26 rather than the 1.30 it was tried at, and the difference is the whole
   near gantry. At 1.30 the first soffit projects to y = -8 -- eight pixels
   off the top of the frame -- so the count on screen was four beams and a
   pair of legs; at 1.26 it is y = 20 and all five are there. 0.56 m above the
   eye either way, so you still pass under all five rather than through any.

   The beam clears the wall it lands on by 0.18 m, which is what makes a
   gantry read as a gantry from any distance rather than only from underneath:
   the wall top is one continuous line down the corridor and this steps over
   it five times. */
const SOFFIT = 1.26, GANT_TOP = 1.58;
const PIER_T = 0.06;       // how far a leg and a ledge bury into the wall behind
const BAR_H = 0.014;       // the threshold bar across the floor at each gantry
const BAR_W = 0.06;

/* ── the far end ────────────────────────────────────────────────────────
   The bulkhead stands 1.86 m, 0.46 m over the corridor's own walls, so the
   end of the record is the tallest thing in it and the wall-top line runs
   into something rather than out. The door is 1.10 m wide and 1.52 to its
   head, and it is 0.40 m off the corridor's axis toward the side the route
   leaves on, so the jambs come out 0.40 m and 1.20 m -- a door in a wall
   rather than a hole in the middle of one. The chamber behind is 2.10 tall
   and 4.60 across against a corridor that is 2.70 wide where it meets it,
   which is the point: through the opening you can see 1.41 m of the back wall
   and 1.75 m up it, and all of that is further away and wider than anything
   in front of it.

   One ledge on the back wall, at the gantry soffit's own height, so the datum
   the corridor is ruled to carries into the room. It is the one piece of
   geometry at this station that is deliberately outside the survey: the
   highest return anywhere in the chamber is 1.110 m above the floor, measured
   off the bake, and the ledge is 0.15 m over that. The scan cannot see it.
   Neither could the real thing -- a planar head nodding +/-0.24 rad from
   0.40 m up runs out of elevation long before it runs out of range. */
const TERM_H = 1.86, DOOR_H = 1.52;
const CHAMBER_H = 2.10, CHAMBER_T = 0.16;
// The deck the room stands on is only ever seen from above and through a
// door, so its thickness is whatever buries it in the floor slab under it.
const DECK_T = 0.24;
const LEDGE_Y = 1.26, LEDGE_D = 0.20, LEDGE_H = 0.07;

/* ── the machine that drove it ──────────────────────────────────────────
   A base the size of the ones that do this work: 0.46 long, 0.34 across,
   0.44 to the top of its head. Everything above the floor is stacked rather
   than positioned, so a change to one course carries the ones over it --
   rails, then deck, then a mast that reaches whatever height the route says
   the scanner is riding at this instant, then the drum.

   The width is the one figure with an outside constraint. The route wanders
   0.587 m off the centreline and the corridor now tapers as well as
   undulating, so the field it is driving inside comes down to 1.130 m
   half-width; a body 0.17 m from its own axis still clears the wall by
   0.611 m at the worst place it is ever drawn, which is the leg of the fifth
   gantry rather than a stretch of open wall. A wider base would have had to
   be checked against the field every frame. */
const RAIL_W = 0.055, RAIL_H = 0.075, RAIL_L = 0.40;
const BODY_W = 0.34, BODY_L = 0.46, BODY_H = 0.115;
const DECK_TOP = RAIL_H + BODY_H;      // 0.19 -- where the mast starts
const MAST_W = 0.075;
/* The drum. 0.17 across, which is half the deck's width and twice the mast's,
   so it reads as the instrument rather than as another block: it is the only
   round thing at the station. Radius is also what makes the nod visible at
   all -- +/-0.24 rad swings the rim by 20.2 mm, and that is 25.4 px of a
   953 px frame at the 1.85 m the drive gets closest, 13.9 px at 3.37 m,
   6.8 px at 6.88 m. Small, but a rocking edge is read as motion long before
   it is read as distance. */
const HEAD_R = 0.085, HEAD_H = 0.075;
/* How far off level the nod carries the scan plane, either way, in radians.
   It is the formation's own number: the sweeps roll their plane by exactly
   this much about the heading and bake 4277 returns where that puts them, so
   the head modelled here has to rock through the same angle or the machine is
   doing something the cloud around it did not record. */
const NOD = 0.24;

/* One lap of the travelling band, in seconds: the loop advances it at 0.2
   feature-lengths a second. Only the fallback path uses it -- the drive is
   normally handed `run` directly -- but a number this load-bearing should not
   be spelled 1/0.2 at the point of use. Not LAP, which is already the six
   millimetres one wall segment overlaps the next by. */
const DRIVE_LAP = 5.0;
/* Nod cycles per lap. The formation puts one monotonic traverse of the servo,
   -NOD to +NOD, at each stop, and the stops are 0.820 s apart at this rate;
   three cycles a lap is a half-nod every 0.833 s, so the modelled servo and
   the baked one agree to 1.6%. Integer, because a nod that does not close by
   the end of the lap has a kink in it once every five seconds.

   The mirror inside the drum is not turned. By the formation's own numbers it
   makes five revolutions per half-nod, which is 6.00 Hz here, and 6 Hz on a
   twelve-sided drum is 72 facet crossings a second against a 60 Hz frame --
   aliasing, drawn as a shimmer, on the one part of the station that is meant
   to read as an instrument working. The real thing hides that rotation inside
   the housing too. */
const NODS_PER_LAP = 3;

/* Where the drive is solid and where it comes apart, as fractions of the lap.
   A five-second loop cannot have a visible seam in it, and the route hands us
   an asymmetric problem: its far end is 7.29 m from the eye and 32% into the
   fog, where a 0.30 m body subtends 2.4 deg, and its near end is 0.46 m from
   the lens, 36 deg wide and 25.9 deg below the view axis against a bottom
   edge at 23.5 -- clear of the frame by two and a half degrees at rest, and
   inside it the moment the reader's pointer drops the eye.

   So the machine arrives at the far end, where a dissolve is invisible, and
   leaves by coming apart into the substrate at the near one, which is the
   same event every crossing on this page already uses. It re-forms between
   7.30 m and 6.88 m and erodes between 1.85 m and 1.02 m, which is seven
   centimetres past the first of the six stops -- so the last thing it does is
   come apart at the marker where the record it has been building takes over
   from it. It is never drawn inside a metre of the lens.

   The far end of that is no longer open corridor: the bulkhead's front face
   is 0.11 m behind the route's last sample, so what the arrival now reads as
   is the machine coming through the door, which is what a survey that started
   somewhere looks like. */
const ARRIVE = 0.06;
const LEAVE0 = 0.80, LEAVE1 = 0.92;

const ease = x => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

export function build(ctx) {
  const anchor = ctx.anchor;
  const pal = ctx.pal || {};
  const budget = (ctx.quality && ctx.quality.substrate) || 26000;

  const C = corridor(anchor);
  const { halfAt, route, cum, span, stops, edge, DOORS, ticks } = C;
  const total = span;

  /* How finely the walls follow the field. The wall is a chain of chords
     across a curve, so what this buys is sagitta: at the field's sharpest the
     face departs from it by 3.6 mm at the top tier, 8.0 mm in the middle and
     20.1 mm at the bottom, against returns carrying a centimetre of range
     noise of their own. Finer than that is only triangles. */
  const STEP = budget >= 40000 ? 0.10 : budget >= 16000 ? 0.15 : 0.24;

  const floor = anchor.y;
  const group = new THREE.Group();

  /* ── the shell ────────────────────────────────────────────────────────
     Walls, alcove backs, jambs, gantries, ledges, threshold bars, the
     bulkhead, the chamber and the floor are all one box under a matrix, so
     the whole room is a single draw whatever the tier decides its resolution
     is. Matrices are collected first because an InstancedMesh wants its count
     before it will take any of them.

     Every one of them carries an index, and the index is which entry of the
     list it belongs to. That is what the reader's own scroll drives: the
     surface material lights the instance whose index matches uFocus and lets
     the rest recede, so working down the timeline walks a light down the
     corridor bay by bay.

     What lights is punctuation, not the room. The opening and its two jambs,
     the stack of ledges, the threshold bar across the floor and the marker at
     the stop take their bay's index; the walls, the floor and the gantries
     are -1 and stay the colour they were. That split was arrived at by trying
     the other one: at 30% toward teal and 1.5 times the value, a whole bay of
     wall was a cool wash over a third of the frame and the near gantry, whose
     beam runs the full width of the picture 1.65 m from the lens, was the
     brightest thing at the station. A corridor that says which of six places
     is being read by lighting a recess and a row of ledges says it better
     than one that changes colour. */
  const AXIS = new THREE.Vector3(0, 1, 0);
  const pv = new THREE.Vector3(), pq = new THREE.Quaternion(), ps = new THREE.Vector3();
  const shell = [], shellIdx = [];
  function slab(idx, cx, cy, cz, yaw, sx, sy, sz) {
    shell.push(new THREE.Matrix4().compose(
      pv.set(cx, cy, cz), pq.setFromAxisAngle(AXIS, yaw), ps.set(sx, sy, sz)));
    shellIdx.push(idx);
  }

  /* A course laid along one wall between two Z values. `face` is where its
     inner surface sits relative to the field -- zero for the corridor itself,
     an opening's depth for the back of an alcove, minus a ledge's projection
     for a ledge -- and `thick` is how far it extends outward from there. Each
     box is laid on the chord between two samples and yawed to it, so
     consecutive faces meet on the curve instead of stepping past it, and a
     0.44 m ledge is three chords rather than one straight bar. One chord over
     that length departs from the field by 62.7 mm at its worst, against a
     ledge that only stands 0.11 m proud of it -- so a single-box ledge would
     have been half swallowed by its own wall at one end of the corridor and
     hanging off it at the other. Three chords bring that to 7.6 mm. */
  function runFace(idx, side, za, zb, face, thick, cy, sy, step) {
    const n = Math.max(1, Math.round(Math.abs(zb - za) / step));
    let x0 = anchor.x + side * (halfAt(za) + face), z0 = za;
    for (let i = 1; i <= n; i++) {
      const z1 = za + (zb - za) * (i / n);
      const x1 = anchor.x + side * (halfAt(z1) + face);
      const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz);
      // Away from the centreline, so the face stays on the field and the
      // thickness is spent outward where nothing can see it.
      const nx = side * dz / len, nz = -side * dx / len;
      slab(idx, (x0 + x1) * 0.5 + nx * thick * 0.5, cy, (z0 + z1) * 0.5 + nz * thick * 0.5,
           Math.atan2(dx, dz), thick, sy, len + LAP);
      x0 = x1; z0 = z1;
    }
  }
  const WALL_CY = floor + (WALL_H - SINK) * 0.5, WALL_SY = WALL_H + SINK;
  function runWall(side, za, zb, offset) {
    runFace(-1, side, za, zb, offset, THICK, WALL_CY, WALL_SY, STEP);
  }

  const zStart = C.termFace, zEnd = anchor.z + REACH;
  for (const side of [-1, 1]) {
    // Cut at the opening edges rather than near them: a segment boundary
    // landing half a step inside an opening leaves a stub across the gap. The
    // last box before an edge still overruns it by its own thickness across
    // the slope. Trimming it back instead leaves a notch, and a notch lets a
    // beam through a wall, where a nub only stops one a few centimetres early.
    const cuts = [];
    for (const d of DOORS) if (d.side === side) cuts.push(d);
    cuts.sort((a, b) => a.z - b.z);
    let z = zStart;
    for (const d of cuts) {
      const a = d.z - d.half, b = d.z + d.half;
      runWall(side, z, a, 0);
      // The back of the alcove, which undulates with the same field because
      // that is how the raycast reads it, and carries the bay's index because
      // a lit recess is the clearest thing a corridor can do to say which of
      // six places is being read.
      runFace(d.bay, side, a, b, d.depth, THICK, WALL_CY, WALL_SY, STEP);
      // The two jambs, each one face of the gap, carried out to the back so
      // an alcove is a box with a mouth and not two walls with a hole between.
      // A jamb is square to Z while the wall it lands on is not, so it starts
      // from the widest the corridor gets under its own thickness. Taken from
      // the edge's own value it stood eight centimetres proud of the wall at
      // the steepest opening -- inside the corridor, across the mouth, which
      // is the one place at this station anybody is looking.
      for (const e of [a, b]) {
        const out = e === a ? -1 : 1;
        const inner = Math.max(halfAt(e), halfAt(e + out * THICK * 0.5),
                               halfAt(e + out * THICK));
        slab(d.bay, anchor.x + side * (inner + (d.depth + THICK) * 0.5),
             WALL_CY, e + out * THICK * 0.5, 0,
             d.depth + THICK, WALL_SY, THICK);
      }
      z = b;
    }
    runWall(side, z, zEnd, 0);
  }

  /* The five gantries. A leg on each wall, floor to head, and a beam across
     the corridor between them. */
  for (let k = 1; k < STOPS; k++) {
    const z = edge[k], h = halfAt(z);
    /* And they are -1, so the focus never touches them. The first of the five
       stands 1.65 m from the lens and its beam runs the full width of the
       frame; lit at the half-strength an edge between two bays would get, it
       was a teal band across the top of the picture and the brightest thing
       at the station by a distance. A gantry is read by its shape from
       anywhere in the corridor and does not need telling apart. */
    for (const side of [-1, 1])
      runFace(-1, side, z - C.PIER_W * 0.5, z + C.PIER_W * 0.5,
              -C.PIER_D, C.PIER_D + PIER_T,
              floor + (GANT_TOP - SINK) * 0.5, GANT_TOP + SINK, C.PIER_W);
    // 0.025 short of the leg's own outer face at each end rather than flush
    // with it: two coplanar faces at the same depth flicker, and the field
    // moves the wall by up to 0.068 m over the 0.20 m a leg occupies, so
    // "flush" is not a thing that can be built here anyway. Either the leg or
    // the wall behind it swallows the end at every one of the five.
    slab(-1, anchor.x, floor + (SOFFIT + GANT_TOP) * 0.5, z, 0,
         (h + PIER_T - 0.025) * 2, GANT_TOP - SOFFIT, C.PIER_W);
    /* And a bar across the floor under it. The floor is the brightest surface
       in the room -- its normal is 0.78 onto the key against 0.42 for the
       wall the light is falling on and 0 for the other one -- so a 14 mm step
       is the cheapest legible mark at this station, and putting one at each
       threshold lands the count on the one plane that stays in frame from an
       eye 0.70 m up. This one does take its bay's index, at the half value an
       edge between two of them gets. */
    // Set into the floor by the same SINK the walls are, for the same
    // reason: a bar sitting exactly on the slab has its underside coplanar
    // with the slab's top, and this material is double-sided.
    slab(k - 0.5, anchor.x, floor + (BAR_H - SINK) * 0.5, z, 0,
         (h + 0.03) * 2, BAR_H + SINK, BAR_W);
  }

  /* The tally. One stack of ledges per bay, on the wall opposite that bay's
     opening, one ledge per calendar year the entry names -- the formation
     owns that count and where each ledge goes; this only builds them. */
  for (const t of ticks)
    runFace(t.bay, t.side, t.z0, t.z1, -C.TICK_D, C.TICK_D + PIER_T,
            floor + t.y, C.TICK_H, C.TICK_L / 3);

  /* The bulkhead, in three pieces around the doorway, carried out to the full
     width of the room behind so it is that room's front wall as well as this
     corridor's end. */
  {
    const zc = C.termFace - C.TERM_T * 0.5, W = C.CHAMBER_HALF + CHAMBER_T;
    const dl = C.doorX - C.DOOR_HALF, dr = C.doorX + C.DOOR_HALF;
    slab(STOPS - 1, (anchor.x - W + dl) * 0.5, floor + (TERM_H - SINK) * 0.5, zc, 0,
         dl - (anchor.x - W), TERM_H + SINK, C.TERM_T);
    slab(STOPS - 1, (dr + anchor.x + W) * 0.5, floor + (TERM_H - SINK) * 0.5, zc, 0,
         anchor.x + W - dr, TERM_H + SINK, C.TERM_T);
    slab(STOPS - 1, C.doorX, floor + (DOOR_H + TERM_H) * 0.5, zc, 0,
         C.DOOR_HALF * 2, TERM_H - DOOR_H, C.TERM_T);
  }

  /* The room behind it. Two sides, a back, the deck it is raised on, and one
     ledge across the back at the gantries' own soffit height, so the datum
     the corridor is ruled to carries into the room. The deck runs right up to
     the bulkhead, which puts its riser in the mouth of the door: the one
     upward-facing edge at the far end, and the only thing out there lit at
     the angle the floor is. */
  {
    const zf = C.termFace - C.TERM_T, zb = zf - C.CHAMBER_D;
    const cy = floor + (CHAMBER_H - SINK) * 0.5, sy = CHAMBER_H + SINK;
    // Run 0.03 into the bulkhead in front and the back wall behind, so the
    // two joins are overlaps rather than four coplanar faces meeting at the
    // same depth.
    for (const side of [-1, 1])
      slab(STOPS - 1, anchor.x + side * (C.CHAMBER_HALF + CHAMBER_T * 0.5), cy,
           (zf + zb) * 0.5, 0, CHAMBER_T, sy, C.CHAMBER_D + 0.06);
    slab(STOPS - 1, anchor.x, cy, zb - CHAMBER_T * 0.5, 0,
         (C.CHAMBER_HALF + CHAMBER_T) * 2, sy, CHAMBER_T);
    slab(STOPS - 1, anchor.x, floor + C.CHAMBER_RISE - DECK_T * 0.5,
         (zf + zb) * 0.5, 0, C.CHAMBER_HALF * 2, DECK_T, C.CHAMBER_D);
    slab(STOPS - 1, anchor.x, floor + LEDGE_Y, zb + LEDGE_D * 0.5 - 0.03, 0,
         (C.CHAMBER_HALF + 0.03) * 2, LEDGE_H, LEDGE_D + 0.06);
  }

  /* One slab, because the ruling in the surface shader is world space and
     draws the floor's grid for free -- modelled tiles would be geometry
     saying what the shader is already saying. Wide enough to run out under
     the deepest alcove and back under the far room, since a beam through an
     opening drops onto that floor the same as it does in the corridor. */
  let widest = 0, deepest = 0;
  for (let i = 0; i < C.NZ; i++) if (C.wall[i] > widest) widest = C.wall[i];
  for (const d of DOORS) if (d.depth > deepest) deepest = d.depth;
  const wide = Math.max(widest + deepest + THICK + 0.08, C.CHAMBER_HALF + CHAMBER_T + 0.08);
  const zBack = C.termFace - C.TERM_T - C.CHAMBER_D - CHAMBER_T - 0.10;
  slab(-1, anchor.x, floor - FLOOR_T * 0.5, (zEnd + zBack) * 0.5, 0,
       wide * 2, FLOOR_T, zEnd - zBack);

  /* Seeds, not indices, are what move the dissolve field per instance, so the
     room does not come apart in one sheet. */
  const jr = rng(0x5f3c21);
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  seedSurface(boxGeo, shell.length, () => jr());
  boxGeo.getAttribute("aIndex").array.set(shellIdx);

  const shellMat = makeSurface({
    base: "#b9bdc7", accent: pal["--landing-accent"], teal: pal["--landing-teal"],
    fog: pal["--landing-bg"]
  });
  /* The material's defaults are for a machine part held at arm's length. This
     is a room: the ruling wants to fall at the scale of floor panels rather
     than millwork, and the fog has to carry seven metres of corridor.

     2.2 to 15.0 is unchanged and the reason for it is not. It was sized to
     make an open end disappear before the reader could see it stop -- the
     wall used to run 8.4 m past the anchor in both directions and had to be
     gone by twelve. Nothing is further off than 9.19 m now, so there is no
     edge left to hide and the range is doing the other job it was always also
     doing: aerial perspective between one bay and the next. Measured along
     the five gantries and the far end, it takes 0.000, 0.007, 0.048, 0.117,
     0.206, 0.319 at the bulkhead and 0.524 at the back wall of the room
     behind it -- a ramp with something on every rung of it, which is what a
     corridor needs and what a corridor ending in nothing could not use.
     Pushing uFogFar out to 19 was worked through and not taken. It would drop
     the back wall from 0.52 fogged to 0.34, which is 31.6 to 48.1 of 255
     through this material and this grade -- except that the back wall is not
     in the clear frame. It sits at the vanishing point, which is behind the
     reading column, and the column passes 18%: three values. Three values,
     paid for by flattening every rung of the ramp above it. */
  shellMat.userData.uniforms.uPitch.value = 3.0;
  shellMat.userData.uniforms.uGrid.value = 0.065;
  shellMat.userData.uniforms.uFogNear.value = 2.2;
  shellMat.userData.uniforms.uFogFar.value = 15.0;

  const shellMesh = new THREE.InstancedMesh(boxGeo, shellMat, shell.length);
  for (let i = 0; i < shell.length; i++) shellMesh.setMatrixAt(i, shell[i]);
  shellMesh.instanceMatrix.needsUpdate = true;
  shellMesh.computeBoundingSphere();
  group.add(shellMesh);

  /* ── the six stops ────────────────────────────────────────────────────
     Where the scanner stood, which is not evenly spaced in Z: the formation
     spaces its stations by metres driven along a route that wanders, so it
     hands them over with the tangent each pose was built from, and a marker
     faces the way the drive was going. */
  const markGeo = new THREE.CylinderGeometry(
    PLINTH_W * BATTER * Math.SQRT1_2, PLINTH_W * Math.SQRT1_2,
    PLINTH_H + SINK, 4, 1, false, Math.PI * 0.25);
  seedSurface(markGeo, STOPS, () => jr());

  const markMat = makeSurface({
    base: "#c6cad3", accent: pal["--landing-accent"], teal: pal["--landing-teal"],
    fog: pal["--landing-bg"]
  });
  // A quarter-metre object ruled at the wall's pitch gets one line across it
  // and reads as a smudge; the fog is the shell's, because they are in it.
  markMat.userData.uniforms.uPitch.value = 9.0;
  markMat.userData.uniforms.uFogNear.value = 2.2;
  markMat.userData.uniforms.uFogFar.value = 15.0;

  // Four sides and a batter: a frustum, so the markers carry a different
  // silhouette from the walls without costing more than a box. The quarter
  // turn puts a face across the route rather than a corner.
  const markMesh = new THREE.InstancedMesh(markGeo, markMat, STOPS);
  for (let k = 0; k < STOPS; k++) {
    const o = stops[k].o, f = stops[k].fwd;
    markMesh.setMatrixAt(k, new THREE.Matrix4().compose(
      pv.set(o.x, floor + (PLINTH_H - SINK) * 0.5, o.z),
      pq.setFromAxisAngle(AXIS, Math.atan2(f.x, f.z)), ps.set(1, 1, 1)));
  }
  markMesh.instanceMatrix.needsUpdate = true;
  markMesh.computeBoundingSphere();
  group.add(markMesh);

  /* ── the drive ────────────────────────────────────────────────────────
     Everything above this line is where the survey happened. None of it can
     move: the reader's own camera is flying down this corridor, and a room
     that slides while the eye slides is a treadmill, not a corridor. What was
     missing is the thing the room is evidence of, so it is added here and it
     is the only part of the station that moves.

     Five instances over two geometries. Rewritten every frame, which for five
     matrices is nothing next to the 4277 returns the formation bakes once --
     the reason nothing here moved before was never cost. */
  const bodyGeo = new THREE.BoxGeometry(1, 1, 1);
  seedSurface(bodyGeo, 4, () => jr());
  // A rail is not one of the six entries being read, so -1 keeps the focus
  // channel from ever lighting a piece of the machine.
  bodyGeo.getAttribute("aIndex").array.fill(-1);
  const headGeo = new THREE.CylinderGeometry(HEAD_R, HEAD_R, HEAD_H, 12);
  seedSurface(headGeo, 1, () => jr());
  headGeo.getAttribute("aIndex").array.fill(-1);

  /* Lighter than the walls it drives between and lighter than the markers,
     because it is the only thing here that is not the building. Still the
     same grey family -- the accent and the teal are the page's and are spent
     on the rim and the focus, not on painting a robot a different colour. */
  const driveMat = makeSurface({
    base: "#ccd0d8", accent: pal["--landing-accent"], teal: pal["--landing-teal"],
    fog: pal["--landing-bg"]
  });
  // Finer than the marker's, which is finer than the wall's, for the same
  // reason each time: the ruling is in world space, so the smaller the object
  // the fewer lines land on it. At the wall's 3.0 the whole machine gets one.
  driveMat.userData.uniforms.uPitch.value = 14.0;
  driveMat.userData.uniforms.uFogNear.value = 2.2;
  driveMat.userData.uniforms.uFogFar.value = 15.0;

  const bodyMesh = new THREE.InstancedMesh(bodyGeo, driveMat, 4);
  const headMesh = new THREE.InstancedMesh(headGeo, driveMat, 1);
  /* Not culled. An InstancedMesh takes its bounding sphere from the matrices
     it held when it was asked, and these are different every frame, so the
     sphere would be a claim about where the machine was five seconds ago --
     which for an object drawn over 6.00 m of route is how it ends up
     vanishing while it is still on screen. Two objects, so the frustum test
     it skips is not worth recomputing a sphere for. */
  bodyMesh.frustumCulled = false;
  headMesh.frustumCulled = false;
  group.add(bodyMesh);
  group.add(headMesh);

  /* Scratch. A Matrix4 allocated inside the frame loop is a collection every
     few seconds, and a collection is a frame the reader can see. */
  const dPos = new THREE.Vector3(), dFwd = new THREE.Vector3();
  const dAt = new THREE.Vector3(), dScale = new THREE.Vector3();
  const dYaw = new THREE.Quaternion(), dNod = new THREE.Quaternion();
  const dHead = new THREE.Quaternion(), dMat = new THREE.Matrix4();

  /* Where the machine is at `u` of the way along the route, by arc length --
     the same walk the six stops were placed with, so the drive passes a
     marker at the moment the formation's schedule sweeps it. One sample a
     frame, so the linear walk the formation could not afford per point costs
     nothing here. */
  function driveAt(u) {
    const s = u * total;
    let i = 1;
    while (i < route.length - 1 && cum[i] < s) i++;
    const f = (s - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1]);
    dPos.copy(route[i - 1]).lerp(route[i], f);
    /* The tangent the poses were built from, reversed, because this runs the
       route from its far end back toward the eye. Flattened to the floor
       plane: the route's rise and fall is the scanner's ride height and not a
       ramp -- it swings 126 mm over the drive and pitches by up to 4.49 deg
       at its steepest -- and carrying that into the body would tip a base
       standing on a slab that is dead flat. The mast absorbs it instead. */
    dFwd.copy(route[Math.max(0, i - 2)]).sub(route[Math.min(route.length - 1, i + 1)]);
    dFwd.y = 0;
    dFwd.normalize();
  }

  /* Rails, deck, mast, drum, from one position and one heading. Split out of
     update so the machine is standing somewhere real before the first frame:
     an InstancedMesh starts on identity matrices, and four unit cubes at the
     world origin is a metre of white block in the middle of the page. */
  function place(phase) {
    driveAt(1 - phase);
    dYaw.setFromAxisAngle(AXIS, Math.atan2(dFwd.x, dFwd.z));
    // Across the heading, for the two rails.
    const off = (BODY_W - RAIL_W) * 0.5;
    const ax = dFwd.z * off, az = -dFwd.x * off;
    dMat.compose(dAt.set(dPos.x + ax, floor + RAIL_H * 0.5, dPos.z + az),
                 dYaw, dScale.set(RAIL_W, RAIL_H, RAIL_L));
    bodyMesh.setMatrixAt(0, dMat);
    dMat.compose(dAt.set(dPos.x - ax, floor + RAIL_H * 0.5, dPos.z - az),
                 dYaw, dScale.set(RAIL_W, RAIL_H, RAIL_L));
    bodyMesh.setMatrixAt(1, dMat);
    dMat.compose(dAt.set(dPos.x, floor + RAIL_H + BODY_H * 0.5, dPos.z),
                 dYaw, dScale.set(BODY_W, BODY_H, BODY_L));
    bodyMesh.setMatrixAt(2, dMat);

    /* The mast is scaled rather than placed, and it is what makes the ride
       height honest: the head sits at the route's own y, which is the height
       the formation fired its beams from, and the deck sits on a flat floor,
       so the column between them is 0.156 m at the low point of the drive and
       0.281 m at the high one. Carried up to the drum's centre rather than to
       its underside, so the joint is always buried in the drum and no nod
       angle can open a hairline between them. */
    const mast = dPos.y - floor - DECK_TOP;
    dMat.compose(dAt.set(dPos.x, floor + DECK_TOP + mast * 0.5, dPos.z),
                 dYaw, dScale.set(MAST_W, mast, MAST_W));
    bodyMesh.setMatrixAt(3, dMat);

    /* And the nod. About the heading, not across it -- "nod" is the servo's
       word and not a description of the axis: the formation rolls its scan
       plane about the forward direction, so a beam pointing straight down the
       corridor does not move at all and one pointing at a wall sweeps the
       full height of it. Rocking the head fore and aft instead would put the
       returns on the floor and the ceiling of the corridor ahead, where this
       station has none. */
    dNod.setFromAxisAngle(dFwd, NOD * Math.sin(phase * NODS_PER_LAP * Math.PI * 2));
    dHead.copy(dYaw).premultiply(dNod);
    dMat.compose(dAt.set(dPos.x, dPos.y, dPos.z), dHead, dScale.set(1, 1, 1));
    headMesh.setMatrixAt(0, dMat);

    bodyMesh.instanceMatrix.needsUpdate = true;
    headMesh.instanceMatrix.needsUpdate = true;
  }
  place(0);
  // Matching the pose it was just placed in: at phase 0 the machine is at the
  // far end of the route and has not arrived yet, and a material left at the
  // default 0 would draw it whole there for the frame before the first update.
  driveMat.userData.uniforms.uCut.value = 1;

  const mats = [shellMat, markMat, driveMat];
  // The drive's own place in the lap, kept only for the caller that sends no
  // `run` of its own.
  let phase = 0;

  return {
    group,
    update({ t, dt, run, cut, focus, local, charge }) {
      /* Which of the six entries is being read. The caller derives it from
         how far into the section the reader has got and hands it over in
         0..5; `local` is only the fallback for a caller that sends none.

         Worth knowing before tuning anything against it: staged, a reader who
         scrolls this section to the bottom gets to 2.72 of 5, not to 5. The
         station's band runs to the end of the flight out of it while its
         settle window stops at 55% of that, so the last 45% of the focus
         range is spent crossing to Contact -- measured on the journey probe,
         p goes 0.7135 to 0.7921 against a band of 0.7143 to 0.8571, and the
         settle window's own end, 0.7929, is 2.75. Bays 0 to 2 therefore light
         while the timeline is being read, and 3 to 5 light on the way out,
         over the room's own dissolve.

         That is the caller's contract and not this file's to change, but it
         is worth knowing which bays are which: 3 and 4 carry eleven of the
         seventeen ledges between them and 5 carries the bulkhead and the room
         behind it, so what lights during the exit is the densest half of the
         corridor going out with it. */
      const f = focus >= 0 ? focus
              : typeof local === "number" ? local * (STOPS - 1) : -1;
      for (let i = 0; i < mats.length; i++) {
        const u = mats[i].userData.uniforms;
        u.uTime.value = t;
        u.uCut.value = cut;
        u.uFocus.value = f;
        u.uCharge.value = charge || 0;
      }

      /* `run` and not a clock of this station's own, and that is the whole
         point of it existing. It is the same 0..1 the formation's travelling
         band is drawn against, so the machine and the light on the route it
         is driving cannot drift apart -- give the drive its own timer and the
         two agree once a lap and disagree the rest of the time, which is
         worse than neither of them moving. It is integrated from dt upstream,
         so it is frame-rate independent rather than assuming 60 of anything,
         and it slows to a quarter rate while the station is being dissolved,
         which is exactly when a machine driving at full speed through a room
         coming apart around it would look wrong. dt is what carries the drive
         for a caller that sends no run at all. */
      phase = typeof run === "number" ? run
            : (phase + (dt || 0) / DRIVE_LAP) % 1;
      /* 1 - phase: the route is stored from the near end outward and the
         drive runs the other way. 6.98 m of route in a five-second lap is
         1.40 m/s, which is what one of these actually surveys at. */
      place(phase);

      /* Arriving and leaving. Both ends of the lap are the same instant --
         the machine cannot be at the far end and the near end at once -- so
         one of them has to be a dissolve or the loop has a cut in it. Taken
         against the station's own erosion rather than added to it: whichever
         is further along wins, so scrolling away mid-drive still takes the
         machine apart with the room rather than fighting it. */
      const seam = Math.max(1 - ease(phase / ARRIVE),
                            ease((phase - LEAVE0) / (LEAVE1 - LEAVE0)));
      driveMat.userData.uniforms.uCut.value = Math.max(cut, seam);
    },
    dispose() {
      group.clear();
      boxGeo.dispose();
      markGeo.dispose();
      bodyGeo.dispose();
      headGeo.dispose();
      shellMat.dispose();
      markMat.dispose();
      driveMat.dispose();
    }
  };
}
