-- mychess/supabase/migrations/0070_variation_chapter_practice_exclusions.sql
--
-- #86: variation_practice_exclusions stores exactly one "excluded" flag per
-- (player_id, variation_key) — a single line, wherever it appears, is either
-- in the practice pool or out of it. That's wrong whenever a line legitimately
-- appears under more than one chapter (moves.chapter_names already supports
-- this, and it's common in a transposition-heavy repertoire): toggling one
-- chapter's checkbox silently changed a completely different chapter's own
-- display, because both read/wrote the same single global flag for the
-- shared line. See the design doc for the full report:
-- docs/superpowers/specs/2026-08-19-per-chapter-practice-exclusions-design.md
--
-- A row's presence here means "excluded, as viewed under this specific
-- chapter." variation_practice_exclusions' own schema is untouched — it
-- becomes a derived cache of one fact per variation: "excluded under every
-- chapter it belongs to" (i.e. actually excluded from practice), kept in sync
-- by the application write path (setVariationsIncluded). That's what keeps
-- the existing fast-count optimization (migration 0055, GitHub issue #52)
-- intact with zero changes to that read path.
create table public.variation_chapter_practice_exclusions (
  id                uuid primary key default gen_random_uuid(),
  player_id         uuid not null references public.profiles(id) on delete cascade,
  repertoire_id     uuid not null references public.repertoires(id) on delete cascade,
  chapter_name      text not null, -- UNTAGGED_CHAPTER's own string for the untagged bucket
  variation_key     text not null,
  variation_key_hash text generated always as (encode(digest(variation_key, 'sha256'), 'hex')) stored,
  created_at        timestamptz not null default now(),
  unique (player_id, chapter_name, variation_key_hash)
);

create index variation_chapter_practice_exclusions_player_repertoire_idx
  on public.variation_chapter_practice_exclusions (player_id, repertoire_id);

alter table public.variation_chapter_practice_exclusions enable row level security;

create policy "variation_chapter_practice_exclusions_player_all"
  on public.variation_chapter_practice_exclusions for all using (player_id = auth.uid());

revoke all on public.variation_chapter_practice_exclusions from anon, public;

-- Forces every repertoire through the existing self-healing re-verification
-- pass (repertoire-progress.ts's reverifyExclusions, migration 0055) on its
-- next load — that pass now also expands each currently-excluded variation
-- into one variation_chapter_practice_exclusions row per real chapter it
-- belongs to (a single UNTAGGED_CHAPTER row for a genuinely untagged line).
-- The flat table itself is untouched by this migration, so nothing about the
-- practice pool changes until a player's next load re-verifies and expands.
update public.variation_practice_exclusions set verified_at = 'epoch';
