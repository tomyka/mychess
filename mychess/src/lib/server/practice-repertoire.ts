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
	'id, san, is_player_turn, from_position, to_position, from_pos:from_position(fen), to_pos:to_position(fen)';

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
async function fetchAllMoves(supabase: SupabaseClient, repertoireId: string): Promise<any[]> {
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
