// mychess/src/routes/api/repertoires/[id]/learn-units/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireApiUser } from '$lib/server/auth';
import { loadRepertoireVariations } from '$lib/server/practice-repertoire';
import { loadSolvedKeys, loadTeachingProgress } from '$lib/server/practice-progress';
import { filterVariations, moveSequenceLabel } from '$lib/mastery/variations';
import { deriveLearnPlan } from '$lib/mastery/learnUnits';
import { computeMasteredMoveIds } from '$lib/mastery/teaching';

/**
 * What this player can learn right now, per chapter (GitHub issue #182).
 *
 * Deliberately separate from `/api/repertoires/[id]/variations`, which answers
 * a different question for a different caller — the exclusion checkbox tree on
 * `/repertoires` needs EVERY variation with its per-chapter included state,
 * where the picker needs only the current band's unlearned units. Serving both
 * from one route is what grew that route's `locked`/`pausedAtCeiling`/
 * `ceilingMoveCount` fields alongside `includedByChapter`.
 *
 * Every unit returned here is learnable right now: there is no locked, paused,
 * deferred or already-learned state to render, because a learned unit is
 * simply absent. A chapter with nothing left reports `band: null`,
 * `complete: true` and no units.
 *
 * Fetched lazily (only when the picker is opened or the active line changes),
 * not eagerly for every repertoire, to avoid the full-move-fetch cost the
 * shape cache exists to avoid.
 */
export const GET: RequestHandler = async ({ params, locals }) => {
	const user = await requireApiUser(locals);
	const [{ variations: allVariations, excludedVariationKeys }, solvedKeys, teachingProgress] = await Promise.all([
		loadRepertoireVariations(locals.supabase, user.id, params.id),
		loadSolvedKeys(locals.supabase, user.id, params.id),
		loadTeachingProgress(locals.supabase, user.id, params.id)
	]);

	const variations = filterVariations(allVariations, excludedVariationKeys);
	const plan = deriveLearnPlan(variations, computeMasteredMoveIds(variations, teachingProgress, solvedKeys));

	return json({
		chapters: plan.chapters.map((state) => ({
			chapter: state.chapter,
			band: state.band,
			level: state.level,
			complete: state.complete,
			learnedInBand: state.learnedInBand,
			totalInBand: state.totalInBand,
			units: state.units.map((unit) => ({
				unitKey: unit.unitKey,
				// The label and path are the CLIPPED prefix, not any member's
				// full line: the prefix is what Learn teaches and what the
				// player is being asked to recognise.
				label: moveSequenceLabel(unit.path),
				path: unit.path,
				// What the picker posts to /api/practice/select-variation. The
				// shortest member, so finishing this unit finishes a real
				// variation wherever one ends here (see `LearnUnit`).
				variationKey: unit.representativeVariationKey
			}))
		}))
	});
};
