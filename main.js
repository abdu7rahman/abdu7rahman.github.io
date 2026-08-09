/* Scroll-spy for the rail. Marks the section whose heading most recently
   crossed the top third of the viewport, which behaves better than plain
   intersection ratios when sections differ a lot in height. */
(function () {
  "use strict";

  var links = Array.prototype.slice.call(document.querySelectorAll("[data-nav]"));
  if (!links.length) return;

  var targets = links
    .map(function (a) {
      var el = document.getElementById(a.getAttribute("href").slice(1));
      return el ? { link: a, el: el } : null;
    })
    .filter(Boolean);

  var current = null;

  function setCurrent(entry) {
    if (entry === current) return;
    if (current) current.link.removeAttribute("aria-current");
    if (entry) entry.link.setAttribute("aria-current", "true");
    current = entry;
  }

  function update() {
    var line = window.innerHeight * 0.32;
    var active = targets[0];
    for (var i = 0; i < targets.length; i++) {
      if (targets[i].el.getBoundingClientRect().top <= line) active = targets[i];
    }
    // pin the last section once the page is at the bottom
    if (window.innerHeight + window.scrollY >= document.body.scrollHeight - 4) {
      active = targets[targets.length - 1];
    }
    setCurrent(active);
  }

  var ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(function () {
      update();
      ticking = false;
    });
  }

  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll, { passive: true });
  update();

  // Keep focus with the reader after an in-page jump, so keyboard and screen
  // reader users land in the section rather than back at the top of the rail.
  //
  // This waited 320ms first, to let the smooth scroll finish. That wait was on
  // the input path and bought nothing: preventScroll is exactly the flag that
  // makes focus() safe to call mid-scroll, so the delay only meant a keyboard
  // user pressed Enter and nothing took focus for a third of a second.
  links.forEach(function (a) {
    a.addEventListener("click", function () {
      var el = document.getElementById(a.getAttribute("href").slice(1));
      if (!el) return;
      el.setAttribute("tabindex", "-1");
      el.focus({ preventScroll: true });
    });
  });
})();

/* ── first-time reveal ──────────────────────────────────────────────────
   Sections lift in once as they arrive. Built to the rules in Emil
   Kowalski's animation guidance:

   - it is a first-time, once-per-visit reveal, which is the only tier
     where a duration past 300ms is allowed
   - transform and opacity only, so it never touches layout or paint
   - staggered 60ms within a section, because everything landing at once
     reads as a page dumping rather than assembling
   - it unobserves after firing; a reveal that replays on every scroll is
     an animation the user sees hundreds of times, which fails the gate
   - if IntersectionObserver is missing, everything is shown immediately.
     Content must never be left invisible behind a script.
   ------------------------------------------------------------------- */
(function () {
  var nodes = [].slice.call(document.querySelectorAll("[data-reveal]"));
  if (!nodes.length) return;

  var show = function (el) { el.classList.add("is-in"); };
  if (!("IntersectionObserver" in window)) { nodes.forEach(show); return; }

  // Anything already on screen at load shows without animating -- the
  // reveal is for content you scroll to, not for the first viewport.
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      var group = e.target.parentNode ? [].slice.call(
        e.target.parentNode.querySelectorAll("[data-reveal]")) : [e.target];
      var i = Math.max(0, group.indexOf(e.target));
      e.target.style.setProperty("--reveal-delay", Math.min(i, 5) * 60 + "ms");
      show(e.target);
      io.unobserve(e.target);
    });
  }, { rootMargin: "0px 0px -12% 0px", threshold: 0.08 });

  nodes.forEach(function (el) {
    if (el.getBoundingClientRect().top < window.innerHeight * 0.9) show(el);
    else io.observe(el);
  });
})();
