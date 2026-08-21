// mychess/src/routes/(coach)/coach/repertoires/[repertoire_id]/update/+page.server.ts
//
// The server side of a coach re-upload (GitHub issue #118): the coach uploads a
// revised PGN over an existing repertoire, `preview` classifies it against the
// repertoire's live shape while writing nothing at all, and `apply` commits it.
//
// Every decision lives in the pure modules under `$lib` (`repertoire-diff`,
// `repertoire-reconcile`) or in the I/O wrapper `$lib/server/repertoire-update`
// — this file is the request boundary: validate untrusted input, then sequence
// the apply's steps in the one order that is safe.

import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requireAccount } from '$lib/server/auth';
import { enumerateVariations, hasChapterTags } from '$lib/mastery/variations';
import type { MoveRow } from '$lib/pgn-import';
import type { IncomingChapter } from '$lib/repertoire-diff';
import { writeMoves } from '$lib/server/pgn-import';
import { fetchAllMoves, toRawMoveRows } from '$lib/server/practice-repertoire';
import {
	beginUpdate,
	buildUpdatePreview,
	moveIdsToRetire,
	moveIdsToUnretire
} from '$lib/server/repertoire-update';

/** One `{ from, to }` chapter rename the coach accepted on the review screen. */
type ChapterRename = { from: string; to: string };

/**
 * Same shape check `/api/repertoires/import-chapter` applies to the moves it is
 * handed, for the same reason: the client parsed the PGN, so every field here
 * is untrusted input that ends up in an upsert payload.
 */
function isMoveRow(value: unknown): value is MoveRow {
	if (!value || typeof value !== 'object') return false;
	const m = value as Record<string, unknown>;
	return (
		typeof m.fromFen === 'string' &&
		typeof m.toFen === 'string' &&
		typeof m.san === 'string' &&
		typeof m.move_number === 'number' &&
		typeof m.is_player_turn === 'boolean' &&
		(m.annotation === null || typeof m.annotation === 'string')
	);
}

/**
 * The upload as the review screen holds it: `[{ name, moves }]`, JSON-encoded
 * into one form field. A `name` of null is an untagged (single-chapter) upload
 * — legal, and distinct from a missing key.
 *
 * Returns a message rather than throwing so both actions can answer with
 * `fail(400, ...)` and keep the coach's page state.
 */
function parseChapters(raw: FormDataEntryValue | null): { chapters: IncomingChapter[] } | { error: string } {
	if (typeof raw !== 'string' || !raw) return { error: 'chapters is required' };

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return { error: 'chapters must be valid JSON' };
	}

	if (!Array.isArray(parsed)) return { error: 'chapters must be an array' };

	for (const entry of parsed) {
		if (!entry || typeof entry !== 'object') return { error: 'each chapter must be an object' };
		const chapter = entry as Record<string, unknown>;
		if (chapter.name !== null && typeof chapter.name !== 'string') {
			return { error: 'each chapter name must be a string or null' };
		}
		if (!Array.isArray(chapter.moves) || !chapter.moves.every(isMoveRow)) {
			return { error: 'each chapter must have a moves array of move rows' };
		}
	}

	return { chapters: parsed as IncomingChapter[] };
}

/** The renames the coach accepted, validated down to two non-empty strings each. */
function parseRenames(raw: FormDataEntryValue | null): { renames: ChapterRename[] } | { error: string } {
	// Absent means "no chapter was renamed", which is the common case — not an
	// error. The RPC tolerates an empty array (and ignores a non-array
	// entirely), but sending a well-formed empty one keeps that tolerance from
	// being load-bearing.
	if (raw === null || raw === '') return { renames: [] };
	if (typeof raw !== 'string') return { error: 'renames must be valid JSON' };

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return { error: 'renames must be valid JSON' };
	}

	if (!Array.isArray(parsed)) return { error: 'renames must be an array' };

	for (const entry of parsed) {
		if (!entry || typeof entry !== 'object') return { error: 'each rename must be an object' };
		const rename = entry as Record<string, unknown>;
		if (typeof rename.from !== 'string' || !rename.from) return { error: 'each rename needs a non-empty from' };
		if (typeof rename.to !== 'string' || !rename.to) return { error: 'each rename needs a non-empty to' };
	}

	// Narrowed to just the two keys the RPC reads, so nothing else the client
	// attached rides along into the `jsonb` argument.
	return { renames: (parsed as ChapterRename[]).map(({ from, to }) => ({ from, to })) };
}

/**
 * The chapters the coach chose to Keep on the review screen — chapters this
 * upload does not mention, whose lines must NOT be retired.
 *
 * Validated only for shape here. It is deliberately NOT trusted as a list of
 * names: see where it is used in `apply`, which intersects it with the server's
 * own freshly computed `absentChapters`.
 */
function parseKeptChapters(raw: FormDataEntryValue | null): { keptChapters: string[] } | { error: string } {
	// Absent means "nothing was kept" — every default on the review screen is
	// Keep, so in practice the field is always sent, but an older client or a
	// repertoire with no absent chapters at all legitimately sends nothing.
	if (raw === null || raw === '') return { keptChapters: [] };
	if (typeof raw !== 'string') return { error: 'keptChapters must be valid JSON' };

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return { error: 'keptChapters must be valid JSON' };
	}

	if (!Array.isArray(parsed)) return { error: 'keptChapters must be an array' };
	for (const entry of parsed) {
		if (typeof entry !== 'string' || !entry) return { error: 'each kept chapter must be a non-empty string' };
	}

	return { keptChapters: parsed as string[] };
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

	// Also covers a repertoire this coach may not read: RLS simply returns no
	// row, and "not found" is the right answer either way.
	if (!repertoire) throw error(404, 'Repertoire not found');

	return { repertoire, assignedStudentCount: assignedStudentCount ?? 0 };
};

export const actions: Actions = {
	/**
	 * The review screen's data. Writes NOTHING — the coach must be able to open
	 * the review, read what an apply would cost their students, and walk away
	 * with the repertoire untouched.
	 */
	preview: async ({ params, request, locals }) => {
		await requireAccount(locals);

		const fd = await request.formData();
		const parsed = parseChapters(fd.get('chapters'));
		if ('error' in parsed) return fail(400, { error: parsed.error });

		return await buildUpdatePreview(locals.supabase, params.repertoire_id, parsed.chapters);
	},

	/**
	 * Commits the re-upload. The step order below is load-bearing, and each step
	 * says why it sits where it does — this is not one transaction and cannot be
	 * (the move upsert has to stay in application code to chunk around
	 * PostgREST's URL-length and `max_rows` limits), so the ordering IS the
	 * correctness argument.
	 */
	apply: async ({ params, request, locals }) => {
		const { user } = await requireAccount(locals);
		const supabase = locals.supabase;

		// 1. Validate everything the client sent, before touching a single row.
		const fd = await request.formData();
		const parsedChapters = parseChapters(fd.get('chapters'));
		if ('error' in parsedChapters) return fail(400, { error: parsedChapters.error });
		const { chapters } = parsedChapters;

		const movesUpdatedAt = fd.get('movesUpdatedAt');
		if (typeof movesUpdatedAt !== 'string' || !movesUpdatedAt) {
			return fail(400, { error: 'movesUpdatedAt is required' });
		}

		const parsedRenames = parseRenames(fd.get('renames'));
		if ('error' in parsedRenames) return fail(400, { error: parsedRenames.error });
		const { renames } = parsedRenames;

		const parsedKept = parseKeptChapters(fd.get('keptChapters'));
		if ('error' in parsedKept) return fail(400, { error: parsedKept.error });
		const { keptChapters } = parsedKept;

		// 2. Claim the repertoire. ONE conditional UPDATE that both checks the
		// shape has not moved since the preview and sets the deferral flag, so
		// the two cannot be split by a concurrent apply.
		//
		// This MUST happen before any move write: the upsert in step 4 bumps
		// `moves_updated_at` itself (migration 0055's triggers), so a staleness
		// check made after it would reject the caller's own write, every time.
		const claimed = await beginUpdate(supabase, params.repertoire_id, movesUpdatedAt);
		if (!claimed) {
			return fail(409, { error: 'This repertoire changed since you started. Reload to see the current diff.' });
		}

		// 3. Recompute the diff server-side, against the shape as it is right
		// now, and derive the retire set from THAT — never from anything the
		// client sent. The client's diff is untrusted input and retiring is
		// destructive (it takes a line out of every assigned student's live
		// shape), so a forged `retire` list must not be able to retire arbitrary
		// moves. Only ids this server-side classification marks `removed` are
		// ever handed to the RPC.
		const preview = await buildUpdatePreview(supabase, params.repertoire_id, chapters);

		// The coach's per-chapter Keep, intersected with the chapters THIS
		// server-side classification just found absent. Same reasoning as the
		// retire set above, in the other direction: `keptChapters` arrives from
		// the client, so it is not honoured as an allow-list of arbitrary names.
		// Only a chapter the server itself determined the upload does not mention
		// can spare anything — a forged payload naming every chapter still spares
		// nothing in a chapter the upload genuinely replaces, because that chapter
		// is not absent and so never survives this intersection.
		const spared = new Set(preview.absentChapters.filter((name) => keptChapters.includes(name)));
		const retireMoveIds = moveIdsToRetire(preview.diffs, spared);

		// 4. Write the moves, one call per chapter, appending onto this
		// repertoire rather than creating a new one.
		//
		// `finalize: false` on EVERY call, including the last: this action
		// computes the final shape itself in step 6 and hands it to the RPC, so
		// `writeMoves` must not do its own fetch-and-finalize — that would cache
		// a shape which does not yet account for the retires and un-retires.
		const { data: repertoire, error: repErr } = await supabase
			.from('repertoires')
			.select('name, color')
			.eq('id', params.repertoire_id)
			.maybeSingle();
		if (repErr) return fail(500, { error: repErr.message });
		if (!repertoire) return fail(500, { error: 'Repertoire not found' });

		for (const chapter of chapters) {
			const result = await writeMoves(supabase, {
				// Unused in append mode (`existingRepertoireId` is set, so no
				// `repertoires` row is inserted) — the repertoire keeps its own
				// owner, who is not necessarily this coach.
				playerId: user!.id,
				name: repertoire.name,
				color: repertoire.color,
				ecoCode: null,
				ecoName: null,
				moves: chapter.moves,
				existingRepertoireId: params.repertoire_id,
				finalize: false,
				chapterLabel: chapter.name ?? undefined
			});
			// The deferral flag stays set on failure, until it goes stale. That is
			// deliberate: it keeps students from reconciling against the partially
			// written shape, and a failed upsert is additive (some new moves
			// landed) rather than destructive — nothing was retired, so no student
			// lost anything.
			if (result.error) return fail(500, { error: result.error });
		}

		// 5. Resolve the un-retire set AFTER the upsert. A restored line's row is
		// only reliably found once the upsert has REUSED it: the upsert conflicts
		// on `(repertoire_id, from_position, san)`, which the retired row still
		// occupies, so that row is merged rather than recreated.
		const unretireMoveIds = await moveIdsToUnretire(supabase, params.repertoire_id, chapters);

		// 6. The final shape, from the repertoire's own live rows rather than from
		// `chapters` — the upload is only part of the picture once un-retires are
		// in play, and `fetchAllMoves` already filters `retired_at is null`.
		const variations = enumerateVariations(toRawMoveRows(await fetchAllMoves(supabase, params.repertoire_id)));

		// 7. The atomic tail: renames, retires, un-retires, the refreshed shape
		// and the flag clear, all in one transaction.
		//
		// Invoked with the user-scoped `locals.supabase`, never a service-role
		// client: the RPC denies a caller whose `auth.uid()` is null, and a
		// `service_role` JWT carries no `sub`.
		const { error: rpcErr } = await supabase.rpc('apply_repertoire_update', {
			p_repertoire_id: params.repertoire_id,
			p_retire_move_ids: retireMoveIds,
			p_unretire_move_ids: unretireMoveIds,
			p_chapter_renames: renames,
			p_total_variations: variations.length,
			p_has_chapters: hasChapterTags(variations)
		});
		if (rpcErr) return fail(500, { error: rpcErr.message });

		return { applied: true };
	}
};
