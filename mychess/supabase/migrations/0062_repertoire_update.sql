-- mychess/supabase/migrations/0062_repertoire_update.sql
-- Coach repertoire re-upload (GitHub issue #118): a coach uploads a revised
-- PGN over an existing repertoire, and unchanged lines keep every student's
-- learning progress. See
-- docs/superpowers/specs/2026-08-21-coach-repertoire-reupload-design.md.
--
-- Written idempotently throughout (`if not exists` / `drop ... if exists` /
-- conditional adds), for the reason migration 0049 spells out: this migration
-- spans several objects in sequence, and a first attempt that fails partway
-- would otherwise leave the later objects un-created with no safe way to
-- resume. Safe to run any number of times.

-- ---------------------------------------------------------------------------
-- 1. moves.retired_at — pruned moves are RETIRED, never deleted.
-- ---------------------------------------------------------------------------
-- Deleting a pruned move destroys student state unrecoverably. `moves.id` is
-- referenced `on delete cascade` by two tables that are still live:
--
--   * `reviews.move_id`      (migration 0001) — the SRS scheduling state
--     (stability, difficulty, reps, lapses, due_at) per player per move.
--   * `move_attempts.move_id` (migration 0039) — the per-attempt log backing
--     the coach practice report.
--
-- So a `delete from moves` silently wipes a student's entire spaced-repetition
-- schedule and attempt history for every line the coach happened to reshape.
-- (`move_progress` from 0025 and `variation_progress` from 0023 carried the
-- same cascading FK, but were dropped in 0047 and 0051 respectively — they are
-- deliberately NOT cited here as reasons.)
--
-- Retiring instead makes the whole update non-destructive: the row and every
-- child row survive, read paths filter `retired_at is null`, and a line the
-- coach restores later can simply be un-retired with its history intact.
--
-- A second benefit falls out for free: retiring is an UPDATE on `moves`, so it
-- fires 0055's `moves_touch_repertoire_update` statement trigger and bumps
-- `repertoires.moves_updated_at` with no help from the application. That is
-- exactly the staleness signal reconciliation reads, and it cannot be missed.
alter table public.moves
  add column if not exists retired_at timestamptz;

comment on column public.moves.retired_at is
  'Non-null means this move is no longer part of the repertoire''s live shape (pruned by a coach re-upload). Read paths filter `retired_at is null`. Never delete a pruned move: `reviews` and `move_attempts` reference moves.id on delete cascade, so a delete destroys the student''s SRS state.';

-- Every read path enumerating a repertoire's moves adds `retired_at is null`,
-- so the partial index matches the query exactly and stays small (retired rows
-- are excluded from the index, not just from the results).
create index if not exists moves_repertoire_live_idx
  on public.moves (repertoire_id)
  where retired_at is null;

-- ---------------------------------------------------------------------------
-- 2. repertoire_reconciliation — per-player "I have caught up" stamp.
-- ---------------------------------------------------------------------------
-- A dedicated table rather than a column on `assigned_repertoires`, because
-- `assigned_repertoires` only has a row for an *assigned* repertoire. A coach
-- practising their own material has no assignment row at all, and neither does
-- a player working through a repertoire they uploaded themselves — both still
-- hold progress that has to reconcile after a re-upload. Hanging the stamp off
-- assignment would silently skip exactly those players.
--
-- The default is 'epoch' — 0055's asymmetry trick, reused deliberately:
-- nothing is assumed reconciled at deploy time, so every player's first load
-- per repertoire reconciles once, exactly as if the shape had just changed.
-- 'epoch' stays the permanent default, not just a backfill value: a freshly
-- inserted row has not been reconciled against the live shape either.
--
-- The freshness test is `reconciled_at >= moves_updated_at`. Reconciliation
-- stamps the repertoire's OWN `moves_updated_at` value rather than a clock
-- reading, which is what keeps this free of clock-skew concerns — the two
-- sides of the comparison never have to agree on what time it is, only on a
-- value one of them copied from the other.
create table if not exists public.repertoire_reconciliation (
  player_id     uuid not null references public.profiles(id) on delete cascade,
  repertoire_id uuid not null references public.repertoires(id) on delete cascade,
  reconciled_at timestamptz not null default 'epoch',
  primary key (player_id, repertoire_id)
);

comment on table public.repertoire_reconciliation is
  'Per-player, per-repertoire "progress reconciled up to this shape" stamp. Fresh when reconciled_at >= repertoires.moves_updated_at; stamped with that column''s value, never with now().';

alter table public.repertoire_reconciliation enable row level security;

-- Single-operation policies, never a broad `for all`: Postgres ORs together
-- multiple permissive policies for the same operation, so a blanket policy
-- silently defeats any narrower one added beside it later.
drop policy if exists repertoire_reconciliation_select_own on public.repertoire_reconciliation;
create policy repertoire_reconciliation_select_own on public.repertoire_reconciliation
  for select using (auth.uid() = player_id);

drop policy if exists repertoire_reconciliation_insert_own on public.repertoire_reconciliation;
create policy repertoire_reconciliation_insert_own on public.repertoire_reconciliation
  for insert with check (auth.uid() = player_id);

drop policy if exists repertoire_reconciliation_update_own on public.repertoire_reconciliation;
create policy repertoire_reconciliation_update_own on public.repertoire_reconciliation
  for update using (auth.uid() = player_id) with check (auth.uid() = player_id);

-- No DELETE policy on purpose: a player never removes their own stamp. There
-- is nothing to gain by deleting one (an absent row already reads as 'epoch'),
-- and rows disappear with the player or the repertoire via the FK cascades.

-- Supabase's default `anon` grant on a new table is not removed by granting to
-- `authenticated` — revoke it explicitly.
revoke all on public.repertoire_reconciliation from anon, public;
grant select, insert, update on public.repertoire_reconciliation to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Widen variation_demotions.cause to allow 'coach_update'.
-- ---------------------------------------------------------------------------
-- A coach revising a line demotes every student who had learned it. That
-- belongs in the same audit trail as the existing demotions (it is the same
-- fact: "this player no longer counts as having learned this variation"), but
-- it is neither a mistake nor a hint — the student did nothing wrong, the
-- material moved under them. Hence a third cause rather than reusing one.
--
-- The constraint is unnamed in 0057 (an inline `check (cause in (...))` on the
-- column), so Postgres auto-named it `variation_demotions_cause_check`.
alter table public.variation_demotions
  drop constraint if exists variation_demotions_cause_check;

alter table public.variation_demotions
  add constraint variation_demotions_cause_check
  check (cause in ('mistake', 'hint', 'coach_update'));

-- ---------------------------------------------------------------------------
-- 4. apply_repertoire_update — the atomic tail of a re-upload.
-- ---------------------------------------------------------------------------
-- Renames chapters in place, retires pruned moves, and refreshes the cached
-- shape columns, all in one transaction so a partial re-upload can never leave
-- a repertoire half-updated.
--
-- There is deliberately NO staleness-check parameter, and nothing here compares
-- `moves_updated_at` against anything. The optimistic-concurrency check lives
-- in the SvelteKit action, BEFORE it writes moves: the move upsert runs ahead
-- of this function and bumps `moves_updated_at` itself (0055's triggers), so an
-- in-function check would reject the caller's own write every single time. Do
-- not re-add the parameter — the check belongs upstream of the write it guards.
--
-- security definer because it has to write moves belonging to the repertoire's
-- owner on a coach's behalf, which the owner-scoped RLS on `moves` would not
-- allow; that is exactly why it does its own authorization check below.
-- `search_path` is pinned per Supabase's linter guidance for definer functions.
create or replace function public.apply_repertoire_update(
  p_repertoire_id uuid,
  p_retire_move_ids uuid[],
  p_chapter_renames jsonb,
  p_total_variations int,
  p_has_chapters boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner  uuid;
  v_rename jsonb;
begin
  -- `for update` holds the repertoire row for the rest of the transaction, so
  -- two concurrent re-uploads of the same repertoire serialize here rather
  -- than interleaving their retires and renames.
  select player_id into v_owner
  from public.repertoires
  where id = p_repertoire_id
  for update;

  if not found then
    raise exception 'Repertoire % not found', p_repertoire_id;
  end if;

  -- Required because this function is security definer: RLS does not apply to
  -- its own statements, so the only thing standing between an arbitrary
  -- authenticated caller and someone else's repertoire is this check. Allowed
  -- callers are the owner, or an active coach of the owner.
  if v_owner <> auth.uid()
     and not exists (
       select 1
       from public.coach_players cp
       where cp.player_id = v_owner
         and cp.coach_id = auth.uid()
         and cp.status = 'active'
     )
  then
    raise exception 'Not authorized to update repertoire %', p_repertoire_id;
  end if;

  -- Chapter renames REPLACE the old name rather than merging the new one
  -- alongside it. Merging is right for a multi-chapter first import — a
  -- transposition means one move edge genuinely belongs to several chapters,
  -- and each must see it — but wrong here, where the whole point is that the
  -- old name stops existing. Appending would leave every renamed line
  -- advertising both names forever.
  --
  -- Renaming in place is also what preserves progress: the move rows keep
  -- their ids, so every `reviews` / `move_attempts` / variation-keyed row
  -- underneath them stays attached. A rename implemented as delete-and-reinsert
  -- would be indistinguishable from a prune plus a fresh line.
  --
  -- `chapter_names` is `text[]` (migration 0048), so both the array_replace
  -- arguments and the containment probe are cast to text explicitly rather
  -- than left to default to unknown/anyelement resolution.
  for v_rename in
    select value from jsonb_array_elements(coalesce(p_chapter_renames, '[]'::jsonb))
  loop
    update public.moves
      set chapter_names = array_replace(
            chapter_names,
            (v_rename->>'from')::text,
            (v_rename->>'to')::text
          )
      where repertoire_id = p_repertoire_id
        and chapter_names @> array[(v_rename->>'from')::text];
  end loop;

  -- Retire the pruned moves. `retired_at is null` in the predicate keeps this
  -- from re-stamping an already-retired move (which would also fire 0055's
  -- trigger for nothing), and makes a re-run of the same apply a no-op.
  if array_length(p_retire_move_ids, 1) > 0 then
    update public.moves
      set retired_at = now()
      where repertoire_id = p_repertoire_id
        and id = any(p_retire_move_ids)
        and retired_at is null;
  end if;

  -- Refresh the cached shape (migrations 0036 / 0043). Computed by the caller
  -- from the new PGN, since it already walked the tree to produce the diff.
  update public.repertoires
    set total_variations = p_total_variations,
        has_chapters = p_has_chapters
    where id = p_repertoire_id;
end $$;

revoke all on function public.apply_repertoire_update(uuid, uuid[], jsonb, int, boolean) from anon, public;
grant execute on function public.apply_repertoire_update(uuid, uuid[], jsonb, int, boolean) to authenticated;
