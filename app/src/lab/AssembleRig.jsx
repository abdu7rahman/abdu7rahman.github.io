import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import UR12e from "./UR12e.jsx";
import { linkFrames, toolPoint, REST } from "../../../world/kinematics.js";
import { lerpQ } from "./demos/via.js";
import { register, isRunning } from "./console.js";
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

/* hold: who is carrying the part *during* this phase, not at the end of it.
   0 is nobody -- it is on the bench where it was put down -- 1 the left arm,
   2 the right, and 3 is the handover, where both are on it and the arm that
   is about to keep it is the one whose frame the part is read from.

   During, and not at the end, because the phase list is walked from u = 0:
   reading the end state meant the cube jumped into a gripper at the start
   of the phase that picks it up, while that arm was still at its approach
   pose and half a metre away. */
const PHASES = [
  { name: "approach",  l: MEET_L, r: HOME_R, hold: 0 },
  { name: "pick",      l: MEET_L, r: HOME_R, hold: 1 },
  { name: "lift",      l: OVER_L, r: HOME_R, hold: 1 },
  { name: "present",   l: MEET_L, r: MEET_R, hold: 1 },
  { name: "handover",  l: MEET_L, r: MEET_R, hold: 3 },
  { name: "release",   l: OVER_L, r: MEET_R, hold: 2 },
  { name: "place",     l: HOME_L, r: MEET_R, hold: 2 },
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
    prev: 0, manual: 0,
    // Where the part is when nobody is holding it. Seeded at the pick.
    rest: new THREE.Vector3(0.42, 0.031, LEFT + 0.30)
  }), []);
  const qL = useRef(Float32Array.from(HOME_L));
  const qR = useRef(Float32Array.from(HOME_R));
  const part = useRef();
  const label = useRef({ phase: 0 });

  /* Step is the control this cell needs and pause is not enough on its own:
     the eight phases are the subject, and a sequence you can only stop is a
     sequence you cannot read one phase of. Holding the clock still and
     advancing a phase at a time is how anybody checks that the handover
     interval is a handover. */
  useEffect(() => register(stop.id, {
    title: "Bimanual, eight phases",
    actions: [{ label: "Step", on: () => { kit.manual = (kit.manual + 1) % PHASES.length; } }],
    readout: () => {
      const i = label.current.phase;
      return [
        ["phase", (i + 1) + " / " + PHASES.length],
        ["doing", PHASES[i].name],
        ["part", ["on the bench", "left arm", "right arm", "both"][PHASES[i].hold]]
      ];
    },
    hint: "Pause and step to read the handover, which is the only bimanual part."
  }), [stop.id, kit]);

  useFrame(({ clock }) => {
    /* Paused, the phase is whatever Step last set, and the arms sit in it
       rather than freezing mid-interpolation -- a held pose between two
       phases is not one of the eight and is not what somebody stepping
       through them is looking for. */
    if (!isRunning(stop.id)) {
      const i = kit.manual;
      lerpQ(PHASES[i].l, PHASES[i].l, 1, qL.current);
      lerpQ(PHASES[i].r, PHASES[i].r, 1, qR.current);
      label.current.phase = i;
      place(PHASES[i]);
      return;
    }
    const t = clock.elapsedTime / CYCLE;
    const i = Math.floor(t) % PHASES.length;
    const u = ease(t - Math.floor(t));
    const from = PHASES[(i - 1 + PHASES.length) % PHASES.length];
    const to = PHASES[i];
    lerpQ(from.l, to.l, u, qL.current);
    lerpQ(from.r, to.r, u, qR.current);
    label.current.phase = i;

    place(to);
  });

  /* The part rides whoever owns it, read through the same kinematics the arm
     is drawn with. During the handover -- hold 3 -- it rides the arm that is
     about to keep it, so the transfer is a change of owner and not a jump in
     position. Owned by nobody, it sits on the bench where it was left. */
  function place(to) {
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
      // Where it will be if the next phase puts it down.
      kit.rest.copy(part.current.position);
      kit.rest.y = 0.031;
    } else if (part.current) {
      /* Nobody is holding it, so it is where it was put down -- recorded
         when the last owner let go rather than written as a constant. It
         used to be a fixed spot beside the left arm, so at the end of a
         cycle the cube teleported off the right gripper and across the
         bench, undoing the handover the eight phases exist to show. */
      part.current.position.copy(kit.rest);
      part.current.visible = true;
    }
  }

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
