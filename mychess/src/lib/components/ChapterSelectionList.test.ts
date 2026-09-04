// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/svelte';
import ChapterSelectionList, { type ChapterRow } from './ChapterSelectionList.svelte';

afterEach(cleanup);

const ROWS: ChapterRow[] = [
	{ id: '0', title: '1) Rare Moves #1', metaLine: '42 lines · 12 ply', detailLine: '1.e4 e6 2.d4 d5', selectable: true },
	{ id: '1', title: '4…Bf5 with 6…Nc6', metaLine: '38 lines · 14 ply', selectable: true },
	{ id: '2', title: 'Model games — Kramnik', metaLine: '2 lines · 44 ply', hint: '44 plies across 2 lines', selectable: true },
	{ id: '3', title: '4…Bf5 model games', metaLine: '9 lines · 6 ply', selectable: true }
];

/**
 * Renders with a fixed selection plus a spy for the selection the component
 * asks for next. The component does not own the selection — the caller does —
 * so a bulk action is asserted on what it REQUESTS, while rendered checkbox
 * states are asserted from the `selectedIds` it was handed.
 *
 * Note this is a plain `.test.ts`, so runes are not available here: `$state`
 * only compiles in `.svelte` / `.svelte.ts` files. That is a second reason the
 * component takes a callback instead of `$bindable` — a bindable prop cannot
 * be observed from a test file like this one at all.
 */
function renderList(selectedIds: string[], rows: ChapterRow[] = ROWS) {
	const onselect = vi.fn();
	render(ChapterSelectionList, {
		props: { rows, selectedIds: new Set(selectedIds), summary: '4 chapters', onselect }
	});
	return onselect;
}

/** The one selection the component asked for, sorted for a stable assertion. */
function requested(onselect: ReturnType<typeof vi.fn>): string[] {
	expect(onselect).toHaveBeenCalledTimes(1);
	return [...(onselect.mock.calls[0][0] as Set<string>)].sort();
}

function master() {
	return screen.getByRole('checkbox', { name: 'Select all chapters' }) as HTMLInputElement;
}

describe('ChapterSelectionList', () => {
	it('renders one row per chapter, with its meta and detail lines', () => {
		renderList(['0', '1', '2', '3']);
		expect(screen.getByText('1) Rare Moves #1')).toBeTruthy();
		expect(screen.getByText('42 lines · 12 ply')).toBeTruthy();
		expect(screen.getByText('1.e4 e6 2.d4 d5')).toBeTruthy();
		expect(screen.getAllByRole('checkbox', { name: /^Select / })).toHaveLength(5); // 4 rows + master
	});

	it('shows the caller-supplied summary', () => {
		renderList([]);
		expect(screen.getByText('4 chapters')).toBeTruthy();
	});

	it('renders an advisory hint without changing the row selection', () => {
		const onselect = renderList(['0', '1', '2', '3']);
		expect(screen.getByText('44 plies across 2 lines')).toBeTruthy();
		// The flagged row stays checked, and the component asks for nothing.
		expect(
			(screen.getByRole('checkbox', { name: 'Select Model games — Kramnik' }) as HTMLInputElement).checked
		).toBe(true);
		expect(onselect).not.toHaveBeenCalled();
	});

	it('is checked when everything is selected and unchecked when nothing is', () => {
		renderList(['0', '1', '2', '3']);
		expect(master().checked).toBe(true);
		expect(master().indeterminate).toBe(false);
		cleanup();
		renderList([]);
		expect(master().checked).toBe(false);
		expect(master().indeterminate).toBe(false);
	});

	it('is indeterminate when only some are selected', () => {
		renderList(['0']);
		expect(master().indeterminate).toBe(true);
	});

	it('Select all requests every row', async () => {
		const onselect = renderList(['0']);
		await fireEvent.click(screen.getByRole('button', { name: 'Select all' }));
		expect(requested(onselect)).toEqual(['0', '1', '2', '3']);
	});

	it('Select none requests an empty selection', async () => {
		const onselect = renderList(['0', '1', '2', '3']);
		await fireEvent.click(screen.getByRole('button', { name: 'Select none' }));
		expect(requested(onselect)).toEqual([]);
	});

	it('Invert flips every row', async () => {
		const onselect = renderList(['0', '2']);
		await fireEvent.click(screen.getByRole('button', { name: 'Invert' }));
		expect(requested(onselect)).toEqual(['1', '3']);
	});

	it('toggling one row requests only that change', async () => {
		const onselect = renderList(['0', '1']);
		await fireEvent.click(screen.getByRole('checkbox', { name: 'Select 4…Bf5 with 6…Nc6' }));
		expect(requested(onselect)).toEqual(['0']);
	});

	it('clicking the master checkbox when partially selected requests everything', async () => {
		const onselect = renderList(['0']);
		await fireEvent.click(master());
		expect(requested(onselect)).toEqual(['0', '1', '2', '3']);
	});

	it('clicking the master checkbox when fully selected requests nothing', async () => {
		const onselect = renderList(['0', '1', '2', '3']);
		await fireEvent.click(master());
		expect(requested(onselect)).toEqual([]);
	});

	it('filters rows by title', async () => {
		renderList([]);
		await fireEvent.input(screen.getByLabelText('Filter chapters'), { target: { value: 'model games' } });
		expect(screen.getByText('Model games — Kramnik')).toBeTruthy();
		expect(screen.getByText('4…Bf5 model games')).toBeTruthy();
		expect(screen.queryByText('1) Rare Moves #1')).toBeNull();
	});

	it('Select all under an active filter requests only the visible rows', async () => {
		const onselect = renderList([]);
		await fireEvent.input(screen.getByLabelText('Filter chapters'), { target: { value: 'model games' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Select all 2 matching' }));
		expect(requested(onselect)).toEqual(['2', '3']);
	});

	it('Select all under a filter does not re-select a hidden row the user rejected', async () => {
		// '0' was deliberately left unselected AND is hidden by the filter — the
		// exact case that makes an unscoped "select all" destructive.
		const onselect = renderList(['1', '3']);
		await fireEvent.input(screen.getByLabelText('Filter chapters'), { target: { value: 'model games' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Select all 2 matching' }));
		expect(requested(onselect)).toEqual(['1', '2', '3']);
	});

	it('says so when a filter matches nothing', async () => {
		renderList([]);
		await fireEvent.input(screen.getByLabelText('Filter chapters'), { target: { value: 'zzz' } });
		expect(screen.getByText('No chapters match that filter.')).toBeTruthy();
	});

	it('renders a non-selectable row without a checkbox, showing its hint instead', () => {
		renderList([], [
			{ id: 'untagged', title: 'Lines without a chapter', metaLine: '5 lines', hint: 'Delete the repertoire instead', selectable: false }
		]);
		expect(screen.getByText('Lines without a chapter')).toBeTruthy();
		expect(screen.getByText('Delete the repertoire instead')).toBeTruthy();
		expect(screen.queryByRole('checkbox', { name: 'Select Lines without a chapter' })).toBeNull();
	});

	it('ignores non-selectable rows in bulk actions', async () => {
		const onselect = renderList([], [
			{ id: '0', title: 'A', metaLine: '1 line', selectable: true },
			{ id: 'untagged', title: 'Lines without a chapter', metaLine: '5 lines', selectable: false }
		]);
		await fireEvent.click(screen.getByRole('button', { name: 'Select all' }));
		expect(requested(onselect)).toEqual(['0']);
	});

	it('ignores non-selectable rows in the master aggregate', () => {
		// Only the one selectable row is selected, so the master reads fully
		// checked — the untagged row must not hold it at indeterminate forever.
		renderList(['0'], [
			{ id: '0', title: 'A', metaLine: '1 line', selectable: true },
			{ id: 'untagged', title: 'Lines without a chapter', metaLine: '5 lines', selectable: false }
		]);
		expect(master().checked).toBe(true);
		expect(master().indeterminate).toBe(false);
	});
});
