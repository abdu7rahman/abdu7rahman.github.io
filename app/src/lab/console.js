/* The control surface for whichever cell you are standing at.
 *
 * The rigs ran and could not be operated: seven live algorithms with no way
 * to stop one, restart it, or change the thing it is about. A demo you can
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
export function setRunning(id, v) {
  running.set(id, v);
  for (const fn of listeners) fn();
}
