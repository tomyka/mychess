# Engine in Explore Mode Only — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the evaluation bar from the Learn and Practice drilling path entirely, and show it in explore mode only after the player deliberately turns the engine on.

**Architecture:** Activation is one piece of module-level Svelte 5 rune state in `src/lib/engine/engine.svelte.ts` (`engineEnabled`), so it survives leaving and re-entering explore and navigating between Learn and Practice within a visit, and resets on reload. A new `EngineToggle.svelte` button writes it; both drill pages render `EvalBar` only while `explore.active && engineEnabled.on`. The precomputed-eval pipeline (`positions.eval_cp`, the sweep script, its daily workflow) had exactly one consumer — the drilling bar — and is deleted; the DB columns stay.

**Tech Stack:** SvelteKit 2 + Svelte 5 runes, Tailwind 4, vitest + @testing-library/svelte (jsdom), Stockfish WASM in a Web Worker.

**Spec:** `docs/superpowers/specs/2026-08-21-engine-explore-only-design.md`

**All commands run from `mychess/`** (the repo root is one level above).

**One behaviour to know before you start:** `retainEngine()` tears the worker down when the last mounted `EvalBar` unmounts. Since the bar unmounts every time explore closes, the worker dies then and re-spawns (from HTTP cache, ~130ms handshake) when explore next opens with the flag still on. That is intended — the *flag* is what persists for the visit, not the worker. Do not add worker-keepalive machinery.

---

### Task 1: Activation state in the engine module

**Files:**
- Modify: `src/lib/engine/engine.svelte.ts` (add after the `engineState` declaration, around line 39)
- Test: `src/lib/components/EvalBar.engine.test.ts` (add one test at the end of the existing `describe`)

- [ ] **Step 1: Write the failing test**

Add this test as the last one inside `describe('EvalBar against a live worker', ...)` in `src/lib/components/EvalBar.engine.test.ts`:

```ts
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
		unmount();
	});
```

Extend that file's existing import of the engine module (line 12) to pull in the two new exports:

```ts
import { engineState, engineEnabled, setEngineEnabled } from '$lib/engine/engine.svelte';
```

And add a reset to its existing `afterEach` (so this module-level flag can't leak into another test in the same process):

```ts
afterEach(() => {
	cleanup();
	FakeWorker.instances.length = 0;
	engineState.score = null;
	engineState.ready = false;
	engineState.failed = false;
	engineState.searching = false;
	engineEnabled.on = false;
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/components/EvalBar.engine.test.ts`
Expected: FAIL — the import of `engineEnabled` / `setEngineEnabled` does not resolve (`No "engineEnabled" export is defined on the module`).

- [ ] **Step 3: Add the state and its setter**

In `src/lib/engine/engine.svelte.ts`, immediately after the `engineState` declaration block (it ends with `});` around line 39), insert:

```ts
/**
 * Whether the player has switched the engine on. Off by default, and off again
 * on every reload: analysis is something you ask for in explore mode, not a
 * thing that quietly follows you into drilling (see the #126 follow-up spec).
 *
 * An object rather than an exported `let` because a module-scope `let` cannot be
 * exported reactively — consumers read `engineEnabled.on`.
 *
 * Module-level, so it outlives any one component: closing explore unmounts the
 * bar (and with it the worker), but re-opening explore in the same visit — or
 * moving between Learn and Practice — finds the engine already switched on.
 */
export const engineEnabled = $state<{ on: boolean }>({ on: false });

/** Switches the engine on or off; off stops the worker rather than just hiding it. */
export function setEngineEnabled(on: boolean) {
	engineEnabled.on = on;
	if (!on) teardownEngine();
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/components/EvalBar.engine.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/engine/engine.svelte.ts src/lib/components/EvalBar.engine.test.ts
git commit -m "feat(engine): a switch for whether the engine is running at all"
```

---

### Task 2: The toggle button

**Files:**
- Create: `src/lib/components/EngineToggle.svelte`
- Test: `src/lib/components/EngineToggle.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `src/lib/components/EngineToggle.test.ts`:

```ts
// @vitest-environment jsdom
// mychess/src/lib/components/EngineToggle.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/svelte';
import EngineToggle from './EngineToggle.svelte';
import { engineEnabled } from '$lib/engine/engine.svelte';

afterEach(() => {
	cleanup();
	engineEnabled.on = false;
});

describe('EngineToggle', () => {
	it('starts off, and says so to assistive tech', () => {
		render(EngineToggle);
		const button = screen.getByRole('button', { name: /engine/i });
		expect(button.getAttribute('aria-pressed')).toBe('false');
		expect(engineEnabled.on).toBe(false);
	});

	it('switches the engine on when pressed, and off again when pressed twice', async () => {
		render(EngineToggle);
		const button = screen.getByRole('button', { name: /engine/i });

		await fireEvent.click(button);
		expect(engineEnabled.on).toBe(true);
		expect(button.getAttribute('aria-pressed')).toBe('true');

		await fireEvent.click(button);
		expect(engineEnabled.on).toBe(false);
		expect(button.getAttribute('aria-pressed')).toBe('false');
	});

	it('reflects the engine being switched on from somewhere else', async () => {
		const { rerender } = render(EngineToggle);
		engineEnabled.on = true;
		await rerender({});
		expect(screen.getByRole('button', { name: /engine/i }).getAttribute('aria-pressed')).toBe('true');
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/components/EngineToggle.test.ts`
Expected: FAIL — `Failed to resolve import "./EngineToggle.svelte"`.

- [ ] **Step 3: Create the component**

Create `src/lib/components/EngineToggle.svelte`:

```svelte
<!-- mychess/src/lib/components/EngineToggle.svelte -->
<!--
	Switches the local engine on for this visit. Lives in explore mode's control
	row and nowhere else: drilling is repetition, and an evaluation on screen
	there invites judging the position instead of recalling the move.

	Off by default and off again after a reload, because pressing it costs a
	~5.5MB WASM download — a thing the player should ask for, not inherit.
-->
<script lang="ts">
	import { engineEnabled, setEngineEnabled } from '$lib/engine/engine.svelte';
</script>

<button
	type="button"
	aria-pressed={engineEnabled.on}
	onclick={() => setEngineEnabled(!engineEnabled.on)}
	class="py-2 rounded-xl border text-sm font-semibold {engineEnabled.on
		? 'border-(--color-accent) bg-(--color-accent)/10 text-(--color-text)'
		: 'border-(--color-border) bg-(--color-surface) text-(--color-muted)'}"
>
	<span aria-hidden="true">⚙</span> Engine{engineEnabled.on ? ' on' : ''}
</button>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/components/EngineToggle.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/EngineToggle.svelte src/lib/components/EngineToggle.test.ts
git commit -m "feat(engine): an explicit on switch for explore mode"
```

---

### Task 3: Learn — bar only while exploring with the engine on

**Files:**
- Modify: `src/routes/(player)/learn/[repertoire_id]/+page.svelte` (imports at lines 14-15; board block around lines 556-573; explore control row around lines 576-597)
- Test: `src/routes/(player)/learn/[repertoire_id]/learn.test.ts` (replace the last test, around lines 664-696; add a reset to `afterEach` around line 46)

- [ ] **Step 1: Write the failing tests**

In `src/routes/(player)/learn/[repertoire_id]/learn.test.ts`, add the engine import next to the existing imports at the top (after the `import Practice from './+page.svelte';` line):

```ts
import { engineEnabled } from '$lib/engine/engine.svelte';
```

Add the flag reset to the existing top-level `afterEach` so one test's toggle can't leak into the next:

```ts
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.useRealTimers();
	engineEnabled.on = false;
});
```

Then delete the whole final test — `it('renders the eval bar, and survives the engine being unavailable (no Worker in jsdom)', ...)`, comment included (around lines 664-696) — and put these three in its place, as the last tests in the file:

```ts
	// The engine is no longer part of drilling at all: Learn repeats a line, and
	// an evaluation on screen invites judging the position instead of recalling
	// the move. There is no bar, and nothing downloads an engine.
	it('shows no eval bar while drilling', async () => {
		vi.useFakeTimers();
		renderAttempt({ ...AUTO_PLAY_ATTEMPT, arrowPlies: null, isFinalPass: true });
		await vi.advanceTimersByTimeAsync(AUTO_PLAY_INTRO_MS);

		expect(screen.queryByRole('img', { name: /Engine evaluation/i })).toBeNull();
		expect(screen.queryByRole('button', { name: /engine/i })).toBeNull();
	});

	// Explore is where analysis belongs — but the toggle starts off, so the bar
	// (and the ~5.5MB download behind it) waits to be asked for.
	it('offers the engine in explore mode, switched off, with no bar yet', async () => {
		vi.useFakeTimers();
		renderAttempt({ ...AUTO_PLAY_ATTEMPT, arrowPlies: null, isFinalPass: true });
		await vi.advanceTimersByTimeAsync(AUTO_PLAY_INTRO_MS);
		await fireEvent.click(screen.getByText(/Explore this position/i));

		const toggle = screen.getByRole('button', { name: /engine/i });
		expect(toggle.getAttribute('aria-pressed')).toBe('false');
		expect(screen.queryByRole('img', { name: /Engine evaluation/i })).toBeNull();
	});

	// Pressed, the bar appears. jsdom has no Worker, so the engine can only
	// fail — which is exactly what the bar must survive: it says so and stays.
	it('shows the bar once the engine is switched on, even where no Worker exists', async () => {
		vi.useFakeTimers();
		renderAttempt({ ...AUTO_PLAY_ATTEMPT, arrowPlies: null, isFinalPass: true });
		await vi.advanceTimersByTimeAsync(AUTO_PLAY_INTRO_MS);
		await fireEvent.click(screen.getByText(/Explore this position/i));
		await fireEvent.click(screen.getByRole('button', { name: /engine/i }));

		const bar = screen.getByRole('img', { name: /Engine evaluation/i });
		expect(bar.getAttribute('aria-label')).toBe('Engine evaluation unavailable');
		expect(screen.getByRole('button', { name: /engine/i }).getAttribute('aria-pressed')).toBe('true');
	});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run "src/routes/(player)/learn/[repertoire_id]/learn.test.ts"`
Expected: FAIL — the first two fail because the bar renders unconditionally today (`queryByRole('img', ...)` is not null), and all three fail to find the engine button.

- [ ] **Step 3: Gate the bar and add the toggle**

In `src/routes/(player)/learn/[repertoire_id]/+page.svelte`, add two imports beside the existing `EvalBar` import (line 15):

```ts
	import EngineToggle from '$lib/components/EngineToggle.svelte';
	import { engineEnabled } from '$lib/engine/engine.svelte';
```

Replace the `<EvalBar ... />` element inside the board's flex container (lines 557-562) with this — the bar while exploring with the engine on, an empty slot of the same width while exploring without it, nothing at all while drilling:

```svelte
					<!-- Analysis belongs to explore mode, and only once asked for. The
					     empty slot holds the bar's place for as long as the excursion
					     lasts, so switching the engine on fills a waiting gap instead of
					     shoving the board sideways mid-analysis. -->
					<div class="w-8 shrink-0">
						{#if explore.active && engineEnabled.on}
							<EvalBar
								fen={displayFen}
								orientation={data.repertoire?.color === 'black' ? 'black' : 'white'}
								height={boardWidth}
							/>
						{/if}
					</div>
```

Then in the explore control row (the `<div class="grid grid-cols-2 gap-2 mt-4 shrink-0 mx-auto w-full">` at line 578), widen the grid and add the toggle between Undo and Back to the line:

```svelte
					<div
						class="grid grid-cols-3 gap-2 mt-4 shrink-0 mx-auto w-full"
						style={boardWidth ? `max-width: ${boardWidth}px` : ''}
					>
						<button
							onclick={() => explore.undo()}
							disabled={explore.depth === 0}
							class="py-2 rounded-xl bg-(--color-surface) border border-(--color-border) text-sm font-semibold text-(--color-text) disabled:opacity-30"
						>
							↶ Undo
						</button>
						<EngineToggle />
						<button
							onclick={stopExplore}
							class="py-2 rounded-xl border border-amber-300 bg-amber-50 text-sm font-semibold text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300"
						>
							↩ Back to the line
						</button>
					</div>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run "src/routes/(player)/learn/[repertoire_id]/learn.test.ts"`
Expected: PASS — every test in the file, including the pre-existing explore tests (the `/Undo/i` and `/Back to the line/i` queries are unaffected by the added third button).

- [ ] **Step 5: Commit**

```bash
git add "src/routes/(player)/learn/[repertoire_id]/+page.svelte" "src/routes/(player)/learn/[repertoire_id]/learn.test.ts"
git commit -m "feat(learn): no engine while drilling; switch it on in explore"
```

---

### Task 4: Practice — the same two edits

**Files:**
- Modify: `src/routes/(player)/practice/[repertoire_id]/+page.svelte` (imports at lines 3-13; board block around lines 415-420; explore control row around lines 434-455)

No test: this page has only `pool.test.ts` (pure queue logic), and its board markup is Learn's, verbatim. Task 3's tests cover the behaviour; Task 8's manual run covers this page.

- [ ] **Step 1: Add the imports**

In `src/routes/(player)/practice/[repertoire_id]/+page.svelte`, beside the existing `EvalBar` import (line 3):

```ts
	import EngineToggle from '$lib/components/EngineToggle.svelte';
	import { engineEnabled } from '$lib/engine/engine.svelte';
```

- [ ] **Step 2: Gate the bar**

Replace the `<EvalBar ... />` element (lines 415-420) with:

```svelte
					<!-- See Learn's copy: the bar belongs to explore mode and only once
					     the engine is switched on, with an empty slot holding its place
					     for the rest of the excursion so the board never jumps. -->
					<div class="w-8 shrink-0">
						{#if explore.active && engineEnabled.on}
							<EvalBar
								fen={displayFen}
								orientation={data.repertoire?.color === 'black' ? 'black' : 'white'}
								height={boardWidth}
							/>
						{/if}
					</div>
```

- [ ] **Step 3: Add the toggle to the explore control row**

Replace the explore control row (the `<div class="grid grid-cols-2 gap-2 mt-4 shrink-0 mx-auto w-full">` block at lines 436-455) with — note this page's second button keeps its `exploringDemoted` label:

```svelte
					<div
						class="grid grid-cols-3 gap-2 mt-4 shrink-0 mx-auto w-full"
						style={boardWidth ? `max-width: ${boardWidth}px` : ''}
					>
						<button
							onclick={() => explore.undo()}
							disabled={explore.depth === 0}
							class="py-2 rounded-xl bg-(--color-surface) border border-(--color-border) text-sm font-semibold text-(--color-text) disabled:opacity-30"
						>
							↶ Undo
						</button>
						<EngineToggle />
						<button
							onclick={stopExplore}
							class="py-2 rounded-xl border border-amber-300 bg-amber-50 text-sm font-semibold text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300"
						>
							{exploringDemoted ? '→ Next line' : '↩ Back to the line'}
						</button>
					</div>
```

- [ ] **Step 4: Verify the suite still passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "src/routes/(player)/practice/[repertoire_id]/+page.svelte"
git commit -m "feat(practice): no engine while drilling; switch it on in explore"
```

---

### Task 5: Drop `bookEval` from the bar

**Files:**
- Modify: `src/lib/components/EvalBar.svelte` (header comment lines 14-20; props lines 32-53; effects and `score` lines 56-75; the number's `<span>` class at lines 126-128)
- (Both pages already stopped passing `bookEval` when their slots were rewritten — nothing left to remove there.)
- Test: `src/lib/components/EvalBar.test.ts` (the five `bookEval` tests, lines 137-181)

Tasks 3 and 4 already dropped the `bookEval` attribute from both call sites; this task removes the prop itself.

**As shipped:** the slot in both pages is mounted unconditionally (`<div class="w-8 shrink-0">` with the `{#if}` inside), per the review that followed Task 3 — see the spec's Behaviour section.

- [ ] **Step 1: Rewrite the tests that used the prop**

In `src/lib/components/EvalBar.test.ts`, delete these four tests outright — each is a duplicate of a live-score test that survives, so no behaviour loses coverage:

- `it('uses the precomputed eval, without needing the engine at all', ...)` — the concept is gone; spawn-on-mount is covered by `EvalBar.engine.test.ts`
- `it('flips a precomputed eval with the board, like a live one', ...)` — same assertion as `it('flips with the board for a player with the black pieces', ...)`
- `it('prefers a live score for the current position over the stored one', ...)` — there is no stored score to prefer over
- `it('falls back to the stored eval while a live search is still running', ...)` — covered by `it('keeps the previous number up, dimmed, while the next search runs', ...)`

Keep the fifth as the file's only mate case, rewritten to a live score (replace the whole `it('shows a mate eval from the stored value', ...)` block, including the `// #126:` comment block above the group):

```ts
	it('shows a mate score as M-and-a-number, with the bar fully filled', () => {
		engineState.score = { mate: 3 };
		const { container } = render(EvalBar, { props: { fen: FEN, orientation: 'white', height: 400 } });
		expect((container.querySelector('[role="img"] span') as HTMLElement).textContent?.trim()).toBe('M3');
		expect(segments(container).map((s) => s.height)).toEqual(['0%', '100%']);
	});
```

- [ ] **Step 2: Run the tests to verify the file is green *before* the prop goes**

Run: `npx vitest run src/lib/components/EvalBar.test.ts`
Expected: PASS — the rewritten mate test passes against the current component too (a live score already wins when `searching` is false), which is what makes the next step a safe pure deletion.

- [ ] **Step 3: Remove the prop**

In `src/lib/components/EvalBar.svelte`, replace the props block (lines 32-53) with:

```svelte
	let {
		fen,
		orientation = 'white',
		height = 0
	}: {
		/** The position to evaluate — the board's own displayed FEN. */
		fen: string;
		orientation?: 'white' | 'black';
		// The board's own rendered size in px (it's square, so its width IS its
		// height) — the bar matches it exactly rather than guessing from the
		// viewport, since the board is height-constrained on desktop.
		height?: number;
	} = $props();
```

Replace the two effects and the `score` derivation (lines 56-75) with:

```svelte
	// The component only exists while the player has the engine switched on in
	// explore mode, so there is nothing conditional left here: mount it and it
	// spawns, hand it a position and it searches.
	$effect(() => {
		ensureEngine();
	});

	// Fires once when `ready` flips true (evaluating the fen already on screen at
	// that point) and again on every later position — one code path for both.
	$effect(() => {
		requestIfDue(fen);
	});

	const score = $derived(engineState.score);
```

In the number's `<span>` (lines 126-128), drop the `&& !bookEval` from the dimming condition, so the class expression starts:

```svelte
		class="absolute inset-x-0 text-center text-[0.6rem] font-bold leading-none tabular-nums transition-opacity {engineState.searching
			? 'opacity-60'
			: ''} {numberAtBottom
```

Finally replace the header comment's fourth paragraph (lines 14-20, the "Always on, and normally engine-free" paragraph) with:

```
	Shown only in explore mode, and only once the player has switched the engine
	on there (see EngineToggle.svelte): drilling in Learn and Practice has no bar
	and downloads no engine at all. While the bar is up, every position on it is
	evaluated by the local worker — there is no precomputed source any more.
	Before the first score, and if the engine can't load at all, the bar holds an
	even 50/50 so the board never shifts sideways — with a dash instead of a
	number when there is nothing to report.
```

- [ ] **Step 4: Run the whole suite and the type check**

Run: `npm test && npm run check`
Expected: PASS, and `check` reports zero errors — no call site passes `bookEval` any more (Tasks 3 and 4 removed both).

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/EvalBar.svelte src/lib/components/EvalBar.test.ts
git commit -m "refactor(engine): the bar has one source of numbers again"
```

---

### Task 6: Stop serving precomputed evals

**Files:**
- Modify: `src/routes/(player)/learn/[repertoire_id]/+page.server.ts` (import line 7; the `evals` const and its comment, lines 22-26; the return at line 28)
- Modify: `src/routes/(player)/practice/[repertoire_id]/+page.server.ts` (import line 12; the lookahead block, lines 66-78; `evals` in the returned object)
- Delete: `src/lib/server/position-evals.ts`

- [ ] **Step 1: Remove the Learn load**

In `src/routes/(player)/learn/[repertoire_id]/+page.server.ts`: delete the import line

```ts
import { loadPositionEvals, fensInPath } from '$lib/server/position-evals';
```

delete the comment block and const (lines 22-26):

```ts
	// Precomputed evals for exactly the positions this attempt can put on the
	// board (#126) — what lets the eval bar show a number without the client
	// downloading an engine at all. Empty until scripts/eval-positions.ts has run
	// for these positions, which the bar renders as its neutral state.
	const evals = view.attempt ? await loadPositionEvals(supabase, fensInPath(view.attempt.path)) : {};
```

and change the return to:

```ts
	return { repertoire, ...view };
```

- [ ] **Step 2: Remove the Practice load**

In `src/routes/(player)/practice/[repertoire_id]/+page.server.ts`: delete the same import line, delete this block (lines 66-78):

```ts
	// Same as Learn's: precomputed evals for the positions the queue can show, so
	// the bar has a number without an engine download (#126). Scoped to the
	// FIRST few lines rather than the whole queue — a long pool would mean a
	// pointless lookup for positions this sitting will never reach.
	const EVAL_LOOKAHEAD_LINES = 5;
	const evals = await loadPositionEvals(
		supabase,
		ordered
			.slice(0, EVAL_LOOKAHEAD_LINES)
			.flatMap((key) => fensInPath(byKey.get(key)?.path ?? []))
	);
```

and remove the `evals,` line from the returned object (it sits directly under `repertoire,`).

- [ ] **Step 3: Delete the module**

```bash
git rm src/lib/server/position-evals.ts
```

- [ ] **Step 4: Verify nothing else referenced it**

Run: `grep -rn "position-evals\|loadPositionEvals\|fensInPath\|data.evals" src scripts`
Expected: no output.

Run: `npm test && npm run check && npm run lint`
Expected: all three green, zero errors.

- [ ] **Step 5: Commit**

```bash
git add -A src
git commit -m "refactor(engine): stop serving precomputed evals to the drill pages"
```

---

### Task 7: Delete the precompute pipeline

**Files:**
- Delete: `scripts/eval-positions.ts`
- Delete: `src/lib/engine/stockfishProcess.ts` (the script is its only importer)
- Modify: `package.json` (the `positions:eval` script, line 18)
- Delete: `../.github/workflows/eval-positions.yml` (the daily sweep from #130)
- Modify: `src/lib/engine/version.ts` (drop `SEARCH_MOVETIME_MS` and `ENGINE_ID`, rewrite the file's comments)

- [ ] **Step 1: Confirm the consumers really are gone**

Run: `grep -rn "stockfishProcess\|StockfishProcess\|ENGINE_ID\|SEARCH_MOVETIME_MS\|positions:eval\|eval-positions" src scripts package.json ../.github`

Expected: hits only in the files this task deletes or edits — `scripts/eval-positions.ts`, `src/lib/engine/stockfishProcess.ts`, `src/lib/engine/version.ts`, `package.json:18`, and `.github/workflows/eval-positions.yml`. If anything else appears, stop and report it rather than deleting.

- [ ] **Step 2: Delete the files**

```bash
git rm scripts/eval-positions.ts src/lib/engine/stockfishProcess.ts ../.github/workflows/eval-positions.yml
```

(From `mychess/`, the workflow path is `../.github/workflows/eval-positions.yml`.)

- [ ] **Step 3: Drop the npm script**

In `package.json`, delete this line from `"scripts"` (line 18):

```json
		"positions:eval": "tsx --env-file-if-exists=.env scripts/eval-positions.ts",
```

- [ ] **Step 4: Shrink `version.ts` to what the browser needs**

Replace the entire contents of `src/lib/engine/version.ts` with:

```ts
// mychess/src/lib/engine/version.ts
//
// Which Stockfish build the browser worker loads. One place, because the file
// stem is shared by the .js bootstrap and the .wasm binary beside it — the
// bootstrap locates the wasm by basename.
//
// This file used to also carry the identity stamped on precomputed evaluations
// (`ENGINE_ID`) and the search time that job used. Both are gone with the job
// itself: the engine now runs only in explore mode, on the position in front of
// the player, and nothing is stored.

/**
 * The engine build. Swapping it in (#127) is a config change: drop `<stem>.js`
 * and `<stem>.wasm` into `static/stockfish/` and change `basename` here.
 */
export const ENGINE = {
	/** File stem under `static/stockfish/`, shared by the .js and the .wasm. */
	basename: 'stockfish-18-lite-single'
} as const;
```

Note `shortId` goes too — it existed only for the stamp. `src/lib/engine/engine.svelte.ts` reads `ENGINE.basename` only, so it needs no edit; its own `MOVETIME_MS = 400` is unaffected.

- [ ] **Step 5: Check for stray references to the removed field**

Run: `grep -rn "shortId\|ENGINE\." src scripts`
Expected: only `src/lib/engine/engine.svelte.ts`'s two uses of `ENGINE.basename`.

Run: `npm test && npm run check && npm run lint`
Expected: all green, zero errors.

- [ ] **Step 6: Note the leftover data in the spec's terms**

The `positions.eval_cp` / `eval_mate` / `eval_engine` columns stay — deliberately, per the spec: no migration, and the ~31k stored numbers are harmless. Do not write a migration to drop them.

- [ ] **Step 7: Commit**

```bash
git add -A . ../.github
git commit -m "chore(engine): retire the precompute job and its daily sweep"
```

---

### Task 8: Verify against the real app

**Files:** none (verification only)

- [ ] **Step 1: Full local gate**

Run: `npm test && npm run lint && npm run check`
Expected: three green runs, zero errors in each. Do not proceed past a single error — `main` tolerates no baseline.

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: build completes with no errors.

- [ ] **Step 3: Drive the real pages**

Run: `npm run dev`, open a repertoire in Learn with DevTools → Network filtered to `stockfish`, and confirm:

1. Drilling: no eval bar beside the board, and **no** `stockfish-*.js` / `.wasm` request.
2. "Explore this position": three buttons (Undo / ⚙ Engine / Back to the line), still no bar, still no engine request; the board has not moved sideways — the bar's slot is mounted all along, empty.
3. Press ⚙ Engine: one `stockfish-18-lite-single.js` + `.wasm` request, the bar appears in the reserved gap (the board does not jump), and its number changes as you play moves off-book.
4. Press it again: bar disappears, no further requests.
5. Back to the line, then explore again: bar is there immediately (button still reads "Engine on"), one fresh worker, no new network request — the WASM comes from cache.
6. Reload the page: the toggle is off again.
7. Repeat 1-3 on a Practice repertoire, including the "See why" entry after deliberately playing a wrong move.

- [ ] **Step 4: Report**

State plainly what passed and anything that did not, with the actual output — no "should work". If step 3 differs from this list, stop and report rather than patching around it.
