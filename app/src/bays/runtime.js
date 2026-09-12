/* The document site's demos, running, inside the building.
 *
 * demo.js and lab.js are the document site's -- 3,547 and 1,174 lines of
 * vanilla canvas-2D that download real Python from two of the author's repos
 * and execute it under Pyodide. They are the strongest thing on this site and
 * they are not rewritten here. This file mounts them.
 *
 * Why an iframe and not a hidden div in this document. Three reasons, in the
 * order they were discovered:
 *
 *   1. Teardown. demo.js is one IIFE with requestAnimationFrame loops, window
 *      listeners, a Worker and a Pyodide heap inside it, and it exposes no
 *      handle to stop any of that. Removing an iframe ends all of it in one
 *      call. There is no other way to give back what a Pyodide costs.
 *   2. Colour. demo.js builds its canvas palette by reading --paper, --ink,
 *      --rule, --signal and --accent off document.documentElement (its tok()
 *      helper), and demo.css remaps exactly those five onto the dark landing
 *      palette. Inside its own document that remap still happens and the
 *      plates come out painted as authored -- #141414 ground, #fcf9f3 type,
 *      #ff8a5c preempt. In this document those names belong to the building's
 *      chrome and the two would have had to be reconciled by hand.
 *   3. Input. The demos bind pointermove on window and touchmove with
 *      preventDefault. Sharing a document with a fixed WebGL canvas that also
 *      wants the pointer is a fight; a browsing context is a wall.
 *
 * The document written into that iframe is demo.html itself, fetched, parsed
 * and stripped -- not a copy of its markup in a template string. A copy is a
 * second thing to drift, which is the failure this repository has hit more
 * than any other. The only edits are removals: the sections this bundle does
 * not serve, and the five scripts that are the document site's chrome rather
 * than its demos (analytics and the visit counter among them, which must not
 * fire from in here).
 */

/* Where the vanilla site is, derived rather than written down.
 *
 * demo.html, demo.js, lab.js, race-worker.js, lab-worker.js and assets/ are
 * the repository root's. The app is built into <root>/lab and served from
 * /lab/, so the site is one path segment above Vite's base. Expressed as a
 * strip of the last segment so it is still correct on the day the lab becomes
 * the root: BASE_URL "/" has no segment to strip and the answer stays "/".
 * A relative base ("./") has no origin-absolute answer, so that case falls
 * back to one level up from wherever the document is. */
const SITE = (() => {
  const b = import.meta.env.BASE_URL || "/";
  const up = b.startsWith("/") ? b.replace(/[^/]+\/$/, "") : "../";
  return new URL(up || "/", document.baseURI).href;
})();

/* Which script serves which cell, and what each cell's canvas and section are
 * called in demo.html.
 *
 * The grouping is not a choice. demo.js loads one Pyodide and five demos
 * share it; splitting them would mean five interpreters and five copies of
 * numpy, which is worse than anything laziness could buy back. lab.js's two
 * share a Worker for the same reason. So a bundle is the unit that gets
 * mounted and torn down, and inside a bundle the demos' own sleep gate --
 * demo.js's asleep(), an IntersectionObserver on the section element with 200
 * px of margin -- decides which of them is actually spending time.
 *
 * `section` is the id of the element that gate watches, and it is the one
 * place the two vocabularies disagree: the search demo is stop `space` in
 * lib/plan.js and section `#plan` in demo.html.
 */
export const BUNDLES = {
  nav: {
    script: "demo.js",
    /* demo.js calls loadPyodide() on the main thread, so the page has to
       carry the runtime script. lab.js does not: lab-worker.js importScripts
       its own copy inside the Worker. */
    pyodide: "https://cdn.jsdelivr.net/pyodide/v0.26.2/full/pyodide.js",
    /* Pressed for the reader when the cell is the one they are standing at.
       Two of the five have a button and three do not: the chase, the reach
       and the replanner take a cursor rather than a start, and they draw
       their field, their camera plate and their arm without one.

       A rig you walk up to should be running -- that is what a test cell is --
       and this bundle has already paid for its runtime by the time the button
       exists, so pressing it costs the reader nothing further. */
    autorun: "arrive",
    cells: {
      space:   { section: "plan",    canvas: "map",             run: "run" },
      drive:   { section: "drive",   canvas: "chase",           run: null },
      race:    { section: "race",    canvas: "race-canvas",     run: "race-run" },
      foresee: { section: "foresee", canvas: "foresee-canvas",  run: null }
    }
  },
  vendored: {
    script: "lab.js",
    pyodide: null,
    /* Not on arrival. lab-worker.js's own log says why: the quadruped stack
       needs scipy, which is a 45 MB wheel, and the document site gates that
       behind a press rather than spending it on a reader who walked past.
       Entering the cell is that press -- an explicit act, not a distance --
       and the console inside the section narrates the download while it
       happens. Until then these two monitors carry Rig.jsx's placeholder,
       because their canvases have nothing on them to show. */
    autorun: "enter",
    cells: {
      terrain:  { section: "terrain",  canvas: "qlc-canvas", run: "qlc-run" },
      assemble: { section: "assemble", canvas: "oba-canvas", run: "oba-run" }
    }
  }
};

/* stop id -> bundle id, built once so the lookup is not a scan. */
export const BUNDLE_OF = {};
for (const [id, b] of Object.entries(BUNDLES)) {
  for (const cell of Object.keys(b.cells)) BUNDLE_OF[cell] = id;
}

/* demo.html, fetched once and parsed once. Both bundles cut their document
   out of the same parse. */
let sourceDoc = null;
function loadSource() {
  if (sourceDoc) return sourceDoc;
  sourceDoc = fetch(new URL("demo.html", SITE).href)
    .then(r => r.ok ? r.text() : Promise.reject(new Error("demo.html " + r.status)))
    .then(t => new DOMParser().parseFromString(t, "text/html"));
  return sourceDoc;
}

/* What the log line looks like when a runtime has finished standing up.
   demo.js writes "ready. draw a map and hit run." from boot() once every
   module has loaded; lab-worker.js's own note() reaches the page through
   lab.js's log(). Matched on rather than timed, because the whole point of
   the measurement is not to guess. */
const READY = { nav: /^\s*>\s*ready\./m, vendored: /^\s*>\s*vendored runtime ready/m };

/* demo.js's own rootMargin, in CSS pixels. */
const SLEEP_MARGIN = 200;

class Bundle {
  constructor(id) {
    this.id = id;
    this.spec = BUNDLES[id];
    this.frame = null;
    this.doc = null;
    this.refs = 0;
    this.marks = { mounted: 0, scripts: 0, ready: 0 };
    this.canvases = {};     // stop id -> HTMLCanvasElement in the iframe
    this.sections = {};     // stop id -> the element asleep() watches
    this.awake = null;      // stop id whose section is under the iframe viewport
    this.started = new Set();
  }

  /* The iframe sits behind the WebGL canvas rather than off screen, and that
     is not cosmetic. Chrome does not run requestAnimationFrame in a frame it
     is not rendering, and every one of these demos steps its simulation in a
     rAF callback -- parked outside the viewport the canvases freeze and the
     monitors show a still. Behind an opaque canvas at z-index 0 the frame is
     rendered, composited and invisible, which is what a monitor showing a
     running process from five metres away needs. */
  host() {
    let el = document.getElementById("bay-host");
    if (el) return el;
    el = document.createElement("div");
    el.id = "bay-host";
    el.setAttribute("aria-hidden", "true");
    el.style.cssText =
      "position:fixed;inset:0;z-index:-1;display:flex;align-items:center;" +
      "justify-content:center;pointer-events:none";
    document.body.appendChild(el);
    return el;
  }

  async mount(width, height) {
    if (this.frame) return this;
    const t0 = performance.now();
    const src = await loadSource();

    const f = document.createElement("iframe");
    f.title = this.id === "nav" ? "Live planners and controllers"
                                : "Live quadruped cost models and bimanual assembly";
    f.setAttribute("scrolling", "no");
    /* One width for both states. fitCanvas() reads getBoundingClientRect()
       once, at script evaluation, and deliberately never reacts to a resize --
       the world, its costmap and any in-flight plan are built from that
       number. So the frame is laid out at its final width before demo.js is
       injected and never resized afterwards; only its height changes, and a
       height change moves which section the sleep gate can see, which is the
       whole control surface this file has. */
    f.style.cssText =
      `width:${width}px;height:${height}px;border:0;opacity:0;` +
      "position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);" +
      "background:#0b0b0c;transition:opacity 140ms linear";
    this.host().appendChild(f);
    this.frame = f;

    const d = f.contentDocument;
    d.open();
    d.write("<!doctype html>" + this.markup(src));
    d.close();
    this.doc = d;
    this.marks.mounted = performance.now() - t0;

    await this.inject();
    this.marks.scripts = performance.now() - t0;

    for (const [stop, c] of Object.entries(this.spec.cells)) {
      this.canvases[stop] = d.getElementById(c.canvas);
      this.sections[stop] = d.getElementById(c.section);
    }
    this.watchReady(t0);
    return this;
  }

  /* The document, cut down. Everything here is a removal or an addition of a
     <base>; no element the demos read is edited, moved or renamed. */
  markup(src) {
    const d = src.cloneNode(true);

    /* Written into about:blank, so the frame inherits this app's base URL --
       /lab/ -- and every relative reference in demo.html would resolve one
       directory too deep: style.css, demo.css, the assets/ur12e.json the arm
       fetches at runtime, and new Worker("race-worker.js"). One <base> fixes
       all four at once, including the two that are strings inside demo.js and
       could not have been rewritten here. */
    const base = d.createElement("base");
    base.href = SITE;
    d.head.insertBefore(base, d.head.firstChild);

    /* Scripts are injected in order afterwards so their load times can be
       measured, so every one in the source goes -- including the site chrome
       that has no business running in here. analytics.js and visits.js would
       beacon a page view for a reader who has not left the building. */
    d.querySelectorAll("script").forEach(s => s.remove());

    /* Sections this bundle does not serve. lab.js guards every one of its
       three demos with `if (!cv) return { init: noop }`, so dropping #space
       (the action-space reference, which is not one of them) is safe by
       its own contract. demo.js guards four of its five the same way, and
       that is load-bearing now rather than spare: the arm demo's section
       went out of this set when the reach cell was retired, and its guard
       was the only thing between that and a throw on every visit. It did
       not work until demo.js's fitCanvas was taught to return null for a
       null element instead of dereferencing it on the way to the check. */
    const keep = new Set(Object.values(this.spec.cells).map(c => c.section));
    d.querySelectorAll("main.runner > [id]").forEach(el => {
      if (!keep.has(el.id)) el.remove();
    });
    /* The page header, its table of contents and the footer: navigation for a
       document, meaningless in a cell. The console stays -- it is the log
       every module's byte count and origin branch is written to, and that log
       is the evidence for the claim this whole port exists to keep. */
    d.querySelectorAll("main.runner > .runner__head, main.runner > .foot").forEach(el => el.remove());
    d.body.className = "runner-page";

    const own = d.createElement("style");
    own.textContent = FRAME_CSS;
    d.head.appendChild(own);
    return d.documentElement.outerHTML;
  }

  /* Sequential, awaited, and in the source's own order. Pyodide's loader has
     to be evaluated before demo.js calls loadPyodide, and doing it by hand
     instead of leaving two deferred script tags in the markup is what makes
     the split between "runtime arrived" and "runtime stood up" measurable. */
  async inject() {
    const urls = [this.spec.pyodide, new URL(this.spec.script, SITE).href].filter(Boolean);
    for (const url of urls) {
      await new Promise((res, rej) => {
        const s = this.doc.createElement("script");
        s.src = url;
        s.onload = res;
        s.onerror = () => rej(new Error("script " + url));
        this.doc.body.appendChild(s);
      }).catch(e => { this.error = e.message; });
    }
  }

  /* When the runtime is up, taken off the console rather than assumed.
     demo.js's log() is the only thing in either script that knows, and it
     writes to one <pre>. A MutationObserver on that node costs nothing and
     is exact to the frame the line lands in. */
  watchReady(t0) {
    const pre = this.doc.getElementById("log");
    if (!pre) return;
    const done = () => {
      if (READY[this.id].test(pre.textContent)) {
        this.marks.ready = performance.now() - t0;
        obs.disconnect();
      }
    };
    const obs = new MutationObserver(done);
    obs.observe(pre, { childList: true, characterData: true, subtree: true });
    done();
  }

  /* Which demo is under the frame's viewport, and therefore which one is
     spending time.

     This drives the demos' own gate rather than replacing it. asleep() in
     demo.js observes each section with 200 px of root margin and every loop
     in the file returns immediately while its section is out of reach, so
     scrolling this frame to a section is the whole of "boot the one you are
     at". The 200 px is why the ones either side keep running: sections sit
     adjacent in the document, so a neighbour is inside the margin and stays
     awake, which is exactly the behaviour asked for and none of it is code
     written here.

     Fractional, because the aisle is continuous. `t` is where the reader is
     between two stops, so the frame scrolls between two sections in step with
     the dolly and the wake-up happens while the monitor is still coming into
     view rather than when it is already square on. */
  seek(a, b, t) {
    if (!this.doc) return;
    const pa = this.sections[a], pb = this.sections[b] || pa;
    if (!pa) return;
    const ya = this.top(pa), yb = this.top(pb);
    this.frame.contentWindow.scrollTo(0, ya + (yb - ya) * t);
    this.awake = t < 0.5 ? a : b;
  }

  /* Where a section starts in its own document. Taken through the client rect
     and the frame's scroll rather than off offsetTop, which is measured from
     the offset parent and would have been quietly wrong the day one of these
     sections gained a positioned ancestor. */
  top(el) {
    return el.getBoundingClientRect().top + this.frame.contentWindow.scrollY;
  }

  /* Whether a demo is running, decided the same way demo.js decides it.
     asleep() there observes the section with `rootMargin: "200px"` and every
     loop in the file returns immediately while its own section is out of
     reach; this is that test, so a texture is only re-uploaded for a canvas
     that is actually being redrawn. The 200 is quoted from demo.js, not
     chosen here -- if it changes there this goes with it. */
  isAwake(stop) {
    const sec = this.sections[stop];
    if (!sec || !this.frame) return false;
    const w = this.frame.contentWindow;
    const r = sec.getBoundingClientRect();
    return r.bottom > -SLEEP_MARGIN && r.top < w.innerHeight + SLEEP_MARGIN;
  }

  /* Press a section's own start control, once. Not a synthesised pointer over
     a canvas and not a call into anything private -- the button demo.html
     puts in the section, clicked the way a reader clicks it. Declines while
     it is disabled, which is how both scripts say "the runtime is not up
     yet"; the caller comes back next frame. */
  start(stop) {
    const id = this.spec.cells[stop].run;
    if (!id || !this.doc || this.started.has(stop)) return false;
    const btn = this.doc.getElementById(id);
    if (!btn || btn.disabled) return false;
    this.started.add(stop);
    btn.click();
    return true;
  }

  /* Whether a canvas has anything on it. `is-live` is both scripts' own
     signal -- their live() helper sets it when a plate stops being empty, and
     demo.css fades the canvas up on it. Keying the monitor's face on the same
     class means a cell that has not painted yet shows Rig.jsx's placeholder
     instead of a black rectangle, and it costs no pixel readback to know. */
  isPainted(stop) {
    const c = this.canvases[stop];
    return !!c && c.classList.contains("is-live");
  }

  /* Entering: the frame comes out from behind the building, sized to the
     section rather than to a number picked in advance -- the sections are the
     document site's own layout and their height is whatever their prose and
     controls come to. Measured here, capped to what the window can show. */
  show(stop, margin) {
    const sec = this.sections[stop];
    if (!sec || !this.frame) return null;
    const h = Math.min(sec.getBoundingClientRect().height,
                       window.innerHeight - margin * 2);
    this.frame.style.height = h + "px";
    this.frame.contentWindow.scrollTo(0, sec.offsetTop);
    this.frame.style.opacity = "1";
    this.frame.style.pointerEvents = "auto";
    return h;
  }

  hide(height) {
    if (!this.frame) return;
    this.frame.style.opacity = "0";
    this.frame.style.pointerEvents = "none";
    this.frame.style.height = height + "px";
  }

  unmount() {
    if (!this.frame) return;
    /* The only reliable way to stop demo.js. Removing the frame ends its
       browsing context: every rAF loop, the race worker, the Pyodide heap and
       numpy inside it, and the two MB of Python it downloaded. */
    this.frame.remove();
    this.frame = null; this.doc = null;
    this.canvases = {}; this.sections = {}; this.awake = null;
  }
}

/* What this file adds to the document site's own stylesheets, which are
   loaded unchanged by the <link>s already in demo.html.

   [data-reveal] is style.css's scroll-reveal: opacity 0 until immersive.js
   adds .is-in. immersive.js is one of the five scripts stripped above, so
   without this override every section in the frame would be invisible -- the
   canvases would still paint, because a backing store does not care about
   opacity, but the overlay would have been a blank plate. That cost a pass.

   The prose goes. Each of these sections opens with three to five paragraphs
   introducing the demo to a reader of a document; a cell in a building has
   the plate on the aisle for that, and the reader who clicked into the cell
   came to drive it. The controls, the key, the canvas and the readout stay.
   Hidden rather than removed, so nothing demo.js might reach for disappears. */
const FRAME_CSS = `
  html { overscroll-behavior: contain; }
  body.runner-page { background: #0b0b0c; }
  [data-reveal] { opacity: 1 !important; transform: none !important; }
  .runner { padding-top: 18px; }
  .chase__lede, .chase__title, .runner__tocl, .ref__lede { display: none; }
  .console { margin-top: 24px; }
  .console__note { display: none; }
  ::-webkit-scrollbar { width: 0; height: 0; }
`;

const live = new Map();

/* Reference-counted, because two cells either side of a bundle boundary can
   both want it in the same frame while the reader walks between them. */
export function acquire(id, width, height) {
  let b = live.get(id);
  if (!b) { b = new Bundle(id); live.set(id, b); b.booting = b.mount(width, height); }
  b.refs++;
  return b;
}

export function release(id) {
  const b = live.get(id);
  if (!b) return;
  if (--b.refs > 0) return;
  b.unmount();
  live.delete(id);
}

export function bundle(id) { return live.get(id) || null; }

/* The handle the probes read, in the same shape and for the same reason as
   window.__lab in nav/Probe.jsx: a WebGL page carrying four Python runtimes
   cannot be checked from the outside without one. Read-only by convention. */
export function expose() {
  window.__bays = {
    site: SITE,
    live: () => Object.fromEntries([...live].map(([k, b]) => [k, {
      refs: b.refs,
      marks: b.marks,
      awake: b.awake,
      error: b.error || null,
      pyodide: !!(b.frame && b.frame.contentWindow && b.frame.contentWindow.__pyodide),
      log: b.doc ? (b.doc.getElementById("log") || {}).textContent : null,
      canvases: Object.fromEntries(Object.entries(b.canvases).map(
        ([s, c]) => [s, c ? [c.width, c.height] : null]))
    }]))
  };
}
