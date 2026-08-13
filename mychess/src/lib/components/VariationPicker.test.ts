// mychess/src/lib/components/VariationPicker.test.ts
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/svelte';
import VariationPicker from './VariationPicker.svelte';

afterEach(() => cleanup());

// Builds a realistic VariationStep[] with correctly alternating side-to-move
// and move-number FEN fields, so moveSequenceLabel's numbering is accurate
// for a slice starting at any ply, not just the very first one.
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
	chapterName: string | null,
	opts: { included?: boolean; solved?: boolean } = {}
) {
	return {
		variationKey,
		label: `label:${variationKey}`, // stand-in for the server's own moveSequenceLabel(v.path) — irrelevant to grouping
		included: opts.included ?? true,
		chapterName,
		path: path(sans),
		solved: opts.solved ?? false
	};
}

// v1/v2 share "e4 e5 Nf3 Nc6" (4 plies) before forking on move 3; v3 is a
// single, unrelated line in a different chapter.
const variationsResponse = [
	row('v1', ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'], 'Ruy Lopez'),
	row('v2', ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'], 'Ruy Lopez', { solved: true }),
	row('v3', ['d4', 'd5', 'c4'], 'Italian Game')
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

	it('drills into a chapter to reveal its shared-prefix bucket, then into that bucket to reach the leaf variations', async () => {
		const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => variationsResponse });
		vi.stubGlobal('fetch', fetchSpy);
		render(VariationPicker, { props: { repertoireId: 'rep-1', onselect: vi.fn(), onclose: vi.fn() } });

		await waitFor(() => screen.getByText('Ruy Lopez'));
		await fireEvent.click(screen.getByText('Ruy Lopez'));
		// v1 and v2 share their first 4 plies — collapsed into one bucket,
		// not split into separate per-move tiers.
		expect(screen.getByText(/1\.e4 e5 2\.Nf3 Nc6/)).toBeTruthy();
		expect(screen.queryByText('label:v1')).toBeNull();

		await fireEvent.click(screen.getByText(/1\.e4 e5 2\.Nf3 Nc6/));
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
		await fireEvent.click(screen.getByText(/1\.e4 e5 2\.Nf3 Nc6/));

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
		await fireEvent.click(screen.getByText(/1\.e4 e5 2\.Nf3 Nc6/));
		await fireEvent.click(screen.getByText('label:v1'));
		expect(onselect).toHaveBeenCalledWith('v1');
	});

	it('the "Back" button returns from the fork bucket to the chapter list', async () => {
		const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => variationsResponse });
		vi.stubGlobal('fetch', fetchSpy);
		render(VariationPicker, { props: { repertoireId: 'rep-1', onselect: vi.fn(), onclose: vi.fn() } });

		await waitFor(() => screen.getByText('Ruy Lopez'));
		await fireEvent.click(screen.getByText('Ruy Lopez'));
		await fireEvent.click(screen.getByText(/1\.e4 e5 2\.Nf3 Nc6/));
		await waitFor(() => screen.getByText('label:v1'));

		await fireEvent.click(screen.getByText('← Back'));
		expect(screen.queryByText('label:v1')).toBeNull();
		expect(screen.getByText(/1\.e4 e5 2\.Nf3 Nc6/)).toBeTruthy();

		await fireEvent.click(screen.getByText('← Back'));
		expect(screen.getByText('Ruy Lopez')).toBeTruthy();
		expect(screen.getByText('Italian Game')).toBeTruthy();
	});

	it('skips the chapter level entirely when no variation has a chapterName, still bucketing by shared prefix', async () => {
		const flat = [
			row('v1', ['e4', 'e5', 'Nf3'], null),
			row('v2', ['e4', 'e5', 'Nc3'], null),
			row('v3', ['d4', 'd5'], null)
		];
		const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => flat });
		vi.stubGlobal('fetch', fetchSpy);
		render(VariationPicker, { props: { repertoireId: 'rep-1', onselect: vi.fn(), onclose: vi.fn() } });

		// v1/v2 share "e4 e5" before forking — a real bucket to drill into.
		await waitFor(() => expect(screen.getByText(/1\.e4 e5/)).toBeTruthy());
		// v3 has no sibling to share a prefix with, so it collapses straight
		// to a leaf with no extra click.
		expect(screen.getByText('label:v3')).toBeTruthy();
		expect(screen.queryByText('(chapter)', { exact: false })).toBeNull();
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

	it('hides excluded variations entirely, collapsing straight to the one remaining leaf', async () => {
		const mixed = [row('v1', ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'], 'Ruy Lopez'), row('v2', ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'], 'Ruy Lopez', { included: false })];
		const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => mixed });
		vi.stubGlobal('fetch', fetchSpy);
		render(VariationPicker, { props: { repertoireId: 'rep-1', onselect: vi.fn(), onclose: vi.fn() } });

		await waitFor(() => screen.getByText('Ruy Lopez'));
		await fireEvent.click(screen.getByText('Ruy Lopez'));

		expect(screen.getByText('label:v1')).toBeTruthy();
		expect(screen.queryByText('label:v2')).toBeNull();
	});
});
