/* The material everything solid in the world is made of.
 *
 * The world was one additive point cloud and nothing else, and that was the
 * ceiling. Points carry no surface: nothing occludes anything, so depth never
 * resolves; there is no normal, so there is no shading and no fresnel; there
 * is no material, so a change of state can only be a change of position. Four
 * of the five stations came out as dust and stray lines -- a debug view of a
 * scene rather than a scene. The one that read was the hero, and the only
 * reason was the solid arm underneath it.
 *
 * So the matter is solid now and the cloud is what connects it. One material,
 * instanced, carrying:
 *
 *   - a key and a fill, so a form has a lit side and a dark one
 *   - fresnel at the silhouette, which is what separates one object from the
 *     one behind it when both are nearly black
 *   - exponential fog to the page's own background, so distance reads as
 *     distance instead of as smaller
 *   - a machined grid ruled across the surface in world space, fading out with
 *     distance, because a plain matte volume at this scale reads as clay
 *   - a dissolve that erodes from a noise field, so a form can come apart into
 *     the substrate rather than being switched off
 *   - a per-instance focus, so the object being read is the one that is lit
 */
import * as THREE from "three";
import { SIMPLEX3 } from "./noise.glsl.js";

export function makeSurface({ base, accent, teal, fog, instanced = true }) {
  const uniforms = {
    uTime:   { value: 0 },
    uCut:    { value: 0 },      // 0 solid, 1 gone
    uFocus:  { value: -1 },     // which instance is active, -1 for none
    uCharge: { value: 0 },
    uGrid:   { value: 0.055 },  // how far the ruling is allowed to darken
    uPitch:  { value: 6.5 },    // rules per metre
    uFogNear:{ value: 3.0 },
    uFogFar: { value: 26.0 },
    uBase:   { value: new THREE.Color(base) },
    uAccent: { value: new THREE.Color(accent) },
    uTeal:   { value: new THREE.Color(teal) },
    uFog:    { value: new THREE.Color(fog) },
    uKey:    { value: new THREE.Vector3(-0.42, 0.78, 0.46).normalize() }
  };

  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */`
      ${instanced ? "attribute float aIndex;\nattribute float aSeed;" : ""}
      varying vec3 vN, vW, vV;
      varying float vSeed, vIndex;
      void main(){
        vec3 n = normal;
        vec4 world = vec4(position, 1.0);
        #ifdef USE_INSTANCING
          world = instanceMatrix * world;
          n = mat3(instanceMatrix) * n;
        #endif
        world = modelMatrix * world;
        vW = world.xyz;
        vN = normalize(mat3(modelMatrix) * n);
        vec4 mv = viewMatrix * world;
        vV = -mv.xyz;
        ${instanced ? "vSeed = aSeed; vIndex = aIndex;" : "vSeed = 0.0; vIndex = -1.0;"}
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      ${SIMPLEX3}
      uniform float uTime, uCut, uFocus, uCharge, uGrid, uPitch, uFogNear, uFogFar;
      uniform vec3 uBase, uAccent, uTeal, uFog, uKey;
      varying vec3 vN, vW, vV;
      varying float vSeed, vIndex;

      void main(){
        vec3 n = normalize(vN);
        vec3 v = normalize(vV);
        // Two-sided: a box seen from inside should still be lit, not black.
        if (!gl_FrontFacing) n = -n;

        // The erosion is the same field the substrate's points are released
        // on, so a surface coming apart and the cloud it becomes are the same
        // event seen twice.
        float grain = snoise(vW * 2.3 + vSeed * 17.0) * 0.5 + 0.5;
        float cut = uCut * 1.18;
        if (grain < cut - 0.09) discard;
        float edge = smoothstep(cut - 0.09, cut + 0.02, grain);

        float lam = max(0.0, dot(n, uKey));
        float wrap = max(0.0, dot(n, uKey) * 0.5 + 0.5);   // soft fill from below
        vec3 h = normalize(uKey + v);
        float spec = pow(max(0.0, dot(n, h)), 42.0) * 0.34;
        float fres = pow(1.0 - max(0.0, dot(n, v)), 3.0);

        // Ruled in world space so the lines belong to the object and not to
        // the screen, and thinned with distance so a far surface does not
        // moire into a grey wash.
        float d = length(vV);
        vec3 g = abs(fract(vW * uPitch) - 0.5);
        float rule = 1.0 - smoothstep(0.0, 0.06, min(min(g.x, g.y), g.z));
        rule *= 1.0 - smoothstep(4.0, 13.0, d);

        vec3 col = uBase * (0.16 + 0.62 * lam + 0.30 * wrap);
        col += vec3(spec);
        col -= rule * uGrid;
        // The silhouette is where one nearly-black form stops and the next
        // begins, so it is the one place the accent is spent unconditionally.
        col = mix(col, uAccent, fres * 0.42);

        // Whichever one is being read is lit, the rest recede. -1 lights none.
        float on = uFocus < 0.0 ? 0.0 : 1.0 - clamp(abs(vIndex - uFocus), 0.0, 1.0);
        col = mix(col, mix(col, uTeal, 0.30) * 1.5, on);
        // A burning rim while it erodes, so a dissolve looks like heat rather
        // than like alpha.
        col = mix(col, uAccent * 2.2, (1.0 - edge) * step(0.001, uCut));
        col += uAccent * uCharge * fres * 0.16;

        float fogT = smoothstep(uFogNear, uFogFar, d);
        col = mix(col, uFog, fogT * 0.92);

        gl_FragColor = vec4(col, (0.90 - fogT * 0.42) * edge);
      }`
  });

  mat.userData.uniforms = uniforms;
  return mat;
}

/* Per-instance index and seed, so one InstancedMesh can still say which of its
   members is the one being looked at. */
export function seedSurface(geo, n, seed) {
  const idx = new Float32Array(n), sd = new Float32Array(n);
  for (let i = 0; i < n; i++) { idx[i] = i; sd[i] = seed ? seed(i, n) : i * 0.6180339887 % 1; }
  geo.setAttribute("aIndex", new THREE.InstancedBufferAttribute(idx, 1));
  geo.setAttribute("aSeed", new THREE.InstancedBufferAttribute(sd, 1));
  return geo;
}
