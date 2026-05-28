import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url, locals: { supabase, safeGetSession } }) => {
	const { user, session, profile } = await safeGetSession();
	if (!user) throw redirect(303, '/login');

	const repId = url.searchParams.get('rep');

	let movesQuery = supabase
		.from('moves')
		.select(`
			id, san, ply,
			from_position:from_position_id(fen),
			to_position:to_position_id(fen),
			repertoire:repertoire_id(id, name, color)
		`)
		.order('ply', { ascending: true });

	if (repId) {
		movesQuery = movesQuery.eq('repertoire_id', repId);
	} else {
		// All repertoires for this kid
		const { data: reps } = await supabase.from('repertoires').select('id').eq('kid_id', user.id);
		const repIds = reps?.map((r) => r.id) ?? [];
		if (repIds.length === 0) return { session, profile, moves: [] };
		movesQuery = movesQuery.in('repertoire_id', repIds);
	}

	const { data: moves } = await movesQuery;
	return { session, profile, moves: moves ?? [] };
};
