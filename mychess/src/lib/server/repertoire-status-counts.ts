// mychess/src/lib/server/repertoire-status-counts.ts
//
// How many of a player's repertoires are Learned, and how many Mastered
// (story #101 of epic #95, feeding the account-level badges).

import type { SupabaseClient } from '@supabase/supabase-js';
import { loadRepertoireProgressSummaries } from './repertoire-progress';
import { loadFilteredRepertoireVariations } from './practice-repertoire';
import { loadSolvedKeys } from './practice-progress';
import { loadChapterMastery } from './mastery';
import { deriveRepertoireStatus, isMasteryCurrent } from '$lib/mastery/repertoireStatus';

/**
 * Counts Learned and Mastered repertoires for one player.
 *
 * The Learned count comes from the cached summaries the repertoire list already
 * uses, so it costs nothing extra. Mastered needs each repertoire's chapter
 * list, which means enumerating its variations — but only a repertoire that is
 * ALREADY fully learned can possibly be mastered, so the expensive check runs
 * over that subset alone. For every player who hasn't finished a repertoire yet
 * (the normal case) it does no extra work at all.
 */
export async function countRepertoireStatuses(
	supabase: SupabaseClient,
	playerId: string
): Promise<{ learned: number; mastered: number }> {
	const summaries = await loadRepertoireProgressSummaries(supabase, playerId);
	const fullyLearned = summaries.filter((s) => s.total > 0 && s.solved >= s.total);
	if (fullyLearned.length === 0) return { learned: 0, mastered: 0 };

	const statuses = await Promise.all(
		fullyLearned.map(async (summary) => {
			try {
				const [{ repertoire, variations }, learnedKeys, masteryRecords] = await Promise.all([
					loadFilteredRepertoireVariations(supabase, playerId, summary.id),
					loadSolvedKeys(supabase, playerId, summary.id),
					loadChapterMastery(supabase, playerId, summary.id)
				]);
				const currentlyMasteredChapters = new Set(
					masteryRecords
						.filter((r) => isMasteryCurrent(r.movesUpdatedAt, repertoire.movesUpdatedAt))
						.map((r) => r.chapterName)
				);
				return deriveRepertoireStatus({ variations, learnedKeys, currentlyMasteredChapters });
			} catch (err) {
				// A badge count is not worth failing the request that triggered it.
				// Logged rather than swallowed so a persistent failure is visible.
				console.error(`countRepertoireStatuses: status check failed for repertoire ${summary.id}:`, err);
				return 'learning' as const;
			}
		})
	);

	return {
		learned: statuses.filter((s) => s === 'learned' || s === 'mastered').length,
		mastered: statuses.filter((s) => s === 'mastered').length
	};
}
