// @vitest-environment jsdom
// mychess/src/lib/components/EngineEval.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import EngineEval from './EngineEval.svelte';

afterEach(() => {
	cleanup();
});

const FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

describe('EngineEval', () => {
	it('renders nothing (no crash) when the engine is unavailable, across repeated mount/unmount cycles', () => {
		// jsdom has no Worker global, so every mount hits the "engine
		// unavailable" path. This is the regression case for the bug where a
		// module-level `failed` flag could get stuck true forever after the
		// first mount/unmount cycle, because the teardown that's supposed to
		// reset it was accidentally skipped whenever the worker was already
		// null (i.e. exactly the failure case) — silently breaking every
		// later mount in the same session, not just the one that failed.
		const first = render(EngineEval, { props: { fen: FEN } });
		expect(first.container.textContent?.trim()).toBe('');
		first.unmount();

		const second = render(EngineEval, { props: { fen: FEN } });
		expect(second.container.textContent?.trim()).toBe('');
		second.unmount();

		const third = render(EngineEval, { props: { fen: FEN } });
		expect(third.container.textContent?.trim()).toBe('');
		third.unmount();
	});

	it('keeps working across two simultaneously-mounted instances (desktop + mobile), then cleans up when both unmount', () => {
		// Mirrors the Practice page's real usage: two instances mounted at
		// once, both driven by the same shared singleton.
		const a = render(EngineEval, { props: { fen: FEN, showBar: true } });
		const b = render(EngineEval, { props: { fen: FEN, showBar: false } });
		expect(a.container.textContent?.trim()).toBe('');
		expect(b.container.textContent?.trim()).toBe('');

		a.unmount();
		// b is still mounted — should still render without throwing.
		expect(b.container.textContent?.trim()).toBe('');
		b.unmount();

		// A fresh mount after both instances tore down should behave exactly
		// like a first-ever mount (this is what the fixed onDestroy
		// guarantees) — not silently do nothing because a stale `failed`
		// flag never got reset.
		const c = render(EngineEval, { props: { fen: FEN } });
		expect(c.container.textContent?.trim()).toBe('');
		c.unmount();
	});
});
