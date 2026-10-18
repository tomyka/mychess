ALTER TABLE "move_chapters" DROP CONSTRAINT "move_chapters_move_id_repertoire_moves_id_fk";
--> statement-breakpoint
ALTER TABLE "move_chapters" ADD CONSTRAINT "move_chapters_move_fk" FOREIGN KEY ("move_id","repertoire_id") REFERENCES "public"."repertoire_moves"("id","repertoire_id") ON DELETE cascade ON UPDATE no action;