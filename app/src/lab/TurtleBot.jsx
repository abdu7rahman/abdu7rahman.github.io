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
 * Two cells show this machine -- drive and race -- so, like the arm, it is
 * fetched once and shared, and only the phase differs between them.
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
const MAX_V = 0.22;            // BURGER_MAX_LIN_VEL, m/s
const MAX_W = 2.84;            // BURGER_MAX_ANG_VEL, rad/s

/* Those numbers close on each other, which is the check that the model is
   standing rather than floating: base_link is 0.010 above base_footprint, the
   axle 0.023 above base_link, the tyre radius 0.033. 0.010 + 0.023 - 0.033 is
   zero, so base_footprint really is the contact plane and the robot sits on
   the bench with nothing added to make it. The baked wheel geometry agrees --
   its lowest vertex lands at base_link z = -0.0099. */

/* The rate profile is a raised cosine over each leg of the run, so the robot
   eases out of rest instead of arriving at speed, and its peak is set to the
   machine's own ceiling. For a leg of length D that makes the duration fall
   out rather than be picked: v(u) = D (pi/2) sin(pi u) / T peaks at pi D / 2T,
   so T = pi D / (2 MAX_V). The same argument on a half turn, which sweeps pi
   rather than D, gives the constant below.

   It comes out at 1.74 s for the turn, and a 2.79 m run across the bench takes
   19.9 s at a mean 0.14 m/s. That is slow. It is also what a Burger does. */
const TURN = (Math.PI * Math.PI) / (2 * MAX_W);

const ease = u => (1 - Math.cos(Math.PI * u)) / 2;

let cached = null;

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

/* How far a corner of this robot gets from base_footprint's z axis, which is
   what decides how far it can run before something overhangs the bench.
   Measured off the geometry that was actually loaded rather than written down
   here, so it cannot quietly go stale when the bake changes.

   A tyre only ever turns about its own axle, and the joint's rpy lays that
   axle along the base's y, so spinning moves a tyre vertex within a plane
   containing base x and z and leaves its base y alone. Its bound is therefore
   hypot(in-plane radius, |joint y| + half width), taken over the wheel's own
   extremes -- an over-estimate, in the direction that keeps the robot on the
   bench. It comes out at 0.104 m, and it is the base plate's corner that sets
   it, not the wheels. */
function sweptRadius(mesh) {
  let r = 0;
  for (const link of mesh.links) {
    const jy = link.name === "wheel_left_link" ? WHEEL_L_Y
             : link.name === "wheel_right_link" ? WHEEL_R_Y : null;
    for (const part of link.parts) {
      for (let i = 0; i < part.v.length; i += 3) {
        const x = part.v[i] * mesh.unit;
        const y = part.v[i + 1] * mesh.unit;
        const z = part.v[i + 2] * mesh.unit;
        r = Math.max(r, jy === null
          ? Math.hypot(x, y)
          : Math.hypot(Math.hypot(x, y), Math.abs(jy) + Math.abs(z)));
      }
    }
  }
  return r;
}

export default function TurtleBot({ phase = 0, scale = 1, bench = 3.0, tint }) {
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

  /* The run, and therefore the clock. The bench is 3.0 m deep along the aisle
     -- Bay.jsx's bench box, which Rig.jsx passes in rather than this file
     assuming -- and the robot needs its own swept radius clear at each end,
     so the straight is the bench less twice that. Everything after follows. */
  const path = useMemo(() => {
    if (!mesh) return null;
    const run = bench - 2 * sweptRadius(mesh);
    const straight = (Math.PI * run) / (2 * MAX_V);
    return { run, straight, cycle: 2 * straight + 2 * TURN };
  }, [mesh, bench]);

  useFrame(({ clock }) => {
    if (!parts || !path) return;
    const { run, straight, cycle } = path;

    /* Derived from the clock rather than accumulated, the same way the arm is,
       so a cell that has been off screen for a minute comes back in step. The
       completed-cycle count is carried separately because the wheels keep
       turning across a cycle boundary even though the pose returns. */
    const t = clock.elapsedTime + phase * cycle;
    const n = Math.floor(t / cycle);
    let u = t - n * cycle;

    /* Four legs: out, half turn, back, half turn. `p` is where the body is
       along the bench, `psi` its heading, and `s` the distance it has covered
       -- p returns to where it started every cycle and s and psi do not, which
       is the whole difference between a position and an odometer. */
    let p, psi, s, yaw;
    if (u < straight) {
      const e = ease(u / straight);
      p = -run / 2 + run * e; psi = 0; s = run * e; yaw = 0;
    } else if (u < straight + TURN) {
      const e = ease((u - straight) / TURN);
      p = run / 2; psi = Math.PI * e; s = run; yaw = Math.PI * e;
    } else if (u < 2 * straight + TURN) {
      const e = ease((u - straight - TURN) / straight);
      p = run / 2 - run * e; psi = Math.PI; s = run + run * e; yaw = Math.PI;
    } else {
      const e = ease((u - 2 * straight - TURN) / TURN);
      p = -run / 2; psi = Math.PI + Math.PI * e;
      s = 2 * run; yaw = Math.PI + Math.PI * e;
    }
    const travel = n * 2 * run + s;
    const turned = n * 2 * Math.PI + yaw;

    /* The wheel angles are the travel, not a rate that happens to look right
       next to it. A differential drive's left contact point advances by
       s - (b/2) psi and its right by s + (b/2) psi; divide by the tyre radius
       and that is the angle each wheel must have turned through to have rolled
       there without slipping. Standing still and turning on the spot falls out
       of the same two terms with s held fixed, which is why the wheels
       counter-rotate through the half turns without being told to. */
    const phiL = (travel - (TRACK / 2) * turned) / TYRE_R;
    const phiR = (travel + (TRACK / 2) * turned) / TYRE_R;

    /* base_footprint on the bench: along the bay's z, because that is the 3.0 m
       axis of the bench and the one that runs parallel to the aisle, so the
       traverse crosses the frame rather than coming at you. Inside UPRIGHT the
       model is still Z-up, so the body's heading is a turn about its own z and
       the drive axis is its y -- pi/2 off the model's forward, which is what
       the extra quarter turn in the heading is. */
    if (drive.current) {
      drive.current.matrix
        .makeRotationZ(psi + Math.PI / 2)
        .setPosition(0, p, 0);
      drive.current.matrixWorldNeedsUpdate = true;
    }

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
