import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import UR12e from "./UR12e.jsx";
import { linkFrames, toolPoint, REST } from "../../../world/kinematics.js";
import { lerpQ, clear, replan } from "./demos/via.js";
import { P } from "../lib/palette.js";
import { WORK } from "../lib/plan.js";

/* The replan cell, replanning.
 *
 * The arm runs between two of its own poses on a straight line in joint
 * space. Put something in the way -- the cursor is the something -- and the
 * plan in flight is checked, found dead, cancelled, and replaced by the
 * cheapest clear detour a sampler can find. What is drawn is the tool centre
 * of the plan that is actually being executed, so the line going red and
 * bending is the controller changing its mind, not a caption saying it did.
 *
 * Interactive because the written section is: block the arm and watch it
 * cancel. With no cursor on the bench the obstacle drifts through the
 * workspace on its own so the cell is doing something for somebody walking
 * past, which is the same rule the local control bay uses for its goal.
 */
const TICK = 1 / 30;
const SPEED = 0.55;          // fraction of the plan traversed per second
const OBS_R = 0.20;          // metres; the sphere drawn is this size
const TUBE_R = 0.011;        // the drawn plan, in metres

/* The two ends of the move, and they are wider apart than the baked hero
   sequence's. That move is four poses within about a third of a radian of
   each other -- right for a machine idling in a hero shot, and useless here,
   because a tool path that short can be missed by an obstacle drifting
   through the middle of the workspace and this bay only says something when
   it is not. These are REST with the base swung either way and the shoulder
   and elbow opened, so the tool crosses most of the bench and anything in
   the middle of it is genuinely in the way. */
const ENDS = [
  Float32Array.from([REST[0] + 0.95, -1.15, 1.42, -1.86, -1.57, 0]),
  Float32Array.from([REST[0] - 1.15, -0.86, 1.05, -1.79, -1.57, 0])
];

function seeded(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export default function ForeseeRig({ stop }) {
  const s = stop.side;
  const x = s * WORK;

  const kit = useMemo(() => {
    const frames = Array.from({ length: 6 }, () => new THREE.Matrix4());
    const wrist = new THREE.Vector3(), tool = new THREE.Vector3();
    const scratch = { q: new Float32Array(6) };
    /* One scratch pair, returned by reference. The planner calls this a few
       thousand times a replan and allocating two vectors per call is the
       kind of garbage that turns a 4 ms plan into a stutter. */
    const fk = (q) => {
      linkFrames(q, frames);
      wrist.setFromMatrixPosition(frames[4]);
      toolPoint(frames, tool);
      return [wrist, tool];
    };
    return { frames, scratch, fk, rand: seeded(0x1F2E3D4C),
             a: Float32Array.from(ENDS[0]), b: Float32Array.from(ENDS[1]),
             via: null, u: 0, dead: false, hold: 0, acc: 0, dir: 1 };
  }, []);

  const q = useRef(Float32Array.from(ENDS[0]));
  const obs = useRef(new THREE.Vector3(0.45, 0.0, 0.55));
  const held = useRef(99);
  const ball = useRef();
  const mat = useRef();

  /* The plan is drawn as a tube and not as a line, because WebGL ignores
     linewidth: a LineBasicMaterial is one device pixel wide however near the
     camera is, and one pixel of orange on a lit bench four metres away is
     nothing. A tube is real geometry, it takes the cell's own light, and it
     reads as something the arm is following. Rebuilt on each replan, which
     is a few times a second at worst and not once a frame. */
  const tube = useRef();
  const geoRef = useRef(null);

  /* The plan, as the tool centre walks it. Rebuilt whenever the plan changes
     and not every frame: it is the executed path, so if it were rebuilt from
     the current state each frame it would be a trail rather than a plan. */
  function paintPlan() {
    if (!tube.current) return;
    const segs = kit.via ? [[kit.a, kit.via], [kit.via, kit.b]] : [[kit.a, kit.b]];
    const pts = [];
    for (const [from, to] of segs) {
      for (let k = 0; k <= 24; k++) {
        lerpQ(from, to, k / 24, kit.scratch.q);
        const [, t] = kit.fk(kit.scratch.q);
        pts.push(t.clone());
      }
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const next = new THREE.TubeGeometry(curve, pts.length, TUBE_R, 8, false);
    if (geoRef.current) geoRef.current.dispose();
    geoRef.current = next;
    tube.current.geometry = next;
  }

  useFrame(({ clock }, dt) => {
    const d = Math.min(0.1, dt);
    if (!painted.current && tube.current) { paintPlan(); painted.current = true; }
    held.current += d;

    // The obstacle drifts when nobody is pointing at it. Through the
    // workspace rather than around its edge, or it would never block
    // anything and the bay would never do the thing it is named after.
    if (held.current > 1.5) {
      const t = clock.elapsedTime * 0.55;
      obs.current.set(0.30 + 0.26 * Math.cos(t), 0.30 * Math.sin(t * 0.8),
                      0.62 + 0.20 * Math.sin(t));
    }
    if (ball.current) ball.current.position.copy(obs.current);

    kit.acc += d;
    if (kit.acc >= TICK) {
      kit.acc -= TICK;
      /* Check the part of the plan that has not been executed yet, which is
         the only part that can still be cancelled. Checking the whole plan
         would keep reporting a collision the arm has already driven past. */
      const from = Float32Array.from(q.current);
      const rest = kit.via && kit.u < 0.5
        ? [[from, kit.via], [kit.via, kit.b]]
        : [[from, kit.b]];
      let ok = true;
      for (const [p0, p1] of rest)
        if (!clear(p0, p1, obs.current, OBS_R, kit.fk, kit.scratch)) { ok = false; break; }

      if (!ok && !kit.dead) { kit.dead = true; kit.hold = 0; }

      if (kit.dead) {
        kit.hold += TICK;
        // A beat of held position before the detour, because a controller
        // that cancels and re-accelerates inside one frame is a controller
        // nobody can see cancel.
        if (kit.hold > 0.22) {
          const via = replan(from, kit.b, obs.current, OBS_R + 0.02,
                             kit.fk, kit.scratch, kit.rand);
          if (via) {
            kit.a = from; kit.via = via; kit.u = 0; kit.dead = false;
            paintPlan();
          }
        }
      }
    }

    if (kit.dead) return;      // holding: nothing clear to move along yet

    kit.u += SPEED * d;
    if (kit.u >= 1) {
      /* Arrived. The next move starts from where the arm actually is rather
         than from the goal it was aiming at -- after a detour those are the
         same to within float error, and after a cancelled detour they are
         not, and starting from the goal would teleport it. */
      kit.dir = -kit.dir;
      kit.a = Float32Array.from(q.current);
      kit.b = Float32Array.from(ENDS[kit.dir > 0 ? 1 : 0]);
      kit.via = null; kit.u = 0;
      paintPlan();
    }

    const u = kit.u;
    if (kit.via) {
      if (u < 0.5) lerpQ(kit.a, kit.via, u * 2, q.current);
      else lerpQ(kit.via, kit.b, (u - 0.5) * 2, q.current);
    } else {
      lerpQ(kit.a, kit.b, u, q.current);
    }

    if (mat.current) {
      mat.current.color.set(kit.dead ? "#d94b2b" : P.hazard);
      mat.current.emissive.set(kit.dead ? "#d94b2b" : P.hazard);
    }
  });

  // First paint happens on the first frame instead of in a memo: the mesh
  // the tube is assigned to does not exist until React has committed.
  const painted = useRef(false);

  return (
    <group position={[x, 0.9, 0]}>
      <group rotation-x={-Math.PI / 2}>
        {/* What the cursor talks to: an invisible sheet standing through the
            workspace, so a pointer moving across the bay maps to a point in
            the arm's own frame with no picking arithmetic here. Vertical and
            not flat, because the thing being put in the way is at arm height
            and a floor plane would only ever place it under the bench.
            visible false still takes pointer events -- what it must not do
            is draw. */}
        <mesh
          visible={false}
          position={[0.34, 0, 0.62]}
          rotation-x={Math.PI / 2}
          onPointerMove={(e) => {
            e.stopPropagation();
            const p = e.object.worldToLocal(e.point.clone());
            obs.current.set(0.34 + p.y * 0.0, p.x, 0.62 - p.y);
            held.current = 0;
          }}
        >
          <planeGeometry args={[1.5, 1.4]} />
          <meshBasicMaterial />
        </mesh>

        <mesh ref={tube} frustumCulled={false}>
          <meshStandardMaterial ref={mat} color={P.hazard}
            emissive={P.hazard} emissiveIntensity={0.55} roughness={0.5} />
        </mesh>
        <mesh ref={ball}>
          <sphereGeometry args={[OBS_R, 22, 16]} />
          <meshStandardMaterial color={P.teal} roughness={0.3} metalness={0.1}
                                transparent opacity={0.42} />
        </mesh>
      </group>
      <UR12e q={q} />
    </group>
  );
}
