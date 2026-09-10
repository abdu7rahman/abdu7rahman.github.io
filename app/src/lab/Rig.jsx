import { P } from "../lib/palette.js";
import UR12e from "./UR12e.jsx";
import TurtleBot from "./TurtleBot.jsx";
import Go2 from "./Go2.jsx";
import { WORK } from "../lib/plan.js";
import SearchRig from "./SearchRig.jsx";

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

/* Cells that run their own work on the bench rather than standing a machine
   next to a picture of it. lab/SearchRig.jsx is the first: it lays an
   occupancy grid on the bench top, expands a real A* across it, and drives
   the real Burger down the path that comes out. Anything named here owns its
   whole cell -- the machine included -- so this file steps out of the way. */
const RUNS = { space: SearchRig };

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
  const Own = RUNS[stop.id];
  if (Own) return <Own stop={stop} />;
  return (
    <group>
      {/* The monitor itself belongs to bays/Screens.jsx, which owns the
          running demo and the texture it is drawn on. This file drew one too,
          at exactly the same transform, and the two z-fought -- the opaque
          placeholder won, so every cell showed two coloured bars while a real
          demo rendered into a texture nobody could see. One screen, and the
          file that has something to put on it draws it. The post stays here,
          because a post is furniture and not a display. */}
      <mesh position={[x + s * 1.05, 0.9, 0.9]}>
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
        <group position={[x - s * 0.5, 0.9, -0.2]}>
          <UR12e phase={(stop.at * 0.37) % 2} />
        </group>
      )}

      {/* The e-stop, which is the smallest and most necessary orange in the
          building. It belongs to the cell rather than to the machine -- a
          mobile base drives away from its own bench and the button does not
          go with it -- so it stands on the bench beside whatever is running.
          On the aisle corner, which is the one part of this layout that is
          not about the camera: a stop button you have to reach across a
          working machine to press is not a stop button. */}
      <mesh position={[x - s * 1.12, 0.915, 0.95]} castShadow>
        <cylinderGeometry args={[0.055, 0.055, 0.03, 12]} />
        <meshStandardMaterial color={P.hazard} emissive={P.hazard} emissiveIntensity={0.5} roughness={0.5} />
      </mesh>
    </group>
  );
}
