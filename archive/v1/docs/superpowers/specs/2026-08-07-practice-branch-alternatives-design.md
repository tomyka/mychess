# Practice Branch Alternatives — Design

## Purpose

A repertoire can legitimately prepare more than one reply at the same position (e.g. two good tries against a rare sideline). `enumerateVariations` already treats this as two separate variations sharing a common prefix — correct for progress tracking (each needs to be individually mastered), but wrong for grading a live attempt. Today, `splitAttempt` picks exactly one variation's path per attempt, and `handleMove` accepts only that path's own `san` at each step. If the player answers with the *other* prepared move — equally correct, per their own repertoire — it's marked wrong purely because the system privately committed to testing the sibling task first. The player has no way to know, from the board alone, which of their two memorized options is "the" answer for this particular attempt.

This design makes any of the repertoire's real prepared moves at a position acceptable, crediting whichever task the played move actually belongs to, instead of only the one that happened to be queued.

## Scope decision (confirmed)

- Branches are matched by board position (`fromFen`), not by path prefix — positions are already deduped by FEN in the DB, so this is transposition-safe for free and needs no new data.
- A branch that lands exactly on some task's own target-depth move (for the active level) is fully credited to that task, same as solving it normally end-to-end.
- A branch that occurs earlier in a longer line (not itself any task's target-depth move) is accepted as a correct move — never a mistake, never a demotion — but ends the attempt right there rather than trying to continue down a live, uncommitted line. No task is credited; nothing is lost either. Confirmed acceptable: these mid-line branches are expected to be rare (players mostly branch near the end of a line), and the alternative (dynamically re-deriving the rest of the attempt down whichever branch was actually played) is a materially bigger rewrite for a rare case.
- Review mode (read-only, no progress side effects) accepts alternatives the same way for correct visual feedback, but — as today — never reports anything to the server.
- No change to `resolveAttempt`, `resolvePreviousLevelMistake`, or the queue/demotion model. Both tasks in a branch pair are already separate `level_progress` queue entries (each is its own dedup'd task from `levelTaskVariations`); this design only changes *which* task key gets reported for a given attempt, never the persistence rules themselves.

## Core mechanism: per-step alternatives

`splitAttempt` (`src/lib/mastery/practice.ts`) already iterates the picked variation's path, tracking `playerMovesSeen` as it tags each step's `band`. Extended to take the full `variations: Variation[]` for the level (available at both call sites — `pickQueuedAttempt`/`pickReviewAttempt` already receive it) and, for each `isPlayerTurn` step, scan every variation for another path step at the same running player-move index whose `fromFen` matches this step's `fromFen` and whose `san` differs from the canonical one. (Same player-move index is guaranteed to mean the same shared prefix — two paths can't reach an identical `fromFen` after a different number of player moves without transposing through a different move count, which `enumerateVariations`'s own graph already treats as a distinct edge, not a match here.)

For each alternative found, resolve whether taking it completes another task: does the owning variation's own `targetDepth(variation, level)`'th player move land exactly here? If so, attach that variation's `taskKey(variation, level)`; otherwise attach `null` (a valid book move, but not a task boundary at this level).

```ts
export type QuizStep = VariationStep & {
	band: 'previous' | 'current';
	// Other moves the repertoire allows from this exact board position
	// (matched by fromFen). taskKey is set when playing that alternative
	// completes a distinct task at this level; null when it's a valid book
	// move that isn't any task's target-depth move by itself. Empty for
	// non-player-turn steps.
	alternatives: { san: string; taskKey: string | null }[];
};
```

This is a pure function change — no new data fetched, no new DB columns. `variations` is already fully in memory wherever `splitAttempt` is called.

## Client behavior (`handleMove`)

Three outcomes replace today's two:

1. **Matches the pinned step's `san`** — unchanged.
2. **Matches an alternative with a `taskKey`** — treated exactly like solving the attempt's own final move (`'final'`, star feedback), but the completion report uses that alternative's `taskKey` instead of `currentAttempt.taskKey`. `hadMistake` in that report is still this attempt's own accumulated `attemptHadMistake` (any earlier wrong tries before reaching the branch count against whichever task ends up credited, same as today). The originally-queued task is left untouched (still `pending` in the queue — served again another time).
3. **Matches an alternative with `taskKey: null`** — accepted with normal correct-move feedback (check, `playCorrect()`), never counted as a mistake or reported toward `previous`-band demotion, but the attempt ends immediately: no more quiz steps are played out, and nothing is reported to the server (no attempt-complete POST, no task credited). The player proceeds straight to a fresh `nextAttempt()`.
4. **Matches neither** — unchanged (wrong-move feedback, existing mistake/demotion handling).

Case 3 skips the `reportAttempt`/`pendingReport` path entirely, so `nextAttempt()`'s level-before/level-after comparison runs against an unchanged `level_progress` row — behaves like the player simply closed out an attempt with no side effects, which is exactly what happened.

## What doesn't change

- Server-side queue/demotion logic (`resolveAttempt`, `resolvePreviousLevelMistake`) — no changes. Crediting "the other" task's key is already a normal, valid queue entry; `applyAttemptResult` already no-ops safely on an unrecognized key, but this path never produces one.
- No new API endpoints, no new DB columns/migrations.
- Hint behavior (highlights the pinned move's origin square after 3 wrong tries) is unchanged — see Out of scope.

## Judgment calls made without further user check-in

- Alternatives are computed fresh every `splitAttempt` call (no caching) — the variation set is already small (one repertoire's worth) and this runs once per attempt, server-side, not per move.
- A branch match is by `san` equality at the matched `fromFen`, same equality rule `handleMove` already uses for the canonical move — no new SAN-normalization logic introduced.
- Case 3's "attempt ends here" applies even if the branch happens to occur on the very last scripted quiz step anyway (in which case it behaves identically to today, just routed through the new check first) — no special-casing needed for "was this already going to be the last step."

## Out of scope

- Live re-derivation of the remaining attempt down whichever branch was actually played (Approach 2 considered and rejected — see prior discussion). Mid-line branches simply end the attempt cleanly instead.
- Hint-square awareness of alternatives — the hint still only ever points at the pinned move's own origin square. Accepted gap: a player relying on the hint after repeated wrong tries wasn't going to find the alternate that way regardless, and a player who already knows the alternate doesn't rack up wrong tries in the first place.
- Any change to how `levelTaskVariations` dedups tasks, or to `buildQueue`/`reconcileQueue` — both sibling tasks already exist as independent queue entries today; this design only changes attempt-time grading and reporting.

## Testing

- `src/lib/mastery/practice.ts` (`splitAttempt`): new cases for alternative computation — a branch landing on another task's target-depth move (has `taskKey`), a branch mid-line that isn't any task's boundary (`taskKey: null`), a position with no branch (`alternatives: []`), and a transposition case (two variations reaching the same `fromFen` via different move counts, which must NOT match).
- `src/routes/(player)/practice/[repertoire_id]/practice.test.ts` (or wherever `handleMove`'s logic is most directly testable) — covers the three new outcome branches in the component's move-handling, if that logic is unit-testable independent of the Svelte component; otherwise covered by manual verification per this repo's existing convention for `+page.svelte` logic.
