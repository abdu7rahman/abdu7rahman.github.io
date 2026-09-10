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
/* How long the document is, in pixels per metre of building.
 *
 * It was 34, which put 66.24 m of aisle into 2,252 px: one wheel notch is
 * about 100 px, so a notch moved you 2.9 m -- most of the way from one bay
 * to the next -- and stopping at a station meant landing a wheel click on a
 * target a third of a notch wide. Every part of the scroll felt bad and
 * that was the whole reason.
 *
 * 130 makes the document 8,611 px and a notch 0.77 m, which is a step. It
 * costs nothing: the page has no content of its own, it is a scrollbar with
 * a length.
 */
export const PX_PER_M = 130;

/* Where a scroll position puts you, in metres into the building, and the
 * mapping runs backwards on purpose.
 *
 * Down the page used to be further in. That reads as pushing the world away
 * from you rather than walking into it -- the building recedes as the
 * scrollbar advances, which is the opposite of what the same gesture does in
 * every first-person control there is. Inverted, the wheel rolls forward and
 * you go forward, and the page starts at its own bottom so the entrance is
 * where you land.
 *
 * One function, exported, because nav/Readout.jsx has to invert it to scroll
 * to a station and two copies of a mapping like this drift the first time
 * either is touched.
 */
export function travelAt(scrollY, max) {
  return (1 - scrollY / max) * RUN;
}

export function scrollForTravel(z, max) {
  return (1 - z / RUN) * max;
}

export function useTravel() {
  const [z, setZ] = useState(0);
  const target = useRef(0);
  const raf = useRef(0);

  useEffect(() => {
    const doc = document.documentElement;
    const read = () => {
      const max = Math.max(1, doc.scrollHeight - window.innerHeight);
      target.current = travelAt(window.scrollY, max);
    };
    /* Start at the far end of the document, which is the near end of the
       building. See the note on travelAt: the mapping runs backwards, so the
       entrance is the bottom of the page and walking in scrolls up. Done
       before the first read so the camera never starts at the office and
       eases forward through the whole building. */
    if (window.scrollY === 0) {
      window.scrollTo(0, Math.max(1, doc.scrollHeight - window.innerHeight));
    }
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
