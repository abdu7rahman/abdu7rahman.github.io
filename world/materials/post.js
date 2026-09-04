/* One post pass, doing three things that belong together.
 *
 * Chromatic aberration scaled by distance from centre and by how fast the
 * page is moving, film grain, and a vignette. They share a pass because they
 * share a full-screen read: three passes would mean three reads of the same
 * buffer for no gain.
 *
 * Aberration is tied to scroll velocity rather than left on. Constant, it is
 * a filter over the page and it reads as a cheap trick; only while the world
 * is moving, it reads as the optics being unable to keep up.
 */
import * as THREE from "three";

export const FinishShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime:    { value: 0 },
    uRush:    { value: 0 },     // 0..1, how fast the world is moving
    uGrain:   { value: 0.035 },
    uVig:     { value: 1.0 }
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uTime, uRush, uGrain, uVig;
    varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    void main(){
      vec2 c = vUv - 0.5;
      float r = length(c);
      // Zero at the centre, strongest at the corners: a lens defect, not a
      // colour filter laid over the whole frame.
      float amt = uRush * 0.0042 * r;
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + c * amt).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - c * amt).b;
      float g = hash(vUv * vec2(1024.0, 1024.0) + fract(uTime) * 91.7) - 0.5;
      col += g * uGrain;
      col *= mix(1.0, smoothstep(1.05, 0.28, r), uVig);
      gl_FragColor = vec4(col, 1.0);
    }`
};
