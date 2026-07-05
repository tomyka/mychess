-- Live (IN_PROGRESS) tournaments should always sort to the very top of the
-- list, ahead of upcoming and past events, regardless of day_distance — a
-- tournament that started a few days ago but is still ongoing should still
-- outrank one starting tomorrow.

-- Postgres requires CREATE OR REPLACE VIEW to keep existing columns in their
-- original position (it treats a reordering as a rename, which it disallows)
-- — so the new is_live column must be appended after day_distance, not
-- inserted before is_past.
create or replace view public.tournaments_ranked
  with (security_invoker = true) as
select
  t.*,
  -- Upcoming/today = false sorts before past = true.
  -- start_date is timestamptz; compare on the date part.
  (t.start_date is not null and t.start_date::date < current_date) as is_past,
  -- Distance in days from today; ascending puts the soonest upcoming and the
  -- most-recently-finished nearest the top of their respective groups.
  case when t.start_date is not null then abs(current_date - t.start_date::date) end as day_distance,
  (t.status = 'IN_PROGRESS') as is_live
from public.tournaments t;

-- New views are not covered by table grants; expose it to the API roles.
grant select on public.tournaments_ranked to anon, authenticated, service_role;
