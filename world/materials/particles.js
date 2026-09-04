/* What the dissolved surface turns into.
 *
 * Each point carries the position it was seeded from, the position it is
 * eventually pulled to, and -- the part that matters -- the same noise value
 * the dissolve material thresholds. Feed both the same uCut and a point is
 * released on exactly the frame the surface under it is cut away. Without
 * that shared field you get two effects happening near each other; with it,
 * the object becomes the particles.
 *
 * All of it runs on the GPU from static attributes. No per-frame CPU work and
 * no per-particle objects, so the count is a quality dial rather than a
 * rewrite.
 */
import * as THREE from "three";
import { SIMPLEX3 } from "./noise.glsl.js";
import { TRANSITION } from "../config.js";

export function makeParticles(count, { accent, teal }) {
  const seed = new Float32Array(count * 3);
  const goal = new Float32Array(count * 3);
  const rnd  = new Float32Array(count * 3);
  const size = new Float32Array(count);

  const uniforms = {
    uTime:   { value: 0 },
    uCut:    { value: 0 },
    uGather: { value: 0 },        // 0 = scattered, 1 = arrived at goal
    uScale:  { value: 2.6 },      // must match the dissolve's noise scale
    uScatter:{ value: TRANSITION.scatter },
    uSwirl:  { value: TRANSITION.swirl },
    uAccent: { value: new THREE.Color(accent) },
    uTeal:   { value: new THREE.Color(teal) },
    uDpr:    { value: 1 }
  };

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 3));
  geo.setAttribute("aGoal", new THREE.BufferAttribute(goal, 3));
  geo.setAttribute("aRnd",  new THREE.BufferAttribute(rnd, 3));
  geo.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 40);

  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`
      ${SIMPLEX3}
      uniform float uTime, uCut, uGather, uScale, uScatter, uSwirl, uDpr;
      attribute vec3 aSeed, aGoal, aRnd;
      attribute float aSize;
      varying float vLife, vMix;
      void main(){
        float n = fbm(aSeed * uScale + vec3(0.0, 0.0, uTime * 0.08)) * 0.5 + 0.5;
        // Released exactly when the surface it came from is cut away.
        float freed = smoothstep(n, n + 0.10, uCut);
        vLife = freed;
        vec3 p = aSeed;
        // Curl-ish drift: the gradient of a noise field, so the cloud turns
        // rather than expanding radially -- radial reads as an explosion and
        // this is meant to read as a dispersal.
        vec3 q = aSeed * 1.7 + uTime * 0.11;
        vec3 curl = vec3(
          snoise(q + vec3(0.0, 1.7, 4.2)),
          snoise(q + vec3(3.1, 0.0, 1.3)),
          snoise(q + vec3(5.4, 2.6, 0.0)));
        p += curl * uSwirl * freed * (0.4 + aRnd.x * 0.9);
        p += aRnd * uScatter * freed * 0.35;
        // Then pulled in. uGather is the next scene taking ownership of them.
        vec3 landed = mix(p, aGoal + curl * 0.06, uGather * uGather);
        vMix = uGather;
        vec4 mv = modelViewMatrix * vec4(landed, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = aSize * uDpr * (28.0 / max(0.3, -mv.z)) * (0.5 + freed * 0.9);
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uAccent, uTeal;
      varying float vLife, vMix;
      void main(){
        // Round, soft-edged, no texture fetch.
        vec2 d = gl_PointCoord - 0.5;
        float r = dot(d, d);
        if (r > 0.25) discard;
        float a = smoothstep(0.25, 0.02, r);
        if (vLife <= 0.001) discard;
        vec3 col = mix(uAccent, uTeal, vMix * 0.8);
        // Brightest at the moment of release, cooling as they travel.
        float heat = smoothstep(0.0, 0.25, vLife) * (1.0 - vMix * 0.45);
        gl_FragColor = vec4(col * (0.55 + heat * 1.7), a * vLife * 0.85);
      }`
  });

  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.userData.uniforms = uniforms;

  /* Seed from a mesh's actual surface, so the cloud has the object's shape
     before it has anything else. */
  points.userData.seedFrom = function (sourceGeo, targetGeo) {
    const pos = sourceGeo.getAttribute("position");
    const tgt = targetGeo ? targetGeo.getAttribute("position") : null;
    for (let i = 0; i < count; i++) {
      const s = (Math.random() * pos.count) | 0;
      seed[i*3] = pos.getX(s); seed[i*3+1] = pos.getY(s); seed[i*3+2] = pos.getZ(s);
      if (tgt) {
        const t = (Math.random() * tgt.count) | 0;
        goal[i*3] = tgt.getX(t); goal[i*3+1] = tgt.getY(t); goal[i*3+2] = tgt.getZ(t);
      } else {
        goal[i*3] = seed[i*3]; goal[i*3+1] = seed[i*3+1]; goal[i*3+2] = seed[i*3+2];
      }
      rnd[i*3] = Math.random()*2-1; rnd[i*3+1] = Math.random()*2-1; rnd[i*3+2] = Math.random()*2-1;
      size[i] = 0.7 + Math.random() * 1.8;
    }
    geo.getAttribute("aSeed").needsUpdate = true;
    geo.getAttribute("aGoal").needsUpdate = true;
    geo.getAttribute("aRnd").needsUpdate = true;
    geo.getAttribute("aSize").needsUpdate = true;
  };

  points.userData.dispose = function () { geo.dispose(); mat.dispose(); };
  return points;
}
