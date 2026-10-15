# Restart as v2 and archive v1 in-repo

Status: accepted (2026-10-16, #226 Q12-Q14; owner-rulings R-6, R-28, R-29)

v1 (SvelteKit + Supabase, 1243 commits) had drifted through several training models, and the v2 product (coach-player coordination, FSRS, integrations) changes the domain at its core. We restart: the last v1 main is tagged `v1-final`, one commit moves it into `archive/v1/` (excluded from build, lint, CI and deploys), and v2 starts at the repo root. History is not rewritten. v1 production is frozen; v2 gets fresh Vercel and database infrastructure, and v1 users are migrated later only if any are real.

## Consequences

- v1 code is reference material, not a dependency. Pieces worth keeping (opening data, LT names and terminology, taxonomy, PGN parser, board, and at M3 the FIDE/chess-results/OAuth integrations) are re-implemented in v2 with tests, never imported from `archive/`. See `archive/README.md`.
- Left behind: Stockfish analysis, gamification, Google Drive picker, repertoire encryption.
- Tooling must keep `archive/` out of every glob (lint, tests, typecheck, knip, dependency-cruiser).

## Considered options

- Evolving v1 in place: rejected; both the stack and the training model change.
- A history rewrite: rejected; the repo keeps its issues, labels and full history.
