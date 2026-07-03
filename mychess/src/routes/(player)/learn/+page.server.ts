import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { buildQueue } from '$lib/srs/queue';
import { newCard } from '$lib/srs/fsrs';
import type { Card } from '$lib/srs/fsrs';

export const load: PageServerLoad = async ({ locals: { supabase, safeGetSession } }) => {
	const { user, session, profile } = await safeGetSession();
	if (!user) throw redirect(303, '/login');

	// Get all repertoire IDs for this player
	const { data: reps } = await supabase
		.from('repertoires')
		.select('id')
		.eq('player_id', user.id);
	const repIds = reps?.map((r) => r.id) ?? [];

	if (repIds.length === 0) {
		return { session, profile, queuedMoves: [], totalDue: 0 };
	}

	// Fetch all moves
	const { data: moves } = await supabase
		.from('moves')
		.select(`
			id, san, move_number,
			from_position(fen),
			to_position(fen),
			repertoire:repertoire_id(id, name, color)
		`)
		.in('repertoire_id', repIds);

	// Fetch review cards
	const { data: reviews } = await supabase
		.from('reviews')
		.select('move_id, due_at, stability, difficulty, elapsed_days, scheduled_days, reps, lapses, state, last_review')
		.eq('player_id', user.id);

	const reviewMap = new Map(reviews?.map((r) => [r.move_id, r]) ?? []);

	// Build FSRS cards from DB state
	const cards = (moves ?? []).map((m) => {
		const r = reviewMap.get(m.id);
		let card: Card;
		if (r) {
			const base = newCard();
			card = {
				...base,
				due: new Date(r.due_at),
				stability: r.stability ?? 0,
				difficulty: r.difficulty ?? 0,
				elapsed_days: r.elapsed_days ?? 0,
				scheduled_days: r.scheduled_days ?? 0,
				reps: r.reps ?? 0,
				lapses: r.lapses ?? 0,
				state: r.state ?? 0,
				last_review: r.last_review ? new Date(r.last_review) : undefined
			};
		} else {
			card = newCard();
		}
		return { moveId: m.id, card };
	});

	// Daily new card count from player_stats
	const { data: stats } = await supabase
		.from('player_stats')
		.select('new_cards_today')
		.eq('player_id', user.id)
		.single();

	const queue = buildQueue(cards, stats?.new_cards_today ?? 0);
	const moveMap = new Map((moves ?? []).map((m) => [m.id, m]));
	const queuedMoves = queue.map((q) => ({ ...q, move: moveMap.get(q.moveId) })).filter((q) => q.move);

	return { session, profile, queuedMoves, totalDue: queue.length };
};
