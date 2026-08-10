// mychess/src/lib/server/practice-repertoire.ts
import { error } from '@sveltejs/kit';
import type { SupabaseClient } from '@supabase/supabase-js';
import { enumerateVariations, type RawMoveRow, type Variation } from '$lib/mastery/variations';

export type PracticeRepertoire = { id: string; name: string; color: string };

// Supabase/PostgREST caps an unbounded select at `max_rows` (1000, see
// supabase/config.toml) and truncates silently past that — no error, just
// fewer rows than actually exist. A single large repertoire can exceed this
// on its own; an incomplete move set shatters the tree `enumerateVariations`
// reconstructs into many short, disconnected fragments, producing bogus
// level counts and tasks that don't correspond to real opening lines. See
// the identical fix in `repertoire-progress.ts`'s `fetchAllMoves`. `.order`
// makes the pagination deterministic — `.range` alone has no defined
// traversal order to page through without it.
const MOVES_PAGE_SIZE = 1000;

async function fetchAllMoves(supabase: SupabaseClient, repertoireId: string): Promise<any[]> {
	const rows: any[] = [];
	for (let offset = 0; ; offset += MOVES_PAGE_SIZE) {
		const { data, error: err } = await supabase
			.from('moves')
			.select(
				'id, san, is_player_turn, from_position, to_position, from_pos:from_position(fen), to_pos:to_position(fen)'
			)
			.eq('repertoire_id', repertoireId)
			.order('id', { ascending: true })
			.range(offset, offset + MOVES_PAGE_SIZE - 1);
		if (err) throw err;
		rows.push(...(data ?? []));
		if (!data || data.length < MOVES_PAGE_SIZE) break;
	}
	return rows;
}

/**
 * Loads a repertoire a player can access (owned or coach-assigned) plus its
 * enumerated variations, or throws a 404 — the same authorization + move
 * fetch both the practice detail page's load and its attempt-reporting
 * endpoint need. Authorization is enforced entirely by RLS (`repertoires`'
 * and `moves`' own- and assigned-read policies) — a row simply won't come
 * back for a caller who isn't allowed to see it, so there's no need to
 * separately fetch and check the caller's full owned/assigned id lists here.
 */
export async function loadRepertoireVariations(
	supabase: SupabaseClient,
	// Unused now that RLS is the sole authorization check (see above) — kept
	// on the signature for documentation/stability rather than churning
	// every call site.
	_userId: string,
	repertoireId: string
): Promise<{ repertoire: PracticeRepertoire; variations: Variation[] }> {
	const [{ data: repertoire }, rawMoves] = await Promise.all([
		supabase.from('repertoires').select('id, name, color').eq('id', repertoireId).maybeSingle(),
		fetchAllMoves(supabase, repertoireId)
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
