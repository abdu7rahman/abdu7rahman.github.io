import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { member } from "./steel.js";
import { weldmesh } from "../shaders/weldmesh.js";
import { P } from "../lib/palette.js";
import { AISLE, PITCH, RUN, STOPS } from "../lib/plan.js";

/* The guarding line down both sides of the lane, and the one place all that
 * orange belongs.
 *
 * A cell that can move on its own is fenced, and the fence is painted the
 * colour a standard reserves for a hazard. So the aisle is bounded by welded
 * mesh panels in steel frames with an orange top rail and an orange kick
 * rail, and that single run of paint down both sides of a 66 m building is
 * what carries the colour through the whole shot without a single decorative
 * surface.
 *
 * It breaks at every bay mouth, because a bay you cannot walk into is a
 * picture of a bay -- and at every mouth there is a gate, because a fence
 * with a hole in it is not a fence. The gates stand open, on their hinge
 * stile, with the interlock box on the frame beside them.
 *
 * Two things changed here and both were faults rather than taste.
 *
 * The infill was a solid box at 0.72 opacity standing in for mesh. Guarding
 * is see-through and that is the entire reason it is mesh: a smoked panel in
 * front of every cell cost each of them its depth. It is real welded grid
 * now -- see shaders/weldmesh.js, which cuts the apertures analytically and
 * floors the coverage in the far field so it settles into a sheet instead of
 * sparkling.
 *
 * And it was 55 panels of four separate meshes: 220 draw calls, measured, on
 * a frame that came to 938 at the entrance. Every solid piece of every panel
 * and every gate in the building is now two instanced meshes, one painted
 * steel and one hazard orange, and all 55 infills are a third -- one plane
 * geometry, instanced, because the grid is in the panel's own local xy and
 * every panel wants the same grid.
 */
const PANEL = 2.4;              // one fence panel, frame to frame
const H = 1.9;                  // guarding height
const POST = 0.09;
const INFILL_W = PANEL - 0.14, INFILL_H = H - 0.34;
const MOUTH = 3.4;              // how wide a bay mouth is left open

export default function Guarding() {
  const kit = useMemo(() => {
    const mouths = STOPS.filter(s => s.side !== 0)
                        .map(s => ({ z: -s.at * PITCH, side: s.side }));
    const steel = [], paint = [], infill = [];

    for (const side of [-1, 1]) {
      const x = side * (AISLE / 2);
      for (let z = PITCH; z > -RUN - PITCH; z -= PANEL) {
        const mid = z - PANEL / 2;
        if (mouths.some(m => m.side === side && Math.abs(m.z - mid) < MOUTH)) continue;

        // The post at the panel's far end, and the plate it is bolted down
        // through. A post standing straight on the slab is the detail that
        // reads as modelled; a plate is what is really there.
        steel.push([x, 0.02, z - PANEL, x, H, z - PANEL, POST, POST]);
        steel.push([x, 0.0, z - PANEL, x, 0.02, z - PANEL, 0.22, 0.22]);
        // The frame the mesh is welded into: a rail top and bottom.
        steel.push([x, H - 0.12, z - 0.07, x, H - 0.12, z - PANEL + 0.07, 0.05, 0.05]);
        steel.push([x, 0.24, z - 0.07, x, 0.24, z - PANEL + 0.07, 0.05, 0.05]);
        infill.push([x, 0.24 + INFILL_H / 2, mid]);

        /* The paint: top rail and kick rail. member() puts the section's
           first number on the axis the run is not, so for a member down the
           lane that is the x extent and the second is the height -- 0.07 wide
           by 0.09 deep for the rail, 0.06 by 0.14 for the kick, which is what
           the two of them were before this file was instanced. */
        paint.push([x, H, z, x, H, z - PANEL, 0.07, 0.09]);
        paint.push([x, 0.13, z, x, 0.13, z - PANEL, 0.06, 0.14]);
      }

      // A gate at each mouth on this hand.
      for (const m of mouths) {
        if (m.side !== side) continue;
        gate(steel, paint, infill, x, m.z, side);
      }
    }

    /* A zero-length member composes to the identity, which stacks a unit
       cube on the world origin -- in the middle of the entrance shot, and
       silently. Nothing above emits one, and this is here so that if
       something ever does it is dropped rather than found in a screenshot. */
    return { steel: steel.filter(p => p[0] !== p[3] || p[1] !== p[4] || p[2] !== p[5]),
             paint, infill };
  }, []);

  const geo = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const pane = useMemo(() => new THREE.PlaneGeometry(INFILL_W, INFILL_H), []);
  const mesh = useMemo(() => weldmesh(new THREE.MeshStandardMaterial({
    color: new THREE.Color("#4c5057"), roughness: 0.5, metalness: 0.6,
    side: THREE.DoubleSide
  })), []);
  useEffect(() => () => mesh.dispose(), [mesh]);

  const steelRef = useRef();
  const paintRef = useRef();
  const meshRef = useRef();

  useEffect(() => {
    const m = new THREE.Matrix4();
    for (const [ref, list] of [[steelRef, kit.steel], [paintRef, kit.paint]]) {
      const inst = ref.current;
      if (!inst) continue;
      list.forEach((p, i) => inst.setMatrixAt(i, member(m, p[0], p[1], p[2], p[3], p[4], p[5], p[6], p[7])));
      inst.count = list.length;
      inst.instanceMatrix.needsUpdate = true;
      inst.computeBoundingSphere();
    }
    const inst = meshRef.current;
    if (inst) {
      /* A run panel stands in the plane x = const and is a quarter turn about
         y; a gate leaf is swung open and carries its own. The sign of either
         does not matter -- the material is double sided, because a fence is
         looked at from both hands. */
      const q = new THREE.Quaternion();
      const up = new THREE.Vector3(0, 1, 0);
      const sc = new THREE.Vector3();
      const p = new THREE.Vector3();
      kit.infill.forEach((c, i) => {
        p.set(c[0], c[1], c[2]);
        q.setFromAxisAngle(up, c[3] === undefined ? Math.PI / 2 : c[3]);
        // A gate leaf is narrower than a panel, and the pane geometry is one
        // size, so the difference is a scale on the pane's own x.
        sc.set((c[4] === undefined ? INFILL_W : c[4]) / INFILL_W, 1, 1);
        inst.setMatrixAt(i, m.compose(p, q, sc));
      });
      inst.count = kit.infill.length;
      inst.instanceMatrix.needsUpdate = true;
      inst.computeBoundingSphere();
    }
  }, [kit]);

  return (
    <group>
      <instancedMesh ref={steelRef} args={[geo, undefined, kit.steel.length]}
                     castShadow receiveShadow>
        <meshStandardMaterial color={P.steel} roughness={0.75} metalness={0.42} />
      </instancedMesh>
      {/* The paint carries a little emission, and only a little: it is the
          one run of colour down a 66 m building and it has to survive the
          fog, but a saturated orange that clips blooms into a tube. */}
      <instancedMesh ref={paintRef} args={[geo, undefined, kit.paint.length]} castShadow>
        <meshStandardMaterial color={P.hazard} roughness={0.55} metalness={0.15}
          emissive={P.hazard} emissiveIntensity={0.18} />
      </instancedMesh>
      {/* No castShadow. The depth pass runs three's own depth material, which
          knows nothing about the patch above, so a mesh panel would throw the
          shadow of a solid sheet -- which is the fault this replaced. */}
      <instancedMesh ref={meshRef} args={[pane, undefined, kit.infill.length]} receiveShadow>
        <primitive object={mesh} attach="material" />
      </instancedMesh>
    </group>
  );
}

/* A gate leaf standing open on its hinge stile, with the latch post it swings
   to and the interlock switch that makes the whole fence mean something. The
   leaf is the one piece of guarding in the building that is not parallel to
   the lane, and the angle is what says the cell is open rather than fenced
   off. */
function gate(steel, paint, infill, x, z, side) {
  const W = 1.15;                       // leaf width
  const SWING = 0.62;                   // radians open, into the bay
  const hz = z - MOUTH + 0.25;          // where it is hung
  const dz = Math.cos(SWING) * W, dx = side * Math.sin(SWING) * W;

  // Hinge stile and latch post, both full height, both plated down.
  for (const [px, pz] of [[x, hz], [x, z + MOUTH - 0.25]]) {
    steel.push([px, 0.02, pz, px, H, pz, 0.10, 0.10]);
    steel.push([px, 0.0, pz, px, 0.02, pz, 0.24, 0.24]);
  }

  // The leaf: a frame of four and its own mesh panel, swung open.
  const ex = x + dx, ez = hz - dz;
  steel.push([x, H - 0.12, hz, ex, H - 0.12, ez, 0.05, 0.05]);
  steel.push([x, 0.24, hz, ex, 0.24, ez, 0.05, 0.05]);
  paint.push([x, H, hz, ex, H, ez, 0.07, 0.09]);
  // Leaf edge, painted, because the closing edge of a gate always is.
  paint.push([ex, 0.24, ez, ex, H - 0.12, ez, 0.09, 0.09]);
  /* The turn about y that takes the pane's local x onto the leaf. A rotation
     by t sends (1,0,0) to (cos t, 0, -sin t), so cos t is the run in x and
     sin t is minus the run in z -- atan2(dz, dx), which at the straight
     panels' (0, -1) gives the same pi/2 they use. */
  infill.push([(x + ex) / 2, 0.24 + INFILL_H / 2, (hz + ez) / 2,
               Math.atan2(dz, dx), W - 0.16]);

  // The interlock, on the latch post at handle height, and the sign plate
  // beside it. No text on the sign: it reads as a sign from the aisle and
  // inventing wording for it would be inventing a claim.
  const lz = z + MOUTH - 0.25;
  steel.push([x - side * 0.09, 0.95, lz, x - side * 0.09, 1.18, lz, 0.09, 0.13]);
  steel.push([x - side * 0.03, 1.42, lz - 0.02, x - side * 0.03, 1.42, lz - 0.32, 0.012, 0.30]);
}
