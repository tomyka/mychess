// mychess/src/lib/server/repertoire-progress.ts
import type { SupabaseClient } from '@supabase/supabase-js';
import { enumerateVariations, filterVariations, hasChapterTags, type RawMoveRow, type Variation } from '$lib/mastery/variations';
import { fetchAllPages, MAX_ROWS_PAGE_SIZE } from './paginate';

export type RepertoireProgressSummary = {
	id: string;
	name: string;
	color: string;
	solved: number;
	total: number;
	allSolved: boolean;
	// The repertoire's TRUE variation count, ignoring this player's
	// exclusions — together with `excludedVariationCount`, lets the Practice
	// picker show a repertoire-level checkbox's checked/unchecked/
	// indeterminate state without fetching every variation up front. `total`
	// above is the FILTERED count used for the solved/total display.
	fullVariationCount: number;
	excludedVariationCount: number;
	// Whether ANY variation came from a chapter-tagged PGN import — the
	// Practice picker (and the new VariationPicker) only offer chapter
	// grouping UI at all when this is true.
	hasChapters: boolean;
};

// Supabase/PostgREST caps an unbounded select at `max_rows` (1000, see
// supabase/config.toml) and truncates silently past that — no error, just
// fewer rows than actually exist. Ordering by `created_at` (then `id` to
// break ties) makes the pagination deterministic *and* preserves each
// chapter's true import order — `moves.id` is a random UUID, not a
// sequence, so ordering by it alone surfaces chapters in an effectively
// arbitrary order instead of the order they were uploaded in. Pages beyond
// the first are fetched concurrently (see `fetchAllPages`, shared with
// `practice-repertoire.ts`) rather than one at a time.
//
// Used both for the lazy total-count backfill (repertoires imported before
// `total_variations` started being cached at import time) and for
// repertoires this player has excluded at least one variation from, where
// the cached whole-repertoire count can't be trusted for THIS player's
// filtered view.
const MOVES_PAGE_SIZE = MAX_ROWS_PAGE_SIZE;

async function fetchAllMoves(supabase: SupabaseClient, repIds: string[]): Promise<any[]> {
	return fetchAllPages(
		() =>
			supabase
				.from('moves')
				.select('id, san, is_player_turn, repertoire_id, from_position, to_position, chapter_names')
				.in('repertoire_id', repIds)
				.order('created_at', { ascending: true })
				.order('id', { ascending: true }),
		() => supabase.from('moves').select('id', { count: 'exact', head: true }).in('repertoire_id', repIds),
		MOVES_PAGE_SIZE
	);
}

// Paginated for the same `max_rows` reason as the move fetch above, and more
// urgently: this reads across EVERY repertoire the player can access at once,
// so the combined row count hits the 1000-row cap far sooner than any
// single-repertoire read does. Truncation here silently dropped exclusions
// (excluded lines came back as practiceable, with wrong totals) and solved
// keys (solved lines looked unsolved).
async function fetchByRepertoire(
	supabase: SupabaseClient,
	table: 'variation_practice_exclusions' | 'variation_solved',
	playerId: string,
	repIds: string[]
): Promise<Map<string, Set<string>>> {
	const data = await fetchAllPages<{ repertoire_id: string; variation_key: string }>(
		() =>
			supabase
				.from(table)
				.select('repertoire_id, variation_key')
				.eq('player_id', playerId)
				.in('repertoire_id', repIds)
				.order('variation_key', { ascending: true }),
		() =>
			supabase
				.from(table)
				.select('id', { count: 'exact', head: true })
				.eq('player_id', playerId)
				.in('repertoire_id', repIds),
		MAX_ROWS_PAGE_SIZE
	);

	const map = new Map<string, Set<string>>();
	for (const row of (data ?? []) as any[]) {
		const set = map.get(row.repertoire_id) ?? new Set<string>();
		set.add(row.variation_key);
		map.set(row.repertoire_id, set);
	}
	return map;
}

/**
 * Every repertoire a player can access (owned + assigned), each with its
 * computed solved/total progress. Shared by the `/practice` picker and the
 * dashboard's fully-solved-repertoire count. Read-only from the caller's
 * perspective.
 *
 * Reads the cached `total_variations` on `repertoires` (written at import
 * time) instead of fetching every move row and re-walking the variation tree
 * on every load — moves are immutable after import, so that cache is valid
 * forever once computed. Two cases still need a live move fetch: repertoires
 * imported before this cache existed (backfilled here), and repertoires this
 * player has excluded at least one variation from, where the cached
 * whole-repertoire count can't be trusted for this player's filtered view.
 */
export async function loadRepertoireProgressSummaries(
	supabase: SupabaseClient,
	userId: string
): Promise<RepertoireProgressSummary[]> {
	const [{ data: ownReps }, { data: assigned }] = await Promise.all([
		supabase.from('repertoires').select('id, name, color, total_variations, has_chapters').eq('player_id', userId),
		supabase
			.from('assigned_repertoires')
			.select('repertoire:repertoire_id(id, name, color, total_variations, has_chapters)')
			.eq('player_id', userId)
	]);

	const assignedReps = (assigned ?? []).map((a: any) => a.repertoire).filter(Boolean);
	const seen = new Set((ownReps ?? []).map((r: any) => r.id));
	const allReps = [...(ownReps ?? []), ...assignedReps.filter((r: any) => !seen.has(r.id))];

	if (allReps.length === 0) return [];

	const repIds = allReps.map((r: any) => r.id);
	const uncachedIds = allReps.filter((r: any) => r.total_variations === null || r.has_chapters === null).map((r: any) => r.id);

	const [exclusionsByRep, solvedByRep] = await Promise.all([
		fetchByRepertoire(supabase, 'variation_practice_exclusions', userId, repIds),
		fetchByRepertoire(supabase, 'variation_solved', userId, repIds)
	]);
	const excludedIds = [...exclusionsByRep.keys()];
	const needsMoveFetchIds = Array.from(new Set([...uncachedIds, ...excludedIds]));
	const rawMoves = needsMoveFetchIds.length > 0 ? await fetchAllMoves(supabase, needsMoveFetchIds) : [];

	const movesByRep = new Map<string, RawMoveRow[]>();
	for (const m of rawMoves as any[]) {
		const list = movesByRep.get(m.repertoire_id) ?? [];
		list.push({
			id: m.id,
			san: m.san,
			isPlayerTurn: m.is_player_turn,
			fromPositionId: m.from_position,
			toPositionId: m.to_position,
			fromFen: '',
			toFen: '',
			chapterNames: m.chapter_names ?? []
		});
		movesByRep.set(m.repertoire_id, list);
	}
	const variationsByRep = new Map<string, Variation[]>();
	for (const repId of needsMoveFetchIds) {
		variationsByRep.set(repId, enumerateVariations(movesByRep.get(repId) ?? []));
	}

	const backfilledTotals = new Map<string, number>();
	const backfilledHasChapters = new Map<string, boolean>();
	await Promise.all(
		uncachedIds.map(async (repId) => {
			const variations = variationsByRep.get(repId) ?? [];
			const hasChapters = hasChapterTags(variations);
			backfilledTotals.set(repId, variations.length);
			backfilledHasChapters.set(repId, hasChapters);
			const { error } = await supabase
				.from('repertoires')
				.update({ total_variations: variations.length, has_chapters: hasChapters })
				.eq('id', repId);
			if (error) console.error(`Failed to backfill shape cache for repertoire ${repId}:`, error);
		})
	);

	return allReps.map((r: any) => {
		const fullVariationCount: number = r.total_variations ?? backfilledTotals.get(r.id)!;

		const excluded = exclusionsByRep.get(r.id);
		const solved = solvedByRep.get(r.id) ?? new Set<string>();

		const total = excluded
			? filterVariations(variationsByRep.get(r.id) ?? [], excluded).length
			: fullVariationCount;
		const solvedCount = excluded
			? [...solved].filter((key) => !excluded.has(key)).length
			: [...solved].length; // stale solved keys (repertoire edited since) simply don't inflate the count below via total's own cap

		return {
			id: r.id,
			name: r.name,
			color: r.color,
			solved: Math.min(solvedCount, total),
			total,
			allSolved: total > 0 && Math.min(solvedCount, total) === total,
			fullVariationCount,
			excludedVariationCount: excluded?.size ?? 0,
			hasChapters: r.has_chapters ?? backfilledHasChapters.get(r.id)!
		};
	});
}
