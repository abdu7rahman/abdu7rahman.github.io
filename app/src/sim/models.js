import * as THREE from "three";
import { ORIGINS, TCP_Z } from "../../../world/kinematics.js";
import { LEGS, HIP, SIDE, ABD, THIGH, CALF } from "../lab/demos/crawl.js";

/* The MJCF the cells are simulated from, written out of the same numbers the
 * cells are drawn from.
 *
 * The arm's six joint origins come from world/kinematics.js, which took them
 * from config/ur12e/default_kinematics.yaml in the pinned robot description.
 * They are not typed again here: the generator reads the array. So the body
 * MuJoCo integrates and the mesh three draws cannot drift apart, which is the
 * failure mode a hand-written model has and the only reason to generate one.
 *
 * What is not the vendor's, and is said so plainly: the inertias. A UR's link
 * masses and inertia tensors are not in the kinematics file, so the arm here
 * is a chain of capsules at a stated density and MuJoCo computes mass and
 * inertia from those. That is an approximation of a real arm's dynamics, not
 * a model of this one -- it gets the scale, the coupling and the sag right
 * and it will not reproduce a vendor's payload curve. The kinematics are
 * exact; the dynamics are plausible; nothing in between is being passed off
 * as measured.
 *
 * Everything is metres, radians and kilograms, and z is up, because that is
 * what MJCF is. app/src/sim/engine.js turns the poses back into the scene's
 * y-up on the way out.
 */

/* Collision groups, and this is not a detail: without them the arm folds
 * into itself.
 *
 * MuJoCo collides two geoms when either one's contype shares a bit with the
 * other's conaffinity. A serial chain drawn as capsules has neighbouring
 * links that overlap by construction -- they share an endpoint -- and MuJoCo
 * only excludes parent and child, so the shoulder sphere and the elbow
 * capsule collide the moment the arm bends. Measured before this was in:
 * seven contacts, every one of the six actuators saturated at its torque
 * limit, zero joint velocity and 2.05 rad of tracking error. The arm was not
 * failing to reach its command, it was wrestling itself.
 *
 * So arm never touches arm, arm touches the world and anything loose, and
 * anything loose touches the world. A hand is loose but nothing collides with
 * a hand except the arm, because it is the reader's cursor and it is not
 * meant to knock a part off a bench.
 */
const ARM = 'contype="1" conaffinity="6"';
const WORLD = 'contype="2" conaffinity="7"';
const OBJ = 'contype="4" conaffinity="3"';
const HAND = 'contype="4" conaffinity="1"';

const _e = new THREE.Euler();
const _q = new THREE.Quaternion();

/* URDF fixed-axis XYZ is intrinsic ZYX, which is the one thing about this
   conversion that everybody gets wrong once. Written as a quaternion in the
   MJCF rather than as euler angles so the compiler's own eulerseq -- another
   convention, with its own default -- never enters into it. */
function quat(r, p, y) {
  _e.set(r, p, y, "ZYX");
  _q.setFromEuler(_e);
  return `${_q.w} ${_q.x} ${_q.y} ${_q.z}`;
}

const f = n => (Math.round(n * 1e6) / 1e6).toString();

/* One arm, as a nested chain.
 *
 * Body i sits at ORIGINS[i] and carries a hinge about its own z, which is
 * exactly what linkFrames() does: frame_i = O[0] Rz(q0) O[1] Rz(q1) ... So
 * the chain below and the forward kinematics beside it are the same product
 * of the same matrices in the same order.
 *
 * The capsule in body i runs from that joint to where the next joint sits,
 * because that is what a link is. Two of the six origins are almost pure
 * rotations -- the shoulder and one wrist -- so the link between them has no
 * length to speak of and gets a sphere instead; a zero-length capsule is
 * rejected by the compiler and a nearly-zero-length one is a sphere with
 * extra steps.
 */
/* Where the last link's collision geometry stops, and it is not the tool
 * point.
 *
 * The chain below draws each link from its own joint to where the next one
 * sits, and for the last one "the next one" was the tool centre -- a capsule
 * of 38 mm radius running the whole 156 mm from wrist three to the point the
 * jaws are supposed to close on. That was harmless while the gripper was an
 * adhesion actuator with no body. It is not harmless now: the gripper is
 * real geometry in that same space, so the arm carried a 76 mm sausage
 * through its own jaws and out to the grasp point.
 *
 * What that does to the sorting cell was measured rather than guessed.
 * Every descent, on every tool, contact `l_g5 -> <tool>`: the link resting
 * on the thing the gripper was reaching for. The wrist actuator sat pinned
 * at its 56 N m ceiling for the whole phase, the joint stayed 0.09 rad from
 * its command, and the tool point settled 45 mm above where it had been
 * sent -- more than the 33 mm a pad clears the work by, so a jaw came down
 * on top of the tool instead of beside it. The cell sorted one tool in six
 * over four hundred simulated seconds and the reason was that the arm could
 * not physically get its jaws around anything.
 *
 * So the link ends where the gripper begins: TCP_Z - 0.046 is the `_tcp`
 * body's own origin, which is the flange the two-finger gripper bolts to.
 * Everything past it is already modelled, once, by the gripper. */
const FLANGE = TCP_Z - 0.046;

export function arm(name, { pos = [0, 0, 0], yaw = 0, density = 1100 } = {}) {
  /* The last radius is the wrist housing's, not a guess at a gripper's: the
     gripper's own cylinder below is 34 mm and the two are the same part of
     the machine. */
  const R = [0.062, 0.062, 0.052, 0.045, 0.042, 0.034];
  let open = "", close = "";
  for (let i = 0; i < 6; i++) {
    const [x, y, z, r, p, yw] = ORIGINS[i];
    const nxt = i < 5 ? ORIGINS[i + 1] : [0, 0, FLANGE, 0, 0, 0];
    const len = Math.hypot(nxt[0], nxt[1], nxt[2]);
    const body = `<body name="${name}_l${i}" pos="${f(x)} ${f(y)} ${f(z)}" quat="${quat(r, p, yw)}">
      <joint name="${name}_j${i}" axis="0 0 1" range="-6.2832 6.2832" armature="0.08" damping="4"/>
      ${len > 0.06
        ? `<geom name="${name}_g${i}" ${ARM} type="capsule" fromto="0 0 0 ${f(nxt[0])} ${f(nxt[1])} ${f(nxt[2])}" size="${R[i]}"/>`
        : `<geom name="${name}_g${i}" ${ARM} type="sphere" size="${R[i]}"/>`}`;
    open += body;
    close = "</body>" + close;
  }
  /* The tool frame, as a body with no mass, so a cell can ask the simulator
     where the gripper is instead of running its own kinematics to find out. */
  /* A two-finger gripper, and this replaced an adhesion actuator for
     robustness rather than for realism, though it is more realistic too.
  
     Adhesion is a force applied to whatever is inside a detection margin, so
     it needs that margin wide enough to survive a part swinging on it -- and
     a wide margin around a moving tool centre is a long-range attractor with
     a hard contact underneath it. Measured across three settings: at 140 N it
     fired a 0.1 kg wrench 2.4 m off the bench, at 45 N tools slipped out of
     the carry, and at both a tool caught between the gripper and the bench
     went numerically unstable and ended 126 m away. None of that is the
     gripper being wrong about grip, it is a stiff attractor stacked on a
     stiff contact.
  
     Two fingers on slide joints closing on friction is the thing itself, and
     MuJoCo solves it as an ordinary contact problem. A grip either has enough
     friction and normal force or it does not, it cannot act at a distance,
     and nothing about it can run away. */
  /* The body is placed so the pads' centre lands exactly on TCP_Z, which is
     the point sim/ik.js solves for. Everything downstream then gets to talk
     about where the grip is rather than about where the wrist is: a cell
     commanding the tool point to a tool's own centre puts the jaws around it,
     and an offset in a rig is a real offset rather than a correction for this
     file's geometry. */
  open += `<body name="${name}_tcp" pos="0 0 ${f(TCP_Z - 0.046)}">
      <geom name="${name}_wrist" ${ARM} type="cylinder" size="0.034 0.022" pos="0 0 -0.022"
            rgba="0.8 0.8 0.85 1" mass="0.5"/>
      <site name="${name}_grip" pos="0 0 0.046" size="0.008"/>
      <!-- The jaw, and its joint value is half the gap between the pads.
           
           It was not. With ref="0.05" the reference configuration sat at a
           command of 0.05 and the pads were modelled coincident there, so
           the joint ran backwards: measured on the compiled scene, a command
           of 0.050 put the pad centres 8 mm apart -- 16 mm pads
           interpenetrating -- and 0.006 put them 88 mm apart. The cell was
           commanding 0.05 to grasp and 0.006 to release, so every "close"
           opened the jaw and every "open" shut it on nothing. Over 150
           simulated seconds no tool was ever lifted higher than 30 mm: the
           pads swept six tools around a bench and picked up none of them.
           
           The pads now start touching at zero and each slides outward with
           its own joint, so the gap is twice the command and a bigger number
           is a wider jaw, which is what the name says. -->
      <body name="${name}_fa" pos="0 0 0.03">
        <joint name="${name}_ga" type="slide" axis="1 0 0" range="0 0.046"
               damping="6" armature="0.004"/>
        <geom name="${name}_pa" ${ARM} type="box" size="0.008 0.018 0.016" pos="0.008 0 0.016" mass="0.06"
              friction="2.2 0.05 0.002" rgba="0.55 0.57 0.6 1"/>
      </body>
      <body name="${name}_fb" pos="0 0 0.03">
        <joint name="${name}_gb" type="slide" axis="-1 0 0" range="0 0.046"
               damping="6" armature="0.004"/>
        <geom name="${name}_pb" ${ARM} type="box" size="0.008 0.018 0.016" pos="-0.008 0 0.016" mass="0.06"
              friction="2.2 0.05 0.002" rgba="0.55 0.57 0.6 1"/>
      </body>
    </body>`;
  close = "</body>" + close;

  const chain = `<body name="${name}_base" pos="${f(pos[0])} ${f(pos[1])} ${f(pos[2])}"
      euler="0 0 ${f(yaw)}">
      <geom name="${name}_plinth" ${ARM} type="cylinder" size="0.075 0.02" pos="0 0 0.021"/>
      ${open}${close}`;

  /* Position servos, which is what a joint controller on a real arm is. The
     gains and the torque ceilings are the model's own: they are chosen so the
     arm holds itself and tracks a command without ringing, not copied off a
     datasheet this project cannot check. The first three carry the arm and
     the last three carry a wrist, which is why they differ by a factor of six.
  */
  /* Stiffer by three, and the torque ceilings do not move with it.
   *
   * A position servo's standing error is whatever torque it has to hold
   * divided by its gain, so an arm reaching out over a bench sags by exactly
   * as much as it is soft. Measured on this cell at the old gains, the
   * settled joint error was 0.057 rad at the shoulder and 0.046 at the wrist
   * -- about 40 mm at the tool point, against a gripper that only clears the
   * work it is reaching for by 33. So a jaw pad came down on the tool rather
   * than beside it, every time, and nothing downstream could recover.
   *
   * Tripling the gain divides that error by three. It asks for no more force:
   * the torque needed to hold the arm up is a property of the arm and the
   * pose, and what changes is only how much error the servo needs to produce
   * it. The ceilings stay where they are, which is what keeps a blocked arm
   * from pushing through a bench. dampratio holds at 1, so it is still
   * critically damped, and the integrator was already implicitfast for
   * exactly this case -- the model's own note says stiff position servos are
   * what explicit Euler loses. */
  const kp = [12600, 12600, 7800, 2700, 2100, 1500];
  const fr = [330, 330, 180, 56, 56, 56];
  let act = "";
  for (let i = 0; i < 6; i++) {
    act += `<position name="${name}_a${i}" joint="${name}_j${i}" kp="${kp[i]}"
      dampratio="1" forcerange="-${fr[i]} ${fr[i]}"/>`;
  }
  /* Both fingers on one command, which is what a parallel gripper is. The
     force ceiling is what decides whether a grip holds: 90 N through a pad at
     friction 2.2 carries a tool that weighs a couple of newtons with a wide
     margin, and will still lose it if the arm is thrown about.
  
     The range runs to 3 mm rather than 12 and the joints open at their own
     reference, and both of those are fixes. Commanding a jaw to exactly its
     own limit makes the servo fight the limit constraint instead of the
     thing it is holding -- measured, one finger sat at 49 mm pulling 33 N
     and never moved -- and a slide joint whose zero is outside its range
     starts the model resolving a violation it did not need to have. */
  for (const j of ["ga", "gb"]) {
    act += `<position name="${name}_${j}" joint="${name}_${j}" kp="900"
      dampratio="1" forcerange="-90 90" ctrlrange="0 0.046"/>`;
  }
  return { body: chain, act, density };
}

/* The shared head of every scene: the solver settings, the defaults and the
   floor. gravity is earth's; the integrator is implicitfast because a
   position-servoed arm with stiff gains is exactly the case explicit Euler
   loses, and it costs nothing here. */
function head(opts = {}) {
  return `<mujoco model="cell">
    <compiler angle="radian" autolimits="true"/>
    <option timestep="${opts.timestep ?? 0.002}" gravity="0 0 -9.81"
            integrator="implicitfast" cone="elliptic"
            impratio="${opts.impratio ?? 10}"/>
    <default>
      <geom density="${opts.density ?? 1100}" friction="0.9 0.01 0.001"
            solref="0.006 1" solimp="0.95 0.99 0.001"/>
    </default>`;
}

/* A TurtleBot3 Burger, as a machine rather than as a pose.
 *
 * The wheeled cells integrated a unicycle by hand -- q.x += cos(psi) * v * dt
 * -- which is the model the controllers are written against and is not a
 * robot. A unicycle cannot slip, cannot be pushed, cannot tip, and arrives
 * wherever the arithmetic says regardless of what is in the way: drive a
 * commanded velocity at a wall and the wall is simply where the drawing
 * overlaps. Every one of those is a thing this bay claims to be showing.
 *
 * So the Burger is built here and driven through its wheels. The numbers are
 * ROBOTIS's own, the same ones lab/TurtleBot.jsx draws from: 0.160 m between
 * the axles, a 0.033 m tyre, the axle 0.023 above base_link, 0.22 m/s and
 * 2.84 rad/s at the ceiling, and about a kilogram all told.
 *
 * Two wheels and a caster, which is what a Burger is. The caster is a low
 * friction sphere rather than a third wheel because that is what a ball
 * caster does and because a rolling joint there would be a joint whose only
 * job is to not resist -- the friction number does that in one line.
 *
 * Velocity actuators on the hinges, with a torque ceiling. A differential
 * drive turns (v, w) into two wheel speeds exactly -- wl = (v - w T / 2) / R
 * and wr = (v + w T / 2) / R -- so a controller written for a unicycle needs
 * no changes at all to drive this; what changes is that the wheels can now
 * fail to deliver. The ceiling is 0.1 Nm, which at a 0.033 m tyre is 3 N of
 * tractive effort per wheel against a 1 kg robot: enough to accelerate it in
 * about a tenth of a second and not enough to shove a drum out of the way,
 * which is the distinction the cell exists to show.
 */
export const BURGER = {
  track: 0.160,       // between the axles
  tyre: 0.033,        // rolling radius
  axle: 0.023,        // axle height above base_link
  maxV: 0.22,         // BURGER_MAX_LIN_VEL
  maxW: 2.84          // BURGER_MAX_ANG_VEL
};

/* Wheel speeds for a body velocity, which is the whole of a differential
   drive and is exact rather than fitted. */
export function wheelsFor(v, w) {
  const half = (w * BURGER.track) / 2;
  return [(v - half) / BURGER.tyre, (v + half) / BURGER.tyre];
}

export function burger(name, { pos = [0, 0], yaw = 0 } = {}) {
  const R = BURGER.tyre, T = BURGER.track;
  /* The chassis sits so that base_link is `axle` above the wheel centres,
     which puts the whole robot at the height its own URDF says. */
  const z = R;
  const body = `<body name="${name}" pos="${f(pos[0])} ${f(pos[1])} ${f(z)}"
      euler="0 0 ${f(yaw)}">
      <freejoint name="${name}_free"/>
      <!-- The mass, as one low box, and low is the whole of it.
           
           The plates and standoffs are drawn by lab/TurtleBot.jsx from the
           vendor's own mesh; what the physics needs from them is where the
           mass is. Written first as a box the height of the real deck stack,
           it put the centre of mass 88 mm up over a 160 mm track, and a
           machine whose published turn rate is 2.84 rad/s rolled itself over
           inside two seconds -- measured, the body climbed from 33 mm to
           48 mm, shed two of its four contacts and flipped.
           
           Low was necessary and it was not sufficient. Lowered to 63 mm it
           still rolled over, and the reason is in the contact count: two,
           for a robot with two wheels and a caster, all the way to the floor.
           The mass was centred on the axle, so nothing pressed the caster
           down -- a two-wheeled machine balanced on its axle line, which
           falls over whichever way it is nudged and did, in about four
           seconds, every time.
           
           So the box sits back, between the axle and the caster, which is
           where a Burger's battery and motors actually are. Gravity then
           carries the caster and the robot stands on three points. -->
      <geom ${WORLD} type="box" size="0.045 0.045 0.025" pos="-0.022 0 0.030"
            mass="0.85" rgba="0.4 0.42 0.45 0"/>
      <body name="${name}_wl" pos="0 ${f(T / 2)} 0">
        <!-- Armature is the rotor and gearbox seen from the output shaft, and
             it is what makes a velocity actuator behave. Without it the wheel
             has only the tyre's own inertia, the servo's correction arrives
             as a step, and the contact spends every tick recovering from the
             last one. -->
        <joint name="${name}_wl" type="hinge" axis="0 1 0"
               armature="0.0008" damping="0.002"/>
        <geom ${WORLD} type="cylinder" size="${f(R)} 0.009" euler="1.5708 0 0"
              mass="0.05" friction="1.4 0.02 0.002" rgba="0.2 0.2 0.22 0"/>
      </body>
      <body name="${name}_wr" pos="0 ${f(-T / 2)} 0">
        <joint name="${name}_wr" type="hinge" axis="0 1 0"
               armature="0.0008" damping="0.002"/>
        <geom ${WORLD} type="cylinder" size="${f(R)} 0.009" euler="1.5708 0 0"
              mass="0.05" friction="1.4 0.02 0.002" rgba="0.2 0.2 0.22 0"/>
      </body>
      <!-- The ball caster, aft, riding on almost nothing. -->
      <geom ${WORLD} type="sphere" size="0.012" pos="-0.052 0 ${f(-R + 0.012)}"
            mass="0.01" friction="0.04 0.005 0.0002" rgba="0.3 0.3 0.32 0"/>
    </body>`;
  const act = `<velocity name="${name}_wl" joint="${name}_wl" kv="0.6"
                 forcerange="-0.1 0.1"/>
               <velocity name="${name}_wr" joint="${name}_wr" kv="0.6"
                 forcerange="-0.1 0.1"/>`;
  return { body, act };
}

/* A bench top with Burgers on it, which is the drive cell, the race cell and
 * anything else that wants wheels.
 *
 * The obstacles are mocap bodies for the same reason the replan cell's is --
 * a thing the reader drags has to push the robot without the robot pushing
 * back, or the first contact throws the cursor across the bench. They are
 * still real geometry to the robot, which is the point: it has to go round
 * them because it cannot go through them, not because a cost term said so.
 */
export function wheeledScene({ starts = [[0, 0, 0]], obstacles = [],
                               radius = 0.12, walls = 0, cell = 0.1 } = {}) {
  const bots = starts.map((st, i) =>
    burger(`tb${i}`, { pos: [st[0], st[1]], yaw: st[2] || 0 }));
  const obs = obstacles.map((o, i) => `
    <body name="obs${i}" mocap="true" pos="${f(o[0])} ${f(o[1])} 0.09">
      <geom ${WORLD} type="cylinder" size="${f(o[2] || radius)} 0.09"
            rgba="0.45 0.47 0.5 0"/>
    </body>`).join("");
  /* A pool of wall blocks, as mocap bodies.
   *
   * The search cell's map is editable -- a reader drags to build a wall and
   * drags again to knock it down -- so the set of occupied cells changes
   * while the scene is running, and recompiling a physics model on every
   * drag is not a thing that can happen at sixty frames a second. A fixed
   * pool written every frame is: the blocks that are wanted get put where
   * the map says, and the rest are parked well under the floor where nothing
   * can reach them. Mocap is right for them for the same reason it is right
   * for the drive cell's drums -- the reader moves them and they do not move
   * back. */
  const wall = Array.from({ length: walls }, (_, i) => `
    <body name="wall${i}" mocap="true" pos="0 0 -5">
      <geom ${WORLD} type="box" size="${f(cell / 2)} ${f(cell / 2)} 0.05"
            rgba="0.3 0.32 0.35 0"/>
    </body>`).join("");
  return `${head({ timestep: 0.004 })}
    <worldbody>
      <geom name="floor" ${WORLD} type="plane" size="4 4 0.1"
            friction="1.0 0.02 0.002" rgba="0.3 0.3 0.32 0"/>
      ${bots.map(b => b.body).join("")}${obs}${wall}
    </worldbody>
    <actuator>${bots.map(b => b.act).join("")}</actuator>
  </mujoco>`;
}

/* A swerve base, as four steer-and-drive modules on a deck.
 *
 * Every dimension is swerve_drive_robot_description's: the deck is
 * 0.15 by 0.09 by 0.015 m, the modules mount at (+/-0.06, +/-0.06), the
 * wheels are 10 mm radius and 10 mm wide. It is a small robot and it is
 * drawn at the size it is, like everything else in this building.
 *
 * Each module is a body on a hinge about z carrying a body on a hinge about
 * its own y: steer is a position servo, drive is a velocity servo, which is
 * what the URDF's two transmissions are. The steer joint has no range, and
 * that is the point of the module optimisation in demos/swerve.js -- a
 * module that can turn either way forever is one that never has to unwind.
 *
 * The deck sits on the wheels and nothing else, so the base is statically
 * determinate on four contacts and will tip if the mass is put anywhere
 * silly. The URDF's own 0.5 kg deck over a 0.12 m square is stable; the
 * mass is kept at deck height rather than lowered, because a swerve base
 * that only stands up because its centre of mass was moved is not the robot
 * the description describes.
 */
export const SWERVE_MODULES = [["fl", 1, 1], ["fr", 1, -1], ["rr", -1, -1], ["rl", -1, 1]];

export function swerve(name, { pos = [0, 0], yaw = 0, half = 0.06,
                               wheelR = 0.01, wheelW = 0.01,
                               deck = [0.15, 0.09, 0.015] } = {}) {
  const z = wheelR + 0.005;         // the URDF's steering link sits 5 mm up
  let body = `<body name="${name}" pos="${f(pos[0])} ${f(pos[1])} ${f(z)}"
      euler="0 0 ${f(yaw)}">
      <freejoint name="${name}_free"/>
      <geom ${WORLD} type="box" size="${f(deck[0] / 2)} ${f(deck[1] / 2)} ${f(deck[2] / 2)}"
            pos="0 0 ${f(deck[2] / 2 + 0.004)}" mass="0.5" rgba="0.4 0.42 0.45 0"/>`;
  for (const [id, sx, sy] of SWERVE_MODULES) {
    body += `
      <body name="${name}_${id}" pos="${f(sx * half)} ${f(sy * half)} 0">
        <joint name="${name}_${id}_s" type="hinge" axis="0 0 1"
               armature="0.0004" damping="0.004"/>
        <geom ${WORLD} type="cylinder" size="0.015 0.0015" pos="0 0 0.0015"
              mass="0.01" rgba="0.3 0.32 0.36 0"/>
        <body name="${name}_${id}_w" pos="0 0 ${f(-0.005)}">
          <!-- Armature for the same reason the Burger's wheels have it: a
               velocity servo on a wheel with only the tyre's inertia gets
               its correction as a step and spends every tick recovering
               from the last one. -->
          <joint name="${name}_${id}_w" type="hinge" axis="0 1 0"
                 armature="0.0002" damping="0.0008"/>
          <geom ${WORLD} type="cylinder" size="${f(wheelR)} ${f(wheelW / 2)}"
                euler="1.5708 0 0" mass="0.05"
                friction="1.6 0.02 0.002" rgba="0.2 0.2 0.22 0"/>
        </body>
      </body>`;
  }
  body += "</body>";
  let act = "";
  for (const [id] of SWERVE_MODULES) {
    /* Steer is a position servo and drive is a velocity servo, which is the
       pair of transmissions the URDF declares. The steer gain is what holds
       a module against the scrub of a wheel that is being driven while it
       turns; the force ceilings are the URDF's own effort limits. */
    act += `<position name="${name}_${id}_s" joint="${name}_${id}_s" kp="8"
              dampratio="1" forcerange="-10 10"/>`;
    act += `<velocity name="${name}_${id}_w" joint="${name}_${id}_w" kv="0.06"
              forcerange="-0.5 0.5"/>`;
  }
  return { body, act };
}

/* The swerve bay: one base on a floor, with cones to drive between. */
export function swerveScene({ start = [0, 0, 0], cones = [] } = {}) {
  const s = swerve("sw", { pos: [start[0], start[1]], yaw: start[2] || 0 });
  const obs = cones.map((c, i) => `
    <body name="cone${i}" mocap="true" pos="${f(c[0])} ${f(c[1])} 0.06">
      <geom ${WORLD} type="cylinder" size="${f(c[2] || 0.06)} 0.06" rgba="0.5 0.3 0.1 0"/>
    </body>`).join("");
  return `${head({ timestep: 0.002 })}
    <worldbody>
      <geom name="floor" ${WORLD} type="plane" size="4 4 0.1"
            friction="1.2 0.02 0.002" rgba="0.3 0.3 0.32 0"/>
      ${s.body}${obs}
    </worldbody>
    <actuator>${s.act}</actuator>
  </mujoco>`;
}

/* The replan cell: one arm on a bench, a part in front of it, and a movable
 * obstacle the reader pushes into its way.
 *
 * Where the hand and the part start is a real constraint, not dressing. Both
 * were first written where they looked right on paper and both were inside
 * the arm's own rest pose, so the scene opened with the arm wrestling a
 * sphere it could not move: six contacts, every actuator pinned at its torque
 * ceiling and 2.05 rad of tracking error. Off the arm, the same model holds
 * its commanded pose to 0.0208 rad on gravity-hold torques of 88 and 40 Nm,
 * which is what a 20.7 kg arm should need.
 *
 * The obstacle is a mocap body rather than a free one. A mocap body is
 * positioned directly by whatever is driving it and takes no forces back,
 * which is exactly what a hand in a workspace is: it pushes the robot and the
 * robot does not push it. Made free instead, the first collision would send
 * the reader's cursor flying across the bench.
 */
export function replanScene() {
  const a = arm("ur", { pos: [0, 0, 0.0] });
  return `${head()}
    <worldbody>
      <geom name="bench" ${WORLD} type="box" size="1.3 1.5 0.02" pos="0 0 -0.02" rgba="0.29 0.3 0.32 1"/>
      <light pos="0 0 2.4" dir="0 0 -1" diffuse="0.8 0.8 0.8"/>
      ${a.body}
      <body name="hand" mocap="true" pos="0.95 0.85 0.62">
        <geom name="handgeom" ${HAND} type="sphere" size="0.20" rgba="0.31 0.70 0.66 0.5"/>
      </body>
      <body name="part" pos="0.74 -0.62 0.035">
        <freejoint/>
        <geom ${OBJ} type="box" size="0.05 0.05 0.03" density="700" rgba="1 0.42 0.12 1"/>
      </body>
    </worldbody>
    <actuator>${a.act}</actuator>
  </mujoco>`;
}

/* The sorting cell: two arms, a bench of tools, and a bin either side.
 *
 * The task is the one in the recordings this project actually collected --
 * a bimanual UR5e sorting tools -- rather than a generic pick and place. Six
 * tools start scattered on the bench at angles nobody chose; long ones belong
 * in the far bin and short ones in the near bin; each arm takes whatever is
 * nearest it that nobody else has claimed. Two arms working the same bench at
 * the same time is the whole point, and it is emergent rather than
 * choreographed: there is no shared script, only two controllers and one
 * claim on each tool.
 *
 * Every tool is a free body with mass and a real shape. A wrench is a bar, a
 * hammer is a handle with a head on one end, and the head is where the mass
 * is -- so a hammer picked up at the middle of its handle swings, and a
 * gripper that lets go early drops it in the wrong bin or on the floor. None
 * of that is scripted either.
 */
export const SORT = {
  base: 0.55,        // how far either side of the centreline an arm stands
  mount: 0.30,       // and how high its pedestal is
  /* Four bins, two on each arm's own side, and that is a correction rather
     than a flourish. With one long bin and one short bin it was possible for
     an arm at +y to claim a short tool whose bin sat at -y, 1.21 m away --
     past what a tool-down solve on this arm can reach. The IK saturated, the
     arm stopped short, and it opened its gripper over the wrong bin. Measured
     over 90 simulated seconds: 3 of 6 sorted, one tool released into the bin
     next to the one it belonged in, and one knocked off the bench. Giving
     each arm its own pair means every tool an arm can pick up has a bin that
     arm can also reach, which is how a real cell is laid out for exactly this
     reason. bin[0] is where long tools go and bin[1] short; the sign of y is
     whichever arm is carrying. */
  bin: [[0.36, 0.70], [0.76, 0.70]],
  /* Where the tools start, what they are, and which bin they belong in. Laid
     out by hand rather than seeded: a scatter that happens to put two tools
     on top of each other is a scatter that starts the cell with a collision,
     and the point of the arrangement is that both arms have work in reach. */
  tools: [
    { id: "wrench_a", kind: "bar",    len: 0.150, at: [0.48,  0.30], yaw:  0.4, bin: 0 },
    { id: "wrench_b", kind: "bar",    len: 0.150, at: [0.70,  0.10], yaw: -0.9, bin: 0 },
    { id: "hammer",   kind: "hammer", len: 0.145, at: [0.52, -0.02], yaw:  1.2, bin: 0 },
    { id: "driver_a", kind: "shaft",  len: 0.085, at: [0.62,  0.34], yaw:  0.2, bin: 1 },
    { id: "driver_b", kind: "shaft",  len: 0.085, at: [0.44, -0.26], yaw: -0.5, bin: 1 },
    { id: "socket",   kind: "shaft",  len: 0.075, at: [0.66, -0.32], yaw:  0.9, bin: 1 }
  ]
};

function tool(t) {
  const [x, y] = t.at;
  const half = t.len / 2;
  const body = t.kind === "hammer"
    ? `<geom ${OBJ} type="capsule" fromto="${f(-half)} 0 0 ${f(half * 0.65)} 0 0" size="0.011"
             density="700" rgba="0.55 0.42 0.28 1"/>
       <geom ${OBJ} type="box" size="0.026 0.016 0.016" pos="${f(half * 0.82)} 0 0"
             density="7200" rgba="0.35 0.36 0.38 1"/>`
    : t.kind === "bar"
    ? `<geom ${OBJ} type="box" size="${f(half)} 0.016 0.008" density="7000"
             rgba="0.62 0.64 0.68 1"/>`
    : `<geom ${OBJ} type="capsule" fromto="${f(-half)} 0 0 ${f(half)} 0 0" size="0.010"
             density="1600" rgba="1 0.42 0.12 1"/>`;
  return `<body name="${t.id}" pos="${f(x)} ${f(y)} 0.03" euler="0 0 ${f(t.yaw)}">
      <freejoint/>${body}
    </body>`;
}

export function sortScene() {
  const B = SORT.base, M = SORT.mount;
  const l = arm("l", { pos: [0, B, M], yaw: -Math.PI / 2 });
  const r = arm("r", { pos: [0, -B, M], yaw: Math.PI / 2 });
  /* A bin is four walls and a floor rather than a marked square, because a
     tool that lands badly should bounce off a wall and stay in, which is what
     a bin is for. */
  const bin = (name, bx, y) => {
    const w = 0.20, d = 0.17, h = 0.075, t = 0.012;
    return `<body name="${name}" pos="${f(bx)} ${f(y)} 0">
      <geom ${WORLD} type="box" size="${f(w)} ${f(d)} ${f(t)}" pos="0 0 ${f(t)}" rgba="0.26 0.27 0.29 1"/>
      <geom ${WORLD} type="box" size="${f(t)} ${f(d)} ${f(h)}" pos="${f(-w)} 0 ${f(h)}" rgba="0.3 0.31 0.33 1"/>
      <geom ${WORLD} type="box" size="${f(t)} ${f(d)} ${f(h)}" pos="${f(w)} 0 ${f(h)}" rgba="0.3 0.31 0.33 1"/>
      <geom ${WORLD} type="box" size="${f(w)} ${f(t)} ${f(h)}" pos="0 ${f(-d)} ${f(h)}" rgba="0.3 0.31 0.33 1"/>
      <geom ${WORLD} type="box" size="${f(w)} ${f(t)} ${f(h)}" pos="0 ${f(d)} ${f(h)}" rgba="0.3 0.31 0.33 1"/>
    </body>`;
  };
  return `${head()}
    <worldbody>
      <!-- A floor under everything, because a free body that leaves the bench
           has to land on something: without it a dropped tool falls for as
           long as the simulation runs. -->
      <geom name="floor" ${WORLD} type="plane" size="6 6 0.1" pos="0 0 -0.95" rgba="0.2 0.2 0.22 1"/>
      <!-- The bench runs out in front of the arms rather than under them, so
           nothing has to fold into it to reach the work. -->
      <geom name="bench" ${WORLD} type="box" size="0.68 0.92 0.02" pos="0.56 0 -0.02" rgba="0.29 0.3 0.32 1"/>
      <!-- A lip round the bench, because a tool nudged by an arm that missed
           should stay on it. Measured without one: a hammer went over the near
           edge and the cell had five tools left and no way to get the sixth. -->
      <geom ${WORLD} type="box" size="0.68 0.012 0.02" pos="0.56 0.93 0.02" rgba="0.33 0.34 0.36 1"/>
      <geom ${WORLD} type="box" size="0.68 0.012 0.02" pos="0.56 -0.93 0.02" rgba="0.33 0.34 0.36 1"/>
      <geom ${WORLD} type="box" size="0.012 0.94 0.02" pos="1.25 0 0.02" rgba="0.33 0.34 0.36 1"/>
      <geom ${WORLD} type="box" size="0.012 0.94 0.02" pos="-0.13 0 0.02" rgba="0.33 0.34 0.36 1"/>
      <geom name="postl" ${WORLD} type="cylinder" size="0.09 ${f(M / 2)}" pos="0 ${f(B)} ${f(M / 2)}" rgba="0.29 0.3 0.32 1"/>
      <geom name="postr" ${WORLD} type="cylinder" size="0.09 ${f(M / 2)}" pos="0 ${f(-B)} ${f(M / 2)}" rgba="0.29 0.3 0.32 1"/>
      <light pos="0.5 0 2.4" dir="0 0 -1" diffuse="0.8 0.8 0.8"/>
      ${l.body}
      ${r.body}
      ${SORT.tools.map(tool).join("")}
      ${bin("bin_long_l", SORT.bin[0][0], SORT.bin[0][1])}
      ${bin("bin_short_l", SORT.bin[1][0], SORT.bin[1][1])}
      ${bin("bin_long_r", SORT.bin[0][0], -SORT.bin[0][1])}
      ${bin("bin_short_r", SORT.bin[1][0], -SORT.bin[1][1])}
    </worldbody>
    <actuator>${l.act}${r.act}</actuator>
  </mujoco>`;
}

/* A Unitree Go2, as physics.
 *
 * Every number is Unitree's, taken from go2_description by way of
 * mujoco_menagerie's own go2.xml (BSD-3-Clause, DeepMind's transcription of
 * Unitree's URDF): link masses and diagonal inertias, the inertial frames
 * they are expressed in, joint ranges, joint damping and armature, the
 * motor torque limits, and the collision primitives -- which the vendor
 * already writes as boxes, cylinders and a sphere at each foot, so nothing
 * here is a proxy somebody chose. lab/Go2.jsx draws the same robot from the
 * same description's meshes; this is what moves it.
 *
 * Position actuators rather than the vendor's torque motors, for the same
 * reason the UR arm here uses them: what drives this is a heuristic gait
 * that thinks in joint angles, and a torque motor would need a joint
 * controller in front of it that would be a PD anyway. The force ranges are
 * the published ones, so the thing that cannot be exceeded is still the
 * thing Unitree says cannot be exceeded.
 */
export const GO2 = {
  stand: 0.27,                 // the menagerie keyframe's trunk height
  home: [0, 0.9, -1.8],        // and its joint angles, per leg
  trunk: [0.1881, 0.04675, 0.057]
};

/* Which limit each hip joint carries. The URDF gives the front legs
   [-1.5708, 3.4907] and the rear [-0.5236, 4.5379], which is not symmetry
   anybody would invent and is why it is quoted rather than derived. */
const HIP_RANGE = { FL: "-1.5708 3.4907", FR: "-1.5708 3.4907",
                    RL: "-0.5236 4.5379", RR: "-0.5236 4.5379" };
/* The inertial frames, which are per leg because the left and right sides
   are mirrors and the front and rear hips are not. Quaternions w first. */
const LEG_I = {
  hip: {
    FL: ["-0.0054 0.00194 -0.000105", "0.497014 0.499245 0.505462 0.498237"],
    FR: ["-0.0054 -0.00194 -0.000105", "0.498237 0.505462 0.499245 0.497014"],
    RL: ["0.0054 0.00194 -0.000105", "0.505462 0.498237 0.497014 0.499245"],
    RR: ["0.0054 -0.00194 -0.000105", "0.499245 0.497014 0.498237 0.505462"]
  },
  thighQ: ["0.829533 0.0847635 -0.0200632 0.551623",
           "0.551623 -0.0200632 0.0847635 0.829533"],
  calfQ: ["0.710672 0.00154099 -0.00450087 0.703508",
          "0.703508 -0.00450087 0.00154099 0.710672"]
};

/* The dog's own contact class. It touches the ground and nothing else in
   the cell, which is what its bay contains: one piece of terrain. */
const DOG = 'contype="8" conaffinity="2"';

function go2Leg(name, k) {
  const s = SIDE[k], [hx, hy] = HIP[k], L = s > 0 ? 0 : 1;
  const [ip, iq] = LEG_I.hip[k];
  return `
    <body name="${name}_${k}_hip" pos="${f(hx)} ${f(hy)} 0">
      <inertial pos="${ip}" quat="${iq}" mass="0.678"
        diaginertia="0.00088403 0.000596003 0.000479967"/>
      <joint name="${name}_${k}_hip" axis="1 0 0" range="-1.0472 1.0472"
             damping="2" armature="0.01" frictionloss="0.2"/>
      <geom ${DOG} type="cylinder" size="0.046 0.02" pos="0 ${f(0.08 * s)} 0"
            quat="1 1 0 0" friction="0.6" margin="0.001" condim="1" rgba="0 0 0 0"/>
      <body name="${name}_${k}_thigh" pos="0 ${f(ABD * s)} 0">
        <inertial pos="-0.00374 ${f(-0.0223 * s)} -0.0327" quat="${LEG_I.thighQ[L]}"
          mass="1.152" diaginertia="0.00594973 0.00584149 0.000878787"/>
        <joint name="${name}_${k}_thigh" axis="0 1 0" range="${HIP_RANGE[k]}"
               damping="2" armature="0.01" frictionloss="0.2"/>
        <geom ${DOG} type="box" size="0.1065 0.01225 0.017" pos="0 0 -0.1065"
              quat="0.707107 0 0.707107 0" friction="0.6" margin="0.001"
              condim="1" rgba="0 0 0 0"/>
        <body name="${name}_${k}_calf" pos="0 0 ${f(-THIGH)}">
          <inertial pos="0.00629595 ${f(-0.000622121 * s)} -0.141417"
            quat="${LEG_I.calfQ[L]}" mass="0.241352"
            diaginertia="0.0014901 0.00146356 5.31397e-05"/>
          <joint name="${name}_${k}_calf" axis="0 1 0" range="-2.7227 -0.83776"
                 damping="2" armature="0.01" frictionloss="0.2"/>
          <geom ${DOG} type="cylinder" size="0.012 0.06" pos="0.008 0 -0.06"
                quat="0.994493 0 -0.104807 0" friction="0.6" margin="0.001"
                condim="1" rgba="0 0 0 0"/>
          <geom ${DOG} type="cylinder" size="0.011 0.0325" pos="0.02 0 -0.148"
                quat="0.999688 0 0.0249974 0" friction="0.6" margin="0.001"
                condim="1" rgba="0 0 0 0"/>
          <!-- The foot. priority and condim 6 are the vendor's: the foot wins
               the contact parameters over whatever it lands on, which is how
               a rubber pad on rock behaves and not how MuJoCo's default
               averaging would have it. -->
          <geom name="${name}_${k}_foot" ${DOG} type="sphere" size="0.022"
                pos="-0.002 0 ${f(-CALF)}" priority="1" solimp="0.015 1 0.022"
                condim="6" friction="0.8 0.02 0.01" rgba="0 0 0 0"/>
        </body>
      </body>
    </body>`;
}

export function go2(name, { pos = [0, 0], z = GO2.stand, yaw = 0 } = {}) {
  const body = `<body name="${name}" pos="${f(pos[0])} ${f(pos[1])} ${f(z)}"
      euler="0 0 ${f(yaw)}">
      <inertial pos="0.021112 0 -0.005366" quat="-0.000543471 0.713435 -0.00173769 0.700719"
        mass="6.921" diaginertia="0.107027 0.0980771 0.0244531"/>
      <freejoint name="${name}_free"/>
      <geom ${DOG} type="box" size="${GO2.trunk.map(f).join(" ")}"
            friction="0.6" margin="0.001" condim="1" rgba="0 0 0 0"/>
      ${LEGS.map(k => go2Leg(name, k)).join("")}
    </body>`;
  /* Torque motors, which is what Unitree ships and what the menagerie's own
     model uses, rather than the position servos this started with.
   *
   * A position servo can only ever pull a joint toward an angle. A leg that
   * has to hold a trunk level against a slope, or catch it when something
   * shoves it, needs to apply a force at the foot -- and the torques that
   * make a given foot force are the leg Jacobian transposed times that
   * force, which is not something a per-joint angle command can express.
   * demos/crawl.js computes the twelve torques; this is the actuator that
   * takes them. The ctrl ranges are the published ones, so the thing that
   * cannot be exceeded is still what Unitree says cannot be exceeded. */
  const act = LEGS.map(k => `
    <motor name="${name}_${k}_hip" joint="${name}_${k}_hip" ctrlrange="-23.7 23.7"/>
    <motor name="${name}_${k}_thigh" joint="${name}_${k}_thigh" ctrlrange="-23.7 23.7"/>
    <motor name="${name}_${k}_calf" joint="${name}_${k}_calf" ctrlrange="-45.43 45.43"/>`
  ).join("");
  return { body, act };
}

/* The cost bay: one height field, and a dog standing on it.
 *
 * The terrain is a MuJoCo hfield rather than a mesh, and it is the same
 * array the four planners read and the same array the bench top's vertices
 * are displaced by -- written in after the model compiles, because MJCF can
 * only load hfield data from a file. So the ground the dog's feet touch is
 * the ground the cost functions are arguing about, to the sample. There is
 * no second copy to drift.
 *
 * The hfield's grid spans one cell less than the course in each axis, with
 * ncol by nrow vertices: that puts its outer vertices exactly on the outer
 * cell centres, which is where the rig's own PlaneGeometry puts them.
 */
export function terrainScene({ nx, ny, cell, relief, start = [0, 0, 0] } = {}) {
  const g = go2("dog", { pos: [start[0], start[1]], yaw: start[2] });
  return `${head({ timestep: 0.002, impratio: 100 })}
    <asset>
      <hfield name="ground" nrow="${ny}" ncol="${nx}"
              size="${f((nx * cell - cell) / 2)} ${f((ny * cell - cell) / 2)}
                    ${f(relief)} 0.05"/>
    </asset>
    <worldbody>
      <geom name="floor" ${WORLD} type="hfield" hfield="ground"
            friction="0.9 0.01 0.001" rgba="0.3 0.3 0.32 0"/>
      ${g.body}
    </worldbody>
    <actuator>${g.act}</actuator>
  </mujoco>`;
}
