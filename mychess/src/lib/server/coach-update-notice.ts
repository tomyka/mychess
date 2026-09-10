// mychess/src/lib/server/coach-update-notice.ts
//
// The one number behind the student-facing "your coach updated this
// repertoire" notice: how many of this student's learned lines a coach's
// reshape of it sent back to review, and still have not been re-learned.
// Today the only such reshape is removing a chapter.
//
// Reconciliation (`./repertoire-reconcile.ts`) is what produces that state: a
// line the coach extended or diverged loses its `variation_solved` row and
// gains an append-only `variation_demotions` row with cause `coach_update`.
// This module only READS it back — it writes nothing and owns no state.

import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchAllPages, MAX_ROWS_PAGE_SIZE } from './paginate';
import { loadSolvedKeys } from './practice-progress';

/**
 * How many lines a coach's update knocked back to review and this student has
 * not re-learned yet: the count of DISTINCT `variation_key`s that have a
 * `coach_update` demotion for this player and repertoire AND no
 * `variation_solved` row.
 *
 * ## Why there is no dismissal flag, and why one must not be added
 *
 * That definition is SELF-CLEARING by construction. Re-learning a demoted line
 * writes its `variation_solved` row, which drops the line out of the count on
 * its own; when the last one is re-learned the count reaches 0 and the banner
 * stops rendering with nothing having been marked, acknowledged or expired.
 *
 * So there is deliberately no `dismissed_at`, no `acknowledged_at` and no
 * notice table — and adding one would be a regression, not a feature. Any such
 * column is a SECOND source of truth for "is this student caught up", which
 * means a state where the two disagree: a flag set before the lines were
 * actually re-learned hides the notice while the work is still outstanding, and
 * a flag left unset after they were shows a stale number forever. It would also
 * need a migration, a write path on a read-only page load, and a rule for what
 * clears it on the NEXT reshape. The derived count needs none of that, and
 * cannot get stuck: it is recomputed from the rows themselves on every load.
 *
 * ## Why the anti-join happens in TypeScript
 *
 * PostgREST cannot express "rows in A with no matching row in B" across two
 * tables without a view or an RPC, so both key sets are fetched and subtracted
 * here. Both reads PAGE: PostgREST silently truncates an unbounded select at
 * `max_rows` (1000), and a student working a large repertoire holds more than
 * that in `variation_solved` alone — a truncated solved set would read back as
 * "never learned" and OVERSTATE the count, which is exactly the "mastery moved
 * for no reason" confusion the notice exists to prevent. The demotion side
 * pages via `fetchAllPages` directly, and its paired count query repeats the
 * page query's filters exactly; a count carrying a different filter would have
 * the pager read past the end.
 *
 * The solved side is `loadSolvedKeys` — the shared read every other consumer of
 * that table already uses — rather than a second copy of the same paged query.
 * It scopes by player AND repertoire even though the table's uniqueness is
 * `(player_id, variation_key)` and the player filter alone would give the same
 * answer (keys are chains of move UUIDs, so they cannot collide across
 * repertoires): the redundant filter keeps the fetch proportional to this
 * repertoire instead of the student's entire library, and uses the same index.
 * It throws rather than truncating on failure, which the catch below turns into
 * the same 0 any other read failure yields.
 *
 * `DISTINCT` matters because `variation_demotions` is an append-only audit log:
 * a line demoted by two successive reshapes has two rows, and counting rows
 * rather than keys would tell the student two lines need review when one does.
 * Deduping is what the `Set` here is for.
 *
 * Returns 0 on any read failure — this is a decoration on a practice page, and
 * a failed count must not take the drill down with it.
 */
export async function coachUpdatedLineCount(
	supabase: SupabaseClient,
	playerId: string,
	repertoireId: string
): Promise<number> {
	try {
		const [demotedRows, solved] = await Promise.all([
			fetchAllPages<{ variation_key: string }>(
				() =>
					supabase
						.from('variation_demotions')
						.select('variation_key')
						.eq('player_id', playerId)
						.eq('repertoire_id', repertoireId)
						.eq('cause', 'coach_update')
						// Secondary sort on the primary key: `variation_key` alone is not
						// unique in this append-only log, and `.range()` paging over a
						// non-deterministic order can drop or repeat rows at a page seam.
						.order('variation_key', { ascending: true })
						.order('id', { ascending: true }),
				() =>
					supabase
						.from('variation_demotions')
						.select('id', { count: 'exact', head: true })
						.eq('player_id', playerId)
						.eq('repertoire_id', repertoireId)
						.eq('cause', 'coach_update'),
				MAX_ROWS_PAGE_SIZE
			),
			loadSolvedKeys(supabase, playerId, repertoireId)
		]);

		const outstanding = new Set<string>();
		for (const row of demotedRows) {
			if (!solved.has(row.variation_key)) outstanding.add(row.variation_key);
		}
		return outstanding.size;
	} catch (err) {
		console.error('coachUpdatedLineCount: read failed:', err instanceof Error ? err.message : err);
		return 0;
	}
}
