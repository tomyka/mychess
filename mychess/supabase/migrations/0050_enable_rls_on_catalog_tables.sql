-- mychess/supabase/migrations/0050_enable_rls_on_catalog_tables.sql
--
-- SECURITY FIX. `0002_rls.sql` enables row level security on 12 tables
-- (its lines 1-12) and then, at lines 91-94, creates read policies for four
-- MORE tables — `badges`, `avatars`, `themes`, `piece_sets` — which were
-- never added to that enable list. A policy on a table without RLS enabled
-- is inert: Postgres never consults it. Combined with Supabase's default
-- grants to `anon` (which, per this project's own CLAUDE.md notes, are NOT
-- revoked by granting to `authenticated`), that leaves all four tables
-- readable AND WRITABLE by any holder of the public anon key.
--
-- `badges` is live (read by `(player)/badges/+page.server.ts`), so it is the
-- one that actually matters today; the other three are unreferenced by any
-- application code and are dropped in the follow-up migration 0051. RLS is
-- still enabled on them here so that this migration stands alone as a
-- complete fix — it is safe and correct to apply even if 0051 never runs.
--
-- Written idempotently: `enable row level security` is a no-op if already
-- enabled, and the grant/revoke statements are naturally repeatable, so this
-- can be re-run safely (and survives a partial application, which bit this
-- project on migration 0049).
alter table public.badges     enable row level security;
alter table public.avatars    enable row level security;
alter table public.themes     enable row level security;
alter table public.piece_sets enable row level security;

-- These are read-only reference catalogs: no application code writes them,
-- so no write policy is added — with RLS on and no permissive policy for
-- insert/update/delete, writes are denied outright. The existing
-- `badges_catalog_read` / `avatars_read` / `themes_read` / `piece_sets_read`
-- policies from 0002 supply the read access, and only now take effect.
revoke all on public.badges     from anon, public;
revoke all on public.avatars    from anon, public;
revoke all on public.themes     from anon, public;
revoke all on public.piece_sets from anon, public;

grant select on public.badges     to authenticated;
grant select on public.avatars    to authenticated;
grant select on public.themes     to authenticated;
grant select on public.piece_sets to authenticated;
