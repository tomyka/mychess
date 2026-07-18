// mychess/src/routes/(player)/master/[repertoire_id]/+page.server.ts
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { requireAccount } from '$lib/server/auth';
import { mergeRepertoireIds } from '$lib/repertoire';
import { enumerateVariations, type RawMoveRow } from '$lib/mastery/variations';
import { correctMoveIdSet, repertoireProgress } from '$lib/mastery/moveProgress';
import { pickPracticeAttempt, splitAttempt } from '$lib/mastery/practice';

export const load: PageServerLoad = async ({ params, locals }) => {
	const { user } = await requireAccount(locals);
	const supabase = locals.supabase;
	const repertoireId = params.repertoire_id;

	const [{ data: ownReps }, { data: assigned }] = await Promise.all([
		supabase.from('repertoires').select('id').eq('player_id', user!.id),
		supabase.from('assigned_repertoires').select('repertoire_id').eq('player_id', user!.id)
	]);
	const allowedIds = mergeRepertoireIds(
		ownReps?.map((r) => r.id) ?? [],
		assigned?.map((a) => a.repertoire_id) ?? []
	);
	if (!allowedIds.includes(repertoireId)) {
		throw error(404, 'Repertoire not found');
	}

	const [{ data: repertoire }, { data: rawMoves }] = await Promise.all([
		supabase.from('repertoires').select('id, name, color').eq('id', repertoireId).single(),
		supabase
			.from('moves')
			.select(
				'id, san, is_player_turn, from_position, to_position, from_pos:from_position(fen), to_pos:to_position(fen)'
			)
			.eq('repertoire_id', repertoireId)
	]);

	if (!repertoire) {
		throw error(404, 'Repertoire not found');
	}

	const moves: RawMoveRow[] = (rawMoves ?? []).map((m: any) => ({
		id: m.id,
		san: m.san,
		isPlayerTurn: m.is_player_turn,
		fromPositionId: m.from_position,
		toPositionId: m.to_position,
		fromFen: m.from_pos?.fen ?? '',
		toFen: m.to_pos?.fen ?? ''
	}));

	const variations = enumerateVariations(moves);

	const moveIds = moves.map((m) => m.id);
	const { data: progressRows } = moveIds.length
		? await supabase
				.from('move_progress')
				.select('move_id, state')
				.eq('player_id', user!.id)
				.in('move_id', moveIds)
		: { data: [] as { move_id: string; state: string }[] };

	const { level, satisfiedCount, totalVariations } = repertoireProgress(variations, progressRows ?? []);
	const correctMoveIds = correctMoveIdSet(progressRows ?? []);

	let attempt: {
		prefix: ReturnType<typeof splitAttempt>['prefix'];
		quizSteps: ReturnType<typeof splitAttempt>['quizSteps'];
	} | null = null;

	if (level !== 'mastered') {
		const picked = pickPracticeAttempt(variations, level, correctMoveIds);
		if (picked) {
			const { prefix, quizSteps } = splitAttempt(picked.variation.path, level, picked.targetDepth);
			attempt = { prefix, quizSteps };
		}
	}

	return { repertoire, level, totalVariations, satisfiedCount, attempt };
};
