import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import UR12e from "./UR12e.jsx";
import { linkFrames, toolPoint, TCP_Z } from "../../../world/kinematics.js";
import { register, isRunning } from "./console.js";
import { detect } from "../lib/capability.js";
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
/* The samples build a surface now, not a cloud.
 *
 * 70,000 points at a third of an alpha, drawn without depth, against a dark
 * wall at the back of a bay, is grain. It reads as a broken render -- dead
 * pixels on the camera -- rather than as the shape of what an arm can touch,
 * which is the one thing this bay exists to show. More points and smaller
 * points had already been tried; the problem is not the sampling, it is that
 * a translucent unlit cloud has no silhouette and nothing to catch a light.
 *
 * So the samples are binned into a surface and the surface is drawn. The set
 * is star-shaped about the shoulder -- along any ray out of it the reachable
 * radii form one interval -- so a direction and a radius describe it
 * completely: bin by direction, keep the furthest and nearest radius seen in
 * each bin, and the two of those are the outer shell and the cavity the
 * shoulder singularity leaves inside it. Nothing is placed and nothing is
 * fitted. Every vertex is the furthest a sample actually got in that
 * direction, from the same forward kinematics the arm beside it is posed
 * with.
 *
 * It still builds while somebody is standing there, for the same reason it
 * did before: a shape that is finished when you arrive says nothing about
 * where it came from.
 */
const N = 70000;
const PER_S = 9000;

/* The direction grid, and it is coarser than it wants to be for a reason
   that is about statistics and not about resolution.
 *
 * Each bin's radius is the furthest of the samples that landed in it, and the
 * maximum of a handful of draws is a bad estimate of a true maximum -- biased
 * low and noisy. 96 by 48 is 4,608 bins, which over 70,000 samples is fifteen
 * each, and fifteen draws produced a sea urchin: every bin undershot by a
 * different amount and the surface between them was all spike. 48 by 24 is
 * sixty draws a bin, and sixty is where the estimate settles down.
 *
 * A bin still needs to have been reached enough times to be trusted, so
 * MIN_HITS is the floor below which a bin is treated as unreached and its
 * quads are not emitted -- which also keeps the shell from growing spines
 * while it is still filling. */
const RES_U = 48, RES_V = 24;
const MIN_HITS = 6;

/* Passes of neighbour averaging over the radius field before it is drawn.
   The residual scatter between neighbouring bins is estimator noise rather
   than shape -- the arm's real envelope has no 3.75 degree features on it --
   so smoothing it is removing error, not detail. Wrapped in longitude,
   clamped in latitude. */
const SMOOTH = 2;

/* How often the surface is rebuilt from the bins, in seconds. Rebuilding is
   a couple of thousand quads of arithmetic and no allocation, which is cheap,
   but doing it on a frame that added 150 samples out of 70,000 is 150
   samples' worth of change for a whole rebuild. Four times a second is
   faster than the eye asks and a twentieth of the work. */
const REBUILD = 0.25;
/* Metres above the bench, for the colour ramp.
 *
 * The ramp used to run on radius from the shoulder, which was right for a
 * cloud -- a cloud has samples at every radius, so the colour told you how
 * far out you were looking. An outer shell does not: every point on it is at
 * the furthest radius by construction, so the same ramp painted the whole
 * dome one flat orange and said nothing.
 *
 * Height does vary over the shell and is a fact about the machine rather than
 * about the plot: how high the arm can get at this bearing against how low.
 * The band is the swept set's own z range as this rig samples it, -0.685 to
 * 1.662 m from the shoulder, taken to the bench. */
const REACH_LO = -0.50, REACH_HI = 1.70;

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

/* One bin's direction, as a unit vector. The inverse of the binning above,
   taken at the bin's own corner rather than its centre so that neighbouring
   quads share an edge exactly and the surface has no cracks in it. */
function dirOf(u, v, out) {
  const az = (u / RES_U - 0.5) * Math.PI * 2;
  const cz = (v / RES_V) * 2 - 1;                 // cos of the polar angle
  const sr = Math.sqrt(Math.max(0, 1 - cz * cz));
  return out.set(Math.cos(az) * sr, Math.sin(az) * sr, cz);
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3();
const _c = new THREE.Vector3(), _d = new THREE.Vector3();
const _n = [_a, _b, _c, _d];

/* Average each bin's radius with its neighbours, into a second field so the
   measurements themselves are never overwritten. Longitude wraps; latitude
   clamps. Only bins with enough samples take part, and only they are
   averaged into -- an unreached bin must stay unreached or the shell grows
   into the space the arm could not get to. */
function blur(kit) {
  const src = kit.far, dst = kit.smooth, hit = kit.hit;
  dst.set(src);
  for (let pass = 0; pass < SMOOTH; pass++) {
    for (let v = 0; v < RES_V; v++) {
      for (let u = 0; u < RES_U; u++) {
        const b = v * RES_U + u;
        if (hit[b] < MIN_HITS) { dst[b] = 0; continue; }
        let sum = dst[b], k = 1;
        const add = (uu, vv) => {
          if (vv < 0 || vv >= RES_V) return;
          const j = vv * RES_U + ((uu + RES_U) % RES_U);
          if (hit[j] < MIN_HITS) return;
          sum += dst[j]; k++;
        };
        add(u - 1, v); add(u + 1, v); add(u, v - 1); add(u, v + 1);
        dst[b] = sum / k;
      }
    }
  }
}

/* Turn a radius per direction into triangles.
 *
 * A quad is emitted only where all four of its corner bins were reached
 * often enough to be believed, so the shell ends where the arm's does.
 */
function surface(kit, geo, radius, tint) {
  const pos = geo.attributes.position.array;
  const col = geo.attributes.color.array;
  let k = 0;
  for (let v = 0; v < RES_V - 1; v++) {
    for (let u = 0; u < RES_U; u++) {
      const u1 = (u + 1) % RES_U;
      const b0 = v * RES_U + u, b1 = v * RES_U + u1;
      const b2 = (v + 1) * RES_U + u1, b3 = (v + 1) * RES_U + u;
      if (kit.hit[b0] < MIN_HITS || kit.hit[b1] < MIN_HITS ||
          kit.hit[b2] < MIN_HITS || kit.hit[b3] < MIN_HITS) continue;
      dirOf(u, v, _a).multiplyScalar(radius[b0]);
      dirOf(u + 1, v, _b).multiplyScalar(radius[b1]);
      dirOf(u + 1, v + 1, _c).multiplyScalar(radius[b2]);
      dirOf(u, v + 1, _d).multiplyScalar(radius[b3]);
      const order = [0, 1, 2, 0, 2, 3];
      for (let i = 0; i < 6; i++) {
        const p = _n[order[i]];
        pos[k] = p.x; pos[k + 1] = p.y; pos[k + 2] = p.z + SHOULDER;
        /* Coloured by height, which is the thing about this shape a
           silhouette alone does not carry. */
        const t = (p.z + SHOULDER - REACH_LO) / (REACH_HI - REACH_LO);
        tint.copy(kit.tealC).lerp(kit.hazardC, Math.max(0, Math.min(1, t)));
        col[k] = tint.r; col[k + 1] = tint.g; col[k + 2] = tint.b;
        k += 3;
      }
    }
  }
  geo.setDrawRange(0, k / 3);
  geo.attributes.position.needsUpdate = true;
  geo.attributes.color.needsUpdate = true;
  geo.computeBoundingSphere();
}

/* The shoulder height, module scope because `surface` needs it too. */
const SHOULDER = 0.1807;

export default function ReachRig({ stop }) {
  const s = stop.side;
  const x = s * WORK;

  /* The cloud is a Monte Carlo estimate of a set, so the tier scales how
     many samples it is estimated from and not what is being estimated. At
     the low tier that is 24,500 points instead of 70,000 -- a thinner shell
     of the same shape, which is the honest way to be cheaper about an
     estimate. */
  const cap = detect().quality.work;
  const n = Math.round(N * cap);

  const kit = useMemo(() => {
    const bins = RES_U * RES_V;
    /* One surface: the furthest a sample got in each direction. A bin that
       has not been reached enough times to be believed is left out and the
       quads that touch it are not emitted, which leaves the underside of the
       workspace open where the arm genuinely cannot go rather than closing
       it with a lid the arithmetic never found.
    
       There was a second surface here, built from the nearest radius in each
       bin, on the idea that it would show the cavity the shoulder
       singularity leaves. It does not: the minimum of a set of samples
       converges to an inner boundary only where there is one, and everywhere
       else it converges to whatever sample happened to pass closest to the
       shoulder. Drawn, it was a teal starburst through the middle of the
       shell -- an artefact of the sampler presented as a feature of the
       robot, which is the one thing this bay must not do. */
    const far = new Float32Array(bins);
    const smooth = new Float32Array(bins);
    const hit = new Uint16Array(bins);
    /* Room for every quad of both surfaces as loose triangles. Indexed would
       be smaller and cannot be used: a vertex on the seam belongs to two
       directions and a vertex beside a hole belongs to fewer quads than its
       neighbours, so the index list would have to be rebuilt as often as the
       positions are. */
    const cap3 = bins * 6 * 3;
    const geoOut = new THREE.BufferGeometry();
    const mk = g => {
      g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(cap3), 3));
      g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(cap3), 3));
      g.setDrawRange(0, 0);
      return g;
    };
    return {
      geoOut: mk(geoOut),
      far, smooth, hit, bins,
      n: 0, lockBase: false, rand: seeded(0x9E3779B9),
      since: 1e9,
      q: new Float32Array(6),
      frames: Array.from({ length: 6 }, () => new THREE.Matrix4()),
      v: new THREE.Vector3(),
      tealC: new THREE.Color(P.teal),
      hazardC: new THREE.Color(P.hazard),
      reset() {
        this.n = 0; this.since = 1e9;
        this.far.fill(0); this.hit.fill(0);
        this.geoOut.setDrawRange(0, 0);
      }
    };
  }, [n]);

  /* Every direction and radius in here is measured from the shoulder: the
     base plate is not the centre of the workspace, and a ramp centred on it
     puts its midpoint somewhere the arm never is. */
  const SHOULDER_Z = SHOULDER;

  const tint = useMemo(() => new THREE.Color(), []);

  /* Rebuild is the control that matters: the cloud is a Monte Carlo estimate
     of a set, and being able to throw it away and watch it re-form is how
     anybody checks that the shape is the arm's and not the sampler's. The
     joint choice is the same question asked more sharply -- lock the base
     and the envelope collapses to the plane the other five can reach, which
     is a different and more legible fact about the machine. */
  useEffect(() => register(stop.id, {
    title: "Reachable set, sampled",
    actions: [{ label: "Rebuild", on: () => kit.reset() }],
    choice: {
      get: () => kit.lockBase,
      set: (v) => { kit.lockBase = v; kit.reset(); },
      options: [
        { value: false, label: "All six" },
        { value: true, label: "Base locked" }
      ]
    },
    readout: () => [
      ["samples", kit.n.toLocaleString("en")],
      ["of", n.toLocaleString("en")],
      ["joints swept", kit.lockBase ? "4" : "5"]
    ],
    /* What it is doing, in words, including how far through it is -- the
       shell takes a few seconds to fill and an unfinished one looks broken
       rather than unfinished. */
    say: () => {
      const n = kit.n || 0;
      const total = Math.round(N * cap);
      if (n >= total) return "Done. That shell is every place the tool centre reached.";
      return `Solving the arm's forward kinematics at random joint angles -- `
           + `${(100 * n / Math.max(1, total)).toFixed(0)} per cent of the way through. `
           + `The shell is the furthest each direction got.`;
    },
    hint: "The shell is the furthest the tool centre got in each direction, from the arm's own forward kinematics."
  }), [stop.id, kit]);

  useFrame((_, dt) => {
    if (!isRunning(stop.id)) return;
    if (kit.n >= n) return;
    const add = Math.min(n - kit.n, Math.max(1, Math.round(PER_S * cap * Math.min(0.1, dt))));
    for (let i = 0; i < add; i++) {
      for (let j = 0; j < 6; j++) kit.q[j] = LO[j] + kit.rand() * (HI[j] - LO[j]);
      // Base locked: the envelope collapses to the slice the other joints
      // can reach, which is the shape a fixed-base reach study actually
      // wants and is invisible inside the full shell.
      if (kit.lockBase) kit.q[0] = 0;
      linkFrames(kit.q, kit.frames);
      toolPoint(kit.frames, kit.v);
      /* Direction and radius from the shoulder, and the bin they fall in.
         v is the latitude by cos so the bins are equal solid angle -- an
         even grid in the angle itself crowds the poles and starves the
         equator, which on this shape is exactly where the surface is. */
      const dx = kit.v.x, dy = kit.v.y, dz = kit.v.z - SHOULDER_Z;
      const r = Math.hypot(dx, dy, dz);
      kit.n++;
      if (r < 1e-4) continue;
      let u = Math.floor((Math.atan2(dy, dx) / (Math.PI * 2) + 0.5) * RES_U);
      let vv = Math.floor((dz / r * 0.5 + 0.5) * RES_V);
      if (u < 0) u = 0; else if (u >= RES_U) u = RES_U - 1;
      if (vv < 0) vv = 0; else if (vv >= RES_V) vv = RES_V - 1;
      const b = vv * RES_U + u;
      if (r > kit.far[b]) kit.far[b] = r;
      if (kit.hit[b] < 65535) kit.hit[b]++;
    }

    kit.since += dt;
    if (kit.since < REBUILD) return;
    kit.since = 0;
    blur(kit);
    surface(kit, kit.geoOut, kit.smooth, tint);
  });

  return (
    <group position={[x, 0.9, 0]}>
      {/* The cloud is in the arm's own frame, so it is rotated by the same
          UPRIGHT the arm is rather than being placed to look right. */}
      <group rotation-x={-Math.PI / 2}>
        {/* The outer shell, lit and solid enough to have a silhouette, and
            translucent enough that the arm inside it is still the subject.
            Both sides are drawn because the shell is open underneath and the
            inside of it is visible through that opening. */}
        <mesh geometry={kit.geoOut} frustumCulled={false}>
          <meshStandardMaterial vertexColors transparent opacity={0.30}
                                roughness={0.55} metalness={0.0}
                                side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
      </group>
      <UR12e phase={(stop.at * 0.37) % 2} />
    </group>
  );
}
