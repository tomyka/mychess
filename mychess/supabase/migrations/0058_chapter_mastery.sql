-- Story #99/#100 of epic #95: a chapter is MASTERED by one continuous
-- hint-free, mistake-free run through its learned variations, and a repertoire
-- is Mastered once every chapter holds mastery that is still current.
--
-- Currency is decided by `moves_updated_at`, not by a hash of the variation-key
-- set. `repertoires.moves_updated_at` is maintained by a database trigger on
-- every insert/update/delete against `moves` (migration 0055), so it is the one
-- signal application code cannot forget to update. A coach adding a chapter
-- therefore revokes Mastered on its own, with no invalidation job — which is
-- the rule this epic asked for. See src/lib/mastery/repertoireStatus.ts.

create table if not exists public.chapter_mastery (
  id                bigserial primary key,
  player_id         uuid not null references public.profiles(id) on delete cascade,
  repertoire_id     uuid not null references public.repertoires(id) on delete cascade,
  -- The chapter name, or the untagged-bucket label for a repertoire whose PGN
  -- carried no chapter headers (one implicit chapter, so such a repertoire is
  -- still masterable).
  chapter_name      text not null,
  mastered_at       timestamptz not null default now(),
  -- The repertoire's own moves_updated_at at the moment this was earned.
  moves_updated_at  timestamptz not null,
  unique (player_id, repertoire_id, chapter_name)
);

comment on column public.chapter_mastery.moves_updated_at is
  'repertoires.moves_updated_at when this mastery was earned. The record is current only while it is >= the repertoire''s present value; any change to the moves makes it stale and drops the repertoire out of Mastered.';

create index if not exists chapter_mastery_player_repertoire_idx
  on public.chapter_mastery (player_id, repertoire_id);

alter table public.chapter_mastery enable row level security;

-- Single-operation policies: Postgres ORs permissive policies together for the
-- same operation, so one broad `for all` would silently defeat every narrower
-- policy added beside it later.
drop policy if exists chapter_mastery_select_own on public.chapter_mastery;
create policy chapter_mastery_select_own on public.chapter_mastery
  for select using (auth.uid() = player_id);

drop policy if exists chapter_mastery_insert_own on public.chapter_mastery;
create policy chapter_mastery_insert_own on public.chapter_mastery
  for insert with check (auth.uid() = player_id);

-- Re-earning a chapter after it goes stale updates the existing row (the unique
-- constraint makes that an upsert), so UPDATE is granted; DELETE is not, since
-- nothing legitimately removes a mastery record.
drop policy if exists chapter_mastery_update_own on public.chapter_mastery;
create policy chapter_mastery_update_own on public.chapter_mastery
  for update using (auth.uid() = player_id) with check (auth.uid() = player_id);

-- Supabase's default anon grant on a new table is not removed by granting to
-- authenticated — revoke it explicitly.
revoke all on public.chapter_mastery from anon, public;
grant select, insert, update on public.chapter_mastery to authenticated;
grant usage, select on sequence public.chapter_mastery_id_seq to authenticated;
