-- mychess/supabase/migrations/0033_repertoire_delete_cascade.sql
-- Enables deleting a repertoire that's ever been practiced. `moves`,
-- `assigned_repertoires`, `variation_progress`, and `level_progress` already
-- cascade from `repertoires` correctly, but two more tables sit downstream
-- with no `on delete` rule (default RESTRICT): `sessions.repertoire_id` and
-- `review_events.move_id` (review_events blocks the moves cascade itself,
-- since moves cascades from repertoires). Any repertoire with practice
-- history already has rows in both, so a repertoire delete fails today with
-- a foreign-key violation. Fix: cascade both — deleting a repertoire also
-- deletes its sessions/review_events. player_stats is a separate aggregate
-- table with no FK here, so it's untouched by this.
alter table public.sessions
  drop constraint sessions_repertoire_id_fkey,
  add constraint sessions_repertoire_id_fkey
    foreign key (repertoire_id) references public.repertoires(id) on delete cascade;

alter table public.review_events
  drop constraint review_events_move_id_fkey,
  add constraint review_events_move_id_fkey
    foreign key (move_id) references public.moves(id) on delete cascade;
