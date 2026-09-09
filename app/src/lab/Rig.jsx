import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { P } from "../lib/palette.js";
import UR12e from "./UR12e.jsx";
import { WORK } from "../lib/plan.js";

/* What stands in a cell: a screen on a stand and the machine it is driving.
 *
 * The screen is emissive and unlit rather than a material with a light on it,
 * because a monitor is a source. It is the brightest thing in its bay by a
 * wide margin, which is correct -- in a dark building the running plot is
 * what your eye goes to, and that is exactly where the work is.
 *
 * Every cell shows a UR12e for now. Three of them should not: drive, race and
 * cost are a TurtleBot and a Go2, and those meshes are not in this repository
 * yet. Standing the wrong machine in a cell is a lie a reader who knows what
 * a robot is will catch immediately, so it is written down here rather than
 * left to be noticed.
 */
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

      {/* The machine. Universal Robots' own triangles, articulated by the
          measured kinematics -- the same module the document site's arm and
          its reachable-set formation solve against. Each cell is offset in
          the cycle so the building is not seven arms moving in unison, which
          reads as an animation rather than as seven rigs running. */}
      <group position={[x + s * 0.35, 0.9, -0.2]}>
        <UR12e phase={(stop.at * 0.37) % 2} />
        {/* The e-stop, which is the smallest and most necessary orange in the
            building. */}
        <mesh position={[0.14, 0.1, 0.2]}>
          <cylinderGeometry args={[0.055, 0.055, 0.03, 12]} />
          <meshStandardMaterial color={P.hazard} emissive={P.hazard} emissiveIntensity={0.5} roughness={0.5} />
        </mesh>
      </group>
    </group>
  );
}
