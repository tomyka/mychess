// @vitest-environment jsdom
// mychess/src/lib/components/RepertoirePracticeRow.test.ts
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/svelte';
import RepertoirePracticeRow from './RepertoirePracticeRow.svelte';
import { UNTAGGED_CHAPTER } from '$lib/mastery/variations';

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

function row(variationKey: string, sans: string[], chapterNames: string[], included = true, solved = false) {
	return { variationKey, label: `label:${variationKey}`, included, chapterNames, path: path(sans), solved };
}

// v1/v2 share their first 5 full moves (10 plies) before diverging on move
// 6 — the component's fixed grouping window (FIRST_MOVES_GROUP_PLIES = 10)
// buckets them together. No chapter tag (the flat/chapterless case).
const variationsResponse = [
	row('v1', ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O', 'Be7', 'Re1'], []),
	row('v2', ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O', 'Be7', 'd3'], [])
];

// Same shared-prefix pair, now under a 'Ruy Lopez' chapter, plus a single
// short, unrelated line in its own 'Italian Game' chapter.
const chapterVariationsResponse = [
	row('v1', ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O', 'Be7', 'Re1'], ['Ruy Lopez']),
	row('v2', ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O', 'Be7', 'd3'], ['Ruy Lopez']),
	row('v3', ['d4', 'd5', 'c4'], ['Italian Game'])
];

// v1/v2 share their first-5-moves window (one bucket); v3 is a short,
// unrelated line (its own single-item bucket) — used for sibling-isolation
// tests across two buckets sitting side by side under the same chapter.
const siblingResponse = [
	row('v1', ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O', 'Be7', 'Re1'], ['Ruy Lopez']),
	row('v2', ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O', 'Be7', 'd3'], ['Ruy Lopez']),
	row('v3', ['d4', 'd5'], ['Ruy Lopez'])
];

const SHARED_BUCKET_LABEL = /1\.e4 e5 2\.Nf3 Nc6 3\.Bb5 a6 4\.Ba4 Nf6 5\.O-O Be7/;
const SHARED_BUCKET_TEXT = '1.e4 e5 2.Nf3 Nc6 3.Bb5 a6 4.Ba4 Nf6 5.O-O Be7';

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

	it('fetches variations when expanded, only once, showing a first-5-moves bucket rather than raw variations', async () => {
		const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => variationsResponse });
		vi.stubGlobal('fetch', fetchSpy);
		render(RepertoirePracticeRow, { props: { rep: baseRep } });

		await fireEvent.click(screen.getByLabelText('Expand Ruy Lopez'));
		await waitFor(() => expect(screen.getByText(SHARED_BUCKET_LABEL)).toBeTruthy());
		expect(fetchSpy).toHaveBeenCalledWith('/api/repertoires/rep-1/variations');
		expect(screen.queryByText('label:v1')).toBeNull(); // not shown until the bucket is drilled into

		await fireEvent.click(screen.getByLabelText('Collapse Ruy Lopez'));
		await fireEvent.click(screen.getByLabelText('Expand Ruy Lopez'));
		expect(fetchSpy).toHaveBeenCalledTimes(1); // cached after the first fetch
	});

	it('drilling into a first-5-moves bucket reveals its individual variations', async () => {
		const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => variationsResponse });
		vi.stubGlobal('fetch', fetchSpy);
		render(RepertoirePracticeRow, { props: { rep: baseRep } });

		await fireEvent.click(screen.getByLabelText('Expand Ruy Lopez'));
		await waitFor(() => screen.getByText(SHARED_BUCKET_LABEL));
		await fireEvent.click(screen.getByLabelText(`Expand ${SHARED_BUCKET_TEXT} in Ruy Lopez`));

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
		await waitFor(() => screen.getByText(SHARED_BUCKET_LABEL));
		await fireEvent.click(screen.getByLabelText(`Expand ${SHARED_BUCKET_TEXT} in Ruy Lopez`));
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

	it('unchecking a fully-checked parent excludes every variation, and re-checking restores them', async () => {
		const fetchSpy = vi
			.fn()
			.mockResolvedValueOnce({ ok: true, json: async () => variationsResponse }) // GET on expand
			.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }); // every POST after
		vi.stubGlobal('fetch', fetchSpy);
		render(RepertoirePracticeRow, { props: { rep: baseRep } });

		await fireEvent.click(screen.getByLabelText('Expand Ruy Lopez'));
		await waitFor(() => screen.getByText(SHARED_BUCKET_LABEL));

		const parentCheckbox = screen.getByRole('checkbox', { name: 'Include Ruy Lopez in practice' }) as HTMLInputElement;
		expect(parentCheckbox.checked).toBe(true); // both v1 and v2 start included
		await fireEvent.click(parentCheckbox); // fully checked -> bulk-exclude everything
		await waitFor(() =>
			expect(fetchSpy).toHaveBeenLastCalledWith('/api/repertoires/rep-1/exclusions', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ variationKeys: ['v1', 'v2'], included: false })
			})
		);
		expect(parentCheckbox.checked).toBe(false);
		expect(parentCheckbox.indeterminate).toBe(false);

		await fireEvent.click(parentCheckbox); // re-check — restores both
		await waitFor(() =>
			expect(fetchSpy).toHaveBeenLastCalledWith('/api/repertoires/rep-1/exclusions', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ variationKeys: ['v1', 'v2'], included: true })
			})
		);
		expect(parentCheckbox.checked).toBe(true);
	});

	it('clicking an indeterminate parent selects every variation, including ones individually excluded', async () => {
		const fetchSpy = vi
			.fn()
			.mockResolvedValueOnce({ ok: true, json: async () => variationsResponse }) // GET on expand
			.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }); // every POST after
		vi.stubGlobal('fetch', fetchSpy);
		render(RepertoirePracticeRow, { props: { rep: baseRep } });

		// Individually uncheck v2, leaving v1 included — the parent now reads
		// indeterminate ("empty"), not unchecked.
		await fireEvent.click(screen.getByLabelText('Expand Ruy Lopez'));
		await waitFor(() => screen.getByText(SHARED_BUCKET_LABEL));
		await fireEvent.click(screen.getByLabelText(`Expand ${SHARED_BUCKET_TEXT} in Ruy Lopez`));
		await waitFor(() => screen.getByText('label:v2'));
		const v2Checkbox = within(screen.getByText('label:v2').closest('label')!).getByRole('checkbox') as HTMLInputElement;
		await fireEvent.click(v2Checkbox);
		await waitFor(() => expect(v2Checkbox.checked).toBe(false));

		const parentCheckbox = screen.getByRole('checkbox', { name: 'Include Ruy Lopez in practice' }) as HTMLInputElement;
		expect(parentCheckbox.indeterminate).toBe(true); // v1 still included, v2 already excluded

		// Clicking the indeterminate parent selects EVERYTHING — v1 (already
		// included) and v2 (individually excluded) both end up checked. This is
		// the fix: previously this click bulk-excluded whatever was still
		// included, treating indeterminate the same as fully-checked.
		await fireEvent.click(parentCheckbox);
		await waitFor(() =>
			expect(fetchSpy).toHaveBeenLastCalledWith('/api/repertoires/rep-1/exclusions', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ variationKeys: ['v1', 'v2'], included: true })
			})
		);
		const v1Checkbox = within(screen.getByText('label:v1').closest('label')!).getByRole('checkbox') as HTMLInputElement;
		expect(v1Checkbox.checked).toBe(true);
		expect(v2Checkbox.checked).toBe(true);
		expect(parentCheckbox.checked).toBe(true);
		expect(parentCheckbox.indeterminate).toBe(false);

		// Now fully checked -> the next click excludes everything again.
		await fireEvent.click(parentCheckbox);
		await waitFor(() =>
			expect(fetchSpy).toHaveBeenLastCalledWith('/api/repertoires/rep-1/exclusions', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ variationKeys: ['v1', 'v2'], included: false })
			})
		);
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

	it('shows learned/total progress in the subtitle', () => {
		render(RepertoirePracticeRow, { props: { rep: baseRep } });
		expect(screen.getByText('12/18 variations learned')).toBeTruthy();
	});

	it('shows the Learned chip instead of a trophy when allSolved is true', () => {
		render(RepertoirePracticeRow, { props: { rep: { ...baseRep, allSolved: true, solved: 18 } } });
		// The trophy is gone with #99: a fully-learned repertoire now carries a
		// Learned chip, and Mastered is the state that earns celebration.
		expect(screen.getByText('Learned')).toBeTruthy();
		expect(screen.getByText('18/18 variations learned')).toBeTruthy();
	});

	it('updates the solved/total subtitle immediately when a variation is toggled, without waiting for a reload', async () => {
		const withSolved = [row('v1', ['e4', 'e5'], [], true, true), row('v2', ['d4', 'd5'], [], true, false)];
		const fetchSpy = vi
			.fn()
			.mockResolvedValueOnce({ ok: true, json: async () => withSolved })
			.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
		vi.stubGlobal('fetch', fetchSpy);
		// The stale server-provided rep.solved/rep.total (12/18) must never
		// appear once variations are loaded — the subtitle should reflect
		// the live, exclusion-aware count instead.
		render(RepertoirePracticeRow, { props: { rep: baseRep } });

		await fireEvent.click(screen.getByLabelText('Expand Ruy Lopez'));
		await waitFor(() => expect(screen.getByText('1/2 variations learned')).toBeTruthy());

		// Exclude v1 (the solved one) — the subtitle must update right away
		// (optimistically, before the exclusion POST even resolves), since
		// an excluded variation no longer counts toward either solved or
		// total. v1 has no sibling sharing its opening move, so it's its own
		// single-item bucket labeled with its whole (short) line.
		await fireEvent.click(screen.getByLabelText('Expand 1.e4 e5 in Ruy Lopez'));
		const v1Checkbox = within(screen.getByText('label:v1').closest('label')!).getByRole('checkbox') as HTMLInputElement;
		await fireEvent.click(v1Checkbox);

		expect(screen.getByText('0/1 variations learned')).toBeTruthy();
	});

	it('reverts the checkbox and shows an error when toggling a variation fails', async () => {
		const fetchSpy = vi
			.fn()
			.mockResolvedValueOnce({ ok: true, json: async () => variationsResponse })
			.mockResolvedValueOnce({ ok: false });
		vi.stubGlobal('fetch', fetchSpy);
		render(RepertoirePracticeRow, { props: { rep: baseRep } });

		await fireEvent.click(screen.getByLabelText('Expand Ruy Lopez'));
		await waitFor(() => screen.getByText(SHARED_BUCKET_LABEL));
		await fireEvent.click(screen.getByLabelText(`Expand ${SHARED_BUCKET_TEXT} in Ruy Lopez`));
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

	it('drilling into a chapter with only one variation collapses straight to that leaf-sized bucket', async () => {
		const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => chapterVariationsResponse });
		vi.stubGlobal('fetch', fetchSpy);
		render(RepertoirePracticeRow, { props: { rep: { ...baseRep, fullVariationCount: 3 } } });

		await fireEvent.click(screen.getByLabelText('Expand Ruy Lopez'));
		await waitFor(() => screen.getByText('Italian Game (chapter)'));
		await fireEvent.click(screen.getByLabelText('Expand Italian Game chapter'));
		await waitFor(() => expect(screen.getByText(/1\.d4 d5 2\.c4/)).toBeTruthy());

		await fireEvent.click(screen.getByLabelText(/Expand 1\.d4 d5 2\.c4 in Italian Game/));
		expect(screen.getByText('label:v3')).toBeTruthy();
	});

	it('drilling into a chapter with a shared first-5-moves bucket reveals it, then its variations one level deeper', async () => {
		const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => chapterVariationsResponse });
		vi.stubGlobal('fetch', fetchSpy);
		render(RepertoirePracticeRow, { props: { rep: { ...baseRep, fullVariationCount: 3 } } });

		await fireEvent.click(screen.getByLabelText('Expand Ruy Lopez'));
		await waitFor(() => screen.getByText('Ruy Lopez (chapter)'));

		await fireEvent.click(screen.getByLabelText('Expand Ruy Lopez chapter'));
		await waitFor(() => expect(screen.getByText(SHARED_BUCKET_LABEL)).toBeTruthy());
		expect(screen.queryByText('label:v1')).toBeNull(); // still one drill-down away

		await fireEvent.click(screen.getByLabelText(`Expand ${SHARED_BUCKET_TEXT} in Ruy Lopez`));
		expect(screen.getByText('label:v1')).toBeTruthy();
		expect(screen.getByText('label:v2')).toBeTruthy();
	});

	it('renders a flat pool of buckets with no chapter header when no variation carries a chapter', async () => {
		const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => variationsResponse });
		vi.stubGlobal('fetch', fetchSpy);
		render(RepertoirePracticeRow, { props: { rep: baseRep } });

		await fireEvent.click(screen.getByLabelText('Expand Ruy Lopez'));
		await waitFor(() => expect(screen.getByText(SHARED_BUCKET_LABEL)).toBeTruthy());
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

	it("does not lose a concurrent chapter toggle's already-applied change when a different, slower chapter toggle later fails and reverts", async () => {
		let resolveSlowPost: ((value: { ok: boolean }) => void) | undefined;
		const fetchSpy = vi.fn((url: string, init?: any) => {
			if (!init) return Promise.resolve({ ok: true, json: async () => chapterVariationsResponse });
			const body = JSON.parse(init.body);
			if (body.variationKeys.includes('v1')) {
				// Ruy Lopez's bulk-exclude — deliberately left pending until
				// explicitly resolved below, simulating a slow request that
				// ultimately fails.
				return new Promise((resolve) => {
					resolveSlowPost = resolve;
				});
			}
			// Italian Game's bulk-exclude — resolves immediately and succeeds.
			return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
		});
		vi.stubGlobal('fetch', fetchSpy);
		render(RepertoirePracticeRow, { props: { rep: { ...baseRep, fullVariationCount: 3 } } });

		await fireEvent.click(screen.getByLabelText('Expand Ruy Lopez'));
		await waitFor(() => screen.getByText('Ruy Lopez (chapter)'));

		const ruyCheckbox = screen.getByRole('checkbox', { name: /Ruy Lopez \(chapter\)/ }) as HTMLInputElement;
		const italianCheckbox = screen.getByRole('checkbox', { name: /Italian Game \(chapter\)/ }) as HTMLInputElement;

		// Click Ruy Lopez first — its request is deferred, not yet resolved.
		await fireEvent.click(ruyCheckbox);
		expect(ruyCheckbox.checked).toBe(false); // applied optimistically

		// While Ruy Lopez's request is still in flight, toggle Italian Game
		// too — its request resolves immediately and succeeds.
		await fireEvent.click(italianCheckbox);
		await waitFor(() => expect(italianCheckbox.checked).toBe(false));

		// Now let Ruy Lopez's slow request fail.
		resolveSlowPost!({ ok: false });
		await waitFor(() => expect(screen.getByText("Couldn't update that — try again.")).toBeTruthy());

		// Ruy Lopez correctly reverts to checked (its own failed toggle) —
		// but Italian Game's already-successful exclude must survive, not
		// get wiped out by Ruy Lopez's revert.
		expect(ruyCheckbox.checked).toBe(true);
		expect(italianCheckbox.checked).toBe(false);
	});

	it("preserves a concurrent chapter's own restore-selection snapshot when a different, slower chapter toggle later fails and reverts", async () => {
		// Ruy Lopez's own snapshot, once set by its own bulk-exclude, must
		// survive an unrelated concurrent chapter's revert untouched.
		let resolveSlowPost: ((value: { ok: boolean }) => void) | undefined;
		const fetchSpy = vi.fn((url: string, init?: any) => {
			if (!init) return Promise.resolve({ ok: true, json: async () => chapterVariationsResponse });
			const body = JSON.parse(init.body);
			if (body.variationKeys.includes('v3')) {
				// Italian Game's bulk-exclude — deliberately left pending
				// until explicitly resolved below, simulating a slow
				// request that ultimately fails.
				return new Promise((resolve) => {
					resolveSlowPost = resolve;
				});
			}
			// Every other request (Ruy Lopez's exclude, then its restore)
			// resolves immediately and succeeds.
			return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
		});
		vi.stubGlobal('fetch', fetchSpy);
		render(RepertoirePracticeRow, { props: { rep: { ...baseRep, fullVariationCount: 3 } } });

		await fireEvent.click(screen.getByLabelText('Expand Ruy Lopez'));
		await waitFor(() => screen.getByText('Ruy Lopez (chapter)'));

		const italianCheckbox = screen.getByRole('checkbox', { name: /Italian Game \(chapter\)/ }) as HTMLInputElement;

		// Click Italian Game first — its request is deferred, not yet
		// resolved (and will fail later).
		await fireEvent.click(italianCheckbox);
		expect(italianCheckbox.checked).toBe(false);

		// While that's in flight, bulk-exclude Ruy Lopez (fully checked, so
		// its snapshot remembers both v1 and v2) — this request resolves
		// immediately and succeeds.
		const ruyCheckbox = screen.getByRole('checkbox', { name: /Ruy Lopez \(chapter\)/ }) as HTMLInputElement;
		await fireEvent.click(ruyCheckbox);
		await waitFor(() =>
			expect(fetchSpy).toHaveBeenCalledWith('/api/repertoires/rep-1/exclusions', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ variationKeys: ['v1', 'v2'], included: false })
			})
		);
		expect(ruyCheckbox.checked).toBe(false);

		// Now let Italian Game's slow request fail — its own revert must not
		// wipe out Ruy Lopez's already-recorded snapshot entry.
		resolveSlowPost!({ ok: false });
		await waitFor(() => expect(screen.getByText("Couldn't update that — try again.")).toBeTruthy());

		// Re-checking Ruy Lopez now must restore exactly v1 and v2 (from its
		// own surviving snapshot), unaffected by Italian Game's revert.
		await fireEvent.click(ruyCheckbox);
		await waitFor(() =>
			expect(fetchSpy).toHaveBeenLastCalledWith('/api/repertoires/rep-1/exclusions', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ variationKeys: ['v1', 'v2'], included: true })
			})
		);
	});

	it("bulk-toggling a move-group bucket checkbox only excludes that bucket's own variations, leaving a sibling bucket untouched", async () => {
		const fetchSpy = vi
			.fn()
			.mockResolvedValueOnce({ ok: true, json: async () => siblingResponse })
			.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
		vi.stubGlobal('fetch', fetchSpy);
		render(RepertoirePracticeRow, { props: { rep: { ...baseRep, fullVariationCount: 3 } } });

		await fireEvent.click(screen.getByLabelText('Expand Ruy Lopez'));
		await waitFor(() => screen.getByText('Ruy Lopez (chapter)'));
		await fireEvent.click(screen.getByLabelText('Expand Ruy Lopez chapter'));
		// v1/v2 (sharing the first-5-moves window) form one bucket; v3 (a
		// short, unrelated line) forms its own sibling bucket.
		await waitFor(() => expect(screen.getByLabelText(`Include ${SHARED_BUCKET_TEXT} in Ruy Lopez in practice`)).toBeTruthy());
		expect(screen.getByText(/1\.d4 d5/)).toBeTruthy();

		const bucketCheckbox = screen.getByRole('checkbox', {
			name: `Include ${SHARED_BUCKET_TEXT} in Ruy Lopez in practice`
		}) as HTMLInputElement;
		expect(bucketCheckbox.checked).toBe(true);
		await fireEvent.click(bucketCheckbox);

		await waitFor(() =>
			expect(fetchSpy).toHaveBeenLastCalledWith('/api/repertoires/rep-1/exclusions', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ variationKeys: ['v1', 'v2'], included: false })
			})
		);
		const otherBucketCheckbox = screen.getByRole('checkbox', {
			name: /Include 1\.d4 d5 in Ruy Lopez in practice/
		}) as HTMLInputElement;
		expect(otherBucketCheckbox.checked).toBe(true); // a sibling bucket, unaffected
	});

	it('clicking an indeterminate chapter checkbox selects every variation in the chapter, including ones a bucket had independently excluded', async () => {
		const fetchSpy = vi
			.fn()
			.mockResolvedValueOnce({ ok: true, json: async () => siblingResponse })
			.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
		vi.stubGlobal('fetch', fetchSpy);
		render(RepertoirePracticeRow, { props: { rep: { ...baseRep, fullVariationCount: 3 } } });

		await fireEvent.click(screen.getByLabelText('Expand Ruy Lopez'));
		await waitFor(() => screen.getByText('Ruy Lopez (chapter)'));
		await fireEvent.click(screen.getByLabelText('Expand Ruy Lopez chapter'));
		await waitFor(() => screen.getByLabelText(`Include ${SHARED_BUCKET_TEXT} in Ruy Lopez in practice`));

		// Step 1: independently bulk-exclude the shared bucket (v1, v2).
		const bucketCheckbox = screen.getByRole('checkbox', {
			name: `Include ${SHARED_BUCKET_TEXT} in Ruy Lopez in practice`
		}) as HTMLInputElement;
		await fireEvent.click(bucketCheckbox);
		await waitFor(() =>
			expect(fetchSpy).toHaveBeenLastCalledWith('/api/repertoires/rep-1/exclusions', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ variationKeys: ['v1', 'v2'], included: false })
			})
		);

		// Step 2: the chapter is now indeterminate (v3 still included, v1/v2
		// excluded via the bucket). Clicking it selects EVERYTHING in the
		// chapter — including v1/v2, overriding the bucket's own exclusion —
		// rather than excluding whatever's still included (v3).
		const chapterCheckbox = screen.getByRole('checkbox', { name: /Ruy Lopez \(chapter\)/ }) as HTMLInputElement;
		expect(chapterCheckbox.indeterminate).toBe(true);
		await fireEvent.click(chapterCheckbox);
		await waitFor(() =>
			expect(fetchSpy).toHaveBeenLastCalledWith('/api/repertoires/rep-1/exclusions', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ variationKeys: ['v1', 'v2', 'v3'], included: true })
			})
		);
		expect(bucketCheckbox.checked).toBe(true); // re-included by the chapter-level select-all
		expect(chapterCheckbox.checked).toBe(true);
		expect(chapterCheckbox.indeterminate).toBe(false);

		// Now fully checked -> the next click excludes the whole chapter.
		await fireEvent.click(chapterCheckbox);
		await waitFor(() =>
			expect(fetchSpy).toHaveBeenLastCalledWith('/api/repertoires/rep-1/exclusions', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ variationKeys: ['v1', 'v2', 'v3'], included: false })
			})
		);
	});

	it('drilling into a move-group bucket within a chapter reveals its individual variations with their own checkboxes', async () => {
		const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => siblingResponse });
		vi.stubGlobal('fetch', fetchSpy);
		render(RepertoirePracticeRow, { props: { rep: { ...baseRep, fullVariationCount: 3 } } });

		await fireEvent.click(screen.getByLabelText('Expand Ruy Lopez'));
		await waitFor(() => screen.getByText('Ruy Lopez (chapter)'));
		await fireEvent.click(screen.getByLabelText('Expand Ruy Lopez chapter'));
		await waitFor(() => screen.getByLabelText(`Include ${SHARED_BUCKET_TEXT} in Ruy Lopez in practice`));

		await fireEvent.click(screen.getByLabelText(`Expand ${SHARED_BUCKET_TEXT} in Ruy Lopez`));
		expect(screen.getByText('label:v1')).toBeTruthy();
		expect(screen.getByText('label:v2')).toBeTruthy();
	});

	// v1 belongs to BOTH chapters — one row carrying two chapter names (a shared
	// tabiya cross-referenced under two headings), not two rows sharing one
	// variationKey. v2 is Ruy Lopez's own; v3 is Italian Game's own.
	const sharedLineResponse = [
		row('v1', ['e4', 'e5', 'Nf3'], ['Ruy Lopez', 'Italian Game']),
		row('v2', ['e4', 'e5', 'Bc4'], ['Ruy Lopez']),
		row('v3', ['d4', 'd5', 'c4'], ['Italian Game'])
	];

	it('shows a line belonging to two chapters under BOTH of them', async () => {
		const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => sharedLineResponse });
		vi.stubGlobal('fetch', fetchSpy);
		render(RepertoirePracticeRow, { props: { rep: { ...baseRep, fullVariationCount: 3 } } });

		await fireEvent.click(screen.getByLabelText('Expand Ruy Lopez'));
		await waitFor(() => screen.getByText('Ruy Lopez (chapter)'));
		// Each chapter counts the shared line: Ruy Lopez has v1 + v2, Italian
		// Game has v1 + v3 — two chapters of 2, from only 3 distinct lines.
		expect(screen.getAllByText('· 2 lines')).toHaveLength(2);

		await fireEvent.click(screen.getByLabelText('Expand Ruy Lopez chapter'));
		await fireEvent.click(screen.getByLabelText('Expand 1.e4 e5 2.Nf3 in Ruy Lopez'));
		expect(screen.getByText('label:v1')).toBeTruthy();

		await fireEvent.click(screen.getByLabelText('Expand Italian Game chapter'));
		await fireEvent.click(screen.getByLabelText('Expand 1.e4 e5 2.Nf3 in Italian Game'));
		// Once under each chapter — the same row rendered in both subtrees.
		expect(screen.getAllByText('label:v1')).toHaveLength(2);
	});

	it("bulk-toggling a chapter includes the lines it SHARES with another chapter, not just its exclusive ones", async () => {
		const fetchSpy = vi
			.fn()
			.mockResolvedValueOnce({ ok: true, json: async () => sharedLineResponse })
			.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
		vi.stubGlobal('fetch', fetchSpy);
		render(RepertoirePracticeRow, { props: { rep: { ...baseRep, fullVariationCount: 3 } } });

		await fireEvent.click(screen.getByLabelText('Expand Ruy Lopez'));
		await waitFor(() => screen.getByText('Ruy Lopez (chapter)'));

		// Membership, not equality: the old `chapterName === name` filter posted
		// only v3 here, silently leaving the shared line included.
		await fireEvent.click(screen.getByRole('checkbox', { name: /Italian Game \(chapter\)/ }));
		await waitFor(() =>
			expect(fetchSpy).toHaveBeenLastCalledWith('/api/repertoires/rep-1/exclusions', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ variationKeys: ['v1', 'v3'], included: false })
			})
		);

		// And the effect is visible from the other chapter, since it's one line:
		// Ruy Lopez reads indeterminate (v1 now excluded, v2 still included).
		expect((screen.getByRole('checkbox', { name: /Ruy Lopez \(chapter\)/ }) as HTMLInputElement).indeterminate).toBe(true);
	});

	it('toggling a shared line under one chapter shows as toggled under the other too, since it is one line', async () => {
		const fetchSpy = vi
			.fn()
			.mockResolvedValueOnce({ ok: true, json: async () => sharedLineResponse })
			.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
		vi.stubGlobal('fetch', fetchSpy);
		render(RepertoirePracticeRow, { props: { rep: { ...baseRep, fullVariationCount: 3 } } });

		await fireEvent.click(screen.getByLabelText('Expand Ruy Lopez'));
		await waitFor(() => screen.getByText('Ruy Lopez (chapter)'));

		// Uncheck the shared line from inside Italian Game.
		await fireEvent.click(screen.getByLabelText('Expand Italian Game chapter'));
		await fireEvent.click(screen.getByLabelText('Expand 1.e4 e5 2.Nf3 in Italian Game'));
		await fireEvent.click(within(screen.getByText('label:v1').closest('label')!).getByRole('checkbox'));
		await waitFor(() =>
			expect(fetchSpy).toHaveBeenLastCalledWith('/api/repertoires/rep-1/exclusions', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ variationKeys: ['v1'], included: false })
			})
		);
		expect((screen.getByRole('checkbox', { name: /Ruy Lopez \(chapter\)/ }) as HTMLInputElement).indeterminate).toBe(true);

		// Its copy under Ruy Lopez reflects the same exclusion, and re-checking
		// it there re-includes the one shared line for both chapters.
		await fireEvent.click(screen.getByLabelText('Expand Ruy Lopez chapter'));
		await fireEvent.click(screen.getByLabelText('Expand 1.e4 e5 2.Nf3 in Ruy Lopez'));
		const [underRuy, underItalian] = screen
			.getAllByText('label:v1')
			.map((el) => within(el.closest('label')!).getByRole('checkbox') as HTMLInputElement);
		expect(underRuy.checked).toBe(false);
		expect(underItalian.checked).toBe(false);

		await fireEvent.click(underRuy);
		await waitFor(() =>
			expect(fetchSpy).toHaveBeenLastCalledWith('/api/repertoires/rep-1/exclusions', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ variationKeys: ['v1'], included: true })
			})
		);
		expect((screen.getByRole('checkbox', { name: /Italian Game \(chapter\)/ }) as HTMLInputElement).checked).toBe(true);
	});

	it('gives untagged lines their own bucket, listed last, in an otherwise-chaptered repertoire', async () => {
		// A chaptered import appended onto pre-0048 (untagged) moves: without an
		// explicit bucket, v2 matches no chapter and is unreachable here.
		const mixed = [row('v1', ['e4', 'e5', 'Nf3'], ['Ruy Lopez']), row('v2', ['d4', 'd5'], [])];
		const fetchSpy = vi
			.fn()
			.mockResolvedValueOnce({ ok: true, json: async () => mixed })
			.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
		vi.stubGlobal('fetch', fetchSpy);
		render(RepertoirePracticeRow, { props: { rep: { ...baseRep, fullVariationCount: 2 } } });

		await fireEvent.click(screen.getByLabelText('Expand Ruy Lopez'));
		await waitFor(() => screen.getByText('Ruy Lopez (chapter)'));
		const headings = screen.getAllByText(/\(chapter\)|Lines without a chapter/).map((el) => el.textContent!.trim());
		expect(headings[headings.length - 1]).toContain(UNTAGGED_CHAPTER); // rendered last

		// It behaves like any other chapter tier: expandable down to its lines...
		await fireEvent.click(screen.getByLabelText(`Expand ${UNTAGGED_CHAPTER}`));
		await fireEvent.click(screen.getByLabelText(`Expand 1.d4 d5 in ${UNTAGGED_CHAPTER}`));
		expect(screen.getByText('label:v2')).toBeTruthy();

		// ...and bulk-selectable, touching only its own untagged rows.
		await fireEvent.click(screen.getByRole('checkbox', { name: `Include ${UNTAGGED_CHAPTER} in practice` }));
		await waitFor(() =>
			expect(fetchSpy).toHaveBeenLastCalledWith('/api/repertoires/rep-1/exclusions', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ variationKeys: ['v2'], included: false })
			})
		);
		expect((screen.getByRole('checkbox', { name: /Ruy Lopez \(chapter\)/ }) as HTMLInputElement).checked).toBe(true);
	});

	it('shows no untagged bucket when every line is chaptered', async () => {
		const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => chapterVariationsResponse });
		vi.stubGlobal('fetch', fetchSpy);
		render(RepertoirePracticeRow, { props: { rep: { ...baseRep, fullVariationCount: 3 } } });

		await fireEvent.click(screen.getByLabelText('Expand Ruy Lopez'));
		await waitFor(() => screen.getByText('Ruy Lopez (chapter)'));
		expect(screen.queryByText(UNTAGGED_CHAPTER, { exact: false })).toBeNull();
	});

	it('shows the checkbox and expand control even when the repertoire has no chapters, as long as it has variations', () => {
		render(RepertoirePracticeRow, { props: { rep: { ...baseRep, hasChapters: false } } });
		expect(screen.getByRole('checkbox', { name: 'Include Ruy Lopez in practice' })).toBeTruthy();
		expect(screen.getByLabelText('Expand Ruy Lopez')).toBeTruthy();
	});

	it('fetches and shows a first-5-moves bucket even when the repertoire has no chapters', async () => {
		const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => variationsResponse });
		vi.stubGlobal('fetch', fetchSpy);
		render(RepertoirePracticeRow, { props: { rep: { ...baseRep, hasChapters: false } } });

		await fireEvent.click(screen.getByLabelText('Expand Ruy Lopez'));
		await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith('/api/repertoires/rep-1/variations'));
		expect(screen.getByText(SHARED_BUCKET_LABEL)).toBeTruthy();
	});
});

describe('status chip', () => {
	// Learning vs Learned is the visible half of #99's derived status. Mastered
	// joins once #100 writes chapter-mastery records.
	it('reads Learning while variations remain un-learned', () => {
		render(RepertoirePracticeRow, {
			props: {
				rep: {
					id: 'r1',
					name: 'French Defense',
					color: 'white',
					solved: 1,
					total: 3,
					allSolved: false,
					fullVariationCount: 3,
					excludedVariationCount: 0,
					hasChapters: false
				}
			}
		});
		expect(screen.getByText('Learning')).toBeTruthy();
		expect(screen.getByText('1/3 variations learned')).toBeTruthy();
	});

	it('reads Learned once every variation is learned', () => {
		render(RepertoirePracticeRow, {
			props: {
				rep: {
					id: 'r1',
					name: 'French Defense',
					color: 'white',
					solved: 3,
					total: 3,
					allSolved: true,
					fullVariationCount: 3,
					excludedVariationCount: 0,
					hasChapters: false
				}
			}
		});
		expect(screen.getByText('Learned')).toBeTruthy();
	});

	it('shows no status chip for a repertoire with no moves', () => {
		render(RepertoirePracticeRow, {
			props: {
				rep: {
					id: 'r1',
					name: 'Empty',
					color: 'white',
					solved: 0,
					total: 0,
					allSolved: false,
					fullVariationCount: 0,
					excludedVariationCount: 0,
					hasChapters: false
				}
			}
		});
		expect(screen.queryByText('Learning')).toBeNull();
		expect(screen.getByText('No moves yet')).toBeTruthy();
	});
});
