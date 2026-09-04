/* The page's atmosphere: a full-bleed fragment shader behind everything.
 *
 * Domain-warped fractal noise, drifting slowly, lit warm against near-black
 * -- fog with something burning a long way behind it. It replaced a Canvas2D
 * particle field that was too thin to register as anything at all.
 *
 * Rendered at half resolution and scaled up by CSS: every feature in it is
 * soft, so the missing pixels cost nothing, and the fill rate of five fbm
 * octaves per pixel matters on a laptop GPU.
 *
 * Enhancement only, three ways down: no JS and the canvas is never built, no
 * WebGL and it removes itself, prefers-reduced-motion and it draws a single
 * frame and stops. In every one of those cases landing.css's own gradient is
 * what shows, which is why that gradient is still there.
 */
(function () {
  "use strict";

  if (!document.body || !document.body.classList.contains("home")) return;

  var reduce = window.matchMedia &&
               window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var canvas = document.createElement("canvas");
  canvas.className = "bg-field";
  canvas.setAttribute("aria-hidden", "true");

  var gl = null;
  try {
    gl = canvas.getContext("webgl", { alpha: false, antialias: false, depth: false })
      || canvas.getContext("experimental-webgl", { alpha: false, antialias: false, depth: false });
  } catch (e) { gl = null; }
  if (!gl) return;

  var VERT =
    "attribute vec2 a;void main(){gl_Position=vec4(a,0.0,1.0);}";

  // The accent arrives as a uniform rather than a literal so the one place
  // the colour is defined stays landing.css.
  var FRAG = [
    "precision highp float;",
    "uniform vec2 u_res;",
    "uniform float u_time;",
    "uniform vec3 u_ember;",
    "uniform vec2 u_mouse;",   // 0..1, already smoothed on the JS side
    "uniform float u_glow;",   // 0..1, fades the pointer light in and out
    "uniform float u_scroll;", // page offset, in viewport heights
    "float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453123);}",
    "float noise(vec2 p){",
    "  vec2 i=floor(p),f=fract(p);",
    "  vec2 u=f*f*(3.0-2.0*f);",
    "  return mix(mix(hash(i),hash(i+vec2(1.0,0.0)),u.x),",
    "             mix(hash(i+vec2(0.0,1.0)),hash(i+vec2(1.0,1.0)),u.x),u.y);",
    "}",
    "float fbm(vec2 p){",
    "  float v=0.0,a=0.5;",
    "  for(int i=0;i<5;i++){v+=a*noise(p);p*=2.02;a*=0.5;}",
    "  return v;",
    "}",
    "void main(){",
    "  vec2 uv=gl_FragCoord.xy/u_res;",
    "  float asp=u_res.x/u_res.y;",
    "  vec2 p=uv*vec2(asp,1.0)*1.6;",
    // Scrolling drags the field with it, so the page reads as one continuous
    // volume you are moving down through rather than a loop behind a window.
    "  p.y+=u_scroll*0.45;",
    "  float t=u_time*0.015;",
    // The pointer stirs the noise. Mostly tangential rather than radial: a
    // purely radial push displaces the field along rays and comes out as a
    // hard starburst, where curling it around the cursor reads as smoke
    // moving out of the way.
    "  vec2 md=(uv-u_mouse)*vec2(asp,1.0);",
    "  float mdl=length(md);",
    "  vec2 dir=normalize(md+1e-6);",
    "  vec2 curl=vec2(-dir.y,dir.x);",
    "  p+=(curl*0.85+dir*0.20)*smoothstep(0.55,0.0,mdl)*0.11*u_glow;",
    // Two rounds of warping: the first bends the field, the second bends the
    // bend. One round reads as clouds, two reads as smoke.
    "  vec2 q=vec2(fbm(p+vec2(0.0,t)),fbm(p+vec2(5.2,1.3-t)));",
    "  vec2 r=vec2(fbm(p+3.0*q+vec2(1.7,9.2)+t*0.6),",
    "              fbm(p+3.0*q+vec2(8.3,2.8)-t*0.4));",
    "  float f=fbm(p+2.6*r);",
    // Weight the smoke to the right, where the robot is. The reference does
    // the same thing and it is not only composition: the type lives in the
    // left half, and every bit of light put behind it is contrast spent.
    "  float side=smoothstep(0.20,0.92,uv.x);",
    // Weighted hard towards the top end: light only in the places the noise
    // really peaks, so most of the frame stays the page's own black and the
    // glow reads as a source rather than a tint over everything.
    "  f=smoothstep(0.30,0.98,f);",
    "  vec3 base=vec3(0.039,0.039,0.039);",
    // Smoke is not the same colour as the light in it: a warm source through
    // grey particulate. Two terms, so the fog has body of its own instead of
    // being a wash of the accent.
    "  vec3 smoke=vec3(0.62,0.60,0.58);",
    "  float d=f*(0.16+0.84*side);",
    "  vec3 col=base+smoke*d*0.085+u_ember*d*0.11;",
    "  col+=u_ember*pow(smoothstep(0.62,1.0,length(r)),2.0)*0.03*side;",
    // Pull the corners down so the type in the middle always has the darkest
    // ground under it.
    // A pool of warm light under the cursor. Multiplied by the noise as well
    // as the falloff, so it lights the smoke that is actually there instead
    // of laying a clean disc over the top of it.
    "  float pool=smoothstep(0.46,0.0,mdl)*u_glow;",
    "  pool=pool*pool;",   // squared, so the edge of the pool has no visible rim
    // Kept deliberately dim. Measured against the brightest pixel the pool
    // produces, --landing-mut -- the most fragile text on the page, and the
    // text the cursor is most often sitting on while it is read -- has to
    // stay clear of its 4.5:1 floor, not just scrape it.
    "  col+=u_ember*pool*(0.16+0.5*f)*0.26;",
    "  float vig=smoothstep(1.10,0.18,length(uv-vec2(0.5)));",
    "  col*=mix(0.45,1.0,vig);",
    "  gl_FragColor=vec4(col,1.0);",
    "}"
  ].join("\n");

  function compile(type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { gl.deleteShader(s); return null; }
    return s;
  }

  var vs = compile(gl.VERTEX_SHADER, VERT);
  var fs = compile(gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) return;

  var prog = gl.createProgram();
  gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
  gl.useProgram(prog);

  // One triangle big enough to cover the clip cube; cheaper than two and it
  // has no seam down the diagonal.
  var buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  var loc = gl.getAttribLocation(prog, "a");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  var uRes = gl.getUniformLocation(prog, "u_res");
  var uTime = gl.getUniformLocation(prog, "u_time");
  var uEmber = gl.getUniformLocation(prog, "u_ember");
  var uMouse = gl.getUniformLocation(prog, "u_mouse");
  var uGlow = gl.getUniformLocation(prog, "u_glow");
  var uScroll = gl.getUniformLocation(prog, "u_scroll");

  function hexToRgb01(hex) {
    var h = hex.replace("#", "").trim();
    if (h.length === 3) h = h.split("").map(function (c) { return c + c; }).join("");
    var n = parseInt(h, 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }
  var accent = getComputedStyle(document.documentElement)
    .getPropertyValue("--landing-accent").trim() || "#ff8a5c";
  var ember = hexToRgb01(accent);
  gl.uniform3f(uEmber, ember[0], ember[1], ember[2]);

  document.body.appendChild(canvas);

  // Half resolution. Nothing in the image has an edge, so the only thing the
  // extra pixels would buy is heat.
  var SCALE = 0.5;
  function resize() {
    var w = Math.max(1, Math.round(window.innerWidth * SCALE));
    var h = Math.max(1, Math.round(window.innerHeight * SCALE));
    if (canvas.width === w && canvas.height === h) return;
    canvas.width = w; canvas.height = h;
    gl.viewport(0, 0, w, h);
    gl.uniform2f(uRes, w, h);
  }

  // Where the pointer is, where the light currently is, and how strongly it
  // is lit. The light chases the pointer rather than being pinned to it: a
  // light that tracks exactly reads as a cursor decoration, one that lags
  // reads as something in the scene responding.
  var mx = 0.5, my = 0.5, tx = 0.5, ty = 0.5, glow = 0, glowTarget = 0;
  var scroll = 0;

  function onPointer(e) {
    tx = e.clientX / window.innerWidth;
    ty = 1 - e.clientY / window.innerHeight;   // GL's y runs the other way
    glowTarget = 1;
  }
  window.addEventListener("pointermove", onPointer, { passive: true });
  window.addEventListener("pointerdown", onPointer, { passive: true });
  window.addEventListener("pointerleave", function () { glowTarget = 0; }, { passive: true });
  // A touch should light the point it touched and then let it fade, not leave
  // a pool sitting where the finger last was.
  window.addEventListener("pointerup", function () { glowTarget = 0; }, { passive: true });

  window.addEventListener("scroll", function () {
    scroll = window.scrollY / Math.max(1, window.innerHeight);
  }, { passive: true });

  var raf = null, start = 0;
  function frame(now) {
    if (!start) start = now;
    // Frame-rate independent chase: the same 1/e distance per unit time
    // whether this runs at 60Hz or 144.
    var k = 1 - Math.pow(0.0025, 1 / 60);
    mx += (tx - mx) * k * 4.0;
    my += (ty - my) * k * 4.0;
    glow += (glowTarget - glow) * k * 2.2;
    gl.uniform2f(uMouse, mx, my);
    gl.uniform1f(uGlow, glow);
    gl.uniform1f(uScroll, scroll);
    gl.uniform1f(uTime, (now - start) / 1000);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    raf = requestAnimationFrame(frame);
  }
  function play() { if (raf == null && !reduce) raf = requestAnimationFrame(frame); }
  function stop() { if (raf != null) { cancelAnimationFrame(raf); raf = null; } }

  resize();
  if (reduce) {
    // One settled frame, no loop and no pointer light: the uniforms would
    // otherwise sit at their zero defaults, which puts the mouse pool in the
    // bottom-left corner of a frame nobody asked to be lit.
    gl.uniform2f(uMouse, 0.5, 0.5);
    gl.uniform1f(uGlow, 0.0);
    gl.uniform1f(uScroll, 0.0);
    gl.uniform1f(uTime, 12.0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  } else {
    play();
  }

  document.addEventListener("visibilitychange", function () {
    if (document.hidden) stop(); else play();
  });

  var t;
  window.addEventListener("resize", function () {
    clearTimeout(t);
    t = setTimeout(function () {
      resize();
      if (reduce) gl.drawArrays(gl.TRIANGLES, 0, 3);
    }, 150);
  });
})();
