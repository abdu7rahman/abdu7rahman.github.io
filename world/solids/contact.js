/* Station 05, solid -- the origin, as matter.
 *
 * The last station is the only one that ends with less than it started with,
 * and the solid half has to honour that rather than quietly undo it: one
 * coordinate frame at full size, and a floor a long way underneath it. The
 * contact details are the last thing anybody reads and the world's remaining
 * duty is to stop competing with them, so anything added here is an object
 * standing between the reader and an email address.
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
 * frame.
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

/* The floor, and how far down it has to be. The eye sits 0.60 above the
   anchor and looks 3.5 degrees down, so the bottom of a 34 degree frame
   leaves it at 20.5 degrees: a floor 3.71 under the eye first appears 9.9
   metres ahead of it, which is the seven metres from the anchor where the
   cloud starts its horizon. That is the whole calculation. The formation
   keeps everything between the frame and seven metres empty and calls the
   emptiness the composition, so a floor that came into view inside it would
   be the one piece of scenery this station cannot afford; a floor further
   down than this never appears at all and the frame stands in a void.
   60 across, so the far edge is past the distance the fog finishes at. */
const GROUND_Y = -3.11, GROUND = 60;

const BASE = "#9fb7bd";

export function build(ctx) {
  const anchor = ctx.anchor;
  const pal = ctx.pal || {};
  const budget = (ctx.quality && ctx.quality.substrate) || 0;

  /* The one thing on this station with a curve in it, so it is the only
     segment count there is to spend. A shaft 28 pixels across is held within
     a third of a pixel of a true circle by fourteen sides and two thirds of
     one by ten; six leaves it two pixels out of round, and six goes to the
     tier already drawing at one device pixel per CSS pixel. */
  const SIDES = budget >= 60000 ? 14 : budget >= 26000 ? 10 : 6;

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

  /* The floor: one quad and its own material. Dark to a tenth of the frame's
     tone, because this is not an object -- it is what keeps the frame from
     standing in a void -- and a floor bright enough to read as a surface is a
     floor the reader starts looking at instead of the address. */
  const groundMat = makeSurface({
    base: new THREE.Color(BASE).multiplyScalar(0.10),
    accent: pal["--landing-accent"], teal: pal["--landing-teal"],
    fog: pal["--landing-bg"], instanced: false
  });
  const gu = groundMat.userData.uniforms;
  // No ruling. At the angle a floor is seen from -- twenty degrees where it
  // enters the bottom of the frame, falling to nothing at the horizon -- a
  // world-space grid is a moire pattern rather than machining, and it would
  // be the busiest thing on the quietest screen of the page.
  gu.uGrid.value = 0;
  // Faded across exactly the band the cloud's horizon occupies: untouched
  // where the ring starts, half gone where it ends, the page's own background
  // three metres later. Where the floor stops being a floor is the horizon,
  // so that is the one distance worth spending the fog on.
  gu.uFogNear.value = 9.0;
  gu.uFogFar.value = 22.0;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(GROUND, GROUND), groundMat);
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
