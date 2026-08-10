-- Per-repertoire cap on how many of the studied color's own moves a single
-- imported line may go, applied once at import time (creation-time setting,
-- not retroactively editable). Guards against a reference/theory PGN's
-- embedded illustrative "model game" stretching a repertoire's level count
-- to match one outlier deep line.
alter table public.repertoires
  add column max_variation_moves integer not null default 20
    check (max_variation_moves > 0);
