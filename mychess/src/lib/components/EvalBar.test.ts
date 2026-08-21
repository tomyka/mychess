// @vitest-environment jsdom
// mychess/src/lib/components/EvalBar.test.ts
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import EvalBar from './EvalBar.svelte';
import { engineState } from '$lib/engine/engine.svelte';

const FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

beforeEach(() => {
	// engineState is a module-level singleton shared across every test in the
	// process — reset it explicitly rather than relying on it starting fresh.
	engineState.failed = false;
	engineState.ready = true;
	engineState.score = null;
	engineState.searching = false;
});

afterEach(() => {
	cleanup();
	engineState.score = null;
	engineState.ready = false;
	engineState.searching = false;
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
	// Always visible: there is no preference to switch it off, and it must not
	// vanish just because the engine hasn't answered (or can't).
	it('still renders an even bar when the engine failed to load', () => {
		engineState.failed = true;
		const { container } = render(EvalBar, { props: { fen: FEN, orientation: 'white', height: 400 } });
		const bar = container.querySelector('[role="img"]');
		expect(bar).not.toBeNull();
		expect(bar?.getAttribute('aria-label')).toBe('Engine evaluation unavailable');
		expect(segments(container).map((s) => s.height)).toEqual(['50%', '50%']);
	});

	// The bug behind "it wasn't showing evaluations": positions change faster
	// than a 400ms search finishes wherever moves play themselves, so clearing
	// the score per request left the bar blank through the whole autoplay intro.
	it('keeps the previous number up, dimmed, while the next search runs', () => {
		engineState.score = { cp: 120 };
		engineState.searching = true;
		const { container } = render(EvalBar, { props: { fen: FEN, orientation: 'white', height: 400 } });
		const num = container.querySelector('[role="img"] span') as HTMLElement;
		expect(num.textContent?.trim()).toBe('+1.2');
		expect(num.className).toContain('opacity-60');
	});

	// The board doesn't shift sideways between evaluations: the bar holds its
	// width and sits level until a score arrives.
	it('holds an even bar before the first score', () => {
		const { container } = render(EvalBar, { props: { fen: FEN, orientation: 'white', height: 400 } });
		expect(segments(container).map((s) => s.height)).toEqual(['50%', '50%']);
	});

	it('fills from the bottom in White for a player with the white pieces', () => {
		engineState.score = { cp: 200 }; // +2.00 => white 0.7 of the bar
		const { container } = render(EvalBar, { props: { fen: FEN, orientation: 'white', height: 400 } });
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
		const { container } = render(EvalBar, { props: { fen: FEN, orientation: 'black', height: 400 } });
		const [top, bottom] = segments(container);
		expect(bottom.className).toContain(BLACK);
		expect(bottom.height).toBe('30%');
		expect(top.className).toContain(WHITE);
		expect(top.height).toBe('70%');
	});

	it('matches the board\'s own rendered height', () => {
		const { container } = render(EvalBar, { props: { fen: FEN, orientation: 'white', height: 512 } });
		expect((container.querySelector('[role="img"]') as HTMLElement).style.height).toBe('512px');
	});

	it('names the current evaluation for assistive tech', () => {
		engineState.score = { cp: -150 };
		const { container } = render(EvalBar, { props: { fen: FEN, orientation: 'white', height: 400 } });
		expect(container.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('Engine evaluation -1.5');
	});

	// The number's POSITION carries who's ahead, so its sign can stay
	// White-relative without flipping with the board.
	it('prints the evaluation inside the larger segment, at that segment\'s outer end', () => {
		engineState.score = { cp: 200 }; // White clearly better
		const { container } = render(EvalBar, { props: { fen: FEN, orientation: 'white', height: 400 } });
		const num = container.querySelector('[role="img"] span') as HTMLElement;
		expect(num.textContent?.trim()).toBe('+2.0');
		// White's segment is the bottom one for a white player, and it's the
		// bigger one here — so the number sits at the bottom, in dark ink.
		expect(num.className).toContain('bottom-1');
		expect(num.className).toContain('text-[#26262b]');
	});

	it('moves the number to the other end when the opponent is ahead', () => {
		engineState.score = { cp: 200 }; // White better, but the player has black
		const { container } = render(EvalBar, { props: { fen: FEN, orientation: 'black', height: 400 } });
		const num = container.querySelector('[role="img"] span') as HTMLElement;
		expect(num.textContent?.trim()).toBe('+2.0'); // sign unchanged: White-relative
		expect(num.className).toContain('top-1'); // White's segment is the top one here
		expect(num.className).toContain('text-[#26262b]');
	});

	it('shows a dash, not a blank, before the first score', () => {
		const { container } = render(EvalBar, { props: { fen: FEN, orientation: 'white', height: 400 } });
		expect((container.querySelector('[role="img"] span') as HTMLElement).textContent?.trim()).toBe('–');
	});

	it('rounds to one decimal', () => {
		engineState.score = { cp: -135 };
		const { container } = render(EvalBar, { props: { fen: FEN, orientation: 'white', height: 400 } });
		expect((container.querySelector('[role="img"] span') as HTMLElement).textContent?.trim()).toBe('-1.4');
	});

	// #126: the drilling path shows a precomputed number and never spawns an
	// engine. jsdom has no Worker, so an attempted spawn shows up as failed.
	it('uses the precomputed eval, without needing the engine at all', () => {
		const { container } = render(EvalBar, {
			props: { fen: FEN, bookEval: { cp: 150 }, orientation: 'white', height: 400 }
		});
		expect((container.querySelector('[role="img"] span') as HTMLElement).textContent?.trim()).toBe('+1.5');
		expect(engineState.failed).toBe(false); // never tried to spawn
		expect(segments(container).map((s) => s.height)).toEqual(['35%', '65%']);
	});

	it('flips a precomputed eval with the board, like a live one', () => {
		const { container } = render(EvalBar, {
			props: { fen: FEN, bookEval: { cp: 150 }, orientation: 'black', height: 400 }
		});
		const [top, bottom] = segments(container);
		expect(top.height).toBe('65%'); // White's share, now at the top
		expect(bottom.height).toBe('35%');
	});

	// Explore mode's off-book positions have no stored eval, so the engine is
	// what answers there — and its answer supersedes any stored one.
	it('prefers a live score for the current position over the stored one', () => {
		engineState.score = { cp: -80 };
		engineState.searching = false;
		const { container } = render(EvalBar, {
			props: { fen: FEN, bookEval: { cp: 150 }, orientation: 'white', height: 400 }
		});
		expect((container.querySelector('[role="img"] span') as HTMLElement).textContent?.trim()).toBe('-0.8');
	});

	it('falls back to the stored eval while a live search is still running', () => {
		engineState.score = { cp: -80 }; // the PREVIOUS position's answer
		engineState.searching = true;
		const { container } = render(EvalBar, {
			props: { fen: FEN, bookEval: { cp: 150 }, orientation: 'white', height: 400 }
		});
		expect((container.querySelector('[role="img"] span') as HTMLElement).textContent?.trim()).toBe('+1.5');
	});

	it('shows a mate eval from the stored value', () => {
		const { container } = render(EvalBar, {
			props: { fen: FEN, bookEval: { mate: 3 }, orientation: 'white', height: 400 }
		});
		expect((container.querySelector('[role="img"] span') as HTMLElement).textContent?.trim()).toBe('M3');
		expect(segments(container).map((s) => s.height)).toEqual(['0%', '100%']);
	});
});
