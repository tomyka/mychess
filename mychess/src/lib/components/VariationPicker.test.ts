// mychess/src/lib/components/VariationPicker.test.ts
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/svelte';
import VariationPicker from './VariationPicker.svelte';
import { UNTAGGED_CHAPTER } from '$lib/mastery/variations';

afterEach(() => {
	cleanup();
	// A few tests below patch this directly (jsdom doesn't implement it at
	// all) — undo it so it doesn't leak into unrelated tests/files sharing
	// this worker.
	delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
});

// Builds a realistic VariationStep[] with correctly alternating side-to-move
// and move-number FEN fields, so moveSequenceLabel's numbering (used for
// move-group bucket labels) is accurate.
function path(sans: string[]) {
	let moveNumber = 1;
	let whiteToMove = true;
	return sans.map((san, i) => {
		const fromFen = `x ${whiteToMove ? 'w' : 'b'} - - 0 ${moveNumber}`;
		if (!whiteToMove) moveNumber++;
		whiteToMove = !whiteToMove;
		return { moveId: `m${i}`, san, fromFen, toFen: 'x', isPlayerTurn: true };
	});
}

function row(
	variationKey: string,
	sans: string[],
	chapterNames: string[],
	opts: { included?: boolean; solved?: boolean; locked?: boolean; ceilingMoveCount?: number } = {}
) {
	const included = opts.included ?? true;
	const chapters = chapterNames.length > 0 ? chapterNames : [UNTAGGED_CHAPTER];
	const includedByChapter: Record<string, boolean> = {};
	for (const c of chapters) includedByChapter[c] = included;
	return {
		variationKey,
		label: `label:${variationKey}`, // stand-in for the server's own moveSequenceLabel(v.path) — irrelevant to grouping
		includedByChapter,
		chapterNames,
		path: path(sans),
		solved: opts.solved ?? false,
		locked: opts.locked ?? false,
		// Defaults to Infinity — no row is ever "past the ceiling" unless a test
		// explicitly opts in, so every EXISTING test in this file (none of which
		// pass this option) is completely unaffected by ceiling-frontier grouping.
		ceilingMoveCount: opts.ceilingMoveCount ?? Infinity
	};
}

// v1/v2 share their first 5 full moves (10 plies) before diverging on move
// 6 — the fixed grouping window used by the component (FIRST_MOVES_GROUP_PLIES
// = 10) buckets them together. v3 is a short, unrelated line in a different
// chapter, well under the window's length.
const variationsResponse = [
	row('v1', ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O', 'Be7', 'Re1'], ['Ruy Lopez']),
	row('v2', ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O', 'Be7', 'd3'], ['Ruy Lopez'], { solved: true }),
	row('v3', ['d4', 'd5', 'c4'], ['Italian Game'])
];

describe('VariationPicker', () => {
	it('loads and shows chapters as top-level groups', async () => {
		const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => variationsResponse });
		vi.stubGlobal('fetch', fetchSpy);
		render(VariationPicker, { props: { repertoireId: 'rep-1', onselect: vi.fn(), onclose: vi.fn() } });

		await waitFor(() => expect(screen.getByText('Ruy Lopez')).toBeTruthy());
		expect(screen.getByText('Italian Game')).toBeTruthy();
		expect(fetchSpy).toHaveBeenCalledWith('/api/repertoires/rep-1/variations');
	});

	it('drills into a chapter to show its first-5-moves bucket, then into that bucket to reach the leaf variations', async () => {
		const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => variationsResponse });
		vi.stubGlobal('fetch', fetchSpy);
		render(VariationPicker, { props: { repertoireId: 'rep-1', onselect: vi.fn(), onclose: vi.fn() } });

		await waitFor(() => screen.getByText('Ruy Lopez'));
		await fireEvent.click(screen.getByText('Ruy Lopez'));
		// v1 and v2 share their first 5 full moves — one bucket, not split.
		expect(screen.getByText(/1\.e4 e5 2\.Nf3 Nc6 3\.Bb5 a6 4\.Ba4 Nf6 5\.O-O Be7/)).toBeTruthy();
		expect(screen.queryByText('label:v1')).toBeNull();

		await fireEvent.click(screen.getByText(/1\.e4 e5 2\.Nf3 Nc6 3\.Bb5 a6 4\.Ba4 Nf6 5\.O-O Be7/));
		expect(screen.getByText('label:v1')).toBeTruthy();
		expect(screen.getByText('label:v2')).toBeTruthy();
	});

	it('marks an already-solved variation and still allows picking it', async () => {
		const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => variationsResponse });
		vi.stubGlobal('fetch', fetchSpy);
		const onselect = vi.fn();
		render(VariationPicker, { props: { repertoireId: 'rep-1', onselect, onclose: vi.fn() } });

		await waitFor(() => screen.getByText('Ruy Lopez'));
		await fireEvent.click(screen.getByText('Ruy Lopez'));
		await fireEvent.click(screen.getByText(/1\.e4 e5 2\.Nf3 Nc6 3\.Bb5 a6 4\.Ba4 Nf6 5\.O-O Be7/));

		const solvedRow = screen.getByText('label:v2').closest('button')!;
		expect(solvedRow.textContent).toContain('✓');
		await fireEvent.click(solvedRow);
		expect(onselect).toHaveBeenCalledWith('v2');
	});

	it('selecting a leaf variation calls onselect with its key', async () => {
		const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => variationsResponse });
		vi.stubGlobal('fetch', fetchSpy);
		const onselect = vi.fn();
		render(VariationPicker, { props: { repertoireId: 'rep-1', onselect, onclose: vi.fn() } });

		await waitFor(() => screen.getByText('Ruy Lopez'));
		await fireEvent.click(screen.getByText('Ruy Lopez'));
		await fireEvent.click(screen.getByText(/1\.e4 e5 2\.Nf3 Nc6 3\.Bb5 a6 4\.Ba4 Nf6 5\.O-O Be7/));
		await fireEvent.click(screen.getByText('label:v1'));
		expect(onselect).toHaveBeenCalledWith('v1');
	});

	it('the "Back" button returns from the bucket to the chapter list', async () => {
		const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => variationsResponse });
		vi.stubGlobal('fetch', fetchSpy);
		render(VariationPicker, { props: { repertoireId: 'rep-1', onselect: vi.fn(), onclose: vi.fn() } });

		await waitFor(() => screen.getByText('Ruy Lopez'));
		await fireEvent.click(screen.getByText('Ruy Lopez'));
		await fireEvent.click(screen.getByText(/1\.e4 e5 2\.Nf3 Nc6 3\.Bb5 a6 4\.Ba4 Nf6 5\.O-O Be7/));
		await waitFor(() => screen.getByText('label:v1'));

		await fireEvent.click(screen.getByText('← Back'));
		expect(screen.queryByText('label:v1')).toBeNull();
		expect(screen.getByText(/1\.e4 e5 2\.Nf3 Nc6 3\.Bb5 a6 4\.Ba4 Nf6 5\.O-O Be7/)).toBeTruthy();

		await fireEvent.click(screen.getByText('← Back'));
		expect(screen.getByText('Ruy Lopez')).toBeTruthy();
		expect(screen.getByText('Italian Game')).toBeTruthy();
	});

	it('skips the chapter level entirely when no variation carries a chapter, still bucketing by the first-5-moves window', async () => {
		// v1/v1b share the whole 10-ply window, so they bucket together and that
		// bucket is shown by its shared move sequence. v2 is alone in its own
		// bucket, so it renders as the variation it effectively is.
		const flat = [
			row('v1', ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O', 'Be7', 'Re1'], []),
			row('v1b', ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O', 'Be7', 'd3'], []),
			row('v2', ['d4', 'd5'], [])
		];
		const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => flat });
		vi.stubGlobal('fetch', fetchSpy);
		render(VariationPicker, { props: { repertoireId: 'rep-1', onselect: vi.fn(), onclose: vi.fn() } });

		await waitFor(() => expect(screen.getByText(/1\.e4 e5 2\.Nf3 Nc6 3\.Bb5 a6 4\.Ba4 Nf6 5\.O-O Be7/)).toBeTruthy());
		expect(screen.getByText('(2)')).toBeTruthy(); // the shared bucket still groups by the window
		expect(screen.getByText('label:v2')).toBeTruthy(); // bucket of one -> shown as its own line
		expect(screen.queryByText('(chapter)', { exact: false })).toBeNull();
	});

	it('a bucket holding a single line selects it directly instead of drilling into a list of one', async () => {
		// A bucket's button is labelled with its shared opening moves, so a bucket
		// of one already reads as a variation — drilling in only ever showed one
		// row with a near-identical label, which felt like a pointless second
		// popup of the same information.
		const single = [row('v1', ['e4', 'e5', 'Nf3'], ['Ruy Lopez'], { solved: true })];
		const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => single });
		vi.stubGlobal('fetch', fetchSpy);
		const onselect = vi.fn();
		render(VariationPicker, { props: { repertoireId: 'rep-1', onselect, onclose: vi.fn() } });

		await waitFor(() => screen.getByText('Ruy Lopez'));
		await fireEvent.click(screen.getByText('Ruy Lopez'));

		// Rendered like a variation row: its own full label, its solved tick, and
		// no "(1)" count — not like a folder.
		const soleRow = screen.getByText('label:v1').closest('button')!;
		expect(soleRow.textContent).toContain('✓');
		expect(soleRow.getAttribute('title')).toBe('Already learned');
		expect(soleRow.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('Already learned');
		expect(screen.queryByText('(1)')).toBeNull();

		// One click straight into practice — no intermediate tier.
		await fireEvent.click(soleRow);
		expect(onselect).toHaveBeenCalledWith('v1');
	});

	it('shows a line belonging to two chapters under BOTH of them, selectable from either', async () => {
		// One entry carrying two chapter names (a shared tabiya cross-referenced
		// by two chapter headings) — not two entries sharing one variationKey.
		const shared = [
			row('v1', ['e4', 'e5', 'Nf3'], ['Ruy Lopez', 'Italian Game']),
			row('v2', ['d4', 'd5', 'c4'], ['Italian Game'])
		];
		const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => shared });
		vi.stubGlobal('fetch', fetchSpy);
		const onselect = vi.fn();
		render(VariationPicker, { props: { repertoireId: 'rep-1', onselect, onclose: vi.fn() } });

		// v1 is alone in its bucket under each chapter, so it's one click from the
		// chapter list to practice — no bucket tier in between.
		await waitFor(() => screen.getByText('Ruy Lopez'));
		await fireEvent.click(screen.getByText('Ruy Lopez'));
		expect(screen.getByText('label:v1')).toBeTruthy();
		await fireEvent.click(screen.getByText('label:v1'));
		expect(onselect).toHaveBeenCalledWith('v1');

		// Back out to the chapter list and reach the same line via the other chapter.
		await fireEvent.click(screen.getByText('← Back'));
		await fireEvent.click(screen.getByText('Italian Game'));
		expect(screen.getByText('label:v1')).toBeTruthy();
	});

	it('offers untagged lines in their own bucket, listed last, in an otherwise-chaptered repertoire', async () => {
		const mixed = [
			row('v1', ['e4', 'e5', 'Nf3'], ['Ruy Lopez']),
			row('v2', ['d4', 'd5'], []) // untagged — would match no chapter without the bucket
		];
		const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => mixed });
		vi.stubGlobal('fetch', fetchSpy);
		const onselect = vi.fn();
		render(VariationPicker, { props: { repertoireId: 'rep-1', onselect, onclose: vi.fn() } });

		await waitFor(() => screen.getByText('Ruy Lopez'));
		const tiers = screen.getAllByRole('button').map((b) => b.textContent?.trim());
		expect(tiers).toEqual(['✕', 'Ruy Lopez', UNTAGGED_CHAPTER]); // untagged bucket last

		await fireEvent.click(screen.getByText(UNTAGGED_CHAPTER));
		await fireEvent.click(screen.getByText('label:v2')); // sole line in its bucket — selects directly
		expect(onselect).toHaveBeenCalledWith('v2');
	});

	it('shows no untagged bucket when every line is chaptered', async () => {
		const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => variationsResponse });
		vi.stubGlobal('fetch', fetchSpy);
		render(VariationPicker, { props: { repertoireId: 'rep-1', onselect: vi.fn(), onclose: vi.fn() } });

		await waitFor(() => screen.getByText('Ruy Lopez'));
		expect(screen.queryByText(UNTAGGED_CHAPTER)).toBeNull();
	});

	it('calls onclose when the close button is clicked', async () => {
		const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => variationsResponse });
		vi.stubGlobal('fetch', fetchSpy);
		const onclose = vi.fn();
		render(VariationPicker, { props: { repertoireId: 'rep-1', onselect: vi.fn(), onclose } });

		await waitFor(() => screen.getByText('Ruy Lopez'));
		await fireEvent.click(screen.getByLabelText('Close'));
		expect(onclose).toHaveBeenCalled();
	});

	describe('inline variant (GitHub issue #93)', () => {
		it('renders no backdrop or close button', async () => {
			const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => variationsResponse });
			vi.stubGlobal('fetch', fetchSpy);
			render(VariationPicker, { props: { repertoireId: 'rep-1', onselect: vi.fn(), variant: 'inline' } });

			await waitFor(() => screen.getByText('Ruy Lopez'));
			expect(screen.queryByLabelText('Close')).toBeNull();
		});

		it('auto-opens straight to the chapter and bucket holding the current variation', async () => {
			const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => variationsResponse });
			vi.stubGlobal('fetch', fetchSpy);
			render(VariationPicker, {
				props: { repertoireId: 'rep-1', onselect: vi.fn(), variant: 'inline', currentVariationKey: 'v3' }
			});

			// v3 is alone in its bucket under Italian Game, so it surfaces
			// directly — no chapter list, no bucket drill-down needed.
			await waitFor(() => expect(screen.getByText('label:v3')).toBeTruthy());
		});

		it('highlights the active variation row', async () => {
			const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => variationsResponse });
			vi.stubGlobal('fetch', fetchSpy);
			render(VariationPicker, {
				props: { repertoireId: 'rep-1', onselect: vi.fn(), variant: 'inline', currentVariationKey: 'v3' }
			});

			await waitFor(() => screen.getByText('label:v3'));
			const activeButton = screen.getByText('label:v3').closest('button')!;
			expect(activeButton.className).toContain('ring-2');
		});

		it('scrolls the active variation row into view when it renders directly as a sole regular group (GitHub issue #174 — active row buried below other groups)', async () => {
			// jsdom doesn't implement scrollIntoView at all — stand one in so the
			// action (`scrollIntoViewIfActive`) has something to call.
			const scrollIntoView = vi.fn();
			HTMLElement.prototype.scrollIntoView = scrollIntoView;
			const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => variationsResponse });
			vi.stubGlobal('fetch', fetchSpy);
			render(VariationPicker, {
				props: { repertoireId: 'rep-1', onselect: vi.fn(), variant: 'inline', currentVariationKey: 'v3' }
			});

			await waitFor(() => screen.getByText('label:v3'));
			expect(scrollIntoView).toHaveBeenCalled();
		});

		it('re-scrolls when the active variation moves to a different, already-mounted row in the same open group (no remount)', async () => {
			// v1/v2 share their first 10 plies (groupByFirstMoves's own window)
			// and diverge only after it, so both land in ONE regular group that
			// requires drilling in — both rows mount together, and neither
			// row's own DOM node is destroyed when the active one changes from
			// one to the other. A mount-only action (no `update`) would only
			// ever scroll the FIRST of the two to become active, never the
			// second — exactly the gap this test guards against.
			const scrollIntoView = vi.fn();
			HTMLElement.prototype.scrollIntoView = scrollIntoView;
			const shared = ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O', 'Be7'];
			const rows = [row('v1', [...shared, 'Re1'], ['Ruy Lopez']), row('v2', [...shared, 'd3'], ['Ruy Lopez'])];
			const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => rows });
			vi.stubGlobal('fetch', fetchSpy);
			const { rerender } = render(VariationPicker, {
				props: { repertoireId: 'rep-1', onselect: vi.fn(), variant: 'inline', currentVariationKey: 'v1' }
			});

			await waitFor(() => screen.getByText('label:v1'));
			screen.getByText('label:v2'); // both rows already mounted side by side
			expect(scrollIntoView).toHaveBeenCalledTimes(1);

			await rerender({ repertoireId: 'rep-1', onselect: vi.fn(), variant: 'inline', currentVariationKey: 'v2' });

			await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(2));
		});

		it('auto-opens to a ceiling group holding the current variation, rendering it directly without drill-in', async () => {
			// Two variations sharing prefix past the ceiling — they land in one
			// ceiling-clipped group together.
			const scrollIntoView = vi.fn();
			HTMLElement.prototype.scrollIntoView = scrollIntoView;
			const rows = [
				row('v1', ['e4', 'e5', 'Nf3', 'a6', 'Ba4'], ['Ruy Lopez'], { ceilingMoveCount: 3 }),
				row('v2', ['e4', 'e5', 'Nf3', 'O-O', 'd3'], ['Ruy Lopez'], { ceilingMoveCount: 3 })
			];
			const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => rows });
			vi.stubGlobal('fetch', fetchSpy);
			render(VariationPicker, {
				props: { repertoireId: 'rep-1', onselect: vi.fn(), variant: 'inline', currentVariationKey: 'v1' }
			});

			// The ceiling group is truncated to the shared prefix past the ceiling
			// (first 3 plies: 1.e4 e5 2.Nf3) and surfaces directly in the inline picker,
			// not nested behind a drill-in.
			await waitFor(() => expect(screen.getByText(/1\.e4 e5 2\.Nf3/)).toBeTruthy());

			// Verify it's highlighted as active (contains ring-2 class)
			const ceilingButton = screen.getByText(/1\.e4 e5 2\.Nf3/).closest('button')!;
			expect(ceilingButton.className).toContain('ring-2');
			expect(scrollIntoView).toHaveBeenCalled();

			// Verify no drill-in happened: the leaf variations are not visible
			// (they only appear when openGroup is set, i.e., when drilling into a regular group)
			expect(screen.queryByText('label:v1')).toBeNull();
			expect(screen.queryByText('label:v2')).toBeNull();
		});

		it('shows a per-chapter completion indicator', async () => {
			const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => variationsResponse });
			vi.stubGlobal('fetch', fetchSpy);
			render(VariationPicker, { props: { repertoireId: 'rep-1', onselect: vi.fn(), variant: 'inline' } });

			// v1 unsolved, v2 solved — Ruy Lopez reads 1/2; Italian Game (v3,
			// unsolved) reads 0/1. Modal mode never shows this text at all
			// (see the modal-mode chapter-list test above).
			await waitFor(() => expect(screen.getByText('1/2')).toBeTruthy());
			expect(screen.getByText('0/1')).toBeTruthy();
		});

		it('shows a checkmark instead of a fraction once a chapter is fully solved', async () => {
			const allSolved = [
				row('v1', ['e4', 'e5', 'Nf3'], ['Ruy Lopez'], { solved: true }),
				row('v2', ['d4', 'd5'], ['Italian Game'])
			];
			const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => allSolved });
			vi.stubGlobal('fetch', fetchSpy);
			render(VariationPicker, { props: { repertoireId: 'rep-1', onselect: vi.fn(), variant: 'inline' } });

			await waitFor(() => screen.getByText('Ruy Lopez'));
			const ruyButton = screen.getByText('Ruy Lopez').closest('button')!;
			expect(ruyButton.textContent).toContain('✓');
			expect(ruyButton.textContent).not.toContain('/');
		});

		it('does not auto-open a second time after the player navigates away, even though currentVariationKey is unchanged', async () => {
			const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => variationsResponse });
			vi.stubGlobal('fetch', fetchSpy);
			render(VariationPicker, {
				props: { repertoireId: 'rep-1', onselect: vi.fn(), variant: 'inline', currentVariationKey: 'v3' }
			});

			await waitFor(() => screen.getByText('label:v3'));
			// Back out to the chapter list manually.
			await fireEvent.click(screen.getByText('← Back'));
			expect(screen.getByText('Ruy Lopez')).toBeTruthy();
			expect(screen.queryByText('label:v3')).toBeNull();
		});
	});

	it('hides excluded variations entirely, so only the one remaining variation can be picked', async () => {
		const mixed = [
			row('v1', ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O', 'Be7', 'Re1'], ['Ruy Lopez']),
			row('v2', ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O', 'Be7', 'd3'], ['Ruy Lopez'], { included: false })
		];
		const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => mixed });
		vi.stubGlobal('fetch', fetchSpy);
		render(VariationPicker, { props: { repertoireId: 'rep-1', onselect: vi.fn(), onclose: vi.fn() } });

		await waitFor(() => screen.getByText('Ruy Lopez'));
		await fireEvent.click(screen.getByText('Ruy Lopez'));

		// Excluding v2 leaves v1 alone in the bucket, so it surfaces directly
		// rather than behind a drill-in — and v2 is nowhere to be found.
		expect(screen.getByText('label:v1')).toBeTruthy();
		expect(screen.queryByText('label:v2')).toBeNull();
	});

	describe('locked variations (GitHub issue #163)', () => {
		it('renders a locked leaf row disabled, with the reason text, and does not select it when clicked', async () => {
			const mixed = [
				row('v1', ['e4', 'e5', 'Nf3'], ['Ruy Lopez'], { locked: true }),
				row('v2', ['d4', 'd5', 'c4'], ['Italian Game'])
			];
			const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => mixed });
			vi.stubGlobal('fetch', fetchSpy);
			const onselect = vi.fn();
			// A distinct mock for the chapter-click auto-select (GitHub issue
			// #170) isolates it from `onselect`, which this test uses only to
			// verify clicking the LEAF row itself does nothing.
			render(VariationPicker, { props: { repertoireId: 'rep-1', onselect, onselectchapter: vi.fn(), onclose: vi.fn() } });

			await waitFor(() => screen.getByText('Ruy Lopez'));
			await fireEvent.click(screen.getByText('Ruy Lopez'));

			const lockedRow = screen.getByText('label:v1').closest('button')!;
			// The reason is a corner icon + tooltip now, not inline text (GitHub
			// issue #173 — inline reason text broke the layout when a row's own
			// label wrapped several lines).
			expect(lockedRow.textContent).toContain('🔒');
			expect(lockedRow.getAttribute('title')).toBe('Finish your current level first');
			// The icon carries its own accessible name (role="img" + aria-label),
			// not aria-hidden — otherwise the lock status is announced to no one,
			// a regression from when it was plain visible text.
			expect(lockedRow.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('Finish your current level first');
			expect(lockedRow).toBeDisabled();
			await fireEvent.click(lockedRow);
			expect(onselect).not.toHaveBeenCalled();
		});

		it('shows a one-line legend explaining the lock/learned icons above the leaf-row list', async () => {
			const rows = [row('v1', ['e4', 'e5', 'Nf3'], ['Ruy Lopez'], { locked: true })];
			vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => rows }));
			render(VariationPicker, { props: { repertoireId: 'rep-1', onselect: vi.fn(), onclose: vi.fn() } });

			await waitFor(() => screen.getByText('Ruy Lopez'));
			await fireEvent.click(screen.getByText('Ruy Lopez'));

			expect(screen.getByText('🔒 locked · ✓ learned')).toBeTruthy();
		});

		it("a mixed bucket (one locked, one not) stays enterable, and shows each row's own lock state", async () => {
			const mixed = [
				row('v1', ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O', 'Be7', 'Re1'], ['Ruy Lopez'], { locked: true }),
				row('v2', ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O', 'Be7', 'd3'], ['Ruy Lopez'])
			];
			const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => mixed });
			vi.stubGlobal('fetch', fetchSpy);
			const onselect = vi.fn();
			render(VariationPicker, { props: { repertoireId: 'rep-1', onselect, onclose: vi.fn() } });

			await waitFor(() => screen.getByText('Ruy Lopez'));
			await fireEvent.click(screen.getByText('Ruy Lopez'));
			// v1/v2 share their first 5 moves -> one bucket, still enterable despite v1 being locked.
			await fireEvent.click(screen.getByText(/1\.e4 e5 2\.Nf3 Nc6 3\.Bb5 a6 4\.Ba4 Nf6 5\.O-O Be7/));
			expect(screen.getByText('label:v1').closest('button')).toBeDisabled();
			await fireEvent.click(screen.getByText('label:v2'));
			expect(onselect).toHaveBeenCalledWith('v2');
		});

		it('a locked bucket-of-one renders as a locked LEAF row, not an auto-selecting folder', async () => {
			const single = [row('v1', ['e4', 'e5', 'Nf3'], ['Ruy Lopez'], { locked: true })];
			const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => single });
			vi.stubGlobal('fetch', fetchSpy);
			const onselect = vi.fn();
			// A distinct mock for the chapter-click auto-select (GitHub issue
			// #170) isolates it from `onselect`, which this test uses only to
			// verify clicking the LEAF row itself does nothing.
			render(VariationPicker, { props: { repertoireId: 'rep-1', onselect, onselectchapter: vi.fn(), onclose: vi.fn() } });

			await waitFor(() => screen.getByText('Ruy Lopez'));
			await fireEvent.click(screen.getByText('Ruy Lopez'));
			const soleRow = screen.getByText('label:v1').closest('button')!;
			expect(soleRow).toBeDisabled();
			await fireEvent.click(soleRow);
			expect(onselect).not.toHaveBeenCalled();
		});
	});

	describe('ceiling-frontier grouping (GitHub issue #165)', () => {
		it('groups variations that share their opening past the ceiling into one clickable entry', async () => {
			const rows = [
				row('v1', ['e4', 'e5', 'Nf3', 'a6', 'Ba4'], ['Ruy Lopez'], { ceilingMoveCount: 3 }),
				row('v2', ['e4', 'e5', 'Nf3', 'O-O', 'd3'], ['Ruy Lopez'], { ceilingMoveCount: 3 })
			];
			const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => rows });
			vi.stubGlobal('fetch', fetchSpy);
			const onselect = vi.fn();
			// A distinct mock for the chapter-click auto-select (GitHub issue
			// #170) isolates it from `onselect`, which this test uses only to
			// verify clicking the GROUP itself.
			render(VariationPicker, { props: { repertoireId: 'rep-1', onselect, onselectchapter: vi.fn(), onclose: vi.fn() } });

			await waitFor(() => screen.getByText('Ruy Lopez'));
			await fireEvent.click(screen.getByText('Ruy Lopez'));

			// Truncated to the shared first 3 plies — the diverging 4th/5th moves
			// (a6/Ba4 vs O-O/d3) are never shown.
			const groupButton = screen.getByText('1.e4 e5 2.Nf3').closest('button')!;
			expect(groupButton.textContent).toContain('(2)');
			expect(screen.queryByText('label:v1')).toBeNull();
			expect(screen.queryByText('label:v2')).toBeNull();

			await fireEvent.click(groupButton);
			expect(onselect).toHaveBeenCalledTimes(1);
			expect(['v1', 'v2']).toContain(onselect.mock.calls[0][0]);
		});

		it('shows a fully-paused ceiling group as done and disabled, without requiring a visit to each member', async () => {
			const rows = [
				row('v1', ['e4', 'e5', 'Nf3', 'a6', 'Ba4'], ['Ruy Lopez'], { ceilingMoveCount: 3, locked: true }),
				row('v2', ['e4', 'e5', 'Nf3', 'O-O', 'd3'], ['Ruy Lopez'], { ceilingMoveCount: 3, locked: true })
			];
			const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => rows });
			vi.stubGlobal('fetch', fetchSpy);
			const onselect = vi.fn();
			// A distinct mock for the chapter-click auto-select (GitHub issue
			// #170) isolates it from `onselect`, which this test uses only to
			// verify clicking the (disabled) GROUP itself does nothing.
			render(VariationPicker, { props: { repertoireId: 'rep-1', onselect, onselectchapter: vi.fn(), onclose: vi.fn() } });

			await waitFor(() => screen.getByText('Ruy Lopez'));
			await fireEvent.click(screen.getByText('Ruy Lopez'));

			const groupButton = screen.getByText('1.e4 e5 2.Nf3').closest('button')!;
			expect(groupButton.textContent).toContain('🔒');
			expect(groupButton.getAttribute('title')).toBe('Finish your current level first');
			expect(groupButton).toBeDisabled();
			await fireEvent.click(groupButton);
			expect(onselect).not.toHaveBeenCalled();
		});

		it('keeps a ceiling group clickable and targets a not-yet-paused member when only some siblings are already paused', async () => {
			const rows = [
				row('v1', ['e4', 'e5', 'Nf3', 'a6', 'Ba4'], ['Ruy Lopez'], { ceilingMoveCount: 3, locked: true }),
				row('v2', ['e4', 'e5', 'Nf3', 'O-O', 'd3'], ['Ruy Lopez'], { ceilingMoveCount: 3, locked: false })
			];
			const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => rows });
			vi.stubGlobal('fetch', fetchSpy);
			const onselect = vi.fn();
			render(VariationPicker, { props: { repertoireId: 'rep-1', onselect, onclose: vi.fn() } });

			await waitFor(() => screen.getByText('Ruy Lopez'));
			await fireEvent.click(screen.getByText('Ruy Lopez'));

			const groupButton = screen.getByText('1.e4 e5 2.Nf3').closest('button')!;
			expect(groupButton).not.toBeDisabled();
			await fireEvent.click(groupButton);
			expect(onselect).toHaveBeenCalledWith('v2'); // the not-yet-paused member
		});

		it('does not group or truncate a variation whose own line never exceeds the ceiling', async () => {
			const rows = [row('v1', ['e4', 'e5'], ['Italian Game'], { ceilingMoveCount: 3 })];
			const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => rows });
			vi.stubGlobal('fetch', fetchSpy);
			render(VariationPicker, { props: { repertoireId: 'rep-1', onselect: vi.fn(), onclose: vi.fn() } });

			await waitFor(() => screen.getByText('Italian Game'));
			await fireEvent.click(screen.getByText('Italian Game'));
			// Short enough to fit entirely under the ceiling — rendered via the
			// existing regular grouping (its own full label), not swept into a
			// ceiling-clipped entry.
			expect(screen.getByText('label:v1')).toBeTruthy();
		});

		it('a solved variation is never treated as a frontier row, even if it is long', async () => {
			const rows = [row('v1', ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6'], ['Ruy Lopez'], { ceilingMoveCount: 3, solved: true })];
			const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => rows });
			vi.stubGlobal('fetch', fetchSpy);
			render(VariationPicker, { props: { repertoireId: 'rep-1', onselect: vi.fn(), onclose: vi.fn() } });

			await waitFor(() => screen.getByText('Ruy Lopez'));
			await fireEvent.click(screen.getByText('Ruy Lopez'));
			// Solved -> shown via the regular path with its own full label, not
			// truncated to the ceiling.
			expect(screen.getByText('label:v1')).toBeTruthy();
		});
	});

	describe('selecting a chapter (GitHub issue #170)', () => {
		it('picks the first unsolved-and-unlocked row in the chapter as the representative', async () => {
			const rows = [
				row('v1', ['e4', 'e5'], ['Ruy Lopez'], { solved: true }),
				row('v2', ['e4', 'c5'], ['Ruy Lopez'], { locked: true }),
				row('v3', ['e4', 'd6'], ['Ruy Lopez'])
			];
			const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => rows });
			vi.stubGlobal('fetch', fetchSpy);
			const onselect = vi.fn();
			render(VariationPicker, { props: { repertoireId: 'rep-1', onselect, onclose: vi.fn() } });

			await waitFor(() => screen.getByText('Ruy Lopez'));
			await fireEvent.click(screen.getByText('Ruy Lopez'));
			// v1 is solved and v2 is locked — v3 is the only one both unsolved
			// and unlocked, so it's the representative even though it's neither
			// first in the list nor the one clicked.
			expect(onselect).toHaveBeenCalledWith('v3');
		});

		it('falls back to the first unsolved row when every row is locked', async () => {
			const rows = [
				row('v1', ['e4', 'e5'], ['Ruy Lopez'], { locked: true }),
				row('v2', ['e4', 'c5'], ['Ruy Lopez'], { locked: true })
			];
			const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => rows });
			vi.stubGlobal('fetch', fetchSpy);
			const onselect = vi.fn();
			render(VariationPicker, { props: { repertoireId: 'rep-1', onselect, onclose: vi.fn() } });

			await waitFor(() => screen.getByText('Ruy Lopez'));
			await fireEvent.click(screen.getByText('Ruy Lopez'));
			expect(onselect).toHaveBeenCalledWith('v1');
		});

		it('falls back to the very first row when every row in the chapter is solved', async () => {
			const rows = [
				row('v1', ['e4', 'e5'], ['Ruy Lopez'], { solved: true }),
				row('v2', ['e4', 'c5'], ['Ruy Lopez'], { solved: true })
			];
			const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => rows });
			vi.stubGlobal('fetch', fetchSpy);
			const onselect = vi.fn();
			render(VariationPicker, { props: { repertoireId: 'rep-1', onselect, onclose: vi.fn() } });

			await waitFor(() => screen.getByText('Ruy Lopez'));
			await fireEvent.click(screen.getByText('Ruy Lopez'));
			expect(onselect).toHaveBeenCalledWith('v1');
		});

		it('calls a distinct onselectchapter callback instead of onselect when one is provided, and still opens the chapter', async () => {
			const rows = [row('v1', ['e4', 'e5'], ['Ruy Lopez']), row('v2', ['d4', 'd5'], ['Italian Game'])];
			const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => rows });
			vi.stubGlobal('fetch', fetchSpy);
			const onselect = vi.fn();
			const onselectchapter = vi.fn();
			render(VariationPicker, { props: { repertoireId: 'rep-1', onselect, onselectchapter, onclose: vi.fn() } });

			await waitFor(() => screen.getByText('Ruy Lopez'));
			await fireEvent.click(screen.getByText('Ruy Lopez'));

			expect(onselectchapter).toHaveBeenCalledWith('v1');
			expect(onselect).not.toHaveBeenCalled();
			// The chapter is also still opened/navigable — its lone variation
			// renders directly (bucket-of-one shortcut), so the player can
			// confirm or pick something else instead of the auto-picked one.
			expect(screen.getByText('label:v1')).toBeTruthy();
		});

		it('falls back to onselect when no onselectchapter is provided', async () => {
			const rows = [row('v1', ['e4', 'e5'], ['Ruy Lopez'])];
			const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => rows });
			vi.stubGlobal('fetch', fetchSpy);
			const onselect = vi.fn();
			render(VariationPicker, { props: { repertoireId: 'rep-1', onselect, onclose: vi.fn() } });

			await waitFor(() => screen.getByText('Ruy Lopez'));
			await fireEvent.click(screen.getByText('Ruy Lopez'));
			expect(onselect).toHaveBeenCalledWith('v1');
		});
	});
});
