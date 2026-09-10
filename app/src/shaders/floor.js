/* The slab, and everything painted on it.
 *
 * A shader rather than a texture, for one reason that matters at this scale:
 * the aisle runs 66 m and the camera stands 1.6 m off the floor, so a lane
 * line is four pixels wide near the eye and a fifth of a pixel at the far
 * end. A bitmap solves that with mipmaps, which is exactly the wrong answer --
 * it dissolves the line into grey haze precisely where the vanishing point is
 * doing the work. Drawn analytically and antialiased against the screen-space
 * derivative, the line stays a line all the way out and simply gets thinner,
 * which is what paint does.
 *
 * Everything on it is real floor marking. Lane edges down both sides of the
 * aisle, a dashed centre line, hazard chevrons across each bay mouth, a
 * keep-clear box under every column, and the structural grid scribed faintly
 * where a slab is actually poured in bays.
 */
export const FLOOR_VERT = /* glsl */`
  varying vec3 vW;
  varying vec3 vN;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    vN = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

export const FLOOR_FRAG = /* glsl */`
  precision highp float;
  varying vec3 vW;
  varying vec3 vN;

  uniform vec3  uFloor, uLit, uHazard, uAir;
  uniform vec3  uKey;
  uniform float uPitch, uAisle, uFogNear, uFogFar, uTime;
  uniform vec3  uEye;

  // Value noise, two octaves. The slab is poured concrete: it wants a large
  // mottle from the pour and a fine one from the trowel, and nothing else.
  float hash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1,0)), f.x),
               mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y);
  }

  // One line, antialiased in screen space: d is the distance to the line's
  // centre in metres and w its half width, and fwidth turns that into pixels
  // without anybody having to know how far away the floor is.
  float paint(float d, float w) {
    float aa = fwidth(d) * 0.9 + 1e-5;
    return 1.0 - smoothstep(w - aa, w + aa, d);
  }

  void main() {
    vec2 p = vW.xz;

    // --- the slab itself -------------------------------------------------
    float grain = vnoise(p * 1.7) * 0.55 + vnoise(p * 11.0) * 0.28 + vnoise(p * 47.0) * 0.17;
    vec3 col = mix(uFloor, uLit, grain * 0.42);

    // Pour joints on the structural grid. Scribed, not painted: a dark line
    // with a lighter arris either side, which is what a saw cut looks like.
    vec2 g = abs(fract(p / uPitch + 0.5) - 0.5) * uPitch;
    float joint = max(paint(g.x, 0.012), paint(g.y, 0.012));
    col = mix(col, uFloor * 0.45, joint * 0.8);

    // --- the lane ---------------------------------------------------------
    // Not named half: that is a reserved word in GLSL ES and the shader will
    // not compile with it, which costs the entire floor rather than one line.
    float lanes = uAisle * 0.5;
    float edge = max(paint(abs(abs(p.x) - lanes), 0.055), 0.0);
    // Dashed centre line, 1.2 m on 0.8 m off.
    float dash = step(0.6, fract(p.y / 2.0));
    float centre = paint(abs(p.x), 0.035) * dash;
    float lane = max(edge, centre);

    // Hazard chevrons in the strip just outside each lane edge, which is
    // where a bay mouth opens. 45 degrees, 0.42 m pitch, and they only exist
    // in a 0.9 m band so the rest of the floor stays swept.
    float band = step(lanes + 0.06, abs(p.x)) * step(abs(p.x), lanes + 0.95);
    float ch = fract((abs(p.x) + p.y) / 0.42);
    float chev = step(0.5, ch) * band;

    float mark = clamp(lane + chev * 0.85, 0.0, 1.0);
    // Paint is not a decal: it sits on the slab and takes the slab's grain.
    col = mix(col, uHazard * (0.72 + grain * 0.5), mark);

    // --- light ------------------------------------------------------------
    // One hard key from the high bay, a weak bounce off the slab, and a
    // grazing term so the floor brightens toward the vanishing point the way
    // a specular floor does rather than fading uniformly.
    vec3 n = normalize(vN);
    vec3 v = normalize(uEye - vW);
    float lam  = max(0.0, dot(n, normalize(uKey)));
    float graze = pow(1.0 - max(0.0, dot(n, v)), 3.0);
    col *= 0.30 + 0.86 * lam;
    col += uHazard * graze * 0.05 * mark;
    col += uLit * graze * 0.16;

    float d = length(uEye - vW);
    col = mix(col, uAir, smoothstep(uFogNear, uFogFar, d));
    gl_FragColor = vec4(col, 1.0);

    /* The slab joins the pipeline here, and it did not used to.
    
       Everything above is linear: uSlab, uHazard, uAir and the rest are
       THREE.Color uniforms, which convert sRGB to linear on construction,
       and a lambert term times a linear albedo is a linear radiance. What
       was missing was the other end -- the curve and the encode that every
       standard material in the building gets from three's output stage and
       that a custom shader gets none of. Without them this wrote radiance
       straight to an sRGB framebuffer, which is a factor of four to five too
       dark in the mid tones, and the slab was compensated by lifting its
       palette entry instead: floor went to #736f6b to make a floor that
       should be about #333230 come out right.
    
       That compensation is what made the post pass impossible. A render
       target is linear, so three's output stage does nothing there, and a
       buffer where the slab is display-referred and the walls are linear
       cannot be graded by any single curve -- measured, one exposure that
       fixed the slab crushed the daylight and vice versa. With these two
       lines the whole buffer is one space: linear on the way into the post
       chain, display-referred once, at the end, wherever that end is. */
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;
