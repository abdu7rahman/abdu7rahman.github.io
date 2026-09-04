/* The weather, moved inside the world.
 *
 * This is field.js's shader -- domain-warped fbm, lit warm against near-black,
 * weighted to the side the robot is on -- rendered as the world's background
 * instead of as a second WebGL canvas underneath it. Two contexts meant two
 * clears, two loops, and the fog compositing over the scene rather than behind
 * it; one means the fog is in the frame the post chain grades, which is where
 * atmosphere belongs.
 *
 * Drawn as a full-screen quad at the far plane with no depth write, so it
 * costs one draw call and never occludes anything.
 */
import * as THREE from "three";
import { SIMPLEX3 } from "./noise.glsl.js";

export function makeAtmosphere({ accent }) {
  const uniforms = {
    uTime:   { value: 0 },
    uRes:    { value: new THREE.Vector2(1, 1) },
    uScroll: { value: 0 },
    uMouse:  { value: new THREE.Vector2(0.5, 0.5) },
    uGlow:   { value: 0 },
    uRush:   { value: 0 },
    uEmber:  { value: new THREE.Color(accent) }
  };

  const mat = new THREE.ShaderMaterial({
    uniforms,
    depthTest: false, depthWrite: false,
    vertexShader: /* glsl */`
      varying vec2 vUv;
      void main(){ vUv = uv; gl_Position = vec4(position.xy, 1.0, 1.0); }`,
    fragmentShader: /* glsl */`
      ${SIMPLEX3}
      uniform float uTime, uScroll, uGlow, uRush;
      uniform vec2 uRes, uMouse;
      uniform vec3 uEmber;
      varying vec2 vUv;
      void main(){
        vec2 uv = vUv;
        float asp = uRes.x / max(1.0, uRes.y);
        vec2 p = uv * vec2(asp, 1.0) * 1.6;
        p.y += uScroll * 0.45;
        float t = uTime * 0.015;
        // The pointer stirs it, mostly tangentially: a purely radial push comes
        // out as a starburst, curling it reads as smoke moving aside.
        vec2 md = (uv - uMouse) * vec2(asp, 1.0);
        float mdl = length(md);
        vec2 dir = normalize(md + 1e-6);
        p += (vec2(-dir.y, dir.x) * 0.85 + dir * 0.20)
             * smoothstep(0.55, 0.0, mdl) * 0.11 * uGlow;
        // Two rounds of warping: one reads as cloud, two reads as smoke.
        vec2 q = vec2(fbm(vec3(p, t)), fbm(vec3(p + 5.2, 1.3 - t)));
        vec2 r = vec2(fbm(vec3(p + 3.0 * q + vec2(1.7, 9.2), t * 0.6)),
                      fbm(vec3(p + 3.0 * q + vec2(8.3, 2.8), -t * 0.4)));
        // Smeared along the direction of travel while the page is moving.
        vec2 pf = p; pf.y = (pf.y - uScroll * 0.45) * (1.0 - 0.45 * uRush) + uScroll * 0.45;
        float f = fbm(vec3(pf + 2.6 * r, t));
        float side = smoothstep(0.20, 0.92, uv.x);
        f = smoothstep(0.30, 0.98, f);
        vec3 base = vec3(0.039);
        vec3 smoke = vec3(0.62, 0.60, 0.58);
        float d = f * (0.16 + 0.84 * side);
        vec3 col = base + smoke * d * 0.085 + uEmber * d * 0.11;
        col += uEmber * pow(smoothstep(0.62, 1.0, length(r)), 2.0) * 0.03 * side;
        float pool = smoothstep(0.46, 0.0, mdl) * uGlow;
        col += uEmber * pool * pool * (0.16 + 0.5 * f) * 0.26;
        float vig = smoothstep(1.10, 0.18, length(uv - 0.5));
        col *= mix(0.45, 1.0, vig);
        gl_FragColor = vec4(col, 1.0);
      }`
  });

  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  mesh.userData.uniforms = uniforms;
  mesh.userData.dispose = () => { mesh.geometry.dispose(); mat.dispose(); };
  return mesh;
}
