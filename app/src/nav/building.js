import { Grid } from "./occupancy.js";
import { survey } from "./survey.js";
import { AISLE, BAY_D, RUN } from "../lib/plan.js";

/* The building's own map, built once, shared by everything that moves.
 *
 * One grid for the whole place rather than one per cell. A per-cell map was
 * what the inspection layer used to do and it has a specific failure: the
 * guide walking from the door to the sorting cell crosses six of them, and
 * six maps that each know about their own bay and nothing else cannot plan
 * that walk. A costmap is local to a robot, not to a room.
 *
 * 0.1 m cells. The narrowest thing anything has to get through is the 1.4 m
 * gate at a bay mouth, which is fourteen cells; a 0.28 m humanoid inflates to
 * three, leaving eight clear. At 0.2 m it would be seven cells and two of
 * inflation, which still works and stops being a map of a gate and starts
 * being a map of a gap. At 0.05 m the distance transform is four times the
 * work for a precision no robot in the building can hold.
 */
export const CELL = 0.1;

/* Bounds from the floor plan, plus enough margin that the envelope itself is
   inside the grid and the border is a wall because the wall is a wall. */
const HALF = AISLE / 2 + BAY_D + 1.4;

export const BUILDING = Grid.cover(-HALF, -RUN - 8, HALF, 9, CELL);

/* What the map is of: a body standing on the slab. The floor is excluded from
 * below and the truss from above by these two numbers and nothing else --
 * there is no list of things to ignore.
 *
 * 0.15 m is toe clearance, and it is doing real work rather than rounding a
 * number off. The aisle is painted: edge lines, hazard stripes and the lane
 * centre are all boxes 0.1 m proud of the slab, and at 0.08 they were
 * obstacles -- 180 blocked cells down the middle of the lane, a wall made of
 * paint. Nothing in this building between 0.1 and 0.15 is solid, and anything
 * that ever is would be a trip hazard somebody should have removed.
 *
 * 1.45 m is over the top of the guide's head (1.32 m) and under the underside
 * of the catwalk, so the walkway is something to pass beneath rather than a
 * roof to plan around, and the truss at 8.4 m never enters the question.
 */
export const SLAB_LO = 0.15;
export const SLAB_HI = 1.45;

let state = { ready: false, stats: null };
const waiting = new Set();

export function mapState() { return state; }

export function onMap(fn) {
  waiting.add(fn);
  if (state.ready) fn(BUILDING, state.stats);
  return () => waiting.delete(fn);
}

/* Survey the scene into the shared grid. Idempotent in effect: the base
   layer is cleared first, so calling it again after the building changes
   gives a map of the building as it is now rather than of both. */
export function buildMap(scene) {
  const t0 = (typeof performance !== "undefined" ? performance : Date).now();
  BUILDING.base.fill(0);
  BUILDING.stamps = 0;
  BUILDING.into("base");
  const s = survey(scene, BUILDING, { lo: SLAB_LO, hi: SLAB_HI });
  const t1 = (typeof performance !== "undefined" ? performance : Date).now();
  BUILDING.finish();
  const t2 = (typeof performance !== "undefined" ? performance : Date).now();
  let blocked = 0;
  for (let k = 0; k < BUILDING.n; k++) if (BUILDING.solid[k]) blocked++;
  state = {
    ready: true,
    stats: {
      ...s, blocked, cells: BUILDING.n,
      w: BUILDING.w, h: BUILDING.h, cell: CELL,
      surveyMs: +(t1 - t0).toFixed(1), edtMs: +(t2 - t1).toFixed(1)
    }
  };
  for (const fn of waiting) fn(BUILDING, state.stats);
  return state.stats;
}
