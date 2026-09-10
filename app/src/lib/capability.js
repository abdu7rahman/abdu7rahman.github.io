/* What the machine in front of us can actually draw, asked rather than assumed.
 *
 * This building was written on a desktop GPU and it shows. Measured in a
 * headless Chromium at 1440x900 with the camera at the entry, one frame is
 * 685 draw calls and 314,568 triangles, and 320 of those calls and 156,565 of
 * those triangles are shadow maps -- 47% of the calls and 50% of the geometry
 * in a frame exists only to be rendered from a light's point of view. On top
 * of that the canvas asked for dpr up to 2, which on a phone is four times the
 * fragments of dpr 1 for a panel nobody holds close enough to resolve.
 *
 * The numbers below were taken by loading a live page at each tier and
 * reading gl.info.render back through window.__lab, not by counting the
 * source, because the source undercounts: instanced meshes are one call and
 * many triangles, a shadow-casting light re-draws every caster once more, and
 * frustum culling removes things the source has no idea about.
 *
 * What one frame cost before any of this existed, everything on:
 *
 *   whole frame, camera at the entry     685 calls   314,568 tris
 *   the seven cell spotlights' shadows  -229 calls  -102,383 tris
 *   the key's 2048 shadow map            -91 calls   -54,182 tris
 *   the seven machines                   -49 calls  -101,441 tris
 *
 * And what the three tiers cost now, same camera, measured the same way.
 * Read gl.info.render with the post chain off (?post=0) or the number you
 * get is the grade's own full-screen quad -- three resets info at the top
 * of every render() and the pass makes four of them, so the last one wins:
 *
 *   high    561 calls   250,669 tris   dpr 2.0   shadow map on
 *   medium  548 calls   234,575 tris   dpr 1.5   shadow map on
 *   low     401 calls   158,759 tris   dpr 1.0   shadow map off
 *
 * High is 124 calls under the old whole-frame figure with nothing removed
 * from the scene, which is the cell shadow schedule: five of the seven maps
 * are a frame or two old on any given frame and cost nothing to keep.
 * Fragment cost is dpr squared on top of all of it, so the three tiers are
 * 4.00, 2.25 and 1.00 times each other before a single triangle is counted.
 *
 * So the tiers are built in that order: shadows first, resolution second,
 * post third, geometry last. Dropping the machines would be dropping the
 * subject of a robotics portfolio, so it is the one thing no tier does.
 */

/* Fragment cost is dpr squared, so these three are 4.00, 2.25 and 1.00 times
   the fragments of one CSS pixel. That is the whole justification for the
   ladder: there is no other single number in a WebGL page with that leverage.

   cellShadows is how many of the seven test-cell spotlights re-render their
   shadow map on a given frame, not how many cast at all. The distinction
   matters and it is why this is a number rather than a boolean: three lets a
   light keep the shadow map it last drew (shadow.autoUpdate = false,
   shadow.needsUpdate = true when it should refresh), and everything in a cell
   except the machine is static, so a cell you are not looking at can keep a
   frame-old shadow and cost nothing. Turning castShadow off instead would
   change numSpotLightShadows and recompile every material in the building
   mid-scroll, which is the one thing worse than the cost being saved.

   keyShadow is the directional's map size. Its shadow camera spans 48 m
   (-24 to +24), so 2048 is 42.7 texels per metre and 1024 is 21.3 -- at 1024
   a 0.42 m column edge is 9 texels across, which is still a hard edge, and it
   is a quarter of the memory and a quarter of the fill. */
export const TIERS = {
  high:   { dpr: 2.0, post: true,  shadows: true,  keyShadow: 2048, cellShadows: 2 },
  medium: { dpr: 1.5, post: true,  shadows: true,  keyShadow: 1024, cellShadows: 1 },
  low:    { dpr: 1.0, post: false, shadows: false, keyShadow: 0,    cellShadows: 0 }
};

/* One reading, cached, because every consumer must agree and because probing
   WebGL creates a context. Not memoised across a reload, deliberately: the
   override below is how this gets looked at at all. */
let cached = null;

export function detect() {
  if (cached) return cached;

  const mq = (q) => typeof window.matchMedia === "function" && window.matchMedia(q).matches;
  const coarse = mq("(pointer: coarse)");
  const narrow = window.innerWidth < 900;

  /* No user-agent sniffing. It is wrong about hardware about as often as it
     is right and it has never once been right about a GPU. Ask the context
     what it is, count the cores, and let the two preferences that outrank
     hardware -- pointer and reduced motion -- have the last word. */
  let gl = null, renderer = "", soft = false, webgl2 = false;
  try {
    const c = document.createElement("canvas");
    gl = c.getContext("webgl2") || c.getContext("webgl");
    if (gl) {
      webgl2 = typeof WebGL2RenderingContext !== "undefined" && gl instanceof WebGL2RenderingContext;
      const dbg = gl.getExtension("WEBGL_debug_renderer_info");
      renderer = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : "";
      const lose = gl.getExtension("WEBGL_lose_context");
      if (lose) lose.loseContext();
    }
  } catch (e) { gl = null; }

  const cores = navigator.hardwareConcurrency || 4;
  const mem = navigator.deviceMemory || 4;

  /* A software rasteriser names itself. It is not a tier, it is a different
     kind of machine: this building draws about four frames a second under
     SwiftShader, which is the rate every headless render of it is taken at.
     It goes to low and it says so, so that a measurement taken in one is
     never mistaken for a measurement of the real thing. */
  soft = /swiftshader|llvmpipe|softwarepipe|microsoft basic/i.test(renderer);

  let tier;
  if (!gl) tier = "low";
  else if (soft || coarse || narrow) tier = "low";
  else if (cores >= 8 && mem >= 8) tier = "high";
  else tier = "medium";

  /* A tier can be asked for. This is not a feature for readers: it is the
     only way the graded frame gets photographed, because the browser that can
     be driven from a script is exactly the one the software check sends to
     the tier with no post in it. */
  let forced = false;
  let quality;
  try {
    const q = new URLSearchParams(location.search);
    const want = q.get("lab");
    if (want && TIERS[want]) { tier = want; forced = true; }
    quality = TIERS[tier];
    /* One switch on top of the tier, for the post chain alone.
    
       Not a convenience. The grade is the one part of this building whose
       two paths can silently disagree -- with post the scene is rendered
       into a target, which compiles every program with no tone curve and a
       linear output, and without it three's output stage does the curve and
       the encode instead. A material that ends up in a different space in
       one of those than the other looks fine in whichever one its author was
       looking at, and the last time that happened the daylight shafts failed
       to compile under the target and simply were not in the frame.
    
       So the two have to be comparable in the same browser on the same
       frame, which is what this is for. Currently, at the entrance:
       shaft p50 180 both ways, lit lane 92 with and 94 without, whole frame
       21 with and 25 without -- the differences being the contrast, the
       vignette and the bloom, which is all this pass is supposed to add. */
    const wantPost = q.get("post");
    if (wantPost === "0" || wantPost === "1") {
      quality = { ...quality, post: wantPost === "1" };
      forced = true;
    }
  } catch (e) { quality = TIERS[tier]; /* no location, no override */ }

  cached = {
    tier, forced, soft, webgl2, coarse, narrow, cores, mem, renderer,
    quality
  };
  return cached;
}

/* Reduced motion, asked live rather than once.
 *
 * Separate from the tier on purpose. A tier is a statement about a machine
 * and this is a statement about a person, they are not correlated, and a
 * reader on a workstation who has turned motion down is entitled to the full
 * resolution and the full grade with none of the movement. It is also the one
 * preference that can change while the page is open -- a system setting
 * toggled in another window -- so it is a live query with a listener and not
 * a boolean frozen at load.
 *
 * What it means here is narrower than "stop everything", which would be a
 * blank building. Autonomous, looping motion stops: the camera's breathing,
 * the arm cycles, the screen flicker. Motion the reader is causing does not:
 * scrolling still walks the aisle and hovering a cell floor still opens the
 * costmap, because a control that stops responding is not an accessibility
 * feature. lab/Budget.jsx implements that split by freezing the clock's
 * elapsed time while leaving the per-frame delta alone -- everything driven
 * by a cycle stops, everything driven by an easing keeps working.
 *
 * Checked rather than asserted, because both states look identical in a
 * screenshot: with the preference set, window.__lab.clock.elapsedTime read
 * three seconds apart went 0 to 0 while a scroll over the same interval
 * still walked the camera from z = 4 to z = -18.
 */
export function watchStillness(onChange) {
  if (typeof window.matchMedia !== "function") { onChange(false); return () => {}; }
  const m = window.matchMedia("(prefers-reduced-motion: reduce)");
  const fire = () => onChange(m.matches);
  fire();
  // addEventListener on a MediaQueryList is the modern spelling and addListener
  // is the one Safari shipped for years; both are cheap to try.
  if (m.addEventListener) { m.addEventListener("change", fire); return () => m.removeEventListener("change", fire); }
  m.addListener(fire);
  return () => m.removeListener(fire);
}
