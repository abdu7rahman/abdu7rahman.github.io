/* Entry point. Boots the world, or does not, and either way the page works.
 *
 * Every reason not to run -- no WebGL, motion turned down, a context that
 * fails to come up -- leaves the document exactly as it was. The canvas is an
 * environment for the page, not a replacement for it.
 */
import { boot } from "./world.js";
import * as hero from "./formations/hero.js";
import * as work from "./formations/work.js";
import * as measured from "./formations/measured.js";
import * as path from "./formations/path.js";
import * as contact from "./formations/contact.js";

const formations = { hero, work, measured, path, contact };

(async function () {
  if (!document.body.classList.contains("home")) return;
  const mount = document.getElementById("world-mount");
  if (!mount) return;
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
