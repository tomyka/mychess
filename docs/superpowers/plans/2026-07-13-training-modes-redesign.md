# Training Modes Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse today's four training modes (Drill, Practice, Time Trial, Master) into two — Master (global pool, any repertoire, any move, with ★/✓/✗ Stockfish-graded feedback) and Practice (per-repertoire, chunk-of-3 leveled progression) — backed by a new per-move `move_progress` table shared by both.

**Architecture:** `move_progress(player_id, move_id, state)` tracks correctness per move edge, read/written by both modes. Practice repurposes today's per-repertoire Master mechanic at `/practice` + `/practice/[repertoire_id]`, with `src/lib/mastery/levels.ts`/`practice.ts` rewritten for uniform 3-move chunks and a deterministic (not random) auto-play boundary. Master repurposes today's `/drill` shell at a new flat `/master` route, drops the dead FSRS `reviews.state` filter, and adds Stockfish-graded off-book feedback via new `marker`/`forceRevert` props on `ChessBoard.svelte`. Time Trial and the old flat Practice are deleted outright; NavBar, QuickActions, the dashboard's guest CTA, and gamification naming (rename only, no redesign) follow.

**Tech Stack:** SvelteKit 2 + Svelte 5 (runes), Supabase (Postgres + RLS), Vitest + @testing-library/svelte, chess.js + chessground, client-side Stockfish WASM (`src/lib/engine/`).

**Reconciliation note:** this plan was drafted by two parallel research passes (Practice/migration, and Master/cleanup). One inconsistency was found and fixed before finalizing: the Master-mode tasks assumed a shared `markMoveCorrect` helper at `src/lib/server/move-progress.ts` that didn't actually exist in the Practice-side draft (which had inlined the same upsert logic directly in its own endpoint). **Task 6** below adds that shared helper, and **Task 7** (the Practice endpoint) was rewritten to call it instead of duplicating the logic — both sides now agree on one shared write path. Task numbers below are sequential across the whole plan (not the two drafts' original, independently-started numbering).

---

### Task 1: `move_progress` table migration

**Files:**
- Create: `supabase/migrations/0025_move_progress.sql`

- [ ] **Step 1: Write the migration**

```sql
-- mychess/supabase/migrations/0025_move_progress.sql
-- Tracks state per MOVE EDGE rather than per root-to-leaf variation
-- (replacing variation_progress's per-variation deepest-depth-reached model
-- for the new Practice/Master split — see
-- docs/superpowers/specs/2026-07-13-training-modes-redesign-design.md).
--
-- Repertoire lines share prefixes (the moves tree already models this —
-- multiple variations can share the same early edges before branching).
-- Tracking state on the edge itself means a shared trunk only ever needs to
-- be learned once; every variation sharing it benefits immediately, instead
-- of re-testing identical opening moves separately per branch.
--
-- A move starts 'new' and flips to 'correct' the instant it's played
-- correctly, in EITHER mode (Master or Practice) — this is the one shared
-- state store both modes read/write, so broad practice in Master also
-- advances a repertoire's structured levels in Practice, and vice versa.
--
-- variation_progress and reviews: kept, untouched, simply stop being
-- written to — matches this codebase's established non-destructive
-- convention rather than a destructive migration.
create table public.move_progress (
  id         uuid primary key default gen_random_uuid(),
  player_id  uuid not null references public.profiles(id) on delete cascade,
  move_id    uuid not null references public.moves(id) on delete cascade,
  state      text not null default 'new' check (state in ('new', 'correct')),
  updated_at timestamptz not null default now(),
  unique(player_id, move_id)
);

alter table public.move_progress enable row level security;

create policy "move_progress_player_all" on public.move_progress
  for all using (player_id = auth.uid());

revoke all on public.move_progress from anon, public;
```

- [ ] **Step 2: Commit**

```bash
cd mychess
git add supabase/migrations/0025_move_progress.sql
git commit -m "feat: add move_progress table for per-move mastery/practice tracking"
git push
```

- [ ] **Step 3: Ask the user to apply it manually**

Per `mychess/CLAUDE.md` ("Database & migrations"): there is no local Postgres or working service-role key in this environment, so Claude cannot apply migrations directly. Paste the SQL above into the Supabase dashboard SQL editor and run it (or trigger the `migrate.yml` GitHub Action if asked). Every later task in this plan that reads/writes `move_progress` will fail against production until this is confirmed applied — don't assume it took effect.

---

### Task 2: Delete the old per-repertoire Master mechanic (relocated to Practice)

**Files:**
- Delete: `src/routes/(player)/master/+page.server.ts`
- Delete: `src/routes/(player)/master/+page.svelte`
- Delete: `src/routes/(player)/master/[repertoire_id]/+page.server.ts`
- Delete: `src/routes/(player)/master/[repertoire_id]/+page.svelte`
- Delete: `src/routes/(player)/master/[repertoire_id]/train.test.ts`
- Delete: `src/routes/api/mastery/progress/+server.ts`

Confirmed via `grep -rln "lib/mastery" src/` and `grep -rln "api/mastery" src/`: these six files are the *only* consumers of the current `src/lib/mastery/levels.ts` / `practice.ts` APIs and the old per-attempt XP endpoint. Deleting them first means Task 3–5's rewrites of `levels.ts`/`practice.ts` (different function signatures) never leave a broken intermediate commit. The new global Master mode (reusing today's `/drill` shell, per the design spec) is built in Tasks 17–18 — after this task, `/master` and `/master/[repertoire_id]` will 404 until that work lands; `NavBar.svelte`'s `/master` links are fixed in Task 22, not here.

- [ ] **Step 1: Delete the old per-repertoire Master route and its API endpoint**

```bash
cd mychess
rm -rf "src/routes/(player)/master"
rm -rf src/routes/api/mastery
```

- [ ] **Step 2: Run the full test suite and type-check**

Run: `cd mychess && npx vitest run && npm run check`
Expected: all tests pass (the two deleted files had no test file of their own besides `train.test.ts`, now also gone — total test count drops accordingly); `svelte-check` error count unchanged from the known baseline (12 errors, all in `src/routes/auth/**`) — confirm no *new* errors from a dangling reference to the deleted files.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: remove the old per-repertoire Master mechanic, relocating to Practice"
git push
```

---

### Task 3: Rewrite `levels.ts` for chunk-of-3, `move_progress`-backed levels

**Files:**
- Modify: `src/lib/mastery/levels.ts`
- Modify: `src/lib/mastery/levels.test.ts`

**Depends on Task 2** (nothing left importing the old signatures).

- [ ] **Step 1: Replace the test file with the new chunk-of-3 / Set-based tests**

```ts
// mychess/src/lib/mastery/levels.test.ts
import { describe, it, expect } from 'vitest';
import { levelDepth, targetDepth, isSatisfied, currentLevel, activeLevel } from './levels';

/**
 * Builds a variation-shaped object with `playerMoveCount` player moves,
 * alternating player/opponent steps starting on the player's move, with move
 * ids `${prefix}p1`, `${prefix}o1`, `${prefix}p2`, `${prefix}o2`, ...
 */
function variation(playerMoveCount: number, prefix: string) {
	const path: { moveId: string; isPlayerTurn: boolean }[] = [];
	for (let i = 1; i <= playerMoveCount; i++) {
		path.push({ moveId: `${prefix}p${i}`, isPlayerTurn: true });
		path.push({ moveId: `${prefix}o${i}`, isPlayerTurn: false });
	}
	return { playerMoveCount, path };
}

describe('levelDepth', () => {
	it('is a uniform 3-move chunk per level, with no fixed ceiling', () => {
		expect(levelDepth(1)).toBe(3);
		expect(levelDepth(2)).toBe(6);
		expect(levelDepth(3)).toBe(9);
		expect(levelDepth(10)).toBe(30);
	});
});

describe('targetDepth', () => {
	it('is the level depth when the variation is longer', () => {
		expect(targetDepth({ playerMoveCount: 12 }, 2)).toBe(6);
	});

	it("is the variation's own length when shorter than the level depth", () => {
		expect(targetDepth({ playerMoveCount: 2 }, 2)).toBe(2);
	});
});

describe('isSatisfied', () => {
	it('is satisfied when every player move up to the target depth is in the correct set', () => {
		const v = variation(4, 'v1-');
		const correct = new Set(['v1-p1', 'v1-p2', 'v1-p3']);
		expect(isSatisfied(v, 1, correct)).toBe(true); // target depth min(4,3) = 3
		expect(isSatisfied(v, 2, correct)).toBe(false); // target depth min(4,6) = 4, p4 missing
	});

	it('a naturally shorter variation is satisfied at every level once its own full length is correct', () => {
		const v = variation(2, 'short-');
		const correct = new Set(['short-p1', 'short-p2']);
		expect(isSatisfied(v, 1, correct)).toBe(true); // target = min(2,3) = 2
		expect(isSatisfied(v, 5, correct)).toBe(true); // target = min(2,15) = 2, still satisfied
	});

	it('a gap anywhere before the target depth breaks satisfaction, even deep into the line', () => {
		const v = variation(4, 'gap-');
		const correct = new Set(['gap-p1', 'gap-p3', 'gap-p4']); // p2 missing
		expect(isSatisfied(v, 2, correct)).toBe(false);
	});
});

describe('shared-prefix moves', () => {
	it('marking a shared prefix move correct satisfies every variation that shares it at that depth', () => {
		const sharedP1 = { moveId: 'shared-p1', isPlayerTurn: true };
		const va = { playerMoveCount: 1, path: [sharedP1] };
		const vb = { playerMoveCount: 1, path: [sharedP1] }; // a different variation sharing the same opening move edge
		const correct = new Set(['shared-p1']);
		expect(isSatisfied(va, 1, correct)).toBe(true);
		expect(isSatisfied(vb, 1, correct)).toBe(true);
	});
});

describe('currentLevel / activeLevel', () => {
	it('currentLevel is 0 and activeLevel is 1 when nothing has been played', () => {
		const v = variation(6, 'a-');
		expect(currentLevel([v], new Set())).toBe(0);
		expect(activeLevel([v], new Set())).toBe(1);
	});

	it('advances as moves are marked correct', () => {
		const v = variation(6, 'b-');
		const correct = new Set(['b-p1', 'b-p2', 'b-p3']);
		expect(currentLevel([v], correct)).toBe(1);
		expect(activeLevel([v], correct)).toBe(2);
	});

	it('is "mastered" once every variation\'s full length is covered', () => {
		const v = variation(4, 'c-');
		const correct = new Set(['c-p1', 'c-p2', 'c-p3', 'c-p4']);
		expect(activeLevel([v], correct)).toBe('mastered');
	});

	it('is "mastered" for an empty variation list', () => {
		expect(currentLevel([], new Set())).toBe(0);
		expect(activeLevel([], new Set())).toBe('mastered');
	});

	it('a satisfied short variation never blocks a longer one from progressing', () => {
		const short = variation(2, 'short2-');
		const long = variation(6, 'long2-');
		const correct = new Set([
			'short2-p1',
			'short2-p2',
			'long2-p1',
			'long2-p2',
			'long2-p3'
		]);
		expect(currentLevel([short, long], correct)).toBe(1);
		expect(activeLevel([short, long], correct)).toBe(2);
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd mychess && npx vitest run src/lib/mastery/levels.test.ts`
Expected: FAIL — `isSatisfied`/`currentLevel`/`activeLevel` still expect `(variation, level, deepestReached: number)`, not a `Set`; type/behavior mismatches cause failures.

- [ ] **Step 3: Implement the rewrite**

```ts
// mychess/src/lib/mastery/levels.ts
/**
 * Levels are uniform 3-move chunks with no fixed ceiling: L*n* covers the
 * player's own moves 1 through 3*n*. Replaces the old {4,6,8,10,∞} scheme.
 */
export type Level = number;

type VariationLike = {
	playerMoveCount: number;
	path: { moveId: string; isPlayerTurn: boolean }[];
};

export function levelDepth(level: Level): number {
	return level * 3;
}

/** The depth this variation must reach at this level — capped by its own natural length. */
export function targetDepth(variation: { playerMoveCount: number }, level: Level): number {
	return Math.min(variation.playerMoveCount, levelDepth(level));
}

/**
 * A variation is satisfied at `level` when every one of the player's own
 * moves along its path, up to `targetDepth`, has a 'correct' entry in
 * `correctMoveIds` — the Set of move ids the player has ever played
 * correctly (built from `move_progress` by `src/lib/mastery/moveProgress.ts`).
 * Unlike the old stored-depth-number model, this can have "gaps": a move
 * later in the line can be correct while an earlier one in the same
 * variation is still 'new' (e.g. marked via a shared prefix from a
 * different variation, or via Master mode) — so every move up to the target
 * depth is checked individually, not just a single frontier number.
 */
export function isSatisfied(variation: VariationLike, level: Level, correctMoveIds: Set<string>): boolean {
	const target = targetDepth(variation, level);
	let playerMovesSeen = 0;
	for (const step of variation.path) {
		if (!step.isPlayerTurn) continue;
		playerMovesSeen++;
		if (playerMovesSeen > target) break;
		if (!correctMoveIds.has(step.moveId)) return false;
	}
	return true;
}

function maxPlayerMoveCount(variations: VariationLike[]): number {
	return variations.reduce((max, v) => Math.max(max, v.playerMoveCount), 0);
}

/**
 * The highest level where every variation is satisfied, or 0 if none.
 * Target depth is non-decreasing as level increases, so once a level fails
 * to be fully satisfied, no higher level can be either — safe to stop there.
 * The search only needs to go up to the level whose depth covers the
 * longest variation in the repertoire (`cap`) — beyond that, no variation's
 * target depth changes, so no higher level could ever newly satisfy.
 */
export function currentLevel(variations: VariationLike[], correctMoveIds: Set<string>): number {
	const cap = Math.ceil(maxPlayerMoveCount(variations) / 3);
	let level = 0;
	for (let l = 1; l <= cap; l++) {
		if (variations.every((v) => isSatisfied(v, l, correctMoveIds))) {
			level = l;
		} else {
			break;
		}
	}
	return level;
}

/**
 * The level to practice next, or 'mastered' once every variation's full
 * length is covered (equivalently: once `currentLevel` reaches `cap`,
 * including the vacuous case of an empty variation list — nothing to master).
 */
export function activeLevel(variations: VariationLike[], correctMoveIds: Set<string>): Level | 'mastered' {
	const cap = Math.ceil(maxPlayerMoveCount(variations) / 3);
	const level = currentLevel(variations, correctMoveIds);
	return level >= cap ? 'mastered' : level + 1;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd mychess && npx vitest run src/lib/mastery/levels.test.ts`
Expected: PASS (12 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/mastery/levels.ts src/lib/mastery/levels.test.ts
git commit -m "feat: rewrite mastery levels for chunk-of-3, move_progress-backed satisfaction"
git push
```

---

### Task 4: `move_progress` read/derive helper module (pure)

**Files:**
- Create: `src/lib/mastery/moveProgress.ts`
- Test: `src/lib/mastery/moveProgress.test.ts`

**Depends on Task 3.** Note this is a distinct file from Task 6's `src/lib/server/move-progress.ts` — this one is pure (no Supabase calls) and lives under `mastery/` per this codebase's convention of separating pure logic from I/O wrappers; Task 6's is the I/O wrapper that writes to the table this one reads a snapshot of.

- [ ] **Step 1: Write the failing tests**

```ts
// mychess/src/lib/mastery/moveProgress.test.ts
import { describe, it, expect } from 'vitest';
import { correctMoveIdSet, repertoireProgress } from './moveProgress';
import type { Variation } from './variations';

function variation(playerMoveCount: number, prefix: string): Variation {
	const path: Variation['path'] = [];
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

describe('correctMoveIdSet', () => {
	it('builds a Set of only the move ids whose state is correct', () => {
		const rows = [
			{ move_id: 'm1', state: 'correct' },
			{ move_id: 'm2', state: 'new' },
			{ move_id: 'm3', state: 'correct' }
		];
		const set = correctMoveIdSet(rows);
		expect(set.has('m1')).toBe(true);
		expect(set.has('m2')).toBe(false);
		expect(set.has('m3')).toBe(true);
		expect(set.size).toBe(2);
	});

	it('returns an empty Set for no rows', () => {
		expect(correctMoveIdSet([]).size).toBe(0);
	});
});

describe('repertoireProgress', () => {
	it('computes level, satisfiedCount, and totalVariations from raw rows for a partially-progressed repertoire', () => {
		const a = variation(3, 'a-');
		const b = variation(6, 'b-');
		const rows = [
			{ move_id: 'a-p1', state: 'correct' },
			{ move_id: 'a-p2', state: 'correct' },
			{ move_id: 'a-p3', state: 'correct' },
			{ move_id: 'b-p1', state: 'correct' },
			{ move_id: 'b-p2', state: 'correct' },
			{ move_id: 'b-p3', state: 'correct' }
		];
		const progress = repertoireProgress([a, b], rows);
		expect(progress.totalVariations).toBe(2);
		expect(progress.level).toBe(2); // both satisfied at level 1 (depth 3); a is done, b needs level 2's depth 6
		expect(progress.satisfiedCount).toBe(1); // only `a` (fully covered) is satisfied at the active level 2
	});

	it('reports every variation as satisfied once the repertoire is mastered', () => {
		const a = variation(2, 'x-');
		const rows = [
			{ move_id: 'x-p1', state: 'correct' },
			{ move_id: 'x-p2', state: 'correct' }
		];
		const progress = repertoireProgress([a], rows);
		expect(progress.level).toBe('mastered');
		expect(progress.satisfiedCount).toBe(1);
		expect(progress.totalVariations).toBe(1);
	});

	it('handles a repertoire with no variations yet', () => {
		const progress = repertoireProgress([], []);
		expect(progress.level).toBe('mastered');
		expect(progress.satisfiedCount).toBe(0);
		expect(progress.totalVariations).toBe(0);
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd mychess && npx vitest run src/lib/mastery/moveProgress.test.ts`
Expected: FAIL — `./moveProgress` has no exported members (module doesn't exist yet).

- [ ] **Step 3: Implement**

```ts
// mychess/src/lib/mastery/moveProgress.ts
import type { Variation } from './variations';
import { activeLevel, isSatisfied, type Level } from './levels';

export type MoveProgressRow = { move_id: string; state: string };

/** Builds the Set of move ids the player has ever played correctly, from raw `move_progress` rows. */
export function correctMoveIdSet(rows: MoveProgressRow[]): Set<string> {
	return new Set(rows.filter((r) => r.state === 'correct').map((r) => r.move_id));
}

export type RepertoireProgress = {
	level: Level | 'mastered';
	satisfiedCount: number;
	totalVariations: number;
};

/**
 * Combines a repertoire's enumerated variations with its raw `move_progress`
 * rows into the summary both `/practice` (the picker) and
 * `/practice/[repertoire_id]` (the detail screen) need: the active level (or
 * "mastered"), and how many variations are already satisfied at that level.
 */
export function repertoireProgress(variations: Variation[], rows: MoveProgressRow[]): RepertoireProgress {
	const correctMoveIds = correctMoveIdSet(rows);
	const level = activeLevel(variations, correctMoveIds);
	const satisfiedCount =
		level === 'mastered'
			? variations.length
			: variations.filter((v) => isSatisfied(v, level, correctMoveIds)).length;
	return { level, satisfiedCount, totalVariations: variations.length };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd mychess && npx vitest run src/lib/mastery/moveProgress.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/mastery/moveProgress.ts src/lib/mastery/moveProgress.test.ts
git commit -m "feat: add move_progress read/derive helpers for repertoire level summaries"
git push
```

---

### Task 5: Rewrite `practice.ts` for deterministic auto-play boundary

**Files:**
- Modify: `src/lib/mastery/practice.ts`
- Modify: `src/lib/mastery/practice.test.ts`

**Depends on Task 3** (`levelDepth`, `isSatisfied`, `targetDepth`).

- [ ] **Step 1: Replace the test file with deterministic-boundary tests**

```ts
// mychess/src/lib/mastery/practice.test.ts
import { describe, it, expect } from 'vitest';
import { pickPracticeAttempt, splitAttempt } from './practice';
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

describe('pickPracticeAttempt', () => {
	it('returns null when every variation is already satisfied at the level', () => {
		const v = makeVariation(3, 'done-');
		const correct = new Set(['done-p1', 'done-p2', 'done-p3']);
		expect(pickPracticeAttempt([v], 1, correct)).toBeNull();
	});

	it('picks a not-yet-satisfied variation and computes its target depth', () => {
		const v = makeVariation(10, 'leaf1-');
		const result = pickPracticeAttempt([v], 2, new Set(), () => 0.5); // deterministic "random"
		expect(result).not.toBeNull();
		expect(result!.variation.leafMoveId).toBe(v.leafMoveId);
		expect(result!.targetDepth).toBe(6); // level 2 depth
	});

	it('never picks a variation that is already satisfied, even if others are not', () => {
		const done = makeVariation(3, 'done-');
		const notDone = makeVariation(10, 'notdone-');
		const correct = new Set(['done-p1', 'done-p2', 'done-p3']);
		// random() always returns 0 -> would pick index 0 if `done` were a candidate
		const result = pickPracticeAttempt([done, notDone], 1, correct, () => 0);
		expect(result!.variation.leafMoveId).toBe(notDone.leafMoveId);
	});
});

describe('splitAttempt', () => {
	it('at level 1, auto-plays nothing and quizzes through the 3rd player move', () => {
		const v = makeVariation(4, 'x-');
		const { prefix, quizSteps } = splitAttempt(v.path, 1, 3);
		expect(prefix).toHaveLength(0);
		expect(quizSteps).toHaveLength(5); // p1,o1,p2,o2,p3
		expect(quizSteps[quizSteps.length - 1].moveId).toBe('x-p3');
		expect(quizSteps[quizSteps.length - 1].isPlayerTurn).toBe(true);
	});

	it('at level 2, auto-plays through the 3rd player move (both colors) and the player starts on the 4th', () => {
		const v = makeVariation(6, 'y-');
		const { prefix, quizSteps } = splitAttempt(v.path, 2, 6);
		expect(prefix.map((s) => s.moveId)).toEqual(['y-p1', 'y-o1', 'y-p2', 'y-o2', 'y-p3', 'y-o3']);
		expect(quizSteps[0].moveId).toBe('y-p4');
		expect(quizSteps[0].isPlayerTurn).toBe(true);
	});

	it("collapses to the variation's own length when shorter than the level depth", () => {
		const v = makeVariation(2, 'z-');
		const { prefix, quizSteps } = splitAttempt(v.path, 1, 2); // targetDepth = min(2,3) = 2
		expect(prefix).toHaveLength(0);
		expect(quizSteps[quizSteps.length - 1].moveId).toBe('z-p2');
	});

	it("throws when the level's auto-play boundary is not below the target depth", () => {
		const v = makeVariation(3, 'w-');
		expect(() => splitAttempt(v.path, 1, 3)).not.toThrow(); // sanity: a valid case at level 1
		// At level 2 the auto-play boundary (3) is not below a target depth of 3 —
		// this variation has no interactive room left at level 2 and should never
		// have been picked by pickPracticeAttempt in the first place.
		expect(() => splitAttempt(v.path, 2, 3)).toThrow();
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd mychess && npx vitest run src/lib/mastery/practice.test.ts`
Expected: FAIL — `pickPracticeAttempt`'s current signature takes a `deepestReached`-carrying variation array, not a separate `correctMoveIds: Set<string>` argument; `splitAttempt`'s current signature takes an explicit random `startPoint`, not a `level`.

- [ ] **Step 3: Implement the rewrite**

```ts
// mychess/src/lib/mastery/practice.ts
import type { Variation, VariationStep } from './variations';
import { isSatisfied, targetDepth, levelDepth, type Level } from './levels';

export type PracticeAttempt = {
	variation: Variation;
	targetDepth: number;
};

/**
 * Picks a random not-yet-satisfied variation at `level` (a variation with at
 * least one 'new' move in the level's range). Returns null once every
 * variation is already satisfied at this level (the repertoire should be
 * promoted to the next level, or "mastered").
 */
export function pickPracticeAttempt(
	variations: Variation[],
	level: Level,
	correctMoveIds: Set<string>,
	random: () => number = Math.random
): PracticeAttempt | null {
	const candidates = variations.filter((v) => !isSatisfied(v, level, correctMoveIds));
	if (candidates.length === 0) return null;

	const chosen = candidates[Math.floor(random() * candidates.length)];
	return { variation: chosen, targetDepth: targetDepth(chosen, level) };
}

/**
 * Splits a variation's path into the auto-played `prefix` and the `quizSteps`
 * the player walks through interactively. The auto-play boundary is
 * DETERMINISTIC (not the old random-start-point mechanic): at active level
 * *n*, every move up through 3(n-1) is auto-played (book line, both colors),
 * and the player picks up interactively at move 3(n-1)+1 — e.g. at Level 2,
 * moves 1-3 auto-play and the player starts on move 4. `quizSteps` stops
 * right after the `targetDepthValue`-th player move.
 */
export function splitAttempt(
	path: VariationStep[],
	level: Level,
	targetDepthValue: number
): { prefix: VariationStep[]; quizSteps: VariationStep[] } {
	const playerIndices: number[] = [];
	path.forEach((step, i) => {
		if (step.isPlayerTurn) playerIndices.push(i);
	});

	const startPoint = levelDepth(level - 1); // moves 1..3(n-1) are already known/auto-played
	const nextPlayerIdx = playerIndices[startPoint];
	const targetPlayerIdx = playerIndices[targetDepthValue - 1];

	if (nextPlayerIdx === undefined || targetPlayerIdx === undefined || startPoint >= targetDepthValue) {
		throw new Error(
			`splitAttempt: level ${level} (auto-play boundary ${startPoint}) and targetDepthValue (${targetDepthValue}) are inconsistent with the given path (${playerIndices.length} player moves found)`
		);
	}

	return {
		prefix: path.slice(0, nextPlayerIdx),
		quizSteps: path.slice(nextPlayerIdx, targetPlayerIdx + 1)
	};
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd mychess && npx vitest run src/lib/mastery/practice.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/mastery/practice.ts src/lib/mastery/practice.test.ts
git commit -m "feat: make practice attempt selection use a deterministic auto-play boundary"
git push
```

---

### Task 6: Shared `move_progress` write helper

**Files:**
- Create: `src/lib/server/move-progress.ts`

**Depends on Task 1** (the table it writes to). Not unit-tested — thin Supabase I/O wrapper, matches this codebase's established convention for `src/lib/server/*` modules. Both Task 7 (Practice) and Task 19 (Master) call this helper — it's the one shared write path both modes use to flip a move to `'correct'`.

- [ ] **Step 1: Implement**

```ts
// mychess/src/lib/server/move-progress.ts
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Flips a move's `move_progress` row to `'correct'` (idempotent — calling
 * this again on an already-correct move is a no-op past the first time).
 * Returns whether it was ALREADY `'correct'` before this call, so callers
 * that award XP only on the new -> correct transition (Practice, Task 7) can
 * skip re-awarding it, while callers that don't need that distinction
 * (Master, Task 19, which awards its own flat per-move XP client-side) can
 * simply ignore the return value.
 */
export async function markMoveCorrect(
	supabase: SupabaseClient,
	playerId: string,
	moveId: string
): Promise<{ alreadyCorrect: boolean }> {
	const { data: existing } = await supabase
		.from('move_progress')
		.select('state')
		.eq('player_id', playerId)
		.eq('move_id', moveId)
		.maybeSingle();

	const alreadyCorrect = existing?.state === 'correct';

	await supabase
		.from('move_progress')
		.upsert({ player_id: playerId, move_id: moveId, state: 'correct' }, { onConflict: 'player_id,move_id' });

	return { alreadyCorrect };
}
```

- [ ] **Step 2: Type-check**

Run: `cd mychess && npm run check`
Expected: no new errors beyond the known baseline.

- [ ] **Step 3: Commit**

```bash
cd mychess && git add src/lib/server/move-progress.ts && git commit -m "feat: add shared move_progress write helper used by Practice and Master"
```

---

### Task 7: Per-move progress-submission API endpoint (Practice, XP-per-move)

**Files:**
- Create: `src/routes/api/practice/move-progress/+server.ts`

**Depends on Task 6** (calls `markMoveCorrect`). Not unit-tested — thin Supabase I/O wrapper, matches this codebase's convention (this replaces the old per-attempt/batch `src/routes/api/mastery/progress/+server.ts` with a per-move model).

- [ ] **Step 1: Implement**

```ts
// mychess/src/routes/api/practice/move-progress/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { xpForReview } from '$lib/srs/xp';
import { markMoveCorrect } from '$lib/server/move-progress';

/**
 * Called the instant a move is played CORRECTLY (in Practice's interactive
 * range) — grading is per-move, not per-attempt. A move flips 'new' ->
 * 'correct' immediately and stays that way; XP is awarded only on the
 * transition itself (xpForReview(true, false) once per move that newly
 * becomes 'correct') — replaying an already-solved move (e.g. re-quizzing a
 * shared prefix from a later attempt) earns no further XP.
 */
export const POST: RequestHandler = async ({ request, locals: { supabase, safeGetSession } }) => {
	const { user } = await safeGetSession();
	if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

	const { moveId } = await request.json();
	if (!moveId || typeof moveId !== 'string') {
		return json({ error: 'Invalid request' }, { status: 400 });
	}

	const { alreadyCorrect } = await markMoveCorrect(supabase, user.id, moveId);

	const xpAwarded = alreadyCorrect ? 0 : xpForReview(true, false);
	if (xpAwarded > 0) {
		const { error: rpcError } = await supabase.rpc('update_xp_and_level', {
			p_player_id: user.id,
			p_xp_delta: xpAwarded
		});
		if (rpcError) return json({ error: rpcError.message }, { status: 500 });
	}

	return json({ xpAwarded });
};
```

- [ ] **Step 2: Run the full test suite and type-check**

Run: `cd mychess && npx vitest run && npm run check`
Expected: all tests pass; `svelte-check` error count unchanged from the known baseline (12 errors, all in `src/routes/auth/**`).

- [ ] **Step 3: Commit**

```bash
git add src/routes/api/practice/move-progress/+server.ts
git commit -m "feat: add per-move practice progress endpoint with per-move XP"
git push
```

---

### Task 8: Practice detail page server load

**Files:**
- Create: `src/routes/(player)/practice/[repertoire_id]/+page.server.ts`

**Depends on Tasks 3, 4, 5.**

- [ ] **Step 1: Implement**

```ts
// mychess/src/routes/(player)/practice/[repertoire_id]/+page.server.ts
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { requireAccount } from '$lib/server/auth';
import { mergeRepertoireIds } from '$lib/repertoire';
import { enumerateVariations, type RawMoveRow } from '$lib/mastery/variations';
import { correctMoveIdSet, repertoireProgress } from '$lib/mastery/moveProgress';
import { pickPracticeAttempt, splitAttempt } from '$lib/mastery/practice';

export const load: PageServerLoad = async ({ params, locals }) => {
	const { user } = await requireAccount(locals);
	const supabase = locals.supabase;
	const repertoireId = params.repertoire_id;

	const [{ data: ownReps }, { data: assigned }] = await Promise.all([
		supabase.from('repertoires').select('id').eq('player_id', user!.id),
		supabase.from('assigned_repertoires').select('repertoire_id').eq('player_id', user!.id)
	]);
	const allowedIds = mergeRepertoireIds(
		ownReps?.map((r) => r.id) ?? [],
		assigned?.map((a) => a.repertoire_id) ?? []
	);
	if (!allowedIds.includes(repertoireId)) {
		throw error(404, 'Repertoire not found');
	}

	const [{ data: repertoire }, { data: rawMoves }] = await Promise.all([
		supabase.from('repertoires').select('id, name, color').eq('id', repertoireId).single(),
		supabase
			.from('moves')
			.select(
				'id, san, is_player_turn, from_position, to_position, from_pos:from_position(fen), to_pos:to_position(fen)'
			)
			.eq('repertoire_id', repertoireId)
	]);

	if (!repertoire) {
		throw error(404, 'Repertoire not found');
	}

	const moves: RawMoveRow[] = (rawMoves ?? []).map((m: any) => ({
		id: m.id,
		san: m.san,
		isPlayerTurn: m.is_player_turn,
		fromPositionId: m.from_position,
		toPositionId: m.to_position,
		fromFen: m.from_pos?.fen ?? '',
		toFen: m.to_pos?.fen ?? ''
	}));

	const variations = enumerateVariations(moves);

	const moveIds = moves.map((m) => m.id);
	const { data: progressRows } = moveIds.length
		? await supabase
				.from('move_progress')
				.select('move_id, state')
				.eq('player_id', user!.id)
				.in('move_id', moveIds)
		: { data: [] as { move_id: string; state: string }[] };

	const { level, satisfiedCount, totalVariations } = repertoireProgress(variations, progressRows ?? []);
	const correctMoveIds = correctMoveIdSet(progressRows ?? []);

	let attempt: {
		prefix: ReturnType<typeof splitAttempt>['prefix'];
		quizSteps: ReturnType<typeof splitAttempt>['quizSteps'];
	} | null = null;

	if (level !== 'mastered') {
		const picked = pickPracticeAttempt(variations, level, correctMoveIds);
		if (picked) {
			const { prefix, quizSteps } = splitAttempt(picked.variation.path, level, picked.targetDepth);
			attempt = { prefix, quizSteps };
		}
	}

	return { repertoire, level, totalVariations, satisfiedCount, attempt };
};
```

- [ ] **Step 2: Run the full test suite and type-check**

Run: `cd mychess && npx vitest run && npm run check`
Expected: all tests pass (no dedicated test for this file — matches the established convention for Supabase-touching page loaders); `svelte-check` error count unchanged from baseline.

- [ ] **Step 3: Commit**

```bash
git add "src/routes/(player)/practice/[repertoire_id]/+page.server.ts"
git commit -m "feat: add practice detail page server load"
git push
```

---

### Task 9: Practice detail page UI

**Files:**
- Create: `src/routes/(player)/practice/[repertoire_id]/+page.svelte`
- Test: `src/routes/(player)/practice/[repertoire_id]/practice.test.ts`

**Depends on Task 8**, and reuses `ChessBoard.svelte`, `$lib/sounds`, `$app/navigation`. No Stockfish/engine feedback here — that's Master-only, per the design spec.

- [ ] **Step 1: Write the failing component test**

```ts
// mychess/src/routes/(player)/practice/[repertoire_id]/practice.test.ts
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import Practice from './+page.svelte';

afterEach(() => cleanup());

describe('practice detail page', () => {
	it('shows "nothing to practice" rather than "mastered" when the repertoire has no moves yet', () => {
		render(Practice, {
			props: {
				data: {
					repertoire: { id: 'r1', name: 'Empty Repertoire', color: 'white' },
					level: 'mastered',
					totalVariations: 0,
					satisfiedCount: 0,
					attempt: null
				}
			}
		});
		expect(screen.queryByText(/Repertoire Mastered/i)).toBeNull();
		expect(screen.getByText(/Nothing to practice/i)).toBeTruthy();
	});

	it('shows the mastered screen once every real variation is actually solved', () => {
		render(Practice, {
			props: {
				data: {
					repertoire: { id: 'r1', name: 'French Defense', color: 'white' },
					level: 'mastered',
					totalVariations: 5,
					satisfiedCount: 5,
					attempt: null
				}
			}
		});
		expect(screen.getByText(/Repertoire Mastered/i)).toBeTruthy();
	});

	it('shows the current level and progress while an attempt is in flight', () => {
		render(Practice, {
			props: {
				data: {
					repertoire: { id: 'r1', name: 'French Defense', color: 'white' },
					level: 2,
					totalVariations: 5,
					satisfiedCount: 3,
					attempt: {
						prefix: [
							{ moveId: 'm1', san: 'e4', fromFen: 'fenA', toFen: 'fenB', isPlayerTurn: true },
							{ moveId: 'm2', san: 'e5', fromFen: 'fenB', toFen: 'fenC', isPlayerTurn: false }
						],
						quizSteps: [
							{ moveId: 'm3', san: 'Nf3', fromFen: 'fenC', toFen: 'fenD', isPlayerTurn: true }
						]
					}
				}
			}
		});
		expect(screen.getByText(/Level 2/i)).toBeTruthy();
		expect(screen.getByText(/3\/5 solved/i)).toBeTruthy();
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd mychess && npx vitest run "src/routes/(player)/practice/[repertoire_id]/practice.test.ts"`
Expected: FAIL — `./+page.svelte` doesn't exist yet.

- [ ] **Step 3: Implement**

```svelte
<!-- mychess/src/routes/(player)/practice/[repertoire_id]/+page.svelte -->
<script lang="ts">
  import ChessBoard from '$lib/components/ChessBoard.svelte';
  import type { Key } from 'chessground/types';
  import { playCorrect, playWrong } from '$lib/sounds';
  import { invalidateAll } from '$app/navigation';
  import { untrack } from 'svelte';

  let { data } = $props<{ data: any }>();

  let quizIdx = $state(0);
  let boardFen = $state('');
  let phase = $state<'playing' | 'wrong' | 'success'>('playing');
  let wrongBookSan = $state('');
  let sessionXp = $state(0);

  const attempt = $derived(data.attempt);

  function advanceThroughOpponentReplies() {
    while (attempt?.quizSteps[quizIdx] && !attempt.quizSteps[quizIdx].isPlayerTurn) {
      boardFen = attempt.quizSteps[quizIdx].toFen;
      quizIdx++;
    }
  }

  function resetForAttempt() {
    quizIdx = 0;
    phase = 'playing';
    wrongBookSan = '';
    if (attempt) {
      boardFen =
        attempt.prefix.length > 0
          ? attempt.prefix[attempt.prefix.length - 1].toFen
          : (attempt.quizSteps[0]?.fromFen ?? '');
      advanceThroughOpponentReplies();
    }
  }

  // Set the board's initial position synchronously, before ChessBoard's own
  // onMount runs — it throws on an empty FEN, and a child's onMount fires
  // before this component's own $effect does, so waiting for the effect
  // below to set boardFen for the first time is too late.
  resetForAttempt();

  // `attempt` must be the ONLY tracked dependency here — resetForAttempt()
  // also reads `quizIdx`, and Svelte's automatic dependency tracking would
  // otherwise subscribe this effect to it too, meaning handleMove's
  // quizIdx++ on every correct move would re-trigger a full reset. untrack()
  // prevents that.
  $effect(() => {
    attempt;
    untrack(() => resetForAttempt());
  });

  function handleMove(detail: { from: Key; to: Key; san: string }) {
    if (phase !== 'playing') return false;
    const step = attempt?.quizSteps[quizIdx];
    if (!step) return false;

    if (detail.san === step.san) {
      playCorrect();
      boardFen = step.toFen;
      quizIdx++;
      // Grading is instant and per-move: persist + award XP for this exact
      // move the moment it's played, independent of whether the rest of the
      // attempt succeeds.
      submitMoveProgress(step.moveId);
      advanceThroughOpponentReplies();
      if (quizIdx >= attempt.quizSteps.length) {
        phase = 'success';
      }
      return true;
    } else {
      playWrong();
      wrongBookSan = step.san;
      phase = 'wrong';
      return false;
    }
  }

  async function submitMoveProgress(moveId: string) {
    try {
      const res = await fetch('/api/practice/move-progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ moveId })
      });
      const result = await res.json();
      sessionXp += result.xpAwarded ?? 0;
    } catch {
      // Progress submission failed — the move itself already played
      // correctly on the board; just skip the XP bump silently rather than
      // blocking the player on a network hiccup.
    }
  }

  async function nextAttempt() {
    await invalidateAll();
  }
</script>

<svelte:head>
  <title>Practice {data.repertoire?.name ?? 'Repertoire'} — MyChess</title>
</svelte:head>

<main class="min-h-screen bg-gray-50 p-4 max-w-3xl mx-auto pb-24">
  <div class="flex items-center justify-between mb-4">
    <a href="/practice" class="text-gray-400 text-sm hover:text-gray-600">← All Repertoires</a>
    <span class="text-indigo-600 font-bold text-sm">+{sessionXp} XP</span>
  </div>

  {#if data.level === 'mastered' && data.totalVariations > 0}
    <div class="flex flex-col items-center justify-center min-h-screen gap-6 text-center">
      <p class="text-7xl">🏆</p>
      <h1 class="text-3xl font-bold text-gray-900">Repertoire Mastered!</h1>
      <p class="text-gray-500">Every variation in {data.repertoire?.name} is fully learned.</p>
      <a href="/practice" class="bg-indigo-600 text-white px-8 py-4 rounded-2xl font-bold text-lg hover:bg-indigo-700 transition">
        Back to Repertoires
      </a>
    </div>
  {:else if !attempt}
    <div class="flex flex-col items-center justify-center min-h-screen text-center gap-4">
      <p class="text-5xl">📭</p>
      <h1 class="text-2xl font-bold text-gray-700">Nothing to practice</h1>
      <p class="text-gray-400">This repertoire has no moves for your color yet.</p>
      <a href="/practice" class="text-indigo-600 hover:underline">Back to Repertoires</a>
    </div>
  {:else}
    <p class="text-center text-gray-400 text-sm font-medium mb-2">
      {data.repertoire?.name} · Level {data.level} · {data.satisfiedCount}/{data.totalVariations} solved
    </p>
    <p class="text-center text-gray-700 font-semibold mb-4">
      {phase === 'playing' ? 'What is the best move?' : ''}
    </p>

    <ChessBoard fen={boardFen} interactable={phase === 'playing'} onmove={handleMove} prefs={data.boardPrefs} />

    {#if phase === 'wrong'}
      <div class="mt-6 p-5 bg-white border border-gray-200 rounded-2xl text-center shadow-sm">
        <p class="text-xl font-bold mb-1 text-gray-700">Not quite — the book move was {wrongBookSan}</p>
        <button onclick={nextAttempt}
                class="mt-4 w-full bg-indigo-600 text-white py-4 rounded-xl font-bold text-lg hover:bg-indigo-700 transition">
          Continue
        </button>
      </div>
    {:else if phase === 'success'}
      <div class="mt-6 p-5 bg-white border border-gray-200 rounded-2xl text-center shadow-sm">
        <p class="text-xl font-bold mb-1 text-green-600">✅ Solved!</p>
        <button onclick={nextAttempt}
                class="mt-4 w-full bg-indigo-600 text-white py-4 rounded-xl font-bold text-lg hover:bg-indigo-700 transition">
          Continue
        </button>
      </div>
    {/if}
  {/if}
</main>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd mychess && npx vitest run "src/routes/(player)/practice/[repertoire_id]/practice.test.ts"`
Expected: PASS (3 tests)

- [ ] **Step 5: Run the full test suite and type-check**

Run: `cd mychess && npx vitest run && npm run check`
Expected: all tests pass; `svelte-check` error count unchanged from baseline.

- [ ] **Step 6: Manual browser check**

There's no automated test for the interactive board flow. Verify manually: open `/practice/<a-repertoire-id-you-own-or-are-assigned>`, confirm the board shows the correct deterministic auto-played prefix for the active level (e.g. at Level 2, moves 1-3 auto-play and you're prompted on move 4), play correctly through to "Solved!" and confirm `+XP` increments and "Continue" loads a fresh attempt, then deliberately play a wrong move and confirm the book move is revealed and "Continue" moves on without having saved that move's progress.

- [ ] **Step 7: Commit**

```bash
git add "src/routes/(player)/practice/[repertoire_id]/+page.svelte" "src/routes/(player)/practice/[repertoire_id]/practice.test.ts"
git commit -m "feat: add practice detail page UI with per-move grading"
git push
```

---

### Task 10: Practice repertoire picker page (replacing the old flat quiz)

**Files:**
- Modify: `src/routes/(player)/practice/+page.server.ts` (full rewrite — deletes the old flat unfiltered-quiz loader)
- Modify: `src/routes/(player)/practice/+page.svelte` (full rewrite — deletes the old flat unfiltered-quiz UI)

**Depends on Tasks 3, 4.**

- [ ] **Step 1: Rewrite the server load**

```ts
// mychess/src/routes/(player)/practice/+page.server.ts
import type { PageServerLoad } from './$types';
import { requireAccount } from '$lib/server/auth';
import { enumerateVariations, type RawMoveRow } from '$lib/mastery/variations';
import { repertoireProgress, type MoveProgressRow } from '$lib/mastery/moveProgress';

export const load: PageServerLoad = async ({ locals }) => {
	const { user } = await requireAccount(locals);
	const supabase = locals.supabase;

	const [{ data: ownReps }, { data: assigned }] = await Promise.all([
		supabase.from('repertoires').select('id, name, color').eq('player_id', user!.id),
		supabase
			.from('assigned_repertoires')
			.select('repertoire:repertoire_id(id, name, color)')
			.eq('player_id', user!.id)
	]);

	const assignedReps = (assigned ?? []).map((a: any) => a.repertoire).filter(Boolean);
	const seen = new Set((ownReps ?? []).map((r: any) => r.id));
	const allReps = [...(ownReps ?? []), ...assignedReps.filter((r: any) => !seen.has(r.id))];

	if (allReps.length === 0) {
		return { repertoires: [] };
	}

	const repIds = allReps.map((r: any) => r.id);
	const { data: rawMoves } = await supabase
		.from('moves')
		.select('id, san, is_player_turn, repertoire_id, from_position, to_position')
		.in('repertoire_id', repIds);

	// This page only needs level/satisfiedCount/totalVariations, all derived
	// purely from moveId/isPlayerTurn — never from FEN — so the fen columns
	// aren't fetched here (unlike the [repertoire_id] detail page, which needs
	// them to render the board).
	const movesByRep = new Map<string, RawMoveRow[]>();
	for (const m of (rawMoves ?? []) as any[]) {
		const list = movesByRep.get(m.repertoire_id) ?? [];
		list.push({
			id: m.id,
			san: m.san,
			isPlayerTurn: m.is_player_turn,
			fromPositionId: m.from_position,
			toPositionId: m.to_position,
			fromFen: '',
			toFen: ''
		});
		movesByRep.set(m.repertoire_id, list);
	}

	const allMoveIds = (rawMoves ?? []).map((m: any) => m.id);
	const { data: progressRows } = allMoveIds.length
		? await supabase
				.from('move_progress')
				.select('move_id, state')
				.eq('player_id', user!.id)
				.in('move_id', allMoveIds)
		: { data: [] as MoveProgressRow[] };

	const repertoires = allReps.map((r: any) => {
		const variations = enumerateVariations(movesByRep.get(r.id) ?? []);
		// `progressRows` spans every repertoire's move ids at once (one query),
		// but repertoireProgress only ever looks up ids that appear in this
		// repertoire's own `variations`, so passing the full set is harmless —
		// no need to pre-split it per repertoire.
		const progress = repertoireProgress(variations, progressRows ?? []);
		return { id: r.id, name: r.name, color: r.color, ...progress };
	});

	return { repertoires };
};
```

- [ ] **Step 2: Rewrite the picker UI**

```svelte
<!-- mychess/src/routes/(player)/practice/+page.svelte -->
<script lang="ts">
  let { data } = $props<{ data: { repertoires: any[] } }>();
</script>

<svelte:head>
  <title>Practice Your Repertoires — MyChess</title>
</svelte:head>

<main class="min-h-screen bg-gray-50">
  <div class="max-w-2xl mx-auto px-4 py-6">
    <h1 class="text-2xl font-bold text-gray-900 mb-4">Practice Your Repertoires</h1>

    {#if data.repertoires.length === 0}
      <div class="text-center py-16 text-gray-400">
        <p class="text-4xl mb-4">📚</p>
        <p class="font-semibold text-lg text-gray-500">No repertoires yet</p>
        <p class="text-sm mt-1">Ask your coach to assign one, or create your own.</p>
      </div>
    {:else}
      <ul class="space-y-2">
        {#each data.repertoires as rep}
          <li>
            <a href="/practice/{rep.id}"
               class="flex items-center gap-3 bg-white rounded-xl border border-gray-200 shadow-sm p-4 hover:shadow-md transition-shadow">
              <span class="w-3 h-3 rounded-full shrink-0" style="background:{rep.color === 'black' ? '#1f2937' : '#e5e7eb'}"></span>
              <div class="flex-1 min-w-0">
                <h2 class="font-medium text-gray-900 truncate">{rep.name}</h2>
                <p class="text-sm text-gray-400">
                  {#if rep.totalVariations === 0}
                    No moves yet
                  {:else if rep.level === 'mastered'}
                    🏆 Mastered
                  {:else}
                    Level {rep.level} · {rep.satisfiedCount}/{rep.totalVariations} solved
                  {/if}
                </p>
              </div>
              <span class="text-gray-400 text-sm">→</span>
            </a>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</main>
```

- [ ] **Step 3: Run the full test suite and type-check**

Run: `cd mychess && npx vitest run && npm run check`
Expected: all tests pass; `svelte-check` error count unchanged from baseline.

- [ ] **Step 4: Manual browser check**

Verify manually: `/practice` lists the player's own + coach-assigned repertoires with a level/progress summary (e.g. "Level 2 · 3/5 solved"); tapping one opens `/practice/[repertoire_id]`.

- [ ] **Step 5: Commit**

```bash
git add "src/routes/(player)/practice/+page.server.ts" "src/routes/(player)/practice/+page.svelte"
git commit -m "feat: replace the flat unfiltered Practice quiz with the leveled per-repertoire picker"
git push
```

---

### Task 11: Interim verification — Practice + migration scope

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `cd mychess && npx vitest run`
Expected: 0 failures.

- [ ] **Step 2: Run the type-check**

Run: `cd mychess && npm run check`
Expected: error count unchanged from the known 12-error baseline (all in `src/routes/auth/**`), no new errors.

- [ ] **Step 3: Grep for any remaining references to the deleted old-mastery API/route**

Run: `cd mychess && grep -rn "api/mastery\|master/\[repertoire_id\]" src/ --include="*.ts" --include="*.svelte"`
Expected: no matches from Practice's own code (a hit inside `NavBar.svelte` pointing a plain `href="/master"` link is expected and handled later, in Task 22).

- [ ] **Step 4: Manual browser check**

Confirm end-to-end: `/practice` lists repertoires with a level/progress summary; opening one starts a practice attempt with the deterministic auto-play boundary for the active level; solving all of a level's variations promotes the repertoire to the next level; a coach-assigned repertoire (from a different player account, if available) shows up in the assigned player's `/practice` list exactly like an owned one; a move marked correct in this flow is confirmed (via a `move_progress` read query, or simply by revisiting the page) to persist across a page reload.

- [ ] **Step 5: Remind the user about the pending migration**

If not already confirmed, remind the user to apply `supabase/migrations/0025_move_progress.sql` via the Supabase SQL editor — without it, `/api/practice/move-progress` and both `/practice` pages' progress queries will fail with a missing-table error.

---

### Task 12: Book-move matching helpers in `src/lib/repertoire.ts`

**Files:**
- Modify: `mychess/src/lib/repertoire.ts`
- Modify: `mychess/src/lib/repertoire.test.ts`

`mergeRepertoireIds` already exists in this file (used by Task 8) — this task only adds new exports alongside it.

- [ ] **Step 1: Write failing tests for `buildBookMoveMap`, `isBookMove`, `findBookMove`**

Append to `mychess/src/lib/repertoire.test.ts` (keep the existing `mergeRepertoireIds` describe block above untouched):

```ts
import { describe, it, expect } from 'vitest';
import { mergeRepertoireIds, buildBookMoveMap, isBookMove, findBookMove } from './repertoire';

describe('buildBookMoveMap', () => {
	it('groups moves by from_position', () => {
		const map = buildBookMoveMap([
			{ id: 'm1', from_position: 'p1', san: 'Nf3' },
			{ id: 'm2', from_position: 'p1', san: 'Bc4' },
			{ id: 'm3', from_position: 'p2', san: 'e5' }
		]);
		expect(map.p1).toEqual([
			{ id: 'm1', san: 'Nf3' },
			{ id: 'm2', san: 'Bc4' }
		]);
		expect(map.p2).toEqual([{ id: 'm3', san: 'e5' }]);
	});

	it('returns an empty map for no rows', () => {
		expect(buildBookMoveMap([])).toEqual({});
	});
});

describe('isBookMove', () => {
	const entries = [
		{ id: 'm1', san: 'Nf3' },
		{ id: 'm2', san: 'Bc4' }
	];

	it('matches any book alternative, not just the first', () => {
		expect(isBookMove(entries, 'Bc4')).toBe(true);
	});

	it('returns false for a move not in the book set', () => {
		expect(isBookMove(entries, 'Nc3')).toBe(false);
	});

	it('returns false against an empty entry list', () => {
		expect(isBookMove([], 'Nf3')).toBe(false);
	});
});

describe('findBookMove', () => {
	const entries = [
		{ id: 'm1', san: 'Nf3' },
		{ id: 'm2', san: 'Bc4' }
	];

	it('returns the matching entry, including its own move id', () => {
		expect(findBookMove(entries, 'Bc4')).toEqual({ id: 'm2', san: 'Bc4' });
	});

	it('returns undefined when nothing matches', () => {
		expect(findBookMove(entries, 'Nc3')).toBeUndefined();
	});
});
```

- [ ] **Step 2: Run the test file and verify it fails**

Run: `cd mychess && npx vitest run src/lib/repertoire.test.ts`
Expected: fails to compile — `buildBookMoveMap`, `isBookMove`, `findBookMove` are not exported from `./repertoire` yet.

- [ ] **Step 3: Implement the helpers**

Append to `mychess/src/lib/repertoire.ts` (keep the existing `mergeRepertoireIds` export untouched):

```ts
/** One player-turn `moves` row at a shared `from_position` — repertoires can
 * legitimately have more than one book move at the same position (parsed PGN
 * variations), so matching "is this the book move?" means matching *any* of
 * them, not just whichever one a queue happened to pick for this card. */
export type BookMoveEntry = { id: string; san: string };

/** Groups player-turn moves by the position they're played from, so a played
 * SAN can be checked against every book alternative at that position, not
 * just the single move a queue/card happens to be showing. */
export function buildBookMoveMap(
	rows: { id: string; from_position: string; san: string }[]
): Record<string, BookMoveEntry[]> {
	const map: Record<string, BookMoveEntry[]> = {};
	for (const row of rows) {
		(map[row.from_position] ??= []).push({ id: row.id, san: row.san });
	}
	return map;
}

/** Whether `playedSan` matches any book move at this position. */
export function isBookMove(entries: BookMoveEntry[], playedSan: string): boolean {
	return entries.some((e) => e.san === playedSan);
}

/** The specific book move entry (with its own `moves.id`) that `playedSan`
 * matches, if any — needed because Master mode flips *that* move's
 * `move_progress` row to `'correct'`, not necessarily the queued card's. */
export function findBookMove(entries: BookMoveEntry[], playedSan: string): BookMoveEntry | undefined {
	return entries.find((e) => e.san === playedSan);
}
```

- [ ] **Step 4: Run the test file and verify it passes**

Run: `cd mychess && npx vitest run src/lib/repertoire.test.ts`
Expected: `Test Files 1 passed (1)`, all tests green.

- [ ] **Step 5: Commit**

```bash
cd mychess && git add src/lib/repertoire.ts src/lib/repertoire.test.ts && git commit -m "feat: add book-move matching helpers to repertoire.ts for Master mode"
```

---

### Task 13: Pure marker/resnap helpers for `ChessBoard`

**Files:**
- Create: `mychess/src/lib/components/chessboard-marker.ts`
- Test: `mychess/src/lib/components/chessboard-marker.test.ts`

- [ ] **Step 1: Write failing tests**

Create `mychess/src/lib/components/chessboard-marker.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { resolveDisplayMarker, shouldResnap } from './chessboard-marker';

describe('resolveDisplayMarker', () => {
	it('falls back to a star on correctSquare when marker is left undefined', () => {
		expect(resolveDisplayMarker(undefined, 'e4')).toEqual({ square: 'e4', kind: 'star' });
	});

	it('returns null when marker is undefined and there is no correctSquare', () => {
		expect(resolveDisplayMarker(undefined, null)).toBeNull();
	});

	it('uses the explicit marker when provided, ignoring correctSquare', () => {
		expect(resolveDisplayMarker({ square: 'd4', kind: 'cross' }, 'e4')).toEqual({
			square: 'd4',
			kind: 'cross'
		});
	});

	it('an explicit null marker suppresses the star entirely', () => {
		expect(resolveDisplayMarker(null, 'e4')).toBeNull();
	});
});

describe('shouldResnap', () => {
	it('resnaps when fen changed', () => {
		expect(shouldResnap('fenB', 'fenA', 0, 0)).toBe(true);
	});

	it('does not resnap when neither fen nor forceRevert changed', () => {
		expect(shouldResnap('fenA', 'fenA', 2, 2)).toBe(false);
	});

	it('resnaps when forceRevert was bumped even though fen is unchanged', () => {
		expect(shouldResnap('fenA', 'fenA', 3, 2)).toBe(true);
	});
});
```

- [ ] **Step 2: Run and verify failure**

Run: `cd mychess && npx vitest run src/lib/components/chessboard-marker.test.ts`
Expected: fails — `./chessboard-marker` does not exist yet.

- [ ] **Step 3: Implement**

Create `mychess/src/lib/components/chessboard-marker.ts`:

```ts
import type { Key } from 'chessground/types';

export type MarkerKind = 'star' | 'pending' | 'check' | 'cross';
export type Marker = { square: Key; kind: MarkerKind } | null;

/** ChessBoard shows a marker on the last-moved square: either the parent's
 * explicit `marker` override (Master mode's ★/pending/✓/✗ icons), or — when
 * the parent doesn't care (every other caller) — the board's own internal
 * green star on `correctSquare`, exactly as before this feature existed. */
export function resolveDisplayMarker(marker: Marker | undefined, correctSquare: Key | null): Marker {
	if (marker !== undefined) return marker;
	return correctSquare ? { square: correctSquare, kind: 'star' } : null;
}

/** Whether a `fen`/`forceRevert` change should force chessground to reapply
 * `fen`, even if `fen` textually matches the last position we applied — used
 * to snap the board back after a deferred (async, Stockfish-graded) ✗
 * verdict, when the piece was already accepted visually and `fen` itself
 * never changed. */
export function shouldResnap(
	fen: string,
	lastAppliedFen: string,
	forceRevert: number,
	lastForceRevert: number
): boolean {
	return fen !== lastAppliedFen || forceRevert !== lastForceRevert;
}
```

- [ ] **Step 4: Run and verify pass**

Run: `cd mychess && npx vitest run src/lib/components/chessboard-marker.test.ts`
Expected: `Test Files 1 passed (1)`.

- [ ] **Step 5: Commit**

```bash
cd mychess && git add src/lib/components/chessboard-marker.ts src/lib/components/chessboard-marker.test.ts && git commit -m "feat: add pure marker-resolution helpers for ChessBoard's Master-mode feedback"
```

---

### Task 14: Wire the marker/forceRevert helpers into `ChessBoard.svelte`

**Files:**
- Modify: `mychess/src/lib/components/ChessBoard.svelte`

**Depends on Task 13** (imports `resolveDisplayMarker`, `shouldResnap`, `Marker` from `./chessboard-marker`).

- [ ] **Step 1: Replace the full file content**

Replace `mychess/src/lib/components/ChessBoard.svelte` in full with:

```svelte
<script lang="ts">
	import { Chessground } from 'chessground';
	import type { Api } from 'chessground/api';
	import type { Color, Key } from 'chessground/types';
	import { Chess } from 'chess.js';
	import { DEFAULT_PREFS, animationDuration, type BoardPrefs } from '$lib/board/prefs';
	import { resolveDisplayMarker, shouldResnap, type Marker } from './chessboard-marker';

	type Props = {
		fen?: string;
		orientation?: Color;
		interactable?: boolean;
		lastMove?: [Key, Key] | undefined;
		prefs?: BoardPrefs;
		// Return `false` to snap the board back to `fen` (e.g. an incorrect guess).
		onmove?: (detail: { from: Key; to: Key; san: string }) => boolean | void;
		// Overrides the board's own star-on-correct-square logic. Leave
		// `undefined` (the default) for that original behavior; pass an
		// explicit marker (or `null`) to take full manual control — used by
		// Master mode's ★/pending/✓/✗ feedback.
		marker?: Marker;
		// Bump this to force the board to snap back to `fen`, even if `fen`
		// itself hasn't changed since the last time it was applied — used to
		// revert a move that was accepted on the board while its quality was
		// still being graded (Master mode's ✗ outcome, resolved async).
		forceRevert?: number;
	};

	let {
		fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
		orientation = 'white' as Color,
		interactable = true,
		lastMove = undefined,
		prefs = DEFAULT_PREFS,
		onmove,
		marker = undefined,
		forceRevert = 0
	}: Props = $props();

	let cg: Api;
	let correctSquare = $state<Key | null>(null);

	// Tracks the last `fen`/`forceRevert` we actually repositioned the board
	// to, so unrelated reactive prop changes don't stomp on a guess already
	// visually applied to the board.
	// svelte-ignore state_referenced_locally -- intentional one-time snapshot for manual tracking, not a live binding
	let lastAppliedFen = fen;
	// svelte-ignore state_referenced_locally -- intentional one-time snapshot for manual tracking, not a live binding
	let lastForceRevert = forceRevert;

	const displayMarker = $derived(resolveDisplayMarker(marker, correctSquare));

	// Positions the badge on the square's top-right corner (matching the
	// typical "annotation" placement chess sites use), not centered on it.
	function squareToPosition(square: Key, boardOrientation: Color) {
		const file = square.charCodeAt(0) - 97; // 'a' -> 0 .. 'h' -> 7
		const rank = Number(square[1]); // 1-8
		const col = boardOrientation === 'white' ? file : 7 - file;
		const row = boardOrientation === 'white' ? 8 - rank : rank - 1;
		return { left: `${(col + 1) * 12.5}%`, top: `${row * 12.5}%` };
	}

	function buildConfig() {
		const chess = new Chess(fen);
		const dests = new Map<Key, Key[]>();

		if (interactable) {
			for (const sq of chess.board().flat()) {
				if (!sq) continue;
				const moves = chess.moves({ square: sq.square as any, verbose: true });
				if (moves.length) {
					dests.set(sq.square as Key, moves.map((m) => m.to as Key));
				}
			}
		}

		const turnColor: Color = chess.turn() === 'w' ? 'white' : 'black';

		return {
			fen,
			orientation,
			turnColor,
			movable: {
				free: false,
				color: (interactable ? turnColor : undefined) as Color | undefined,
				dests,
				events: {
					after: (orig: Key, dest: Key) => {
						const chess2 = new Chess(fen);
						const move = chess2.move({ from: orig as any, to: dest as any, promotion: 'q' });
						if (!move || !onmove) return;
						const keepMove = onmove({ from: orig, to: dest, san: move.san });
						if (keepMove === false) {
							correctSquare = null;
							cg.set(buildConfig());
						} else {
							correctSquare = dest;
						}
					}
				}
			},
			lastMove,
			coordinates: prefs.coordinates,
			highlight: { lastMove: prefs.highlight, check: prefs.highlight },
			animation: {
				enabled: animationDuration(prefs.animation) > 0,
				duration: animationDuration(prefs.animation)
			}
		};
	}

	// Chessground builds its coordinate labels only once, at construction
	// (api.set() never re-runs that). So we mount via an action and remount the
	// node with {#key prefs.coordinates} below, recreating the board whenever
	// the coordinate toggle changes. Gameplay boards keep a fixed value for the
	// session, so they mount exactly once.
	function mountBoard(node: HTMLElement) {
		cg = Chessground(node, buildConfig());
		return { destroy: () => cg?.destroy() };
	}

	$effect(() => {
		if (!cg) return;
		const config = buildConfig();
		if (shouldResnap(fen, lastAppliedFen, forceRevert, lastForceRevert)) {
			lastAppliedFen = fen;
			lastForceRevert = forceRevert;
			correctSquare = null;
		} else {
			// Same position/revert-signal as last time — a guess may have
			// already moved a piece visually; don't stomp on it, just apply
			// whatever else changed (movable color, dests, orientation...).
			delete (config as { fen?: string }).fen;
		}
		cg.set(config);
	});
</script>

<div
	class="relative w-full aspect-square rounded-xl overflow-hidden shadow-2xl board-theme-{prefs.theme} pieces-{prefs.pieceSet}"
>
	{#key prefs.coordinates}
		<div use:mountBoard class="w-full h-full"></div>
	{/key}
	{#if displayMarker}
		{@const pos = squareToPosition(displayMarker.square, orientation)}
		<div
			class="absolute -translate-x-1/2 -translate-y-1/2 pointer-events-none flex items-center justify-center w-6 h-6 rounded-full border-2 border-white shadow-lg
				{displayMarker.kind === 'star' ? 'bg-green-500' : ''}
				{displayMarker.kind === 'pending' ? 'bg-gray-400 animate-pulse' : ''}
				{displayMarker.kind === 'check' ? 'bg-blue-500' : ''}
				{displayMarker.kind === 'cross' ? 'bg-red-500' : ''}"
			style="left: {pos.left}; top: {pos.top};"
		>
			{#if displayMarker.kind === 'star'}
				<svg viewBox="0 0 24 24" fill="white" class="w-3.5 h-3.5">
					<path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 21 12 17.27 5.82 21 7 14.14l-5-4.87 6.91-1.01L12 2z" />
				</svg>
			{:else if displayMarker.kind === 'check'}
				<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" class="w-3.5 h-3.5">
					<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
				</svg>
			{:else if displayMarker.kind === 'cross'}
				<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" class="w-3.5 h-3.5">
					<path stroke-linecap="round" stroke-linejoin="round" d="M6 6l12 12M18 6L6 18" />
				</svg>
			{/if}
		</div>
	{/if}
</div>
```

- [ ] **Step 2: Run the full suite to confirm no regression in existing consumers**

Run: `cd mychess && npx vitest run`
Expected: all existing tests still pass.

- [ ] **Step 3: Type-check**

Run: `cd mychess && npm run check`
Expected: no new errors beyond the known ~12 pre-existing baseline in `src/routes/auth/**`.

- [ ] **Step 4: Manually verify no visual regression**

Run `npm run dev`, open `/practice/[repertoire_id]` for any repertoire (a caller that never sets `marker`), play a correct move, and confirm the green star still appears exactly as before.

- [ ] **Step 5: Commit**

```bash
cd mychess && git add src/lib/components/ChessBoard.svelte && git commit -m "feat: support an externally-controlled feedback marker and forced revert in ChessBoard"
```

---

### Task 15: Master-mode feedback-outcome helpers

**Files:**
- Create: `mychess/src/routes/(player)/master/feedback.ts`
- Test: `mychess/src/routes/(player)/master/feedback.test.ts`

- [ ] **Step 1: Write failing tests**

Create `mychess/src/routes/(player)/master/feedback.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { offBookOutcome, outcomeForcesRetry, nextChain } from './feedback';

describe('offBookOutcome', () => {
	it('treats fine and inaccuracy as a checkmark', () => {
		expect(offBookOutcome('fine')).toBe('check');
		expect(offBookOutcome('inaccuracy')).toBe('check');
	});

	it('treats mistake and blunder as a cross', () => {
		expect(offBookOutcome('mistake')).toBe('cross');
		expect(offBookOutcome('blunder')).toBe('cross');
	});
});

describe('outcomeForcesRetry', () => {
	it('only a cross forces a retry', () => {
		expect(outcomeForcesRetry('cross')).toBe(true);
		expect(outcomeForcesRetry('check')).toBe(false);
		expect(outcomeForcesRetry('star')).toBe(false);
		expect(outcomeForcesRetry('unknown')).toBe(false);
	});
});

describe('nextChain', () => {
	it('extends the chain on a book move', () => {
		expect(nextChain(3, 'star')).toBe(4);
	});

	it('resets the chain on anything else', () => {
		expect(nextChain(5, 'check')).toBe(0);
		expect(nextChain(5, 'cross')).toBe(0);
		expect(nextChain(5, 'unknown')).toBe(0);
	});
});
```

- [ ] **Step 2: Run and verify failure**

Run: `cd mychess && npx vitest run "src/routes/(player)/master/feedback.test.ts"`
Expected: fails — `./feedback` does not exist yet.

- [ ] **Step 3: Implement**

Create `mychess/src/routes/(player)/master/feedback.ts`:

```ts
import type { MoveQuality } from '$lib/engine/classify';

/** The four things Master mode can show for a played move: the queued
 * card's book move or any of its book siblings (`star`), an off-book move
 * Stockfish still rates as fine/inaccuracy (`check`), an off-book move
 * Stockfish rates as a real mistake/blunder (`cross`), or an off-book move
 * that couldn't be graded at all because the engine was unavailable
 * (`unknown` — shown with no icon, same as today's plain wrong-move
 * handling). */
export type FeedbackOutcome = 'star' | 'check' | 'cross' | 'unknown';

/** Maps an off-book move's Stockfish swing classification to its icon:
 * `fine`/`inaccuracy` are close enough to still show a ✓, `mistake`/`blunder`
 * are real errors and show a ✗. */
export function offBookOutcome(quality: MoveQuality): 'check' | 'cross' {
	return quality === 'fine' || quality === 'inaccuracy' ? 'check' : 'cross';
}

/** Only a real mistake (✗) forces the player to retry the same card — an
 * off-book move that's still objectively fine, or one the engine couldn't
 * classify, simply moves the queue on. */
export function outcomeForcesRetry(outcome: FeedbackOutcome): boolean {
	return outcome === 'cross';
}

/** The chain counter after this outcome: a book move extends it, anything
 * else resets it to zero — any non-book move breaks the chain (matching
 * today's Drill behavior), just without ending the whole session over it. */
export function nextChain(chain: number, outcome: FeedbackOutcome): number {
	return outcome === 'star' ? chain + 1 : 0;
}
```

- [ ] **Step 4: Run and verify pass**

Run: `cd mychess && npx vitest run "src/routes/(player)/master/feedback.test.ts"`
Expected: `Test Files 1 passed (1)`.

- [ ] **Step 5: Commit**

```bash
cd mychess && git add "src/routes/(player)/master/feedback.ts" "src/routes/(player)/master/feedback.test.ts" && git commit -m "feat: add pure feedback-outcome helpers for Master mode's star/check/cross grading"
```

---

### Task 16: Migration — widen `sessions.mode` to allow `'master'`

**Files:**
- Create: `mychess/supabase/migrations/0026_master_mode_session_check.sql`

- [ ] **Step 1: Write the migration file**

Create `mychess/supabase/migrations/0026_master_mode_session_check.sql`:

```sql
-- Master mode (renamed from Drill) writes sessions.mode = 'master'; widen
-- the check constraint to allow it. 'drill' and 'time_trial' are kept in
-- the allowed set (not dropped) since existing historical session rows
-- already carry those values, and re-adding a constraint validates every
-- existing row — matches this codebase's non-destructive migration
-- convention (see CLAUDE.md).
alter table public.sessions drop constraint if exists sessions_mode_check;
alter table public.sessions add constraint sessions_mode_check
  check (mode in ('learn','practice','drill','time_trial','master'));
```

- [ ] **Step 2: Confirm the file is syntactically consistent with the existing constraint pattern**

Run: `cd mychess && grep -n "sessions_mode_check" supabase/migrations/*.sql`
Expected output includes both the original constraint's migration and this new one widening it.

- [ ] **Step 3: Per this repo's established workflow (no local Postgres, no working service-role key), paste the migration's contents for the user to run manually in the Supabase dashboard SQL editor before Task 20 (the `api/master` rename) is relied upon in production.** Do not assume it has been applied — confirm with the user before treating `mode = 'master'` inserts as safe.

- [ ] **Step 4: Commit the migration file**

```bash
cd mychess && git add supabase/migrations/0026_master_mode_session_check.sql && git commit -m "feat: widen sessions.mode check constraint to allow 'master'"
```

---

### Task 17: Convert the `/drill` loader into the `/master` loader

**Files:**
- Create (via move): `mychess/src/routes/(player)/master/+page.server.ts`
- Delete (via move): `mychess/src/routes/(player)/drill/+page.server.ts`

**Depends on Task 12** (`buildBookMoveMap` and `mergeRepertoireIds` from `$lib/repertoire`). Commit together with Task 18 — a loader change alone leaves the page in a broken state (mismatched data shape) until the page is rewritten too.

- [ ] **Step 1: Confirm the old `/master` list-page loader is already gone (relocated to `/practice` by Task 2)**

Run: `cd mychess && find "src/routes/(player)/master" -maxdepth 1 -type f`
Expected: no output — if `+page.server.ts`/`+page.svelte` still contain the old per-repertoire list logic (referencing `variation_progress`/`activeLevel`), stop and confirm with the user before proceeding.

- [ ] **Step 2: Move the file**

```bash
cd mychess && git mv "src/routes/(player)/drill/+page.server.ts" "src/routes/(player)/master/+page.server.ts"
```

- [ ] **Step 3: Replace its contents**

Replace the full contents of `mychess/src/routes/(player)/master/+page.server.ts` with:

```ts
import type { PageServerLoad } from './$types';
import { ensureGuestSession } from '$lib/server/auth';
import { mergeRepertoireIds, buildBookMoveMap } from '$lib/repertoire';

export const load: PageServerLoad = async ({ locals }) => {
  const guest = await ensureGuestSession(locals);
  if (!guest) return { needsAccount: true };
  const { user, session, profile } = guest;
  if (!user) return { needsAccount: true };
  const supabase = locals.supabase;

  const [{ data: ownReps }, { data: assigned }] = await Promise.all([
    supabase.from('repertoires').select('id').eq('player_id', user.id),
    supabase.from('assigned_repertoires').select('repertoire_id').eq('player_id', user.id)
  ]);
  const repIds = mergeRepertoireIds(
    ownReps?.map((r: any) => r.id) ?? [],
    assigned?.map((a: any) => a.repertoire_id) ?? []
  );

  if (repIds.length === 0) {
    return { session, profile, masterMoves: [], bookMoveMap: {} };
  }

  // Master's pool is every player-turn move across every repertoire the
  // player owns or is assigned — no reviews.state filter (that flag hasn't
  // been written since Learn mode was removed, so on the old Drill route it
  // only ever froze the queue rather than growing it). Only the player's
  // own moves are quizzed — the opponent's replies (is_player_turn = false)
  // are just context, not something to guess.
  const { data: moves } = await supabase
    .from('moves')
    .select(
      `
      id, san, from_position,
      from_pos:from_position(fen),
      repertoire:repertoire_id(id, name, color)
    `
    )
    .in('repertoire_id', repIds)
    .eq('is_player_turn', true);

  const allMoves = moves ?? [];
  const bookMoveMap = buildBookMoveMap(allMoves as any);

  // Shuffle for freshness.
  const masterMoves = [...allMoves];
  for (let i = masterMoves.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [masterMoves[i], masterMoves[j]] = [masterMoves[j], masterMoves[i]];
  }

  return { session, profile, masterMoves, bookMoveMap };
};
```

Note: this also fixes a pre-existing bug in the old `/drill` loader — it only queried `repertoires` owned by the player (`player_id = user.id`), never `assigned_repertoires`, so a coach-assigned repertoire's moves never appeared in Drill's pool. Master's pool now correctly includes both.

- [ ] **Step 4: Type-check the loader in isolation**

Run: `cd mychess && npm run check`
Expected: the page component still referencing `data.drillMoves` will mismatch until Task 18 runs immediately after — do not commit this task in isolation; proceed directly to Task 18 and commit both together.

---

### Task 18: Convert the `/drill` page into the `/master` page (★/✓/✗ feedback)

**Files:**
- Create (via move): `mychess/src/routes/(player)/master/+page.svelte`
- Delete (via move): `mychess/src/routes/(player)/drill/+page.svelte`
- Test: `mychess/src/routes/(player)/master/master-page.test.ts`

**Depends on Tasks 13, 14, 15, 17.**

- [ ] **Step 1: Move the file**

```bash
cd mychess && git mv "src/routes/(player)/drill/+page.svelte" "src/routes/(player)/master/+page.svelte"
```

- [ ] **Step 2: Write failing component tests for the two non-interactive states**

Create `mychess/src/routes/(player)/master/master-page.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import Master from './+page.svelte';

afterEach(() => cleanup());

describe('master page', () => {
  it('prompts a guest to sign in when no account is available', () => {
    render(Master, { props: { data: { needsAccount: true } } });
    expect(screen.getByText(/Sign in to train/i)).toBeTruthy();
  });

  it('shows the empty-pool message when the player has no moves to master', () => {
    render(Master, {
      props: {
        data: {
          needsAccount: false,
          masterMoves: [],
          bookMoveMap: {},
          boardPrefs: undefined
        }
      }
    });
    expect(screen.getByText(/No moves to master yet/i)).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run and verify failure**

Run: `cd mychess && npx vitest run "src/routes/(player)/master/master-page.test.ts"`
Expected: fails — the page still contains Drill's old markup/text and reads `data.drillMoves`, so neither assertion matches.

- [ ] **Step 4: Replace the full page content**

Replace the full contents of `mychess/src/routes/(player)/master/+page.svelte` with:

```svelte
<script lang="ts">
  import ChessBoard from '$lib/components/ChessBoard.svelte';
  import type { Key } from 'chessground/types';
  import { Chess } from 'chess.js';
  import { playCorrect, playWrong, playLevelUp } from '$lib/sounds';
  import { evaluatePosition } from '$lib/engine/stockfish';
  import { evaluateSwing } from '$lib/engine/classify';
  import { findBookMove, type BookMoveEntry } from '$lib/repertoire';
  import { offBookOutcome, outcomeForcesRetry, nextChain, type FeedbackOutcome } from './feedback';
  import type { Marker } from '$lib/components/chessboard-marker';

  let { data } = $props<{ data: any }>();

  const allMoves = $derived((data as any).masterMoves ?? []);
  const bookMoveMap = $derived((data as any).bookMoveMap ?? {});

  let currentIdx = $state(0);
  let chain = $state(0);
  let bestChain = $state(0);
  let sessionXp = $state(0);
  let finished = $state(false);
  let retrying = $state(false);
  let evaluating = $state(false);
  let marker = $state<Marker>(null);
  let forceRevert = $state(0);
  let revealSan = $state<string | null>(null);
  let feedbackLabel = $state<string | null>(null);
  let evalRequestId = 0;

  const current = $derived(allMoves[currentIdx]);
  const boardFen = $derived(
    current?.from_pos?.fen ?? 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
  );
  const bookEntries = $derived<BookMoveEntry[]>(
    current ? (bookMoveMap[current.from_position] ?? []) : []
  );

  function applyOutcome(outcome: FeedbackOutcome) {
    chain = nextChain(chain, outcome);
    if (chain > bestChain) bestChain = chain;
  }

  function advance() {
    retrying = false;
    evaluating = false;
    marker = null;
    revealSan = null;
    feedbackLabel = null;

    if (chain === 10) {
      playLevelUp();
      sessionXp += 50;
      finished = true;
      submitMasterResult();
      return;
    }
    if (currentIdx + 1 >= allMoves.length) {
      finished = true;
      submitMasterResult();
    } else {
      currentIdx++;
    }
  }

  function reportBookMove(moveId: string) {
    fetch('/api/master/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ moveId })
    }).catch(() => {});
  }

  function handleMove(detail: { from: Key; to: Key; san: string }) {
    if (finished || evaluating) return;

    const matched = findBookMove(bookEntries, detail.san);
    if (matched) {
      playCorrect();
      marker = { square: detail.to, kind: 'star' };
      applyOutcome('star');
      sessionXp += 2;
      reportBookMove(matched.id);
      advance();
      return;
    }

    playWrong();
    evaluating = true;
    marker = { square: detail.to, kind: 'pending' };
    revealSan = current.san;
    gradeOffBookMove(current, detail.san, detail.to);
  }

  async function gradeOffBookMove(dueMove: any, playedSan: string, destSquare: Key) {
    const requestId = ++evalRequestId;
    try {
      const bookChess = new Chess(dueMove.from_pos.fen);
      bookChess.move(dueMove.san);
      const playedChess = new Chess(dueMove.from_pos.fen);
      playedChess.move(playedSan);

      const [bookScore, playedScore] = await Promise.all([
        evaluatePosition(bookChess.fen(), 800),
        evaluatePosition(playedChess.fen(), 800)
      ]);
      if (requestId !== evalRequestId) return;

      const { quality } = evaluateSwing(bookScore, playedScore);
      resolveOffBookOutcome(offBookOutcome(quality), destSquare);
    } catch {
      if (requestId === evalRequestId) resolveOffBookOutcome('unknown', destSquare);
    }
  }

  function resolveOffBookOutcome(outcome: FeedbackOutcome, destSquare: Key) {
    applyOutcome(outcome);

    if (outcome === 'unknown') {
      marker = null;
      feedbackLabel = null;
    } else {
      marker = { square: destSquare, kind: outcome };
      feedbackLabel = outcome === 'check' ? 'Also fine' : 'Not quite — play the book move to continue';
    }

    if (outcome !== 'unknown' && !outcomeForcesRetry(outcome) && !retrying) {
      // A fresh ✓ (off-book but not a mistake) — briefly show the icon,
      // then move on, same as playing the book move.
      setTimeout(advance, 900);
      return;
    }

    if (outcome === 'unknown' && !retrying) {
      // Engine unavailable on a fresh attempt — no icon, advance right away,
      // same as today's plain wrong-move fallback.
      advance();
      return;
    }

    // A real mistake, or any off-book attempt while already in a forced
    // retry — stays on this card until the book move is played.
    retrying = true;
    evaluating = false;
    forceRevert++;
  }

  function restart() {
    currentIdx = 0;
    chain = 0;
    bestChain = 0;
    sessionXp = 0;
    finished = false;
    retrying = false;
    evaluating = false;
    marker = null;
    revealSan = null;
    feedbackLabel = null;
  }

  async function submitMasterResult() {
    await fetch('/api/master', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chain, sessionXp, bestChain })
    });
  }
</script>

<svelte:head>
  <title>Master Mode — MyChess</title>
</svelte:head>

{#if data.needsAccount}
  <div class="max-w-md mx-auto text-center py-16 space-y-4">
    <h1 class="text-2xl font-bold text-gray-900">Sign in to train</h1>
    <p class="text-gray-500">Guest training is unavailable right now. Create a free account to start.</p>
    <a href="/login?signup=1" class="inline-block bg-indigo-600 text-white px-5 py-2.5 rounded-lg font-medium hover:bg-indigo-700">Get started</a>
  </div>
{:else}
<div class="min-h-screen bg-gray-50 p-4">
  <div class="max-w-3xl mx-auto">
    <div class="flex justify-between items-center mb-4">
      <a href="/" class="text-gray-400 text-sm hover:text-gray-600">← Home</a>
      <h1 class="text-xl font-bold text-gray-900">Master Mode</h1>
      <div class="text-right">
        <div class="text-base font-bold text-indigo-600">Chain: {chain}</div>
        <div class="text-xs text-gray-400">XP: {sessionXp}</div>
      </div>
    </div>

    {#if allMoves.length === 0}
      <div class="bg-white border border-gray-200 rounded-2xl p-6 text-center shadow-sm">
        <p class="text-xl text-gray-700">No moves to master yet!</p>
        <p class="text-gray-400 mt-2">Build or get assigned a repertoire to start training.</p>
        <a href="/repertoires"
           class="mt-4 inline-block bg-indigo-600 text-white px-6 py-2.5 rounded-xl font-semibold hover:bg-indigo-700 transition">
          Go to Repertoires
        </a>
      </div>
    {:else if finished}
      <div class="bg-white border border-gray-200 rounded-2xl p-6 text-center shadow-sm">
        <p class="text-4xl mb-2">🏆</p>
        <h2 class="text-2xl font-bold text-green-600">Session Complete!</h2>
        <p class="text-gray-500 mt-2">Best chain: <strong>{bestChain}</strong> moves</p>
        {#if bestChain >= 10}
          <p class="text-green-600 font-bold mt-1">+50 bonus XP for a 10-chain!</p>
        {/if}
        <button onclick={restart}
                class="mt-4 w-full bg-indigo-600 text-white py-3 rounded-xl font-bold text-lg hover:bg-indigo-700 transition">
          Go Again
        </button>
        <a href="/" class="mt-2 block text-center text-gray-400 hover:underline text-sm">Back to Home</a>
      </div>
    {:else}
      <div class="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm mb-4">
        <p class="text-center text-gray-400 text-sm mb-2">
          Move {currentIdx + 1} / {allMoves.length} · Play the best move!
        </p>
        {#if revealSan}
          <p class="text-center text-sm mb-2">
            <span class="font-semibold text-gray-600">Book move: {revealSan}</span>
          </p>
        {/if}
        {#if feedbackLabel}
          <p class="text-center font-bold text-sm mb-2 {feedbackLabel.startsWith('Not quite') ? 'text-red-600' : 'text-blue-600'}">
            {feedbackLabel}
          </p>
        {/if}
        <ChessBoard
          fen={boardFen}
          interactable={!evaluating}
          onmove={handleMove}
          {marker}
          {forceRevert}
          prefs={data.boardPrefs}
        />
      </div>

      <div class="flex gap-2 justify-center">
        <div class="bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-2 text-center">
          <div class="text-xs text-indigo-400">Current Chain</div>
          <div class="text-2xl font-bold text-indigo-700">{chain}</div>
        </div>
        <div class="bg-green-50 border border-green-100 rounded-xl px-4 py-2 text-center">
          <div class="text-xs text-green-500">Best Chain</div>
          <div class="text-2xl font-bold text-green-700">{bestChain}</div>
        </div>
        <div class="bg-gray-50 border border-gray-100 rounded-xl px-4 py-2 text-center">
          <div class="text-xs text-gray-400">Session XP</div>
          <div class="text-2xl font-bold text-gray-700">{sessionXp}</div>
        </div>
      </div>
    {/if}
  </div>
</div>
{/if}
```

- [ ] **Step 5: Run the component tests and verify pass**

Run: `cd mychess && npx vitest run "src/routes/(player)/master/master-page.test.ts"`
Expected: `Test Files 1 passed (1)`.

- [ ] **Step 6: Run the full test suite and type-check (this is where Task 17's loader and this page finally agree on shape)**

Run: `cd mychess && npx vitest run && npm run check`
Expected: all tests pass; no new type errors beyond the known baseline.

- [ ] **Step 7: Manual verification (no existing test mounts Chessground for page-level interaction)**

Run `npm run dev`, sign in, go to `/master`, and confirm, in order:
- A book move shows the green ★ and the chain counter increments.
- An off-book move that Stockfish rates as fine/inaccuracy shows the neutral pending dot, then a blue ✓, reveals "Book move: …", and automatically advances to the next card after ~0.9s, with `chain` reset to 0.
- An off-book move that Stockfish rates as a mistake/blunder shows the pending dot, then a red ✗, reverts the board to the position before the move, and keeps prompting "Not quite — play the book move to continue" until a book move is played from that same position (any repertoire's sibling counts) — only then does it advance.
- With devtools blocking `/stockfish/stockfish-18-lite-single.js`, an off-book move shows no icon at all and advances immediately (silent fallback).

- [ ] **Step 8: Commit Tasks 17 and 18 together**

```bash
cd mychess && git add "src/routes/(player)/master/+page.server.ts" "src/routes/(player)/master/+page.svelte" "src/routes/(player)/master/master-page.test.ts" && git commit -m "feat: repurpose Drill into the new global Master mode with star/check/cross feedback"
```

---

### Task 19: `POST /api/master/move` — flip a move's `move_progress` to `'correct'`

**Files:**
- Create: `mychess/src/routes/api/master/move/+server.ts`

**Depends on Task 6** (`markMoveCorrect`).

- [ ] **Step 1: Create the endpoint**

Create `mychess/src/routes/api/master/move/+server.ts`:

```ts
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { markMoveCorrect } from '$lib/server/move-progress';

export const POST: RequestHandler = async ({ request, locals }) => {
  const { supabase } = locals;
  const { user } = await locals.safeGetSession();
  if (!user) throw error(401, 'Unauthorized');

  const { moveId } = (await request.json()) as { moveId: string };
  if (!moveId) throw error(400, 'moveId is required');

  await markMoveCorrect(supabase, user.id, moveId);
  return json({ ok: true });
};
```

- [ ] **Step 2: Type-check**

Run: `cd mychess && npm run check`
Expected: no new errors.

- [ ] **Step 3: No automated test for this file**, matching this codebase's convention that thin `src/lib/server/*`-consuming I/O wrappers aren't unit-tested directly — exercised via manual verification, already covered end-to-end by Task 18's Step 7 manual check (a ★ hit in Master calls this endpoint).

- [ ] **Step 4: Manually verify**

With the dev server running and signed in, play a book move in `/master`, then confirm (via the Supabase dashboard's table editor, or `select * from move_progress where player_id = '<your id>'`) that a row now exists with `state = 'correct'` for that move's id.

- [ ] **Step 5: Commit**

```bash
cd mychess && git add "src/routes/api/master/move/+server.ts" && git commit -m "feat: add /api/master/move endpoint to flip a book move's progress to correct"
```

---

### Task 20: Rename `api/drill` → `api/master`, and `drillStreak`/`drill_streak` → `masterStreak`/`master_streak`

**Files:**
- Create (via move): `mychess/src/routes/api/master/+server.ts`
- Delete (via move): `mychess/src/routes/api/drill/+server.ts`
- Modify: `mychess/src/lib/badges/grant.ts`
- Modify: `mychess/src/lib/badges/grant.test.ts`
- Modify: `mychess/src/lib/badges/recalc.ts`
- Modify: `mychess/src/lib/badges/recalc.test.ts`
- Modify: `mychess/src/lib/quests/generate.ts`

**Depends on Task 16** (the widened `sessions.mode` constraint must be applied before `mode: 'master'` inserts are safe in production).

- [ ] **Step 1: Move the endpoint file**

```bash
cd mychess && git mv src/routes/api/drill/+server.ts src/routes/api/master/+server.ts
```

- [ ] **Step 2: Rewrite it**

Replace the full contents of `mychess/src/routes/api/master/+server.ts` with:

```ts
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { grantNewBadges } from '$lib/badges/grant';

export const POST: RequestHandler = async ({ request, locals }) => {
  const { supabase } = locals;
  const { user } = await locals.safeGetSession();
  if (!user) throw error(401, 'Unauthorized');

  const { chain, sessionXp, bestChain } = await request.json() as {
    chain: number;
    sessionXp: number;
    bestChain: number;
  };

  // Record master session
  await supabase.from('sessions').insert({
    player_id: user.id,
    mode: 'master',
    cards_reviewed: chain,
    xp_earned: sessionXp
  });

  // Grant XP
  if (sessionXp > 0) {
    await supabase.rpc('update_xp_and_level', {
      p_player_id: user.id,
      p_xp_delta: sessionXp
    });
    await supabase.rpc('update_weekly_leaderboard', {
      p_player_id: user.id,
      p_xp: sessionXp
    });
    await supabase.rpc('update_streak', { p_player_id: user.id });
  }

  // Update quest progress for master_streak
  if (chain >= 5) {
    const today = new Date().toISOString().slice(0, 10);
    const { data: quest } = await supabase
      .from('quests')
      .select('*')
      .eq('player_id', user.id)
      .eq('date', today)
      .eq('quest_id', 'master_streak')
      .single();

    if (quest && !quest.completed) {
      const newProgress = Math.min(quest.progress + 1, quest.target);
      const nowComplete = newProgress >= quest.target;
      await supabase
        .from('quests')
        .update({ progress: newProgress, completed: nowComplete })
        .eq('id', quest.id);

      if (nowComplete) {
        await supabase.rpc('update_xp_and_level', {
          p_player_id: user.id,
          p_xp_delta: quest.xp_reward
        });
      }
    }
  }

  grantNewBadges(supabase, user.id, { masterStreak: bestChain }).catch(() => {});

  return json({ ok: true });
};
```

Note: `.eq('quest_id', ...)` and `{ completed, progress }` column names are left exactly as the pre-existing `api/drill` code used them — only the string *values* are renamed here, not the column names.

- [ ] **Step 3: Rename the `drillStreak` field to `masterStreak` in `grant.ts`**

In `mychess/src/lib/badges/grant.ts`, change every `drillStreak` occurrence (the `BadgeStatsInput` interface field and its default in the stats-merge call) to `masterStreak`.

- [ ] **Step 4: Rename the `drillStreak` field to `masterStreak` in `recalc.ts`**

In `mychess/src/lib/badges/recalc.ts`, change the `BadgeStats` interface's `drillStreak` field, and every `s.drillStreak` reference inside `RULES` (e.g. `first_drill`, `drill_chain_5`, `drill_chain_10`, `drill_chain_20`, `drill_ace`), to `s.masterStreak`.

The badge **id** strings (`first_drill`, `drill_chain_5`, etc.) are deliberately left unchanged — they're persisted identifiers in `badges_earned.badge_id` for players who've already earned them; renaming a stored identifier is out of scope for this rename-only change. Only the in-memory `BadgeStats` field name changes.

- [ ] **Step 5: Update the two test files' fixtures**

In `mychess/src/lib/badges/grant.test.ts`, change every `drillStreak: 0,` fixture value to `masterStreak: 0,`. In `mychess/src/lib/badges/recalc.test.ts`, do the same.

- [ ] **Step 6: Rename the quest template id**

In `mychess/src/lib/quests/generate.ts`, change the `drill_streak` quest template's `id: 'drill_streak'` to `id: 'master_streak'` and its description from "Get a 5-move Drill chain" to "Get a 5-move Master chain".

(The `time_trial` quest template is deliberately left as-is — Time Trial mode itself is deleted in Task 21, but its dormant quest template is out of scope here, matching this codebase's non-destructive convention already applied to `reviews`/`variation_progress`.)

- [ ] **Step 7: Run the badges and quests test suites and verify they still pass**

Run: `cd mychess && npx vitest run src/lib/badges/grant.test.ts src/lib/badges/recalc.test.ts src/lib/quests/generate.test.ts`
Expected: `Test Files 3 passed (3)`.

- [ ] **Step 8: Type-check**

Run: `cd mychess && npm run check`
Expected: no new errors beyond the known baseline.

- [ ] **Step 9: Manually confirm the badge/quest rename is wired through end-to-end**

Play a Master session with a 5+ chain, submit it, and confirm (via a read-only query, e.g. `select * from quests where player_id = '<your id>' and date = current_date`) that a `master_streak` quest — if one was rolled for today — progresses, and that `grantNewBadges` was invoked with `masterStreak` (no runtime error in server logs).

- [ ] **Step 10: Commit**

```bash
cd mychess && git add src/routes/api/master/+server.ts src/lib/badges/grant.ts src/lib/badges/grant.test.ts src/lib/badges/recalc.ts src/lib/badges/recalc.test.ts src/lib/quests/generate.ts && git commit -m "feat: rename api/drill to api/master and drillStreak/drill_streak to masterStreak/master_streak"
```

---

### Task 21: Delete Time Trial entirely

**Files:**
- Delete: `mychess/src/routes/(player)/time-trial/+page.svelte`
- Delete: `mychess/src/routes/(player)/time-trial/+page.server.ts`
- Delete: `mychess/src/routes/api/time-trial/+server.ts`

- [ ] **Step 1: Confirm nothing outside these three files depends on Time Trial**

Run: `cd mychess && grep -rn "time-trial\|time_trial\|TimeTrial" src --include=*.ts --include=*.svelte | grep -v "src/routes/(player)/time-trial\|src/routes/api/time-trial"`
Expected matches only in files handled elsewhere in this plan: `NavBar.svelte`/`QuickActions.svelte` (Tasks 22–23), and the dormant `time_trial` quest template / `ttBestScore` badge stat (deliberately left in place, Task 20's note). Nothing else references it.

- [ ] **Step 2: Delete the route and API files**

```bash
cd mychess && git rm -r "src/routes/(player)/time-trial" "src/routes/api/time-trial"
```

- [ ] **Step 3: Run the full test suite**

Run: `cd mychess && npx vitest run`
Expected: all remaining tests pass.

- [ ] **Step 4: Type-check**

Run: `cd mychess && npm run check`
Expected: no new errors beyond the known baseline.

- [ ] **Step 5: Commit**

```bash
cd mychess && git commit -m "feat: retire Time Trial mode entirely"
```

---

### Task 22: Update `NavBar.svelte` to Master + Practice only

**Files:**
- Modify: `mychess/src/lib/components/NavBar.svelte`

- [ ] **Step 1: Replace the desktop nav link**

In `mychess/src/lib/components/NavBar.svelte`, change:
```svelte
      <a href="/master" class={linkClass(['/master', '/drill', '/practice', '/time-trial'])}>Master</a>
```
to:
```svelte
      <a href="/master" class={linkClass(['/master'])}>Master</a>
      <a href="/practice" class={linkClass(['/practice'])}>Practice</a>
```

- [ ] **Step 2: Replace the mobile nav link**

Change:
```svelte
      <a href="/master" onclick={() => mobileMenuOpen = false} class="text-gray-700">Master</a>
```
to:
```svelte
      <a href="/master" onclick={() => mobileMenuOpen = false} class="text-gray-700">Master</a>
      <a href="/practice" onclick={() => mobileMenuOpen = false} class="text-gray-700">Practice</a>
```

- [ ] **Step 3: Manually verify in the browser**

Run `npm run dev`, sign in as a player, and confirm the desktop and mobile nav each show exactly two training links — "Master" and "Practice" — with the correct one highlighted on `/master` vs `/practice` (not both highlighted together as before).

- [ ] **Step 4: Run the full test suite and type-check**

Run: `cd mychess && npx vitest run && npm run check`
Expected: all tests pass; no new type errors beyond the known baseline.

- [ ] **Step 5: Commit**

```bash
cd mychess && git add src/lib/components/NavBar.svelte && git commit -m "feat: collapse NavBar training links to Master and Practice"
```

---

### Task 23: Update `QuickActions.svelte` and the dashboard's guest CTA

**Files:**
- Modify: `mychess/src/lib/components/QuickActions.svelte`
- Modify: `mychess/src/routes/(player)/+page.svelte`

- [ ] **Step 1: Rewrite `QuickActions.svelte`**

Replace the full contents of `mychess/src/lib/components/QuickActions.svelte` with:

```svelte
<script lang="ts">
  const actions = [
    { href: '/master', label: 'Master', sublabel: 'Every move, shuffled', primary: true },
    { href: '/practice', label: 'Practice', sublabel: 'One repertoire, leveled', primary: false }
  ];
</script>

<div class="grid grid-cols-2 gap-3">
  {#each actions as action}
    <a
      href={action.href}
      class="flex flex-col items-center justify-center p-4 rounded-xl border transition-all
             {action.primary
               ? 'bg-indigo-600 text-white border-indigo-600 hover:bg-indigo-700'
               : 'bg-white text-gray-700 border-gray-200 shadow-sm hover:shadow-md hover:border-gray-300'}"
    >
      <span class="font-semibold text-sm">{action.label}</span>
      <span class="text-xs mt-0.5 {action.primary ? 'text-indigo-200' : 'text-gray-400'}">
        {action.sublabel}
      </span>
    </a>
  {/each}
</div>
```

- [ ] **Step 2: Fix the dashboard's guest-landing CTA, which still links to the now-retired `/drill`**

In `mychess/src/routes/(player)/+page.svelte`, change:
```svelte
        <a href="/drill" class="block bg-indigo-600 text-white rounded-xl p-5 hover:bg-indigo-700 transition-colors">
          <p class="font-semibold">Try a drill →</p>
          <p class="text-sm text-indigo-100">No account needed — sign in later to save your progress.</p>
        </a>
```
to:
```svelte
        <a href="/master" class="block bg-indigo-600 text-white rounded-xl p-5 hover:bg-indigo-700 transition-colors">
          <p class="font-semibold">Try Master mode →</p>
          <p class="text-sm text-indigo-100">No account needed — sign in later to save your progress.</p>
        </a>
```

- [ ] **Step 3: Run the full test suite**

Run: `cd mychess && npx vitest run`
Expected: all tests pass.

- [ ] **Step 4: Type-check**

Run: `cd mychess && npm run check`
Expected: no new errors beyond the known baseline.

- [ ] **Step 5: Manually verify**

Run `npm run dev`; confirm the dashboard's quick actions grid shows exactly "Master" and "Practice" (2 columns, no leftover 4-column gap), and that the guest landing page's CTA reads "Try Master mode →" and links to `/master`.

- [ ] **Step 6: Commit**

```bash
cd mychess && git add src/lib/components/QuickActions.svelte "src/routes/(player)/+page.svelte" && git commit -m "feat: point dashboard quick actions and guest CTA at Master and Practice"
```

---

### Task 24: Final verification — full plan

**Files:**
- Delete (if still present): `mychess/src/routes/(player)/master/[repertoire_id]/+page.svelte`
- Delete (if still present): `mychess/src/routes/(player)/master/[repertoire_id]/+page.server.ts`
- Delete (if still present): `mychess/src/routes/(player)/master/[repertoire_id]/train.test.ts`

- [ ] **Step 1: Confirm the old per-repertoire Master detail route has actually been relocated to `/practice/[repertoire_id]`**

Run: `cd mychess && find "src/routes/(player)/master" -type d`
Expected: only `src/routes/(player)/master` itself (no `[repertoire_id]` subfolder — Task 2 already removed it).

- [ ] **Step 2: If `[repertoire_id]` is somehow still present under `master/`, confirm its content is genuinely superseded before removing it**

Run: `cd mychess && find "src/routes/(player)/practice" -type f`
Confirm `src/routes/(player)/practice/[repertoire_id]/+page.server.ts` exists and references `move_progress` (not `variation_progress`/`activeLevel`). Only then:
```bash
cd mychess && git rm -r "src/routes/(player)/master/[repertoire_id]"
```
If it's already gone (the expected case, since Task 2 handled it), skip this removal.

- [ ] **Step 3: Confirm the old flat `/practice` quiz is genuinely gone, not just added-alongside**

Run: `cd mychess && grep -n "url.searchParams.get('rep')\|data.moves" "src/routes/(player)/practice/+page.server.ts" "src/routes/(player)/practice/+page.svelte" 2>/dev/null`
Expected: no matches.

- [ ] **Step 4: Confirm `/drill` no longer exists anywhere**

Run: `cd mychess && find "src/routes/(player)/drill" "src/routes/api/drill" 2>&1`
Expected: `find: ... No such file or directory` for both paths.

- [ ] **Step 5: Full repo-wide check for stray references to every retired route**

Run: `cd mychess && grep -rn "'/drill'\|\"/drill\"\|href=\"/drill\|href='/drill\|/time-trial" src --include=*.ts --include=*.svelte`
Expected: no output.

- [ ] **Step 6: Run the complete test suite**

Run: `cd mychess && npx vitest run`
Expected: all test files pass, including every one touched or added across Tasks 1–23.

- [ ] **Step 7: Full type-check**

Run: `cd mychess && npm run check`
Expected: only the known pre-existing ~12 baseline errors in `src/routes/auth/**`, nothing new.

- [ ] **Step 8: Commit (only if Step 2 actually removed files; otherwise this task is verification-only and needs no commit)**

Run: `cd mychess && git status`
If there are staged deletions from Step 2:
```bash
cd mychess && git commit -m "feat: remove superseded per-repertoire Master route now that Practice mode owns it"
```

- [ ] **Step 9: Final reminder**

Confirm with the user that both migrations (`0025_move_progress.sql`, `0026_master_mode_session_check.sql`) have been applied via the Supabase dashboard SQL editor — the app will error against production without them.

---

This plan ends at **Task 24**.

### Critical Files for Implementation

- `mychess/supabase/migrations/0025_move_progress.sql`
- `mychess/supabase/migrations/0026_master_mode_session_check.sql`
- `mychess/src/lib/mastery/levels.ts`
- `mychess/src/lib/mastery/moveProgress.ts`
- `mychess/src/lib/mastery/practice.ts`
- `mychess/src/lib/server/move-progress.ts`
- `mychess/src/lib/repertoire.ts`
- `mychess/src/lib/components/ChessBoard.svelte`
- `mychess/src/lib/components/chessboard-marker.ts`
- `mychess/src/routes/(player)/practice/[repertoire_id]/+page.server.ts`
- `mychess/src/routes/(player)/master/+page.svelte`
- `mychess/src/routes/(player)/master/+page.server.ts`
- `mychess/src/routes/api/master/+server.ts`
