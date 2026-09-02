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
import { grantNewBadges } from '$lib/badges/grant';
import { buildPracticeView, wasResumedAfterBreak } from '$lib/mastery/practice';
import { teachingCeilingMoveCount } from '$lib/mastery/chapterLevels';
import { computeMasteredPliesMap } from '$lib/mastery/teaching';

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
	// UNFILTERED here (`loadRepertoireVariations`, not the `...Filtered...`
	// variant): `applyAttemptResult`'s own serving/teaching logic still needs
	// the FILTERED set (derived below), but its completed-chapters cache write
	// needs the excluded variations still present, so an excluded, never-solved
	// line still caps its chapter instead of vanishing from the bracket
	// entirely — see `isChapterComplete`'s doc comment.
	// solvedKeysBeforeThisAttempt joins this same Promise.all rather than being
	// read separately afterward: it's needed to compute the ceiling this attempt
	// is capped under (GitHub issue #163), which must reflect the solved set as
	// it stood BEFORE this attempt's own outcome is applied below — the same cap
	// the request that served this attempt computed it under. Reading it here,
	// concurrently with the other two loads already happening, costs nothing
	// extra; the solvedKeys read further down (after applyAttemptResult) is a
	// genuinely different moment in time (post-attempt), not a redundant repeat.
	// teachingProgressBeforeThisAttempt joins the same Promise.all for the
	// same reason solvedKeysBeforeThisAttempt does (see the comment above):
	// teachingCeilingMoveCount now needs a masteredPlies map (GitHub issue
	// #181), computed from state as it stood BEFORE this attempt's own
	// outcome is applied below.
	const [{ variations: allVariations, excludedVariationKeys }, updatedAtBeforeThisAttempt, solvedKeysBeforeThisAttempt, teachingProgressBeforeThisAttempt] =
		await Promise.all([
			loadRepertoireVariations(supabase, user.id, repertoireId),
			loadVariationUpdatedAt(supabase, user.id, repertoireId, variationKey),
			loadSolvedKeys(supabase, user.id, repertoireId),
			loadTeachingProgress(supabase, user.id, repertoireId)
		]);
	const variations = filterVariations(allVariations, excludedVariationKeys);
	const today = new Date().toISOString().slice(0, 10);
	const resumedAfterBreak = wasResumedAfterBreak(updatedAtBeforeThisAttempt, new Date());
	const masteredPliesBeforeThisAttempt = computeMasteredPliesMap(allVariations, teachingProgressBeforeThisAttempt, solvedKeysBeforeThisAttempt);
	const ceilingMoveCount = teachingCeilingMoveCount(allVariations, masteredPliesBeforeThisAttempt);

	await Promise.all([
		applyAttemptResult(
			supabase,
			user.id,
			repertoireId,
			variationKey,
			hadMistake,
			variations,
			resumedAfterBreak,
			allVariations,
			ceilingMoveCount
		),
		touchVariationAttempt(supabase, user.id, repertoireId, variationKey),
		incrementQuestProgress(supabase, user.id, 'review_cards', today)
	]);

	const [activeVariationKey, solvedKeys, teachingProgress] = await Promise.all([
		loadActiveVariationKey(supabase, user.id, repertoireId),
		loadSolvedKeys(supabase, user.id, repertoireId),
		loadTeachingProgress(supabase, user.id, repertoireId)
	]);
	// Badge recalculation was only ever wired to Drill and Time Trial, so nothing
	// in the learning flow could grant (or revoke) a badge. A clean attempt is the
	// only kind that can change a repertoire's status, so it is the only one worth
	// recalculating for. Fire-and-forget, matching the existing callers: a badge
	// must not delay the response to the move the player just made.
	if (!hadMistake) grantNewBadges(supabase, user.id).catch(() => {});

	const masteredPliesAfterAttempt = computeMasteredPliesMap(allVariations, teachingProgress, solvedKeys);
	const ceilingMoveCountAfterAttempt = teachingCeilingMoveCount(allVariations, masteredPliesAfterAttempt);
	return json(buildPracticeView(variations, activeVariationKey, solvedKeys, teachingProgress, ceilingMoveCountAfterAttempt));
};
