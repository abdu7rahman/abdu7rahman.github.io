import { useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";

/* Resolution, decided by the machine's actual frame rate rather than by a
 * guess about its hardware.
 *
 * lib/capability.js picks a tier from the core count and the reported
 * memory, and that is the best guess available before a frame has been
 * drawn -- but it is a guess about the GPU made from two numbers that say
 * nothing about the GPU. Eight cores and eight gigabytes is a description of
 * most laptops sold in the last five years, including every one of them with
 * integrated graphics, and it puts all of them on dpr 2.0 with a post chain
 * and a 2048 shadow map. Fragment cost is dpr squared, so that is four times
 * the shading of dpr 1 for a machine that may not manage one.
 *
 * So the guess starts it and the frame rate finishes it. Pixel ratio is the
 * right lever for this and the only one that is free to move: changing it is
 * a resize, where turning the post chain or the shadows off would recompile
 * every material in the building mid-walk. It is also the largest single
 * lever there is.
 *
 * Hysteresis both ways, or it oscillates. Down is fast and decisive, because
 * a reader who is dropping frames wants them back now; up is slow and has to
 * be earned over several windows, because a moment of headroom while the
 * camera looks at a wall is not evidence that the hard shot will hold.
 */
const WINDOW = 0.5;      // seconds of frames behind each decision
const SLOW = 0.024;      // median frame time that counts as struggling, 42 fps
const FAST = 0.0135;     // and the one that counts as headroom, 74 fps
const FLOOR = 1;
const STEP_DOWN = 0.8;
const STEP_UP = 0.1;
const EARN = 4;          // consecutive fast windows before it gives any back

export default function Governor({ cap = 2 }) {
  const setDpr = useThree(s => s.setDpr);
  const gl = useThree(s => s.gl);
  const st = useMemo(() => ({ t: 0, n: 0, fast: 0, dpr: cap, frames: [] }), [cap]);
  const ready = useRef(0);

  useFrame((_, dt) => {
    /* The first second is startup -- shader compiles, the wasm fetch, the
       first shadow maps -- and none of it is the steady state this is
       supposed to be measuring. Judging on it would drop every visitor to
       the floor before the building had finished appearing. */
    if (ready.current < 1) { ready.current += dt; return; }
    /* Clamped rather than filtered, which is the third try at this and the
       one that is right. Two earlier versions discarded any frame longer
       than a fixed bound -- first a second, then two -- and both excluded
       exactly the machines this exists for: a page drawing at one frame a
       second has a dt of 1.0, at half a frame a second it is 2.0, and in
       both cases the window never filled and the governor sat reporting
       nothing while the reader watched a slideshow. A long frame is evidence
       of slowness and throwing it away throws away the finding. Clamping
       keeps the evidence -- anything at or past half a second is already far
       beyond the slow threshold, so the exact value does not matter -- while
       still stopping a tab that has been in the background for a minute from
       counting as one enormous frame. */
    if (dt > 0) st.frames.push(Math.min(dt, 0.5));
    st.t += dt;
    if (st.t < WINDOW || st.frames.length < 4) return;

    const f = st.frames;
    f.sort((a, b) => a - b);
    const med = f[f.length >> 1];
    st.frames = [];
    st.t = 0;

    if (med > SLOW && st.dpr > FLOOR) {
      st.dpr = Math.max(FLOOR, st.dpr * STEP_DOWN);
      st.fast = 0;
      setDpr(st.dpr);
    } else if (med < FAST && st.dpr < cap) {
      if (++st.fast >= EARN) {
        st.fast = 0;
        st.dpr = Math.min(cap, st.dpr + STEP_UP);
        setDpr(st.dpr);
      }
    } else if (med <= SLOW) {
      st.fast = 0;
    }

    /* Readable from outside, because "is it dropping frames" is the one
       question about this building a screenshot cannot answer. */
    if (typeof window !== "undefined" && window.__lab) {
      window.__lab.fps = { median: +(1 / med).toFixed(1), dpr: +st.dpr.toFixed(2),
                           cap, actual: gl.getPixelRatio() };
    }
  });

  return null;
}
