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
      if (!reduce) (hero || document.body).appendChild(handle);
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


  /* ---- kinematics -------------------------------------------------------
     The same six joint origins the baked motion was computed from:
     config/ur12e/default_kinematics.yaml in Universal_Robots_ROS2_Description,
     which is byte-identical to the UR10e's because the UR12e is a payload
     variant of it. Copied out of predictive_replanning.ur12e rather than
     re-derived, and checked against the bake: recomputing frame 0 of
     assets/hero-motion.json from these lands within 4.7e-06 of the stored
     values, which is float32 storage precision.

     Everything below is 3x4 row-major, the same layout the baked frames use,
     so one shape flows from here to the shader. */
  var ORIGINS = [
    [1,0,0,0, 0,1,0,0, 0,0,1,0.1807],
    [1,0,0,0, 0,-2.051034285e-10,-1,0, 0,1,-2.051034285e-10,0],
    [1,0,0,-0.6127, 0,1,0,0, 0,0,1,0],
    [1,0,0,-0.57155, 0,1,0,0, 0,0,1,0.17415],
    [1,0,0,0, 0,-2.051034285e-10,-1,-0.11985, 0,1,-2.051034285e-10,0],
    [1,-1.224646799e-16,1.224646799e-16,0, -1.224646799e-16,-2.05103551e-10,1,0.11655,
     -1.224646799e-16,-1,-2.05103551e-10,0]
  ];
  //: wrist_3 -> tool0. The flange and tool0 rotations cancel to identity; it
  //: is kept as a matrix because that is what it is, not because it does work.
  var FLANGE = [1,0,0,0, 0,1,0,0, 0,0,1,0];
  //: Gripper origin to the point between the fingertips, down tool0's z.
  var TCP_Z = 0.1565;
  //: Where the arm sits when nothing is asking it for anything -- KEYS[0] of
  //: tools/bake_hero_arm.py, so posing starts from the pose the scroll ends at.
  var REST = [0.52, -1.02, 1.3, -1.86, -1.57, 0];

  function mul34(a, b, out) {
    for (var r = 0; r < 3; r++) {
      var a0 = a[r * 4], a1 = a[r * 4 + 1], a2 = a[r * 4 + 2], a3 = a[r * 4 + 3];
      out[r * 4]     = a0 * b[0] + a1 * b[4] + a2 * b[8];
      out[r * 4 + 1] = a0 * b[1] + a1 * b[5] + a2 * b[9];
      out[r * 4 + 2] = a0 * b[2] + a1 * b[6] + a2 * b[10];
      out[r * 4 + 3] = a0 * b[3] + a1 * b[7] + a2 * b[11] + a3;
    }
    return out;
  }
  var _rz = [1,0,0,0, 0,1,0,0, 0,0,1,0];
  function rotz(t) {
    var c = Math.cos(t), s = Math.sin(t);
    _rz[0] = c; _rz[1] = -s; _rz[4] = s; _rz[5] = c;
    return _rz;
  }

  var joints = [];                       // six joint frames, base -> wrist_3
  for (var _j = 0; _j < 6; _j++) joints.push(new Float64Array(12));
  var _acc = new Float64Array(12), _tmp = new Float64Array(12);
  var tool = new Float64Array(12);
  var tcp = [0, 0, 0];

  //: Joint angles and gripper opening, when the arm is being posed rather
  //: than played back.
  var q = REST.slice(), grip = 0.0, posed = false;

  function forward(out) {
    // base_link_inertia is the identity; the mesh is already in that frame.
    for (var k = 0; k < 12; k++) out[k] = 0;
    out[0] = out[5] = out[10] = 1;
    var cur = _acc;
    for (var k2 = 0; k2 < 12; k2++) cur[k2] = 0;
    cur[0] = cur[5] = cur[10] = 1;
    for (var i = 0; i < 6; i++) {
      mul34(cur, ORIGINS[i], _tmp);
      mul34(_tmp, rotz(q[i]), joints[i]);
      cur = joints[i];
      for (var m = 0; m < 12; m++) out[(i + 1) * 12 + m] = cur[m];
    }
    mul34(cur, FLANGE, tool);
    for (var m2 = 0; m2 < 12; m2++) out[7 * 12 + m2] = tool[m2];
    // Both fingers are baked closed and slide the same way along tool0's x.
    var slide = [1,0,0,grip, 0,1,0,0, 0,0,1,0];
    mul34(tool, slide, _tmp);
    for (var m3 = 0; m3 < 12; m3++) { out[8 * 12 + m3] = _tmp[m3]; out[9 * 12 + m3] = _tmp[m3]; }
    // The point between the fingertips, which is what the handle sits on.
    tcp[0] = tool[3]  + tool[2]  * TCP_Z;
    tcp[1] = tool[7]  + tool[6]  * TCP_Z;
    tcp[2] = tool[11] + tool[10] * TCP_Z;
  }

  /* ---- inverse kinematics -----------------------------------------------
     Damped least squares. A revolute chain hands its own Jacobian over for
     free once the frames are known -- column i is the joint axis crossed with
     the vector from that joint to the tool -- so there is no numeric
     differencing here and no six extra forward passes per iteration.

     Damped rather than a plain pseudo-inverse because the arm has to stay
     usable when you drag the handle somewhere it cannot reach: near a
     singularity an undamped solve asks for an enormous joint step and the
     robot snaps. The damping trades a little tracking error for a bounded
     one, which is the right way round for something you are holding.

     Three equations, six unknowns, so the solution is a whole subspace. The
     null-space term spends that freedom pulling gently back toward the rest
     pose, which is what stops the elbow drifting into a fold that tracks the
     point perfectly and looks nothing like a robot. */
  var LAMBDA2 = 0.02, REST_PULL = 0.12, MAX_STEP = 0.22;

  function solve(tx, ty, tz) {
    var Jx = [0,0,0,0,0,0], Jy = [0,0,0,0,0,0], Jz = [0,0,0,0,0,0], i;
    for (i = 0; i < 6; i++) {
      var f = joints[i];
      var ax = f[2], ay = f[6], az = f[10];              // joint axis, world
      var dx = tcp[0] - f[3], dy = tcp[1] - f[7], dz = tcp[2] - f[11];
      Jx[i] = ay * dz - az * dy;
      Jy[i] = az * dx - ax * dz;
      Jz[i] = ax * dy - ay * dx;
    }
    // A = J Jt + lambda^2 I, symmetric 3x3
    function dot(a, b) { var s = 0; for (var k = 0; k < 6; k++) s += a[k] * b[k]; return s; }
    var a11 = dot(Jx,Jx) + LAMBDA2, a12 = dot(Jx,Jy), a13 = dot(Jx,Jz);
    var a22 = dot(Jy,Jy) + LAMBDA2, a23 = dot(Jy,Jz), a33 = dot(Jz,Jz) + LAMBDA2;
    var c11 = a22*a33 - a23*a23, c12 = a13*a23 - a12*a33, c13 = a12*a23 - a13*a22;
    var det = a11*c11 + a12*c12 + a13*c13;
    if (Math.abs(det) < 1e-12) return false;
    var c22 = a11*a33 - a13*a13, c23 = a13*a12 - a11*a23, c33 = a11*a22 - a12*a12;
    function solve3(bx, by, bz, o) {
      o[0] = (c11*bx + c12*by + c13*bz) / det;
      o[1] = (c12*bx + c22*by + c23*bz) / det;
      o[2] = (c13*bx + c23*by + c33*bz) / det;
    }
    var w = [0, 0, 0];
    solve3(tx - tcp[0], ty - tcp[1], tz - tcp[2], w);
    var dq = [0,0,0,0,0,0];
    for (i = 0; i < 6; i++) dq[i] = Jx[i]*w[0] + Jy[i]*w[1] + Jz[i]*w[2];

    // (I - J+ J) b, the part of the rest pull that does not move the tool
    var b = [0,0,0,0,0,0];
    for (i = 0; i < 6; i++) b[i] = (REST[i] - q[i]) * REST_PULL;
    var w2 = [0, 0, 0];
    solve3(dot(Jx,b), dot(Jy,b), dot(Jz,b), w2);
    for (i = 0; i < 6; i++) dq[i] += b[i] - (Jx[i]*w2[0] + Jy[i]*w2[1] + Jz[i]*w2[2]);

    var big = 0;
    for (i = 0; i < 6; i++) big = Math.max(big, Math.abs(dq[i]));
    var k = big > MAX_STEP ? MAX_STEP / big : 1;
    for (i = 0; i < 6; i++) q[i] += dq[i] * k;
    return true;
  }

  //: Enough passes that a drag lands where you put it within a frame, few
  //: enough that the whole thing is a rounding error next to drawing 21000
  //: triangles. Each pass is six cross products and one 3x3 solve.
  function reach(tx, ty, tz, M) {
    for (var n = 0; n < 8; n++) {
      forward(M);
      if (!solve(tx, ty, tz)) break;
    }
    forward(M);
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
    // Carry the angles alongside the frames, so the moment a reader takes hold
    // of the tool the solver starts from the configuration already on screen.
    if (motion.q) {
      var qa = motion.q[i], qb = motion.q[i + 1];
      for (var j = 0; j < 6; j++) q[j] = qa[j] + (qb[j] - qa[j]) * t;
      grip = qa[6] + (qb[6] - qa[6]) * t;
    }
    toolPoint(M);
  }

  //: Where the fingertips are, read back out of whichever pose is current.
  function toolPoint(src) {
    var o = 7 * 12;
    tcp[0] = src[o + 3]  + src[o + 2]  * TCP_Z;
    tcp[1] = src[o + 7]  + src[o + 6]  * TCP_Z;
    tcp[2] = src[o + 11] + src[o + 10] * TCP_Z;
  }

  /* ---- camera ----------------------------------------------------------- */
  var yaw = -0.62, pitch = 0.30, yawT = yaw, pitchT = pitch;
  var W = 0, H = 0;
  var view = new Float32Array(16), proj = new Float32Array(16);
  var fov = 0.62;

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
    var near = 0.1, far = 20.0;
    var f = 1 / Math.tan(fov / 2);
    proj[0] = f / aspect; proj[1] = 0; proj[2] = 0; proj[3] = 0;
    proj[4] = 0; proj[5] = f; proj[6] = 0; proj[7] = 0;
    proj[8] = 0; proj[9] = 0; proj[10] = (far + near) / (near - far); proj[11] = -1;
    proj[12] = 0; proj[13] = 0; proj[14] = 2 * far * near / (near - far); proj[15] = 0;
  }

  /* ---- the handle -------------------------------------------------------
     RViz's interactive marker, which is the thing this is: a handle on the
     tool, and dragging it asks the solver for a pose that puts the tool
     there. Orbiting is still the background -- drag the robot itself and the
     camera turns, drag the handle and the robot moves -- which is the same
     division of labour MoveIt uses.

     The handle is a DOM element rather than more geometry in the scene. It
     has to stay crisp at any size, take a pointer without a depth test, and
     match the ring the page already draws for a cursor; all three are free in
     CSS and all three are work in WebGL. */
  var _eye = [0, 0, 0];
  function project(p) {
    var x = p[0], y = p[1], z = p[2] - Z_MID;
    _eye[0] = view[0] * x + view[4] * y + view[8]  * z + view[12];
    _eye[1] = view[1] * x + view[5] * y + view[9]  * z + view[13];
    _eye[2] = view[2] * x + view[6] * y + view[10] * z + view[14];
    var w = -_eye[2];
    if (w < 0.01) return null;
    return [(proj[0] * _eye[0] / w * 0.5 + 0.5) * W,
            (0.5 - proj[5] * _eye[1] / w * 0.5) * H, w];
  }

  function draw() {
    if (!parts.length || !motion || !W || !H) return;
    // Posed by hand, or still playing the move the scroll scrubs. Once a
    // reader has taken hold of the tool the arm is theirs and stays where they
    // put it -- an interactive marker that springs back the moment you let go
    // is not a marker, it is a toy.
    if (posed) forward(M); else poseAt(progress());
    camera();
    placeHandle();
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

  /* The handle, and posing by it. */
  var handle = document.createElement("button");
  handle.type = "button";
  handle.className = "hero__grip";
  handle.setAttribute("data-cur", "pose");
  handle.setAttribute("aria-label",
    "Move the robot's tool. Drag, or use the arrow keys.");
  handle.hidden = true;

  function placeHandle() {
    if (reduce) return;
    var s = project(tcp);
    if (!s) { handle.hidden = true; return; }
    handle.hidden = false;
    // project() gives pixels inside the canvas; the handle is positioned
    // against the hero, and the canvas is only the right half of it. Both
    // share the hero as their offset parent, so its own offset is the whole
    // correction.
    handle.style.transform = "translate3d(" + (canvas.offsetLeft + s[0]) + "px," +
                                              (canvas.offsetTop + s[1]) + "px,0)";
  }

  var posing = false, poseId = -1, goal = [0, 0, 0];
  //: Screen pixels to metres, on the plane through the tool that faces the
  //: camera. The view matrix holds the camera's own axes in its rows, and at
  //: eye depth d one pixel spans 2*d*tan(fov/2)/H.
  function nudge(dx, dy) {
    var s = project(tcp);
    if (!s) return;
    var k = 2 * s[2] * Math.tan(fov / 2) / Math.max(1, H);
    goal[0] += (view[0] * dx - view[1] * dy) * k;
    goal[1] += (view[4] * dx - view[5] * dy) * k;
    goal[2] += (view[8] * dx - view[9] * dy) * k;
    reach(goal[0], goal[1], goal[2], M);
    dirty = true; request();
  }

  function takeHold() {
    if (!posed) { posed = true; goal[0] = tcp[0]; goal[1] = tcp[1]; goal[2] = tcp[2]; }
  }

  handle.addEventListener("pointerdown", function (e) {
    if (reduce) return;
    posing = true; poseId = e.pointerId;
    takeHold();
    lastX = e.clientX; lastY = e.clientY;
    if (handle.setPointerCapture) handle.setPointerCapture(e.pointerId);
    handle.classList.add("is-held");
    e.preventDefault(); e.stopPropagation();
  });
  handle.addEventListener("pointermove", function (e) {
    if (!posing || e.pointerId !== poseId) return;
    nudge(e.clientX - lastX, e.clientY - lastY);
    lastX = e.clientX; lastY = e.clientY;
    e.stopPropagation();
  });
  function letGo(e) {
    if (!posing || (e && e.pointerId !== poseId)) return;
    posing = false; handle.classList.remove("is-held");
    if (handle.releasePointerCapture && e) {
      try { handle.releasePointerCapture(e.pointerId); } catch (err) { /* gone */ }
    }
  }
  handle.addEventListener("pointerup", letGo);
  handle.addEventListener("pointercancel", letGo);
  // Reachable without a pointer at all.
  handle.addEventListener("keydown", function (e) {
    var step = e.shiftKey ? 24 : 8, dx = 0, dy = 0;
    if (e.key === "ArrowLeft") dx = -step;
    else if (e.key === "ArrowRight") dx = step;
    else if (e.key === "ArrowUp") dy = -step;
    else if (e.key === "ArrowDown") dy = step;
    else return;
    takeHold();
    nudge(dx, dy);
    e.preventDefault();
  });

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
