// mychess/src/lib/server/practice-repertoire.ts
import { error } from '@sveltejs/kit';
import type { SupabaseClient } from '@supabase/supabase-js';
import { mergeRepertoireIds } from '$lib/repertoire';
import { enumerateVariations, type RawMoveRow, type Variation } from '$lib/mastery/variations';

export type PracticeRepertoire = { id: string; name: string; color: string };

/**
 * Loads a repertoire a player can access (owned or coach-assigned) plus its
 * enumerated variations, or throws a 404 — the same authorization + move
 * fetch both the practice detail page's load and its attempt-reporting
 * endpoint need.
 */
export async function loadRepertoireVariations(
	supabase: SupabaseClient,
	userId: string,
	repertoireId: string
): Promise<{ repertoire: PracticeRepertoire; variations: Variation[] }> {
	const [{ data: ownReps }, { data: assigned }] = await Promise.all([
		supabase.from('repertoires').select('id').eq('player_id', userId),
		supabase.from('assigned_repertoires').select('repertoire_id').eq('player_id', userId)
	]);
	const allowedIds = mergeRepertoireIds(
		ownReps?.map((r) => r.id) ?? [],
		assigned?.map((a) => a.repertoire_id) ?? []
	);
	if (!allowedIds.includes(repertoireId)) {
		throw error(404, 'Repertoire not found');
	}

	const [{ data: repertoire }, { data: rawMoves }] = await Promise.all([
		supabase.from('repertoires').select('id, name, color').eq('id', repertoireId).single(),
		supabase
			.from('moves')
			.select(
				'id, san, is_player_turn, from_position, to_position, from_pos:from_position(fen), to_pos:to_position(fen)'
			)
			.eq('repertoire_id', repertoireId)
	]);

	if (!repertoire) {
		throw error(404, 'Repertoire not found');
	}

	const moves: RawMoveRow[] = (rawMoves ?? []).map((m: any) => ({
		id: m.id,
		san: m.san,
		isPlayerTurn: m.is_player_turn,
		fromPositionId: m.from_position,
		toPositionId: m.to_position,
		fromFen: m.from_pos?.fen ?? '',
		toFen: m.to_pos?.fen ?? ''
	}));

	return { repertoire, variations: enumerateVariations(moves) };
}
