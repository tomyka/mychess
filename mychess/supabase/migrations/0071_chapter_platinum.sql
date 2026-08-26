-- mychess/supabase/migrations/0071_chapter_platinum.sql
--
-- Presence-based cache: a row means this player's copy of this chapter has
-- reached Platinum on the knowledge-level ladder (src/lib/mastery/chapterLevels.ts).
-- Exists ONLY so the repertoire list can show a cheap "Mastered" badge (the
-- #105 comparison against repertoires.chapter_count, migration 0069) without
-- a full move fetch per repertoire — the authoritative, always-correct
-- computation (the Levels page, badge counts) never reads this table; it
-- derives platinum status fresh every time from variation_solved.
--
-- Deliberately sticky, mirroring chapter_mastery's own original policy
-- ("nothing legitimately removes a mastery record" — migration 0058): a row
-- is written once, at attempt-completion, the moment a chapter's live-derived
-- level newly reaches platinum (src/lib/server/practice-progress.ts), and is
-- cleared ONLY by reconciliation (src/lib/server/repertoire-progress.ts),
-- when a coach re-upload demotes something in that repertoire for that
-- player. An ordinary Practice-pool mistake/hint demotion
-- (src/lib/server/practice-pool.ts's demoteVariation) does NOT clear it —
-- adding that check would require a full move fetch on that hot, frequently
-- hit endpoint, which this codebase has consistently avoided elsewhere. The
-- practical effect: the list's Mastered badge can lag the authoritative
-- Levels page after an ordinary practice mistake, but never after a coach
-- edit, and it can never show a chapter platinum that was never legitimately
-- earned.
create table if not exists public.chapter_platinum (
  id             bigserial primary key,
  player_id      uuid not null references public.profiles(id) on delete cascade,
  repertoire_id  uuid not null references public.repertoires(id) on delete cascade,
  chapter_name   text not null,
  reached_at     timestamptz not null default now(),
  unique (player_id, repertoire_id, chapter_name)
);

create index if not exists chapter_platinum_player_repertoire_idx
  on public.chapter_platinum (player_id, repertoire_id);

alter table public.chapter_platinum enable row level security;

drop policy if exists chapter_platinum_select_own on public.chapter_platinum;
create policy chapter_platinum_select_own on public.chapter_platinum
  for select using (auth.uid() = player_id);

drop policy if exists chapter_platinum_insert_own on public.chapter_platinum;
create policy chapter_platinum_insert_own on public.chapter_platinum
  for insert with check (auth.uid() = player_id);

-- Reconciliation clears rows on a coach-driven regression (see Task 6) —
-- nothing else legitimately removes one.
drop policy if exists chapter_platinum_delete_own on public.chapter_platinum;
create policy chapter_platinum_delete_own on public.chapter_platinum
  for delete using (auth.uid() = player_id);

revoke all on public.chapter_platinum from anon, public;
grant select, insert, delete on public.chapter_platinum to authenticated;
grant usage, select on sequence public.chapter_platinum_id_seq to authenticated;
