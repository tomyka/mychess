// @vitest-environment jsdom
// mychess/src/lib/components/EngineEval.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import EngineEval from './EngineEval.svelte';
import { enginePrefStore } from '$lib/enginePref.svelte';

beforeEach(() => {
	// enginePrefStore is a module-level singleton shared across every test
	// in this file (and every other file importing it in the same
	// process) — reset it explicitly rather than relying on it starting
	// fresh. Most tests here exercise the engine itself, so default to on;
	// the "disabled" tests below set it back to false explicitly.
	enginePrefStore.enabled = true;
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	document.cookie = 'engine_eval=; path=/; max-age=0';
});

const FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

it('renders a switch that is off by default and spawns no Worker until switched on', () => {
	enginePrefStore.enabled = false;

	class SpyWorker {
		constructor() {
			throw new Error('should not construct a Worker while the toggle is off');
		}
	}
	vi.stubGlobal('Worker', SpyWorker as unknown as typeof Worker);

	const { getByRole, unmount } = render(EngineEval, { props: { fen: FEN } });
	const toggle = getByRole('switch', { name: 'Toggle engine evaluation' });
	expect(toggle.getAttribute('aria-checked')).toBe('false');
	unmount();
});

it('shows "unavailable" (not a crash, not a silent blank) when the engine is unavailable', () => {
	// The real, deployed jsdom test environment has no Worker global —
	// confirms EngineEval degrades gracefully with zero mocking needed, and
	// says so explicitly rather than rendering nothing (which used to be
	// indistinguishable from "still loading").
	const { getByText, unmount } = render(EngineEval, { props: { fen: FEN } });
	expect(getByText('unavailable')).toBeTruthy();
	unmount();
});

it('clicking the switch toggles enginePrefStore, which every instance shares', async () => {
	enginePrefStore.enabled = false;
	const { getByRole, unmount } = render(EngineEval, { props: { fen: FEN } });
	const toggle = getByRole('switch', { name: 'Toggle engine evaluation' });

	toggle.click();
	flushSync();
	expect(enginePrefStore.enabled).toBe(true);
	expect(toggle.getAttribute('aria-checked')).toBe('true');

	unmount();
});

it('always shows the "Engine" label, even when the toggle is off', () => {
	enginePrefStore.enabled = false;
	const { getByText, unmount } = render(EngineEval, { props: { fen: FEN } });
	expect(getByText('Engine')).toBeTruthy();
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
	sent: string[] = [];

	constructor(public url: string) {
		FakeWorker.instances.push(this);
	}

	postMessage(cmd: string) {
		this.sent.push(cmd);
	}

	terminate() {
		this.terminated = true;
	}

	/** Simulates the real engine emitting one UCI protocol line back to the page. */
	emit(line: string) {
		this.onmessage?.({ data: line } as MessageEvent<string>);
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

	it('tears the Worker down and resets the failed state when switched off, so switching back on retries cleanly', () => {
		vi.stubGlobal('Worker', FakeWorker as unknown as typeof Worker);

		const { getByRole } = render(EngineEval, { props: { fen: FEN } });
		expect(FakeWorker.instances.length).toBe(1);

		FakeWorker.instances[0].onerror?.();
		expect(FakeWorker.instances[0].terminated).toBe(true);

		// Switch off, then back on — while still mounted (no unmount involved).
		enginePrefStore.enabled = false;
		flushSync();
		enginePrefStore.enabled = true;
		flushSync();

		// A fresh Worker got constructed — the earlier failure didn't stick.
		expect(FakeWorker.instances.length).toBe(2);
		const toggle = getByRole('switch', { name: 'Toggle engine evaluation' });
		expect(toggle.getAttribute('aria-checked')).toBe('true');
	});

	it('walks the full UCI handshake and updates the displayed eval once a score arrives', () => {
		// The lifecycle tests above never actually exercise a successful
		// scored round-trip (jsdom has no real Worker to talk to) — this
		// drives a fake one through the exact handshake the real Stockfish
		// build performs, to directly verify the reactive path from a raw
		// UCI line to the rendered text, rather than assuming it works.
		vi.stubGlobal('Worker', FakeWorker as unknown as typeof Worker);

		const { getByText, queryByText } = render(EngineEval, { props: { fen: FEN } });
		const worker = FakeWorker.instances[0];

		expect(worker.sent).toContain('uci');
		worker.emit('uciok');
		flushSync();
		expect(worker.sent).toContain('isready');
		worker.emit('readyok');
		flushSync();

		// Once ready, the fen effect should have kicked off a real search.
		expect(worker.sent.some((cmd) => cmd.startsWith('position fen'))).toBe(true);
		expect(worker.sent.some((cmd) => cmd.startsWith('go movetime'))).toBe(true);

		// Loading state before any score has arrived.
		expect(getByText('…')).toBeTruthy();

		worker.emit('info depth 12 seldepth 18 multipv 1 score cp 35 nodes 1000 nps 500000 time 20 pv e2e4 e7e5');
		flushSync();

		expect(getByText('+0.35')).toBeTruthy();
		expect(queryByText('…')).toBeNull();
	});

	it('gives up and shows "unavailable" if the handshake never completes', () => {
		// Covers the exact symptom reported in production: the engine loads
		// (a real Worker gets constructed, no onerror fires) but never
		// reaches "uciok"/"readyok", so it would otherwise sit on the
		// loading ellipsis forever with no visible sign anything's wrong.
		vi.useFakeTimers();
		vi.stubGlobal('Worker', FakeWorker as unknown as typeof Worker);

		const { getByText } = render(EngineEval, { props: { fen: FEN } });
		expect(getByText('…')).toBeTruthy();

		vi.advanceTimersByTime(8000);
		flushSync();

		expect(getByText('unavailable')).toBeTruthy();
		vi.useRealTimers();
	});

	it('does not time out once the handshake completes before the deadline', () => {
		vi.useFakeTimers();
		vi.stubGlobal('Worker', FakeWorker as unknown as typeof Worker);

		const { getByText, queryByText } = render(EngineEval, { props: { fen: FEN } });
		const worker = FakeWorker.instances[0];

		worker.emit('uciok');
		flushSync();
		worker.emit('readyok');
		flushSync();

		vi.advanceTimersByTime(8000);
		flushSync();

		expect(queryByText('unavailable')).toBeNull();
		expect(getByText('…')).toBeTruthy();
		vi.useRealTimers();
	});
});
