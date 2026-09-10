import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import UR12e from "./UR12e.jsx";
import { linkFrames, toolPoint, REST } from "../../../world/kinematics.js";
import { lerpQ } from "./demos/via.js";
import { P } from "../lib/palette.js";
import { WORK } from "../lib/plan.js";

/* Two arms, eight phases, one part.
 *
 * A bimanual sequence with a handover in the middle of it, which is the only
 * part of a bimanual task that is actually bimanual: everything either side
 * of it is two arms working independently, and the whole difficulty is the
 * interval where both are holding the same thing and neither may let go.
 *
 * The phases are a state machine and not a timeline. Each one names which
 * arm is moving, where it is going, and who owns the part when it gets
 * there; the part's pose is read from whichever gripper owns it through the
 * same forward kinematics the arms are posed with, so it is carried rather
 * than animated alongside. During the handover both own it, which is what
 * makes the interval visible: the part is held by the tool frame of the arm
 * that took it, and the arm that gave it stays on it until the phase ends.
 */
/* Where the two bases stand, in metres, and the axis matters more than the
   number. They are separated along the bench's 3.0 m side, which is the one
   that runs parallel to the aisle -- so from the dolly they stand side by
   side. Separated along the 2.6 m side instead, which is the bay's depth,
   they were one directly behind the other and read as a single arm with a
   doubled silhouette. */
const LEFT = -0.52, RIGHT = 0.52;
const CYCLE = 1.0;                   // seconds per phase, before easing

/* Six joint angles per pose, and the meeting pair was solved rather than
   typed.
 *
 * Two bases 1.04 m apart do not hand anything over at a base angle somebody
 * liked the look of. These came out of a sweep over base, shoulder, elbow
 * and wrist run through the same forward kinematics the bay draws with,
 * minimising the distance from each arm's tool centre to a point in front of
 * and between them: the result puts the two tools 83 mm apart, which is a
 * part's width and is what a handover looks like. The base angles are not
 * mirror images of each other -- 1.998 and -2.502 -- because a UR's zero
 * heading is not on the axis between the two bases, and assuming symmetry
 * there is exactly how a bimanual cell ends up with the arms passing beside
 * each other instead of to each other.
 *
 * Approach and home are that pose with the base swung outward and the arm
 * retracted, outward being the direction the sweep says moves each tool back
 * toward its own side of the bench. */
const q = (b, s, e, w1) => Float32Array.from([b, s, e, w1, -1.57, 0]);
const MEET_L = q( 1.998, -1.35, 1.60, -1.45);
const OVER_L = q( 2.350, -1.20, 1.42, -1.55);
const HOME_L = q( 2.750, -1.05, 1.15, -1.60);
const MEET_R = q(-2.502, -1.35, 1.60, -1.45);
const OVER_R = q(-2.850, -1.20, 1.42, -1.55);
const HOME_R = q(-3.250, -1.05, 1.15, -1.60);

/* who: which arm moves. hold: who owns the part at the end of the phase.
   0 is nobody, 1 the left arm, 2 the right, 3 both. */
const PHASES = [
  { name: "approach",  l: OVER_L, r: HOME_R, hold: 0 },
  { name: "pick",      l: MEET_L, r: HOME_R, hold: 1 },
  { name: "lift",      l: OVER_L, r: HOME_R, hold: 1 },
  { name: "present",   l: MEET_L, r: MEET_R, hold: 1 },
  { name: "handover",  l: MEET_L, r: MEET_R, hold: 3 },
  { name: "release",   l: OVER_L, r: MEET_R, hold: 2 },
  { name: "place",     l: HOME_L, r: OVER_R, hold: 2 },
  { name: "retreat",   l: HOME_L, r: HOME_R, hold: 0 }
];

// Smoothstep, so an arm eases out of one phase and into the next instead of
// arriving at constant joint velocity and stopping dead.
const ease = (u) => u * u * (3 - 2 * u);

export default function AssembleRig({ stop }) {
  const s = stop.side;
  const x = s * WORK;

  const kit = useMemo(() => ({
    frames: Array.from({ length: 6 }, () => new THREE.Matrix4()),
    tool: new THREE.Vector3(),
    prev: 0
  }), []);
  const qL = useRef(Float32Array.from(HOME_L));
  const qR = useRef(Float32Array.from(HOME_R));
  const part = useRef();
  const label = useRef({ phase: 0 });

  useFrame(({ clock }) => {
    const t = clock.elapsedTime / CYCLE;
    const i = Math.floor(t) % PHASES.length;
    const u = ease(t - Math.floor(t));
    const from = PHASES[(i - 1 + PHASES.length) % PHASES.length];
    const to = PHASES[i];
    lerpQ(from.l, to.l, u, qL.current);
    lerpQ(from.r, to.r, u, qR.current);
    label.current.phase = i;

    /* The part rides whoever owns it, read through the same kinematics the
       arm is drawn with. During the handover -- hold 3 -- it rides the arm
       that is about to keep it, so the transfer is a change of owner and not
       a jump in position. Owned by nobody, it sits on the bench where it
       was left. */
    const owner = to.hold === 3 ? 2 : to.hold;
    if (part.current && owner) {
      const src = owner === 1 ? qL.current : qR.current;
      const base = owner === 1 ? LEFT : RIGHT;
      linkFrames(src, kit.frames);
      toolPoint(kit.frames, kit.tool);
      /* Into the rig's own frame by hand, because the part is not a child of
         the arm that is holding it. toolPoint returns the tool centre in the
         arm's Z-up base frame; UPRIGHT sends (x, y, z) to (x, z, -y), and the
         base offset is added on the aisle axis afterwards. Doing it here
         rather than parenting the part to a gripper is what lets the
         handover be a change of owner instead of a reparent, which would
         make the part jump by whatever the two frames disagree about. */
      part.current.position.set(kit.tool.x, kit.tool.z, -kit.tool.y + base);
      part.current.visible = true;
    } else if (part.current) {
      // On the bench, resting on it: half the cube above the surface, which
      // is where a 60 mm cube standing on a table is.
      part.current.position.set(0.42, 0.031, LEFT + 0.30);
      part.current.visible = true;
    }
  });

  return (
    <group position={[x, 0.9, 0]}>
      {/* The part. A 60 mm cube, which is a size a Hand-E closes on. In the
          rig's own frame, not inside a rotation: the pose written to it above
          is already converted. */}
      <mesh ref={part} castShadow>
        <boxGeometry args={[0.06, 0.06, 0.06]} />
        <meshStandardMaterial color={P.hazard} roughness={0.55} metalness={0.2}
          emissive={P.hazard} emissiveIntensity={0.12} />
      </mesh>

      <group position={[0, 0, LEFT]}><UR12e q={qL} /></group>
      <group position={[0, 0, RIGHT]}><UR12e q={qR} /></group>
    </group>
  );
}
