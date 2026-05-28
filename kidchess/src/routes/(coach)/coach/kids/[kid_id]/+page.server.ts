import type { PageServerLoad } from './$types';
import { levelFromXp } from '$lib/srs/xp';

export const load: PageServerLoad = async ({ params, locals: { supabase } }) => {
	const { data: kid } = await supabase.from('profiles').select('id, display_name').eq('id', params.kid_id).single();
	const { data: stats } = await supabase.from('kid_stats').select('*').eq('kid_id', params.kid_id).single();
	const { data: repertoires } = await supabase.from('repertoires').select('id, name, color').eq('kid_id', params.kid_id);

	const totalXp = stats?.total_xp ?? 0;
	const levelInfo = levelFromXp(totalXp);
	return { kid, stats: { ...stats, ...levelInfo }, repertoires: repertoires ?? [] };
};
