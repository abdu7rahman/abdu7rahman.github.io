import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { STOPS } from "../lib/plan.js";
import { isOpen } from "../bays/overlay.js";
import Panel from "./Panel.jsx";
import Console from "./Console.jsx";
import * as journey from "./journey.js";
import { CARDS } from "./cards.js";

/* The chrome, and there is less of it than there was.
 *
 * This used to be an index that scrolled a document which drove a camera.
 * The document is gone: you are taken round by something that walks, so the
 * index is a set of places to be taken to and the state it reflects is where
 * the guide actually is, not where a scrollbar has got to.
 *
 * It is still the fallback. With the canvas gone this is a list of stations
 * and their writing, which is the whole site in text, and that is the reason
 * the reading lives here rather than on a board in the building.
 */
export default function Readout() {
  const j = useSyncExternalStore(journey.subscribe, journey.get);
  const here = j.at || j.target;
  const at = Math.max(0, STOPS.findIndex(s => s.id === here));
  const stop = STOPS[at];

  /* Closed until it is asked for, once the visit is under way. What the
     guide is holding up says which station this is and what it is for; the
     writing is the long version and covers the building if it is left open.
     The office is the exception, because the office is reading. */
  const [read, setRead] = useState(false);
  const [asked, setAsked] = useState(false);
  const ask = (v) => { setAsked(true); setRead(v); };
  const readRef = useRef(false);

  /* In the office on the about route the cards are the reading, so the room
     panel stays shut unless it is asked for: two columns of the same
     biography, one over the other, is what it looked like otherwise. */
  const cards = j.phase === "showing" && j.at === "contact" && j.route === "about";
  const showing = j.phase === "showing" &&
                  (asked ? read : (stop && stop.kind === "room" && !cards));
  readRef.current = showing;

  const go = (i) => {
    const n = Math.max(0, Math.min(STOPS.length - 1, i));
    journey.jump(STOPS[n].id);
  };

  useEffect(() => {
    const key = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      const typing = t && (t.isContentEditable ||
                           /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
      if (!typing) {
        if (e.key === "r" || e.key === "R") { ask(!readRef.current); e.preventDefault(); return; }
        if (e.key === "Escape" && !isOpen()) { ask(false); return; }
      }
      if (typing || /^(A|BUTTON)$/.test(t && t.tagName)) return;
      if (e.key === "ArrowDown" || e.key === "ArrowRight") { go(at + 1); e.preventDefault(); }
      else if (e.key === "ArrowUp" || e.key === "ArrowLeft") { go(at - 1); e.preventDefault(); }
      else if (e.key === "Home") { go(0); e.preventDefault(); }
      else if (e.key === "End") { go(STOPS.length - 1); e.preventDefault(); }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [at]);

  const left = journey.remaining();

  return (
    <>
      {/* Being met. Two ways to go and nothing else on screen, because the
          first thing a visitor has to do is answer one question. */}
      {j.phase === "greeting" && (
        <div className="meet" role="dialog" aria-label="Where would you like to go">
          <p className="meet__who">Abdul Rahman &middot; robotics engineer</p>
          <h1 className="meet__ask">Where do you want to start?</h1>
          <div className="meet__pick">
            <button className="meet__btn" onClick={() => journey.choose("demos")}>
              <span className="meet__t">The floor</span>
              <span className="meet__s">Eight cells you can operate. Pick one and I will walk you to it.</span>
            </button>
            <button className="meet__btn" onClick={() => journey.choose("about")}>
              <span className="meet__t">About me</span>
              <span className="meet__s">The office, and what I have actually built.</span>
            </button>
          </div>
          {/* No document link here. The corner block carries one already and
              it is on screen at the same time, so the greeting was offering
              the same exit twice at the one moment it should be asking a
              single question. */}
        </div>
      )}

      <nav className="index" aria-label="Facility" data-phase={j.phase}>
        <ol>
          {STOPS.map((s, i) => (
            <li key={s.id} className={
              (s.id === here ? "on" : "") + (j.seen.includes(s.id) ? " seen" : "")
            }>
              <button onClick={() => go(i)} aria-current={s.id === here ? "true" : undefined}>
                <span className="n">{String(i).padStart(2, "0")}</span>
                <span className="t">{s.title}</span>
              </button>
            </li>
          ))}
        </ol>
      </nav>

      {/* Where the guide is up to, in words, because a machine walking away
          down a 66 m aisle needs to say where it is going. */}
      {j.phase === "walking" && (
        <p className="going" aria-live="polite">
          Walking to <b>{stop ? stop.title : ""}</b>
        </p>
      )}

      {j.phase === "showing" && stop && stop.kind === "rig" && (
        <Console id={stop.id} kind={stop.kind} />
      )}

      {/* The office, on the about route: one card at a time, held up, and a
          row of the others to swap to. The guide puts the board down before
          it changes what is written on it, which is why this is a set of
          cards and not a set of tabs. */}
      {cards && (
        <div className="cards">
          <p className="cards__body">{CARDS[Math.min(j.card, CARDS.length - 1)].body}</p>
          <ol className="cards__row">
            {CARDS.map((c, i) => (
              <li key={c.id}>
                <button className={i === j.card ? "on" : ""}
                        onClick={() => journey.nextCard(i)}
                        aria-current={i === j.card ? "true" : undefined}>
                  {c.title}
                </button>
              </li>
            ))}
          </ol>
          <button className="cards__go" onClick={() => journey.choose("demos")}>
            Now show me the floor
          </button>
        </div>
      )}

      {j.phase === "showing" && (
        <div className="after">
          <button className="ask" onClick={() => ask(!showing)}
                  aria-expanded={showing} aria-controls="reading">
            {showing ? "Hide the writing" : "Read this station"}
            <span className="key" aria-hidden="true">R</span>
          </button>
          <button className="ask ask--go" onClick={() => journey.done()}>
            {left.length === 0 && j.route === "demos" && stop.id !== "contact"
              ? "That is all of them — to the office"
              : "Somewhere else"}
          </button>
        </div>
      )}

      {showing && stop && (
        <main className={"plate" + (stop.kind === "room" ? " plate--room" : "") +
                         (["work", "measured", "path"].includes(stop.id) ? " plate--wide" : "")}
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
