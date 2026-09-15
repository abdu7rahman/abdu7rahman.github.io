/* The building, kept, so the second visit is not the first one again.
 *
 * GitHub Pages sends `cache-control: max-age=600` on everything it serves and
 * gives you no way to change that -- measured on this site rather than looked
 * up: the 1.3 MB bundle, the 1.1 MB humanoid and the 9.8 MB physics engine
 * all come back with the same ten minutes on them. So a reader who comes back
 * the next day revalidates twelve megabytes of content that is, by
 * construction, incapable of having changed: the build chunks carry a content
 * hash in their own names, and the baked robots and the vendored engine are
 * pinned files that a commit replaces rather than edits.
 *
 * This is the only place that can be fixed from, which is why there is a
 * service worker on a static site at all.
 *
 * What it will and will not do:
 *
 *   - Cache-first for /build/, /assets/ and /vendor/ and nothing else. Those
 *     three are the twelve megabytes and they are immutable in the only sense
 *     that matters -- the bytes at a given path do not change without a
 *     deploy. Everything else, including the two pages, both root scripts and
 *     every cross-origin call, goes straight to the network and is not
 *     touched. That is deliberate beyond caution: the analytics beacon and
 *     the visit counter have tests that assert on what reaches the network,
 *     and a cache that quietly answered for them would be a cache that
 *     falsified its own gates.
 *
 *   - Never HTML. A service worker that can serve a stale document is a
 *     service worker that can strand a reader on a build from last month with
 *     no way to ask for a new one, and the usual answer -- network-first with
 *     a cache fallback -- still leaves the stale copy in play. The pages are
 *     4 and 43 KB. They are not worth the class of bug.
 *
 * The build cache is keyed on the hashed chunk name the page was served with,
 * so a deploy gets a new cache and the old one is deleted on activate. The
 * asset cache is not: the robots and the engine are the expensive half and
 * they survive deploys, which is the entire point.
 *
 * What it does not reach, measured rather than assumed: the cell monitors run
 * the document site's own demos inside iframes that bays/runtime.js builds
 * from a parsed document rather than from a URL, and a document like that is
 * not controlled by a service worker -- so its fetches go straight to the
 * network and are never cached. On a second visit that is one file,
 * assets/ur12e.json, and 72 KB against the first visit's 3,868. Left alone:
 * the fix would be to change how the monitors are built, and a 2 per cent
 * remainder is not a reason to do that.
 */
const V = new URL(self.location.href).searchParams.get("v") || "0";
const BUILD = "lab-build-" + V;
const KEEP = "lab-assets-v1";
const MINE = new Set([BUILD, KEEP]);

/* Path prefixes that are safe to answer from a cache, and the reason each one
   is safe is that its bytes cannot change without the URL changing or a
   deploy happening. */
const KEPT = ["/assets/", "/vendor/"];
const BUILT = ["/build/"];
const under = (p, list) => list.some(pre => p.startsWith(pre));

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith("lab-") && !MINE.has(name)) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  let url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return;

  const build = under(url.pathname, BUILT);
  if (!build && !under(url.pathname, KEPT)) return;

  e.respondWith((async () => {
    const jar = await caches.open(build ? BUILD : KEEP);
    const hit = await jar.match(req);
    if (hit) return hit;
    const res = await fetch(req);
    /* Only a clean answer, and only a whole one. A 206 from a range request
       cannot be replayed as a 200 and an opaque response has no status to
       check, so neither is worth keeping. */
    if (res && res.status === 200 && res.type === "basic") {
      jar.put(req, res.clone()).catch(() => {});
    }
    return res;
  })());
});
