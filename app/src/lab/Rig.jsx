import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { P } from "../lib/palette.js";
import { AISLE, BAY_D } from "../lib/plan.js";

/* What stands in a cell: a screen on a stand, and a placeholder machine.
 *
 * The screen is emissive and unlit rather than a material with a light on it,
 * because a monitor is a source. It is the brightest thing in its bay by a
 * wide margin, which is correct -- in a dark building the running plot is
 * what your eye goes to, and that is exactly where the work is.
 *
 * The machine is a stand-in. The real ones are the UR12e already baked in
 * this repo and the TurtleBot and Go2 the demos drive, and wiring each rig to
 * its own is the next piece of work rather than this file's job.
 */
export default function Rig({ stop }) {
  const s = stop.side;
  const x = s * (AISLE / 2 + BAY_D / 2);
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

      {/* Placeholder machine: a column and two links, enough to read as a
          manipulator standing on the bench at this distance. */}
      <group position={[x + s * 0.45, 0.9, -0.2]}>
        <mesh position={[0, 0.18, 0]} castShadow>
          <cylinderGeometry args={[0.17, 0.2, 0.36, 16]} />
          <meshStandardMaterial color={P.machine} roughness={0.42} metalness={0.55} />
        </mesh>
        <mesh position={[0, 0.68, 0]} rotation-z={0.5} castShadow>
          <capsuleGeometry args={[0.085, 0.66, 4, 12]} />
          <meshStandardMaterial color={P.machine} roughness={0.42} metalness={0.55} />
        </mesh>
        <mesh position={[0.42, 1.12, 0]} rotation-z={-0.9} castShadow>
          <capsuleGeometry args={[0.07, 0.5, 4, 12]} />
          <meshStandardMaterial color={P.machine} roughness={0.42} metalness={0.55} />
        </mesh>
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
