import { useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { FLOOR_VERT, FLOOR_FRAG } from "../shaders/floor.js";
import { P, KEY } from "../lib/palette.js";
import { PITCH, AISLE, RUN } from "../lib/plan.js";

/* The poured slab, one quad, everything on it drawn analytically.
 *
 * Big enough to run past the last stop and out under the far wall, because a
 * floor that ends inside the fog is a floor with an edge in it and the eye
 * finds an edge before it finds anything else. */
export default function Slab() {
  const mat = useRef();
  const { camera } = useThree();

  const uniforms = useMemo(() => ({
    uFloor:   { value: new THREE.Color(P.floor) },
    uLit:     { value: new THREE.Color(P.floorLit) },
    uHazard:  { value: new THREE.Color(P.hazard) },
    uAir:     { value: new THREE.Color(P.haze) },
    uKey:     { value: new THREE.Vector3(KEY.x, KEY.y, KEY.z).normalize() },
    uEye:     { value: new THREE.Vector3() },
    uPitch:   { value: PITCH },
    uAisle:   { value: AISLE },
    uFogNear: { value: 14.0 },
    uFogFar:  { value: 62.0 },
    uTime:    { value: 0 }
  }), []);

  useFrame((state) => {
    uniforms.uEye.value.copy(camera.position);
    uniforms.uTime.value = state.clock.elapsedTime;
  });

  return (
    <mesh rotation-x={-Math.PI / 2} position={[0, 0, -RUN / 2]} receiveShadow>
      <planeGeometry args={[46, RUN + 40]} />
      <shaderMaterial
        ref={mat}
        uniforms={uniforms}
        vertexShader={FLOOR_VERT}
        fragmentShader={FLOOR_FRAG}
      />
    </mesh>
  );
}
