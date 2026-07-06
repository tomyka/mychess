# Stockfish Move Evaluation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After a wrong guess in Learn mode, show a Stockfish-powered quality label (Also fine / Inaccuracy / Mistake / Blunder) comparing the played move to the book move.

**Architecture:** Stockfish 18 (lite, single-threaded WASM build — no special CORS/COOP headers required) runs entirely client-side in a Web Worker, lazily created on first use. A pure `classify.ts` module handles all the perspective/scoring math (fully unit-tested); a thin `stockfish.ts` wrapper handles the Worker/UCI I/O (not unit-tested, matching this codebase's convention for I/O wrappers); `/learn/+page.svelte` wires the two together on a wrong guess.

**Tech Stack:** SvelteKit 2 / Svelte 5, `chess.js` (already a dependency), Web Workers, WebAssembly (Stockfish.js 18 lite-single build, GPLv3, from https://github.com/nmrugg/stockfish.js).

**Deviation from the approved spec, noted for the record:** the spec described dynamically importing the `stockfish` npm package inside the lazy Worker initializer. Checking the actual package revealed it's ~250MB unpacked (it bundles every build variant — multi-threaded, single-threaded, lite, asm.js — plus NNUE nets), which is excessive to add as a dependency just to extract two ~7MB files. This plan instead vendors exactly the two files needed (`stockfish-18-lite-single.js` + `.wasm`, the official "lite single-threaded" release build) directly into `static/`, loaded via a plain `new Worker('/stockfish/...')` URL. This is strictly better for the spec's own stated bundle-size goal (zero JS bundle impact at all, not just lazy-loaded) and requires no dependency install; the UCI-over-`postMessage` interface consumed by `stockfish.ts` is unchanged from what the spec described.

---

### Task 1: Vendor the Stockfish engine files

**Files:**
- Create: `static/stockfish/stockfish-18-lite-single.js`
- Create: `static/stockfish/stockfish-18-lite-single.wasm`
- Create: `static/stockfish/README.md`

These two files are the official prebuilt "lite single-threaded" release of Stockfish.js 18 — chosen specifically because it needs no `Cross-Origin-Opener-Policy`/`Cross-Origin-Embedder-Policy` headers (the multi-threaded builds do, via `SharedArrayBuffer`, which this app doesn't currently configure), and is ~7MB instead of >100MB. They are committed directly rather than fetched at build time, since SvelteKit serves everything under `static/` as-is from the site root, and a build-time network fetch would make every production deploy depend on GitHub's release CDN being reachable.

- [ ] **Step 1: Download the files**

Run from `mychess/`:

```bash
mkdir -p static/stockfish
curl -sL "https://github.com/nmrugg/stockfish.js/releases/download/v18.0.0/stockfish-18-lite-single.js" -o static/stockfish/stockfish-18-lite-single.js
curl -sL "https://github.com/nmrugg/stockfish.js/releases/download/v18.0.0/stockfish-18-lite-single.wasm" -o static/stockfish/stockfish-18-lite-single.wasm
```

- [ ] **Step 2: Verify the downloads**

Run: `ls -la static/stockfish/`
Expected: `stockfish-18-lite-single.js` is roughly 20KB, `stockfish-18-lite-single.wasm` is roughly 7MB (7,295,411 bytes exactly, as of Stockfish.js 18.0.0). If either file is a few KB (an HTML error page instead of the real asset), the download failed — check the URL and retry.

- [ ] **Step 3: Add provenance/license notes**

```markdown
# Stockfish (bundled engine binary)

`stockfish-18-lite-single.js` + `stockfish-18-lite-single.wasm` — the official
"lite, single-threaded" WASM build of Stockfish.js 18.

Source: https://github.com/nmrugg/stockfish.js
Release: https://github.com/nmrugg/stockfish.js/releases/tag/v18.0.0
License: GPLv3 — see https://raw.githubusercontent.com/nmrugg/stockfish.js/master/Copying.txt

Loaded at runtime as a standalone Web Worker
(`new Worker('/stockfish/stockfish-18-lite-single.js')`) by
`src/lib/engine/stockfish.ts` — never statically linked into this app's own
code. The single-threaded build was chosen specifically because it requires
no `Cross-Origin-Opener-Policy`/`Cross-Origin-Embedder-Policy` response
headers (unlike the multi-threaded build, which needs `SharedArrayBuffer`),
and is ~7MB instead of >100MB.

Do not edit these files by hand. To update to a newer Stockfish.js release,
re-download both files from that release's assets and replace them here.
```

Save this as `static/stockfish/README.md`.

- [ ] **Step 4: Commit**

```bash
git add static/stockfish/
git commit -m "chore: vendor Stockfish 18 (lite, single-threaded WASM build)"
git push
```

---

### Task 2: Move-quality classification logic

**Files:**
- Create: `src/lib/engine/classify.ts`
- Test: `src/lib/engine/classify.test.ts`

Pure logic, no dependency on Task 1 or a real engine — testable entirely with fake engine-score fixtures.

- [ ] **Step 1: Write the failing tests**

```ts
// mychess/src/lib/engine/classify.test.ts
import { describe, it, expect } from 'vitest';
import { toPlayerPerspective, classifySwing, evaluateSwing } from './classify';

describe('toPlayerPerspective', () => {
  it('negates a centipawn score, since the opponent is always to move after the players own move', () => {
    expect(toPlayerPerspective({ cp: 120, mate: null })).toBe(-120);
    expect(toPlayerPerspective({ cp: -80, mate: null })).toBe(80);
  });

  it('treats a positive mate score (opponent mates) as very bad for the player', () => {
    expect(toPlayerPerspective({ cp: null, mate: 3 })).toBeLessThan(-99000);
  });

  it('treats a negative mate score (opponent gets mated) as very good for the player', () => {
    expect(toPlayerPerspective({ cp: null, mate: -3 })).toBeGreaterThan(99000);
  });

  it('a closer mate against the player counts for more than a farther one', () => {
    const mateIn1 = toPlayerPerspective({ cp: null, mate: 1 });
    const mateIn5 = toPlayerPerspective({ cp: null, mate: 5 });
    expect(mateIn1).toBeLessThan(mateIn5);
  });

  it('treats a missing cp score as 0', () => {
    expect(toPlayerPerspective({ cp: null, mate: null })).toBe(0);
  });
});

describe('classifySwing', () => {
  it('classifies at the fine/inaccuracy boundary (<=50 fine, >50 inaccuracy)', () => {
    expect(classifySwing(50)).toBe('fine');
    expect(classifySwing(51)).toBe('inaccuracy');
  });

  it('classifies at the inaccuracy/mistake boundary (<=100 inaccuracy, >100 mistake)', () => {
    expect(classifySwing(100)).toBe('inaccuracy');
    expect(classifySwing(101)).toBe('mistake');
  });

  it('classifies at the mistake/blunder boundary (<=300 mistake, >300 blunder)', () => {
    expect(classifySwing(300)).toBe('mistake');
    expect(classifySwing(301)).toBe('blunder');
  });

  it('classifies a negative or zero swing as fine (played move was at least as good)', () => {
    expect(classifySwing(0)).toBe('fine');
    expect(classifySwing(-40)).toBe('fine');
  });
});

describe('evaluateSwing', () => {
  it('computes the swing as book eval minus played eval, from the players perspective', () => {
    // book: toPlayerPerspective({cp:-50}) = 50. played: toPlayerPerspective({cp:250}) = -250.
    // swing = 50 - (-250) = 300 -> mistake (<=300)
    const result = evaluateSwing({ cp: -50, mate: null }, { cp: 250, mate: null });
    expect(result.swingCp).toBe(300);
    expect(result.quality).toBe('mistake');
  });

  it('a played move at least as good as the book move classifies as fine', () => {
    // book: toPlayerPerspective({cp:0}) = 0. played: toPlayerPerspective({cp:-10}) = 10.
    // swing = 0 - 10 = -10 -> fine
    const result = evaluateSwing({ cp: 0, mate: null }, { cp: -10, mate: null });
    expect(result.swingCp).toBe(-10);
    expect(result.quality).toBe('fine');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd mychess && npx vitest run src/lib/engine/classify.test.ts`
Expected: FAIL — `./classify` has no exported members yet (module doesn't exist).

- [ ] **Step 3: Implement**

```ts
// mychess/src/lib/engine/classify.ts
export type EngineScore = { cp: number | null; mate: number | null };
export type MoveQuality = 'fine' | 'inaccuracy' | 'mistake' | 'blunder';
export type SwingResult = { swingCp: number; quality: MoveQuality };

const MATE_BASE = 100000;

/**
 * UCI scores are from the perspective of whoever is to move in the analyzed
 * position. Every position this module compares is the position immediately
 * after the PLAYER's own move (book or played), so the opponent is always
 * the one to move next in that position — meaning the raw score is always
 * negated to express it from the player's perspective. Mate scores convert
 * to a large centipawn-equivalent so they compare on the same numeric scale
 * as centipawn scores (a closer mate counts for more than a farther one).
 */
export function toPlayerPerspective(score: EngineScore): number {
  if (score.mate !== null) {
    const sign = score.mate > 0 ? 1 : -1;
    return -(sign * (MATE_BASE - Math.abs(score.mate)));
  }
  return -(score.cp ?? 0);
}

/**
 * Lichess-style centipawn-loss thresholds. Each boundary belongs to exactly
 * one tier: <=50 fine, <=100 inaccuracy, <=300 mistake, >300 blunder.
 */
export function classifySwing(swingCp: number): MoveQuality {
  if (swingCp > 300) return 'blunder';
  if (swingCp > 100) return 'mistake';
  if (swingCp > 50) return 'inaccuracy';
  return 'fine';
}

/** How much worse (in centipawns, from the player's perspective) the played move was than the book move. */
export function evaluateSwing(bookScore: EngineScore, playedScore: EngineScore): SwingResult {
  const swingCp = toPlayerPerspective(bookScore) - toPlayerPerspective(playedScore);
  return { swingCp, quality: classifySwing(swingCp) };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd mychess && npx vitest run src/lib/engine/classify.test.ts`
Expected: PASS (13 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/engine/classify.ts src/lib/engine/classify.test.ts
git commit -m "feat: add move-quality classification logic for engine evaluation"
git push
```

---

### Task 3: Stockfish Web Worker wrapper

**Files:**
- Create: `src/lib/engine/stockfish.ts`

**Depends on Task 1** (the worker script it loads must exist at `/stockfish/stockfish-18-lite-single.js`). Not unit-tested — matches this codebase's convention for thin I/O wrappers (e.g. `src/lib/server/pgn-import.ts`, `src/lib/fide/download.ts`); there is no real engine to test against in a unit test, and the module is a straightforward, small wrapper around a well-documented protocol (UCI).

- [ ] **Step 1: Implement**

```ts
// mychess/src/lib/engine/stockfish.ts
import type { EngineScore } from './classify';

const ENGINE_URL = '/stockfish/stockfish-18-lite-single.js';

let worker: Worker | null = null;
let readyPromise: Promise<void> | null = null;

function getWorker(): Worker {
	if (!worker) {
		worker = new Worker(ENGINE_URL);
	}
	return worker;
}

function waitForReady(): Promise<void> {
	if (readyPromise) return readyPromise;

	readyPromise = new Promise((resolve, reject) => {
		let w: Worker;
		try {
			w = getWorker();
		} catch (err) {
			reject(err);
			return;
		}

		const timeout = setTimeout(() => {
			cleanup();
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

/** Runs a fixed-time search on `fen` and resolves with the final evaluation. Rejects if the engine can't load or times out. */
export async function evaluatePosition(fen: string, movetimeMs: number): Promise<EngineScore> {
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
```

- [ ] **Step 2: Run the full test suite and type-check**

Run: `cd mychess && npx vitest run && npm run check`
Expected: all existing tests still pass (this file has no dedicated test); `svelte-check` error count unchanged from the pre-existing 12-error baseline (all in `src/routes/auth/**`).

- [ ] **Step 3: Commit**

```bash
git add src/lib/engine/stockfish.ts
git commit -m "feat: add Stockfish Web Worker wrapper (UCI over postMessage)"
git push
```

---

### Task 4: Wire engine feedback into Learn mode

**Files:**
- Modify: `src/routes/(player)/learn/+page.svelte`

**Depends on Task 2 and Task 3.**

**First, read the current exact content of `src/routes/(player)/learn/+page.svelte` and confirm it matches the "before" state described below — report back if it doesn't, don't proceed blindly.**

- [ ] **Step 1: Add imports and state**

At the top of the `<script>` block, change:

```ts
	import ChessBoard from '$lib/components/ChessBoard.svelte';
	import { speedToRating } from '$lib/srs/fsrs';
	import { xpForReview } from '$lib/srs/xp';
	import { Rating } from 'ts-fsrs';
	import type { Key } from 'chessground/types';
	import { playCorrect, playWrong } from '$lib/sounds';

	let { data } = $props<{ data: any }>();
```

to:

```ts
	import ChessBoard from '$lib/components/ChessBoard.svelte';
	import { speedToRating } from '$lib/srs/fsrs';
	import { xpForReview } from '$lib/srs/xp';
	import { Rating } from 'ts-fsrs';
	import type { Key } from 'chessground/types';
	import { playCorrect, playWrong } from '$lib/sounds';
	import { Chess } from 'chess.js';
	import { evaluatePosition } from '$lib/engine/stockfish';
	import { evaluateSwing, type MoveQuality } from '$lib/engine/classify';

	let { data } = $props<{ data: any }>();

	const QUALITY_LABEL: Record<MoveQuality, string> = {
		fine: 'Also fine',
		inaccuracy: 'Inaccuracy',
		mistake: 'Mistake',
		blunder: 'Blunder'
	};
	const QUALITY_COLOR: Record<MoveQuality, string> = {
		fine: 'text-gray-500',
		inaccuracy: 'text-yellow-600',
		mistake: 'text-orange-600',
		blunder: 'text-red-600'
	};
```

Then, right after the existing `let wrongMove = $state(false);` line, add:

```ts
	let engineLoading = $state(false);
	let engineFeedback = $state<{ swingCp: number; quality: MoveQuality } | null>(null);
```

- [ ] **Step 2: Trigger evaluation on a wrong guess**

Change `handleMove`'s wrong-answer branch from:

```ts
		} else {
			playWrong();
			wrongMove = true;
			incorrect++;
			return false;
		}
```

to:

```ts
		} else {
			playWrong();
			wrongMove = true;
			incorrect++;
			evaluateWrongMove(detail.san);
			return false;
		}
```

Then add this new function right after `handleMove`:

```ts
	async function evaluateWrongMove(playedSan: string) {
		const bookSan = current?.move?.san;
		if (!bookSan) return;

		engineFeedback = null;
		engineLoading = true;
		try {
			const bookChess = new Chess(boardFen);
			bookChess.move(bookSan);
			const playedChess = new Chess(boardFen);
			playedChess.move(playedSan);

			const [bookScore, playedScore] = await Promise.all([
				evaluatePosition(bookChess.fen(), 800),
				evaluatePosition(playedChess.fen(), 800)
			]);
			engineFeedback = evaluateSwing(bookScore, playedScore);
		} catch {
			engineFeedback = null;
		} finally {
			engineLoading = false;
		}
	}
```

- [ ] **Step 3: Clear feedback when moving to the next question**

Change `next()` from:

```ts
	function next() {
		currentIdx++;
		phase = 'guess';
		showHint = false;
		wrongMove = false;
		startTime = Date.now();
	}
```

to:

```ts
	function next() {
		currentIdx++;
		phase = 'guess';
		showHint = false;
		wrongMove = false;
		engineLoading = false;
		engineFeedback = null;
		startTime = Date.now();
	}
```

- [ ] **Step 4: Show the feedback in the UI**

In the template, change:

```svelte
    {:else}
      <div class="mt-6 p-5 bg-white border border-gray-200 rounded-2xl text-center shadow-sm">
        <p class="text-xl font-bold mb-1 {wrongMove ? 'text-gray-700' : 'text-green-600'}">
          {wrongMove ? 'Answer: ' + current.move?.san : '✅ Correct! ' + current.move?.san}
        </p>
        <button onclick={next}
                class="mt-4 w-full bg-indigo-600 text-white py-4 rounded-xl font-bold text-lg hover:bg-indigo-700 transition">
          {currentIdx + 1 < initialQueue.length ? 'Next →' : 'Finish'}
        </button>
      </div>
    {/if}
```

to:

```svelte
    {:else}
      <div class="mt-6 p-5 bg-white border border-gray-200 rounded-2xl text-center shadow-sm">
        <p class="text-xl font-bold mb-1 {wrongMove ? 'text-gray-700' : 'text-green-600'}">
          {wrongMove ? 'Answer: ' + current.move?.san : '✅ Correct! ' + current.move?.san}
        </p>
        {#if wrongMove}
          {#if engineLoading}
            <p class="text-sm text-gray-400 mt-2">Evaluating…</p>
          {:else if engineFeedback}
            <p class="text-sm mt-2 font-semibold {QUALITY_COLOR[engineFeedback.quality]}">
              {QUALITY_LABEL[engineFeedback.quality]}{#if engineFeedback.quality !== 'fine'} (−{engineFeedback.swingCp}cp){/if}
            </p>
          {/if}
        {/if}
        <button onclick={next}
                class="mt-4 w-full bg-indigo-600 text-white py-4 rounded-xl font-bold text-lg hover:bg-indigo-700 transition">
          {currentIdx + 1 < initialQueue.length ? 'Next →' : 'Finish'}
        </button>
      </div>
    {/if}
```

- [ ] **Step 5: Run the full test suite and type-check**

Run: `cd mychess && npx vitest run && npm run check`
Expected: all tests pass; `svelte-check` error count unchanged from the 12-error baseline (this page has no existing test file, so there's nothing to break here specifically, but confirm nothing else regressed).

- [ ] **Step 6: Commit**

```bash
git add "src/routes/(player)/learn/+page.svelte"
git commit -m "feat: show Stockfish move-quality feedback after a wrong guess in Learn mode"
git push
```

---

### Task 5: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `cd mychess && npx vitest run`
Expected: all tests pass (baseline 232 + 13 new classify tests = 245).

- [ ] **Step 2: Run the type-check**

Run: `cd mychess && npm run check`
Expected: error count unchanged from the pre-existing 12-error baseline (all in `src/routes/auth/**`).

- [ ] **Step 3: Manual browser check**

Since this feature has no automated UI test, verify manually: open `/learn`, get a move wrong on purpose, and confirm (a) the existing "Not quite! Try again..." and "Answer: ..." text still work exactly as before, (b) an "Evaluating…" line appears briefly, (c) it's replaced by a quality label (e.g. "Blunder (−340cp)"), (d) clicking Next clears it and the next question doesn't show stale feedback, (e) a *correct* answer never shows any engine feedback line.
