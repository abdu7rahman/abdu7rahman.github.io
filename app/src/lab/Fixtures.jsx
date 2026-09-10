import { P } from "../lib/palette.js";
import { WORK } from "../lib/plan.js";

/* The two pieces of a cell that belong to the cell and not to what it is
 * running: the stand under the monitor and the stop button.
 *
 * lab/Rig.jsx drew both, and a bay that runs its own work returns before it
 * gets there -- so the five rigs that took themselves over lost the post
 * from under their screen, which then hung in the air, and lost the e-stop
 * entirely. Both live here now and every cell renders them, which is the
 * point: a machine is what a cell is for and these two are what a cell is.
 */
export default function Fixtures({ stop }) {
  const s = stop.side;
  const x = s * WORK;
  return (
    <group>
      {/* The stand. bays/Screens.jsx puts the screen at WORK + 1.05 on the
          far corner of the bench and this has to agree with it; if the two
          ever disagree the screen floats, which is the fault this file was
          added to fix. */}
      <mesh position={[x + s * 1.05, 0.9, 0.9]} castShadow>
        <cylinderGeometry args={[0.05, 0.07, 0.62, 8]} />
        <meshStandardMaterial color={P.steel} roughness={0.6} metalness={0.5} />
      </mesh>

      {/* The e-stop, on the aisle corner: a stop button you have to reach
          across a working machine to press is not a stop button. */}
      <mesh position={[x - s * 1.12, 0.915, 0.95]} castShadow>
        <cylinderGeometry args={[0.055, 0.055, 0.03, 12]} />
        <meshStandardMaterial color={P.hazard} emissive={P.hazard}
          emissiveIntensity={0.5} roughness={0.5} />
      </mesh>
    </group>
  );
}
