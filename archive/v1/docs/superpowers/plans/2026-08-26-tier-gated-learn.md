# Tier-Gated Learn Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cap Learn's teaching depth at the repertoire's current knowledge-level ceiling (9/18/27 player moves), per GitHub issue #163 and `docs/superpowers/specs/2026-08-26-tier-gated-learn-design.md` — read that design doc first, especially its §3 "Why the ceiling is repertoire-wide and pooled, not per-chapter" and its `applyAttemptResult` paused-branch section, both of which this plan implements exactly as specified there without re-deriving the reasoning.

**Architecture:** No new tables, no new columns, no migration. Everything is derived live from `variation_solved`/`variation_teaching_progress`, exactly like `chapterLevels.ts`'s existing convention. One new pure function (`teachingCeilingMoveCount`) reuses the existing `deriveChapterLevel` over the whole repertoire pooled together. Two existing pure modules (`teaching.ts`, `variationSequence.ts`) each gain one new optional parameter with a default that preserves today's exact behavior for any caller that doesn't pass it — so each task is independently safe to land and verify before the next.

**Tech Stack:** SvelteKit 2 + Svelte 5, Supabase/Postgres, Vitest.

**Read the design doc's §3 before touching Task 5 or Task 6.** The single riskiest part of this whole plan is `applyAttemptResult`'s new "paused, not solved, but still advance" branch — getting it wrong reproduces exactly the "player stuck on a frozen board" failure mode this codebase has already retired three prior gating systems over.

---

### Task 1: `chapterLevels.ts` — `teachingCeilingMoveCount`

**Files:**
- Modify: `mychess/src/lib/mastery/chapterLevels.ts`
- Modify: `mychess/src/lib/mastery/chapterLevels.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `chapterLevels.test.ts` (reuse the file's existing `v(variationKey, chapterNames?, playerMoveCount?)`-style fixture helper if present — check the file's current top before adding a duplicate; if its existing `v()` helper doesn't take a `playerMoveCount` argument, add one, keeping every existing call site's positional args intact by appending it last with a default):

```ts
import { teachingCeilingMoveCount } from './chapterLevels';

describe('teachingCeilingMoveCount', () => {
	it('is 9 (bronze) when nothing has been solved yet', () => {
		const rows = [v('a', undefined, 5), v('b', undefined, 15)];
		expect(teachingCeilingMoveCount(rows, new Set())).toBe(9);
	});

	it('is 9 while any <=9-move variation anywhere is unsolved, even if a longer one is solved', () => {
		const rows = [v('short', undefined, 5), v('long', undefined, 15)];
		expect(teachingCeilingMoveCount(rows, new Set(['long']))).toBe(9);
	});

	it('rises to 18 once every <=9-move variation repertoire-wide is solved', () => {
		const rows = [v('short1', undefined, 5), v('short2', undefined, 9), v('long', undefined, 15)];
		expect(teachingCeilingMoveCount(rows, new Set(['short1', 'short2']))).toBe(18);
	});

	it('rises to 27 once every <=18-move variation is solved too', () => {
		const rows = [v('short', undefined, 5), v('mid', undefined, 15), v('gold', undefined, 22)];
		expect(teachingCeilingMoveCount(rows, new Set(['short', 'mid']))).toBe(27);
	});

	it('is Infinity once every <=27-move variation is solved', () => {
		const rows = [v('a', undefined, 5), v('b', undefined, 27)];
		expect(teachingCeilingMoveCount(rows, new Set(['a', 'b']))).toBe(Infinity);
	});

	// The deadlock case §3 of the design doc exists to rule out: a repertoire
	// (or, equivalently here, a pool) with NO bronze-length content at all must
	// not stay capped at 9 forever just because nothing can ever satisfy that
	// bracket.
	it('does not deadlock when nothing in the pool is bronze-length at all', () => {
		const rows = [v('a', undefined, 15), v('b', undefined, 15)];
		expect(teachingCeilingMoveCount(rows, new Set(['a', 'b']))).toBe(27);
	});

	it('is 9 for an empty pool', () => {
		expect(teachingCeilingMoveCount([], new Set())).toBe(9);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mychess && npx vitest run src/lib/mastery/chapterLevels.test.ts`
Expected: FAIL — `teachingCeilingMoveCount` doesn't exist yet (and/or the `v()` helper doesn't yet accept a `playerMoveCount`).

- [ ] **Step 3: Implement**

In `chapterLevels.ts`, add (after `deriveRepertoireLevel`, since it's conceptually a sibling — a different way of collapsing chapter/level data into one answer):

```ts
/**
 * The player-move-count Learn may currently teach up to, repertoire-wide: the
 * ceiling of the tier immediately above the pooled repertoire's own tier —
 * bronze's own ceiling (9) when nothing is solved yet, silver's (18) once
 * every <=9-move variation REPERTOIRE-WIDE is solved, and so on, unlimited
 * once every <=27-move variation is.
 *
 * Deliberately reuses `deriveChapterLevel` over `allVariations` pooled
 * together — the WHOLE repertoire treated as one chapter — rather than
 * per-chapter-then-`deriveRepertoireLevel`. See
 * docs/superpowers/specs/2026-08-26-tier-gated-learn-design.md §3 for why:
 * minning independently-computed per-chapter LEVELS reintroduces a deadlock
 * `deriveChapterLevel`'s own vacuous-tier handling already solves once, at
 * the chapter level — a chapter with nothing bronze-length at all would
 * otherwise permanently cap the whole repertoire at 9. Pooling first, then
 * deriving once, is not an optimisation of the per-chapter approach; it is a
 * different, correct answer to a subtly different question. This is a
 * SEPARATE call from `deriveRepertoireLevel` (which keeps its own, different,
 * unaffected meaning — the Levels page's "worst chapter's medal" display) —
 * the two can legitimately disagree and both be right.
 *
 * `allVariations` MUST be the repertoire's UNFILTERED variation set, for the
 * same exclusion-blocking reason `deriveChapterLevel` itself documents.
 */
export function teachingCeilingMoveCount(
	allVariations: readonly ScopedVariation[],
	solvedKeys: ReadonlySet<string>
): number {
	const repertoireWideLevel = deriveChapterLevel(allVariations, solvedKeys);
	if (repertoireWideLevel === null) return TIER_MAX_PLAYER_MOVES.bronze;
	const idx = TIER_ORDER.indexOf(repertoireWideLevel);
	const nextTier = TIER_ORDER[idx + 1];
	return nextTier ? TIER_MAX_PLAYER_MOVES[nextTier] : Infinity;
}
```

If `chapterLevels.test.ts`'s existing `v()` fixture helper doesn't already accept a `playerMoveCount`, extend it (append-only, so no existing call site breaks):

```ts
const v = (variationKey: string, chapterNames: string[] = [], playerMoveCount = 1) => ({ variationKey, chapterNames, playerMoveCount });
```

Check the file's actual current signature before editing — match it exactly rather than assuming this shape; the important constraint is that every existing call site keeps compiling unchanged.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mychess && npx vitest run src/lib/mastery/chapterLevels.test.ts`
Expected: PASS, including every pre-existing test in the file (unchanged).

- [ ] **Step 5: Commit**

```bash
git add mychess/src/lib/mastery/chapterLevels.ts mychess/src/lib/mastery/chapterLevels.test.ts
git commit -m "$(cat <<'EOF'
feat(mastery): derive Learn's repertoire-wide teaching ceiling

Refs #163
EOF
)"
```

---

### Task 2: `teaching.ts` — ceiling-aware `resolveTeachingStep`/`advanceTeachingProgress`, `isPausedAtCeiling`

**Files:**
- Modify: `mychess/src/lib/mastery/teaching.ts`
- Modify: `mychess/src/lib/mastery/teaching.test.ts`

This is the core, riskiest pure-logic change in the whole plan — read the design doc's `§3` code block first and match it exactly; the snippets below are that same code, given here for direct application.

- [ ] **Step 1: Write the failing tests**

Add to `teaching.test.ts` (match its existing fixture/path-building style — check the file's current top for a `path(...)`/`step(...)` helper before writing a new one):

```ts
import { resolveTeachingStep, advanceTeachingProgress, ceilingPlyFor, isPausedAtCeiling } from './teaching';

describe('ceilingPlyFor', () => {
	it('is the ply just past the Nth player move', () => {
		const p = path(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5']); // 3 player moves (e4, Nf3, Bb5)
		expect(ceilingPlyFor(p, 2)).toBe(3); // past e4, e5, Nf3 -> index 3
	});

	it('is the whole path when the ceiling exceeds the path length', () => {
		const p = path(['e4', 'e5']);
		expect(ceilingPlyFor(p, 99)).toBe(p.length);
	});
});

describe('resolveTeachingStep with a ceiling', () => {
	it('behaves identically to no ceiling when the variation is shorter than it', () => {
		const p = path(['e4', 'e5', 'Nf3']); // 2 player moves, well under a 9-move ceiling
		const withCeiling = resolveTeachingStep(p, 0, 0, ceilingPlyFor(p, 9));
		const withoutCeiling = resolveTeachingStep(p, 0, 0);
		expect(withCeiling).toEqual({ ...withoutCeiling, pausedAtCeiling: false });
	});

	it('pauses exactly at the ceiling for a variation longer than it, without reaching its own true end', () => {
		// 9 player moves' worth of plies, ceiling of 2 player moves (TEACHING_BATCH_MOVES-aligned).
		const p = path(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O']);
		const ceilingPly = ceilingPlyFor(p, 2);
		// masteredPlies already at the ceiling: nothing more to teach for now.
		const step = resolveTeachingStep(p, ceilingPly, ceilingPly, ceilingPly);
		expect(step.isFinalPass).toBe(true);
		expect(step.pausedAtCeiling).toBe(true);
		expect(step.path.length).toBe(ceilingPly);
	});

	it('is NOT paused when the ceiling ply exactly equals the variation\'s own true length', () => {
		const p = path(['e4', 'e5', 'Nf3', 'Nc6']); // 2 player moves
		const ceilingPly = ceilingPlyFor(p, 2); // equals p.length here
		const step = resolveTeachingStep(p, p.length, p.length, ceilingPly);
		expect(step.isFinalPass).toBe(true);
		expect(step.pausedAtCeiling).toBe(false);
	});

	it('a ceiling regression below already-mastered content does not crash, and clamps served content to the new ceiling', () => {
		const p = path(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O']); // 5 player moves
		const loweredCeilingPly = ceilingPlyFor(p, 2); // pretend a reconciliation regression just lowered the ceiling
		// masteredPlies (4 player moves in) is already PAST the new, lower ceiling.
		const alreadyPast = ceilingPlyFor(p, 4);
		const step = resolveTeachingStep(p, alreadyPast, alreadyPast, loweredCeilingPly);
		expect(step.path.length).toBe(loweredCeilingPly);
		expect(step.pausedAtCeiling).toBe(true);
	});
});

describe('advanceTeachingProgress with a ceiling', () => {
	it('reports solved (not paused) for a clean final pass within a variation shorter than the ceiling', () => {
		const p = path(['e4', 'e5']); // 1 player move
		const ceilingPly = ceilingPlyFor(p, 9);
		const next = advanceTeachingProgress(p, p.length, p.length, false, ceilingPly);
		expect(next.solved).toBe(true);
		expect(next.pausedAtCeiling).toBe(false);
	});

	it('reports pausedAtCeiling (never solved) for a clean pass that only reaches the ceiling', () => {
		const p = path(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O']); // 5 player moves
		const ceilingPly = ceilingPlyFor(p, 2);
		const next = advanceTeachingProgress(p, ceilingPly, ceilingPly, false, ceilingPly);
		expect(next.solved).toBe(false);
		expect(next.pausedAtCeiling).toBe(true);
	});

	it('a mistake is a no-op regardless of the ceiling, exactly as without one', () => {
		const p = path(['e4', 'e5', 'Nf3', 'Nc6']);
		const next = advanceTeachingProgress(p, 0, 0, true, ceilingPlyFor(p, 2));
		expect(next).toEqual({ taughtPlies: 0, masteredPlies: 0, solved: false, pausedAtCeiling: false });
	});
});

describe('isPausedAtCeiling', () => {
	it('is false for an untouched variation, however long, so it is still fully servable up to the ceiling', () => {
		const p = path(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O']); // 5 player moves
		expect(isPausedAtCeiling(p, 0, 2)).toBe(false);
	});

	it('is true once mastered progress reaches the ceiling on a variation longer than it', () => {
		const p = path(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O']);
		const ceilingPly = ceilingPlyFor(p, 2);
		expect(isPausedAtCeiling(p, ceilingPly, 2)).toBe(true);
	});

	it('is false once a variation is genuinely fully mastered, even at exactly the ceiling length', () => {
		const p = path(['e4', 'e5', 'Nf3', 'Nc6']); // 2 player moves, exactly the ceiling
		expect(isPausedAtCeiling(p, p.length, 2)).toBe(false);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mychess && npx vitest run src/lib/mastery/teaching.test.ts`
Expected: FAIL — `ceilingPlyFor`/`isPausedAtCeiling` don't exist, and `resolveTeachingStep`/`advanceTeachingProgress` don't yet accept a fourth/fifth argument or return `pausedAtCeiling`.

- [ ] **Step 3: Implement**

Replace `TeachingStep`, `resolveTeachingStep`, and `advanceTeachingProgress` in `teaching.ts`, and add `ceilingPlyFor`/`isPausedAtCeiling`, exactly as specified in the design doc's §3 code block:

```ts
export type TeachingStep = {
	path: VariationStep[];
	arrowPlies: { from: number; to: number } | null;
	isFinalPass: boolean;
	/** True only when THIS pass reached path's end because of `ceilingPly`,
	 * not because the variation's own true path ended there. The caller —
	 * never this module — decides what "paused" means downstream (no
	 * variation_solved write, still advance past it when picking what's next). */
	pausedAtCeiling: boolean;
};

/** Where `ceilingMoveCount` player moves lands within `path` — the same
 * "N player moves from a starting ply" question `plyAfterPlayerMoves` already
 * answers, from ply 0. A one-line wrapper, not new logic. */
export function ceilingPlyFor(path: readonly VariationStep[], ceilingMoveCount: number): number {
	return plyAfterPlayerMoves(path as VariationStep[], 0, ceilingMoveCount);
}

/**
 * Derives what the NEXT attempt of this variation should look like, purely
 * from its two persisted counters — never from a stored "phase" — so a
 * corrupted or stale counter can't disagree with what's actually served. See
 * docs/superpowers/specs/2026-08-14-variation-teaching-arrows-design.md for
 * the full state-machine rationale, and
 * docs/superpowers/specs/2026-08-26-tier-gated-learn-design.md §3 for
 * `ceilingPly`'s rationale (GitHub issue #163).
 *
 * `ceilingPly` defaults to `path.length` — i.e. no cap, today's exact
 * behavior — so every existing caller that doesn't pass one is unaffected.
 * `TEACHING_BATCH_MOVES` (3) divides evenly into every tier boundary this
 * repo's ceilings ever use (9/18/27), so a real ceiling always lands exactly
 * on a batch boundary in the ordinary path; the `Math.min` clamps below exist
 * for the one case that can still disagree — a ceiling that REGRESSED (a
 * coach reconciliation demoting solved content) below progress already made
 * under a higher one.
 */
export function resolveTeachingStep(
	path: VariationStep[],
	taughtPlies: number,
	masteredPlies: number,
	ceilingPly: number = path.length
): TeachingStep {
	const effectiveLength = Math.min(path.length, ceilingPly);
	if (masteredPlies >= effectiveLength) {
		return {
			path: path.slice(0, effectiveLength),
			arrowPlies: null,
			isFinalPass: true,
			pausedAtCeiling: effectiveLength < path.length
		};
	}
	if (taughtPlies === masteredPlies) {
		const target = Math.min(plyAfterPlayerMoves(path, masteredPlies, TEACHING_BATCH_MOVES), effectiveLength);
		// See resolveTeachingStep's own prior doc comment (issue #68) for why a
		// pass that draws arrows is never the final pass, unchanged by the ceiling.
		return {
			path: path.slice(0, target),
			arrowPlies: { from: masteredPlies, to: target },
			isFinalPass: false,
			pausedAtCeiling: false
		};
	}
	const target = Math.min(taughtPlies, effectiveLength);
	return {
		path: path.slice(0, target),
		arrowPlies: null,
		isFinalPass: target >= effectiveLength,
		pausedAtCeiling: target >= effectiveLength && effectiveLength < path.length
	};
}

/**
 * Applies a completed attempt's outcome to the two counters. Always
 * re-derives the step that was actually served (via `resolveTeachingStep`)
 * rather than trusting anything the client reports beyond `hadMistake`.
 *
 * `solved` now means genuinely, truly finished — never true for a pass that
 * only reached a ceiling short of the variation's own real end.
 * `pausedAtCeiling` is the caller's signal to do everything a genuine solve
 * does NOT do (no `variation_solved` write, no completed-chapters cache
 * update) while STILL doing the one thing a mid-batch pass does NOT do:
 * advance past this variation when deciding what to serve next (see
 * `variationSequence.ts`'s new `blockedKeys` parameter and
 * `server/practice-progress.ts`'s new branch in `applyAttemptResult`).
 */
export function advanceTeachingProgress(
	path: VariationStep[],
	taughtPlies: number,
	masteredPlies: number,
	hadMistake: boolean,
	ceilingPly: number = path.length
): { taughtPlies: number; masteredPlies: number; solved: boolean; pausedAtCeiling: boolean } {
	const step = resolveTeachingStep(path, taughtPlies, masteredPlies, ceilingPly);

	if (hadMistake) {
		return { taughtPlies, masteredPlies, solved: false, pausedAtCeiling: false };
	}
	if (step.arrowPlies) {
		return { taughtPlies: step.arrowPlies.to, masteredPlies, solved: false, pausedAtCeiling: false };
	}
	const masteredNow = step.path.length;
	return {
		taughtPlies: Math.max(taughtPlies, masteredNow),
		masteredPlies: masteredNow,
		solved: step.isFinalPass && !step.pausedAtCeiling,
		pausedAtCeiling: step.isFinalPass && step.pausedAtCeiling
	};
}

/**
 * Whether `path` currently has nothing more Learn can teach under
 * `ceilingMoveCount` — already taught as far as the ceiling allows, but not
 * this variation's own true end. Deliberately FALSE for an untouched
 * (`masteredPlies === 0`) long variation: that one is still fully servable,
 * up to the ceiling, on its very next pass — this predicate answers "is
 * there nothing left to do here RIGHT NOW", not "is this variation long".
 */
export function isPausedAtCeiling(path: readonly VariationStep[], masteredPlies: number, ceilingMoveCount: number): boolean {
	const ceilingPly = ceilingPlyFor(path, ceilingMoveCount);
	return masteredPlies >= ceilingPly && ceilingPly < path.length;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd mychess && npx vitest run src/lib/mastery/teaching.test.ts`
Expected: PASS, including every pre-existing test in the file — the default `ceilingPly = path.length` must make every old call site (which passes 3 args) behave byte-identically to before.

- [ ] **Step 5: Type-check**

Run: `cd mychess && npm run check`
Expected: errors only in files this task hasn't touched yet that call `resolveTeachingStep`/`advanceTeachingProgress` (`practice.ts`, `server/practice-progress.ts`) IF their call sites happen to destructure a return value TypeScript now sees an extra field on — in practice this should be zero new errors, since adding a field to a return type and an optional trailing parameter is backwards-compatible; investigate immediately if `check` disagrees rather than assuming it's expected.

- [ ] **Step 6: Commit**

```bash
git add mychess/src/lib/mastery/teaching.ts mychess/src/lib/mastery/teaching.test.ts
git commit -m "$(cat <<'EOF'
feat(mastery): teach up to a ceiling ply, distinguishing pause from solve

Refs #163
EOF
)"
```

---

### Task 3: `variationSequence.ts` — `blockedKeys`-aware `pickActiveVariation`/`advanceIfSolved`

**Files:**
- Modify: `mychess/src/lib/mastery/variationSequence.ts`
- Modify: `mychess/src/lib/mastery/variationSequence.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `variationSequence.test.ts` (match its existing `Variation` fixture-building style):

```ts
describe('pickActiveVariation with blockedKeys', () => {
	it('behaves exactly as without blockedKeys when nothing is blocked', () => {
		// (reuse the file's existing basic fixtures/assertions here, just also
		// passing an empty Set() as the fourth arg, to confirm the default and
		// an explicit empty set agree)
	});

	it('a stored active pointer to a BLOCKED (unsolved, paused) variation does NOT win outright — falls through', () => {
		const variations = [v('a'), v('b'), v('c')];
		const picked = pickActiveVariation(variations, 'b', new Set(), new Set(['b']));
		expect(picked?.variationKey).not.toBe('b');
	});

	it('a stored active pointer to an already-SOLVED variation still wins outright, even if it happens to be in blockedKeys', () => {
		// Solved always wins — blockedKeys only ever means "unsolved and
		// currently has nothing more to teach", never applied to a solved key
		// by any real caller, but pickActiveVariation itself must not assume
		// that and must prefer solvedKeys' own carve-out.
		const variations = [v('a'), v('b')];
		const picked = pickActiveVariation(variations, 'a', new Set(['a']), new Set(['a']));
		expect(picked?.variationKey).toBe('a');
	});

	it('skips blocked candidates when falling back to the first unsolved variation', () => {
		const variations = [v('a'), v('b'), v('c')];
		const picked = pickActiveVariation(variations, null, new Set(), new Set(['a']));
		expect(picked?.variationKey).toBe('b');
	});

	it('falls back to the first variation overall when every candidate is solved or blocked', () => {
		const variations = [v('a'), v('b')];
		const picked = pickActiveVariation(variations, null, new Set(), new Set(['a', 'b']));
		expect(picked?.variationKey).toBe('a');
	});
});

describe('advanceIfSolved with blockedKeys', () => {
	it('skips a blocked candidate the same way it already skips a solved one', () => {
		const variations = [v('a'), v('b'), v('c')];
		const next = advanceIfSolved('a', variations, new Set(), new Set(['b']));
		expect(next).toBe('c');
	});

	it('returns null, without hanging, when every remaining candidate is solved or blocked', () => {
		const variations = [v('a'), v('b'), v('c')];
		const next = advanceIfSolved('a', variations, new Set(['b']), new Set(['c']));
		expect(next).toBeNull();
	});
});
```

Use this file's own existing `v(variationKey)`-style helper (a minimal fixture builder) if one already exists near the top — do not duplicate it.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mychess && npx vitest run src/lib/mastery/variationSequence.test.ts`
Expected: FAIL — neither function accepts a fourth argument yet.

- [ ] **Step 3: Implement**

```ts
/**
 * The ONE variation currently active for a repertoire. If `activeVariationKey`
 * matches a real variation, that variation wins outright — even if it's
 * already solved (a player can deliberately re-drill something they've
 * solved) — UNLESS it's currently blocked (unsolved AND has nothing more to
 * teach right now under the current tier ceiling, GitHub issue #163): a
 * stale pointer to a now-paused variation must not keep re-serving the same
 * frozen board forever, so it's treated like "not found" and falls through.
 * Only when there's NO key, the key no longer matches anything, or the match
 * is blocked, does this fall back to the first UNSOLVED-and-unblocked
 * variation in sequence — or, if everything is solved or blocked, the first
 * UNSOLVED one regardless of blocked status — or, if everything is solved,
 * the very first variation overall.
 */
export function pickActiveVariation(
	variations: Variation[],
	activeVariationKey: string | null,
	solvedKeys: ReadonlySet<string>,
	blockedKeys: ReadonlySet<string> = new Set()
): Variation | null {
	if (variations.length === 0) return null;
	if (activeVariationKey) {
		const found = variations.find((v) => v.variationKey === activeVariationKey);
		if (found && (solvedKeys.has(found.variationKey) || !blockedKeys.has(found.variationKey))) return found;
	}
	return (
		variations.find((v) => !solvedKeys.has(v.variationKey) && !blockedKeys.has(v.variationKey)) ??
		variations.find((v) => !solvedKeys.has(v.variationKey)) ??
		variations[0]
	);
}

/**
 * Called right after `activeVariationKey` has just been marked solved, OR
 * paused at its tier ceiling (GitHub issue #163 — see
 * server/practice-progress.ts's `applyAttemptResult`) — the next
 * UNSOLVED-and-unblocked variation in sequence after it, skipping over any
 * later variation that's ALSO already solved or ALSO currently blocked.
 * `null` means every remaining variation is solved or blocked: nothing more
 * is currently servable.
 *
 * `visited` (unchanged from before this task) is what keeps this loop from
 * hanging even in that fully-blocked case.
 */
export function advanceIfSolved(
	activeVariationKey: string,
	variations: Variation[],
	solvedKeys: ReadonlySet<string>,
	blockedKeys: ReadonlySet<string> = new Set()
): string | null {
	const visited = new Set<string>([activeVariationKey]);
	let candidate = nextVariation(variations, activeVariationKey);
	while (candidate && (solvedKeys.has(candidate.variationKey) || blockedKeys.has(candidate.variationKey))) {
		if (visited.has(candidate.variationKey)) return null;
		visited.add(candidate.variationKey);
		candidate = nextVariation(variations, candidate.variationKey);
	}
	return candidate?.variationKey ?? null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd mychess && npx vitest run src/lib/mastery/variationSequence.test.ts`
Expected: PASS, including every pre-existing test.

- [ ] **Step 5: Commit**

```bash
git add mychess/src/lib/mastery/variationSequence.ts mychess/src/lib/mastery/variationSequence.test.ts
git commit -m "$(cat <<'EOF'
feat(mastery): skip tier-ceiling-paused variations when advancing

Refs #163
EOF
)"
```

---

### Task 4: `practice.ts` (`buildPracticeView`) — thread the ceiling through serve time

**Files:**
- Modify: `mychess/src/lib/mastery/practice.ts`
- Modify: `mychess/src/lib/mastery/practice.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `practice.test.ts` (reuse its existing `Variation`/`TeachingProgressEntry` fixture style):

```ts
describe('buildPracticeView with a ceilingMoveCount', () => {
	it('is unaffected when ceilingMoveCount is Infinity (the default), matching every existing test in this file', () => {
		// Spot-check: build one existing scenario from above in this file both
		// with the default and with an explicit Infinity, confirm identical output.
	});

	it('truncates a long unsolved variation\'s served attempt to the ceiling', () => {
		// A variation with e.g. 5 player moves, ceilingMoveCount low enough
		// (e.g. 2) that resolveTeachingStep pauses. Assert attempt.path.length
		// matches ceilingPlyFor(variation.path, ceilingMoveCount), NOT the
		// variation's own full length.
	});

	it('never applies the ceiling to a deliberate re-drill of an already-solved variation', () => {
		// forceAttempt=true, activeVariationKey pointing at a SOLVED variation
		// longer than the ceiling — attempt.path must be the FULL path, exactly
		// as today, ceiling or not.
	});

	it('skips a blocked (paused) variation when auto-picking the next one to serve', () => {
		// Two unsolved variations: one already paused at the ceiling (its
		// teachingProgress entry has masteredPlies === ceilingPlyFor(...)), one
		// untouched. The untouched one must be served, not the paused one.
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mychess && npx vitest run src/lib/mastery/practice.test.ts`

- [ ] **Step 3: Implement**

In `practice.ts`:

```ts
import { pickActiveVariation, solvedProgress } from './variationSequence';
import { resolveTeachingStep, knownProgressFor, autoPlayCeiling, ceilingPlyFor, isPausedAtCeiling } from './teaching';
```

Add a small local helper (not exported — this is `buildPracticeView`'s own concern, mirroring how `applyAttemptResult` will need the identical computation in Task 5; if you find yourself wanting to share it, put the shared version in `teaching.ts` instead of duplicating logic, but keep the two call sites — serve-time and record-time — each explicit about calling it, per this file's own existing "these two must never independently compute the same thing differently" discipline documented on `knownProgressFor`):

```ts
function computeBlockedKeys(
	variations: Variation[],
	solvedKeys: ReadonlySet<string>,
	teachingProgress: ReadonlyMap<string, { masteredPlies: number }>,
	ceilingMoveCount: number
): Set<string> {
	const blocked = new Set<string>();
	for (const variation of variations) {
		if (solvedKeys.has(variation.variationKey)) continue;
		const masteredPlies = teachingProgress.get(variation.variationKey)?.masteredPlies ?? 0;
		if (isPausedAtCeiling(variation.path, masteredPlies, ceilingMoveCount)) blocked.add(variation.variationKey);
	}
	return blocked;
}
```

Update `buildPracticeView`'s signature — insert `ceilingMoveCount` right after `teachingProgress`, defaulting to `Infinity` so every caller not yet updated (until Task 6) keeps compiling and behaving exactly as before:

```ts
export function buildPracticeView(
	variations: Variation[],
	activeVariationKey: string | null,
	solvedKeys: ReadonlySet<string>,
	teachingProgress: ReadonlyMap<string, TeachingProgressEntry>,
	ceilingMoveCount: number = Infinity,
	forceAttempt: boolean = false,
	now: Date = new Date()
): PracticeView {
```

Inside the body:

```ts
	const { learn } = splitQueues(variations, solvedKeys);
	const servable = forceAttempt ? variations : learn;
	const blockedKeys = computeBlockedKeys(variations, solvedKeys, teachingProgress, ceilingMoveCount);
	const active = pickActiveVariation(servable, activeVariationKey, solvedKeys, blockedKeys);
```

And in the not-already-solved branch, thread the ceiling into `resolveTeachingStep`:

```ts
			const step = resolveTeachingStep(
				active.path,
				effectiveTaughtPlies,
				effectiveMasteredPlies,
				ceilingPlyFor(active.path, ceilingMoveCount)
			);
```

The already-solved branch above it is untouched — no ceiling applied there, per the design doc's explicit exemption.

Every existing caller in this file/elsewhere that invokes `buildPracticeView` with 4 positional args now gets the new 5th parameter as its default (`Infinity`) automatically inserted before their existing `forceAttempt`/`now` args — **check every call site is still passing what it means to pass** once this lands; Task 6 updates the three real call sites to compute and pass an actual ceiling instead of relying on the default.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd mychess && npx vitest run src/lib/mastery/practice.test.ts`
Expected: PASS, including every pre-existing test.

- [ ] **Step 5: Commit**

```bash
git add mychess/src/lib/mastery/practice.ts mychess/src/lib/mastery/practice.test.ts
git commit -m "$(cat <<'EOF'
feat(mastery): thread the tier ceiling through buildPracticeView

Refs #163
EOF
)"
```

---

### Task 5: `server/practice-progress.ts` (`applyAttemptResult`) — the paused branch

**Files:**
- Modify: `mychess/src/lib/server/practice-progress.ts`
- Modify: `mychess/src/lib/server/practice-progress.test.ts`

**Read the design doc's own callout on this task before writing code.** This is the one place a bug reproduces the exact "stuck forever" failure mode this whole feature exists to avoid without repeating.

- [ ] **Step 1: Write the failing tests**

Add to `practice-progress.test.ts`, using its existing `makeVariation`/`fakeSupabase` fixtures:

```ts
describe('applyAttemptResult with a ceilingMoveCount', () => {
	it('a clean pass that only reaches the ceiling does NOT call markVariationSolved (no variation_solved upsert)', async () => {
		// A variation longer than the ceiling, taughtPlies/masteredPlies already
		// AT the ceiling ply going into this call (so this pass's
		// advanceTeachingProgress reports pausedAtCeiling: true). Assert no
		// upsert against 'variation_solved' happened.
	});

	it('a clean pass that pauses STILL advances practice_active_variation to a different, still-servable variation', async () => {
		// Two unsolved variations: the active one (about to pause) and a second,
		// shorter one still fully servable. Assert setActiveVariationKey (or
		// whatever this fake harness observes) was called with the SECOND
		// variation's key, not left unset / not left pointing at the first.
	});

	it('a clean pass that genuinely finishes a variation within the ceiling behaves exactly as without a ceiling: marks solved, advances', async () => {
		// A short variation, well within the ceiling, reaching its own true end.
		// Assert markVariationSolved-equivalent write happened, exactly as any
		// pre-existing "solved" test in this file already asserts.
	});

	it('a mistake stays a complete no-op regardless of the ceiling', async () => {
		// Mirror any existing "mistake is a no-op" test in this file, just also
		// passing a finite ceilingMoveCount, and assert zero writes happened.
	});
});
```

Match this file's existing assertion style exactly (it likely inspects the `fromCalls`/`upsertCalls` arrays the fake Supabase harness records — read the file's existing tests immediately above/below where you're adding these before writing the new assertions, so the new tests observe the harness the same way the old ones do).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mychess && npx vitest run src/lib/server/practice-progress.test.ts`

- [ ] **Step 3: Implement**

Add the same `computeBlockedKeys`-shaped helper Task 4 added to `practice.ts` — since both files need the identical computation and neither is allowed to drift from the other (per `knownProgressFor`'s own documented discipline about serve-time and record-time never disagreeing), export it from `teaching.ts` instead of duplicating it a second time. Revise Task 4 in place if needed: move `computeBlockedKeys` into `teaching.ts` as an exported function (it only needs `Variation`-shaped data and `teaching.ts`'s own `isPausedAtCeiling`, so it belongs there at least as naturally as in `practice.ts`), and have both `practice.ts` and `practice-progress.ts` import the same one. Do this move now if Task 4 didn't already anticipate it — do not end this task with two independently-maintained copies of the same loop.

In `practice-progress.ts`, update `applyAttemptResult`'s signature to accept `ceilingMoveCount: number = Infinity` (placed logically — e.g. right after `allVariations`, since both are "extra repertoire-wide context" params with defaults preserving old behavior), and rewrite its tail:

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
	if (variation) {
		const solvedKeys = await loadSolvedKeys(supabase, playerId, repertoireId);
		if (!solvedKeys.has(variationKey)) {
			const progressMap = await loadTeachingProgress(supabase, playerId, repertoireId);
			const { taughtPlies: effectiveTaughtPlies, masteredPlies: effectiveMasteredPlies } = knownProgressFor({
				variation,
				variations,
				teachingProgress: progressMap,
				solvedKeys,
				resumedAfterBreak
			});
			const ceilingPly = ceilingPlyFor(variation.path, ceilingMoveCount);
			const next = advanceTeachingProgress(variation.path, effectiveTaughtPlies, effectiveMasteredPlies, false, ceilingPly);
			await saveTeachingProgress(supabase, playerId, repertoireId, variationKey, next.taughtPlies, next.masteredPlies);

			if (next.pausedAtCeiling) {
				// Paused, not solved: must NOT markVariationSolved or touch the
				// completed-chapters cache — but MUST still advance past this
				// variation, or the active pointer re-serves the same frozen,
				// paused board forever (GitHub issue #163's central risk — see
				// the design doc). blockedKeys is recomputed from the JUST-SAVED
				// progress (progressMap doesn't yet reflect this write), so patch
				// this one variation's masteredPlies in locally before computing it.
				const updatedProgress = new Map(progressMap);
				updatedProgress.set(variationKey, { ...(progressMap.get(variationKey) ?? { taughtPlies: 0, masteredPlies: 0, updatedAt: null }), masteredPlies: next.masteredPlies });
				const blockedKeys = computeBlockedKeys(variations, solvedKeys, updatedProgress, ceilingMoveCount);
				const nextKey = advanceIfSolved(variationKey, variations, solvedKeys, blockedKeys);
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
	if (variation) {
		await cacheCompletedChaptersReached(supabase, playerId, repertoireId, variation, allVariations, solvedKeys);
	}
}
```

Add the new imports (`ceilingPlyFor`, `computeBlockedKeys` from `$lib/mastery/teaching`) at the top of the file alongside the existing `advanceTeachingProgress, knownProgressFor` import.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd mychess && npx vitest run src/lib/server/practice-progress.test.ts`
Expected: PASS, including every pre-existing test (the `Infinity` default must leave every one of them byte-identical to before).

- [ ] **Step 5: Type-check**

Run: `cd mychess && npm run check`

- [ ] **Step 6: Commit**

```bash
git add mychess/src/lib/server/practice-progress.ts mychess/src/lib/server/practice-progress.test.ts mychess/src/lib/mastery/teaching.ts mychess/src/lib/mastery/practice.ts
git commit -m "$(cat <<'EOF'
feat(mastery): advance past a tier-ceiling-paused variation, never mark it solved

The single highest-risk change in GitHub issue #163's rollout: without this,
a variation paused at its ceiling would re-serve the same frozen board
forever, reproducing the exact "stuck gauntlet" failure mode this repo has
already retired three prior systems over.

Refs #163
EOF
)"
```

---

### Task 6: Thread the ceiling through the three route handlers

**Files:**
- Modify: `mychess/src/routes/api/practice/attempt/+server.ts`
- Modify: `mychess/src/routes/api/practice/select-variation/+server.ts`
- Modify: `mychess/src/routes/(player)/learn/[repertoire_id]/+page.server.ts`

No dedicated unit tests for these three (thin I/O wrappers over the now-tested pure logic, per this repo's established `lib/server/` vs. route-handler convention) — verified via `npm run check`, the existing test suites for anything they import, and the manual verification pass in Task 10.

- [ ] **Step 1: `/api/practice/attempt`**

This handler already loads the UNFILTERED variation set (`loadRepertoireVariations`, for `cacheCompletedChaptersReached`'s exclusion-blocking requirement) and already loads `solvedKeys` indirectly further down — compute the ceiling from data already in hand, no new query:

```ts
import { teachingCeilingMoveCount } from '$lib/mastery/chapterLevels';
```

After the existing `const variations = filterVariations(allVariations, excludedVariationKeys);` line, compute the ceiling from `allVariations` and the freshest `solvedKeys` available at that point in the handler — check what's already in scope; if `solvedKeys` isn't loaded yet at this point in the function, either move this computation to just after the later `loadSolvedKeys` call, or accept computing it once with a solvedKeys read that already exists nearby — do not add a new query only for this. Then thread it into both calls:

```ts
applyAttemptResult(supabase, user.id, repertoireId, variationKey, hadMistake, variations, resumedAfterBreak, allVariations, ceilingMoveCount),
```

and, further down, where `buildPracticeView(variations, activeVariationKey, solvedKeys, teachingProgress)` is called — insert `ceilingMoveCount` as the 5th positional argument (recomputed, or reused, from the SAME `solvedKeys` this call already loads — `teachingCeilingMoveCount` is cheap and pure, recomputing it twice in one request is fine and clearer than threading a value across an `await Promise.all`):

```ts
return json(buildPracticeView(variations, activeVariationKey, solvedKeys, teachingProgress, teachingCeilingMoveCount(allVariations, solvedKeys)));
```

- [ ] **Step 2: `/api/practice/select-variation` — also add the new rejection**

Switch from `loadFilteredRepertoireVariations` to `loadRepertoireVariations` (unfiltered) plus a local filter, mirroring `/api/practice/attempt`'s existing pattern:

```ts
import { loadRepertoireVariations } from '$lib/server/practice-repertoire';
import { filterVariations } from '$lib/mastery/variations';
import { teachingCeilingMoveCount } from '$lib/mastery/chapterLevels';
import { isPausedAtCeiling } from '$lib/mastery/teaching';
```

```ts
	const { variations: allVariations, excludedVariationKeys } = await loadRepertoireVariations(supabase, user.id, repertoireId);
	const variations = filterVariations(allVariations, excludedVariationKeys);
	const picked = variations.find((v) => v.variationKey === variationKey);
	if (!picked) {
		throw error(404, 'Variation not found');
	}

	const [solvedKeys, teachingProgress] = await Promise.all([
		loadSolvedKeys(supabase, user.id, repertoireId),
		loadTeachingProgress(supabase, user.id, repertoireId)
	]);

	if (!solvedKeys.has(variationKey)) {
		const ceilingMoveCount = teachingCeilingMoveCount(allVariations, solvedKeys);
		const masteredPlies = teachingProgress.get(variationKey)?.masteredPlies ?? 0;
		if (isPausedAtCeiling(picked.path, masteredPlies, ceilingMoveCount)) {
			throw error(403, 'This line is locked until you finish your current tier');
		}
	}

	await setActiveVariationKey(supabase, user.id, repertoireId, variationKey);
	return json(buildPracticeView(variations, variationKey, solvedKeys, teachingProgress, teachingCeilingMoveCount(allVariations, solvedKeys), true));
```

Reorder the existing body as needed to match — `solvedKeys`/`teachingProgress` need to be loaded BEFORE the new rejection check now, rather than only after `setActiveVariationKey` as today; check the current file's exact statement order before editing rather than assuming the snippet above's ordering is a pure append.

- [ ] **Step 3: `/learn/[repertoire_id]/+page.server.ts`**

This currently uses `loadFilteredRepertoireVariations` only. It needs the unfiltered set too, purely to compute the ceiling (the served `variations` themselves stay filtered, unchanged):

```ts
import { loadRepertoireVariations } from '$lib/server/practice-repertoire';
import { filterVariations } from '$lib/mastery/variations';
import { teachingCeilingMoveCount } from '$lib/mastery/chapterLevels';
```

```ts
export const load: PageServerLoad = async ({ params, locals }) => {
	const { user } = await requireAccount(locals);
	const supabase = locals.supabase;
	const repertoireId = params.repertoire_id;

	const [{ repertoire, variations: allVariations, excludedVariationKeys }, solvedKeys, teachingProgress] = await Promise.all([
		loadRepertoireVariations(supabase, user!.id, repertoireId),
		loadSolvedKeys(supabase, user!.id, repertoireId),
		loadTeachingProgress(supabase, user!.id, repertoireId)
	]);
	const variations = filterVariations(allVariations, excludedVariationKeys);
	const activeVariationKey = await loadSyncedActiveVariationKey(supabase, user!.id, repertoireId, variations, solvedKeys);

	const view = buildPracticeView(variations, activeVariationKey, solvedKeys, teachingProgress, teachingCeilingMoveCount(allVariations, solvedKeys));
	return { repertoire, ...view };
};
```

Check the file's existing imports (`loadFilteredRepertoireVariations`, `loadSolvedKeys`, `loadTeachingProgress`, `loadSyncedActiveVariationKey`) before editing — this replaces the single `loadFilteredRepertoireVariations` call and its destructuring, keeps the other two loads as they already are, and adds the `teachingProgress` load this page didn't previously need for its own purposes (only `buildPracticeView` did, and it already receives it — check whether this page already loads `teachingProgress` itself today before assuming it needs adding; if `buildPracticeView` is already being handed a `teachingProgress` map today, this page already loads it and this bullet is a no-op).

- [ ] **Step 4: Type-check and run the full unit suite**

Run: `cd mychess && npm run check && npm test`
Expected: zero errors, all tests pass.

- [ ] **Step 5: Commit**

```bash
git add "mychess/src/routes/api/practice/attempt/+server.ts" "mychess/src/routes/api/practice/select-variation/+server.ts" "mychess/src/routes/(player)/learn/[repertoire_id]/+page.server.ts"
git commit -m "$(cat <<'EOF'
feat(learn): enforce the tier ceiling server-side, including manual picks

/api/practice/select-variation now rejects picking an unsolved variation
that's already paused at the current tier ceiling — the picker's own
disabled UI (Task 8) is a courtesy, this is the real gate.

Refs #163
EOF
)"
```

---

### Task 7: `/api/repertoires/[id]/variations` — `playerMoveCount` + `locked` per row

**Files:**
- Modify: `mychess/src/routes/api/repertoires/[id]/variations/+server.ts`
- Test: add or extend a test file for this route if one exists; otherwise verify via Task 8's `VariationPicker.test.ts` (which mocks this endpoint's response shape directly) plus manual verification.

- [ ] **Step 1: Implement**

```ts
import { requireApiUser } from '$lib/server/auth';
import { fetchAllChapterExclusions, loadRepertoireVariations } from '$lib/server/practice-repertoire';
import { loadSolvedKeys, loadTeachingProgress } from '$lib/server/practice-progress';
import { moveSequenceLabel, UNTAGGED_CHAPTER } from '$lib/mastery/variations';
import { teachingCeilingMoveCount } from '$lib/mastery/chapterLevels';
import { isPausedAtCeiling } from '$lib/mastery/teaching';
```

```ts
export const GET: RequestHandler = async ({ params, locals }) => {
	const user = await requireApiUser(locals);
	const [{ variations }, solvedKeys, chapterExclusions, teachingProgress] = await Promise.all([
		loadRepertoireVariations(locals.supabase, user.id, params.id),
		loadSolvedKeys(locals.supabase, user.id, params.id),
		fetchAllChapterExclusions(locals.supabase, user.id, params.id),
		loadTeachingProgress(locals.supabase, user.id, params.id)
	]);

	const ceilingMoveCount = teachingCeilingMoveCount(variations, solvedKeys);
	const excludedPairs = new Set(chapterExclusions.map((r) => `${r.chapter_name}${PAIR_SEP}${r.variation_key}`));

	return json(
		variations.map((v) => {
			const chapters = v.chapterNames.length > 0 ? v.chapterNames : [UNTAGGED_CHAPTER];
			const includedByChapter: Record<string, boolean> = {};
			for (const chapter of chapters) {
				includedByChapter[chapter] = !excludedPairs.has(`${chapter}${PAIR_SEP}${v.variationKey}`);
			}
			const solved = solvedKeys.has(v.variationKey);
			const masteredPlies = teachingProgress.get(v.variationKey)?.masteredPlies ?? 0;
			return {
				variationKey: v.variationKey,
				label: moveSequenceLabel(v.path),
				includedByChapter,
				chapterNames: v.chapterNames,
				path: v.path,
				solved,
				playerMoveCount: v.playerMoveCount,
				locked: !solved && isPausedAtCeiling(v.path, masteredPlies, ceilingMoveCount)
			};
		})
	);
};
```

Update this handler's own top-of-file doc comment (the one describing what each row carries) to mention the two new fields and their purpose (Learn's picker locking, GitHub issue #163) — it currently documents every existing field's purpose in the same style; match it.

- [ ] **Step 2: Type-check**

Run: `cd mychess && npm run check`

- [ ] **Step 3: Commit**

```bash
git add "mychess/src/routes/api/repertoires/[id]/variations/+server.ts"
git commit -m "$(cat <<'EOF'
feat(api): expose per-variation tier-lock state to the picker

Refs #163
EOF
)"
```

---

### Task 8: `VariationPicker.svelte` — locked UI

**Files:**
- Modify: `mychess/src/lib/components/VariationPicker.svelte`
- Modify: `mychess/src/lib/components/VariationPicker.test.ts`
- Modify: `mychess/messages/en.json`
- Modify: `mychess/messages/lt.json`

- [ ] **Step 1: Add the message key**

In `messages/en.json`, near the other `variation_picker_*` keys:

```json
	"variation_picker_locked_reason": "Finish your current level first",
```

In `messages/lt.json`, near its equivalent keys (match the file's existing translation style/tone for this feature — cross-check against `practice_levels_*`'s existing Lithuanian translations added by the sibling knowledge-levels plan for terminology consistency, e.g. how it renders "level"):

```json
	"variation_picker_locked_reason": "Pirmiausia baikite dabartinį lygį",
```

- [ ] **Step 2: Regenerate paraglide messages**

Run: `cd mychess && npm run check`
Expected: regenerates `src/lib/paraglide/messages/*` from the JSON (this repo's established convention — do not run a bare `paraglide-js compile`, see `CLAUDE.md`'s paraglide note). Confirm no errors.

- [ ] **Step 3: Write the failing tests**

Add to `VariationPicker.test.ts`, following its existing `row(...)`/`variationsResponse` fixture style — extend the `row()` helper to accept a `locked` option:

```ts
function row(
	variationKey: string,
	sans: string[],
	chapterNames: string[],
	opts: { included?: boolean; solved?: boolean; locked?: boolean } = {}
) {
	// ...(existing body, plus:)
	return { /* ...existing fields... */, locked: opts.locked ?? false };
}
```

```ts
describe('locked variations (GitHub issue #163)', () => {
	it('renders a locked leaf row disabled, with the reason text, and does not select it when clicked', async () => {
		const mixed = [
			row('v1', ['e4', 'e5', 'Nf3'], ['Ruy Lopez'], { locked: true }),
			row('v2', ['d4', 'd5', 'c4'], ['Italian Game'])
		];
		const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => mixed });
		vi.stubGlobal('fetch', fetchSpy);
		const onselect = vi.fn();
		render(VariationPicker, { props: { repertoireId: 'rep-1', onselect, onclose: vi.fn() } });

		await waitFor(() => screen.getByText('Ruy Lopez'));
		await fireEvent.click(screen.getByText('Ruy Lopez'));

		const lockedRow = screen.getByText('label:v1').closest('button')!;
		expect(lockedRow.textContent).toContain('Finish your current level first');
		expect(lockedRow).toBeDisabled();
		await fireEvent.click(lockedRow);
		expect(onselect).not.toHaveBeenCalled();
	});

	it('a mixed bucket (one locked, one not) stays enterable, and shows each row\'s own lock state', async () => {
		const mixed = [
			row('v1', ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O', 'Be7', 'Re1'], ['Ruy Lopez'], { locked: true }),
			row('v2', ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O', 'Be7', 'd3'], ['Ruy Lopez'])
		];
		const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => mixed });
		vi.stubGlobal('fetch', fetchSpy);
		const onselect = vi.fn();
		render(VariationPicker, { props: { repertoireId: 'rep-1', onselect, onclose: vi.fn() } });

		await waitFor(() => screen.getByText('Ruy Lopez'));
		await fireEvent.click(screen.getByText('Ruy Lopez'));
		// v1/v2 share their first 5 moves -> one bucket, still enterable despite v1 being locked.
		await fireEvent.click(screen.getByText(/1\.e4 e5 2\.Nf3 Nc6 3\.Bb5 a6 4\.Ba4 Nf6 5\.O-O Be7/));
		expect(screen.getByText('label:v1').closest('button')).toBeDisabled();
		await fireEvent.click(screen.getByText('label:v2'));
		expect(onselect).toHaveBeenCalledWith('v2');
	});

	it('a locked bucket-of-one renders as a locked LEAF row, not an auto-selecting folder', async () => {
		const single = [row('v1', ['e4', 'e5', 'Nf3'], ['Ruy Lopez'], { locked: true })];
		const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => single });
		vi.stubGlobal('fetch', fetchSpy);
		const onselect = vi.fn();
		render(VariationPicker, { props: { repertoireId: 'rep-1', onselect, onclose: vi.fn() } });

		await waitFor(() => screen.getByText('Ruy Lopez'));
		await fireEvent.click(screen.getByText('Ruy Lopez'));
		const soleRow = screen.getByText('label:v1').closest('button')!;
		expect(soleRow).toBeDisabled();
		await fireEvent.click(soleRow);
		expect(onselect).not.toHaveBeenCalled();
	});
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd mychess && npx vitest run src/lib/components/VariationPicker.test.ts`

- [ ] **Step 5: Implement**

In `VariationPicker.svelte`, add `locked: boolean` to the local `VariationRow` type. In the `{#snippet body()}` block, every leaf-row `<button>` (the one inside `openGroup.items` and the "group of one" branch inside `currentGroups`) needs:

- `disabled={row.locked}` (or `disabled={only.locked}` for the group-of-one branch)
- a visually distinct disabled style added to its existing class list (match the existing conditional-class pattern already used for the active-row ring, e.g. append `{row.locked ? 'opacity-50 cursor-not-allowed' : ''}`)
- the reason text shown alongside the row when locked, e.g. a small trailing span: `{#if row.locked}<span class="text-xs text-(--color-muted)">{m.variation_picker_locked_reason()}</span>{/if}` — placed where the solved checkmark already goes, choosing a layout that doesn't collide with it (a variation is never both solved and locked, since `locked` is server-computed as `!solved && ...` — see Task 7 — so the two spans are mutually exclusive and can share the same slot with an `{:else if}`)
- the `onclick` handler must not fire `onselect` for a locked row — either guard inside the handler (`onclick={() => { if (!row.locked) onselect(row.variationKey); }}`) or rely on `disabled` alone if this codebase's existing click handling already treats a disabled button as fully inert (verify — some Svelte/browser combinations still fire synthetic events on disabled buttons in tests; the explicit guard is the safer choice, so prefer it)

Update `soleVariation`'s call site (the "group of one selects directly" `onclick`) with the same guard: `onclick={() => { if (only && !only.locked) onselect(only.variationKey); else if (!only) openGroupIndex = i; }}` — check the existing conditional there (`only ? onselect(only.variationKey) : (openGroupIndex = i)`) and adapt precisely rather than restructuring it.

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd mychess && npx vitest run src/lib/components/VariationPicker.test.ts`
Expected: PASS, including every pre-existing test in the file — a `locked: false` default on `row()`'s new option must leave every prior test's fixtures behaving exactly as before.

- [ ] **Step 7: Commit**

```bash
git add mychess/src/lib/components/VariationPicker.svelte mychess/src/lib/components/VariationPicker.test.ts mychess/messages/en.json mychess/messages/lt.json
git commit -m "$(cat <<'EOF'
feat(learn): show tier-locked variations as visible, disabled, with a reason

Refs #163
EOF
)"
```

---

### Task 9: Full verification pass

**Files:** none (verification only).

- [ ] **Step 1: Full test suite**

Run: `cd mychess && npm test`
Expected: all pass.

- [ ] **Step 2: Type-check**

Run: `cd mychess && npm run check`
Expected: zero errors.

- [ ] **Step 3: Lint**

Run: `cd mychess && npm run lint`
Expected: zero errors (per `CLAUDE.md`: no tolerated baseline).

- [ ] **Step 4: `grep` sweep for stray old call sites**

Run: `cd mychess && grep -rn "buildPracticeView(" src | grep -v test`
Confirm every non-test call site now passes an explicit `ceilingMoveCount` (Task 6) rather than silently relying on the `Infinity` default — the default exists to keep tests and intermediate commits compiling, not as a real production fallback. Any remaining default-reliant call site outside a test is a bug to fix before this task is done.

- [ ] **Step 5: Manual verification**

Start the dev server (`npm run dev`) and, on a repertoire with a genuine mix of short (<=9-move) and long (>9-move) lines:
- Confirm a long line's Learn drill stops teaching at move 9 and hands off to a different variation.
- Confirm the picker shows the paused long line as visibly present, disabled, with the reason text.
- Solve every <=9-move line in the repertoire and confirm — on the very next Learn interaction — the previously-paused long line resumes from where it left off (not from the start), and the picker no longer shows it locked.
- Confirm re-drilling an already-solved variation via the picker still teaches it in full, uncapped, regardless of length.

- [ ] **Step 6: Refactor pass**

Per `CLAUDE.md`'s "after finishing a major feature, run a refactor pass" convention: re-read every file this plan touched, specifically checking for the `computeBlockedKeys` duplication risk flagged in Task 5 (confirm it truly lives in exactly one place, `teaching.ts`, imported by both `practice.ts` and `practice-progress.ts` — not reimplemented independently in each), and for any leftover `Infinity`-default reliance outside tests. Fix what's cheap inline; file a GitHub issue for anything bigger.

- [ ] **Step 7: Close out**

Once every acceptance criterion in `docs/superpowers/specs/2026-08-26-tier-gated-learn-design.md` §2 is met and manually verified, close GitHub issue #163 (`gh issue close 163 --comment "..."`), summarizing what shipped and confirming the manual verification pass above.
