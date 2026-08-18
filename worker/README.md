# Traffic

The dashboard behind `abdu7rahman.github.io/admin`, and the thing that collects
what it shows.

It exists as a worker rather than as a page on the site because GitHub Pages is
static. There is no server there to check a password, so any check would live in
JavaScript the visitor has already downloaded, and the numbers themselves would
be readable by anyone who found the URL. Here the OAuth client secret sits in
Cloudflare, the sign-in is real, and nothing serves a number to a caller who is
not signed in.

## What it records, and what it refuses to

| Kept | Not kept |
| --- | --- |
| Day, and a per-day salted hash of the reader | The IP address it was hashed from |
| Country, region, city (from Cloudflare's edge) | Anything more precise |
| `mobile` or `desktop` | The user-agent string |
| Which page, which demo, which link out | The full URL of a link out, only its host |
| Engaged milliseconds | Wall-clock time with the tab open |

The salt rotates at midnight UTC, so the same reader on two days is two
unrelated hashes and there is no key that follows anyone across a boundary.
There are no cookies except the admin's own session. A `Sec-GPC` or
`DNT` signal stops the collector entirely, before it sends anything.

That is the Plausible construction, and it is why this needs no consent banner.

## Deploying it

You need a Cloudflare account (the free tier is enough) and about ten minutes.

```sh
cd worker && ./setup.sh
```

That does everything below: creates the database, applies the schema, deploys,
generates and stores the two random secrets, and rewrites `index.html`,
`demo.html` and `admin.html` to point at the result. It stops twice, for the
two steps that genuinely need a browser -- signing wrangler in to Cloudflare,
and registering the GitHub OAuth app -- and prints the exact callback URL to
paste, which is the step that otherwise goes wrong. It is safe to re-run.

The rest of this section is the same thing by hand, if you would rather see
each step.

**1. A GitHub OAuth app** &mdash; <https://github.com/settings/developers> &rarr;
*New OAuth App*.

- Homepage URL: `https://abdu7rahman.github.io`
- Authorization callback URL: `https://portfolio-analytics.<your-subdomain>.workers.dev/callback`

You will not know the exact worker URL until step 4, so put a placeholder in and
correct it afterwards. Keep the **Client ID** and generate a **Client secret**.

**2. Install and sign in**

```sh
cd worker
npm install
npx wrangler login
```

**3. The database**

```sh
npx wrangler d1 create portfolio-analytics
```

Paste the `database_id` it prints into `wrangler.toml`, then create the tables:

```sh
npm run schema
```

**4. Deploy**

```sh
npx wrangler deploy
```

Note the URL it prints. Put the Client ID from step 1 into `GITHUB_CLIENT_ID` in
`wrangler.toml`, and go back and fix the callback URL on the GitHub app.

**5. The three secrets**

```sh
npx wrangler secret put GITHUB_CLIENT_SECRET   # from step 1
npx wrangler secret put SESSION_SECRET         # openssl rand -base64 32
npx wrangler secret put VISITOR_SALT           # openssl rand -base64 32
```

`SESSION_SECRET` signs the admin cookie. `VISITOR_SALT` is what makes the
visitor hash unguessable &mdash; without it, anyone with a list of addresses could
confirm whether a given one had visited. Neither belongs in this repository.

Deploy once more so the new vars take effect: `npx wrangler deploy`.

**6. Point the site at it**

In `index.html` and `demo.html`, set the endpoint on the collector tag:

```html
<script src="analytics.js" data-analytics="https://portfolio-analytics.<sub>.workers.dev/e" defer></script>
```

In `admin.html`, set `WORKER` to the same origin without the `/e`.

Then `python3 tools/stamp.py` and commit. Until this step the collector sends
nothing, so the site behaves exactly as it did before.

## Checking it before you deploy

```sh
cd worker
npm install
npx wrangler d1 execute portfolio-analytics --local --file=schema.sql
npm run dev
```

`node ../tools/test_worker.mjs` drives a running dev server through ingest,
validation, rate limiting, the auth gate and the aggregations. It does not need
Cloudflare credentials or a GitHub app; the one thing it cannot exercise is the
real OAuth round trip. It asserts exact totals, so start it from an empty table:

```sh
npx wrangler d1 execute portfolio-analytics --local \
  --command "DELETE FROM event; DELETE FROM quota;"
```

The browser half is `node tools/test_analytics.js` from the repository root,
which needs nothing running at all.

## Costs

Free tier, comfortably. Workers give 100k requests a day; D1 gives 5 GB and
5 million row reads a day. A portfolio generating a few hundred events a day
uses a rounding error of both. The nightly prune keeps the table from growing
without bound &mdash; `RETENTION_DAYS` defaults to 400, enough for a
year-over-year comparison and no more.

## If it is ever noisy

`POST /e` is public, because it has to be: the site is static and there is
nobody to authenticate. It checks the `Origin` header and rate limits per
visitor hash per minute, which stops a stuck loop but would not stop somebody
determined to write junk into the table. The blast radius is a wrong number on
a personal dashboard, so that trade is deliberate. If it ever matters,
`DELETE FROM event WHERE day = '...'` and add a proof-of-work or a signed
timestamp to the collector.
