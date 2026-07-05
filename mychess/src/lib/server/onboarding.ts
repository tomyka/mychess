import type { SupabaseClient } from '@supabase/supabase-js';

export type NewProfileInfo = {
	id: string;
	firstName: string | null;
	lastName: string | null;
	displayName: string;
};

/**
 * Creates a brand-new player profile plus its dependent rows (player_stats,
 * equipped_cosmetics). Callers must only invoke this when no profile exists
 * yet for this id — it does not check for an existing row itself.
 */
export async function createPlayerProfile(
	supabase: SupabaseClient,
	info: NewProfileInfo
): Promise<{ error: string | null }> {
	const { error } = await supabase.from('profiles').insert({
		id: info.id,
		role: 'player',
		first_name: info.firstName,
		last_name: info.lastName,
		display_name: info.displayName,
		avatar_id: 'knight'
	} as any);
	if (error) return { error: error.message };

	await supabase.from('player_stats').upsert({ player_id: info.id });
	await supabase.from('equipped_cosmetics').upsert({ player_id: info.id });
	return { error: null };
}
