/* Entering a cell.
 *
 * A 1.2 m monitor read from the middle of a 6.4 m aisle is about two hundred
 * pixels across on a 1440 px window -- measured, by projecting the corners of
 * the face plane through the camera at the stop for `drive`. That is enough
 * to see that something is running and to recognise which demo it is. It is
 * not enough to drive a TurtleBot with, read a 10 Hz controller's readout, or
 * hit a five-way segmented control, and no amount of camera work makes it
 * enough: the limit is the number of pixels the thing occupies.
 *
 * So the screen is a picture of the work from the aisle and a door into it up
 * close. Clicking it brings the frame the demo is already running in out from
 * behind the building, at its own size, with its own pointer handling intact.
 * Nothing is re-mounted, nothing re-boots, no Python is fetched twice -- the
 * same browsing context that was feeding the texture a second ago is now the
 * thing under the cursor. That is the argument for having put the demos in an
 * iframe in the first place.
 *
 * drei's <Html> was the other candidate and would have been the wrong tool
 * twice over: it exists to peg DOM to a point in the scene, which a full-bleed
 * panel does not want, and the DOM it manages is React's, while every element
 * in these sections is written to and reclassed by a vanilla script that has
 * never heard of a reconciler.
 */

const CSS = `
#bay-chrome { position: fixed; inset: 0; z-index: 40; display: none;
              pointer-events: none; font-family: var(--ui); }
#bay-chrome.on { display: block; }
#bay-scrim { position: absolute; inset: 0; background: rgba(11,11,12,.88);
             pointer-events: auto; }
#bay-bar { position: absolute; left: 0; right: 0; top: 0; z-index: 42;
           display: flex; align-items: baseline; gap: 18px;
           padding: 14px clamp(14px, 2vw, 34px);
           pointer-events: auto; }
#bay-bar .kind { margin: 0; font: 600 10px/1 var(--mono); letter-spacing: .16em;
                 text-transform: uppercase; color: var(--hazard); }
#bay-bar .name { margin: 0; font: 700 15px/1 var(--ui); letter-spacing: .01em;
                 color: var(--ink); }
#bay-bar .sub  { margin: 0; font: 400 12px/1 var(--mono); color: var(--mut); }
#bay-bar .out  { margin-left: auto; display: flex; align-items: baseline; gap: 12px; }
#bay-bar kbd   { font: 600 10px/1.6 var(--mono); letter-spacing: .1em;
                 color: var(--mut); border: 1px solid #2a2a2e; border-radius: 2px;
                 padding: 2px 6px; }
#bay-bar button { background: none; border: 1px solid #2a2a2e; border-radius: 2px;
                  color: var(--ink); font: 600 10px/1.6 var(--mono);
                  letter-spacing: .16em; text-transform: uppercase;
                  padding: 4px 12px; cursor: pointer; }
#bay-bar button:hover { border-color: var(--hazard); color: var(--hazard); }

/* On a backing, like everything else written over the building. This sits
   top right, which at a test cell is a daylight beam crossing the aisle --
   pale, and the muted grey underneath it went to nothing. */
#bay-hint { position: fixed; right: clamp(14px, 2vw, 34px); top: 14px; z-index: 6;
            display: none; pointer-events: none; text-align: right;
            padding: 8px 12px 9px; font-family: var(--mono);
            background: linear-gradient(to bottom, rgba(9,9,10,.90), rgba(9,9,10,.84));
            border-top: 2px solid var(--hazard); }
#bay-hint.on { display: block; }
#bay-hint b { display: block; font: 600 10px/1.6 var(--mono); letter-spacing: .16em;
              text-transform: uppercase; color: var(--hazard); }
#bay-hint span { font-size: 11px; color: var(--mut); }
`;

let chrome = null, bar = null, hintEl = null;
let openState = null;                 // { bundle, stop, leave }
let parkedH = 0;

function build() {
  if (chrome) return;
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);

  chrome = document.createElement("div");
  chrome.id = "bay-chrome";
  chrome.innerHTML =
    '<div id="bay-scrim"></div>' +
    '<div id="bay-bar">' +
      '<p class="kind">Test cell</p>' +
      '<p class="name"></p>' +
      '<p class="sub"></p>' +
      '<span class="out"><kbd>esc</kbd><button type="button">Leave</button></span>' +
    '</div>';
  document.body.appendChild(chrome);
  bar = chrome.querySelector("#bay-bar");
  chrome.querySelector("#bay-scrim").addEventListener("click", closeCell);
  chrome.querySelector("button").addEventListener("click", closeCell);

  hintEl = document.createElement("div");
  hintEl.id = "bay-hint";
  hintEl.innerHTML = "<b>Live</b><span>click the screen to take the cell</span>";
  document.body.appendChild(hintEl);

  window.addEventListener("keydown", e => {
    if (e.key === "Escape" && openState) { closeCell(); e.preventDefault(); }
  });
}

export function isOpen() { return !!openState; }

export function openCell(stop, b, leave) {
  build();
  if (openState) closeCell();

  bar.querySelector(".name").textContent = stop.title;
  bar.querySelector(".sub").textContent = stop.sub || "";
  chrome.classList.add("on");
  hint(null);

  /* The frame is capped to the window less the bar, twice -- the bar sits over
     the top of the panel and the same clearance under it keeps the readout
     line off the bottom edge. Measured off the bar rather than assumed,
     because its height is set by the type in it and that comes from
     styles.css, which is not this file's. */
  const clear = Math.ceil(bar.getBoundingClientRect().height);
  const host = document.getElementById("bay-host");
  if (host) host.style.zIndex = "41";
  parkedH = b.frame ? parseFloat(b.frame.style.height) : 0;
  b.show(stop.id, clear);

  openState = { b, stop, leave };
}

export function closeCell() {
  if (!openState) return;
  const { b, leave } = openState;
  openState = null;
  b.hide(parkedH);
  const host = document.getElementById("bay-host");
  if (host) host.style.zIndex = "-1";
  chrome.classList.remove("on");
  document.body.style.cursor = "";
  leave();
}

/* The affordance, and the only piece of chrome this file adds to the aisle.
   Shown while a cell with a running screen is in reach and hidden the moment
   one is entered, because inside a cell the way out is the bar at the top. */
export function hint(stop) {
  if (!hintEl) build();
  hintEl.classList.toggle("on", !!stop && !openState);
}
