/* Every number the world runs on, in one file.
 *
 * The point is not tidiness. Animation numbers are the design -- where a
 * camera sits, how long a dissolve takes, how hard the pointer pulls -- and
 * they only get tuned if they are somewhere you can see them next to each
 * other. Scattered through the scenes they become forty magic numbers nobody
 * dares touch.
 */

/* ── the journey ────────────────────────────────────────────────────────
   Normalised scroll, 0 at the top of the document and 1 at the bottom.
   
   The bands are not written here. They were, and they were wrong the moment
   the copy changed length: the world was still showing the work scene while
   the reader was a screen into Measured, because 0.15-0.40 was a guess about
   where Measured starts and the document is the only thing that actually
   knows. Each scene names the sections it belongs to and measures them at
   boot -- change a paragraph and the world follows.
   
   `fade` is how much of a band on either side is spent arriving and leaving,
   so neighbours overlap and the world is never empty between two scenes. */
export const SCENES = [
  { id: "hero",     owns: ["intro", "about"],   fade: 0.045 },
  { id: "work",     owns: ["work"],             fade: 0.05  },
  { id: "measured", owns: ["measured", "stack"], fade: 0.05 },
  { id: "path",     owns: ["path"],             fade: 0.05  },
  { id: "contact",  owns: ["contact"],          fade: 0.045 }
];

/* Measured off the page. A section's band runs from where its top reaches the
   middle of the window to where its bottom leaves it, which is the span over
   which a reader would say they are "in" that section. */
export function measureBands(scenes) {
  const doc = document.documentElement;
  const span = Math.max(1, doc.scrollHeight - window.innerHeight);
  const mid = window.innerHeight * 0.5;
  for (const s of scenes) {
    let top = Infinity, bot = -Infinity;
    for (const id of s.owns) {
      const el = document.getElementById(id);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      const y0 = r.top + window.scrollY, y1 = y0 + r.height;
      top = Math.min(top, y0); bot = Math.max(bot, y1);
    }
    if (!isFinite(top)) { s.range = [0, 0]; continue; }
    s.range = [Math.max(0, Math.min(1, (top - mid) / span)),
               Math.max(0, Math.min(1, (bot - mid) / span))];
  }
  return scenes;
}

/* ── the camera ─────────────────────────────────────────────────────────
   Keyframes in world space, interpolated along the same 0..1. The rig eases
   between them; it does not cut. `fov` moves too, because a camera that only
   translates reads as a slide and a camera that also breathes reads as one
   that is being flown. */
export const CAMERA = {
  keys: [
    /* Solved rather than nudged. The arm's bounding box is 0.81m tall and
       centred at (0.71, -0.76, 0.40); at 40 degrees vertical a 1.92m standoff
       makes it 58% of the frame, and shifting the look point 0.48m left of it
       puts it in the right half where the type is not. */
    { at: 0.00, pos: [ 0.36, -0.45, 2.78], look: [ 0.36, -0.62,  0.40], fov: 40 },
    { at: 0.17, pos: [ 0.10, -0.20, 1.05], look: [ 0.55, -0.55, -0.35], fov: 48 },
    { at: 0.30, pos: [-0.20, 1.35, -0.60], look: [0, 0.60, -3.2], fov: 52 },
    { at: 0.50, pos: [ 1.90, 0.80, -4.60], look: [0, 0.55, -7.0], fov: 46 },
    { at: 0.72, pos: [-0.60, 1.10, -9.20], look: [0, 0.70, -12.4], fov: 44 },
    { at: 1.00, pos: [ 0.00, 0.60, -14.6], look: [0, 0.50, -18.0], fov: 36 }
  ],
  /* How far the pointer is allowed to move the eye, in world units, and how
     stiff the spring that gets it there. Small: this is parallax, not a
     joystick. Past about 0.3 it stops reading as depth and starts reading as
     the camera being dragged around by the mouse. */
  pointer: { reach: 0.26, lift: 0.15, stiffness: 3.1, damping: 0.82 },
  /* The scroll itself is smoothed before anything reads it, so a trackpad's
     stair-step does not arrive as camera judder. */
  ease: 0.085
};

/* ── transitions ────────────────────────────────────────────────────────
   A handoff is a physical event, not a crossfade. `dissolve` is how far into
   a scene's fade band the geometry starts coming apart; `scatter` is how far
   the freed particles travel before they are pulled into the next scene. */
export const TRANSITION = {
  dissolve: 0.55,
  scatter: 2.4,
  swirl: 1.35,
  settle: 0.7
};

/* ── quality tiers ──────────────────────────────────────────────────────
   Chosen by world/capability.js, not by user agent sniffing. Desktop gets the
   whole thing; a weak GPU gets fewer particles and no post chain but the same
   choreography, because a simplified experience is still an experience and a
   missing one is not. */
export const TIERS = {
  high:   { dpr: 2.0, particles: 24000, post: true,  shadow: true,  fogSteps: 5 },
  medium: { dpr: 1.5, particles:  9000, post: true,  shadow: false, fogSteps: 4 },
  low:    { dpr: 1.0, particles:  2600, post: false, shadow: false, fogSteps: 3 }
};

/* ── the palette, read from the stylesheet ──────────────────────────────
   Not duplicated here. The page already defines these and the contrast gate
   already checks them; a second copy is a second thing to drift. */
export const TOKENS = ["--landing-bg", "--landing-fg", "--landing-accent", "--landing-teal"];
