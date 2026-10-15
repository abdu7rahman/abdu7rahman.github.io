/* Retires the service worker the WebGL building installed.
 *
 * The building registered /sw.js?v=<hash> at scope / and answered /assets/,
 * /vendor/ and /build/ cache-first, with the asset cache deliberately kept
 * across deploys. The building is gone, but a browser that visited it still
 * has that worker, and it would keep handing out the old bytes for any file
 * under /assets/ or /vendor/ that changes from here on.
 *
 * A worker cannot be removed by deleting its script: a failed update check
 * leaves the installed one running. So this file stays at the same path. The
 * next navigation's update check fetches it, sees different bytes, installs
 * it, and it deletes every cache the building made and unregisters itself.
 * It has no fetch handler, so nothing it controls in the meantime is
 * answered from a cache. Nothing on the site registers it any more.
 */
self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith("lab-")) await caches.delete(name);
    }
    await self.registration.unregister();
  })());
});
