/* Entry point. Boots the world, or does not, and either way the page works.
 *
 * Every reason not to run -- no WebGL, motion turned down, a software
 * rasteriser, a context that fails to come up -- leaves the document exactly
 * as it was. The canvas is an environment for the page, not a replacement
 * for it.
 *
 * The formations are loaded one at a time and a missing one is survivable:
 * the station falls back to its neighbour's shape, which costs that crossing
 * its transformation and costs the page nothing. A landing page that will not
 * render because one of seven point clouds is absent is a worse trade than a
 * crossing that does not morph.
 */
import { boot } from "./world.js";
import { STATIONS } from "./config.js";

(async function () {
  if (!document.body.classList.contains("home")) return;
  const mount = document.getElementById("world-mount");
  if (!mount) return;

  const formations = {};
  let last = null;
  for (const st of STATIONS) {
    try {
      const mod = await import(`./formations/${st.id}.js`);
      if (mod && mod.build) { formations[st.id] = mod; last = mod; continue; }
    } catch (e) {
      if (window.console) console.warn("world: no formation for " + st.id);
    }
    if (last) formations[st.id] = last;
  }
  // A station earlier than the first one that loaded borrows forwards instead.
  for (let i = STATIONS.length - 1; i >= 0; i--)
    if (!formations[STATIONS[i].id] && formations[STATIONS[i + 1] && STATIONS[i + 1].id])
      formations[STATIONS[i].id] = formations[STATIONS[i + 1].id];

  try {
    const world = await boot(mount, formations);
    if (world) {
      document.body.classList.add("has-world");
      document.body.dataset.tier = world.cap.tier;
    }
  } catch (e) {
    // A world that throws is a world that does not appear. The page is still
    // a page.
    if (window.console) console.warn("world: not started —", e && e.message);
  }
})();
