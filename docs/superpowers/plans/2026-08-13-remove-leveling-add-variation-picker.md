# Remove Leveling, Add Solved-Count and Variation Picker — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove leveling/chunking from Practice mode entirely. A practice attempt is always the full variation, start to finish. Progress becomes a permanent "M of N variations solved" count. A new picker (repertoire → chapter → move-group → variation) lets a player jump to any specific variation, which becomes the new active one.

**Architecture:** This is mostly deletion. `src/lib/mastery/levels.ts` and most of `levelProgress.ts` are deleted outright — nothing in the new model needs a "level" concept. `variationSequence.ts` is kept but rewritten around a simple boolean "is this variation in the solved set" instead of "is `row.level` past this variation's cap." `practice.ts` loses its queue/chunk/branch-alternative machinery (closing out issue #61's dead code as part of the same pass) and becomes a thin "the whole variation's path is the quiz" helper. The DB's `level_progress` table (level/queue/demotion/version) is replaced by two much simpler tables: `practice_active_variation` (just a pointer) and `variation_solved` (a permanent, presence-based set, mirroring the existing `variation_practice_exclusions` pattern). A new `VariationPicker.svelte` component adds the manual-selection UI, grouping a chapter's variations by their top-5-most-frequent first move (stable tie-break by first appearance order).

**Tech Stack:** SvelteKit 2 + Svelte 5 (runes), Supabase (Postgres + RLS), Vitest, all within the existing `mychess/` app (working directory for every command below).

**PRD:** `docs/superpowers/specs/2026-08-13-mastery-per-variation-practice-redesign-prd.md`
**Builds on:** `docs/superpowers/plans/2026-08-13-variation-sequenced-practice-depth.md` (already shipped — this plan removes the leveling layer it added, keeps the sequential/active-variation idea)
**GitHub issue:** [tomyka/mychess#62](https://github.com/tomyka/mychess/issues/62) (also closes out #61's dead-code removal)

All file paths below are relative to `mychess/` (the SvelteKit app directory — one level below the repo root).

---

### Task 1: Migration — drop leveling schema, add `practice_active_variation` and `variation_solved`

**Files:**
- Create: `supabase/migrations/0045_remove_leveling_add_solved.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- mychess/supabase/migrations/0045_remove_leveling_add_solved.sql
-- Removes leveling/chunking from Practice entirely (see
-- docs/superpowers/plans/2026-08-13-remove-leveling-add-variation-picker.md)
-- and replaces it with two simpler concepts:
--
-- 1. practice_active_variation: which ONE variation a player is currently
--    drilling for a repertoire — same idea as level_progress.active_variation_key,
--    now on its own table with nothing else attached to it. No optimistic-
--    concurrency version column: unlike the old level/queue state (which
--    could be corrupted by two concurrent writers disagreeing on level
--    math), a plain last-write-wins on "which key is active" is a benign
--    outcome even under a genuine race — worst case one of two near-
--    simultaneous picks briefly loses to the other.
-- 2. variation_solved: a permanent, presence-based fact ("this player has
--    replayed this variation cleanly at least once") — mirrors the existing
--    variation_practice_exclusions table's presence-means-X pattern. Once a
--    row exists it is never deleted by the app; solved is a one-way flag.
drop table if exists public.level_progress;

create table public.practice_active_variation (
  id                  uuid primary key default gen_random_uuid(),
  player_id           uuid not null references public.profiles(id) on delete cascade,
  repertoire_id       uuid not null references public.repertoires(id) on delete cascade,
  active_variation_key text,
  updated_at          timestamptz not null default now(),
  unique (player_id, repertoire_id)
);

alter table public.practice_active_variation enable row level security;

create policy "practice_active_variation_player_all" on public.practice_active_variation
  for all using (player_id = auth.uid());

create policy practice_active_variation_coach_read on public.practice_active_variation for select using (
  exists (
    select 1 from public.coach_players cp
    where cp.player_id = practice_active_variation.player_id
      and cp.coach_id = auth.uid()
      and cp.status = 'active'
  )
);

revoke all on public.practice_active_variation from anon, public;

create table public.variation_solved (
  id            uuid primary key default gen_random_uuid(),
  player_id     uuid not null references public.profiles(id) on delete cascade,
  repertoire_id uuid not null references public.repertoires(id) on delete cascade,
  variation_key text not null,
  solved_at     timestamptz not null default now(),
  unique (player_id, variation_key)
);

create index variation_solved_player_repertoire_idx
  on public.variation_solved (player_id, repertoire_id);

alter table public.variation_solved enable row level security;

create policy "variation_solved_player_all" on public.variation_solved
  for all using (player_id = auth.uid());

create policy variation_solved_coach_read on public.variation_solved for select using (
  exists (
    select 1 from public.coach_players cp
    where cp.player_id = variation_solved.player_id
      and cp.coach_id = auth.uid()
      and cp.status = 'active'
  )
);

revoke all on public.variation_solved from anon, public;

-- Leveling-specific repertoire columns — nothing reads these once this plan
-- lands. total_variations stays (still a valid cached count, unrelated to
-- leveling).
alter table public.repertoires drop column if exists chunk_size;
alter table public.repertoires drop column if exists practice_depth_levels;
alter table public.repertoires drop column if exists total_levels;
alter table public.repertoires drop column if exists level1_task_count;

-- Write-only column: confirmed by reading src/lib/server/practice-report.ts
-- that no report query ever selects move_attempts.level. Safe to drop outright.
alter table public.move_attempts drop column if exists level;
```

- [ ] **Step 2: Hand off to the user**

Per this repo's convention (`CLAUDE.md` — no local Postgres/service-role key available), paste the file's contents to the user and ask them to run it in the Supabase dashboard SQL editor before continuing. Do not proceed to rely on the new tables (or the dropped columns actually being gone) until they confirm.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0045_remove_leveling_add_solved.sql
git commit -m "feat: drop leveling schema, add practice_active_variation and variation_solved"
```

---

### Task 2: `variations.ts` — add `groupVariationsByFirstMove`

**Files:**
- Modify: `src/lib/mastery/variations.ts`
- Modify: `src/lib/mastery/variations.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/mastery/variations.test.ts` (new `describe` block at the end of the file; it already imports `enumerateVariations`, so just add `groupVariationsByFirstMove` to that same import line):

```ts
describe('groupVariationsByFirstMove', () => {
	function withFirstMove(san: string, key: string): Variation {
		return {
			leafMoveId: key,
			variationKey: key,
			path: [{ moveId: key, san, fromFen: 'f', toFen: 'f2', isPlayerTurn: true }],
			playerMoveCount: 1
		};
	}

	it('groups variations by their first move, most frequent first', () => {
		const variations = [withFirstMove('e4', 'a'), withFirstMove('e4', 'b'), withFirstMove('d4', 'c')];
		const groups = groupVariationsByFirstMove(variations, 5);
		expect(groups.map((g) => g.move)).toEqual(['e4', 'd4']);
		expect(groups[0].items.map((v) => v.variationKey)).toEqual(['a', 'b']);
		expect(groups[1].items.map((v) => v.variationKey)).toEqual(['c']);
	});

	it('caps at topN groups, bucketing everything else under "Other" (move: null)', () => {
		const variations = [
			withFirstMove('e4', 'a'),
			withFirstMove('e4', 'b'),
			withFirstMove('d4', 'c'),
			withFirstMove('c4', 'd'),
			withFirstMove('Nf3', 'e'),
			withFirstMove('g3', 'f'),
			withFirstMove('b3', 'g') // 6th distinct first move — bumped to Other
		];
		const groups = groupVariationsByFirstMove(variations, 5);
		expect(groups).toHaveLength(6); // 5 named + Other
		expect(groups[5].move).toBeNull();
		expect(groups[5].items.map((v) => v.variationKey)).toEqual(['g']);
	});

	it('omits the "Other" group entirely when every variation fits in the top N', () => {
		const variations = [withFirstMove('e4', 'a'), withFirstMove('d4', 'b')];
		const groups = groupVariationsByFirstMove(variations, 5);
		expect(groups.every((g) => g.move !== null)).toBe(true);
	});

	it('breaks ties in frequency by first-appearance order (stable, deterministic)', () => {
		// e4, d4, c4 all appear exactly once each — with topN 2, only e4 and d4
		// (the first two distinct moves to appear) should make the cut, not c4.
		const variations = [withFirstMove('e4', 'a'), withFirstMove('d4', 'b'), withFirstMove('c4', 'c')];
		const groups = groupVariationsByFirstMove(variations, 2);
		expect(groups.map((g) => g.move)).toEqual(['e4', 'd4', null]);
		expect(groups[groups.length - 1].move).toBeNull(); // c4 bucketed to Other
		expect(groups[groups.length - 1].items.map((v) => v.variationKey)).toEqual(['c']);
	});

	it('returns an empty array for an empty variation list', () => {
		expect(groupVariationsByFirstMove([], 5)).toEqual([]);
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/mastery/variations.test.ts`
Expected: FAIL — `groupVariationsByFirstMove` doesn't exist yet.

- [ ] **Step 3: Implement**

Add to `src/lib/mastery/variations.ts` (after `moveSequenceLabel`). Generic over the item type (not hardcoded to `Variation`) and takes a `firstMoveOf` accessor, specifically so `VariationPicker.svelte` (Task 13) can reuse this SAME function against the `/api/repertoires/[id]/variations` endpoint's response rows (which carry `firstMoveSan` directly, not a full `path`) instead of reimplementing the bucketing logic a second time:

```ts
export type MoveGroup<T> = {
	// null identifies the "Other" bucket — every item whose first move didn't
	// make the top N by frequency.
	move: string | null;
	items: T[];
};

/**
 * Buckets `items` by whatever `firstMoveOf` returns for each one, keeping
 * only the `topN` most frequent distinct first moves as their own named
 * groups (in descending frequency order) and collapsing everything else into
 * one trailing "Other" group (`move: null`) — omitted entirely if nothing
 * landed there. Ties in frequency are broken by first-appearance order in
 * `items` (stable, deterministic — `Array.prototype.sort` is
 * spec-guaranteed stable), so re-running this against the same input always
 * produces the same grouping.
 */
export function groupByFirstMove<T>(items: T[], firstMoveOf: (item: T) => string | null, topN: number): MoveGroup<T>[] {
	const firstAppearanceOrder: string[] = [];
	const counts = new Map<string, number>();
	for (const item of items) {
		const san = firstMoveOf(item);
		if (!san) continue;
		if (!counts.has(san)) firstAppearanceOrder.push(san);
		counts.set(san, (counts.get(san) ?? 0) + 1);
	}

	const topMoves = firstAppearanceOrder
		.slice()
		.sort((a, b) => counts.get(b)! - counts.get(a)!)
		.slice(0, topN);
	const topMoveSet = new Set(topMoves);

	const groups: MoveGroup<T>[] = topMoves.map((move) => ({ move, items: [] }));
	const groupByMove = new Map(groups.map((g) => [g.move, g]));
	const other: MoveGroup<T> = { move: null, items: [] };

	for (const item of items) {
		const san = firstMoveOf(item);
		const target = san && topMoveSet.has(san) ? groupByMove.get(san)! : other;
		target.items.push(item);
	}

	return other.items.length > 0 ? [...groups, other] : groups;
}

/** `groupByFirstMove` specialized for `Variation[]`, using each variation's own first move (`path[0].san`). */
export function groupVariationsByFirstMove(variations: Variation[], topN: number): MoveGroup<Variation>[] {
	return groupByFirstMove(variations, (v) => v.path[0]?.san ?? null, topN);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/mastery/variations.test.ts`
Expected: PASS (all tests, old and new)

- [ ] **Step 5: Commit**

```bash
git add src/lib/mastery/variations.ts src/lib/mastery/variations.test.ts
git commit -m "feat: add groupVariationsByFirstMove for the variation picker"
```

---

### Task 3: Delete `levels.ts` and `tags.ts` (and their tests)

**Files:**
- Delete: `src/lib/mastery/levels.ts`
- Delete: `src/lib/mastery/levels.test.ts`
- Delete: `src/lib/mastery/tags.ts`
- Delete: `src/lib/mastery/tags.test.ts`

- [ ] **Step 1: Confirm nothing outside this plan's later tasks still imports these**

```bash
grep -rl "from '\$lib/mastery/levels'" src/ --include='*.ts' --include='*.svelte'
grep -rl "from '\$lib/mastery/tags'" src/ --include='*.ts' --include='*.svelte'
```

Expected output: only `src/lib/mastery/levelProgress.ts`, `src/lib/mastery/practice.ts` (for `levels.ts`) and `src/routes/(player)/practice/[repertoire_id]/+page.svelte`, `src/lib/components/LevelList.svelte` (for `tags.ts`) — all of which are rewritten or deleted by later tasks in this same plan (Tasks 5, 6, 12). If anything else shows up, stop and investigate before deleting.

- [ ] **Step 2: Delete the four files**

```bash
git rm src/lib/mastery/levels.ts src/lib/mastery/levels.test.ts src/lib/mastery/tags.ts src/lib/mastery/tags.test.ts
```

- [ ] **Step 3: Commit**

```bash
git commit -m "chore: delete levels.ts and tags.ts — no level concept left to support"
```

(Type errors from the still-existing callers are expected until Tasks 5-6-12 land — this task is purely the deletion, matching this plan's own dependency order below.)

---

### Task 4: Rewrite `variationSequence.ts` around the solved set

**Files:**
- Modify: `src/lib/mastery/variationSequence.ts`
- Modify: `src/lib/mastery/variationSequence.test.ts`

- [ ] **Step 1: Replace the test file in full**

```ts
// mychess/src/lib/mastery/variationSequence.test.ts
import { describe, it, expect } from 'vitest';
import { pickActiveVariation, nextVariation, advanceIfSolved, solvedProgress } from './variationSequence';
import type { Variation } from './variations';

function variation(key: string): Variation {
	return {
		leafMoveId: key,
		variationKey: key,
		path: [{ moveId: key, san: 'e4', fromFen: 'f', toFen: 'f2', isPlayerTurn: true }],
		playerMoveCount: 1
	};
}

describe('pickActiveVariation', () => {
	it('returns null for an empty variation list', () => {
		expect(pickActiveVariation([], null, new Set())).toBeNull();
	});

	it('defaults to the first UNSOLVED variation when no key is given', () => {
		const a = variation('a');
		const b = variation('b');
		expect(pickActiveVariation([a, b], null, new Set(['a']))).toBe(b);
	});

	it('defaults to the very first variation when everything is already solved', () => {
		const a = variation('a');
		const b = variation('b');
		expect(pickActiveVariation([a, b], null, new Set(['a', 'b']))).toBe(a);
	});

	it('returns the variation matching a given key, even if it is already solved (manual re-drill)', () => {
		const a = variation('a');
		const b = variation('b');
		expect(pickActiveVariation([a, b], 'b', new Set(['b']))).toBe(b);
	});

	it('falls back to the first unsolved variation when the key no longer matches anything', () => {
		const a = variation('a');
		const b = variation('b');
		expect(pickActiveVariation([a, b], 'stale-key', new Set(['a']))).toBe(b);
	});
});

describe('nextVariation', () => {
	it('returns the variation right after the given key', () => {
		const a = variation('a');
		const b = variation('b');
		const c = variation('c');
		expect(nextVariation([a, b, c], 'a')).toBe(b);
	});

	it('returns null when the given key is the last variation', () => {
		const a = variation('a');
		const b = variation('b');
		expect(nextVariation([a, b], 'b')).toBeNull();
	});

	it('returns null when the given key is not found', () => {
		const a = variation('a');
		expect(nextVariation([a], 'no-such-key')).toBeNull();
	});
});

describe('advanceIfSolved', () => {
	it('returns the next UNSOLVED variation\'s key after the given one', () => {
		const a = variation('a');
		const b = variation('b');
		const c = variation('c');
		expect(advanceIfSolved('a', [a, b, c], new Set(['a']))).toBe('b');
	});

	it('skips over variations that are ALSO already solved (e.g. solved earlier via manual re-drill)', () => {
		const a = variation('a');
		const b = variation('b');
		const c = variation('c');
		expect(advanceIfSolved('a', [a, b, c], new Set(['a', 'b']))).toBe('c');
	});

	it('returns null when every remaining variation is already solved (whole repertoire done)', () => {
		const a = variation('a');
		const b = variation('b');
		expect(advanceIfSolved('a', [a, b], new Set(['a', 'b']))).toBeNull();
	});

	it('returns null when the given key is the last variation in sequence', () => {
		const a = variation('a');
		const b = variation('b');
		expect(advanceIfSolved('b', [a, b], new Set(['a', 'b']))).toBeNull();
	});
});

describe('solvedProgress', () => {
	it('counts solved vs total across the whole variation list', () => {
		const a = variation('a');
		const b = variation('b');
		const c = variation('c');
		expect(solvedProgress([a, b, c], new Set(['a', 'c']))).toEqual({ solved: 2, total: 3 });
	});

	it('is zero of zero for an empty variation list', () => {
		expect(solvedProgress([], new Set())).toEqual({ solved: 0, total: 0 });
	});

	it('does not count a solved key that no longer matches any variation (stale, e.g. repertoire edited)', () => {
		const a = variation('a');
		expect(solvedProgress([a], new Set(['a', 'stale-key']))).toEqual({ solved: 1, total: 1 });
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/mastery/variationSequence.test.ts`
Expected: FAIL — old exports (`advanceVariationIfMastered`, `variationSequenceProgress`) don't match the new imports; `advanceIfSolved`/`solvedProgress` don't exist yet.

- [ ] **Step 3: Replace the implementation in full**

```ts
// mychess/src/lib/mastery/variationSequence.ts
import type { Variation } from './variations';

/**
 * The ONE variation currently active for a repertoire. If `activeVariationKey`
 * matches a real variation, that variation wins outright — even if it's
 * already solved (a player can deliberately re-drill something they've
 * solved; see the PRD's "solved variations remain pickable" acceptance
 * criterion). Only when there's NO key, or the key no longer matches
 * anything (a repertoire edited, or a variation excluded, since it was last
 * stored — the same self-healing fallback `variation_practice_exclusions`-
 * style tables already need), does this fall back to the first UNSOLVED
 * variation in sequence — or, if everything is solved, the very first
 * variation overall (there's nothing more useful to default to).
 */
export function pickActiveVariation(
	variations: Variation[],
	activeVariationKey: string | null,
	solvedKeys: ReadonlySet<string>
): Variation | null {
	if (variations.length === 0) return null;
	if (activeVariationKey) {
		const found = variations.find((v) => v.variationKey === activeVariationKey);
		if (found) return found;
	}
	return variations.find((v) => !solvedKeys.has(v.variationKey)) ?? variations[0];
}

/** The variation immediately after `currentKey` in `variations`' own order, or null if it's the last one (or not found). */
export function nextVariation(variations: Variation[], currentKey: string): Variation | null {
	const index = variations.findIndex((v) => v.variationKey === currentKey);
	if (index === -1 || index + 1 >= variations.length) return null;
	return variations[index + 1];
}

/**
 * Called right after `activeVariationKey` has just been marked solved — the
 * next UNSOLVED variation in sequence after it, skipping over any later
 * variation that's ALSO already solved (e.g. a player solved it earlier via
 * manual re-drill, out of order). `null` means every remaining variation is
 * already solved: the whole repertoire is done.
 */
export function advanceIfSolved(
	activeVariationKey: string,
	variations: Variation[],
	solvedKeys: ReadonlySet<string>
): string | null {
	let candidate = nextVariation(variations, activeVariationKey);
	while (candidate && solvedKeys.has(candidate.variationKey)) {
		candidate = nextVariation(variations, candidate.variationKey);
	}
	return candidate?.variationKey ?? null;
}

/** "M of N variations solved" — the repertoire-wide progress number, independent of which one is currently active. */
export function solvedProgress(variations: Variation[], solvedKeys: ReadonlySet<string>): { solved: number; total: number } {
	return {
		solved: variations.filter((v) => solvedKeys.has(v.variationKey)).length,
		total: variations.length
	};
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/mastery/variationSequence.test.ts`
Expected: PASS

Do not run the full suite yet — `levelProgress.ts`, `practice.ts`, and their tests still reference the OLD exports of this file (and `levelProgress.ts` itself). That's expected breakage, fixed by Tasks 5-6.

- [ ] **Step 5: Commit**

```bash
git add src/lib/mastery/variationSequence.ts src/lib/mastery/variationSequence.test.ts
git commit -m "feat: rewrite variationSequence.ts around the solved set instead of levels"
```

---

### Task 5: Delete `levelProgress.ts` (and its test)

**Files:**
- Delete: `src/lib/mastery/levelProgress.ts`
- Delete: `src/lib/mastery/levelProgress.test.ts`

- [ ] **Step 1: Confirm nothing outside this plan's later tasks still imports it**

```bash
grep -rl "from '\$lib/mastery/levelProgress'" src/ --include='*.ts' --include='*.svelte'
```

Expected output: `src/lib/mastery/practice.ts`, `src/lib/server/level-progress.ts`, `src/lib/server/repertoire-progress.ts`, `src/routes/(player)/practice/[repertoire_id]/+page.server.ts`, `src/routes/(player)/practice/[repertoire_id]/+page.svelte` — all rewritten by Tasks 6, 7, 9, 11, 12. If anything else shows up, stop and investigate.

- [ ] **Step 2: Delete both files**

```bash
git rm src/lib/mastery/levelProgress.ts src/lib/mastery/levelProgress.test.ts
```

- [ ] **Step 3: Commit**

```bash
git commit -m "chore: delete levelProgress.ts — queue/demotion/level-advance machinery no longer exists"
```

---

### Task 6: Rewrite `practice.ts` — full-replay attempts, no queue/branches

**Files:**
- Modify: `src/lib/mastery/practice.ts`
- Modify: `src/lib/mastery/practice.test.ts`

- [ ] **Step 1: Replace the test file in full**

```ts
// mychess/src/lib/mastery/practice.test.ts
import { describe, it, expect } from 'vitest';
import { buildPracticeView } from './practice';
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

describe('buildPracticeView', () => {
	it('serves the active variation\'s FULL path as the attempt, unsplit', () => {
		const v = makeVariation(3, 'a-');
		const view = buildPracticeView([v], null, new Set());
		expect(view.attempt).not.toBeNull();
		expect(view.attempt!.variationKey).toBe(v.variationKey);
		expect(view.attempt!.path).toEqual(v.path); // whole path, no auto-play split
	});

	it('defaults to the first unsolved variation when no active key is set', () => {
		const a = makeVariation(2, 'a-');
		const b = makeVariation(2, 'b-');
		const view = buildPracticeView([a, b], null, new Set([a.variationKey]));
		expect(view.attempt!.variationKey).toBe(b.variationKey);
	});

	it('respects an explicit active key even if it points at an already-solved variation', () => {
		const a = makeVariation(2, 'a-');
		const b = makeVariation(2, 'b-');
		const view = buildPracticeView([a, b], a.variationKey, new Set([a.variationKey]));
		expect(view.attempt!.variationKey).toBe(a.variationKey);
	});

	it('reports solved/total across the whole repertoire', () => {
		const a = makeVariation(2, 'a-');
		const b = makeVariation(2, 'b-');
		const c = makeVariation(2, 'c-');
		const view = buildPracticeView([a, b, c], null, new Set([a.variationKey]));
		expect(view.solved).toBe(1);
		expect(view.total).toBe(3);
	});

	it('returns a null attempt and allSolved=true once every variation is solved', () => {
		const a = makeVariation(2, 'a-');
		const view = buildPracticeView([a], null, new Set([a.variationKey]));
		expect(view.attempt).toBeNull();
		expect(view.allSolved).toBe(true);
		expect(view.solved).toBe(1);
		expect(view.total).toBe(1);
	});

	it('returns the vacuous empty-repertoire shape for no variations at all', () => {
		const view = buildPracticeView([], null, new Set());
		expect(view.attempt).toBeNull();
		expect(view.allSolved).toBe(true);
		expect(view.solved).toBe(0);
		expect(view.total).toBe(0);
	});

	it('allSolved is false while ANY variation (including a manually re-picked solved one) still has unsolved siblings', () => {
		const a = makeVariation(2, 'a-');
		const b = makeVariation(2, 'b-');
		// a is solved and explicitly re-picked, but b isn't solved yet.
		const view = buildPracticeView([a, b], a.variationKey, new Set([a.variationKey]));
		expect(view.attempt!.variationKey).toBe(a.variationKey); // respects the manual pick
		expect(view.allSolved).toBe(false); // but the repertoire as a whole isn't done
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/mastery/practice.test.ts`
Expected: FAIL — old exports don't match.

- [ ] **Step 3: Replace the implementation in full**

```ts
// mychess/src/lib/mastery/practice.ts
import type { Variation, VariationStep } from './variations';
import { pickActiveVariation, solvedProgress } from './variationSequence';

export type PracticeView = {
	attempt: { path: VariationStep[]; variationKey: string } | null;
	solved: number;
	total: number;
	allSolved: boolean;
};

/**
 * Builds the full client-facing practice view: which variation to quiz next
 * (its ENTIRE path, player and opponent moves alike — there is no chunking
 * or auto-play split anymore, every attempt is the complete variation) plus
 * the repertoire-wide solved/total count. `activeVariationKey` is whatever
 * is currently persisted (or `null` if none yet); `solvedKeys` is this
 * player's full solved set for this repertoire.
 */
export function buildPracticeView(
	variations: Variation[],
	activeVariationKey: string | null,
	solvedKeys: ReadonlySet<string>
): PracticeView {
	const { solved, total } = solvedProgress(variations, solvedKeys);
	const active = pickActiveVariation(variations, activeVariationKey, solvedKeys);

	// allSolved means the REPERTOIRE is done, not just that the (possibly
	// manually re-picked) active variation happens to be solved — those are
	// different things once a player can pick an already-solved variation.
	const allSolved = total > 0 && solved === total;

	const attempt = active && !allSolved ? { path: active.path, variationKey: active.variationKey } : null;

	return { attempt, solved, total, allSolved };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/mastery/practice.test.ts`
Expected: PASS

- [ ] **Step 5: Run the full mastery test suite**

Run: `npx vitest run src/lib/mastery/`
Expected: PASS (`variations.test.ts`, `variationSequence.test.ts`, `practice.test.ts` — everything left in this directory after Tasks 3 and 5 deleted `levels.test.ts`/`tags.test.ts`/`levelProgress.test.ts`)

- [ ] **Step 6: Commit**

```bash
git add src/lib/mastery/practice.ts src/lib/mastery/practice.test.ts
git commit -m "feat: rewrite practice.ts as a full-replay-only attempt builder"
```

---

### Task 7: Rewrite `level-progress.ts` → `practice-progress.ts`

**Files:**
- Delete: `src/lib/server/level-progress.ts`
- Create: `src/lib/server/practice-progress.ts`

- [ ] **Step 1: Delete the old file**

```bash
git rm src/lib/server/level-progress.ts
```

- [ ] **Step 2: Create the replacement**

```ts
// mychess/src/lib/server/practice-progress.ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Variation } from '$lib/mastery/variations';
import { pickActiveVariation, advanceIfSolved } from '$lib/mastery/variationSequence';

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
 * Applies a completed attempt's outcome. On a clean attempt: marks the
 * variation solved and advances the active key to the next unsolved one in
 * sequence (or `null` if that was the last one — the whole repertoire is
 * done). On a mistaken attempt: a no-op — the active variation doesn't
 * change, so the next attempt naturally re-serves the SAME variation for
 * another try.
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
	await markVariationSolved(supabase, playerId, repertoireId, variationKey);
	const solvedKeys = await loadSolvedKeys(supabase, playerId, repertoireId);
	const next = advanceIfSolved(variationKey, variations, solvedKeys);
	await setActiveVariationKey(supabase, playerId, repertoireId, next);
}
```

- [ ] **Step 3: Run the full test suite and type checker**

Run: `npx vitest run && npm run check`
Expected: type errors remaining in `src/lib/server/repertoire-progress.ts`, `src/lib/server/practice-repertoire.ts`, the `/api/practice/*` routes, and `src/routes/(player)/practice/[repertoire_id]/{+page.server.ts,+page.svelte}` — fixed by Tasks 8-12. No errors should remain in anything already deleted or in the files THIS task touched.

- [ ] **Step 4: Commit**

```bash
git add src/lib/server/practice-progress.ts
git commit -m "feat: replace level-progress.ts with practice-progress.ts (active variation + solved set)"
```

---

### Task 8: `practice-repertoire.ts` — drop `chunkSize`/`practiceDepthLevels`

**Files:**
- Modify: `src/lib/server/practice-repertoire.ts`
- Modify: `src/routes/api/repertoires/[id]/+server.ts`

- [ ] **Step 1: Simplify `PracticeRepertoire` and the select/mapping**

In `src/lib/server/practice-repertoire.ts`:

```ts
export type PracticeRepertoire = { id: string; name: string; color: string };
```

Update the `repertoires` select and returned object in `loadRepertoireVariations`:

```ts
		supabase
			.from('repertoires')
			.select('id, name, color')
			.eq('id', repertoireId)
			.maybeSingle(),
```

```ts
	return {
		repertoire: {
			id: repertoire.id,
			name: repertoire.name,
			color: repertoire.color
		},
		variations: enumerateVariations(moves),
		excludedVariationKeys: new Set((exclusions ?? []).map((row: any) => row.variation_key))
	};
```

- [ ] **Step 2: Remove the now-dead `practice_depth_levels` PATCH handler**

In `src/routes/api/repertoires/[id]/+server.ts`, delete the entire `PATCH` export (it only ever updated `practice_depth_levels`, a dropped column) — keep the existing `DELETE` export exactly as-is:

```ts
// mychess/src/routes/api/repertoires/[id]/+server.ts
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireApiUser } from '$lib/server/auth';

/**
 * Deletes a repertoire the caller owns. Used by `PgnImportForm.svelte` to
 * roll back chapters already imported when a later chapter in the same
 * multi-chapter PGN fails — each chapter is its own request/repertoire now
 * (see `/api/repertoires/import-chapter`), so nothing server-side can roll
 * back the whole batch atomically anymore.
 */
export const DELETE: RequestHandler = async ({ params, locals }) => {
	const user = await requireApiUser(locals);

	const { error: err } = await locals.supabase
		.from('repertoires')
		.delete()
		.eq('id', params.id)
		.eq('player_id', user.id);
	if (err) throw error(400, err.message);

	return json({ ok: true });
};
```

- [ ] **Step 3: Run the full test suite and type checker**

Run: `npx vitest run && npm run check`
Expected: no NEW errors introduced by this task; existing expected errors from Task 7 in the not-yet-updated files persist.

- [ ] **Step 4: Commit**

```bash
git add src/lib/server/practice-repertoire.ts "src/routes/api/repertoires/[id]/+server.ts"
git commit -m "chore: drop chunkSize/practiceDepthLevels from PracticeRepertoire and remove their PATCH handler"
```

---

### Task 9: `repertoire-progress.ts` — replace level shape with solved counts

**Files:**
- Modify: `src/lib/server/repertoire-progress.ts`
- Modify: `src/routes/(player)/+page.server.ts`
- Modify: `src/routes/(player)/+page.svelte`

**Note:** a code-quality review during Task 3 caught a second consumer of the old level-based `RepertoireProgressSummary` shape that this plan's original task list missed: the player DASHBOARD (`(player)/+page.server.ts`, NOT the practice detail page) computes its "Repertoires mastered" stat card from `r.totalVariations`/`r.level === 'mastered'` — both removed by this task. Fixing it is folded into this same task (Steps 2-3 below) rather than left as a later surprise, since the old fields still exist right up until Step 1 lands.

- [ ] **Step 1: Replace `repertoire-progress.ts`'s contents**

```ts
// mychess/src/lib/server/repertoire-progress.ts
import type { SupabaseClient } from '@supabase/supabase-js';
import { enumerateVariations, filterVariations, hasChapterTags, type RawMoveRow, type Variation } from '$lib/mastery/variations';
import { remainingPageRanges } from './practice-repertoire';

export type RepertoireProgressSummary = {
	id: string;
	name: string;
	color: string;
	solved: number;
	total: number;
	allSolved: boolean;
	// The repertoire's TRUE variation count, ignoring this player's
	// exclusions — together with `excludedVariationCount`, lets the Practice
	// picker show a repertoire-level checkbox's checked/unchecked/
	// indeterminate state without fetching every variation up front. `total`
	// above is the FILTERED count used for the solved/total display.
	fullVariationCount: number;
	excludedVariationCount: number;
	// Whether ANY variation came from a chapter-tagged PGN import — the
	// Practice picker (and the new VariationPicker) only offer chapter
	// grouping UI at all when this is true.
	hasChapters: boolean;
};

const MOVES_PAGE_SIZE = 1000;

async function fetchAllMoves(supabase: SupabaseClient, repIds: string[]): Promise<any[]> {
	const query = () =>
		supabase
			.from('moves')
			.select('id, san, is_player_turn, repertoire_id, from_position, to_position, chapter_name')
			.in('repertoire_id', repIds)
			.order('id', { ascending: true });

	const { data: firstPage, error: err } = await query().range(0, MOVES_PAGE_SIZE - 1);
	if (err) throw err;
	const firstRows = firstPage ?? [];
	if (firstRows.length < MOVES_PAGE_SIZE) return firstRows;

	const { count, error: countErr } = await supabase
		.from('moves')
		.select('id', { count: 'exact', head: true })
		.in('repertoire_id', repIds);
	if (countErr) throw countErr;

	const pages = await Promise.all(
		remainingPageRanges(count ?? firstRows.length, MOVES_PAGE_SIZE).map(([from, to]) => query().range(from, to))
	);
	for (const page of pages) {
		if (page.error) throw page.error;
	}

	return [...firstRows, ...pages.flatMap((p) => p.data ?? [])];
}

async function fetchByRepertoire(
	supabase: SupabaseClient,
	table: 'variation_practice_exclusions' | 'variation_solved',
	playerId: string,
	repIds: string[]
): Promise<Map<string, Set<string>>> {
	const { data, error } = await supabase
		.from(table)
		.select('repertoire_id, variation_key')
		.eq('player_id', playerId)
		.in('repertoire_id', repIds);
	if (error) throw error;

	const map = new Map<string, Set<string>>();
	for (const row of (data ?? []) as any[]) {
		const set = map.get(row.repertoire_id) ?? new Set<string>();
		set.add(row.variation_key);
		map.set(row.repertoire_id, set);
	}
	return map;
}

/**
 * Every repertoire a player can access (owned + assigned), each with its
 * computed solved/total progress. Shared by the `/practice` picker and the
 * dashboard's fully-solved-repertoire count. Read-only from the caller's
 * perspective.
 *
 * Reads the cached `total_variations` on `repertoires` (written at import
 * time) instead of fetching every move row and re-walking the variation tree
 * on every load — moves are immutable after import, so that cache is valid
 * forever once computed. Two cases still need a live move fetch: repertoires
 * imported before this cache existed (backfilled here), and repertoires this
 * player has excluded at least one variation from, where the cached
 * whole-repertoire count can't be trusted for this player's filtered view.
 */
export async function loadRepertoireProgressSummaries(
	supabase: SupabaseClient,
	userId: string
): Promise<RepertoireProgressSummary[]> {
	const [{ data: ownReps }, { data: assigned }] = await Promise.all([
		supabase.from('repertoires').select('id, name, color, total_variations, has_chapters').eq('player_id', userId),
		supabase
			.from('assigned_repertoires')
			.select('repertoire:repertoire_id(id, name, color, total_variations, has_chapters)')
			.eq('player_id', userId)
	]);

	const assignedReps = (assigned ?? []).map((a: any) => a.repertoire).filter(Boolean);
	const seen = new Set((ownReps ?? []).map((r: any) => r.id));
	const allReps = [...(ownReps ?? []), ...assignedReps.filter((r: any) => !seen.has(r.id))];

	if (allReps.length === 0) return [];

	const repIds = allReps.map((r: any) => r.id);
	const uncachedIds = allReps.filter((r: any) => r.total_variations === null || r.has_chapters === null).map((r: any) => r.id);

	const [exclusionsByRep, solvedByRep] = await Promise.all([
		fetchByRepertoire(supabase, 'variation_practice_exclusions', userId, repIds),
		fetchByRepertoire(supabase, 'variation_solved', userId, repIds)
	]);
	const excludedIds = [...exclusionsByRep.keys()];
	const needsMoveFetchIds = Array.from(new Set([...uncachedIds, ...excludedIds]));
	const rawMoves = needsMoveFetchIds.length > 0 ? await fetchAllMoves(supabase, needsMoveFetchIds) : [];

	const movesByRep = new Map<string, RawMoveRow[]>();
	for (const m of rawMoves as any[]) {
		const list = movesByRep.get(m.repertoire_id) ?? [];
		list.push({
			id: m.id,
			san: m.san,
			isPlayerTurn: m.is_player_turn,
			fromPositionId: m.from_position,
			toPositionId: m.to_position,
			fromFen: '',
			toFen: '',
			chapterName: m.chapter_name ?? null
		});
		movesByRep.set(m.repertoire_id, list);
	}
	const variationsByRep = new Map<string, Variation[]>();
	for (const repId of needsMoveFetchIds) {
		variationsByRep.set(repId, enumerateVariations(movesByRep.get(repId) ?? []));
	}

	const backfilledTotals = new Map<string, number>();
	const backfilledHasChapters = new Map<string, boolean>();
	await Promise.all(
		uncachedIds.map(async (repId) => {
			const variations = variationsByRep.get(repId) ?? [];
			const hasChapters = hasChapterTags(variations);
			backfilledTotals.set(repId, variations.length);
			backfilledHasChapters.set(repId, hasChapters);
			const { error } = await supabase
				.from('repertoires')
				.update({ total_variations: variations.length, has_chapters: hasChapters })
				.eq('id', repId);
			if (error) console.error(`Failed to backfill shape cache for repertoire ${repId}:`, error);
		})
	);

	return allReps.map((r: any) => {
		const fullVariationCount: number = r.total_variations ?? backfilledTotals.get(r.id)!;

		const excluded = exclusionsByRep.get(r.id);
		const solved = solvedByRep.get(r.id) ?? new Set<string>();

		const total = excluded ? fullVariationCount - excluded.size : fullVariationCount;
		const solvedCount = excluded
			? [...solved].filter((key) => !excluded.has(key)).length
			: [...solved].length; // stale solved keys (repertoire edited since) simply don't inflate the count below via total's own cap

		return {
			id: r.id,
			name: r.name,
			color: r.color,
			solved: Math.min(solvedCount, total),
			total,
			allSolved: total > 0 && Math.min(solvedCount, total) === total,
			fullVariationCount,
			excludedVariationCount: excluded?.size ?? 0,
			hasChapters: r.has_chapters ?? backfilledHasChapters.get(r.id)!
		};
	});
}
```

- [ ] **Step 2: Fix the dashboard's "Repertoires mastered" stat**

In `src/routes/(player)/+page.server.ts`, change:

```ts
	const masterableRepertoires = repertoireSummaries.filter((r) => r.totalVariations > 0);
	const masteredRepertoireCount = masterableRepertoires.filter((r) => r.level === 'mastered').length;
```

to:

```ts
	const masterableRepertoires = repertoireSummaries.filter((r) => r.total > 0);
	const masteredRepertoireCount = masterableRepertoires.filter((r) => r.allSolved).length;
```

(The comment immediately above this in the file — "A repertoire with no moves yet is vacuously 'mastered'..." — stays accurate as-is; only the field names it refers to change.)

In `src/routes/(player)/+page.svelte`, change the stat card's label from "Repertoires mastered" to "Repertoires solved" (matching this plan's new terminology elsewhere, e.g. `RepertoirePracticeRow.svelte`'s "🏆 Solved" badge):

```svelte
          <p class="text-xs text-gray-400 mt-0.5">Repertoires solved</p>
```

Nothing else on this page changes — `stats.mastered_repertoires`/`stats.total_masterable_repertoires`'s own field NAMES stay the same in the returned `stats` object (only what feeds them, above, changes), so the `{#if}`/interpolation lines that read `stats.total_masterable_repertoires`/`stats.mastered_repertoires` need no edit.

- [ ] **Step 3: Run the full test suite and type checker**

Run: `npx vitest run && npm run check`
Expected: no NEW errors introduced by this task, across all three files.

- [ ] **Step 4: Commit**

```bash
git add src/lib/server/repertoire-progress.ts "src/routes/(player)/+page.server.ts" "src/routes/(player)/+page.svelte"
git commit -m "feat: replace level shape with solved/total counts in repertoire-progress.ts and the dashboard"
```

---

### Task 10: API routes — simplify attempt, add select-variation, delete mistake/continue, extend variations endpoint

**Files:**
- Modify: `src/routes/api/practice/attempt/+server.ts`
- Delete: `src/routes/api/practice/mistake/+server.ts`
- Delete: `src/routes/api/practice/continue/+server.ts`
- Modify: `src/routes/api/practice/move-log/+server.ts`
- Create: `src/routes/api/practice/select-variation/+server.ts`
- Modify: `src/routes/api/repertoires/[id]/variations/+server.ts`

- [ ] **Step 1: `attempt/+server.ts`**

```ts
// mychess/src/routes/api/practice/attempt/+server.ts
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { loadFilteredRepertoireVariations } from '$lib/server/practice-repertoire';
import { applyAttemptResult, loadActiveVariationKey, loadSolvedKeys } from '$lib/server/practice-progress';
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

	const [activeVariationKey, solvedKeys] = await Promise.all([
		loadActiveVariationKey(supabase, user.id, repertoireId),
		loadSolvedKeys(supabase, user.id, repertoireId)
	]);
	return json(buildPracticeView(variations, activeVariationKey, solvedKeys));
};
```

- [ ] **Step 2: Delete `mistake/+server.ts` and `continue/+server.ts`**

```bash
git rm src/routes/api/practice/mistake/+server.ts src/routes/api/practice/continue/+server.ts
```

(This closes out issue #61's dead-code removal — `continueFromBranch`/branch-alternative handling no longer exists anywhere, and there's no demotion concept left for `mistake` to report.)

- [ ] **Step 3: `move-log/+server.ts`** — stop requiring/storing `level`

```ts
// mychess/src/routes/api/practice/move-log/+server.ts
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireApiUser } from '$lib/server/auth';

/**
 * Fire-and-forget log of a single move resolution during Practice (correct
 * or wrong). Purely additive: doesn't touch practice_active_variation or
 * variation_solved.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const { supabase } = locals;
	const user = await requireApiUser(locals);

	const body = await request.json();
	const { repertoireId, moveId, playedSan, isCorrect } = body ?? {};
	if (
		typeof repertoireId !== 'string' ||
		typeof moveId !== 'string' ||
		typeof playedSan !== 'string' ||
		typeof isCorrect !== 'boolean'
	) {
		throw error(400, 'Invalid request');
	}

	const { data: move } = await supabase
		.from('moves')
		.select('id')
		.eq('id', moveId)
		.eq('repertoire_id', repertoireId)
		.maybeSingle();
	if (!move) throw error(404, 'Move not found');

	const { error: insertError } = await supabase.from('move_attempts').insert({
		player_id: user.id,
		repertoire_id: repertoireId,
		move_id: moveId,
		played_san: playedSan,
		is_correct: isCorrect
	});
	if (insertError) throw error(500, insertError.message);

	return json({ ok: true });
};
```

- [ ] **Step 4: New `select-variation/+server.ts`**

```ts
// mychess/src/routes/api/practice/select-variation/+server.ts
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { loadFilteredRepertoireVariations } from '$lib/server/practice-repertoire';
import { setActiveVariationKey, loadSolvedKeys } from '$lib/server/practice-progress';
import { requireApiUser } from '$lib/server/auth';
import { buildPracticeView } from '$lib/mastery/practice';

/**
 * Manually sets the active variation from the picker — the SAME
 * active_variation_key the automatic sequence and attempt-completion both
 * read/write. Picking a variation the player has already solved is allowed
 * (re-drilling for confidence); it doesn't un-solve anything.
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
	const solvedKeys = await loadSolvedKeys(supabase, user.id, repertoireId);
	return json(buildPracticeView(variations, variationKey, solvedKeys));
};
```

- [ ] **Step 5: Extend the variations endpoint with `firstMoveSan` and `solved`**

```ts
// mychess/src/routes/api/repertoires/[id]/variations/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireApiUser } from '$lib/server/auth';
import { loadRepertoireVariations } from '$lib/server/practice-repertoire';
import { loadSolvedKeys } from '$lib/server/practice-progress';
import { moveSequenceLabel } from '$lib/mastery/variations';

/**
 * Every variation in a repertoire, labeled by its move sequence, with this
 * player's own included/excluded state, originating PGN chapter (if any),
 * first move (for the picker's move-group buckets), and solved state.
 * Fetched lazily (only when a repertoire row is expanded or the picker is
 * opened), not eagerly for every repertoire, to avoid re-introducing the
 * full-move-fetch cost the shape cache exists to avoid.
 */
export const GET: RequestHandler = async ({ params, locals }) => {
	const user = await requireApiUser(locals);
	const [{ variations, excludedVariationKeys }, solvedKeys] = await Promise.all([
		loadRepertoireVariations(locals.supabase, user.id, params.id),
		loadSolvedKeys(locals.supabase, user.id, params.id)
	]);

	return json(
		variations.map((v) => ({
			variationKey: v.variationKey,
			label: moveSequenceLabel(v.path),
			included: !excludedVariationKeys.has(v.variationKey),
			chapterName: v.chapterName ?? null,
			firstMoveSan: v.path[0]?.san ?? null,
			solved: solvedKeys.has(v.variationKey)
		}))
	);
};
```

- [ ] **Step 6: Run the full test suite and type checker**

Run: `npx vitest run && npm run check`
Expected: type errors remaining only in `src/routes/(player)/practice/[repertoire_id]/{+page.server.ts,+page.svelte}` (Tasks 11-12 fix these) and `src/lib/components/RepertoirePracticeRow.test.ts`/`.svelte` if it references `chapterName`-only fields it still should (spot-check: this component doesn't read `firstMoveSan`/`solved`, so it should be unaffected — if `npm run check` flags it, investigate before continuing rather than assuming).

- [ ] **Step 7: Commit**

```bash
git add src/routes/api/practice/attempt/+server.ts src/routes/api/practice/move-log/+server.ts src/routes/api/practice/select-variation/+server.ts "src/routes/api/repertoires/[id]/variations/+server.ts"
git rm src/routes/api/practice/mistake/+server.ts src/routes/api/practice/continue/+server.ts
git commit -m "feat: simplify practice API routes for full-replay attempts and manual variation selection"
```

---

### Task 11: `+page.server.ts` — rewrite for the new model

**Files:**
- Modify: `src/routes/(player)/practice/[repertoire_id]/+page.server.ts`

- [ ] **Step 1: Replace the file's contents**

```ts
// mychess/src/routes/(player)/practice/[repertoire_id]/+page.server.ts
import type { PageServerLoad } from './$types';
import { requireAccount } from '$lib/server/auth';
import { loadFilteredRepertoireVariations } from '$lib/server/practice-repertoire';
import { loadSyncedActiveVariationKey, loadSolvedKeys } from '$lib/server/practice-progress';
import { buildPracticeView } from '$lib/mastery/practice';

export const load: PageServerLoad = async ({ params, locals }) => {
	const { user } = await requireAccount(locals);
	const supabase = locals.supabase;
	const repertoireId = params.repertoire_id;

	const { repertoire, variations } = await loadFilteredRepertoireVariations(supabase, user!.id, repertoireId);
	const solvedKeys = await loadSolvedKeys(supabase, user!.id, repertoireId);
	const activeVariationKey = await loadSyncedActiveVariationKey(supabase, user!.id, repertoireId, variations, solvedKeys);

	return { repertoire, ...buildPracticeView(variations, activeVariationKey, solvedKeys) };
};
```

- [ ] **Step 2: Run the full test suite and type checker**

Run: `npx vitest run && npm run check`
Expected: type errors remaining only in `+page.svelte` (Task 12 fixes it).

- [ ] **Step 3: Commit**

```bash
git add "src/routes/(player)/practice/[repertoire_id]/+page.server.ts"
git commit -m "feat: rewrite the practice detail page's load for the solved-set model"
```

---

### Task 12: `+page.svelte` — remove level UI, add solved/total display and the picker trigger; delete `LevelList.svelte`

**Files:**
- Modify: `src/routes/(player)/practice/[repertoire_id]/+page.svelte`
- Delete: `src/lib/components/LevelList.svelte`

- [ ] **Step 1: Delete `LevelList.svelte`**

```bash
git rm src/lib/components/LevelList.svelte
```

- [ ] **Step 2: Replace `+page.svelte` in full**

```svelte
<script lang="ts">
	import ChessBoard from '$lib/components/ChessBoard.svelte';
	import VariationPicker from '$lib/components/VariationPicker.svelte';
	import type { Key } from 'chessground/types';
	import { Chess } from 'chess.js';
	import { playCorrect, playWrong } from '$lib/sounds';
	import { invalidateAll } from '$app/navigation';
	import { untrack } from 'svelte';
	import type { PracticeView } from '$lib/mastery/practice';
	import type { VariationStep } from '$lib/mastery/variations';

	let { data } = $props<{ data: any }>();

	let quizIdx = $state(0);
	let boardFen = $state('');
	// 'advancing' is the brief, non-interactive gap between the final move
	// of an attempt (shown as a gold star or a red X, not a click-through
	// card) and the next attempt loading — auto-advances on its own.
	let phase = $state<'playing' | 'advancing'>('playing');
	let locked = $state(false);
	// Consecutive wrong attempts on the CURRENT quiz move — resets the moment
	// it's solved or a new attempt starts. After 3, a hint becomes available;
	// requesting it highlights the correct piece's square, never the move.
	let wrongCount = $state(0);
	let hintRequested = $state(false);
	// Whether THIS ATTEMPT (the whole variation replay) has had any mistake
	// yet — a clean full replay is what marks a variation solved. Reset only
	// in resetForAttempt().
	let attemptHadMistake = $state(false);
	let advanceTimeout: ReturnType<typeof setTimeout> | undefined;
	// Bumped on every resetForAttempt() call so stale async work (a
	// still-in-flight report) notices it's been superseded and stops writing
	// to state.
	let resetToken = 0;
	let pendingReport: Promise<PracticeView | null> | null = null;
	let quizSteps = $state<VariationStep[]>([]);
	let pickerOpen = $state(false);

	const attempt = $derived(data.attempt);
	const repertoireId = $derived(data.repertoire?.id);

	function advanceThroughOpponentReplies() {
		while (quizSteps[quizIdx] && !quizSteps[quizIdx].isPlayerTurn) {
			boardFen = quizSteps[quizIdx].toFen;
			quizIdx++;
		}
	}

	// The correct move's origin square — computed from the step's own
	// fromFen/san rather than stored, since only the destination is ever
	// meant to stay hidden.
	const hintSquare = $derived.by(() => {
		if (!hintRequested) return null;
		const step = quizSteps[quizIdx];
		if (!step) return null;
		try {
			return new Chess(step.fromFen).move(step.san)?.from ?? null;
		} catch {
			return null;
		}
	});

	function resetForAttempt() {
		++resetToken;
		clearTimeout(advanceTimeout);
		quizIdx = 0;
		phase = 'playing';
		locked = false;
		wrongCount = 0;
		hintRequested = false;
		attemptHadMistake = false;
		quizSteps = attempt?.path ?? [];
		if (!attempt) return;
		boardFen = attempt.path[0]?.fromFen ?? '';
		advanceThroughOpponentReplies();
	}

	// Set the board's initial position synchronously, before ChessBoard's own
	// onMount runs — it throws on an empty FEN.
	resetForAttempt();

	// Reset when the REPERTOIRE changes (including on mount) — not on every
	// `attempt` change, since nextAttempt() below also changes `attempt` via
	// invalidateAll()/a merged report and calls resetForAttempt() itself once
	// it's ready.
	$effect(() => {
		// eslint-disable-next-line @typescript-eslint/no-unused-expressions -- deliberate Svelte dependency-tracking read
		repertoireId;
		untrack(() => resetForAttempt());
	});

	function handleMove(detail: { from: Key; to: Key; san: string }) {
		if (phase !== 'playing' || locked) return false;
		const step = quizSteps[quizIdx];
		if (!step) return false;

		if (detail.san === step.san) {
			playCorrect();
			locked = true;
			wrongCount = 0;
			hintRequested = false;
			logMove(step.moveId, detail.san, true);
			const isFinalMove = quizIdx + 1 >= quizSteps.length;
			// Fire the completion report NOW, before the hold below, not
			// after — the report's network round trip then overlaps with the
			// 500ms hold instead of stacking after it.
			if (isFinalMove && attempt) {
				pendingReport = reportAttempt(attempt.variationKey, attemptHadMistake);
			}
			advanceTimeout = setTimeout(() => {
				boardFen = step.toFen;
				quizIdx++;
				advanceThroughOpponentReplies();
				locked = false;
				if (quizIdx >= quizSteps.length) {
					phase = 'advancing';
					nextAttempt();
				}
			}, 500);
			return isFinalMove ? 'final' : true;
		}

		playWrong();
		wrongCount++;
		attemptHadMistake = true;
		logMove(step.moveId, detail.san, false);
		// Don't reveal the book move — just mark the square wrong and let
		// the player try again on the same position. The whole attempt is
		// no longer clean, but they still finish playing it out.
		return false;
	}

	async function reportAttempt(variationKey: string, hadMistake: boolean): Promise<PracticeView | null> {
		try {
			const res = await fetch('/api/practice/attempt', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ repertoireId, variationKey, hadMistake })
			});
			if (!res.ok) return null;
			return await res.json();
		} catch {
			return null;
		}
	}

	function logMove(moveId: string, playedSan: string, isCorrect: boolean) {
		fetch('/api/practice/move-log', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ repertoireId, moveId, playedSan, isCorrect })
		}).catch(() => {});
	}

	async function nextAttempt() {
		const myToken = resetToken;
		const view = pendingReport ? await pendingReport : null;
		pendingReport = null;
		if (myToken !== resetToken) return; // superseded by a resetForAttempt() while we were awaiting

		if (view) {
			data = { ...data, ...view };
		} else {
			await invalidateAll();
			if (myToken !== resetToken) return;
		}
		resetForAttempt();
	}

	async function selectVariation(variationKey: string) {
		pickerOpen = false;
		const res = await fetch('/api/practice/select-variation', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ repertoireId, variationKey })
		});
		if (res.ok) {
			data = { ...data, ...(await res.json()) };
			resetForAttempt();
		}
	}
</script>

<svelte:head>
	<title>Practice {data.repertoire?.name ?? 'Repertoire'} — MyChess</title>
</svelte:head>

<main class="min-h-screen bg-gray-50 p-4 max-w-5xl mx-auto pb-24">
	<div class="mb-4 flex items-center justify-between">
		<a href="/practice" class="text-gray-400 text-sm hover:text-gray-600">← All Repertoires</a>
		{#if repertoireId}
			<button onclick={() => (pickerOpen = true)} class="text-indigo-600 text-sm font-medium hover:underline">
				Choose a variation
			</button>
		{/if}
	</div>

	{#if data.allSolved && data.total > 0}
		<div class="flex flex-col items-center gap-6 text-center py-16">
			<p class="text-7xl">🏆</p>
			<h1 class="text-3xl font-bold text-gray-900">Repertoire Solved!</h1>
			<p class="text-gray-500">Every variation in {data.repertoire?.name} has been played cleanly.</p>
			<a
				href="/practice"
				class="bg-indigo-600 text-white px-8 py-4 rounded-2xl font-bold text-lg hover:bg-indigo-700 transition"
			>
				Back to Repertoires
			</a>
			<button onclick={() => (pickerOpen = true)} class="text-indigo-600 hover:underline">
				Re-drill a specific variation
			</button>
		</div>
	{:else if !attempt}
		<div class="flex flex-col items-center justify-center min-h-screen text-center gap-4">
			<p class="text-5xl">📭</p>
			<h1 class="text-2xl font-bold text-gray-700">Nothing to practice</h1>
			<p class="text-gray-400">This repertoire has no moves for your color yet.</p>
			<a href="/practice" class="text-indigo-600 hover:underline">Back to Repertoires</a>
		</div>
	{:else}
		<div class="flex flex-col lg:flex-row lg:items-start gap-6">
			<div class="flex-1">
				<p class="text-center text-gray-700 font-semibold mb-4 lg:hidden">
					{phase === 'playing' ? 'What is the best move?' : ''}
					{#if wrongCount >= 3 && !hintRequested && phase === 'playing'}
						<button
							onclick={() => (hintRequested = true)}
							class="ml-2 inline-flex items-center gap-1 text-sm font-medium text-amber-600 hover:text-amber-700"
						>
							<span class="text-base">💡</span> Need a hint?
						</button>
					{/if}
				</p>

				<ChessBoard
					fen={boardFen}
					orientation={data.repertoire?.color === 'black' ? 'black' : 'white'}
					interactable={phase === 'playing' && !locked}
					onmove={handleMove}
					prefs={data.boardPrefs}
					{hintSquare}
				/>
			</div>

			<div class="w-full lg:w-72 shrink-0 space-y-4">
				<div class="p-4 bg-white border border-gray-200 rounded-2xl shadow-sm text-center">
					<p class="text-gray-400 text-sm font-medium">{data.repertoire?.name}</p>
					<p class="text-gray-900 text-lg font-bold">{data.solved} / {data.total} variations solved</p>
				</div>

				<p class="text-center text-gray-700 font-semibold hidden lg:block">
					{phase === 'playing' ? 'What is the best move?' : ''}
				</p>
				{#if wrongCount >= 3 && !hintRequested && phase === 'playing'}
					<p class="text-center hidden lg:block">
						<button
							onclick={() => (hintRequested = true)}
							class="inline-flex items-center gap-1.5 text-sm font-medium text-amber-600 hover:text-amber-700"
						>
							<span class="text-base">💡</span> Need a hint?
						</button>
					</p>
				{/if}
			</div>
		</div>
	{/if}

	{#if pickerOpen && repertoireId}
		<VariationPicker {repertoireId} onselect={selectVariation} onclose={() => (pickerOpen = false)} />
	{/if}
</main>
```

- [ ] **Step 3: Run the full test suite and type checker**

Run: `npx vitest run && npm run check`
Expected: type errors remaining only for the not-yet-created `VariationPicker.svelte` import (Task 13 creates it) — everything else should be clean.

- [ ] **Step 4: Commit**

```bash
git add "src/routes/(player)/practice/[repertoire_id]/+page.svelte"
git rm src/lib/components/LevelList.svelte
git commit -m "feat: rewrite the practice detail page for full-replay attempts and solved/total progress"
```

---

### Task 13: New `VariationPicker.svelte`

**Files:**
- Create: `src/lib/components/VariationPicker.svelte`
- Create: `src/lib/components/VariationPicker.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// mychess/src/lib/components/VariationPicker.test.ts
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/svelte';
import VariationPicker from './VariationPicker.svelte';

afterEach(() => cleanup());

const variationsResponse = [
	{ variationKey: 'v1', label: '1.e4 e5 2.Nf3 Nc6 3.Bb5', included: true, chapterName: 'Ruy Lopez', firstMoveSan: 'e4', solved: false },
	{ variationKey: 'v2', label: '1.e4 e5 2.Nf3 Nc6 3.Bc4', included: true, chapterName: 'Ruy Lopez', firstMoveSan: 'e4', solved: true },
	{ variationKey: 'v3', label: '1.d4 d5 2.c4', included: true, chapterName: 'Italian Game', firstMoveSan: 'd4', solved: false }
];

describe('VariationPicker', () => {
	it('loads and shows chapters as top-level groups', async () => {
		const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => variationsResponse });
		vi.stubGlobal('fetch', fetchSpy);
		render(VariationPicker, { props: { repertoireId: 'rep-1', onselect: vi.fn(), onclose: vi.fn() } });

		await waitFor(() => expect(screen.getByText('Ruy Lopez')).toBeTruthy());
		expect(screen.getByText('Italian Game')).toBeTruthy();
		expect(fetchSpy).toHaveBeenCalledWith('/api/repertoires/rep-1/variations');
	});

	it('drills into a chapter to show its move groups, then into a move group to show variations', async () => {
		const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => variationsResponse });
		vi.stubGlobal('fetch', fetchSpy);
		render(VariationPicker, { props: { repertoireId: 'rep-1', onselect: vi.fn(), onclose: vi.fn() } });

		await waitFor(() => screen.getByText('Ruy Lopez'));
		await fireEvent.click(screen.getByText('Ruy Lopez'));
		expect(screen.getByText('e4')).toBeTruthy(); // move-group bucket

		await fireEvent.click(screen.getByText('e4'));
		expect(screen.getByText('1.e4 e5 2.Nf3 Nc6 3.Bb5')).toBeTruthy();
		expect(screen.getByText('1.e4 e5 2.Nf3 Nc6 3.Bc4')).toBeTruthy();
	});

	it('marks an already-solved variation and still allows picking it', async () => {
		const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => variationsResponse });
		vi.stubGlobal('fetch', fetchSpy);
		const onselect = vi.fn();
		render(VariationPicker, { props: { repertoireId: 'rep-1', onselect, onclose: vi.fn() } });

		await waitFor(() => screen.getByText('Ruy Lopez'));
		await fireEvent.click(screen.getByText('Ruy Lopez'));
		await fireEvent.click(screen.getByText('e4'));

		const solvedRow = screen.getByText('1.e4 e5 2.Nf3 Nc6 3.Bc4').closest('button')!;
		expect(solvedRow.textContent).toContain('✓');
		await fireEvent.click(solvedRow);
		expect(onselect).toHaveBeenCalledWith('v2');
	});

	it('selecting a leaf variation calls onselect with its key', async () => {
		const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => variationsResponse });
		vi.stubGlobal('fetch', fetchSpy);
		const onselect = vi.fn();
		render(VariationPicker, { props: { repertoireId: 'rep-1', onselect, onclose: vi.fn() } });

		await waitFor(() => screen.getByText('Ruy Lopez'));
		await fireEvent.click(screen.getByText('Ruy Lopez'));
		await fireEvent.click(screen.getByText('e4'));
		await fireEvent.click(screen.getByText('1.e4 e5 2.Nf3 Nc6 3.Bb5'));
		expect(onselect).toHaveBeenCalledWith('v1');
	});

	it('skips the chapter level entirely when no variation has a chapterName', async () => {
		const flat = [
			{ variationKey: 'v1', label: '1.e4 e5', included: true, chapterName: null, firstMoveSan: 'e4', solved: false }
		];
		const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => flat });
		vi.stubGlobal('fetch', fetchSpy);
		render(VariationPicker, { props: { repertoireId: 'rep-1', onselect: vi.fn(), onclose: vi.fn() } });

		await waitFor(() => expect(screen.getByText('e4')).toBeTruthy()); // straight to move groups, no chapter click needed
	});

	it('calls onclose when the close button is clicked', async () => {
		const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => variationsResponse });
		vi.stubGlobal('fetch', fetchSpy);
		const onclose = vi.fn();
		render(VariationPicker, { props: { repertoireId: 'rep-1', onselect: vi.fn(), onclose } });

		await waitFor(() => screen.getByText('Ruy Lopez'));
		await fireEvent.click(screen.getByLabelText('Close'));
		expect(onclose).toHaveBeenCalled();
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/components/VariationPicker.test.ts`
Expected: FAIL — the component doesn't exist yet.

- [ ] **Step 3: Implement**

```svelte
<!-- mychess/src/lib/components/VariationPicker.svelte -->
<script lang="ts">
	import { groupByFirstMove, type MoveGroup } from '$lib/mastery/variations';

	type VariationRow = {
		variationKey: string;
		label: string;
		included: boolean;
		chapterName: string | null;
		firstMoveSan: string | null;
		solved: boolean;
	};

	let { repertoireId, onselect, onclose }: { repertoireId: string; onselect: (variationKey: string) => void; onclose: () => void } =
		$props();

	const TOP_N = 5;

	let variations = $state<VariationRow[] | null>(null);
	let openChapter = $state<string | null>(null);
	// Index into the currently-shown move-group list, not the move string
	// itself — an index cleanly distinguishes "nothing opened yet" (`null`)
	// from "the Other bucket is opened" (`move: null`, but a real index),
	// which two `string | null` values pointing at the same `null` couldn't.
	let openGroupIndex = $state<number | null>(null);

	async function load() {
		const res = await fetch(`/api/repertoires/${repertoireId}/variations`);
		if (res.ok) variations = await res.json();
	}
	load();

	// Preserves first-appearance order; a null chapterName groups everything
	// into one implicit chapter (skips the chapter tier entirely in the
	// template below) rather than each ungrouped row becoming its own group.
	const chapters = $derived.by(() => {
		const rows = variations ?? [];
		if (rows.every((r) => r.chapterName === null)) return null;
		const names: string[] = [];
		for (const r of rows) {
			const name = r.chapterName ?? '';
			if (!names.includes(name)) names.push(name);
		}
		return names;
	});

	function rowsForChapter(chapterName: string | null): VariationRow[] {
		const rows = variations ?? [];
		return chapterName === null ? rows : rows.filter((r) => r.chapterName === chapterName);
	}

	// Reuses the exact same bucketing algorithm groupVariationsByFirstMove
	// wraps for Variation[] (Task 2) — here applied directly to this
	// endpoint's VariationRow[] via its own firstMoveSan field, so the
	// grouping rule (and its tie-breaking behavior) is defined in exactly
	// one place, not reimplemented against a second shape.
	function moveGroups(chapterName: string | null): MoveGroup<VariationRow>[] {
		return groupByFirstMove(rowsForChapter(chapterName), (r) => r.firstMoveSan, TOP_N);
	}

	const activeChapter = $derived(chapters === null ? null : openChapter);
	const currentGroups = $derived(activeChapter !== null || chapters === null ? moveGroups(activeChapter) : []);
	const openGroup = $derived(openGroupIndex !== null ? currentGroups[openGroupIndex] ?? null : null);
</script>

<div class="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
	<div class="bg-white rounded-2xl shadow-xl max-w-md w-full max-h-[80vh] overflow-y-auto p-4">
		<div class="flex items-center justify-between mb-3">
			<h2 class="font-bold text-gray-900">Choose a variation</h2>
			<button aria-label="Close" onclick={onclose} class="text-gray-400 hover:text-gray-600">✕</button>
		</div>

		{#if variations === null}
			<p class="text-sm text-gray-400">Loading…</p>
		{:else if openGroup}
			<button onclick={() => (openGroupIndex = null)} class="text-indigo-600 text-sm mb-2 hover:underline">← Back</button>
			<ul class="space-y-1">
				{#each openGroup.items as row (row.variationKey)}
					<li>
						<button
							onclick={() => onselect(row.variationKey)}
							class="w-full text-left px-3 py-2 rounded-lg hover:bg-gray-50 text-gray-700 flex items-center justify-between"
						>
							<span>{row.label}</span>
							{#if row.solved}<span class="text-green-600 text-sm">✓</span>{/if}
						</button>
					</li>
				{/each}
			</ul>
		{:else if activeChapter !== null || chapters === null}
			{#if chapters !== null}
				<button onclick={() => (openChapter = null)} class="text-indigo-600 text-sm mb-2 hover:underline">← Back</button>
			{/if}
			<ul class="space-y-1">
				{#each currentGroups as group, i (group.move ?? `other-${i}`)}
					<li>
						<button
							onclick={() => (openGroupIndex = i)}
							class="w-full text-left px-3 py-2 rounded-lg hover:bg-gray-50 font-medium text-gray-800"
						>
							{group.move ?? 'Other'} <span class="text-gray-400 text-sm">({group.items.length})</span>
						</button>
					</li>
				{/each}
			</ul>
		{:else}
			<ul class="space-y-1">
				{#each chapters ?? [] as chapterName (chapterName)}
					<li>
						<button
							onclick={() => (openChapter = chapterName)}
							class="w-full text-left px-3 py-2 rounded-lg hover:bg-gray-50 font-medium text-gray-800"
						>
							{chapterName}
						</button>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</div>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/components/VariationPicker.test.ts`
Expected: PASS (all tests)

- [ ] **Step 5: Run the full test suite and type checker**

Run: `npx vitest run && npm run check`
Expected: zero type errors project-wide (this is the last file this plan creates).

- [ ] **Step 6: Commit**

```bash
git add src/lib/components/VariationPicker.svelte src/lib/components/VariationPicker.test.ts
git commit -m "feat: add VariationPicker.svelte for manual repertoire/chapter/move-group/variation selection"
```

---

### Task 14: Coach reports — replace `avgLevel` with `avgSolvedPct`

**Files:**
- Modify: `src/lib/server/practice-report.ts`
- Modify: `src/routes/(coach)/coach/reports/+page.svelte`
- Modify: `src/routes/(coach)/coach/reports/reports.test.ts`

- [ ] **Step 1: Update the failing test**

In `src/routes/(coach)/coach/reports/reports.test.ts`, replace the middle test:

```ts
	it('lists each student with their accuracy, session count, average % solved, and last-practiced date', () => {
		render(Reports, {
			props: {
				data: {
					students: [
						{
							player: { id: 'p1', display_name: 'Paulius Konovalovas' },
							summary: { accuracyPct: 82, sessionCount: 5, lastPracticedAt: '2026-08-10T10:00:00Z', avgSolvedPct: 62 }
						}
					]
				}
			}
		});
		expect(screen.getByText('Paulius Konovalovas')).toBeTruthy();
		expect(screen.getByText('82%')).toBeTruthy();
		expect(screen.getByText('5')).toBeTruthy();
		expect(screen.getByText('62%')).toBeTruthy();
		expect(document.querySelector('a[href="/coach/players/p1"]')).toBeTruthy();
	});
```

And in the "shows a dash" test, change `avgLevel: null` to `avgSolvedPct: null`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/routes/\(coach\)/coach/reports/reports.test.ts`
Expected: FAIL — `avgSolvedPct` isn't rendered yet; the component still reads `avgLevel`.

- [ ] **Step 3: Update `practice-report.ts`**

Replace `StudentSummary` and `loadStudentSummary` in `src/lib/server/practice-report.ts`:

```ts
export type StudentSummary = {
	accuracyPct: number | null;
	sessionCount: number;
	lastPracticedAt: string | null;
	avgSolvedPct: number | null;
};

/**
 * A roster-row summary for one student: accuracy/activity across ALL of
 * their move_attempts since `sinceIso` (matching how the existing
 * player_stats numbers on the student page are already global, not scoped
 * to this one coach's assignments), but `avgSolvedPct` averaged only across
 * repertoires THIS coach has assigned them (a repertoire this coach never
 * assigned isn't this coach's business) — each repertoire's own solved% is
 * `variation_solved` rows for that repertoire divided by its variation count,
 * then averaged evenly across repertoires (not weighted by size).
 */
export async function loadStudentSummary(
	supabase: SupabaseClient,
	coachId: string,
	playerId: string,
	sinceIso: string,
	now: Date
): Promise<StudentSummary> {
	const [{ data: assigned }, attemptRows] = await Promise.all([
		supabase.from('assigned_repertoires').select('repertoire_id').eq('coach_id', coachId).eq('player_id', playerId),
		fetchAllMoveAttempts(
			() =>
				supabase
					.from('move_attempts')
					.select('is_correct, created_at')
					.eq('player_id', playerId)
					.gte('created_at', sinceIso)
					.order('id', { ascending: true }),
			() =>
				supabase
					.from('move_attempts')
					.select('id', { count: 'exact', head: true })
					.eq('player_id', playerId)
					.gte('created_at', sinceIso)
		)
	]);

	const repertoireIds = (assigned ?? []).map((a: any) => a.repertoire_id as string);
	const [{ data: repRows }, { data: solvedRows }] = repertoireIds.length
		? await Promise.all([
				supabase.from('repertoires').select('id, total_variations').in('id', repertoireIds),
				supabase.from('variation_solved').select('repertoire_id').eq('player_id', playerId).in('repertoire_id', repertoireIds)
			])
		: [{ data: [] as any[] }, { data: [] as any[] }];

	const solvedCountByRep = new Map<string, number>();
	for (const r of (solvedRows ?? []) as any[]) {
		solvedCountByRep.set(r.repertoire_id, (solvedCountByRep.get(r.repertoire_id) ?? 0) + 1);
	}
	const solvedPcts = (repRows ?? [])
		.filter((r: any) => (r.total_variations ?? 0) > 0)
		.map((r: any) => ((solvedCountByRep.get(r.id) ?? 0) / r.total_variations) * 100);

	const rows = (attemptRows ?? []).map((r: any) => ({ isCorrect: r.is_correct as boolean, createdAt: r.created_at as string }));
	const total = rows.length;
	const correct = rows.filter((r) => r.isCorrect).length;
	const activity = activityStats(rows, now);

	return {
		accuracyPct: total > 0 ? Math.round((correct / total) * 100) : null,
		sessionCount: activity.sessionCount,
		lastPracticedAt: activity.lastPracticedAt,
		avgSolvedPct:
			solvedPcts.length > 0 ? Math.round(solvedPcts.reduce((s, p) => s + p, 0) / solvedPcts.length) : null
	};
}
```

- [ ] **Step 4: Update the coach reports UI**

In `src/routes/(coach)/coach/reports/+page.svelte`, change:

```svelte
							<div>
								<p class="font-bold text-gray-900">{s.summary.avgLevel ?? '—'}</p>
								<p class="text-xs text-gray-400">Avg level</p>
							</div>
```

to:

```svelte
							<div>
								<p class="font-bold text-gray-900">{s.summary.avgSolvedPct !== null ? `${s.summary.avgSolvedPct}%` : '—'}</p>
								<p class="text-xs text-gray-400">Avg solved</p>
							</div>
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/routes/\(coach\)/coach/reports/reports.test.ts`
Expected: PASS (all tests)

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/practice-report.ts "src/routes/(coach)/coach/reports/+page.svelte" "src/routes/(coach)/coach/reports/reports.test.ts"
git commit -m "feat: replace coach reports' avgLevel with avgSolvedPct"
```

---

### Task 15: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: PASS, zero failures. (A pre-existing, unrelated `ERR_REQUIRE_ESM` jsdom/`@csstools/css-calc` environment issue affecting ~16 test files is tracked as GitHub issue #55 — not something this plan introduces or fixes; don't chase it here.)

- [ ] **Step 2: Run the type checker**

Run: `npm run check`
Expected: zero errors (per `CLAUDE.md`, the hard gate before pushing to `main`).

- [ ] **Step 3: Grep for anything still referencing removed concepts**

```bash
grep -rl "level_progress\|levelDepth\|MOVES_PER_LEVEL\|practiceDepthLevels\|chunkSize\|levelTag\|LevelList" src/ --include='*.ts' --include='*.svelte'
```

Expected: no output. If anything shows up, investigate and fix before continuing — it means a reference to a removed concept was missed by Tasks 1-14.

- [ ] **Step 4: Manually verify end-to-end**

With `npm run dev` running and Task 1's migration confirmed applied:
- Open a repertoire on `/practice/[id]`. Confirm the board serves the FIRST variation in full (no auto-play prefix, every one of your own moves is quizzed) and the sidebar shows "0 / N variations solved."
- Play it cleanly start to finish. Confirm the count becomes "1 / N" and the NEXT variation in sequence loads.
- Deliberately play a wrong move partway through a variation, then finish it anyway. Confirm the count does NOT increase, and the SAME variation is served again next.
- Click "Choose a variation," drill into a chapter with several variations, confirm variations are bucketed by first move (at most 5 named groups + "Other"), pick one NOT next in the automatic sequence, and confirm it's now what's being drilled.
- Solve every variation in a small test repertoire and confirm the "Repertoire Solved!" screen appears, with a working "Re-drill a specific variation" path back into the picker.
- As a coach with an assigned student who has practiced, open `/coach/reports` and confirm "Avg solved" shows a percentage (not blank) and no "Avg level" text appears anywhere.

- [ ] **Step 5: Refactor pass**

Per `CLAUDE.md`'s "after finishing a major feature" convention: re-read every file touched in Tasks 1-14 for duplicated logic, dead code, or drift from the pure-logic-in-`lib`/I-O-in-`lib/server` split. Fix anything cheap inline; file a GitHub issue for anything bigger.

- [ ] **Step 6: Close out issue #61**

```bash
gh issue close 61 --repo tomyka/mychess --comment "Closed by docs/superpowers/plans/2026-08-13-remove-leveling-add-variation-picker.md — alternativesAt/continueFromBranch/Alternative and the /api/practice/continue+mistake endpoints are deleted outright, not just left dormant."
```

- [ ] **Step 7: Push**

```bash
git push
```

(Per this repo's convention — production is the test environment and there are no other users yet — push directly to `main` without asking first, per `CLAUDE.md`.)

---

## Post-plan reminders

- Task 1's migration requires the user to take a manual action outside this plan's control (running SQL in the Supabase dashboard). Do not mark the overall feature done until the user has confirmed it.
- This plan does not address spaced-review resurfacing of solved variations (the old level-based maintenance-review UI is simply gone) — that's an explicit Non-Goal in the PRD, left for a future pass.
- The teach-pass arrows / branch-exhaustive drilling idea from the original PRD is still unbuilt and unaffected by this plan.
- GitHub issue #62 should get a comment once this ships, and issue #61 should be closed (Task 15, Step 6) as part of this same push.
