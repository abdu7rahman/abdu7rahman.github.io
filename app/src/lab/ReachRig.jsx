import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import UR12e from "./UR12e.jsx";
import { linkFrames, toolPoint, TCP_Z } from "../../../world/kinematics.js";
import { register, isRunning } from "./console.js";
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
/* Metres, for the colour ramp only. The band starts at 0.45 rather than at
   0 so the ramp spends its range on the shell rather than on the empty
   middle -- measured on this rig's own sampling, 19.3% of points fall
   inside 0.45 m and clamp to the floor of the ramp, and 12.2% clamp at the
   1.30 m ceiling. Both ends are a clamp and not a gradient, which is the
   right trade for a colour that is only there to give the shell depth. */
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

/* The joint ranges, and what is and is not swept.
 *
 * A UR is +/- 2 pi on every axis. Joints 1 to 4 are swept over a full turn:
 * they are what put the wrist somewhere, and their range is the shape.
 * Joint 5 is swept over a narrow band because it swings the tool centre by
 * TCP_Z = 0.157 m about the wrist, and at full range that thickens the
 * shell by a third of a metre and hides it. Joint 6 is not swept at all and
 * is held at zero, because it rotates the tool about its own z and the tool
 * centre is on that axis -- every sample it could produce is a sample
 * already there. So the cloud is five joints, and the console says five.
 *
 * The shoulder stops at 0 rather than running to +pi, and that is a real
 * restriction rather than an oversight: past zero the arm folds back
 * through its own column. Measured over 300,000 samples, the swept set
 * reaches z in [-0.685, 1.662] where the full range reaches [-1.301,
 * 1.662] -- the outer radius, 1.495 m, is the same either way, so what is
 * missing is 0.6 m of the underside and not any of the extent. Said here
 * because a reachable set with a piece quietly absent is the one kind of
 * plot that is worse than no plot.
 */
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
      geo: g, pos, col, n: 0, lockBase: false, rand: seeded(0x9E3779B9),
      q: new Float32Array(6),
      frames: Array.from({ length: 6 }, () => new THREE.Matrix4()),
      v: new THREE.Vector3(),
      near: new THREE.Color(P.teal),
      far: new THREE.Color(P.hazard)
    };
  }, []);

  const tint = useMemo(() => new THREE.Color(), []);

  /* Rebuild is the control that matters: the cloud is a Monte Carlo estimate
     of a set, and being able to throw it away and watch it re-form is how
     anybody checks that the shape is the arm's and not the sampler's. The
     joint choice is the same question asked more sharply -- lock the base
     and the envelope collapses to the plane the other five can reach, which
     is a different and more legible fact about the machine. */
  useEffect(() => register(stop.id, {
    title: "Reachable set, sampled",
    actions: [{ label: "Rebuild", on: () => { kit.n = 0; kit.geo.setDrawRange(0, 0); } }],
    choice: {
      get: () => kit.lockBase,
      set: (v) => { kit.lockBase = v; kit.n = 0; kit.geo.setDrawRange(0, 0); },
      options: [
        { value: false, label: "All six" },
        { value: true, label: "Base locked" }
      ]
    },
    readout: () => [
      ["samples", kit.n.toLocaleString("en")],
      ["of", N.toLocaleString("en")],
      ["joints swept", kit.lockBase ? "4" : "5"]
    ],
    hint: "Every point is a tool centre from the arm's own forward kinematics."
  }), [stop.id, kit]);

  useFrame((_, dt) => {
    if (!isRunning(stop.id)) return;
    if (kit.n >= N) return;
    const add = Math.min(N - kit.n, Math.max(1, Math.round(PER_S * Math.min(0.1, dt))));
    for (let i = 0; i < add; i++) {
      for (let j = 0; j < 6; j++) kit.q[j] = LO[j] + kit.rand() * (HI[j] - LO[j]);
      // Base locked: the envelope collapses to the slice the other joints
      // can reach, which is the shape a fixed-base reach study actually
      // wants and is invisible inside the full shell.
      if (kit.lockBase) kit.q[0] = 0;
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
