import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { detect, watchStillness } from "../lib/capability.js";
import { setSlots, tick } from "./shadowBudget.js";

/* What the frame is allowed to spend, and what a reader has asked it not to
 * do. One component, because both are the same kind of thing: a decision
 * taken once a frame, before anything else in the building reads the clock.
 *
 * Reduced motion here means something narrower than "stop", which would be a
 * blank building. Autonomous, looping motion stops: the camera's breathing,
 * the eight machine cycles, the screen flicker. Motion the reader is causing
 * does not -- asking for a station still walks you there, hovering a cell
 * floor still opens the costmap -- because a control that stops responding
 * is not an accessibility feature.
 *
 * The split falls out of which clock a thing reads. Anything on a cycle is
 * written against clock.elapsedTime; anything on an easing is written
 * against the per-frame delta. So holding elapsedTime still while leaving
 * delta alone stops every cycle in the building and leaves every easing
 * working, without a single component knowing this file exists.
 *
 * Subtracting the delta rather than pinning a saved value, because pinning
 * would make time jump the moment the preference was turned back off: three
 * accumulates elapsedTime inside getDelta, so cancelling exactly this
 * frame's increment holds the total where it was and resumes from there.
 *
 * Priority is negative on purpose. R3F counts only positive priorities when
 * it decides whether somebody else is doing the rendering -- lab/Grade.jsx
 * is, at 1 -- so this runs first every frame and takes nothing over.
 */
export default function Budget() {
  const still = useRef(false);

  useEffect(() => {
    setSlots(detect().quality.cellShadows);
    return watchStillness(v => { still.current = v; });
  }, []);

  useFrame(({ clock }, dt) => {
    tick();
    if (still.current) clock.elapsedTime -= dt;
  }, -1000);

  return null;
}
