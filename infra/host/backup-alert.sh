#!/usr/bin/env bash
#
# Mails the owner that the production backup needs attention (installed as
# /usr/local/bin/mychess-backup-alert; run as root by
# mychess-backup-alert@.service, which mychess-production-backup.service
# names in OnFailure=, and by backup-watch.sh).
#
#   mychess-backup-alert <reason>      mail with that reason (free text)
#   mychess-backup-alert --unit <name> a systemd unit failed; the reason is
#                                      that, plus backup-status.json's own
#                                      reason when it says `failed`
#   mychess-backup-alert --test        a clearly marked test mail, to prove
#                                      the path (key, sender, address) works
#
# The mail goes through Resend's HTTP API. The key (RESEND_API_KEY) and the
# sender (MAIL_FROM, an address or `Name <address>`) come from the production
# .env, the recipient (ALERT_EMAIL) from /etc/mychess/alert.env (root, 0600;
# infra/host/set-alert-email.sh writes it). They are read in here, one key at
# a time (neither file is sourced), and the key reaches curl through a config
# on stdin: never a command line, never a log. Subject and body are fixed text
# with the host name and the reason; no secret goes into them.
#
# Exits 0 only when Resend accepted the mail, so a failing alert unit shows in
# `systemctl --failed` and the journal. The three paths can be overridden by
# the environment for the shell test (infra/host/tests/backup-alert-test.sh).
set -Eeuo pipefail

ENV_FILE="${MYCHESS_PRODUCTION_ENV:-/srv/mychess/production/.env}"
ALERT_ENV="${MYCHESS_ALERT_ENV:-/etc/mychess/alert.env}"
STATUS="${MYCHESS_BACKUP_STATUS:-/srv/mychess/backup-status.json}"
ADDRESS='[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'

die() { echo "backup alert: $1" >&2; exit "${2:-1}"; }
usage() { echo "usage: mychess-backup-alert <reason> | --unit <unit> | --test" >&2; exit 2; }

setting() { # file key: the value of the first KEY=value line, never echoed by callers
  sed -n "s/^$2=//p" "$1" 2>/dev/null | head -n 1 | tr -d '\r'
}

# One line, printable ASCII and anything above it, at most 400 characters.
clean() { printf '%s' "$1" | tr '\n\r\t' '   ' | tr -d '\000-\037\177' | cut -c1-400; }

[ "$#" -ge 1 ] || usage
case "$1" in
  --test)
    [ "$#" -eq 1 ] || usage
    marker="TEST: "
    reason="This is a test of the alert path. Nothing is wrong; no action is needed."
    ;;
  --unit)
    [ "$#" -eq 2 ] || usage
    [[ "$2" =~ ^[A-Za-z0-9@:._-]{1,100}$ ]] || die "not a unit name" 2
    marker=""
    reason="systemd unit $2 failed."
    if [ -f "$STATUS" ] && [ "$(jq -r '.status // empty' "$STATUS" 2>/dev/null)" = failed ]; then
      reason="$reason The backup's own reason: $(clean "$(jq -r '.reason // empty' "$STATUS" 2>/dev/null)")"
    fi
    ;;
  -*) usage ;;
  *)
    [ "$#" -eq 1 ] || usage
    marker=""
    reason="$(clean "$1")"
    ;;
esac

key="$(setting "$ENV_FILE" RESEND_API_KEY)"
from="$(setting "$ENV_FILE" MAIL_FROM)"
to="$(setting "$ALERT_ENV" ALERT_EMAIL)"
[[ "$key" =~ ^re_[A-Za-z0-9_]+$ ]] || die "no RESEND_API_KEY in $ENV_FILE"
named="^[^<>]+ <$ADDRESS>$"
[[ "$from" =~ ^$ADDRESS$ || "$from" =~ $named ]] || die "no MAIL_FROM in $ENV_FILE"
[[ "$to" =~ ^$ADDRESS$ ]] || die "no ALERT_EMAIL in $ALERT_ENV (infra/host/set-alert-email.sh)"

host="$(hostname)"
now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
subject="[mychess] ${marker}production backup problem on $host"
[ -z "$marker" ] || subject="[mychess] ${marker}backup alert path on $host"
body="$(printf '%s\n' \
  "${marker}Production backup alert" \
  "" \
  "Host:   $host" \
  "Time:   $now" \
  "Reason: $reason" \
  "" \
  "On the host: cat /srv/mychess/backup-status.json ; journalctl -u mychess-production-backup -n 50" \
  "Recovery: docs/operations.md (Restoring a backup) in the mychess repository.")"

work="$(umask 077; mktemp -d)"
trap 'rm -rf "$work"' EXIT
jq -n --arg from "$from" --arg to "$to" --arg subject "$subject" --arg text "$body" \
  '{from: $from, to: [$to], subject: $subject, text: $text}' > "$work/mail.json"

# The key goes to curl on stdin (ps shows arguments, not stdin).
printf 'url = "https://api.resend.com/emails"\nheader = "Authorization: Bearer %s"\nheader = "Content-Type: application/json"\ndata-binary = "@%s"\n' \
  "$key" "$work/mail.json" \
  | curl -fsS --max-time 30 --retry 2 -K - -o /dev/null \
  || die "Resend refused or could not be reached; no mail was sent"
echo "backup alert mailed${marker:+ (test)}"
