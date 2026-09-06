/* The substrate: one cloud of points that is the whole world.
 *
 * This is the architectural change. Before, each section owned its own
 * geometry and the manager mounted and unmounted them, which is a crossfade
 * however it is dressed -- five things standing in a line that the camera
 * drives past. Nothing could turn into anything else because nothing was
 * shared.
 *
 * Here there is one buffer of points for the entire page, and a section is
 * not a set of objects but a *formation*: a function that says where every
 * point should be, what size, and what it counts as. Scrolling morphs the
 * whole cloud from one formation to the next. The manipulator's swept
 * workspace is the same matter as the occupancy grid that follows it, which
 * is the same matter as the benchmark bars after that.
 *
 * Two target buffers, A and B, and one mix between them. Every formation is
 * baked into its own arrays at boot, so crossing a boundary is a pair of
 * memcpys rather than sixty thousand points recomputed mid-scroll.
 */
import * as THREE from "three";
import { SIMPLEX3 } from "./materials/noise.glsl.js";
import { rng } from "./formations/lib.js";

export function makeSubstrate(count, { accent, teal, fg, stagger, heat }) {
  const aA    = new Float32Array(count * 3);
  const aB    = new Float32Array(count * 3);
  const aSeed = new Float32Array(count);
  const aKA   = new Float32Array(count);   // "kind" in A: 0 structure, 1 path, 2 frame
  const aKB   = new Float32Array(count);
  const aSA   = new Float32Array(count);   // size in A
  const aSB   = new Float32Array(count);
  /* Flow: where along its own feature a point sits, 0 at the start and 1 at
     the end, or -1 for a point that is not part of anything that runs. It is
     the one channel that makes the world a machine rather than a photograph
     of one -- a route with a flow is a route something is driving, a rollout
     with a flow is a rollout being swept, a workspace with a flow is a
     workspace being reached into. Everything else here describes where matter
     is; this describes what it is doing. */
  const aFA   = new Float32Array(count).fill(-1);
  const aFB   = new Float32Array(count).fill(-1);

  // Each point's own beat in the morph. Seeded rather than random: the
  // stagger is part of how a transition looks, and it should look the same
  // on the second visit as on the first.
  const r = rng(0x5eed17);
  for (let i = 0; i < count; i++) aSeed[i] = r();

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geo.setAttribute("aA", new THREE.BufferAttribute(aA, 3));
  geo.setAttribute("aB", new THREE.BufferAttribute(aB, 3));
  geo.setAttribute("aSeed", new THREE.BufferAttribute(aSeed, 1));
  geo.setAttribute("aKA", new THREE.BufferAttribute(aKA, 1));
  geo.setAttribute("aKB", new THREE.BufferAttribute(aKB, 1));
  geo.setAttribute("aSA", new THREE.BufferAttribute(aSA, 1));
  geo.setAttribute("aSB", new THREE.BufferAttribute(aSB, 1));
  geo.setAttribute("aFA", new THREE.BufferAttribute(aFA, 1));
  geo.setAttribute("aFB", new THREE.BufferAttribute(aFB, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, -8), 60);

  const uniforms = {
    uTime:   { value: 0 },
    uMix:    { value: 0 },      // 0 = formation A, 1 = formation B
    uArc:    { value: 0.55 },   // how far points bow off the straight line
    uDpr:    { value: 1 },
    /* sqrt(80000 / count). A tier does not draw a different world, it draws
       the same world out of fewer points -- 12000 at the low tier against
       80000 at the high -- and a point is a fixed size, so the same object
       came out with a seventh of the coverage and a seventh of the light. The
       formations are all written against the high tier's density, so the fix
       belongs here rather than seven times over: fewer samples of the same
       shape are drawn proportionally bigger, and total coverage is what stays
       constant across tiers instead of point count. Square root because
       coverage goes as the square of the radius. */
    uDensity:{ value: 1 },
    /* How far the travelling band has got, in feature-lengths. Advanced by the
       loop rather than derived from uTime here, so a station can run its own
       system at its own rate and stop while it is being dissolved. */
    uRun:    { value: 0 },
    // Width of that band as a share of the feature, and how much it brightens.
    uRunWidth:{ value: 0.16 },
    uRunLift:{ value: 1.5 },
    uCharge: { value: 0 },      // pointer speed
    uFade:   { value: 1 },      // how much of the cloud is wanted right now
    uPointer:{ value: new THREE.Vector3() },
    uAccent: { value: new THREE.Color(accent) },
    uTeal:   { value: new THREE.Color(teal) },
    uFg:     { value: new THREE.Color(fg) }
  };

  // Baked into the source rather than passed as uniforms: they never change
  // after boot, and a constant the compiler can see folds away.
  const STAGGER = (stagger === undefined ? 0.42 : stagger).toFixed(3);
  const HEAT = (heat === undefined ? 1.25 : heat).toFixed(3);

  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`
      ${SIMPLEX3}
      uniform float uTime, uMix, uArc, uDpr, uDensity, uCharge, uFade, uRun, uRunWidth, uRunLift;
      uniform vec3 uPointer;
      attribute vec3 aA, aB;
      attribute float aSeed, aKA, aKB, aSA, aSB, aFA, aFB;
      varying float vKind, vHeat, vAlpha, vRun;
      void main(){
        // Every point crosses on its own beat. A uniform mix slides the whole
        // cloud from one shape to the other like a slide transition; staggering
        // it makes the cloud *reorganise*, which is the difference between a
        // wipe and a transformation.
        float lead = aSeed * ${STAGGER};
        float m = clamp((uMix - lead) / (1.0 - ${STAGGER}), 0.0, 1.0);
        m = m * m * (3.0 - 2.0 * m);

        vec3 p = mix(aA, aB, m);
        // Bowed off the straight line between the two, in a direction that is
        // this point's own, so the cloud swells outward through the change
        // rather than collapsing through its own centre.
        vec3 axis = aB - aA;
        float bow = sin(m * 3.14159);
        vec3 off = vec3(snoise(aA * 0.7 + aSeed * 31.0),
                        snoise(aA * 0.7 + aSeed * 31.0 + 17.3),
                        snoise(aA * 0.7 + aSeed * 31.0 + 41.9));
        p += normalize(off + 1e-5) * bow * uArc * (0.25 + aSeed * 0.9) * min(1.0, length(axis));

        // A slow drift so a settled formation is never completely still.
        p += off * 0.012 * (0.4 + 0.6 * sin(uTime * 0.5 + aSeed * 6.28));

        // The pointer pushes the nearest matter aside, with falloff.
        vec3 toP = p - uPointer;
        float d = length(toP);
        p += normalize(toP + 1e-5) * smoothstep(1.6, 0.0, d) * 0.13 * uCharge;

        vKind = mix(aKA, aKB, m);
        vHeat = bow;

        /* The travelling band.
        
           The first version of this required a flow at both ends of the morph,
           on the grounds that a feature which exists in one formation and not
           the other would otherwise pulse on the way in and stop dead on the
           way out. That reasoning is right about the pop and wrong about the
           gate, and the difference matters because of where a settled reader
           actually sits: the ease is asymptotic, so a station at rest is at
           mix 0.99 of the pair *before* it, not mix 0 of its own. Gated on
           both, a station could therefore only run where its neighbour
           happened to assign flow to the same point indices -- so the
           corridor's LiDAR sweep was silent at the one moment anybody was
           looking at it, for reasons entirely to do with the rollout bundle
           one state earlier.
        
           So the strength ramps with the morph instead of switching on it.
           A point running in only one of the two ends still runs, at the
           weight that end has, which goes to zero exactly where the feature
           does. No pop, and no station's motion depends on what its
           neighbours chose to animate.
        
           Wrapped on the near side only -- fract of a negative is still
           positive in GLSL, but the distance has to be measured the short way
           round or the band tears every time it laps. */
        float hasA = step(0.0, aFA), hasB = step(0.0, aFB);
        float w = mix(hasA, hasB, m);
        vRun = 0.0;
        if (w > 0.001) {
          // Only the ends that have one contribute to where the band is, or a
          // point running at one end would be dragged toward -1 by the other.
          float fl = (aFA * hasA * (1.0 - m) + aFB * hasB * m)
                   / max(1e-4, hasA * (1.0 - m) + hasB * m);
          float d = fract(fl - uRun);
          d = min(d, 1.0 - d);
          vRun = smoothstep(uRunWidth, 0.0, d) * w;
        }
        float sz = mix(aSA, aSB, m);
        // A point the band is over is drawn a little larger as well as a
        // little brighter, which is what keeps it reading as something moving
        // through the matter rather than as the matter changing colour.
        sz *= 1.0 + vRun * 0.55;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float depth = -mv.z;

        // Two things kept the cloud from being an environment and made it a
        // blizzard instead. A point a third of a metre from the eye was being
        // drawn eighty pixels across, so flying through the cloud meant flying
        // through snow; and nothing faded on the way past, so the densest,
        // largest, least legible matter was always the matter directly over
        // the reader's paragraph. Both are near-field problems, and both are
        // fixed in the near field: a hard ceiling on the splat, and a fade
        // that empties the couple of metres the text actually occupies.
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(sz * uDpr * uDensity * (26.0 / max(0.9, depth)), 1.0, 7.0 * uDpr * uDensity);
        vAlpha = smoothstep(0.7, 2.2, depth) * (1.0 - smoothstep(26.0, 44.0, depth));
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uAccent, uTeal, uFg;
      uniform float uFade, uRunLift;
      varying float vKind, vHeat, vAlpha, vRun;
      void main(){
        vec2 d = gl_PointCoord - 0.5;
        float r2 = dot(d, d);
        if (r2 > 0.25) discard;
        float a = smoothstep(0.25, 0.03, r2);
        // Three kinds of matter, and the colour says which: structure is the
        // page's own cream, a planned path is the accent, a coordinate frame
        // is the teal. A point that is between kinds is between colours.
        vec3 col = uFg;
        col = mix(col, uAccent, clamp(vKind, 0.0, 1.0));
        col = mix(col, uTeal, clamp(vKind - 1.0, 0.0, 1.0));
        // Hotter while it is in transit, so a change reads as energetic.
        col *= 0.55 + vHeat * ${HEAT};
        col *= 1.0 + vRun * uRunLift;
        // Exposed for the 21% of it that survives the page's scrim, not for
        // what it would look like on its own. Under-exposing here and then
        // filtering it again is how a world ends up technically running and
        // visually absent.
        // 0.62 rather than the 0.80 this was exposed at when the cloud was the
        // whole world. It is not any more -- the solids carry the settled
        // states -- and at 0.80 a dense formation like the rollout bundle,
        // fifty thousand additive points across two square metres of floor,
        // saturated to a sheet of white with no arcs left in it.
        //
        // Down where a station has solid geometry standing and up through the
        // crossing. The cloud is what a station becomes on the way to the next
        // one; at full strength over a settled solid it is just haze over the
        // thing you are meant to be looking at.
        gl_FragColor = vec4(col, a * vAlpha * uFade * 0.62);
      }`
  });

  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 10;

  /* Every formation is baked once, into its own arrays. A boundary crossing
     is then two memcpys rather than a pass over sixty thousand points in the
     middle of a scroll, which is the difference between a transition and a
     hitch.

     Baked on demand rather than all at boot. Five formations at 60k is a few
     hundred milliseconds of one thread, and spending it before the first
     frame is spending it exactly where a stutter is most visible -- while the
     page is still arriving. The two the reader can see are baked immediately;
     the rest are done a formation per idle frame, which finishes long before
     anyone has scrolled far enough to need the third. */
  let source = [];
  let baked = [];
  let spanAt = -1;

  const dirty = ["aA", "aB", "aKA", "aKB", "aSA", "aSB", "aFA", "aFB"];

  function ensure(i) {
    if (i < 0 || i >= source.length || baked[i]) return false;
    const p = new Float32Array(count * 3);
    const k = new Float32Array(count);
    const z = new Float32Array(count);
    const f = new Float32Array(count).fill(-1);
    source[i](p, k, z, count, f);
    baked[i] = { p, k, s: z, f };
    return true;
  }

  return {
    points, count, uniforms,

    bake(fills) { source = fills; baked = new Array(fills.length); },

    /* One formation per call, in order, for the loop to spend a spare frame
       on. Returns false once there is nothing left to do. */
    bakeNext() {
      for (let i = 0; i < source.length; i++) if (ensure(i)) return true;
      return false;
    },

    /* A holds formation i and B holds formation i+1, whichever direction the
       reader arrived from. Scrolling back up is not a special case: the same
       two formations are loaded and uMix simply runs the other way, so the
       page reverses exactly rather than re-deciding what it is. */
    span(i) {
      if (i === spanAt || source.length === 0) return;
      const ia = Math.max(0, Math.min(source.length - 1, i));
      const ib = Math.max(0, Math.min(source.length - 1, i + 1));
      ensure(ia); ensure(ib);
      const a = baked[ia], b = baked[ib];
      aA.set(a.p); aKA.set(a.k); aSA.set(a.s); aFA.set(a.f);
      aB.set(b.p); aKB.set(b.k); aSB.set(b.s); aFB.set(b.f);
      for (const k of dirty) geo.getAttribute(k).needsUpdate = true;
      spanAt = i;
    },

    get at() { return spanAt; },

    dispose() { source = []; baked = []; geo.dispose(); mat.dispose(); }
  };
}
