// mychess/src/lib/repertoire-diff-review.ts
//
// Pure rendering logic for the coach's repertoire re-upload review
// (`RepertoireDiffReview.svelte`, GitHub issue #118): given one classified
// line, how it splits into the coloured segments the screen draws in place,
// the muted sentence explaining what it costs, and — summed over the whole
// upload — the footer's one-sentence verdict.
//
// None of this touches Svelte state, so it is split out to be tested
// directly, the same split `repertoire-diff.ts` and `repertoire-reconcile.ts`
// already draw for the rest of this feature. The component owns rendering
// (colours, layout, the coach's live decisions) and calls into this module
// rather than reimplementing it.

import { commonPrefixLength, isSparedRemovedLine, type DiffKind } from './repertoire-diff';
import { m } from '$lib/paraglide/messages';

export type ReviewDiffKind = DiffKind;

/**
 * One classified line, as the review screen needs it. Structurally identical
 * to `DiffWithChapters` from `$lib/server/repertoire-update`, but declared
 * here rather than imported from it — that module is server-only, and a
 * type-only import would probably survive the bundler, but "probably" is not
 * a good reason to point client code at `$lib/server`.
 */
export type ReviewDiff = {
	kind: ReviewDiffKind;
	existingKey: string | null;
	sans: string[] | null;
	previousSans: string[] | null;
	commonPlies: number;
	chapterNames: string[];
};

export type ReviewPreview = {
	diffs: ReviewDiff[];
	renames: Array<{ from: string; to: string; overlap: number }>;
	impact: {
		counts: Record<ReviewDiffKind, number>;
		demotedLineCount: number;
		removedLearnedCount: number;
		affectedPlayerCount: number;
	};
	absentChapters: string[];
	movesUpdatedAt: string;
	assignedStudentCount: number;
};

/** Ply 0 is White's first move, so the label only appears on even plies. */
export function moveLabel(ply: number): string {
	return ply % 2 === 0 ? `${ply / 2 + 1}.` : '';
}

/**
 * One piece of a rendered line. `styleKind` is semantic, not a CSS class —
 * `'context'` is the one value with no `ReviewDiffKind` counterpart, for the
 * prefix both versions agree on, which gets the plain text colour rather
 * than any diff colour. Keeping Tailwind classes out of this module (the
 * component maps `styleKind` onto its own `DIFF_STYLE` tokens) is what makes
 * `segmentsOf` testable without a DOM.
 */
export type SegmentStyleKind = ReviewDiffKind | 'context';
export type Segment = { sans: string[]; startPly: number; styleKind: SegmentStyleKind; struck: boolean };

/**
 * The line, split into the pieces that get different colours: what both
 * versions agree on, what this upload drops, and what it puts there instead.
 * `startPly` is carried so every segment keeps the move numbering of the
 * position it actually occupies.
 *
 * `spared` is passed in rather than recomputed here — whether a `removed`
 * line survives depends on the coach's live Keep/Remove choice for its
 * chapter(s), which this module has no way to see. `isSparedRemovedLine`
 * (`./repertoire-diff`) is the one place that answers it; the caller applies
 * it and hands the answer in.
 */
export function segmentsOf(diff: ReviewDiff, spared: boolean): Segment[] {
	const previous = diff.previousSans;
	const next = diff.sans;

	// Removed: there is no new version, so the whole old line is struck —
	// unless its chapter is being kept, in which case nothing happens to it and
	// striking it would say the opposite.
	if (!next) {
		if (!previous) return [];
		return [{ sans: previous, startPly: 0, styleKind: spared ? 'unchanged' : 'removed', struck: !spared }];
	}
	// New: nothing was replaced, so the whole line is new.
	if (!previous) return [{ sans: next, startPly: 0, styleKind: 'new', struck: false }];

	const common = commonPrefixLength(previous, next);
	const segments: Segment[] = [];
	if (common > 0) {
		segments.push({ sans: next.slice(0, common), startPly: 0, styleKind: 'context', struck: false });
	}
	// The replaced plies, struck, immediately before their replacement — the
	// whole point of carrying `previousSans`.
	const replaced = previous.slice(common);
	if (replaced.length > 0) {
		segments.push({ sans: replaced, startPly: common, styleKind: 'removed', struck: true });
	}
	const added = next.slice(common);
	if (added.length > 0) {
		// A replacement reads as diverged; a pure append reads as extended. When
		// a line both diverges and grows, the first new ply is the replacement
		// and the rest is the tail.
		if (replaced.length > 0) {
			segments.push({ sans: added.slice(0, 1), startPly: common, styleKind: 'diverged', struck: false });
			if (added.length > 1) {
				segments.push({ sans: added.slice(1), startPly: common + 1, styleKind: 'extended', struck: false });
			}
		} else {
			segments.push({ sans: added, startPly: common, styleKind: 'extended', struck: false });
		}
	}
	return segments;
}

/**
 * One muted sentence saying what this line costs, in the future tense it
 * actually happens in. `spared` has the same reason as `segmentsOf`'s.
 */
export function consequenceOf(diff: ReviewDiff, spared: boolean): string {
	switch (diff.kind) {
		case 'unchanged':
			return m.diff_review_consequence_unchanged();
		case 'extended':
			return m.diff_review_consequence_extended({ n: (diff.sans?.length ?? 0) - diff.commonPlies });
		case 'truncated':
			return m.diff_review_consequence_truncated({ n: (diff.previousSans?.length ?? 0) - diff.commonPlies });
		case 'diverged':
			return m.diff_review_consequence_diverged({
				commonPlies: diff.commonPlies,
				moveNumber: Math.floor(diff.commonPlies / 2) + 1
			});
		case 'new':
			return diff.commonPlies > 0
				? m.diff_review_consequence_new_continued({ commonPlies: diff.commonPlies })
				: m.diff_review_consequence_new_fresh();
		case 'removed':
			return spared ? m.diff_review_consequence_removed_spared() : m.diff_review_consequence_removed();
	}
}

/**
 * The footer's one-sentence verdict: what this upload does, and what it
 * costs. `retiredCount`/`sparedCount` recompute `isSparedRemovedLine` per
 * diff rather than trusting a count carried in from the caller — the same
 * reason `moveIdsToRetire` does its own per-line check rather than accepting
 * a precomputed set: the two numbers must always add up to `counts.removed`,
 * and the only way to guarantee that is to derive both from the one
 * predicate, here, right before they're used.
 */
export function verdictOf(
	preview: Pick<ReviewPreview, 'diffs' | 'impact'>,
	keptChapters: ReadonlySet<string>,
	assignedStudentCount: number
): string {
	const { counts, demotedLineCount, affectedPlayerCount } = preview.impact;
	const changedCount = counts.extended + counts.truncated + counts.diverged;
	// Not `counts.removed`: a `removed` line in a chapter the coach kept is not
	// retired, so counting it here would promise a retirement the apply will
	// not perform.
	const retiredCount = preview.diffs.filter(
		(d) => d.kind === 'removed' && !isSparedRemovedLine(d, keptChapters)
	).length;
	const sparedCount = preview.diffs.filter((d) => isSparedRemovedLine(d, keptChapters)).length;

	const parts: string[] = [];
	if (counts.new > 0) parts.push(m.diff_review_verdict_add({ n: counts.new }));
	if (changedCount > 0) parts.push(m.diff_review_verdict_reshape({ n: changedCount }));
	if (retiredCount > 0) parts.push(m.diff_review_verdict_retire({ n: retiredCount }));
	if (sparedCount > 0) parts.push(m.diff_review_verdict_spared({ n: sparedCount }));
	if (parts.length === 0) {
		return m.diff_review_verdict_no_changes();
	}
	const shape =
		parts.length === 1
			? parts[0]
			: `${parts.slice(0, -1).join(', ')} ${m.diff_review_verdict_and()} ${parts[parts.length - 1]}`;
	const cost =
		demotedLineCount === 0
			? m.diff_review_cost_none()
			: `${m.diff_review_cost_demoted({
					demotedLineCount,
					affectedPlayerCount,
					assignedStudentCount
				})} ${m.diff_review_cost_students_suffix({ assignedStudentCount })}`;
	return m.diff_review_verdict_wrapper({ shape, cost });
}
