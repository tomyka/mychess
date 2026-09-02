# Ceiling-Reached Progress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redefine what "reaching a tier" means across the app — a variation counts once it's been taught up to the current tier's move cap (short = fully solved, long = paused there), not just when it's fully solved — and thread that single definition through Learn's teaching ceiling, the Levels page's medals, chapter-completion badges, and a new picker icon + Learn-page progress bar.

**Architecture:** One new pure predicate (`hasReachedCeiling`) and one new precomputed-map helper (`computeMasteredPliesMap`) in `mastery/teaching.ts`; `mastery/chapterLevels.ts`'s `deriveChapterLevel`/`isChapterComplete`/`teachingCeilingMoveCount` swap their `solvedKeys: ReadonlySet<string>` parameter for a `masteredPlies: ReadonlyMap<string, number>` one, plus a new `currentLevelProgress` export; every caller across the API routes, the Levels page, coach progress, and badge counting threads a `teaching_progress` read through to build that map. The picker gains a `pausedAtCeiling` field/icon distinct from `locked`.

**Tech Stack:** SvelteKit 2 + Svelte 5 (runes), TypeScript, Supabase (Postgres via `@supabase/ssr`), Vitest, Testing Library (Svelte), Tailwind 4.

**Design doc:** `docs/superpowers/specs/2026-09-02-ceiling-reached-progress-design.md` — read it first if anything below is unclear about *why*.

**A note on intermediate state:** Task 2 redefines `chapterLevels.ts`'s exported function signatures. Every caller elsewhere in the repo is fixed in a later, dedicated task (3, 5, 6, 8, 9, 10, 11, 12, 13) — `npm run check` will show real type errors in those NOT-YET-FIXED files between Task 2 and the last of those tasks. This is expected and is why Task 14 (not each intermediate task) is where `npm run check`/`npm run lint` are required to be clean. Do not "fix" this by skipping ahead or combining tasks.

---

### Task 1: `hasReachedCeiling` and `computeMasteredPliesMap` (`mastery/teaching.ts`)

**Files:**
- Modify: `mychess/src/lib/mastery/teaching.ts`
- Test: `mychess/src/lib/mastery/teaching.test.ts`

- [ ] **Step 1: Write the failing tests**

Add this new `import` to the top of `mychess/src/lib/mastery/teaching.test.ts`, replacing the existing one:

```ts
import {
	resolveTeachingStep,
	advanceTeachingProgress,
	arrowMoveForStep,
	sharedMasteredPrefixLength,
	computeMasteredMoveIds,
	isLastPlayerMove,
	knownProgressFor,
	ceilingPlyFor,
	isPausedAtCeiling,
	computeBlockedKeys,
	isCeilingReachedAnywhere,
	isLockedForTier,
	hasReachedCeiling,
	computeMasteredPliesMap
} from './teaching';
```

Add this new `describe` block at the end of the file, after the existing `describe('isLockedForTier ...)` block:

```ts
describe('hasReachedCeiling (GitHub issue #181)', () => {
	it('is true for a short variation once fully solved', () => {
		const p = path(['e4', 'e5', 'Nf3']); // 2 player moves, ends on the player's own move
		expect(hasReachedCeiling(p, p.length, 9)).toBe(true);
	});

	it('is false for a short variation short of its own end', () => {
		const p = path(['e4', 'e5', 'Nf3']);
		expect(hasReachedCeiling(p, p.length - 1, 9)).toBe(false);
	});

	it('is true for a long variation exactly at the ceiling', () => {
		const p = path(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O']); // 5 player moves
		const ceilingPly = ceilingPlyFor(p, 2);
		expect(hasReachedCeiling(p, ceilingPly, 2)).toBe(true);
	});

	it('is false for a long variation short of the ceiling', () => {
		const p = path(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O']);
		const ceilingPly = ceilingPlyFor(p, 2);
		expect(hasReachedCeiling(p, ceilingPly - 1, 2)).toBe(false);
	});
});

describe('computeMasteredPliesMap (GitHub issue #181)', () => {
	it("matches knownProgressFor's own per-variation result for the same inputs", () => {
		const long = makeVariation('a', makePath(24));
		const b = makeVariation('b', makePath(8));
		const teachingProgress = new Map([
			['a', { taughtPlies: 5, masteredPlies: 3 }],
			['b', { taughtPlies: 8, masteredPlies: 8 }]
		]);
		const solvedKeys = new Set<string>();
		const map = computeMasteredPliesMap([long, b], teachingProgress, solvedKeys);
		expect(map.get('a')).toBe(
			knownProgressFor({ variation: long, variations: [long, b], teachingProgress, solvedKeys, resumedAfterBreak: false })
				.masteredPlies
		);
		expect(map.get('b')).toBe(8);
	});

	it('gives a solved variation full credit even if its own stored masteredPlies counter would say less', () => {
		const p = makePath(6);
		const v1 = makeVariation('v1', p);
		const teachingProgress = new Map([['v1', { taughtPlies: 6, masteredPlies: 2 }]]); // stale/lagging counter
		const map = computeMasteredPliesMap([v1], teachingProgress, new Set(['v1']));
		expect(map.get('v1')).toBe(p.length);
	});

	it('reuses a precomputed masteredMoveIds set when passed, instead of recomputing it', () => {
		const p = makePath(6);
		const v1 = makeVariation('v1', p);
		const precomputed = new Set(p.slice(0, 3).map((s) => s.moveId));
		const map = computeMasteredPliesMap([v1], new Map(), new Set(), precomputed);
		expect(map.get('v1')).toBe(3);
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd mychess && npx vitest run src/lib/mastery/teaching.test.ts`
Expected: FAIL — `hasReachedCeiling`/`computeMasteredPliesMap` are not exported from `./teaching`.

- [ ] **Step 3: Add the implementation**

In `mychess/src/lib/mastery/teaching.ts`, add these two new exports directly after `isLockedForTier` (i.e., right before the `sharedMasteredPrefixLength` function, so the new ceiling-related exports stay grouped together):

```ts
/**
 * Whether `path` has been taught at least as far as `ceilingMoveCount`
 * allows — true both for a variation genuinely PAUSED there
 * (`isPausedAtCeiling`) and for one whose own true end already lies at or
 * before the ceiling and has been fully mastered (an ordinary solve). The
 * single predicate `chapterLevels.ts`'s tier derivation needs (GitHub issue
 * #181): "is there nothing more THIS tier could currently ask of this
 * variation" — regardless of whether that's because it's short and done, or
 * long and capped.
 */
export function hasReachedCeiling(path: readonly VariationStep[], masteredPlies: number, ceilingMoveCount: number): boolean {
	const ceilingPly = ceilingPlyFor(path, ceilingMoveCount);
	return masteredPlies >= Math.min(path.length, ceilingPly);
}

/**
 * Every variation's effective `masteredPlies` — shared-credit-aware, matching
 * what `knownProgressFor` would return for each individually — computed ONCE
 * for the whole repertoire (GitHub issue #181). `deriveChapterLevel` needs
 * this per variation for EVERY tier check, and a caller that derives levels
 * for many chapters in one request (the Levels page, coach student-progress)
 * must not recompute `computeMasteredMoveIds` (an O(repertoire) scan) once
 * per chapter — that would turn an O(n) question into O(chapters × n). Same
 * solved-gets-full-credit branch as `computeMasteredMoveIds` itself, for the
 * same reason: a just-solved variation's own `masteredPlies` counter isn't
 * guaranteed to be caught up in every caller's snapshot, but `solvedKeys`
 * always is.
 *
 * `masteredMoveIds`, when passed, is used as-is instead of being recomputed —
 * mirrors `knownProgressFor`'s own optional parameter of the same name, for a
 * caller that already computed it for an unrelated reason in the same
 * request (e.g. `/api/repertoires/[id]/variations`).
 */
export function computeMasteredPliesMap(
	variations: Variation[],
	teachingProgress: ReadonlyMap<string, { taughtPlies: number; masteredPlies: number }>,
	solvedKeys: ReadonlySet<string>,
	masteredMoveIds: ReadonlySet<string> = computeMasteredMoveIds(variations, teachingProgress, solvedKeys)
): Map<string, number> {
	const map = new Map<string, number>();
	for (const v of variations) {
		map.set(v.variationKey, solvedKeys.has(v.variationKey) ? v.path.length : sharedMasteredPrefixLength(v.path, masteredMoveIds));
	}
	return map;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd mychess && npx vitest run src/lib/mastery/teaching.test.ts`
Expected: PASS (all tests in the file, including the new ones).

- [ ] **Step 5: Commit**

```bash
git add mychess/src/lib/mastery/teaching.ts mychess/src/lib/mastery/teaching.test.ts
git commit -m "feat(mastery): add hasReachedCeiling and computeMasteredPliesMap

New pure primitives for GitHub issue #181 — deriveChapterLevel's
upcoming redefinition needs a per-variation reached-the-ceiling
predicate and a precomputed, shared-credit-aware masteredPlies map."
```

---

### Task 2: Redefine `chapterLevels.ts`'s tier derivation

**Files:**
- Modify: `mychess/src/lib/mastery/chapterLevels.ts`
- Modify: `mychess/src/lib/mastery/chapterLevels.test.ts`

- [ ] **Step 1: Rewrite the test file to the new `(variations, masteredPlies)` contract, and add new coverage**

Replace the entire contents of `mychess/src/lib/mastery/chapterLevels.test.ts` with:

```ts
import { describe, it, expect } from 'vitest';
import {
	tierForMoveCount,
	deriveChapterLevel,
	deriveRepertoireLevel,
	chapterCeiling,
	isChapterComplete,
	teachingCeilingMoveCount,
	currentLevelProgress
} from './chapterLevels';
import { ceilingPlyFor } from './teaching';
import type { VariationStep } from './variations';

/**
 * A path of `playerMoveCount` player moves, alternating turns starting with
 * the player (ply 0), ending on the player's own move — mirrors
 * `teaching.test.ts`'s own `path` helper, since `hasReachedCeiling`'s
 * ceiling-ply math only cares about player-turn parity, not real chess
 * content.
 */
function pathOfMoves(variationKey: string, playerMoveCount: number): VariationStep[] {
	const plies = playerMoveCount * 2 - 1;
	const path: VariationStep[] = [];
	for (let i = 0; i < plies; i++) {
		path.push({ moveId: `${variationKey}-${i}`, san: `m${i}`, fromFen: 'x', toFen: 'y', isPlayerTurn: i % 2 === 0 });
	}
	return path;
}

const v = (variationKey: string, playerMoveCount: number) => ({
	variationKey,
	playerMoveCount,
	path: pathOfMoves(variationKey, playerMoveCount)
});

/**
 * The new equivalent of the old `new Set([...])` "solved keys" fixture: every
 * row not named in `solvedKeys` gets `masteredPlies: 0` (untouched); every
 * row named gets full credit (its own path length, i.e. genuinely solved).
 */
function masteredFrom(rows: ReturnType<typeof v>[], solvedKeys: string[]): Map<string, number> {
	const solved = new Set(solvedKeys);
	return new Map(rows.map((r) => [r.variationKey, solved.has(r.variationKey) ? r.path.length : 0]));
}

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
		expect(deriveChapterLevel(rows, masteredFrom(rows, ['a']))).toBeNull();
	});

	it('reaches bronze once the bronze bracket is fully solved and there is nothing higher', () => {
		const rows = [v('a', 3), v('b', 5)];
		expect(deriveChapterLevel(rows, masteredFrom(rows, ['a', 'b']))).toBe('bronze');
	});

	// The cumulative-ladder rule: solving only the silver-tier line while a
	// bronze-tier line in the same chapter is unsolved must NOT grant silver.
	it('does not grant silver while a lower, bronze-tier variation is unsolved', () => {
		const rows = [v('bronzeLine', 5), v('silverLine', 12)];
		expect(deriveChapterLevel(rows, masteredFrom(rows, ['silverLine']))).toBeNull();
	});

	it('grants silver once both bronze- and silver-tier variations are solved', () => {
		const rows = [v('bronzeLine', 5), v('silverLine', 12)];
		expect(deriveChapterLevel(rows, masteredFrom(rows, ['bronzeLine', 'silverLine']))).toBe('silver');
	});

	// "Vacuous bracket" is retired as its own mechanism (GitHub issue #181) —
	// this now exercises the terminal ceiling clamp instead: without it, a
	// chapter whose tallest content is Silver-length would be reported as
	// Gold or Platinum too, since higher-tier checks are trivially satisfied
	// once nothing in the chapter extends that far.
	it("clamps to the chapter's own ceiling even once every check is otherwise trivially satisfied", () => {
		const rows = [v('bronzeLine', 5), v('silverLine', 15)]; // nothing gold or platinum
		expect(deriveChapterLevel(rows, masteredFrom(rows, ['bronzeLine', 'silverLine']))).toBe('silver');
	});

	it('reaches platinum once every bracket that has content is fully solved', () => {
		const rows = [v('a', 5), v('b', 15), v('c', 22), v('d', 30)];
		expect(deriveChapterLevel(rows, masteredFrom(rows, ['a', 'b', 'c', 'd']))).toBe('platinum');
	});

	it('is null for a chapter with no variations at all', () => {
		expect(deriveChapterLevel([], new Map())).toBeNull();
	});

	// The deliberate, larger behavior change GitHub issue #181 introduces:
	// reaching a tier's cap is real progress now, so an untouched long
	// variation blocks even Bronze — not just its own, higher tier.
	it('blocks even bronze while a longer variation has not yet been taught up to the bronze ceiling, even though it is not in the bronze bracket', () => {
		const rows = [v('short1', 5), v('short2', 9), v('long', 15)];
		const masteredPlies = new Map([
			['short1', rows[0].path.length],
			['short2', rows[1].path.length]
			// 'long' has no entry -> defaults to masteredPlies 0, untouched
		]);
		expect(deriveChapterLevel(rows, masteredPlies)).toBeNull();
	});

	it('grants bronze once a longer variation has at least REACHED the bronze ceiling, without needing to be fully solved', () => {
		const rows = [v('short1', 5), v('short2', 9), v('long', 15)];
		const longRow = rows[2];
		const masteredPlies = new Map([
			['short1', rows[0].path.length],
			['short2', rows[1].path.length],
			['long', ceilingPlyFor(longRow.path, 9)] // paused at the bronze ceiling, not solved
		]);
		expect(deriveChapterLevel(rows, masteredPlies)).toBe('bronze');
	});
});

describe('chapterCeiling', () => {
	it('is the highest tier the chapter has any content in', () => {
		const rows = [v('a', 5), v('b', 15)]; // bronze + silver, nothing gold or platinum
		expect(chapterCeiling(rows)).toBe('silver');
	});

	it('is platinum when the chapter has content that deep', () => {
		const rows = [v('a', 5), v('b', 30)];
		expect(chapterCeiling(rows)).toBe('platinum');
	});

	it('is null for a chapter with no variations at all', () => {
		expect(chapterCeiling([])).toBeNull();
	});
});

describe('isChapterComplete', () => {
	// The whole point of this predicate: a short chapter's own ceiling (not
	// literally Platinum) is what "complete" means.
	it('is complete once a short chapter (ceiling: silver) is fully solved', () => {
		const rows = [v('a', 5), v('b', 15)];
		expect(isChapterComplete(rows, masteredFrom(rows, ['a', 'b']))).toBe(true);
	});

	it('is not complete while any content at or below its own ceiling is unsolved', () => {
		const rows = [v('a', 5), v('b', 15)];
		expect(isChapterComplete(rows, masteredFrom(rows, ['a']))).toBe(false);
	});

	it('is not complete for an empty chapter', () => {
		expect(isChapterComplete([], new Map())).toBe(false);
	});

	// Regression test for the exclusion-blocking bug: an excluded, never-solved
	// variation must remain present in the array passed in here (never
	// pre-filtered out upstream) for this to hold — its masteredPlies staying
	// at 0 is what should keep the chapter below its own ceiling, with no
	// exclusion special-casing needed inside this function itself.
	it('is not complete when an excluded, never-solved variation is still present in the (unfiltered) array, even if everything else is solved', () => {
		const rows = [v('a', 5), v('excludedLine', 15)]; // ceiling: silver
		expect(isChapterComplete(rows, masteredFrom(rows, ['a']))).toBe(false);
	});
});

describe('teachingCeilingMoveCount', () => {
	it('is 9 (bronze) when nothing has been reached yet', () => {
		const rows = [v('a', 5), v('b', 15)];
		expect(teachingCeilingMoveCount(rows, masteredFrom(rows, []))).toBe(9);
	});

	it('is 9 while any <=9-move variation anywhere is unsolved, even if a longer one is solved', () => {
		const rows = [v('short', 5), v('long', 15)];
		expect(teachingCeilingMoveCount(rows, masteredFrom(rows, ['long']))).toBe(9);
	});

	it('rises to 18 once every <=9-move variation is solved AND every longer variation has at least reached the 9-move ceiling', () => {
		const rows = [v('short1', 5), v('short2', 9), v('long', 15)];
		const longRow = rows[2];
		const masteredPlies = new Map([
			['short1', rows[0].path.length],
			['short2', rows[1].path.length],
			['long', ceilingPlyFor(longRow.path, 9)] // reached, not solved
		]);
		expect(teachingCeilingMoveCount(rows, masteredPlies)).toBe(18);
	});

	it('stays at 9 while a longer variation has not yet been taught up to the bronze ceiling, even once every <=9-move variation is solved (GitHub issue #181 — the deliberate behavior change)', () => {
		const rows = [v('short1', 5), v('short2', 9), v('long', 15)];
		const masteredPlies = new Map([
			['short1', rows[0].path.length],
			['short2', rows[1].path.length]
			// 'long' untouched
		]);
		expect(teachingCeilingMoveCount(rows, masteredPlies)).toBe(9);
	});

	it('rises to 27 once every <=18-move variation is solved and every longer variation has reached the 18-move ceiling', () => {
		const rows = [v('short', 5), v('mid', 15), v('gold', 22)];
		const goldRow = rows[2];
		const masteredPlies = new Map([
			['short', rows[0].path.length],
			['mid', rows[1].path.length],
			['gold', ceilingPlyFor(goldRow.path, 18)]
		]);
		expect(teachingCeilingMoveCount(rows, masteredPlies)).toBe(27);
	});

	it('is Infinity once every <=27-move variation is solved', () => {
		const rows = [v('a', 5), v('b', 27)];
		expect(teachingCeilingMoveCount(rows, masteredFrom(rows, ['a', 'b']))).toBe(Infinity);
	});

	// The deadlock case §3 of the tier-gated Learn design doc exists to rule
	// out: a repertoire (or pool) with NO bronze-length content at all must
	// not stay capped at 9 forever just because nothing can ever satisfy that
	// bracket.
	it('does not deadlock when nothing in the pool is bronze-length at all', () => {
		const rows = [v('a', 15), v('b', 15)];
		expect(teachingCeilingMoveCount(rows, masteredFrom(rows, ['a', 'b']))).toBe(27);
	});

	it('is 9 for an empty pool', () => {
		expect(teachingCeilingMoveCount([], new Map())).toBe(9);
	});
});

describe('currentLevelProgress', () => {
	it('is 0/total at bronze when nothing has been touched yet', () => {
		const rows = [v('a', 5), v('b', 15)];
		expect(currentLevelProgress(rows, new Map())).toEqual({ tier: 'bronze', ready: 0, total: 2 });
	});

	it('counts a variation as ready once it reaches the current ceiling, solved or merely paused', () => {
		// A third, untouched variation keeps bronze from fully clearing —
		// otherwise reaching 100% at a tier and moving the ceiling to the NEXT
		// tier happen in the exact same computation (see teachingCeilingMoveCount:
		// the moment a tier is fully achieved, it stops being "current" and the
		// next tier's cap is reported instead), so "ready === total" at a tier
		// that has actually cleared is a structural impossibility below platinum.
		const rows = [v('short', 5), v('long', 15), v('untouched', 9)];
		const masteredPlies = new Map([
			['short', rows[0].path.length], // solved
			['long', ceilingPlyFor(rows[1].path, 9)] // paused at the bronze ceiling
			// 'untouched' has no entry -> masteredPlies 0, keeps bronze from clearing
		]);
		expect(currentLevelProgress(rows, masteredPlies)).toEqual({ tier: 'bronze', ready: 2, total: 3 });
	});

	it('reflects the risen ceiling once bronze fully clears', () => {
		const rows = [v('short1', 5), v('short2', 9), v('long', 15)];
		const masteredPlies = new Map([
			['short1', rows[0].path.length],
			['short2', rows[1].path.length],
			['long', ceilingPlyFor(rows[2].path, 9)] // reached bronze -> ceiling rises to 18
		]);
		// At the NEW ceiling (18), 'long' (15 moves) has only reached its
		// bronze-cap ply so far, not the (later) silver-cap ply -> not ready yet.
		expect(currentLevelProgress(rows, masteredPlies)).toEqual({ tier: 'silver', ready: 2, total: 3 });
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

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd mychess && npx vitest run src/lib/mastery/chapterLevels.test.ts`
Expected: FAIL — `deriveChapterLevel`/`isChapterComplete`/`teachingCeilingMoveCount` still take `ReadonlySet<string>` as their second parameter, and `currentLevelProgress` doesn't exist yet.

- [ ] **Step 3: Rewrite `chapterLevels.ts`**

Replace the entire contents of `mychess/src/lib/mastery/chapterLevels.ts` with:

```ts
//
// Repertoire knowledge levels: a per-chapter Bronze/Silver/Gold/Platinum
// ladder, tiered by `playerMoveCount` (from `enumerateVariations`) and gated
// on how far each variation has actually been TAUGHT (GitHub issue #181) —
// not merely on `variation_solved` membership. A tier is satisfied once
// every variation in scope has reached that tier's move cap: a short
// variation once genuinely solved, a longer one once paused there
// (`hasReachedCeiling`, `mastery/teaching.ts`). This single redefinition
// backs BOTH this module's own medal derivation AND Learn's teaching
// ceiling (`teachingCeilingMoveCount`) — one function, one meaning,
// everywhere. See docs/superpowers/specs/2026-09-02-ceiling-reached-progress-design.md.
//
// Retires the `chapter_mastery`/mastery-run mechanic — see
// docs/superpowers/specs/2026-08-26-repertoire-knowledge-levels-design.md.
//
// DERIVED, never stored — same convention as `repertoireStatus.ts`: a coach
// edit changes the inputs (`playerMoveCount`, teaching progress) and the
// level recomputes on the next read, with no invalidation job and no
// staleness concept to track.

import { hasReachedCeiling } from './teaching';
import type { VariationStep } from './variations';

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

type ScopedVariation = { variationKey: string; playerMoveCount: number; path: readonly VariationStep[] };

/**
 * A chapter's level: the highest tier T such that EVERY variation in scope
 * (not just tier T's own bracket — see below) has been taught at least up to
 * T's move cap, per `hasReachedCeiling` — a short variation counts once
 * genuinely solved, a longer one once paused there. Solving only a
 * chapter's silver-tier lines while a bronze-tier line is unsolved does not
 * grant silver — it's banked progress, credited the moment bronze finishes.
 *
 * Unlike the prior, `variation_solved`-only definition, an UNTOUCHED long
 * variation now blocks even Bronze until it's been taught up to move 9 — a
 * deliberate, larger behavior change (GitHub issue #181): reaching a tier's
 * cap is real progress toward leveling up, not just something that happens
 * to happen along the way. "Vacuous bracket" (an empty tier skipped
 * outright) is retired as its own mechanism — every variation is checked
 * against every tier's cap up to the chapter's own ceiling, and the
 * terminal `if (tier === ceiling) break` below is what stops a chapter from
 * being reported as a tier it has no content anywhere near (see that line's
 * own comment).
 *
 * An excluded variation is not special-cased here: while excluded, it is
 * never itself taught (never directly served), so its own `masteredPlies`
 * never advances beyond whatever shared-prefix credit its opening moves
 * happen to inherit from other, actively-taught variations (see
 * `computeMasteredPliesMap`) — the same shared-credit mechanism already
 * governing `isLockedForTier` today. In practice this still blocks the
 * ladder past its tier for any exclusion whose own unique content isn't
 * already fully covered by a sibling, which is the common case; if it was
 * solved BEFORE being excluded, its full-credit entry (via `solvedKeys`)
 * persists and never blocks. That guarantee only holds if the excluded
 * variation is still present in `variationsInChapter` — every real caller
 * MUST pass the unfiltered variation set here (excluded variations
 * included), never a pre-filtered one, or an excluded-and-unsolved
 * variation's bracket shrinks or vanishes instead of blocking.
 */
export function deriveChapterLevel(
	variationsInChapter: readonly ScopedVariation[],
	masteredPlies: ReadonlyMap<string, number>
): Tier | null {
	const ceiling = chapterCeiling(variationsInChapter);
	if (ceiling === null) return null;
	let achieved: Tier | null = null;
	for (const tier of TIER_ORDER) {
		const cap = TIER_MAX_PLAYER_MOVES[tier];
		const allReached = variationsInChapter.every((v) => hasReachedCeiling(v.path, masteredPlies.get(v.variationKey) ?? 0, cap));
		if (!allReached) break; // A real, not-yet-reached tier blocks further advancement.
		achieved = tier;
		// Load-bearing, not an optimization: without this, a chapter whose
		// tallest content is (say) Silver-length would trivially satisfy
		// Gold's and Platinum's checks too (nothing left in the chapter for
		// those caps to meaningfully ask about — `hasReachedCeiling` is
		// vacuously true once a variation's own end already lies behind the
		// cap), over-reporting a tier the chapter has no content anywhere
		// near.
		if (tier === ceiling) break;
	}
	return achieved;
}

/**
 * The highest tier this chapter has ANY variation in — its own ceiling,
 * independent of what's been taught. Null for an empty chapter.
 *
 * This is deliberately separate from `deriveChapterLevel`'s cumulative
 * ladder: a chapter capped at Silver (nothing past move 18) has a Silver
 * ceiling, and should be able to count as fully "complete" once it reaches
 * that ceiling — see `isChapterComplete` — without needing to reach Platinum,
 * which it structurally never can.
 */
export function chapterCeiling(variationsInChapter: readonly ScopedVariation[]): Tier | null {
	let ceiling: Tier | null = null;
	let ceilingRank = -1;
	for (const v of variationsInChapter) {
		const rank = TIER_RANK[tierForMoveCount(v.playerMoveCount)];
		if (rank > ceilingRank) {
			ceilingRank = rank;
			ceiling = tierForMoveCount(v.playerMoveCount);
		}
	}
	return ceiling;
}

/**
 * Whether a chapter has reached its own ceiling — the "mastered"/"completed"
 * bar. `false` for an empty chapter (a null ceiling can never be "reached").
 *
 * Because `deriveChapterLevel` only ever consults `masteredPlies`, an
 * excluded variation that was never taught blocks completion here exactly
 * the way it blocks the ladder itself — but ONLY if it is still present in
 * `variationsInChapter`. Callers MUST pass the unfiltered variation set
 * (including excluded variations) for this to hold.
 */
export function isChapterComplete(
	variationsInChapter: readonly ScopedVariation[],
	masteredPlies: ReadonlyMap<string, number>
): boolean {
	const ceiling = chapterCeiling(variationsInChapter);
	if (ceiling === null) return false;
	return deriveChapterLevel(variationsInChapter, masteredPlies) === ceiling;
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

/**
 * The player-move-count Learn may currently teach up to, repertoire-wide: the
 * ceiling of the tier immediately above the pooled repertoire's own tier —
 * bronze's own ceiling (9) when nothing has reached it yet, silver's (18)
 * once every <=9-move variation REPERTOIRE-WIDE has reached it (solved if
 * short enough, paused there if longer), and so on, unlimited once every
 * <=27-move variation has.
 *
 * Deliberately reuses `deriveChapterLevel` over `allVariations` pooled
 * together — the WHOLE repertoire treated as one chapter — rather than
 * per-chapter-then-`deriveRepertoireLevel`. See
 * docs/superpowers/specs/2026-08-26-tier-gated-learn-design.md §3 for why:
 * min-ing independently-computed per-chapter LEVELS reintroduces a deadlock
 * `deriveChapterLevel`'s own ceiling clamp already solves once, at the
 * chapter level — a chapter with nothing bronze-length at all would
 * otherwise permanently cap the whole repertoire at 9. Pooling first, then
 * deriving once, is not an optimisation of the per-chapter approach; it is a
 * different, correct answer to a subtly different question. This is a
 * SEPARATE call from `deriveRepertoireLevel` (which keeps its own,
 * different, unaffected meaning — the Levels page's "worst chapter's medal"
 * display) — the two can legitimately disagree and both be right.
 *
 * `allVariations` MUST be the repertoire's UNFILTERED variation set, for the
 * same exclusion-blocking reason `deriveChapterLevel` itself documents.
 */
export function teachingCeilingMoveCount(
	allVariations: readonly ScopedVariation[],
	masteredPlies: ReadonlyMap<string, number>
): number {
	const repertoireWideLevel = deriveChapterLevel(allVariations, masteredPlies);
	if (repertoireWideLevel === null) return TIER_MAX_PLAYER_MOVES.bronze;
	const idx = TIER_ORDER.indexOf(repertoireWideLevel);
	const nextTier = TIER_ORDER[idx + 1];
	return nextTier ? TIER_MAX_PLAYER_MOVES[nextTier] : Infinity;
}

/**
 * How close the repertoire is to its NEXT teaching ceiling — same pooled-
 * repertoire convention as `teachingCeilingMoveCount` (see that function's
 * own doc comment for why pooled, not per-chapter). `ready` counts every
 * variation that has already reached the CURRENT ceiling — genuinely nothing
 * more this tier can ask of it, short-and-solved or long-and-paused alike.
 * Once `ready === total`, the next read of `teachingCeilingMoveCount`
 * reflects the raised ceiling; this is the SAME computation exposed as a
 * fraction instead of a boolean, not a second source of truth. Backs the
 * Learn page's "current level" progress bar (GitHub issue #181).
 */
export function currentLevelProgress(
	allVariations: readonly ScopedVariation[],
	masteredPlies: ReadonlyMap<string, number>
): { tier: Tier; ready: number; total: number } {
	const ceilingMoveCount = teachingCeilingMoveCount(allVariations, masteredPlies);
	const ready = allVariations.filter((v) => hasReachedCeiling(v.path, masteredPlies.get(v.variationKey) ?? 0, ceilingMoveCount)).length;
	// `tierForMoveCount` already falls back to 'platinum' for Infinity (its
	// own loop's final `return`), so no special-casing is needed here.
	return { tier: tierForMoveCount(ceilingMoveCount), ready, total: allVariations.length };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd mychess && npx vitest run src/lib/mastery/chapterLevels.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Confirm the expected (not-yet-fixed) breakage elsewhere**

Run: `cd mychess && npm run check`
Expected: Real type errors in `src/routes/api/repertoires/[id]/variations/+server.ts`, `src/routes/api/practice/select-variation/+server.ts`, `src/routes/(player)/learn/[repertoire_id]/+page.server.ts`, `src/routes/api/practice/attempt/+server.ts`, `src/lib/server/practice-progress.ts`, `src/routes/(player)/practice/[repertoire_id]/mastery/+page.server.ts`, `src/lib/server/coach-progress.ts`, `src/lib/server/repertoire-status-counts.ts` — each passing a `ReadonlySet<string>` (`solvedKeys`/`learnedKeys`) where a `ReadonlyMap<string, number>` is now required. This is expected; Tasks 3, 5, 6, 8, 9, 10, 11, 12 fix these one at a time.

- [ ] **Step 6: Commit**

```bash
git add mychess/src/lib/mastery/chapterLevels.ts mychess/src/lib/mastery/chapterLevels.test.ts
git commit -m "feat(mastery): redefine deriveChapterLevel on ceiling-reached, not solved-only

A tier is now satisfied once every variation in scope has been
taught at least up to its move cap, not just once same-tier-length
variations are individually solved — an untouched long variation now
blocks even Bronze until it's been taught that far. Adds
currentLevelProgress for the Learn page's new progress bar. Callers
are updated in following commits (GitHub issue #181)."
```

---

### Task 3: `/api/repertoires/[id]/variations` — `pausedAtCeiling` field + masteredPlies wiring

**Files:**
- Modify: `mychess/src/routes/api/repertoires/[id]/variations/+server.ts`

- [ ] **Step 1: Update the imports and doc comment**

In `mychess/src/routes/api/repertoires/[id]/variations/+server.ts`, replace the import block:

```ts
import { teachingCeilingMoveCount } from '$lib/mastery/chapterLevels';
import { isLockedForTier, isCeilingReachedAnywhere, knownProgressFor, computeMasteredMoveIds } from '$lib/mastery/teaching';
```

with:

```ts
import { teachingCeilingMoveCount } from '$lib/mastery/chapterLevels';
import {
	isLockedForTier,
	isPausedAtCeiling,
	isCeilingReachedAnywhere,
	knownProgressFor,
	computeMasteredMoveIds,
	computeMasteredPliesMap
} from '$lib/mastery/teaching';
```

Add one sentence to the function's doc comment — after the existing sentence ending "...(GitHub issue #172, `isLockedForTier`) —", insert (keeping everything else in that paragraph unchanged):

```
 and a separate `pausedAtCeiling` flag — the REFINEMENT of `locked` telling the
 picker WHICH of those two reasons applies, so it can show a distinct icon for
 "reached, counts toward leveling up" vs. "genuinely not reachable yet"
 (GitHub issue #181) —
```

- [ ] **Step 2: Compute `masteredPlies` before the ceiling, reusing the existing `masteredMoveIds`**

Replace:

```ts
	const ceilingMoveCount = teachingCeilingMoveCount(variations, solvedKeys);
	const excludedPairs = new Set(chapterExclusions.map((r) => `${r.chapter_name}${PAIR_SEP}${r.variation_key}`));
	// Computed once, not once per row — `knownProgressFor` below and
	// `isCeilingReachedAnywhere` would otherwise each independently re-derive
	// the same whole-repertoire set, an O(n) scan repeated per row.
	const masteredMoveIds = computeMasteredMoveIds(variations, teachingProgress, solvedKeys);
```

with:

```ts
	const excludedPairs = new Set(chapterExclusions.map((r) => `${r.chapter_name}${PAIR_SEP}${r.variation_key}`));
	// Computed once, not once per row — `knownProgressFor` below and
	// `isCeilingReachedAnywhere` would otherwise each independently re-derive
	// the same whole-repertoire set, an O(n) scan repeated per row. Also
	// reused for `computeMasteredPliesMap` below (GitHub issue #181), so the
	// teaching ceiling itself and every row's own masteredPlies agree on
	// exactly the same credit.
	const masteredMoveIds = computeMasteredMoveIds(variations, teachingProgress, solvedKeys);
	const repertoireMasteredPlies = computeMasteredPliesMap(variations, teachingProgress, solvedKeys, masteredMoveIds);
	const ceilingMoveCount = teachingCeilingMoveCount(variations, repertoireMasteredPlies);
```

- [ ] **Step 3: Add the `pausedAtCeiling` field to each row**

Replace:

```ts
			return {
				variationKey: v.variationKey,
				label: moveSequenceLabel(v.path),
				includedByChapter,
				chapterNames: v.chapterNames,
				path: v.path,
				solved,
				playerMoveCount: v.playerMoveCount,
				locked: !solved && isLockedForTier(v.path, masteredPlies, ceilingMoveCount, ceilingReached),
				ceilingMoveCount
			};
```

with:

```ts
			return {
				variationKey: v.variationKey,
				label: moveSequenceLabel(v.path),
				includedByChapter,
				chapterNames: v.chapterNames,
				path: v.path,
				solved,
				playerMoveCount: v.playerMoveCount,
				locked: !solved && isLockedForTier(v.path, masteredPlies, ceilingMoveCount, ceilingReached),
				pausedAtCeiling: !solved && isPausedAtCeiling(v.path, masteredPlies, ceilingMoveCount),
				ceilingMoveCount
			};
```

- [ ] **Step 4: Verify it compiles**

Run: `cd mychess && npx svelte-check --output human 2>&1 | grep -A3 "routes/api/repertoires"`
Expected: No output (no errors for this file).

- [ ] **Step 5: Commit**

```bash
git add mychess/src/routes/api/repertoires/\[id\]/variations/+server.ts
git commit -m "feat(learn): send pausedAtCeiling per row from the variations endpoint

Distinguishes 'reached the current ceiling, counts toward leveling
up' from the other reason a row can be locked, for the picker's new
icon split (GitHub issue #181)."
```

---

### Task 4: Picker — paused vs. locked icon split

**Files:**
- Modify: `mychess/src/lib/components/VariationPicker.svelte`
- Modify: `mychess/src/lib/components/VariationPicker.test.ts`
- Modify: `mychess/messages/en.json`
- Modify: `mychess/messages/lt.json`

- [ ] **Step 1: Add the new message keys and update the legend text**

In `mychess/messages/en.json`, add a new key directly after `"variation_picker_learned_reason": "Already learned",`:

```json
	"variation_picker_paused_reason": "Reached this level's limit here — still counts toward leveling up",
```

In the same file, change:

```json
	"variation_picker_legend": "🔒 locked · ✓ learned",
```

to:

```json
	"variation_picker_legend": "🔒 locked · ⏳ paused · ✓ learned",
```

In `mychess/messages/lt.json`, add a new key directly after `"variation_picker_learned_reason": "Jau išmokta",`:

```json
	"variation_picker_paused_reason": "Pasiektas šio lygio limitas čia — vis tiek įskaičiuojama kylant į kitą lygį",
```

In the same file, change:

```json
	"variation_picker_legend": "🔒 užrakinta · ✓ išmokta",
```

to:

```json
	"variation_picker_legend": "🔒 užrakinta · ⏳ pristabdyta · ✓ išmokta",
```

- [ ] **Step 2: Write the failing tests**

In `mychess/src/lib/components/VariationPicker.test.ts`, update the `row()` helper's options type and returned object — replace:

```ts
function row(
	variationKey: string,
	sans: string[],
	chapterNames: string[],
	opts: { included?: boolean; solved?: boolean; locked?: boolean; ceilingMoveCount?: number } = {}
) {
	const included = opts.included ?? true;
	const chapters = chapterNames.length > 0 ? chapterNames : [UNTAGGED_CHAPTER];
	const includedByChapter: Record<string, boolean> = {};
	for (const c of chapters) includedByChapter[c] = included;
	return {
		variationKey,
		label: `label:${variationKey}`, // stand-in for the server's own moveSequenceLabel(v.path) — irrelevant to grouping
		includedByChapter,
		chapterNames,
		path: path(sans),
		solved: opts.solved ?? false,
		locked: opts.locked ?? false,
		// Defaults to Infinity — no row is ever "past the ceiling" unless a test
		// explicitly opts in, so every EXISTING test in this file (none of which
		// pass this option) is completely unaffected by ceiling-frontier grouping.
		ceilingMoveCount: opts.ceilingMoveCount ?? Infinity
	};
}
```

with:

```ts
function row(
	variationKey: string,
	sans: string[],
	chapterNames: string[],
	opts: { included?: boolean; solved?: boolean; locked?: boolean; pausedAtCeiling?: boolean; ceilingMoveCount?: number } = {}
) {
	const included = opts.included ?? true;
	const chapters = chapterNames.length > 0 ? chapterNames : [UNTAGGED_CHAPTER];
	const includedByChapter: Record<string, boolean> = {};
	for (const c of chapters) includedByChapter[c] = included;
	return {
		variationKey,
		label: `label:${variationKey}`, // stand-in for the server's own moveSequenceLabel(v.path) — irrelevant to grouping
		includedByChapter,
		chapterNames,
		path: path(sans),
		solved: opts.solved ?? false,
		locked: opts.locked ?? false,
		// Defaults to false — no row is paused unless a test explicitly opts
		// in (GitHub issue #181), so every EXISTING test in this file is
		// unaffected.
		pausedAtCeiling: opts.pausedAtCeiling ?? false,
		// Defaults to Infinity — no row is ever "past the ceiling" unless a test
		// explicitly opts in, so every EXISTING test in this file (none of which
		// pass this option) is completely unaffected by ceiling-frontier grouping.
		ceilingMoveCount: opts.ceilingMoveCount ?? Infinity
	};
}
```

Replace the existing legend test:

```ts
		it('shows a one-line legend explaining the lock/learned icons above the leaf-row list', async () => {
			const rows = [row('v1', ['e4', 'e5', 'Nf3'], ['Ruy Lopez'], { locked: true })];
			vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => rows }));
			render(VariationPicker, { props: { repertoireId: 'rep-1', onselect: vi.fn(), onclose: vi.fn() } });

			await waitFor(() => screen.getByText('Ruy Lopez'));
			await fireEvent.click(screen.getByText('Ruy Lopez'));

			expect(screen.getByText('🔒 locked · ✓ learned')).toBeTruthy();
		});
```

with:

```ts
		it('shows a one-line legend explaining the lock/paused/learned icons above the leaf-row list', async () => {
			const rows = [row('v1', ['e4', 'e5', 'Nf3'], ['Ruy Lopez'], { locked: true })];
			vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => rows }));
			render(VariationPicker, { props: { repertoireId: 'rep-1', onselect: vi.fn(), onclose: vi.fn() } });

			await waitFor(() => screen.getByText('Ruy Lopez'));
			await fireEvent.click(screen.getByText('Ruy Lopez'));

			expect(screen.getByText('🔒 locked · ⏳ paused · ✓ learned')).toBeTruthy();
		});
```

Add this new `describe` block right after the closing `});` of `describe('locked variations (GitHub issue #163)', ...)` (i.e., as a sibling, before `describe('ceiling-frontier grouping ...)`):

```ts
	describe('paused-at-ceiling variations (GitHub issue #181)', () => {
		it('renders a paused leaf row with a distinct icon and reason, disabled, not selectable', async () => {
			const mixed = [
				row('v1', ['e4', 'e5', 'Nf3'], ['Ruy Lopez'], { locked: true, pausedAtCeiling: true }),
				row('v2', ['d4', 'd5', 'c4'], ['Italian Game'])
			];
			const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => mixed });
			vi.stubGlobal('fetch', fetchSpy);
			const onselect = vi.fn();
			render(VariationPicker, { props: { repertoireId: 'rep-1', onselect, onselectchapter: vi.fn(), onclose: vi.fn() } });

			await waitFor(() => screen.getByText('Ruy Lopez'));
			await fireEvent.click(screen.getByText('Ruy Lopez'));

			const pausedRow = screen.getByText('label:v1').closest('button')!;
			expect(pausedRow.textContent).toContain('⏳');
			expect(pausedRow.textContent).not.toContain('🔒');
			expect(pausedRow.getAttribute('title')).toBe("Reached this level's limit here — still counts toward leveling up");
			expect(pausedRow).toBeDisabled();
			await fireEvent.click(pausedRow);
			expect(onselect).not.toHaveBeenCalled();
		});

		it('a locked-but-not-paused row keeps the padlock, not the paused icon', async () => {
			const rows = [row('v1', ['e4', 'e5', 'Nf3'], ['Ruy Lopez'], { locked: true, pausedAtCeiling: false })];
			const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => rows });
			vi.stubGlobal('fetch', fetchSpy);
			render(VariationPicker, { props: { repertoireId: 'rep-1', onselect: vi.fn(), onselectchapter: vi.fn(), onclose: vi.fn() } });

			await waitFor(() => screen.getByText('Ruy Lopez'));
			await fireEvent.click(screen.getByText('Ruy Lopez'));

			const lockedRow = screen.getByText('label:v1').closest('button')!;
			expect(lockedRow.textContent).toContain('🔒');
			expect(lockedRow.textContent).not.toContain('⏳');
		});

		it('shows a fully-paused ceiling group with the paused badge, not the padlock', async () => {
			const rows = [
				row('v1', ['e4', 'e5', 'Nf3', 'a6', 'Ba4'], ['Ruy Lopez'], { ceilingMoveCount: 3, locked: true, pausedAtCeiling: true }),
				row('v2', ['e4', 'e5', 'Nf3', 'O-O', 'd3'], ['Ruy Lopez'], { ceilingMoveCount: 3, locked: true, pausedAtCeiling: true })
			];
			const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => rows });
			vi.stubGlobal('fetch', fetchSpy);
			render(VariationPicker, { props: { repertoireId: 'rep-1', onselect: vi.fn(), onselectchapter: vi.fn(), onclose: vi.fn() } });

			await waitFor(() => screen.getByText('Ruy Lopez'));
			await fireEvent.click(screen.getByText('Ruy Lopez'));

			const groupButton = screen.getByText('1.e4 e5 2.Nf3').closest('button')!;
			expect(groupButton.textContent).toContain('⏳');
			expect(groupButton.textContent).not.toContain('🔒');
			expect(groupButton.getAttribute('title')).toBe("Reached this level's limit here — still counts toward leveling up");
		});

		it('shows a ceiling group with a mix of paused and genuinely-locked members with the padlock, not the paused badge', async () => {
			const rows = [
				row('v1', ['e4', 'e5', 'Nf3', 'a6', 'Ba4'], ['Ruy Lopez'], { ceilingMoveCount: 3, locked: true, pausedAtCeiling: true }),
				row('v2', ['e4', 'e5', 'Nf3', 'O-O', 'd3'], ['Ruy Lopez'], { ceilingMoveCount: 3, locked: true, pausedAtCeiling: false })
			];
			const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => rows });
			vi.stubGlobal('fetch', fetchSpy);
			render(VariationPicker, { props: { repertoireId: 'rep-1', onselect: vi.fn(), onselectchapter: vi.fn(), onclose: vi.fn() } });

			await waitFor(() => screen.getByText('Ruy Lopez'));
			await fireEvent.click(screen.getByText('Ruy Lopez'));

			const groupButton = screen.getByText('1.e4 e5 2.Nf3').closest('button')!;
			expect(groupButton.textContent).toContain('🔒');
			expect(groupButton.textContent).not.toContain('⏳');
		});
	});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd mychess && npx vitest run src/lib/components/VariationPicker.test.ts`
Expected: FAIL — `pausedAtCeiling` isn't rendered yet, and the legend text hasn't changed.

- [ ] **Step 4: Update `VariationPicker.svelte`**

Add `pausedAtCeiling` to the `VariationRow` type — replace:

```ts
		solved: boolean;
		// Server-computed (see `/api/repertoires/[id]/variations`): true when this
		// variation sits above the player's current level. Never true alongside
		// `solved` — a solved line is by definition already reachable. This UI
		// disables and explains, purely as a courtesy; the real gate is
		// `/api/practice/select-variation`'s 403 (GitHub issue #163).
		locked: boolean;
		ceilingMoveCount: number;
	};
```

with:

```ts
		solved: boolean;
		// Server-computed (see `/api/repertoires/[id]/variations`): true when this
		// variation sits above the player's current level. Never true alongside
		// `solved` — a solved line is by definition already reachable. This UI
		// disables and explains, purely as a courtesy; the real gate is
		// `/api/practice/select-variation`'s 403 (GitHub issue #163).
		locked: boolean;
		// Server-computed, a REFINEMENT of `locked` (never true unless `locked`
		// is also true): true when this row was taught all the way to the
		// current tier's move cap and paused there, rather than being
		// genuinely unreachable for some other reason (a deferred sibling —
		// GitHub issue #172). Display-only: it changes which icon/tooltip a
		// locked row shows, never whether it's selectable — `locked` alone
		// still governs that (GitHub issue #181).
		pausedAtCeiling: boolean;
		ceilingMoveCount: number;
	};
```

Update `statusTitle` — replace:

```ts
	function statusTitle(locked: boolean, solved: boolean): string | undefined {
		if (locked) return m.variation_picker_locked_reason();
		if (solved) return m.variation_picker_learned_reason();
		return undefined;
	}
```

with:

```ts
	function statusTitle(locked: boolean, solved: boolean, pausedAtCeiling: boolean = false): string | undefined {
		if (pausedAtCeiling) return m.variation_picker_paused_reason();
		if (locked) return m.variation_picker_locked_reason();
		if (solved) return m.variation_picker_learned_reason();
		return undefined;
	}
```

Add a new helper directly after `ceilingGroupDone` — replace:

```ts
	/** Whether every member of a ceiling group is already paused there — nothing left to practice until the tier ceiling itself advances. */
	function ceilingGroupDone(group: MoveGroup<VariationRow>): boolean {
		return group.items.every((r) => r.locked);
	}
```

with:

```ts
	/** Whether every member of a ceiling group is already paused there — nothing left to practice until the tier ceiling itself advances. */
	function ceilingGroupDone(group: MoveGroup<VariationRow>): boolean {
		return group.items.every((r) => r.locked);
	}

	/**
	 * Whether every member of a "done" ceiling group is paused-at-ceiling
	 * SPECIFICALLY, rather than genuinely locked for some other reason — the
	 * group's own badge shows the paused icon only when this is true for
	 * every member, matching a leaf row's own paused/locked split (GitHub
	 * issue #181). Only meaningful when `ceilingGroupDone` is already true.
	 */
	function ceilingGroupPaused(group: MoveGroup<VariationRow>): boolean {
		return group.items.every((r) => r.pausedAtCeiling);
	}
```

Update the leaf-row rendering inside `openGroup` — replace:

```svelte
			{#each openGroup.items as row (row.variationKey)}
				{@const active = isActive(row.variationKey)}
				<li>
					<button
						disabled={row.locked}
						onclick={() => {
							if (!row.locked) onselect(row.variationKey);
						}}
						use:scrollIntoViewIfActive={active}
						title={statusTitle(row.locked, row.solved)}
						class="relative block w-full text-left px-3 py-2 pr-8 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 text-(--color-text) {active
							? 'ring-2 ring-(--color-accent) bg-(--color-accent)/10'
							: ''} {row.locked ? 'opacity-50 cursor-not-allowed' : ''}"
					>
						{row.label}
						{#if row.locked}
							{@render cornerBadge('🔒', 'text-xs', m.variation_picker_locked_reason())}
						{:else if row.solved}
							{@render cornerBadge('✓', 'text-green-600 dark:text-green-400 text-sm', m.variation_picker_learned_reason())}
						{/if}
					</button>
				</li>
			{/each}
```

with:

```svelte
			{#each openGroup.items as row (row.variationKey)}
				{@const active = isActive(row.variationKey)}
				<li>
					<button
						disabled={row.locked}
						onclick={() => {
							if (!row.locked) onselect(row.variationKey);
						}}
						use:scrollIntoViewIfActive={active}
						title={statusTitle(row.locked, row.solved, row.pausedAtCeiling)}
						class="relative block w-full text-left px-3 py-2 pr-8 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 text-(--color-text) {active
							? 'ring-2 ring-(--color-accent) bg-(--color-accent)/10'
							: ''} {row.locked ? 'opacity-50 cursor-not-allowed' : ''}"
					>
						{row.label}
						{#if row.pausedAtCeiling}
							{@render cornerBadge('⏳', 'text-xs', m.variation_picker_paused_reason())}
						{:else if row.locked}
							{@render cornerBadge('🔒', 'text-xs', m.variation_picker_locked_reason())}
						{:else if row.solved}
							{@render cornerBadge('✓', 'text-green-600 dark:text-green-400 text-sm', m.variation_picker_learned_reason())}
						{/if}
					</button>
				</li>
			{/each}
```

Update the ceiling-group rendering — replace:

```svelte
					{#if entry.kind === 'ceiling'}
						{@const done = ceilingGroupDone(entry.group)}
						{@const active = groupHasActive(entry.group)}
						<li>
							<button
								disabled={done}
								onclick={() => {
									if (!done) {
										const representative = pickRepresentative(entry.group.items);
										if (representative) onselect(representative.variationKey);
									}
								}}
								use:scrollIntoViewIfActive={active}
								title={statusTitle(done, false)}
								class="relative block w-full text-left px-3 py-2 pr-12 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 text-(--color-text) font-medium {active
									? 'ring-2 ring-(--color-accent) bg-(--color-accent)/10'
									: ''} {done ? 'opacity-50 cursor-not-allowed' : ''}"
							>
								{moveSequenceLabel(entry.group.steps)}
								<span class="absolute top-2 right-2 flex items-center gap-1.5">
									{#if entry.group.items.length > 1}
										<span class="text-(--color-muted) text-sm">({entry.group.items.length})</span>
									{/if}
									{#if done}
										<span class="text-xs" role="img" aria-label={m.variation_picker_locked_reason()}>🔒</span>
									{/if}
								</span>
							</button>
						</li>
```

with:

```svelte
					{#if entry.kind === 'ceiling'}
						{@const done = ceilingGroupDone(entry.group)}
						{@const paused = done && ceilingGroupPaused(entry.group)}
						{@const active = groupHasActive(entry.group)}
						<li>
							<button
								disabled={done}
								onclick={() => {
									if (!done) {
										const representative = pickRepresentative(entry.group.items);
										if (representative) onselect(representative.variationKey);
									}
								}}
								use:scrollIntoViewIfActive={active}
								title={done ? statusTitle(true, false, paused) : undefined}
								class="relative block w-full text-left px-3 py-2 pr-12 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 text-(--color-text) font-medium {active
									? 'ring-2 ring-(--color-accent) bg-(--color-accent)/10'
									: ''} {done ? 'opacity-50 cursor-not-allowed' : ''}"
							>
								{moveSequenceLabel(entry.group.steps)}
								<span class="absolute top-2 right-2 flex items-center gap-1.5">
									{#if entry.group.items.length > 1}
										<span class="text-(--color-muted) text-sm">({entry.group.items.length})</span>
									{/if}
									{#if paused}
										<span class="text-xs" role="img" aria-label={m.variation_picker_paused_reason()}>⏳</span>
									{:else if done}
										<span class="text-xs" role="img" aria-label={m.variation_picker_locked_reason()}>🔒</span>
									{/if}
								</span>
							</button>
						</li>
```

Update the "regular group, sole variation" rendering — replace:

```svelte
						<button
							disabled={only?.locked ?? false}
							onclick={() => {
								if (only) {
									if (!only.locked) onselect(only.variationKey);
								} else {
									openEntryKey = entryKey(entry);
								}
							}}
							use:scrollIntoViewIfActive={active}
							title={statusTitle(only?.locked ?? false, only?.solved ?? false)}
							class="relative block w-full text-left px-3 py-2 {only ? 'pr-8' : 'pr-12'} rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 text-(--color-text) {only
								? ''
								: 'font-medium'} {active ? 'ring-2 ring-(--color-accent) bg-(--color-accent)/10' : ''} {only?.locked
								? 'opacity-50 cursor-not-allowed'
								: ''}"
						>
							{only ? only.label : groupLabel(entry.group)}
							{#if only}
								{#if only.locked}
									{@render cornerBadge('🔒', 'text-xs', m.variation_picker_locked_reason())}
								{:else if only.solved}
									{@render cornerBadge('✓', 'text-green-600 dark:text-green-400 text-sm', m.variation_picker_learned_reason())}
								{/if}
							{:else}
								{@render cornerBadge(`(${entry.group.items.length})`, 'text-(--color-muted) text-sm')}
							{/if}
						</button>
```

with:

```svelte
						<button
							disabled={only?.locked ?? false}
							onclick={() => {
								if (only) {
									if (!only.locked) onselect(only.variationKey);
								} else {
									openEntryKey = entryKey(entry);
								}
							}}
							use:scrollIntoViewIfActive={active}
							title={statusTitle(only?.locked ?? false, only?.solved ?? false, only?.pausedAtCeiling ?? false)}
							class="relative block w-full text-left px-3 py-2 {only ? 'pr-8' : 'pr-12'} rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 text-(--color-text) {only
								? ''
								: 'font-medium'} {active ? 'ring-2 ring-(--color-accent) bg-(--color-accent)/10' : ''} {only?.locked
								? 'opacity-50 cursor-not-allowed'
								: ''}"
						>
							{only ? only.label : groupLabel(entry.group)}
							{#if only}
								{#if only.pausedAtCeiling}
									{@render cornerBadge('⏳', 'text-xs', m.variation_picker_paused_reason())}
								{:else if only.locked}
									{@render cornerBadge('🔒', 'text-xs', m.variation_picker_locked_reason())}
								{:else if only.solved}
									{@render cornerBadge('✓', 'text-green-600 dark:text-green-400 text-sm', m.variation_picker_learned_reason())}
								{/if}
							{:else}
								{@render cornerBadge(`(${entry.group.items.length})`, 'text-(--color-muted) text-sm')}
							{/if}
						</button>
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd mychess && npx vitest run src/lib/components/VariationPicker.test.ts`
Expected: PASS (all tests, including the four new ones and the updated legend test). The paraglide message modules (`$lib/paraglide/messages`) regenerate automatically as part of this test run picking up the new/changed keys in `messages/en.json`/`lt.json` — do not run `paraglide-js compile` by hand (see `mychess/CLAUDE.md`'s note on this being gotcha-prone).

- [ ] **Step 6: Commit**

```bash
git add mychess/src/lib/components/VariationPicker.svelte mychess/src/lib/components/VariationPicker.test.ts mychess/messages/en.json mychess/messages/lt.json
git commit -m "feat(learn): show a distinct icon for a variation paused at the ceiling

Splits the picker's single padlock into two states: genuinely locked
(padlock) and reached-the-ceiling (new hourglass icon) — closes the
original bug report where completing a variation up to the current
level showed no feedback at all (GitHub issue #181)."
```

---

### Task 5: `/api/practice/select-variation` — masteredPlies wiring

**Files:**
- Modify: `mychess/src/routes/api/practice/select-variation/+server.ts`

- [ ] **Step 1: Update the import and the ceiling computation**

Replace:

```ts
import { isLockedForTier, isCeilingReachedAnywhere, knownProgressFor, computeMasteredMoveIds } from '$lib/mastery/teaching';
```

with:

```ts
import { isLockedForTier, isCeilingReachedAnywhere, knownProgressFor, computeMasteredMoveIds, computeMasteredPliesMap } from '$lib/mastery/teaching';
```

Replace:

```ts
	const [solvedKeys, teachingProgress] = await Promise.all([
		loadSolvedKeys(supabase, user.id, repertoireId),
		loadTeachingProgress(supabase, user.id, repertoireId)
	]);
	const ceilingMoveCount = teachingCeilingMoveCount(allVariations, solvedKeys);
```

with:

```ts
	const [solvedKeys, teachingProgress] = await Promise.all([
		loadSolvedKeys(supabase, user.id, repertoireId),
		loadTeachingProgress(supabase, user.id, repertoireId)
	]);
	// GitHub issue #181: teachingCeilingMoveCount now needs a masteredPlies
	// map, computed over the UNFILTERED `allVariations` set — distinct from
	// the FILTERED-pool `masteredMoveIds` computed further below for the
	// isLockedForTier check, which deliberately uses a different pool (see
	// that computation's own doc comment).
	const masteredPliesForCeiling = computeMasteredPliesMap(allVariations, teachingProgress, solvedKeys);
	const ceilingMoveCount = teachingCeilingMoveCount(allVariations, masteredPliesForCeiling);
```

- [ ] **Step 2: Verify it compiles**

Run: `cd mychess && npx svelte-check --output human 2>&1 | grep -A3 "practice/select-variation"`
Expected: No output.

- [ ] **Step 3: Commit**

```bash
git add mychess/src/routes/api/practice/select-variation/+server.ts
git commit -m "fix(learn): wire select-variation's ceiling check to the new masteredPlies contract (GitHub issue #181)"
```

---

### Task 6: Learn page server load — `currentLevel` field

**Files:**
- Modify: `mychess/src/routes/(player)/learn/[repertoire_id]/+page.server.ts`

- [ ] **Step 1: Update imports and computation**

Replace:

```ts
import { teachingCeilingMoveCount } from '$lib/mastery/chapterLevels';
import { computeBlockedKeys } from '$lib/mastery/teaching';
```

with:

```ts
import { teachingCeilingMoveCount, currentLevelProgress } from '$lib/mastery/chapterLevels';
import { computeBlockedKeys, computeMasteredPliesMap } from '$lib/mastery/teaching';
```

Replace:

```ts
	const variations = filterVariations(allVariations, excludedVariationKeys);
	const ceilingMoveCount = teachingCeilingMoveCount(allVariations, solvedKeys);
```

with:

```ts
	const variations = filterVariations(allVariations, excludedVariationKeys);
	// GitHub issue #181: teachingCeilingMoveCount now needs a masteredPlies
	// map, not solvedKeys directly. currentLevelProgress reuses the exact
	// same map so the Learn page's new progress bar and the ceiling it's
	// measuring progress toward can never disagree.
	const masteredPlies = computeMasteredPliesMap(allVariations, teachingProgress, solvedKeys);
	const ceilingMoveCount = teachingCeilingMoveCount(allVariations, masteredPlies);
	const currentLevel = currentLevelProgress(allVariations, masteredPlies);
```

Replace the final return:

```ts
	const view = buildPracticeView(variations, activeVariationKey, solvedKeys, teachingProgress, ceilingMoveCount);
	return { repertoire, ...view };
```

with:

```ts
	const view = buildPracticeView(variations, activeVariationKey, solvedKeys, teachingProgress, ceilingMoveCount);
	return { repertoire, currentLevel, ...view };
```

- [ ] **Step 2: Verify it compiles**

Run: `cd mychess && npx svelte-check --output human 2>&1 | grep -A3 "learn/\[repertoire_id\]/+page.server"`
Expected: No output.

- [ ] **Step 3: Commit**

```bash
git add mychess/src/routes/\(player\)/learn/\[repertoire_id\]/+page.server.ts
git commit -m "feat(learn): compute currentLevel progress on the Learn page load (GitHub issue #181)"
```

---

### Task 7: Learn page UI — the new "current level" progress bar

**Files:**
- Modify: `mychess/src/routes/(player)/learn/[repertoire_id]/+page.svelte`
- Modify: `mychess/messages/en.json`
- Modify: `mychess/messages/lt.json`

- [ ] **Step 1: Add the new message key**

In `mychess/messages/en.json`, add directly after `"learn_progress_heading": "Progress",`:

```json
	"learn_level_progress": "{tier}: {ready} / {total} ready to level up",
```

In `mychess/messages/lt.json`, find the corresponding `"learn_progress_heading"` line and add directly after it:

```json
	"learn_level_progress": "{tier}: {ready} / {total} pasiruošę kilti į kitą lygį",
```

- [ ] **Step 2: Add the tier-label lookup to the script section**

In `mychess/src/routes/(player)/learn/[repertoire_id]/+page.svelte`, find the line `let { data } = $props<{ data: any }>();` near the top of the `<script>` block and add directly after it:

```ts
	type Tier = 'bronze' | 'silver' | 'gold' | 'platinum';
	const LEVEL_LABEL: Record<Tier, () => string> = {
		bronze: m.level_bronze,
		silver: m.level_silver,
		gold: m.level_gold,
		platinum: m.level_platinum
	};
```

- [ ] **Step 3: Add the progress bar markup**

Find this block (the existing overall-progress bar, directly above the session-count bar):

```svelte
					<span class="text-(--color-muted) text-sm">{m.learn_progress_count({ solved: data.solved, total: data.total })}</span>
					<div class="h-1.5 rounded-full bg-(--color-border) overflow-hidden mt-2">
						<div
							class="h-full bg-(--color-accent) rounded-full"
							style={`width: ${data.total ? (data.solved / data.total) * 100 : 0}%`}
						></div>
					</div>
					<span class="text-(--color-muted) text-sm mt-3 block">{m.learn_session_count({ count: learnedThisSession })}</span>
```

Replace it with (inserting the new bar between the two existing ones):

```svelte
					<span class="text-(--color-muted) text-sm">{m.learn_progress_count({ solved: data.solved, total: data.total })}</span>
					<div class="h-1.5 rounded-full bg-(--color-border) overflow-hidden mt-2">
						<div
							class="h-full bg-(--color-accent) rounded-full"
							style={`width: ${data.total ? (data.solved / data.total) * 100 : 0}%`}
						></div>
					</div>
					<span class="text-(--color-muted) text-sm mt-3 block">
						{m.learn_level_progress({
							tier: LEVEL_LABEL[data.currentLevel.tier as Tier](),
							ready: data.currentLevel.ready,
							total: data.currentLevel.total
						})}
					</span>
					<div class="h-1.5 rounded-full bg-(--color-border) overflow-hidden mt-2">
						<div
							class="h-full bg-purple-500 dark:bg-purple-400 rounded-full"
							style={`width: ${data.currentLevel.total ? (data.currentLevel.ready / data.currentLevel.total) * 100 : 0}%`}
						></div>
					</div>
					<span class="text-(--color-muted) text-sm mt-3 block">{m.learn_session_count({ count: learnedThisSession })}</span>
```

- [ ] **Step 4: Verify it compiles**

Run: `cd mychess && npx svelte-check --output human 2>&1 | grep -A3 "learn/\[repertoire_id\]/+page.svelte"`
Expected: No output.

- [ ] **Step 5: Manually verify in the browser**

Run: `cd mychess && npm run dev` (leave running), then open a repertoire's `/learn/<id>` page as a signed-in test account and confirm:
- A third progress line/bar reading e.g. "Bronze: 3 / 40 ready to level up" appears directly below the existing "X / Y variations learned" bar and above "N learned this session".
- Completing a variation that pauses at the ceiling (a long line, on a fresh repertoire) visibly moves this new bar even when the "X / Y learned" count does not move.

Stop the dev server (Ctrl+C) once confirmed.

- [ ] **Step 6: Commit**

```bash
git add "mychess/src/routes/(player)/learn/[repertoire_id]/+page.svelte" mychess/messages/en.json mychess/messages/lt.json
git commit -m "feat(learn): show a current-level progress bar alongside overall progress (GitHub issue #181)"
```

---

### Task 8: `/api/practice/attempt` — pre- and post-attempt ceiling checks

**Files:**
- Modify: `mychess/src/routes/api/practice/attempt/+server.ts`

- [ ] **Step 1: Update the import**

Replace:

```ts
import { buildPracticeView, wasResumedAfterBreak } from '$lib/mastery/practice';
import { teachingCeilingMoveCount } from '$lib/mastery/chapterLevels';
```

with:

```ts
import { buildPracticeView, wasResumedAfterBreak } from '$lib/mastery/practice';
import { teachingCeilingMoveCount } from '$lib/mastery/chapterLevels';
import { computeMasteredPliesMap } from '$lib/mastery/teaching';
```

- [ ] **Step 2: Load `teachingProgress` before the pre-attempt ceiling check**

Replace:

```ts
	const [{ variations: allVariations, excludedVariationKeys }, updatedAtBeforeThisAttempt, solvedKeysBeforeThisAttempt] =
		await Promise.all([
			loadRepertoireVariations(supabase, user.id, repertoireId),
			loadVariationUpdatedAt(supabase, user.id, repertoireId, variationKey),
			loadSolvedKeys(supabase, user.id, repertoireId)
		]);
	const variations = filterVariations(allVariations, excludedVariationKeys);
	const today = new Date().toISOString().slice(0, 10);
	const resumedAfterBreak = wasResumedAfterBreak(updatedAtBeforeThisAttempt, new Date());
	const ceilingMoveCount = teachingCeilingMoveCount(allVariations, solvedKeysBeforeThisAttempt);
```

with:

```ts
	// teachingProgressBeforeThisAttempt joins the same Promise.all for the
	// same reason solvedKeysBeforeThisAttempt does (see the comment above):
	// teachingCeilingMoveCount now needs a masteredPlies map (GitHub issue
	// #181), computed from state as it stood BEFORE this attempt's own
	// outcome is applied below.
	const [{ variations: allVariations, excludedVariationKeys }, updatedAtBeforeThisAttempt, solvedKeysBeforeThisAttempt, teachingProgressBeforeThisAttempt] =
		await Promise.all([
			loadRepertoireVariations(supabase, user.id, repertoireId),
			loadVariationUpdatedAt(supabase, user.id, repertoireId, variationKey),
			loadSolvedKeys(supabase, user.id, repertoireId),
			loadTeachingProgress(supabase, user.id, repertoireId)
		]);
	const variations = filterVariations(allVariations, excludedVariationKeys);
	const today = new Date().toISOString().slice(0, 10);
	const resumedAfterBreak = wasResumedAfterBreak(updatedAtBeforeThisAttempt, new Date());
	const masteredPliesBeforeThisAttempt = computeMasteredPliesMap(allVariations, teachingProgressBeforeThisAttempt, solvedKeysBeforeThisAttempt);
	const ceilingMoveCount = teachingCeilingMoveCount(allVariations, masteredPliesBeforeThisAttempt);
```

- [ ] **Step 3: Fix the post-attempt ceiling check**

Replace:

```ts
	const ceilingMoveCountAfterAttempt = teachingCeilingMoveCount(allVariations, solvedKeys);
	return json(buildPracticeView(variations, activeVariationKey, solvedKeys, teachingProgress, ceilingMoveCountAfterAttempt));
```

with:

```ts
	const masteredPliesAfterAttempt = computeMasteredPliesMap(allVariations, teachingProgress, solvedKeys);
	const ceilingMoveCountAfterAttempt = teachingCeilingMoveCount(allVariations, masteredPliesAfterAttempt);
	return json(buildPracticeView(variations, activeVariationKey, solvedKeys, teachingProgress, ceilingMoveCountAfterAttempt));
```

- [ ] **Step 4: Verify it compiles**

Run: `cd mychess && npx svelte-check --output human 2>&1 | grep -A3 "practice/attempt"`
Expected: No output.

- [ ] **Step 5: Commit**

```bash
git add mychess/src/routes/api/practice/attempt/+server.ts
git commit -m "fix(learn): load teaching progress before the pre-attempt ceiling check (GitHub issue #181)

Both the pre- and post-attempt teachingCeilingMoveCount calls on the
hottest path in the app now use the new masteredPlies contract, each
from its own correctly-timed snapshot."
```

---

### Task 9: `practice-progress.ts` — thread `masteredPlies` through `applyAttemptResult`

**Files:**
- Modify: `mychess/src/lib/server/practice-progress.ts`
- Test: `mychess/src/lib/server/practice-progress.test.ts`

This file already has thorough coverage of `applyAttemptResult` via a hand-rolled `fakeSupabase` mock (25 existing tests) — tracing through them by hand against the rewrite below confirms none regress (the existing "caches a chapter as completed once it reaches its own ceiling" test in particular already proves the local-patch behavior works, since it depends on THIS attempt's own just-written `masteredPlies:25` to complete the chapter — a stale pre-write `masteredPlies:20` would fail it). This task adds one new test making that same property explicit for the OTHER branch the design doc calls out — a re-drill of an *already-solved* variation, where `saveTeachingProgress` never runs at all, so `cacheCompletedChaptersReached` must still see an accurate, freshly-loaded `masteredPlies` for a SIBLING variation's own independent progress.

- [ ] **Step 1: Write the new failing test**

Add this test to `mychess/src/lib/server/practice-progress.test.ts`, inside the existing `describe('applyAttemptResult', ...)` block, directly after the `'caches a chapter as completed once it reaches its own ceiling, without needing literal platinum'` test:

```ts
	it('evaluates chapter completion on a re-drill of an already-solved variation too, not just a fresh solve (GitHub issue #181)', async () => {
		// a is already solved. b, a sibling sharing a's first 5 player moves,
		// has independently reached the rest of its own tail via teaching
		// progress already on file — NOT through this attempt. Re-drilling a
		// (already solved, so no teaching progress advances for it at all)
		// must still correctly see b's own progress when deciding whether
		// their shared chapter is now complete — this is only possible if
		// progressMap is loaded unconditionally, not just on the
		// not-yet-solved branch this call never even enters.
		const { a, b } = makeSharedPrefixVariations();
		const { client, upsertCalls } = fakeSupabase({
			solvedKeys: ['a'],
			teachingRows: [{ variation_key: 'b', taught_plies: 12, mastered_plies: 12 }] // b fully taught/mastered already, never solved
		});
		await applyAttemptResult(client as any, 'player-1', 'rep-1', 'a', false, [a, b]);

		// a re-drilled (bypasses teaching progress entirely) — no
		// variation_teaching_progress write for it.
		expect(upsertCalls.some((c) => c.table === 'variation_teaching_progress')).toBe(false);
		// Both a (solved) and b (already fully mastered per its own stored
		// progress, even though never itself marked variation_solved) have
		// reached this chapter's own ceiling (bronze) -> now complete. Under
		// the OLD, solved-only algorithm this would NOT have completed, since
		// b was never in variation_solved.
		const cacheWrite = upsertCalls.find((c) => c.table === 'chapter_completed');
		expect(cacheWrite?.rows).toEqual([{ player_id: 'player-1', repertoire_id: 'rep-1', chapter_name: UNTAGGED_CHAPTER }]);
	});
```

- [ ] **Step 2: Run the tests to verify the new one fails**

Run: `cd mychess && npx vitest run src/lib/server/practice-progress.test.ts`
Expected: FAIL on the new test only (`cacheCompletedChaptersReached` still takes `solvedKeys`, which does not contain `'b'`, so no `chapter_completed` write happens yet). Every other existing test in the file still passes at this point — the current `applyAttemptResult` implementation hasn't changed yet.

- [ ] **Step 3: Update the import**

Replace:

```ts
import { advanceTeachingProgress, knownProgressFor, ceilingPlyFor, computeBlockedKeys } from '$lib/mastery/teaching';
```

with:

```ts
import { advanceTeachingProgress, knownProgressFor, ceilingPlyFor, computeBlockedKeys, computeMasteredPliesMap } from '$lib/mastery/teaching';
```

- [ ] **Step 4: Update `cacheCompletedChaptersReached`'s signature and doc comment**

Replace:

```ts
/**
 * Writes a `chapter_completed` cache row for every chapter `variation` belongs
 * to that has just newly reached its own ceiling (see `isChapterComplete`),
 * given the up-to-date `solvedKeys` (read AFTER this attempt's
 * `variation_solved` write).
 *
 * `allVariations` MUST be the UNFILTERED variation set (excluded variations
 * included) — `isChapterComplete` only blocks correctly on an excluded,
 * never-solved variation if it's still present in the array (see that
 * function's doc comment). Passing the filtered set here would silently
 * un-cap a chapter an excluded line should still be blocking.
 *
 * Idempotent (safe to call even when the chapter was already complete) and
 * best-effort: this cache only backs the repertoire list's decorative
 * "Mastered" badge, never the authoritative Levels page or badge counts (both
 * derive fresh from `variation_solved` directly, with no cache) — so a failed
 * write here must not fail the attempt it's piggybacking on.
 */
async function cacheCompletedChaptersReached(
	supabase: SupabaseClient,
	playerId: string,
	repertoireId: string,
	variation: Variation,
	allVariations: Variation[],
	solvedKeys: ReadonlySet<string>
): Promise<void> {
	const chapters = masterableChapters(allVariations).filter((chapter) => isInChapterTier(variation, chapter));
	const completedChapters = chapters.filter((chapter) =>
		isChapterComplete(rowsInChapterTier(allVariations, chapter), solvedKeys)
	);
	if (completedChapters.length === 0) return;
```

with:

```ts
/**
 * Writes a `chapter_completed` cache row for every chapter `variation` belongs
 * to that has just newly reached its own ceiling (see `isChapterComplete`),
 * given the up-to-date `masteredPlies` (reflecting this attempt's just-
 * written `variation_teaching_progress` row, read/patched BEFORE this call —
 * see `applyAttemptResult`).
 *
 * `allVariations` MUST be the UNFILTERED variation set (excluded variations
 * included) — `isChapterComplete` only blocks correctly on an excluded,
 * never-solved variation if it's still present in the array (see that
 * function's doc comment). Passing the filtered set here would silently
 * un-cap a chapter an excluded line should still be blocking.
 *
 * Idempotent (safe to call even when the chapter was already complete) and
 * best-effort: this cache only backs the repertoire list's decorative
 * "Mastered" badge, never the authoritative Levels page or badge counts (both
 * derive fresh from teaching progress directly, with no cache) — so a failed
 * write here must not fail the attempt it's piggybacking on.
 */
async function cacheCompletedChaptersReached(
	supabase: SupabaseClient,
	playerId: string,
	repertoireId: string,
	variation: Variation,
	allVariations: Variation[],
	masteredPlies: ReadonlyMap<string, number>
): Promise<void> {
	const chapters = masterableChapters(allVariations).filter((chapter) => isInChapterTier(variation, chapter));
	const completedChapters = chapters.filter((chapter) =>
		isChapterComplete(rowsInChapterTier(allVariations, chapter), masteredPlies)
	);
	if (completedChapters.length === 0) return;
```

- [ ] **Step 5: Rewrite `applyAttemptResult`**

Replace the entire function body (from `export async function applyAttemptResult(` through its closing `}`) with:

```ts
export async function applyAttemptResult(
	supabase: SupabaseClient,
	playerId: string,
	repertoireId: string,
	variationKey: string,
	hadMistake: boolean,
	variations: Variation[],
	resumedAfterBreak: boolean = false,
	allVariations: Variation[] = variations,
	ceilingMoveCount: number = Infinity
): Promise<void> {
	if (hadMistake) return;

	const variation = variations.find((v) => v.variationKey === variationKey);
	// Hoisted out of the `!solvedKeys.has` branch below (GitHub issue #181):
	// `cacheCompletedChaptersReached`'s masteredPlies-based `isChapterComplete`
	// check now needs a progress snapshot for EVERY branch that reaches it,
	// including a re-drill of an already-solved variation, not just a fresh
	// solve — so it's loaded unconditionally here rather than only when
	// there's teaching progress left to advance.
	let progressMap: Map<string, { taughtPlies: number; masteredPlies: number; updatedAt: string | null }> | undefined;
	if (variation) {
		const solvedKeys = await loadSolvedKeys(supabase, playerId, repertoireId);
		progressMap = await loadTeachingProgress(supabase, playerId, repertoireId);
		if (!solvedKeys.has(variationKey)) {
			const { taughtPlies: effectiveTaughtPlies, masteredPlies: effectiveMasteredPlies } = knownProgressFor({
				variation,
				variations,
				teachingProgress: progressMap,
				solvedKeys,
				resumedAfterBreak
			});
			// Mirrors buildPracticeView's own fallback-safety clamp exactly
			// (GitHub issue #172, mastery/practice.ts): `variationKey` may have
			// been served only because pickActiveVariation's last-resort
			// fallback ignored blocked status (paused OR deferred) — in that
			// case it must be RECORDED the same restricted way it was SERVED,
			// or this and the serve step disagree on what happened, which
			// knownProgressFor's own doc comment calls out as "a real bug that
			// has happened." Without this, a deferred sibling reached only via
			// that fallback would get credited for a genuinely fresh batch it
			// was never actually supposed to be taught.
			const blockedKeys = computeBlockedKeys(variations, solvedKeys, progressMap, ceilingMoveCount);
			const ceilingPly = blockedKeys.has(variationKey) ? effectiveMasteredPlies : ceilingPlyFor(variation.path, ceilingMoveCount);
			const next = advanceTeachingProgress(variation.path, effectiveTaughtPlies, effectiveMasteredPlies, false, ceilingPly);
			await saveTeachingProgress(supabase, playerId, repertoireId, variationKey, next.taughtPlies, next.masteredPlies);

			// Patch this variation's just-written counters locally — progressMap
			// still reflects PRE-write state, and re-fetching would be a
			// redundant round trip for the one row we already know the new
			// value of. Every use of progressMap below (including the eventual
			// cacheCompletedChaptersReached call) sees this patched value.
			progressMap.set(variationKey, {
				...(progressMap.get(variationKey) ?? { taughtPlies: 0, masteredPlies: 0, updatedAt: null }),
				taughtPlies: next.taughtPlies,
				masteredPlies: next.masteredPlies
			});

			if (next.pausedAtCeiling) {
				// Paused, not solved: must NOT markVariationSolved or touch the
				// completed-chapters cache — but MUST still advance past this
				// variation, or the active pointer re-serves the same frozen,
				// paused board forever (GitHub issue #163's central risk — see
				// the design doc).
				const blockedKeysAfter = computeBlockedKeys(variations, solvedKeys, progressMap, ceilingMoveCount);
				const nextKey = advanceIfSolved(variationKey, variations, solvedKeys, blockedKeysAfter);
				await setActiveVariationKey(supabase, playerId, repertoireId, nextKey);
				return;
			}
			if (!next.solved) return;
		}
	}

	await markVariationSolved(supabase, playerId, repertoireId, variationKey);
	const solvedKeys = await loadSolvedKeys(supabase, playerId, repertoireId);
	const next = advanceIfSolved(variationKey, variations, solvedKeys);
	await setActiveVariationKey(supabase, playerId, repertoireId, next);
	if (variation && progressMap) {
		// GitHub issue #181: isChapterComplete now needs a masteredPlies map,
		// not solvedKeys directly — computed fresh from the (possibly patched)
		// progressMap and the just-refreshed post-write solvedKeys, matching
		// cacheCompletedChaptersReached's own existing "up-to-date" contract.
		const masteredPlies = computeMasteredPliesMap(allVariations, progressMap, solvedKeys);
		await cacheCompletedChaptersReached(supabase, playerId, repertoireId, variation, allVariations, masteredPlies);
	}
}
```

- [ ] **Step 6: Verify it compiles**

Run: `cd mychess && npx svelte-check --output human 2>&1 | grep -A3 "practice-progress"`
Expected: No output.

- [ ] **Step 7: Run the tests to verify they all pass, including the new one**

Run: `cd mychess && npx vitest run src/lib/server/practice-progress.test.ts`
Expected: PASS (all 26 tests — the 25 existing ones plus the new one from Step 1).

Then run the full suite as a broader regression check: `cd mychess && npx vitest run`
Expected: All currently-passing test files still pass. (Files not yet fixed by later tasks — Levels page, coach-progress, repertoire-status-counts — have no `.test.ts` of their own exercising the changed signature directly, so this run should be clean; if it isn't, investigate before proceeding rather than assuming it's expected.)

- [ ] **Step 8: Commit**

```bash
git add mychess/src/lib/server/practice-progress.ts mychess/src/lib/server/practice-progress.test.ts
git commit -m "fix(learn): thread masteredPlies through applyAttemptResult's chapter-completion check (GitHub issue #181)

loadTeachingProgress is now unconditional (was only loaded on the
not-yet-solved branch), so cacheCompletedChaptersReached always has
an up-to-date masteredPlies snapshot, including on an already-solved
re-drill."
```

---

### Task 10: Levels page — `deriveChapterLevel` masteredPlies wiring

**Files:**
- Modify: `mychess/src/routes/(player)/practice/[repertoire_id]/mastery/+page.server.ts`

- [ ] **Step 1: Update imports and computation**

Replace:

```ts
import { loadSolvedKeys } from '$lib/server/practice-progress';
import { masterableChapters } from '$lib/mastery/repertoireStatus';
import { rowsInChapterTier } from '$lib/mastery/variations';
import { deriveChapterLevel, deriveRepertoireLevel } from '$lib/mastery/chapterLevels';
```

with:

```ts
import { loadSolvedKeys, loadTeachingProgress } from '$lib/server/practice-progress';
import { masterableChapters } from '$lib/mastery/repertoireStatus';
import { rowsInChapterTier } from '$lib/mastery/variations';
import { deriveChapterLevel, deriveRepertoireLevel } from '$lib/mastery/chapterLevels';
import { computeMasteredPliesMap } from '$lib/mastery/teaching';
```

Replace:

```ts
	const [{ repertoire, variations }, learnedKeys] = await Promise.all([
		loadRepertoireVariations(supabase, user!.id, repertoireId),
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
```

with:

```ts
	const [{ repertoire, variations }, learnedKeys, teachingProgress] = await Promise.all([
		loadRepertoireVariations(supabase, user!.id, repertoireId),
		loadSolvedKeys(supabase, user!.id, repertoireId),
		loadTeachingProgress(supabase, user!.id, repertoireId)
	]);
	// Computed once, reused by every chapter's deriveChapterLevel call below
	// (GitHub issue #181) — the map only needs variationKey lookups, so this
	// avoids recomputing computeMasteredMoveIds (an O(repertoire) scan) once
	// per chapter.
	const masteredPlies = computeMasteredPliesMap(variations, teachingProgress, learnedKeys);

	const chapters = masterableChapters(variations).map((chapter) => {
		const rows = rowsInChapterTier(variations, chapter);
		return {
			chapter,
			total: rows.length,
			learned: rows.filter((v) => learnedKeys.has(v.variationKey)).length,
			level: deriveChapterLevel(rows, masteredPlies)
		};
	});
```

- [ ] **Step 2: Verify it compiles**

Run: `cd mychess && npx svelte-check --output human 2>&1 | grep -A3 "practice/\[repertoire_id\]/mastery"`
Expected: No output.

- [ ] **Step 3: Manually verify in the browser**

Run: `cd mychess && npm run dev` (leave running), open a repertoire's `/practice/<id>/mastery` (Levels) page, and confirm chapter medals still render sensibly (a chapter with everything solved should still show its own ceiling tier, not regress to "no medal").

Stop the dev server (Ctrl+C) once confirmed.

- [ ] **Step 4: Commit**

```bash
git add "mychess/src/routes/(player)/practice/[repertoire_id]/mastery/+page.server.ts"
git commit -m "fix(learn): wire the Levels page to the new ceiling-reached deriveChapterLevel contract (GitHub issue #181)"
```

---

### Task 11: `coach-progress.ts` — masteredPlies wiring

**Files:**
- Modify: `mychess/src/lib/server/coach-progress.ts`

- [ ] **Step 1: Update imports and the per-repertoire computation**

Replace:

```ts
import { loadRepertoireVariations } from './practice-repertoire';
import { loadSolvedKeys } from './practice-progress';
import { masterableChapters } from '$lib/mastery/repertoireStatus';
import { rowsInChapterTier } from '$lib/mastery/variations';
import { deriveChapterLevel, deriveRepertoireLevel, type Tier } from '$lib/mastery/chapterLevels';
```

with:

```ts
import { loadRepertoireVariations } from './practice-repertoire';
import { loadSolvedKeys, loadTeachingProgress } from './practice-progress';
import { masterableChapters } from '$lib/mastery/repertoireStatus';
import { rowsInChapterTier } from '$lib/mastery/variations';
import { deriveChapterLevel, deriveRepertoireLevel, type Tier } from '$lib/mastery/chapterLevels';
import { computeMasteredPliesMap } from '$lib/mastery/teaching';
```

Replace:

```ts
				const [{ variations: allVariations }, learnedKeys] = await Promise.all([
					loadRepertoireVariations(supabase, playerId, repertoireId),
					loadSolvedKeys(supabase, playerId, repertoireId)
				]);
				const chapterLevels = masterableChapters(allVariations).map((chapter) =>
					deriveChapterLevel(rowsInChapterTier(allVariations, chapter), learnedKeys)
				);
```

with:

```ts
				const [{ variations: allVariations }, learnedKeys, teachingProgress] = await Promise.all([
					loadRepertoireVariations(supabase, playerId, repertoireId),
					loadSolvedKeys(supabase, playerId, repertoireId),
					loadTeachingProgress(supabase, playerId, repertoireId)
				]);
				const masteredPlies = computeMasteredPliesMap(allVariations, teachingProgress, learnedKeys);
				const chapterLevels = masterableChapters(allVariations).map((chapter) =>
					deriveChapterLevel(rowsInChapterTier(allVariations, chapter), masteredPlies)
				);
```

- [ ] **Step 2: Verify it compiles**

Run: `cd mychess && npx svelte-check --output human 2>&1 | grep -A3 "coach-progress"`
Expected: No output.

- [ ] **Step 3: Commit**

```bash
git add mychess/src/lib/server/coach-progress.ts
git commit -m "fix(coach): wire student repertoire level lookup to the new ceiling-reached contract (GitHub issue #181)"
```

---

### Task 12: `repertoire-status-counts.ts` — masteredPlies wiring

**Files:**
- Modify: `mychess/src/lib/server/repertoire-status-counts.ts`

- [ ] **Step 1: Update imports and the per-repertoire computation**

Replace:

```ts
import { loadRepertoireProgressSummaries, type RepertoireProgressSummary } from './repertoire-progress';
import { loadRepertoireVariations } from './practice-repertoire';
import { loadSolvedKeys } from './practice-progress';
import { deriveRepertoireStatus, masterableChapters } from '$lib/mastery/repertoireStatus';
import { filterVariations, rowsInChapterTier } from '$lib/mastery/variations';
import { isChapterComplete } from '$lib/mastery/chapterLevels';
```

with:

```ts
import { loadRepertoireProgressSummaries, type RepertoireProgressSummary } from './repertoire-progress';
import { loadRepertoireVariations } from './practice-repertoire';
import { loadSolvedKeys, loadTeachingProgress } from './practice-progress';
import { deriveRepertoireStatus, masterableChapters } from '$lib/mastery/repertoireStatus';
import { filterVariations, rowsInChapterTier } from '$lib/mastery/variations';
import { isChapterComplete } from '$lib/mastery/chapterLevels';
import { computeMasteredPliesMap } from '$lib/mastery/teaching';
```

Replace:

```ts
				const [{ variations: allVariations, excludedVariationKeys }, learnedKeys] = await Promise.all([
					loadRepertoireVariations(supabase, playerId, summary.id),
					loadSolvedKeys(supabase, playerId, summary.id)
				]);
				// `deriveRepertoireStatus`'s own "learned" check wants the FILTERED
				// set (an excluded line is not owed to it, exactly like today) —
				// but chapter completeness needs the UNFILTERED set, so an excluded,
				// never-solved variation still caps its chapter below its own
				// ceiling instead of vanishing from the bracket entirely (see
				// `isChapterComplete`'s doc comment).
				const variations = filterVariations(allVariations, excludedVariationKeys);
				const completedChapters = new Set(
					masterableChapters(allVariations).filter((chapter) =>
						isChapterComplete(rowsInChapterTier(allVariations, chapter), learnedKeys)
					)
				);
				return deriveRepertoireStatus({ variations, learnedKeys, completedChapters });
```

with:

```ts
				const [{ variations: allVariations, excludedVariationKeys }, learnedKeys, teachingProgress] = await Promise.all([
					loadRepertoireVariations(supabase, playerId, summary.id),
					loadSolvedKeys(supabase, playerId, summary.id),
					loadTeachingProgress(supabase, playerId, summary.id)
				]);
				// `deriveRepertoireStatus`'s own "learned" check wants the FILTERED
				// set (an excluded line is not owed to it, exactly like today) —
				// but chapter completeness needs the UNFILTERED set, so an excluded,
				// never-solved variation still caps its chapter below its own
				// ceiling instead of vanishing from the bracket entirely (see
				// `isChapterComplete`'s doc comment).
				const variations = filterVariations(allVariations, excludedVariationKeys);
				const masteredPlies = computeMasteredPliesMap(allVariations, teachingProgress, learnedKeys);
				const completedChapters = new Set(
					masterableChapters(allVariations).filter((chapter) =>
						isChapterComplete(rowsInChapterTier(allVariations, chapter), masteredPlies)
					)
				);
				return deriveRepertoireStatus({ variations, learnedKeys, completedChapters });
```

- [ ] **Step 2: Verify it compiles**

Run: `cd mychess && npx svelte-check --output human 2>&1 | grep -A3 "repertoire-status-counts"`
Expected: No output.

- [ ] **Step 3: Commit**

```bash
git add mychess/src/lib/server/repertoire-status-counts.ts
git commit -m "fix(badges): wire Mastered-repertoire counting to the new ceiling-reached contract (GitHub issue #181)"
```

---

### Task 13: `debug-lock-state.ts` — diagnostic parity

**Files:**
- Modify: `mychess/scripts/debug-lock-state.ts`

- [ ] **Step 1: Update imports and the ceiling computation**

Replace:

```ts
import { enumerateVariations, type RawMoveRow, type Variation } from '../src/lib/mastery/variations';
import { teachingCeilingMoveCount } from '../src/lib/mastery/chapterLevels';
import { computeMasteredMoveIds, isCeilingReachedAnywhere, isLockedForTier, isPausedAtCeiling, knownProgressFor, ceilingPlyFor } from '../src/lib/mastery/teaching';
```

with:

```ts
import { enumerateVariations, type RawMoveRow, type Variation } from '../src/lib/mastery/variations';
import { teachingCeilingMoveCount, currentLevelProgress } from '../src/lib/mastery/chapterLevels';
import {
	computeMasteredMoveIds,
	computeMasteredPliesMap,
	isCeilingReachedAnywhere,
	isLockedForTier,
	isPausedAtCeiling,
	knownProgressFor,
	ceilingPlyFor
} from '../src/lib/mastery/teaching';
```

Replace:

```ts
	const ceilingMoveCount = teachingCeilingMoveCount(variations, solvedKeys);
	const masteredMoveIds = computeMasteredMoveIds(variations, teachingProgress, solvedKeys);
	const ceilingReached = isCeilingReachedAnywhere(variations, solvedKeys, teachingProgress, ceilingMoveCount, masteredMoveIds);
	console.log(`ceilingMoveCount=${ceilingMoveCount}  ceilingReached=${ceilingReached}  masteredMoveIds.size=${masteredMoveIds.size}`);
```

with:

```ts
	const masteredMoveIds = computeMasteredMoveIds(variations, teachingProgress, solvedKeys);
	const masteredPliesMap = computeMasteredPliesMap(variations, teachingProgress, solvedKeys, masteredMoveIds);
	const ceilingMoveCount = teachingCeilingMoveCount(variations, masteredPliesMap);
	const ceilingReached = isCeilingReachedAnywhere(variations, solvedKeys, teachingProgress, ceilingMoveCount, masteredMoveIds);
	const level = currentLevelProgress(variations, masteredPliesMap);
	console.log(
		`ceilingMoveCount=${ceilingMoveCount}  ceilingReached=${ceilingReached}  masteredMoveIds.size=${masteredMoveIds.size}  currentLevel=${level.tier} ${level.ready}/${level.total}`
	);
```

- [ ] **Step 2: Verify it compiles**

Run: `cd mychess && npx tsc --noEmit -p . 2>&1 | grep "scripts/debug-lock-state"`
Expected: No output. (This script sits outside SvelteKit's own `$lib` alias resolution — `npx svelte-check` does not type-check it; a plain `tsc --noEmit` pass is the right check here, matching the file's own header comment about why it uses relative imports.)

- [ ] **Step 3: Commit**

```bash
git add mychess/scripts/debug-lock-state.ts
git commit -m "fix(learn): wire debug-lock-state to the new ceiling-reached contract, print currentLevelProgress too (GitHub issue #181)"
```

---

### Task 14: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Type-check the whole app**

Run: `cd mychess && npm run check`
Expected: Zero errors. If any remain, they indicate a caller missed in Tasks 3–13 — find it via the error's file path and apply the same `solvedKeys` → `masteredPlies` (via `computeMasteredPliesMap`) transformation used in the matching task above, then re-run.

- [ ] **Step 2: Lint the whole app**

Run: `cd mychess && npm run lint`
Expected: Zero errors (warnings, e.g. pre-existing `@typescript-eslint/no-explicit-any` at Supabase boundaries, are not gated — see `mychess/CLAUDE.md`).

- [ ] **Step 3: Run the full test suite**

Run: `cd mychess && npx vitest run`
Expected: All tests pass.

- [ ] **Step 4: Run the e2e suite**

Run: `cd mychess && npx playwright test`
Expected: All tests pass (this builds and previews the app first).

- [ ] **Step 5: End-to-end manual verification against real data**

Run: `cd mychess && npm run debug:lock-state -- <repertoireId> <playerId>` against a real repertoire/player pair with a mix of short and long variations (your own account — see `mychess/CLAUDE.md`'s note on this script). Confirm the printed `currentLevel=<tier> <ready>/<total>` line looks sane (e.g. `ready` increases as more variations show `pausedAtCeiling=true` or `SOLVED` in the per-variation listing below it).

Then run: `cd mychess && npm run qa:verify-learn -- "<path-to-a-test-pgn-with-long-lines>"` to drive a real browser through `/learn/<id>` and confirm the picker's new paused-icon rendering and the Learn page's new progress bar both appear as expected against a live build.

- [ ] **Step 6: Push**

```bash
git push origin main
```

(Per `mychess/CLAUDE.md`: production is the test environment for this project, and there are no other users yet — push directly once the above all pass.)

- [ ] **Step 7: Close out the GitHub issue**

```bash
gh issue close 181 --repo tomyka/mychess --comment "Shipped: deriveChapterLevel now derives every tier from reaching-the-ceiling (not solved-only), backing Learn's teaching ceiling, the Levels page's medals, and chapter-completion badges from one shared definition. The picker distinguishes a paused-at-ceiling row from a genuinely locked one with a new icon, and the Learn page shows a second, current-level progress bar alongside the existing overall count."
```
