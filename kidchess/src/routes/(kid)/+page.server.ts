import type { PageServerLoad } from './$types';
import { levelFromXp } from '$lib/srs/xp';

export const load: PageServerLoad = async ({ locals: { supabase, safeGetSession } }) => {
	const { user, session, profile } = await safeGetSession();
	if (!user) return { session: null, profile: null };

	const { data: statsRow } = await supabase
		.from('kid_stats')
		.select('*')
		.eq('kid_id', user.id)
		.single();

	const totalXp = statsRow?.total_xp ?? 0;
	const { level, xpInLevel, xpToNextLevel } = levelFromXp(totalXp);

	return {
		session,
		profile,
		stats: {
			level,
			total_xp: totalXp,
			xp_in_level: xpInLevel,
			xp_to_next: xpToNextLevel,
			streak_days: statsRow?.streak_days ?? 0
		}
	};
};
