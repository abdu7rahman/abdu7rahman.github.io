/* The finish. One pass, because everything in it wants the same reads.
 *
 * The world was being drawn correctly and photographed badly. Every surface
 * was equally sharp, which is the one thing that never happens through a
 * lens, and the eye had nothing to tell it what it was supposed to be looking
 * at. Fog gives distance; only focus gives attention.
 *
 * So the pass now takes a disc of samples around each pixel and spends it
 * twice:
 *
 *   - as depth of field, weighting the disc by a circle of confusion built
 *     from the depth buffer against the distance the camera is actually
 *     pointed at. Near and far both go soft; the plane the rig is looking at
 *     stays sharp.
 *   - as bloom, taking the same taps, keeping what is above a threshold, and
 *     adding it back. Additive points on near-black is exactly the image that
 *     wants it, and it costs nothing extra because the taps are already read.
 *
 * Then chromatic aberration tied to scroll velocity, film grain, and a
 * vignette. Aberration is not left on: constant, it is a filter over the page
 * and reads as a cheap trick; only while the world is moving, it reads as the
 * optics failing to keep up.
 */
import * as THREE from "three";

export const FinishShader = {
  uniforms: {
    tDiffuse: { value: null },
    tDepth:   { value: null },
    uTime:    { value: 0 },
    uRush:    { value: 0 },      // 0..1, how fast the world is moving
    uGrain:   { value: 0.05 },
    uVig:     { value: 1.0 },
    uNear:    { value: 0.1 },
    uFar:     { value: 140 },
    uFocus:   { value: 3 },      // metres; whatever the rig is pointed at
    uAperture:{ value: 1.15 },   // how fast it falls out of focus
    uMaxCoC:  { value: 0.011 },  // ceiling on the blur, in UV
    uBloom:   { value: 0.22 },
    uThresh:  { value: 0.78 },
    // Under one, because the world is lit in radiance now and the shoulder
    // has to have something to roll off. At 1.05 everything metal sat on the
    // flat part of the curve.
    uExposure:{ value: 0.62 },
    uTexel:   { value: new THREE.Vector2(1 / 1280, 1 / 720) }
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse, tDepth;
    uniform float uTime, uRush, uGrain, uVig;
    uniform float uNear, uFar, uFocus, uAperture, uMaxCoC, uBloom, uThresh, uExposure;
    uniform vec2 uTexel;
    varying vec2 vUv;

    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

    /* Narkowicz's fit to the ACES curve.
    
       The world is lit with a real BRDF now, and a specular lobe on a smooth
       surface peaks in the tens -- that is not a bug, it is what a highlight
       is. Written straight into an eight-bit buffer it clips, and a clipped
       highlight on a curved shaft is a flat white shape with no edge, which
       is what the arm had become: correct radiance, photographed on a sensor
       with no shoulder. Tone mapping is the shoulder. It is done here, once,
       over the composited frame, rather than per material -- three only
       applies its own to the materials it wrote, and none of these are. */
    vec3 aces(vec3 x){
      return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
    }

    /* The depth buffer is non-linear and the circle of confusion is a
       statement about metres, so it has to come back to view space before it
       can be compared with anything. */
    float viewZ(vec2 uv){
      float d = texture2D(tDepth, uv).x;
      return (2.0 * uNear * uFar) / (uFar + uNear - (d * 2.0 - 1.0) * (uFar - uNear));
    }

    // Sixteen points on a spiral rather than a ring: a ring of taps produces a
    // visible halo at every radius, and a spiral does not repeat.
    const int TAPS = 16;

    void main(){
      vec2 c = vUv - 0.5;
      float r = length(c);

      float z = viewZ(vUv);
      // Relative, not absolute: a centimetre matters at half a metre and does
      // not at twenty, which is what a real lens does too.
      float coc = clamp(abs(z - uFocus) / max(z, 0.05) * uAperture, 0.0, 1.0) * uMaxCoC;

      vec3 sum = texture2D(tDiffuse, vUv).rgb;
      vec3 glow = vec3(0.0);
      float w = 1.0;
      float ang = hash(vUv * 311.0) * 6.2831853;
      for (int i = 0; i < TAPS; i++) {
        float f = (float(i) + 0.5) / float(TAPS);
        float a = ang + f * 6.2831853 * 4.0;          // four turns of the spiral
        vec2 off = vec2(cos(a), sin(a)) * sqrt(f);
        vec3 s = texture2D(tDiffuse, vUv + off * coc).rgb;
        sum += s; w += 1.0;
        // The same taps, kept only where they are bright. A wide read of the
        // bright parts is what bloom is; having already paid for the read,
        // this is the cheapest correct version of it available.
        glow += max(s - uThresh, 0.0);
      }
      vec3 col = sum / w;
      col += glow / float(TAPS) * uBloom;

      /* The chromatic aberration that used to live here is gone. It resampled
         tDiffuse for red and blue and mixed the result over a green that had
         already been through the depth-of-field disc, so every bright point
         got a sharp red and blue edge around a soft green core -- magenta and
         green fringes on every LiDAR return, at rest, with the velocity term
         at zero. Doing it correctly means blurring three times, which is
         three times the read for a lens defect nobody asked to see. The
         velocity is spent on grain instead.  */

      col = aces(col * uExposure);

      // Per-channel, because film grain is three emulsions and one grey
      // wobble over the top of everything reads as video noise.
      vec2 gp = vUv * vec2(1024.0, 1024.0) + fract(uTime) * 91.7;
      vec3 g = vec3(hash(gp), hash(gp + 17.3), hash(gp + 41.9)) - 0.5;
      // Heavier in the shadows, which is where it lives on film and where
      // this image mostly is.
      float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
      // More of it while the world is moving: film pushed a stop is grainier,
      // and it is the one place the velocity still shows in the finish.
      col += g * uGrain * (1.0 + uRush * 0.8) * mix(1.4, 0.5, smoothstep(0.0, 0.5, luma));

      col *= mix(1.0, smoothstep(1.05, 0.28, r), uVig);
      gl_FragColor = vec4(col, 1.0);
    }`
};
