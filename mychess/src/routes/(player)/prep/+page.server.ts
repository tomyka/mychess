import type { PageServerLoad } from './$types';
import { requireAccount } from '$lib/server/auth';
import { loadActivePreparation } from '$lib/server/active-openings';

/**
 * The student's pre-game prep view (GitHub issue #203, part C of epic #119):
 * their material organised by OPENING rather than by the filename a coach
 * happened to give it, so "what do I play against 1.e4 tomorrow" is answerable
 * without knowing which file to open.
 *
 * Read-only by design. This layer owns no progress state — epic #119's
 * standing non-goal — so there are no actions here, and opening the view
 * records nothing.
 */
export const load: PageServerLoad = async ({ locals }) => {
	const { user } = await requireAccount(locals);
	const preparation = await loadActivePreparation(locals.supabase, user!.id);

	return {
		// Sorted by side then opening name so White and Black group cleanly and
		// the order does not shift between loads.
		preparation: preparation.sort(
			(a, b) => a.opening.side.localeCompare(b.opening.side) || a.opening.name.localeCompare(b.opening.name)
		)
	};
};
