// mychess/src/routes/(player)/learn/+page.server.ts
import type { PageServerLoad } from './$types';
import { requireAccount } from '$lib/server/auth';
import { loadRepertoireProgressSummaries } from '$lib/server/repertoire-progress';

/**
 * The Learn list. Added after #96 moved the teaching flow to `/learn/[id]` and
 * gave the nav a Learn entry without a landing page behind it — `/learn` 404'd
 * in production until this existed.
 *
 * Only repertoires with something left to learn are listed — the mirror of the
 * Practice list's own gate. A fully-learned repertoire sat here indefinitely
 * with a "Learned" chip, and opening it just showed the trophy screen pointing
 * at Practice, so the row was a dead end. `allSolved` is false for a repertoire
 * with no moves at all (see repertoire-progress.ts), which is what keeps an
 * empty repertoire visible somewhere rather than nowhere.
 */
export const load: PageServerLoad = async ({ locals }) => {
	const { user } = await requireAccount(locals);
	const summaries = await loadRepertoireProgressSummaries(locals.supabase, user!.id);
	return {
		repertoires: summaries.filter((s) => !s.allSolved),
		// So the empty state can tell "nothing assigned" from "you finished
		// everything" — and so a non-empty list can still point at what moved.
		learnedCount: summaries.filter((s) => s.allSolved).length
	};
};
