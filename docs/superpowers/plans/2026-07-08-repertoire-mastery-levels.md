# Repertoire Mastery Levels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the FSRS-based "Learn" mode with a per-repertoire mastery system: 5 depth levels (up through the player's 4th/6th/8th/10th/all own moves), random-start-point sequential playthroughs, and a mistake sends the whole variation back to the pool with no progress lost, no progress gained.

**Architecture:** Variations (root-to-leaf paths through a repertoire's move tree) are computed on the fly by a pure module, never persisted. Progress is one row per `(player, variation)` storing the single deepest depth successfully reached — levels are a derived view over that number, not separately tracked. A new `/master` picker page and `/master/[repertoire_id]` practice page replace `/learn` entirely; the already-built Stockfish quality-feedback flow carries over into the new mistake handling.

**Tech Stack:** SvelteKit 2 / Svelte 5, `chess.js`, Supabase/Postgres, vitest.

---

### Task 1: Variation enumeration

**Files:**
- Create: `src/lib/mastery/variations.ts`
- Test: `src/lib/mastery/variations.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// mychess/src/lib/mastery/variations.test.ts
import { describe, it, expect } from 'vitest';
import { enumerateVariations, type RawMoveRow } from './variations';

function move(
  id: string,
  fromPositionId: string,
  toPositionId: string,
  san: string,
  isPlayerTurn: boolean
): RawMoveRow {
  return { id, fromPositionId, toPositionId, fromFen: `fen:${fromPositionId}`, toFen: `fen:${toPositionId}`, san, isPlayerTurn };
}

describe('enumerateVariations', () => {
  it('returns a single variation for a linear repertoire', () => {
    const moves = [
      move('m1', 'START', 'P1', 'e4', true),
      move('m2', 'P1', 'P2', 'e5', false),
      move('m3', 'P2', 'P3', 'Nf3', true)
    ];
    const result = enumerateVariations(moves);
    expect(result).toHaveLength(1);
    expect(result[0].leafMoveId).toBe('m3');
    expect(result[0].path.map((s) => s.moveId)).toEqual(['m1', 'm2', 'm3']);
    expect(result[0].playerMoveCount).toBe(2);
  });

  it('gives two variations the same leafMoveId but different variationKeys when they transpose into a shared tail', () => {
    // Two different prefixes (m1a vs m1b) both lead into the same shared node P_SHARED,
    // which then has one single continuation to a shared leaf (m3) — a transposition.
    const moves = [
      move('m1a', 'START_A', 'P_SHARED', 'e4', true),
      move('m1b', 'START_B', 'P_SHARED', 'd4', true),
      move('m2', 'P_SHARED', 'P2', 'Nf3', false),
      move('m3', 'P2', 'P3', 'Bb5', true)
    ];
    const result = enumerateVariations(moves);
    expect(result).toHaveLength(2);
    expect(result[0].leafMoveId).toBe('m3');
    expect(result[1].leafMoveId).toBe('m3');
    expect(result[0].variationKey).not.toBe(result[1].variationKey);
  });

  it('splits into two variations when the opponent has two replies', () => {
    const moves = [
      move('m1', 'START', 'P1', 'e4', true),
      move('m2a', 'P1', 'P2A', 'e5', false),
      move('m2b', 'P1', 'P2B', 'c5', false),
      move('m3a', 'P2A', 'P3A', 'Nf3', true),
      move('m3b', 'P2B', 'P3B', 'Nc3', true)
    ];
    const result = enumerateVariations(moves);
    expect(result).toHaveLength(2);
    const leafIds = result.map((v) => v.leafMoveId).sort();
    expect(leafIds).toEqual(['m3a', 'm3b']);
    for (const v of result) {
      expect(v.playerMoveCount).toBe(2);
      expect(v.path[0].moveId).toBe('m1'); // shared prefix
    }
  });

  it('splits into two variations when the player has two prepared responses at the same node', () => {
    const moves = [
      move('m1', 'START', 'P1', 'e4', true),
      move('m2', 'P1', 'P2', 'e5', false),
      move('m3a', 'P2', 'P3A', 'Nf3', true),
      move('m3b', 'P2', 'P3B', 'Bc4', true)
    ];
    const result = enumerateVariations(moves);
    expect(result).toHaveLength(2);
    expect(result.map((v) => v.leafMoveId).sort()).toEqual(['m3a', 'm3b']);
  });

  it('handles multiple independent roots in the same repertoire', () => {
    const moves = [
      move('m1', 'START_A', 'P1', 'e4', true),
      move('m2', 'START_B', 'P2', 'd4', true)
    ];
    const result = enumerateVariations(moves);
    expect(result).toHaveLength(2);
    expect(result.map((v) => v.leafMoveId).sort()).toEqual(['m1', 'm2']);
  });

  it('counts only is_player_turn steps toward playerMoveCount', () => {
    const moves = [
      move('m1', 'START', 'P1', 'e4', true),
      move('m2', 'P1', 'P2', 'e5', false),
      move('m3', 'P2', 'P3', 'Nf3', true),
      move('m4', 'P3', 'P4', 'Nc6', false),
      move('m5', 'P4', 'P5', 'Bb5', true)
    ];
    const result = enumerateVariations(moves);
    expect(result).toHaveLength(1);
    expect(result[0].playerMoveCount).toBe(3);
    expect(result[0].path).toHaveLength(5);
  });

  it('returns an empty array for no moves', () => {
    expect(enumerateVariations([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd mychess && npx vitest run src/lib/mastery/variations.test.ts`
Expected: FAIL — `./variations` has no exported members (module doesn't exist yet).

- [ ] **Step 3: Implement**

```ts
// mychess/src/lib/mastery/variations.ts
export type RawMoveRow = {
	id: string;
	fromPositionId: string;
	toPositionId: string;
	fromFen: string;
	toFen: string;
	san: string;
	isPlayerTurn: boolean;
};

export type VariationStep = {
	moveId: string;
	san: string;
	fromFen: string;
	toFen: string;
	isPlayerTurn: boolean;
};

export type Variation = {
	leafMoveId: string;
	variationKey: string;
	path: VariationStep[];
	playerMoveCount: number;
};

/**
 * Walks a repertoire's move tree and returns one entry per leaf (a complete
 * root-to-leaf path). A branch — whether the opponent has multiple replies,
 * or the repertoire itself prepares two responses at one node — produces two
 * separate variations sharing the common prefix up to the branch point.
 *
 * `leafMoveId` alone is NOT a safe uniqueness key: if a repertoire merges
 * games that transpose into a shared position (a supported, realistic
 * scenario — see pgn-import.ts), two genuinely different paths can converge
 * and share an identical tail, ending on the same leaf move. `variationKey`
 * (the full ordered sequence of move ids, joined by a separator that can
 * never appear inside a UUID) is unique per distinct path and is what
 * later tasks use as the actual database key for progress tracking.
 */
export function enumerateVariations(moves: RawMoveRow[]): Variation[] {
	const byFrom = new Map<string, RawMoveRow[]>();
	const toPositionIds = new Set<string>();
	for (const m of moves) {
		const list = byFrom.get(m.fromPositionId) ?? [];
		list.push(m);
		byFrom.set(m.fromPositionId, list);
		toPositionIds.add(m.toPositionId);
	}

	const fromPositionIds = new Set(moves.map((m) => m.fromPositionId));
	const roots = Array.from(fromPositionIds).filter((id) => !toPositionIds.has(id));

	const variations: Variation[] = [];

	function walk(positionId: string, path: VariationStep[], playerMoveCount: number) {
		const outgoing = byFrom.get(positionId) ?? [];
		if (outgoing.length === 0) {
			if (path.length > 0) {
				variations.push({
					leafMoveId: path[path.length - 1].moveId,
					variationKey: path.map((s) => s.moveId).join('>'),
					path,
					playerMoveCount
				});
			}
			return;
		}
		for (const move of outgoing) {
			const step: VariationStep = {
				moveId: move.id,
				san: move.san,
				fromFen: move.fromFen,
				toFen: move.toFen,
				isPlayerTurn: move.isPlayerTurn
			};
			walk(move.toPositionId, [...path, step], playerMoveCount + (move.isPlayerTurn ? 1 : 0));
		}
	}

	for (const root of roots) {
		walk(root, [], 0);
	}

	return variations;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd mychess && npx vitest run src/lib/mastery/variations.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/mastery/variations.ts src/lib/mastery/variations.test.ts
git commit -m "feat: add repertoire variation enumeration"
git push
```

---

### Task 2: Level derivation

**Files:**
- Create: `src/lib/mastery/levels.ts`
- Test: `src/lib/mastery/levels.test.ts`

**Depends on Task 1** only for the `Variation`-shaped type used in tests (imports nothing from Task 1's module — fully independent pure logic, takes plain `{ playerMoveCount }` shapes).

- [ ] **Step 1: Write the failing tests**

```ts
// mychess/src/lib/mastery/levels.test.ts
import { describe, it, expect } from 'vitest';
import { levelDepth, targetDepth, isSatisfied, currentLevel, activeLevel } from './levels';

describe('levelDepth', () => {
  it('returns the fixed depth for each level', () => {
    expect(levelDepth(1)).toBe(4);
    expect(levelDepth(2)).toBe(6);
    expect(levelDepth(3)).toBe(8);
    expect(levelDepth(4)).toBe(10);
    expect(levelDepth(5)).toBe(Infinity);
  });
});

describe('targetDepth', () => {
  it('is the level depth when the variation is longer', () => {
    expect(targetDepth({ playerMoveCount: 12 }, 2)).toBe(6);
  });

  it('is the variations own length when shorter than the level depth', () => {
    expect(targetDepth({ playerMoveCount: 3 }, 2)).toBe(3);
  });

  it('is the full variation length at level 5 regardless of length', () => {
    expect(targetDepth({ playerMoveCount: 47 }, 5)).toBe(47);
  });
});

describe('isSatisfied', () => {
  it('is satisfied once deepestReached meets the target depth', () => {
    expect(isSatisfied({ playerMoveCount: 10 }, 2, 6)).toBe(true);
    expect(isSatisfied({ playerMoveCount: 10 }, 2, 5)).toBe(false);
  });

  it('a naturally short variation is satisfied at every level once solved once', () => {
    expect(isSatisfied({ playerMoveCount: 3 }, 1, 3)).toBe(true);
    expect(isSatisfied({ playerMoveCount: 3 }, 5, 3)).toBe(true);
  });
});

describe('currentLevel', () => {
  it('is 0 when nothing is satisfied at level 1', () => {
    expect(currentLevel([{ playerMoveCount: 10, deepestReached: 0 }])).toBe(0);
  });

  it('is the highest level where every variation is satisfied', () => {
    const variations = [
      { playerMoveCount: 10, deepestReached: 8 }, // satisfied through level 3 (depth 8), not level 4 (needs 10)
      { playerMoveCount: 10, deepestReached: 10 }
    ];
    expect(currentLevel(variations)).toBe(3);
  });

  it('a naturally short variation never blocks progress past its own length', () => {
    const variations = [
      { playerMoveCount: 3, deepestReached: 3 }, // maxed out already, satisfied at every level
      { playerMoveCount: 10, deepestReached: 10 }
    ];
    expect(currentLevel(variations)).toBe(5);
  });

  it('is 5 for an empty variation list (nothing to master)', () => {
    expect(currentLevel([])).toBe(5);
  });
});

describe('activeLevel', () => {
  it('is currentLevel + 1', () => {
    expect(activeLevel([{ playerMoveCount: 10, deepestReached: 0 }])).toBe(1);
    expect(activeLevel([{ playerMoveCount: 10, deepestReached: 4 }])).toBe(2);
  });

  it('is "mastered" once every variation satisfies level 5', () => {
    expect(activeLevel([{ playerMoveCount: 10, deepestReached: 10 }])).toBe('mastered');
  });

  it('is "mastered" for an empty variation list', () => {
    expect(activeLevel([])).toBe('mastered');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd mychess && npx vitest run src/lib/mastery/levels.test.ts`
Expected: FAIL — `./levels` has no exported members.

- [ ] **Step 3: Implement**

```ts
// mychess/src/lib/mastery/levels.ts
export type Level = 1 | 2 | 3 | 4 | 5;

const LEVEL_DEPTHS: Record<Level, number> = { 1: 4, 2: 6, 3: 8, 4: 10, 5: Infinity };
const LEVELS: Level[] = [1, 2, 3, 4, 5];

export function levelDepth(level: Level): number {
	return LEVEL_DEPTHS[level];
}

/** The depth this variation must reach at this level — capped by its own natural length. */
export function targetDepth(variation: { playerMoveCount: number }, level: Level): number {
	return Math.min(variation.playerMoveCount, levelDepth(level));
}

export function isSatisfied(
	variation: { playerMoveCount: number },
	level: Level,
	deepestReached: number
): boolean {
	return deepestReached >= targetDepth(variation, level);
}

export type VariationProgress = { playerMoveCount: number; deepestReached: number };

/**
 * The highest level where every variation is satisfied, or 0 if none.
 * Target depth is non-decreasing as level increases, so once a level fails
 * to be fully satisfied, no higher level can be either — safe to stop there.
 */
export function currentLevel(variations: VariationProgress[]): 0 | Level {
	let level: 0 | Level = 0;
	for (const l of LEVELS) {
		const allSatisfied = variations.every((v) => isSatisfied(v, l, v.deepestReached));
		if (allSatisfied) {
			level = l;
		} else {
			break;
		}
	}
	return level;
}

/** The level to practice next, or 'mastered' once every variation satisfies level 5. */
export function activeLevel(variations: VariationProgress[]): Level | 'mastered' {
	const level = currentLevel(variations);
	if (level === 5) return 'mastered';
	return (level + 1) as Level;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd mychess && npx vitest run src/lib/mastery/levels.test.ts`
Expected: PASS (12 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/mastery/levels.ts src/lib/mastery/levels.test.ts
git commit -m "feat: add mastery level derivation logic"
git push
```

---

### Task 3: Practice attempt selection

**Files:**
- Create: `src/lib/mastery/practice.ts`
- Test: `src/lib/mastery/practice.test.ts`

**Depends on Task 1 and Task 2.**

- [ ] **Step 1: Write the failing tests**

```ts
// mychess/src/lib/mastery/practice.test.ts
import { describe, it, expect } from 'vitest';
import { pickPracticeAttempt, splitAttempt } from './practice';
import type { Variation } from './variations';

function makeVariation(leafMoveId: string, playerMoveCount: number): Variation & { deepestReached: number } {
  const path = [];
  for (let i = 0; i < playerMoveCount * 2; i++) {
    const isPlayerTurn = i % 2 === 0;
    path.push({
      moveId: i === playerMoveCount * 2 - 1 ? leafMoveId : `${leafMoveId}-step${i}`,
      san: `san${i}`,
      fromFen: `fen${i}`,
      toFen: `fen${i + 1}`,
      isPlayerTurn
    });
  }
  const variationKey = path.map((s) => s.moveId).join('>');
  return { leafMoveId, variationKey, path, playerMoveCount, deepestReached: 0 };
}

describe('pickPracticeAttempt', () => {
  it('returns null when every variation is already satisfied at the level', () => {
    const v = { ...makeVariation('leaf1', 4), deepestReached: 4 };
    expect(pickPracticeAttempt([v], 1)).toBeNull();
  });

  it('picks a not-yet-satisfied variation and a start point below its target depth', () => {
    const v = makeVariation('leaf1', 10);
    const result = pickPracticeAttempt([v], 2, () => 0.5); // deterministic "random"
    expect(result).not.toBeNull();
    expect(result!.variation.leafMoveId).toBe('leaf1');
    expect(result!.targetDepth).toBe(6); // level 2 depth
    expect(result!.startPoint).toBeGreaterThanOrEqual(0);
    expect(result!.startPoint).toBeLessThan(6);
  });

  it('never picks a variation that is already satisfied, even if others are not', () => {
    const done = { ...makeVariation('done', 4), deepestReached: 4 };
    const notDone = makeVariation('notdone', 10);
    // random() always returns 0 -> would pick index 0 if it were a candidate
    const result = pickPracticeAttempt([done, notDone], 1, () => 0);
    expect(result!.variation.leafMoveId).toBe('notdone');
  });
});

describe('splitAttempt', () => {
  it('auto-plays nothing and quizzes through the final required player move when startPoint is 0', () => {
    const v = makeVariation('leaf1', 3);
    const { prefix, quizSteps } = splitAttempt(v.path, 0, 3);
    expect(prefix).toHaveLength(0);
    // v.path has 6 steps (3 player + 3 opponent, alternating, starting on player).
    // quizSteps covers everything through the 3rd (final) player move — index 4 —
    // but excludes the trailing opponent-only step (index 5): 5 steps, not 6.
    expect(quizSteps).toHaveLength(5);
  });

  it('auto-plays the known prefix and quizzes only the remaining moves', () => {
    const v = makeVariation('leaf1', 3);
    // path: [p0(player), o0(opp), p1(player), o1(opp), p2(player), o2(opp)]
    const { prefix, quizSteps } = splitAttempt(v.path, 1, 3);
    expect(prefix.map((s) => s.moveId)).toEqual([v.path[0].moveId, v.path[1].moveId]);
    expect(quizSteps[0].isPlayerTurn).toBe(true);
    expect(quizSteps[0].moveId).toBe(v.path[2].moveId);
  });

  it('stops exactly at the target depths final player move, not beyond', () => {
    const v = makeVariation('leaf1', 5);
    const { quizSteps } = splitAttempt(v.path, 0, 2);
    const lastStep = quizSteps[quizSteps.length - 1];
    expect(lastStep.isPlayerTurn).toBe(true);
    expect(lastStep.moveId).toBe(v.path[2].moveId); // the 2nd player move is at path index 2
  });

  it('throws when targetDepthValue exceeds the number of player moves in the path', () => {
    const v = makeVariation('leaf1', 3);
    expect(() => splitAttempt(v.path, 0, 10)).toThrow();
  });

  it('throws when startPoint is out of range for the path', () => {
    const v = makeVariation('leaf1', 3);
    expect(() => splitAttempt(v.path, 10, 3)).toThrow();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd mychess && npx vitest run src/lib/mastery/practice.test.ts`
Expected: FAIL — `./practice` has no exported members.

- [ ] **Step 3: Implement**

```ts
// mychess/src/lib/mastery/practice.ts
import type { Variation, VariationStep } from './variations';
import { isSatisfied, targetDepth, type Level } from './levels';

export type PracticeVariation = Variation & { deepestReached: number };

export type PracticeAttempt = {
	variation: PracticeVariation;
	startPoint: number;
	targetDepth: number;
};

/**
 * Picks a random not-yet-satisfied variation at `level`, and a random start
 * point between 0 and its target depth (exclusive) — sometimes a full replay
 * from the beginning, usually a shorter tail probe. Returns null once every
 * variation is already satisfied at this level.
 */
export function pickPracticeAttempt(
	variations: PracticeVariation[],
	level: Level,
	random: () => number = Math.random
): PracticeAttempt | null {
	const candidates = variations.filter((v) => !isSatisfied(v, level, v.deepestReached));
	if (candidates.length === 0) return null;

	const chosen = candidates[Math.floor(random() * candidates.length)];
	const target = targetDepth(chosen, level);
	const startPoint = Math.floor(random() * target);

	return { variation: chosen, startPoint, targetDepth: target };
}

/**
 * Splits a variation's path into the auto-played `prefix` (everything before
 * the player's (startPoint+1)th move) and the `quizSteps` the player walks
 * through interactively — their own moves to be checked, with the book's
 * opponent replies auto-played in between — stopping right after the
 * targetDepth-th player move (not continuing into the rest of the line).
 */
export function splitAttempt(
	path: VariationStep[],
	startPoint: number,
	targetDepthValue: number
): { prefix: VariationStep[]; quizSteps: VariationStep[] } {
	const playerIndices: number[] = [];
	path.forEach((step, i) => {
		if (step.isPlayerTurn) playerIndices.push(i);
	});

	const nextPlayerIdx = playerIndices[startPoint];
	const targetPlayerIdx = playerIndices[targetDepthValue - 1];

	if (nextPlayerIdx === undefined || targetPlayerIdx === undefined || startPoint >= targetDepthValue) {
		throw new Error(
			`splitAttempt: startPoint (${startPoint}) and targetDepthValue (${targetDepthValue}) are inconsistent with the given path (${playerIndices.length} player moves found)`
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
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/mastery/practice.ts src/lib/mastery/practice.test.ts
git commit -m "feat: add mastery practice attempt selection and splitting"
git push
```

---

### Task 4: Database migration for progress tracking

**Files:**
- Create: `supabase/migrations/0023_variation_progress.sql`

- [ ] **Step 1: Write the migration**

```sql
-- mychess/supabase/migrations/0023_variation_progress.sql
-- Tracks, per player and per variation, the deepest point the player has
-- successfully played through. Levels are derived from this single number
-- at query time, not stored separately.
--
-- A variation is identified by `variation_key` (the full ordered sequence of
-- move ids along its path, joined by '>'), NOT by leaf_move_id alone: if a
-- repertoire merges games that transpose into a shared position, two
-- genuinely different paths can converge and share an identical tail,
-- ending on the same leaf move. leaf_move_id is kept purely as an
-- informational FK to the variation's final move (e.g. for debugging),
-- not as the uniqueness key.
create table public.variation_progress (
  id                    uuid primary key default gen_random_uuid(),
  player_id             uuid not null references public.profiles(id) on delete cascade,
  repertoire_id         uuid not null references public.repertoires(id) on delete cascade,
  leaf_move_id          uuid not null references public.moves(id) on delete cascade,
  variation_key         text not null,
  deepest_depth_reached int not null default 0,
  updated_at            timestamptz not null default now(),
  unique(player_id, variation_key)
);

alter table public.variation_progress enable row level security;

create policy "variation_progress_player_all" on public.variation_progress
  for all using (player_id = auth.uid());

revoke all on public.variation_progress from anon, public;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/0023_variation_progress.sql
git commit -m "feat: add variation_progress table for mastery levels"
git push
```

- [ ] **Step 3: Ask the user to apply it**

Paste the migration's SQL into the Supabase dashboard SQL editor and run it — this repo has no local Postgres or working service-role key, so migrations are always applied manually (see `mychess/CLAUDE.md`). Later tasks in this plan aren't tested against a live database, but the feature won't work end-to-end in production until this migration is applied.

---

### Task 5: Progress-submission API endpoint

**Files:**
- Create: `src/routes/api/mastery/progress/+server.ts`

**Depends on Task 4** (the table it writes to). Not unit-tested — matches this codebase's convention for thin Supabase I/O wrappers (e.g. `src/routes/api/review/+server.ts`, which this replaces).

- [ ] **Step 1: Implement**

```ts
// mychess/src/routes/api/mastery/progress/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { xpForReview } from '$lib/srs/xp';

export const POST: RequestHandler = async ({ request, locals: { supabase, safeGetSession } }) => {
	const { user } = await safeGetSession();
	if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

	const { repertoireId, leafMoveId, variationKey, depthReached } = await request.json();
	if (!repertoireId || !leafMoveId || !variationKey || typeof depthReached !== 'number') {
		return json({ error: 'Invalid request' }, { status: 400 });
	}

	const { data: existing, error: selectError } = await supabase
		.from('variation_progress')
		.select('deepest_depth_reached')
		.eq('player_id', user.id)
		.eq('variation_key', variationKey)
		.maybeSingle();
	if (selectError) return json({ error: selectError.message }, { status: 500 });

	const oldDepth = existing?.deepest_depth_reached ?? 0;
	const newlyCovered = Math.max(0, depthReached - oldDepth);

	if (newlyCovered > 0) {
		const { error: upsertError } = await supabase.from('variation_progress').upsert(
			{
				player_id: user.id,
				repertoire_id: repertoireId,
				leaf_move_id: leafMoveId,
				variation_key: variationKey,
				deepest_depth_reached: depthReached
			},
			{ onConflict: 'player_id,variation_key' }
		);
		if (upsertError) return json({ error: upsertError.message }, { status: 500 });
	}

	const xpAwarded = newlyCovered * xpForReview(true, false);
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

Note: an upsert error is checked and returned BEFORE the XP RPC runs, so a failed write can never still result in an XP award (a review catch — the original draft didn't check any Supabase call's `error`, which would silently report success and repeat the XP award on retry after a failed write).

- [ ] **Step 2: Run the full test suite and type-check**

Run: `cd mychess && npx vitest run && npm run check`
Expected: all tests pass; `svelte-check` error count unchanged from the pre-existing baseline (12 errors, all in `src/routes/auth/**`).

- [ ] **Step 3: Commit**

```bash
git add src/routes/api/mastery/progress/+server.ts
git commit -m "feat: add mastery progress submission endpoint"
git push
```

---

### Task 6: Practice page server load

**Files:**
- Create: `src/routes/(player)/master/[repertoire_id]/+page.server.ts`

**Depends on Tasks 1, 2, 3.**

- [ ] **Step 1: Implement**

```ts
// mychess/src/routes/(player)/master/[repertoire_id]/+page.server.ts
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { requireAccount } from '$lib/server/auth';
import { mergeRepertoireIds } from '$lib/repertoire';
import { enumerateVariations, type RawMoveRow } from '$lib/mastery/variations';
import { activeLevel, isSatisfied } from '$lib/mastery/levels';
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

	const [{ data: repertoire }, { data: rawMoves }, { data: progressRows }] = await Promise.all([
		supabase.from('repertoires').select('id, name, color').eq('id', repertoireId).single(),
		supabase
			.from('moves')
			.select(
				'id, san, is_player_turn, from_position, to_position, from_pos:from_position(fen), to_pos:to_position(fen)'
			)
			.eq('repertoire_id', repertoireId),
		supabase
			.from('variation_progress')
			.select('variation_key, deepest_depth_reached')
			.eq('player_id', user!.id)
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
	const progressMap = new Map<string, number>(
		(progressRows ?? []).map((p: any) => [p.variation_key, p.deepest_depth_reached])
	);
	const withProgress = variations.map((v) => ({
		...v,
		deepestReached: progressMap.get(v.variationKey) ?? 0
	}));

	const level = activeLevel(withProgress);

	let attempt: {
		leafMoveId: string;
		variationKey: string;
		targetDepth: number;
		prefix: ReturnType<typeof splitAttempt>['prefix'];
		quizSteps: ReturnType<typeof splitAttempt>['quizSteps'];
	} | null = null;
	let satisfiedCount = 0;

	if (level !== 'mastered') {
		satisfiedCount = withProgress.filter((v) => isSatisfied(v, level, v.deepestReached)).length;
		const picked = pickPracticeAttempt(withProgress, level);
		if (picked) {
			const { prefix, quizSteps } = splitAttempt(picked.variation.path, picked.startPoint, picked.targetDepth);
			attempt = {
				leafMoveId: picked.variation.leafMoveId,
				variationKey: picked.variation.variationKey,
				targetDepth: picked.targetDepth,
				prefix,
				quizSteps
			};
		}
	}

	return {
		repertoire,
		level,
		totalVariations: withProgress.length,
		satisfiedCount,
		attempt
	};
};
```

- [ ] **Step 2: Run the full test suite and type-check**

Run: `cd mychess && npx vitest run && npm run check`
Expected: all tests pass (no dedicated test for this file — matches the established convention for Supabase-touching page loaders); `svelte-check` error count unchanged from baseline.

- [ ] **Step 3: Commit**

```bash
git add "src/routes/(player)/master/[repertoire_id]/+page.server.ts"
git commit -m "feat: add mastery practice page server load"
git push
```

---

### Task 7: Practice page UI

**Files:**
- Create: `src/routes/(player)/master/[repertoire_id]/+page.svelte`

**Depends on Task 6**, and reuses `ChessBoard.svelte`, `$lib/engine/stockfish`, `$lib/engine/classify` (all already committed from prior features).

- [ ] **Step 1: Implement**

```svelte
<!-- mychess/src/routes/(player)/master/[repertoire_id]/+page.svelte -->
<script lang="ts">
  import ChessBoard from '$lib/components/ChessBoard.svelte';
  import { Chess } from 'chess.js';
  import type { Key } from 'chessground/types';
  import { playCorrect, playWrong } from '$lib/sounds';
  import { evaluatePosition } from '$lib/engine/stockfish';
  import { evaluateSwing, type MoveQuality } from '$lib/engine/classify';
  import { invalidateAll } from '$app/navigation';
  import { untrack } from 'svelte';

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

  let quizIdx = $state(0);
  let boardFen = $state('');
  let phase = $state<'playing' | 'wrong' | 'success'>('playing');
  let engineLoading = $state(false);
  let engineFeedback = $state<{ swingCp: number; quality: MoveQuality } | null>(null);
  let evalRequestId = 0;
  let sessionXp = $state(0);
  let submitting = $state(false);

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
    engineFeedback = null;
    engineLoading = false;
    if (attempt) {
      boardFen =
        attempt.prefix.length > 0
          ? attempt.prefix[attempt.prefix.length - 1].toFen
          : (attempt.quizSteps[0]?.fromFen ?? '');
      advanceThroughOpponentReplies();
    }
  }

  // Set the board's initial position synchronously, before ChessBoard's own
  // onMount runs — it throws on an empty FEN, and (verified empirically) a
  // child's onMount fires before this component's own $effect does, so
  // waiting for the effect below to set boardFen for the first time is too
  // late.
  resetForAttempt();

  // `attempt` must be the ONLY tracked dependency here. resetForAttempt()
  // reads `quizIdx` (via advanceThroughOpponentReplies), and Svelte's
  // automatic dependency tracking would otherwise also subscribe this effect
  // to quizIdx — meaning handleMove's quizIdx++ on every correct move would
  // re-trigger a full reset back to the start of the attempt. untrack()
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
      advanceThroughOpponentReplies();
      if (quizIdx >= attempt.quizSteps.length) {
        succeed();
      }
      return true;
    } else {
      playWrong();
      phase = 'wrong';
      evaluateWrongMove(step, detail.san);
      return false;
    }
  }

  async function evaluateWrongMove(step: { fromFen: string; san: string }, playedSan: string) {
    const requestId = ++evalRequestId;
    engineFeedback = null;
    engineLoading = true;
    try {
      const bookChess = new Chess(step.fromFen);
      bookChess.move(step.san);
      const playedChess = new Chess(step.fromFen);
      playedChess.move(playedSan);

      const [bookScore, playedScore] = await Promise.all([
        evaluatePosition(bookChess.fen(), 800),
        evaluatePosition(playedChess.fen(), 800)
      ]);
      if (requestId !== evalRequestId) return;
      engineFeedback = evaluateSwing(bookScore, playedScore);
    } catch {
      if (requestId === evalRequestId) engineFeedback = null;
    } finally {
      if (requestId === evalRequestId) engineLoading = false;
    }
  }

  async function succeed() {
    phase = 'success';
    submitting = true;
    try {
      const res = await fetch('/api/mastery/progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repertoireId: data.repertoire.id,
          leafMoveId: attempt.leafMoveId,
          variationKey: attempt.variationKey,
          depthReached: attempt.targetDepth
        })
      });
      const result = await res.json();
      sessionXp += result.xpAwarded ?? 0;
    } catch {
      // XP submission failed — the practice attempt itself still succeeded and
      // is already shown to the player; just skip the XP bump silently rather
      // than blocking their progress on a network hiccup.
    } finally {
      submitting = false;
    }
  }

  async function nextAttempt() {
    evalRequestId++;
    await invalidateAll();
  }
</script>

<svelte:head>
  <title>Master {data.repertoire?.name ?? 'Repertoire'} — MyChess</title>
</svelte:head>

<main class="min-h-screen bg-gray-50 p-4 max-w-lg mx-auto pb-24">
  <div class="flex items-center justify-between mb-4">
    <a href="/master" class="text-gray-400 text-sm hover:text-gray-600">← All Repertoires</a>
    <span class="text-indigo-600 font-bold text-sm">+{sessionXp} XP</span>
  </div>

  {#if data.level === 'mastered'}
    <div class="flex flex-col items-center justify-center min-h-screen gap-6 text-center">
      <p class="text-7xl">🏆</p>
      <h1 class="text-3xl font-bold text-gray-900">Repertoire Mastered!</h1>
      <p class="text-gray-500">Every variation in {data.repertoire?.name} is fully learned.</p>
      <a href="/master" class="bg-indigo-600 text-white px-8 py-4 rounded-2xl font-bold text-lg hover:bg-indigo-700 transition">
        Back to Repertoires
      </a>
    </div>
  {:else if !attempt}
    <div class="flex flex-col items-center justify-center min-h-screen text-center gap-4">
      <p class="text-5xl">📭</p>
      <h1 class="text-2xl font-bold text-gray-700">Nothing to practice</h1>
      <p class="text-gray-400">This repertoire has no moves for your color yet.</p>
      <a href="/master" class="text-indigo-600 hover:underline">Back to Repertoires</a>
    </div>
  {:else}
    <p class="text-center text-gray-400 text-sm font-medium mb-2">
      {data.repertoire?.name} · Level {data.level} · {data.satisfiedCount}/{data.totalVariations} solved
    </p>
    <p class="text-center text-gray-700 font-semibold mb-4">
      {phase === 'playing' ? 'What is the best move?' : ''}
    </p>

    <ChessBoard fen={boardFen} interactable={phase === 'playing'} onmove={handleMove} />

    {#if phase === 'wrong'}
      <div class="mt-6 p-5 bg-white border border-gray-200 rounded-2xl text-center shadow-sm">
        <p class="text-xl font-bold mb-1 text-gray-700">Not quite — back to the start of this line</p>
        {#if engineLoading}
          <p class="text-sm text-gray-400 mt-2">Evaluating…</p>
        {:else if engineFeedback}
          <p class="text-sm mt-2 font-semibold {QUALITY_COLOR[engineFeedback.quality]}">
            {QUALITY_LABEL[engineFeedback.quality]}{#if engineFeedback.quality !== 'fine'} (−{engineFeedback.swingCp}cp){/if}
          </p>
        {/if}
        <button onclick={nextAttempt}
                class="mt-4 w-full bg-indigo-600 text-white py-4 rounded-xl font-bold text-lg hover:bg-indigo-700 transition">
          Try Again
        </button>
      </div>
    {:else if phase === 'success'}
      <div class="mt-6 p-5 bg-white border border-gray-200 rounded-2xl text-center shadow-sm">
        <p class="text-xl font-bold mb-1 text-green-600">✅ Solved!</p>
        <button onclick={nextAttempt} disabled={submitting}
                class="mt-4 w-full bg-indigo-600 text-white py-4 rounded-xl font-bold text-lg hover:bg-indigo-700 transition disabled:opacity-50">
          Continue
        </button>
      </div>
    {/if}
  {/if}
</main>
```

- [ ] **Step 2: Run the full test suite and type-check**

Run: `cd mychess && npx vitest run && npm run check`
Expected: all tests pass; `svelte-check` error count unchanged from baseline.

- [ ] **Step 3: Manual browser check**

There's no automated test for this interactive page. Verify manually: open `/master/<a-repertoire-id-you-own-or-are-assigned>`, confirm the board shows the correct auto-played prefix, play through correctly and confirm "Solved!" + XP + "Continue" loads a fresh attempt, then deliberately play a wrong move and confirm the Stockfish feedback shows and "Try Again" loads a fresh attempt without having saved any progress.

- [ ] **Step 4: Commit**

```bash
git add "src/routes/(player)/master/[repertoire_id]/+page.svelte"
git commit -m "feat: add mastery practice page UI"
git push
```

---

### Task 8: Repertoire picker page

**Files:**
- Create: `src/routes/(player)/master/+page.server.ts`
- Create: `src/routes/(player)/master/+page.svelte`

**Depends on Tasks 1, 2.**

- [ ] **Step 1: Implement the server load**

```ts
// mychess/src/routes/(player)/master/+page.server.ts
import type { PageServerLoad } from './$types';
import { requireAccount } from '$lib/server/auth';
import { enumerateVariations, type RawMoveRow } from '$lib/mastery/variations';
import { activeLevel } from '$lib/mastery/levels';

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
	const [{ data: rawMoves }, { data: progressRows }] = await Promise.all([
		supabase
			.from('moves')
			.select('id, san, is_player_turn, repertoire_id, from_position, to_position')
			.in('repertoire_id', repIds),
		supabase
			.from('variation_progress')
			.select('repertoire_id, variation_key, deepest_depth_reached')
			.eq('player_id', user!.id)
			.in('repertoire_id', repIds)
	]);

	// This page only needs `level`/`totalVariations`, both derived purely from
	// moveId/isPlayerTurn — never from FEN — so the fen columns aren't fetched
	// here (unlike the [repertoire_id] detail page, which needs them to render
	// the board).
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

	const progressByRep = new Map<string, Map<string, number>>();
	for (const p of (progressRows ?? []) as any[]) {
		const map = progressByRep.get(p.repertoire_id) ?? new Map<string, number>();
		map.set(p.variation_key, p.deepest_depth_reached);
		progressByRep.set(p.repertoire_id, map);
	}

	const repertoires = allReps.map((r: any) => {
		const moves = movesByRep.get(r.id) ?? [];
		const variations = enumerateVariations(moves);
		const progressMap = progressByRep.get(r.id) ?? new Map<string, number>();
		const withProgress = variations.map((v) => ({
			...v,
			deepestReached: progressMap.get(v.variationKey) ?? 0
		}));
		return {
			id: r.id,
			name: r.name,
			color: r.color,
			level: activeLevel(withProgress),
			totalVariations: withProgress.length
		};
	});

	return { repertoires };
};
```

- [ ] **Step 2: Implement the picker UI**

```svelte
<!-- mychess/src/routes/(player)/master/+page.svelte -->
<script lang="ts">
  let { data } = $props<{ data: { repertoires: any[] } }>();
</script>

<svelte:head>
  <title>Master Your Repertoires — MyChess</title>
</svelte:head>

<main class="min-h-screen bg-gray-50">
  <div class="max-w-2xl mx-auto px-4 py-6">
    <h1 class="text-2xl font-bold text-gray-900 mb-4">Master Your Repertoires</h1>

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
            <a href="/master/{rep.id}"
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
                    Level {rep.level} · {rep.totalVariations} variations
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

- [ ] **Step 4: Commit**

```bash
git add "src/routes/(player)/master/+page.server.ts" "src/routes/(player)/master/+page.svelte"
git commit -m "feat: add repertoire mastery picker page"
git push
```

---

### Task 9: Navigation updates

**Files:**
- Modify: `src/lib/components/NavBar.svelte`
- Modify: `src/lib/components/QuickActions.svelte`

**Depends on Task 8** (the routes being linked to must exist).

- [ ] **Step 1: Update the desktop nav link**

In `src/lib/components/NavBar.svelte`, change:

```svelte
        <a href="/learn" class={linkClass(['/learn', '/drill', '/practice', '/time-trial'])}>Learn</a>
```

to:

```svelte
        <a href="/master" class={linkClass(['/master', '/drill', '/practice', '/time-trial'])}>Master</a>
```

- [ ] **Step 2: Update the mobile nav link**

In the same file, change:

```svelte
        <a href="/learn" onclick={() => mobileMenuOpen = false} class="text-gray-700">Learn</a>
```

to:

```svelte
        <a href="/master" onclick={() => mobileMenuOpen = false} class="text-gray-700">Master</a>
```

- [ ] **Step 3: Update the dashboard quick action**

In `src/lib/components/QuickActions.svelte`, change:

```ts
  let { totalReviews = 0 } = $props<{ totalReviews?: number }>();

  const actions = [
    {
      href: '/learn',
      label: 'Daily Review',
      sublabel: `${totalReviews} cards done`,
      primary: true
    },
    { href: '/practice', label: 'Practice', sublabel: 'Full board', primary: false },
    { href: '/drill',    label: 'Drill',    sublabel: 'No mistakes', primary: false },
    { href: '/time-trial', label: 'Time Trial', sublabel: '60 seconds', primary: false }
  ];
```

to:

```ts
  const actions = [
    {
      href: '/master',
      label: 'Master',
      sublabel: 'Learn a repertoire',
      primary: true
    },
    { href: '/practice', label: 'Practice', sublabel: 'Full board', primary: false },
    { href: '/drill',    label: 'Drill',    sublabel: 'No mistakes', primary: false },
    { href: '/time-trial', label: 'Time Trial', sublabel: '60 seconds', primary: false }
  ];
```

Note the `totalReviews` prop is now unused by this component — remove the `let { totalReviews = 0 } = $props<{ totalReviews?: number }>();` line entirely (replace with nothing, i.e. delete that line). Its caller (`src/routes/(player)/+page.svelte`) still passes `totalReviews={stats.total_reviews ?? 0}` as a prop — that's harmless (Svelte ignores an unused prop passed to a component that no longer declares it) and is out of scope for this task to clean up; it's cosmetic dead wiring, not a bug.

- [ ] **Step 4: Run the full test suite and type-check**

Run: `cd mychess && npx vitest run && npm run check`
Expected: all tests pass; `svelte-check` error count unchanged from baseline.

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/NavBar.svelte src/lib/components/QuickActions.svelte
git commit -m "feat: point navigation at the new mastery mode instead of Learn"
git push
```

---

### Task 10: Remove the old Learn/FSRS system

**Files:**
- Delete: `src/routes/(player)/learn/+page.server.ts`
- Delete: `src/routes/(player)/learn/+page.svelte`
- Delete: `src/routes/api/review/+server.ts`
- Delete: `src/lib/srs/queue.ts`
- Delete: `src/lib/srs/queue.test.ts`
- Delete: `src/lib/srs/fsrs.ts`
- Delete: `src/lib/srs/fsrs.test.ts`
- Modify: `src/routes/(player)/drill/+page.server.ts` (remove a dead import)

**Depends on Task 9** (nothing should still link to `/learn` before it's removed).

This is safe per the investigation in the design spec: `/api/review` never actually persisted FSRS scheduling fields (only `last_review`), so the spaced-repetition math has never worked in production, and `total_reviews`/`moves_learned`-based badges were already unearnable regardless of Learn usage. Nothing else in the codebase depends on `queue.ts` or `fsrs.ts` except the files being deleted here and one dead import in `drill/+page.server.ts`.

- [ ] **Step 1: Delete the old Learn route**

```bash
cd mychess
rm -rf "src/routes/(player)/learn"
```

- [ ] **Step 2: Delete the old review API endpoint**

```bash
rm -rf src/routes/api/review
```

- [ ] **Step 3: Delete the FSRS scheduling modules**

```bash
rm src/lib/srs/queue.ts src/lib/srs/queue.test.ts
rm src/lib/srs/fsrs.ts src/lib/srs/fsrs.test.ts
```

- [ ] **Step 4: Remove the dead import in Drill**

In `src/routes/(player)/drill/+page.server.ts`, remove these two lines from the top of the file (they are not used anywhere else in the file — `newCard` and `Card` are never referenced):

```ts
import { newCard } from '$lib/srs/fsrs';
import type { Card } from '$lib/srs/fsrs';
```

- [ ] **Step 5: Run the full test suite and type-check**

Run: `cd mychess && npx vitest run && npm run check`
Expected: all tests pass (with the ~13 tests that lived in `queue.test.ts`/`fsrs.test.ts` now gone — the total count will be lower than before this task, that's expected); `svelte-check` error count unchanged from the pre-existing baseline (12 errors, all in `src/routes/auth/**`) — specifically confirm no NEW errors appear from a leftover reference to a deleted module anywhere.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: remove the old FSRS-based Learn system, superseded by mastery levels"
git push
```

---

### Task 11: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `cd mychess && npx vitest run`
Expected: all tests pass. (Exact count will be lower than the pre-feature baseline once Task 10's ~13 deleted FSRS tests are subtracted, offset by this feature's own new tests from Tasks 1–3 — confirm 0 failures, don't worry about matching an exact number.)

- [ ] **Step 2: Run the type-check**

Run: `cd mychess && npm run check`
Expected: error count unchanged from the pre-existing 12-error baseline (all in `src/routes/auth/**`), no new errors, and no leftover references to any deleted module.

- [ ] **Step 3: Grep for any remaining references to deleted modules**

Run: `cd mychess && grep -rn "srs/fsrs\|srs/queue\|/api/review" src/ --include="*.ts" --include="*.svelte"`
Expected: no matches (confirms nothing still imports the deleted FSRS modules or calls the deleted API route).

- [ ] **Step 4: Manual browser check**

Confirm end-to-end: `/master` lists repertoires with a level/progress summary; opening one starts a practice attempt at Level 1; solving all Level 1 variations advances to Level 2; a coach-assigned repertoire (from a different player account, if available) shows up in the assigned player's `/master` list exactly like an owned one; the "Learn" nav link is gone and "Master" takes its place.

- [ ] **Step 5: Remind the user about the pending migration**

If not already confirmed, remind the user to apply `supabase/migrations/0023_variation_progress.sql` via the Supabase SQL editor — without it, `/api/mastery/progress` and the `/master` pages' progress queries will fail with a missing-table error.
