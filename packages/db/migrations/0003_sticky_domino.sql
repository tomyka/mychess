CREATE TABLE "chapters" (
	"repertoire_id" uuid NOT NULL,
	"chapter_id" text NOT NULL,
	"root_key" text NOT NULL,
	"name_source" jsonb NOT NULL,
	"intro" text,
	"ord" integer NOT NULL,
	CONSTRAINT "chapters_repertoire_id_chapter_id_pk" PRIMARY KEY("repertoire_id","chapter_id")
);
--> statement-breakpoint
CREATE TABLE "move_chapters" (
	"move_id" uuid NOT NULL,
	"repertoire_id" uuid NOT NULL,
	"chapter_id" text NOT NULL,
	CONSTRAINT "move_chapters_move_id_chapter_id_pk" PRIMARY KEY("move_id","chapter_id")
);
--> statement-breakpoint
CREATE TABLE "personal_notes" (
	"player_account_id" text NOT NULL,
	"repertoire_id" uuid NOT NULL,
	"move_key" text NOT NULL,
	"text" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "personal_notes_player_account_id_repertoire_id_move_key_pk" PRIMARY KEY("player_account_id","repertoire_id","move_key")
);
--> statement-breakpoint
CREATE TABLE "repertoire_moves" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repertoire_id" uuid NOT NULL,
	"from_key" text NOT NULL,
	"san" text NOT NULL,
	"to_key" text NOT NULL,
	"uci" text NOT NULL,
	"arrows" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"circles" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"comment" text,
	"ord" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "repertoires" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_account_id" text NOT NULL,
	"side" text NOT NULL,
	"name" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "repertoires_side_check" CHECK ("repertoires"."side" in ('white', 'black'))
);
--> statement-breakpoint
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_repertoire_id_repertoires_id_fk" FOREIGN KEY ("repertoire_id") REFERENCES "public"."repertoires"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "move_chapters" ADD CONSTRAINT "move_chapters_move_id_repertoire_moves_id_fk" FOREIGN KEY ("move_id") REFERENCES "public"."repertoire_moves"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "move_chapters" ADD CONSTRAINT "move_chapters_chapter_fk" FOREIGN KEY ("repertoire_id","chapter_id") REFERENCES "public"."chapters"("repertoire_id","chapter_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_notes" ADD CONSTRAINT "personal_notes_player_account_id_accounts_id_fk" FOREIGN KEY ("player_account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_notes" ADD CONSTRAINT "personal_notes_repertoire_id_repertoires_id_fk" FOREIGN KEY ("repertoire_id") REFERENCES "public"."repertoires"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repertoire_moves" ADD CONSTRAINT "repertoire_moves_repertoire_id_repertoires_id_fk" FOREIGN KEY ("repertoire_id") REFERENCES "public"."repertoires"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repertoires" ADD CONSTRAINT "repertoires_owner_account_id_accounts_id_fk" FOREIGN KEY ("owner_account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "move_chapters_repertoire_idx" ON "move_chapters" USING btree ("repertoire_id");--> statement-breakpoint
CREATE INDEX "personal_notes_repertoire_idx" ON "personal_notes" USING btree ("repertoire_id");--> statement-breakpoint
CREATE UNIQUE INDEX "repertoire_moves_position_idx" ON "repertoire_moves" USING btree ("repertoire_id","from_key","san");--> statement-breakpoint
CREATE INDEX "repertoires_owner_idx" ON "repertoires" USING btree ("owner_account_id");