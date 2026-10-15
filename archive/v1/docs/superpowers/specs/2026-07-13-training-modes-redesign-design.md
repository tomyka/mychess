# Training Modes Redesign — Design

## Purpose

Today there are four training modes (Drill, Practice, Time Trial, Master) with overlapping and, in one case, broken purposes: Drill's queue is filtered on `reviews.state === 2`, a flag nothing has written since the old FSRS-based "Learn" mode was deleted (`2026-07-08-repertoire-mastery-levels-design.md`) — its queue is frozen, not actually growing. Time Trial and the old flat Practice both quiz "every move in every repertoire" with only cosmetic differences (timer vs. none). Meanwhile the *existing* Master mode's per-repertoire, depth-leveled mastery mechanic is the most well-designed piece of the four, but it's siloed to one repertoire at a time with no broad/global equivalent.

This collapses the four modes into two with distinct, non-overlapping jobs:
- **Master** — broad, global: any move, from any assigned repertoire, in one shuffled pool. For staying sharp across everything you've learned.
- **Practice** — narrow, structured: one repertoire at a time, learned depth-first in fixed chunks, not letting you move on until the current chunk is solid.

This also **supersedes the ★/✓/✗ portion of `2026-07-13-drill-move-feedback-design.md`** — same feedback mechanic (book move / Stockfish-graded off-book), just retargeted from the now-retired Drill mode onto the new global Master mode described below.

## Scope

- Retired entirely: `/drill`, `/time-trial`, the old flat `/practice`, and the old per-repertoire `/master/[repertoire_id]` mastery-level mechanic (its *concept* moves to the new Practice, described below, under revised rules).
- `NavBar.svelte` and the dashboard's quick actions collapse to two entries: Master, Practice.
- Gamification (XP, streaks, quests, badges) carries over renamed to match the new two-mode split — not redesigned, not enhanced, per the standing decision to deprioritize gamification work in favor of core functionality.

## Data model: `move_progress` replaces the per-variation counter

New table, tracking state **per move edge** rather than per root-to-leaf variation:

```sql
create table public.move_progress (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.profiles(id) on delete cascade,
  move_id uuid not null references public.moves(id) on delete cascade,
  state text not null default 'new' check (state in ('new', 'correct')),
  updated_at timestamptz not null default now(),
  unique(player_id, move_id)
);
alter table public.move_progress enable row level security;
create policy "move_progress_player_all" on public.move_progress
  for all using (player_id = auth.uid());
```

Why per-move instead of per-variation: repertoire lines share prefixes (the `moves` tree already models this — multiple variations can share the same early edges before branching). Tracking state on the edge itself means a shared trunk only ever needs to be learned once; every variation that shares it benefits immediately, instead of re-testing identical opening moves separately per branch as the old `variation_progress.deepest_depth_reached` counter effectively required.

A move starts `'new'`. It flips to `'correct'` the instant it's played correctly, in either mode — this is the one shared state store both Master and Practice read/write, so broad practice in Master also advances a repertoire's structured levels in Practice, and vice versa.

`variation_progress` and `reviews` tables: kept, untouched, simply stop being written to — matches this codebase's established convention (see the same treatment of `reviews` when Learn mode was removed) rather than a destructive migration.

## Practice: per-repertoire, leveled, chunked by 3

Route: `/practice` (list of the player's repertoires with progress) → `/practice/[repertoire_id]` (the leveled practice screen) — reusing the existing per-repertoire list+detail route structure already built for today's Master mode, retuned as described below. Today's flat `/practice` (unfiltered unlevel quiz) is deleted.

- Reuses `src/lib/mastery/variations.ts` (`enumerateVariations`) unchanged — it just walks the `moves` tree into root-to-leaf paths, still needed to know each variation's shape and each move's position within it.
- `src/lib/mastery/levels.ts` is revised: levels are uniform 3-move chunks with no fixed ceiling — **L*n* covers the player's own moves 1 through 3*n*** — rather than the old `{4, 6, 8, 10, ∞}` scheme. A variation shorter than a level's depth is satisfied once its own full length is correct (same collapsing behavior the old design already had, just against the new chunk math).
- `isSatisfied` is redefined against `move_progress` instead of a stored depth number: a variation is satisfied at level *n* when every move in its path up to `min(playerMoveCount, 3n)` has state `'correct'`. A repertoire's current level is the highest *n* where every variation is satisfied; the active level is current + 1, capped at "mastered" once every variation's full length is covered.
- **Auto-play boundary is deterministic**, not the old random-start-point mechanic: at active level *n*, every move up through 3(n-1) is auto-played (book line, both colors) for every variation, and the player picks up interactively at move 3(n-1)+1. E.g., at Level 2, moves 1-3 auto-play and the player starts on move 4 — exactly the worked example given.
- **Grading is instant and per-move, not all-or-nothing per attempt**: each move the player plays in the interactive range is graded and persisted to `move_progress` the moment it's played, whether or not earlier or later moves in the same attempt succeed. A correct move locks in immediately. A wrong move ends that variation's attempt for now (reveal the book move, same reveal-and-continue pattern as the existing feedback flow) and moves on to the next variation still needing work — it does **not** reset any other move's progress, and does not require a full mistake-free pass to eventually promote (confirmed: retries allowed, promotion just needs everything eventually correct).
- A practice session at the active level repeatedly picks a variation with at least one `'new'` move in range until none remain, then the repertoire is promoted to the next level (or "mastered").
- XP: reuses `xpForReview(true, false)` from `src/lib/srs/xp.ts`, awarded once per move that newly transitions `'new'` → `'correct'` (simpler than the old "per newly covered depth" batch — now naturally one grant per move, since state is per-move).

## Master: global pool, any repertoire, any move

Route: `/master` — reuses today's `/drill` page shell (flat single page, chain/streak-based session), since it's already structurally the closest match: a shuffled flat queue with no per-repertoire nesting. Drop the dead `reviews.state === 2` filter entirely — the pool is simply every player-turn move across every repertoire the player owns or is assigned, exactly like today's Time Trial/old-Practice queries (minus the timer/lack-of-timer distinction, both of which are retired).

Feedback — same design as the (superseded) drill-move-feedback spec, retargeted here:
- Played move matches **any** repertoire move at that position (not just whichever one happened to be "due") → **★**, and that specific matched move's `move_progress` flips to `'correct'` (same shared state Practice reads).
- Off-book → neutral "checking…" marker shown instantly, book move revealed immediately (no need to wait on Stockfish for that part), then `$lib/engine/stockfish.ts` + `$lib/engine/classify.ts` (reused unchanged from the Master-mode Stockfish feature) grade the swing: `fine`/`inaccuracy` → **✓** (chain breaks, advances to next), `mistake`/`blunder` → **✗** (chain breaks, board reverts, forced retry of that position until the book move is played, matching the earlier spec's decided behavior).
- `move_progress` is untouched for ✓/✗ outcomes — only an exact book-move match (★) ever writes it.
- If Stockfish is unavailable, classification is skipped and the move falls back to plain wrong-move handling (no ✓/✗ shown) — same silent-fallback convention already established.

## Gamification (renamed, not redesigned)

`api/drill`'s session/XP/streak/quest/badge logic moves to `api/master`, renamed to match (`mode: 'master'` in the `sessions` insert, `master_streak` quest id instead of `drill_streak`, `masterStreak` badge-grant parameter instead of `drillStreak`). No behavioral changes beyond the rename — matches the standing decision to leave gamification as-is while focused on core functionality.

## Out of scope

- Any redesign of gamification mechanics themselves (XP formulas, badge criteria, quest variety) — rename only.
- Dropping the now-fully-dead `reviews` table, or the `variation_progress` table — left in place, unused, per this codebase's established non-destructive convention.
- Piece/board visual changes — separate, already-deferred initiative.
- A settings toggle for engine feedback, or for choosing chunk size in Practice.

## Testing

- `src/lib/mastery/variations.ts`: unchanged, existing tests still apply.
- `src/lib/mastery/levels.ts`: tests updated for the new chunk-of-3 math and the `move_progress`-backed `isSatisfied` (replacing the old numeric-depth tests) — boundary cases at a variation shorter than the current chunk, a shared-prefix move satisfying multiple variations at once, and the "mastered" terminal state.
- New unit tests for the `move_progress` read/derive helpers (e.g. building a `Set<moveId>` of correct moves for a repertoire, computing current/active level from it).
- `classify.ts` / `stockfish.ts`: already fully covered by existing tests, unchanged.
- `/practice/[repertoire_id]` and `/master` page wiring: no existing test files for pages in this codebase's convention — verified manually: level promotion and deterministic auto-play boundary in Practice; ★/✓/✗ and forced retry in Master; the engine-unavailable fallback in Master.
- `npm run check` adds no new type errors beyond the known baseline; full `npm test` run before commit.
