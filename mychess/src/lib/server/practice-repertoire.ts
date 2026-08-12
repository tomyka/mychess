// mychess/src/lib/server/practice-repertoire.ts
import { error } from '@sveltejs/kit';
import type { SupabaseClient } from '@supabase/supabase-js';
import { enumerateVariations, filterVariations, type RawMoveRow, type Variation } from '$lib/mastery/variations';

export type PracticeRepertoire = { id: string; name: string; color: string; practiceDepthLevels: number; chunkSize: number };

// Supabase/PostgREST caps an unbounded select at `max_rows` (1000, see
// supabase/config.toml) and truncates silently past that — no error, just
// fewer rows than actually exist. A single large repertoire can exceed this
// on its own; an incomplete move set shatters the tree `enumerateVariations`
// reconstructs into many short, disconnected fragments, producing bogus
// level counts and tasks that don't correspond to real opening lines. `.order`
// makes the pagination deterministic — `.range` alone has no defined
// traversal order to page through without it.
const MOVES_PAGE_SIZE = 1000;

/**
 * The `.range()` boundaries needed to fetch the rest of a result set after
 * an already-fetched first page, given the true total row count. Pure and
 * separately tested so the off-by-one page math can be verified without a
 * real Supabase client.
 */
export function remainingPageRanges(totalCount: number, pageSize: number): Array<[number, number]> {
	const totalPages = Math.ceil(totalCount / pageSize);
	return Array.from({ length: Math.max(0, totalPages - 1) }, (_, i) => {
		const page = i + 1;
		return [page * pageSize, page * pageSize + pageSize - 1] as [number, number];
	});
}

const MOVE_SELECT_COLUMNS =
	'id, san, is_player_turn, from_position, to_position, chapter_name, from_pos:from_position(fen), to_pos:to_position(fen)';

/**
 * Fetches every move row for a repertoire, defeating the `max_rows` cap
 * above. The common case (a repertoire fitting in one page) costs exactly
 * one round trip. A repertoire spanning multiple pages costs one more (an
 * exact-count lookup) plus a single round of every remaining page fetched
 * *concurrently* — rather than one round trip per page fetched
 * sequentially, which for a large repertoire (e.g. a multi-thousand-move
 * opening reference import) turned "open this page" into several seconds
 * of pure network latency.
 */
export async function fetchAllMoves(supabase: SupabaseClient, repertoireId: string): Promise<any[]> {
	const query = () =>
		supabase.from('moves').select(MOVE_SELECT_COLUMNS).eq('repertoire_id', repertoireId).order('id', { ascending: true });

	const { data: firstPage, error: err } = await query().range(0, MOVES_PAGE_SIZE - 1);
	if (err) throw err;
	const firstRows = firstPage ?? [];
	if (firstRows.length < MOVES_PAGE_SIZE) return firstRows;

	const { count, error: countErr } = await supabase
		.from('moves')
		.select('id', { count: 'exact', head: true })
		.eq('repertoire_id', repertoireId);
	if (countErr) throw countErr;

	const pages = await Promise.all(
		remainingPageRanges(count ?? firstRows.length, MOVES_PAGE_SIZE).map(([from, to]) => query().range(from, to))
	);
	for (const page of pages) {
		if (page.error) throw page.error;
	}

	return [...firstRows, ...pages.flatMap((p) => p.data ?? [])];
}

/** Maps `fetchAllMoves`'s joined-select row shape into `RawMoveRow`s `enumerateVariations` expects. */
export function toRawMoveRows(rows: any[]): RawMoveRow[] {
	return rows.map((m: any) => ({
		id: m.id,
		san: m.san,
		isPlayerTurn: m.is_player_turn,
		fromPositionId: m.from_position,
		toPositionId: m.to_position,
		fromFen: m.from_pos?.fen ?? '',
		toFen: m.to_pos?.fen ?? '',
		chapterName: m.chapter_name ?? null
	}));
}

/**
 * Loads a repertoire a player can access (owned or coach-assigned), its full
 * enumerated variations, and this player's own excluded-variation set — the
 * same authorization + move fetch every practice-mutating endpoint and the
 * detail page's load need. Authorization is enforced entirely by RLS
 * (`repertoires`' and `moves`' own- and assigned-read policies) — a row
 * simply won't come back for a caller who isn't allowed to see it.
 *
 * Deliberately returns the FULL variation set rather than filtering out
 * excluded ones itself — callers that build practice queues/levels should
 * filter via `filterVariations` before using them (see
 * `practice/[repertoire_id]/+page.server.ts` and the `/api/practice/*`
 * endpoints), while callers that need to show every variation with its
 * checked state (the Practice picker's expand-to-show-variations UI) need
 * the unfiltered list plus this set to annotate it.
 */
export async function loadRepertoireVariations(
	supabase: SupabaseClient,
	userId: string,
	repertoireId: string
): Promise<{ repertoire: PracticeRepertoire; variations: Variation[]; excludedVariationKeys: Set<string> }> {
	const [{ data: repertoire }, rawMoves, { data: exclusions, error: exclusionsErr }] = await Promise.all([
		supabase
			.from('repertoires')
			.select('id, name, color, practice_depth_levels, chunk_size')
			.eq('id', repertoireId)
			.maybeSingle(),
		fetchAllMoves(supabase, repertoireId),
		supabase
			.from('variation_practice_exclusions')
			.select('variation_key')
			.eq('player_id', userId)
			.eq('repertoire_id', repertoireId)
	]);

	if (!repertoire) {
		throw error(404, 'Repertoire not found');
	}
	if (exclusionsErr) throw exclusionsErr;

	const moves: RawMoveRow[] = toRawMoveRows(rawMoves ?? []);

	return {
		repertoire: {
			id: repertoire.id,
			name: repertoire.name,
			color: repertoire.color,
			practiceDepthLevels: repertoire.practice_depth_levels,
			chunkSize: repertoire.chunk_size
		},
		variations: enumerateVariations(moves),
		excludedVariationKeys: new Set((exclusions ?? []).map((row: any) => row.variation_key))
	};
}

/**
 * Like `loadRepertoireVariations`, but pre-filters out this player's
 * excluded variations — for the common case (every practice-mutating
 * endpoint) where the caller always wants the filtered set and never needs
 * `excludedVariationKeys` itself. `loadRepertoireVariations` stays exported
 * separately for the one caller that DOES need the raw, unfiltered pair
 * (the Practice picker's expand-to-show-variations endpoint, which must show
 * every variation annotated with its checked state, not just the included
 * ones).
 */
export async function loadFilteredRepertoireVariations(
	supabase: SupabaseClient,
	userId: string,
	repertoireId: string
): Promise<{ repertoire: PracticeRepertoire; variations: Variation[] }> {
	const { repertoire, variations, excludedVariationKeys } = await loadRepertoireVariations(supabase, userId, repertoireId);
	return { repertoire, variations: filterVariations(variations, excludedVariationKeys) };
}
