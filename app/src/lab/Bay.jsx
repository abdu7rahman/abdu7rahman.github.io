import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { P } from "../lib/palette.js";
import { cladding } from "../shaders/cladding.js";
import Bench from "./Bench.jsx";
import { AISLE, BAY_D, EAVES, WORK } from "../lib/plan.js";
import { due } from "./shadowBudget.js";

/* A test cell off the lane: a plinth, a back wall, a screen carrying whatever
 * that rig is running, and a lamp aimed at the work rather than at the room.
 *
 * The screen is the point. Six of these are live code -- the same modules the
 * document site runs, four of them downloading real Python as the page loads
 * -- and the way to say that in a building is to put a monitor on the rig and
 * have it show what the rig is doing. A picture of a robot is a poster; a
 * running plot bolted to a machine is a test cell.
 */
export default function Bay({ stop, index = 0, cells = 7, children }) {
  const s = stop.side;                    // -1 left of the lane, +1 right
  const x = s * WORK;
  const back = s * (AISLE / 2 + BAY_D);

  /* A real object in the scene, because a spot light's target has to be one.
  
     three reads the aim as target.matrixWorld and nothing updates the matrix
     of an object that is not in the graph, so the obvious spelling --
     target-position on the light -- sets a position the renderer never sees
     and every one of these lamps pointed at the world origin instead of at
     its own bench. Silent: the light is on, the cone is somewhere else, and
     the cell just looks unlit. Measured before the fix, a test cell came
     back at p50 18 of 255 with the subject of the shot in the dark. */
  const aim = useMemo(() => new THREE.Object3D(), []);

  const skin = useMemo(() => cladding(new THREE.MeshStandardMaterial({
    color: new THREE.Color("#3b3f45"), roughness: 0.9, metalness: 0.1
  }), { base: 3.5, dado: 1.35, pitch: 0.30, depth: 0.032, seam: 0 }), []);
  useEffect(() => () => skin.dispose(), [skin]);

  /* This lamp's shadow map, drawn on its turn rather than every frame. See
     shadowBudget.js for why it is a schedule and not a switch. Forced for
     the first pass because a map that has never been drawn is not a stale
     map, it is a missing one, and a bay with no shadow at all is more
     obviously wrong than a bay whose shadow is three frames old. */
  const lamp = useRef();
  const drawn = useRef(false);
  useEffect(() => {
    if (lamp.current) lamp.current.shadow.autoUpdate = false;
  }, []);
  useFrame(() => {
    const l = lamp.current;
    if (!l) return;
    if (!drawn.current) { l.shadow.needsUpdate = true; drawn.current = true; return; }
    l.shadow.needsUpdate = due(index, cells);
  });

  return (
    <group position={[0, 0, -stop.at * 7.2]}>
      {/* Back wall of the cell, so the bay is a room and not an alcove.
      
          Clad and washed, because measured it was neither. A 9.2 by 5.2 m
          plane of flat 212327 behind every machine in the building came back
          at a mean of 18.9 of 255 with the bench in front of it clipping at
          251 -- which is not contrast, it is a subject cut out and pasted on
          black. The rib profile gives it something for a raking wash to
          find, and the wash below gives it the raking light.

          7.0 m rather than 5.2, and that is the same fault one level up: the
          wall was lit and what sat above it was 3.2 m of unlit hall, so the
          top third of every cell shot was still black. The eaves are at 8.4
          and the wash still reaches the head of a 7.0 m wall, so this is the
          tallest it can be and stay lit. */}
      <mesh position={[back, 3.5, 0]} rotation-y={-s * Math.PI / 2} receiveShadow>
        <planeGeometry args={[9.2, 7.0]} />
        <primitive object={skin} attach="material" />
      </mesh>
      {/* The wash. Deliberately weak and deliberately not a spot: it is
          there to lift a wall off black, not to light anything, and a cell
          that reads as having two fittings in it reads as a cell. */}
      <pointLight position={[s * 7.0, 6.0, 0.4]} color={"#ffe4c6"}
        intensity={80} distance={26} decay={2} />

      {/* Bench the machine stands on. lab/Bench.jsx draws the actual
          fabricated frame; this file only has to say where it stands. */}
      <Bench x={x} />
      {/* The painted box on the slab the bench stands in.
      
          It was a toe kick -- a 2.66 by 3.06 orange plate under the bench --
          and that was right while the bench was a solid box sitting on the
          floor. lab/Bench.jsx put it on legs, and the plate stopped being a
          kick and became a lit orange tray visible under the whole frame. A
          bench on feet does not have a toe kick. What it stands in is a
          painted keep-clear box, which is four lines and not a slab, and is
          what is actually on the floor of a cell. */}
      {[[0, -1.58, 2.9, 0.1], [0, 1.58, 2.9, 0.1],
        [-1.38, 0, 0.1, 3.26], [1.38, 0, 0.1, 3.26]].map(([dx, dz, w, d], i) => (
        <mesh key={i} position={[x + dx, 0.006, dz]}>
          <boxGeometry args={[w, 0.012, d]} />
          <meshStandardMaterial color={P.hazard} roughness={0.85} />
        </mesh>
      ))}

      {/* Task light over the bench: hard, close, and the reason a bay reads
          brighter than the lane it opens off. */}
      <primitive object={aim} position={[x, 0.9, 0]} />
      <spotLight
        ref={lamp}
        position={[x, EAVES - 2.6, 1.4]}
        target={aim}
        angle={0.62}
        penumbra={0.35}
        intensity={210}
        distance={16}
        decay={2}
        color={"#ffe0c4"}
        castShadow
      />

      {children}
    </group>
  );
}
