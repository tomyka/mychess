CREATE TABLE "assignment_players" (
	"player_id" text NOT NULL,
	"repertoire_id" uuid NOT NULL,
	"paused_at" timestamp with time zone,
	"seen_version" integer,
	"forked_at" timestamp with time zone,
	CONSTRAINT "assignment_players_pk" PRIMARY KEY("player_id","repertoire_id")
);
--> statement-breakpoint
CREATE TABLE "assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"coach_id" text NOT NULL,
	"repertoire_id" uuid NOT NULL,
	"player_id" text,
	"group_id" uuid,
	"deadline" date,
	"assigned_version" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "assignments_one_target" CHECK (("assignments"."player_id" is null) <> ("assignments"."group_id" is null))
);
--> statement-breakpoint
CREATE TABLE "fork_coach_notes" (
	"repertoire_id" uuid NOT NULL,
	"move_key" text NOT NULL,
	"text" text NOT NULL,
	"coach_name" text NOT NULL,
	CONSTRAINT "fork_coach_notes_pk" PRIMARY KEY("repertoire_id","move_key")
);
--> statement-breakpoint
CREATE TABLE "fork_offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" text NOT NULL,
	"repertoire_id" uuid,
	"coach_name" text NOT NULL,
	"name" text NOT NULL,
	"side" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"declined_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"fork_id" uuid,
	CONSTRAINT "fork_offers_reason_check" CHECK ("fork_offers"."reason" in ('unassigned', 'unlinked', 'leftGroup', 'deleted')),
	CONSTRAINT "fork_offers_side_check" CHECK ("fork_offers"."side" in ('white', 'black'))
);
--> statement-breakpoint
CREATE TABLE "repertoire_changes" (
	"repertoire_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"changes" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "repertoire_changes_pk" PRIMARY KEY("repertoire_id","version")
);
--> statement-breakpoint
ALTER TABLE "assignment_players" ADD CONSTRAINT "assignment_players_player_id_accounts_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_players" ADD CONSTRAINT "assignment_players_repertoire_id_repertoires_id_fk" FOREIGN KEY ("repertoire_id") REFERENCES "public"."repertoires"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_repertoire_fk" FOREIGN KEY ("repertoire_id","coach_id") REFERENCES "public"."repertoires"("id","owner_account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_link_fk" FOREIGN KEY ("coach_id","player_id") REFERENCES "public"."coach_links"("coach_id","player_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_group_fk" FOREIGN KEY ("group_id","coach_id") REFERENCES "public"."groups"("id","coach_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fork_coach_notes" ADD CONSTRAINT "fork_coach_notes_repertoire_id_repertoires_id_fk" FOREIGN KEY ("repertoire_id") REFERENCES "public"."repertoires"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fork_offers" ADD CONSTRAINT "fork_offers_player_id_accounts_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fork_offers" ADD CONSTRAINT "fork_offers_repertoire_id_repertoires_id_fk" FOREIGN KEY ("repertoire_id") REFERENCES "public"."repertoires"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fork_offers" ADD CONSTRAINT "fork_offers_fork_id_repertoires_id_fk" FOREIGN KEY ("fork_id") REFERENCES "public"."repertoires"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repertoire_changes" ADD CONSTRAINT "repertoire_changes_repertoire_id_repertoires_id_fk" FOREIGN KEY ("repertoire_id") REFERENCES "public"."repertoires"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assignment_players_repertoire_idx" ON "assignment_players" USING btree ("repertoire_id");--> statement-breakpoint
CREATE UNIQUE INDEX "assignments_player_unique" ON "assignments" USING btree ("repertoire_id","player_id") WHERE "assignments"."player_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "assignments_group_unique" ON "assignments" USING btree ("repertoire_id","group_id") WHERE "assignments"."group_id" is not null;--> statement-breakpoint
CREATE INDEX "assignments_repertoire_idx" ON "assignments" USING btree ("repertoire_id","coach_id");--> statement-breakpoint
CREATE INDEX "assignments_link_idx" ON "assignments" USING btree ("coach_id","player_id");--> statement-breakpoint
CREATE INDEX "assignments_group_idx" ON "assignments" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "fork_offers_player_idx" ON "fork_offers" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "fork_offers_repertoire_idx" ON "fork_offers" USING btree ("repertoire_id");--> statement-breakpoint
CREATE INDEX "fork_offers_fork_idx" ON "fork_offers" USING btree ("fork_id");