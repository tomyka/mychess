# Practice Branch Continuation — Design

## Purpose

`2026-08-07-practice-branch-alternatives-design.md` made the practice quiz accept any of a repertoire's real prepared moves at a branch point, but a branch that didn't land exactly on another task's own target-depth move (a "mid-line" branch — more content still ahead in that line) was deliberately left as a dead end: accepted, no penalty, but the attempt ended immediately and the player was dropped into a fresh, likely-unrelated attempt — visually a jarring "restart."

This design replaces that dead end for the *genuine* mid-line case: instead of ending the attempt, keep walking the specific line the player actually chose, all the way to its own end, crediting it (+1) if solved. A branch that matches a shorter sibling already fully resolved at an earlier level (no content left to walk) still ends cleanly as before — there's nothing to continue there.

## Scope decision (confirmed)

- Recurses to any depth: if the continued line itself branches again, the same three-way check applies again at that point, using the same mechanism — no special-casing for "how many branches deep."
- Continuation data is fetched from a small new endpoint the instant a branch is taken, reusing the existing `splitAttempt` logic rather than duplicating it or pre-computing every possible fork upfront. Accepted tradeoff: a small network pause exactly at branch-taking moments (rare, mostly near the end of lines per earlier discussion) — not on every move. If this proves noticeably laggy in practice, the fallback is pre-shipping continuations with the initial attempt (Approach 2 from the prior design, already scoped, not built here).
- If the continuation fetch fails (network error), fall back to today's dead-end behavior (accept, no credit, end attempt) rather than getting stuck.
- No change to the queue/demotion model itself — completing a continued line credits its own task's existing queue entry, exactly as if that task had been picked directly.

## Data model: three-way alternative classification

Today's `alternatives: { san: string; taskKey: string | null }[]` collapses two different "null" cases into one. Splitting it:

```ts
export type Alternative =
	| { san: string; toFen: string; kind: 'completes'; taskKey: string }
	| { san: string; toFen: string; kind: 'continue'; variationKey: string }
	| { san: string; toFen: string; kind: 'dead-end' };
```

- `'completes'` — this position is exactly some other variation's own target-depth move for the level (unchanged from the prior design). Ends the attempt, credits `taskKey`.
- `'continue'` — some other variation shares this position, still has content left at this level (`hasContentAtLevel`), but hasn't reached its own target-depth move yet. `variationKey` (already a stable, unique identifier on `Variation`) is enough to ask the server to resume that specific line.
- `'dead-end'` — some other variation shares this position but has no content left at this level (already resolved at an earlier level — the bug fixed in `1e38ea8`). Nothing to continue; ends the attempt with no credit, as today.

`toFen` (the resulting board position, needed to keep the board in sync when continuing) is added to all three variants for a uniform shape, even though `'dead-end'` doesn't strictly need it.

**Priority when multiple variations share the same branch SAN:** `completes` beats `continue` beats `dead-end` — if any variation sharing this exact edge would complete a task here, prefer that over a longer, not-yet-boundary line; only fall back to `dead-end` if nothing better exists. (Two variations can only share the exact same `fromFen`+`san` edge if they're walking the identical shared move in the underlying tree — moves and positions are deduped in the DB — so this is picking the best available classification for one real edge, not choosing between materially different moves.)

**`QuizStep` gains a `playerMoveIndex: number` field** — the running player-move count already computed internally in `splitAttempt`'s loop, now exposed on each step. This is what the client sends back when asking the server to resume a `'continue'` branch from that exact point, without needing to separately recompute "how many player moves have happened so far in this attempt" from `prefix` + `quizIdx` bookkeeping.

## New pure function: `continueFromBranch`

In `src/lib/mastery/practice.ts`, alongside `splitAttempt`:

```ts
export function continueFromBranch(
	variations: Variation[],
	level: Level,
	variationKey: string,
	afterPlayerMoveIndex: number
): { quizSteps: QuizStep[]; taskKey: string } | null {
	const variation = variations.find((v) => v.variationKey === variationKey);
	if (!variation) return null;
	const { quizSteps } = splitAttempt(variation.path, level, targetDepth(variation, level), variations);
	const cutIndex = quizSteps.findIndex(
		(s) => s.isPlayerTurn && s.playerMoveIndex === afterPlayerMoveIndex
	);
	if (cutIndex === -1) return null;
	return { quizSteps: quizSteps.slice(cutIndex + 1), taskKey: taskKey(variation, level) };
}
```

Reuses `splitAttempt` in full for the chosen variation (so any further branch along this line already has its own `alternatives` computed the normal way — recursion falls out for free) and just discards the portion up to and including the already-played branch move. `null` covers both "unknown variationKey" and "the branch index isn't actually in this variation's quiz range" — both shouldn't happen with a consistent client, but fail safely rather than crash.

## New endpoint: `POST /api/practice/continue`

Mirrors the existing `/api/practice/attempt` and `/api/practice/mistake` routes (`requireApiUser`, `loadRepertoireVariations` for the ownership check + variation set, then the pure function):

```
POST /api/practice/continue
{ repertoireId, level, variationKey, afterPlayerMoveIndex }
→ { quizSteps, taskKey } | 404 if not found
```

Read-only — doesn't touch `level_progress`. The eventual credit only lands via the *existing* `/api/practice/attempt` call once the continued line is actually solved to its end, exactly like any other attempt completion.

## Client changes (`+page.svelte`)

**State model change:** the in-progress quiz steps become live, extendable client state instead of a value read straight from `data.attempt`. New `$state`:
- `liveQuizSteps: QuizStep[]` — seeded from `attempt.quizSteps` in `resetForAttempt()`, spliced (not replaced) when a continuation arrives.
- `creditTaskKey: string | null` — which task key to report if the attempt is completed; starts as `attempt.taskKey`, reassigned to the continued variation's `taskKey` each time a `'continue'` branch is taken (so completing a twice-continued line credits the *last* line actually walked, not the original pinned one).

All the places that currently read `currentAttempt.quizSteps`/`attempt.quizSteps` during an in-progress attempt switch to reading `liveQuizSteps` instead. `currentAttempt.taskKey` at attempt-completion time becomes `creditTaskKey` — including the existing `if (currentReviewLevel === null) pendingReport = reportAttempt(...)` gate, unchanged: review mode still never reports anything, whether the attempt was ever continued or not. Continuation fetches themselves happen during review too (harmless, read-only, keeps the review experience consistent with normal play) — only the final report at completion is gated.

**`handleMove`'s three-outcome alternative branch becomes four total outcomes:**
1. Pinned match — unchanged.
2. Alternative, `kind: 'completes'` — unchanged from the prior design (star, ends attempt, reports `taskKey`).
3. Alternative, `kind: 'dead-end'` — unchanged from the prior design's old `taskKey: null` case (check, ends attempt, no report).
4. Alternative, `kind: 'continue'` — **new.** Accept with check feedback (not final — there's more to play). Set `boardFen = alt.toFen` and fetch `/api/practice/continue` with `{ repertoireId, level: reviewLevel ?? data.level, variationKey: alt.variationKey, afterPlayerMoveIndex: step.playerMoveIndex }`. On success: splice the response's `quizSteps` into `liveQuizSteps` right after the branch move, set `creditTaskKey` to the response's `taskKey`, auto-play through any leading opponent-turn steps (reusing `advanceThroughOpponentReplies`, now operating on `liveQuizSteps`), unlock the board, and resume play — `phase` never leaves `'playing'`, so there's no "advancing"/restart visual at all, just a brief pause before the next move is askable. On failure (network error, 404): fall back to outcome 3's behavior (dead-end).

**Race safety:** this is the first genuinely `await`-ed network call in the middle of `handleMove` (previous outcomes only ever `setTimeout`, no fetch before deciding the next UI state) — capture `resetToken` at the top of `handleMove` the same way `resetForAttempt`/`nextAttempt` already do, and bail out if it's changed by the time the continuation fetch resolves (the player navigated away/exited review/reset mid-fetch).

## Judgment calls made without further user check-in

- `creditTaskKey` reassignment happens even if the continuation is itself immediately completed with zero further quiz steps (an edge case: the continuation response's `quizSteps` is empty after auto-playing opponent replies) — treated as an immediate attempt completion reporting the new `creditTaskKey`, not a dead end, since the line genuinely was walked to its end.
- The 500ms visual hold before firing the continuation fetch is kept for consistency with every other move outcome (lets the check feedback actually paint before anything else changes) — the fetch is not further overlapped with anything since there's no earlier hold to piggyback on here (unlike the just-shipped attempt-completion timing fix, where the hold already existed for an unrelated reason).
- No loading indicator for the brief continuation-fetch pause — matching this app's existing convention of not adding spinners for sub-second waits (e.g. the plain 500ms holds elsewhere have none either). Revisit only if real-world latency turns out to be worse than expected.

## Out of scope

- Pre-computing/shipping every possible branch's continuation upfront (Approach 2 from the prior design) — not built now; the fallback if round-trip latency proves to be a real problem in practice.
- Any change to the queue/demotion model, `resolveAttempt`, or `resolvePreviousLevelMistake`.
- Hint-square awareness of alternatives (still out of scope from the prior design, unaffected by this one).

## Testing

- `src/lib/mastery/practice.ts` (`alternativesAt`'s new three-way classification, via `splitAttempt`'s existing test surface): cases for `'completes'`, `'continue'`, `'dead-end'`, and the priority rule when multiple variations share one edge with different classifications.
- `continueFromBranch`: unit tests — resumes correctly from a mid-line index, returns `null` for an unknown `variationKey` or an inconsistent `afterPlayerMoveIndex`, and a further-branching continuation still carries its own `alternatives` (proving recursion falls out of reusing `splitAttempt`).
- `+page.svelte`'s new `'continue'` handling: per this repo's established convention, `+page.svelte` interaction logic isn't unit-tested — covered by manual verification instead (same caveat as before: no live Supabase credentials in this environment, so that pass needs to happen once deployed with real branching repertoire data).
