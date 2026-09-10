import { useEffect, useRef, useState } from "react";
import { STOPS, PITCH, RUN } from "../lib/plan.js";
import { isOpen } from "../bays/overlay.js";
import Panel from "./Panel.jsx";

/* The one piece of chrome: where you are in the building, named.
 *
 * A 66 m aisle with thirteen things off it needs an index or it is a maze,
 * and the honest form for it here is a station list rather than a nav bar --
 * the same readout a facility has by the door. It is also the fallback: with
 * the canvas gone this is still a set of links to real anchors.
 */
export default function Readout() {
  const [at, setAt] = useState(0);
  /* Closed until it is asked for, and that is the whole default.
  
     The reading is 2,926 words, five benchmark tables and 182 measured
     figures, and putting it on screen the moment somebody arrives is
     answering a question nobody asked -- it covers the building they came to
     look at, at every one of thirteen stations, whether or not they wanted
     to read anything. So the building is what you get, the index tells you
     where you are standing, and the words are one press away and stay away
     until then. Once opened it stays open while you walk, because somebody
     who asked to read once is not asking again at every stop. */
  const [read, setRead] = useState(false);
  // What the reader last asked for, which leads what the scroll has reached.
  const aim = useRef(0);
  /* When the last move came from here rather than from the reader's own
     wheel. The scroll handler syncs the intent back from the page -- it has
     to, or a wheel would leave the keyboard pointing somewhere the reader is
     not -- and during a smooth scroll of ours that sync is the animation
     overwriting the intent that started it. Presses inside a second of our
     own move do not get re-synced; anything later is the reader. */
  const droveAt = useRef(0);

  useEffect(() => {
    const doc = document.documentElement;
    const read = () => {
      const max = Math.max(1, doc.scrollHeight - window.innerHeight);
      const z = (window.scrollY / max) * RUN;
      let best = 0, bd = 1e9;
      STOPS.forEach((s, i) => {
        const d = Math.abs(s.at * PITCH - z);
        if (d < bd) { bd = d; best = i; }
      });
      setAt(best);
      if (Date.now() - droveAt.current > 900) aim.current = best;
    };
    read();
    window.addEventListener("scroll", read, { passive: true });
    return () => window.removeEventListener("scroll", read);
  }, []);

  const stop = STOPS[at];
  const wide = ["work", "measured", "path"].includes(stop.id);
  const go = (i) => {
    const n = Math.max(0, Math.min(STOPS.length - 1, i));
    aim.current = n;
    droveAt.current = Date.now();
    const doc = document.documentElement;
    const max = Math.max(1, doc.scrollHeight - window.innerHeight);
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: (STOPS[n].at * PITCH / RUN) * max,
                      behavior: still ? "auto" : "smooth" });
  };

  /* Stop to stop on the arrows, because the alternative is a line at a time.
     The building is 66 m and the document that drives it is 2,252 px, so a
     reader on a keyboard travelling by arrow key covers about a third of a
     metre a press and needs roughly two hundred of them to reach the office.
     Page Up and Page Down are no better -- they move by viewport, which is
     not related to anything in the building.

     Bound on the window and not on the index, so it works for a reader who
     has never focused the index -- and skipped entirely when the focus is in
     a field or on a link, where the arrows already mean something. */
  useEffect(() => {
    const key = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      /* R and Escape are not stepping keys and are allowed wherever the
         focus is. The guard below exists because the arrows already mean
         something on a button, a link and a select, and taking them would
         break the keyboard for anybody navigating the index -- it has
         nothing to say about a letter. Applying it to everything meant that
         after clicking the read control, which is a button and therefore
         has focus, the key the control itself advertises did nothing. */
      const t = e.target;
      const typing = t && (t.isContentEditable ||
                           /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
      if (!typing) {
        if (e.key === "r" || e.key === "R") { setRead(v => !v); e.preventDefault(); return; }
        if (e.key === "Escape" && !isOpen()) { setRead(false); return; }
      }
      if (typing || /^(A|BUTTON)$/.test(t && t.tagName)) return;
      /* Stepped from the intent, not from where the building has got to.
         Deriving the next stop from `at` looks right and drops presses: `at`
         is read back off the scroll position, the scroll is smooth, and a
         reader pressing the arrow four times in a second is asking for four
         stops while the page has only reported one. Measured, four presses
         moved two stops. The ref carries what was asked for and the scroll
         catches up. */
      const here = aim.current;
      if (e.key === "ArrowDown" || e.key === "ArrowRight") { go(here + 1); e.preventDefault(); }
      else if (e.key === "ArrowUp" || e.key === "ArrowLeft") { go(here - 1); e.preventDefault(); }
      else if (e.key === "Home") { go(0); e.preventDefault(); }
      else if (e.key === "End") { go(STOPS.length - 1); e.preventDefault(); }

    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [at]);

  return (
    <>
      <nav className="index" aria-label="Facility">
        <ol>
          {STOPS.map((s, i) => (
            <li key={s.id} className={i === at ? "on" : ""}>
              <button onClick={() => go(i)} aria-current={i === at ? "true" : undefined}>
                <span className="n">{String(i).padStart(2, "0")}</span>
                <span className="t">{s.title}</span>
              </button>
            </li>
          ))}
        </ol>
      </nav>

      {/* The one control that asks for it, next to the one that leaves for
          the document. Both live in the corner block, which is where this
          building keeps the things that are about reading rather than about
          the work. */}
      <button className="ask" onClick={() => setRead(v => !v)}
              aria-expanded={read} aria-controls="reading">
        {read ? "Hide the writing" : "Read this station"}
        <span className="key" aria-hidden="true">R</span>
      </button>

      {/* A rig gets a plate on the aisle; a room gets the reading itself.
          The distinction is the building's own: you glance at a cell in
          passing and you stop in a room, so a cell's caption is one line and
          a room's is everything it holds. */}
      {read && (
        <main className={"plate" + (stop.kind === "room" ? " plate--room" : "") + (wide ? " plate--wide" : "")}
              key={stop.id} id="reading" aria-labelledby="stop-title">
          <p className="kind">{stop.kind === "rig" ? "Test cell" : "Room"}</p>
          <h1 id="stop-title">{stop.title}</h1>
          {stop.sub && <p className="sub">{stop.sub}</p>}
          <p className="lede">{stop.note || stop.lede}</p>
          {stop.kind === "room" && <Panel id={stop.id} />}
        </main>
      )}
    </>
  );
}
