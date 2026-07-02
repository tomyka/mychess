-- Tournaments list default ordering: upcoming/ongoing first (soonest first),
-- past events sink to the bottom (most-recently-finished first).
--
-- PostgREST can only ORDER BY real columns, not expressions, so we expose the
-- sort keys through a view. `security_invoker = true` makes the view respect the
-- caller's RLS on the underlying tournaments table (the existing public-read
-- policy), so no separate policy is needed.

create or replace view public.tournaments_ranked
  with (security_invoker = true) as
select
  t.*,
  -- Upcoming/today = false sorts before past = true.
  -- start_date is timestamptz; compare on the date part.
  (t.start_date is not null and t.start_date::date < current_date) as is_past,
  -- Distance in days from today; ascending puts the soonest upcoming and the
  -- most-recently-finished nearest the top of their respective groups.
  case when t.start_date is not null then abs(current_date - t.start_date::date) end as day_distance
from public.tournaments t;

-- New views are not covered by table grants; expose it to the API roles.
grant select on public.tournaments_ranked to anon, authenticated, service_role;
