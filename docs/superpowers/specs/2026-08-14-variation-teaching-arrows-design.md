# Variation teaching arrows

GitHub issue: [tomyka/mychess#60](https://github.com/tomyka/mychess/issues/60)

> **Amendment 1 (post-ship):** the original version of this spec had the first 5 moves (10 plies) of every variation never arrow-taught at all, reasoning that a player who picked the variation from the picker had already seen them in its label preview. That free-zone/skip was removed: the very first batch (moves 1–5) is now taught with arrows just like every later one, so a fresh variation is taught from its first move.
>
> **Amendment 2 (post-ship):** batches were originally a flat `FIRST_MOVES_GROUP_PLIES` (10) ply offset regardless of whose move that landed on. For a variation where the player moves first, a 10-ply batch ends on the OPPONENT's reply, not the player's own move — and since the practice page only checks "was that the attempt's final move" at the moment the player themselves moves, that check never fired, so the attempt silently completed without ever reporting its outcome to the server: progress never persisted, and the same batch re-taught forever. Batches are now defined by a move count (`TEACHING_BATCH_MOVES = 5`, player moves only) and always end right after the batch's Nth player move — 9 plies if the player moves first, 10 if the opponent does, never landing on an opponent reply.
>
> **Amendment 3 (post-ship):** a teach pass used to make the player manually replay every earlier, already-mastered batch by hand (blind) before reaching the new one — tedious for a deep variation. The practice page now auto-plays already-mastered leading plies on load (see `+page.svelte`'s `autoPlayStep`), landing the player right at the start of the batch actually needing their input. Originally this applied only to teach passes (a blind-retest still required full manual replay); **Amendment 4 below extends it to blind retests too.**
>
> **Amendment 4 (post-ship):** progress was tracked entirely per VARIATION, so two variations sharing the same first 5 moves (a repertoire branching at move 6, say) were taught completely independently — mastering one taught the other nothing, forcing the player through the identical opening moves again for every sibling. Teaching progress is now effectively per-MOVE, shared across every variation that happens to use it: `computeMasteredMoveIds` derives every moveId already mastered anywhere in the repertoire (every move of a fully-solved variation, plus each unsolved variation's own `masteredPlies`-long prefix), and `sharedMasteredPrefixLength` turns that into "how much of THIS variation is already covered" — which can be MORE than this variation's own stored `masteredPlies` if a sibling got there first. That shared floor now auto-plays in EVERY attempt, teach or blind-retest alike (see `PracticeView.attempt.autoPlayThrough`, which `+page.svelte` reads instead of `arrowPlies.from`) — a move mastered once, by any variation, is never manually replayed again by any other. `applyAttemptResult` applies the identical floor before calling `advanceTeachingProgress`, so what the server records always matches what it actually served.
>
> **Amendment 5 (post-ship, [issue #68](https://github.com/tomyka/mychess/issues/68)):** two things about the teach→retest hand-off read as a bug in practice. (a) Nothing on screen marked it: a clean teach pass silently snapped the board back to the start and asked for the same moves again, which players reported as "it makes 5 moves and restarts". The "no UI indicating you're in a teaching pass" non-goal below is therefore **partially revisited**: there's still no persistent teaching banner or within-variation progress indicator, but the TRANSITION now has one — a `'transition'` phase in `+page.svelte` holds the finished pass on screen for `CUE_HOLD_MS` behind a "Nice — now play it from memory" `role="status"` cue, which then lingers over the freshly reset board rather than vanishing with it. Only a clean, non-final teach pass raises it: a final pass solves the variation instead of re-asking, and a pass with a mistake re-serves the identical teach pass (arrows and all), so neither is the thing the cue describes. (b) The LAST batch's blind retest was redundant: a teach batch reaching the path's end already auto-plays the same mastered prefix and asks for the same manual tail as the retest that followed it — only the arrows differed. `resolveTeachingStep` now reports such a batch as `isFinalPass`, so a clean run of it solves the variation outright. An 8-move variation (split 5+3) takes 3 clean attempts instead of 4; a 13-move one takes 5 instead of 6. The `masteredPlies > 0` guard keeps the one case where the retest isn't redundant: a variation whose FIRST batch covers its whole path would otherwise be marked solved having never once been played without arrows, so it still earns exactly one blind retest.
>
> This document has been updated in place to describe the current, shipped behavior.

## Problem

Practice mode currently quizzes a variation's entire path blind from the very first attempt: a player picking (or being sequenced into) a variation they've never seen has no way to learn its moves except by guessing, failing, and eventually stumbling onto the book line — there's no notion of "first exposure" versus "review." The only existing assistance is the 3-wrong-attempts-triggered origin-square hint (`hintSquare` in `ChessBoard.svelte`), which only ever appears after repeated failure, not on introduction.

Issue #60 asks for a Chessbook-style guided-then-tested move introduction: show the correct move on first exposure, then test it blind afterward. This spec scopes a version of that for the variation-picker/depth-progress architecture already shipped (`2026-08-13-mastery-per-variation-practice-redesign-prd.md`): teach a variation's moves in fixed-size batches, deepest-first, with a full blind replay required between batches.

## Goals

- A variation is taught in fixed `TEACHING_BATCH_MOVES` (5-move) batches, starting with its very first batch — moves 1–5 are taught via arrows on a fresh variation's first attempt, exactly like every later batch. A batch's ply width isn't fixed (9 or 10, depending on whose move comes first) — what's fixed is that it always ends right after the batch's 5th player move.
- Each batch is taught once, via a yellow arrow on each new ply's correct move, then confirmed via one clean blind replay from the very start of the variation before the next batch is introduced.
- The player always plays every move themselves — an arrow reveals the destination, it never auto-plays the move.
- A mistake during a blind replay is just a retry of that same blind replay; it never re-triggers teaching for moves already taught.
- The existing "one clean full replay marks the variation solved" mechanic (`variation_solved`, `applyAttemptResult`) is preserved exactly as-is once a variation reaches its final batch — this feature only changes what happens on the way there.

## Non-goals

- **No change to `variation_solved`'s meaning or the repertoire-wide "M of N solved" count.** A variation only counts as solved once it's been cleanly replayed start-to-leaf at full depth, exactly as today.
- **No change to the 3-wrong-attempts origin-square hint.** It continues to exist independently, including during a taught or blind-retest pass.
- **No re-teaching of already-solved variations.** A variation already in `variation_solved` — including ones solved before this feature ships — is always served at full depth with no arrows, regardless of what (if anything) is in its teaching-progress row.
- **No new UI chrome indicating "you're in a teaching pass."** The arrow itself is the only signal; no banner, label, or progress-within-the-variation indicator is added. **(Partially revisited by Amendment 5:** still no persistent teaching indicator, but the teach→blind-retest hand-off itself now gets a transient cue, because the unexplained reset read as a bug.**)**
- **No per-alternative teaching.** If a repertoire preps multiple replies at one position (see #29), this feature doesn't change how those are surfaced — it only decides whether the single path being played shows arrows.

## Architecture: batch depth as two ply-counters, resolved fresh on every serve

Two approaches were considered:

1. **(Chosen) Two persisted counters per `(player, variation)`: `taught_plies` and `mastered_plies`.** A pure function derives, from these two counters plus the variation's own path length, exactly what the next attempt should look like: how much of the path to serve, and whether any ply range gets an arrow. Nothing about "which phase we're in" is stored directly — it's always recomputed from the two counters, the same way `pickActiveVariation` already recomputes the active variation from stored state rather than trusting a cached phase.
2. **(Rejected) Store an explicit phase enum (`teaching` / `retesting` / `done`) plus a batch index.** More fields for the same information — `taught_plies`/`mastered_plies` already imply the phase (see below), and deriving it keeps the persisted state minimal and self-healing the same way the rest of this architecture already relies on (`practice_active_variation`, `variation_solved`) — a corrupted or stale phase enum could disagree with the counters, while a derived phase never can.

### Deriving the current step

Given a variation's full `path: VariationStep[]` and its two counters (`taughtPlies`, `masteredPlies`, both starting at 0 for a fresh variation — a missing row is treated identically to `{0, 0}`, so no backfill migration is needed for pre-existing variations; see Edge Cases):

- **`masteredPlies >= path.length`:** every batch is mastered. Serve the full `path`, no arrow. This is a normal attempt exactly as today, and a clean replay marks the variation solved exactly as today.
- **`taughtPlies === masteredPlies` (and `masteredPlies < path.length`):** the next batch hasn't been taught yet — including the very first batch on a fresh variation, where both counters are `0`. Target depth = the ply index right after the batch's `TEACHING_BATCH_MOVES`-th (5th) player-turn ply found at or after `masteredPlies` (or `path.length`, if the path runs out before finding that many) — see `plyAfterPlayerMoves` below; this is NOT a flat ply-count offset, since the batch must always end on the player's own move. Serve `path.slice(0, target)`, with an arrow on every ply in `[masteredPlies, target)` — the whole new batch, every ply, every time this pass is shown. A clean replay advances `taught_plies` to `target`; `mastered_plies` is untouched. A mistake changes nothing (the same teach pass is re-served next attempt). **(Amendment 5)** The exception: when `target` reaches `path.length` AND `masteredPlies > 0`, this batch is the LAST one and the blind retest that would follow it is the identical pass minus the arrows — it's reported as `isFinalPass`, and a clean replay masters the whole path and solves the variation directly.
- **`taughtPlies > masteredPlies`:** the just-taught batch needs one clean blind replay before it counts. Serve `path.slice(0, taughtPlies)`, no arrow. A clean replay advances `mastered_plies` to `taughtPlies` (and, if `taughtPlies >= path.length`, this attempt was the real full-depth attempt — marks the variation solved exactly as today). A mistake changes nothing — this exact blind pass is re-served next attempt, per Goals.

This is a small number of states because "teach" and "blind-retest" alternate one-for-one per batch, and the pass that completes the whole path *is* the ordinary full-variation attempt — no separate "fully taught" concept is needed on top of `variation_solved`. (Per Amendment 5, that completing pass is the final batch's own TEACH pass, not a separate retest of it — except for a variation whose first batch is also its last, where it's still the retest.)

### Already-solved variations bypass this entirely

`variation_solved` is checked before any of the above: if the active variation's key is already in the player's solved set, it's served at full depth with no arrow unconditionally, and the teaching-progress row (if any) is never read. This is what makes re-drilling a solved variation via the picker behave exactly as it does today, and what makes a variation solved before this feature shipped never retroactively grow arrows.

## Data model changes

### New table: `variation_teaching_progress`

```sql
create table public.variation_teaching_progress (
  id             uuid primary key default gen_random_uuid(),
  player_id      uuid not null references public.profiles(id) on delete cascade,
  repertoire_id  uuid not null references public.repertoires(id) on delete cascade,
  variation_key  text not null,
  taught_plies   integer not null default 0,
  mastered_plies integer not null default 0,
  updated_at     timestamptz not null default now(),
  unique (player_id, variation_key)
);

create index variation_teaching_progress_player_repertoire_idx
  on public.variation_teaching_progress (player_id, repertoire_id);

alter table public.variation_teaching_progress enable row level security;

create policy "variation_teaching_progress_player_all" on public.variation_teaching_progress
  for all using (player_id = auth.uid());

create policy variation_teaching_progress_coach_read on public.variation_teaching_progress for select using (
  exists (
    select 1 from public.coach_players cp
    where cp.player_id = variation_teaching_progress.player_id
      and cp.coach_id = auth.uid()
      and cp.status = 'active'
  )
);

revoke all on public.variation_teaching_progress from anon, public;
```

Mirrors `variation_solved`'s exact shape and RLS pattern (migration `0045_remove_leveling_add_solved.sql`). No row means "nothing taught or mastered yet" — identical to a row with both counters at `0`, so the app never needs to distinguish the two.

### New pure-logic module: `src/lib/mastery/teaching.ts`

```ts
import type { VariationStep } from './variations';

export const TEACHING_BATCH_MOVES = 5;

export type TeachingStep = {
	path: VariationStep[];
	arrowPlies: { from: number; to: number } | null;
	isFinalPass: boolean;
};

// The ply index right after the `moveCount`-th player-turn ply at or after
// `fromPly` — i.e. where a batch of `moveCount` player moves ends. NOT a
// fixed ply-count offset: a batch always ends on the PLAYER's own move
// (never an opponent reply), so its ply width varies with whose move
// `fromPly` lands on. See Amendment 2 above for why this matters.
function plyAfterPlayerMoves(path: VariationStep[], fromPly: number, moveCount: number): number {
	let seen = 0;
	for (let i = fromPly; i < path.length; i++) {
		if (path[i].isPlayerTurn) {
			seen++;
			if (seen >= moveCount) return i + 1;
		}
	}
	return path.length;
}

export function resolveTeachingStep(
	path: VariationStep[],
	taughtPlies: number,
	masteredPlies: number
): TeachingStep {
	if (masteredPlies >= path.length) {
		return { path, arrowPlies: null, isFinalPass: true };
	}
	if (taughtPlies === masteredPlies) {
		const target = plyAfterPlayerMoves(path, masteredPlies, TEACHING_BATCH_MOVES);
		// (Amendment 5) A last batch — one reaching the path's end with an
		// already-mastered prefix behind it — is itself the final pass; the
		// blind retest that used to follow it was the identical pass minus
		// the arrows. `masteredPlies > 0` keeps a variation whose FIRST batch
		// covers its whole path from being solved having never been played
		// blind at all.
		const isFinalPass = target >= path.length && masteredPlies > 0;
		return { path: path.slice(0, target), arrowPlies: { from: masteredPlies, to: target }, isFinalPass };
	}
	return { path: path.slice(0, taughtPlies), arrowPlies: null, isFinalPass: taughtPlies >= path.length };
}

export function advanceTeachingProgress(
	path: VariationStep[],
	taughtPlies: number,
	masteredPlies: number,
	hadMistake: boolean
): { taughtPlies: number; masteredPlies: number; solved: boolean } {
	const step = resolveTeachingStep(path, taughtPlies, masteredPlies);
	if (hadMistake) {
		return { taughtPlies, masteredPlies, solved: false };
	}
	// (Amendment 5) `&& !step.isFinalPass`: a FINAL teach pass owes no blind
	// retest, so it falls through and masters/solves what it just taught.
	if (step.arrowPlies && !step.isFinalPass) {
		return { taughtPlies: step.arrowPlies.to, masteredPlies, solved: false };
	}
	return { taughtPlies: Math.max(taughtPlies, step.path.length), masteredPlies: step.path.length, solved: step.isFinalPass };
}

// (Amendment 4) Every moveId already mastered ANYWHERE in the repertoire —
// every move of a fully-solved variation, plus each unsolved variation's own
// masteredPlies-long prefix. Two variations that share moves (the same
// moveId — a shared opening, or a transposition) both draw on this same set.
export function computeMasteredMoveIds(
	variations: Variation[],
	teachingProgress: ReadonlyMap<string, { taughtPlies: number; masteredPlies: number }>,
	solvedKeys: ReadonlySet<string>
): Set<string> {
	const mastered = new Set<string>();
	for (const variation of variations) {
		if (solvedKeys.has(variation.variationKey)) {
			for (const step of variation.path) mastered.add(step.moveId);
			continue;
		}
		const progress = teachingProgress.get(variation.variationKey);
		if (!progress) continue;
		for (let i = 0; i < progress.masteredPlies && i < variation.path.length; i++) {
			mastered.add(variation.path[i].moveId);
		}
	}
	return mastered;
}

// (Amendment 4) How many of `path`'s LEADING plies are already covered by
// `masteredMoveIds` — stops at the first ply whose moveId isn't in the set,
// even if a later ply happens to be mastered too (a gap breaks the prefix).
export function sharedMasteredPrefixLength(path: VariationStep[], masteredMoveIds: ReadonlySet<string>): number {
	let i = 0;
	while (i < path.length && masteredMoveIds.has(path[i].moveId)) i++;
	return i;
}
```

`resolveTeachingStep` is used when serving an attempt (read path); `advanceTeachingProgress` is used when recording its outcome (write path) — it re-derives the same step the player was actually just served (deterministically, from the same stored counters) rather than trusting anything the client reports, matching how `hadMistake` is already the only client-reported fact about an attempt today. `computeMasteredMoveIds`/`sharedMasteredPrefixLength` don't participate in that read/write pair directly — both `buildPracticeView` and `applyAttemptResult` call them FIRST, to compute a `taughtPlies`/`masteredPlies` floor (via `Math.max`) before handing off to `resolveTeachingStep`/`advanceTeachingProgress` — see Server-side changes below.

## Server-side changes

### `src/lib/server/practice-progress.ts`

Two new functions, mirroring `loadSolvedKeys`'s existing per-repertoire shape:

- `loadTeachingProgress(supabase, playerId, repertoireId): Promise<Map<string, { taughtPlies: number; masteredPlies: number }>>` — one `select` filtered by `player_id`/`repertoire_id`, keyed by `variation_key`.
- `saveTeachingProgress(supabase, playerId, repertoireId, variationKey, taughtPlies, masteredPlies): Promise<void>` — upsert on `(player_id, variation_key)`.

`applyAttemptResult` changes to: look up the attempted variation's `path` from the `variations` array it's already given; if the variation is not already solved, load the FULL per-repertoire teaching-progress map (needed for `computeMasteredMoveIds`, not just this one variation's own row), compute the shared-mastery floor (`Math.max` against this variation's own stored counters — see Amendment 4), call `advanceTeachingProgress` with the FLOORED values, and persist the result via `saveTeachingProgress`. Only when that call reports `solved: true` does it fall through to the existing `markVariationSolved` + `advanceIfSolved` + `setActiveVariationKey` sequence, unchanged. If the variation is already solved (re-drill), or isn't found in `variations` (defensive), behavior is exactly as it is today — `hadMistake` alone gates `markVariationSolved`. Using the SAME floor computation as `buildPracticeView` (below) is load-bearing: if they ever disagreed, the server could record progress against a different step than the one it actually served.

### `src/lib/mastery/practice.ts`

`PracticeView.attempt` gains three fields:

```ts
attempt: {
	path: VariationStep[];
	variationKey: string;
	arrowPlies: { from: number; to: number } | null;
	isFinalPass: boolean;
	autoPlayThrough: number; // see Amendment 4 — 0 for an already-solved re-drill
} | null;
```

`buildPracticeView` gains a new parameter, `teachingProgress: ReadonlyMap<string, { taughtPlies: number; masteredPlies: number }>`, inserted before the existing `forceAttempt` parameter. After picking the active variation: if it's already solved (or `forceAttempt` re-drilling a solved one), it's served at full depth with `arrowPlies: null, isFinalPass: true, autoPlayThrough: 0`, exactly as today (a deliberate re-drill is played in full, nothing auto-played). Otherwise, `computeMasteredMoveIds(variations, teachingProgress, solvedKeys)` plus `sharedMasteredPrefixLength(active.path, ...)` produce a shared floor; `effectiveMasteredPlies = Math.max(progress.masteredPlies, sharedFloor)` and `effectiveTaughtPlies = Math.max(progress.taughtPlies, effectiveMasteredPlies)` feed `resolveTeachingStep`, and `autoPlayThrough` is set to `effectiveMasteredPlies`.

### Call sites

`/api/practice/attempt`, `/api/practice/select-variation`, and the practice detail page's `+page.server.ts` load function each call `buildPracticeView` today — each needs to additionally `loadTeachingProgress(...)` alongside its existing `loadSolvedKeys(...)` call and thread the result through.

### `PracticeView.solved`'s optimistic client-side bump

`optimisticSolvedAfterAttempt` (`src/lib/mastery/practice.ts`) currently bumps the sidebar count on any clean attempt. With teaching batches, a clean teach or intermediate blind-retest pass must NOT bump it — only a clean pass where the server would report `solved: true`. The `+page.svelte` call site gates the existing bump on `attempt.isFinalPass` in addition to `!attemptHadMistake`.

## Client-side changes

### `ChessBoard.svelte`

New prop: `arrowMove?: { from: Key; to: Key } | null`. A new shape-building function alongside the existing `feedbackShapes()` returns `[{ orig: arrowMove.from, dest: arrowMove.to, brush: 'yellow' }]` when set (chessground's native arrow rendering via `orig`+`dest`, the same mechanism already available and already imported — no new dependency). `buildConfig()`'s `drawable.autoShapes` becomes the concatenation of the arrow shape and `feedbackShapes()`; the `$effect` that re-applies config on prop changes already re-runs `buildConfig()`, so it picks up `arrowMove` changes for free once it's a tracked prop. The post-move `cg.set({ drawable: { autoShapes: feedbackShapes() } })` calls inside the `movable.events.after` handler are unchanged — they intentionally show only the check/cross/star badge for the hold, replacing the arrow rather than showing both.

### `+page.svelte`

A new derived value, following the same pattern as the existing `hintSquare`:

```ts
const arrowMove = $derived.by(() => {
	const range = attempt?.arrowPlies;
	if (!range || quizIdx < range.from || quizIdx >= range.to) return null;
	const step = quizSteps[quizIdx];
	if (!step || !step.isPlayerTurn) return null;
	try {
		const move = new Chess(step.fromFen).move(step.san);
		return move ? { from: move.from as Key, to: move.to as Key } : null;
	} catch {
		return null;
	}
});
```

Passed to `<ChessBoard ... {arrowMove} />`.

**Autoplay intro (Amendments 3 & 4).** `resetForAttempt()` reads `attempt.autoPlayThrough` as the autoplay target (NOT `arrowPlies.from` — see Amendment 4: the two agree for a teach pass, but only `autoPlayThrough` is populated for a blind retest too). If it's `0` (an already-solved re-drill, or nothing shared/mastered yet applies), behavior is unchanged from before: `advanceThroughOpponentReplies()` just skips any leading opponent-only plies, same as always. If it's greater than `0`, a new `phase: 'autoplay'` locks the board (same as the existing `'advancing'` phase — no move prompt, not interactable) and `autoPlayStep` advances `quizIdx` one ply at a time, on a `setTimeout` loop (`AUTO_PLAY_STEP_MS`), until it reaches the target — then flips `phase` back to `'playing'` and calls `advanceThroughOpponentReplies()` as usual (the ply right at the target is typically the opponent's reply following whatever player move ended the previous batch). A `resetToken` guard (the same pattern `nextAttempt()` already uses) aborts a stale autoplay chain if a new attempt starts mid-sequence.

## Edge cases

- **Variations with fewer than `TEACHING_BATCH_MOVES` (5) player moves:** taught as a single batch on the first attempt (arrows on every ply), then need one clean blind replay before they're solved — a short variation is never a special case, it just has only one batch (`plyAfterPlayerMoves` falls back to `path.length` once it runs out of player moves to count).
- **A batch's ply width depends on whose move comes first:** a batch always ends right after the player's own move, never an opponent reply — see Amendment 2. Both parities (player-first, opponent-first) are covered by dedicated tests in `teaching.test.ts`.
- **Already-solved variations (including pre-feature ones):** bypassed unconditionally by the `solvedKeys` check in `buildPracticeView`, before `teachingProgress` is even consulted — see Architecture. No migration backfill of `variation_teaching_progress` is needed.
- **Manually re-picking an unsolved, partially-taught variation via the picker:** `variation_teaching_progress` is keyed only by `(player, variation_key)`, independent of which variation is "active" — picking it resumes its stored `taught_plies`/`mastered_plies` exactly where they were left, whether that variation was reached automatically or manually.
- **A mistake during a teach pass:** `advanceTeachingProgress` leaves both counters unchanged on `hadMistake`, so the identical teach pass (same arrow range) is re-served next attempt — the player isn't asked to blind-guess a batch that was interrupted mid-teaching.
- **A mistake during a blind-retest (including the final pass):** same mechanism — counters unchanged, the same blind-retest is re-served, matching the confirmed "just retry, no re-teaching" behavior.
- **(Amendment 4) Sibling variations sharing a prefix:** a fresh variation whose leading moves were already mastered via a DIFFERENT variation (or via this same variation's own earlier progress) is credited immediately — its served `taughtPlies`/`masteredPlies` floor to the shared amount, so it only ever teaches/tests its own genuinely-new content, and `autoPlayThrough` covers the shared part in every attempt, teach or blind-retest. A variation that transposes ENTIRELY into already-mastered content (rare) would serve with `autoPlayThrough >= path.length`, requiring no manual input at all — not specially handled, just a natural consequence of the same floor.

## Testing

- Pure-logic tests (`src/lib/mastery/teaching.test.ts`) for `resolveTeachingStep` and `advanceTeachingProgress`: the very first batch on a fresh variation (both player-first and opponent-first parity, asserting the served path's last ply is always the player's own move), a mid-batch teach pass, a clean teach pass advancing `taught_plies` only, a clean blind-retest advancing `masteredPlies` only, a mistake leaving both counters untouched in both phases, the final batch's blind-retest reporting `isFinalPass`/`solved: true`, and a variation shorter than one batch requiring its own teach-then-blind-retest cycle before solving.
- `practice.test.ts`: `buildPracticeView` tests extended with a `teachingProgress` map — an untaught variation gets the right truncated path + arrow range, an already-solved variation ignores a stale/partial `teachingProgress` entry entirely, and existing tests are updated to pass an empty map.
- `practice-progress.test.ts` (server-side, fake-supabase style already used there): `applyAttemptResult` tests for each of the three transitions (teach→taught, blind-retest→mastered, final→solved) confirming `variation_solved`/`practice_active_variation` are untouched until the final transition.
- Component test (`ChessBoard.test.ts`): `arrowMove` renders a chessground arrow shape (`orig`+`dest`) when set, and clears when `null`.
- `practice.test.ts` (route-level, `@testing-library/svelte` + `vi.useFakeTimers()`/`advanceTimersByTimeAsync`): a teach-pass attempt with `autoPlayThrough > 0` doesn't prompt for a move while autoplay is running, and does once autoplay reaches the taught batch; a blind-retest attempt (`arrowPlies: null`) with `autoPlayThrough > 0` behaves the same way — autoplay isn't gated on `arrowPlies`.
- (Amendment 4) `teaching.test.ts`: `sharedMasteredPrefixLength` stops at the first unmastered ply (a later mastered one past a gap doesn't extend it) and covers the whole/none/all cases; `computeMasteredMoveIds` credits every move of a fully-solved variation, only the mastered prefix of an unsolved one, nothing for a variation with no progress, and unions correctly across several variations.
- (Amendment 4) `practice.test.ts`: a fresh sibling variation sharing a prefix already solved via another variation is served with the floored counters (teaching only its own new content) and the correct `autoPlayThrough`; the same credit applies to that sibling's own blind retest; an already-solved variation's own re-drill gets `autoPlayThrough: 0`.
- (Amendment 4) `practice-progress.test.ts`: `applyAttemptResult` records progress against the SAME floored counters `buildPracticeView` would have served, for a fresh sibling variation crediting a solved one's shared prefix.
- (Amendment 5) `teaching.test.ts`: a `cleanRunToSolved` driver runs the real `resolveTeachingStep`/`advanceTeachingProgress` pair over a whole variation and asserts both the number of clean attempts to reach solved and the teach/blind sequence — 8 moves in 3 attempts (`teach, blind, teach`) for both parities, 13 moves in 5 (`teach, blind, teach, blind, teach`), and a one-batch variation still in 2 (`teach, blind`).
- (Amendment 5) `practice.test.ts` (route-level): playing out a clean teach pass raises the cue while the page is still in `'transition'` (i.e. before the reset), keeps it up once the next attempt has loaded, and drops it afterwards; a final pass and a mistaken pass raise nothing. Chessground is mocked in that file purely as an input harness — jsdom can't produce the trusted pointer events its `drag.start` requires — and `playMove` invokes the very `movable.events.after` config `ChessBoard` handed it, so everything above the third-party board is exercised for real.
- Manual end-to-end verification: practice a fresh variation, confirm an arrow for each move 1–5 on first exposure, a blind (arrow-free) full replay required afterward, and — for a variation longer than 10 plies — the same teach/retest cycle repeating for moves 6–10, 11–15 (with moves 1–10 auto-playing before each new batch's arrows begin), and so on. Also confirm: starting a sibling variation that shares an already-mastered prefix with a previously-learned variation auto-plays that shared part immediately (teach and blind-retest alike), teaching/testing only the new, divergent content.
