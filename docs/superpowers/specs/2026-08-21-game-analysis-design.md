# Game Analysis — design

## What this is

A new "Analysis" feature: a player uploads a PGN of one of their own games, and
gets a Lichess-analysis-board-style view — step through the game on a board,
see engine evaluation, and see every move classified (Inaccuracy / Mistake /
Blunder) against the engine's own top choice. Analyzed games are saved to a
new "My Games" section so they can be revisited without re-running the engine.

## Non-goals (v1)

- **No free-form exploration.** The board is read-only during review — you
  step through the game's actual recorded moves. Playing an alternative move
  at any point (Lichess's "what if" branching) is a natural fast-follow but
  is out of scope for v1: it needs move-legality handling on arbitrary
  positions and a way back to the main line, which is real additional surface
  area.
- **No multi-game PGN upload.** A file with more than one game (e.g. a
  Chess.com "download all games" export) is rejected with an error asking the
  user to split it. Picking one game from a multi-game file is a fast-follow,
  not v1.
- **No coach access.** This ships under `(player)` only. Coach-side analysis
  (of their own games, or a student's) is a separate future decision.
- **No single "accuracy %" metric.** Per-category move counts (blunders/
  mistakes/inaccuracies) are shown; inventing a single accuracy number is a
  non-trivial design problem on its own (Lichess's own formula isn't a simple
  average) and isn't needed for the feature to be useful.
- **No PGN variations.** If an uploaded PGN happens to contain RAV variations
  (rare for a real game export, common for a prepared study), only the
  mainline is imported; nested variations are silently dropped.

## Architecture

Follows the existing repo split between pure logic and Supabase I/O:

- `src/lib/games/` — pure logic, unit-tested, no DB:
  - `parse.ts` — wraps the existing `src/lib/pgn/parser.ts` (`parsePgn`) to
    extract exactly one game's mainline moves, or return a clear error if the
    PGN contains zero or more than one game.
  - `classify.ts` — move-classification math (see "Classification logic"
    below).
- `src/lib/server/games.ts` — Supabase I/O: create/list/fetch/delete a game,
  write back analysis results. Thin wrapper over the pure logic, not directly
  unit-tested (matches `server/pgn-import.ts`'s precedent) — exercised via the
  pure-logic tests plus manual/e2e verification.

Analysis execution stays entirely **client-side**, reusing the existing
Stockfish Worker infrastructure (`src/lib/engine/uci.ts`, the same WASM binary
`EngineEval.svelte` already loads) rather than introducing any server-side
engine. There is no Stockfish binary/infra on the server today, and this
feature doesn't need to be the first to add one.

## Data model

One new table, no child tables. v1 is single-game/mainline-only (no branching,
no shared position graph the way repertoires need), so the full move list plus
its analysis results fits as JSONB on one row:

```sql
create table games (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references auth.users(id) on delete cascade,
  pgn text not null,
  headers jsonb not null,        -- {White, Black, Event, Date, Result, ...} from the PGN
  played_as text check (played_as in ('white','black')),  -- null if not specified at upload
  moves jsonb not null,          -- [{ply, san, fen}], parsed once at upload
  analysis_status text not null default 'pending' check (analysis_status in ('pending','done')),
  analysis jsonb,                -- [{ply, evalCp, evalMate, bestMoveSan, classification}], written once by the client after it finishes
  created_at timestamptz not null default now()
);
```

RLS: owner-only (`player_id = auth.uid()`) for select/insert/update/delete,
split into single-operation policies per the project's own RLS convention
(a broad `for all` policy would silently defeat a narrower same-operation
policy). `revoke all ... from anon, public` since the table isn't meant to be
publicly readable.

This table and its RLS policies (`supabase/migrations/0061_games.sql`) have
already been applied to production as of 2026-08-21, ahead of the rest of
this feature — see the migration file for the exact statements.

## Routes

All under `src/routes/(player)/`, guarded by the existing `requireAccount`
pattern used by the sibling pages (`badges`, `drill`, `practice`, etc.):

- **`games/`** — "My Games" list. Each row: White/Black/Result/Date from the
  PGN headers, plus a quick summary once analyzed — blunder/mistake/
  inaccuracy counts for the `played_as` side, or "Not yet analyzed" if
  `analysis_status` is still `'pending'`. Includes a delete action per row.
- **`games/new/`** — upload form. Paste-text or file-upload, reusing the
  `PgnImportForm` patterns (`FileReader` for `.pgn` files, the Google Drive
  picker) minus the multi-chapter/color-tree logic that's repertoire-specific.
  Adds a White/Black/"not sure" toggle for `played_as`. The client parses via
  `parsePgn` only to validate before submitting (exactly one game, else a
  clear error asking the user to split the file); the server independently
  re-parses from the raw PGN rather than trusting client-parsed structure.
- **`games/[game_id]/`** — the analysis board itself: `ChessBoard` +
  `MoveNavRow` (both reused as-is) + a move list panel with classification
  badges + an eval graph across the whole game.
  - If `analysis_status === 'pending'`: this page is what triggers the
    client-side engine loop — walks every position in `moves` sequentially,
    one `go movetime` search each (same pattern as `EngineEval`, looped
    instead of on-demand), with a progress bar. On completion, `POST`s the
    full results array once to `games/[game_id]/analysis`.
  - If `'done'`: renders the stored `analysis` array directly — no engine
    needed to view a previously-analyzed game.
  - If the player navigates away mid-analysis, `analysis_status` simply stays
    `'pending'` and the loop restarts from scratch next time the page opens.
    No partial-resume complexity for v1.

## API

- `POST /api/games` — body `{ pgn, playedAs }`. Requires a real account.
  Re-parses `pgn` server-side via `src/lib/games/parse.ts` (never trusts
  client-parsed `moves`/`headers`), rejects zero-game or multi-game input,
  inserts with `analysis_status: 'pending'`. Returns `{ id }`.
- `POST /api/games/[id]/analysis` — body `{ analysis: [...] }`, one entry per
  move. Ownership-checked (404, not 403, for another player's game id).
  Validates length matches `moves.length`, sets `analysis_status: 'done'`.
- `DELETE /api/games/[id]` — ownership-checked, mirrors the existing
  repertoire delete endpoint's pattern.

## Classification logic

For move `i` (mover `S`, either side), converting engine evals to
`S`-relative (positive = good for whoever just moved), reusing the existing
`toWhiteRelative` transform as the building block:

```
beforeEval_S = toSRelative(engineEval(parentFen))   // S to move, best achievable
afterEval_S  = toSRelative(engineEval(childFen))    // opponent to move, after S's move
cpLoss       = max(0, beforeEval_S - afterEval_S)
```

Mate scores are mapped to a large constant cp-equivalent (signed) before this
subtraction, so a move that lets a forced mate through always classifies as a
Blunder regardless of the raw cp math.

Buckets (an intentionally simple cp-loss cutoff — same spirit as the existing
`evalBarWhiteFraction`'s documented "good enough for a quick sanity check, not
a serious analysis tool" approach; **not** a win%-curve model like Lichess
actually uses):

| cpLoss | Classification |
|---|---|
| 0–24 | (no flag — good/best) |
| 25–99 | Inaccuracy |
| 100–199 | Mistake |
| ≥200 | Blunder |

## Error handling

- Bad/empty/multi-game PGN at upload → inline validation error, nothing
  written to the DB.
- Engine Worker fails to load (WASM instantiation, network) → same `failed`
  pattern already used by `EngineEval`, with a retry button; `analysis_status`
  stays `'pending'`.
- The results `POST` failing after a full client-side analysis run → results
  are kept in memory and retried/manually retryable, rather than silently
  losing 15-30 seconds of just-computed work.
- Cross-account access to `games/[id]` (by URL guessing) → RLS plus an
  explicit ownership check in the API route; 404, not 403, to avoid leaking
  existence of another player's game.

## Testing

- Pure-logic unit tests: `src/lib/games/parse.test.ts` (single-vs-multi-game
  detection, mainline extraction), `src/lib/games/classify.test.ts` (cp-loss
  thresholds, mate-score handling, boundary cases at each bucket edge).
- `src/lib/server/games.ts` and the API routes: no direct unit tests, per the
  established convention — exercised via the pure-logic tests plus manual/
  e2e verification.
- A Playwright e2e for the golden path (upload → list → open) is worth having
  for the non-engine parts of the flow. Actually completing a full client-side
  engine analysis in headless CI is slow/heavy (a real WASM engine run per
  move); the exact e2e scope (mock the engine? skip analysis-completion
  assertions entirely?) is left to plan time rather than decided here.

## Open items carried into planning, not blocking this design

- Exact UI treatment of the eval graph (sparkline vs. full chart) — a plan-
  time / implementation detail, not a design decision with real trade-offs.
- Whether `games/new`'s upload form should offer to also save the game as a
  repertoire chapter — explicitly not requested, not included.
