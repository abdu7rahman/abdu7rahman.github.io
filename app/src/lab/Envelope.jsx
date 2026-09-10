import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { SHAFT_VERT, SHAFT_FRAG, POOL_VERT, poolFrag } from "../shaders/daylight.js";
import { P, KEY } from "../lib/palette.js";
import { AISLE, BAY_D, EAVES, PITCH, RUN, STOPS } from "../lib/plan.js";

/* The building's skin, and the daylight through it.
 *
 * Until this the aisle ran out into black at both ends: no walls past the
 * bays, no roof over the trusses, nothing at the far end to arrive at. A
 * vanishing point that is nothing is the single thing that stops a corridor
 * reading as a place, because depth is only depth if something is at the end
 * of it.
 *
 * The apertures are placed by the key rather than by eye. The scene's light
 * sits at (-6.5, 9.2, 4.0), so for every metre it falls it travels 0.7065 m
 * in +x and 0.4348 m in -z. A rooflight 9.0 m above the slab therefore throws
 * its pool 6.36 m to +x and 3.91 m to -z of itself -- which is why the run is
 * on the left of the roof and nowhere else. From the centre the shafts would
 * miss the aisle entirely and light the racking.
 */
const SPAN = AISLE / 2 + BAY_D;          // where the frames stand: 10.8
const WALL = SPAN + 0.4;
const ROOF = EAVES + 0.6;
const FRONT = PITCH;                     // the wall you come in through
const BACK = -RUN - PITCH;               // the wall you end at

/* Metres of travel per metre of fall, off the key. Not written down twice:
   the shaders take these as uniforms and the pools are placed with them. */
const DX = -KEY.x / KEY.y;               // +0.7065
const DZ = -KEY.z / KEY.y;               // -0.4348

const AP_HX = 1.5, AP_HZ = 2.2;          // rooflight half sizes
const AP_Y = ROOF;
const AP_X = -DX * AP_Y;                 // so the pool lands on the lane centre
const RUN_N = 7;                         // how many, down the run
const AP_Z0 = -PITCH * 1.5;

function Wall({ x, z, w, h, ry = 0, colour = P.steelDk }) {
  return (
    <mesh position={[x, h / 2, z]} rotation-y={ry} receiveShadow>
      <planeGeometry args={[w, h]} />
      <meshStandardMaterial color={colour} roughness={0.96} metalness={0.05}
        side={THREE.DoubleSide} />
    </mesh>
  );
}

export default function Envelope() {
  const pool = useRef();
  const shafts = useRef([]);

  const mouths = useMemo(
    () => STOPS.filter(s => s.side !== 0).map(s => [s.side, -s.at * PITCH]), []);

  const shaftU = useMemo(() => ({
    uSky:     { value: new THREE.Color("#cfe0ff") },
    uDx:      { value: DX },
    uDz:      { value: DZ },
    uHX:      { value: AP_HX },
    uHZ:      { value: AP_HZ },
    uDrop:    { value: AP_Y },
    /* 0.10, not the 0.16 it was. A shaft is the air in a beam and air is
       thin: at 0.16 the volume read as a solid wedge of light rather than as
       something you can see through, which is a fog effect and not a shaft. */
    uGain:    { value: 0.10 },
    uAir:     { value: new THREE.Color(P.air) },
    uFogNear: { value: 20 },
    uFogFar:  { value: 78 }
  }), []);

  const poolU = useMemo(() => ({
    uSky:       { value: new THREE.Color("#cfe0ff") },
    uWash:      { value: new THREE.Color("#8fa8d0") },
    uPitch:     { value: PITCH },
    uZ0:        { value: AP_Z0 + DZ * AP_Y },
    uCount:     { value: RUN_N },
    uHX:        { value: AP_HX },
    uHZ:        { value: AP_HZ },
    uSoft:      { value: 0.42 },
    uGuardX:    { value: -AISLE / 2 },
    uGuardPass: { value: 0.28 },
    uBandLo:    { value: EAVES - 2.4 },
    uBandHi:    { value: EAVES - 0.6 },
    uBandGain:  { value: 0.055 },
    uBackZ:     { value: BACK },
    uDoorHX:    { value: 2.1 },
    uDoorGain:  { value: 0.26 },
    uDoorRun:   { value: 9.0 },
    uFront:     { value: FRONT },
    uBack:      { value: BACK },
    /* 0.18, halved. At 0.34 the pools were the brightest thing on the floor
       by a wide margin and the slab around them came up with them -- an
       additive layer cannot lift a black, but it can certainly flatten a
       lit mid grey, and the brief is more contrast rather than more light.
       Halved, a pool is clearly a pool and the concrete beside it is still
       the concrete the luminaires left. */
    uGain:      { value: 0.18 },
    uFogNear:   { value: 20 },
    uFogFar:    { value: 78 },
    uMouth:     { value: mouths.map(m => new THREE.Vector2(m[0], m[1])) }
  }), [mouths]);

  const frag = useMemo(() => poolFrag(mouths.length), [mouths]);

  useFrame(() => { /* nothing animates: the sun does not move in a shed */ });

  return (
    <group>
      {/* Side walls, roof deck, and the two ends. Double-sided, because the
          camera never leaves the inside and a single-sided skin would show
          the reader the back of the building through its own roof. */}
      <Wall x={-WALL} z={-RUN / 2} w={RUN + 4 * PITCH} h={ROOF} ry={Math.PI / 2} />
      <Wall x={WALL}  z={-RUN / 2} w={RUN + 4 * PITCH} h={ROOF} ry={-Math.PI / 2} />
      <mesh position={[0, ROOF, -RUN / 2]} rotation-x={Math.PI / 2} receiveShadow>
        <planeGeometry args={[WALL * 2, RUN + 4 * PITCH]} />
        <meshStandardMaterial color={"#141417"} roughness={1} metalness={0}
          side={THREE.DoubleSide} />
      </mesh>
      <Wall x={0} z={BACK} w={WALL * 2} h={ROOF} />
      <Wall x={0} z={FRONT} w={WALL * 2} h={ROOF} />

      {/* The door in the end wall, which is what makes the far end somewhere
          rather than a stop. Wider than the lane so the lane clearly goes
          through it, and lit from behind by the pool shader's own door term. */}
      <mesh position={[0, 1.9, BACK + 0.06]}>
        <planeGeometry args={[4.2, 3.8]} />
        <meshBasicMaterial color={"#1b2430"} toneMapped={false} />
      </mesh>
      {[-2.15, 2.15].map((d, i) => (
        <mesh key={i} position={[d, 1.9, BACK + 0.1]} castShadow>
          <boxGeometry args={[0.12, 3.9, 0.12]} />
          <meshStandardMaterial color={P.hazard} roughness={0.7}
            emissive={P.hazard} emissiveIntensity={0.10} />
        </mesh>
      ))}

      {/* The rooflights themselves, as holes in the deck. */}
      {Array.from({ length: RUN_N }, (_, i) => (
        <mesh key={"ap" + i} position={[AP_X, ROOF - 0.01, AP_Z0 - i * PITCH]}
              rotation-x={-Math.PI / 2}>
          <planeGeometry args={[AP_HX * 2, AP_HZ * 2]} />
          <meshBasicMaterial color={"#dce8ff"} toneMapped={false} />
        </mesh>
      ))}

      {/* The air in the beams. Additive, depth-tested but not depth-writing,
          so a shaft is in front of what it is in front of and never occludes
          anything. */}
      {Array.from({ length: RUN_N }, (_, i) => (
        <mesh key={"sh" + i} position={[AP_X, ROOF, AP_Z0 - i * PITCH]}
              ref={el => (shafts.current[i] = el)}>
          <boxGeometry args={[AP_HX * 2 + 2 * Math.abs(DX) * AP_Y, AP_Y,
                              AP_HZ * 2 + 2 * Math.abs(DZ) * AP_Y]} />
          <shaderMaterial
            uniforms={shaftU}
            vertexShader={SHAFT_VERT}
            fragmentShader={SHAFT_FRAG}
            transparent depthWrite={false}
            blending={THREE.AdditiveBlending}
            side={THREE.BackSide}
          />
        </mesh>
      ))}

      {/* And the pools they land in. One plane over the slab, additive. */}
      <mesh ref={pool} rotation-x={-Math.PI / 2} position={[0, 0.02, -RUN / 2]}>
        <planeGeometry args={[WALL * 2, RUN + 4 * PITCH]} />
        <shaderMaterial
          uniforms={poolU}
          vertexShader={POOL_VERT}
          fragmentShader={frag}
          transparent depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
    </group>
  );
}
