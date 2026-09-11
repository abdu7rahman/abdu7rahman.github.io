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
 * The camera that watches a station stands 3.5 m off, on a 46 degree lens, so
 * a 1280 by 820 frame is 2.97 m tall there and one metre of world is 276
 * pixels. A title has to clear about 24 pixels to be read, which is 0.087 m
 * of letter, which is a third of the height of a 0.26 m caption band. That is
 * the whole design: the board is as big as it has to be for its own title to
 * be legible from where the site looks at it, and no bigger.
 *
 * At 0.78 by 0.50 -- the first attempt -- it was bigger, and it covered the
 * machine's head and chest from the one angle the site ever sees it. A guide
 * whose sign hides the guide is a guide holding a placard in front of its
 * face.
 */
export const SIGN_W = 0.64;
export const SIGN_H = 0.42;
const GRIP_HALF = 0.17;

/* Where it sits in the robot's own frame -- x forward, y left, z up, with
   the pelvis origin at 0.793. Raised: out in front of the chest, tipped back
   a little so it faces slightly up into the reader's eye line rather than
   straight out at the middle of their chest. Lowered: down at the waist,
   tipped flat, which is how you carry a board you are not showing anybody. */
const UP = { x: 0.30, z: 0.93, tilt: -0.22 };
const DOWN = { x: 0.225, z: 0.74, tilt: -1.18 };

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
    const a = t.current;
    if (swapping && a < 0.06) setShown(want);
    const x = DOWN.x + (UP.x - DOWN.x) * a;
    const z = DOWN.z + (UP.z - DOWN.z) * a;
    yaw.current.position.set(x, z, 0);
    tilt.current.rotation.x = DOWN.tilt + (UP.tilt - DOWN.tilt) * a;
    if (onGrips) {
      /* The grips, in the robot's frame, taken from where the board actually
         is this frame -- at the bottom corners and well behind the face,
         because the hand mesh runs on past the wrist the solver targets and
         at 45 mm of clearance the fingers came through the front of the sign
         and sat on top of the word they were holding up. */
      onGrips([x - 0.085, GRIP_HALF, z - 0.145],
              [x - 0.085, -GRIP_HALF, z - 0.145], a);
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
        {/* Two grips, where the hands go, so the thing being held has
            something to be held by. */}
        {[-1, 1].map(s => (
          <mesh key={s} position={[s * GRIP_HALF, -SIGN_H / 2 + 0.055, -0.036]}
                rotation-x={Math.PI / 2} castShadow>
            <cylinderGeometry args={[0.014, 0.014, 0.10, 10]} />
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
