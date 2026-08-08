/* The controller race, off the main thread.
 *
 * MPPI draws 1000 samples a tick and one tick costs ~570 ms in Pyodide. That
 * is a single indivisible Python call, so no per-frame budget on the main
 * thread can help: the tab freezes for half a second at a time and every other
 * demo on the page stops with it. Measured before this existed, racing all
 * five: median frame gap 591 ms, worst 758 ms, and a click took 32 seconds to
 * land.
 *
 * So the race gets its own Pyodide in its own worker. The cost is a second
 * runtime, which is why only this demo does it -- the planners, the chase and
 * the arm are all milliseconds per call and belong on the main thread where
 * they can draw directly.
 *
 * The main thread sends the bootstrap and the module sources it has already
 * fetched, so nothing is downloaded from GitHub twice.
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

onmessage = async function (e) {
  const msg = e.data;
  try {
    if (msg.type === "boot") await boot(msg);
    else if (msg.type === "init") init(msg);
    else if (msg.type === "step") step();
  } catch (err) {
    postMessage({ type: "error", error: String(err && err.message ? err.message : err) });
  }
};
