# Sign-in with Better Auth instead of Auth.js

Status: accepted (2026-10-16, S1 brainstorm, #251). Amends ADR 0002 (its sign-in library only).

ADR 0002 chose Auth.js. When S1 started, Auth.js for Next.js (v5) was still a beta (5.0.0-beta.32, releases months apart), and the Auth.js project had been folded into Better Auth. Better Auth is stable (1.7.x) and actively released, and it covers every M1 sign-in need: email magic link (R-26), Google, Lichess through generic OAuth with PKCE (R-68), a Drizzle adapter, sessions stored in the database (R-80), and explicit account-linking rules (R-69).

## Consequences

- `packages/db` owns the Better Auth tables (user, session, account, verification) in its Drizzle schema, migrated like every other table.
- Account-linking and email-normalisation rules (security checklist items 6 and 7 on #233) are configured and tested in our code, not assumed from library defaults.
- Nothing had been built on Auth.js, so the switch costs nothing.

## Considered options

- Auth.js v5 beta, as ADR 0002 said: rejected, because it means running a long-lived beta in production.
