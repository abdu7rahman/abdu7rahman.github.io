import { useFrame } from "@react-three/fiber";
import { asked, watchBakes } from "./bake.js";
import { warm } from "../sim/engine.js";

/* The wait, with what it is waiting on named.
 *
 * There was nothing here. index.html carried an empty #root, the module that
 * fills it is 1.3 MB of parsed JavaScript, and the building behind it
 * compiles a few dozen shader programs and a thousand objects before it draws
 * anything at all -- so a reader got a page that was the background colour
 * and stayed that way, with no way to tell a slow load from a broken one.
 * That is the complaint this answers, and "add a spinner" is not the answer
 * to it: a spinner says a thing is happening and nothing about what or how
 * much is left.
 *
 * So this counts real events and only real events. The bakes are the four
 * machine meshes the building mounts, and the count is the one lib/bake.js
 * keeps -- files asked for against files landed, not a percentage anybody
 * invented. The frame is the first one three actually draws. Neither is a
 * timer and neither is smoothed.
 *
 * The markup is static in index.html rather than rendered here, because
 * anything React renders arrives after the bundle has parsed, which is most
 * of the wait this is for. The stylesheet is render-blocking and lands with
 * the document, so the door is on screen at first paint -- 128 ms on this
 * project's own headless harness against a canvas that has yet to exist.
 */
const el = typeof document !== "undefined" ? document.getElementById("door") : null;
const steps = el ? Array.from(el.querySelectorAll("[data-step]")) : [];
const of = (name) => steps.find(s => s.dataset.step === name);

/* Which way they went last time, so coming back is not being asked the same
   question again. Only the building is remembered: somebody who chose the
   document left for another page and will arrive at that page directly next
   time, so there is nothing here to remember on their behalf. */
const CHOSE = "lab-door";
const remembered = (() => {
  try { return localStorage.getItem(CHOSE); } catch (e) { return null; }
})();

let drawn = false;
let shut = false;
let offered = false;

function mark(node, state, note) {
  if (!node) return;
  if (node.dataset.state !== state) node.dataset.state = state;
  const slot = node.querySelector("[data-note]");
  if (slot && slot.textContent !== note) slot.textContent = note;
}

/* Removed rather than hidden, so nothing about it can take a pointer event or
   a tab stop once it is gone. The delay is the stylesheet's own transition;
   under prefers-reduced-motion the rule is zero and this is a tick. */
function lift() {
  if (!el || shut) return;
  shut = true;
  el.dataset.state = "shut";
  const gone = () => { if (el.parentNode) el.parentNode.removeChild(el); };
  setTimeout(gone, matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 420);
}

/* Offer the fork, and never before both halves are in: a door that opens on
 * the first frame shows a building with no machines in it, which is the same
 * blank page one step later, and a button that says "walk the building"
 * before there is one moves the wait to after the click where nothing
 * explains it.
 *
 * The seconds somebody spends reading two labels are the only free time this
 * page gets, so the physics download starts here -- sim/engine.js's warm(),
 * which fetches the engine without releasing the cells to compile against
 * it. By the time they click, the 2.5 MB is in the page.
 */
function offer() {
  if (offered) return;
  offered = true;
  warm();
  if (remembered === "walk") { el.dataset.mode = "straight"; lift(); return; }
  el.dataset.mode = "ready";
  const pick = el.querySelector(".door-pick");
  if (pick) pick.hidden = false;
  const go = el.querySelector('[data-pick="walk"]');
  if (go) { go.focus({ preventScroll: true }); go.addEventListener("click", walk); }
}

function walk() {
  try { localStorage.setItem(CHOSE, "walk"); } catch (e) { /* private mode */ }
  lift();
}

function check() {
  if (!el || shut || offered) return;
  const { landed, want } = asked();
  mark(of("machines"), want && landed >= want ? "done" : "now",
       want ? landed + " of " + want : "");
  mark(of("building"), drawn ? "done" : "now", "");
  if (!drawn || !want || landed < want) return;
  offer();
}

/* Called from inside the render loop the first time a frame has been drawn.
   Not from onCreated: a created renderer is a context, not a picture. */
export function firstFrame() {
  if (drawn) return;
  drawn = true;
  check();
}

if (el) {
  watchBakes(check);
  check();
  /* And a floor under the whole thing. A bake that 404s never lands, and a
     reader should not be held at a door by a file that is never coming --
     bake.js counts a failure as settled for exactly this reason, but a
     network that hangs rather than fails is not settled at all. Twenty
     seconds is long enough that nothing healthy hits it.
   
     It offers the choice rather than lifting the door: on a connection this
     slow the one thing a reader definitely wants is the page that is four
     kilobytes, and dropping them into a half-built building instead is the
     wrong end of the fork to pick for them. */
  setTimeout(() => { if (!shut) offer(); }, 20000);
}

/* One call, from inside the loop, on the frame after the first one has
   actually been drawn. Mounted last in the Canvas so it runs after
   everything else in the tree has had its turn. */
export function Doorman() {
  useFrame(firstFrame);
  return null;
}
