// mychess/src/routes/api/practice/attempt/+server.ts
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { loadRepertoireVariations } from '$lib/server/practice-repertoire';
import { filterVariations } from '$lib/mastery/variations';
import {
	applyAttemptResult,
	loadActiveVariationKey,
	loadSolvedKeys,
	loadTeachingProgress,
	loadVariationUpdatedAt,
	touchVariationAttempt
} from '$lib/server/practice-progress';
import { incrementQuestProgress } from '$lib/server/quests';
import { requireApiUser } from '$lib/server/auth';
import { recordSession } from '$lib/server/sessions';
import { waitUntil } from '@vercel/functions';
import { grantNewBadges } from '$lib/badges/grant';
import { createAdminClient } from '$lib/server/supabase-admin';
import { recordAttemptStats } from '$lib/server/player-stats';
import { buildPracticeView, wasResumedAfterBreak } from '$lib/mastery/practice';
import { deriveLearnPlan } from '$lib/mastery/learnUnits';
import { computeMasteredMoveIds } from '$lib/mastery/teaching';

/**
 * Called once per completed Practice attempt (the whole variation replayed,
 * not per move). Reports whether the attempt was clean — a clean attempt
 * marks the variation solved and advances the active variation; a mistaken
 * one leaves progress untouched (the same variation is naturally re-served
 * next). `touchVariationAttempt` is the one exception to that mistake-is-a-
 * no-op rule: it always records that this variation was just attempted,
 * regardless of outcome, purely to detect a later resume-after-a-break (see
 * `buildPracticeView` in `$lib/mastery/practice.ts`) — it never affects
 * teaching progress or which variation is active.
 *
 * `touchVariationAttempt` and `applyAttemptResult`'s own `saveTeachingProgress`
 * upsert can run concurrently below against the same `variation_teaching_progress`
 * row — this is safe because they write disjoint column sets (only `updated_at`
 * vs. only `taught_plies`/`mastered_plies`), and Postgres/PostgREST's upsert only
 * updates columns present in each request's own payload, so neither can clobber
 * what the other just wrote regardless of interleaving.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const { supabase } = locals;
	const user = await requireApiUser(locals);

	const body = await request.json();
	const { repertoireId, variationKey, hadMistake, sessionStart } = body ?? {};
	if (typeof repertoireId !== 'string' || typeof variationKey !== 'string' || typeof hadMistake !== 'boolean') {
		throw error(400, 'Invalid request');
	}

	// One row per page visit — the client sets this on its first attempt only, so
	// "sessions" means what a person would mean by it. See recordSession.
	if (sessionStart === true) await recordSession(supabase, user.id, repertoireId, 'learn');

	// Read BEFORE touchVariationAttempt's write below lands — reading this
	// after that unconditional refresh would always see a fresh updated_at
	// and never detect a real gap. Must mirror buildPracticeView's own
	// resumed-after-break check exactly, or a clean completion of a served
	// reset attempt would be recorded against the raw (un-reset) stored
	// counters instead of what was actually replayed (see applyAttemptResult's
	// doc comment in practice-progress.ts). A single targeted row read
	// (`loadVariationUpdatedAt`), not the whole-repertoire `loadTeachingProgress`
	// — this fires on every attempt completion, so a full paginated fetch here
	// just to read one variation's timestamp would be real, avoidable cost on
	// a hot path for a large repertoire. Independent of `variations`, so it
	// runs alongside that load rather than after it.
	// solvedKeysBeforeThisAttempt and teachingProgressBeforeThisAttempt join
	// this same Promise.all rather than being read separately afterward: both
	// are needed to derive the learn plan this attempt was SERVED under, which
	// must reflect state as it stood BEFORE this attempt's own outcome is
	// applied below. Reading them here, concurrently with the other two loads
	// already happening, costs nothing extra; the reads further down (after
	// applyAttemptResult) are a genuinely different moment in time
	// (post-attempt), not a redundant repeat.
	const [{ variations: allVariations, excludedVariationKeys }, updatedAtBeforeThisAttempt, solvedKeysBeforeThisAttempt, teachingProgressBeforeThisAttempt] =
		await Promise.all([
			loadRepertoireVariations(supabase, user.id, repertoireId),
			loadVariationUpdatedAt(supabase, user.id, repertoireId, variationKey),
			loadSolvedKeys(supabase, user.id, repertoireId),
			loadTeachingProgress(supabase, user.id, repertoireId)
		]);
	// FILTERED throughout (GitHub issue #182): an excluded line produces no
	// learn unit and no longer blocks its chapter's completion, so there is
	// nothing the unfiltered set is still needed for.
	const variations = filterVariations(allVariations, excludedVariationKeys);
	const today = new Date().toISOString().slice(0, 10);
	const resumedAfterBreak = wasResumedAfterBreak(updatedAtBeforeThisAttempt, new Date());
	const planBeforeThisAttempt = deriveLearnPlan(
		variations,
		computeMasteredMoveIds(variations, teachingProgressBeforeThisAttempt, solvedKeysBeforeThisAttempt)
	);

	await Promise.all([
		applyAttemptResult(
			supabase,
			user.id,
			repertoireId,
			variationKey,
			hadMistake,
			variations,
			resumedAfterBreak,
			planBeforeThisAttempt,
			teachingProgressBeforeThisAttempt
		),
		touchVariationAttempt(supabase, user.id, repertoireId, variationKey),
		incrementQuestProgress(supabase, user.id, 'review_cards', today)
	]);

	const [activeVariationKey, solvedKeys, teachingProgress] = await Promise.all([
		loadActiveVariationKey(supabase, user.id, repertoireId),
		loadSolvedKeys(supabase, user.id, repertoireId),
		loadTeachingProgress(supabase, user.id, repertoireId)
	]);
	const masteredBefore = computeMasteredMoveIds(variations, teachingProgressBeforeThisAttempt, solvedKeysBeforeThisAttempt);
	const masteredAfter = computeMasteredMoveIds(variations, teachingProgress, solvedKeys);

	// Everything below the response line, kept alive by `waitUntil` (GitHub issue
	// #224). Both of these are deliberately off the critical path — a badge must
	// not delay the response to the move the player just made — but a bare
	// `promise.catch(() => {})` is not merely un-awaited, it is UNPROTECTED: the
	// function can freeze the moment the response is sent, and this work does a
	// dozen queries (`grantNewBadges` alone reads six tables, then
	// `countRepertoireStatuses` walks every fully-learned repertoire) before it
	// writes anything. Verified against production on 2026-09-15: a QA player
	// drilled a repertoire to fully solved over 8 clean attempts, earned no
	// badge, and left NO line in the runtime log — not the RLS violation from
	// #221, not the insert error `grant.ts` logs, nothing. Eligible, unwritten
	// and silent is what unfinished work looks like; refused work logs.
	//
	// `waitUntil` keeps it off the response's critical path while telling the
	// platform the invocation is not done, which is the distinction the old
	// comment here missed.
	const afterResponse = async () => {
		// Unconditional, unlike the badge sync below: `total_reviews` counts
		// attempts made, not attempts passed, and a player who is struggling is
		// exactly who should still see `review_10` move.
		await recordAttemptStats(createAdminClient(), user.id, {
			hadMistake,
			newlyMasteredMoves: Math.max(0, masteredAfter.size - masteredBefore.size)
		});
		// A clean attempt is the only kind that can change a repertoire's status,
		// so it is the only one worth recalculating badges for.
		if (!hadMistake) await grantNewBadges(supabase, user.id);
	};
	// The `.catch` stays, and still has to: `createAdminClient()` throws on a
	// missing or rotated `SUPABASE_SERVICE_ROLE_KEY`, and a badge that fails to
	// land must never become a drill the player cannot finish.
	waitUntil(
		afterResponse().catch((err) => {
			console.error(`attempt: post-response work failed for player ${user.id}:`, err instanceof Error ? err.message : err);
		})
	);

	const planAfterAttempt = deriveLearnPlan(variations, masteredAfter);
	return json(buildPracticeView(variations, activeVariationKey, solvedKeys, teachingProgress, planAfterAttempt));
};
