/* Station 05, solid -- the origin, the floor it is the origin of, and the
 * set-out that floor carries.
 *
 * The last station is the only one that ends with less than it started with,
 * and the solid half has to honour that rather than quietly undo it: the
 * contact details are the last thing anybody reads and the world's remaining
 * duty is to stop competing with them, so anything added here is an object
 * standing between the reader and an email address.
 *
 * That reasoning is right about the priority and it has now been wrong twice
 * about the execution, in the same direction both times.
 *
 * The first was the floor. It used to stand 3.11 metres under the anchor, far
 * enough down that it first came into view 9.9 metres ahead and everything
 * between the frame and the cloud's horizon was empty on purpose. What that
 * produced is not restraint, it is an empty rectangle: measured on the render
 * half at 1916x953 this station came back at p90 = 16 of 255 and 3.2% of it
 * over 100, against About's 141 and the corridor's 119, and almost all of the
 * 3.2% was the three shafts themselves.
 *
 * The second is what the floor was left as: a disc with nothing on it. Take
 * the composition apart at 1916x953 and the whole solid lives inside 654
 * pixels of the frame's middle -- the knot at (1008, 700), the vertical arm's
 * tip at (1008, 108), the two floor arms ending at (681, 633) and (1335, 633)
 * -- and the reading column is 900 pixels wide and centred, so every one of
 * those is behind type. What is left in the two margins the reader actually
 * sees the world through is a grey gradient. Quiet is not the same as empty,
 * and one object plus a disc is empty.
 *
 * So the floor is set out. Not with more objects near the camera, which is
 * the one thing this station cannot afford, but with the marks a surveyed
 * site carries: the two floor axes scribed across the whole room, a circle at
 * the arm's own length, and two ranges -- 6.2 metres, which is the distance
 * back to Path, and 12.8, which is the distance back to Measured and Stack
 * and is also, within a pixel, where this floor ends. It is all ground rather
 * furniture, and being radial it runs outward into exactly the margins the
 * frame was empty in: the scribes leave the frame at (0, 499) and (1916, 521)
 * going away and through the two bottom corners coming back, and the marks
 * make two rows across it, at rows 457 to 513 and 425 to 456. Nothing new
 * stands near the eye, and every distance in it is one the page can be
 * checked against.
 *
 * The frame is the cloud's frame: the same 1.10 arms, the same three-eighths
 * of a turn, the same knot at the origin, copied out of
 * world/formations/contact.js rather than imported because the formation
 * publishes its view and its fill and nothing else. The two have to be one
 * object seen twice or the settle is a swap.
 *
 * What solid buys a triad is the thing points could never give it: the arm in
 * front hides the arm behind it. Three additive strands crossing at a point
 * are a star drawn on the glass; three shafts meeting at a block are three
 * things at three depths, and depth is the entire content of a coordinate
 * frame. What the floor buys it is the other half of that -- the post pass
 * takes its occlusion off the depth buffer, so a shaft lying on a surface
 * darkens the surface along its length, and until there was a surface within
 * three metres of the frame there was nothing for it to darken.
 */
import * as THREE from "three";
import { makeSurface, seedSurface } from "../materials/surface.js";

/* Long arms, yawed so both floor arms lie at 45 degrees to the view -- square
   on, one of them points down the barrel of the lens and reads as a dot. */
const ARM = 1.10, YAW = Math.PI * 0.75;

/* The shafts, tapered from the knot to the tip. At 2.9 metres through a 34
   degree lens a 900 pixel frame is about 507 pixels to the metre, so 0.056
   across at the root comes out at 28 pixels and 0.018 at the tip at nine: the
   taper is legible along the whole arm instead of being a claim the last ten
   centimetres makes. The taper is also the arrowhead. An axis that thins has
   a direction already, and a cone stuck on the end of it is a second object
   to draw, occlude and dissolve for no more meaning than the shape carried
   by itself. */
const ROOT_R = 0.028, TIP_R = 0.009;

/* The knot, which the cloud scatters through 0.055 either side of the origin,
   and the markers that finish each arm. 0.045 terminates an 0.018 tip without
   out-weighing the 0.11 the three arms come out of: the tips of a frame are
   nodes, not three more origins. */
const KNOT = 0.11, NODE = 0.045;

/* The floor, and where it has to be for the frame to be standing on it.
 *
 * At the shaft's own root radius under the axes, which is the one height that
 * works. Level with them the plane cuts every arm along its axis and the tips
 * -- 0.009 of radius after the taper -- lose half of the four pixels they
 * have; a hand's breadth lower and three horizontal shafts hang in the air
 * over a surface, which is worse than no surface at all. At -0.028 the roots
 * are tangent to it, the tips clear it by 19 mm, and the knot, 0.11 across
 * with 55 mm of itself below the axes, is set 27 mm into the ground. Which is
 * what an origin is: a monument you can only see the top of.
 *
 * And it is set into the ground rather than raised on a plinth, which was
 * tried on paper and does not exist. The shafts taper 0.028 to 0.009 over
 * 1.10, so an arm's underside climbs 17.3 mm per metre out of a floor it is
 * tangent to at the root and has 19 mm of clearance only at its own tip. A
 * plinth is highest where it is stood on and the arms are lowest there, so
 * any pad proud of this floor by anything worth seeing crosses all three of
 * them. The monument has no base. That is what its being an origin costs.
 *
 * A disc, and the radius is the cloud's own. The horizon band in
 * world/formations/contact.js runs from 7 to 13 metres, so the floor stops
 * where that stops -- one horizon drawn twice rather than a plane carrying on
 * past the only thing on the page that says where the room ends. Finite also
 * means it cannot turn up where it is not wanted: a 60-metre plane at this
 * height would lie across the whole corridor behind it, and the camera is
 * still inside that corridor for the first half of the crossing into here.
 *
 * The composition survives the move. The eye stands 0.628 over the new
 * surface, so on a 953-row frame the vanishing line is row 381, the floor
 * enters the bottom of the frame 1.7 metres ahead, and the knot at row 700 is
 * standing on ground 3.0 metres out. */
const GROUND_Y = -ROOT_R, GROUND_R = 13.0;

/* Where the eye stands, copied from VIEW in world/formations/contact.js for
   the same reason the arm length is: the formation exports its view and its
   fill, and this file has to know the standoff to say anything true about how
   far away its own far edge is. 2.90 back and 0.60 up, which over a floor at
   -0.028 is 0.628 of eye height.

   It is needed because of a unit mistake that survived a whole session here.
   The floor's fog used to end at GROUND_R, on the grounds that the disc ends
   there too -- but uFogFar is compared against the distance from the *eye*
   and GROUND_R is a radius about the anchor, and the eye is not at the
   anchor. Straight ahead the rim is 13.0 + 2.90 out and 0.628 up, which is
   15.91 metres, so fogging to 13 took the ground to background at radius
   10.09 and left the last 2.9 metres of it -- the band the far range marks
   stand in -- fading out from under them. */
const STANDOFF = 2.90, EYE_Y = 0.60 - GROUND_Y;
const RIM_D = Math.hypot(GROUND_R + STANDOFF, EYE_Y);

/* The ranges, and both of them are a distance this page actually has.
 *
 * world/config.js strings the stations down the corridor at z = 0, -6.6,
 * -13.2, -19.8 and -26.0, and this one is the last of them. So the distance
 * back to Path is 6.2 metres, to Measured and Stack 12.8, to Work 19.4 and to
 * the hero 26.0. Two of those fit in this room and two do not, and that is
 * worth saying rather than working around: the page is bigger than the room
 * it ends in, and the two that fit are the two most recently read.
 *
 * The far one is the better fact of the two. Its arc lands at rows 443 to 457
 * of a 953-row frame and the disc's own rim lands at 442 to 456 -- one row
 * apart. So the range ring for the station before last and the edge of the
 * room are not two things, they are one line seen once, with 145 mm of floor
 * left behind it. */
const RANGE = [6.2, 12.8];

/* What carries a range is the marks standing on it and not the line under
   them, and that is a measurement rather than a taste. A ring painted on a
   floor is a band of constant *radial* width read at a grazing angle, and
   radius is the one direction this view has no resolution in: at 0.056 across
   -- the shaft's own root -- the 6.2 ring comes out 0.7 pixels thick where it
   crosses the middle of the frame and 2.9 at the edges, and the 12.8 ring 0.2
   and 1.0. Widen it until the middle reads at four pixels and the edges are a
   seventeen-pixel smear; the same band cannot be both. Height has no such
   problem, because height is the one axis the frame is not grazing along.

   So a range is a row of marks standing on it: a post the section of the knot,
   0.11 square, standing the height of the cloud's own haze bank, 0.18, so
   whatever weather lies at the room's edge is exactly as tall as the edge.
   Set one arm apart on both rings, which is the same net at two distances and
   lets the perspective say which is which -- 35 marks at 6.2 and 73 at 12.8,
   of which a 1916-wide frame holds nine of the near row at 19 pixels across
   and 38 tall, 191 to 244 pixels apart, and sixteen of the far row at 11 by
   21, 109 to 147 apart. More gap than mark at both, on purpose: the last
   screen of the page is where somebody leaves, and a wall is the wrong thing
   to end on. */
const POST_H = 0.18, POST_R = KNOT;

/* Half the width of a scribed line, so a scribe is twice this across. 0.056
   was the first answer -- the shaft's own root -- and it is the one figure
   here that was argued rather than looked at: rendered, the near end of a
   scribe came out 20 pixels wide and the far end 9, which is not a line ruled
   into a floor, it is paint on a pitch. 0.018 is the shaft's *tip* instead,
   the width of the mark an axis would leave where it ends, and it comes out
   6.5 pixels where the scribe leaves the arm and 2.9 at the far range. */
const SCRIBE = TIP_R;

const BASE = "#bcd2d8";

/* Two triangles, given four corners in the ground plane. Everything on this
   floor is flat and faces up, so the normal is not worth carrying per shape. */
function quad(out, x0, z0, x1, z1, x2, z2, x3, z3) {
  out.push(x0, 0, z0, x1, 0, z1, x2, 0, z2,
           x0, 0, z0, x2, 0, z2, x3, 0, z3);
}

/* A ring, as the strip between two radii. */
function ringBand(out, r, half, seg) {
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2, b = ((i + 1) / seg) * Math.PI * 2;
    const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
    quad(out, (r - half) * ca, (r - half) * sa, (r + half) * ca, (r + half) * sa,
              (r + half) * cb, (r + half) * sb, (r - half) * cb, (r - half) * sb);
  }
}

/* A straight scribe: a band along a direction in the ground plane, running
   between two offsets measured from a centre. Centre and direction are apart
   because the scribes run out of the origin and the ticks across them do
   not. */
function lineBand(out, cx, cz, dx, dz, from, to, half) {
  const px = -dz * half, pz = dx * half;
  quad(out, cx + dx * from - px, cz + dz * from - pz,
            cx + dx * to   - px, cz + dz * to   - pz,
            cx + dx * to   + px, cz + dz * to   + pz,
            cx + dx * from + px, cz + dz * from + pz);
}

export function build(ctx) {
  const anchor = ctx.anchor;
  const pal = ctx.pal || {};
  const budget = (ctx.quality && ctx.quality.substrate) || 0;

  /* The curves on this station, so these are the only segment counts there is
     to spend. A shaft 28 pixels across is held within a third of a pixel of a
     true circle by fourteen sides and two thirds of one by ten; six leaves it
     two pixels out of round, and six goes to the tier already drawing at one
     device pixel per CSS pixel.

     The floor's rim is the cheaper of the two even though it is far bigger,
     because of where it is: at 13 metres a 96-sided ring is 7 mm off a true
     circle, which is two thirds of a pixel there, and the fog has taken most
     of it by then in any case. Forty sides is 40 mm out, four pixels, and it
     is four pixels of an edge that is already background.

     The set-out's two circles borrow RIM and it is generous rather than
     tight. Forty sides is the worst case and it puts the ARM circle's chord
     3.4 mm off true, which is two pixels where that circle is read, and the
     6.2 circle 19 mm, which is 3.5. The scribes need neither, having no
     curvature to approximate, and a range is a row of blocks whose spacing is
     a length rather than a subdivision, so it costs the same on every tier. */
  const SIDES = budget >= 60000 ? 14 : budget >= 26000 ? 10 : 6;
  const RIM = budget >= 60000 ? 96 : budget >= 26000 ? 64 : 40;

  const group = new THREE.Group();
  const frame = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), YAW);

  /* The three arms, taken off the frame's own basis rather than written out,
     which is how the cloud reads them too -- an axis is a column of the
     rotation, and two ways of spelling the same rotation are two things that
     can drift. */
  const dirs = [
    new THREE.Vector3(1, 0, 0).applyQuaternion(frame),
    new THREE.Vector3(0, 1, 0).applyQuaternion(frame),
    new THREE.Vector3(0, 0, 1).applyQuaternion(frame)
  ];

  const mat = makeSurface({ base: BASE, accent: pal["--landing-accent"],
                            teal: pal["--landing-teal"], fog: pal["--landing-bg"] });
  /* The frame is left on the material's own fog window on purpose. It stands
     2.9 to 3.8 metres from the eye, where that window has barely opened --
     four parts in a thousand at the furthest corner of it -- so the last
     thing the page shows is the one thing the atmosphere does not get to
     eat. The floor below gets a window of its own instead. */

  const UP = new THREE.Vector3(0, 1, 0);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const at = new THREE.Vector3();
  const scale = new THREE.Vector3();

  /* Origin at the middle of the shaft, +Y at the tip, so an instance is a
     rotation onto its own axis and a step half an arm along it. All three
     share one geometry and one draw call; three separate meshes would be
     three of each for a frame that is a single rigid object. */
  const shaftGeo = seedSurface(
    new THREE.CylinderGeometry(TIP_R, ROOT_R, ARM, SIDES), dirs.length);
  const shafts = new THREE.InstancedMesh(shaftGeo, mat, dirs.length);
  for (let i = 0; i < dirs.length; i++) {
    q.setFromUnitVectors(UP, dirs[i]);
    at.copy(dirs[i]).multiplyScalar(ARM / 2).add(anchor);
    shafts.setMatrixAt(i, m4.compose(at, q, scale.set(1, 1, 1)));
  }
  shafts.instanceMatrix.needsUpdate = true;
  group.add(shafts);

  /* The tips first and the knot last, so the markers carry the same instance
     indices as the shafts they finish -- lighting an axis lights its whole
     arm -- and the knot takes index three, one past the last axis there is,
     where no focus the frame could be asked for can reach it. All four are
     turned with the frame: a marker squared to the world at the end of an arm
     that is not says the two were built by different hands. */
  const blocks = [];
  for (const d of dirs) blocks.push([d.clone().multiplyScalar(ARM).add(anchor), NODE]);
  blocks.push([anchor.clone(), KNOT]);

  const blockGeo = seedSurface(new THREE.BoxGeometry(1, 1, 1), blocks.length);
  const nodes = new THREE.InstancedMesh(blockGeo, mat, blocks.length);
  for (let i = 0; i < blocks.length; i++) {
    const s = blocks[i][1];
    nodes.setMatrixAt(i, m4.compose(blocks[i][0], frame, scale.set(s, s, s)));
  }
  nodes.instanceMatrix.needsUpdate = true;
  group.add(nodes);

  /* The floor: one disc and its own material, dark against the frame's own
     tone, because this is not an object -- it is what keeps the frame from
     standing in a void -- and a floor bright enough to read as a surface in
     its own right is a floor the reader starts looking at instead of the
     address.

     A tenth was the figure when the surface was 3.11 down and 9.9 metres
     away, and a tenth does not survive being read at three metres: rendered
     at 1916x953 it came back at 4 of 255 against an atmosphere already
     sitting at 8 to 12, which is a floor that is there in the depth buffer
     and nowhere else. The reason the arithmetic missed by so much is worth
     writing down, because it will catch the next value chosen off a shader
     line: the tone curve in world/materials/post.js has a very long toe, and
     below about 0.05 of scene radiance it is nearly the straight line
     0.214 * x. Everything in this room is below 0.05. A number that looks
     like a fifth of the frame's brightness in the material is a twentieth of
     it on the glass.

     0.28 was solved on the render rather than on the shader. 0.34 put the
     floor three metres ahead at 46 of 255 against the frame's own arm at 57,
     which is a floor and a frame at the same value; 0.28 puts it at 34, a
     third of the shaft's 133 peak and three times the atmosphere's 12.
     Bright enough to be a surface with the frame's contact darkening
     visible on it, dark enough that nothing on it is worth reading. */
  const groundMat = makeSurface({
    base: new THREE.Color(BASE).multiplyScalar(0.28),
    accent: pal["--landing-accent"], teal: pal["--landing-teal"],
    /* The fog colour is whatever is behind the fog, and at this station that
       is not the page's background. Every other surface on this page fades
       over a window that has barely opened before the geometry runs out, so
       the colour it fades toward has never had to be right; this is the first
       one that goes all the way to nothing inside the frame, and what it goes
       to nothing in front of is the atmosphere.

       --landing-bg is #0a0a0a, which through this pipeline is 0 of 255 on the
       glass, and the atmosphere at the row the horizon lands on measures 12.
       So a floor fogged to the background fades *past* what it is covering
       and out the other side: measured, the far ground came back at 2 where
       the sky it replaced had been 11, and the horizon was a dark band with a
       lighter sky over it -- the one thing worse than no horizon. Lifted
       3.5% toward --landing-fg the fog renders at 9 instead of 0, which is
       within three levels of the atmosphere it is standing in front of, and
       the ground stops being ground without anything happening at the place
       where it stops. */
    fog: new THREE.Color(pal["--landing-bg"])
      .lerp(new THREE.Color(pal["--landing-fg"]), 0.035),
    instanced: false
  });
  const gu = groundMat.userData.uniforms;
  /* No ruling, and the reason outlived the floor moving -- it got worse. A
     world-space grid has a world-space period and a floor is read at a
     grazing angle, so the period collapses with distance while the line width
     does not: at the material's 6.5 rules to the metre the ruling is 9 rows
     apart four metres ahead of the eye and 2 rows apart at eight, which is a
     moire pattern rather than machining. The shader's own fade cannot save it
     because it runs on view distance rather than on grazing angle -- at eight
     metres it has taken 41% of a ruling that is already aliasing -- and this
     would be the busiest thing on the quietest screen of the page.

     That argument is against a *periodic* ruling and it does not reach the
     set-out below. Four scribes cannot beat against a pixel grid, because
     there is nothing for them to beat against: aliasing is what happens when
     a period gets near the sample spacing, and four lines placed by hand have
     no period at all. */
  gu.uGrid.value = 0;
  /* Faded across the room, which is a distance from the eye and not a radius
     -- see RIM_D. Untouched to 4 metres, half gone at 9.95, and the page's
     own background at 15.91, which is where the disc's far rim is and so
     where the ground has run out anyway. Straight ahead that puts the
     half-way point at radius 7.03, row 479 of 953, ninety-eight rows under
     the vanishing line: the ground is a surface at the frame's feet, is
     weather by the time it reaches the cloud's horizon band, and is gone at
     the same place it stops.

     Swept against the old 13.0 on the same frame, the difference lands where
     it should. The band the near range marks stand in, rows 458 to 515, goes
     from 17.9 of 255 to 21.7; the middle of the floor from 24.2 to 25.5; the
     ground under the eye does not move at all, because there was never any
     fog on it; the sky does not move, because it is not this material. What
     it does not do is rescue the room's edge -- rows 425 to 458 go 13.3 to
     14.0, because both windows have very nearly finished by the time they
     reach 14 metres. The edge is read off the marks standing on it. The
     ground only has to still be there underneath them. */
  gu.uFogNear.value = 4.0;
  gu.uFogFar.value = RIM_D;
  const ground = new THREE.Mesh(new THREE.CircleGeometry(GROUND_R, RIM), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(anchor.x, anchor.y + GROUND_Y, anchor.z);
  group.add(ground);

  /* The set-out, in one buffer and one draw call: two circles, four scribes
     and the ticks across them, all of them flat, all of them facing up, so
     they take exactly the floor's own shading and differ from it in nothing
     but tone. That is the whole trick -- a mark on a floor is not a light, it
     is a paler patch of floor, and anything that shades differently from the
     surface it lies on reads as an object hovering over it.

     Where the ticks lie across the circle and the scribes, the coincident
     faces cost nothing and are left alone. Everything in this buffer is one
     tone with one normal; two surfaces at the same depth only fight when they
     disagree about what colour they are.

     The two circles are not drawn at the same width, because a line on a
     floor is only as thick as the direction it is read in.

     The one at the arm's own length is read across the view over most of its
     visible length -- the eye is 2.9 metres from a circle 1.1 in radius, so
     what fills the frame is its two sides, where the radius runs sideways --
     and at the scribe's own width it comes out 13 pixels there against 1 at
     its far point. So it is the same line as the axes and belongs to them,
     and it spans rows 624 to 915, which is precisely the part of the two
     margins that had nothing at all in it.

     The one at 6.2 is read the other way. Its visible arc is the far side, so
     its radius runs away from the eye and is compressed into almost nothing:
     the same 0.018 line comes out 0.23 pixels across the middle of the frame.
     So it is drawn the width of the marks that stand in it instead -- 0.11,
     the knot's section -- which is 1.4 pixels in the middle of the frame and
     5.7 at the edges. That is the honest shape of it: a range read end-on is
     a thing you see at the sides of the picture and not in the middle, and
     the middle of the picture is where the type is. */
  const net = [];
  ringBand(net, ARM, SCRIBE, RIM);
  ringBand(net, RANGE[0], POST_R * 0.5, RIM);
  /* The scribes are the two floor axes, each drawn both ways, and they run
     the width of the room: away from the eye they leave the frame at (0, 499)
     and (1916, 521), and coming back they leave it through the two bottom
     corners, which is the whole of what the composition was missing. They
     stop at the knot rather than crossing under it, because the knot is 0.11
     across and the crossing would be 0.018: it is geometry that cannot be
     seen from anywhere. So four half-lines out of a monument, which is also
     the honest shape -- the line is the axis, and only the shaft says which
     end of it is positive. */
  const floorAx = [dirs[0], dirs[2]];
  for (const d of floorAx) {
    for (const s of [1, -1]) {
      lineBand(net, 0, 0, d.x * s, d.z * s, KNOT * 0.5, GROUND_R, SCRIBE);
    }
    /* And a tick across each scribe where it leaves the monument backwards,
       at the arm's own length, so the arm's radius is marked on the two rays
       that do not carry a shaft and all four ends of the set-out stand on one
       circle. They land at (446, 835) and (1570, 835) at 1916x953 -- either
       side of the message card, in the two places at that height where the
       reader can see the floor at all. Two node widths long, which comes out
       32 pixels: short enough that a tick is never read as a fifth arm. */
    lineBand(net, -d.x * ARM, -d.z * ARM, -d.z, d.x, -NODE, NODE, SCRIBE);
  }
  const netGeo = new THREE.BufferGeometry();
  netGeo.setAttribute("position", new THREE.Float32BufferAttribute(net, 3));
  netGeo.computeVertexNormals();

  /* 0.45 against the floor's 0.28, and solved on the render the way the 0.28
     was. Measured at 1916x953 in the two margins, a scribe peaks at 31 to 56
     of 255 with the floor beside it at 22 to 28, and the ARM circle at its
     widest reaches 64 against 23: a shade under twice the surface it lies on,
     everywhere it is read. Twice is what a chalked line on concrete does. Any
     more and it stops being a mark and starts being a light, which on this
     screen means a reader looking at the floor rather than at an address. */
  const netMat = makeSurface({
    base: new THREE.Color(BASE).multiplyScalar(0.45),
    accent: pal["--landing-accent"], teal: pal["--landing-teal"],
    fog: new THREE.Color(pal["--landing-bg"])
      .lerp(new THREE.Color(pal["--landing-fg"]), 0.035),
    instanced: false
  });
  const nu = netMat.userData.uniforms;
  nu.uGrid.value = 0;
  /* The same window as the ground, and that is not laziness: a mark painted
     on a floor cannot be nearer than the floor. Given its own longer window
     the scribes would still be reading at the rim over ground that had faded
     out from under them, which is four bright wires lying in mid-air. They go
     when the surface carrying them goes. */
  nu.uFogNear.value = 4.0;
  nu.uFogFar.value = RIM_D;
  const netMesh = new THREE.Mesh(netGeo, netMat);
  netMesh.position.set(anchor.x, anchor.y + GROUND_Y + 0.003, anchor.z);
  group.add(netMesh);

  /* The two ranges, as two rows of marks on one mesh. They are the only thing
     here allowed a longer fog window than the ground they stand on: the far
     row is what the room's edge is made of, the whole point of an edge is
     that it is the last thing you can still see, and on the floor's own
     window -- which is built to reach nothing exactly there -- it would have
     been the first thing to go. */
  const posts = [];
  for (const r of RANGE) {
    const n = Math.round(2 * Math.PI * r / ARM);
    for (let i = 0; i < n; i++) posts.push([r, (i / n) * Math.PI * 2]);
  }
  /* 0.62, higher than the set-out and still well under the monument, and it
     has to be: a mark at the far range is a vertical face at 15.5 metres, so
     it loses the up-facing lighting the flat set-out gets and then more than
     half of what is left to the fog. Measured in the two margins, the marks
     come back at 26 to 43 of 255 against an atmosphere at 10 to 11 and a
     floor at that depth of 13 to 20 -- read against both, and not confusable
     with either. */
  const postGeo = seedSurface(new THREE.BoxGeometry(POST_R, POST_H, POST_R), posts.length);
  const postMat = makeSurface({
    base: new THREE.Color(BASE).multiplyScalar(0.62),
    accent: pal["--landing-accent"], teal: pal["--landing-teal"],
    fog: new THREE.Color(pal["--landing-bg"])
      .lerp(new THREE.Color(pal["--landing-fg"]), 0.035)
  });
  const pu = postMat.userData.uniforms;
  pu.uGrid.value = 0;
  pu.uFogNear.value = 4.0;
  pu.uFogFar.value = 26.0;
  const postMesh = new THREE.InstancedMesh(postGeo, postMat, posts.length);
  for (let i = 0; i < posts.length; i++) {
    const [r, th] = posts[i];
    // Turned to its own radius. A mark set square to the world on a ring that
    // is not says the two were laid out by different hands, which is the same
    // argument the arm-tip blocks are turned with the frame for.
    q.setFromAxisAngle(UP, -th);
    at.set(anchor.x + r * Math.cos(th), anchor.y + GROUND_Y + POST_H * 0.5,
           anchor.z + r * Math.sin(th));
    postMesh.setMatrixAt(i, m4.compose(at, q, scale.set(1, 1, 1)));
  }
  postMesh.instanceMatrix.needsUpdate = true;
  group.add(postMesh);

  const u = mat.userData.uniforms;

  return {
    group,
    update({ t, cut, focus, pointer, charge }) {
      // Ready-made when the caller has other stations to spend it on, off the
      // pointer when this is the only one it has.
      const c = charge === undefined
        ? Math.min(1, (pointer ? pointer.speed : 0) * 2.2) : charge;
      u.uTime.value = t;
      u.uCut.value = cut;
      u.uFocus.value = typeof focus === "number" ? focus : -1;
      u.uCharge.value = c;
      // The floor goes first and it goes faster: at 1.3 it has finished
      // eroding seven tenths of the way through the crossing where the frame
      // lasts to nine, so the last thing standing over a horizon that is
      // already the cloud's again is the frame. The set-out and the room's
      // edge are the floor -- they are marks on it and the end of it -- so
      // they go with it rather than on their own schedule.
      const gcut = cut * 1.3;
      for (const uni of [gu, nu, pu]) {
        uni.uTime.value = t;
        uni.uCut.value = gcut;
        uni.uCharge.value = c;
      }
    },
    dispose() {
      shaftGeo.dispose();
      blockGeo.dispose();
      netGeo.dispose();
      postGeo.dispose();
      ground.geometry.dispose();
      mat.dispose();
      groundMat.dispose();
      netMat.dispose();
      postMat.dispose();
    }
  };
}
