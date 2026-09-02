// mychess/src/routes/api/repertoires/[id]/variations/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireApiUser } from '$lib/server/auth';
import { fetchAllChapterExclusions, loadRepertoireVariations } from '$lib/server/practice-repertoire';
import { loadSolvedKeys, loadTeachingProgress } from '$lib/server/practice-progress';
import { moveSequenceLabel, UNTAGGED_CHAPTER } from '$lib/mastery/variations';
import { teachingCeilingMoveCount } from '$lib/mastery/chapterLevels';
import {
	isLockedForTier,
	isPausedAtCeiling,
	isCeilingReachedAnywhere,
	knownProgressFor,
	computeMasteredMoveIds,
	computeMasteredPliesMap
} from '$lib/mastery/teaching';

// A null byte can't appear in a Postgres `text` value or a variation key (a
// `>`-joined chain of UUIDs), so joining a (chapter, variationKey) pair on it
// can't collide two distinct pairs onto the same lookup key.
const PAIR_SEP = String.fromCharCode(0);

/**
 * Every variation in a repertoire, labeled by its move sequence, with this
 * player's own per-chapter included/excluded state (one entry per chapter the
 * line belongs to, or a single UNTAGGED_CHAPTER entry for a genuinely
 * untagged line — GitHub issue #86), every originating PGN chapter (empty
 * for an untagged line — a line cross-referenced by several chapters is one
 * entry listing all of them, never one entry per chapter), full move path (for the picker's fixed-window move-group buckets, which
 * key on each variation's first FIRST_MOVES_GROUP_PLIES plies — not just the
 * first move), solved state, this variation's own player-move count (for
 * the picker to bucket/label by tier the same way the teaching ceiling
 * does), locked state — whether this UNSOLVED variation is currently paused
 * at the repertoire's teaching-tier ceiling, or deferred because a sibling
 * sharing part of its credited prefix already reached that ceiling (GitHub
 * issue #172, `isLockedForTier`) — and a separate `pausedAtCeiling` flag — the
 * REFINEMENT of `locked` telling the picker WHICH of those two reasons
 * applies, so it can show a distinct icon for "reached, counts toward
 * leveling up" vs. "genuinely not reachable yet" (GitHub issue #181) — and
 * this repertoire's current ceiling itself (`ceilingMoveCount`, the same value repeated on every row
 * rather than a separate top-level field, so the response stays the flat
 * array `VariationSelection.ensureLoaded` also consumes, unchanged). The
 * picker renders a locked row disabled instead of letting the player click
 * into a dead end that `/api/practice/select-variation` would reject anyway
 * (GitHub issue #163), and groups/truncates rows whose own path currently
 * extends past the ceiling by their real shared prefix (GitHub issue #165).
 *
 * `locked` is computed from the SHARED-CREDIT-AWARE mastered-ply count
 * (`knownProgressFor`), not each variation's own raw progress row: a
 * variation whose entire visible opening is already mastered via a sibling
 * that shares those same moves must show as locked/paused immediately,
 * without requiring this specific variation to be individually taught first
 * — the same shared-credit floor `buildPracticeView` already applies at
 * serve time (`mastery/practice.ts`), just also applied here at picker-read
 * time (GitHub issue #165).
 *
 * Fetched lazily (only when a repertoire row is expanded or the picker is
 * opened), not eagerly for every repertoire, to avoid re-introducing the
 * full-move-fetch cost the shape cache exists to avoid.
 */
export const GET: RequestHandler = async ({ params, locals }) => {
	const user = await requireApiUser(locals);
	const [{ variations }, solvedKeys, chapterExclusions, teachingProgress] = await Promise.all([
		loadRepertoireVariations(locals.supabase, user.id, params.id),
		loadSolvedKeys(locals.supabase, user.id, params.id),
		fetchAllChapterExclusions(locals.supabase, user.id, params.id),
		loadTeachingProgress(locals.supabase, user.id, params.id)
	]);

	const excludedPairs = new Set(chapterExclusions.map((r) => `${r.chapter_name}${PAIR_SEP}${r.variation_key}`));
	// Computed once, not once per row — `knownProgressFor` below and
	// `isCeilingReachedAnywhere` would otherwise each independently re-derive
	// the same whole-repertoire set, an O(n) scan repeated per row. Also
	// reused for `computeMasteredPliesMap` below (GitHub issue #181), so the
	// teaching ceiling itself and every row's own masteredPlies agree on
	// exactly the same credit.
	const masteredMoveIds = computeMasteredMoveIds(variations, teachingProgress, solvedKeys);
	const repertoireMasteredPlies = computeMasteredPliesMap(variations, teachingProgress, solvedKeys, masteredMoveIds);
	const ceilingMoveCount = teachingCeilingMoveCount(variations, repertoireMasteredPlies);
	// GitHub issue #172: once the ceiling has genuinely been reached by any
	// one variation, a deferred sibling (would also merely pause there, not
	// solve, and already carries some shared credit toward it) shows as
	// locked too — matching `computeBlockedKeys`, what actually decides what
	// Learn would serve.
	const ceilingReached = isCeilingReachedAnywhere(variations, solvedKeys, teachingProgress, ceilingMoveCount, masteredMoveIds);

	return json(
		variations.map((v) => {
			const chapters = v.chapterNames.length > 0 ? v.chapterNames : [UNTAGGED_CHAPTER];
			const includedByChapter: Record<string, boolean> = {};
			for (const chapter of chapters) {
				includedByChapter[chapter] = !excludedPairs.has(`${chapter}${PAIR_SEP}${v.variationKey}`);
			}
			const solved = solvedKeys.has(v.variationKey);
			const masteredPlies = knownProgressFor({
				variation: v,
				variations,
				teachingProgress,
				solvedKeys,
				resumedAfterBreak: false,
				masteredMoveIds
			}).masteredPlies;
			return {
				variationKey: v.variationKey,
				label: moveSequenceLabel(v.path),
				includedByChapter,
				chapterNames: v.chapterNames,
				path: v.path,
				solved,
				playerMoveCount: v.playerMoveCount,
				locked: !solved && isLockedForTier(v.path, masteredPlies, ceilingMoveCount, ceilingReached),
				pausedAtCeiling: !solved && isPausedAtCeiling(v.path, masteredPlies, ceilingMoveCount),
				ceilingMoveCount
			};
		})
	);
};
