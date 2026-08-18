/* The visit counter in the footer.
 *
 * The site is static -- GitHub Pages, no server, nothing that can hold a
 * number between two readers. So the count lives in a third-party counter
 * (abacus.jasoncameron.dev: free, no signup, no cookies, CORS wildcard, and
 * it returns plain JSON rather than a badge image, which is the only reason
 * the number can be set in the site's own type instead of someone else's).
 *
 * Two rules this thing is built around:
 *
 *   1. The number is real or it is absent. If the service is down, slow, or
 *      answers with something that is not a number, the footer line stays
 *      hidden and the page looks exactly as it does today. A counter stuck at
 *      0, or one showing a plausible invention, is worse than no counter --
 *      it is the only number on this site a reader cannot check.
 *
 *   2. A reload is not a visit. A visit is a stretch of reading broken by
 *      half an hour of not reading -- the same definition Plausible and GA
 *      use, so the number means what a reader assumes it means. The first
 *      page after that gap increments; every page inside the gap reads. That
 *      is the /hit and /get split below, and it is why the label says
 *      "visits" and not "visitors": the same person tomorrow is honestly a
 *      second visit, and the same person hammering F5 honestly is not.
 *
 *      The gap is measured from one number in localStorage -- a millisecond
 *      timestamp, nothing else. Not a cookie, not an id, never sent
 *      anywhere. It has to outlive the tab, because opening the demo page in
 *      a second tab is the same visit and sessionStorage cannot see that.
 *
 * Nothing here is tracking: no cookie, no identifier, no referrer, nothing
 * sent but the two path segments below.
 */
(function () {
  "use strict";

  var ENDPOINT = "https://abacus.jasoncameron.dev";
  var NAMESPACE = "abdu7rahman.github.io";
  var KEY = "visits";
  var MARK = "visit-seen";
  var WINDOW = 30 * 60 * 1000;

  var el = document.getElementById("visits");
  if (!el || !window.fetch) return;
  var out = el.querySelector("[data-count]");
  if (!out) return;

  // A timestamp from the future means the clock moved backwards, not that
  // the reader is still here -- treat it as stale rather than letting it
  // suppress counting until it catches up.
  var now = Date.now(), last = 0;
  try { last = parseInt(localStorage.getItem(MARK), 10) || 0; } catch (e) { /* private mode */ }
  var during = last > 0 && now >= last && now - last < WINDOW;

  fetch(ENDPOINT + "/" + (during ? "get" : "hit") + "/" + NAMESPACE + "/" + KEY, {
    mode: "cors", cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer"
  })
    .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
    .then(function (d) {
      var n = d && typeof d.value === "number" ? d.value : NaN;
      if (!isFinite(n) || n < 1) return;
      // Stamped only once the counter has actually answered. If the service
      // is down the clock does not start, so the next load that works still
      // counts the visit instead of silently swallowing it.
      try { localStorage.setItem(MARK, String(Date.now())); } catch (e) { /* private mode */ }
      show(n);
    })
    .catch(function () { /* stays hidden, by rule 1 */ });

  function show(n) {
    // The settled value goes in first and the row is revealed with it already
    // correct, so the static state is the finished state. The count-up below
    // is decoration on top of a page that is already right -- if it never
    // runs, nothing is missing.
    out.textContent = n.toLocaleString("en-US");
    el.hidden = false;

    var reduced = !window.matchMedia ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced || !window.requestAnimationFrame) return;

    // Count up over the last few arrivals rather than from zero: 0 -> 12,000
    // is a slot machine, and it reflows the footer twice on the way past
    // every power of ten. Starting inside the same digit count keeps the row
    // a fixed width for the whole animation.
    var floor = Math.pow(10, String(n).length - 1);
    var from = n - Math.min(n - floor, 40);
    if (from >= n) return;

    var DUR = 900, t0 = 0;
    requestAnimationFrame(function step(t) {
      if (!t0) t0 = t;
      var p = Math.min(1, (t - t0) / DUR);
      var eased = 1 - Math.pow(1 - p, 3);
      out.textContent = Math.round(from + (n - from) * eased).toLocaleString("en-US");
      if (p < 1) requestAnimationFrame(step);
    });
  }
})();
