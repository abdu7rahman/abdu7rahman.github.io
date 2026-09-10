import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { ASSET } from "../lib/paths.js";
import { creaseNormals } from "../lib/mesh.js";
import { P } from "../lib/palette.js";

/* The Unitree G1, drawn from the bake, posed by a joint vector.
 *
 * Twenty-nine joints of Unitree's own geometry -- see tools/bake_g1.py, which
 * takes MuJoCo Menagerie's MJCF and Unitree's STLs and writes the tree along
 * with the triangles. Unlike the arm, this robot has no hand-written
 * kinematics module in this project, so the bake carries the parent, the
 * offset, the joint axis and the limits of every link and this file walks
 * exactly the product the MJCF describes. There is nothing for the two to
 * disagree about because there is only one of them.
 *
 * The tree is rendered as nested groups with their matrices written directly
 * rather than as one flat list of world transforms. three already composes a
 * parent chain every frame and doing it again in JavaScript to hand it the
 * answer is two traversals to get one; nesting means a hip rotation moves the
 * whole leg for free, which is the entire point of a kinematic tree.
 *
 * 630 KB, fetched once and cached at module scope however many are mounted --
 * the same rule UR12e.jsx follows, and for the same reason.
 */
let cached = null;
let pending = null;

export function useG1() {
  const [tree, setTree] = useState(cached);
  useEffect(() => {
    if (cached) return;
    let live = true;
    if (!pending) {
      pending = fetch(ASSET("g1.json"))
        .then(r => (r.ok ? r.json() : Promise.reject(new Error(r.status))))
        .then(j => { cached = j; return j; });
    }
    pending.then(j => { if (live) setTree(j); }).catch(() => {});
    return () => { live = false; };
  }, []);
  return tree;
}

/* Which joint is which, by name, so a gait can talk about a knee instead of
   about index 17. Built once from the bake rather than written out here: a
   list of thirty indices typed by hand is a list that goes wrong the first
   time the bake changes. */
export function jointIndex(tree) {
  const map = {};
  tree.links.forEach((l, i) => { if (l.joint) map[l.joint.name] = i; });
  return map;
}

/* A stance rather than a T-pose. Every angle is zero in the MJCF, which puts
   the arms straight down the sides and the legs locked -- a mannequin. These
   are small offsets that read as a machine standing ready: knees and hips
   slightly bent so the legs have a direction to swing from, shoulders out so
   the arms clear the torso, elbows in. */
export function stance(tree) {
  const q = new Float32Array(tree.links.length);
  const j = jointIndex(tree);
  const set = (name, v) => { if (j[name] !== undefined) q[j[name]] = v; };
  for (const side of ["left", "right"]) {
    const s = side === "left" ? 1 : -1;
    set(`${side}_hip_pitch_joint`, -0.18);
    set(`${side}_knee_joint`, 0.36);
    set(`${side}_ankle_pitch_joint`, -0.18);
    set(`${side}_shoulder_pitch_joint`, 0.22);
    set(`${side}_shoulder_roll_joint`, s * 0.20);
    set(`${side}_elbow_joint`, 0.55);
  }
  return q;
}

/* One link's geometry, welded into a BufferGeometry with creased normals.
   The bake stores vertices as integers in units of `unit` metres, which is
   0.06 mm -- finer than the robot repeats and a third of the size of the
   float32 it came from. */
function build(tree) {
  return tree.links.map(link =>
    link.parts.map(part => {
      const n = part.f.length;
      const pos = new Float32Array(n * 3);
      for (let k = 0; k < n; k++) {
        const s = part.f[k] * 3;
        pos[k * 3] = part.v[s] * tree.unit;
        pos[k * 3 + 1] = part.v[s + 1] * tree.unit;
        pos[k * 3 + 2] = part.v[s + 2] * tree.unit;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      g.setAttribute("normal", new THREE.BufferAttribute(creaseNormals(pos, 62), 3));
      const own = new THREE.Color(part.c[0] / 255, part.c[1] / 255, part.c[2] / 255);
      // Pulled toward the room's machine grey, the same 0.34 the arm uses, so
      // the guide stands in this building's light rather than in its own.
      return { geometry: g, color: own.lerp(new THREE.Color(P.machine), 0.34) };
    })
  );
}

/* The tree, as nested groups. Recursive rather than a flat pass because the
   bake gives a parent index and React wants children. */
function Branch({ index, kids, parts, refs }) {
  return (
    <group matrixAutoUpdate={false} ref={el => (refs.current[index] = el)}>
      {parts[index].map((p, i) => (
        <mesh key={i} geometry={p.geometry} castShadow receiveShadow>
          <meshStandardMaterial color={p.color} roughness={0.46} metalness={0.55} />
        </mesh>
      ))}
      {(kids[index] || []).map(c => (
        <Branch key={c} index={c} kids={kids} parts={parts} refs={refs} />
      ))}
    </group>
  );
}

export default function G1({ q, scale = 1 }) {
  const tree = useG1();
  const refs = useRef([]);
  const parts = useMemo(() => (tree ? build(tree) : null), [tree]);
  const kids = useMemo(() => {
    if (!tree) return null;
    const k = {};
    tree.links.forEach((l, i) => {
      if (l.parent >= 0) (k[l.parent] = k[l.parent] || []).push(i);
    });
    return k;
  }, [tree]);

  /* The fixed half of every link's transform, composed once. Only the joint
     angle changes per frame, so the offset and the orientation the MJCF gives
     are baked into a matrix here and multiplied by a single axis rotation in
     the frame loop. */
  const rest = useMemo(() => {
    if (!tree) return null;
    return tree.links.map(l => {
      const m = new THREE.Matrix4();
      const qq = l.quat;
      m.compose(new THREE.Vector3(...l.pos),
                new THREE.Quaternion(qq[1], qq[2], qq[3], qq[0]),
                new THREE.Vector3(1, 1, 1));
      return { m, axis: l.joint ? new THREE.Vector3(...l.joint.axis).normalize() : null };
    });
  }, [tree]);

  const scratch = useMemo(() => ({ rot: new THREE.Matrix4() }), []);
  const home = useMemo(() => (tree ? stance(tree) : null), [tree]);

  useFrame(() => {
    if (!rest) return;
    const angles = (q && q.current) || home;
    for (let i = 0; i < rest.length; i++) {
      const g = refs.current[i];
      if (!g) continue;
      const r = rest[i];
      if (r.axis) {
        scratch.rot.makeRotationAxis(r.axis, angles[i] || 0);
        g.matrix.multiplyMatrices(r.m, scratch.rot);
      } else {
        g.matrix.copy(r.m);
      }
      g.matrixWorldNeedsUpdate = true;
    }
  });

  if (!parts || !kids) return null;
  /* The model is z-up, the way every robot description is, and the scene is
     y-up. The same quarter turn the arm and the simulator both apply. */
  return (
    /* Ghost to the surveyor: a map with the guide standing in it is a map
       the guide cannot walk out of. */
    <group name="g1-root" userData={{ ghost: true }} scale={scale} rotation-x={-Math.PI / 2}>
      <Branch index={0} kids={kids} parts={parts} refs={refs} />
    </group>
  );
}
