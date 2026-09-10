import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { P } from "../lib/palette.js";
import UR12e from "./UR12e.jsx";
import TurtleBot from "./TurtleBot.jsx";
import Go2 from "./Go2.jsx";
import { WORK } from "../lib/plan.js";

/* What stands in a cell: a screen on a stand and the machine it is driving.
 *
 * The screen is emissive and unlit rather than a material with a light on it,
 * because a monitor is a source. It is the brightest thing in its bay by a
 * wide margin, which is correct -- in a dark building the running plot is
 * what your eye goes to, and that is exactly where the work is.
 *
 * Each cell shows the machine its demo is actually about. Three of them are
 * not arms: drive and race are a TurtleBot3 Burger and cost is a Go2, and for
 * a while all seven bays stood a UR12e because those two meshes were not in
 * this repository. They are now, so this is no longer the place where that
 * gets apologised for.
 */

/* Which machine each rig is running, keyed by the stop ids in lib/plan.js.
   Anything not named here is an arm, which is the majority and the default. */
const MACHINE = { drive: "burger", race: "burger", terrain: "go2" };

/* The bench Bay.jsx draws is a 2.6 by 3.0 m box and the 3.0 m side runs
   parallel to the aisle. That is the axis a mobile base gets to drive along,
   so it is the one passed down; TurtleBot.jsx takes its own swept radius off
   the geometry and works out the rest. Stated here rather than imported
   because Bay.jsx has it inline in a boxGeometry, and a second name for it
   would be a second thing to keep in step. */
const BENCH_RUN = 3.0;
export default function Rig({ stop }) {
  const s = stop.side;
  const x = s * WORK;
  const screen = useRef();

  useFrame(({ clock }) => {
    if (!screen.current) return;
    // A screen is never perfectly steady: a slow flicker sells it as lit.
    const f = 0.94 + Math.sin(clock.elapsedTime * 7.3 + stop.at) * 0.015;
    screen.current.material.opacity = f;
  });

  return (
    <group>
      {/* Monitor on a post at the bench's outboard edge, angled to the lane
          so it is readable from the aisle rather than only from inside. */}
      <group position={[x - s * 1.1, 1.62, 0.9]} rotation-y={-s * 0.62}>
        <mesh castShadow>
          <boxGeometry args={[1.28, 0.78, 0.06]} />
          <meshStandardMaterial color={P.steelDk} roughness={0.6} metalness={0.4} />
        </mesh>
        <mesh ref={screen} position={[0, 0, 0.035]}>
          <planeGeometry args={[1.18, 0.68]} />
          <meshBasicMaterial color={"#16323a"} transparent opacity={0.95} />
        </mesh>
        {/* A live trace across it, so the cell is running rather than idle. */}
        <mesh position={[0, -0.12, 0.038]}>
          <planeGeometry args={[1.0, 0.012]} />
          <meshBasicMaterial color={P.teal} />
        </mesh>
        <mesh position={[0.22, 0.16, 0.038]}>
          <planeGeometry args={[0.42, 0.012]} />
          <meshBasicMaterial color={P.hazard} />
        </mesh>
      </group>
      <mesh position={[x - s * 1.1, 0.9, 0.9]}>
        <cylinderGeometry args={[0.05, 0.07, 0.62, 8]} />
        <meshStandardMaterial color={P.steel} roughness={0.6} metalness={0.5} />
      </mesh>

      {/* The machine. The vendor's own triangles in all three cases, moved by
          the vendor's own kinematics: the arm by the measured module the
          document site's reachable-set formation also solves against, the
          Burger by the wheel radius and track its URDF states, the Go2 by the
          link lengths and joint limits in its. Each cell is offset in its
          cycle so the building is not seven machines moving in unison, which
          reads as an animation rather than as seven rigs running.

          A mobile base sits at the middle of its bench rather than at the
          arm's offset, because it needs the length of it to drive down and
          the arm needed the near corner to reach over. */}
      {MACHINE[stop.id] === "burger" ? (
        <group position={[x, 0.9, 0]}>
          <TurtleBot phase={(stop.at * 0.37) % 1} bench={BENCH_RUN} />
        </group>
      ) : MACHINE[stop.id] === "go2" ? (
        <group position={[x, 0.9, 0]}>
          <Go2 phase={(stop.at * 0.37) % 1} />
        </group>
      ) : (
        <group position={[x + s * 0.35, 0.9, -0.2]}>
          <UR12e phase={(stop.at * 0.37) % 2} />
        </group>
      )}

      {/* The e-stop, which is the smallest and most necessary orange in the
          building. It belongs to the cell rather than to the machine -- a
          mobile base drives away from its own bench and the button does not
          go with it -- so it stands on the bench beside whatever is running. */}
      <mesh position={[x - s * 0.95, 0.915, 0.95]} castShadow>
        <cylinderGeometry args={[0.055, 0.055, 0.03, 12]} />
        <meshStandardMaterial color={P.hazard} emissive={P.hazard} emissiveIntensity={0.5} roughness={0.5} />
      </mesh>
    </group>
  );
}
