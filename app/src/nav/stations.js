import { PITCH, AISLE, BAY_D, WORK } from "../lib/plan.js";
import { visible } from "./route.js";

/* Where the guide stands to show you something, which way it faces when it
 * gets there, and where the camera goes to see both -- all worked out from
 * the map rather than typed next to the floor plan.
 *
 * One function, because these three answers have to agree. They did not, in
 * the first version: the camera composed a two-shot from across the lane
 * while the guide turned to face the cell, so the sign it was holding up
 * pointed at a bench and the visitor got the back of a robot's head. A
 * standing spot, a heading and a lens are one decision about one moment and
 * splitting them across two files is how they drift.
 *
 * The spot itself is found and not chosen. It asks the distance field the
 * same question a person would -- standing in front of this cell, where is
 * there room for me? -- and takes the roomiest cell in a window in front of
 * the bay, breaking ties toward the work. So the guide ends up in the mouth
 * of the bay when the gate is open and out in the lane when it is not,
 * without either case being written down.
 */

/* How far into the lane to look, and how wide. A bay is 7.6 m deep and the
   lane is 6.4 m across; a window 3.2 m along the lane by 4.5 m across it
   covers the mouth of one bay and nothing of its neighbours. */
const WIN_ALONG = 3.2;
const WIN_ACROSS = 4.5;

/* The shot, and this one is found rather than chosen too.
 *
 * It used to be a fixed offset: 1.75 m across the lane from the guide and
 * 3.05 m back toward the door. That puts the lens at about 2.05 m off the
 * centre line -- and the guarding runs at 3.2 m, with the work 4.9 m out
 * beyond it. So every arrival was composed through a chain-link fence, at a
 * rig that was one and a bit metres further away than the robot the lens was
 * actually focused on. Measured on the frame: the TurtleBot in the drive
 * cell came out twenty pixels tall at 1440 by 900.
 *
 * The map already answers "is there a fence in the way" -- it is the same
 * question the guide asks about walking, and route.js already has the ray
 * for it. So the camera sweeps the ground behind and beside the standing
 * spot and takes the place that can actually see the work, preferring the
 * distance that fills the frame with it and an angle that leaves the guide
 * in the near third rather than in the middle of the shot.
 */
const SHOT_EYE = 1.62;

/* How much room a lens needs to sit somewhere: the same 0.55 m Follow.jsx
   uses to keep the near plane out of the cladding, so a spot chosen here is
   not one the camera's own keep-out will then slide off. */
const LENS_R = 0.55;

/* The distance to the work that frames it, and the band is set by where a
   lens can stand rather than by where one would like to. The guide stands in
   the lane 2.45 m off the centre line and the work is 4.9 m out behind the
   guarding, so a camera that can see past the guide has to be further back
   still: every position with a clear ray came out beyond 4.6 m, and a band
   that stopped there rejected all of them and fell through to the offset it
   was meant to replace. At 4.2 m a 46 degree horizontal lens covers 3.6 m,
   which puts a two metre rig across well over half the frame. */
const WANT_D = 4.2, NEAR_D = 2.4, FAR_D = 6.4;

/* Where the guide should sit relative to the work in the frame. Zero would
   stack the two subjects on top of each other and a quarter turn would put
   the guide out of shot; 0.30 rad is the near third of a 46 degree lens. */
const SPLIT = 0.30;

export function standFor(grid, stop, radius = 0.50) {
  const z0 = -stop.at * PITCH;
  /* Rooms on the centre line are entered rather than looked into, so the
     spot is inside them; a bay is looked into from the lane. */
  const cx = stop.side === 0 ? 0 : stop.side * (AISLE / 2 + 0.6);
  let best = null, bestScore = -Infinity;
  const halfA = WIN_ALONG / 2, halfC = WIN_ACROSS / 2;
  const step = grid.cell;
  for (let dz = -halfA; dz <= halfA; dz += step) {
    for (let dc = -halfC; dc <= halfC; dc += step) {
      const x = cx + dc, z = z0 + dz;
      const c = grid.clearance(x, z);
      if (c <= radius + 0.12) continue;
      /* Room to stand first, then nearness to the work, then to the
         station's own z. Clearance is capped so a wide open floor in the
         middle of the lane does not beat the mouth of the bay. */
      const room = Math.min(c, 1.1);
      const toWork = stop.side === 0 ? 0 : Math.abs(x - stop.side * WORK) * 0.06;
      const score = room - toWork - Math.abs(dz) * 0.05 - Math.abs(dc) * 0.015;
      if (score > bestScore) { bestScore = score; best = [x, z, c]; }
    }
  }
  if (!best) best = [cx, z0, grid.clearance(cx, z0)];
  const [x, z, clear] = best;

  /* The camera, and then the heading, in that order: the guide faces
     whoever it is talking to, and whoever it is talking to is behind the
     lens. */
  let eye, look, fov, faceYaw;
  if (stop.side === 0) {
    /* A room on the centre line. The visitor is in the aisle, on the door
       side of it, so the guide turns back down the building. */
    const toDoor = stop.at > 4 ? 1 : -1;
    eye = [x + 0.35, 1.52, z + 2.35 * toDoor];
    look = [x, 1.12, z];
    fov = 40;
    faceYaw = Math.atan2(2.35 * toDoor, 0.35);
  } else {
    /* The work: the middle of the bay, where the rig stands. Which is the
       one place a ray to it cannot end, because the rig is solid there --
       `visible` finishes by asking whether its far end is clear, so aiming
       the sight test at the middle of a bench says "no" from everywhere in
       the building and every cell fell through to the fallback offset. So
       the test sights the bench's near face instead: walk back from the work
       toward the lane until the map has room, and use that. The lens still
       *aims* at the work -- seeing the front of a thing is what seeing it
       means. */
    const wx = stop.side * WORK, wz = z0;
    let sx = wx;
    for (let k = 0; k < 22 && grid.clearance(sx, wz) <= 0.2; k++) sx -= stop.side * 0.1;
    let eye2 = null, eyeScore = -Infinity;
    for (let dz = 0.6; dz <= 4.4; dz += step * 2) {
      for (let dc = -1.9; dc <= 1.5; dc += step * 2) {
        const ex = x - stop.side * dc, ez = z + dz;
        if (grid.clearance(ex, ez) <= LENS_R) continue;
        /* The whole point: a lens that cannot see the rig is not a shot of
           the rig. A thin ray rather than the body's corridor -- the camera
           has to see past the guarding, not walk through it. */
        if (!visible(grid, ex, ez, sx, wz, 0.12)) continue;
        const d = Math.hypot(wx - ex, wz - ez);
        if (d < NEAR_D || d > FAR_D) continue;
        /* The angle between the two subjects at the lens. Too small and they
           overlap; too large and one of them is off the edge. */
        let sep = Math.atan2(wz - ez, wx - ex) - Math.atan2(z - ez, x - ex);
        while (sep > Math.PI) sep -= Math.PI * 2;
        while (sep < -Math.PI) sep += Math.PI * 2;
        const score = -Math.abs(d - WANT_D) * 0.55
                      - Math.abs(Math.abs(sep) - SPLIT) * 1.6
                      + Math.min(grid.clearance(ex, ez), 1.4) * 0.25;
        if (score > eyeScore) { eyeScore = score; eye2 = [ex, ez]; }
      }
    }
    /* Nothing could see in -- a bay shuttered on both sides, which no cell
       in this building is, but a fallback that composes something is better
       than one that composes NaN. Stand off the guide's shoulder. */
    const ex = eye2 ? eye2[0] : x - stop.side * 1.75;
    const ez = eye2 ? eye2[1] : z + 3.05;
    eye = [ex, SHOT_EYE, ez];
    /* Weighted to the work now rather than to the guide. The guide is the
       near subject and needs no help being seen; the rig is the thing the
       visit came for. */
    /* Aimed low, at 0.92 rather than at the bench top. The guide is the near
       subject and a lens levelled at the work puts the caption it is holding
       under the bottom edge of the frame while a third of the picture is
       cladding; dropping the aim spends that headroom on the thing somebody
       is meant to read. */
    look = [x * 0.30 + wx * 0.70, 0.92, z * 0.30 + wz * 0.70];
    /* Wide enough for the bench that is actually there. The benches went to
       3.0 by 3.8 m so the courses on them stopped reading as trays, and the
       aisle-parallel 3.8 is what crosses the frame: at the 4.2 m this shot
       prefers, 46 degrees covers 3.57 m and cropped the ends off every
       course cell. 50 covers 3.92, which fits it with a hand's width to
       spare. */
    fov = 50;
    faceYaw = Math.atan2(ez - z, ex - x);
  }
  return { id: stop.id, x, z, clear, faceYaw, eye, look, fov };
}

/* Where a visitor comes in. Inside the front wall, on the lane centre, far
   enough in that the camera meeting the guide is inside the building too. */
export const DOOR = [0, 2.6];

