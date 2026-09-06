/* The finish. One pass, because everything in it wants the same reads.
 *
 * The world was being drawn correctly and photographed badly. Every surface
 * was equally sharp, which is the one thing that never happens through a
 * lens, and the eye had nothing to tell it what it was supposed to be looking
 * at. Fog gives distance; only focus gives attention.
 *
 * So the pass takes a disc of samples around each pixel and spends it three
 * times, for the price of one:
 *
 *   - as depth of field, weighting the disc by a circle of confusion built
 *     from the depth buffer against the distance the camera is actually
 *     pointed at. Near and far both go soft; the plane the rig is looking at
 *     stays sharp.
 *   - as motion blur, by sliding that same disc along the direction the frame
 *     is travelling in. A read taken from a point on a line costs exactly
 *     what a read taken from a point on a circle costs, so the second effect
 *     is seventeen texture fetches cheaper than the second pass it would
 *     otherwise be. Below a velocity gate the line has zero length and every
 *     tap collapses back onto the disc, so a reader who stops scrolling gets
 *     a sharp frame and not a decaying tail of a smeared one.
 *   - as bloom, taking the same taps, keeping what is above a threshold, and
 *     adding it back. Additive points on near-black is exactly the image that
 *     wants it, and it costs nothing extra because the taps are already read.
 *
 * Then the tone curve, the grain, and the falloff, in that order. It is not
 * the order light meets them in -- a lens loses its corner long before any
 * emulsion sees the frame -- and both departures are deliberate and both were
 * measured. The reasons are with the two lines.
 *
 * Chromatic aberration used to sit between the disc and the curve and is not
 * coming back. The reason is kept next to the code that replaced it, because
 * it is the kind of thing somebody re-adds every eighteen months.
 */
import * as THREE from "three";

export const FinishShader = {
  uniforms: {
    tDiffuse: { value: null },
    tDepth:   { value: null },
    uTime:    { value: 0 },
    uRush:    { value: 0 },      // 0..1, how fast the world is moving
    /* Where the picture is going, in UV, over one 60Hz frame: world.js
       projects a static point at the focus distance through last frame's
       view-projection and this frame's and hands over the difference,
       renormalised to a 60Hz step so a 144Hz panel is not given a quarter of
       the streak. Nothing in a colour buffer and a depth buffer knows what a
       camera did between two frames, so this cannot be derived here and is
       not faked here. Zero is a legal value and is what an unwired world
       sends; the derived radial term in the motion block below covers that
       case on its own, less well, and says so. */
    uMotion:  { value: new THREE.Vector2(0, 0) },
    /* The longest streak this pass will ever draw, in UV: 40 pixels across a
       1916 frame. Physics says it should be about three times that and
       sixteen taps say it should not; the arithmetic for both is below. The
       derived dolly term is held to 0.6 of it. */
    uStreak:  { value: 0.021 },
    /* How much of the maximum blur the corner carries even when it is dead in
       focus: the sharpness half of the lens falloff, next to the brightness
       half the vignette already does. */
    uField:   { value: 0.35 },
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
    uniform float uStreak, uField;
    uniform vec2 uMotion, uTexel;
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

    /* A 180-degree shutter -- the blade open for half of each frame -- which
       is the number the entire grammar of screen motion was built on, and the
       only one a reader has been trained by. uMotion is a whole frame's
       travel, so half of it is the streak. */
    const float SHUTTER = 0.5;

    void main(){
      vec2 c = vUv - 0.5;
      float r = length(c);

      float z = viewZ(vUv);
      // Relative, not absolute: a centimetre matters at half a metre and does
      // not at twenty, which is what a real lens does too.
      float coc = clamp(abs(z - uFocus) / max(z, 0.05) * uAperture, 0.0, 1.0) * uMaxCoC;

      /* The other half of the falloff. A vignette says the corner of a frame
         gets less light; it does, and it also gets less resolution, because
         no lens ever built is as sharp off axis as it is on it. Written as a
         floor under the circle of confusion rather than as a second blur, so
         it is three instructions and no extra reads, and capped at the
         ceiling the disc already had, so the widest bokeh on the page is
         still exactly as wide as it was.

         r runs 0 at the centre to 0.7071 at the corner, so 2r^2 is 0 to 1
         across the frame's own diagonal at any aspect. At 0.35 the corner
         carries 0.0039 in UV, which on the 1916x953 frame this was measured
         at is a seven-pixel radius across and three and a half down -- the
         disc has always been that ellipse, because the offsets are in UV and
         the frame is not square, and the corner term inherits it rather than
         arguing with it. It takes light out of the corner rather than putting
         it back, which is the only direction anything in this file is allowed
         to move: seven settled stations measured 0.12% to 2.35% of the render
         half above 140, and that number has been fought down twice. */
      coc = min(coc + uMaxCoC * uField * min(1.0, 2.0 * r * r), uMaxCoC);

      /* Motion blur, with no velocity buffer to build it from, out of two
         terms that cover each other's blind spot.

         The measured one is uMotion: how far a static point at the focus
         distance slides across the frame in one 60Hz frame, worked out in
         world.js by projecting the same world point through last frame's
         view-projection and this one's. That is the honest quantity, and it
         is the only one that is zero exactly when the eye is. It is also
         blind to precisely one motion -- driving straight down the corridor
         moves nothing at the centre of the frame, because the point the probe
         sits on is the point a dolly leaves alone -- and this world does that
         for real: Path to Contact moves the eye 7.15 metres, 7.14 of them
         straight down the corridor the camera is pointed along.

         So the second term is the dolly, derived here from nothing but where
         the pixel sits: a streak radially out of the centre, zero in the
         middle and longest in the corner, which is what a frame does when the
         camera drives into it. c * 1.4142 is that direction at unit length in
         the corner. It fades out as uMotion grows, because a guess about
         direction has no business arguing with a measurement of one, and it
         is capped at 0.6 of the ceiling for the same reason -- a guess gets
         less rope. It is also what runs before world.js has wired anything,
         which is deliberate: a finish pass that does nothing until a second
         file changes is a finish pass nobody can see the cost or the benefit
         of.

         uRush gates both, and that is the only job scroll velocity is fit
         for. It is not camera speed: the rig's stitch puts the same key at
         both ends of a state's own reading span, so wheeling to the bottom of
         Measured travels 1925 pixels of panel and 0.07 metres of eye, and in
         the short states one notch of wheel is the whole state -- Contact has
         120 pixels of slack -- which pins uRush at 1.0 with the camera
         standing still. The derived term therefore does fire while somebody
         is reading, and the honest description of that is a cost rather than
         a feature. It is bounded on purpose: 0.6 of the ceiling is 0.0126 in
         UV, which along the diagonal is 17 pixels across and 8 down on a
         1916x953 frame -- a 19-pixel streak in the corner and exactly nothing
         in the middle, out in the field where the falloff below has already
         taken the picture to 0.28 while the page is moving. The measured
         term, once wired, has no such problem and takes over as soon as there
         is anything to take over with.

         The gate itself is what makes a still frame still. Multiplied by
         smoothstep(0.05, 0.40, uRush) the streak is identically zero once the
         page is settled, whatever uMotion says: every tap falls back onto the
         disc it came from, a reader who stops gets no motion blur rather than
         a long tail of it, and a uniform somebody wires up wrong cannot smear
         a page nobody is scrolling.
         0.05 is not an arbitrary floor: a state is called arrived when the
         eased scroll is within 0.0012 of its target, and at that gap a 60Hz
         frame closes 0.12 of the remainder, which is 0.0086 in progress per
         second and 0.047 of uRush. A frame the page calls arrived is already
         under the gate. */
      float move = smoothstep(0.05, 0.40, uRush);
      float lean = smoothstep(3.0e-4, 3.0e-3, length(uMotion));
      vec2 streak = (uMotion * SHUTTER
                     + c * (1.4142 * 0.6 * uStreak * (1.0 - lean))) * move;
      /* And a ceiling, set by the tap budget rather than by the optics. The
         camera really does move about half a metre in the first 60Hz frame of
         a crossing -- About to Work is 4.20 metres of eye over one seventh of
         the journey, and the ease closes 0.12 of the remaining gap per frame
         -- which at three metres through a 45-degree lens is 0.14 in UV, so a
         truthful 180-degree shutter wants 0.07 of streak. Sixteen taps cannot
         carry 0.07. Rendered at 0.07 to find out what it costs, the arm's
         wrist comes out as a row of separate copies of itself rather than as
         a smear: not motion blur, a strobe. 0.021 is 40 pixels across a 1916
         frame and 20 down a 953 one, 2.5 pixels between neighbouring taps at
         the widest, and rendered at that the same wrist is continuous. So the
         fast third of a crossing is deliberately under-blurred by about three
         times, which is the right way round to be wrong: too little motion
         blur reads as a slightly crisp camera and too much reads as a broken
         one. */
      streak *= min(1.0, uStreak / max(length(streak), 1e-6));

      vec3 sum = texture2D(tDiffuse, vUv).rgb;
      vec3 glow = vec3(0.0);
      float w = 1.0;
      float ang = hash(vUv * 311.0) * 6.2831853;
      for (int i = 0; i < TAPS; i++) {
        float f = (float(i) + 0.5) / float(TAPS);
        float a = ang + f * 6.2831853 * 4.0;          // four turns of the spiral
        /* The disc, slid along the streak. fract(f * 7.0) is the same sixteen
           sixteenths f already is, dealt in a different order -- 7 is coprime
           with 16, so it is a permutation of the strata and not a resampling
           of them, and every position on the line is still visited exactly
           once. The reordering is the whole point: spent as f - 0.5 the
           widest taps of the disc would all pile up at one end of the line
           and a bright point would come out as a comet, thin at one end and
           fat at the other, instead of as a streak. */
        vec2 off = vec2(cos(a), sin(a)) * sqrt(f) * coc
                 + streak * (fract(f * 7.0) - 0.5);
        vec3 s = texture2D(tDiffuse, vUv + off).rgb;
        sum += s; w += 1.0;
        // The same taps, kept only where they are bright. A wide read of the
        // bright parts is what bloom is; having already paid for the read,
        // this is the cheapest correct version of it available. It inherits
        // the streak for free, which is also correct: a highlight that moves
        // during the exposure blooms along the way it went, and spreading the
        // same energy down a line lowers its peak rather than raising it.
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
         velocity is spent on the streak and on grain instead.  */

      col = aces(col * uExposure);

      /* Grain, and it stays in front of the falloff, which is not where the
         physics puts it. On film the emulsion is behind the lens, so the
         corner should keep its noise while it loses its light. Moved there,
         it measurably costs: the frame is mostly black, the framebuffer
         clamps at zero, and half of a zero-mean grain laid on a black pixel
         is not a grain at all, it is a lift. Measured over the render half at
         the seven settled stations, grain behind the falloff took the mean
         luma from 19.00 to 19.31 and the fraction above 140 from 0.96% to
         1.01%, with Contact going 0.16% to 0.41% on its own. Rectified noise
         on black is the most expensive kind of correctness on offer here and
         this page cannot buy it. Left in front, the corner's grain is scaled
         by the same 0.42 the picture is: wrong about film, right about eight
         bits and about the gate. */
      vec2 gp = vUv * vec2(1024.0, 1024.0) + fract(uTime) * 91.7;
      // Per-channel, because film grain is three emulsions and one grey
      // wobble over the top of everything reads as video noise.
      vec3 g = vec3(hash(gp), hash(gp + 17.3), hash(gp + 41.9)) - 0.5;
      // Heavier in the shadows, which is where it lives on film and where
      // this image mostly is.
      float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
      // More of it while the world is moving: film pushed a stop is grainier,
      // and it is the one place the velocity still shows in the finish.
      col += g * uGrain * (1.0 + uRush * 0.8) * mix(1.4, 0.5, smoothstep(0.0, 0.5, luma));

      /* The falloff, and it stays on this side of the curve on purpose.
         In front of it is where the optics put it -- a lens loses the corner
         at the aperture, long before anything has a response curve -- and in
         front of it is measurably the wrong place here. The fit above sends a
         radiance of 4.0 out at 0.973, and 0.973 * 0.42 in the corner is
         0.409; vignetted first, 4.0 * 0.42 = 1.68 goes through the same fit
         and comes out at 0.893. Optically correct, and it hands the corner
         back 2.2 times the light. The corner is where the type is, there is a
         gate on this page that bounds what a live render may put behind a
         word, and doubling the corner is the one change this pass is not
         allowed to make.

         0.28 is unchanged and this is not an Instagram vignette: full
         strength everywhere inside r = 0.28, 0.80 at the middle of an edge,
         0.42 in the corner, and no visible ring anywhere, because a smoothstep
         has zero derivative at both ends and a power law does not.

         What is new is that the outer edge walks in while the page is
         travelling. 1.05 settled against 0.92 at full rush: the middle of the
         frame does not move at all -- inside r = 0.28 both curves are exactly
         1.0 -- the middle of an edge goes 0.803 to 0.727, and the corner goes
         0.418 to 0.258. A frame that shuts down around its subject on a move
         is an old device, but here it is also the only term in this file aimed
         at the page's actual worst number. Settled stations measure 0.12% to
         2.35% of the render half above 140; the six mid-crossing frames the
         journey harness stops for average 3.15%, and the one arriving at
         About reaches 10.77% -- three times and eleven times the settled
         figure. The frame is at its brightest exactly when the eye
         has the least chance of reading it. Driven by uRush rather
         than by uMotion, unlike the streak, and on purpose: this is not a
         claim about optics that can be caught out when the scroll moves and
         the camera does not, it is a response to the reader moving -- which is
         what has driven the grain above since the grain was written. */
      col *= mix(1.0, smoothstep(mix(1.05, 0.92, move), 0.28, r), uVig);

      gl_FragColor = vec4(col, 1.0);
    }`
};
