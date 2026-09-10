-- mychess/supabase/migrations/0079_active_opening_repertoires.sql
--
-- #202 (epic #119): which repertoire is a student's CURRENT preparation for a
-- given curated opening.
--
-- Row existence is what "active" means, so the primary key (player_id,
-- opening_id) IS the acceptance criterion — exactly one active repertoire per
-- (student, opening), enforced here rather than by application code. There is
-- deliberately no `is_active` flag and no partial unique index over one.
--
-- Non-active candidates are NOT stored. Which opening a repertoire prepares is
-- derived by resolveOpening (src/lib/openings/resolve.ts) from (eco_code,
-- color); storing a second copy per candidate is exactly what #201 declined to
-- do. Only the CHOICE is written down, because only the choice cannot be
-- derived.
--
-- No foreign key on opening_id: the taxonomy is a TypeScript module, not a
-- table (see 0078's header for why). Integrity is taxonomy.test.ts, plus the
-- read-time staleness rule in src/lib/openings/active.ts.
--
-- No unique on (player_id, repertoire_id): a repertoire resolves to exactly
-- one opening, so it cannot be active for two.
--
-- set_by is written and not yet read. It is here because two writers exist by
-- design (the student, and an active coach), "was this the coach holding me
-- back, or me?" is the first question #203's coach view asks, and every
-- migration on this project is a hand-pasted dashboard step — the column is
-- nearly free now and costs a whole round trip later. Null means the backfill
-- script wrote it; nobody chose.

create table public.active_opening_repertoires (
  player_id     uuid not null references public.profiles(id) on delete cascade,
  opening_id    text not null,
  repertoire_id uuid not null references public.repertoires(id) on delete cascade,
  set_by        uuid references public.profiles(id) on delete set null,
  updated_at    timestamptz not null default now(),
  primary key (player_id, opening_id)
);

-- Postgres does not index the referencing side of a foreign key. Deleting a
-- repertoire is a real user action here (the delete-repertoire feature), and
-- its cascade would otherwise scan this whole table.
create index active_opening_repertoires_repertoire_idx
  on public.active_opening_repertoires (repertoire_id);

alter table public.active_opening_repertoires enable row level security;

-- Supabase's default grant to `anon` is not removed by granting to
-- `authenticated`, so revoke it explicitly.
revoke all on public.active_opening_repertoires from anon, public;
grant select, insert, update, delete on public.active_opening_repertoires to authenticated;

-- "May this repertoire be the active one for this student?" — they own it, or
-- it is assigned to them. One function, called by both the RLS policies below
-- and by src/lib/server/active-openings.ts, so the two cannot drift apart.
--
-- security definer is not decoration. 0040 established that a plain correlated
-- subquery against `repertoires` from inside a policy re-enters repertoires'
-- own RLS, which queries assigned_repertoires back, and Postgres refuses to
-- expand the cycle rather than resolving it. A security definer function is
-- never inlined by the planner, so the cycle never forms.
create or replace function public.repertoire_available_to(p_repertoire_id uuid, p_player_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.repertoires r
    where r.id = p_repertoire_id and r.player_id = p_player_id
  ) or exists (
    select 1 from public.assigned_repertoires a
    where a.repertoire_id = p_repertoire_id and a.player_id = p_player_id
  );
$$;

revoke all on function public.repertoire_available_to(uuid, uuid) from public;
grant execute on function public.repertoire_available_to(uuid, uuid) to authenticated;

-- "May the caller decide this student's active openings?" — the student
-- themselves, or a coach with an active relationship. Extracted for the same
-- reason: four policies below need the identical test, and a copy that drifts
-- is a silent authorisation hole.
create or replace function public.manages_openings_for(p_player_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select p_player_id = auth.uid()
      or exists (
        select 1 from public.coach_players cp
        where cp.coach_id = auth.uid()
          and cp.player_id = p_player_id
          and cp.status = 'active'
      );
$$;

revoke all on function public.manages_openings_for(uuid) from public;
grant execute on function public.manages_openings_for(uuid) to authenticated;

-- Single-operation policies, never `for all`: Postgres ORs permissive policies
-- for the same operation together, so a broad one silently defeats a narrow
-- one added beside it.
create policy active_opening_repertoires_read on public.active_opening_repertoires
  for select using (public.manages_openings_for(player_id));

create policy active_opening_repertoires_insert on public.active_opening_repertoires
  for insert with check (
    public.manages_openings_for(player_id)
    and public.repertoire_available_to(repertoire_id, player_id)
  );

create policy active_opening_repertoires_update on public.active_opening_repertoires
  for update using (public.manages_openings_for(player_id))
  with check (
    public.manages_openings_for(player_id)
    and public.repertoire_available_to(repertoire_id, player_id)
  );

create policy active_opening_repertoires_delete on public.active_opening_repertoires
  for delete using (public.manages_openings_for(player_id));

-- Unassigning the active repertoire leaves that opening with NO active
-- mapping. Nothing is promoted in its place — a gap is the honest answer and
-- is what #203 surfaces.
--
-- A trigger rather than a line in the unassign action, so the mapping cannot
-- outlive its repertoire under any write path, including a raw one. It needs
-- no "unless the student owns it anyway" guard: 0030 requires an assigned
-- repertoire to belong to the assigning coach, so an assigned repertoire is
-- never the student's own. Deleting the repertoire itself is already handled
-- by the foreign key's cascade.
create or replace function public.clear_active_opening_on_unassign()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.active_opening_repertoires
   where player_id = old.player_id
     and repertoire_id = old.repertoire_id;
  return old;
end;
$$;

create trigger clear_active_opening_on_unassign
  after delete on public.assigned_repertoires
  for each row execute function public.clear_active_opening_on_unassign();
