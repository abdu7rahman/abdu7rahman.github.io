import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import UR12e from "./UR12e.jsx";
import { register, isRunning } from "./console.js";
import { useSim } from "../sim/useSim.js";
import { sortScene, SORT } from "../sim/models.js";
import { solve } from "../sim/ik.js";
import { P } from "../lib/palette.js";
import { WORK } from "../lib/plan.js";

/* Two arms sorting a bench of tools, which is the task this project actually
 * collected data on.
 *
 * This cell used to be an eight-phase handover of one block, played back from
 * poses solved offline. It could not drop anything, could not fail, and was
 * not the task any of the recordings in abdu7rahman/bimanual-ur5-tools-* are
 * of. It is the real one now: six tools scattered on a bench, long ones to
 * the far bin and short ones to the near one, two arms working at the same
 * time.
 *
 * Nothing here is choreographed. Each arm runs its own small state machine
 * and takes whatever unsorted tool is nearest it that the other has not
 * already claimed, so which arm does what changes with where things end up.
 * MuJoCo owns the rest: every tool is a free body with a real shape and a
 * real mass distribution, so a hammer held at the middle of its handle swings
 * about its head, a tool released early lands where it lands, and a tool that
 * misses the bin is still on the bench to be picked up again.
 *
 * The grippers are adhesion actuators -- a force with a ceiling, not a
 * constraint -- so a grasp is something that can be lost. The console counts
 * what has been sorted and what has been dropped, and both are readings
 * rather than declarations: a tool counts as sorted when the simulation says
 * it is inside a bin, not when the sequence says it should be.
 */

const CLEAR = 0.26;          // how far above a tool an arm stands off
/* Zero, because the jaws have to straddle the tool rather than hover over it.
   This was 0.046 while the gripper was an adhesion actuator with a 50 mm
   detection margin, where hovering was the whole idea. With fingers it means
   closing on air: measured, the cell ran 140 simulated seconds, nudged four
   tools and picked up none. The pads are centred on the tool point to within
   2 mm by construction (see sim/models.js), so commanding the tool point to
   the tool's own centre puts them either side of it.
  
   0.012 rather than 0, because a pad centred on a tool lying on a bench has
   half its height below the bench top: measured at 0, the jaws drove into the
   bench and shoved four of the six tools around without lifting any. Twelve
   millimetres up puts a 32 mm pad from 4 mm to 36 mm above the slab, which
   still overlaps every tool here and clears the bench. */
const TOUCH = 0.012;
const REACH = 0.95;          // how far from its own base an arm will go
/* The jaw, in metres. Shut is narrower than the thinnest tool here -- a 20 mm
   screwdriver shaft -- so the fingers always close onto something rather than
   onto each other, and the position servo's force limit is what holds it. */
const GRIP_OPEN = 0.05, GRIP_SHUT = 0.012;

/* Scene coordinates from simulation coordinates: MuJoCo is z-up, the scene is
   y-up, and this is the same quarter turn sim/engine.js applies to a body. */
const toScene = (x, y, z) => [x, z, -y];

/* One arm's programme. Each state names where to go, whether the gripper is
   on, and what ends it -- either arriving or running out of patience. A
   timeout is not a nicety: a grasp that fails leaves an arm reaching for a
   tool it will never lift, and without one the cell stops for good. */
const PLAN = {
  seek:     { grip: 0, secs: 0.4 },
  approach: { grip: 0, secs: 2.0, at: "tool", dz: CLEAR },
  descend:  { grip: 0, secs: 1.5, at: "tool", dz: TOUCH },
  close:    { grip: 1, secs: 0.5, at: "tool", dz: TOUCH },
  lift:     { grip: 1, secs: 1.2, at: "claim", dz: CLEAR + 0.08 },
  carry:    { grip: 1, secs: 2.8, at: "bin", dz: 0.34 },
  /* Down to 0.16 and held for 1.6 s before opening. A tool is grasped
     wherever the gripper happened to land on it, so it hangs off centre and
     swings -- released from 0.20 m up while still swinging, a wrench landed
     0.08 m outside its bin, stayed unsorted, and the arm re-claimed it and
     failed the same way for the rest of the run. Lower and settled first. */
  place:    { grip: 1, secs: 1.6, at: "bin", dz: 0.16 },
  open:     { grip: 0, secs: 0.7, at: "bin", dz: 0.16 },
  back:     { grip: 0, secs: 1.2, at: "home", dz: 0 }
};
const NEXT = { seek: "approach", approach: "descend", descend: "close", close: "lift",
               lift: "carry", carry: "place", place: "open", open: "back", back: "seek" };

export default function SortRig({ stop }) {
  const s = stop.side;
  const x = s * WORK;
  const [sim, ready] = useSim(sortScene, []);

  const kit = useMemo(() => ({
    cmd: [new Float32Array([0, -1.2, 1.4, -1.75, -1.57, 0]),
          new Float32Array([0, -1.2, 1.4, -1.75, -1.57, 0])],
    act: [new Float32Array(6), new Float32Array(6)],
    /* Per arm: what it is doing, how long it has been doing it, and which
       tool it has claimed. The claim is what keeps two arms off one tool
       without either of them knowing about the other's programme. */
    state: ["seek", "seek"], t: [0, 0], claim: [null, null],
    /* How many times each arm has tried and failed on a given tool. An arm
       that keeps choosing the nearest thing will choose the same unreachable
       or un-grippable thing forever, and measured, that is exactly what
       happened: one wrench landed short of its bin and the left arm spent the
       remaining sixty seconds re-attempting it while a second wrench nobody
       else could reach sat untouched. After two goes a tool goes to the back
       of the queue rather than being abandoned, so the cell always has
       something to do and never gives up on anything permanently. */
    tries: new Map(),
    sorted: new Set(), floor: new Set(), cycles: 0,
    tgt: new THREE.Vector3(), base: new THREE.Vector3(),
    a: new THREE.Vector3(), b: new THREE.Vector3()
  }), []);

  const armRefs = [useRef(kit.act[0]), useRef(kit.act[1])];
  const toolRefs = useRef([]);

  useEffect(() => { armRefs[0].current = kit.act[0]; armRefs[1].current = kit.act[1]; }, [kit]);

  useEffect(() => register(stop.id, {
    title: "Bimanual tool sorting",
    actions: [
      { label: "Reset", on: () => {
        kit.state = ["seek", "seek"]; kit.t = [0, 0]; kit.claim = [null, null];
        kit.sorted.clear(); kit.floor.clear(); kit.cycles = 0;
        if (sim.current) sim.current.reset();
      } }
    ],
    readout: () => [
      ["sorted", `${kit.sorted.size} / ${SORT.tools.length}`],
      ["left arm", kit.state[0]],
      ["right arm", kit.state[1]],
      ["on the floor", String(kit.floor.size)]
    ],
    hint: "Long tools to the far bin, short to the near one. Each arm takes whatever is nearest it."
  }), [stop.id, kit, sim]);

  /* Where a tool is, right now, in simulation coordinates. Read every time
     rather than cached: these are free bodies and the whole point is that
     they end up somewhere the cell did not choose. */
  function toolAt(sm, id, out) {
    sm.point(id, kit.a);
    return out.set(kit.a.x, -kit.a.z, kit.a.y);
  }

  /* Is this tool in its bin. The test is the bin's own footprint and a
     height, so a tool balanced on the rim does not count and a tool that
     bounced out stops counting. */
  function inBin(p, binIndex) {
    const [bx, by] = SORT.bin[binIndex];
    return Math.abs(p.x - bx) < 0.21
        && (Math.abs(p.y - by) < 0.17 || Math.abs(p.y + by) < 0.17)
        && p.z < 0.14;
  }

  /* Did the arm's claim end up where it was supposed to. Asked at the end of
     a cycle, off the simulation, not off the plan. */
  function claimFailed(arm, where) {
    const id = kit.claim[arm];
    if (!id) return false;
    const i = SORT.tools.findIndex(t => t.id === id);
    return i >= 0 && !inBin(where[i], SORT.tools[i].bin);
  }

  useFrame((_, dt) => {
    const sm = sim.current;
    if (!sm) return;
    const d = Math.min(0.1, dt);
    const run = isRunning(stop.id);

    // Where everything is, once, before either arm decides anything.
    const where = SORT.tools.map(t => toolAt(sm, t.id, new THREE.Vector3()));
    SORT.tools.forEach((t, i) => {
      if (inBin(where[i], t.bin)) kit.sorted.add(t.id); else kit.sorted.delete(t.id);
      if (where[i].z < -0.5) kit.floor.add(t.id); else kit.floor.delete(t.id);
    });

    for (const arm of [0, 1]) {
      const by = arm === 0 ? SORT.base : -SORT.base;
      const st = kit.state[arm];
      const step = PLAN[st];
      if (run) kit.t[arm] += d;

      if (st === "seek") {
        /* Nearest unsorted, unclaimed, still-on-the-bench tool within reach.
           Nearest to this arm's own base, which is what makes the two of them
           divide the bench between themselves without being told to. */
        let best = null, bestD = Infinity;
        SORT.tools.forEach((t, i) => {
          if (kit.sorted.has(t.id) || kit.floor.has(t.id)) return;
          if (kit.claim[1 - arm] === t.id) return;
          const dist = Math.hypot(where[i].x, where[i].y - by, where[i].z - SORT.mount);
          const penalty = (kit.tries.get(t.id) || 0) * 0.6;
          if (dist < REACH && dist + penalty < bestD) { bestD = dist + penalty; best = t.id; }
        });
        kit.claim[arm] = best;
        if (best && kit.t[arm] >= step.secs) { kit.state[arm] = "approach"; kit.t[arm] = 0; }
        if (!best) kit.t[arm] = 0;
      } else if (kit.t[arm] >= step.secs) {
        kit.state[arm] = NEXT[st];
        kit.t[arm] = 0;
        if (kit.state[arm] === "seek") {
          // A cycle that ended with the tool still out of its bin was a
          // failed attempt, and the count is what stops it repeating.
          if (claimFailed(arm, where)) kit.tries.set(kit.claim[arm], (kit.tries.get(kit.claim[arm]) || 0) + 1);
          kit.claim[arm] = null; kit.cycles++;
        }
      }

      // Where this arm is reaching, in simulation coordinates.
      const claim = kit.claim[arm];
      const spec = PLAN[kit.state[arm]];
      const idx = claim ? SORT.tools.findIndex(t => t.id === claim) : -1;
      if (spec.at === "tool" && idx >= 0) kit.tgt.copy(where[idx]).setZ(where[idx].z + spec.dz);
      else if (spec.at === "claim" && idx >= 0) kit.tgt.copy(where[idx]).setZ(SORT.mount + spec.dz);
      else if (spec.at === "bin" && idx >= 0) {
        // This arm's own bin for that class of tool, on this arm's own side.
        const [bx, bY] = SORT.bin[SORT.tools[idx].bin];
        kit.tgt.set(bx, arm === 0 ? bY : -bY, spec.dz);
      } else {
        kit.tgt.set(0.36, by * 0.72, SORT.mount + 0.30);
      }

      /* Into the arm's own base frame: the two stand facing each other, so
         the transform is a translation and a quarter turn. */
      const yaw = arm === 0 ? -Math.PI / 2 : Math.PI / 2;
      const c = Math.cos(-yaw), sn = Math.sin(-yaw);
      const dx0 = kit.tgt.x, dy0 = kit.tgt.y - by;
      kit.base.set(dx0 * c - dy0 * sn, dx0 * sn + dy0 * c, kit.tgt.z - SORT.mount);
      solve(kit.cmd[arm], kit.base, kit.cmd[arm], 20);
      /* By name, not by index. The arms carry eight actuators each now -- six
         joints and two fingers -- so arm * 6 + i quietly addressed the wrong
         arm's shoulder the moment the gripper stopped being an adhesion
         actuator appended after both arms. */
      const a = arm === 0 ? "l" : "r";
      for (let i = 0; i < 6; i++) sm.actuate(`${a}_a${i}`, kit.cmd[arm][i]);
      // The finger command is a jaw opening in metres, not a flag.
      const jaw = spec.grip ? GRIP_SHUT : GRIP_OPEN;
      sm.actuate(`${a}_ga`, jaw);
      sm.actuate(`${a}_gb`, jaw);
    }

    sm.step(d);

    for (const i of [0, 1]) for (let j = 0; j < 6; j++) kit.act[i][j] = sm.qpos[i * 6 + j];
    SORT.tools.forEach((t, i) => {
      const o = toolRefs.current[i];
      if (o) sm.pose(t.id, o);
    });
  });

  const bin = (bx, yy, key, label) => (
    <group key={key} position={toScene(bx, yy, 0)}>
      <mesh position={[0, 0.012, 0]} receiveShadow>
        <boxGeometry args={[0.32, 0.024, 0.26]} />
        <meshStandardMaterial color={P.steelDk} roughness={0.8} metalness={0.2} />
      </mesh>
      {[[0.16, 0, 0.024, 0.26], [-0.16, 0, 0.024, 0.26],
        [0, 0.13, 0.32, 0.024], [0, -0.13, 0.32, 0.024]].map(([dx, dz, w, dd], i) => (
        <mesh key={i} position={[dx, 0.075, dz]} castShadow receiveShadow>
          <boxGeometry args={[w, 0.15, dd]} />
          <meshStandardMaterial color={P.steel} roughness={0.7} metalness={0.35} />
        </mesh>
      ))}
      {/* The one painted line in the cell, on the lip of the bin, because the
          bins are the only thing here that means anything. */}
      <mesh position={[0, 0.152, label === 0 ? 0.13 : -0.13]}>
        <boxGeometry args={[0.32, 0.008, 0.03]} />
        <meshStandardMaterial color={P.hazard} roughness={0.8} />
      </mesh>
    </group>
  );

  return (
    <group position={[x, 0.9, 0]}>
      {[SORT.base, -SORT.base].map((b, i) => (
        <mesh key={i} position={toScene(0, b, SORT.mount / 2)} castShadow receiveShadow>
          <cylinderGeometry args={[0.09, 0.09, SORT.mount, 12]} />
          <meshStandardMaterial color={P.steelDk} roughness={0.7} metalness={0.4} />
        </mesh>
      ))}
      {bin(SORT.bin[0][0], SORT.bin[0][1], "ll", 0)}
      {bin(SORT.bin[1][0], SORT.bin[1][1], "sl", 1)}
      {bin(SORT.bin[0][0], -SORT.bin[0][1], "lr", 0)}
      {bin(SORT.bin[1][0], -SORT.bin[1][1], "sr", 1)}

      {/* The tools. Drawn to the same dimensions the simulation collides with,
          which is why the shapes are read off SORT rather than chosen here:
          a hammer whose picture is longer than its collision proxy is a
          hammer that visibly passes through the bench. */}
      {SORT.tools.map((t, i) => (
        <group key={t.id} ref={el => (toolRefs.current[i] = el)}>
          {t.kind === "hammer" ? (
            <>
              {/* MuJoCo's capsules run along local x and three's cylinders
                  along local y, so every round tool here is turned a quarter
                  about z to agree with the body it is drawn for. The handle
                  is also off centre, because its capsule runs from -half to
                  +0.65 half and the head takes the rest. */}
              <mesh rotation-z={Math.PI / 2} position={[-t.len * 0.0875, 0, 0]}
                    castShadow receiveShadow>
                <cylinderGeometry args={[0.011, 0.011, t.len * 0.825, 8]} />
                <meshStandardMaterial color={"#8c6b47"} roughness={0.85} />
              </mesh>
              <mesh position={[t.len * 0.41, 0, 0]} castShadow receiveShadow>
                <boxGeometry args={[0.052, 0.032, 0.032]} />
                <meshStandardMaterial color={P.steel} roughness={0.45} metalness={0.7} />
              </mesh>
            </>
          ) : t.kind === "bar" ? (
            <mesh castShadow receiveShadow>
              <boxGeometry args={[t.len, 0.032, 0.016]} />
              <meshStandardMaterial color={P.machine} roughness={0.35} metalness={0.75} />
            </mesh>
          ) : (
            <mesh rotation-z={Math.PI / 2} castShadow receiveShadow>
              <cylinderGeometry args={[0.010, 0.010, t.len, 8]} />
              <meshStandardMaterial color={P.hazard} roughness={0.6} metalness={0.2} />
            </mesh>
          )}
        </group>
      ))}

      {[0, 1].map(i => (
        <group key={i}
          position={toScene(0, i === 0 ? SORT.base : -SORT.base, SORT.mount)}
          rotation-y={i === 0 ? -Math.PI / 2 : Math.PI / 2}>
          <UR12e q={ready ? armRefs[i] : undefined} phase={i * 0.6} />
        </group>
      ))}
    </group>
  );
}
