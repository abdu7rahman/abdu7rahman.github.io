/* The material a scene is made of, and the one it leaves by.
 *
 * A handoff between scenes is not a crossfade here. The surface erodes: a
 * noise field is thresholded against a rising cut, fragments below it are
 * discarded, and the band right at the threshold burns in the page's accent
 * before it goes. The vertices near the threshold push out along their normals
 * first, so the object visibly comes apart instead of politely fading -- that
 * displacement is what sells it as a physical event rather than an opacity
 * ramp.
 *
 * Fresnel on top, because a rim that answers to the viewing angle is most of
 * what separates "a lit mesh" from "a rendered object".
 */
import * as THREE from "three";
import { SIMPLEX3 } from "./noise.glsl.js";

export function makeDissolveMaterial({ color, accent, rough = 0.42 }) {
  const uniforms = {
    uTime:    { value: 0 },
    uCut:     { value: 0 },      // 0 solid, 1 gone
    uEdge:    { value: 0.085 },  // width of the burning band
    uScale:   { value: 2.6 },    // noise frequency over the surface
    uPush:    { value: 0.16 },   // how far the freed vertices travel
    uColor:   { value: new THREE.Color(color) },
    uAccent:  { value: new THREE.Color(accent) },
    uRough:   { value: { value: rough }.value },
    uPointer: { value: new THREE.Vector2(0, 0) },
    uCharge:  { value: 0 }       // pointer speed, drives the surface unrest
  };

  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: false,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */`
      ${SIMPLEX3}
      uniform float uTime, uCut, uScale, uPush, uCharge;
      varying vec3 vN, vW;
      varying float vNoise;
      void main(){
        vec3 p = position;
        // The same field the fragment stage thresholds, so what lifts off the
        // surface is exactly what is about to be cut away.
        float n = fbm(p * uScale + vec3(0.0, 0.0, uTime * 0.08));
        vNoise = n * 0.5 + 0.5;
        float freed = smoothstep(uCut - 0.22, uCut + 0.06, vNoise);
        // Freed near the cut means "about to go": push those out, and let the
        // pointer's speed add a little unrest to the whole surface.
        p += normal * (1.0 - freed) * uPush * step(0.001, uCut);
        p += normal * uCharge * 0.012 * sin(uTime * 2.3 + vNoise * 9.0);
        vec4 world = modelMatrix * vec4(p, 1.0);
        vW = world.xyz;
        vN = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: /* glsl */`
      uniform float uCut, uEdge, uRough;
      uniform vec3 uColor, uAccent;
      varying vec3 vN, vW;
      varying float vNoise;

      const vec3 KEY = vec3(-0.5960, 0.6572, 0.4614);   // normalized

      /* A studio, written down instead of loaded.
      
         The arm was lit by one lambert term and a fresnel, which is a matte
         plastic toy however good the mesh is: metal reads as metal because of
         what it *reflects*, and it was reflecting nothing. A real environment
         map would mean an HDR to fetch, a PMREM to build and a fetch this
         site does not make, so the environment is a function -- a gradient
         sky, a dark floor to stand on, one bright card where the key is, and
         a dim warm kicker opposite it so the shadow side keeps an edge.
         Sampled along the reflection for specular and along the normal for
         irradiance, which is the cheap half of image-based lighting and the
         half that does the work.

         The values are what a room actually is, not what looks safe on a
         near-black page. The first pass had the sky at 0.4 and the card at
         0.85, which is a cupboard: rendered with the point cloud switched off
         the arm came out all but invisible, and every correction I made after
         that was aimed at a white shape that turned out to be the cloud in
         front of it, not the machine behind. */
      vec3 env(vec3 d){
        float up = d.y * 0.5 + 0.5;
        vec3 c = mix(vec3(0.14,0.15,0.18), vec3(1.05,1.10,1.24), pow(up, 1.25));
        c = mix(vec3(0.10,0.095,0.088), c, smoothstep(-0.35, 0.05, d.y));
        c += vec3(1.0,0.94,0.86) * pow(max(dot(d, KEY), 0.0), 16.0) * 3.2;
        c += uAccent * pow(max(dot(d, normalize(vec3(0.72,0.16,-0.68))), 0.0), 10.0) * 0.9;
        return c;
      }
      float D_GGX(float NoH, float a){
        float a2 = a*a, d = NoH*NoH*(a2-1.0)+1.0;
        return a2 / max(3.14159265*d*d, 1e-6);
      }
      float V_Smith(float NoV, float NoL, float a){
        float a2 = a*a;
        float gv = NoL*sqrt(NoV*NoV*(1.0-a2)+a2);
        float gl = NoV*sqrt(NoL*NoL*(1.0-a2)+a2);
        return 0.5 / max(gv+gl, 1e-5);
      }

      void main(){
        // Below the cut is gone. Discard rather than alpha, so the object has
        // holes you can see through to the scene behind rather than a ghost.
        if (vNoise < uCut) discard;
        vec3 n = normalize(vN);
        vec3 v = normalize(cameraPosition - vW);
        if (dot(n, v) < 0.0) n = -n;

        /* Which parts are metal is not a guess: this arm's light parts are
           machined aluminium and its dark parts are moulded plastic, and the
           mesh's own per-part colour is the only thing in the pipeline that
           knows which is which. */
        float lum = dot(uColor, vec3(0.2126, 0.7152, 0.0722));
        float metal = smoothstep(0.16, 0.52, lum);
        // Floored at 0.26 rather than 0.05. A GGX lobe that tight is a mirror,
        // and the highlight it returns is a spike the bloom then turns into a
        // white hole; machined aluminium is not a mirror either.
        float rough = clamp(mix(0.62, 0.30, metal) * uRough, 0.26, 1.0);
        float a = rough * rough;

        /* The key is a card, not a point. A punctual light on a smooth metal
           returns a lobe that peaks near eight and clips to white, and on a
           cylinder that spike sweeps the whole length of the shaft -- which is
           what the arm had become, a white tube with no form in it. Widening
           the lobe for the direct term is the standard stand-in for a source
           with area, and it is also just true: this arm is lit by a softbox in
           the environment function above, not by a star. */
        float aDirect = clamp(rough + 0.30, 0.0, 1.0);
        aDirect *= aDirect;

        vec3 F0 = mix(vec3(0.04), uColor, metal);
        vec3 h = normalize(KEY + v);
        float NoV = max(dot(n, v), 1e-4);
        float NoL = max(dot(n, KEY), 0.0);
        float NoH = max(dot(n, h), 0.0);
        float VoH = max(dot(v, h), 0.0);
        vec3 F = F0 + (1.0 - F0) * pow(1.0 - VoH, 5.0);

        // The key, as a light rather than as a lambert wash.
        // 3.2 was a made-up gain on a term that already peaks in the hundreds
        // for a smooth surface, and with the facets welded away there was
        // nothing left to break it up: the whole arm went to white.
        vec3 direct = (D_GGX(NoH, aDirect) * V_Smith(NoV, NoL, aDirect)) * F * NoL * 2.4;
        // And the room it is standing in.
        vec3 R = reflect(-v, n);
        vec3 Fr = F0 + (max(vec3(1.0 - rough), F0) - F0) * pow(1.0 - NoV, 5.0);
        vec3 ibl = env(R) * Fr;
        vec3 diff = uColor * (1.0 - metal) * env(n) * 1.0;

        // Diffuse comes from the environment along the normal and nowhere
        // else; the extra lambert that used to sit here was the same light
        // counted twice.
        vec3 col = diff + ibl + direct;
        // The burning edge: a narrow band just above the cut, at full accent.
        float edge = 1.0 - smoothstep(uCut, uCut + uEdge, vNoise);
        col = mix(col, uAccent * 2.4, edge * step(0.001, uCut));
        gl_FragColor = vec4(col, 1.0);
      }`
  });
  mat.userData.uniforms = uniforms;
  return mat;
}
