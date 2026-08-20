import type { PageServerLoad } from './$types';
import { requireAccount } from '$lib/server/auth';
import { loadRepertoireProgressSummaries } from '$lib/server/repertoire-progress';
import { loadFilteredRepertoireVariations } from '$lib/server/practice-repertoire';
import { loadSolvedKeys } from '$lib/server/practice-progress';
import { fullyLearnedChapters } from '$lib/mastery/repertoireStatus';

/**
 * Only repertoires with at least one WHOLE chapter learned belong in the
 * Practice list — a repertoire the player hasn't finished a single chapter
 * of has nothing practiceable yet (see `fullyLearnedChapters` and the pool
 * page's own gate, +page.server.ts under [repertoire_id]).
 *
 * A repertoire with `solved === 0` can be skipped without the expensive
 * per-chapter check: a chapter needs at least one variation, and none of
 * them are learned, so it trivially has zero fully-learned chapters. That
 * keeps this cheap for the common case of an assigned-but-unstarted
 * repertoire, at the cost of one extra variation+solved-keys fetch per
 * repertoire the player HAS made some progress on.
 */
export const load: PageServerLoad = async ({ locals }) => {
	const { user } = await requireAccount(locals);
	const supabase = locals.supabase;
	const summaries = await loadRepertoireProgressSummaries(supabase, user!.id);
	const candidates = summaries.filter((s) => s.solved > 0);

	const readyIds = new Set(
		(
			await Promise.all(
				candidates.map(async (s) => {
					try {
						const [{ variations }, learnedKeys] = await Promise.all([
							loadFilteredRepertoireVariations(supabase, user!.id, s.id),
							loadSolvedKeys(supabase, user!.id, s.id)
						]);
						return fullyLearnedChapters(variations, learnedKeys).size > 0 ? s.id : null;
					} catch (err) {
						// A repertoire that fails this check is left off the list rather
						// than crashing it — logged so a persistent failure is visible.
						console.error(`practice list: chapter-readiness check failed for repertoire ${s.id}:`, err);
						return null;
					}
				})
			)
		).filter((id): id is string => id !== null)
	);

	return {
		repertoires: summaries.filter((s) => readyIds.has(s.id)),
		// So the empty state can tell "no repertoires at all" apart from "you
		// have some, just nothing practiceable yet" — very different messages.
		hasAnyRepertoires: summaries.length > 0
	};
};
