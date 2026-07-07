# Repertoire Mastery Levels — Design

## Purpose

The current "Learn" mode treats every move in every repertoire as an independent flashcard, scheduled by FSRS spaced repetition, blended into one global daily queue across all of a player's repertoires. This doesn't match how a coach actually wants a student to learn a *specific* assigned repertoire: work through it depth-first, in increasing chunks, and don't move on until every branch at the current depth is solid — with a mistake anywhere in a line sending that whole line back for another full attempt, not just the one wrong square.

Investigating the current system before designing its replacement surfaced that it's already effectively broken in production: `/api/review` never persists the FSRS-computed scheduling fields (`due_at`, `stability`, `state`, etc. — only `last_review` is written), so the spaced-repetition math has silently never worked; `total_reviews` and `moves_learned` are never incremented by any live code path, so `review_10`/`review_100`/`moves_learned_*` badges have been unearnable regardless of usage; and the `review_cards`/`new_cards` daily quests can never be completed because Learn never reports quest progress. Replacing this system loses nothing that currently functions.

## Scope decision (confirmed)

- **Replaces Learn mode entirely** — not an addition alongside it. Practice, Time Trial, and Drill are untouched.
- Applies uniformly to any repertoire a player is training, whether self-created or coach-assigned — the mechanic is about *how* you learn a repertoire, not who made it.
- The Stockfish move-quality feedback built for Learn's wrong-answer flow (`src/lib/engine/stockfish.ts`, `src/lib/engine/classify.ts`) carries over into this system's mistake handling.

## Variation enumeration

A repertoire's `moves` rows already form a tree: each row is an edge `(from_position, to_position, san, is_player_turn)`. A **variation** is one complete root-to-leaf path through that tree. Branches — whether the opponent has multiple prepared replies, or the repertoire itself prepares two responses at the same node for the player — each produce a separate variation sharing the common prefix up to the branch point.

A pure, unit-tested module (`src/lib/mastery/variations.ts`) walks the tree and returns one entry per leaf:

```ts
type VariationStep = { moveId: string; san: string; fromFen: string; toFen: string; isPlayerTurn: boolean };
type Variation = { leafMoveId: string; path: VariationStep[]; playerMoveCount: number };

function enumerateVariations(moves: RawMoveRow[]): Variation[]
```

Root positions are found as any position that is never a `to_position` within the repertoire's own moves (in practice, always the standard starting position, but the algorithm doesn't assume that). `leafMoveId` (the id of the path's final move edge) is a stable identifier for the whole path, since a tree has exactly one route from any node back to its root — no need to serialize or hash the full path.

`playerMoveCount` = the count of `isPlayerTurn: true` steps along the path. **Depth**, everywhere in this design, means "the Nth move the player themselves makes in this line" — not overall ply, not standard chess move numbering.

## Progress & levels

Level depths are fixed: **L1 = 4, L2 = 6, L3 = 8, L4 = 10, L5 = ∞ (the rest of the line)**.

One row per `(player, variation)`, keyed by `leaf_move_id`, storing a single number: `deepest_depth_reached` (starts at 0, only ever increases). No per-level rows — levels are a *derived view* over this one number:

- A variation's **target depth at level L** = `min(playerMoveCount, levelDepth(L))`. A naturally 5-move-deep variation has the same target depth (5) at L1 through L5 — once solved, it's done for every level, no re-testing required as levels increase.
- A variation is **satisfied at level L** if `deepest_depth_reached >= targetDepth(variation, L)`.
- The repertoire's **current level** = the highest L (0 if none) where every variation is satisfied at L.
- The **active practicing level** = current level + 1, capped at 5. Once every variation satisfies L5, the repertoire is **fully mastered**.

```ts
// src/lib/mastery/levels.ts (pure, unit-tested)
type Level = 1 | 2 | 3 | 4 | 5;
function levelDepth(level: Level): number; // 4, 6, 8, 10, Infinity
function targetDepth(variation: Variation, level: Level): number; // min(playerMoveCount, levelDepth(level))
function isSatisfied(variation: Variation, level: Level, deepestReached: number): boolean;
function currentLevel(variations: Variation[], progress: Map<string, number>): 0 | Level;
function activeLevel(variations: Variation[], progress: Map<string, number>): Level | 'mastered';
```

## Practice mechanic

For a variation not yet satisfied at the active level (target depth `T` > `deepest_depth_reached`):

1. Pick a random start point `R`, uniformly between `0` and `T − 1` (this is the deliberate "make it random" choice — sometimes a full replay from move 1, usually a shorter tail probe, so deep levels don't always mean tediously replaying the whole line).
2. Auto-play the known book line (both colors) through the player's `R`th own move.
3. The player must then correctly produce **every one of their own remaining moves from `R+1` through `T`**, in sequence, with the book's opponent replies auto-played between each of the player's correct moves.
4. **All correct** → `deepest_depth_reached = max(deepest_depth_reached, T)`, persisted. XP awarded (see below). Move to the next not-yet-satisfied variation at this level.
5. **A mistake anywhere** → nothing is persisted (earlier progress is never erased by a failed attempt). The existing Stockfish quality-feedback flow (Blunder/Mistake/Inaccuracy/Also fine, comparing the played move to the book move) shows before the variation goes back into the pool of "still needs work at this level," to be picked again later — possibly with a different random `R` next time.

A practice **session** for a repertoire, at its active level, repeatedly picks a random not-yet-satisfied variation until none remain, at which point the repertoire levels up (or reaches "fully mastered").

## XP

Reuses the existing `xpForReview(correct: boolean, usedHint: boolean)` from `src/lib/srs/xp.ts` (kept — see Migration below). On a successful attempt, award `xpForReview(true, false)` once per newly-covered move-depth (i.e., if `deepest_depth_reached` moves from 2 to 6, that's 4 moves' worth of XP). No XP on a failed attempt — no partial credit for repeating a failed attempt.

## Navigation

- New `/master` page: lists the player's repertoires (own + coach-assigned) with each one's active level and a progress indicator (e.g. "6 of 9 variations solved at Level 3"). Tapping one goes to `/master/[repertoire_id]`.
- `/master/[repertoire_id]`: the actual practice screen — auto-play, player input, mistake/success handling, as described above.
- Replaces the "Learn" entry in `NavBar.svelte` and the dashboard's Learn-related quick action.

## Data model

New migration:

```sql
create table public.variation_progress (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.profiles(id) on delete cascade,
  repertoire_id uuid not null references public.repertoires(id) on delete cascade,
  leaf_move_id uuid not null references public.moves(id) on delete cascade,
  deepest_depth_reached int not null default 0,
  updated_at timestamptz not null default now(),
  unique(player_id, leaf_move_id)
);
alter table public.variation_progress enable row level security;
create policy "variation_progress_player_all" on public.variation_progress
  for all using (player_id = auth.uid());
```

`repertoire_id` is stored alongside `leaf_move_id` purely as a convenient filter column for the `/master` picker's per-repertoire progress summaries (avoiding a join through `moves` to get there) — it's always derivable from the move but kept denormalized for that one query's sake.

## Migration / cleanup of the old Learn system

Deleted entirely (confirmed safe — see Purpose section on why this code was already non-functional):
- `src/routes/(player)/learn/` (both `+page.server.ts` and `+page.svelte`)
- `src/routes/api/review/+server.ts`
- `src/lib/srs/queue.ts` + `queue.test.ts`
- `src/lib/srs/fsrs.ts` + `fsrs.test.ts`
- The unused `import type { Card }` / `newCard` from `fsrs.ts` in `src/routes/(player)/drill/+page.server.ts` (dead import, confirmed unused in that file today)

Kept, untouched:
- `src/lib/srs/xp.ts` (`levelFromXp` is used dashboard- and coach-view-wide; `xpForReview` is reused by the new system)
- The `reviews` database table and any existing rows in it — no destructive migration, it simply stops being written to
- Practice, Time Trial, Drill modes and their routes
- The `submit_session_result`/`increment_new_cards` RPCs and the `review_cards`/`new_cards` quest templates — these were already dead/unreachable before this change; not touched further, since fixing them is out of scope and unrelated to this feature

## Out of scope

- Fixing the pre-existing dead `total_reviews`/`moves_learned` counters or their dependent badges — a separate, pre-existing issue not caused by or required for this feature.
- Any change to Practice, Time Trial, or Drill modes.
- A hint feature for mastery practice (Learn's Hint button doesn't carry over — not requested).
- Cross-repertoire blending or a "due today across everything" view — mastery is explicitly per-repertoire now.

## Testing

- `src/lib/mastery/variations.ts` (`enumerateVariations`): full unit tests — linear single-path repertoires, branching at an opponent-choice node, branching at a player-choice node, multiple independent roots, depth counting only counting player moves.
- `src/lib/mastery/levels.ts` (`levelDepth`, `targetDepth`, `isSatisfied`, `currentLevel`, `activeLevel`): full unit tests, including the "naturally shorter than the level depth" collapse behavior and the "fully mastered" terminal state.
- The practice-session picking logic (random variation selection, random start point `R`) and the `/master/[repertoire_id]` page itself: not directly unit-tested for the random-selection parts (inherently non-deterministic; will be reviewed by seeding/mocking randomness if a specific bug needs reproducing) — matches this codebase's existing convention of not unit-testing Svelte page components with no prior test file, verified manually instead.
- Server-side wiring (progress persistence, the `/master` picker's per-repertoire summaries): not directly unit-tested, matching the established split between pure logic and thin Supabase I/O wrappers used throughout this codebase.
