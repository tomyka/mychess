#!/usr/bin/env bash
#
# Calls the app's rate-limit prune once (installed as
# /usr/local/bin/mychess-rate-limit-prune; run daily by
# mychess-rate-limit-prune.timer, as root). The route is
# GET /api/cron/prune-rate-limits with `Authorization: Bearer <CRON_SECRET>`
# (docs/operations.md); it answers {"pruned":<n>}, counts only.
#
# The site's URL (BETTER_AUTH_URL) and CRON_SECRET are read, key by key, from
# the production .env (never sourced). The request goes through Caddy on this
# host with the site's own name and certificate (--resolve to 127.0.0.1), so
# it needs no DNS round trip. The secret reaches curl through a config on
# stdin: never a command line, never a log. Exits non-zero on any non-2xx
# answer or an unreachable site, so the failure shows in `systemctl --failed`.
# MYCHESS_PRODUCTION_ENV overrides the env file's path for the shell test.
set -Eeuo pipefail

ENV_FILE="${MYCHESS_PRODUCTION_ENV:-/srv/mychess/production/.env}"

setting() { # key: the value of the first KEY=value line, never echoed by callers
  sed -n "s/^$1=//p" "$ENV_FILE" 2>/dev/null | head -n 1 | tr -d '\r'
}

[ -f "$ENV_FILE" ] || { echo "rate-limit prune: $ENV_FILE is missing" >&2; exit 1; }
url="$(setting BETTER_AUTH_URL)"
secret="$(setting CRON_SECRET)"
[[ "$url" =~ ^https://([a-z0-9.-]+)$ ]] || { echo "rate-limit prune: no https BETTER_AUTH_URL in $ENV_FILE" >&2; exit 1; }
domain="${BASH_REMATCH[1]}"
[ "${#secret}" -ge 32 ] || { echo "rate-limit prune: no CRON_SECRET in $ENV_FILE" >&2; exit 1; }

printf 'url = "%s/api/cron/prune-rate-limits"\nheader = "Authorization: Bearer %s"\nresolve = "%s:443:127.0.0.1"\n' \
  "$url" "$secret" "$domain" \
  | curl -fsS --max-time 120 -K -
echo
