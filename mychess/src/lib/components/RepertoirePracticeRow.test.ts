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
	fullVariationCount: 2,
	excludedVariationCount: 0
};

const variationsResponse = [
	{ variationKey: 'v1', label: '1.e4 e5 2.Nf3 Nc6 3.Bb5 a6', included: true },
	{ variationKey: 'v2', label: '1.e4 e5 2.Nf3 Nc6 3.Bb5 Nf6', included: true }
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
});
