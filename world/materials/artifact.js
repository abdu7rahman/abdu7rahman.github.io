/* The material the artifacts are made of.
 *
 * One InstancedMesh per scene rather than one Mesh per object: ten projects,
 * five benchmark bars and a corridor of markers are three draw calls between
 * them instead of thirty. Per-instance state -- how near it is to being the
 * one you are looking at, when it should arrive, its own seed -- rides as
 * instanced attributes, so nothing is rebuilt per frame.
 *
 * The surface is deliberately plain: a fresnel rim, a slow procedural grain
 * that moves with the object rather than with the screen, and an emissive
 * edge that only lights on the active one. These are meant to read as objects
 * in a room, not as a shader showreel.
 */
import * as THREE from "three";
import { SIMPLEX3 } from "./noise.glsl.js";

export function makeArtifactMaterial({ base, accent, teal }) {
  const uniforms = {
    uTime:   { value: 0 },
    uWeight: { value: 0 },       // the scene's own presence, 0..1
    uFocus:  { value: -1 },      // which instance is active, -1 for none
    uCharge: { value: 0 },
    uBase:   { value: new THREE.Color(base) },
    uAccent: { value: new THREE.Color(accent) },
    uTeal:   { value: new THREE.Color(teal) }
  };

  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */`
      ${SIMPLEX3}
      uniform float uTime, uWeight, uFocus, uCharge;
      attribute float aIndex, aSeed, aArrive;
      varying vec3 vN, vW;
      varying float vHot, vGrain, vFade;
      void main(){
        vHot = 1.0 - smoothstep(0.0, 0.9, abs(aIndex - uFocus));
        // Each artifact arrives on its own beat rather than the whole rank
        // appearing at once -- a stagger is what stops a field of objects
        // reading as a single sliding sheet.
        vFade = smoothstep(aArrive, aArrive + 0.28, uWeight);
        vec3 p = position;
        // Breathing, keyed to the instance's own seed so no two are in phase.
        p += normal * sin(uTime * 0.7 + aSeed * 6.28) * 0.004 * (0.4 + vHot);
        p *= mix(0.86, 1.0, vFade) * mix(1.0, 1.09, vHot);
        vec4 world = instanceMatrix * vec4(p, 1.0);
        world = modelMatrix * world;
        vW = world.xyz;
        vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
        vGrain = snoise(position * 3.1 + aSeed * 11.0);
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: /* glsl */`
      uniform float uWeight, uCharge;
      uniform vec3 uBase, uAccent, uTeal;
      varying vec3 vN, vW;
      varying float vHot, vGrain, vFade;
      void main(){
        vec3 n = normalize(vN);
        vec3 v = normalize(cameraPosition - vW);
        if (dot(n, v) < 0.0) n = -n;
        float lam = max(dot(n, normalize(vec3(-0.4, 0.8, 0.45))), 0.0);
        float fres = pow(1.0 - max(dot(n, v), 0.0), 2.6);
        vec3 col = uBase * (0.16 + lam * 0.78);
        col += mix(uTeal, uAccent, vHot) * fres * (0.35 + vHot * 0.9);
        col += vGrain * 0.012;
        float a = vFade * uWeight * (0.52 + vHot * 0.48);
        if (a < 0.004) discard;
        gl_FragColor = vec4(col, a);
      }`
  });
  mat.userData.uniforms = uniforms;
  return mat;
}

/* Per-instance attributes, filled once. */
export function seedInstances(geo, n, arriveOf) {
  const idx = new Float32Array(n), seed = new Float32Array(n), arr = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    idx[i] = i; seed[i] = Math.random();
    arr[i] = arriveOf ? arriveOf(i, n) : (i / Math.max(1, n - 1)) * 0.45;
  }
  geo.setAttribute("aIndex", new THREE.InstancedBufferAttribute(idx, 1));
  geo.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seed, 1));
  geo.setAttribute("aArrive", new THREE.InstancedBufferAttribute(arr, 1));
}
