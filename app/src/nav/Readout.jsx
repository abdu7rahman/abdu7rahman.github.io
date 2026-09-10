import { useEffect, useState } from "react";
import { STOPS, PITCH, RUN } from "../lib/plan.js";
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
    };
    read();
    window.addEventListener("scroll", read, { passive: true });
    return () => window.removeEventListener("scroll", read);
  }, []);

  const stop = STOPS[at];
  const go = (i) => {
    const doc = document.documentElement;
    const max = Math.max(1, doc.scrollHeight - window.innerHeight);
    window.scrollTo({ top: (STOPS[i].at * PITCH / RUN) * max, behavior: "smooth" });
  };

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

      {/* A rig gets a plate on the aisle; a room gets the reading itself.
          The distinction is the building's own: you glance at a cell in
          passing and you stop in a room, so a cell's caption is one line and
          a room's is everything it holds. */}
      <div className={"plate" + (stop.kind === "room" ? " plate--room" : "")} key={stop.id}>
        <p className="kind">{stop.kind === "rig" ? "Test cell" : "Room"}</p>
        <h1>{stop.title}</h1>
        {stop.sub && <p className="sub">{stop.sub}</p>}
        <p className="lede">{stop.note || stop.lede}</p>
        {stop.kind === "room" && <Panel id={stop.id} />}
      </div>
    </>
  );
}
