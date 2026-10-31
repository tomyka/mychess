#!/usr/bin/env bash
#
# Shell test of production-env.sh and set-secret.sh with a stub id on PATH and
# a temp directory as /srv/mychess; nothing on the host is touched.
#
#   bash infra/host/tests/production-env-test.sh
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

mkdir "$work/bin"
cat > "$work/bin/id" <<'STUB'
#!/usr/bin/env bash
echo "${STUB_UID:-0}"
STUB
chmod +x "$work/bin/id"
export PATH="$work/bin:$PATH" MYCHESS_ROOT="$work/srv"
env_file="$work/srv/production/.env"
penv="$here/production-env.sh"
secret="$here/set-secret.sh"
value() { sed -n "s/^$1=//p" "$env_file"; }
count() { grep -c "^$1=" "$env_file"; }
reset() { rm -rf "$work/srv" "$work/out" "$work/err"; unset STUB_UID; }

# --- production-env.sh
reset
bash "$penv" https://mychess.example > "$work/out" 2> "$work/err"
check "writes the env file" test "$?" = 0 -a -f "$env_file"
for key in POSTGRES_PASSWORD BETTER_AUTH_SECRET AUDIT_EMAIL_KEY CRON_SECRET; do
  check "generates $key" test -n "$(value "$key")"
done
check "the app's secrets are at least 32 characters" bash -c 'for k in BETTER_AUTH_SECRET AUDIT_EMAIL_KEY CRON_SECRET; do v="$(sed -n "s/^$k=//p" "$1")"; [ "${#v}" -ge 32 ] || exit 1; done' _ "$env_file"
check "the three app secrets differ" test "$(for k in BETTER_AUTH_SECRET AUDIT_EMAIL_KEY CRON_SECRET; do value "$k"; done | sort -u | wc -l)" = 3
check "BETTER_AUTH_URL is the site" test "$(value BETTER_AUTH_URL)" = https://mychess.example
check "MYCHESS_ENV is production" test "$(value MYCHESS_ENV)" = production
check "mail goes through Resend" test "$(value MAIL_TRANSPORT)" = resend
check "from noreply@ the site's domain" test "$(value MAIL_FROM)" = "mychess <noreply@mychess.example>"
check "never the persona sign-in" bash -c '! grep -q -e MYCHESS_TEST_SIGNIN -e TEST_SIGNIN_SECRET "$1"' _ "$env_file"
check "prints no value" bash -c '! grep -qF "$(sed -n "s/^CRON_SECRET=//p" "$1")" "$2"' _ "$env_file" "$work/out"
check "names the secrets still to store" grep -q "RESEND_API_KEY GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET LICHESS_CLIENT_ID" "$work/out"
touch "$work/probe"; chmod 600 "$work/probe"
if [ "$(stat -c %a "$work/probe")" = 600 ]; then
  check "the file is mode 600" test "$(stat -c %a "$env_file")" = 600
else
  ok "the file is mode 600 (skipped: this file system ignores modes)"
fi

before="$(value CRON_SECRET)"
bash "$penv" https://chess.example > /dev/null 2>&1
check "a re-run keeps every secret" test "$(value CRON_SECRET)" = "$before"
check "a re-run replaces BETTER_AUTH_URL" test "$(value BETTER_AUTH_URL)" = https://chess.example
check "with one line only" test "$(count BETTER_AUTH_URL)" = 1
check "and keeps MAIL_FROM" test "$(value MAIL_FROM)" = "mychess <noreply@mychess.example>"
check "no key twice" test -z "$(cut -d= -f1 "$env_file" | sort | uniq -d)"

for refused in http://mychess.example https://mychess.example/ https://MyChess.example "https://mychess.example/path" mychess.example; do
  reset
  bash "$penv" "$refused" > /dev/null 2>&1
  check "refuses '$refused'" test "$?" = 2 -a ! -e "$env_file"
done

reset
STUB_UID=1000 bash "$penv" https://mychess.example > /dev/null 2>&1
check "not root: refused" test "$?" = 1 -a ! -e "$env_file"

# --- set-secret.sh
reset
bash "$penv" https://mychess.example > /dev/null 2>&1
printf '  re_ABC123_def \n' | bash "$secret" RESEND_API_KEY > "$work/out" 2>&1
check "stores a Resend key from stdin, trimmed" test "$(value RESEND_API_KEY)" = re_ABC123_def
check "prints no value" bash -c '! grep -q ABC123 "$1"' _ "$work/out"
printf 're_NEW\n' | bash "$secret" RESEND_API_KEY > /dev/null 2>&1
check "a re-run replaces it" test "$(value RESEND_API_KEY)" = re_NEW -a "$(count RESEND_API_KEY)" = 1
check "and keeps the other keys" test "$(value BETTER_AUTH_URL)" = https://mychess.example

printf '123-abc.apps.googleusercontent.com\n' | bash "$secret" GOOGLE_CLIENT_ID > /dev/null 2>&1
check "stores the Google client id" test "$(value GOOGLE_CLIENT_ID)" = 123-abc.apps.googleusercontent.com
printf 'GOCSPX-secret_value\n' | bash "$secret" GOOGLE_CLIENT_SECRET > /dev/null 2>&1
check "stores the Google client secret" test "$(value GOOGLE_CLIENT_SECRET)" = GOCSPX-secret_value
printf 'mychess.example\n' | bash "$secret" LICHESS_CLIENT_ID > /dev/null 2>&1
check "stores the Lichess client id" test "$(value LICHESS_CLIENT_ID)" = mychess.example

printf 'not a key\n' | bash "$secret" RESEND_API_KEY > /dev/null 2>&1
check "refuses a value of the wrong shape" test "$?" = 2 -a "$(value RESEND_API_KEY)" = re_NEW
printf 'short\n' | bash "$secret" GOOGLE_CLIENT_SECRET > /dev/null 2>&1
check "refuses a too-short Google secret" test "$?" = 2
printf '\n' | bash "$secret" LICHESS_CLIENT_ID > /dev/null 2>&1
check "refuses an empty value" test "$?" = 2 -a "$(value LICHESS_CLIENT_ID)" = mychess.example
printf 'x=1\n' | bash "$secret" MYCHESS_TEST_SIGNIN > /dev/null 2>&1
check "refuses any other setting (the persona sign-in included)" test "$?" = 2
check "which never reaches the file" bash -c '! grep -q MYCHESS_TEST_SIGNIN "$1"' _ "$env_file"

reset
printf 're_X\n' | bash "$secret" RESEND_API_KEY > /dev/null 2>&1
check "no env file yet: refused" test "$?" = 1

echo
[ "$fails" -eq 0 ] && echo "all passed" || { echo "$fails failed"; exit 1; }
