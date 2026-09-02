// mychess/src/lib/server/coach-progress.ts
//
// Per-student, per-repertoire learning progress for the coach view
// (story #102 of epic #95). Knowledge-level lookup replaces the old
// chapter_mastery-based mastered/stale counters.

import type { SupabaseClient } from '@supabase/supabase-js';
import { loadRepertoireVariations } from './practice-repertoire';
import { loadSolvedKeys, loadTeachingProgress } from './practice-progress';
import { masterableChapters } from '$lib/mastery/repertoireStatus';
import { rowsInChapterTier } from '$lib/mastery/variations';
import { deriveChapterLevel, deriveRepertoireLevel, type Tier } from '$lib/mastery/chapterLevels';
import { computeMasteredPliesMap } from '$lib/mastery/teaching';

export type StudentRepertoireProgress = {
	repertoireId: string;
	learned: number;
	/** This repertoire's current knowledge level (minimum across its chapters), or null if not yet Bronze. */
	level: Tier | null;
	/** Demotions in the requested window — material that isn't sticking. */
	demotions: number;
};

/**
 * `since` bounds the demotion count only. Learned counts and knowledge level
 * are current-state facts, not windowed events, so a range filter would make
 * them mean something different from what the label says.
 *
 * Unlike the rest of this module's history, computing `level` needs a full
 * move fetch per assigned repertoire (to get each variation's
 * `playerMoveCount` and chapter grouping) — accepted deliberately here since
 * this page is scoped to one student's own assigned repertoires, a small,
 * bounded set, not the whole coach roster.
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
		result.set(id, { repertoireId: id, learned: 0, level: null, demotions: 0 });
	}

	let demotionQuery = supabase
		.from('variation_demotions')
		.select('repertoire_id')
		.eq('player_id', playerId)
		.in('repertoire_id', repertoireIds);
	if (since) demotionQuery = demotionQuery.gte('demoted_at', since);

	const [learnedRes, demotionsRes] = await Promise.all([
		supabase.from('variation_solved').select('repertoire_id').eq('player_id', playerId).in('repertoire_id', repertoireIds),
		demotionQuery
	]);

	for (const [label, res] of [
		['variation_solved', learnedRes],
		['variation_demotions', demotionsRes]
	] as const) {
		if (res.error) console.error(`loadStudentRepertoireProgress: ${label} read failed:`, res.error.message);
	}

	for (const row of learnedRes.data ?? []) {
		const entry = result.get(row.repertoire_id);
		if (entry) entry.learned++;
	}

	for (const row of demotionsRes.data ?? []) {
		const entry = result.get(row.repertoire_id);
		if (entry) entry.demotions++;
	}

	await Promise.all(
		repertoireIds.map(async (repertoireId) => {
			try {
				// UNFILTERED on purpose (named `allVariations`, matching the same
				// naming convention used everywhere else this fix touches): chapter/
				// tier computation needs an excluded, never-solved variation to
				// still be present in its bracket (so it blocks the ladder past its
				// own tier), not silently absent — see `deriveChapterLevel`'s doc
				// comment. This file has no other use for the variation set, so it
				// switches entirely rather than also deriving a filtered copy.
				const [{ variations: allVariations }, learnedKeys, teachingProgress] = await Promise.all([
					loadRepertoireVariations(supabase, playerId, repertoireId),
					loadSolvedKeys(supabase, playerId, repertoireId),
					loadTeachingProgress(supabase, playerId, repertoireId)
				]);
				const masteredPlies = computeMasteredPliesMap(allVariations, teachingProgress, learnedKeys);
				const chapterLevels = masterableChapters(allVariations).map((chapter) =>
					deriveChapterLevel(rowsInChapterTier(allVariations, chapter), masteredPlies)
				);
				const entry = result.get(repertoireId);
				if (entry) entry.level = deriveRepertoireLevel(chapterLevels);
			} catch (err) {
				console.error(`loadStudentRepertoireProgress: level lookup failed for repertoire ${repertoireId}:`, err);
			}
		})
	);

	return result;
}
