/**
 * Pure classification of a repertoire re-upload against the repertoire's
 * current state. No Supabase — see `src/lib/server/repertoire-update.ts` for
 * the I/O that feeds this.
 *
 * The two sides are keyed differently on purpose: existing lines carry move
 * UUIDs (their `variationKey`), incoming lines carry only SAN, because their
 * moves are not written yet. Comparison therefore happens on the SAN path,
 * which both sides have, and `existingKey` is carried through so the caller
 * can find the progress rows belonging to a matched line.
 */

import { enumerateVariations, moveIdsInVariationKey, type RawMoveRow } from '$lib/mastery/variations';
import type { MoveRow } from './pgn-import';

/** A line as it exists in the database. `sans` is one entry per ply, root to leaf. */
export type ExistingLine = {
	variationKey: string;
	sans: string[];
	chapterNames: string[];
};

/** A line as it appears in the uploaded PGN. No ids — its moves are unwritten. */
export type IncomingLine = {
	sans: string[];
	chapterNames: string[];
};

export type DiffKind = 'unchanged' | 'extended' | 'truncated' | 'diverged' | 'new' | 'removed';

export type VariationDiff = {
	kind: DiffKind;
	/** Present for every kind except `new` — the key whose progress rows this concerns. */
	existingKey: string | null;
	/** The line as it will exist after the update. Null for `removed`. */
	sans: string[] | null;
	/**
	 * Plies the two versions share. For `unchanged` this is the full length; for
	 * `new` it is the longest prefix shared with ANY existing line (the
	 * inheritance depth); for `removed` it is 0.
	 */
	commonPlies: number;
};

/** How many leading plies two SAN paths share. */
export function commonPrefixLength(a: string[], b: string[]): number {
	let i = 0;
	while (i < a.length && i < b.length && a[i] === b[i]) i++;
	return i;
}

export function classifyVariations(existing: ExistingLine[], incoming: IncomingLine[]): VariationDiff[] {
	const diffs: VariationDiff[] = [];
	const claimed = new Set<string>();

	/**
	 * The longest prefix this incoming line shares with ANY existing line,
	 * claimed or not. Inheritance is about what the student already knows, not
	 * about which line owns which ancestor — a new sibling branching off a line
	 * the student has learned starts at that depth even though the parent line
	 * is already claimed by its own unchanged self.
	 */
	const inheritedPlies = (inc: IncomingLine): number =>
		existing.reduce((max, ex) => Math.max(max, commonPrefixLength(ex.sans, inc.sans)), 0);

	// Pass 1: exact matches claim their existing line before anything else.
	// Without this ordering a near-match could steal the line that another
	// incoming line reproduces exactly, and an untouched line would be reported
	// as diverged — demoting students who had learned it.
	const byExactPath = new Map<string, ExistingLine>();
	for (const ex of existing) byExactPath.set(ex.sans.join('>'), ex);

	const pending: IncomingLine[] = [];
	for (const inc of incoming) {
		const exact = byExactPath.get(inc.sans.join('>'));
		if (exact && !claimed.has(exact.variationKey)) {
			claimed.add(exact.variationKey);
			diffs.push({
				kind: 'unchanged',
				existingKey: exact.variationKey,
				sans: inc.sans,
				commonPlies: inc.sans.length
			});
		} else {
			pending.push(inc);
		}
	}

	// Pass 2: each remaining line takes the closest UNCLAIMED existing line.
	// Processed best-match-first (ties on input order, for determinism) so the
	// line that most resembles an ancestor wins it, rather than whichever
	// happened to be listed first.
	const ordered = pending
		.map((inc, index) => ({ inc, index, shared: inheritedPlies(inc) }))
		.sort((a, b) => b.shared - a.shared || a.index - b.index);

	for (const { inc } of ordered) {
		let best: { line: ExistingLine; shared: number } | null = null;
		for (const ex of existing) {
			if (claimed.has(ex.variationKey)) continue;
			const shared = commonPrefixLength(ex.sans, inc.sans);
			if (shared === 0) continue;
			// Among equal prefixes the SHORTER existing line wins, so a line that
			// is a clean prefix of the upload reads as extended rather than as an
			// arbitrary sibling.
			if (!best || shared > best.shared || (shared === best.shared && ex.sans.length < best.line.sans.length)) {
				best = { line: ex, shared };
			}
		}

		if (!best) {
			diffs.push({ kind: 'new', existingKey: null, sans: inc.sans, commonPlies: inheritedPlies(inc) });
			continue;
		}

		claimed.add(best.line.variationKey);
		// `unchanged` is unreachable here: an identical path was claimed in pass 1.
		const kind: DiffKind =
			best.shared === best.line.sans.length ? 'extended' : best.shared === inc.sans.length ? 'truncated' : 'diverged';
		diffs.push({ kind, existingKey: best.line.variationKey, sans: inc.sans, commonPlies: best.shared });
	}

	// Whatever no incoming line claimed is gone from the upload. `claimed` is
	// what keeps an extended line from ALSO being reported as removed: its
	// `extended` entry claimed the old shorter line already.
	for (const ex of existing) {
		if (claimed.has(ex.variationKey)) continue;
		diffs.push({ kind: 'removed', existingKey: ex.variationKey, sans: null, commonPlies: 0 });
	}

	return diffs;
}

/**
 * Minimum share of an absent chapter's lines that must reappear under a new
 * chapter's name before a rename is offered. Below this, offering nothing beats
 * offering a guess: a wrong rename accepted by a coach clicking through
 * silently merges two unrelated chapters, and merging is not reversible from
 * the UI.
 */
export const RENAME_THRESHOLD = 0.7;

export type ChapterLines = { name: string; lines: string[][] };
export type RenameCandidate = { from: string; to: string; overlap: number };

/**
 * Pairs each chapter absent from the upload with the new chapter that most
 * covers its lines, when exactly one clears `RENAME_THRESHOLD`. Two qualifying
 * candidates yield nothing — a coin-flip presented as a default is worse than
 * asking, so the coach resolves an ambiguous case by hand.
 *
 * `overlap` is "how much of the OLD chapter the new one covers", measured over
 * DISTINCT lines on both sides. Counting the new chapter's matching lines
 * instead would let a duplicated line push the ratio above 1.
 */
export function detectRenames(absent: ChapterLines[], added: ChapterLines[]): RenameCandidate[] {
	const candidates: RenameCandidate[] = [];

	for (const gone of absent) {
		const goneKeys = new Set(gone.lines.map((l) => l.join('>')));
		if (goneKeys.size === 0) continue;

		const qualifying = added
			.map((add) => {
				const addKeys = new Set(add.lines.map((l) => l.join('>')));
				let covered = 0;
				for (const key of goneKeys) if (addKeys.has(key)) covered++;
				return { from: gone.name, to: add.name, overlap: covered / goneKeys.size };
			})
			.filter((c) => c.overlap >= RENAME_THRESHOLD);

		if (qualifying.length === 1) candidates.push(qualifying[0]);
	}

	return candidates;
}

/** One parsed chapter of an upload. `name: null` means the upload is untagged. */
export type IncomingChapter = { name: string | null; moves: MoveRow[] };

/**
 * The upload's own line set, ready to compare against the repertoire's current
 * lines.
 *
 * Routed through `enumerateVariations` rather than assembled by hand, for the
 * property that function provides and hand-rolling loses: it walks each
 * chapter's own edges separately and merges the results BY KEY, so a line two
 * chapters share becomes ONE line carrying both names, and a line repeated
 * inside the upload collapses to one entry. Duplicates would otherwise reach
 * `classifyVariations` and read as spurious extra `new` lines.
 *
 * Synthetic ids and `fromPositionId: fromFen` mirror what `writeMoves` already
 * does to compute a repertoire's shape before any row is written — the FEN IS
 * the position identity at this stage, since no `positions` row exists yet.
 */
export function incomingLinesFromChapters(chapters: IncomingChapter[]): IncomingLine[] {
	// `chapterNames` is required on this local type (it is optional on
	// `RawMoveRow`, for the benefit of fixtures that don't care) so the merge
	// below can push onto it without a non-null assertion.
	const byEdge = new Map<string, RawMoveRow & { chapterNames: string[] }>();

	for (const chapter of chapters) {
		for (const move of chapter.moves) {
			const edge = `${move.fromFen}|${move.san}`;
			const existing = byEdge.get(edge);
			if (existing) {
				// Same edge reached from another chapter (a transposition, or a
				// duplicated chapter): merge the names rather than keeping whichever
				// arrived first. `enumerateVariations` scopes its walk per chapter,
				// and an edge invisible to a chapter's own scope breaks that
				// chapter's path reconstruction.
				if (chapter.name && !existing.chapterNames.includes(chapter.name)) {
					existing.chapterNames.push(chapter.name);
				}
				continue;
			}
			byEdge.set(edge, {
				id: String(byEdge.size),
				fromPositionId: move.fromFen,
				toPositionId: move.toFen,
				fromFen: move.fromFen,
				toFen: move.toFen,
				san: move.san,
				isPlayerTurn: move.is_player_turn,
				chapterNames: chapter.name ? [chapter.name] : []
			});
		}
	}

	return enumerateVariations([...byEdge.values()]).map((v) => ({
		sans: v.path.map((s) => s.san),
		chapterNames: v.chapterNames
	}));
}

/**
 * The move ids a `removed` line makes retirable: every ply belonging
 * EXCLUSIVELY to removed lines. A ply shared with any surviving line is kept —
 * retiring a shared prefix move would silently break every line running
 * through it, which is the worst failure this feature could produce.
 */
export function moveIdsToRetire(diffs: VariationDiff[]): string[] {
	const surviving = new Set<string>();
	for (const d of diffs) {
		if (d.kind === 'removed' || !d.existingKey) continue;
		for (const id of moveIdsInVariationKey(d.existingKey)) surviving.add(id);
	}

	const doomed = new Set<string>();
	for (const d of diffs) {
		if (d.kind !== 'removed' || !d.existingKey) continue;
		for (const id of moveIdsInVariationKey(d.existingKey)) {
			if (!surviving.has(id)) doomed.add(id);
		}
	}
	return [...doomed];
}
