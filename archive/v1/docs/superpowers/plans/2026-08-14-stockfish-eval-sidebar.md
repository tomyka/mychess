# Stockfish Eval Sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a live Stockfish evaluation display to the Practice page — number + bar on desktop, number + move list on mobile — using a client-side single-threaded WASM engine in a Web Worker.

**Architecture:** Two static engine files (`stockfish-18-lite-single.js`/`.wasm`) served as-is from `static/stockfish/`, loaded as a dedicated Web Worker. A pure logic module (`src/lib/engine/uci.ts`) parses UCI protocol lines and formats scores, fully unit-tested with no Worker involved. A wrapper component (`src/lib/components/EngineEval.svelte`) owns the Worker's lifecycle and exposes just a `fen` prop, manually verified in a browser (Worker/WASM doesn't run in vitest/jsdom). The Practice page wires this into its existing desktop sidebar and mobile layout.

**Tech Stack:** SvelteKit 2 + Svelte 5 (runes), Stockfish 18 lite-single WASM build (GPLv3, from https://github.com/nmrugg/stockfish.js), vitest.

**Design doc:** `docs/superpowers/specs/2026-08-14-stockfish-eval-sidebar-design.md`

---

### Task 1: Add the engine static assets

**Files:**
- Create: `mychess/static/stockfish/stockfish-18-lite-single.js`
- Create: `mychess/static/stockfish/stockfish-18-lite-single.wasm`

- [ ] **Step 1: Download the two engine files**

Run from the repo root (NOT `mychess/` — `static/` here is a subdirectory of the SvelteKit app):

```bash
mkdir -p mychess/static/stockfish
curl -sL --max-time 60 -o mychess/static/stockfish/stockfish-18-lite-single.js \
  "https://github.com/nmrugg/stockfish.js/releases/download/v18.0.0/stockfish-18-lite-single.js"
curl -sL --max-time 120 -o mychess/static/stockfish/stockfish-18-lite-single.wasm \
  "https://github.com/nmrugg/stockfish.js/releases/download/v18.0.0/stockfish-18-lite-single.wasm"
```

Expected: two files created, `stockfish-18-lite-single.js` ~20KB, `stockfish-18-lite-single.wasm` ~7.3MB.

- [ ] **Step 2: Verify the files downloaded correctly (not an HTML error page)**

```bash
file mychess/static/stockfish/stockfish-18-lite-single.js
file mychess/static/stockfish/stockfish-18-lite-single.wasm
ls -la mychess/static/stockfish/
```

Expected: the `.js` file reports as ASCII/UTF-8 text (not HTML), the `.wasm` file reports as "WebAssembly (wasm) binary module" or similar, and `ls` shows sizes in the ranges above. If either file is small (a few KB) and `file` reports HTML, the download URL returned an error page — re-check the URL and retry.

- [ ] **Step 3: Commit**

```bash
cd mychess
git add static/stockfish/stockfish-18-lite-single.js static/stockfish/stockfish-18-lite-single.wasm
git commit -m "$(cat <<'EOF'
feat: add Stockfish 18 lite single-threaded WASM engine as a static asset

Sourced from the official Stockfish.js GitHub release (v18.0.0), the
build the maintainers recommend for in-browser use without
cross-origin-isolation headers. GPLv3 licensed (see upstream
Copying.txt) — not bundled/built, loaded directly as a Web Worker
script from static/stockfish/.
EOF
)"
```

---

### Task 2: `src/lib/engine/uci.ts` — pure UCI parsing/formatting logic

**Files:**
- Create: `mychess/src/lib/engine/uci.ts`
- Test: `mychess/src/lib/engine/uci.test.ts`

- [ ] **Step 1: Write the failing test file**

Create `mychess/src/lib/engine/uci.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseInfoLine, sideToMoveFromFen, toWhiteRelative, formatEval, evalBarWhiteFraction } from './uci';

describe('parseInfoLine', () => {
	it('parses a depth + cp score info line', () => {
		expect(
			parseInfoLine('info depth 12 seldepth 18 multipv 1 score cp 35 nodes 123456 nps 800000 time 150 pv e2e4 e7e5')
		).toEqual({ depth: 12, score: { cp: 35 } });
	});

	it('parses a negative cp score', () => {
		expect(parseInfoLine('info depth 10 score cp -120 pv d7d5')).toEqual({ depth: 10, score: { cp: -120 } });
	});

	it('parses a mate score', () => {
		expect(
			parseInfoLine('info depth 5 seldepth 5 multipv 1 score mate 3 nodes 500 nps 10000 time 10 pv d1h5 g7g6 h5f3')
		).toEqual({ depth: 5, score: { mate: 3 } });
	});

	it('parses a negative mate score', () => {
		expect(parseInfoLine('info depth 4 score mate -2 pv a1a2')).toEqual({ depth: 4, score: { mate: -2 } });
	});

	it('returns null for an info string line with no score', () => {
		expect(parseInfoLine('info string NNUE evaluation using nn-1111cefa1111.nnue enabled')).toBeNull();
	});

	it('returns null for a bestmove line', () => {
		expect(parseInfoLine('bestmove e2e4 ponder e7e5')).toBeNull();
	});

	it('returns null for an unrelated protocol line', () => {
		expect(parseInfoLine('readyok')).toBeNull();
	});
});

describe('sideToMoveFromFen', () => {
	it('reads White to move', () => {
		expect(sideToMoveFromFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')).toBe('w');
	});

	it('reads Black to move', () => {
		expect(sideToMoveFromFen('rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 2')).toBe('b');
	});
});

describe('toWhiteRelative', () => {
	it('leaves a White-to-move cp score unchanged', () => {
		expect(toWhiteRelative({ cp: 35 }, 'w')).toEqual({ cp: 35 });
	});

	it('negates a Black-to-move cp score', () => {
		expect(toWhiteRelative({ cp: 35 }, 'b')).toEqual({ cp: -35 });
	});

	it('negates a Black-to-move mate score', () => {
		expect(toWhiteRelative({ mate: 3 }, 'b')).toEqual({ mate: -3 });
	});

	it('leaves a White-to-move mate score unchanged', () => {
		expect(toWhiteRelative({ mate: -2 }, 'w')).toEqual({ mate: -2 });
	});
});

describe('formatEval', () => {
	it('formats a positive cp score with a leading +', () => {
		expect(formatEval({ cp: 35 })).toBe('+0.35');
	});

	it('formats a negative cp score with a leading -', () => {
		expect(formatEval({ cp: -120 })).toBe('-1.20');
	});

	it('formats a zero cp score with no sign', () => {
		expect(formatEval({ cp: 0 })).toBe('0.00');
	});

	it('formats a positive mate score as White mating', () => {
		expect(formatEval({ mate: 3 })).toBe('M3');
	});

	it('formats a negative mate score as Black mating', () => {
		expect(formatEval({ mate: -2 })).toBe('-M2');
	});
});

describe('evalBarWhiteFraction', () => {
	it('is 0.5 at an equal position', () => {
		expect(evalBarWhiteFraction({ cp: 0 })).toBe(0.5);
	});

	it('is 1 at or beyond +500cp', () => {
		expect(evalBarWhiteFraction({ cp: 500 })).toBe(1);
		expect(evalBarWhiteFraction({ cp: 900 })).toBe(1);
	});

	it('is 0 at or beyond -500cp', () => {
		expect(evalBarWhiteFraction({ cp: -500 })).toBe(0);
		expect(evalBarWhiteFraction({ cp: -900 })).toBe(0);
	});

	it('is 1 for any White-mating score', () => {
		expect(evalBarWhiteFraction({ mate: 4 })).toBe(1);
	});

	it('is 0 for any Black-mating score', () => {
		expect(evalBarWhiteFraction({ mate: -4 })).toBe(0);
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd mychess
npx vitest run src/lib/engine/uci.test.ts
```

Expected: FAIL — `Cannot find module './uci'` (the file doesn't exist yet).

- [ ] **Step 3: Write the implementation**

Create `mychess/src/lib/engine/uci.ts`:

```ts
// mychess/src/lib/engine/uci.ts

export type EngineScore = { cp?: number; mate?: number };

/**
 * Extracts the search depth and score from a raw UCI "info ..." line. Null
 * for any line that isn't a scored info line — a "bestmove" line, an
 * "info string ..." line (no score), or anything unparseable.
 */
export function parseInfoLine(line: string): { depth: number; score: EngineScore } | null {
	if (!line.startsWith('info ')) return null;
	const depthMatch = line.match(/\bdepth (\d+)/);
	const mateMatch = line.match(/\bscore mate (-?\d+)/);
	const cpMatch = line.match(/\bscore cp (-?\d+)/);
	if (!depthMatch || (!mateMatch && !cpMatch)) return null;
	const depth = Number(depthMatch[1]);
	if (mateMatch) return { depth, score: { mate: Number(mateMatch[1]) } };
	return { depth, score: { cp: Number(cpMatch![1]) } };
}

/** The side to move from a FEN's own second field. */
export function sideToMoveFromFen(fen: string): 'w' | 'b' {
	return fen.split(' ')[1] === 'b' ? 'b' : 'w';
}

/**
 * UCI scores are relative to whoever's turn it is in the analyzed position —
 * this converts to White-relative (positive = good for White) so the number
 * means the same thing regardless of board orientation, matching the
 * chess.com/Lichess convention.
 */
export function toWhiteRelative(score: EngineScore, sideToMove: 'w' | 'b'): EngineScore {
	if (sideToMove === 'w') return score;
	if (score.mate !== undefined) return { mate: -score.mate };
	return { cp: -(score.cp ?? 0) };
}

/** "+0.35", "-1.20", "0.00", "M4", "-M6" — sign follows the White-positive convention. */
export function formatEval(score: EngineScore): string {
	if (score.mate !== undefined) {
		return score.mate > 0 ? `M${score.mate}` : `-M${Math.abs(score.mate)}`;
	}
	const pawns = (score.cp ?? 0) / 100;
	const sign = pawns > 0 ? '+' : pawns < 0 ? '-' : '';
	return `${sign}${Math.abs(pawns).toFixed(2)}`;
}

/**
 * 0..1 — how much of the vertical eval bar should read as "White's". A
 * simple linear clamp over +/-500cp, not a win-probability curve — good
 * enough for a quick sanity check, not a serious analysis tool. Mate always
 * fills the bar fully toward whoever is mating.
 */
export function evalBarWhiteFraction(score: EngineScore): number {
	if (score.mate !== undefined) return score.mate > 0 ? 1 : 0;
	const clamped = Math.max(-500, Math.min(500, score.cp ?? 0));
	return (clamped + 500) / 1000;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd mychess
npx vitest run src/lib/engine/uci.test.ts
```

Expected: PASS, all 17 tests green.

- [ ] **Step 5: Commit**

```bash
cd mychess
git add src/lib/engine/uci.ts src/lib/engine/uci.test.ts
git commit -m "feat: add pure UCI info-line parsing/formatting for engine eval"
```

---

### Task 3: `EngineEval.svelte` — Worker lifecycle + display

**Files:**
- Create: `mychess/src/lib/components/EngineEval.svelte`

- [ ] **Step 1: Write the component**

Create `mychess/src/lib/components/EngineEval.svelte`:

```svelte
<!-- mychess/src/lib/components/EngineEval.svelte -->
<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import {
		parseInfoLine,
		sideToMoveFromFen,
		toWhiteRelative,
		formatEval,
		evalBarWhiteFraction,
		type EngineScore
	} from '$lib/engine/uci';

	let { fen, showBar = true }: { fen: string; showBar?: boolean } = $props();

	const ENGINE_URL = '/stockfish/stockfish-18-lite-single.js#stockfish-18-lite-single.wasm,worker';
	const MOVETIME_MS = 400;

	let worker: Worker | null = null;
	let ready = $state(false);
	let failed = $state(false);
	let score = $state<EngineScore | null>(null);
	// Plain (non-reactive) — only ever read/written from requestEval and the
	// $effect below, never needs to itself trigger a re-run.
	let lastRequestedFen = '';

	function send(cmd: string) {
		worker?.postMessage(cmd);
	}

	function requestEval(nextFen: string) {
		lastRequestedFen = nextFen;
		score = null;
		// "stop" is safe to send even when nothing is searching — sent
		// unconditionally so a burst of rapid fen changes (e.g. the practice
		// page's autoplay intro) never leaves a stale search about to
		// overwrite a newer one.
		send('stop');
		send(`position fen ${nextFen}`);
		send(`go movetime ${MOVETIME_MS}`);
	}

	function handleMessage(event: MessageEvent<string>) {
		const line = event.data;
		if (!ready) {
			if (line.includes('uciok')) send('isready');
			else if (line.includes('readyok')) ready = true;
			return;
		}
		const parsed = parseInfoLine(line);
		if (!parsed) return;
		score = toWhiteRelative(parsed.score, sideToMoveFromFen(lastRequestedFen));
	}

	function fail() {
		failed = true;
		worker?.terminate();
		worker = null;
	}

	onMount(() => {
		if (typeof Worker === 'undefined') {
			fail();
			return;
		}
		try {
			worker = new Worker(ENGINE_URL);
			worker.onmessage = handleMessage;
			worker.onerror = fail;
			send('uci');
		} catch {
			fail();
		}
	});

	onDestroy(() => {
		if (!worker) return;
		send('quit');
		worker.terminate();
	});

	// Fires once at mount time once `ready` flips true (re-evaluating the
	// fen already present at that point), and again on every later fen
	// change — a single code path for both cases.
	$effect(() => {
		if (ready && fen && fen !== lastRequestedFen) requestEval(fen);
	});

	const displayText = $derived(failed ? null : score ? formatEval(score) : '…');
	const whiteFraction = $derived(score ? evalBarWhiteFraction(score) : 0.5);
</script>

{#if displayText}
	<div class="flex items-center gap-3">
		{#if showBar}
			<div
				class="w-3 h-24 rounded-full overflow-hidden bg-gray-800 flex flex-col justify-end shrink-0"
				aria-hidden="true"
			>
				<div class="bg-white" style={`height: ${whiteFraction * 100}%`}></div>
			</div>
		{/if}
		<span class="text-lg font-bold text-gray-900">{displayText}</span>
	</div>
{/if}
```

- [ ] **Step 2: Type-check it**

```bash
cd mychess
npm run check 2>&1 | grep -i "EngineEval"
```

Expected: no output (no errors reported for this file). If you see errors, fix them before continuing — common one: `Worker` needs the `dom` lib, already enabled project-wide (same as `chessground`'s DOM usage elsewhere), so this should be clean.

- [ ] **Step 3: Commit**

```bash
cd mychess
git add src/lib/components/EngineEval.svelte
git commit -m "feat: add EngineEval component wrapping the Stockfish Web Worker"
```

---

### Task 4: Wire into the Practice page

**Files:**
- Modify: `mychess/src/routes/(player)/practice/[repertoire_id]/+page.svelte`
- Modify: `mychess/src/routes/(player)/practice/[repertoire_id]/practice.test.ts`

- [ ] **Step 1: Import `EngineEval` and `moveSequenceLabel`, add the move-list derived value**

In `mychess/src/routes/(player)/practice/[repertoire_id]/+page.svelte`, find this existing import block near the top of the `<script>`:

```svelte
	import { optimisticSolvedAfterAttempt, type PracticeView } from '$lib/mastery/practice';
	import { arrowMoveForStep, isLastPlayerMove } from '$lib/mastery/teaching';
	import type { VariationStep } from '$lib/mastery/variations';
```

Replace it with:

```svelte
	import { optimisticSolvedAfterAttempt, type PracticeView } from '$lib/mastery/practice';
	import { arrowMoveForStep, isLastPlayerMove } from '$lib/mastery/teaching';
	import { moveSequenceLabel, type VariationStep } from '$lib/mastery/variations';
	import EngineEval from '$lib/components/EngineEval.svelte';
```

Then find:

```svelte
	const displayFen = $derived(isReviewing ? positionAt(reviewIdx) : boardFen);
```

Right after that line, add:

```svelte

	// Plain-text move list for the mobile eval panel (Lichess-style), e.g.
	// "1.e4 e5 2.Nf3 Nc6" — every move actually played so far in this
	// attempt, independent of manualReviewIdx (browsing back to look at an
	// earlier position doesn't shrink the list).
	const movesSoFar = $derived(quizIdx > 0 ? moveSequenceLabel(quizSteps.slice(0, quizIdx)) : '');
```

- [ ] **Step 2: Add the desktop eval card to the sidebar**

Find this block:

```svelte
			<div class="w-full lg:w-72 shrink-0 space-y-4">
				<div class="p-4 bg-white border border-gray-200 rounded-2xl shadow-sm text-center hidden lg:block">
					<p class="text-gray-400 text-sm font-medium">{data.repertoire?.name}</p>
					<p class="text-gray-900 text-lg font-bold">{data.solved} / {data.total} variations solved</p>
				</div>
```

Replace it with:

```svelte
			<div class="w-full lg:w-72 shrink-0 space-y-4">
				<div class="p-4 bg-white border border-gray-200 rounded-2xl shadow-sm text-center hidden lg:block">
					<p class="text-gray-400 text-sm font-medium">{data.repertoire?.name}</p>
					<p class="text-gray-900 text-lg font-bold">{data.solved} / {data.total} variations solved</p>
				</div>

				<div class="p-4 bg-white border border-gray-200 rounded-2xl shadow-sm hidden lg:flex justify-center">
					<EngineEval fen={displayFen} />
				</div>
```

- [ ] **Step 3: Add the mobile eval number + move list below the move-nav row**

Find this block (the closing of the 4-button move-nav grid and its enclosing `<div class="flex-1">`):

```svelte
					<button
						onclick={reviewToLive}
						disabled={!isReviewing}
						aria-label="Jump to current position"
						class="py-2 rounded-xl bg-white border border-gray-200 text-gray-600 text-lg font-medium disabled:opacity-30 disabled:cursor-not-allowed hover:bg-gray-50"
					>
						⏭
					</button>
				</div>
			</div>
```

Replace it with:

```svelte
					<button
						onclick={reviewToLive}
						disabled={!isReviewing}
						aria-label="Jump to current position"
						class="py-2 rounded-xl bg-white border border-gray-200 text-gray-600 text-lg font-medium disabled:opacity-30 disabled:cursor-not-allowed hover:bg-gray-50"
					>
						⏭
					</button>
				</div>

				<div class="mt-3 p-3 bg-white border border-gray-200 rounded-2xl shadow-sm lg:hidden">
					<EngineEval fen={displayFen} showBar={false} />
					{#if movesSoFar}
						<p class="text-sm text-gray-500 mt-2">{movesSoFar}</p>
					{/if}
				</div>
			</div>
```

- [ ] **Step 4: Add a regression test confirming the page still renders with the engine unavailable**

In `mychess/src/routes/(player)/practice/[repertoire_id]/practice.test.ts`, find the last test in the file:

```ts
	it('also auto-plays the already-mastered prefix during a blind retest (no arrowPlies), not just a teach pass', async () => {
		vi.useFakeTimers();
		render(Practice, {
			props: {
				data: {
					repertoire: { id: 'r1', name: 'French Defense', color: 'white' },
					solved: 0,
					total: 1,
					allSolved: false,
					attempt: { ...AUTO_PLAY_ATTEMPT, arrowPlies: null, isFinalPass: true }
				}
			}
		});
		// autoPlayThrough (2) still applies with arrowPlies null — a blind
		// retest whose leading plies are already mastered (e.g. via a sibling
		// variation sharing them) auto-plays that part just like a teach pass
		// does, and only requires the player to blind-play what's left.
		expect(document.querySelector('main')?.getAttribute('data-phase')).toBe('autoplay');
		await vi.advanceTimersByTimeAsync(1000);
		expect(document.querySelector('main')?.getAttribute('data-phase')).toBe('playing');
	});
});
```

Replace the final `});` (closing the `describe` block) with one more test plus the closing brace:

```ts
	it('also auto-plays the already-mastered prefix during a blind retest (no arrowPlies), not just a teach pass', async () => {
		vi.useFakeTimers();
		render(Practice, {
			props: {
				data: {
					repertoire: { id: 'r1', name: 'French Defense', color: 'white' },
					solved: 0,
					total: 1,
					allSolved: false,
					attempt: { ...AUTO_PLAY_ATTEMPT, arrowPlies: null, isFinalPass: true }
				}
			}
		});
		// autoPlayThrough (2) still applies with arrowPlies null — a blind
		// retest whose leading plies are already mastered (e.g. via a sibling
		// variation sharing them) auto-plays that part just like a teach pass
		// does, and only requires the player to blind-play what's left.
		expect(document.querySelector('main')?.getAttribute('data-phase')).toBe('autoplay');
		await vi.advanceTimersByTimeAsync(1000);
		expect(document.querySelector('main')?.getAttribute('data-phase')).toBe('playing');
	});

	it('renders without crashing when the engine is unavailable (jsdom has no Worker)', () => {
		render(Practice, {
			props: {
				data: {
					repertoire: { id: 'r1', name: 'French Defense', color: 'white' },
					solved: 3,
					total: 5,
					allSolved: false,
					attempt: {
						variationKey: 'v1',
						path: [
							{
								moveId: 'm1',
								san: 'e4',
								fromFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
								toFen: 'rnbqkbnr/pppppppp/8/8/8/PPPPPPPP/8/RNBQKBNR w KQkq - 0 1',
								isPlayerTurn: true
							}
						]
					}
				}
			}
		});
		// jsdom doesn't implement the Worker API, so EngineEval's onMount
		// catches that and marks itself failed — this just confirms the page
		// (and EngineEval within it) doesn't throw and renders the board.
		expect(screen.getAllByText('French Defense').length).toBe(2);
	});
});
```

- [ ] **Step 5: Run the full practice test file**

```bash
cd mychess
npx vitest run "src/routes/(player)/practice/[repertoire_id]/practice.test.ts"
```

Expected: PASS, all tests green (11 total after this addition).

- [ ] **Step 6: Run the full test suite and type check**

```bash
cd mychess
npm test 2>&1 | tail -15
npm run check 2>&1 | tail -10
```

Expected: all tests pass; `svelte-check` reports the same error count as before this change (there was one pre-existing, unrelated error in an untracked WIP file — `src/routes/(coach)/coach/pgn/+page.server.ts` — not introduced by this work; confirm no NEW errors appear).

- [ ] **Step 7: Commit**

```bash
cd mychess
git add "src/routes/(player)/practice/[repertoire_id]/+page.svelte" "src/routes/(player)/practice/[repertoire_id]/practice.test.ts"
git commit -m "feat: show live Stockfish eval on the Practice page (desktop bar, mobile number + move list)"
```

---

### Task 5: Manual browser verification

**Files:** none (verification only)

- [ ] **Step 1: Start the dev server**

```bash
cd mychess
npm run dev
```

- [ ] **Step 2: Open the Practice page for a real repertoire in a browser and confirm:**

- The desktop sidebar shows an eval number + vertical bar that updates after each move (yours or an auto-played opponent reply).
- The eval number is White-relative (a move that's good for Black shows a negative number, regardless of your own color/board orientation).
- On a narrow/mobile viewport, the sidebar's number+bar card is replaced by just a number, and a move list like `1.e4 e5 2.Nf3 Nc6` appears below the ⏮◀▶⏭ row, growing as you play.
- Stepping back through the mobile move-nav (◀) updates the eval to that earlier position's score.
- Open the browser's Network tab and confirm `stockfish-18-lite-single.wasm` loads once (~7.3MB) and isn't re-fetched on every move.
- Open the browser's console and confirm no errors are thrown by `EngineEval` (a "Cross-Origin" or 404 error there means the static file paths in Task 1 are wrong).

- [ ] **Step 3: Stop the dev server**

```bash
pkill -f "vite dev"
```

- [ ] **Step 4: Push**

```bash
cd mychess
git push origin main
```
