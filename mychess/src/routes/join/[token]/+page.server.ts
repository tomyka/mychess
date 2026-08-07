import { redirect } from '@sveltejs/kit';
import { createClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/private';
import { env as pubEnv } from '$env/dynamic/public';
import { requireEnv } from '$lib/env';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals: { supabase, safeGetSession } }) => {
	// Service-role client: `invites` has no client-readable SELECT policy at
	// all (see migration 0029 — the previous `using (true)` "read by token"
	// policy let anyone read every invite, not just the one matching a
	// client-supplied token, since RLS can't see that filter). The token
	// itself is the actual credential for this lookup — a 128-bit random
	// value, not guessable — so looking it up via the admin client here is
	// the intended access path, not a bypass of anything.
	const SUPABASE_SERVICE_ROLE_KEY = requireEnv(env.SUPABASE_SERVICE_ROLE_KEY, 'SUPABASE_SERVICE_ROLE_KEY');
	const PUBLIC_SUPABASE_URL = requireEnv(pubEnv.PUBLIC_SUPABASE_URL, 'PUBLIC_SUPABASE_URL');
	const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

	const { data: invite } = await admin.from('invites').select('*').eq('token', params.token).single();

	if (!invite || invite.redeemed_at || new Date(invite.expires_at) < new Date()) {
		return { valid: false, token: params.token };
	}

	const { user } = await safeGetSession();
	if (!user) return { valid: true, token: params.token, needsLogin: true };

	const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single();

	if (!profile) {
		return { valid: true, token: params.token, needsProfile: true, coachId: invite.coach_id };
	}

	// Identity is now verified too (real session + a valid, unexpired,
	// unredeemed token already checked above), and redemption must insert
	// the relationship as already-active — something a regular
	// participant-scoped insert is intentionally not allowed to do (see
	// migration 0019's coach_players_participant_insert policy) — so the
	// rest of this flow keeps using the same admin client from here on.
	const { data: existingRelationship } = await admin
		.from('coach_players')
		.select('id, status')
		.eq('coach_id', invite.coach_id)
		.eq('player_id', user.id)
		.maybeSingle();

	let relationshipError: string | null = null;
	const respondedAt = new Date().toISOString();

	if (!existingRelationship) {
		// No row yet: a plain insert as active. Safe — the guard trigger only
		// fires on UPDATE, and the service-role client bypasses the RLS insert
		// policy that would otherwise force status='pending' for a regular client.
		const { error } = await admin.from('coach_players').insert({
			coach_id: invite.coach_id,
			player_id: user.id,
			status: 'active',
			requested_by: invite.coach_id,
			responded_at: respondedAt
		});
		relationshipError = error?.message ?? null;
	} else if (existingRelationship.status === 'pending') {
		// A row already exists (e.g. the player separately sent a direct
		// request to this same coach). Activate it WITHOUT touching
		// coach_id/player_id/requested_by — the guard trigger forbids changing
		// those on any UPDATE, regardless of who originally requested it.
		const { error } = await admin
			.from('coach_players')
			.update({ status: 'active', responded_at: respondedAt })
			.eq('id', existingRelationship.id);
		relationshipError = error?.message ?? null;
	}
	// If it's already 'active', there's nothing to do — redemption is a no-op.

	if (relationshipError) {
		throw redirect(303, `/login?error=${encodeURIComponent('Could not connect you to this coach. Please try again.')}`);
	}

	// Must be the admin client, not the player's own `supabase` — the only
	// RLS policy left on `invites` after migration 0029 is `invites_coach_all`
	// (`coach_id = auth.uid()`), which the redeeming PLAYER never satisfies.
	// Using the regular client here silently no-ops (RLS blocks the write but
	// Supabase doesn't error on 0 rows affected), leaving `redeemed_at` unset
	// forever — meaning the same invite token could be redeemed repeatedly by
	// different accounts, since the "already redeemed" guard above would
	// never trip.
	await admin.from('invites').update({ redeemed_at: new Date().toISOString() }).eq('token', params.token);
	throw redirect(303, '/');
};
