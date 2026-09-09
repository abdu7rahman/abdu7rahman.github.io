import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { creaseNormals } from "../lib/mesh.js";
import { poseAt, linkFrames, UPRIGHT } from "../../../world/kinematics.js";
import { P } from "../lib/palette.js";

/* The actual machine: Universal Robots' own triangles, articulated by the
 * same measured kinematics the rest of this project solves against.
 *
 * 20,751 triangles baked by tools/bake_arm.py from the pinned UR description
 * meshes, welded at 0.5 mm and decimated to where the joint caps stop reading
 * as cut gems. It is 379 KB of JSON, which is more than everything else in
 * the building put together, so it is fetched once and shared: every cell
 * that shows an arm points at the same geometry and only its link matrices
 * differ.
 *
 * The cycle is the one from the document site -- fourteen seconds a traverse,
 * played out and back because the four waypoints do not close and wrapping
 * from the last to the first is a 33 degree snap in one frame.
 */
const CYCLE = 14;
let cached = null;

export function useArm() {
  const [mesh, setMesh] = useState(cached);
  useEffect(() => {
    if (cached) return;
    let live = true;
    fetch("assets/ur12e-hero.json")
      .then(r => r.ok ? r.json() : Promise.reject(new Error(r.status)))
      .then(j => { cached = j; if (live) setMesh(j); })
      .catch(() => {});
    return () => { live = false; };
  }, []);
  return mesh;
}

export default function UR12e({ phase = 0, scale = 1, tint }) {
  const mesh = useArm();
  const groups = useRef([]);
  const q = useMemo(() => new Float32Array(6), []);
  const frames = useMemo(() => Array.from({ length: 6 }, () => new THREE.Matrix4()), []);

  /* One geometry per part, built once. The colours come off the bake -- the
     UR's own shell grey and its dark joint bands -- rather than being picked,
     and are only pulled toward the room's machine grey so the arm sits in
     this building's light instead of its own. */
  const parts = useMemo(() => {
    if (!mesh) return null;
    const room = new THREE.Color(P.machine);
    return mesh.links.map(link =>
      link.parts.map(part => {
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
      })
    );
  }, [mesh, tint]);

  useFrame(({ clock }) => {
    if (!parts) return;
    // Derived from the clock rather than accumulated, so a cell that has been
    // off screen comes back in step with every other cell in the building.
    const t = (clock.elapsedTime / CYCLE + phase) % 2;
    poseAt(t < 1 ? t : 2 - t, q);
    linkFrames(q, frames);
    for (let li = 0; li < groups.current.length; li++) {
      const g = groups.current[li];
      if (!g) continue;
      if (li === 0) g.matrix.identity();
      else g.matrix.copy(frames[Math.min(5, li - 1)]);
      g.matrixWorldNeedsUpdate = true;
    }
  });

  if (!parts) return null;
  return (
    <group scale={scale} onUpdate={g => g.setRotationFromMatrix(UPRIGHT)}>
      {parts.map((link, li) => (
        <group key={li} matrixAutoUpdate={false} ref={el => (groups.current[li] = el)}>
          {link.map((p, pi) => (
            <mesh key={pi} geometry={p.geometry} castShadow receiveShadow>
              <meshStandardMaterial color={p.color} roughness={0.44} metalness={0.52} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}
