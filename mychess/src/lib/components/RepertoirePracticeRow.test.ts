// @vitest-environment jsdom
// mychess/src/lib/components/RepertoirePracticeRow.test.ts
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/svelte';
import RepertoirePracticeRow from './RepertoirePracticeRow.svelte';

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

const baseRep = {
	id: 'rep-1',
	name: 'Ruy Lopez',
	color: 'white',
	solved: 12,
	total: 18,
	allSolved: false,
	fullVariationCount: 2,
	excludedVariationCount: 0,
	hasChapters: true
};

// Builds a realistic VariationStep[] with correctly alternating side-to-move
// and move-number FEN fields, so moveSequenceLabel's numbering (used for
// move-group bucket labels) is accurate for a slice starting at any ply.
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

function row(variationKey: string, sans: string[], chapterName: string | null, included = true) {
	return { variationKey, label: `label:${variationKey}`, included, chapterName, path: path(sans) };
}

// v1/v2 share their first 4 plies before forking on move 3 — one bucket to
// drill into, no chapter tag (the flat/chapterless case).
const variationsResponse = [row('v1', ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'], null), row('v2', ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'], null)];

// Same shared-prefix pair, now under a 'Ruy Lopez' chapter, plus a single
// unrelated line in its own 'Italian Game' chapter.
const chapterVariationsResponse = [
	row('v1', ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'], 'Ruy Lopez'),
	row('v2', ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'], 'Ruy Lopez'),
	row('v3', ['d4', 'd5', 'c4'], 'Italian Game')
];

// v1/v2 share only "e4" before forking (e5 vs c5); v3 forks immediately with
// a different first move (d4) and has no sibling, so it collapses straight
// to a leaf — used for sibling-isolation tests across a bucket and a leaf
// that sit side by side under the same chapter.
const siblingResponse = [
	row('v1', ['e4', 'e5'], 'Ruy Lopez'),
	row('v2', ['e4', 'c5'], 'Ruy Lopez'),
	row('v3', ['d4', 'd5'], 'Ruy Lopez')
];

describe('RepertoirePracticeRow', () => {
	it('renders collapsed by default, showing name and progress but no variations', () => {
		render(RepertoirePracticeRow, { props: { rep: baseRep } });
		expect(screen.getByText('Ruy Lopez')).toBeTruthy();
		expect(screen.queryByText('label:v1')).toBeNull();
	});

	it('shows the parent checkbox as checked when nothing is excluded', () => {
		render(RepertoirePracticeRow, { props: { rep: baseRep } });
		const checkbox = screen.getByRole('checkbox', { name: 'Include Ruy Lopez in practice' }) as HTMLInputElement;
		expect(checkbox.checked).toBe(true);
		expect(checkbox.indeterminate).toBe(false);
	});

	it('shows the parent checkbox as indeterminate when some variations are excluded', () => {
		render(RepertoirePracticeRow, { props: { rep: { ...baseRep, excludedVariationCount: 1 } } });
		const checkbox = screen.getByRole('checkbox', { name: 'Include Ruy Lopez in practice' }) as HTMLInputElement;
		expect(checkbox.indeterminate).toBe(true);
	});

	it('shows the parent checkbox as unchecked when every variation is excluded', () => {
		render(RepertoirePracticeRow, { props: { rep: { ...baseRep, excludedVariationCount: 2 } } });
		const checkbox = screen.getByRole('checkbox', { name: 'Include Ruy Lopez in practice' }) as HTMLInputElement;
		expect(checkbox.checked).toBe(false);
		expect(checkbox.indeterminate).toBe(false);
	});

	it('fetches variations when expanded, only once, showing a shared-prefix bucket rather than raw variations', async () => {
		const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => variationsResponse });
		vi.stubGlobal('fetch', fetchSpy);
		render(RepertoirePracticeRow, { props: { rep: baseRep } });

		await fireEvent.click(screen.getByLabelText('Expand Ruy Lopez'));
		await waitFor(() => expect(screen.getByText(/1\.e4 e5 2\.Nf3 Nc6/)).toBeTruthy());
		expect(fetchSpy).toHaveBeenCalledWith('/api/repertoires/rep-1/variations');
		expect(screen.queryByText('label:v1')).toBeNull(); // not shown until the bucket is drilled into

		await fireEvent.click(screen.getByLabelText('Collapse Ruy Lopez'));
		await fireEvent.click(screen.getByLabelText('Expand Ruy Lopez'));
		expect(fetchSpy).toHaveBeenCalledTimes(1); // cached after the first fetch
	});

	it('drilling into a shared-prefix bucket reveals its individual variations', async () => {
		const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => variationsResponse });
		vi.stubGlobal('fetch', fetchSpy);
		render(RepertoirePracticeRow, { props: { rep: baseRep } });

		await fireEvent.click(screen.getByLabelText('Expand Ruy Lopez'));
		await waitFor(() => screen.getByText(/1\.e4 e5 2\.Nf3 Nc6/));
		await fireEvent.click(screen.getByLabelText(/Expand 1\.e4 e5 2\.Nf3 Nc6 in Ruy Lopez/));

		expect(screen.getByText('label:v1')).toBeTruthy();
		expect(screen.getByText('label:v2')).toBeTruthy();
	});

	it('toggling one variation checkbox posts its own exclusion change', async () => {
		const fetchSpy = vi
			.fn()
			.mockResolvedValueOnce({ ok: true, json: async () => variationsResponse })
			.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) });
		vi.stubGlobal('fetch', fetchSpy);
		render(RepertoirePracticeRow, { props: { rep: baseRep } });

		await fireEvent.click(screen.getByLabelText('Expand Ruy Lopez'));
		await waitFor(() => screen.getByText(/1\.e4 e5 2\.Nf3 Nc6/));
		await fireEvent.click(screen.getByLabelText(/Expand 1\.e4 e5 2\.Nf3 Nc6 in Ruy Lopez/));
		await waitFor(() => screen.getByText('label:v1'));

		const variationCheckbox = within(screen.getByText('label:v1').closest('label')!).getByRole('checkbox') as HTMLInputElement;
		await fireEvent.click(variationCheckbox);

		await waitFor(() =>
			expect(fetchSpy).toHaveBeenCalledWith('/api/repertoires/rep-1/exclusions', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ variationKeys: ['v1'], included: false })
			})
		);
	});

	it('unchecking the parent excludes every variation, and re-checking restores the prior selection', async () => {
		const fetchSpy = vi
			.fn()
			.mockResolvedValueOnce({ ok: true, json: async () => variationsResponse }) // GET on expand
			.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }); // every POST after
		vi.stubGlobal('fetch', fetchSpy);
		render(RepertoirePracticeRow, { props: { rep: baseRep } });

		// Individually uncheck v2 first, so the "restore" below has something
		// meaningful to prove: it must restore v1 only, not both.
		await fireEvent.click(screen.getByLabelText('Expand Ruy Lopez'));
		await waitFor(() => screen.getByText(/1\.e4 e5 2\.Nf3 Nc6/));
		await fireEvent.click(screen.getByLabelText(/Expand 1\.e4 e5 2\.Nf3 Nc6 in Ruy Lopez/));
		await waitFor(() => screen.getByText('label:v2'));
		const v2Checkbox = within(screen.getByText('label:v2').closest('label')!).getByRole('checkbox') as HTMLInputElement;
		await fireEvent.click(v2Checkbox);
		await waitFor(() => expect(v2Checkbox.checked).toBe(false));

		const parentCheckbox = screen.getByRole('checkbox', { name: 'Include Ruy Lopez in practice' }) as HTMLInputElement;
		await fireEvent.click(parentCheckbox); // bulk uncheck (only v1 was still included)
		await waitFor(() =>
			expect(fetchSpy).toHaveBeenLastCalledWith('/api/repertoires/rep-1/exclusions', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ variationKeys: ['v1'], included: false })
			})
		);
		const v1Checkbox = within(screen.getByText('label:v1').closest('label')!).getByRole('checkbox') as HTMLInputElement;
		expect(v1Checkbox.checked).toBe(false);

		await fireEvent.click(parentCheckbox); // re-check — restores exactly v1, not v2
		await waitFor(() =>
			expect(fetchSpy).toHaveBeenLastCalledWith('/api/repertoires/rep-1/exclusions', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ variationKeys: ['v1'], included: true })
			})
		);
		expect(v1Checkbox.checked).toBe(true);
		expect(v2Checkbox.checked).toBe(false);
	});

	it('shows "No moves yet" when total is 0, even if fullVariationCount is not (every variation excluded)', () => {
		render(RepertoirePracticeRow, {
			props: { rep: { ...baseRep, total: 0, solved: 0, allSolved: true, excludedVariationCount: 2 } }
		});
		expect(screen.getByText('No moves yet')).toBeTruthy();
	});

	it('still shows the checkbox and expand control when every variation is excluded, so it can be undone', () => {
		render(RepertoirePracticeRow, {
			props: { rep: { ...baseRep, total: 0, solved: 0, allSolved: true, excludedVariationCount: 2 } }
		});
		expect(screen.getByRole('checkbox', { name: 'Include Ruy Lopez in practice' })).toBeTruthy();
		expect(screen.getByLabelText('Expand Ruy Lopez')).toBeTruthy();
	});

	it('hides the checkbox and expand control entirely for a genuinely empty repertoire (fullVariationCount 0)', () => {
		render(RepertoirePracticeRow, {
			props: { rep: { ...baseRep, total: 0, solved: 0, allSolved: true, fullVariationCount: 0, excludedVariationCount: 0 } }
		});
		expect(screen.queryByRole('checkbox', { name: 'Include Ruy Lopez in practice' })).toBeNull();
		expect(screen.queryByLabelText('Expand Ruy Lopez')).toBeNull();
	});

	it('shows solved/total progress in the subtitle', () => {
		render(RepertoirePracticeRow, { props: { rep: baseRep } });
		expect(screen.getByText('12/18 variations solved')).toBeTruthy();
	});

	it('shows a trophy badge when allSolved is true', () => {
		render(RepertoirePracticeRow, { props: { rep: { ...baseRep, allSolved: true, solved: 18 } } });
		expect(screen.getByText('🏆 Solved · 18/18')).toBeTruthy();
	});

	it('reverts the checkbox and shows an error when toggling a variation fails', async () => {
		const fetchSpy = vi
			.fn()
			.mockResolvedValueOnce({ ok: true, json: async () => variationsResponse })
			.mockResolvedValueOnce({ ok: false });
		vi.stubGlobal('fetch', fetchSpy);
		render(RepertoirePracticeRow, { props: { rep: baseRep } });

		await fireEvent.click(screen.getByLabelText('Expand Ruy Lopez'));
		await waitFor(() => screen.getByText(/1\.e4 e5 2\.Nf3 Nc6/));
		await fireEvent.click(screen.getByLabelText(/Expand 1\.e4 e5 2\.Nf3 Nc6 in Ruy Lopez/));
		await waitFor(() => screen.getByText('label:v1'));

		const variationCheckbox = within(screen.getByText('label:v1').closest('label')!).getByRole('checkbox') as HTMLInputElement;
		await fireEvent.click(variationCheckbox);

		await waitFor(() => expect(screen.getByText("Couldn't update that — try again.")).toBeTruthy());
		expect(variationCheckbox.checked).toBe(true); // reverted back to its original state
	});

	it('shows an error and no variations when the variations fetch fails', async () => {
		const fetchSpy = vi.fn().mockResolvedValue({ ok: false });
		vi.stubGlobal('fetch', fetchSpy);
		render(RepertoirePracticeRow, { props: { rep: baseRep } });

		await fireEvent.click(screen.getByLabelText('Expand Ruy Lopez'));
		await waitFor(() => expect(screen.getByText("Couldn't load variations — try again.")).toBeTruthy());
		expect(screen.queryByText('label:v1')).toBeNull();
	});

	it('groups variations under a chapter header, revealing neither buckets nor variations until drilled into', async () => {
		const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => chapterVariationsResponse });
		vi.stubGlobal('fetch', fetchSpy);
		render(RepertoirePracticeRow, { props: { rep: { ...baseRep, fullVariationCount: 3 } } });

		await fireEvent.click(screen.getByLabelText('Expand Ruy Lopez'));
		await waitFor(() => expect(screen.getByText('Ruy Lopez (chapter)')).toBeTruthy());
		expect(screen.getByText('Italian Game (chapter)')).toBeTruthy();
		expect(screen.queryByText('label:v1')).toBeNull();
		expect(screen.getByText('· 2 lines')).toBeTruthy();
		expect(screen.getByText('· 1 line')).toBeTruthy();
	});

	it('drilling into a chapter with only one variation collapses straight to that leaf, with no intermediate bucket', async () => {
		const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => chapterVariationsResponse });
		vi.stubGlobal('fetch', fetchSpy);
		render(RepertoirePracticeRow, { props: { rep: { ...baseRep, fullVariationCount: 3 } } });

		await fireEvent.click(screen.getByLabelText('Expand Ruy Lopez'));
		await waitFor(() => screen.getByText('Italian Game (chapter)'));
		await fireEvent.click(screen.getByLabelText('Expand Italian Game chapter'));

		expect(screen.getByText('label:v3')).toBeTruthy();
	});

	it('drilling into a chapter with a shared prefix reveals the bucket, then its variations one level deeper', async () => {
		const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => chapterVariationsResponse });
		vi.stubGlobal('fetch', fetchSpy);
		render(RepertoirePracticeRow, { props: { rep: { ...baseRep, fullVariationCount: 3 } } });

		await fireEvent.click(screen.getByLabelText('Expand Ruy Lopez'));
		await waitFor(() => screen.getByText('Ruy Lopez (chapter)'));

		await fireEvent.click(screen.getByLabelText('Expand Ruy Lopez chapter'));
		await waitFor(() => expect(screen.getByText(/1\.e4 e5 2\.Nf3 Nc6/)).toBeTruthy());
		expect(screen.queryByText('label:v1')).toBeNull(); // still one drill-down away

		await fireEvent.click(screen.getByLabelText(/Expand 1\.e4 e5 2\.Nf3 Nc6 in Ruy Lopez/));
		expect(screen.getByText('label:v1')).toBeTruthy();
		expect(screen.getByText('label:v2')).toBeTruthy();
	});

	it('renders a flat pool of buckets/leaves with no chapter header when no variation has a chapterName', async () => {
		const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => variationsResponse });
		vi.stubGlobal('fetch', fetchSpy);
		render(RepertoirePracticeRow, { props: { rep: baseRep } });

		await fireEvent.click(screen.getByLabelText('Expand Ruy Lopez'));
		await waitFor(() => expect(screen.getByText(/1\.e4 e5 2\.Nf3 Nc6/)).toBeTruthy());
		expect(screen.queryByText('(chapter)', { exact: false })).toBeNull();
	});

	it('shows a chapter checkbox as indeterminate when only some of its own variations are included, independent of a sibling chapter', async () => {
		const partial = chapterVariationsResponse.map((v) => (v.variationKey === 'v1' ? { ...v, included: false } : v));
		const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => partial });
		vi.stubGlobal('fetch', fetchSpy);
		render(RepertoirePracticeRow, { props: { rep: { ...baseRep, fullVariationCount: 3 } } });

		await fireEvent.click(screen.getByLabelText('Expand Ruy Lopez'));
		await waitFor(() => screen.getByText('Ruy Lopez (chapter)'));

		const ruyCheckbox = screen.getByRole('checkbox', { name: /Ruy Lopez \(chapter\)/ }) as HTMLInputElement;
		const italianCheckbox = screen.getByRole('checkbox', { name: /Italian Game \(chapter\)/ }) as HTMLInputElement;
		expect(ruyCheckbox.indeterminate).toBe(true); // v1 excluded, v2 included
		expect(italianCheckbox.checked).toBe(true); // v3 included, unaffected by Ruy Lopez's state
	});

	it("bulk-toggling a chapter checkbox only excludes that chapter's own variations", async () => {
		const fetchSpy = vi
			.fn()
			.mockResolvedValueOnce({ ok: true, json: async () => chapterVariationsResponse })
			.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
		vi.stubGlobal('fetch', fetchSpy);
		render(RepertoirePracticeRow, { props: { rep: { ...baseRep, fullVariationCount: 3 } } });

		await fireEvent.click(screen.getByLabelText('Expand Ruy Lopez'));
		await waitFor(() => screen.getByText('Ruy Lopez (chapter)'));

		const ruyCheckbox = screen.getByRole('checkbox', { name: /Ruy Lopez \(chapter\)/ }) as HTMLInputElement;
		await fireEvent.click(ruyCheckbox);

		await waitFor(() =>
			expect(fetchSpy).toHaveBeenLastCalledWith('/api/repertoires/rep-1/exclusions', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ variationKeys: ['v1', 'v2'], included: false }) // NOT v3
			})
		);
		const italianCheckbox = screen.getByRole('checkbox', { name: /Italian Game \(chapter\)/ }) as HTMLInputElement;
		expect(italianCheckbox.checked).toBe(true); // untouched by Ruy Lopez's bulk-exclude

		await fireEvent.click(ruyCheckbox); // re-check — restores exactly v1 + v2
		await waitFor(() =>
			expect(fetchSpy).toHaveBeenLastCalledWith('/api/repertoires/rep-1/exclusions', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ variationKeys: ['v1', 'v2'], included: true })
			})
		);
	});

	it("bulk-toggling a move-group bucket checkbox only excludes that bucket's own variations, leaving a sibling leaf untouched", async () => {
		const fetchSpy = vi
			.fn()
			.mockResolvedValueOnce({ ok: true, json: async () => siblingResponse })
			.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
		vi.stubGlobal('fetch', fetchSpy);
		render(RepertoirePracticeRow, { props: { rep: { ...baseRep, fullVariationCount: 3 } } });

		await fireEvent.click(screen.getByLabelText('Expand Ruy Lopez'));
		await waitFor(() => screen.getByText('Ruy Lopez (chapter)'));
		await fireEvent.click(screen.getByLabelText('Expand Ruy Lopez chapter'));
		// v1/v2 (sharing "e4") form a bucket; v3 (d4, no sibling) is a leaf
		// sitting right alongside it.
		await waitFor(() => expect(screen.getByLabelText('Include 1.e4 in Ruy Lopez in practice')).toBeTruthy());
		expect(screen.getByText('label:v3')).toBeTruthy();

		const bucketCheckbox = screen.getByRole('checkbox', { name: 'Include 1.e4 in Ruy Lopez in practice' }) as HTMLInputElement;
		expect(bucketCheckbox.checked).toBe(true);
		await fireEvent.click(bucketCheckbox);

		await waitFor(() =>
			expect(fetchSpy).toHaveBeenLastCalledWith('/api/repertoires/rep-1/exclusions', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ variationKeys: ['v1', 'v2'], included: false })
			})
		);
		const v3Checkbox = within(screen.getByText('label:v3').closest('label')!).getByRole('checkbox') as HTMLInputElement;
		expect(v3Checkbox.checked).toBe(true); // a sibling leaf outside the bucket, unaffected
	});

	it("re-checking a chapter after one of its buckets was already independently excluded restores only what the chapter's own exclusion touched", async () => {
		const fetchSpy = vi
			.fn()
			.mockResolvedValueOnce({ ok: true, json: async () => siblingResponse })
			.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
		vi.stubGlobal('fetch', fetchSpy);
		render(RepertoirePracticeRow, { props: { rep: { ...baseRep, fullVariationCount: 3 } } });

		await fireEvent.click(screen.getByLabelText('Expand Ruy Lopez'));
		await waitFor(() => screen.getByText('Ruy Lopez (chapter)'));
		await fireEvent.click(screen.getByLabelText('Expand Ruy Lopez chapter'));
		await waitFor(() => screen.getByLabelText('Include 1.e4 in Ruy Lopez in practice'));

		// Step 1: independently bulk-exclude the "1.e4" bucket (v1, v2).
		const bucketCheckbox = screen.getByRole('checkbox', { name: 'Include 1.e4 in Ruy Lopez in practice' }) as HTMLInputElement;
		await fireEvent.click(bucketCheckbox);
		await waitFor(() =>
			expect(fetchSpy).toHaveBeenLastCalledWith('/api/repertoires/rep-1/exclusions', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ variationKeys: ['v1', 'v2'], included: false })
			})
		);

		// Step 2: the chapter is now indeterminate (v3 still included). Bulk-
		// exclude the whole chapter — its own snapshot should capture only
		// v3, the one row still included at this moment.
		const chapterCheckbox = screen.getByRole('checkbox', { name: /Ruy Lopez \(chapter\)/ }) as HTMLInputElement;
		expect(chapterCheckbox.indeterminate).toBe(true);
		await fireEvent.click(chapterCheckbox);
		await waitFor(() =>
			expect(fetchSpy).toHaveBeenLastCalledWith('/api/repertoires/rep-1/exclusions', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ variationKeys: ['v3'], included: false })
			})
		);

		// Step 3: re-checking the chapter restores exactly v3 — NOT v1/v2,
		// which were excluded independently before the chapter-level
		// snapshot was ever taken.
		await fireEvent.click(chapterCheckbox);
		await waitFor(() =>
			expect(fetchSpy).toHaveBeenLastCalledWith('/api/repertoires/rep-1/exclusions', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ variationKeys: ['v3'], included: true })
			})
		);
		expect(bucketCheckbox.checked).toBe(false); // still excluded, untouched by the chapter's restore
	});

	it('drilling into a move-group bucket within a chapter reveals its individual variations with their own checkboxes', async () => {
		const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => siblingResponse });
		vi.stubGlobal('fetch', fetchSpy);
		render(RepertoirePracticeRow, { props: { rep: { ...baseRep, fullVariationCount: 3 } } });

		await fireEvent.click(screen.getByLabelText('Expand Ruy Lopez'));
		await waitFor(() => screen.getByText('Ruy Lopez (chapter)'));
		await fireEvent.click(screen.getByLabelText('Expand Ruy Lopez chapter'));
		await waitFor(() => screen.getByLabelText('Include 1.e4 in Ruy Lopez in practice'));

		await fireEvent.click(screen.getByLabelText('Expand 1.e4 in Ruy Lopez'));
		expect(screen.getByText('label:v1')).toBeTruthy();
		expect(screen.getByText('label:v2')).toBeTruthy();
	});

	it('shows the checkbox and expand control even when the repertoire has no chapters, as long as it has variations', () => {
		render(RepertoirePracticeRow, { props: { rep: { ...baseRep, hasChapters: false } } });
		expect(screen.getByRole('checkbox', { name: 'Include Ruy Lopez in practice' })).toBeTruthy();
		expect(screen.getByLabelText('Expand Ruy Lopez')).toBeTruthy();
	});

	it('fetches and shows a shared-prefix bucket even when the repertoire has no chapters', async () => {
		const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => variationsResponse });
		vi.stubGlobal('fetch', fetchSpy);
		render(RepertoirePracticeRow, { props: { rep: { ...baseRep, hasChapters: false } } });

		await fireEvent.click(screen.getByLabelText('Expand Ruy Lopez'));
		await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith('/api/repertoires/rep-1/variations'));
		expect(screen.getByText(/1\.e4 e5 2\.Nf3 Nc6/)).toBeTruthy();
	});

	it('keeps aria-labels unambiguous three levels deep by growing the qualifier with each nested bucket', async () => {
		// chapter -> "1.e4" bucket (v1,v2,v3) -> "e5" sub-bucket (v1,v2) -> leaves.
		const threeDeep = [
			row('v1', ['e4', 'e5', 'Nf3'], 'Open Game'),
			row('v2', ['e4', 'e5', 'Nc3'], 'Open Game'),
			row('v3', ['e4', 'c5'], 'Open Game')
		];
		const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => threeDeep });
		vi.stubGlobal('fetch', fetchSpy);
		render(RepertoirePracticeRow, { props: { rep: { ...baseRep, fullVariationCount: 3 } } });

		await fireEvent.click(screen.getByLabelText('Expand Ruy Lopez'));
		await waitFor(() => screen.getByText('Open Game (chapter)'));
		await fireEvent.click(screen.getByLabelText('Expand Open Game chapter'));
		await waitFor(() => screen.getByLabelText('Include 1.e4 in Open Game in practice'));

		await fireEvent.click(screen.getByLabelText('Expand 1.e4 in Open Game'));
		// The second-tier bucket ("e5") must qualify itself with the first
		// tier's own label, not just the chapter name, so it can never read
		// identically to a same-named bucket sitting directly under the
		// chapter itself.
		await waitFor(() => expect(screen.getByLabelText('Include 1...e5 in 1.e4 in Open Game in practice')).toBeTruthy());
		expect(screen.getByLabelText('Expand 1...e5 in 1.e4 in Open Game')).toBeTruthy();
		expect(screen.getByText('label:v3')).toBeTruthy(); // the lone "c5" sibling, a leaf at this same tier

		await fireEvent.click(screen.getByLabelText('Expand 1...e5 in 1.e4 in Open Game'));
		expect(screen.getByText('label:v1')).toBeTruthy();
		expect(screen.getByText('label:v2')).toBeTruthy();
	});
});
