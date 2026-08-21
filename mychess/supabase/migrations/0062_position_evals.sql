-- Precomputed engine evaluations for known positions (issue #126, epic #124).
--
-- Why: the eval bar was costing every visitor to a drilling page a ~5.5MB
-- (brotli) Stockfish WASM download, purely to put a number on screen for
-- positions that are known in advance and identical for every player. `positions`
-- is global (one row per FEN, no repertoire_id), so one evaluation serves every
-- repertoire and every player that ever reaches that position.
--
-- Nothing here is per-player, so no new RLS policy is needed: these columns are
-- readable by whoever can already read the row.

alter table public.positions
  add column if not exists eval_cp integer,
  add column if not exists eval_mate integer,
  -- Which engine produced it. A stored eval whose engine no longer matches the
  -- current one is treated as ABSENT rather than as wrong data — that is what
  -- makes a net or search-time change safe to ship without a backfill first.
  add column if not exists eval_engine text,
  add column if not exists eval_at timestamptz;

-- The eval job's own work queue: rows still waiting for a score. Partial, so it
-- stays small as the table fills up.
create index if not exists positions_eval_pending_idx
  on public.positions (id)
  where eval_engine is null;

comment on column public.positions.eval_cp is
  'Centipawn score, WHITE-relative (positive is good for White), or null for a mate score. Written by scripts/eval-positions.ts.';
comment on column public.positions.eval_mate is
  'Moves-to-mate, WHITE-relative (positive means White mates), or null for a cp score.';
comment on column public.positions.eval_engine is
  'Engine identity that produced this eval. A mismatch with the app''s current engine means "no eval", never "wrong eval".';
