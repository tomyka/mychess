CREATE TABLE "broadcast_games" (
	"game_url" text PRIMARY KEY NOT NULL,
	"month" text NOT NULL,
	"white_fide_id" integer,
	"black_fide_id" integer,
	"white" text NOT NULL,
	"black" text NOT NULL,
	"date" date,
	"result" text NOT NULL,
	"eco" text,
	"opening" text,
	"event" text NOT NULL,
	CONSTRAINT "broadcast_games_fide_id_check" CHECK (num_nonnulls("broadcast_games"."white_fide_id", "broadcast_games"."black_fide_id") > 0 and coalesce("broadcast_games"."white_fide_id", 1) > 0 and coalesce("broadcast_games"."black_fide_id", 1) > 0),
	CONSTRAINT "broadcast_games_sides_check" CHECK ("broadcast_games"."white_fide_id" <> "broadcast_games"."black_fide_id"),
	CONSTRAINT "broadcast_games_result_check" CHECK ("broadcast_games"."result" in ('1-0', '0-1', '1/2-1/2', '*')),
	CONSTRAINT "broadcast_games_url_check" CHECK ("broadcast_games"."game_url" ~ '^https://lichess\.org/[A-Za-z0-9/_-]+$')
);
--> statement-breakpoint
CREATE TABLE "broadcast_months" (
	"month" text PRIMARY KEY NOT NULL,
	"state" text NOT NULL,
	"attempts" integer NOT NULL,
	"game_count" integer,
	"claimed_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"processed_at" timestamp with time zone,
	CONSTRAINT "broadcast_months_month_check" CHECK ("broadcast_months"."month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "broadcast_months_state_check" CHECK ("broadcast_months"."state" in ('pending', 'processing', 'done', 'failed')),
	CONSTRAINT "broadcast_months_attempts_check" CHECK ("broadcast_months"."attempts" >= 0),
	CONSTRAINT "broadcast_months_claimed_check" CHECK ("broadcast_months"."state" <> 'processing' or "broadcast_months"."claimed_at" is not null),
	CONSTRAINT "broadcast_months_done_check" CHECK ("broadcast_months"."state" <> 'done' or ("broadcast_months"."processed_at" is not null and "broadcast_months"."game_count" is not null)),
	CONSTRAINT "broadcast_months_failed_check" CHECK ("broadcast_months"."state" <> 'failed' or "broadcast_months"."failed_at" is not null)
);
--> statement-breakpoint
ALTER TABLE "broadcast_games" ADD CONSTRAINT "broadcast_games_month_broadcast_months_month_fk" FOREIGN KEY ("month") REFERENCES "public"."broadcast_months"("month") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "broadcast_games_month_idx" ON "broadcast_games" USING btree ("month");--> statement-breakpoint
CREATE INDEX "broadcast_games_white_fide_id_idx" ON "broadcast_games" USING btree ("white_fide_id");--> statement-breakpoint
CREATE INDEX "broadcast_games_black_fide_id_idx" ON "broadcast_games" USING btree ("black_fide_id");