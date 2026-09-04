/* The object in the hero: the real UR12e, running a real move as you scroll.
 *
 * Universal Robots' own triangles from assets/ur12e-hero.json, placed by link
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
    "varying vec3 vPos;",
    "void main(){",
    "  mat4 mv=uView*uModel;",
    // Normals are wanted in eye space, where the rim term has a fixed axis to
    // measure against. The link transforms are rigid -- rotation and
    // translation, no scale -- so the rotation block is its own
    // inverse-transpose and none needs shipping.
    "  vNrm=mat3(mv)*aNrm;",
    // Eye-space position too, because a specular highlight needs to know
    // where the eye is and in eye space the eye is the origin.
    "  vec4 p=mv*vec4(aPos,1.0);",
    "  vPos=p.xyz;",
    "  gl_Position=uProj*p;",
    "}"
  ].join("\n");

  /* The arm read as faceted long after its normals were smooth, and the
     geometry was not what was left: trebling the triangles changed nothing
     visible. It was this shader. One directional light, a flat 0.20 ambient
     and no specular gives a curved part exactly two regions -- a Lambert
     ramp and a constant -- so the only gradient anywhere is the terminator,
     and every remaining normal discontinuity lands on it as a hard line.
     Machined surfaces do not read as machined because of their polygons;
     they read that way because of the highlight travelling across them.

     So: a studio rig rather than a lamp. Hemispheric ambient so the unlit
     side has a gradient of its own, a key and a dim cool fill, and a
     Blinn-Phong highlight whose tightness comes from what the part is made
     of. Lights are fixed in eye space, which keeps the rig with the camera
     as the robot turns instead of sliding around it. */
  var FRAG = [
    "precision mediump float;",
    "uniform vec3 uColor;",
    "uniform vec3 uEmber;",
    "uniform float uGlow;",
    "uniform vec2 uSpec;",          // strength, exponent
    "varying vec3 vNrm;",
    "varying vec3 vPos;",
    "void main(){",
    "  vec3 n=normalize(vNrm);",
    // Culling is off, so a back face arrives with its normal reversed. Asking
    // the rasteriser which side this is beats the old test on the sign of
    // n.z: that one also fired along every silhouette, where n.z passes
    // through zero on a face that was never back-facing at all, and drew a
    // seam there.
    "  if(!gl_FrontFacing) n=-n;",
    "  vec3 v=normalize(-vPos);",
    // Screen-up rather than world-up: the rig belongs to the camera.
    "  vec3 amb=mix(vec3(0.052,0.048,0.048),vec3(0.27,0.26,0.28),n.y*0.5+0.5);",
    "  vec3 kd=normalize(vec3(-0.42,0.55,0.72));",
    "  vec3 fd=normalize(vec3(0.68,-0.30,0.30));",
    "  float key=max(dot(n,kd),0.0);",
    "  float fill=max(dot(n,fd),0.0)*0.26;",
    "  float sp=pow(max(dot(n,normalize(kd+v)),0.0),uSpec.y)*uSpec.x;",
    // A surface turning away from the eye, measured against the eye rather
    // than against the z axis, so it holds up under perspective.
    "  float rim=pow(1.0-max(dot(n,v),0.0),3.0);",
    "  vec3 col=uColor*(amb+key*0.80+fill)+vec3(sp)+uEmber*(rim*0.50+uGlow);",
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
  var uSpec = gl.getUniformLocation(prog, "uSpec");
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

  // Its own mesh, not the one the demos draw. That one is decimated to about
  // 10k triangles for a Canvas2D painter's algorithm, where the cost is a fill
  // per visible triangle; this renders on the GPU with a depth buffer, where
  // twice the triangles cost nothing measurable, and at 10k the joint caps
  // came out as cut gems. Same pipeline, same pinned source meshes, a budget
  // that matches the renderer actually drawing them.
  function load() {
    Promise.all([
      fetch("assets/ur12e-hero.json").then(function (r) { if (!r.ok) throw 0; return r.json(); }),
      fetch("assets/hero-motion.json").then(function (r) { if (!r.ok) throw 0; return r.json(); })
    ]).then(function (both) {
      build(both[0]);
      motion = both[1];
      var hero = document.getElementById("intro");
      (hero || document.body).appendChild(canvas);
      resize();
      dirty = true; request();
    }).catch(function () { /* the hero stands without it */ });
  }

  // landing.css hides this below 901px, and the two files behind it are
  // 180 KiB no phone was ever going to see -- fetched anyway, on every visit,
  // until now. Waiting on the query rather than reading innerWidth once, so a
  // window dragged wider still gets the robot and a narrow one still pays
  // nothing.
  var wide = window.matchMedia && window.matchMedia("(min-width: 901px)");
  if (!wide || wide.matches) { load(); }
  else {
    var arrive = function () {
      if (!wide.matches) return;
      if (wide.removeEventListener) wide.removeEventListener("change", arrive);
      else if (wide.removeListener) wide.removeListener(arrive);
      load();
    };
    if (wide.addEventListener) wide.addEventListener("change", arrive);
    else if (wide.addListener) wide.addListener(arrive);
  }

  /* How hard a part reflects, from what the part is. A UR is three materials
     and the mesh names them by colour: the blue caps and the pale shells are
     moulded plastic, which takes a tight bright highlight; the light grey
     tubes are painted aluminium, broader and softer; everything near-black is
     matte and barely catches anything. Giving all three the same highlight is
     what makes a render look like plastic all the way through. */
  function material(c) {
    var r = c[0], g = c[1], b = c[2];
    var lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    if (b > r + 24) return [0.30, 64];        // the blue joint caps: gloss
    if (lum > 0.62)  return [0.17, 40];       // painted tube
    if (lum > 0.32)  return [0.10, 26];       // mid grey shell
    return [0.05, 18];                        // matte black
  }

  // Faces meeting at less than this are one surface; past it, an edge.
  var CREASE = Math.cos(78 * Math.PI / 180);

  function build(m) {
    var u = m.unit;
    for (var li = 0; li < m.links.length; li++) {
      for (var pi = 0; pi < m.links[li].parts.length; pi++) {
        var src = m.links[li].parts[pi];
        var v = src.v, f = src.f;
        // Expanded to non-indexed, because a vertex on a crease needs a
        // different normal for each face meeting there.
        //
        // These were flat per-face normals, on the reasoning that smoothing a
        // decimated mechanical part rounds off the machined edges that make it
        // read as a machine. True, and the wrong trade: every facet showed, so
        // the arm came out a stack of prisms. What a modelling tool does
        // instead is smooth by angle -- average across faces that meet
        // shallowly, leave the ones that meet sharply alone -- which rounds
        // the barrels and the domed caps and keeps every real edge. 52
        // degrees: a decimated cylinder steps 15 to 35 between facets here and
        // a machined edge is 90 or near it, so the gap is wide. Measured on
        // this mesh, 92.5% of corners end up blended with a neighbour.
        var n = f.length;
        var tri = n / 3;
        var pos = new Float32Array(n * 3);
        var nrm = new Float32Array(n * 3);

        // Face normals twice over: unnormalised, whose length is twice the
        // triangle's area and is the weight a broad face should carry over a
        // sliver, and unit, for comparing angles.
        var wx = new Float32Array(tri), wy = new Float32Array(tri), wz = new Float32Array(tri);
        var ux = new Float32Array(tri), uy = new Float32Array(tri), uz = new Float32Array(tri);
        var t, c, i, o, j, ln;
        for (t = 0; t < tri; t++) {
          var i0 = f[t * 3] * 3, i1 = f[t * 3 + 1] * 3, i2 = f[t * 3 + 2] * 3;
          var ex = v[i1] - v[i0], ey = v[i1 + 1] - v[i0 + 1], ez = v[i1 + 2] - v[i0 + 2];
          var gx = v[i2] - v[i0], gy = v[i2 + 1] - v[i0 + 1], gz = v[i2 + 2] - v[i0 + 2];
          var nx = ey * gz - ez * gy, ny = ez * gx - ex * gz, nz = ex * gy - ey * gx;
          wx[t] = nx; wy[t] = ny; wz[t] = nz;
          ln = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
          ux[t] = nx / ln; uy[t] = ny / ln; uz[t] = nz / ln;
        }

        // Welded by position, not by index: the vertices arrive quantised to
        // integers and the same corner can appear twice under two indices.
        // Smoothing by index alone leaves a seam straight down the part.
        var ids = Object.create(null), next = 0;
        var weld = new Int32Array(n), touch = [];
        for (t = 0; t < tri; t++) {
          for (c = 0; c < 3; c++) {
            i = f[t * 3 + c] * 3;
            var key = v[i] + "," + v[i + 1] + "," + v[i + 2];
            var id = ids[key];
            if (id === undefined) { id = ids[key] = next++; touch.push([]); }
            weld[t * 3 + c] = id;
            touch[id].push(t);
          }
        }

        for (t = 0; t < tri; t++) {
          for (c = 0; c < 3; c++) {
            i = f[t * 3 + c] * 3;
            o = (t * 3 + c) * 3;
            pos[o] = v[i] * u; pos[o + 1] = v[i + 1] * u; pos[o + 2] = v[i + 2] * u;
            var near = touch[weld[t * 3 + c]];
            var sx = 0, sy = 0, sz = 0;
            for (j = 0; j < near.length; j++) {
              var q = near[j];
              if (ux[q] * ux[t] + uy[q] * uy[t] + uz[q] * uz[t] >= CREASE) {
                sx += wx[q]; sy += wy[q]; sz += wz[q];
              }
            }
            ln = Math.sqrt(sx * sx + sy * sy + sz * sz);
            // A fan cancelling out exactly -- a needle, a degenerate -- falls
            // back to the face it belongs to rather than to zero.
            if (ln < 1e-9) { sx = ux[t]; sy = uy[t]; sz = uz[t]; ln = 1; }
            nrm[o] = sx / ln; nrm[o + 1] = sy / ln; nrm[o + 2] = sz / ln;
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
                     spec: material(src.c),
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
      gl.uniform2f(uSpec, p.spec[0], p.spec[1]);
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

  var dragging = false, dragId = -1, lastX = 0, lastY = 0;

  if (!reduce) {
    window.addEventListener("pointermove", function (e) {
      if (dragging) return;              // the drag owns the camera while it lasts
      // A quarter turn across the window, and a much smaller lift: pitching as
      // far as it yaws puts the camera under the floor.
      yawT = -0.62 + (e.clientX / window.innerWidth - 0.5) * 0.85;
      pitchT = 0.30 + (e.clientY / window.innerHeight - 0.5) * 0.34;
      request();
    }, { passive: true });

    // Drag the robot to turn it. The pointer-follow above is ambient -- it
    // moves whether or not you meant it to -- and this is the part that is
    // actually yours: grab the machine and it goes where you put it, and
    // stays there until you let go and the ambient aim eases back in.
    canvas.style.pointerEvents = "auto";
    canvas.style.cursor = "grab";
    // Nothing about a rendered arm says you can take hold of it. immersive.js
    // puts this word inside the ring while the pointer is over it.
    canvas.setAttribute("data-cur", "drag");

    canvas.addEventListener("pointerdown", function (e) {
      dragging = true; dragId = e.pointerId;
      lastX = e.clientX; lastY = e.clientY;
      canvas.style.cursor = "grabbing";
      if (canvas.setPointerCapture) canvas.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    canvas.addEventListener("pointermove", function (e) {
      if (!dragging || e.pointerId !== dragId) return;
      // Straight to the value, not to the target: a drag that eases feels
      // like the object is on a spring rather than in your hand.
      yaw = yawT = yaw - (e.clientX - lastX) * 0.007;
      pitch = pitchT = Math.max(-0.25, Math.min(0.95, pitch + (e.clientY - lastY) * 0.005));
      lastX = e.clientX; lastY = e.clientY;
      dirty = true; request();
    });
    function endDrag(e) {
      if (!dragging || (e && e.pointerId !== dragId)) return;
      dragging = false; dragId = -1;
      canvas.style.cursor = "grab";
    }
    canvas.addEventListener("pointerup", endDrag);
    canvas.addEventListener("pointercancel", endDrag);
  }

  var rt;
  window.addEventListener("resize", function () {
    clearTimeout(rt);
    rt = setTimeout(function () { if (resize()) { dirty = true; request(); } }, 150);
  });
})();
