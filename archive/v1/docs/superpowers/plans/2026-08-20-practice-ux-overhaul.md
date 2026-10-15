# Practice screen UX overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework `/practice/[repertoire_id]` per the spec at `docs/superpowers/specs/2026-08-20-practice-ux-overhaul-design.md` (GitHub issue #92) — a wider, flush-top board with no dead gap, a standing status strip, an always-available hint that marks a pass dirty, a labeled engine panel, a five-card sidebar (progress / this-line / engine / help / session), readable nav-row icons with a ply indicator, and zero hardcoded `gray-*` colors.

**Architecture:** All changes are in-place edits to `mychess/src/routes/(player)/practice/[repertoire_id]/+page.svelte` and `mychess/src/lib/components/EngineEval.svelte`, plus one new presentational component (`PracticeStatusStrip.svelte`). No server/API/schema changes — this is a pure client-side/markup rework building on state that already exists (`phase`, `arrowMove`, `teachCue`, `attemptHadMistake`).

**Tech Stack:** SvelteKit 2 / Svelte 5 (runes), Tailwind 4 (CSS custom-property tokens), Vitest + @testing-library/svelte.

---

## File Structure

- Modify: `mychess/src/routes/(player)/practice/[repertoire_id]/+page.svelte` — layout, state machine additions, sidebar/nav markup.
- Modify: `mychess/src/routes/(player)/practice/[repertoire_id]/practice.test.ts` — existing assertions updated for the header/hint/nav changes, new tests added.
- Modify: `mychess/src/lib/components/EngineEval.svelte` — "Engine" label, White/Black legend, token-based bar track.
- Modify: `mychess/src/lib/components/EngineEval.test.ts` — new tests for the label/legend.
- Create: `mychess/src/lib/components/PracticeStatusStrip.svelte` — pure presentational status strip.
- Create: `mychess/src/lib/components/PracticeStatusStrip.test.ts` — its unit tests.

All commands below run from `mychess/` (the actual SvelteKit app root, one level below the git repo root).

---

### Task 1: Widen the page and fix the flush-top board gap

**Files:**
- Modify: `mychess/src/routes/(player)/practice/[repertoire_id]/+page.svelte`

This is a pure layout/CSS change (goals (2) and (3) from the spec) — no new logic, so there's no meaningful unit test to write first; jsdom doesn't run a real layout engine or evaluate container queries. Verify visually instead, per this repo's convention for UI changes.

- [ ] **Step 1: Widen the page**

In `+page.svelte`, find the `<main>` tag (around line 386):

```svelte
<main
	class="min-h-screen lg:min-h-0 lg:h-[calc(100vh-4rem)] lg:overflow-hidden bg-(--color-bg) p-4 max-w-5xl mx-auto pb-24 lg:pb-4 flex flex-col"
	data-phase={phase}
>
```

Change `max-w-5xl` to `max-w-7xl`:

```svelte
<main
	class="min-h-screen lg:min-h-0 lg:h-[calc(100vh-4rem)] lg:overflow-hidden bg-(--color-bg) p-4 max-w-7xl mx-auto pb-24 lg:pb-4 flex flex-col"
	data-phase={phase}
>
```

- [ ] **Step 2: Stop vertically centering the board inside its sizing container**

Find the board's sizing wrapper (around line 467):

```svelte
				<div class="lg:flex-1 lg:min-h-0 lg:flex lg:items-center lg:justify-center lg:[container-type:size]">
```

Change `lg:items-center` to `lg:items-start` (keep `lg:justify-center` for horizontal centering):

```svelte
				<div class="lg:flex-1 lg:min-h-0 lg:flex lg:items-start lg:justify-center lg:[container-type:size]">
```

This is the actual fix for the ~200px gap: the board's `containerFit` sizing (`w-[min(100cqh,100%)]` in `ChessBoard.svelte`) already correctly fills the container's height when width isn't the binding constraint. When it *is* the binding constraint (a narrow-but-tall viewport), the board renders shorter than its slot; `items-center` used to split that leftover space above and below, `items-start` collapses it to the bottom, right above the nav row.

Do **not** touch `ChessBoard.svelte`'s `containerFit`/cqh sizing mechanism itself — its own comments document a real, previously-shipped production bug (a non-square board) from an earlier `max-width` + `height: 100%` approach. This task deliberately reuses the existing, already-fixed mechanism.

- [ ] **Step 3: Give the sidebar a fixed width instead of competing for flex space**

Find the sidebar wrapper (around line 527):

```svelte
			<div
				class="w-full lg:flex-1 lg:min-w-72 lg:max-w-sm hidden lg:flex lg:flex-col divide-y divide-(--color-border) bg-(--color-surface) border border-(--color-border) rounded-2xl shadow-sm lg:overflow-y-auto"
			>
```

Change to a fixed rail width:

```svelte
			<div
				class="w-full lg:w-80 lg:shrink-0 hidden lg:flex lg:flex-col divide-y divide-(--color-border) bg-(--color-surface) border border-(--color-border) rounded-2xl shadow-sm lg:overflow-y-auto"
			>
```

- [ ] **Step 4: Manual verification**

Run the dev server:

```bash
npm run dev
```

Open `/practice/<a repertoire id with moves for your account>` in a browser at:
- A wide desktop viewport (e.g. 1920×1080): confirm the board is noticeably larger than before, sits flush to the top of its column (no gap above it beyond the status-strip area added in Task 6), and there is no gap between the board and the move-nav row below it.
- A narrow-but-tall window (e.g. 700×1200, simulating the case where board width is still the binding constraint): confirm any leftover space collapses to the bottom of the board's slot (just above the nav row), not split above and below the board.

- [ ] **Step 5: Run the full test suite (nothing should be affected yet)**

```bash
npm test
npm run check
```

Expected: both clean — this task touched only Tailwind classes on elements jsdom doesn't lay out.

- [ ] **Step 6: Commit**

```bash
git add src/routes/\(player\)/practice/\[repertoire_id\]/+page.svelte
git commit -m "fix(practice): widen page and stop centering the board vertically"
```

---

### Task 2: Move the repertoire title into the page header

**Files:**
- Modify: `mychess/src/routes/(player)/practice/[repertoire_id]/+page.svelte`
- Modify: `mychess/src/routes/(player)/practice/[repertoire_id]/practice.test.ts`

Implements goal (10): repertoire name in the page header, not duplicated in the sidebar or the mobile card.

- [ ] **Step 1: Update the three tests that currently expect the name to render twice**

These tests currently assert the repertoire name renders in exactly two places (the mobile card and the desktop sidebar). After this task it renders in exactly one place (the header). In `practice.test.ts`, there are three occurrences of this exact line — change each from `.toBe(2)` to `.toBe(1)`:

```ts
			expect(screen.getAllByText('French Defense').length).toBe(2);
```

becomes:

```ts
			expect(screen.getAllByText('French Defense').length).toBe(1);
```

Occurrences are in: `'shows the board, not the solved screen, when re-drilling a variation from a completed repertoire'`, `'shows the repertoire name and solved/total progress while an attempt is in flight'`, and `'renders without crashing with the engine toggle in its default (off) state'`.

- [ ] **Step 2: Run the tests to verify they now fail (name still renders twice)**

```bash
npx vitest run src/routes/\(player\)/practice/\[repertoire_id\]/practice.test.ts
```

Expected: the three tests above FAIL (actual count is still 2, not 1 yet).

- [ ] **Step 3: Add the title to the header row**

Find the header row (around line 389):

```svelte
	<div class="mb-3 flex items-center justify-between shrink-0">
		<a href="/practice" class="text-(--color-muted) text-sm hover:text-(--color-text)">← All Repertoires</a>
		{#if repertoireId}
			<button
				onclick={() => (pickerOpen = true)}
				class="lg:hidden inline-flex items-center gap-1 text-(--color-accent) text-sm font-medium hover:underline"
			>
				<span aria-hidden="true">📖</span> Switch variation
			</button>
		{/if}
	</div>
```

Replace with:

```svelte
	<div class="mb-3 flex items-center justify-between gap-3 shrink-0">
		<a href="/practice" class="text-(--color-muted) text-sm hover:text-(--color-text) shrink-0">← All Repertoires</a>
		{#if data.repertoire?.name}
			<h1 class="text-(--color-text) font-bold text-base sm:text-lg truncate text-center flex-1">
				{data.repertoire.name}
			</h1>
		{/if}
		{#if repertoireId}
			<button
				onclick={() => (pickerOpen = true)}
				class="lg:hidden inline-flex items-center gap-1 text-(--color-accent) text-sm font-medium hover:underline shrink-0"
			>
				<span aria-hidden="true">📖</span> Switch variation
			</button>
		{/if}
	</div>
```

- [ ] **Step 4: Remove the name from the mobile card**

Find the mobile-only progress card (around line 432):

```svelte
		<div class="p-3 bg-(--color-surface) border border-(--color-border) rounded-2xl shadow-sm text-center mb-3 shrink-0 lg:hidden">
			<p class="text-sm font-medium">
				<span class="text-(--color-muted)">{data.repertoire?.name}</span>
				<span class="mx-1.5 text-gray-300">·</span>
				<span class="text-(--color-text) font-bold">{data.solved} / {data.total} variations solved</span>
			</p>
		</div>
```

Replace with:

```svelte
		<div class="p-3 bg-(--color-surface) border border-(--color-border) rounded-2xl shadow-sm text-center mb-3 shrink-0 lg:hidden">
			<p class="text-sm font-bold text-(--color-text)">{data.solved} / {data.total} variations solved</p>
		</div>
```

(This also removes the `text-gray-300` separator, one instance of goal (9)'s token cleanup, since there's no longer a second value to separate.)

- [ ] **Step 5: Remove the name from the desktop sidebar's progress card**

Find the sidebar's first card (around line 530):

```svelte
				<div class="p-4">
					<p class="text-(--color-text) font-bold text-sm">{data.repertoire?.name}</p>
					<div class="flex items-center justify-between gap-2 mt-1">
```

Replace with:

```svelte
				<div class="p-4">
					<div class="flex items-center justify-between gap-2">
```

(Leave the rest of that card — the Switch button and progress bar — untouched; Task 7 rewrites this whole card again.)

- [ ] **Step 6: Run the tests to verify they now pass**

```bash
npx vitest run src/routes/\(player\)/practice/\[repertoire_id\]/practice.test.ts
```

Expected: PASS, including the three updated assertions.

- [ ] **Step 7: Commit**

```bash
git add src/routes/\(player\)/practice/\[repertoire_id\]/+page.svelte src/routes/\(player\)/practice/\[repertoire_id\]/practice.test.ts
git commit -m "refactor(practice): move repertoire title into the page header"
```

---

### Task 3: Nav row — inline SVG icons, ply indicator, token-based hover

**Files:**
- Modify: `mychess/src/routes/(player)/practice/[repertoire_id]/+page.svelte`
- Modify: `mychess/src/routes/(player)/practice/[repertoire_id]/practice.test.ts`

Implements goal (6) and the nav-row part of goal (9). `aria-label`s are unchanged — existing tests query by them and must keep passing untouched.

- [ ] **Step 1: Write the new ply-indicator test (fails first — the row is still 4 cells with no ply text)**

Add this test to `practice.test.ts`, right after `'lets the mobile move-nav browse back through the current attempt and forward again to live'` (around line 341):

```ts
	it('shows the current ply position in the nav row', async () => {
		vi.useFakeTimers();
		render(Practice, {
			props: {
				data: {
					repertoire: { id: 'r1', name: 'French Defense', color: 'white' },
					solved: 0,
					total: 1,
					allSolved: false,
					attempt: AUTO_PLAY_ATTEMPT
				}
			}
		});
		await vi.advanceTimersByTimeAsync(1000); // autoplay intro finishes, quizIdx lands at 2
		expect(screen.getByText('2 / 4')).toBeTruthy();
	});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run src/routes/\(player\)/practice/\[repertoire_id\]/practice.test.ts -t "shows the current ply position"
```

Expected: FAIL — `'2 / 4'` isn't in the document yet.

- [ ] **Step 3: Replace the nav-row markup**

Find the nav-row grid (around line 481):

```svelte
				<div
					class="grid grid-cols-4 gap-2 mt-4 shrink-0 mx-auto w-full"
					style={boardWidth ? `max-width: ${boardWidth}px` : ''}
				>
					<button
						onclick={reviewToStart}
						disabled={reviewIdx <= 0}
						aria-label="Jump to start"
						class="py-2 rounded-xl bg-(--color-surface) border border-(--color-border) text-(--color-muted) text-lg font-medium disabled:opacity-30 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-gray-800"
					>
						⏮
					</button>
					<button
						onclick={reviewBack}
						disabled={reviewIdx <= 0}
						aria-label="Move back"
						class="py-2 rounded-xl bg-(--color-surface) border border-(--color-border) text-(--color-muted) text-lg font-medium disabled:opacity-30 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-gray-800"
					>
						◀
					</button>
					<button
						onclick={reviewForward}
						disabled={!isReviewing}
						aria-label="Move forward"
						class="py-2 rounded-xl bg-(--color-surface) border border-(--color-border) text-(--color-muted) text-lg font-medium disabled:opacity-30 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-gray-800"
					>
						▶
					</button>
					<button
						onclick={reviewToLive}
						disabled={!isReviewing}
						aria-label="Jump to current position"
						class="py-2 rounded-xl bg-(--color-surface) border border-(--color-border) text-(--color-muted) text-lg font-medium disabled:opacity-30 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-gray-800"
					>
						⏭
					</button>
				</div>
```

Replace with:

```svelte
				<div
					class="grid grid-cols-5 gap-2 mt-4 shrink-0 mx-auto w-full items-center"
					style={boardWidth ? `max-width: ${boardWidth}px` : ''}
				>
					<button
						onclick={reviewToStart}
						disabled={reviewIdx <= 0}
						aria-label="Jump to start"
						class="py-2 rounded-xl bg-(--color-surface) border border-(--color-border) text-(--color-text) disabled:opacity-30 disabled:cursor-not-allowed hover:bg-(--color-border)/40"
					>
						<svg viewBox="0 0 20 20" fill="currentColor" class="w-4 h-4 mx-auto" aria-hidden="true">
							<rect x="4" y="4" width="1.6" height="12" />
							<path d="M14.5 4l-6 6 6 6V4z" />
						</svg>
					</button>
					<button
						onclick={reviewBack}
						disabled={reviewIdx <= 0}
						aria-label="Move back"
						class="py-2 rounded-xl bg-(--color-surface) border border-(--color-border) text-(--color-text) disabled:opacity-30 disabled:cursor-not-allowed hover:bg-(--color-border)/40"
					>
						<svg viewBox="0 0 20 20" fill="currentColor" class="w-4 h-4 mx-auto" aria-hidden="true">
							<path d="M12.5 4l-6 6 6 6V4z" />
						</svg>
					</button>
					<p class="text-center text-sm font-semibold text-(--color-muted) tabular-nums" aria-hidden="true">
						{reviewIdx} / {quizSteps.length}
					</p>
					<button
						onclick={reviewForward}
						disabled={!isReviewing}
						aria-label="Move forward"
						class="py-2 rounded-xl bg-(--color-surface) border border-(--color-border) text-(--color-text) disabled:opacity-30 disabled:cursor-not-allowed hover:bg-(--color-border)/40"
					>
						<svg viewBox="0 0 20 20" fill="currentColor" class="w-4 h-4 mx-auto" aria-hidden="true">
							<path d="M7.5 4l6 6-6 6V4z" />
						</svg>
					</button>
					<button
						onclick={reviewToLive}
						disabled={!isReviewing}
						aria-label="Jump to current position"
						class="py-2 rounded-xl bg-(--color-surface) border border-(--color-border) text-(--color-text) disabled:opacity-30 disabled:cursor-not-allowed hover:bg-(--color-border)/40"
					>
						<svg viewBox="0 0 20 20" fill="currentColor" class="w-4 h-4 mx-auto" aria-hidden="true">
							<rect x="14.4" y="4" width="1.6" height="12" />
							<path d="M5.5 4l6 6-6 6V4z" />
						</svg>
					</button>
				</div>
```

- [ ] **Step 4: Run the test to verify it passes, plus the existing nav-row tests**

```bash
npx vitest run src/routes/\(player\)/practice/\[repertoire_id\]/practice.test.ts
```

Expected: PASS, including the pre-existing `getByLabelText('Move back')` / `'Move forward'` / `'Jump to current position'` tests (labels unchanged) and the new ply-indicator test.

- [ ] **Step 5: Commit**

```bash
git add src/routes/\(player\)/practice/\[repertoire_id\]/+page.svelte src/routes/\(player\)/practice/\[repertoire_id\]/practice.test.ts
git commit -m "refactor(practice): nav row gets SVG icons, a ply indicator, and token-based hover"
```

---

### Task 4: EngineEval — "Engine" label, White/Black legend, token-based track

**Files:**
- Modify: `mychess/src/lib/components/EngineEval.svelte`
- Modify: `mychess/src/lib/components/EngineEval.test.ts`

Implements goal (7) and the remaining part of goal (9) outside the route file itself — `EngineEval` is only ever rendered from the practice route (confirmed: no other route imports it), so this is still fully in-scope for the "no hardcoded `gray-*` in the practice UI" acceptance criterion.

- [ ] **Step 1: Write the failing tests**

Add to `EngineEval.test.ts`, right after the `it('renders a switch that is off by default...')` test (around line 40):

```ts
it('always shows the "Engine" label, even when the toggle is off', () => {
	enginePrefStore.enabled = false;
	const { getByText, unmount } = render(EngineEval, { props: { fen: FEN } });
	expect(getByText('Engine')).toBeTruthy();
	unmount();
});
```

And inside the `describe('EngineEval Worker singleton lifecycle', ...)` block, right after `it('walks the full UCI handshake and updates the displayed eval once a score arrives', ...)` (around line 202):

```ts
	it('shows a White/Black legend on the eval bar once a score arrives', () => {
		vi.stubGlobal('Worker', FakeWorker as unknown as typeof Worker);

		const { getByText } = render(EngineEval, { props: { fen: FEN } });
		const worker = FakeWorker.instances[0];
		worker.emit('uciok');
		flushSync();
		worker.emit('readyok');
		flushSync();
		worker.emit('info depth 12 seldepth 18 multipv 1 score cp 35 nodes 1000 nps 500000 time 20 pv e2e4 e7e5');
		flushSync();

		expect(getByText('W')).toBeTruthy();
		expect(getByText('B')).toBeTruthy();
	});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run src/lib/components/EngineEval.test.ts -t "Engine"
```

Expected: both FAIL — neither the label nor the legend exist yet.

- [ ] **Step 3: Rewrite the template**

Find the template (from `<div class="flex items-center gap-2">` through its closing `</div>`, around lines 164–203):

```svelte
<div class="flex items-center gap-2">
	<button
		type="button"
		role="switch"
		aria-checked={enginePrefStore.enabled}
		aria-label="Toggle engine evaluation"
		onclick={() => setEnginePref(!enginePrefStore.enabled)}
		class="relative w-9 h-5 rounded-full shrink-0 transition-colors {enginePrefStore.enabled
			? 'bg-(--color-accent)'
			: 'bg-(--color-border)'}"
	>
		<span
			class="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm flex items-center justify-center transition-transform {enginePrefStore.enabled
				? 'translate-x-4'
				: ''}"
		>
			{#if enginePrefStore.enabled}
				<svg viewBox="0 0 20 20" fill="currentColor" class="w-2.5 h-2.5 text-(--color-accent)" aria-hidden="true">
					<path
						fill-rule="evenodd"
						d="M16.704 5.29a1 1 0 010 1.415l-7.25 7.25a1 1 0 01-1.414 0l-3.25-3.25a1 1 0 111.414-1.415L8.75 11.836l6.543-6.543a1 1 0 011.411-.003z"
						clip-rule="evenodd"
					/>
				</svg>
			{/if}
		</span>
	</button>
	{#if enginePrefStore.enabled}
		{#if failed}
			<span class="text-sm text-(--color-muted) italic">unavailable</span>
		{:else}
			<span class="text-base font-bold text-(--color-text) tabular-nums shrink-0">{displayText}</span>
			{#if whiteFraction !== null}
				<div class="flex-1 h-1.5 rounded-full bg-gray-800 overflow-hidden" aria-hidden="true">
					<div class="h-full bg-white" style={`width: ${whiteFraction * 100}%`}></div>
				</div>
			{/if}
		{/if}
	{/if}
</div>
```

Replace with:

```svelte
<div class="flex flex-col gap-1.5">
	<div class="flex items-center gap-2">
		<span class="text-xs font-semibold uppercase tracking-wide text-(--color-muted)">Engine</span>
		<button
			type="button"
			role="switch"
			aria-checked={enginePrefStore.enabled}
			aria-label="Toggle engine evaluation"
			onclick={() => setEnginePref(!enginePrefStore.enabled)}
			class="relative w-9 h-5 rounded-full shrink-0 transition-colors {enginePrefStore.enabled
				? 'bg-(--color-accent)'
				: 'bg-(--color-border)'}"
		>
			<span
				class="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm flex items-center justify-center transition-transform {enginePrefStore.enabled
					? 'translate-x-4'
					: ''}"
			>
				{#if enginePrefStore.enabled}
					<svg viewBox="0 0 20 20" fill="currentColor" class="w-2.5 h-2.5 text-(--color-accent)" aria-hidden="true">
						<path
							fill-rule="evenodd"
							d="M16.704 5.29a1 1 0 010 1.415l-7.25 7.25a1 1 0 01-1.414 0l-3.25-3.25a1 1 0 111.414-1.415L8.75 11.836l6.543-6.543a1 1 0 011.411-.003z"
							clip-rule="evenodd"
						/>
					</svg>
				{/if}
			</span>
		</button>
		{#if enginePrefStore.enabled}
			{#if failed}
				<span class="text-sm text-(--color-muted) italic">unavailable</span>
			{:else}
				<span class="text-base font-bold text-(--color-text) tabular-nums shrink-0">{displayText}</span>
			{/if}
		{/if}
	</div>
	{#if enginePrefStore.enabled && !failed && whiteFraction !== null}
		<div class="flex items-center gap-1.5">
			<span class="text-[10px] font-semibold text-(--color-muted)">W</span>
			<div class="flex-1 h-1.5 rounded-full bg-(--color-border) overflow-hidden" aria-hidden="true">
				<div class="h-full bg-white" style={`width: ${whiteFraction * 100}%`}></div>
			</div>
			<span class="text-[10px] font-semibold text-(--color-muted)">B</span>
		</div>
	{/if}
</div>
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run src/lib/components/EngineEval.test.ts
```

Expected: PASS, including every pre-existing test in the file (aria-labels and "unavailable"/eval text are unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/EngineEval.svelte src/lib/components/EngineEval.test.ts
git commit -m "feat(engine-eval): label the panel and add a White/Black legend"
```

---

### Task 5: Practice state machine — always-available hint that marks the pass dirty, mistake/session counters

**Files:**
- Modify: `mychess/src/routes/(player)/practice/[repertoire_id]/+page.svelte`
- Modify: `mychess/src/routes/(player)/practice/[repertoire_id]/practice.test.ts`

Implements goal (5) in full, the hint-decision from the spec, and lays the state groundwork Tasks 6 and 7 render. `wrongCount` is removed entirely — once the hint no longer gates on it, nothing reads it, and per this repo's conventions dead state should be deleted, not left "for later."

- [ ] **Step 1: Update the test whose reasoning the old gate supported**

Find this test in `practice.test.ts` (around line 472):

```ts
	it('does not cue a teach pass that had a mistake — the same taught batch comes back, not a blind test', async () => {
		vi.useFakeTimers();
		renderAttempt(AUTO_PLAY_ATTEMPT, 'hang');
		await vi.advanceTimersByTimeAsync(1000);

		for (let i = 0; i < 3; i++) {
			playMove('b1', 'c3'); // Nc3, not the book's Nf3
			await vi.advanceTimersByTimeAsync(500);
		}
		// Three wrong guesses on one move is what unlocks the hint prompt — proof
		// the mistakes above actually registered as mistakes.
		expect(screen.getAllByText('Need a hint?').length).toBe(2);

		playMove('g1', 'f3');
		await vi.advanceTimersByTimeAsync(500);

		// The pass still finished (it just wasn't clean), so this is a real
		// "completed without a cue", not a move that never landed.
		expect(phaseNow()).toBe('advancing');
		expect(screen.queryByText(/now play it from memory/i)).toBeNull();
	});
```

Replace with (drops the now-stale hint-count assertion; the hint is visible from the start regardless of mistakes after this task):

```ts
	it('does not cue a teach pass that had a mistake — the same taught batch comes back, not a blind test', async () => {
		vi.useFakeTimers();
		renderAttempt(AUTO_PLAY_ATTEMPT, 'hang');
		await vi.advanceTimersByTimeAsync(1000);

		for (let i = 0; i < 3; i++) {
			playMove('b1', 'c3'); // Nc3, not the book's Nf3
			await vi.advanceTimersByTimeAsync(500);
		}

		playMove('g1', 'f3');
		await vi.advanceTimersByTimeAsync(500);

		// The pass still finished (it just wasn't clean), so this is a real
		// "completed without a cue", not a move that never landed.
		expect(phaseNow()).toBe('advancing');
		expect(screen.queryByText(/now play it from memory/i)).toBeNull();
	});
```

- [ ] **Step 2: Write the new failing test for the hint decision**

Add right after the test above, before `it('renders without crashing with the engine toggle in its default (off) state', ...)`:

```ts
	it('offers a hint immediately, and taking it prevents the pass from counting as solved', async () => {
		vi.useFakeTimers();
		renderAttempt({ ...AUTO_PLAY_ATTEMPT, arrowPlies: null, isFinalPass: true });
		await vi.advanceTimersByTimeAsync(1000); // autoplay intro finishes

		// Visible with zero wrong attempts — no three-strikes wait.
		const hintButtons = screen.getAllByText('Need a hint?');
		expect(hintButtons.length).toBe(2);

		await fireEvent.click(hintButtons[0]);

		playMove('g1', 'f3'); // the correct move — but the hint already marked this pass dirty
		await vi.advanceTimersByTimeAsync(500);

		// A dirty final pass must not bump solved (optimisticSolvedAfterAttempt(hadMistake=true)).
		expect(screen.getAllByText('0 / 1 variations solved').length).toBe(2);
	});
```

- [ ] **Step 3: Run both to verify they fail**

```bash
npx vitest run src/routes/\(player\)/practice/\[repertoire_id\]/practice.test.ts -t "hint"
```

Expected: the new test FAILs (hint still gated behind three wrong attempts, so `hintButtons.length` is 0 at this point).

- [ ] **Step 4: Remove `wrongCount`, add `attemptMistakeCount` / `lastMoveResult` / `solvedThisSession`**

Find the state declarations (around line 28):

```svelte
	let locked = $state(false);
	// Consecutive wrong attempts on the CURRENT quiz move — resets the moment
	// it's solved or a new attempt starts. After 3, a hint becomes available;
	// requesting it highlights the correct piece's square, never the move.
	let wrongCount = $state(0);
	let hintRequested = $state(false);
```

Replace with:

```svelte
	let locked = $state(false);
	// Requesting a hint highlights the correct piece's square, never the
	// move itself — available every turn (see requestHint()), and marks the
	// whole attempt dirty so a hinted pass can't solve the variation.
	let hintRequested = $state(false);
```

Find the block right after it (around line 34):

```svelte
	// Whether THIS ATTEMPT (the whole variation replay) has had any mistake
	// yet — a clean full replay is what marks a variation solved. Reset only
	// in resetForAttempt().
	let attemptHadMistake = $state(false);
```

Add three new declarations right after it:

```svelte
	// Whether THIS ATTEMPT (the whole variation replay) has had any mistake
	// yet — a clean full replay is what marks a variation solved. Reset only
	// in resetForAttempt().
	let attemptHadMistake = $state(false);
	// Wrong attempts on the current attempt, shown as the sidebar's
	// "mistakes this attempt" chip — reset alongside attemptHadMistake.
	let attemptMistakeCount = $state(0);
	// The status strip's take on the last move played: holds 'correct' only
	// for the same brief window the board itself holds correct-move
	// feedback (cleared in the advanceTimeout callback below), holds 'wrong'
	// until overwritten by the player's next attempt. Reset in
	// resetForAttempt() like the rest of per-attempt state.
	let lastMoveResult = $state<'correct' | 'wrong' | null>(null);
	// How many variations have been solved cleanly since this page loaded —
	// deliberately NOT reset in resetForAttempt(): a running session total,
	// not per-attempt state.
	let solvedThisSession = $state(0);
```

- [ ] **Step 5: Update `resetForAttempt()`**

Find (around line 193):

```js
	function resetForAttempt() {
		++resetToken;
		clearTimeout(advanceTimeout);
		clearTimeout(autoPlayTimeout);
		quizIdx = 0;
		manualReviewIdx = null;
		phase = 'playing';
		locked = false;
		wrongCount = 0;
		hintRequested = false;
		attemptHadMistake = false;
		quizSteps = attempt?.path ?? [];
```

Replace with:

```js
	function resetForAttempt() {
		++resetToken;
		clearTimeout(advanceTimeout);
		clearTimeout(autoPlayTimeout);
		quizIdx = 0;
		manualReviewIdx = null;
		phase = 'playing';
		locked = false;
		hintRequested = false;
		attemptHadMistake = false;
		attemptMistakeCount = 0;
		lastMoveResult = null;
		quizSteps = attempt?.path ?? [];
```

- [ ] **Step 6: Add `requestHint()`, right before `handleMove`**

Find (around line 253):

```js
	function handleMove(detail: { from: Key; to: Key; san: string }) {
```

Insert immediately before it:

```js
	function requestHint() {
		hintRequested = true;
		// A taken hint marks this pass dirty, same as a wrong move — it can
		// still be played out, but it can no longer solve the variation.
		attemptHadMistake = true;
	}

	function handleMove(detail: { from: Key; to: Key; san: string }) {
```

- [ ] **Step 7: Update `handleMove`'s correct branch**

Find (around line 258):

```js
		if (detail.san === step.san) {
			playCorrect();
			locked = true;
			wrongCount = 0;
			hintRequested = false;
			logMove(step.moveId, detail.san, true);
```

Replace with:

```js
		if (detail.san === step.san) {
			playCorrect();
			locked = true;
			lastMoveResult = 'correct';
			hintRequested = false;
			logMove(step.moveId, detail.san, true);
```

- [ ] **Step 8: Update the optimistic-solved-bump block to also count the session**

Find (around line 283):

```js
				if (attempt.isFinalPass) {
					data = { ...data, solved: optimisticSolvedAfterAttempt(data, attemptHadMistake) };
				}
```

Replace with:

```js
				if (attempt.isFinalPass) {
					data = { ...data, solved: optimisticSolvedAfterAttempt(data, attemptHadMistake) };
					if (!attemptHadMistake) solvedThisSession++;
				}
```

- [ ] **Step 9: Clear `lastMoveResult` when the correct-move hold ends**

Find the `advanceTimeout` callback (around line 295):

```js
			advanceTimeout = setTimeout(() => {
				boardFen = step.toFen;
				quizIdx++;
				advanceThroughOpponentReplies();
				locked = false;
				if (quizIdx >= quizSteps.length) {
```

Replace with:

```js
			advanceTimeout = setTimeout(() => {
				boardFen = step.toFen;
				quizIdx++;
				advanceThroughOpponentReplies();
				locked = false;
				lastMoveResult = null;
				if (quizIdx >= quizSteps.length) {
```

- [ ] **Step 10: Update `handleMove`'s wrong branch**

Find (around line 317):

```js
		playWrong();
		wrongCount++;
		attemptHadMistake = true;
		logMove(step.moveId, detail.san, false);
```

Replace with:

```js
		playWrong();
		lastMoveResult = 'wrong';
		attemptHadMistake = true;
		attemptMistakeCount++;
		logMove(step.moveId, detail.san, false);
```

- [ ] **Step 11: Remove the three-strikes gate from both existing hint buttons**

Find the mobile hint button (around line 456):

```svelte
				{#if wrongCount >= 3 && !hintRequested && phase === 'playing'}
					<p class="text-center mb-4 lg:hidden">
						<button
							onclick={() => (hintRequested = true)}
							class="inline-flex items-center gap-1 text-sm font-medium text-amber-600 dark:text-amber-400 hover:text-amber-700"
						>
							<span class="text-base">💡</span> Need a hint?
						</button>
					</p>
				{/if}
```

Replace with:

```svelte
				{#if !hintRequested && phase === 'playing'}
					<p class="text-center mb-4 lg:hidden">
						<button
							onclick={requestHint}
							class="inline-flex items-center gap-1 text-sm font-medium text-amber-600 dark:text-amber-400 hover:text-amber-700"
						>
							<span class="text-base">💡</span> Need a hint?
						</button>
					</p>
				{/if}
```

Find the desktop sidebar hint button (around line 558):

```svelte
				{#if wrongCount >= 3 && !hintRequested && phase === 'playing'}
					<p class="text-center p-4">
						<button
							onclick={() => (hintRequested = true)}
							class="inline-flex items-center gap-1.5 text-sm font-medium text-amber-600 dark:text-amber-400 hover:text-amber-700"
						>
							<span class="text-base">💡</span> Need a hint?
						</button>
					</p>
				{/if}
```

Replace with:

```svelte
				{#if !hintRequested && phase === 'playing'}
					<p class="text-center p-4">
						<button
							onclick={requestHint}
							class="inline-flex items-center gap-1.5 text-sm font-medium text-amber-600 dark:text-amber-400 hover:text-amber-700"
						>
							<span class="text-base">💡</span> Need a hint?
						</button>
					</p>
				{/if}
```

- [ ] **Step 12: Run the tests to verify everything passes**

```bash
npx vitest run src/routes/\(player\)/practice/\[repertoire_id\]/practice.test.ts
npm run check
```

Expected: both clean.

- [ ] **Step 13: Commit**

```bash
git add src/routes/\(player\)/practice/\[repertoire_id\]/+page.svelte src/routes/\(player\)/practice/\[repertoire_id\]/practice.test.ts
git commit -m "feat(practice): hint is always available and marks the pass dirty"
```

---

### Task 6: Status strip component

**Files:**
- Create: `mychess/src/lib/components/PracticeStatusStrip.svelte`
- Create: `mychess/src/lib/components/PracticeStatusStrip.test.ts`
- Modify: `mychess/src/routes/(player)/practice/[repertoire_id]/+page.svelte`

Implements goal (1) (the standing status strip) and goal (8) (visible correct/wrong feedback, not sound-only). Depends on Task 5's `lastMoveResult`/`phase`/`teachCue`/`arrowMove` all being available.

- [ ] **Step 1: Write the failing component test**

Create `mychess/src/lib/components/PracticeStatusStrip.test.ts`:

```ts
// @vitest-environment jsdom
// mychess/src/lib/components/PracticeStatusStrip.test.ts
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import PracticeStatusStrip from './PracticeStatusStrip.svelte';

describe('PracticeStatusStrip', () => {
	it('renders an empty status region when silent (a teaching arrow is up)', () => {
		render(PracticeStatusStrip, { props: { state: 'silent' } });
		expect(screen.getByRole('status').textContent?.trim()).toBe('');
	});

	it('shows the wrong-move message', () => {
		render(PracticeStatusStrip, { props: { state: 'wrong' } });
		expect(screen.getByText(/Not that move/i)).toBeTruthy();
	});

	it('shows the correct-move message', () => {
		render(PracticeStatusStrip, { props: { state: 'correct' } });
		expect(screen.getByText('✓ Correct')).toBeTruthy();
	});

	it('shows the blind-retest prompt', () => {
		render(PracticeStatusStrip, { props: { state: 'blind' } });
		expect(screen.getByText('Play it from memory')).toBeTruthy();
	});

	it('shows the autoplay-intro message', () => {
		render(PracticeStatusStrip, { props: { state: 'autoplay' } });
		expect(screen.getByText(/Replaying what you already know/i)).toBeTruthy();
	});

	it('shows the retest cue', () => {
		render(PracticeStatusStrip, { props: { state: 'retest-cue' } });
		expect(screen.getByText(/now play it from memory/i)).toBeTruthy();
	});
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run src/lib/components/PracticeStatusStrip.test.ts
```

Expected: FAIL with a module-not-found error — the component doesn't exist yet.

- [ ] **Step 3: Create the component**

Create `mychess/src/lib/components/PracticeStatusStrip.svelte`:

```svelte
<!-- mychess/src/lib/components/PracticeStatusStrip.svelte -->
<script module lang="ts">
	export type PracticeStripState = 'silent' | 'blind' | 'wrong' | 'correct' | 'autoplay' | 'retest-cue';
</script>

<script lang="ts">
	let { state }: { state: PracticeStripState } = $props();

	// Keyed over the FULL union (including 'silent') so `TONE[state]`/`COPY[state]`
	// type-check without narrowing — indexing with `Exclude<PracticeStripState,
	// 'silent'>` instead would make `svelte-check` reject `state` (whose type
	// still includes 'silent') as a key, since template expressions don't
	// narrow the way an `{#if}` block's own contents do.
	const COPY: Record<PracticeStripState, string> = {
		silent: '',
		blind: 'Play it from memory',
		wrong: '✗ Not that move — try again',
		correct: '✓ Correct',
		autoplay: 'Replaying what you already know…',
		'retest-cue': '🧠 Nice — now play it from memory'
	};

	const TONE: Record<PracticeStripState, string> = {
		silent: 'border-transparent bg-transparent',
		blind: 'border-(--color-border) bg-(--color-surface) text-(--color-muted)',
		wrong: 'border-[#F28B82]/40 bg-[#F28B82]/10 text-[#F28B82]',
		correct: 'border-[#6FCF73]/40 bg-[#6FCF73]/10 text-[#6FCF73]',
		autoplay: 'border-(--color-border) bg-(--color-surface) text-(--color-muted)',
		'retest-cue':
			'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300'
	};
</script>

<p
	role="status"
	class="mb-3 shrink-0 min-h-[2.75rem] flex items-center justify-center rounded-2xl border p-3 text-center text-sm font-semibold shadow-sm {TONE[state]}"
>
	{COPY[state]}
</p>
```

- [ ] **Step 4: Run the component test to verify it passes**

```bash
npx vitest run src/lib/components/PracticeStatusStrip.test.ts
```

Expected: PASS, all six cases.

- [ ] **Step 5: Wire it into the practice page**

Add the import at the top of `+page.svelte`'s `<script>` block, alongside the other component imports (around line 12):

```svelte
	import EngineEval from '$lib/components/EngineEval.svelte';
	import PracticeStatusStrip, { type PracticeStripState } from '$lib/components/PracticeStatusStrip.svelte';
```

Add the derived state, right after the `arrowMove` derivation (around line 171, after its closing `});`):

```js
	// Priority: a teaching arrow is self-explanatory (silent) > the
	// between-passes cue > the last move's own result > the autoplay intro
	// > the default blind-retest prompt.
	const stripState = $derived.by((): PracticeStripState => {
		if (arrowMove) return 'silent';
		if (teachCue) return 'retest-cue';
		if (lastMoveResult === 'wrong') return 'wrong';
		if (lastMoveResult === 'correct') return 'correct';
		if (phase === 'autoplay') return 'autoplay';
		return 'blind';
	});
```

Find the old teach-cue-only paragraph (around line 447):

```svelte
					{#if teachCue}
						<p
							role="status"
							class="mb-3 shrink-0 rounded-2xl border border-amber-300 bg-amber-50 p-3 text-center text-sm font-semibold text-amber-800 shadow-sm dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300"
						>
							<span aria-hidden="true">🧠</span> Nice — now play it from memory
						</p>
					{/if}
```

Replace with:

```svelte
					<PracticeStatusStrip state={stripState} />
```

- [ ] **Step 6: Run the full practice test suite**

```bash
npx vitest run src/routes/\(player\)/practice/\[repertoire_id\]/practice.test.ts
```

Expected: PASS, including the pre-existing `/now play it from memory/i` assertions (the strip's `retest-cue` copy is character-for-character the same string).

- [ ] **Step 7: `npm run check`**

```bash
npm run check
```

Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add src/lib/components/PracticeStatusStrip.svelte src/lib/components/PracticeStatusStrip.test.ts src/routes/\(player\)/practice/\[repertoire_id\]/+page.svelte
git commit -m "feat(practice): add a standing status strip above the board"
```

---

### Task 7: Sidebar cards — this-line mistakes, session counter, relocated help, token cleanup

**Files:**
- Modify: `mychess/src/routes/(player)/practice/[repertoire_id]/+page.svelte`
- Modify: `mychess/src/routes/(player)/practice/[repertoire_id]/practice.test.ts`

Implements goal (4) (five sidebar cards), goal (11) (session counter + Finish session), and the remaining goal (9) token cleanup (progress bar track, Switch button hover). Depends on Task 5's `attemptMistakeCount`/`solvedThisSession`/`requestHint`.

- [ ] **Step 1: Write the failing tests**

Add to `practice.test.ts`, right after the hint test added in Task 5:

```ts
	it('shows a running session count and a Finish session link in the sidebar', () => {
		render(Practice, {
			props: {
				data: {
					repertoire: { id: 'r1', name: 'French Defense', color: 'white' },
					solved: 0,
					total: 1,
					allSolved: false,
					attempt: {
						variationKey: 'v1',
						path: [
							{
								moveId: 'm1',
								san: 'e4',
								fromFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
								toFen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
								isPlayerTurn: true
							}
						]
					}
				}
			}
		});
		expect(screen.getByText('0 solved this session')).toBeTruthy();
		expect(screen.getByRole('link', { name: 'Finish session' })).toBeTruthy();
	});

	it('shows a mistakes-this-attempt chip in the sidebar after a wrong move', async () => {
		vi.useFakeTimers();
		render(Practice, {
			props: {
				data: {
					repertoire: { id: 'r1', name: 'French Defense', color: 'white' },
					solved: 0,
					total: 1,
					allSolved: false,
					attempt: AUTO_PLAY_ATTEMPT
				}
			}
		});
		await vi.advanceTimersByTimeAsync(1000); // autoplay intro finishes

		expect(screen.queryByText(/mistake/i)).toBeNull();

		playMove('b1', 'c3'); // wrong: the book move is Nf3
		await vi.advanceTimersByTimeAsync(500);

		expect(screen.getByText('1 mistake this attempt')).toBeTruthy();
	});
```

- [ ] **Step 2: Run them to verify they fail**

```bash
npx vitest run src/routes/\(player\)/practice/\[repertoire_id\]/practice.test.ts -t "session"
npx vitest run src/routes/\(player\)/practice/\[repertoire_id\]/practice.test.ts -t "mistakes-this-attempt"
```

Expected: both FAIL — neither the Session card nor the mistakes chip exist yet.

- [ ] **Step 3: Replace the sidebar's card contents**

Find the full sidebar contents, from the first `<div class="p-4">` through the closing `{/if}` of the hint block (this reflects the file's state after Tasks 2 and 5 — the name line is already gone from the first card and the hint condition/handler are already updated):

```svelte
				<div class="p-4">
					<div class="flex items-center justify-between gap-2">
						<span class="text-(--color-muted) text-sm">{data.solved} / {data.total} variations solved</span>
						<button
							onclick={() => (pickerOpen = true)}
							class="shrink-0 inline-flex items-center gap-1 text-xs font-semibold text-(--color-accent) border border-(--color-border) rounded-lg px-2 py-1 hover:bg-gray-50 dark:hover:bg-gray-800"
						>
							<span aria-hidden="true">📖</span> Switch
						</button>
					</div>
					<div class="h-1.5 rounded-full bg-gray-200 overflow-hidden mt-2">
						<div
							class="h-full bg-(--color-accent) rounded-full"
							style={`width: ${data.total ? (data.solved / data.total) * 100 : 0}%`}
						></div>
					</div>
				</div>

				<div class="p-4">
					<EngineEval fen={displayFen} />
				</div>

				<div class="p-4 lg:flex-1 lg:min-h-0 lg:overflow-y-auto">
					<p class="text-xs font-semibold uppercase tracking-wide text-(--color-muted) mb-2">Moves played</p>
					<p class="text-sm text-(--color-muted)">{movesSoFar || '—'}</p>
				</div>

				{#if !hintRequested && phase === 'playing'}
					<p class="text-center p-4">
						<button
							onclick={requestHint}
							class="inline-flex items-center gap-1.5 text-sm font-medium text-amber-600 dark:text-amber-400 hover:text-amber-700"
						>
							<span class="text-base">💡</span> Need a hint?
						</button>
					</p>
				{/if}
```

Replace with:

```svelte
				<div class="p-4">
					<p class="text-xs font-semibold uppercase tracking-wide text-(--color-muted) mb-2">Progress</p>
					<div class="flex items-center justify-between gap-2">
						<span class="text-(--color-muted) text-sm">{data.solved} / {data.total} variations solved</span>
						<button
							onclick={() => (pickerOpen = true)}
							class="shrink-0 inline-flex items-center gap-1 text-xs font-semibold text-(--color-accent) border border-(--color-border) rounded-lg px-2 py-1 hover:bg-(--color-border)/40"
						>
							<span aria-hidden="true">📖</span> Switch
						</button>
					</div>
					<div class="h-1.5 rounded-full bg-(--color-border) overflow-hidden mt-2">
						<div
							class="h-full bg-(--color-accent) rounded-full"
							style={`width: ${data.total ? (data.solved / data.total) * 100 : 0}%`}
						></div>
					</div>
				</div>

				<div class="p-4">
					<p class="text-xs font-semibold uppercase tracking-wide text-(--color-muted) mb-2">This line</p>
					<p class="text-sm text-(--color-muted)">{movesSoFar || '—'}</p>
					{#if attemptMistakeCount > 0}
						<p class="text-xs font-medium text-[#F28B82] mt-1">
							{attemptMistakeCount} mistake{attemptMistakeCount === 1 ? '' : 's'} this attempt
						</p>
					{/if}
				</div>

				<div class="p-4">
					<EngineEval fen={displayFen} />
				</div>

				<div class="p-4">
					<p class="text-xs font-semibold uppercase tracking-wide text-(--color-muted) mb-2">Stuck?</p>
					{#if hintRequested}
						<p class="text-sm text-(--color-muted)">Hint used for this attempt.</p>
					{:else if phase === 'playing'}
						<button
							onclick={requestHint}
							class="inline-flex items-center gap-1.5 text-sm font-medium text-amber-600 dark:text-amber-400 hover:text-amber-700"
						>
							<span class="text-base">💡</span> Need a hint?
						</button>
					{/if}
					<p class="text-xs text-(--color-muted) mt-2">
						← → step through moves you've played · ↑ jump to start · ↓ jump to live position
					</p>
				</div>

				<div class="p-4">
					<p class="text-xs font-semibold uppercase tracking-wide text-(--color-muted) mb-2">Session</p>
					<p class="text-sm text-(--color-text) font-medium mb-2">{solvedThisSession} solved this session</p>
					<a
						href="/practice"
						class="inline-flex items-center gap-1 text-sm font-semibold text-(--color-muted) border border-(--color-border) rounded-lg px-3 py-1.5 hover:bg-(--color-border)/40"
					>
						Finish session
					</a>
				</div>
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run src/routes/\(player\)/practice/\[repertoire_id\]/practice.test.ts
```

Expected: PASS, including the two new tests and every pre-existing one (the "Moves played" heading text is gone — no test asserted on it — and "Need a hint?"/progress-count assertions are unaffected since that text is unchanged).

- [ ] **Step 5: `npm run check`**

```bash
npm run check
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/routes/\(player\)/practice/\[repertoire_id\]/+page.svelte src/routes/\(player\)/practice/\[repertoire_id\]/practice.test.ts
git commit -m "feat(practice): sidebar gains this-line mistakes, help, and session cards"
```

---

### Task 8: Final verification, cleanup grep, and follow-up

**Files:** none (verification + repo housekeeping only)

- [ ] **Step 1: Grep for any remaining hardcoded `gray-*` classes**

```bash
grep -n "gray-" src/routes/\(player\)/practice/\[repertoire_id\]/+page.svelte src/lib/components/EngineEval.svelte
```

Expected: no output. If anything remains, replace it with the appropriate `--color-*` token (matching the patterns used throughout Tasks 1–7) before continuing.

- [ ] **Step 2: Run the full test suite and type-check**

```bash
npm test
npm run check
npm run lint
```

Expected: all clean. This is the acceptance criterion from issue #92 ("`npm test` and `npm run check` both clean before push").

- [ ] **Step 3: Manual verification pass**

Run the dev server and walk through a real repertoire on a real desktop viewport, confirming:
- No gap between board and nav row at both a wide and a narrow-but-tall window (Task 1).
- Status strip shows the right copy for a wrong move, a correct move, the autoplay intro, and the retest cue, with no layout shift (Task 6).
- Hint button appears immediately (no three-strikes wait) and taking it prevents that pass from counting as solved (Task 5).
- Dark and light theme both render the progress bar and engine bar tracks visibly, including at 0% progress (Tasks 4, 7).
- "Finish session" navigates back to `/practice` (Task 7).

```bash
npm run dev
```

- [ ] **Step 4: Push**

```bash
git push origin main
```

- [ ] **Step 5: File the deferred variation-picker-rail follow-up issue**

```bash
gh issue create --repo tomyka/mychess --label size/small --title "Convert practice's variation picker from a modal to a permanent left rail" --body "$(cat <<'EOF'
## Problem

Issue #92's practice-screen UX overhaul deliberately kept \`VariationPicker\` as a modal rather than converting it to a permanent left rail, even though both lichess surfaces studied during that epic's research (\`/practice\` and \`/training\`) use a permanent rail listing every exercise/line in the set, with a checkmark on completed ones and an arrow on the current one. See \`docs/superpowers/specs/2026-08-20-practice-ux-overhaul-design.md\` for the full research and reasoning — this was deferred as a bigger structural change than the rest of that epic, not dropped.

## Proposed Solution

Convert \`src/routes/(player)/practice/[repertoire_id]/+page.svelte\` to a three-column layout: a permanent left rail (replacing the \`VariationPicker\` modal) listing the repertoire's variations/chapters with progress indicators, the board in the center, and the existing sidebar on the right.

## Acceptance Criteria

- [ ] Variation/chapter list renders as a permanent left rail on desktop, not a modal
- [ ] Rail shows a completed indicator per variation/chapter and highlights the currently active one
- [ ] Mobile keeps the existing modal-picker behavior (no viewport width for a third column)
- [ ] \`npm test\` and \`npm run check\` both clean before push

## Non-Goals

- Changing anything about the practice UX shipped in #92 itself
EOF
)"
```

- [ ] **Step 6: Close issue #92**

```bash
gh issue close 92 --repo tomyka/mychess --comment "Shipped: layout/gap/width fix, standing status strip, always-available hint that marks a pass dirty, labeled engine panel with a White/Black legend, five-card sidebar (progress/this-line/engine/help/session), readable nav-row icons with a ply indicator, and the gray-* token cleanup. The one deferred item — converting the variation picker from a modal to a permanent left rail — is filed as its own follow-up issue per the spec's decision to keep this epic's scope to two columns."
```

---

## Self-Review Notes

- **Spec coverage:** goals (1)–(12) each map to a task above (1→6, 2→1, 3→1, 4→7, 5→5+7, 6→3, 7→4, 8→6, 9→1/2/3/4/7/8-grep, 10→2, 11→7, 12→no code change, needed only for the `npm test`/`npm run check` gate → 8).
- **Placeholder scan:** every step shows the actual before/after code; no "add appropriate styling" or "similar to Task N" shortcuts.
- **Type consistency:** `PracticeStripState` (Task 6) matches the six-way union used in Task 6's `stripState` derivation; `requestHint`/`attemptMistakeCount`/`lastMoveResult`/`solvedThisSession` (all introduced in Task 5) are used with the same names in Tasks 6 and 7 with no renaming drift.
