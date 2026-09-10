import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/* Built into the repo root, because that is what GitHub Pages serves for a
   user site and there is no build step in front of it. Not yet, though:
   outDir stays inside app/ until the lab is worth replacing the site with,
   and the switch is this one line. emptyOutDir matters when it moves -- the
   root carries demo.html, the worker, the assets and the whole vanilla site,
   and Vite's default is to wipe the directory it writes to. */
export default defineConfig({
  base: "/",
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
  /* The lab is the site now. index.html at the root is this build's output;
     the written site it grew out of is written.html beside it, still whole,
     still the source every word and number in the lab is baked from. */
  build: {
    outDir: "..",
    // Never true here. The root is not a build directory -- it carries
    // written.html, demo.html, the worker, the assets and the whole
    // vanilla site, and Vite wipes the directory it writes into.
    emptyOutDir: false,
    // Not "assets": that directory already exists and holds the baked
    // robots and the social card. Keeping the bundle separate means a
    // build can never be confused for content.
    //
    // Because emptyOutDir is off, nothing here removes the previous
    // bundle -- Vite writes a new content-hashed name and leaves the old
    // one on disk, and eight dead 1.2 MB bundles had already been
    // committed before anybody noticed. package.json's prebuild script
    // clears this directory, which is safe precisely because it is
    // Vite's and nothing else writes into it. Build with npm run build,
    // not npx vite build, or the prebuild does not fire.
    assetsDir: "build",
    target: "es2022"
  }
});
