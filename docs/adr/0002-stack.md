# Stack: Next.js 16 pnpm monorepo, Drizzle, Neon, Auth.js

Status: accepted (2026-10-16, #226 Q16, Q37; owner-rulings R-26, R-30)

v2 uses the sportbet_new stack so its factory kit (agent roles, quality gate, hooks, CI) transfers one-to-one: a pnpm monorepo with Next.js 16 in `apps/web` and packages `domain`, `chess` and `db`; Drizzle over Neon Postgres; Auth.js for sign-in (email magic link, Google, and Lichess OAuth, which also links the Lichess account; Lichess sign-in ships in M1 (R-68)).

## Consequences

- Chess correctness (PGN, position graph, opening taxonomy, FSRS scheduling) lives in `packages/chess` and `packages/domain`, free of framework and database code.
- Authorization is application code, not database row-level security; v1's Supabase RLS patterns are reference only.
- No Supabase services (auth, storage, realtime) are available; each need is met inside this stack.

## Considered options

- Keep SvelteKit + Supabase (v1): rejected; the factory kit would not transfer.
