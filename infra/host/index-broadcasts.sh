#!/usr/bin/env bash
#
# Asks the app to index the broadcast months not yet done (R-195; installed
# as /usr/local/bin/mychess-index-broadcasts; run nightly by
# mychess-index-broadcasts.timer, as root). The route is
# GET /api/cron/index-broadcasts with `Authorization: Bearer <CRON_SECRET>`
# (docs/operations.md); it hands every one of the 12 newest months that needs
# processing to the web process's runner and answers at once with
# 202 {"queued":<n>,"ready":<m>,"community":"started"|"running"|"off"}. The
# indexing itself goes on in the web process after this exits; its progress
# is in broadcast_months. The community state (#349) is logged when the body
# has it, "off" meaning no LICHESS_TOKEN; an image without it logs the counts.
#
# The site's URL (BETTER_AUTH_URL) and CRON_SECRET are read, key by key, from
# the production .env (never sourced). The request goes through Caddy on this
# host with the site's own name and certificate (--resolve to 127.0.0.1), so
# it needs no DNS round trip. The secret reaches curl through a config on
# stdin: never a command line, never a log. Only the two counts and the
# community state are printed.
# Exits non-zero on any answer but 202, an answer without the counts, or an
# unreachable site, so the failure shows in `systemctl --failed`.
# MYCHESS_PRODUCTION_ENV overrides the env file's path for the shell test.
set -Eeuo pipefail

ENV_FILE="${MYCHESS_PRODUCTION_ENV:-/srv/mychess/production/.env}"

setting() { # key: the value of the first KEY=value line, never echoed by callers
  sed -n "s/^$1=//p" "$ENV_FILE" 2>/dev/null | head -n 1 | tr -d '\r'
}
count() { # key body: the number after "key": in the JSON body, or nothing
  sed -n "s/.*\"$1\" *: *\([0-9][0-9]*\).*/\1/p" <<< "$2"
}

[ -f "$ENV_FILE" ] || { echo "index broadcasts: $ENV_FILE is missing" >&2; exit 1; }
url="$(setting BETTER_AUTH_URL)"
secret="$(setting CRON_SECRET)"
[[ "$url" =~ ^https://([a-z0-9.-]+)$ ]] || { echo "index broadcasts: no https BETTER_AUTH_URL in $ENV_FILE" >&2; exit 1; }
domain="${BASH_REMATCH[1]}"
[ "${#secret}" -ge 32 ] || { echo "index broadcasts: no CRON_SECRET in $ENV_FILE" >&2; exit 1; }

# No -f: the status is checked below, so a 200 (or any other 2xx) fails too.
response="$(printf 'url = "%s/api/cron/index-broadcasts"\nheader = "Authorization: Bearer %s"\nresolve = "%s:443:127.0.0.1"\n' \
  "$url" "$secret" "$domain" \
  | curl -sS --max-time 120 -w '\n%{http_code}' -K -)"
status="${response##*$'\n'}"
body="${response%$'\n'*}"
[ "$status" = 202 ] || { echo "index broadcasts: the route answered HTTP $status, not 202" >&2; exit 1; }
queued="$(count queued "$body")"
ready="$(count ready "$body")"
if [ -z "$queued" ] || [ -z "$ready" ]; then
  echo "index broadcasts: a 202 without the queued and ready counts" >&2
  exit 1
fi
community="$(sed -n 's/.*"community" *: *"\(started\|running\|off\)".*/\1/p' <<< "$body")"
echo "index broadcasts: queued $queued, ready $ready${community:+, community $community}"
