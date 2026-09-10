import { useEffect, useMemo, useRef, useState } from "react";
import { ASSET } from "../lib/paths.js";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { creaseNormals } from "../lib/mesh.js";
import { UPRIGHT } from "../../../world/kinematics.js";
import { P } from "../lib/palette.js";

/* A Unitree Go2, standing. Unitree's own triangles, BSD-3-Clause, baked by
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
 * What it does is stand. A twelve-degree-of-freedom gait is out of scope for
 * a cell you scroll past, and the alternative to a gait is not a frozen pose
 * -- a machine holding a stance against gravity with twelve motors drifts
 * while it does it. So the body moves and the feet do not, and every joint
 * angle below is what the URDF's own link lengths require for a foot to stay
 * exactly where it was put. It is a subset of the truth rather than a
 * decoration on top of it.
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
/* The calf limit, identical on all four legs, and the only limit this file
   needs a number for -- the stance is derived from it. The thigh's limit is
   [-1.5708, 3.4907] on the front legs and [-0.5236, 4.5379] on the rear, and
   the hip's is +-1.0472 everywhere; those are quoted in the stance note below
   rather than bound here, because nothing computes with them. */
const KNEE = [-2.7227, -0.83776];

/* The stance, derived rather than posed. The URDF ships no home position --
 * there is no default in the launch files, the rviz config or the controller
 * yaml -- so the one thing that can be said about the knee without inventing
 * anything is that it should sit in the middle of its own limit, which is
 * where a joint has equal authority in both directions. That fixes the thigh:
 * the two links are the same length, so the foot hangs directly under the
 * thigh joint exactly when the calf angle is twice the thigh angle and
 * opposite, and the standing height follows as 2 L cos(thigh).
 *
 * It comes out at 0.89012 rad at the thigh, -1.78023 at the knee, and
 * 0.26809 m from the thigh joint down to the centre of the foot. Both angles
 * are well inside the limits above, and the sway never takes them near: over
 * a full breath the thigh moves between 0.818 and 0.963 and the knee between
 * -1.867 and -1.690, against a knee limit of -2.723.
 */
const KNEE0 = (KNEE[0] + KNEE[1]) / 2;
const THIGH0 = -KNEE0 / 2;
const STAND = 2 * THIGH_L * Math.cos(THIGH0);

/* The breath. These two are the only numbers in this file that are chosen
 * rather than measured, and there is nothing in the description package to
 * derive them from -- a robot standing still has no period of its own.
 *
 * What they are checked against is measured. The four feet stand on a
 * rectangle 0.3868 m by 0.2840 m, which is twice the hip x offset by twice
 * the hip and thigh y offsets together; 12 mm is 8.5% of that rectangle's
 * half width, so the body drifts nowhere near leaving its own support
 * polygon. And the legs stay far inside their reach: the furthest the foot
 * ever gets from the thigh joint over a breath is 0.283 m of the 0.426 m the
 * two links can make straightened.
 *
 * The three axes run a third of a cycle apart, so the body traces a slow
 * circle over the feet rather than bobbing on one line. That part is derived
 * from the one period; only the period and the amplitude are picked.
 */
const BREATH = 5.5;
const SWAY = 0.012;

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

/* Where the three joints of one leg have to be for its foot to be at (dx, dy,
 * dz), measured from that leg's hip joint in the base frame.
 *
 * The thigh and the calf both turn about y and nothing past the thigh joint
 * is offset in y, so the foot is confined to the plane y = side * THIGH_Y of
 * the hip frame. That one fact pins the hip roll on its own, before any of
 * the rest: dy cos(q1) + dz sin(q1) = side * THIGH_Y, which is R cos(q1 - g)
 * = side * THIGH_Y for R and g the polar form of (dy, dz). Of the two
 * branches, the one taken here is the one that returns exactly zero for the
 * stance above -- checked, not assumed.
 *
 * What is left is the ordinary planar two-link solve in that plane, and the
 * knee takes the negative root because the URDF's calf range is entirely
 * negative and admits no other.
 */
function leg(dx, dy, dz, side, out) {
  const L0 = side * THIGH_Y;
  const R = Math.hypot(dy, dz);
  const q1 = Math.atan2(dz, dy) + Math.acos(Math.min(1, Math.max(-1, L0 / R)));
  const s1 = Math.sin(q1), c1 = Math.cos(q1);
  // Into the hip frame. A roll about x leaves dx alone.
  const u = -dx, w = -(-dy * s1 + dz * c1);        // down-positive from the joint
  const r2 = u * u + w * w;
  const c3 = Math.min(1, Math.max(-1,
    (r2 - THIGH_L * THIGH_L - CALF_L * CALF_L) / (2 * THIGH_L * CALF_L)));
  const q3 = -Math.acos(c3);
  const q2 = Math.atan2(u, w)
           - Math.atan2(CALF_L * Math.sin(q3), THIGH_L + CALF_L * Math.cos(q3));
  out[0] = q1; out[1] = q2; out[2] = q3;
  return out;
}

export default function Go2({ phase = 0, scale = 1, tint }) {
  const mesh = useGo2();
  const groups = useRef([]);
  const body = useRef();

  /* One geometry per part of each baked mesh, built once and then shared by
     however many links draw it -- the hip's triangles are uploaded once and
     drawn four times. */
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
        const own = new THREE.Color(part.c[0]/255, part.c[1]/255, part.c[2]/255);
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

  const rest = useMemo(() => {
    const f = {};
    for (const k of ["FL", "FR", "RL", "RR"]) {
      f[k] = [HIP[k][0], HIP[k][1] + SIDE[k] * THIGH_Y, -STAND];
    }
    return f;
  }, []);

  const M = useMemo(() => ({
    hip: new THREE.Matrix4(), roll: new THREE.Matrix4(), flip: new THREE.Matrix4(),
    thigh: new THREE.Matrix4(), calf: new THREE.Matrix4(), foot: new THREE.Matrix4(),
    t: new THREE.Matrix4(), r: new THREE.Matrix4(), e: new THREE.Euler(),
    q: new Float32Array(3)
  }), []);

  /* How high the base has to sit for the feet to touch the bench. Taken off
     the baked foot geometry in the stance pose rather than from the URDF's
     0.02 foot_radius, because what has to clear the bench is the triangles
     that get drawn, not the sphere the collision model uses in their place.
     The feet are planted, so this is computed once and does not move. */
  const lift = useMemo(() => {
    if (!geom) return 0;
    const foot = new THREE.Matrix4()
      .makeRotationY(THIGH0 + KNEE0)
      .setPosition(0, 0, -STAND);
    const v = new THREE.Vector3();
    let low = Infinity;
    for (const p of geom.foot) {
      const a = p.geometry.getAttribute("position");
      for (let i = 0; i < a.count; i++) {
        v.fromBufferAttribute(a, i).applyMatrix4(foot);
        if (v.z < low) low = v.z;
      }
    }
    return -low;
  }, [geom]);

  useFrame(({ clock }) => {
    if (!geom) return;
    /* Off the clock, not accumulated, so the cell is in step with the rest of
       the building whenever it comes back on screen. */
    const t = clock.elapsedTime + phase * BREATH;
    const w = (2 * Math.PI * t) / BREATH;
    const d = [
      SWAY * Math.sin(w),
      SWAY * Math.sin(w + (2 * Math.PI) / 3),
      SWAY * Math.sin(w + (4 * Math.PI) / 3)
    ];

    /* The body carries the offset and the legs are solved for feet that do
       not, which is the whole trick: foot in the world is d + (rest - d), so
       it never moves, and everything that does move is a joint angle the link
       lengths asked for. */
    if (body.current) {
      body.current.matrix.makeTranslation(d[0], d[1], lift + d[2]);
      body.current.matrixWorldNeedsUpdate = true;
    }

    for (let i = 0; i < links.length; i++) {
      const g = groups.current[i];
      if (!g) continue;
      const L = links[i];
      if (L.leg === null) { g.matrix.identity(); g.matrixWorldNeedsUpdate = true; continue; }
      const k = L.leg, s = SIDE[k], h = HIP[k];
      const q = leg(rest[k][0] - d[0] - h[0],
                    rest[k][1] - d[1] - h[1],
                    rest[k][2] - d[2] - h[2], s, M.q);

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
