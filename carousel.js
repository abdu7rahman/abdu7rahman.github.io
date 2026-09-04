/* The "Selected Work" carousel. Same ten <li class="proj"> the page always
 * had, paged one at a time instead of scrolled past -- shader.se's pattern,
 * this site's actual project cards.
 *
 * Ships already showing every card in a plain stacked column -- exactly what
 * a reader without JavaScript gets today -- and only becomes a carousel once
 * this file confirms it can actually drive one. `.is-active` is the switch;
 * landing.css hides the paging controls until it is set.
 */
(function () {
  "use strict";

  var root = document.querySelector("[data-carousel]");
  if (!root) return;
  var track = root.querySelector(".carousel__track");
  var slides = track ? Array.prototype.slice.call(track.children) : [];
  if (!track || slides.length < 2) return;

  var view = root.querySelector(".carousel__viewport");
  var prev = root.querySelector(".carousel__btn--prev");
  var next = root.querySelector(".carousel__btn--next");
  var pos = root.querySelector(".carousel__pos");
  var i = 0;

  function pad(n) { return n < 10 ? "0" + n : "" + n; }

  // Measured, not computed from a percentage. .projects carries gap: 16px,
  // which is a column gap once the track is a flex row, and translateX(-i *
  // 100%) does not know about it: every slide drifted 16px further right than
  // the last, so by card 08 it sat 112px off and the stats column was cut
  // clean off by the viewport's own overflow: hidden. offsetLeft is layout
  // position -- unaffected by the transform already on the track -- so this
  // stays right whatever the gap, the padding or the direction later become.
  //
  // Height is measured for a related reason: a flex row stretches every item
  // to the tallest one, which drew card 01 as a card with a third of its
  // interior empty, reserved for the longest card in the set.
  function place() {
    if (!slides[i]) return;
    track.style.transform = "translateX(" + (slides[0].offsetLeft - slides[i].offsetLeft) + "px)";
    // offsetHeight, not a bounding rect: the cards carry a scale transform
    // now, and a rect is the transformed box -- an inactive slide measures
    // 95.5% of itself and the viewport came out short by the difference.
    if (view) view.style.height = slides[i].offsetHeight + "px";
  }

  function render() {
    // Marked before it is measured: place() reads a layout height, and the
    // class is what decides which card is at full size.
    for (var s = 0; s < slides.length; s++) slides[s].classList.toggle("is-on", s === i);
    place();
    prev.disabled = i === 0;
    next.disabled = i === slides.length - 1;
    if (pos) pos.textContent = pad(i + 1) + " / " + pad(slides.length);
  }

  function go(delta) {
    i = Math.max(0, Math.min(slides.length - 1, i + delta));
    render();
  }

  prev.addEventListener("click", function () { go(-1); });
  next.addEventListener("click", function () { go(1); });

  // Arrow keys, only while the carousel itself has focus inside it -- a
  // page full of other links would otherwise fight every ArrowLeft/Right.
  root.addEventListener("keydown", function (e) {
    if (e.key === "ArrowLeft") { go(-1); e.preventDefault(); }
    else if (e.key === "ArrowRight") { go(1); e.preventDefault(); }
  });

  // Touch swipe. No library, no velocity model -- a 40px horizontal drag
  // that stayed more horizontal than vertical is a page, nothing subtler.
  var sx = 0, sy = 0, dragging = false;
  track.addEventListener("pointerdown", function (e) {
    dragging = true; sx = e.clientX; sy = e.clientY;
  });
  track.addEventListener("pointerup", function (e) {
    if (!dragging) return;
    dragging = false;
    var dx = e.clientX - sx, dy = e.clientY - sy;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? 1 : -1);
  });

  // The per-card scroll reveal in main.js has nothing to watch here: nine of
  // ten slides sit outside the clipped viewport and an IntersectionObserver
  // never fires for an element that never scrolls into view. Paging is the
  // affordance now, not arriving, so every slide is shown up front rather
  // than left at the reveal's rest state forever.
  slides.forEach(function (s) { s.classList.add("is-in"); });

  // The light that follows the pointer across a card. Coordinates are written
  // as percentages of the card, so landing.css can position the gradient
  // without needing the card's size. One listener on the track rather than
  // ten on the cards, and nothing runs for a reader who never hovers.
  if (!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches)) {
    track.addEventListener("pointermove", function (e) {
      var card = e.target.closest && e.target.closest(".proj");
      if (!card) return;
      var b = card.getBoundingClientRect();
      card.style.setProperty("--mx", ((e.clientX - b.left) / b.width * 100).toFixed(2) + "%");
      card.style.setProperty("--my", ((e.clientY - b.top) / b.height * 100).toFixed(2) + "%");
    }, { passive: true });
  }

  // Re-measure on anything that reflows a card: the viewport width, a web
  // font arriving after first paint, a stat table wrapping to another line.
  window.addEventListener("resize", place, { passive: true });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(place);
  if (window.ResizeObserver) {
    var ro = new ResizeObserver(place);
    slides.forEach(function (s) { ro.observe(s); });
  }

  root.classList.add("is-active");
  render();
})();
