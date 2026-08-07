import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { requireAccount } from '$lib/server/auth';
import { mergeRepertoireIds } from '$lib/repertoire';
import { enumerateVariations, type RawMoveRow } from '$lib/mastery/variations';
import { correctMoveIdSet, repertoireProgress } from '$lib/mastery/moveProgress';
import { pickPracticeAttempt, pickReviewAttempt, splitAttempt } from '$lib/mastery/practice';

export const load: PageServerLoad = async ({ params, url, locals }) => {
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

	// Filtered via the moves relation (not `.in('move_id', moveIds)`) — a
	// repertoire's move ids embedded directly in the request URL can exceed
	// length limits once a repertoire has a few hundred moves, silently
	// failing the query and making solved progress look like it never saved.
	const { data: progressRows } = await supabase
		.from('move_progress')
		.select('move_id, state, moves!inner(repertoire_id)')
		.eq('player_id', user!.id)
		.eq('moves.repertoire_id', repertoireId);

	const { level, satisfiedCount, totalVariations, totalLevels, levelTaskCount, levelSolvedCount } =
		repertoireProgress(variations, progressRows ?? []);
	const correctMoveIds = correctMoveIdSet(progressRows ?? []);

	// A `?level=N` request only takes effect for a level strictly below the
	// active one (or any level up to totalLevels once mastered) — anything
	// else (the active level, a locked level, garbage input) is ignored and
	// the page falls back to normal training below. This means URL tampering
	// to peek at a locked level just does nothing, rather than erroring.
	const requestedLevel = Number(url.searchParams.get('level'));
	const isValidReview =
		Number.isInteger(requestedLevel) &&
		requestedLevel >= 1 &&
		(level === 'mastered' ? requestedLevel <= totalLevels : requestedLevel < level);
	const reviewLevel = isValidReview ? requestedLevel : null;

	let attempt: {
		prefix: ReturnType<typeof splitAttempt>['prefix'];
		quizSteps: ReturnType<typeof splitAttempt>['quizSteps'];
	} | null = null;

	if (reviewLevel !== null) {
		const picked = pickReviewAttempt(variations, reviewLevel);
		if (picked) {
			const { prefix, quizSteps } = splitAttempt(picked.variation.path, reviewLevel, picked.targetDepth);
			attempt = { prefix, quizSteps };
		}
	} else if (level !== 'mastered') {
		const picked = pickPracticeAttempt(variations, level, correctMoveIds);
		if (picked) {
			const { prefix, quizSteps } = splitAttempt(picked.variation.path, level, picked.targetDepth);
			attempt = { prefix, quizSteps };
		}
	}

	return {
		repertoire,
		level,
		totalVariations,
		totalLevels,
		satisfiedCount,
		levelTaskCount,
		levelSolvedCount,
		attempt,
		reviewLevel
	};
};
