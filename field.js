/* A faint field of drifting points behind the hero headline. Not a generic
 * particle effect: three slow repellers push the points around exactly the
 * way an artificial-potential-field local planner steers around obstacles
 * -- the same shape of problem the Measured section below benchmarks DWA,
 * MPPI and TEB against.
 *
 * Canvas 2D, not WebGL: a few dozen soft points don't need a fragment
 * shader, and a 2D context is one less thing that can fail to acquire a
 * GPU context. Enhancement only -- prefers-reduced-motion leaves the
 * canvas blank, and a browser without canvas support just skips this file.
 */
(function () {
  "use strict";

  var canvas = document.querySelector(".hero__field");
  if (!canvas || !canvas.getContext) return;
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  var hero = document.getElementById("intro");
  var ctx = canvas.getContext("2d");

  function hexToRgb(hex) {
    var h = hex.replace("#", "").trim();
    if (h.length === 3) h = h.split("").map(function (c) { return c + c; }).join("");
    var n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  // The real token, not a second copy of its hex -- if landing.css's accent
  // ever moves, this follows it instead of quietly going stale.
  var accentHex = getComputedStyle(document.documentElement).getPropertyValue("--landing-accent").trim();
  var rgb = hexToRgb(accentHex || "#ff8a5c");

  // One soft dot, pre-rendered once. Drawing an image per particle per
  // frame is far cheaper than a fresh radial gradient or a shadowBlur.
  var SPRITE = 28;
  var sprite = document.createElement("canvas");
  sprite.width = sprite.height = SPRITE;
  (function () {
    var g = sprite.getContext("2d");
    var r = SPRITE / 2;
    var grad = g.createRadialGradient(r, r, 0, r, r, r);
    grad.addColorStop(0, "rgba(" + rgb.join(",") + ",0.85)");
    grad.addColorStop(1, "rgba(" + rgb.join(",") + ",0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, SPRITE, SPRITE);
  })();

  var dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  var w = 0, h = 0, particles = [], repellers = [], raf = null, last = 0;

  function spawn() { return { x: Math.random() * w, y: Math.random() * h, vx: 0, vy: 0 }; }

  function seed() {
    var count = Math.max(30, Math.min(110, Math.round((w * h) / 9000)));
    particles = [];
    for (var i = 0; i < count; i++) particles.push(spawn());
    repellers = [{ phase: 0 }, { phase: 2.1 }, { phase: 4.2 }];
  }

  function resize() {
    var r = hero.getBoundingClientRect();
    w = r.width; h = r.height;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    seed();
  }

  function step(dt, t) {
    // Slow, out-of-phase loops -- smooth wandering with no noise function.
    for (var i = 0; i < repellers.length; i++) {
      var r = repellers[i];
      r.cx = w * 0.5 + Math.cos(t * 0.00012 + r.phase) * w * 0.32;
      r.cy = h * 0.5 + Math.sin(t * 0.00017 + r.phase * 1.3) * h * 0.32;
    }
    var damp = Math.pow(0.90, dt);
    for (var j = 0; j < particles.length; j++) {
      var p = particles[j];
      var ax = 6, ay = -3; // a gentle prevailing drift, up and to the right
      for (var k = 0; k < repellers.length; k++) {
        var rp = repellers[k];
        var dx = p.x - rp.cx, dy = p.y - rp.cy;
        var d2 = dx * dx + dy * dy + 2500; // softened: finite push even at the centre
        var d = Math.sqrt(d2);
        var f = 900000 / d2;
        ax += (dx / d) * f; ay += (dy / d) * f;
      }
      p.vx = (p.vx + ax * dt) * damp;
      p.vy = (p.vy + ay * dt) * damp;
      var sp = Math.sqrt(p.vx * p.vx + p.vy * p.vy), max = 70;
      if (sp > max) { p.vx = (p.vx / sp) * max; p.vy = (p.vy / sp) * max; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.x < -20) p.x = w + 20; else if (p.x > w + 20) p.x = -20;
      if (p.y < -20) p.y = h + 20; else if (p.y > h + 20) p.y = -20;
    }
  }

  function draw() {
    ctx.clearRect(0, 0, w, h);
    ctx.globalCompositeOperation = "lighter";
    var half = SPRITE / 2;
    for (var i = 0; i < particles.length; i++) {
      ctx.drawImage(sprite, particles[i].x - half, particles[i].y - half);
    }
  }

  function frame(t) {
    var dt = Math.min(last ? (t - last) / 1000 : 1 / 60, 0.05);
    last = t;
    step(dt, t);
    draw();
    raf = requestAnimationFrame(frame);
  }

  function start() { if (raf == null) { last = 0; raf = requestAnimationFrame(frame); } }
  function stop() { if (raf != null) { cancelAnimationFrame(raf); raf = null; } }

  document.addEventListener("visibilitychange", function () {
    if (document.hidden) stop(); else start();
  });

  var resizeTimer;
  window.addEventListener("resize", function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resize, 150);
  });

  resize();
  start();
})();
