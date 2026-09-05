/* Normalised scroll, smoothed once, read by everything.
 *
 * One place turns "how far down the document are we" into a number between 0
 * and 1, and one place smooths it. Every scene and the camera read the same
 * eased value, which is what keeps them in step: smoothing per-consumer is
 * how a camera ends up a frame ahead of the thing it is looking at.
 */
import { CAMERA, STAGE_READ } from "./config.js";

export function makeScroll() {
  let raw = 0, eased = 0, velocity = 0, last = 0;

  function read() {
    const st = window.__stage;
    if (st && st.on()) {
      // Staged: the document does not scroll, so it cannot say where anybody
      // is. Which state you are in and how far down it you have read is the
      // whole coordinate -- a state change advances it by the part of a span
      // that reading did not, which is what the camera flies across.
      const n = st.of, i = Math.max(0, st.at());
      const el = st.panel();
      const slack = el ? el.scrollHeight - el.clientHeight : 0;
      const u = slack > 4 ? Math.min(1, Math.max(0, el.scrollTop / slack)) : 0;
      // The last state reads all the way to the end of its span; there is no
      // flight after it to leave room for.
      raw = n > 0 ? Math.min(1, (i + u * (i === n - 1 ? 1 : STAGE_READ)) / n) : 0;
      return;
    }
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
      // Read every frame rather than on an event. A staged page emits no
      // scroll events at all -- the wheel is intercepted and a panel's own
      // scrollTop is written by hand -- and three property reads a frame is
      // cheaper than the listeners it would take to catch every way that
      // number can move.
      read();
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
