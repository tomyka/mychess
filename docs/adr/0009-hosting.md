# Hosting: Vercel, Neon, GitHub-hosted runners, Resend

Status: accepted (2026-10-16, #226 Q13, Q21, Q40; owner-rulings R-6, R-27, R-35)

v2 runs on fresh infrastructure: Vercel staging and production, Neon Postgres with a branch per environment, CI on GitHub-hosted runners, and email through Resend on staging and production (via Vercel Marketplace), with Mailpit locally. v1's Vercel project and Supabase database are frozen.

## Consequences

- Each environment has its own Neon branch; staging data never touches production.
- No self-managed servers: scheduled work (the daily Digest, integration imports) must run on Vercel.
- Email is testable locally without sending real mail.

## Considered options

- Self-hosted or Oracle runners: rejected.
- Reusing v1's Vercel project and Supabase: rejected; v1 is frozen.
