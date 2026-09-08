/* Station 01, solid: the workcell the manipulator is standing in.
 *
 * The arm was correct and alone. Measured kinematics, four waypoints, a
 * fourteen-second ping-pong, lit and articulated -- and nothing under it,
 * nothing in front of it and nothing for it to be doing. Every other station
 * on this page is a place: an occupancy grid, a corridor, a benchmark rig.
 * The first one was an object in a void, which is a 3D asset rather than a
 * photograph of work, and it is the one that has to carry the page.
 *
 * So this is the cell. A deck the machine is bolted to at the height its own
 * base plate actually sits at, an infeed the tool actually reaches, a nest
 * the tool actually descends into, stock, and a tote the finished parts
 * actually land in. Not one of those positions was chosen: every one of them
 * is solved out of world/kinematics.js. The infeed's channel floor is where
 * it is because the tool comes to rest 0.2771 above the deck at waypoint 0;
 * the nest tops are 8.3 mm lower than that because waypoint 2 is 8.3 mm
 * lower than waypoint 0. Move a waypoint and the cell moves with it, because
 * nothing here is written down as a height -- it is written down as an offset
 * from a tool point.
 *
 * Which settles the only question a workcell can get wrong. A fixture the arm
 * visibly misses is worse than no fixture at all, because a reader who knows
 * what a robot is will see the miss before they see anything else. The tool
 * axis is within 1.765 degrees of straight down at every one of 401 samples
 * of the move, the tool's own x never exceeds 0.3755, and its z runs from
 * +0.4944 to -0.2941. That is a gripper coming vertically down onto two
 * points 0.826 apart, which is a load and an unload, and this file is the two
 * stations it is loading and unloading.
 *
 * It runs off the arm's clock and no other. world/world.js advances the arm
 * with `armPhase = (armPhase + dt / 14) % 2` out of the same accumulated `t`
 * this update is handed, so the phase is recovered here as `(t / 14) % 2`
 * rather than accumulated again. Derived and not accumulated on purpose: this
 * solid is only updated while it is the live station, so an accumulator would
 * fall behind by however long the reader spent at the benchmarks and the part
 * in the gripper would come back to the hero hanging in mid-air next to it.
 *
 * Three draw calls: the deck, the tooling, the stock. Everything except the
 * deck is one instanced box or one instanced cylinder, which is what keeps a
 * cell of thirty-odd separate pieces of hardware inside the budget the rest
 * of the page runs on.
 */
import * as THREE from "three";
import { makeSurface, seedSurface } from "../materials/surface.js";
import { linkFrames, toolPoint, poseAt } from "../kinematics.js";

/* ── mirrored from world/world.js ────────────────────────────────────────
   Where the machine stands and how long its move takes. Both belong to that
   file and neither is exported from it, so they are copied here and the copy
   is checkable rather than hopeful: the base is the translation its arm Group
   is given, and the cycle is the constant its ping-pong is divided by. The
   caller passes `arm` when it has one and these are what stand in when it
   does not -- a station whose solid refuses to build because a mesh fetch
   failed is worse than a cell around a machine that is only a point cloud. */
const ARM_BASE = new THREE.Vector3(1.15, -0.55, -0.15);
const ARM_CYCLE = 14;

/* ── the part ────────────────────────────────────────────────────────────
   Turned bar stock, 52 across and 90 long, and it is the only round family in
   a cell that is otherwise entirely rectilinear -- which is most of what
   makes it read as the thing being handled rather than as another bracket. At
   the infeed it stands 1.848 from the eye where a 953-pixel frame is 672
   pixels to the metre, so it is 35 px across and 60 tall; at the nest it is
   2.626 away, 473 px to the metre, 25 across and 43 tall. Above the size at
   which a cylinder has to be argued for and below the size at which it starts
   competing with the wrist above it.

   GRIP is how far the tool point sits below the top of a part it is holding.
   A two-finger gripper closes on the top land of a billet and the tool point
   is the fingertip plane, so this is the one number in the file that is a
   claim about a gripper rather than about the arm -- 14 mm, which is a
   quarter of the part's diameter and about where a finger pad would sit. It
   is also the number that puts every work surface in this cell where it is:
   a resting part's top is at (tool point) + GRIP and its base is BILLET_H
   below that, and what the part is standing on starts there. */
const BILLET_R = 0.026, BILLET_H = 0.090;
const GRIP = 0.014;

/* Pitch of both tracks. Two and a quarter diameters, which leaves 66 mm of
   air between neighbours -- enough for a pair of fingers to come down between
   two parts without the neighbour being what they close on, and it is that
   clearance rather than tidiness that sets it. At the infeed one pitch is 79
   pixels and at the outfeed 56, so a step reads as a step at both ends. */
const PITCH = 0.118;

/* ── the deck ────────────────────────────────────────────────────────────
   Thickness of the machined pad the arm is bolted to, and so, by subtraction,
   where the deck's top face is: the base plate is at y = -0.55 and cannot
   move, so the deck is that much below it. Written this way round because the
   alternative -- a deck height and a pad thickness chosen independently -- is
   two numbers that have to agree and one day will not, and the failure is a
   robot floating a centimetre above the surface it is bolted to.

   30 mm is 14 px at the 462 px to the metre the pad is seen at, which is
   enough for the riser to have a lit edge of its own; at 15 it was a seam. */
const PAD_T = 0.030;
const PAD_W = 0.34;            // 340 square: a UR12e's own flange is 190, so
                               // this reads as a riser bolted to a deck rather
                               // than as the robot's own casting
const BOLT = 0.026, BOLT_H = 0.010;

/* The deck itself, as offsets from the anchor. Not a bench -- a cell base
   frame, which is what a machine this size is actually integrated onto, and
   the footprint is set by the frame rather than by the catalogue.

   The near edge is the one number with a hard constraint on it. At this
   station's eye -- 0.069 above the anchor, pitched 4.5 degrees down through a
   42 degree lens -- the bottom of the frame crosses the deck plane at z =
   1.034 dead centre and 0.916 to 1.151 at the two corners. So a near edge at
   1.46 is 0.31 nearer than the frame can see at the tightest corner, and it
   stays out of shot when the pointer drops the eye its full 0.15, which moves
   that crossing out to 1.328. What the reader gets is a work surface that
   runs off the bottom of the frame instead of a slab floating in the middle
   of it, which is the entire difference between standing at a bench and
   looking at a photograph of one.

   The far edge is the composition. At 3.29 it projects to y = -0.29 in NDC,
   a horizontal a third of the way up the frame that passes directly behind
   the wrist, and the arm is finally standing against something. Further back
   than that and the deck is a floor; nearer and the machine overhangs it.

   Nothing is built below the deck. A cell frame has legs, and from an eye
   0.62 above a top face 2.45 by 2.32 not one of them is ever visible: the
   only faces of a closed box this camera can see are the top and the near
   one, and the near one is the edge that was deliberately pushed out of
   frame. Legs would be 20 instances drawn for nobody. */
const DECK_X0 = -0.40, DECK_X1 = 2.05;
const DECK_Z0 = -0.86, DECK_Z1 = 1.46;
const DECK_T = 0.055;

/* ── the infeed ──────────────────────────────────────────────────────────
   A guided channel with a stop at the pick end and a magazine housing at the
   other. The queue steps one pitch toward the stop each cycle and the stock
   is replenished from under the housing.

   The direction is not a preference. The tool's x never exceeds 0.3755 over
   the whole move, so a queue that extends in +x from the pick position is a
   queue the arm cannot reach any part of except the one it is there for --
   the nearest the kinematic chain comes to a billet on this track is 0.258
   above it, at the pose the move starts from. A queue running the other way
   would have the forearm passing over five parts to reach the sixth.

   It also puts the queue in the clear. The reading column is opaque to x =
   -0.09 in NDC at this window; the pick position lands at +0.02 and the sixth
   slot at +0.43, so the magazine runs out of the type and into the open,
   which is the direction a feed should read in.

   The housing exists to hide a fact about the arithmetic rather than to
   decorate. Slots are drawn at PICK_X + (k + 1 - f) * PITCH for k = 0..7,
   with f the index progress, so at f = 0 the eight instances occupy slots 1
   through 8 -- the pick position empty, because a part has just been lifted
   out of it -- and at f = 1 they occupy 0 through 7. The set of occupied
   positions therefore changes by exactly two things across the reset at the
   top of a cycle: the pick slot is vacated, which the reader watches happen,
   and slot 8 is filled, which happens at x = 1.320. The housing spans 1.02 to
   1.38 and stands 0.174 above the channel, so slots 6, 7 and 8 are inside it
   and a part arriving is a part arriving from inside a machine. Checked by
   ray rather than assumed: the sight line from the eye to the top of a billet
   at slot 8 enters the housing through its near face 22 mm below the roof
   line at the tightest of the three. */
const FEED_SLOTS = 8;
const CHAN_T = 0.026;          // the bed the parts slide on
const RAIL_W = 0.013, RAIL_H = 0.048;   // guides, 32 px tall at this standoff:
                                        // half the part's height, which is
                                        // what a channel looks like
const STOP_W = 0.026;
const HOUSE_X0 = 1.02, HOUSE_X1 = 1.38, HOUSE_HZ = 0.088, HOUSE_H = 0.174;
const FEED_HZ = 0.062;         // half-depth of the bed
const POST = 0.055;            // section of the posts under both tracks

/* ── the outfeed ─────────────────────────────────────────────────────────
   Five nests on a walking beam. A part is set into nest 0 by the arm, the
   beam lifts the whole row 14 mm, steps it one pitch and sets it down, and
   the part that was in nest 4 goes over the end and into the tote.

   Five and not more because of where the tote can stand. The arm's base
   column occupies x = 1.055 to 1.245, so nothing may be built past 1.03 at
   this depth; a tote 0.28 wide centred at 0.795 has its far wall at 0.935 and
   clears that by 0.12, and the drop point five pitches out from the nest is
   at 0.719, which is 76 mm inside the near wall. A sixth nest would have put
   the drop in the machine.

   The step runs while the tool is at the far end of its retract. The tool
   passes over this track twice a cycle -- the move is played out and back, so
   the return is the outbound reversed -- and it never rises more than 8 mm
   over the whole move, so there is no height at which the row could step
   under it. What there is instead is z: at phase 1.0 the tool stands 0.2714
   from the track line, and across the whole of the window it is never nearer
   than 0.1954, against parts that are 0.026 in radius. The window is a
   quarter of the cycle, 3.36 s for one 118 mm step, which is 35 mm/s and 17
   pixels a second on screen -- slow enough to be read as a mechanism
   indexing rather than as something being animated. */
const NESTS = 5;
const NEST_W = 0.088, NEST_T = 0.022;   // saddle, 10 px thick at 473 px to the
                                        // metre: a shadow line under a part
const BEAM_T = 0.026, BEAM_HZ = 0.065;
const LIFT = 0.014;            // 6.6 px of walking beam. Small, and the point
                               // of it is that the row does not scrape

/* The two totes. One under the end of the outfeed for what the cell has
   finished, one in the near right corner of the deck for the raw stock the
   magazine is loaded from -- which is the only thing standing in the bottom
   right of this frame and is there as much for that as for the fiction.
   0.155 deep, 71 px, and a part standing on the floor of one has its top 53
   mm below the rim, so the tote hides what is in it from this eye and the
   instant a part is recycled out of the cycle is an instant nobody can see. */
const TOTE_W = 0.28, TOTE_D = 0.22, TOTE_H = 0.155, TOTE_WALL = 0.012;
const TOTE_B = new THREE.Vector3(1.34, 0, 0.58);   // the stock tote, on the deck

/* The controller. A UR control box is 475 by 423 by 268 and it is the one
   piece of this cell whose dimensions are somebody else's; it stands behind
   and to the right of the machine because that is the only part of the frame
   with nothing in it -- the deck's far right corner projects to x = 0.58 in
   NDC and the reading column ends at -0.09, so without this the right third
   of the shot is deck and then nothing. The kinematic chain never enters its
   footprint at any pose: the furthest any joint origin travels in x is
   0.9766, and this starts at 1.42. */
const BOX_W = 0.475, BOX_D = 0.423, BOX_H = 0.268;
const BOX_X = 1.42, BOX_Z = -0.72;

/* ── the cycle, in units of the arm's own phase ──────────────────────────
   The arm's phase runs 0 to 2 and folds at 1, so waypoint 0 is at phase 0 and
   2, the low waypoint is at 2/3 and 4/3, and the last waypoint is at 1. The
   tool's speed through both work points is under a millimetre a second --
   the waypoints are smoothstepped, so the machine arrives at rest -- which is
   why a transfer can happen at an instant here without reading as a snatch.

   The two index windows are placed where the tool is furthest from the track
   being indexed: 0.400 of clearance in z across the whole of the infeed's
   window and 0.195 across the outfeed's. Neither is a phase somebody liked
   the look of. */
const PLACE = 2 / 3;
const FEED_W0 = 0.42, FEED_W1 = 0.58;
const NEST_W0 = 0.88, NEST_W1 = 1.12;

const ease = x => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/* Where the finished part starts falling, as a fraction of the outfeed's
   step. At 0.42 the billet is still straddling the tote's near wall when it
   lets go; at 0.55 its near face has cleared the wall by 2 mm and it is
   0.077 above it, so it goes over the edge rather than through it. */
const DROP0 = 0.55;

export function build(ctx) {
  const anchor = ctx.anchor || new THREE.Vector3();
  const pal = ctx.pal || {};
  const arm = ctx.arm;
  const base = (arm && arm.base) || ARM_BASE;
  const upright = (arm && arm.upright) || new THREE.Matrix4();
  /* Whether the machine this cell is built around is actually moving. At the
     tier with no GPU for the arm's 21,010 triangles world.js never advances
     the pose, so the shell in the cloud stands at waypoint 0 forever -- and a
     cell indexing underneath a machine that is not moving is worse than a
     cell that is not indexing, because it says the two are unrelated. */
  const running = !arm || arm.solid !== false;

  const tier = (ctx.quality && ctx.quality.substrate) || 34000;
  /* The only segment count in the file. A billet is 35 px across at the
     infeed, where 16 sides hold it within a fifth of a pixel of a circle and
     10 within half of one; 8 leaves it a pixel and a half out of round, and 8
     goes to the tier that is already drawing at one device pixel per CSS
     pixel. */
  const SIDES = tier >= 60000 ? 16 : tier >= 26000 ? 10 : 8;

  /* ── the two work points ───────────────────────────────────────────────
     Solved, not written. Everything below is an offset from one of these. */
  const q = new Array(6);
  const frames = Array.from({ length: 6 }, () => new THREE.Matrix4());
  const tool = (u, out) => {
    poseAt(u, q);
    linkFrames(q, frames);
    return toolPoint(frames, out).applyMatrix4(upright).add(base);
  };
  const PICK = tool(0, new THREE.Vector3());        // 0.3755, -0.2771,  0.4944
  const LOAD = tool(PLACE, new THREE.Vector3());    // 0.1287, -0.2854, -0.2941

  const DECK_Y = base.y - PAD_T;                    // -0.580
  const FEED_Y = PICK.y + GRIP - BILLET_H;          // -0.3531, the channel floor
  const NEST_Y = LOAD.y + GRIP - BILLET_H;          // -0.3614, the saddle tops
  const BILLET_MID = BILLET_H * 0.5;

  const ax = anchor.x, ay = anchor.y, az = anchor.z;

  const group = new THREE.Group();
  /* Built in world coordinates, like the formation it has to agree with and
     like the arm it has to be bolted to, so the group is an identity that
     never changes -- which is also what lets the material's world-space
     ruling land on the hardware instead of sliding over it. */
  group.matrixAutoUpdate = false;

  /* ── materials ─────────────────────────────────────────────────────────
     Three, and the split is what the draw calls are. The greys are values of
     the same machined grey the rest of the page's solids are made of rather
     than colours of their own; the accent, the teal and the fog come from the
     stylesheet through ctx.pal and nothing else here is coloured at all. */
  const STEEL = "#c9ccd4";

  const skin = (base_, opts) => {
    const m = makeSurface({
      base: base_, accent: pal["--landing-accent"],
      teal: pal["--landing-teal"], fog: pal["--landing-bg"],
      instanced: opts && opts.instanced !== undefined ? opts.instanced : true
    });
    const u = m.userData.uniforms;
    /* The fog window is the only depth cue a scene this shallow has. The cell
       runs from 1.85 at the infeed to 3.70 at the deck's far right corner, so
       the material's own 3-to-26 leaves every part of it at the same depth as
       every other part and the cabinet comes out flush with the stock. From
       2.2 to 6.4 the infeed is untouched, the nest is 3% gone, the cabinet
       15% and the deck's far corner 29% -- a ramp that puts the far end of
       the deck into the page's own background without ever reaching it. */
    u.uFogNear.value = 2.2;
    u.uFogFar.value = 6.4;
    return m;
  };

  /* The deck is dark. It is the largest up-facing surface anywhere on this
     page -- 2.45 by 2.32, filling the bottom third of the frame -- and an
     up-facing face is the brightest thing this material can produce: the key
     lands 0.52 of base on it against 0.04 on a face turned away. At the
     tooling's own value that is a glowing table with a robot on it. A third
     of it puts the deck under the hardware standing on it and under the
     machine, which is the order those three things want to be read in.
     Multiplied rather than picked, so it stays the same grey. */
  const deckMat = skin(new THREE.Color(STEEL).multiplyScalar(0.34), { instanced: false });
  const steelMat = skin(STEEL);
  const stockMat = skin(STEEL);

  const du = deckMat.userData.uniforms;
  /* One rule every 125 mm, which is the slot pitch a deck this size is
     actually machined on, and 21 px at the far edge falling to nothing under
     the material's own distance fade. At the default 6.5 the deck gets
     fifteen lines across two and a half metres and reads as a drawn grid
     rather than as a surface. */
  du.uPitch.value = 8.0;
  du.uGrid.value = 0.055;

  const su = steelMat.userData.uniforms;
  /* Finer on the tooling, because a ruling has to be smaller than the thing
     it rules: the largest face here is the controller's 0.475, which 16 per
     metre crosses seven times, and the smallest is a 26 mm bolt head, which
     it crosses at most once. Shallower as well -- these are the pieces the
     reader is meant to be reading shape off, and a dark line across a 10 px
     saddle is the saddle. */
  su.uPitch.value = 16.0;
  su.uGrid.value = 0.035;

  const tu = stockMat.userData.uniforms;
  // Turned bar has no ruling on it, and a world-space grid across a 52 mm
  // cylinder is a moire pattern rather than machining.
  tu.uGrid.value = 0.0;

  /* ── the deck ──────────────────────────────────────────────────────────
     One box and one draw. Not instanced: it is the only thing wearing this
     material, and an InstancedMesh of one is an attribute buffer and a
     matrix upload for a mesh that never moves. */
  const deckGeo = new THREE.BoxGeometry(DECK_X1 - DECK_X0, DECK_T, DECK_Z1 - DECK_Z0);
  const deck = new THREE.Mesh(deckGeo, deckMat);
  deck.position.set(ax + (DECK_X0 + DECK_X1) * 0.5,
                    ay + DECK_Y - DECK_T * 0.5,
                    az + (DECK_Z0 + DECK_Z1) * 0.5);
  group.add(deck);

  /* ── the tooling ───────────────────────────────────────────────────────
     Everything else that is not a part, as instances of one unit box. Boxes
     for a reason beyond tidiness: this material rotates normals by the
     instance matrix itself rather than by its inverse transpose, and a box is
     the shape that survives that, because its normals are the axes the scale
     is along -- a non-uniform scale changes their length and not their
     direction, and the fragment stage normalises anyway. */
  const boxes = [];
  const put = (x0, y0, z0, x1, y1, z1) =>
    boxes.push([(x0 + x1) * 0.5, (y0 + y1) * 0.5, (z0 + z1) * 0.5,
                Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0)]);

  // The pad the machine is bolted to, and the four bolts holding the pad down.
  put(base.x - PAD_W * 0.5, DECK_Y, base.z - PAD_W * 0.5,
      base.x + PAD_W * 0.5, DECK_Y + PAD_T, base.z + PAD_W * 0.5);
  for (let i = 0; i < 4; i++) {
    const sx = (i & 1) ? 1 : -1, sz = (i & 2) ? 1 : -1;
    const cx = base.x + sx * (PAD_W * 0.5 - 0.055);
    const cz = base.z + sz * (PAD_W * 0.5 - 0.055);
    put(cx - BOLT * 0.5, DECK_Y + PAD_T, cz - BOLT * 0.5,
        cx + BOLT * 0.5, DECK_Y + PAD_T + BOLT_H, cz + BOLT * 0.5);
  }

  // The infeed: bed, two guides, the stop the queue runs up against, the
  // magazine housing, and two posts carrying the whole thing off the deck.
  const FX0 = PICK.x - 0.075, FX1 = HOUSE_X1;
  put(FX0, FEED_Y - CHAN_T, PICK.z - FEED_HZ, FX1, FEED_Y, PICK.z + FEED_HZ);
  for (const s of [-1, 1]) {
    const zc = PICK.z + s * (BILLET_R + RAIL_W * 0.5 + 0.008);
    put(FX0, FEED_Y, zc - RAIL_W * 0.5, FX1, FEED_Y + RAIL_H, zc + RAIL_W * 0.5);
  }
  put(FX0, FEED_Y, PICK.z - FEED_HZ, FX0 + STOP_W, FEED_Y + RAIL_H, PICK.z + FEED_HZ);
  put(HOUSE_X0, FEED_Y - CHAN_T, PICK.z - HOUSE_HZ,
      HOUSE_X1, FEED_Y + HOUSE_H, PICK.z + HOUSE_HZ);
  for (const px of [PICK.x + 0.020, 1.240])
    put(px - POST * 0.5, DECK_Y, PICK.z - POST * 0.5,
        px + POST * 0.5, FEED_Y - CHAN_T, PICK.z + POST * 0.5);

  // The outfeed: the beam, five saddles, two posts.
  const NX0 = LOAD.x - 0.075, NX1 = LOAD.x + (NESTS - 1) * PITCH + 0.064;
  put(NX0, NEST_Y - NEST_T - BEAM_T, LOAD.z - BEAM_HZ,
      NX1, NEST_Y - NEST_T, LOAD.z + BEAM_HZ);
  for (let j = 0; j < NESTS; j++) {
    const cx = LOAD.x + j * PITCH;
    put(cx - NEST_W * 0.5, NEST_Y - NEST_T, LOAD.z - NEST_W * 0.5,
        cx + NEST_W * 0.5, NEST_Y, LOAD.z + NEST_W * 0.5);
  }
  for (const px of [LOAD.x - 0.010, LOAD.x + (NESTS - 1) * PITCH])
    put(px - POST * 0.5, DECK_Y, LOAD.z - POST * 0.5,
        px + POST * 0.5, NEST_Y - NEST_T - BEAM_T, LOAD.z + POST * 0.5);

  /* The totes. Four walls and a floor each rather than a solid block, because
     the one thing a tote has to do here is be open at the top: the finished
     part falls into it and is not seen again, and a lid on that is a box the
     part vanishes behind rather than a tote it lands in. */
  const TOTE_A = new THREE.Vector3(LOAD.x + (NESTS + 1) * PITCH - 0.014, 0, LOAD.z);
  const tote = (c) => {
    const x0 = c.x - TOTE_W * 0.5, x1 = c.x + TOTE_W * 0.5;
    const z0 = c.z - TOTE_D * 0.5, z1 = c.z + TOTE_D * 0.5;
    const y1 = DECK_Y + TOTE_H;
    put(x0, DECK_Y, z0, x1, DECK_Y + TOTE_WALL, z1);
    put(x0, DECK_Y, z0, x0 + TOTE_WALL, y1, z1);
    put(x1 - TOTE_WALL, DECK_Y, z0, x1, y1, z1);
    put(x0, DECK_Y, z0, x1, y1, z0 + TOTE_WALL);
    put(x0, DECK_Y, z1 - TOTE_WALL, x1, y1, z1);
  };
  tote(TOTE_A);
  tote(TOTE_B);

  // The controller.
  put(BOX_X, DECK_Y, BOX_Z, BOX_X + BOX_W, DECK_Y + BOX_H, BOX_Z + BOX_D);

  const boxGeo = seedSurface(new THREE.BoxGeometry(1, 1, 1), boxes.length, () => 0);
  /* A seed of nothing, deliberately, here and on the stock. The dissolve
     reads a world-space field, and with every instance reading it unshifted
     the erosion comes apart in patches that carry across the deck and up into
     whatever is standing on it -- a cell coming apart, rather than thirty
     pieces of hardware coming apart privately. */
  const steel = new THREE.InstancedMesh(boxGeo, steelMat, boxes.length);
  const m = new THREE.Matrix4();
  const v = new THREE.Vector3();
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    m.makeScale(b[3], b[4], b[5]);
    m.setPosition(ax + b[0], ay + b[1], az + b[2]);
    steel.setMatrixAt(i, m);
  }
  steel.instanceMatrix.needsUpdate = true;
  group.add(steel);

  /* ── the stock ─────────────────────────────────────────────────────────
     Eight on the infeed, five on the outfeed, one in the gripper, and five
     standing in the two totes. The layout is fixed because update() walks it
     by index and nothing else says which billet is which. */
  const FEED0 = 0;
  const NEST0 = FEED0 + FEED_SLOTS;
  const HELD = NEST0 + NESTS;
  const IDLE0 = HELD + 1;
  const IDLE = 5;
  const nStock = IDLE0 + IDLE;

  const stockGeo = seedSurface(
    new THREE.CylinderGeometry(BILLET_R, BILLET_R, BILLET_H, SIDES), nStock, () => 0);
  const stock = new THREE.InstancedMesh(stockGeo, stockMat, nStock);

  /* Where the idle stock stands: three in the tote of blanks and two in the
     tote of finished parts, on a fixed scatter rather than a random one so a
     reload puts them back exactly where they were. Their tops sit 53 mm below
     the rims, which is what makes both totes places a part can be retired
     into without the retirement being visible. */
  const IDLE_AT = [
    [TOTE_B, -0.062, -0.048], [TOTE_B, 0.055, -0.041], [TOTE_B, 0.008, 0.052],
    [TOTE_A, -0.058, 0.044], [TOTE_A, 0.061, -0.036]
  ];
  const IDLE_Y = DECK_Y + TOTE_WALL + BILLET_MID;

  const billet = (i, x, y, z) => {
    m.makeScale(1, 1, 1);
    m.setPosition(ax + x, ay + y, az + z);
    stock.setMatrixAt(i, m);
  };
  for (let k = 0; k < IDLE; k++)
    billet(IDLE0 + k, IDLE_AT[k][0].x + IDLE_AT[k][1], IDLE_Y,
                      IDLE_AT[k][0].z + IDLE_AT[k][2]);
  group.add(stock);

  /* Where a part rests on each of the two surfaces, and how far the one that
     is retired has to fall to reach the floor of the tote. */
  const FEED_REST = FEED_Y + BILLET_MID;
  const NEST_REST = NEST_Y + BILLET_MID;
  const FALL = NEST_REST - IDLE_Y;

  const us = [deckMat.userData.uniforms, su, tu];
  const held = new THREE.Vector3();

  /* The part that has just been let go of, parked where it cannot be seen.
     Retiring it into the tote rather than scaling it away costs the same and
     means there is no frame in which an instance is a degenerate triangle. */
  const PARK = [TOTE_A.x + 0.002, IDLE_Y, TOTE_A.z - 0.002];

  return {
    group,
    /* A frame is nine uniform writes and fourteen instance matrices: eight on
       the infeed, five on the outfeed and the one in the gripper. The tool
       point behind that last one costs a pose interpolation and six matrix
       multiplies, all of them into arrays allocated at build. Nothing here
       allocates and nothing here counts frames. */
    update({ t, cut, pointer, charge }) {
      const c = charge === undefined
        ? Math.min(1, (pointer ? pointer.speed : 0) * 2.2) : charge;
      for (let i = 0; i < us.length; i++) {
        const u = us[i];
        u.uTime.value = t;
        u.uCut.value = cut;
        u.uCharge.value = c;
      }

      /* The arm's phase, recovered rather than kept. `%` on a negative clock
         is negative in this language, which a headless renderer stepping its
         own time backwards will produce, so it is folded before it is used --
         a phase of -0.2 would otherwise index the whole cell inside out for
         one frame. */
      const phase = running ? ((t / ARM_CYCLE) % 2 + 2) % 2 : 0;
      const u = phase < 1 ? phase : 2 - phase;
      tool(u, held);

      // The queue, and its one instant of arithmetic: at f = 0 the eight
      // instances stand in slots 1..8 with the pick position empty, at f = 1
      // in slots 0..7 with it filled.
      const f = ease((phase - FEED_W0) / (FEED_W1 - FEED_W0));
      for (let k = 0; k < FEED_SLOTS; k++)
        billet(FEED0 + k, PICK.x + (k + 1 - f) * PITCH, FEED_REST, PICK.z);

      /* The beam. It holds at 1 from the top of the cycle until the arm has
         let go, which is why the reset at the release is invisible: the nest
         the row steps out of is the nest the arm is filling at that instant,
         and the part the row steps off the end is already inside the tote. */
      const g = phase < PLACE ? 1 : ease((phase - NEST_W0) / (NEST_W1 - NEST_W0));
      const rise = LIFT * Math.sin(Math.PI * g);
      const drop = ease((g - DROP0) / (1 - DROP0));
      for (let j = 0; j < NESTS; j++) {
        const last = j === NESTS - 1;
        billet(NEST0 + j, LOAD.x + (j + g) * PITCH,
               NEST_REST + rise - (last ? FALL * drop * drop : 0), LOAD.z);
      }

      // And the one in the gripper, which is the tool point itself less the
      // 14 mm the fingers sit down the part.
      if (phase < PLACE) billet(HELD, held.x, held.y + GRIP - BILLET_MID, held.z);
      else billet(HELD, PARK[0], PARK[1], PARK[2]);
      stock.instanceMatrix.needsUpdate = true;

      /* The part being handled is the lit one. uFocus lights a single
         instance teal and the caller has nothing at this station to spend it
         on -- there is no card list here to read against -- so it is spent on
         the only thing in the cell whose identity changes: whatever is in the
         gripper while there is something in it, and the part at the head of
         the queue while there is not, which is the part that is about to be.
         The tooling and the deck carry their own materials and so their own
         uFocus, which is never written and stays at -1. */
      tu.uFocus.value = phase < PLACE ? HELD : FEED0;
    },
    dispose() {
      deckGeo.dispose();
      boxGeo.dispose();
      stockGeo.dispose();
      deckMat.dispose();
      steelMat.dispose();
      stockMat.dispose();
    }
  };
}
