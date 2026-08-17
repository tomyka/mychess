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

## Task 4: Full verification

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
