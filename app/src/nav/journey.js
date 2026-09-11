import { STOPS } from "../lib/plan.js";

/* Where the visit is up to.
 *
 * The site used to be a scrollbar: the building was as long as the document
 * and the wheel drove a dolly down the lane. That works and it is the wrong
 * shape for what this place is. A building is somewhere you are taken
 * around, and the thing that takes you around it is standing in the aisle
 * with legs that work.
 *
 * So navigation is a choice rather than a gesture. You are met at the door
 * and asked which way you want to go; the guide walks there, on the map, with
 * the same planner the building demonstrates; when it arrives it holds up
 * what it came to say and then puts it down. Nothing moves because a wheel
 * turned.
 *
 * One store, subscribed to with useSyncExternalStore, because the phases are
 * a handful of transitions a second at most and the per-frame values live in
 * guideState.js where they belong.
 */

export const DEMOS = STOPS.filter(s => s.kind === "rig").map(s => s.id);
export const ROOMS = STOPS.filter(s => s.kind === "room").map(s => s.id);

/* The phases, and there are only five, because a visit with more than five
 * states in it is a visit somebody can get lost in.
 *
 *   greeting   the guide is at the door, facing you, asking
 *   choosing   waiting for a click: a route, or a particular cell
 *   walking    on its way somewhere
 *   showing    arrived, holding up the sign for where it stopped
 *   closing    everything has been seen; the office
 */
const listeners = new Set();

let state = {
  phase: "greeting",
  route: null,          // "about" | "demos" | null
  at: null,             // where the guide is standing, when it is standing
  target: null,         // where it is going
  seen: [],             // stations shown, in order
  card: 0,              // which card of the current stop is up
  sign: false           // is the sign raised
};

function emit() {
  state = { ...state };
  for (const fn of listeners) fn();
}

export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function get() { return state; }

/* Pick a route at the door. "about" goes to the office and the cards; "demos"
   opens the floor and waits for you to pick a cell. */
export function choose(route) {
  state.route = route;
  state.card = 0;
  if (route === "about") { goTo("contact"); }
  else { state.phase = "choosing"; state.target = null; emit(); }
}

export function goTo(id) {
  if (!STOPS.some(s => s.id === id)) return;
  state.target = id;
  state.at = null;
  state.phase = "walking";
  state.sign = false;
  state.card = 0;
  emit();
}

/* Called by the guide when it has stopped and turned. */
export function arrive(id) {
  if (state.target !== id) return;
  state.at = id;
  state.target = null;
  state.phase = "showing";
  state.sign = true;
  if (!state.seen.includes(id)) state.seen = [...state.seen, id];
  emit();
}

export function nextCard(n) {
  state.card = n;
  emit();
}

/* Put the sign down and go back to waiting for a click. When every cell has
   been seen, the last thing to do is walk to the office. */
export function done() {
  state.sign = false;
  const left = DEMOS.filter(d => !state.seen.includes(d));
  if (state.route === "demos" && left.length === 0 && state.at !== "contact") {
    goTo("contact");
    return;
  }
  state.phase = "choosing";
  emit();
}

export function remaining() {
  return DEMOS.filter(d => !state.seen.includes(d));
}

/* Straight to a station from anywhere, which is what the index down the side
   of the frame does. It skips the greeting, because somebody who has clicked
   a specific cell has already answered the question the greeting asks. */
export function jump(id) {
  if (!state.route) state.route = "demos";
  goTo(id);
}

export function reset() {
  state = { phase: "greeting", route: null, at: null, target: null, seen: [], card: 0, sign: false };
  emit();
}
