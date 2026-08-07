/* Runs the global planners from reactive_autonomous_nav in the browser.
   The modules are fetched from GitHub and executed unmodified; only rclpy and
   the message packages are stubbed, exactly as bench/rig.py does offline. */
(function () {
  "use strict";

  var REPO = "abdu7rahman/reactive_autonomous_nav";
  // The fix branch first: main still carries the Bresenham line-of-sight that
// returns paths through walls, and this page should not demonstrate that. Once
// the branch merges and is deleted, the fallback picks main up automatically.
  var BRANCHES = ["feat/complete-planners", "main"];
  var MODULES = {
    astar:      { file: "astar_planner.py",      cls: "AStarPlannerNode",      call: "_astar" },
    theta_star: { file: "theta_star_planner.py", cls: "ThetaStarPlannerNode",  call: "_theta_star" },
    rrt:        { file: "rrt_planner.py",        cls: "RRTPlannerNode",        call: "_rrt" }
  };
  var HINTS = {
    astar: "8-connected grid search, octile heuristic. Expands in cost order.",
    theta_star: "Any-angle. Parents are rewired whenever line of sight allows, so paths cut diagonally instead of following the grid.",
    rrt: "Sampling. Grows a tree toward random draws with a goal bias; the result is smoothed afterwards."
  };

  var COLS = 96, ROWS = 64;
  var grid = new Uint8Array(COLS * ROWS);
  var start = { r: 6, c: 6 }, goal = { r: ROWS - 7, c: COLS - 7 };
  var planner = "astar", tool = "wall";
  var pyodide = null, ready = false, running = false;
  var result = null, replay = 0, raf = null, showExplored = true;

  var cv = document.getElementById("map"), ctx = cv.getContext("2d");
  var logEl = document.getElementById("log");
  var runBtn = document.getElementById("run"), runLabel = document.getElementById("run-label");

  function log(msg, cls) {
    var line = (cls === "err" ? "!! " : cls === "ok" ? " > " : "   ") + msg;
    logEl.textContent += "\n" + line;
    logEl.scrollTop = logEl.scrollHeight;
  }

  /* ---------- map presets ------------------------------------------- */
  function clearMap() { grid.fill(0); }
  function border() {
    for (var c = 0; c < COLS; c++) { grid[c] = 1; grid[(ROWS - 1) * COLS + c] = 1; }
    for (var r = 0; r < ROWS; r++) { grid[r * COLS] = 1; grid[r * COLS + COLS - 1] = 1; }
  }
  function rect(r0, c0, h, w) {
    for (var r = r0; r < r0 + h; r++)
      for (var c = c0; c < c0 + w; c++)
        if (r > 0 && c > 0 && r < ROWS - 1 && c < COLS - 1) grid[r * COLS + c] = 1;
  }
  var PRESETS = {
    clear: function () { clearMap(); border(); },
    rooms: function () {
      clearMap(); border();
      [16, 32, 48].forEach(function (y, i) {
        rect(y, 1, 2, COLS - 2);
        rect(y, 12 + i * 24, 2, 14);           // doorway
        for (var c = 12 + i * 24; c < 26 + i * 24; c++) grid[y * COLS + c] = grid[(y + 1) * COLS + c] = 0;
      });
      rect(1, 60, ROWS - 2, 2);
      for (var r = 24; r < 40; r++) grid[r * COLS + 60] = grid[r * COLS + 61] = 0;
    },
    maze: function () {
      clearMap(); border();
      for (var r = 4; r < ROWS - 4; r += 8)
        for (var c = 4; c < COLS - 4; c += 8) {
          var d = (r * 7919 + c * 104729) % 4;
          if (d === 0) rect(r, c, 8, 2);
          else if (d === 1) rect(r, c, 2, 8);
          else if (d === 2) { rect(r, c, 6, 2); rect(r, c, 2, 6); }
        }
    },
    scatter: function () {
      clearMap(); border();
      var s = 1;
      function rnd() { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; }
      for (var i = 0; i < 46; i++) rect(2 + Math.floor(rnd() * (ROWS - 10)),
                                        2 + Math.floor(rnd() * (COLS - 10)),
                                        2 + Math.floor(rnd() * 5), 2 + Math.floor(rnd() * 7));
    }
  };

  /* ---------- rendering --------------------------------------------- */
  var CS = cv.width / COLS;
  var css = getComputedStyle(document.documentElement);
  function tok(n, fb) { return (css.getPropertyValue(n) || fb).trim(); }
  var C = {
    paper: tok("--paper", "#f4f2ed"), rule: tok("--rule", "#d9d4c8"),
    ink: tok("--ink", "#14140f"), signal: tok("--signal", "#b4380f"),
    accent: tok("--accent", "#00897b"), mut: tok("--ink-3", "#6e6a5c")
  };

  function draw() {
    ctx.fillStyle = C.paper;
    ctx.fillRect(0, 0, cv.width, cv.height);

    // drafting grid
    ctx.strokeStyle = C.rule; ctx.globalAlpha = 0.5; ctx.lineWidth = 1;
    ctx.beginPath();
    for (var c = 0; c <= COLS; c += 8) { ctx.moveTo(c * CS + 0.5, 0); ctx.lineTo(c * CS + 0.5, cv.height); }
    for (var r = 0; r <= ROWS; r += 8) { ctx.moveTo(0, r * CS + 0.5); ctx.lineTo(cv.width, r * CS + 0.5); }
    ctx.stroke(); ctx.globalAlpha = 1;

    // walls
    ctx.fillStyle = C.ink;
    for (var i = 0; i < grid.length; i++)
      if (grid[i]) ctx.fillRect((i % COLS) * CS, Math.floor(i / COLS) * CS, CS, CS);

    // explored wavefront, replayed in expansion order
    if (result && showExplored && result.explored) {
      var n = Math.min(replay, result.explored.length);
      for (var k = 0; k < n; k++) {
        var e = result.explored[k], t = k / Math.max(1, result.explored.length);
        ctx.fillStyle = C.accent;
        ctx.globalAlpha = 0.10 + 0.32 * (1 - t);
        ctx.fillRect(e[1] * CS, e[0] * CS, CS, CS);
      }
      ctx.globalAlpha = 1;
    }

    // path, drawn on once the wavefront finishes
    if (result && result.path && result.path.length > 1) {
      var done = !result.explored || replay >= result.explored.length;
      var frac = done ? Math.min(1, (replay - (result.explored ? result.explored.length : 0)) / 60) : 0;
      var upto = Math.max(2, Math.floor(result.path.length * frac));
      ctx.strokeStyle = C.signal; ctx.lineWidth = 3.5;
      ctx.lineJoin = "round"; ctx.lineCap = "round";
      ctx.beginPath();
      for (var p = 0; p < upto; p++) {
        var q = result.path[p], x = q[1] * CS + CS / 2, y = q[0] * CS + CS / 2;
        p ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.stroke();
      if (planner === "theta_star" && upto > 1) {          // any-angle vertices
        ctx.fillStyle = C.paper; ctx.strokeStyle = C.signal; ctx.lineWidth = 2;
        for (var v = 0; v < upto; v++) {
          ctx.beginPath();
          ctx.arc(result.path[v][1] * CS + CS / 2, result.path[v][0] * CS + CS / 2, 3.2, 0, 6.284);
          ctx.fill(); ctx.stroke();
        }
      }
    }
    marker(start, C.accent, "S");
    marker(goal, C.signal, "G");
  }

  function marker(p, colour, letter) {
    var x = p.c * CS + CS / 2, y = p.r * CS + CS / 2;
    ctx.strokeStyle = colour; ctx.lineWidth = 1.6;
    ctx.beginPath();                                  // drafted crosshair
    ctx.moveTo(x - 11, y); ctx.lineTo(x - 4, y);
    ctx.moveTo(x + 4, y); ctx.lineTo(x + 11, y);
    ctx.moveTo(x, y - 11); ctx.lineTo(x, y - 4);
    ctx.moveTo(x, y + 4); ctx.lineTo(x, y + 11);
    ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y, 6.5, 0, 6.284);
    ctx.fillStyle = colour; ctx.fill();
    ctx.fillStyle = C.paper;
    ctx.font = "600 9px ui-monospace, monospace";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(letter, x, y + 0.5);
  }

  function animate() {
    if (!result) return;
    var total = (result.explored ? result.explored.length : 0) + 62;
    var stepSize = Math.max(1, Math.ceil((result.explored ? result.explored.length : 1) / 90));
    replay += stepSize;
    draw();
    tick();
    if (replay < total) raf = requestAnimationFrame(animate);
    else { replay = total; draw(); }
  }

  function tick() {
    if (!result) return;
    var seen = Math.min(replay, result.explored ? result.explored.length : 0);
    document.getElementById("s-exp").textContent = seen.toLocaleString();
    if (replay >= (result.explored ? result.explored.length : 0)) {
      document.getElementById("s-len").textContent = result.path ? result.path.length.toLocaleString() : "no path";
      document.getElementById("s-ms").textContent = result.ms.toFixed(1) + " ms";
    }
  }

  /* ---------- python ------------------------------------------------ */
  var BOOTSTRAP = [
    "import sys, types, io, contextlib, time",
    "def _mod(name, **attrs):",
    "    m = types.ModuleType(name)",
    "    for k, v in attrs.items(): setattr(m, k, v)",
    "    sys.modules[name] = m",
    "    if '.' in name:",
    "        p, c = name.rsplit('.', 1)",
    "        if p in sys.modules: setattr(sys.modules[p], c, m)",
    "    return m",
    "class _Meta(type):",
    "    def __getattr__(cls, n): return 0",
    "class Any(metaclass=_Meta):",
    "    def __init__(self, *a, **k): pass",
    "    def __getattr__(self, n): return Any()",
    "    def __call__(self, *a, **k): return Any()",
    "_mod('rclpy', init=lambda *a, **k: None, spin=lambda *a, **k: None, shutdown=lambda *a, **k: None, ok=lambda *a, **k: True)",
    "_mod('rclpy.time', Time=Any); _mod('rclpy.duration', Duration=Any)",
    "_mod('rclpy.node', Node=type('Node', (), {'__init__': lambda s, *a, **k: None}))",
    "_mod('rclpy.qos', QoSProfile=Any, DurabilityPolicy=Any, ReliabilityPolicy=Any)",
    "_mod('rclpy.callback_groups', ReentrantCallbackGroup=Any)",
    "_mod('rclpy.executors', MultiThreadedExecutor=Any)",
    "_mod('tf2_ros', TransformListener=Any, Buffer=Any)",
    "for _n, _s in (('nav_msgs', ()), ('nav_msgs.msg', ('OccupancyGrid','Path','Odometry')),",
    "               ('geometry_msgs', ()), ('geometry_msgs.msg', ('PoseStamped','Point','Twist','Pose','Quaternion')),",
    "               ('std_msgs', ()), ('std_msgs.msg', ('String','ColorRGBA','Header')),",
    "               ('visualization_msgs', ()), ('visualization_msgs.msg', ('Marker','MarkerArray')),",
    "               ('builtin_interfaces', ()), ('builtin_interfaces.msg', ('Time',))):",
    "    _m = _mod(_n)",
    "    for _x in _s: setattr(_m, _x, Any)",
    "_LOADED = {}",
    "def load_module(name, src):",
    "    m = types.ModuleType(name)",
    "    with contextlib.redirect_stdout(io.StringIO()):",
    "        exec(compile(src, name, 'exec'), m.__dict__)",
    "    sys.modules[name] = m; _LOADED[name] = m",
    "    return [k for k in dir(m) if k.endswith('Node')]",
    "def _wire(node, g, h, w):",
    "    import numpy as np",
    "    node.global_data = g",
    "    node.global_info = types.SimpleNamespace(resolution=0.05, width=w, height=h)",
    "    node.global_origin = (0.0, 0.0)",
    "    node.local_data = None; node.local_info = None; node.local_origin = (0.0, 0.0)",
    "    node.odom_to_map = None; node.current_path = None",
    "    node.get_logger = lambda: types.SimpleNamespace(info=lambda *a, **k: None, warn=lambda *a, **k: None, error=lambda *a, **k: None)",
    "    stamp = types.SimpleNamespace(to_msg=lambda: types.SimpleNamespace(sec=0, nanosec=0))",
    "    node.get_clock = lambda: types.SimpleNamespace(now=lambda: stamp)",
    "    return node",
    "def run(kind, mod_name, cls_name, flat, h, w, sr, sc, gr, gc):",
    "    import numpy as np",
    "    g = np.array(flat, dtype=np.int16).reshape(h, w) * 254",
    "    m = _LOADED[mod_name]; cls = getattr(m, cls_name)",
    "    node = _wire(object.__new__(cls), g, h, w)",
    "    for k, v in (('max_iter', 20000), ('step_size', 0.3), ('goal_bias', 0.15), ('goal_reach_dist', 0.2)):",
    "        setattr(node, k, v)",
    "    t0 = time.perf_counter()",
    "    if kind == 'rrt':",
    "        out = {}",
    "        node._publish_tree = lambda ns: out.__setitem__('tree', [(n.x, n.y) for n in ns])",
    "        node._publish_path = lambda p: out.__setitem__('path', [(float(a), float(b)) for a, b in p])",
    "        node._get_robot_pose = lambda: ((sc + 0.5) * 0.05, (sr + 0.5) * 0.05)",
    "        import random as _r; _r.seed(7)",
    "        node._plan(types.SimpleNamespace(pose=types.SimpleNamespace(position=types.SimpleNamespace(",
    "            x=(gc + 0.5) * 0.05, y=(gr + 0.5) * 0.05))))",
    "        ms = (time.perf_counter() - t0) * 1000.0",
    "        w2g = lambda p: [int(p[1] / 0.05), int(p[0] / 0.05)]",
    "        path = [w2g(p) for p in out.get('path', [])]",
    "        expl = [w2g(p) for p in out.get('tree', [])]",
    "    else:",
    "        res = getattr(node, '_astar' if kind == 'astar' else '_theta_star')((sr, sc), (gr, gc))",
    "        ms = (time.perf_counter() - t0) * 1000.0",
    "        p, e = res",
    "        path = [[int(a), int(b)] for a, b in (p or [])]",
    "        expl = [[int(a), int(b)] for a, b in (e or [])]",
    "    return [path, expl, ms]"
  ].join("\n");

  async function fetchSource(file) {
    for (var i = 0; i < BRANCHES.length; i++) {
      var url = "https://raw.githubusercontent.com/" + REPO + "/" + BRANCHES[i] +
                "/reactive_autonomous_nav/" + file;
      try {
        var r = await fetch(url, { cache: "no-store" });
        if (r.ok) { var t = await r.text(); return { text: t, branch: BRANCHES[i], url: url }; }
      } catch (e) { /* try next */ }
    }
    throw new Error("could not fetch " + file);
  }

  async function boot() {
    try {
      log("loading pyodide runtime…");
      pyodide = await loadPyodide({ indexURL: "https://cdn.jsdelivr.net/pyodide/v0.26.2/full/" });
      log("pyodide " + pyodide.version, "ok");
      log("loading numpy…");
      await pyodide.loadPackage("numpy");
      log("numpy ready", "ok");
      pyodide.runPython(BOOTSTRAP);
      log("ros stubbed at the import boundary", "ok");

      for (var key in MODULES) {
        var m = MODULES[key];
        var src = await fetchSource(m.file);
        pyodide.globals.set("__src", src.text);
        pyodide.globals.set("__name_", m.file.replace(".py", ""));
        var found = pyodide.runPython("load_module(__name_, __src)").toJs();
        log(m.file + "  " + src.text.length.toLocaleString() + " bytes from " +
            src.branch + "  ->  " + found.join(", "), "ok");
      }
      ready = true;
      runBtn.disabled = false;
      runLabel.textContent = "Run planner";
      log("ready. draw a map and hit run.", "ok");
    } catch (e) {
      log(String(e && e.message ? e.message : e), "err");
      runLabel.textContent = "Failed to load";
    }
  }

  async function run() {
    if (!ready || running) return;
    running = true;
    runBtn.disabled = true; runLabel.textContent = "Planning…";
    if (raf) cancelAnimationFrame(raf);
    result = null; replay = 0; draw();
    document.getElementById("s-ms").textContent = "…";
    document.getElementById("s-len").textContent = "…";
    document.getElementById("s-exp").textContent = "…";
    await new Promise(function (r) { setTimeout(r, 16); });

    try {
      var m = MODULES[planner];
      pyodide.globals.set("__flat", Array.from(grid));
      var out = pyodide.runPython(
        "run('" + planner + "', '" + m.file.replace(".py", "") + "', '" + m.cls + "', " +
        "__flat.to_py() if hasattr(__flat,'to_py') else list(__flat), " +
        ROWS + ", " + COLS + ", " + start.r + ", " + start.c + ", " + goal.r + ", " + goal.c + ")"
      ).toJs();
      result = { path: out[0], explored: out[1], ms: out[2] };
      log(planner + ": " + (result.path.length ? result.path.length + " cells" : "no path") +
          ", " + result.explored.length.toLocaleString() + " expanded, " +
          result.ms.toFixed(1) + " ms", result.path.length ? "ok" : "err");
      raf = requestAnimationFrame(animate);
    } catch (e) {
      log(String(e && e.message ? e.message : e).split("\n").slice(-4).join(" | "), "err");
    }
    running = false;
    runBtn.disabled = false; runLabel.textContent = "Run planner";
  }

  /* ---------- interaction ------------------------------------------- */
  var painting = false;
  function cellAt(ev) {
    var b = cv.getBoundingClientRect();
    var pt = ev.touches ? ev.touches[0] : ev;
    return {
      c: Math.max(0, Math.min(COLS - 1, Math.floor((pt.clientX - b.left) / b.width * COLS))),
      r: Math.max(0, Math.min(ROWS - 1, Math.floor((pt.clientY - b.top) / b.height * ROWS)))
    };
  }
  function apply(p) {
    if (tool === "wall") { for (var d = 0; d < 4; d++) { var rr = p.r + (d >> 1), cc = p.c + (d & 1);
      if (rr < ROWS && cc < COLS) grid[rr * COLS + cc] = 1; } }
    else if (tool === "erase") { for (var e = -1; e <= 1; e++) for (var f = -1; f <= 1; f++) {
      var r2 = p.r + e, c2 = p.c + f;
      if (r2 > 0 && c2 > 0 && r2 < ROWS - 1 && c2 < COLS - 1) grid[r2 * COLS + c2] = 0; } }
    else if (tool === "start") { if (!grid[p.r * COLS + p.c]) start = p; }
    else if (tool === "goal") { if (!grid[p.r * COLS + p.c]) goal = p; }
    result = null; draw();
  }
  cv.addEventListener("mousedown", function (e) { painting = true; apply(cellAt(e)); });
  cv.addEventListener("mousemove", function (e) { if (painting) apply(cellAt(e)); });
  window.addEventListener("mouseup", function () { painting = false; });
  cv.addEventListener("touchstart", function (e) { e.preventDefault(); painting = true; apply(cellAt(e)); }, { passive: false });
  cv.addEventListener("touchmove", function (e) { e.preventDefault(); if (painting) apply(cellAt(e)); }, { passive: false });
  window.addEventListener("touchend", function () { painting = false; });

  function segGroup(attr, onPick) {
    document.querySelectorAll("[data-" + attr + "]").forEach(function (b) {
      b.addEventListener("click", function () {
        var sibs = b.parentElement.querySelectorAll(".seg__btn");
        sibs.forEach(function (s) { s.classList.remove("is-on"); s.setAttribute("aria-checked", "false"); });
        b.classList.add("is-on"); b.setAttribute("aria-checked", "true");
        onPick(b.getAttribute("data-" + attr));
      });
    });
  }
  segGroup("planner", function (v) {
    planner = v; result = null; draw();
    document.getElementById("planner-hint").textContent = HINTS[v];
  });
  segGroup("tool", function (v) { tool = v; });
  document.querySelectorAll("[data-preset]").forEach(function (b) {
    b.addEventListener("click", function () {
      PRESETS[b.getAttribute("data-preset")]();
      if (grid[start.r * COLS + start.c]) grid[start.r * COLS + start.c] = 0;
      if (grid[goal.r * COLS + goal.c]) grid[goal.r * COLS + goal.c] = 0;
      result = null; draw();
    });
  });
  document.getElementById("show-explored").addEventListener("change", function (e) {
    showExplored = e.target.checked; draw();
  });
  runBtn.addEventListener("click", run);

  PRESETS.rooms();
  draw();
  logEl.textContent = "reactive_autonomous_nav / browser runtime";
  boot();
})();
