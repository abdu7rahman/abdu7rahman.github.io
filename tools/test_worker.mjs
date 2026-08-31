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
    ok("an absurd window is clamped", silly.window.days === 3650, JSON.stringify(silly.window));
  }

  console.log("\nF. history is kept, and returning readers are visible");
  {
    const cookie = "admin_session=" + await session({ login: "abdu7rahman", id: 78921503, exp: Date.now() + 3e5 });

    // The same browser twice is one visitor now. Under the old daily-rotating
    // salt this was unanswerable by construction.
    await send([ev("s4", "pageview", { path: "/" })], { ua: "reader-a" });
    const s = await (await fetch(BASE + "/api/stats?days=30", { headers: { cookie } })).json();
    ok("a repeat browser is not a new visitor", s.totals.visitors === 3, String(s.totals.visitors));
    ok("but it is a new visit", s.totals.visits === 4, String(s.totals.visits));

    const all = await (await fetch(BASE + "/api/stats?days=all", { headers: { cookie } })).json();
    ok("days=all is unbounded", all.window.all === true && all.window.days === 0, JSON.stringify(all.window));
    ok("all time sees everything", all.totals.visits === 4, String(all.totals.visits));
    ok("the span reports the data it has", !!all.window.first && all.window.daysWithData >= 1, JSON.stringify(all.window));
    ok("visitors ever is reported", all.window.visitorsEver === 3, String(all.window.visitorsEver));

    // Nobody has been here on two different days, so nobody is returning yet.
    ok("returning is 0 on one day of data", all.totals.returning === 0, String(all.totals.returning));
    ok("and the regulars table is empty", Array.isArray(all.loyal) && all.loyal.length === 0, JSON.stringify(all.loyal));
    ok("the network breakdown exists", Array.isArray(all.orgs), JSON.stringify(all.orgs));
  }

  console.log("\nH. comments");
  {
    const cookie = "admin_session=" + await session({ login: "abdu7rahman", id: 78921503, exp: Date.now() + 3e5 });
    const say = (payload, { origin = ORIGIN, ua = "commenter" } = {}) =>
      fetch(BASE + "/c", {
        method: "POST",
        headers: { "content-type": "application/json", origin, "user-agent": ua },
        body: JSON.stringify(payload),
      });

    ok("wrong origin is refused", (await say({ body: "hi" }, { origin: "https://evil.example" })).status === 403);
    ok("GET /c is 405", (await fetch(BASE + "/c")).status === 405);
    ok("an empty comment is refused", (await say({ body: "   " })).status === 400, "");
    ok("no body at all is refused", (await say({ name: "x" })).status === 400, "");

    // A filled honeypot gets a 200 that looks like success, so a bot learns
    // nothing from the response about why nothing happened.
    ok("a filled honeypot looks like success", (await say({ body: "spam", website: "http://x" })).status === 200);

    const r = await say({ body: "  This is a real note.  ", name: " Ada ", contact: "ada@example.com" });
    ok("a real comment is accepted", r.status === 201, String(r.status));

    // The one that matters: this lands in the admin's own privileged page.
    const nasty = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
    ok("a script payload is accepted as text", (await say({ body: nasty, name: "<b>bold</b>" })).status === 201);

    ok("/api/comments needs a session", (await fetch(BASE + "/api/comments")).status === 401);

    const list = await (await fetch(BASE + "/api/comments", { headers: { cookie } })).json();
    ok("both comments come back", list.length === 2, String(list.length));
    ok("newest first", list[0].body === nasty, JSON.stringify(list[0].body));
    ok("the honeypot one was never stored", !list.some(c => c.body === "spam"), JSON.stringify(list.map(c => c.body)));

    const real = list.find(c => c.name === "Ada");
    ok("whitespace is trimmed", real && real.body === "This is a real note.", JSON.stringify(real && real.body));
    ok("contact is kept", real && real.contact === "ada@example.com", JSON.stringify(real && real.contact));
    ok("the payload is stored verbatim, not sanitised on the way in",
      list[0].body === nasty, "stored: " + JSON.stringify(list[0].body));

    // ... and escaped on the way out, which is where it counts.
    const dash = await (await fetch(BASE + "/", { headers: { cookie } })).text();
    ok("the dashboard ships an escaper", dash.includes("&amp;lt;") || dash.includes('"<":"&lt;"'), "no esc map found");

    // The comment author's own history is joined in, so a note can be read
    // next to what that reader actually did.
    ok("visitor history is joined onto the comment",
      typeof list[0].visitor_days === "number" && typeof list[0].visitor_demos === "number",
      JSON.stringify({ d: list[0].visitor_days, m: list[0].visitor_demos }));

    let last = 0;
    for (let i = 0; i < 8; i++) {
      last = (await say({ body: "flood " + i }, { ua: "flooder-c" })).status;
      if (last === 429) break;
    }
    ok("comments have their own, tighter rate limit", last === 429, "last=" + last);
  }

  console.log("\nI. crawlers are flagged, not counted");
  {
    const cookie = "admin_session=" + await session({ login: "abdu7rahman", id: 78921503, exp: Date.now() + 3e5 });
    const human = await (await fetch(BASE + "/api/stats?days=all", { headers: { cookie } })).json();
    const before = human.totals.visits;

    // Something that says what it is. This is the reliable signal: a crawler
    // that does not run JavaScript never reaches the collector at all, so the
    // ones left to catch are the ones driving a real browser engine.
    ok("a self-identifying bot is accepted", (await send([
      ev("crawl-1", "pageview", { path: "/" }),
    ], { ua: "Mozilla/5.0 (compatible; SomeBot/1.0; +http://example.com/bot)" })).status === 204);

    ok("so is a headless browser", (await send([
      ev("crawl-2", "pageview", { path: "/" }),
    ], { ua: "Mozilla/5.0 HeadlessChrome/120.0.0.0" })).status === 204);

    const after = await (await fetch(BASE + "/api/stats?days=all", { headers: { cookie } })).json();
    ok("but neither is counted as a visit", after.totals.visits === before,
       before + " -> " + after.totals.visits);
    ok("and the crawler table names them", after.crawlers.length >= 1, JSON.stringify(after.crawlers));
    ok("with a reason attached", after.crawlers.every(c => !!c.why), JSON.stringify(after.crawlers.map(c => c.why)));

    // Nothing is deleted -- asking for them puts them back, because the
    // hosting heuristic can be wrong about a person.
    const withBots = await (await fetch(BASE + "/api/stats?days=all&bots=1", { headers: { cookie } })).json();
    ok("bots=1 counts them again", withBots.totals.visits === before + 2,
       before + " + 2 -> " + withBots.totals.visits);
    ok("and the window says which mode it is in",
       withBots.window.withBots === true && after.window.withBots === false,
       JSON.stringify([after.window.withBots, withBots.window.withBots]));

    ok("a plain browser is not flagged", (await send([
      ev("real-1", "pageview", { path: "/", ref: "linkedin.com/feed" }),
    ], { ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15" })).status === 204);
    const now = await (await fetch(BASE + "/api/stats?days=all", { headers: { cookie } })).json();
    ok("and is counted", now.totals.visits === before + 1, before + " + 1 -> " + now.totals.visits);

    console.log("\nJ. referrers");
    const li = now.refs.find(r => r.ref === "linkedin.com/feed");
    ok("a referrer is recorded", !!li, JSON.stringify(now.refs));
    ok("a visit with none is called direct", now.refs.some(r => r.ref === "(direct)"),
       JSON.stringify(now.refs.map(r => r.ref)));

    // The client strips the query string before sending, but the column is
    // capped here too so a hand-rolled POST cannot stuff it.
    await send([ev("real-2", "pageview", { path: "/", ref: "x".repeat(200) })],
               { ua: "Mozilla/5.0 (X11; Linux x86_64) Safari/537.36" });
    const capped = await (await fetch(BASE + "/api/stats?days=all", { headers: { cookie } })).json();
    ok("an overlong referrer is truncated, not rejected",
       capped.refs.some(r => r.ref.length === 64), JSON.stringify(capped.refs.map(r => r.ref.length)));

    // ref only means anything on a pageview.
    await send([ev("real-3", "outbound", { label: "github.com", ref: "should-be-ignored" })],
               { ua: "Mozilla/5.0 (X11; Linux x86_64) Safari/537.36" });
    const ign = await (await fetch(BASE + "/api/stats?days=all", { headers: { cookie } })).json();
    ok("a referrer on a non-pageview is dropped",
       !ign.refs.some(r => r.ref === "should-be-ignored"), JSON.stringify(ign.refs.map(r => r.ref)));
  }

  console.log("\nK. a privacy relay is not a datacenter");
  {
    // iCloud Private Relay egresses through Cloudflare, Akamai and Fastly, and
    // Cloudflare is also WARP. All three were on the hosting list once, which
    // meant every iPhone reader with Private Relay on -- the default for iCloud+
    // -- was quietly filed as a crawler. Hiding a real reader is a far worse
    // error than counting a scanner, so these must never be flagged on network
    // alone. There is no cf.asOrganization to set from a test client, so this
    // asserts the list itself.
    const src = await import("node:fs").then(fs =>
      fs.readFileSync(new URL("../worker/src/ingest.js", import.meta.url), "utf8"));
    const list = src.slice(src.indexOf("const HOSTING = ["), src.indexOf("];", src.indexOf("const HOSTING = [")));
    for (const relay of ["cloudflare", "akamai", "fastly"]) {
      ok(`${relay} is not treated as hosting`, !list.includes(`"${relay}"`), list.replace(/\s+/g, " "));
    }
    for (const cloud of ["amazon", "azure", "digitalocean"]) {
      ok(`${cloud} still is`, list.includes(`"${cloud}"`));
    }
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
