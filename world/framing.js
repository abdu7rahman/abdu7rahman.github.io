/* Where the frame is, as opposed to where the window is.
 *
 * Staged, the type sits in a panel down the left of the window and the world
 * has whatever is left. So the window is not the frame: composing a shot on
 * the window's centre puts the subject half behind the panel, and every
 * station here was composed that way.
 *
 * Two of them had been hand-corrected for it -- Measured aims half a metre
 * left of its own subject, which pushes the bars right on screen -- and that
 * is the part worth being careful about, because it does not survive a change
 * of window. A lateral offset in metres becomes an offset in NDC only after
 * dividing by `tan(fov/2) * aspect`, so the same key that frames correctly at
 * 16:10 is 26% further off centre at 2:1 and further still on a laptop. The
 * shots were tuned at one size and were wrong at all the others; measured on a
 * 1916x953 window, Work's costmap ran off both edges of the frame at once.
 *
 * The correction belongs in NDC, then, where the panel's own width already
 * lives. It is one number -- a horizontal shear of the projection, which is
 * what a shift lens is -- and being in NDC it is the same composition at every
 * window size, which is the whole point. The frustum stays the same shape and
 * the same size, so nothing is cropped, nothing is scaled, and no station's
 * key has to know anything about the layout in front of it.
 */

/* How much of the shift to actually spend. At 1.0 the subject would sit dead
   centre in the clear strip, which is too far: the world is meant to run under
   the panel rather than stop at it, and a costmap pushed fully clear of the
   type takes its near corner off the right edge to get there. At 0.55 a
   62vw-panel station moves 0.29 in NDC -- about a seventh of the window --
   which is enough to put the subject's body in the open and still let its near
   edge pass behind the reading. */
const GAIN = 0.55;

/* The panel's backing is opaque to 86% of its width and gone by 100%, so what
   actually occludes is 0.86 of what it measures. Hard-coded against the
   gradient in landing.css rather than read from it: reading would mean parsing
   a background shorthand every frame to recover a number that only changes
   when someone edits that rule on purpose. If it moves, this moves. */
const OPAQUE = 0.86;

export function makeFraming(camera) {
  let shift = 0, want = 0;

  return {
    /* The panel element, or null when nothing is covering the canvas -- the
       scrolling document, a phone, reduced motion. Measured on demand rather
       than every frame: `getBoundingClientRect` forces layout, and the answer
       only changes when the state changes or the window resizes. */
    measure(panel) {
      if (!panel || !document.body.classList.contains("is-staged")) { want = 0; return; }
      const w = panel.getBoundingClientRect().width;
      want = Math.max(0, Math.min(0.8, (w * OPAQUE / window.innerWidth) * GAIN));
    },

    /* Eased, because states have different panel widths -- Work takes 62vw and
       Contact 46 -- and snapping the projection at the moment the state index
       changes is a cut. Over a crossing it reads as the camera settling into
       the next composition, which is what it is. */
    update(dt) {
      shift += (want - shift) * Math.min(1, dt * 3.2);
      if (Math.abs(shift) < 1e-4) return;
      /* Element 8 is (right+left)/(right-left) -- zero for the symmetric
         frustum three.js just built. Positive slides the frustum toward +x,
         which moves what is in it toward -x on screen, so the sign is
         inverted to push the subject right. */
      camera.projectionMatrix.elements[8] = -shift;
      // Unproject is what turns the pointer into a place in the world, and it
      // reads this. Left stale, the cursor stops agreeing with the picture.
      camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    },

    get shift() { return shift; }
  };
}
