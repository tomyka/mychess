// mychess/src/lib/server/repertoire-progress.ts
import type { SupabaseClient } from '@supabase/supabase-js';
import { enumerateVariations, type RawMoveRow } from '$lib/mastery/variations';
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
};

// Supabase/PostgREST caps an unbounded select at `max_rows` (1000, see
// supabase/config.toml) and truncates silently past that — no error, just
// fewer rows than actually exist. `.order` makes the pagination
// deterministic — `.range` alone has no defined traversal order to page
// through without it. Pages beyond the first are fetched concurrently (see
// `remainingPageRanges`, shared with `practice-repertoire.ts`) rather than
// one at a time.
//
// Only used now for the lazy shape backfill below (see
// `backfillShapes`) — repertoires imported since `writeMoves` started
// caching `total_variations`/`total_levels`/`level1_task_count` at import
// time never need this at all.
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

/**
 * Computes and persists `total_variations`/`total_levels`/`level1_task_count`
 * for repertoires imported before those columns existed (`repIds` — chosen
 * by the caller as whichever came back with `total_variations: null`).
 * Self-healing: this only ever runs once per repertoire, since every
 * subsequent load finds the columns already populated. Awaited (not
 * fire-and-forget) so the write reliably lands before this request's
 * function invocation ends.
 */
async function backfillShapes(supabase: SupabaseClient, repIds: string[]): Promise<Map<string, RepertoireShape>> {
	const rawMoves = await fetchAllMoves(supabase, repIds);

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

	const shapes = new Map<string, RepertoireShape>();
	await Promise.all(
		repIds.map(async (repId) => {
			const shape = repertoireShape(enumerateVariations(movesByRep.get(repId) ?? []));
			shapes.set(repId, shape);
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
	return shapes;
}

/**
 * Every repertoire a player can access (owned + assigned), each with its
 * computed mastery progress. Shared by the `/practice` picker and the
 * dashboard's mastered-repertoire count. Read-only from the caller's
 * perspective — doesn't reconcile or create `level_progress` rows (that's
 * the detail page's job via `loadSyncedLevelProgress`); a repertoire with no
 * row yet just shows the bootstrap "fresh Level 1" default. (It does write
 * the one-time shape backfill above, an implementation detail invisible to
 * callers — the return value is unaffected either way.)
 *
 * Reads the shape (`total_variations`/`total_levels`/`level1_task_count`)
 * cached on `repertoires` at import time instead of fetching every move row
 * and re-walking the variation tree on every load — moves are immutable
 * after import, so that shape is valid forever once computed. Only
 * repertoires imported before this cache existed (`total_variations` still
 * null) pay the old move-fetch cost, once, via `backfillShapes`.
 */
export async function loadRepertoireProgressSummaries(
	supabase: SupabaseClient,
	userId: string
): Promise<RepertoireProgressSummary[]> {
	const [{ data: ownReps }, { data: assigned }] = await Promise.all([
		supabase
			.from('repertoires')
			.select('id, name, color, total_variations, total_levels, level1_task_count')
			.eq('player_id', userId),
		supabase
			.from('assigned_repertoires')
			.select('repertoire:repertoire_id(id, name, color, total_variations, total_levels, level1_task_count)')
			.eq('player_id', userId)
	]);

	const assignedReps = (assigned ?? []).map((a: any) => a.repertoire).filter(Boolean);
	const seen = new Set((ownReps ?? []).map((r: any) => r.id));
	const allReps = [...(ownReps ?? []), ...assignedReps.filter((r: any) => !seen.has(r.id))];

	if (allReps.length === 0) return [];

	const repIds = allReps.map((r: any) => r.id);
	const uncachedIds = allReps.filter((r: any) => r.total_variations === null).map((r: any) => r.id);

	const [{ data: progressRows }, backfilledShapes] = await Promise.all([
		supabase
			.from('level_progress')
			.select('repertoire_id, level, prev_level_mistakes, queue')
			.eq('player_id', userId)
			.in('repertoire_id', repIds),
		uncachedIds.length > 0 ? backfillShapes(supabase, uncachedIds) : Promise.resolve(new Map<string, RepertoireShape>())
	]);

	const rowByRep = new Map<string, LevelProgressRow>();
	for (const r of (progressRows ?? []) as any[]) {
		rowByRep.set(r.repertoire_id, { level: r.level, prevLevelMistakes: r.prev_level_mistakes, queue: r.queue });
	}

	return allReps.map((r: any) => {
		const shape: RepertoireShape =
			r.total_variations !== null
				? { totalVariations: r.total_variations, totalLevels: r.total_levels, level1TaskCount: r.level1_task_count }
				: backfilledShapes.get(r.id)!;
		const progress = repertoireProgressFromShape(shape, rowByRep.get(r.id) ?? null);
		return { id: r.id, name: r.name, color: r.color, ...progress };
	});
}
