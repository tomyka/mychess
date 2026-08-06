# Level Visibility & XP Removal — Design

## Purpose

Practice mode (`src/lib/mastery/levels.ts`, `moveProgress.ts`, `practice.ts`) already tracks a per-repertoire "level" — Level *N* covers the player's own moves 1 through 3*N* across a repertoire's variation tree — but only ever surfaces the single *active* level. A player can't see how many levels a repertoire has, which ones they've already passed, or go back and re-drill an earlier level once they've moved past it.

Separately, the app has a global XP→level system (`profiles.xp`/`profiles.level`, `src/lib/srs/xp.ts`) left over from the old Learn/session-based flow. It's almost entirely inert today: the dashboard computes a level/XP breakdown it never renders, `XpBar.svelte` and `LeaderboardPodium.svelte` are unused, and the weekly leaderboard query is built server-side but never read by any page. The only *live* XP surfaces are a "+X XP" toast during Practice/Drill/Time Trial and three badges (`level_3/5/10`) gated on it.

This feature makes per-repertoire levels visible and revisitable, and removes XP everywhere in favor of evaluating players purely by repertoire progression ("Level *X* of *Y*", and a count of fully mastered repertoires).

## Scope decision (confirmed)

- "Levels" means the existing per-repertoire mastery levels — no new tier/rank concept.
- Level list lives on the practice detail page (`practice/[repertoire_id]`), not the picker.
- Revisiting a passed level is pure read-only review: it never touches `move_progress`, so progress can only move forward.
- XP removal is total: every awarding path (Practice, Drill, Time Trial, quests), every display, the three XP-gated badges, and the underlying DB columns/RPCs.

## Level list & visibility

`repertoireProgress()` (`src/lib/mastery/moveProgress.ts`) gains a `totalLevels` field — the existing internal "cap" (`Math.ceil(maxPlayerMoveCount(variations) / 3)`) computed in `levels.ts`, extracted into an exported `levelCap(variations)` and used by both `currentLevel`/`activeLevel` (refactored to call it) and `repertoireProgress`.

On `practice/[repertoire_id]/+page.svelte`, a new level list renders rows `1..totalLevels`, plus a trailing "Mastered" row once applicable:

- **Passed** — `level < data.level` (or every row, if `data.level === 'mastered'`). Rendered active/clickable.
- **Current** — `level === data.level`. Highlighted; this is what's already being trained by default.
- **Locked** — `level > data.level`. Rendered inactive, not clickable.

Clicking a passed row navigates to `?level=N`.

## Level tags

Each level also gets a difficulty tag — Beginner/Regular/Advanced/Expert — derived purely from its position and the repertoire's `totalLevels`. Tier sizes grow in a fixed order as `totalLevels` increases (Regular appears at 4, Regular grows at 5, Beginner grows at 6, Advanced grows at 7, Expert absorbs any overflow at 8+):

| totalLevels | Beginner | Regular | Advanced | Expert |
|---|---|---|---|---|
| 1 | 1 | – | – | – |
| 2 | 1 | – | 1 | – |
| 3 | 1 | – | 1 | 1 |
| 4 | 1 | 1 | 1 | 1 |
| 5 | 1 | 2 | 1 | 1 |
| 6 | 2 | 2 | 1 | 1 |
| 7 | 2 | 2 | 2 | 1 |
| 8+ | 2 | 2 | 2 | rest |

A new pure module, `src/lib/mastery/tags.ts`:

```ts
export type LevelTag = 'Beginner' | 'Regular' | 'Advanced' | 'Expert';

// [Beginner, Regular, Advanced, Expert] level counts, for totalLevels 1..7.
const TIER_SIZES: Record<number, [number, number, number, number]> = {
  1: [1, 0, 0, 0],
  2: [1, 0, 1, 0],
  3: [1, 0, 1, 1],
  4: [1, 1, 1, 1],
  5: [1, 2, 1, 1],
  6: [2, 2, 1, 1],
  7: [2, 2, 2, 1]
};

function tierSizes(totalLevels: number): [number, number, number, number] {
  if (totalLevels <= 0) return [0, 0, 0, 0];
  if (totalLevels <= 7) return TIER_SIZES[totalLevels];
  const [b, r, a] = TIER_SIZES[7];
  return [b, r, a, totalLevels - (b + r + a)]; // Expert absorbs everything beyond 7
}

export function levelTag(level: Level, totalLevels: number): LevelTag {
  const [b, r, a] = tierSizes(totalLevels);
  if (level <= b) return 'Beginner';
  if (level <= b + r) return 'Regular';
  if (level <= b + r + a) return 'Advanced';
  return 'Expert';
}
```

A hardcoded lookup for `totalLevels` 1..7 rather than a closed-form formula — the tier growth order isn't a clean function of position, and this table is small, finite, and directly matches the confirmed spec.

A "mastered" repertoire's tag is `levelTag(totalLevels, totalLevels)` — the tag of its topmost level (Expert, except for repertoires shallow enough to top out at Beginner or Advanced per the table above).

**Display:** each row in the level list (see above) shows its own tag next to the level number (e.g. "Level 3 · Regular"). The picker and detail-page summary labels also gain the *current* level's tag: `"Level {level} of {totalLevels} · {tag}"` (mastered rows show `"🏆 Mastered · {tag}"`).

## Review mode (training a passed level)

`practice/[repertoire_id]/+page.server.ts` reads `url.searchParams.get('level')`. If present, parses to an integer and validates `1 <= N < data.level` (or `1 <= N <= totalLevels` when mastered) — a request for the active or a locked level is silently ignored and the page falls back to normal training. This means URL tampering to peek at a locked level just does nothing, rather than erroring.

For a valid review level, a new `pickReviewAttempt(variations, level, random)` in `src/lib/mastery/practice.ts` picks a random variation with quiz content at that level:

```ts
function pickReviewAttempt(
  variations: Variation[],
  level: Level,
  random: () => number = Math.random
): PracticeAttempt | null {
  const candidates = variations.filter((v) => v.playerMoveCount > levelDepth(level - 1));
  if (candidates.length === 0) return null;
  const chosen = candidates[Math.floor(random() * candidates.length)];
  return { variation: chosen, targetDepth: targetDepth(chosen, level) };
}
```

Unlike `pickPracticeAttempt`, it doesn't filter by `isSatisfied` — every variation is already satisfied at a passed level, so the filter would exclude everything. It still uses `splitAttempt` to get the prefix/quiz split, identically to normal training.

The client (`+page.svelte`) tracks a `reviewLevel` from page data and, when set:
- Shows a "Reviewing Level N" banner with an "Exit review" link back to the plain `/practice/[repertoire_id]` URL.
- Skips the `POST /api/practice/move-progress` call entirely on a correct move — review is a pure quiz replay with no persistence, so there's no state to protect against regression.
- On solving an attempt, serves another random review attempt at the same level (`invalidateAll()` + `resetForAttempt()`) rather than running the level-up comparison used by normal training.

## Label changes

- `practice/+page.svelte` picker row: `"Level {rep.level} · {satisfied}/{total} solved"` → `"Level {rep.level} of {rep.totalLevels} · {tag} · {satisfied}/{total} solved"`.
- `practice/[repertoire_id]/+page.svelte` sidebar summary: same "Level *X* of *Y* · *Tag*" format.

## Dashboard aggregate

`src/routes/(player)/+page.server.ts` computes one new stat, the same way the practice picker already computes per-repertoire progress: for each accessible repertoire (own + assigned), run `repertoireProgress`, and count how many report `level === 'mastered'`. Rendered as a small new card near `StatsRow` — "🏆 *X* of *Y* repertoires mastered" — additive, `StatsRow`'s streak display is untouched.

## XP removal

**Deleted entirely:**
- `src/lib/srs/xp.ts` + `xp.test.ts`
- `src/lib/components/XpBar.svelte` (already unused)
- `src/lib/components/LeaderboardPodium.svelte` (already unused)

**Edited — strip XP awarding/display, keep everything else about the file:**
- `src/routes/api/practice/move-progress/+server.ts` — drop `xpForReview` import and the `update_xp_and_level` RPC call; endpoint just calls `markMoveCorrect` and returns.
- `src/routes/(player)/practice/[repertoire_id]/+page.svelte` — remove `sessionXp` state and the "+X XP" header span; `submitMoveProgress` no longer reads an `xpAwarded` field.
- `src/routes/api/drill/+server.ts`, `src/routes/api/time-trial/+server.ts` — drop `xp_earned` inserts and `update_xp_and_level`/`update_weekly_leaderboard` RPC calls.
- `src/routes/(player)/drill/+page.svelte`, `src/routes/(player)/time-trial/+page.svelte` — remove "+X XP" UI text.
- `src/routes/api/quests/progress/+server.ts` — drop `update_xp_and_level`/`update_weekly_leaderboard` calls.
- `src/lib/quests/generate.ts` (+ `generate.test.ts`) — drop `xpReward` from quest templates; `+page.server.ts`'s quest-seeding insert drops the `xp_reward` column.
- `src/routes/(player)/+page.server.ts` — drop `levelFromXp` import/usage and the `total_xp`/`xp_in_level`/`xp_to_next` stats fields; drop the dead `weekly_leaderboard` query and `leaderboard`/`lbEntries` building.
- `src/lib/badges/grant.ts` — drop the `profiles.xp`/`level` fetch, the `update_xp_and_level` call, and `xp_reward` from the badge-grant payload.
- `src/lib/badges/recalc.ts` (+ tests) — remove `level_3`/`level_5`/`level_10` from the badge rule table; `BadgeStats` drops its `level` field.
- `src/routes/(player)/badges/+page.svelte` — remove `badge.xp_reward` display.
- `src/routes/(coach)/coach/players/[player_id]/+page.server.ts` (+ its `+page.svelte`) — remove `levelFromXp`/`total_xp` usage and the `weekly_xp_goal` form field/display.

**Database migration** (`supabase/migrations/0027_remove_xp.sql`, written here and handed to the user to run manually per this repo's convention — no local Postgres access):

```sql
-- Drop XP-dependent functions first (no live callers remain once
-- Practice/Drill/Time Trial/quests stop calling them; submit_session_result
-- and sync_player_stats were already dead — only ever defined, never called).
drop function if exists public.update_xp_and_level(uuid, integer);
drop function if exists public.update_weekly_leaderboard(uuid, integer);
drop function if exists public.submit_session_result(uuid, jsonb);
drop function if exists public.sync_player_stats(uuid);

drop table if exists public.weekly_leaderboard;

alter table public.profiles
  drop column if exists xp,
  drop column if exists level,
  drop column if exists weekly_xp_goal;

alter table public.sessions drop column if exists xp_earned;
alter table public.review_events drop column if exists xp_delta;
alter table public.badges drop column if exists xp_reward;
alter table public.quests drop column if exists xp_reward;
alter table public.player_stats drop column if exists total_xp;
```

Before finalizing this migration at implementation time, grep `supabase/migrations/*.sql` for any other function body referencing `profiles.xp`, `profiles.level`, or the dropped columns beyond the four listed above — migration history is known to drift from the live schema in this repo (per `mychess/CLAUDE.md`), so this list should be re-verified against actual usage, not assumed complete from this design pass alone.

## Non-goals

- No new global "player level" replaces XP — evaluation is purely per-repertoire (Level *X* of *Y*, mastered-repertoire count).
- Drill and Time Trial keep their existing score/accuracy displays; only XP is stripped from them.
- No change to how a level is computed or what makes a variation "satisfied" — this is purely about visibility/navigation of the existing model.
- No retry/regression mechanic for review mode — it's intentionally inert (no writes), not a "can I un-pass a level" feature.

## Testing

- `src/lib/mastery/levels.ts` — new/updated unit tests for the extracted `levelCap`.
- `src/lib/mastery/moveProgress.ts` — unit test asserting `repertoireProgress` returns the correct `totalLevels`.
- `src/lib/mastery/practice.ts` — unit tests for `pickReviewAttempt`: picks among variations with content at the given level, returns `null` when none qualify, deterministic under an injected `random`.
- `src/lib/mastery/tags.ts` — unit tests for `levelTag` covering every row of the table above (`totalLevels` 1 through 7) plus the 8+ overflow case (e.g. `totalLevels = 10` puts levels 7-10 all in Expert).
- `src/lib/badges/recalc.ts` — existing tests updated to drop `level_3/5/10` cases; `BadgeStats` shape updated.
- `src/lib/quests/generate.ts` — existing tests updated to drop `xpReward` assertions.
- The level-list UI, review-mode navigation, and dashboard mastered-count card: not directly unit-tested (Svelte page components with no prior test file in this codebase are verified manually, matching established convention) — verified via `npm run dev` manual walkthrough: view a partially-progressed repertoire's level list, click into a passed level, confirm no `move_progress` row changes, exit review, confirm normal training resumes unaffected.
