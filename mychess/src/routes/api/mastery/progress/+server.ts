import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { xpForReview } from '$lib/srs/xp';

export const POST: RequestHandler = async ({ request, locals: { supabase, safeGetSession } }) => {
	const { user } = await safeGetSession();
	if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

	const { repertoireId, leafMoveId, variationKey, depthReached } = await request.json();
	if (!repertoireId || !leafMoveId || !variationKey || typeof depthReached !== 'number') {
		return json({ error: 'Invalid request' }, { status: 400 });
	}

	const { data: existing, error: selectError } = await supabase
		.from('variation_progress')
		.select('deepest_depth_reached')
		.eq('player_id', user.id)
		.eq('variation_key', variationKey)
		.maybeSingle();
	if (selectError) return json({ error: selectError.message }, { status: 500 });

	const oldDepth = existing?.deepest_depth_reached ?? 0;
	const newlyCovered = Math.max(0, depthReached - oldDepth);

	if (newlyCovered > 0) {
		const { error: upsertError } = await supabase.from('variation_progress').upsert(
			{
				player_id: user.id,
				repertoire_id: repertoireId,
				leaf_move_id: leafMoveId,
				variation_key: variationKey,
				deepest_depth_reached: depthReached
			},
			{ onConflict: 'player_id,variation_key' }
		);
		if (upsertError) return json({ error: upsertError.message }, { status: 500 });
	}

	const xpAwarded = newlyCovered * xpForReview(true, false);
	if (xpAwarded > 0) {
		const { error: rpcError } = await supabase.rpc('update_xp_and_level', {
			p_player_id: user.id,
			p_xp_delta: xpAwarded
		});
		if (rpcError) return json({ error: rpcError.message }, { status: 500 });
	}

	return json({ xpAwarded });
};
