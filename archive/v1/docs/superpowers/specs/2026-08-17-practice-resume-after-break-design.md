# Practice: Reset Auto-Play After a Break — Design Spec

**Date:** 2026-08-17
**Status:** Approved for planning
**Scope:** The Practice training flow's auto-play-through-mastered-prefix behavior only.

## Problem

Practice auto-plays through opening plies it believes are already mastered (`attempt.autoPlayThrough`
in `mastery/practice.ts`, animated client-side in `+page.svelte`'s `resetForAttempt()`/`autoPlayStep()`),
so the player only has to find the moves they haven't yet mastered. This is a genuine time-saver while
actively drilling, but a player who steps away and comes back to an advanced/deep variation finds it
disorienting: their own memory of the "already mastered" opening has faded too, and the app blasts
through it in ~2 seconds before handing them a cold, unaided move from the middle of the line.

User-facing ask: after an interruption, the first attempt on a variation should start from the
beginning — no auto-play — even though that variation's stored progress says otherwise. Later
attempts in the same sitting should behave exactly as before.

## Goals

- Detect "this variation hasn't been attempted in a while" per (player, variation).
- On that first qualifying attempt, serve it as if nothing were mastered yet (no auto-play, teaching
  arrows/batch restart from the beginning) — without altering the player's actually-stored progress.
- The very next attempt (assuming no further gap) returns to normal auto-play behavior.

## Non-goals

- No new database table or migration column.
- No change to the already-solved re-drill path (picking an already-solved variation via the picker
  already always plays out in full, unaffected by any of this).
- No per-repertoire tracking — this is per-variation, matching "I came back to *this* advanced
  variation" rather than "I haven't touched this repertoire at all."
- No change to teaching-arrow *hints* as a concept — arrows are recomputed as a side effect of
  restarting the served attempt from ply 0, not specially handled.

## Break threshold

10 minutes since the variation's last attempt (success or failure), chosen by the user over
alternatives like "a few hours" or "a full day" — short interruptions (a phone call, switching to
another task) already feel disorienting on a deep line, not just multi-hour/overnight gaps.

## Data & write path

`variation_teaching_progress.updated_at` already exists (migration `0046`) but is never actually
refreshed: `saveTeachingProgress()`'s upsert omits it from the payload entirely, and no trigger
refreshes it on `UPDATE`. It currently reflects row-*creation* time only.

A new function, `touchVariationAttempt(supabase, playerId, repertoireId, variationKey)` in
`src/lib/server/practice-progress.ts`, upserts `{ player_id, repertoire_id, variation_key,
updated_at: <now> }` (`onConflict: 'player_id,variation_key_hash'`, mirroring `saveTeachingProgress`'s
existing conflict target). Omitting `taught_plies`/`mastered_plies` from the payload means an
`UPDATE` only touches `updated_at`, leaving real counters untouched; an `INSERT` (first-ever attempt
on this variation) gets the table's own `0`/`0` defaults for those columns, which is behaviorally
identical to "no row exists yet" everywhere else in the codebase (`loadTeachingProgress()`'s
consumers already default a missing entry to `{ taughtPlies: 0, masteredPlies: 0 }`).

This is called **unconditionally** — regardless of `hadMistake` — from
`src/routes/api/practice/attempt/+server.ts`, added as a third entry in the existing `Promise.all`
alongside `applyAttemptResult` and `incrementQuestProgress`. It is a deliberately separate call, not
folded into `applyAttemptResult`: that function's early-return-on-mistake is a documented, relied-upon
invariant ("a mistaken attempt is always a no-op — no reads, no writes"), and this change must not
weaken it. `touchVariationAttempt` is the *only* thing that unconditionally fires on every attempt.

## Read path & the override decision

`loadTeachingProgress()` (`practice-progress.ts`) selects one more column, `updated_at`, and its
returned `Map`'s value type grows from `{ taughtPlies, masteredPlies }` to
`{ taughtPlies, masteredPlies, updatedAt: string | null }`. This is structurally compatible with
existing consumers (`computeMasteredMoveIds`, `sharedMasteredPrefixLength` in `teaching.ts`) that only
read `taughtPlies`/`masteredPlies` — TypeScript's structural typing allows passing the wider map
wherever the narrower shape is expected, so those functions need no signature change.

`buildPracticeView()` (`mastery/practice.ts`) gains a `now: Date = new Date()` parameter (last
position, after the existing `forceAttempt: boolean = false` — same testable-clock convention as
`runFideImport(url, key, now: Date = new Date())`). Inside the not-yet-solved branch, after computing
`effectiveMasteredPlies`/`effectiveTaughtPlies` as today (own progress vs. shared-sibling floor), a new
check:

```ts
const RESUME_GAP_MS = 10 * 60 * 1000;

function wasResumedAfterBreak(updatedAt: string | null, now: Date): boolean {
  if (updatedAt == null) return false; // never attempted — nothing to "resume", already 0/0
  return now.getTime() - new Date(updatedAt).getTime() > RESUME_GAP_MS;
}
```

If `wasResumedAfterBreak(progress.updatedAt, now)` is true, both `effectiveMasteredPlies` and
`effectiveTaughtPlies` are forced to `0` for *this served attempt only*, before `resolveTeachingStep`
runs — so the returned path, arrows, and `autoPlayThrough` all reflect a variation with zero progress,
exactly like the player's first-ever attempt on it. Nothing is written back; the player's real
`taught_plies`/`mastered_plies` in the database are never touched by this check. The already-solved
branch is untouched (it already always sets `autoPlayThrough: 0` unconditionally).

## Why the check runs in two places, but the write in one

`buildPracticeView()` is called both by `+page.server.ts`'s `load()` (page open/reload) and by
`/api/practice/attempt/+server.ts` (after each submitted attempt, to build the next one to serve).
Both call sites already load `teachingProgress` and call `buildPracticeView()` today — passing `now`
through requires no new plumbing, only the added parameter.

The check must run in both places because a session doesn't always reload the page: a player can
leave a tab open, step away for 20 minutes, and return to make a move without ever hitting `load()`
again — only the attempt endpoint's own response (serving the *next* attempt) would have a chance to
catch that gap. Page load never writes the touch (`load()` is read-only); only a *submitted* attempt
counts as "engagement," via the endpoint's `touchVariationAttempt` call. This also avoids a
double-suppression bug: if page load itself refreshed the timestamp merely by rendering, the endpoint's
very next read would already see a fresh timestamp and never detect the gap it was supposed to.

## Worked example

1. Player attempts variation V at 10:00. `touchVariationAttempt` sets `updated_at = 10:00`.
2. Player closes the tab, returns at 10:25 (25 min later) and reloads the page.
3. `load()` reads `updated_at = 10:00`; `now = 10:25`; gap = 25 min > 10 min → `buildPracticeView`
   serves V with `autoPlayThrough: 0`, full path, teaching restarted from ply 0.
4. Player plays the full variation (mistake or not) and submits. The endpoint's
   `touchVariationAttempt` sets `updated_at = 10:25` (regardless of outcome).
5. The endpoint's own `buildPracticeView` call for the *next* attempt reads the just-refreshed
   `updated_at = 10:25`; gap = 0 → normal auto-play resumes (assuming the underlying counters, per
   step 4's actual outcome, still credit mastered plies).

## Testing

- `mastery/practice.test.ts`: `buildPracticeView` with `updatedAt` fresh (no override), stale
  (>10 min → override to 0/0 for that attempt), and `null` (never attempted → no override needed,
  naturally already 0/0). Confirm the already-solved branch is unaffected regardless of `updatedAt`.
- `server/practice-progress.test.ts`: `touchVariationAttempt` upserts only `updated_at`, leaving an
  existing row's `taught_plies`/`mastered_plies` unchanged; creates a fresh `0`/`0` row (plus
  `updated_at`) when none existed.
- No new test needed for the "two call sites" wiring itself — both already have test/manual coverage
  for `buildPracticeView`'s other parameters; this only adds one more input to the same function.

## Error handling

No new failure modes: `touchVariationAttempt` is a plain upsert with the same error-swallowing
posture as the sibling `saveTeachingProgress`/`markVariationSolved` calls it sits alongside (all
fire-and-forget within the endpoint's `Promise.all`, consistent with existing code in this file).
