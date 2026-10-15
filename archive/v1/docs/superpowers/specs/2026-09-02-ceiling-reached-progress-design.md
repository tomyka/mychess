# Ceiling-Reached Progress — Design

GitHub issue: #181. Started as a bug report ("I completed a locked variation and it still shows locked, progress didn't move") and grew into a follow-up to both `docs/superpowers/specs/2026-08-26-repertoire-knowledge-levels-design.md` and `docs/superpowers/specs/2026-08-26-tier-gated-learn-design.md`. Those two documents built the Bronze/Silver/Gold/Platinum tier ladder (`src/lib/mastery/chapterLevels.ts`) and then gated Learn's teaching depth on it, but kept the ladder's own "is this tier satisfied" question defined the same way throughout: every variation in a move-count bracket must be fully, individually solved (`variation_solved`). This document changes that definition itself, and threads the new definition through every one of its existing consumers — Learn's teaching ceiling, the Levels page's medals, and chapter-completion badges — so all three answer the same question the same way.

This design was produced through a brainstorming session with the user (not a casual bug fix) — the session surfaced that the reported bug was in fact the tier ladder's existing design working as originally specified (a variation paused at the ceiling is deliberately not `variation_solved`), and that the real fix the user wanted was a redefinition of what "reaching a tier" means, not a UI patch. The user explicitly chose the broader of two options at each fork: ceiling-reached progress should count toward actually leveling up (not just better wording), and the Levels/badges page should adopt the same rule rather than staying stricter. Both choices, and their risk tradeoffs, were surfaced and confirmed explicitly before this document was written.

## 1. Executive Summary

### Problem Statement

Root cause of the reported bug: `isLockedForTier`'s picker-facing `locked` flag is `true` for two different situations — a variation that's genuinely not reachable yet, and one the player just finished teaching all the way to the current tier's move cap (`isPausedAtCeiling`). Both render as the same padlock with the same "Finish your current level first" tooltip, so completing a long variation up to the cap looks, from the picker, identical to never having touched it. Worse, that completion is *correctly* not written to `variation_solved` (a paused variation, by the existing tier-gated Learn design, is not solved) and — because `deriveChapterLevel`'s tier-satisfaction check today only looks at `variation_solved` for the same-tier move-count bracket — a long variation reaching the ceiling has **zero effect on any progress number in the app**, even though the player did everything currently possible with that line.

The user doesn't want that effort to be invisible. They want two things: (1) a variation reaching the ceiling to genuinely count as progress toward the next tier, not just be reflected honestly without changing anything, and (2) that same "reached, not necessarily solved" rule to apply consistently everywhere a level is shown — Learn's teaching pace and the Levels page's medals — rather than the two pages being allowed to disagree.

### Proposed Solution

1. Replace `deriveChapterLevel`'s per-tier satisfaction check. Today: "every variation whose own length falls in this tier's bracket has a `variation_solved` row." New: "every variation in scope has been taught at least up to this tier's move cap" — via a new `hasReachedCeiling` predicate that is true for a short variation once it's genuinely solved (its own end lies at or before the cap) and for a long variation once it's paused there (`isPausedAtCeiling`). The walk over `bronze → silver → gold → platinum` and the chapter's-own-ceiling clamp (`isChapterComplete`) are otherwise unchanged in shape.
2. This single redefinition automatically propagates to every existing consumer of `deriveChapterLevel`: `isChapterComplete`, `teachingCeilingMoveCount` (Learn's ceiling), and — via those — the Levels page's medals and the chapter-completion badges. One function, one meaning, everywhere.
3. Add `currentLevelProgress()`, a thin sibling of `teachingCeilingMoveCount` that exposes the same underlying computation as a `{ tier, ready, total }` fraction instead of a boolean pass/fail — this backs a new "current level" progress bar on the Learn page, shown alongside the existing, unchanged "X / Y variations learned" total.
4. Split the picker's single `locked` icon into two distinct states: **paused** (reached the ceiling, counts toward leveling up — new icon) and **locked** (genuinely not reachable yet — existing padlock, unchanged meaning). `VariationPicker.svelte`'s disabled/selectable behavior is completely unchanged; only which icon and tooltip render.
5. Because reaching-the-ceiling now requires a `masteredPlies` figure (shared-prefix-credit aware, via the existing `knownProgressFor`/`computeMasteredMoveIds` machinery) rather than a `variation_solved` boolean, every caller that previously only needed `solvedKeys` now also needs a `teaching_progress` read. A new `computeMasteredPliesMap()` helper computes this once per request (not once per chapter) to keep every per-chapter caller at its existing O(n), not O(chapters × n).

### Success Criteria

- Completing a variation up to the current ceiling (pausing there) visibly moves the new "current level" progress bar on the Learn page, even though it does not move the "X / Y learned" total.
- The picker shows a variation paused at the ceiling with a distinct icon/tooltip from one that's genuinely not reachable yet — never the same padlock for both.
- The Levels page's medals and Learn's teaching ceiling are computed from the exact same function and always agree with each other for the same player/repertoire at the same moment.
- An untouched long variation now blocks tier advancement (repertoire-wide) until it's been taught at least up to the tier's cap — a deliberate, larger behavior change from today, where only same-tier-length variations mattered.
- No new tables, no new columns — everything here is derived at read time from `teaching_progress` and `variation_solved`, matching this codebase's existing convention for tier-related state.
- `npm run check`, `npm run lint`, and the full `vitest` suite (including the ~25 existing `chapterLevels.test.ts` assertions, updated for the new signature) pass.

---

## 2. User Experience & Functionality

### User Stories

- As a player, when I finish teaching a long variation up to my current level's move limit, I want to see that reflected somewhere, even though the variation itself has more moves I haven't gotten to yet.
- As a player, I want the picker to tell me clearly when a line is "done for now, waiting on the rest of the level" versus "not available yet for an unrelated reason" — not the same padlock for both.
- As a player, I want my Bronze/Silver/Gold/Platinum medal on the Levels page to mean the same thing Learn is actually gating my teaching on, not a stricter or looser number that quietly disagrees.

### Acceptance Criteria

- **Tier-satisfaction rule (the core redefinition)**: a tier's move cap `C` is satisfied for a set of variations when every variation `v` in that set has `masteredPlies(v) >= min(v.path.length, ceilingPlyFor(v.path, C))` — true for a short variation once fully solved, true for a longer one once paused at `C`. This replaces the existing "every variation in `v`'s own bracket is in `solvedKeys`" check everywhere it appears.
- **Chapter/repertoire ladder walk is otherwise unchanged**: still walks `bronze → silver → gold → platinum` in order, still stops at the first unsatisfied tier, still clamps to a chapter's own ceiling (`chapterCeiling`) so a chapter capped at Silver can never be reported as Gold or Platinum just because higher-tier checks are vacuously satisfied by having no content there.
- **"Vacuous bracket" as a concept is retired.** Today, a chapter with nothing in Silver's own-length bracket skips Silver's check entirely. Under the new rule there is no bracket subset — every variation in scope is checked against every tier's cap up to the chapter's own ceiling, so an untouched long variation now blocks even Bronze until it's taught up to move 9. This is an intentional, larger behavior change, not an oversight — it is the direct mechanism that makes "reaching the ceiling counts as progress" true.
- **Learn's teaching ceiling (`teachingCeilingMoveCount`) and the Levels page's medals are the same computation.** No parallel algorithm, no second "is this tier done" implementation anywhere.
- **`variation_solved` writes are completely unaffected.** This design only changes what's *read* to derive a tier; `applyAttemptResult`'s existing "paused → don't write `variation_solved`" branch is untouched. A paused variation still isn't "solved" in the strict, per-variation sense — it now just also counts toward the tier ladder, which is a different question.
- **Picker: two distinct non-selectable states.** A row/group that's unsolved and `isPausedAtCeiling` shows a new icon (e.g. an hourglass) with a "reached this level's limit here — counts toward leveling up" tooltip. A row/group that's unsolved, not paused, but still `isLockedForTier` (the deferred-sibling case) keeps today's padlock and "finish your current level first" tooltip. Both remain disabled/non-selectable — this is a display-only change, not a change to what's practiceable.
- **A ceiling group's own badge follows the same split**: shown as paused (hourglass) only when every member is itself paused; shown as locked (padlock) if any member is still genuinely blocked. Mixed groups already stay enterable today (`ceilingGroupDone` requires every item locked) — unchanged.
- **Learn page gains a second progress line**: "Current level: `ready` / `total`" (tier name shown), directly below the existing "X / Y variations learned" line, computed from `currentLevelProgress()`. The existing line's meaning and computation are completely unchanged.
- **`solvedKeys` is dropped from `deriveChapterLevel`/`isChapterComplete`/`teachingCeilingMoveCount`'s own signatures**, replaced by a precomputed `masteredPlies: ReadonlyMap<string, number>`. `solvedKeys` is still very much used elsewhere (the flat "learned" status, badge "already learned" gating, `computeMasteredPliesMap` itself) — only these three functions' own inputs change.

### Non-Goals

- Any change to the flat, repertoire-wide "learned" status (all non-excluded variations solved) — untouched, per both prior designs' own non-goals, still true here.
- Any change to `variation_solved`'s write conditions, or to `applyAttemptResult`'s existing mistake/solved/paused three-way branch — this design only changes tier *derivation*, not attempt recording.
- Any change to `isLockedForTier`/`computeBlockedKeys`'s serve-time gating logic (what Learn will and won't currently teach, and the deferred-sibling mechanism from issue #172) — untouched. This design changes what counts toward *leveling up*, not what's currently servable.
- A staged rollout, feature flag, or data-migration/backfill audit for existing players' medals shifting under the new rule. Per explicit user decision: ship the recompute directly, matching this repo's existing "production is the test environment, no other users yet" convention.
- New badge ids or new milestone celebrations tied to "current level progress" specifically — the existing `first_repertoire_mastered`/`repertoires_mastered_5` badges keep their ids and definitions, now fed by the redefined `mastered` derivation exactly as before (a data-source change, not a badge-logic change).
- Reordering the automatic practice sequence, or any change to how a single teaching batch is taught — both explicitly out of scope in the prior tier-gated Learn design and not reopened here.

---

## 3. Technical Specifications

### Architecture Overview

No new tables, no new columns. Every new value is derived at read time from `teaching_progress` and `variation_solved`, exactly like the two designs this one extends.

| Concern | Where it lives |
|---|---|
| "Has this variation been taught at least up to this move cap?" (short = fully solved, long = paused there) | New `hasReachedCeiling()` in `teaching.ts` |
| "What's every variation's effective, shared-credit-aware `masteredPlies`, computed once for a whole repertoire?" | New `computeMasteredPliesMap()` in `teaching.ts` |
| "What tier has this chapter/repertoire reached, under the new rule?" | Existing `deriveChapterLevel()`/`isChapterComplete()`/`teachingCeilingMoveCount()` in `chapterLevels.ts`, redefined signatures |
| "How close is the repertoire to its next tier, as a fraction?" | New `currentLevelProgress()` in `chapterLevels.ts` |
| Picker's paused-vs-locked split | `/api/repertoires/[id]/variations/+server.ts` (new `pausedAtCeiling` field per row) → `VariationPicker.svelte` (new icon/tooltip branch) |
| Learn page's new "current level" bar | `/learn/[repertoire_id]/+page.server.ts` (new `currentLevel` field) → `+page.svelte` (new progress line) |

### `hasReachedCeiling` and `computeMasteredPliesMap` (`teaching.ts`)

```ts
/**
 * Whether `path` has been taught at least as far as `ceilingMoveCount` allows
 * — true both for a variation genuinely PAUSED there (`isPausedAtCeiling`)
 * and for one whose own true end already lies at or before the ceiling and
 * has been fully mastered (an ordinary solve). The single predicate
 * `chapterLevels.ts`'s tier derivation needs: "is there nothing more THIS
 * tier could currently ask of this variation" — regardless of whether that's
 * because it's short and done, or long and capped.
 */
export function hasReachedCeiling(path: readonly VariationStep[], masteredPlies: number, ceilingMoveCount: number): boolean {
	const ceilingPly = ceilingPlyFor(path, ceilingMoveCount);
	return masteredPlies >= Math.min(path.length, ceilingPly);
}

/**
 * Every variation's effective `masteredPlies` — shared-credit-aware, matching
 * what `knownProgressFor` would return for each individually — computed ONCE
 * for the whole repertoire. `deriveChapterLevel` needs this per variation for
 * EVERY tier check, and a caller that derives levels for many chapters in one
 * request (the Levels page, coach student-progress) must not recompute
 * `computeMasteredMoveIds` (an O(repertoire) scan) once per chapter — that
 * would turn an O(n) question into O(chapters × n). Same solved-gets-full-
 * credit branch as `computeMasteredMoveIds` itself, for the same reason: a
 * just-solved variation's own `masteredPlies` counter isn't guaranteed to be
 * caught up in every caller's snapshot, but `solvedKeys` always is.
 */
export function computeMasteredPliesMap(
	variations: Variation[],
	teachingProgress: ReadonlyMap<string, { taughtPlies: number; masteredPlies: number }>,
	solvedKeys: ReadonlySet<string>
): Map<string, number> {
	const masteredMoveIds = computeMasteredMoveIds(variations, teachingProgress, solvedKeys);
	const map = new Map<string, number>();
	for (const v of variations) {
		map.set(v.variationKey, solvedKeys.has(v.variationKey) ? v.path.length : sharedMasteredPrefixLength(v.path, masteredMoveIds));
	}
	return map;
}
```

### `chapterLevels.ts` redefinition

`ScopedVariation` gains a `path` field (every real caller already passes full `Variation` objects with `path`, per `variations.ts` — this widens the declared type to match what's already flowing through, at zero plumbing cost to production call sites; only `chapterLevels.test.ts`'s bare fixtures need updating):

```ts
type ScopedVariation = { variationKey: string; playerMoveCount: number; path: readonly VariationStep[] };

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
		if (!allReached) break;
		achieved = tier;
		if (tier === ceiling) break; // can't exceed the chapter's own longest content — see below
	}
	return achieved;
}
```

The `if (tier === ceiling) break` is load-bearing, not an optimization: without it, a chapter whose tallest variation is Silver-length would trivially satisfy Gold's and Platinum's checks too (nothing left in the chapter for those caps to meaningfully ask about) and `achieved` would over-report tiers the chapter has no content for. This replaces the old design's "vacuous bracket → continue" mechanism with a single terminal clamp — simpler, and it composes correctly with the new "every variation, not just a bracket, is checked at every cap" rule (see Acceptance Criteria).

`isChapterComplete` and `teachingCeilingMoveCount` keep their exact existing shapes, just swapping `solvedKeys: ReadonlySet<string>` for `masteredPlies: ReadonlyMap<string, number>` as their second parameter — no other change. `deriveRepertoireLevel` (pure min-of-already-derived-tiers) needs no change at all; it never touched variation data directly.

### `currentLevelProgress` (new)

```ts
/**
 * How close the repertoire is to its NEXT teaching ceiling — same pooled-
 * repertoire convention as `teachingCeilingMoveCount` (see that function's
 * own doc comment for why pooled, not per-chapter). `ready` counts every
 * variation that has already reached the CURRENT ceiling — genuinely nothing
 * more this tier can ask of it, short-and-solved or long-and-paused alike.
 * Once `ready === total`, the next read of `teachingCeilingMoveCount` reflects
 * the raised ceiling; this is the SAME computation exposed as a fraction
 * instead of a boolean, not a second source of truth.
 */
export function currentLevelProgress(
	allVariations: readonly ScopedVariation[],
	masteredPlies: ReadonlyMap<string, number>
): { tier: Tier; ready: number; total: number } {
	const ceilingMoveCount = teachingCeilingMoveCount(allVariations, masteredPlies);
	const ready = allVariations.filter((v) => hasReachedCeiling(v.path, masteredPlies.get(v.variationKey) ?? 0, ceilingMoveCount)).length;
	// `tierForMoveCount` already falls back to 'platinum' for Infinity (its own
	// loop's final `return`), so no special-casing is needed here.
	return { tier: tierForMoveCount(ceilingMoveCount), ready, total: allVariations.length };
}
```

### Picker: paused vs. locked (`/api/repertoires/[id]/variations/+server.ts`, `VariationPicker.svelte`)

The route already computes `isLockedForTier(...)` per row; it now also computes `isPausedAtCeiling(...)` directly (the same predicate `isLockedForTier`'s own first branch already calls internally — calling it a second time at the row level is O(1), not worth threading through as a return value):

```ts
locked: !solved && isLockedForTier(v.path, masteredPlies, ceilingMoveCount, ceilingReached), // unchanged meaning — still "not currently selectable"
pausedAtCeiling: !solved && isPausedAtCeiling(v.path, masteredPlies, ceilingMoveCount) // new — which REASON, for display only
```

`VariationRow` gains `pausedAtCeiling: boolean`. Disabled/selectable behavior (`disabled={row.locked}`, `ceilingGroupDone`, `pickRepresentative`) is **completely unchanged** — it still reads `locked` exactly as today. Only icon/tooltip selection gains a branch:

```svelte
{#if row.locked}
	{#if row.pausedAtCeiling}
		{@render cornerBadge('⏳', 'text-xs', m.variation_picker_paused_reason())}
	{:else}
		{@render cornerBadge('🔒', 'text-xs', m.variation_picker_locked_reason())}
	{/if}
{:else if row.solved}
	{@render cornerBadge('✓', 'text-green-600 dark:text-green-400 text-sm', m.variation_picker_learned_reason())}
{/if}
```

A ceiling group's own badge (currently just `{#if done}🔒{/if}`) gets the same split, keyed on whether every item in the group is `pausedAtCeiling` vs. any item being locked-but-not-paused. One new message key, `variation_picker_paused_reason` (English draft: "Reached this level's limit here — still counts toward leveling up"), added to `en.json`/`lt.json` alongside the existing `variation_picker_locked_reason`.

### Learn page's new "current level" bar

`/learn/[repertoire_id]/+page.server.ts` already loads `variations`, `solvedKeys`, and `teachingProgress` in one `Promise.all` (needed for the existing `teachingCeilingMoveCount`/`buildPracticeView` calls). It computes `masteredPlies = computeMasteredPliesMap(variations, teachingProgress, solvedKeys)` once and calls `currentLevelProgress(variations, masteredPlies)`, returning the result as a new `currentLevel` field on `data`. `+page.svelte` renders a second progress line directly below the existing `{m.learn_progress_count(...)}` line, reusing whatever tier-name message keys the Levels page already has for Bronze/Silver/Gold/Platinum (confirm exact keys at implementation time rather than guessing here).

### Threading `masteredPlies` through the rest of the call graph

Every existing caller of `deriveChapterLevel`/`isChapterComplete`/`teachingCeilingMoveCount` needs a `masteredPlies` map instead of (or alongside) `solvedKeys`. Risk varies sharply by call site:

**Already cheap — `teachingProgress` is already loaded right before the call:**
- `/api/repertoires/[id]/variations/+server.ts`, `/learn/[repertoire_id]/+page.server.ts`, `/api/practice/select-variation/+server.ts`, and the second (post-attempt) `teachingCeilingMoveCount` call inside `/api/practice/attempt/+server.ts` — each just gains one `computeMasteredPliesMap(...)` call using data it already fetched.
- `scripts/debug-lock-state.ts` — diagnostic only, already has the data, zero production risk.

**New query, but bounded and cold:**
- The Levels page (`practice/[repertoire_id]/mastery/+page.server.ts`) — one new `loadTeachingProgress` call, same cost class as the `loadSolvedKeys` call already sitting next to it. Single player, single repertoire, page-load frequency.
- `coach-progress.ts` — one new `loadTeachingProgress` call per repertoire inside its existing per-repertoire `Promise.all`, bounded to one student's small assigned-repertoire set (this file's own doc comment already establishes that set is small, not roster-wide).
- `repertoire-status-counts.ts` (feeds badge eligibility via `countRepertoireStatuses`) — one new `loadTeachingProgress` call per repertoire, bounded to one player's *already-fully-learned* repertoires by the file's own existing design. Confirmed (via full call-site trace) that every path into this function is single-player, on-demand — no cron job, no bulk/multi-player recompute exists anywhere in the codebase today.

**Needs deliberate sequencing — the hottest path in the app:**
- `/api/practice/attempt/+server.ts`'s *first* `teachingCeilingMoveCount` call (the pre-attempt ceiling check) currently runs before `teachingProgress` is loaded anywhere in that request — the existing load happens later, post-write. Fix: move a `loadTeachingProgress` call earlier, alongside the existing pre-attempt `solvedKeysBeforeThisAttempt` load, so both pre- and post-attempt ceiling checks have their own consistent snapshot. This adds one query to every single practice attempt completion — accepted as necessary, not optimized away, given it's the entire point of the feature.
- `practice-progress.ts`'s `applyAttemptResult` → `cacheCompletedChaptersReached` → `isChapterComplete`: today, `loadTeachingProgress` is only called *conditionally*, inside the not-yet-solved branch, but `cacheCompletedChaptersReached` runs unconditionally at the end regardless of branch. Fix: make the `loadTeachingProgress` call unconditional at the top of `applyAttemptResult`, then locally patch the just-written variation's entry into the resulting map (mirroring the existing local-patch pattern already used for `blockedKeys` in this same function) before computing `computeMasteredPliesMap(...)` and passing it down. This makes one previously-conditional query unconditional on every attempt — the same cost class as the other now-unconditional per-attempt queries in this handler (variations, solvedKeys), not a new category of cost.

### Data Model

No new tables, no new columns, no schema migration. Everything here is derived at read time from `teaching_progress` and `variation_solved`, exactly like both prior tier designs' own stated convention.

### Security & Privacy

Unchanged in kind — all data is the practicing player's own progress, or (for `coach-progress.ts`) a coach's own student's progress, under existing authorization checks. No new PII, no new external integrations, no change to any authorization boundary.

### Testing

- `chapterLevels.test.ts` (existing file, ~25 assertions updated for the new `(variations, masteredPlies)` signature, plus new coverage): the untouched-long-variation-blocks-even-Bronze case (a deliberate behavior change from today — needs an explicit test, not just an implicit one); the chapter-ceiling clamp (a chapter whose tallest content is Silver-length cannot be reported as Gold/Platinum even once every check trivially passes); the pooled-repertoire-wide `teachingCeilingMoveCount`/`currentLevelProgress` boundary values (nothing reached yet → tier bronze, `ready: 0`; everything at 9 reached → ceiling rises to 18).
- `teaching.test.ts` (existing file, extend it): `hasReachedCeiling` — a short variation fully solved returns true; a short variation short of its own end returns false; a long variation exactly at the ceiling returns true; a long variation short of the ceiling returns false. `computeMasteredPliesMap` — matches `knownProgressFor`'s own per-variation result for the same inputs; a solved variation gets full credit even if its own stored `masteredPlies` counter would otherwise say less.
- `VariationPicker.test.ts` (existing file, extend it): a paused-at-ceiling row renders the new icon/tooltip and stays disabled and non-selectable, identically to a locked row's existing behavior; a locked-but-not-paused row keeps today's padlock; a ceiling group of all-paused members shows the paused badge, a group with any genuinely-locked member keeps the padlock.
- `practice-progress.ts` / `/api/practice/attempt` (existing coverage, extend it): the pre-attempt ceiling check now reflects live `teaching_progress`, not a stale/absent read; `cacheCompletedChaptersReached`'s newly-unconditional `teachingProgress` load correctly reflects the just-written attempt (the local-patch, not a second round trip that could race).
- Manual/e2e verification via the existing `npm run qa:verify-learn` and `npm run debug:lock-state` tooling, on a repertoire with a genuine mix of short and long variations sharing prefixes — confirming a long variation reaching the ceiling visibly moves the new Learn-page progress bar, and that the Levels page medal and Learn's teaching ceiling agree with each other afterward.

---

## 4. Risks & Roadmap

### Phased Rollout

- **This design, one pass.** Per explicit user decision: no feature flag, no staged rollout, no pre-emptive data audit comparing old vs. new medal results — ship the recompute directly, verify against real data (the user's own account) before pushing, matching this repo's existing "production is the test environment, no other users yet" convention.

### Technical Risks

- **A medal can visibly shift the moment this ships**, for any player whose `teaching_progress` counters and `variation_solved` rows had ever drifted apart historically (both derived-never-stored, so there is no "before" value to diff against). Accepted risk per explicit user decision — not mitigated with new audit tooling in this pass.
- **The two hot-path call sites in `/api/practice/attempt`** (pre-attempt ceiling check, and `cacheCompletedChaptersReached`'s now-unconditional `teachingProgress` load) are the single most likely place to get sequencing subtly wrong — both need direct test coverage, not just indirect coverage via the picker or Levels page, mirroring the equivalent warning in the tier-gated Learn design about its own `applyAttemptResult` paused-branch.
- **"Vacuous bracket" retirement is a real, larger behavior change**, not just an implementation detail: repertoires with many long variations will now need each one nudged up to the ceiling — not just their short lines solved — before a tier clears. Shared-prefix credit should make this cheap in practice (siblings typically share their first several moves), but this should be watched on a real repertoire with genuinely long, low-overlap lines before assuming it's always painless.
- **Re-litigating the pooled-vs-per-chapter ceiling question** is explicitly out of scope here — that decision (and its own detailed rationale) belongs entirely to the prior tier-gated Learn design and is unaffected by this one; an implementer should not revisit it while making these changes.
