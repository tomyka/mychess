# Archive

Read-only reference material. Nothing under `archive/` is built, linted, tested or deployed.

## v1 (`archive/v1/`)

The first mychess app (SvelteKit + Supabase, 2026-05-28 to 2026-09-15, 1243 commits), as it stood at tag `v1-final`. Archived at the v2 restart, issue #227.

Owner rulings on what to reuse (Q14 in #226):

| Port into v2 (re-implemented, with tests) | Where in v1 |
|---|---|
| ECO data, Lithuanian ECO names, generators | `mychess/src/lib/openings/eco-data*.ts`, `mychess/scripts/generate-eco-data*.ts` |
| Curated opening taxonomy | `mychess/src/lib/openings/taxonomy.ts` |
| Lithuanian chess terminology | `mychess/messages/lt.json` |
| PGN parser to position graph | `mychess/src/lib/pgn/parser.ts`, `mychess/src/lib/pgn-import.ts` |
| Board (chessground wrapper), pieces, themes | `mychess/src/lib/components/ChessBoard.svelte`, `mychess/static/pieces/`, `mychess/src/lib/board/` |
| FIDE import, chess-results scraper, Lichess/Chess.com OAuth (from M3) | `mychess/src/lib/fide/`, `mychess/src/lib/tournaments/`, `mychess/src/lib/server/{oauth,lichess,chesscom}.ts` |

Reference only: the learn/practice model (`mychess/src/lib/mastery/`), progress reconciliation (`mychess/src/lib/repertoire-reconcile.ts`), coach-player RLS patterns (`mychess/supabase/migrations/0019-0021, 0066-0067`), the domain glossary (`mychess/CONTEXT.md`), specs and plans (`docs/superpowers/`).

Left behind: Stockfish game analysis, gamification (badges, quests, cosmetics), Google Drive picker, repertoire encryption.

v1 production is frozen: its Vercel project ignores every build.
