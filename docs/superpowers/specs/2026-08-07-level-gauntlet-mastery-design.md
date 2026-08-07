# Level Gauntlet & Demotion — Design

## Purpose

Practice's current leveling (`src/lib/mastery/levels.ts`, see `2026-07-08-repertoire-mastery-levels-design.md`) is purely additive and one-directional: a move flips `move_progress.state` to `'correct'` the instant it's ever played right, and stays that way forever — a level is "satisfied" once every player move up to its depth has ever been correct at least once. There's no penalty for a lucky guess, no forgetting, and no way to slip back down once you've limped forward.

This redesign replaces that with a stricter, order-sensitive gauntlet: smaller 2-move chunks, a sliding review window that keeps the previous level's moves live inside the current one, a 3-strikes demotion back a level when that review material keeps getting missed, and a level only counting as mastered once every one of its variations has been cleared with zero mistakes.

## Scope decision (confirmed)

- Replaces Practice's leveling mechanic only. Drill, Time Trial, badges, quests, the dashboard's "mastered repertoires" tile, and the coach player-detail view are all confirmed decoupled from `move_progress`/`levels.ts` (verified by codebase scan) and need no logic changes — only the shared `RepertoireProgress` shape they read must keep meaning what it already means (`level`, `totalLevels`, `levelTaskCount`, `levelSolvedCount`).
- `move_progress` (the per-move-ever-correct table) stops being read/written by Practice. Nothing else in the codebase uses it — Master mode, the only other former consumer, was removed entirely in a prior change. Left in place untouched (not dropped), matching this repo's established non-destructive-migration convention.
- Review mode (replaying an already-passed level, read-only, no progress side effects) is unaffected and keeps its current random-pick behavior.

## Core parameter change

`MOVES_PER_LEVEL`: 3 → 2. `levelDepth(n) = n * 2`. `levelCap = ceil(maxPlayerMoveCount / 2)` (was `/3`). Every level now covers 2 of the player's own moves instead of 3.

## Sliding quiz window

At active level N, the moves a player must actively answer are no longer just level N's own chunk — they also include level N-1's chunk, as a live review. Anything older than that auto-plays (the "PC" plays the book line for both colors) same as before.

- **Auto-play boundary**: `levelDepth(max(N-2, 0))`.
- **Quiz range**: `(levelDepth(max(N-2,0)), targetDepth(variation, N)]`.

Worked example: L1 asks moves 1-2 (nothing auto-played, nothing to review). L2 asks moves 1-4 — all of L1 plus all of L2, nothing auto-played yet. L3 auto-plays moves 1-2 (L1), then asks moves 3-6 (L2 + L3). L4 auto-plays moves 1-4 (L1+L2), asks moves 5-8 (L3+L4). The window is always exactly two levels wide; only its floor moves up.

Each quiz step within that range is tagged with which half of the window it belongs to:

- **`previous` band**: player-move index `i` where `i <= levelDepth(N-1)` (i.e., inside the window but not level N's own new material). Empty at L1.
- **`current` band**: `i > levelDepth(N-1)`, capped by the variation's own `targetDepth`.

This tagging is computed once, server-side, as part of `splitAttempt` (still pure, still unit-tested) — the client never re-derives level math, it just reads `step.band` off each quiz step it's given.

## Why this needs explicit run state, not just a bigger derived set

The old model recomputes everything from a monotonic "ever correct" fact set — fine for a system with no penalties. The new rules are inherently sequential and can't be recovered from a snapshot of history:

- "3 wrong answers on review material" is a *counter that accumulates across attempts* and *resets on level change* — not a fact derivable from "which moves are currently correct."
- "a mistake sends the variation to the **end** of the sequence" implies an actual ordered queue, not a random pick among "not yet satisfied" candidates.
- "mastered only when every variation has zero mistakes" is a fact about a specific **run**, not about all-time history — you can get something wrong, retry it clean later, and still master the level; but the level doesn't count as done while anything is still outstanding.

So leveling moves from "pure function of `move_progress` history" to an explicit, persisted **run** per `(player, repertoire)`: a current level pointer, a live queue of that level's tasks, and a mistake counter — advanced or rolled back by discrete events, not recomputed from scratch each load.

## Data model

New table, additive alongside (not replacing) `move_progress`:

```sql
create table public.level_progress (
  id                 uuid primary key default gen_random_uuid(),
  player_id          uuid not null references public.profiles(id) on delete cascade,
  repertoire_id      uuid not null references public.repertoires(id) on delete cascade,
  level              int not null default 1,
  prev_level_mistakes int not null default 0,
  queue              jsonb not null default '[]'::jsonb,
  updated_at         timestamptz not null default now(),
  unique(player_id, repertoire_id)
);

alter table public.level_progress enable row level security;
create policy "level_progress_player_all" on public.level_progress
  for all using (player_id = auth.uid());
revoke all on public.level_progress from anon, public;
```

`queue` is an ordered JSON array, one entry per dedup'd task at the current level (same dedup rule `levelTaskVariations` already applies — two variations sharing an identical prefix through the level's depth are one task): `{ key: string, status: 'pending' | 'cleared' }[]`. `key` is the task's dedup key (`levelPrefixKey` — the move id the shared prefix ends on), the same stable identifier the existing level logic already uses.

No row exists yet the first time a player opens a repertoire — the server lazily creates one (`level: 1`, a freshly shuffled all-`pending` queue built from `levelTaskVariations(variations, 1)`) instead of requiring a migration backfill.

## Attempt lifecycle

1. **Pick**: the next attempt is the first `pending`-status entry in `queue`, in array order (a real FIFO-with-requeue sequence now, not a random pick — this is what makes "goes to the end of the sequence" meaningful).
2. **Play**: client plays through `prefix` (auto-play) then `quizSteps` (interactive), same board mechanics as today. It locally tracks, for this attempt only: `hadMistake` (any wrong move, either band) and `prevLevelMistakeCount` (wrong moves specifically on `band: 'previous'` steps).
3. **Report**: on completing all `quizSteps`, one POST reports the attempt's outcome (see API below) — replacing the old per-correct-move POST. Nothing is persisted for an attempt abandoned mid-way (navigating away); the queue is untouched and the same task is served again next time.
4. **Resolve** (server, one transaction):
   - `prev_level_mistakes += reported prevLevelMistakeCount`.
   - If `prev_level_mistakes >= 3` (and level > 1): **demote**. `level -= 1`, `prev_level_mistakes = 0`, queue replaced with a fresh shuffled all-`pending` set for the new (lower) level. The in-progress run at the level just left is discarded — re-entering it later starts over clean, matching "needs to be mastered again."
   - Else: mark this attempt's task `cleared` if `hadMistake` was false; otherwise leave it `pending` and move its entry to the end of the queue array.
   - If every entry in `queue` is now `cleared` (including the vacuous empty-queue case): **level up**. `level += 1` (or the repertoire becomes `'mastered'` if that exceeds `levelCap`), `prev_level_mistakes = 0`, fresh shuffled queue for the new level.

The 3-strikes counter only ever tracks `previous`-band mistakes — a mistake on the level's own new (`current`-band) material still dirties that attempt's task (back of the queue) but never contributes to demotion. There's nothing to demote below L1 (no `previous` band exists there, so the counter can never move).

## API changes

- `src/routes/api/practice/move-progress/+server.ts` is replaced by `src/routes/api/practice/attempt/+server.ts` (`POST { repertoireId, level, taskKey, hadMistake, prevLevelMistakeCount }`) implementing the Resolve step above via a new `src/lib/server/level-progress.ts`. Old per-move endpoint and `markMoveCorrect` are deleted — nothing else calls them post-Master-mode-removal.
- `src/routes/(player)/practice/[repertoire_id]/+page.server.ts`: stops reading `move_progress`/building `correctMoveIds`; instead loads (or lazily creates) the `level_progress` row, reconciles its queue against freshly-enumerated variations (see Content drift below), and picks the front `pending` entry as the attempt.
- `src/lib/mastery/moveProgress.ts` (`repertoireProgress`) is rebuilt on top of `level_progress` rows instead of `move_progress` rows: `level` = the row's `level` (or `'mastered'`), `levelTaskCount`/`levelSolvedCount` = queue length / count of `cleared` entries. Its public shape (`RepertoireProgress`) is unchanged, so the five downstream UI consumers (practice picker, practice detail screen, `LevelList`, dashboard tile) need no changes.

## Content drift (repertoire edited after a run started)

On each load, the freshly-enumerated task list for the active level is reconciled against the stored queue: task keys present in the fresh enumeration but missing from the queue are appended as new `pending` entries; queue entries whose key no longer appears in the fresh enumeration are dropped. If this reconciliation leaves the queue fully `cleared` (including newly-empty), the level-up step runs immediately before serving the next attempt, same as after a normal attempt. This is basic best-effort handling for an edge case (a coach editing a repertoire mid-training), not exhaustively tested against every possible edit shape — consistent with this codebase's existing convention of not over-testing rare content-mutation edges.

## Judgment calls made without further user check-in

- Every wrong move submission counts as one mistake toward whichever counter applies — no dedup per quiz position (matches the existing `wrongCount` UI counter's own behavior, which already increments per click).
- Initial queue order is shuffled once per fresh run (level-up, demotion, or first-ever creation); all later reordering is the deterministic "mistake → back of queue" rule, not reshuffled.
- Demotion discards the departing level's queue entirely rather than trying to preserve any partial progress in it.

## Out of scope

- Any change to Drill, Time Trial, badges, quests, or `move_progress` itself beyond Practice no longer writing to it.
- Backfilling `level_progress` for players with existing `move_progress` history — they simply start a fresh L1 run under the new mechanic (no attempt to reconstruct "where they were" under the old permanent-memory model, which has no equivalent under the new one).
- A UI affordance explaining *why* a demotion happened (e.g. "3 mistakes on Level 2 material") beyond the existing level-up-style banner pattern — copy/UX for the demotion notice is an implementation detail, not a design decision.

## Testing

- `src/lib/mastery/levels.ts`: existing tests updated for `MOVES_PER_LEVEL = 2`; add cases for the new sliding-window helpers (auto-play boundary at `levelDepth(max(N-2,0))`, band classification).
- `src/lib/mastery/practice.ts` (`splitAttempt`): tests for the two-level-wide window and per-step `band` tagging, including the L1 (no previous band) and L2 (previous band but no auto-play) edge cases.
- New `src/lib/server/level-progress.ts` (or wherever the Resolve transition lives, if kept as pure logic + thin I/O per this codebase's convention): the resolve step (mark-cleared, requeue, demote, level-up, including the ">= 3" threshold and the all-cleared level-up check) should be a pure, unit-tested function taking `(currentRow, attemptResult) -> newRow`, with the Supabase read/write around it left untested per the existing pure-logic/I/O split.
- `src/lib/mastery/moveProgress.ts` (`repertoireProgress`): existing tests reworked against `level_progress`-shaped input instead of `move_progress` rows.
- Queue reconciliation (content drift): a couple of targeted unit tests (key added, key removed, removal causing an immediate level-up) rather than exhaustive coverage, matching the Out of scope note above.
