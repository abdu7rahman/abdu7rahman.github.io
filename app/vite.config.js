import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/* Built into the repo root, because that is what GitHub Pages serves for a
   user site and there is no build step in front of it. Not yet, though:
   outDir stays inside app/ until the lab is worth replacing the site with,
   and the switch is this one line. emptyOutDir matters when it moves -- the
   root carries demo.html, the worker, the assets and the whole vanilla site,
   and Vite's default is to wipe the directory it writes to. */
export default defineConfig({
  base: "./",
  plugins: [react()],
  /* The kinematics are imported from world/, not copied into app/.
     world/kinematics.js is the measured UR12e -- link frames, poseAt,
     toolPoint -- and it is what the document site's arm, its reachable-set
     formation and the hero cell all solve against. A second copy in here
     would be a second thing to drift, which is the failure this repository
     has hit more than any other. Vite refuses to serve outside its root by
     default, so the parent is allowed explicitly. */
  server: { fs: { allow: [".", ".."] } },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    assetsDir: "assets",
    target: "es2022"
  }
});
