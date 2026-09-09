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
  build: {
    outDir: "dist",
    emptyOutDir: true,
    assetsDir: "assets",
    target: "es2022"
  }
});
