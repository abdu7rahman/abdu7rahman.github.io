/* What the machine in front of us can actually draw, asked rather than assumed.
 *
 * This building was written on a desktop GPU and it shows. Every number here
 * was taken by loading a live page and reading gl.info.render back through
 * window.__lab, at 1440 by 900 in a headless Chromium with the post chain
 * off (?post=0) -- with it on, three resets info at the top of every
 * render() and the grade makes four of them, so what comes back is the last
 * pass's full-screen quad and nothing else.
 *
 * Read rather than counted off the source, because the source undercounts in
 * both directions: an instanced mesh is one call and many triangles, a
 * shadow-casting light re-draws every caster once more, and frustum culling
 * removes things no reading of the source knows about.
 *
 * What a frame at the entrance costs with nothing stale -- every shadow map
 * forced, so this is the ceiling and not the schedule:
 *
 *   whole frame, camera at the entry    1,128 calls   883,258 tris
 *   the eight cell spotlights' shadows   -438 calls  -455,163 tris
 *   the key's 2048 shadow map             -93 calls  -116,161 tris
 *   the eight rigs                       -442 calls  -506,634 tris
 *
 * Those rows overlap and are meant to: a rig's triangles are drawn once for
 * the camera and again into every shadow map that can see them, so hiding
 * the rigs takes them out of all of it. Shadow work alone is 531 of the
 * 1,128 calls and 571,324 of the 883,258 triangles -- 47 per cent of the
 * calls and 65 per cent of the geometry in a fully drawn frame exists to be
 * rendered from a light's point of view.
 *
 * And what the three tiers cost, same camera, median of twenty-four real
 * frames so the cell shadow schedule is running rather than forced:
 *
 *   high    808 calls   561,924 tris   dpr up to 2.0   shadow map on
 *   medium  756 calls   494,251 tris   dpr up to 1.5   shadow map on
 *   low     596 calls   311,932 tris   dpr 1.0         shadow map off
 *
 * High is 320 calls under the forced frame with nothing taken out of the
 * scene, which is the cell shadow schedule: six of the eight maps are a
 * frame or more old on any given frame and cost nothing to keep. The gap
 * from high to medium is 52 calls, which is one cell shadow map -- priced
 * individually the eight run 34 to 105 and average exactly 52 -- and that is
 * the whole of what dropping a slot buys.
 *
 * The dpr column is a ceiling rather than a measurement. App.jsx asks for
 * dpr={[1, quality.dpr]} and R3F clamps that to the device's own ratio, and
 * a headless page is dpr 1, so every tier above rendered at 1 and none of
 * these numbers include the fragment cost the column names. On a phone at
 * dpr 2 that cost is four times dpr 1 and lands on top of all of it, which
 * is why resolution sits second in the ladder and not last.
 *
 * So the tiers are built in that order: shadows first, resolution second,
 * post third, geometry last. Dropping the machines would be dropping the
 * subject of a robotics portfolio, so it is the one thing no tier does.
 */

/* Fragment cost is dpr squared, so these three are 4.00, 2.25 and 1.00 times
   the fragments of one CSS pixel. That is the whole justification for the
   ladder: there is no other single number in a WebGL page with that leverage.

   cellShadows is how many of the eight test-cell spotlights re-render their
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
/* `work` is the one that is not about drawing.
 *
 * Eight cells run real algorithms every frame, and the cost of those is on
 * the CPU where none of the other four settings reach: the race bay's MPPI
 * rolls out 96 sequences of 16 steps twenty times a second, the local
 * control bay scores 147 trajectories at the same rate, the cost bay re-runs
 * four A* passes twice a second, and six of the eight are stepping a MuJoCo
 * model besides. Halving the resolution does nothing about any of it.
 *
 * So it is a scale on sample counts, and the rigs read it and cut the
 * numbers that are sampling rather than the numbers that are the algorithm:
 * fewer rollouts, not a shorter horizon; fewer points in the cloud, not a
 * smaller workspace. What each bay shows stays true at every tier, it is
 * just estimated from less. That distinction is the whole reason this is a
 * scale and not a set of feature switches.
 *
 * Measured the same way as everything above, with the camera parked at each
 * station by the building's own navigation rather than by a second copy of
 * the shot numbers. All eight cells, high against low:
 *
 *                high             low
 *   search       396 / 431,926    110 /  99,477
 *   local ctl    412 / 412,511    113 /  94,748
 *   race         494 / 519,906    124 / 143,525
 *   swerve       514 / 475,962    125 /  80,572
 *   replan       570 / 537,900    143 / 107,427
 *   cost         561 / 519,610    144 / 123,221
 *   sorting      592 / 510,669    190 / 125,495
 *   cloned       518 / 435,141    125 /  94,644
 *   entrance     808 / 561,924    596 / 311,932
 *
 * The entrance is still the heaviest frame in the building, because from
 * there you can see all of it -- but only by 1.36 times the heaviest cell on
 * calls now, not the factor of three it was when the cells were a machine
 * standing beside a picture of its demo. The cells caught up by becoming the
 * demo.
 *
 * Low is 3.8 times fewer calls across the eight, and almost all of that is
 * the shadow maps: the entrance drops far less because what it is drawing is
 * the building rather than any cell's work. Sorting is the most expensive
 * cell at either tier, which is the one that stands two arms instead of one.
 *
 * Frame rate is deliberately not in that table. Every headless render of
 * this building runs under SwiftShader on a contended machine, where the
 * measurement is dominated by what else is running -- the search cell timed
 * slower at low than at high on one pass, which is noise and not a result.
 * Draw calls and triangles are deterministic, so they are what is recorded.
 */
export const TIERS = {
  high:   { dpr: 2.0, post: true,  shadows: true,  keyShadow: 2048, cellShadows: 2, work: 1.00 },
  medium: { dpr: 1.5, post: true,  shadows: true,  keyShadow: 1024, cellShadows: 1, work: 0.60 },
  low:    { dpr: 1.0, post: false, shadows: false, keyShadow: 0,    cellShadows: 0, work: 0.35 }
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
