import type { PageServerLoad } from './$types';
import { levelFromXp } from '$lib/srs/xp';

export const load: PageServerLoad = async ({ locals: { supabase, safeGetSession } }) => {
	const { user, session, profile } = await safeGetSession();
	if (!user) return { session: null, profile: null };

	// XP and streak: source of truth is profiles
	const totalXp = Number((profile as any)?.xp ?? 0);
	const streakDays = Number((profile as any)?.streak_days ?? 0);
	const { level, xpInLevel, xpToNextLevel } = levelFromXp(totalXp);

	const { data: statsRow } = await supabase
		.from('kid_stats')
		.select('total_reviews, total_correct, moves_learned')
		.eq('kid_id', user.id)
		.single();

	return {
		session,
		profile,
		stats: {
			level,
			total_xp: totalXp,
			xp_in_level: xpInLevel,
			xp_to_next: xpToNextLevel,
			streak_days: streakDays,
			total_reviews: statsRow?.total_reviews ?? 0
		}
	};
};
