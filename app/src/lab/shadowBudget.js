/* Which cell shadow maps get redrawn on this frame.
 *
 * A spot light that casts costs a full extra pass over everything in its
 * range, and there are eight of them, one over each bench. Measured through
 * window.__lab at the entrance, at the high tier: forcing every map in one
 * frame is 1,131 draw calls and 883,462 triangles, against 693 and 428,299
 * with no spot casting at all. The eight bench lamps are 416 of those calls
 * and 438,177 of those triangles -- more than a third of the calls and half
 * the triangles in a fully drawn frame exist to be drawn from a lamp's point
 * of view. (The ninth caster is the desk lamp in the office, at 22 and
 * 16,986. The other seven spot lights -- six high-bay fittings over the lane
 * and the wash across the history plate -- do not cast.)
 *
 * Priced one at a time the eight run 34 to 105 calls and 28,878 to 90,330
 * triangles, and they add exactly: the nine measured singly sum to the same
 * 438 calls and 455,163 triangles as forcing all nine at once. That is what
 * makes a per-frame budget a budget rather than an average -- n maps cost n
 * times the mean whichever n you pick.
 *
 * Almost none of it changes. A bay is a bench, a back wall, a plinth and one
 * machine, and only the machine moves -- so a cell three stops down the
 * aisle can keep the map it drew a moment ago and cost nothing at all this
 * frame. three supports exactly that: shadow.autoUpdate false leaves the
 * last map in place, and shadow.needsUpdate true draws one more.
 *
 * The alternative, turning castShadow off on the far ones, changes
 * numSpotLightShadows, which is a program parameter -- every material in the
 * building would recompile mid-walk. That is worse than the cost being
 * saved, which is why this is a schedule and not a switch.
 *
 * The schedule is a round robin rather than a distance test, so the number
 * of maps drawn per frame is exactly the budget and never a spike: at two
 * slots of eight, two cells redraw each frame for about 104 calls and
 * 110,000 triangles instead of 416 and 438,177, and a cell's map is at most
 * six frames old -- 100 ms at 60 fps, on a shadow of a machine that moves at
 * walking pace. lab/Budget.jsx turns the crank, once, before anything reads
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
