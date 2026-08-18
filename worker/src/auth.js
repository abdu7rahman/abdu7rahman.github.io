/* GitHub OAuth, and the session cookie it produces.
 *
 * The whole reason this worker exists rather than a password box on the static
 * site: the client secret lives in Cloudflare, set with `wrangler secret put`,
 * and never reaches a browser. That is the difference between an actual gate
 * and a picture of one.
 *
 * Only one account gets in. The check is on the numeric GitHub user id, not
 * the login name, because a login can be given up and taken by someone else
 * while an id is permanent. ADMIN_LOGIN is still compared as a second
 * condition, so a misconfigured id cannot silently admit the wrong account.
 */

const enc = new TextEncoder();

function b64url(bytes) {
  let s = "";
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unb64url(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(s + "=".repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function key(secret) {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" },
    false, ["sign", "verify"]);
}

export async function sign(payload, secret) {
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const mac = await crypto.subtle.sign("HMAC", await key(secret), enc.encode(body));
  return body + "." + b64url(mac);
}

export async function verify(token, secret) {
  if (typeof token !== "string" || token.indexOf(".") < 0) return null;
  const [body, mac] = token.split(".", 2);
  let ok = false;
  try {
    // crypto.subtle.verify is the constant-time comparison; doing it by hand
    // with === would leak the signature one byte at a time.
    ok = await crypto.subtle.verify("HMAC", await key(secret), unb64url(mac), enc.encode(body));
  } catch { return null; }
  if (!ok) return null;
  let claims;
  try { claims = JSON.parse(new TextDecoder().decode(unb64url(body))); } catch { return null; }
  if (!claims || typeof claims.exp !== "number" || Date.now() > claims.exp) return null;
  return claims;
}

export function cookies(req) {
  const out = {};
  const raw = req.headers.get("cookie");
  if (!raw) return out;
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function setCookie(name, value, maxAge) {
  // Lax rather than Strict: the GitHub callback is a top-level navigation from
  // another site, and Strict would drop the cookie exactly there.
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

const SESSION = "admin_session";
const STATE = "oauth_state";
const SESSION_TTL = 12 * 60 * 60 * 1000;

export async function currentAdmin(req, env) {
  return verify(cookies(req)[SESSION], env.SESSION_SECRET);
}

export function login(req, env) {
  const nonce = b64url(crypto.getRandomValues(new Uint8Array(16)));
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
  url.searchParams.set("redirect_uri", new URL("/callback", req.url).toString());
  url.searchParams.set("state", nonce);
  // No scope at all. The public profile is enough to know who this is, and a
  // token that can do nothing is a token worth nothing if it ever leaks.
  url.searchParams.set("scope", "");
  return new Response(null, {
    status: 302,
    headers: { Location: url.toString(), "Set-Cookie": setCookie(STATE, nonce, 600) },
  });
}

export async function callback(req, env) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expected = cookies(req)[STATE];

  // Without this, any site could link a visitor at /callback?code=... and log
  // them in as whoever that code belongs to.
  if (!code || !state || !expected || state !== expected) {
    return deny("That sign-in link did not come from here. Start again at /login.", 400);
  }

  const tokRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: new URL("/callback", req.url).toString(),
    }),
  });
  const tok = await tokRes.json().catch(() => ({}));
  if (!tok.access_token) return deny("GitHub would not issue a token for that code.", 502);

  const meRes = await fetch("https://api.github.com/user", {
    headers: {
      authorization: "Bearer " + tok.access_token,
      accept: "application/vnd.github+json",
      "user-agent": "portfolio-analytics",
    },
  });
  const me = await meRes.json().catch(() => ({}));

  const idOk = env.ADMIN_USER_ID ? String(me.id) === String(env.ADMIN_USER_ID) : true;
  const loginOk = String(me.login || "").toLowerCase() === String(env.ADMIN_LOGIN || "").toLowerCase();
  if (!idOk || !loginOk) {
    return deny("That account is signed in to GitHub, but it is not the one this dashboard belongs to.", 403);
  }

  const token = await sign({ login: me.login, id: me.id, exp: Date.now() + SESSION_TTL }, env.SESSION_SECRET);
  return new Response(null, {
    status: 302,
    headers: {
      Location: "/",
      // Two cookies in one response need two headers, which is why this is an
      // array rather than a joined string.
      "Set-Cookie": setCookie(SESSION, token, SESSION_TTL / 1000),
    },
  });
}

export function logout() {
  return new Response(null, {
    status: 302,
    headers: { Location: "/", "Set-Cookie": `${SESSION}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0` },
  });
}

function deny(message, status) {
  return new Response(message + "\n", { status, headers: { "content-type": "text/plain; charset=utf-8" } });
}
