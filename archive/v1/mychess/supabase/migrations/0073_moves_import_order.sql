-- moves.import_order: a within-import-call ordering tie-break.
--
-- `fetchLiveMoves` (src/lib/server/moves.ts) orders moves by `created_at`
-- then `id` "so each chapter surfaces in its true import order" — but
-- `created_at` only distinguishes moves written in DIFFERENT `writeMoves()`
-- calls (one per chapter). Every move written within the SAME call shares
-- one identical `created_at` (a bulk upsert evaluates `now()` once per
-- statement), so ordering within a chapter silently fell back to `id`, a
-- random UUID with no relationship to the PGN's own move order — verified
-- against a real 2481-move repertoire, where all ~275 moves of one chapter
-- shared one timestamp down to the microsecond. This is what made "Learn"
-- auto-select a variation that wasn't first in the chapter's own reading
-- order after a fresh import (GitHub issue, reported 2026-09-01).
--
-- `import_order` records each move's own position in the PARSER's move
-- array at write time (see `writeMoves` in src/lib/server/pgn-import.ts) —
-- correct only WITHIN one call, never compared across calls/chapters,
-- which is why it doesn't need to be globally unique or sequence-generated:
-- `created_at` already separates chapters correctly on its own.
--
-- Nullable, no backfill: existing rows (imported before this column
-- existed) keep falling through to the old `id` tie-break exactly as
-- before — this only fixes ordering for repertoires imported or
-- re-uploaded from here on.
alter table public.moves
  add column import_order integer;

comment on column public.moves.import_order is
  'This move''s own position in the parser''s move array within the writeMoves() call that wrote it — a tie-break for moves sharing one created_at (a bulk upsert evaluates now() once per statement). Only meaningful WITHIN one call/chapter, never compared across them; null on rows imported before this column existed.';
