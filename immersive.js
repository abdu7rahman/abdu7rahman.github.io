/* The landing page's feel: inertial scrolling, a cursor that reacts, buttons
 * that lean toward the pointer, and cards that tilt under it.
 *
 * All of it is the same bet -- that a page which answers the pointer
 * continuously reads as a built thing rather than a document -- and all of it
 * is off under prefers-reduced-motion, on touch, or without JS, because every
 * one of these is an embellishment on a page that already works.
 *
 * Landing page only. demo.html is a set of instruments you draw maps and place
 * obstacles on: a cursor that lags its own position by a frame and a page that
 * keeps sliding after you stop are exactly wrong there.
 */
(function () {
  "use strict";

  if (!document.body || !document.body.classList.contains("home")) return;

  var reduce = window.matchMedia &&
               window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var fine = window.matchMedia && window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  if (reduce) return;

  /* ── inertial scroll ───────────────────────────────────────────────────
     The wheel sets a target and the page eases toward it. This drives the
     real scroller with scrollTo rather than transforming a wrapper, which is
     the detail that matters: position: sticky, the CSS scroll timelines the
     reveals run on, and anchor links all keep working, because as far as the
     browser is concerned the document is scrolled to exactly where it says.

     Off on touch. A phone's own scrolling already has momentum, and layering
     a second one on top of it produces the drifting, unstoppable page that
     makes people close the tab. */
  var smooth = fine && !("ontouchstart" in window);
  if (smooth) {
    var target = window.scrollY;
    var current = target;
    var ticking = false;
    var mine = -1;              // where our last frame put the page

    // scroll-behavior: smooth in the stylesheet would fight this on every
    // anchor jump: two easings racing to the same place.
    document.documentElement.style.scrollBehavior = "auto";

    function maxScroll() {
      return Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    }
    function put(y) { mine = Math.round(y); window.scrollTo(0, y); }
    function step() {
      var d = target - current;
      current += d * 0.12;
      if (Math.abs(d) < 0.4) { current = target; ticking = false; }
      put(current);
      if (ticking) requestAnimationFrame(step);
    }
    function kick() { if (!ticking) { ticking = true; requestAnimationFrame(step); } }
    // Where the browser would have parked this element, scroll-padding-top
    // included -- otherwise every section title lands under the fixed bar.
    function restOf(el) {
      var pad = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop);
      return el.getBoundingClientRect().top + window.scrollY - (pad > 0 ? pad : 0);
    }
    function glideTo(y) {
      target = Math.max(0, Math.min(maxScroll(), y));
      kick();
    }

    window.addEventListener("wheel", function (e) {
      // Leave anything with its own scrollbar alone -- the log on a demo card,
      // a code block, a select. Hijacking those breaks them.
      var n = e.target;
      while (n && n !== document.body) {
        if (n.scrollHeight > n.clientHeight + 2) {
          var s = getComputedStyle(n).overflowY;
          if (s === "auto" || s === "scroll") return;
        }
        n = n.parentNode;
      }
      if (e.ctrlKey) return;                 // pinch-zoom, not a scroll
      e.preventDefault();
      glideTo(target + e.deltaY * (e.deltaMode === 1 ? 18 : 1));
    }, { passive: false });

    // Anything that moves the page another way -- the keyboard, the scrollbar,
    // find-in-page, focus following a Tab, a script -- wins outright, mid-ease
    // included. Ownership is decided by position rather than by a flag: every
    // frame we write records where we put the page, so a scroll event that
    // reports somewhere else came from someone else. Testing `ticking` instead
    // is the bug that shipped a page which swallowed an anchor jump whenever
    // the reader clicked one while the wheel was still settling.
    window.addEventListener("scroll", function () {
      var y = window.scrollY;
      if (Math.abs(y - mine) <= 1) return;
      target = current = y;
      mine = Math.round(y);
    }, { passive: true });
    window.addEventListener("resize", function () {
      target = current = window.scrollY;
      mine = Math.round(target);
    }, { passive: true });

    // In-page links ease rather than cut. Doing it here instead of leaving it
    // to the browser is what keeps the two in agreement: the jump and the
    // easing loop are now the same motion, not one interrupting the other.
    // main.js already moves focus to the destination on these clicks, so this
    // handler only owns the scrolling.
    document.addEventListener("click", function (e) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey ||
          e.shiftKey || e.altKey) return;
      var a = e.target.closest && e.target.closest('a[href^="#"]');
      if (!a) return;
      var hash = a.getAttribute("href");
      if (hash.length < 2) return;
      var el = document.getElementById(decodeURIComponent(hash.slice(1)));
      if (!el) return;
      e.preventDefault();
      current = window.scrollY;
      glideTo(restOf(el));
      // The address bar and the back button should still agree with the page.
      if (history.pushState) history.pushState(null, "", hash);
      else location.hash = hash;
    });
    window.addEventListener("hashchange", function () {
      var el = document.getElementById(decodeURIComponent(location.hash.slice(1)));
      if (el) { current = window.scrollY; glideTo(restOf(el)); }
    });
  }

  if (!fine) return;

  /* ── the cursor ────────────────────────────────────────────────────────
     A dot at the pointer and a ring chasing it. The ring is the part that
     carries the information: it swells over anything you can act on, so the
     page answers before the click. */
  var dot = document.createElement("div");
  dot.className = "cur-dot";
  var ring = document.createElement("div");
  ring.className = "cur-ring";
  dot.setAttribute("aria-hidden", "true");
  ring.setAttribute("aria-hidden", "true");
  document.body.appendChild(ring);
  document.body.appendChild(dot);
  document.body.classList.add("has-cur");

  var mx = window.innerWidth / 2, my = window.innerHeight / 2;
  var rx = mx, ry = my, shown = false;

  window.addEventListener("pointermove", function (e) {
    if (e.pointerType !== "mouse") return;
    mx = e.clientX; my = e.clientY;
    if (!shown) { shown = true; rx = mx; ry = my; document.body.classList.add("cur-on"); }
    dot.style.transform = "translate3d(" + mx + "px," + my + "px,0)";
    curTick();
  }, { passive: true });

  document.addEventListener("pointerleave", function () {
    document.body.classList.remove("cur-on");
    shown = false;
  });

  var curRaf = null;
  function curStep() {
    curRaf = null;
    rx += (mx - rx) * 0.18;
    ry += (my - ry) * 0.18;
    ring.style.transform = "translate3d(" + rx + "px," + ry + "px,0)";
    if (Math.abs(mx - rx) > 0.3 || Math.abs(my - ry) > 0.3) curTick();
  }
  function curTick() { if (curRaf == null) curRaf = requestAnimationFrame(curStep); }

  var HOT = "a[href],button,summary,[role=radio],input,textarea,.proj";
  document.addEventListener("pointerover", function (e) {
    if (e.target.closest && e.target.closest(HOT)) ring.classList.add("is-hot");
  });
  document.addEventListener("pointerout", function (e) {
    if (e.target.closest && e.target.closest(HOT)) ring.classList.remove("is-hot");
  });

  /* ── magnetic buttons ──────────────────────────────────────────────────
     Inside a small radius the control leans toward the pointer. A third of
     the distance, capped: past that it stops reading as attraction and starts
     reading as the button running away. */
  var MAGNETS = document.querySelectorAll(".btn, .rail__cta, .carousel__btn");
  Array.prototype.forEach.call(MAGNETS, function (el) {
    el.addEventListener("pointermove", function (e) {
      var b = el.getBoundingClientRect();
      var dx = e.clientX - (b.left + b.width / 2);
      var dy = e.clientY - (b.top + b.height / 2);
      var cap = 10;
      el.style.transform = "translate(" + Math.max(-cap, Math.min(cap, dx * 0.32)) + "px,"
                                        + Math.max(-cap, Math.min(cap, dy * 0.32)) + "px)";
    }, { passive: true });
    el.addEventListener("pointerleave", function () { el.style.transform = ""; }, { passive: true });
  });

  /* ── card tilt ─────────────────────────────────────────────────────────
     Small angles on purpose. A card that tilts far enough to be obvious is
     also tilted far enough that the text on it stops being flat to the
     reader, and these cards are mostly text. */
  var cards = document.querySelectorAll(".proj");
  Array.prototype.forEach.call(cards, function (card) {
    card.addEventListener("pointermove", function (e) {
      var b = card.getBoundingClientRect();
      var px = (e.clientX - b.left) / b.width - 0.5;
      var py = (e.clientY - b.top) / b.height - 0.5;
      card.style.transform = "perspective(900px) rotateX(" + (-py * 3.2).toFixed(2) + "deg) rotateY("
                           + (px * 3.6).toFixed(2) + "deg)";
    }, { passive: true });
    card.addEventListener("pointerleave", function () { card.style.transform = ""; }, { passive: true });
  });
})();
