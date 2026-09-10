import { useMemo } from "react";
import * as THREE from "three";
import { Instances, Instance } from "@react-three/drei";
import { P } from "../lib/palette.js";
import { AISLE, BAY_D, EAVES, PITCH, WORK, STOPS } from "../lib/plan.js";

/* The six rooms, which were six gaps.
 *
 * A cell is a machine behind a fence and you glance into it walking past. A
 * room is somewhere you stop, so it is built the other way round: fewer
 * moving things, more surface, and the light coming off what is in it rather
 * than off a spot aimed at a bench. The reading itself is DOM over the canvas
 * (nav/Panel.jsx) -- these are the places that reading happens in, not a
 * second copy of it painted onto a wall.
 *
 * They are the same building as the cells. Same 7.2 m grid, same steel, same
 * rule about orange: it goes on what would really be painted -- a kick rail,
 * a door edge, a fire point -- and nowhere else. Six different art directions
 * would make this a showreel; one vocabulary makes it a facility.
 */
const ROOMS = STOPS.filter(s => s.kind === "room");

/* Partition height. Not to the truss: a room boxed to 8.4 m would black out
   the bay behind it and the aisle's depth is the whole composition. 3.4 m is
   a real partition height, it clears a door and a rack, and it leaves the
   portal frames reading over the top of everything. */
const WALL_H = 3.4;

function Shell({ side, deep }) {
  const s = side || 1;
  const x = s * WORK;
  const back = s * (AISLE / 2 + BAY_D);
  return (
    <group>
      {/* Back wall and one return, so a room is a corner rather than a flat. */}
      <mesh position={[back, WALL_H / 2, 0]} rotation-y={-s * Math.PI / 2} receiveShadow>
        <planeGeometry args={[deep, WALL_H]} />
        <meshStandardMaterial color={P.steelDk} roughness={0.95} metalness={0.06} />
      </mesh>
      <mesh position={[x, WALL_H / 2, -deep / 2]} receiveShadow>
        <planeGeometry args={[BAY_D, WALL_H]} />
        <meshStandardMaterial color={P.steelDk} roughness={0.95} metalness={0.06} />
      </mesh>
      {/* The painted edge where a partition meets the floor. */}
      <mesh position={[x, 0.05, -deep / 2 + 0.02]}>
        <boxGeometry args={[BAY_D, 0.1, 0.04]} />
        <meshStandardMaterial color={P.hazard} roughness={0.8}
          emissive={P.hazard} emissiveIntensity={0.08} />
      </mesh>
      {/* Two soft sources per room, high and wide, so a room reads as lit
          rather than as spotlit. No shadow map: seven cells already cast and
          the shadow budget is spent where machines are.

          Two and not one, and at 140 rather than 46, because these only
          started being looked at when the dolly learned to turn into them.
          One lamp at the middle of a 7.6 m room with decay 2 puts about 12
          on the floor beneath it and under 3 on the back wall, which is a
          hotspot in a black box -- fine as a glow seen edge-on from the
          aisle, which is all it ever was. A pair at the quarter points is
          the fitting a room this size actually gets. */}
      <pointLight position={[x, WALL_H - 0.3, deep / 4]} color={"#ffe6cc"}
        intensity={140} distance={17} decay={2} />
      <pointLight position={[x, WALL_H - 0.3, -deep / 4]} color={"#ffe6cc"}
        intensity={140} distance={17} decay={2} />
    </group>
  );
}

/* Racking: uprights and shelves, instanced. The one piece of furniture that
   says storage without anybody having to label it. */
function Racking({ side, bays, deep }) {
  const s = side || 1;
  const x = s * (WORK + 1.5);
  const shelves = useMemo(() => {
    const out = [];
    for (let b = 0; b < bays; b++) {
      const z = -deep / 2 + 1.2 + b * 2.3;
      for (let l = 0; l < 4; l++) out.push([x, 0.42 + l * 0.78, z]);
    }
    return out;
  }, [x, bays, deep]);
  return (
    <group>
      <Instances limit={shelves.length} castShadow receiveShadow>
        <boxGeometry args={[1.9, 0.05, 2.0]} />
        <meshStandardMaterial color={P.steel} roughness={0.75} metalness={0.35} />
        {shelves.map((p, i) => <Instance key={i} position={p} />)}
      </Instances>
      {/* Uprights, orange because racking is. */}
      <Instances limit={bays * 2} castShadow>
        <boxGeometry args={[0.07, 3.2, 0.07]} />
        <meshStandardMaterial color={P.hazard} roughness={0.7}
          emissive={P.hazard} emissiveIntensity={0.05} />
        {Array.from({ length: bays }, (_, b) => {
          const z = -deep / 2 + 1.2 + b * 2.3;
          return (
            <group key={b}>
              <Instance position={[x - 0.9, 1.6, z - 1.0]} />
              <Instance position={[x + 0.9, 1.6, z - 1.0]} />
            </group>
          );
        })}
      </Instances>
    </group>
  );
}

/* Metrology: a granite surface plate on a stand, which is the one object a
   measuring room is actually built around, plus an instrument bench. */
function Metrology({ side }) {
  const s = side || -1;
  const x = s * WORK;
  return (
    <group>
      <mesh position={[x, 0.44, 0.4]} castShadow receiveShadow>
        <boxGeometry args={[1.5, 0.88, 2.2]} />
        <meshStandardMaterial color={P.steelDk} roughness={0.8} metalness={0.3} />
      </mesh>
      {/* The plate. Dark, flat, and the only near-specular surface in the
          building -- granite lapped to a few microns is what "measured" looks
          like as an object. */}
      <mesh position={[x, 0.94, 0.4]} castShadow receiveShadow>
        <boxGeometry args={[1.62, 0.12, 2.32]} />
        <meshStandardMaterial color={"#26262b"} roughness={0.18} metalness={0.15} />
      </mesh>
      {/* Column and probe arm standing on it. */}
      <mesh position={[x - 0.6, 1.6, -0.3]} castShadow>
        <boxGeometry args={[0.12, 1.2, 0.12]} />
        <meshStandardMaterial color={P.machine} roughness={0.4} metalness={0.6} />
      </mesh>
      <mesh position={[x - 0.2, 2.12, -0.3]} castShadow>
        <boxGeometry args={[0.9, 0.09, 0.09]} />
        <meshStandardMaterial color={P.machine} roughness={0.4} metalness={0.6} />
      </mesh>
    </group>
  );
}

/* A desk, for the room the reader leaves from. */
function Desk({ side, x: ax, z = 0 }) {
  const s = side || 1;
  const x = ax !== undefined ? ax : (side === 0 ? 1 : s) * (WORK - 0.4);
  return (
    <group>
      <mesh position={[x, 0.72, z]} castShadow receiveShadow>
        <boxGeometry args={[1.6, 0.06, 0.8]} />
        <meshStandardMaterial color={P.steel} roughness={0.65} metalness={0.3} />
      </mesh>
      {[-0.7, 0.7].map((d, i) => (
        <mesh key={i} position={[x + d, 0.35, z]} castShadow>
          <boxGeometry args={[0.06, 0.7, 0.7]} />
          <meshStandardMaterial color={P.steelDk} roughness={0.8} metalness={0.3} />
        </mesh>
      ))}
    </group>
  );
}

/* The history wall, and the light that makes it one.

   One long plate with nothing on it, which is the right call -- what is
   written on it is the reading panel, and a wall with painted text would be
   a picture of the reading sitting next to the reading. But an unlit plate
   the same grey as the wall it is bolted to is not a plate, it is the wall,
   and once the dolly started turning into this room that was the whole shot:
   a lit empty box. A wall wash is the fitting the plate would actually have,
   and the crates under it are what a store of five seasons of retired
   hardware looks like from the aisle. Nothing here says what is in them. */
function History({ side }) {
  const s = side || -1;
  const back = s * (AISLE / 2 + BAY_D);
  const aim = useMemo(() => new THREE.Object3D(), []);
  const crates = useMemo(
    () => [-1.9, -0.62, 0.66, 1.94].map((z, i) => [z, 0.44 + (i % 2) * 0.06]), []);
  return (
    <group>
      <mesh position={[back - s * 0.05, 1.7, 0]} rotation-y={-s * Math.PI / 2}>
        <planeGeometry args={[5.4, 2.2]} />
        <meshStandardMaterial color={P.steel} roughness={0.55} metalness={0.35} />
      </mesh>
      {crates.map(([z, h], i) => (
        <mesh key={i} position={[back - s * 0.75, h / 2, z]} castShadow receiveShadow>
          <boxGeometry args={[1.1, h, 1.0]} />
          <meshStandardMaterial color={i % 2 ? P.steel : P.steelDk}
            roughness={0.85} metalness={0.15} />
        </mesh>
      ))}
      <primitive object={aim} position={[back, 1.9, 0]} />
      <spotLight position={[back - s * 3.2, WALL_H - 0.2, 0]} target={aim}
        angle={0.7} penumbra={0.6} intensity={190} distance={14} decay={2}
        color={"#fff0dc"} />
    </group>
  );
}

/* The desk at the end of the run, in the aisle rather than off it.

   The office is the one room with no hand of its own, so the dolly keeps
   the lane there and looks straight down sixty-six metres at the end wall.
   A desk parked in a side bay is a desk nobody sees; a desk in front of the
   door, with the door lit from outside behind it, is the last shot in the
   building and the one the contact panel sits beside. */
function Reception() {
  const aim = useMemo(() => new THREE.Object3D(), []);
  return (
    <group>
      <Desk side={0} x={-0.9} z={-5.4} />
      <primitive object={aim} position={[-0.9, 0.8, -5.4]} />
      <spotLight position={[-2.2, WALL_H + 0.9, -3.4]} target={aim}
        angle={0.62} penumbra={0.45} intensity={220} distance={13} decay={2}
        color={"#ffe6cc"} castShadow />
    </group>
  );
}

export default function Rooms() {
  return (
    <group>
      {ROOMS.map(r => {
        const z = -r.at * PITCH;
        const side = r.side === 0 ? 1 : r.side;
        const deep = 7.0;
        return (
          <group key={r.id} position={[0, 0, z]}>
            <Shell side={side} deep={deep} />
            {r.id === "work"     && <Racking side={side} bays={3} deep={deep} />}
            {r.id === "stack"    && <Racking side={side} bays={3} deep={deep} />}
            {r.id === "measured" && <Metrology side={side} />}
            {r.id === "entry"    && <Desk side={side} />}
            {r.id === "contact"  && <Reception />}
            {r.id === "path"     && <History side={side} />}
          </group>
        );
      })}
    </group>
  );
}
