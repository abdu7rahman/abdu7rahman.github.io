/* Station 05, solid -- the origin, and the floor it is the origin of.
 *
 * The last station is the only one that ends with less than it started with,
 * and the solid half has to honour that rather than quietly undo it: one
 * coordinate frame at full size, and the ground it stands on. The contact
 * details are the last thing anybody reads and the world's remaining duty is
 * to stop competing with them, so anything added here is an object standing
 * between the reader and an email address.
 *
 * That reasoning is right about the priority and it was wrong about the
 * execution. The floor used to stand 3.11 metres under the anchor, far enough
 * down that it first came into view 9.9 metres ahead and everything between
 * the frame and the cloud's horizon was empty on purpose. What that produced
 * is not restraint, it is an empty rectangle: measured on the render half at
 * 1916x953 this station came back at p90 = 16 of 255 and 3.2% of it over 100,
 * against About's 141 and the corridor's 119, and almost all of the 3.2% was
 * the three shafts themselves. A frame standing in a void has no scale, no
 * horizon and nothing to be at rest against, and those three are the entire
 * content of a coordinate frame.
 *
 * So the floor comes up to the frame's own feet and the quiet is kept by the
 * two things that were always the right tools for it -- how dark the surface
 * is, and where the fog takes it -- rather than by putting the ground out of
 * reach. Nothing is added to the room. The room is what was missing.
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
 * standing on ground 3.0 metres out. Everything from the frame to the horizon
 * is still empty -- there is simply a floor under the emptiness now. */
const GROUND_Y = -ROOT_R, GROUND_R = 13.0;

const BASE = "#bcd2d8";

export function build(ctx) {
  const anchor = ctx.anchor;
  const pal = ctx.pal || {};
  const budget = (ctx.quality && ctx.quality.substrate) || 0;

  /* The two curves on this station, so these are the only segment counts
     there is to spend. A shaft 28 pixels across is held within a third of a
     pixel of a true circle by fourteen sides and two thirds of one by ten;
     six leaves it two pixels out of round, and six goes to the tier already
     drawing at one device pixel per CSS pixel.

     The floor's rim is the cheaper of the two even though it is far bigger,
     because of where it is: at 13 metres a 96-sided ring is 7 mm off a true
     circle, which is two thirds of a pixel there, and the fog has taken 92%
     of it by then in any case. Forty sides is 40 mm out, four pixels, and it
     is four pixels of an edge that is already background. */
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
     would be the busiest thing on the quietest screen of the page. */
  gu.uGrid.value = 0;
  /* Faded across exactly the band the cloud's horizon occupies: untouched to
     4 metres, half gone at 8.5, the page's own background by 13, which is
     where the ring ends and where this disc ends with it. On a 953-row frame
     that is full value at row 624 and gone by row 456 -- so the floor is a
     surface under the frame's feet and has become the horizon 168 rows above
     them, and the rim itself is never seen as an edge. Where the floor stops
     being a floor is the horizon, so that is the one distance worth spending
     the fog on. */
  gu.uFogNear.value = 4.0;
  gu.uFogFar.value = GROUND_R;
  const ground = new THREE.Mesh(new THREE.CircleGeometry(GROUND_R, RIM), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(anchor.x, anchor.y + GROUND_Y, anchor.z);
  group.add(ground);

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
      gu.uTime.value = t;
      // The floor goes first and it goes faster: at 1.3 it has finished
      // eroding seven tenths of the way through the crossing where the frame
      // lasts to nine, so the last thing standing over a horizon that is
      // already the cloud's again is the frame.
      gu.uCut.value = cut * 1.3;
      gu.uCharge.value = c;
    },
    dispose() {
      shaftGeo.dispose();
      blockGeo.dispose();
      ground.geometry.dispose();
      mat.dispose();
      groundMat.dispose();
    }
  };
}
