#!/usr/bin/env bash
#
# Shell test of backup-alert.sh and backup-watch.sh with a stub curl on PATH
# and temp files; nothing is sent. Needs bash, jq and GNU date.
#
#   bash infra/host/tests/backup-alert-test.sh
set -uo pipefail

here="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
fails=0
ok() { printf 'ok   %s\n' "$1"; }
bad() { printf 'FAIL %s\n' "$1"; fails=$((fails + 1)); }
check() { # name command...
  local name="$1"; shift
  if "$@"; then ok "$name"; else bad "$name"; fi
}

# Stub curl: records its arguments and its stdin; STUB_CURL_EXIT sets the exit code.
mkdir "$work/bin"
cat > "$work/bin/curl" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$@" > "$STUB_DIR/curl.args"
cat > "$STUB_DIR/curl.stdin"
payload="$(sed -n 's/^data-binary = "@\(.*\)"$/\1/p' "$STUB_DIR/curl.stdin")"
[ -z "$payload" ] || cp "$payload" "$STUB_DIR/curl.payload"
touch "$STUB_DIR/curl.called"
exit "${STUB_CURL_EXIT:-0}"
STUB
chmod +x "$work/bin/curl"
export STUB_DIR="$work" PATH="$work/bin:$PATH"

printf 'POSTGRES_PASSWORD=x\nRESEND_API_KEY=re_SECRETKEY123\nMAIL_FROM=mychess <noreply@mychess.example>\n' > "$work/prod.env"
printf 'ALERT_EMAIL=owner@example.com\n' > "$work/alert.env"
export MYCHESS_PRODUCTION_ENV="$work/prod.env" MYCHESS_ALERT_ENV="$work/alert.env" MYCHESS_BACKUP_STATUS="$work/status.json"
alert="$here/backup-alert.sh"
watch="$here/backup-watch.sh"
reset() { rm -f "$work"/curl.* "$work/status.json"; unset STUB_CURL_EXIT; }

# --- backup-alert.sh
reset
bash "$alert" "upload failed (a 404 means the PAR expired)" >/dev/null 2>&1
check "alert: sends one request" test -f "$work/curl.called"
check "alert: payload addressed to the alert address" test "$(jq -r '.to[0]' "$work/curl.payload")" = owner@example.com
check "alert: payload from the configured sender" test "$(jq -r '.from' "$work/curl.payload")" = 'mychess <noreply@mychess.example>'
check "alert: reason is in the body" grep -q "upload failed (a 404 means the PAR expired)" "$work/curl.payload"
check "alert: subject names the problem" grep -q "production backup problem" "$work/curl.payload"
check "alert: key is not on the command line" bash -c '! grep -q SECRETKEY "$1"' _ "$work/curl.args"
check "alert: key is in the stdin config" grep -q "Bearer re_SECRETKEY123" "$work/curl.stdin"
check "alert: key is not in the payload" bash -c '! grep -q SECRETKEY "$1"' _ "$work/curl.payload"
check "alert: curl is not given the address either" bash -c '! grep -q owner@example "$1"' _ "$work/curl.args"

reset
bash "$alert" --test >/dev/null 2>&1
check "test mode: subject is marked TEST" grep -q "TEST: backup alert path" "$work/curl.payload"
check "test mode: body says nothing is wrong" grep -q "Nothing is wrong" "$work/curl.payload"

reset
jq -n '{status:"failed", reason:"pg_dump failed", updated_at:"2026-10-20T02:40:00Z"}' > "$work/status.json"
bash "$alert" --unit mychess-production-backup.service >/dev/null 2>&1
check "unit mode: names the unit and the status reason" grep -q "mychess-production-backup.service failed. The backup's own reason: pg_dump failed" "$work/curl.payload"

reset
bash "$alert" --unit 'bad name;rm' >/dev/null 2>&1
check "unit mode: refuses a malformed unit name" test "$?" = 2
check "unit mode: and sends nothing" test ! -f "$work/curl.called"

reset
STUB_CURL_EXIT=22 bash "$alert" "x" >/dev/null 2>&1
check "alert: exits non-zero when curl fails" test "$?" != 0

reset
printf 'MAIL_FROM=mychess <noreply@mychess.example>\n' > "$work/prod2.env"
MYCHESS_PRODUCTION_ENV="$work/prod2.env" bash "$alert" "x" >/dev/null 2>&1
check "alert: no key, no send, non-zero" test "$?" != 0 -a ! -f "$work/curl.called"

reset
printf 'x\n' > /dev/null
MYCHESS_ALERT_ENV="$work/missing.env" bash "$alert" "x" >/dev/null 2>&1
check "alert: no alert address, no send, non-zero" test "$?" != 0 -a ! -f "$work/curl.called"

# --- backup-watch.sh (the alert command is the real script on the stub curl)
export MYCHESS_BACKUP_ALERT="$alert"
fresh() { date -u -d "$1" +%Y-%m-%dT%H:%M:%SZ; }
status() { jq -n --arg s "$1" --arg r "$2" --arg u "$3" '{status:$s, reason:$r, file:"mychess/production/x.dump", bytes:1, sha256:"", updated_at:$u}' > "$work/status.json"; }

reset
status ok "" "$(fresh '3 hours ago')"
out="$(bash "$watch" 2>&1)"
check "watch: quiet when all is well" test ! -f "$work/curl.called"
check "watch: says ok in its log line" grep -q "backup watch: ok" <<< "$out"

reset
bash "$watch" >/dev/null 2>&1
check "watch: mails when the status file is missing" grep -q "is missing" "$work/curl.payload"

reset
echo '{not json' > "$work/status.json"
bash "$watch" >/dev/null 2>&1
check "watch: mails when the status file is not JSON" grep -q "not valid JSON" "$work/curl.payload"

reset
status failed "upload failed" "$(fresh '1 hour ago')"
bash "$watch" >/dev/null 2>&1
check "watch: mails when the status is failed, with the reason" grep -q "status is 'failed': upload failed" "$work/curl.payload"

reset
status ok "" "$(fresh '27 hours ago')"
bash "$watch" >/dev/null 2>&1
check "watch: mails when the status is 27 hours old" grep -q "27 hours old" "$work/curl.payload"

reset
status ok "" "$(fresh '25 hours ago')"
bash "$watch" >/dev/null 2>&1
check "watch: stays quiet at 25 hours" test ! -f "$work/curl.called"

reset
status ok "" "garbage"
bash "$watch" >/dev/null 2>&1
check "watch: mails when updated_at is not a date" grep -q "is not a date" "$work/curl.payload"

reset
status ok "" "$(fresh '40 hours ago')"
STUB_CURL_EXIT=22 bash "$watch" >/dev/null 2>&1
check "watch: exits non-zero when the mail cannot be sent" test "$?" != 0

echo
[ "$fails" -eq 0 ] && echo "all passed" || { echo "$fails failed"; exit 1; }
