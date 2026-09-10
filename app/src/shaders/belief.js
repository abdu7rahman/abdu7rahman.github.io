/* What the machine thinks the floor is, revealed under where you point.
 *
 * The reference this was measured against reveals a painting from under a
 * sketch: two authored textures, and a noisy threshold that sweeps between
 * them. It is a good effect and it is worth saying precisely where it stops,
 * because three of its limits are fixable and the fourth is the interesting
 * one.
 *
 *   1. Its boundary is a hard test -- if (mask < threshold) discard -- so the
 *      edge is one pixel wide and unfiltered. Under a moving reveal that
 *      crawls: the boundary samples a different noise cell every frame and
 *      the fringe shimmers. Filtered against the mask's own screen-space
 *      derivative it stays put and stays smooth at any distance, which costs
 *      one fwidth.
 *   2. Its direction is (1.0 - uv.y): the sweep always runs bottom to top in
 *      texture space. That makes the effect a property of the unwrap rather
 *      than of the room -- two objects sharing an atlas reveal in whatever
 *      direction their islands happen to sit. Driven from a point in world
 *      space it is a lamp you sweep over a machine, and it is the same
 *      gesture whatever the geometry underneath is doing.
 *   3. Its sketch path is one octave at 15x. One frequency is one size of
 *      wobble, which reads as a machine-made edge. Three octaves at 3, 11 and
 *      37 give the boundary a spectrum.
 *
 * The fourth is not a defect, it is a difference in what there is to show.
 * Theirs reveals art, so the second layer has to be painted by hand. This
 * project's whole claim is that its numbers are real -- measured planners,
 * real kinematics, Python that actually runs -- so the layer under the skin
 * is not a picture of a costmap, it is the costmap: an occupancy grid, nav2's
 * own inflation falloff around each cell, and the plan through it. Nothing
 * here is authored. Move an obstacle and the inflation moves, because it is
 * computed from the obstacle.
 */
export const BELIEF_VERT = /* glsl */`
  varying vec3 vW;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

export const BELIEF_FRAG = /* glsl */`
  precision highp float;
  varying vec3 vW;

  uniform vec3  uPoint;      // where the lamp is, in world space
  uniform float uOpen;       // 0 closed, 1 fully open
  uniform float uRadius;
  uniform vec3  uHazard, uTeal, uInk;
  uniform float uCell;       // costmap resolution, metres
  uniform vec3  uObs[6];     // obstacle centres (xz) and radius in .z
  uniform vec3  uEye;
  uniform float uFogNear, uFogFar;
  uniform vec3  uAir;

  float rand(vec2 n) { return fract(sin(dot(n, vec2(12.9898, 4.1414))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(rand(i), rand(i + vec2(1,0)), f.x),
               mix(rand(i + vec2(0,1)), rand(i + vec2(1,1)), f.x), f.y);
  }
  // Three octaves rather than one, so the boundary has a spectrum instead of
  // a single wobble frequency. The weights halve; the scales are not
  // harmonics of each other, which keeps the pattern from beating.
  float fbm(vec2 p) {
    return vnoise(p * 3.0) * 0.55 + vnoise(p * 11.0) * 0.30 + vnoise(p * 37.0) * 0.15;
  }

  void main() {
    vec2 p = vW.xz;

    /* The boundary. Distance from the lamp, warped by the noise, tested
       against the open radius -- and filtered against its own derivative
       rather than compared with a hard less-than, which is what stops the
       fringe crawling when either the lamp or the camera moves. */
    float d = length(p - uPoint.xz);
    float warp = (fbm(p * 0.9) - 0.5) * 0.55;
    float m = d + warp - uRadius * uOpen;
    float aa = fwidth(m) * 1.2 + 1e-4;
    float inside = 1.0 - smoothstep(-aa, aa, m);
    if (uOpen < 0.001 || inside < 0.002) discard;

    /* The costmap, computed. Occupancy is the obstacles themselves; the band
       around each one is nav2's exponential falloff, which is what a planner
       actually sees and is why a plan gives a wall a berth instead of
       shaving it. */
    float cost = 0.0;
    for (int i = 0; i < 6; i++) {
      float r = uObs[i].z;
      if (r <= 0.0) continue;
      float dd = length(p - uObs[i].xy);
      if (dd < r) { cost = 1.0; }
      else cost = max(cost, 0.99 * exp(-3.0 * (dd - r)));
    }

    // Grid, on the costmap's own resolution, so the cell size is legible.
    vec2 g = abs(fract(p / uCell + 0.5) - 0.5) * uCell;
    float grid = 1.0 - smoothstep(0.0, fwidth(p.x) * 1.5 + 0.004, min(g.x, g.y));

    vec3 col = mix(vec3(0.02, 0.05, 0.06), uTeal * 0.42, grid * 0.5);
    col = mix(col, uHazard, smoothstep(0.05, 0.95, cost));
    col += uInk * step(0.999, cost) * 0.18;

    /* The wet edge. Their glow is a fixed bluish constant added to the
       fragment; this takes the room's own warm accent so the boundary reads
       as the same light the building is lit by, and it is strongest exactly
       at the transition rather than across the whole revealed area. */
    float rim = exp(-abs(m) * 9.0);
    col += uHazard * rim * 0.85;

    float dist = length(uEye - vW);
    col = mix(col, uAir, smoothstep(uFogNear, uFogFar, dist));
    gl_FragColor = vec4(col, inside);

    // Same two lines as the slab, for the same reason -- see the note at the
    // end of shaders/floor.js. Both chunks leave alpha alone, which matters
    // here because this layer is blended by it.
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;
