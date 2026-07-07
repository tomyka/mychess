// mychess/src/routes/(player)/master/[repertoire_id]/+page.server.ts
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { requireAccount } from '$lib/server/auth';
import { mergeRepertoireIds } from '$lib/repertoire';
import { enumerateVariations, type RawMoveRow } from '$lib/mastery/variations';
import { activeLevel, isSatisfied } from '$lib/mastery/levels';
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

	const [{ data: repertoire }, { data: rawMoves }, { data: progressRows }] = await Promise.all([
		supabase.from('repertoires').select('id, name, color').eq('id', repertoireId).single(),
		supabase
			.from('moves')
			.select(
				'id, san, is_player_turn, from_position, to_position, from_pos:from_position(fen), to_pos:to_position(fen)'
			)
			.eq('repertoire_id', repertoireId),
		supabase
			.from('variation_progress')
			.select('variation_key, deepest_depth_reached')
			.eq('player_id', user!.id)
			.eq('repertoire_id', repertoireId)
	]);

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
	const progressMap = new Map<string, number>(
		(progressRows ?? []).map((p: any) => [p.variation_key, p.deepest_depth_reached])
	);
	const withProgress = variations.map((v) => ({
		...v,
		deepestReached: progressMap.get(v.variationKey) ?? 0
	}));

	const level = activeLevel(withProgress);

	let attempt: {
		leafMoveId: string;
		variationKey: string;
		targetDepth: number;
		prefix: ReturnType<typeof splitAttempt>['prefix'];
		quizSteps: ReturnType<typeof splitAttempt>['quizSteps'];
	} | null = null;
	let satisfiedCount = 0;

	if (level !== 'mastered') {
		satisfiedCount = withProgress.filter((v) => isSatisfied(v, level, v.deepestReached)).length;
		const picked = pickPracticeAttempt(withProgress, level);
		if (picked) {
			const { prefix, quizSteps } = splitAttempt(picked.variation.path, picked.startPoint, picked.targetDepth);
			attempt = {
				leafMoveId: picked.variation.leafMoveId,
				variationKey: picked.variation.variationKey,
				targetDepth: picked.targetDepth,
				prefix,
				quizSteps
			};
		}
	}

	return {
		repertoire,
		level,
		totalVariations: withProgress.length,
		satisfiedCount,
		attempt
	};
};
