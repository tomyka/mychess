// mychess/src/lib/server/practice-progress.ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Variation } from '$lib/mastery/variations';
import { pickActiveVariation, advanceIfSolved } from '$lib/mastery/variationSequence';
import { advanceTeachingProgress, computeMasteredMoveIds, sharedMasteredPrefixLength, effectiveProgress } from '$lib/mastery/teaching';
import { fetchAllPages, MAX_ROWS_PAGE_SIZE } from './paginate';

/**
 * This player's full solved-variation-key set for one repertoire.
 *
 * Paginated: Supabase/PostgREST caps an unbounded select at `max_rows` (1000,
 * see supabase/config.toml) and truncates silently, and a large repertoire
 * (1,000+ variations, which exists in production) can have more solved keys
 * than that — a truncated read would read back as "these lines were never
 * solved" and re-serve them. Errors are thrown rather than swallowed for the
 * same reason: an empty `data` on a failed read is indistinguishable from
 * "nothing solved yet", which would silently reset the player's progress
 * view.
 */
export async function loadSolvedKeys(supabase: SupabaseClient, playerId: string, repertoireId: string): Promise<Set<string>> {
	const rows = await fetchAllPages<{ variation_key: string }>(
		() =>
			supabase
				.from('variation_solved')
				.select('variation_key')
				.eq('player_id', playerId)
				.eq('repertoire_id', repertoireId)
				.order('variation_key', { ascending: true }),
		() =>
			supabase
				.from('variation_solved')
				.select('id', { count: 'exact', head: true })
				.eq('player_id', playerId)
				.eq('repertoire_id', repertoireId),
		MAX_ROWS_PAGE_SIZE
	);
	return new Set(rows.map((r) => r.variation_key));
}

/** This player's currently-persisted active variation key for one repertoire, or `null` if no row exists yet. */
export async function loadActiveVariationKey(
	supabase: SupabaseClient,
	playerId: string,
	repertoireId: string
): Promise<string | null> {
	const { data } = await supabase
		.from('practice_active_variation')
		.select('active_variation_key')
		.eq('player_id', playerId)
		.eq('repertoire_id', repertoireId)
		.maybeSingle();
	return data?.active_variation_key ?? null;
}

/**
 * This variation's currently-persisted `updated_at`, or `null` if no row
 * exists yet. A single targeted row read — unlike `loadTeachingProgress`,
 * which loads the WHOLE repertoire's progress — for callers (like the
 * attempt-completion endpoint) that only need one variation's recency to
 * decide `wasResumedAfterBreak`, without paying a full paginated fetch on a
 * per-attempt hot path.
 */
export async function loadVariationUpdatedAt(
	supabase: SupabaseClient,
	playerId: string,
	repertoireId: string,
	variationKey: string
): Promise<string | null> {
	const { data } = await supabase
		.from('variation_teaching_progress')
		.select('updated_at')
		.eq('player_id', playerId)
		.eq('repertoire_id', repertoireId)
		.eq('variation_key', variationKey)
		.maybeSingle();
	return data?.updated_at ?? null;
}

/**
 * Persists a specific variation as the active one — used both by the manual
 * picker (set exactly what was clicked) and by attempt-completion (set the
 * next-in-sequence variation once the previous one is solved). A plain
 * upsert: no optimistic-concurrency version column, unlike the old
 * level_progress table — see migration 0045's comment for why a benign
 * last-write-wins race is an acceptable tradeoff here.
 */
export async function setActiveVariationKey(
	supabase: SupabaseClient,
	playerId: string,
	repertoireId: string,
	activeVariationKey: string | null
): Promise<void> {
	await supabase
		.from('practice_active_variation')
		.upsert(
			{ player_id: playerId, repertoire_id: repertoireId, active_variation_key: activeVariationKey, updated_at: new Date().toISOString() },
			{ onConflict: 'player_id,repertoire_id' }
		);
}

/**
 * Marks a variation solved (idempotent — inserting an already-solved key is
 * a harmless no-op via `ignoreDuplicates`, since solved never un-solves).
 */
export async function markVariationSolved(
	supabase: SupabaseClient,
	playerId: string,
	repertoireId: string,
	variationKey: string
): Promise<void> {
	await supabase
		.from('variation_solved')
		.upsert(
			{ player_id: playerId, repertoire_id: repertoireId, variation_key: variationKey },
			{ onConflict: 'player_id,variation_key_hash', ignoreDuplicates: true }
		);
}

/**
 * This player's full teaching-progress state for one repertoire, keyed by variation_key.
 *
 * Paginated and error-propagating for the same reasons as `loadSolvedKeys`
 * above — a silently truncated (or silently failed) read here reads back as
 * "nothing taught yet" for the missing variations, resetting their teaching
 * counters and re-teaching them from ply 0.
 */
export async function loadTeachingProgress(
	supabase: SupabaseClient,
	playerId: string,
	repertoireId: string
): Promise<Map<string, { taughtPlies: number; masteredPlies: number; updatedAt: string | null }>> {
	const rows = await fetchAllPages<{
		variation_key: string;
		taught_plies: number;
		mastered_plies: number;
		updated_at: string | null;
	}>(
		() =>
			supabase
				.from('variation_teaching_progress')
				.select('variation_key, taught_plies, mastered_plies, updated_at')
				.eq('player_id', playerId)
				.eq('repertoire_id', repertoireId)
				.order('variation_key', { ascending: true }),
		() =>
			supabase
				.from('variation_teaching_progress')
				.select('id', { count: 'exact', head: true })
				.eq('player_id', playerId)
				.eq('repertoire_id', repertoireId),
		MAX_ROWS_PAGE_SIZE
	);
	return new Map(
		rows.map((r) => [r.variation_key, { taughtPlies: r.taught_plies, masteredPlies: r.mastered_plies, updatedAt: r.updated_at }])
	);
}

/** Persists this variation's teaching-progress counters (see `src/lib/mastery/teaching.ts`). */
export async function saveTeachingProgress(
	supabase: SupabaseClient,
	playerId: string,
	repertoireId: string,
	variationKey: string,
	taughtPlies: number,
	masteredPlies: number
): Promise<void> {
	await supabase
		.from('variation_teaching_progress')
		.upsert(
			{ player_id: playerId, repertoire_id: repertoireId, variation_key: variationKey, taught_plies: taughtPlies, mastered_plies: masteredPlies },
			{ onConflict: 'player_id,variation_key_hash' }
		);
}

/**
 * Records that the player just attempted this variation, regardless of
 * outcome — the only unconditional write to `variation_teaching_progress`
 * in the attempt-completion flow (unlike `applyAttemptResult`, which is a
 * true no-op on a mistake). Only
 * `updated_at` is included in the upsert payload, so an existing row's real
 * `taught_plies`/`mastered_plies` are left exactly as they were; a variation
 * with no row yet gets one created with the table's own 0/0 defaults, which
 * every reader of this table already treats as equivalent to "no row exists".
 * Powers `buildPracticeView`'s resumed-after-a-break check in
 * `mastery/practice.ts`.
 */
export async function touchVariationAttempt(
	supabase: SupabaseClient,
	playerId: string,
	repertoireId: string,
	variationKey: string
): Promise<void> {
	await supabase
		.from('variation_teaching_progress')
		.upsert(
			{ player_id: playerId, repertoire_id: repertoireId, variation_key: variationKey, updated_at: new Date().toISOString() },
			{ onConflict: 'player_id,variation_key_hash' }
		);
}

/**
 * Ensures a `practice_active_variation` row exists and resolves to a real,
 * current variation before the page ever renders — self-healing the same
 * way `pickActiveVariation` already does for a stale/missing key (a fresh
 * player, or a repertoire edited/excluded since the key was last stored).
 * Returns the RESOLVED key (never null unless there are no variations at
 * all), persisting it if it differs from what was stored.
 */
export async function loadSyncedActiveVariationKey(
	supabase: SupabaseClient,
	playerId: string,
	repertoireId: string,
	variations: Variation[],
	solvedKeys: ReadonlySet<string>
): Promise<string | null> {
	if (variations.length === 0) return null;
	const stored = await loadActiveVariationKey(supabase, playerId, repertoireId);
	const resolved = pickActiveVariation(variations, stored, solvedKeys);
	if (!resolved) return null;
	if (resolved.variationKey !== stored) {
		await setActiveVariationKey(supabase, playerId, repertoireId, resolved.variationKey);
	}
	return resolved.variationKey;
}

/**
 * Applies a completed attempt's outcome. A mistaken attempt is always a
 * no-op (no reads, no writes) — the active variation and its teaching
 * progress both stay exactly as they were, so the next attempt naturally
 * re-serves the same step for another try.
 *
 * On a clean attempt: if the variation isn't already solved, its teaching
 * progress advances (see `advanceTeachingProgress`) — starting from whichever
 * is higher, its OWN stored counters or the shared-mastery floor a sibling
 * variation may have already earned for the same leading moves (see
 * `computeMasteredMoveIds` — this MUST mirror `buildPracticeView`'s own
 * floor computation exactly, or the server would record progress against a
 * different step than the one it actually served). `resumedAfterBreak`
 * mirrors that same requirement for `buildPracticeView`'s resumed-after-a-break
 * reset (see `wasResumedAfterBreak` in `mastery/practice.ts`): when true, the
 * floor used here is zeroed exactly like the served attempt was, so a clean
 * run of a break-reset teach batch advances progress by only what was
 * actually replayed in it — never against the raw, un-reset stored counters,
 * which could otherwise jump progress ahead or even wrongly mark the
 * variation solved off a truncated replay. UNLESS that was the variation's
 * final batch, in which case (exactly like an already-solved variation
 * re-drilled via the picker) it falls through to the existing
 * solved/advance-active-variation sequence.
 */
export async function applyAttemptResult(
	supabase: SupabaseClient,
	playerId: string,
	repertoireId: string,
	variationKey: string,
	hadMistake: boolean,
	variations: Variation[],
	resumedAfterBreak: boolean = false
): Promise<void> {
	if (hadMistake) return;

	const variation = variations.find((v) => v.variationKey === variationKey);
	if (variation) {
		const solvedKeys = await loadSolvedKeys(supabase, playerId, repertoireId);
		if (!solvedKeys.has(variationKey)) {
			const progressMap = await loadTeachingProgress(supabase, playerId, repertoireId);
			const current = progressMap.get(variationKey) ?? { taughtPlies: 0, masteredPlies: 0, updatedAt: null };
			const masteredMoveIds = computeMasteredMoveIds(variations, progressMap, solvedKeys);
			const sharedFloor = sharedMasteredPrefixLength(variation.path, masteredMoveIds);
			const { taughtPlies: effectiveTaughtPlies, masteredPlies: effectiveMasteredPlies } = effectiveProgress(
				current.taughtPlies,
				current.masteredPlies,
				sharedFloor,
				resumedAfterBreak
			);
			const next = advanceTeachingProgress(variation.path, effectiveTaughtPlies, effectiveMasteredPlies, false);
			await saveTeachingProgress(supabase, playerId, repertoireId, variationKey, next.taughtPlies, next.masteredPlies);
			if (!next.solved) return;
		}
	}

	await markVariationSolved(supabase, playerId, repertoireId, variationKey);
	const solvedKeys = await loadSolvedKeys(supabase, playerId, repertoireId);
	const next = advanceIfSolved(variationKey, variations, solvedKeys);
	await setActiveVariationKey(supabase, playerId, repertoireId, next);
}
