-- Story #104 of epic #95: a variation is LEARNED after two clean passes at
-- least 20 hours apart, not after one clean pass.
--
-- `variation_solved` keeps its name and shape but changes meaning: a row now
-- means "learned", inserted at graduation rather than on the first clean pass.
-- Existing rows are grandfathered as learned — the row itself is the marker,
-- so the new counters being absent for them reads correctly.
--
-- The gap is measured between timestamps, in hours, because no player timezone
-- is stored anywhere and a 23:50 pass followed by 00:10 must not count as two
-- separate days.

alter table public.variation_teaching_progress
  add column if not exists clean_pass_count int not null default 0,
  add column if not exists last_clean_pass_at timestamptz;

comment on column public.variation_teaching_progress.clean_pass_count is
  'Clean passes (no mistake, no hint) over this variation''s final batch. 2 with a >=20h gap graduates it to learned; see src/lib/mastery/learning.ts.';
comment on column public.variation_teaching_progress.last_clean_pass_at is
  'Timestamp of the last COUNTED clean pass. Deliberately not refreshed by a pass inside the 20h window, or a player drilling hourly would restart the clock forever and never graduate.';

-- Demotion log (story #98). Written when a learned variation is failed or
-- hinted in Practice; backs epic success criterion 3 (demotion rate falling
-- over time), which is otherwise unmeasurable.
create table if not exists public.variation_demotions (
  id            bigserial primary key,
  player_id     uuid not null references public.profiles(id) on delete cascade,
  repertoire_id uuid not null references public.repertoires(id) on delete cascade,
  variation_key text not null,
  demoted_at    timestamptz not null default now(),
  cause         text not null check (cause in ('mistake','hint'))
);

create index if not exists variation_demotions_player_repertoire_idx
  on public.variation_demotions (player_id, repertoire_id, demoted_at desc);

alter table public.variation_demotions enable row level security;

-- Single-operation policies, never a broad `for all`: Postgres ORs together
-- multiple permissive policies for the same operation, so a blanket policy
-- silently defeats any narrower one added beside it later.
drop policy if exists variation_demotions_select_own on public.variation_demotions;
create policy variation_demotions_select_own on public.variation_demotions
  for select using (auth.uid() = player_id);

drop policy if exists variation_demotions_insert_own on public.variation_demotions;
create policy variation_demotions_insert_own on public.variation_demotions
  for insert with check (auth.uid() = player_id);

-- A player never edits or deletes their own demotion history: it is an audit
-- trail, and no UPDATE/DELETE policy is granted on purpose.

-- Supabase's default `anon` grant on a new table is not removed by granting to
-- `authenticated` — revoke it explicitly.
revoke all on public.variation_demotions from anon, public;
grant select, insert on public.variation_demotions to authenticated;
grant usage, select on sequence public.variation_demotions_id_seq to authenticated;
