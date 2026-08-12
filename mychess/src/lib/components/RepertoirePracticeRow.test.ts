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
	level: 3 as const,
	totalLevels: 6,
	levelTaskCount: 18,
	levelSolvedCount: 12,
	totalVariations: 2,
	fullVariationCount: 2,
	excludedVariationCount: 0,
	hasChapters: true
};

const variationsResponse = [
	{ variationKey: 'v1', label: '1.e4 e5 2.Nf3 Nc6 3.Bb5 a6', included: true, chapterName: null },
	{ variationKey: 'v2', label: '1.e4 e5 2.Nf3 Nc6 3.Bb5 Nf6', included: true, chapterName: null }
];

const chapterVariationsResponse = [
	{ variationKey: 'v1', label: '1.e4 e5 2.Nf3 Nc6 3.Bb5 a6 4.Ba4', included: true, chapterName: 'Ruy Lopez' },
	{ variationKey: 'v2', label: '1.e4 e5 2.Nf3 Nc6 3.Bb5 Nf6', included: true, chapterName: 'Ruy Lopez' },
	{ variationKey: 'v3', label: '1.e4 e5 2.Nf3 Nc6 3.Bc4 Bc5', included: true, chapterName: 'Italian Game' }
];

describe('RepertoirePracticeRow', () => {
	it('renders collapsed by default, showing name and progress but no variations', () => {
		render(RepertoirePracticeRow, { props: { rep: baseRep } });
		expect(screen.getByText('Ruy Lopez')).toBeTruthy();
		expect(screen.queryByText('1.e4 e5 2.Nf3 Nc6 3.Bb5 a6')).toBeNull();
	});

	it('shows the parent checkbox as checked when nothing is excluded', () => {
		render(RepertoirePracticeRow, { props: { rep: baseRep } });
		const checkbox = screen.getByRole('checkbox', { name: /Ruy Lopez/ }) as HTMLInputElement;
		expect(checkbox.checked).toBe(true);
		expect(checkbox.indeterminate).toBe(false);
	});

	it('shows the parent checkbox as indeterminate when some variations are excluded', () => {
		render(RepertoirePracticeRow, { props: { rep: { ...baseRep, excludedVariationCount: 1 } } });
		const checkbox = screen.getByRole('checkbox', { name: /Ruy Lopez/ }) as HTMLInputElement;
		expect(checkbox.indeterminate).toBe(true);
	});

	it('shows the parent checkbox as unchecked when every variation is excluded', () => {
		render(RepertoirePracticeRow, { props: { rep: { ...baseRep, excludedVariationCount: 2 } } });
		const checkbox = screen.getByRole('checkbox', { name: /Ruy Lopez/ }) as HTMLInputElement;
		expect(checkbox.checked).toBe(false);
		expect(checkbox.indeterminate).toBe(false);
	});

	it('fetches and shows variations when expanded, only once', async () => {
		const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => variationsResponse });
		vi.stubGlobal('fetch', fetchSpy);
		render(RepertoirePracticeRow, { props: { rep: baseRep } });

		await fireEvent.click(screen.getByLabelText('Expand Ruy Lopez'));
		await waitFor(() => expect(screen.getByText('1.e4 e5 2.Nf3 Nc6 3.Bb5 a6')).toBeTruthy());
		expect(fetchSpy).toHaveBeenCalledWith('/api/repertoires/rep-1/variations');

		await fireEvent.click(screen.getByLabelText('Collapse Ruy Lopez'));
		await fireEvent.click(screen.getByLabelText('Expand Ruy Lopez'));
		expect(fetchSpy).toHaveBeenCalledTimes(1); // cached after the first fetch
	});

	it('toggling one variation checkbox posts its own exclusion change', async () => {
		const fetchSpy = vi
			.fn()
			.mockResolvedValueOnce({ ok: true, json: async () => variationsResponse })
			.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) });
		vi.stubGlobal('fetch', fetchSpy);
		render(RepertoirePracticeRow, { props: { rep: baseRep } });

		await fireEvent.click(screen.getByLabelText('Expand Ruy Lopez'));
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
		await waitFor(() => screen.getByText('1.e4 e5 2.Nf3 Nc6 3.Bb5 Nf6'));
		const v2Checkbox = within(screen.getByText('1.e4 e5 2.Nf3 Nc6 3.Bb5 Nf6').closest('label')!).getByRole(
			'checkbox'
		) as HTMLInputElement;
		await fireEvent.click(v2Checkbox);
		await waitFor(() => expect(v2Checkbox.checked).toBe(false));

		const parentCheckbox = screen.getByRole('checkbox', { name: /Ruy Lopez/ }) as HTMLInputElement;
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

	it('shows "No moves yet" when totalVariations is 0, even if fullVariationCount is not (every variation excluded)', () => {
		render(RepertoirePracticeRow, {
			props: {
				rep: { ...baseRep, totalVariations: 0, level: 'mastered' as const, totalLevels: 0, excludedVariationCount: 2 }
			}
		});
		expect(screen.getByText('No moves yet')).toBeTruthy();
	});

	it('reverts the checkbox and shows an error when toggling a variation fails', async () => {
		const fetchSpy = vi
			.fn()
			.mockResolvedValueOnce({ ok: true, json: async () => variationsResponse })
			.mockResolvedValueOnce({ ok: false });
		vi.stubGlobal('fetch', fetchSpy);
		render(RepertoirePracticeRow, { props: { rep: baseRep } });

		await fireEvent.click(screen.getByLabelText('Expand Ruy Lopez'));
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

	it('groups variations under a chapter header when they share a chapterName, without listing individual variations', async () => {
		const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => chapterVariationsResponse });
		vi.stubGlobal('fetch', fetchSpy);
		render(RepertoirePracticeRow, { props: { rep: { ...baseRep, totalVariations: 3, fullVariationCount: 3 } } });

		await fireEvent.click(screen.getByLabelText('Expand Ruy Lopez'));
		await waitFor(() => expect(screen.getByText('Ruy Lopez (chapter)')).toBeTruthy());
		expect(screen.getByText('Italian Game (chapter)')).toBeTruthy();
		// Selection is chapter-level only — no per-variation checkboxes/labels
		// render underneath a chapter header, just a line count.
		expect(screen.queryByText('1.e4 e5 2.Nf3 Nc6 3.Bb5 a6 4.Ba4')).toBeNull();
		expect(screen.queryByText('1.e4 e5 2.Nf3 Nc6 3.Bc4 Bc5')).toBeNull();
		expect(screen.getByText('· 2 lines')).toBeTruthy();
		expect(screen.getByText('· 1 line')).toBeTruthy();
	});

	it('renders a flat list with no chapter header when no variation has a chapterName', async () => {
		const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => variationsResponse });
		vi.stubGlobal('fetch', fetchSpy);
		render(RepertoirePracticeRow, { props: { rep: baseRep } });

		await fireEvent.click(screen.getByLabelText('Expand Ruy Lopez'));
		await waitFor(() => expect(screen.getByText('1.e4 e5 2.Nf3 Nc6 3.Bb5 a6')).toBeTruthy());
		expect(screen.queryByText('(chapter)', { exact: false })).toBeNull();
	});

	it('shows a chapter checkbox as indeterminate when only some of its own variations are included, independent of a sibling chapter', async () => {
		const partial = chapterVariationsResponse.map((v) => (v.variationKey === 'v1' ? { ...v, included: false } : v));
		const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => partial });
		vi.stubGlobal('fetch', fetchSpy);
		render(RepertoirePracticeRow, { props: { rep: { ...baseRep, totalVariations: 3, fullVariationCount: 3 } } });

		await fireEvent.click(screen.getByLabelText('Expand Ruy Lopez'));
		await waitFor(() => screen.getByText('Ruy Lopez (chapter)'));

		const ruyCheckbox = screen.getByRole('checkbox', { name: /Ruy Lopez \(chapter\)/ }) as HTMLInputElement;
		const italianCheckbox = screen.getByRole('checkbox', { name: /Italian Game \(chapter\)/ }) as HTMLInputElement;
		expect(ruyCheckbox.indeterminate).toBe(true); // v1 excluded, v2 included
		expect(italianCheckbox.checked).toBe(true); // v3 included, unaffected by Ruy Lopez's state
	});

	it('bulk-toggling a chapter checkbox only excludes that chapter\'s own variations', async () => {
		const fetchSpy = vi
			.fn()
			.mockResolvedValueOnce({ ok: true, json: async () => chapterVariationsResponse })
			.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
		vi.stubGlobal('fetch', fetchSpy);
		render(RepertoirePracticeRow, { props: { rep: { ...baseRep, totalVariations: 3, fullVariationCount: 3 } } });

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

	it('hides the checkbox and expand control entirely when the repertoire has no chapters', () => {
		render(RepertoirePracticeRow, { props: { rep: { ...baseRep, hasChapters: false } } });
		expect(screen.queryByRole('checkbox', { name: /Ruy Lopez/ })).toBeNull();
		expect(screen.queryByLabelText('Expand Ruy Lopez')).toBeNull();
		expect(screen.getByText('Ruy Lopez')).toBeTruthy(); // the row itself still renders, just non-interactive for selection
	});

	it('never fetches variations when the repertoire has no chapters (nothing to expand)', () => {
		const fetchSpy = vi.fn();
		vi.stubGlobal('fetch', fetchSpy);
		render(RepertoirePracticeRow, { props: { rep: { ...baseRep, hasChapters: false } } });
		expect(fetchSpy).not.toHaveBeenCalled();
	});
});
