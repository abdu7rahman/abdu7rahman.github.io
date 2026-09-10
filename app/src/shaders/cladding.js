import * as THREE from "three";

/* Profiled sheet, as a patch on the standard material rather than as a
 * second one.
 *
 * The envelope was six planes with a flat albedo on them, and a 66 m flank
 * of one uninterrupted mid grey is the single largest surface in the
 * building. Nothing is on it, nothing crosses it, and every luminaire down
 * the run lands on it as the same value -- so the eye reads it as a
 * backdrop, which is exactly what "too blocky" means when somebody says it
 * about a render. A real shed is clad in trapezoidal sheet at a third of a
 * metre pitch, and under a row of point sources that pitch is a hundred and
 * ninety alternating highlights and shadows running the length of the wall.
 * It is the cheapest depth cue in the building and it was the one missing.
 *
 * Done as onBeforeCompile on a MeshStandardMaterial, not as a ShaderMaterial.
 * The wall has to keep taking the key light, the seven cell lamps, the
 * shadow maps and the fog, and every one of those is a chunk three already
 * assembles correctly -- reimplementing them to get a rib profile would be
 * trading the whole lighting model for a normal perturbation. Two chunks are
 * replaced and the rest of the shader is three's.
 *
 * No texture, no normal map, no fetch. The profile is analytic, so it is the
 * same handful of instructions at any distance and there is nothing to
 * download, which matters because this is the first thing on screen.
 */

/* The tangent problem, and why it is solved in the vertex shader.
 *
 * `normal` in the fragment shader is in view space, so tilting it along the
 * rib profile needs the in-plane direction the profile varies along, also in
 * view space. Deriving that from screen-space derivatives works and is what
 * a normal map does, but these are planes with a known orientation: the
 * direction is a constant in object space, and normalMatrix takes it to view
 * space in the vertex shader for the cost of one mat3 multiply per vertex on
 * a four-vertex mesh. */
const DECL_V = /* glsl */`
varying vec2 vClad;
varying vec3 vCladT;
uniform vec3 uCladAxis;
`;

const DECL_F = /* glsl */`
varying vec2 vClad;
varying vec3 vCladT;
uniform float uPitch;     // rib to rib, metres
uniform float uCrown;     // fraction of the pitch the crown occupies
uniform float uRamp;      // fraction of the pitch each web occupies
uniform float uDepth;     // rib depth, metres
uniform float uSeam;      // sheet joint spacing along the other axis, metres
uniform float uBase;      // where the wall starts, so a height is a height
uniform float uDado;      // top of the base course, metres; negative for none
uniform vec3  uDadoC;

/* The derivative of smoothstep, because the profile is a height field and
   what the normal wants is its slope. Analytic rather than dFdx: a
   screen-space derivative of a function this high frequency aliases into
   noise the moment the wall is seen at a grazing angle, which is the angle
   a wall down a 66 m aisle is always seen at. */
float dsmooth(float e0, float e1, float x) {
  float t = clamp((x - e0) / (e1 - e0), 0.0, 1.0);
  return 6.0 * t * (1.0 - t) / (e1 - e0);
}
`;

/* The profile itself: crown, web, valley, web, repeat. Trapezoidal, which is
   what the sheet actually is -- a sinusoid would be smoother and would throw
   a soft gradient instead of the hard bright line down each crown edge that
   is the entire reason this is here. */
const PROFILE = /* glsl */`
  float clad_u = vClad.x / uPitch;
  float clad_f = fract(clad_u);
  float clad_valley = smoothstep(uCrown, uCrown + uRamp, clad_f)
                    - smoothstep(1.0 - uRamp, 1.0, clad_f);
  float clad_slope = (dsmooth(1.0 - uRamp, 1.0, clad_f)
                    - dsmooth(uCrown, uCrown + uRamp, clad_f))
                    * uDepth / uPitch;
`;

export function cladding(material, opt = {}) {
  const u = {
    uCladAxis: { value: opt.axis ? opt.axis.clone() : new THREE.Vector3(1, 0, 0) },
    uPitch:    { value: opt.pitch ?? 0.333 },
    uCrown:    { value: opt.crown ?? 0.40 },
    uRamp:     { value: opt.ramp ?? 0.15 },
    uDepth:    { value: opt.depth ?? 0.036 },
    uSeam:     { value: opt.seam ?? 3.05 },
    uBase:     { value: opt.base ?? 0 },
    uDado:     { value: opt.dado ?? -1 },
    uDadoC:    { value: new THREE.Color(opt.dadoColour ?? "#191a1c") }
  };

  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = DECL_V + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      /* glsl */`
      #include <begin_vertex>
      /* Plane geometry lies in its own x/y, so the two in-plane coordinates
         are the position straight off the attribute. uCladAxis picks which
         of them the ribs run across, so one material serves a wall with
         vertical ribs and a shutter with horizontal slats. */
      vClad = uCladAxis.x > 0.5 ? position.xy : position.yx;
      vCladT = normalize(normalMatrix * (uCladAxis.x > 0.5
                 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0)));
      `
    );

    shader.fragmentShader = DECL_F + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <normal_fragment_begin>",
      /* glsl */`
      #include <normal_fragment_begin>
      ${PROFILE}
      normal = normalize(normal - vCladT * clad_slope);
      `
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <color_fragment>",
      /* glsl */`
      #include <color_fragment>
      ${PROFILE}
      /* A little albedo either side of the tilt. The normal does most of the
         work, but a wall seen face on has no raking light to tilt into and
         would go flat again at exactly the moment the reader is closest to
         it, which is the only moment that matters. Kept small: this is dirt
         and paint thickness, not a second shading model. */
      diffuseColor.rgb *= mix(1.05, 0.90, clad_valley);

      /* Sheet joints across the ribs. A cladding run is not one sheet; it is
         lapped every three metres and the lap is a line. */
      float clad_h = vClad.y + uBase;
      if (uSeam > 0.0) {
        float clad_s = abs(fract(clad_h / uSeam) - 0.5) * uSeam;
        diffuseColor.rgb *= mix(0.72, 1.0, smoothstep(0.0, 0.035, clad_s));
      }

      /* The base course. A shed takes its knocks in the bottom two metres,
         so that is where the sheet stops and something that survives a
         pallet truck starts. It also puts a horizontal line the whole length
         of the building at a constant height, which is the reference the eye
         needs to read 66 m as 66 m. */
      if (uDado > 0.0) {
        float clad_d = smoothstep(uDado - 0.02, uDado + 0.02, clad_h);
        diffuseColor.rgb = mix(uDadoC, diffuseColor.rgb, clad_d);
        // The flashing over the joint, which is the one bright line on it.
        diffuseColor.rgb *= 1.0 + 0.9 * exp(-pow((clad_h - uDado) / 0.045, 2.0));
      }
      `
    );
  };

  /* Without this the patched material and an unpatched standard material
     hash to the same program and whichever compiles first wins -- silently,
     and in whichever direction the traversal happens to run that session. */
  material.customProgramCacheKey = () => "cladding";
  return material;
}
