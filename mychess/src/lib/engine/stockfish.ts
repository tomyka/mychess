import type { EngineScore } from './classify';

const ENGINE_URL = '/stockfish/stockfish-18-lite-single.js';

let worker: Worker | null = null;
let readyPromise: Promise<void> | null = null;
let queue: Promise<unknown> = Promise.resolve();

function getWorker(): Worker {
	if (!worker) {
		worker = new Worker(ENGINE_URL);
	}
	return worker;
}

function resetEngine() {
	try {
		worker?.terminate();
	} catch {
		// ignore — best-effort cleanup of a worker that's already in a bad state
	}
	worker = null;
	readyPromise = null;
}

function waitForReady(): Promise<void> {
	if (readyPromise) return readyPromise;

	readyPromise = new Promise((resolve, reject) => {
		let w: Worker;
		try {
			w = getWorker();
		} catch (err) {
			resetEngine();
			reject(err);
			return;
		}

		const timeout = setTimeout(() => {
			cleanup();
			resetEngine();
			reject(new Error('Stockfish failed to become ready in time'));
		}, 15000);

		function onMessage(e: MessageEvent) {
			if (e.data === 'readyok') {
				cleanup();
				resolve();
			}
		}
		function onError(err: ErrorEvent) {
			cleanup();
			resetEngine();
			reject(err);
		}
		function cleanup() {
			clearTimeout(timeout);
			w.removeEventListener('message', onMessage);
			w.removeEventListener('error', onError);
		}

		w.addEventListener('message', onMessage);
		w.addEventListener('error', onError);
		w.postMessage('uci');
		w.postMessage('isready');
	});

	return readyPromise;
}

async function runEvaluation(fen: string, movetimeMs: number): Promise<EngineScore> {
	await waitForReady();
	const w = getWorker();

	return new Promise((resolve, reject) => {
		let latest: EngineScore = { cp: null, mate: null };

		const timeout = setTimeout(() => {
			cleanup();
			reject(new Error('Stockfish evaluation timed out'));
		}, movetimeMs + 5000);

		function onMessage(e: MessageEvent) {
			const line = e.data;
			if (typeof line !== 'string') return;

			const scoreMatch = line.match(/score (cp|mate) (-?\d+)/);
			if (scoreMatch) {
				const [, kind, value] = scoreMatch;
				latest = kind === 'cp' ? { cp: Number(value), mate: null } : { cp: null, mate: Number(value) };
			}

			if (line.startsWith('bestmove')) {
				cleanup();
				resolve(latest);
			}
		}
		function onError(err: ErrorEvent) {
			cleanup();
			reject(err);
		}
		function cleanup() {
			clearTimeout(timeout);
			w.removeEventListener('message', onMessage);
			w.removeEventListener('error', onError);
		}

		w.addEventListener('message', onMessage);
		w.addEventListener('error', onError);
		w.postMessage(`position fen ${fen}`);
		w.postMessage(`go movetime ${movetimeMs}`);
	});
}

/** Runs a fixed-time search on `fen` and resolves with the final evaluation. Rejects if the engine can't load or times out. Calls are serialized — a single Stockfish instance can only run one search at a time. */
export async function evaluatePosition(fen: string, movetimeMs: number): Promise<EngineScore> {
	const result = queue.then(() => runEvaluation(fen, movetimeMs));
	// Advance the queue regardless of whether this call succeeds or fails,
	// so one failed evaluation doesn't permanently block every call after it.
	queue = result.then(
		() => undefined,
		() => undefined
	);
	return result;
}
