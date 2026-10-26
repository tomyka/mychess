ALTER TABLE "review_results" DROP CONSTRAINT "review_results_pkey";--> statement-breakpoint
ALTER TABLE "review_results" ADD CONSTRAINT "review_results_player_result_pk" PRIMARY KEY("player_id","result_id");
