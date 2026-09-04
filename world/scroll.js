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

/* Where a scene sits inside its own band, and how much of it should exist.
   `local` runs 0..1 across the band; `weight` ramps up over the fade at the
   start, holds at 1, and ramps down over the fade at the end. */
export function bandOf(scene, p) {
  const [a, b] = scene.range;
  const f = scene.fade;
  const local = Math.min(1, Math.max(0, (p - a) / Math.max(1e-6, b - a)));
  let weight = 0;
  if (p > a - f && p < b + f) {
    const up = Math.min(1, Math.max(0, (p - (a - f)) / Math.max(1e-6, f * 2)));
    const dn = Math.min(1, Math.max(0, ((b + f) - p) / Math.max(1e-6, f * 2)));
    weight = Math.min(up, dn);
    weight = weight * weight * (3 - 2 * weight);          // smoothstep
  }
  return { local, weight, live: weight > 0.001 };
}
