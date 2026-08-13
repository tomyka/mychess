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

// Both share a first move so expanding the repertoire produces exactly one
// move-group bucket ("e4 · 2 lines") to drill into, keeping the flat-case
// tests below to one extra click versus the pre-grouping version.
const variationsResponse = [
	{ variationKey: 'v1', label: '1.e4 e5 2.Nf3 Nc6 3.Bb5 a6', included: true, chapterName: null, firstMoveSan: 'e4' },
	{ variationKey: 'v2', label: '1.e4 e5 2.Nf3 Nc6 3.Bb5 Nf6', included: true, chapterName: null, firstMoveSan: 'e4' }
];

const chapterVariationsResponse = [
	{ variationKey: 'v1', label: '1.e4 e5 2.Nf3 Nc6 3.Bb5 a6 4.Ba4', included: true, chapterName: 'Ruy Lopez', firstMoveSan: 'e4' },
	{ variationKey: 'v2', label: '1.e4 e5 2.Nf3 Nc6 3.Bb5 Nf6', included: true, chapterName: 'Ruy Lopez', firstMoveSan: 'e4' },
	{ variationKey: 'v3', label: '1.e4 e5 2.Nf3 Nc6 3.Bc4 Bc5', included: true, chapterName: 'Italian Game', firstMoveSan: 'e4' }
];

describe('RepertoirePracticeRow', () => {
	it('renders collapsed by default, showing name and progress but no variations', () => {
		render(RepertoirePracticeRow, { props: { rep: baseRep } });
		expect(screen.getByText('Ruy Lopez')).toBeTruthy();
		expect(screen.queryByText('1.e4 e5 2.Nf3 Nc6 3.Bb5 a6')).toBeNull();
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

	it('fetches variations when expanded, only once, showing a move-group bucket rather than raw variations', async () => {
		const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => variationsResponse });
		vi.stubGlobal('fetch', fetchSpy);
		render(RepertoirePracticeRow, { props: { rep: baseRep } });

		await fireEvent.click(screen.getByLabelText('Expand Ruy Lopez'));
		await waitFor(() => expect(screen.getByText('· 2 lines')).toBeTruthy());
		expect(fetchSpy).toHaveBeenCalledWith('/api/repertoires/rep-1/variations');
		expect(screen.queryByText('1.e4 e5 2.Nf3 Nc6 3.Bb5 a6')).toBeNull(); // not shown until the bucket is drilled into

		await fireEvent.click(screen.getByLabelText('Collapse Ruy Lopez'));
		await fireEvent.click(screen.getByLabelText('Expand Ruy Lopez'));
		expect(fetchSpy).toHaveBeenCalledTimes(1); // cached after the first fetch
	});

	it('drilling into a move-group bucket reveals its individual variations', async () => {
		const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => variationsResponse });
		vi.stubGlobal('fetch', fetchSpy);
		render(RepertoirePracticeRow, { props: { rep: baseRep } });

		await fireEvent.click(screen.getByLabelText('Expand Ruy Lopez'));
		await waitFor(() => screen.getByText('· 2 lines'));
		await fireEvent.click(screen.getByLabelText('Expand e4 in Ruy Lopez'));

		expect(screen.getByText('1.e4 e5 2.Nf3 Nc6 3.Bb5 a6')).toBeTruthy();
		expect(screen.getByText('1.e4 e5 2.Nf3 Nc6 3.Bb5 Nf6')).toBeTruthy();
	});

	it('toggling one variation checkbox posts its own exclusion change', async () => {
		const fetchSpy = vi
			.fn()
			.mockResolvedValueOnce({ ok: true, json: async () => variationsResponse })
			.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) });
		vi.stubGlobal('fetch', fetchSpy);
		render(RepertoirePracticeRow, { props: { rep: baseRep } });

		await fireEvent.click(screen.getByLabelText('Expand Ruy Lopez'));
		await waitFor(() => screen.getByText('· 2 lines'));
		await fireEvent.click(screen.getByLabelText('Expand e4 in Ruy Lopez'));
		await waitFor(() => screen.getByText('1.e4 e5 2.Nf3 Nc6 3.Bb5 a6'));

		const variationCheckbox = within(screen.getByText('1.e4 e5 2.Nf3 Nc6 3.Bb5 a6').closest('label')!).getByRole(
			'checkbox'
		) as HTMLInputElement;
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
		await waitFor(() => screen.getByText('· 2 lines'));
		await fireEvent.click(screen.getByLabelText('Expand e4 in Ruy Lopez'));
		await waitFor(() => screen.getByText('1.e4 e5 2.Nf3 Nc6 3.Bb5 Nf6'));
		const v2Checkbox = within(screen.getByText('1.e4 e5 2.Nf3 Nc6 3.Bb5 Nf6').closest('label')!).getByRole(
			'checkbox'
		) as HTMLInputElement;
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
		const v1Checkbox = within(screen.getByText('1.e4 e5 2.Nf3 Nc6 3.Bb5 a6').closest('label')!).getByRole(
			'checkbox'
		) as HTMLInputElement;
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
			props: {
				rep: { ...baseRep, total: 0, solved: 0, allSolved: true, excludedVariationCount: 2 }
			}
		});
		expect(screen.getByText('No moves yet')).toBeTruthy();
	});

	it('still shows the checkbox and expand control when every variation is excluded, so it can be undone', () => {
		render(RepertoirePracticeRow, {
			props: {
				rep: { ...baseRep, total: 0, solved: 0, allSolved: true, excludedVariationCount: 2 }
			}
		});
		expect(screen.getByRole('checkbox', { name: 'Include Ruy Lopez in practice' })).toBeTruthy();
		expect(screen.getByLabelText('Expand Ruy Lopez')).toBeTruthy();
	});

	it('hides the checkbox and expand control entirely for a genuinely empty repertoire (fullVariationCount 0)', () => {
		render(RepertoirePracticeRow, {
			props: { rep: { ...baseRep, total: 0, solved: 0, allSolved: true, fullVariationCount: 0, excludedVariationCount: 0 } }
		});
		expect(screen.queryByRole('checkbox', { name: /Ruy Lopez/ })).toBeNull();
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
		await waitFor(() => screen.getByText('· 2 lines'));
		await fireEvent.click(screen.getByLabelText('Expand e4 in Ruy Lopez'));
		await waitFor(() => screen.getByText('1.e4 e5 2.Nf3 Nc6 3.Bb5 a6'));

		const variationCheckbox = within(screen.getByText('1.e4 e5 2.Nf3 Nc6 3.Bb5 a6').closest('label')!).getByRole(
			'checkbox'
		) as HTMLInputElement;
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
		expect(screen.queryByText('1.e4 e5 2.Nf3 Nc6 3.Bb5 a6')).toBeNull();
	});

	it('groups variations under a chapter header, revealing neither move-groups nor variations until drilled into', async () => {
		const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => chapterVariationsResponse });
		vi.stubGlobal('fetch', fetchSpy);
		render(RepertoirePracticeRow, { props: { rep: { ...baseRep, fullVariationCount: 3 } } });

		await fireEvent.click(screen.getByLabelText('Expand Ruy Lopez'));
		await waitFor(() => expect(screen.getByText('Ruy Lopez (chapter)')).toBeTruthy());
		expect(screen.getByText('Italian Game (chapter)')).toBeTruthy();
		expect(screen.queryByText('1.e4 e5 2.Nf3 Nc6 3.Bb5 a6 4.Ba4')).toBeNull();
		expect(screen.getByText('· 2 lines')).toBeTruthy();
		expect(screen.getByText('· 1 line')).toBeTruthy();
	});

	it('drilling into a chapter reveals its move-group buckets, and drilling into one of those reveals its variations', async () => {
		const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => chapterVariationsResponse });
		vi.stubGlobal('fetch', fetchSpy);
		render(RepertoirePracticeRow, { props: { rep: { ...baseRep, fullVariationCount: 3 } } });

		await fireEvent.click(screen.getByLabelText('Expand Ruy Lopez'));
		await waitFor(() => screen.getByText('Ruy Lopez (chapter)'));

		await fireEvent.click(screen.getByLabelText('Expand Ruy Lopez chapter'));
		await waitFor(() => expect(screen.getByLabelText('Include e4 in Ruy Lopez in practice')).toBeTruthy());
		expect(screen.queryByText('1.e4 e5 2.Nf3 Nc6 3.Bb5 a6 4.Ba4')).toBeNull(); // still one drill-down away

		await fireEvent.click(screen.getByLabelText('Expand e4 in Ruy Lopez'));
		expect(screen.getByText('1.e4 e5 2.Nf3 Nc6 3.Bb5 a6 4.Ba4')).toBeTruthy();
		expect(screen.getByText('1.e4 e5 2.Nf3 Nc6 3.Bb5 Nf6')).toBeTruthy();
	});

	it('renders a flat pool of move-group buckets with no chapter header when no variation has a chapterName', async () => {
		const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => variationsResponse });
		vi.stubGlobal('fetch', fetchSpy);
		render(RepertoirePracticeRow, { props: { rep: baseRep } });

		await fireEvent.click(screen.getByLabelText('Expand Ruy Lopez'));
		await waitFor(() => expect(screen.getByText('· 2 lines')).toBeTruthy());
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

	it("bulk-toggling a move-group bucket checkbox only excludes that bucket's own variations, leaving a sibling chapter untouched", async () => {
		const fetchSpy = vi
			.fn()
			.mockResolvedValueOnce({ ok: true, json: async () => chapterVariationsResponse })
			.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
		vi.stubGlobal('fetch', fetchSpy);
		render(RepertoirePracticeRow, { props: { rep: { ...baseRep, fullVariationCount: 3 } } });

		await fireEvent.click(screen.getByLabelText('Expand Ruy Lopez'));
		await waitFor(() => screen.getByText('Ruy Lopez (chapter)'));
		await fireEvent.click(screen.getByLabelText('Expand Ruy Lopez chapter'));
		await waitFor(() => screen.getByLabelText('Include e4 in Ruy Lopez in practice'));

		const bucketCheckbox = screen.getByRole('checkbox', { name: 'Include e4 in Ruy Lopez in practice' }) as HTMLInputElement;
		expect(bucketCheckbox.checked).toBe(true);
		await fireEvent.click(bucketCheckbox);

		await waitFor(() =>
			expect(fetchSpy).toHaveBeenLastCalledWith('/api/repertoires/rep-1/exclusions', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ variationKeys: ['v1', 'v2'], included: false })
			})
		);
		const italianCheckbox = screen.getByRole('checkbox', { name: /Italian Game \(chapter\)/ }) as HTMLInputElement;
		expect(italianCheckbox.checked).toBe(true); // a different chapter's own bucket, unaffected
	});

	it("re-checking a chapter after one of its buckets was already independently excluded restores only what the chapter's own exclusion touched, not the bucket's prior exclusion", async () => {
		// Two first moves within the same chapter, so the chapter and one of
		// its own move-group buckets have genuinely independent snapshots to
		// interleave.
		const interleaved = [
			{ variationKey: 'v1', label: '1.e4 e5', included: true, chapterName: 'Ruy Lopez', firstMoveSan: 'e4' },
			{ variationKey: 'v2', label: '1.e4 c5', included: true, chapterName: 'Ruy Lopez', firstMoveSan: 'e4' },
			{ variationKey: 'v3', label: '1.d4 d5', included: true, chapterName: 'Ruy Lopez', firstMoveSan: 'd4' }
		];
		const fetchSpy = vi
			.fn()
			.mockResolvedValueOnce({ ok: true, json: async () => interleaved })
			.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
		vi.stubGlobal('fetch', fetchSpy);
		render(RepertoirePracticeRow, { props: { rep: { ...baseRep, fullVariationCount: 3 } } });

		await fireEvent.click(screen.getByLabelText('Expand Ruy Lopez'));
		await waitFor(() => screen.getByText('Ruy Lopez (chapter)'));
		await fireEvent.click(screen.getByLabelText('Expand Ruy Lopez chapter'));
		await waitFor(() => screen.getByLabelText('Include e4 in Ruy Lopez in practice'));

		// Step 1: independently bulk-exclude the "e4" bucket (v1, v2).
		const e4BucketCheckbox = screen.getByRole('checkbox', { name: 'Include e4 in Ruy Lopez in practice' }) as HTMLInputElement;
		await fireEvent.click(e4BucketCheckbox);
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
		expect(e4BucketCheckbox.checked).toBe(false); // still excluded, untouched by the chapter's restore
	});

	it('drilling into a move-group bucket within a chapter reveals its individual variations with their own checkboxes', async () => {
		const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => chapterVariationsResponse });
		vi.stubGlobal('fetch', fetchSpy);
		render(RepertoirePracticeRow, { props: { rep: { ...baseRep, fullVariationCount: 3 } } });

		await fireEvent.click(screen.getByLabelText('Expand Ruy Lopez'));
		await waitFor(() => screen.getByText('Ruy Lopez (chapter)'));
		await fireEvent.click(screen.getByLabelText('Expand Ruy Lopez chapter'));
		await waitFor(() => screen.getByLabelText('Include e4 in Ruy Lopez in practice'));

		await fireEvent.click(screen.getByLabelText('Expand e4 in Ruy Lopez'));
		expect(screen.getByText('1.e4 e5 2.Nf3 Nc6 3.Bb5 a6 4.Ba4')).toBeTruthy();
		expect(screen.getByText('1.e4 e5 2.Nf3 Nc6 3.Bb5 Nf6')).toBeTruthy();
	});

	it('shows the checkbox and expand control even when the repertoire has no chapters, as long as it has variations', () => {
		render(RepertoirePracticeRow, { props: { rep: { ...baseRep, hasChapters: false } } });
		expect(screen.getByRole('checkbox', { name: 'Include Ruy Lopez in practice' })).toBeTruthy();
		expect(screen.getByLabelText('Expand Ruy Lopez')).toBeTruthy();
	});

	it('fetches and shows a move-group bucket even when the repertoire has no chapters', async () => {
		const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => variationsResponse });
		vi.stubGlobal('fetch', fetchSpy);
		render(RepertoirePracticeRow, { props: { rep: { ...baseRep, hasChapters: false } } });

		await fireEvent.click(screen.getByLabelText('Expand Ruy Lopez'));
		await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith('/api/repertoires/rep-1/variations'));
		expect(screen.getByText('· 2 lines')).toBeTruthy();
	});
});
