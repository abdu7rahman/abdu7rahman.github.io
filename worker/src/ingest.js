/* POST /e -- the only endpoint the public site talks to.
 *
 * It is a write-only door, and it is treated like one. Everything a client
 * sends is either validated against a fixed whitelist or thrown away; nothing
 * from the body is trusted to be a number, a length, or even a string. The
 * fields that matter for honesty -- when it happened, where from, who it was
 * -- are assigned here, because a client that can set its own timestamp can
 * write whatever history it likes.
 */

const KINDS = new Set(["pageview", "demo_start", "demo_done", "outbound", "session_end"]);

/* Two ways of recognising something that is not a reader.
 *
 * The first is what it calls itself. Most crawlers say so in the user-agent,
 * and the headless signatures are here too because the scanners that matter
 * now render JavaScript -- a crawler that does not execute the collector never
 * reaches this code at all, so the ones left to catch are precisely the ones
 * driving a real browser engine.
 *
 * The second is the network it came over, and it is the weaker of the two by a
 * long way. It cannot distinguish an Azure link scanner from somebody at
 * Microsoft reading this at work, and on a portfolio the second is the most
 * interesting visitor there is. So it is recorded as its own reason, and the
 * dashboard can be told to put those rows back. */
const BOT_UA = /bot\b|bots\b|crawl|spider|slurp|scrape|headless|phantomjs|puppeteer|playwright|selenium|lighthouse|curl\/|wget|python-requests|okhttp|java\/|go-http|libwww|httpclient|axios\/|node-fetch|preview|scanner|monitor|uptime|pingdom|statuscake|ahrefs|semrush|mj12|dotbot|petalbot|bytespider|facebookexternalhit|whatsapp|telegram|slackbot|discord|embedly|proofpoint|barracuda|mimecast|safelinks/i;

// Substring match against Cloudflare's asOrganization. Deliberately the big
// hosts only: a wrong guess here hides a real person.
const HOSTING = [
  "amazon", "aws", "microsoft", "azure", "google cloud", "googlebot", "digitalocean",
  "linode", "akamai", "fastly", "cloudflare", "hetzner", "ovh", "scaleway", "vultr",
  "choopa", "contabo", "leaseweb", "m247", "datacamp", "oracle", "alibaba", "tencent",
  "huawei cloud", "ibm cloud", "rackspace", "hostinger", "namecheap", "godaddy",
];

function botVerdict(ua, org, cf) {
  if (BOT_UA.test(ua)) return "agent";
  // Cloudflare's own judgement, where the plan provides it.
  const bm = cf && cf.botManagement;
  if (bm && bm.verifiedBot === true) return "verified";
  const o = String(org || "").toLowerCase();
  if (o && HOSTING.some(h => o.indexOf(h) >= 0)) return "hosting";
  return null;
}
const MAX_EVENTS = 24;      // one page rarely produces more; a batch bigger than this is noise
const MAX_BODY = 8 * 1024;
const MAX_PER_MIN = 60;

const str = (v, n) => (typeof v === "string" ? v.slice(0, n) : null);

function num(v, max) {
  const x = typeof v === "number" ? v : NaN;
  if (!isFinite(x) || x < 0) return null;
  return Math.min(Math.round(x), max);
}

/* The reader's identity, stable for as long as their address and browser are.
 *
 * This used to fold the date into the hash, so the same person on two days
 * came out as two unrelated values and nothing could be followed across a day
 * boundary. That is the stricter design and it is the one that needs no
 * consent banner -- but it cannot answer "did anyone come back", which is the
 * question the dashboard is now expected to answer.
 *
 * So the date is gone and the hash is stable. Be clear about what that means:
 * this is a persistent pseudonymous identifier. It is still one-way, the
 * address is still never written down, and the salt is still secret -- without
 * it nobody can test a given address against the table. But a row from March
 * and a row from August can now be recognised as the same reader, and that is
 * tracking in the sense the word is normally used. A site doing this owes its
 * readers a line saying so.
 *
 * It changes when they change network or browser, so it drifts. It undercounts
 * returning visitors rather than over-counting them, which is the right way
 * round for a number that is about to be believed. */
export async function visitorHash(req, env) {
  const ip = req.headers.get("cf-connecting-ip") || "";
  const ua = req.headers.get("user-agent") || "";
  const data = new TextEncoder().encode(`${env.VISITOR_SALT || "salt"}|${ip}|${ua}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest).slice(0, 8)].map(b => b.toString(16).padStart(2, "0")).join("");
}

export function corsHeaders(req, env) {
  const origin = req.headers.get("origin") || "";
  const allowed = (env.SITE_ORIGIN || "").split(",").map(s => s.trim()).filter(Boolean);
  const ok = allowed.includes(origin);
  return {
    "access-control-allow-origin": ok ? origin : allowed[0] || "null",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
    vary: "origin",
    _ok: ok,
  };
}

export function preflight(req, env) {
  const h = corsHeaders(req, env);
  delete h._ok;
  return new Response(null, { status: 204, headers: h });
}

export async function ingest(req, env) {
  const h = corsHeaders(req, env);
  const allowed = h._ok;
  delete h._ok;
  const reply = (status, body) =>
    new Response(body, { status, headers: { ...h, "content-type": "text/plain" } });

  // An unknown origin gets a clean rejection rather than a silent accept, so a
  // misconfigured SITE_ORIGIN shows up as an error in the browser console
  // instead of as an empty dashboard three weeks later.
  if (!allowed) return reply(403, "origin not allowed\n");

  const raw = await req.text();
  if (raw.length > MAX_BODY) return reply(413, "too large\n");

  let batch;
  try { batch = JSON.parse(raw); } catch { return reply(400, "bad json\n"); }
  if (!Array.isArray(batch) || !batch.length) return reply(400, "expected a non-empty array\n");

  const now = Date.now();
  const day = new Date(now).toISOString().slice(0, 10);
  const visitor = await visitorHash(req, env);

  // Cheap and approximate on purpose: the point is to stop a loop hammering
  // the table, not to police anyone. The bucket dies with the minute.
  const bucket = `${visitor}:${Math.floor(now / 60000)}`;
  const seen = await env.DB.prepare(
    "INSERT INTO quota (bucket, n, ts) VALUES (?1, 1, ?2) " +
    "ON CONFLICT(bucket) DO UPDATE SET n = n + 1 RETURNING n"
  ).bind(bucket, now).first("n").catch(() => 0);
  if (seen > MAX_PER_MIN) return reply(429, "slow down\n");

  const cf = req.cf || {};
  const ua = req.headers.get("user-agent") || "";
  const device = /mobile|android|iphone|ipad/i.test(ua) ? "mobile" : "desktop";
  // Decided here and stored as a verdict. The user-agent it was decided from is
  // still not kept -- the point of reading it was to answer one question, and
  // the answer is smaller than the evidence.
  const why = botVerdict(ua, cf.asOrganization, cf);

  const rows = [];
  for (const e of batch.slice(0, MAX_EVENTS)) {
    if (!e || typeof e !== "object") continue;
    const kind = str(e.kind, 16);
    if (!KINDS.has(kind)) continue;
    const session = str(e.session, 32);
    if (!session) continue;
    rows.push([
      now, day, visitor, session, kind,
      str(e.path, 64), str(e.label, 64),
      // Six hours caps a tab left open over a weekend from landing in the
      // median as if someone really read for three days.
      num(e.ms, 6 * 60 * 60 * 1000),
      str(cf.country, 4), str(cf.region, 48), str(cf.city, 48), device,
      // The network the request arrived over. Cloudflare resolves this at the
      // edge, so it costs nothing and needs no address kept to produce it.
      str(cf.asOrganization, 64),
      why ? 1 : 0, why,
      // Sent by the client from document.referrer, already reduced to a host
      // and a short path -- see analytics.js. Only meaningful on a pageview.
      kind === "pageview" ? str(e.ref, 64) : null,
    ]);
  }
  if (!rows.length) return reply(400, "no valid events\n");

  const stmt = env.DB.prepare(
    "INSERT INTO event (ts, day, visitor, session, kind, path, label, ms, country, region, city, device, org, bot, bot_why, ref) " +
    "VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16)"
  );
  await env.DB.batch(rows.map(r => stmt.bind(...r)));

  return reply(204, null);
}

/* Retention. RETENTION_DAYS = 0 means keep everything, which is what this is
 * set to: the whole point of the dashboard is the long view, and a window that
 * silently drops the far end makes year-over-year a lie.
 *
 * The quota table is always swept regardless -- those rows are rate-limiting
 * scratch with an hour of usefulness in them, and nothing is learned by
 * keeping them. */
export async function prune(env) {
  const keepDays = Number(env.RETENTION_DAYS || 0);
  const work = [env.DB.prepare("DELETE FROM quota WHERE ts < ?1").bind(Date.now() - 3600000)];
  if (keepDays > 0) {
    const cutoff = new Date(Date.now() - keepDays * 86400000).toISOString().slice(0, 10);
    work.push(env.DB.prepare("DELETE FROM event WHERE day < ?1").bind(cutoff));
  }
  await env.DB.batch(work);
}
