// @vitest-environment jsdom
// mychess/src/lib/components/EvalBar.engine.test.ts
//
// The wiring between a live worker and what the bar actually shows. Ported from
// the deleted EngineEval.test.ts when the toggle/number card was replaced by the
// bar — the surface changed, the protocol didn't, and "it wasn't showing
// evaluations" is exactly the failure these cover.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import EvalBar from './EvalBar.svelte';
import { engineState, engineEnabled, setEngineEnabled } from '$lib/engine/engine.svelte';

const FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const NEXT_FEN = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';

/** A minimal fake Worker whose construction and traffic are both observable. */
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

/** Drives the handshake the way the real engine does, leaving it ready. */
function handshake(worker: FakeWorker) {
	worker.emit('uciok');
	flushSync();
	worker.emit('readyok');
	flushSync();
}

function barNumber(container: HTMLElement): string {
	return (container.querySelector('[role="img"] span') as HTMLElement).textContent?.trim() ?? '';
}

afterEach(() => {
	cleanup();
	FakeWorker.instances.length = 0;
	engineState.score = null;
	engineState.ready = false;
	engineState.failed = false;
	engineState.searching = false;
	engineEnabled.on = false;
});

describe('EvalBar against a live worker', () => {
	it('spawns the engine on mount, leaving the on/off decision to whoever renders it', () => {
		vi.stubGlobal('Worker', FakeWorker as unknown as typeof Worker);
		const { unmount } = render(EvalBar, { props: { fen: FEN, orientation: 'white', height: 400 } });
		expect(FakeWorker.instances.length).toBe(1);
		expect(FakeWorker.instances[0].sent).toContain('uci');
		unmount();
	});

	it('walks the handshake, searches the position it was given, and shows the score', () => {
		vi.stubGlobal('Worker', FakeWorker as unknown as typeof Worker);
		const { container, unmount } = render(EvalBar, { props: { fen: FEN, orientation: 'white', height: 400 } });
		const worker = FakeWorker.instances[0];

		handshake(worker);
		expect(worker.sent).toContain(`position fen ${FEN}`);
		expect(worker.sent.some((c) => c.startsWith('go movetime'))).toBe(true);

		worker.emit('info depth 12 seldepth 18 multipv 1 score cp 35 nodes 1000 nps 500000 time 20 pv e2e4 e7e5');
		flushSync();
		expect(barNumber(container)).toBe('+0.3');
		unmount();
	});

	// The reported symptom: through the autoplay intro the position changes every
	// 700ms while a search takes 400ms+, and the score used to be cleared on
	// every request — so the bar sat blank almost the whole time.
	it('keeps showing the last score while the next position is still searching', async () => {
		vi.stubGlobal('Worker', FakeWorker as unknown as typeof Worker);
		const { container, unmount, rerender } = render(EvalBar, {
			props: { fen: FEN, orientation: 'white', height: 400 }
		});
		const worker = FakeWorker.instances[0];
		handshake(worker);
		worker.emit('info depth 12 multipv 1 score cp 35 nodes 1 nps 1 time 1 pv e2e4');
		flushSync();
		expect(barNumber(container)).toBe('+0.3');

		// Next position arrives before the engine has answered for it.
		await rerender({ fen: NEXT_FEN, orientation: 'white', height: 400 });
		flushSync();
		expect(worker.sent).toContain(`position fen ${NEXT_FEN}`);
		expect(barNumber(container)).toBe('+0.3'); // held, not blanked
		expect(engineState.searching).toBe(true);

		worker.emit('info depth 12 multipv 1 score cp -20 nodes 1 nps 1 time 1 pv e7e5');
		flushSync();
		// A black-to-move score comes back Black-relative and is flipped to
		// White-relative, which is what the bar and its sign expect.
		expect(barNumber(container)).toBe('+0.2');
		expect(engineState.searching).toBe(false);
		unmount();
	});

	it('spawns exactly one Worker for two bars mounted at once, and keeps it while either lives', () => {
		vi.stubGlobal('Worker', FakeWorker as unknown as typeof Worker);
		const a = render(EvalBar, { props: { fen: FEN, orientation: 'white', height: 400 } });
		const b = render(EvalBar, { props: { fen: FEN, orientation: 'white', height: 400 } });
		expect(FakeWorker.instances.length).toBe(1);

		a.unmount();
		expect(FakeWorker.instances[0].terminated).toBe(false);
		b.unmount();
		expect(FakeWorker.instances[0].terminated).toBe(true);
	});

	it('retries spawning after a failure once fully unmounted, rather than staying dead for the session', () => {
		vi.stubGlobal('Worker', FakeWorker as unknown as typeof Worker);
		const first = render(EvalBar, { props: { fen: FEN, orientation: 'white', height: 400 } });
		FakeWorker.instances[0].onerror?.();
		first.unmount();

		const second = render(EvalBar, { props: { fen: FEN, orientation: 'white', height: 400 } });
		expect(FakeWorker.instances.length).toBe(2);
		second.unmount();
	});

	// The engine is now something the player switches on in explore mode, so
	// switching it off has to actually stop the worker — not just hide the bar.
	it('quits and terminates the worker when the engine is switched off', () => {
		vi.stubGlobal('Worker', FakeWorker as unknown as typeof Worker);
		const { unmount } = render(EvalBar, { props: { fen: FEN, orientation: 'white', height: 400 } });
		const worker = FakeWorker.instances[0];
		handshake(worker);
		worker.emit('info depth 12 multipv 1 score cp 35 nodes 1 nps 1 time 1 pv e2e4');
		flushSync();
		expect(engineState.score).not.toBeNull();

		setEngineEnabled(false);
		expect(worker.sent).toContain('quit');
		expect(worker.terminated).toBe(true);
		expect(engineState.score).toBeNull();
		expect(engineEnabled.on).toBe(false);

		setEngineEnabled(true);
		expect(engineEnabled.on).toBe(true);

		// Switching off deliberately does NOT touch retainEngine's instance count —
		// the bar is still mounted, so it is the one that releases its slot on
		// destroy. Unmounting it therefore has to land the count on exactly zero.
		// Had the switch-off zeroed it as well, this unmount would drive it to -1
		// and every count after it would be one short: the pair below would read as
		// a single bar, and the first unmount would kill a worker the second still
		// needs. So the pair is the assertion — a fresh worker for the fresh bars,
		// alive while either of them lives.
		unmount();
		const a = render(EvalBar, { props: { fen: FEN, orientation: 'white', height: 400 } });
		const b = render(EvalBar, { props: { fen: FEN, orientation: 'white', height: 400 } });
		expect(FakeWorker.instances.length).toBe(2);
		a.unmount();
		expect(FakeWorker.instances[1].terminated).toBe(false);
		b.unmount();
		expect(FakeWorker.instances[1].terminated).toBe(true);
	});
});
