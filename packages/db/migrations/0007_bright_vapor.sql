CREATE TABLE "coach_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"coach_id" text NOT NULL,
	"repertoire_id" uuid NOT NULL,
	"move_key" text NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "coach_notes_coach_move_unique" UNIQUE("coach_id","repertoire_id","move_key"),
	CONSTRAINT "coach_notes_text_check" CHECK ("coach_notes"."text" = btrim("coach_notes"."text") and char_length("coach_notes"."text") between 1 and 2000)
);
--> statement-breakpoint
CREATE TABLE "repertoire_shares" (
	"repertoire_id" uuid NOT NULL,
	"player_id" text NOT NULL,
	"coach_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "repertoire_shares_pk" PRIMARY KEY("repertoire_id","coach_id")
);
--> statement-breakpoint
ALTER TABLE "coach_notes" ADD CONSTRAINT "coach_notes_share_fk" FOREIGN KEY ("repertoire_id","coach_id") REFERENCES "public"."repertoire_shares"("repertoire_id","coach_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repertoire_shares" ADD CONSTRAINT "repertoire_shares_owner_fk" FOREIGN KEY ("repertoire_id","player_id") REFERENCES "public"."repertoires"("id","owner_account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repertoire_shares" ADD CONSTRAINT "repertoire_shares_link_fk" FOREIGN KEY ("coach_id","player_id") REFERENCES "public"."coach_links"("coach_id","player_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "coach_notes_repertoire_idx" ON "coach_notes" USING btree ("repertoire_id");--> statement-breakpoint
CREATE INDEX "repertoire_shares_link_idx" ON "repertoire_shares" USING btree ("coach_id","player_id");