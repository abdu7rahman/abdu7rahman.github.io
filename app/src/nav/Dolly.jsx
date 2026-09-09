import { useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useTravel } from "./useTravel.js";
import { STOPS, PITCH, AISLE, BAY_D } from "../lib/plan.js";

/* The camera, on a dolly down the lane.
 *
 * It travels the centre line at standing height and turns its head into
 * whichever bay it is passing, which is the one motion that makes a building
 * read as a building rather than as a tunnel: you walk the aisle and look
 * into the work either side of you.
 *
 * The turn is weighted by how close the nearest bay is, so it is a glance and
 * not a pan -- full attention at the bay mouth, back to straight down the
 * lane halfway between two of them. Nothing here is keyframed; there is one
 * position and one look point and both fall out of where you are standing.
 */
const RIGS = STOPS.filter(s => s.side !== 0);

export default function Dolly() {
  const { camera } = useThree();
  const z = useTravel();
  const look = useRef(new THREE.Vector3());
  const eye = useRef(new THREE.Vector3(0, 1.62, 4));

  useFrame((_, dt) => {
    const k = 1 - Math.pow(0.0006, Math.min(0.1, dt));

    // Where the dolly is: down the lane, breathing very slightly so a held
    // shot is never mechanically dead.
    const t = performance.now() * 0.001;
    eye.current.set(
      Math.sin(t * 0.21) * 0.05,
      1.62 + Math.sin(t * 0.17) * 0.015,
      4 - z
    );
    camera.position.lerp(eye.current, k);

    // Which bay is nearest, and how much of a glance it has earned.
    let best = null, bestD = 1e9;
    for (const s of RIGS) {
      const dz = Math.abs(-s.at * PITCH - camera.position.z);
      if (dz < bestD) { bestD = dz; best = s; }
    }
    const pull = best ? Math.max(0, 1 - bestD / (PITCH * 0.55)) : 0;
    const bx = best ? best.side * (AISLE / 2 + BAY_D / 2) : 0;

    look.current.set(bx * pull * 0.85, 1.45, camera.position.z - 9 + pull * 5.5);
    camera.lookAt(look.current);
  });

  return null;
}
