/* The finish. Four quads: a bright pass, two blurs, and the grade.
 *
 * The building was being lit correctly and photographed flat. Everything that
 * is supposed to be a source in here -- the lamp faces on the high-bay
 * luminaires, the emissive top rail down 66 m of guarding, the seven monitors
 * -- was written into an eight-bit buffer with a tone curve over it and
 * nothing else, so a source and a bright surface came out as the same thing.
 * A source is not a bright surface: it scatters in the lens and in the eye,
 * and that scatter is the only cue that separates them.
 *
 * The order here is bright pass, blur, blur, composite, and the composite
 * does aberration, bloom, contrast, curve, grain, falloff in that order. The
 * two departures from where the optics would put them are the grain and the
 * falloff, and the reasons are written next to them.
 *
 * The one trap this file exists inside: a backtick anywhere in these template
 * literals, including inside a GLSL comment, closes the literal early. What
 * follows usually still parses, so node --check passes and the module quietly
 * becomes something else. tools/check_shaders.py is the gate. There is not a
 * single backtick below and there must never be one.
 */

export const GRADE_VERT = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

/* Bright pass, and the downsample to a quarter in each axis that comes free
   with it.

   Four bilinear taps at plus and minus one source texel from the centre of
   the destination texel. A destination texel here covers four by four source
   texels, and one bilinear tap averages two by two, so four taps offset by a
   texel cover exactly the sixteen and no more -- a single centre tap would
   read four of the sixteen and alias every bright point into a flicker as the
   camera moves.

   The threshold has a knee rather than an edge. max(c - t, 0) is what the
   sibling site's finish does and it is correct when the taps are already
   being paid for, but here the thresholded image is blurred and then added
   back, and a hard threshold on a blurred result puts a visible contour
   exactly on the iso-luminance line where surfaces cross it. The knee is a
   smoothstep over uKnee of headroom below the threshold, so the contour
   becomes a gradient and there is nothing to see. */
export const BRIGHT_FRAG = /* glsl */`
  precision highp float;
  uniform sampler2D tDiffuse;
  uniform vec2 uTexel;
  uniform float uThresh;
  uniform float uKnee;
  varying vec2 vUv;

  void main() {
    vec3 c = texture2D(tDiffuse, vUv + vec2(-uTexel.x, -uTexel.y)).rgb
           + texture2D(tDiffuse, vUv + vec2( uTexel.x, -uTexel.y)).rgb
           + texture2D(tDiffuse, vUv + vec2(-uTexel.x,  uTexel.y)).rgb
           + texture2D(tDiffuse, vUv + vec2( uTexel.x,  uTexel.y)).rgb;
    c *= 0.25;

    // Rec.709 luma, on linear radiance rather than on display values, because
    // this runs before the curve and radiance is what a lens scatters.
    float y = dot(c, vec3(0.2126, 0.7152, 0.0722));
    float w = smoothstep(uThresh - uKnee, uThresh + uKnee, y);
    gl_FragColor = vec4(c * w, 1.0);
  }`;

/* Separable Gaussian, five samples for the reach of nine.

   The weights are the ninth row of Pascal's triangle over 256 --
   1, 8, 28, 56, 70, 56, 28, 8, 1 -- which is the discrete Gaussian nobody has
   to argue about. Taps one and two collapse into one bilinear read at
   (1*8 + 2*28) / (8 + 28) = 1.3333 texels carrying 36/256 = 0.140625, and
   taps three and four into one at (3*1 + 4*0.125) / 1.125... written out in
   the same form, (3*8 + 4*1) / (8 + 1) = 3.1111 texels carrying 9/256 =
   0.03515625. The centre keeps 70/256 = 0.2734375. Doubling the two pairs and
   adding the centre gives 1.0 exactly, so the kernel needs no normalisation
   and cannot drift.

   uStride widens it. At stride 1 on a quarter-resolution buffer the outermost
   tap is 3.11 quarter-texels, which is 12.4 full-resolution pixels, and a
   glow twelve pixels wide around a lamp face read at 1440 by 900 is not a
   glow, it is a slightly soft edge. Stride is the one honest way to widen a
   five-tap kernel without paying for more taps, and it costs sampling density
   -- at stride 3 neighbouring taps are 4 quarter-texels apart, which on a
   buffer that is itself already smoothed by the four-tap downsample above is
   still gap-free. */
export const BLUR_FRAG = /* glsl */`
  precision highp float;
  uniform sampler2D tDiffuse;
  uniform vec2 uTexel;
  uniform vec2 uDir;
  uniform float uStride;
  varying vec2 vUv;

  void main() {
    vec2 s = uTexel * uDir * uStride;
    vec3 c = texture2D(tDiffuse, vUv).rgb * 0.2734375;
    c += texture2D(tDiffuse, vUv + s * 1.3333333).rgb * 0.328125;
    c += texture2D(tDiffuse, vUv - s * 1.3333333).rgb * 0.328125;
    c += texture2D(tDiffuse, vUv + s * 3.1111111).rgb * 0.03515625;
    c += texture2D(tDiffuse, vUv - s * 3.1111111).rgb * 0.03515625;
    gl_FragColor = vec4(c, 1.0);
  }`;

export const GRADE_FRAG = /* glsl */`
  precision highp float;
  uniform sampler2D tDiffuse;
  uniform sampler2D tBloom;
  uniform vec2 uTexel;
  uniform float uTime;
  uniform float uAberr;
  uniform float uBloom;
  uniform float uContrast;
  uniform float uPivot;
  uniform float uExposure;
  uniform float uGrain;
  uniform float uVig;
  varying vec2 vUv;

  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  /* Narkowicz's fit to the ACES curve, and it replaces three's own rather
     than sitting on top of it.

     three applies its tone map in the output stage of every material it
     wrote, and only when it is drawing to the screen -- rendering into a
     target, which is what this pass makes it do, silently turns it off. So
     the exposure that used to live on the renderer had to come here or it
     would have vanished, and the pass material is marked toneMapped false so
     three does not put a second curve on top of this one on the way out.

     Done once over the composited frame is also the only place it can be
     done correctly now: the floor and the costmap reveal are raw
     ShaderMaterials that three never tone mapped at all, so before this pass
     the slab and the steel were on two different curves. */
  vec3 aces(vec3 x){
    return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
  }

  void main() {
    vec2 c = vUv - 0.5;
    // 0 in the middle, 1 in the corner, at any aspect: the largest value
    // dot(c, c) can take on a unit square is 0.5.
    float r2 = clamp(2.0 * dot(c, c), 0.0, 1.0);

    /* Lateral chromatic aberration, which is the one lens defect that belongs
       in this picture.

       The sibling site removed its aberration and left a note saying so, and
       the note is right about the reason: theirs resampled red and blue
       sharply over a green that had already been through a depth-of-field
       disc, so every bright point grew a hard coloured edge around a soft
       core. There is no disc here. All three channels are read from the same
       buffer at the same sharpness and only their radius differs, which is
       what a lens actually does -- it focuses red slightly further out than
       blue and the image scale differs by channel.

       Quadratic in field height and zero at the centre, so it is a property
       of the corner and not a filter over the frame. */
    vec2 off = c * (2.0 * uAberr * r2);
    vec3 col = vec3(
      texture2D(tDiffuse, vUv + off).r,
      texture2D(tDiffuse, vUv).g,
      texture2D(tDiffuse, vUv - off).b
    );

    // The scatter, added in radiance. Additive on a near-black frame is
    // exactly the image this is for, and it is added before the curve so the
    // shoulder has something to roll off rather than being handed a display
    // value that is already at the top of its range.
    col += texture2D(tBloom, vUv).rgb * uBloom;

    /* Contrast about a pivot, in linear, before the curve.

       This is the term the brief is actually about: harder light, not more of
       it. A gain multiplies everything and moves the median, which is the
       definition of brighter. A power about a pivot leaves the pivot exactly
       where it is and pushes everything else away from it, which is the
       definition of harder -- what is above the pivot goes up, what is below
       goes down, and the pivot is chosen to sit on the surface the frame is
       mostly made of so that most of the picture does not move at all. */
    col = max(col, vec3(0.0));
    col = uPivot * pow(col / uPivot, vec3(uContrast));

    col = aces(col * uExposure);

    /* Grain, in front of the falloff rather than behind it, which is not
       where the physics puts it -- on film the emulsion sits behind the lens,
       so the corner should keep its noise while it loses its light.

       Behind it is measurably worse here for a reason specific to a dark
       picture: this frame is mostly near black, the framebuffer clamps at
       zero, and the negative half of a zero-mean grain laid on a black pixel
       is thrown away. What is left is not grain, it is a lift in the floor,
       and the floor is what the reading panel sits on. In front, the corner's
       noise is scaled by the same falloff its light is: wrong about film,
       right about eight bits.

       Per channel, because film grain is three emulsions and one grey wobble
       over the top of everything reads as video noise. Heavier in the
       shadows, which is where it lives on film and where this image mostly
       is. */
    vec2 gp = vUv * vec2(1024.0, 1024.0) + fract(uTime) * 91.7;
    vec3 g = vec3(hash(gp), hash(gp + 17.3), hash(gp + 41.9)) - 0.5;
    float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col += g * uGrain * mix(1.4, 0.5, smoothstep(0.0, 0.5, luma));

    /* The falloff, on this side of the curve on purpose.

       In front of the curve is where the optics put it and it is the wrong
       place: the fit above is concave, so darkening the corner before it
       lands the corner on the steep part of the curve and the curve hands
       most of the light back. Vignetting after the curve takes the display
       value down by the factor it says it does.

       Not an Instagram vignette: full strength everywhere inside r = 0.3 --
       which on a 1440 by 900 frame is a 540 pixel radius, so the whole
       reading panel and the whole aisle are untouched -- and a smoothstep
       rather than a power law, because a smoothstep has zero derivative at
       both ends and leaves no ring. */
    col *= mix(1.0, smoothstep(1.02, 0.30, sqrt(0.5 * r2) * 1.4142), uVig);

    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }`;
