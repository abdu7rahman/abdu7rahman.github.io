/* The object in the hero: the real UR12e, running a real move as you scroll.
 *
 * shader.se puts a rendered machine in the fog and animates the page around
 * it. This is that, except the machine is the robot these repos actually
 * drive: Universal Robots' own triangles from assets/ur12e.json, placed by
 * link transforms that tools/bake_hero_arm.py computed with the same
 * kinematics the demo page runs. Scrolling scrubs the trajectory. Nothing
 * here solves anything -- it multiplies vertices by matrices it was handed.
 *
 * Canvas 2D with a painter's sort, the approach demo.js already uses: there
 * is no depth buffer, so triangles are filled far-to-near.
 *
 * It draws only when the picture would actually differ -- a new scroll
 * position, a new pointer target, or a camera still easing toward one. Eleven
 * thousand fills plus thirty-three thousand vertex transforms is far too much
 * to spend on a frame identical to the last one.
 *
 * Enhancement only: no JS, no canvas, or a fetch that fails and the hero is
 * the type on the fog, which is what it was before this file existed.
 */
(function () {
  "use strict";

  if (!document.body || !document.body.classList.contains("home")) return;

  var probe = document.createElement("canvas");
  if (!probe.getContext || !probe.getContext("2d")) return;

  var reduce = window.matchMedia &&
               window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var accent = getComputedStyle(document.documentElement)
    .getPropertyValue("--landing-accent").trim() || "#ff8a5c";
  var ember = hexToRgb(accent);

  function hexToRgb(hex) {
    var h = hex.replace("#", "").trim();
    if (h.length === 3) h = h.split("").map(function (c) { return c + c; }).join("");
    var n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  var canvas = document.createElement("canvas");
  canvas.className = "hero__arm";
  canvas.setAttribute("aria-hidden", "true");
  var g = canvas.getContext("2d");

  //: Which links are the gripper. They get the emissive treatment: the tool is
  //: the part of a robot that is doing the work, and it is what the eye should
  //: land on.
  var TOOL_FIRST = 7;
  //: Roughly half the standing height of the posed arm, in metres.
  var Z_MID = 0.46;

  var links = null;     // [{parts:[{c, v:Float32Array, f, world:Float32Array}]}]
  var motion = null;    // {frames, T:[flat 10x12], tool:[[x,y,z]]}
  var radius = 1;

  Promise.all([
    fetch("assets/ur12e.json").then(function (r) { if (!r.ok) throw 0; return r.json(); }),
    fetch("assets/hero-motion.json").then(function (r) { if (!r.ok) throw 0; return r.json(); })
  ]).then(function (both) {
    build(both[0]);
    motion = both[1];
    // Into the hero, not the body: the canvas is positioned against the
    // section it belongs to.
    var hero = document.getElementById("intro");
    (hero || document.body).appendChild(canvas);
    resize();
    request();
  }).catch(function () { /* the hero stands without it */ });

  function build(m) {
    var u = m.unit;
    links = [];
    var maxR = 0;
    for (var i = 0; i < m.links.length; i++) {
      var parts = [];
      for (var p = 0; p < m.links[i].parts.length; p++) {
        var src = m.links[i].parts[p];
        var v = new Float32Array(src.v.length);
        for (var k = 0; k < src.v.length; k++) v[k] = src.v[k] * u;
        parts.push({ c: src.c, v: v, f: src.f, world: new Float32Array(v.length) });
      }
      links.push({ parts: parts });
    }
    // Framed on the reach of the whole move rather than of one pose, so the
    // robot does not swell and shrink as it extends. Both numbers are of the
    // trajectory, not of the mesh: the vertices are in link frames here and
    // say nothing about where the arm ends up.
    radius = 0.95;
  }

  /* ---- the frame the scroll is asking for ------------------------------ */
  // The move plays out over the hero and is finished by the end of it. That
  // bound is not a taste call: the arm is fixed and covers the right 54% of
  // the window, and every section below the hero runs prose into that half.
  // Letting it live past the hero would put a lit robot behind body text at
  // partial opacity, which is a contrast problem no palette can fix. The hero
  // is given the height to make the scrub worth having instead.
  // Measured off the hero rather than off a guessed multiple of the viewport,
  // so the runway is whatever the hero actually is at this width and the arm
  // is always gone by the time the hero's bottom edge clears the screen.
  // The move plays out over the hero's own height, so it is finished about
  // when the hero has finished leaving. No fade: the canvas is bounded by the
  // hero and scrolls off with it, which is the whole reason it can be drawn at
  // full strength for as long as it is on screen.
  function run() {
    var hero = document.getElementById("intro");
    return Math.max(1, hero ? hero.offsetHeight : window.innerHeight);
  }
  function progress() {
    var p = window.scrollY / run();
    return p < 0 ? 0 : p > 1 ? 1 : p;
  }

  var M = new Float32Array(120);   // ten 3x4s for the frame being drawn
  function poseAt(p) {
    var n = motion.frames;
    var f = p * (n - 1);
    var i = Math.floor(f);
    if (i >= n - 1) { i = n - 2; f = n - 1; }
    var t = f - i;
    var a = motion.T[i], b = motion.T[i + 1];
    for (var k = 0; k < 120; k++) M[k] = a[k] + (b[k] - a[k]) * t;
    var ta = motion.tool[i], tb = motion.tool[i + 1];
    return [ta[0] + (tb[0] - ta[0]) * t,
            ta[1] + (tb[1] - ta[1]) * t,
            ta[2] + (tb[2] - ta[2]) * t];
  }

  /* ---- camera ---------------------------------------------------------- */
  var yaw = -0.62, pitch = 0.30, yawT = yaw, pitchT = pitch;
  var W = 0, H = 0, dpr = 1;

  function resize() {
    var r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = r.width; H = r.height;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    return true;
  }

  var scratch = [];
  function draw() {
    if (!links || !motion || !W || !H) return;
    var tool = poseAt(progress());
    g.clearRect(0, 0, W, H);

    var cy = Math.cos(yaw), sy = Math.sin(yaw);
    var cp = Math.cos(pitch), sp = Math.sin(pitch);
    var dist = radius * 4.2;
    var f = Math.min(W, H) * 1.30;
    var ox = W * 0.5, oz = H * 0.5;

    scratch.length = 0;
    for (var li = 0; li < links.length; li++) {
      var o = li * 12;
      var emissive = li >= TOOL_FIRST;
      var ps = links[li].parts;
      for (var pi = 0; pi < ps.length; pi++) {
        var part = ps[pi], v = part.v, w = part.world, fi = part.f, col = part.c;
        // link frame -> base_link
        for (var k = 0; k < v.length; k += 3) {
          var x = v[k], y = v[k + 1], z = v[k + 2];
          w[k]     = M[o]     * x + M[o + 1] * y + M[o + 2]  * z + M[o + 3];
          w[k + 1] = M[o + 4] * x + M[o + 5] * y + M[o + 6]  * z + M[o + 7];
          w[k + 2] = M[o + 8] * x + M[o + 9] * y + M[o + 10] * z + M[o + 11];
        }
        for (var t2 = 0; t2 < fi.length; t2 += 3) {
          var i0 = fi[t2] * 3, i1 = fi[t2 + 1] * 3, i2 = fi[t2 + 2] * 3;
          var ok = true, dsum = 0;
          var PX = _px, PY = _py, RX = _rx, RY = _ry, RZ = _rz;
          var idx = [i0, i1, i2];
          for (var vi = 0; vi < 3; vi++) {
            var q = idx[vi];
            // base_link has its origin at the floor of the robot, so the whole
            // arm sits above it; drop the eye to the middle of the machine or
            // it hangs in the top of the panel.
            var wx = w[q], wy = w[q + 1], wz = w[q + 2] - Z_MID;
            var x1 = wx * cy - wy * sy, y1 = wx * sy + wy * cy;
            var y2 = y1 * cp - wz * sp, z2 = y1 * sp + wz * cp;
            RX[vi] = x1; RY[vi] = y2; RZ[vi] = z2;
            var dep = y2 + dist;
            if (dep < 0.05) { ok = false; break; }
            PX[vi] = ox + f * x1 / dep;
            PY[vi] = oz - f * z2 / dep;
            dsum += dep;
          }
          if (!ok) continue;
          var ax = RX[1] - RX[0], ay = RY[1] - RY[0], az = RZ[1] - RZ[0];
          var bx = RX[2] - RX[0], by = RY[2] - RY[0], bz = RZ[2] - RZ[0];
          var nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
          var nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
          scratch.push([dsum / 3, PX[0], PY[0], PX[1], PY[1], PX[2], PY[2],
                        nx / nl, ny / nl, nz / nl, col, emissive]);
        }
      }
    }
    scratch.sort(function (a, b) { return b[0] - a[0]; });

    // The tool's own light, laid down before the robot so the gripper sits
    // inside the glow rather than on top of a disc.
    var tp = project(tool, cy, sy, cp, sp, dist, f, ox, oz);
    if (tp) {
      var rad = Math.min(W, H) * 0.30;
      var grd = g.createRadialGradient(tp[0], tp[1], 0, tp[0], tp[1], rad);
      grd.addColorStop(0, "rgba(" + ember.join(",") + ",0.30)");
      grd.addColorStop(1, "rgba(" + ember.join(",") + ",0)");
      g.fillStyle = grd;
      g.fillRect(tp[0] - rad, tp[1] - rad, rad * 2, rad * 2);
    }

    var lx = -0.55, ly = -0.45, lz = 0.70;
    for (var j = 0; j < scratch.length; j++) {
      var s = scratch[j];
      var lam = s[7] * lx + s[8] * ly + s[9] * lz;
      if (lam < 0) lam = 0;
      var rim = 1 - Math.abs(s[8]);
      rim = rim * rim * rim;
      var c = s[10];
      var base = 0.20 + 0.92 * lam;
      var glow = s[11] ? 0.75 : 0.0;    // the gripper carries its own light
      var r = c[0] * base + ember[0] * (rim * 0.95 + glow);
      var gg2 = c[1] * base + ember[1] * (rim * 0.95 + glow);
      var b2 = c[2] * base + ember[2] * (rim * 0.95 + glow);
      g.fillStyle = "rgb(" + (r > 255 ? 255 : r | 0) + ","
                           + (gg2 > 255 ? 255 : gg2 | 0) + ","
                           + (b2 > 255 ? 255 : b2 | 0) + ")";
      g.beginPath();
      g.moveTo(s[1], s[2]); g.lineTo(s[3], s[4]); g.lineTo(s[5], s[6]);
      g.closePath();
      g.fill();
    }
  }

  var _px = [0, 0, 0], _py = [0, 0, 0], _rx = [0, 0, 0], _ry = [0, 0, 0], _rz = [0, 0, 0];

  function project(p, cy, sy, cp, sp, dist, f, ox, oz) {
    var pz = p[2] - Z_MID;
    var x1 = p[0] * cy - p[1] * sy, y1 = p[0] * sy + p[1] * cy;
    var y2 = y1 * cp - pz * sp, z2 = y1 * sp + pz * cp;
    var dep = y2 + dist;
    if (dep < 0.05) return null;
    return [ox + f * x1 / dep, oz - f * z2 / dep];
  }

  /* ---- when to redraw --------------------------------------------------- */
  var raf = null, lastScroll = -1, dirty = true;

  function tick() {
    raf = null;
    var dy = yawT - yaw, dp = pitchT - pitch;
    yaw += dy * 0.08;
    pitch += dp * 0.08;
    var moving = Math.abs(dy) > 1e-4 || Math.abs(dp) > 1e-4;
    if (dirty || moving) {
      draw();
      dirty = false;
    }
    if (moving) request();
  }
  function request() {
    if (raf == null) raf = requestAnimationFrame(tick);
  }

  window.addEventListener("scroll", function () {
    if (window.scrollY === lastScroll) return;
    lastScroll = window.scrollY;
    dirty = true;
    request();
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
