// mychess/src/lib/components/MoveNavRow.test.ts
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import MoveNavRow from './MoveNavRow.svelte';

afterEach(() => cleanup());

const baseProps = {
	reviewIdx: 2,
	reviewMoves: 2,
	totalMoves: 10,
	isReviewing: true,
	onstart: vi.fn(),
	onback: vi.fn(),
	onforward: vi.fn(),
	onlive: vi.fn()
};

describe('MoveNavRow', () => {
	it('does not render an explore button when onExplore is omitted', () => {
		render(MoveNavRow, { props: baseProps });
		expect(screen.queryByRole('button', { name: 'Explore this position' })).toBeNull();
	});

	it('renders a working explore button when onExplore is provided', async () => {
		const onExplore = vi.fn();
		const { getByRole } = render(MoveNavRow, { props: { ...baseProps, onExplore } });
		const button = getByRole('button', { name: 'Explore this position' });
		expect(button).toBeTruthy();
		await button.click();
		expect(onExplore).toHaveBeenCalledTimes(1);
	});

	// #161: the explore button must stay put and only grey out, never
	// disappear -- swapping onExplore itself between a function and undefined
	// changed the row's own column count (5 vs 6), causing the exact layout
	// shift this component exists to avoid for its other five buttons.
	it('keeps the explore button mounted, just disabled, when exploreDisabled is set', async () => {
		const onExplore = vi.fn();
		const { getByRole } = render(MoveNavRow, {
			props: { ...baseProps, onExplore, exploreDisabled: true }
		});
		const button = getByRole('button', { name: 'Explore this position' }) as HTMLButtonElement;
		expect(button.disabled).toBe(true);
		await button.click();
		expect(onExplore).not.toHaveBeenCalled();
	});
});

// GitHub issue #217. The hint offer used to be a 48px card above the board on
// mobile (PracticeStatusStrip's hintable slot). Here it costs no height at all,
// because this row already exists.
describe('MoveNavRow hint key', () => {
	it('does not render a hint button when onhint is omitted', () => {
		render(MoveNavRow, { props: baseProps });
		expect(screen.queryByRole('button', { name: 'Show a hint' })).toBeNull();
	});

	it('renders a working hint button when onhint is provided', async () => {
		const onhint = vi.fn();
		const { getByRole } = render(MoveNavRow, { props: { ...baseProps, onhint } });
		const button = getByRole('button', { name: 'Show a hint' });
		await button.click();
		expect(onhint).toHaveBeenCalledTimes(1);
	});

	// Same rule the explore key earned in #161: a caller that offers hints at
	// all passes a stable `onhint` for the page's lifetime and toggles
	// `hintDisabled`. Swapping the prop itself would change the column count
	// (6 vs 7) on every phase change and shift the row under the board.
	it('keeps the hint button mounted, just disabled, when hintDisabled is set', async () => {
		const onhint = vi.fn();
		const { getByRole } = render(MoveNavRow, {
			props: { ...baseProps, onhint, hintDisabled: true }
		});
		const button = getByRole('button', { name: 'Show a hint' }) as HTMLButtonElement;
		expect(button.disabled).toBe(true);
		await button.click();
		expect(onhint).not.toHaveBeenCalled();
	});

	// The column count is what the #161 comment is actually protecting, so
	// assert it rather than trusting the two flags above to imply it.
	it('grids to seven columns when both the explore and hint keys are present', () => {
		const { container } = render(MoveNavRow, {
			props: { ...baseProps, onExplore: vi.fn(), onhint: vi.fn(), hintDisabled: true }
		});
		const row = container.querySelector('div.grid') as HTMLElement;
		expect(row.className).toContain('grid-cols-7');
	});
});
