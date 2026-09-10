import { useEffect, useRef } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import { buildMap, BUILDING, mapState, SLAB_LO, SLAB_HI } from "./building.js";
import { survey } from "./survey.js";
import { route, nearestFree, visible } from "./route.js";
import { Grid } from "./occupancy.js";

/* Take the map, once the building is actually in the scene.
 *
 * The wait is not a guess dressed up as a delay. Everything under Suspense
 * mounts when its own data arrives, and a survey run in an effect on the
 * first commit sees the slab and the columns and none of the benches. So
 * this counts frames and surveys on the third, by which point React has
 * flushed every mount that had nothing to wait for -- and then watches the
 * scene's child count and re-surveys if it changes, which is what catches
 * the components that did have something to wait for.
 */
export default function Survey({ onReady }) {
  const scene = useThree(s => s.scene);
  const frames = useRef(0);
  const seen = useRef(-1);
  const settle = useRef(0);

  useFrame(() => {
    frames.current++;
    if (frames.current < 3) return;
    let n = 0;
    scene.traverse(() => n++);
    if (n !== seen.current) { seen.current = n; settle.current = 0; return; }
    // Two consecutive frames with the same object count, then measure.
    if (++settle.current !== 2) return;
    const stats = buildMap(scene);
    if (typeof window !== "undefined") {
      if (!window.__lab) window.__lab = {};
      window.__lab.map = BUILDING;
      window.__lab.mapStats = stats;
      /* A probe hook, so a question like "what is standing in the aisle" is
         answered by re-surveying one object at a time rather than by
         reading components and guessing. */
      window.__lab.surveyOne = (obj, grid) => survey(obj, grid, { lo: SLAB_LO, hi: SLAB_HI });
      window.__lab.Grid = Grid;
      window.__lab.route = route;
      window.__lab.nearestFree = nearestFree;
      window.__lab.visible = visible;
    }
    if (onReady) onReady(BUILDING, stats);
  });

  useEffect(() => () => {
    if (typeof window !== "undefined" && window.__lab) delete window.__lab.map;
  }, []);

  return null;
}

export { BUILDING, mapState };
