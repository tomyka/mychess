-- mychess/supabase/migrations/0077_profiles_locale.sql
--
-- NOTE ON NUMBERING: authored and APPLIED TO PRODUCTION as `0062_...`, then
-- renumbered to 0077 because `0062_position_evals.sql` already held that
-- number — the same parallel-branch collision `0063_repertoire_update.sql`
-- describes, which took 0062 for position_evals. Two files at one version left
-- one of the pair permanently unmatched against the migration history table
-- and blocked every `supabase db push` (GitHub issue #156). 0074/0075 were
-- already claimed by unmerged branches, hence 0077.
--
-- The live schema already has this column; the rename only fixes replay order
-- for a fresh database. Nothing else in the migration history references
-- `locale`, so running it later than 0062 changes nothing.

alter table public.profiles
  add column locale text not null default 'en' check (locale in ('en', 'lt'));
