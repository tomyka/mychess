// mychess/src/lib/components/VariationPicker.test.ts
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/svelte';
import VariationPicker from './VariationPicker.svelte';

afterEach(() => cleanup());

const variationsResponse = [
	{ variationKey: 'v1', label: '1.e4 e5 2.Nf3 Nc6 3.Bb5', included: true, chapterName: 'Ruy Lopez', firstMoveSan: 'e4', solved: false },
	{ variationKey: 'v2', label: '1.e4 e5 2.Nf3 Nc6 3.Bc4', included: true, chapterName: 'Ruy Lopez', firstMoveSan: 'e4', solved: true },
	{ variationKey: 'v3', label: '1.d4 d5 2.c4', included: true, chapterName: 'Italian Game', firstMoveSan: 'd4', solved: false }
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

	it('drills into a chapter to show its move groups, then into a move group to show variations', async () => {
		const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => variationsResponse });
		vi.stubGlobal('fetch', fetchSpy);
		render(VariationPicker, { props: { repertoireId: 'rep-1', onselect: vi.fn(), onclose: vi.fn() } });

		await waitFor(() => screen.getByText('Ruy Lopez'));
		await fireEvent.click(screen.getByText('Ruy Lopez'));
		expect(screen.getByText('e4')).toBeTruthy(); // move-group bucket

		await fireEvent.click(screen.getByText('e4'));
		expect(screen.getByText('1.e4 e5 2.Nf3 Nc6 3.Bb5')).toBeTruthy();
		expect(screen.getByText('1.e4 e5 2.Nf3 Nc6 3.Bc4')).toBeTruthy();
	});

	it('marks an already-solved variation and still allows picking it', async () => {
		const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => variationsResponse });
		vi.stubGlobal('fetch', fetchSpy);
		const onselect = vi.fn();
		render(VariationPicker, { props: { repertoireId: 'rep-1', onselect, onclose: vi.fn() } });

		await waitFor(() => screen.getByText('Ruy Lopez'));
		await fireEvent.click(screen.getByText('Ruy Lopez'));
		await fireEvent.click(screen.getByText('e4'));

		const solvedRow = screen.getByText('1.e4 e5 2.Nf3 Nc6 3.Bc4').closest('button')!;
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
		await fireEvent.click(screen.getByText('e4'));
		await fireEvent.click(screen.getByText('1.e4 e5 2.Nf3 Nc6 3.Bb5'));
		expect(onselect).toHaveBeenCalledWith('v1');
	});

	it('skips the chapter level entirely when no variation has a chapterName', async () => {
		const flat = [
			{ variationKey: 'v1', label: '1.e4 e5', included: true, chapterName: null, firstMoveSan: 'e4', solved: false }
		];
		const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => flat });
		vi.stubGlobal('fetch', fetchSpy);
		render(VariationPicker, { props: { repertoireId: 'rep-1', onselect: vi.fn(), onclose: vi.fn() } });

		await waitFor(() => expect(screen.getByText('e4')).toBeTruthy()); // straight to move groups, no chapter click needed
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
});
