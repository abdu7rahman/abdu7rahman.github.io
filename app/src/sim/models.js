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
  open += `<body name="${name}_tcp" pos="0 0 ${f(TCP_Z)}">
      <geom ${ARM} type="sphere" size="0.028" mass="0.4" rgba="0.8 0.8 0.85 1"/>
      <site name="${name}_grip" pos="0 0 0" size="0.01"/>
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
  const kp = [4200, 4200, 2600, 900, 700, 500];
  const fr = [330, 330, 180, 56, 56, 56];
  let act = "";
  for (let i = 0; i < 6; i++) {
    act += `<position name="${name}_a${i}" joint="${name}_j${i}" kp="${kp[i]}"
      dampratio="1" forcerange="-${fr[i]} ${fr[i]}"/>`;
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

/* The assembly cell: two arms facing each other across a bench, a part, and a
 * fixture to put it in.
 *
 * The grip is a weld equality that the sequence switches on and off. That is
 * the honest cheap version of a gripper -- the alternative is two friction
 * pads and a closing force, which is a whole second problem and mostly
 * simulates how bad the pads are. A weld is still a physical constraint: when
 * it is off the part is a free body with mass, so releasing before the other
 * arm has hold of it drops it on the bench, which is the failure the sequence
 * is there to show cannot happen.
 */
export function assembleScene() {
  const l = arm("l", { pos: [0, 0.52, 0], yaw: -Math.PI / 2 });
  const r = arm("r", { pos: [0, -0.52, 0], yaw: Math.PI / 2 });
  return `${head()}
    <worldbody>
      <geom name="bench" ${WORLD} type="box" size="1.3 1.5 0.02" pos="0 0 -0.02" rgba="0.29 0.3 0.32 1"/>
      <light pos="0 0 2.4" dir="0 0 -1" diffuse="0.8 0.8 0.8"/>
      ${l.body}
      ${r.body}
      <body name="part" pos="0.42 0.34 0.04">
        <freejoint/>
        <geom ${OBJ} type="box" size="0.045 0.045 0.035" density="600" rgba="1 0.42 0.12 1"/>
      </body>
      <body name="fixture" pos="0.44 -0.36 0.0">
        <geom ${WORLD} type="box" size="0.09 0.09 0.02" pos="0 0 0.02" rgba="0.5 0.52 0.55 1"/>
        <geom ${WORLD} type="box" size="0.012 0.09 0.05" pos="-0.078 0 0.07" rgba="0.5 0.52 0.55 1"/>
        <geom ${WORLD} type="box" size="0.012 0.09 0.05" pos="0.078 0 0.07" rgba="0.5 0.52 0.55 1"/>
      </body>
    </worldbody>
    <equality>
      <weld name="grip_l" body1="l_tcp" body2="part" active="false" solref="0.004 1"/>
      <weld name="grip_r" body1="r_tcp" body2="part" active="false" solref="0.004 1"/>
    </equality>
    <actuator>${l.act}${r.act}</actuator>
  </mujoco>`;
}
