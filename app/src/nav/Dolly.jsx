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

/* How far short of a bay the dolly comes to rest, in metres, and the number
 * the whole glance is built around.
 *
 * The travel coordinate is metres into the building and the eye sits at
 * 4 - z, so stopping at a station leaves that station's bay four metres
 * ahead rather than beside you. That is the right place to stand: a cell
 * four metres up the aisle is a three-quarter view, where you see the
 * machine, the bench it is bolted to and the back wall behind it, and level
 * with one you would be looking at it side on through its own guarding.
 *
 * It was also, silently, the reason no cell was ever framed. The glance used
 * to be weighted by the raw distance to the nearest bay, faded out over
 * PITCH * 0.55 -- which is 3.96 m. Four metres short of the bay is four
 * metres of distance, so at every station stop the weight evaluated to zero
 * and the camera looked straight down the lane. Thirteen stops, seven of
 * them a test cell, and the subject was off the edge of the frame at all
 * seven. Weighted by the distance from this offset instead, so the full turn
 * is where the dolly actually comes to rest.
 */
const STANDOFF = 4.0;
const WINDOW = PITCH * 0.62;
const UP = new THREE.Vector3(0, 1, 0);

export default function Dolly() {
  const { camera } = useThree();
  const z = useTravel();
  const look = useRef(new THREE.Vector3());
  const eye = useRef(new THREE.Vector3(0, 1.62, 4));

  useFrame((_, dt) => {
    const k = 1 - Math.pow(0.0006, Math.min(0.1, dt));

    // Where the dolly is: down the lane, breathing very slightly so a held
    // shot is never mechanically dead.
    const t = performance.now() * 0.001;
    eye.current.set(
      Math.sin(t * 0.21) * 0.05,
      1.62 + Math.sin(t * 0.17) * 0.015,
      4 - z
    );
    camera.position.lerp(eye.current, k);

    /* Which bay has the shoulder, and how much of a glance it has earned.
       Signed, and chosen by how near it is to the standoff rather than to
       the eye: the bay you are looking into is the one coming up, not the
       one you are level with. Behind you it scores badly and drops out,
       which is what lets the turn come back to the lane after you pass. */
    let best = null, bestOff = 1e9;
    for (const s of GLANCE) {
      const ahead = camera.position.z - (-s.at * PITCH);
      const off = Math.abs(ahead - STANDOFF);
      if (off < bestOff) { bestOff = off; best = s; }
    }
    const pull = best ? Math.max(0, 1 - bestOff / WINDOW) : 0;

    /* The look point, and at full pull it is the bench rather than a
       compromise short of it. Half a metre past the machine's own x so the
       cell is centred in frame and not clipped by the edge, and at 1.15 m,
       which is the bench top -- what stands on it and the monitor beside it
       are both around that height, and aiming at the floor of a bay frames
       the plinth. */
    const lane = camera.position.z - 12;
    const room = best ? best.kind === "room" : false;
    const bz = best ? -best.at * PITCH : lane;
    const bx = best ? best.hand * (WORK + (room ? 1.6 : 0.4)) : 0;
    const by = room ? 1.55 : 1.15;
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
  });

  return null;
}
