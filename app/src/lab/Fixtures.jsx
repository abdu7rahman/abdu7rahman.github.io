import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { P } from "../lib/palette.js";
import { AISLE, BAY_D, WORK } from "../lib/plan.js";
import { member } from "./steel.js";

/* Everything in a cell that belongs to the cell rather than to what it is
 * running: the stand under the monitor, the stop button, and the services
 * against the back wall.
 *
 * lab/Rig.jsx drew the first two, and a bay that runs its own work returns
 * before it gets there -- so the five rigs that took themselves over lost the
 * post from under their screen, which then hung in the air, and lost the
 * e-stop entirely. Both live here now and every cell renders them, which is
 * the point: a machine is what a cell is for and these are what a cell is.
 *
 * The services are newer and were added for a different reason. A cell is a
 * bench and a machine in front of a 9.2 by 5.2 m wall, and that wall gets no
 * light -- the task lamp is a spot on the bench -- so behind every robot in
 * this building there was a black rectangle taller than the shot. Nothing
 * lights it cheaply. What fixes it is not light but silhouette: a controller
 * cabinet, a tray of cable coming off it and a gas bottle read perfectly well
 * as dark shapes against a dark wall, because their edges catch the same
 * spill the bench does and a flat plane has no edges.
 */

/* The controller and its tray, as members. One instanced draw for all of it
   including the shadow pass -- see lab/steel.js. */
function services(s) {
  const steel = [], dark = [];
  const bx = s * (AISLE / 2 + BAY_D - 0.75);   // hard against the back wall
  // The cabinet: a 2.0 m enclosure and a 1.2 m one beside it, because a cell
  // has a controller and a distribution board and they are not one box.
  dark.push([bx, 0.02, -2.4, bx, 2.05, -2.4, 0.62, 0.90]);
  dark.push([bx, 0.02, -0.95, bx, 1.25, -0.95, 0.55, 0.72]);
  // Plinths, so neither one is standing directly on the slab.
  steel.push([bx, 0.0, -2.4, bx, 0.08, -2.4, 0.66, 0.94]);
  steel.push([bx, 0.0, -0.95, bx, 0.08, -0.95, 0.59, 0.76]);
  // Door furniture: two hinges and a handle down the face of the big one.
  const fx = bx - s * 0.32;
  for (const z of [-2.78, -2.02]) steel.push([fx, 0.5, z, fx, 1.9, z, 0.05, 0.05]);
  steel.push([fx, 1.05, -2.4, fx, 1.35, -2.4, 0.07, 0.07]);
  // Cable tray, off the top of the cabinet and out over the bench, with the
  // drop that feeds the machine. A tray is the one line in a cell that
  // crosses it, and crossing it is the whole job.
  /* The run stays at z = -2.4, which is half a metre behind the bench, and
     the drop lands 1.8 m off the bench centreline. Both numbers are
     clearances rather than composition: the bench is 3.0 by 3.8 m and
     everything above its top inside that footprint belongs to whatever the
     cell is running. A conduit through the middle of an occupancy grid is
     not a detail, it is a fault. */
  const tx = s * (WORK + 1.8);
  steel.push([bx, 2.55, -2.4, tx, 2.55, -2.4, 0.10, 0.34]);
  steel.push([tx, 1.05, -2.4, tx, 2.55, -2.4, 0.07, 0.07]);
  // Hangers holding the tray up, which is what stops it reading as a beam.
  for (const u of [0.28, 0.62]) {
    const hx = bx + (tx - bx) * u;
    steel.push([hx, 2.6, -2.4, hx, 3.3, -2.4, 0.035, 0.035]);
  }
  return { steel, dark };
}

function Members({ list, colour, roughness = 0.7, metalness = 0.4, ...rest }) {
  const ref = useRef();
  const geo = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  useEffect(() => {
    const inst = ref.current;
    if (!inst) return;
    const m = new THREE.Matrix4();
    list.forEach((p, i) => inst.setMatrixAt(i, member(m, p[0], p[1], p[2], p[3], p[4], p[5], p[6], p[7])));
    inst.count = list.length;
    inst.instanceMatrix.needsUpdate = true;
    inst.computeBoundingSphere();
  }, [list]);
  return (
    <instancedMesh ref={ref} args={[geo, undefined, list.length]} {...rest}>
      <meshStandardMaterial color={colour} roughness={roughness} metalness={metalness} />
    </instancedMesh>
  );
}

export default function Fixtures({ stop }) {
  const s = stop.side;
  const x = s * WORK;
  const kit = useMemo(() => services(s), [s]);
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

      <Members list={kit.steel} colour={P.steel} castShadow receiveShadow />
      <Members list={kit.dark} colour={"#2a2c30"} roughness={0.55} metalness={0.5}
        castShadow receiveShadow />

      {/* The one lit thing on the cabinet. A controller that is powered says
          so with a single lamp, and a single lamp on a dark enclosure four
          metres behind the machine is what tells the reader the wall is a
          wall and not the end of the world. */}
      <mesh position={[s * (AISLE / 2 + BAY_D - 1.08), 1.72, -2.28]}>
        <boxGeometry args={[0.03, 0.05, 0.05]} />
        <meshBasicMaterial color={"#7de3a0"} toneMapped={false} />
      </mesh>

      {/* A gas bottle in its clamp, which every cell that has ever welded or
          purged anything has standing against the back wall. */}
      <group position={[s * (AISLE / 2 + BAY_D - 0.55), 0, 0.9]}>
        <mesh position={[0, 0.72, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.115, 0.115, 1.44, 12]} />
          <meshStandardMaterial color={"#4a4033"} roughness={0.72} metalness={0.35} />
        </mesh>
        <mesh position={[0, 1.52, 0]} castShadow>
          <cylinderGeometry args={[0.055, 0.075, 0.18, 10]} />
          <meshStandardMaterial color={P.steel} roughness={0.5} metalness={0.6} />
        </mesh>
        <mesh position={[-s * 0.13, 1.0, 0]} castShadow>
          <boxGeometry args={[0.3, 0.05, 0.05]} />
          <meshStandardMaterial color={P.hazard} roughness={0.75} />
        </mesh>
      </group>
    </group>
  );
}
