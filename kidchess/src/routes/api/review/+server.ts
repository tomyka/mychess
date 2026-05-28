import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals: { supabase, safeGetSession } }) => {
	const { user } = await safeGetSession();
	if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

	const { moveId, rating, xp } = await request.json();

	// Upsert review card
	const now = new Date().toISOString();
	await supabase.from('reviews').upsert(
		{ kid_id: user.id, move_id: moveId, last_review: now },
		{ onConflict: 'kid_id,move_id' }
	);

	// Update XP via RPC
	if (xp !== 0) {
		await supabase.rpc('update_xp_and_level', { p_kid_id: user.id, p_xp_delta: xp });
	}

	return json({ ok: true });
};
