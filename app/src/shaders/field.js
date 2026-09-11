/* The bench top as a costmap, drawn from a texture of cell states.
 *
 * One plane, nearest-sampled, so a cell is a cell and not a blur. Everything
 * this bay is about is in the texture: which cells are blocked, which the
 * search has closed, which are still on the open list, and which came out as
 * the path. The states are written by lab/demos/astar.js as it runs, so what
 * is on the bench is the algorithm's own working set rather than a picture of
 * one.
 *
 * The trap this file lives inside is the same as every other shader here: a
 * backtick anywhere in the template literal, including inside a GLSL comment,
 * closes it early and what follows usually still parses. tools/check_shaders.py
 * is the gate.
 */
export const FIELD_VERT = /* glsl */`
  varying vec2 vUv;
  varying vec3 vW;
  void main() {
    vUv = uv;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

export const FIELD_FRAG = /* glsl */`
  precision highp float;
  varying vec2 vUv;
  varying vec3 vW;

  uniform sampler2D tCells;
  uniform vec2  uDim;        // cells across, cells down
  uniform vec3  uWall;
  uniform vec3  uOpen;
  uniform vec3  uClosed;
  uniform vec3  uPath;
  uniform vec3  uEnds;
  uniform vec3  uInfl;
  uniform vec3  uAir;
  uniform float uFogNear, uFogFar;
  uniform float uFade;       // the whole layer, 0 to 1
  uniform vec3  uEye;

  void main() {
    vec2 c = vUv * uDim;
    vec2 cell = floor(c);
    // Nearest, taken at the centre of the cell rather than at vUv, so a
    // fragment near an edge cannot pick up the neighbour through bilinear
    // filtering however the texture happens to be configured.
    float s = texture2D(tCells, (cell + 0.5) / uDim).r * 255.0;

    vec3 col = vec3(0.0);
    float a = 0.0;

    // The open list, which is the front of the search and the thing worth
    // watching. Brightest of the three states for that reason.
    if (s > 1.5 && s < 2.5) { col = uOpen;   a = 0.85; }
    // Closed: expanded and finished with. Dim, because the interesting part
    // of a closed set is its shape, not any one cell in it.
    else if (s > 2.5 && s < 3.5) { col = uClosed; a = 0.42; }
    else if (s > 3.5 && s < 4.5) { col = uPath;   a = 0.95; }
    /* The inflated collar: free floor the planner is not allowed to use
       because a robot centred there would be inside a wall. Faint, and drawn
       so a reader can see that the path keeps its distance on purpose rather
       than by luck. */
    else if (s > 5.5)            { col = uInfl;   a = 0.22; }
    else if (s > 4.5)            { col = uEnds;   a = 1.00; }
    else if (s > 0.5)            { col = uWall;   a = 0.55; }

    /* The cell rule, in cell space and antialiased against the derivative,
       so it is one pixel wide at any distance and does not alias into a moire
       as the camera pulls back. Drawn under everything else at a fixed
       weight rather than added to it, so a closed cell and a free one are
       separated by their fill and not by how bright their edges came out. */
    vec2 f = abs(fract(c) - 0.5);
    vec2 wdt = fwidth(c);
    float line = 1.0 - smoothstep(0.0, 1.0, min(f.x / wdt.x, f.y / wdt.y) * 2.0 - 0.6);
    col = mix(col, mix(col, uOpen, 0.35), line * 0.5);
    a = max(a, line * 0.16);

    float d = length(uEye - vW);
    a *= (1.0 - smoothstep(uFogNear, uFogFar, d)) * uFade;

    gl_FragColor = vec4(col, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;
