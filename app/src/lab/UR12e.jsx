import { useEffect, useMemo, useRef, useState } from "react";
import { ASSET } from "../lib/paths.js";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { creaseNormals } from "../lib/mesh.js";
import { poseAt, linkFrames, UPRIGHT } from "../../../world/kinematics.js";
import { P } from "../lib/palette.js";

/* Where the two fingers sit in the baked link list, and how far each may
   slide. A Hand-E's stroke is 25 mm a side; the asset records that as
   grip_max and the bake puts the closed pose at zero. The simulated jaw in
   sim/models.js opens wider than a real one does, so this clamps rather
   than scales: what is drawn is the real gripper's own travel. */
const FINGER_L = 8, FINGER_R = 9;
const GRIP_MAX = 0.025;
const SLIDE = new THREE.Matrix4();

/* The actual machine: Universal Robots' own triangles, articulated by the
 * same measured kinematics the rest of this project solves against.
 *
 * 21,010 triangles baked by tools/bake_arm.py from the pinned UR description
 * meshes, welded at 0.5 mm and decimated to where the joint caps stop reading
 * as cut gems. It is 379 KB of JSON, which is more than everything else in
 * the building put together, so it is fetched once: the bake is requested a
 * single time and cached at module scope however many arms are mounted.
 *
 * Fetched once, not shared once. Each mounted arm creases and uploads its
 * own BufferGeometry from that one bake -- four of them across the reach,
 * replan and assembly bays, which is roughly 5 MB of duplicated vertex
 * data. A shared-geometry cache would fix it and is not worth writing while
 * the number is four; it is written down here so the fifth arm is a
 * decision rather than a surprise.
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
    fetch(ASSET("ur12e-hero.json"))
      .then(r => r.ok ? r.json() : Promise.reject(new Error(r.status)))
      .then(j => { cached = j; if (live) setMesh(j); })
      .catch(() => {});
    return () => { live = false; };
  }, []);
  return mesh;
}

export default function UR12e({ phase = 0, scale = 1, tint, q: driven }) {
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
    /* Driven from outside, when something outside is driving.

       The replan cell runs its own planner and hands the six joint angles
       in; every other cell lets this file play the baked move. Both go
       through the same linkFrames, so a posed arm and a planned one are the
       same arithmetic and there is no second place a joint angle can mean
       something different. */
    if (driven && driven.current) {
      linkFrames(driven.current, frames);
    } else {
      const t = (clock.elapsedTime / CYCLE + phase) % 2;
      poseAt(t < 1 ? t : 2 - t, q);
      linkFrames(q, frames);
    }
    /* The jaw, which was drawn shut whatever the gripper was doing.
     *
     * The asset carries the two fingers as their own links, baked in the
     * flange frame at the closed position with the right one's half turn
     * already applied -- tools/bake_arm.py says in as many words that a page
     * wanting to open them slides each along tool0's x. Nothing did. Every
     * link past the wrist took frames[5] through a Math.min, so the coupler,
     * the body and both fingers were pinned to the wrist, and the gripper
     * was a solid block that never moved while the simulation underneath it
     * opened and closed two real slide joints on friction.
     *
     * The baked left finger sits on the negative side of the flange's x and
     * the right on the positive, so opening is minus for one and plus for
     * the other. The slide is the simulation's own finger joint, which is
     * why it arrives as a seventh number in the driven array rather than as
     * anything this file decides. */
    const jaw = driven && driven.current && driven.current.length > 6
      ? Math.max(0, Math.min(GRIP_MAX, driven.current[6])) : 0;
    for (let li = 0; li < groups.current.length; li++) {
      const g = groups.current[li];
      if (!g) continue;
      if (li === 0) g.matrix.identity();
      else g.matrix.copy(frames[Math.min(5, li - 1)]);
      if (li === FINGER_L || li === FINGER_R) {
        SLIDE.makeTranslation(li === FINGER_L ? -jaw : jaw, 0, 0);
        g.matrix.multiply(SLIDE);
      }
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
