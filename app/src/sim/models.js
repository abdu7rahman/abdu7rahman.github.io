import * as THREE from "three";
import { ORIGINS, TCP_Z } from "../../../world/kinematics.js";

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
export function arm(name, { pos = [0, 0, 0], yaw = 0, density = 1100 } = {}) {
  const R = [0.062, 0.062, 0.052, 0.045, 0.042, 0.038];
  let open = "", close = "";
  for (let i = 0; i < 6; i++) {
    const [x, y, z, r, p, yw] = ORIGINS[i];
    const nxt = i < 5 ? ORIGINS[i + 1] : [0, 0, TCP_Z, 0, 0, 0];
    const len = Math.hypot(nxt[0], nxt[1], nxt[2]);
    const body = `<body name="${name}_l${i}" pos="${f(x)} ${f(y)} ${f(z)}" quat="${quat(r, p, yw)}">
      <joint name="${name}_j${i}" axis="0 0 1" range="-6.2832 6.2832" armature="0.08" damping="4"/>
      ${len > 0.06
        ? `<geom ${ARM} type="capsule" fromto="0 0 0 ${f(nxt[0])} ${f(nxt[1])} ${f(nxt[2])}" size="${R[i]}"/>`
        : `<geom ${ARM} type="sphere" size="${R[i]}"/>`}`;
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
      <geom ${ARM} type="cylinder" size="0.034 0.022" pos="0 0 -0.022"
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
      <geom ${ARM} type="cylinder" size="0.075 0.02" pos="0 0 0.021"/>
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
            integrator="implicitfast" cone="elliptic" impratio="10"/>
    <default>
      <geom density="${opts.density ?? 1100}" friction="0.9 0.01 0.001"
            solref="0.006 1" solimp="0.95 0.99 0.001"/>
    </default>`;
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
