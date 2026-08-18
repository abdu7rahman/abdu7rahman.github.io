/* What the site reports about how it is read.
 *
 * The endpoint is a worker on the author's own Cloudflare account, not a
 * third-party analytics product, and the shape of what it sends is the point:
 *
 *   - no cookie, and nothing in localStorage that outlives the tab
 *   - no identifier of any kind; the server hashes the address against a salt
 *     that rotates at midnight UTC and never writes the address down
 *   - no referrer, no user-agent string, no screen fingerprint
 *   - a Global Privacy Control or Do Not Track header stops it entirely
 *
 * Which leaves it able to answer "how many people, from roughly where, read
 * what, and did they actually use the demos" -- and unable to answer anything
 * about a particular person, which is the correct trade for a portfolio.
 *
 * "Engaged" time, everywhere below, means the tab was visible and the section
 * was on screen. A tab left open over lunch contributes nothing, because the
 * alternative is a median dwell time that is a lie.
 */
(function () {
  "use strict";

  var tag = document.querySelector("script[data-analytics]");
  var ENDPOINT = tag && tag.getAttribute("data-analytics");
  if (!ENDPOINT) return;

  // Honoured even though this collector is already anonymous: the signal says
  // "do not measure me", and answering "but my measurement is harmless" is
  // not the reader's call to have overridden.
  if (navigator.globalPrivacyControl === true ||
      navigator.doNotTrack === "1" || window.doNotTrack === "1") return;

  var ENGAGED_MIN = 5000;   // a section has been used, not just scrolled past
  var FLUSH_MS = 15000;

  var session = (function () {
    // Dies with the tab, which is the intent: it groups one sitting together
    // and is worthless the moment that sitting ends.
    try {
      var k = "s", v = sessionStorage.getItem(k);
      if (!v) {
        v = (Date.now().toString(36) + Math.random().toString(36).slice(2, 10)).slice(0, 24);
        sessionStorage.setItem(k, v);
      }
      return v;
    } catch (e) {
      return Math.random().toString(36).slice(2, 18);
    }
  })();

  var path = location.pathname.replace(/index\.html$/, "") || "/";
  var queue = [];

  var pending = 0;
  function push(kind, label, ms, urgent) {
    queue.push({ kind: kind, session: session, path: path, label: label || null,
                 ms: typeof ms === "number" ? Math.round(ms) : null });
    // Outbound clicks go at once because the page is usually navigating away a
    // moment later. Everything else waits a second, so a burst of events in
    // one interaction still leaves as a single request.
    if (urgent || queue.length >= 12) { flush(false); return; }
    if (!pending) pending = setTimeout(function () { pending = 0; flush(false); }, 1000);
  }

  function flush(final) {
    if (pending) { clearTimeout(pending); pending = 0; }
    if (!queue.length) return;
    var body = JSON.stringify(queue.splice(0, queue.length));
    // sendBeacon is the only thing that reliably survives the page going away,
    // which is exactly when the dwell number is known.
    if (final && navigator.sendBeacon &&
        navigator.sendBeacon(ENDPOINT, new Blob([body], { type: "application/json" }))) return;
    fetch(ENDPOINT, { method: "POST", body: body, keepalive: true, mode: "cors",
                      credentials: "omit", headers: { "content-type": "application/json" } })
      .catch(function () { /* a lost measurement is not worth an error in a reader's console */ });
  }

  /* Engaged time, for the page as a whole and for each demo section.
   *
   * One clock, started and stopped by visibility, rather than a timestamp
   * difference at the end -- otherwise every tab anyone forgot about reads as
   * an hour of rapt attention. */
  function Clock() {
    this.total = 0; this.since = 0;
  }
  Clock.prototype.start = function () { if (!this.since) this.since = Date.now(); };
  Clock.prototype.stop = function () {
    if (this.since) { this.total += Date.now() - this.since; this.since = 0; }
  };
  Clock.prototype.read = function () {
    return this.total + (this.since ? Date.now() - this.since : 0);
  };

  var page = new Clock();
  var visible = function () { return document.visibilityState !== "hidden"; };
  if (visible()) page.start();

  push("pageview");

  /* Demo sections.
   *
   * A demo counts as opened when the reader touches it, not when it scrolls
   * into view -- scrolling past six sections on the way down the page is not
   * six demos. It counts as engaged once it has held a visible screen for five
   * seconds after that touch, which is the difference between clicking a thing
   * and using it. */
  var demos = {};
  [].forEach.call(document.querySelectorAll("[data-demo]"), function (el) {
    var name = el.getAttribute("data-demo");
    var d = demos[name] = { el: el, name: name, clock: new Clock(), opened: false,
                            engaged: false, onScreen: false };

    ["pointerdown", "keydown"].forEach(function (ev) {
      el.addEventListener(ev, function () {
        if (!d.opened) { d.opened = true; push("demo_start", name); }
        if (d.onScreen && visible()) d.clock.start();
      }, { passive: true });
    });
  });

  var names = Object.keys(demos);
  if (names.length && "IntersectionObserver" in window) {
    // A ratio threshold alone does not work here: a demo section is usually
    // taller than the window, so it can be filling the whole screen and still
    // report an intersection ratio well under half. What counts as "on screen"
    // is therefore measured in pixels -- enough of the section to be looking
    // at, or enough of the window to be filled by it, whichever is easier to
    // satisfy.
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        var d = demos[e.target.getAttribute("data-demo")];
        if (!d) return;
        var shown = e.intersectionRect.height;
        var need = Math.min(e.boundingClientRect.height * 0.4,
                            (window.innerHeight || 800) * 0.35);
        d.onScreen = e.isIntersecting && shown >= need;
        if (d.opened && d.onScreen && visible()) d.clock.start(); else d.clock.stop();
      });
    }, { threshold: [0, 0.05, 0.15, 0.3, 0.5, 0.75, 1] });
    names.forEach(function (k) { io.observe(demos[k].el); });
  }

  function settleDemos(final) {
    names.forEach(function (k) {
      var d = demos[k];
      if (!d.opened || d.engaged) return;
      if (d.clock.read() >= ENGAGED_MIN) { d.engaged = true; push("demo_done", d.name, d.clock.read()); }
    });
    if (final) {
      names.forEach(function (k) {
        var d = demos[k];
        if (d.opened && !d.engaged && d.clock.read() > 0) d.clock.stop();
      });
    }
  }

  // Outbound clicks: the host, never the full URL, so a link with a token or a
  // query string in it cannot end up in the table.
  document.addEventListener("click", function (ev) {
    var a = ev.target && ev.target.closest ? ev.target.closest("a[href]") : null;
    if (!a) return;
    var href = a.getAttribute("href") || "";
    if (/^(mailto|tel):/i.test(href)) { push("outbound", href.split(":")[0] + ":", null, true); return; }
    var u;
    try { u = new URL(a.href, location.href); } catch (e) { return; }
    if (u.protocol !== "http:" && u.protocol !== "https:") return;
    if (u.host === location.host) {
      if (/\.pdf$/i.test(u.pathname)) push("outbound", "resume", null, true);
      return;
    }
    push("outbound", u.host + (u.pathname.length > 1 ? u.pathname.slice(0, 40) : ""), null, true);
  }, true);

  document.addEventListener("visibilitychange", function () {
    if (visible()) {
      page.start();
      names.forEach(function (k) { var d = demos[k]; if (d.opened && d.onScreen) d.clock.start(); });
    } else {
      page.stop();
      names.forEach(function (k) { demos[k].clock.stop(); });
      settleDemos(false);
      flush(true);
    }
  });

  setInterval(function () { settleDemos(false); flush(false); }, FLUSH_MS);
  setInterval(function () { settleDemos(false); }, 2000);

  // pagehide rather than unload: unload is not fired at all on mobile Safari
  // when a tab is backgrounded away, which is most of the time.
  window.addEventListener("pagehide", function () {
    page.stop();
    names.forEach(function (k) { demos[k].clock.stop(); });
    settleDemos(true);
    push("session_end", null, page.read());
    flush(true);
  });
})();
