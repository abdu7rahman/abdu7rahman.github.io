import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { SHAFT_VERT, SHAFT_FRAG, POOL_VERT, poolFrag } from "../shaders/daylight.js";
import { cladding } from "../shaders/cladding.js";
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

/* A clad wall.
 *
 * The material is built here rather than declared as a JSX child because
 * shaders/cladding.js patches it, and a patch is a property of the material
 * object -- three has to see onBeforeCompile before it first compiles, and a
 * ref set after mount is one frame too late. So it is made in a memo, handed
 * over with primitive, and disposed when it goes.
 *
 * `base` is what turns the plane's local y into a height above the slab: the
 * mesh is positioned at h/2 and the geometry runs from -h/2, so the two
 * cancel and the shader can talk about 2.35 m and mean it.
 */
function Wall({ x, z, w, h, ry = 0, colour = P.steelDk, dado = 2.35 }) {
  const mat = useMemo(() => cladding(new THREE.MeshStandardMaterial({
    color: new THREE.Color(colour),
    roughness: 0.88, metalness: 0.14, side: THREE.DoubleSide
  }), { base: h / 2, dado }), [colour, h, dado]);
  useEffect(() => () => mat.dispose(), [mat]);
  return (
    <mesh position={[x, h / 2, z]} rotation-y={ry} receiveShadow>
      <planeGeometry args={[w, h]} />
      <primitive object={mat} attach="material" />
    </mesh>
  );
}

/* A roller shutter, which is the one thing a blank flank of a shed always
 * has and this one did not.
 *
 * Horizontal slats rather than vertical ribs, so it reads as a door and not
 * as more wall: same material patch, axis turned. The curtain is recessed
 * 0.12 m into the opening and framed in painted angle, because a shutter set
 * flush with the cladding is a rectangle of a different colour and a shutter
 * in a reveal is a hole in a building.
 */
function Shutter({ x, z, ry, w = 4.4, h = 4.6, open = 0 }) {
  const curtain = useMemo(() => cladding(new THREE.MeshStandardMaterial({
    color: new THREE.Color("#2b2d31"), roughness: 0.62, metalness: 0.45
  }), { axis: new THREE.Vector3(0, 1, 0), pitch: 0.115, crown: 0.62,
        ramp: 0.14, depth: 0.022, seam: 0, dado: -1 }), []);
  useEffect(() => () => curtain.dispose(), [curtain]);
  const drop = h * (1 - open);
  return (
    <group position={[x, 0, z]} rotation-y={ry}>
      {/* The reveal: a dark recess the curtain hangs inside. */}
      <mesh position={[0, h / 2, -0.16]} receiveShadow>
        <planeGeometry args={[w, h]} />
        <meshStandardMaterial color={"#0e0f11"} roughness={1} />
      </mesh>
      <mesh position={[0, h - drop / 2, -0.04]} receiveShadow>
        <planeGeometry args={[w - 0.24, drop]} />
        <primitive object={curtain} attach="material" />
      </mesh>
      {/* Guides either side and the hood over the barrel. */}
      {[-1, 1].map(s => (
        <mesh key={s} position={[s * (w / 2 - 0.06), h / 2, 0.02]} castShadow>
          <boxGeometry args={[0.14, h, 0.16]} />
          <meshStandardMaterial color={P.hazard} roughness={0.72}
            emissive={P.hazard} emissiveIntensity={0.06} />
        </mesh>
      ))}
      <mesh position={[0, h + 0.22, 0.04]} castShadow>
        <boxGeometry args={[w + 0.2, 0.44, 0.34]} />
        <meshStandardMaterial color={P.steel} roughness={0.7} metalness={0.4} />
      </mesh>
      {/* Bollards, which is how you can tell from across a building that
          something drives through there. */}
      {[-1, 1].map(s => (
        <mesh key={"b" + s} position={[s * (w / 2 + 0.5), 0.55, 0.55]} castShadow>
          <cylinderGeometry args={[0.11, 0.11, 1.1, 10]} />
          <meshStandardMaterial color={P.hazard} roughness={0.8}
            emissive={P.hazard} emissiveIntensity={0.10} />
        </mesh>
      ))}
    </group>
  );
}

export default function Envelope() {
  const pool = useRef();
  const shafts = useRef([]);

  const mouths = useMemo(
    () => STOPS.filter(s => s.side !== 0).map(s => [s.side, -s.at * PITCH]), []);

  const deck = useMemo(() => cladding(new THREE.MeshStandardMaterial({
    color: new THREE.Color("#141417"), roughness: 1, metalness: 0,
    side: THREE.DoubleSide
  }), { pitch: 0.62, crown: 0.34, ramp: 0.13, depth: 0.07, seam: 0, dado: -1 }), []);
  useEffect(() => () => deck.dispose(), [deck]);

  const shaftU = useMemo(() => ({
    uSky:     { value: new THREE.Color("#cfe0ff") },
    uDx:      { value: DX },
    uDz:      { value: DZ },
    uHX:      { value: AP_HX },
    uHZ:      { value: AP_HZ },
    /* Penumbra half width where the beam meets the slab, in metres, and
       0.9 on a 1.5 m half aperture is not a large number for a diffusing
       panel -- a GRP rooflight is an area source the size of the opening,
       so its shadow edge is soft in proportion to how far it has fallen. */
    uPen:     { value: 0.9 },
    uNear:    { value: new THREE.Vector2(3.0, 13.0) },
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

  /* The proxy box for the beams, built once and shared by all seven.
  
     Translated down half its height, which it was not, and that was cutting
     every beam in half. The shader works in object space with the aperture
     at the origin and the beam running to y = -uDrop, but a BoxGeometry is
     centred on its origin -- so the box spanned from ROOF/2 up to 1.5*ROOF,
     half of it in the sky above the roof and none of it over the lower half
     of the beam. Since the material is BackSide and the chord is analytic,
     the box does not bound the light, it only decides which pixels get to
     ask for it: below mid height nothing asked, and seven beams sheared
     along the sun and truncated at the same height read as a staircase of
     bright rectangles.
  
     Wide enough for the shear. The beam moves DX and DZ metres per metre of
     fall, so the swept solid needs AP_HX + |DX| * AP_Y of half width; this
     carries twice the shear, which also covers the penumbra with room to
     spare. */
  const shaftGeo = useMemo(() => {
    const g = new THREE.BoxGeometry(AP_HX * 2 + 2 * Math.abs(DX) * AP_Y, AP_Y,
                                    AP_HZ * 2 + 2 * Math.abs(DZ) * AP_Y);
    g.translate(0, -AP_Y / 2, 0);
    return g;
  }, []);

  useFrame(() => { /* nothing animates: the sun does not move in a shed */ });

  return (
    <group>
      {/* Side walls, roof deck, and the two ends. Double-sided, because the
          camera never leaves the inside and a single-sided skin would show
          the reader the back of the building through its own roof. */}
      <Wall x={-WALL} z={-RUN / 2} w={RUN + 4 * PITCH} h={ROOF} ry={Math.PI / 2} />
      <Wall x={WALL}  z={-RUN / 2} w={RUN + 4 * PITCH} h={ROOF} ry={-Math.PI / 2} />
      {/* The deck. Same patch, a coarser profile and no base course: a roof
          sheet is a deeper section than a wall sheet because it spans purlins
          instead of rails, and a roof does not have a bottom two metres. */}
      <mesh position={[0, ROOF, -RUN / 2]} rotation-x={Math.PI / 2} receiveShadow>
        <planeGeometry args={[WALL * 2, RUN + 4 * PITCH]} />
        <primitive object={deck} attach="material" />
      </mesh>
      <Wall x={0} z={BACK} w={WALL * 2} h={ROOF} />
      <Wall x={0} z={FRONT} w={WALL * 2} h={ROOF} />

      {/* Two goods doors in the end wall, either side of the personnel door.
          This is the vanishing point of a 66 m aisle and the only thing on it
          was a lit rectangle; a shed's end wall is where the lorries back on
          to, and three openings at three sizes is what says so. */}
      <Shutter x={-6.6} z={BACK + 0.05} ry={0} w={4.6} h={4.8} open={0.34} />
      <Shutter x={6.6} z={BACK + 0.05} ry={0} w={4.6} h={4.8} open={0} />

      {/* The door in the end wall, which is what makes the far end somewhere
          rather than a stop. Wider than the lane so the lane clearly goes
          through it, and the daylight outside it is why the pool shader puts
          a wash of light on the slab in front of it.

          Blown, and above 1.0, which is the point of rendering into a half
          float buffer at all. A doorway open to the sky, seen from inside a
          shed lit to a lane value of 95 of 255, is not a slightly pale
          rectangle -- it is four or five stops over everything around it,
          and the eye reads that overload as outside. It used to be #1b2430
          with toneMapped off, which is 27 of 255: darker than the floor, so
          the end of a sixty-six metre aisle was a hole rather than a door.

          Tone mapped, unlike before, and that matters more than it looks.
          toneMapped false skips the curve but not the encode, and the encode
          is the identity when the scene is being rendered into a target and
          is not when it is going to the canvas -- so the one material in the
          building set that way was the one material that came out different
          with the post chain on. Set in linear above unity instead, the
          curve rolls it off to near white on both paths and the bright pass
          sees a genuine source. */}
      <mesh position={[0, 1.9, BACK + 0.06]}>
        <planeGeometry args={[4.2, 3.8]} />
        <meshBasicMaterial
          color={new THREE.Color().setRGB(1.35, 1.46, 1.68, THREE.LinearSRGBColorSpace)} />
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
              geometry={shaftGeo}
              ref={el => (shafts.current[i] = el)}>
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
