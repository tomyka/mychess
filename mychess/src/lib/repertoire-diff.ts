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

	for (const inc of incoming) {
		// The existing line this one most plausibly descends from: longest
		// shared prefix wins, and among equals the shorter existing line, so a
		// line that is a clean prefix of the upload reads as extended rather
		// than as an arbitrary sibling.
		let best: { line: ExistingLine; shared: number } | null = null;
		for (const ex of existing) {
			const shared = commonPrefixLength(ex.sans, inc.sans);
			if (!best || shared > best.shared || (shared === best.shared && ex.sans.length < best.line.sans.length)) {
				best = { line: ex, shared };
			}
		}

		if (!best || best.shared === 0) {
			diffs.push({ kind: 'new', existingKey: null, sans: inc.sans, commonPlies: 0 });
			continue;
		}

		const ex = best.line;
		if (best.shared === ex.sans.length && best.shared === inc.sans.length) {
			diffs.push({ kind: 'unchanged', existingKey: ex.variationKey, sans: inc.sans, commonPlies: best.shared });
		} else if (best.shared === ex.sans.length) {
			diffs.push({ kind: 'extended', existingKey: ex.variationKey, sans: inc.sans, commonPlies: best.shared });
		} else if (best.shared === inc.sans.length) {
			diffs.push({ kind: 'truncated', existingKey: ex.variationKey, sans: inc.sans, commonPlies: best.shared });
		} else {
			diffs.push({ kind: 'diverged', existingKey: ex.variationKey, sans: inc.sans, commonPlies: best.shared });
		}
	}

	return diffs;
}
