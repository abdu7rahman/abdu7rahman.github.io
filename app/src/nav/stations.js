import { STOPS, PITCH, AISLE, BAY_D, WORK } from "../lib/plan.js";

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

/* The shot. The camera stands on the aisle side of the guide and a little
   back toward the door, so the guide is in the near third and the cell runs
   away behind it -- and the guide turns to face the camera, because it is
   holding something up for somebody to read. */
const SHOT_OUT = 1.75;    // across the lane from the guide
const SHOT_BACK = 3.05;   // back toward the door
const SHOT_EYE = 1.80;

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
    const ex = x - stop.side * SHOT_OUT;
    const ez = z + SHOT_BACK;
    eye = [ex, SHOT_EYE, ez];
    /* Between the guide and the work, weighted to the guide: it is the
       nearer subject and the one holding the caption. */
    look = [x * 0.58 + stop.side * WORK * 0.42, 1.02, z - 0.6];
    fov = 46;
    faceYaw = Math.atan2(ez - z, ex - x);
  }
  return { id: stop.id, x, z, clear, faceYaw, eye, look, fov };
}

export function allStands(grid, radius) {
  const out = {};
  for (const s of STOPS) out[s.id] = standFor(grid, s, radius);
  return out;
}

/* Where a visitor comes in. Inside the front wall, on the lane centre, far
   enough in that the camera meeting the guide is inside the building too. */
export const DOOR = [0, 2.6];

export { STOPS };
