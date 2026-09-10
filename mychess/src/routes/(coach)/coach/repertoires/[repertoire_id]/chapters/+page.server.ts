// mychess/src/routes/(coach)/coach/repertoires/[repertoire_id]/chapters/+page.server.ts
//
// The coach chapter manager (GitHub issue #184): list a repertoire's chapters
// with the cost of removing each, and remove the chosen ones for every
// assigned student at once.
//
// Same division of labour as the sibling `update` route: every decision lives
// in the pure module (`$lib/repertoire-chapter-removal`), the atomic write is
// the RPC's (`apply_repertoire_update`, migration 0074), and this file is the
// request boundary — validate untrusted input, then sequence the steps in the
// one order that is safe.

import { error, fail } from '@sveltejs/kit';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Actions, PageServerLoad } from './$types';
import { requireAccount } from '$lib/server/auth';
import { enumerateVariations, type Variation } from '$lib/mastery/variations';
import { fetchAllMoves, toRawMoveRows } from '$lib/server/practice-repertoire';
import { fetchAllPages, MAX_ROWS_PAGE_SIZE } from '$lib/server/paginate';
import { beginUpdate } from '$lib/server/repertoire-update';
import {
	planChapterRemoval,
	removedVariationKeys,
	removesEveryChapter,
	summarizeChapters,
	UNTAGGED_CHAPTER
} from '$lib/repertoire-chapter-removal';

/**
 * Every variation key ANY assigned player has progress on, across
 * `variation_solved` and `variation_teaching_progress` — the two tables whose
 * rows key off a variation and would be left pointing at retired moves.
 *
 * Read-only, for the confirm dialog only: it never gates a removal. A coach
 * who wants a chapter gone gets it gone; the set is there so they know what
 * it costs first.
 *
 * Fetched ONCE for the whole repertoire (both tables carry `repertoire_id`),
 * the same way the sibling `update` route reads `variation_solved` for its own
 * impact preview, rather than once per chapter keyed by an
 * `.in('variation_key', ...)` filter.
 *
 * Two separate hazards make the filtered version worse, not better:
 *
 *   1. `variation_key` is an unbounded-length chain of move UUIDs. Migration
 *      0049 added `variation_key_hash` because a raw key overflowed Postgres's
 *      btree row-size limit; SEPARATELY, `variation-practice-settings.ts`
 *      found that even batches of already-hashed 64-char values could blow the
 *      query string's own length ceiling ("Bad Request", no Postgres error),
 *      which is why its own batch size is capped at 100. Raw keys in an
 *      `.in()` are exposed to the second hazard with no bound at all.
 *   2. Filtering by key would not actually fetch less. Neither table is
 *      scoped to one player here, so both return one row per (player, key)
 *      pair either way — and `load` needs EVERY chapter's count, so the union
 *      of all chapters' exclusive keys is very nearly the whole repertoire.
 *      A hashed, chunked version would page through the same rows using many
 *      more round trips.
 *
 * Ordering is `(player_id, variation_key)` — the pair `variation_solved`'s own
 * unique constraint is built on — NOT `variation_key` alone. Many players
 * commonly solve the same line, so `variation_key` is not unique across this
 * result set, and a partial order lets rows tied at a page boundary be skipped
 * or repeated once the repertoire crosses `MAX_ROWS_PAGE_SIZE`. The sibling
 * `update` route orders by both columns for exactly this reason.
 */
async function fetchLineKeysWithProgress(supabase: SupabaseClient, repertoireId: string): Promise<Set<string>> {
	const [solved, teaching] = await Promise.all([
		fetchAllPages<{ variation_key: string }>(
			() =>
				supabase
					.from('variation_solved')
					.select('variation_key')
					.eq('repertoire_id', repertoireId)
					.order('player_id', { ascending: true })
					.order('variation_key', { ascending: true }),
			() =>
				supabase
					.from('variation_solved')
					.select('id', { count: 'exact', head: true })
					.eq('repertoire_id', repertoireId),
			MAX_ROWS_PAGE_SIZE
		),
		fetchAllPages<{ variation_key: string }>(
			() =>
				supabase
					.from('variation_teaching_progress')
					.select('variation_key')
					.eq('repertoire_id', repertoireId)
					.order('player_id', { ascending: true })
					.order('variation_key', { ascending: true }),
			() =>
				supabase
					.from('variation_teaching_progress')
					.select('id', { count: 'exact', head: true })
					.eq('repertoire_id', repertoireId),
			MAX_ROWS_PAGE_SIZE
		)
	]);

	const withProgress = new Set<string>();
	for (const row of solved) withProgress.add(row.variation_key);
	for (const row of teaching) withProgress.add(row.variation_key);
	return withProgress;
}

export const load: PageServerLoad = async ({ params, locals }) => {
	// The `(coach)` group's `+layout.server.ts` already gates
	// `profile.role === 'coach'`, so this only has to require a real account —
	// re-checking the role here would duplicate the group's guard.
	await requireAccount(locals);

	const [{ data: repertoire }, { count: assignedStudentCount }] = await Promise.all([
		locals.supabase
			.from('repertoires')
			.select('id, name, color, moves_updated_at')
			.eq('id', params.repertoire_id)
			.maybeSingle(),
		locals.supabase
			.from('assigned_repertoires')
			.select('id', { count: 'exact', head: true })
			.eq('repertoire_id', params.repertoire_id)
	]);

	// Also covers a repertoire this coach may not read: RLS returns no row, and
	// "not found" is the right answer either way.
	if (!repertoire) throw error(404, 'Repertoire not found');

	// Concurrent: the progress read needs only the repertoire id, so making it
	// wait on the move fetch would cost a whole round trip on every page load
	// for nothing. One repertoire-wide progress read, not one per chapter —
	// see `fetchLineKeysWithProgress`'s own comment on why.
	const [moves, withProgress] = await Promise.all([
		fetchAllMoves(locals.supabase, params.repertoire_id),
		fetchLineKeysWithProgress(locals.supabase, params.repertoire_id)
	]);

	const variations = enumerateVariations(toRawMoveRows(moves));
	const impacts = summarizeChapters(variations);

	const chapters = impacts.map((impact) => ({
		name: impact.name,
		lineCount: impact.lineCount,
		sharedLineCount: impact.sharedLineCount,
		progressLineCount: impact.exclusiveVariationKeys.filter((key) => withProgress.has(key)).length
	}));

	return {
		repertoire,
		assignedStudentCount: assignedStudentCount ?? 0,
		chapters,
		lineGroups: lineGroups(variations, withProgress),
		untaggedChapterName: UNTAGGED_CHAPTER
	};
};

/**
 * Every line collapsed into groups by WHICH chapters claim it, with the count
 * of lines in each group and how many of those carry student progress.
 *
 * The confirm dialog's numbers can only be computed from this, not from
 * per-chapter figures. `removedVariationKeys` is the authority on what a
 * removal actually deletes — a line goes iff EVERY chapter claiming it is in
 * the removal set — so a line shared by two chapters the coach selected
 * TOGETHER does disappear, while the same line shared with a chapter they
 * left alone survives. Per-chapter exclusive counts cannot express that
 * difference: such a line is exclusive to neither chapter, so summing
 * `lineCount - sharedLineCount` silently omits it (GitHub issue #185).
 *
 * Grouping rather than sending one entry per line keeps this small: the
 * number of distinct chapter-membership sets is on the order of the chapter
 * count, not the line count.
 */
function lineGroups(
	variations: Variation[],
	withProgress: ReadonlySet<string>
): { chapters: string[]; lineCount: number; progressLineCount: number }[] {
	const groups = new Map<string, { chapters: string[]; lineCount: number; progressLineCount: number }>();
	for (const variation of variations) {
		// Same fallback `summarizeChapters` and `removedVariationKeys` use, so
		// all three agree on which bucket an untagged line belongs to.
		const claiming =
			variation.chapterNames.length === 0 ? [UNTAGGED_CHAPTER] : [...variation.chapterNames].sort();
		const signature = claiming.join('\u0000');
		const group = groups.get(signature) ?? { chapters: claiming, lineCount: 0, progressLineCount: 0 };
		group.lineCount += 1;
		if (withProgress.has(variation.variationKey)) group.progressLineCount += 1;
		groups.set(signature, group);
	}
	return [...groups.values()];
}

/** The chapter names the coach chose, validated for shape only. */
function parseRemoveChapters(raw: FormDataEntryValue | null): { names: string[] } | { error: string } {
	if (typeof raw !== 'string' || !raw) return { error: 'chapters is required' };

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return { error: 'chapters must be valid JSON' };
	}

	if (!Array.isArray(parsed)) return { error: 'chapters must be an array' };
	if (parsed.length === 0) return { error: 'Select at least one chapter to remove' };
	for (const entry of parsed) {
		if (typeof entry !== 'string' || !entry) return { error: 'each chapter must be a non-empty string' };
	}

	return { names: parsed as string[] };
}

export const actions: Actions = {
	remove: async ({ params, request, locals }) => {
		await requireAccount(locals);
		const supabase = locals.supabase;

		// 1. Validate before touching a row.
		const fd = await request.formData();
		const parsed = parseRemoveChapters(fd.get('chapters'));
		if ('error' in parsed) return fail(400, { error: parsed.error });

		const movesUpdatedAt = fd.get('movesUpdatedAt');
		if (typeof movesUpdatedAt !== 'string' || !movesUpdatedAt) {
			return fail(400, { error: 'movesUpdatedAt is required' });
		}

		// 2. Claim the repertoire — ONE conditional UPDATE that both checks the
		// shape has not moved since the page was rendered and sets the deferral
		// flag, so the two cannot be split by a concurrent apply.
		const claimed = await beginUpdate(supabase, params.repertoire_id, movesUpdatedAt);
		if (!claimed) {
			return fail(409, { error: 'This repertoire changed since you opened this page. Reload and try again.' });
		}

		// 3. Recompute from the repertoire's live rows, and derive the retire set
		// from THAT — never from anything the client sent. The client supplies
		// chapter NAMES; which moves those names cost is decided here. Retiring is
		// destructive (it takes a line out of every assigned student's shape), so
		// a forged payload must not be able to retire arbitrary moves.
		const rawMoves = toRawMoveRows(await fetchAllMoves(supabase, params.repertoire_id));
		const variations = enumerateVariations(rawMoves);

		// A removal that empties the repertoire is a repertoire delete, not a
		// chapter removal. Checked server-side as well as in the UI, because the
		// UI is not the authority. A name the repertoire does not have simply
		// costs nothing, so this cannot be tricked by padding the list.
		if (removesEveryChapter(variations, parsed.names)) {
			return fail(400, {
				error: 'That would remove every chapter. Delete the repertoire itself instead.'
			});
		}

		const plan = planChapterRemoval(rawMoves, parsed.names);

		// 4. The atomic tail: strip the names, drop the orphaned per-chapter
		// exclusions, retire the moves, refresh the cached shape and clear the
		// flag — one transaction, under the RPC's own row lock.
		//
		// Invoked with the user-scoped `locals.supabase`, never a service-role
		// client: the RPC denies a caller whose `auth.uid()` is null, and a
		// `service_role` JWT carries no `sub`.
		const { error: rpcErr } = await supabase.rpc('apply_repertoire_update', {
			p_repertoire_id: params.repertoire_id,
			p_retire_move_ids: plan.retireMoveIds,
			p_unretire_move_ids: [],
			p_chapter_renames: [],
			p_total_variations: plan.totalVariations,
			p_has_chapters: plan.hasChapters,
			p_chapter_count: plan.chapterCount,
			p_remove_chapters: parsed.names
		});
		if (rpcErr) return fail(500, { error: rpcErr.message });

		return {
			removed: parsed.names.length,
			removedLineCount: removedVariationKeys(variations, parsed.names).length
		};
	}
};
