#!/usr/bin/env bash
#
# Shell test of rate-limit-prune.sh with a stub curl on PATH; nothing is
# requested.
#
#   bash infra/host/tests/rate-limit-prune-test.sh
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

# Stub curl: records its arguments and its stdin config; STUB_CURL_EXIT fails it.
mkdir "$work/bin"
cat > "$work/bin/curl" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" > "$STUB_DIR/curl.args"
cat > "$STUB_DIR/curl.config"
[ "${STUB_CURL_EXIT:-0}" = 0 ] || exit "$STUB_CURL_EXIT"
printf '{"pruned":3}'
STUB
chmod +x "$work/bin/curl"
secret=cron-SECRET-cron-secret-cron-secret-0123456789
export STUB_DIR="$work" PATH="$work/bin:$PATH" MYCHESS_PRODUCTION_ENV="$work/prod.env"
prune="$here/rate-limit-prune.sh"
reset() { rm -f "$work"/curl.* "$work/out"; unset STUB_CURL_EXIT; printf 'POSTGRES_PASSWORD=x\nBETTER_AUTH_URL=https://mychess.example\nCRON_SECRET=%s\n' "$secret" > "$work/prod.env"; }

reset
bash "$prune" > "$work/out" 2>&1
check "calls the route and exits 0" test "$?" = 0
check "GET (no -X) on the site's prune route" grep -qx 'url = "https://mychess.example/api/cron/prune-rate-limits"' "$work/curl.config"
check "with the bearer CRON_SECRET" grep -qx "header = \"Authorization: Bearer $secret\"" "$work/curl.config"
check "through this host's Caddy" grep -qx 'resolve = "mychess.example:443:127.0.0.1"' "$work/curl.config"
check "the secret is not on the command line" bash -c '! grep -q SECRET "$1" && ! grep -q -- "-X" "$1"' _ "$work/curl.args"
check "fails on an HTTP error (-f)" grep -q -- "-fsS" "$work/curl.args"
check "prints the counts, not the secret" bash -c 'grep -q pruned "$1" && ! grep -q SECRET "$1"' _ "$work/out"

reset
STUB_CURL_EXIT=22 bash "$prune" > /dev/null 2>&1
check "a refused or failed request fails the unit" test "$?" != 0

reset
printf 'BETTER_AUTH_URL=https://mychess.example\nCRON_SECRET=short\n' > "$work/prod.env"
bash "$prune" > /dev/null 2>&1
check "no proper CRON_SECRET: fails without a request" test "$?" = 1 -a ! -e "$work/curl.args"

reset
printf 'BETTER_AUTH_URL=http://mychess.example\nCRON_SECRET=%s\n' "$secret" > "$work/prod.env"
bash "$prune" > /dev/null 2>&1
check "a non-https site: fails without a request" test "$?" = 1 -a ! -e "$work/curl.args"

reset
MYCHESS_PRODUCTION_ENV="$work/missing.env" bash "$prune" > /dev/null 2>&1
check "no env file: fails without a request" test "$?" = 1 -a ! -e "$work/curl.args"

echo
[ "$fails" -eq 0 ] && echo "all passed" || { echo "$fails failed"; exit 1; }
