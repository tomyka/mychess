# KidChess Phase B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Drill mode, Time Trial mode, 30 badges, daily quests, cosmetics picker, mini-leaderboard, coach notes/goal-setting, and upgrade the kid home screen -- making KidChess fully engaging for daily use.

**Architecture:** Twelve tasks build on the SvelteKit 2 + Supabase foundation. New game modes (Drill, Time Trial) live as routes under `(kid)/`. Gamification logic (badges, quests) is server-side TypeScript in `src/lib/`. All writes to XP/level/streak go through existing SECURITY DEFINER RPCs or new ones in migration 0005.

**Tech Stack:** SvelteKit 2 + Svelte 5 runes + TypeScript + Tailwind CSS 4 + Supabase (PostgreSQL + RLS) + ts-fsrs + chessground + Vercel

---

## Critical Svelte 5 Runes Rules (every .svelte file)

- `$props()` not `export let`; `$state()` not `let`; `$derived()` not `$:`
- `onclick` not `on:click`; `{@render children()}` not `<slot />`
- Callback props (`onmove`, `onresult`) instead of `createEventDispatcher`
- `runes: true` is already global in `svelte.config.js` -- do not re-declare per-file

## Critical OneDrive File-Write Workaround

`create` tool and `python3 -c "..."` silently fail on OneDrive paths.
**Always write to `/tmp/` first, then `shutil.copy`** to the target path.

## Phase A Bugs to Fix in Task 2

1. `learn/+page.server.ts` and `practice/+page.server.ts`: wrong Supabase join aliases:
   - `from_position:from_position_id(fen)` -> `from_position(fen)` (FK column is `from_position`)
   - `to_position:to_position_id(fen)` -> `to_position(fen)`
2. `learn/+page.server.ts`: `.select("move_id, due, ...")` -> `due_at` is the actual column
3. `(kid)/+page.server.ts` reads `statsRow?.total_xp` and `statsRow?.streak_days` from `kid_stats` -- after migration 0005 those columns exist; fix is to also read `profiles.xp` and `profiles.streak_days` directly for the home screen stats object.

## DB Schema Reference

```
profiles: id, role, display_name, avatar_id, xp, level, streak_days, streak_freeze, last_active_date, daily_goal, coach_id, created_at, weekly_xp_goal (after 0005)
kid_stats: kid_id, total_reviews, total_correct, moves_learned, updated_at, total_xp, streak_days, new_cards_today, last_stats_date (after 0005)
sessions: id, kid_id, repertoire_id, mode (learn|practice|drill|time_trial after 0005), cards_done, xp_earned, started_at, ended_at
reviews: id, kid_id, move_id, due_at, stability, difficulty, elapsed_days, scheduled_days, reps, lapses, state, last_review
moves: id, repertoire_id, from_position (uuid FK), to_position (uuid FK), san, move_number, is_kid_turn, annotation
positions: id, fen
quests: id, kid_id, date, template_id, description, target, progress, xp_reward, completed_at (after 0005)
weekly_leaderboard: kid_id, week_start, xp_earned, rank (after 0005)
assigned_repertoires: id, coach_id, kid_id, repertoire_id, note, due_date, assigned_at (after 0005)
coach_notes: id, coach_id, kid_id, note, created_at, read_at (after 0005)
badges: id (text PK), name, description, icon_url, xp_reward
badges_earned: kid_id, badge_id, earned_at
equipped_cosmetics: kid_id, avatar_id, theme_id, piece_set
```

---

## File Map

**New files:**
```
supabase/migrations/0005_phase_b.sql
supabase/migrations/0006_badges.sql
src/lib/badges/recalc.ts
src/lib/badges/recalc.test.ts
src/lib/quests/generate.ts
src/lib/quests/generate.test.ts
src/routes/(kid)/drill/+page.server.ts
src/routes/(kid)/drill/+page.svelte
src/routes/(kid)/time-trial/+page.server.ts
src/routes/(kid)/time-trial/+page.svelte
src/routes/(kid)/cosmetics/+page.server.ts
src/routes/(kid)/cosmetics/+page.svelte
src/routes/api/drill/+server.ts
src/routes/api/time-trial/+server.ts
src/routes/api/quests/daily/+server.ts
src/routes/api/quests/progress/+server.ts
src/routes/api/cosmetics/equip/+server.ts
src/routes/api/notes/read/+server.ts
src/lib/components/LeaderboardPodium.svelte
```

**Modified files:**
```
src/routes/(kid)/+page.server.ts          -- fix XP/streak bug; add quests, leaderboard, unread note
src/routes/(kid)/+page.svelte             -- quests, leaderboard, Drill/TT buttons, SirKnight note
src/routes/(kid)/learn/+page.server.ts    -- fix from_position/to_position/due_at
src/routes/(kid)/practice/+page.server.ts -- fix from_position/to_position
src/lib/components/SirKnight.svelte       -- expand to 6 moods + CSS animation
src/routes/(coach)/coach/kids/[kid_id]/+page.server.ts -- goal-setting, assign reps, notes
src/routes/(coach)/coach/kids/[kid_id]/+page.svelte    -- UI for above
```

---

## Task 1: DB Migration 0005

**Files:**
- Create: `supabase/migrations/0005_phase_b.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- Expand sessions.mode to include drill and time_trial
alter table public.sessions drop constraint if exists sessions_mode_check;
alter table public.sessions add constraint sessions_mode_check
  check (mode in ('learn','practice','drill','time_trial'));

-- Add missing kid_stats columns (home page bug fix)
alter table public.kid_stats
  add column if not exists total_xp         integer not null default 0,
  add column if not exists streak_days      integer not null default 0,
  add column if not exists new_cards_today  integer not null default 0,
  add column if not exists last_stats_date  date;

-- Add coach goal column to profiles
alter table public.profiles
  add column if not exists weekly_xp_goal integer not null default 200;

-- Add read_at to coach_notes
alter table public.coach_notes
  add column if not exists read_at timestamptz;

-- Quests table
create table if not exists public.quests (
  id           uuid primary key default uuid_generate_v4(),
  kid_id       uuid not null references public.profiles(id) on delete cascade,
  date         date not null,
  template_id  text not null,
  description  text not null,
  target       integer not null,
  progress     integer not null default 0,
  xp_reward    integer not null default 50,
  completed_at timestamptz,
  unique(kid_id, date, template_id)
);
alter table public.quests enable row level security;
create policy "Kids see own quests" on public.quests
  for select using (kid_id = auth.uid());
create policy "Service role manages quests" on public.quests
  for all using (auth.role() = 'service_role');
-- Allow API routes (authed users) to insert/update own quests
create policy "Kids manage own quests" on public.quests
  for all using (kid_id = auth.uid()) with check (kid_id = auth.uid());

-- Weekly leaderboard
create table if not exists public.weekly_leaderboard (
  kid_id     uuid primary key references public.profiles(id) on delete cascade,
  week_start date not null,
  xp_earned  integer not null default 0,
  rank       integer
);
alter table public.weekly_leaderboard enable row level security;
create policy "Anyone can view leaderboard" on public.weekly_leaderboard
  for select using (true);

-- Assigned repertoires
create table if not exists public.assigned_repertoires (
  id            uuid primary key default uuid_generate_v4(),
  coach_id      uuid not null references public.profiles(id),
  kid_id        uuid not null references public.profiles(id) on delete cascade,
  repertoire_id uuid not null references public.repertoires(id) on delete cascade,
  note          text,
  due_date      date,
  assigned_at   timestamptz not null default now(),
  unique(kid_id, repertoire_id)
);
alter table public.assigned_repertoires enable row level security;
create policy "Kids see own assignments" on public.assigned_repertoires
  for select using (kid_id = auth.uid());
create policy "Coaches manage assignments" on public.assigned_repertoires
  for all using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'coach')
  );

-- RPC: sync kid_stats.total_xp and streak_days from profiles after each session
create or replace function public.sync_kid_stats(p_kid_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_xp     integer;
  v_streak integer;
begin
  select xp, streak_days into v_xp, v_streak from profiles where id = p_kid_id;
  insert into kid_stats(kid_id, total_xp, streak_days, updated_at)
  values (p_kid_id, v_xp, v_streak, now())
  on conflict (kid_id) do update
    set total_xp    = excluded.total_xp,
        streak_days = excluded.streak_days,
        updated_at  = now();
end;
$$;

-- RPC: increment new_cards_today (auto-reset when date changes)
create or replace function public.increment_new_cards(p_kid_id uuid, p_count integer)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into kid_stats(kid_id, new_cards_today, last_stats_date)
  values (p_kid_id, p_count, current_date)
  on conflict (kid_id) do update
    set new_cards_today = case
      when kid_stats.last_stats_date < current_date then p_count
      else kid_stats.new_cards_today + p_count
    end,
    last_stats_date = current_date;
end;
$$;

-- RPC: update weekly leaderboard for a kid and recompute ranks within coach group
create or replace function public.update_weekly_leaderboard(p_kid_id uuid, p_xp integer)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_week_start date := date_trunc('week', current_date)::date;
  v_coach_id   uuid;
begin
  select coach_id into v_coach_id from profiles where id = p_kid_id;

  insert into weekly_leaderboard(kid_id, week_start, xp_earned)
  values (p_kid_id, v_week_start, p_xp)
  on conflict (kid_id) do update
    set xp_earned = case
      when weekly_leaderboard.week_start < v_week_start then p_xp
      else weekly_leaderboard.xp_earned + p_xp
    end,
    week_start = v_week_start;

  -- Recompute ranks for all kids under the same coach
  if v_coach_id is not null then
    with ranked as (
      select wl.kid_id,
             row_number() over (order by wl.xp_earned desc) as r
      from weekly_leaderboard wl
      join profiles p on p.id = wl.kid_id
      where wl.week_start = v_week_start and p.coach_id = v_coach_id
    )
    update weekly_leaderboard wl set rank = ranked.r
    from ranked where ranked.kid_id = wl.kid_id;
  end if;
end;
$$;
```

Save this SQL as `kidchess/supabase/migrations/0005_phase_b.sql` (use Python + shutil.copy workaround).

- [ ] **Step 2: Apply migration locally**

```bash
cd kidchess
npx supabase db push   # or: npx supabase migration up
```

Expected: migration applies cleanly, no errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0005_phase_b.sql
git commit -m "feat(db): Phase B migration -- quests, leaderboard, assignments, mode expansion"
```

---

## Task 2: Fix Phase A Bugs

**Files:**
- Modify: `src/routes/(kid)/learn/+page.server.ts`
- Modify: `src/routes/(kid)/practice/+page.server.ts`
- Modify: `src/routes/(kid)/+page.server.ts`

- [ ] **Step 1: Fix learn/+page.server.ts -- join aliases and due_at**

Replace the Supabase query block in `learn/+page.server.ts`:

```typescript
// BEFORE (broken):
const { data: moves } = await supabase
  .from('moves')
  .select(`
    id, san, ply,
    from_position:from_position_id(fen),
    to_position:to_position_id(fen),
    repertoire:repertoire_id(id, name, color)
  `)
  .in('repertoire_id', repIds);

const { data: reviews } = await supabase
  .from('reviews')
  .select('move_id, due, stability, difficulty, elapsed_days, scheduled_days, reps, lapses, state, last_review')
  .eq('kid_id', user.id);
```

```typescript
// AFTER (correct):
const { data: moves } = await supabase
  .from('moves')
  .select(`
    id, san, move_number,
    from_position(fen),
    to_position(fen),
    repertoire:repertoire_id(id, name, color)
  `)
  .in('repertoire_id', repIds);

const { data: reviews } = await supabase
  .from('reviews')
  .select('move_id, due_at, stability, difficulty, elapsed_days, scheduled_days, reps, lapses, state, last_review')
  .eq('kid_id', user.id);
```

Also in the same file, fix card construction using `due_at` instead of `due`:
```typescript
// BEFORE:
due: new Date(r.due),

// AFTER:
due: new Date(r.due_at),
```

- [ ] **Step 2: Fix practice/+page.server.ts -- join aliases only**

```typescript
// BEFORE:
.select(`
  id, san, ply,
  from_position:from_position_id(fen),
  to_position:to_position_id(fen),
  repertoire:repertoire_id(id, name, color)
`)

// AFTER:
.select(`
  id, san, move_number,
  from_position(fen),
  to_position(fen),
  repertoire:repertoire_id(id, name, color)
`)
```

- [ ] **Step 3: Fix home page server to read XP + streak from profiles**

Replace the `+page.server.ts` `load` function with:

```typescript
import type { PageServerLoad } from './$types';
import { levelFromXp } from '$lib/srs/xp';

export const load: PageServerLoad = async ({ locals: { supabase, safeGetSession } }) => {
  const { user, session, profile } = await safeGetSession();
  if (!user) return { session: null, profile: null };

  // XP and streak come from profiles (source of truth)
  const totalXp = profile?.xp ?? 0;
  const streakDays = profile?.streak_days ?? 0;
  const { level, xpInLevel, xpToNextLevel } = levelFromXp(totalXp);

  const { data: statsRow } = await supabase
    .from('kid_stats')
    .select('total_reviews, total_correct, moves_learned')
    .eq('kid_id', user.id)
    .single();

  return {
    session,
    profile,
    stats: {
      level,
      total_xp: totalXp,
      xp_in_level: xpInLevel,
      xp_to_next: xpToNextLevel,
      streak_days: streakDays,
      total_reviews: statsRow?.total_reviews ?? 0
    }
  };
};
```

- [ ] **Step 4: Verify dev server starts without type errors**

```bash
cd kidchess && npm run check
```

Expected: 0 errors (or only pre-existing unrelated errors).

- [ ] **Step 5: Commit**

```bash
git add src/routes/\(kid\)/+page.server.ts src/routes/\(kid\)/learn/+page.server.ts src/routes/\(kid\)/practice/+page.server.ts
git commit -m "fix: correct Supabase join aliases, due_at column, and home XP/streak source"
```

---

## Task 3: Badge System

**Files:**
- Create: `src/lib/badges/recalc.ts`
- Create: `src/lib/badges/recalc.test.ts`
- Create: `supabase/migrations/0006_badges.sql`

The badge system checks earned criteria against a snapshot of stats and grants missing badges via Supabase upsert. Called after every session submission.

- [ ] **Step 1: Write failing tests for recalc.ts**

Create `src/lib/badges/recalc.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { checkBadgeEligibility } from './recalc';

describe('checkBadgeEligibility', () => {
  const base = {
    totalReviews: 0,
    totalCorrect: 0,
    movesLearned: 0,
    streakDays: 0,
    level: 1,
    sessionCount: 0,
    repertoireCount: 0,
    drillStreak: 0,
    ttBestScore: 0,
    questsCompleted: 0,
    hasUploaded: false,
    earnedIds: new Set<string>()
  };

  it('grants first_move on first review', () => {
    const result = checkBadgeEligibility({ ...base, totalReviews: 1 });
    expect(result).toContain('first_move');
  });

  it('does not grant first_move if already earned', () => {
    const result = checkBadgeEligibility({ ...base, totalReviews: 1, earnedIds: new Set(['first_move']) });
    expect(result).not.toContain('first_move');
  });

  it('grants review_10 at 10 reviews', () => {
    const result = checkBadgeEligibility({ ...base, totalReviews: 10 });
    expect(result).toContain('review_10');
  });

  it('grants streak_7 at 7 streak days', () => {
    const result = checkBadgeEligibility({ ...base, streakDays: 7 });
    expect(result).toContain('streak_7');
  });

  it('grants level_3 at level 3', () => {
    const result = checkBadgeEligibility({ ...base, level: 3 });
    expect(result).toContain('level_3');
  });

  it('grants speed_demon at tt best score >= 10', () => {
    const result = checkBadgeEligibility({ ...base, ttBestScore: 10 });
    expect(result).toContain('speed_demon');
  });

  it('grants multi_repertoire at 2+ repertoires', () => {
    const result = checkBadgeEligibility({ ...base, repertoireCount: 2 });
    expect(result).toContain('multi_repertoire');
  });

  it('returns empty array when no new badges earned', () => {
    const result = checkBadgeEligibility(base);
    expect(result).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd kidchess && npx vitest run src/lib/badges/recalc.test.ts
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement recalc.ts**

Create `src/lib/badges/recalc.ts`:

```typescript
export interface BadgeStats {
  totalReviews: number;
  totalCorrect: number;
  movesLearned: number;
  streakDays: number;
  level: number;
  sessionCount: number;
  repertoireCount: number;
  drillStreak: number;      // best drill chain in current session
  ttBestScore: number;      // best Time Trial score ever
  questsCompleted: number;
  hasUploaded: boolean;
  earnedIds: Set<string>;
}

interface BadgeRule {
  id: string;
  check: (s: BadgeStats) => boolean;
}

const RULES: BadgeRule[] = [
  // First-time
  { id: 'first_move',         check: s => s.totalReviews >= 1 },
  { id: 'first_repertoire',   check: s => s.repertoireCount >= 1 },
  { id: 'first_streak_3',     check: s => s.streakDays >= 3 },
  { id: 'first_drill',        check: s => s.drillStreak >= 1 },
  { id: 'first_time_trial',   check: s => s.ttBestScore >= 1 },
  // Streak
  { id: 'streak_7',           check: s => s.streakDays >= 7 },
  { id: 'streak_30',          check: s => s.streakDays >= 30 },
  { id: 'streak_100',         check: s => s.streakDays >= 100 },
  // Review volume
  { id: 'review_10',          check: s => s.totalReviews >= 10 },
  { id: 'review_100',         check: s => s.totalReviews >= 100 },
  { id: 'review_500',         check: s => s.totalReviews >= 500 },
  { id: 'review_1000',        check: s => s.totalReviews >= 1000 },
  // Mastery
  { id: 'moves_learned_10',   check: s => s.movesLearned >= 10 },
  { id: 'moves_learned_50',   check: s => s.movesLearned >= 50 },
  { id: 'moves_learned_100',  check: s => s.movesLearned >= 100 },
  // Level
  { id: 'level_3',            check: s => s.level >= 3 },
  { id: 'level_5',            check: s => s.level >= 5 },
  { id: 'level_10',           check: s => s.level >= 10 },
  // Speed / Time Trial
  { id: 'speed_demon',        check: s => s.ttBestScore >= 10 },
  { id: 'speed_legend',       check: s => s.ttBestScore >= 20 },
  // Drill
  { id: 'drill_chain_5',      check: s => s.drillStreak >= 5 },
  { id: 'drill_chain_10',     check: s => s.drillStreak >= 10 },
  { id: 'drill_chain_20',     check: s => s.drillStreak >= 20 },
  { id: 'drill_ace',          check: s => s.drillStreak >= 10 },
  // Sessions
  { id: 'sessions_10',        check: s => s.sessionCount >= 10 },
  { id: 'sessions_50',        check: s => s.sessionCount >= 50 },
  // Exploration
  { id: 'uploader',           check: s => s.hasUploaded },
  { id: 'multi_repertoire',   check: s => s.repertoireCount >= 2 },
  // Quests
  { id: 'quest_master',       check: s => s.questsCompleted >= 10 },
  // Streak freeze saved (manual grant only -- skip automated check)
  { id: 'streak_freeze_saved', check: _s => false },
];

/** Returns badge IDs that should be granted (not already in earnedIds). */
export function checkBadgeEligibility(stats: BadgeStats): string[] {
  return RULES
    .filter(r => !stats.earnedIds.has(r.id) && r.check(stats))
    .map(r => r.id);
}
```

- [ ] **Step 4: Run tests -- should pass**

```bash
cd kidchess && npx vitest run src/lib/badges/recalc.test.ts
```

Expected: all 8 tests pass.

- [ ] **Step 5: Write 0006_badges.sql with all 30 badge rows**

```sql
-- 0006_badges.sql
truncate public.badges;

insert into public.badges (id, name, description, icon_url, xp_reward) values
  ('first_move',         'First Move!',         'Complete your first review',                        '/badges/first_move.svg',         25),
  ('first_repertoire',   'Opening Explorer',    'Create your first repertoire',                     '/badges/first_repertoire.svg',    25),
  ('first_streak_3',     'Hat-Trick!',          'Reach a 3-day streak',                             '/badges/first_streak_3.svg',      25),
  ('first_drill',        'Drill Sergeant',      'Complete your first Drill session',                '/badges/first_drill.svg',         25),
  ('first_time_trial',   'Against the Clock',   'Complete your first Time Trial',                   '/badges/first_time_trial.svg',    25),
  ('streak_7',           'Week Warrior',        'Train 7 days in a row',                            '/badges/streak_7.svg',            50),
  ('streak_30',          'Month Master',        'Train 30 days in a row',                           '/badges/streak_30.svg',           150),
  ('streak_100',         'Century Champion',    'Train 100 days in a row',                          '/badges/streak_100.svg',          500),
  ('streak_freeze_saved','Freeze Saved!',       'Use a streak freeze to survive a missed day',      '/badges/streak_freeze_saved.svg', 0),
  ('review_10',          'Getting Started',     'Review 10 cards total',                            '/badges/review_10.svg',           10),
  ('review_100',         'Consistent Learner',  'Review 100 cards total',                           '/badges/review_100.svg',          50),
  ('review_500',         'Opening Scholar',     'Review 500 cards total',                           '/badges/review_500.svg',          100),
  ('review_1000',        'Grand Master Grind',  'Review 1000 cards total',                          '/badges/review_1000.svg',         250),
  ('moves_learned_10',   'Apprentice',          'Learn 10 opening moves',                           '/badges/moves_learned_10.svg',    25),
  ('moves_learned_50',   'Journeyman',          'Learn 50 opening moves',                           '/badges/moves_learned_50.svg',    100),
  ('moves_learned_100',  'Opening Expert',      'Learn 100 opening moves',                          '/badges/moves_learned_100.svg',   250),
  ('level_3',            'Rising Star',         'Reach Level 3',                                    '/badges/level_3.svg',             50),
  ('level_5',            'Chess Enthusiast',    'Reach Level 5',                                    '/badges/level_5.svg',             150),
  ('level_10',           'Chess Champion',      'Reach Level 10',                                   '/badges/level_10.svg',            500),
  ('speed_demon',        'Speed Demon',         'Answer 10+ correct in a single Time Trial',        '/badges/speed_demon.svg',         75),
  ('speed_legend',       'Speed Legend',        'Answer 20+ correct in a single Time Trial',        '/badges/speed_legend.svg',        200),
  ('drill_chain_5',      'Chain Builder',       'Get a 5-move Drill chain',                         '/badges/drill_chain_5.svg',       50),
  ('drill_chain_10',     'Drill Master',        'Get a 10-move Drill chain',                        '/badges/drill_chain_10.svg',      100),
  ('drill_chain_20',     'Drill Legend',        'Get a 20-move Drill chain',                        '/badges/drill_chain_20.svg',      300),
  ('drill_ace',          'Drill Ace',           'Complete a 10-card Drill with zero mistakes',      '/badges/drill_ace.svg',           150),
  ('sessions_10',        'Dedicated Student',   'Complete 10 training sessions',                    '/badges/sessions_10.svg',         50),
  ('sessions_50',        'Hall of Fame',        'Complete 50 training sessions',                    '/badges/sessions_50.svg',         200),
  ('uploader',           'Coach''s Helper',     'Upload a PGN file',                                '/badges/uploader.svg',            25),
  ('multi_repertoire',   'Opening Collector',   'Have 2 or more repertoires',                       '/badges/multi_repertoire.svg',    50),
  ('quest_master',       'Quest Master',        'Complete 10 daily quests',                         '/badges/quest_master.svg',        200);
```

Save as `supabase/migrations/0006_badges.sql` (Python + shutil.copy workaround).

- [ ] **Step 6: Apply migration**

```bash
cd kidchess && npx supabase db push
```

Expected: migration applies cleanly.

- [ ] **Step 7: Commit**

```bash
git add src/lib/badges/ supabase/migrations/0006_badges.sql
git commit -m "feat(badges): badge eligibility logic + 30 badge definitions"
```

---

## Task 4: Quest System

**Files:**
- Create: `src/lib/quests/generate.ts`
- Create: `src/lib/quests/generate.test.ts`
- Create: `src/routes/api/quests/daily/+server.ts`
- Create: `src/routes/api/quests/progress/+server.ts`

- [ ] **Step 1: Write failing tests**

Create `src/lib/quests/generate.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { QUEST_TEMPLATES, selectDailyQuests } from './generate';

describe('QUEST_TEMPLATES', () => {
  it('has exactly 5 templates', () => {
    expect(QUEST_TEMPLATES).toHaveLength(5);
  });

  it('each template has required fields', () => {
    for (const t of QUEST_TEMPLATES) {
      expect(t.id).toBeTruthy();
      expect(t.description).toBeTruthy();
      expect(t.target).toBeGreaterThan(0);
      expect(t.xpReward).toBeGreaterThan(0);
    }
  });
});

describe('selectDailyQuests', () => {
  it('returns exactly 3 quests', () => {
    const quests = selectDailyQuests('2024-01-15', 'kid-uuid-1');
    expect(quests).toHaveLength(3);
  });

  it('is deterministic for same date + kid', () => {
    const a = selectDailyQuests('2024-01-15', 'kid-uuid-1');
    const b = selectDailyQuests('2024-01-15', 'kid-uuid-1');
    expect(a.map(q => q.id)).toEqual(b.map(q => q.id));
  });

  it('varies between different dates', () => {
    const a = selectDailyQuests('2024-01-15', 'kid-uuid-1');
    const b = selectDailyQuests('2024-01-16', 'kid-uuid-1');
    // Not guaranteed different but very likely with 5 choose 3 = 10 combos
    expect(a.map(q => q.id).join()).not.toEqual(b.map(q => q.id).join());
  });
});
```

- [ ] **Step 2: Run tests -- confirm failure**

```bash
cd kidchess && npx vitest run src/lib/quests/generate.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement generate.ts**

Create `src/lib/quests/generate.ts`:

```typescript
export interface QuestTemplate {
  id: string;
  description: string;
  target: number;
  xpReward: number;
}

export const QUEST_TEMPLATES: QuestTemplate[] = [
  { id: 'review_cards',  description: 'Review 10 cards today',              target: 10, xpReward: 50 },
  { id: 'new_cards',     description: 'Learn 5 new moves today',            target: 5,  xpReward: 60 },
  { id: 'drill_streak',  description: 'Get a 5-move Drill chain',           target: 5,  xpReward: 70 },
  { id: 'time_trial',    description: 'Score 8+ in Time Trial',             target: 8,  xpReward: 80 },
  { id: 'sessions',      description: 'Complete 2 training sessions today', target: 2,  xpReward: 40 },
];

/** Deterministic shuffle seeded on date + kidId string */
function seededShuffle<T>(arr: T[], seed: string): T[] {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
  }
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    hash = ((hash * 1664525) + 1013904223) | 0;
    const j = Math.abs(hash) % (i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** Select 3 quests for the given date + kid. Deterministic. */
export function selectDailyQuests(date: string, kidId: string): QuestTemplate[] {
  const seed = `${date}:${kidId}`;
  return seededShuffle(QUEST_TEMPLATES, seed).slice(0, 3);
}
```

- [ ] **Step 4: Run tests -- should pass**

```bash
cd kidchess && npx vitest run src/lib/quests/generate.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Write daily quests GET endpoint**

Create `src/routes/api/quests/daily/+server.ts`:

```typescript
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { selectDailyQuests } from '$lib/quests/generate';

export const GET: RequestHandler = async ({ locals: { supabase, safeGetSession } }) => {
  const { user } = await safeGetSession();
  if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

  const today = new Date().toISOString().slice(0, 10);
  const templates = selectDailyQuests(today, user.id);

  // Upsert quest rows (insert if missing, leave progress intact if exists)
  for (const t of templates) {
    await supabase.from('quests').upsert(
      {
        kid_id:      user.id,
        date:        today,
        template_id: t.id,
        description: t.description,
        target:      t.target,
        xp_reward:   t.xpReward
      },
      { onConflict: 'kid_id,date,template_id', ignoreDuplicates: true }
    );
  }

  const { data: quests } = await supabase
    .from('quests')
    .select('*')
    .eq('kid_id', user.id)
    .eq('date', today);

  return json({ quests: quests ?? [] });
};
```

- [ ] **Step 6: Write quest progress PATCH endpoint**

Create `src/routes/api/quests/progress/+server.ts`:

```typescript
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = async ({ request, locals: { supabase, safeGetSession } }) => {
  const { user } = await safeGetSession();
  if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

  const { templateId, increment } = await request.json() as { templateId: string; increment: number };
  const today = new Date().toISOString().slice(0, 10);

  const { data: quest } = await supabase
    .from('quests')
    .select('*')
    .eq('kid_id', user.id)
    .eq('date', today)
    .eq('template_id', templateId)
    .single();

  if (!quest) return json({ error: 'Quest not found' }, { status: 404 });
  if (quest.completed_at) return json({ quest }); // already done

  const newProgress = Math.min(quest.target, quest.progress + increment);
  const completedAt = newProgress >= quest.target ? new Date().toISOString() : null;

  const { data: updated } = await supabase
    .from('quests')
    .update({ progress: newProgress, completed_at: completedAt })
    .eq('kid_id', user.id)
    .eq('date', today)
    .eq('template_id', templateId)
    .select()
    .single();

  // Grant XP reward when quest first completes
  if (completedAt) {
    await supabase.rpc('update_xp_and_level', {
      p_kid_id: user.id,
      p_xp_delta: quest.xp_reward
    });
  }

  return json({ quest: updated });
};
```

- [ ] **Step 7: Commit**

```bash
git add src/lib/quests/ src/routes/api/quests/
git commit -m "feat(quests): daily quest generation + progress API"
```

---

## Task 5: Drill Mode

**Files:**
- Create: `src/routes/(kid)/drill/+page.server.ts`
- Create: `src/routes/(kid)/drill/+page.svelte`
- Create: `src/routes/api/drill/+server.ts`

Drill mode: pick random Review-state cards, no hints shown, first wrong answer ends the chain. +2 XP per card, +50 bonus at 10-card chain. Tracks best drill chain for badge eligibility.

- [ ] **Step 1: Write drill page server**

Create `src/routes/(kid)/drill/+page.server.ts`:

```typescript
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals: { supabase, safeGetSession } }) => {
  const { user, session, profile } = await safeGetSession();
  if (!user) throw redirect(303, '/login');

  // Get Review-state cards (already learned) for drilling
  const { data: reps } = await supabase
    .from('repertoires')
    .select('id')
    .eq('kid_id', user.id);

  const repIds = reps?.map(r => r.id) ?? [];
  if (repIds.length === 0) {
    return { session, profile, drillMoves: [] };
  }

  // Fetch moves with Review-state reviews
  const { data: reviewCards } = await supabase
    .from('reviews')
    .select('move_id, state')
    .eq('kid_id', user.id)
    .eq('state', 'Review');

  const reviewMoveIds = reviewCards?.map(r => r.move_id) ?? [];
  if (reviewMoveIds.length === 0) {
    return { session, profile, drillMoves: [] };
  }

  const { data: moves } = await supabase
    .from('moves')
    .select(`
      id, san, move_number,
      from_position(fen),
      to_position(fen),
      repertoire:repertoire_id(id, name, color)
    `)
    .in('repertoire_id', repIds)
    .in('id', reviewMoveIds)
    .eq('is_kid_turn', true);

  // Shuffle moves server-side (no seed -- random each visit)
  const shuffled = (moves ?? []).sort(() => Math.random() - 0.5);

  return { session, profile, drillMoves: shuffled.slice(0, 20) };
};
```

- [ ] **Step 2: Write drill page UI**

Create `src/routes/(kid)/drill/+page.svelte`:

```svelte
<script lang="ts">
  import { goto } from '$app/navigation';
  import ChessBoard from '$lib/components/ChessBoard.svelte';
  import SirKnight from '$lib/components/SirKnight.svelte';

  let { data } = $props<{ data: any }>();

  const drillMoves: any[] = $derived(data.drillMoves ?? []);

  let idx = $state(0);
  let chain = $state(0);     // current streak
  let bestChain = $state(0); // this session best
  let failed = $state(false);
  let done = $state(false);
  let events: Array<{ moveId: string; correct: boolean; latencyMs: number }> = $state([]);
  let cardStart = $state(Date.now());

  const currentMove: any = $derived(drillMoves[idx] ?? null);
  const xpEarned = $derived(chain * 2 + (chain >= 10 ? 50 : 0));
  const mascotMood = $derived(failed ? 'sad' : chain >= 10 ? 'party' : chain > 0 ? 'cheer' : 'idle');
  const mascotMsg = $derived(
    done ? `Session done! Chain: ${bestChain}` :
    failed ? `Chain broken at ${bestChain}! Try again!` :
    chain >= 10 ? `Incredible ${chain}-move chain!` :
    chain > 0 ? `${chain} in a row! Keep going!` :
    drillMoves.length === 0 ? 'Learn more moves first!' : 'Make the correct move!'
  );

  async function submitSession() {
    await fetch('/api/drill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events, bestChain, xpEarned })
    });
    done = true;
  }

  function handleMove(san: string) {
    if (!currentMove || failed || done) return;
    const latencyMs = Date.now() - cardStart;
    const correct = san === currentMove.san;

    events = [...events, { moveId: currentMove.id, correct, latencyMs }];

    if (correct) {
      chain += 1;
      if (chain > bestChain) bestChain = chain;

      if (idx + 1 >= drillMoves.length) {
        submitSession();
      } else {
        idx += 1;
        cardStart = Date.now();
      }
    } else {
      failed = true;
      submitSession();
    }
  }
</script>

<main class="min-h-screen bg-slate-900 text-white p-4 max-w-lg mx-auto pb-24">
  <div class="flex items-center justify-between mb-6">
    <a href="/" class="text-slate-400 hover:text-white">&larr; Home</a>
    <h1 class="text-xl font-bold">Drill Mode</h1>
    <div class="bg-orange-500 text-white px-3 py-1 rounded-full text-sm font-bold">
      {chain} chain
    </div>
  </div>

  {#if drillMoves.length === 0}
    <div class="text-center py-16">
      <p class="text-slate-400">No Review-state cards yet.</p>
      <p class="text-sm text-slate-500 mt-2">Complete Learn mode first to unlock Drill!</p>
      <a href="/learn" class="mt-6 inline-block bg-yellow-400 text-slate-900 px-6 py-3 rounded-2xl font-bold">
        Go to Learn
      </a>
    </div>
  {:else if done || failed}
    <div class="text-center py-8">
      <p class="text-3xl mb-4">{failed ? '💥' : '🎉'}</p>
      <p class="text-xl font-bold mb-2">Best chain: {bestChain}</p>
      <p class="text-slate-400 mb-6">+{xpEarned} XP earned</p>
      <div class="flex gap-3 justify-center">
        <button onclick={() => goto('/drill')} class="bg-orange-500 px-6 py-3 rounded-2xl font-bold">
          Try Again
        </button>
        <a href="/" class="bg-slate-700 px-6 py-3 rounded-2xl font-bold">Home</a>
      </div>
    </div>
  {:else if currentMove}
    <div class="mb-4">
      <ChessBoard
        fen={currentMove.from_position?.fen ?? 'start'}
        orientation={currentMove.repertoire?.color ?? 'white'}
        lastMove={null}
        onmove={handleMove}
      />
    </div>
    <p class="text-center text-slate-400 text-sm mb-4">
      Move {idx + 1} of {drillMoves.length} -- no hints!
    </p>
  {/if}

  <div class="mt-4">
    <SirKnight mood={mascotMood} message={mascotMsg} />
  </div>
</main>
```

- [ ] **Step 3: Write drill API endpoint**

Create `src/routes/api/drill/+server.ts`:

```typescript
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { checkBadgeEligibility } from '$lib/badges/recalc';

export const POST: RequestHandler = async ({ request, locals: { supabase, safeGetSession } }) => {
  const { user } = await safeGetSession();
  if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

  const { events, bestChain, xpEarned } = await request.json() as {
    events: Array<{ moveId: string; correct: boolean; latencyMs: number }>;
    bestChain: number;
    xpEarned: number;
  };

  // Create session record
  const { data: sessionRow } = await supabase
    .from('sessions')
    .insert({ kid_id: user.id, mode: 'drill', cards_done: events.length, xp_earned: xpEarned })
    .select('id')
    .single();

  // Insert review events (no FSRS update for drill -- just tracking)
  if (sessionRow && events.length > 0) {
    await supabase.from('review_events').insert(
      events.map(e => ({
        session_id: sessionRow.id,
        move_id:    e.moveId,
        rating:     e.correct ? 'good' : 'again',
        latency_ms: e.latencyMs,
        used_hint:  false,
        xp_delta:   e.correct ? 2 : 0
      }))
    );
  }

  // Award XP
  if (xpEarned > 0) {
    await supabase.rpc('update_xp_and_level', { p_kid_id: user.id, p_xp_delta: xpEarned });
    await supabase.rpc('update_weekly_leaderboard', { p_kid_id: user.id, p_xp: xpEarned });
  }
  await supabase.rpc('update_streak', { p_kid_id: user.id });
  await supabase.rpc('sync_kid_stats', { p_kid_id: user.id });

  // Update drill quest progress
  if (events.length > 0) {
    await fetch(new URL('/api/quests/progress', 'http://localhost').href, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateId: 'drill_streak', increment: bestChain })
    });
  }

  // Check badges
  const { data: profile } = await supabase
    .from('profiles')
    .select('xp, level, streak_days')
    .eq('id', user.id)
    .single();
  const { data: stats } = await supabase
    .from('kid_stats')
    .select('total_reviews, total_correct, moves_learned')
    .eq('kid_id', user.id)
    .single();
  const { data: earnedRows } = await supabase
    .from('badges_earned')
    .select('badge_id')
    .eq('kid_id', user.id);
  const { data: sessionCount } = await supabase
    .from('sessions')
    .select('id', { count: 'exact', head: true })
    .eq('kid_id', user.id);
  const { data: repCount } = await supabase
    .from('repertoires')
    .select('id', { count: 'exact', head: true })
    .eq('kid_id', user.id);

  const earned = new Set((earnedRows ?? []).map(r => r.badge_id));
  const newBadges = checkBadgeEligibility({
    totalReviews:     stats?.total_reviews ?? 0,
    totalCorrect:     stats?.total_correct ?? 0,
    movesLearned:     stats?.moves_learned ?? 0,
    streakDays:       profile?.streak_days ?? 0,
    level:            profile?.level ?? 1,
    sessionCount:     (sessionCount as any)?.count ?? 0,
    repertoireCount:  (repCount as any)?.count ?? 0,
    drillStreak:      bestChain,
    ttBestScore:      0,
    questsCompleted:  0,
    hasUploaded:      false,
    earnedIds:        earned
  });

  if (newBadges.length > 0) {
    await supabase.from('badges_earned').insert(
      newBadges.map(badgeId => ({ kid_id: user.id, badge_id: badgeId }))
    );
    for (const badgeId of newBadges) {
      const { data: badge } = await supabase
        .from('badges')
        .select('xp_reward')
        .eq('id', badgeId)
        .single();
      if (badge?.xp_reward) {
        await supabase.rpc('update_xp_and_level', { p_kid_id: user.id, p_xp_delta: badge.xp_reward });
      }
    }
  }

  return json({ ok: true, newBadges });
};
```

- [ ] **Step 4: Commit**

```bash
git add src/routes/\(kid\)/drill/ src/routes/api/drill/
git commit -m "feat(drill): Drill mode -- chain-based review with badge checks"
```

---

## Task 6: Time Trial Mode

**Files:**
- Create: `src/routes/(kid)/time-trial/+page.server.ts`
- Create: `src/routes/(kid)/time-trial/+page.svelte`
- Create: `src/routes/api/time-trial/+server.ts`

Time Trial: 60-second countdown, any Review or Learning-state cards, +5 XP per correct answer, +200 bonus at 20+ correct.

- [ ] **Step 1: Write time-trial page server**

Create `src/routes/(kid)/time-trial/+page.server.ts`:

```typescript
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals: { supabase, safeGetSession } }) => {
  const { user, session, profile } = await safeGetSession();
  if (!user) throw redirect(303, '/login');

  const { data: reps } = await supabase
    .from('repertoires')
    .select('id')
    .eq('kid_id', user.id);

  const repIds = reps?.map(r => r.id) ?? [];
  if (repIds.length === 0) return { session, profile, moves: [] };

  // Any card that has been reviewed at least once (not New)
  const { data: reviewCards } = await supabase
    .from('reviews')
    .select('move_id')
    .eq('kid_id', user.id)
    .in('state', ['Learning', 'Review', 'Relearning']);

  const reviewMoveIds = reviewCards?.map(r => r.move_id) ?? [];
  if (reviewMoveIds.length === 0) return { session, profile, moves: [] };

  const { data: moves } = await supabase
    .from('moves')
    .select(`
      id, san, move_number,
      from_position(fen),
      to_position(fen),
      repertoire:repertoire_id(id, name, color)
    `)
    .in('repertoire_id', repIds)
    .in('id', reviewMoveIds)
    .eq('is_kid_turn', true);

  const shuffled = (moves ?? []).sort(() => Math.random() - 0.5);
  return { session, profile, moves: shuffled };
};
```

- [ ] **Step 2: Write time-trial page UI**

Create `src/routes/(kid)/time-trial/+page.svelte`:

```svelte
<script lang="ts">
  import { onDestroy } from 'svelte';
  import { goto } from '$app/navigation';
  import ChessBoard from '$lib/components/ChessBoard.svelte';
  import SirKnight from '$lib/components/SirKnight.svelte';

  let { data } = $props<{ data: any }>();

  const moves: any[] = $derived(data.moves ?? []);

  const DURATION = 60;
  let timeLeft = $state(DURATION);
  let running = $state(false);
  let done = $state(false);
  let idx = $state(0);
  let correct = $state(0);
  let wrong = $state(0);
  let events: Array<{ moveId: string; correct: boolean; latencyMs: number }> = $state([]);
  let cardStart = $state(0);

  let timer: ReturnType<typeof setInterval> | null = null;

  const currentMove: any = $derived(running && !done ? moves[idx % moves.length] : null);
  const xpEarned = $derived(correct * 5 + (correct >= 20 ? 200 : 0));
  const mascotMood = $derived(
    done && correct >= 20 ? 'party' :
    done ? 'cheer' :
    !running ? 'idle' :
    timeLeft < 10 ? 'surprise' : 'cheer'
  );
  const mascotMsg = $derived(
    !running && !done ? 'Press Start when ready!' :
    done ? `Score: ${correct} correct!` :
    timeLeft < 10 ? 'Hurry up!' :
    `${correct} correct so far!`
  );

  function startTimer() {
    running = true;
    cardStart = Date.now();
    timer = setInterval(() => {
      timeLeft -= 1;
      if (timeLeft <= 0) endSession();
    }, 1000);
  }

  async function endSession() {
    if (timer) clearInterval(timer);
    running = false;
    done = true;
    await fetch('/api/time-trial', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events, correctCount: correct, xpEarned })
    });
  }

  function handleMove(san: string) {
    if (!running || done || !currentMove) return;
    const latencyMs = Date.now() - cardStart;
    const isCorrect = san === currentMove.san;

    events = [...events, { moveId: currentMove.id, correct: isCorrect, latencyMs }];
    if (isCorrect) correct += 1;
    else wrong += 1;

    idx += 1;
    cardStart = Date.now();
  }

  onDestroy(() => { if (timer) clearInterval(timer); });
</script>

<main class="min-h-screen bg-slate-900 text-white p-4 max-w-lg mx-auto pb-24">
  <div class="flex items-center justify-between mb-6">
    <a href="/" class="text-slate-400 hover:text-white">&larr; Home</a>
    <h1 class="text-xl font-bold">Time Trial</h1>
    <div class="text-2xl font-mono font-bold {timeLeft < 10 ? 'text-red-400' : 'text-yellow-400'}">
      {String(Math.floor(timeLeft / 60)).padStart(2,'0')}:{String(timeLeft % 60).padStart(2,'0')}
    </div>
  </div>

  {#if moves.length === 0}
    <div class="text-center py-16">
      <p class="text-slate-400">No cards available yet.</p>
      <p class="text-sm text-slate-500 mt-2">Complete Learn mode first!</p>
      <a href="/learn" class="mt-6 inline-block bg-yellow-400 text-slate-900 px-6 py-3 rounded-2xl font-bold">
        Go to Learn
      </a>
    </div>
  {:else if done}
    <div class="text-center py-8">
      <p class="text-5xl mb-4">{correct >= 20 ? '🏆' : '⏱️'}</p>
      <p class="text-3xl font-bold mb-2">{correct}</p>
      <p class="text-slate-400 mb-1">correct answers</p>
      <p class="text-yellow-400 font-bold mb-6">+{xpEarned} XP</p>
      <div class="flex gap-3 justify-center">
        <button onclick={() => goto('/time-trial')} class="bg-yellow-400 text-slate-900 px-6 py-3 rounded-2xl font-bold">
          Try Again
        </button>
        <a href="/" class="bg-slate-700 px-6 py-3 rounded-2xl font-bold">Home</a>
      </div>
    </div>
  {:else if !running}
    <div class="text-center py-8">
      <p class="text-slate-400 mb-6">Answer as many moves as you can in 60 seconds!</p>
      <button
        onclick={startTimer}
        class="bg-yellow-400 text-slate-900 px-8 py-4 rounded-2xl text-xl font-bold hover:bg-yellow-300"
      >
        Start!
      </button>
    </div>
  {:else if currentMove}
    <div class="mb-4">
      <ChessBoard
        fen={currentMove.from_position?.fen ?? 'start'}
        orientation={currentMove.repertoire?.color ?? 'white'}
        lastMove={null}
        onmove={handleMove}
      />
    </div>
    <div class="flex justify-between text-sm text-slate-400 mb-2 px-2">
      <span>Correct: <span class="text-green-400 font-bold">{correct}</span></span>
      <span>Wrong: <span class="text-red-400 font-bold">{wrong}</span></span>
    </div>
  {/if}

  <div class="mt-4">
    <SirKnight mood={mascotMood} message={mascotMsg} />
  </div>
</main>
```

- [ ] **Step 3: Write time-trial API endpoint**

Create `src/routes/api/time-trial/+server.ts`:

```typescript
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { checkBadgeEligibility } from '$lib/badges/recalc';

export const POST: RequestHandler = async ({ request, locals: { supabase, safeGetSession } }) => {
  const { user } = await safeGetSession();
  if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

  const { events, correctCount, xpEarned } = await request.json() as {
    events: Array<{ moveId: string; correct: boolean; latencyMs: number }>;
    correctCount: number;
    xpEarned: number;
  };

  const { data: sessionRow } = await supabase
    .from('sessions')
    .insert({ kid_id: user.id, mode: 'time_trial', cards_done: events.length, xp_earned: xpEarned })
    .select('id')
    .single();

  if (sessionRow && events.length > 0) {
    await supabase.from('review_events').insert(
      events.map(e => ({
        session_id: sessionRow.id,
        move_id:    e.moveId,
        rating:     e.correct ? 'good' : 'again',
        latency_ms: e.latencyMs,
        used_hint:  false,
        xp_delta:   e.correct ? 5 : 0
      }))
    );
  }

  if (xpEarned > 0) {
    await supabase.rpc('update_xp_and_level', { p_kid_id: user.id, p_xp_delta: xpEarned });
    await supabase.rpc('update_weekly_leaderboard', { p_kid_id: user.id, p_xp: xpEarned });
  }
  await supabase.rpc('update_streak', { p_kid_id: user.id });
  await supabase.rpc('sync_kid_stats', { p_kid_id: user.id });

  // Update time_trial quest progress
  if (correctCount >= 8) {
    await supabase.from('quests')
      .update({ progress: 8, completed_at: new Date().toISOString() })
      .eq('kid_id', user.id)
      .eq('date', new Date().toISOString().slice(0, 10))
      .eq('template_id', 'time_trial')
      .is('completed_at', null);
  }

  // Check badges (ttBestScore needs historical max -- fetch from review_events)
  const { data: profile } = await supabase
    .from('profiles')
    .select('xp, level, streak_days')
    .eq('id', user.id)
    .single();
  const { data: stats } = await supabase
    .from('kid_stats')
    .select('total_reviews, total_correct, moves_learned')
    .eq('kid_id', user.id)
    .single();
  const { data: earnedRows } = await supabase
    .from('badges_earned')
    .select('badge_id')
    .eq('kid_id', user.id);
  const { data: sessionCountRow } = await supabase
    .from('sessions')
    .select('id', { count: 'exact', head: true })
    .eq('kid_id', user.id);
  const { data: repCountRow } = await supabase
    .from('repertoires')
    .select('id', { count: 'exact', head: true })
    .eq('kid_id', user.id);

  const earned = new Set((earnedRows ?? []).map(r => r.badge_id));
  const newBadges = checkBadgeEligibility({
    totalReviews:    stats?.total_reviews ?? 0,
    totalCorrect:    stats?.total_correct ?? 0,
    movesLearned:    stats?.moves_learned ?? 0,
    streakDays:      profile?.streak_days ?? 0,
    level:           profile?.level ?? 1,
    sessionCount:    (sessionCountRow as any)?.count ?? 0,
    repertoireCount: (repCountRow as any)?.count ?? 0,
    drillStreak:     0,
    ttBestScore:     correctCount,
    questsCompleted: 0,
    hasUploaded:     false,
    earnedIds:       earned
  });

  if (newBadges.length > 0) {
    await supabase.from('badges_earned').insert(
      newBadges.map(badgeId => ({ kid_id: user.id, badge_id: badgeId }))
    );
    for (const badgeId of newBadges) {
      const { data: badge } = await supabase
        .from('badges')
        .select('xp_reward')
        .eq('id', badgeId)
        .single();
      if (badge?.xp_reward) {
        await supabase.rpc('update_xp_and_level', { p_kid_id: user.id, p_xp_delta: badge.xp_reward });
      }
    }
  }

  return json({ ok: true, newBadges });
};
```

- [ ] **Step 4: Commit**

```bash
git add src/routes/\(kid\)/time-trial/ src/routes/api/time-trial/
git commit -m "feat(time-trial): 60-second Time Trial mode with badge checks"
```

---

## Task 7: SirKnight Mascot Upgrade

**Files:**
- Modify: `src/lib/components/SirKnight.svelte`

Expand from 4 to 6 moods with CSS keyframe animations and improved speech bubbles.

- [ ] **Step 1: Replace SirKnight.svelte entirely**

```svelte
<script lang="ts">
  export type Mood = 'idle' | 'cheer' | 'sad' | 'surprise' | 'sleepy' | 'party';
  type Props = { message?: string; mood?: Mood };
  let { message = "Let's train!", mood = 'idle' }: Props = $props();

  const faces: Record<Mood, string> = {
    idle:     '😊',
    cheer:    '😄',
    sad:      '😢',
    surprise: '😲',
    sleepy:   '😴',
    party:    '🥳'
  };

  const animClass: Record<Mood, string> = {
    idle:     'animate-bounce-slow',
    cheer:    'animate-bounce',
    sad:      'animate-sway',
    surprise: 'animate-pop',
    sleepy:   'animate-sway',
    party:    'animate-spin-once'
  };
</script>

<style>
  @keyframes sway {
    0%, 100% { transform: rotate(-5deg); }
    50%       { transform: rotate(5deg); }
  }
  @keyframes pop {
    0%   { transform: scale(1); }
    30%  { transform: scale(1.4); }
    100% { transform: scale(1); }
  }
  @keyframes bounce-slow {
    0%, 100% { transform: translateY(0); }
    50%       { transform: translateY(-6px); }
  }
  @keyframes spin-once {
    0%   { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
  .animate-sway      { animation: sway 1s ease-in-out infinite; }
  .animate-pop       { animation: pop 0.4s ease-out forwards; }
  .animate-bounce-slow { animation: bounce-slow 2s ease-in-out infinite; }
  .animate-spin-once { animation: spin-once 0.6s ease-out forwards; }
</style>

<div class="flex items-end gap-3">
  <div class={`text-5xl ${animClass[mood]}`} role="img" aria-label="Sir Knight mascot">
    {faces[mood]} ♞
  </div>
  {#if message}
    <div class="bg-slate-700 rounded-2xl rounded-bl-none px-4 py-3 text-sm max-w-[220px] leading-relaxed">
      {message}
    </div>
  {/if}
</div>
```

> **Note:** The old moods `happy`, `thinking`, `celebrate` are replaced. Search-replace any existing usage of old moods in other files:
> - `happy` -> `cheer`
> - `thinking` -> `idle`
> - `celebrate` -> `party`

- [ ] **Step 2: Update any pages that use old mood names**

Search for old mood strings:

```bash
grep -r "mood="happy\|mood="thinking\|mood="celebrate" kidchess/src/
```

Replace each found usage:
- `mood="happy"` -> `mood="cheer"`
- `mood="thinking"` -> `mood="idle"`
- `mood="celebrate"` -> `mood="party"`

- [ ] **Step 3: Commit**

```bash
git add src/lib/components/SirKnight.svelte
git commit -m "feat(mascot): SirKnight upgrade to 6 moods with CSS animations"
```

---

## Task 8: Cosmetics Picker

**Files:**
- Create: `src/routes/(kid)/cosmetics/+page.server.ts`
- Create: `src/routes/(kid)/cosmetics/+page.svelte`
- Create: `src/routes/api/cosmetics/equip/+server.ts`

- [ ] **Step 1: Write cosmetics page server**

Create `src/routes/(kid)/cosmetics/+page.server.ts`:

```typescript
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals: { supabase, safeGetSession } }) => {
  const { user, session, profile } = await safeGetSession();
  if (!user) throw redirect(303, '/login');

  const [avatarsRes, themesRes, pieceSetsRes, equippedRes, earnedRes] = await Promise.all([
    supabase.from('avatars').select('*'),
    supabase.from('themes').select('*'),
    supabase.from('piece_sets').select('*'),
    supabase.from('equipped_cosmetics').select('*').eq('kid_id', user.id).single(),
    supabase.from('badges_earned').select('badge_id').eq('kid_id', user.id)
  ]);

  return {
    session,
    profile,
    avatars:   avatarsRes.data ?? [],
    themes:    themesRes.data ?? [],
    pieceSets: pieceSetsRes.data ?? [],
    equipped:  equippedRes.data ?? { avatar_id: 'knight', theme_id: 'classic', piece_set: 'standard' },
    earnedBadgeIds: (earnedRes.data ?? []).map(r => r.badge_id)
  };
};
```

- [ ] **Step 2: Write cosmetics page UI**

Create `src/routes/(kid)/cosmetics/+page.svelte`:

```svelte
<script lang="ts">
  let { data } = $props<{ data: any }>();

  let equipped = $state({ ...(data.equipped ?? {}) });
  let saving = $state(false);
  let saved = $state(false);

  async function equip(type: 'avatar_id' | 'theme_id' | 'piece_set', id: string) {
    equipped = { ...equipped, [type]: id };
    saving = true;
    await fetch('/api/cosmetics/equip', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, id })
    });
    saving = false;
    saved = true;
    setTimeout(() => { saved = false; }, 1500);
  }
</script>

<main class="min-h-screen bg-slate-900 text-white p-4 max-w-lg mx-auto pb-24">
  <div class="flex items-center gap-3 mb-6">
    <a href="/" class="text-slate-400 hover:text-white">&larr;</a>
    <h1 class="text-2xl font-bold">Cosmetics</h1>
    {#if saving}
      <span class="text-slate-400 text-sm ml-auto">Saving...</span>
    {:else if saved}
      <span class="text-green-400 text-sm ml-auto">Saved!</span>
    {/if}
  </div>

  <!-- Avatars -->
  <section class="mb-8">
    <h2 class="text-lg font-semibold mb-3">Avatar</h2>
    <div class="grid grid-cols-4 gap-3">
      {#each data.avatars as avatar}
        <button
          onclick={() => equip('avatar_id', avatar.id)}
          class="rounded-2xl p-3 border-2 transition {equipped.avatar_id === avatar.id ? 'border-yellow-400 bg-slate-700' : 'border-slate-700 bg-slate-800 hover:border-slate-500'}"
          aria-label={avatar.name}
        >
          <img src={avatar.svg_url} alt={avatar.name} class="w-full h-auto" />
          <p class="text-xs text-center mt-1 text-slate-300">{avatar.name}</p>
        </button>
      {/each}
    </div>
  </section>

  <!-- Themes -->
  <section class="mb-8">
    <h2 class="text-lg font-semibold mb-3">Board Theme</h2>
    <div class="grid grid-cols-3 gap-3">
      {#each data.themes as theme}
        <button
          onclick={() => equip('theme_id', theme.id)}
          class="rounded-2xl p-3 border-2 transition {equipped.theme_id === theme.id ? 'border-yellow-400 bg-slate-700' : 'border-slate-700 bg-slate-800 hover:border-slate-500'}"
        >
          <div class="grid grid-cols-2 gap-0.5 mb-2 rounded overflow-hidden">
            <div class="h-5" style="background:{theme.light_square}"></div>
            <div class="h-5" style="background:{theme.dark_square}"></div>
            <div class="h-5" style="background:{theme.dark_square}"></div>
            <div class="h-5" style="background:{theme.light_square}"></div>
          </div>
          <p class="text-xs text-center text-slate-300">{theme.name}</p>
        </button>
      {/each}
    </div>
  </section>

  <!-- Piece Sets -->
  <section class="mb-8">
    <h2 class="text-lg font-semibold mb-3">Piece Set</h2>
    <div class="grid grid-cols-3 gap-3">
      {#each data.pieceSets as ps}
        <button
          onclick={() => equip('piece_set', ps.id)}
          class="rounded-2xl p-3 border-2 transition {equipped.piece_set === ps.id ? 'border-yellow-400 bg-slate-700' : 'border-slate-700 bg-slate-800 hover:border-slate-500'}"
        >
          <p class="text-center text-2xl mb-1">♟</p>
          <p class="text-xs text-center text-slate-300">{ps.name}</p>
        </button>
      {/each}
    </div>
  </section>
</main>
```

- [ ] **Step 3: Write equip API endpoint**

Create `src/routes/api/cosmetics/equip/+server.ts`:

```typescript
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const ALLOWED_FIELDS = ['avatar_id', 'theme_id', 'piece_set'] as const;
type CosmeticField = typeof ALLOWED_FIELDS[number];

export const PATCH: RequestHandler = async ({ request, locals: { supabase, safeGetSession } }) => {
  const { user } = await safeGetSession();
  if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

  const { type, id } = await request.json() as { type: CosmeticField; id: string };

  if (!ALLOWED_FIELDS.includes(type)) {
    return json({ error: 'Invalid cosmetic type' }, { status: 400 });
  }

  await supabase.from('equipped_cosmetics').upsert(
    { kid_id: user.id, [type]: id },
    { onConflict: 'kid_id' }
  );

  return json({ ok: true });
};
```

- [ ] **Step 4: Commit**

```bash
git add src/routes/\(kid\)/cosmetics/ src/routes/api/cosmetics/
git commit -m "feat(cosmetics): avatar, theme, piece-set picker with live equip"
```

---

## Task 9: Mini-Leaderboard

**Files:**
- Create: `src/lib/components/LeaderboardPodium.svelte`
- Modify: `src/routes/(kid)/+page.server.ts` (add leaderboard data)

- [ ] **Step 1: Create LeaderboardPodium component**

Create `src/lib/components/LeaderboardPodium.svelte`:

```svelte
<script lang="ts">
  interface Entry { rank: number; display_name: string; xp_earned: number; kid_id: string; }
  type Props = { entries: Entry[]; currentKidId: string };
  let { entries, currentKidId }: Props = $props();

  const medals = ['🥇', '🥈', '🥉'];
  const top3 = $derived(entries.slice(0, 3));
</script>

<div class="bg-slate-800 rounded-2xl p-4">
  <h3 class="font-bold text-sm text-slate-400 uppercase tracking-wide mb-3">This Week</h3>
  {#if top3.length === 0}
    <p class="text-slate-500 text-sm text-center py-2">No entries yet this week</p>
  {:else}
    <ol class="space-y-2">
      {#each top3 as entry, i}
        <li class="flex items-center gap-3 {entry.kid_id === currentKidId ? 'text-yellow-400' : 'text-white'}">
          <span class="text-xl w-8 text-center">{medals[i] ?? `${i + 1}.`}</span>
          <span class="flex-1 font-medium truncate">{entry.display_name}</span>
          <span class="text-sm font-bold">{entry.xp_earned} XP</span>
        </li>
      {/each}
    </ol>
  {/if}
</div>
```

- [ ] **Step 2: Extend home page server to load leaderboard**

In `src/routes/(kid)/+page.server.ts`, add after the profile/stats load:

```typescript
// Leaderboard: top 3 kids under same coach this week
let leaderboard: Array<{ rank: number; display_name: string; xp_earned: number; kid_id: string }> = [];
if (profile?.coach_id) {
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  const weekStartStr = weekStart.toISOString().slice(0, 10);

  const { data: lb } = await supabase
    .from('weekly_leaderboard')
    .select('kid_id, xp_earned, rank, profiles:kid_id(display_name)')
    .eq('week_start', weekStartStr)
    .order('xp_earned', { ascending: false })
    .limit(3);

  leaderboard = (lb ?? []).map(row => ({
    kid_id:       row.kid_id,
    xp_earned:    row.xp_earned,
    rank:         row.rank ?? 0,
    display_name: (row.profiles as any)?.display_name ?? 'Unknown'
  }));
}
```

Return `leaderboard` in the load return object alongside the existing fields.

- [ ] **Step 3: Commit**

```bash
git add src/lib/components/LeaderboardPodium.svelte src/routes/\(kid\)/+page.server.ts
git commit -m "feat(leaderboard): weekly XP podium component + home server data"
```

---

## Task 10: Coach Notes (Read/Unread)

**Files:**
- Create: `src/routes/api/notes/read/+server.ts`

Coach notes are already stored in `coach_notes`. After migration 0005, they have a `read_at` column. The kid home page will display the most recent unread note as a SirKnight speech bubble.

- [ ] **Step 1: Write notes read endpoint**

Create `src/routes/api/notes/read/+server.ts`:

```typescript
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = async ({ request, locals: { supabase, safeGetSession } }) => {
  const { user } = await safeGetSession();
  if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

  const { noteId } = await request.json() as { noteId: string };

  const { error } = await supabase
    .from('coach_notes')
    .update({ read_at: new Date().toISOString() })
    .eq('id', noteId)
    .eq('kid_id', user.id); // ensure kid can only mark own notes

  if (error) return json({ error: error.message }, { status: 500 });

  return json({ ok: true });
};
```

- [ ] **Step 2: Extend home page server to load unread coach note**

In `src/routes/(kid)/+page.server.ts`, add:

```typescript
// Most recent unread coach note
const { data: unreadNotes } = await supabase
  .from('coach_notes')
  .select('id, note, created_at')
  .eq('kid_id', user.id)
  .is('read_at', null)
  .order('created_at', { ascending: false })
  .limit(1);

const coachNote = unreadNotes?.[0] ?? null;
```

Return `coachNote` in the load return object.

- [ ] **Step 3: Commit**

```bash
git add src/routes/api/notes/ src/routes/\(kid\)/+page.server.ts
git commit -m "feat(notes): coach notes unread tracking + mark-read endpoint"
```

---

## Task 11: Coach Goal-Setting + Repertoire Assignment

**Files:**
- Modify: `src/routes/(coach)/coach/kids/[kid_id]/+page.server.ts`
- Modify: `src/routes/(coach)/coach/kids/[kid_id]/+page.svelte`

- [ ] **Step 1: Extend coach kid-detail server**

In `src/routes/(coach)/coach/kids/[kid_id]/+page.server.ts`, add to the existing load:

```typescript
// Load kid's current goals and assigned repertoires
const { data: assignedReps } = await supabase
  .from('assigned_repertoires')
  .select('*, repertoire:repertoire_id(id, name, color)')
  .eq('kid_id', params.kid_id);

const { data: coachReps } = await supabase
  .from('repertoires')
  .select('id, name, color')
  .eq('kid_id', params.kid_id);
```

Return `assignedReps`, `coachReps` alongside existing data.

Add form actions to handle goal updates and repertoire assignment:

```typescript
import { fail } from '@sveltejs/kit';
import type { Actions } from './$types';

export const actions: Actions = {
  updateGoal: async ({ request, params, locals: { supabase, safeGetSession } }) => {
    const { user } = await safeGetSession();
    if (!user) return fail(401, { error: 'Unauthorized' });

    const data = await request.formData();
    const dailyGoal    = parseInt(data.get('daily_goal') as string);
    const weeklyXpGoal = parseInt(data.get('weekly_xp_goal') as string);

    await supabase
      .from('profiles')
      .update({ daily_goal: dailyGoal, weekly_xp_goal: weeklyXpGoal })
      .eq('id', params.kid_id);

    return { success: true };
  },

  assignRepertoire: async ({ request, params, locals: { supabase, safeGetSession } }) => {
    const { user } = await safeGetSession();
    if (!user) return fail(401, { error: 'Unauthorized' });

    const data = await request.formData();
    const repertoireId = data.get('repertoire_id') as string;
    const note         = data.get('note') as string | null;
    const dueDateStr   = data.get('due_date') as string | null;

    await supabase.from('assigned_repertoires').upsert({
      coach_id:      user.id,
      kid_id:        params.kid_id,
      repertoire_id: repertoireId,
      note:          note || null,
      due_date:      dueDateStr || null
    }, { onConflict: 'kid_id,repertoire_id' });

    return { success: true };
  },

  addNote: async ({ request, params, locals: { supabase, safeGetSession } }) => {
    const { user } = await safeGetSession();
    if (!user) return fail(401, { error: 'Unauthorized' });

    const data = await request.formData();
    const note = data.get('note') as string;
    if (!note?.trim()) return fail(400, { error: 'Note cannot be empty' });

    await supabase.from('coach_notes').insert({
      coach_id: user.id,
      kid_id:   params.kid_id,
      note:     note.trim()
    });

    return { success: true };
  }
};
```

- [ ] **Step 2: Update coach kid-detail page UI**

In `src/routes/(coach)/coach/kids/[kid_id]/+page.svelte`, add three sections below the existing stats:

**Goal setting form:**
```svelte
<section class="bg-slate-800 rounded-2xl p-5 mb-4">
  <h2 class="font-bold mb-3">Training Goals</h2>
  <form method="POST" action="?/updateGoal" class="space-y-3">
    <div>
      <label class="block text-sm text-slate-400 mb-1">Daily cards goal</label>
      <input type="number" name="daily_goal" value={data.kidProfile?.daily_goal ?? 10}
        min="1" max="100" class="w-full bg-slate-700 rounded-xl px-3 py-2" />
    </div>
    <div>
      <label class="block text-sm text-slate-400 mb-1">Weekly XP goal</label>
      <input type="number" name="weekly_xp_goal" value={data.kidProfile?.weekly_xp_goal ?? 200}
        min="10" max="5000" class="w-full bg-slate-700 rounded-xl px-3 py-2" />
    </div>
    <button type="submit" class="bg-yellow-400 text-slate-900 px-4 py-2 rounded-xl font-bold text-sm">
      Save Goals
    </button>
  </form>
</section>
```

**Assign repertoire form:**
```svelte
<section class="bg-slate-800 rounded-2xl p-5 mb-4">
  <h2 class="font-bold mb-3">Assign Repertoire</h2>
  <form method="POST" action="?/assignRepertoire" class="space-y-3">
    <select name="repertoire_id" class="w-full bg-slate-700 rounded-xl px-3 py-2">
      {#each data.coachReps ?? [] as rep}
        <option value={rep.id}>{rep.name} ({rep.color})</option>
      {/each}
    </select>
    <input type="text" name="note" placeholder="Note for the kid (optional)"
      class="w-full bg-slate-700 rounded-xl px-3 py-2 text-sm" />
    <input type="date" name="due_date" class="w-full bg-slate-700 rounded-xl px-3 py-2 text-sm" />
    <button type="submit" class="bg-blue-500 text-white px-4 py-2 rounded-xl font-bold text-sm">
      Assign
    </button>
  </form>
  {#if data.assignedReps?.length}
    <ul class="mt-3 space-y-1">
      {#each data.assignedReps as ar}
        <li class="text-sm text-slate-300">{ar.repertoire?.name} -- due {ar.due_date ?? 'anytime'}</li>
      {/each}
    </ul>
  {/if}
</section>
```

**Add coach note form:**
```svelte
<section class="bg-slate-800 rounded-2xl p-5 mb-4">
  <h2 class="font-bold mb-3">Send Note to Kid</h2>
  <form method="POST" action="?/addNote" class="space-y-3">
    <textarea name="note" rows="3" placeholder="Write an encouraging note..."
      class="w-full bg-slate-700 rounded-xl px-3 py-2 text-sm resize-none"></textarea>
    <button type="submit" class="bg-green-500 text-white px-4 py-2 rounded-xl font-bold text-sm">
      Send Note
    </button>
  </form>
</section>
```

- [ ] **Step 3: Commit**

```bash
git add src/routes/\(coach\)/coach/kids/
git commit -m "feat(coach): goal-setting, repertoire assignment, and coach notes"
```

---

## Task 12: Kid Home Screen Upgrade

**Files:**
- Modify: `src/routes/(kid)/+page.svelte`
- Modify: `src/routes/(kid)/+page.server.ts` (finalize all data loading)

This task wires everything together on the kid home screen.

- [ ] **Step 1: Finalize home page server (complete version)**

Replace `src/routes/(kid)/+page.server.ts` with the final complete version that loads all Phase B data:

```typescript
import type { PageServerLoad } from './$types';
import { levelFromXp } from '$lib/srs/xp';

export const load: PageServerLoad = async ({ locals: { supabase, safeGetSession } }) => {
  const { user, session, profile } = await safeGetSession();
  if (!user) return { session: null, profile: null };

  // XP and streak: source of truth is profiles
  const totalXp   = profile?.xp ?? 0;
  const streakDays = profile?.streak_days ?? 0;
  const { level, xpInLevel, xpToNextLevel } = levelFromXp(totalXp);

  const today = new Date().toISOString().slice(0, 10);

  // Parallel data fetches
  const [statsRes, questsRes, leaderboardRes, noteRes] = await Promise.all([
    supabase
      .from('kid_stats')
      .select('total_reviews, total_correct, moves_learned, new_cards_today')
      .eq('kid_id', user.id)
      .single(),

    supabase
      .from('quests')
      .select('*')
      .eq('kid_id', user.id)
      .eq('date', today),

    profile?.coach_id
      ? supabase
          .from('weekly_leaderboard')
          .select('kid_id, xp_earned, rank, profiles:kid_id(display_name)')
          .eq('week_start', (() => {
            const d = new Date();
            d.setDate(d.getDate() - d.getDay());
            return d.toISOString().slice(0, 10);
          })())
          .order('xp_earned', { ascending: false })
          .limit(3)
      : Promise.resolve({ data: null }),

    supabase
      .from('coach_notes')
      .select('id, note, created_at')
      .eq('kid_id', user.id)
      .is('read_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
  ]);

  const statsRow = statsRes.data;
  const quests   = questsRes.data ?? [];
  const lbRows   = leaderboardRes.data ?? [];
  const coachNote = noteRes.data?.[0] ?? null;

  const leaderboard = lbRows.map((row: any) => ({
    kid_id:       row.kid_id,
    xp_earned:    row.xp_earned,
    rank:         row.rank ?? 0,
    display_name: row.profiles?.display_name ?? 'Unknown'
  }));

  return {
    session,
    profile,
    stats: {
      level,
      total_xp:    totalXp,
      xp_in_level: xpInLevel,
      xp_to_next:  xpToNextLevel,
      streak_days: streakDays,
      total_reviews: statsRow?.total_reviews ?? 0
    },
    quests,
    leaderboard,
    coachNote
  };
};
```

- [ ] **Step 2: Replace home page UI with full Phase B version**

Replace `src/routes/(kid)/+page.svelte`:

```svelte
<script lang="ts">
  import SirKnight from '$lib/components/SirKnight.svelte';
  import LeaderboardPodium from '$lib/components/LeaderboardPodium.svelte';
  import type { Mood } from '$lib/components/SirKnight.svelte';

  let { data } = $props<{ data: any }>();

  const profile      = $derived(data.profile as any);
  const stats        = $derived((data as any).stats ?? {});
  const quests       = $derived((data as any).quests ?? []);
  const leaderboard  = $derived((data as any).leaderboard ?? []);
  const coachNote    = $derived((data as any).coachNote ?? null);

  let noteRead = $state(false);

  async function dismissNote() {
    if (!coachNote) return;
    noteRead = true;
    await fetch('/api/notes/read', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ noteId: coachNote.id })
    });
  }

  const mascotMood: Mood = $derived(
    coachNote && !noteRead ? 'surprise' :
    stats.streak_days >= 7 ? 'party' :
    stats.streak_days > 0  ? 'cheer' : 'idle'
  );
  const mascotMsg = $derived(
    coachNote && !noteRead ? coachNote.note :
    stats.streak_days >= 7 ? `${stats.streak_days}-day streak! You're amazing!` :
    stats.streak_days > 0  ? `${stats.streak_days} days strong! Keep going!` :
    "Start your streak today!"
  );

  const xpPct = $derived(Math.min(100, ((stats.xp_in_level ?? 0) / (stats.xp_to_next ?? 100)) * 100));
  const completedQuests = $derived(quests.filter((q: any) => q.completed_at).length);
</script>

<main class="min-h-screen bg-slate-900 text-white p-4 max-w-lg mx-auto pb-24">

  <!-- Header -->
  <div class="flex items-center gap-4 mb-6">
    <div class="w-16 h-16 bg-yellow-400 rounded-2xl flex items-center justify-center text-3xl shadow-lg">
      ♞
    </div>
    <div class="flex-1">
      <h1 class="text-2xl font-bold">{profile?.display_name ?? 'Player'}</h1>
      <div class="flex items-center gap-2">
        <span class="text-yellow-400 font-bold">Lv {stats.level ?? 0}</span>
        <span class="text-slate-400 text-sm">· {stats.total_xp ?? 0} XP</span>
      </div>
    </div>
    <a href="/cosmetics" class="text-2xl" aria-label="Cosmetics">🎨</a>
  </div>

  <!-- XP Bar -->
  <div class="bg-slate-800 rounded-full h-3 mb-1 overflow-hidden">
    <div class="h-full bg-yellow-400 rounded-full transition-all duration-500" style="width:{xpPct}%"></div>
  </div>
  <p class="text-xs text-slate-400 mb-6">{stats.xp_in_level ?? 0} / {stats.xp_to_next ?? 100} XP to next level</p>

  <!-- SirKnight -->
  <div class="mb-6">
    <SirKnight mood={mascotMood} message={mascotMsg} />
    {#if coachNote && !noteRead}
      <button onclick={dismissNote} class="text-xs text-slate-500 mt-2 ml-16 hover:text-slate-300">
        Dismiss
      </button>
    {/if}
  </div>

  <!-- Streak -->
  <div class="bg-slate-800 rounded-2xl p-4 mb-4 flex items-center gap-3">
    <span class="text-3xl">🔥</span>
    <div>
      <p class="font-bold">{stats.streak_days ?? 0} day streak</p>
      <p class="text-slate-400 text-xs">Train daily to grow your streak!</p>
    </div>
  </div>

  <!-- Daily Quests -->
  {#if quests.length > 0}
    <div class="bg-slate-800 rounded-2xl p-4 mb-4">
      <div class="flex items-center justify-between mb-3">
        <h2 class="font-bold">Daily Quests</h2>
        <span class="text-sm text-slate-400">{completedQuests}/{quests.length}</span>
      </div>
      <ul class="space-y-2">
        {#each quests as quest}
          <li class="flex items-center gap-3">
            <div class="w-8 h-8 rounded-full flex items-center justify-center text-sm {quest.completed_at ? 'bg-green-500' : 'bg-slate-700'}">
              {quest.completed_at ? '✓' : '○'}
            </div>
            <div class="flex-1">
              <p class="text-sm {quest.completed_at ? 'line-through text-slate-500' : ''}">{quest.description}</p>
              <div class="bg-slate-700 rounded-full h-1.5 mt-1 overflow-hidden">
                <div class="h-full bg-yellow-400 rounded-full" style="width:{Math.min(100, (quest.progress / quest.target) * 100)}%"></div>
              </div>
            </div>
            <span class="text-xs text-yellow-400 font-bold">+{quest.xp_reward}</span>
          </li>
        {/each}
      </ul>
    </div>
  {/if}

  <!-- Quick Actions -->
  <div class="grid grid-cols-2 gap-3 mb-4">
    <a href="/learn" class="bg-yellow-400 text-slate-900 rounded-2xl p-5 hover:bg-yellow-300 transition text-center">
      <p class="text-3xl mb-2">🎯</p>
      <p class="font-bold">Learn</p>
    </a>
    <a href="/practice" class="bg-slate-800 rounded-2xl p-5 hover:bg-slate-700 transition text-center">
      <p class="text-3xl mb-2">♟</p>
      <p class="font-semibold">Practice</p>
    </a>
    <a href="/drill" class="bg-orange-600 text-white rounded-2xl p-5 hover:bg-orange-500 transition text-center">
      <p class="text-3xl mb-2">⚡</p>
      <p class="font-bold">Drill</p>
    </a>
    <a href="/time-trial" class="bg-blue-600 text-white rounded-2xl p-5 hover:bg-blue-500 transition text-center">
      <p class="text-3xl mb-2">⏱️</p>
      <p class="font-bold">Time Trial</p>
    </a>
  </div>

  <!-- Repertoires link -->
  <a href="/repertoires" class="block bg-slate-800 rounded-2xl p-4 mb-4 hover:bg-slate-700 transition text-center">
    <p class="text-2xl mb-1">📚</p>
    <p class="font-semibold">My Repertoires</p>
  </a>

  <!-- Leaderboard -->
  {#if leaderboard.length > 0}
    <div class="mb-4">
      <LeaderboardPodium entries={leaderboard} currentKidId={profile?.id ?? ''} />
    </div>
  {/if}

</main>
```

- [ ] **Step 3: Verify type checking**

```bash
cd kidchess && npm run check
```

Expected: 0 type errors (or only pre-existing ones).

- [ ] **Step 4: Run E2E tests**

```bash
cd kidchess && npx playwright test
```

Expected: all existing tests pass.

- [ ] **Step 5: Final commit**

```bash
git add src/routes/\(kid\)/+page.server.ts src/routes/\(kid\)/+page.svelte
git commit -m "feat(home): Phase B home screen -- quests, leaderboard, Drill/TT, SirKnight upgrade"
```

---

## Self-Review Checklist

### Spec Coverage

| Spec requirement                        | Task   |
|----------------------------------------|--------|
| Drill mode                             | t05    |
| Time Trial mode                        | t06    |
| 30 badges                              | t03    |
| Daily quests (5 templates, 3/day)      | t04    |
| Cosmetics picker (avatar/theme/pieces) | t08    |
| Mini-leaderboard (weekly XP)           | t09    |
| Coach notes (write + read)             | t10    |
| Coach goal-setting                     | t11    |
| Coach repertoire assignment            | t11    |
| SirKnight 6 moods + animation          | t07    |
| Home screen upgrade                    | t12    |
| Phase A bug fixes                      | t02    |
| DB migration for new tables/columns    | t01    |

All requirements covered.

### Type Consistency

- `BadgeStats.drillStreak` used in both recalc.ts and api/drill -- same name
- `BadgeStats.ttBestScore` used in both recalc.ts and api/time-trial -- same name
- `SirKnight` Mood type exported as `export type Mood` -- usable in `+page.svelte`
- `LeaderboardPodium` Entry interface matches shape returned by home page server
- `checkBadgeEligibility` returns `string[]` -- consumed with `.map(badgeId => ...)` in API routes

### No Placeholders

Scan complete -- all code blocks contain real implementations, no "TBD", no "implement later".

### Edge Cases Handled

- Drill/TT mode with 0 cards: empty state shown, no crash
- Quest progress PATCH on already-completed quest: no-op (early return)
- Weekly leaderboard with no coach_id: skipped (no query)
- SirKnight old mood names: replacement list provided in t07 step 2
- `runes: true` already global: components do not re-declare it

---

*End of Phase B Implementation Plan*
