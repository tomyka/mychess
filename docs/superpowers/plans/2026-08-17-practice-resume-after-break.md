# Practice Resume-After-Break Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After a 10+ minute gap since a variation's last practice attempt, serve exactly one attempt as if nothing were mastered yet (no auto-play, teaching restarted from the beginning), without altering the player's real stored progress.

**Architecture:** Fix a currently-dead `variation_teaching_progress.updated_at` column by adding a small, unconditional "touch" write (`touchVariationAttempt`) that fires on every attempt regardless of outcome, kept deliberately separate from `applyAttemptResult`'s documented "a mistake is a true no-op" invariant. `buildPracticeView()` — the pure function both the page load and the attempt endpoint already call — reads that timestamp and, given a testable `now`, forces one served attempt's effective progress to zero when the gap exceeds the threshold.

**Task order note:** Task 1 (server: widen `loadTeachingProgress`'s return type, add `touchVariationAttempt`) intentionally comes *before* Task 2 (pure: `buildPracticeView` starts requiring that wider type). Widening a Map's value type that callers pass around is backward-compatible (an extra field on a variable's type is fine wherever a narrower type is expected); the reverse order would leave `+page.server.ts` and the attempt endpoint failing `npm run check` between the two commits, since `buildPracticeView` would demand a field `loadTeachingProgress` doesn't produce yet. Doing it in this order keeps every single commit in this plan at zero type errors, per this repo's "npm run check must report zero errors before pushing" rule.

**Tech Stack:** SvelteKit 2 / Svelte 5, TypeScript, Supabase (Postgres), Vitest.

**Spec:** `docs/superpowers/specs/2026-08-17-practice-resume-after-break-design.md`
**Issue:** tomyka/mychess#77

---

## Task 1: Persist and load the recency timestamp

**Files:**
- Modify: `mychess/src/lib/server/practice-progress.ts`
- Test: `mychess/src/lib/server/practice-progress.test.ts`

- [ ] **Step 1: Write the failing test**

Change the import line at the top of `mychess/src/lib/server/practice-progress.test.ts` from:

```ts
import { applyAttemptResult } from './practice-progress';
```

to:

```ts
import { applyAttemptResult, touchVariationAttempt } from './practice-progress';
```

Add this new `describe` block at the end of the file, as a sibling of the existing `describe('applyAttemptResult', ...)` block (after its closing `});`):

```ts
describe('touchVariationAttempt', () => {
	it('upserts only updated_at, leaving taught_plies/mastered_plies out of the payload', async () => {
		const { client, upsertCalls } = fakeSupabase();
		await touchVariationAttempt(client as any, 'player-1', 'rep-1', 'v1');
		expect(upsertCalls).toHaveLength(1);
		expect(upsertCalls[0].table).toBe('variation_teaching_progress');
		expect(upsertCalls[0].options).toEqual({ onConflict: 'player_id,variation_key_hash' });
		// No taught_plies/mastered_plies in the payload: PostgREST's upsert only
		// updates columns actually present in the row on conflict, so omitting
		// them here is what keeps an existing row's real progress untouched.
		expect(upsertCalls[0].rows).toEqual({
			player_id: 'player-1',
			repertoire_id: 'rep-1',
			variation_key: 'v1',
			updated_at: expect.any(String)
		});
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `mychess/`): `npx vitest run src/lib/server/practice-progress.test.ts`
Expected: FAIL — `touchVariationAttempt` is not exported from `./practice-progress`

- [ ] **Step 3: Add `touchVariationAttempt` and extend `loadTeachingProgress`**

In `mychess/src/lib/server/practice-progress.ts`, change `loadTeachingProgress` from:

```ts
export async function loadTeachingProgress(
	supabase: SupabaseClient,
	playerId: string,
	repertoireId: string
): Promise<Map<string, { taughtPlies: number; masteredPlies: number }>> {
	const rows = await fetchAllPages<{ variation_key: string; taught_plies: number; mastered_plies: number }>(
		() =>
			supabase
				.from('variation_teaching_progress')
				.select('variation_key, taught_plies, mastered_plies')
				.eq('player_id', playerId)
				.eq('repertoire_id', repertoireId)
				.order('variation_key', { ascending: true }),
		() =>
			supabase
				.from('variation_teaching_progress')
				.select('id', { count: 'exact', head: true })
				.eq('player_id', playerId)
				.eq('repertoire_id', repertoireId),
		MAX_ROWS_PAGE_SIZE
	);
	return new Map(rows.map((r) => [r.variation_key, { taughtPlies: r.taught_plies, masteredPlies: r.mastered_plies }]));
}
```

to:

```ts
export async function loadTeachingProgress(
	supabase: SupabaseClient,
	playerId: string,
	repertoireId: string
): Promise<Map<string, { taughtPlies: number; masteredPlies: number; updatedAt: string | null }>> {
	const rows = await fetchAllPages<{
		variation_key: string;
		taught_plies: number;
		mastered_plies: number;
		updated_at: string | null;
	}>(
		() =>
			supabase
				.from('variation_teaching_progress')
				.select('variation_key, taught_plies, mastered_plies, updated_at')
				.eq('player_id', playerId)
				.eq('repertoire_id', repertoireId)
				.order('variation_key', { ascending: true }),
		() =>
			supabase
				.from('variation_teaching_progress')
				.select('id', { count: 'exact', head: true })
				.eq('player_id', playerId)
				.eq('repertoire_id', repertoireId),
		MAX_ROWS_PAGE_SIZE
	);
	return new Map(
		rows.map((r) => [r.variation_key, { taughtPlies: r.taught_plies, masteredPlies: r.mastered_plies, updatedAt: r.updated_at }])
	);
}
```

Add this new function right after `saveTeachingProgress` (before the `loadSyncedActiveVariationKey` doc comment):

```ts
/**
 * Records that the player just attempted this variation, regardless of
 * outcome — the only unconditional write in the attempt-completion flow
 * (unlike `applyAttemptResult`, which is a true no-op on a mistake). Only
 * `updated_at` is included in the upsert payload, so an existing row's real
 * `taught_plies`/`mastered_plies` are left exactly as they were; a variation
 * with no row yet gets one created with the table's own 0/0 defaults, which
 * every reader of this table already treats as equivalent to "no row exists".
 * Powers `buildPracticeView`'s resumed-after-a-break check in
 * `mastery/practice.ts`.
 */
export async function touchVariationAttempt(
	supabase: SupabaseClient,
	playerId: string,
	repertoireId: string,
	variationKey: string
): Promise<void> {
	await supabase
		.from('variation_teaching_progress')
		.upsert(
			{ player_id: playerId, repertoire_id: repertoireId, variation_key: variationKey, updated_at: new Date().toISOString() },
			{ onConflict: 'player_id,variation_key_hash' }
		);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/server/practice-progress.test.ts`
Expected: PASS (all existing tests + 1 new one)

- [ ] **Step 5: Type-check**

Run: `npm run check`
Expected: 0 errors. `+page.server.ts` and `/api/practice/attempt/+server.ts` both still call
`buildPracticeView` with its current (unchanged-until-Task-2) 4-argument signature, and now receive a
`Map` whose values carry one extra `updatedAt` field — an excess property on a variable is fine
wherever a narrower object type is expected, so both call sites keep compiling with zero changes.

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/practice-progress.ts src/lib/server/practice-progress.test.ts
git commit -m "feat: track per-variation last-attempted-at timestamp"
git push
```

---

## Task 2: `buildPracticeView` — detect and suppress a resumed-after-break attempt

**Files:**
- Modify: `mychess/src/lib/mastery/practice.ts`
- Test: `mychess/src/lib/mastery/practice.test.ts`

- [ ] **Step 1: Write the failing tests**

Add these three tests inside the existing `describe('buildPracticeView', ...)` block in
`mychess/src/lib/mastery/practice.test.ts`, right before its closing `});` (after the last existing
test, `'does not auto-play anything for an already-solved variation\'s own re-drill'`):

```ts
	it('keeps normal auto-play when the variation was attempted recently', () => {
		const v = makeVariation(15, 'a-'); // 30 plies
		const now = new Date('2026-08-17T12:00:00Z');
		const progress = new Map([
			[v.variationKey, { taughtPlies: 20, masteredPlies: 10, updatedAt: '2026-08-17T11:55:00Z' }] // 5 min ago
		]);
		const view = buildPracticeView([v], v.variationKey, new Set(), progress, false, now);
		expect(view.attempt!.autoPlayThrough).toBe(10);
	});

	it('resets to no auto-play and restarts teaching from the beginning after a 10+ minute gap', () => {
		const v = makeVariation(15, 'a-'); // 30 plies
		const now = new Date('2026-08-17T12:00:00Z');
		const progress = new Map([
			[v.variationKey, { taughtPlies: 20, masteredPlies: 10, updatedAt: '2026-08-17T11:49:00Z' }] // 11 min ago
		]);
		const view = buildPracticeView([v], v.variationKey, new Set(), progress, false, now);
		expect(view.attempt!.autoPlayThrough).toBe(0);
		// Teaching restarts from ply 0 too, not just auto-play — same truncated
		// batch/arrow a genuinely fresh variation gets (see the existing
		// 'serves a truncated path and arrow range...' test above for the same
		// 15-player-move fixture with zero progress).
		expect(view.attempt!.path).toHaveLength(9);
		expect(view.attempt!.arrowPlies).toEqual({ from: 0, to: 9 });
	});

	it('does not treat a never-attempted variation (no updatedAt yet) as a resume-after-break', () => {
		const v = makeVariation(15, 'a-');
		const now = new Date('2026-08-17T12:00:00Z');
		const progress = new Map([[v.variationKey, { taughtPlies: 0, masteredPlies: 0, updatedAt: null }]]);
		const view = buildPracticeView([v], v.variationKey, new Set(), progress, false, now);
		expect(view.attempt!.autoPlayThrough).toBe(0);
		expect(view.attempt!.path).toHaveLength(9);
	});
```

No import changes needed — `RESUME_GAP_MS`/`wasResumedAfterBreak` are exercised indirectly through
`buildPracticeView`, matching how this file already tests other internal logic (e.g.
`sharedMasteredPrefixLength`) only through `buildPracticeView`, not by importing it directly.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/mastery/practice.test.ts`
Expected: FAIL — `buildPracticeView` doesn't yet accept a 6th `now` argument or look at `updatedAt`,
so the "10+ minute gap" test's `autoPlayThrough` comes back `10` instead of the expected `0`.

- [ ] **Step 3: Update `buildPracticeView`'s type and add the pure gap-check helper**

In `mychess/src/lib/mastery/practice.ts`, change the `teachingProgress` parameter type in the
function signature from:

```ts
	teachingProgress: ReadonlyMap<string, { taughtPlies: number; masteredPlies: number }>,
```

to:

```ts
	teachingProgress: ReadonlyMap<string, { taughtPlies: number; masteredPlies: number; updatedAt: string | null }>,
```

Add this new constant and pure helper right after the `PracticeView` type definition and before the
`buildPracticeView` function's doc comment:

```ts
/** How long since a variation's last attempt counts as "the player took a break" from it. */
export const RESUME_GAP_MS = 10 * 60 * 1000;

/**
 * True if more than `RESUME_GAP_MS` has passed since `updatedAt`. A variation
 * with no `updatedAt` yet (never attempted) is never "resumed" — there's
 * nothing to resume from, and its progress is already zero.
 */
export function wasResumedAfterBreak(updatedAt: string | null, now: Date): boolean {
	if (updatedAt == null) return false;
	return now.getTime() - new Date(updatedAt).getTime() > RESUME_GAP_MS;
}
```

Change the function signature from:

```ts
export function buildPracticeView(
	variations: Variation[],
	activeVariationKey: string | null,
	solvedKeys: ReadonlySet<string>,
	teachingProgress: ReadonlyMap<string, { taughtPlies: number; masteredPlies: number; updatedAt: string | null }>,
	forceAttempt: boolean = false
): PracticeView {
```

to:

```ts
export function buildPracticeView(
	variations: Variation[],
	activeVariationKey: string | null,
	solvedKeys: ReadonlySet<string>,
	teachingProgress: ReadonlyMap<string, { taughtPlies: number; masteredPlies: number; updatedAt: string | null }>,
	forceAttempt: boolean = false,
	now: Date = new Date()
): PracticeView {
```

Inside the not-yet-solved branch (the `else` after `if (solvedKeys.has(active.variationKey))`), change:

```ts
			const progress = teachingProgress.get(active.variationKey) ?? { taughtPlies: 0, masteredPlies: 0 };
			// A sibling variation sharing this one's leading moves (the same
			// moveIds — a transposition, or just the same opening) may have
			// already mastered them: credit that shared prefix here rather
			// than making the player re-earn it from scratch for every
			// variation that happens to share it.
			const masteredMoveIds = computeMasteredMoveIds(variations, teachingProgress, solvedKeys);
			const sharedFloor = sharedMasteredPrefixLength(active.path, masteredMoveIds);
			const effectiveMasteredPlies = Math.max(progress.masteredPlies, sharedFloor);
			const effectiveTaughtPlies = Math.max(progress.taughtPlies, effectiveMasteredPlies);
			const step = resolveTeachingStep(active.path, effectiveTaughtPlies, effectiveMasteredPlies);
```

to:

```ts
			const progress = teachingProgress.get(active.variationKey) ?? { taughtPlies: 0, masteredPlies: 0, updatedAt: null };
			// A sibling variation sharing this one's leading moves (the same
			// moveIds — a transposition, or just the same opening) may have
			// already mastered them: credit that shared prefix here rather
			// than making the player re-earn it from scratch for every
			// variation that happens to share it.
			const masteredMoveIds = computeMasteredMoveIds(variations, teachingProgress, solvedKeys);
			const sharedFloor = sharedMasteredPrefixLength(active.path, masteredMoveIds);
			const rawMasteredPlies = Math.max(progress.masteredPlies, sharedFloor);
			const rawTaughtPlies = Math.max(progress.taughtPlies, rawMasteredPlies);
			// A break of 10+ minutes since this specific variation's last
			// attempt serves this one attempt as if nothing were mastered yet —
			// the player's own memory of "mastered" moves fades too. Nothing is
			// written back; the real stored counters are untouched, so the next
			// attempt (once touchVariationAttempt in practice-progress.ts
			// refreshes updatedAt) goes back to normal.
			const resumedAfterBreak = wasResumedAfterBreak(progress.updatedAt, now);
			const effectiveMasteredPlies = resumedAfterBreak ? 0 : rawMasteredPlies;
			const effectiveTaughtPlies = resumedAfterBreak ? 0 : rawTaughtPlies;
			const step = resolveTeachingStep(active.path, effectiveTaughtPlies, effectiveMasteredPlies);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/mastery/practice.test.ts`
Expected: PASS (all existing tests + 3 new ones)

- [ ] **Step 5: Type-check**

Run: `npm run check`
Expected: 0 errors. `loadTeachingProgress`'s return type (from Task 1) already includes `updatedAt`,
so both `+page.server.ts` and the attempt endpoint's calls to `buildPracticeView` are already
structurally compatible with the new, stricter parameter type — no changes needed at either call site.

- [ ] **Step 6: Commit**

```bash
git add src/lib/mastery/practice.ts src/lib/mastery/practice.test.ts
git commit -m "feat: suppress practice auto-play after a 10+ minute break"
git push
```

---

## Task 3: Wire the touch into the attempt endpoint

**Files:**
- Modify: `mychess/src/routes/api/practice/attempt/+server.ts`

No new test file — per this codebase's convention, this endpoint (Supabase I/O orchestration) has no
dedicated test file today and is exercised through the pure-logic tests in Tasks 1–2 plus manual
verification, not unit-tested directly.

- [ ] **Step 1: Add the import and the unconditional touch call**

In `mychess/src/routes/api/practice/attempt/+server.ts`, change:

```ts
import { applyAttemptResult, loadActiveVariationKey, loadSolvedKeys, loadTeachingProgress } from '$lib/server/practice-progress';
```

to:

```ts
import {
	applyAttemptResult,
	loadActiveVariationKey,
	loadSolvedKeys,
	loadTeachingProgress,
	touchVariationAttempt
} from '$lib/server/practice-progress';
```

Change the doc comment above the `POST` handler from:

```ts
/**
 * Called once per completed Practice attempt (the whole variation replayed,
 * not per move). Reports whether the attempt was clean — a clean attempt
 * marks the variation solved and advances the active variation; a mistaken
 * one is a no-op (the same variation is naturally re-served next).
 */
```

to:

```ts
/**
 * Called once per completed Practice attempt (the whole variation replayed,
 * not per move). Reports whether the attempt was clean — a clean attempt
 * marks the variation solved and advances the active variation; a mistaken
 * one leaves progress untouched (the same variation is naturally re-served
 * next). `touchVariationAttempt` is the one exception to that mistake-is-a-
 * no-op rule: it always records that this variation was just attempted,
 * regardless of outcome, purely to detect a later resume-after-a-break (see
 * `buildPracticeView` in `$lib/mastery/practice.ts`) — it never affects
 * teaching progress or which variation is active.
 */
```

Change:

```ts
	const { variations } = await loadFilteredRepertoireVariations(supabase, user.id, repertoireId);
	const today = new Date().toISOString().slice(0, 10);
	await Promise.all([
		applyAttemptResult(supabase, user.id, repertoireId, variationKey, hadMistake, variations),
		incrementQuestProgress(supabase, user.id, 'review_cards', today)
	]);
```

to:

```ts
	const { variations } = await loadFilteredRepertoireVariations(supabase, user.id, repertoireId);
	const today = new Date().toISOString().slice(0, 10);
	await Promise.all([
		applyAttemptResult(supabase, user.id, repertoireId, variationKey, hadMistake, variations),
		touchVariationAttempt(supabase, user.id, repertoireId, variationKey),
		incrementQuestProgress(supabase, user.id, 'review_cards', today)
	]);
```

- [ ] **Step 2: Type-check and run the full test suite**

Run: `npm run check` — expected: 0 errors
Run: `npm test` — expected: all existing tests still pass (this file has no dedicated tests, but the
change must not break anything importing from it)

- [ ] **Step 3: Commit**

```bash
git add "src/routes/api/practice/attempt/+server.ts"
git commit -m "feat: record practice attempt recency for resume-after-break detection"
git push
```

---

## Task 4: Fix the write-path mirror gap (found by final holistic review)

**Files:**
- Modify: `mychess/src/lib/server/practice-progress.ts`
- Modify: `mychess/src/routes/api/practice/attempt/+server.ts`
- Test: `mychess/src/lib/server/practice-progress.test.ts`

**Why this task exists:** Tasks 1–3 correctly changed what gets *served* (`buildPracticeView` zeroes
the effective floor for a resumed-after-break attempt) but never touched what gets *recorded*
(`applyAttemptResult`). A clean completion of that served, zeroed attempt was still being recorded
against the raw, un-reset stored counters — `applyAttemptResult`'s own doc comment already warns
this exact mirror must stay in sync with `buildPracticeView`'s, and this feature broke it. In the
feature's own primary target scenario (existing progress + a break + a clean follow-up attempt),
this could advance progress far past what was actually replayed, or even permanently mark a
variation solved off a truncated teach batch. Fixed by threading the same `resumedAfterBreak` signal
into `applyAttemptResult`, computed from a read taken *before* `touchVariationAttempt`'s write lands.

- [ ] **Step 1: Write the failing test**

Add this test inside the existing `describe('applyAttemptResult', ...)` block in
`mychess/src/lib/server/practice-progress.test.ts`, right after the test
`'a clean non-final blind retest advances mastered_plies only, and does not touch variation_solved'`:

```ts
	it('records a resumed-after-break attempt against a zeroed floor, not the raw stored counters', async () => {
		const { client, upsertCalls } = fakeSupabase({
			teachingRows: [{ variation_key: 'v1', taught_plies: 20, mastered_plies: 10 }]
		});
		const v1 = makeVariation('v1', 25);
		await applyAttemptResult(client as any, 'player-1', 'rep-1', 'v1', false, [v1], true);
		expect(upsertCalls).toEqual([
			{
				table: 'variation_teaching_progress',
				// Same shape as a genuinely fresh variation's first teach pass —
				// the raw 20/10 stored counters are ignored entirely because this
				// attempt was served reset to 0, so it must be recorded as if it
				// started from 0 too.
				rows: { player_id: 'player-1', repertoire_id: 'rep-1', variation_key: 'v1', taught_plies: 9, mastered_plies: 0 },
				options: { onConflict: 'player_id,variation_key_hash' }
			}
		]);
	});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `mychess/`): `npx vitest run src/lib/server/practice-progress.test.ts`
Expected: FAIL — `applyAttemptResult` doesn't yet accept a 7th argument, and even if TypeScript lets
the extra argument through at runtime (JS ignores excess call arguments), the recorded
`taught_plies`/`mastered_plies` will be `25`/`25` (computed from the raw 20/10 floor, since this is
also this variation's own final batch) instead of the expected `9`/`0`.

- [ ] **Step 3: Thread `resumedAfterBreak` into `applyAttemptResult`**

In `mychess/src/lib/server/practice-progress.ts`, change the doc comment above `applyAttemptResult`
from:

```ts
/**
 * Applies a completed attempt's outcome. A mistaken attempt is always a
 * no-op (no reads, no writes) — the active variation and its teaching
 * progress both stay exactly as they were, so the next attempt naturally
 * re-serves the same step for another try.
 *
 * On a clean attempt: if the variation isn't already solved, its teaching
 * progress advances (see `advanceTeachingProgress`) — starting from whichever
 * is higher, its OWN stored counters or the shared-mastery floor a sibling
 * variation may have already earned for the same leading moves (see
 * `computeMasteredMoveIds` — this MUST mirror `buildPracticeView`'s own
 * floor computation exactly, or the server would record progress against a
 * different step than the one it actually served) — UNLESS that was the
 * variation's final batch, in which case (exactly like an already-solved
 * variation re-drilled via the picker) it falls through to the existing
 * solved/advance-active-variation sequence.
 */
```

to:

```ts
/**
 * Applies a completed attempt's outcome. A mistaken attempt is always a
 * no-op (no reads, no writes) — the active variation and its teaching
 * progress both stay exactly as they were, so the next attempt naturally
 * re-serves the same step for another try.
 *
 * On a clean attempt: if the variation isn't already solved, its teaching
 * progress advances (see `advanceTeachingProgress`) — starting from whichever
 * is higher, its OWN stored counters or the shared-mastery floor a sibling
 * variation may have already earned for the same leading moves (see
 * `computeMasteredMoveIds` — this MUST mirror `buildPracticeView`'s own
 * floor computation exactly, or the server would record progress against a
 * different step than the one it actually served). `resumedAfterBreak`
 * mirrors that same requirement for `buildPracticeView`'s resumed-after-a-break
 * reset (see `wasResumedAfterBreak` in `mastery/practice.ts`): when true, the
 * floor used here is zeroed exactly like the served attempt was, so a clean
 * run of a break-reset teach batch advances progress by only what was
 * actually replayed in it — never against the raw, un-reset stored counters,
 * which could otherwise jump progress ahead or even wrongly mark the
 * variation solved off a truncated replay. UNLESS that was the variation's
 * final batch, in which case (exactly like an already-solved variation
 * re-drilled via the picker) it falls through to the existing
 * solved/advance-active-variation sequence.
 */
```

Change the function signature and body from:

```ts
export async function applyAttemptResult(
	supabase: SupabaseClient,
	playerId: string,
	repertoireId: string,
	variationKey: string,
	hadMistake: boolean,
	variations: Variation[]
): Promise<void> {
	if (hadMistake) return;

	const variation = variations.find((v) => v.variationKey === variationKey);
	if (variation) {
		const solvedKeys = await loadSolvedKeys(supabase, playerId, repertoireId);
		if (!solvedKeys.has(variationKey)) {
			const progressMap = await loadTeachingProgress(supabase, playerId, repertoireId);
			const current = progressMap.get(variationKey) ?? { taughtPlies: 0, masteredPlies: 0 };
			const masteredMoveIds = computeMasteredMoveIds(variations, progressMap, solvedKeys);
			const sharedFloor = sharedMasteredPrefixLength(variation.path, masteredMoveIds);
			const effectiveMasteredPlies = Math.max(current.masteredPlies, sharedFloor);
			const effectiveTaughtPlies = Math.max(current.taughtPlies, effectiveMasteredPlies);
			const next = advanceTeachingProgress(variation.path, effectiveTaughtPlies, effectiveMasteredPlies, false);
			await saveTeachingProgress(supabase, playerId, repertoireId, variationKey, next.taughtPlies, next.masteredPlies);
			if (!next.solved) return;
		}
	}

	await markVariationSolved(supabase, playerId, repertoireId, variationKey);
	const solvedKeys = await loadSolvedKeys(supabase, playerId, repertoireId);
	const next = advanceIfSolved(variationKey, variations, solvedKeys);
	await setActiveVariationKey(supabase, playerId, repertoireId, next);
}
```

to:

```ts
export async function applyAttemptResult(
	supabase: SupabaseClient,
	playerId: string,
	repertoireId: string,
	variationKey: string,
	hadMistake: boolean,
	variations: Variation[],
	resumedAfterBreak: boolean = false
): Promise<void> {
	if (hadMistake) return;

	const variation = variations.find((v) => v.variationKey === variationKey);
	if (variation) {
		const solvedKeys = await loadSolvedKeys(supabase, playerId, repertoireId);
		if (!solvedKeys.has(variationKey)) {
			const progressMap = await loadTeachingProgress(supabase, playerId, repertoireId);
			const current = progressMap.get(variationKey) ?? { taughtPlies: 0, masteredPlies: 0, updatedAt: null };
			const masteredMoveIds = computeMasteredMoveIds(variations, progressMap, solvedKeys);
			const sharedFloor = sharedMasteredPrefixLength(variation.path, masteredMoveIds);
			const rawMasteredPlies = Math.max(current.masteredPlies, sharedFloor);
			const rawTaughtPlies = Math.max(current.taughtPlies, rawMasteredPlies);
			const effectiveMasteredPlies = resumedAfterBreak ? 0 : rawMasteredPlies;
			const effectiveTaughtPlies = resumedAfterBreak ? 0 : rawTaughtPlies;
			const next = advanceTeachingProgress(variation.path, effectiveTaughtPlies, effectiveMasteredPlies, false);
			await saveTeachingProgress(supabase, playerId, repertoireId, variationKey, next.taughtPlies, next.masteredPlies);
			if (!next.solved) return;
		}
	}

	await markVariationSolved(supabase, playerId, repertoireId, variationKey);
	const solvedKeys = await loadSolvedKeys(supabase, playerId, repertoireId);
	const next = advanceIfSolved(variationKey, variations, solvedKeys);
	await setActiveVariationKey(supabase, playerId, repertoireId, next);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/server/practice-progress.test.ts`
Expected: PASS (all existing tests + 1 new one). Every pre-existing test calls `applyAttemptResult`
with exactly 6 positional arguments, so the new 7th parameter's `= false` default preserves their
behavior unchanged.

- [ ] **Step 5: Wire the pre-write read into the attempt endpoint**

In `mychess/src/routes/api/practice/attempt/+server.ts`, change the import from:

```ts
import {
	applyAttemptResult,
	loadActiveVariationKey,
	loadSolvedKeys,
	loadTeachingProgress,
	touchVariationAttempt
} from '$lib/server/practice-progress';
import { incrementQuestProgress } from '$lib/server/quests';
import { requireApiUser } from '$lib/server/auth';
import { buildPracticeView } from '$lib/mastery/practice';
```

to:

```ts
import {
	applyAttemptResult,
	loadActiveVariationKey,
	loadSolvedKeys,
	loadTeachingProgress,
	touchVariationAttempt
} from '$lib/server/practice-progress';
import { incrementQuestProgress } from '$lib/server/quests';
import { requireApiUser } from '$lib/server/auth';
import { buildPracticeView, wasResumedAfterBreak } from '$lib/mastery/practice';
```

Change:

```ts
	const { variations } = await loadFilteredRepertoireVariations(supabase, user.id, repertoireId);
	const today = new Date().toISOString().slice(0, 10);
	await Promise.all([
		applyAttemptResult(supabase, user.id, repertoireId, variationKey, hadMistake, variations),
		touchVariationAttempt(supabase, user.id, repertoireId, variationKey),
		incrementQuestProgress(supabase, user.id, 'review_cards', today)
	]);
```

to:

```ts
	const { variations } = await loadFilteredRepertoireVariations(supabase, user.id, repertoireId);
	const today = new Date().toISOString().slice(0, 10);

	// Read BEFORE touchVariationAttempt's write below lands — reading this
	// after that unconditional refresh would always see a fresh updated_at
	// and never detect a real gap. Must mirror buildPracticeView's own
	// resumed-after-break check exactly, or a clean completion of a served
	// reset attempt would be recorded against the raw (un-reset) stored
	// counters instead of what was actually replayed (see applyAttemptResult's
	// doc comment in practice-progress.ts).
	const progressBeforeThisAttempt = await loadTeachingProgress(supabase, user.id, repertoireId);
	const resumedAfterBreak = wasResumedAfterBreak(progressBeforeThisAttempt.get(variationKey)?.updatedAt ?? null, new Date());

	await Promise.all([
		applyAttemptResult(supabase, user.id, repertoireId, variationKey, hadMistake, variations, resumedAfterBreak),
		touchVariationAttempt(supabase, user.id, repertoireId, variationKey),
		incrementQuestProgress(supabase, user.id, 'review_cards', today)
	]);
```

- [ ] **Step 6: Type-check and run the full test suite**

Run: `npm run check` — expected: 0 errors
Run: `npm test` — expected: all existing tests still pass, plus the 1 new test

- [ ] **Step 7: Commit**

```bash
git add src/lib/server/practice-progress.ts src/lib/server/practice-progress.test.ts "src/routes/api/practice/attempt/+server.ts"
git commit -m "fix: record resumed-after-break attempts against a zeroed floor"
git push
```

---

## Task 4b: Extract shared floor logic + avoid a full-repertoire read on the hot path (found by Task 4's code review)

**Files:**
- Modify: `mychess/src/lib/mastery/teaching.ts`
- Modify: `mychess/src/lib/mastery/teaching.test.ts`
- Modify: `mychess/src/lib/mastery/practice.ts`
- Modify: `mychess/src/lib/server/practice-progress.ts`
- Modify: `mychess/src/lib/server/practice-progress.test.ts`
- Modify: `mychess/src/routes/api/practice/attempt/+server.ts`

**Why this task exists:** Task 4's code review flagged two real, non-blocking issues in its own fix:
(1) `buildPracticeView` and `applyAttemptResult` now each independently implement "compute raw floor,
then zero if resumed" — the exact class of duplication that caused Task 4's bug in the first place,
now duplicated a second time; (2) the endpoint's pre-write gap check calls `loadTeachingProgress`
(a full paginated per-repertoire fetch) just to read one variation's `updated_at`, on a hot path
(every attempt completion) — and does it sequentially before an independent read
(`loadFilteredRepertoireVariations`) that could run alongside it. This task extracts the shared floor
computation into one function in `mastery/teaching.ts` and replaces the full-repertoire read with a
single targeted row read, run in parallel with the independent `variations` load.

- [ ] **Step 1: Write the failing test for the extracted helper**

Add `effectiveProgress` to the import list at the top of `mychess/src/lib/mastery/teaching.test.ts`:

```ts
import {
	resolveTeachingStep,
	advanceTeachingProgress,
	arrowMoveForStep,
	sharedMasteredPrefixLength,
	computeMasteredMoveIds,
	isLastPlayerMove,
	effectiveProgress
} from './teaching';
```

Add this new `describe` block at the end of the file:

```ts
describe('effectiveProgress', () => {
	it('takes the higher of the own counters or the shared floor', () => {
		expect(effectiveProgress(5, 3, 8, false)).toEqual({ taughtPlies: 8, masteredPlies: 8 });
		expect(effectiveProgress(10, 6, 2, false)).toEqual({ taughtPlies: 10, masteredPlies: 6 });
	});

	it('zeroes both counters entirely when resumedAfterBreak is true, ignoring the shared floor too', () => {
		expect(effectiveProgress(20, 10, 15, true)).toEqual({ taughtPlies: 0, masteredPlies: 0 });
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `mychess/`): `npx vitest run src/lib/mastery/teaching.test.ts`
Expected: FAIL — `effectiveProgress` is not exported from `./teaching`

- [ ] **Step 3: Add `effectiveProgress` to `teaching.ts`**

Add this function to `mychess/src/lib/mastery/teaching.ts`, right after `sharedMasteredPrefixLength`:

```ts
/**
 * The floor of taught/mastered plies to actually use for a served or
 * recorded attempt — the higher of the variation's own stored counters or a
 * shared sibling's credited prefix (`sharedFloor`, from
 * `sharedMasteredPrefixLength`), or zeroed entirely if the player is
 * resuming this variation after a break. Shared by `buildPracticeView`
 * (serve time, `mastery/practice.ts`) and `applyAttemptResult` (record time,
 * `server/practice-progress.ts`) so what gets served always matches what
 * gets recorded — the two computations silently drifting apart is exactly
 * what caused a real bug (see the "resumed after break" feature's Task 4
 * fix), so this exists specifically to make that impossible going forward
 * rather than trusting two copies to stay in sync by convention.
 */
export function effectiveProgress(
	ownTaughtPlies: number,
	ownMasteredPlies: number,
	sharedFloor: number,
	resumedAfterBreak: boolean
): { taughtPlies: number; masteredPlies: number } {
	if (resumedAfterBreak) return { taughtPlies: 0, masteredPlies: 0 };
	const masteredPlies = Math.max(ownMasteredPlies, sharedFloor);
	const taughtPlies = Math.max(ownTaughtPlies, masteredPlies);
	return { taughtPlies, masteredPlies };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/mastery/teaching.test.ts`
Expected: PASS (all existing tests + 2 new ones)

- [ ] **Step 5: Use `effectiveProgress` in `buildPracticeView`**

In `mychess/src/lib/mastery/practice.ts`, change the import from:

```ts
import { resolveTeachingStep, computeMasteredMoveIds, sharedMasteredPrefixLength } from './teaching';
```

to:

```ts
import { resolveTeachingStep, computeMasteredMoveIds, sharedMasteredPrefixLength, effectiveProgress } from './teaching';
```

Change the not-yet-solved branch's body from:

```ts
				const progress = teachingProgress.get(active.variationKey) ?? { taughtPlies: 0, masteredPlies: 0, updatedAt: null };
				// A sibling variation sharing this one's leading moves (the same
				// moveIds — a transposition, or just the same opening) may have
				// already mastered them: credit that shared prefix here rather
				// than making the player re-earn it from scratch for every
				// variation that happens to share it.
				const masteredMoveIds = computeMasteredMoveIds(variations, teachingProgress, solvedKeys);
				const sharedFloor = sharedMasteredPrefixLength(active.path, masteredMoveIds);
				const rawMasteredPlies = Math.max(progress.masteredPlies, sharedFloor);
				const rawTaughtPlies = Math.max(progress.taughtPlies, rawMasteredPlies);
				// A break of 10+ minutes since this specific variation's last
				// attempt serves this one attempt as if nothing were mastered yet —
				// the player's own memory of "mastered" moves fades too. Nothing is
				// written back; the real stored counters are untouched, so the next
				// attempt (once touchVariationAttempt in practice-progress.ts
				// refreshes updatedAt) goes back to normal. This zeroes rawMasteredPlies
				// wholesale, including any sharedFloor credit from a sibling variation
				// practiced moments ago — deliberately conservative (a per-variation
				// break check, not a per-move-id one): worst case a few already-known
				// moves get manually replayed once, rather than risking auto-play
				// through content THIS variation's own break should have reset.
				const resumedAfterBreak = wasResumedAfterBreak(progress.updatedAt, now);
				const effectiveMasteredPlies = resumedAfterBreak ? 0 : rawMasteredPlies;
				const effectiveTaughtPlies = resumedAfterBreak ? 0 : rawTaughtPlies;
				const step = resolveTeachingStep(active.path, effectiveTaughtPlies, effectiveMasteredPlies);
```

to:

```ts
				const progress = teachingProgress.get(active.variationKey) ?? { taughtPlies: 0, masteredPlies: 0, updatedAt: null };
				// A sibling variation sharing this one's leading moves (the same
				// moveIds — a transposition, or just the same opening) may have
				// already mastered them: credit that shared prefix here rather
				// than making the player re-earn it from scratch for every
				// variation that happens to share it.
				const masteredMoveIds = computeMasteredMoveIds(variations, teachingProgress, solvedKeys);
				const sharedFloor = sharedMasteredPrefixLength(active.path, masteredMoveIds);
				// A break of 10+ minutes since this specific variation's last
				// attempt serves this one attempt as if nothing were mastered yet —
				// the player's own memory of "mastered" moves fades too. Nothing is
				// written back; the real stored counters are untouched, so the next
				// attempt (once touchVariationAttempt in practice-progress.ts
				// refreshes updatedAt) goes back to normal. effectiveProgress zeroes
				// the whole floor, including any sharedFloor credit from a sibling
				// variation practiced moments ago — deliberately conservative (a
				// per-variation break check, not a per-move-id one): worst case a
				// few already-known moves get manually replayed once, rather than
				// risking auto-play through content THIS variation's own break
				// should have reset. Shared with `applyAttemptResult` (which MUST
				// mirror this exactly, or the server records progress against a
				// different step than the one it actually served — see its own
				// doc comment) so both sides can never drift apart again.
				const resumedAfterBreak = wasResumedAfterBreak(progress.updatedAt, now);
				const { taughtPlies: effectiveTaughtPlies, masteredPlies: effectiveMasteredPlies } = effectiveProgress(
					progress.taughtPlies,
					progress.masteredPlies,
					sharedFloor,
					resumedAfterBreak
				);
				const step = resolveTeachingStep(active.path, effectiveTaughtPlies, effectiveMasteredPlies);
```

- [ ] **Step 6: Run tests to verify nothing broke**

Run: `npx vitest run src/lib/mastery/practice.test.ts`
Expected: PASS — every existing `buildPracticeView` test still passes unchanged, since this is a pure
refactor (identical inputs produce identical outputs), not a behavior change.

- [ ] **Step 7: Use `effectiveProgress` in `applyAttemptResult`, and add `loadVariationUpdatedAt`**

In `mychess/src/lib/server/practice-progress.ts`, change the import from:

```ts
import { advanceTeachingProgress, computeMasteredMoveIds, sharedMasteredPrefixLength } from '$lib/mastery/teaching';
```

to:

```ts
import { advanceTeachingProgress, computeMasteredMoveIds, sharedMasteredPrefixLength, effectiveProgress } from '$lib/mastery/teaching';
```

Change `applyAttemptResult`'s body from:

```ts
			const progressMap = await loadTeachingProgress(supabase, playerId, repertoireId);
			const current = progressMap.get(variationKey) ?? { taughtPlies: 0, masteredPlies: 0, updatedAt: null };
			const masteredMoveIds = computeMasteredMoveIds(variations, progressMap, solvedKeys);
			const sharedFloor = sharedMasteredPrefixLength(variation.path, masteredMoveIds);
			const rawMasteredPlies = Math.max(current.masteredPlies, sharedFloor);
			const rawTaughtPlies = Math.max(current.taughtPlies, rawMasteredPlies);
			const effectiveMasteredPlies = resumedAfterBreak ? 0 : rawMasteredPlies;
			const effectiveTaughtPlies = resumedAfterBreak ? 0 : rawTaughtPlies;
			const next = advanceTeachingProgress(variation.path, effectiveTaughtPlies, effectiveMasteredPlies, false);
```

to:

```ts
			const progressMap = await loadTeachingProgress(supabase, playerId, repertoireId);
			const current = progressMap.get(variationKey) ?? { taughtPlies: 0, masteredPlies: 0, updatedAt: null };
			const masteredMoveIds = computeMasteredMoveIds(variations, progressMap, solvedKeys);
			const sharedFloor = sharedMasteredPrefixLength(variation.path, masteredMoveIds);
			const { taughtPlies: effectiveTaughtPlies, masteredPlies: effectiveMasteredPlies } = effectiveProgress(
				current.taughtPlies,
				current.masteredPlies,
				sharedFloor,
				resumedAfterBreak
			);
			const next = advanceTeachingProgress(variation.path, effectiveTaughtPlies, effectiveMasteredPlies, false);
```

Add this new function right after `loadActiveVariationKey`:

```ts
/**
 * This variation's currently-persisted `updated_at`, or `null` if no row
 * exists yet. A single targeted row read — unlike `loadTeachingProgress`,
 * which loads the WHOLE repertoire's progress — for callers (like the
 * attempt-completion endpoint) that only need one variation's recency to
 * decide `wasResumedAfterBreak`, without paying a full paginated fetch on a
 * per-attempt hot path.
 */
export async function loadVariationUpdatedAt(
	supabase: SupabaseClient,
	playerId: string,
	repertoireId: string,
	variationKey: string
): Promise<string | null> {
	const { data } = await supabase
		.from('variation_teaching_progress')
		.select('updated_at')
		.eq('player_id', playerId)
		.eq('repertoire_id', repertoireId)
		.eq('variation_key', variationKey)
		.maybeSingle();
	return data?.updated_at ?? null;
}
```

- [ ] **Step 8: Write the failing test for `loadVariationUpdatedAt`**

Add this test inside a new `describe('loadVariationUpdatedAt', ...)` block in
`mychess/src/lib/server/practice-progress.test.ts`, appended after the `describe('applyAttemptResult', ...)`
block's closing `});` (import `loadVariationUpdatedAt` alongside the file's existing imports from
`./practice-progress`):

```ts
describe('loadVariationUpdatedAt', () => {
	it('returns the row\'s updated_at, or null if no matching row exists', async () => {
		const { client } = fakeSupabase({
			teachingRows: [{ variation_key: 'v1', taught_plies: 5, mastered_plies: 3, updated_at: '2026-08-17T11:00:00Z' } as any]
		});
		expect(await loadVariationUpdatedAt(client as any, 'player-1', 'rep-1', 'v1')).toBe('2026-08-17T11:00:00Z');
		expect(await loadVariationUpdatedAt(client as any, 'player-1', 'rep-1', 'v2')).toBeNull();
	});
});
```

This requires the shared `fakeSupabase` harness's `variation_teaching_progress` branch to also
support a single-row `.eq(...).eq(...).eq(...).maybeSingle()` read (it currently only supports the
paginated `.select().eq().eq().order().range()` chain used by `loadTeachingProgress`, and `.upsert()`).
Update the harness in the same file: change

```ts
		if (table === 'variation_teaching_progress') {
			return {
				select: () => pagedRead(() => teachingRows),
				upsert: (rows: any, options: any) => {
					upsertCalls.push({ table, rows, options });
					return Promise.resolve({ error: null });
				}
			};
		}
```

to:

```ts
		if (table === 'variation_teaching_progress') {
			return {
				select: (columns: string) => {
					if (columns === 'updated_at') {
						// Single-row lookup path used by loadVariationUpdatedAt: each
						// .eq() narrows a running filter; .maybeSingle() resolves it.
						let filters: Record<string, string> = {};
						const node: any = {
							eq: (col: string, value: string) => {
								filters = { ...filters, [col]: value };
								return node;
							},
							maybeSingle: () =>
								Promise.resolve({
									data: teachingRows.find((r: any) => r.variation_key === filters.variation_key) ?? null,
									error: null
								})
						};
						return node;
					}
					return pagedRead(() => teachingRows);
				},
				upsert: (rows: any, options: any) => {
					upsertCalls.push({ table, rows, options });
					return Promise.resolve({ error: null });
				}
			};
		}
```

- [ ] **Step 9: Run test to verify it fails, then implement, then verify it passes**

Run: `npx vitest run src/lib/server/practice-progress.test.ts`
Expected: FAIL first (`loadVariationUpdatedAt` not exported / harness doesn't support `.maybeSingle()`
on this table yet), then PASS once Steps 7-8 are both in place (all existing tests + 2 new: the
`effectiveProgress`-refactor regression coverage is already provided by the EXISTING `applyAttemptResult`
tests, which must all still pass unchanged since this is a behavior-preserving refactor).

- [ ] **Step 10: Wire `loadVariationUpdatedAt` into the endpoint, parallelized with the variations load**

In `mychess/src/routes/api/practice/attempt/+server.ts`, change the import from:

```ts
import {
	applyAttemptResult,
	loadActiveVariationKey,
	loadSolvedKeys,
	loadTeachingProgress,
	touchVariationAttempt
} from '$lib/server/practice-progress';
```

to:

```ts
import {
	applyAttemptResult,
	loadActiveVariationKey,
	loadSolvedKeys,
	loadTeachingProgress,
	loadVariationUpdatedAt,
	touchVariationAttempt
} from '$lib/server/practice-progress';
```

Change:

```ts
	const { variations } = await loadFilteredRepertoireVariations(supabase, user.id, repertoireId);
	const today = new Date().toISOString().slice(0, 10);

	// Read BEFORE touchVariationAttempt's write below lands — reading this
	// after that unconditional refresh would always see a fresh updated_at
	// and never detect a real gap. Must mirror buildPracticeView's own
	// resumed-after-break check exactly, or a clean completion of a served
	// reset attempt would be recorded against the raw (un-reset) stored
	// counters instead of what was actually replayed (see applyAttemptResult's
	// doc comment in practice-progress.ts).
	const progressBeforeThisAttempt = await loadTeachingProgress(supabase, user.id, repertoireId);
	const resumedAfterBreak = wasResumedAfterBreak(progressBeforeThisAttempt.get(variationKey)?.updatedAt ?? null, new Date());

	await Promise.all([
		applyAttemptResult(supabase, user.id, repertoireId, variationKey, hadMistake, variations, resumedAfterBreak),
		touchVariationAttempt(supabase, user.id, repertoireId, variationKey),
		incrementQuestProgress(supabase, user.id, 'review_cards', today)
	]);
```

to:

```ts
	// Read BEFORE touchVariationAttempt's write below lands — reading this
	// after that unconditional refresh would always see a fresh updated_at
	// and never detect a real gap. Must mirror buildPracticeView's own
	// resumed-after-break check exactly, or a clean completion of a served
	// reset attempt would be recorded against the raw (un-reset) stored
	// counters instead of what was actually replayed (see applyAttemptResult's
	// doc comment in practice-progress.ts). A single targeted row read
	// (`loadVariationUpdatedAt`), not the whole-repertoire `loadTeachingProgress`
	// — this fires on every attempt completion, so a full paginated fetch here
	// just to read one variation's timestamp would be real, avoidable cost on
	// a hot path for a large repertoire. Independent of `variations`, so it
	// runs alongside that load rather than after it.
	const [{ variations }, updatedAtBeforeThisAttempt] = await Promise.all([
		loadFilteredRepertoireVariations(supabase, user.id, repertoireId),
		loadVariationUpdatedAt(supabase, user.id, repertoireId, variationKey)
	]);
	const today = new Date().toISOString().slice(0, 10);
	const resumedAfterBreak = wasResumedAfterBreak(updatedAtBeforeThisAttempt, new Date());

	await Promise.all([
		applyAttemptResult(supabase, user.id, repertoireId, variationKey, hadMistake, variations, resumedAfterBreak),
		touchVariationAttempt(supabase, user.id, repertoireId, variationKey),
		incrementQuestProgress(supabase, user.id, 'review_cards', today)
	]);
```

- [ ] **Step 11: Type-check and run the full test suite**

Run: `npm run check` — expected: 0 errors
Run: `npm test` — expected: all existing tests still pass, plus the new `effectiveProgress` and
`loadVariationUpdatedAt` tests

- [ ] **Step 12: Commit**

```bash
git add src/lib/mastery/teaching.ts src/lib/mastery/teaching.test.ts src/lib/mastery/practice.ts \
        src/lib/server/practice-progress.ts src/lib/server/practice-progress.test.ts \
        "src/routes/api/practice/attempt/+server.ts"
git commit -m "refactor: share resumed-after-break floor logic, avoid a full-repertoire read"
git push
```

---

## Task 5: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run (from `mychess/`): `npm test`
Expected: all test files pass, no regressions

- [ ] **Step 2: Run the full type/Svelte check**

Run: `npm run check`
Expected: 0 errors

- [ ] **Step 3: Manual sanity check (optional but recommended)**

No database migration is needed for this feature (it reuses an existing column), so there's no
production gate to wait on before this can go live — unlike the FIDE Europe-rank feature. If you
want to manually confirm the behavior end-to-end before considering this done: practice a variation
with some progress already taught/mastered, wait 10+ minutes (or temporarily lower `RESUME_GAP_MS`
in a local branch to something like 5 seconds for a quick manual check, then revert), reload the
practice page, and confirm the served attempt has no auto-play and the teaching arrow starts at
ply 0. This step is optional and doesn't block calling the feature done.
