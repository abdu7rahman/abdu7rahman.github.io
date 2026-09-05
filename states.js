/* The page as a set of states rather than a scroll.
 *
 * shader.se, measured: its document is exactly one viewport tall and scrollY
 * never leaves 0. Its four destinations all sit in the DOM at once and the
 * wheel steers between them. That is the whole trick -- there is no document,
 * there is a scene you move through.
 *
 * The obvious objection to copying it is that shader.se has 516 words and this
 * page has 2926, five tables and 182 measured numbers. The objection is real
 * and the conclusion drawn from it is not: a state does not have to fit on a
 * screen. Each one here is its own scroll container, so a short state is a
 * held frame and a tall state is read normally, and the wheel only moves you
 * on once the state you are in has nothing left to show. Nothing is cut.
 *
 * Progressive enhancement, and strictly: the stylesheet never locks the page.
 * This file adds `is-staged`, and everything that depends on it hangs off that
 * class. No JS, an old browser, reduced motion, a phone, a thrown exception --
 * any of those and what is left is the same scrolling document as before.
 */
(function () {
  "use strict";

  if (!document.body || !document.body.classList.contains("home")) return;
  if (!window.matchMedia) return;
  // Desktop only. A phone's own scrolling is already the right answer for a
  // document this long, and hijacking it to page through states is how you
  // make a page nobody can read on a train.
  var mq = window.matchMedia("(min-width: 901px) and (hover: hover) and (pointer: fine)");
  var still = window.matchMedia("(prefers-reduced-motion: reduce)");
  if (still.matches) return;

  var main = document.getElementById("main");
  if (!main) return;
  var panels = Array.prototype.filter.call(main.children, function (el) {
    return el.id && (el.classList.contains("sec") || el.classList.contains("hero"));
  });
  if (panels.length < 2) return;

  // -1, not 0: show() refuses to repaint a state you are already on, and with
  // i starting at 0 the very first show(0) was exactly that call. The page
  // staged itself and then rendered nothing.
  var i = -1, going = false, staged = false;
  var ids = panels.map(function (p) { return p.id; });

  var count = document.createElement("p");
  count.className = "stage-count";
  count.setAttribute("aria-hidden", "true");
  document.body.appendChild(count);
  function pad(n) { return n < 10 ? "0" + n : "" + n; }

  function show(n, how) {
    n = Math.max(0, Math.min(panels.length - 1, n));
    if (n === i) return;
    var back = n < i;
    panels.forEach(function (p, k) {
      p.classList.toggle("is-live", k === n);
      // Which way a state leaves and arrives from, so travelling down the page
      // and travelling back up do not look like the same movement.
      p.classList.toggle("is-back", k !== n && (back ? k < n : k > n));
      if ("inert" in p) p.inert = k !== n;
      else if (k !== n) p.setAttribute("aria-hidden", "true");
      else p.removeAttribute("aria-hidden");
    });
    i = n;
    panels[n].scrollTop = 0;
    // The bar's own scroll-spy has no scroll to watch any more.
    var links = document.querySelectorAll("[data-nav]");
    Array.prototype.forEach.call(links, function (a) {
      var on = a.getAttribute("href") === "#" + ids[n];
      if (on) a.setAttribute("aria-current", "true"); else a.removeAttribute("aria-current");
    });
    document.body.setAttribute("data-state", ids[n]);
    count.innerHTML = "<b>" + pad(n + 1) + "</b> / " + pad(panels.length);
    if (how !== "silent" && history.replaceState) {
      history.replaceState(null, "", "#" + ids[n]);
    }
    window.dispatchEvent(new CustomEvent("stagechange", { detail: { index: n, id: ids[n] } }));
  }

  function step(d) {
    if (going || i < 0) return;
    going = true;
    show(i + d);
    setTimeout(function () { going = false; }, 620);
  }

  //: Whether the state you are in still has something to scroll to in the
  //: direction you are pushing. Only when it does not does the wheel move on.
  function room(el, d) {
    var slack = el.scrollHeight - el.clientHeight;
    if (slack < 4) return false;
    return d > 0 ? el.scrollTop < slack - 2 : el.scrollTop > 2;
  }

  //: A scroller of its own between the pointer and the state -- a log, a code
  //: block, a select. Those keep the wheel; nothing else does.
  function ownScroller(node, stop, d) {
    var n = node;
    while (n && n !== stop && n.nodeType === 1) {
      var cs = getComputedStyle(n);
      if ((cs.overflowY === "auto" || cs.overflowY === "scroll") && room(n, d)) return n;
      n = n.parentNode;
    }
    return null;
  }

  var run = 0, runAt = 0;
  function onWheel(e) {
    if (!staged) return;
    var live = panels[i];
    var d = e.deltaY;
    if (Math.abs(d) < 1) return;
    if (ownScroller(e.target, live, d)) { run = 0; return; }
    if (room(live, d)) {
      // Driven by hand rather than left to the browser, always. Containment
      // was the obvious test and it is the wrong one: the robot's canvas is a
      // child of the first state and also position: fixed, so it is inside the
      // state for contains() and outside its scrollable overflow -- a wheel
      // over it scrolled nothing, the state never reached its end, and the
      // page could not be left. What matters is whether anything can scroll,
      // not who owns whom.
      run = 0;
      e.preventDefault();
      live.scrollTop += d;
      return;
    }
    e.preventDefault();
    // Nothing accumulates during a transition. Letting it build while `going`
    // was true meant the tail of one flick was already over the threshold the
    // moment the cooldown lapsed, so a single push moved two states and you
    // never saw About or Stack at all.
    if (going) { run = 0; return; }
    var now = Date.now();
    if (now - runAt > 220) run = 0;                 // a new push, not the same one
    runAt = now;
    run += Math.abs(d);
    // A threshold rather than a single event, so one flick of a trackpad --
    // which arrives as thirty events -- is one state and not five.
    if (run > 90) { run = 0; step(d > 0 ? 1 : -1); }
  }

  function onKey(e) {
    if (!staged || e.metaKey || e.ctrlKey || e.altKey) return;
    var t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    var live = panels[i];
    if (e.key === "PageDown" || e.key === "ArrowDown") {
      if (room(live, 1)) return;
      e.preventDefault(); step(1);
    } else if (e.key === "PageUp" || e.key === "ArrowUp") {
      if (room(live, -1)) return;
      e.preventDefault(); step(-1);
    } else if (e.key === "Home") { e.preventDefault(); show(0); }
    else if (e.key === "End") { e.preventDefault(); show(panels.length - 1); }
  }

  // Every in-page link becomes a jump to a state.
  function onClick(e) {
    if (!staged || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey) return;
    var a = e.target.closest && e.target.closest('a[href^="#"]');
    if (!a) return;
    var id = a.getAttribute("href").slice(1);
    var n = ids.indexOf(id);
    if (n < 0) return;
    e.preventDefault();
    show(n);
  }

  function enter() {
    if (staged) return;
    staged = true;
    document.body.classList.add("is-staged");
    var want = ids.indexOf(location.hash.slice(1));
    show(want >= 0 ? want : 0, "silent");
  }
  function leave() {
    if (!staged) return;
    staged = false;
    document.body.classList.remove("is-staged");
    panels.forEach(function (p) {
      p.classList.remove("is-live", "is-back");
      if ("inert" in p) p.inert = false;
      p.removeAttribute("aria-hidden");
    });
    document.body.removeAttribute("data-state");
    i = -1;                                   // so re-entering repaints
  }

  window.addEventListener("wheel", onWheel, { passive: false });
  window.addEventListener("keydown", onKey);
  document.addEventListener("click", onClick);
  if (mq.addEventListener) mq.addEventListener("change", function () { mq.matches ? enter() : leave(); });
  else if (mq.addListener) mq.addListener(function () { mq.matches ? enter() : leave(); });
  if (still.addEventListener) still.addEventListener("change", function () { if (still.matches) leave(); });

  // Anything the page needs to know about where it is. The world reads this
  // every frame: with the document pinned at scrollY 0 there is no scroll left
  // to drive a camera with, so which state you are in and how far you have read
  // inside it *is* the scroll now.
  window.__stage = {
    at: function () { return i; },
    of: panels.length,
    ids: function () { return ids.slice(); },
    /* The live panel, so a reader can be located inside a state and not only
       between states. A long state read top to bottom has to move the world,
       or the world holds still through the longest part of the page. */
    panel: function () { return i >= 0 ? panels[i] : null; },
    go: function (n) { show(n); },
    on: function () { return staged; }
  };

  if (mq.matches) enter();
})();
