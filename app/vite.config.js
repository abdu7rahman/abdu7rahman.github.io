import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/* Built into the repo root, because that is what GitHub Pages serves for a
   user site and there is no build step in front of it. Not yet, though:
   outDir stays inside app/ until the lab is worth replacing the site with,
   and the switch is this one line. emptyOutDir matters when it moves -- the
   root carries demo.html, the worker, the assets and the whole vanilla site,
   and Vite's default is to wipe the directory it writes to. */
export default defineConfig({
  base: "/lab/",
  plugins: [react()],
  /* The kinematics are imported from world/, not copied into app/.
     world/kinematics.js is the measured UR12e -- link frames, poseAt,
     toolPoint -- and it is what the document site's arm, its reachable-set
     formation and the hero cell all solve against. A second copy in here
     would be a second thing to drift, which is the failure this repository
     has hit more than any other. Vite refuses to serve outside its root by
     default, so the parent is allowed explicitly. */
  server: { fs: { allow: [".", ".."] } },
  /* One three, not two. world/kinematics.js sits outside the app root and
     resolving "three" from there gave a second copy -- three prints
     "Multiple instances of Three.js being imported" when that happens, and
     the failure mode is silent and confusing: instanceof stops working
     across the boundary, so a matrix built by one copy is not a Matrix4 to
     the other. */
  resolve: { dedupe: ["three"] },
  /* Served from /lab/ for now, beside the document site rather than instead
     of it. GitHub Pages serves this repository's root and the root is the
     written site, which works; replacing it with a building that is still
     being built would be trading something finished for something that is
     not. When the lab is ready this becomes base "/" and outDir "..", and the
     emptyOutDir below has to go with it -- the root carries demo.html, the
     worker, the assets and the whole vanilla site, and Vite's default is to
     wipe whatever directory it writes into. */
  build: {
    outDir: "../lab",
    emptyOutDir: true,
    assetsDir: "assets",
    target: "es2022"
  }
});
