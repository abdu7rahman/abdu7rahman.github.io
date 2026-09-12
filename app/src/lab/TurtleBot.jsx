import { useEffect, useMemo, useRef, useState } from "react";
import { ASSET } from "../lib/paths.js";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { creaseNormals } from "../lib/mesh.js";
import { UPRIGHT } from "../../../world/kinematics.js";
import { P } from "../lib/palette.js";

/* A TurtleBot3 Burger, driving. ROBOTIS' own triangles, Apache-2.0, baked by
 * tools/bake_mobile.py from the pinned turtlebot3_description meshes: 15,542
 * triangles, 309 KB, the four plates and their M3 standoffs decimated per
 * solid because a whole-mesh quadric collapse ate the plates. The bake writes
 * down that measurement; this file is only concerned with driving it.
 *
 * Four cells show this machine -- search, local control, race and cloned --
 * so, like the arm, it is fetched once and shared; what differs between them
 * is the controller driving it, which is not this file's.
 *
 * The colours came out of turtlebot3_burger.urdf rather than out of the mesh,
 * because STL carries no material at all: light_black for the plates, dark
 * for the tyres and the scanner. They are treated the way UR12e.jsx treats
 * the arm's -- pulled a third of the way toward the room's machine grey, so
 * the machines are lit by the same building instead of each bringing its own
 * -- with one correction to how they are read in, which the note over `parts`
 * sets out with the numbers.
 */

/* Everything below is read off turtlebot3_description/urdf/turtlebot3_burger.urdf
   in the commit assets/turtlebot3.json names, except the two ceilings, which
   come from turtlebot3_teleop/turtlebot3_teleop/script/teleop_keyboard.py in
   the same repository. None of it is estimated and none of it is tuned. */
const BASE_Z = 0.010;          // base_joint: base_footprint -> base_link
const WHEEL_L_Y = 0.08;        // wheel_left_joint  xyz
const WHEEL_R_Y = -0.080;      // wheel_right_joint xyz
const WHEEL_Z = 0.023;         // both wheel joints
const WHEEL_RX = -1.57;        // both wheel joints, rpy="-1.57 0 0"
const SCAN = [-0.032, 0, 0.172];   // scan_joint xyz, a fixed joint
const TRACK = WHEEL_L_Y - WHEEL_R_Y;               // 0.160 m between the axles
const TYRE_R = 0.033;          // the wheel collision cylinder's radius, and
                               // what left_tire.stl measures: 33.0 mm in both
                               // of its in-plane axes, 9.1 mm half-width
/* Exported, because a controller written elsewhere in this building has to
   obey the same ceilings the robot does. A planner that drives this machine
   at a speed its own teleop node refuses is a planner whose result means
   nothing. */
export const MAX_V = 0.22;     // BURGER_MAX_LIN_VEL, m/s
export const MAX_W = 2.84;     // BURGER_MAX_ANG_VEL, rad/s

/* Those numbers close on each other, which is the check that the model is
   standing rather than floating: base_link is 0.010 above base_footprint, the
   axle 0.023 above base_link, the tyre radius 0.033. 0.010 + 0.023 - 0.033 is
   zero, so base_footprint really is the contact plane and the robot sits on
   the bench with nothing added to make it. The baked wheel geometry agrees --
   its lowest vertex lands at base_link z = -0.0099. */

let cached = null;
let warned = false;

export function useTurtleBot() {
  const [mesh, setMesh] = useState(cached);
  useEffect(() => {
    if (cached) return;
    let live = true;
    fetch(ASSET("turtlebot3.json"))
      .then(r => r.ok ? r.json() : Promise.reject(new Error(r.status)))
      .then(j => { cached = j; if (live) setMesh(j); })
      .catch(() => {});
    return () => { live = false; };
  }, []);
  return mesh;
}

export default function TurtleBot({ scale = 1, tint, pose }) {
  const mesh = useTurtleBot();
  const groups = useRef([]);
  const drive = useRef();
  const M = useMemo(() => ({
    link: new THREE.Matrix4(), joint: new THREE.Matrix4(),
    spin: new THREE.Matrix4(), tilt: new THREE.Matrix4()
  }), []);

  /* One geometry per part, built once, as the arm's are, with one deliberate
     difference. UR12e.jsx builds its own colour with `new THREE.Color(r,g,b)`,
     which takes three floats as already being in three's working space, and
     that space is linear -- while `new THREE.Color(P.machine)` parses a hex
     string and converts it from sRGB on the way in. So the two sides of the
     lerp below were never in the same space. The bake's RGB comes off a URDF
     <material> and a COLLADA <effect> and both of those are sRGB, so read as
     linear they render brighter than they are: 102, which is the Burger's
     light_black, displays as 170 before any light reaches it and 181 after
     the pull toward the room. Named as sRGB it is 102 and 146. That is the
     difference between a dark grey machine and a pale one, and this robot is
     dark grey. The arm is left alone -- its own meshes are pale to begin
     with, and correcting it is not this change's business. */
  const parts = useMemo(() => {
    if (!mesh) return null;
    const room = new THREE.Color(P.machine);
    return mesh.links.map(link =>
      link.parts.map(part => {
        const n = part.f.length;
        const pos = new Float32Array(n * 3);
        for (let k = 0; k < n; k++) {
          const s = part.f[k] * 3;
          pos[k*3]     = part.v[s]     * mesh.unit;
          pos[k*3 + 1] = part.v[s + 1] * mesh.unit;
          pos[k*3 + 2] = part.v[s + 2] * mesh.unit;
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
        g.setAttribute("normal", new THREE.BufferAttribute(creaseNormals(pos, 78), 3));
        const own = new THREE.Color().setRGB(
          part.c[0]/255, part.c[1]/255, part.c[2]/255, THREE.SRGBColorSpace);
        const col = own.lerp(tint ? new THREE.Color(tint) : room, 0.34);
        return { geometry: g, color: col };
      })
    );
  }, [mesh, tint]);

  /* The URDF chain, given the two wheel angles. One place the frames are
     built, for all four cells that drive one of these. */
  const poseLinks = (phiL, phiR) => {
    for (let li = 0; li < groups.current.length; li++) {
      const g = groups.current[li];
      if (!g) continue;
      const name = mesh.links[li].name;
      if (name === "base_link") {
        M.link.makeTranslation(0, 0, BASE_Z);
      } else if (name === "base_scan") {
        M.link.makeTranslation(SCAN[0], SCAN[1], BASE_Z + SCAN[2]);
      } else {
        // Joint origin, then the joint's own rpy, then the wheel angle about
        // the axis that rpy just laid down. The baked tyre already carries the
        // <visual> rpy that undoes it, so the mesh lands the right way up.
        const left = name === "wheel_left_link";
        M.joint.makeTranslation(0, left ? WHEEL_L_Y : WHEEL_R_Y, BASE_Z + WHEEL_Z);
        M.tilt.makeRotationX(WHEEL_RX);
        M.spin.makeRotationZ(left ? phiL : phiR);
        M.link.multiplyMatrices(M.joint, M.tilt).multiply(M.spin);
      }
      g.matrix.copy(M.link);
      g.matrixWorldNeedsUpdate = true;
    }
  };

  useFrame(() => {
    if (!parts) return;

    /* Driven from outside, always: a bay that shows this machine is a bay
       running a controller over it. It used to carry a canned traverse as
       well -- a raised-cosine run up the bench and back, with the run length
       taken off its own swept radius -- for the bays that only stood one
       next to a picture of its demo. There are no such bays left, so that
       went, and with it the profile, the turn constant and the swept radius
       nothing else measured.

       The wheel arithmetic is the same either way and always was, which is
       the only reason the wheels stayed honest through all of it: the same
       odometer, the same URDF frames. */
    const q = pose && pose.current;
    if (!q) return;

    /* A pose missing `turned` is a caller that has not integrated its
       heading, and the arithmetic below turns that into NaN on both wheels
       -- a base that drives perfectly with wheels that never move, which is
       exactly what the cloned cell shipped until somebody looked at it. Said
       once, loudly, rather than drawn. */
    if (!Number.isFinite(q.travel) || !Number.isFinite(q.turned)) {
      if (!warned) {
        warned = true;
        console.error("TurtleBot: pose needs finite travel and turned, got "
                      + q.travel + " and " + q.turned);
      }
      return;
    }

    if (drive.current) {
      /* No quarter turn. The traverse that used to live here measured its
         heading from the bench's y axis, because it drove along
         setPosition(0, p, 0), and added pi/2 to point the baked base_link --
         which is +x forward -- along y. Every controller in this building
         integrates x += cos(psi) and y += sin(psi), so its psi is measured
         from x and is already the model's own forward. Adding the quarter
         turn to that renders the machine exactly perpendicular to its
         velocity: all three Burger bays crabbed, and in the local control
         cell the argmin arc the planner drew left the robot's left flank. */
      drive.current.matrix
        .makeRotationZ(q.psi)
        .setPosition(q.x, q.y, 0);
      drive.current.matrixWorldNeedsUpdate = true;
    }

    /* The wheel angles are the travel, not a rate that happens to look right
       next to it. A differential drive's left contact point advances by
       s - (b/2) psi and its right by s + (b/2) psi; divide by the tyre radius
       and that is the angle each wheel must have turned through to have
       rolled there without slipping. Turning on the spot falls out of the
       same two terms with s held fixed, which is why the wheels
       counter-rotate through a pivot without being told to. */
    poseLinks((q.travel - (TRACK / 2) * q.turned) / TYRE_R,
              (q.travel + (TRACK / 2) * q.turned) / TYRE_R);
  });

  if (!parts) return null;
  return (
    <group scale={scale} onUpdate={g => g.setRotationFromMatrix(UPRIGHT)}>
      <group matrixAutoUpdate={false} ref={drive}>
        {parts.map((link, li) => (
          <group key={li} matrixAutoUpdate={false} ref={el => (groups.current[li] = el)}>
            {link.map((p, pi) => (
              <mesh key={pi} geometry={p.geometry} castShadow receiveShadow>
                <meshStandardMaterial color={p.color} roughness={0.44} metalness={0.52} />
              </mesh>
            ))}
          </group>
        ))}
      </group>
    </group>
  );
}
