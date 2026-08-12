// mychess/scripts/merge-split-repertoires.ts
import { createClient } from '@supabase/supabase-js';
import { planRepertoireMerges } from '../src/lib/repertoire-merge';
import { enumerateVariations, type RawMoveRow } from '../src/lib/mastery/variations';
import { repertoireShape } from '../src/lib/mastery/levelProgress';

const url = process.env.PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
	console.error('Missing PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
	process.exit(1);
}

const db = createClient(url, key);

async function fetchAllMovesForRepertoire(repertoireId: string): Promise<RawMoveRow[]> {
	const { data, error } = await db
		.from('moves')
		.select('id, san, is_player_turn, from_position, to_position, from_pos:from_position(fen), to_pos:to_position(fen)')
		.eq('repertoire_id', repertoireId);
	if (error) throw error;
	return (data ?? []).map((m: any) => ({
		id: m.id,
		san: m.san,
		isPlayerTurn: m.is_player_turn,
		fromPositionId: m.from_position,
		toPositionId: m.to_position,
		fromFen: m.from_pos?.fen ?? '',
		toFen: m.to_pos?.fen ?? ''
	}));
}

/**
 * Re-parents every move of `duplicateIds` onto `canonicalId`. Where a moved
 * edge collides with one the canonical repertoire already has (same
 * (repertoire_id, from_position, san) — a real unique constraint violation,
 * Postgres code 23505), the duplicate edge is dropped instead of merged:
 * accepted trade-off, see the design doc — any progress tied to that
 * specific dropped move id resets.
 */
async function mergeGroup(canonicalId: string, duplicateIds: string[]): Promise<void> {
	for (const dupId of duplicateIds) {
		const { data: dupMoves, error: fetchErr } = await db.from('moves').select('id').eq('repertoire_id', dupId);
		if (fetchErr) throw fetchErr;

		for (const move of dupMoves ?? []) {
			const { error: updateErr } = await db.from('moves').update({ repertoire_id: canonicalId }).eq('id', move.id);
			if (updateErr) {
				if (updateErr.code === '23505') {
					const { error: deleteErr } = await db.from('moves').delete().eq('id', move.id);
					if (deleteErr) throw deleteErr;
					continue;
				}
				throw updateErr;
			}
		}

		const { error: deleteRepErr } = await db.from('repertoires').delete().eq('id', dupId);
		if (deleteRepErr) throw deleteRepErr;
		console.log(`Merged repertoire ${dupId} into ${canonicalId}`);
	}

	const mergedMoves = await fetchAllMovesForRepertoire(canonicalId);
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
