import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { member } from "./steel.js";
import { P } from "../lib/palette.js";

/* The bench every test cell's machine stands on.
 *
 * It was one box, 2.6 by 0.9 by 3.0, repeated seven times down the aisle with
 * nothing on it to say it carries a load rather than having been extruded
 * from a primitive and left there. Of everything in the building this was the
 * plainest tell.
 *
 * A bench this size is a welded frame under a top: four legs on adjustable
 * feet, a rail tying the leg heads together under the worktop, a lower
 * stretcher carrying a shelf, and a diagonal in each end frame -- a frame
 * this tall and this narrow racks along its short axis and nothing else here
 * resists that. Built out of lab/steel.js's member(), so the twenty-one
 * lengths that make it read as fabricated cost the one draw call the
 * featureless box did.
 *
 * The one constraint everything here is shaped around: the top has to stay a
 * flat, continuous, opaque slab at exactly y = 0.9 across the full footprint,
 * and the volume above it has to stay clear. Every rig in the building lays
 * an occupancy grid, a terrain mesh or a driving robot on it at that height.
 * So the edge band that gives the top its highlight wraps the slab from
 * outside its own footprint rather than sitting on it, and the tool panel
 * stands off the back edge, on the side away from the aisle.
 *
 * Three draws for five colours. The frame is most of the geometry and gets
 * its own instanced mesh; the worktop is a plain mesh because it is one piece
 * and the surface everything else measures itself against; the rest -- edge
 * band, lower shelf, panel and its shelf -- rides in a second instanced mesh
 * against a white material with setColorAt doing the colour.
 */

// The footprint, and the one height every rig on the bench agrees with.
const BENCH_W = 2.6;
const BENCH_D = 3.0;
const TOP = 0.9;
const SLAB_T = 0.045;

// Inset from the corners, so the worktop overhangs its frame rather than
// something at the edge of it catching on a leg.
const INSET = 0.12;
const LEG_SEC = 0.08;
const LX = BENCH_W / 2 - INSET;
const LZ = BENCH_D / 2 - INSET;

// Adjustable feet: wider than the leg they carry, which is the detail that
// says the bench was levelled onto a floor rather than modelled floating.
const FOOT_H = 0.03;
const FOOT_SEC = 0.14;

// Underside of the worktop: where the legs stop and the perimeter rail sits.
const RAIL_SEC = 0.05;
const RAIL_TOP = TOP - SLAB_T;
const RAIL_Y = RAIL_TOP - RAIL_SEC / 2;

// The lower stretcher, low enough to clear a knee, and the shelf it carries.
const STRETCH_Y = 0.18;
const SHELF_T = 0.018;
const SHELF_Y = STRETCH_Y + RAIL_SEC / 2 + SHELF_T / 2;
const SHELF_HALF_X = LX + RAIL_SEC / 2;
const SHELF_HALF_Z = LZ + RAIL_SEC / 2;

// One diagonal per end frame. The long sides are already tied front to back
// by the rail and the stretcher, so end to end is what is left to resist --
// the same argument lab/Structure.jsx's longitudinal bracing is there for.
const BRACE_SEC = 0.04;

// The slab, and the band wrapped round it from outside so the proud lip that
// catches the highlight is never above the working surface, only beside it.
const SLAB_CY = TOP - SLAB_T / 2;
const BAND_W = 0.05;
const BAND_PROUD = 0.016;
const BAND_BOT = RAIL_TOP;
const BAND_TOP = TOP + BAND_PROUD;
const BAND_CY = (BAND_TOP + BAND_BOT) / 2;
const BAND_H = BAND_TOP - BAND_BOT;

/* The worktop, and the edge band round it.
 *
 * Both were picked as sRGB midpoints between the frame and machine grey --
 * 82858b and c9ccd4 -- which is the right instinct about a bench and the
 * wrong arithmetic about this room. The cell task lamp delivers about 8.75
 * at the bench, so what reaches the tone curve is albedo times 8.75 times
 * the 1.30 exposure, and anything above roughly 0.06 in linear clips. 82858b
 * is 0.235. Measured on the reach bay, the top came back at a mean of 251 of
 * 255 and the band at 253: a white table with a white rim under a white arm.
 *
 * 494c52 was the first correction and it came back at 200, which is still
 * the largest bright area in a cell and still competing with a machine-grey
 * arm standing on it. The tone curve compresses hard up there -- dropping
 * the lamp instead moves 200 to about 194 -- so the fix has to be albedo.
 * 35383d is 0.0345 in linear, half of 494c52 again, which puts a worktop
 * darker than the frame under it. That is not a compromise: a bench top in a
 * cell is a mat, and a mat is the darkest thing on a bench. */
const WORKTOP = "#35383d";
const BAND = "#52565e";

// The tool panel: the one thing here allowed above the worktop, and only
// because it stands off the back edge, away from the aisle.
const PANEL_OFF = 0.05;
const PANEL_T = 0.02;
const PANEL_H = 0.75;
const PANEL_DX = BENCH_W / 2 + PANEL_OFF;
const PANEL_OUTER = PANEL_DX + PANEL_T / 2;
const PANEL_CY = TOP + PANEL_H / 2;
const PANEL_W = BENCH_D - 0.8;

// Its own shelf, off the panel's outer face rather than its inner one, so
// its depth is never a question of how much clearance is left.
const SHELF2_T = 0.02;
const SHELF2_DEPTH = 0.15;
const SHELF2_W = 0.5;
const SHELF2_TOP = TOP + PANEL_H - 0.08;
const SHELF2_Y = SHELF2_TOP - SHELF2_T / 2;

// Three hooks below the shelf, off the same outer face.
const PEG_SEC = 0.015;
const PEG_LEN = 0.05;
const PEG_Y = TOP + 0.45;
const PEG_Z = [-0.7, 0, 0.7];

// Scratch for slab(), reused the way lab/steel.js reuses its own: each call
// composes into the caller's matrix and returns before the next one runs.
const _p = new THREE.Vector3();
const _sc = new THREE.Vector3();
const _id = new THREE.Quaternion();

/* An axis-aligned box. The band, the shelf and the panel are all this rather
   than member(): none of them runs between two points, so there is no
   direction to rotate onto and this is the compose member() would arrive at
   the long way round. */
function slab(out, cx, cy, cz, sx, sy, sz) {
  _p.set(cx, cy, cz);
  _sc.set(sx, sy, sz);
  return out.compose(_p, _id, _sc);
}

export default function Bench({ x }) {
  // x is s * WORK and WORK is positive (lib/plan.js), so the sign of x is
  // already the side, and a second prop would be a second name for it.
  const s = Math.sign(x);

  const frameMesh = useRef();
  const trimMesh = useRef();

  const geo = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);

  /* Every length of steel in the frame, as [ax, ay, az, bx, by, bz, w, t]
     tuples for member(): legs, their feet, the rail under the worktop and
     the lower stretcher, the two end braces, and the panel's hooks, which
     are steel the same as the frame and cost nothing extra to fold in here. */
  const frame = useMemo(() => {
    const list = [];

    for (const dx of [-LX, LX]) {
      for (const dz of [-LZ, LZ]) {
        list.push([x + dx, FOOT_H, dz, x + dx, RAIL_TOP, dz, LEG_SEC, LEG_SEC]);
        list.push([x + dx, 0, dz, x + dx, FOOT_H, dz, FOOT_SEC, FOOT_SEC]);
      }
    }

    // The rail and the stretcher are the same rectangle at two heights.
    for (const y of [RAIL_Y, STRETCH_Y]) {
      list.push([x - LX, y, -LZ, x - LX, y, LZ, RAIL_SEC, RAIL_SEC]);
      list.push([x + LX, y, -LZ, x + LX, y, LZ, RAIL_SEC, RAIL_SEC]);
      list.push([x - LX, y, -LZ, x + LX, y, -LZ, RAIL_SEC, RAIL_SEC]);
      list.push([x - LX, y, LZ, x + LX, y, LZ, RAIL_SEC, RAIL_SEC]);
    }

    // Alternating corners, so the two ends read as braced rather than as one
    // panel mirrored.
    list.push([x - LX, STRETCH_Y, -LZ, x + LX, RAIL_Y, -LZ, BRACE_SEC, BRACE_SEC]);
    list.push([x + LX, STRETCH_Y, LZ, x - LX, RAIL_Y, LZ, BRACE_SEC, BRACE_SEC]);

    // The pegs, off the panel's outer face.
    for (const z of PEG_Z) {
      list.push([x + s * PANEL_OUTER, PEG_Y, z,
                 x + s * (PANEL_OUTER + PEG_LEN), PEG_Y, z, PEG_SEC, PEG_SEC]);
    }

    return list;
  }, [x, s]);

  /* Everything that is a box rather than a length of steel and is neither
     the frame's colour nor the worktop's. A third and fourth colour would
     each want their own draw call; setColorAt buys them out of one. */
  const trim = useMemo(() => {
    const list = [];

    // The long sides run past the corners rather than mitring into them,
    // which is the plainer weld, and the ends fill the gap between.
    const bandX = BENCH_W / 2 + BAND_W / 2;
    const bandZ = BENCH_D / 2 + BAND_W / 2;
    list.push([x - bandX, BAND_CY, 0, BAND_W, BAND_H, BENCH_D + 2 * BAND_W, BAND]);
    list.push([x + bandX, BAND_CY, 0, BAND_W, BAND_H, BENCH_D + 2 * BAND_W, BAND]);
    list.push([x, BAND_CY, -bandZ, BENCH_W, BAND_H, BAND_W, BAND]);
    list.push([x, BAND_CY, bandZ, BENCH_W, BAND_H, BAND_W, BAND]);

    // Sized to rest on the stretcher rather than inside it.
    list.push([x, SHELF_Y, 0, SHELF_HALF_X * 2, SHELF_T, SHELF_HALF_Z * 2, P.steelDk]);

    // The panel and its shelf.
    list.push([x + s * PANEL_DX, PANEL_CY, 0, PANEL_T, PANEL_H, PANEL_W, P.steelDk]);
    list.push([x + s * (PANEL_OUTER + SHELF2_DEPTH / 2), SHELF2_Y, 0,
               SHELF2_DEPTH, SHELF2_T, SHELF2_W, P.steelDk]);

    return list;
  }, [x, s]);

  useEffect(() => {
    const inst = frameMesh.current;
    if (!inst) return;
    const m = new THREE.Matrix4();
    frame.forEach((p, i) => {
      inst.setMatrixAt(i, member(m, p[0], p[1], p[2], p[3], p[4], p[5], p[6], p[7]));
    });
    inst.count = frame.length;
    inst.instanceMatrix.needsUpdate = true;
    inst.computeBoundingSphere();
  }, [frame]);

  useEffect(() => {
    const inst = trimMesh.current;
    if (!inst) return;
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    trim.forEach((p, i) => {
      inst.setMatrixAt(i, slab(m, p[0], p[1], p[2], p[3], p[4], p[5]));
      inst.setColorAt(i, c.set(p[6]));
    });
    inst.count = trim.length;
    inst.instanceMatrix.needsUpdate = true;
    inst.instanceColor.needsUpdate = true;
    inst.computeBoundingSphere();
  }, [trim]);

  return (
    <group>
      <instancedMesh ref={frameMesh} args={[geo, undefined, frame.length]} castShadow receiveShadow>
        <meshStandardMaterial color={P.steel} roughness={0.72} metalness={0.4} />
      </instancedMesh>

      {/* White, so setColorAt's per-instance tint is the colour that shows
          rather than a tint laid on top of one. */}
      <instancedMesh ref={trimMesh} args={[geo, undefined, trim.length]} castShadow receiveShadow>
        <meshStandardMaterial color={"#ffffff"} roughness={0.68} metalness={0.38} />
      </instancedMesh>

      <mesh position={[x, SLAB_CY, 0]} castShadow receiveShadow>
        <boxGeometry args={[BENCH_W, SLAB_T, BENCH_D]} />
        <meshStandardMaterial color={WORKTOP} roughness={0.68} metalness={0.4} />
      </mesh>
    </group>
  );
}
