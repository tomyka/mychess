#!/usr/bin/env bash
#
# Stores the address that backup alerts are mailed to on the mychess VM, as
# root. The address arrives on stdin and is never printed or put in a command
# line; it goes only into the root-only /etc/mychess/alert.env (ALERT_EMAIL).
# It then enables the backup watch timer (bootstrap.sh must have installed the
# units). Idempotent: a re-run replaces the address.
#
#   scp infra/host/set-alert-email.sh mychess:/tmp/
#   printf '%s\n' 'owner@example.com' | ssh mychess 'sudo bash /tmp/set-alert-email.sh'
set -euo pipefail

IFS= read -r raw || true
addr="$(printf '%s' "$raw" | tr -d '[:space:]')"
unset raw
[[ "$addr" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]] \
  || { echo "stdin does not hold an email address: nothing changed" >&2; exit 2; }
[ "$(id -u)" -eq 0 ] || { echo "run as root (sudo)" >&2; exit 1; }

install -d -m 700 /etc/mychess
file=/etc/mychess/alert.env
tmp="$(umask 077; mktemp "$file.XXXXXX")"
printf 'ALERT_EMAIL=%s\n' "$addr" > "$tmp"
chmod 600 "$tmp"
mv "$tmp" "$file"
unset addr
echo "ALERT_EMAIL stored in $file (value not shown)"

if [ -f /etc/systemd/system/mychess-backup-watch.timer ]; then
  systemctl enable --now mychess-backup-watch.timer
else
  echo "the watch units are not installed yet: run bootstrap.sh, then this again"
fi
