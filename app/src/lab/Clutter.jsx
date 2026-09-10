import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { member } from "./steel.js";
import { P } from "../lib/palette.js";
import { AISLE, BAY_D, PITCH, RUN, STOPS } from "../lib/plan.js";

/* Everything a facility owns that is not steel, a machine or paint: the
 * stillage cages, drums, pallet stacks, cable reels, crate stacks and gas
 * bottles that pile up in whatever gap a working building leaves for them.
 *
 * The rest of this place sits on the 7.2 m structural grid because that is
 * how a portal-frame shed is actually built. Nothing a person carries in
 * ever lands on that grid, though, and a building where it does reads as a
 * floor plan rather than a place -- which was the owner's own complaint.
 * So every item here is placed off the pitch on purpose: never a multiple
 * of PITCH, always a random turn on top, clusters left to butt up against
 * each other the way stock actually accumulates rather than spaced out for
 * a photograph.
 *
 * Two rules matter more than any dimension in this file.
 *
 * The aisle stays clear. The camera runs the lane at x = 0, and anything
 * standing in it does not read as clutter, it reads as a collision -- so
 * nothing here is allowed within AISLE/2 + 0.9 m of the centreline, on
 * either side, for the whole run.
 *
 * A bay mouth stays clear for the full depth of the bay behind it, not just
 * the opening. Whatever a stop puts there -- a rig's bench, a room's shell
 * and racking -- is the one thing that stop exists to show, seen from the
 * aisle looking straight into the bay, and a drum parked in that sightline
 * is in every photograph the cell was built for. So for every stop with a
 * hand, the 3.6 m either side of that stop's z -- 7.2 m of floor, the width
 * of one structural bay -- stays empty out to the back wall, on that stop's
 * own side. Stops at side 0 (entry, contact) get this too, defaulted to
 * +1: the plan lists their side as 0 but halls/Rooms.jsx builds their shell
 * on the +1 side regardless, and this follows the geometry that is actually
 * there rather than the field that describes it.
 *
 * Positions come from a seeded PRNG, never Math.random(), for the same
 * reason as the rest of the building's procedural content: the facility has
 * to look the same on every load. Everything below is instanced -- one
 * mesh per kind of object, built once from member() or a plain turn-and-
 * scale transform -- so the whole scatter costs a handful of draw calls
 * rather than one per item.
 */

// ---- the placement rule ------------------------------------------------

const AISLE_CLEAR = AISLE / 2 + 0.9;          // 4.1 -- nothing occupies inside this
const MOUTH_HALF = 3.6;                        // half the excluded band at a bay mouth
const BAY_BACK = AISLE / 2 + BAY_D;            // 10.8 -- the real back wall
const ZONE_LO = AISLE / 2 + 4.5;               // 7.7 -- where the back half of a bay starts
const ZONE_HI = BAY_BACK - 0.4;                // 10.4 -- clear of the back wall
const Z_MIN = -RUN, Z_MAX = 0;                 // the populated length of the aisle
const YAW_SPAN = 0.7;                          // +/- 0.35 rad of random turn

// Every stop with a hand gets a dead zone on its own side; stops at side 0
// (entry, contact) still get one, defaulted to +1, because halls/Rooms.jsx
// builds their shell on that side regardless of what the plan calls their
// side -- see the file header for why this follows the geometry and not
// the field.
const MOUTHS = STOPS.map(s => ({ side: s.side === 0 ? 1 : s.side, z: -s.at * PITCH }));

// Mulberry32, the same construction lab/ReachRig.jsx uses, so a second
// procedural system in this building does not invent a second generator.
function seeded(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The two rules from the header, plus one more that is not one of them:
// never lean on the real back wall, which sits 0.4 m past ZONE_HI and is
// solid geometry regardless of what the brief asked this file to check.
function fits(x, z, r) {
  if (Math.abs(x) - r < AISLE_CLEAR) return false;
  if (Math.abs(x) + r > BAY_BACK - 0.15) return false;
  const side = Math.sign(x);
  for (let i = 0; i < MOUTHS.length; i++) {
    const m = MOUTHS[i];
    if (m.side === side && Math.abs(z - m.z) - r < MOUTH_HALF) return false;
  }
  return true;
}

// A candidate seat for an item with footprint radius r, biased to the back
// half of a bay where nothing else in the building stands. The retry loop
// is cheap insurance: rejecting against two thin exclusion bands over a
// 66 m run essentially never needs more than a handful of tries.
function pick(rand, r) {
  for (let t = 0; t < 60; t++) {
    const side = rand() < 0.5 ? -1 : 1;
    const z = Z_MIN + rand() * (Z_MAX - Z_MIN);
    const back = rand() < 0.78;
    const lo = back ? ZONE_LO : AISLE_CLEAR + 0.25;
    const hi = back ? Math.max(lo, ZONE_HI - r) : ZONE_LO;
    const x = side * (lo + rand() * Math.max(0.05, hi - lo));
    if (fits(x, z, r)) return { x, z };
  }
  return null;
}

// Rotate a local offset from an item's own anchor by its yaw. A cage's four
// posts or a rack's frame are authored in their own local frame and turned
// once here, so the whole object yaws as one rigid thing rather than each
// post separately deciding where it is.
function corner(cx, cz, yaw, x0, z0) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return [x0 + cx * c - cz * s, z0 + cx * s + cz * c];
}

// member() cannot turn a flat footprint: it derives its rotation from the
// direction between two points, and a slab's two "ends" are the same point
// stacked in y, which has no horizontal component to turn at all. A pallet
// needs its footprint rotated, not just its position moved, so this builds
// the matrix from the yaw directly instead of inferring it from nothing.
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
function sit(out, x, y, z, yaw, sx, sy, sz) {
  _p.set(x, y, z);
  _q.setFromAxisAngle(_up, yaw);
  _s.set(sx, sy, sz);
  return out.compose(_p, _q, _s);
}

// ---- dimensions, all real enough to build the exclusion radii from ----

const CAGE_R = 0.85, PALLET_R = 0.85, TOTE_R = 0.45, RACK_R = 0.58;
const DRUM_D = 0.58, DRUM_H = 0.88, DRUM_R = 0.32, DRUM_LIE_R = 0.58;
const HOOP_D = DRUM_D + 0.035, HOOP_H = 0.05;

const SLAB_H = 0.15, PALLET_L = 1.2, PALLET_W = 1.0;
const CAGE_H = 0.95, POST = 0.035, RAIL = 0.03;
const CAGE_CORNERS = [[0.52, 0.42], [-0.52, 0.42], [0.52, -0.42], [-0.52, -0.42]];

const TOTE_L = 0.6, TOTE_W = 0.4, TOTE_H = 0.32;

const RACK_H = 0.45, BOTTLE_D = 0.22;
const RACK_CORNERS = [[0.45, 0.22], [-0.45, 0.22], [0.45, -0.22], [-0.45, -0.22]];

const HUB_D = 0.22, DISC_T = 0.08;

const SEED = 0xA53F921D;
const CAGE_N = 11, DRUM_N = 7, PALLET_N = 10, REEL_N = 7, TOTE_N = 9, RACK_N = 5;
const CLUSTER_TRIES = 30;

// ---- layout: pure and deterministic, nothing here touches THREE -------

function layout() {
  const rand = seeded(SEED);

  const cages = [];
  for (let i = 0; i < CAGE_N; i++) {
    const spot = pick(rand, CAGE_R);
    if (!spot) continue;
    cages.push({
      x: spot.x, z: spot.z,
      yaw: (rand() - 0.5) * YAW_SPAN,
      layers: rand() < 0.28 ? 2 : 1,
      rails: rand() < 0.5 ? 2 : 3
    });
  }

  // Rows drift rather than march in a straight line -- two drums touching
  // and a third one skewed is the effect the brief asked for, and a row
  // that never turns is just the grid again with rounder members.
  const drums = [];
  for (let i = 0; i < DRUM_N; i++) {
    // The first two clusters are lying outright rather than left to a coin
    // toss -- "some on their side" is one of the shapes the brief asked
    // for, and a seed that happens to roll every cluster upright would
    // silently drop it rather than merely being unlucky.
    const lying = i < 2 ? true : rand() < 0.3;
    const n = lying ? (rand() < 0.4 ? 2 : 1) : 2 + Math.floor(rand() * 3);
    const r = lying ? DRUM_LIE_R : DRUM_R;
    const step = lying ? DRUM_H : DRUM_D;
    for (let attempt = 0; attempt < CLUSTER_TRIES; attempt++) {
      const spot = pick(rand, r + (n - 1) * step);
      if (!spot) continue;
      let dir = rand() * Math.PI * 2;
      let x = spot.x, z = spot.z, ok = true;
      const row = [];
      for (let k = 0; k < n; k++) {
        if (k > 0) {
          dir += (rand() - 0.5) * 0.5;
          x += Math.cos(dir) * step;
          z += Math.sin(dir) * step;
        }
        if (!fits(x, z, r)) { ok = false; break; }
        const cv = rand();
        /* No teal. lib/palette.js keeps it as the second categorical --
           it is what a plot series is drawn in, here and on the document
           site -- and spending it on a drum quietly costs the reader the
           one non-orange colour that is supposed to mean something. Olive
           is what a drum of anything is actually painted. */
        const colour = cv < 0.5 ? "steel" : cv < 0.72 ? "hazard" : cv < 0.87 ? "machine" : "olive";
        row.push({ x, z, r, lying, heading: dir, colour });
      }
      if (ok) { drums.push(...row); break; }
    }
  }

  const pallets = [];
  for (let i = 0; i < PALLET_N; i++) {
    const spot = pick(rand, PALLET_R);
    if (!spot) continue;
    pallets.push({
      x: spot.x, z: spot.z,
      yaw: (rand() - 0.5) * YAW_SPAN,
      height: 0.6 + rand() * 1.0,
      wrap: rand() < 0.2 ? "hazard" : "machine"
    });
  }

  // The reel's own radius is derived from the two dimensions that actually
  // vary (disc size, hub length) rather than a guessed constant -- Pythagoras
  // on the disc reaching out from the hub's end, which is the true worst
  // point of the shape and not an eyeballed margin around it.
  const reels = [];
  for (let i = 0; i < REEL_N; i++) {
    const discR = 0.55 + rand() * 0.15;
    const hubLen = 0.5 + rand() * 0.25;
    const r = Math.hypot(discR, hubLen / 2 + 0.06);
    const spot = pick(rand, r);
    if (!spot) continue;
    reels.push({
      x: spot.x, z: spot.z,
      discR, hubLen,
      dirAngle: (rand() - 0.5) * 0.35,
      lean: rand() < 0.4 ? 0.06 + rand() * 0.16 : 0
    });
  }

  const totes = [];
  for (let i = 0; i < TOTE_N; i++) {
    const spot = pick(rand, TOTE_R);
    if (!spot) continue;
    const yaw = (rand() - 0.5) * YAW_SPAN;
    const n = rand() < 0.5 ? 3 : 4;
    const layers = [];
    for (let k = 0; k < n; k++) {
      layers.push({
        dx: (rand() - 0.5) * 0.05,
        dz: (rand() - 0.5) * 0.05,
        yaw: yaw + (rand() - 0.5) * 0.3,
        colour: rand() < 0.5 ? "hazard" : "steel"
      });
    }
    totes.push({ x: spot.x, z: spot.z, layers });
  }

  const racks = [];
  for (let i = 0; i < RACK_N; i++) {
    const spot = pick(rand, RACK_R);
    if (!spot) continue;
    const bottles = rand() < 0.5 ? 4 : 5;
    racks.push({
      x: spot.x, z: spot.z,
      yaw: (rand() - 0.5) * YAW_SPAN,
      bottles,
      heights: Array.from({ length: bottles }, () => 1.35 + rand() * 0.15)
    });
  }

  return { cages, drums, pallets, reels, totes, racks };
}

// ---- render: instanced, a handful of draw calls for the whole scatter --

const COL = {
  steel: new THREE.Color(P.steel),
  steelDk: new THREE.Color(P.steelDk),
  hazard: new THREE.Color(P.hazard),
  /* Not P.machine. That token is the arm's own shell -- a light neutral at
     0.60 in linear -- and on a crate under a cell lamp it clips to white and
     takes the eye off the robot it is standing behind. A pale crate is a
     pale crate, not the brightest matter in the room. */
  machine: new THREE.Color("#8d9099"),
  olive: new THREE.Color("#4a4a34")
};

// Shared by every pool below: a part is either a flat box turned by sit()
// or a two-point member, and it may carry its own instance colour or leave
// the mesh's material colour alone -- cages and the gas-rack frame do the
// latter, everything mixing hazard/steel/machine does not.
function fill(inst, parts) {
  if (!inst) return;
  const m = new THREE.Matrix4();
  parts.forEach((part, i) => {
    if (part.box) sit(m, ...part.box); else member(m, ...part.mem);
    inst.setMatrixAt(i, m);
    if (part.col) inst.setColorAt(i, part.col);
  });
  inst.count = parts.length;
  inst.instanceMatrix.needsUpdate = true;
  if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
  inst.computeBoundingSphere();
}

export default function Clutter() {
  const data = useMemo(() => layout(), []);

  const boxGeo = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const cylGeo = useMemo(() => new THREE.CylinderGeometry(0.5, 0.5, 1, 8), []);

  const cageRef = useRef();
  const rackRef = useRef();
  const drumRef = useRef();
  const reelRef = useRef();
  const bottleRef = useRef();
  const palletRef = useRef();
  const toteRef = useRef();

  // Stillage cages: a pallet slab plus a four-post cage with two or three
  // rails, stacked one or two high in places. The slab is a sit() box, the
  // cage is all member() -- square-section posts and rails so the yaw
  // above can never twist a cross-section into looking wrong.
  const cageParts = useMemo(() => {
    const list = [];
    for (const cg of data.cages) {
      for (let L = 0; L < cg.layers; L++) {
        const base = L * (SLAB_H + CAGE_H);
        list.push({ box: [cg.x, base + SLAB_H / 2, cg.z, cg.yaw, PALLET_L, SLAB_H, PALLET_W] });
        const y0 = base + SLAB_H, y1 = y0 + CAGE_H;
        const [fr, fl, br, bl] = CAGE_CORNERS.map(([cx, cz]) => corner(cx, cz, cg.yaw, cg.x, cg.z));
        for (const [wx, wz] of [fr, fl, br, bl])
          list.push({ mem: [wx, y0, wz, wx, y1, wz, POST, POST] });
        list.push({ mem: [fr[0], y1 - 0.06, fr[1], fl[0], y1 - 0.06, fl[1], RAIL, RAIL] });
        list.push({ mem: [br[0], y1 - 0.06, br[1], bl[0], y1 - 0.06, bl[1], RAIL, RAIL] });
        if (cg.rails === 3)
          list.push({ mem: [fr[0], (y0 + y1) / 2, fr[1], fl[0], (y0 + y1) / 2, fl[1], RAIL, RAIL] });
      }
    }
    return list;
  }, [data]);

  // Gas bottle rack frame: the same square-section member() as the cages,
  // kept as its own pool because it is a different object in the count
  // even though it is built from the same primitive.
  const rackParts = useMemo(() => {
    const list = [];
    for (const rk of data.racks) {
      const [fr, fl, br, bl] = RACK_CORNERS.map(([cx, cz]) => corner(cx, cz, rk.yaw, rk.x, rk.z));
      for (const [wx, wz] of [fr, fl, br, bl])
        list.push({ mem: [wx, 0, wz, wx, RACK_H, wz, POST, POST] });
      list.push({ mem: [fr[0], RACK_H - 0.05, fr[1], fl[0], RACK_H - 0.05, fl[1], RAIL, RAIL] });
      list.push({ mem: [br[0], RACK_H - 0.05, br[1], bl[0], RACK_H - 0.05, bl[1], RAIL, RAIL] });
    }
    return list;
  }, [data]);

  // Drums: upright with two hoops, or lying on the row's own heading. A
  // circular cross-section does not care which way member() twists it, so
  // this is the one shape in the file that never needed sit() at all.
  const drumParts = useMemo(() => {
    const list = [];
    for (const d of data.drums) {
      const col = COL[d.colour];
      if (d.lying) {
        const hx = Math.cos(d.heading) * DRUM_H / 2, hz = Math.sin(d.heading) * DRUM_H / 2;
        list.push({ mem: [d.x - hx, DRUM_D / 2, d.z - hz, d.x + hx, DRUM_D / 2, d.z + hz, DRUM_D, DRUM_D], col });
      } else {
        list.push({ mem: [d.x, 0, d.z, d.x, DRUM_H, d.z, DRUM_D, DRUM_D], col });
        for (const f of [0.22, 0.62])
          list.push({ mem: [d.x, DRUM_H * f, d.z, d.x, DRUM_H * f + HOOP_H, d.z, HOOP_D, HOOP_D], col: COL.steelDk });
      }
    }
    return list;
  }, [data]);

  // Cable reels: a hub and two discs sharing one axle, standing on edge and
  // leaning where lean is set. The axle runs mostly along z, parallel to
  // the wall a reel like this would actually be stood against.
  const reelParts = useMemo(() => {
    const list = [];
    for (const rl of data.reels) {
      const dx = Math.sin(rl.dirAngle), dz = Math.cos(rl.dirAngle);
      const half = rl.hubLen / 2;
      const ax = rl.x - dx * half, az = rl.z - dz * half, ay = rl.discR;
      const bx = rl.x + dx * half, bz = rl.z + dz * half, by = rl.discR + rl.lean;
      list.push({ mem: [ax, ay, az, bx, by, bz, HUB_D, HUB_D], col: COL.machine });
      const ex = dx * (DISC_T / 2), ez = dz * (DISC_T / 2);
      list.push({ mem: [ax - ex, ay, az - ez, ax + ex, ay, az + ez, rl.discR * 2, rl.discR * 2], col: COL.steel });
      list.push({ mem: [bx - ex, by, bz - ez, bx + ex, by, bz + ez, rl.discR * 2, rl.discR * 2], col: COL.steel });
    }
    return list;
  }, [data]);

  // Gas bottles: tall thin cylinders spaced across the rack's own footprint,
  // narrower than the frame's posts so nothing pokes past them.
  const bottleParts = useMemo(() => {
    const list = [];
    for (const rk of data.racks) {
      const c = Math.cos(rk.yaw), s = Math.sin(rk.yaw);
      for (let k = 0; k < rk.bottles; k++) {
        const lx = rk.bottles > 1 ? -0.30 + (0.60 * k) / (rk.bottles - 1) : 0;
        const wx = rk.x + lx * c, wz = rk.z + lx * s;
        const h = rk.heights[k];
        list.push({ mem: [wx, 0.05, wz, wx, 0.05 + h, wz, BOTTLE_D, BOTTLE_D], col: COL.machine });
      }
    }
    return list;
  }, [data]);

  // Pallet stacks: a slab and a shrink-wrapped block of varying height,
  // both sit() boxes since a stack's footprint has to turn with it.
  const palletParts = useMemo(() => {
    const list = [];
    for (const pl of data.pallets) {
      list.push({ box: [pl.x, SLAB_H / 2, pl.z, pl.yaw, PALLET_L, SLAB_H, PALLET_W], col: COL.steel });
      list.push({
        box: [pl.x, SLAB_H + pl.height / 2, pl.z, pl.yaw, PALLET_L * 0.9, pl.height, PALLET_W * 0.85],
        col: COL[pl.wrap]
      });
    }
    return list;
  }, [data]);

  // Tote stacks: three or four boxes, each with its own small yaw on top of
  // the stack's, in the hazard colour and the steel colour mixed.
  const toteParts = useMemo(() => {
    const list = [];
    for (const tt of data.totes) {
      tt.layers.forEach((ly, k) => {
        list.push({
          box: [tt.x + ly.dx, k * TOTE_H * 0.94 + TOTE_H * 0.47, tt.z + ly.dz, ly.yaw, TOTE_L, TOTE_H * 0.9, TOTE_W],
          col: COL[ly.colour]
        });
      });
    }
    return list;
  }, [data]);

  useEffect(() => fill(cageRef.current, cageParts), [cageParts]);
  useEffect(() => fill(rackRef.current, rackParts), [rackParts]);
  useEffect(() => fill(drumRef.current, drumParts), [drumParts]);
  useEffect(() => fill(reelRef.current, reelParts), [reelParts]);
  useEffect(() => fill(bottleRef.current, bottleParts), [bottleParts]);
  useEffect(() => fill(palletRef.current, palletParts), [palletParts]);
  useEffect(() => fill(toteRef.current, toteParts), [toteParts]);

  return (
    <group>
      <instancedMesh ref={cageRef} args={[boxGeo, undefined, Math.max(1, cageParts.length)]} castShadow receiveShadow>
        <meshStandardMaterial color={P.steel} roughness={0.78} metalness={0.32} />
      </instancedMesh>
      <instancedMesh ref={rackRef} args={[boxGeo, undefined, Math.max(1, rackParts.length)]} castShadow receiveShadow>
        <meshStandardMaterial color={P.steel} roughness={0.7} metalness={0.4} />
      </instancedMesh>
      <instancedMesh ref={drumRef} args={[cylGeo, undefined, Math.max(1, drumParts.length)]} castShadow receiveShadow>
        <meshStandardMaterial roughness={0.55} metalness={0.35} />
      </instancedMesh>
      <instancedMesh ref={reelRef} args={[cylGeo, undefined, Math.max(1, reelParts.length)]} castShadow receiveShadow>
        <meshStandardMaterial roughness={0.6} metalness={0.4} />
      </instancedMesh>
      <instancedMesh ref={bottleRef} args={[cylGeo, undefined, Math.max(1, bottleParts.length)]} castShadow receiveShadow>
        <meshStandardMaterial roughness={0.45} metalness={0.5} />
      </instancedMesh>
      <instancedMesh ref={palletRef} args={[boxGeo, undefined, Math.max(1, palletParts.length)]} castShadow receiveShadow>
        <meshStandardMaterial roughness={0.85} metalness={0.1} />
      </instancedMesh>
      <instancedMesh ref={toteRef} args={[boxGeo, undefined, Math.max(1, toteParts.length)]} castShadow receiveShadow>
        <meshStandardMaterial roughness={0.7} metalness={0.2} />
      </instancedMesh>
    </group>
  );
}
