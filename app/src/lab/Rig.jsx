import Fixtures from "./Fixtures.jsx";
import SearchRig from "./SearchRig.jsx";
import DriveRig from "./DriveRig.jsx";
import SwerveRig from "./SwerveRig.jsx";
import ForeseeRig from "./ForeseeRig.jsx";
import RaceRig from "./RaceRig.jsx";
import TerrainRig from "./TerrainRig.jsx";
import SortRig from "./SortRig.jsx";
import PolicyRig from "./PolicyRig.jsx";

/* What stands in a cell, which is now always the cell's own rig.
 *
 * This file used to be the cell: a screen on a stand, and next to it one of
 * three vendor meshes going through a canned cycle while the demo it was
 * about ran on the monitor as a picture. Cell by cell each of those was
 * replaced by a rig that does the work on the bench -- a real occupancy grid
 * with a real A* over it, a real MPPI, a real checkpoint driving a real
 * Burger -- and with lab/PolicyRig.jsx the eighth and last one went.
 *
 * So the fallback is gone rather than left in reach. It had drifted into
 * something untrue on its way out: its comment claimed the building would
 * otherwise be "seven machines moving in unison", and it offset each cell's
 * phase by stop.at to avoid that, for cells that had not read either number
 * in months. A branch that cannot run is a branch nobody re-reads, and this
 * one had been describing a building that no longer existed.
 *
 * tools/test_lab.js checks that every rig stop in lib/plan.js is named here,
 * so adding a stop without a rig fails a test run rather than rendering an
 * arm with nothing to do.
 */
const RUNS = { space: SearchRig, drive: DriveRig, swerve: SwerveRig,
               foresee: ForeseeRig, race: RaceRig, terrain: TerrainRig,
               assemble: SortRig, policy: PolicyRig };

export default function Rig({ stop }) {
  const Own = RUNS[stop.id];
  /* Fixtures is still this file's, because it is the furniture every cell
     has whatever is running in it -- the stand, the post, the guarding --
     and a rig should not have to redraw a bench to own its bench top.

     The rig gets a name so what a cell costs can be asked of the built
     scene rather than counted off the source. lib/capability.js's cost
     table is taken that way, by hiding these and rendering again, and the
     tier ladder is decided by what comes back. It costs eight more
     Object3Ds and eight more matrix multiplies a frame -- three walks the
     whole graph in updateMatrixWorld whether a local matrix is identity or
     not -- against the 693 draw calls the same frame spends, which is a
     price worth paying for a number that is measured. */
  return <><Fixtures stop={stop} /><group name={"rig:" + stop.id}><Own stop={stop} /></group></>;
}
