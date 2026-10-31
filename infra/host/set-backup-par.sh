#!/usr/bin/env bash
#
# Stores the production backup's Object Storage pre-authenticated request (PAR)
# URL on the mychess VM, as root, and proves it works first. The URL arrives on
# stdin and is never printed, never put in a command line (no `ps` leak) and
# never written anywhere but /etc/mychess/backup.env (root, 0600), where
# backup-production.sh reads it. Then enables the nightly backup timer. Also
# how an expired PAR is renewed.
#
#   (from the laptop, with the URL on the clipboard)
#   scp infra/host/set-backup-par.sh mychess:/tmp/
#   powershell -NoProfile -Command "Get-Clipboard" | ssh mychess 'sudo bash /tmp/set-backup-par.sh'
#
# The PAR must be of type "Permit object writes" (never reads). A write-only
# PAR cannot be read back, so the only honest test is the backup's own
# operation: write an object. A deleted or expired PAR answers 404. The probe
# object stays in the bucket (the PAR cannot delete it either) under
# mychess/par-check/, named for what it is.
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "run as root (sudo)" >&2; exit 1; }

IFS= read -r raw || true
par="$(printf '%s' "$raw" | tr -d '[:space:]')"
unset raw
# Both URL shapes Oracle issues: objectstorage.<region>.oraclecloud.com and
# <namespace>.objectstorage.<region>.oci.customer-oci.com.
[[ "$par" =~ ^https://[a-z0-9.-]+/p/[^/]+/n/[^/]+/b/[^/]+/o/$ ]] \
  || { echo "stdin does not hold a bucket PAR URL ending in /o/: nothing changed" >&2; exit 2; }

probe="mychess/par-check/$(date -u +%Y%m%dT%H%M%SZ)-from-$(hostname -s).txt"
echo "checking the PAR by writing $probe"
# A regular file with a length: Object Storage refuses a chunked upload (501), which is
# what curl sends for /dev/null or stdin.
probe_file="$(mktemp)"
printf 'write check from %s at %s\n' "$(hostname -s)" "$(date -u +%FT%TZ)" > "$probe_file"
if ! printf 'url = "%s%s"\n' "$par" "$probe" | curl -fsS --retry 2 -K - -T "$probe_file" -o /dev/null; then
  rm -f "$probe_file"
  echo "the PAR did not accept a write (404: expired or deleted): nothing changed" >&2
  exit 3
fi
rm -f "$probe_file"

install -d -m 700 /etc/mychess
tmp="$(umask 077; mktemp /etc/mychess/backup.env.XXXXXX)"
printf 'BACKUP_PAR_URL=%s\n' "$par" > "$tmp"
chmod 600 "$tmp"
mv "$tmp" /etc/mychess/backup.env
unset par
ls -l /etc/mychess/backup.env

if [ -f /etc/systemd/system/mychess-production-backup.timer ]; then
  systemctl enable --now mychess-production-backup.timer
else
  echo "the backup units are not installed yet: run bootstrap.sh, then this again"
fi
