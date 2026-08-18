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
const MAX_EVENTS = 24;      // one page rarely produces more; a batch bigger than this is noise
const MAX_BODY = 8 * 1024;
const MAX_PER_MIN = 60;

const str = (v, n) => (typeof v === "string" ? v.slice(0, n) : null);

function num(v, max) {
  const x = typeof v === "number" ? v : NaN;
  if (!isFinite(x) || x < 0) return null;
  return Math.min(Math.round(x), max);
}

/* The reader's identity for the day, and no longer.
 *
 * The address and the user-agent go in, a hash comes out, and neither is ever
 * written down. The salt rotates at midnight UTC, so tomorrow the same person
 * hashes to something unrelated -- there is deliberately no key that follows
 * anyone from one day to the next, which is what keeps "unique visitors"
 * answerable without keeping a record of who they were. */
async function visitorHash(req, env, day) {
  const ip = req.headers.get("cf-connecting-ip") || "";
  const ua = req.headers.get("user-agent") || "";
  const data = new TextEncoder().encode(`${env.VISITOR_SALT || "salt"}|${day}|${ip}|${ua}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest).slice(0, 8)].map(b => b.toString(16).padStart(2, "0")).join("");
}

function corsHeaders(req, env) {
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
  const visitor = await visitorHash(req, env, day);

  // Cheap and approximate on purpose: the point is to stop a loop hammering
  // the table, not to police anyone. The bucket dies with the minute.
  const bucket = `${visitor}:${Math.floor(now / 60000)}`;
  const seen = await env.DB.prepare(
    "INSERT INTO quota (bucket, n, ts) VALUES (?1, 1, ?2) " +
    "ON CONFLICT(bucket) DO UPDATE SET n = n + 1 RETURNING n"
  ).bind(bucket, now).first("n").catch(() => 0);
  if (seen > MAX_PER_MIN) return reply(429, "slow down\n");

  const cf = req.cf || {};
  const device = /mobile|android|iphone|ipad/i.test(req.headers.get("user-agent") || "")
    ? "mobile" : "desktop";

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
    ]);
  }
  if (!rows.length) return reply(400, "no valid events\n");

  const stmt = env.DB.prepare(
    "INSERT INTO event (ts, day, visitor, session, kind, path, label, ms, country, region, city, device) " +
    "VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)"
  );
  await env.DB.batch(rows.map(r => stmt.bind(...r)));

  return reply(204, null);
}

/* Old rows are deleted rather than kept, because a table that keeps
 * everything forever eventually becomes a thing worth stealing. Called from
 * the scheduled handler. */
export async function prune(env) {
  const keepDays = Number(env.RETENTION_DAYS || 400);
  const cutoff = new Date(Date.now() - keepDays * 86400000).toISOString().slice(0, 10);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM event WHERE day < ?1").bind(cutoff),
    env.DB.prepare("DELETE FROM quota WHERE ts < ?1").bind(Date.now() - 3600000),
  ]);
}
