// @vitest-environment jsdom
// mychess/src/lib/components/EvalBar.test.ts
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import EvalBar from './EvalBar.svelte';
import { enginePrefStore } from '$lib/enginePref.svelte';
import { engineState } from '$lib/engine/engine.svelte';

beforeEach(() => {
	// Both are module-level singletons shared across every test in the process.
	enginePrefStore.enabled = true;
	engineState.failed = false;
	engineState.ready = true;
	engineState.score = null;
});

afterEach(() => {
	cleanup();
	enginePrefStore.enabled = false;
	engineState.score = null;
	engineState.ready = false;
});

/** The bar's two stacked segments, top first. */
function segments(container: HTMLElement): { className: string; height: string }[] {
	const bar = container.querySelector('[role="img"]');
	if (!bar) return [];
	return [...bar.querySelectorAll(':scope > div')]
		.filter((el) => (el as HTMLElement).style.height !== '')
		.map((el) => ({ className: el.className, height: (el as HTMLElement).style.height }));
}

const WHITE = 'bg-[#f8f8f6]';
const BLACK = 'bg-[#26262b]';

describe('EvalBar', () => {
	it('renders nothing at all while the engine preference is off', () => {
		enginePrefStore.enabled = false;
		const { container } = render(EvalBar, { props: { orientation: 'white', height: 400 } });
		expect(container.querySelector('[role="img"]')).toBeNull();
	});

	it('renders nothing when the engine failed to load', () => {
		engineState.failed = true;
		const { container } = render(EvalBar, { props: { orientation: 'white', height: 400 } });
		expect(container.querySelector('[role="img"]')).toBeNull();
	});

	// The board doesn't shift sideways between evaluations: the bar holds its
	// width and sits level until a score arrives.
	it('holds an even bar before the first score', () => {
		const { container } = render(EvalBar, { props: { orientation: 'white', height: 400 } });
		expect(segments(container).map((s) => s.height)).toEqual(['50%', '50%']);
	});

	it('fills from the bottom in White for a player with the white pieces', () => {
		engineState.score = { cp: 200 }; // +2.00 => white 0.7 of the bar
		const { container } = render(EvalBar, { props: { orientation: 'white', height: 400 } });
		const [top, bottom] = segments(container);
		expect(bottom.className).toContain(WHITE);
		expect(bottom.height).toBe('70%');
		expect(top.className).toContain(BLACK);
		expect(top.height).toBe('30%');
	});

	// Same score, board flipped: the side you PLAY is always the bottom end, so
	// White's +2.00 now fills from the top instead of the numbers flipping.
	it('flips with the board for a player with the black pieces', () => {
		engineState.score = { cp: 200 };
		const { container } = render(EvalBar, { props: { orientation: 'black', height: 400 } });
		const [top, bottom] = segments(container);
		expect(bottom.className).toContain(BLACK);
		expect(bottom.height).toBe('30%');
		expect(top.className).toContain(WHITE);
		expect(top.height).toBe('70%');
	});

	it('matches the board\'s own rendered height', () => {
		const { container } = render(EvalBar, { props: { orientation: 'white', height: 512 } });
		expect((container.querySelector('[role="img"]') as HTMLElement).style.height).toBe('512px');
	});

	it('names the current evaluation for assistive tech', () => {
		engineState.score = { cp: -150 };
		const { container } = render(EvalBar, { props: { orientation: 'white', height: 400 } });
		expect(container.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('Engine evaluation -1.50');
	});
});
