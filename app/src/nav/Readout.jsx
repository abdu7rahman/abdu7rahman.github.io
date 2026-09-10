import { useEffect, useRef, useState } from "react";
import { STOPS, PITCH, RUN } from "../lib/plan.js";
import { travelAt, scrollForTravel } from "./useTravel.js";
import { isOpen } from "../bays/overlay.js";
import Panel from "./Panel.jsx";
import Console from "./Console.jsx";

/* The one piece of chrome: where you are in the building, named.
 *
 * A 66 m aisle with thirteen things off it needs an index or it is a maze,
 * and the honest form for it here is a station list rather than a nav bar --
 * the same readout a facility has by the door. It is also the fallback: with
 * the canvas gone this is still a set of links to real anchors.
 */
export default function Readout() {
  const [at, setAt] = useState(0);
  /* Closed until it is asked for, with one exception, and the exception is
     the point of the front page.
  
     The reading is 2,926 words, five benchmark tables and 182 measured
     figures, and putting all of it on screen the moment somebody arrives is
     answering a question nobody asked -- it covers the building they came to
     look at, at every one of thirteen stations. So the building is what you
     get and the words are one press away.
  
     The entrance is not that. It is who this is and what he does, and a
     portfolio whose front page makes you press a key to find out whose it is
     has hidden the only thing every visitor wants. So the high bay opens
     with its reading up and closing it is a decision the reader makes;
     walking on from a station they have not closed keeps it up, and once
     they close it, it stays closed. What is never done here is deciding for
     them twice. */
  const [read, setRead] = useState(true);
  // Whether the reader has said anything about it yet. Until they have, the
  // entrance shows and the rest do not; after that, their answer holds
  // everywhere.
  const [asked, setAsked] = useState(false);
  const ask = (v) => { setAsked(true); setRead(v); };
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
      const z = travelAt(window.scrollY, max);
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
  /* What is actually on screen. The entrance carries its own reading until
     the reader has said otherwise; everywhere else waits to be asked. */
  const showing = read && (asked || stop.id === "entry");
  const readRef = useRef(read);
  readRef.current = showing;
  const wide = ["work", "measured", "path"].includes(stop.id);
  const go = (i) => {
    const n = Math.max(0, Math.min(STOPS.length - 1, i));
    aim.current = n;
    droveAt.current = Date.now();
    /* Instant, and the camera does the smoothing.
    
       This used to hand the browser a smooth scroll and let it animate
       8,611 px of scrollbar. A smooth scroll is driven from the main thread,
       and this page's main thread is busy drawing a building -- measured
       under a software rasteriser at four frames a second, a station click
       took sixteen seconds to arrive and a second click issued in the
       meantime was serviced with the first one's target. Which is to say
       the index appeared to do nothing, and then to do the wrong thing.
    
       Jumping the scroll and letting nav/useTravel.js ease the camera gives
       the same glide and gives it at any frame rate: the ease is
       1 - k^dt, so it takes the same wall time on a workstation and on a
       phone under load. It is also the only version where two clicks in a
       second mean the second one. */
    const doc = document.documentElement;
    const max = Math.max(1, doc.scrollHeight - window.innerHeight);
    window.scrollTo({ top: scrollForTravel(STOPS[n].at * PITCH, max),
                      behavior: "auto" });
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
        if (e.key === "r" || e.key === "R") { ask(!readRef.current); e.preventDefault(); return; }
        if (e.key === "Escape" && !isOpen()) { ask(false); return; }
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

      {/* What the cell you are standing at can be told to do. Only at a
          cell: a room has nothing to operate. */}
      <Console id={stop.id} kind={stop.kind} />

      {/* The one control that asks for it, next to the one that leaves for
          the document. Both live in the corner block, which is where this
          building keeps the things that are about reading rather than about
          the work. */}
      <button className="ask" onClick={() => ask(!showing)}
              aria-expanded={showing} aria-controls="reading">
        {showing ? "Hide the writing" : "Read this station"}
        <span className="key" aria-hidden="true">R</span>
      </button>

      {/* A rig gets a plate on the aisle; a room gets the reading itself.
          The distinction is the building's own: you glance at a cell in
          passing and you stop in a room, so a cell's caption is one line and
          a room's is everything it holds. */}
      {showing && (
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
