import type { SupabaseClient } from '@supabase/supabase-js';
import { extractSingleGame } from '$lib/games/parse';

export async function createGame(
	supabase: SupabaseClient,
	playerId: string,
	pgn: string,
	playedAs: 'white' | 'black' | null
): Promise<{ id: string } | { error: string }> {
	const parsed = extractSingleGame(pgn);
	if ('error' in parsed) return { error: parsed.error };

	const { data, error } = await supabase
		.from('games')
		.insert({
			player_id: playerId,
			pgn,
			headers: parsed.game.headers,
			played_as: playedAs,
			moves: parsed.game.moves,
			analysis_status: 'pending'
		})
		.select('id')
		.single();
	if (error) return { error: error.message };
	return { id: data.id };
}
