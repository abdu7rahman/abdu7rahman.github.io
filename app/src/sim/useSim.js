import { useEffect, useRef, useState } from "react";
import { engine, Sim } from "./engine.js";

/* A compiled MuJoCo scene, tied to the life of a React component.
 *
 * Two things this exists to get right, both of which are leaks rather than
 * bugs you would see.
 *
 * The engine is fetched once for the page and a cell may mount before that
 * finishes or unmount during it, so the resolve is guarded: a scene compiled
 * for a component that has gone is a model and a state on the wasm heap with
 * nobody left holding them. And Embind handles are not garbage collected, so
 * the cleanup disposes rather than dropping the reference -- five bays each
 * rebuilding a scene on a hot reload is five whole physics worlds still
 * resident.
 *
 * Returns a ref rather than state on purpose. The simulation is read every
 * frame from useFrame and a state update per frame would re-render the tree
 * sixty times a second to change nothing React can see.
 */
export function useSim(build, deps = []) {
  const ref = useRef(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let live = true;
    engine().then(mj => {
      if (!live) return;
      ref.current = new Sim(mj, build());
      setReady(true);
    }).catch(() => { if (live) setReady(false); });
    return () => {
      live = false;
      if (ref.current) { ref.current.dispose(); ref.current = null; }
      setReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return [ref, ready];
}
