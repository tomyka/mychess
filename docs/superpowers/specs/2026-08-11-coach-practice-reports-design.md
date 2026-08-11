# Coach Practice Reports — Design

## Purpose

Practice (`src/routes/(player)/practice/[repertoire_id]/+page.svelte`) resolves every move client-side and only ever persists an aggregate run-state row (`level_progress`) — no individual move attempt is recorded anywhere. Coaches currently see two flat numbers (`total_reviews`, `moves_learned` — legacy, not Practice-specific) on a student's page, with no per-repertoire breakdown, no trend, no mistake detail. This adds a per-move attempt log and a coach-facing report (accuracy trend, mastery per repertoire, activity/consistency, mistake hotspots) built on top of it.

## Scope decision (confirmed)

- Practice only. The legacy Drill/Time-Trial routes (`reviews`/`review_events`/`sessions` tables) are a separate, effectively unused code path — not touched.
- Every move attempt is logged (correct and wrong), not just mistakes — needed for the accuracy trend and activity views.
- Report structure: a new roster-level overview page plus a drill-in section on the existing per-student coach page — not a per-student-only extension.
- No board diagrams in mistake hotspots — text only (opening line + move + miss count).
- Architecture: raw log table + on-demand aggregation at report-request time. No rollup/summary table — this project has a handful of users; a precomputed aggregate layer is complexity with no current payoff.

## New table: `move_attempts`

Migration `0039_move_attempts.sql`:

```sql
create table public.move_attempts (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.profiles(id) on delete cascade,
  repertoire_id uuid not null references public.repertoires(id) on delete cascade,
  move_id uuid not null references public.moves(id) on delete cascade,
  played_san text not null,
  is_correct boolean not null,
  level smallint not null,
  created_at timestamptz not null default now()
);

create index move_attempts_player_repertoire_created_idx
  on public.move_attempts (player_id, repertoire_id, created_at);
create index move_attempts_move_idx on public.move_attempts (move_id);

alter table public.move_attempts enable row level security;

create policy move_attempts_player_insert on public.move_attempts for insert
  with check (player_id = auth.uid());

create policy move_attempts_player_read on public.move_attempts for select
  using (player_id = auth.uid());

create policy move_attempts_coach_read on public.move_attempts for select using (
  exists (
    select 1 from public.coach_players cp
    where cp.player_id = move_attempts.player_id
      and cp.coach_id = auth.uid()
      and cp.status = 'active'
  )
);
```

`move_id` is the move being *quizzed* (the correct answer at that position), not necessarily what got played — `played_san` holds what the player actually entered, matched against `is_correct`. This mirrors the `moves_coach_read`/`reviews_coach_read` pattern already used in `0019_coach_players.sql` — same `coach_players` (`status = 'active'`) join, no new relationship concept.

No cascade concerns like the ones fixed in `0033_repertoire_delete_cascade.sql` — all three FKs (`profiles`, `repertoires`, `moves`) are declared `on delete cascade` from the start, so deleting a repertoire or a move cleans up its attempt log automatically.

(Per project convention, this migration is not applied by Claude — paste it into the Supabase SQL editor and confirm before relying on the feature.)

## Capture: logging every move

In `handleMove()` (`practice/[repertoire_id]/+page.svelte:277-420`), add a fire-and-forget POST to a new endpoint at each of the three move-resolution points, mirroring the existing fire-and-forget style already used for `reportPreviousLevelMistake()`:

1. **Correct, pinned move** (`detail.san === step.san`): log `{ moveId: step.moveId, playedSan: detail.san, isCorrect: true, level: currentLevel }`.
2. **Correct, accepted alternative** (`alt` found): log against the alternative's own move — `alternativesAt` (in `src/lib/mastery/practice.ts`) needs to carry a `moveId` through `Alternative` (currently only `san`/`toFen`/`kind`/`taskKey`/`variationKey`) so this call site has something to log; a small addition to that type and its construction, not a new concept.
3. **Wrong move** (final `else`): log `{ moveId: step.moveId, playedSan: detail.san, isCorrect: false, level: currentLevel }` — regardless of `step.band`, unlike today's demotion-only `reportPreviousLevelMistake()` check.

New endpoint `src/routes/api/practice/move-log/+server.ts`, following the shape of `api/practice/mistake/+server.ts`: validate session via `requireAccount`, insert one row into `move_attempts` with `repertoireId` from the route param. Does not touch `/api/practice/attempt` or `/api/practice/mistake` or `level_progress` mutation logic — purely additive logging alongside the existing flow.

## Report pages

**Overview — new page `src/routes/(coach)/coach/reports/+page.svelte`** (+ `+page.server.ts`): one row per student the coach has an active relationship with (reuse the existing `coach-players.ts` roster query). Each row: accuracy over last 30 days, session count, last-practiced date, average mastery level across assigned repertoires. Links to the existing student page for drill-in.

**Drill-in — extend `src/routes/(coach)/coach/players/[player_id]/+page.svelte`**: new "Practice Report" section below the existing `coach_notes`/`assigned_repertoires` content. One card per assigned repertoire:

- **Mastery** — current `level` from `level_progress` (already loaded elsewhere in the coach flow).
- **Accuracy trend** — correct-vs-wrong rate bucketed by day (or week, if the range is wide), hand-rolled SVG bar or line chart.
- **Activity** — session/attempt count, last-practiced timestamp, a simple day-streak count.
- **Mistake hotspots** — top N `move_id`s by wrong-attempt count, labeled with the opening line name (`repertoires.name`/`eco_name`) and the move's SAN + move number, e.g. "Najdorf, 6...e5 — wrong 4/7". Text list, no diagrams.

A time-range control (default **last 30 days**, toggle to **all time**) applies to both the trend chart and the hotspot ranking; mastery/level is always current (it isn't a time-series value).

## Code layout

- `src/lib/practice-report.ts` (pure, unit-tested) — given raw `move_attempts` rows for one player/repertoire plus a time range: bucket into accuracy-trend points, rank hotspots by wrong-count, compute session/streak counts. Same pure/I-O split as `src/lib/mastery/`.
- `src/lib/server/practice-report.ts` — Supabase queries: `move_attempts` rows in range, joined move/repertoire labels for hotspot naming, `level_progress` for current mastery. Thin wrapper, not directly unit-tested, per existing `src/lib/server/*` convention.
- Both consumed from the two report pages' `+page.server.ts` load functions.

## Visualization

No charting library exists in this codebase today (`package.json` has none: no d3/recharts/chart.js/etc.). Charts are hand-rolled inline SVG (bar for accuracy trend, matching the `dataviz` skill's guidance for a small, consistent, theme-aware visual system) rather than adding a new dependency for two chart types.

## Testing

- Unit tests for `practice-report.ts`: bucketing correctness (day/week boundaries), hotspot ranking/ties, streak calculation, empty-data edge cases — colocated `practice-report.test.ts`, same convention as `src/lib/mastery/*.test.ts`.
- `npm run check` must stay at zero errors before pushing (per project standard).
- No local Postgres — RLS behavior (coach sees only active-relationship students' rows, players see only their own) is verified manually against production after the migration is applied, not via an automated DB test.

## Out of scope

- Drill/Time-Trial logging (legacy, unused path).
- Board-diagram rendering for hotspots.
- Precomputed/rollup aggregate tables.
- Any retention/pruning policy for `move_attempts` (not a concern at current scale).
- Changes to `level_progress`, `reviews`, `player_stats`, or the existing `/api/practice/attempt`/`/api/practice/mistake` endpoints.
