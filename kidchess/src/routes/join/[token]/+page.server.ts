import { redirect } from '@sveltejs/kit';
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

	// Attach to coach and redeem
	await supabase.from('profiles').update({ coach_id: invite.coach_id }).eq('id', user.id);
	await supabase.from('invites').update({ redeemed_at: new Date().toISOString() }).eq('token', params.token);
	throw redirect(303, '/');
};
