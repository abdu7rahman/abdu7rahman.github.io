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
  links.forEach(function (a) {
    a.addEventListener("click", function () {
      var el = document.getElementById(a.getAttribute("href").slice(1));
      if (!el) return;
      el.setAttribute("tabindex", "-1");
      window.setTimeout(function () { el.focus({ preventScroll: true }); }, 320);
    });
  });
})();
