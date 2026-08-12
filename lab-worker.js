/* Runtime for the three vendored demos: quadruped-learned-cost, the assembly
   port, and the foundation model's action space and watchlist.

   Off the main thread on purpose, and not for the reason the race worker is.
   The race worker exists because MPPI's tick is one indivisible 470 ms call.
   This one exists because a single qlc episode is a 240x240 feature stack, an
   A* over 57,600 cells and several hundred DWA ticks, and there is no point in
   the page at which that can be interrupted -- run it on the main thread and
   the scroll stops for as long as it takes.

   It also keeps scipy and pydantic off the critical path. Nothing here loads
   until the reader presses something in one of these three sections, so a
   visitor who only wants the nav demos never pays for a second runtime.

   Every message back is JSON. Pyodide can hand typed arrays across directly,
   but the conversion rules differ by type and by pyodide version, and the one
   array big enough to care about -- the 57,600-cell material map -- goes as
   base64 instead. One rule for everything, and no proxy lifetimes to manage
   across a postMessage boundary. */

"use strict";

importScripts("https://cdn.jsdelivr.net/pyodide/v0.26.2/full/pyodide.js");

var VENDOR_BASE = new URL("vendor/", self.location.href).href;

/* The vendored trees, listed rather than discovered: a static host has no
   directory index, and a list that must be edited when a file is added is a
   list that says what the demo depends on. Import order does not matter --
   these are only written to the filesystem here. */
var FILES = [
  "rfm/__init__.py",
  "rfm/schemas.py",
  "rfm/data/__init__.py",
  "rfm/data/action_space.py",
  "rfm/eval/__init__.py",
  "rfm/eval/ablations.py",
  "rfm/eval/metrics.py",
  "rfm/orchestration/__init__.py",
  "rfm/orchestration/harness.py",
  "rfm/orchestration/tools.py",

  "oba/__init__.py",
  "oba/schemas.py",
  "oba/sim/__init__.py",
  "oba/sim/state.py",
  "oba/sim/tasks.py",
  "oba/sim/expert.py",
  "oba/sim/plant.py",
  "oba/sim/success.py",
  "oba/sim/rollout.py",

  "qlc/__init__.py",
  "qlc/schemas.py",
  "qlc/terrain/__init__.py",
  "qlc/terrain/geometry.py",
  "qlc/terrain/heightmap.py",
  "qlc/terrain/features.py",
  "qlc/cost/__init__.py",
  "qlc/cost/base.py",
  "qlc/cost/analytic.py",
  "qlc/cost/registry.py",
  "qlc/plan/__init__.py",
  "qlc/plan/astar.py",
  "qlc/plan/dwa.py",
  "qlc/sim/__init__.py",
  "qlc/sim/physics.py",
  "qlc/sim/world.py",
  "qlc/sim/expert.py",
  "qlc/eval/__init__.py",
  "qlc/eval/benchmark.py",
  "qlc/eval/oracle.py"
];

/* The glue. It imports the vendored modules and exposes one function per
   thing the page can ask for; it does not reimplement any of them.

   Two stubs, both at the import boundary and both the same trick the nav demos
   play with rclpy:

   * `rich`, because qlc.eval.benchmark imports Console and Table for its
     progress output. run_episode never calls either.
   * nothing else. There is no third.

   The modules print an author signature on import, twenty lines of it across
   the three trees, so stdout is swallowed for the duration of the import and
   the count is reported instead. */
var GLUE = [
  "import base64, contextlib, io, json, sys, types",
  "import numpy as np",
  "",
  "sys.path.insert(0, '/vendor')",
  "",
  "def _stub_rich():",
  "    rich = types.ModuleType('rich')",
  "    con = types.ModuleType('rich.console')",
  "    tab = types.ModuleType('rich.table')",
  "    class Console:",
  "        def print(self, *a, **k): pass",
  "    class Table:",
  "        def __init__(self, *a, **k): pass",
  "        def add_column(self, *a, **k): pass",
  "        def add_row(self, *a, **k): pass",
  "    con.Console = Console",
  "    tab.Table = Table",
  "    rich.console = con",
  "    rich.table = tab",
  "    sys.modules.update({'rich': rich, 'rich.console': con, 'rich.table': tab})",
  "",
  "_stub_rich()",
  "_quiet = io.StringIO()",
  "with contextlib.redirect_stdout(_quiet):",
  "    import qlc, oba, rfm",
  "    from qlc.schemas import BenchConfig, CostModelKind, MATERIAL_TRUTH, Material",
  "    from qlc.terrain.heightmap import course_suite",
  "    from qlc.cost.registry import build_cost_model, build_stacks",
  "    from qlc.eval import benchmark as qbench",
  "    from qlc.eval.oracle import OracleCost",
  "    from qlc.sim.world import QuadrupedWorld",
  "    import qlc.sim.world as qworld",
  "    from oba.schemas import AssemblyTask",
  "    from oba.sim.tasks import CONNECTOR_INSERTION, WIRE_ROUTING",
  "    from oba.sim.plant import AnalyticPlant, IS_ANALYTIC",
  "    from oba.sim.expert import ScriptedInsertionExpert, ScriptedWireRoutingExpert",
  "    from oba.sim.success import detector_for",
  "    from oba.sim.rollout import rollout",
  "    from rfm.schemas import (ACTION_DIM, ACTION_LAYOUT, Embodiment, MetricSnapshot,",
  "                             TrainingStage, UnifiedActionSpaceConfig)",
  "    from rfm.data.action_space import describe_coverage, embodiment_mask",
  "    from rfm.eval.ablations import FAILURE_MODES",
  "    from rfm.eval.metrics import check_alarms",
  "",
  "SIGNATURE_LINES = len([l for l in _quiet.getvalue().splitlines() if l.strip()])",
  "",
  "",
  "# ---------------------------------------------------------------- qlc",
  "",
  "# The two constants the MuJoCo cross-check moved. Reconstructing the",
  "# surrogate as first written means putting both back, and nothing else:",
  "# FALL_RATE is read as a module global inside QuadrupedWorld._lost_footing,",
  "# and the ice drag is read out of MATERIAL_TRUTH when the truth field is",
  "# built, which happens once per course in prepare_course.",
  "ICE_DRAG_MEASURED = MATERIAL_TRUTH[Material.ICE].drag",
  "ICE_DRAG_AS_FIRST_WRITTEN = 0.95",
  "FALL_RATE_AS_FIRST_WRITTEN = 0.5",
  "",
  "",
  "def _set_physics(mode):",
  "    drag = ICE_DRAG_AS_FIRST_WRITTEN if mode == 'first' else ICE_DRAG_MEASURED",
  "    qworld.FALL_RATE = FALL_RATE_AS_FIRST_WRITTEN if mode == 'first' else 0.0",
  "    MATERIAL_TRUTH[Material.ICE] = MATERIAL_TRUTH[Material.ICE].model_copy(",
  "        update={'drag': drag})",
  "    return {'fall_rate': qworld.FALL_RATE, 'ice_drag': MATERIAL_TRUTH[Material.ICE].drag,",
  "            'ice_traction': MATERIAL_TRUTH[Material.ICE].traction}",
  "",
  "",
  "def _recording_world(sink):",
  "    \"\"\"A QuadrupedWorld whose per-tick pose is kept.",
  "",
  "    run_episode builds its own world, so this is installed over the name",
  "    benchmark.py binds. The instance is the real class; only `step` is",
  "    wrapped, and it is wrapped after the fact rather than subclassed so that",
  "    the dataclass's own field initialisation is untouched. `trace` on the",
  "    world records cells, not ticks, which is the right thing for path length",
  "    and the wrong thing for an animation.",
  "    \"\"\"",
  "    def factory(**kw):",
  "        w = QuadrupedWorld(**kw)",
  "        inner = w.step",
  "        poses = []",
  "        sink.append(poses)",
  "        poses.append((w.state.x, w.state.y, w.state.yaw))",
  "        def step(cmd):",
  "            out = inner(cmd)",
  "            poses.append((w.state.x, w.state.y, w.state.yaw))",
  "            return out",
  "        w.step = step",
  "        return w",
  "    return factory",
  "",
  "",
  "def qlc_course(index, physics):",
  "    \"\"\"Prepare one course from the benchmark's own suite.\"\"\"",
  "    global _COURSE, _BENCH",
  "    applied = _set_physics(physics)",
  "    cfg = course_suite(5, seed=1234)[index]",
  "    _BENCH = BenchConfig(stacks=[CostModelKind.NAV2_INFLATION, CostModelKind.REACTIVE],",
  "                         learned_checkpoint=None, irl_checkpoint=None)",
  "    _COURSE = qbench.prepare_course(cfg, _BENCH)",
  "    t = _COURSE.terrain",
  "    rows, cols = t.shape",
  "    ground = np.asarray(t.ground, dtype=np.float32)",
  "    lo, hi = float(np.percentile(ground, 2)), float(np.percentile(ground, 98))",
  "    shade = np.clip((ground - lo) / max(hi - lo, 1e-6), 0.0, 1.0)",
  "    return json.dumps({",
  "        'name': cfg.name, 'layout': cfg.layout, 'seed': cfg.seed,",
  "        'rows': rows, 'cols': cols, 'resolution': t.resolution,",
  "        'start': list(t.start_cell), 'goal': list(t.goal_cell),",
  "        'optimal_length': (None if not np.isfinite(_COURSE.optimal_length)",
  "                           else round(_COURSE.optimal_length, 2)),",
  "        'physics': applied,",
  "        # Read out of MATERIAL_TRUTH rather than restated here, so the legend",
  "        # moves when the physics switch does and cannot drift from the table",
  "        # the simulator actually charges against.",
  "        'materials': [{'name': m.name.lower(), 'value': int(m),",
  "                       'drag': MATERIAL_TRUTH[m].drag,",
  "                       'traction': MATERIAL_TRUTH[m].traction,",
  "                       'mire_rate': MATERIAL_TRUTH[m].mire_rate,",
  "                       'share': round(float((t.material == int(m)).mean()), 4)}",
  "                      for m in Material],",
  "        'material': base64.b64encode(np.asarray(t.material, dtype=np.uint8).tobytes()).decode(),",
  "        'shade': base64.b64encode((shade * 255).astype(np.uint8).tobytes()).decode(),",
  "    })",
  "",
  "",
  "def qlc_episode(stack):",
  "    \"\"\"Run one stack on the prepared course, through benchmark.run_episode.\"\"\"",
  "    if stack == 'oracle':",
  "        spec = build_stacks(BenchConfig(stacks=[CostModelKind.LEARNED],",
  "                                        learned_checkpoint=None))[0]",
  "        model = OracleCost(_COURSE.terrain, _BENCH.robot, _COURSE.truth)",
  "        kind = CostModelKind.LEARNED",
  "    else:",
  "        kind = CostModelKind(stack)",
  "        spec = [s for s in build_stacks(_BENCH) if s.kind is kind][0]",
  "        model = build_cost_model(spec, _BENCH)",
  "    seed = qbench._episode_seed(_BENCH.seed, 0, kind)",
  "",
  "    cost = model.cost_grid(_COURSE.features)",
  "    plan = qbench._plan_global(cost, spec, _COURSE.terrain.start_cell,",
  "                               _COURSE.terrain.goal_cell, _COURSE.terrain.resolution)",
  "",
  "    sink = []",
  "    real = qbench.QuadrupedWorld",
  "    qbench.QuadrupedWorld = _recording_world(sink)",
  "    try:",
  "        result = qbench.run_episode(_COURSE, spec, model, _BENCH, seed=seed)",
  "    finally:",
  "        qbench.QuadrupedWorld = real",
  "    poses = sink[0] if sink else []",
  "",
  "    finite = np.isfinite(cost)",
  "    ceiling = float(np.percentile(cost[finite], 99)) if finite.any() else 1.0",
  "    field = np.clip(np.where(finite, cost, ceiling) / max(ceiling, 1e-6), 0.0, 1.0)",
  "    return json.dumps({",
  "        'stack': stack,",
  "        'outcome': result.outcome.value,",
  "        'steps': result.steps,",
  "        'sim_time': round(result.sim_time, 1),",
  "        'path_length': round(result.path_length, 1),",
  "        'optimal_length': (None if not np.isfinite(result.optimal_length)",
  "                           else round(result.optimal_length, 1)),",
  "        'min_clearance': round(result.min_clearance, 2),",
  "        'plan_time_ms': round(result.plan_time_ms, 1),",
  "        'control_time_ms': round(result.control_time_ms, 2),",
  "        'replans': result.replans,",
  "        'dt': spec.controller.dt,",
  "        'plan': [[round(float(p[0]), 3), round(float(p[1]), 3)] for p in plan],",
  "        'poses': [[round(p[0], 3), round(p[1], 3), round(p[2], 3)] for p in poses],",
  "        'cost': base64.b64encode((field * 255).astype(np.uint8).tobytes()).decode(),",
  "    })",
  "",
  "",
  "# ---------------------------------------------------------------- oba",
  "",
  "def _oba_pieces(task):",
  "    if task == 'connector_insertion':",
  "        return (CONNECTOR_INSERTION, ScriptedInsertionExpert,",
  "                AssemblyTask.CONNECTOR_INSERTION)",
  "    return WIRE_ROUTING, ScriptedWireRoutingExpert, AssemblyTask.WIRE_ROUTING",
  "",
  "",
  "class _Recorder:",
  "    \"\"\"Keeps one frame per step, from the two places a frame exists.",
  "",
  "    The plant is subclassed rather than wrapped so that `isinstance` checks",
  "    and the IS_ANALYTIC contract still see an AnalyticPlant. The detector is",
  "    a Protocol as far as rollout is concerned, so a proxy is enough there.",
  "    \"\"\"",
  "",
  "    def __init__(self, spec):",
  "        self.frames = []",
  "        recorder = self",
  "",
  "        class RecordingPlant(AnalyticPlant):",
  "            def reset(self, jitter_m=0.01):",
  "                state = super().reset(jitter_m)",
  "                recorder.frames = []",
  "                recorder._push(state, None)",
  "                return state",
  "",
  "            def step(self, command):",
  "                state = super().step(command)",
  "                recorder._push(state, command)",
  "                return state",
  "",
  "        class RecordingDetector:",
  "            def __init__(self, inner):",
  "                self.inner = inner",
  "",
  "            def reset(self):",
  "                self.inner.reset()",
  "",
  "            def __call__(self, state):",
  "                verdict = self.inner(state)",
  "                if recorder.frames:",
  "                    recorder.frames[-1]['progress'] = round(verdict.progress, 3)",
  "                    recorder.frames[-1]['reason'] = verdict.reason.value",
  "                    recorder.frames[-1]['detail'] = {k: round(v, 3)",
  "                                                     for k, v in verdict.detail.items()}",
  "                return verdict",
  "",
  "        self.plant = RecordingPlant(spec)",
  "        self._detector_class = RecordingDetector",
  "",
  "    def _push(self, state, command):",
  "        self.frames.append({",
  "            'step': state.step,",
  "            't': round(state.sim_time_s, 3),",
  "            'phase': None if command is None else command.phase,",
  "            'right': [round(v, 5) for v in state.right.ee_position_m],",
  "            'left': [round(v, 5) for v in state.left.ee_position_m],",
  "            'grasp': [state.right.grasp.value, state.left.grasp.value],",
  "            'width': [round(state.right.gripper_width_m, 4),",
  "                      round(state.left.gripper_width_m, 4)],",
  "            'force': [round(state.right.contact.force_magnitude_n, 2),",
  "                      round(state.left.contact.force_magnitude_n, 2)],",
  "            'bodies': {n: [round(v, 5) for v in o.position_m]",
  "                       for n, o in state.objects.items()},",
  "            'progress': 0.0,",
  "            'reason': 'in_progress',",
  "        })",
  "",
  "",
  "def oba_run(task, seed, noise_m):",
  "    spec, Expert, kind = _oba_pieces(task)",
  "    rec = _Recorder(spec)",
  "    expert = Expert(spec, noise_m=noise_m, seed=seed)",
  "    detector = rec._detector_class(detector_for(kind, spec))",
  "    result = rollout(rec.plant, expert, detector, kind, max_steps=900, seed=seed)",
  "    thresholds = {",
  "        'is_analytic': bool(IS_ANALYTIC),",
  "        'task': kind.value,",
  "    }",
  "    if task == 'connector_insertion':",
  "        thresholds.update({",
  "            'seated_depth_m': spec.seated_depth_m,",
  "            'lateral_tol_m': spec.lateral_tol_m,",
  "            'min_reaction_force_n': spec.min_reaction_force_n,",
  "            'nominal_seating_force_n': spec.nominal_seating_force_n,",
  "            'backoff_force_n': spec.backoff_force_n,",
  "            'max_force_n': spec.max_force_n,",
  "            'hold_steps': spec.hold_steps,",
  "            'phases': ['approach', 'descend', 'grasp', 'lift', 'align', 'insert',",
  "                       'release', 'done'],",
  "            'socket': spec.socket_body,",
  "            'connector': spec.connector_body,",
  "        })",
  "    else:",
  "        thresholds.update({",
  "            'n_wire_links': spec.n_wire_links,",
  "            'clips': list(spec.clip_bodies),",
  "            'settle_steps': spec.settle_steps,",
  "            'tension_min_n': spec.tension_min_n,",
  "            'require_ordered': bool(spec.require_ordered),",
  "            'phases': ['approach', 'grasp_both', 'tension', 'seat_clip', 'regrasp',",
  "                       'release', 'done'],",
  "            'prefix': spec.wire_body_prefix,",
  "        })",
  "    return json.dumps({",
  "        'success': bool(result.success),",
  "        'reason': result.reason.value,",
  "        'progress': round(result.progress, 3),",
  "        'steps': result.steps,",
  "        'wall_ms': round(result.wall_clock_s * 1e3, 1),",
  "        'detail': result.detail,",
  "        'spec': thresholds,",
  "        'frames': rec.frames,",
  "    })",
  "",
  "",
  "# ---------------------------------------------------------------- rfm",
  "",
  "def rfm_layout():",
  "    cfg = UnifiedActionSpaceConfig()",
  "    masks = {}",
  "    for emb in Embodiment:",
  "        try:",
  "            masks[emb.value] = [bool(b) for b in embodiment_mask(emb, cfg)]",
  "        except KeyError as exc:",
  "            masks[emb.value] = str(exc)",
  "    return json.dumps({",
  "        'dim': ACTION_DIM,",
  "        'slices': [{'name': s.name, 'start': s.start, 'stop': s.stop, 'unit': s.unit,",
  "                    'description': s.description} for s in ACTION_LAYOUT],",
  "        'masks': masks,",
  "        'dof_override': {k.value: v for k, v in cfg.dof_override.items()},",
  "        'coverage': describe_coverage(cfg),",
  "        'modes': [{'code': f.code, 'name': f.name, 'metric': f.metric,",
  "                   'threshold': f.threshold, 'direction': f.direction,",
  "                   'consequence': f.consequence, 'mitigation': f.mitigation}",
  "                  for f in FAILURE_MODES],",
  "    })",
  "",
  "",
  "def rfm_alarms(payload):",
  "    \"\"\"Score one metric snapshot against the watchlist.\"\"\"",
  "    values = json.loads(payload)",
  "    snapshot = MetricSnapshot(",
  "        global_step=0,",
  "        stage=TrainingStage.STAGE4_CALIBRATION,",
  "        dynamics_copy_margin=values['dynamics_copy_margin'],",
  "        flow_sample_variance=values['flow_sample_variance'],",
  "        reasoning_counterfactual_accuracy=values['reasoning_counterfactual_accuracy'],",
  "        competence_regret_s=values['competence_regret_s'],",
  "        vl_probe_score=values['vl_probe_score'],",
  "        holdout_masked_action_mse={'right_arm_joint_vel': values['masked_mse']},",
  "        p99_latency_ms={'act': values['p99_latency_ms']},",
  "    )",
  "    tripped = check_alarms(snapshot, baseline_vl_probe=values['baseline_vl_probe'])",
  "    return json.dumps([{'code': fm.code, 'value': round(float(v), 4)}",
  "                       for fm, v in tripped])",
  ""
].join("\n");

var py = null;

function say(type, payload) { self.postMessage(Object.assign({ type: type }, payload)); }
function note(msg, cls) { say("log", { msg: msg, cls: cls || "" }); }

async function boot() {
  note("loading pyodide runtime for the vendored demos…");
  py = await loadPyodide({ indexURL: "https://cdn.jsdelivr.net/pyodide/v0.26.2/full/" });
  note("pyodide " + py.version, "ok");
  note("loading numpy, scipy, pydantic…");
  await py.loadPackage(["numpy", "scipy", "pydantic"]);
  note("numpy, scipy, pydantic ready", "ok");

  var bytes = 0;
  for (var i = 0; i < FILES.length; i++) {
    var path = FILES[i];
    var res = await fetch(VENDOR_BASE + path, { cache: "no-store" });
    if (!res.ok) throw new Error("vendor/" + path + " -> HTTP " + res.status);
    var text = await res.text();
    bytes += text.length;
    var dir = "/vendor/" + path.slice(0, path.lastIndexOf("/"));
    py.FS.mkdirTree(dir);
    py.FS.writeFile("/vendor/" + path, text);
  }
  note(FILES.length + " vendored modules laid down, " + bytes.toLocaleString() +
       " bytes  (copies, not a live fetch — see vendor/*/PROVENANCE.md)", "ok");

  py.runPython(GLUE);
  note("rich stubbed at the import boundary; qlc, oba and rfm imported  (" +
       py.globals.get("SIGNATURE_LINES") + " author-signature lines swallowed on the way in)",
       "ok");
  say("ready", {});
}

/* One call per message. Everything the glue returns is a JSON string, so the
   only thing crossing back is a string and a parse on the far side. */
function call(fn, args) {
  py.globals.set("__args", args === undefined ? null : args);
  var expr = args === undefined
    ? fn + "()"
    : fn + "(*(__args.to_py() if hasattr(__args, 'to_py') else __args))";
  return JSON.parse(py.runPython(expr));
}

self.onmessage = async function (ev) {
  var msg = ev.data || {};
  try {
    if (msg.cmd === "boot") { await boot(); return; }
    if (!py) throw new Error("runtime not booted");

    if (msg.cmd === "qlc") {
      var course = call("qlc_course", [msg.index, msg.physics]);
      say("qlc-course", { course: course, token: msg.token });
      for (var i = 0; i < msg.stacks.length; i++) {
        var t0 = Date.now();
        var ep = call("qlc_episode", [msg.stacks[i]]);
        ep.wall_ms = Date.now() - t0;
        say("qlc-episode", { episode: ep, token: msg.token });
      }
      say("qlc-done", { token: msg.token });
      return;
    }

    if (msg.cmd === "oba") {
      say("oba-run", { run: call("oba_run", [msg.task, msg.seed, msg.noise]), token: msg.token });
      return;
    }

    if (msg.cmd === "rfm-layout") {
      say("rfm-layout", { layout: call("rfm_layout") });
      return;
    }

    if (msg.cmd === "rfm-alarms") {
      say("rfm-alarms", { tripped: call("rfm_alarms", [JSON.stringify(msg.values)]) });
      return;
    }
  } catch (e) {
    var text = String(e && e.message ? e.message : e).split("\n").slice(-4).join(" | ");
    note(text, "err");
    say("failed", { cmd: msg.cmd, token: msg.token, msg: text });
  }
};
