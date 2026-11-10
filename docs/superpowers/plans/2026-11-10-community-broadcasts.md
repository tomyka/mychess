# Plan: community broadcasts and the current month

Spec: `docs/superpowers/specs/2026-11-10-community-broadcasts-design.md`. Issue #349.

Each task: developer (test first) -> architect -> security-reviewer if marked -> lead checks (R-193) and commits.

1. **Lichess broadcast API clients** - integrations-dev: `by/{account}` paged, tour JSON, round-link resolution, tour PGN through the existing header parser; token header; limits and 429 handling. - SECURITY
2. **Domain rules and tournament store** - backend-dev: approved organisers, qualification, link parsing, de-duplication, paste rate limit; `broadcast_tours`, game source, migration, repositories (queue, claim, write, search across months and tournaments). - SECURITY
3. **Web** - web-dev: nightly job extended, runner processes tournaments, paste field and action, search merge and de-duplication, page text. - UX
4. **Token** - devops: `LICHESS_TOKEN` in env schema docs, `production-env.sh`, `set-secret.sh`, operations note; owner sets it on the VM.
5. **E2E and docs** - qa: a pasted-link journey and a community tournament from the fixture source; operations note.
