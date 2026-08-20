// mychess/src/routes/api/practice/pool-attempt/+server.ts
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireApiUser } from '$lib/server/auth';
import { demoteVariation } from '$lib/server/practice-pool';
import { loadSolvedKeys } from '$lib/server/practice-progress';

/**
 * Records the outcome of one Practice-pool attempt (stories #97/#98).
 *
 * `clean` is a no-op beyond the per-move logging the client already does via
 * `/api/practice/move-log`: practising something successfully doesn't change any
 * state, it just leaves attempt rows behind that shift the variation down the
 * weakest-first ordering next time.
 *
 * `mistake` and `hint` both demote. A hint counts as failure for the same reason
 * it marks a Learn pass dirty (#92): needing the piece revealed on material you
 * are supposed to know means you don't know it.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const { supabase } = locals;
	const user = await requireApiUser(locals);

	const body = await request.json();
	const { repertoireId, variationKey, outcome } = body ?? {};
	if (
		typeof repertoireId !== 'string' ||
		typeof variationKey !== 'string' ||
		(outcome !== 'clean' && outcome !== 'mistake' && outcome !== 'hint')
	) {
		throw error(400, 'Invalid request');
	}

	if (outcome === 'clean') return json({ demoted: false });

	// Only a variation that is actually learned can be demoted. Without this a
	// replayed or duplicated request would write a second demotion row and reset
	// a counter the player has since rebuilt in Learn — the narrow check is on
	// the specific invariant (is this key still learned?) rather than re-deriving
	// the whole repertoire.
	const learnedKeys = await loadSolvedKeys(supabase, user.id, repertoireId);
	if (!learnedKeys.has(variationKey)) return json({ demoted: false });

	await demoteVariation(supabase, user.id, repertoireId, variationKey, outcome);
	return json({ demoted: true });
};
