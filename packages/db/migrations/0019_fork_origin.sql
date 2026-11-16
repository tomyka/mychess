ALTER TABLE "repertoires" ADD COLUMN "forked_from_repertoire_id" uuid;--> statement-breakpoint
ALTER TABLE "repertoires" ADD COLUMN "forked_from_coach_name" text;--> statement-breakpoint
ALTER TABLE "repertoires" ADD CONSTRAINT "repertoires_forked_from_repertoire_id_repertoires_id_fk" FOREIGN KEY ("forked_from_repertoire_id") REFERENCES "public"."repertoires"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "repertoires_forked_from_idx" ON "repertoires" USING btree ("forked_from_repertoire_id");--> statement-breakpoint
ALTER TABLE "repertoires" ADD CONSTRAINT "repertoires_fork_origin_check" CHECK ("repertoires"."forked_from_repertoire_id" is null or "repertoires"."forked_from_coach_name" is not null);