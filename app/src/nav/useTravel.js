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
    const tick = () => {
      setZ(v => v + (target.current - v) * 0.12);
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
