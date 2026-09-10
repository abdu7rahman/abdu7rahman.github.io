import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import UR12e from "./UR12e.jsx";
import { linkFrames, toolPoint, TCP_Z } from "../../../world/kinematics.js";
import { P } from "../lib/palette.js";
import { WORK } from "../lib/plan.js";

/* The reachable set, solved rather than drawn.
 *
 * Every point in the cloud is the tool centre of a joint tuple that was put
 * through the same forward kinematics the arm beside it is posed with --
 * config/ur12e/default_kinematics.yaml, by way of world/kinematics.js. No
 * point is placed. The shell you end up looking at is the UR12e's workspace
 * because that is what the arithmetic returns, and the hole through the
 * middle of it is the shoulder singularity, which is there for the same
 * reason.
 *
 * Built a few hundred samples a frame instead of all at once, so the envelope
 * forms while somebody is standing there. That is not a loading trick: a
 * cloud that is already finished when you arrive says nothing about where it
 * came from, and this bay is about where it came from.
 */
/* 70,000 rather than 24,000, and smaller, because at 24,000 the cloud read
   as sparks rather than as a surface. A shell is a shape and a shape needs
   enough samples that the eye stops resolving individual ones -- which is
   the same reason a Monte Carlo integral needs more than a handful and not a
   different reason dressed up. Eight seconds to fill at this rate. */
const N = 70000;
const PER_S = 9000;
/* Metres, for the colour ramp only, and the band starts at 0.45 rather than
   at 0: almost nothing the arm can reach is inside 0.45 m of the shoulder,
   so a ramp that starts there spends its whole range on the part of the
   workspace that exists instead of putting everything at the top end. */
const REACH_LO = 0.45, REACH_HI = 1.30;

/* Sobol would be better and is forty lines; this is a stratified shuffle over
   four axes, which for a cloud whose only job is to show a shell is
   indistinguishable and is four. The seed is fixed so the same arm gets the
   same envelope every time somebody walks past it. */
function seeded(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* The joint ranges. A UR is +/- 2 pi on every axis, so the reachable set is
   whatever the first four joints can put the wrist at -- 5 and 6 rotate the
   tool about itself and move the centre by TCP_Z at most, which is why they
   are sampled too but over a narrow band: including them at full range
   thickens the shell by 0.16 m and hides the shape. */
const LO = [-Math.PI, -Math.PI, -Math.PI, -Math.PI, -1.9, 0];
const HI = [ Math.PI,  0.0,      Math.PI,  Math.PI, -1.2, 0];

export default function ReachRig({ stop }) {
  const s = stop.side;
  const x = s * WORK;

  const kit = useMemo(() => {
    const pos = new Float32Array(N * 3);
    const col = new Float32Array(N * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g.setDrawRange(0, 0);
    return {
      geo: g, pos, col, n: 0, rand: seeded(0x9E3779B9),
      q: new Float32Array(6),
      frames: Array.from({ length: 6 }, () => new THREE.Matrix4()),
      v: new THREE.Vector3(),
      near: new THREE.Color(P.teal),
      far: new THREE.Color(P.hazard)
    };
  }, []);

  const tint = useMemo(() => new THREE.Color(), []);

  useFrame((_, dt) => {
    if (kit.n >= N) return;
    const add = Math.min(N - kit.n, Math.max(1, Math.round(PER_S * Math.min(0.1, dt))));
    for (let i = 0; i < add; i++) {
      for (let j = 0; j < 6; j++) kit.q[j] = LO[j] + kit.rand() * (HI[j] - LO[j]);
      linkFrames(kit.q, kit.frames);
      toolPoint(kit.frames, kit.v);
      const k = kit.n * 3;
      kit.pos[k] = kit.v.x; kit.pos[k + 1] = kit.v.y; kit.pos[k + 2] = kit.v.z;
      // Reach from the shoulder, not from the origin: the base plate is not
      // the centre of the workspace and colouring from it puts the ramp's
      // midpoint somewhere the arm never is.
      const r = (Math.hypot(kit.v.x, kit.v.y, kit.v.z - 0.1807) - REACH_LO)
                / (REACH_HI - REACH_LO);
      tint.copy(kit.near).lerp(kit.far, Math.max(0, Math.min(1, r)));
      kit.col[k] = tint.r; kit.col[k + 1] = tint.g; kit.col[k + 2] = tint.b;
      kit.n++;
    }
    kit.geo.setDrawRange(0, kit.n);
    kit.geo.attributes.position.needsUpdate = true;
    kit.geo.attributes.color.needsUpdate = true;
  });

  return (
    <group position={[x, 0.9, 0]}>
      {/* The cloud is in the arm's own frame, so it is rotated by the same
          UPRIGHT the arm is rather than being placed to look right. */}
      <group rotation-x={-Math.PI / 2}>
        <points geometry={kit.geo} frustumCulled={false}>
          <pointsMaterial size={0.0075} vertexColors transparent opacity={0.34}
                          sizeAttenuation depthWrite={false} />
        </points>
      </group>
      <UR12e phase={(stop.at * 0.37) % 2} />
    </group>
  );
}
