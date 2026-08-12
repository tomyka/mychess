// mychess/src/lib/server/repertoire-progress.ts
import type { SupabaseClient } from '@supabase/supabase-js';
import { enumerateVariations, filterVariations, type RawMoveRow, type Variation } from '$lib/mastery/variations';
import {
	repertoireProgressFromShape,
	repertoireShape,
	type RepertoireProgress,
	type RepertoireShape,
	type LevelProgressRow
} from '$lib/mastery/levelProgress';
import { remainingPageRanges } from './practice-repertoire';

export type RepertoireProgressSummary = RepertoireProgress & {
	id: string;
	name: string;
	color: string;
	// The repertoire's TRUE variation count, ignoring this player's
	// exclusions — together with `excludedVariationCount`, lets the Practice
	// picker show a repertoire-level checkbox's checked/unchecked/
	// indeterminate state without fetching every variation up front (only
	// needed once the row is actually expanded — see
	// `RepertoirePracticeRow.svelte`). `totalVariations` (from
	// `RepertoireProgress`) is the FILTERED count used for level/mastery math.
	fullVariationCount: number;
	excludedVariationCount: number;
};

// Supabase/PostgREST caps an unbounded select at `max_rows` (1000, see
// supabase/config.toml) and truncates silently past that — no error, just
// fewer rows than actually exist. `.order` makes the pagination
// deterministic — `.range` alone has no defined traversal order to page
// through without it. Pages beyond the first are fetched concurrently (see
// `remainingPageRanges`, shared with `practice-repertoire.ts`) rather than
// one at a time.
//
// Used both for the lazy shape backfill (repertoires imported before
// `writeMoves` started caching shape at import time) and for repertoires
// this player has excluded at least one variation from, where the cached
// whole-repertoire shape can't be trusted for THIS player's filtered view.
const MOVES_PAGE_SIZE = 1000;

async function fetchAllMoves(supabase: SupabaseClient, repIds: string[]): Promise<any[]> {
	const query = () =>
		supabase
			.from('moves')
			.select('id, san, is_player_turn, repertoire_id, from_position, to_position')
			.in('repertoire_id', repIds)
			.order('id', { ascending: true });

	const { data: firstPage, error: err } = await query().range(0, MOVES_PAGE_SIZE - 1);
	if (err) throw err;
	const firstRows = firstPage ?? [];
	if (firstRows.length < MOVES_PAGE_SIZE) return firstRows;

	const { count, error: countErr } = await supabase
		.from('moves')
		.select('id', { count: 'exact', head: true })
		.in('repertoire_id', repIds);
	if (countErr) throw countErr;

	const pages = await Promise.all(
		remainingPageRanges(count ?? firstRows.length, MOVES_PAGE_SIZE).map(([from, to]) => query().range(from, to))
	);
	for (const page of pages) {
		if (page.error) throw page.error;
	}

	return [...firstRows, ...pages.flatMap((p) => p.data ?? [])];
}

async function fetchExclusionsByRepertoire(
	supabase: SupabaseClient,
	playerId: string,
	repIds: string[]
): Promise<Map<string, Set<string>>> {
	const { data, error } = await supabase
		.from('variation_practice_exclusions')
		.select('repertoire_id, variation_key')
		.eq('player_id', playerId)
		.in('repertoire_id', repIds);
	if (error) throw error;

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
 * computed mastery progress. Shared by the `/practice` picker and the
 * dashboard's mastered-repertoire count. Read-only from the caller's
 * perspective — doesn't reconcile or create `level_progress` rows (that's
 * the detail page's job via `loadSyncedLevelProgress`); a repertoire with no
 * row yet just shows the bootstrap "fresh Level 1" default. (It does write
 * the one-time shape backfill below, an implementation detail invisible to
 * callers — the return value is unaffected either way.)
 *
 * Reads the shape (`total_variations`/`total_levels`/`level1_task_count`)
 * cached on `repertoires` at import time instead of fetching every move row
 * and re-walking the variation tree on every load — moves are immutable
 * after import, so that shape is valid forever once computed. Two cases
 * still need a live move fetch: repertoires imported before this cache
 * existed (`total_variations` still null — backfilled here, same as before),
 * and repertoires this player has excluded at least one variation from,
 * where the cached shape reflects the WHOLE repertoire, not this player's
 * filtered view of it. The cache itself is never overwritten by exclusions —
 * it stays the true full-repertoire shape for every other viewer.
 */
export async function loadRepertoireProgressSummaries(
	supabase: SupabaseClient,
	userId: string
): Promise<RepertoireProgressSummary[]> {
	const [{ data: ownReps }, { data: assigned }] = await Promise.all([
		supabase
			.from('repertoires')
			.select('id, name, color, total_variations, total_levels, level1_task_count, practice_depth_levels')
			.eq('player_id', userId),
		supabase
			.from('assigned_repertoires')
			.select(
				'repertoire:repertoire_id(id, name, color, total_variations, total_levels, level1_task_count, practice_depth_levels)'
			)
			.eq('player_id', userId)
	]);

	const assignedReps = (assigned ?? []).map((a: any) => a.repertoire).filter(Boolean);
	const seen = new Set((ownReps ?? []).map((r: any) => r.id));
	const allReps = [...(ownReps ?? []), ...assignedReps.filter((r: any) => !seen.has(r.id))];

	if (allReps.length === 0) return [];

	const repIds = allReps.map((r: any) => r.id);
	const uncachedIds = allReps.filter((r: any) => r.total_variations === null).map((r: any) => r.id);

	const [exclusionsByRep, { data: progressRows }] = await Promise.all([
		fetchExclusionsByRepertoire(supabase, userId, repIds),
		supabase
			.from('level_progress')
			.select('repertoire_id, level, prev_level_mistakes, queue')
			.eq('player_id', userId)
			.in('repertoire_id', repIds)
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
			toFen: ''
		});
		movesByRep.set(m.repertoire_id, list);
	}
	const variationsByRep = new Map<string, Variation[]>();
	for (const repId of needsMoveFetchIds) {
		variationsByRep.set(repId, enumerateVariations(movesByRep.get(repId) ?? []));
	}

	// Self-healing, same as before: only ever runs once per repertoire, since
	// every subsequent load finds the columns already populated.
	const backfilledShapes = new Map<string, RepertoireShape>();
	await Promise.all(
		uncachedIds.map(async (repId) => {
			const shape = repertoireShape(variationsByRep.get(repId) ?? []);
			backfilledShapes.set(repId, shape);
			const { error } = await supabase
				.from('repertoires')
				.update({
					total_variations: shape.totalVariations,
					total_levels: shape.totalLevels,
					level1_task_count: shape.level1TaskCount
				})
				.eq('id', repId);
			if (error) console.error(`Failed to backfill shape cache for repertoire ${repId}:`, error);
		})
	);

	const rowByRep = new Map<string, LevelProgressRow>();
	for (const r of (progressRows ?? []) as any[]) {
		rowByRep.set(r.repertoire_id, { level: r.level, prevLevelMistakes: r.prev_level_mistakes, queue: r.queue });
	}

	return allReps.map((r: any) => {
		const naturalShape: RepertoireShape =
			r.total_variations !== null
				? { totalVariations: r.total_variations, totalLevels: r.total_levels, level1TaskCount: r.level1_task_count }
				: backfilledShapes.get(r.id)!;

		// `fetchExclusionsByRepertoire` only ever adds a map entry when it
		// found at least one exclusion row, so `excluded`'s mere presence
		// (no need to also check `.size > 0`) means this player has excluded
		// something from this repertoire.
		const excluded = exclusionsByRep.get(r.id);
		const effectiveShape = excluded
			? repertoireShape(filterVariations(variationsByRep.get(r.id) ?? [], excluded))
			: naturalShape;

		// Clamped to the player's configured practice depth, same as the
		// detail page (`effectiveLevelCap`) — otherwise this would show a
		// level count deeper than what practice will actually ever ask for.
		const shape: RepertoireShape = {
			...effectiveShape,
			totalLevels: Math.min(effectiveShape.totalLevels, r.practice_depth_levels)
		};
		const progress = repertoireProgressFromShape(shape, rowByRep.get(r.id) ?? null);
		return {
			id: r.id,
			name: r.name,
			color: r.color,
			...progress,
			fullVariationCount: naturalShape.totalVariations,
			excludedVariationCount: excluded?.size ?? 0
		};
	});
}
