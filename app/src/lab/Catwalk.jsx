import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { member } from "./steel.js";
import { P } from "../lib/palette.js";
import { EAVES } from "../lib/plan.js";

/* Access steel at high level: a walkway down one flank, a bridge across the
 * lane and a caged ladder up to both.
 *
 * The building had one occupied plane. Everything a reader could see stood on
 * the slab, everything above 3.4 m was truss, and the four metres between
 * them were empty in every shot -- which is why a frame with a room in it was
 * a third furniture and two thirds black. A section with one level in it
 * reads as a corridor however long you make it; a section with two reads as a
 * building, and the second level is the cheapest one to add because nobody
 * has to walk on it.
 *
 * Hung from the truss rather than standing on legs, and that is a
 * constraint rather than a style. The bays and rooms alternate down the run
 * at roughly three quarters of a structural bay, so there is no z anywhere in
 * sixty-six metres where both sides of the lane are 3.4 m clear of a mouth --
 * a walkway on posts would have to put a column in front of somebody's robot.
 * Hangers off the bottom chord land on nothing and are what a services
 * walkway is really carried on.
 *
 * All of it is members: see lab/steel.js. Two instanced draws, one painted
 * steel and one hazard orange for the toe plates and the ladder cage, both
 * including the shadow pass.
 */
const DECK = 5.40;                  // walking surface
const HALF = 0.60;                  // walkway half width
const RAIL = 1.10;                  // top rail above the deck
const CW_X = 8.0;                   // the flank the main run is on
const CW_Z0 = -14.0, CW_Z1 = -52.0;
const BR_Z = -30.0;                 // where it crosses the lane
const SPUR = 3.2;                   // how far the far-side landing runs each way
const LAD_Z = -25.6;                // the way up

/* member() takes the two ends and a section, and which of the two section
   numbers is the vertical one depends on which way the member runs -- the
   rotation that takes the unit box's +y onto the run carries its x or its z
   into the vertical with it. Rather than reason about that at three hundred
   call sites, these two say it once each. */
function alongZ(out, x, y, z0, z1, wx, hy) {
  out.push([x, y, z0, x, y, z1, wx, hy]);
}
function alongX(out, y, z, x0, x1, hy, wz) {
  out.push([x0, y, z, x1, y, z, hy, wz]);
}
function post(out, x, z, y0, y1, a, b) {
  out.push([x, y0, z, x, y1, z, a, b]);
}

/* One straight length of walkway running along z. Deck, two edge beams, a
   cross bearer every 1.2 m, hangers to the chord, and the handrail. */
function walkZ(steel, paint, x, z0, z1) {
  const len = Math.abs(z1 - z0);
  alongZ(steel, x, DECK - 0.03, z0, z1, HALF * 2, 0.06);
  for (const e of [-HALF, HALF]) {
    alongZ(steel, x + e, DECK - 0.20, z0, z1, 0.13, 0.32);
    // Handrail, and the mid rail that makes it a handrail rather than a wire.
    alongZ(steel, x + e, DECK + RAIL, z0, z1, 0.05, 0.05);
    alongZ(steel, x + e, DECK + RAIL * 0.5, z0, z1, 0.045, 0.045);
    alongZ(paint, x + e, DECK + 0.07, z0, z1, 0.022, 0.13);
  }
  const n = Math.max(1, Math.round(len / 1.2));
  for (let i = 0; i <= n; i++) {
    const z = z0 + ((z1 - z0) * i) / n;
    alongX(steel, DECK - 0.12, z, x - HALF, x + HALF, 0.14, 0.07);
    // Stanchions on every other bearer, which is the 2.4 m a handrail
    // actually gets, and hangers on every fourth.
    if (i % 2 === 0) for (const e of [-HALF, HALF]) post(steel, x + e, z, DECK, DECK + RAIL + 0.03, 0.055, 0.055);
    if (i % 4 === 0) {
      for (const e of [-HALF, HALF]) post(steel, x + e, z, DECK - 0.04, EAVES, 0.05, 0.05);
      // Sway brace: a hung walkway swings along its length without one, and
      // the diagonal is the only thing up here that is not vertical or level.
      steel.push([x - HALF, EAVES - 0.1, z, x + HALF, DECK + 0.1, z + 1.2, 0.04, 0.04]);
    }
  }
}

/* The same thing running the other way, for the crossing. */
function walkX(steel, paint, z, x0, x1) {
  const len = Math.abs(x1 - x0);
  alongX(steel, DECK - 0.03, z, x0, x1, 0.06, HALF * 2);
  for (const e of [-HALF, HALF]) {
    alongX(steel, DECK - 0.20, z + e, x0, x1, 0.32, 0.13);
    alongX(steel, DECK + RAIL, z + e, x0, x1, 0.05, 0.05);
    alongX(steel, DECK + RAIL * 0.5, z + e, x0, x1, 0.045, 0.045);
    alongX(paint, DECK + 0.07, z + e, x0, x1, 0.13, 0.022);
  }
  const n = Math.max(1, Math.round(len / 1.2));
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n;
    alongZ(steel, x, DECK - 0.12, z - HALF, z + HALF, 0.07, 0.14);
    if (i % 2 === 0) for (const e of [-HALF, HALF]) post(steel, x, z + e, DECK, DECK + RAIL + 0.03, 0.055, 0.055);
    if (i % 3 === 0) for (const e of [-HALF, HALF]) post(steel, x, z + e, DECK - 0.04, EAVES, 0.05, 0.05);
  }
}

/* A caged ladder, which is what the regulations turn a ladder over three
   metres into and which is a far better object than a ladder: seven hoops and
   five stringers make a translucent cylinder that reads from right across the
   building. */
function ladder(steel, paint, x, z) {
  const y0 = 0.1, y1 = DECK + 1.0;
  for (const e of [-0.24, 0.24]) post(steel, x + e, z, y0, y1, 0.05, 0.05);
  for (let y = y0 + 0.28; y < DECK; y += 0.28) alongX(steel, y, z, x - 0.24, x + 0.24, 0.035, 0.035);
  // The cage: hoops from 2.2 m up, and the vertical straps that tie them.
  const hoops = [];
  for (let y = 2.2; y < y1; y += 0.72) hoops.push(y);
  for (const y of hoops) {
    alongX(paint, y, z + 0.42, x - 0.42, x + 0.42, 0.04, 0.04);
    alongZ(paint, x - 0.42, y, z, z + 0.42, 0.04, 0.04);
    alongZ(paint, x + 0.42, y, z, z + 0.42, 0.04, 0.04);
  }
  for (const e of [-0.42, 0, 0.42])
    post(paint, x + e, z + (e === 0 ? 0.42 : 0.21), hoops[0], y1 - 0.2, 0.035, 0.035);
}

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
    <instancedMesh ref={ref} args={[geo, undefined, list.length]} {...rest}>
      <meshStandardMaterial color={colour} roughness={0.7} metalness={0.42}
        emissive={emissive ? colour : "#000000"} emissiveIntensity={emissive} />
    </instancedMesh>
  );
}

export default function Catwalk() {
  const [steel, paint] = useMemo(() => {
    const a = [], b = [];
    walkZ(a, b, CW_X, CW_Z0, CW_Z1);
    // The far-side landing is a stub rather than a second run: it exists so
    // the bridge goes somewhere, and a second full-length walkway would put
    // steel over every room on the other hand of the aisle as well.
    walkZ(a, b, -CW_X, BR_Z - SPUR, BR_Z + SPUR);
    walkX(a, b, BR_Z, -CW_X + HALF, CW_X - HALF);
    ladder(a, b, CW_X + HALF + 0.3, LAD_Z);
    return [a, b];
  }, []);

  return (
    <group>
      <Members list={steel} colour={P.steel} castShadow receiveShadow />
      <Members list={paint} colour={P.hazard} emissive={0.05} castShadow />
    </group>
  );
}
