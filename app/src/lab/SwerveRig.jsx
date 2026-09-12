import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useSim } from "../sim/useSim.js";
import { swerveScene, SWERVE_MODULES } from "../sim/models.js";
import { SWERVE, SPIN_R, MODULES, modules, scratch, odometry } from "./demos/swerve.js";
import { register, isLive } from "./console.js";
import { P } from "../lib/palette.js";
import { WORK } from "../lib/plan.js";

/* A base that can go one way while facing another.
 *
 * Everything else that drives in this building is differential: two wheels,
 * and the only way to go left is to turn left first. A swerve base is four
 * modules that each steer and drive, so where it goes and where it points
 * are separate commands -- and the arithmetic that makes that true is small
 * enough to put on a readout and watch.
 *
 * The robot is swerve_drive_robot_description's, at its own size: a
 * 0.15 by 0.09 m deck, modules at the corners of a 0.12 m square, 10 mm
 * wheels. The controller is demos/swerve.js, which carries what it checked
 * against swerve_drive_control.cpp and where the two differ.
 *
 * The slider is the bay. Hold a spin rate and put the goal somewhere, and
 * the base drives a straight line to it while rotating -- which no other
 * machine in this building can do, and which is the whole reason anybody
 * builds one of these.
 */
/* The course, and it is smaller than the others on purpose.
 *
 * Every other bench in this building runs a 2.70 by 3.40 m course because
 * that is what a TurtleBot wants -- 0.14 m of robot across twenty of its own
 * widths. This robot is the same footprint and a fifth of the height: a
 * 15 mm deck, which from a lens twenty degrees above it is a sliver. Looked
 * at in the page at the full size it was a white speck at the edge of an
 * empty slab and the cell read as switched off.
 *
 * So the course is sized to the machine rather than to the bench. Half the
 * others puts the base at about the same fraction of the frame a Burger
 * occupies in the local control bay, which is the ratio that was already
 * known to read, and leaves the rest of the bench as what it is: bench. */
const COURSE_X = 1.35, COURSE_Y = 1.70;
const TICK = 1 / 50;
/* How hard it chases the goal. A swerve base has no heading constraint on
   its translation, so this is two independent proportional terms and not a
   pursuit controller -- there is no arc to follow. */
const KP = 1.6;
const ARRIVE = 0.10;
const CONES = [[-0.28, 0.31, 0.05], [0.29, 0.11, 0.05],
               [-0.09, -0.35, 0.05], [0.36, -0.52, 0.05]];
const START = [-0.45, -0.65, 0.5];

/* The three ways to run it, and two of them are deliberately wrong. */
const MODE = { GOOD: 0, NOFLIP: 1, THREE: 2 };
/* Points of trail, and how far apart they are laid. 0.04 m is about a
   quarter of the deck, so the heading ticks read as a comb rather than as a
   smear, and 220 of them is nine metres of course -- long enough to hold a
   whole run and short enough to fade before it becomes wallpaper. */
const TRAIL = 220, TRAIL_STEP = 0.025, TICK_LEN = 0.045;

/* How far the spin control goes, and it is derived rather than picked. A pure
   spin saturates the modules at maxV / SPIN_R = 6.5 rad/s with nothing left
   over; 2.4 spends 0.204 m/s of the 0.55 on rotation and leaves the rest for
   actually going somewhere, which is the point of the bay. */
const SPIN_MAX = Math.round((SWERVE.maxV / SPIN_R) * 0.37 * 10) / 10;

export default function SwerveRig({ stop }) {
  const s = stop.side;
  const x = s * WORK;

  const [sim, ready] = useSim(() => swerveScene({ start: START, cones: CONES }), []);
  const pose = useRef({ x: START[0], y: START[1], yaw: START[2], travel: 0, turned: 0 });
  const goal = useRef(new THREE.Vector2(0.42, 0.60));
  const over = useRef(false);
  const touched = useRef(false);
  const kit = useMemo(() => ({
    mods: scratch(),                 // what the controller commanded
    read: scratch(),                 // what the simulation is doing
    now: [0, 0, 0, 0],               // measured steer angles
    ask: { vx: 0, vy: 0, w: 0 },
    did: { vx: 0, vy: 0, w: 0 },
    spin: 0.0, mode: MODE.GOOD, acc: 0, flips: 0, arrived: 0, runs: 1,
    open: true, rest: 0,
    /* Where it has been, and the deck's own heading at each of those points.
     *
     * A swerve base driving a straight line while its chassis rotates is the
     * entire claim of this bay, and neither half of it is visible in a still
     * or in a 0.15 m robot four metres away. The line is where it went; the
     * ticks across it are which way it was facing when it was there, and the
     * two disagreeing is the thing no differential base can do. */
    trail: new Float32Array(TRAIL * 6), tn: 0, lastX: 1e9, lastY: 1e9
  }), []);
  const deck = useRef();
  const steer = useRef([]);
  const wheel = useRef([]);
  const flag = useRef();
  const arrows = useRef();
  const trail = useRef();

  function reset() {
    const sm = sim.current;
    pose.current = { x: START[0], y: START[1], yaw: START[2], travel: 0, turned: 0 };
    kit.flips = 0; kit.arrived = 0; kit.runs = 1; kit.open = true; kit.rest = 0;
    kit.tn = 0; kit.lastX = 1e9; kit.lastY = 1e9; kit.trail.fill(0);
    if (trail.current) trail.current.geometry.setDrawRange(0, 0);
    if (sm) sm.place("sw_free", START[0], START[1], SWERVE.wheelR + 0.005, START[2]);
  }

  /* Somewhere else worth going, for when nobody is holding the cursor. */
  function wander() {
    for (let t = 0; t < 60; t++) {
      const gx = (Math.random() - 0.5) * (COURSE_X - 0.25);
      const gy = (Math.random() - 0.5) * (COURSE_Y - 0.25);
      let clear = true;
      for (const c of CONES) if (Math.hypot(gx - c[0], gy - c[1]) < c[2] + 0.16) clear = false;
      if (!clear || Math.hypot(gx - pose.current.x, gy - pose.current.y) < 0.5) continue;
      goal.current.set(gx, gy);
      return;
    }
  }

  useEffect(() => register(stop.id, {
    title: "Four modules, one twist",
    actions: [{ label: "Reset", on: reset }],
    choice: {
      get: () => kit.mode,
      set: (v) => { kit.mode = v; },
      options: [
        { value: MODE.GOOD, label: "As built" },
        { value: MODE.NOFLIP, label: "No flip" },
        { value: MODE.THREE, label: "Scale 3 of 4" }
      ]
    },
    slider: {
      label: "Spin", min: -SPIN_MAX, max: SPIN_MAX, step: 0.1,
      get: () => kit.spin,
      set: (v) => { kit.spin = v; },
      fmt: (v) => v.toFixed(1) + " rad/s"
    },
    readout: () => {
      const rows = MODULES.map((m, i) => [
        m.id,
        (kit.mods[i].a * 57.3).toFixed(0) + " deg, " + kit.mods[i].v.toFixed(2) + " m/s"
      ]);
      rows.push(["asked", kit.ask.vx.toFixed(2) + ", " + kit.ask.vy.toFixed(2)
                        + " m/s, " + kit.ask.w.toFixed(2) + " rad/s"]);
      rows.push(["the wheels did", kit.did.vx.toFixed(2) + ", " + kit.did.vy.toFixed(2)
                        + " m/s, " + kit.did.w.toFixed(2) + " rad/s"]);
      rows.push(["reached", kit.arrived + " of " + kit.runs]);
      return rows;
    },
    say: () => {
      if (!ready) return "Building the base.";
      if (Math.abs(kit.spin) > 0.15) {
        return `Driving where you point and spinning at ${kit.spin.toFixed(1)} rad/s at the `
             + `same time. Nothing else in this building can do that -- two wheels have to `
             + `turn before they can go.`;
      }
      if (kit.mode === MODE.NOFLIP) {
        return "Without the module optimisation. Send it backwards and watch the wheels take "
             + "the long way round, scrubbing the whole time.";
      }
      if (kit.mode === MODE.THREE) {
        return "Desaturating three modules of four, which is what the controller in the "
             + "repository does. Push the spin up until it saturates and the arc opens out.";
      }
      return "Move your cursor to put the goal somewhere, then drag the spin slider.";
    },
    hint: "The goal follows your cursor and the slider holds a spin rate. Where it goes and where it points are separate commands -- that is what four steerable modules buy you.",
    touched: () => touched.current,
    sim: () => !!sim.current,
    tick: (d) => step(d),
    state: () => {
      const q = pose.current;
      return { x: +q.x.toFixed(3), y: +q.y.toFixed(3), yaw: +q.yaw.toFixed(3),
               travel: +q.travel.toFixed(3), turned: +q.turned.toFixed(2),
               spin: kit.spin, mode: kit.mode, flips: kit.flips,
               runs: kit.runs, arrived: kit.arrived,
               ask: [+kit.ask.vx.toFixed(3), +kit.ask.vy.toFixed(3), +kit.ask.w.toFixed(3)],
               did: [+kit.did.vx.toFixed(3), +kit.did.vy.toFixed(3), +kit.did.w.toFixed(3)],
               sim: sim.current ? 1 : 0 };
    }
  }), [stop.id, kit, ready]);

  const _p = useMemo(() => new THREE.Vector3(), []);
  const _h = useMemo(() => new THREE.Vector3(), []);

  function step(d) {
    const sm = sim.current, q = pose.current;
    if (!sm) return;
    kit.acc += d;
    if (kit.acc >= TICK) {
      kit.acc = Math.min(kit.acc - TICK, TICK);
      /* The twist, in the body frame. The goal is in the course's frame, so
         the error is rotated into the body -- which is the whole of "field
         oriented" and is why a swerve base needs to know its own heading
         and a differential one does not. */
      const ex = goal.current.x - q.x, ey = goal.current.y - q.y;
      const dist = Math.hypot(ex, ey);
      const c = Math.cos(-q.yaw), sn = Math.sin(-q.yaw);
      let vx = (ex * c - ey * sn) * KP, vy = (ex * sn + ey * c) * KP;
      if (dist < ARRIVE) { vx = 0; vy = 0; }
      const sp = Math.hypot(vx, vy);
      if (sp > SWERVE.maxV) { vx *= SWERVE.maxV / sp; vy *= SWERVE.maxV / sp; }
      kit.ask.vx = vx; kit.ask.vy = vy; kit.ask.w = kit.spin;

      modules(vx, vy, kit.spin, kit.now, kit.mods,
              kit.mode !== MODE.NOFLIP, kit.mode === MODE.THREE);
      for (let i = 0; i < 4; i++) if (kit.mods[i].flip) kit.flips++;

      const names = SWERVE_MODULES;
      for (let i = 0; i < 4; i++) {
        sm.actuate(`sw_${names[i][0]}_s`, kit.mods[i].a);
        // A wheel speed is a rim speed; the joint wants rad/s.
        sm.actuate(`sw_${names[i][0]}_w`, kit.mods[i].v / SWERVE.wheelR);
      }

      /* And what the wheels are actually doing, read back and run through
         the forward kinematics. Two numbers on the readout that can
         disagree, which is the only way anybody can tell the controller is
         doing arithmetic rather than a puppet show. */
      for (let i = 0; i < 4; i++) {
        kit.now[i] = sm.jointAt(`sw_${names[i][0]}_s`);
        kit.read[i].a = kit.now[i];
        kit.read[i].v = sm.jointVel(`sw_${names[i][0]}_w`) * SWERVE.wheelR;
      }
      odometry(kit.read, kit.did);

      /* Arrived: count it and go somewhere else.
       *
       * This was two branches gated on `runs === arrived`, and the first
       * thing that happens is a run opening -- which makes them unequal, so
       * neither branch could fire again and the base parked on its first
       * goal and stayed there. Looked at in the page: a stationary speck, a
       * readout of zeros and "reached 0 of 1". One flag, and the flag is
       * whether a run is open. */
      if (dist < ARRIVE) {
        if (kit.open) { kit.arrived++; kit.open = false; kit.rest = 0; }
        kit.rest += TICK;
        // A beat on the spot so arriving is something you see, then off again.
        if (kit.rest > 1.2 && !over.current) { wander(); kit.runs++; kit.open = true; }
      } else if (!kit.open) {
        kit.runs++; kit.open = true;
      }
    }

    sm.step(d);
    sm.point("sw", _p);
    sm.dir("sw", 0, _h);
    const nx = _p.x, ny = -_p.z;
    q.travel += Math.hypot(nx - q.x, ny - q.y);
    const nyaw = Math.atan2(-_h.z, _h.x);
    let dy = nyaw - q.yaw;
    while (dy > Math.PI) dy -= 2 * Math.PI;
    while (dy < -Math.PI) dy += 2 * Math.PI;
    q.turned += Math.abs(dy);
    q.x = nx; q.y = ny; q.yaw = nyaw;

    if (Math.hypot(nx - kit.lastX, ny - kit.lastY) > TRAIL_STEP) {
      kit.lastX = nx; kit.lastY = ny;
      const t = kit.trail, i = (kit.tn % TRAIL) * 6;
      /* One segment per point: a tick across the path at the deck's own
         heading, which is what makes "it went that way facing this way"
         legible. The path itself is the line of their midpoints. */
      t[i] = nx - Math.sin(nyaw) * TICK_LEN * 0.5;
      t[i + 1] = ny + Math.cos(nyaw) * TICK_LEN * 0.5;
      t[i + 2] = 0.003;
      t[i + 3] = nx + Math.sin(nyaw) * TICK_LEN * 0.5;
      t[i + 4] = ny - Math.cos(nyaw) * TICK_LEN * 0.5;
      t[i + 5] = 0.003;
      kit.tn++;
      const g = trail.current;
      if (g) {
        g.geometry.attributes.position.array.set(t);
        g.geometry.attributes.position.needsUpdate = true;
        g.geometry.setDrawRange(0, Math.min(kit.tn, TRAIL) * 2);
        g.geometry.computeBoundingSphere();
      }
    }

    paint();
  }

  /* Draw the base at what the simulation says, and the four commanded
     directions as stubs out of each module -- the controller's answer, on
     the floor, next to the wheels that are following it. */
  function paint() {
    const sm = sim.current, q = pose.current;
    if (!sm) return;
    if (deck.current) {
      deck.current.position.set(q.x, q.y, SWERVE.wheelR + 0.005);
      deck.current.rotation.z = q.yaw;
    }
    for (let i = 0; i < 4; i++) {
      const st = steer.current[i], wh = wheel.current[i];
      if (st) st.rotation.z = kit.now[i];
      if (wh) wh.rotation.y = sm.jointAt(`sw_${SWERVE_MODULES[i][0]}_w`);
    }
    const g = arrows.current;
    if (g) {
      const pos = g.geometry.attributes.position.array;
      for (let i = 0; i < 4; i++) {
        const m = MODULES[i];
        const cx = q.x + m.x * Math.cos(q.yaw) - m.y * Math.sin(q.yaw);
        const cy = q.y + m.x * Math.sin(q.yaw) + m.y * Math.cos(q.yaw);
        const a = q.yaw + kit.mods[i].a;
        /* A floor on the length, because a module that is pointing somewhere
           while standing still is still the answer the controller gave and a
           zero-length line says nothing. Looked at in the page: a base at
           rest drew four invisible stubs and the cell read as switched off. */
        const len = 0.10 + Math.abs(kit.mods[i].v) * 0.55;
        const sgn = kit.mods[i].v < 0 ? -1 : 1;
        const o = i * 6;
        pos[o] = cx; pos[o + 1] = cy; pos[o + 2] = 0.004;
        pos[o + 3] = cx + Math.cos(a) * len * sgn;
        pos[o + 4] = cy + Math.sin(a) * len * sgn;
        pos[o + 5] = 0.004;
      }
      g.geometry.attributes.position.needsUpdate = true;
      g.geometry.computeBoundingSphere();
    }
    if (flag.current) flag.current.position.set(goal.current.x, goal.current.y, 0.02);
  }

  const trailGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(TRAIL * 6), 3));
    g.setDrawRange(0, 0);
    return g;
  }, []);
  useEffect(() => () => trailGeo.dispose(), [trailGeo]);

  const arrowGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(4 * 6), 3));
    return g;
  }, []);
  useEffect(() => () => arrowGeo.dispose(), [arrowGeo]);

  useFrame(({ camera }, dt) => {
    if (!isLive(stop, camera)) return;
    step(Math.min(0.05, dt));
  });

  const D = SWERVE.deck;
  return (
    <group position={[x, 0.9, 0]} rotation-y={s > 0 ? Math.PI : 0}>
      <group rotation-x={-Math.PI / 2}>
        <mesh
          name={"pad-" + stop.id}
          position={[0, 0, 0.002]}
          onPointerMove={(e) => {
            touched.current = true;
            e.stopPropagation();
            const p = e.object.worldToLocal(e.point.clone());
            goal.current.set(
              Math.max(-COURSE_X / 2 + 0.06, Math.min(COURSE_X / 2 - 0.06, p.x)),
              Math.max(-COURSE_Y / 2 + 0.06, Math.min(COURSE_Y / 2 - 0.06, p.y)));
            over.current = true;
          }}
          onClick={(e) => e.stopPropagation()}
          onPointerOver={() => { over.current = true; }}
          onPointerOut={() => { over.current = false; }}
        >
          <planeGeometry args={[COURSE_X, COURSE_Y]} />
          <meshStandardMaterial color={"#1b1d21"} roughness={0.95} metalness={0.05} />
        </mesh>

        {CONES.map((c, i) => (
          <mesh key={i} position={[c[0], c[1], 0.045]} castShadow receiveShadow>
            <cylinderGeometry args={[c[2] * 0.6, c[2], 0.09, 16]} />
            <meshStandardMaterial color={P.hazard} roughness={0.7} metalness={0.05} />
          </mesh>
        ))}

        <lineSegments ref={trail} geometry={trailGeo} frustumCulled={false}>
          <lineBasicMaterial color={P.machine} transparent opacity={0.32} />
        </lineSegments>

        <lineSegments ref={arrows} geometry={arrowGeo} frustumCulled={false}>
          <lineBasicMaterial color={P.teal} transparent opacity={0.9} />
        </lineSegments>

        <mesh ref={flag} position={[0.42, 0.60, 0.02]}>
          <cylinderGeometry args={[0.014, 0.014, 0.04, 12]} />
          <meshStandardMaterial color={P.accent} emissive={P.accent}
            emissiveIntensity={0.5} roughness={0.5} />
        </mesh>

        {/* The robot, drawn from the dimensions its own description states.
            No baked mesh: this project has the UR12e's and the Burger's and
            the Go2's triangles, and not this one's, and a stand-in dressed
            up as a scan would be worse than a box that is honestly a box. */}
        <group ref={deck}>
          <mesh position={[0, 0, D[2] / 2 + 0.004]} castShadow receiveShadow>
            <boxGeometry args={[D[0], D[1], D[2]]} />
            <meshStandardMaterial color={P.machine} roughness={0.5} metalness={0.35} />
          </mesh>
          {/* A stripe down the deck, because a base whose heading you cannot
              read is a base whose whole point you cannot see. */}
          <mesh position={[D[0] * 0.22, 0, D[2] + 0.005]}>
            <boxGeometry args={[D[0] * 0.36, 0.012, 0.002]} />
            <meshStandardMaterial color={P.hazard} emissive={P.hazard}
              emissiveIntensity={0.5} roughness={0.5} />
          </mesh>
          {MODULES.map((m, i) => (
            <group key={m.id} position={[m.x, m.y, 0]}
                   ref={el => (steer.current[i] = el)}>
              <mesh position={[0, 0, 0.0015]} castShadow>
                <cylinderGeometry args={[0.015, 0.015, 0.003, 14]} />
                <meshStandardMaterial color={P.steelDk} roughness={0.6} metalness={0.5} />
              </mesh>
              <group position={[0, 0, -0.005]} ref={el => (wheel.current[i] = el)}>
                <mesh rotation-x={Math.PI / 2} castShadow>
                  <cylinderGeometry args={[SWERVE.wheelR, SWERVE.wheelR, SWERVE.wheelW, 14]} />
                  <meshStandardMaterial color={"#232326"} roughness={0.85} />
                </mesh>
                {/* One spoke, so a spinning wheel looks like one. */}
                <mesh position={[SWERVE.wheelR * 0.5, 0, 0]}>
                  <boxGeometry args={[SWERVE.wheelR * 0.9, SWERVE.wheelW + 0.001, 0.002]} />
                  <meshStandardMaterial color={P.machine} roughness={0.6} />
                </mesh>
              </group>
            </group>
          ))}
        </group>
      </group>
    </group>
  );
}
