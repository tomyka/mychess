// mychess/src/lib/server/practice-repertoire.ts
import { error } from '@sveltejs/kit';
import type { SupabaseClient } from '@supabase/supabase-js';
import { enumerateVariations, filterVariations, moveIdsInVariationKey, type RawMoveRow, type Variation } from '$lib/mastery/variations';
import { fetchAllPages, MAX_ROWS_PAGE_SIZE } from './paginate';

export type PracticeRepertoire = { id: string; name: string; color: string };

// Supabase/PostgREST caps an unbounded select at `max_rows` (1000, see
// supabase/config.toml) and truncates silently past that — no error, just
// fewer rows than actually exist. A single large repertoire can exceed this
// on its own; an incomplete move set shatters the tree `enumerateVariations`
// reconstructs into many short, disconnected fragments, producing bogus
// variation counts that don't correspond to real opening lines. Ordering by
// `created_at` (then `id` to break ties within the same statement/import
// step) makes the pagination deterministic *and* preserves each chapter's
// true import order — `moves.id` is a random UUID, not a sequence, so
// ordering by it alone (as this used to) surfaces chapters in an
// effectively arbitrary order instead of the order they were uploaded in.
const MOVES_PAGE_SIZE = MAX_ROWS_PAGE_SIZE;

const MOVE_SELECT_COLUMNS =
	'id, san, is_player_turn, from_position, to_position, chapter_names, from_pos:from_position(fen), to_pos:to_position(fen)';

/**
 * Fetches every move row for a repertoire, defeating the `max_rows` cap
 * above (see `fetchAllPages` for the paging strategy itself).
 */
export async function fetchAllMoves(supabase: SupabaseClient, repertoireId: string): Promise<any[]> {
	return fetchAllPages(
		() =>
			supabase
				.from('moves')
				.select(MOVE_SELECT_COLUMNS)
				.eq('repertoire_id', repertoireId)
				.order('created_at', { ascending: true })
				.order('id', { ascending: true }),
		() => supabase.from('moves').select('id', { count: 'exact', head: true }).eq('repertoire_id', repertoireId),
		MOVES_PAGE_SIZE
	);
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
		chapterNames: m.chapter_names ?? []
	}));
}

/** Every one of this player's excluded variation keys for one repertoire, paginated past `max_rows`. */
function fetchAllExclusions(supabase: SupabaseClient, userId: string, repertoireId: string): Promise<{ variation_key: string }[]> {
	return fetchAllPages<{ variation_key: string }>(
		() =>
			supabase
				.from('variation_practice_exclusions')
				.select('variation_key')
				.eq('player_id', userId)
				.eq('repertoire_id', repertoireId)
				.order('variation_key', { ascending: true }),
		() =>
			supabase
				.from('variation_practice_exclusions')
				.select('id', { count: 'exact', head: true })
				.eq('player_id', userId)
				.eq('repertoire_id', repertoireId),
		MAX_ROWS_PAGE_SIZE
	);
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
 * excluded ones itself — callers that build a practice attempt should
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
	const [{ data: repertoire }, rawMoves, exclusions] = await Promise.all([
		supabase
			.from('repertoires')
			.select('id, name, color')
			.eq('id', repertoireId)
			.maybeSingle(),
		fetchAllMoves(supabase, repertoireId),
		// Paginated for the same `max_rows` reason as the move fetch above:
		// "deselect all" on a large repertoire writes one exclusion row per
		// variation, so a 1,040-variation repertoire (which exists in
		// production) writes 1,040 rows — an unpaginated read saw only the
		// first 1,000, silently practicing ~40 excluded lines and reporting
		// wrong counts. Still inside this `Promise.all`, so it stays
		// concurrent with the repertoire and move fetches.
		fetchAllExclusions(supabase, userId, repertoireId)
	]);

	if (!repertoire) {
		throw error(404, 'Repertoire not found');
	}

	const moves: RawMoveRow[] = toRawMoveRows(rawMoves ?? []);

	return {
		repertoire: {
			id: repertoire.id,
			name: repertoire.name,
			color: repertoire.color
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

/**
 * Every move id belonging to `repertoireId`, fetched with the same
 * paginated-and-fully-concurrent approach as `fetchAllMoves` (defeating the
 * `max_rows` cap the same way — see that function's own comment) but
 * selecting only `id`, since that's all an ownership check needs.
 *
 * `validateVariationKeysOwnership` used to instead chunk the *caller's*
 * move ids into `.in()` batches of 200 and fetch them all concurrently —
 * for a large, deep, transposition-heavy repertoire (thousands of unique
 * move ids across a bulk toggle), that meant dozens of simultaneous
 * requests from one serverless invocation, which was implicated in
 * legitimate variation keys sporadically failing ownership validation
 * (mychess.lt production, Aug 2026). Fetching this repertoire's own move ids
 * once, the same proven way the GET /variations endpoint already does via
 * `fetchAllMoves`, avoids that fan-out entirely.
 */
async function fetchAllMoveIds(supabase: SupabaseClient, repertoireId: string): Promise<Set<string>> {
	const rows = await fetchAllPages<{ id: string }>(
		() => supabase.from('moves').select('id').eq('repertoire_id', repertoireId).order('id', { ascending: true }),
		() => supabase.from('moves').select('id', { count: 'exact', head: true }).eq('repertoire_id', repertoireId),
		MOVES_PAGE_SIZE
	);
	return new Set(rows.map((r) => r.id));
}

/**
 * Confirms every move referenced by `variationKeys` actually belongs to
 * `repertoireId`, and that the repertoire is accessible to the caller at all
 * (RLS-scoped; reports as `notFound` otherwise).
 *
 * The security concern this guards (see the exclusions route's own comment)
 * is `variation_practice_exclusions`'s unique constraint being
 * `(player_id, variation_key)`, not `(player_id, repertoire_id,
 * variation_key)` — a variation_key legitimately belonging to a DIFFERENT
 * repertoire this player owns would otherwise hit the same upsert conflict
 * target and silently get re-tagged with this repertoire's id. Since every
 * move row belongs to exactly one repertoire and `moves.id` is a real,
 * globally-unique UUID (never reused across repertoires), confirming every
 * move-id referenced by a key exists under THIS repertoire_id rules that
 * out just as completely as re-deriving the whole key from a full
 * enumeration would — a key can't reference a real, existing move-id from
 * a different repertoire, because that id was never inserted under this
 * one.
 */
export async function validateVariationKeysOwnership(
	supabase: SupabaseClient,
	repertoireId: string,
	variationKeys: string[]
): Promise<{ error: string | null; notFound: boolean }> {
	const { data: repertoire, error: repErr } = await supabase
		.from('repertoires')
		.select('id')
		.eq('id', repertoireId)
		.maybeSingle();
	if (repErr) return { error: repErr.message, notFound: false };
	if (!repertoire) return { error: 'Repertoire not found', notFound: true };

	const moveIds = Array.from(new Set(variationKeys.flatMap(moveIdsInVariationKey)));
	if (moveIds.length === 0) return { error: null, notFound: false };

	let foundIds: Set<string>;
	try {
		foundIds = await fetchAllMoveIds(supabase, repertoireId);
	} catch (err) {
		const message = err instanceof Error ? err.message : (err as { message?: string })?.message;
		return { error: message ?? 'Failed to validate variation keys', notFound: false };
	}

	if (moveIds.some((id) => !foundIds.has(id))) {
		return { error: 'variationKeys must belong to this repertoire', notFound: false };
	}
	return { error: null, notFound: false };
}
