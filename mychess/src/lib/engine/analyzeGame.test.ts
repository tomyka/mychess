// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { analyzeGame } from './analyzeGame';

/**
 * Same fake-Worker pattern as EngineEval.test.ts: construction and every
 * posted command are directly observable, and `emit` synchronously invokes
 * whatever `onmessage` handler is currently assigned — since analyzeGame's
 * own message handler reassigns nothing between messages (it's one
 * persistent handler for the whole batch), a test can emit an entire
 * multi-position sequence synchronously with no timer/microtask juggling.
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

	emit(line: string) {
		this.onmessage?.({ data: line } as MessageEvent<string>);
	}
}

afterEach(() => {
	FakeWorker.instances.length = 0;
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

const FEN1 = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const FEN2 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';

it('runs one search per fen in sequence and resolves with one result each', async () => {
	vi.stubGlobal('Worker', FakeWorker as unknown as typeof Worker);

	const promise = analyzeGame([FEN1, FEN2], { movetimeMs: 10 });
	const worker = FakeWorker.instances[0];

	expect(worker.sent).toContain('uci');
	worker.emit('uciok');
	worker.emit('readyok');
	expect(worker.sent.some((c) => c === `position fen ${FEN1}`)).toBe(true);

	worker.emit('info depth 10 seldepth 12 multipv 1 score cp 30 nodes 1 nps 1 time 1 pv e2e4');
	worker.emit('bestmove e2e4 ponder e7e5');

	expect(worker.sent.some((c) => c === `position fen ${FEN2}`)).toBe(true);

	worker.emit('info depth 10 seldepth 12 multipv 1 score cp -15 nodes 1 nps 1 time 1 pv e7e5');
	worker.emit('bestmove e7e5');

	const result = await promise;
	expect(result).toEqual([
		{ score: { cp: 30 }, bestMoveUci: 'e2e4' },
		{ score: { cp: -15 }, bestMoveUci: 'e7e5' }
	]);
	expect(worker.terminated).toBe(true);
});

it('reports progress after each completed position', async () => {
	vi.stubGlobal('Worker', FakeWorker as unknown as typeof Worker);
	const onProgress = vi.fn();

	const promise = analyzeGame([FEN1], { movetimeMs: 10, onProgress });
	const worker = FakeWorker.instances[0];
	worker.emit('uciok');
	worker.emit('readyok');
	worker.emit('info depth 10 score cp 0 nodes 1 nps 1 time 1 pv e2e4');
	worker.emit('bestmove e2e4');

	await promise;
	expect(onProgress).toHaveBeenCalledWith(1, 1);
});

it('rejects if the handshake never completes', async () => {
	vi.useFakeTimers();
	vi.stubGlobal('Worker', FakeWorker as unknown as typeof Worker);

	const promise = analyzeGame([FEN1], { handshakeTimeoutMs: 8000 });
	const assertion = expect(promise).rejects.toThrow('Engine handshake timed out');
	await vi.advanceTimersByTimeAsync(8000);
	await assertion;
});

it('rejects if the engine errors mid-analysis', async () => {
	vi.stubGlobal('Worker', FakeWorker as unknown as typeof Worker);
	const promise = analyzeGame([FEN1], { movetimeMs: 10 });
	const worker = FakeWorker.instances[0];
	worker.emit('uciok');
	worker.emit('readyok');
	worker.onerror?.();
	await expect(promise).rejects.toThrow('Engine failed');
});

it('rejects immediately when Workers are unavailable', async () => {
	vi.stubGlobal('Worker', undefined as unknown as typeof Worker);
	await expect(analyzeGame([FEN1])).rejects.toThrow('Web Workers are not available');
});

it('rejects and terminates the worker when the signal is aborted mid-analysis', async () => {
	vi.stubGlobal('Worker', FakeWorker as unknown as typeof Worker);
	const controller = new AbortController();

	const promise = analyzeGame([FEN1], { movetimeMs: 10, signal: controller.signal });
	const worker = FakeWorker.instances[0];
	worker.emit('uciok');
	worker.emit('readyok');

	controller.abort();

	await expect(promise).rejects.toThrow('Analysis cancelled');
	expect(worker.terminated).toBe(true);
});
