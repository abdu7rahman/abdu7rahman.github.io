/* The controller race and the chase's slow controller, off the main thread.
 *
 * MPPI draws 1000 samples a tick and one tick costs ~570 ms in Pyodide. That
 * is a single indivisible Python call, so no per-frame budget on the main
 * thread can help: the tab freezes for half a second at a time and every other
 * demo on the page stops with it. Measured before this existed, racing all
 * five: median frame gap 591 ms, worst 758 ms, and a click took 32 seconds to
 * land.
 *
 * So anything that slow gets its own Pyodide in its own worker. The cost is a
 * second runtime, which is why only the slow things come here -- the planners,
 * the arm, and the four fast chase controllers are milliseconds per call and
 * belong on the main thread where they can draw directly.
 *
 * The main thread sends the bootstrap and the module sources it has already
 * fetched, so nothing is downloaded from GitHub twice.
 *
 * The same worker also runs the chase when MPPI is the selected controller,
 * for the same reason. The other four chase controllers stay on the main
 * thread: they are sub-millisecond, and a round trip per tick would add
 * latency to a cursor-following demo for nothing.
 */

/* global importScripts, loadPyodide */

let pyodide = null;

async function boot(msg) {
  importScripts("https://cdn.jsdelivr.net/pyodide/v0.26.2/full/pyodide.js");
  pyodide = await loadPyodide({ indexURL: "https://cdn.jsdelivr.net/pyodide/v0.26.2/full/" });
  await pyodide.loadPackage("numpy");
  pyodide.runPython(msg.bootstrap);
  for (const [name, src] of Object.entries(msg.sources)) {
    pyodide.globals.set("__src", src);
    pyodide.globals.set("__name_", name);
    pyodide.runPython("load_module(__name_, __src)");
  }
  postMessage({ type: "ready" });
}

function init(msg) {
  pyodide.globals.set("__flat", msg.flat);
  pyodide.globals.set("__act", msg.active);
  const meta = pyodide.runPython(
    "race_init(list(__flat), " + msg.h + ", " + msg.w + ", " + msg.res + ", " +
    msg.sr + ", " + msg.sc + ", " + msg.gr + ", " + msg.gc + ", list(__act))"
  );
  const out = meta ? meta.toJs() : [];
  if (meta && meta.destroy) meta.destroy();
  postMessage({ type: "init", meta: out });
}

function step() {
  // The budget keeps a reply flowing even mid-MPPI-tick, so the main thread
  // gets a frame to draw rather than waiting on a whole simulated interval.
  const rows = pyodide.runPython("race_step(60.0)");
  const out = rows ? rows.toJs() : [];
  if (rows && rows.destroy) rows.destroy();
  postMessage({ type: "step", rows: out, done: !!pyodide.runPython("race_done()") });
}

// ── the chase, when its controller is too slow for the main thread ──
// The whole stack lives here in that case: the same chase_init / chase_plan /
// chase_step_any the main thread would have called, so there is one Python
// implementation and not two.
function chaseInit(msg) {
  pyodide.globals.set("__occ", msg.occ);
  const meta = pyodide.runPython(
    "chase_init('astar_planner','" + msg.pcls + "','" + msg.cmod + "','" + msg.ccls +
    "','" + msg.kind + "', list(__occ), " + msg.h + ", " + msg.w + ", " + msg.res +
    ", " + msg.inflate + ")");
  const out = meta ? meta.toJs() : [];
  if (meta && meta.destroy) meta.destroy();
  postMessage({ type: "chase_init", meta: out });
}

function chaseRemap(msg) {
  pyodide.globals.set("__occ", msg.occ);
  const c = pyodide.runPython("chase_remap(list(__occ))");
  if (c && c.destroy) c.destroy();
  postMessage({ type: "chase_remap" });
}

function chasePath(msg) {
  // The main thread planned it; this controller just adopts it, the way it
  // would adopt a /plan message.
  pyodide.globals.set("__p", msg.pts.flat());
  const n = pyodide.runPython("chase_adopt_path(list(__p))");
  postMessage({ type: "chase_path", n: n });
}

function chaseTick(msg) {
  // One controller tick. Nothing else happens here -- planning stayed on the
  // main thread, so this message is only ever as slow as the controller is.
  const t0 = performance.now();
  const r = pyodide.runPython(
    "chase_step_any(" + msg.x + "," + msg.y + "," + msg.yaw + "," + msg.v + "," + msg.w + ")");
  const out = r ? r.toJs() : [];
  if (r && r.destroy) r.destroy();
  postMessage({ type: "chase_tick", out: out,
                ms: performance.now() - t0, seq: msg.seq });
}

onmessage = async function (e) {
  const msg = e.data;
  try {
    if (msg.type === "boot") await boot(msg);
    else if (msg.type === "init") init(msg);
    else if (msg.type === "step") step();
    else if (msg.type === "chase_init") chaseInit(msg);
    else if (msg.type === "chase_remap") chaseRemap(msg);
    else if (msg.type === "chase_path") chasePath(msg);
    else if (msg.type === "chase_tick") chaseTick(msg);
  } catch (err) {
    postMessage({ type: "error", error: String(err && err.message ? err.message : err) });
  }
};
