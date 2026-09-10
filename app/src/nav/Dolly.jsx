import { useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useTravel } from "./useTravel.js";
import { STOPS, PITCH, WORK } from "../lib/plan.js";

/* The camera, on a dolly down the lane.
 *
 * It travels the centre line at standing height and turns its head into
 * whichever bay it is coming up on, which is the one motion that makes a
 * building read as a building rather than as a tunnel: you walk the aisle
 * and look into the work either side of you.
 *
 * The turn is weighted by how close that bay is to the shoulder, so it is a
 * glance and not a pan -- full attention where the dolly stops, back to
 * straight down the lane halfway between two of them. Nothing here is
 * keyframed; there is one position and one look point and both fall out of
 * where you are standing.
 */
/* Every stop that stands off the aisle, which is not only the cells. Four
   of the six rooms have a hand and an interior -- racking, a granite
   surface plate, the history wall -- and while the glance knew about test
   cells alone, all four showed the same length of empty aisle behind their
   reading. A room you never look into is a room nobody built.

   The two that keep the aisle are the two that are the aisle. Entry and
   office carry side 0 because they are the ends of the run rather than
   something off it: the entrance is the establishing shot, sixty-six metres
   of building with the daylight coming down it, and turning it to face a
   desk in a side room traded the best frame in the project for a dark box.
   Rooms.jsx puts their furniture on the right hand for want of anywhere
   else; that is a placement, not a subject. */
const GLANCE = STOPS.filter(s => s.side !== 0).map(s => ({ ...s, hand: s.side }));

/* How far to yaw past a room so it composes against its own reading.

   A cell's caption is centred at the foot of the frame, so a cell wants to
   be centred. A room's is a column down the right-hand third, so a room
   centred is a room behind its own text. Yawing right moves the whole image
   left, and this is the angle that puts the far wall at about 28% across on
   a 52 degree lens at 16:10 -- one number, both hands of the aisle, because
   the yaw is absolute and not relative to the side. */
const ROOM_YAW = -0.29;

/* Level with the bay, and the turn goes all the way round.
 *
 * The dolly used to rest four metres short and glance in at about fifty
 * degrees, which is a three-quarter view: more depth, but the cell is
 * further away and never square in the frame. Standing level with it and
 * turning ninety degrees is the shot -- the bench face on, the machine on
 * it, the back wall behind, and the whole thing two metres nearer, which is
 * about forty per cent bigger before the lens does anything.
 *
 * A half turn also reads as hesitation. Walking a plant you either look into
 * a cell or you do not; a head that stops a third of the way round looks
 * like it is trying to see two things at once and shows neither.
 *
 * That is what the standoff is for and why it is zero. The travel coordinate
 * is metres into the building and the eye used to sit at 4 - z, which put
 * every bay four metres ahead at every stop -- and, for a long time, exactly
 * cancelled the glance, because the weight faded out over PITCH * 0.55 and
 * four metres of offset is four metres of distance. The offset is gone, the
 * weight is measured from where the dolly actually stops, and the turn is
 * whatever it takes to face the work.
 */
const STANDOFF = 0.0;
const WINDOW = PITCH * 0.62;
const UP = new THREE.Vector3(0, 1, 0);

/* The lens, and it is the other half of the answer to a machine that reads
 * small. A UR12e is 0.6 m of arm on a 0.9 m bench; at 52 degrees from seven
 * metres it is 130 pixels of a 1440 pixel frame no matter how well it is
 * lit. Going in to 38 is what a photographer would do rather than walking
 * closer through the guarding, and the two together -- 4.9 m instead of 6.9
 * on a 38 degree lens instead of 52 -- put about twice the machine on
 * screen. Wide again down the aisle, because the aisle is the one shot in
 * this building that wants the width. */
const FOV_LANE = 52;

/* Leaning in, which is the difference between seeing a test rig and reading
 * one.
 *
 * The cells run their work on the bench top at 0.9 m. From the aisle centre
 * line at eye height that is a 4.9 m throw and a 0.72 m drop -- eight degrees
 * of depression, which is edge on: an occupancy grid at eight degrees is a
 * band of colour and not a map. Nobody looks at a rig from there. They put a
 * hand on the rail, lean over it and look down.
 *
 * So at full turn the dolly slides to the guarding on that side and comes up
 * on its toes: 2.6 m off centre, which is still aisle-side of the rail at
 * 3.2, and 2.15 m up. That is 2.3 m of throw at twenty-nine degrees, and it
 * puts the bench roughly twice the size it was on top of the lens going in.
 * Back to the centre line at standing height between bays, because the aisle
 * is walked and not leaned over.
 */
/* Two shots, because a cell is one of two things. The numbers are geometry
 * and nothing else: x is how far off the centre line the eye slides (the
 * guarding is at 3.2, so both stay aisle-side of it), y is how high it gets,
 * aim is what it looks at on the bench, and fov is the lens.
 *
 *   course   1.7 m out, 2.4 m up, aimed at the surface. That is 3.5 m of
 *            slant at twenty-five degrees of depression, and 48 degrees puts
 *            the whole 2.7 m course in frame with a little air. Eight
 *            degrees, which is what the centre line gave, made an occupancy
 *            grid into a stripe.
 *   machine  2.15 m out, near standing height, aimed at what stands on the
 *            bench. 2.75 m of throw on a 42 degree lens, which is close to
 *            twice the arm the centre line and the wide lens were giving and
 *            still leaves its base in shot -- at 2.6 and 38 the machine ran
 *            off the bottom of the frame and read as a fragment of an arm
 *            rather than as an arm.
 */
const SHOT = {
  course:  { x: 1.70, y: 2.40, aim: 0.95, fov: 48 },
  machine: { x: 2.15, y: 1.85, aim: 1.12, fov: 42 },
  /* And one for a cell whose subject is bigger than its machine. The reach
     bay draws the arm's whole workspace, which is 2.6 m across on a bench
     2.6 m deep; framed for the 0.6 m of arm standing in the middle of it the
     envelope is mostly off screen. So this shot steps back to the centre
     line instead of leaning in -- 4.1 m of throw on a 46 -- which is what
     anybody does when the thing they are looking at got bigger. */
  envelope: { x: 0.20, y: 1.95, aim: 1.45, fov: 46 }
};
const EYE_Y = 1.62;

export default function Dolly() {
  const { camera } = useThree();
  const z = useTravel();
  const look = useRef(new THREE.Vector3());
  const eye = useRef(new THREE.Vector3(0, 1.62, 4));

  useFrame((_, dt) => {
    const k = 1 - Math.pow(0.0006, Math.min(0.1, dt));
    const t = performance.now() * 0.001;

    /* Which bay has the shoulder, and how much of a turn it has earned.
       Measured from where the dolly is going rather than from where it has
       got to: the travel coordinate is the reader's own scroll and it leads
       the eased camera, so taking the bay off it means the lean and the turn
       start on the way in instead of catching up after arrival. */
    const zt = -z;
    let best = null, bestOff = 1e9;
    for (const s of GLANCE) {
      const off = Math.abs((zt - (-s.at * PITCH)) - STANDOFF);
      if (off < bestOff) { bestOff = off; best = s; }
    }
    const pull = best ? Math.max(0, 1 - bestOff / WINDOW) : 0;
    const shot = best && best.kind === "rig" ? (SHOT[best.frame] || SHOT.machine) : null;
    const lean = shot ? pull : 0;

    /* Where the dolly is: down the lane, out to the rail and up on its toes
       when it is looking into a cell, and breathing very slightly throughout
       so a held shot is never mechanically dead. */
    eye.current.set(
      (shot ? best.hand * shot.x * lean : 0) + Math.sin(t * 0.21) * 0.05,
      EYE_Y + (shot ? (shot.y - EYE_Y) * lean : 0) + Math.sin(t * 0.17) * 0.015,
      zt
    );
    camera.position.lerp(eye.current, k);

    /* The look point, and at full pull it is square into the bay. Half a
       metre past the machine's own x so the cell is centred in frame and not
       clipped by the edge, and at 1.15 m, which is the bench top -- what
       stands on it and the monitor beside it are both around that height,
       and aiming at the floor of a bay frames the plinth. */
    const lane = camera.position.z - 12;
    const room = best ? best.kind === "room" : false;
    const bz = best ? -best.at * PITCH : lane;
    const bx = best ? best.hand * (WORK + (room ? 1.6 : 0.4)) : 0;
    // 1.55 in a room, otherwise whatever the cell's own shot aims at: the
    // bench surface for a course, what stands on it for a machine.
    const by = room ? 1.55 : (shot ? shot.aim : 1.15);
    look.current.set(
      bx * pull,
      1.45 + (by - 1.45) * pull,
      lane * (1 - pull) + bz * pull
    );

    // The room offset, applied to the direction rather than to the point,
    // so it is a yaw of the head and stays the same angle however far away
    // the room is. Faded in with the rest of the turn.
    if (room && pull > 0) {
      look.current.sub(camera.position)
        .applyAxisAngle(UP, ROOM_YAW * pull)
        .add(camera.position);
    }
    camera.lookAt(look.current);

    // The lens follows the turn. Only touched when it has actually moved --
    // updateProjectionMatrix is not free and this runs every frame.
    const fov = FOV_LANE + ((shot ? shot.fov : FOV_LANE) - FOV_LANE) * pull;
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
  });

  return null;
}
