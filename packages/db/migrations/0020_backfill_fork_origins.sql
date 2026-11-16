-- Backfills what a fork records of where it came from (#328), for the forks
-- made before 0019 added forked_from_repertoire_id and
-- forked_from_coach_name. A data change, so a custom migration; idempotent,
-- as each statement only fills a repertoire that records no coach yet.
-- Forks it cannot derive stay null and show no "copy of" label. The steps
-- run in order, the surest first: a later one never overwrites an earlier.
--
-- 1. An accepted fork offer names its fork (fork_offers.fork_id): its source
--    (null once deleted, R-131) and the coach name it kept.
UPDATE "repertoires" AS r
SET "forked_from_repertoire_id" = o."repertoire_id",
    "forked_from_coach_name" = o."coach_name"
FROM "fork_offers" AS o
WHERE o."fork_id" = r."id"
  AND r."forked_from_coach_name" IS NULL;--> statement-breakpoint
-- 2. A forked assignment (assignment_players.forked_at) wrote its fork in
--    the same transaction with the same time: the player's one repertoire
--    created then, of the source's side, made by no offer. Only when exactly
--    one repertoire and one forked assignment of that player share the
--    time. The coach name is the one its coach notes kept, else the coach's
--    display name now.
UPDATE "repertoires" AS r
SET "forked_from_repertoire_id" = s."id",
    "forked_from_coach_name" = COALESCE(
      (SELECT n."coach_name" FROM "fork_coach_notes" AS n
       WHERE n."repertoire_id" = r."id" LIMIT 1),
      c."display_name"
    )
FROM "assignment_players" AS ap
JOIN "repertoires" AS s ON s."id" = ap."repertoire_id"
JOIN "accounts" AS c ON c."id" = s."owner_account_id"
WHERE ap."forked_at" IS NOT NULL
  AND r."owner_account_id" = ap."player_id"
  AND r."created_at" = ap."forked_at"
  AND r."side" = s."side"
  AND r."id" <> s."id"
  AND r."forked_from_coach_name" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "fork_offers" AS o WHERE o."fork_id" = r."id"
  )
  AND NOT EXISTS (
    SELECT 1 FROM "repertoires" AS other
    WHERE other."owner_account_id" = r."owner_account_id"
      AND other."created_at" = r."created_at"
      AND other."id" <> r."id"
  )
  AND NOT EXISTS (
    SELECT 1 FROM "assignment_players" AS twin
    WHERE twin."player_id" = ap."player_id"
      AND twin."forked_at" = ap."forked_at"
      AND twin."repertoire_id" <> ap."repertoire_id"
  );--> statement-breakpoint
-- 3. Any other repertoire with kept coach notes is a fork whose source is
--    gone or not derivable: the automatic fork of a coach already deleted
--    (R-49), or an earlier fork of a repertoire assigned again (R-128). Its
--    coach name is the one its notes carry, when they carry exactly one;
--    the source stays null (the check allows a name without a source).
UPDATE "repertoires" AS r
SET "forked_from_coach_name" = n."coach_name"
FROM (
  SELECT "repertoire_id", MIN("coach_name") AS "coach_name"
  FROM "fork_coach_notes"
  GROUP BY "repertoire_id"
  HAVING COUNT(DISTINCT "coach_name") = 1
) AS n
WHERE n."repertoire_id" = r."id"
  AND r."forked_from_coach_name" IS NULL;
