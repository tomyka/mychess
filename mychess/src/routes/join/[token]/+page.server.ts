import { redirect } from '@sveltejs/kit';
import { createClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/private';
import { env as pubEnv } from '$env/dynamic/public';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals: { supabase, safeGetSession } }) => {
	const { data: invite } = await supabase.from('invites').select('*').eq('token', params.token).single();

	if (!invite || invite.redeemed_at || new Date(invite.expires_at) < new Date()) {
		return { valid: false, token: params.token };
	}

	const { user } = await safeGetSession();
	if (!user) return { valid: true, token: params.token, needsLogin: true };

	const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single();

	if (!profile) {
		return { valid: true, token: params.token, needsProfile: true, coachId: invite.coach_id };
	}

	// Service-role client: identity is already verified (real session + a
	// valid, unexpired, unredeemed token checked above), and redemption must
	// insert the relationship as already-active — something a regular
	// participant-scoped insert is intentionally not allowed to do (see
	// migration 0019's coach_players_participant_insert policy).
	const { SUPABASE_SERVICE_ROLE_KEY } = env;
	const { PUBLIC_SUPABASE_URL } = pubEnv;
	const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

	await admin.from('coach_players').upsert(
		{
			coach_id: invite.coach_id,
			player_id: user.id,
			status: 'active',
			requested_by: invite.coach_id,
			responded_at: new Date().toISOString()
		},
		{ onConflict: 'coach_id,player_id' }
	);
	await supabase.from('invites').update({ redeemed_at: new Date().toISOString() }).eq('token', params.token);
	throw redirect(303, '/');
};
