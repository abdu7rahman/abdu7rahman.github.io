/* Which cell shadow maps get redrawn on this frame.
 *
 * A spot light that casts costs a full extra pass over everything in its
 * range, and there are seven of them: measured through window.__lab at the
 * entrance, the seven cell spotlights are 229 of a frame's 685 draw calls
 * and 102,383 of its 314,568 triangles. A third of the frame exists to be
 * drawn from a lamp's point of view.
 *
 * Almost none of it changes. A bay is a bench, a back wall, a plinth and one
 * machine, and only the machine moves -- so a cell three stops down the
 * aisle can keep the map it drew a moment ago and cost nothing at all this
 * frame. three supports exactly that: shadow.autoUpdate false leaves the
 * last map in place, and shadow.needsUpdate true draws one more.
 *
 * The alternative, turning castShadow off on the far ones, changes
 * numSpotLightShadows, which is a program parameter -- every material in the
 * building would recompile mid-scroll. That is worse than the cost being
 * saved, which is why this is a schedule and not a switch.
 *
 * The schedule is a round robin rather than a distance test, so the number
 * of maps drawn per frame is exactly the budget and never a spike: at two
 * slots of seven, two cells redraw each frame and each cell is at most three
 * frames stale. lab/Budget.jsx turns the crank, once, before anything reads
 * it.
 */
let frame = 0;
let slots = 2;

export function tick() { frame++; }
export function setSlots(n) { slots = Math.max(0, n | 0); }

export function due(i, total) {
  if (slots <= 0) return false;
  if (slots >= total) return true;
  return ((frame + i) % total) < slots;
}
