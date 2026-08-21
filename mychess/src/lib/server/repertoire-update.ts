// mychess/src/lib/server/repertoire-update.ts
//
// The Supabase I/O for a coach re-upload (GitHub issue #118): it reads the
// repertoire's live shape, hands it to the pure classification in
// `$lib/repertoire-diff` and the pure projection in
// `$lib/repertoire-reconcile`, and resolves the two move-id sets the
// `apply_repertoire_update` RPC needs. Every decision lives in those pure
// modules — per CLAUDE.md's pure-logic/I-O split, this file stays a thin,
// deliberately boring wrapper and is not unit-tested directly.

import type { SupabaseClient } from '@supabase/supabase-js';
import { enumerateVariations } from '$lib/mastery/variations';
import {
	classifyVariations,
	detectRenames,
	incomingLinesFromChapters,
	type ChapterLines,
	type ExistingLine,
	type IncomingChapter,
	type IncomingLine,
	type RenameCandidate,
	type VariationDiff
} from '$lib/repertoire-diff';
import { projectImpact, type Impact } from '$lib/repertoire-reconcile';
import { fetchAllMoves, toRawMoveRows } from './practice-repertoire';
import { fetchAllPages, MAX_ROWS_PAGE_SIZE } from './paginate';

/**
 * Re-exported so a caller has ONE import site for both directions of the
 * retire/un-retire pair — `moveIdsToRetire` is pure (it needs only the diff)
 * while `moveIdsToUnretire` below has to query, but the RPC takes them
 * together and nothing is served by making the caller remember which is which.
 */
export { moveIdsToRetire } from '$lib/repertoire-diff';

/**
 * How long `repertoires.update_in_progress_at` is honoured before it is
 * treated as the residue of a crashed apply. Exported so reconciliation
 * compares against this exact value rather than its own copy of it — the two
 * sides deciding "stale" differently is how a repertoire wedges forever (or
 * reconciles against a half-applied shape, which is worse).
 */
export const UPDATE_FLAG_STALE_MS = 10 * 60 * 1000;

export type UpdatePreview = {
	diffs: VariationDiff[];
	renames: RenameCandidate[];
	impact: Impact;
	/** Chapters the repertoire has that this upload does not mention. */
	absentChapters: string[];
	/** The shape the diff was computed against. Passed back on apply. */
	movesUpdatedAt: string;
	assignedStudentCount: number;
};

/** The lines belonging to one chapter, as `detectRenames` wants them. */
function linesOfChapter(lines: Array<{ sans: string[]; chapterNames: string[] }>, name: string): string[][] {
	return lines.filter((line) => line.chapterNames.includes(name)).map((line) => line.sans);
}

/**
 * Everything the coach's review screen needs, writing nothing at all — the
 * coach must be able to open the review, read it, and walk away with the
 * repertoire untouched.
 */
export async function buildUpdatePreview(
	supabase: SupabaseClient,
	repertoireId: string,
	chapters: IncomingChapter[]
): Promise<UpdatePreview> {
	// The shape the whole preview is computed against. Carried back to
	// `beginUpdate` on apply, which refuses if it has moved since.
	const { data: repertoire, error: repErr } = await supabase
		.from('repertoires')
		.select('moves_updated_at')
		.eq('id', repertoireId)
		.maybeSingle();
	if (repErr) throw new Error(`Failed to load repertoire ${repertoireId}: ${repErr.message}`);
	if (!repertoire) throw new Error(`Repertoire ${repertoireId} not found`);
	// `not null default now()` since migration 0055, so this is always a real
	// timestamp — including on a repertoire that has never had a move written.
	const movesUpdatedAt: string = (repertoire as { moves_updated_at: string }).moves_updated_at;

	// The repertoire's CURRENT live shape: `fetchAllMoves` already filters
	// `retired_at is null` and pages past PostgREST's 1000-row cap.
	const rawMoves = toRawMoveRows(await fetchAllMoves(supabase, repertoireId));
	const existing: ExistingLine[] = enumerateVariations(rawMoves).map((v) => ({
		variationKey: v.variationKey,
		sans: v.path.map((step) => step.san),
		chapterNames: v.chapterNames
	}));

	const incoming: IncomingLine[] = incomingLinesFromChapters(chapters);
	const diffs = classifyVariations(existing, incoming);

	// The upload's chapter names come from the `chapters` argument, NOT from
	// `incoming`. A chapter whose `moves` array is empty contributes no line and
	// therefore no name, so deriving the names from the enumerated lines would
	// report an empty uploaded chapter as absent from its own upload — and
	// "absent" is what offers the coach a rename or a prune.
	const existingChapters = new Set(existing.flatMap((line) => line.chapterNames));
	const uploadedChapters = new Set(
		chapters.map((chapter) => chapter.name).filter((name): name is string => name !== null)
	);
	const absentChapters = [...existingChapters].filter((name) => !uploadedChapters.has(name));
	const addedChapters = [...uploadedChapters].filter((name) => !existingChapters.has(name));

	// Each side's lines come from the side that actually has them: an absent
	// chapter's lines only exist in the database, an added chapter's only in the
	// upload.
	const absent: ChapterLines[] = absentChapters.map((name) => ({ name, lines: linesOfChapter(existing, name) }));
	const added: ChapterLines[] = addedChapters.map((name) => ({ name, lines: linesOfChapter(incoming, name) }));
	const renames = detectRenames(absent, added);

	// Both reads page via `fetchAllPages`, and each paired count query carries
	// the IDENTICAL filter as its page query (the pager derives its remaining
	// ranges from that count, so a count over a wider filter reads past the end
	// of the real result set). Neither is a theoretical concern: a repertoire
	// assigned to a large squad, each student holding many learned lines,
	// exceeds PostgREST's 1000-row cap easily — and it truncates SILENTLY, which
	// here would quietly understate the student cost the coach is deciding on.
	const [assignments, solvedRows] = await Promise.all([
		fetchAllPages<{ player_id: string }>(
			() =>
				supabase
					.from('assigned_repertoires')
					.select('player_id')
					.eq('repertoire_id', repertoireId)
					.order('player_id', { ascending: true }),
			() =>
				supabase
					.from('assigned_repertoires')
					.select('id', { count: 'exact', head: true })
					.eq('repertoire_id', repertoireId),
			MAX_ROWS_PAGE_SIZE
		),
		fetchAllPages<{ player_id: string; variation_key: string }>(
			() =>
				supabase
					.from('variation_solved')
					.select('player_id, variation_key')
					.eq('repertoire_id', repertoireId)
					.order('player_id', { ascending: true })
					.order('variation_key', { ascending: true }),
			() =>
				supabase
					.from('variation_solved')
					.select('id', { count: 'exact', head: true })
					.eq('repertoire_id', repertoireId),
			MAX_ROWS_PAGE_SIZE
		)
	]);

	// Seeded from the assignments so a student with no `variation_solved` rows
	// still appears, with an empty array. The review's sentence is "N lines drop
	// across M of K students": M is `impact.affectedPlayerCount` and K is
	// `assignedStudentCount`, so the projection has to see exactly the same
	// student set the count reports, or M can exceed K.
	//
	// The same reason solved rows are attached only to an ASSIGNED player: a
	// non-assigned holder of progress (the owner practising their own material)
	// would otherwise push M above K. Their progress still reconciles — that is
	// lazy and per-player, keyed off `repertoire_reconciliation`, and owes
	// nothing to this projection.
	const solvedByPlayer = new Map<string, string[]>();
	for (const row of assignments) if (!solvedByPlayer.has(row.player_id)) solvedByPlayer.set(row.player_id, []);
	for (const row of solvedRows) solvedByPlayer.get(row.player_id)?.push(row.variation_key);

	const students = [...solvedByPlayer].map(([playerId, solved]) => ({ playerId, solved }));

	return {
		diffs,
		renames,
		impact: projectImpact(diffs, students),
		absentChapters,
		movesUpdatedAt,
		assignedStudentCount: students.length
	};
}

/**
 * Claims the repertoire for an apply, returning false when its shape has moved
 * since the preview's diff was computed — the caller must then refuse to apply
 * and re-run the preview, because every move id in that diff was resolved
 * against a shape that no longer exists.
 *
 * ONE conditional UPDATE on purpose. A read-then-write would leave a window
 * between reading `moves_updated_at` and setting the flag in which a second
 * apply could land its own upsert, bumping `moves_updated_at` (0055's
 * triggers), and both applies would believe they had a current diff. Postgres
 * evaluates the `.eq('moves_updated_at', ...)` predicate and the write in one
 * statement, so the check and the claim cannot be split.
 *
 * The stamped timestamp is a JS clock reading, used ONLY as a staleness marker
 * measured against `UPDATE_FLAG_STALE_MS` — it is never compared against a
 * database clock or against `moves_updated_at`, so client/server clock skew
 * cannot make it mean the wrong thing. (`moves_updated_at`, the value that IS
 * compared, is written by the database and only ever read back verbatim.)
 */
export async function beginUpdate(
	supabase: SupabaseClient,
	repertoireId: string,
	expectedMovesUpdatedAt: string
): Promise<boolean> {
	const { data } = await supabase
		.from('repertoires')
		.update({ update_in_progress_at: new Date().toISOString() })
		.eq('id', repertoireId)
		.eq('moves_updated_at', expectedMovesUpdatedAt)
		.select('id');
	return (data?.length ?? 0) > 0;
}

/** One currently-retired move, with the FEN of the position it leaves. */
type RetiredMoveRow = { id: string; san: string; from_pos: { fen: string } | null };

/**
 * The retired move rows this upload brings back — the `p_unretire_move_ids`
 * argument to `apply_repertoire_update`, which is where the un-retire has to
 * happen (`moves` grants a coach no UPDATE on a student-owned repertoire, so an
 * app-side un-retire fails silently under RLS in exactly the coach case).
 *
 * MUST be called AFTER the move upsert, never before. A restored line's row
 * only becomes findable once the upsert has REUSED it: the upsert conflicts on
 * `(repertoire_id, from_position, san)`, which the retired row still occupies,
 * so no new row is created — and `writeMoves`' existing-rows lookup
 * deliberately does not filter `retired_at`, precisely so the retired row is
 * seen and merged rather than fought with. Before the upsert, this returns ids
 * for edges the upload happens to mention but whose `chapter_names`/annotations
 * have not been refreshed yet; the real damage is on the other side of the
 * ordering, where the caller must not un-retire rows the upsert then fails to
 * write.
 */
export async function moveIdsToUnretire(
	supabase: SupabaseClient,
	repertoireId: string,
	chapters: IncomingChapter[]
): Promise<string[]> {
	// Paged for the same silent-truncation reason as everything else here: a
	// coach who pruned a large chapter and restores it has well over 1000
	// retired rows. The count query repeats the page query's filters exactly —
	// counting retired rows while paging retired rows.
	const rows = await fetchAllPages<RetiredMoveRow>(
		() =>
			supabase
				.from('moves')
				.select('id, san, from_pos:from_position(fen)')
				.eq('repertoire_id', repertoireId)
				.not('retired_at', 'is', null)
				.order('id', { ascending: true }),
		() =>
			supabase
				.from('moves')
				.select('id', { count: 'exact', head: true })
				.eq('repertoire_id', repertoireId)
				.not('retired_at', 'is', null),
		MAX_ROWS_PAGE_SIZE
	);

	// The upload's own edge set, keyed the way `incomingLinesFromChapters` keys
	// it: the FEN a move leaves plus its SAN identifies an edge, and is what the
	// upsert's own conflict target resolves to once FENs become position ids.
	const uploadEdges = new Set(chapters.flatMap((c) => c.moves.map((m) => `${m.fromFen}|${m.san}`)));

	return rows
		.filter((row) => {
			// A row whose joined position is missing cannot be matched to an edge.
			// Skipped rather than keyed as `|san`, which would collide with any
			// upload move that somehow carried an empty `fromFen`.
			const fen = row.from_pos?.fen;
			return fen ? uploadEdges.has(`${fen}|${row.san}`) : false;
		})
		.map((row) => row.id);
}
