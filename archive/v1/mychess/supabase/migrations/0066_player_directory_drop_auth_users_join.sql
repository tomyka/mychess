-- Supabase Security Advisor flagged player_directory as "Auth Users
-- Exposed" (critical): it's a non-security_invoker view granted to
-- `authenticated` that joins auth.users, so it runs with the view owner's
-- elevated privileges rather than the caller's own (which has no grants on
-- auth.users at all) -- exactly the pattern that lint exists to catch,
-- regardless of the fact that no auth.users column was ever selected into
-- the output.
--
-- The join (added in 0056) filtered out anonymous/guest accounts via
-- auth.users.is_anonymous. Anonymous auth has since been fully retired: the
-- guest-session-minting code was deleted (2c78875), the Supabase "Anonymous
-- sign-ins" provider is disabled, and every guest row was purged (#90) -- so
-- no anonymous account can exist any more and the filter is now permanently
-- a no-op. Dropping the join removes the exposure and the dead filter in one
-- move; the view is back to exactly coach_directory's shape (profiles-only,
-- role-filtered).
create or replace view public.player_directory as
select id, first_name, last_name, display_name, avatar_id
from public.profiles
where role = 'player';

grant select on public.player_directory to authenticated;
revoke all on public.player_directory from anon, public;
