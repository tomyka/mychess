// mychess/src/lib/engine/stockfishProcess.ts
//
// Driving the bundled Stockfish from Node, for the precompute job.
//
// It is spawned as a CLI and spoken to over stdin/stdout, which is the vendor's
// own Node path (`require.main === module` in the bootstrap sets up exactly this
// interface). Loading it in-process and calling `ccall('command', ...)` instead
// looks tidier and does not work: the bootstrap's command queueing — the part
// that holds a `go` back until `_isSearching()` clears — only exists on its CLI
// and worker paths, and driving the ccall directly from inside the output
// listener overflows the stack. Verified both ways before settling here.
//
// The `.cjs` copy of the bootstrap is what gets spawned: this package is
// `"type": "module"`, so Node parses the `.js` original as ESM and the UMD
// wrapper fails. Its wasm sibling is found by basename, which is why the copy
// keeps the same stem.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { bestScoreFromInfoLines, sideToMoveFromFen, toWhiteRelative, type EngineScore } from './uci';
import { SEARCH_MOVETIME_MS } from './version';

export const ENGINE_CLI_PATH = 'static/stockfish/stockfish-18-lite-single.cjs';

/** How long to wait for the uci/isready handshake before giving up on the process. */
const HANDSHAKE_TIMEOUT_MS = 30_000;
/** Slack on top of the search time before a single position is called lost. */
const SEARCH_TIMEOUT_SLACK_MS = 15_000;

export class StockfishProcess {
	private child: ChildProcessWithoutNullStreams | null = null;
	private buffer = '';
	private onLine: ((line: string) => void) | null = null;

	constructor(private cliPath: string = ENGINE_CLI_PATH) {}

	/** Spawns the engine and completes the UCI handshake. */
	async start(): Promise<void> {
		const child = spawn(process.execPath, [this.cliPath], { stdio: ['pipe', 'pipe', 'pipe'] });
		this.child = child;
		child.stdout.setEncoding('utf8');
		child.stdout.on('data', (chunk: string) => {
			this.buffer += chunk;
			const lines = this.buffer.split('\n');
			this.buffer = lines.pop() ?? '';
			for (const line of lines) this.onLine?.(line.trim());
		});

		await this.await(
			(line) => line.includes('uciok'),
			() => this.send('uci'),
			HANDSHAKE_TIMEOUT_MS,
			'uciok'
		);
		await this.await(
			(line) => line.includes('readyok'),
			() => this.send('isready'),
			HANDSHAKE_TIMEOUT_MS,
			'readyok'
		);
	}

	/**
	 * Evaluates one position, WHITE-relative. Null for a position that is already
	 * over (`bestmove (none)` — mate or stalemate on the board) or that produced
	 * no scored line at all; both are legitimate outcomes, not failures.
	 */
	async evaluate(fen: string, movetimeMs: number = SEARCH_MOVETIME_MS): Promise<EngineScore | null> {
		const lines: string[] = [];
		let terminal = false;
		await this.await(
			(line) => {
				if (line.startsWith('info ')) lines.push(line);
				// `bestmove (none)` is the engine saying the position is over. Its
				// info lines still carry a score (measured: `cp 0` for a position
				// already mated), and storing that would draw a dead-level bar on a
				// finished game — so the terminal flag wins over the score below.
				if (line.startsWith('bestmove')) {
					terminal = line.includes('(none)');
					return true;
				}
				return false;
			},
			() => {
				this.send('ucinewgame');
				this.send(`position fen ${fen}`);
				this.send(`go movetime ${movetimeMs}`);
			},
			movetimeMs + SEARCH_TIMEOUT_SLACK_MS,
			'bestmove'
		);
		if (terminal) return null;
		const best = bestScoreFromInfoLines(lines);
		if (!best) return null;
		// The engine reports from the side to move; everything downstream — the
		// bar, the number, the stored column — is White-relative.
		return toWhiteRelative(best.score, sideToMoveFromFen(fen));
	}

	stop() {
		if (!this.child) return;
		try {
			this.send('quit');
		} catch {
			// Already gone; the kill below is what matters.
		}
		this.child.kill('SIGKILL');
		this.child = null;
	}

	private send(cmd: string) {
		if (!this.child) throw new Error('engine not started');
		this.child.stdin.write(`${cmd}\n`);
	}

	/** Resolves when `match` accepts a line; `trigger` runs after the listener is armed. */
	private await(
		match: (line: string) => boolean,
		trigger: () => void,
		timeoutMs: number,
		what: string
	): Promise<void> {
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.onLine = null;
				reject(new Error(`timed out waiting for ${what}`));
			}, timeoutMs);
			this.onLine = (line) => {
				if (!match(line)) return;
				clearTimeout(timer);
				this.onLine = null;
				resolve();
			};
			trigger();
		});
	}
}
