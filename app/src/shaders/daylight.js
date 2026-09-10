/* Daylight: the shafts in the air and the pools they put on the slab.
 *
 * Both are additive and neither is a light. That is the whole design and it
 * is not laziness -- the brief is one hard key with deep shadows, and the
 * cheapest way to ruin that is to answer "the building needs daylight" with
 * another lamp, which lifts the blacks everywhere and flattens the shot. An
 * additive layer cannot lift a black: it adds to the pixels inside the beam
 * and adds exactly zero everywhere else, so the pools get brighter and the
 * shadows stay where they were. Contrast goes up, which is what was asked
 * for.
 *
 * The geometry is not invented either. The scene's key sits at (-6.5, 9.2,
 * 4.0), so light travels 0.706 m in +x and 0.435 m in -z for every metre it
 * falls, and every aperture in this file is placed by that ratio rather than
 * by eye. That is why the rooflight run is on the left of the roof: from
 * anywhere else the shaft misses the aisle.
 *
 * Both end on the two chunk includes rather than on calls, and the
 * difference is not style. A custom shader gets no curve and no encode for
 * free, and one that skips them lands in a different response from every
 * standard material next to it -- so these two lines have to be here. But
 * calling toneMapping() directly compiles only while three has declared it,
 * and three declares it per program from the target being drawn into:
 * WebGLPrograms takes renderer.toneMapping when the target is the canvas and
 * NoToneMapping otherwise, and with NoToneMapping it emits neither the
 * define nor the function. So the direct call built fine for a year and then
 * failed the day a post pass rendered the scene into a target -- "no
 * matching overloaded function found", the material dead, the shafts and the
 * pools simply absent. Measured at the entrance: the shaft region read p50
 * 180 of 255 without the pass and p50 2 with it, which looked exactly like a
 * colour-space fault and was a compile error.
 *
 * <tonemapping_fragment> is the same call wrapped in the #if that three
 * writes the define for, so it becomes nothing when there is no curve to
 * apply instead of becoming a broken program. Identical output on the canvas
 * path, and it survives a render target.
 */

/* One aperture, swept along the sun into a solid, and the exact length of
 * view ray inside that solid.
 *
 * The sweep is a shear, and a shear is linear, so a ray stays a ray under it
 * and the whole thing collapses to three slab tests -- the same arithmetic as
 * a ray-box, done in the space where the beam is a box. That gives the true
 * chord in metres rather than a fogged card, which matters because a chord
 * goes to zero at the silhouette on its own: the beam feathers at its edges
 * because it is thin there, not because anything was blurred.
 *
 * Object space, with the aperture centred on the origin and the beam running
 * down -y. The mesh carries only a translation, so the camera in object space
 * is just cameraPosition minus the model matrix's fourth column.
 */
export const SHAFT_VERT = /* glsl */`
  varying vec3 vL;
  varying vec3 vO;
  varying vec3 vW;
  void main() {
    vL = position;
    vO = cameraPosition - modelMatrix[3].xyz;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

export const SHAFT_FRAG = /* glsl */`
  precision highp float;
  varying vec3 vL;
  varying vec3 vO;
  varying vec3 vW;

  uniform vec3  uSky;
  uniform float uDx, uDz;     // metres of x and z per metre of fall
  uniform float uHX, uHZ;     // aperture half sizes
  uniform float uPen;         // penumbra half width at the slab, metres
  uniform vec2  uNear;        // metres: nothing at x, everything by y
  uniform float uDrop;        // aperture soffit to slab
  uniform float uGain;
  uniform vec3  uAir;
  uniform float uFogNear, uFogFar;

  void main() {
    vec3 D = normalize(vL - vO);

    // Shear both ends of the ray into the space where the beam is a box.
    vec3 O = vec3(vO.x + uDx * vO.y, vO.y, vO.z + uDz * vO.y);
    vec3 R = vec3(D.x  + uDx * D.y,  D.y,  D.z  + uDz * D.y);

    // A component of exactly zero is a ray parallel to that slab, and the
    // division below would hand min/max an infinity to sort. Nudging it is
    // three lines; sorting infinities is a bug that only shows on one axis.
    vec3 S = R;
    if (abs(S.x) < 1e-6) S.x = 1e-6;
    if (abs(S.y) < 1e-6) S.y = 1e-6;
    if (abs(S.z) < 1e-6) S.z = 1e-6;

    // The slab test bounds the beam plus its penumbra, not the beam. The
    // taper below needs somewhere to run out to; bounded at the aperture
    // size it would only ever reach half strength at the wall and the
    // silhouette would still be the wall.
    vec3 lo = vec3(-uHX - uPen, -uDrop, -uHZ - uPen);
    vec3 hi = vec3( uHX + uPen,  0.0,    uHZ + uPen);
    vec3 ta = (lo - O) / S;
    vec3 tb = (hi - O) / S;
    vec3 tn = min(ta, tb);
    vec3 tf = max(ta, tb);
    float t0 = max(max(tn.x, tn.y), tn.z);
    float t1 = min(min(tf.x, tf.y), tf.z);
    t0 = max(t0, 0.0);
    float chord = t1 - t0;
    if (chord <= 0.0) discard;

    /* A rooflight is glass-reinforced polyester, not a window. It scatters,
       which has two consequences and the shaft only had one of them.

       The one it had: the beam leaves the aperture as a cone, so its
       radiance per metre drops as it spreads. Evaluated at the middle of
       the chord, one sample rather than an integral, indistinguishable at
       this size.

       The one it did not: a diffusing panel is an area source, so its
       shadow has a penumbra, and the penumbra is not a detail here -- it is
       most of the edge. The umbra shrinks and the penumbra grows by the
       same amount as the beam falls, so the profile is full strength inside
       uHX - pen, zero outside uHX + pen, and pen goes from nothing at the
       glass to uPen at the slab. Without it the chord alone was the whole
       silhouette, and a chord through a box has a hard edge: seven of them
       down the roof read as a staircase of bright rectangles rather than as
       light coming into a shed. */
    vec3 mid = O + R * ((t0 + t1) * 0.5);
    float fall = clamp(-mid.y / uDrop, 0.0, 1.0);
    /* 0.18 at the slab, not the 0.30 it was. The beam widens in two axes as
       it falls, so the radiance per metre of it falls faster than a single
       taper suggests, and the number only started to matter once the proxy
       box was fixed: before that the lower half of every beam was missing
       and the far end of the taper was never drawn. */
    float spread = mix(1.0, 0.18, fall);

    // Never zero width: at the aperture the two smoothstep edges would
    // coincide, and a smoothstep whose edges are equal is a divide by zero.
    float pen = max(uPen * fall, 0.02);
    float soft = (1.0 - smoothstep(uHX - pen, uHX + pen, abs(mid.x)))
               * (1.0 - smoothstep(uHZ - pen, uHZ + pen, abs(mid.z)));

    float I = chord * uGain * spread * soft;
    /* Compressed rather than clipped, so the length still reads -- but to
       0.55 rather than to 1.82, and the difference is the whole station.
    
       A chord is tens of metres when you look along a beam, and standing
       beside one you are looking along it across most of the frame: at a
       test cell the camera is two metres from a beam 4.5 m wide at eye
       height, which subtends most of the view. That is correct, and it read
       as a flat pale sheet over two thirds of the frame with the cell
       ghosted through it, because the asymptote was above white. Scattered
       daylight in air is not a white surface however far you look through
       it, and 0.55 of the sky colour lands at 211 of 255 through the curve
       -- bright, and still a beam you can see the building through. */
    I = I / (1.0 + I / 0.55);

    /* Nothing in the first few metres, everything past a dozen, and this is
       the term that makes seven beams in a shed read as beams.
    
       Without it the medium is uniform in depth and the camera swims in it.
       Standing at a test cell you are three metres from a beam that is
       4.5 m across at eye height with six more behind it at 7.2 m centres,
       so almost every ray in the frame crosses one and the whole right of
       the view came back as a flat pale sheet with the cell ghosted through
       it -- fog, not light. From the entrance the same seven are ten to
       fifty metres off, they overlap along the view, and they are the best
       thing in the building. The difference between those two is entirely
       how far away the air is.
    
       t is metres here: the shear is applied to the ray's origin and
       direction, not to its parameter, so t0 is the distance from the eye
       to where the beam starts. Perceptually this is also just true -- the
       beam you are standing in is the one you cannot see. */
    I *= smoothstep(uNear.x, uNear.y, t0);

    float d = length(cameraPosition - vW);
    I *= 1.0 - smoothstep(uFogNear, uFogFar, d);

    gl_FragColor = vec4(uSky * I, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

/* The slab under all of it: where the daylight lands, drawn analytically on
 * one plane 12 mm above the pour.
 *
 * One plane and not one per bay, because the rooflights are on the structural
 * grid and a periodic function in z is the whole of it. The 12 mm is a long
 * way clear of a depth fight -- at 60 m down the aisle from 1.62 m of eye
 * height that offset is 0.44 m along the view ray, and this buffer resolves
 * about 2 mm out there.
 */
export const POOL_VERT = /* glsl */`
  varying vec3 vW;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

/* Written as a function because the guarding's bay mouths come out of
 * plan.js and their count is not fixed. A GLSL ES array needs a constant
 * bound, so the count is baked into the source rather than padded with dead
 * entries that would still cost a branch each.
 */
export function poolFrag(mouths) {
  return /* glsl */`
  precision highp float;
  varying vec3 vW;

  uniform vec3  uSky, uWash;
  uniform float uPitch;         // structural bay spacing
  uniform float uZ0;            // centre of the first pool
  uniform float uCount;         // how many pools there are
  uniform float uHX, uHZ;       // pool half sizes on the slab
  uniform float uSoft;          // penumbra
  uniform float uGuardX;        // x of the shadow the guarding throws
  uniform float uGuardPass;     // how much light the mesh infill passes
  uniform float uBandLo, uBandHi;   // the clerestory wash across the bays
  uniform float uBandGain;
  uniform float uBackZ, uDoorHX, uDoorGain, uDoorRun;
  uniform float uFront, uBack;  // the ends of the building
  uniform float uGain;
  uniform float uFogNear, uFogFar;
  uniform vec2  uMouth[${mouths}];

  float hash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1,0)), f.x),
               mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y);
  }

  float box(float d, float h) { return 1.0 - smoothstep(h - uSoft, h + uSoft, d); }

  void main() {
    // Which rooflight is overhead. Snapped and clamped rather than wrapped,
    // so the run stops at the last bay instead of marching out of the shed.
    float k = clamp(floor((uZ0 - vW.z) / uPitch + 0.5), 0.0, uCount - 1.0);
    float zc = uZ0 - k * uPitch;
    float pool = box(abs(vW.x), uHX) * box(abs(vW.z - zc), uHZ);

    // The left guarding line stands in the beam. It is 1.9 m tall and the
    // light falls at 0.706 m of x per metre, so it shadows the slab from the
    // fence out to 1.34 m inside the lane -- which eats the outer 0.34 m of
    // a pool that reaches x = -2.2. Not black: Guarding.jsx draws the infill
    // at 0.72 opacity, so a little over a quarter gets through.
    float lit = smoothstep(uGuardX - uSoft, uGuardX + uSoft, vW.x);
    float open = 0.0;
    for (int i = 0; i < ${mouths}; i++) {
      open = max(open, step(uMouth[i].x, vW.z) * step(vW.z, uMouth[i].y));
    }
    pool *= mix(mix(uGuardPass, 1.0, lit), 1.0, open);

    // The clerestory band on the left wall clears the back of the bays and
    // lands as a continuous strip well short of the lane. It cannot reach
    // the aisle from there and no glazing lower down could either: to put
    // light on the centre line from x = -11.01 the aperture would have to
    // stand 15.6 m up, which is 6.7 m above this eaves. That measurement is
    // the reason the rooflights exist at all.
    float band = box(abs(vW.x - (uBandLo + uBandHi) * 0.5), (uBandHi - uBandLo) * 0.5);

    // Under the far shutter, which is parked at head height. Sky rather than
    // sun, so it is a wash that dies over a few metres rather than a shaft.
    float run = clamp((vW.z - uBackZ) / uDoorRun, 0.0, 1.0);
    float door = box(abs(vW.x), uDoorHX) * (1.0 - run) * (1.0 - run);

    // Inside the building only.
    float shed = step(uBack, vW.z) * step(vW.z, uFront);

    // Paint on a floor takes the floor's grain, and so does light on it.
    float grain = 0.78 + 0.44 * vnoise(vW.xz * 1.7);

    vec3 col = uSky  * (pool * uGain + door * uDoorGain)
             + uWash * (band * uBandGain);
    col *= shed * grain;

    float d = length(cameraPosition - vW);
    col *= 1.0 - smoothstep(uFogNear, uFogFar, d);

    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;
}
