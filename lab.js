/* The three vendored demos.

   Everything above this file on the page fetches its Python from GitHub as it
   loads. These three cannot: the repositories are private, so the modules are
   copied into vendor/ with a PROVENANCE.md recording the commit and a SHA-256
   per file, and the page says so rather than implying a live fetch.

   The runtime is lab-worker.js, and it does not start until the reader presses
   something in one of these sections. scipy and pydantic are 12 MB between
   them; a visitor who came for the nav demos should not pay for that.

   Draws in CSS pixels via the same fitCanvas contract demo.js uses -- see the
   comment at the top of that file for why the backing store follows the
   element instead of being authored at a fixed width. */
(function () {
  "use strict";

  function fitCanvas(cv, wideAspect, narrowAspect) {
    var w = Math.max(280, Math.round(cv.getBoundingClientRect().width));
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var h = Math.round(w * (w < 640 ? narrowAspect : wideAspect));
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    cv._w = w;
    cv._h = h;
    cv._narrow = w < 640;
    cv.getContext("2d").setTransform(dpr, 0, 0, dpr, 0, 0);
    return cv;
  }

  var css = getComputedStyle(document.documentElement);
  function tok(n, fb) { return (css.getPropertyValue(n) || fb).trim(); }
  var INK = tok("--ink", "#1d1d1f"),
      INK2 = tok("--ink-2", "#424245"),
      INK3 = tok("--ink-3", "#6e6e73"),
      RULE = tok("--rule", "#e8e8ed"),
      RULE2 = tok("--rule-2", "#d2d2d7"),
      PAPER3 = tok("--paper-3", "#ffffff"),
      SIGNAL = tok("--signal", "#d70015"),
      ACCENT = tok("--accent", "#007a3d"),
      SUN = tok("--sun", "#ff9500");

  var logEl = document.getElementById("log");
  function log(msg, cls) {
    if (!logEl) return;
    logEl.textContent += "\n" + (cls === "err" ? "!! " : cls === "ok" ? " > " : "   ") + msg;
    logEl.scrollTop = logEl.scrollHeight;
  }
  function live(id) {
    var el = document.getElementById(id);
    if (el) el.classList.add("is-live");
  }

  var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- the shared runtime ---------------------------------------
     One worker, three demos, booted on first demand. Every caller gets a
     promise for "ready"; the handlers below are registered once and dispatch
     on message type, because two of these demos can be waiting at once. */
  var runtime = (function () {
    // Handlers are a list per type, not one: `failed` has three subscribers,
    // and a map of single functions silently kept only the last one.
    var worker = null, booting = null, handlers = {};

    function ensure() {
      if (booting) return booting;
      booting = new Promise(function (resolve, reject) {
        try {
          worker = new Worker("lab-worker.js");
        } catch (e) {
          reject(new Error("worker blocked: " + e.message));
          return;
        }
        worker.onmessage = function (ev) {
          var m = ev.data || {};
          if (m.type === "log") { log(m.msg, m.cls); return; }
          if (m.type === "ready") { resolve(); return; }
          (handlers[m.type] || []).forEach(function (fn) { fn(m); });
        };
        worker.onerror = function (e) { reject(new Error(e.message || "worker error")); };
        worker.postMessage({ cmd: "boot" });
      });
      // A boot that never completes has to reach the three sections, or their
      // run buttons sit on "Running..." for as long as the tab is open. The
      // failure is broadcast in the same shape the worker sends one, so each
      // section's existing handler releases its own controls.
      booting.catch(function (e) {
        log("vendored runtime: " + e.message, "err");
        (handlers.failed || []).forEach(function (fn) {
          fn({ type: "failed", cmd: "boot", msg: e.message });
        });
      });
      return booting;
    }

    return {
      on: function (type, fn) { (handlers[type] = handlers[type] || []).push(fn); },
      send: function (msg) {
        return ensure().then(function () { worker.postMessage(msg); },
                             function () { /* already reported by the catch above */ });
      }
    };
  })();

  function b64bytes(s) {
    var bin = atob(s), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  /* ---------- 1. quadruped-learned-cost --------------------------------
     One course out of the benchmark's own suite, one feature stack, and
     qlc.eval.benchmark.run_episode per cost model -- the repository's control
     loop, not a paraphrase of it: A* replanning every replan_period ticks,
     DWA every tick, the stuck counter that stops a painted-in stack being
     recorded as bad luck.

     The physics switch is the interesting control. It puts FALL_RATE back to
     0.5 and the ice drag back to 0.95, which is the surrogate as first
     written, before a MuJoCo cross-check measured both. That reconstruction
     is the repository's actual finding and the reason its first results table
     was withdrawn.
     ------------------------------------------------------------------- */
  var terrain = (function () {
    var cv = document.getElementById("qlc-canvas");
    if (!cv) return { init: function () {} };
    fitCanvas(cv, 0.52, 1.12);
    var g = cv.getContext("2d");
    var readEl = document.getElementById("qlc-read");
    var tableEl = document.getElementById("qlc-table");
    var runBtn = document.getElementById("qlc-run");

    // Ground truth colours. Ice reads cool and pale on purpose: it is the one
    // surface that looks like clean floor to a depth camera, which is the
    // whole reason an occupancy costmap cannot represent it.
    var MATERIAL = [
      [216, 216, 221],   // 0 smooth
      [201, 214, 195],   // 1 grass
      [205, 201, 192],   // 2 gravel
      [230, 220, 192],   // 3 sand
      [176, 158, 134],   // 4 mud
      [201, 224, 236],   // 5 ice
      [190, 181, 172],   // 6 rubble
      [29, 29, 31]       // 7 wall
    ];
    /* All four cost functions, plus the ceiling. The first four take the hues
       the repository's own figures give them -- red, orange, blue, green -- so
       a reader holding this next to its README is looking at the same colours.
       The oracle is dashed rather than a fifth hue, because it is a privileged
       ceiling and not a candidate, and the table under the plate names every
       row for anyone the four hues do not separate. */
    var STACKS = [
      { key: "nav2_inflation", label: "nav2_inflation", col: SIGNAL },
      { key: "reactive", label: "reactive", col: SUN },
      { key: "learned", label: "learned", col: "#2a6ebb", baked: true },
      { key: "irl", label: "irl", col: ACCENT, baked: true },
      { key: "oracle", label: "oracle (ceiling)", col: INK2, dashed: true }
    ];
    var LAYOUTS = ["ice_shortcut", "mud_field", "stair_bench", "rubble_slalom", "mixed"];

    function specFor(key) {
      for (var i = 0; i < STACKS.length; i++) if (STACKS[i].key === key) return STACKS[i];
      return STACKS[0];
    }

    var course = null, plate = null, costPlates = {}, episodes = [], token = 0;
    var view = "terrain", layout = 0, physics = "calibrated";
    var raf = null, t0 = 0, busy = false, speed = 4;

    function plateFrom(shade, material) {
      var n = course.rows * course.cols;
      var img = new ImageData(course.cols, course.rows);
      for (var i = 0; i < n; i++) {
        var c = MATERIAL[material[i]] || MATERIAL[0];
        // Elevation as a +/-14% lightness ramp on the material's own colour.
        // Relief has to read without competing with the material, because the
        // material is the thing geometry cannot see.
        var k = 0.86 + 0.28 * (shade[i] / 255);
        img.data[i * 4] = Math.min(255, c[0] * k);
        img.data[i * 4 + 1] = Math.min(255, c[1] * k);
        img.data[i * 4 + 2] = Math.min(255, c[2] * k);
        img.data[i * 4 + 3] = 255;
      }
      return img;
    }

    function costPlate(bytes) {
      var n = course.rows * course.cols;
      var img = new ImageData(course.cols, course.rows);
      for (var i = 0; i < n; i++) {
        var v = bytes[i] / 255;
        img.data[i * 4] = 255 - 140 * v;
        img.data[i * 4 + 1] = 255 - 210 * v;
        img.data[i * 4 + 2] = 255 - 200 * v;
        img.data[i * 4 + 3] = 255;
      }
      return img;
    }

    // The plate is drawn from an offscreen canvas at grid resolution and
    // scaled up, rather than one fillRect per cell: 57,600 rects a frame is
    // the difference between 60 fps and a slideshow on a phone.
    function bake(img) {
      var off = document.createElement("canvas");
      off.width = course.cols; off.height = course.rows;
      off.getContext("2d").putImageData(img, 0, 0);
      return off;
    }

    /* The course is square and the plate is not, so the leftover is given to
       the legend rather than to white space. On a narrow canvas there is no
       leftover, and the legend is dropped: eight rows of material physics
       under a 320 px plate would push the plate off the screen. */
    function geom() {
      var pad = 10;
      var legend = cv._narrow ? 0 : Math.min(232, cv._w * 0.24);
      var side = Math.min(cv._w - pad * 2 - legend, cv._h - pad * 2);
      return { x: pad, y: (cv._h - side) / 2, side: side, legend: legend,
               m: side / (course.cols * course.resolution) };
    }

    function drawLegend(q) {
      if (!q.legend || !course.materials) return;
      var x = q.x + q.side + 18, y = q.y + 14;
      var mono = tok("--mono", "monospace");
      g.font = "500 10px " + mono;
      g.fillStyle = INK3;
      g.fillText("MATERIAL_TRUTH", x, y);
      // Right-aligned, so the two columns stay inside the plate whatever the
      // legend width works out to at this canvas size.
      g.textAlign = "right";
      g.fillText("drag", x + q.legend - 64, y);
      g.fillText("traction", x + q.legend - 6, y);
      g.textAlign = "left";
      y += 8;
      course.materials.forEach(function (m) {
        y += 19;
        var c = MATERIAL[m.value] || MATERIAL[0];
        g.fillStyle = "rgb(" + c[0] + "," + c[1] + "," + c[2] + ")";
        g.fillRect(x, y - 9, 11, 11);
        g.strokeStyle = RULE2; g.lineWidth = 1;
        g.strokeRect(x + .5, y - 8.5, 10, 10);
        // Ice is the row the physics switch moves, so it is the row that gets
        // the accent when it is not carrying its measured value.
        var moved = m.name === "ice" && m.drag !== 0.3;
        g.fillStyle = moved ? SIGNAL : INK2;
        g.font = (moved ? "600 " : "400 ") + "11px " + tok("--sans", "sans-serif");
        g.fillText(m.name, x + 17, y);
        g.font = "400 11px " + mono;
        g.textAlign = "right";
        g.fillText(m.drag.toFixed(2), x + q.legend - 64, y);
        g.fillText(m.traction.toFixed(2), x + q.legend - 6, y);
        g.textAlign = "left";
      });
      y += 26;
      g.font = "400 10.5px " + mono;
      g.fillStyle = INK3;
      g.fillText("FALL_RATE " + course.physics.fall_rate, x, y);
      g.fillText(course.physics.fall_rate ? "as first written" : "measured, zero", x, y + 14);
    }

    function draw(now) {
      g.clearRect(0, 0, cv._w, cv._h);
      if (!course) return;
      var q = geom();
      var img = view === "terrain" ? plate : costPlates[view];
      if (img) {
        g.imageSmoothingEnabled = false;
        g.drawImage(img, q.x, q.y, q.side, q.side);
        g.imageSmoothingEnabled = true;
      }
      g.strokeStyle = RULE2; g.lineWidth = 1;
      g.strokeRect(q.x + .5, q.y + .5, q.side - 1, q.side - 1);
      drawLegend(q);

      /* Screen y runs the same way the grid's rows do. The terrain plate is an
         ImageData whose row 0 is drawn at the top, and the course's own
         convention is `row = y / resolution` -- so world y increases *down*
         the plate, exactly as it does in the repository's own renderer
         (`qlc/cli/render.py:draw_path`, and the figures in its README).

         This read the other way round at first: paths and markers were drawn
         y-up over a y-down map, which mirrors the two against each other. The
         robots appeared to walk through walls and the start marker sat inside
         one. Same episodes, same outcomes -- 0 wall cells under the path when
         the material map is sampled the way the course defines it, 40 when it
         is sampled mirrored. It was only ever the drawing. */
      function px(x, y) { return [q.x + x * q.m, q.y + y * q.m]; }

      var sc = course.resolution;
      var sp = px(course.start[1] * sc, course.start[0] * sc);
      var gp = px(course.goal[1] * sc, course.goal[0] * sc);

      for (var i = 0; i < episodes.length; i++) {
        var ep = episodes[i];
        var spec = specFor(ep.stack);
        // The global plan the cost field produced, before anything drove it.
        if (ep.plan.length) {
          g.save();
          g.globalAlpha = .22; g.setLineDash([5, 4]);
          g.strokeStyle = spec.col; g.lineWidth = 1.2;
          g.beginPath();
          for (var j = 0; j < ep.plan.length; j++) {
            var p = px(ep.plan[j][0], ep.plan[j][1]);
            if (j === 0) g.moveTo(p[0], p[1]); else g.lineTo(p[0], p[1]);
          }
          g.stroke(); g.restore();
        }
        var upto = ep.poses.length;
        if (now !== null && !reduced) {
          upto = Math.min(ep.poses.length, Math.floor((now - t0) / 1000 / ep.dt * speed) + 1);
        }
        g.save();
        g.strokeStyle = spec.col; g.lineWidth = spec.dashed ? 1.6 : 2.2;
        g.lineJoin = "round";
        if (spec.dashed) { g.setLineDash([7, 5]); g.globalAlpha = .55; }
        g.beginPath();
        for (var k = 0; k < upto; k++) {
          var w = px(ep.poses[k][0], ep.poses[k][1]);
          if (k === 0) g.moveTo(w[0], w[1]); else g.lineTo(w[0], w[1]);
        }
        g.stroke();
        g.restore();
        var last = ep.poses[Math.max(0, upto - 1)];
        if (last) {
          var b = px(last[0], last[1]);
          g.save();
          // Positive canvas rotation is +x toward +y, and world yaw is +x toward
          // +y as well now that the plate is not flipped, so the sign follows.
          g.translate(b[0], b[1]); g.rotate(last[2]);
          g.fillStyle = spec.col;
          // The Go2's own footprint, 0.70 x 0.31 m, at the plate's scale.
          g.fillRect(-0.35 * q.m, -0.155 * q.m, 0.70 * q.m, 0.31 * q.m);
          g.fillStyle = PAPER3;
          g.fillRect(0.20 * q.m, -0.05 * q.m, 0.10 * q.m, 0.10 * q.m);
          g.restore();
          if (upto >= ep.poses.length && ep.outcome !== "success") {
            g.strokeStyle = INK; g.lineWidth = 2;
            g.beginPath();
            g.moveTo(b[0] - 7, b[1] - 7); g.lineTo(b[0] + 7, b[1] + 7);
            g.moveTo(b[0] + 7, b[1] - 7); g.lineTo(b[0] - 7, b[1] + 7);
            g.stroke();
          }
        }
      }

      g.fillStyle = INK;
      g.beginPath(); g.arc(sp[0], sp[1], 5, 0, 6.2832); g.fill();
      g.strokeStyle = INK; g.lineWidth = 2;
      g.beginPath(); g.arc(gp[0], gp[1], 7, 0, 6.2832); g.stroke();
      g.beginPath(); g.arc(gp[0], gp[1], 2.5, 0, 6.2832); g.fill();

      g.font = "500 11px " + tok("--mono", "monospace");
      g.fillStyle = INK3;
      g.fillText(course.name + "  ·  " + course.cols + "×" + course.rows +
                 " cells at " + course.resolution + " m", q.x + 8, q.y + q.side - 9);
    }

    function animate(now) {
      draw(now);
      var done = episodes.every(function (ep) {
        return (now - t0) / 1000 / ep.dt * speed >= ep.poses.length;
      });
      if (!done) raf = requestAnimationFrame(animate); else { raf = null; draw(null); }
    }

    function renderTable() {
      if (!tableEl) return;
      var rows = episodes.map(function (ep) {
        var spec = specFor(ep.stack);
        var ratio = ep.optimal_length && ep.path_length
          ? (ep.path_length / ep.optimal_length).toFixed(2) + "×" : "—";
        return '<tr><th scope="row"><i class="kx" style="background:' + spec.col +
               '"></i>' + spec.label + "</th>" +
               '<td class="' + (ep.outcome === "success" ? "" : "is-bad") + '">' +
               ep.outcome.replace(/_/g, " ") + "</td>" +
               "<td>" + ep.sim_time + " s</td>" +
               "<td>" + ep.path_length + " m</td>" +
               "<td>" + ratio + "</td>" +
               "<td>" + ep.min_clearance + " m</td>" +
               "<td>" + ep.plan_time_ms + " / " + ep.control_time_ms + "</td></tr>";
      }).join("");
      tableEl.innerHTML =
        "<thead><tr><th scope=\"col\">stack</th><th scope=\"col\">outcome</th>" +
        "<th scope=\"col\">sim time</th><th scope=\"col\">path</th>" +
        "<th scope=\"col\">vs optimal</th><th scope=\"col\">clearance</th>" +
        "<th scope=\"col\">plan / ctrl ms</th></tr></thead><tbody>" + rows + "</tbody>";
    }

    /* Every control goes down together, not just the run button. Leaving the
       course and physics pickers live during a run meant a press changed the
       highlight and then did nothing, because the handler declined to start a
       second run -- the selection said one thing and the plate showed
       another. Disabled is the honest state for a control that cannot act. */
    function setBusy(on, label) {
      busy = on;
      if (runBtn) { runBtn.disabled = on; runBtn.textContent = label; }
      document.querySelectorAll("[data-qlc-layout],[data-qlc-physics]").forEach(function (b) {
        b.disabled = on;
      });
    }

    function run() {
      if (busy) return;
      token++;
      episodes = []; costPlates = {}; course = null; plate = null; view = "terrain";
      document.querySelectorAll("[data-qlc-view]").forEach(function (b) {
        b.classList.toggle("is-on", b.getAttribute("data-qlc-view") === "terrain");
      });
      if (raf) { cancelAnimationFrame(raf); raf = null; }
      setBusy(true, "Running…");
      if (readEl) readEl.textContent = "booting the runtime · this takes a minute the first time";
      runtime.send({
        cmd: "qlc", token: token, index: layout, physics: physics,
        stacks: STACKS.map(function (s) { return s.key; })
      });
    }

    runtime.on("qlc-course", function (m) {
      if (m.token !== token) return;
      course = m.course;
      plate = bake(plateFrom(b64bytes(course.shade), b64bytes(course.material)));
      live("qlc-canvas");
      draw(null);
      var p = course.physics;
      if (readEl) {
        readEl.textContent = course.name + " · FALL_RATE " + p.fall_rate +
          " · ice drag " + p.ice_drag + ", traction " + p.ice_traction +
          " · planning…";
      }
      log("qlc: " + course.name + " prepared, " + course.cols + "x" + course.rows +
          " cells; FALL_RATE " + p.fall_rate + ", ice drag " + p.ice_drag, "ok");
    });

    runtime.on("qlc-episode", function (m) {
      if (m.token !== token) return;
      var ep = m.episode;
      episodes.push(ep);
      costPlates[ep.stack] = bake(costPlate(b64bytes(ep.cost)));
      log("qlc: " + ep.stack + " -> " + ep.outcome + ", " + ep.steps + " ticks, " +
          ep.path_length + " m, " + ep.replans + " replans (" + ep.wall_ms + " ms here)",
          ep.outcome === "success" ? "ok" : "err");
      renderTable();
      draw(null);
    });

    runtime.on("qlc-done", function (m) {
      if (m.token !== token) return;
      setBusy(false, "Run the course");
      // Playback is scaled so the longest of the three finishes in about
      // twelve seconds. A fixed multiple made the oracle's 88 s wander a
      // twenty-two-second wait for a plate that had already stopped changing.
      var longest = Math.max.apply(null, episodes.map(function (e) {
        return e.poses.length * e.dt;
      }));
      speed = Math.max(3, longest / 12);
      t0 = performance.now();
      if (raf) cancelAnimationFrame(raf);
      // Under reduced motion the routes are simply there. Starting the loop
      // anyway would spin a frame callback for twelve seconds over a plate
      // that already shows its final state.
      if (reduced) draw(null); else raf = requestAnimationFrame(animate);
      var slipped = episodes.filter(function (e) { return e.outcome !== "success"; });
      if (readEl) {
        readEl.textContent = course.name + " · " + (episodes.length - slipped.length) +
          " of " + episodes.length + " reached the goal" +
          (slipped.length ? " · " + slipped.map(function (e) {
            return e.stack + " " + e.outcome;
          }).join(", ") : "");
      }
    });

    runtime.on("failed", function (m) {
      if (m.cmd !== "boot" && m.token !== token) return;
      setBusy(false, "Run the course");
      if (readEl) readEl.textContent = "the runtime failed: " + m.msg;
    });

    function init() {
      if (runBtn) runBtn.addEventListener("click", run);
      document.querySelectorAll("[data-qlc-layout]").forEach(function (b) {
        b.addEventListener("click", function () {
          layout = LAYOUTS.indexOf(b.getAttribute("data-qlc-layout"));
          document.querySelectorAll("[data-qlc-layout]").forEach(function (o) {
            o.classList.toggle("is-on", o === b);
            o.setAttribute("aria-checked", o === b ? "true" : "false");
          });
          if (!busy) run();
        });
      });
      document.querySelectorAll("[data-qlc-physics]").forEach(function (b) {
        b.addEventListener("click", function () {
          physics = b.getAttribute("data-qlc-physics");
          document.querySelectorAll("[data-qlc-physics]").forEach(function (o) {
            o.classList.toggle("is-on", o === b);
            o.setAttribute("aria-checked", o === b ? "true" : "false");
          });
          if (!busy) run();
        });
      });
      document.querySelectorAll("[data-qlc-view]").forEach(function (b) {
        b.addEventListener("click", function () {
          var want = b.getAttribute("data-qlc-view");
          if (want !== "terrain" && !costPlates[want]) return;
          view = want;
          document.querySelectorAll("[data-qlc-view]").forEach(function (o) {
            o.classList.toggle("is-on", o === b);
          });
          draw(null);
        });
      });
    }
    return { init: init };
  })();

  /* ---------- 2. orchestrated-bimanual-assembly ------------------------
     oba.sim.rollout.rollout, driving oba.sim.expert against oba.sim.plant and
     scoring with oba.sim.success -- all four the repository's own.

     The plant is analytic. Its own docstring says it is not a simulator and
     must never produce a reported number, and the repository enforces that
     with a type rather than a convention: PhaseGate.measured_by has no member
     that could describe it. So what this section shows is controller logic --
     the phase machine, the latches, the force band -- and the page says that
     in as many words. Every success rate the project reports is read from
     Isaac Sim, and none of them are on this page.
     ------------------------------------------------------------------- */
  var assembly = (function () {
    var cv = document.getElementById("oba-canvas");
    if (!cv) return { init: function () {} };
    // Tall on a phone because the two views stack there, and each still has to
    // carry a 26 px axis gutter and the threshold gauge above the data.
    fitCanvas(cv, 0.36, 1.5);
    var g = cv.getContext("2d");
    var readEl = document.getElementById("oba-read");
    var runBtn = document.getElementById("oba-run");

    var run = null, frame = 0, raf = null, task = "connector_insertion", seed = 0, busy = false;
    var token = 0, t0 = 0;

    // The plant's own rate: WorldState.sim_time_s is step / 50, so an episode
    // plays back on the clock it was integrated on and nothing is sped up. It
    // was advancing two frames per animation frame before, which put a
    // 105-step episode on screen for about a second -- eight phases inside
    // eight hundred milliseconds, which is a flicker rather than a
    // demonstration.
    var PLANT_HZ = 50;

    // Board frame, metres. Fixed rather than fitted to the episode so the two
    // tasks are drawn at the same scale and a wire that leaves the board reads
    // as leaving the board.
    var X0 = -0.15, X1 = 0.15, Y0 = -0.14, Y1 = 0.11, Z0 = -0.01, Z1 = 0.24;

    function panels() {
      var pad = 14, gap = 16;
      var w = (cv._w - pad * 2 - gap) / 2;
      if (cv._narrow) {
        var h = (cv._h - pad * 2 - gap) / 2;
        return [{ x: pad, y: pad, w: cv._w - pad * 2, h: h },
                { x: pad, y: pad + h + gap, w: cv._w - pad * 2, h: h }];
      }
      return [{ x: pad, y: pad, w: w, h: cv._h - pad * 2 },
              { x: pad + w + gap, y: pad, w: w, h: cv._h - pad * 2 }];
    }

    var INSET = 26;   // room for the axis ticks inside each panel

    function proj(p, box, mode) {
      var u = (p[0] - X0) / (X1 - X0);
      var v = mode === "top" ? (p[1] - Y0) / (Y1 - Y0) : (p[2] - Z0) / (Z1 - Z0);
      // `top` is how much of the panel is spoken for above the data: the
      // caption on the left plate, the caption plus the threshold gauge on
      // the right one. Without it the gauge sits on top of the plot and hides
      // whichever arm happens to be parked high.
      var top = box.top || 22;
      return [box.x + INSET + u * (box.w - INSET - 12),
              box.y + box.h - INSET - v * (box.h - INSET - top)];
    }

    function label(box, text) {
      g.font = "500 10.5px " + tok("--mono", "monospace");
      g.fillStyle = INK3;
      g.fillText(text, box.x + 12, box.y + 15);
    }

    /* A 5 cm graticule with the board frame's own origin marked. There is no
       board outline: the repository does not publish the ATB's extent, and an
       invented rectangle would be the only drawn thing on the plate that is
       not a number out of the module. */
    function graticule(box, mode) {
      g.font = "400 9px " + tok("--mono", "monospace");
      g.strokeStyle = RULE; g.lineWidth = 1;
      var lo = mode === "top" ? Y0 : Z0, hi = mode === "top" ? Y1 : Z1;
      for (var x = -0.15; x <= 0.1501; x += 0.05) {
        var a = proj([x, lo, lo], box, mode), b = proj([x, hi, hi], box, mode);
        g.globalAlpha = Math.abs(x) < 1e-9 ? 1 : .55;
        g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
        g.globalAlpha = 1;
        g.fillStyle = INK3;
        g.fillText(Math.round(x * 100), a[0] - 5, box.y + box.h - 10);
      }
      for (var v = Math.ceil(lo / 0.05) * 0.05; v <= hi + 1e-9; v += 0.05) {
        var c = proj([X0, v, v], box, mode), d = proj([X1, v, v], box, mode);
        g.globalAlpha = Math.abs(v) < 1e-9 ? 1 : .55;
        g.beginPath(); g.moveTo(c[0], c[1]); g.lineTo(d[0], d[1]); g.stroke();
        g.globalAlpha = 1;
        g.fillStyle = INK3;
        g.fillText(Math.round(v * 100), box.x + 6, c[1] + 3);
      }
      g.fillStyle = INK3;
      g.fillText("cm", box.x + 6, box.y + box.h - 10);
    }

    // Where each end effector has been, up to the frame on screen. The phase
    // machine is a sequence and a single dot cannot show a sequence.
    function trail(box, mode, side, colour) {
      var upto = Math.min(frame, run.frames.length - 1);
      if (upto < 2) return;
      g.strokeStyle = colour; g.lineWidth = 1.2; g.globalAlpha = .38;
      g.beginPath();
      for (var i = 0; i <= upto; i += 2) {
        var q = proj(run.frames[i][side], box, mode);
        if (i === 0) g.moveTo(q[0], q[1]); else g.lineTo(q[0], q[1]);
      }
      g.stroke(); g.globalAlpha = 1;
    }

    function panel(box, mode, f) {
      g.fillStyle = PAPER3;
      g.strokeStyle = RULE; g.lineWidth = 1;
      g.beginPath();
      if (g.roundRect) g.roundRect(box.x + .5, box.y + .5, box.w - 1, box.h - 1, 8);
      else g.rect(box.x + .5, box.y + .5, box.w - 1, box.h - 1);
      g.fill(); g.stroke();
      graticule(box, mode);
      label(box, mode === "top" ? "board frame, from above  (x, y)"
                                : "board frame, from the side  (x, z)");
      if (!f) return;

      var spec = run.spec;
      trail(box, mode, "right", SIGNAL);
      trail(box, mode, "left", SUN);
      // The board surface, in the side view only: everything sits on z = 0.02
      // and "pressed into the board" is a claim about that line.
      if (mode === "side") {
        var a = proj([X0, 0, 0.019], box, mode), b = proj([X1, 0, 0.019], box, mode);
        g.strokeStyle = RULE2; g.setLineDash([3, 3]); g.lineWidth = 1;
        g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
        g.setLineDash([]);
      }

      if (task === "wire_routing") {
        var pts = [];
        for (var i = 0; i < spec.n_wire_links; i++) {
          var p = f.bodies[spec.prefix + String(i).padStart(3, "0")];
          if (p) pts.push(proj(p, box, mode));
        }
        g.strokeStyle = INK2; g.lineWidth = 2.4; g.lineJoin = "round";
        g.beginPath();
        pts.forEach(function (p, i) { if (i === 0) g.moveTo(p[0], p[1]); else g.lineTo(p[0], p[1]); });
        g.stroke();
        spec.clips.forEach(function (name) {
          var c = f.bodies[name];
          if (!c) return;
          var q = proj(c, box, mode);
          g.strokeStyle = ACCENT; g.lineWidth = 2;
          g.beginPath(); g.arc(q[0], q[1], 6, 0, 6.2832); g.stroke();
        });
      } else {
        var sock = f.bodies[spec.socket], conn = f.bodies[spec.connector];
        if (sock) {
          var s = proj(sock, box, mode);
          g.strokeStyle = ACCENT; g.lineWidth = 2;
          g.strokeRect(s[0] - 9, s[1] - 6, 18, 12);
        }
        if (conn) {
          var c2 = proj(conn, box, mode);
          g.fillStyle = INK;
          g.fillRect(c2[0] - 7, c2[1] - 4, 14, 8);
        }
      }

      [["right", SIGNAL], ["left", SUN]].forEach(function (pair) {
        var p = f[pair[0]];
        if (!p) return;
        var q = proj(p, box, mode);
        var closed = f.width[pair[0] === "right" ? 0 : 1] < 0.01;
        g.strokeStyle = pair[1]; g.lineWidth = 2.2;
        g.beginPath(); g.arc(q[0], q[1], 8, 0, 6.2832); g.stroke();
        // The two finger pads, drawn apart when the gripper is open and shut
        // when it is not, so a closed-on-nothing grasp is visible as a state
        // rather than only as a word in the readout.
        var d = closed ? 2.5 : 6;
        g.beginPath();
        g.moveTo(q[0] - d, q[1] - 11); g.lineTo(q[0] - d, q[1] - 4);
        g.moveTo(q[0] + d, q[1] - 11); g.lineTo(q[0] + d, q[1] - 4);
        g.stroke();
      });
    }

    /* The detector's own thresholds, drawn to scale. On insertion this is the
       band the whole task lives inside -- a connector resting on a socket and
       one seated in it are millimetres apart in position and an order of
       magnitude apart here, which is why position alone is not a detector. */
    function gauge(box, f) {
      var spec = run.spec;
      var x = box.x + INSET, w = box.w - INSET - 14, y = box.y + 34, h = 9;
      var mono = tok("--mono", "monospace");
      // Opaque, because on a narrow plate this band sits over the top of the
      // plot and a threshold tick crossing a graticule line reads as data.
      g.fillStyle = PAPER3;
      g.fillRect(box.x + 1, y - 16, box.w - 2, 40);
      g.font = "400 9.5px " + mono;
      if (task === "connector_insertion") {
        g.fillStyle = "#f2f2f5";
        g.fillRect(x, y, w, h);
        var scale = w / spec.max_force_n;
        [["min", spec.min_reaction_force_n], ["nominal", spec.nominal_seating_force_n],
         ["back off", spec.backoff_force_n], ["jam", spec.max_force_n]].forEach(function (t) {
          var tx = x + t[1] * scale;
          g.strokeStyle = RULE2; g.lineWidth = 1;
          g.beginPath(); g.moveTo(tx, y - 3); g.lineTo(tx, y + h + 3); g.stroke();
          g.fillStyle = INK3;
          g.fillText(t[0], Math.min(tx + 3, x + w - 34), y - 5);
        });
        var force = f ? f.force[0] : 0;
        g.fillStyle = force > spec.backoff_force_n ? SIGNAL
                    : force >= spec.min_reaction_force_n ? ACCENT : INK3;
        g.fillRect(x, y, Math.min(w, force * scale), h);
        g.fillStyle = INK2;
        g.fillText(force.toFixed(1) + " N on the right gripper", x, y + h + 14);
      } else {
        var occ = f && f.detail ? (f.detail.occupied_clips || 0) : 0;
        g.fillStyle = INK3;
        g.fillText("clips occupied", x, y + 8);
        for (var i = 0; i < spec.clips.length; i++) {
          var cx = x + 88 + i * 20;
          g.beginPath(); g.arc(cx, y + 4, 6, 0, 6.2832);
          if (i < occ) { g.fillStyle = ACCENT; g.fill(); }
          else { g.strokeStyle = RULE2; g.lineWidth = 1.5; g.stroke(); }
        }
        g.fillStyle = INK3;
        g.fillText("peak " + (f && f.detail ? (f.detail.peak_occupied_clips || 0) : 0) +
                   " · tension " + (f && f.detail ? (f.detail.tension_n || 0).toFixed(1) : "0.0") +
                   " N, needs " + spec.tension_min_n, x, y + 24);
      }
    }

    /* Eight phase names do not fit one row on a phone, so the ladder wraps.
       Measured first and drawn second, because the panels above have to give
       back exactly the height it needs -- a ladder that wraps into space that
       was not reserved gets clipped by the canvas edge. */
    function ladderRows() {
      g.font = "500 10.5px " + tok("--mono", "monospace");
      var limit = cv._w - 14, x = 14, rows = 1;
      (run ? run.spec.phases : []).forEach(function (name) {
        var w = g.measureText(name).width + 14;
        if (x + w > limit) { rows++; x = 14; }
        x += w + 5;
      });
      return rows;
    }

    function ladder(f) {
      var rows = ladderRows();
      var limit = cv._w - 14;
      var y = cv._h - 8 - (rows - 1) * 22;
      var x = 14;
      run.spec.phases.forEach(function (name) {
        var on = f && f.phase === name;
        var w = g.measureText(name).width + 14;
        if (x + w > limit) { x = 14; y += 22; }
        g.fillStyle = on ? INK : "transparent";
        g.strokeStyle = on ? INK : RULE2; g.lineWidth = 1;
        g.beginPath();
        if (g.roundRect) g.roundRect(x, y - 15, w, 16, 8); else g.rect(x, y - 15, w, 16);
        if (on) g.fill();
        g.stroke();
        g.fillStyle = on ? PAPER3 : INK3;
        g.fillText(name, x + 7, y - 4);
        x += w + 5;
      });
    }

    function draw() {
      g.clearRect(0, 0, cv._w, cv._h);
      if (!run) return;
      var f = run.frames[Math.min(frame, run.frames.length - 1)];
      var box = panels();
      // The phase ladder runs along the bottom, so both panels give it back
      // -- the lower one in the stacked layout, both in the side-by-side.
      var strip = ladderRows() * 22 + 6;
      box[1].h -= strip;
      if (!cv._narrow) box[0].h -= strip;
      box[0].top = 22;
      box[1].top = 62;
      panel(box[0], "top", f);
      panel(box[1], "side", f);
      gauge(box[1], f);
      ladder(f);
    }

    function animate(now) {
      if (!run) return;
      frame = reduced ? run.frames.length
                      : Math.floor((now - t0) / 1000 * PLANT_HZ);
      if (frame >= run.frames.length) {
        frame = run.frames.length - 1;
        draw(); readout(true); raf = null;
        return;
      }
      draw(); readout(false);
      raf = requestAnimationFrame(animate);
    }

    function readout(done) {
      if (!readEl) return;
      var f = run.frames[Math.min(frame, run.frames.length - 1)];
      var spec = run.spec;
      var bits = ["step " + f.step + " / " + run.steps + "  (" + f.t.toFixed(2) +
                  " s at the plant's 50 Hz)",
                  "phase " + (f.phase || "—"),
                  "right " + f.grasp[0] + ", left " + f.grasp[1],
                  "progress " + Math.round(f.progress * 100) + "%"];
      if (task === "connector_insertion") {
        bits.splice(3, 0, "force " + f.force[0].toFixed(1) + " N  (seats above " +
                    spec.min_reaction_force_n + ", backs off at " + spec.backoff_force_n +
                    ", jams at " + spec.max_force_n + ")");
      } else {
        var occ = f.detail && f.detail.occupied_clips;
        bits.splice(3, 0, "clips occupied " + (occ === undefined ? "—" : occ) + " of " +
                    spec.clips.length + (spec.require_ordered ? ", order enforced" : ""));
      }
      if (done) {
        // Two different success criteria, so two different sentences. One of
        // them used to be printed for both, which read as the wire being
        // "seated and held" -- a claim the wire detector never makes.
        bits.push(run.success
          ? (task === "connector_insertion"
              ? "detector: seated for " + spec.hold_steps + " consecutive steps above " +
                spec.min_reaction_force_n + " N"
              : "detector: every clip occupied, in order, still occupied " +
                spec.settle_steps + " steps after both arms let go")
          : "detector: " + run.reason.replace(/_/g, " "));
      }
      readEl.textContent = bits.join(" · ");
    }

    function setBusy(on, label) {
      busy = on;
      if (runBtn) { runBtn.disabled = on; runBtn.textContent = label; }
      document.querySelectorAll("[data-oba-task]").forEach(function (b) { b.disabled = on; });
    }

    function start() {
      if (busy) return;
      token++;
      setBusy(true, "Running…");
      if (readEl) readEl.textContent = "booting the runtime · this takes a minute the first time";
      runtime.send({ cmd: "oba", token: token, task: task, seed: seed, noise: 0.0015 });
    }

    runtime.on("oba-run", function (m) {
      if (m.token !== token) return;
      run = m.run; frame = 0;
      setBusy(false, "Run the episode");
      live("oba-canvas");
      var seen = [];
      run.frames.forEach(function (f) {
        if (f.phase && seen[seen.length - 1] !== f.phase) seen.push(f.phase);
      });
      log("oba: " + run.spec.task + " " + (run.success ? "seated" : run.reason) + " in " +
          run.steps + " steps (" + run.wall_ms + " ms of python) · " + seen.join(" → "), "ok");
      if (raf) cancelAnimationFrame(raf);
      t0 = performance.now();
      raf = requestAnimationFrame(animate);
    });

    runtime.on("failed", function (m) {
      if (m.cmd !== "boot" && m.token !== token) return;
      setBusy(false, "Run the episode");
      if (readEl) readEl.textContent = "the runtime failed: " + m.msg;
    });

    function init() {
      if (runBtn) runBtn.addEventListener("click", function () { seed++; start(); });
      document.querySelectorAll("[data-oba-task]").forEach(function (b) {
        b.addEventListener("click", function () {
          task = b.getAttribute("data-oba-task");
          document.querySelectorAll("[data-oba-task]").forEach(function (o) {
            o.classList.toggle("is-on", o === b);
            o.setAttribute("aria-checked", o === b ? "true" : "false");
          });
          if (!busy) start();
        });
      });
    }
    return { init: init };
  })();

  /* ---------- 3. robot-foundation-model --------------------------------
     No robot and no canvas: this is structure. rfm.data.action_space builds
     the 32-D mask for an embodiment, and rfm.eval.metrics.check_alarms scores
     a metric snapshot against the nine-mode watchlist in rfm.eval.ablations.
     Both are the repository's own functions; the sliders only choose what to
     hand them.

     DOM rather than a plate, because all of it is text: 32 named dimensions
     and nine named failure modes are things to read, select and tab through,
     and a canvas would take all three away.
     ------------------------------------------------------------------- */
  var space = (function () {
    var stripEl = document.getElementById("rfm-strip");
    if (!stripEl) return { init: function () {} };
    var listEl = document.getElementById("rfm-modes");
    var readEl = document.getElementById("rfm-read");
    var coverEl = document.getElementById("rfm-coverage");
    var layout = null, embodiment = "single_arm_osc_pos";

    // FM-7 and FM-9 are scored by check_trace_alarms over a task's execution
    // traces, not by check_alarms over a metric snapshot. They are listed
    // because the watchlist has nine entries, and marked because these two
    // sliders cannot reach them.
    var TRACE_SIDE = { "FM-7": true, "FM-9": true };

    function renderStrip() {
      var mask = layout.masks[embodiment];
      var html = "";
      layout.slices.forEach(function (s) {
        var cells = "";
        for (var i = s.start; i < s.stop; i++) {
          cells += '<i class="lab-dim' + (mask[i] ? " is-live" : "") + '" title="dim ' + i +
                   (mask[i] ? ", live" : ", masked out of the loss") + '"></i>';
        }
        var live = 0;
        for (var j = s.start; j < s.stop; j++) if (mask[j]) live++;
        html += '<div class="lab-slice' + (live ? "" : " is-off") + '">' +
                '<p class="lab-slice__n">' + s.name + '<span>' + s.start + ":" + s.stop +
                " · " + s.unit + "</span></p>" +
                '<div class="lab-slice__d">' + cells + "</div></div>";
      });
      stripEl.innerHTML = html;
      var total = 0;
      for (var k = 0; k < mask.length; k++) if (mask[k]) total++;
      var dof = layout.dof_override[embodiment];
      if (readEl) {
        readEl.textContent = embodiment + " · " + total + " of " + layout.dim +
          " dimensions live" + (dof ? " · dof_override truncates the arm block to " + dof : "") +
          " · the other " + (layout.dim - total) + " are masked out of the flow-matching loss";
      }
    }

    function values() {
      var v = {};
      document.querySelectorAll("[data-fm-input]").forEach(function (el) {
        v[el.getAttribute("data-fm-input")] = parseFloat(el.value);
      });
      v.baseline_vl_probe = 65.0;
      return v;
    }

    function renderModes(tripped) {
      var hit = {};
      (tripped || []).forEach(function (t) { hit[t.code] = t.value; });
      listEl.innerHTML = layout.modes.map(function (m) {
        var on = Object.prototype.hasOwnProperty.call(hit, m.code);
        var trace = TRACE_SIDE[m.code];
        return '<li class="lab-fm' + (on ? " is-tripped" : "") + (trace ? " is-trace" : "") + '">' +
          '<p class="lab-fm__h"><b>' + m.code + "</b> " + m.name +
          '<span class="lab-fm__t">' + (trace ? "check_trace_alarms" :
            m.metric.split(".").pop() + " " + (m.direction === "above_is_bad" ? ">" : "<") +
            " " + m.threshold) + "</span>" +
          (on ? '<span class="lab-fm__v">' + hit[m.code] + "</span>" : "") + "</p>" +
          '<p class="lab-fm__c">' + m.consequence + "</p>" +
          "</li>";
      }).join("");
      var n = (tripped || []).length;
      var s = document.getElementById("rfm-count");
      if (s) {
        s.textContent = n === 0 ? "check_alarms returns nothing: no watched metric is over its line."
          : "check_alarms returns " + n + " tripped " + (n === 1 ? "alarm" : "alarms") + ".";
      }
    }

    function push() {
      document.querySelectorAll("[data-fm-input]").forEach(function (el) {
        var out = document.getElementById(el.id + "-v");
        if (out) out.textContent = el.value;
      });
      runtime.send({ cmd: "rfm-alarms", values: values() });
    }

    runtime.on("rfm-layout", function (m) {
      layout = m.layout;
      renderStrip();
      renderModes([]);
      if (coverEl) coverEl.textContent = layout.coverage;
      var btn = document.getElementById("rfm-load");
      if (btn) btn.remove();
      push();
    });
    runtime.on("rfm-alarms", function (m) { if (layout) renderModes(m.tripped); });

    function init() {
      var loaded = false;
      function load() {
        if (loaded) return;
        loaded = true;
        runtime.send({ cmd: "rfm-layout" });
      }
      document.querySelectorAll("[data-rfm-emb]").forEach(function (b) {
        b.addEventListener("click", function () {
          embodiment = b.getAttribute("data-rfm-emb");
          document.querySelectorAll("[data-rfm-emb]").forEach(function (o) {
            o.classList.toggle("is-on", o === b);
            o.setAttribute("aria-checked", o === b ? "true" : "false");
          });
          load();
          if (layout) renderStrip();
        });
      });
      document.querySelectorAll("[data-fm-input]").forEach(function (el) {
        el.addEventListener("input", function () {
          load();
          if (layout) push();
        });
      });
      var btn = document.getElementById("rfm-load");
      if (btn) btn.addEventListener("click", function () {
        btn.disabled = true;
        btn.textContent = "Loading…";
        load();
      });
      runtime.on("failed", function (m) {
        if (["boot", "rfm-layout", "rfm-alarms"].indexOf(m.cmd) < 0) return;
        var b = document.getElementById("rfm-load");
        if (b) { b.disabled = false; b.textContent = "Load the module"; }
        if (readEl) readEl.textContent = "the runtime failed: " + m.msg;
      });
    }
    return { init: init };
  })();

  terrain.init();
  assembly.init();
  space.init();
})();
