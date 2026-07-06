import type { PageServerLoad } from './$types';
import { ensureGuestSession } from '$lib/server/auth';

export const load: PageServerLoad = async ({ url, locals }) => {
	const guest = await ensureGuestSession(locals);
	if (!guest) return { needsAccount: true };
	const { user, session, profile } = guest;
	if (!user) return { needsAccount: true };
	const supabase = locals.supabase;

	const repId = url.searchParams.get('rep');

	// Only the player's own moves are quizzed — the opponent's replies
	// (is_player_turn = false) are just context, not something to guess.
	let movesQuery = supabase
		.from('moves')
		.select(`
			id, san, move_number,
			from_position(fen),
			to_position(fen),
			repertoire:repertoire_id(id, name, color)
		`)
		.eq('is_player_turn', true)
		.order('ply', { ascending: true });

	if (repId) {
		movesQuery = movesQuery.eq('repertoire_id', repId);
	} else {
		// All repertoires for this player
		const { data: reps } = await supabase.from('repertoires').select('id').eq('player_id', user.id);
		const repIds = reps?.map((r) => r.id) ?? [];
		if (repIds.length === 0) return { session, profile, moves: [] };
		movesQuery = movesQuery.in('repertoire_id', repIds);
	}

	const { data: moves } = await movesQuery;
	return { session, profile, moves: moves ?? [] };
};
