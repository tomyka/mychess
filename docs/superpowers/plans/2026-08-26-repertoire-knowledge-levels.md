# Repertoire Knowledge Levels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-chapter Bronze/Silver/Gold/Platinum medal ladder to repertoires, tiered by `playerMoveCount`, retiring the `chapter_mastery`/mastery-run mechanic it replaces.

**Architecture:** A new pure module (`src/lib/mastery/chapterLevels.ts`) derives a chapter's tier from already-existing `enumerateVariations()` output and `variation_solved` rows. It plugs into exactly three existing consumers: `deriveRepertoireStatus`'s `mastered` branch (feeds badges, free — same cost as before), the per-repertoire mastery page (rewritten from a "run" UI to a read-only ladder display — this page already does a full move fetch for one repertoire, so this is where the tier computation belongs, not the cheap repertoire-list summary), and the coach's per-student page (accepts a new, small per-repertoire move-fetch cost, per your explicit choice). The Learn sequence, the Practice pool's weakest-first ordering, and the repertoire-list dashboard summary's *derivation logic* are **not touched** — computing a full tier ladder there would require a full move fetch on every dashboard load, which this codebase has deliberately avoided since issue #52.

**Tech Stack:** SvelteKit 2 + Svelte 5, Supabase/Postgres, Vitest.

**Correction to the approved design doc:** the doc's Technical Specifications section said `repertoire-progress.ts`'s summary "gains `chapterLevels`/`repertoireLevel` fields... no new I/O." That's wrong — `loadRepertoireProgressSummaries` deliberately avoids a full move fetch per repertoire on every load (via the `total_variations` cache), and a tier ladder needs `playerMoveCount` + chapter grouping, which only a full move fetch provides. This plan instead computes tiers only on the already-move-fetching per-repertoire pages (the mastery/levels page, the badge count's already-narrowed "already-learned" subset, and the coach detail page). Everything else in the design doc holds.

**Mid-plan amendment (after Task 1 shipped):** while this plan was being written, a separate, already-merged commit (`feat(mastery): show Mastered on the repertoire list`, closing issue #105) landed on `main`. It added a `repertoires.chapter_count` cache and `deriveRepertoireStatusFromCounts()` so the repertoire *list* can show a cheap "Mastered" badge by comparing `chapter_count` against this player's current `chapter_mastery` row count — without a full move fetch. That's built entirely on `chapter_mastery`, which this plan deletes. Per explicit direction, the retirement is extended to cover it: a new presence-based cache table, `chapter_platinum(player_id, repertoire_id, chapter_name)`, replaces `chapter_mastery` as the input to that same cheap list comparison — `chapter_count` itself is repertoire-wide and tier-agnostic, so it's reused unchanged. `chapter_platinum` is written once, at attempt-completion, the moment a chapter's live-derived level newly reaches `'platinum'` — and is otherwise **sticky**, cleared only by reconciliation (a coach-driven content change), never by an ordinary Practice-pool mistake/hint demotion. This deliberately mirrors `chapter_mastery`'s own original policy ("nothing legitimately removes a mastery record" except staleness) — the ordinary demotion endpoint (`/api/practice/pool-attempt`) stays exactly as cheap as it is today, with no new move fetch. The **authoritative** derivation everywhere else (the Levels page, badge counts) is unaffected by any of this — it has no cache, is always live, and already reacts to a Practice-pool demotion immediately, exactly as `deriveRepertoireStatus`'s existing `learned`/`learning` split already does today. Tasks 5 and 6 below cover this addition; Tasks 2 and 3 (already written before this landed) needed no changes.

---

### Task 1: `chapterLevels.ts` — pure tier derivation

**Files:**
- Create: `mychess/src/lib/mastery/chapterLevels.ts`
- Test: `mychess/src/lib/mastery/chapterLevels.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// mychess/src/lib/mastery/chapterLevels.test.ts
import { describe, it, expect } from 'vitest';
import { tierForMoveCount, deriveChapterLevel, deriveRepertoireLevel } from './chapterLevels';

const v = (variationKey: string, playerMoveCount: number) => ({ variationKey, playerMoveCount });

describe('tierForMoveCount', () => {
	it('is bronze for 1-9 player moves', () => {
		expect(tierForMoveCount(1)).toBe('bronze');
		expect(tierForMoveCount(9)).toBe('bronze');
	});

	it('is silver for 10-18 player moves', () => {
		expect(tierForMoveCount(10)).toBe('silver');
		expect(tierForMoveCount(18)).toBe('silver');
	});

	it('is gold for 19-27 player moves', () => {
		expect(tierForMoveCount(19)).toBe('gold');
		expect(tierForMoveCount(27)).toBe('gold');
	});

	it('is platinum for 28+ player moves', () => {
		expect(tierForMoveCount(28)).toBe('platinum');
		expect(tierForMoveCount(500)).toBe('platinum');
	});
});

describe('deriveChapterLevel', () => {
	it('is null when even the bronze bracket is not fully solved', () => {
		const rows = [v('a', 3), v('b', 5)];
		expect(deriveChapterLevel(rows, new Set(['a']))).toBeNull();
	});

	it('reaches bronze once the bronze bracket is fully solved and there is nothing higher', () => {
		const rows = [v('a', 3), v('b', 5)];
		expect(deriveChapterLevel(rows, new Set(['a', 'b']))).toBe('bronze');
	});

	// The cumulative-ladder rule: solving only the silver-tier line while a
	// bronze-tier line in the same chapter is unsolved must NOT grant silver.
	it('does not grant silver while a lower, bronze-tier variation is unsolved', () => {
		const rows = [v('bronzeLine', 5), v('silverLine', 12)];
		expect(deriveChapterLevel(rows, new Set(['silverLine']))).toBeNull();
	});

	it('grants silver once both bronze- and silver-tier variations are solved', () => {
		const rows = [v('bronzeLine', 5), v('silverLine', 12)];
		expect(deriveChapterLevel(rows, new Set(['bronzeLine', 'silverLine']))).toBe('silver');
	});

	// Vacuous tiers: a chapter with nothing past move 18 can still reach the
	// ceiling tier it has content for, rather than being blocked on emptiness.
	it('treats an empty tier bracket as vacuously cleared', () => {
		const rows = [v('bronzeLine', 5), v('silverLine', 15)]; // nothing in gold or platinum
		expect(deriveChapterLevel(rows, new Set(['bronzeLine', 'silverLine']))).toBe('silver');
	});

	it('reaches platinum once every bracket that has content is fully solved', () => {
		const rows = [v('a', 5), v('b', 15), v('c', 22), v('d', 30)];
		expect(deriveChapterLevel(rows, new Set(['a', 'b', 'c', 'd']))).toBe('platinum');
	});

	it('is null for a chapter with no variations at all', () => {
		expect(deriveChapterLevel([], new Set())).toBeNull();
	});
});

describe('deriveRepertoireLevel', () => {
	it('is the minimum tier across chapters', () => {
		expect(deriveRepertoireLevel(['gold', 'bronze', 'platinum'])).toBe('bronze');
	});

	// A chapter with no medal yet (null) caps the whole repertoire below Bronze.
	it('is null when any chapter has no medal at all', () => {
		expect(deriveRepertoireLevel(['gold', null])).toBeNull();
	});

	it('is platinum when every chapter is platinum', () => {
		expect(deriveRepertoireLevel(['platinum', 'platinum'])).toBe('platinum');
	});

	it('is null for a repertoire with no chapters', () => {
		expect(deriveRepertoireLevel([])).toBeNull();
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mychess && npx vitest run src/lib/mastery/chapterLevels.test.ts`
Expected: FAIL — `Cannot find module './chapterLevels'` (the file doesn't exist yet).

- [ ] **Step 3: Write the implementation**

```ts
// mychess/src/lib/mastery/chapterLevels.ts
//
// Repertoire knowledge levels: a per-chapter Bronze/Silver/Gold/Platinum
// ladder, tiered by `playerMoveCount` (from `enumerateVariations`) and gated
// on `variation_solved`. Retires the `chapter_mastery`/mastery-run mechanic —
// see docs/superpowers/specs/2026-08-26-repertoire-knowledge-levels-design.md.
//
// DERIVED, never stored — same convention as `repertoireStatus.ts`: a coach
// edit changes the inputs (`playerMoveCount`, the solved set) and the level
// recomputes on the next read, with no invalidation job and no staleness
// concept to track.

export type Tier = 'bronze' | 'silver' | 'gold' | 'platinum';

const TIER_ORDER: readonly Tier[] = ['bronze', 'silver', 'gold', 'platinum'];

/** Inclusive upper bound of each tier's `playerMoveCount` bracket. */
const TIER_MAX_PLAYER_MOVES: Record<Tier, number> = {
	bronze: 9,
	silver: 18,
	gold: 27,
	platinum: Infinity
};

const TIER_RANK: Record<Tier, number> = { bronze: 0, silver: 1, gold: 2, platinum: 3 };

/** Which tier a variation belongs to, by its own move count alone. */
export function tierForMoveCount(playerMoveCount: number): Tier {
	for (const tier of TIER_ORDER) {
		if (playerMoveCount <= TIER_MAX_PLAYER_MOVES[tier]) return tier;
	}
	return 'platinum';
}

type ScopedVariation = { variationKey: string; playerMoveCount: number };

/**
 * A chapter's level: the highest tier T such that every variation in tiers
 * <= T (not just tier T alone) has a key in `solvedKeys`. Solving only a
 * chapter's silver-tier lines while a bronze-tier line is unsolved does not
 * grant silver — it's banked progress, credited the moment bronze finishes.
 *
 * An excluded variation is not special-cased here: it simply can never
 * appear in `solvedKeys` while excluded (it's out of the practice pool),
 * which is exactly what should block the ladder past its tier. If it was
 * solved before being excluded, its row persists and does not block —
 * also for free, since this function only ever looks at `solvedKeys`.
 *
 * A tier bracket with no variations in it is vacuously cleared — it cannot
 * block a chapter that simply has nothing that deep (or that shallow).
 */
export function deriveChapterLevel(
	variationsInChapter: readonly ScopedVariation[],
	solvedKeys: ReadonlySet<string>
): Tier | null {
	let achieved: Tier | null = null;
	for (const tier of TIER_ORDER) {
		const bracket = variationsInChapter.filter((v) => tierForMoveCount(v.playerMoveCount) === tier);
		if (!bracket.every((v) => solvedKeys.has(v.variationKey))) break;
		achieved = tier;
	}
	return achieved;
}

/** A repertoire's level: the minimum tier across its chapters (null counts as lowest). */
export function deriveRepertoireLevel(chapterLevels: Iterable<Tier | null>): Tier | null {
	let min: Tier | null = null;
	let minRank = Infinity;
	let any = false;
	for (const level of chapterLevels) {
		any = true;
		const rank = level === null ? -1 : TIER_RANK[level];
		if (rank < minRank) {
			minRank = rank;
			min = level;
		}
	}
	return any ? min : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mychess && npx vitest run src/lib/mastery/chapterLevels.test.ts`
Expected: PASS (13 tests).

- [ ] **Step 5: Commit**

```bash
git add mychess/src/lib/mastery/chapterLevels.ts mychess/src/lib/mastery/chapterLevels.test.ts
git commit -m "$(cat <<'EOF'
feat(mastery): add pure chapter/repertoire knowledge-level derivation

Refs #160
EOF
)"
```

---

### Task 2: Redefine `deriveRepertoireStatus`'s `mastered` branch

**Files:**
- Modify: `mychess/src/lib/mastery/repertoireStatus.ts`
- Modify: `mychess/src/lib/mastery/repertoireStatus.test.ts`

- [ ] **Step 1: Update the test file's fixtures and expectations first**

In `repertoireStatus.test.ts`, replace every `currentlyMasteredChapters: new Set([...])` argument with `platinumChapters: new Set([...])` (same values — this test suite already expresses "which chapters currently count as mastered," which is exactly what `platinumChapters` means now). Also delete the whole `describe('isMasteryCurrent', ...)` block (lines 17-39) and remove `isMasteryCurrent` from the `import` on line 5.

`isMasteryCurrent` currently has two other callers beyond this file: `coach-progress.ts` (rewritten in Task 8) and, as of a commit that landed on `main` while this plan was being written (`feat(mastery): show Mastered on the repertoire list`, closing #105), `repertoire-progress.ts` too (rewritten in Task 6). Both are left exactly as-is for now — deleting the export here will make them fail to build until their own tasks land; that's expected, not a regression to fix here. Verify with `grep -rn "isMasteryCurrent" mychess/src` after Task 6 — it must show zero matches anywhere.

The result for the `deriveRepertoireStatus` describe block:

```ts
describe('deriveRepertoireStatus', () => {
	const three = [v('a', ['Open']), v('b', ['Open']), v('c', ['Closed'])];

	it('is learning while any variation is un-learned', () => {
		expect(status({ variations: three, learnedKeys: new Set(['a']), platinumChapters: new Set() })).toBe(
			'learning'
		);
	});

	it('is learned once every variation is learned but no chapter is platinum', () => {
		expect(
			status({ variations: three, learnedKeys: new Set(['a', 'b', 'c']), platinumChapters: new Set() })
		).toBe('learned');
	});

	it('is still learned when only some chapters are platinum', () => {
		expect(
			status({
				variations: three,
				learnedKeys: new Set(['a', 'b', 'c']),
				platinumChapters: new Set(['Open'])
			})
		).toBe('learned');
	});

	it('is mastered once every chapter is platinum', () => {
		expect(
			status({
				variations: three,
				learnedKeys: new Set(['a', 'b', 'c']),
				platinumChapters: new Set(['Open', 'Closed'])
			})
		).toBe('mastered');
	});

	it('drops back to learning when new un-learned material arrives, even with every chapter platinum', () => {
		expect(
			status({
				variations: [...three, v('d', ['Sharp'])],
				learnedKeys: new Set(['a', 'b', 'c']),
				platinumChapters: new Set(['Open', 'Closed'])
			})
		).toBe('learning');
	});

	it('drops from mastered to learned when a chapter falls out of platinum', () => {
		const learned = new Set(['a', 'b', 'c']);
		expect(status({ variations: three, learnedKeys: learned, platinumChapters: new Set(['Open', 'Closed']) })).toBe(
			'mastered'
		);
		expect(status({ variations: three, learnedKeys: learned, platinumChapters: new Set(['Open']) })).toBe(
			'learned'
		);
	});

	it('ignores variations the caller has excluded from scope', () => {
		const inScope = three.filter((x) => x.variationKey !== 'c');
		expect(status({ variations: inScope, learnedKeys: new Set(['a', 'b']), platinumChapters: new Set(['Open']) })).toBe(
			'mastered'
		);
	});

	it('treats an empty repertoire as vacuously learned, never mastered', () => {
		expect(status({ variations: [], learnedKeys: new Set(), platinumChapters: new Set() })).toBe('learned');
	});

	it('masters a wholly untagged repertoire through its implicit chapter', () => {
		expect(
			status({
				variations: [v('a'), v('b')],
				learnedKeys: new Set(['a', 'b']),
				platinumChapters: new Set([UNTAGGED_CHAPTER])
			})
		).toBe('mastered');
	});

	it('requires every chapter of a shared line to be platinum', () => {
		const shared = [v('a', ['Open', 'Closed'])];
		expect(
			status({ variations: shared, learnedKeys: new Set(['a']), platinumChapters: new Set(['Open']) })
		).toBe('learned');
		expect(
			status({
				variations: shared,
				learnedKeys: new Set(['a']),
				platinumChapters: new Set(['Open', 'Closed'])
			})
		).toBe('mastered');
	});
});
```

- [ ] **Step 2: Run tests to verify they fail on the renamed field**

Run: `cd mychess && npx vitest run src/lib/mastery/repertoireStatus.test.ts`
Expected: FAIL — TypeScript/test errors, since `deriveRepertoireStatus` doesn't accept `platinumChapters` yet and `isMasteryCurrent` no longer exists in the test file's own expectations (the import itself still resolves, since Step 3 hasn't run — the failures are the renamed-field assertions and the deleted describe block referencing a since-removed import once Step 3 lands; run this after Step 1 alone to confirm the test file no longer type-checks against the old signature).

- [ ] **Step 3: Update the implementation**

In `mychess/src/lib/mastery/repertoireStatus.ts`:

Delete lines 34-40 (the `isMasteryCurrent` export) entirely, since it now has no callers. Then replace lines 69-81 (the `deriveRepertoireStatus` function and its doc comment):

```ts
/**
 * `learning` while anything is un-learned → `learned` once everything is →
 * `mastered` once every chapter has reached Platinum on the knowledge-level
 * ladder (see `$lib/mastery/chapterLevels`).
 *
 * `variations` is the repertoire's scope as the caller sees it: excluded lines
 * are already filtered out upstream (`loadFilteredRepertoireVariations` /
 * `filterVariations`), so a line a coach excluded cannot hold a repertoire at
 * `learning` forever. `platinumChapters` is the set of chapter names whose
 * derived level is currently `'platinum'` — computed by the caller via
 * `deriveChapterLevel`, since that computation needs the full `playerMoveCount`
 * per variation, which this module intentionally does not depend on.
 *
 * An empty repertoire is vacuously `learned`, matching the existing
 * `allSolved = solved === total` convention, but never `mastered` — there are no
 * chapters to master.
 */
export function deriveRepertoireStatus(args: {
	variations: readonly ScopedVariation[];
	learnedKeys: ReadonlySet<string>;
	platinumChapters: ReadonlySet<string>;
}): RepertoireStatus {
	const { variations, learnedKeys, platinumChapters } = args;

	if (variations.some((v) => !learnedKeys.has(v.variationKey))) return 'learning';

	const chapters = masterableChapters(variations);
	if (chapters.length === 0) return 'learned';
	return chapters.every((chapter) => platinumChapters.has(chapter)) ? 'mastered' : 'learned';
}
```

Also update the file's top header comment (lines 1-9) to drop the now-stale "mastery record" framing — replace with:

```ts
// mychess/src/lib/mastery/repertoireStatus.ts
//
// A repertoire's status, DERIVED — never stored as a mutable flag.
// Story #99 of epic #95; `mastered` redefined per the knowledge-levels
// feature (see docs/superpowers/specs/2026-08-26-repertoire-knowledge-levels-design.md).
//
// Deriving it is what makes the growth rule work by itself: a coach adding
// chapters, or a variation crossing a tier boundary, changes the inputs, so
// the status recomputes downward on the next read. There is no invalidation
// job, no cron, and no flag that can drift out of step with the rows it
// claims to summarise.
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd mychess && npx vitest run src/lib/mastery/repertoireStatus.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mychess/src/lib/mastery/repertoireStatus.ts mychess/src/lib/mastery/repertoireStatus.test.ts
git commit -m "$(cat <<'EOF'
feat(mastery): redefine repertoire 'mastered' as platinum on every chapter

Refs #160
EOF
)"
```

---

### Task 3: Rewire `countRepertoireStatuses` off `chapter_mastery`

**Files:**
- Modify: `mychess/src/lib/server/repertoire-status-counts.ts`

There is no dedicated test file for this function (it's a thin Supabase I/O wrapper around already-tested pure logic, per this repo's established `lib/` vs `lib/server/` convention) — verified via `grep -rln "countRepertoireStatuses" mychess/src` returning only this file and its two callers (`grant.ts`, and its own doc comment), neither of which has a test that mocks its internals.

- [ ] **Step 1: Replace the implementation**

Replace the full contents of `mychess/src/lib/server/repertoire-status-counts.ts`:

```ts
// mychess/src/lib/server/repertoire-status-counts.ts
//
// How many of a player's repertoires are Learned, and how many Mastered
// (story #101 of epic #95, feeding the account-level badges).

import type { SupabaseClient } from '@supabase/supabase-js';
import { loadRepertoireProgressSummaries, type RepertoireProgressSummary } from './repertoire-progress';
import { loadFilteredRepertoireVariations } from './practice-repertoire';
import { loadSolvedKeys } from './practice-progress';
import { deriveRepertoireStatus, masterableChapters } from '$lib/mastery/repertoireStatus';
import { rowsInChapterTier } from '$lib/mastery/variations';
import { deriveChapterLevel } from '$lib/mastery/chapterLevels';

/**
 * Counts Learned and Mastered repertoires for one player.
 *
 * The Learned count comes from the cached summaries the repertoire list already
 * uses, so it costs nothing extra. Mastered needs each repertoire's chapter
 * list plus every variation's `playerMoveCount` (to derive each chapter's
 * knowledge level), which means enumerating its variations — but only a
 * repertoire that is ALREADY fully learned can possibly be mastered, so the
 * expensive check runs over that subset alone. For every player who hasn't
 * finished a repertoire yet (the normal case) it does no extra work at all.
 *
 * `summaries`, when passed, is used as-is instead of calling
 * `loadRepertoireProgressSummaries` again — the badge sync that runs inside
 * that function's own reconciliation path (see repertoire-progress.ts) already
 * has the summaries it just computed, and re-deriving them here would call
 * back into the very function this is nested inside.
 */
export async function countRepertoireStatuses(
	supabase: SupabaseClient,
	playerId: string,
	summaries?: RepertoireProgressSummary[]
): Promise<{ learned: number; mastered: number }> {
	const summ = summaries ?? (await loadRepertoireProgressSummaries(supabase, playerId));
	const fullyLearned = summ.filter((s) => s.total > 0 && s.solved >= s.total);
	if (fullyLearned.length === 0) return { learned: 0, mastered: 0 };

	const statuses = await Promise.all(
		fullyLearned.map(async (summary) => {
			try {
				const [{ variations }, learnedKeys] = await Promise.all([
					loadFilteredRepertoireVariations(supabase, playerId, summary.id),
					loadSolvedKeys(supabase, playerId, summary.id)
				]);
				const platinumChapters = new Set(
					masterableChapters(variations).filter(
						(chapter) => deriveChapterLevel(rowsInChapterTier(variations, chapter), learnedKeys) === 'platinum'
					)
				);
				return deriveRepertoireStatus({ variations, learnedKeys, platinumChapters });
			} catch (err) {
				// A badge count is not worth failing the request that triggered it.
				// Logged rather than swallowed so a persistent failure is visible.
				console.error(`countRepertoireStatuses: status check failed for repertoire ${summary.id}:`, err);
				return 'learning' as const;
			}
		})
	);

	return {
		learned: statuses.filter((s) => s === 'learned' || s === 'mastered').length,
		mastered: statuses.filter((s) => s === 'mastered').length
	};
}
```

- [ ] **Step 2: Type-check**

Run: `cd mychess && npm run check`
Expected: no new errors from this file.

- [ ] **Step 3: Commit**

```bash
git add mychess/src/lib/server/repertoire-status-counts.ts
git commit -m "$(cat <<'EOF'
feat(mastery): derive Mastered-repertoire counts from knowledge levels

Refs #160
EOF
)"
```

---

### Task 4: Delete the mastery-run subsystem

**Files:**
- Delete: `mychess/src/lib/mastery/masteryRun.ts`
- Delete: `mychess/src/lib/mastery/masteryRun.test.ts`
- Delete: `mychess/src/lib/server/mastery.ts`
- Delete: `mychess/src/routes/api/practice/mastery-run/+server.ts`

`coach-progress.ts` (rewritten in Task 8) and `repertoire-progress.ts` (rewritten in Task 6 — it also queries `chapter_mastery` and imports `isMasteryCurrent`, added by the concurrent `#105` commit described at the top of this plan) are both left exactly as-is here. Editing them now would just be thrown away.

- [ ] **Step 1: Confirm no other callers remain**

Run: `cd mychess && grep -rln "masteryRun\|loadChapterMastery\|recordChapterMastery\|chapterMasteryView\|masteryRunQueue" src`

Expected output at this point (before deletion): `src/lib/mastery/masteryRun.ts`, `src/lib/mastery/masteryRun.test.ts`, `src/lib/server/mastery.ts`, `src/routes/(player)/practice/[repertoire_id]/mastery/+page.server.ts`, `src/routes/api/practice/mastery-run/+server.ts`. The two route files are rewritten in Task 7, not deleted — do this step's grep again after Task 7 to confirm it then returns nothing outside the four files this task deletes.

- [ ] **Step 2: Delete the files**

```bash
git rm mychess/src/lib/mastery/masteryRun.ts mychess/src/lib/mastery/masteryRun.test.ts mychess/src/lib/server/mastery.ts mychess/src/routes/api/practice/mastery-run/+server.ts
```

- [ ] **Step 3: Verify nothing else references the deleted files**

Run: `cd mychess && npm run check`
Expected: no errors referencing `masteryRun`, `mastery.ts`, or the deleted API route. Three files still fail at this point and are expected to: `/practice/[repertoire_id]/mastery/+page.server.ts`+`.svelte` (still reference `chapterMasteryView`/`loadChapterMastery`, fixed by Task 7), `repertoire-progress.ts` (still queries `chapter_mastery`/`isMasteryCurrent`, fixed by Task 6), and `coach-progress.ts` (still queries `chapter_mastery`, fully rewritten by Task 8). Confirm the only errors reported are inside those specific files before moving on.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat(mastery): remove the mastery-run subsystem

Retired per the knowledge-levels design: a chapter's mastery is now the
platinum tier on the knowledge-level ladder, not a separate continuous
no-mistake run. repertoire-progress.ts, coach-progress.ts, and the
mastery page are fixed up in the following three tasks.

Refs #160
EOF
)"
```

---

### Task 5: Migrations — drop `chapter_mastery`, add `chapter_platinum`

**Files:**
- Create: `mychess/supabase/migrations/0070_drop_chapter_mastery.sql`
- Create: `mychess/supabase/migrations/0071_chapter_platinum.sql`

Numbered `0070`/`0071`, not `0069` — migration `0069` is already taken by the concurrent `#105` commit (`0069_repertoire_chapter_count.sql`), which this plan does **not** touch or revert (its `chapter_count` column is repertoire-wide and tier-agnostic, and stays exactly as it is).

- [ ] **Step 1: Write the `chapter_mastery` drop**

```sql
-- mychess/supabase/migrations/0070_drop_chapter_mastery.sql
--
-- Retires the chapter-mastery-run mechanic (migration 0058), superseded by
-- the knowledge-levels ladder (bronze/silver/gold/platinum, derived from
-- enumerateVariations()'s playerMoveCount + variation_solved — see
-- src/lib/mastery/chapterLevels.ts). Nothing in src/ reads or writes this
-- table any more after this feature's Tasks 4 and 6 land (masteryRun.ts,
-- server/mastery.ts, the mastery-run API route, and repertoire-progress.ts's
-- #105 chapter_mastery read are all gone/rewritten). No live users yet, so
-- this is a clean drop with no data migration, matching the precedent set by
-- 0045_remove_leveling_add_solved.sql and 0047_drop_move_progress.sql.

drop table if exists public.chapter_mastery;
```

- [ ] **Step 2: Write the `chapter_platinum` cache table**

```sql
-- mychess/supabase/migrations/0071_chapter_platinum.sql
--
-- Presence-based cache: a row means this player's copy of this chapter has
-- reached Platinum on the knowledge-level ladder (src/lib/mastery/chapterLevels.ts).
-- Exists ONLY so the repertoire list can show a cheap "Mastered" badge (the
-- #105 comparison against repertoires.chapter_count, migration 0069) without
-- a full move fetch per repertoire — the authoritative, always-correct
-- computation (the Levels page, badge counts) never reads this table; it
-- derives platinum status fresh every time from variation_solved.
--
-- Deliberately sticky, mirroring chapter_mastery's own original policy
-- ("nothing legitimately removes a mastery record" — migration 0058): a row
-- is written once, at attempt-completion, the moment a chapter's live-derived
-- level newly reaches platinum (src/lib/server/practice-progress.ts), and is
-- cleared ONLY by reconciliation (src/lib/server/repertoire-progress.ts),
-- when a coach re-upload demotes something in that repertoire for that
-- player. An ordinary Practice-pool mistake/hint demotion
-- (src/lib/server/practice-pool.ts's demoteVariation) does NOT clear it —
-- adding that check would require a full move fetch on that hot, frequently
-- hit endpoint, which this codebase has consistently avoided elsewhere. The
-- practical effect: the list's Mastered badge can lag the authoritative
-- Levels page after an ordinary practice mistake, but never after a coach
-- edit, and it can never show a chapter platinum that was never legitimately
-- earned.
create table if not exists public.chapter_platinum (
  id             bigserial primary key,
  player_id      uuid not null references public.profiles(id) on delete cascade,
  repertoire_id  uuid not null references public.repertoires(id) on delete cascade,
  chapter_name   text not null,
  reached_at     timestamptz not null default now(),
  unique (player_id, repertoire_id, chapter_name)
);

create index if not exists chapter_platinum_player_repertoire_idx
  on public.chapter_platinum (player_id, repertoire_id);

alter table public.chapter_platinum enable row level security;

drop policy if exists chapter_platinum_select_own on public.chapter_platinum;
create policy chapter_platinum_select_own on public.chapter_platinum
  for select using (auth.uid() = player_id);

drop policy if exists chapter_platinum_insert_own on public.chapter_platinum;
create policy chapter_platinum_insert_own on public.chapter_platinum
  for insert with check (auth.uid() = player_id);

-- Reconciliation clears rows on a coach-driven regression (see Task 6) —
-- nothing else legitimately removes one.
drop policy if exists chapter_platinum_delete_own on public.chapter_platinum;
create policy chapter_platinum_delete_own on public.chapter_platinum
  for delete using (auth.uid() = player_id);

revoke all on public.chapter_platinum from anon, public;
grant select, insert, delete on public.chapter_platinum to authenticated;
grant usage, select on sequence public.chapter_platinum_id_seq to authenticated;
```

- [ ] **Step 3: Hand off for manual application**

Per this repo's convention (`CLAUDE.md`, "Database & migrations"): Claude cannot execute DDL directly. Paste both migrations' contents for the user to run in the Supabase Dashboard SQL editor (or trigger the `migrate.yml` GitHub Action), in order (`0070` then `0071`), and do not treat any later task as verified against production until the user confirms both ran. Application order relative to the rest of this plan is not urgent — the code changes in Tasks 3, 4, and 6 already stop reading/writing `chapter_mastery`, and nothing reads `chapter_platinum` until Task 6's code lands.

- [ ] **Step 4: Commit**

```bash
git add mychess/supabase/migrations/0070_drop_chapter_mastery.sql mychess/supabase/migrations/0071_chapter_platinum.sql
git commit -m "$(cat <<'EOF'
feat(db): drop chapter_mastery, add chapter_platinum cache

Refs #160
EOF
)"
```

---

### Task 6: Wire the `chapter_platinum` cache into attempt-completion, reconciliation, and the repertoire list

**Files:**
- Modify: `mychess/src/lib/server/practice-progress.ts`
- Modify: `mychess/src/lib/server/repertoire-progress.ts`
- Modify: `mychess/src/lib/server/repertoire-progress.test.ts`

This task replaces the `#105` commit's `chapter_mastery`-based "Mastered" comparison on the repertoire list with the new `chapter_platinum` cache, and adds the two write points that keep it correct: earning it at attempt-completion, and clearing it on reconciliation.

- [ ] **Step 1: Earn `chapter_platinum` rows at attempt-completion**

In `mychess/src/lib/server/practice-progress.ts`, add these imports alongside the existing ones at the top of the file:

```ts
import { masterableChapters } from '$lib/mastery/repertoireStatus';
import { isInChapterTier, rowsInChapterTier } from '$lib/mastery/variations';
import { deriveChapterLevel } from '$lib/mastery/chapterLevels';
```

Add this new function after `markVariationSolved` (it's a natural sibling — same file, same "write a presence row" shape):

```ts
/**
 * Writes a `chapter_platinum` cache row for every chapter `variation` belongs
 * to whose knowledge level has just newly become Platinum, given the
 * up-to-date `solvedKeys` (read AFTER this attempt's `variation_solved` write).
 *
 * Idempotent (safe to call even when the chapter was already platinum) and
 * best-effort: this cache only backs the repertoire list's decorative
 * "Mastered" badge, never the authoritative Levels page or badge counts (both
 * derive fresh from `variation_solved` directly, with no cache) — so a failed
 * write here must not fail the attempt it's piggybacking on.
 */
async function cachePlatinumChaptersReached(
	supabase: SupabaseClient,
	playerId: string,
	repertoireId: string,
	variation: Variation,
	allVariations: Variation[],
	solvedKeys: ReadonlySet<string>
): Promise<void> {
	const chapters = masterableChapters(allVariations).filter((chapter) => isInChapterTier(variation, chapter));
	const platinumChapters = chapters.filter(
		(chapter) => deriveChapterLevel(rowsInChapterTier(allVariations, chapter), solvedKeys) === 'platinum'
	);
	if (platinumChapters.length === 0) return;

	const { error } = await supabase
		.from('chapter_platinum')
		.upsert(
			platinumChapters.map((chapterName) => ({ player_id: playerId, repertoire_id: repertoireId, chapter_name: chapterName })),
			{ onConflict: 'player_id,repertoire_id,chapter_name', ignoreDuplicates: true }
		);
	if (error) {
		console.error(`cachePlatinumChaptersReached: failed to write for repertoire ${repertoireId}:`, error.message);
	}
}
```

Then, in `applyAttemptResult`, call it right after the existing `markVariationSolved` + re-`loadSolvedKeys` lines at the end of the function:

```ts
	await markVariationSolved(supabase, playerId, repertoireId, variationKey);
	const solvedKeys = await loadSolvedKeys(supabase, playerId, repertoireId);
	const next = advanceIfSolved(variationKey, variations, solvedKeys);
	await setActiveVariationKey(supabase, playerId, repertoireId, next);
	if (variation) {
		await cachePlatinumChaptersReached(supabase, playerId, repertoireId, variation, variations, solvedKeys);
	}
```

(`variation` here is the same `const variation = variations.find(...)` already computed near the top of `applyAttemptResult` — it's `undefined` only when the solved key doesn't match any current variation, e.g. a stale key from a just-reconciled repertoire, in which case there's nothing meaningful to cache.)

- [ ] **Step 2: Clear `chapter_platinum` on reconciliation**

In `mychess/src/lib/server/repertoire-progress.ts`, find the existing reconciliation block (the one that calls `grantNewBadges` when `reconciledIds.size > 0`, near the end of `loadRepertoireProgressSummaries`):

```ts
	if (reconciledIds.size > 0) {
		try {
			await grantNewBadges(supabase, userId, {}, summaries);
		} catch (err) {
			console.error(`Failed to run badge grant/revocation after reconciliation for player ${userId}:`, err instanceof Error ? err.message : err);
		}
	}
```

Add a sibling block right before it that clears the cache for every reconciled repertoire — reconciliation is the only event that can legitimately regress a chapter out of platinum from outside the player's own actions, so a blanket clear per reconciled repertoire is simple and correct (the cache self-repopulates the next time the player solves something in that repertoire):

```ts
	if (reconciledIds.size > 0) {
		const { error } = await supabase
			.from('chapter_platinum')
			.delete()
			.eq('player_id', userId)
			.in('repertoire_id', [...reconciledIds]);
		if (error) {
			console.error(`Failed to clear chapter_platinum after reconciliation for player ${userId}:`, error.message);
		}
	}
```

- [ ] **Step 3: Replace the `chapter_mastery` read with `chapter_platinum`**

Still in `repertoire-progress.ts`, replace the `chapter_mastery` fetch added by the `#105` commit:

```ts
		// Cheap (indexed, bounded by chapter count — no variation enumeration):
		// GitHub issue #105's Mastered badge on the list, via
		// `deriveRepertoireStatusFromCounts` further down.
		fetchRowsByRepertoire<{ repertoire_id: string; moves_updated_at: string }>(
			supabase,
			'chapter_mastery',
			userId,
			repIds,
			'repertoire_id, moves_updated_at',
			'repertoire_id'
		),
```

with:

```ts
		// Cheap (indexed, bounded by chapter count — no variation enumeration):
		// the repertoire list's Mastered badge (originally #105, now sourced
		// from the knowledge-levels ladder's sticky cache — see
		// chapter_platinum, migration 0071), via `deriveRepertoireStatusFromCounts`
		// further down.
		fetchRowsByRepertoire<{ repertoire_id: string }>(
			supabase,
			'chapter_platinum',
			userId,
			repIds,
			'repertoire_id',
			'repertoire_id'
		),
```

Rename the destructured variable `chapterMasteryRowsByRep` to `chapterPlatinumRowsByRep` at both the destructuring site and its one other use, and drop the `isMasteryCurrent` currency filter entirely (the cache has no staleness concept — it's cleared outright by reconciliation, not compared for currency):

```ts
		const chapterCount: number | null = r.chapter_count ?? backfilledChapterCounts.get(r.id) ?? null;
		const currentlyMasteredChapterCount = (chapterPlatinumRowsByRep.get(r.id) ?? []).length;
		const status = deriveRepertoireStatusFromCounts({ allLearned: allSolved, chapterCount, currentlyMasteredChapterCount });
```

Update the type parameter `'variation_practice_exclusions' | 'variation_solved' | 'chapter_mastery'` on `fetchRowsByRepertoire` to `'variation_practice_exclusions' | 'variation_solved' | 'chapter_platinum'`, and remove the now-unused `isMasteryCurrent` from the `$lib/mastery/repertoireStatus` import (keep `deriveRepertoireStatusFromCounts`, `masterableChapters`, and the `RepertoireStatus` type — all three are still used).

- [ ] **Step 4: Update `repertoire-progress.test.ts`**

The `#105` commit added tests exercising the `chapter_mastery`-based Mastered path. Find them (search the file for `chapter_mastery` and `mastered`) and update the mocked table name and row shape from `chapter_mastery` (`{ repertoire_id, moves_updated_at }`, filtered by currency) to `chapter_platinum` (`{ repertoire_id }`, no currency filtering — every returned row counts). The test's intent (a repertoire reads as `mastered` once its platinum-chapter count reaches its cached `chapter_count`) is unchanged; only the fixture table/shape changes.

- [ ] **Step 5: Run the tests**

Run: `cd mychess && npx vitest run src/lib/server/repertoire-progress.test.ts src/lib/server/practice-progress.test.ts`
Expected: PASS. (If `practice-progress.test.ts` doesn't exist — this repo's convention is that `src/lib/server/` I/O wrappers generally aren't unit-tested directly — skip it; running `npm run check` afterward is what verifies this file's own correctness.)

Run: `cd mychess && npm run check`
Expected: no errors from `practice-progress.ts` or `repertoire-progress.ts`. `coach-progress.ts` and the mastery page are still expected to fail — fixed by Tasks 7 and 8.

- [ ] **Step 6: Commit**

```bash
git add mychess/src/lib/server/practice-progress.ts mychess/src/lib/server/repertoire-progress.ts mychess/src/lib/server/repertoire-progress.test.ts
git commit -m "$(cat <<'EOF'
feat(mastery): back the repertoire list's Mastered badge with chapter_platinum

Refs #160
EOF
)"
```

---

### Task 7: Rewrite the mastery page as the Levels page

**Files:**
- Modify: `mychess/src/routes/(player)/practice/[repertoire_id]/mastery/+page.server.ts`
- Modify: `mychess/src/routes/(player)/practice/[repertoire_id]/mastery/+page.svelte`
- Modify: `mychess/src/routes/(player)/practice/[repertoire_id]/mastery/mastery.test.ts`
- Modify: `mychess/src/routes/(player)/practice/[repertoire_id]/+page.svelte` (the nav link)
- Modify: `mychess/messages/en.json`
- Modify: `mychess/messages/lt.json`

The route path (`/practice/[repertoire_id]/mastery`) is kept as-is to minimize churn — only its content changes, from an interactive no-mistake run to a read-only ladder display.

- [ ] **Step 1: Add new message keys, remove the dead ones — `messages/en.json`**

Find the block from `"practice_mastery_link": "Mastery",` (line 183) — replace just that one line with:

```json
	"practice_levels_link": "Levels",
```

Then find the block from `"practice_mastery_back_link"` through `"practice_mastery_abandon_button"` (lines 249-269) and replace the whole block with:

```json
	"practice_levels_back_link": "← Practice",
	"practice_levels_page_heading": "Levels · {name}",
	"practice_levels_intro": "Chapters level up automatically as their lines are solved in Practice — Bronze first, then Silver, Gold, and Platinum. Nothing to run or schedule.",
	"practice_levels_empty_prefix": "Nothing to rank yet. ",
	"practice_levels_empty_link": "Learn some lines first",
	"practice_levels_chapter_progress": "{learned}/{total} learned",
	"practice_levels_repertoire_summary_prefix": "Overall level:",
	"level_bronze": "Bronze",
	"level_silver": "Silver",
	"level_gold": "Gold",
	"level_platinum": "Platinum",
	"level_none": "Unranked",
```

- [ ] **Step 2: Mirror the same change in `messages/lt.json`**

Replace `"practice_mastery_link": "Meistriškumas",` (line 193) with:

```json
	"practice_levels_link": "Lygiai",
```

Replace the block from `"practice_mastery_back_link"` through `"practice_mastery_abandon_button"` (lines 269-289) with:

```json
	"practice_levels_back_link": "← Praktika",
	"practice_levels_page_heading": "Lygiai · {name}",
	"practice_levels_intro": "Skyriai kyla lygiais automatiškai, kai jų variantai išsprendžiami praktikuojant — pirmiausia Bronza, tada Sidabras, Auksas ir Platina. Nereikia jokio bandymo ar tvarkaraščio.",
	"practice_levels_empty_prefix": "Kol kas nėra ką vertinti. ",
	"practice_levels_empty_link": "Pirmiausia išmokite kelis variantus",
	"practice_levels_chapter_progress": "{learned}/{total} išmokta",
	"practice_levels_repertoire_summary_prefix": "Bendras lygis:",
	"level_bronze": "Bronza",
	"level_silver": "Sidabras",
	"level_gold": "Auksas",
	"level_platinum": "Platina",
	"level_none": "Neįvertinta",
```

- [ ] **Step 3: Regenerate paraglide messages**

Run: `cd mychess && npm run check`
Expected: this regenerates `src/lib/paraglide/messages/*` from the JSON (per this repo's paraglide convention — a plain `npm test`/`npm run check` run regenerates it; do not run a bare `paraglide-js compile` directly, see `CLAUDE.md`'s paraglide note). Confirm no errors.

- [ ] **Step 4: Rewrite `+page.server.ts`**

```ts
// mychess/src/routes/(player)/practice/[repertoire_id]/mastery/+page.server.ts
import type { PageServerLoad } from './$types';
import { requireAccount } from '$lib/server/auth';
import { loadFilteredRepertoireVariations } from '$lib/server/practice-repertoire';
import { loadSolvedKeys } from '$lib/server/practice-progress';
import { masterableChapters } from '$lib/mastery/repertoireStatus';
import { rowsInChapterTier } from '$lib/mastery/variations';
import { deriveChapterLevel, deriveRepertoireLevel } from '$lib/mastery/chapterLevels';

/**
 * The knowledge-levels screen: each chapter's Bronze/Silver/Gold/Platinum
 * tier, derived read-only from `playerMoveCount` + this player's solved set.
 * Superseded the mastery-run screen (story #100) — there is no run to start
 * any more, a chapter's level simply reflects what's already been solved in
 * Practice.
 */
export const load: PageServerLoad = async ({ params, locals }) => {
	const { user } = await requireAccount(locals);
	const supabase = locals.supabase;
	const repertoireId = params.repertoire_id;

	const [{ repertoire, variations }, learnedKeys] = await Promise.all([
		loadFilteredRepertoireVariations(supabase, user!.id, repertoireId),
		loadSolvedKeys(supabase, user!.id, repertoireId)
	]);

	const chapters = masterableChapters(variations).map((chapter) => {
		const rows = rowsInChapterTier(variations, chapter);
		return {
			chapter,
			total: rows.length,
			learned: rows.filter((v) => learnedKeys.has(v.variationKey)).length,
			level: deriveChapterLevel(rows, learnedKeys)
		};
	});

	return {
		repertoire,
		chapters,
		repertoireLevel: deriveRepertoireLevel(chapters.map((c) => c.level))
	};
};
```

- [ ] **Step 5: Rewrite `+page.svelte`**

```svelte
<script lang="ts">
	import { m } from '$lib/paraglide/messages';

	let { data } = $props<{ data: any }>();

	type Tier = 'bronze' | 'silver' | 'gold' | 'platinum';

	const LEVEL_LABEL: Record<Tier, () => string> = {
		bronze: m.level_bronze,
		silver: m.level_silver,
		gold: m.level_gold,
		platinum: m.level_platinum
	};

	function levelLabel(level: Tier | null): string {
		return level ? LEVEL_LABEL[level]() : m.level_none();
	}

	const LEVEL_BADGE_CLASS: Record<Tier, string> = {
		bronze: 'border-[#B08D57]/40 bg-[#B08D57]/10 text-[#8a6b3f] dark:text-[#cda876]',
		silver: 'border-[#A8A8A8]/40 bg-[#A8A8A8]/10 text-[#6b6b6b] dark:text-[#c7c7c7]',
		gold: 'border-[#D4AF37]/40 bg-[#D4AF37]/10 text-[#8a6d10] dark:text-[#e0c15c]',
		platinum: 'border-[#6FCF73]/40 bg-[#6FCF73]/10 text-[#4b9e50] dark:text-[#6FCF73]'
	};

	function badgeClass(level: Tier | null): string {
		return level ? LEVEL_BADGE_CLASS[level] : 'border-(--color-border) bg-(--color-bg) text-(--color-muted)';
	}
</script>

<svelte:head>
	<!-- Fallback name reused verbatim from Learn's per-repertoire page. -->
	<title>{m.seo_practice_mastery_title({ name: data.repertoire?.name ?? m.learn_repertoire_fallback_name() })}</title>
</svelte:head>

<main class="min-h-screen bg-(--color-bg) p-4 max-w-2xl mx-auto pb-24">
	<div class="mb-4 flex items-center gap-3 flex-wrap">
		<a href="/practice/{data.repertoire?.id}" class="text-(--color-muted) text-sm hover:text-(--color-text)">
			{m.practice_levels_back_link()}
		</a>
		<h1 class="text-base font-bold text-(--color-text) flex-1 min-w-0 truncate">
			{m.practice_levels_page_heading({ name: data.repertoire?.name })}
		</h1>
	</div>

	<div class="max-w-2xl w-full mx-auto flex flex-col gap-4">
		<p class="text-sm text-(--color-muted)">{m.practice_levels_intro()}</p>

		{#if data.chapters.length > 0}
			<div class="flex items-center gap-2">
				<span class="text-sm text-(--color-muted)">{m.practice_levels_repertoire_summary_prefix()}</span>
				<span
					class="text-xs font-semibold uppercase tracking-wide px-2 py-1 rounded-full border {badgeClass(data.repertoireLevel)}"
				>
					{levelLabel(data.repertoireLevel)}
				</span>
			</div>
		{/if}

		{#if data.chapters.length === 0}
			<p class="text-(--color-muted) text-center py-12">
				{m.practice_levels_empty_prefix()}<a href="/learn/{data.repertoire?.id}" class="text-(--color-accent) hover:underline">{m.practice_levels_empty_link()}</a>.
			</p>
		{:else}
			<ul class="flex flex-col gap-2">
				{#each data.chapters as c (c.chapter)}
					<li class="flex items-center gap-3 p-3 rounded-2xl border border-(--color-border) bg-(--color-surface)">
						<div class="flex-1 min-w-0">
							<p class="font-medium text-(--color-text) truncate">{c.chapter}</p>
							<p class="text-xs text-(--color-muted)">
								{m.practice_levels_chapter_progress({ learned: c.learned, total: c.total })}
							</p>
						</div>
						<span
							class="shrink-0 text-[0.65rem] font-semibold uppercase tracking-wide px-2 py-1 rounded-full border {badgeClass(c.level)}"
						>
							{levelLabel(c.level)}
						</span>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</main>
```

- [ ] **Step 6: Rewrite `mastery.test.ts`**

```ts
// mychess/src/routes/(player)/practice/[repertoire_id]/mastery/mastery.test.ts
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import Page from './+page.svelte';

function renderWith(data: Record<string, unknown>) {
	render(Page, {
		props: {
			data: {
				repertoire: { id: 'r1', name: 'Italian Game', color: 'white' },
				chapters: [],
				repertoireLevel: null,
				...data
			}
		}
	});
}

describe('knowledge levels page', () => {
	it('shows the empty state when there are no chapters', () => {
		renderWith({});
		expect(screen.getByText(/Learn some lines first/)).toBeTruthy();
	});

	it('lists each chapter with its level badge', () => {
		renderWith({
			chapters: [
				{ chapter: 'Main Line', total: 5, learned: 5, level: 'silver' },
				{ chapter: 'Sideline', total: 3, learned: 1, level: null }
			],
			repertoireLevel: null
		});
		expect(screen.getByText('Main Line')).toBeTruthy();
		expect(screen.getByText('Sideline')).toBeTruthy();
		expect(screen.getByText('Silver')).toBeTruthy();
		expect(screen.getByText('Unranked')).toBeTruthy();
		expect(screen.getByText('5/5 learned')).toBeTruthy();
		expect(screen.getByText('1/3 learned')).toBeTruthy();
	});

	it('shows the repertoire-wide level when there is at least one chapter', () => {
		renderWith({
			chapters: [{ chapter: 'Main Line', total: 5, learned: 5, level: 'platinum' }],
			repertoireLevel: 'platinum'
		});
		expect(screen.getByText('Overall level:')).toBeTruthy();
		expect(screen.getByText('Platinum')).toBeTruthy();
	});
});
```

- [ ] **Step 7: Update the practice page's nav link**

In `mychess/src/routes/(player)/practice/[repertoire_id]/+page.svelte`, find (around line 213-216):

```svelte
			href="/practice/{data.repertoire?.id}/mastery"
```
```svelte
			{m.practice_mastery_link()}</a>
```

and replace `{m.practice_mastery_link()}` with `{m.practice_levels_link()}` (leave the `href` unchanged — the route path stays `/mastery`).

- [ ] **Step 8: Run the tests**

Run: `cd mychess && npx vitest run "src/routes/(player)/practice/[repertoire_id]/mastery/mastery.test.ts"`
Expected: PASS (3 tests).

Run: `cd mychess && npm run check && npm run lint`
Expected: zero errors (per this repo's no-tolerated-baseline rule).

- [ ] **Step 9: Commit**

```bash
git add mychess/src/routes/\(player\)/practice/\[repertoire_id\]/mastery mychess/src/routes/\(player\)/practice/\[repertoire_id\]/+page.svelte mychess/messages/en.json mychess/messages/lt.json mychess/src/lib/paraglide
git commit -m "$(cat <<'EOF'
feat(practice): replace the mastery-run screen with the knowledge-levels ladder

Refs #160
EOF
)"
```

---

### Task 8: Coach's per-student page — recompute via the tier ladder

**Files:**
- Modify: `mychess/src/lib/server/coach-progress.ts`
- Modify: `mychess/src/routes/(coach)/coach/players/[player_id]/+page.server.ts`
- Modify: `mychess/src/routes/(coach)/coach/players/[player_id]/+page.svelte`
- Modify: `mychess/src/routes/(coach)/coach/players/[player_id]/player-detail.test.ts`
- Modify: `mychess/messages/en.json`
- Modify: `mychess/messages/lt.json`

Per your explicit choice: accept the cost of a full move fetch per assigned repertoire on this page (bounded to one student's repertoires), replacing the "chapters mastered/stale" line with each repertoire's current medal.

- [ ] **Step 1: Rewrite `coach-progress.ts`**

```ts
// mychess/src/lib/server/coach-progress.ts
//
// Per-student, per-repertoire learning progress for the coach view
// (story #102 of epic #95). Knowledge-level lookup replaces the old
// chapter_mastery-based mastered/stale counters.

import type { SupabaseClient } from '@supabase/supabase-js';
import { loadFilteredRepertoireVariations } from './practice-repertoire';
import { loadSolvedKeys } from './practice-progress';
import { masterableChapters } from '$lib/mastery/repertoireStatus';
import { rowsInChapterTier } from '$lib/mastery/variations';
import { deriveChapterLevel, deriveRepertoireLevel, type Tier } from '$lib/mastery/chapterLevels';

export type StudentRepertoireProgress = {
	repertoireId: string;
	learned: number;
	/** This repertoire's current knowledge level (minimum across its chapters), or null if not yet Bronze. */
	level: Tier | null;
	/** Demotions in the requested window — material that isn't sticking. */
	demotions: number;
};

/**
 * `since` bounds the demotion count only. Learned counts and knowledge level
 * are current-state facts, not windowed events, so a range filter would make
 * them mean something different from what the label says.
 *
 * Unlike the rest of this module's history, computing `level` needs a full
 * move fetch per assigned repertoire (to get each variation's
 * `playerMoveCount` and chapter grouping) — accepted deliberately here since
 * this page is scoped to one student's own assigned repertoires, a small,
 * bounded set, not the whole coach roster.
 */
export async function loadStudentRepertoireProgress(
	supabase: SupabaseClient,
	playerId: string,
	repertoireIds: string[],
	since: string | null
): Promise<Map<string, StudentRepertoireProgress>> {
	const result = new Map<string, StudentRepertoireProgress>();
	if (repertoireIds.length === 0) return result;

	for (const id of repertoireIds) {
		result.set(id, { repertoireId: id, learned: 0, level: null, demotions: 0 });
	}

	let demotionQuery = supabase
		.from('variation_demotions')
		.select('repertoire_id')
		.eq('player_id', playerId)
		.in('repertoire_id', repertoireIds);
	if (since) demotionQuery = demotionQuery.gte('demoted_at', since);

	const [learnedRes, demotionsRes] = await Promise.all([
		supabase.from('variation_solved').select('repertoire_id').eq('player_id', playerId).in('repertoire_id', repertoireIds),
		demotionQuery
	]);

	for (const [label, res] of [
		['variation_solved', learnedRes],
		['variation_demotions', demotionsRes]
	] as const) {
		if (res.error) console.error(`loadStudentRepertoireProgress: ${label} read failed:`, res.error.message);
	}

	for (const row of learnedRes.data ?? []) {
		const entry = result.get(row.repertoire_id);
		if (entry) entry.learned++;
	}

	for (const row of demotionsRes.data ?? []) {
		const entry = result.get(row.repertoire_id);
		if (entry) entry.demotions++;
	}

	await Promise.all(
		repertoireIds.map(async (repertoireId) => {
			try {
				const [{ variations }, learnedKeys] = await Promise.all([
					loadFilteredRepertoireVariations(supabase, playerId, repertoireId),
					loadSolvedKeys(supabase, playerId, repertoireId)
				]);
				const chapterLevels = masterableChapters(variations).map((chapter) =>
					deriveChapterLevel(rowsInChapterTier(variations, chapter), learnedKeys)
				);
				const entry = result.get(repertoireId);
				if (entry) entry.level = deriveRepertoireLevel(chapterLevels);
			} catch (err) {
				console.error(`loadStudentRepertoireProgress: level lookup failed for repertoire ${repertoireId}:`, err);
			}
		})
	);

	return result;
}
```

- [ ] **Step 2: Update `+page.server.ts`**

In `mychess/src/routes/(coach)/coach/players/[player_id]/+page.server.ts`, replace lines 59-66:

```ts
				// Learning vs Learned is exact from these counts. Mastered needs the
				// repertoire's chapter count, which would cost a full move fetch per
				// repertoire here — deferred to #105's cached chapter_count, the same
				// reason the player-facing list defers it.
				status: total > 0 && learned >= total ? 'learned' : 'learning',
				chaptersMastered: progress?.chaptersMastered ?? 0,
				chaptersStale: progress?.chaptersStale ?? 0,
				demotions: progress?.demotions ?? 0,
```

with:

```ts
				status: total > 0 && learned >= total ? 'learned' : 'learning',
				level: progress?.level ?? null,
				demotions: progress?.demotions ?? 0,
```

- [ ] **Step 3: Update `+page.svelte`**

Replace lines 112-124:

```svelte
              {#if pr.total > 0}
                <p class="text-xs text-(--color-muted) mb-2">
                  {m.coach_player_chapters_mastered({ count: pr.chaptersMastered })}
                  {#if pr.chaptersStale > 0}
                    · {m.coach_player_chapters_stale({ count: pr.chaptersStale })}
                  {/if}
                  {#if pr.demotions > 0}
                    · <span class="text-amber-600 dark:text-amber-400"
                      >{m.coach_player_demotions({ count: pr.demotions })}</span
                    >
                  {/if}
                </p>
              {/if}
```

with:

```svelte
              {#if pr.total > 0}
                <p class="text-xs text-(--color-muted) mb-2 flex items-center gap-1.5 flex-wrap">
                  <span>{m.coach_player_level_prefix()}</span>
                  <span
                    class="text-[0.65rem] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full border {LEVEL_BADGE_CLASS[pr.level as keyof typeof LEVEL_BADGE_CLASS] ?? 'border-(--color-border) bg-(--color-bg) text-(--color-muted)'}"
                  >
                    {LEVEL_LABEL[pr.level as keyof typeof LEVEL_LABEL]?.() ?? m.level_none()}
                  </span>
                  {#if pr.demotions > 0}
                    · <span class="text-amber-600 dark:text-amber-400"
                      >{m.coach_player_demotions({ count: pr.demotions })}</span
                    >
                  {/if}
                </p>
              {/if}
```

Then add the two lookup tables near the top of the `<script>` block (alongside the existing imports), matching Task 7's badge styling for consistency across the app:

```ts
	const LEVEL_LABEL = {
		bronze: m.level_bronze,
		silver: m.level_silver,
		gold: m.level_gold,
		platinum: m.level_platinum
	} as const;

	const LEVEL_BADGE_CLASS = {
		bronze: 'border-[#B08D57]/40 bg-[#B08D57]/10 text-[#8a6b3f] dark:text-[#cda876]',
		silver: 'border-[#A8A8A8]/40 bg-[#A8A8A8]/10 text-[#6b6b6b] dark:text-[#c7c7c7]',
		gold: 'border-[#D4AF37]/40 bg-[#D4AF37]/10 text-[#8a6d10] dark:text-[#e0c15c]',
		platinum: 'border-[#6FCF73]/40 bg-[#6FCF73]/10 text-[#4b9e50] dark:text-[#6FCF73]'
	} as const;
```

(Read the file first to place these correctly next to its existing `<script>` imports and confirm `m` is already imported there — it is, per the existing `m.coach_player_*` calls.)

- [ ] **Step 4: Update message files**

In `messages/en.json`, remove `coach_player_chapters_mastered` and `coach_player_chapters_stale` (the two ICU-plural blocks at lines 1016-1035) and add in their place:

```json
	"coach_player_level_prefix": "Level:",
```

In `messages/lt.json`, remove the same two keys (lines 1102-1121 there) and add:

```json
	"coach_player_level_prefix": "Lygis:",
```

(`level_bronze`/`level_silver`/`level_gold`/`level_platinum`/`level_none` already exist from Task 7 — reused here, not duplicated.)

- [ ] **Step 5: Update `player-detail.test.ts`**

Replace the `chaptersMastered: 0, chaptersStale: 0` defaults (lines 197-198) with `level: null`. Replace the three tests at lines 217-236 (`'reports chapters mastered'`, `'uses the singular for one chapter'`, `'flags chapters whose mastery went stale after new material was added'`) with:

```ts
	it('shows the repertoire level', () => {
		renderWith({ level: 'silver' });
		expect(screen.getByText('Silver')).toBeTruthy();
	});

	it('shows Unranked when no medal has been earned yet', () => {
		renderWith({ level: null });
		expect(screen.getByText('Unranked')).toBeTruthy();
	});
```

Leave the `'flags lines sent back to Learn in the window'` and `'shows no status chip for a repertoire with no moves'` tests unchanged.

- [ ] **Step 6: Run the tests**

Run: `cd mychess && npx vitest run "src/routes/(coach)/coach/players/[player_id]/player-detail.test.ts"`
Expected: PASS.

Run: `cd mychess && npm run check && npm run lint`
Expected: zero errors.

- [ ] **Step 7: Commit**

```bash
git add mychess/src/lib/server/coach-progress.ts mychess/src/routes/\(coach\)/coach/players/\[player_id\] mychess/messages/en.json mychess/messages/lt.json mychess/src/lib/paraglide
git commit -m "$(cat <<'EOF'
feat(coach): show each assigned repertoire's knowledge level

Refs #160
EOF
)"
```

---

### Task 9: Clean up the stray doc-comment reference and full verification

**Files:**
- Modify: `mychess/src/lib/server/practice-repertoire.ts`

- [ ] **Step 1: Fix the dangling comment**

In `mychess/src/lib/server/practice-repertoire.ts`, the `PracticeRepertoire.movesUpdatedAt` doc comment (around line 15) reads:

```ts
	 * moment it moves — see `isMasteryCurrent` in `$lib/mastery/repertoireStatus`.
```

`isMasteryCurrent` no longer exists (deleted in Task 2). Replace that line with:

```ts
	 * moment it moves — see `repertoires.moves_updated_at`'s trigger (migration 0055).
```

- [ ] **Step 2: Full-repo verification**

Run, in order:

```bash
cd mychess
npm test
npm run check
npm run lint
```

Expected: all three exit 0. Per `CLAUDE.md`, `check` and `lint` have no tolerated baseline — any failure must be fixed before proceeding, not deferred.

- [ ] **Step 3: Confirm the dead-code sweep is complete**

Run: `cd mychess && grep -rn "chapter_mastery\|masteryRun\|isMasteryCurrent\|chaptersMastered\|chaptersStale\|practice_mastery_" src messages supabase/migrations/0070_drop_chapter_mastery.sql`

Expected: zero matches, except the migration file's own comment referencing the retired table by name (that's fine — it's describing what it drops) and any earlier migration files (0058 and prior, and the concurrent `#105` commit's `0069_repertoire_chapter_count.sql`) that legitimately still mention `chapter_mastery` in their own historical SQL — those are never edited.

- [ ] **Step 4: Commit**

```bash
git add mychess/src/lib/server/practice-repertoire.ts
git commit -m "$(cat <<'EOF'
chore: fix dangling isMasteryCurrent doc reference

Refs #160
EOF
)"
```

---

### Task 10: Fix exclusion-blocking and redefine "complete" as a chapter's own ceiling

**Post-Task-9 amendment.** A final holistic review across the whole feature diff (Tasks 1-9) found two real issues that no single-task review had the cross-file context to catch:

1. **Exclusions don't actually block the ladder in practice — every real caller pre-filters them out.** The design's whole "no exclusion parameter needed" argument for `deriveChapterLevel` (see the design doc and Task 1) rests on an excluded variation still being present in the array passed in, just absent from `solvedKeys` — that's what makes its bracket fail `.every(...)` and block. But `repertoire-status-counts.ts` (Task 3), `coach-progress.ts` (Task 8), `mastery/+page.server.ts` (Task 7), and `practice-progress.ts`'s new `cachePlatinumChaptersReached` (Task 6, via `/api/practice/attempt/+server.ts`'s existing `loadFilteredRepertoireVariations` call) all load variations through `loadFilteredRepertoireVariations`, which calls `filterVariations` and removes excluded variations from the array **entirely** before `deriveChapterLevel` ever sees them. An excluded, never-solved variation's tier bracket becomes smaller (or vacuously empty) instead of "present but unsolved" — so a chapter can sail past an excluded variation's tier instead of being blocked by it, contradicting the confirmed design decision (grilling round 2, "Q2 - yes strict version").

2. **"Mastered" as literally "every chapter reads `'platinum'`" makes it unreachable for any repertoire with a short chapter.** Per the confirmed vacuous-ceiling rule (grilling round 2, Q6), a chapter with nothing past move 18 can never read higher than `'silver'` — by design. But `deriveRepertoireStatus`'s `mastered` branch (Task 2) and the `chapter_platinum` cache (Task 6) both require a chapter's level to literally equal `'platinum'`, so a repertoire with even one short chapter can now never be "Mastered," regardless of how thoroughly solved — a real behavior regression versus the old `chapter_mastery` mechanic, which any chapter could earn regardless of length. **Resolved per explicit product decision**: "mastered"/"completed" now means a chapter has reached its own *ceiling* (the highest tier it has any content in), not literally Platinum.

**Files:**
- Modify: `mychess/src/lib/mastery/chapterLevels.ts` + test
- Modify: `mychess/src/lib/mastery/repertoireStatus.ts` + test
- Modify: `mychess/src/lib/server/repertoire-status-counts.ts`
- Modify: `mychess/src/lib/server/practice-progress.ts` + test
- Modify: `mychess/src/lib/server/repertoire-progress.ts` + test
- Modify: `mychess/src/routes/api/practice/attempt/+server.ts`
- Modify: `mychess/src/routes/(player)/practice/[repertoire_id]/mastery/+page.server.ts`
- Modify: `mychess/src/lib/server/coach-progress.ts`
- Modify: `mychess/supabase/migrations/0071_chapter_platinum.sql` (edit in place — rename table to `chapter_completed`; safe since it was never applied to production, per Task 5's own hand-off note)

**Design for the fix:**

- Add two new pure exports to `chapterLevels.ts`:
  - `chapterCeiling(variationsInChapter): Tier | null` — the highest tier the chapter has ANY variation in (via the existing `TIER_RANK`).
  - `isChapterComplete(variationsInChapter, solvedKeys): boolean` — `deriveChapterLevel(...) === chapterCeiling(...)` (both non-null). This is the new "mastered"/"completed" predicate, replacing every `=== 'platinum'` check.
- `deriveRepertoireStatus`'s parameter renames `platinumChapters` → `completedChapters` (same shape, new meaning: chapters where `isChapterComplete` is true, not literally platinum).
- Every one of the four consumers that currently calls `loadFilteredRepertoireVariations` for chapter/tier computation must switch to `loadRepertoireVariations` (the **unfiltered** variant, which also returns `excludedVariationKeys`) for that specific computation — while any OTHER purpose that file already had for `variations` (the "learned" flat-status check, sequencing which variation to serve next, etc.) keeps using the **filtered** set exactly as before. Two of the four (`mastery/+page.server.ts`, `coach-progress.ts`) have no other purpose for `variations` at all, so they can switch entirely. The other two (`repertoire-status-counts.ts`, and `practice-progress.ts`/`/api/practice/attempt/+server.ts`) need BOTH: fetch unfiltered once, derive the filtered set locally via `filterVariations` for their existing logic, and use the unfiltered set only for the new chapter/tier/completeness computation.
- `practice-progress.ts`'s `applyAttemptResult` currently only receives the filtered `variations` from its one caller. It needs access to the unfiltered set too, for the platinum/completed-chapter cache write. Thread this through however is cleanest given the function's existing signature and its ~9 existing test call sites in `practice-progress.test.ts` — an implementer's judgment call, not dictated here; a new optional parameter defaulting sensibly (e.g. to the same array, for callers/tests that don't care about exclusions) is one reasonable shape.
- Rename `cachePlatinumChaptersReached` → something reflecting "completed" (e.g. `cacheCompletedChaptersReached`), writing to the renamed `chapter_completed` table, gated on `isChapterComplete(...)` rather than `deriveChapterLevel(...) === 'platinum'`.
- `repertoire-progress.ts`'s read/clear of the cache table follows the rename (`chapter_platinum` → `chapter_completed`) but keeps its exact existing lifecycle (earn at attempt-completion, sticky, cleared only by reconciliation, clear-before-summaries ordering from the earlier fix) — no behavior change there beyond the rename and what feeds it.
- Edit `supabase/migrations/0071_chapter_platinum.sql` **in place** (don't add a new migration number) to rename the table, its index, its policies, and its grants from `chapter_platinum` to `chapter_completed` — safe because Task 5's own hand-off note means this migration has not yet been run against production.

**Testing requirements:**
- `chapterLevels.test.ts`: cover `chapterCeiling` (a chapter with only short lines has a low ceiling; an empty chapter has a null ceiling) and `isChapterComplete` (a short chapter fully solved is complete; a chapter with unsolved content at its own ceiling is not; a chapter with an excluded-and-unsolved variation is not complete even if everything else is solved — this last case is the regression test for issue #1 above).
- Add the exclusion-blocks-completion scenario at the integration level too, in at least one of `repertoire-status-counts.ts`'s or `practice-progress.ts`'s test coverage (whichever is more natural given the final signature shape) — this was explicitly called out as a coverage gap with zero existing tests.
- Update `repertoireStatus.test.ts` for the `completedChapters` rename (mechanical — same pattern as Task 2's own rename).

**Verification:** `npm test`, `npm run check`, `npm run lint` — all zero errors, matching every prior task's bar.

---

## After this plan

Per the standing project convention, once this feature is merged: run `mp-code-review` against the diff since this feature's starting commit, and — since this adds a new user-facing capability (the knowledge-level ladder) — run `improve-codebase-architecture` scoped to `chapterLevels.ts` plus everything it touched (including the duplication the final holistic review flagged: the `masterableChapters`/`rowsInChapterTier`/`deriveChapterLevel` pipeline is now inlined in four places, and `LEVEL_LABEL`/`LEVEL_BADGE_CLASS` in two — both explicitly deferred to this pass rather than fixed piecemeal). Also worth a documentation note (no code change) that Proposed Solution #4 in the design doc — reordering `variationSequence.ts`'s automatic sequence by tier — was deliberately dropped after further review of the actual Learn/Practice architecture and the user's own "leave learning as-is" clarification; the design doc's Acceptance Criteria section still describes it and should be amended for consistency, the way the #105 conflict was amended. Remind the user to run migrations `0070_drop_chapter_mastery.sql` and `0071_chapter_platinum.sql` (as amended by Task 10 to create `chapter_completed`, not `chapter_platinum`) manually (Supabase Dashboard SQL editor or `migrate.yml`) and confirm before closing GitHub issue #160.
