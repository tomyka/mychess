# Shared-Prefix Ceiling Deferral — Design

GitHub issue: #172. Follow-up to `docs/superpowers/specs/2026-08-26-tier-gated-learn-design.md` (#163) and `docs/superpowers/specs/2026-08-27-tier-frontier-grouping.md` (#165) — extends, rather than reverses, both: the per-variation ceiling math (`ceilingPlyFor`/`isPausedAtCeiling`) is unchanged, and #165's picker grouping is unaffected. This document adds one new condition under which a variation counts as locked.

## 1. Problem

Reported directly by the user, twice, from real use: a chapter with several continuations sharing almost their entire length (diverging only on the last one or two moves) let Learn front-load ALL of the shared content by teaching any one continuation to the tier ceiling, then separately re-quiz the player on each OTHER continuation's own single divergent final move — one quick quiz per sibling, repeating for as many such continuations as exist. Each such quiz is individually "legal" under the existing design (that move is technically still within *that specific variation's* own per-path move budget), but in aggregate it lets a shared-prefix family unlock more new content in one sitting than the ceiling is meant to allow, and it reads as pointless repetition rather than learning — the user's own words: "on current level a pass should count for all variations as passed."

## 2. Resolution (confirmed with the user)

A sibling variation that would **complete outright** (solve — its own true end lies at or before the ceiling) is still taught in full; finishing it is a genuine, permanent piece of knowledge, not more of the same shared content. Only a sibling that would **merely pause** (its own true end lies beyond the ceiling, same as whatever already reached it) is deferred.

Concretely: once any unsolved variation has genuinely been taught to the ceiling and paused there, every OTHER unsolved variation that (a) would also merely pause at the same ceiling rather than solve, and (b) already carries some shared credit toward it (so it's an actual sibling of whatever paused, not an unrelated fresh line), is deferred to the next tier too — it is not served its own additional, never-before-taught final stretch until the tier advances.

## 3. Implementation

Two new pure functions in `src/lib/mastery/teaching.ts`, both consumed by the same three places `isPausedAtCeiling` already fed:

- `isCeilingReachedAnywhere(variations, solvedKeys, teachingProgress, ceilingMoveCount, masteredMoveIds?)` — true if any currently-unsolved variation has already been taught to the ceiling and is genuinely paused there. Computed ONCE per request (accepts a precomputed `masteredMoveIds` to avoid a second O(n) `computeMasteredMoveIds` scan when a caller — `computeBlockedKeys` — already has one), never once per row.
- `isLockedForTier(path, masteredPlies, ceilingMoveCount, ceilingReached)` — `isPausedAtCeiling(...)` OR (`ceilingReached` AND `path` would merely pause, not solve, at the ceiling AND `path`'s own very next teaching batch (`TEACHING_BATCH_MOVES`, from wherever `masteredPlies` currently stands) would reach or cross the ceiling). See "Why `masteredPlies > 0` is not the sibling test" below — an earlier version of this function used exactly that bare check and was corrected before shipping.

Both were threaded into the same three call sites `isPausedAtCeiling` used directly or via `computeBlockedKeys`:

- `computeBlockedKeys` (`teaching.ts`) — used by `buildPracticeView` (serve time) and `applyAttemptResult` (record time) to decide what to serve/advance to next. Its own SIGNATURE is unchanged, so its three callers (`practice.ts`, `practice-progress.ts`, `+page.server.ts`) needed no changes.
- `POST /api/practice/select-variation` — its own 403 rejection now calls `isLockedForTier` instead of `isPausedAtCeiling` directly, matching what `computeBlockedKeys` would have decided.
- `GET /api/repertoires/[id]/variations` — the picker's `locked` field, same substitution, so a deferred sibling shows as 🔒 locked in the UI exactly like a genuinely-paused one, not left looking selectable.

### Why `masteredPlies > 0` is NOT the sibling test (corrected before shipping)

An earlier version of `isLockedForTier` deferred any unsolved, would-merely-pause variation with `masteredPlies > 0`, reasoning that zero credit meant "no structural relationship to whatever paused." That reasoning doesn't hold: in a same-starting-move repertoire, the very first edge (e.g. "1.e4" from the initial position) is typically ONE shared row in the move graph, reused by every variation in the repertoire — so the instant ANYTHING gets taught at all, `masteredPlies >= 1` becomes true for nearly the WHOLE repertoire via that one shared opening ply, not just genuine siblings of whatever paused. A bare `> 0` check would defer almost everything the moment anything reached the ceiling, silently breaking #163's own "Learn simply serves something else" guarantee for lines that are still genuinely fresh and merely happen to share an opening move.

The corrected condition instead asks: would `path`'s OWN VERY NEXT teaching batch (`TEACHING_BATCH_MOVES`, from wherever `masteredPlies` currently stands) reach or cross the ceiling? This is what actually distinguishes "this line's only remaining content is the last sliver of an already-mostly-taught shared stretch" (defer it) from "this line shares an opening move but still has a normal amount of its own fresh content to teach first" (don't defer it — nothing here has actually consumed the tier's budget yet). It needs no per-sibling pairwise bookkeeping: `plyAfterPlayerMoves` (already used by `ceilingPlyFor` and `resolveTeachingStep`) answers it directly from `path` and `masteredPlies` alone.

### Why this can't reintroduce the "stuck gauntlet" regression (corrected before shipping)

`pickActiveVariation`'s existing fallback — "if everything remaining is solved or blocked, serve the first unsolved one anyway, ignoring blocked status" — was NOT enough on its own, and an earlier version of this design wrongly assumed it was. Before this change, "blocked" always meant genuinely `isPausedAtCeiling` (`masteredPlies >= ceilingPly`), so the fallback selecting one was harmless: `resolveTeachingStep` would immediately see it's already at its own effective length and serve it as a final/paused re-drill of already-known content, asking for nothing new. #172 widens "blocked" to also cover DEFERRED siblings, which are NOT yet at their own ceiling (`masteredPlies < ceilingPly`) and genuinely have fresh content left. If a whole chapter's unsolved pool becomes blocked (one genuinely paused, the rest deferred — exactly the reported "4 continuations" scenario), the fallback can hand back a DEFERRED sibling as `active`, and without a further check, `buildPracticeView` would happily teach it its new final stretch anyway — reopening the exact loophole #172 exists to close, the moment it's reached via this path.

Fixed by clamping the ceiling used at BOTH serve time and record time whenever the variation being served/recorded is itself in `blockedKeys`, regardless of why:

- `buildPracticeView` (`mastery/practice.ts`): if `active.variationKey` is in `blockedKeys`, `resolveTeachingStep` is called with `ceilingPly = effectiveMasteredPlies` (wherever the variation currently stands) instead of the real `ceilingPlyFor(...)` — so it's treated as "already at the ceiling" and served as a final/paused pass, asking for nothing new, exactly like a genuinely-paused variation, regardless of why it was blocked.
- `applyAttemptResult` (`server/practice-progress.ts`): mirrors the same clamp when recording, using a `blockedKeys` computed from the CURRENT (pre-attempt) progress — required by `knownProgressFor`'s own "must agree exactly with what was served" invariant; without it, a clean pass through a fallback-served deferred variation would be recorded as genuine fresh-batch progress, diverging from what was actually served.

The `visited` cycle guard in `advanceIfSolved` is unaffected by any of this — deferral only adds more keys to an already-existing `blockedKeys` set, it doesn't change the traversal itself.

## 4. Non-Goals

- No change to `ceilingPlyFor`, `resolveTeachingStep`, or `advanceTeachingProgress` — how far an already-CHOSEN active variation gets taught in one pass is untouched. This design only changes which variations are eligible to be chosen.
- No per-chapter scoping distinct from the existing pooled (repertoire-wide) ceiling — `isCeilingReachedAnywhere` reads over the same `variations` array its caller already passes to `computeBlockedKeys`, matching #163's own "pooled, not per-chapter" precedent.
- No UI change beyond the picker's existing 🔒 locked treatment (#173/#174/#175) — a deferred row renders identically to a genuinely-paused one; the distinction is not surfaced to the player.

## 5. Testing

- `teaching.test.ts`: `isCeilingReachedAnywhere` — false with nothing taught; true once a long variation is genuinely paused; false if the only "long" variation is merely untouched or itself would solve (not pause) at its own true end.
- `teaching.test.ts`: `isLockedForTier` — a sibling that would merely pause and has partial credit is locked once `ceilingReached`; a sibling that would SOLVE outright (its own true end at/before the ceiling) is NOT locked even with `ceilingReached` true; an untouched (`masteredPlies === 0`) sibling is NOT locked even with `ceilingReached` true; the original `isPausedAtCeiling` case (genuinely paused) is still caught with `ceilingReached` false.
- `teaching.test.ts`: `computeBlockedKeys` — extended with three two-variation scenarios, each pairing the same paused-and-long variation against a different kind of sibling (one that would solve outright, one that would merely pause and is genuinely deferred, one unrelated and untouched), confirming exactly the deferred one gains blocked status once the paused one's progress is recorded.
