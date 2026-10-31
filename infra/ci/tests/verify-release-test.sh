#!/usr/bin/env bash
#
# Shell test of verify-release.sh with a stub curl on PATH; nothing is requested.
#
#   bash infra/ci/tests/verify-release-test.sh
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

# Stub curl: answers by the URL's path. STUB_COMMIT is the commit /api/version
# reports (empty: it answers 500); STUB_BAD is a path that answers 503;
# STUB_FAIL_FIRST is how many calls fail (exit 7) before it behaves.
mkdir "$work/bin"
cat > "$work/bin/curl" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$STUB_DIR/curl.calls"
n="$(wc -l < "$STUB_DIR/curl.calls")"
[ "$n" -gt "${STUB_FAIL_FIRST:-0}" ] || exit 7
url="${*: -1}"
path="/${url#https://*/}"
if [ "$path" = /api/version ]; then
  [ -n "${STUB_COMMIT:-}" ] || exit 22
  printf '{"commit":"%s"}' "$STUB_COMMIT"
  exit 0
fi
if [ "$path" = "${STUB_BAD:-none}" ]; then printf 503; else printf 200; fi
STUB
chmod +x "$work/bin/curl"
export STUB_DIR="$work" PATH="$work/bin:$PATH" VERIFY_ATTEMPTS=3 VERIFY_INTERVAL=0 VERIFY_HOST=mychess.example

# shellcheck source=infra/ci/verify-release.sh
source "$here/verify-release.sh"
sha=0123456789abcdef0123456789abcdef01234567
reset() { rm -f "$work/curl.calls"; touch "$work/curl.calls"; unset STUB_COMMIT STUB_BAD STUB_FAIL_FIRST; }
run() { verify_release "$1" > "$work/out" 2> "$work/err"; }

reset; export STUB_COMMIT=$sha
run "$sha-arm64"
check "passes when the commit matches and every page answers" test "$?" = 0
check "asks through the site's name resolved to this host" grep -q -- "--resolve mychess.example:443:127.0.0.1" "$work/curl.calls"
check "asks for the version and the two pages" test "$(grep -c . "$work/curl.calls")" = 3
check "the home page and the sign-in page" bash -c 'for p in / /prisijungti; do grep -q "https://mychess.example$p\$" "$1" || exit 1; done' _ "$work/curl.calls"
check "pages follow redirects (a signed-out / goes to sign-in)" test "$(grep -c -- ' -L ' "$work/curl.calls")" = 2
check "no warning for a sha tag" test ! -s "$work/err"

reset; export STUB_COMMIT=ffffffffffffffffffffffffffffffffffffffff
run "$sha-arm64"
check "fails when the running commit is another one" test "$?" = 1
check "and names both commits" grep -q "names ffffffffffffffffffffffffffffffffffffffff, expected $sha" "$work/err"
check "after exactly the attempts" test "$(grep -c '/api/version' "$work/curl.calls")" = 3

reset; export STUB_COMMIT=null
run "$sha-arm64"
check "an image built without a commit does not pass for a sha tag" test "$?" = 1

reset
run "$sha-arm64"
check "fails when /api/version does not answer 200" test "$?" = 1
check "and says so" grep -q "GET /api/version did not answer 200" "$work/err"

reset; export STUB_COMMIT=$sha STUB_BAD=/prisijungti
run "$sha-arm64"
check "fails when a page does not answer 200" test "$?" = 1
check "and names the page and its status" grep -q "GET /prisijungti answered 503 instead of 200" "$work/err"

reset; export STUB_COMMIT=$sha STUB_FAIL_FIRST=2
run "$sha-arm64"
check "retries: passes once the web starts answering" test "$?" = 0

reset; export STUB_COMMIT=null
run main-arm64
check "a branch tag skips the comparison" test "$?" = 0
check "with a warning" grep -q "warning: main-arm64 is not <40-hex sha>-arm64" "$work/err"

reset; export STUB_COMMIT=null SKIP_VERSION_CHECK=1
run "$sha-arm64"
check "skip set: passes without the comparison" test "$?" = 0
check "and warns loudly" grep -q "WARNING: SKIP_VERSION_CHECK=1" "$work/err"
check "skip set: the version is not even asked for" bash -c '! grep -q api/version "$1"' _ "$work/curl.calls"

reset; export STUB_COMMIT=null SKIP_VERSION_CHECK=1 STUB_BAD=/
run "$sha-arm64"
check "skip set: a page that fails still fails" test "$?" = 1
unset SKIP_VERSION_CHECK

reset; export STUB_COMMIT=$sha
run "${sha}-amd64"
check "a tag that only resembles a sha tag is not compared either" grep -q "warning:" "$work/err"

reset; export STUB_COMMIT=$sha
VERIFY_HOST='' run "$sha-arm64"
check "no VERIFY_HOST: fails" test "$?" = 1
check "and asks nothing" test ! -s "$work/curl.calls"

reset; export STUB_COMMIT=$sha VERIFY_HOST=other.example
run "$sha-arm64"
check "VERIFY_HOST changes the name asked for" grep -q "https://other.example/prisijungti" "$work/curl.calls"

echo
[ "$fails" -eq 0 ] && echo "all passed" || { echo "$fails failed"; exit 1; }
