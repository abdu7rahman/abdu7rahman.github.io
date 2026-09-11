import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { GUIDE } from "./guideState.js";
import * as journey from "./journey.js";
import { STOPS } from "../lib/plan.js";
import { standFor } from "./stations.js";
import { onMap } from "./building.js";

/* The camera, on the guide rather than on a scrollbar.
 *
 * What this replaces is a dolly that ran down the centre line at a speed the
 * wheel set and turned its head into whichever bay it was passing. That was
 * a good shot of a building and the wrong relationship to it: the reader was
 * a tracking shot, and everything in the place happened whether or not
 * anybody was looking.
 *
 * Now there is somebody walking you round, so the camera does what a camera
 * does when there is somebody to follow. Four shots, chosen by what the
 * visit is doing rather than by where the scrollbar is:
 *
 *   greeting  face to face at the door, because being met is the first thing
 *             that happens and a machine that greets you side-on has not
 *             greeted you
 *   walking   over the shoulder, wide, leading into the turn, so you can see
 *             where you are being taken
 *   showing   a two-shot: the guide in the foreground and the cell it is
 *             standing in front of behind it, which is the frame that says
 *             these two things are about each other
 *   cards     close, square on, when what is being held up is the subject
 *
 * Every one of them is computed off the guide's pose and the floor plan.
 * There is no keyframe and no path: move the guide and the shot follows,
 * which is the only way a camera can follow something that plans its own
 * route.
 */

/* How fast the eye closes on where it should be, per second. Expressed as a
   decay so it takes the same wall time on a phone drawing four frames a
   second as on a desktop drawing a hundred and twenty -- the fault the
   scroll easing had to fix and the same fix. */
const EASE = 0.0009;
const CUT = 0.00000004;   // near enough to a cut, for the greeting

/* How fast the lens is allowed to swing around the guide, in radians a
 * second, and how fast the heading it swings around may change.
 *
 * These are the two halves of what made the walk unwatchable, and they are
 * different faults with the same symptom.
 *
 * The first: every guide-relative shot was an offset from the body's
 * instantaneous heading, so the camera sat on the end of a four metre arm
 * bolted to a machine that yaws. The local planner does not drive in
 * straight lines -- it picks the best of seventeen turn rates every tick and
 * the chosen one flickers either side of zero -- so a body wiggle of a few
 * degrees threw the lens most of a metre, every frame. Measured over one
 * walk to the first cell, the camera travelled from z=0.39 to 3.05 to 6.23
 * to 5.83 while the guide moved 1.7 m in a straight line. So the arm is
 * bolted to a heavily damped copy of the heading instead: 1.1 rad/s follows
 * a real corner in under a second and ignores the flicker entirely.
 *
 * The second: the greeting stands the camera 3.63 m in *front* and the walk
 * puts it 4.2 m *behind*, and easing a position from one to the other draws
 * a straight line between them -- which passes through the robot. So what is
 * eased is the angle around the guide rather than the point, and the camera
 * swings round the outside the way a camera operator would walk it.
 */
const SWING = 1.6;
const TURN = 1.1;
/* Below this, in metres a second, the guide counts as standing rather than
   walking and its heading stops driving the lens. The pilot's own cruise is
   1.45, so this is well under a walking pace and only catches the turn in
   place at either end of a walk. */
const STILL = 0.12;

const _eye = new THREE.Vector3();
const _look = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _cur = new THREE.Vector3();

/* The guide's heading as a direction in the world. The controller integrates
   with cos and sin into x and z, so this is that, and the right hand is the
   quarter turn from it. */
function basis(yaw) {
  _fwd.set(Math.cos(yaw), 0, Math.sin(yaw));
  _right.set(-Math.sin(yaw), 0, Math.cos(yaw));
}

/* Every station's shot, worked out once the map exists. Held in a map rather
   than recomputed per frame: finding a standing spot sweeps a 3.2 by 4.5 m
   window of the distance field, which is not a per-frame question. */
const SHOTS = new Map();

/* How much room a lens needs. Half the near plane's diagonal would be exact
   and is smaller than this; 0.55 m is what keeps a wall out of the corner of
   a 58 degree frame rather than merely out of its centre. */
const CAM_R = 0.55;
let map = null;

export default function Follow() {
  const { camera } = useThree();
  useEffect(() => onMap(grid => {
    map = grid;
    SHOTS.clear();
    for (const s of STOPS) SHOTS.set(s.id, standFor(grid, s));
    /* Reachable from outside: a probe that wants to put the guide at a
       station has to know where the station's standing spot is, and
       recomputing it in the probe is a second answer that can disagree. */
    if (typeof window !== "undefined") {
      if (!window.__lab) window.__lab = {};
      window.__lab.shots = SHOTS;
    }
  }), []);
  const look = useRef(new THREE.Vector3(0, 1.3, -4));
  /* The damped heading, and where the lens sits around it: an angle off that
     heading and a distance, so a shot change is an orbit and not a flight
     through the subject. Null until the first frame, which adopts whatever
     the shot asks for rather than swinging in from an invented start. */
  const yawS = useRef(null);
  const off = useRef(0);
  const rad = useRef(3.63);
  const fov = useRef(52);
  const first = useRef(true);

  useFrame((_, dt) => {
    const g = GUIDE;
    if (!g.ready) return;
    const j = journey.get();
    const t = performance.now() * 0.001;
    basis(g.pose.yaw);
    const gx = g.pose.x, gz = g.pose.z;

    let wantFov = 52, ease = EASE;
    /* The damped heading. Shortest way round, at a fixed rate rather than a
       fraction, so a corner takes the same time whatever the frame rate and
       a wiggle goes nowhere. */
    if (yawS.current === null) yawS.current = g.pose.yaw;
    /* And only while the guide is actually going somewhere.
     *
     * The walking shot sits at this heading plus an offset, so the camera
     * orbits by whatever the heading does. That is right while the guide is
     * travelling -- the lens should lead a corner. It is wrong the moment it
     * stops, because the last thing the guide does at a station is turn on
     * the spot to face the bay, and the camera was following that round: a
     * 90 degree turn in place swung the lens 90 degrees round the subject,
     * for no reason a viewer could see. Departures did the same thing in
     * reverse, whipping before anything had moved.
     *
     * A heading is information about where something is going. A machine
     * standing still is not going anywhere, so below a walking pace this
     * stops reading it and the camera holds where it is. */
    if (Math.abs(g.v) > STILL) {
      let e = g.pose.yaw - yawS.current;
      while (e > Math.PI) e -= Math.PI * 2;
      while (e < -Math.PI) e += Math.PI * 2;
      const step = TURN * Math.min(0.1, dt);
      yawS.current += Math.max(-step, Math.min(step, e));
    }
    /* Where the lens wants to sit around that heading, for the two shots
       that are the guide's own: an angle off the heading and a distance.
       Null for the shots that name a place in the building instead. */
    let wantOff = null, wantRad = 0, wantY = 0;

    if (j.phase === "greeting") {
      /* In front of the guide, at the height of somebody standing in a
       * doorway. The G1 is 1.32 m tall, so a camera at 1.55 is looking down
       * at it -- which is what it is like to be met by a machine that size,
       * and pretending otherwise by dropping the lens to its eye line would
       * make the visitor a metre tall.
       *
       * The distance and the aim are worked back from the frame rather than
       * chosen. The card asking the question takes the bottom quarter of the
       * screen, so the machine has to fit in the top three quarters with its
       * feet on show -- a greeting where the thing greeting you is cut off
       * at the shins is the first frame of the site failing at the one job
       * it has. 1.32 m across 45 per cent of a 44 degree frame is 3.63 m of
       * throw, and aiming at 0.73 rather than at its chest is what lifts the
       * whole machine clear of the card.
       */
      wantOff = 0; wantRad = 3.63; wantY = 1.55;
      _look.set(gx, 0.73, gz);
      wantFov = 44;
      ease = first.current ? CUT : EASE;
    } else if (j.phase === "walking") {
      /* Over the shoulder and out to one side, high enough to see the lane
         past the guide. Leading the turn: the look point is ahead of the
         guide along its own heading, so a corner is visible before it is
         taken rather than after. */
      /* 4.22 m at 2.90 rad off the heading is the same over-the-shoulder,
         out-to-one-side place the offset pair used to name -- 4.1 back and
         1.0 across -- written as an angle so it can be swung to. */
      wantOff = 2.90; wantRad = 4.22; wantY = 2.05;
      /* Leading the turn: the look point runs ahead along the damped
         heading, so a corner is visible before it is taken. Damped, because
         a look point on the raw heading whips across the frame for the same
         reason the eye did. */
      _look.set(gx + Math.cos(yawS.current) * 2.2, 1.25,
                gz + Math.sin(yawS.current) * 2.2);
      wantFov = 54;
    } else if (j.phase === "choosing") {
      /* Nothing to follow and something to choose, so the camera does what
       * anybody does when they are deciding where to go: it stands back and
       * looks down the building.
       *
       * This is a correction rather than a flourish. Without it the choosing
       * phase fell through to the standing shot, which frames the guide from
       * 2.35 m -- so the one moment the site asks the visitor to pick a cell
       * was the one moment no cell was on screen. Measured by raycasting
       * nine points across the frame: eight of them hit the floor eight
       * metres away and one found a bay, five stations further down than the
       * one it was aimed at.
       *
       * Raised and behind, looking down the lane past the guide, which puts
       * the tags at the mouth of every cell in shot at once.
       */
      const deep = gz < -46;
      const back = deep ? -6.6 : 6.6;
      _eye.set(gx * 0.35, 3.30, gz + back);
      _look.set(0, 1.15, deep ? gz + 12 : gz - 12);
      wantFov = 58;
    } else {
      /* Standing somewhere, showing something. The shot is the one
         stations.js worked out when it chose the spot -- the same numbers
         that decided which way the guide would turn -- so the machine is
         square to the lens rather than presenting its back to it. */
      const shot = SHOTS.get(j.at || j.target);
      if (shot) {
        _eye.set(shot.eye[0], shot.eye[1], shot.eye[2]);
        _look.set(shot.look[0], shot.look[1], shot.look[2]);
        wantFov = shot.fov;
      } else {
        _eye.set(gx + _fwd.x * 2.35, 1.52, gz + _fwd.z * 2.35);
        _look.set(gx + _fwd.x * 0.12, 1.20, gz + _fwd.z * 0.12);
        wantFov = 40;
      }
    }

    /* Resolve the two guide-relative shots. The angle is eased the short way
       round at a fixed rate; the distance follows it. A shot that names a
       place in the building has already written _eye, and it also leaves the
       orbit where the lens actually is, so that returning to the guide swings
       out from there rather than snapping. */
    if (wantOff !== null) {
      let e = wantOff - off.current;
      while (e > Math.PI) e -= Math.PI * 2;
      while (e < -Math.PI) e += Math.PI * 2;
      const step = SWING * Math.min(0.1, dt);
      off.current += Math.max(-step, Math.min(step, e));
      rad.current += (wantRad - rad.current) * Math.min(1, dt * 2.2);
      const a = yawS.current + off.current;
      _eye.set(gx + Math.cos(a) * rad.current, wantY, gz + Math.sin(a) * rad.current);
    } else {
      const dx = camera.position.x - gx, dz = camera.position.z - gz;
      off.current = Math.atan2(dz, dx) - yawS.current;
      rad.current = Math.max(0.5, Math.hypot(dx, dz));
    }

    /* A very small drift, always. A camera that is exactly still reads as a
       still, and the building is supposed to be running. */
    _eye.x += Math.sin(t * 0.23) * 0.045;
    _eye.y += Math.sin(t * 0.19) * 0.018;

    /* Keep the lens out of the building.
     *
     * Every shot above is an offset from where the guide is standing, and an
     * offset is a thing that can put a camera through a wall: the wide shot
     * for choosing stands 6.6 m back down the lane, and at the front door
     * that is 2 m outside the front wall, so the first frame after picking a
     * route was the inside of a sheet of cladding. Rather than special-case
     * the door -- and then the back wall, and then the office partition, and
     * then whichever bench somebody moves next -- the camera asks the same
     * map the guide walks on whether there is room where it is going, and
     * slides toward its own look point until there is.
     *
     * Ten steps at a fifth of the way each, which converges to within 11 per
     * cent of the distance, and gives up rather than teleporting if the look
     * point is itself inside something. */
    if (map) {
      for (let i = 0; i < 10 && map.clearance(_eye.x, _eye.z) < CAM_R; i++) {
        _eye.x += (_look.x - _eye.x) * 0.2;
        _eye.z += (_look.z - _eye.z) * 0.2;
      }
    }

    const k = 1 - Math.pow(ease, Math.min(0.1, dt));
    camera.position.lerp(_eye, k);
    look.current.lerp(_look, k);
    camera.lookAt(look.current);
    fov.current += (wantFov - fov.current) * k;
    /* Every shot above is framed for a landscape frame, and three's fov is
     * the vertical one -- so on a phone held upright the same number is a
     * much narrower picture sideways. At 390 by 840 the aspect is 0.46, and
     * the 46 degree lens the two-shot asks for covers 22 degrees across:
     * the guide is in frame and the cell it is standing in front of is not.
     *
     * So the number the shots name is treated as the horizontal coverage it
     * gives on the 1.6 aspect they were composed at, and the vertical fov is
     * whatever delivers that on the frame actually being drawn. Capped,
     * because past about 78 degrees the correction stops being a wider shot
     * and starts being a fisheye.
     */
    const a = Math.max(0.35, camera.aspect);
    const wantX = 2 * Math.atan(Math.tan(fov.current * Math.PI / 360) * 1.6);
    const fovY = Math.min(78, 2 * Math.atan(Math.tan(wantX / 2) / a) * 180 / Math.PI);
    if (Math.abs(camera.fov - fovY) > 0.02) {
      camera.fov = fovY;
      camera.updateProjectionMatrix();
    }
    first.current = false;
  });

  return null;
}
