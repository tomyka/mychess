import type { SupabaseClient } from '@supabase/supabase-js';
import { GUEST_DISPLAY_NAME } from '$lib/profile';

/** Ensures a guest (anonymous) user has the profile rows the app expects. Idempotent. */
export async function ensureGuestProfile(supabase: SupabaseClient, userId: string): Promise<void> {
	const { data: profile } = await supabase.from('profiles').select('id').eq('id', userId).single();
	if (profile) return;
	await supabase.from('profiles').insert({
		id: userId,
		role: 'player',
		display_name: GUEST_DISPLAY_NAME,
		avatar_id: 'knight'
	});
	await supabase.from('player_stats').upsert({ player_id: userId });
	await supabase.from('equipped_cosmetics').upsert({ player_id: userId });
}
