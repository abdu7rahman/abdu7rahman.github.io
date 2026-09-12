import { PITCH, WORK } from "../lib/plan.js";

/* The control surface for whichever cell you are standing at.
 *
 * The rigs ran and could not be operated: eight live algorithms with no way
 * to stop one, restart it, or change the thing they are about. A demo you can
 * only watch is a video with extra steps, and the whole claim of this
 * building is that the work is running rather than recorded -- which is only
 * checkable if somebody can reach in and change it.
 *
 * Every bay is mounted the whole time, so a rig cannot register by being
 * alive. It registers under its stop id and nav/Console.jsx shows whichever
 * id the reader is standing at. Two consequences worth knowing: a rig's
 * controls exist before anybody walks up to them, so nothing has to be
 * spun up on arrival, and a rig that is paused stays paused while you walk
 * away and come back, which is what somebody who paused it meant.
 *
 * Deliberately not React state. These are read at 5 Hz by a panel that is
 * outside the canvas and written every frame by code inside it; routing
 * that through a store would re-render the tree at frame rate to move a
 * number.
 */
const cells = new Map();
const listeners = new Set();

export function register(id, spec) {
  cells.set(id, spec);
  for (const fn of listeners) fn();
  return () => {
    cells.delete(id);
    for (const fn of listeners) fn();
  };
}

export function controls(id) { return cells.get(id) || null; }

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/* Running state, held here rather than in each rig, because the reader's
   idea of paused is "this cell is not doing anything" and every rig has to
   agree about what that means. A rig reads it at the top of its frame
   callback and returns; nothing else changes. */
const running = new Map();
export function isRunning(id) { return running.get(id) !== false; }

/* And whether a cell is close enough to the reader to be worth running.
 *
 * Every bay is mounted the whole time, which is what makes the building one
 * scene rather than eight loading screens -- and it meant all eight were
 * integrating MuJoCo sixty times a second whatever the reader was looking
 * at. Measured in the page, one frame of each cell's own work, timed by
 * calling the tick it publishes while standing at it -- which is the only
 * place the measurement means anything, because half of what a cell does is
 * behind the gate this file is about:
 *
 *   race 1.43 ms   cost 1.60   sorting 0.96   search 0.38   replan 0.34
 *   swerve 0.27    local control 0.22          cloned 0.12
 *
 * 5.32 ms of CPU before anything is drawn, against a 16.7 ms budget. That
 * was the lag, and none of it was buying anything: a quadruped crawling a
 * hill forty metres behind you is not on screen.
 *
 * So a cell runs when the lens is within RANGE of it. Measured by standing
 * at each of the eight stations in turn, that is two, three, four, three,
 * four, four, three, two walking in -- never eight, two at either end where
 * a bay has a neighbour on one side only -- and none at all at the entrance,
 * which is 11 m from the nearest bench and where no single machine is the
 * subject anyway. The worst any station costs is 3.64 ms, standing at
 * replan with race, swerve and cost also inside the radius. The entrance
 * costs nothing.
 *
 * The neighbours are in deliberately. You can see down the aisle from where
 * you stand, and a frozen machine in the next bay reads as broken rather
 * than as thrifty.
 *
 * Nothing here pauses: a cell out of range keeps its state, its physics and
 * its console, and picks up where it was when you come back. What stops is
 * the integration.
 */
const RANGE = 9.5;
export function isLive(stop, camera) {
  if (running.get(stop.id) === false) return false;
  if (!camera || stop.at === undefined) return true;
  /* The work, not the middle of the bay. plan.js has both -- place() is
     where a bay is and WORK is where the bench inside it stands, 2.1 m
     apart -- and it is the bench the reader walks up to. */
  const z = -stop.at * PITCH;
  const x = stop.side * WORK;
  const dx = camera.position.x - x, dz = camera.position.z - z;
  return dx * dx + dz * dz < RANGE * RANGE;
}
export function setRunning(id, v) {
  running.set(id, v);
  for (const fn of listeners) fn();
}
