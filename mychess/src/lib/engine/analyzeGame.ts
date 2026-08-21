import { parseInfoLine, type EngineScore } from './uci';

export type PositionAnalysis = { score: EngineScore; bestMoveUci: string };

export type AnalyzeGameOptions = {
	engineUrl?: string;
	movetimeMs?: number;
	handshakeTimeoutMs?: number;
	onProgress?: (done: number, total: number) => void;
	signal?: AbortSignal;
};

// Same binary EngineEval.svelte loads — see its comment for why the URL
// fragment matters (it tells the emscripten bootstrap where the .wasm is,
// and a bare load with no `,worker` suffix marks this as the top-level
// engine load rather than a nested multi-threaded worker).
const DEFAULT_ENGINE_URL = '/stockfish/stockfish-18-lite-single.js#stockfish-18-lite-single.wasm';
const DEFAULT_MOVETIME_MS = 500;
const DEFAULT_HANDSHAKE_TIMEOUT_MS = 8000;

/**
 * Runs one `go movetime` search per FEN, sequentially, on a dedicated
 * Worker — deliberately NOT the EngineEval module singleton, since this is
 * a one-shot batch job (analyze a whole game once) rather than a
 * persistent live-eval sidebar tracking a changing position. Resolves with
 * one PositionAnalysis per input FEN, in the same order.
 */
export function analyzeGame(
	fens: string[],
	options: AnalyzeGameOptions = {}
): Promise<PositionAnalysis[]> {
	const engineUrl = options.engineUrl ?? DEFAULT_ENGINE_URL;
	const movetimeMs = options.movetimeMs ?? DEFAULT_MOVETIME_MS;
	const handshakeTimeoutMs = options.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS;

	return new Promise((resolve, reject) => {
		if (typeof Worker === 'undefined') {
			reject(new Error('Web Workers are not available'));
			return;
		}

		let worker: Worker;
		try {
			worker = new Worker(engineUrl);
		} catch {
			reject(new Error('Failed to start the engine'));
			return;
		}

		const results: PositionAnalysis[] = [];
		let idx = 0;
		let ready = false;
		let lastScore: EngineScore = { cp: 0 };

		const handshakeTimeout = setTimeout(() => {
			worker.terminate();
			reject(new Error('Engine handshake timed out'));
		}, handshakeTimeoutMs);

		if (options.signal) {
			if (options.signal.aborted) {
				clearTimeout(handshakeTimeout);
				worker.terminate();
				reject(new Error('Analysis cancelled'));
				return;
			}
			options.signal.addEventListener('abort', () => {
				clearTimeout(handshakeTimeout);
				worker.terminate();
				reject(new Error('Analysis cancelled'));
			});
		}

		function searchNext() {
			if (idx >= fens.length) {
				worker.terminate();
				resolve(results);
				return;
			}
			lastScore = { cp: 0 };
			worker.postMessage(`position fen ${fens[idx]}`);
			worker.postMessage(`go movetime ${movetimeMs}`);
		}

		worker.onmessage = (event: MessageEvent<string>) => {
			const line = event.data;
			if (!ready) {
				if (line.includes('uciok')) worker.postMessage('isready');
				else if (line.includes('readyok')) {
					ready = true;
					clearTimeout(handshakeTimeout);
					searchNext();
				}
				return;
			}
			if (line.startsWith('bestmove')) {
				const bestMoveUci = line.split(' ')[1] ?? '0000';
				results.push({ score: lastScore, bestMoveUci });
				idx++;
				options.onProgress?.(idx, fens.length);
				searchNext();
				return;
			}
			const parsed = parseInfoLine(line);
			if (parsed) lastScore = parsed.score;
		};

		worker.onerror = () => {
			clearTimeout(handshakeTimeout);
			worker.terminate();
			reject(new Error('Engine failed'));
		};

		worker.postMessage('uci');
	});
}
