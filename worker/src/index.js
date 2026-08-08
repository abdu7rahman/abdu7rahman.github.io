/**
 * Gemini Robotics-ER proxy.
 *
 * The demo page calls a real policy and a static site has nowhere safe to keep
 * an API key, so the page does not have one. It posts here, this holds the key,
 * and this forwards to the Gemini API.
 *
 * Everything it does is a restriction:
 *   - one origin, from ALLOWED_ORIGINS
 *   - one model, from MODEL, so the page cannot ask for a different one
 *   - one method and one path
 *   - a body cap, because base64 image uploads are the obvious way to run up
 *     a bill on someone else's key
 *
 * It forwards the model's response through untouched. Parsing is the page's
 * job; a proxy that reshapes the answer is a proxy that has to be updated
 * every time the model's output format moves.
 */

const MAX_BODY = 6 * 1024 * 1024;   // ~4 MP JPEG once base64'd
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

function allowed(env) {
  return String(env.ALLOWED_ORIGINS || "")
    .split(",").map(function (s) { return s.trim(); }).filter(Boolean);
}

function corsHeaders(origin) {
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "POST,OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
    "vary": "origin"
  };
}

function fail(status, message, origin) {
  return new Response(JSON.stringify({ error: message }), {
    status: status,
    headers: Object.assign({ "content-type": "application/json" },
                           origin ? corsHeaders(origin) : {})
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("origin") || "";
    const ok = allowed(env);
    // An empty allowlist would otherwise mean "allow everything", which is the
    // wrong way for a misconfiguration to fail on something holding a key.
    if (!ok.length) return fail(500, "ALLOWED_ORIGINS is not set", null);
    if (!ok.includes(origin)) return fail(403, "origin not allowed", null);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    if (request.method !== "POST") {
      return fail(405, "POST only", origin);
    }
    if (!env.GEMINI_API_KEY) {
      return fail(500, "GEMINI_API_KEY is not set; see worker/README.md", origin);
    }

    const declared = Number(request.headers.get("content-length") || 0);
    if (declared > MAX_BODY) return fail(413, "body too large", origin);

    let body;
    try {
      const raw = await request.text();
      if (raw.length > MAX_BODY) return fail(413, "body too large", origin);
      body = JSON.parse(raw);
    } catch (e) {
      return fail(400, "body is not JSON", origin);
    }
    if (!body || !Array.isArray(body.contents)) {
      return fail(400, "expected a generateContent body with `contents`", origin);
    }

    // Only the parts of the request the page is allowed to choose. Anything
    // else it sends is dropped rather than forwarded.
    const forward = { contents: body.contents };
    if (body.generationConfig) forward.generationConfig = body.generationConfig;
    if (body.systemInstruction) forward.systemInstruction = body.systemInstruction;

    const model = env.MODEL || "gemini-robotics-er-2-preview";
    let upstream;
    try {
      upstream = await fetch(ENDPOINT + "/" + model + ":generateContent", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": env.GEMINI_API_KEY
        },
        body: JSON.stringify(forward)
      });
    } catch (e) {
      return fail(502, "could not reach the Gemini API: " + e.message, origin);
    }

    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: Object.assign(
        { "content-type": upstream.headers.get("content-type") || "application/json" },
        corsHeaders(origin))
    });
  }
};
