// @vitest-environment jsdom
// mychess/src/lib/components/EngineEval.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import EngineEval from './EngineEval.svelte';

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

const FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

it('renders nothing (no crash) when the engine is unavailable (no Worker global at all)', () => {
	// The real, deployed jsdom test environment has no Worker global —
	// confirms EngineEval degrades gracefully with zero mocking needed.
	const { container, unmount } = render(EngineEval, { props: { fen: FEN } });
	expect(container.textContent?.trim()).toBe('');
	unmount();
});

/**
 * A minimal fake Worker whose construction is directly observable — used to
 * prove ensureWorker() actually retries spawning a fresh Worker after the
 * shared singleton state has fully reset, rather than just asserting on
 * rendered output (which looks identical — empty — whether or not that
 * retry happens, since jsdom can't run the real WASM engine either way).
 */
class FakeWorker {
	static instances: FakeWorker[] = [];
	onmessage: ((event: MessageEvent<string>) => void) | null = null;
	onerror: (() => void) | null = null;
	terminated = false;

	constructor(public url: string) {
		FakeWorker.instances.push(this);
	}

	postMessage() {
		/* no-op — this test only cares whether/how many Workers get constructed */
	}

	terminate() {
		this.terminated = true;
	}
}

describe('EngineEval Worker singleton lifecycle', () => {
	afterEach(() => {
		FakeWorker.instances.length = 0;
	});

	it('spawns exactly one Worker when two instances mount simultaneously (desktop + mobile)', () => {
		vi.stubGlobal('Worker', FakeWorker as unknown as typeof Worker);

		const a = render(EngineEval, { props: { fen: FEN } });
		const b = render(EngineEval, { props: { fen: FEN } });

		expect(FakeWorker.instances.length).toBe(1);

		a.unmount();
		b.unmount();
	});

	it('keeps the Worker alive while at least one instance remains mounted', () => {
		vi.stubGlobal('Worker', FakeWorker as unknown as typeof Worker);

		const a = render(EngineEval, { props: { fen: FEN } });
		const b = render(EngineEval, { props: { fen: FEN } });
		expect(FakeWorker.instances.length).toBe(1);

		a.unmount();
		expect(FakeWorker.instances[0].terminated).toBe(false);

		b.unmount();
		expect(FakeWorker.instances[0].terminated).toBe(true);
	});

	it('retries spawning a new Worker on a later mount after a prior failure, once fully unmounted', () => {
		// This is the actual regression case: before the fix, a failed
		// instance left the module-level `failed` flag stuck `true` forever,
		// so ensureWorker()'s `if (worker || failed) return;` guard silently
		// prevented ANY later mount from ever constructing a new Worker
		// again, for the rest of the session. Counting real constructor
		// calls is the only way to observe that distinction — rendered
		// output is empty either way, whether the retry happens or not.
		vi.stubGlobal('Worker', FakeWorker as unknown as typeof Worker);

		const first = render(EngineEval, { props: { fen: FEN } });
		expect(FakeWorker.instances.length).toBe(1);

		// Simulate the engine failing (e.g. a WASM load error).
		FakeWorker.instances[0].onerror?.();
		first.unmount();

		const second = render(EngineEval, { props: { fen: FEN } });
		expect(FakeWorker.instances.length).toBe(2);

		second.unmount();
	});
});
