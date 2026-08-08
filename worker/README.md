# Gemini Robotics-ER proxy

The policy demo on `demo.html` calls Gemini Robotics-ER live. A static Pages
site has nowhere safe to keep an API key, so it does not have one: it calls
this Worker, and the Worker holds the key.

The Worker is deliberately small. It locks to one origin, pins one model,
caps the request size, and forwards nothing else.

## Deploy

Once, from this directory:

```sh
npm install -g wrangler        # if you do not have it
wrangler login
wrangler secret put GEMINI_API_KEY     # paste the key from aistudio.google.com
wrangler deploy
```

`wrangler deploy` prints a URL like
`https://gemini-er-proxy.<your-subdomain>.workers.dev`. Put that in
`demo.js`:

```js
var ER = { proxy: "https://gemini-er-proxy.<your-subdomain>.workers.dev", ... };
```

Leave it empty and the demo says the proxy is not configured rather than
failing at the network.

## What it allows

- `POST /` only, from `ALLOWED_ORIGINS` only
- one model, set in `wrangler.toml` as `MODEL` — the page cannot ask for another
- 6 MB body cap, which is roughly a 4 MP JPEG once base64'd
- the key is never sent to the browser and is not in this repository

## Rate limiting

Nothing here counts requests. If the demo gets traffic, add a rate limiting
rule in the Cloudflare dashboard against the Worker's route — that is free,
it runs before the Worker, and it does not need a KV binding. Something like
20 requests per minute per IP is plenty for a demo.

## Model lifetime

Google retires these previews on a schedule. `gemini-robotics-er-1.5-preview`
is already gone and `gemini-robotics-er-1.6-preview` retires on 31 August
2026. `MODEL` in `wrangler.toml` is the only place the name appears, so
moving to the next one is a one-line change and a redeploy.
