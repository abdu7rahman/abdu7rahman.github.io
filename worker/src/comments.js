/* POST /c -- a reader leaving a comment.
 *
 * The other public endpoint on this worker, and the more dangerous one: /e
 * accepts a fixed vocabulary of enum values and numbers, while this accepts
 * prose a stranger wrote. So it is narrow on purpose.
 *
 *   - the same origin check as /e, so it is not an open form on the internet
 *   - hard length caps, applied by truncation rather than rejection, because a
 *     reader who wrote 2,100 characters should not lose them to an error
 *   - a honeypot field that a human never fills in and a naive bot always does
 *   - its own rate limit, far tighter than the event one: five an hour
 *   - stored, never served to the public, so there is nothing here for anyone
 *     trying to place a link where a search engine will see it
 *
 * Nothing written here is ever rendered as markup. The dashboard escapes it,
 * and that is the property that matters most in this file -- a comment box
 * that reaches an admin page is the classic way to land script in the one
 * browser session that is privileged.
 */
import { visitorHash, corsHeaders } from "./ingest.js";

const MAX_BODY_BYTES = 8 * 1024;
const MAX_COMMENT = 2000;
const MAX_NAME = 64;
const MAX_CONTACT = 128;
const PER_HOUR = 5;

const clean = (v, n) => (typeof v === "string" ? v.trim().slice(0, n) : "");

export async function comment(req, env) {
  const h = corsHeaders(req, env);
  const allowed = h._ok;
  delete h._ok;
  const reply = (status, body) =>
    new Response(body, { status, headers: { ...h, "content-type": "text/plain; charset=utf-8" } });

  if (!allowed) return reply(403, "origin not allowed\n");

  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return reply(413, "too long\n");

  let c;
  try { c = JSON.parse(raw); } catch { return reply(400, "bad json\n"); }
  if (!c || typeof c !== "object") return reply(400, "expected an object\n");

  // A field positioned off-screen and left empty by anyone actually reading
  // the page. Answering 200 rather than 400 means a bot filling it in learns
  // nothing from the response.
  if (clean(c.website, 8)) return reply(200, "thanks\n");

  const body = clean(c.body, MAX_COMMENT);
  if (!body) return reply(400, "a comment needs something in it\n");

  const now = Date.now();
  const day = new Date(now).toISOString().slice(0, 10);
  const visitor = await visitorHash(req, env);

  // Far tighter than the event limit, and per hour rather than per minute:
  // five comments is already generous for one reader in one sitting, and the
  // cost of a flood here is prose someone has to read.
  const bucket = `c:${visitor}:${Math.floor(now / 3600000)}`;
  const seen = await env.DB.prepare(
    "INSERT INTO quota (bucket, n, ts) VALUES (?1, 1, ?2) " +
    "ON CONFLICT(bucket) DO UPDATE SET n = n + 1 RETURNING n"
  ).bind(bucket, now).first("n").catch(() => 0);
  if (seen > PER_HOUR) return reply(429, "that is enough for now\n");

  const cf = req.cf || {};
  await env.DB.prepare(
    "INSERT INTO comment (ts, day, visitor, session, body, name, contact, path, country, city, org, device) " +
    "VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)"
  ).bind(
    now, day, visitor, clean(c.session, 32) || "none", body,
    clean(c.name, MAX_NAME) || null, clean(c.contact, MAX_CONTACT) || null,
    clean(c.path, 64) || null,
    clean(cf.country, 4) || null, clean(cf.city, 48) || null,
    clean(cf.asOrganization, 64) || null,
    /mobile|android|iphone|ipad/i.test(req.headers.get("user-agent") || "") ? "mobile" : "desktop"
  ).run();

  return reply(201, "thanks\n");
}

/* For the dashboard. Newest first; the visitor hash comes through so a comment
 * can be lined up against what that reader did, but it is not displayed. */
export async function comments(env, limit) {
  const n = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 500);
  const { results } = await env.DB.prepare(
    `SELECT c.id, c.ts, c.body, c.name, c.contact, c.path,
            COALESCE(c.country, '??') country, COALESCE(c.city, '') city,
            COALESCE(c.org, '') org, COALESCE(c.device, '') device,
            (SELECT COUNT(DISTINCT e.day) FROM event e WHERE e.visitor = c.visitor) visitor_days,
            (SELECT COUNT(*) FROM event e WHERE e.visitor = c.visitor AND e.kind = 'demo_start') visitor_demos
     FROM comment c ORDER BY c.ts DESC LIMIT ?1`
  ).bind(n).all();
  return results;
}
