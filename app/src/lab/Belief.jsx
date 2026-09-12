import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { BELIEF_VERT, BELIEF_FRAG } from "../shaders/belief.js";
import { P } from "../lib/palette.js";
import { STOPS, PITCH, WORK, RUN, AISLE } from "../lib/plan.js";

/* The inspection lamp: point anywhere on the floor and the concrete becomes
 * what the planner sees of it.
 *
 * One layer over the whole building, not one per cell, and that is a
 * correction rather than an optimisation. Per cell it was a 7 x 6 m patch
 * sitting five metres inside a fenced bay, behind a bench and a guard panel,
 * and the reader had to find it -- measured on the built page, the cursor at
 * the middle of the frame at a test cell never once landed on one. An
 * interaction nobody can find is not an interaction, and the honest fix is
 * not a bigger hint, it is to make the thing respond everywhere the floor is.
 *
 * It costs less as well: a plane and a material per cell became one, which
 * was six draw calls back out of a frame that was spending 670 of them when
 * there were seven cells, and is seven back now that there are eight.
 *
 * The obstacles are every cell's, in one array, addressed by which cell the
 * lamp is nearest -- so the map under your cursor is the map belonging to the
 * bay you are standing at, and the aisle between two bays shows whichever is
 * closer. A costmap is a local thing and this keeps it local.
 */
const CELL = 0.25;
const RIGS = STOPS.filter(s => s.kind === "rig");
const PER = 6;

export default function Belief() {
  const mat = useRef();
  const want = useRef(new THREE.Vector3(0, 0, 0));
  const open = useRef(0);
  const hot = useRef(false);

  /* Each cell's obstacles, deterministic from its own station so a given bay
     always shows the same map, laid out about that bay's working area. */
  const all = useMemo(() => {
    const out = [];
    for (const s of RIGS) {
      let seed = Math.round(s.at * 10) * 7919 + 13;
      const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
      const cx = s.side * WORK, cz = -s.at * PITCH;
      const set = [];
      for (let i = 0; i < PER; i++) {
        set.push(new THREE.Vector3(cx + (rnd() - 0.5) * 5.4,
                                   cz + (rnd() - 0.5) * 5.2,
                                   0.18 + rnd() * 0.34));
      }
      out.push({ cx, cz, set });
    }
    return out;
  }, []);

  const uniforms = useMemo(() => ({
    uPoint:   { value: new THREE.Vector3(0, 0, 0) },
    uOpen:    { value: 0 },
    uRadius:  { value: 2.9 },
    uHazard:  { value: new THREE.Color(P.hazard) },
    uTeal:    { value: new THREE.Color(P.teal) },
    uInk:     { value: new THREE.Color(P.ink) },
    uCell:    { value: CELL },
    uObs:     { value: all[0].set.map(v => v.clone()) },
    uEye:     { value: new THREE.Vector3() },
    uFogNear: { value: 20 },
    uFogFar:  { value: 78 },
    uAir:     { value: new THREE.Color(P.haze) }
  }), [all]);

  useFrame(({ camera }, dt) => {
    const u = mat.current && mat.current.uniforms;
    if (!u) return;
    const k = 1 - Math.pow(0.0007, Math.min(0.1, dt));
    u.uPoint.value.lerp(want.current, k);
    open.current += ((hot.current ? 1 : 0) - open.current) *
                    (1 - Math.pow(0.004, Math.min(0.1, dt)));
    u.uOpen.value = open.current;
    u.uEye.value.copy(camera.position);

    // Whichever cell's map belongs under the lamp.
    let best = all[0], bd = 1e9;
    for (const c of all) {
      const d = Math.hypot(c.cx - u.uPoint.value.x, c.cz - u.uPoint.value.z);
      if (d < bd) { bd = d; best = c; }
    }
    for (let i = 0; i < PER; i++) u.uObs.value[i].copy(best.set[i]);
  });

  return (
    <mesh
      userData={{ ghost: true }}
      rotation-x={-Math.PI / 2}
      position={[0, 0.012, -RUN / 2]}
      onPointerMove={(e) => { want.current.copy(e.point); hot.current = true; }}
      onPointerOut={() => { hot.current = false; }}
    >
      <planeGeometry args={[AISLE + 2 * (WORK + 3.6), RUN + 24]} />
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
