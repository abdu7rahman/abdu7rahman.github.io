/* The object in the hero: the real UR12e, running a real move as you scroll.
 *
 * Universal Robots' own triangles from assets/ur12e.json, placed by link
 * transforms tools/bake_hero_arm.py computed with the same kinematics the demo
 * page runs. Scrolling scrubs the trajectory. Nothing here solves anything --
 * it hands matrices to the GPU.
 *
 * WebGL with a depth buffer, not a painter's sort. The first version of this
 * sorted triangles by centroid depth and filled them back-to-front in a 2D
 * context, which is the approach demo.js uses -- and it is fine there, where
 * the arm is small and mostly seen side-on. At hero size it falls apart: a
 * folded arm puts the forearm in front of the shoulder and the wrist inside
 * the elbow, and centroid order gets those pairs wrong, so far triangles paint
 * over near ones and the robot looks like it is made of stickers. Per-fragment
 * depth is the only thing that actually fixes that.
 *
 * Enhancement only: no JS, no WebGL, or a fetch that fails, and the hero is
 * the type on the fog, which is what it was before this file existed.
 */
(function () {
  "use strict";

  if (!document.body || !document.body.classList.contains("home")) return;

  var reduce = window.matchMedia &&
               window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var canvas = document.createElement("canvas");
  canvas.className = "hero__arm";
  canvas.setAttribute("aria-hidden", "true");

  var gl = null;
  try {
    gl = canvas.getContext("webgl", { alpha: true, antialias: true, depth: true })
      || canvas.getContext("experimental-webgl", { alpha: true, antialias: true, depth: true });
  } catch (e) { gl = null; }
  if (!gl) return;

  var accent = getComputedStyle(document.documentElement)
    .getPropertyValue("--landing-accent").trim() || "#ff8a5c";
  var ember = hexToRgb01(accent);

  function hexToRgb01(hex) {
    var h = hex.replace("#", "").trim();
    if (h.length === 3) h = h.split("").map(function (c) { return c + c; }).join("");
    var n = parseInt(h, 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }

  var VERT = [
    "attribute vec3 aPos;",
    "attribute vec3 aNrm;",
    "uniform mat4 uModel;",
    "uniform mat4 uView;",
    "uniform mat4 uProj;",
    "varying vec3 vNrm;",
    "void main(){",
    "  mat4 mv=uView*uModel;",
    // Normals are wanted in eye space, where the rim term has a fixed axis to
    // measure against. The link transforms are rigid -- rotation and
    // translation, no scale -- so the rotation block is its own
    // inverse-transpose and none needs shipping.
    "  vNrm=mat3(mv)*aNrm;",
    "  gl_Position=uProj*mv*vec4(aPos,1.0);",
    "}"
  ].join("\n");

  var FRAG = [
    "precision mediump float;",
    "uniform vec3 uColor;",
    "uniform vec3 uEmber;",
    "uniform float uGlow;",
    "varying vec3 vNrm;",
    "void main(){",
    "  vec3 n=normalize(vNrm);",
    // Two-sided: with culling off, a triangle wound the other way arrives with
    // its normal pointing into the screen and would shade as unlit.
    "  if(n.z<0.0) n=-n;",
    // Both in eye space: a key from the upper left and slightly behind, which
    // is what lays the warm edge down the side of the arm facing the headline.
    "  vec3 l=normalize(vec3(-0.45,0.55,0.70));",
    "  float lam=max(dot(n,l),0.0);",
    // In eye space z points at the viewer, so a surface turning away from the
    // camera is one whose normal has little z left.
    "  float rim=pow(1.0-abs(n.z),3.0);",
    "  vec3 col=uColor*(0.20+0.92*lam)+uEmber*(rim*0.95+uGlow);",
    "  gl_FragColor=vec4(col,1.0);",
    "}"
  ].join("\n");

  function compile(type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { gl.deleteShader(s); return null; }
    return s;
  }
  var vs = compile(gl.VERTEX_SHADER, VERT), fs = compile(gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) return;
  var prog = gl.createProgram();
  gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
  gl.useProgram(prog);

  var aPos = gl.getAttribLocation(prog, "aPos");
  var aNrm = gl.getAttribLocation(prog, "aNrm");
  var uModel = gl.getUniformLocation(prog, "uModel");
  var uView = gl.getUniformLocation(prog, "uView");
  var uProj = gl.getUniformLocation(prog, "uProj");
  var uColor = gl.getUniformLocation(prog, "uColor");
  var uEmber = gl.getUniformLocation(prog, "uEmber");
  var uGlow = gl.getUniformLocation(prog, "uGlow");
  gl.uniform3f(uEmber, ember[0], ember[1], ember[2]);

  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL);
  // No back-face culling. These meshes are a decimated triangle soup and
  // nothing in the file promises a consistent winding; culling on a guess
  // costs whole links when the guess is wrong, and the depth buffer is what
  // is actually resolving occlusion here. The shader shades two-sided to
  // match.

  //: Which links are the gripper. They carry their own light: the tool is the
  //: part of a robot doing the work, and it is where the eye should land.
  var TOOL_FIRST = 7;
  //: Roughly half the standing height of the arm, in metres. The base frame
  //: sits on the floor, so without this the robot hangs in the top of the panel.
  var Z_MID = 0.46;

  var parts = [];       // {link, buf, count, colour}
  var motion = null;

  Promise.all([
    fetch("assets/ur12e.json").then(function (r) { if (!r.ok) throw 0; return r.json(); }),
    fetch("assets/hero-motion.json").then(function (r) { if (!r.ok) throw 0; return r.json(); })
  ]).then(function (both) {
    build(both[0]);
    motion = both[1];
    var hero = document.getElementById("intro");
    (hero || document.body).appendChild(canvas);
    resize();
    dirty = true; request();
  }).catch(function () { /* the hero stands without it */ });

  function build(m) {
    var u = m.unit;
    for (var li = 0; li < m.links.length; li++) {
      for (var pi = 0; pi < m.links[li].parts.length; pi++) {
        var src = m.links[li].parts[pi];
        var v = src.v, f = src.f;
        // Expanded to non-indexed so every triangle can carry its own face
        // normal. Smooth normals across a decimated mechanical part round off
        // the machined edges that make it read as a machine.
        var n = f.length;
        var pos = new Float32Array(n * 3);
        var nrm = new Float32Array(n * 3);
        for (var t = 0; t < n; t += 3) {
          var i0 = f[t] * 3, i1 = f[t + 1] * 3, i2 = f[t + 2] * 3;
          var ax = v[i0] * u, ay = v[i0 + 1] * u, az = v[i0 + 2] * u;
          var bx = v[i1] * u, by = v[i1 + 1] * u, bz = v[i1 + 2] * u;
          var cx = v[i2] * u, cy = v[i2 + 1] * u, cz = v[i2 + 2] * u;
          var ex = bx - ax, ey = by - ay, ez = bz - az;
          var gx = cx - ax, gy = cy - ay, gz = cz - az;
          var nx = ey * gz - ez * gy, ny = ez * gx - ex * gz, nz = ex * gy - ey * gx;
          var ln = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
          nx /= ln; ny /= ln; nz /= ln;
          var o = t * 3;
          pos[o] = ax; pos[o + 1] = ay; pos[o + 2] = az;
          pos[o + 3] = bx; pos[o + 4] = by; pos[o + 5] = bz;
          pos[o + 6] = cx; pos[o + 7] = cy; pos[o + 8] = cz;
          for (var k = 0; k < 3; k++) {
            nrm[o + k * 3] = nx; nrm[o + k * 3 + 1] = ny; nrm[o + k * 3 + 2] = nz;
          }
        }
        var pb = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, pb);
        gl.bufferData(gl.ARRAY_BUFFER, pos, gl.STATIC_DRAW);
        var nb = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, nb);
        gl.bufferData(gl.ARRAY_BUFFER, nrm, gl.STATIC_DRAW);
        parts.push({ link: li, pb: pb, nb: nb, count: n,
                     colour: [src.c[0] / 255, src.c[1] / 255, src.c[2] / 255],
                     glow: li >= TOOL_FIRST ? 0.75 : 0.0 });
      }
    }
  }

  /* ---- matrices ---------------------------------------------------------
     Everything here is column-major, because that is what WebGL 1 takes and
     it refuses the transpose flag that would let it be anything else. */
  var model = new Float32Array(16);
  function modelFrom(M, o) {
    // Column-major for GL, from the row-major 3x4 the bake wrote.
    model[0] = M[o];      model[1] = M[o + 4];  model[2] = M[o + 8];   model[3] = 0;
    model[4] = M[o + 1];  model[5] = M[o + 5];  model[6] = M[o + 9];   model[7] = 0;
    model[8] = M[o + 2];  model[9] = M[o + 6];  model[10] = M[o + 10]; model[11] = 0;
    model[12] = M[o + 3]; model[13] = M[o + 7]; model[14] = M[o + 11] - Z_MID; model[15] = 1;
    return model;
  }

  /* ---- the frame the scroll is asking for ------------------------------- */
  function run() {
    var hero = document.getElementById("intro");
    return Math.max(1, hero ? hero.offsetHeight : window.innerHeight);
  }
  function progress() {
    var p = window.scrollY / run();
    return p < 0 ? 0 : p > 1 ? 1 : p;
  }

  var M = new Float32Array(120);
  function poseAt(p) {
    var n = motion.frames;
    var f = p * (n - 1);
    var i = Math.floor(f);
    if (i >= n - 1) { i = n - 2; f = n - 1; }
    var t = f - i;
    var a = motion.T[i], b = motion.T[i + 1];
    for (var k = 0; k < 120; k++) M[k] = a[k] + (b[k] - a[k]) * t;
  }

  /* ---- camera ----------------------------------------------------------- */
  var yaw = -0.62, pitch = 0.30, yawT = yaw, pitchT = pitch;
  var W = 0, H = 0;
  var view = new Float32Array(16), proj = new Float32Array(16);

  function resize() {
    var r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = r.width; H = r.height;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    gl.viewport(0, 0, canvas.width, canvas.height);
    return true;
  }

  function camera() {
    var cy = Math.cos(yaw), sy = Math.sin(yaw);
    var cp = Math.cos(pitch), sp = Math.sin(pitch);
    var dist = 4.5;

    // World is z-up. Yaw turns the robot about z, pitch lifts the eye about
    // x, and the result is rewritten into the eye space GL expects: x right,
    // y up, z toward the viewer. Writing it straight into that convention is
    // what lets the projection below be the textbook one instead of a
    // shuffled matrix nobody can check.
    view[0] = cy;      view[1] = sp * sy;  view[2] = -cp * sy; view[3] = 0;
    view[4] = -sy;     view[5] = sp * cy;  view[6] = -cp * cy; view[7] = 0;
    view[8] = 0;       view[9] = cp;       view[10] = sp;      view[11] = 0;
    view[12] = 0;      view[13] = 0;       view[14] = -dist;   view[15] = 1;

    var aspect = W / Math.max(1, H);
    var fov = 0.62, near = 0.1, far = 20.0;
    var f = 1 / Math.tan(fov / 2);
    proj[0] = f / aspect; proj[1] = 0; proj[2] = 0; proj[3] = 0;
    proj[4] = 0; proj[5] = f; proj[6] = 0; proj[7] = 0;
    proj[8] = 0; proj[9] = 0; proj[10] = (far + near) / (near - far); proj[11] = -1;
    proj[12] = 0; proj[13] = 0; proj[14] = 2 * far * near / (near - far); proj[15] = 0;
  }

  function draw() {
    if (!parts.length || !motion || !W || !H) return;
    poseAt(progress());
    camera();
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.uniformMatrix4fv(uView, false, view);
    gl.uniformMatrix4fv(uProj, false, proj);
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      gl.uniformMatrix4fv(uModel, false, modelFrom(M, p.link * 12));
      gl.uniform3f(uColor, p.colour[0], p.colour[1], p.colour[2]);
      gl.uniform1f(uGlow, p.glow);
      gl.bindBuffer(gl.ARRAY_BUFFER, p.pb);
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, p.nb);
      gl.enableVertexAttribArray(aNrm);
      gl.vertexAttribPointer(aNrm, 3, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, p.count);
    }
  }

  /* ---- when to redraw ---------------------------------------------------- */
  var raf = null, lastScroll = -1, dirty = true;

  function tick() {
    raf = null;
    var dy = yawT - yaw, dp = pitchT - pitch;
    yaw += dy * 0.08;
    pitch += dp * 0.08;
    var moving = Math.abs(dy) > 1e-4 || Math.abs(dp) > 1e-4;
    if (dirty || moving) { draw(); dirty = false; }
    if (moving) request();
  }
  function request() { if (raf == null) raf = requestAnimationFrame(tick); }

  window.addEventListener("scroll", function () {
    if (window.scrollY === lastScroll) return;
    lastScroll = window.scrollY;
    dirty = true; request();
  }, { passive: true });

  if (!reduce) {
    window.addEventListener("pointermove", function (e) {
      // A quarter turn across the window, and a much smaller lift: pitching as
      // far as it yaws puts the camera under the floor.
      yawT = -0.62 + (e.clientX / window.innerWidth - 0.5) * 0.85;
      pitchT = 0.30 + (e.clientY / window.innerHeight - 0.5) * 0.34;
      request();
    }, { passive: true });
  }

  var rt;
  window.addEventListener("resize", function () {
    clearTimeout(rt);
    rt = setTimeout(function () { if (resize()) { dirty = true; request(); } }, 150);
  });
})();
