-- One-time reset of the broadcast months stored done without games (#357).
-- The dump decoder stopped at the first zstd frame of a month's dump, so
-- every month processed before the fix was written done with a game count
-- of 0 and no games. A real month always has games, so a done month with a
-- count of 0 is that bug. Each such month becomes pending with no attempts
-- and no claim, failure or processed time and no game count (no check
-- constraint binds a pending row), so the nightly job and the next search
-- index it again with the fixed decoder. Done months with games, their
-- games, other states and the tournaments stay. A data change, so a custom
-- migration; idempotent, as a second run finds no done month with 0 games.
UPDATE "broadcast_months"
SET "state" = 'pending', "attempts" = 0, "claimed_at" = NULL,
  "failed_at" = NULL, "processed_at" = NULL, "game_count" = NULL
WHERE "state" = 'done' AND "game_count" = 0;
