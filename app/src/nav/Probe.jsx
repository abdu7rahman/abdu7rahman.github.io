import { useThree } from "@react-three/fiber";
import { useEffect } from "react";
import { detect } from "../lib/capability.js";

/* A handle on the scene for anything outside it.
 *
 * The document site carries the same thing as window.__world, and for the
 * same reason: a WebGL page cannot be checked from the outside without one.
 * Every fault worth finding in this building so far -- a floor that rendered
 * black, a reveal that discarded every fragment, a camera still halfway to
 * its mark when the shutter went -- was invisible to a screenshot and obvious
 * the moment the scene could be queried directly.
 *
 * It exposes what is already there and drives nothing. Read-only by
 * convention rather than by enforcement, because a handle that lets a probe
 * move the world tests the probe rather than the page.
 */
export default function Probe() {
  const { scene, camera, gl, clock } = useThree();
  useEffect(() => {
    /* The clock is here because the one thing about this building that
       cannot be photographed is whether it is moving. lab/Budget.jsx
       implements reduced motion by holding elapsedTime still while leaving
       the frame delta alone, so a cycle stops and an easing keeps working
       -- and both states look identical in a screenshot. Reading the clock
       twice a second apart is the only check of it there is. */
    window.__lab = { scene, camera, gl, clock, capability: detect() };
    return () => { delete window.__lab; };
  }, [scene, camera, gl, clock]);
  return null;
}
