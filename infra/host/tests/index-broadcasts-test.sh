#!/usr/bin/env bash
#
# Shell test of index-broadcasts.sh with a stub curl on PATH; nothing is
# requested.
#
#   bash infra/host/tests/index-broadcasts-test.sh
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

# Stub curl: records its arguments and its stdin config, then answers like
# curl -w '\n%{http_code}': the body, a newline, the status. STUB_STATUS and
# STUB_BODY set the answer; STUB_CURL_EXIT fails it as an unreachable site.
mkdir "$work/bin"
cat > "$work/bin/curl" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" > "$STUB_DIR/curl.args"
cat > "$STUB_DIR/curl.config"
[ "${STUB_CURL_EXIT:-0}" = 0 ] || exit "$STUB_CURL_EXIT"
body='{"queued":3,"ready":9}'
[ -z "${STUB_BODY+set}" ] || body="$STUB_BODY"
printf '%s\n%s' "$body" "${STUB_STATUS:-202}"
STUB
chmod +x "$work/bin/curl"
secret=cron-SECRET-cron-secret-cron-secret-0123456789
export STUB_DIR="$work" PATH="$work/bin:$PATH" MYCHESS_PRODUCTION_ENV="$work/prod.env"
index="$here/index-broadcasts.sh"
reset() { rm -f "$work"/curl.* "$work/out"; unset STUB_CURL_EXIT STUB_STATUS STUB_BODY; printf 'POSTGRES_PASSWORD=x\nBETTER_AUTH_URL=https://mychess.example\nCRON_SECRET=%s\n' "$secret" > "$work/prod.env"; }

reset
bash "$index" > "$work/out" 2>&1
check "calls the route and exits 0 on a 202" test "$?" = 0
check "GET (no -X) on the site's index route" grep -qx 'url = "https://mychess.example/api/cron/index-broadcasts"' "$work/curl.config"
check "with the bearer CRON_SECRET" grep -qx "header = \"Authorization: Bearer $secret\"" "$work/curl.config"
check "through this host's Caddy" grep -qx 'resolve = "mychess.example:443:127.0.0.1"' "$work/curl.config"
check "the secret is not on the command line" bash -c '! grep -q SECRET "$1" && ! grep -q -- "-X" "$1"' _ "$work/curl.args"
check "prints the two counts only" grep -qx 'index broadcasts: queued 3, ready 9' "$work/out"
check "prints one line, not the secret" bash -c 'test "$(wc -l < "$1")" = 1 && ! grep -q SECRET "$1"' _ "$work/out"

reset
STUB_BODY='{ "queued": 0, "ready": 12 }' bash "$index" > "$work/out" 2>&1
check "reads spaced JSON and zero counts" grep -qx 'index broadcasts: queued 0, ready 12' "$work/out"

for status in 200 401 404 500 000; do
  reset
  STUB_STATUS="$status" STUB_BODY='{"error":"x"}' bash "$index" > "$work/out" 2>&1
  check "an HTTP $status fails the unit" test "$?" = 1
done
check "a failure names the status, not the body" bash -c 'grep -q "HTTP 000" "$1" && ! grep -q error "$1"' _ "$work/out"

reset
STUB_BODY='{"queued":3}' bash "$index" > /dev/null 2>&1
check "a 202 without both counts fails the unit" test "$?" = 1

reset
STUB_CURL_EXIT=28 bash "$index" > /dev/null 2>&1
check "an unreachable or timed-out site fails the unit" test "$?" != 0

reset
printf 'BETTER_AUTH_URL=https://mychess.example\nCRON_SECRET=short\n' > "$work/prod.env"
bash "$index" > /dev/null 2>&1
check "no proper CRON_SECRET: fails without a request" test "$?" = 1 -a ! -e "$work/curl.args"

reset
printf 'BETTER_AUTH_URL=http://mychess.example\nCRON_SECRET=%s\n' "$secret" > "$work/prod.env"
bash "$index" > /dev/null 2>&1
check "a non-https site: fails without a request" test "$?" = 1 -a ! -e "$work/curl.args"

reset
MYCHESS_PRODUCTION_ENV="$work/missing.env" bash "$index" > /dev/null 2>&1
check "no env file: fails without a request" test "$?" = 1 -a ! -e "$work/curl.args"

echo
[ "$fails" -eq 0 ] && echo "all passed" || { echo "$fails failed"; exit 1; }
