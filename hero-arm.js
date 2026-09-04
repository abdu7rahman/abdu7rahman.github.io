/* The object in the hero: the real UR12e, posed once by tools/bake_hero_arm.py
 * and drawn here.
 *
 * shader.se puts a rendered machine in the fog and lets the type sit beside
 * it. This is that, except the machine is the robot these repos actually
 * drive, and its triangles are Universal Robots' own -- not a prop, and not a
 * screenshot of the demo page either.
 *
 * Canvas 2D with a painter's sort, the same approach demo.js uses: there is no
 * depth buffer, so triangles are filled far-to-near. Ten thousand fills is a
 * few milliseconds, which is far too much to spend every frame for something
 * that is barely moving -- so it redraws only while the camera is actually
 * travelling, and costs nothing at rest.
 *
 * Enhancement only: no JS, no canvas, or prefers-reduced-motion and the hero
 * is the type on the fog, which is what it was before this file existed.
 */
(function () {
  "use strict";

  var host = document.querySelector("[data-hero-arm]");
  if (!host || !host.getContext) return;
  var g = host.getContext("2d");
  if (!g) return;

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

  var tris = null;       // {x,y,z} triples flattened, per triangle, with colour
  var radius = 1;

  fetch("assets/hero-arm.json").then(function (r) {
    if (!r.ok) throw new Error(r.status);
    return r.json();
  }).then(function (m) {
    build(m);
    resize();
    kick();
  }).catch(function () { /* the hero is fine without it */ });

  function build(m) {
    var u = m.unit;
    tris = [];
    var maxR = 0;
    for (var p = 0; p < m.parts.length; p++) {
      var part = m.parts[p];
      var v = part.v, f = part.f, c = part.c;
      for (var i = 0; i < f.length; i += 3) {
        var a = f[i] * 3, b = f[i + 1] * 3, d = f[i + 2] * 3;
        var t = [v[a] * u, v[a + 1] * u, v[a + 2] * u,
                 v[b] * u, v[b + 1] * u, v[b + 2] * u,
                 v[d] * u, v[d + 1] * u, v[d + 2] * u, c];
        tris.push(t);
        for (var k = 0; k < 9; k += 3) {
          var r2 = t[k] * t[k] + t[k + 1] * t[k + 1] + t[k + 2] * t[k + 2];
          if (r2 > maxR) maxR = r2;
        }
      }
    }
    radius = Math.sqrt(maxR) || 1;
  }

  // Camera. Yaw turns the robot on the spot, pitch lifts the eye; both ease
  // toward a target the pointer sets, so the object turns to follow the
  // reader instead of spinning on a timer.
  var yaw = -0.62, pitch = 0.30, yawT = yaw, pitchT = pitch;
  var W = 0, H = 0, dpr = 1;

  function resize() {
    var r = host.getBoundingClientRect();
    if (!r.width || !r.height) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = r.width; H = r.height;
    host.width = Math.round(W * dpr);
    host.height = Math.round(H * dpr);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function draw() {
    if (!tris || !W || !H) return;
    g.clearRect(0, 0, W, H);

    var cy = Math.cos(yaw), sy = Math.sin(yaw);
    var cp = Math.cos(pitch), sp = Math.sin(pitch);
    // Framed off the model's own radius rather than a fixed zoom, so the
    // robot keeps its margins at any panel size instead of growing out of
    // the canvas on a wide window.
    var dist = radius * 4.2;
    var f = Math.min(W, H) * 1.30;
    var ox = W * 0.5, oz = H * 0.5;

    // Project once per triangle into a scratch list, carrying depth and a
    // shade, then sort. Sorting the projected list rather than the source
    // keeps the source untouched between frames.
    var out = [];
    for (var i = 0; i < tris.length; i++) {
      var t = tris[i];
      var sx = 0, sYs = 0, dsum = 0, ok = true;
      var px = [0, 0, 0], py = [0, 0, 0];
      var rx = [0, 0, 0], ry = [0, 0, 0], rz = [0, 0, 0];
      for (var v = 0; v < 3; v++) {
        var x = t[v * 3], y = t[v * 3 + 1], z = t[v * 3 + 2];
        var x1 = x * cy - y * sy, y1 = x * sy + y * cy;
        var y2 = y1 * cp - z * sp, z2 = y1 * sp + z * cp;
        rx[v] = x1; ry[v] = y2; rz[v] = z2;
        var dep = y2 + dist;
        if (dep < 0.05) { ok = false; break; }
        px[v] = ox + f * x1 / dep;
        py[v] = oz - f * z2 / dep;
        dsum += dep;
      }
      if (!ok) continue;

      // Face normal in camera space, for a flat shade plus a rim term.
      var ax = rx[1] - rx[0], ay = ry[1] - ry[0], az = rz[1] - rz[0];
      var bx = rx[2] - rx[0], by = ry[2] - ry[0], bz = rz[2] - rz[0];
      var nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
      var nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      nx /= nl; ny /= nl; nz /= nl;
      out.push([dsum / 3, px[0], py[0], px[1], py[1], px[2], py[2], nx, ny, nz, t[9]]);
    }
    out.sort(function (a, b) { return b[0] - a[0]; });

    // Key light from the upper left and slightly behind, which is what puts
    // the warm edge down the side of the arm that faces the headline.
    var lx = -0.55, ly = -0.45, lz = 0.70;
    for (var j = 0; j < out.length; j++) {
      var o = out[j];
      var nX = o[7], nY = o[8], nZ = o[9], col = o[10];
      var lam = nX * lx + nY * ly + nZ * lz;
      if (lam < 0) lam = 0;
      // Rim: faces turning away from the camera catch the ember.
      var rim = 1 - Math.abs(nY);
      rim = rim * rim * rim;
      // The robot has to survive being the only lit thing on a near-black
      // field. The ambient term is what keeps the shadowed side from going to
      // silhouette, and the rim is what gives it the edge the fog reads
      // against. Both live in the right half, where no text sits, so this is
      // free of the contrast budget the type spends.
      var base = 0.20 + 0.92 * lam;
      var r = col[0] * base + ember[0] * rim * 0.95;
      var gg = col[1] * base + ember[1] * rim * 0.95;
      var b = col[2] * base + ember[2] * rim * 0.95;
      g.fillStyle = "rgb(" + (r > 255 ? 255 : r | 0) + ","
                           + (gg > 255 ? 255 : gg | 0) + ","
                           + (b > 255 ? 255 : b | 0) + ")";
      g.beginPath();
      g.moveTo(o[1], o[2]); g.lineTo(o[3], o[4]); g.lineTo(o[5], o[6]);
      g.closePath();
      g.fill();
    }
  }

  // Redraw only while the camera is still travelling. At rest this file costs
  // nothing at all, which is the whole reason it can afford ten thousand fills
  // when it does run.
  var raf = null;
  function step() {
    var dy = yawT - yaw, dp = pitchT - pitch;
    yaw += dy * 0.08;
    pitch += dp * 0.08;
    draw();
    if (Math.abs(dy) > 1e-4 || Math.abs(dp) > 1e-4) {
      raf = requestAnimationFrame(step);
    } else {
      raf = null;
    }
  }
  function kick() {
    if (raf == null) raf = requestAnimationFrame(step);
  }

  if (!reduce) {
    window.addEventListener("pointermove", function (e) {
      // A quarter turn across the window, and a much smaller lift: pitching
      // as far as it yaws puts the camera under the floor.
      yawT = -0.62 + (e.clientX / window.innerWidth - 0.5) * 0.85;
      pitchT = 0.30 + (e.clientY / window.innerHeight - 0.5) * 0.34;
      kick();
    }, { passive: true });
  }

  var t;
  window.addEventListener("resize", function () {
    clearTimeout(t);
    t = setTimeout(function () { resize(); draw(); }, 150);
  });
})();
