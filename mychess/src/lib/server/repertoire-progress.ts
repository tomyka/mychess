// mychess/src/lib/server/repertoire-progress.ts
import type { SupabaseClient } from '@supabase/supabase-js';
import { enumerateVariations, hasChapterTags, type RawMoveRow, type Variation } from '$lib/mastery/variations';
import {
	exclusionsAreVerified,
	exclusionShape,
	partitionByLiveness,
	type ExclusionRow
} from '$lib/mastery/exclusionFreshness';
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
// Used for the lazy total-count backfill (repertoires imported before
// `total_variations` started being cached at import time) and to re-verify a
// player's exclusion rows against a changed move set — NOT, any longer, on
// every load for every player who has excluded something (see
// `exclusionFreshness.ts` and GitHub issue #52).
const MOVES_PAGE_SIZE = MAX_ROWS_PAGE_SIZE;

// Excludes retired moves (`retired_at is null`): a retired row is a line a
// coach removed on a repertoire re-upload, kept around (rather than deleted)
// only so that re-adding the line later restores its `reviews`/
// `move_attempts` history instead of starting it over. This function
// reconstructs each repertoire's live variation shape, so a retired row must
// not resurface as a variation to count as solved/total or enumerate here.
async function fetchAllMoves(supabase: SupabaseClient, repIds: string[]): Promise<any[]> {
	return fetchAllPages(
		() =>
			supabase
				.from('moves')
				.select('id, san, is_player_turn, repertoire_id, from_position, to_position, chapter_names')
				.in('repertoire_id', repIds)
				.is('retired_at', null)
				.order('created_at', { ascending: true })
				.order('id', { ascending: true }),
		() =>
			supabase
				.from('moves')
				.select('id', { count: 'exact', head: true })
				.in('repertoire_id', repIds)
				.is('retired_at', null),
		MOVES_PAGE_SIZE
	);
}

// Paginated for the same `max_rows` reason as the move fetch above, and more
// urgently: this reads across EVERY repertoire the player can access at once,
// so the combined row count hits the 1000-row cap far sooner than any
// single-repertoire read does. Truncation here silently dropped exclusions
// (excluded lines came back as practiceable, with wrong totals) and solved
// keys (solved lines looked unsolved).
async function fetchRowsByRepertoire<T extends { repertoire_id: string }>(
	supabase: SupabaseClient,
	table: 'variation_practice_exclusions' | 'variation_solved',
	playerId: string,
	repIds: string[],
	columns: string
): Promise<Map<string, T[]>> {
	const data = await fetchAllPages<T>(
		() =>
			supabase
				.from(table)
				.select(columns)
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

	const map = new Map<string, T[]>();
	for (const row of data ?? []) {
		const list = map.get(row.repertoire_id) ?? [];
		list.push(row);
		map.set(row.repertoire_id, list);
	}
	return map;
}

// A `.in()` filter is URL query text regardless of verb (PostgREST
// convention), so the re-verify writes below batch their row ids the same way
// `variation-practice-settings.ts` batches its delete filters. Ids are
// fixed-length UUIDs, so a batch of 500 keeps the URL well short of any limit.
const REVERIFY_BATCH_SIZE = 500;

function chunk<T>(items: T[], size: number): T[][] {
	const batches: T[][] = [];
	for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size));
	return batches;
}

/**
 * Brings this player's exclusion rows for one repertoire back in line with its
 * current shape, after the caller has already enumerated it: rows whose key no
 * longer names a live variation are deleted (the line is gone — there is
 * nothing left to exclude), and the survivors are stamped as verified against
 * this shape so the next load can subtract instead of enumerating again.
 *
 * Survivors are stamped with the repertoire's own `moves_updated_at` rather
 * than a clock reading, which is what keeps this free of clock-skew concerns:
 * the freshness test is `verified_at >= moves_updated_at`, and stamping the
 * exact value it is compared against satisfies it without either side needing
 * to agree on what time it is.
 *
 * Best-effort by design, and safe to fail: every write here is idempotent and
 * a failure only means the next load repeats the enumeration it just did. Only
 * the caller's own rows are touched, so this needs no privileges beyond
 * `variation_practice_exclusions_player_all`'s RLS.
 */
async function reverifyExclusions(
	supabase: SupabaseClient,
	playerId: string,
	rows: (ExclusionRow & { id: string })[],
	liveKeys: ReadonlySet<string>,
	movesUpdatedAt: string
): Promise<void> {
	const { stale, live } = partitionByLiveness(rows, liveKeys);

	for (const batch of chunk(stale, REVERIFY_BATCH_SIZE)) {
		const { error } = await supabase
			.from('variation_practice_exclusions')
			.delete()
			.eq('player_id', playerId)
			.in(
				'id',
				batch.map((r) => r.id)
			);
		if (error) {
			console.error('Failed to prune stale exclusion rows:', error);
			return;
		}
	}

	for (const batch of chunk(live, REVERIFY_BATCH_SIZE)) {
		const { error } = await supabase
			.from('variation_practice_exclusions')
			.update({ verified_at: movesUpdatedAt })
			.eq('player_id', playerId)
			.in(
				'id',
				batch.map((r) => r.id)
			);
		if (error) {
			console.error('Failed to stamp verified exclusion rows:', error);
			return;
		}
	}
}

/**
 * Every repertoire a player can access (owned + assigned), each with its
 * computed solved/total progress. Shared by the `/practice` picker and the
 * dashboard's fully-solved-repertoire count. Read-only from the caller's
 * perspective.
 *
 * Reads the cached `total_variations` on `repertoires` (written at import
 * time) instead of fetching every move row and re-walking the variation tree
 * on every load. A player's own exclusions are then subtracted from it, which
 * is only sound while their exclusion rows are known to name variations that
 * still exist — so two cases need a live move fetch, both self-healing and
 * both one-off: a repertoire imported before this cache existed (backfilled
 * here), and one whose move set has changed since this player's exclusions
 * were last verified against it (re-verified here, see `reverifyExclusions`).
 * Neither recurs on subsequent loads.
 */
export async function loadRepertoireProgressSummaries(
	supabase: SupabaseClient,
	userId: string
): Promise<RepertoireProgressSummary[]> {
	const [{ data: ownReps }, { data: assigned }] = await Promise.all([
		supabase
			.from('repertoires')
			.select('id, name, color, total_variations, has_chapters, moves_updated_at')
			.eq('player_id', userId),
		supabase
			.from('assigned_repertoires')
			.select('repertoire:repertoire_id(id, name, color, total_variations, has_chapters, moves_updated_at)')
			.eq('player_id', userId)
	]);

	const assignedReps = (assigned ?? []).map((a: any) => a.repertoire).filter(Boolean);
	const seen = new Set((ownReps ?? []).map((r: any) => r.id));
	const allReps = [...(ownReps ?? []), ...assignedReps.filter((r: any) => !seen.has(r.id))];

	if (allReps.length === 0) return [];

	const repIds = allReps.map((r: any) => r.id);
	const uncachedIds = allReps.filter((r: any) => r.total_variations === null || r.has_chapters === null).map((r: any) => r.id);

	const [exclusionRowsByRep, solvedRowsByRep] = await Promise.all([
		fetchRowsByRepertoire<{ id: string; repertoire_id: string; variation_key: string; verified_at: string }>(
			supabase,
			'variation_practice_exclusions',
			userId,
			repIds,
			'id, repertoire_id, variation_key, verified_at'
		),
		fetchRowsByRepertoire<{ repertoire_id: string; variation_key: string }>(
			supabase,
			'variation_solved',
			userId,
			repIds,
			'repertoire_id, variation_key'
		)
	]);

	const exclusionsByRep = new Map<string, (ExclusionRow & { id: string })[]>();
	for (const [repId, rows] of exclusionRowsByRep) {
		exclusionsByRep.set(
			repId,
			rows.map((r) => ({ id: r.id, variationKey: r.variation_key, verifiedAt: r.verified_at }))
		);
	}
	const solvedByRep = new Map<string, Set<string>>();
	for (const [repId, rows] of solvedRowsByRep) {
		solvedByRep.set(repId, new Set(rows.map((r) => r.variation_key)));
	}

	// The cached shape (`total_variations`) is the whole repertoire's, so a
	// player with exclusions needs their own filtered count on top of it. That
	// used to mean a full move fetch on EVERY load for such a player (the cost
	// GitHub issue #52 was about); now it only happens when their exclusion rows
	// haven't been checked against the repertoire's current move set, after
	// which the count is plain subtraction. See `exclusionFreshness.ts`.
	// Only the freshness verdict is needed here — the count itself is computed
	// further down, once the lazy `total_variations` backfill below has supplied
	// a real full count for any repertoire that didn't have one cached yet.
	const unverifiedIds = (allReps as any[])
		.filter((r) => !exclusionsAreVerified(exclusionsByRep.get(r.id) ?? [], r.moves_updated_at ?? null))
		.map((r) => r.id);

	const needsMoveFetchIds = Array.from(new Set([...uncachedIds, ...unverifiedIds]));
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

	// Freshly enumerated repertoires: their exclusion rows can be reconciled
	// against the live key set now, so the next load for this player takes the
	// subtraction path instead of fetching every move again. Keyed by repertoire
	// so the loop below can use the live (post-prune) exclusion set for its own
	// counts, rather than the raw rows that may include keys about to be deleted.
	const liveExcludedByRep = new Map<string, Set<string>>();
	await Promise.all(
		unverifiedIds.map(async (repId) => {
			const rep = (allReps as any[]).find((r) => r.id === repId);
			const rows = exclusionsByRep.get(repId) ?? [];
			const liveKeys = new Set((variationsByRep.get(repId) ?? []).map((v) => v.variationKey));
			const { live } = partitionByLiveness(rows, liveKeys);
			liveExcludedByRep.set(repId, new Set(live.map((r) => r.variationKey)));
			// `moves_updated_at` is what survivors get stamped with, so a repertoire
			// missing it (only possible if a select forgot the column) is left
			// un-stamped rather than stamped with a guess — it just re-verifies next
			// load, exactly as it does today.
			if (rep?.moves_updated_at) {
				await reverifyExclusions(supabase, userId, rows, liveKeys, rep.moves_updated_at);
			}
		})
	);

	return allReps.map((r: any) => {
		const fullVariationCount: number = r.total_variations ?? backfilledTotals.get(r.id)!;
		const solved = solvedByRep.get(r.id) ?? new Set<string>();

		// Two paths to the same numbers: an enumerated repertoire counts its live
		// exclusions directly, a verified one subtracts the row count it already
		// knows is all-live. Either way `excluded` holds ONLY keys that name a
		// variation that currently exists, which is what keeps `total` and
		// `excludedVariationCount` consistent with each other — they used to be
		// filtered and unfiltered respectively, so a stale row made them sum past
		// `fullVariationCount` and skewed the picker's repertoire checkbox.
		const rows = exclusionsByRep.get(r.id) ?? [];
		const enumerated = liveExcludedByRep.get(r.id);
		const excluded = enumerated ?? new Set(rows.map((row) => row.variationKey));
		// `?? fullVariationCount` is unreachable defence: a null total means the
		// rows weren't verified, and every unverified repertoire was enumerated
		// above, so `enumerated` would have won. If that ever stops holding, an
		// unfiltered count is the safe wrong answer — it can only overstate what's
		// left to practice, never hide lines by reporting fewer.
		const cachedTotal = exclusionShape({ fullVariationCount, rows, movesUpdatedAt: r.moves_updated_at ?? null }).total;
		const total = enumerated
			? (variationsByRep.get(r.id) ?? []).length - excluded.size
			: (cachedTotal ?? fullVariationCount);
		const solvedCount = [...solved].filter((key) => !excluded.has(key)).length; // stale solved keys (repertoire edited since) simply don't inflate the count below via total's own cap

		return {
			id: r.id,
			name: r.name,
			color: r.color,
			solved: Math.min(solvedCount, total),
			total,
			allSolved: total > 0 && Math.min(solvedCount, total) === total,
			fullVariationCount,
			excludedVariationCount: excluded.size,
			hasChapters: r.has_chapters ?? backfilledHasChapters.get(r.id)!
		};
	});
}
