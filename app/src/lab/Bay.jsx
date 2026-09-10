import { P } from "../lib/palette.js";
import { AISLE, BAY_D, EAVES, WORK } from "../lib/plan.js";
import Belief from "./Belief.jsx";

/* A test cell off the lane: a plinth, a back wall, a screen carrying whatever
 * that rig is running, and a lamp aimed at the work rather than at the room.
 *
 * The screen is the point. Six of these are live code -- the same modules the
 * document site runs, four of them downloading real Python as the page loads
 * -- and the way to say that in a building is to put a monitor on the rig and
 * have it show what the rig is doing. A picture of a robot is a poster; a
 * running plot bolted to a machine is a test cell.
 */
export default function Bay({ stop, children }) {
  const s = stop.side;                    // -1 left of the lane, +1 right
  const x = s * WORK;
  const back = s * (AISLE / 2 + BAY_D);

  return (
    <group position={[0, 0, -stop.at * 7.2]}>
      {/* Back wall of the cell, so the bay is a room and not an alcove. */}
      <mesh position={[back, 2.6, 0]} rotation-y={-s * Math.PI / 2} receiveShadow>
        <planeGeometry args={[9.2, 5.2]} />
        <meshStandardMaterial color={P.steelDk} roughness={0.95} metalness={0.08} />
      </mesh>

      {/* Bench the machine stands on. */}
      <mesh position={[x, 0.45, 0]} castShadow receiveShadow>
        <boxGeometry args={[2.6, 0.9, 3.0]} />
        <meshStandardMaterial color={P.steel} roughness={0.72} metalness={0.3} />
      </mesh>
      {/* Toe kick in the paint, which is where a bench actually carries it. */}
      <mesh position={[x, 0.06, 0]}>
        <boxGeometry args={[2.66, 0.12, 3.06]} />
        <meshStandardMaterial color={P.hazard} roughness={0.8} emissive={P.hazard} emissiveIntensity={0.06} />
      </mesh>

      {/* Task light over the bench: hard, close, and the reason a bay reads
          brighter than the lane it opens off. */}
      <spotLight
        position={[x, EAVES - 2.6, 1.4]}
        target-position={[x, 0.9, 0]}
        angle={0.62}
        penumbra={0.35}
        intensity={210}
        distance={16}
        decay={2}
        color={"#ffe0c4"}
        castShadow
      />

      {/* The floor of the cell, as the planner sees it, under the cursor. */}
      <Belief side={s} seed={Math.round(stop.at * 10)} />

      {children}
    </group>
  );
}
