# Many-to-Many Coach–Player Relationship Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single `profiles.coach_id` column with a many-to-many `coach_players` relationship table, supporting invite-link redemption (implicit consent) and a new direct request/accept flow on both sides, with browsable coach/player directories.

**Architecture:** A new `coach_players` table (status `pending`/`active`, `requested_by` tracking who's waiting on whom) replaces `profiles.coach_id` everywhere. All existing coach-read RLS policies move from `coach_id = auth.uid()` to an active-relationship `exists` check. Two new narrow-column views (`coach_directory`, `player_directory`) support browsing profiles you have no relationship with yet, without widening `profiles`' own RLS. A pure decision function (`planRequest`) centralizes "can this request be sent" logic and is unit-tested directly; the Supabase-touching IO layer around it is not (matching this codebase's existing precedent for similar helpers).

**Tech Stack:** SvelteKit 2 / Svelte 5 (runes), `@supabase/ssr`, Postgres RLS.

Spec: `docs/superpowers/specs/2026-07-06-coach-player-relationship-design.md`

**A note on scope beyond the spec:** while mapping out the migration, two things came up that the spec didn't anticipate (found by tracing every existing reference to `profiles.coach_id`):
1. `update_weekly_leaderboard()` (a Postgres RPC) groups players for ranking by `coach_id` — it would break outright once the column is dropped. Task 1 re-points it at `coach_players`, using each player's earliest-formed active coach relationship as its reference group. This preserves today's exact behavior for the (currently universal) single-coach case; multi-coach leaderboard semantics are intentionally left simple rather than redesigned here.
2. Preventing self-approval requires more care in the RLS policies than "any participant can update/insert" — see Task 1's `coach_players` policies and their inline comments for the reasoning (a requester must not be able to flip their own pending request to `active`).
3. The spec's file list named `src/routes/(coach)/coach/players/[player_id]/+page.server.ts` as needing modification. Tracing its actual queries (Task 1 prep) found it never references `profiles.coach_id` directly — it relies entirely on RLS to scope what a coach can see/write for a given `player_id`. Once Task 1's RLS rewrite lands, this file needs no code change at all; it inherits the new relationship-based access automatically. No task touches it.

Both new findings (1 and 2) are documented inline in Task 1 rather than being separate tasks, since they're part of getting the migration itself correct.

**Two more findings surfaced by code-quality review of Task 1, after the plan was first written:**
4. The original `coach_players_participant_update` policy's `with check` assumed `coach_id`/`player_id`/`requested_by` stay fixed across an UPDATE — but RLS's `WITH CHECK` only validates the *new* row, with no way to reference the *old* row, so nothing actually stopped a participant from rewriting those columns in the same statement that flips `status` to `active` (self-approving their own request, or hijacking an active relationship onto a different, non-consenting party). Fixed with a `BEFORE UPDATE` trigger that rejects any change to those three columns and rejects reverting `active` back to `pending`. The RLS policy itself is still needed and correct — the trigger is an addition, not a replacement.
5. The `coach_directory`/`player_directory` views' comment claimed `grant select ... to authenticated` was sufficient to keep them authenticated-only, but Supabase projects typically have default privileges that already grant `anon` read on new `public` schema objects too, which an additive grant doesn't revoke. Fixed with an explicit `revoke all ... from anon, public` after each grant.
6. `browseDirectory`'s search filter (Task 3) built a PostgREST `.or(...)` filter by directly interpolating the user's search text — since that filter syntax is comma-separated, a search term containing a comma (e.g. someone typing a name like "Smith, John") would silently break the query. Not a security issue (the value can only ever filter the 5 already-public directory columns), just a real correctness bug. Fixed by escaping `"`/`\` and wrapping each term in PostgREST's quoted-literal syntax.
7. Task 4's original `upsert(..., { onConflict: 'coach_id,player_id' })` collided with Task 1's `coach_players_guard_update` trigger whenever a `coach_players` row already existed for that (coach, player) pair with a *different* `requested_by` — e.g. the player had already sent a direct request to that coach — because the upsert's UPDATE branch tried to change `requested_by`, which the trigger forbids. The upsert's error was also never checked, so the invite got marked redeemed regardless, leaving the relationship stuck `pending` with no retry path. Fixed by checking for an existing row first and, on activation, only ever touching `status`/`responded_at` (never the locked columns), plus checking every write's result before marking the invite redeemed.

Task 1, Task 3, and Task 4's SQL/code below already reflect all fixes.

**Operational note, revised:** this project has no local Postgres — all migrations are applied directly to the live Supabase project via the dashboard's SQL editor (the same process used for two smaller migrations earlier this session). Task 1 produces one complete, ready-to-paste SQL file, but **it must NOT be applied to production right after Task 1** — the live site is still running code that reads/writes `profiles.coach_id` (invite redemption, the coach dashboard, the PGN player-picker), and dropping that column immediately would break all three. Apply this migration only once Tasks 1–6 (everything that touches `coach_id`) have all been implemented and code-reviewed — i.e., immediately before Task 10's manual verification step. Task 10 has been updated to include this as its first step.

---

### Task 1: Migration — `coach_players` table, RLS rewrite, directory views, data migration

**Files:**
- Create: `mychess/supabase/migrations/0019_coach_players.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Replaces the single-coach-per-player model (profiles.coach_id) with a
-- many-to-many coach<->player relationship. Two ways to form a relationship:
--   1. Invite-link redemption (existing flow) — inserted directly as
--      'active' via a service-role client (see join/[token]/+page.server.ts),
--      since redemption already proves both sides' consent.
--   2. Direct request — either side requests the other (status='pending',
--      requested_by=the requester), the other side accepts (-> 'active') or
--      declines (row deleted).

create table public.coach_players (
  id            uuid primary key default gen_random_uuid(),
  coach_id      uuid not null references public.profiles(id),
  player_id     uuid not null references public.profiles(id) on delete cascade,
  status        text not null check (status in ('pending', 'active')),
  requested_by  uuid not null references public.profiles(id),
  created_at    timestamptz not null default now(),
  responded_at  timestamptz,
  unique (coach_id, player_id)
);
alter table public.coach_players enable row level security;

create policy coach_players_participant_read on public.coach_players
  for select using (coach_id = auth.uid() or player_id = auth.uid());

-- A regular (non-service-role) client may only ever insert a *pending*
-- request naming themselves as the requester — this is what stops a
-- malicious client from inserting a pre-approved 'active' row directly.
-- Invite-link redemption needs to insert as 'active' and bypasses this via a
-- service-role client instead (see join/[token]/+page.server.ts).
create policy coach_players_participant_insert on public.coach_players
  for insert with check (
    (coach_id = auth.uid() or player_id = auth.uid())
    and requested_by = auth.uid()
    and status = 'pending'
  );

-- Update is for accepting a pending request. The check clause stops the
-- original requester from approving their own request: after the update,
-- either the row is still pending, or (if now active) the acting user must
-- NOT be the requester — only the other party can activate it.
create policy coach_players_participant_update on public.coach_players
  for update
  using (coach_id = auth.uid() or player_id = auth.uid())
  with check (
    (coach_id = auth.uid() or player_id = auth.uid())
    and (status = 'pending' or requested_by <> auth.uid())
  );

-- Delete covers both cancelling your own pending request and declining one
-- you received, plus unlinking an active relationship — any participant, any
-- status, no extra restriction needed for any of those three cases.
create policy coach_players_participant_delete on public.coach_players
  for delete using (coach_id = auth.uid() or player_id = auth.uid());

-- Migrate existing single-coach data: every profile with a coach_id today
-- becomes one active row, requested_by the coach (today's model is always
-- coach-initiated, via invite link).
insert into public.coach_players (coach_id, player_id, status, requested_by, responded_at)
select coach_id, id, 'active', coach_id, created_at
from public.profiles
where coach_id is not null;

-- Directory views for browsing profiles you have no relationship with yet.
-- Deliberately NOT security_invoker: the point is to expose a narrow column
-- set that profiles' own RLS does not grant to an unconnected user. Access is
-- controlled by the GRANT below (authenticated only), not a view-level RLS
-- check, and the view only ever returns 5 columns regardless of caller.
create view public.coach_directory as
select id, first_name, last_name, display_name, avatar_id
from public.profiles
where role = 'coach';
grant select on public.coach_directory to authenticated;

create view public.player_directory as
select id, first_name, last_name, display_name, avatar_id
from public.profiles
where role = 'player';
grant select on public.player_directory to authenticated;

-- Replace profiles_coach_read (coach reading a player's profile only) with a
-- symmetric policy covering both directions and both pending + active rows
-- (you need to see who sent a request in order to decide on it). Not
-- recursive: this queries coach_players, a different table, not profiles.
drop policy profiles_coach_read on public.profiles;
create policy profiles_relationship_read on public.profiles for select using (
  exists (
    select 1 from public.coach_players cp
    where (cp.coach_id = profiles.id and cp.player_id = auth.uid())
       or (cp.player_id = profiles.id and cp.coach_id = auth.uid())
  )
);

-- Every other coach-read policy moves from `coach_id = auth.uid()` to an
-- active coach_players relationship check.
drop policy repertoires_coach_read on public.repertoires;
create policy repertoires_coach_read on public.repertoires for select using (
  exists (
    select 1 from public.coach_players cp
    where cp.player_id = repertoires.player_id and cp.coach_id = auth.uid() and cp.status = 'active'
  )
);

drop policy moves_coach_read on public.moves;
create policy moves_coach_read on public.moves for select using (
  exists (
    select 1 from public.repertoires r
    join public.coach_players cp on cp.player_id = r.player_id and cp.status = 'active'
    where r.id = moves.repertoire_id and cp.coach_id = auth.uid()
  )
);

drop policy reviews_coach_read on public.reviews;
create policy reviews_coach_read on public.reviews for select using (
  exists (
    select 1 from public.coach_players cp
    where cp.player_id = reviews.player_id and cp.coach_id = auth.uid() and cp.status = 'active'
  )
);

drop policy sessions_coach_read on public.sessions;
create policy sessions_coach_read on public.sessions for select using (
  exists (
    select 1 from public.coach_players cp
    where cp.player_id = sessions.player_id and cp.coach_id = auth.uid() and cp.status = 'active'
  )
);

drop policy player_stats_coach on public.player_stats;
create policy player_stats_coach on public.player_stats for select using (
  exists (
    select 1 from public.coach_players cp
    where cp.player_id = player_stats.player_id and cp.coach_id = auth.uid() and cp.status = 'active'
  )
);

drop policy badges_coach_read on public.badges_earned;
create policy badges_coach_read on public.badges_earned for select using (
  exists (
    select 1 from public.coach_players cp
    where cp.player_id = badges_earned.player_id and cp.coach_id = auth.uid() and cp.status = 'active'
  )
);

-- Tighten assigned_repertoires: today ANY coach can assign ANY repertoire to
-- ANY player (role check only). Require an active relationship instead.
drop policy "Coaches manage assignments" on public.assigned_repertoires;
create policy coach_players_manage_assignments on public.assigned_repertoires
  for all using (
    exists (
      select 1 from public.coach_players cp
      where cp.coach_id = assigned_repertoires.coach_id
        and cp.player_id = assigned_repertoires.player_id
        and cp.status = 'active'
    )
  );

-- update_weekly_leaderboard grouped players by profiles.coach_id for ranking,
-- which no longer exists. Re-point at coach_players, using each player's
-- earliest-formed active coach relationship as the reference group. Same
-- behavior as today for a single-coach player; a simplification (not a full
-- redesign) for the multi-coach case.
create or replace function public.update_weekly_leaderboard(p_player_id uuid, p_xp integer)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_week_start date := date_trunc('week', current_date)::date;
  v_coach_id   uuid;
begin
  select coach_id into v_coach_id
  from coach_players
  where player_id = p_player_id and status = 'active'
  order by created_at asc
  limit 1;

  insert into weekly_leaderboard(player_id, week_start, xp_earned)
  values (p_player_id, v_week_start, p_xp)
  on conflict (player_id) do update
    set xp_earned = case
      when weekly_leaderboard.week_start < v_week_start then p_xp
      else weekly_leaderboard.xp_earned + p_xp
    end,
    week_start = v_week_start;

  if v_coach_id is not null then
    with ranked as (
      select wl.player_id,
             row_number() over (order by wl.xp_earned desc) as r
      from weekly_leaderboard wl
      join coach_players cp on cp.player_id = wl.player_id and cp.status = 'active'
      where wl.week_start = v_week_start and cp.coach_id = v_coach_id
    )
    update weekly_leaderboard wl set rank = ranked.r
    from ranked where ranked.player_id = wl.player_id;
  end if;
end;
$$;

-- Now safe to drop: every read/write that used it has moved to coach_players.
alter table public.profiles drop column coach_id;
```

- [ ] **Step 2: Self-review the SQL**

Read through the full file once more, checking specifically:
- Every `drop policy` name and target table matches an existing policy from `0002_rls.sql` or `0005_phase_b.sql` exactly (compare against those two files).
- The data-migration `insert` runs *before* the `profiles.coach_id` column is dropped (it must — check the statement order in the file).
- The `alter table ... drop column coach_id` is the very last statement, after every policy and function that referenced it has already been replaced.

- [ ] **Step 3: Do NOT apply this migration yet**

Unlike earlier migrations in this project, do **not** ask the user to run this one now. The live site's current code still reads/writes `profiles.coach_id` (invite redemption, the coach dashboard, the PGN player-picker) — dropping that column immediately would break all three in production. This migration gets applied once, right before Task 10's manual verification step, after every task that touches `coach_id` (Tasks 1–6) has been implemented and reviewed. Proceed straight to Task 2 once this file is committed.

- [ ] **Step 4: Commit**

```bash
git add mychess/supabase/migrations/0019_coach_players.sql
git commit -m "feat: add coach_players many-to-many relationship table and RLS"
```

---

### Task 2: Pure request-decision logic

**Files:**
- Create: `mychess/src/lib/coach-players.ts`
- Test: `mychess/src/lib/coach-players.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// mychess/src/lib/coach-players.test.ts
import { describe, it, expect } from 'vitest';
import { planRequest } from './coach-players';

describe('planRequest', () => {
  it('allows a request when no relationship exists yet', () => {
    expect(planRequest(null, 'me')).toEqual({ ok: true });
  });

  it('rejects a request when an active relationship already exists', () => {
    const result = planRequest({ status: 'active', requested_by: 'someone' }, 'me');
    expect(result).toEqual({ ok: false, error: 'You already have an active relationship.' });
  });

  it('rejects a duplicate request from the same requester', () => {
    const result = planRequest({ status: 'pending', requested_by: 'me' }, 'me');
    expect(result).toEqual({ ok: false, error: 'You already sent a request — waiting for a response.' });
  });

  it('rejects a new request when the other side already sent one', () => {
    const result = planRequest({ status: 'pending', requested_by: 'them' }, 'me');
    expect(result).toEqual({
      ok: false,
      error: 'There is already a pending request between you — respond to it instead.'
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `mychess/`): `npx vitest run src/lib/coach-players.test.ts`
Expected: FAIL with "Failed to resolve import './coach-players'" or similar — the module doesn't exist yet.

- [ ] **Step 3: Write the implementation**

```ts
// mychess/src/lib/coach-players.ts

export type ExistingRelationship = { status: 'pending' | 'active'; requested_by: string } | null;

export type RequestOutcome = { ok: true } | { ok: false; error: string };

/**
 * Decides whether `requesterId` may send a new coach<->player request, given
 * any existing relationship row between the two parties (or null if none).
 * Pure and framework-agnostic so it's trivially testable without mocking
 * Supabase — the IO layer in $lib/server/coach-players.ts calls this before
 * inserting.
 */
export function planRequest(existing: ExistingRelationship, requesterId: string): RequestOutcome {
  if (!existing) return { ok: true };
  if (existing.status === 'active') {
    return { ok: false, error: 'You already have an active relationship.' };
  }
  if (existing.requested_by === requesterId) {
    return { ok: false, error: 'You already sent a request — waiting for a response.' };
  }
  return { ok: false, error: 'There is already a pending request between you — respond to it instead.' };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/coach-players.test.ts`
Expected: PASS (4/4).

- [ ] **Step 5: Commit**

```bash
git add mychess/src/lib/coach-players.ts mychess/src/lib/coach-players.test.ts
git commit -m "feat: add planRequest decision logic for coach-player requests"
```

---

### Task 3: Supabase IO layer

**Files:**
- Create: `mychess/src/lib/server/coach-players.ts`

**Context:** This wraps `coach_players` reads/writes for the rest of the app. It has no dedicated test file — this codebase has no existing precedent for mocking Supabase's chainable query builder (every `src/lib/server/*.test.ts` mocks `global.fetch`, not a Supabase client), and the closest analogous helpers (`ensureGuestProfile`, `createPlayerProfile`) both skip tests too, relying on manual verification. This file follows that same precedent; `planRequest` (Task 2) carries the one piece of logic worth unit-testing directly.

- [ ] **Step 1: Write the implementation**

```ts
// mychess/src/lib/server/coach-players.ts
import type { SupabaseClient } from '@supabase/supabase-js';
import { planRequest } from '$lib/coach-players';

export type DirectoryEntry = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  display_name: string;
  avatar_id: string;
};

export type RelationshipEntry = {
  id: string;
  status: 'pending' | 'active';
  requested_by: string;
  other: DirectoryEntry;
};

type Role = 'player' | 'coach';

function toIds(coachId: string, playerId: string) {
  return { coach_id: coachId, player_id: playerId };
}

function escapePostgrestLiteral(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** Sends a request from `requesterId` (whose role is `requesterRole`) to `otherId`. */
export async function sendRequest(
  supabase: SupabaseClient,
  params: { requesterId: string; requesterRole: Role; otherId: string }
): Promise<{ error: string | null }> {
  const { requesterId, requesterRole, otherId } = params;
  const { coach_id, player_id } =
    requesterRole === 'coach' ? toIds(requesterId, otherId) : toIds(otherId, requesterId);

  const { data: existing } = await supabase
    .from('coach_players')
    .select('status, requested_by')
    .eq('coach_id', coach_id)
    .eq('player_id', player_id)
    .maybeSingle();

  const outcome = planRequest(existing as any, requesterId);
  if (!outcome.ok) return { error: outcome.error };

  const { error } = await supabase
    .from('coach_players')
    .insert({ coach_id, player_id, status: 'pending', requested_by: requesterId });

  if (error?.code === '23505') {
    // Lost a race with a concurrent insert for the same pair.
    return { error: 'There is already a pending or active relationship between you.' };
  }
  return { error: error?.message ?? null };
}

/** Accepts or declines a pending request. `responderId` must be the non-requester party. */
export async function respondToRequest(
  supabase: SupabaseClient,
  params: { responderId: string; relationshipId: string; accept: boolean }
): Promise<{ error: string | null }> {
  const { responderId, relationshipId, accept } = params;

  if (accept) {
    const { data, error } = await supabase
      .from('coach_players')
      .update({ status: 'active', responded_at: new Date().toISOString() })
      .eq('id', relationshipId)
      .eq('status', 'pending')
      .neq('requested_by', responderId)
      .select();
    if (error) return { error: error.message };
    if (!data || data.length === 0) return { error: 'This request is no longer available.' };
    return { error: null };
  }

  const { data, error } = await supabase
    .from('coach_players')
    .delete()
    .eq('id', relationshipId)
    .eq('status', 'pending')
    .select();
  if (error) return { error: error.message };
  if (!data || data.length === 0) return { error: 'This request is no longer available.' };
  return { error: null };
}

/** Ends an active relationship. Either participant may call this. */
export async function unlink(
  supabase: SupabaseClient,
  params: { userId: string; relationshipId: string }
): Promise<{ error: string | null }> {
  const { data, error } = await supabase
    .from('coach_players')
    .delete()
    .eq('id', params.relationshipId)
    .eq('status', 'active')
    .select();
  if (error) return { error: error.message };
  if (!data || data.length === 0) return { error: 'This relationship no longer exists.' };
  return { error: null };
}

function splitByStatus(rows: any[]): { active: RelationshipEntry[]; pending: RelationshipEntry[] } {
  const active: RelationshipEntry[] = [];
  const pending: RelationshipEntry[] = [];
  for (const row of rows) {
    (row.status === 'active' ? active : pending).push(row);
  }
  return { active, pending };
}

/** Lists a player's coach relationships (active + pending, either direction of request). */
export async function listRelationshipsForPlayer(supabase: SupabaseClient, playerId: string) {
  const { data } = await supabase
    .from('coach_players')
    .select(
      'id, status, requested_by, other:profiles!coach_players_coach_id_fkey(id, first_name, last_name, display_name, avatar_id)'
    )
    .eq('player_id', playerId);
  return splitByStatus((data ?? []) as any[]);
}

/** Lists a coach's player relationships (active + pending, either direction of request). */
export async function listRelationshipsForCoach(supabase: SupabaseClient, coachId: string) {
  const { data } = await supabase
    .from('coach_players')
    .select(
      'id, status, requested_by, other:profiles!coach_players_player_id_fkey(id, first_name, last_name, display_name, avatar_id)'
    )
    .eq('coach_id', coachId);
  return splitByStatus((data ?? []) as any[]);
}

async function browseDirectory(
  supabase: SupabaseClient,
  table: 'coach_directory' | 'player_directory',
  params: { excludeIds: string[]; search: string }
): Promise<{ entries: DirectoryEntry[]; error: string | null }> {
  let query = supabase.from(table).select('id, first_name, last_name, display_name, avatar_id');
  if (params.excludeIds.length > 0) {
    query = query.not('id', 'in', `(${params.excludeIds.join(',')})`);
  }
  if (params.search.trim()) {
    const term = `%${escapePostgrestLiteral(params.search.trim())}%`;
    query = query.or(`first_name.ilike."${term}",last_name.ilike."${term}",display_name.ilike."${term}"`);
  }
  const { data, error } = await query.order('display_name', { ascending: true });
  return { entries: (data ?? []) as DirectoryEntry[], error: error?.message ?? null };
}

/** Browses coaches not already connected (pending or active) to `excludeIds`. */
export function browseCoaches(
  supabase: SupabaseClient,
  params: { excludeIds: string[]; search: string }
): Promise<{ entries: DirectoryEntry[]; error: string | null }> {
  return browseDirectory(supabase, 'coach_directory', params);
}

/** Browses players not already connected (pending or active) to `excludeIds`. */
export function browsePlayers(
  supabase: SupabaseClient,
  params: { excludeIds: string[]; search: string }
): Promise<{ entries: DirectoryEntry[]; error: string | null }> {
  return browseDirectory(supabase, 'player_directory', params);
}
```

- [ ] **Step 2: Type-check**

Run: `npm run check` (from `mychess/`)
Expected: no new errors attributable to this file (there are pre-existing unrelated errors elsewhere in this codebase — an env-var typing pattern repeated across several files; ignore those).

- [ ] **Step 3: Commit**

```bash
git add mychess/src/lib/server/coach-players.ts
git commit -m "feat: add coach_players IO helpers"
```

---

### Task 4: Invite redemption writes to `coach_players`

**Files:**
- Modify: `mychess/src/routes/join/[token]/+page.server.ts`

**Context:** Redemption must insert the relationship as already-`active` — something a regular participant-scoped insert is deliberately not allowed to do (Task 1's `coach_players_participant_insert` policy requires `status = 'pending'`). This mirrors the existing service-role pattern already used in this codebase's OAuth callbacks (e.g. `src/routes/auth/callback/chesscom/+server.ts`) for the same reason: identity/authorization is already verified server-side (here, by the token/expiry/redeemed_at checks just above), so bypassing RLS for this one write is safe.

- [ ] **Step 1: Replace the redemption logic**

Replace the full contents of `mychess/src/routes/join/[token]/+page.server.ts` with:

```ts
import { redirect } from '@sveltejs/kit';
import { createClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/private';
import { env as pubEnv } from '$env/dynamic/public';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals: { supabase, safeGetSession } }) => {
	const { data: invite } = await supabase.from('invites').select('*').eq('token', params.token).single();

	if (!invite || invite.redeemed_at || new Date(invite.expires_at) < new Date()) {
		return { valid: false, token: params.token };
	}

	const { user } = await safeGetSession();
	if (!user) return { valid: true, token: params.token, needsLogin: true };

	const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single();

	if (!profile) {
		return { valid: true, token: params.token, needsProfile: true, coachId: invite.coach_id };
	}

	// Service-role client: identity is already verified (real session + a
	// valid, unexpired, unredeemed token checked above), and redemption must
	// insert the relationship as already-active — something a regular
	// participant-scoped insert is intentionally not allowed to do (see
	// migration 0019's coach_players_participant_insert policy).
	const { SUPABASE_SERVICE_ROLE_KEY } = env;
	const { PUBLIC_SUPABASE_URL } = pubEnv;
	const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

	const { data: existingRelationship } = await admin
		.from('coach_players')
		.select('id, status')
		.eq('coach_id', invite.coach_id)
		.eq('player_id', user.id)
		.maybeSingle();

	let relationshipError: string | null = null;
	const respondedAt = new Date().toISOString();

	if (!existingRelationship) {
		// No row yet: a plain insert as active. Safe — the guard trigger only
		// fires on UPDATE, and the service-role client bypasses the RLS insert
		// policy that would otherwise force status='pending' for a regular client.
		const { error } = await admin.from('coach_players').insert({
			coach_id: invite.coach_id,
			player_id: user.id,
			status: 'active',
			requested_by: invite.coach_id,
			responded_at: respondedAt
		});
		relationshipError = error?.message ?? null;
	} else if (existingRelationship.status === 'pending') {
		// A row already exists (e.g. the player separately sent a direct
		// request to this same coach). Activate it WITHOUT touching
		// coach_id/player_id/requested_by — the guard trigger forbids changing
		// those on any UPDATE, regardless of who originally requested it.
		const { error } = await admin
			.from('coach_players')
			.update({ status: 'active', responded_at: respondedAt })
			.eq('id', existingRelationship.id);
		relationshipError = error?.message ?? null;
	}
	// If it's already 'active', there's nothing to do — redemption is a no-op.

	if (relationshipError) {
		throw redirect(303, `/login?error=${encodeURIComponent('Could not connect you to this coach. Please try again.')}`);
	}

	await supabase.from('invites').update({ redeemed_at: new Date().toISOString() }).eq('token', params.token);
	throw redirect(303, '/');
};
```

- [ ] **Step 2: Type-check**

Run: `npm run check` (from `mychess/`)
Expected: no new errors attributable to this file.

- [ ] **Step 3: Commit**

```bash
git add mychess/src/routes/join/\[token\]/+page.server.ts
git commit -m "feat: invite redemption writes to coach_players"
```

---

### Task 5: Coach dashboard reads active players from `coach_players`

**Files:**
- Modify: `mychess/src/routes/(coach)/coach/+page.server.ts`
- Modify: `mychess/src/routes/(coach)/coach/+page.svelte`

- [ ] **Step 1: Update the server load**

Replace the full contents of `mychess/src/routes/(coach)/coach/+page.server.ts` with:

```ts
import type { PageServerLoad } from './$types';
import { listRelationshipsForCoach } from '$lib/server/coach-players';

export const load: PageServerLoad = async ({ locals: { supabase, safeGetSession } }) => {
	const { user, session, profile } = await safeGetSession();
	const { active, pending } = await listRelationshipsForCoach(supabase, user!.id);

	return {
		session,
		profile,
		players: active.map((r) => r.other),
		pendingCount: pending.length
	};
};
```

- [ ] **Step 2: Add the pending-requests banner**

In `mychess/src/routes/(coach)/coach/+page.svelte`, change:

```svelte
<script lang="ts">
  let { data } = $props<{ data: any }>();
  const profile = $derived(data.profile as any);
  const players = $derived<any[]>(data.players ?? []);
</script>
```

to:

```svelte
<script lang="ts">
  let { data } = $props<{ data: any }>();
  const profile = $derived(data.profile as any);
  const players = $derived<any[]>(data.players ?? []);
  const pendingCount = $derived(data.pendingCount ?? 0);
</script>
```

Then, change:

```svelte
    <div class="grid grid-cols-2 gap-4 mb-6">
      <a href="/coach/invite"
         class="bg-white border border-gray-200 rounded-xl p-5 hover:shadow-md transition-shadow">
        <p class="text-2xl mb-2">🔗</p>
        <p class="font-semibold text-gray-900">Invite Links</p>
        <p class="text-sm text-gray-400">Invite students to join</p>
      </a>
      <a href="/coach/pgn"
         class="bg-white border border-gray-200 rounded-xl p-5 hover:shadow-md transition-shadow">
        <p class="text-2xl mb-2">📂</p>
        <p class="font-semibold text-gray-900">Upload PGN</p>
        <p class="text-sm text-gray-400">Add repertoires</p>
      </a>
    </div>
```

to:

```svelte
    {#if pendingCount > 0}
      <a href="/coach/students"
         class="block mb-6 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800 hover:bg-amber-100 transition-colors">
        You have {pendingCount} pending student {pendingCount === 1 ? 'request' : 'requests'} — review them →
      </a>
    {/if}

    <div class="grid grid-cols-3 gap-4 mb-6">
      <a href="/coach/students"
         class="bg-white border border-gray-200 rounded-xl p-5 hover:shadow-md transition-shadow">
        <p class="text-2xl mb-2">👥</p>
        <p class="font-semibold text-gray-900">Find Players</p>
        <p class="text-sm text-gray-400">Browse and request students</p>
      </a>
      <a href="/coach/invite"
         class="bg-white border border-gray-200 rounded-xl p-5 hover:shadow-md transition-shadow">
        <p class="text-2xl mb-2">🔗</p>
        <p class="font-semibold text-gray-900">Invite Links</p>
        <p class="text-sm text-gray-400">Invite students to join</p>
      </a>
      <a href="/coach/pgn"
         class="bg-white border border-gray-200 rounded-xl p-5 hover:shadow-md transition-shadow">
        <p class="text-2xl mb-2">📂</p>
        <p class="font-semibold text-gray-900">Upload PGN</p>
        <p class="text-sm text-gray-400">Add repertoires</p>
      </a>
    </div>
```

- [ ] **Step 3: Type-check**

Run: `npm run check` (from `mychess/`)
Expected: no new errors attributable to these two files.

- [ ] **Step 4: Commit**

```bash
git add mychess/src/routes/\(coach\)/coach/+page.server.ts mychess/src/routes/\(coach\)/coach/+page.svelte
git commit -m "feat: coach dashboard reads from coach_players, adds pending banner"
```

---

### Task 6: Coach PGN upload's player picker reads from `coach_players`

**Files:**
- Modify: `mychess/src/routes/(coach)/coach/pgn/+page.server.ts:5-13`

- [ ] **Step 1: Update the load function**

In `mychess/src/routes/(coach)/coach/pgn/+page.server.ts`, change:

```ts
import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { parsePgn } from '$lib/pgn/parser';

export const load: PageServerLoad = async ({ locals: { supabase, safeGetSession } }) => {
	const { user } = await safeGetSession();
	const { data: players } = await supabase
		.from('profiles')
		.select('id, display_name')
		.eq('coach_id', user!.id)
		.eq('role', 'player');
	return { players: players ?? [] };
};
```

to:

```ts
import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { parsePgn } from '$lib/pgn/parser';
import { listRelationshipsForCoach } from '$lib/server/coach-players';

export const load: PageServerLoad = async ({ locals: { supabase, safeGetSession } }) => {
	const { user } = await safeGetSession();
	const { active } = await listRelationshipsForCoach(supabase, user!.id);
	return { players: active.map((r) => r.other) };
};
```

(The rest of the file — the `upload` action — is unchanged.)

- [ ] **Step 2: Type-check**

Run: `npm run check` (from `mychess/`)
Expected: no new errors attributable to this file.

- [ ] **Step 3: Commit**

```bash
git add mychess/src/routes/\(coach\)/coach/pgn/+page.server.ts
git commit -m "feat: PGN upload player picker reads from coach_players"
```

---

### Task 7: Player-side "My Coaches" page

**Files:**
- Create: `mychess/src/routes/(player)/coaches/+page.server.ts`
- Create: `mychess/src/routes/(player)/coaches/+page.svelte`
- Test: `mychess/src/routes/(player)/coaches/coaches.test.ts`

- [ ] **Step 1: Write the server load and actions**

```ts
// mychess/src/routes/(player)/coaches/+page.server.ts
import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	sendRequest,
	respondToRequest,
	unlink,
	listRelationshipsForPlayer,
	browseCoaches
} from '$lib/server/coach-players';

export const load: PageServerLoad = async ({ url, locals: { supabase, safeGetSession } }) => {
	const { user } = await safeGetSession();
	const { active, pending } = await listRelationshipsForPlayer(supabase, user!.id);

	const connectedIds = [...active, ...pending].map((r) => r.other.id);
	const search = url.searchParams.get('q') ?? '';
	const { entries: coaches, error: findError } = await browseCoaches(supabase, { excludeIds: connectedIds, search });

	return {
		coaches: active,
		pending: pending.map((r) => ({ ...r, sentByMe: r.requested_by === user!.id })),
		findResults: coaches,
		findError,
		search
	};
};

export const actions: Actions = {
	request: async ({ request, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) return fail(401, { error: 'Unauthorized' });
		const fd = await request.formData();
		const coachId = fd.get('coach_id') as string;
		if (!coachId) return fail(400, { error: 'No coach selected' });

		const { error } = await sendRequest(supabase, { requesterId: user.id, requesterRole: 'player', otherId: coachId });
		if (error) return fail(400, { error });
		return { success: true };
	},

	accept: async ({ request, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) return fail(401, { error: 'Unauthorized' });
		const fd = await request.formData();
		const relationshipId = fd.get('relationship_id') as string;
		const { error } = await respondToRequest(supabase, { responderId: user.id, relationshipId, accept: true });
		if (error) return fail(400, { error });
		return { success: true };
	},

	decline: async ({ request, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) return fail(401, { error: 'Unauthorized' });
		const fd = await request.formData();
		const relationshipId = fd.get('relationship_id') as string;
		const { error } = await respondToRequest(supabase, { responderId: user.id, relationshipId, accept: false });
		if (error) return fail(400, { error });
		return { success: true };
	},

	unlink: async ({ request, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) return fail(401, { error: 'Unauthorized' });
		const fd = await request.formData();
		const relationshipId = fd.get('relationship_id') as string;
		const { error } = await unlink(supabase, { userId: user.id, relationshipId });
		if (error) return fail(400, { error });
		return { success: true };
	}
};
```

- [ ] **Step 2: Write the page template**

```svelte
<!-- mychess/src/routes/(player)/coaches/+page.svelte -->
<script lang="ts">
  import { enhance } from '$app/forms';
  import { goto } from '$app/navigation';

  let { data, form } = $props<{ data: any; form: any }>();
  let searchInput = $state(data.search ?? '');

  function initials(entry: any): string {
    return (entry.display_name ?? 'C')[0].toUpperCase();
  }

  function runSearch(e: Event) {
    e.preventDefault();
    goto(`?q=${encodeURIComponent(searchInput)}`, { keepFocus: true });
  }
</script>

<svelte:head>
  <title>My Coaches — MyChess</title>
</svelte:head>

<main class="min-h-screen bg-gray-50">
  <div class="max-w-2xl mx-auto px-4 py-6 space-y-8">
    <h1 class="text-2xl font-bold text-gray-900">My Coaches</h1>

    {#if form?.error}
      <p class="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{form.error}</p>
    {/if}

    <section>
      <h2 class="font-semibold text-gray-900 mb-3">Active</h2>
      {#if data.coaches.length === 0}
        <p class="text-gray-400 text-sm">No coaches yet.</p>
      {:else}
        <ul class="space-y-2">
          {#each data.coaches as rel}
            <li class="bg-white border border-gray-200 rounded-xl p-4 flex items-center gap-3">
              <div class="w-9 h-9 rounded-full bg-indigo-100 text-indigo-700 font-bold text-sm flex items-center justify-center">
                {initials(rel.other)}
              </div>
              <span class="font-medium text-gray-900 flex-1">{rel.other.display_name}</span>
              <form method="POST" action="?/unlink" use:enhance>
                <input type="hidden" name="relationship_id" value={rel.id} />
                <button class="text-sm text-red-600 hover:underline">Remove</button>
              </form>
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <section>
      <h2 class="font-semibold text-gray-900 mb-3">Pending</h2>
      {#if data.pending.length === 0}
        <p class="text-gray-400 text-sm">No pending requests.</p>
      {:else}
        <ul class="space-y-2">
          {#each data.pending as rel}
            <li class="bg-white border border-gray-200 rounded-xl p-4 flex items-center gap-3">
              <div class="w-9 h-9 rounded-full bg-indigo-100 text-indigo-700 font-bold text-sm flex items-center justify-center">
                {initials(rel.other)}
              </div>
              <span class="font-medium text-gray-900 flex-1">{rel.other.display_name}</span>
              {#if rel.sentByMe}
                <span class="text-sm text-gray-400">Requested — awaiting response</span>
                <form method="POST" action="?/decline" use:enhance>
                  <input type="hidden" name="relationship_id" value={rel.id} />
                  <button class="text-sm text-gray-500 hover:underline">Cancel</button>
                </form>
              {:else}
                <form method="POST" action="?/accept" use:enhance>
                  <input type="hidden" name="relationship_id" value={rel.id} />
                  <button class="text-sm bg-indigo-600 text-white px-3 py-1.5 rounded-lg hover:bg-indigo-700">Accept</button>
                </form>
                <form method="POST" action="?/decline" use:enhance>
                  <input type="hidden" name="relationship_id" value={rel.id} />
                  <button class="text-sm text-gray-500 hover:underline">Decline</button>
                </form>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <section>
      <h2 class="font-semibold text-gray-900 mb-3">Find a Coach</h2>
      <form onsubmit={runSearch} class="mb-4 flex gap-2">
        <input
          bind:value={searchInput}
          placeholder="Search by name…"
          class="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <button type="submit" class="text-sm bg-gray-100 border border-gray-200 px-4 py-2 rounded-lg hover:bg-gray-200">Search</button>
      </form>
      {#if data.findError}
        <p class="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">Error loading coaches: {data.findError}</p>
      {/if}
      {#if data.findResults.length === 0}
        <p class="text-gray-400 text-sm">No coaches found.</p>
      {:else}
        <ul class="space-y-2">
          {#each data.findResults as coach}
            <li class="bg-white border border-gray-200 rounded-xl p-4 flex items-center gap-3">
              <div class="w-9 h-9 rounded-full bg-indigo-100 text-indigo-700 font-bold text-sm flex items-center justify-center">
                {initials(coach)}
              </div>
              <span class="font-medium text-gray-900 flex-1">{coach.display_name}</span>
              <form method="POST" action="?/request" use:enhance>
                <input type="hidden" name="coach_id" value={coach.id} />
                <button class="text-sm bg-indigo-600 text-white px-3 py-1.5 rounded-lg hover:bg-indigo-700">Request</button>
              </form>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  </div>
</main>
```

- [ ] **Step 3: Write a component test**

```ts
// mychess/src/routes/(player)/coaches/coaches.test.ts
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import Coaches from './+page.svelte';

afterEach(() => cleanup());

const baseData = {
  coaches: [],
  pending: [],
  findResults: [],
  search: ''
};

describe('coaches page', () => {
  it('shows active coaches', () => {
    render(Coaches, {
      props: {
        data: { ...baseData, coaches: [{ id: 'r1', other: { id: 'c1', display_name: 'Coach Ana' } }] },
        form: null
      }
    });
    expect(screen.getByText('Coach Ana')).toBeTruthy();
  });

  it('shows an Accept button for a request sent to me, not by me', () => {
    render(Coaches, {
      props: {
        data: {
          ...baseData,
          pending: [{ id: 'r2', sentByMe: false, other: { id: 'c2', display_name: 'Coach Ben' } }]
        },
        form: null
      }
    });
    expect(screen.getByText('Accept')).toBeTruthy();
  });

  it('shows "awaiting response" instead of Accept for a request I sent', () => {
    render(Coaches, {
      props: {
        data: {
          ...baseData,
          pending: [{ id: 'r3', sentByMe: true, other: { id: 'c3', display_name: 'Coach Cid' } }]
        },
        form: null
      }
    });
    expect(screen.getByText(/awaiting response/i)).toBeTruthy();
    expect(screen.queryByText('Accept')).toBeNull();
  });

  it('shows a form error message when present', () => {
    render(Coaches, { props: { data: baseData, form: { error: 'You already sent a request.' } } });
    expect(screen.getByText('You already sent a request.')).toBeTruthy();
  });
});
```

- [ ] **Step 4: Run the tests**

Run (needs the Node 22 PATH override for jsdom — see this project's established workaround): `PATH="/c/Users/tomyk/.config/herd/bin/nvm/v22.22.3:$PATH" npx vitest run "src/routes/(player)/coaches/coaches.test.ts"`
Expected: PASS (4/4).

- [ ] **Step 5: Type-check**

Run: `npm run check` (from `mychess/`)
Expected: no new errors attributable to these files.

- [ ] **Step 6: Commit**

```bash
git add "mychess/src/routes/(player)/coaches"
git commit -m "feat: add player-side My Coaches page"
```

---

### Task 8: Coach-side "Find Players" page

**Files:**
- Create: `mychess/src/routes/(coach)/coach/students/+page.server.ts`
- Create: `mychess/src/routes/(coach)/coach/students/+page.svelte`
- Test: `mychess/src/routes/(coach)/coach/students/students.test.ts`

**Context:** Mirrors Task 7's player-side page exactly, swapping roles: `listRelationshipsForCoach`/`browsePlayers`, `requesterRole: 'coach'`, and a `player_id` form field instead of `coach_id`.

- [ ] **Step 1: Write the server load and actions**

```ts
// mychess/src/routes/(coach)/coach/students/+page.server.ts
import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	sendRequest,
	respondToRequest,
	unlink,
	listRelationshipsForCoach,
	browsePlayers
} from '$lib/server/coach-players';

export const load: PageServerLoad = async ({ url, locals: { supabase, safeGetSession } }) => {
	const { user } = await safeGetSession();
	const { active, pending } = await listRelationshipsForCoach(supabase, user!.id);

	const connectedIds = [...active, ...pending].map((r) => r.other.id);
	const search = url.searchParams.get('q') ?? '';
	const { entries: players, error: findError } = await browsePlayers(supabase, { excludeIds: connectedIds, search });

	return {
		students: active,
		pending: pending.map((r) => ({ ...r, sentByMe: r.requested_by === user!.id })),
		findResults: players,
		findError,
		search
	};
};

export const actions: Actions = {
	request: async ({ request, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) return fail(401, { error: 'Unauthorized' });
		const fd = await request.formData();
		const playerId = fd.get('player_id') as string;
		if (!playerId) return fail(400, { error: 'No player selected' });

		const { error } = await sendRequest(supabase, { requesterId: user.id, requesterRole: 'coach', otherId: playerId });
		if (error) return fail(400, { error });
		return { success: true };
	},

	accept: async ({ request, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) return fail(401, { error: 'Unauthorized' });
		const fd = await request.formData();
		const relationshipId = fd.get('relationship_id') as string;
		const { error } = await respondToRequest(supabase, { responderId: user.id, relationshipId, accept: true });
		if (error) return fail(400, { error });
		return { success: true };
	},

	decline: async ({ request, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) return fail(401, { error: 'Unauthorized' });
		const fd = await request.formData();
		const relationshipId = fd.get('relationship_id') as string;
		const { error } = await respondToRequest(supabase, { responderId: user.id, relationshipId, accept: false });
		if (error) return fail(400, { error });
		return { success: true };
	},

	unlink: async ({ request, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) return fail(401, { error: 'Unauthorized' });
		const fd = await request.formData();
		const relationshipId = fd.get('relationship_id') as string;
		const { error } = await unlink(supabase, { userId: user.id, relationshipId });
		if (error) return fail(400, { error });
		return { success: true };
	}
};
```

- [ ] **Step 2: Write the page template**

```svelte
<!-- mychess/src/routes/(coach)/coach/students/+page.svelte -->
<script lang="ts">
  import { enhance } from '$app/forms';
  import { goto } from '$app/navigation';

  let { data, form } = $props<{ data: any; form: any }>();
  let searchInput = $state(data.search ?? '');

  function initials(entry: any): string {
    return (entry.display_name ?? 'P')[0].toUpperCase();
  }

  function runSearch(e: Event) {
    e.preventDefault();
    goto(`?q=${encodeURIComponent(searchInput)}`, { keepFocus: true });
  }
</script>

<svelte:head>
  <title>Find Players — MyChess</title>
</svelte:head>

<main class="min-h-screen bg-gray-50">
  <div class="max-w-2xl mx-auto px-4 py-6 space-y-8">
    <a href="/coach" class="text-gray-400 text-sm hover:text-gray-600 block">← Back to Dashboard</a>
    <h1 class="text-2xl font-bold text-gray-900">Students</h1>

    {#if form?.error}
      <p class="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{form.error}</p>
    {/if}

    <section>
      <h2 class="font-semibold text-gray-900 mb-3">Active</h2>
      {#if data.students.length === 0}
        <p class="text-gray-400 text-sm">No students yet.</p>
      {:else}
        <ul class="space-y-2">
          {#each data.students as rel}
            <li class="bg-white border border-gray-200 rounded-xl p-4 flex items-center gap-3">
              <div class="w-9 h-9 rounded-full bg-indigo-100 text-indigo-700 font-bold text-sm flex items-center justify-center">
                {initials(rel.other)}
              </div>
              <a href="/coach/players/{rel.other.id}" class="font-medium text-gray-900 flex-1 hover:underline">{rel.other.display_name}</a>
              <form method="POST" action="?/unlink" use:enhance>
                <input type="hidden" name="relationship_id" value={rel.id} />
                <button class="text-sm text-red-600 hover:underline">Remove</button>
              </form>
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <section>
      <h2 class="font-semibold text-gray-900 mb-3">Pending</h2>
      {#if data.pending.length === 0}
        <p class="text-gray-400 text-sm">No pending requests.</p>
      {:else}
        <ul class="space-y-2">
          {#each data.pending as rel}
            <li class="bg-white border border-gray-200 rounded-xl p-4 flex items-center gap-3">
              <div class="w-9 h-9 rounded-full bg-indigo-100 text-indigo-700 font-bold text-sm flex items-center justify-center">
                {initials(rel.other)}
              </div>
              <span class="font-medium text-gray-900 flex-1">{rel.other.display_name}</span>
              {#if rel.sentByMe}
                <span class="text-sm text-gray-400">Requested — awaiting response</span>
                <form method="POST" action="?/decline" use:enhance>
                  <input type="hidden" name="relationship_id" value={rel.id} />
                  <button class="text-sm text-gray-500 hover:underline">Cancel</button>
                </form>
              {:else}
                <form method="POST" action="?/accept" use:enhance>
                  <input type="hidden" name="relationship_id" value={rel.id} />
                  <button class="text-sm bg-indigo-600 text-white px-3 py-1.5 rounded-lg hover:bg-indigo-700">Accept</button>
                </form>
                <form method="POST" action="?/decline" use:enhance>
                  <input type="hidden" name="relationship_id" value={rel.id} />
                  <button class="text-sm text-gray-500 hover:underline">Decline</button>
                </form>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <section>
      <h2 class="font-semibold text-gray-900 mb-3">Find a Player</h2>
      <form onsubmit={runSearch} class="mb-4 flex gap-2">
        <input
          bind:value={searchInput}
          placeholder="Search by name…"
          class="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <button type="submit" class="text-sm bg-gray-100 border border-gray-200 px-4 py-2 rounded-lg hover:bg-gray-200">Search</button>
      </form>
      {#if data.findError}
        <p class="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">Error loading players: {data.findError}</p>
      {/if}
      {#if data.findResults.length === 0}
        <p class="text-gray-400 text-sm">No players found.</p>
      {:else}
        <ul class="space-y-2">
          {#each data.findResults as player}
            <li class="bg-white border border-gray-200 rounded-xl p-4 flex items-center gap-3">
              <div class="w-9 h-9 rounded-full bg-indigo-100 text-indigo-700 font-bold text-sm flex items-center justify-center">
                {initials(player)}
              </div>
              <span class="font-medium text-gray-900 flex-1">{player.display_name}</span>
              <form method="POST" action="?/request" use:enhance>
                <input type="hidden" name="player_id" value={player.id} />
                <button class="text-sm bg-indigo-600 text-white px-3 py-1.5 rounded-lg hover:bg-indigo-700">Request</button>
              </form>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  </div>
</main>
```

- [ ] **Step 3: Write a component test**

```ts
// mychess/src/routes/(coach)/coach/students/students.test.ts
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import Students from './+page.svelte';

afterEach(() => cleanup());

const baseData = {
  students: [],
  pending: [],
  findResults: [],
  search: ''
};

describe('coach students page', () => {
  it('shows active students, linked to their coach/players detail page', () => {
    render(Students, {
      props: {
        data: { ...baseData, students: [{ id: 'r1', other: { id: 'p1', display_name: 'Player Pat' } }] },
        form: null
      }
    });
    const link = screen.getByRole('link', { name: 'Player Pat' });
    expect(link.getAttribute('href')).toBe('/coach/players/p1');
  });

  it('shows an Accept button for a request received, not sent', () => {
    render(Students, {
      props: {
        data: { ...baseData, pending: [{ id: 'r2', sentByMe: false, other: { id: 'p2', display_name: 'Player Quinn' } }] },
        form: null
      }
    });
    expect(screen.getByText('Accept')).toBeTruthy();
  });

  it('shows a form error message when present', () => {
    render(Students, { props: { data: baseData, form: { error: 'No player selected' } } });
    expect(screen.getByText('No player selected')).toBeTruthy();
  });
});
```

- [ ] **Step 4: Run the tests**

Run: `PATH="/c/Users/tomyk/.config/herd/bin/nvm/v22.22.3:$PATH" npx vitest run "src/routes/(coach)/coach/students/students.test.ts"`
Expected: PASS (3/3).

- [ ] **Step 5: Type-check**

Run: `npm run check` (from `mychess/`)
Expected: no new errors attributable to these files.

- [ ] **Step 6: Commit**

```bash
git add "mychess/src/routes/(coach)/coach/students"
git commit -m "feat: add coach-side Find Players / Students page"
```

---

### Task 9: Nav links

**Files:**
- Modify: `mychess/src/lib/components/NavBar.svelte`

- [ ] **Step 1: Add the player-side "Coaches" link**

Change (desktop nav, the player branch):

```svelte
      {:else if !isGuest}
        <a href="/" class={linkClass(['/'])}>Dashboard</a>
        <a href="/tournaments" class={linkClass(['/tournaments'])}>Tournaments</a>
        <a href="/learn" class={linkClass(['/learn', '/drill', '/practice', '/time-trial'])}>Learn</a>
        <a href="/repertoires" class={linkClass(['/repertoires'])}>Repertoires</a>
      {:else}
```

to:

```svelte
      {:else if !isGuest}
        <a href="/" class={linkClass(['/'])}>Dashboard</a>
        <a href="/tournaments" class={linkClass(['/tournaments'])}>Tournaments</a>
        <a href="/learn" class={linkClass(['/learn', '/drill', '/practice', '/time-trial'])}>Learn</a>
        <a href="/repertoires" class={linkClass(['/repertoires'])}>Repertoires</a>
        <a href="/coaches" class={linkClass(['/coaches'])}>Coaches</a>
      {:else}
```

- [ ] **Step 2: Add the same link to the mobile menu**

Change:

```svelte
      {:else if !isGuest}
        <a href="/" onclick={() => mobileMenuOpen = false} class="text-gray-700 font-medium">Dashboard</a>
        <a href="/tournaments" onclick={() => mobileMenuOpen = false} class="text-gray-700">Tournaments</a>
        <a href="/learn" onclick={() => mobileMenuOpen = false} class="text-gray-700">Learn</a>
        <a href="/repertoires" onclick={() => mobileMenuOpen = false} class="text-gray-700">Repertoires</a>
        <div class="border-t border-gray-100 pt-2">
```

to:

```svelte
      {:else if !isGuest}
        <a href="/" onclick={() => mobileMenuOpen = false} class="text-gray-700 font-medium">Dashboard</a>
        <a href="/tournaments" onclick={() => mobileMenuOpen = false} class="text-gray-700">Tournaments</a>
        <a href="/learn" onclick={() => mobileMenuOpen = false} class="text-gray-700">Learn</a>
        <a href="/repertoires" onclick={() => mobileMenuOpen = false} class="text-gray-700">Repertoires</a>
        <a href="/coaches" onclick={() => mobileMenuOpen = false} class="text-gray-700">Coaches</a>
        <div class="border-t border-gray-100 pt-2">
```

(No coach-side nav link needed for `/coach/students` — Task 5 already added a dashboard tile and pending-requests banner linking to it, matching how `/coach/invite` and `/coach/pgn` are reached today, i.e. via dashboard tiles rather than the top nav.)

- [ ] **Step 3: Type-check**

Run: `npm run check` (from `mychess/`)
Expected: no new errors attributable to this file.

- [ ] **Step 4: Commit**

```bash
git add mychess/src/lib/components/NavBar.svelte
git commit -m "feat: add Coaches link to player nav"
```

---

### Task 10: Full verification

**Files:** none (verification only)

- [ ] **Step 0: Apply the migration**

This is the point deferred from Task 1 — every task touching `profiles.coach_id` (1 through 6) is now implemented and reviewed, so it's safe to apply. Hand the complete contents of `mychess/supabase/migrations/0019_coach_players.sql` to the user and ask them to run it in the Supabase dashboard's SQL editor (Project → SQL Editor → New query), in one paste. Do not proceed to Step 1 until they confirm it ran without error.

If it errors partway through, note that this migration is **not** wrapped in an explicit transaction — depending on where it failed, some statements may have already applied. Ask the user to paste back the exact error message before attempting a fix, rather than blindly re-running the whole file (which would fail again on `create table`/`create view` statements for objects that already exist).

- [ ] **Step 1: Run the full test suite**

Run: `PATH="/c/Users/tomyk/.config/herd/bin/nvm/v22.22.3:$PATH" npx vitest run` (from `mychess/`)
Expected: PASS — no regressions in any existing test, plus the new tests from Tasks 2, 7, 8.

- [ ] **Step 2: Run the full type-check**

Run: `npm run check` (from `mychess/`)
Expected: no new errors beyond the pre-existing baseline count established before this feature (confirm the exact number by checking `git log` for the last "full verification" note, or by running `npm run check` against the commit right before Task 1 and comparing).

- [ ] **Step 3: Grep for stragglers**

Run: `grep -rn "coach_id" mychess/src`
Expected: zero matches against `profiles.coach_id` specifically. The `invites.coach_id` and `coach_notes.coach_id`/`assigned_repertoires.coach_id` columns are untouched by this plan and will still appear — confirm any remaining matches are one of those three, not a missed `profiles.coach_id` reference.

- [ ] **Step 4: Manually verify in the dev server**

Run: `npm run dev` (from `mychess/`), then, using two different accounts (or one browser + one incognito window):
- As a player, visit `/coaches` → search for a coach by name → send a request → confirm it appears under Pending with "awaiting response", not an Accept button.
- As that coach, visit `/coach/students` → confirm the incoming request appears with Accept/Decline → click Accept.
- Back as the player, refresh `/coaches` → confirm the coach now appears under Active.
- As the coach, assign a repertoire to that player from `/coach/players/[id]` → confirm it succeeds (this exercises the tightened `assigned_repertoires` RLS policy).
- As the player, unlink that coach from `/coaches` → confirm the previously-assigned repertoire is still visible/trainable (per the "keep past assignments" decision).
- Generate an invite link (`/coach/invite`) as a *different* coach, redeem it as a *different* player → confirm the relationship shows as Active immediately on both sides, with no separate approval step.

No commit for this task — it's verification only. If any step surfaces a bug, fix it as part of the task where the bug was introduced and re-run this task's steps.
