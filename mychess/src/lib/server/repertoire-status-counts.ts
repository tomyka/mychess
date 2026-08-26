// mychess/src/lib/server/repertoire-status-counts.ts
//
// How many of a player's repertoires are Learned, and how many Mastered
// (story #101 of epic #95, feeding the account-level badges).

import type { SupabaseClient } from '@supabase/supabase-js';
import { loadRepertoireProgressSummaries, type RepertoireProgressSummary } from './repertoire-progress';
import { loadFilteredRepertoireVariations } from './practice-repertoire';
import { loadSolvedKeys } from './practice-progress';
import { deriveRepertoireStatus, masterableChapters } from '$lib/mastery/repertoireStatus';
import { rowsInChapterTier } from '$lib/mastery/variations';
import { deriveChapterLevel } from '$lib/mastery/chapterLevels';

/**
 * Counts Learned and Mastered repertoires for one player.
 *
 * The Learned count comes from the cached summaries the repertoire list already
 * uses, so it costs nothing extra. Mastered needs each repertoire's chapter
 * list plus every variation's `playerMoveCount` (to derive each chapter's
 * knowledge level), which means enumerating its variations — but only a
 * repertoire that is ALREADY fully learned can possibly be mastered, so the
 * expensive check runs over that subset alone. For every player who hasn't
 * finished a repertoire yet (the normal case) it does no extra work at all.
 *
 * `summaries`, when passed, is used as-is instead of calling
 * `loadRepertoireProgressSummaries` again — the badge sync that runs inside
 * that function's own reconciliation path (see repertoire-progress.ts) already
 * has the summaries it just computed, and re-deriving them here would call
 * back into the very function this is nested inside.
 */
export async function countRepertoireStatuses(
	supabase: SupabaseClient,
	playerId: string,
	summaries?: RepertoireProgressSummary[]
): Promise<{ learned: number; mastered: number }> {
	const summ = summaries ?? (await loadRepertoireProgressSummaries(supabase, playerId));
	const fullyLearned = summ.filter((s) => s.total > 0 && s.solved >= s.total);
	if (fullyLearned.length === 0) return { learned: 0, mastered: 0 };

	const statuses = await Promise.all(
		fullyLearned.map(async (summary) => {
			try {
				const [{ variations }, learnedKeys] = await Promise.all([
					loadFilteredRepertoireVariations(supabase, playerId, summary.id),
					loadSolvedKeys(supabase, playerId, summary.id)
				]);
				const platinumChapters = new Set(
					masterableChapters(variations).filter(
						(chapter) => deriveChapterLevel(rowsInChapterTier(variations, chapter), learnedKeys) === 'platinum'
					)
				);
				return deriveRepertoireStatus({ variations, learnedKeys, platinumChapters });
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
