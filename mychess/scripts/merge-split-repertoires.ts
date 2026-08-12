// mychess/scripts/merge-split-repertoires.ts
import { createClient } from '@supabase/supabase-js';
import { planRepertoireMerges } from '../src/lib/repertoire-merge';
import { enumerateVariations } from '../src/lib/mastery/variations';
import { repertoireShape } from '../src/lib/mastery/levelProgress';
import { fetchAllMoves, toRawMoveRows } from '../src/lib/server/practice-repertoire';

const url = process.env.PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
	console.error('Missing PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
	process.exit(1);
}

const db = createClient(url, key);

async function recomputeAndWriteShape(canonicalId: string): Promise<void> {
	const mergedMoves = toRawMoveRows(await fetchAllMoves(db, canonicalId));
	const shape = repertoireShape(enumerateVariations(mergedMoves));
	const { error: shapeErr } = await db
		.from('repertoires')
		.update({
			total_variations: shape.totalVariations,
			total_levels: shape.totalLevels,
			level1_task_count: shape.level1TaskCount
		})
		.eq('id', canonicalId);
	if (shapeErr) throw shapeErr;
	console.log(`Recomputed shape for ${canonicalId}: ${JSON.stringify(shape)}`);
}

/**
 * Re-parents every move of `duplicateIds` onto `canonicalId`. Where a moved
 * edge collides with one the canonical repertoire already has (same
 * (repertoire_id, from_position, san) — a real unique constraint violation,
 * Postgres code 23505), the duplicate edge is dropped instead of merged:
 * accepted trade-off, see the design doc — any progress tied to that
 * specific dropped move id resets (its `moves` row is gone, and any
 * `move_attempts`/`variation_progress` row pointing at it cascades away with
 * it, same as if the player had never played it).
 *
 * `move_attempts.repertoire_id`, `variation_progress.repertoire_id`, and
 * `variation_practice_exclusions.repertoire_id` are their OWN columns (not
 * derived from move_id), each with `on delete cascade` FROM `repertoires` —
 * so a row referencing a move that DID survive the merge (re-parented, not
 * dropped) would still be destroyed when the duplicate repertoire row is
 * deleted, unless reassigned first. All three are bulk-reassigned to
 * `canonicalId` before the delete, for exactly this reason.
 *
 * `level_progress` is deliberately NOT reassigned: it's an aggregate
 * level/queue state built against ONE repertoire's own level structure,
 * which fundamentally changes once its variations merge into another
 * repertoire's tree — there's no sensible way to merge two independent
 * level/queue progressions, so the duplicate's `level_progress` row is
 * allowed to cascade away; the canonical repertoire's own `level_progress`
 * (if any) is unaffected, and its queue self-reconciles against the newly
 * larger variation set on next load (see `syncLevelProgress`). `reviews`,
 * `sessions`, and `review_events` are legacy tables superseded by
 * `level_progress`/`move_attempts` (see
 * `supabase/migrations/0025_move_progress.sql`'s own comment: "kept,
 * untouched, simply stop being written to") and are out of scope for the
 * same reason.
 *
 * Shape is recomputed after EVERY duplicate merge, not once at the end of
 * the whole group — if the script throws partway through a multi-duplicate
 * group, every merge completed so far already has a correct, up-to-date
 * shape instead of a stale one waiting on a future successful re-run.
 */
async function mergeGroup(canonicalId: string, duplicateIds: string[]): Promise<void> {
	for (const dupId of duplicateIds) {
		const dupMoves = await fetchAllMoves(db, dupId);

		for (const move of dupMoves as any[]) {
			const { error: updateErr } = await db.from('moves').update({ repertoire_id: canonicalId }).eq('id', move.id);
			if (updateErr) {
				if (updateErr.code === '23505') {
					const { error: deleteErr } = await db.from('moves').delete().eq('id', move.id);
					if (deleteErr) throw deleteErr;
					console.log(`  Dropped colliding move ${move.id} (${move.san}) from ${dupId}`);
					continue;
				}
				throw updateErr;
			}
		}

		const { error: attemptsErr } = await db
			.from('move_attempts')
			.update({ repertoire_id: canonicalId })
			.eq('repertoire_id', dupId);
		if (attemptsErr) throw attemptsErr;

		const { error: progressErr } = await db
			.from('variation_progress')
			.update({ repertoire_id: canonicalId })
			.eq('repertoire_id', dupId);
		if (progressErr) throw progressErr;

		const { error: exclusionsErr } = await db
			.from('variation_practice_exclusions')
			.update({ repertoire_id: canonicalId })
			.eq('repertoire_id', dupId);
		if (exclusionsErr) throw exclusionsErr;

		const { error: deleteRepErr } = await db.from('repertoires').delete().eq('id', dupId);
		if (deleteRepErr) throw deleteRepErr;
		console.log(`Merged repertoire ${dupId} into ${canonicalId} (${dupMoves.length} moves processed)`);

		await recomputeAndWriteShape(canonicalId);
	}
}

async function main() {
	const { data: repertoires, error } = await db.from('repertoires').select('id, player_id, color, name, created_at');
	if (error) throw error;

	const candidates = (repertoires ?? []).map((r: any) => ({
		id: r.id,
		playerId: r.player_id,
		color: r.color,
		name: r.name,
		createdAt: r.created_at
	}));

	const merges = planRepertoireMerges(candidates);
	if (merges.length === 0) {
		console.log('No split repertoires found — nothing to merge.');
		return;
	}

	console.log(`Found ${merges.length} group(s) to merge.`);
	for (const group of merges) {
		await mergeGroup(group.canonicalId, group.duplicateIds);
	}
	console.log('Done.');
}

main()
	.then(() => process.exit(0))
	.catch((e) => {
		console.error('Merge failed:', e);
		process.exit(1);
	});
