// mychess/src/lib/server/repertoire-progress.ts
import type { SupabaseClient } from '@supabase/supabase-js';
import { enumerateVariations, type RawMoveRow } from '$lib/mastery/variations';
import { repertoireProgress, type RepertoireProgress, type LevelProgressRow } from '$lib/mastery/levelProgress';

export type RepertoireProgressSummary = RepertoireProgress & {
	id: string;
	name: string;
	color: string;
};

/**
 * Every repertoire a player can access (owned + assigned), each with its
 * computed mastery progress. Shared by the `/practice` picker and the
 * dashboard's mastered-repertoire count. Read-only — doesn't reconcile or
 * create `level_progress` rows (that's the detail page's job via
 * `loadSyncedLevelProgress`); a repertoire with no row yet just shows the
 * bootstrap "fresh Level 1" default.
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
	const [{ data: rawMoves }, { data: progressRows }] = await Promise.all([
		supabase
			.from('moves')
			.select('id, san, is_player_turn, repertoire_id, from_position, to_position')
			.in('repertoire_id', repIds),
		supabase
			.from('level_progress')
			.select('repertoire_id, level, prev_level_mistakes, queue')
			.eq('player_id', userId)
			.in('repertoire_id', repIds)
	]);

	// Only RepertoireProgress's fields are needed here, all derived purely
	// from moveId/isPlayerTurn — never from FEN — so the fen columns aren't
	// fetched (unlike the [repertoire_id] detail page, which needs them to
	// render the board).
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

	const rowByRep = new Map<string, LevelProgressRow>();
	for (const r of (progressRows ?? []) as any[]) {
		rowByRep.set(r.repertoire_id, { level: r.level, prevLevelMistakes: r.prev_level_mistakes, queue: r.queue });
	}

	return allReps.map((r: any) => {
		const variations = enumerateVariations(movesByRep.get(r.id) ?? []);
		const progress = repertoireProgress(variations, rowByRep.get(r.id) ?? null);
		return { id: r.id, name: r.name, color: r.color, ...progress };
	});
}
