# Game Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a player upload a PGN of one of their own games, save it to a new "My Games" section, and review it on a board with a full client-side engine analysis — every move classified (Inaccuracy/Mistake/Blunder) against the engine's own top choice.

**Architecture:** Pure logic (`src/lib/games/`, `src/lib/engine/analyzeGame.ts`) is fully unit-tested with no DB or browser API involved beyond a mockable `Worker`. A thin `src/lib/server/games.ts` handles the one nontrivial write path (parse + insert); everything else is inlined directly in its route, matching the existing `repertoires` pages' own pattern. Three new pages under `src/routes/(player)/games/` reuse `ChessBoard`, `MoveNavRow`, and the existing Stockfish WASM binary (a *new*, dedicated Worker loop — not the `EngineEval` singleton, since this is a one-shot batch job, not a persistent live sidebar).

**Tech Stack:** SvelteKit 2 / Svelte 5 runes, chess.js, chessground (via the existing `ChessBoard.svelte`), Supabase (Postgres + RLS), the existing Stockfish 18 lite WASM build, Vitest + @testing-library/svelte.

**Spec:** `docs/superpowers/specs/2026-08-21-game-analysis-design.md`

**Schema:** Already applied to production — `supabase/migrations/0061_games.sql`. No new migration in this plan.

---

## Task 1: Extract a single game from a PGN (`src/lib/games/parse.ts`)

**Files:**
- Create: `src/lib/games/parse.ts`
- Test: `src/lib/games/parse.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// mychess/src/lib/games/parse.test.ts
import { describe, it, expect } from 'vitest';
import { extractSingleGame } from './parse';

describe('extractSingleGame', () => {
	it('extracts headers and mainline moves from a single-game PGN', () => {
		const pgn = '[Event "Test"]\n[White "Alice"]\n[Black "Bob"]\n\n1. e4 e5 2. Nf3 *';
		const result = extractSingleGame(pgn);
		if ('error' in result) throw new Error('expected success, got error: ' + result.error);
		expect(result.game.headers.White).toBe('Alice');
		expect(result.game.headers.Black).toBe('Bob');
		expect(result.game.moves.map((m) => m.san)).toEqual(['e4', 'e5', 'Nf3']);
		expect(result.game.moves[0].ply).toBe(1);
		expect(result.game.moves[0].parentFen).toBe(
			'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
		);
	});

	it('returns an error for a PGN with no legal moves', () => {
		const result = extractSingleGame('[Event "Empty"]\n\n*');
		expect(result).toEqual({ error: 'No valid game found in that PGN.' });
	});

	it('returns an error for a multi-game PGN, asking the user to split it', () => {
		const pgn = '[Event "A"]\n\n1. e4 e5 *\n\n[Event "B"]\n\n1. d4 d5 *';
		const result = extractSingleGame(pgn);
		expect(result).toEqual({ error: 'This file contains 2 games — upload one game at a time.' });
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/games/parse.test.ts`
Expected: FAIL — `Cannot find module './parse'`

- [ ] **Step 3: Write the implementation**

```typescript
// mychess/src/lib/games/parse.ts
import { parsePgn } from '$lib/pgn/parser';

export type GameMove = {
	ply: number;
	san: string;
	fen: string;
	parentFen: string;
};

export type ExtractedGame = {
	headers: Record<string, string>;
	moves: GameMove[];
};

export type ExtractGameResult = { game: ExtractedGame } | { error: string };

/**
 * Pulls exactly one game's mainline out of a PGN string, for the Analysis
 * upload flow — v1 is single-game-only, so this rejects anything that isn't
 * exactly one game rather than picking one for the caller. Variations
 * (RAV) in the source PGN are silently dropped; `parsePgn` already only
 * tracks them as a shared move graph, not a tree, which this flattens back
 * into a single ordered list assuming no branching (true for a real game
 * export, which is what this is for).
 */
export function extractSingleGame(pgnText: string): ExtractGameResult {
	const games = parsePgn(pgnText);
	if (games.length === 0) return { error: 'No valid game found in that PGN.' };
	if (games.length > 1) {
		return { error: `This file contains ${games.length} games — upload one game at a time.` };
	}
	const [game] = games;
	const moves: GameMove[] = game.moves.map((m) => ({
		ply: m.ply,
		san: m.san,
		fen: m.fen,
		parentFen: m.parentFen
	}));
	return { game: { headers: game.headers, moves } };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/games/parse.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/games/parse.ts src/lib/games/parse.test.ts
git commit -m "feat(games): extract a single game's mainline from a PGN"
```

---

## Task 2: Move classification math (`src/lib/games/classify.ts`)

**Files:**
- Create: `src/lib/games/classify.ts`
- Test: `src/lib/games/classify.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// mychess/src/lib/games/classify.test.ts
import { describe, it, expect } from 'vitest';
import { cpLoss, classifyMove } from './classify';

describe('cpLoss', () => {
	it('is zero when the position after the move matches the mover\'s own pre-move evaluation', () => {
		// Before: +30 for the mover (their own turn). After the move, relative
		// to the opponent (now to move): -30 — an exact match once negated
		// back to the mover's own perspective.
		expect(cpLoss({ cp: 30 }, { cp: -30 })).toBe(0);
	});

	it('is positive when the position got worse for the mover than the engine expected', () => {
		// Before: +100 for the mover. After, relative to the opponent: +50 —
		// i.e. -50 for the mover, a 150cp swing against them.
		expect(cpLoss({ cp: 100 }, { cp: 50 })).toBe(150);
	});

	it('never goes negative when the move outperforms the engine\'s expectation', () => {
		expect(cpLoss({ cp: 0 }, { cp: -50 })).toBe(0);
	});

	it('treats squandering a forced mate as a huge loss', () => {
		// Before: mate in 3 for the mover. After: a flat 0cp — the mate is gone.
		const loss = cpLoss({ mate: 3 }, { cp: 0 });
		expect(loss).toBeGreaterThan(200);
	});

	it('treats walking into a forced mate against you as a huge loss', () => {
		// After the move, the engine reports mate in 3 for whoever is now to
		// move (the opponent) — i.e. the mover just allowed a forced mate.
		const loss = cpLoss({ cp: 0 }, { mate: 3 });
		expect(loss).toBeGreaterThan(200);
	});
});

describe('classifyMove', () => {
	it('flags nothing under 25cp loss', () => {
		expect(classifyMove(0)).toBeNull();
		expect(classifyMove(24)).toBeNull();
	});

	it('flags 25-99cp loss as an inaccuracy', () => {
		expect(classifyMove(25)).toBe('inaccuracy');
		expect(classifyMove(99)).toBe('inaccuracy');
	});

	it('flags 100-199cp loss as a mistake', () => {
		expect(classifyMove(100)).toBe('mistake');
		expect(classifyMove(199)).toBe('mistake');
	});

	it('flags 200cp+ loss as a blunder', () => {
		expect(classifyMove(200)).toBe('blunder');
		expect(classifyMove(10000)).toBe('blunder');
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/games/classify.test.ts`
Expected: FAIL — `Cannot find module './classify'`

- [ ] **Step 3: Write the implementation**

```typescript
// mychess/src/lib/games/classify.ts
import type { EngineScore } from '$lib/engine/uci';

export type MoveClassification = 'inaccuracy' | 'mistake' | 'blunder' | null;

// Large enough that any mate score dominates the cp-loss comparison against
// a non-mate score, without needing separate mate-vs-mate/mate-vs-cp branches.
const MATE_CP_EQUIVALENT = 100_000;

function toCpEquivalent(score: EngineScore): number {
	if (score.mate !== undefined) return score.mate > 0 ? MATE_CP_EQUIVALENT : -MATE_CP_EQUIVALENT;
	return score.cp ?? 0;
}

/**
 * Centipawn loss for the side that just moved, from the raw UCI-convention
 * (side-to-move-relative) engine scores at the position before and after
 * the move. `beforeRaw` is already mover-relative — the mover was the side
 * to move in the position before their own move. `afterRaw` is relative to
 * the opponent, who is to move in the resulting position, so it's negated
 * to become mover-relative before the subtraction. Floored at 0: a move
 * that does better than the engine's own top choice isn't penalized.
 */
export function cpLoss(beforeRaw: EngineScore, afterRaw: EngineScore): number {
	const beforeMoverRelative = toCpEquivalent(beforeRaw);
	const afterMoverRelative = -toCpEquivalent(afterRaw);
	return Math.max(0, beforeMoverRelative - afterMoverRelative);
}

/**
 * An intentionally simple cp-loss cutoff — same spirit as the existing
 * `evalBarWhiteFraction`'s documented "good enough for a quick sanity
 * check, not a serious analysis tool" approach, not a win%-curve model.
 */
export function classifyMove(loss: number): MoveClassification {
	if (loss >= 200) return 'blunder';
	if (loss >= 100) return 'mistake';
	if (loss >= 25) return 'inaccuracy';
	return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/games/classify.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/games/classify.ts src/lib/games/classify.test.ts
git commit -m "feat(games): add cp-loss and move-classification math"
```

---

## Task 3: Client-side batch engine analysis (`src/lib/engine/analyzeGame.ts`)

**Files:**
- Create: `src/lib/engine/analyzeGame.ts`
- Test: `src/lib/engine/analyzeGame.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// mychess/src/lib/engine/analyzeGame.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/engine/analyzeGame.test.ts`
Expected: FAIL — `Cannot find module './analyzeGame'`

- [ ] **Step 3: Write the implementation**

```typescript
// mychess/src/lib/engine/analyzeGame.ts
import { parseInfoLine, type EngineScore } from './uci';

export type PositionAnalysis = { score: EngineScore; bestMoveUci: string };

export type AnalyzeGameOptions = {
	engineUrl?: string;
	movetimeMs?: number;
	handshakeTimeoutMs?: number;
	onProgress?: (done: number, total: number) => void;
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/engine/analyzeGame.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/engine/analyzeGame.ts src/lib/engine/analyzeGame.test.ts
git commit -m "feat(engine): add a batch full-game analysis runner"
```

---

## Task 4: Combine engine results into stored analysis entries (`src/lib/games/build-analysis.ts`)

**Files:**
- Create: `src/lib/games/build-analysis.ts`
- Test: `src/lib/games/build-analysis.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// mychess/src/lib/games/build-analysis.test.ts
import { describe, it, expect } from 'vitest';
import { buildAnalysis } from './build-analysis';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
const AFTER_E4_E5 = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2';

const moves = [
	{ ply: 1, san: 'e4', fen: AFTER_E4, parentFen: START_FEN },
	{ ply: 2, san: 'e5', fen: AFTER_E4_E5, parentFen: AFTER_E4 }
];

describe('buildAnalysis', () => {
	it('pairs each move with its before/after engine results and classifies it', () => {
		// One more result than moves: root position + one per move.
		const results = [
			{ score: { cp: 20 }, bestMoveUci: 'd2d4' }, // at START_FEN (white to move)
			{ score: { cp: -15 }, bestMoveUci: 'e7e5' }, // at AFTER_E4 (black to move)
			{ score: { cp: 10 }, bestMoveUci: 'g1f3' } // at AFTER_E4_E5 (white to move)
		];

		const analysis = buildAnalysis(moves, results);

		expect(analysis).toHaveLength(2);
		expect(analysis[0]).toEqual({
			ply: 1,
			// AFTER_E4 has black to move, so the raw -15 (black-relative) becomes
			// +15 once converted to white-relative for display.
			score: { cp: 15 },
			bestMoveSan: 'd4',
			classification: null
		});
		expect(analysis[1]).toEqual({
			ply: 2,
			// AFTER_E4_E5 has white to move, so the raw +10 is already white-relative.
			score: { cp: 10 },
			bestMoveSan: 'e5',
			classification: null
		});
	});

	it('classifies a move that loses significant ground', () => {
		const results = [
			{ score: { cp: 200 }, bestMoveUci: 'd2d4' },
			{ score: { cp: 190 }, bestMoveUci: 'e7e5' } // mover-relative: -190, a 390cp swing
		];
		const analysis = buildAnalysis([moves[0]], results);
		expect(analysis[0].classification).toBe('blunder');
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/games/build-analysis.test.ts`
Expected: FAIL — `Cannot find module './build-analysis'`

- [ ] **Step 3: Write the implementation**

```typescript
// mychess/src/lib/games/build-analysis.ts
import { Chess } from 'chess.js';
import { toWhiteRelative, sideToMoveFromFen, type EngineScore } from '$lib/engine/uci';
import { cpLoss, classifyMove, type MoveClassification } from './classify';
import type { GameMove } from './parse';
import type { PositionAnalysis } from '$lib/engine/analyzeGame';

export type AnalysisEntry = {
	ply: number;
	score: EngineScore;
	bestMoveSan: string;
	classification: MoveClassification;
};

/** UCI move like "e2e4" or "e7e8q" -> its SAN at `fen`, or '' if illegal there. */
function sanFromUci(fen: string, uci: string): string {
	if (uci.length < 4) return '';
	const from = uci.slice(0, 2);
	const to = uci.slice(2, 4);
	const promotion = uci.length > 4 ? uci.slice(4) : undefined;
	try {
		const move = new Chess(fen).move({ from, to, promotion });
		return move?.san ?? '';
	} catch {
		return '';
	}
}

/**
 * Combines the engine's raw per-position results with the game's own moves
 * into what the UI/DB actually store — one entry per move. `results` must
 * be exactly one longer than `moves`: the root position's result, then one
 * per move, matching the `fens` array `analyzeGame` was called with
 * (`[rootFen, ...moves.map(m => m.fen)]`).
 */
export function buildAnalysis(moves: GameMove[], results: PositionAnalysis[]): AnalysisEntry[] {
	return moves.map((move, i) => {
		const before = results[i];
		const after = results[i + 1];
		const loss = cpLoss(before.score, after.score);
		return {
			ply: move.ply,
			score: toWhiteRelative(after.score, sideToMoveFromFen(move.fen)),
			bestMoveSan: sanFromUci(move.parentFen, before.bestMoveUci),
			classification: classifyMove(loss)
		};
	});
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/games/build-analysis.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/games/build-analysis.ts src/lib/games/build-analysis.test.ts
git commit -m "feat(games): combine engine results into stored analysis entries"
```

---

## Task 5: Per-game classification summary (`src/lib/games/summary.ts`)

**Files:**
- Create: `src/lib/games/summary.ts`
- Test: `src/lib/games/summary.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// mychess/src/lib/games/summary.test.ts
import { describe, it, expect } from 'vitest';
import { summarizeAnalysis } from './summary';

describe('summarizeAnalysis', () => {
	it('returns null for an unanalyzed game', () => {
		expect(summarizeAnalysis(null)).toBeNull();
	});

	it('counts each classification, ignoring unflagged moves', () => {
		const analysis = [
			{ classification: 'blunder' as const },
			{ classification: 'blunder' as const },
			{ classification: 'mistake' as const },
			{ classification: 'inaccuracy' as const },
			{ classification: null }
		];
		expect(summarizeAnalysis(analysis)).toEqual({ blunders: 2, mistakes: 1, inaccuracies: 1 });
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/games/summary.test.ts`
Expected: FAIL — `Cannot find module './summary'`

- [ ] **Step 3: Write the implementation**

```typescript
// mychess/src/lib/games/summary.ts
import type { MoveClassification } from './classify';

export type AnalysisSummary = { blunders: number; mistakes: number; inaccuracies: number };

/** The "My Games" list card's per-category counts, or null before analysis has run. */
export function summarizeAnalysis(
	analysis: { classification: MoveClassification }[] | null
): AnalysisSummary | null {
	if (!analysis) return null;
	const summary: AnalysisSummary = { blunders: 0, mistakes: 0, inaccuracies: 0 };
	for (const entry of analysis) {
		if (entry.classification === 'blunder') summary.blunders++;
		else if (entry.classification === 'mistake') summary.mistakes++;
		else if (entry.classification === 'inaccuracy') summary.inaccuracies++;
	}
	return summary;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/games/summary.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/games/summary.ts src/lib/games/summary.test.ts
git commit -m "feat(games): add per-game move-classification summary"
```

---

## Task 6: Server-side game creation (`src/lib/server/games.ts`)

Not directly unit-tested — matches the established convention (`src/lib/server/pgn-import.ts` etc.) of a thin Supabase wrapper exercised through its pure-logic dependency's tests plus manual verification, not a copy of its own test suite.

**Files:**
- Create: `src/lib/server/games.ts`

- [ ] **Step 1: Write the implementation**

```typescript
// mychess/src/lib/server/games.ts
import type { SupabaseClient } from '@supabase/supabase-js';
import { extractSingleGame } from '$lib/games/parse';

export async function createGame(
	supabase: SupabaseClient,
	playerId: string,
	pgn: string,
	playedAs: 'white' | 'black' | null
): Promise<{ id: string } | { error: string }> {
	const parsed = extractSingleGame(pgn);
	if ('error' in parsed) return { error: parsed.error };

	const { data, error } = await supabase
		.from('games')
		.insert({
			player_id: playerId,
			pgn,
			headers: parsed.game.headers,
			played_as: playedAs,
			moves: parsed.game.moves,
			analysis_status: 'pending'
		})
		.select('id')
		.single();
	if (error) return { error: error.message };
	return { id: data.id };
}
```

- [ ] **Step 2: Type-check**

Run: `npm run check`
Expected: no new errors from this file.

- [ ] **Step 3: Commit**

```bash
git add src/lib/server/games.ts
git commit -m "feat(games): add server-side game creation"
```

---

## Task 7: `POST /api/games`

**Files:**
- Create: `src/routes/api/games/+server.ts`

- [ ] **Step 1: Write the implementation**

```typescript
// mychess/src/routes/api/games/+server.ts
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireApiUser } from '$lib/server/auth';
import { createGame } from '$lib/server/games';

export const POST: RequestHandler = async ({ request, locals }) => {
	const user = await requireApiUser(locals);
	const body = await request.json().catch(() => null);
	const { pgn, playedAs } = body ?? {};

	if (typeof pgn !== 'string' || !pgn.trim()) throw error(400, 'pgn is required');
	if (playedAs !== null && playedAs !== undefined && playedAs !== 'white' && playedAs !== 'black') {
		throw error(400, 'playedAs must be "white", "black", or null');
	}

	const result = await createGame(locals.supabase, user.id, pgn, playedAs ?? null);
	if ('error' in result) throw error(400, result.error);

	return json({ id: result.id });
};
```

- [ ] **Step 2: Type-check**

Run: `npm run check`
Expected: no new errors from this file.

- [ ] **Step 3: Commit**

```bash
git add src/routes/api/games/+server.ts
git commit -m "feat(games): add POST /api/games"
```

---

## Task 8: `POST /api/games/[id]/analysis`

**Files:**
- Create: `src/routes/api/games/[id]/analysis/+server.ts`

- [ ] **Step 1: Write the implementation**

```typescript
// mychess/src/routes/api/games/[id]/analysis/+server.ts
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireApiUser } from '$lib/server/auth';

function isAnalysisEntry(value: unknown): boolean {
	if (!value || typeof value !== 'object') return false;
	const e = value as Record<string, unknown>;
	return (
		typeof e.ply === 'number' &&
		!!e.score &&
		typeof e.score === 'object' &&
		typeof e.bestMoveSan === 'string' &&
		(e.classification === null || typeof e.classification === 'string')
	);
}

/**
 * Persists the full-game analysis a client just finished computing.
 * Ownership is checked before touching the body — a stray game id 404s
 * instead of failing generically on the write.
 */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	const user = await requireApiUser(locals);

	const { data: owned } = await locals.supabase
		.from('games')
		.select('id, moves')
		.eq('id', params.id)
		.eq('player_id', user.id)
		.maybeSingle();
	if (!owned) throw error(404, 'Game not found');

	const body = await request.json().catch(() => null);
	const { analysis } = body ?? {};
	if (!Array.isArray(analysis) || !analysis.every(isAnalysisEntry)) {
		throw error(400, 'analysis must be an array of analysis entries');
	}
	if (analysis.length !== (owned.moves as unknown[]).length) {
		throw error(400, "analysis length must match the game's move count");
	}

	const { error: err } = await locals.supabase
		.from('games')
		.update({ analysis, analysis_status: 'done' })
		.eq('id', params.id)
		.eq('player_id', user.id);
	if (err) throw error(400, err.message);

	return json({ ok: true });
};
```

- [ ] **Step 2: Type-check**

Run: `npm run check`
Expected: no new errors from this file.

- [ ] **Step 3: Commit**

```bash
git add "src/routes/api/games/[id]/analysis/+server.ts"
git commit -m "feat(games): add POST /api/games/[id]/analysis"
```

---

## Task 9: "My Games" list page

**Files:**
- Create: `src/routes/(player)/games/+page.server.ts`
- Create: `src/routes/(player)/games/+page.svelte`
- Test: `src/routes/(player)/games/games.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// mychess/src/routes/(player)/games/games.test.ts
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import GamesList from './+page.svelte';

afterEach(() => cleanup());

describe('My Games list', () => {
	it('shows an empty state when there are no games', () => {
		render(GamesList, { props: { data: { games: [] } } });
		expect(screen.getByText(/No games uploaded yet/)).toBeTruthy();
	});

	it('lists an uploaded game with its players and result', () => {
		const games = [
			{
				id: 'g1',
				headers: { White: 'Alice', Black: 'Bob', Result: '1-0', Date: '2026.01.01' },
				analysis_status: 'done',
				analysis: []
			}
		];
		render(GamesList, { props: { data: { games } } });
		expect(screen.getByText(/Alice/)).toBeTruthy();
		expect(screen.getByText(/Bob/)).toBeTruthy();
	});

	it('shows "Not yet analyzed" for a pending game', () => {
		const games = [
			{ id: 'g1', headers: { White: 'Alice', Black: 'Bob' }, analysis_status: 'pending', analysis: null }
		];
		render(GamesList, { props: { data: { games } } });
		expect(screen.getByText(/Not yet analyzed/)).toBeTruthy();
	});

	it('shows blunder/mistake/inaccuracy counts for an analyzed game', () => {
		const games = [
			{
				id: 'g1',
				headers: { White: 'Alice', Black: 'Bob' },
				analysis_status: 'done',
				analysis: [{ classification: 'blunder' }, { classification: 'mistake' }, { classification: null }]
			}
		];
		render(GamesList, { props: { data: { games } } });
		expect(screen.getByText(/1 blunders, 1 mistakes, 0 inaccuracies/)).toBeTruthy();
	});

	it('links each game to its analysis page and includes a delete form', () => {
		const games = [
			{ id: 'g1', headers: { White: 'Alice', Black: 'Bob' }, analysis_status: 'done', analysis: [] }
		];
		render(GamesList, { props: { data: { games } } });
		const link = screen.getByText(/Alice/).closest('a') as HTMLAnchorElement;
		expect(link.getAttribute('href')).toBe('/games/g1');
		const form = document.querySelector('form[action="?/delete"]') as HTMLFormElement;
		expect((form.querySelector('input[name="game_id"]') as HTMLInputElement).value).toBe('g1');
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run "src/routes/(player)/games/games.test.ts"`
Expected: FAIL — `Cannot find module './+page.svelte'`

- [ ] **Step 3: Write `+page.server.ts`**

```typescript
// mychess/src/routes/(player)/games/+page.server.ts
import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requireAccount } from '$lib/server/auth';

export const load: PageServerLoad = async ({ locals }) => {
	const { user } = await requireAccount(locals);
	const { data: games } = await locals.supabase
		.from('games')
		.select('id, headers, played_as, analysis_status, analysis, created_at')
		.eq('player_id', user!.id)
		.order('created_at', { ascending: false });
	return { games: games ?? [] };
};

export const actions: Actions = {
	delete: async ({ request, locals }) => {
		const { user } = await requireAccount(locals);
		const fd = await request.formData();
		const gameId = fd.get('game_id') as string;
		if (!gameId) return fail(400, { error: 'No game selected' });

		const { error } = await locals.supabase
			.from('games')
			.delete()
			.eq('id', gameId)
			.eq('player_id', user!.id);
		if (error) return fail(500, { error: error.message });

		return { success: true };
	}
};
```

- [ ] **Step 4: Write `+page.svelte`**

```svelte
<!-- mychess/src/routes/(player)/games/+page.svelte -->
<script lang="ts">
	import { enhance } from '$app/forms';
	import { summarizeAnalysis } from '$lib/games/summary';

	let { data } = $props<{ data: { games: any[] } }>();
	const games = $derived(data.games);
</script>

<svelte:head>
	<title>My Games — MyChess</title>
</svelte:head>

<main class="min-h-screen bg-(--color-bg)">
	<div class="max-w-3xl mx-auto px-4 py-8">
		<div class="flex items-center justify-between mb-6">
			<h1 class="text-2xl font-bold text-(--color-text)">My Games</h1>
			<a
				href="/games/new"
				class="bg-(--color-accent) text-white px-4 py-2 rounded-xl font-semibold hover:bg-(--color-accent-hover) transition-colors"
				>Upload a game</a
			>
		</div>

		{#if games.length === 0}
			<p class="text-(--color-muted)">No games uploaded yet.</p>
		{:else}
			<ul class="space-y-3">
				{#each games as game (game.id)}
					{@const summary = summarizeAnalysis(game.analysis)}
					<li
						class="bg-(--color-surface) border border-(--color-border) rounded-xl p-4 flex items-center justify-between gap-4"
					>
						<a href="/games/{game.id}" class="flex-1 min-w-0">
							<p class="font-semibold text-(--color-text) truncate">
								{game.headers?.White ?? '?'} vs {game.headers?.Black ?? '?'}
							</p>
							<p class="text-sm text-(--color-muted)">
								{game.headers?.Result ?? '*'} · {game.headers?.Date ?? ''}
								{#if game.analysis_status === 'pending'}
									· Not yet analyzed
								{:else if summary}
									· {summary.blunders} blunders, {summary.mistakes} mistakes, {summary.inaccuracies} inaccuracies
								{/if}
							</p>
						</a>
						<form method="POST" action="?/delete" use:enhance>
							<input type="hidden" name="game_id" value={game.id} />
							<button type="submit" class="text-red-600 dark:text-red-400 text-sm font-medium hover:underline"
								>Delete</button
							>
						</form>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</main>
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run "src/routes/(player)/games/games.test.ts"`
Expected: PASS (5 tests)

- [ ] **Step 6: Commit**

```bash
git add "src/routes/(player)/games/+page.server.ts" "src/routes/(player)/games/+page.svelte" "src/routes/(player)/games/games.test.ts"
git commit -m "feat(games): add the My Games list page"
```

---

## Task 10: Upload form page

**Files:**
- Create: `src/routes/(player)/games/new/+page.server.ts`
- Create: `src/routes/(player)/games/new/+page.svelte`
- Test: `src/routes/(player)/games/new/new.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// mychess/src/routes/(player)/games/new/new.test.ts
// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import NewGame from './+page.svelte';

// Same reason as repertoires/new/new.test.ts: googleDrivePicker.ts reads
// $env/dynamic/public at module scope, which throws under Vitest's
// browser-condition SSR resolution outside a real SvelteKit runtime.
vi.mock('$lib/googleDrivePicker', () => ({ pickPgnFromGoogleDrive: vi.fn() }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

import { goto } from '$app/navigation';

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe('upload a game page', () => {
	it('renders the heading and PGN paste field', () => {
		render(NewGame);
		expect(screen.getByRole('heading', { name: 'Upload a game' })).toBeTruthy();
		expect(screen.getByLabelText('Paste PGN text')).toBeTruthy();
	});

	it('shows an error and does not submit when the PGN has more than one game', async () => {
		const fetchSpy = vi.spyOn(globalThis, 'fetch');
		render(NewGame);
		const textarea = screen.getByLabelText('Paste PGN text') as HTMLTextAreaElement;
		await fireEvent.input(textarea, {
			target: { value: '[Event "A"]\n\n1. e4 e5 *\n\n[Event "B"]\n\n1. d4 d5 *' }
		});
		const form = textarea.closest('form') as HTMLFormElement;
		await fireEvent.submit(form);
		expect(screen.getByText(/upload one game at a time/i)).toBeTruthy();
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('submits the PGN and playedAs, then navigates to the new game on success', async () => {
		const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
			ok: true,
			json: async () => ({ id: 'new-game-id' })
		} as Response);

		render(NewGame);
		const textarea = screen.getByLabelText('Paste PGN text') as HTMLTextAreaElement;
		await fireEvent.input(textarea, { target: { value: '1. e4 e5 *' } });
		await fireEvent.click(screen.getByRole('button', { name: 'White' }));
		const form = textarea.closest('form') as HTMLFormElement;
		await fireEvent.submit(form);

		await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
		expect(fetchSpy).toHaveBeenCalledWith('/api/games', expect.objectContaining({ method: 'POST' }));
		const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
		expect(body).toEqual({ pgn: '1. e4 e5 *', playedAs: 'white' });

		await waitFor(() => expect(goto).toHaveBeenCalledWith('/games/new-game-id'));
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run "src/routes/(player)/games/new/new.test.ts"`
Expected: FAIL — `Cannot find module './+page.svelte'`

- [ ] **Step 3: Write `+page.server.ts`**

```typescript
// mychess/src/routes/(player)/games/new/+page.server.ts
import type { PageServerLoad } from './$types';
import { requireAccount } from '$lib/server/auth';

export const load: PageServerLoad = async ({ locals }) => {
	await requireAccount(locals);
	return {};
};
```

- [ ] **Step 4: Write `+page.svelte`**

```svelte
<!-- mychess/src/routes/(player)/games/new/+page.svelte -->
<script lang="ts">
	import { goto } from '$app/navigation';
	import { pickPgnFromGoogleDrive } from '$lib/googleDrivePicker';
	import { extractSingleGame } from '$lib/games/parse';

	let pgnText = $state('');
	let fileName = $state('');
	let fileError = $state('');
	let driveError = $state('');
	let drivePicking = $state(false);
	let playedAs = $state<'white' | 'black' | null>(null);
	let submitting = $state(false);
	let errorMessage = $state('');

	function onFileChange(e: Event) {
		const file = (e.target as HTMLInputElement).files?.[0];
		if (!file) return;
		driveError = '';
		fileName = file.name;
		const reader = new FileReader();
		reader.onload = () => {
			pgnText = reader.result as string;
			fileError = '';
		};
		reader.onerror = () => {
			fileError = 'Could not read that file — try pasting the PGN text instead.';
		};
		reader.readAsText(file);
	}

	async function onGoogleDriveClick() {
		driveError = '';
		fileError = '';
		drivePicking = true;
		try {
			const result = await pickPgnFromGoogleDrive();
			if (result) {
				pgnText = result.text;
				fileName = result.name;
			}
		} catch (err) {
			driveError = err instanceof Error ? err.message : 'Could not import from Google Drive.';
		} finally {
			drivePicking = false;
		}
	}

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		errorMessage = '';

		const trimmedPgn = pgnText.trim();
		if (!trimmedPgn) {
			errorMessage = 'PGN is required';
			return;
		}
		const checked = extractSingleGame(trimmedPgn);
		if ('error' in checked) {
			errorMessage = checked.error;
			return;
		}

		submitting = true;
		try {
			const res = await fetch('/api/games', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ pgn: trimmedPgn, playedAs })
			});
			if (!res.ok) {
				const body = await res.json().catch(() => null);
				throw new Error(body?.message ?? 'Upload failed');
			}
			const { id } = await res.json();
			await goto(`/games/${id}`);
		} catch (err) {
			errorMessage = err instanceof Error ? err.message : 'Upload failed';
			submitting = false;
		}
	}
</script>

<svelte:head>
	<title>Upload a game — MyChess</title>
</svelte:head>

<main class="min-h-screen bg-(--color-bg)">
	<div class="max-w-lg mx-auto px-4 py-6">
		<a href="/games" class="text-(--color-muted) text-sm hover:text-(--color-text) mb-6 block"
			>← Back to My Games</a
		>

		{#if errorMessage}
			<p
				class="text-red-600 mb-4 bg-red-50 border border-red-200 dark:bg-red-950 dark:border-red-800 dark:text-red-400 px-4 py-2 rounded-xl text-sm"
			>
				{errorMessage}
			</p>
		{/if}

		<form
			onsubmit={handleSubmit}
			class="bg-(--color-surface) border border-(--color-border) rounded-xl shadow-sm p-5 space-y-4"
		>
			<h1 class="text-2xl font-bold text-(--color-text)">Upload a game</h1>

			<div>
				<span class="block text-sm font-medium text-(--color-text) mb-1">Which side did you play?</span>
				<div class="flex gap-3">
					{#each [{ id: 'white', label: 'White' }, { id: 'black', label: 'Black' }, { id: null, label: 'Not sure' }] as const as c (c.label)}
						<button
							type="button"
							disabled={submitting}
							onclick={() => (playedAs = c.id)}
							class="flex-1 py-2.5 px-2 rounded-xl font-semibold transition-all border-2 text-sm disabled:opacity-60
							       {playedAs === c.id
								? 'border-(--color-accent) bg-indigo-50 dark:bg-indigo-950 text-indigo-700'
								: 'border-(--color-border) text-(--color-muted) hover:border-gray-300 dark:hover:border-gray-600'}"
						>
							{c.label}
						</button>
					{/each}
				</div>
			</div>

			<div>
				<label class="block text-sm font-medium text-(--color-text) mb-1" for="pgn_text">Paste PGN text</label>
				<textarea
					id="pgn_text"
					name="pgn_text"
					rows="8"
					bind:value={pgnText}
					disabled={submitting || drivePicking}
					placeholder="[Event &quot;Example&quot;]&#10;&#10;1. e4 e5 *"
					class="w-full rounded-lg px-4 py-2.5 border border-(--color-border) text-(--color-text) placeholder-(--color-muted) focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono text-sm resize-none disabled:opacity-60"
				></textarea>
			</div>

			<div>
				<label class="block text-sm font-medium text-(--color-text) mb-1" for="pgn_file">…or upload a .pgn file</label>
				<div class="flex items-center gap-3">
					<label
						for="pgn_file"
						class="cursor-pointer inline-flex items-center gap-2 bg-gray-100 border border-(--color-border) text-(--color-text) px-4 py-2.5 rounded-lg font-medium text-sm hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 transition-colors"
					>
						<svg
							width="16"
							height="16"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
							class="shrink-0"
							aria-hidden="true"
						>
							<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
							<polyline points="17 8 12 3 7 8" />
							<line x1="12" y1="3" x2="12" y2="15" />
						</svg>
						Choose File
					</label>
					<input
						id="pgn_file"
						type="file"
						accept=".pgn"
						onchange={onFileChange}
						disabled={submitting || drivePicking}
						class="hidden"
					/>
				</div>
				{#if fileError}
					<p class="text-red-600 dark:text-red-400 text-sm mt-1">{fileError}</p>
				{/if}
			</div>

			<div>
				<button
					type="button"
					onclick={onGoogleDriveClick}
					disabled={submitting || drivePicking}
					class="cursor-pointer inline-flex items-center gap-2 bg-gray-100 border border-(--color-border) text-(--color-text) px-4 py-2.5 rounded-lg font-medium text-sm hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
				>
					<svg width="16" height="16" viewBox="0 0 87.3 78" class="shrink-0" aria-hidden="true">
						<path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" fill="#0066da" />
						<path
							d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0 -1.2 4.5h27.5z"
							fill="#00ac47"
						/>
						<path
							d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z"
							fill="#ea4335"
						/>
						<path d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d" />
						<path d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc" />
						<path
							d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z"
							fill="#ffba00"
						/>
					</svg>
					{drivePicking ? 'Opening Google Drive…' : '…or import from Google Drive'}
				</button>
				{#if driveError}
					<p class="text-red-600 dark:text-red-400 text-sm mt-1">{driveError}</p>
				{/if}
			</div>

			{#if fileName}
				<p class="text-sm text-(--color-muted) truncate">Selected: {fileName}</p>
			{/if}

			<button
				type="submit"
				disabled={submitting || drivePicking}
				class="w-full bg-(--color-accent) text-white py-3 rounded-xl font-bold text-base hover:bg-(--color-accent-hover) transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
			>
				{submitting ? 'Uploading…' : 'Upload and analyze'}
			</button>
		</form>
	</div>
</main>
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run "src/routes/(player)/games/new/new.test.ts"`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add "src/routes/(player)/games/new/+page.server.ts" "src/routes/(player)/games/new/+page.svelte" "src/routes/(player)/games/new/new.test.ts"
git commit -m "feat(games): add the game upload page"
```

---

## Task 11: Analysis board page — load + ownership

**Files:**
- Create: `src/routes/(player)/games/[game_id]/+page.server.ts`

- [ ] **Step 1: Write the implementation**

```typescript
// mychess/src/routes/(player)/games/[game_id]/+page.server.ts
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { requireAccount } from '$lib/server/auth';

export const load: PageServerLoad = async ({ params, locals }) => {
	const { user } = await requireAccount(locals);
	const { data: game, error: err } = await locals.supabase
		.from('games')
		.select('id, headers, played_as, moves, analysis_status, analysis, created_at')
		.eq('id', params.game_id)
		.eq('player_id', user!.id)
		.maybeSingle();
	if (err) throw error(500, err.message);
	if (!game) throw error(404, 'Game not found');
	return { game };
};
```

- [ ] **Step 2: Type-check**

Run: `npm run check`
Expected: no new errors from this file.

- [ ] **Step 3: Commit**

```bash
git add "src/routes/(player)/games/[game_id]/+page.server.ts"
git commit -m "feat(games): add the analysis board page's ownership-checked load"
```

---

## Task 12: Analysis board page — board, move list, engine trigger

**Files:**
- Create: `src/routes/(player)/games/[game_id]/+page.svelte`
- Test: `src/routes/(player)/games/[game_id]/analysis.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// mychess/src/routes/(player)/games/[game_id]/analysis.test.ts
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import GamePage from './+page.svelte';

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';

const doneGame = {
	id: 'g1',
	headers: { White: 'Alice', Black: 'Bob', Result: '1-0', Date: '2026.01.01' },
	played_as: 'white',
	moves: [{ ply: 1, san: 'e4', fen: AFTER_E4, parentFen: START_FEN }],
	analysis_status: 'done',
	analysis: [{ ply: 1, score: { cp: 30 }, bestMoveSan: 'e4', classification: null }]
};

describe('analysis board page', () => {
	it('shows the players and result from the PGN headers', () => {
		render(GamePage, { props: { data: { game: doneGame, boardPrefs: undefined } } });
		expect(screen.getByText(/Alice/)).toBeTruthy();
		expect(screen.getByText(/Bob/)).toBeTruthy();
	});

	it('lists the recorded move', () => {
		render(GamePage, { props: { data: { game: doneGame, boardPrefs: undefined } } });
		expect(screen.getByText('e4', { exact: false })).toBeTruthy();
	});

	it('shows a pending-analysis progress state and spawns the engine for an unanalyzed game', () => {
		class FakeWorker {
			static instances: FakeWorker[] = [];
			onmessage: ((e: MessageEvent<string>) => void) | null = null;
			onerror: (() => void) | null = null;
			constructor(public url: string) {
				FakeWorker.instances.push(this);
			}
			postMessage() {}
			terminate() {}
		}
		vi.stubGlobal('Worker', FakeWorker as unknown as typeof Worker);

		const pendingGame = { ...doneGame, analysis_status: 'pending', analysis: null };
		render(GamePage, { props: { data: { game: pendingGame, boardPrefs: undefined } } });

		expect(screen.getByText('Analyzing…')).toBeTruthy();
		expect(FakeWorker.instances.length).toBe(1);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run "src/routes/(player)/games/[game_id]/analysis.test.ts"`
Expected: FAIL — `Cannot find module './+page.svelte'`

- [ ] **Step 3: Write the implementation**

```svelte
<!-- mychess/src/routes/(player)/games/[game_id]/+page.svelte -->
<script lang="ts">
	import ChessBoard from '$lib/components/ChessBoard.svelte';
	import MoveNavRow from '$lib/components/MoveNavRow.svelte';
	import { Chess } from 'chess.js';
	import type { Key } from 'chessground/types';
	import { analyzeGame } from '$lib/engine/analyzeGame';
	import { buildAnalysis, type AnalysisEntry } from '$lib/games/build-analysis';
	import { formatEval, evalBarWhiteFraction } from '$lib/engine/uci';

	type GameMove = { ply: number; san: string; fen: string; parentFen: string };

	let { data } = $props<{ data: { game: any; boardPrefs?: any } }>();

	const game = $derived(data.game);
	const moves = $derived(game.moves as GameMove[]);
	const rootFen = $derived(
		moves[0]?.parentFen ?? 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
	);

	let reviewIdx = $state(0);
	let analysis = $state<AnalysisEntry[] | null>(game.analysis);
	let analysisStatus = $state<'pending' | 'done'>(game.analysis_status);
	let analyzing = $state(false);
	let analyzeError = $state('');
	let progress = $state({ done: 0, total: moves.length });

	const displayFen = $derived(reviewIdx === 0 ? rootFen : moves[reviewIdx - 1].fen);

	const lastMove = $derived.by((): [Key, Key] | undefined => {
		if (reviewIdx === 0) return undefined;
		const mv = moves[reviewIdx - 1];
		try {
			const move = new Chess(mv.parentFen).move(mv.san);
			return move ? [move.from as Key, move.to as Key] : undefined;
		} catch {
			return undefined;
		}
	});

	const arrowMove = $derived.by((): { from: Key; to: Key } | null => {
		if (!analysis || reviewIdx >= moves.length) return null;
		const entry = analysis[reviewIdx];
		if (!entry?.bestMoveSan) return null;
		try {
			const move = new Chess(displayFen).move(entry.bestMoveSan);
			return move ? { from: move.from as Key, to: move.to as Key } : null;
		} catch {
			return null;
		}
	});

	const currentEntry = $derived(analysis && reviewIdx > 0 ? analysis[reviewIdx - 1] : null);

	async function startAnalysis() {
		analyzing = true;
		analyzeError = '';
		progress = { done: 0, total: moves.length };
		const fens = [rootFen, ...moves.map((m) => m.fen)];
		try {
			const results = await analyzeGame(fens, {
				onProgress: (done, total) => {
					progress = { done, total };
				}
			});
			const built = buildAnalysis(moves, results);
			const res = await fetch(`/api/games/${game.id}/analysis`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ analysis: built })
			});
			if (!res.ok) throw new Error('Could not save analysis');
			analysis = built;
			analysisStatus = 'done';
		} catch (err) {
			analyzeError = err instanceof Error ? err.message : 'Analysis failed';
		} finally {
			analyzing = false;
		}
	}

	// Auto-starts once, the first time an unanalyzed game is opened; won't
	// silently retry-loop after a failure (analyzeError blocks it — the
	// Retry button below calls startAnalysis() directly).
	$effect(() => {
		if (analysisStatus === 'pending' && !analyzing && !analyzeError) startAnalysis();
	});

	function classificationLabel(c: AnalysisEntry['classification']): string {
		if (c === 'blunder') return 'Blunder';
		if (c === 'mistake') return 'Mistake';
		if (c === 'inaccuracy') return 'Inaccuracy';
		return '';
	}

	function classificationClass(c: AnalysisEntry['classification']): string {
		if (c === 'blunder') return 'text-red-600 dark:text-red-400';
		if (c === 'mistake') return 'text-orange-600 dark:text-orange-400';
		if (c === 'inaccuracy') return 'text-yellow-600 dark:text-yellow-400';
		return 'text-(--color-muted)';
	}
</script>

<svelte:head>
	<title>{game.headers?.White ?? '?'} vs {game.headers?.Black ?? '?'} — MyChess</title>
</svelte:head>

<main class="min-h-screen bg-(--color-bg)">
	<div class="max-w-5xl mx-auto px-4 py-8 grid md:grid-cols-[minmax(0,1fr)_320px] gap-6">
		<div>
			<a href="/games" class="text-(--color-muted) text-sm hover:text-(--color-text) mb-4 block"
				>← Back to My Games</a
			>
			<h1 class="text-lg font-bold text-(--color-text) mb-3">
				{game.headers?.White ?? '?'} vs {game.headers?.Black ?? '?'}
				<span class="text-(--color-muted) font-normal text-sm ml-2">{game.headers?.Result ?? '*'}</span>
			</h1>

			<ChessBoard
				fen={displayFen}
				interactable={false}
				orientation={game.played_as === 'black' ? 'black' : 'white'}
				{lastMove}
				{arrowMove}
				prefs={data.boardPrefs}
			/>

			<MoveNavRow
				{reviewIdx}
				totalPlies={moves.length}
				isReviewing={true}
				onstart={() => (reviewIdx = 0)}
				onback={() => (reviewIdx = Math.max(reviewIdx - 1, 0))}
				onforward={() => (reviewIdx = Math.min(reviewIdx + 1, moves.length))}
				onlive={() => (reviewIdx = moves.length)}
			/>

			{#if currentEntry}
				<p class="mt-3 text-sm text-(--color-text)">
					Eval: <span class="font-semibold tabular-nums">{formatEval(currentEntry.score)}</span>
					{#if currentEntry.classification}
						· <span class={classificationClass(currentEntry.classification)}
							>{classificationLabel(currentEntry.classification)}</span
						>
					{/if}
					{#if currentEntry.bestMoveSan}
						· Best was <span class="font-mono">{currentEntry.bestMoveSan}</span>
					{/if}
				</p>
			{/if}

			{#if analyzing}
				<div class="mt-4 space-y-2">
					<div class="flex justify-between text-sm text-(--color-muted)">
						<span>Analyzing…</span>
						<span>{progress.done} / {progress.total}</span>
					</div>
					<div class="w-full bg-(--color-border) rounded-full h-2 overflow-hidden">
						<div
							class="bg-(--color-accent) h-2 transition-all duration-300"
							style="width: {(progress.done / Math.max(progress.total, 1)) * 100}%"
						></div>
					</div>
				</div>
			{/if}

			{#if analyzeError}
				<div class="mt-4 flex items-center gap-3">
					<p class="text-red-600 dark:text-red-400 text-sm">{analyzeError}</p>
					<button onclick={startAnalysis} class="text-sm font-semibold text-(--color-accent) hover:underline"
						>Retry</button
					>
				</div>
			{/if}

			{#if analysis}
				<div class="mt-4 flex items-end gap-px h-12" aria-hidden="true">
					{#each analysis as entry, i (entry.ply)}
						<button
							onclick={() => (reviewIdx = i + 1)}
							class="flex-1 bg-(--color-border) hover:opacity-80 transition-opacity"
							style="height: {evalBarWhiteFraction(entry.score) * 100}%"
							aria-label={`Jump to move ${i + 1}`}
						></button>
					{/each}
				</div>
			{/if}
		</div>

		<div class="border border-(--color-border) rounded-xl bg-(--color-surface) p-3 max-h-[70vh] overflow-y-auto">
			<h2 class="text-sm font-semibold text-(--color-muted) uppercase tracking-wide mb-2">Moves</h2>
			<ol class="text-sm space-y-1">
				{#each moves as move, i (move.ply)}
					{@const entry = analysis?.[i]}
					<li>
						<button
							onclick={() => (reviewIdx = i + 1)}
							class="w-full text-left px-2 py-1 rounded-lg {reviewIdx === i + 1
								? 'bg-(--color-accent)/10 font-semibold'
								: 'hover:bg-(--color-border)/40'}"
						>
							{move.ply % 2 === 1 ? `${Math.ceil(move.ply / 2)}.` : `${Math.ceil(move.ply / 2)}...`}
							{move.san}
							{#if entry?.classification}
								<span class={classificationClass(entry.classification)}
									>({classificationLabel(entry.classification)})</span
								>
							{/if}
						</button>
					</li>
				{/each}
			</ol>
		</div>
	</div>
</main>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run "src/routes/(player)/games/[game_id]/analysis.test.ts"`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add "src/routes/(player)/games/[game_id]/+page.svelte" "src/routes/(player)/games/[game_id]/analysis.test.ts"
git commit -m "feat(games): add the analysis board page"
```

---

## Task 13: Nav link

**Files:**
- Modify: `src/lib/components/NavBar.svelte`

- [ ] **Step 1: Add the desktop link**

In the `{:else if !isSignedOut}` block (the signed-in-player desktop nav), add a `Games` link after `Repertoires`:

```svelte
        <a href="/repertoires" class={linkClass(['/repertoires'])}>Repertoires</a>
        <a href="/games" class={linkClass(['/games'])}>Games</a>
        <a href="/coaches" class={linkClass(['/coaches'])}>Coaches</a>
```

(replaces the existing two-line block with this three-line block, inserting the new middle line)

- [ ] **Step 2: Add the mobile link**

In the signed-in-player mobile menu block, add the matching link after `Repertoires`:

```svelte
        <a href="/repertoires" onclick={() => mobileMenuOpen = false} class="text-(--color-text)">Repertoires</a>
        <a href="/games" onclick={() => mobileMenuOpen = false} class="text-(--color-text)">Games</a>
        <a href="/coaches" onclick={() => mobileMenuOpen = false} class="text-(--color-text)">Coaches</a>
```

(replaces the existing two-line block with this three-line block, inserting the new middle line)

- [ ] **Step 3: Run the existing test suite**

Run: `npx vitest run`
Expected: PASS — no existing test asserts the exact set of nav links, so this is a safe addition (confirm by reading the output; if something unexpectedly breaks, investigate before continuing).

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/NavBar.svelte
git commit -m "feat(games): add a Games nav link"
```

---

## Task 14: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full unit test suite**

Run: `npm test`
Expected: all tests pass, including every test added in Tasks 1-12.

- [ ] **Step 2: Type-check**

Run: `npm run check`
Expected: zero errors (per CLAUDE.md, `npm run check` has no tolerated baseline).

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: zero errors (warnings, e.g. `@typescript-eslint/no-explicit-any` on the `data` prop destructuring, are expected and not gated — matches existing pages like `practice/[repertoire_id]/+page.svelte`).

- [ ] **Step 4: Manual verification**

Run: `npm run dev`, then in a browser signed in as a real (non-anonymous) player account:
1. Go to `/games` — confirm the empty state renders, and the nav bar shows a "Games" link.
2. Click "Upload a game", paste a short real PGN (e.g. a 10-20 move game), pick "White" or "Black", submit.
3. Confirm it redirects to `/games/<id>` and a progress bar appears ("Analyzing… n / total"), completing within roughly `total * 500ms`.
4. Step through the game with the move-nav row and by clicking moves in the move list; confirm the board position, last-move highlight, and the best-move arrow all update.
5. Confirm at least one move shows a classification badge if the test game had a real mistake in it (or verify the "no flag" case is silent, if not).
6. Reload the page — confirm the game now shows `analysis_status: 'done'` immediately (no re-analysis, no progress bar) by reading the Network tab (no `/api/games/[id]/analysis` `POST` on load).
7. Go back to `/games` — confirm the list now shows blunder/mistake/inaccuracy counts for this game.
8. Delete the game from the list — confirm it disappears and the row is gone from `games` in Supabase (check via the Supabase dashboard, or the service-role query pattern established in issue #89's `qa-accounts.ts` script).

- [ ] **Step 5: Note this is a QA account**

Per CLAUDE.md's QA/test-account cleanup rule: if step 4's manual verification account is a throwaway created just for this testing (not the real account this was verified under), delete it from Supabase before treating the epic as done, and say so explicitly.

---

## Self-Review Notes

**Spec coverage:** every acceptance criterion in issue #110 has a task — schema (already applied, Task 0 implicit), My Games list (Task 9), upload (Task 10), analysis board (Tasks 11-12), the three API endpoints (Tasks 7, 8, and the `delete` form action in Task 9 — chosen over a fourth `DELETE /api/games/[id]` route to match the existing `repertoires` list page's own in-page action pattern rather than duplicating it as a separate endpoint nothing else calls), and unit tests for parsing/classification (Tasks 1, 2, 4, 5).

**Deviation from the design spec, noted explicitly:** the spec's API section listed `DELETE /api/games/[id]` as a REST endpoint; this plan implements deletion as a SvelteKit form action instead (`?/delete` in Task 9), because that's how the existing `repertoires` list page — the closest precedent in this codebase — does its own delete-from-a-list interaction. The acceptance criterion ("delete a game") is met either way; this choice is about following established convention over the spec's shorthand.

**Type consistency check:** `GameMove` (`{ply, san, fen, parentFen}`) is defined once in `src/lib/games/parse.ts` and imported by `build-analysis.ts`; the analysis board page redeclares the same shape locally (data loaded via `+page.server.ts` isn't typed through the shared module across the server/client boundary) rather than importing it, matching how other pages in this codebase type their own `data` prop loosely (e.g. `practice/[repertoire_id]/+page.svelte`'s `data: any`). `AnalysisEntry` (`{ply, score, bestMoveSan, classification}`) is defined once in `build-analysis.ts` and reused by the analysis board page's script.

**No placeholders:** every step above has complete, runnable code — no TBD/TODO, no "add error handling" without showing it.
