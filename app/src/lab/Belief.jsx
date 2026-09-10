import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { BELIEF_VERT, BELIEF_FRAG } from "../shaders/belief.js";
import { P } from "../lib/palette.js";
import { WORK, BAY_D } from "../lib/plan.js";

/* The inspection lamp. Sweep the floor of a cell and the concrete becomes
 * what the planner sees of it.
 *
 * The point is taken from the pointer event's own world-space hit rather than
 * from a normalised mouse vector, which matters for a reason specific to this
 * building: the camera is not looking down the axis it is travelling along --
 * it glances into whichever bay it is passing -- so screen x has no fixed
 * relationship to floor x. A hit point does; it is the place under the
 * cursor, whatever the camera happens to be doing.
 *
 * Held rather than followed. The lamp lerps toward the hit at a rate in
 * seconds, so a fast flick draws the boundary after the cursor instead of
 * teleporting it, and the frame rate does not change the feel.
 */
const CELL = 0.25;                      // costmap resolution, metres

export default function Belief({ side, seed = 0 }) {
  const x = side * (WORK + 0.6);
  const mat = useRef();
  const want = useRef(new THREE.Vector3(x, 0, 0));
  const open = useRef(0);
  const hot = useRef(false);

  /* Obstacles, laid out deterministically from the cell's own index so a
     given bay always shows the same map. Their radii are the robot's
     inscribed radius and up -- the smallest thing a costmap bothers to
     inflate is the thing that will not fit past. */
  const obs = useMemo(() => {
    const a = [];
    let s = seed * 7919 + 13;
    const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let i = 0; i < 6; i++) {
      a.push(new THREE.Vector3(
        x + (rnd() - 0.5) * (BAY_D - 1.6),
        (rnd() - 0.5) * 5.2,
        0.18 + rnd() * 0.34
      ));
    }
    return a;
  }, [x, seed]);

  const uniforms = useMemo(() => ({
    uPoint:   { value: new THREE.Vector3(x, 0, 0) },
    uOpen:    { value: 0 },
    uRadius:  { value: 2.35 },
    uHazard:  { value: new THREE.Color(P.hazard) },
    uTeal:    { value: new THREE.Color(P.teal) },
    uInk:     { value: new THREE.Color(P.ink) },
    uCell:    { value: CELL },
    uObs:     { value: obs },
    uEye:     { value: new THREE.Vector3() },
    uFogNear: { value: 20 },
    uFogFar:  { value: 78 },
    uAir:     { value: new THREE.Color(P.air) }
  }), [x, obs]);

  /* Written through the material's own uniform object rather than through the
     one this component built.

     Passing a uniforms prop and then mutating the object you passed looks
     equivalent and is not reliably so: React re-renders reassign the prop,
     and after that it is ambiguous which object the material is actually
     holding. Mutating what the ref points at is unambiguous -- that is the
     one on the GPU. This cost a morning: the plane was in the right place
     with the right geometry and discarded every fragment, because uOpen on
     the material never left zero while uOpen on the object here climbed to
     one exactly as intended. */
  useFrame(({ camera }, dt) => {
    const u = mat.current && mat.current.uniforms;
    if (!u) return;
    const k = 1 - Math.pow(0.0007, Math.min(0.1, dt));
    u.uPoint.value.lerp(want.current, k);
    open.current += ((hot.current ? 1 : 0) - open.current) * (1 - Math.pow(0.004, Math.min(0.1, dt)));
    u.uOpen.value = open.current;
    u.uEye.value.copy(camera.position);
  });

  return (
    <mesh
      rotation-x={-Math.PI / 2}
      position={[x, 0.012, 0]}
      onPointerMove={(e) => { want.current.copy(e.point); hot.current = true; }}
      onPointerOver={() => { hot.current = true; }}
      onPointerOut={() => { hot.current = false; }}
    >
      <planeGeometry args={[BAY_D - 0.4, 6.4]} />
      <shaderMaterial
        ref={mat}
        uniforms={uniforms}
        vertexShader={BELIEF_VERT}
        fragmentShader={BELIEF_FRAG}
        transparent
        depthWrite={false}
      />
    </mesh>
  );
}
