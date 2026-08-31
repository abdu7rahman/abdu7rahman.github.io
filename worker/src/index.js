/* The router.
 *
 * Two audiences, and the split between them is the whole security model:
 *
 *   POST /e         the public site, write only, never reads anything back
 *   everything else the dashboard, and nothing under it runs before the
 *                   session cookie has been checked
 *
 * Nothing serves the numbers to an unauthenticated caller, which is the part
 * a static page could not do. The counters are no longer readable by anyone
 * who knows a URL.
 */
import { currentAdmin, login, callback, logout } from "./auth.js";
import { ingest, preflight, prune, sweep } from "./ingest.js";
import { stats } from "./stats.js";
import { comment, comments } from "./comments.js";
import { dashboard, signedOut } from "./dashboard.js";

const SECURITY = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
  // The dashboard is served from this worker and loads nothing from anywhere
  // else, so the policy can be closed almost completely.
  "content-security-policy":
    "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; " +
    "connect-src 'self'; img-src data:; base-uri 'none'; form-action 'none'",
};

const html = (body, status = 200) =>
  new Response(body, { status, headers: { ...SECURITY, "content-type": "text/html; charset=utf-8" } });

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...SECURITY, "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (path === "/e") {
      if (req.method === "OPTIONS") return preflight(req, env);
      if (req.method === "POST") return ingest(req, env);
      return new Response("method not allowed\n", { status: 405 });
    }

    // The second public door. Same origin rule, much tighter limits -- see
    // comments.js for why it is treated as the more dangerous of the two.
    if (path === "/c") {
      if (req.method === "OPTIONS") return preflight(req, env);
      if (req.method === "POST") return comment(req, env);
      return new Response("method not allowed\n", { status: 405 });
    }

    if (!env.SESSION_SECRET || !env.GITHUB_CLIENT_ID) {
      return html("<h1>Not configured</h1><p>Set GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET and " +
        "SESSION_SECRET before using this. See worker/README.md.</p>", 503);
    }

    if (path === "/login") return login(req, env);
    if (path === "/callback") return callback(req, env);
    if (path === "/logout") return logout();

    const admin = await currentAdmin(req, env);

    if (path === "/api/stats") {
      if (!admin) return json({ error: "not signed in" }, 401);
      return json(await stats(env, url.searchParams.get("days"),
                              url.searchParams.get("bots") === "1"));
    }

    if (path === "/api/comments") {
      if (!admin) return json({ error: "not signed in" }, 401);
      return json(await comments(env, url.searchParams.get("limit")));
    }

    if (path === "/") {
      return admin ? html(dashboard(admin)) : html(signedOut(), 401);
    }

    return new Response("not found\n", { status: 404, headers: SECURITY });
  },

  // Retention is a cron rather than a check on the write path, so a slow
  // delete can never sit in front of a reader's page load.
  async scheduled(_event, env, ctx) {
    // sweep before prune: it reconsiders the bot flag from behaviour, and
    // there is no point deciding what to delete before deciding what is what.
    ctx.waitUntil(sweep(env).then(() => prune(env)));
  },
};
