import type { SupabaseClient } from '@supabase/supabase-js';
import { enumerateVariations, type RawMoveRow } from '$lib/mastery/variations';
import { repertoireProgress, type RepertoireProgress } from '$lib/mastery/moveProgress';

export type RepertoireProgressSummary = RepertoireProgress & {
	id: string;
	name: string;
	color: string;
};

/**
 * Every repertoire a player can access (owned + assigned), each with its
 * computed mastery progress. Shared by the `/practice` picker and the
 * dashboard's mastered-repertoire count so both stay in sync with a single
 * query shape instead of duplicating it.
 */
export async function loadRepertoireProgressSummaries(
	supabase: SupabaseClient,
	userId: string
): Promise<RepertoireProgressSummary[]> {
	const [{ data: ownReps }, { data: assigned }] = await Promise.all([
		supabase.from('repertoires').select('id, name, color').eq('player_id', userId),
		supabase
			.from('assigned_repertoires')
			.select('repertoire:repertoire_id(id, name, color)')
			.eq('player_id', userId)
	]);

	const assignedReps = (assigned ?? []).map((a: any) => a.repertoire).filter(Boolean);
	const seen = new Set((ownReps ?? []).map((r: any) => r.id));
	const allReps = [...(ownReps ?? []), ...assignedReps.filter((r: any) => !seen.has(r.id))];

	if (allReps.length === 0) return [];

	const repIds = allReps.map((r: any) => r.id);
	const { data: rawMoves } = await supabase
		.from('moves')
		.select('id, san, is_player_turn, repertoire_id, from_position, to_position')
		.in('repertoire_id', repIds);

	// Only level/satisfiedCount/totalVariations/totalLevels are needed here,
	// all derived purely from moveId/isPlayerTurn — never from FEN — so the
	// fen columns aren't fetched (unlike the [repertoire_id] detail page,
	// which needs them to render the board).
	const movesByRep = new Map<string, RawMoveRow[]>();
	for (const m of (rawMoves ?? []) as any[]) {
		const list = movesByRep.get(m.repertoire_id) ?? [];
		list.push({
			id: m.id,
			san: m.san,
			isPlayerTurn: m.is_player_turn,
			fromPositionId: m.from_position,
			toPositionId: m.to_position,
			fromFen: '',
			toFen: ''
		});
		movesByRep.set(m.repertoire_id, list);
	}

	// Filtered via the moves relation (not `.in('move_id', allMoveIds)`) — with
	// move ids embedded directly in the request URL, a player with enough
	// total moves across their repertoires can exceed URL length limits,
	// silently failing the query and making solved progress look like it
	// never saved.
	const { data: progressRows } = await supabase
		.from('move_progress')
		.select('move_id, state, moves!inner(repertoire_id)')
		.eq('player_id', userId)
		.in('moves.repertoire_id', repIds);

	return allReps.map((r: any) => {
		const variations = enumerateVariations(movesByRep.get(r.id) ?? []);
		// `progressRows` spans every repertoire's move ids at once (one query),
		// but repertoireProgress only ever looks up ids that appear in this
		// repertoire's own `variations`, so passing the full set is harmless —
		// no need to pre-split it per repertoire.
		const progress = repertoireProgress(variations, progressRows ?? []);
		return { id: r.id, name: r.name, color: r.color, ...progress };
	});
}
