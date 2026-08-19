#!/usr/bin/env bash
#
# Sets up the traffic dashboard end to end.
#
# Two things here need a browser and so cannot be scripted: signing wrangler
# into Cloudflare, and creating the GitHub OAuth app. The script stops and
# tells you exactly what to do at each, then carries on. Everything else --
# the database, the schema, the deploy, generating and storing the two random
# secrets, and pasting the resulting URL into the three files on the site that
# need it -- happens here.
#
#   cd worker && ./setup.sh
#
# Safe to re-run. It only writes a value if that value is missing or changed,
# so a second run after a failure picks up where the first stopped.

set -euo pipefail

cd "$(dirname "$0")"
ROOT="$(cd .. && pwd)"
TOML="wrangler.toml"
NAME="portfolio-analytics"

bold=$'\033[1m'; dim=$'\033[2m'; red=$'\033[31m'; green=$'\033[32m'; off=$'\033[0m'
say()  { printf '\n%s==>%s %s\n' "$bold" "$off" "$*"; }
note() { printf '    %s%s%s\n' "$dim" "$*" "$off"; }
die()  { printf '\n%sX%s %s\n\n' "$red" "$off" "$*" >&2; exit 1; }
ok()   { printf '    %sok%s %s\n' "$green" "$off" "$*"; }

command -v node >/dev/null || die "node is not installed. Get it from https://nodejs.org"
[ -f "$TOML" ] || die "run this from the worker directory of the portfolio repo"

# ---------------------------------------------------------------- 0. deps
if [ ! -x node_modules/.bin/wrangler ]; then
  say "Installing wrangler"
  npm install --no-audit --no-fund
fi
WR="./node_modules/.bin/wrangler"
ok "wrangler $($WR --version 2>/dev/null | tail -1)"

# ---------------------------------------------------------------- 1. login
say "Signing in to Cloudflare"
if $WR whoami >/dev/null 2>&1; then
  ok "already signed in as $($WR whoami 2>/dev/null | grep -oE '[^ ]+@[^ ]+' | head -1 || echo 'your account')"
else
  note "A browser window will open. If you have no Cloudflare account, make one"
  note "first at https://dash.cloudflare.com/sign-up -- the free tier is enough."
  $WR login
fi

# ---------------------------------------------------------------- 2. database
say "Creating the database"
DB_ID="$(grep -oE 'database_id[[:space:]]*=[[:space:]]*"[^"]*"' "$TOML" | head -1 | cut -d'"' -f2 || true)"
if [ -n "$DB_ID" ] && [ "$DB_ID" != "local" ]; then
  ok "already set: $DB_ID"
else
  OUT="$($WR d1 create "$NAME" 2>&1 || true)"
  DB_ID="$(printf '%s' "$OUT" | grep -oE '"?database_id"?[[:space:]]*[:=][[:space:]]*"[0-9a-f-]{36}"' | grep -oE '[0-9a-f-]{36}' | head -1 || true)"
  if [ -z "$DB_ID" ]; then
    # Already existed, most likely -- ask the API rather than guessing.
    DB_ID="$($WR d1 list --json 2>/dev/null \
      | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{
          const m=(JSON.parse(s)||[]).find(d=>d.name==="'"$NAME"'");process.stdout.write(m?m.uuid||m.database_id||"":"")}catch(e){}})' || true)"
  fi
  [ -n "$DB_ID" ] || die "could not create or find the database. Wrangler said:
$OUT"
  node -e '
    const fs=require("fs"),f="'"$TOML"'";
    fs.writeFileSync(f, fs.readFileSync(f,"utf8").replace(
      /database_id\s*=\s*"[^"]*"[^\n]*/, `database_id   = "'"$DB_ID"'"`));'
  ok "created and written to wrangler.toml: $DB_ID"
fi

say "Creating the tables"
$WR d1 execute "$NAME" --remote --file=schema.sql >/dev/null
ok "schema applied"

# ---------------------------------------------------------------- 3. deploy
# Deployed before the GitHub app exists on purpose: the callback URL the app
# needs is the URL this prints, and guessing it is the step everyone gets wrong.
say "Deploying, to find out the URL"
DEPLOY="$($WR deploy 2>&1)" || { printf '%s\n' "$DEPLOY"; die "deploy failed"; }
URL="$(printf '%s' "$DEPLOY" | grep -oE 'https://[a-zA-Z0-9._-]+\.workers\.dev' | head -1 || true)"
[ -n "$URL" ] || { printf '%s\n' "$DEPLOY"; die "deployed, but could not read the URL from the output"; }
ok "$URL"

# ---------------------------------------------------------------- 4. oauth app
CLIENT_ID="$(grep -oE 'GITHUB_CLIENT_ID[[:space:]]*=[[:space:]]*"[^"]*"' "$TOML" | cut -d'"' -f2 || true)"
if [ -z "$CLIENT_ID" ]; then
  say "Now the GitHub side -- this part needs you"
  cat <<TXT

    Open:  https://github.com/settings/applications/new

      Application name            anything, e.g. Portfolio traffic
      Homepage URL                https://abdu7rahman.github.io
      Authorization callback URL  $URL/callback

    Register it. On the next screen copy the Client ID, then press
    "Generate a new client secret" and copy that too.

TXT
  read -r -p "    Client ID: " CLIENT_ID
  [ -n "$CLIENT_ID" ] || die "no client id given"
  node -e '
    const fs=require("fs"),f="'"$TOML"'";
    fs.writeFileSync(f, fs.readFileSync(f,"utf8").replace(
      /GITHUB_CLIENT_ID\s*=\s*"[^"]*"/, `GITHUB_CLIENT_ID = "'"$CLIENT_ID"'"`));'
  ok "client id saved to wrangler.toml"
else
  # The app was made ahead of time, so its redirect URI was necessarily a
  # guess -- the worker URL did not exist yet. This is the one setting that
  # fails with a message pointing nowhere near the cause, so it gets checked
  # rather than assumed.
  ok "client id already set: $CLIENT_ID"
  say "Check the app's redirect URI before going on"
  cat <<TXT

    Open   https://github.com/settings/developers  ->  OAuth Apps  ->  your app

    Its callback must be exactly this, including the scheme and /callback.
    Newer GitHub labels this field "Redirect URI"; it is the same setting.

      $bold$URL/callback$off

    Anything else fails at sign-in with redirect_uri_mismatch, which reads
    like a problem with the worker and is not one.

TXT
  read -r -p "    Press enter once it is saved. " _ </dev/tty || true
fi

# ---------------------------------------------------------------- 5. secrets
say "Storing the three secrets in Cloudflare"
note "these go to Cloudflare, never into the repository"

read -r -s -p "    Client secret (paste, it stays hidden): " CLIENT_SECRET; echo
[ -n "$CLIENT_SECRET" ] || die "no client secret given"
printf '%s' "$CLIENT_SECRET" | $WR secret put GITHUB_CLIENT_SECRET >/dev/null
ok "GITHUB_CLIENT_SECRET"

rand() { node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("base64"))'; }
printf '%s' "$(rand)" | $WR secret put SESSION_SECRET >/dev/null; ok "SESSION_SECRET  (generated)"
printf '%s' "$(rand)" | $WR secret put VISITOR_SALT   >/dev/null; ok "VISITOR_SALT    (generated)"

say "Deploying again, so the new settings take effect"
$WR deploy >/dev/null
ok "live"

# ---------------------------------------------------------------- 6. the site
say "Pointing the site at it"
node -e '
  const fs = require("fs"), root = "'"$ROOT"'", url = "'"$URL"'";

  // Each pattern is anchored to the start of a line, because admin.html
  // carries a commented-out example of the very line being rewritten and an
  // unanchored replace patches the comment and leaves the real one empty --
  // which then fails silently, as a dashboard that never loads.
  const edits = [
    ["index.html", /data-analytics="[^"]*"/g,        `data-analytics="${url}/e"`],
    ["demo.html",  /data-analytics="[^"]*"/g,        `data-analytics="${url}/e"`],
    ["admin.html", /^(\s*)var WORKER = "[^"]*";/gm, `$1var WORKER = "${url}";`],
  ];

  let failed = 0;
  for (const [f, re, to] of edits) {
    const p = root + "/" + f, before = fs.readFileSync(p, "utf8");
    const hits = (before.match(re) || []).length;
    if (!hits) { console.log("    !!  " + f + ": nothing to replace -- edit it by hand"); failed++; continue; }
    const after = before.replace(re, to);
    if (after !== before) fs.writeFileSync(p, after);
    // Confirm the file really says what it should now, rather than trusting
    // that the replace did what it looked like it would.
    const now = fs.readFileSync(p, "utf8");
    if (now.indexOf(url) < 0) { console.log("    !!  " + f + ": rewrite did not take"); failed++; }
    else console.log("    " + (after !== before ? "ok  " : "--  ") + f +
                     (after !== before ? "" : " (already pointed at it)"));
  }
  process.exit(failed ? 1 : 0);
'
if command -v python3 >/dev/null && [ -f "$ROOT/tools/stamp.py" ]; then
  (cd "$ROOT" && python3 tools/stamp.py >/dev/null) && ok "cache stamps refreshed"
fi

# ---------------------------------------------------------------- done
cat <<TXT

$bold Done. $off

  Dashboard   $URL
  Sign in as  abdu7rahman -- any other GitHub account is refused

  Two things left, and they are both yours:

    1. Commit the changed files and push, so the live site starts reporting:

         cd $ROOT
         git add -A && git commit -m "chore(analytics): point the site at the worker"
         git push

    2. Open the dashboard and sign in, to check the round trip works.
       It will be empty until the site has had a visitor.

  If sign-in fails with a mismatch, the callback URL on the GitHub app is not
  exactly $URL/callback -- that is almost always what it is.

TXT
