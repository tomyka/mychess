// mychess/src/lib/server/practice-progress.ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Variation } from '$lib/mastery/variations';
import { pickActiveVariation } from '$lib/mastery/variationSequence';
import { advanceTeachingProgress, knownProgressFor, computeMasteredMoveIds } from '$lib/mastery/teaching';
import { fetchAllPages, MAX_ROWS_PAGE_SIZE } from './paginate';
import { isInChapterTier } from '$lib/mastery/variations';
import { completedChapterNames, deriveLearnPlan, nextServableVariationKey, type LearnPlan } from '$lib/mastery/learnUnits';

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
 * Writes a `chapter_completed` cache row for every chapter `variation` belongs
 * to that has just newly finished, per the POST-write plan the caller already
 * derived (`completedChapterNames`) — no second, independently-computed
 * completeness check, which is what let this cache disagree with the Levels
 * page before.
 *
 * Idempotent (safe to call even when the chapter was already complete) and
 * best-effort: this cache only backs the repertoire list's decorative
 * "Mastered" badge, never the authoritative Levels page or badge counts (both
 * derive fresh from teaching progress directly, with no cache) — so a failed
 * write here must not fail the attempt it's piggybacking on.
 */
async function cacheCompletedChaptersReached(
	supabase: SupabaseClient,
	playerId: string,
	repertoireId: string,
	variation: Variation,
	plan: LearnPlan
): Promise<void> {
	const completed = completedChapterNames(plan);
	const completedChapters = [...completed].filter((chapter) => isInChapterTier(variation, chapter));
	if (completedChapters.length === 0) return;

	const { error } = await supabase
		.from('chapter_completed')
		.upsert(
			completedChapters.map((chapterName) => ({ player_id: playerId, repertoire_id: repertoireId, chapter_name: chapterName })),
			{ onConflict: 'player_id,repertoire_id,chapter_name', ignoreDuplicates: true }
		);
	if (error) {
		console.error(`cacheCompletedChaptersReached: failed to write for repertoire ${repertoireId}:`, error.message);
	}
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
): Promise<
	Map<
		string,
		{
			taughtPlies: number;
			masteredPlies: number;
			updatedAt: string | null;
		}
	>
> {
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
		rows.map((r) => [
			r.variation_key,
			{
				taughtPlies: r.taught_plies,
				masteredPlies: r.mastered_plies,
				updatedAt: r.updated_at
			}
		])
	);
}

/**
 * Persists this variation's teaching-progress counters (see
 * `src/lib/mastery/teaching.ts`).
 */
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
			{
				player_id: playerId,
				repertoire_id: repertoireId,
				variation_key: variationKey,
				taught_plies: taughtPlies,
				mastered_plies: masteredPlies
			},
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
 *
 * `servableVariationKeys` (from `deriveLearnPlan`) defaults to undefined, so a
 * caller with no plan on hand is unaffected. Passing it means a stored pointer
 * at a variation whose learn unit has since been learned gets resolved past at
 * THIS stage rather than relying entirely on `buildPracticeView`'s own later
 * `pickActiveVariation` call to correct it — both call the same pure function,
 * so this is a strictly earlier application of the same rule, not a second,
 * independently-computed one.
 */
export async function loadSyncedActiveVariationKey(
	supabase: SupabaseClient,
	playerId: string,
	repertoireId: string,
	variations: Variation[],
	solvedKeys: ReadonlySet<string>,
	servableVariationKeys?: readonly string[]
): Promise<string | null> {
	if (variations.length === 0) return null;
	const stored = await loadActiveVariationKey(supabase, playerId, repertoireId);
	const resolved = pickActiveVariation(variations, stored, solvedKeys, servableVariationKeys);
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
 * progress advances (see `advanceTeachingProgress`) — starting from whatever
 * `knownProgressFor` says is already known for it: its own stored counters, or
 * the higher shared-mastery floor a sibling variation may have earned for the
 * same leading moves. `buildPracticeView` derives the served attempt from that
 * same function, which is what guarantees this records progress against the
 * step that was actually served rather than a separately-computed one.
 * `resumedAfterBreak` (see `wasResumedAfterBreak` in `mastery/practice.ts`) is
 * the one input the caller must still supply, since only the serve side knows
 * whether it suppressed auto-play: when true, the floor is zeroed here exactly
 * as it was for the served attempt, so a clean run of a break-reset teach
 * batch advances progress by only what was actually replayed in it — never
 * against the raw, un-reset stored counters, which could otherwise jump
 * progress ahead or even wrongly mark the variation solved off a truncated
 * replay.
 *
 * `next.solved` (a clean pass over the variation's FINAL batch) is what marks
 * it learned — immediately, on this one pass. Story #104's two-pass, 20h-gap
 * graduation rule was removed: it made "learned" no visible progress at all
 * on the day a player actually solved something, and the same protection it
 * was providing already exists downstream — `demoteVariation` (Practice pool)
 * sends a learned variation straight back to Learn the moment it's failed or
 * hinted, so a lucky one-off pass doesn't get to sit in Practice unchecked.
 *
 * `variations` is this player's PRACTICEABLE (exclusion-filtered) set, used
 * for everything: finding the served variation, teaching-progress credit,
 * picking what to serve next, and the completed-chapters cache write. Unlike
 * the tier-ceiling model this replaces, there is no second unfiltered set —
 * an excluded line no longer blocks its chapter, so there is nothing for it
 * to be present for.
 *
 * `plan` (from `deriveLearnPlan`) caps how far into a NOT-YET-solved variation
 * this attempt may credit — the served learn unit's own clipped length, the
 * same cap `buildPracticeView` applied at serve time, so what gets recorded
 * always matches what was actually served. When a clean pass reaches that cap
 * without reaching the variation's own true end (`next.unitComplete`), the
 * UNIT is learned but the VARIATION is not solved: `variation_solved` and the
 * completed-chapters cache are both left untouched, so the line stays out of
 * the Practice pool until a later band serves it to its real end. The active
 * pointer still MUST advance, exactly as a genuine solve does — leaving it on
 * a variation whose unit is now learned would re-serve the same finished board
 * forever, this repo's central "stuck gauntlet" failure mode.
 */
export async function applyAttemptResult(
	supabase: SupabaseClient,
	playerId: string,
	repertoireId: string,
	variationKey: string,
	hadMistake: boolean,
	variations: Variation[],
	resumedAfterBreak: boolean = false,
	plan: LearnPlan | null = null,
	// When the caller already loaded this exact pre-write snapshot moments
	// earlier in the same request (e.g. /api/practice/attempt, which needs it
	// to derive the plan this attempt was served under), passing it in avoids a
	// second, redundant whole-repertoire paginated fetch of
	// variation_teaching_progress on every single clean attempt — the hottest
	// path in the app. Defaults to undefined so a caller without one on hand
	// falls back to a fresh load.
	preloadedTeachingProgress?: ReadonlyMap<string, { taughtPlies: number; masteredPlies: number; updatedAt: string | null }>
): Promise<void> {
	if (hadMistake) return;

	const variation = variations.find((v) => v.variationKey === variationKey);
	// Hoisted out of the `!solvedKeys.has` branch below: the post-write plan and
	// `cacheCompletedChaptersReached`'s `isChapterComplete` check both need a
	// progress snapshot in EVERY branch that reaches them, including a re-drill
	// of an already-solved variation. Cloned into a fresh `Map` either way — the
	// local `.set()` patch below must never mutate a map the caller still holds
	// a reference to.
	let progressMap: Map<string, { taughtPlies: number; masteredPlies: number; updatedAt: string | null }> | undefined;
	if (variation) {
		const solvedKeys = await loadSolvedKeys(supabase, playerId, repertoireId);
		progressMap = new Map(preloadedTeachingProgress ?? (await loadTeachingProgress(supabase, playerId, repertoireId)));
		if (!solvedKeys.has(variationKey)) {
			const { taughtPlies: effectiveTaughtPlies, masteredPlies: effectiveMasteredPlies } = knownProgressFor({
				variation,
				variations,
				teachingProgress: progressMap,
				solvedKeys,
				resumedAfterBreak
			});
			const ceilingPly = plan?.ceilingPlyByVariationKey.get(variationKey) ?? variation.path.length;
			const next = advanceTeachingProgress(variation.path, effectiveTaughtPlies, effectiveMasteredPlies, false, ceilingPly);
			await saveTeachingProgress(supabase, playerId, repertoireId, variationKey, next.taughtPlies, next.masteredPlies);

			// Patch this variation's just-written counters locally — progressMap
			// still reflects PRE-write state, and re-fetching would be a
			// redundant round trip for the one row we already know the new
			// value of. Every use of progressMap below sees this patched value.
			progressMap.set(variationKey, {
				...(progressMap.get(variationKey) ?? { taughtPlies: 0, masteredPlies: 0, updatedAt: null }),
				taughtPlies: next.taughtPlies,
				masteredPlies: next.masteredPlies
			});

			if (next.unitComplete) {
				// The served unit is learned; the variation itself is not
				// finished. No `variation_solved`, no completed-chapters cache
				// — but the pointer must still move on.
				const planAfter = deriveLearnPlan(variations, computeMasteredMoveIds(variations, progressMap, solvedKeys));
				await setActiveVariationKey(supabase, playerId, repertoireId, nextServableVariationKey(planAfter, variations, variationKey));
				return;
			}
			if (!next.solved) return;
		}
	}

	await markVariationSolved(supabase, playerId, repertoireId, variationKey);
	const solvedKeys = await loadSolvedKeys(supabase, playerId, repertoireId);
	// Derived from the (possibly patched) pre-write progress plus the
	// just-refreshed POST-write solved set, matching
	// `cacheCompletedChaptersReached`'s "up-to-date" contract. `progressMap` is
	// undefined only when `variationKey` matched no variation at all — a stale
	// or foreign key — where solved-only credit is enough to move the pointer.
	const masteredMoveIds = computeMasteredMoveIds(variations, progressMap ?? new Map(), solvedKeys);
	const planAfter = deriveLearnPlan(variations, masteredMoveIds);
	await setActiveVariationKey(supabase, playerId, repertoireId, nextServableVariationKey(planAfter, variations, variationKey));
	if (variation) {
		await cacheCompletedChaptersReached(supabase, playerId, repertoireId, variation, planAfter);
	}
}
