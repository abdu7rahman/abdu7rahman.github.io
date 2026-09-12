import { useEffect, useMemo, useRef, useState } from "react";
import { ASSET } from "../lib/paths.js";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { creaseNormals } from "../lib/mesh.js";
import { UPRIGHT } from "../../../world/kinematics.js";
import { P } from "../lib/palette.js";

/* A Unitree Go2, walking. Unitree's own triangles, BSD-3-Clause, baked by
 * tools/bake_mobile.py from the pinned go2_description meshes: 19,678
 * triangles, 372 KB. The colours are the ones in the COLLADA effects -- the
 * pale blue-grey shell, the near-white thigh shrouds, the black feet -- and
 * are handled exactly as the arm's are, a third of the way toward the room's
 * machine grey so the building lights it rather than the file.
 *
 * The asset holds seven meshes and the robot has thirteen visible links,
 * because the four legs share them: one hip flipped four ways by the rpy the
 * URDF puts on the <visual>, a thigh and its mirror, a calf and its mirror,
 * one foot. Baking per link would have put the hip in the file four times.
 * So the mesh list below maps link to geometry, and the bake stayed small.
 *
 * What it does is draw twelve joint angles. It used to stand instead: a
 * derived stance with a slow breath over planted feet, a leg IK to keep
 * those feet still while the body swayed, and a lift taken off the baked
 * foot so they touched the bench. That was the honest thing to draw when
 * nothing here could walk. lab/TerrainRig.jsx steps a Go2 in MuJoCo now and
 * hands over the twelve angles the model is holding, so the stance had no
 * caller and has gone -- with the limits it was derived from, which nothing
 * left computes with. Where the base goes is the caller's, because the
 * caller is the one holding the physics.
 */

/* Read off go2_description/urdf/go2_description.urdf at the commit
   assets/go2.json names. Nothing here is estimated. */
const HIP = {                        // *_hip_joint xyz, parent `base`
  FL: [ 0.1934,  0.0465, 0], FR: [ 0.1934, -0.0465, 0],
  RL: [-0.1934,  0.0465, 0], RR: [-0.1934, -0.0465, 0]
};
const SIDE = { FL: 1, FR: -1, RL: 1, RR: -1 };     // sign of the y offsets
const THIGH_Y = 0.0955;              // *_thigh_joint xyz y, signed by SIDE
const THIGH_L = 0.213;               // *_calf_joint  xyz z = -0.213
const CALF_L = 0.213;                // *_foot_joint  xyz z = -0.213
/* The <visual> rpy on each hip, which is how one hip.dae becomes four. FL is
   the identity; the URDF writes 3.1415 rather than pi and this keeps it. */
const HIP_FLIP = {
  FL: [0, 0, 0], FR: [3.1415, 0, 0], RL: [0, 3.1415, 0], RR: [3.1415, 3.1415, 0]
};
/* Which baked mesh each link draws. FL and RL take the plain thigh and calf,
   FR and RR the mirrored pair, exactly as the URDF assigns them. */
const MESH = {
  FL: ["thigh", "calf"], RL: ["thigh", "calf"],
  FR: ["thigh_mirror", "calf_mirror"], RR: ["thigh_mirror", "calf_mirror"]
};
// The leg order everything outside this file uses, and no offset at all.
const ORDER = ["FL", "FR", "RL", "RR"];

let cached = null;

export function useGo2() {
  const [mesh, setMesh] = useState(cached);
  useEffect(() => {
    if (cached) return;
    let live = true;
    fetch(ASSET("go2.json"))
      .then(r => r.ok ? r.json() : Promise.reject(new Error(r.status)))
      .then(j => { cached = j; if (live) setMesh(j); })
      .catch(() => {});
    return () => { live = false; };
  }, []);
  return mesh;
}

/* `joints` is a ref to twelve angles in FL FR RL RR order and hip, thigh,
 * calf within each -- the URDF's own joints, which is also the order
 * sim/models.js declares them in and the order demos/crawl.js writes. This
 * draws the robot those angles describe and nothing else.
 *
 * Not optional, and nothing here fills in for it: a Go2 with no angles to
 * hold would be a Go2 with its feet wherever the bind pose left them, and
 * the stance that used to cover that case is gone with its last caller. The
 * frame callback returns rather than drawing a wrong pose, so a ref that has
 * not been written yet leaves the machine where it was.
 */
export default function Go2({ scale = 1, tint, joints }) {
  const mesh = useGo2();
  const groups = useRef([]);
  const body = useRef();

  /* One geometry per part of each baked mesh, built once and then shared by
     however many links draw it -- the hip's triangles are uploaded once and
     drawn four times.

     The colour is named as sRGB rather than handed to `new THREE.Color(r,g,b)`
     as three bare floats, which is a one-line divergence from UR12e.jsx;
     TurtleBot.jsx carries the reason and the numbers. It matters less here
     than it does there, because Unitree's shell is genuinely pale, but the
     black feet and the dark trim were coming out as mid grey. */
  const geom = useMemo(() => {
    if (!mesh) return null;
    const room = new THREE.Color(P.machine);
    const out = {};
    for (const link of mesh.links) {
      out[link.name] = link.parts.map(part => {
        const n = part.f.length;
        const pos = new Float32Array(n * 3);
        for (let k = 0; k < n; k++) {
          const s = part.f[k] * 3;
          pos[k*3]     = part.v[s]     * mesh.unit;
          pos[k*3 + 1] = part.v[s + 1] * mesh.unit;
          pos[k*3 + 2] = part.v[s + 2] * mesh.unit;
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
        g.setAttribute("normal", new THREE.BufferAttribute(creaseNormals(pos, 78), 3));
        const own = new THREE.Color().setRGB(
          part.c[0]/255, part.c[1]/255, part.c[2]/255, THREE.SRGBColorSpace);
        const col = own.lerp(tint ? new THREE.Color(tint) : room, 0.34);
        return { geometry: g, color: col };
      });
    }
    return out;
  }, [mesh, tint]);

  /* The thirteen drawn links, flattened, so the frame loop writes one
     absolute matrix each rather than walking a tree. Order is fixed here and
     the refs below index it. */
  const links = useMemo(() => {
    const out = [{ leg: null, mesh: "base" }];
    for (const k of ["FL", "FR", "RL", "RR"]) {
      out.push({ leg: k, part: "hip", mesh: "hip" });
      out.push({ leg: k, part: "thigh", mesh: MESH[k][0] });
      out.push({ leg: k, part: "calf", mesh: MESH[k][1] });
      out.push({ leg: k, part: "foot", mesh: "foot" });
    }
    return out;
  }, []);

  const M = useMemo(() => ({
    hip: new THREE.Matrix4(), roll: new THREE.Matrix4(), flip: new THREE.Matrix4(),
    thigh: new THREE.Matrix4(), calf: new THREE.Matrix4(), foot: new THREE.Matrix4(),
    t: new THREE.Matrix4(), r: new THREE.Matrix4(), e: new THREE.Euler(),
    q: new Float32Array(3)
  }), []);

  useFrame(() => {
    if (!geom) return;
    const driven = joints && joints.current;
    if (!driven) return;

    /* The base is wherever the simulation put it and the caller has already
       placed this whole group there, so this link carries no offset of its
       own. It is still written every frame rather than left alone, because
       matrixAutoUpdate is off on it and an identity that is never set is an
       identity three has never been told about. */
    if (body.current) {
      body.current.matrix.identity();
      body.current.matrixWorldNeedsUpdate = true;
    }

    for (let i = 0; i < links.length; i++) {
      const g = groups.current[i];
      if (!g) continue;
      const L = links[i];
      if (L.leg === null) { g.matrix.identity(); g.matrixWorldNeedsUpdate = true; continue; }
      const k = L.leg, s = SIDE[k], h = HIP[k];
      const b = ORDER.indexOf(k) * 3;
      M.q[0] = driven[b]; M.q[1] = driven[b + 1]; M.q[2] = driven[b + 2];
      const q = M.q;

      M.hip.makeRotationX(q[0]).setPosition(h[0], h[1], h[2]);
      if (L.part === "hip") {
        /* The URDF's <visual> rpy, which is what turns one hip mesh into four.
           Order "ZYX", because a URDF rpy is fixed-axis roll then pitch then
           yaw, which is Rz Ry Rx applied in that order, and three.js names an
           Euler order by the matrices left to right. These three particular
           flips are half turns about orthogonal axes and would come out the
           same either way, which is exactly why it is worth being right about
           rather than leaving for a reader to re-derive. */
        const f = HIP_FLIP[k];
        M.e.set(f[0], f[1], f[2], "ZYX");
        M.flip.makeRotationFromEuler(M.e);
        g.matrix.multiplyMatrices(M.hip, M.flip);
      } else {
        M.t.makeRotationY(q[1]).setPosition(0, s * THIGH_Y, 0);
        M.thigh.multiplyMatrices(M.hip, M.t);
        if (L.part === "thigh") {
          g.matrix.copy(M.thigh);
        } else {
          M.r.makeRotationY(q[2]).setPosition(0, 0, -THIGH_L);
          M.calf.multiplyMatrices(M.thigh, M.r);
          if (L.part === "calf") {
            g.matrix.copy(M.calf);
          } else {
            M.foot.makeTranslation(0, 0, -CALF_L);
            g.matrix.multiplyMatrices(M.calf, M.foot);
          }
        }
      }
      g.matrixWorldNeedsUpdate = true;
    }
  });

  if (!geom) return null;
  return (
    <group scale={scale} onUpdate={g => g.setRotationFromMatrix(UPRIGHT)}>
      <group matrixAutoUpdate={false} ref={body}>
        {links.map((L, i) => (
          <group key={i} matrixAutoUpdate={false} ref={el => (groups.current[i] = el)}>
            {geom[L.mesh].map((p, pi) => (
              <mesh key={pi} geometry={p.geometry} castShadow receiveShadow>
                <meshStandardMaterial color={p.color} roughness={0.44} metalness={0.52} />
              </mesh>
            ))}
          </group>
        ))}
      </group>
    </group>
  );
}
