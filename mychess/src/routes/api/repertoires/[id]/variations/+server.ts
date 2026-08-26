// mychess/src/routes/api/repertoires/[id]/variations/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireApiUser } from '$lib/server/auth';
import { fetchAllChapterExclusions, loadRepertoireVariations } from '$lib/server/practice-repertoire';
import { loadSolvedKeys } from '$lib/server/practice-progress';
import { moveSequenceLabel, UNTAGGED_CHAPTER } from '$lib/mastery/variations';

// A null byte can't appear in a Postgres `text` value or a variation key (a
// `>`-joined chain of UUIDs), so joining a (chapter, variationKey) pair on it
// can't collide two distinct pairs onto the same lookup key.
const PAIR_SEP = '\u0000';

/**
 * Every variation in a repertoire, labeled by its move sequence, with this
 * player's own per-chapter included/excluded state (one entry per chapter the
 * line belongs to, or a single UNTAGGED_CHAPTER entry for a genuinely
 * untagged line — GitHub issue #86), every originating PGN chapter (empty
 * for an untagged line — a line cross-referenced by several chapters is one
 * entry listing all of them, never one entry per chapter), full move path (for the picker's fixed-window move-group buckets, which
 * key on each variation's first FIRST_MOVES_GROUP_PLIES plies — not just the
 * first move), and solved state. Fetched lazily (only when a repertoire row
 * is expanded or the picker is opened), not eagerly for every repertoire, to
 * avoid re-introducing the full-move-fetch cost the shape cache exists to
 * avoid.
 */
export const GET: RequestHandler = async ({ params, locals }) => {
	const user = await requireApiUser(locals);
	const [{ variations }, solvedKeys, chapterExclusions] = await Promise.all([
		loadRepertoireVariations(locals.supabase, user.id, params.id),
		loadSolvedKeys(locals.supabase, user.id, params.id),
		fetchAllChapterExclusions(locals.supabase, user.id, params.id)
	]);

	const excludedPairs = new Set(chapterExclusions.map((r) => `${r.chapter_name}${PAIR_SEP}${r.variation_key}`));

	return json(
		variations.map((v) => {
			const chapters = v.chapterNames.length > 0 ? v.chapterNames : [UNTAGGED_CHAPTER];
			const includedByChapter: Record<string, boolean> = {};
			for (const chapter of chapters) {
				includedByChapter[chapter] = !excludedPairs.has(`${chapter}${PAIR_SEP}${v.variationKey}`);
			}
			return {
				variationKey: v.variationKey,
				label: moveSequenceLabel(v.path),
				includedByChapter,
				chapterNames: v.chapterNames,
				path: v.path,
				solved: solvedKeys.has(v.variationKey)
			};
		})
	);
};
