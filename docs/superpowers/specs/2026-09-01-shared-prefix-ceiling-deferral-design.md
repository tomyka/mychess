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
- `isLockedForTier(path, masteredPlies, ceilingMoveCount, ceilingReached)` — `isPausedAtCeiling(...)` OR (`ceilingReached` AND `path` would merely pause, not solve, at the ceiling AND `masteredPlies > 0`, i.e. genuinely a credited sibling, not an untouched line).

Both were threaded into the same three call sites `isPausedAtCeiling` used directly or via `computeBlockedKeys`:

- `computeBlockedKeys` (`teaching.ts`) — used by `buildPracticeView` (serve time) and `applyAttemptResult` (record time) to decide what to serve/advance to next. Its own SIGNATURE is unchanged, so its three callers (`practice.ts`, `practice-progress.ts`, `+page.server.ts`) needed no changes.
- `POST /api/practice/select-variation` — its own 403 rejection now calls `isLockedForTier` instead of `isPausedAtCeiling` directly, matching what `computeBlockedKeys` would have decided.
- `GET /api/repertoires/[id]/variations` — the picker's `locked` field, same substitution, so a deferred sibling shows as 🔒 locked in the UI exactly like a genuinely-paused one, not left looking selectable.

### Why `masteredPlies > 0` is the right "is this a sibling" test

`isCeilingReachedAnywhere`/`isLockedForTier` deliberately do NOT check whether the specific variation that reached the ceiling shares a prefix with the one being evaluated — that would need per-pair prefix bookkeeping this design avoids. Instead, `masteredPlies` (via the existing `knownProgressFor`/shared-credit mechanism) is already exactly "how far this variation's OWN path has been credited via the shared-moveId union across the whole pool." A variation with zero credit has no structural relationship to whatever paused and is left alone — Learn still "simply serves something else," per #163's own explicit guarantee. A variation with SOME credit necessarily shares real moves with something already taught, which in practice is the same family that reached the ceiling (this repertoire's shared prefixes are the deep, structural kind — a whole opening system — not incidental one-move overlaps).

### Why this can't reintroduce the "stuck gauntlet" regression

`pickActiveVariation`/`advanceIfSolved`'s existing fallback — "if everything remaining is solved or blocked, serve the first unsolved one anyway, ignoring blocked status" — is unchanged and already handles the case where deferral leaves nothing else servable in a chapter; it does not distinguish blocked-because-paused from blocked-because-deferred. The `visited` cycle guard in `advanceIfSolved` is also unaffected — deferral only adds more keys to an already-existing `blockedKeys` set, it doesn't change the traversal itself.

## 4. Non-Goals

- No change to `ceilingPlyFor`, `resolveTeachingStep`, or `advanceTeachingProgress` — how far an already-CHOSEN active variation gets taught in one pass is untouched. This design only changes which variations are eligible to be chosen.
- No per-chapter scoping distinct from the existing pooled (repertoire-wide) ceiling — `isCeilingReachedAnywhere` reads over the same `variations` array its caller already passes to `computeBlockedKeys`, matching #163's own "pooled, not per-chapter" precedent.
- No UI change beyond the picker's existing 🔒 locked treatment (#173/#174/#175) — a deferred row renders identically to a genuinely-paused one; the distinction is not surfaced to the player.

## 5. Testing

- `teaching.test.ts`: `isCeilingReachedAnywhere` — false with nothing taught; true once a long variation is genuinely paused; false if the only "long" variation is merely untouched or itself would solve (not pause) at its own true end.
- `teaching.test.ts`: `isLockedForTier` — a sibling that would merely pause and has partial credit is locked once `ceilingReached`; a sibling that would SOLVE outright (its own true end at/before the ceiling) is NOT locked even with `ceilingReached` true; an untouched (`masteredPlies === 0`) sibling is NOT locked even with `ceilingReached` true; the original `isPausedAtCeiling` case (genuinely paused) is still caught with `ceilingReached` false.
- `teaching.test.ts`: `computeBlockedKeys` — extended with a three-sibling scenario (one long-and-paused, one long-and-deferred, one short-and-solvable) confirming exactly the deferred one gains blocked status once the paused one's progress is recorded.
