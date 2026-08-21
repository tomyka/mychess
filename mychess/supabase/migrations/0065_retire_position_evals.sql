-- Retire the precomputed-eval pipeline (#132).
--
-- The evaluations in `positions` existed to fill the eval bar while drilling,
-- without the client downloading an engine (#126). The bar is gone from Learn
-- and Practice: the engine now runs only in explore mode, and only once the
-- player switches it on, evaluating whatever position is in front of them.
--
-- The COLUMNS STAY. The ~31k stored numbers cost nothing, and keeping them
-- makes reviving the pipeline a code change rather than a backfill. What this
-- migration removes is the misinformation: the column comments are live catalog
-- metadata, visible in Studio and `\d+ positions`, and they still advertised a
-- writer (`scripts/eval-positions.ts`) that no longer exists.

comment on column public.positions.eval_cp is
  'RETIRED (#132): nothing writes or reads this. Centipawn score, WHITE-relative (positive is good for White), or null for a mate score. Kept so the precompute pipeline can be revived without a backfill.';
comment on column public.positions.eval_mate is
  'RETIRED (#132): nothing writes or reads this. Moves-to-mate, WHITE-relative (positive means White mates), or null for a cp score.';
comment on column public.positions.eval_engine is
  'RETIRED (#132): nothing writes or reads this. Engine identity that produced the eval, back when one was being written.';
comment on column public.positions.eval_at is
  'RETIRED (#132): nothing writes or reads this. When the eval was written.';

-- The sweep's work queue, and nothing else ever read it. `eval_engine` is null
-- on every new row, so with the job gone this partial index is maintained on
-- every insert into a global, steadily growing table and answers no query.
-- Dropping an index needs no backfill and is reversible in one statement.
drop index if exists public.positions_eval_pending_idx;
