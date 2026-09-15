/* Register the keeper, and key it to this build.
 *
 * The version in the query string is the content hash Vite already put in the
 * bundle's own file name, read back off the script tag that loaded this code.
 * That means the registration URL changes exactly when the build changes,
 * which is what makes the browser fetch a new worker and what lets the worker
 * name its own cache without anything in the build having to write a version
 * number anywhere.
 *
 * Late, and on purpose. Registering during startup puts a worker install on
 * the same main thread that is compiling shaders and building a thousand
 * objects, and the first visit is the one that cannot spare it -- the worker
 * is for the second. `load` plus an idle callback is after the frame that
 * matters.
 */
export function keep() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  /* file:// has no service workers and neither does an insecure origin, and
     both throw rather than returning false. */
  if (!self.isSecureContext) return;

  const tag = document.querySelector('script[type="module"][src*="/build/"]');
  const m = tag && tag.getAttribute("src").match(/index-([A-Za-z0-9_-]+)\./);
  const v = m ? m[1] : "dev";

  const go = () => navigator.serviceWorker.register("/sw.js?v=" + v).catch(() => {});
  const idle = () => (window.requestIdleCallback
    ? window.requestIdleCallback(go, { timeout: 4000 })
    : setTimeout(go, 1200));
  if (document.readyState === "complete") idle();
  else window.addEventListener("load", idle, { once: true });
}
