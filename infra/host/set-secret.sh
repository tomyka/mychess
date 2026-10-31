#!/usr/bin/env bash
#
# Stores one of production's owner-supplied settings on the mychess VM, as
# root. The value arrives on stdin and is never printed, never put in a command
# line (no `ps` leak) and never written anywhere but the root-only
# /srv/mychess/production/.env. Run once per setting; a re-run replaces it.
#
#   (from the laptop, with the value on the clipboard)
#   scp infra/host/set-secret.sh mychess:/tmp/
#   powershell -NoProfile -Command "Get-Clipboard" | ssh mychess 'sudo bash /tmp/set-secret.sh RESEND_API_KEY'
#
# Settings: RESEND_API_KEY (re_...), GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
# (the OAuth client whose redirect URI is <site>/api/auth/callback/google),
# LICHESS_CLIENT_ID (Lichess needs no secret: any client id names the app).
# It does not redeploy: the web reads a changed value once the deploy button
# (deploy-production.yml, empty sha) redeploys main's head.
#
# MYCHESS_ROOT (default /srv/mychess) is for the shell test only.
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "run as root (sudo)" >&2; exit 1; }

name="${1:-}"
case "$name" in
  RESEND_API_KEY) pattern='^re_[A-Za-z0-9_]+$' ;;
  GOOGLE_CLIENT_ID|GOOGLE_CLIENT_SECRET) pattern='^[A-Za-z0-9._~-]{8,255}$' ;;
  LICHESS_CLIENT_ID) pattern='^[A-Za-z0-9._~-]{1,128}$' ;;
  *) echo "usage: set-secret.sh RESEND_API_KEY|GOOGLE_CLIENT_ID|GOOGLE_CLIENT_SECRET|LICHESS_CLIENT_ID (value on stdin)" >&2; exit 2 ;;
esac

env_file="${MYCHESS_ROOT:-/srv/mychess}/production/.env"
[ -f "$env_file" ] || { echo "$env_file is missing: run production-env.sh first" >&2; exit 1; }

IFS= read -r raw || true
value="$(printf '%s' "$raw" | tr -d '[:space:]')"
unset raw
[[ "$value" =~ $pattern ]] || { echo "stdin does not hold a $name: nothing changed" >&2; exit 2; }

tmp="$(umask 077; mktemp "$env_file.XXXXXX")"
grep -v "^$name=" "$env_file" > "$tmp" || true
printf '%s=%s\n' "$name" "$value" >> "$tmp"
chmod 600 "$tmp"
mv "$tmp" "$env_file"
unset value
echo "$name stored in $env_file (value not shown)"
