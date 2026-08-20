// mychess/src/routes/api/practice/mastery-run/+server.ts
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireApiUser } from '$lib/server/auth';
import { loadFilteredRepertoireVariations } from '$lib/server/practice-repertoire';
import { loadSolvedKeys } from '$lib/server/practice-progress';
import { recordChapterMastery } from '$lib/server/mastery';
import { recordSession } from '$lib/server/sessions';
import { grantNewBadges } from '$lib/badges/grant';
import { chapterMasteryView } from '$lib/mastery/masteryRun';

/**
 * Records a completed chapter mastery run (story #100).
 *
 * The server cannot verify the moves were actually played — the client reports
 * completion, exactly as it already reports `hadMistake` for a Learn attempt.
 * That trust boundary is pre-existing and unchanged. What the server does verify
 * is the precondition it owns: the chapter must exist, and every variation in it
 * must be learned. A client claiming mastery of a chapter it hasn't finished
 * learning is rejected.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const { supabase } = locals;
	const user = await requireApiUser(locals);

	const body = await request.json();
	const { repertoireId, chapterName } = body ?? {};
	if (typeof repertoireId !== 'string' || typeof chapterName !== 'string') {
		throw error(400, 'Invalid request');
	}

	const [{ repertoire, variations }, learnedKeys] = await Promise.all([
		loadFilteredRepertoireVariations(supabase, user.id, repertoireId),
		loadSolvedKeys(supabase, user.id, repertoireId)
	]);

	const chapter = chapterMasteryView({
		variations,
		learnedKeys,
		masteryRecords: [],
		repertoireMovesUpdatedAt: repertoire.movesUpdatedAt
	}).find((c) => c.chapter === chapterName);

	if (!chapter) throw error(404, 'Chapter not found');
	if (!chapter.canRun) throw error(409, 'Chapter still has un-learned variations');

	await recordChapterMastery(supabase, user.id, repertoireId, chapterName, repertoire.movesUpdatedAt);
	// A completed run is exactly one mastery session, so this needs no
	// sessionStart flag from the client.
	await recordSession(supabase, user.id, repertoireId, 'mastery', chapter.total);
	// A completed run can newly master a repertoire, so recalculate — and this is
	// also the path that REVOKES a stale mastery badge.
	grantNewBadges(supabase, user.id).catch(() => {});

	return json({ mastered: true });
};
