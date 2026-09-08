// mychess/src/routes/(coach)/coach/repertoires/[repertoire_id]/chapters/chapters.test.ts
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/svelte';
import Page from './+page.svelte';

afterEach(cleanup);

const UNTAGGED = 'Lines without a chapter';

function renderWith(data: Record<string, unknown> = {}) {
	render(Page, {
		props: {
			data: {
				repertoire: { id: 'r1', name: 'Freeze the French', color: 'white', moves_updated_at: '2026-09-01T00:00:00Z' },
				assignedStudentCount: 4,
				untaggedChapterName: UNTAGGED,
				chapters: [
					{ name: 'Rare Moves #1', lineCount: 42, sharedLineCount: 0, progressLineCount: 12 },
					{ name: 'Model games', lineCount: 61, sharedLineCount: 9, progressLineCount: 11 },
					// All nine of its lines are the ones "Model games" reports as
					// shared. The original fixture gave this chapter 0 shared while
					// "Model games" claimed 9, which no real repertoire can produce:
					// sharing has two sides, so some other chapter has to account for
					// them (GitHub issue #185).
					{ name: 'Tactics warm-up', lineCount: 9, sharedLineCount: 9, progressLineCount: 0 }
				],
				// The same lines grouped by which chapters claim them, consistent
				// with the per-chapter figures above: 42 only in "Rare Moves #1",
				// 52 only in "Model games", and 9 in both "Model games" and
				// "Tactics warm-up".
				lineGroups: [
					{ chapters: ['Rare Moves #1'], lineCount: 42, progressLineCount: 12 },
					{ chapters: ['Model games'], lineCount: 52, progressLineCount: 11 },
					{ chapters: ['Model games', 'Tactics warm-up'], lineCount: 9, progressLineCount: 0 }
				],
				...data
			}
		}
	});
}

describe('coach chapter manager', () => {
	it('lists each chapter with its line count, marking shared lines', () => {
		renderWith();
		expect(screen.getByText('42 lines')).toBeTruthy();
		expect(screen.getByText('61 lines · 9 shared')).toBeTruthy();
	});

	it('labels the primary action as a REMOVAL, not an import', () => {
		renderWith();
		expect(screen.getByRole('button', { name: 'Remove 0 chapters' })).toBeTruthy();
	});

	it('disables removal until something is selected', async () => {
		renderWith();
		expect((screen.getByRole('button', { name: 'Remove 0 chapters' }) as HTMLButtonElement).disabled).toBe(true);
		await fireEvent.click(screen.getByRole('checkbox', { name: 'Select Rare Moves #1' }));
		expect((screen.getByRole('button', { name: 'Remove 1 chapter' }) as HTMLButtonElement).disabled).toBe(false);
	});

	it('refuses a selection covering every chapter', async () => {
		renderWith();
		await fireEvent.click(screen.getByRole('button', { name: 'Select all' }));
		expect((screen.getByRole('button', { name: 'Remove 3 chapters' }) as HTMLButtonElement).disabled).toBe(true);
		expect(screen.getByText('That would remove every chapter. Delete the repertoire itself instead.')).toBeTruthy();
	});

	it('renders the untagged bucket read-only, with an explanation', () => {
		renderWith({
			chapters: [
				{ name: 'Rare Moves #1', lineCount: 42, sharedLineCount: 0, progressLineCount: 0 },
				{ name: UNTAGGED, lineCount: 5, sharedLineCount: 0, progressLineCount: 0 }
			]
		});
		expect(screen.queryByRole('checkbox', { name: `Select ${UNTAGGED}` })).toBeNull();
		expect(
			screen.getByText("Not a chapter — these are the repertoire's untagged lines. Delete the repertoire itself instead.")
		).toBeTruthy();
	});

	it('sums the confirm dialog over the whole selection, once', async () => {
		renderWith();
		await fireEvent.click(screen.getByRole('checkbox', { name: 'Select Rare Moves #1' }));
		await fireEvent.click(screen.getByRole('checkbox', { name: 'Select Model games' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Remove 2 chapters' }));

		expect(screen.getByText('Remove 2 chapters?')).toBeTruthy();
		// 42 exclusive + (61 - 9) exclusive = 94; the 9 shared are reported separately.
		expect(screen.getByText('Retires 94 lines for all 4 assigned students.')).toBeTruthy();
		expect(screen.getByText('9 lines also belong to other chapters and will stay.')).toBeTruthy();
		expect(screen.getByText('23 of them carry student progress — kept, in case the chapter returns.')).toBeTruthy();
	});

	it('counts a shared line as REMOVED when every chapter claiming it is selected', async () => {
		// The nine lines "Model games" shares are shared with "Tactics warm-up"
		// and nothing else, so selecting both removes them: a line survives only
		// while some chapter that is staying still claims it. Summing each
		// chapter's exclusive lines misses them entirely — they are exclusive to
		// neither — and then reports them as lines that "will stay", which is the
		// opposite of what the removal does (GitHub issue #185).
		renderWith();
		await fireEvent.click(screen.getByRole('checkbox', { name: 'Select Model games' }));
		await fireEvent.click(screen.getByRole('checkbox', { name: 'Select Tactics warm-up' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Remove 2 chapters' }));

		// 52 exclusive to "Model games" + the 9 both selected chapters claim.
		expect(screen.getByText('Retires 61 lines for all 4 assigned students.')).toBeTruthy();
		// Nothing is left holding them, so there is no "will stay" sentence.
		expect(screen.queryByText(/will stay/)).toBeNull();
		expect(screen.getByText('11 of them carry student progress — kept, in case the chapter returns.')).toBeTruthy();
	});

	it('sends the selected chapter names and the shape they were computed against', async () => {
		renderWith();
		await fireEvent.click(screen.getByRole('checkbox', { name: 'Select Tactics warm-up' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Remove 1 chapter' }));

		const form = screen.getByRole('button', { name: 'Remove' }).closest('form')!;
		const values = Object.fromEntries(new FormData(form).entries());
		expect(values.chapters).toBe(JSON.stringify(['Tactics warm-up']));
		expect(values.movesUpdatedAt).toBe('2026-09-01T00:00:00Z');
	});

	it('says so for a repertoire with no chapters at all', () => {
		renderWith({ chapters: [] });
		expect(
			screen.getByText(
				'This repertoire has no chapters. Its lines were imported without chapter titles, so there is nothing to remove one at a time.'
			)
		).toBeTruthy();
		expect(screen.queryByRole('button', { name: /^Remove/ })).toBeNull();
	});
});
