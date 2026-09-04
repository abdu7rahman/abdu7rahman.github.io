/* The pointer, as a physical thing.
 *
 * Mapping mouse coordinates straight onto a transform is what makes a scene
 * feel like a diagram being dragged. This runs a critically-ish damped spring
 * instead, so the world leans after you and settles rather than tracking you
 * exactly, and a flick has consequences a frame or two later.
 */
import { CAMERA } from "./config.js";

export function makePointer() {
  const t = { x: 0, y: 0 };            // target, -1..1 from screen centre
  const s = { x: 0, y: 0 };            // spring position
  const v = { x: 0, y: 0 };            // spring velocity
  let speed = 0, inside = false;

  function onMove(e) {
    if (e.pointerType === "touch") return;
    t.x = (e.clientX / window.innerWidth) * 2 - 1;
    t.y = (e.clientY / window.innerHeight) * 2 - 1;
    inside = true;
  }
  function onLeave() { t.x = 0; t.y = 0; inside = false; }

  window.addEventListener("pointermove", onMove, { passive: true });
  document.addEventListener("pointerleave", onLeave);

  const { stiffness, damping } = CAMERA.pointer;
  return {
    update(dt) {
      // Semi-implicit Euler: cheap, stable at the step sizes a browser gives
      // you, and it does not blow up when a tab comes back from the
      // background with a 2-second dt.
      const h = Math.min(0.05, dt);
      for (const k of ["x", "y"]) {
        const a = (t[k] - s[k]) * stiffness * 60 * h - v[k] * damping;
        v[k] += a;
        s[k] += v[k] * h;
      }
      speed = Math.hypot(v.x, v.y);
    },
    get x() { return s.x; },
    get y() { return s.y; },
    /* How fast the pointer is being moved, for the shaders that answer to it. */
    get speed() { return speed; },
    get inside() { return inside; },
    dispose() {
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
    }
  };
}
