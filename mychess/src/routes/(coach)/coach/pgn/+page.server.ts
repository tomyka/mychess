import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { parsePgn } from '$lib/pgn/parser';

export const load: PageServerLoad = async ({ locals: { supabase, safeGetSession } }) => {
	const { user } = await safeGetSession();
	const { data: players } = await supabase
		.from('profiles')
		.select('id, display_name')
		.eq('coach_id', user!.id)
		.eq('role', 'player');
	return { players: players ?? [] };
};

export const actions: Actions = {
	upload: async ({ request, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) return fail(401);

		const data = await request.formData();
		const name = data.get('name') as string;
		const playerId = data.get('player_id') as string;
		const pgnText = data.get('pgn_text') as string;

		if (!name || !pgnText) return fail(400, { error: 'Name and PGN required' });

		const games = parsePgn(pgnText);
		if (games.length === 0) return fail(400, { error: 'No valid games in PGN' });

		const targetPlayer = playerId || user.id;
		const { data: rep, error: repErr } = await supabase
			.from('repertoires')
			.insert({ player_id: targetPlayer, coach_id: user.id, name, pgn_source: pgnText })
			.select()
			.single();

		if (repErr) return fail(500, { error: repErr.message });

		for (const game of games) {
			for (const move of game.moves) {
				await supabase.from('positions').upsert({ fen: move.parentFen }, { onConflict: 'fen', ignoreDuplicates: true });
				await supabase.from('positions').upsert({ fen: move.fen }, { onConflict: 'fen', ignoreDuplicates: true });

				const [{ data: fromPos }, { data: toPos }] = await Promise.all([
					supabase.from('positions').select('id').eq('fen', move.parentFen).single(),
					supabase.from('positions').select('id').eq('fen', move.fen).single()
				]);

				if (fromPos && toPos) {
					await supabase.from('moves').insert({
						repertoire_id: rep.id,
						from_position_id: fromPos.id,
						to_position_id: toPos.id,
						san: move.san,
						ply: move.ply
					});
				}
			}
		}

		return { success: true, gameCount: games.length, repId: rep.id };
	}
};
