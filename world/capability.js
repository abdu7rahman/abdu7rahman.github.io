/* What this machine can actually do, asked rather than assumed.
 *
 * No user-agent sniffing: it is wrong about hardware roughly as often as it
 * is right, and it has never once been right about a GPU. This asks the GPU
 * what it is, counts the cores, and checks the two preferences that outrank
 * everything else.
 */
import { TIERS } from "./config.js";

export function detect() {
  const reduced = window.matchMedia &&
                  window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const coarse = window.matchMedia &&
                 window.matchMedia("(pointer: coarse)").matches;
  const narrow = window.innerWidth < 900;

  let gl = null, renderer = "", tier = "low";
  try {
    const c = document.createElement("canvas");
    gl = c.getContext("webgl2") || c.getContext("webgl");
    if (gl) {
      const dbg = gl.getExtension("WEBGL_debug_renderer_info");
      renderer = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : "";
    }
  } catch (e) { gl = null; }

  if (gl) {
    const cores = navigator.hardwareConcurrency || 4;
    const mem = navigator.deviceMemory || 4;
    // A software rasteriser names itself. It will run this, slowly, and the
    // honest response is the low tier rather than a stutter.
    const soft = /swiftshader|llvmpipe|softwarepipe|microsoft basic/i.test(renderer);
    if (soft || narrow || coarse) tier = "low";
    else if (cores >= 8 && mem >= 8) tier = "high";
    else tier = "medium";
  }

  return {
    ok: !!gl && !reduced,
    webgl2: !!(gl && gl.getParameter && typeof WebGL2RenderingContext !== "undefined"
               && gl instanceof WebGL2RenderingContext),
    reduced, coarse, narrow, renderer, tier,
    quality: TIERS[tier]
  };
}

/* Palette straight off the document, so the world is lit in the page's own
   colours and cannot drift from them. */
export function tokens(names) {
  const cs = getComputedStyle(document.documentElement);
  const out = {};
  for (const n of names) out[n] = (cs.getPropertyValue(n) || "").trim() || "#888888";
  return out;
}
