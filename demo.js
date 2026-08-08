/* Runs the global planners from reactive_autonomous_nav in the browser.
   The modules are fetched from GitHub and executed unmodified; only rclpy and
   the message packages are stubbed, exactly as bench/rig.py does offline. */
(function () {
  "use strict";

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
    repo: "abdu7rahman/reactive-replanning-ur12e",
    branch: "main",
    files: ["tests/harness.py", "tests/scene.py",
            "reactive_replanning_ur12e/reactive_replanning.py"]
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
    "        if d['qi'] == 0: d['replans'] = 0        # new cycle, fresh replan budget",
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
    "            float(n.SPHERE_RADIUS)]",
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
    "def chase_init(pmod, pcls, cmod, ccls, flat, h, w, res, radius):",
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
    "    c.get_logger = lambda: types.SimpleNamespace(info=lambda *a, **k: None, warn=lambda *a, **k: None, error=lambda *a, **k: None)",
    "    _DWA.update(p=p, c=c, res=res, h=h, w=w, path=None, pose=(0.0, 0.0, 0.0),",
    "                replan=False)",
    "    # base_link resolves to the robot; map and odom are aligned",
    "    c._get_tf = lambda tgt, src: (_DWA['pose'] if 'base_link' in (tgt, src)",
    "                                  else (0.0, 0.0, 0.0))",
    "    p._get_tf = c._get_tf",
    "    return [c.max_vel, c.max_yawrate, c.max_accel, c.max_dyawrate, c.dt,",
    "            c.predict_time, c.goal_tol, c.wp_tol, c.lookahead_wps,",
    "            [int(v) for v in g.ravel()]]",
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
        var r = await fetch(url, { cache: "no-store" });
        if (r.ok) { var t = await r.text(); return { text: t, branch: BRANCHES[i], url: url }; }
      } catch (e) { /* try next */ }
    }
    throw new Error("could not fetch " + file);
  }

  async function boot() {
    try {
      log("loading pyodide runtime…");
      // exposed so the page can be inspected from a test harness
      window.__pyodide = pyodide = await loadPyodide({ indexURL: "https://cdn.jsdelivr.net/pyodide/v0.26.2/full/" });
      log("pyodide " + pyodide.version, "ok");
      log("loading numpy…");
      await pyodide.loadPackage("numpy");
      log("numpy ready", "ok");
      pyodide.runPython(BOOTSTRAP);
      log("ros stubbed at the import boundary", "ok");

      var fetched = {};                 // kept so the race worker can reuse them
      for (var key in MODULES) {
        var m = MODULES[key];
        var src = await fetchSource(m.file);
        fetched[m.file.replace(".py", "")] = src.text;
        pyodide.globals.set("__src", src.text);
        pyodide.globals.set("__name_", m.file.replace(".py", ""));
        var found = pyodide.runPython("load_module(__name_, __src)").toJs();
        log(m.file + "  " + src.text.length.toLocaleString() + " bytes from " +
            src.branch + "  ->  " + found.join(", "), "ok");
      }
      var dsrc = await fetchSource(DWA.file);
      pyodide.globals.set("__src", dsrc.text);
      pyodide.globals.set("__name_", DWA.file.replace(".py", ""));
      pyodide.runPython("load_module(__name_, __src)");
      log(DWA.file + "  " + dsrc.text.length.toLocaleString() + " bytes from " + dsrc.branch, "ok");
      startChase();

      // The other four local controllers, for the race. The race runs in its
      // own worker, so these are fetched here and handed over by message --
      // one download, two runtimes.
      var raceSrc = { astar_planner: fetched.astar_planner, dwa_controller: dsrc.text };
      for (var i = 0; i < RACERS.length; i++) {
        if (RACERS[i].file === DWA.file) continue;
        var rs = await fetchSource(RACERS[i].file);
        raceSrc[RACERS[i].file.replace(".py", "")] = rs.text;
        log(RACERS[i].file + "  " + rs.text.length.toLocaleString() + " bytes from " + rs.branch, "ok");
      }
      race.ready(BOOTSTRAP, raceSrc);

      ready = true;
      runBtn.disabled = false;
      runLabel.textContent = "Run planner";
      log("ready. draw a map and hit run.", "ok");

      // The arm goes last on purpose: its harness stubs ROS for itself, and
      // the nav modules have already bound their own names by now.
      await bootArm();
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
    var cvc = document.getElementById("chase");
    if (!cvc) return { start: function () {} };
    var g = cvc.getContext("2d");
    var readEl = document.getElementById("chase-read");
    var RES = 0.05;                                   // m per costmap cell
    var CELL = 14;                                    // px per cell
    var CW = Math.floor(cvc.width / CELL), CH = Math.floor(cvc.height / CELL);
    var PX = cvc.width / CW;                          // px per cell, exact
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
    var nTraj = 0, state = 3;
    var planMs = 0, planned = { x: 1e9, y: 1e9 }, drops = 0, dirty = false, broke = false;
    var CTL_MS = 100;                                 // overwritten with the node's own dt

    function toPx(mx, my) { return [mx / RES * PX, my / RES * PX]; }

    function paint() {
      g.fillStyle = C.paper; g.fillRect(0, 0, cvc.width, cvc.height);
      g.strokeStyle = C.rule; g.globalAlpha = 0.5; g.lineWidth = 1;
      g.beginPath();
      for (var c = 0; c <= CW; c += 5) { g.moveTo(Math.round(c * PX) + .5, 0); g.lineTo(Math.round(c * PX) + .5, cvc.height); }
      for (var r = 0; r <= CH; r += 5) { g.moveTo(0, Math.round(r * PX) + .5); g.lineTo(cvc.width, Math.round(r * PX) + .5); }
      g.stroke(); g.globalAlpha = 1;

      // The inflation layer the controller is actually reading. A whisper --
      // it covers a lot of ground and the trajectories have to stay legible on
      // top of it.
      if (cost) {
        g.fillStyle = C.signal;
        for (var i = 0; i < cost.length; i++) {
          var v = cost[i];
          if (v < 40 || occ[i]) continue;
          g.globalAlpha = 0.03 + 0.09 * (v / 252);
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

      // ...and run the controller at its own rate
      if (ts - lastCtl >= CTL_MS) {
        lastCtl = ts;
        try {
          var out = pyodide.runPython(
            "chase_step(" + bot.x + "," + bot.y + "," + bot.yaw + "," +
            bot.v + "," + bot.w + ")").toJs();
          bot.v = out[0]; bot.w = out[1]; nTraj = out[2]; state = out[7];
          best = [out[4], out[5]]; fan = out[6];
        } catch (e) {
          bot.v = 0; bot.w = 0; fan = []; best = null; state = 5;
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
        bot.yaw = 0; bot.v = bot.w = 0; fan = []; best = null; plan = []; dirty = true;
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
                    " ms  ·  DWA scoring " + nTraj + " rollouts  ·  v " +
                    bot.v.toFixed(2) + " m/s  w " + (bot.w >= 0 ? "+" : "") +
                    bot.w.toFixed(2) + " rad/s  ·  " + d.toFixed(2) + " m out";
    }

    function setGoal(clientX, clientY) {
      var b = cvc.getBoundingClientRect();
      goal.x = Math.max(RES, Math.min((CW - 1) * RES, (clientX - b.left) / b.width * CW * RES));
      goal.y = Math.max(RES, Math.min((CH - 1) * RES, (clientY - b.top) / b.height * CH * RES));
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
      dirty = true;                                    // force an immediate re-plan
      log("obstacle dropped, costmap re-inflated, global plan invalidated");
    }

    cvc.addEventListener("mousemove", function (ev) { setGoal(ev.clientX, ev.clientY); });
    cvc.addEventListener("mousedown", function (ev) { ev.preventDefault(); drop(ev.clientX, ev.clientY); });
    cvc.addEventListener("touchmove", function (ev) {
      ev.preventDefault(); setGoal(ev.touches[0].clientX, ev.touches[0].clientY);
    }, { passive: false });
    cvc.addEventListener("mouseleave", function () { have = false; });

    return {
      start: function () {
        pyodide.globals.set("__occ", Array.from(occ));
        var meta = pyodide.runPython(
          "chase_init('astar_planner','" + MODULES.astar.cls + "','dwa_controller','" +
          DWA.cls + "', list(__occ.to_py()) if hasattr(__occ,'to_py') else list(__occ), " +
          CH + ", " + CW + ", " + RES + ", " + INFLATE + ")").toJs();
        CTL_MS = Math.round(meta[4] * 1000);           // the node's own dt
        cost = meta[9];
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
    var cvr = document.getElementById("race-canvas");
    if (!cvr) return { ready: function () {} };
    var g = cvr.getContext("2d");
    var readEl = document.getElementById("race-read");
    var keyEl = document.getElementById("race-key");
    var runBtnEl = document.getElementById("race-run");
    var RES = 0.05;
    var CELL = 12;
    var CW = Math.floor(cvr.width / CELL), CH = Math.floor(cvr.height / CELL);
    var PX = cvr.width / CW;
    var occ = new Uint8Array(CW * CH);
    var plan = [], trails = [], rows = [], live = false, armed = false, raf2 = 0;
    var worker = null;
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
      g.fillStyle = C.paper; g.fillRect(0, 0, cvr.width, cvr.height);
      g.strokeStyle = C.rule; g.globalAlpha = 0.45; g.lineWidth = 1;
      g.beginPath();
      for (var c = 0; c <= CW; c += 8) { g.moveTo(c * PX + 0.5, 0); g.lineTo(c * PX + 0.5, cvr.height); }
      for (var r = 0; r <= CH; r += 8) { g.moveTo(0, r * PX + 0.5); g.lineTo(cvr.width, r * PX + 0.5); }
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
      // Called once the main thread has fetched the sources, so the worker
      // gets them by message rather than downloading everything a second time.
      ready: function (bootstrap, sources) {
        worker = new Worker("race-worker.js");
        worker.onmessage = function (e) {
          var msg = e.data;
          if (msg.type === "ready") { armed = true; readyRead(); }
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
    var cvn = document.getElementById("arm");
    if (!cvn) return { start: function () {} };
    var g = cvn.getContext("2d");
    var readEl = document.getElementById("arm-read");
    var VIEW = 604;                                   // the camera plate
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
      g.fillStyle = C.paper; g.fillRect(0, 0, cvn.width, cvn.height);

      // ── the camera plate ──────────────────────────────────────────
      g.save(); g.beginPath(); g.rect(0, 0, VIEW, cvn.height); g.clip();
      g.fillStyle = "#14140f"; g.fillRect(0, 0, VIEW, cvn.height);

      if (f) {
        var pu = f[0], pv = f[1], pc = f[2];
        for (var i = 0; i < pu.length; i++) {
          var c = pc[i];
          g.fillStyle = "rgb(" + ((c >> 16) & 255) + "," + ((c >> 8) & 255) + "," + (c & 255) + ")";
          g.fillRect(pu[i], pv[i], 1.9, 1.9);
        }
      }

      // the arm chain, moving, so the self-filter has something to track
      if (links.length) {
        g.strokeStyle = "#5aa5af"; g.globalAlpha = 0.5; g.lineWidth = 2;
        g.lineCap = "round";
        g.beginPath();
        chain.forEach(function (s) {
          g.moveTo(links[s[0]][0], links[s[0]][1]);
          g.lineTo(links[s[1]][0], links[s[1]][1]);
        });
        g.stroke();
        g.fillStyle = "#5aa5af";
        links.forEach(function (p) {
          g.beginPath(); g.arc(p[0], p[1], 2.6, 0, 6.284); g.fill();
        });
        // the tool, and the radius inside which the node cancels and replans
        var tp = links[links.length - 1];
        g.globalAlpha = f && f[20] ? 0.9 : 0.34;
        g.strokeStyle = f && f[20] ? "#ff8a5c" : "#5aa5af";
        g.setLineDash([3, 4]); g.lineWidth = 1;
        g.beginPath(); g.arc(tp[0], tp[1], 46, 0, 6.284); g.stroke();
        g.setLineDash([]); g.globalAlpha = 1;
        g.fillStyle = f && f[20] ? "#ff8a5c" : "#5aa5af";
        g.beginPath(); g.arc(tp[0], tp[1], 4.2, 0, 6.284); g.fill();
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
      // plate label
      label("CAMERA  /  depth + color points", 16, 24, "#8b8578", 10);
      label(meta ? "pick_z_offset " + meta[9] + "  ·  place_y_offset " + meta[10] +
            "  ·  read from the node" : "", 16, 40, "#8b8578", 9.5);
      label("arm chain", 16, 58, "#5aa5af", 9.5);
      if (have) label("your hand", 82, 58, f && f[6] ? "#ff8a5c" : "#8b8578", 9.5);

      g.restore();
      g.strokeStyle = C.rule; g.lineWidth = 1;
      g.strokeRect(0.5, 0.5, VIEW - 1, cvn.height - 1);

      // ── the pipeline, stage by stage ──────────────────────────────
      var X = VIEW + PAD, W = cvn.width - VIEW - PAD * 2, y = 40;
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
      var u = (clientX - b.left) / b.width * cvn.width;
      var v = (clientY - b.top) / b.height * cvn.height;
      if (u > VIEW) { have = false; return; }
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

  async function bootArm() {
    var el = document.getElementById("arm");
    if (!el) return;
    try {
      log("loading the arm detector from " + ARM.repo + "…");
      for (var i = 0; i < ARM.files.length; i++) {
        var rel = ARM.files[i];
        var url = "https://raw.githubusercontent.com/" + ARM.repo + "/" +
                  ARM.branch + "/" + rel;
        var r = await fetch(url, { cache: "no-store" });
        if (!r.ok) throw new Error(rel + ": HTTP " + r.status);
        var txt = await r.text();
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

  /* ---------- pi0.5, over a policy server -------------------------------
     The one thing here that does not run in the tab, and cannot: pi0.5 is a
     3B-parameter VLA and its base checkpoint is 12.44 GB. Physical
     Intelligence's own answer is to run it on a GPU behind a policy server and
     query that from whatever is holding the robot, so this page is that
     client.

     The protocol is openpi's: a websocket, msgpack-numpy on the wire, a
     metadata frame on connect, one observation dict up, one action chunk back.
     The observation is the one examples/droid/main.py builds -- two 224x224
     uint8 views, 7 joint positions, 1 gripper, and a language instruction --
     and the reply is [10, 8]: ten steps of seven joint velocities plus a
     gripper command.
     ------------------------------------------------------------------- */

  // msgpack, only as much of it as this protocol needs.
  //
  // Written out rather than pulled from a CDN for one specific reason:
  // msgpack-numpy identifies an array by *bytes* keys -- it tests `b'nd' in
  // obj` -- while the dtype string beside them has to stay a msgpack str.
  // Distinguishing bin from str is the whole job here, and @msgpack/msgpack
  // encodes a JS Map as 0x80, an empty map, which the server receives as an
  // observation with nothing in it. So: a map is written as an explicit list
  // of [key, value] pairs, and a key is a string or a Uint8Array depending on
  // which side of that line it belongs on.
  var mp = (function () {
    var enc = new TextEncoder(), dec = new TextDecoder();

    function Writer() { this.b = new Uint8Array(1024); this.n = 0; }
    Writer.prototype.need = function (k) {
      if (this.n + k <= this.b.length) return;
      var cap = this.b.length;
      while (cap < this.n + k) cap *= 2;
      var nb = new Uint8Array(cap); nb.set(this.b.subarray(0, this.n)); this.b = nb;
    };
    Writer.prototype.u8 = function (v) { this.need(1); this.b[this.n++] = v; };
    Writer.prototype.raw = function (a) { this.need(a.length); this.b.set(a, this.n); this.n += a.length; };
    Writer.prototype.be = function (v, k) {
      this.need(k);
      for (var i = k - 1; i >= 0; i--) { this.b[this.n + i] = v & 0xff; v = Math.floor(v / 256); }
      this.n += k;
    };
    Writer.prototype.out = function () { return this.b.subarray(0, this.n); };

    function hdr(w, small, h8, h16, h32, len) {
      if (small !== null && len < small.max) w.u8(small.base | len);
      else if (len < 256 && h8 !== null) { w.u8(h8); w.be(len, 1); }
      else if (len < 65536) { w.u8(h16); w.be(len, 2); }
      else { w.u8(h32); w.be(len, 4); }
    }

    function write(w, v) {
      if (v === null || v === undefined) { w.u8(0xc0); return; }
      if (v === true) { w.u8(0xc3); return; }
      if (v === false) { w.u8(0xc2); return; }
      if (typeof v === "number") {
        if (Number.isInteger(v) && v >= 0 && v < 128) { w.u8(v); return; }
        if (Number.isInteger(v) && v < 0 && v >= -32) { w.u8(0x100 + v); return; }
        if (Number.isInteger(v) && v >= 0 && v < 4294967296) { w.u8(0xce); w.be(v, 4); return; }
        if (Number.isInteger(v) && v < 0 && v >= -2147483648) { w.u8(0xd2); w.be(v >>> 0, 4); return; }
        w.u8(0xcb);                                    // float64
        var d = new DataView(new ArrayBuffer(8)); d.setFloat64(0, v);
        w.raw(new Uint8Array(d.buffer));
        return;
      }
      if (typeof v === "string") {
        var s = enc.encode(v);
        hdr(w, { base: 0xa0, max: 32 }, 0xd9, 0xda, 0xdb, s.length);
        w.raw(s); return;
      }
      if (v instanceof Uint8Array) {                   // bin, never str
        hdr(w, null, 0xc4, 0xc5, 0xc6, v.length);
        w.raw(v); return;
      }
      if (Array.isArray(v)) {
        hdr(w, { base: 0x90, max: 16 }, null, 0xdc, 0xdd, v.length);
        for (var i = 0; i < v.length; i++) write(w, v[i]);
        return;
      }
      if (v && v.__map) {                              // [[k, v], ...]
        hdr(w, { base: 0x80, max: 16 }, null, 0xde, 0xdf, v.__map.length);
        for (var j = 0; j < v.__map.length; j++) {
          write(w, v.__map[j][0]); write(w, v.__map[j][1]);
        }
        return;
      }
      throw new Error("msgpack: cannot encode " + Object.prototype.toString.call(v));
    }

    function Reader(b) { this.b = b; this.d = new DataView(b.buffer, b.byteOffset, b.byteLength); this.i = 0; }
    Reader.prototype.read = function () {
      var c = this.b[this.i++];
      if (c < 0x80) return c;
      if (c >= 0xe0) return c - 256;
      if ((c & 0xf0) === 0x80) return this.map(c & 0x0f);
      if ((c & 0xf0) === 0x90) return this.arr(c & 0x0f);
      if ((c & 0xe0) === 0xa0) return this.str(c & 0x1f);
      switch (c) {
        case 0xc0: return null;
        case 0xc2: return false;
        case 0xc3: return true;
        case 0xc4: return this.bin(this.uint(1));
        case 0xc5: return this.bin(this.uint(2));
        case 0xc6: return this.bin(this.uint(4));
        case 0xca: { var f = this.d.getFloat32(this.i); this.i += 4; return f; }
        case 0xcb: { var g2 = this.d.getFloat64(this.i); this.i += 8; return g2; }
        case 0xcc: return this.uint(1);
        case 0xcd: return this.uint(2);
        case 0xce: return this.uint(4);
        case 0xcf: return this.uint(8);
        case 0xd0: { var v0 = this.d.getInt8(this.i); this.i += 1; return v0; }
        case 0xd1: { var v1 = this.d.getInt16(this.i); this.i += 2; return v1; }
        case 0xd2: { var v2 = this.d.getInt32(this.i); this.i += 4; return v2; }
        case 0xd9: return this.str(this.uint(1));
        case 0xda: return this.str(this.uint(2));
        case 0xdb: return this.str(this.uint(4));
        case 0xdc: return this.arr(this.uint(2));
        case 0xdd: return this.arr(this.uint(4));
        case 0xde: return this.map(this.uint(2));
        case 0xdf: return this.map(this.uint(4));
      }
      throw new Error("msgpack: unsupported byte 0x" + c.toString(16));
    };
    Reader.prototype.uint = function (k) {
      var v = 0;
      for (var i = 0; i < k; i++) v = v * 256 + this.b[this.i + i];
      this.i += k; return v;
    };
    Reader.prototype.str = function (n) { var s = dec.decode(this.b.subarray(this.i, this.i + n)); this.i += n; return s; };
    Reader.prototype.bin = function (n) { var s = this.b.subarray(this.i, this.i + n); this.i += n; return s; };
    Reader.prototype.arr = function (n) { var a = []; for (var i = 0; i < n; i++) a.push(this.read()); return a; };
    Reader.prototype.map = function (n) {
      // A Map, so that bytes keys survive as bytes -- a plain object would
      // stringify them and lose the distinction the format depends on.
      var m = new Map();
      for (var i = 0; i < n; i++) { var k = this.read(); m.set(typeof k === "string" ? k : dec.decode(k), this.read()); }
      return m;
    };

    return {
      map: function (pairs) { return { __map: pairs }; },
      bytes: function (s) { return enc.encode(s); },
      encode: function (v) { var w = new Writer(); write(w, v); return w.out(); },
      decode: function (b) { return new Reader(b).read(); }
    };
  })();

  // msgpack-numpy's array convention, on top of that.
  var mpn = (function () {
    function arr(typed, shape, dtypeStr) {
      return mp.map([
        [mp.bytes("nd"), true],
        [mp.bytes("type"), dtypeStr],          // a str: '|u1', '<f4'
        [mp.bytes("kind"), new Uint8Array(0)], // b'', anything but a void dtype
        [mp.bytes("shape"), shape],
        [mp.bytes("data"), new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength)]
      ]);
    }
    return {
      u8: function (a, shape) { return arr(a, shape, "|u1"); },
      f32: function (a, shape) { return arr(a, shape, "<f4"); },
      toArray: function (m) {
        if (!(m instanceof Map) || !m.has("data")) return null;
        var type = m.get("type"), shape = m.get("shape"), data = m.get("data");
        if (type instanceof Uint8Array) type = new TextDecoder().decode(type);
        if (!type || !shape || !data) return null;
        var buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
        var flat = /f4$/.test(type) ? new Float32Array(buf)
                 : /f8$/.test(type) ? new Float64Array(buf)
                 : /u1$/.test(type) ? new Uint8Array(buf) : null;
        return flat ? { data: flat, shape: shape.map(Number) } : null;
      }
    };
  })();

  var pi05 = (function () {
    var sec = document.getElementById("policy");
    if (!sec) return { init: function () {} };
    var cv = document.getElementById("pi-canvas");
    var g = cv.getContext("2d");
    var readEl = document.getElementById("pi-read");
    var rawEl = document.getElementById("pi-raw");
    var askBtn = document.getElementById("pi-ask");
    var promptEl = document.getElementById("pi-prompt");
    var fileEl = document.getElementById("pi-file");
    var server = sec.getAttribute("data-server") || "";
    var loopback = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
    var q = new URLSearchParams(location.search).get("pi");
    if (loopback && q) server = q;

    var ws = null, meta = null, busy = false, chunk = null, scene = null;
    // A plausible DROID rest pose. It is a starting point to perturb, not a
    // measurement of anything.
    var joints = [0.0, -0.35, 0.0, -2.2, 0.0, 2.0, 0.79], gripper = 0.0;

    function say(t) { readEl.textContent = t; }

    function sceneImage() {
      // 224x224 uint8 RGB, which is what resize_with_pad produces upstream.
      var t = document.createElement("canvas");
      t.width = t.height = 224;
      var c = t.getContext("2d");
      c.fillStyle = "#000"; c.fillRect(0, 0, 224, 224);
      if (scene) {
        var iw = scene.width || scene.videoWidth, ih = scene.height || scene.videoHeight;
        var s = Math.min(224 / iw, 224 / ih);          // pad, do not stretch
        var w = iw * s, h = ih * s;
        c.drawImage(scene, (224 - w) / 2, (224 - h) / 2, w, h);
      }
      var d = c.getImageData(0, 0, 224, 224).data;     // RGBA
      var out = new Uint8Array(224 * 224 * 3);
      for (var i = 0, j = 0; i < d.length; i += 4) {
        out[j++] = d[i]; out[j++] = d[i + 1]; out[j++] = d[i + 2];
      }
      return out;
    }

    function observation() {
      var img = sceneImage();
      // str keys, because that is what openpi's server reads them as.
      return mp.map([
        ["observation/exterior_image_1_left", mpn.u8(img, [224, 224, 3])],
        ["observation/wrist_image_left", mpn.u8(img, [224, 224, 3])],
        ["observation/joint_position", mpn.f32(new Float32Array(joints), [7])],
        ["observation/gripper_position", mpn.f32(new Float32Array([gripper]), [1])],
        ["prompt", promptEl.value.trim()]
      ]);
    }

    function drawChunk() {
      g.fillStyle = C.paper; g.fillRect(0, 0, cv.width, cv.height);
      // Bottom margin clears the status line, which is overlaid on the canvas
      // and would otherwise sit on top of the step numbers.
      var L = 78, R = cv.width - 150, T = 34, B = cv.height - 68;
      g.strokeStyle = C.rule; g.lineWidth = 1;
      g.beginPath(); g.moveTo(L, T); g.lineTo(L, B); g.lineTo(R, B); g.stroke();
      g.font = "500 10px ui-monospace, SFMono-Regular, Menlo, monospace";
      g.fillStyle = C.mut; g.textAlign = "left";
      if (!chunk) {
        g.fillText("the action chunk will be plotted here", L + 10, (T + B) / 2);
        return;
      }
      var H = chunk.shape[0], D = chunk.shape[1];
      var lo = Infinity, hi = -Infinity;
      for (var i = 0; i < chunk.data.length; i++) {
        lo = Math.min(lo, chunk.data[i]); hi = Math.max(hi, chunk.data[i]);
      }
      if (!(hi > lo)) { hi = lo + 1; }
      var pad = (hi - lo) * 0.12; lo -= pad; hi += pad;
      var x = function (k) { return L + (R - L) * (H === 1 ? 0.5 : k / (H - 1)); };
      var y = function (v) { return B - (B - T) * ((v - lo) / (hi - lo)); };

      // zero line, because a joint velocity chunk is read against zero
      if (lo < 0 && hi > 0) {
        g.strokeStyle = C.rule; g.setLineDash([3, 4]);
        g.beginPath(); g.moveTo(L, y(0)); g.lineTo(R, y(0)); g.stroke(); g.setLineDash([]);
      }
      g.fillStyle = C.mut; g.textAlign = "right";
      g.fillText(hi.toFixed(2), L - 8, T + 4);
      g.fillText(lo.toFixed(2), L - 8, B);
      if (lo < 0 && hi > 0) g.fillText("0", L - 8, y(0) + 3);
      g.textAlign = "center";
      for (var k = 0; k < H; k++) g.fillText(String(k), x(k), B + 16);
      g.textAlign = "left";
      g.fillText("step in the chunk", L, T - 14);

      var COL = ["#9a4a26", "#3f6b57", "#d6b27c", "#5a7d8c", "#8a6a94",
                 "#b06a3b", "#6d8f7a", "#c0894f"];
      var ends = [];
      for (var d2 = 0; d2 < D; d2++) {
        g.strokeStyle = COL[d2 % COL.length];
        g.lineWidth = d2 === D - 1 ? 2.4 : 1.6;
        if (d2 === D - 1) g.setLineDash([5, 3]);
        g.beginPath();
        for (var k2 = 0; k2 < H; k2++) {
          var v = chunk.data[k2 * D + d2];
          k2 ? g.lineTo(x(k2), y(v)) : g.moveTo(x(k2), y(v));
        }
        g.stroke(); g.setLineDash([]);
        ends.push({ d: d2, y: y(chunk.data[(H - 1) * D + d2]) });
      }
      // Where traces converge the end labels land on top of each other, so
      // push them apart before drawing. The leader line keeps each one tied
      // to the trace it belongs to.
      ends.sort(function (a, b) { return a.y - b.y; });
      var MINGAP = 13;
      for (var i2 = 1; i2 < ends.length; i2++) {
        if (ends[i2].y - ends[i2 - 1].y < MINGAP) ends[i2].y = ends[i2 - 1].y + MINGAP;
      }
      var over = ends.length ? ends[ends.length - 1].y - B : 0;
      if (over > 0) for (var i3 = 0; i3 < ends.length; i3++) ends[i3].y -= over;
      ends.forEach(function (e) {
        var trueY = y(chunk.data[(H - 1) * D + e.d]);
        g.strokeStyle = COL[e.d % COL.length]; g.globalAlpha = 0.45; g.lineWidth = 1;
        g.beginPath(); g.moveTo(R, trueY); g.lineTo(R + 8, e.y - 3); g.stroke();
        g.globalAlpha = 1;
        g.fillStyle = COL[e.d % COL.length]; g.textAlign = "left";
        g.fillText(e.d === D - 1 ? "gripper" : "joint " + (e.d + 1) + " vel", R + 11, e.y);
      });
    }

    function connect() {
      return new Promise(function (resolve, reject) {
        if (ws && ws.readyState === 1) return resolve(ws);
        var sock;
        try { sock = new WebSocket(server); } catch (e) { return reject(e); }
        sock.binaryType = "arraybuffer";
        var got = false;
        sock.onopen = function () { say("connected, waiting for the server's metadata…"); };
        sock.onmessage = function (ev) {
          if (got) return;                       // the first frame is metadata
          got = true;
          try {
            var m = mp.decode(new Uint8Array(ev.data));
            meta = {};
            if (m instanceof Map) m.forEach(function (v, k) { meta[k] = v; });
          } catch (e) { meta = null; }
          ws = sock; resolve(sock);
        };
        sock.onerror = function () { reject(new Error("could not reach " + server)); };
        sock.onclose = function () { if (!got) reject(new Error("server closed the connection")); ws = null; };
      });
    }

    async function ask() {
      if (busy) return;
      if (!server) {
        say("no policy server configured");
        rawEl.textContent =
          "data-server on <section id=\"policy\"> is empty, so there is nowhere to send this.\n\n" +
          "Point it at an openpi policy server:\n" +
          "  uv run scripts/serve_policy.py --env DROID\n\n" +
          "or, to build against the protocol without a GPU:\n" +
          "  python3 tools/stub_policy_server.py --port 8000\n" +
          "  data-server=\"ws://127.0.0.1:8000\"";
        return;
      }
      busy = true; askBtn.textContent = "Asking…";
      try {
        say("connecting to " + server + "…");
        var sock = await connect();
        say("sending one observation…");
        var t0 = performance.now();
        var reply = await new Promise(function (resolve, reject) {
          var timer = setTimeout(function () { reject(new Error("no reply in 30 s")); }, 30000);
          sock.onmessage = function (ev) { clearTimeout(timer); resolve(ev.data); };
          sock.onerror = function () { clearTimeout(timer); reject(new Error("socket error")); };
          sock.send(mp.encode(observation()));
        });
        var ms = Math.round(performance.now() - t0);
        if (typeof reply === "string") {          // the server's error channel
          say("the server rejected it");
          rawEl.textContent = reply;
          busy = false; askBtn.textContent = "Ask π0.5"; return;
        }
        var decoded = mp.decode(new Uint8Array(reply));
        var actions = (decoded instanceof Map) ? mpn.toArray(decoded.get("actions")) : null;
        if (!actions) {
          say("the reply had no actions array");
          rawEl.textContent = "decoded keys: " + Array.from(decoded.keys()).map(String).join(", ");
          busy = false; askBtn.textContent = "Ask π0.5"; return;
        }
        chunk = actions;
        drawChunk();
        var H = actions.shape[0], D = actions.shape[1];
        say("action chunk [" + H + ", " + D + "] back in " + ms + " ms" +
            (meta && meta.note ? " · " + meta.note : ""));
        var lines = [];
        if (meta) lines.push("server metadata: " + JSON.stringify(meta));
        lines.push("actions shape [" + H + ", " + D + "], first three steps:");
        for (var r = 0; r < Math.min(3, H); r++) {
          var row = [];
          for (var c = 0; c < D; c++) row.push(actions.data[r * D + c].toFixed(4));
          lines.push("  [" + row.join(", ") + "]");
        }
        rawEl.textContent = lines.join("\n");
      } catch (e) {
        say("failed: " + (e && e.message ? e.message : e));
        rawEl.textContent = String(e && e.stack ? e.stack : e);
      }
      busy = false; askBtn.textContent = "Ask π0.5";
    }

    function useArm() {
      var armCv = document.getElementById("arm");
      if (!armCv) return;
      var t = document.createElement("canvas");
      t.width = armCv.width; t.height = armCv.height;
      t.getContext("2d").drawImage(armCv, 0, 0);
      scene = t;
    }

    function useFile(f) {
      var url = URL.createObjectURL(f);
      var im = new Image();
      im.onload = function () { scene = im; URL.revokeObjectURL(url); say(f.name + " · press ask"); };
      im.onerror = function () { say("could not read that file"); };
      im.src = url;
    }

    function slider(i, el, out) {
      el.addEventListener("input", function () {
        var v = parseFloat(el.value);
        if (i < 7) joints[i] = v; else gripper = v;
        out.textContent = v.toFixed(2);
      });
    }

    return {
      init: function () {
        for (var i = 0; i < 8; i++) {
          var el = document.getElementById("pi-j" + i);
          var out = document.getElementById("pi-jv" + i);
          if (!el) continue;
          el.value = i < 7 ? joints[i] : gripper;
          out.textContent = parseFloat(el.value).toFixed(2);
          slider(i, el, out);
        }
        document.getElementById("pi-src-arm").addEventListener("click", function () {
          useArm(); say("the arm cell · press ask");
        });
        document.getElementById("pi-src-file").addEventListener("click", function () { fileEl.click(); });
        fileEl.addEventListener("change", function (e) {
          if (e.target.files && e.target.files[0]) useFile(e.target.files[0]);
        });
        askBtn.addEventListener("click", ask);
        useArm();
        drawChunk();
        say(server ? "server: " + server + " · press ask"
                   : "no policy server configured · see below");
      }
    };
  })();

  PRESETS.rooms();
  draw();
  pi05.init();
  logEl.textContent = "reactive_autonomous_nav / browser runtime";
  boot();
})();