CREATE TABLE "broadcast_tours" (
	"tour_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"origin" text NOT NULL,
	"organiser" text,
	"official" boolean NOT NULL,
	"last_round_at" timestamp with time zone NOT NULL,
	"state" text NOT NULL,
	"attempts" integer NOT NULL,
	"game_count" integer,
	"claimed_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"processed_at" timestamp with time zone,
	CONSTRAINT "broadcast_tours_tour_id_check" CHECK ("broadcast_tours"."tour_id" ~ '^[A-Za-z0-9]{8}$'),
	CONSTRAINT "broadcast_tours_name_check" CHECK (char_length("broadcast_tours"."name") between 1 and 200),
	CONSTRAINT "broadcast_tours_origin_check" CHECK ("broadcast_tours"."origin" in ('organiser', 'pasted')),
	CONSTRAINT "broadcast_tours_organiser_check" CHECK (("broadcast_tours"."origin" = 'organiser') = ("broadcast_tours"."organiser" is not null) and ("broadcast_tours"."organiser" is null or "broadcast_tours"."organiser" ~ '^[a-z0-9_-]{2,30}$')),
	CONSTRAINT "broadcast_tours_state_check" CHECK ("broadcast_tours"."state" in ('pending', 'processing', 'done', 'failed')),
	CONSTRAINT "broadcast_tours_attempts_check" CHECK ("broadcast_tours"."attempts" >= 0),
	CONSTRAINT "broadcast_tours_claimed_check" CHECK ("broadcast_tours"."state" <> 'processing' or "broadcast_tours"."claimed_at" is not null),
	CONSTRAINT "broadcast_tours_done_check" CHECK ("broadcast_tours"."state" <> 'done' or ("broadcast_tours"."processed_at" is not null and "broadcast_tours"."game_count" is not null)),
	CONSTRAINT "broadcast_tours_failed_check" CHECK ("broadcast_tours"."state" <> 'failed' or "broadcast_tours"."failed_at" is not null)
);
--> statement-breakpoint
ALTER TABLE "broadcast_games" ALTER COLUMN "month" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "broadcast_games" ADD COLUMN "tour_id" text;--> statement-breakpoint
CREATE INDEX "broadcast_tours_last_round_at_idx" ON "broadcast_tours" USING btree ("last_round_at");--> statement-breakpoint
ALTER TABLE "broadcast_games" ADD CONSTRAINT "broadcast_games_tour_id_broadcast_tours_tour_id_fk" FOREIGN KEY ("tour_id") REFERENCES "public"."broadcast_tours"("tour_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "broadcast_games_tour_id_idx" ON "broadcast_games" USING btree ("tour_id");--> statement-breakpoint
ALTER TABLE "broadcast_games" ADD CONSTRAINT "broadcast_games_source_check" CHECK (num_nonnulls("broadcast_games"."month", "broadcast_games"."tour_id") = 1);