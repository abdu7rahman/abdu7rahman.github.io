import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { P } from "../lib/palette.js";

/* The board the guide carries, and what is written on it.
 *
 * A machine that walks you to a cell and then says nothing is a machine that
 * walked you to a cell. The caption used to be a plate of HTML floating over
 * the render, which is the site telling you about the building rather than
 * anything in the building telling you. So it is a physical sign, held up in
 * two hands, in the frame, lit by the same lights as everything else.
 *
 * The board's pose is the authority and the hands follow it. That is the
 * right way round: parenting a board to a wrist means the board goes
 * wherever the arm's last frame happened to leave it, and the arm has no
 * reason to leave it level. Here the board is placed where it should be
 * read from, the grips fall out of its own width, and gait.js solves both
 * arms to reach them -- so a raised sign is a sign the shoulders and elbows
 * worked out how to hold.
 */

/* The board, in metres, and both numbers are worked back from the shot
 * rather than picked.
 *
 * The camera that watches a station stands about 3.4 m off the guide, on the
 * 50 degree lens nav/stations.js composes a bay with, so a 1440 by 900 frame
 * is 3.17 m tall there and one metre of world is 284 pixels. A title has to
 * clear about 24 pixels to be read, which is 0.085 m of letter, which is a
 * third of the height of a 0.26 m caption band. That is the whole design:
 * the board is as big as it has to be for its own title to be legible from
 * where the site looks at it, and no bigger.
 *
 * The lens moved -- 46 to 50, when the benches grew and the old one started
 * cropping the ends off a course -- and this is what that does to the sign:
 * a wider lens at the same distance is fewer pixels per metre, but the frame
 * it was worked out against was 820 tall and the one the site renders is
 * 900, which is worth more than the lens cost. 276 px/m then, 284 now. The
 * board does not move, and the reason it does not is written down rather
 * than assumed.
 *
 * At 0.78 by 0.50 -- the first attempt -- it was bigger, and it covered the
 * machine's head and chest from the one angle the site ever sees it. A guide
 * whose sign hides the guide is a guide holding a placard in front of its
 * face.
 */
export const SIGN_W = 0.50;
export const SIGN_H = 0.42;
/* Where the hands go: a grab rail across the back, near the bottom, which is
 * how a hand-held site sign is actually held. Two pegs were tried first and
 * are wrong for this robot -- the G1's hand is a moulded casting that closes
 * one way, so it wants something to close around rather than something to
 * poke at.
 *
 * RAIL_DROP is below the board's centre and RAIL_OUT behind its face, both
 * far enough that the casting clears the panel: the hand is 133 mm long and
 * its palm sits 119 mm from the wrist, so the rail has to stand off the back
 * by more than the hand is thick or the fingers come through the front.
 */
/* Outside the panel on both counts, and that is the whole of it.
 *
 * At 0.17 the hands gripped a rail well inside a 0.64 m board, and at 0.15
 * the rail sat 0.06 m *above* the board's own bottom edge. Both hands were
 * therefore in front of a panel whose interior the arms had to cross to
 * reach them -- a shoulder is behind the board, a hand is in front of it,
 * and a straight line between the two goes through the middle. Photographed
 * side-on mid-walk, the board cut clean through the right forearm.
 *
 * There is no easing this: it is not a tuning fault, it is what holding a
 * panel by its middle means. So the grips go outside the panel in both
 * directions -- 0.285 against the board's half-width of 0.25, and 0.235
 * below the centre against a half-height of 0.21 -- which puts the crossing
 * outside the rectangle on one axis and below it on the other. It is also
 * how a person carries a board this size: by the bottom corners, not by the
 * face.
 *
 * Those two numbers were quoted against a 0.64 m board and the board has
 * been 0.50 for a while, so the rule held and the arithmetic printed beside
 * it did not. 35 mm outside and 25 mm below is the margin there actually is.
 */
const GRIP_HALF = 0.285;
const RAIL_DROP = 0.235;
const RAIL_OUT = 0.062;
const RAIL_R = 0.016;

/* Two poses, and the carried one is a carried one now.
 *
 * Raised: out in front of the chest, tipped back a little so it faces
 * slightly up into the reader's eye line rather than at the middle of their
 * chest.
 *
 * Carried: upright and in close, which is the difference between a machine
 * carrying a board and a machine holding a tray out in front of it while it
 * walks. It is also what makes it fit through a gate. Held flat at the waist
 * the board reaches 0.42 m in front of the body and its corners stand 0.53 m
 * off the centre line -- wider than the guide itself, and wide enough that
 * the 1.4 m gate at a bay mouth stops being a gate. Upright at 0.20 m the
 * corners are 0.38 m out, which is 0.08 m more than the body and fits
 * everywhere the body fits.
 *
 * The torso's front face is at x = 0.082 and the pelvis's at 0.071, measured
 * off the bake, so 0.20 leaves the panel 0.11 m clear of the chest and the
 * rail 0.06 m clear of it.
 */
const UP = { x: 0.256, z: 0.95, tilt: -0.22 };
const DOWN = { x: 0.156, z: 0.86, tilt: 0.0 };

/* How far the board reaches off the body's centre line, which is what the
 * guide has to be planned as -- and it is two numbers, not one.
 *
 * `carried` is the walking case: the board is upright and in close, and its
 * corners stand 0.38 m out against the body's own 0.30. That is the radius a
 * route has to be planned for, because that is the shape that goes through
 * the gates.
 *
 * `raised` is 0.48 m and only happens standing still, so it is not a
 * planning radius -- it is what the standing spot in front of a cell has to
 * have room for. Planning the whole route at 0.48 would refuse gates the
 * machine walks through with the board down.
 */
function reachAt(a) {
  const x = DOWN.x + (UP.x - DOWN.x) * a;
  const tilt = DOWN.tilt + (UP.tilt - DOWN.tilt) * a;
  // Half the panel's height leans forward by sin(tilt); the rail and the
  // panel's own thickness lean the other way.
  const fwd = x + Math.abs(Math.sin(tilt)) * SIGN_H / 2 + 0.01;
  /* The widest thing is not always the board. With the grips outside the
     panel the hands are, so the half-width is whichever of the two reaches
     further, with half a hand casting on top of the grip. */
  const half = Math.max(SIGN_W / 2, GRIP_HALF + 0.045);
  return Math.hypot(fwd, half);
}

export function footprint() {
  return { carried: reachAt(0), raised: reachAt(1) };
}

/* Draw the caption. Canvas rather than a texture atlas because the text is
   different at every station and generated once when it changes. */
function paint(face) {
  const W = 1024, H = Math.round(W * SIGN_H / SIGN_W);
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d");
  g.fillStyle = "#0d0d10"; g.fillRect(0, 0, W, H);
  // The hazard edge every plate in this building carries.
  g.fillStyle = P.hazard; g.fillRect(0, 0, 16, H);
  g.fillStyle = "#1b1b20"; g.fillRect(16, 0, 5, H);

  const pad = 52;
  g.textBaseline = "top";
  g.fillStyle = "#ff8a5c";
  g.font = "700 40px ui-monospace, Menlo, Consolas, monospace";
  g.fillText(face.eyebrow, pad, 46);

  /* The title, fitted rather than sized: "Service history" is twice the
     width of "Cost" and one point size cannot be right for both. Start at
     the size that makes it readable from the shot and come down only as far
     as the width forces. */
  let size = 190;
  const title = face.title.toUpperCase();
  const big = px => `800 ${px}px ui-sans-serif, Helvetica Neue, Arial, sans-serif`;
  g.font = big(size);
  while (g.measureText(title).width > W - pad * 2 && size > 96) {
    size -= 6; g.font = big(size);
  }
  g.fillStyle = "#fcf9f3";
  g.fillText(title, pad - 6, 108);

  if (face.sub) {
    g.fillStyle = "#c3c3c9";
    g.font = "600 44px ui-monospace, Menlo, Consolas, monospace";
    let sub = face.sub;
    while (g.measureText(sub).width > W - pad * 2 && sub.length > 8) {
      sub = sub.slice(0, -4).replace(/[,\s]+$/, "") + "\u2026";
    }
    g.fillText(sub, pad, 122 + size);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

export default function Sign({ face, up, onGrips }) {
  const yaw = useRef();
  const tilt = useRef();
  const t = useRef(0);
  /* What is painted on the board right now, which lags what has been asked
     for: a board swaps its face while it is down, because a sign that
     changes what it says while somebody is reading it is a screen. */
  const [shown, setShown] = useState(face);
  const want = face;
  const tex = useMemo(() => (shown ? paint(shown) : null), [shown]);
  useEffect(() => () => { if (tex) tex.dispose(); }, [tex]);

  /* Down while the face being asked for is not the face on the board, then
     up again once it has been changed. One number drives the pose, the
     hands and the swap, so they cannot disagree. */
  const swapping = !!want && (!shown || want.key !== shown.key);
  const raise = up && !swapping;

  useFrame((_, dt) => {
    if (!yaw.current || !tilt.current) return;
    const k = 1 - Math.pow(0.004, Math.min(0.1, dt));
    t.current += ((raise ? 1 : 0) - t.current) * k;
    /* Snapped at the ends, because an exponential ease never arrives.
     *
     * The gait blends the solved hold against the arm's swing by this
     * number, so 0.993 means the pose is seven parts in a thousand of the
     * way back toward a swinging arm -- which over a metre of arm is a
     * centimetre of hand. Measured on a raised sign, the palm read 12.3 mm
     * off the rail while the solve itself was 3 mm out: the missing 9 mm was
     * an ease that had stopped moving but not finished. A sign that is up is
     * up.
     *
     * Two per cent rather than a half, because the snap has to be reachable
     * on a slow renderer as well as a fast one: this ease closes 42.5 per
     * cent of the remaining gap per frame at a tenth of a second a frame, so
     * under the software rasteriser it takes nine frames to pass 0.993 and
     * ten to pass 0.995. At 60 Hz the difference is 0.83 s against 0.95 s,
     * and neither is a motion anybody can see the end of. */
    if (t.current > 0.98) t.current = 1;
    else if (t.current < 0.02) t.current = 0;
    const a = t.current;
    if (swapping && a < 0.06) setShown(want);
    const x = DOWN.x + (UP.x - DOWN.x) * a;
    const z = DOWN.z + (UP.z - DOWN.z) * a;
    yaw.current.position.set(x, z, 0);
    const lean = DOWN.tilt + (UP.tilt - DOWN.tilt) * a;
    tilt.current.rotation.x = lean;
    if (onGrips) {
      /* Where the rail is, in the robot's own frame, and which way a hand
       * has to be turned to hold it.
       *
       * Worked out here rather than read back off the scene graph, because
       * the gait solves the arms before anything is rendered and a matrix
       * read a frame late is a hand a frame behind the thing it is holding.
       * The board's own axes map to the robot's as: panel width -> +y, panel
       * up -> +z, panel normal -> +x, and the tilt turns the last two about
       * the first.
       */
      const ct = Math.cos(lean), st = Math.sin(lean);
      // Rail centre, offset down the panel and out behind it, then tilted.
      const ly = -RAIL_DROP, lz = -(RAIL_OUT);
      const railX = x + (ly * st + lz * ct);
      const railZ = z + (ly * ct - lz * st);
      // The fingers close toward the panel's face.
      const close = [ct, 0, -st];
      /* And the rail runs the opposite way for each hand, because two hands
         on one bar are mirror images of each other. Asking both for the same
         sense is asking the right arm for a pose that is not the mirror of
         the left's, and it cannot get there: measured, it ran its wrist roll
         and yaw hard against their limits and settled 56 to 76 degrees
         rolled about the rail, holding the board with the back of its hand. */
      onGrips({
        amount: a,
        left:  { p: [railX, GRIP_HALF, railZ], along: [0, 1, 0], close },
        right: { p: [railX, -GRIP_HALF, railZ], along: [0, -1, 0], close }
      });
    }
  });

  if (!tex) return null;
  /* The robot is described z-up and drawn y-up, so a point (x, y, z) in its
     own frame is (x, z, -y) here. The outer group carries the position in
     that mapping and turns the board's face to the robot's forward; the
     inner one tips it. */
  return (
    <group ref={yaw} rotation-y={Math.PI / 2} userData={{ ghost: true }}>
      <group ref={tilt}>
        <mesh castShadow>
          <boxGeometry args={[SIGN_W, SIGN_H, 0.016]} />
          <meshStandardMaterial color={"#26262b"} roughness={0.72} metalness={0.2} />
        </mesh>
        <mesh position={[0, 0, 0.0092]}>
          <planeGeometry args={[SIGN_W - 0.012, SIGN_H - 0.012]} />
          <meshBasicMaterial map={tex} toneMapped={false} />
        </mesh>
        {/* The rail. One bar rather than two pegs, because the hand that
            holds it closes around things. */}
        <mesh position={[0, -RAIL_DROP, -RAIL_OUT]} rotation-z={Math.PI / 2} castShadow>
          <cylinderGeometry args={[RAIL_R, RAIL_R, GRIP_HALF * 2 + 0.075, 12]} />
          <meshStandardMaterial color={P.steel} roughness={0.42} metalness={0.72} />
        </mesh>
        {/* And the two brackets that carry it back off the panel. */}
        {[-1, 1].map(k => (
          <mesh key={k} position={[k * (GRIP_HALF + 0.030), -RAIL_DROP, -RAIL_OUT / 2]}
                rotation-x={Math.PI / 2} castShadow>
            <boxGeometry args={[0.018, RAIL_OUT, 0.010]} />
            <meshStandardMaterial color={P.steel} roughness={0.5} metalness={0.7} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

/* The face of the board for a station, and for an office card. Two shapes in
   and one out, so Sign itself never has to know which kind of thing it is
   holding up. */
export function stopFace(stop, index) {
  return {
    key: "s:" + stop.id,
    eyebrow: `${String(index).padStart(2, "0")}  ${stop.kind === "rig" ? "TEST CELL" : "ROOM"}`,
    title: stop.title,
    sub: stop.sub || null
  };
}

export function cardFace(card, n, of) {
  return {
    key: "c:" + card.id,
    eyebrow: `${card.kind}  ${n + 1}/${of}`,
    title: card.title,
    sub: card.sub || null
  };
}
