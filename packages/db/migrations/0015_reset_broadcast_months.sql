-- One-time reset of the broadcast index's months (#355). Each deploy restarts
-- the web container and ended the month it was indexing: the month stayed
-- processing, then counted as a failed attempt after 15 minutes, and three
-- such restarts paused it for 24 hours (R-188). From #355 on, a starting
-- process gives such months back without spending an attempt
-- (releaseInterruptedBroadcastMonths); this resets the months the earlier
-- deploys left failed or processing, so production catches up without
-- access to the VM. Every failed or processing month becomes pending with no
-- attempts and no claim or failure time (no check constraint binds a pending
-- row); done months and their games stay. A data change, so a custom
-- migration; idempotent, as a second run finds no failed or processing month.
UPDATE "broadcast_months"
SET "state" = 'pending', "attempts" = 0, "claimed_at" = NULL, "failed_at" = NULL
WHERE "state" IN ('failed', 'processing');
