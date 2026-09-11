import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { Instances, Instance } from "@react-three/drei";
import { P } from "../lib/palette.js";
import { cladding } from "../shaders/cladding.js";
import { member } from "../lab/steel.js";
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
/* How far a room runs back from the aisle before its return wall. Module
   scope because the partition framing is assembled once for the whole
   building and the rooms are drawn one at a time -- two copies of this
   number is two places for the glass and its mullions to disagree. */
const DEEP = 7.0;

/* Except at the front door. The entry station is where the reader lands, and
   a 7.0 m room puts its return wall 3.5 m in front of them and slightly to
   the right -- measured, a ray through that part of the arrival shot came
   back at 4.03 m. A lobby is a bigger room than a store anyway, and at 12 m
   the same partition is far enough away to be a wall of the building rather
   than an object in the reader's face. */
function roomDeep(r) { return r.id === "entry" ? 12.0 : DEEP; }

/* The glazed band, which is what a partition in a working building is.
 *
 * The return wall of every room used to be one 7.6 by 3.4 m plane of flat
 * grey, and at the entrance that plane stands four metres in front of the
 * reader and slightly to the right -- so the first thing anybody saw of this
 * building was a blank rectangle filling a third of the frame. Measured
 * rather than guessed: a ray through that part of the shot returns the entry
 * room's own return at (4.9, 1.7, -3.5), 4.03 m out.
 *
 * A partition is a dado, a glazed band and a head. The band is the fix and
 * the reason is not decoration: glass lets the room behind it into the shot,
 * so the surface stops being a wall and becomes a thing you look through at
 * something lit. It also gives the frame two horizontal lines and a rhythm
 * of mullions where it had one silhouette.
 *
 * DADO_H and HEAD_H are where the solid parts stop and start. Both are real
 * dimensions: a 1.1 m dado is a leaning height and a 0.8 m head is what a
 * proprietary partition system leaves above the glass for the track.
 */
const DADO_H = 1.1, HEAD_H = 0.8;
const MULLION = 1.24;                   // glass pane width, centre to centre

/* Every solid piece of every partition in the building, as members.
 *
 * One list, built once, drawn as two InstancedMeshes -- one painted steel and
 * one hazard orange. Six rooms times a dado, a head, a cap, four transoms and
 * six mullions is well over a hundred boxes, and a hundred boxes is a hundred
 * draw calls done the obvious way. This is two, including into the shadow
 * map, which is the same trade lab/steel.js already makes for the frame.
 */
function partition(steel, panel, paint, x, z, w, ry) {
  const c = Math.cos(ry), sn = Math.sin(ry);
  // Along the wall, in plan. ry is the wall's own rotation about y.
  const ax = (u, v) => [x + c * u + sn * v, z - sn * u + c * v];
  const half = w / 2;
  const put = (out, u0, y0, u1, y1, tw, tt, v = 0) => {
    const a = ax(u0, v), b = ax(u1, v);
    out.push([a[0], y0, a[1], b[0], y1, b[1], tw, tt]);
  };
  /* Dado and head, as two flat slabs the width of the opening, and darker
     than the framing around them. They are the largest area of the whole
     partition and the entry room's dado stands four metres from the reader:
     in the middle grey the framing is painted, that one panel was the
     brightest thing in the arrival shot. */
  put(panel, -half, DADO_H / 2, half, DADO_H / 2, DADO_H, 0.09);
  put(panel, -half, WALL_H - HEAD_H / 2, half, WALL_H - HEAD_H / 2, HEAD_H, 0.09);
  // Cill, transom and cap: the three horizontals that make it read as glazing
  // rather than as a hole cut in a wall.
  put(steel, -half, DADO_H, half, DADO_H, 0.10, 0.16);
  put(steel, -half, WALL_H - HEAD_H, half, WALL_H - HEAD_H, 0.10, 0.16);
  put(steel, -half, WALL_H + 0.05, half, WALL_H + 0.05, 0.12, 0.20);
  // Mullions between the panes, and a stile at each end.
  const bays = Math.max(2, Math.round(w / MULLION));
  for (let i = 0; i <= bays; i++) {
    const u = -half + (i * w) / bays;
    put(steel, u, DADO_H, u, WALL_H - HEAD_H, 0.07, 0.13);
  }
  // The painted edge where a partition meets the floor, and the door edge.
  put(paint, -half, 0.05, half, 0.05, 0.10, 0.05, 0.055);
}

function Shell({ side, deep, centre }) {
  const s = side || 1;
  const x = s * WORK;
  const back = s * (AISLE / 2 + BAY_D);
  const wall = useMemo(() => cladding(new THREE.MeshStandardMaterial({
    color: new THREE.Color(P.steelDk), roughness: 0.9, metalness: 0.1
  }), { base: WALL_H / 2, dado: -1, pitch: 0.30, depth: 0.03, seam: 0 }), []);
  useEffect(() => () => wall.dispose(), [wall]);
  return (
    <group>
      {/* Back wall and one return, so a room is a corner rather than a flat.
          Not for the two rooms on the centreline: they are the ends of the
          building rather than bays off the aisle, the structure already
          carries walls there, and a room shell at the front door is a wall
          across the greeting camera. */}
      {!centre && <mesh position={[back, WALL_H / 2, 0]} rotation-y={-s * Math.PI / 2} receiveShadow>
        <planeGeometry args={[deep, WALL_H]} />
        <primitive object={wall} attach="material" />
      </mesh>}
      {/* The glass in the return. One pane the width of the opening rather
          than one per bay: the mullions are drawn over it and a pane per bay
          would be six transparent surfaces to sort instead of one.
       *
       * Not on the two rooms that sit on the centreline. A room with a side
       * of 0 is an end of the building rather than a bay off the aisle -- the
       * front door and the office -- and it has no return to glaze. It was
       * getting one anyway, because the side was read as `side || 1` and zero
       * is falsy, so the front door grew a double-sided pane at 42 per cent
       * across the aisle at z = 0. That is exactly where the greeting camera
       * stands, so the first thing anybody saw of this building was a grey
       * sheet over the top right of the frame with the building faintly
       * visible through it. */}
      {!centre && <mesh position={[x, DADO_H + (WALL_H - HEAD_H - DADO_H) / 2, -deep / 2]}>
        <planeGeometry args={[BAY_D, WALL_H - HEAD_H - DADO_H]} />
        <meshStandardMaterial
          color={"#171a1f"} roughness={0.08} metalness={0.25}
          transparent opacity={0.42} side={THREE.DoubleSide} />
      </mesh>}
      {/* Fittings, and then the light out of them.
       *
       * Every room in this building was measurably darker than every cell in
       * it, and not by a little: screenshotting all thirteen stations and
       * taking the mean luminance of the render, the six rooms came in at
       * 30.6 to 59.5 and the seven cells at 70.8 to 87.3 -- two clean bands
       * with nothing between them. Metrology and service history were 77 per
       * cent pixels below 24 of 255. A room you are walked into to read
       * something should not be the dimmest thing in the place.
       *
       * The fix is fittings rather than a brighter invisible lamp. A cell
       * reads as lit because it has a task light hanging over the bench that
       * you can see; a room had two point sources in mid air and nothing to
       * say where the light was coming from. These are the same suspended
       * linear luminaires the lane carries, hung at 3.0 m, and they do two
       * jobs at once: they are bright geometry in shot, and they are where
       * the lamps now hang.
       *
       * The lamps moved as well. At 4.6 m off the centre line -- near the
       * mouth -- a decay-2 source reaches the back wall 6.2 m away at about
       * 3.4, which is nothing. Over the middle of the room at 7.0 the same
       * fitting is 3.8 m off the back wall and 3.6 off the floor, which is
       * four times the light on both for the same lamp.
       */}
      {LAMPS(deep).map((lz, i) => (
        <group key={i} position={[s * 7.0, 3.02, lz]}>
          <mesh castShadow>
            <boxGeometry args={[2.9, 0.10, 0.17]} />
            <meshStandardMaterial color={P.steel} roughness={0.6} metalness={0.55} />
          </mesh>
          {/* The tube. Emissive costs nothing per fragment and is most of
              what makes a fitting read as switched on. */}
          <mesh position={[0, -0.058, 0]}>
            <boxGeometry args={[2.74, 0.025, 0.125]} />
            <meshStandardMaterial color={"#fff3e0"} emissive={"#ffe9cf"}
              emissiveIntensity={2.1} toneMapped={false} />
          </mesh>
          {/* Two stems, because a fitting that floats is a rectangle. */}
          {[-1, 1].map(k => (
            <mesh key={k} position={[k * 1.15, 0.20, 0]}>
              <cylinderGeometry args={[0.012, 0.012, 0.40, 6]} />
              <meshStandardMaterial color={P.steel} roughness={0.5} metalness={0.7} />
            </mesh>
          ))}
          <pointLight position={[0, -0.22, 0]} color={"#ffe6cc"}
            intensity={205} distance={17} decay={2} />
        </group>
      ))}
    </group>
  );
}

/* Where the fittings hang along a room's depth. One every 3.5 m or so, which
   for a 7.0 m room is two and for the 12.0 m entrance is three -- the same
   spacing, rather than the same count in a room nearly twice as long. */
function LAMPS(deep) {
  const n = Math.max(2, Math.round(deep / 3.6));
  const out = [];
  for (let i = 0; i < n; i++) out.push((i - (n - 1) / 2) * (deep / n));
  return out;
}

/* Racking, which was a stack of floating slabs.
 *
 * The archive and the stores each had four white shelves on two glowing
 * orange posts and nothing on any of them, which is a diagram of racking
 * rather than racking: no beams, no bracing, no base plates, no stock. Worse,
 * the posts carried an emissive term, so the bright pass turned a painted
 * upright into a neon tube and the two brightest objects in the room were the
 * legs of an empty shelf.
 *
 * Built the way the real thing is instead. Two upright frames per bay, braced
 * across their depth; a pair of beams per bay per level, hooked into the
 * uprights; a deck on the beams; and stock on most of the decks. Orange goes
 * on the beams and nowhere else, because that is the one part of a pallet
 * rack that is actually painted orange -- it is the member that fails if you
 * hit it with a truck.
 *
 * The frame is members, so the whole lot is three instanced draws plus one
 * for the stock, and the stock is placed from a fixed seed so a room does not
 * reshuffle itself between visits.
 */
const RACK_W = 1.9;                     // front to back, across the aisle
const RACK_BAY = 2.00;                  // upright to upright, along the room
const RACK_H = 3.2;
const LEVELS = [0.42, 1.20, 1.98, 2.76];

/* Mulberry32. Fixed seed, because a store that rearranges itself every time
   the page loads is a store nobody can describe to anybody else. */
function seeded(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function Racking({ side, bays, deep, seed = 0x2545F491 }) {
  const s = side || 1;
  const x = s * (WORK + 3.7);
  const rack = useMemo(() => {
    const frame = [], beams = [], decks = [], stock = [];
    const rnd = seeded(seed);
    /* Three 2.0 m bays is 6.0 m of rack in a 7.0 m room, so it starts
       half a metre off the return and finishes half a metre off the far
       end. Worth stating because the previous pitch ran the last frame
       1.35 m out through the back of the room, where nothing draws it and
       nothing complains. */
    const z0 = -deep / 2 + 0.5;
    const xa = x - RACK_W / 2, xb = x + RACK_W / 2;
    for (let b = 0; b <= bays; b++) {
      const z = z0 + b * RACK_BAY;
      // The two uprights of a frame, and the plate each one is bolted down
      // through -- a rack is anchored to the slab and the plate is the only
      // part of that you can see.
      for (const ux of [xa, xb]) {
        frame.push([ux, 0.02, z, ux, RACK_H, z, 0.09, 0.075]);
        frame.push([ux, 0.01, z, ux, 0.03, z, 0.22, 0.20]);
      }
      // Bracing across the depth of the frame, alternating, which is what
      // makes a rack stiff and what makes it read as fabricated.
      for (let l = 0; l < LEVELS.length; l++) {
        const y0 = l === 0 ? 0.1 : LEVELS[l - 1];
        const y1 = LEVELS[l];
        const up = l % 2 === 0;
        frame.push([up ? xa : xb, y0, z, up ? xb : xa, y1, z, 0.045, 0.045]);
        frame.push([xa, y1, z, xb, y1, z, 0.045, 0.045]);
      }
    }
    for (let b = 0; b < bays; b++) {
      const za = z0 + b * RACK_BAY, zb = za + RACK_BAY;
      for (const y of LEVELS) {
        for (const bx of [xa, xb]) beams.push([bx, y, za, bx, y, zb, 0.06, 0.13]);
        decks.push([x, y + 0.05, za + 0.06, x, y + 0.05, zb - 0.06, RACK_W - 0.1, 0.035]);
        // Stock. Not on every deck: a store with every position full is a
        // photograph of a warehouse and not a working one, and the gaps are
        // where the eye gets to see the frame it is stacked in.
        if (rnd() < 0.72) {
          const w = 0.5 + rnd() * 0.55, d = 0.5 + rnd() * 0.55, h = 0.28 + rnd() * 0.34;
          // Centred in the bay with whatever slack the load leaves, so a
          // deep pallet cannot hang through the upright behind it.
          const cz = za + RACK_BAY / 2 + (rnd() - 0.5) * Math.max(0, RACK_BAY - d - 0.5);
          stock.push({ p: [x + (rnd() - 0.5) * 0.3, y + 0.07 + h / 2, cz],
                       s: [w, h, d], r: (rnd() - 0.5) * 0.22,
                       c: rnd() < 0.22 ? P.hazard : (rnd() < 0.5 ? P.steel : "#4a453e") });
        }
      }
    }
    return { frame, beams, decks, stock };
  }, [x, bays, deep, seed]);

  return (
    <group>
      <Members list={rack.frame} colour={P.steel} castShadow receiveShadow />
      {/* The beams are the one part of a rack that is really painted orange,
          and a duller orange than the guarding: the guarding is fresh paint
          on a rail somebody must not walk through, this is a beam that has
          been hit by pallets for years. It is also the practical fix for a
          member that clipped its red channel and bloomed into a tube. */}
      <Members list={rack.beams} colour={"#c2511a"} castShadow />
      <Members list={rack.decks} colour={P.steelDk} castShadow receiveShadow />
      <Instances limit={Math.max(1, rack.stock.length)} castShadow receiveShadow>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial roughness={0.9} metalness={0.05} />
        {rack.stock.map((k, i) => (
          <Instance key={i} position={k.p} scale={k.s} rotation-y={k.r} color={k.c} />
        ))}
      </Instances>
    </group>
  );
}

/* Metrology: a bridge coordinate measuring machine on a granite plate.
 *
 * It was a plate, a post and a horizontal bar, which is a stand with an arm
 * on it and reads as a coat rack from the aisle. A measuring room is built
 * around one object and that object has a shape everybody recognises: a
 * lapped granite table with a portal straddling it, a carriage across the
 * portal and a quill dropping out of the carriage. Four moving parts in a
 * frame, and the frame is the whole silhouette.
 *
 * The plate stays what it was and is still the only near-specular surface in
 * the building -- granite lapped to a few microns is what "measured" looks
 * like as an object, and it is the reason this room is the one place a
 * reflection is allowed.
 */
function Metrology({ side }) {
  const s = side || -1;
  const x = s * WORK;
  const z = 0.4;
  // Where the portal stands along the plate, and where the carriage sits on
  // it. Parked off centre in both, because a machine parked exactly in the
  // middle of its own travel is a machine nobody has used.
  const bz = z - 0.35, cx = x + 0.28;
  const rig = useMemo(() => {
    const out = [];
    // The two legs of the portal, on the ways either side of the plate.
    for (const d of [-0.86, 0.86]) out.push([x + d, 1.02, bz, x + d, 2.02, bz, 0.17, 0.22]);
    // The beam across them, and the carriage riding it.
    out.push([x - 0.95, 2.10, bz, x + 0.95, 2.10, bz, 0.20, 0.26]);
    out.push([cx - 0.19, 2.10, bz, cx + 0.19, 2.10, bz, 0.30, 0.34]);
    // The quill, and the stylus on the end of it.
    out.push([cx, 1.42, bz, cx, 2.06, bz, 0.11, 0.11]);
    out.push([cx, 1.30, bz, cx, 1.42, bz, 0.035, 0.035]);
    // The ways the portal runs on, down the long edges of the plate.
    for (const d of [-0.86, 0.86]) out.push([x + d, 1.02, z - 1.1, x + d, 1.02, z + 1.1, 0.12, 0.06]);
    return out;
  }, [x, cx, bz, z]);
  return (
    <group>
      <mesh position={[x, 0.44, z]} castShadow receiveShadow>
        <boxGeometry args={[1.9, 0.88, 2.6]} />
        <meshStandardMaterial color={P.steelDk} roughness={0.8} metalness={0.3} />
      </mesh>
      <mesh position={[x, 0.94, z]} castShadow receiveShadow>
        <boxGeometry args={[2.02, 0.12, 2.72]} />
        <meshStandardMaterial color={"#26262b"} roughness={0.18} metalness={0.15} />
      </mesh>
      <Members list={rig} colour={P.machine} castShadow receiveShadow />
      {/* The gauge blocks and the ring standards on the plate, which are the
          only small objects in this building that are there to be measured
          rather than to do the measuring. */}
      {[[-0.55, -0.7, 0.1], [-0.42, -0.62, 0.16], [0.5, 0.85, 0.13]].map(([dx, dz, d], i) => (
        <mesh key={i} position={[x + dx, 1.0 + d / 2, z + dz]} castShadow>
          <cylinderGeometry args={[d * 0.6, d * 0.6, d, 14]} />
          <meshStandardMaterial color={P.steel} roughness={0.25} metalness={0.7} />
        </mesh>
      ))}
      {/* The controller, on castors, where it always is: beside the machine
          with its cable looped back to the bridge. */}
      <mesh position={[x - s * 1.55, 0.52, z + 1.5]} castShadow receiveShadow>
        <boxGeometry args={[0.62, 1.04, 0.5]} />
        <meshStandardMaterial color={"#2a2c30"} roughness={0.55} metalness={0.5} />
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
        <meshStandardMaterial color={P.steel} roughness={0.74} metalness={0.22} />
      </mesh>
      {crates.map(([z, h], i) => (
        <mesh key={i} position={[back - s * 0.75, h / 2, z]} castShadow receiveShadow>
          <boxGeometry args={[1.1, h, 1.0]} />
          <meshStandardMaterial color={i % 2 ? P.steel : P.steelDk}
            roughness={0.85} metalness={0.15} />
        </mesh>
      ))}
      <primitive object={aim} position={[back, 1.9, 0]} />
      {/* 80, not the 190 it was set at while the room lamps were four times
          too hot. A wash 3.2 m off a plate at decay 2 delivers intensity/10,
          so 190 put 19 on a surface a cell's task light reaches at 8.75 --
          the plate clipped, the bright pass found it, and five seasons of
          history read as a lightbox. */}
      <spotLight position={[back - s * 3.2, WALL_H - 0.2, 0]} target={aim}
        angle={0.7} penumbra={0.6} intensity={80} distance={14} decay={2}
        color={"#fff0dc"} />
    </group>
  );
}

/* The office at the end of the run, in the aisle rather than off it.
 *
 * The office is the one room with no hand of its own, so the dolly keeps the
 * lane there and looks straight down sixty-six metres at the end wall. A desk
 * parked in a side bay is a desk nobody sees; a counter in front of the door,
 * with the door lit from outside behind it, is the last shot in the building
 * and the one the contact panel sits beside.
 *
 * A counter rather than the desk it was. A desk is a table, and a table seen
 * end on from a lane is a dark bar -- which is exactly what it read as, in
 * front of an opening that took up half the frame. A counter has a face, a
 * top that oversails it and a return, so it has three surfaces at three
 * angles and it is the thing the reader is standing at rather than a piece of
 * furniture in the distance.
 */
function Reception() {
  const aim = useMemo(() => new THREE.Object3D(), []);
  /* Off the door and forward of it. The doorway is 3.4 m wide on the
     centreline and the counter used to sit at -0.9, so it stood across the
     one bright thing in the shot; and everything behind it was pushed into
     the 1.8 m left between the counter and the end wall, which put the
     pigeonholes 3.4 m from the reader's eye where a 2.5 m board fills two
     thirds of the frame. At -2.4 the counter clears the opening, and at
     z = -4.0 there is 3.2 m of room behind it to put the rest in. */
  const x = -2.4, z = -4.0;
  /* member() puts the section's first number on whichever axis the run is
     not, and which of the two ends up vertical depends on the direction --
     for a run down the lane the first is the x extent and the second is the
     height, and for a run across it they swap. Three members here were
     written with them the wrong way round, and the return came out 0.92 wide
     by 0.58 tall instead of the reverse: a wedge sticking into the aisle
     rather than the end of a counter. */
  const kit = useMemo(() => {
    const out = [];
    // Front face, return and plinth: the body of the counter.
    out.push([x - 1.5, 0.06, z, x + 1.5, 0.06, z, 0.12, 0.62]);
    out.push([x - 1.5, 0.58, z, x + 1.5, 0.58, z, 0.92, 0.58]);
    out.push([x + 1.5, 0.58, z, x + 1.5, 0.58, z - 1.5, 0.58, 0.92]);
    // The top, oversailing the face, which is the one line of this that
    // catches the light from the doorway behind it.
    out.push([x - 1.62, 1.07, z + 0.09, x + 1.62, 1.07, z + 0.09, 0.06, 0.76]);
    out.push([x + 1.59, 1.07, z + 0.09, x + 1.59, 1.07, z - 1.6, 0.76, 0.06]);
    return out;
  }, [x, z]);
  const boards = useMemo(() => {
    const out = [];
    /* A rack of pigeonholes behind the counter -- further down the lane, not
       nearer, which is the sign this had wrong. Twelve holes on a 1.6 m
       carcass: the one object that says post room without needing a label,
       and small enough that at 6 m it is a detail rather than a wall. */
    const bz = z - 1.9, w = 0.8;
    for (let c = 0; c <= 4; c++)
      out.push([x - w + c * (w / 2), 1.35, bz, x - w + c * (w / 2), 2.15, bz, 0.03, 0.30]);
    for (let r = 0; r <= 3; r++)
      out.push([x - w, 1.35 + r * 0.267, bz, x + w, 1.35 + r * 0.267, bz, 0.03, 0.30]);
    // The carcass back, and the stand it sits on.
    out.push([x, 1.75, bz - 0.16, x, 1.75, bz - 0.161, 1.62, 0.82]);
    out.push([x, 0.02, bz, x, 1.35, bz, 1.62, 0.34]);
    return out;
  }, [x, z]);
  return (
    <group>
      <Members list={kit} colour={P.steel} castShadow receiveShadow />
      <Members list={boards} colour={P.steelDk} castShadow receiveShadow />
      {/* The chair behind it, because a counter with nobody's chair behind
          it is a barrier. */}
      <mesh position={[x + 0.4, 0.24, z - 0.9]} castShadow receiveShadow>
        <boxGeometry args={[0.46, 0.08, 0.46]} />
        <meshStandardMaterial color={P.steelDk} roughness={0.85} metalness={0.1} />
      </mesh>
      <mesh position={[x + 0.4, 0.12, z - 0.9]} castShadow>
        <cylinderGeometry args={[0.05, 0.05, 0.24, 8]} />
        <meshStandardMaterial color={P.steel} roughness={0.5} metalness={0.6} />
      </mesh>
      <primitive object={aim} position={[x, 0.9, z]} />
      <spotLight position={[x + 0.6, WALL_H + 0.9, z + 2.2]} target={aim}
        angle={0.62} penumbra={0.45} intensity={130} distance={13} decay={2}
        color={"#ffe6cc"} castShadow />
    </group>
  );
}

/* One instanced mesh, filled from a list of member tuples. The pattern is
   lab/Structure.jsx's; it is here as a local because several of them are
   needed and none is worth a file. */
function Members({ list, colour, emissive = 0, ...rest }) {
  const ref = useRef();
  const geo = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  useEffect(() => {
    const inst = ref.current;
    if (!inst) return;
    const m = new THREE.Matrix4();
    list.forEach((p, i) => inst.setMatrixAt(i, member(m, p[0], p[1], p[2], p[3], p[4], p[5], p[6], p[7])));
    inst.count = list.length;
    inst.instanceMatrix.needsUpdate = true;
    inst.computeBoundingSphere();
  }, [list]);
  return (
    <instancedMesh ref={ref} args={[geo, undefined, Math.max(1, list.length)]} {...rest}>
      <meshStandardMaterial color={colour} roughness={0.72} metalness={0.35}
        emissive={emissive ? colour : "#000000"} emissiveIntensity={emissive} />
    </instancedMesh>
  );
}

export default function Rooms() {
  /* Every room's return wall, in world coordinates, so the whole building's
     partition framing is two draw calls rather than two per room. */
  const [steel, panel, paint] = useMemo(() => {
    const a = [], c = [], b = [];
    for (const r of ROOMS) {
      const s = r.side === 0 ? 1 : r.side;
      partition(a, c, b, s * WORK, -r.at * PITCH - roomDeep(r) / 2, BAY_D, 0);
    }
    return [a, c, b];
  }, []);

  return (
    <group>
      <Members list={steel} colour={P.steel} castShadow receiveShadow />
      <Members list={panel} colour={P.steelDk} castShadow receiveShadow />
      <Members list={paint} colour={P.hazard} emissive={0.08} castShadow />
      {ROOMS.map(r => {
        const z = -r.at * PITCH;
        const side = r.side === 0 ? 1 : r.side;
        const deep = roomDeep(r);
        return (
          <group key={r.id} position={[0, 0, z]}>
            <Shell side={side} deep={deep} centre={r.side === 0} />
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
