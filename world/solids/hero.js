/* Station 01, solid: the workcell the manipulator is standing in.
 *
 * The arm was correct and alone. Measured kinematics, four waypoints, a
 * ping-pong fourteen seconds out and fourteen back, lit and articulated -- and nothing under it,
 * nothing in front of it and nothing for it to be doing. Every other station
 * on this page is a place: an occupancy grid, a corridor, a benchmark rig.
 * The first one was an object in a void, which is a 3D asset rather than a
 * photograph of work, and it is the one that has to carry the page.
 *
 * So this is the cell. A floor plate the machine is bolted to at the height
 * its own base plate actually sits at, an infeed the tool actually reaches, a
 * walking beam the tool actually loads, a gauge that strikes the part the beam
 * carries under it, a tote the finished parts actually land in -- and around
 * all of it the things that make a cell a cell rather than a table with a
 * robot on it: perimeter guarding, a cable tray with drops to every fixture, a
 * controller cabinet with a beacon on top, envelope paint on the floor, and,
 * beyond the guarding, the aisle and the building the cell was installed in.
 *
 * Not one of the working positions was chosen: every one of them is solved out
 * of world/kinematics.js. The infeed's channel floor is where it is because
 * the tool comes to rest 0.2771 above the plate at waypoint 0; the nest tops
 * are 8.3 mm lower than that because waypoint 2 is 8.3 mm lower than waypoint
 * 0. Move a waypoint and the cell moves with it, because nothing here is
 * written down as a height -- it is written down as an offset from a tool
 * point.
 *
 * Which settles the only question a workcell can get wrong. A fixture the arm
 * visibly misses is worse than no fixture at all, and one the arm visibly goes
 * through is worse again, because a reader who knows what a robot is will see
 * either before they see anything else. The tool axis is within 1.765 degrees
 * of straight down at every one of 401 samples of the move, the tool's own x
 * never exceeds 0.3755, and its z runs from +0.4944 to -0.2941. That is a
 * gripper coming vertically down onto two points 0.8262 apart, which is a load
 * and an unload, and this file is the two stations it is loading and
 * unloading. Everything else stands off the machine by a distance measured
 * against the machine's own triangles rather than against its joint origins:
 * the shell is sampled at 61 poses across the move and every fixture below
 * carries the smallest gap it ever leaves.
 *
 * Two things about this cell were wrong until this pass and are worth naming.
 * The walking beam ran in +x, toward the machine, which put the finished tote
 * 92 mm from the base column and the drop 2 mm inside the tote's own wall --
 * the part ended each cycle intersecting the thing it had landed in. It runs
 * in -x now, away from the machine, which is the direction with nothing in it:
 * the machine's own triangles never reach left of x = 0.0719 at any pose, so
 * the beam has the entire left of the cell to itself and the tote can stand
 * centred on the point the part is actually released over. That also happens
 * to be the fix for the frame, which had all of its hardware in the right
 * third and a black left margin.
 *
 * It runs off the arm's clock and no other. world/world.js advances the arm
 * with `armPhase = (armPhase + dt / 14) % 2` out of the same accumulated `t`
 * this update is handed, so the phase is recovered here as `(t / 14) % 2`
 * rather than accumulated again. One unit of that phase is fourteen seconds
 * and the fold at 1 makes an out-and-back twenty-eight, which is worth
 * stating because every duration below is quoted in seconds off it. Derived and not accumulated on purpose: this
 * solid is only updated while it is the live station, so an accumulator would
 * fall behind by however long the reader spent at the benchmarks and the part
 * in the gripper would come back to the hero hanging in mid-air next to it.
 *
 * Five draw calls: the floor plate, the tooling, the guarding and everything
 * behind it, the paint, the stock. Everything except the plate is one
 * instanced box or one instanced cylinder, which is what keeps a cell of 330
 * separate pieces of hardware inside the budget the rest of the page runs on
 * -- the Work station next door draws five calls and 8460 instances.
 */
import * as THREE from "three";
import { makeSurface, seedSurface } from "../materials/surface.js";
import { linkFrames, toolPoint, poseAt, UPRIGHT } from "../kinematics.js";

/* ── mirrored from world/world.js ────────────────────────────────────────
   Where the machine stands and how long its move takes. Both belong to that
   file and neither is exported from it, so they are copied here and the copy
   is checkable rather than hopeful: the base is the translation its arm Group
   is given, and the cycle is the constant its ping-pong is divided by. The
   caller passes `arm` when it has one and these are what stand in when it
   does not -- a station whose solid refuses to build because a mesh fetch
   failed is worse than a cell around a machine that is only a point cloud.

   ARM_CYCLE is the divisor, not the loop: world.js advances the phase by
   dt / 14 and folds it at 1, so fourteen seconds is one traverse of the four
   waypoints and a full out-and-back is twenty-eight. */
const ARM_BASE = new THREE.Vector3(1.15, -0.55, -0.15);
const ARM_CYCLE = 14;

/* ── what the machine occupies ───────────────────────────────────────────
   Measured off Universal Robots' own triangles, posed by the same forward
   kinematics the mesh is drawn with, at 61 poses across the move: the shell
   spans x 0.0719 to 1.3400, y -0.5500 to 0.2814, z -0.4482 to 0.5409, and no
   point of it is further than 1.0877 from the base axis.

   Those five figures are the argument for everything standing in this cell,
   and they are quoted at the fixtures they justify. Only one of them is a
   constant, because only one of them is drawn: the swept radius is what gets
   painted on the floor. It is the machine's own figure and not a number
   anybody picked, which is the whole reason it is worth painting. */
const REACH = 1.0877;

/* ── the part ────────────────────────────────────────────────────────────
   Turned bar stock, 52 across and 90 long, and it is the only round family in
   a cell that is otherwise entirely rectilinear -- which is most of what
   makes it read as the thing being handled rather than as another bracket. At
   the infeed it stands 1.848 from the eye where a 953-pixel frame is 672
   pixels to the metre, so it is 35 px across and 60 tall; at the first nest it
   is 2.624 away, 473 px to the metre, 25 across and 43 tall. Above the size at
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

/* ── the plate ───────────────────────────────────────────────────────────
   Thickness of the machined pad the arm is bolted to, and so, by subtraction,
   where the floor plate's top face is: the base plate is at y = -0.55 and
   cannot move, so the plate is that much below it. Written this way round
   because the alternative -- a floor height and a pad thickness chosen
   independently -- is two numbers that have to agree and one day will not,
   and the failure is a robot floating a centimetre above the surface it is
   bolted to.

   30 mm is 14 px at the 462 px to the metre the pad is seen at, which is
   enough for the riser to have a lit edge of its own; at 15 it was a seam. */
const PAD_T = 0.030;
const PAD_W = 0.34;            // 340 square: a UR12e's own flange is 190, so
                               // this reads as a riser bolted to a plate
                               // rather than as the robot's own casting
const BOLT = 0.026, BOLT_H = 0.010;

/* The plate itself, as offsets from the anchor. This was a bench-sized deck
   -- 2.45 by 2.32, exactly the machine and its two tracks -- and it has been
   opened out to the whole floor the shot contains, because everything added
   this pass stands on it: the guarding, the cable tray's feet, the aisle
   behind the guarding, the building columns behind that. It is the floor now,
   not a table, and the pad is the riser between it and the robot.

   Three of its four edges are solved against the frame and are meant to leave
   it. Measured at this station's key -- eye 0.06 above the anchor, pitched
   4.53 degrees down through a 42 degree lens -- on a 1916 x 953 window the
   bottom of the frame crosses the plate at z = 0.962 dead centre and 0.840 to
   1.084 at the two corners, so a near edge at 1.46 is 0.376 beyond the
   furthest the frame can see, and it stays out of shot when the pointer drops
   the eye its full 0.15, which moves that furthest crossing out to 1.183 and
   leaves 0.277 in hand.

   The left and right edges are set the same way and at the plate's own far
   depth, because that is where the frame is widest: at z = -2.30 a 1916-wide
   window spans x = -2.724 to 4.514 on this plane, so edges at -2.78 and 4.58
   are 56 and 66 mm outside it and there is no corner of the floor anywhere in
   the shot. It is a big plate for that -- 7.36 by 3.76 -- and it costs one
   box. What it buys is that the ground never ends.

   (The figure that used to be here said the bottom of the frame crossed at
   1.034 and 0.916 to 1.151. It was 72 mm short at every one of the three, and
   short in the safe direction, so nothing was ever wrong on screen. The
   numbers above are re-projected through the live camera at the shear
   world/framing.js actually returns for this station's panel, which is 0.053
   and used to be 0.390.)

   The far edge is the only one that stays in shot, and it is deliberately
   past everything: at z = -2.30 it projects to y = -0.16 in NDC with the
   guarding, the aisle and the building in front of it, and the material's fog
   has taken 62% of it at the centre of the frame and 89% at the left corner,
   so the plate reads as ground running back into the page's own background
   rather than as a slab with an edge.

   Nothing is built below it. A cell base frame has legs, and from an eye 0.62
   above a top face 7.36 by 3.76 not one of them is ever visible: the only
   faces of a closed box this camera can see are the top and the near one, and
   the near one is the edge that was deliberately pushed out of frame. Legs
   would be twenty instances drawn for nobody. */
const DECK_X0 = -2.78, DECK_X1 = 4.58;
const DECK_Z0 = -2.30, DECK_Z1 = 1.46;
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
   at slot 8 meets the housing's near face at y = -0.2474, which is 68 mm below
   the roof line. All three slots give the same answer, because the height that
   line has fallen to by the time it reaches that face is a fact about the eye
   and the depth and not about x. */
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
   Seven nests on a walking beam, running away from the machine. A part is set
   into nest 0 by the arm, the beam lifts the whole row 14 mm, steps it one
   pitch and sets it down; the part that was in nest 6 goes over the end and
   into the tote.

   The direction is the correction this pass exists for. It ran the other way
   -- five nests stepping toward the machine, a tote wedged between the last
   of them and the base column -- and both of that layout's constraints came
   from the machine being in the way: five and not six because a sixth would
   have put the drop inside the robot. Turned round, the constraint is gone.
   The kinematic chain's own triangles never reach left of x = 0.0719, and nest
   0 is at 0.1287, so every station after the first has the entire left of the
   cell to itself: the tote at the end of a seven-station beam clears the
   nearest point of the machine by 0.679.

   Seven, and the frame is what sets it. The drop point is at x = -0.6973 and
   the tote's outboard wall at -0.8373, which on the narrower of the two
   windows this page is read at -- 1440 x 900, where the left edge of the frame
   crosses this track at x = -1.097 -- clears the edge by 0.259. An eighth
   station leaves 0.141 and a ninth 0.023, which is the edge itself. So the row
   is as long as the shot will hold, which is the right way round: the beam is
   what fills the half of the frame the type is read against.

   The step runs while the tool is at the far end of its retract. The tool
   passes over this track twice a cycle -- the move is played out and back, so
   the return is the outbound reversed -- and its own height varies by 40.5 mm
   over the whole move, from -0.2854 to -0.2449, so there is no height at which
   the row could step under it. What there is instead is z: at phase 1.0 the
   tool stands 0.2714 from the track line, and across the whole of the window
   it is never nearer than 0.1954, against parts that are 0.026 in radius. The
   window is 0.24 of phase, which at fourteen seconds to the unit is 3.36 s for
   one 118 mm step -- 35 mm/s, and 17 pixels a second on screen. Slow enough to
   be read as a mechanism indexing rather than as something being animated. */
const NESTS = 7;
const NEST_W = 0.088, NEST_T = 0.022;   // saddle, 10 px thick at 470 px to the
                                        // metre: a shadow line under a part
const BEAM_T = 0.026, BEAM_HZ = 0.065;
const LIFT = 0.014;            // 6.6 px of walking beam. Small, and the point
                               // of it is that the row does not scrape

/* ── the gauge ───────────────────────────────────────────────────────────
   A C-frame over the middle of the beam with a ram that comes down on
   whatever the beam has just walked under it. This is the second thing in the
   cell that moves and the only one that is not the robot, and that is what it
   is for: a cell with one machine in it is a robot demonstration, and a cell
   where something happens to the part between being placed and being dropped
   is a process.

   A C-frame and not a two-post gantry, which is what it was, and the reason is
   worth keeping. Two posts straddling the track put one of them 0.145 nearer
   the eye than the part it was straddling -- and at this standoff 0.145 of
   depth is 11 px of parallax, against a 48 mm post that is 22 px wide. So the
   near post stood exactly in front of the thing the gauge exists to be seen
   working on. Rendered, it hid the part completely. One column on the far side
   of the track with the head cantilevered over it leaves the whole of the
   operator side open, which is also why real presses are built that way.

   Over nest 3 because nest 3 is the middle of a seven-station beam, and the
   middle is where there is room: over the whole stroke and the whole move the
   closest anything on this frame comes to the machine's own skin is 0.262 at
   the platen, 0.266 at the ram, 0.276 at the head and 0.295 at the column, all
   against the shell at 61 poses. In plan the tool point never comes within
   0.383 of the column and no part of the joint chain within 0.374.

   The stroke is the part. The ram retracts to exactly one part-height of
   daylight above a part sitting in a nest -- face at NEST_Y + 2 * BILLET_H --
   so what it clears is what has to pass under it, and it descends 90 mm onto
   the top land of the part below. That is 42 px of travel at the 465 px to the
   metre this station stands at, and the clearance over a part at the top of
   the beam's own 14 mm lift is 76 mm, which is the figure that says the two
   mechanisms cannot meet. The platen on the nose of the ram is the saddle's
   own 88 mm across, so what comes down on the part is the same width as what
   it is standing in. */
const GAUGE_AT = 3;
const RAM_W = 0.062, RAM_H = 0.150;
const PLATEN_T = 0.016;
const GPOST = 0.048, GPOST_HZ = 0.145;  // the column, behind the track
const GREACH = 0.060;                   // how far the head reaches past it
const CROSS_T = 0.055;                  // the head the column carries

/* ── the tote ────────────────────────────────────────────────────────────
   One, standing under the end of the beam, centred on the point the beam
   releases a part over. 0.155 deep, 68 px, and a part standing on its floor
   has its top 53 mm below the rim, so it hides what is in it from this eye
   and the instant a part is recycled out of the cycle is an instant nobody
   can see.

   Centred on the drop rather than near it, which is the second half of the
   reversal. With the beam running the other way the tote had to be squeezed
   between the last nest and the machine, and the part finished each cycle 2 mm
   inside the tote's own near wall -- an interpenetration, sub-pixel and
   permanent. Standing where the part is actually let go of, the part comes to
   rest 0.102 clear of both walls.

   There used to be a second tote of raw blanks in the near right corner, and
   it is gone rather than moved. It was there because the bottom right of the
   frame had nothing in it, which stopped being true this pass; measured off
   the render it was also the second brightest object in the shot, an open box
   0.28 across at 1.9 m from the eye with its outboard wall 43 mm inside the
   right edge of a 1440-wide frame, so what the reader actually saw was a
   white crate being sliced by the edge of the picture. The magazine is where
   the blanks come from and the magazine is still there. */
const TOTE_W = 0.28, TOTE_D = 0.22, TOTE_H = 0.155, TOTE_WALL = 0.012;

/* ── the controller ──────────────────────────────────────────────────────
   A UR control box is 475 by 423 by 268 and it is the one piece of this cell
   whose dimensions are somebody else's. It stands on a plinth against the
   right-hand guarding, which is where a control box goes: out of the way, on
   the side the cable comes in. Out of the way means the plinth's nearest
   corner at 0.287 from the machine's skin and the cabinet's own at 0.330, both
   measured against the shell over the whole move -- and not, as the first
   draft of this comment claimed, outside the 1.0877 the machine sweeps. It is
   not. The cabinet's nearest corner is 0.382 from the base axis, well inside
   that radius; what keeps it clear is that this program never turns the base
   round to it. A cell where the cabinet is inside the robot's reach and out of
   its program is an ordinary cell, and saying that is better than a clearance
   claim that does not survive a different program.

   The plinth is 60 mm because a cabinet sitting flat on a floor plate has no
   shadow line under it at this angle and reads as painted on. The beacon on
   top is three lamps in a stack: it is the one place on this page a machine
   says what it is doing without a caption, and it is drawn dark because a
   status light that is always on is a status light that says nothing. */
const BOX_W = 0.475, BOX_D = 0.423, BOX_H = 0.268;
const BOX_X = 1.42, BOX_Z = -0.90;
const PLINTH = 0.060, PLINTH_OUT = 0.030;
const VENTS = 5, VENT_T = 0.012;
const LAMP_R = 0.032, LAMP_H = 0.042;

/* ── the guarding ────────────────────────────────────────────────────────
   Perimeter mesh on posts, a U open toward the reader, which is the one thing
   this frame did not have: something for the machine to stand against. It was
   an arm and two benches against near-black, and the far end of the plate
   faded into the page's own background with nothing between the two.

   The height is the machine. The shell's highest point over the whole move is
   0.2814, which is 0.8314 above the floor plate; the mesh stands 1.20, so it
   is 0.369 above anything the arm can raise. In frame that top rail lands at
   NDC y = 0.646 -- the same on both windows, because a horizontal's height in
   the frame is set by the vertical field and that does not change with aspect
   -- and the headline's own top edge is at 0.539, so the rail crosses the shot
   in the clear band under the navigation rather than through the type. The
   arm's own silhouette tops out at 0.436, so the machine reads as being inside
   the enclosure and not over it.

   The mesh is 90 mm square, which at the 367 px to the metre the fence is
   seen at is 33 px, on 6 mm wire that is 2.2 px. Both were solved for this
   shot and not taken from a catalogue: real guard mesh is finer and at this
   standoff a 50 mm grid on 4 mm wire is an 18 px cell on a 1.5 px line, which
   at one device pixel per line is the width at which a straight edge starts
   to crawl. 33 px on 2.2 is the coarsest cell that still reads as mesh rather
   than as bars.

   The left return is broken by a gate the finished totes leave through, and
   the gate is guarded by a light curtain: two columns, emitter and receiver,
   with the optics banded up their inboard faces. That is the honest reason a
   cell like this one has an opening at all. */
const GUARD_Z = -1.06;
const GUARD_X0 = -1.40, GUARD_X1 = 2.15;
const GUARD_ZR = 0.20;                  // where both returns stop
const GUARD_H = 1.20;
const GPOST_S = 0.050, GBAY = 0.98;     // post section and bay width
const GRAIL_T = 0.055, GRAIL_W = 0.030;
const GRAIL_LO = 0.055;                 // kick gap under the bottom rail
const MESH_P = 0.090, WIRE = 0.006;
const GATE_Z0 = -0.52, GATE_Z1 = -0.06; // the opening in the left return
const CURTAIN_W = 0.070, CURTAIN_H = 0.72;
const OPTICS = 9, OPTIC_H = 0.022;

/* ── the cable tray ──────────────────────────────────────────────────────
   A tray on brackets down the inside of the far guarding, and a drop off it
   to every fixture in the cell that needs one: the cabinet, the gauge gantry,
   the magazine and the robot's own pad. Cable management is the part of a
   cell nobody draws and everybody who has commissioned one looks for first,
   and it is also the cheapest way to tie a floor full of separate boxes into
   one machine -- four drops off one horizontal is four things that are
   plainly wired to each other.

   0.42 above the plate puts the tray under the guarding's top rail and over
   everything standing on the floor except the gauge frame and the light
   curtain's own columns, and 0.10 in front of the mesh so the two read as
   separate planes rather than as one wall. The run that crosses the cell
   passes 23 mm over the controller's lid, which is a cable resting on a
   cabinet and not a cable inside one -- checked, not assumed. */
const TRAY_Y = 0.42, TRAY_W = 0.080, TRAY_T = 0.045, TRAY_DZ = 0.10;
const CONDUIT = 0.032;

/* ── beyond the guarding ─────────────────────────────────────────────────
   An aisle conveyor and the building it is in. Neither is part of the cell
   and neither is meant to be read in detail: at z = -1.80 and z = -2.15 the
   material's own fog window -- 2.2 near, 6.4 far -- has taken 43% and 55% of
   them, so what they contribute is a lit horizontal and four verticals in the
   last legible band before the page's own background, which is exactly the
   depth cue a shot of an enclosed cell otherwise cannot have. Both are seen
   through the guard mesh, which is the second half of it: two planes of
   structure at different depths with a lattice between them is what makes a
   space read as deep rather than as flat and far away.

   The columns run out of the top of the frame. At this key the top edge
   crosses their depth at y = 1.365, and they are built to 1.60, so the reader
   never sees where the building stops. They stand on a 1.70 bay laid out from
   the left edge of the plate, which puts them at -1.93, -0.23, 1.47 and 3.17
   -- NDC -0.77, -0.23, 0.25 and 0.70, so one falls in each quarter of the
   frame without any of them landing behind the machine. */
const AISLE_Z = -1.80, AISLE_Y = 0.48, AISLE_HZ = 0.16;
const SLAT_P = 0.115, SLAT_T = 0.030;
const COL_Z = -2.15, COL_S = 0.150, COL_TOP = 1.60, COL_BAY = 1.70;
/* The tie between the columns, and the one height in the building that is
   composed rather than structural. Its underside projects to NDC y = 0.805,
   which is above the guarding's top rail at 0.646 and below the bottom edge of
   the navigation bar at 0.891 -- the one band of this frame with nothing else
   in it. It was at 0.74 for a while, which is NDC 0.615 at that depth: below
   the fence it is meant to be behind, so the building read as being inside the
   cell. */
const TIE_Y = 1.05, TIE_T = 0.11, TIE_HZ = 0.055;

/* ── the paint ───────────────────────────────────────────────────────────
   Two markings, and both of them are measurements.

   The envelope is the machine's own swept radius: no triangle of the shell
   gets further than 1.0877 from the base axis at any pose of the move, so the
   arc is drawn at exactly that and it is the only line on this floor that a
   reader could check. It is dashed because a painted envelope is dashed, and
   because a solid ring at this radius would read as a groove machined into
   the plate.

   The second is the operator band: two lines across the front of the cell at
   the mouth of the guarding, which is the edge a person is not meant to cross
   while the machine is running. It sits at the near end of the returns because
   that is where the light curtain is, and the two lines are 0.16 apart on the
   ground, which at the middle of the frame is 25 px between them -- wide
   enough to be a band and not a doubled line, and narrow enough that both
   lines are still one mark.

   Both markings are drawn as dashes 0.085 long and 0.026 wide, which is 46 by
   14 px at the band and 42 by 13 at the far side of the envelope. */
const PAINT_T = 0.003;         // proud of the plate, so it is paint and not
                               // z-fighting with the surface it is on
const DASH = 0.085, DASH_GAP = 0.055, DASH_W = 0.026;
const BAND_W = 0.16, BAND_LINE = 0.030;

/* ── the cycle, in units of the arm's own phase ──────────────────────────
   The arm's phase runs 0 to 2 and folds at 1, so waypoint 0 is at phase 0 and
   2, the low waypoint is at 2/3 and 4/3, and the last waypoint is at 1. The
   tool's speed through both work points is under a millimetre a second --
   the waypoints are smoothstepped, so the machine arrives at rest -- which is
   why a transfer can happen at an instant here without reading as a snatch.

   The two index windows are placed where the tool is furthest from the track
   being indexed: 0.400 of clearance in z across the whole of the infeed's
   window and 0.195 across the outfeed's. Neither is a phase somebody liked
   the look of.

   The gauge takes the rest of the cycle. The beam steps once per out-and-back,
   over phase 0.88 to 1.12, and the ram is given the long quiet stretch after
   it: down over 1.20 to 1.44, held on the part to 1.64, back up by 1.88. At
   fourteen seconds to the unit of phase that is a 3.4 s descent, a 2.8 s dwell
   and a 3.4 s retract inside a 28 s cycle, which is a gauge taking a
   measurement rather than a finger tapping. It also leaves 0.08 of phase
   between the beam finishing its step and the ram starting to move, and 1.88
   to 2.88 -- most of a cycle -- between the ram coming clear and the beam
   being allowed to move again. The two are never within a tenth of a phase
   unit of each other. */
const PLACE = 2 / 3;
const FEED_W0 = 0.42, FEED_W1 = 0.58;
const NEST_W0 = 0.88, NEST_W1 = 1.12;
const RAM_W0 = 1.20, RAM_W1 = 1.44, RAM_W2 = 1.64, RAM_W3 = 1.88;

const ease = x => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/* Where the finished part starts falling, as a fraction of the outfeed's
   step. At 0.55 the part's inboard face has cleared the tote's inner wall by
   49 mm and its base is 77 mm above the rim, so it goes over the edge rather
   than through it -- and it is inside the tote's mouth from 0.136 of the step
   onward, so this is a comfortable margin rather than a tuned one. */
const DROP0 = 0.55;

export function build(ctx) {
  const anchor = ctx.anchor || new THREE.Vector3();
  const pal = ctx.pal || {};
  const arm = ctx.arm;
  const base = (arm && arm.base) || ARM_BASE;
  /* UPRIGHT and not an identity, which is what stood here. The fallback is
     for the load that could not fetch the arm mesh at all, and an identity
     rotation sends every tool point back into the model's own Z-up frame --
     so the cell that was supposed to be standing where the machine would have
     been would have had its infeed a metre out and lying on its side. It is a
     path nobody has seen, which is exactly the kind that stays wrong. */
  const upright = (arm && arm.upright) || UPRIGHT;
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
  /* Which way the beam walks. One place, so the whole outfeed -- saddles,
     posts, gantry, tote, paint and the parts themselves -- turns together. */
  const OUT = -1;
  const nestX = j => LOAD.x + OUT * j * PITCH;
  const DROP_X = nestX(NESTS);

  const ax = anchor.x, ay = anchor.y, az = anchor.z;

  const group = new THREE.Group();
  /* Built in world coordinates, like the formation it has to agree with and
     like the arm it has to be bolted to, so the group is an identity that
     never changes -- which is also what lets the material's world-space
     ruling land on the hardware instead of sliding over it. */
  group.matrixAutoUpdate = false;

  /* ── materials ─────────────────────────────────────────────────────────
     Five, and the split is what the draw calls are. Four of them are values
     of the same machined grey rather than colours of their own; the fifth is
     the page's own cream, because paint on a floor is paint. The accent, the
     teal and the fog come from the stylesheet through ctx.pal and nothing
     else here is coloured at all.

     The values are a hierarchy and it is the fix for a cell that read bright
     and plastic. Measured off the previous render, an up-facing face of the
     tooling came back at 85 of 255 and the cabinet's lid was the brightest
     large area in the frame -- brighter than the machine, which is the wrong
     way round for a photograph of a robot. Everything fixed is 0.64 of the
     grey now, the guarding 0.46 so it falls back behind the machine, the
     floor 0.30, and the stock is the only thing left at full: the parts are
     what the cell is about and they are the smallest things in it, so they
     are the only things that get to be bright.

     The paint is the odd one, and it is dark for a reason that is only
     visible on a render. An up-facing face takes 0.52 of its base off this
     material's key, and cream is 0.97 in linear where the grey is 0.584, so
     paint mixed at the value it reads as on a drawing came out at 161 of 255
     -- two and a half times the brightest fixture in the cell and the second
     brightest thing in the whole frame after the type. At 0.26 it lands a
     little over the tooling, which is what white paint on a dark floor
     actually does. */
  const STEEL = "#c9ccd4";
  const CREAM = pal["--landing-fg"] || "#fcf9f3";

  const skin = (base_, opts) => {
    const m = makeSurface({
      base: base_, accent: pal["--landing-accent"],
      teal: pal["--landing-teal"], fog: pal["--landing-bg"],
      instanced: opts && opts.instanced !== undefined ? opts.instanced : true
    });
    const u = m.userData.uniforms;
    /* The fog window is the only depth cue a scene this shallow has, and the
       cell is no longer shallow: it runs from 1.86 at the infeed to 6.36 at
       the far right corner of the plate, with the aisle at 4.11 and the
       building columns at 4.45. The material's own 3-to-26 would leave every
       part of that at the same depth as every other part. From 2.2 to 6.4 the
       infeed is untouched, the first nest is 3% gone, the guarding 19%, the
       aisle 43%, the columns 55%, the far edge of the plate 62% at the centre
       of the frame and 89% at its left corner -- a ramp that puts the back of
       the shot into the page's own background without ever reaching it. */
    u.uFogNear.value = 2.2;
    u.uFogFar.value = 6.4;
    return m;
  };

  /* The floor is dark. It is the largest up-facing surface anywhere on this
     page -- 7.36 by 3.76, filling the bottom third of the frame -- and an
     up-facing face is the brightest thing this material can produce: the key
     lands 0.52 of base on it against 0.04 on a face turned away. At the
     tooling's own value that is a glowing table with a robot on it. Just under
     a third of it puts the floor under the hardware standing on it and under
     the machine, which is the order those three things want to be read in.
     Multiplied rather than picked, so it stays the same grey. */
  const deckMat = skin(new THREE.Color(STEEL).multiplyScalar(0.30), { instanced: false });
  const steelMat = skin(new THREE.Color(STEEL).multiplyScalar(0.64));
  const guardMat = skin(new THREE.Color(STEEL).multiplyScalar(0.46));
  const paintMat = skin(new THREE.Color(CREAM).multiplyScalar(0.26));
  const stockMat = skin(STEEL);

  const du = deckMat.userData.uniforms;
  /* One rule every 125 mm, which is the slot pitch a plate this size is
     actually machined on: 46 px at the guarding and 33 at the plate's far
     edge, falling to nothing under the material's own distance fade, which
     ends at 13 m. At the default 6.5 per metre the floor gets one line every
     154 mm and reads as a drawn grid rather than as a surface. */
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

  const gu = guardMat.userData.uniforms;
  // Nothing on the guarding is wider than a 50 mm post and most of it is a
  // 6 mm wire, so a world-space ruling has nothing to rule and every line it
  // draws lands across a whole member at once. Off.
  gu.uGrid.value = 0.0;

  const pu = paintMat.userData.uniforms;
  // Paint is a film on a floor. A ruling on it would be the floor's ruling
  // drawn twice, 3 mm higher.
  pu.uGrid.value = 0.0;

  const tu = stockMat.userData.uniforms;
  // Turned bar has no ruling on it, and a world-space grid across a 52 mm
  // cylinder is a moire pattern rather than machining.
  tu.uGrid.value = 0.0;

  /* ── the floor plate ───────────────────────────────────────────────────
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
     Everything that is not the floor, the guarding, the paint or a part, as
     instances of one unit box. Boxes for a reason beyond tidiness: this
     material rotates normals by the instance matrix itself rather than by its
     inverse transpose, and a box is the shape that survives that, because its
     normals are the axes the scale is along -- a non-uniform scale changes
     their length and not their direction, and the fragment stage normalises
     anyway. */
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
  // magazine housing, and two posts carrying the whole thing off the floor.
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

  // The outfeed: the beam, seven saddles, three posts under it.
  const NX0 = Math.min(LOAD.x + 0.075, nestX(NESTS - 1) - 0.064);
  const NX1 = Math.max(LOAD.x + 0.075, nestX(NESTS - 1) - 0.064);
  put(NX0, NEST_Y - NEST_T - BEAM_T, LOAD.z - BEAM_HZ,
      NX1, NEST_Y - NEST_T, LOAD.z + BEAM_HZ);
  for (let j = 0; j < NESTS; j++) {
    const cx = nestX(j);
    put(cx - NEST_W * 0.5, NEST_Y - NEST_T, LOAD.z - NEST_W * 0.5,
        cx + NEST_W * 0.5, NEST_Y, LOAD.z + NEST_W * 0.5);
  }
  for (const px of [LOAD.x + OUT * -0.010, nestX((NESTS - 1) * 0.5), nestX(NESTS - 1)])
    put(px - POST * 0.5, DECK_Y, LOAD.z - POST * 0.5,
        px + POST * 0.5, NEST_Y - NEST_T - BEAM_T, LOAD.z + POST * 0.5);

  /* The gauge's C-frame: one column behind the track and a head cantilevered
     forward over it. The ram and its platen are the two instances in this mesh
     that move, and they are written after everything else so update() knows
     where they are. */
  const GX = nestX(GAUGE_AT);
  const GZ = LOAD.z - GPOST_HZ;                  // the column, behind the track
  const RAM_UP = NEST_Y + 2 * BILLET_H;          // platen face, retracted
  const RAM_DOWN = NEST_Y + BILLET_H;            // platen face, on the part
  const CROSS_Y = RAM_UP + PLATEN_T + RAM_H;     // underside of the head
  put(GX - GPOST * 0.5, DECK_Y, GZ - GPOST * 0.5,
      GX + GPOST * 0.5, CROSS_Y + CROSS_T, GZ + GPOST * 0.5);
  put(GX - GPOST * 0.5, CROSS_Y, GZ - GPOST * 0.5,
      GX + GPOST * 0.5, CROSS_Y + CROSS_T, LOAD.z + GREACH);

  /* The tote. Four walls and a floor rather than a solid block, because the
     one thing it has to do here is be open at the top: the finished part falls
     into it and is not seen again, and a lid on that is a box the part
     vanishes behind rather than a tote it lands in. */
  const TOTE_A = new THREE.Vector3(DROP_X, 0, LOAD.z);
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

  /* The controller: plinth, cabinet, a run of vent louvres across the face
     that is turned to the reader, and the beacon. */
  put(BOX_X - PLINTH_OUT, DECK_Y, BOX_Z - PLINTH_OUT,
      BOX_X + BOX_W + PLINTH_OUT, DECK_Y + PLINTH, BOX_Z + BOX_D + PLINTH_OUT);
  put(BOX_X, DECK_Y + PLINTH, BOX_Z, BOX_X + BOX_W, DECK_Y + PLINTH + BOX_H, BOX_Z + BOX_D);
  for (let i = 0; i < VENTS; i++) {
    const y0 = DECK_Y + PLINTH + BOX_H * (0.26 + i * 0.11);
    put(BOX_X + 0.055, y0, BOX_Z + BOX_D,
        BOX_X + BOX_W - 0.055, y0 + VENT_T, BOX_Z + BOX_D + 0.010);
  }
  const BEACON_X = BOX_X + BOX_W * 0.5, BEACON_Z = BOX_Z + BOX_D * 0.5;
  put(BEACON_X - 0.014, DECK_Y + PLINTH + BOX_H, BEACON_Z - 0.014,
      BEACON_X + 0.014, DECK_Y + PLINTH + BOX_H + 0.090, BEACON_Z + 0.014);
  for (let i = 0; i < 3; i++) {
    const y0 = DECK_Y + PLINTH + BOX_H + 0.090 + i * LAMP_H;
    put(BEACON_X - LAMP_R, y0, BEACON_Z - LAMP_R,
        BEACON_X + LAMP_R, y0 + LAMP_H * 0.86, BEACON_Z + LAMP_R);
  }

  /* The cable tray and its four drops. Each drop is a conduit off the tray at
     the height the thing it feeds is entered at, and a run along that height
     to the fixture, so what the reader sees is one spine with four branches
     rather than four unrelated pipes.

     Each of the four is routed round the machine rather than near it, and the
     one that has to cross the cell -- the magazine's, on the far side of the
     robot from the guarding -- goes out at x = 1.42, which puts its inboard
     face 64 mm outboard of the furthest right the shell ever reaches and
     leaves 0.118 between the two in three dimensions. The tightest of the
     four is the drop into the robot's own pad, at 0.075, and that one is
     supposed to be tight: it is the machine's own umbilical. */
  const TRAY_Z = GUARD_Z + TRAY_DZ;
  put(GUARD_X0 + GPOST_S, DECK_Y + TRAY_Y, TRAY_Z - TRAY_W * 0.5,
      GUARD_X1 - GPOST_S, DECK_Y + TRAY_Y + TRAY_T, TRAY_Z + TRAY_W * 0.5);
  const drop = (x, z, y) => {
    put(x - CONDUIT * 0.5, DECK_Y + y, TRAY_Z - CONDUIT * 0.5,
        x + CONDUIT * 0.5, DECK_Y + TRAY_Y, TRAY_Z + CONDUIT * 0.5);
    put(x - CONDUIT * 0.5, DECK_Y + y, TRAY_Z - CONDUIT * 0.5,
        x + CONDUIT * 0.5, DECK_Y + y + CONDUIT, z);
  };
  drop(BOX_X + BOX_W * 0.5, BOX_Z, PLINTH + BOX_H - 0.06);
  drop(GX, GZ, CROSS_Y - DECK_Y);
  drop(base.x, base.z - PAD_W * 0.5, PAD_T + 0.02);
  const FEED_RUN = BOX_X, FEED_ENTRY = FEED_Y + HOUSE_H - 0.05;
  drop(FEED_RUN, PICK.z, FEED_ENTRY - DECK_Y);
  put(HOUSE_X1, FEED_ENTRY, PICK.z - CONDUIT * 0.5,
      FEED_RUN, FEED_ENTRY + CONDUIT, PICK.z + CONDUIT * 0.5);

  const boxGeo = seedSurface(new THREE.BoxGeometry(1, 1, 1), boxes.length + 2, () => 0);
  /* A seed of nothing, deliberately, here and on everything else. The
     dissolve reads a world-space field, and with every instance reading it
     unshifted the erosion comes apart in patches that carry across the floor
     and up into whatever is standing on it -- a cell coming apart, rather
     than a hundred pieces of hardware coming apart privately. */
  const steel = new THREE.InstancedMesh(boxGeo, steelMat, boxes.length + 2);
  const m = new THREE.Matrix4();
  const box = (mesh, i, b) => {
    m.makeScale(b[3], b[4], b[5]);
    m.setPosition(ax + b[0], ay + b[1], az + b[2]);
    mesh.setMatrixAt(i, m);
  };
  for (let i = 0; i < boxes.length; i++) box(steel, i, boxes[i]);
  /* The ram, at the end of the list because it is the one that moves. Written
     once here as well as every frame in update(): an InstancedMesh hands out
     identity matrices until it is told otherwise, and an identity matrix is a
     unit cube standing at the world origin. update() does run before the
     first frame this group is visible for -- world.js sets visible and calls
     update in the same pass -- so this is belt and braces, and it is cheap. */
  const RAM = boxes.length;
  const ramBox = [GX, 0, LOAD.z, RAM_W, RAM_H, RAM_W];
  const platenBox = [GX, 0, LOAD.z, NEST_W, PLATEN_T, NEST_W];
  const ramAt = (face) => {
    ramBox[1] = face + PLATEN_T + RAM_H * 0.5;
    platenBox[1] = face + PLATEN_T * 0.5;
    box(steel, RAM, ramBox);
    box(steel, RAM + 1, platenBox);
  };
  ramAt(RAM_UP);
  group.add(steel);

  /* ── the guarding, the aisle and the building ──────────────────────────
     Its own mesh and its own material, and the split is the whole point: it
     is the only large thing in this cell that must not compete with the
     machine. Everything in here is behind the arm, dimmer than it, and
     mostly on its way into the fog. */
  const gbox = [];
  const gput = (x0, y0, z0, x1, y1, z1) =>
    gbox.push([(x0 + x1) * 0.5, (y0 + y1) * 0.5, (z0 + z1) * 0.5,
               Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0)]);

  /* One run of guarding between two points on the floor. Posts on a whole
     number of bays so the run ends on a post rather than mid-panel, rails top
     and bottom, and the mesh drawn as wires in both directions -- skipped over
     the gap, if the run has one, because a gate you can see through the mesh
     of is not a gate. */
  const GTOP = DECK_Y + GUARD_H;
  const guardRun = (x0, z0, x1, z1, gap) => {
    const dx = x1 - x0, dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    const ux = dx / len, uz = dz / len;
    const nx = -uz, nz = ux;                    // across the run
    const at = (s, o) => [x0 + ux * s + nx * o, z0 + uz * s + nz * o];
    const bays = Math.max(1, Math.round(len / GBAY));
    for (let i = 0; i <= bays; i++) {
      const [px, pz] = at(len * i / bays, 0);
      gput(px - GPOST_S * 0.5, DECK_Y, pz - GPOST_S * 0.5,
           px + GPOST_S * 0.5, GTOP, pz + GPOST_S * 0.5);
    }
    // The gate's own posts, so the opening is framed rather than just empty.
    if (gap) for (const s of gap) {
      const [px, pz] = at(s, 0);
      gput(px - GPOST_S * 0.5, DECK_Y, pz - GPOST_S * 0.5,
           px + GPOST_S * 0.5, GTOP, pz + GPOST_S * 0.5);
    }
    const inGap = s => gap && s > gap[0] && s < gap[1];
    const runBox = (s0, s1, y0, y1, half) => {
      const [ax0, az0] = at(s0, -half), [ax1, az1] = at(s1, half);
      gput(Math.min(ax0, ax1), y0, Math.min(az0, az1),
           Math.max(ax0, ax1), y1, Math.max(az0, az1));
    };
    for (const [y0, y1] of [[GTOP - GRAIL_T, GTOP],
                            [DECK_Y + GRAIL_LO, DECK_Y + GRAIL_LO + GRAIL_W]]) {
      if (gap) { runBox(0, gap[0], y0, y1, GRAIL_W * 0.5); runBox(gap[1], len, y0, y1, GRAIL_W * 0.5); }
      else runBox(0, len, y0, y1, GRAIL_W * 0.5);
    }
    // The wires start at the bottom rail's own underside and stop at the top
    // rail's, so the rails cover their ends the way a fixed panel does.
    const n = Math.floor(len / MESH_P);
    for (let i = 1; i < n; i++) {
      const s = len * i / n;
      if (inGap(s)) continue;
      const [px, pz] = at(s, 0);
      gput(px - WIRE * 0.5, DECK_Y + GRAIL_LO, pz - WIRE * 0.5,
           px + WIRE * 0.5, GTOP - GRAIL_T, pz + WIRE * 0.5);
    }
    const rows = Math.floor((GUARD_H - GRAIL_LO - GRAIL_T) / MESH_P);
    for (let i = 1; i <= rows; i++) {
      const y = DECK_Y + GRAIL_LO + i * MESH_P;
      if (gap) { runBox(0, gap[0], y, y + WIRE, WIRE * 0.5); runBox(gap[1], len, y, y + WIRE, WIRE * 0.5); }
      else runBox(0, len, y, y + WIRE, WIRE * 0.5);
    }
  };
  guardRun(GUARD_X0, GUARD_Z, GUARD_X1, GUARD_Z);
  guardRun(GUARD_X1, GUARD_Z, GUARD_X1, GUARD_ZR);
  guardRun(GUARD_X0, GUARD_Z, GUARD_X0, GUARD_ZR,
           [GATE_Z0 - GUARD_Z, GATE_Z1 - GUARD_Z]);

  /* The light curtain across the gate: two columns just inside the opening,
     with a band of optics up the face of each. The optics go on the face that
     looks across the gate, which is the only place a light curtain's optics
     can be -- so on the far column they are turned toward the reader and on
     the near one they are turned away and cannot be seen. That is what a
     photograph of a light curtain looks like and it is not worth cheating:
     two columns with a lens band on the one that faces you says emitter and
     receiver, and two columns both banded says decoration. */
  // Inboard of the fence line by half a post, half a column and 5 mm, so it
  // stands beside the gate post instead of inside it.
  const CURTAIN_X = GUARD_X0 + GPOST_S * 0.5 + CURTAIN_W * 0.5 + 0.005;
  for (const [z, side] of [[GATE_Z0, 1], [GATE_Z1, -1]]) {
    gput(CURTAIN_X - CURTAIN_W * 0.5, DECK_Y, z - CURTAIN_W * 0.5,
         CURTAIN_X + CURTAIN_W * 0.5, DECK_Y + CURTAIN_H, z + CURTAIN_W * 0.5);
    for (let i = 0; i < OPTICS; i++) {
      const y0 = DECK_Y + 0.12 + i * (CURTAIN_H - 0.20) / OPTICS;
      gput(CURTAIN_X - CURTAIN_W * 0.32, y0, z + side * CURTAIN_W * 0.5,
           CURTAIN_X + CURTAIN_W * 0.32, y0 + OPTIC_H, z + side * (CURTAIN_W * 0.5 + 0.008));
    }
  }

  /* The aisle conveyor, behind the guarding: two side frames, a run of slats,
     and the legs under it. Seen through the mesh and half taken by the fog,
     which is the whole of what it is for. */
  const AY = DECK_Y + AISLE_Y;
  for (const s of [-1, 1])
    gput(DECK_X0, AY - 0.075, AISLE_Z + s * AISLE_HZ - 0.020,
         DECK_X1, AY, AISLE_Z + s * AISLE_HZ + 0.020);
  const slats = Math.floor((DECK_X1 - DECK_X0) / SLAT_P);
  for (let i = 0; i < slats; i++) {
    const x = DECK_X0 + (i + 0.5) * SLAT_P;
    gput(x - SLAT_T * 0.5, AY - 0.030, AISLE_Z - AISLE_HZ,
         x + SLAT_T * 0.5, AY, AISLE_Z + AISLE_HZ);
  }
  // A leg every twelfth slat, which is 1.38 -- close enough to the building's
  // own bay that the two rhythms do not beat against each other.
  for (let i = 6; i < slats; i += 12) {
    const x = DECK_X0 + (i + 0.5) * SLAT_P;
    gput(x - 0.030, DECK_Y, AISLE_Z - 0.030, x + 0.030, AY - 0.075, AISLE_Z + 0.030);
  }

  // The building: columns on their bay and the tie between them, running out
  // of the top of the frame.
  for (let x = DECK_X0 + COL_BAY * 0.5; x < DECK_X1; x += COL_BAY)
    gput(x - COL_S * 0.5, DECK_Y, COL_Z - COL_S * 0.5,
         x + COL_S * 0.5, COL_TOP, COL_Z + COL_S * 0.5);
  gput(DECK_X0, TIE_Y, COL_Z - TIE_HZ, DECK_X1, TIE_Y + TIE_T, COL_Z + TIE_HZ);

  const guardGeo = seedSurface(new THREE.BoxGeometry(1, 1, 1), gbox.length, () => 0);
  const guard = new THREE.InstancedMesh(guardGeo, guardMat, gbox.length);
  for (let i = 0; i < gbox.length; i++) box(guard, i, gbox[i]);
  guard.instanceMatrix.needsUpdate = true;
  group.add(guard);

  /* ── the paint ─────────────────────────────────────────────────────────
     Flat boxes lying 3 mm proud of the plate. A dash on the envelope arc is
     rotated to its own tangent, which the material can carry: the instance
     matrix is a rotation about y with a scale along x and z, so the up-facing
     normal comes through it as (0, sy, 0) and normalises back to straight up.
     Any other axis of rotation would shear it.

     A dash is laid out along its own local x, because makeRotationY(a) sends
     local x to (cos a, 0, -sin a) and that is the tangent to a circle
     parametrised as (sin a, cos a) -- local z would have sent it along the
     radius instead, which is a row of ties across the arc rather than an arc. */
  const paint = [];
  const PY = DECK_Y + PAINT_T;
  const dash = (x, z, yaw, len, wid) => paint.push([x, z, yaw, len, wid]);

  /* The envelope. Swept from where the arc meets the inside face of the far
     guarding, round the front and back to the same place on the other side,
     and clipped to the two side runs -- so what is drawn is the whole of the
     part of it that is inside the cell, and nothing else. */
  const A0 = Math.acos(Math.max(-1, Math.min(1, (GUARD_Z + 0.04 - base.z) / REACH)));
  const step = (DASH + DASH_GAP) / REACH;
  for (let a = -A0; a <= A0 + 1e-6; a += step) {
    const x = base.x + REACH * Math.sin(a), z = base.z + REACH * Math.cos(a);
    // Inside the guarding and nowhere else. The arc's widest point is at
    // x = 2.238, which is 88 mm outboard of the right-hand fence, and paint
    // laid down outside the cell is paint on the wrong side of the barrier.
    if (x < GUARD_X0 || x > GUARD_X1) continue;
    dash(x, z, a, DASH, DASH_W);
  }
  // The operator band across the mouth of the guarding.
  for (const z of [GUARD_ZR - BAND_W, GUARD_ZR])
    dash((GUARD_X0 + GUARD_X1) * 0.5, z, 0, GUARD_X1 - GUARD_X0, BAND_LINE);

  const paintGeo = seedSurface(new THREE.BoxGeometry(1, 1, 1), paint.length, () => 0);
  const paintMesh = new THREE.InstancedMesh(paintGeo, paintMat, paint.length);
  {
    const rot = new THREE.Matrix4(), scl = new THREE.Matrix4();
    for (let i = 0; i < paint.length; i++) {
      const p = paint[i];
      rot.makeRotationY(p[2]);
      scl.makeScale(p[3], PAINT_T, p[4]);
      m.multiplyMatrices(rot, scl);
      m.setPosition(ax + p[0], ay + PY - PAINT_T * 0.5, az + p[1]);
      paintMesh.setMatrixAt(i, m);
    }
  }
  paintMesh.instanceMatrix.needsUpdate = true;
  group.add(paintMesh);

  /* ── the stock ─────────────────────────────────────────────────────────
     Eight on the infeed, seven on the outfeed, one in the gripper, and four
     standing in the tote. The layout is fixed because update() walks it by
     index and nothing else says which billet is which. */
  const FEED0 = 0;
  const NEST0 = FEED0 + FEED_SLOTS;
  const HELD = NEST0 + NESTS;
  const IDLE0 = HELD + 1;
  const IDLE = 4;
  const nStock = IDLE0 + IDLE;

  const stockGeo = seedSurface(
    new THREE.CylinderGeometry(BILLET_R, BILLET_R, BILLET_H, SIDES), nStock, () => 0);
  const stock = new THREE.InstancedMesh(stockGeo, stockMat, nStock);

  /* Where the retired stock stands: four already in the tote and, at the end
     of this list, the parking place for the one the gripper has just let go
     of. Five positions on an ellipse round the tote's centre rather than a
     scatter, because a scatter is what they were and two of them were 22 mm
     apart -- two 52 mm billets occupying the same 30 mm of floor. On an
     ellipse 0.085 by 0.062 at 72 degrees apart the closest pair is 0.0728 and
     the closest any of them comes to the centre, which is where the part
     dropping off the end of the beam lands, is 0.0646. Both are clear of the
     0.052 two of these can be no closer than, and the ring's own extremes,
     0.085 and 0.059, are inside the 0.102 by 0.072 the tote's walls leave.

     None of it is ever seen. Their tops sit 53 mm below the rim, which is
     what makes the tote a place a part can be retired into without the
     retirement being visible, and the arithmetic is here so that the frames
     nobody looks at are still frames nothing is wrong in. */
  const IDLE_AT = [];
  for (let k = 0; k < IDLE + 1; k++) {
    const a = (0.1 + k * 0.2) * Math.PI * 2;
    IDLE_AT.push([Math.cos(a) * 0.085, Math.sin(a) * 0.062]);
  }
  const IDLE_Y = DECK_Y + TOTE_WALL + BILLET_MID;

  const billet = (i, x, y, z) => {
    m.makeScale(1, 1, 1);
    m.setPosition(ax + x, ay + y, az + z);
    stock.setMatrixAt(i, m);
  };
  for (let k = 0; k < IDLE; k++)
    billet(IDLE0 + k, TOTE_A.x + IDLE_AT[k][0], IDLE_Y, TOTE_A.z + IDLE_AT[k][1]);
  group.add(stock);

  /* Where a part rests on each of the two surfaces, and how far the one that
     is retired has to fall to reach the floor of the tote. */
  const FEED_REST = FEED_Y + BILLET_MID;
  const NEST_REST = NEST_Y + BILLET_MID;
  const FALL = NEST_REST - IDLE_Y;

  const us = [du, su, gu, pu, tu];
  const held = new THREE.Vector3();

  /* The part that has just been let go of, parked where it cannot be seen.
     Retiring it into the tote rather than scaling it away costs the same and
     means there is no frame in which an instance is a degenerate triangle. */
  const PARK = [TOTE_A.x + IDLE_AT[IDLE][0], IDLE_Y, TOTE_A.z + IDLE_AT[IDLE][1]];

  return {
    group,
    /* A frame is fifteen uniform writes, sixteen instance matrices -- eight on
       the infeed, seven on the outfeed and the one in the gripper -- and the
       ram's two boxes. The tool point behind that last billet costs a pose
       interpolation and six matrix multiplies, all of them into arrays
       allocated at build. Nothing here allocates and nothing here counts
       frames. */
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
        billet(NEST0 + j, nestX(j + g),
               NEST_REST + rise - (last ? FALL * drop * drop : 0), LOAD.z);
      }

      /* The gauge. Down, held, up, once per out-and-back, in the stretch of
         phase the beam is not using. The hold is what makes it a gauge rather
         than a tap: the platen is on the part for 0.20 of phase, which at
         fourteen seconds to the unit is 2.8 s, and a probe that touches and
         leaves inside one frame of a software rasteriser is a probe nobody
         sees. */
      const rq = ease((phase - RAM_W0) / (RAM_W1 - RAM_W0))
               - ease((phase - RAM_W2) / (RAM_W3 - RAM_W2));
      ramAt(RAM_UP + (RAM_DOWN - RAM_UP) * rq);
      steel.instanceMatrix.needsUpdate = true;

      // And the one in the gripper, which is the tool point itself less the
      // 14 mm the fingers sit down the part.
      if (phase < PLACE) billet(HELD, held.x, held.y + GRIP - BILLET_MID, held.z);
      else billet(HELD, PARK[0], PARK[1], PARK[2]);
      stock.instanceMatrix.needsUpdate = true;

      /* The part being handled is the lit one. uFocus lights a single
         instance teal and the caller has nothing at this station to spend it
         on -- there is no card list here to read against -- so it is spent on
         the only thing in the cell whose identity changes: whatever is in the
         gripper while there is something in it, and the part under the gauge
         while there is not, which is the part the cell is working on. The
         other four materials carry their own uFocus, which is never written
         and stays at -1. */
      tu.uFocus.value = phase < PLACE ? HELD : NEST0 + GAUGE_AT - 1;
    },
    dispose() {
      deckGeo.dispose();
      boxGeo.dispose();
      guardGeo.dispose();
      paintGeo.dispose();
      stockGeo.dispose();
      deckMat.dispose();
      steelMat.dispose();
      guardMat.dispose();
      paintMat.dispose();
      stockMat.dispose();
    }
  };
}

/* The fixed hardware of this cell, in world space, as axis-aligned boxes --
 * [cx, cy, cz, sx, sy, sz] -- for anything that has to agree with it without
 * being it.
 *
 * world/formations/hero.js is the one caller. The solid erodes into the
 * substrate on the way out of this station and the substrate had nothing of
 * the cell in it: the machine dissolved into a cloud of itself and the cell it
 * was standing in dissolved into nothing at all, which is the one thing that
 * crossing is not supposed to be. So the formation samples these edges and
 * writes them as structure, and what comes apart and what arrives are the
 * same list read twice.
 *
 * Edges rather than surfaces, at the formation's end: a box drawn as twelve
 * lines is a box, and a box drawn as a filled volume of points is a smudge.
 * That decision is the caller's; this returns the boxes.
 *
 * The large forms and not every bracket. The bolts, the guides, the vents, the
 * beacon, the light curtain and the conduits are all in the solid and none of
 * them are here: a 26 mm bolt head is 0.31 m of edge and 21 points, which is a
 * smear in the cloud rather than a bolt, and twenty of them together are less
 * than the plate's near edge on its own. What the crossing has to carry is the
 * shape of the cell.
 *
 * It rebuilds the layout rather than reading it off a built group, and that
 * is deliberate. The formation is baked before any solid exists -- world.js
 * bakes the substrate and only then imports world/solids/ -- so there is no
 * group to walk, and a build(ctx) called for its geometry would allocate five
 * materials and five buffers to be thrown away. Everything here is a pure
 * function of world/kinematics.js and the constants above.
 */
export function cellFrame() {
  const q = new Array(6);
  const frames = Array.from({ length: 6 }, () => new THREE.Matrix4());
  const tool = (u) => {
    poseAt(u, q);
    linkFrames(q, frames);
    return toolPoint(frames, new THREE.Vector3()).applyMatrix4(UPRIGHT).add(ARM_BASE);
  };
  const PICK = tool(0), LOAD = tool(PLACE);
  const DECK_Y = ARM_BASE.y - PAD_T;
  const FEED_Y = PICK.y + GRIP - BILLET_H;
  const NEST_Y = LOAD.y + GRIP - BILLET_H;
  const nestX = j => LOAD.x - j * PITCH;

  const out = [];
  const put = (x0, y0, z0, x1, y1, z1) =>
    out.push([(x0 + x1) * 0.5, (y0 + y1) * 0.5, (z0 + z1) * 0.5,
              Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0)]);

  /* The plate, as its top face alone and nothing else. Zero height is not a
     shortcut: the caller turns each box into twelve edges and skips the eight
     that are degenerate, so a flat box is a rectangle. Given the slab's real
     55 mm it would have written its underside as well, and the underside of
     the floor is 22.24 m of line -- an eighth of everything the caller would
     then have to spend its budget on -- drawn where nothing can see it. */
  put(DECK_X0, DECK_Y, DECK_Z0, DECK_X1, DECK_Y, DECK_Z1);
  // The pad.
  put(ARM_BASE.x - PAD_W * 0.5, DECK_Y, ARM_BASE.z - PAD_W * 0.5,
      ARM_BASE.x + PAD_W * 0.5, DECK_Y + PAD_T, ARM_BASE.z + PAD_W * 0.5);
  // The infeed: bed and housing.
  put(PICK.x - 0.075, FEED_Y - CHAN_T, PICK.z - FEED_HZ, HOUSE_X1, FEED_Y, PICK.z + FEED_HZ);
  put(HOUSE_X0, FEED_Y - CHAN_T, PICK.z - HOUSE_HZ, HOUSE_X1, FEED_Y + HOUSE_H, PICK.z + HOUSE_HZ);
  // The outfeed: beam and saddles.
  put(nestX(NESTS - 1) - 0.064, NEST_Y - NEST_T - BEAM_T, LOAD.z - BEAM_HZ,
      LOAD.x + 0.075, NEST_Y - NEST_T, LOAD.z + BEAM_HZ);
  for (let j = 0; j < NESTS; j++)
    put(nestX(j) - NEST_W * 0.5, NEST_Y - NEST_T, LOAD.z - NEST_W * 0.5,
        nestX(j) + NEST_W * 0.5, NEST_Y, LOAD.z + NEST_W * 0.5);
  // The gauge's C-frame.
  const GX = nestX(GAUGE_AT), GZ = LOAD.z - GPOST_HZ;
  const CROSS_Y = NEST_Y + 2 * BILLET_H + PLATEN_T + RAM_H;
  put(GX - GPOST * 0.5, DECK_Y, GZ - GPOST * 0.5,
      GX + GPOST * 0.5, CROSS_Y + CROSS_T, GZ + GPOST * 0.5);
  put(GX - GPOST * 0.5, CROSS_Y, GZ - GPOST * 0.5,
      GX + GPOST * 0.5, CROSS_Y + CROSS_T, LOAD.z + GREACH);
  // The tote, as an open box.
  {
    const c = new THREE.Vector3(nestX(NESTS), 0, LOAD.z);
    put(c.x - TOTE_W * 0.5, DECK_Y, c.z - TOTE_D * 0.5,
        c.x + TOTE_W * 0.5, DECK_Y + TOTE_H, c.z + TOTE_D * 0.5);
  }
  // The controller and its plinth.
  put(BOX_X - PLINTH_OUT, DECK_Y, BOX_Z - PLINTH_OUT,
      BOX_X + BOX_W + PLINTH_OUT, DECK_Y + PLINTH, BOX_Z + BOX_D + PLINTH_OUT);
  put(BOX_X, DECK_Y + PLINTH, BOX_Z, BOX_X + BOX_W, DECK_Y + PLINTH + BOX_H, BOX_Z + BOX_D);
  // The guarding, as the three planes it is rather than as a hundred wires.
  const GTOP = DECK_Y + GUARD_H;
  put(GUARD_X0, DECK_Y, GUARD_Z - GPOST_S * 0.5, GUARD_X1, GTOP, GUARD_Z + GPOST_S * 0.5);
  put(GUARD_X1 - GPOST_S * 0.5, DECK_Y, GUARD_Z, GUARD_X1 + GPOST_S * 0.5, GTOP, GUARD_ZR);
  put(GUARD_X0 - GPOST_S * 0.5, DECK_Y, GUARD_Z, GUARD_X0 + GPOST_S * 0.5, GTOP, GUARD_ZR);
  // The cable tray.
  put(GUARD_X0, DECK_Y + TRAY_Y, GUARD_Z + TRAY_DZ - TRAY_W * 0.5,
      GUARD_X1, DECK_Y + TRAY_Y + TRAY_T, GUARD_Z + TRAY_DZ + TRAY_W * 0.5);
  /* The aisle. Not the building: four columns 2.18 tall are 39.7 m of edge,
     a fifth of everything the caller would then be sharing its budget over,
     spent on the part of the shot the fog has already taken more than half of.
     What comes apart there is four dim verticals and what the cloud owes them
     is nothing. */
  put(DECK_X0, DECK_Y + AISLE_Y - 0.075, AISLE_Z - AISLE_HZ,
      DECK_X1, DECK_Y + AISLE_Y, AISLE_Z + AISLE_HZ);
  return out;
}
