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
    rrt:        { file: "rrt_planner.py",        cls: "RRTPlannerNode",        call: "_rrt" }
  };
  var DWA = { file: "dwa_controller.py", cls: "DWAControllerNode" };
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
    "    else:",
    "        res = getattr(node, '_astar' if kind == 'astar' else '_theta_star')((sr, sc), (gr, gc))",
    "        ms = (time.perf_counter() - t0) * 1000.0",
    "        p, e = res",
    "        path = [[int(a), int(b)] for a, b in (p or [])]",
    "        expl = [[int(a), int(b)] for a, b in (e or [])]",
    "    return [path, expl, ms]",
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
      var dsrc = await fetchSource(DWA.file);
      pyodide.globals.set("__src", dsrc.text);
      pyodide.globals.set("__name_", DWA.file.replace(".py", ""));
      pyodide.runPython("load_module(__name_, __src)");
      log(DWA.file + "  " + dsrc.text.length.toLocaleString() + " bytes from " + dsrc.branch, "ok");
      startChase();

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
