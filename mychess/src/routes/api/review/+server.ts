import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { grantNewBadges } from '$lib/badges/grant';

export const POST: RequestHandler = async ({ request, locals: { supabase, safeGetSession } }) => {
	const { user } = await safeGetSession();
	if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

	const { moveId, rating, xp } = await request.json();

	// Upsert review card
	const now = new Date().toISOString();
	await supabase.from('reviews').upsert(
		{ player_id: user.id, move_id: moveId, last_review: now },
		{ onConflict: 'player_id,move_id' }
	);

	// Update XP via RPC
	if (xp !== 0) {
		await supabase.rpc('update_xp_and_level', { p_player_id: user.id, p_xp_delta: xp });
	}

	// Non-blocking badge check
	grantNewBadges(supabase, user.id).catch(() => {});

	return json({ ok: true });
};
