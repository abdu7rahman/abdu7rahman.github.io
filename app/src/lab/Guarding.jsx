import { useMemo } from "react";
import { P } from "../lib/palette.js";
import { AISLE, PITCH, RUN, STOPS } from "../lib/plan.js";

/* The guarding line down both sides of the lane, and the one place all that
 * orange belongs.
 *
 * A cell that can move on its own is fenced, and the fence is painted the
 * colour a standard reserves for a hazard. So the aisle is bounded by mesh
 * panels in steel frames with an orange top rail and an orange kick rail, and
 * that single run of paint down both sides of a 66 m building is what carries
 * the colour through the whole shot without a single decorative surface.
 *
 * It breaks at every bay mouth, because a bay you cannot walk into is a
 * picture of a bay. The gaps are where the chevrons on the slab are.
 */
const PANEL = 2.4;              // one fence panel, frame to frame
const H = 1.9;                  // guarding height

export default function Guarding() {
  const panels = useMemo(() => {
    const mouths = STOPS.filter(s => s.side !== 0)
                        .map(s => ({ z: -s.at * PITCH, side: s.side }));
    const out = [];
    for (const side of [-1, 1]) {
      const x = side * (AISLE / 2);
      for (let z = PITCH; z > -RUN - PITCH; z -= PANEL) {
        const mid = z - PANEL / 2;
        // Leave the run open where a bay opens onto it.
        const open = mouths.some(m => m.side === side && Math.abs(m.z - mid) < 3.4);
        if (!open) out.push([x, mid, side]);
      }
    }
    return out;
  }, []);

  return (
    <group>
      {panels.map(([x, z], i) => (
        <group key={i} position={[x, 0, z]}>
          {/* posts */}
          <mesh position={[0, H / 2, -PANEL / 2]} castShadow>
            <boxGeometry args={[0.09, H, 0.09]} />
            <meshStandardMaterial color={P.steelDk} roughness={0.8} metalness={0.4} />
          </mesh>
          {/* infill, a single dark panel standing in for mesh at this range */}
          <mesh position={[0, H / 2, 0]} receiveShadow>
            <boxGeometry args={[0.03, H - 0.34, PANEL - 0.14]} />
            <meshStandardMaterial
              color={P.steelDk} roughness={0.95} metalness={0.1}
              transparent opacity={0.72}
            />
          </mesh>
          {/* the paint: top rail and kick rail */}
          <mesh position={[0, H, 0]} castShadow>
            <boxGeometry args={[0.07, 0.09, PANEL]} />
            <meshStandardMaterial
              color={P.hazard} roughness={0.55} metalness={0.15}
              emissive={P.hazard} emissiveIntensity={0.22}
            />
          </mesh>
          <mesh position={[0, 0.13, 0]}>
            <boxGeometry args={[0.06, 0.14, PANEL]} />
            <meshStandardMaterial
              color={P.hazard} roughness={0.7} metalness={0.1}
              emissive={P.hazard} emissiveIntensity={0.10}
            />
          </mesh>
        </group>
      ))}
    </group>
  );
}
