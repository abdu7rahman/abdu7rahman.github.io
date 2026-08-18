/* Drives a running `wrangler dev` through everything the worker does, against
 * a real local D1. Start it first:
 *
 *   cd worker && npm install
 *   npx wrangler d1 execute portfolio-analytics --local --file=schema.sql
 *   npm run dev
 *   node ../tools/test_worker.mjs
 *
 * It asserts exact totals, so it needs an empty table to start from. If it has
 * been run before, or the database has been seeded:
 *
 *   npx wrangler d1 execute portfolio-analytics --local \
 *     --command "DELETE FROM event; DELETE FROM quota;"
 *
 * The one thing it cannot exercise is the GitHub round trip itself, which
 * needs a real OAuth app. Everything on this side of it is covered: the
 * session cookie is minted here with the same HMAC the worker verifies, so the
 * authenticated paths are tested without GitHub being involved at all.
 */
const BASE = process.env.BASE || "http://127.0.0.1:8788";
const SECRET = process.env.SESSION_SECRET || "test-session-secret-do-not-use-in-production";
const ORIGIN = "https://abdu7rahman.github.io";

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") =>
  cond ? (pass++, console.log("  PASS  " + name))
       : (fail++, console.log("  FAIL  " + name + (detail ? "  <- " + detail : "")));

const enc = new TextEncoder();
const b64url = b => Buffer.from(b).toString("base64")
  .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function session(claims) {
  const key = await crypto.subtle.importKey("raw", enc.encode(SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const body = b64url(enc.encode(JSON.stringify(claims)));
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(body));
  return body + "." + b64url(new Uint8Array(mac));
}

const send = (events, { origin = ORIGIN, ua = "test-agent", raw = null } = {}) =>
  fetch(BASE + "/e", {
    method: "POST",
    headers: { "content-type": "application/json", origin, "user-agent": ua },
    body: raw === null ? JSON.stringify(events) : raw,
  });

const ev = (session, kind, extra = {}) => ({ session, kind, ...extra });

(async () => {
  console.log("\nA. the door is shut");
  {
    const r1 = await fetch(BASE + "/");
    ok("GET / is 401 when signed out", r1.status === 401, String(r1.status));
    const body = await r1.text();
    ok("and offers GitHub sign-in", body.includes("/login") && body.includes("Sign in with GitHub"));
    ok("and is noindex", body.includes("noindex"));

    const r2 = await fetch(BASE + "/api/stats");
    ok("GET /api/stats is 401 when signed out", r2.status === 401, String(r2.status));
    ok("and leaks no numbers", !(await r2.text()).includes("visits"));

    const r3 = await fetch(BASE + "/api/stats", { headers: { cookie: "admin_session=garbage" } });
    ok("a garbage cookie is 401", r3.status === 401, String(r3.status));

    const tampered = (await session({ login: "abdu7rahman", id: 78921503, exp: Date.now() + 3e5 }))
      .replace(/.$/, c => (c === "A" ? "B" : "A"));
    const r4 = await fetch(BASE + "/api/stats", { headers: { cookie: "admin_session=" + tampered } });
    ok("a tampered signature is 401", r4.status === 401, String(r4.status));

    const expired = await session({ login: "abdu7rahman", id: 78921503, exp: Date.now() - 1000 });
    const r5 = await fetch(BASE + "/api/stats", { headers: { cookie: "admin_session=" + expired } });
    ok("an expired session is 401", r5.status === 401, String(r5.status));

    // A valid signature with someone else's name still verifies as a
    // signature, so this only passes because nothing downstream trusts it to
    // be the right person -- the login check happens before the cookie exists.
    const r6 = await fetch(BASE + "/callback?code=x&state=y");
    ok("callback without matching state is 400", r6.status === 400, String(r6.status));
  }

  console.log("\nB. the collector door only opens for the site");
  {
    ok("wrong origin is refused", (await send([ev("s0", "pageview")], { origin: "https://evil.example" })).status === 403);
    ok("no origin is refused", (await send([ev("s0", "pageview")], { origin: "" })).status === 403);
    ok("GET /e is 405", (await fetch(BASE + "/e")).status === 405);
    ok("bad json is 400", (await send(null, { raw: "{oops" })).status === 400);
    ok("a bare object is 400", (await send({ kind: "pageview" })).status === 400);
    ok("an empty array is 400", (await send([])).status === 400);
    ok("an oversized body is 413", (await send(null, { raw: JSON.stringify([{ x: "z".repeat(9000) }]) })).status === 413);
    ok("an unknown kind is dropped", (await send([ev("s0", "rm -rf")])).status === 400);
    ok("an event with no session is dropped", (await send([{ kind: "pageview" }])).status === 400);
  }

  console.log("\nC. three readers, doing different things");
  {
    // Distinct user agents so the daily hash differs -- same address, but the
    // hash is over both, which is what makes three visitors here.
    const A = "reader-a", B = "reader-b", C = "reader-c";
    let r = await send([
      ev("s1", "pageview", { path: "/" }),
      ev("s1", "pageview", { path: "/demo.html" }),
      ev("s1", "demo_start", { label: "chase" }),
      ev("s1", "demo_done", { label: "chase", ms: 12000 }),
      ev("s1", "outbound", { label: "github.com/x" }),
      ev("s1", "session_end", { ms: 45000 }),
    ], { ua: A });
    ok("a full session is accepted", r.status === 204, String(r.status));

    r = await send([ev("s2", "pageview", { path: "/" }), ev("s2", "session_end", { ms: 3000 })], { ua: B });
    ok("a bounce is accepted", r.status === 204, String(r.status));

    r = await send([
      ev("s3", "pageview", { path: "/demo.html" }),
      ev("s3", "demo_start", { label: "race" }),
      ev("s3", "session_end", { ms: 20000 }),
    ], { ua: C });
    ok("an opened-but-not-engaged session is accepted", r.status === 204, String(r.status));
  }

  console.log("\nD. and the numbers that come back");
  {
    const cookie = "admin_session=" + await session({ login: "abdu7rahman", id: 78921503, exp: Date.now() + 3e5 });
    const res = await fetch(BASE + "/api/stats?days=30", { headers: { cookie } });
    ok("a valid session gets 200", res.status === 200, String(res.status));
    const s = await res.json();

    ok("3 visits", s.totals.visits === 3, JSON.stringify(s.totals));
    ok("3 unique visitors", s.totals.visitors === 3, String(s.totals.visitors));
    ok("4 pageviews", s.totals.views === 4, String(s.totals.views));
    ok("median engaged time is 20s", s.totals.medianDwellMs === 20000, String(s.totals.medianDwellMs));
    ok("bounce rate is 1 in 3", Math.abs(s.totals.bounceRate - 1 / 3) < 1e-9, String(s.totals.bounceRate));

    const chase = s.demos.find(d => d.label === "chase");
    const race = s.demos.find(d => d.label === "race");
    ok("chase: opened 1, engaged 1", chase && chase.starts === 1 && chase.dones === 1, JSON.stringify(chase));
    ok("chase: rate 100%, avg 12s", chase && chase.completion === 1 && chase.avg_ms === 12000, JSON.stringify(chase));
    ok("race: opened 1, engaged 0", race && race.starts === 1 && race.dones === 0, JSON.stringify(race));
    ok("race: rate 0%", race && race.completion === 0, JSON.stringify(race));

    const home = s.pages.find(p => p.path === "/");
    const demo = s.pages.find(p => p.path === "/demo.html");
    ok("/ has 2 views from 2 visits", home && home.views === 2 && home.visits === 2, JSON.stringify(home));
    ok("/demo.html has 2 views", demo && demo.views === 2, JSON.stringify(demo));
    ok("one outbound click", s.outbound.length === 1 && s.outbound[0].clicks === 1, JSON.stringify(s.outbound));
    ok("3 sessions in the recent feed", s.recent.length === 3, String(s.recent.length));
    ok("the feed names the demo that was run", s.recent.some(r => r.ran.includes("chase")), JSON.stringify(s.recent.map(r => r.ran)));
    ok("the feed carries no session id", s.recent.every(r => r.session === undefined));
    ok("the series has today in it", s.series.length >= 1 && s.series[0].visits === 3, JSON.stringify(s.series));

    const dash = await fetch(BASE + "/", { headers: { cookie } });
    const body = await dash.text();
    ok("the dashboard renders for a valid session", dash.status === 200, String(dash.status));
    ok("and names the account", body.includes("abdu7rahman"));
    ok("and is noindex", body.includes("noindex"));
    ok("and sets a strict CSP", (dash.headers.get("content-security-policy") || "").includes("default-src 'none'"));
    ok("and refuses to be framed", dash.headers.get("x-frame-options") === "DENY");

    const week = await (await fetch(BASE + "/api/stats?days=7", { headers: { cookie } })).json();
    ok("the window is honoured", week.window.days === 7, JSON.stringify(week.window));
    const silly = await (await fetch(BASE + "/api/stats?days=99999", { headers: { cookie } })).json();
    ok("an absurd window is clamped", silly.window.days === 365, JSON.stringify(silly.window));
  }

  console.log("\nE. a stuck loop gets throttled");
  {
    const ua = "flooder";
    let last = 0, sent = 0;
    for (let i = 0; i < 70; i++) {
      last = (await send([ev("flood", "pageview", { path: "/" })], { ua })).status;
      if (last === 204) sent++; else break;
    }
    ok("rate limit trips", last === 429, "last=" + last + " after " + sent);
    ok("and it trips near the limit, not before", sent >= 55 && sent <= 61, "sent=" + sent);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
