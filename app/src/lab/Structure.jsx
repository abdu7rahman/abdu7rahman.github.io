import { useMemo } from "react";
import * as THREE from "three";
import { Instances, Instance } from "@react-three/drei";
import { P } from "../lib/palette.js";
import { PITCH, AISLE, EAVES, RUN } from "../lib/plan.js";

/* The building: portal frames on the structural grid, a crane rail down the
 * lane, cable tray beside it, and the luminaires that light all of it.
 *
 * Instanced, because there are a lot of them and they are the same six or
 * seven shapes repeated -- which is also true of the real thing, and is most
 * of why an industrial building looks the way it does. The depth cue the
 * whole shot depends on is a repeat you can count, so the grid is never
 * jittered and never randomised.
 */
const FRAMES = Math.ceil(RUN / PITCH) + 2;

export default function Structure() {
  const bays = useMemo(() => Array.from({ length: FRAMES }, (_, i) => -i * PITCH + PITCH), []);
  const halfSpan = AISLE / 2 + 7.6;

  return (
    <group>
      {/* Columns. Two per frame, standing on the lane's outer edge. */}
      <Instances limit={FRAMES * 2} castShadow receiveShadow>
        <boxGeometry args={[0.42, EAVES, 0.42]} />
        <meshStandardMaterial color={P.steel} roughness={0.78} metalness={0.35} />
        {bays.map((z, i) => (
          <group key={"c" + i}>
            <Instance position={[-halfSpan, EAVES / 2, z]} />
            <Instance position={[ halfSpan, EAVES / 2, z]} />
          </group>
        ))}
      </Instances>

      {/* Rafters: one box across each frame at the eaves. */}
      <Instances limit={FRAMES} castShadow>
        <boxGeometry args={[halfSpan * 2, 0.62, 0.36]} />
        <meshStandardMaterial color={P.steelDk} roughness={0.7} metalness={0.4} />
        {bays.map((z, i) => <Instance key={"r" + i} position={[0, EAVES, z]} />)}
      </Instances>

      {/* Crane rail: two continuous runners down the lane at gantry height,
          which is what tells you the lane is a lane and not a corridor. */}
      {[-1, 1].map(s => (
        <mesh key={"rail" + s} position={[s * (AISLE / 2 - 0.5), EAVES - 1.5, -RUN / 2]} castShadow>
          <boxGeometry args={[0.22, 0.5, RUN + 30]} />
          <meshStandardMaterial color={P.steel} roughness={0.5} metalness={0.65} />
        </mesh>
      ))}

      {/* Cable tray, offset so it does not read as a third rail. */}
      <mesh position={[AISLE / 2 + 1.4, EAVES - 0.9, -RUN / 2]}>
        <boxGeometry args={[0.5, 0.14, RUN + 30]} />
        <meshStandardMaterial color={P.steelDk} roughness={0.9} metalness={0.2} />
      </mesh>

      {/* High-bay luminaires on the grid, every other frame, with the lamp
          face emissive so the source is visible as well as its effect. */}
      {bays.filter((_, i) => i % 2 === 0).map((z, i) => (
        <group key={"l" + i} position={[0, EAVES - 0.75, z]}>
          <mesh castShadow>
            <cylinderGeometry args={[0.46, 0.30, 0.34, 12]} />
            <meshStandardMaterial color={P.steelDk} roughness={0.6} metalness={0.5} />
          </mesh>
          <mesh position={[0, -0.18, 0]}>
            <cylinderGeometry args={[0.30, 0.30, 0.03, 12]} />
            <meshBasicMaterial color={"#ffd9b8"} />
          </mesh>
          <pointLight
            position={[0, -0.4, 0]}
            color={"#ffcfa8"}
            intensity={110}
            distance={34}
            decay={2}
          />
        </group>
      ))}
    </group>
  );
}
