/* Normalised scroll, smoothed once, read by everything.
 *
 * One place turns "how far down the document are we" into a number between 0
 * and 1, and one place smooths it. Every scene and the camera read the same
 * eased value, which is what keeps them in step: smoothing per-consumer is
 * how a camera ends up a frame ahead of the thing it is looking at.
 */
import { CAMERA } from "./config.js";

export function makeScroll() {
  let raw = 0, eased = 0, velocity = 0, last = 0;

  function read() {
    const doc = document.documentElement;
    const span = Math.max(1, doc.scrollHeight - window.innerHeight);
    raw = Math.min(1, Math.max(0, window.scrollY / span));
  }

  read();
  eased = raw;
  window.addEventListener("scroll", read, { passive: true });
  window.addEventListener("resize", read, { passive: true });

  return {
    /* dt in seconds, so the easing is frame-rate independent -- the same
       journey on a 60Hz panel and a 144Hz one. */
    update(dt) {
      const k = 1 - Math.pow(1 - CAMERA.ease, dt * 60);
      const before = eased;
      eased += (raw - eased) * k;
      velocity = dt > 0 ? (eased - before) / dt : 0;
      last = eased;
      return eased;
    },
    get p() { return eased; },
    get target() { return raw; },
    /* Signed, in progress-units per second. Scenes use it for the things that
       should only happen while you are actually moving. */
    get v() { return velocity; }
  };
}
