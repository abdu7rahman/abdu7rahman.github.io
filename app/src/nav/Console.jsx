import { useEffect, useRef, useState } from "react";
import { controls, subscribe, isRunning, setRunning } from "../lab/console.js";

/* The panel that operates the cell you are standing at.
 *
 * Buttons and readouts, in the building's own type, on the same plate every
 * other piece of chrome here sits on. It appears only at a test cell,
 * because a room has nothing to operate, and it is empty for a cell that
 * has not registered anything.
 *
 * The readout is polled at 5 Hz and not driven by the scene. What it shows
 * changes every frame -- how many nodes a search has expanded, how far each
 * controller has driven -- and pushing that through React at frame rate
 * would re-render the tree sixty times a second to move a number. Five
 * times a second is faster than anybody reads and a five-hundredth of the
 * work.
 */
export default function Console({ id, kind }) {
  const [, bump] = useState(0);
  const [rows, setRows] = useState([]);
  const [say, setSay] = useState("");
  const spec = useRef(null);

  useEffect(() => subscribe(() => bump(n => n + 1)), []);

  /* The interval looks the spec up every tick rather than caching it once.
  
     The rigs register from their own effects inside the R3F root, which
     commits after this tree, so on first mount controls(id) is null -- and
     an effect that captured that null created no interval and never made
     another, so the readout for whichever cell you loaded on was blank
     until you walked away and came back. Looking it up per tick costs a Map
     get five times a second. */
  useEffect(() => {
    const tick = () => {
      const c = controls(id);
      spec.current = c;
      setRows(c && c.readout ? (c.readout() || []) : []);
      setSay(c && c.say ? (c.say() || "") : "");
    };
    tick();
    const h = setInterval(tick, 200);
    return () => clearInterval(h);
  }, [id]);

  if (kind !== "rig") return null;
  const c = controls(id);
  if (!c) return null;
  const run = isRunning(id);

  return (
    <section className="console" aria-label="Cell controls">
      <p className="console__id">{c.title || "Controls"}</p>

      {/* What the cell is doing, in words, right now.
       *
       * Every cell already published a readout, and a readout is a set of
       * numbers for somebody who already knows what they are looking at. A
       * visitor who has just been walked to a bench does not, and the site
       * was leaving them to work it out from a grid of labels -- "expanded
       * 74, open 17" says nothing about the fact that a search is running
       * and about to hand a path to a robot. This is one line, in plain
       * English, that the cell writes itself and changes as it works. */}
      {say && <p className="console__say" aria-live="polite">{say}</p>}

      <div className="console__row">
        <button className="console__btn" onClick={() => setRunning(id, !run)}
                aria-pressed={!run}>
          {run ? "Pause" : "Run"}
        </button>
        {(c.actions || []).map(a => (
          <button key={a.label} className="console__btn" onClick={a.on}>
            {a.label}
          </button>
        ))}
      </div>

      {/* A choice, when the cell has one: which planner, which cost, which
          controller. Rendered as a row of pressed states rather than a
          select, because a select on a dark canvas is the operating
          system's widget and not this building's. */}
      {c.choice && (
        <div className="console__row console__row--pick">
          {c.choice.options.map(o => (
            <button key={o.value}
                    className={"console__pick" + (c.choice.get() === o.value ? " on" : "")}
                    onClick={() => { c.choice.set(o.value); bump(n => n + 1); }}>
              {o.label}
            </button>
          ))}
        </div>
      )}

      {!!rows.length && (
        <dl className="console__out">
          {rows.map(([k, v]) => (
            <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
          ))}
        </dl>
      )}

      {c.hint && <p className="console__hint">{c.hint}</p>}
    </section>
  );
}
