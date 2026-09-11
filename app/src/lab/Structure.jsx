import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { member, truss, column } from "./steel.js";
import { detect } from "../lib/capability.js";
import { P } from "../lib/palette.js";
import { PITCH, AISLE, EAVES, RUN } from "../lib/plan.js";

/* The building: portal frames with lattice trusses over them, purlins on the
 * trusses, a crane rail down the lane with a crane on it, and the luminaires
 * that light all of it.
 *
 * It was boxes. One solid slab per frame for a rafter, box columns, and
 * nothing else above head height -- which is why the shot read as generated:
 * a shed's whole character is its roof structure, and a shed with a flat
 * ceiling is an office with the lights off. A parallel-chord Warren truss
 * every 7.2 m, purlins across them, I-section columns under them, and the
 * lattice throws a shadow pattern down the aisle that nothing else in this
 * building could have produced.
 *
 * All of it is one InstancedMesh. See lab/steel.js: a member is a length of
 * steel between two points, so chords, diagonals, posts, purlins, bracing
 * and the crane girder are the same primitive placed differently, and three
 * hundred of them cost one draw call and one shadow pass.
 */
const FRAMES = Math.ceil(RUN / PITCH) + 2;
const SPAN = AISLE / 2 + 7.6;          // half span, to the column line
const TRUSS_D = 1.15;                  // chord to chord
const PANELS = 12;                     // panel points across the span
const CHORD = 0.15, WEB = 0.085, PURLIN = 0.10;

/* The crane. A single girder bridge on the two runners, which is what a bay
   this size actually has -- and it is the one thing in the building that is
   allowed to be somewhere different each time you look up. */
const CRANE_SPAN = AISLE + 2.0;

export default function Structure() {
  const q = detect().quality;
  const steel = useRef();
  const crane = useRef();
  const hook = useRef();

  /* Every member in the building, placed once. Order matters only in that
     the crane's four members are last, so the frame loop can rewrite them
     without touching the rest. */
  const parts = useMemo(() => {
    const list = [];
    const railZ = -RUN / 2, railLen = RUN + 30;

    for (let i = 0; i < FRAMES; i++) {
      const z = -i * PITCH + PITCH;
      // Columns, both sides, as I-sections.
      for (const x of [-SPAN, SPAN])
        for (const c of column(x, z, EAVES, 0.36, 0.30, 0.024, 0.018)) list.push(c);
      // The truss over them.
      for (const [ax, ay, az, bx, by, bz] of truss(SPAN * 2, TRUSS_D, PANELS, EAVES + TRUSS_D, z))
        list.push([ax, ay, az, bx, by, bz, CHORD, CHORD * 0.8]);
      // Knee braces, which is where a portal frame carries its moment and
      // is the detail that stops the corner reading as a butt joint.
      for (const x of [-SPAN, SPAN]) {
        const s = Math.sign(x);
        list.push([x, EAVES - 1.5, z, x - s * 1.5, EAVES, z, WEB, WEB]);
      }
    }

    // Purlins: continuous, on top of the trusses, across the whole run.
    const top = EAVES + TRUSS_D;
    for (let k = 0; k <= PANELS; k++) {
      const x = -SPAN + (k * SPAN * 2) / PANELS;
      list.push([x, top + PURLIN, railZ - railLen / 2, x, top + PURLIN, railZ + railLen / 2,
                 PURLIN, PURLIN * 0.6]);
    }

    // The two crane runners, on brackets off the columns.
    for (const s of [-1, 1])
      list.push([s * (AISLE / 2 - 0.5), EAVES - 1.5, railZ - railLen / 2,
                 s * (AISLE / 2 - 0.5), EAVES - 1.5, railZ + railLen / 2, 0.22, 0.5]);

    // Cable tray, offset so it does not read as a third runner.
    list.push([AISLE / 2 + 1.4, EAVES - 0.9, railZ - railLen / 2,
               AISLE / 2 + 1.4, EAVES - 0.9, railZ + railLen / 2, 0.5, 0.14]);

    // Longitudinal bracing between the first frames, in the plane of the
    // columns: a portal frame is stiff across the span and needs this along
    // it, and it is the diagonal that says which way the building is long.
    for (let i = 0; i < FRAMES - 1; i += 3) {
      const z0 = -i * PITCH + PITCH, z1 = z0 - PITCH;
      for (const x of [-SPAN, SPAN]) {
        list.push([x, 1.2, z0, x, EAVES - 0.6, z1, WEB * 0.8, WEB * 0.8]);
        list.push([x, EAVES - 0.6, z0, x, 1.2, z1, WEB * 0.8, WEB * 0.8]);
      }
    }

    const craneAt = list.length;
    // Girder, two end carriages, trolley. Rewritten every frame.
    for (let i = 0; i < 4; i++) list.push([0, 0, 0, 0, 1, 0, 0.1, 0.1]);
    return { list, craneAt };
  }, []);

  const geo = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);

  useEffect(() => {
    const inst = steel.current;
    if (!inst) return;
    const m = new THREE.Matrix4();
    parts.list.forEach((p, i) => {
      inst.setMatrixAt(i, member(m, p[0], p[1], p[2], p[3], p[4], p[5], p[6], p[7]));
    });
    inst.count = parts.list.length;
    inst.instanceMatrix.needsUpdate = true;
    inst.computeBoundingSphere();
  }, [parts]);

  /* The crane traverses. Slowly, and the whole way, because a crane parked
     forever is a prop and a crane that moves is the building working -- and
     because it is the only thing in here whose position is not a function of
     where the reader is standing. */
  useFrame(({ clock }) => {
    const inst = steel.current;
    if (!inst) return;
    const t = clock.elapsedTime * 0.055;
    /* The travel stops 8 m short of either end wall, and it did not.
    
       At RUN/2 + 3 the bridge ran past the entrance, and since the trolley
       also crosses the lane the hook block came to rest 2.3 m from the
       reader's eye on the arrival shot -- a 0.28 m box of safety orange that
       close to a luminaire clips every channel, so the first thing anybody
       saw of this building was a white rectangle in the top corner with no
       explanation. A real crane has end stops well short of the gable
       anyway; this is where they are. */
    const z = -RUN / 2 + Math.cos(t) * (RUN / 2 - 8);
    const x = Math.sin(t * 1.7) * (AISLE / 2 - 1.1);
    const y = EAVES - 1.5;
    const m = new THREE.Matrix4();
    const i0 = parts.craneAt;
    // Girder across the runners, then a carriage at each end, then the
    // trolley riding the girder.
    inst.setMatrixAt(i0, member(m, -CRANE_SPAN / 2, y + 0.62, z, CRANE_SPAN / 2, y + 0.62, z, 0.34, 0.78));
    inst.setMatrixAt(i0 + 1, member(m, -AISLE / 2 - 0.9, y, z - 0.5, -AISLE / 2 - 0.9, y, z + 0.5, 0.3, 0.3));
    inst.setMatrixAt(i0 + 2, member(m, AISLE / 2 + 0.9, y, z - 0.5, AISLE / 2 + 0.9, y, z + 0.5, 0.3, 0.3));
    inst.setMatrixAt(i0 + 3, member(m, x, y + 0.28, z, x, y + 0.95, z, 0.52, 0.5));
    inst.instanceMatrix.needsUpdate = true;
    if (hook.current) {
      // The block, on a rope that is as long as it needs to be.
      // Hoisted higher than it was, for the same reason: at 2.4 m of rope
      // the block hung at 4.5 m and was in shot down the whole aisle.
      const drop = 1.5 + Math.sin(t * 2.3) * 0.7;
      hook.current.position.set(x, y - drop, z);
      hook.current.children[0].scale.y = drop;
      hook.current.children[0].position.y = drop / 2;
    }
  });

  const bays = useMemo(
    () => Array.from({ length: FRAMES }, (_, i) => -i * PITCH + PITCH), []);

  return (
    <group>
      <instancedMesh
        ref={steel}
        args={[geo, undefined, parts.list.length]}
        castShadow={q.shadows}
        receiveShadow
      >
        <meshStandardMaterial color={P.steel} roughness={0.72} metalness={0.42} />
      </instancedMesh>

      {/* The hook block, which is not a member: it hangs on a rope and the
          rope changes length, so it is its own two meshes. */}
      <group ref={hook}>
        <mesh position={[0, 0, 0]}>
          <cylinderGeometry args={[0.012, 0.012, 1, 6]} />
          <meshStandardMaterial color={P.steelDk} roughness={0.5} metalness={0.7} />
        </mesh>
        <mesh castShadow>
          <boxGeometry args={[0.28, 0.34, 0.22]} />
          <meshStandardMaterial color={P.hazard} roughness={0.6} metalness={0.3} />
        </mesh>
      </group>

      {/* High-bay luminaires on the grid, every other frame, with the lamp
          face emissive so the source is visible as well as its effect. */}
      {bays.filter((_, i) => i % 2 === 0).map((z, i) => (
        <Luminaire key={"l" + i} z={z} />
      ))}
    </group>
  );
}

/* One fitting, so each can own the object its beam is aimed at -- a spot
   light needs a target in the scene and sharing one between five would aim
   them all at the same patch of floor. */
function Luminaire({ z }) {
  const aim = useMemo(() => new THREE.Object3D(), []);
  return (
    <>
        <group position={[0, EAVES - 0.75, z]}>
          <mesh castShadow>
            <cylinderGeometry args={[0.46, 0.30, 0.34, 12]} />
            <meshStandardMaterial color={P.steelDk} roughness={0.6} metalness={0.5} />
          </mesh>
          <mesh position={[0, -0.18, 0]}>
            <cylinderGeometry args={[0.30, 0.30, 0.03, 12]} />
            <meshBasicMaterial color={"#ffd9b8"} />
          </mesh>
          {/* A cone rather than a bulb, and the reason is the inverse square.
           *
           * These hang at the eaves, 7.65 m over the slab, so a point source
           * putting a usable 15 on the floor puts 15 times (7.65/0.75)
           * squared -- about 1,560 -- on the truss chord 0.75 m above it,
           * and the truss clips to white while the floor is still dim. At
           * 110 the floor got 1.9, which is to say the lane was lit by the
           * key light and the daylight pools and these were decoration.
           *
           * A high bay fitting is a reflector aimed down. Aimed down, the
           * chord above it is outside the beam and the floor is inside it,
           * which is the whole point of a reflector and is why real ones
           * have them. 0.85 rad is a 97 degree beam, which throws a 17 m
           * pool -- wider than the 14.4 m between fittings, so they overlap
           * rather than leaving scallops of dark between them. */}
          <primitive object={aim} position={[0, -7.2, 0]} />
          <spotLight
            position={[0, -0.4, 0]}
            target={aim}
            color={"#ffcfa8"}
            intensity={760}
            angle={0.85}
            penumbra={0.55}
            distance={26}
            decay={2}
          />
        </group>
    </>
  );
}
