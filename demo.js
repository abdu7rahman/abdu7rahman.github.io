/* Runs the global planners from reactive_autonomous_nav in the browser.
   The modules are fetched from GitHub and executed unmodified; only rclpy and
   the message packages are stubbed, exactly as bench/rig.py does offline. */
(function () {
  "use strict";

  /* Every canvas on this page was authored with a fixed backing store -- 1204
     wide for three of them -- and then scaled by CSS to whatever the column
     gave it. On a desktop that is roughly 1:1 and nobody notices. On a phone
     the column is 350px, so the scale is 0.29: an 11px label lands at three
     pixels, a robot drawn at radius 6 lands at under two, and the whole demo
     reads as an empty box with a couple of bars in it.

     The backing store follows the element now. Drawing happens in CSS pixels
     -- setTransform absorbs the device ratio, so retina gets real pixels
     without any of the geometry below having to know -- and the simulated
     world, which every renderer derives from these dimensions, gets coarser
     on a small screen rather than smaller. Fewer cells, all of them visible,
     which is the right trade.

     Called once before each demo initialises. It deliberately does not react
     to resize: the world, its costmap and any in-flight plan are built from
     these numbers, and rebuilding all of that under a rotating phone is a lot
     of risk for a case a reload already handles. */
  function fitCanvas(cv, wideAspect, narrowAspect) {
    var w = Math.max(280, Math.round(cv.getBoundingClientRect().width));
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var h = Math.round(w * (w < 640 ? narrowAspect : wideAspect));
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    cv._w = w;                       // CSS pixels: the space everything draws in
    cv._h = h;
    cv._narrow = w < 640;
    cv.getContext("2d").setTransform(dpr, 0, 0, dpr, 0, 0);
    return cv;
  }

  var REPO = "abdu7rahman/reactive_autonomous_nav";
  var BRANCHES = ["main", "feat/complete-planners"];   // fallback if main moves
  var MODULES = {
    astar:      { file: "astar_planner.py",      cls: "AStarPlannerNode",      call: "_astar" },
    theta_star: { file: "theta_star_planner.py", cls: "ThetaStarPlannerNode",  call: "_theta_star" },
    rrt:        { file: "rrt_planner.py",        cls: "RRTPlannerNode",        call: "_rrt" },
    // SE2 planners: they carry a heading and a 0.22 m turning radius, so they
    // are given the start and goal in world coordinates rather than cells
    smac:       { file: "smac_planner.py",       cls: "SmacPlannerNode",       call: "_hybrid_astar", se2: true },
    hybrid:     { file: "rrt_smac_hybrid_planner.py", cls: "HybridRRTSMACPlannerNode", call: "_plan_hybrid_unified", se2: true }
  };
  var DWA = { file: "dwa_controller.py", cls: "DWAControllerNode" };
  // Every local controller in the package, for the race. dwa is fetched as
  // DWA above and reused rather than downloaded twice.
  //
  // mppi is off by default. It draws 1000 samples per tick and profiles at
  // ~129 ms in _sample_controls and ~173 ms in _path_angle_cost against 4 ms
  // of marker building -- real control work, so it cannot be trimmed without
  // running something other than what the repo ships. On a robot with a real
  // CPU it makes its 20 Hz; in a browser it does not.
  var RACERS = [
    { key: "pure_pursuit", file: "pure_pursuit_controller.py", label: "Pure Pursuit", col: "#3f6b57", on: true },
    { key: "stanley",      file: "stanley_controller.py",      label: "Stanley",      col: "#d6b27c", on: true },
    { key: "dwa",          file: "dwa_controller.py",          label: "DWA",          col: "#9a4a26", on: true },
    { key: "teb",          file: "teb_controller.py",          label: "TEB",          col: "#5a7d8c", on: true },
    { key: "mppi",         file: "mppi_controller.py",         label: "MPPI",         col: "#8a6a94", on: false }
  ];
  // The arm's detector comes from a different repo, and it ships a headless
  // harness -- tests/harness.py loads the node with ROS stubbed and tests/
  // scene.py builds synthetic RealSense frames. Both are laid into the Pyodide
  // filesystem at their repo paths so they import unmodified.
  var ARM = {
    repo: "abdu7rahman/motion-replanning-ur12e",
    branch: "main",
    files: ["tests/harness.py", "tests/scene.py",
            "reactive_replanning_ur12e/reactive_replanning.py"]
  };
  /* The predictive replanner from the same repo. Pure numpy -- predict.py and
     replan.py reach only into ur12e.py -- so unlike the cell simulation beside
     it there is no MuJoCo to stand up, and the three modules run here as they
     run on the robot. */
  var FORESEE = {
    repo: "abdu7rahman/motion-replanning-ur12e",
    branch: "main",
    files: ["predictive_replanning/ur12e.py",
            "predictive_replanning/predict.py",
            "predictive_replanning/replan.py"],
    // The robot's geometry, which is not this repository's to fetch from
    // GitHub: it is Universal Robots' and Robotiq's, baked out of the pinned
    // descriptions by tools/bake_arm.py and served from here.
    mesh: "assets/ur12e.json"
  };
  var HINTS = {
    astar: "8-connected grid search, octile heuristic. Expands in cost order.",
    theta_star: "Any-angle. Parents are rewired whenever line of sight allows, so paths cut diagonally instead of following the grid.",
    rrt: "Sampling. Grows a tree toward random draws with a goal bias; the result is smoothed afterwards.",
    smac: "Hybrid A* over an SE2 lattice. Every expansion is an arc the robot can actually drive, so the path obeys a 0.22 m turning radius instead of cutting a grid corner.",
    hybrid: "RRT that expands with the same motion primitives, then tries an analytic connect to the goal whenever one is close enough to be worth checking. Its tree stays inside the planner, so this is the one planner with nothing to show under “explored”."
  };

  var COLS = 96, ROWS = 64;
  var grid = new Uint8Array(COLS * ROWS);
  var start = { r: 6, c: 6 }, goal = { r: ROWS - 7, c: COLS - 7 };
  var planner = "astar", tool = "wall";
  var pyodide = null, ready = false, running = false;
  var result = null, replay = 0, raf = null, showExplored = true;

  var cv = fitCanvas(document.getElementById("map"), 640 / 960, 0.85),
      ctx = cv.getContext("2d");
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
  var CS = cv._w / COLS;
  var css = getComputedStyle(document.documentElement);
  function tok(n, fb) { return (css.getPropertyValue(n) || fb).trim(); }
  var C = {
    paper: tok("--paper", "#f4f2ed"), rule: tok("--rule", "#d9d4c8"),
    ink: tok("--ink", "#14140f"), signal: tok("--signal", "#b4380f"),
    accent: tok("--accent", "#00897b"), mut: tok("--ink-3", "#6e6a5c")
  };

  function draw() {
    ctx.fillStyle = C.paper;
    ctx.fillRect(0, 0, cv._w, cv._h);

    // drafting grid
    ctx.strokeStyle = C.rule; ctx.globalAlpha = 0.5; ctx.lineWidth = 1;
    ctx.beginPath();
    for (var c = 0; c <= COLS; c += 8) { ctx.moveTo(c * CS + 0.5, 0); ctx.lineTo(c * CS + 0.5, cv._h); }
    for (var r = 0; r <= ROWS; r += 8) { ctx.moveTo(0, r * CS + 0.5); ctx.lineTo(cv._w, r * CS + 0.5); }
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
    "class Vec3:",
    "    def __init__(self, *a, **k): self.x = self.y = self.z = 0.0",
    "class Twist:",
    "    # Real fields. Any() hands back a fresh mock on every attribute read, so",
    "    # a node that writes cmd.linear.x and a caller that reads it back get two",
    "    # different objects and the command is silently lost.",
    "    def __init__(self, *a, **k): self.linear, self.angular = Vec3(), Vec3()",
    "sys.modules['geometry_msgs.msg'].Twist = Twist",
    "sys.modules['geometry_msgs.msg'].Vector3 = Vec3",
    "_LOADED = {}",
    "_SRC = {}",
    "def load_module(name, src):",
    "    m = types.ModuleType(name)",
    "    with contextlib.redirect_stdout(io.StringIO()):",
    "        exec(compile(src, name, 'exec'), m.__dict__)",
    "    sys.modules[name] = m; _LOADED[name] = m; _SRC[name] = src",
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
    "    elif kind in ('smac', 'hybrid'):",
    "        sw = ((sc + 0.5) * 0.05, (sr + 0.5) * 0.05)",
    "        gw = ((gc + 0.5) * 0.05, (gr + 0.5) * 0.05)",
    "        import random as _r; _r.seed(7)",
    "        fn = node._hybrid_astar if kind == 'smac' else node._plan_hybrid_unified",
    "        out = (fn((sw[0], sw[1], 0.0), (gw[0], gw[1], 0.0)) if kind == 'smac'",
    "               else fn(sw[0], sw[1], 0.0, gw[0], gw[1], 0.0))",
    "        ms = (time.perf_counter() - t0) * 1000.0",
    "        # _hybrid_astar returns (path, explored) -- the world-frame centre of",
    "        # every lattice node it popped. _plan_hybrid_unified returns the path",
    "        # alone: its RRT tree is a local in that function and is not handed",
    "        # back, so there is nothing to draw for it rather than nothing to find.",
    "        pts = out[0] if isinstance(out, tuple) else out",
    "        seen = out[1] if (isinstance(out, tuple) and len(out) > 1) else []",
    "        w2g = lambda p: [int(p[1] / 0.05), int(p[0] / 0.05)]",
    "        path = [w2g(p) for p in (pts or [])]",
    "        expl = [w2g(p) for p in (seen or [])]",
    "    else:",
    "        res = getattr(node, '_astar' if kind == 'astar' else '_theta_star')((sr, sc), (gr, gc))",
    "        ms = (time.perf_counter() - t0) * 1000.0",
    "        p, e = res",
    "        path = [[int(a), int(b)] for a, b in (p or [])]",
    "        expl = [[int(a), int(b)] for a, b in (e or [])]",
    "    return [path, expl, ms]",
    "# \u2500\u2500 chain, measured off tests/scene.py \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500",
    "# The second link carries a marker at the forearm and continues to wrist_1,",
    "# so the solve stays a two-link problem while every published link length",
    "# is exactly what the repo's own pose has.",
    "L_BASE_Z = 0.180                # base -> shoulder",
    "L1 = 0.271                      # shoulder -> upper_arm",
    "L2_MID = 0.337                  # upper_arm -> forearm, along the second link",
    "L2 = 0.588                      # upper_arm -> wrist_1",
    "WRIST = (0.098, 0.063, 0.054)   # wrist_1 -> wrist_2 -> wrist_3 -> tool0",
    "L_WRIST = 0.215",
    "# The browser has no MoveIt, so the pose FK would return at HOME_JOINTS is",
    "# stood in for. Chosen to sit inside the node's own workspace box with both",
    "# derived poses reachable; everything downstream comes from the repo.",
    "HOME_EEF = (-0.48, -0.28, 0.48)",
    "PICK_DZ, PLACE_DY = -0.25, 0.75          # overwritten from the fetched source",
    "def arm_offsets_from_source(src):",
    "    # declare_parameter('pick_z_offset', -0.25) -- read them rather than",
    "    # copy them, so retuning the node retunes this.",
    "    import ast",
    "    global PICK_DZ, PLACE_DY",
    "    for node in ast.walk(ast.parse(src)):",
    "        if (isinstance(node, ast.Call) and getattr(node.func, 'attr', '') == 'declare_parameter'",
    "                and len(node.args) == 2 and isinstance(node.args[0], ast.Constant)):",
    "            try: val = ast.literal_eval(node.args[1])",
    "            except Exception: continue",
    "            if node.args[0].value == 'pick_z_offset': PICK_DZ = float(val)",
    "            elif node.args[0].value == 'place_y_offset': PLACE_DY = float(val)",
    "    return [PICK_DZ, PLACE_DY]",
    "def arm_waypoints():",
    "    # _build_poses(): pick is home offset in z, place is home offset in y,",
    "    # both keeping the home orientation.",
    "    h = HOME_EEF",
    "    return {'home': h,",
    "            'pick': (h[0], h[1], h[2] + PICK_DZ),",
    "            'place': (h[0], h[1] + PLACE_DY, h[2])}",
    "def _lerp(a, b, t):",
    "    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))",
    "def _ease(t):",
    "    return t * t * (3.0 - 2.0 * t)",
    "# run_demo()'s cycle, with the dwells it actually takes: the gripper opens and",
    "# closes, and the last leg parks so the baseline can rebuild.",
    "def eef_target(u):",
    "    w = arm_waypoints()",
    "    H, P, Q = w['home'], w['pick'], w['place']",
    "    legs = ((0.00, 0.16, H, P, 'to PICK'), (0.16, 0.24, P, P, 'gripper closing'),",
    "            (0.24, 0.46, P, Q, 'to PLACE'), (0.46, 0.54, Q, Q, 'gripper opening'),",
    "            (0.54, 0.72, Q, H, 'to home'), (0.72, 1.00, H, H, 'parked, baseline rebuilding'))",
    "    for t0, t1, p, q, lbl in legs:",
    "        if t0 <= u < t1:",
    "            return _lerp(p, q, _ease((u - t0) / (t1 - t0))), lbl",
    "    return H, 'parked, baseline rebuilding'",
    "def arm_pose(u):",
    "    tool, leg = eef_target(u)",
    "    return arm_ik(tool), np.array(tool), leg",
    "def arm_ik(tool):",
    "    # Two-link solve in the vertical plane through the base and the target.",
    "    # Every position below is placed from the solved angles, so the links",
    "    # cannot stretch to cover an unreachable target.",
    "    import math, numpy as np",
    "    S = np.array([0.0, 0.0, L_BASE_Z])",
    "    Wt = np.array([tool[0], tool[1], tool[2] + L_WRIST])       # wrist_1 target",
    "    d = Wt - S",
    "    r = math.hypot(d[0], d[1]); dz = d[2]",
    "    yaw = math.atan2(d[1], d[0])",
    "    reach = math.hypot(r, dz)",
    "    span = min(max(reach, abs(L1 - L2) + 1e-4), L1 + L2 - 1e-4)",
    "    ca = (span * span + L1 * L1 - L2 * L2) / (2.0 * L1 * span)",
    "    a1 = math.atan2(dz, r) + math.acos(min(1.0, max(-1.0, ca)))",
    "    cb = (L1 * L1 + L2 * L2 - span * span) / (2.0 * L1 * L2)",
    "    a2 = a1 + math.acos(min(1.0, max(-1.0, cb))) - math.pi",
    "    u1 = np.array([math.cos(a1) * math.cos(yaw), math.cos(a1) * math.sin(yaw), math.sin(a1)])",
    "    u2 = np.array([math.cos(a2) * math.cos(yaw), math.cos(a2) * math.sin(yaw), math.sin(a2)])",
    "    A = S + L1 * u1                       # upper_arm",
    "    Fm = A + L2_MID * u2                  # forearm, a marker along the second link",
    "    W = A + L2 * u2                       # wrist_1, where the solve actually puts it",
    "    links = {'base_link': np.zeros(3), 'shoulder_link': S, 'upper_arm_link': A,",
    "             'forearm_link': Fm, 'wrist_1_link': W}",
    "    p = W",
    "    for name, off in zip(('wrist_2_link', 'wrist_3_link', 'tool0'), WRIST):",
    "        p = p + np.array([0.0, 0.0, -off]); links[name] = p",
    "    return links",
    "_ARM = {}",
    "def arm_write(path, src):",
    "    import os",
    "    d = os.path.dirname(path)",
    "    if d: os.makedirs(d, exist_ok=True)",
    "    open(path, 'w').write(src)",
    "def arm_init(seed):",
    "    # tests/harness.py resolves its package root from __file__ and imports",
    "    # scene as a sibling, so the files are laid out the way the repo lays",
    "    # them out and imported unmodified rather than patched.",
    "    import sys, numpy as np",
    "    if '/rr/tests' not in sys.path: sys.path.insert(0, '/rr/tests')",
    "    import harness, scene",
    "    cls = harness.load_node_class()",
    "    arm_offsets_from_source(open('/rr/reactive_replanning_ur12e/reactive_replanning.py').read())",
    "    rig = harness.Rig(cls)",
    "    n = rig.node",
    "    st = {}",
    "    _colour, _self = n._is_robot_color, n._filter_robot_self",
    "    def colour(rgb):",
    "        st['ws'] = len(rgb)",
    "        m = _colour(rgb)",
    "        st['colour'] = int((~m).sum())",
    "        return m",
    "    def selff(p):",
    "        out = _self(p)",
    "        st['self'] = len(out)",
    "        return out",
    "    n._is_robot_color, n._filter_robot_self = colour, selff",
    "    n._last_obstacle_xyz = None",
    "    _inj = n._inject_obstacle_at_xyz",
    "    def inject(x, y, z, diff):",
    "        n._last_obstacle_xyz = (x, y, z)      # line 525 of the node",
    "        return _inj(x, y, z, diff)",
    "    n._inject_obstacle_at_xyz = inject",
    "    _rm = n._remove_obstacle",
    "    def remove():",
    "        n._last_obstacle_xyz = None",
    "        return _rm()",
    "    n._remove_obstacle = remove",
    "    _ARM.update(rig=rig, n=n, scene=scene, st=st,",
    "                rng=np.random.default_rng(int(seed)))",
    "    # Prime the baseline the way the node does: parked, and parked means one",
    "    # pose, which is the whole reason the swept-volume history exists once",
    "    # it starts moving.",
    "    _set_pose(arm_waypoints()['home'])",
    "    for _ in range(10):",
    "        cam, rgb, _g = scene.build(_ARM['rng'])",
    "        rig.feed(cam, rgb)",
    "    n._executing = True",
    "    return [float(n.DEPTH_MIN), float(n.DEPTH_MAX), int(n.OBSTACLE_THRESHOLD),",
    "            int(n.DEBOUNCE_FRAMES), float(n.CLOUD_THROTTLE),",
    "            int(n._baseline_count or 0), float(n.PREEMPT_DIST),",
    "            int(len(n._arm_pos_history.maxlen and [0] * n._arm_pos_history.maxlen)),",
    "            [[list(scene.LINKS).index(a), list(scene.LINKS).index(b)]",
    "             for a, b in scene.CHAIN], PICK_DZ, PLACE_DY]",
    "def _set_pose(tool):",
    "    # One pose, handed to both the renderer and the node's TF, so the point",
    "    # cloud and the self-filter cannot disagree about where the arm is.",
    "    import numpy as np",
    "    a = _ARM; s = a['scene']",
    "    links = arm_ik(tool)",
    "    s.LINKS = links",
    "    a['rig'].node.tf_buffer.links = links",
    "    a['tool'] = np.array(tool)",
    "    return links, np.array(tool)",
    "F, CX, CY = 565.0, 533.0, 295.0     # fitted to the arm over a whole cycle",
    "PLANE_Y = 0.08",
    "WS = ((-1.10, -0.30), (-0.45, 0.55), (0.10, 1.10))",
    "def _project(p):",
    "    z = p[:, 2].copy(); z[z < 1e-3] = 1e-3",
    "    return F * p[:, 0] / z + CX, F * p[:, 1] / z + CY",
    "def arm_unproject(u, v):",
    "    import numpy as np",
    "    s = _ARM['scene']",
    "    d = s.R_BASE_FROM_CAM @ np.array([(u - CX) / F, (v - CY) / F, 1.0])",
    "    if abs(d[1]) < 1e-6: return None",
    "    t = (PLANE_Y - s.CAM_POS[1]) / d[1]",
    "    if t <= 0: return None",
    "    p = s.CAM_POS + t * d",
    "    return np.array([min(max(p[i], WS[i][0]), WS[i][1]) for i in range(3)])",
    "# \u2500\u2500 the node's cycle as a queue, so a replan can change it mid-motion \u2500\u2500",
    "TOOL_SPEED = 0.15                # m/s along the tool path",
    "SIDE_OFFSET = 0.18               # m, plan_arc_detour's side step",
    "def _v(p):",
    "    import numpy as np",
    "    return np.array([float(p[0]), float(p[1]), float(p[2])])",
    "def _seg_hits(a, b, c, r):",
    "    # closest approach of segment a->b to sphere centre c",
    "    import numpy as np",
    "    d = b - a; L2 = float(d @ d)",
    "    t = 0.0 if L2 < 1e-12 else float(np.clip((c - a) @ d / L2, 0.0, 1.0))",
    "    return float(np.linalg.norm(c - (a + t * d))) < r",
    "def chase_queue():",
    "    w = arm_waypoints()",
    "    # run_demo(): open, PICK, close, PLACE, open, park while the baseline rebuilds",
    "    return [(w['pick'], 'to PICK', 0.0), (w['pick'], 'gripper closing', 0.8),",
    "            (w['place'], 'to PLACE', 0.0), (w['place'], 'gripper opening', 0.8),",
    "            (w['home'], 'to home', 0.0), (w['home'], 'parked, baseline rebuilding', 2.0)]",
    "def _detour(cur, tgt, sphere, block_r):",
    "    # plan_arc_detour, verbatim in shape: lift over when the motion is",
    "    # horizontal-dominant, step aside when it is vertical. Its cartesian",
    "    # solve is replaced by the same segment test the preempt uses.",
    "    import numpy as np",
    "    c, t = _v(cur), _v(tgt)",
    "    dx, dy, dz = t[0] - c[0], t[1] - c[1], t[2] - c[2]",
    "    horiz = (dx * dx + dy * dy) ** 0.5",
    "    def clear(wps):",
    "        pts = [c] + [_v(p) for p in wps]",
    "        return not any(_seg_hits(pts[i], pts[i + 1], sphere, block_r)",
    "                       for i in range(len(pts) - 1))",
    "    if horiz > 0.05:",
    "        lift = max(c[2], t[2]) + _ARM['n'].DETOUR_HEIGHT",
    "        wps = [(c[0], c[1], lift), (t[0], t[1], lift), tuple(t)]",
    "        return (wps, 'lift %.2f' % lift) if clear(wps) else (None, 'lift blocked')",
    "    for axis, sign in (('y', 1), ('y', -1), ('x', 1), ('x', -1)):",
    "        off = SIDE_OFFSET * sign",
    "        ox, oy = (off, 0.0) if axis == 'x' else (0.0, off)",
    "        wps = [(c[0] + ox, c[1] + oy, c[2]), (t[0] + ox, t[1] + oy, t[2]), tuple(t)]",
    "        if clear(wps):",
    "            return wps, 'side %s%+.2f' % (axis, off)",
    "    return None, 'all detours blocked'",
    "def _grip_state():",
    "    # run_demo()'s gripper, from the leg the queue is on. Open is 1.",
    "    d = _ARM",
    "    leg = d.get('leg', '')",
    "    q = d['queue'][d['qi']] if d.get('queue') else None",
    "    total = float(q[2]) if q else 0.0",
    "    prog = 1.0 if total <= 0 else min(1.0, max(0.0, 1.0 - d['dwell'] / total))",
    "    if leg == 'gripper closing': return 1.0 - prog, prog > 0.55",
    "    if leg == 'to PLACE': return 0.0, True",
    "    if leg == 'gripper opening': return prog, prog < 0.45",
    "    return 1.0, False",
    "def _payload(tip):",
    "    # The thing being moved. It sits at PICK until the gripper closes on it,",
    "    # rides the tool to PLACE, and stays there until the cycle comes round.",
    "    #",
    "    # It rides the tool the renderer drew, not the tool the queue asked for.",
    "    # Those differ whenever the IK clamps -- a detour lifts to DETOUR_HEIGHT,",
    "    # which can be past the two-link reach -- and drawing the box at the",
    "    # commanded pose then leaves it hanging in the air beside the gripper.",
    "    d = _ARM; w = arm_waypoints()",
    "    if 'pay' not in d: d['pay'] = [float(v) for v in w['pick']]",
    "    grip, held = _grip_state()",
    "    if held: d['pay'] = [float(v) for v in tip]",
    "    return d['pay'], float(grip), bool(held)",
    "def chase_reset_motion():",
    "    d = _ARM",
    "    q = chase_queue()",
    "    d.update(queue=q, qi=0, pos=_v(arm_waypoints()['home']), dwell=0.0,",
    "             leg=q[0][1], planned=None, replans=0, phase='executing',",
    "             decel=0.0, detour_note='')",
    "def _planned_path():",
    "    # what execute_trajectory would be watching: the tool waypoints of the",
    "    # motion currently running, from where the tool is to the end of the leg",
    "    d = _ARM",
    "    if d['qi'] >= len(d['queue']): return []",
    "    tgt = d['queue'][d['qi']][0]",
    "    if d.get('detour_wps'):",
    "        pts = [d['pos']] + [_v(p) for p in d['detour_wps']]",
    "    else:",
    "        pts = [d['pos'], _v(tgt)]",
    "    out = []",
    "    import numpy as np",
    "    for i in range(len(pts) - 1):",
    "        a, b = pts[i], pts[i + 1]",
    "        n = max(2, int(np.linalg.norm(b - a) / 0.02))",
    "        out += [a + (b - a) * (j / n) for j in range(n + 1)]",
    "    return out",
    "def chase_advance(dt, sphere):",
    "    # One tick of the executor: watch, cancel, replan, then move.",
    "    import numpy as np",
    "    d = _ARM; n = d['n']",
    "    if 'queue' not in d: chase_reset_motion()",
    "    block_r = n.SPHERE_RADIUS + n.PATH_CLEARANCE",
    "    preempted = ''",
    "",
    "    if d['phase'] == 'decelerating':",
    "        d['decel'] -= dt",
    "        if d['decel'] > 0: return d['leg'], 'cancelled, waiting %.1fs for the arm to stop' % d['decel'], ''",
    "        tgt = d['queue'][d['qi']][0]",
    "        wps, note = _detour(d['pos'], tgt, sphere, block_r) if sphere is not None else (None, 'obstacle gone')",
    "        d['detour_note'] = note",
    "        if wps is None:",
    "            d['detour_wps'] = None",
    "            d['phase'] = 'executing'",
    "            return d['leg'], 'replan found nothing; holding', note",
    "        d['detour_wps'] = wps",
    "        d['replans'] += 1",
    "        d['phase'] = 'executing'",
    "        return d['leg'], 'replanned around it', note",
    "",
    "    if d['dwell'] > 0:",
    "        d['dwell'] -= dt",
    "        return d['leg'], d['leg'], d['detour_note']",
    "",
    "    # A moved obstacle is a new problem, not a continuation of the old one.",
    "    # The node re-injects its collision object once the thing shifts by",
    "    # OBSTACLE_MOVE_EPS, so the recursion cap re-arms on the same threshold --",
    "    # otherwise two detours exhaust the budget and the arm stops reacting",
    "    # while the obstacle is still moving, which is not replanning, it is",
    "    # having replanned.",
    "    import numpy as _np",
    "    if sphere is not None:",
    "        prev = d.get('seen_at')",
    "        if prev is None or float(_np.linalg.norm(sphere - prev)) > n.OBSTACLE_MOVE_EPS:",
    "            d['seen_at'] = sphere.copy()",
    "            d['replans'] = 0",
    "    else:",
    "        d['seen_at'] = None",
    "    # the watch loop: only worth checking once the sphere is real",
    "    if sphere is not None and d['replans'] < n.MAX_REPLAN_DEPTH:",
    "        path = _planned_path()",
    "        if path:",
    "            best = int(np.argmin([float(np.linalg.norm(p - d['pos'])) for p in path]))",
    "            for i in range(best, len(path)):",
    "                if float(np.linalg.norm(sphere - path[i])) < block_r:",
    "                    preempted = 'planned waypoint %d/%d inside clearance' % (i, len(path))",
    "                    break",
    "        if not preempted and float(np.linalg.norm(sphere - d['pos'])) < n.PREEMPT_DIST:",
    "            preempted = 'tool %.0f cm from the obstacle' % (",
    "                float(np.linalg.norm(sphere - d['pos'])) * 100)",
    "    if preempted:",
    "        d['phase'] = 'decelerating'",
    "        d['decel'] = n.DECEL_WAIT",
    "        d['detour_wps'] = None",
    "        return d['leg'], 'PREEMPTED: ' + preempted, ''",
    "",
    "    # Once on a detour, keep watching it. The route the arm is following is",
    "    # what _planned_path returns, so the check above already covers it -- but",
    "    # only while the budget allows, which is why the budget re-arms.",
    "    # move along whatever route is current",
    "    tgt = d['queue'][d['qi']][0]",
    "    route = [_v(p) for p in d['detour_wps']] if d.get('detour_wps') else [_v(tgt)]",
    "    step = TOOL_SPEED * dt",
    "    while step > 1e-9 and route:",
    "        to = route[0] - d['pos']",
    "        dist = float(np.linalg.norm(to))",
    "        if dist <= step:",
    "            d['pos'] = route.pop(0); step -= dist",
    "            if d.get('detour_wps'): d['detour_wps'] = d['detour_wps'][1:] or None",
    "        else:",
    "            d['pos'] = d['pos'] + to * (step / dist); step = 0.0",
    "    if not route and not d.get('detour_wps'):",
    "        d['dwell'] = d['queue'][d['qi']][2]",
    "        d['qi'] = (d['qi'] + 1) % len(d['queue'])",
    "        d['leg'] = d['queue'][d['qi']][1]",
    "        if d['qi'] == 0:",
    "            d['replans'] = 0                    # new cycle, fresh replan budget",
    "            d['pay'] = [float(v) for v in arm_waypoints()['pick']]",
    "    return d['leg'], d['leg'], d['detour_note']",
    "def _proj_path(pts):",
    "    import numpy as np",
    "    if not pts: return []",
    "    u, v = _project(_ARM['scene'].to_camera(np.array(pts)))",
    "    return [[float(a), float(b)] for a, b in zip(u, v)]",
    "def _proj_one(p):",
    "    import numpy as np",
    "    cam = _ARM['scene'].to_camera(np.array([p]))[0]",
    "    u, v = _project(np.array([cam]))",
    "    return [float(u[0]), float(v[0]), float(_ARM['n'].SPHERE_RADIUS / max(1e-3,",
    "            np.linalg.norm(cam)) * F)]",
    "def arm_frame(dt, cur_u, cur_v, radius, keep, hand):",
    "    import numpy as np",
    "    a = _ARM; s, rig, n, st = a['scene'], a['rig'], a['n'], a['st']",
    "    # The sphere the planner avoids is the one the detector injected, not the",
    "    # cursor -- they are not the same point, and the lag between them is the",
    "    # detector's.",
    "    sphere = (np.array(n._last_obstacle_xyz)",
    "              if (n._obstacle_present and n._last_obstacle_xyz is not None) else None)",
    "    leg, state, note = chase_advance(float(dt), sphere)",
    "    links, tool = _set_pose(a['pos'])",
    "    c = arm_unproject(cur_u, cur_v) if hand else None",
    "    st.clear()",
    "    before = len(rig.detections)",
    "    kw = dict(obstacle=(tuple(c), radius)) if c is not None else {}",
    "    cam, rgb, gt = s.build(a['rng'], **kw)",
    "    ms = rig.feed(cam, rgb) * 1000.0",
    "    hit = len(rig.detections) > before",
    "    near, eef = 1e9, 1e9",
    "    if c is not None:",
    "        for A, B in s.CHAIN:",
    "            p0, p1 = links[A], links[B]",
    "            d = p1 - p0; L2_ = float(d @ d)",
    "            t = 0.0 if L2_ < 1e-9 else float(np.clip((c - p0) @ d / L2_, 0.0, 1.0))",
    "            near = min(near, float(np.linalg.norm(c - (p0 + t * d))))",
    "        eef = float(np.linalg.norm(c - links['tool0']))",
    "    idx = np.linspace(0, len(cam) - 1, min(int(keep), len(cam))).astype(int)",
    "    pu, pv = _project(cam[idx])",
    "    col = rgb[idx]",
    "    P = np.array([links[k] for k in links])",
    "    lu, lv = _project(s.to_camera(P))",
    "    det = []",
    "    err = 0.0",
    "    ou = ov = orad = 0.0",
    "    if c is not None:",
    "        cu, cv = _project(s.to_camera(np.array([c])))",
    "        ou, ov = float(cu[0]), float(cv[0])",
    "        orad = float(radius / max(1e-3, np.linalg.norm(s.to_camera(np.array([c]))[0])) * F)",
    "        det = [ou, ov]",
    "        if hit:",
    "            dxyz, _dif = rig.detections[-1]",
    "            du, dv = _project(s.to_camera(np.array([dxyz])))",
    "            det = [float(du[0]), float(dv[0])]",
    "            err = float(np.linalg.norm(dxyz - gt))",
    "    # the payload, the gripper, and how far each joint is from the camera --",
    "    # the renderer needs depth to make a near link thicker than a far one",
    "    pay, grip, held = _payload(links['tool0'])",
    "    pcam = s.to_camera(np.array([pay]))",
    "    ppu, ppv = _project(pcam)",
    "    pay_uv = [float(ppu[0]), float(ppv[0]), float(max(1e-3, pcam[0][2]))]",
    "    lcam = s.to_camera(P)",
    "    depth = [float(max(1e-3, z)) for z in lcam[:, 2]]",
    "    return [[float(x) for x in pu], [float(y) for y in pv],",
    "            [int(r) << 16 | int(g) << 8 | int(b) for r, g, b in col],",
    "            ou, ov, orad, bool(hit), det, err,",
    "            (float(near) if c is not None else -1.0), ms,",
    "            int(len(cam)), int(st.get('ws', 0)), int(st.get('colour', 0)),",
    "            int(st.get('self', 0)), int(n._baseline_count or 0),",
    "            int(n._obstacle_streak), bool(n._obstacle_present),",
    "            [[float(x), float(y)] for x, y in zip(lu, lv)],",
    "            (float(eef) if c is not None else -1.0),",
    "            bool(c is not None and hit and eef < n.PREEMPT_DIST), leg,",
    "            state, note, int(a['replans']), _proj_path(_planned_path()),",
    "            (_proj_one(sphere) if sphere is not None else []),",
    "            float(n.SPHERE_RADIUS), pay_uv, grip, held, depth]",
    "_RACE = {}",
    "RACE_CTRL = [('pure_pursuit_controller', 'PurePursuitControllerNode'),",
    "             ('stanley_controller', 'StanleyControllerNode'),",
    "             ('dwa_controller', 'DWAControllerNode'),",
    "             ('teb_controller', 'TEBControllerNode'),",
    "             ('mppi_controller', 'MPPIControllerNode')]",
    "RACE_SIM_DT = 0.1                # simulated seconds per frame, same for all",
    "def _race_build(mod, cls, g, h, w, res):",
    "    # One controller, with the shared costmap under every attribute name the",
    "    # five of them use between them. Nothing here is controller-specific:",
    "    # each node reads the subset it declared and ignores the rest.",
    "    import collections",
    "    n = _defaults(object.__new__(getattr(_LOADED[mod], cls)), _SRC[mod])",
    "    info = types.SimpleNamespace(resolution=res, width=w, height=h)",
    "    for a, v in (('costmap_data', g), ('costmap_info', info), ('costmap_origin', (0.0, 0.0)),",
    "                 ('global_data', g), ('global_info', info), ('global_origin', (0.0, 0.0)),",
    "                 ('local_data', g), ('local_info', info), ('local_origin', (0.0, 0.0)),",
    "                 ('odom_to_map', (0.0, 0.0, 0.0)), ('current_vel', {'v': 0.0, 'omega': 0.0}),",
    "                 ('wp_idx', 0), ('goal_reached', False)):",
    "        setattr(n, a, v)",
    "    n.position_history = collections.deque(maxlen=50)",
    "    n.recovery_mode, n.recovery_timer, n.recovery_dir = False, 0, 1.0",
    "    n._record_pose = lambda *a, **k: None",
    "    class _S:",
    "        def __init__(s): s.last = None",
    "        def publish(s, m): s.last = m",
    "    # Every publisher the node makes becomes a sink, read out of its own",
    "    # source. Hardcoding the names means a node that adds a marker topic",
    "    # breaks the race; this way the visualisation path runs instead of",
    "    # being patched out, which is where these nodes spend real time.",
    "    import re",
    "    names = set(re.findall(r'self\\.(\\w+)\\s*=\\s*self\\.create_publisher', _SRC[mod]))",
    "    for name in names | {'cmd_pub', 'status_pub'}:",
    "        setattr(n, name, _S())",
    "    n.get_logger = lambda: types.SimpleNamespace(info=lambda *a, **k: None, warn=lambda *a, **k: None, error=lambda *a, **k: None, debug=lambda *a, **k: None)",
    "    stamp = types.SimpleNamespace(to_msg=lambda: types.SimpleNamespace(sec=0, nanosec=0))",
    "    n.get_clock = lambda: types.SimpleNamespace(now=lambda: stamp)",
    "    return n",
    "def race_init(flat, h, w, res, sr, sc, gr, gc, active):",
    "    # One plan, handed to everyone. The race is about tracking it, so the",
    "    # planner must not be a variable.",
    "    import numpy as np",
    "    raw = np.array(flat, dtype=np.int16).reshape(h, w) * 254",
    "    g = _inflate(raw, 4, res)",
    "    p = _wire(_defaults(object.__new__(getattr(_LOADED['astar_planner'], 'AStarPlannerNode')), _SRC['astar_planner']), g, h, w)",
    "    p.global_info = types.SimpleNamespace(resolution=res, width=w, height=h)",
    "    cells, _exp = p._astar((int(sr), int(sc)), (int(gr), int(gc)))",
    "    if not cells: return []",
    "    pts = [((c + 0.5) * res, (r + 0.5) * res) for r, c in cells]",
    "    P = np.array(pts)",
    "    heads = []",
    "    x0, y0 = pts[0]",
    "    import math",
    "    yaw0 = math.atan2(pts[min(4, len(pts) - 1)][1] - y0, pts[min(4, len(pts) - 1)][0] - x0)",
    "    runners = []",
    "    for i, (mod, cls) in enumerate(RACE_CTRL):",
    "        if mod not in _LOADED or not active[i]:",
    "            runners.append(None); continue",
    "        n = _race_build(mod, cls, g, h, w, res)",
    "        n._path_cb(_as_path(pts))",
    "        if getattr(n, 'current_path', None) is None: n.current_path = _as_path(pts)",
    "        n.goal_reached = False",
    "        runners.append({'n': n, 'pose': (x0, y0, yaw0), 'dt': float(getattr(n, 'dt', 0.1) or 0.1),",
    "                        'state': 'running', 'travel': 0.0, 'sim': 0.0, 'v': 0.0, 'w': 0.0,",
    "                        'xt': 0.0, 'xtn': 0, 'ms': 0.0, 'ticks': 0})",
    "    _RACE.update(runners=runners, pts=pts, P=P, raw=raw, g=g, res=res, h=h, w=w,",
    "                 goal=pts[-1], start=(x0, y0, yaw0), target=0.0)",
    "    return [[[float(a), float(b)] for a, b in pts],",
    "            [(0.0 if r is None else r['dt']) for r in runners]]",
    "def _race_tick(r):",
    "    # One tick of one controller on its own plant. The plant is the same",
    "    # unicycle for all five; only the command differs.",
    "    import math, numpy as np, time",
    "    d = _RACE; n = r['n']; dt = r['dt']",
    "    x, y, yaw = r['pose']",
    "    n._get_robot_pose = lambda p=(x, y, yaw): p",
    "    n._get_tf = lambda t, s, p=(x, y, yaw): p if 'base_link' in (t, s) else (0.0, 0.0, 0.0)",
    "    n.current_pose = types.SimpleNamespace(x=x, y=y, yaw=yaw)",
    "    n.cmd_pub.last = None",
    "    t0 = time.perf_counter()",
    "    try:",
    "        n._control_loop()",
    "    except Exception:",
    "        r['state'] = 'error'; return",
    "    r['ms'] += (time.perf_counter() - t0) * 1000.0; r['ticks'] += 1",
    "    if getattr(n, 'goal_reached', False):",
    "        r['state'] = 'reached'; r['v'] = r['w'] = 0.0; return",
    "    m = n.cmd_pub.last",
    "    v = float(getattr(m.linear, 'x', 0.0)) if m is not None else 0.0",
    "    w = float(getattr(m.angular, 'z', 0.0)) if m is not None else 0.0",
    "    if isinstance(getattr(n, 'current_vel', None), dict):",
    "        n.current_vel = {'v': v, 'omega': w}",
    "    r['v'], r['w'] = v, w",
    "    nx, ny = x + v * math.cos(yaw) * dt, y + v * math.sin(yaw) * dt",
    "    yaw = (yaw + w * dt + math.pi) % (2 * math.pi) - math.pi",
    "    r['travel'] += math.hypot(nx - x, ny - y); r['sim'] += dt",
    "    r['pose'] = (nx, ny, yaw)",
    "    # cross-track against the plan everyone was given, as a running mean",
    "    P = d['P']",
    "    r['xt'] += float(np.min(np.hypot(P[:, 0] - nx, P[:, 1] - ny))); r['xtn'] += 1",
    "    # truth for collision is the uninflated map: a centre inside the",
    "    # inflation band is a controller being brave, not a crash",
    "    rr, cc = int(ny / d['res']), int(nx / d['res'])",
    "    if not (0 <= rr < d['h'] and 0 <= cc < d['w']) or d['raw'][rr, cc] >= 253:",
    "        r['state'] = 'collided'; return",
    "    if math.hypot(nx - d['goal'][0], ny - d['goal'][1]) < 0.25:",
    "        r['state'] = 'reached'; r['v'] = r['w'] = 0.0",
    "    elif r['sim'] > 90.0:",
    "        r['state'] = 'stalled'",
    "def _race_rows():",
    "    out = []",
    "    for r in _RACE['runners']:",
    "        if r is None:",
    "            out.append([]); continue",
    "        out.append([float(r['pose'][0]), float(r['pose'][1]), float(r['pose'][2]),",
    "                    r['state'], float(r['sim']), float(r['travel']), float(r['v']),",
    "                    float(r['w']), float(r['xt'] / max(1, r['xtn'])),",
    "                    float(r['ms'] / max(1, r['ticks']))])",
    "    return out",
    "def race_step(budget_ms=28.0):",
    "    # Everyone advances the same simulated interval -- but not necessarily",
    "    # inside one animation frame.",
    "    #",
    "    # Doing a whole interval per call is what made the page lock up with MPPI",
    "    # on the line: at ~470 ms a tick it needs two ticks per 0.1 s of sim, so",
    "    # the frame blocked for most of a second and every other demo on the page",
    "    # stopped with it. Now the target sim time only moves once everyone has",
    "    # reached it, and the work toward it is spread over as many frames as it",
    "    # takes. A slow controller makes the race take longer in wall clock, which",
    "    # is honest, rather than making the tab unresponsive, which is a bug.",
    "    import time",
    "    d = _RACE",
    "    if not d: return []",
    "    t0 = time.perf_counter()",
    "    running = [r for r in d['runners'] if r is not None and r['state'] == 'running']",
    "    if not running: return _race_rows()",
    "    if all(r['sim'] >= d['target'] - 1e-9 for r in running):",
    "        d['target'] += RACE_SIM_DT",
    "    # Round-robin a tick at a time so nobody gets ahead within an interval,",
    "    # and stop as soon as the frame budget is gone.",
    "    while (time.perf_counter() - t0) * 1000.0 < budget_ms:",
    "        behind = [r for r in running",
    "                  if r['state'] == 'running' and r['sim'] < d['target'] - 1e-9]",
    "        if not behind: break",
    "        for r in behind:",
    "            if r['state'] != 'running': continue",
    "            _race_tick(r)",
    "            if (time.perf_counter() - t0) * 1000.0 >= budget_ms: break",
    "    return _race_rows()",
    "def race_done():",
    "    d = _RACE",
    "    return bool(d) and all(r is None or r['state'] != 'running' for r in d['runners'])",
    "_DWA = {}",
    "def _inflate(g, radius, res, lethal=253):",
    "    # nav2_costmap_2d's inflation layer: an exponential falloff around every",
    "    # lethal cell. Without it the costmap is binary and obstacle_cost_gain has",
    "    # nothing to grade, so the fan would show avoidance only at the last moment.",
    "    import numpy as np",
    "    big = 1e9",
    "    d = np.where(g >= lethal, 0.0, big)",
    "    for _ in range(int(radius) + 2):",
    "        p = np.pad(d, 1, constant_values=big)",
    "        d = np.minimum.reduce([d,",
    "            p[:-2, 1:-1] + 1.0,   p[2:, 1:-1] + 1.0,",
    "            p[1:-1, :-2] + 1.0,   p[1:-1, 2:] + 1.0,",
    "            p[:-2, :-2] + 1.414,  p[:-2, 2:] + 1.414,",
    "            p[2:, :-2] + 1.414,   p[2:, 2:] + 1.414])",
    "    band = (g < lethal) & (d <= radius)",
    "    scaled = np.minimum(252.0, 252.0 * np.exp(-6.0 * np.minimum(d, 1e3) * res))",
    "    out = g.copy()",
    "    out[band] = np.maximum(out[band], scaled.astype(np.int16)[band])",
    "    return out",
    "def _defaults(n, src):",
    "    import ast",
    "    for st in ast.walk(ast.parse(src)):",
    "        if isinstance(st, ast.Assign) and len(st.targets) == 1:",
    "            t = st.targets[0]",
    "            if isinstance(t, ast.Attribute) and isinstance(t.value, ast.Name) and t.value.id == 'self':",
    "                try: setattr(n, t.attr, ast.literal_eval(st.value))",
    "                except Exception: pass",
    "    return n",
    "def chase_init(pmod, pcls, cmod, ccls, kind, flat, h, w, res, radius):",
    "    # The whole stack, wired the way the launch file wires it: one global",
    "    # planner and one local controller sharing a costmap.",
    "    import numpy as np",
    "    g = _inflate(np.array(flat, dtype=np.int16).reshape(h, w) * 254, radius, res)",
    "    p = _wire(_defaults(object.__new__(getattr(_LOADED[pmod], pcls)), _SRC[pmod]), g, h, w)",
    "    p.global_info = types.SimpleNamespace(resolution=res, width=w, height=h)",
    "    # the same grid as the local costmap, with map and odom aligned: there",
    "    # is no localisation drift in a browser, and _is_path_blocked reads the",
    "    # local layer, which is where a newly seen obstacle lands on the robot",
    "    p.local_data = g",
    "    p.local_info = p.global_info",
    "    p.local_origin = (0.0, 0.0)",
    "    p.odom_to_map = (0.0, 0.0, 0.0)",
    "    c = _defaults(object.__new__(getattr(_LOADED[cmod], ccls)), _SRC[cmod])",
    "    c.costmap_data = g",
    "    c.costmap_info = types.SimpleNamespace(resolution=res, width=w, height=h)",
    "    c.costmap_origin = (0.0, 0.0)",
    "    c.current_vel = {'v': 0.0, 'omega': 0.0}",
    "    c.current_path = None",
    "    c.wp_idx = 0",
    "    c.goal_reached = False",
    "    # stuck detection and recovery, which are the node's own answer to the",
    "    # one state a local planner cannot score its way out of. deque(maxlen=)",
    "    # is not a literal so the default extractor cannot see it.",
    "    import collections",
    "    c.position_history = collections.deque(maxlen=50)",
    "    c.recovery_mode, c.recovery_timer, c.recovery_dir = False, 0, 1.0",
    "    class _Sink:",
    "        def __init__(s, k=None): s.last, s.k = None, k",
    "        def publish(s, m):",
    "            s.last = m",
    "            if s.k: _DWA[s.k] = True",
    "    c.cmd_pub = _Sink(); c.status_pub = _Sink()",
    "    c.replan_pub = _Sink('replan')",
    "    c._record_pose = lambda *a, **k: None",
    "    c.get_logger = lambda: types.SimpleNamespace(info=lambda *a, **k: None, warn=lambda *a, **k: None, error=lambda *a, **k: None, debug=lambda *a, **k: None)",
    "    # Every publisher the node makes, read out of its own source, plus a",
    "    # clock. Only DWA got away without these: the chase runs a transcribed",
    "    # loop for it, while every other controller runs its real _control_loop,",
    "    # and that publishes markers -- which need a stamp and a topic to go to.",
    "    import re as _re",
    "    for _nm in set(_re.findall(r'self\\.(\\w+)\\s*=\\s*self\\.create_publisher', _SRC[cmod])):",
    "        setattr(c, _nm, _Sink())",
    "    _stamp = types.SimpleNamespace(to_msg=lambda: types.SimpleNamespace(sec=0, nanosec=0))",
    "    c.get_clock = lambda: types.SimpleNamespace(now=lambda: _stamp)",
    "    _DWA.update(p=p, c=c, res=res, h=h, w=w, path=None, pose=(0.0, 0.0, 0.0),",
    "                replan=False)",
    "    # base_link resolves to the robot; map and odom are aligned",
    "    c._get_tf = lambda tgt, src: (_DWA['pose'] if 'base_link' in (tgt, src)",
    "                                  else (0.0, 0.0, 0.0))",
    "    p._get_tf = c._get_tf",
    "    _chase_viz(c, kind)",
    "    # Only DWA has all of these. The rest of the panel reads whatever the",
    "    # selected controller actually declares and leaves the other slots at",
    "    # zero, rather than crashing on the first attribute it does not have.",
    "    return [float(getattr(c, 'max_vel', 0.5)), float(getattr(c, 'max_yawrate', 1.5)),",
    "            float(getattr(c, 'max_accel', 0.0)), float(getattr(c, 'max_dyawrate', 0.0)),",
    "            float(getattr(c, 'dt', 0.1) or 0.1), float(getattr(c, 'predict_time', 0.0)),",
    "            float(getattr(c, 'goal_tol', 0.15)), float(getattr(c, 'wp_tol', 0.0)),",
    "            int(getattr(c, 'lookahead_wps', 0)), [int(v) for v in g.ravel()]]",
    "_CH = {}",
    "def _chase_viz(c, kind):",
    "    # Each controller's most informative internal, captured at the point it",
    "    # is computed. These wrap a getter rather than a marker publisher: the",
    "    # value is what is wanted, and the node computes it either way, so the",
    "    # control path is untouched.",
    "    _CH.clear(); _CH['kind'] = kind; _CH['viz'] = []",
    "    if kind == 'pure_pursuit' and hasattr(c, '_get_lookahead_point'):",
    "        orig = c._get_lookahead_point",
    "        def look(rx, ry, _o=orig):",
    "            t = _o(rx, ry)",
    "            _CH['viz'] = ['look', float(t.x), float(t.y)] if t is not None else []",
    "            return t",
    "        c._get_lookahead_point = look",
    "    elif kind == 'stanley' and hasattr(c, '_get_closest_point'):",
    "        orig = c._get_closest_point",
    "        def near(rx, ry, _o=orig):",
    "            out = _o(rx, ry)",
    "            try:",
    "                idx, err, _yaw = out",
    "                p = c.current_path.poses[int(idx)].pose.position",
    "                _CH['viz'] = ['near', float(p.x), float(p.y), float(err)]",
    "            except Exception:",
    "                _CH['viz'] = []",
    "            return out",
    "        c._get_closest_point = near",
    "    elif kind == 'mppi' and hasattr(c, '_publish_trajectories'):",
    "        # MPPI already samples and scores a fan; it just sends it to rviz.",
    "        # Intercepting the publish gets the real rollouts and the real costs,",
    "        # so the chase can draw for MPPI what it draws for DWA.",
    "        def traj(trajectories, costs, weights):",
    "            import numpy as np",
    "            try:",
    "                K = int(trajectories.shape[0])",
    "                idx = np.unique(np.linspace(0, K - 1, min(28, K)).astype(int))",
    "                best = int(np.argmin(costs))",
    "                _CH['fan'] = [[float(v) for v in trajectories[i, :, 0]] +",
    "                              [float(v) for v in trajectories[i, :, 1]]",
    "                              for i in idx if i != best]",
    "                _CH['best'] = ([float(v) for v in trajectories[best, :, 0]],",
    "                               [float(v) for v in trajectories[best, :, 1]])",
    "                _CH['n'] = K",
    "            except Exception:",
    "                _CH['fan'] = []; _CH['best'] = None; _CH['n'] = 0",
    "        c._publish_trajectories = traj",
    "def chase_step_any(x, y, yaw, v, w_):",
    "    # The node's own _control_loop, run unedited, with the pose and the",
    "    # measured velocity fed in where the subscriptions would put them.",
    "    #",
    "    # DWA keeps the transcribed version above because the rollout fan is the",
    "    # thing worth drawing and it only exists inside _score_trajectories.",
    "    # Nothing else on this page has an equivalent, so nothing else needs it.",
    "    import math",
    "    d = _DWA; n = d['c']",
    "    d['pose'] = (x, y, yaw)",
    "    _CH['viz'] = []",
    "    if not d['path'] or getattr(n, 'current_path', None) is None:",
    "        return [0.0, 0.0, 0, 0, [], [], [], 3, 0, []]",
    "    n.current_pose = types.SimpleNamespace(x=x, y=y, yaw=yaw)",
    "    n._get_robot_pose = lambda: (x, y, yaw)",
    "    if isinstance(getattr(n, 'current_vel', None), dict):",
    "        n.current_vel = {'v': v, 'omega': w_}",
    "    n.cmd_pub.last = None",
    "    _CH['fan'] = []; _CH['best'] = None",
    "    try:",
    "        n._control_loop()",
    "    except Exception as e:",
    "        # Report it rather than returning a silent zero: a controller that",
    "        # cannot run should say why once, not look like a stalled robot.",
    "        import traceback",
    "        _CH['err'] = traceback.format_exc().strip().split(chr(10))[-1]",
    "        return [0.0, 0.0, 0, 0, [], [], [], 5, 0, ['err', _CH['err']]]",
    "    wp = int(getattr(n, '_wp_idx', getattr(n, 'wp_idx', 0)) or 0)",
    "    if getattr(n, 'goal_reached', False):",
    "        return [0.0, 0.0, 0, 0, [], [], [], 1, wp, []]",
    "    m = n.cmd_pub.last",
    "    bv = float(getattr(m.linear, 'x', 0.0)) if m is not None else 0.0",
    "    bw = float(getattr(m.angular, 'z', 0.0)) if m is not None else 0.0",
    "    viz = _CH.get('viz') or []",
    "    if _CH.get('kind') == 'teb':",
    "        # TEB keeps its elastic band on the node, already in world metres.",
    "        band = getattr(n, 'band', None) or []",
    "        viz = ['band'] + [float(q) for pt in band for q in list(pt)[:2]]",
    "    fan = _CH.get('fan') or []",
    "    bst = _CH.get('best')",
    "    return [bv, bw, int(_CH.get('n', 0) or 0), 0,",
    "            (bst[0] if bst else []), (bst[1] if bst else []), fan, 0, wp, viz]",
    "def chase_adopt_path(flat):",
    "    # A path planned somewhere else, handed to this controller the way /plan",
    "    # would. Used when the controller runs in a worker but the planner does",
    "    # not: A* is two milliseconds and belongs where it can draw immediately.",
    "    d = _DWA; c = d['c']",
    "    pts = [(float(flat[i]), float(flat[i + 1])) for i in range(0, len(flat) - 1, 2)]",
    "    d['path'] = pts or None",
    "    if pts:",
    "        c._path_cb(_as_path(pts))",
    "    else:",
    "        c.current_path = None",
    "    return len(pts)",
    "def chase_remap(flat):",
    "    # An obstacle appeared. Re-inflate and hand both nodes the new costmap,",
    "    # which is all a fresh /local_costmap message does on the robot.",
    "    import numpy as np",
    "    d = _DWA; res, h, w = d['res'], d['h'], d['w']",
    "    g = _inflate(np.array(flat, dtype=np.int16).reshape(h, w) * 254, 4, res)",
    "    d['p'].global_data = g",
    "    d['p'].local_data = g",
    "    d['c'].costmap_data = g",
    "    return [int(v) for v in g.ravel()]",
    "def chase_gate(x, y):",
    "    # AStarPlannerNode._check_and_replan's own gates, on its own 0.5 s",
    "    # cadence. Without them the plan is only as fresh as the last goal move,",
    "    # and a robot pushed off its route by an obstacle steers at a waypoint",
    "    # it can no longer reach.",
    "    d = _DWA; p = d['p']",
    "    if d['replan']:",
    "        d['replan'] = False",
    "        return 4                    # forced by the controller, skips the gates",
    "    if not d['path']: return 1",
    "    m = _LOADED['astar_planner']",
    "    if p._is_path_blocked(x, y): return 2",
    "    if p._path_deviation(x, y) > m.MAX_PATH_DEVIATION: return 3",
    "    return 0",
    "def _nearest_free(p, r, c, h, w):",
    "    # A cursor lands wherever it lands. Snap it clear of the inflation band,",
    "    # the way a goal handler does -- and not only off lethal cells.",
    "    #",
    "    # _traversal_cost scales an inflated cell up to 500x while the octile",
    "    # heuristic still counts in plain cells, so a goal inside the band makes",
    "    # g and h differ by three orders of magnitude and A* degenerates to",
    "    # Dijkstra: 6,000 expansions and 147 ms on this 86x44 grid against 66",
    "    # and 2 ms for the same goal nudged four cells into the open.",
    "    m = _LOADED['astar_planner']",
    "    def ok(rr, cc, clear):",
    "        if not (0 <= rr < h and 0 <= cc < w): return False",
    "        v = p._merged_cell_cost(rr, cc)",
    "        return v <= m.FREE_COST if clear else v < m.LETHAL_COST",
    "    for clear in (True, False):",
    "        if ok(r, c, clear): return (r, c)",
    "        for rad in range(1, 14):",
    "            best, bd = None, 1e9",
    "            for dr in range(-rad, rad + 1):",
    "                for dc in range(-rad, rad + 1):",
    "                    if max(abs(dr), abs(dc)) != rad: continue",
    "                    if not ok(r + dr, c + dc, clear): continue",
    "                    d = dr * dr + dc * dc",
    "                    if d < bd: best, bd = (r + dr, c + dc), d",
    "            if best: return best",
    "    return None",
    "def _as_path(pts):",
    "    return types.SimpleNamespace(poses=[types.SimpleNamespace(",
    "        pose=types.SimpleNamespace(position=types.SimpleNamespace(x=a, y=b)))",
    "        for a, b in pts])",
    "def chase_plan(x, y, gx, gy):",
    "    import time",
    "    d = _DWA; p, c, res, h, w = d['p'], d['c'], d['res'], d['h'], d['w']",
    "    s = _nearest_free(p, int(y / res), int(x / res), h, w)",
    "    g = _nearest_free(p, int(gy / res), int(gx / res), h, w)",
    "    if s is None or g is None or s == g:",
    "        d['path'] = None; c.current_path = None; return [[], 0.0, 0]",
    "    t0 = time.perf_counter()",
    "    cells, expl = p._astar(s, g)",
    "    ms = (time.perf_counter() - t0) * 1000.0",
    "    if not cells:",
    "        d['path'] = None; c.current_path = None; return [[], ms, len(expl)]",
    "    d['path'] = [((cc + 0.5) * res, (rr + 0.5) * res) for rr, cc in cells]",
    "    p.current_path = _as_path(d['path'])            # the planner's replan gates",
    "    # Hand the new plan to the controller the way /plan does. _path_cb picks",
    "    # the nearest waypoint ahead of the robot rather than restarting at zero,",
    "    # which is the whole reason a tracker survives a mid-run replan.",
    "    d['pose'] = (x, y, d['pose'][2])",
    "    c._path_cb(_as_path(d['path']))",
    "    return [[v for pt in d['path'] for v in pt], ms, len(expl)]",
    "def chase_step(x, y, yaw, v, w_):",
    "    # DWAControllerNode._control_loop with the ROS plumbing removed: waypoint",
    "    # advance, goal check, forward-clearance cap, dynamic window, scored",
    "    # rollout, escape. Every one of those calls lands in the fetched file,",
    "    # and the waypoint index is the node's own.",
    "    import numpy as np, math",
    "    d = _DWA; n = d['c']; path = d['path']",
    "    d['pose'] = (x, y, yaw)",
    "    if not path or n.current_path is None: return [0.0, 0.0, 0, 0, [], [], [], 3, 0]",
    "    # stuck detection and recovery, ahead of everything else, as in the node",
    "    n.position_history.append((x, y))",
    "    if not n.recovery_mode and n._is_stuck():",
    "        n.recovery_mode, n.recovery_timer = True, 0",
    "    if n.recovery_mode:",
    "        n._recovery(x, y, yaw)",
    "        cmd = n.cmd_pub.last",
    "        return [float(cmd.linear.x), float(cmd.angular.z), 0, 0, [], [], [], 4, n.wp_idx]",
    "    last = len(n.current_path) - 1",
    "    while n.wp_idx < last:",
    "        cur = n.current_path[n.wp_idx].pose.position",
    "        nxt = n.current_path[n.wp_idx + 1].pose.position",
    "        dc = math.hypot(cur.x - x, cur.y - y)",
    "        if dc < n.wp_tol or math.hypot(nxt.x - x, nxt.y - y) < dc: n.wp_idx += 1",
    "        else: break",
    "    fin = n.current_path[-1].pose.position",
    "    if math.hypot(fin.x - x, fin.y - y) < n.goal_tol:",
    "        return [0.0, 0.0, 0, 0, [], [], [], 1, n.wp_idx]",
    "    ti = min(n.wp_idx + n.lookahead_wps, last)",
    "    gx, gy = n.current_path[ti].pose.position.x, n.current_path[ti].pose.position.y",
    "    n.current_vel = {'v': v, 'omega': w_}",
    "    fwd = n._forward_clearance(x, y, yaw)",
    "    v_cap = 0.08 if fwd < 0.35 else (0.18 if fwd < 0.7 else n.max_vel)",
    "    dw = n._dynamic_window()",
    "    dw[1] = max(dw[0], min(dw[1], v_cap))",
    "    vs = n._samples(dw[0], dw[1], n.vel_res)",
    "    ws = n._samples(dw[2], dw[3], n.yawrate_res)",
    "    bv, bw, top, xs, ys, scores, lethal, N, T = n._score_trajectories(x, y, yaw, vs, ws, gx, gy)",
    "    if not np.isfinite(top):",
    "        cost, head = float('inf'), yaw + math.pi",
    "        for a in np.arange(0.0, 2.0 * math.pi, 0.2):",
    "            c = n._costmap_value(x + 0.3 * math.cos(yaw + a), y + 0.3 * math.sin(yaw + a))",
    "            if 0 <= c < cost: cost, head = c, yaw + a",
    "        e = math.atan2(math.sin(head - yaw), math.cos(head - yaw))",
    "        return [-0.05, float(np.clip(e * 2.0, -n.max_yawrate, n.max_yawrate)),",
    "                int(N), int(T), [], [], [], 2, n.wp_idx]",
    "    best = int(np.argmax(scores))",
    "    idx = [i for i in np.unique(np.linspace(0, N - 1, min(30, N)).astype(int)) if i != best]",
    "    fan = [[float(a) for a in xs[i]] + [float(b) for b in ys[i]] for i in idx]",
    "    return [float(bv), float(np.clip(bw, -n.max_yawrate, n.max_yawrate)), int(N), int(T),",
    "            [float(a) for a in xs[best]], [float(a) for a in ys[best]], fan, 0, n.wp_idx]"
  ].join("\n");

  async function fetchSource(file) {
    for (var i = 0; i < BRANCHES.length; i++) {
      var url = "https://raw.githubusercontent.com/" + REPO + "/" + BRANCHES[i] +
                "/reactive_autonomous_nav/" + file;
      try {
        // no-cache, not no-store: still revalidated on every load, so the page
        // never shows stale code, but a repeat visit can be answered with a 304
        // and no body instead of re-downloading every file.
        var r = await fetch(url, { cache: "no-cache" });
        if (r.ok) { var t = await r.text(); return { text: t, branch: BRANCHES[i], url: url }; }
      } catch (e) { /* try next */ }
    }
    throw new Error("could not fetch " + file);
  }

  /* The predictive replanner's glue. Everything of substance is the repo's:
     ObstacleTracker, time_to_collision and deform_minimal are imported, not
     reimplemented, and the constants below are the ones its own tests use. */
  var FORESEE_PY = [
    "_PR = {}",
    "def _poses(q):",
    "    # Every link frame, orientation included. Returning only the origins is",
    "    # what made the page draw a stick figure: it has the vendor's meshes and",
    "    # needs somewhere to put them, and a position is half a pose. tool0 is",
    "    # wrist_3 through the flange, backed off the TCP's own offset, which is",
    "    # where the coupler and the Hand-E hang.",
    "    import numpy as np",
    "    from predictive_replanning import ur12e",
    "    back = np.eye(4)",
    "    back[2, 3] = -ur12e.TCP_OFFSET_Z",
    "    frames = [np.eye(4)] + list(ur12e.link_frames(q)) + [ur12e.fk_tcp(q) @ back]",
    "    return [[float(v) for v in T[:3, :4].ravel()] for T in frames]",
    "def foresee_init():",
    "    import sys",
    "    import numpy as np",
    "    if '/pr' not in sys.path: sys.path.insert(0, '/pr')",
    "    from predictive_replanning import ur12e",
    "    from predictive_replanning.predict import arm_points, arm_radii",
    "    from predictive_replanning.replan import nominal_trajectory",
    "    q0 = np.array([0.0, -1.2, 1.4, -1.6, -1.57, 0.0])",
    "    qg = np.array([1.1, -1.0, 1.2, -1.5, -1.57, 0.0])",
    "    traj, times = nominal_trajectory(q0, qg, 60, 6.0)",
    "    _PR.clear()",
    "    _PR.update(traj=traj, times=times, active=traj, trk=None, base_radius=0.09,",
    "               n_sigma=1.0, clearance=0.02, horizon=2.5, sigma_cap=0.20,",
    "               engaged=False, last_depth=0.0, last_replan=-9.0,",
    "               worse_by=0.03, min_gap=0.35, replans=0, deviation=0.0)",
    "    # What the arm sweeps over the whole plan, padded by the fattest link,",
    "    # so the camera frames the run rather than a box someone typed in.",
    "    swept = np.vstack([arm_points(q)[0] for q in traj])",
    "    pad = float(arm_radii().max())",
    "    return [[[float(v) for v in ur12e.fk_tcp_pos(q)] for q in traj],",
    "            [float(v) for v in arm_radii()], float(times[-1]),",
    "            [[float(v) - pad for v in swept.min(0)],",
    "             [float(v) + pad for v in swept.max(0)]],",
    "            [_poses(q) for q in traj]]",
    "def foresee_reset():",
    "    _PR.update(active=_PR['traj'], trk=None, engaged=False, last_depth=0.0,",
    "               last_replan=-9.0, replans=0, deviation=0.0)",
    "def foresee_step(ox, oy, oz, dt, t_now):",
    "    import numpy as np",
    "    from predictive_replanning import ur12e",
    "    from predictive_replanning.predict import (ObstacleTracker, arm_points,",
    "                                               time_to_collision)",
    "    from predictive_replanning.replan import deform_minimal",
    "    s = _PR",
    "    obs = np.array([ox, oy, oz], float)",
    "    s['trk'] = ObstacleTracker(obs) if s['trk'] is None else (s['trk'].update(obs, dt) or s['trk'])",
    "    trk = s['trk']",
    "    hs = np.linspace(0.15, s['horizon'], 8)",
    "    centres, _sg = trk.forecast(hs)",
    "    reff = trk.effective_radius(hs, s['base_radius'], s['n_sigma'], sigma_cap=s['sigma_cap'])",
    "    tube = [[float(c[0]), float(c[1]), float(c[2]), float(r)] for c, r in zip(centres, reff)]",
    "    # Everything the arm has already driven is frozen: a plan cannot edit the past.",
    "    lock = int(np.searchsorted(s['times'], t_now))",
    "    ttc, idx, depth = time_to_collision(s['active'], s['times'], t_now, trk,",
    "                                        base_radius=s['base_radius'], n_sigma=s['n_sigma'],",
    "                                        clearance=s['clearance'], horizon=s['horizon'],",
    "                                        sigma_cap=s['sigma_cap'])",
    "    # Hysteresis on the threat, not on the clock -- run.py's own rule, and its",
    "    # own two constants. Re-deforming the running trajectory on every frame",
    "    # compounds: the repo measured that as replans going 2.5 -> 18.8 a run.",
    "    # Here it showed up as 21 rad of accumulated deviation and a path tied in",
    "    # knots. A threat that is new fires at once; one merely getting worse has",
    "    # to clear a floor as well; a clear path stands the whole thing down.",
    "    iters, dev, cleared = 0, 0.0, 0",
    "    if ttc is None:",
    "        s['engaged'], s['last_depth'] = False, 0.0",
    "    else:",
    "        gap = t_now - s['last_replan']",
    "        worse = depth > s['last_depth'] + s['worse_by'] and gap >= s['min_gap']",
    "        if (not s['engaged'] and gap >= s['min_gap']) or worse:",
    "            # Deform the *nominal* future, not the last deformation, keeping",
    "            # whatever has already been driven. run.py deforms its running",
    "            # trajectory and gets away with it because its obstacle passes",
    "            # through and the threat stands down; a cursor can be parked in",
    "            # the path forever, and each replan then pushes off the last one",
    "            # -- measured at 86 cm of tool displacement on an arm with about",
    "            # a metre of reach. From the nominal, the deviation is always",
    "            # just what clears the tube in front of it now.",
    "            base = np.vstack([s['active'][:lock], s['traj'][lock:]]) if lock else s['traj']",
    "            new, dv, it, ok = deform_minimal(base, s['times'], t_now, trk,",
    "                                            base_radius=s['base_radius'], n_sigma=s['n_sigma'],",
    "                                            clearance=s['clearance'], horizon=s['horizon'],",
    "                                            sigma_cap=s['sigma_cap'], lock_before=lock)",
    "            if ok: s['active'] = new",
    "            iters, dev, cleared = int(it), float(dv), int(bool(ok))",
    "            s['last_replan'], s['replans'] = t_now, s['replans'] + 1",
    "            s['deviation'] += float(dv)",
    "            s['engaged'], s['last_depth'] = (not ok), depth",
    "    # How far the tool has been pushed off the plan, in metres. The",
    "    # deformation's own figure is a sum of joint angles over every waypoint,",
    "    # which grows without bound across replans and means nothing to look at.",
    "    shift = max(float(np.linalg.norm(ur12e.fk_tcp_pos(a) - ur12e.fk_tcp_pos(b)))",
    "                for a, b in zip(s['active'], s['traj']))",
    "    q = s['active'][min(lock, len(s['active']) - 1)]",
    "    pts = arm_points(q)[0]",
    "    return [tube, -1.0 if ttc is None else float(ttc), -1 if idx is None else int(idx),",
    "            float(depth), int(s['replans']), float(shift), cleared,",
    "            [[float(a) for a in p] for p in pts],",
    "            [float(v) for v in trk.x[:3]],",
    "            [[float(v) for v in ur12e.fk_tcp_pos(a)] for a in s['active']],",
    "            _poses(q)]"
  ].join("\n");

  /* ---------- a painter's-algorithm renderer, in the 2D canvas ---------
     Enough of one to draw a robot: transform, project, cull, sort by depth,
     fill. There is no depth buffer, so triangles go down far-to-near, which is
     also what makes the translucent ones composite correctly on the way past.
     Everything in the scene -- the arm, the forecast cone, the trajectory --
     goes through the same sink, so the cone can pass in front of the forearm
     and behind the upper arm in the same frame without any special case.

     Measured in headless Chromium, which rasterises canvas in software and is
     the pessimistic case: 4000 filled triangles cost 1.7 ms, 8000 cost 3.6 ms.
     This scene draws about 6000. Pyodide is the expensive part of the frame.
     ------------------------------------------------------------------- */
  var BUCKETS = 512;

  function makeSink(cap) {
    var n = 0;
    var xs = new Float32Array(cap * 3), ys = new Float32Array(cap * 3);
    var dz = new Float32Array(cap), ci = new Int32Array(cap);
    var cnt = new Int32Array(BUCKETS), head = new Int32Array(BUCKETS);
    var order = new Int32Array(cap);
    var pal = [], seen = {};
    return {
      /* Colours are interned once and referred to by index. Building an
         "rgb(...)" string per triangle per frame is most of a millisecond. */
      colour: function (css) {
        var k = seen[css];
        if (k === undefined) { k = pal.length; pal.push(css); seen[css] = k; }
        return k;
      },
      count: function () { return n; },
      push: function (ax, ay, bx, by, cx, cy, depth, col) {
        if (n >= cap) return;
        var o = n * 3;
        // One winding for everything. Filling a batch as a single path is what
        // removes the hairline seams between neighbouring triangles, and the
        // nonzero rule only merges them if they turn the same way.
        if ((bx - ax) * (cy - ay) - (by - ay) * (cx - ax) < 0) {
          var tx = bx, ty = by; bx = cx; by = cy; cx = tx; cy = ty;
        }
        xs[o] = ax; ys[o] = ay; xs[o + 1] = bx; ys[o + 1] = by;
        xs[o + 2] = cx; ys[o + 2] = cy;
        dz[n] = depth; ci[n] = col; n++;
      },
      /* Counting sort into depth buckets. A comparator sort of six thousand
         triangles costs more than all the fills together; a bucket here is a
         five-hundredth of the scene's depth, far finer than the projection can
         show. Runs of one colour are then filled as a single path. */
      flush: function (g) {
        if (!n) return;
        var i, b, mn = Infinity, mx = -Infinity;
        for (i = 0; i < n; i++) { if (dz[i] < mn) mn = dz[i]; if (dz[i] > mx) mx = dz[i]; }
        var sc = mx > mn ? (BUCKETS - 1) / (mx - mn) : 0;
        cnt.fill(0);
        for (i = 0; i < n; i++) cnt[(dz[i] - mn) * sc | 0]++;
        var acc = 0;
        for (b = BUCKETS - 1; b >= 0; b--) { head[b] = acc; acc += cnt[b]; }
        for (i = 0; i < n; i++) order[head[(dz[i] - mn) * sc | 0]++] = i;
        var cur = -1;
        for (i = 0; i < n; i++) {
          var t = order[i], o = t * 3;
          if (ci[t] !== cur) {
            if (cur >= 0) { g.fillStyle = pal[cur]; g.fill(); }
            g.beginPath(); cur = ci[t];
          }
          g.moveTo(xs[o], ys[o]); g.lineTo(xs[o + 1], ys[o + 1]);
          g.lineTo(xs[o + 2], ys[o + 2]); g.closePath();
        }
        if (cur >= 0) { g.fillStyle = pal[cur]; g.fill(); }
        n = 0;
      },
      reset: function () { n = 0; }
    };
  }

  /* Perspective camera on a turntable: azimuth, elevation, distance. `fit`
     picks the distance by projecting the corners of a world box and closing in
     until they just fit, so the framing follows the scene rather than a
     hard-coded number. */
  function makeCam(w, h, az, el, target, fl) {
    var cam = { w: w, h: h, fl: fl, cx: w / 2, cy: h / 2 };
    cam.aim = function (az, el, target, dist) {
      var ce = Math.cos(el), f = [ce * Math.cos(az), ce * Math.sin(az), Math.sin(el)];
      cam.eye = [target[0] + f[0] * dist, target[1] + f[1] * dist, target[2] + f[2] * dist];
      var d = [-f[0], -f[1], -f[2]];
      var r = [-d[1], d[0], 0];                        // up x d, with up = +z
      var rl = Math.hypot(r[0], r[1]) || 1;
      r = [r[0] / rl, r[1] / rl, 0];
      cam.d = d;
      cam.r = r;
      cam.u = [d[1] * r[2] - d[2] * r[1], d[2] * r[0] - d[0] * r[2], d[0] * r[1] - d[1] * r[0]];
      return cam;
    };
    /* Closes in until the box just fits, then shifts the principal point so
       the box sits in the middle of the canvas, then does it again: an oblique
       view of a box is not centred on the projection of its centre, and
       fitting without the shift leaves a third of the frame empty floor. */
    cam.fit = function (pts, margin) {
      for (var round = 0; round < 3; round++) {
        var lo = 0.5, hi = 14.0;
        for (var it = 0; it < 30; it++) {
          var mid = (lo + hi) / 2;
          cam.aim(az, el, target, mid);
          if (ok(pts, margin)) hi = mid; else lo = mid;
        }
        cam.aim(az, el, target, hi);
        cam.dist0 = hi;
        var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (var i = 0; i < pts.length; i++) {
          var q = cam.project(pts[i]);
          if (!q) continue;
          if (q[0] < x0) x0 = q[0];
          if (q[0] > x1) x1 = q[0];
          if (q[1] < y0) y0 = q[1];
          if (q[1] > y1) y1 = q[1];
        }
        if (x0 > x1) break;
        cam.cx += w / 2 - (x0 + x1) / 2;
        cam.cy += h / 2 - (y0 + y1) / 2;
      }
      return cam;
    };
    function ok(pts, margin) {
      for (var i = 0; i < pts.length; i++) {
        var s = cam.project(pts[i]);
        if (!s) return false;
        if (s[0] < margin || s[0] > w - margin || s[1] < margin || s[1] > h - margin) return false;
      }
      return true;
    }
    cam.project = function (p) {
      var ex = p[0] - cam.eye[0], ey = p[1] - cam.eye[1], ez = p[2] - cam.eye[2];
      var z = ex * cam.d[0] + ey * cam.d[1] + ez * cam.d[2];
      if (z < 0.05) return null;
      var inv = cam.fl / z;
      return [cam.cx + (ex * cam.r[0] + ey * cam.r[1] + ez * cam.r[2]) * inv,
              cam.cy - (ex * cam.u[0] + ey * cam.u[1] + ez * cam.u[2]) * inv, z];
    };
    /* Screen point back onto a horizontal plane. This is how the cursor moves
       the obstacle: a ray out of the eye, met with z = `zp`. */
    cam.onPlane = function (sx, sy, zp) {
      var a = (sx - cam.cx) / cam.fl, b = -(sy - cam.cy) / cam.fl;
      var dx = cam.d[0] + a * cam.r[0] + b * cam.u[0];
      var dy = cam.d[1] + a * cam.r[1] + b * cam.u[1];
      var dz2 = cam.d[2] + a * cam.r[2] + b * cam.u[2];
      if (Math.abs(dz2) < 1e-6) return null;
      var t = (zp - cam.eye[2]) / dz2;
      if (t <= 0) return null;
      return [cam.eye[0] + dx * t, cam.eye[1] + dy * t, zp];
    };
    return cam.aim(az, el, target, 3.0);
  }

  /* The robot itself: the vendor's own meshes, positioned by the same joint
     frames the planner computes. `assets/ur12e.json` carries one triangle soup
     per link in that link's own frame, already through the URDF's mesh_offset,
     so drawing a pose is a matrix per link and nothing else. tools/bake_arm.py
     writes it, and says where every vertex came from. */
  var SHADES = 22;                 // quantised so the colour strings are reused
  var AMBIENT = 0.34;

  /* The key light rides on the camera: over the eye, up and to the left. A
     light fixed in the world is flattering from one side and a silhouette from
     the other, and the view here is chosen from the data rather than set by
     hand, so which side it lands on is not something to leave to luck. */
  function keyLight(cam) {
    var x = -cam.d[0] + 0.55 * cam.u[0] - 0.30 * cam.r[0];
    var y = -cam.d[1] + 0.55 * cam.u[1] - 0.30 * cam.r[1];
    var z = -cam.d[2] + 0.55 * cam.u[2] - 0.30 * cam.r[2];
    var n = Math.hypot(x, y, z) || 1;
    return [x / n, y / n, z / n];
  }

  function makeArm(doc, sink) {
    var links = [], most = 0;
    for (var i = 0; i < doc.links.length; i++) {
      var parts = [];
      for (var j = 0; j < doc.links[i].parts.length; j++) {
        var p = doc.links[i].parts[j];
        var v = new Float32Array(p.v.length);
        for (var k = 0; k < p.v.length; k++) v[k] = p.v[k] * doc.unit;
        most = Math.max(most, v.length / 3);
        var ramp = new Int32Array(SHADES);
        for (var s = 0; s < SHADES; s++) {
          var t = s / (SHADES - 1);
          // A flat multiply leaves the near-black trim shapeless, so the light
          // adds as well as scales. Both terms are the material's, not a tint.
          ramp[s] = sink.colour("rgb(" +
            Math.min(255, Math.round(p.c[0] * t + 44 * t)) + "," +
            Math.min(255, Math.round(p.c[1] * t + 44 * t)) + "," +
            Math.min(255, Math.round(p.c[2] * t + 44 * t)) + ")");
        }
        parts.push({ v: v, f: new Int32Array(p.f), ramp: ramp });
      }
      links.push(parts);
    }
    var wx = new Float32Array(most), wy = new Float32Array(most), wz = new Float32Array(most);
    var sx = new Float32Array(most), sy = new Float32Array(most), sz = new Float32Array(most);

    return {
      links: links.length,
      /* `poses` is one row-major 3x4 per link, straight out of the FK. */
      draw: function (cam, poses) {
        var ex = cam.eye[0], ey = cam.eye[1], ez = cam.eye[2];
        var d0 = cam.d[0], d1 = cam.d[1], d2 = cam.d[2];
        var r0 = cam.r[0], r1 = cam.r[1], r2 = cam.r[2];
        var u0 = cam.u[0], u1 = cam.u[1], u2 = cam.u[2];
        var L = keyLight(cam), L0 = L[0], L1 = L[1], L2 = L[2];
        for (var li = 0; li < links.length && li < poses.length; li++) {
          var T = poses[li];
          for (var pi = 0; pi < links[li].length; pi++) {
            var part = links[li][pi], v = part.v, f = part.f, ramp = part.ramp;
            var nv = v.length / 3, i, o;
            for (i = 0; i < nv; i++) {
              o = i * 3;
              var a = v[o], b = v[o + 1], c = v[o + 2];
              var X = T[0] * a + T[1] * b + T[2] * c + T[3];
              var Y = T[4] * a + T[5] * b + T[6] * c + T[7];
              var Z = T[8] * a + T[9] * b + T[10] * c + T[11];
              wx[i] = X; wy[i] = Y; wz[i] = Z;
              var qx = X - ex, qy = Y - ey, qz = Z - ez;
              var z = qx * d0 + qy * d1 + qz * d2;
              sz[i] = z;
              var inv = cam.fl / (z > 0.05 ? z : 0.05);
              sx[i] = cam.cx + (qx * r0 + qy * r1 + qz * r2) * inv;
              sy[i] = cam.cy - (qx * u0 + qy * u1 + qz * u2) * inv;
            }
            for (i = 0; i < f.length; i += 3) {
              var A = f[i], B = f[i + 1], C = f[i + 2];
              var za = sz[A], zb = sz[B], zc = sz[C];
              if (za < 0.05 || zb < 0.05 || zc < 0.05) continue;
              var e1x = wx[B] - wx[A], e1y = wy[B] - wy[A], e1z = wz[B] - wz[A];
              var e2x = wx[C] - wx[A], e2y = wy[C] - wy[A], e2z = wz[C] - wz[A];
              var nx = e1y * e2z - e1z * e2y;
              var ny = e1z * e2x - e1x * e2z;
              var nz = e1x * e2y - e1y * e2x;
              // Facing test in world space: the outward normal must lean back
              // towards the eye. Doing it here rather than from the screen
              // winding keeps it independent of which way y runs on a canvas.
              if (nx * (wx[A] - ex) + ny * (wy[A] - ey) + nz * (wz[A] - ez) >= 0) continue;
              var nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
              var lam = (nx * L0 + ny * L1 + nz * L2) / nl;
              var sh = AMBIENT + (1 - AMBIENT) * (lam > 0 ? lam : 0);
              var lvl = (sh * (SHADES - 1) + 0.5) | 0;
              sink.push(sx[A], sy[A], sx[B], sy[B], sx[C], sy[C],
                        (za + zb + zc) / 3, ramp[lvl > SHADES - 1 ? SHADES - 1 : lvl]);
            }
          }
        }
      }
    };
  }

  /* ---------- the annotations, in the same depth sort as the robot ----- */
  function makeMarks(sink) {
    var ring = [];                                   // unit circle, precomputed
    for (var i = 0; i <= 24; i++) {
      ring.push([Math.cos(i / 24 * 6.283185), Math.sin(i / 24 * 6.283185)]);
    }
    /* A camera-facing disc. `col` may be -1 for an outline only: two dozen
       translucent fills piled on each other stop reading as a sphere and start
       reading as a smudge, which is what the arm's collision model did. */
    function disc(cam, p, radius, col, edge) {
      var s = cam.project(p);
      if (!s) return;
      var rr = cam.fl * radius / s[2];
      if (rr < 0.6) return;
      // Segments by how big it lands. A dozen around a sphere the size of a
      // fingernail is detail nobody sees, and there are thirty of them.
      var st = rr > 20 ? 1 : rr > 8 ? 2 : 4;
      var i;
      if (col >= 0) {
        for (i = 0; i < 24; i += st) {
          sink.push(s[0], s[1],
                    s[0] + rr * ring[i][0], s[1] + rr * ring[i][1],
                    s[0] + rr * ring[i + st][0], s[1] + rr * ring[i + st][1], s[2], col);
        }
      }
      if (edge === undefined) return;
      var w = 1.1;
      for (i = 0; i < 24; i += st) {
        var ax = s[0] + rr * ring[i][0], ay = s[1] + rr * ring[i][1];
        var bx = s[0] + rr * ring[i + st][0], by = s[1] + rr * ring[i + st][1];
        var ix = s[0] + (rr - w) * ring[i][0], iy = s[1] + (rr - w) * ring[i][1];
        var jx = s[0] + (rr - w) * ring[i + st][0], jy = s[1] + (rr - w) * ring[i + st][1];
        sink.push(ax, ay, bx, by, ix, iy, s[2] - 1e-4, edge);
        sink.push(bx, by, jx, jy, ix, iy, s[2] - 1e-4, edge);
      }
    }
    /* A world segment as a screen-space ribbon of constant pixel width. Depth
       is the near end, so a path crossing the arm is cut where it should be. */
    function bar(cam, a, b, px, col) {
      var p = cam.project(a), q = cam.project(b);
      if (!p || !q) return;
      var dx = q[0] - p[0], dy = q[1] - p[1], L = Math.hypot(dx, dy);
      if (L < 0.01) return;
      var nx = -dy / L * px, ny = dx / L * px, z = Math.min(p[2], q[2]);
      sink.push(p[0] + nx, p[1] + ny, q[0] + nx, q[1] + ny, q[0] - nx, q[1] - ny, z, col);
      sink.push(p[0] + nx, p[1] + ny, q[0] - nx, q[1] - ny, p[0] - nx, p[1] - ny, z, col);
    }
    function path(cam, pts, px, col, step) {
      for (var i = 0; i + 1 < pts.length; i += (step || 1)) bar(cam, pts[i], pts[i + 1], px, col);
    }
    /* A flat disc lying in the z = 0 plane. Not a billboard: it is the shadow,
       and it has to foreshorten with the floor or it reads as a balloon. */
    function patch(cam, x, y, radius, col) {
      var c = cam.project([x, y, 0.001]);
      if (!c) return;
      var prev = null;
      for (var i = 0; i <= 24; i++) {
        var s = cam.project([x + radius * ring[i][0], y + radius * ring[i][1], 0.001]);
        if (prev && s) sink.push(c[0], c[1], prev[0], prev[1], s[0], s[1], c[2] + 0.02, col);
        prev = s;
      }
    }
    return { disc: disc, bar: bar, path: path, patch: patch };
  }

  /* ---------- see it coming: track, forecast, deform ------------------
     The arm is the real one: `assets/ur12e.json` is Universal Robots' own
     visual meshes for the UR12e, decimated, drawn at the joint frames the
     planner's own FK returns. It used to be a polyline through those frames,
     which is the skeleton the planner reasons about and not the robot.

     The cone is the whole point -- it is drawn from the tracker's own forecast
     covariance, not from a shape chosen to look like one -- so the reader can
     watch it open with the horizon and then saturate where sigma_cap puts it.
     ------------------------------------------------------------------- */
  var foresee = (function () {
    var cvf = fitCanvas(document.getElementById("foresee-canvas"), 0.62, 0.92);
    if (!cvf) return { start: function () {} };
    var g = cvf.getContext("2d");
    var readEl = document.getElementById("foresee-read");
    var runEl = document.getElementById("foresee-run");
    var nominal = [], radii = [], poseTrack = [], duration = 6.0, planeZ = 0.32;
    var live = false, t = 0, raf = 0, last = 0, busy = false;
    var state = null, cursor = null;
    var sink = makeSink(24000), marks = makeMarks(sink), arm = null, cam = null;
    var GRID = 0;                    // half-width of the floor, in 0.25 m cells

    var INK = sink.colour("rgba(65,65,76,0.85)");
    var PLAN = sink.colour("rgba(150,150,164,0.85)");
    var WARN = sink.colour("rgba(154,74,38,0.90)");
    var SAFE = sink.colour("rgba(63,107,87,0.90)");
    var OBST = sink.colour("rgba(154,74,38,0.55)");
    var EDGE = sink.colour("rgba(122,58,30,0.85)");
    var SHADOW = sink.colour("rgba(65,65,76,0.10)");
    var HULL = sink.colour("rgba(65,65,76,0.16)");
    var CONE = [], CONE_EDGE = sink.colour("rgba(154,74,38,0.22)");
    for (var ci = 0; ci < 12; ci++) {
      CONE.push(sink.colour("rgba(154,74,38," + (0.030 + 0.055 * (1 - ci / 12)).toFixed(3) + ")"));
    }

    /* The camera frames the box the arm actually sweeps, which foresee_init
       measures over the whole nominal trajectory rather than guessing. */
    function place(bounds) {
      // foresee_init already padded these by the fattest link radius, so the
      // margin here is only to keep the silhouette off the canvas edge.
      var lo = bounds[0], hi = bounds[1], pad = 0.03;
      var box = [];
      for (var i = 0; i < 8; i++) {
        box.push([(i & 1 ? hi[0] + pad : lo[0] - pad),
                  (i & 2 ? hi[1] + pad : lo[1] - pad),
                  (i & 4 ? hi[2] + pad : Math.min(lo[2], 0.0))]);
      }
      var mid = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (Math.min(lo[2], 0) + hi[2]) / 2];
      GRID = Math.ceil(Math.max(Math.abs(lo[0]), Math.abs(hi[0]),
                                Math.abs(lo[1]), Math.abs(hi[1])) / 0.25);
      // Looking across the reach rather than down it: at the azimuth the arm
      // itself points, a six-jointed robot projects to a blob.
      cam = makeCam(cvf._w, cvf._h, 1.70, 0.34, mid, cvf._h * 1.45);
      return cam.fit(box, 6);
    }

    function floor() {
      // The mounting plane, ruled every 0.25 m. It is the only thing in the
      // scene with a size the reader already knows, so it is what makes the
      // cone's width readable as a distance rather than as a shape.
      var e = GRID * 0.25;
      g.save();
      g.lineWidth = 1;
      for (var k = -GRID; k <= GRID; k++) {
        var v = k * 0.25;
        g.strokeStyle = k === 0 ? "#dcdce4" : "#ececf2";
        line([v, -e, 0], [v, e, 0]);
        line([-e, v, 0], [e, v, 0]);
      }
      g.restore();
    }
    function line(a, b) {
      var p = cam.project(a), q = cam.project(b);
      if (!p || !q) return;
      g.beginPath(); g.moveTo(p[0], p[1]); g.lineTo(q[0], q[1]); g.stroke();
    }

    function draw() {
      g.clearRect(0, 0, cvf._w, cvf._h);
      g.fillStyle = "#fbfbfd"; g.fillRect(0, 0, cvf._w, cvf._h);
      if (!cam) return;
      floor();
      sink.reset();

      marks.path(cam, nominal, 1.1, PLAN, 2);

      // Before the cursor arrives there is no tracker and no threat, but there
      // is still a plan: the arm drives it, so the section is a robot rather
      // than an empty floor while the reader is reading the paragraph above.
      var poses = null;
      if (poseTrack.length) {
        var w = Math.round(t / duration * (poseTrack.length - 1));
        poses = poseTrack[w < 0 ? 0 : w >= poseTrack.length ? poseTrack.length - 1 : w];
      }
      if (state) {
        var tube = state[0], ttc = state[1], iters = state[4], dev = state[5];
        var pts = state[7], est = state[8], active = state[9];
        poses = state[10];

        // the cone, from the tracker's forecast: a sphere per horizon, radius
        // r_obstacle + n_sigma * sigma(h), saturating where sigma_cap puts it
        for (var i = 0; i < tube.length; i++) {
          marks.disc(cam, tube[i], tube[i][3], CONE[Math.min(CONE.length - 1, i)], CONE_EDGE);
        }
        marks.path(cam, active, 2.0, ttc > 0 ? WARN : SAFE);
      }
      if (arm && poses) arm.draw(cam, poses);
      if (state) {
        // what the planner checks: a sphere per skeleton point, sized to cover
        // the real link. An outline, because the robot underneath is the point.
        for (var k = 0; k < pts.length; k++) marks.disc(cam, pts[k], radii[k] || 0.05, -1, HULL);

        if (cursor) {
          marks.patch(cam, cursor[0], cursor[1], 0.05, SHADOW);
          marks.bar(cam, [cursor[0], cursor[1], 0], cursor, 0.8, SHADOW);
          marks.disc(cam, cursor, 0.05, OBST, EDGE);
        }
        marks.disc(cam, est, 0.028, INK);        // where the filter thinks it is

        var tubeTxt = "tube " + tube[0][3].toFixed(2) + " m → " +
                      tube[tube.length - 1][3].toFixed(2) + " m";
        readEl.textContent = ttc > 0
          ? "collision in " + ttc.toFixed(2) + " s  ·  " + iters + " replan" +
            (iters === 1 ? "" : "s") + ", tool " + (dev * 100).toFixed(0) +
            " cm off the plan  ·  " + tubeTxt
          : "clear over the 2.5 s horizon  ·  " + iters + " replan" +
            (iters === 1 ? "" : "s") + " so far  ·  " + tubeTxt;
      }
      sink.flush(g);
    }

    function tick(now) {
      raf = requestAnimationFrame(tick);
      if (!live) return;
      var dt = last ? Math.min(0.05, (now - last) / 1000) : 0.02;
      last = now;
      t += dt;
      if (t > duration) { t = 0; pyodide.runPython("foresee_reset()"); }
      if (busy || !cursor) { draw(); return; }
      busy = true;
      try {
        pyodide.globals.set("__ox", cursor[0]);
        pyodide.globals.set("__oy", cursor[1]);
        pyodide.globals.set("__oz", cursor[2]);
        pyodide.globals.set("__dt", dt);
        pyodide.globals.set("__t", t);
        state = pyodide.runPython("foresee_step(__ox, __oy, __oz, __dt, __t)").toJs();
      } catch (e) { /* one bad frame must not kill the loop */ }
      busy = false;
      draw();
    }

    function at(ev) {
      var b = cvf.getBoundingClientRect();
      var pt = ev.touches ? ev.touches[0] : ev;
      if (!cam) return null;
      return cam.onPlane((pt.clientX - b.left) / b.width * cvf._w,
                         (pt.clientY - b.top) / b.height * cvf._h, planeZ);
    }

    return {
      /* `mesh` is assets/ur12e.json; without it the section still runs, it just
         has nothing to draw the robot with, so it is not allowed to throw. */
      start: function (meta, mesh) {
        nominal = meta[0]; radii = meta[1]; duration = meta[2]; poseTrack = meta[4];
        planeZ = nominal.reduce(function (a, p) { return a + p[2]; }, 0) / nominal.length;
        place(meta[3]);
        if (mesh) arm = makeArm(mesh, sink);
        cursor = null; live = true; t = 0; last = 0;
        // Loaded, but nothing to report until there is an obstacle to track --
        // leaving the loading line up reads as a demo that never finished.
        readEl.textContent = "move the cursor into the cell · " +
          nominal.length + " waypoints over " + duration.toFixed(1) + " s";
        cvf.addEventListener("pointermove", function (e) { cursor = at(e); });
        cvf.addEventListener("pointerleave", function () { cursor = null; });
        cvf.addEventListener("touchmove", function (e) { cursor = at(e); e.preventDefault(); },
                             { passive: false });
        if (runEl) runEl.addEventListener("click", function () {
          t = 0; pyodide.runPython("foresee_reset()"); state = null; draw();
        });
        if (!raf) raf = requestAnimationFrame(tick);
        draw();
      }
    };
  })();

  async function bootForesee(pending, meshPending) {
    if (!document.getElementById("foresee-canvas")) return;
    try {
      log("loading the predictive replanner from " + FORESEE.repo + "…");
      var texts = await Promise.all(pending || FORESEE.files.map(fetchForeseeFile));
      for (var i = 0; i < FORESEE.files.length; i++) {
        pyodide.globals.set("__src", texts[i]);
        pyodide.globals.set("__path", "/pr/" + FORESEE.files[i]);
        pyodide.runPython("arm_write(__path, __src)");
        log("  " + FORESEE.files[i] + "  " + texts[i].length.toLocaleString() + " bytes");
      }
      pyodide.globals.set("__path", "/pr/predictive_replanning/__init__.py");
      pyodide.globals.set("__src", "");
      pyodide.runPython("arm_write(__path, __src)");
      pyodide.runPython(FORESEE_PY);
      var meta = pyodide.runPython("foresee_init()").toJs();
      // The meshes are a nicety; the replanner is the demo. If they failed to
      // arrive the section still runs, without a robot to look at.
      var mesh = null;
      try { mesh = await meshPending; } catch (e) {
        log("  " + FORESEE.mesh + " unavailable: " + String(e && e.message || e), "err");
      }
      foresee.start(meta, mesh);
      live("foresee-canvas");
      log("predictive replanner online: " + meta[0].length + "-waypoint plan over " +
          meta[2].toFixed(1) + " s, " + meta[1].length + " collision spheres on the arm", "ok");
      if (mesh) {
        log("  UR12e and Hand-E meshes: " + mesh.triangles.toLocaleString() +
            " triangles from " + mesh.sources.ur_description.commit.slice(0, 7) + " and " +
            mesh.sources.hande_description.commit.slice(0, 7), "ok");
      }
    } catch (e) {
      log("predictive replanner unavailable: " + String(e && e.message || e)
          .split("\n").slice(-3).join(" | "), "err");
    }
  }

  async function fetchForeseeMesh() {
    var r = await fetch(FORESEE.mesh, { cache: "no-cache" });
    if (!r.ok) throw new Error(FORESEE.mesh + ": HTTP " + r.status);
    return r.json();
  }

  async function fetchForeseeFile(rel) {
    var url = "https://raw.githubusercontent.com/" + FORESEE.repo + "/" +
              FORESEE.branch + "/" + rel;
    var r = await fetch(url, { cache: "no-cache" });
    if (!r.ok) throw new Error(rel + ": HTTP " + r.status);
    return r.text();
  }

  async function fetchArmFile(rel) {
    var url = "https://raw.githubusercontent.com/" + ARM.repo + "/" + ARM.branch + "/" + rel;
    var r = await fetch(url, { cache: "no-cache" });
    if (!r.ok) throw new Error(rel + ": HTTP " + r.status);
    return r.text();
  }

  async function boot() {
    try {
      /* Everything that can be in flight at once, is.
         The Python is plain text on a CDN and the runtime is a wasm bundle on
         another; neither download knows the other exists, and no source needs
         an interpreter to arrive. Awaited in sequence -- runtime, then numpy,
         then thirteen files one at a time -- the page paid for every round trip
         end to end. Started together it pays for the slowest one.
         The awaits below are then all on promises that are already resolving,
         so the order they are read in is still the order they are logged in.
         That is deliberate: the log is the load-bearing part of this page and a
         race-ordered one would be unreadable. */
      log("loading pyodide runtime…");
      var srcP = {};
      for (var mk in MODULES) srcP[MODULES[mk].file] = fetchSource(MODULES[mk].file);
      if (!srcP[DWA.file]) srcP[DWA.file] = fetchSource(DWA.file);
      for (var ri = 0; ri < RACERS.length; ri++) {
        if (!srcP[RACERS[ri].file]) srcP[RACERS[ri].file] = fetchSource(RACERS[ri].file);
      }
      var armP = ARM.files.map(function (rel) { return fetchArmFile(rel); });
      var seeP = FORESEE.files.map(function (rel) { return fetchForeseeFile(rel); });
      var meshP = fetchForeseeMesh();
      meshP.catch(function () {});
      // A rejected promise nobody has awaited yet is an unhandled rejection.
      // These are all awaited below, but not before the browser notices.
      Object.keys(srcP).forEach(function (k) { srcP[k].catch(function () {}); });
      armP.forEach(function (q) { q.catch(function () {}); });
      seeP.forEach(function (q) { q.catch(function () {}); });

      // After the fetches, not before: if the runtime script failed to arrive
      // this call throws synchronously, and there is no reason to lose the
      // downloads to that.
      var pyReady = loadPyodide({ indexURL: "https://cdn.jsdelivr.net/pyodide/v0.26.2/full/" })
        .then(function (p) { return p.loadPackage("numpy").then(function () { return p; }); });
      window.__pyodide = pyodide = await pyReady;
      log("pyodide " + pyodide.version, "ok");
      log("numpy ready", "ok");
      pyodide.runPython(BOOTSTRAP);
      log("ros stubbed at the import boundary", "ok");

      var fetched = {};                 // kept so the race worker can reuse them
      for (var key in MODULES) {
        var m = MODULES[key];
        var src = await srcP[m.file];
        fetched[m.file.replace(".py", "")] = src.text;
        pyodide.globals.set("__src", src.text);
        pyodide.globals.set("__name_", m.file.replace(".py", ""));
        var found = pyodide.runPython("load_module(__name_, __src)").toJs();
        log(m.file + "  " + src.text.length.toLocaleString() + " bytes from " +
            src.branch + "  ->  " + found.join(", "), "ok");
      }
      var dsrc = await srcP[DWA.file];
      pyodide.globals.set("__src", dsrc.text);
      pyodide.globals.set("__name_", DWA.file.replace(".py", ""));
      pyodide.runPython("load_module(__name_, __src)");
      log(DWA.file + "  " + dsrc.text.length.toLocaleString() + " bytes from " + dsrc.branch, "ok");
      startChase();
      live("chase");

      // The other four local controllers, for the race. The race runs in its
      // own worker, so these are fetched here and handed over by message --
      // one download, two runtimes.
      var raceSrc = { astar_planner: fetched.astar_planner, dwa_controller: dsrc.text };
      for (var i = 0; i < RACERS.length; i++) {
        if (RACERS[i].file === DWA.file) continue;
        var rs = await srcP[RACERS[i].file];
        raceSrc[RACERS[i].file.replace(".py", "")] = rs.text;
        // Also loaded here, not just handed to the worker: the chase lets you
        // drive with any of these on the main thread.
        pyodide.globals.set("__src", rs.text);
        pyodide.globals.set("__name_", RACERS[i].file.replace(".py", ""));
        pyodide.runPython("load_module(__name_, __src)");
        log(RACERS[i].file + "  " + rs.text.length.toLocaleString() + " bytes from " + rs.branch, "ok");
      }
      race.ready(BOOTSTRAP, raceSrc);
      live("race-canvas");



      ready = true;
      runBtn.disabled = false;
      runLabel.textContent = "Run planner";
      live("map");
      log("ready. draw a map and hit run.", "ok");

      // The arm goes last on purpose: its harness stubs ROS for itself, and
      // the nav modules have already bound their own names by now.
      await bootArm(armP);
      await bootForesee(seeP, meshP);
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


  /* ---------- cursor chase --------------------------------------------
     The full stack, wired the way the launch file wires it. Your cursor is the
     goal; astar_planner.py plans to it, dwa_controller.py tracks the plan.
     The controller publishes at its own rate (dt = 0.1 s, so 10 Hz) and the
     base integrates every frame, which is how it works on the robot: the
     rollout fan snaps to the cursor immediately while the body accelerates at
     the real 0.4 m/s^2. Nothing here is sped up.

     Click to drop an obstacle. The global plan is re-run against the changed
     costmap and the controller keeps tracking whatever comes back.
     ------------------------------------------------------------------- */
  var chase = (function () {
    var cvc = fitCanvas(document.getElementById("chase"), 616 / 1204, 0.88);
    if (!cvc) return { start: function () {} };
    var g = cvc.getContext("2d");
    var readEl = document.getElementById("chase-read");
    var RES = 0.05;                                   // m per costmap cell
    /* Finer cells on a small canvas. The grid is what sets the world size, so
       a phone-sized plate at the desktop cell size gives a course barely wider
       than the robot -- the corridors get tight enough that controllers which
       clear them everywhere else start failing, which is the plate lying about
       the controller. */
    var CELL = cvc._narrow ? 6 : 14;                  // px per cell
    var CW = Math.floor(cvc._w / CELL), CH = Math.floor(cvc._h / CELL);
    var PX = cvc._w / CW;                             // px per cell, exact
    var INFLATE = 4;                                  // cells, ~0.2 m
    var BRUSH = 3;                                    // cells, ~0.15 m obstacle
    var occ = new Uint8Array(CW * CH);
    var cost = null;                                  // inflated map, from python

    // Walls. Out of bounds reads as unknown, not lethal, so without these the
    // costmap gives the controller no reason not to drive off the field.
    function walls() {
      for (var c = 0; c < CW; c++) { occ[c] = 1; occ[(CH - 1) * CW + c] = 1; }
      for (var r = 0; r < CH; r++) { occ[r * CW] = 1; occ[r * CW + CW - 1] = 1; }
    }
    walls();
    var bot = { x: CW * RES * 0.15, y: CH * RES * 0.5, yaw: 0, v: 0, w: 0 };
    var goal = { x: bot.x, y: bot.y }, have = false;
    var plan = [], fan = [], best = null, live = false;
    var lastCtl = 0, lastFrame = 0, lastPlan = 0, lastGate = 0, gate = 0;
    var nTraj = 0, state = 3, viz = [];
    var planMs = 0, planned = { x: 1e9, y: 1e9 }, drops = 0, dirty = false, broke = false;
    var CTL_MS = 100;                                 // overwritten with the node's own dt

    function toPx(mx, my) { return [mx / RES * PX, my / RES * PX]; }

    function paint() {
      g.fillStyle = C.paper; g.fillRect(0, 0, cvc._w, cvc._h);
      g.strokeStyle = C.rule; g.globalAlpha = 0.5; g.lineWidth = 1;
      g.beginPath();
      for (var c = 0; c <= CW; c += 5) { g.moveTo(Math.round(c * PX) + .5, 0); g.lineTo(Math.round(c * PX) + .5, cvc._h); }
      for (var r = 0; r <= CH; r += 5) { g.moveTo(0, Math.round(r * PX) + .5); g.lineTo(cvc._w, Math.round(r * PX) + .5); }
      g.stroke(); g.globalAlpha = 1;

      // The inflation layer the controller is actually reading. A whisper --
      // it covers a lot of ground and the trajectories have to stay legible on
      // top of it. The alpha was tuned against a muted clay accent; the red
      // that replaced it is far more saturated, so the same numbers washed the
      // whole field pink. Roughly halved, which keeps the falloff readable
      // without it competing with the thing driving over it. Same threshold,
      // so it still shows every cell the controller actually reads.
      if (cost) {
        g.fillStyle = C.signal;
        for (var i = 0; i < cost.length; i++) {
          var v = cost[i];
          if (v < 40 || occ[i]) continue;
          g.globalAlpha = 0.018 + 0.05 * (v / 252);
          g.fillRect((i % CW) * PX, Math.floor(i / CW) * PX, PX + .5, PX + .5);
        }
        g.globalAlpha = 1;
      }

      g.fillStyle = C.ink;
      for (var k2 = 0; k2 < occ.length; k2++)
        if (occ[k2]) g.fillRect((k2 % CW) * PX, Math.floor(k2 / CW) * PX, PX + .5, PX + .5);

      // the global plan the controller is tracking
      if (plan.length > 3) {
        g.strokeStyle = C.ink; g.globalAlpha = 0.55; g.lineWidth = 1.5;
        g.setLineDash([6, 5]); g.lineCap = "butt"; g.lineJoin = "round";
        g.beginPath();
        for (var m = 0; m < plan.length; m += 2) {
          var pp = toPx(plan[m], plan[m + 1]);
          m ? g.lineTo(pp[0], pp[1]) : g.moveTo(pp[0], pp[1]);
        }
        g.stroke(); g.setLineDash([]);
        // where the controller is aiming: the lookahead waypoint
        var gp2 = toPx(plan[plan.length - 2], plan[plan.length - 1]);
        g.globalAlpha = 0.5;
        g.beginPath(); g.arc(gp2[0], gp2[1], 3.4, 0, 6.284); g.stroke();
        g.globalAlpha = 1;
      }

      // rejected rollouts
      g.lineWidth = 1; g.strokeStyle = C.accent; g.globalAlpha = 0.25; g.lineCap = "butt";
      fan.forEach(function (t) {
        var n = t.length / 2;
        g.beginPath();
        for (var k = 0; k < n; k++) {
          var p = toPx(t[k], t[n + k]);
          k ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]);
        }
        g.stroke();
      });
      g.globalAlpha = 1;

      if (best && best[0].length) {                   // committed trajectory
        g.strokeStyle = C.signal; g.lineWidth = 2.6; g.lineCap = "round";
        g.beginPath();
        for (var j = 0; j < best[0].length; j++) {
          var q = toPx(best[0][j], best[1][j]);
          j ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]);
        }
        g.stroke();
        var tip = toPx(best[0][best[0].length - 1], best[1][best[1].length - 1]);
        g.fillStyle = C.signal;
        g.beginPath(); g.arc(tip[0], tip[1], 2.6, 0, 6.284); g.fill();
      }

      // What the selected controller is actually looking at. Each one exposes
      // something different and it is the most informative thing it has:
      // the point Pure Pursuit is steering at, the point Stanley measures its
      // cross-track error from, or the band TEB is deforming.
      if (viz && viz.length) {
        if (viz[0] === "look") {
          var lp = toPx(viz[1], viz[2]);
          var bp = toPx(bot.x, bot.y);
          g.strokeStyle = C.accent; g.globalAlpha = 0.5; g.lineWidth = 1.2;
          g.setLineDash([4, 4]);
          g.beginPath(); g.moveTo(bp[0], bp[1]); g.lineTo(lp[0], lp[1]); g.stroke();
          g.setLineDash([]); g.globalAlpha = 1;
          g.strokeStyle = C.accent; g.lineWidth = 2;
          g.beginPath(); g.arc(lp[0], lp[1], 6, 0, 6.284); g.stroke();
        } else if (viz[0] === "near") {
          var np = toPx(viz[1], viz[2]);
          var rp = toPx(bot.x, bot.y);
          g.strokeStyle = C.accent; g.globalAlpha = 0.75; g.lineWidth = 1.6;
          g.beginPath(); g.moveTo(rp[0], rp[1]); g.lineTo(np[0], np[1]); g.stroke();
          g.globalAlpha = 1;
          g.fillStyle = C.accent;
          g.beginPath(); g.arc(np[0], np[1], 3.4, 0, 6.284); g.fill();
        } else if (viz[0] === "scan" && viz.length > 4) {
          // the observation, not a decoration: these are the ranges that went
          // into the network this tick
          g.strokeStyle = C.accent; g.globalAlpha = 0.45; g.lineWidth = 1;
          g.beginPath();
          for (var q = 1; q + 3 < viz.length; q += 4) {
            var a0 = toPx(viz[q], viz[q + 1]), a1 = toPx(viz[q + 2], viz[q + 3]);
            g.moveTo(a0[0], a0[1]); g.lineTo(a1[0], a1[1]);
          }
          g.stroke(); g.globalAlpha = 1;
          g.fillStyle = C.accent;
          for (var q2 = 1; q2 + 3 < viz.length; q2 += 4) {
            var e2 = toPx(viz[q2 + 2], viz[q2 + 3]);
            g.beginPath(); g.arc(e2[0], e2[1], 1.8, 0, 6.284); g.fill();
          }
        } else if (viz[0] === "band" && viz.length > 4) {
          g.strokeStyle = C.accent; g.globalAlpha = 0.8; g.lineWidth = 2;
          g.beginPath();
          for (var b = 1; b + 1 < viz.length; b += 2) {
            var q2 = toPx(viz[b], viz[b + 1]);
            b === 1 ? g.moveTo(q2[0], q2[1]) : g.lineTo(q2[0], q2[1]);
          }
          g.stroke();
          g.fillStyle = C.accent;
          for (var b2 = 1; b2 + 1 < viz.length; b2 += 2) {
            var q3 = toPx(viz[b2], viz[b2 + 1]);
            g.beginPath(); g.arc(q3[0], q3[1], 2.4, 0, 6.284); g.fill();
          }
          g.globalAlpha = 1;
        }
      }

      if (have) {                                     // goal crosshair at the cursor
        var gp = toPx(goal.x, goal.y);
        g.strokeStyle = state === 1 ? C.accent : C.signal; g.lineWidth = 1.4;
        g.beginPath();
        g.moveTo(gp[0] - 13, gp[1]); g.lineTo(gp[0] - 5, gp[1]);
        g.moveTo(gp[0] + 5, gp[1]); g.lineTo(gp[0] + 13, gp[1]);
        g.moveTo(gp[0], gp[1] - 13); g.lineTo(gp[0], gp[1] - 5);
        g.moveTo(gp[0], gp[1] + 5); g.lineTo(gp[0], gp[1] + 13);
        g.stroke();
        g.beginPath(); g.arc(gp[0], gp[1], 2.6, 0, 6.284);
        g.fillStyle = state === 1 ? C.accent : C.signal; g.fill();
        // goal tolerance — the radius inside which the node calls it reached
        g.globalAlpha = 0.5; g.setLineDash([3, 4]); g.lineWidth = 1;
        g.beginPath(); g.arc(gp[0], gp[1], 0.15 / RES * PX, 0, 6.284); g.stroke();
        g.setLineDash([]); g.globalAlpha = 1;
      }

      var bp = toPx(bot.x, bot.y);                    // the robot
      g.save(); g.translate(bp[0], bp[1]); g.rotate(bot.yaw);
      g.strokeStyle = C.ink; g.globalAlpha = 0.28; g.lineWidth = 1;
      g.beginPath(); g.arc(0, 0, 0.17 / RES * PX, 0, 6.284); g.stroke();  // footprint
      g.globalAlpha = 1;
      g.fillStyle = C.paper; g.lineWidth = 2;
      g.beginPath(); g.moveTo(11, 0); g.lineTo(-7, 7.5); g.lineTo(-4, 0); g.lineTo(-7, -7.5);
      g.closePath(); g.fill(); g.stroke();
      g.restore();
    }

    function step(ts) {
      if (!live) return;
      requestAnimationFrame(step);

      // integrate the base every frame with whatever cmd_vel is current
      var dt = lastFrame ? Math.min(0.05, (ts - lastFrame) / 1000) : 0;
      lastFrame = ts;
      bot.x += bot.v * Math.cos(bot.yaw) * dt;
      bot.y += bot.v * Math.sin(bot.yaw) * dt;
      bot.yaw += bot.w * dt;

      // Replan on the planner node's own 0.5 s cadence, through its own gates:
      // path blocked by a local obstacle, or the robot too far off the plan.
      // The goal moving is the extra one a cursor introduces.
      if (have && !dirty && ts - lastGate >= 500) {
        lastGate = ts;
        try {
          gate = pyodide.runPython("chase_gate(" + bot.x + "," + bot.y + ")");
          if (gate) dirty = true;
        } catch (e) { /* leave the plan alone */ }
      }
      var moved = Math.hypot(goal.x - planned.x, goal.y - planned.y);
      if (have && (dirty || (moved > 0.12 && ts - lastPlan > 220))) {
        lastPlan = ts; planned = { x: goal.x, y: goal.y }; dirty = false;
        try {
          var pl = pyodide.runPython(
            "chase_plan(" + bot.x + "," + bot.y + "," + goal.x + "," + goal.y + ")").toJs();
          plan = pl[0]; planMs = pl[1];
        } catch (e) { plan = []; }
      }

      // A remote controller is asked on the same cadence, but asynchronously:
      // one request in flight at a time, and the base keeps integrating on the
      // last command while the worker thinks. That is what a real base does
      // when its controller is slow, and here the lag is legible.
      if (chaser.remote) {
        // The plan is computed above, on this thread, and only the path is
        // shipped -- A* is two milliseconds and belongs where it can be drawn
        // the instant it changes. Only the controller is slow enough to exile.
        if (remoteReady && plan !== sentPlan) {
          sentPlan = plan;
          race.send({ type: "chase_path", pts: plan });
        }
        if (remoteReady && !inflight && ts - lastCtl >= CTL_MS) {
          lastCtl = ts; inflight = true;
          race.send({ type: "chase_tick", seq: ++seq, x: bot.x, y: bot.y, yaw: bot.yaw,
                      v: bot.v, w: bot.w });
        }
      } else
      // ...and run the controller at its own rate
      if (ts - lastCtl >= CTL_MS) {
        lastCtl = ts;
        try {
          // DWA runs the transcribed loop, because that is where the fan is.
          // Everything else runs its own _control_loop untouched.
          var fn = chaser.cloned ? "clone_step"
                 : chaser.key === "dwa" ? "chase_step" : "chase_step_any";
          var out = pyodide.runPython(
            fn + "(" + bot.x + "," + bot.y + "," + bot.yaw + "," +
            bot.v + "," + bot.w + ")").toJs();
          bot.v = out[0]; bot.w = out[1]; nTraj = out[2]; state = out[7];
          best = [out[4], out[5]]; fan = out[6];
          viz = out.length > 9 ? out[9] : [];
          if (viz && viz[0] === "err" && !broke) {
            broke = true;
            log("chase controller " + chaser.file + ".py: " + viz[1], "err");
          }
        } catch (e) {
          bot.v = 0; bot.w = 0; fan = []; best = null; viz = []; state = 5;
          if (!broke) {                              // once, not sixty times a second
            broke = true;
            log("controller stopped: " + String(e && e.message || e)
                .split("\n").slice(-3).join(" | "), "err");
          }
        }
      }

      var cr = Math.floor(bot.y / RES), cc = Math.floor(bot.x / RES);
      if (cr < 1 || cc < 1 || cr >= CH - 1 || cc >= CW - 1 || occ[cr * CW + cc]) {
        bot.x = CW * RES * 0.15; bot.y = CH * RES * 0.5;
        bot.yaw = 0; bot.v = bot.w = 0; fan = []; best = null; viz = []; plan = []; dirty = true;
      }

      paint();
      var d = Math.hypot(goal.x - bot.x, goal.y - bot.y);
      readEl.textContent = !have
        ? "move the cursor over the field  ·  click to drop an obstacle"
        : state === 1
          ? "reached  ·  inside the 0.15 m goal tolerance  ·  " + drops +
            (drops === 1 ? " obstacle" : " obstacles") + " dropped"
          : state === 2
            ? "boxed in  ·  running the escape branch"
            : state === 3
              ? "no plan  ·  that goal is unreachable"
              : state === 4
                ? "stuck  ·  running the recovery behaviour, then forcing a replan"
                : state === 5
                  ? "controller stopped  ·  see the console below"
                  : "A* " + (plan.length / 2 | 0) + " pts in " + planMs.toFixed(1) +
                    " ms  ·  " + (nTraj ? chase.current().label + " scoring " +
                                              nTraj.toLocaleString() + " rollouts"
                                            : chase.current().label +
                                              (ctlMs > 40 ? " thinking " + Math.round(ctlMs) + " ms a tick" : "")) +
                    "  ·  v " +
                    bot.v.toFixed(2) + " m/s  w " + (bot.w >= 0 ? "+" : "") +
                    bot.w.toFixed(2) + " rad/s  ·  " + d.toFixed(2) + " m out";
    }

    // How far outside the plate the pointer is, in CSS pixels, 0 while inside.
    function overshootOf(clientX, clientY, b) {
      return Math.hypot(Math.max(0, b.left - clientX, clientX - b.right),
                        Math.max(0, b.top - clientY, clientY - b.bottom));
    }

    // The rubber-band curve from Apple's fluid-interfaces sample: the further
    // past the bound you drag, the less the thing follows. Returns the damped
    // distance, which approaches dimension*constant rather than growing.
    function rubberband(overshoot, dimension, constant) {
      constant = constant === undefined ? 0.55 : constant;
      return (overshoot * dimension * constant) /
             (dimension + constant * Math.abs(overshoot));
    }

    // Leaving the plate used to drop the goal outright: the robot stopped
    // being told where to go and the readout reverted to "move the cursor over
    // the field" mid-chase. A hard stop at a boundary reads as frozen. So the
    // edge resists instead. Inside, the goal tracks the pointer 1:1; outside,
    // it still follows -- along the edge, since that is the only part of your
    // move that is still reachable -- by a fraction that decays the further out
    // you go. Far enough away and it settles, which reads as "still with you,
    // but there is nothing more this way" rather than as a freeze.
    // 160px, not more. The plate is over 1200px wide, so a larger release
    // distance is simply off-screen on a normal viewport -- the branch would
    // never fire and the robot would keep being driven by a cursor halfway down
    // the page. 160 is a wide enough band to feel like resistance and close
    // enough to reach, which is what makes the let-go real rather than
    // theoretical.
    var RELEASE = 160;                        // px out; past this, let go
    function setGoal(clientX, clientY) {
      var b = cvc.getBoundingClientRect();
      var over = overshootOf(clientX, clientY, b);
      if (over > RELEASE) { have = false; return; }

      var gx = Math.max(RES, Math.min((CW - 1) * RES,
                        (clientX - b.left) / b.width * CW * RES));
      var gy = Math.max(RES, Math.min((CH - 1) * RES,
                        (clientY - b.top) / b.height * CH * RES));

      if (over > 0 && have) {
        // follow falls from 1 at the edge toward 0 as the overshoot grows
        var follow = 1 - rubberband(over, RELEASE) / RELEASE;
        gx = goal.x + (gx - goal.x) * follow;
        gy = goal.y + (gy - goal.y) * follow;
      }
      goal.x = gx; goal.y = gy;
      have = true;
    }

    function drop(clientX, clientY) {
      var b = cvc.getBoundingClientRect();
      var c0 = Math.floor((clientX - b.left) / b.width * CW) - (BRUSH >> 1);
      var r0 = Math.floor((clientY - b.top) / b.height * CH) - (BRUSH >> 1);
      var added = 0;
      for (var r = r0; r < r0 + BRUSH; r++) {
        for (var c = c0; c < c0 + BRUSH; c++) {
          if (r < 0 || c < 0 || r >= CH || c >= CW) continue;
          // never bury the robot in its own obstacle
          if (Math.hypot((c + 0.5) * RES - bot.x, (r + 0.5) * RES - bot.y) < 0.3) continue;
          if (!occ[r * CW + c]) { occ[r * CW + c] = 1; added++; }
        }
      }
      if (!added) return;
      drops++;
      pyodide.globals.set("__occ", Array.from(occ));
      cost = pyodide.runPython("chase_remap(list(__occ.to_py()) if " +
                               "hasattr(__occ,'to_py') else list(__occ))").toJs();
      // The worker keeps its own costmap when it is driving, so it needs the
      // same obstacle -- otherwise it plans around a field it cannot see.
      if (chaser.remote) race.send({ type: "chase_remap", occ: Array.from(occ) });
      dirty = true;                                    // force an immediate re-plan
      log("obstacle dropped, costmap re-inflated, global plan invalidated");
    }

    // Pointer Events, so mouse, pen and touch are one path instead of two that
    // have to be kept in step. The move listener sits on the window rather than
    // the canvas because the boundary resists now instead of stopping: the goal
    // has to keep being updated while the pointer is outside the plate, and a
    // canvas-scoped listener never sees that. `engaged` is what stops the robot
    // chasing a cursor that has never been over the plate at all.
    var engaged = false;
    cvc.addEventListener("pointerenter", function () { engaged = true; });
    window.addEventListener("pointermove", function (ev) {
      if (!engaged) return;
      setGoal(ev.clientX, ev.clientY);
      if (!have) engaged = false;               // decayed past RELEASE, let go
    });
    cvc.addEventListener("pointerdown", function (ev) {
      ev.preventDefault();
      // Keep the drag ours even if it leaves the plate, so a stroke of
      // obstacles is not cut short by the pointer crossing the edge.
      if (cvc.setPointerCapture) cvc.setPointerCapture(ev.pointerId);
      engaged = true;
      setGoal(ev.clientX, ev.clientY);
      drop(ev.clientX, ev.clientY);
    });

    // Which controller is driving. MPPI is deliberately absent: one tick is
    // ~580 ms and the chase runs its controller on the main thread at the
    // node's own rate, so it would freeze the cursor rather than track it.
    // It is in the race instead, where a worker absorbs the cost.
    var CHASERS = [
      { key: "dwa", file: "dwa_controller", cls: "DWAControllerNode", label: "DWA" },
      { key: "pure_pursuit", file: "pure_pursuit_controller", cls: "PurePursuitControllerNode", label: "Pure Pursuit" },
      { key: "stanley", file: "stanley_controller", cls: "StanleyControllerNode", label: "Stanley" },
      { key: "teb", file: "teb_controller", cls: "TEBControllerNode", label: "TEB" },
      // MPPI is ~580 ms a tick, which is a single indivisible Python call. It
      // runs in the race's worker instead, so the cursor stays at 60 fps and
      // the robot does what a real base does when its planner is slow: keeps
      // moving on the last command until a new one lands.
      { key: "mppi", file: "mppi_controller", cls: "MPPIControllerNode", label: "MPPI", remote: true },
      // Not from the repo: a network trained here, on the repo's own DWA. It
      // is wired in as a controller because that is exactly what it is -- the
      // page can then let you drive with the imitation and the original and
      // feel the difference.
      { key: "clone", file: "dwa_clone", cls: "-", label: "Clone", cloned: true }
    ];
    var chaser = CHASERS[0];
    var inflight = false, seq = 0, ctlMs = 0, remoteReady = false, pendingRemote = null;
    var sentPlan = null;

    function initController() {
      if (chaser.cloned) {
        // Reuse the DWA wiring for the costmap and the plan, then drive with
        // the net instead of the node. Same costmap, same A*, same waypoint
        // rule -- only the thing choosing the twist changes.
        pyodide.globals.set("__occ", Array.from(occ));
        var m0 = pyodide.runPython(
          "chase_init('astar_planner','" + MODULES.astar.cls + "','dwa_controller','" +
          DWA.cls + "','dwa', list(__occ.to_py()) if hasattr(__occ,'to_py') " +
          "else list(__occ), " + CH + ", " + CW + ", " + RES + ", " + INFLATE + ")").toJs();
        cost = m0[9];
        CTL_MS = 100;
        pyodide.runPython("_DWA['cwp'] = 0");
        return m0;
      }
      if (chaser.remote) {
        remoteReady = false; inflight = false;
        race.send({ type: "chase_init", pcls: MODULES.astar.cls, cmod: chaser.file,
                    ccls: chaser.cls, kind: chaser.key, occ: Array.from(occ),
                    h: CH, w: CW, res: RES, inflate: INFLATE });
        CTL_MS = 100;
        return null;                       // meta arrives on the worker reply
      }
      pyodide.globals.set("__occ", Array.from(occ));
      var meta = pyodide.runPython(
        "chase_init('astar_planner','" + MODULES.astar.cls + "','" + chaser.file + "','" +
        chaser.cls + "','" + chaser.key + "', list(__occ.to_py()) if hasattr(__occ,'to_py') " +
        "else list(__occ), " + CH + ", " + CW + ", " + RES + ", " + INFLATE + ")").toJs();
      CTL_MS = Math.round(meta[4] * 1000) || 100;      // the node's own dt
      cost = meta[9];
      return meta;
    }

    return {
      CHASERS: CHASERS,
      // Swapping controller rebuilds it against the current costmap and forces
      // a fresh plan, because the new one has its own idea of where it is on
      // the path and inheriting the old index would start it mid-route.
      select: function (key) {
        var next = CHASERS.filter(function (c) { return c.key === key; })[0];
        if (!next || next === chaser) return null;
        if (next.remote && !race.isArmed()) {
          // The worker takes ~30 s to bring up its own pyodide. Remember the
          // request instead of dropping it, so an early click is a wait rather
          // than a button that does nothing.
          pendingRemote = key;
          readEl.textContent = "the worker runtime is still loading · " +
            next.label + " will start as soon as it is up";
          return null;
        }
        chaser = next;
        var meta = initController();
        plan = []; fan = []; best = null; viz = []; dirty = true;
        bot.v = bot.w = 0;
        // A remote controller has no meta yet; the worker sends it back.
        return meta || [0, 0, 0, 0, 0.1, 0, 0, 0, 0, null];
      },
      current: function () { return chaser; },
      // The worker replies for the chase land here. Registered once, after the
      // race module has created the worker.
      wireRemote: function () {
        race.hook("__ready", function () {
          if (!pendingRemote) return;
          var k = pendingRemote; pendingRemote = null;
          var btn = document.querySelector('[data-chaser="' + k + '"]');
          if (btn) btn.click();               // the normal path, including the chip state
        });
        race.hook("chase_init", function (msg) {
          var m = msg.meta;
          if (m && m.length) {
            CTL_MS = Math.round(m[4] * 1000) || 100;
            cost = m[9];
          }
          remoteReady = true; inflight = false; sentPlan = null;
          log("chase controller: " + chaser.file + ".py in the worker at " +
              Math.round(1000 / CTL_MS) + " Hz  (v_max " + (m && m[0] ? m[0].toFixed(2) : "?") +
              " m/s)", "ok");
        });
        race.hook("chase_remap", function () { dirty = true; });
        race.hook("chase_tick", function (msg) {
          inflight = false;
          ctlMs = msg.ms;
          var out = msg.out || [];
          if (!out.length) return;
          bot.v = out[0]; bot.w = out[1]; state = out[7];
          // MPPI hands back its sampled rollouts in the same slots DWA uses,
          // so the fan draws with no extra case -- but they have to be copied
          // across, which is what was missing.
          nTraj = out[2];
          best = [out[4], out[5]];
          fan = out[6] || [];
          viz = out.length > 9 ? out[9] : [];
          if (viz && viz[0] === "err" && !broke) {
            broke = true;
            log("chase controller " + chaser.file + ".py: " + viz[1], "err");
          }
        });
      },
      start: function () {
        var meta = initController();
        live = true; paint(); requestAnimationFrame(step);
        return meta;
      },
      reset: function () {
        occ.fill(0); walls(); drops = 0; plan = []; fan = []; best = null; dirty = true;
        bot = { x: CW * RES * 0.15, y: CH * RES * 0.5, yaw: 0, v: 0, w: 0 };
        pyodide.globals.set("__occ", Array.from(occ));
        cost = pyodide.runPython("chase_remap(list(__occ.to_py()) if " +
                                 "hasattr(__occ,'to_py') else list(__occ))").toJs();
      }
    };
  })();
  // A canvas fades in once whatever draws it is actually ready. Opacity
  // only: a canvas that moves is a full repaint of everything on it.
  function live(id) {
    var el = document.getElementById(id);
    if (el) el.classList.add("is-live");
  }

  function startChase() {
    try {
      var m = chase.start();
      log("chase online: astar_planner.py on demand, dwa_controller.py at " +
          Math.round(1 / m[4]) + " Hz  (v_max " + m[0] + " m/s, a_max " + m[2] +
          " m/s^2, lookahead " + m[8] + " wps)", "ok");
      var rb = document.getElementById("chase-reset");
      if (rb) rb.addEventListener("click", function () {
        chase.reset(); log("field cleared");
      });
      chase.wireRemote();
      document.querySelectorAll("[data-chaser]").forEach(function (b) {
        b.addEventListener("click", function () {
          var key = b.getAttribute("data-chaser");
          var cm = chase.select(key);
          if (!cm) return;
          document.querySelectorAll("[data-chaser]").forEach(function (o) {
            o.classList.toggle("is-on", o === b);
          });
          log("chase controller: " + chase.current().file + ".py at " +
              Math.round(1 / cm[4]) + " Hz  (v_max " + cm[0].toFixed(2) + " m/s)", "ok");
        });
      });
    } catch (e) { log("chase unavailable: " + e.message, "err"); }
  }

  /* ---------- race: five controllers, one plan -------------------------
     Every local controller in the package, given the same A* path over the
     same costmap, each on its own identical unicycle and its own shipped dt.
     The comparison is only worth anything if nothing is normalised, so
     nothing is: the tuning is whatever the node's __init__ assigns.

     Simulated time is the shared clock. A frame advances each controller by
     however many of its own ticks add up to the same simulated interval, so
     MPPI's 20 Hz and everyone else's 10 Hz both come out right.
     ------------------------------------------------------------------- */
  var race = (function () {
    var cvr = fitCanvas(document.getElementById("race-canvas"), 680 / 1204, 1.02);
    if (!cvr) return { ready: function () {} };
    var g = cvr.getContext("2d");
    var readEl = document.getElementById("race-read");
    var keyEl = document.getElementById("race-key");
    var runBtnEl = document.getElementById("race-run");
    var RES = 0.05;
    var CELL = cvr._narrow ? 5 : 12;
    var CW = Math.floor(cvr._w / CELL), CH = Math.floor(cvr._h / CELL);
    var PX = cvr._w / CW;
    var occ = new Uint8Array(CW * CH);
    var plan = [], trails = [], rows = [], live = false, armed = false, raf2 = 0;
    var worker = null;
    // The chase borrows this worker for MPPI rather than starting a third
    // pyodide. Its messages are namespaced chase_*, so they demux here.
    var hooks = {};
    var frames = 0;

    // The course: two walls staggered so the route has to come off one end and
    // then the other. A straight run would tie, and a single turn would only
    // separate the ones that overshoot; two in opposite directions is what
    // makes a controller that cuts the corner look different from one that
    // does not.
    function course() {
      occ.fill(0);
      for (var c = 0; c < CW; c++) { occ[c] = 1; occ[(CH - 1) * CW + c] = 1; }
      for (var r = 0; r < CH; r++) { occ[r * CW] = 1; occ[r * CW + CW - 1] = 1; }
      var a = Math.round(CW * 0.32), b = Math.round(CW * 0.63);
      for (var r2 = 3; r2 < CH - 3; r2++) {
        for (var d = 0; d < 3; d++) {
          if (r2 < Math.round(CH * 0.62)) occ[r2 * CW + a + d] = 1;
          if (r2 > Math.round(CH * 0.38)) occ[r2 * CW + b + d] = 1;
        }
      }
    }
    course();
    var START = { r: Math.round(CH * 0.5), c: 4 },
        GOAL  = { r: Math.round(CH * 0.5), c: CW - 5 };

    function toPx(mx, my) { return [mx / RES * PX, my / RES * PX]; }

    function chips() {
      RACERS.forEach(function (rc) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "tbtn tbtn--sm racer" + (rc.on ? " is-on" : "");
        b.innerHTML = '<i class="kx" style="background:' + rc.col + '"></i>' + rc.label;
        b.addEventListener("click", function () {
          if (live) return;
          rc.on = !rc.on;
          b.classList.toggle("is-on", rc.on);
        });
        keyEl.insertBefore(b, runBtnEl);
      });
    }

    function drawStatic() {
      g.fillStyle = C.paper; g.fillRect(0, 0, cvr._w, cvr._h);
      g.strokeStyle = C.rule; g.globalAlpha = 0.45; g.lineWidth = 1;
      g.beginPath();
      for (var c = 0; c <= CW; c += 8) { g.moveTo(c * PX + 0.5, 0); g.lineTo(c * PX + 0.5, cvr._h); }
      for (var r = 0; r <= CH; r += 8) { g.moveTo(0, r * PX + 0.5); g.lineTo(cvr._w, r * PX + 0.5); }
      g.stroke(); g.globalAlpha = 1;

      g.fillStyle = C.ink;
      for (var i = 0; i < occ.length; i++) {
        if (occ[i]) g.fillRect((i % CW) * PX, Math.floor(i / CW) * PX, PX + 0.5, PX + 0.5);
      }
    }

    // The plan goes on top of the trails, not under them: the whole question
    // is how far each controller is from it, and it cannot be read if four
    // trails are drawn over it.
    function drawPlan() {
      if (!plan.length) return;
      g.strokeStyle = C.ink; g.globalAlpha = 0.5; g.lineWidth = 2;
      g.setLineDash([7, 6]); g.beginPath();
      plan.forEach(function (p, i) {
        var q = toPx(p[0], p[1]);
        i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]);
      });
      g.stroke(); g.setLineDash([]); g.globalAlpha = 1;
      var s = toPx(plan[0][0], plan[0][1]), e = toPx(plan[plan.length - 1][0], plan[plan.length - 1][1]);
      g.strokeStyle = C.ink; g.lineWidth = 1.5;
      g.beginPath(); g.arc(s[0], s[1], 6, 0, 6.284); g.stroke();
      label("start", s[0] - 10, s[1] - 12, C.mut, 10);
      g.beginPath(); g.moveTo(e[0] - 6, e[1] - 6); g.lineTo(e[0] + 6, e[1] + 6);
      g.moveTo(e[0] + 6, e[1] - 6); g.lineTo(e[0] - 6, e[1] + 6); g.stroke();
      label("goal", e[0] - 8, e[1] - 12, C.mut, 10);
    }

    function label(t, x, y, col, size) {
      g.fillStyle = col; g.font = "500 " + (size || 10) +
        "px ui-monospace, SFMono-Regular, Menlo, monospace";
      g.textAlign = "left"; g.fillText(t, x, y);
    }

    function draw() {
      drawStatic();
      RACERS.forEach(function (rc, i) {
        var tr = trails[i];
        if (!tr || !tr.length) return;
        g.strokeStyle = rc.col; g.globalAlpha = 0.85; g.lineWidth = 2;
        g.beginPath();
        tr.forEach(function (p, k) { k ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]); });
        g.stroke(); g.globalAlpha = 1;
        var o = rows[i];
        if (!o || !o.length) return;
        var p2 = toPx(o[0], o[1]);
        g.save(); g.translate(p2[0], p2[1]); g.rotate(o[2]);
        g.fillStyle = rc.col;
        g.beginPath(); g.moveTo(9, 0); g.lineTo(-6, 5.5); g.lineTo(-6, -5.5); g.closePath(); g.fill();
        g.restore();
        if (o[3] === "reached") {
          g.strokeStyle = rc.col; g.globalAlpha = 0.6; g.lineWidth = 1.5;
          g.beginPath(); g.arc(p2[0], p2[1], 11, 0, 6.284); g.stroke(); g.globalAlpha = 1;
        }
      });

      drawPlan();

      // the standings, in finishing order
      var order = RACERS.map(function (rc, i) { return { rc: rc, o: rows[i], i: i }; })
        .filter(function (e) { return e.o && e.o.length; })
        .sort(function (a, b) {
          var af = a.o[3] === "reached", bf = b.o[3] === "reached";
          if (af !== bf) return af ? -1 : 1;
          if (af) return a.o[4] - b.o[4];
          return b.o[5] - a.o[5];
        });
      var X = 14, Y = 20;
      g.fillStyle = C.paper; g.globalAlpha = 0.86;
      g.fillRect(X - 8, Y - 14, 366, 22 + order.length * 17); g.globalAlpha = 1;
      label("controller        sim s   metres  xtrack   ms/tick", X, Y, C.mut, 10);
      order.forEach(function (e, k) {
        var o = e.o, y = Y + 16 + k * 17;
        var name = e.rc.label.toLowerCase().replace(" ", "-");
        g.fillStyle = e.rc.col; g.fillRect(X, y - 7, 7, 7);
        label(name, X + 12, y, C.ink, 11);
        label(o[4].toFixed(1), X + 118, y, C.ink, 11);
        label(o[5].toFixed(2), X + 176, y, C.ink, 11);
        label(o[8].toFixed(3), X + 238, y, C.ink, 11);
        label(o[9] < 10 ? o[9].toFixed(2) : o[9].toFixed(0), X + 300, y, C.ink, 11);
        if (o[3] !== "running" && o[3] !== "reached") {
          label(o[3], X + 344, y, C.signal, 10);
        }
      });
    }

    // Everything below drives the worker rather than pyodide directly. A frame
    // is now: ask for a step, draw whatever comes back, ask again. The main
    // thread never waits on Python, so an MPPI tick costing half a second
    // slows the race down instead of freezing the page.
    function onStep(msg) {
      if (!live) return;
      rows = msg.rows;
      frames++;
      RACERS.forEach(function (rc, i) {
        var o = rows[i];
        if (!o || !o.length) return;
        if (!trails[i]) trails[i] = [];
        var p = toPx(o[0], o[1]);
        var last = trails[i][trails[i].length - 1];
        if (!last || Math.abs(last[0] - p[0]) + Math.abs(last[1] - p[1]) > 1.2) trails[i].push(p);
      });
      draw();

      var done = msg.done;
      var finished = rows.filter(function (o) { return o && o.length && o[3] === "reached"; }).length;
      var running = rows.filter(function (o) { return o && o.length && o[3] === "running"; }).length;
      // Simulated time comes off the runners, not the frame count. Now that a
      // frame is capped by a wall-clock budget, a slow controller takes several
      // frames per interval and counting frames would overstate the clock.
      var sim = 0;
      rows.forEach(function (o) { if (o && o.length) sim = Math.max(sim, o[4]); });
      // Cost, so a race that is taking a while reads as compute rather than as
      // the page being stuck.
      var slow = 0;
      rows.forEach(function (o) { if (o && o.length) slow = Math.max(slow, o[9]); });
      var cost = slow > 40 ? " · " + Math.round(slow) + " ms a tick, so this runs slower than real time" : "";
      readEl.textContent = done
        ? "done · " + finished + " of " + rows.filter(function (o) { return o && o.length; }).length +
          " reached the goal · " + sim.toFixed(1) + " s simulated"
        : running + " still driving · " + sim.toFixed(1) + " s simulated" + cost;
      if (done) { live = false; runBtnEl.textContent = "Run it again"; return; }
      raf2 = requestAnimationFrame(function () { if (live) worker.postMessage({ type: "step" }); });
    }

    function onInit(msg) {
      if (!msg.meta || !msg.meta.length) {
        readEl.textContent = "A* found no route across the course";
        live = false; runBtnEl.textContent = "Run the race"; return;
      }
      plan = msg.meta[0];
      log("race: A* planned " + plan.length + " waypoints; " +
          RACERS.filter(function (rc) { return rc.on; }).map(function (rc) { return rc.key; }).join(", ") +
          " on the line", "ok");
      draw();
      worker.postMessage({ type: "step" });
    }

    function start() {
      if (!armed || live) return;
      var active = RACERS.map(function (rc) { return rc.on; });
      if (!active.some(Boolean)) { readEl.textContent = "pick at least one controller"; return; }
      if (raf2) cancelAnimationFrame(raf2);
      trails = []; rows = []; frames = 0; plan = [];
      live = true;
      runBtnEl.textContent = "Running…";
      readEl.textContent = "planning…";
      worker.postMessage({
        type: "init", flat: Array.from(occ), active: active,
        h: CH, w: CW, res: RES, sr: START.r, sc: START.c, gr: GOAL.r, gc: GOAL.c
      });
    }

    return {
      // The chase runs MPPI through this worker; these are how it talks to it.
      send: function (m) { if (worker) worker.postMessage(m); },
      hook: function (t, fn) { hooks[t] = fn; },
      isArmed: function () { return armed; },
      // Called once the main thread has fetched the sources, so the worker
      // gets them by message rather than downloading everything a second time.
      ready: function (bootstrap, sources) {
        worker = new Worker("race-worker.js");
        worker.onmessage = function (e) {
          var msg = e.data;
          if (hooks[msg.type]) return hooks[msg.type](msg);
          if (msg.type === "ready") { armed = true; readyRead(); if (hooks.__ready) hooks.__ready(); }
          else if (msg.type === "init") onInit(msg);
          else if (msg.type === "step") onStep(msg);
          else if (msg.type === "error") {
            log("race: " + msg.error, "err");
            live = false; runBtnEl.textContent = "Run the race";
            readEl.textContent = "the race worker failed · see the console";
          }
        };
        worker.onerror = function (e) {
          log("race worker: " + (e.message || "failed to start"), "err");
          readEl.textContent = "the race worker could not start";
        };
        worker.postMessage({ type: "boot", bootstrap: bootstrap, sources: sources });

        chips();
        runBtnEl.addEventListener("click", function () {
          if (live) { live = false; runBtnEl.textContent = "Run the race"; return; }
          start();
        });
        drawStatic();
        readEl.textContent = "loading the race runtime…";
      }
    };

    function readyRead() {
      readEl.textContent = "press run · " + RACERS.filter(function (rc) { return rc.on; }).length +
        " controllers on the line, MPPI off";
    }
  })();

  /* ---------- reach in: the arm's obstacle detector ---------------------
     Same idea as above, different repo. tests/harness.py drives the real
     _cloud_cb on synthetic RealSense frames; every count on the right is read
     off the node's own filter calls, not recomputed. The blind spot near a
     link is the self-filter doing its job, and you can find it with the
     cursor.
     ------------------------------------------------------------------- */
  var arm = (function () {
    var cvn = fitCanvas(document.getElementById("arm"), 620 / 1204, 1.18);
    if (!cvn) return { start: function () {} };
    var g = cvn.getContext("2d");
    var readEl = document.getElementById("arm-read");
    /* The camera plate and the pipeline panel sit side by side when there is
       room and stack when there is not. VIEW was a hard 604, which is wider
       than the whole canvas on a phone -- the panel's width came out negative
       and every label in it was drawn off the left edge. */
    var VIEW = cvn._narrow ? cvn._w : Math.round(cvn._w * 0.502),
        VIEW_H = cvn._narrow ? Math.round(cvn._h * 0.60) : cvn._h;
    var PAD = 30;
    var live = false, lastF = 0, cur = { u: 300, v: 300 }, have = false;
    var links = [], chain = [], meta = null, f = null, radius = 0.07;
    var hist = [];                                    // recent decisions, for the strip
    var t0 = 0, PERIOD = 14000;                       // one pick-and-place loop

    function bar(x, y, w, h, frac, colour, alpha) {
      g.fillStyle = C.rule; g.globalAlpha = 0.55;
      g.fillRect(x, y, w, h);
      g.globalAlpha = alpha === undefined ? 1 : alpha;
      g.fillStyle = colour;
      g.fillRect(x, y, Math.max(1, w * Math.min(1, Math.max(0, frac))), h);
      g.globalAlpha = 1;
    }
    function label(t, x, y, colour, size, align) {
      g.fillStyle = colour || C.ink3 || C.mut;
      g.font = (size || 10) + "px ui-monospace, SFMono-Regular, Menlo, monospace";
      g.textAlign = align || "left"; g.textBaseline = "alphabetic";
      g.fillText(t, x, y);
    }

    function paint() {
      g.fillStyle = C.paper; g.fillRect(0, 0, cvn._w, cvn._h);

      // ── the camera plate ──────────────────────────────────────────
      g.save(); g.beginPath(); g.rect(0, 0, VIEW, VIEW_H); g.clip();
      g.fillStyle = "#14140f"; g.fillRect(0, 0, VIEW, VIEW_H);

      /* Everything below is in the node's own image coordinates -- the point
         cloud comes back already projected through F, CX, CY -- and those were
         drawn onto the plate one to one. That only works while the plate is
         the size it was designed at: shrink it and the view crops instead of
         fitting, which on a phone meant most of the arm was outside the plate.
         Scaling the camera-space block fits the whole frame; the plate's own
         labels are drawn after the restore, so they keep their real size. */
      var kcam = Math.min(VIEW / 604, VIEW_H / 620);
      g.save(); g.scale(kcam, kcam);

      if (f) {
        var pu = f[0], pv = f[1], pc = f[2];
        for (var i = 0; i < pu.length; i++) {
          var c = pc[i];
          g.fillStyle = "rgb(" + ((c >> 16) & 255) + "," + ((c >> 8) & 255) + "," + (c & 255) + ")";
          g.fillRect(pu[i], pv[i], 1.9, 1.9);
        }
      }

      // The arm, drawn as an arm rather than as a wireframe: each link is a
      // tapered shell between two joint housings, and the housings get a
      // highlight so the chain reads as solid. Widths come from the joint
      // depths the frame returns, so a link nearer the camera is thicker --
      // without that a projected chain looks flat and toy-like.
      if (links.length) {
        // 28 payload uv+z, 29 gripper opening, 30 held, 31 per-joint depth --
        // the frame array is positional and these live past SPHERE_RADIUS.
        var dep = f && f[31] ? f[31] : null;
        var SHELL = "#3f5f66", EDGE = "#7fc3cd", HI = "#a9dbe2";
        // A real arm tapers from a fat shoulder to a slim wrist, so the width
        // comes mostly from position in the chain. Depth only nudges it, and
        // is clamped: straight 1/z made a near joint thirty pixels across and
        // a far one two, which draws a funnel rather than an arm.
        var TAPER = [13, 12.5, 11, 9, 7, 6, 5.2, 4.4];
        var NOMINAL = 1.9;                       // m, roughly plate centre
        var rAt = function (i) {
          var base = TAPER[Math.min(i, TAPER.length - 1)];
          if (!dep) return base;
          var k = NOMINAL / Math.max(0.35, dep[i]);
          return base * Math.max(0.72, Math.min(1.35, k));
        };
        // payload first when it is behind the gripper, so the hand covers it
        var pay = f && f[28] ? f[28] : null, held = !!(f && f[30]);

        chain.forEach(function (sg) {
          var a = links[sg[0]], b = links[sg[1]];
          var ra = rAt(sg[0]) * 0.9, rb = rAt(sg[1]) * 0.9;
          var dx = b[0] - a[0], dy = b[1] - a[1];
          var L = Math.hypot(dx, dy) || 1;
          var nx = -dy / L, ny = dx / L;
          g.beginPath();
          g.moveTo(a[0] + nx * ra, a[1] + ny * ra);
          g.lineTo(b[0] + nx * rb, b[1] + ny * rb);
          g.lineTo(b[0] - nx * rb, b[1] - ny * rb);
          g.lineTo(a[0] - nx * ra, a[1] - ny * ra);
          g.closePath();
          g.fillStyle = SHELL; g.globalAlpha = 0.92; g.fill();
          g.globalAlpha = 1; g.strokeStyle = EDGE; g.lineWidth = 1.1; g.stroke();
          // a highlight down one side, which is what stops it reading as a bar
          g.beginPath();
          g.moveTo(a[0] + nx * ra * 0.45, a[1] + ny * ra * 0.45);
          g.lineTo(b[0] + nx * rb * 0.45, b[1] + ny * rb * 0.45);
          g.strokeStyle = HI; g.globalAlpha = 0.30; g.lineWidth = 1.4; g.stroke();
          g.globalAlpha = 1;
        });
        links.forEach(function (p, i) {
          var r = rAt(i);
          g.beginPath(); g.arc(p[0], p[1], r, 0, 6.284);
          g.fillStyle = SHELL; g.fill();
          g.strokeStyle = EDGE; g.lineWidth = 1.2; g.stroke();
          g.beginPath(); g.arc(p[0] - r * 0.25, p[1] - r * 0.25, r * 0.34, 0, 6.284);
          g.fillStyle = HI; g.globalAlpha = 0.4; g.fill(); g.globalAlpha = 1;
        });

        // The gripper: two fingers on the wrist axis, opening with f[26].
        var tp0 = links[links.length - 1], wp = links[links.length - 2] || tp0;
        var gdx = tp0[0] - wp[0], gdy = tp0[1] - wp[1];
        var gl = Math.hypot(gdx, gdy) || 1;
        var ux = gdx / gl, uy = gdy / gl, px = -uy, py = ux;
        var open = f && typeof f[29] === "number" ? f[29] : 1;
        var rT = rAt(links.length - 1);
        var span = rT * (0.55 + 1.15 * open), fl = rT * 1.9;
        g.strokeStyle = EDGE; g.lineWidth = Math.max(2, rT * 0.42); g.lineCap = "round";
        [1, -1].forEach(function (sgn) {
          var bx = tp0[0] + px * span * sgn, by = tp0[1] + py * span * sgn;
          g.beginPath();
          g.moveTo(tp0[0] + px * span * sgn * 0.35, tp0[1] + py * span * sgn * 0.35);
          g.lineTo(bx, by);
          g.lineTo(bx + ux * fl, by + uy * fl);
          g.stroke();
        });
        g.lineCap = "butt";

        // the thing it is moving, drawn last so the gripper does not bury it
        var drawPayload = function () {
        if (pay && pay.length) {
          // Sized against the drawn gripper rather than off its true metres:
          // the links are drawn to a taper, so a physically-scaled box comes
          // out four times the wrist and reads as a crate on a toy arm.
          var pr = Math.max(3.5, rAt(links.length - 1) * 1.45);
          g.beginPath();
          g.rect(pay[0] - pr, pay[1] - pr, pr * 2, pr * 2);
          g.fillStyle = held ? "#e0a03a" : "#c98a2e";
          g.globalAlpha = 0.95; g.fill(); g.globalAlpha = 1;
          g.strokeStyle = "#f0c979"; g.lineWidth = 1.2; g.stroke();
          if (!held) {
            g.globalAlpha = 0.35; g.strokeStyle = "#f0c979";
            g.beginPath(); g.ellipse(pay[0], pay[1] + pr * 1.1, pr * 1.3, pr * 0.42, 0, 0, 6.284);
            g.stroke(); g.globalAlpha = 1;
          }
        }
        };

        // the tool, and the radius inside which the node cancels and replans
        var tp = links[links.length - 1];
        g.globalAlpha = f && f[20] ? 0.9 : 0.34;
        g.strokeStyle = f && f[20] ? "#ff8a5c" : "#5aa5af";
        g.setLineDash([3, 4]); g.lineWidth = 1;
        g.beginPath(); g.arc(tp[0], tp[1], 46, 0, 6.284); g.stroke();
        g.setLineDash([]); g.globalAlpha = 1;
        g.fillStyle = f && f[20] ? "#ff8a5c" : "#5aa5af";
        g.beginPath(); g.arc(tp[0], tp[1], 4.2, 0, 6.284); g.fill();
        drawPayload();
        label("tool0", tp[0] + 9, tp[1] + 4, f && f[20] ? "#ff8a5c" : "#5aa5af", 9);
      }

      // the motion currently executing, as the watch loop sees it
      if (f && f[25] && f[25].length > 1) {
        var pre = /PREEMPT|cancelled/.test(f[22]);
        g.strokeStyle = pre ? "#ff8a5c" : "#8b8578";
        g.globalAlpha = pre ? 0.85 : 0.5; g.lineWidth = 1.4;
        g.setLineDash([5, 4]);
        g.beginPath();
        f[25].forEach(function (p, i) { i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]); });
        g.stroke(); g.setLineDash([]); g.globalAlpha = 1;
      }
      // the collision object the node injected, at its own SPHERE_RADIUS
      if (f && f[26] && f[26].length) {
        var sp = f[26];
        g.strokeStyle = "#ff8a5c"; g.globalAlpha = 0.55; g.lineWidth = 1.4;
        g.beginPath(); g.arc(sp[0], sp[1], Math.max(8, sp[2]), 0, 6.284); g.stroke();
        g.globalAlpha = 0.10; g.fillStyle = "#ff8a5c"; g.fill();
        g.globalAlpha = 1;
        label("sphere r=" + f[27].toFixed(2), sp[0] + Math.max(8, sp[2]) + 6,
              sp[1] + 3, "#ff8a5c", 9);
      }

      if (f && have) {
        var ox = f[3], oy = f[4], orad = Math.max(6, f[5]), hit = f[6];
        if (!have) { ox = -999; }
        // the obstacle you are holding
        g.strokeStyle = hit ? "#ff8a5c" : "#d7d3c6";
        g.lineWidth = 1.8;
        g.setLineDash(hit ? [] : [4, 4]);
        g.beginPath(); g.arc(ox, oy, orad, 0, 6.284); g.stroke();
        g.setLineDash([]);
        if (hit) {                                    // where the node put it
          var d = f[7];
          g.strokeStyle = "#ff8a5c"; g.lineWidth = 1.2;
          g.beginPath();
          g.moveTo(d[0] - 11, d[1]); g.lineTo(d[0] - 4, d[1]);
          g.moveTo(d[0] + 4, d[1]); g.lineTo(d[0] + 11, d[1]);
          g.moveTo(d[0], d[1] - 11); g.lineTo(d[0], d[1] - 4);
          g.moveTo(d[0], d[1] + 4); g.lineTo(d[0], d[1] + 11);
          g.stroke();
        }
      }
      g.restore();                       // out of camera space

      // plate label
      label("CAMERA  /  depth + color points", 16, 24, "#8b8578", 10);
      // The provenance line does not fit a phone-width plate, and a sentence
      // cut off mid-word reads worse than a shorter one that ends.
      label(meta ? ("pick_z_offset " + meta[9] + "  ·  place_y_offset " + meta[10] +
            (cvn._narrow ? "" : "  ·  read from the node")) : "", 16, 40, "#8b8578", 9.5);
      label("arm chain", 16, 58, "#5aa5af", 9.5);
      if (have) label("your hand", 82, 58, f && f[6] ? "#ff8a5c" : "#8b8578", 9.5);

      g.restore();
      g.strokeStyle = C.rule; g.lineWidth = 1;
      g.strokeRect(0.5, 0.5, VIEW - 1, VIEW_H - 1);

      // ── the pipeline, stage by stage ──────────────────────────────
      var X = cvn._narrow ? PAD : VIEW + PAD,
          W = (cvn._narrow ? cvn._w : cvn._w - VIEW) - PAD * 2,
          y = cvn._narrow ? VIEW_H + 34 : 40;
      label("PIPELINE", X, y - 14, C.signal, 10);
      if (!f) {
        label("move the cursor over the camera plate", X, y + 10, C.mut, 12);
        return;
      }
      var total = f[11], rows = [
        ["cloud in", total, C.ink],
        ["depth gate + workspace box", f[12], C.ink],
        ["colour filter", f[13], C.accent],
        ["arm self-filter", f[14], C.accent]
      ];
      rows.forEach(function (r, k) {
        var yy = y + k * 34;
        label(r[0], X, yy, C.mut, 10);
        bar(X, yy + 6, W - 66, 8, r[1] / total, r[2], 0.85);
        label(r[1].toLocaleString(), X + W, yy + 13, C.ink, 12, "right");
      });

      y += 4 * 34 + 18;
      g.strokeStyle = C.rule; g.beginPath();
      g.moveTo(X, y - 12); g.lineTo(X + W, y - 12); g.stroke();

      // count against the parked baseline, and the threshold that decides
      var count = f[14], base = f[15], diff = count - base, thr = meta[2];
      label("foreign points vs parked baseline", X, y + 6, C.mut, 10);
      var scale = Math.max(thr * 2.2, diff * 1.15, 1);
      bar(X, y + 12, W - 66, 10, diff / scale, diff >= thr ? C.signal : C.accent, 0.85);
      var tx = X + (W - 66) * thr / scale;
      g.strokeStyle = C.ink; g.lineWidth = 1.4;
      g.beginPath(); g.moveTo(tx, y + 8); g.lineTo(tx, y + 26); g.stroke();
      label("threshold " + thr, tx + 5, y + 36, C.ink, 9.5);
      label((diff > 0 ? "+" : "") + diff, X + W, y + 21, C.ink, 13, "right");

      y += 58;
      label("debounce", X, y + 6, C.mut, 10);
      for (var s = 0; s < meta[3]; s++) {
        g.fillStyle = s < f[16] ? C.signal : C.rule;
        g.fillRect(X + s * 20, y + 12, 14, 10);
      }
      label(Math.min(f[16], meta[3]) + " / " + meta[3] + " frames" +
            (f[16] > meta[3] ? "  ·  held " + f[16] : ""),
            X + 20 * meta[3] + 10, y + 21, C.ink, 11);

      y += 46;
      g.strokeStyle = C.rule; g.beginPath();
      g.moveTo(X, y); g.lineTo(X + W, y); g.stroke();
      y += 22;

      // the blind spot, which is the interesting part
      var near = f[9];
      label("obstacle to nearest link", X, y, C.mut, 10);
      if (near < 0) {
        label("no hand in the workspace", X, y + 18, C.mut, 12);
        y += 54;
        label("decision", X, y, C.mut, 10);
        g.fillStyle = C.mut;
        g.font = "500 20px ui-monospace, SFMono-Regular, Menlo, monospace";
        g.textAlign = "left";
        g.fillText(f[22].toUpperCase(), X, y + 26);
        label("baseline holding at " + f[15] + " foreign points", X, y + 46, C.mut, 10);
        y += 66;
        label("frame time", X, y, C.mut, 10);
        bar(X, y + 8, W - 66, 8, f[10] / (meta[4] * 1000), C.ink, 0.7);
        label(f[10].toFixed(1) + " ms", X + W, y + 17, C.ink, 13, "right");
        label("budget " + (meta[4] * 1000).toFixed(0) + " ms at " +
              Math.round(1 / meta[4]) + " Hz", X, y + 30, C.mut, 9.5);
        return;
      }
      var NW = W - 66, dmax = 0.5;
      bar(X, y + 8, NW, 8, near / dmax, near < 0.11 ? C.mut : C.accent, 0.85);
      var bx = X + NW * 0.11 / dmax;
      g.fillStyle = C.ink; g.globalAlpha = 0.18;
      g.fillRect(X, y + 8, bx - X, 8); g.globalAlpha = 1;
      g.strokeStyle = C.ink; g.lineWidth = 1.4;
      g.beginPath(); g.moveTo(bx, y + 4); g.lineTo(bx, y + 22); g.stroke();
      label("0.11 m", bx + 5, y + 32, C.ink, 9.5);
      label(near.toFixed(2) + " m", X + W, y + 17, C.ink, 13, "right");

      y += 54;
      label("decision", X, y, C.mut, 10);
      g.fillStyle = f[6] ? C.signal : C.mut;
      g.font = "500 20px ui-monospace, SFMono-Regular, Menlo, monospace";
      g.textAlign = "left";
      g.fillText(f[6] ? "OBSTACLE" : (near < 0.11 ? "MASKED AS ARM" : "CLEAR"), X, y + 26);
      if (f[6]) label("centroid error " + (f[8] * 100).toFixed(1) + " cm", X, y + 46, C.mut, 10);

      // the last few decisions, so a flicker is visible
      var HW = 3, hx = X + W - hist.length * HW;
      hist.forEach(function (h, k) {
        g.fillStyle = h ? C.signal : C.rule;
        g.fillRect(hx + k * HW, y + 8, HW - 1, 22);
      });

      y += 66;
      label("frame time", X, y, C.mut, 10);
      bar(X, y + 8, W - 66, 8, f[10] / (meta[4] * 1000), C.ink, 0.7);
      label(f[10].toFixed(1) + " ms", X + W, y + 17, C.ink, 13, "right");
      label("budget " + (meta[4] * 1000).toFixed(0) + " ms at " +
            Math.round(1 / meta[4]) + " Hz", X, y + 30, C.mut, 9.5);
    }

    function step(ts) {
      if (!live) return;
      requestAnimationFrame(step);
      if (ts - lastF < 110) return;                   // a shade under the node's 20 Hz
      // Real elapsed time, capped so a backgrounded tab does not teleport the
      // tool past an obstacle on the frame it comes back.
      var dt = lastF ? Math.min(0.25, (ts - lastF) / 1000) : 0.11;
      lastF = ts;
      try {
        var out = pyodide.runPython(
          "arm_frame(" + dt.toFixed(4) + "," + cur.u + "," + cur.v + "," +
          radius + ",2600," + (have ? "True" : "False") + ")");
        if (out) {
          f = out.toJs();
          links = f[18];
          hist.push(f[6]); if (hist.length > 40) hist.shift();
        }
      } catch (e) { /* leave the last frame up */ }
      paint();
      readEl.textContent = !f
        ? "loading"
        : !have
          ? f[22] + "  ·  " + f[14].toLocaleString() +
            " foreign points  ·  no hand in the workspace  ·  " + f[10].toFixed(1) + " ms"
          : (f[20] ? "PREEMPT: obstacle inside " + meta[6].toFixed(2) + " m of the tool"
             : f[6] ? "detected" : f[9] >= 0 && f[9] < 0.11 ? "inside the self-filter"
             : "not enough foreign points") +
            "  ·  " + f[22] + (f[23] ? "  [" + f[23] + "]" : "") + "  ·  " +
            f[9].toFixed(2) + " m from the arm  ·  " + f[10].toFixed(1) + " ms";
    }

    function place(clientX, clientY) {
      var b = cvn.getBoundingClientRect();
      var u = (clientX - b.left) / b.width * cvn._w;
      var v = (clientY - b.top) / b.height * cvn._h;
      // Only the camera plate is live, and when stacked that is the top
      // band rather than the left column.
      if (u > VIEW || v > VIEW_H) { have = false; return; }
      cur.u = u; cur.v = v; have = true;
    }
    cvn.addEventListener("mousemove", function (e) { place(e.clientX, e.clientY); });
    cvn.addEventListener("touchmove", function (e) {
      e.preventDefault(); place(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: false });
    cvn.addEventListener("mouseleave", function () { have = false; });
    cvn.addEventListener("wheel", function (e) {
      e.preventDefault();
      radius = Math.min(0.14, Math.max(0.03, radius - e.deltaY * 0.0001));
    }, { passive: false });

    return {
      start: function (m) {
        meta = m;
        chain = m[8];
        t0 = performance.now();
        live = true; paint(); requestAnimationFrame(step);
      }
    };
  })();

  async function bootArm(pending) {
    var el = document.getElementById("arm");
    if (!el) return;
    try {
      log("loading the arm detector from " + ARM.repo + "…");
      // Started with everything else in boot(); by here they have landed.
      var texts = pending ? await Promise.all(pending)
                          : await Promise.all(ARM.files.map(fetchArmFile));
      for (var i = 0; i < ARM.files.length; i++) {
        var rel = ARM.files[i], txt = texts[i];
        pyodide.globals.set("__src", txt);
        pyodide.globals.set("__path", "/rr/" + rel);
        pyodide.runPython("arm_write(__path, __src)");
        log("  " + rel + "  " + txt.length.toLocaleString() + " bytes");
      }
      pyodide.globals.set("__path", "/rr/reactive_replanning_ur12e/__init__.py");
      pyodide.globals.set("__src", "");
      pyodide.runPython("arm_write(__path, __src)");
      var m = pyodide.runPython("arm_init(20260808)").toJs();
      arm.start(m);
      live("arm");
      log("detector online: threshold " + m[2] + " foreign points, " + m[3] +
          "-frame debounce, " + Math.round(1 / m[4]) + " Hz, preempt inside " +
          m[6] + " m of the tool", "ok");
    } catch (e) {
      log("arm detector unavailable: " + String(e && e.message || e)
          .split("\n").slice(-3).join(" | "), "err");
    }
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

  /* Pyodide, numpy and the modules below them are about 24 MB, and this used to
     fetch all of it before the reader had done anything at all -- including a
     reader on cellular who opened the page, read the header and left. It is now
     deferred to the first sign of engagement: a scroll, a pointer, a key, or
     the plate coming into view.

     Not deferred all the way to a button press, because the chase is supposed
     to be alive when you reach it and the run button stays disabled until the
     runtime is up. Anyone who actually reads this page triggers it within a
     second; a preview crawler never does. */
  var booted = false;
  function bootOnce() {
    if (booted) return;
    booted = true;
    boot();
  }

  /* Triggered by *these* plates coming into view, and by pressing one of their
     own controls -- not by any interaction anywhere on the page. Watching for a
     global pointerdown was the obvious thing and was wrong: pressing a control
     in one of the vendored sections further down booted this runtime too, so a
     reader who only wanted the assembly demo paid for numpy twice. */
  if (window.IntersectionObserver) {
    var io = new IntersectionObserver(function (entries) {
      if (entries.some(function (en) { return en.isIntersecting; })) {
        io.disconnect();
        bootOnce();
      }
    }, { rootMargin: "300px" });
    [cv, document.getElementById("chase"), document.getElementById("race-canvas"),
     document.getElementById("arm")].forEach(function (el) { if (el) io.observe(el); });
  } else {
    bootOnce();
  }
  ["#plan", "#drive", "#race", "#reach"].forEach(function (sel) {
    var host = document.querySelector(sel);
    if (host) host.addEventListener("pointerdown", bootOnce, { once: true, passive: true });
  });
})();