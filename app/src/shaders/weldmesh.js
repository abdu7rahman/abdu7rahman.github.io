import * as THREE from "three";

/* Welded wire mesh, as a patch on the standard material.
 *
 * Machine guarding is a 50 mm welded grid in a frame, and the whole point of
 * it is that you can see the cell through it. This building's fence was a
 * solid semi-transparent slab standing in for that, which reads as a smoked
 * panel: every bay behind it lost its depth, and the one place in the
 * facility where you are meant to be looking past something was the one
 * place you could not.
 *
 * Analytic rather than a texture, for the reason every other surface here is:
 * there is nothing to download and it is the same handful of instructions at
 * any distance. It also means the wire gauge and the pitch are metres, not
 * pixels, so a panel is the mesh it says it is however close the camera gets.
 *
 * The far field is the part worth explaining. A 6 mm wire on a 50 mm grid
 * covers 22.6 per cent of the panel, so once one pixel spans several
 * apertures the honest answer is "22.6 per cent opaque" -- but a binary
 * discard cannot say that, and what it does instead is sample the grid at
 * random and sparkle. So the coverage is floored by a term that rises with
 * the screen-space size of one pitch: near to, the discard cuts real holes;
 * far off, every fragment passes and the panel resolves to a flat sheet.
 * That is a lie about the geometry and the correct answer about the image,
 * which is what filtering always is.
 */
const DECL_V = /* glsl */`
varying vec2 vMesh;
`;

const DECL_F = /* glsl */`
varying vec2 vMesh;
uniform float uPitch;     // wire to wire, metres
uniform float uWire;      // wire diameter, metres
uniform float uFade;      // how opaque the far field settles at
uniform float uCut;       // coverage below this is a hole
`;

export function weldmesh(material, opt = {}) {
  const u = {
    uPitch: { value: opt.pitch ?? 0.05 },
    uWire:  { value: opt.wire ?? 0.006 },
    uFade:  { value: opt.fade ?? 0.92 },
    uCut:   { value: opt.cut ?? 0.5 }
  };

  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = DECL_V + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      "#include <begin_vertex>\n      vMesh = position.xy;"
    );
    shader.fragmentShader = DECL_F + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <color_fragment>",
      /* glsl */`
      #include <color_fragment>
      // Distance from this fragment to the nearest wire centre, in each axis.
      vec2 wm_g = abs(fract(vMesh / uPitch) - 0.5) * uPitch;
      float wm_d = min(wm_g.x, wm_g.y);
      float wm_aa = fwidth(wm_d) + 1e-5;
      float wm_cov = 1.0 - smoothstep(uWire * 0.5 - wm_aa, uWire * 0.5 + wm_aa, wm_d);
      float wm_lod = max(fwidth(vMesh.x), fwidth(vMesh.y)) / uPitch;
      if (max(wm_cov, smoothstep(0.30, 1.60, wm_lod) * uFade) < uCut) discard;
      /* A crossing is two wires deep and catches more light than a straight
         run does. Cheap, and it is the difference between a grid of lines
         and something that was welded. */
      float wm_x = 1.0 - smoothstep(uWire * 0.4, uWire * 1.4, max(wm_g.x, wm_g.y));
      diffuseColor.rgb *= mix(0.86, 1.16, wm_x);
      `
    );
  };

  material.customProgramCacheKey = () => "weldmesh";
  return material;
}
