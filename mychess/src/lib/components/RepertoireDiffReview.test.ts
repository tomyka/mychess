// @vitest-environment jsdom
// mychess/src/lib/components/RepertoireDiffReview.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/svelte';
import RepertoireDiffReview, { type ReviewDiff, type ReviewPreview } from './RepertoireDiffReview.svelte';

afterEach(() => cleanup());

function diff(overrides: Partial<ReviewDiff>): ReviewDiff {
	return {
		kind: 'unchanged',
		existingKey: 'k',
		sans: null,
		previousSans: null,
		commonPlies: 0,
		chapterNames: [],
		...overrides
	};
}

function preview(overrides: Partial<ReviewPreview>): ReviewPreview {
	return {
		diffs: [],
		renames: [],
		impact: {
			counts: { unchanged: 0, extended: 0, truncated: 0, diverged: 0, new: 0, removed: 0 },
			demotedLineCount: 0,
			removedLearnedCount: 0,
			affectedPlayerCount: 0
		},
		absentChapters: [],
		movesUpdatedAt: '2026-01-01T00:00:00Z',
		assignedStudentCount: 0,
		...overrides
	};
}

function renderReview(props: Partial<Parameters<typeof RepertoireDiffReview>[1]> = {}) {
	const ondecisions = vi.fn();
	render(RepertoireDiffReview, {
		props: {
			preview: preview({}),
			repertoireName: 'French Defense',
			fileName: 'french.pgn',
			assignedStudentCount: 5,
			submitting: false,
			cancelHref: '/coach/repertoires',
			ondecisions,
			...props
		}
	});
	return { ondecisions };
}

/** The per-line badge, scoped away from the summary chips (which always show
 * the raw, sparing-unaware kind counts) and the chapter rail. */
function lineBadge(text: string) {
	return screen.getByText(text, { selector: 'ul.max-h-\\[32rem\\] span' });
}

describe('RepertoireDiffReview - the Keep/Remove decision and isSparedRemovedLine', () => {
	// This is the exact predicate that used to be reimplemented separately here
	// (`isSpared`) from the one `moveIdsToRetire` applies server-side
	// (`repertoire-diff.ts`'s `isSparedRemovedLine`) - this suite is the first
	// coverage this component has ever had, and its whole point is to lock down
	// that the component's rendering agrees with the shared predicate rather
	// than a private copy of the same rule.

	function omittedPreview(chapterNames: string[], overrides: Partial<ReviewPreview> = {}) {
		const diffs = chapterNames.map((name, i) =>
			diff({ kind: 'removed', chapterNames: [name], previousSans: ['e4', 'c5'], existingKey: `k${i}` })
		);
		return preview({
			diffs,
			absentChapters: chapterNames,
			impact: {
				counts: { unchanged: 0, extended: 0, truncated: 0, diverged: 0, new: 0, removed: diffs.length },
				demotedLineCount: 0,
				removedLearnedCount: 0,
				affectedPlayerCount: 0
			},
			...overrides
		});
	}

	it('renders a removed line from an omitted chapter as Kept by default - Keep is the non-destructive default', () => {
		renderReview({ preview: omittedPreview(['Sicilian']) });
		expect(lineBadge('Kept')).toBeTruthy();
	});

	it('flips the same line to Removed the instant the coach chooses Remove for its chapter - no page reload needed', async () => {
		renderReview({ preview: omittedPreview(['Sicilian']) });
		expect(lineBadge('Kept')).toBeTruthy();

		await fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

		expect(lineBadge('Removed')).toBeTruthy();
	});

	it('does not spare a removed line whose chapter is NOT the one being removed, even with another removed chapter present', async () => {
		renderReview({ preview: omittedPreview(['Sicilian', 'Caro-Kann']) });

		// Remove only the Sicilian's row (chapters are listed in `absentChapters` order).
		await fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[0]);

		// Sicilian is the default-selected chapter (first in the rail).
		expect(lineBadge('Removed')).toBeTruthy();

		// Switch to Caro-Kann's chapter and confirm its line is still Kept.
		await fireEvent.click(screen.getByRole('button', { name: /Caro-Kann/ }));
		expect(lineBadge('Kept')).toBeTruthy();
	});

	it('reports the Keep decision upward via ondecisions, and Remove reports nothing kept', async () => {
		const { ondecisions } = renderReview({ preview: omittedPreview(['Sicilian']) });

		// Default is Keep (the non-destructive choice) - asserted via the initial call.
		expect(ondecisions).toHaveBeenCalledWith({ acceptedRenames: [], keptChapters: ['Sicilian'] });

		await fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
		expect(ondecisions).toHaveBeenLastCalledWith({ acceptedRenames: [], keptChapters: [] });
	});

	it("counts a kept chapter's line as spared, not retired, in the footer verdict", async () => {
		renderReview({ preview: omittedPreview(['Sicilian']) });

		// Default (Keep): nothing retired, one line left in place.
		expect(screen.getByText(/leave 1 line/i)).toBeTruthy();

		await fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
		expect(screen.getByText(/retire 1 line/i)).toBeTruthy();
	});
});

describe('RepertoireDiffReview - basic rendering', () => {
	it('shows the repertoire name, file name, and student count in the header', () => {
		renderReview({ repertoireName: 'Sicilian Najdorf', fileName: 'najdorf.pgn', assignedStudentCount: 12 });
		expect(screen.getByText('Sicilian Najdorf')).toBeTruthy();
		expect(screen.getByText('najdorf.pgn')).toBeTruthy();
		expect(screen.getAllByText('12', { exact: false }).length).toBeGreaterThan(0);
	});

	it('reports no changes when the preview has nothing in it', () => {
		renderReview();
		expect(screen.getByText(/matches the repertoire exactly/i)).toBeTruthy();
	});

	it('disables Apply while submitting', () => {
		renderReview({ submitting: true });
		expect((screen.getByRole('button', { name: /applying/i }) as HTMLButtonElement).disabled).toBe(true);
	});
});
