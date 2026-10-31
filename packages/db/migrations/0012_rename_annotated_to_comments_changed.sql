-- repertoire_changes.changes counted changed comments as `annotated` before
-- the rename to `commentsChanged` (#293). Renames the key in every stored row
-- so the schema reads only `commentsChanged`; a row that already has both
-- keeps `commentsChanged` and loses `annotated`. A data change, so a custom
-- migration; idempotent, as it only touches rows that still say `annotated`.
UPDATE "repertoire_changes"
SET "changes" = CASE
	WHEN "changes" ? 'commentsChanged' THEN "changes" - 'annotated'
	ELSE ("changes" - 'annotated')
		|| jsonb_build_object('commentsChanged', "changes" -> 'annotated')
END
WHERE jsonb_typeof("changes") = 'object' AND "changes" ? 'annotated';
