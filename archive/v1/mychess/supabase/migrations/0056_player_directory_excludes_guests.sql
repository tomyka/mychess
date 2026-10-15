-- Coaches searching for a student in /coach/students were seeing guest
-- (anonymous) accounts in the results — they have no real identity, can't be
-- meaningfully added as a student, and clutter the list. profiles carries no
-- flag of its own for this; auth.users.is_anonymous (Supabase's built-in
-- anonymous-auth marker, already read elsewhere as session.user.is_anonymous)
-- is the source of truth, so the view now joins it.
--
-- No coach_directory equivalent needed: ensureGuestProfile (src/lib/server/guest.ts)
-- always creates guest profiles with role = 'player', so no anonymous account
-- can ever appear in coach_directory (role = 'coach') in the first place.
create or replace view public.player_directory as
select p.id, p.first_name, p.last_name, p.display_name, p.avatar_id
from public.profiles p
join auth.users u on u.id = p.id
where p.role = 'player' and coalesce(u.is_anonymous, false) = false;

grant select on public.player_directory to authenticated;
revoke all on public.player_directory from anon, public;
