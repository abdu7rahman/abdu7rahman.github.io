/* The comment box, and the prompt that offers it.
 *
 * Two ways in, deliberately: a form at the foot of the page for anyone who
 * goes looking, and a quiet prompt after half a minute of actual reading for
 * anyone who would not have.
 *
 * The prompt is the part that can go wrong, so the rules it follows are:
 *
 *   - it counts engaged time, not wall clock. Thirty seconds means thirty
 *     seconds of a visible tab, so a page left open in the background never
 *     earns one.
 *   - it never interrupts. It is a bar at the bottom of the window, not a
 *     modal over the middle of it; the page stays readable and scrollable
 *     underneath, and nothing takes focus away from what someone was doing.
 *   - dismissing it is permanent. "Not now" writes to localStorage and the
 *     prompt never appears again on that browser. A prompt that comes back is
 *     the thing that makes people leave.
 *   - it does not appear to someone already looking at the form, or to
 *     someone who has already written something.
 *
 * Both are injected here rather than written into the pages, so a reader with
 * no JavaScript gets no form at all instead of one that silently fails.
 */
(function () {
  "use strict";

  var tag = document.querySelector("script[data-analytics]");
  var base = tag && tag.getAttribute("data-analytics");
  if (!base) return;
  var ENDPOINT = base.replace(/\/e$/, "/c");
  if (ENDPOINT === base) return;

  var host = document.querySelector(".foot");
  if (!host) return;

  var LEFT = "comment-left", HID = "comment-hidden";
  var AFTER = 30000;

  function flag(k) { try { return localStorage.getItem(k) === "1"; } catch (e) { return false; } }
  function setFlag(k) { try { localStorage.setItem(k, "1"); } catch (e) {} }

  var session = "";
  try { session = sessionStorage.getItem("s") || ""; } catch (e) {}

  /* ---- the form ------------------------------------------------------- */
  var form = document.createElement("form");
  form.className = "say";
  form.noValidate = true;
  form.innerHTML =
    '<h2 class="say__h">Say something</h2>' +
    '<p class="say__p">Corrections, questions, or a note. It reaches me and nobody else' +
    ' &mdash; nothing here is published.</p>' +
    '<label class="say__l" for="say-body">Your message</label>' +
    '<textarea class="say__t" id="say-body" name="body" rows="4" maxlength="2000" required></textarea>' +
    '<div class="say__row">' +
      '<div><label class="say__l" for="say-name">Name <span>optional</span></label>' +
      '<input class="say__i" id="say-name" name="name" maxlength="64" autocomplete="name"></div>' +
      '<div><label class="say__l" for="say-contact">Email <span>only if you want a reply</span></label>' +
      '<input class="say__i" id="say-contact" name="contact" maxlength="128" autocomplete="email"></div>' +
    '</div>' +
    // Off-screen rather than display:none, because some bots skip what is
    // hidden outright. A reader never reaches it; it is not in the tab order.
    '<div class="say__hp" aria-hidden="true"><label>Website<input name="website" tabindex="-1" autocomplete="off"></label></div>' +
    '<div class="say__foot"><button class="say__b" type="submit">Send</button>' +
    '<span class="say__msg" role="status" aria-live="polite"></span></div>';
  host.parentNode.insertBefore(form, host);

  var msg = form.querySelector(".say__msg");
  var btn = form.querySelector(".say__b");

  form.addEventListener("submit", function (ev) {
    ev.preventDefault();
    var body = form.body.value.trim();
    if (!body) { msg.textContent = "Nothing to send yet."; form.body.focus(); return; }

    btn.disabled = true;
    msg.textContent = "Sending...";
    fetch(ENDPOINT, {
      method: "POST", mode: "cors", credentials: "omit",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        body: body, name: form.name.value, contact: form.contact.value,
        website: form.website.value, session: session, path: location.pathname
      })
    }).then(function (r) {
      if (!r.ok && r.status !== 200) throw new Error(String(r.status));
      setFlag(LEFT);
      form.innerHTML = '<h2 class="say__h">Thank you</h2>' +
        '<p class="say__p">That reached me. If you left an address I will reply to it.</p>';
      hidePrompt();
    }).catch(function () {
      btn.disabled = false;
      msg.textContent = "That did not send. Try again, or email me.";
    });
  });

  /* ---- the prompt ----------------------------------------------------- */
  if (flag(LEFT) || flag(HID)) return;

  var bar = null;
  function hidePrompt() {
    if (!bar) return;
    bar.classList.remove("is-up");
    var el = bar; bar = null;
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 300);
  }

  // Returns whether it actually appeared, so the caller knows not to stop
  // trying when it declined for a reason that will pass.
  function showPrompt() {
    if (bar || flag(LEFT) || flag(HID)) return true;
    // Not worth asking someone who is already looking at the form -- but this
    // is a "not now", not a "never". Scrolling past the form once should not
    // cost the prompt for the rest of the visit.
    var box = form.getBoundingClientRect();
    if (box.top < window.innerHeight && box.bottom > 0) return false;

    bar = document.createElement("div");
    bar.className = "nudge";
    bar.setAttribute("role", "complementary");
    bar.setAttribute("aria-label", "Leave a comment");
    bar.innerHTML =
      '<p class="nudge__p">Any of this useful? I would like to know what you think.</p>' +
      '<div class="nudge__a">' +
        '<button class="nudge__b nudge__b--go" type="button">Leave a comment</button>' +
        '<button class="nudge__b" type="button" data-no>Not now</button>' +
      '</div>';
    document.body.appendChild(bar);
    requestAnimationFrame(function () { requestAnimationFrame(function () { if (bar) bar.classList.add("is-up"); }); });

    bar.querySelector(".nudge__b--go").addEventListener("click", function () {
      hidePrompt();
      form.scrollIntoView({ behavior: reduced() ? "auto" : "smooth", block: "center" });
      // preventScroll so focus does not fight the scroll that is still running.
      setTimeout(function () { try { form.body.focus({ preventScroll: true }); } catch (e) { form.body.focus(); } }, reduced() ? 0 : 320);
    });
    bar.querySelector("[data-no]").addEventListener("click", function () {
      setFlag(HID);          // permanent: a prompt that returns is the annoying kind
      hidePrompt();
    });
  }

  function reduced() {
    return !window.matchMedia || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  // Engaged time only: a tab sitting in the background earns nothing.
  var spent = 0, since = document.visibilityState === "hidden" ? 0 : Date.now();
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") {
      if (since) { spent += Date.now() - since; since = 0; }
    } else if (!since) { since = Date.now(); }
  });
  var timer = setInterval(function () {
    var total = spent + (since ? Date.now() - since : 0);
    // Keep checking until it either appears or is refused for good. Stopping
    // on the first attempt would mean a reader who happened to be level with
    // the form at the thirty second mark is never asked at all.
    if (total >= AFTER && showPrompt()) clearInterval(timer);
  }, 1000);
})();
