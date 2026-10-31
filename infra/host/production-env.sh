#!/usr/bin/env bash
#
# Writes production's settings on the mychess VM (ADR 0010), as root, and
# prints no value. Idempotent: a key already in the file is kept, so a re-run
# never rotates a secret; only missing keys are added.
#
#   sudo bash production-env.sh <site url, e.g. https://mychess.lt>
#
# /srv/mychess/production/.env (root, 0600), read by `docker compose
# --env-file` (infra/compose/production.yml) and, key by key, by the host's
# timers: POSTGRES_PASSWORD, BETTER_AUTH_SECRET, AUDIT_EMAIL_KEY, CRON_SECRET,
# BETTER_AUTH_URL, MYCHESS_ENV=production, MAIL_TRANSPORT=resend and
# MAIL_FROM (noreply@ the site's domain, which Resend must have verified).
#
# BETTER_AUTH_URL is the one place the site's name is set: the deploy derives
# Caddy's domain and its release check from it, the rate-limit prune its URL.
# It is the one key a re-run replaces, so naming another domain is a re-run
# with the new URL and a deploy. MAIL_FROM is only added when missing.
#
# The secrets the owner supplies (RESEND_API_KEY, GOOGLE_CLIENT_ID,
# GOOGLE_CLIENT_SECRET, LICHESS_CLIENT_ID) are stored by set-secret.sh; the
# deploy refuses to start until all of them are there. MYCHESS_TEST_SIGNIN is
# never written: the persona sign-in stays off in production (R-73).
#
# MYCHESS_ROOT (default /srv/mychess) is for the shell test only.
set -euo pipefail

app_url="${1:?usage: production-env.sh <site url, https://...>}"
[[ "$app_url" =~ ^https://([a-z0-9-]+\.)+[a-z]{2,}$ ]] || { echo "not an https origin (lower case, no path): $app_url" >&2; exit 2; }
[ "$(id -u)" -eq 0 ] || { echo "run as root (sudo)" >&2; exit 1; }
domain="${app_url#https://}"

root="${MYCHESS_ROOT:-/srv/mychess}"
install -d -m 755 "$root" "$root/production"

env_file="$root/production/.env"
( umask 077; touch "$env_file" )
chmod 600 "$env_file"

has() { grep -q "^$1=" "$env_file"; }
add() { has "$1" || printf '%s=%s\n' "$1" "$2" >> "$env_file"; }
secret() { openssl rand -base64 48 | tr -d '\n'; }

add POSTGRES_PASSWORD "$(openssl rand -hex 24)"
add BETTER_AUTH_SECRET "$(secret)"
add AUDIT_EMAIL_KEY "$(secret)"
add CRON_SECRET "$(secret)"
add MYCHESS_ENV production
add MAIL_TRANSPORT resend
add MAIL_FROM "mychess <noreply@$domain>"

tmp="$(umask 077; mktemp "$env_file.XXXXXX")"
grep -v '^BETTER_AUTH_URL=' "$env_file" > "$tmp" || true
printf 'BETTER_AUTH_URL=%s\n' "$app_url" >> "$tmp"
chmod 600 "$tmp"
mv "$tmp" "$env_file"

echo "production env: $(wc -l < "$env_file") keys in $env_file (values not shown), site https://$domain"
missing=""
for key in RESEND_API_KEY GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET LICHESS_CLIENT_ID; do
  has "$key" || missing="$missing $key"
done
[ -z "$missing" ] || echo "still to store with set-secret.sh before the first deploy:$missing"
