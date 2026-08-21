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
