// mychess/src/routes/(player)/practice/[repertoire_id]/+page.server.ts
import type { PageServerLoad } from './$types';
import { requireAccount } from '$lib/server/auth';
import { loadFilteredRepertoireVariations } from '$lib/server/practice-repertoire';
import { loadSolvedKeys } from '$lib/server/practice-progress';
import { loadMoveAttemptStats } from '$lib/server/practice-pool';
import { coachUpdatedLineCount } from '$lib/server/coach-update-notice';
import { splitQueues } from '$lib/mastery/learning';
import { orderPracticeQueue } from '$lib/mastery/practiceQueue';
import { fullyLearnedChapters } from '$lib/mastery/repertoireStatus';
import { isInChapterTier } from '$lib/mastery/variations';

/**
 * The Practice pool: learned variations only, weakest-first, no arrows ever
 * (story #97 of epic #95).
 *
 * This URL used to serve the teaching flow, which moved to `/learn/[id]` in #96.
 * An old bookmark therefore lands here, and for a repertoire with nothing
 * learned yet that is the locked state below — which says so and links to Learn,
 * rather than a redirect that would have had to be removed one story later.
 *
 * `loadFilteredRepertoireVariations` has already dropped anything excluded, so
 * `splitQueues` only separates learned from un-learned here — and it is the same
 * function the Learn route uses, which is what stops a variation appearing on
 * both surfaces. `learnedCount` is `splitQueues`' full learned count (used to
 * pick the "nothing learned yet" locked state); the queue served below is
 * further narrowed to only chapters that are ENTIRELY learned, so
 * `learnedCount > 0` with an empty `queue` is a real, distinct state — some
 * lines are learned, but no whole chapter is finished yet.
 */
export const load: PageServerLoad = async ({ params, locals }) => {
	const { user } = await requireAccount(locals);
	const supabase = locals.supabase;
	const repertoireId = params.repertoire_id;

	// Joined into the existing parallel read rather than awaited after it: it
	// reads only this student's demotion and solved rows, so it depends on
	// neither and costs latency only when it is the slowest of the three.
	//
	// There is no read-your-own-write race with reconciliation here, because
	// nothing on this path reconciles: the `coach_update` demotions this counts
	// are written by `reconcilePlayerProgress`, which runs from
	// `repertoire-progress.ts` (the dashboard, the practice picker, the learn
	// list) — every route a student can reach this page THROUGH. By the time
	// this load runs, the rows it counts already exist.
	const [{ repertoire, variations }, learnedKeys, coachUpdatedLines] = await Promise.all([
		loadFilteredRepertoireVariations(supabase, user!.id, repertoireId),
		loadSolvedKeys(supabase, user!.id, repertoireId),
		coachUpdatedLineCount(supabase, user!.id, repertoireId)
	]);

	const { learn, practice } = splitQueues(variations, learnedKeys);

	// A learned line only becomes practiceable once its WHOLE chapter is
	// learned — a lone learned line inside an otherwise-unfinished chapter
	// stays out, so the player finishes what they started in Learn first
	// (see fullyLearnedChapters).
	const readyChapters = fullyLearnedChapters(variations, learnedKeys);
	const available = practice.filter((v) => [...readyChapters].some((chapter) => isInChapterTier(v, chapter)));

	// Only pay for the attempt sweep when there is something to order with it.
	const stats = available.length > 0 ? await loadMoveAttemptStats(supabase, user!.id, repertoireId) : new Map();
	const ordered = orderPracticeQueue(available, stats);
	const byKey = new Map(available.map((v) => [v.variationKey, v]));

	return {
		repertoire,
		// Ordered weakest-first on the server. The client walks this list rather
		// than re-deriving the order, so the two cannot disagree about what comes
		// next.
		queue: ordered.map((variationKey) => {
			const variation = byKey.get(variationKey)!;
			return { variationKey, path: variation.path, chapterNames: variation.chapterNames };
		}),
		// Lines a coach's reshape sent back to review that this student has not
		// re-learned yet. Self-clearing — see `coachUpdatedLineCount`.
		coachUpdatedLines,
		learnedCount: practice.length,
		stillLearningCount: learn.length,
		total: practice.length + learn.length
	};
};
