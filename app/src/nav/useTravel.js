import { useEffect, useRef, useState } from "react";
import { RUN } from "../lib/plan.js";

/* How far into the building you are, in metres, driven by the wheel.
 *
 * Scroll and not free-flight, deliberately. A first-person controller in a
 * portfolio is a thing the reader has to learn before they can see anything,
 * it strands anyone on a trackpad, and it has no answer at all on a phone.
 * The wheel already means "further in" to everybody, and the building is a
 * straight line, so one axis is the whole vocabulary.
 *
 * The document keeps a real scrollbar for the same reason -- the page is as
 * long as the building, so the browser's own affordances, the keyboard, and
 * a phone's flick all work without this file knowing about any of them.
 */
export function useTravel() {
  const [z, setZ] = useState(0);
  const target = useRef(0);
  const raf = useRef(0);

  useEffect(() => {
    const doc = document.documentElement;
    const read = () => {
      const max = Math.max(1, doc.scrollHeight - window.innerHeight);
      target.current = (window.scrollY / max) * RUN;
    };
    /* Eased against the clock, not against the frame.
    
       A fixed fraction per frame is a different time constant on every
       machine: at 60 Hz 0.12 closes the gap in about a fifth of a second, and
       on a device drawing 4 frames a second it takes six. The second case is
       not hypothetical -- it is a phone under load, and it is every headless
       render this project is checked with, where the camera was still halfway
       to its mark when the shutter went. 1 - 0.0015^dt is the same curve
       expressed per second, so the settle takes the same wall time wherever
       it runs. */
    let last = performance.now();
    const tick = (now) => {
      const dt = Math.min(0.1, (now - last) / 1000); last = now;
      const k = 1 - Math.pow(0.0015, dt);
      setZ(v => v + (target.current - v) * k);
      raf.current = requestAnimationFrame(tick);
    };
    read();
    window.addEventListener("scroll", read, { passive: true });
    window.addEventListener("resize", read, { passive: true });
    raf.current = requestAnimationFrame(tick);
    return () => {
      window.removeEventListener("scroll", read);
      window.removeEventListener("resize", read);
      cancelAnimationFrame(raf.current);
    };
  }, []);

  return z;
}
