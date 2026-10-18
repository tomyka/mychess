CREATE TABLE "coach_links" (
	"coach_id" text NOT NULL,
	"player_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "coach_links_pk" PRIMARY KEY("coach_id","player_id"),
	CONSTRAINT "coach_links_not_self" CHECK ("coach_links"."coach_id" <> "coach_links"."player_id")
);
--> statement-breakpoint
CREATE TABLE "group_members" (
	"group_id" uuid NOT NULL,
	"coach_id" text NOT NULL,
	"player_id" text NOT NULL,
	"joined_at" timestamp with time zone NOT NULL,
	CONSTRAINT "group_members_pk" PRIMARY KEY("group_id","player_id")
);
--> statement-breakpoint
CREATE TABLE "groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"coach_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "groups_id_coach_unique" UNIQUE("id","coach_id"),
	CONSTRAINT "groups_name_check" CHECK ("groups"."name" = btrim("groups"."name") and char_length("groups"."name") between 1 and 60)
);
--> statement-breakpoint
CREATE TABLE "invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"coach_id" text NOT NULL,
	"kind" text NOT NULL,
	"group_id" uuid,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"used_at" timestamp with time zone,
	"used_by" text,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "invites_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "invites_kind_check" CHECK ("invites"."kind" in ('personal', 'group')),
	CONSTRAINT "invites_group_kind" CHECK ("invites"."kind" <> 'group' or "invites"."group_id" is not null),
	CONSTRAINT "invites_used_personal" CHECK ("invites"."used_at" is null or "invites"."kind" = 'personal'),
	CONSTRAINT "invites_token_hash_check" CHECK ("invites"."token_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "coach_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "coach_links" ADD CONSTRAINT "coach_links_coach_id_accounts_id_fk" FOREIGN KEY ("coach_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coach_links" ADD CONSTRAINT "coach_links_player_id_accounts_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_group_fk" FOREIGN KEY ("group_id","coach_id") REFERENCES "public"."groups"("id","coach_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_link_fk" FOREIGN KEY ("coach_id","player_id") REFERENCES "public"."coach_links"("coach_id","player_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_coach_id_accounts_id_fk" FOREIGN KEY ("coach_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_coach_id_accounts_id_fk" FOREIGN KEY ("coach_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_used_by_accounts_id_fk" FOREIGN KEY ("used_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_group_fk" FOREIGN KEY ("group_id","coach_id") REFERENCES "public"."groups"("id","coach_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "coach_links_player_id_idx" ON "coach_links" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "group_members_link_idx" ON "group_members" USING btree ("coach_id","player_id");--> statement-breakpoint
CREATE INDEX "groups_coach_id_idx" ON "groups" USING btree ("coach_id");--> statement-breakpoint
CREATE INDEX "invites_coach_id_idx" ON "invites" USING btree ("coach_id");--> statement-breakpoint
CREATE INDEX "invites_used_by_idx" ON "invites" USING btree ("used_by");