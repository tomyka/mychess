// mychess/src/lib/server/coach-progress.ts
//
// Per-student, per-repertoire learning progress for the coach view
// (story #102 of epic #95).
//
// Four queries total, whatever the number of assigned repertoires — the page
// this feeds already ran several queries PER repertoire, and a coach with a
// student on ten repertoires shouldn't pay ten round trips for one column.

import type { SupabaseClient } from '@supabase/supabase-js';
import { isMasteryCurrent } from '$lib/mastery/repertoireStatus';

export type StudentRepertoireProgress = {
	repertoireId: string;
	learned: number;
	/** Chapters whose mastery is still current (see `isMasteryCurrent`). */
	chaptersMastered: number;
	/** Chapters whose mastery went stale because the repertoire's moves changed. */
	chaptersStale: number;
	/** Demotions in the requested window — material that isn't sticking. */
	demotions: number;
};

/**
 * `since` bounds the demotion count only. Learned counts and mastery are
 * current-state facts, not windowed events, so a range filter would make them
 * mean something different from what the label says.
 */
export async function loadStudentRepertoireProgress(
	supabase: SupabaseClient,
	playerId: string,
	repertoireIds: string[],
	since: string | null
): Promise<Map<string, StudentRepertoireProgress>> {
	const result = new Map<string, StudentRepertoireProgress>();
	if (repertoireIds.length === 0) return result;

	for (const id of repertoireIds) {
		result.set(id, { repertoireId: id, learned: 0, chaptersMastered: 0, chaptersStale: 0, demotions: 0 });
	}

	let demotionQuery = supabase
		.from('variation_demotions')
		.select('repertoire_id')
		.eq('player_id', playerId)
		.in('repertoire_id', repertoireIds);
	if (since) demotionQuery = demotionQuery.gte('demoted_at', since);

	const [learnedRes, masteryRes, repsRes, demotionsRes] = await Promise.all([
		supabase
			.from('variation_solved')
			.select('repertoire_id')
			.eq('player_id', playerId)
			.in('repertoire_id', repertoireIds),
		supabase
			.from('chapter_mastery')
			.select('repertoire_id, chapter_name, moves_updated_at')
			.eq('player_id', playerId)
			.in('repertoire_id', repertoireIds),
		supabase.from('repertoires').select('id, moves_updated_at').in('id', repertoireIds),
		demotionQuery
	]);

	// A failed read here would understate a student's progress to their coach,
	// which is worse than showing nothing — so log loudly rather than silently
	// reporting zeros as fact.
	for (const [label, res] of [
		['variation_solved', learnedRes],
		['chapter_mastery', masteryRes],
		['repertoires', repsRes],
		['variation_demotions', demotionsRes]
	] as const) {
		if (res.error) console.error(`loadStudentRepertoireProgress: ${label} read failed:`, res.error.message);
	}

	for (const row of learnedRes.data ?? []) {
		const entry = result.get(row.repertoire_id);
		if (entry) entry.learned++;
	}

	const movesUpdatedAt = new Map((repsRes.data ?? []).map((r) => [r.id, r.moves_updated_at as string | null]));
	for (const row of masteryRes.data ?? []) {
		const entry = result.get(row.repertoire_id);
		if (!entry) continue;
		if (isMasteryCurrent(row.moves_updated_at, movesUpdatedAt.get(row.repertoire_id) ?? null)) entry.chaptersMastered++;
		else entry.chaptersStale++;
	}

	for (const row of demotionsRes.data ?? []) {
		const entry = result.get(row.repertoire_id);
		if (entry) entry.demotions++;
	}

	return result;
}
