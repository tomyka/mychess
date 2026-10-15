# Variation Teaching Arrows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Teach a variation's moves in 10-ply batches beyond its first 5 moves — a yellow arrow on first exposure to each new batch, then one clean blind replay of the whole variation-so-far before the next batch unlocks — while leaving the existing "one clean full replay marks it solved" mechanic untouched once the last batch is reached.

**Architecture:** Two integer counters per `(player, variation)` — `taught_plies`/`mastered_plies` — persisted in a new `variation_teaching_progress` table. A pure module (`src/lib/mastery/teaching.ts`) derives, from those two counters and the variation's own path length, exactly how much of the path to serve this attempt and which ply range (if any) gets an arrow — recomputed fresh every time, never cached as a stored "phase." `buildPracticeView` and `applyAttemptResult` are extended to read/write this state; `ChessBoard.svelte` gains a prop to render the arrow via chessground's native `orig`+`dest` shape.

**Tech Stack:** SvelteKit 2, Svelte 5 runes, Supabase (Postgres + RLS), chess.js, chessground, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-14-variation-teaching-arrows-design.md` — read it first for the full rationale; this plan implements it task-by-task.

---

### Task 1: Migration for `variation_teaching_progress`

**Files:**
- Create: `mychess/supabase/migrations/0046_variation_teaching_progress.sql`

- [ ] **Step 1: Write the migration**

```sql
-- mychess/supabase/migrations/0046_variation_teaching_progress.sql
-- Backs the "yellow arrow" teaching pass (see
-- docs/superpowers/specs/2026-08-14-variation-teaching-arrows-design.md):
-- two ply-depth counters per (player, variation) that a pure function
-- (resolveTeachingStep/advanceTeachingProgress in src/lib/mastery/teaching.ts)
-- turns into "how deep to serve this attempt, and which ply range (if any)
-- gets an arrow." No row for a variation means "nothing beyond the free
-- zone taught or mastered yet" — that module floors both counters up to
-- the free zone on every read, so a missing row needs no special-casing.
create table public.variation_teaching_progress (
  id             uuid primary key default gen_random_uuid(),
  player_id      uuid not null references public.profiles(id) on delete cascade,
  repertoire_id  uuid not null references public.repertoires(id) on delete cascade,
  variation_key  text not null,
  taught_plies   integer not null default 0,
  mastered_plies integer not null default 0,
  updated_at     timestamptz not null default now(),
  unique (player_id, variation_key)
);

create index variation_teaching_progress_player_repertoire_idx
  on public.variation_teaching_progress (player_id, repertoire_id);

alter table public.variation_teaching_progress enable row level security;

create policy "variation_teaching_progress_player_all" on public.variation_teaching_progress
  for all using (player_id = auth.uid());

create policy variation_teaching_progress_coach_read on public.variation_teaching_progress for select using (
  exists (
    select 1 from public.coach_players cp
    where cp.player_id = variation_teaching_progress.player_id
      and cp.coach_id = auth.uid()
      and cp.status = 'active'
  )
);

revoke all on public.variation_teaching_progress from anon, public;
```

- [ ] **Step 2: Commit**

```bash
git add mychess/supabase/migrations/0046_variation_teaching_progress.sql
git commit -m "feat: add variation_teaching_progress migration"
```

**Note for whoever runs this plan:** this migration is not applied automatically — per this project's convention, tell the user at the end of the plan that they need to run `mychess/supabase/migrations/0046_variation_teaching_progress.sql` manually in the Supabase dashboard's SQL editor before this feature works end-to-end. The app code in later tasks will not function against a database missing this table.

---

### Task 2: Pure teaching-logic module

**Files:**
- Create: `mychess/src/lib/mastery/teaching.ts`
- Test: `mychess/src/lib/mastery/teaching.test.ts`

This is the one new module the rest of the feature depends on — everything else in this plan just calls into it. It has no I/O and no Svelte/Supabase dependency, so it's tested in complete isolation first.

- [ ] **Step 1: Write the failing tests for `resolveTeachingStep`**

```ts
// mychess/src/lib/mastery/teaching.test.ts
import { describe, it, expect } from 'vitest';
import { resolveTeachingStep, advanceTeachingProgress, arrowMoveForStep } from './teaching';
import type { VariationStep } from './variations';

function makePath(plies: number): VariationStep[] {
	const path: VariationStep[] = [];
	for (let i = 0; i < plies; i++) {
		path.push({
			moveId: `p${i}`,
			san: `M${i}`,
			fromFen: `f${i}a`,
			toFen: `f${i}b`,
			isPlayerTurn: i % 2 === 0
		});
	}
	return path;
}

describe('resolveTeachingStep', () => {
	it('never teaches a variation no longer than the free zone (5 moves / 10 plies)', () => {
		const path = makePath(6);
		const step = resolveTeachingStep(path, 0, 0);
		expect(step).toEqual({ path, arrowPlies: null, isFinalPass: true });
	});

	it('teaches the first batch beyond the free zone for a fresh, deeper variation', () => {
		const path = makePath(25);
		const step = resolveTeachingStep(path, 0, 0);
		expect(step.path).toEqual(path.slice(0, 20));
		expect(step.arrowPlies).toEqual({ from: 10, to: 20 });
		expect(step.isFinalPass).toBe(false);
	});

	it('blind-retests up to the taught depth once a batch is taught but not yet mastered', () => {
		const path = makePath(25);
		const step = resolveTeachingStep(path, 20, 10);
		expect(step.path).toEqual(path.slice(0, 20));
		expect(step.arrowPlies).toBeNull();
		expect(step.isFinalPass).toBe(false);
	});

	it('reports the final batch\'s blind retest as the final pass', () => {
		const path = makePath(25);
		const step = resolveTeachingStep(path, 25, 20);
		expect(step.path).toEqual(path);
		expect(step.arrowPlies).toBeNull();
		expect(step.isFinalPass).toBe(true);
	});

	it('serves the full path with no arrow once every batch is mastered', () => {
		const path = makePath(25);
		const step = resolveTeachingStep(path, 25, 25);
		expect(step).toEqual({ path, arrowPlies: null, isFinalPass: true });
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd mychess && npx vitest run src/lib/mastery/teaching.test.ts`
Expected: FAIL — `Failed to resolve import "./teaching"` (the module doesn't exist yet).

- [ ] **Step 3: Implement `resolveTeachingStep`**

```ts
// mychess/src/lib/mastery/teaching.ts
import { Chess } from 'chess.js';
import { FIRST_MOVES_GROUP_PLIES, type VariationStep } from './variations';

export type TeachingStep = {
	path: VariationStep[];
	arrowPlies: { from: number; to: number } | null;
	isFinalPass: boolean;
};

/**
 * Derives what the NEXT attempt of this variation should look like, purely
 * from its two persisted counters — never from a stored "phase" — so a
 * corrupted or stale counter can't disagree with what's actually served. See
 * docs/superpowers/specs/2026-08-14-variation-teaching-arrows-design.md for
 * the full state-machine rationale.
 */
export function resolveTeachingStep(path: VariationStep[], taughtPlies: number, masteredPlies: number): TeachingStep {
	const freeZone = Math.min(FIRST_MOVES_GROUP_PLIES, path.length);
	const taught = Math.max(taughtPlies, freeZone);
	const mastered = Math.max(masteredPlies, freeZone);

	if (mastered >= path.length) {
		return { path, arrowPlies: null, isFinalPass: true };
	}
	if (taught === mastered) {
		const target = Math.min(mastered + FIRST_MOVES_GROUP_PLIES, path.length);
		return { path: path.slice(0, target), arrowPlies: { from: mastered, to: target }, isFinalPass: false };
	}
	return { path: path.slice(0, taught), arrowPlies: null, isFinalPass: taught >= path.length };
}
```

- [ ] **Step 4: Run tests to verify `resolveTeachingStep`'s tests pass**

Run: `cd mychess && npx vitest run src/lib/mastery/teaching.test.ts`
Expected: the 5 `resolveTeachingStep` tests PASS; `advanceTeachingProgress`/`arrowMoveForStep` tests fail to import (not written yet).

- [ ] **Step 5: Write the failing tests for `advanceTeachingProgress`**

Add to `mychess/src/lib/mastery/teaching.test.ts`:

```ts
describe('advanceTeachingProgress', () => {
	it('leaves both counters unchanged (floored to the free zone) on a mistake', () => {
		const path = makePath(25);
		const result = advanceTeachingProgress(path, 3, 3, true);
		expect(result).toEqual({ taughtPlies: 10, masteredPlies: 10, solved: false });
	});

	it('a clean teach pass advances taught_plies to the batch end only', () => {
		const path = makePath(25);
		const result = advanceTeachingProgress(path, 0, 0, false);
		expect(result).toEqual({ taughtPlies: 20, masteredPlies: 10, solved: false });
	});

	it('a clean non-final blind retest advances mastered_plies to match taught_plies', () => {
		const path = makePath(25);
		const result = advanceTeachingProgress(path, 20, 10, false);
		expect(result).toEqual({ taughtPlies: 20, masteredPlies: 20, solved: false });
	});

	it('a clean final blind retest reports solved', () => {
		const path = makePath(25);
		const result = advanceTeachingProgress(path, 25, 20, false);
		expect(result).toEqual({ taughtPlies: 25, masteredPlies: 25, solved: true });
	});

	it('a variation no longer than the free zone is solved on its very first clean attempt', () => {
		const path = makePath(6);
		const result = advanceTeachingProgress(path, 0, 0, false);
		expect(result).toEqual({ taughtPlies: 6, masteredPlies: 6, solved: true });
	});
});
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `cd mychess && npx vitest run src/lib/mastery/teaching.test.ts`
Expected: FAIL — `advanceTeachingProgress is not a function` (not exported yet).

- [ ] **Step 7: Implement `advanceTeachingProgress`**

Add to `mychess/src/lib/mastery/teaching.ts`:

```ts
/**
 * Applies a completed attempt's outcome to the two counters. Always
 * re-derives the step that was actually served (via `resolveTeachingStep`)
 * rather than trusting anything the client reports beyond `hadMistake` — the
 * same trust boundary `applyAttemptResult` already has today.
 */
export function advanceTeachingProgress(
	path: VariationStep[],
	taughtPlies: number,
	masteredPlies: number,
	hadMistake: boolean
): { taughtPlies: number; masteredPlies: number; solved: boolean } {
	const step = resolveTeachingStep(path, taughtPlies, masteredPlies);
	const freeZone = Math.min(FIRST_MOVES_GROUP_PLIES, path.length);
	const taught = Math.max(taughtPlies, freeZone);
	const mastered = Math.max(masteredPlies, freeZone);

	if (hadMistake) {
		return { taughtPlies: taught, masteredPlies: mastered, solved: false };
	}
	if (step.arrowPlies) {
		return { taughtPlies: step.arrowPlies.to, masteredPlies: mastered, solved: false };
	}
	return { taughtPlies: Math.max(taught, step.path.length), masteredPlies: step.path.length, solved: step.isFinalPass };
}
```

- [ ] **Step 8: Run tests to verify `advanceTeachingProgress`'s tests pass**

Run: `cd mychess && npx vitest run src/lib/mastery/teaching.test.ts`
Expected: all 10 tests so far PASS; `arrowMoveForStep` tests still fail to import.

- [ ] **Step 9: Write the failing tests for `arrowMoveForStep`**

Add to `mychess/src/lib/mastery/teaching.test.ts`:

```ts
describe('arrowMoveForStep', () => {
	const playedE4: VariationStep = {
		moveId: 'm1',
		san: 'e4',
		fromFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
		toFen: 'rnbqkbnr/pppppppp/8/8/8/PPPPPPPP/8/RNBQKBNR w KQkq - 0 1',
		isPlayerTurn: true
	};

	it('returns null when there is no arrow range', () => {
		expect(arrowMoveForStep(playedE4, 12, null)).toBeNull();
	});

	it('returns null when the ply index is outside the arrow range', () => {
		expect(arrowMoveForStep(playedE4, 9, { from: 10, to: 20 })).toBeNull();
		expect(arrowMoveForStep(playedE4, 20, { from: 10, to: 20 })).toBeNull();
	});

	it('returns null for an opponent-turn ply even inside the arrow range', () => {
		const opponentStep = { ...playedE4, isPlayerTurn: false };
		expect(arrowMoveForStep(opponentStep, 12, { from: 10, to: 20 })).toBeNull();
	});

	it('returns the correct move\'s from/to squares for a player-turn ply inside the arrow range', () => {
		expect(arrowMoveForStep(playedE4, 12, { from: 10, to: 20 })).toEqual({ from: 'e2', to: 'e4' });
	});

	it('returns null if the san cannot be parsed against fromFen', () => {
		const badStep = { ...playedE4, san: 'Zz9' };
		expect(arrowMoveForStep(badStep, 12, { from: 10, to: 20 })).toBeNull();
	});
});
```

- [ ] **Step 10: Run tests to verify they fail**

Run: `cd mychess && npx vitest run src/lib/mastery/teaching.test.ts`
Expected: FAIL — `arrowMoveForStep is not a function`.

- [ ] **Step 11: Implement `arrowMoveForStep`**

Add to `mychess/src/lib/mastery/teaching.ts`:

```ts
/**
 * The current ply's arrow — the move's own origin/destination squares, or
 * null if this ply isn't inside the served arrow range, isn't the player's
 * own move (arrows never point at the opponent's reply), or the move can't
 * be parsed. Mirrors the existing hintSquare derivation's try/catch shape in
 * +page.svelte.
 */
export function arrowMoveForStep(
	step: VariationStep,
	plyIndex: number,
	arrowPlies: { from: number; to: number } | null
): { from: string; to: string } | null {
	if (!arrowPlies || plyIndex < arrowPlies.from || plyIndex >= arrowPlies.to || !step.isPlayerTurn) return null;
	try {
		const move = new Chess(step.fromFen).move(step.san);
		return move ? { from: move.from, to: move.to } : null;
	} catch {
		return null;
	}
}
```

- [ ] **Step 12: Run all tests in the file to verify they pass**

Run: `cd mychess && npx vitest run src/lib/mastery/teaching.test.ts`
Expected: all 15 tests PASS.

- [ ] **Step 13: Commit**

```bash
git add mychess/src/lib/mastery/teaching.ts mychess/src/lib/mastery/teaching.test.ts
git commit -m "feat: add pure teaching-batch resolution logic"
```

---

### Task 3: Extend `buildPracticeView` with teaching state

**Files:**
- Modify: `mychess/src/lib/mastery/practice.ts`
- Test: `mychess/src/lib/mastery/practice.test.ts`

- [ ] **Step 1: Update the existing tests to pass a `teachingProgress` map, and write the new teaching-specific tests**

Replace the full contents of `mychess/src/lib/mastery/practice.test.ts` with:

```ts
// mychess/src/lib/mastery/practice.test.ts
import { describe, it, expect } from 'vitest';
import { buildPracticeView, optimisticSolvedAfterAttempt } from './practice';
import type { Variation, VariationStep } from './variations';

function makeVariation(playerMoveCount: number, prefix: string): Variation {
	const path: VariationStep[] = [];
	for (let i = 1; i <= playerMoveCount; i++) {
		path.push({ moveId: `${prefix}p${i}`, san: `P${i}`, fromFen: `f${i}a`, toFen: `f${i}b`, isPlayerTurn: true });
		path.push({ moveId: `${prefix}o${i}`, san: `O${i}`, fromFen: `f${i}b`, toFen: `f${i + 1}a`, isPlayerTurn: false });
	}
	return {
		leafMoveId: path[path.length - 1].moveId,
		variationKey: path.map((s) => s.moveId).join('>'),
		path,
		playerMoveCount
	};
}

const noTeaching = new Map<string, { taughtPlies: number; masteredPlies: number }>();

describe('buildPracticeView', () => {
	it('serves the active variation\'s FULL path as the attempt, unsplit', () => {
		const v = makeVariation(3, 'a-');
		const view = buildPracticeView([v], null, new Set(), noTeaching);
		expect(view.attempt).not.toBeNull();
		expect(view.attempt!.variationKey).toBe(v.variationKey);
		expect(view.attempt!.path).toEqual(v.path); // whole path, no auto-play split
	});

	it('defaults to the first unsolved variation when no active key is set', () => {
		const a = makeVariation(2, 'a-');
		const b = makeVariation(2, 'b-');
		const view = buildPracticeView([a, b], null, new Set([a.variationKey]), noTeaching);
		expect(view.attempt!.variationKey).toBe(b.variationKey);
	});

	it('respects an explicit active key even if it points at an already-solved variation', () => {
		const a = makeVariation(2, 'a-');
		const b = makeVariation(2, 'b-');
		const view = buildPracticeView([a, b], a.variationKey, new Set([a.variationKey]), noTeaching);
		expect(view.attempt!.variationKey).toBe(a.variationKey);
	});

	it('reports solved/total across the whole repertoire', () => {
		const a = makeVariation(2, 'a-');
		const b = makeVariation(2, 'b-');
		const c = makeVariation(2, 'c-');
		const view = buildPracticeView([a, b, c], null, new Set([a.variationKey]), noTeaching);
		expect(view.solved).toBe(1);
		expect(view.total).toBe(3);
	});

	it('returns a null attempt and allSolved=true once every variation is solved', () => {
		const a = makeVariation(2, 'a-');
		const view = buildPracticeView([a], null, new Set([a.variationKey]), noTeaching);
		expect(view.attempt).toBeNull();
		expect(view.allSolved).toBe(true);
		expect(view.solved).toBe(1);
		expect(view.total).toBe(1);
	});

	it('returns the vacuous empty-repertoire shape for no variations at all', () => {
		const view = buildPracticeView([], null, new Set(), noTeaching);
		expect(view.attempt).toBeNull();
		expect(view.allSolved).toBe(true);
		expect(view.solved).toBe(0);
		expect(view.total).toBe(0);
	});

	it('allSolved is false while ANY variation (including a manually re-picked solved one) still has unsolved siblings', () => {
		const a = makeVariation(2, 'a-');
		const b = makeVariation(2, 'b-');
		const view = buildPracticeView([a, b], a.variationKey, new Set([a.variationKey]), noTeaching);
		expect(view.attempt!.variationKey).toBe(a.variationKey);
		expect(view.allSolved).toBe(false);
	});

	it('forceAttempt serves a manually re-picked variation even when the whole repertoire is already solved', () => {
		const a = makeVariation(2, 'a-');
		const view = buildPracticeView([a], a.variationKey, new Set([a.variationKey]), noTeaching, true);
		expect(view.attempt).not.toBeNull();
		expect(view.attempt!.variationKey).toBe(a.variationKey);
		expect(view.allSolved).toBe(true);
	});

	it('serves a truncated path and arrow range for an unsolved variation still being taught', () => {
		const v = makeVariation(15, 'a-'); // 30 plies
		const view = buildPracticeView([v], null, new Set(), noTeaching);
		expect(view.attempt!.path).toHaveLength(20);
		expect(view.attempt!.arrowPlies).toEqual({ from: 10, to: 20 });
		expect(view.attempt!.isFinalPass).toBe(false);
	});

	it('ignores stale teaching-progress data for an already-solved variation and serves it at full depth with no arrow', () => {
		const v = makeVariation(15, 'a-'); // 30 plies
		const progress = new Map([[v.variationKey, { taughtPlies: 20, masteredPlies: 10 }]]);
		const view = buildPracticeView([v], v.variationKey, new Set([v.variationKey]), progress, true);
		expect(view.attempt!.path).toHaveLength(30);
		expect(view.attempt!.arrowPlies).toBeNull();
		expect(view.attempt!.isFinalPass).toBe(true);
	});
});

describe('optimisticSolvedAfterAttempt', () => {
	it('bumps solved by one on a clean attempt', () => {
		expect(optimisticSolvedAfterAttempt({ solved: 3, total: 10 }, false)).toBe(4);
	});

	it('leaves solved unchanged on a mistaken attempt', () => {
		expect(optimisticSolvedAfterAttempt({ solved: 3, total: 10 }, true)).toBe(3);
	});

	it('never exceeds total, even if solved was already at (or somehow past) it', () => {
		expect(optimisticSolvedAfterAttempt({ solved: 10, total: 10 }, false)).toBe(10);
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd mychess && npx vitest run src/lib/mastery/practice.test.ts`
Expected: FAIL — `buildPracticeView` called with too many/wrong-shaped arguments; `view.attempt!.arrowPlies`/`isFinalPass` are `undefined`.

- [ ] **Step 3: Update `buildPracticeView`**

Replace the full contents of `mychess/src/lib/mastery/practice.ts` with:

```ts
// mychess/src/lib/mastery/practice.ts
import type { Variation, VariationStep } from './variations';
import { pickActiveVariation, solvedProgress } from './variationSequence';
import { resolveTeachingStep } from './teaching';

export type PracticeView = {
	attempt: {
		path: VariationStep[];
		variationKey: string;
		arrowPlies: { from: number; to: number } | null;
		isFinalPass: boolean;
	} | null;
	solved: number;
	total: number;
	allSolved: boolean;
};

/**
 * Builds the full client-facing practice view: which variation to quiz next
 * (its path — the WHOLE thing once mastered, or truncated to the current
 * teaching batch otherwise, see resolveTeachingStep) plus the
 * repertoire-wide solved/total count. `activeVariationKey` is whatever is
 * currently persisted (or `null` if none yet); `solvedKeys` is this player's
 * full solved set for this repertoire; `teachingProgress` is this player's
 * per-variation `{taughtPlies, masteredPlies}` state for this repertoire.
 */
export function buildPracticeView(
	variations: Variation[],
	activeVariationKey: string | null,
	solvedKeys: ReadonlySet<string>,
	teachingProgress: ReadonlyMap<string, { taughtPlies: number; masteredPlies: number }>,
	forceAttempt: boolean = false
): PracticeView {
	const { solved, total } = solvedProgress(variations, solvedKeys);
	const active = pickActiveVariation(variations, activeVariationKey, solvedKeys);

	// allSolved means the REPERTOIRE is done, not just that the (possibly
	// manually re-picked) active variation happens to be solved — those are
	// different things once a player can pick an already-solved variation.
	// An empty repertoire (total === 0) counts as vacuously all-solved.
	const allSolved = solved === total;

	let attempt: PracticeView['attempt'] = null;
	// The !allSolved gate suppresses the attempt once the repertoire is done,
	// so the trophy screen shows instead of auto-serving variations[0] forever.
	// forceAttempt bypasses that gate for a deliberate manual re-pick (the
	// picker), where the player explicitly asked to re-drill a variation even
	// though everything is already solved.
	if (active && (forceAttempt || !allSolved)) {
		if (solvedKeys.has(active.variationKey)) {
			// Already solved (including a manual re-drill pick) — never
			// re-teach, regardless of what teachingProgress happens to hold.
			attempt = { path: active.path, variationKey: active.variationKey, arrowPlies: null, isFinalPass: true };
		} else {
			const progress = teachingProgress.get(active.variationKey) ?? { taughtPlies: 0, masteredPlies: 0 };
			const step = resolveTeachingStep(active.path, progress.taughtPlies, progress.masteredPlies);
			attempt = {
				path: step.path,
				variationKey: active.variationKey,
				arrowPlies: step.arrowPlies,
				isFinalPass: step.isFinalPass
			};
		}
	}

	return { attempt, solved, total, allSolved };
}

/**
 * The sidebar's solved count to show the instant a clean, FINAL-PASS attempt
 * completes, before the server's own round trip confirms it. That round trip
 * re-walks the whole repertoire's move tree to advance the active variation
 * and can take a real, noticeable moment for a large repertoire — this lets
 * the count bump in step with the "correct!" feedback instead of lagging
 * behind it. Clamped to never exceed `total`; a no-op for a mistaken attempt.
 *
 * This is a best-effort estimate, not a source of truth: re-drilling an
 * already-solved variation (allowed via the picker) would over-count by one
 * here, since this has no way to know the active variation was already
 * solved. The server's authoritative response — merged in once it arrives —
 * always overwrites this a moment later, so a wrong guess self-corrects
 * rather than sticking. The caller is responsible for only invoking this when
 * `attempt.isFinalPass` was true — a clean teach or intermediate blind-retest
 * pass doesn't solve anything yet.
 */
export function optimisticSolvedAfterAttempt(current: { solved: number; total: number }, hadMistake: boolean): number {
	if (hadMistake) return current.solved;
	return Math.min(current.solved + 1, current.total);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd mychess && npx vitest run src/lib/mastery/practice.test.ts`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add mychess/src/lib/mastery/practice.ts mychess/src/lib/mastery/practice.test.ts
git commit -m "feat: thread teaching progress through buildPracticeView"
```

---

### Task 4: Persist and apply teaching progress server-side

**Files:**
- Modify: `mychess/src/lib/server/practice-progress.ts`
- Test: `mychess/src/lib/server/practice-progress.test.ts` (new file)

- [ ] **Step 1: Write the failing tests**

```ts
// mychess/src/lib/server/practice-progress.test.ts
import { describe, it, expect } from 'vitest';
import { applyAttemptResult } from './practice-progress';
import type { Variation } from '$lib/mastery/variations';

function makeVariation(variationKey: string, plies: number): Variation {
	const path = Array.from({ length: plies }, (_, i) => ({
		moveId: `${variationKey}-p${i}`,
		san: `M${i}`,
		fromFen: `f${i}a`,
		toFen: `f${i}b`,
		isPlayerTurn: i % 2 === 0
	}));
	return { leafMoveId: path[path.length - 1].moveId, variationKey, path, playerMoveCount: Math.ceil(plies / 2) };
}

function fakeSupabase(opts: {
	solvedKeys?: string[];
	teachingRows?: Array<{ variation_key: string; taught_plies: number; mastered_plies: number }>;
} = {}) {
	const solved = new Set(opts.solvedKeys ?? []);
	const teachingRows = opts.teachingRows ?? [];
	const fromCalls: string[] = [];
	const upsertCalls: Array<{ table: string; rows: any; options: any }> = [];

	const client = {
		from: (table: string) => {
			fromCalls.push(table);
			if (table === 'variation_solved') {
				return {
					select: () => ({
						eq: () => ({
							eq: () => Promise.resolve({ data: Array.from(solved).map((variation_key) => ({ variation_key })) })
						})
					}),
					upsert: (rows: any, options: any) => {
						upsertCalls.push({ table, rows, options });
						solved.add((Array.isArray(rows) ? rows[0] : rows).variation_key);
						return Promise.resolve({ error: null });
					}
				};
			}
			if (table === 'variation_teaching_progress') {
				return {
					select: () => ({
						eq: () => ({ eq: () => Promise.resolve({ data: teachingRows }) })
					}),
					upsert: (rows: any, options: any) => {
						upsertCalls.push({ table, rows, options });
						return Promise.resolve({ error: null });
					}
				};
			}
			if (table === 'practice_active_variation') {
				return {
					upsert: (rows: any, options: any) => {
						upsertCalls.push({ table, rows, options });
						return Promise.resolve({ error: null });
					}
				};
			}
			throw new Error(`fakeSupabase: unexpected table ${table}`);
		}
	};

	return { client, fromCalls, upsertCalls };
}

describe('applyAttemptResult', () => {
	it('makes no reads or writes at all on a mistaken attempt', async () => {
		const { client, fromCalls, upsertCalls } = fakeSupabase();
		const v1 = makeVariation('v1', 25);
		await applyAttemptResult(client as any, 'player-1', 'rep-1', 'v1', true, [v1]);
		expect(fromCalls).toHaveLength(0);
		expect(upsertCalls).toHaveLength(0);
	});

	it('a clean teach-batch pass advances taught_plies only, and does not touch variation_solved', async () => {
		const { client, upsertCalls } = fakeSupabase({ teachingRows: [] });
		const v1 = makeVariation('v1', 25);
		await applyAttemptResult(client as any, 'player-1', 'rep-1', 'v1', false, [v1]);
		expect(upsertCalls).toEqual([
			{
				table: 'variation_teaching_progress',
				rows: { player_id: 'player-1', repertoire_id: 'rep-1', variation_key: 'v1', taught_plies: 20, mastered_plies: 10 },
				options: { onConflict: 'player_id,variation_key' }
			}
		]);
	});

	it('a clean non-final blind retest advances mastered_plies only, and does not touch variation_solved', async () => {
		const { client, upsertCalls } = fakeSupabase({
			teachingRows: [{ variation_key: 'v1', taught_plies: 20, mastered_plies: 10 }]
		});
		const v1 = makeVariation('v1', 25);
		await applyAttemptResult(client as any, 'player-1', 'rep-1', 'v1', false, [v1]);
		expect(upsertCalls).toEqual([
			{
				table: 'variation_teaching_progress',
				rows: { player_id: 'player-1', repertoire_id: 'rep-1', variation_key: 'v1', taught_plies: 20, mastered_plies: 20 },
				options: { onConflict: 'player_id,variation_key' }
			}
		]);
	});

	it('the final batch\'s clean blind retest marks the variation solved and advances the active variation', async () => {
		const { client, upsertCalls } = fakeSupabase({
			teachingRows: [{ variation_key: 'v1', taught_plies: 25, mastered_plies: 20 }]
		});
		const v1 = makeVariation('v1', 25);
		const v2 = makeVariation('v2', 4);
		await applyAttemptResult(client as any, 'player-1', 'rep-1', 'v1', false, [v1, v2]);

		expect(upsertCalls).toEqual([
			{
				table: 'variation_teaching_progress',
				rows: { player_id: 'player-1', repertoire_id: 'rep-1', variation_key: 'v1', taught_plies: 25, mastered_plies: 25 },
				options: { onConflict: 'player_id,variation_key' }
			},
			{
				table: 'variation_solved',
				rows: { player_id: 'player-1', repertoire_id: 'rep-1', variation_key: 'v1' },
				options: { onConflict: 'player_id,variation_key', ignoreDuplicates: true }
			},
			{
				table: 'practice_active_variation',
				rows: expect.objectContaining({ player_id: 'player-1', repertoire_id: 'rep-1', active_variation_key: 'v2' }),
				options: { onConflict: 'player_id,repertoire_id' }
			}
		]);
	});

	it('bypasses teaching progress entirely for an already-solved variation (re-drill)', async () => {
		const { client, upsertCalls } = fakeSupabase({ solvedKeys: ['v1'] });
		const v1 = makeVariation('v1', 25);
		await applyAttemptResult(client as any, 'player-1', 'rep-1', 'v1', false, [v1]);
		expect(upsertCalls.some((c) => c.table === 'variation_teaching_progress')).toBe(false);
		expect(upsertCalls.some((c) => c.table === 'variation_solved')).toBe(true);
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd mychess && npx vitest run src/lib/server/practice-progress.test.ts`
Expected: FAIL — actual `upsertCalls` won't include a `variation_teaching_progress` entry yet (function doesn't know about it).

- [ ] **Step 3: Add `loadTeachingProgress`/`saveTeachingProgress` and update `applyAttemptResult`**

Replace the full contents of `mychess/src/lib/server/practice-progress.ts` with:

```ts
// mychess/src/lib/server/practice-progress.ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Variation } from '$lib/mastery/variations';
import { pickActiveVariation, advanceIfSolved } from '$lib/mastery/variationSequence';
import { advanceTeachingProgress } from '$lib/mastery/teaching';

/** This player's full solved-variation-key set for one repertoire. */
export async function loadSolvedKeys(supabase: SupabaseClient, playerId: string, repertoireId: string): Promise<Set<string>> {
	const { data } = await supabase
		.from('variation_solved')
		.select('variation_key')
		.eq('player_id', playerId)
		.eq('repertoire_id', repertoireId);
	return new Set((data ?? []).map((r: any) => r.variation_key as string));
}

/** This player's currently-persisted active variation key for one repertoire, or `null` if no row exists yet. */
export async function loadActiveVariationKey(
	supabase: SupabaseClient,
	playerId: string,
	repertoireId: string
): Promise<string | null> {
	const { data } = await supabase
		.from('practice_active_variation')
		.select('active_variation_key')
		.eq('player_id', playerId)
		.eq('repertoire_id', repertoireId)
		.maybeSingle();
	return data?.active_variation_key ?? null;
}

/**
 * Persists a specific variation as the active one — used both by the manual
 * picker (set exactly what was clicked) and by attempt-completion (set the
 * next-in-sequence variation once the previous one is solved). A plain
 * upsert: no optimistic-concurrency version column, unlike the old
 * level_progress table — see migration 0045's comment for why a benign
 * last-write-wins race is an acceptable tradeoff here.
 */
export async function setActiveVariationKey(
	supabase: SupabaseClient,
	playerId: string,
	repertoireId: string,
	activeVariationKey: string | null
): Promise<void> {
	await supabase
		.from('practice_active_variation')
		.upsert(
			{ player_id: playerId, repertoire_id: repertoireId, active_variation_key: activeVariationKey, updated_at: new Date().toISOString() },
			{ onConflict: 'player_id,repertoire_id' }
		);
}

/**
 * Marks a variation solved (idempotent — inserting an already-solved key is
 * a harmless no-op via `ignoreDuplicates`, since solved never un-solves).
 */
export async function markVariationSolved(
	supabase: SupabaseClient,
	playerId: string,
	repertoireId: string,
	variationKey: string
): Promise<void> {
	await supabase
		.from('variation_solved')
		.upsert(
			{ player_id: playerId, repertoire_id: repertoireId, variation_key: variationKey },
			{ onConflict: 'player_id,variation_key', ignoreDuplicates: true }
		);
}

/** This player's full teaching-progress state for one repertoire, keyed by variation_key. */
export async function loadTeachingProgress(
	supabase: SupabaseClient,
	playerId: string,
	repertoireId: string
): Promise<Map<string, { taughtPlies: number; masteredPlies: number }>> {
	const { data } = await supabase
		.from('variation_teaching_progress')
		.select('variation_key, taught_plies, mastered_plies')
		.eq('player_id', playerId)
		.eq('repertoire_id', repertoireId);
	return new Map(
		(data ?? []).map((r: any) => [r.variation_key as string, { taughtPlies: r.taught_plies as number, masteredPlies: r.mastered_plies as number }])
	);
}

/** Persists this variation's teaching-progress counters (see `src/lib/mastery/teaching.ts`). */
export async function saveTeachingProgress(
	supabase: SupabaseClient,
	playerId: string,
	repertoireId: string,
	variationKey: string,
	taughtPlies: number,
	masteredPlies: number
): Promise<void> {
	await supabase
		.from('variation_teaching_progress')
		.upsert(
			{ player_id: playerId, repertoire_id: repertoireId, variation_key: variationKey, taught_plies: taughtPlies, mastered_plies: masteredPlies },
			{ onConflict: 'player_id,variation_key' }
		);
}

/**
 * Ensures a `practice_active_variation` row exists and resolves to a real,
 * current variation before the page ever renders — self-healing the same
 * way `pickActiveVariation` already does for a stale/missing key (a fresh
 * player, or a repertoire edited/excluded since the key was last stored).
 * Returns the RESOLVED key (never null unless there are no variations at
 * all), persisting it if it differs from what was stored.
 */
export async function loadSyncedActiveVariationKey(
	supabase: SupabaseClient,
	playerId: string,
	repertoireId: string,
	variations: Variation[],
	solvedKeys: ReadonlySet<string>
): Promise<string | null> {
	if (variations.length === 0) return null;
	const stored = await loadActiveVariationKey(supabase, playerId, repertoireId);
	const resolved = pickActiveVariation(variations, stored, solvedKeys);
	if (!resolved) return null;
	if (resolved.variationKey !== stored) {
		await setActiveVariationKey(supabase, playerId, repertoireId, resolved.variationKey);
	}
	return resolved.variationKey;
}

/**
 * Applies a completed attempt's outcome. A mistaken attempt is always a
 * no-op (no reads, no writes) — the active variation and its teaching
 * progress both stay exactly as they were, so the next attempt naturally
 * re-serves the same step for another try.
 *
 * On a clean attempt: if the variation isn't already solved, its teaching
 * progress advances (see `advanceTeachingProgress`) — UNLESS that was the
 * variation's final batch, in which case (exactly like an already-solved
 * variation re-drilled via the picker) it falls through to the existing
 * solved/advance-active-variation sequence.
 */
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
			const progress = await loadTeachingProgress(supabase, playerId, repertoireId);
			const current = progress.get(variationKey) ?? { taughtPlies: 0, masteredPlies: 0 };
			const next = advanceTeachingProgress(variation.path, current.taughtPlies, current.masteredPlies, false);
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

Run: `cd mychess && npx vitest run src/lib/server/practice-progress.test.ts`
Expected: all 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add mychess/src/lib/server/practice-progress.ts mychess/src/lib/server/practice-progress.test.ts
git commit -m "feat: persist and apply per-variation teaching progress"
```

---

### Task 5: Wire teaching progress into the three `buildPracticeView` call sites

**Files:**
- Modify: `mychess/src/routes/api/practice/attempt/+server.ts`
- Modify: `mychess/src/routes/api/practice/select-variation/+server.ts`
- Modify: `mychess/src/routes/(player)/practice/[repertoire_id]/+page.server.ts`

No dedicated unit tests exist for these thin route/load files today (confirmed: no test file references them); this task is verified by the full test suite (unaffected) plus `npm run check` (Task 3 changed `buildPracticeView`'s required parameter count, so these three call sites MUST be updated together or `npm run check` will fail).

- [ ] **Step 1: Update `attempt/+server.ts`**

Replace the full contents of `mychess/src/routes/api/practice/attempt/+server.ts` with:

```ts
// mychess/src/routes/api/practice/attempt/+server.ts
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { loadFilteredRepertoireVariations } from '$lib/server/practice-repertoire';
import { applyAttemptResult, loadActiveVariationKey, loadSolvedKeys, loadTeachingProgress } from '$lib/server/practice-progress';
import { incrementQuestProgress } from '$lib/server/quests';
import { requireApiUser } from '$lib/server/auth';
import { buildPracticeView } from '$lib/mastery/practice';

/**
 * Called once per completed Practice attempt (the whole variation replayed,
 * not per move). Reports whether the attempt was clean — a clean attempt
 * marks the variation solved and advances the active variation; a mistaken
 * one is a no-op (the same variation is naturally re-served next).
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const { supabase } = locals;
	const user = await requireApiUser(locals);

	const body = await request.json();
	const { repertoireId, variationKey, hadMistake } = body ?? {};
	if (typeof repertoireId !== 'string' || typeof variationKey !== 'string' || typeof hadMistake !== 'boolean') {
		throw error(400, 'Invalid request');
	}

	const { variations } = await loadFilteredRepertoireVariations(supabase, user.id, repertoireId);
	const today = new Date().toISOString().slice(0, 10);
	await Promise.all([
		applyAttemptResult(supabase, user.id, repertoireId, variationKey, hadMistake, variations),
		incrementQuestProgress(supabase, user.id, 'review_cards', today)
	]);

	const [activeVariationKey, solvedKeys, teachingProgress] = await Promise.all([
		loadActiveVariationKey(supabase, user.id, repertoireId),
		loadSolvedKeys(supabase, user.id, repertoireId),
		loadTeachingProgress(supabase, user.id, repertoireId)
	]);
	return json(buildPracticeView(variations, activeVariationKey, solvedKeys, teachingProgress));
};
```

- [ ] **Step 2: Update `select-variation/+server.ts`**

Replace the full contents of `mychess/src/routes/api/practice/select-variation/+server.ts` with:

```ts
// mychess/src/routes/api/practice/select-variation/+server.ts
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { loadFilteredRepertoireVariations } from '$lib/server/practice-repertoire';
import { setActiveVariationKey, loadSolvedKeys, loadTeachingProgress } from '$lib/server/practice-progress';
import { requireApiUser } from '$lib/server/auth';
import { buildPracticeView } from '$lib/mastery/practice';

/**
 * Manually sets the active variation from the picker — the SAME
 * active_variation_key the automatic sequence and attempt-completion both
 * read/write. Picking a variation the player has already solved is allowed
 * (re-drilling for confidence); it doesn't un-solve anything, and it never
 * re-teaches (see buildPracticeView's already-solved bypass).
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const { supabase } = locals;
	const user = await requireApiUser(locals);

	const body = await request.json();
	const { repertoireId, variationKey } = body ?? {};
	if (typeof repertoireId !== 'string' || typeof variationKey !== 'string') {
		throw error(400, 'Invalid request');
	}

	const { variations } = await loadFilteredRepertoireVariations(supabase, user.id, repertoireId);
	if (!variations.some((v) => v.variationKey === variationKey)) {
		throw error(404, 'Variation not found');
	}

	await setActiveVariationKey(supabase, user.id, repertoireId, variationKey);
	const [solvedKeys, teachingProgress] = await Promise.all([
		loadSolvedKeys(supabase, user.id, repertoireId),
		loadTeachingProgress(supabase, user.id, repertoireId)
	]);
	return json(buildPracticeView(variations, variationKey, solvedKeys, teachingProgress, true));
};
```

- [ ] **Step 3: Update the practice detail page's `+page.server.ts`**

Replace the full contents of `mychess/src/routes/(player)/practice/[repertoire_id]/+page.server.ts` with:

```ts
// mychess/src/routes/(player)/practice/[repertoire_id]/+page.server.ts
import type { PageServerLoad } from './$types';
import { requireAccount } from '$lib/server/auth';
import { loadFilteredRepertoireVariations } from '$lib/server/practice-repertoire';
import { loadSyncedActiveVariationKey, loadSolvedKeys, loadTeachingProgress } from '$lib/server/practice-progress';
import { buildPracticeView } from '$lib/mastery/practice';

export const load: PageServerLoad = async ({ params, locals }) => {
	const { user } = await requireAccount(locals);
	const supabase = locals.supabase;
	const repertoireId = params.repertoire_id;

	const [{ repertoire, variations }, solvedKeys, teachingProgress] = await Promise.all([
		loadFilteredRepertoireVariations(supabase, user!.id, repertoireId),
		loadSolvedKeys(supabase, user!.id, repertoireId),
		loadTeachingProgress(supabase, user!.id, repertoireId)
	]);
	const activeVariationKey = await loadSyncedActiveVariationKey(supabase, user!.id, repertoireId, variations, solvedKeys);

	return { repertoire, ...buildPracticeView(variations, activeVariationKey, solvedKeys, teachingProgress) };
};
```

- [ ] **Step 4: Type-check**

Run: `cd mychess && npm run check`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add mychess/src/routes/api/practice/attempt/+server.ts mychess/src/routes/api/practice/select-variation/+server.ts "mychess/src/routes/(player)/practice/[repertoire_id]/+page.server.ts"
git commit -m "feat: load and thread teaching progress at every practice-view call site"
```

---

### Task 6: Render the arrow in `ChessBoard.svelte`

**Files:**
- Modify: `mychess/src/lib/components/ChessBoard.svelte`

No new automated test — this component's own DOM output goes through chessground's canvas/SVG rendering, which isn't asserted anywhere today (there is no existing `ChessBoard.test.ts`). Verified via `npm run check` here, and end-to-end in Task 8's manual verification.

- [ ] **Step 1: Add the `arrowMove` prop**

In `mychess/src/lib/components/ChessBoard.svelte`, in the `Props` type (after `hintSquare`):

```ts
		// Highlights this square (e.g. a hint's "move this piece" square) with
		// a pulsing amber ring and a lightbulb badge — never the destination,
		// so it points at a piece without giving away where it should go.
		hintSquare?: Key | null;
		// The correct move to reveal during a teaching pass — a native
		// chessground arrow (both orig and dest set), distinct from
		// hintSquare's origin-only ring. Cleared the instant the move lands
		// (see feedbackShapes(), which takes over the drawable slot then).
		arrowMove?: { from: Key; to: Key } | null;
	};
```

In the `let { ... } = $props();` destructure (after `hintSquare = null`):

```ts
	let {
		fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
		orientation = 'white' as Color,
		interactable = true,
		lastMove = undefined,
		prefs = DEFAULT_PREFS,
		onmove,
		hintSquare = null,
		arrowMove = null
	}: Props = $props();
```

- [ ] **Step 2: Add `arrowShapes()` and merge it into `drawable.autoShapes`**

Add a new function right before `feedbackShapes()`:

```ts
	// The teaching-pass arrow, drawn via chessground's own native shape
	// rendering (orig+dest, same brush the board's own right-click drawing
	// tool already uses) — not a custom SVG like feedbackShapes() below.
	function arrowShapes(): DrawShape[] {
		if (!arrowMove) return [];
		return [{ orig: arrowMove.from, dest: arrowMove.to, brush: 'yellow' }];
	}
```

In `buildConfig()`, change the final `drawable` line from:

```ts
			drawable: { autoShapes: feedbackShapes() }
```

to:

```ts
			drawable: { autoShapes: [...arrowShapes(), ...feedbackShapes()] }
```

Leave the two `cg.set({ drawable: { autoShapes: feedbackShapes() } })` calls inside `movable.events.after` unchanged — the arrow is intentionally replaced by the check/cross/star badge for that hold, not shown alongside it.

- [ ] **Step 3: Type-check**

Run: `cd mychess && npm run check`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add mychess/src/lib/components/ChessBoard.svelte
git commit -m "feat: render the teaching-pass arrow in ChessBoard"
```

---

### Task 7: Wire the arrow and final-pass gating into the practice detail page

**Files:**
- Modify: `mychess/src/routes/(player)/practice/[repertoire_id]/+page.svelte`

- [ ] **Step 1: Add the `arrowMove` derived value**

In `mychess/src/routes/(player)/practice/[repertoire_id]/+page.svelte`, update the import from `$lib/mastery/practice` and add one from `$lib/mastery/teaching`:

```ts
	import { optimisticSolvedAfterAttempt, type PracticeView } from '$lib/mastery/practice';
	import { arrowMoveForStep } from '$lib/mastery/teaching';
	import type { VariationStep } from '$lib/mastery/variations';
```

Add a new derived value right after the existing `hintSquare` derived block:

```ts
	// The current ply's teaching arrow, if this attempt is a teach pass and
	// we're standing on one of its plies — see arrowMoveForStep for the
	// player-turn/ply-range/parse-failure guards.
	const arrowMove = $derived.by(() => {
		const step = quizSteps[quizIdx];
		if (!step) return null;
		const move = arrowMoveForStep(step, quizIdx, attempt?.arrowPlies ?? null);
		return move ? { from: move.from as Key, to: move.to as Key } : null;
	});
```

- [ ] **Step 2: Pass `arrowMove` to `ChessBoard`**

Change:

```svelte
				<ChessBoard
					fen={boardFen}
					orientation={data.repertoire?.color === 'black' ? 'black' : 'white'}
					interactable={phase === 'playing' && !locked}
					onmove={handleMove}
					prefs={data.boardPrefs}
					{hintSquare}
				/>
```

to:

```svelte
				<ChessBoard
					fen={boardFen}
					orientation={data.repertoire?.color === 'black' ? 'black' : 'white'}
					interactable={phase === 'playing' && !locked}
					onmove={handleMove}
					prefs={data.boardPrefs}
					{hintSquare}
					{arrowMove}
				/>
```

- [ ] **Step 3: Gate the optimistic solved-count bump on `isFinalPass`**

Change:

```ts
			if (isFinalMove && attempt) {
				pendingReport = reportAttempt(attempt.variationKey, attemptHadMistake);
				// Bump the sidebar count immediately rather than waiting for
				// the round trip above to resolve — it re-walks the whole
				// repertoire's move tree to advance the active variation,
				// which can take a real, noticeable moment for a large
				// repertoire. nextAttempt() overwrites this with the
				// server's authoritative value once pendingReport resolves.
				data = { ...data, solved: optimisticSolvedAfterAttempt(data, attemptHadMistake) };
			}
```

to:

```ts
			if (isFinalMove && attempt) {
				pendingReport = reportAttempt(attempt.variationKey, attemptHadMistake);
				// Bump the sidebar count immediately rather than waiting for
				// the round trip above to resolve — it re-walks the whole
				// repertoire's move tree to advance the active variation,
				// which can take a real, noticeable moment for a large
				// repertoire. nextAttempt() overwrites this with the
				// server's authoritative value once pendingReport resolves.
				// Only a FINAL pass can actually solve the variation — a
				// clean teach or intermediate blind-retest pass hasn't, so it
				// must not bump the count.
				if (attempt.isFinalPass) {
					data = { ...data, solved: optimisticSolvedAfterAttempt(data, attemptHadMistake) };
				}
			}
```

- [ ] **Step 4: Type-check**

Run: `cd mychess && npm run check`
Expected: 0 errors.

- [ ] **Step 5: Run the existing route test file to confirm no regression**

Run: `cd mychess && npx vitest run "src/routes/(player)/practice/[repertoire_id]/practice.test.ts"`
Expected: all existing tests PASS unchanged — these fixtures build `data.attempt` without `arrowPlies`/`isFinalPass`, which `arrowMoveForStep`'s `attempt?.arrowPlies ?? null` and the `if (attempt.isFinalPass)` check both handle as falsy without erroring.

- [ ] **Step 6: Commit**

```bash
git add "mychess/src/routes/(player)/practice/[repertoire_id]/+page.svelte"
git commit -m "feat: wire the teaching arrow and final-pass gating into the practice page"
```

---

### Task 8: Full verification and manual end-to-end check

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `cd mychess && NODE_OPTIONS=--experimental-require-module npx vitest run`
Expected: every test passes, including all new ones from Tasks 2–4 and the unchanged ones from Task 7's Step 5.

- [ ] **Step 2: Full type-check**

Run: `cd mychess && npm run check`
Expected: 0 errors.

- [ ] **Step 3: Manual browser verification**

Start the dev server (`cd mychess && npm run dev`) and, against a repertoire with a variation deeper than 10 plies (5 moves):

1. Practice that variation from scratch. Confirm no arrow appears for the first 5 moves.
2. Confirm a yellow arrow appears on each of moves 6–10 the first time through, and that clicking/dragging the arrow's own destination square is still required to actually play the move (the arrow doesn't auto-play anything).
3. After completing that pass, confirm the SAME variation restarts from move 1 with no arrows, and that a wrong move during this blind pass just re-serves the same blind pass (no arrows reappear).
4. For a variation longer than 15 moves (20+ plies), confirm the same teach-then-blind-retest cycle repeats for moves 11–15 after the first cycle completes.
5. Confirm the repertoire-wide "M of N solved" count does NOT increment after a teach or intermediate blind-retest pass, only once the variation's very last batch is cleanly blind-replayed.
6. Re-drill an already-solved variation via the picker and confirm it never shows an arrow, regardless of how it was solved.

- [ ] **Step 4: Tell the user about the pending migration**

Remind the user that `mychess/supabase/migrations/0046_variation_teaching_progress.sql` (Task 1) must be applied manually in the Supabase dashboard's SQL editor before this feature works against their real database — nothing in this plan applies it automatically.
