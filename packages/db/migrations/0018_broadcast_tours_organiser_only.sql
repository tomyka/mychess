-- Every broadcast tournament comes from an approved organiser's list since
-- pasting a link was removed (#360, R-201): the origin column goes and the
-- organiser is required. A pasted tournament would have no organiser; rather
-- than drop one, this migration stops with an error naming it, before any
-- change, so its data stays for the owner to decide on.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "broadcast_tours"
    WHERE "origin" <> 'organiser' OR "organiser" IS NULL
  ) THEN
    RAISE EXCEPTION 'broadcast_tours holds a pasted tournament (#360): not dropping it';
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "broadcast_tours" DROP CONSTRAINT "broadcast_tours_origin_check";--> statement-breakpoint
ALTER TABLE "broadcast_tours" DROP CONSTRAINT "broadcast_tours_organiser_check";--> statement-breakpoint
ALTER TABLE "broadcast_tours" ALTER COLUMN "organiser" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "broadcast_tours" DROP COLUMN "origin";--> statement-breakpoint
ALTER TABLE "broadcast_tours" ADD CONSTRAINT "broadcast_tours_organiser_check" CHECK ("broadcast_tours"."organiser" ~ '^[a-z0-9_-]{2,30}$');
