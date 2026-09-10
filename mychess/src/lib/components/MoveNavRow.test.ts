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
