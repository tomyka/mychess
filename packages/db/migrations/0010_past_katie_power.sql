CREATE TABLE "review_results" (
	"result_id" uuid PRIMARY KEY NOT NULL,
	"player_id" text NOT NULL,
	"move_key" text NOT NULL,
	"repertoire_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"answered_at" timestamp with time zone NOT NULL,
	"applied" boolean NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	CONSTRAINT "review_results_kind_check" CHECK ("review_results"."kind" in ('learned', 'pass', 'lapse', 'hint'))
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"player_id" text NOT NULL,
	"move_key" text NOT NULL,
	"due" timestamp with time zone NOT NULL,
	"stability" double precision NOT NULL,
	"difficulty" double precision NOT NULL,
	"elapsed_days" integer NOT NULL,
	"scheduled_days" integer NOT NULL,
	"learning_steps" integer NOT NULL,
	"reps" integer NOT NULL,
	"lapses" integer NOT NULL,
	"state" smallint NOT NULL,
	"last_review" timestamp with time zone,
	"lapse_times" timestamp with time zone[] DEFAULT '{}' NOT NULL,
	"learned_at" timestamp with time zone,
	"skipped_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "reviews_player_id_move_key_pk" PRIMARY KEY("player_id","move_key"),
	CONSTRAINT "reviews_entered_once" CHECK (("reviews"."learned_at" is null) <> ("reviews"."skipped_at" is null)),
	CONSTRAINT "reviews_state_check" CHECK ("reviews"."state" between 0 and 3)
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "session_size" integer DEFAULT 20 NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "new_per_day" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "review_results" ADD CONSTRAINT "review_results_player_id_accounts_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_player_id_accounts_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "review_results_player_idx" ON "review_results" USING btree ("player_id","answered_at");--> statement-breakpoint
CREATE INDEX "reviews_player_due_idx" ON "reviews" USING btree ("player_id","due");--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_session_size_check" CHECK ("accounts"."session_size" between 10 and 100);--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_new_per_day_check" CHECK ("accounts"."new_per_day" between 0 and 50);