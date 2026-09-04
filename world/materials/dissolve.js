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
      void main(){
        // Below the cut is gone. Discard rather than alpha, so the object has
        // holes you can see through to the scene behind rather than a ghost.
        if (vNoise < uCut) discard;
        vec3 n = normalize(vN);
        vec3 v = normalize(cameraPosition - vW);
        if (dot(n, v) < 0.0) n = -n;
        vec3 key = normalize(vec3(-0.45, 0.72, 0.55));
        float lam = max(dot(n, key), 0.0);
        vec3 amb = mix(vec3(0.045,0.043,0.05), vec3(0.20,0.20,0.23), n.y*0.5+0.5);
        float fres = pow(1.0 - max(dot(n, v), 0.0), 3.2);
        vec3 col = uColor * (amb + lam * 0.85) + uAccent * fres * 0.42;
        // The burning edge: a narrow band just above the cut, at full accent.
        float edge = 1.0 - smoothstep(uCut, uCut + uEdge, vNoise);
        col = mix(col, uAccent * 2.4, edge * step(0.001, uCut));
        gl_FragColor = vec4(col, 1.0);
      }`
  });
  mat.userData.uniforms = uniforms;
  return mat;
}
