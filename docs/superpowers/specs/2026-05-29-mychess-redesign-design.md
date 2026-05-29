# mychess — Redesign: Active Player Daily Dashboard

**Date:** 2026-05-29  
**Status:** Draft  
**Replaces:** `2026-05-28-mychess-design.md` (kids learning app, now fully superseded)

---

## 1. Overview

mychess becomes a **daily dashboard for active OTB chess players**, focusing on FIDE rating tracking, national/age-group standings, and local tournament discovery. The chess-tournaments repo (Lithuanian/Latvian OTB tournament browser) is merged in and its standalone repo retired. A training section (opening drill, SRS practice) is retained for players who use the app for preparation.

**Not** a kids app. **Not** coach-managed. **Not** gamified with XP/badges/quests.

---

## 2. Target User

A rated FIDE player (adult or junior managing their own account) who:
- Wants to check their current FIDE rating and when it last changed
- Wants to see where they rank in their country and age group
- Plays OTB tournaments in Lithuania or Latvia and wants to discover/track upcoming events
- Optionally uses opening drill/practice for tournament prep

Primary geography: Lithuania and Latvia (matching the existing tournament data source).

---

## 3. Information Architecture

```
/ (root)
├── /                     → Dashboard (logged in) or Landing page (public, no login required)
├── /tournaments          → OTB tournament browser (public, no login required)
├── /tournaments/[id]     → Tournament detail + player list
├── /train                → Opening training: drill, practice, SRS, repertoire
├── /train/repertoires    → Manage repertoires
├── /train/drill          → Drill mode
├── /train/practice       → Practice mode
├── /train/time-trial     → Time trial
├── /profile              → FIDE ID setup, account settings
├── /login                → Email/password login + signup
└── /auth/callback        → Supabase auth callback
```

**Navigation tabs (bottom on mobile, top on desktop):**
- 🏠 Dashboard (logged-in only) / 🏆 Tournaments (always visible) / ♟ Train (logged-in) / 👤 Profile (logged-in)

**Public routes (no login required):** `/`, `/tournaments`, `/tournaments/[id]`, `/login`  
**Logged-in routes:** `/train/**`, `/profile`  
**Mixed (`/`):** renders the public landing page for unauthenticated visitors; renders the personal dashboard for authenticated users. No redirect — a single route handles both cases via session check in `+page.server.ts`.

---

## 4. Dashboard Section

### 4.1 FIDE Rating Widget

Shows the logged-in player's current FIDE data (fetched from their linked FIDE ID):

- Current standard/rapid/blitz ratings (whichever are active)
- Last rating change (delta from previous period, with date)
- Rating history sparkline (last 12 months of standard rating)
- FIDE title (if any: FM, CM, etc.)
- K-factor

**Rating history storage:** Each refresh upserts a row to `fide_rating_history(user_id, period, standard_rating, fetched_at)`. Only standard rating is available in the FIDE profile history table; rapid/blitz history are not tracked. The sparkline queries the last 12 distinct period rows ordered by `period ASC`.

**Data source:** FIDE profile page at `https://ratings.fide.com/profile/{fideId}` — scraped and cached in Supabase. The profile page exposes a rating history table (one row per FIDE period). On each scrape, all visible history rows are upserted into `fide_rating_history`.

**Stale / failure handling:**
- If the FIDE scrape fails (network error, unexpected HTML), the last successfully cached data is shown with a "Last updated X ago" label in amber.
- If no data has ever been fetched, the widget shows a skeleton with a "Fetch my rating" button.
- Scrape errors are stored in `fide_cache.last_error` (text column). On a successful scrape, `last_error` is set to null.

**Refresh schedule:** Supabase Edge Function `fide-profile-refresh` runs daily at 03:00 UTC, refreshing all users with a linked FIDE ID. Player can manually trigger a refresh once per hour (rate-limited by `fide_cache.last_manual_refresh_at`).

If no FIDE ID is linked, the widget prompts to set one in `/profile`.

### 4.2 Standings Widget

Shows the player's rank within their **country** and **age group** based on the current FIDE standard rating list.

- Rank in country (e.g., "#47 in Lithuania")
- Rank in country × age group (e.g., "#3 in Lithuania U25")
- Nearest rated players above/below them (±3 players in the ranking)

**Age group bucket logic:** Computed from `birth_year` and the rating period year. A player born in year `B` is in the youngest group where `period_year - B < group_limit`. Buckets (FIDE standard):

| Group | Condition (age at end of period year) |
|-------|---------------------------------------|
| U10   | ≤ 9                                   |
| U12   | ≤ 11                                  |
| U14   | ≤ 13                                  |
| U16   | ≤ 15                                  |
| U18   | ≤ 17                                  |
| U20   | ≤ 19                                  |
| U25   | ≤ 24                                  |
| U30   | ≤ 29                                  |
| U40   | ≤ 39                                  |
| U50   | ≤ 49                                  |
| U65   | ≤ 64                                  |
| Open  | all ages (always included)            |

A player always appears in their tightest group **and** in Open. Age is computed as `period_year - birth_year` (FIDE convention: calendar year difference, not birthday-exact).

**Missing data handling:**
- If `birth_year` is null in `fide_players`, the player is placed in Open only and excluded from age-group buckets.
- If the user's FIDE ID is not found in `fide_players` (not yet in this period's download), the standings widget shows "Standings not yet available — list updates monthly" with the last-sync date.
- If `fide_players` table is empty (first run before any sync), show the same message.

**Data source:** `fide_players` table (see §7.2). Standings are computed at query time with a SQL window function `DENSE_RANK() OVER (PARTITION BY federation ORDER BY standard_rating DESC NULLS LAST)`.

**Stale data:** If `fide_players.period` is more than 45 days old, display a "Rating list may be outdated" notice in amber.

### 4.3 Upcoming Tournaments Widget

A compact list of the next 3 upcoming tournaments from the tournament database (same data as the `/tournaments` section), without filters. Links to `/tournaments`.

---

## 5. Tournaments Section (Migrated from chess-tournaments)

### 5.1 Feature Parity

Full migration of all chess-tournaments functionality:

- **Tournament list** with pagination / load-more
- **Filters**: status (upcoming/in-progress/finished), time control (standard/rapid/blitz), country (Lithuania/Latvia), date range
- **Calendar view** toggle (list ↔ calendar)
- **Tournament card**: name, city, dates, time control, player count, average rating, status badge, link to chess-results.com
- **Tournament detail page** (`/tournaments/[id]`): all card fields + full player list (name, FIDE ID, rating, federation, title, rank, points)
- **Active filters** display with clear-all
- **Empty state** when no tournaments match filters
- **Results counter**

**`/tournaments/[id]` identifier:** The `[id]` segment is the internal `tournaments.id` (a UUID string). The `chess_results_id` is used exclusively inside the scraper for upsert deduplication and is never exposed in URLs. The detail page route loads the tournament by `id` via `src/routes/tournaments/[id]/+page.server.ts` using a simple `SELECT * FROM tournaments WHERE id = $1`. If no row is found, the page calls SvelteKit's `error(404, 'Tournament not found')`.

**Tournament detail scraping:** When a tournament is scraped from the federation list page, its detail URL (`tournament.url`, pointing to chess-results.com) is visited to retrieve the player list. The player list is scraped from the cross-table or player-list tab on chess-results.com. Players are upserted into `tournament_players` using two strategies in sequence: (a) players **with** a `fide_id` are upserted on conflict `(tournament_id, fide_id)` — update name, rating, federation, title, rank, points; (b) players **without** a `fide_id` are upserted on conflict `(tournament_id, name, rank)` — update rating, federation, title, points. Players are upserted using the two-pass strategy above. If the detail page fetch fails, the tournament row is still upserted without players, and the error is recorded in `scrape_logs.message`. The detail page is re-scraped on subsequent runs until players are successfully loaded.

### 5.2 Scraper Migration

The cheerio-based scraper from `chess-tournaments/src/lib/scraper.ts` is ported to a SvelteKit server module at `mychess/src/lib/tournaments/scraper.ts`. It scrapes `chess-results.com/fed.aspx?lan=1&fed=LTU` and `fed=LAT`.

**Cron architecture:** The Supabase Edge Function `tournaments-scrape` is the scheduler — it runs on a 6-hour interval and makes an HTTP POST to `https://<app-domain>/api/tournaments/scrape` with `Authorization: Bearer {CRON_SECRET}`. The SvelteKit route is the implementation. This separates scheduling (Edge Function) from business logic (SvelteKit). The Edge Function itself contains only the HTTP call; all scrape logic lives in the SvelteKit server.

**Manual trigger:** Anyone who possesses `CRON_SECRET` can POST to `/api/tournaments/scrape` directly (e.g., from curl during development). There is no user-role-based admin — access is solely controlled by the shared secret. The secret is set in Vercel environment variables and in the Supabase Edge Function's secrets.

**Failure handling:**
- If chess-results.com is unreachable, the scrape job logs `status: 'error'` with the error message to `scrape_logs` and exits cleanly. Previously scraped tournaments remain visible.
- Partial scrapes (some tournaments updated, then network error): completed upserts are persisted; the log records how many succeeded before failure.
- Stale data notice: if `max(last_scraped_at)` across all tournaments is more than 12 hours old, the tournaments page shows a "Data may be outdated" banner.

### 5.3 Database Tables (Supabase migration)

Tournament data moves from Prisma/Neon to Supabase Postgres:

```sql
-- Tournaments
create table tournaments (
  id            text primary key default gen_random_uuid()::text,
  chess_results_id text unique not null,
  name          text not null,
  country       text not null default 'Lithuania',
  city          text,
  start_date    timestamptz,
  end_date      timestamptz,
  time_control  text not null default 'UNKNOWN', -- STANDARD|RAPID|BLITZ|UNKNOWN
  status        text not null default 'NOT_STARTED', -- NOT_STARTED|IN_PROGRESS|FINISHED
  player_count  int,
  average_rating int,
  round_count   int,
  chief_arbiter text,
  organizer     text,
  url           text not null,
  last_scraped_at timestamptz default now(),
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- Tournament players
create table tournament_players (
  id            text primary key default gen_random_uuid()::text,
  tournament_id text not null references tournaments(id) on delete cascade,
  name          text not null,
  fide_id       text,
  rating        int,
  federation    text,
  title         text,
  rank          int,
  points        numeric(4,1),
  -- fide_id is preferred for deduplication; name+rank used when fide_id is absent
  unique nulls not distinct (tournament_id, fide_id),
  unique(tournament_id, name, rank)
);

-- Scrape log
create table scrape_logs (
  id            text primary key default gen_random_uuid()::text,
  started_at    timestamptz default now(),
  finished_at   timestamptz,
  status        text default 'running', -- running|success|error
  message       text,
  tournaments_found int default 0,
  tournaments_updated int default 0
);
```

RLS: `tournaments` and `tournament_players` are public read. `scrape_logs` is service-role write only.

---

## 6. Training Section (Retained, Reframed)

The opening training tools from the current mychess are kept but rebranded for adult players. No kid-specific UI, no gamification layer.

### 6.1 Routes

| Route | File | Description |
|---|---|---|
| `/train` | `src/routes/train/+page.svelte` | Training hub: links to repertoires, drill, practice, time-trial; shows review queue count |
| `/train/repertoires` | `src/routes/train/repertoires/+page.svelte` | List/manage repertoires; PGN upload; chess.com/lichess import |
| `/train/drill` | `src/routes/train/drill/+page.svelte` | Opening quiz — shows position, user plays the correct move |
| `/train/practice` | `src/routes/train/practice/+page.svelte` | Free board for exploring lines |
| `/train/time-trial` | `src/routes/train/time-trial/+page.svelte` | Speed drill mode |

**Exact route mapping from `/(kid)/`:**

| Old route | Action |
|---|---|
| `/(kid)/drill/**` | Renamed → `/train/drill/**` |
| `/(kid)/practice/**` | Renamed → `/train/practice/**` |
| `/(kid)/time-trial/**` | Renamed → `/train/time-trial/**` |
| `/(kid)/repertoires/**` | Renamed → `/train/repertoires/**` |
| `/(kid)/learn/**` | **Deleted** — content merged into drill |
| `/(kid)/settings/**` | **Deleted** — merged into `/profile` (Phase 2) |
| `/(kid)/badges/**` | **Deleted** |
| `/(kid)/cosmetics/**` | **Deleted** |
| `/(kid)/+page.*` | **Deleted** — replaced by `/` |

Auth protection is enforced in `src/routes/train/+layout.server.ts` (redirect to `/login` if no session).

### 6.2 API Routes Retained

| Route | File | Description |
|---|---|---|
| `POST /api/review` | `src/routes/api/review/+server.ts` | Submit SRS review result, update next review time |
| `POST /api/drill` | `src/routes/api/drill/+server.ts` | Get next drill card from queue |
| `POST /api/time-trial` | `src/routes/api/time-trial/+server.ts` | Submit time-trial result |
| `POST /api/import/lichess` | `src/routes/api/import/lichess/+server.ts` | Import games from lichess API |
| `POST /api/import/chesscom` | `src/routes/api/import/chesscom/+server.ts` | Import games from chess.com API |
| `GET /api/notes/read` | `src/routes/api/notes/read/+server.ts` | Fetch move annotation notes |

**Removed API routes:** `/api/quests/**`, `/api/cosmetics/**` — deleted entirely.

### 6.3 Data Model (No Change)

The underlying training tables (`repertoires`, `positions`, `moves`, `reviews`, `review_events`) are unchanged. Only the gamification overlay tables are dropped (see §9).

### 6.4 UI Changes

- Remove `SirKnight.svelte`, `XpBar.svelte`, `StreakBadge.svelte`, `DailyGoalRing.svelte` from all training pages
- Remove XP/level/streak display from `+layout.svelte` in the training section
- The `/welcome` route is deleted entirely. After login, users are redirected to `/` (the dashboard/landing route handles the logged-in state).
- `ChessBoard.svelte` and `PgnUpload.svelte` are retained unchanged

---

## 7. FIDE Data Pipeline

### 7.1 Player Profile Scraper

**Endpoint:** `POST /api/fide/refresh` — requires valid session (logged-in). Rate-limited: at most once per hour per user, enforced by checking `fide_cache.last_manual_refresh_at`.

**Steps:**
1. Read `fide_id` from `profiles` for the authenticated user. Return 400 if not set.
2. Fetch `https://ratings.fide.com/profile/{fideId}` (HTML). On **network error** (timeout, DNS failure), return HTTP 502 and write the error message to `fide_cache.last_error`. On **parse failure** (page loads but expected elements not found, e.g. FIDE changed their HTML), return HTTP 422 and write the parse error to `fide_cache.last_error`. In both cases, previously cached data is preserved and shown to the user with an "Update failed" notice.
3. Parse from the HTML: standard/rapid/blitz ratings, title, K-factor, last change date, and the rating history table (one row per FIDE period: period string + standard rating).
4. Upsert into `fide_cache` (current snapshot) and bulk-upsert all history rows into `fide_rating_history`.
5. Return the parsed current snapshot as JSON.

**`fide_cache` table schema:**
```sql
create table fide_cache (
  user_id           uuid primary key references auth.users(id) on delete cascade,
  fide_id           text not null,
  standard_rating   int,
  rapid_rating      int,
  blitz_rating      int,
  title             text,        -- e.g. 'FM', 'CM', null
  k_factor          int,
  last_change_date  text,        -- FIDE period string, e.g. '2026-05'
  last_change_delta int,         -- rating points delta vs previous period
  fetched_at        timestamptz not null default now(),
  last_manual_refresh_at timestamptz,
  last_error        text         -- last scrape error message, null if last scrape succeeded
);
```

**`fide_rating_history` table schema:**
```sql
create table fide_rating_history (
  user_id         uuid not null references auth.users(id) on delete cascade,
  period          text not null,  -- e.g. '2026-05'
  standard_rating int,            -- only standard rating is in the history table on the FIDE profile page
  fetched_at      timestamptz not null default now(),
  primary key (user_id, period)
);
```

Note: The FIDE profile page history table shows only standard rating per period. Rapid/blitz history is not available from this source, so the history table stores only `standard_rating`. The sparkline displays standard rating only.

History is populated as part of the same scrape pass that updates `fide_cache`. The profile page HTML contains a history table; all rows visible on that page are upserted. This means history accumulates over time as successive periods become visible on the FIDE profile.

**RLS:** `fide_cache` and `fide_rating_history` are **read-only for authenticated users** (select own rows: `user_id = auth.uid()`). All writes go through the service-role key only — the `/api/fide/refresh` and `/api/fide/batch-refresh` endpoints use the Supabase service-role client, not the user session client, for all upserts. Users cannot write to these tables directly.

**Two FIDE API routes with distinct auth contracts:**

`POST /api/fide/refresh` — **session-authenticated user route.** Refreshes the calling user's own FIDE data. Requires a valid Supabase session cookie. Rate-limited to once per hour via `fide_cache.last_manual_refresh_at`. Returns the refreshed snapshot as JSON.

`POST /api/fide/batch-refresh` — **cron-authenticated server route.** Accepts `Authorization: Bearer {CRON_SECRET}`. Iterates all rows in `profiles` where `fide_id IS NOT NULL`, calls the shared scrape logic for each user, upserts results into `fide_cache` and `fide_rating_history` using the service-role key. Returns a summary `{ refreshed: N, errors: M }`. The Supabase Edge Function `fide-profile-refresh` calls this endpoint daily. No session is involved.

Both routes share the same underlying scrape logic in `src/lib/fide/scraper.ts`; only auth and iteration differ.

### 7.2 Rating List (for standings)

Supabase Edge Function `fide-rating-list-sync` runs monthly (1st of each month):

1. Download `https://ratings.fide.com/download/players_list.zip`
2. Unzip and parse the text file (fixed-width columns: name, FIDE ID, federation, rating, title, birth year, gender, games)
3. Filter to LTU and LAT federations only (≈ 2,000–5,000 rows)
4. Upsert all rows into `fide_players` table (conflict target: `fide_id`, update all fields)
5. After all upserts succeed, delete rows where `period != $current_period` in the same database transaction to ensure no window where the table is empty

`fide_players` table:
```sql
create table fide_players (
  fide_id       text primary key,
  name          text not null,
  federation    text not null,
  standard_rating int,
  rapid_rating  int,
  blitz_rating  int,
  title         text,
  birth_year    int,
  gender        text,
  period        text not null, -- e.g. '2026-05'
  updated_at    timestamptz default now()
);
```

**Standings SQL:** Two separate window functions computed in a single query:

```sql
-- Country rank
DENSE_RANK() OVER (PARTITION BY federation ORDER BY standard_rating DESC NULLS LAST) AS country_rank,
-- Age-group rank (age_group computed column: period_year - birth_year mapped to bucket label)
DENSE_RANK() OVER (PARTITION BY federation, age_group_bucket ORDER BY standard_rating DESC NULLS LAST) AS age_group_rank
```

`age_group_bucket` is a computed label (e.g. `'U25'`) derived inline from `(SPLIT_PART(period, '-', 1)::int - birth_year)` — i.e., the rating period year minus birth year — using a CASE expression matching the bucket rules in §4.2. This matches the FIDE convention: age is the calendar year difference between the period year and birth year, not today's date. Players with null `birth_year` get bucket `'Open'`.

**Non-LTU/LAT users:** A user with a FIDE ID from another federation (e.g. POL) can still link their FIDE ID and see their rating widget and sparkline. The standings widget shows "Standings are only available for Lithuania and Latvia players" — this is permanent and expected, not an error state. It is shown immediately after FIDE ID validation (federation is known from the live fetch parse).

---

## 8. Authentication & Profiles

**Auth**: Email/password (existing Supabase auth). Anonymous guest sessions for `/tournaments` (no change).

**Profile changes:**
- Remove: `coach_id`, `role` (kid/coach), `invite_token`, avatar cosmetics, XP/level fields
- Add: `fide_id text`, `fide_name text`, `federation text default 'LTU'`, `birth_year int`
- Keep: `id`, `email`, `created_at`

**Federation source of truth:** `profiles.federation` is set at FIDE ID validation time (parsed from the live FIDE profile fetch). It is later kept in sync from `fide_players.federation` on each successful batch-refresh. `fide_players.federation` is always the authoritative value for standings computation. `profiles.federation` is only used as a UI display value (e.g., showing the player's flag) and as a fallback when `fide_players` has no row yet.

**FIDE ID validation:** Two-step. Step 1 (format): the ID must be a string of 7–9 digits (FIDE IDs range from 7 to 9 digits). Reject immediately with "Invalid FIDE ID format" if this fails. Step 2 (live fetch): fetch `https://ratings.fide.com/profile/{fideId}` and parse the player name **and federation** from the HTML. If the page returns 404 or the name cannot be parsed, reject with "No FIDE profile found for ID {fideId}". On success, store the parsed name in `profiles.fide_name` and the parsed federation in `profiles.federation`. `profiles.birth_year` is **not** set at validation time — it is set later when the `fide_players` table is populated (monthly sync), which provides birth year from the FIDE rating list. Until then, `profiles.birth_year` remains null and age-group standings show "Not yet available — updates monthly".

**FIDE ID changes:** If a user updates their `fide_id` in `/profile`, the system deletes all existing rows in `fide_cache` and `fide_rating_history` for that `user_id` before saving the new ID. This prevents mixing data from two different players. The update is atomic: the delete and the profile upsert run in a single Supabase transaction (RPC). After the update, the user sees the "Fetch my rating" skeleton until the first successful refresh.

**`profiles.birth_year` and `profiles.federation` sync job:** These columns are synced by the `fide-rating-list-sync` Edge Function (monthly, see §7.2). After each successful upsert of `fide_players`, the function runs: `UPDATE profiles SET birth_year = fp.birth_year, federation = fp.federation FROM fide_players fp WHERE profiles.fide_id = fp.fide_id`. This is the only job that writes `birth_year` to profiles.

**`profiles.birth_year` and `profiles.federation` once FIDE data exists:** These columns are display fallbacks only — used when `fide_players` has no row for the user's FIDE ID (e.g., before the first monthly sync). Once `fide_players` has data, all standings computation uses `fide_players.federation` and `fide_players.birth_year`. They are authoritative.

---

## 9. What Is Removed

From the current mychess codebase, the following are deleted entirely:

| Removed | Notes |
|---|---|
| `/(coach)` routes | coach dashboard, invite, pgn upload, kid detail |
| `/(kid)` cosmetics route | avatar cosmetics |
| `/(kid)` badges route | badge system |
| `src/lib/badges/` | grant.ts, recalc.ts, tests |
| `src/lib/quests/` | generate.ts, test |
| `src/lib/cosmetics.ts` | |
| `src/lib/sounds.ts` | |
| `src/lib/components/SirKnight.svelte` | mascot |
| `src/lib/components/XpBar.svelte` | |
| `src/lib/components/StreakBadge.svelte` | |
| `src/lib/components/DailyGoalRing.svelte` | |
| `src/lib/components/LeaderboardPodium.svelte` | (replaced by FIDE standings) |
| `src/routes/api/quests/` | |
| `src/routes/api/cosmetics/` | |
| `src/routes/join/[token]/` | invite flow |
| `src/routes/welcome/` | kid welcome |
| Supabase migrations 0006_badges, parts of 0005/0007 | badge/quest/cosmetic tables |

---

## 10. chess-tournaments Migration

The chess-tournaments repo is a Next.js 15 / Prisma / Neon app. Migration to mychess (SvelteKit / Supabase):

| chess-tournaments | mychess destination |
|---|---|
| `src/lib/scraper.ts` | `src/lib/tournaments/scraper.ts` |
| `src/lib/scraper-utils.ts` | `src/lib/tournaments/scraper-utils.ts` |
| `src/lib/scrape-job.ts` | `src/lib/tournaments/scrape-job.ts` |
| `src/lib/tournament-query-utils.ts` | `src/lib/tournaments/query.ts` |
| `src/components/tournaments/*.tsx` | `src/lib/components/tournaments/*.svelte` (ported to Svelte) |
| `src/app/tournaments/page.tsx` | `src/routes/tournaments/+page.svelte` |
| `src/app/tournaments/TournamentsClient.tsx` | `src/routes/tournaments/+page.svelte` (merged) |
| `src/app/api/scrape/` | `src/routes/api/tournaments/scrape/+server.ts` |
| Prisma schema + Neon DB | Supabase migration `0008_tournaments.sql` |
| Vercel Cron `every 6h` | Supabase Edge Function `tournaments-scrape` |
| `src/lib/scraper.test.ts` | `src/lib/tournaments/scraper.test.ts` |
| `src/lib/tournament-query-utils.test.ts` | `src/lib/tournaments/query.test.ts` |

The Next.js-specific code (React components, App Router pages) is not copied verbatim — the UI logic and scraper logic are ported, with React components rewritten as Svelte components.

---

## 11. Tech Stack (Final)

| Layer | Technology |
|---|---|
| Framework | SvelteKit 2 + TypeScript |
| Styling | Tailwind CSS 4 |
| DB / Auth | Supabase (Postgres + Row Level Security) |
| Scraping | cheerio (ported from chess-tournaments) |
| Chess UI | chessground + chess.js |
| SRS | ts-fsrs |
| Testing | Vitest |
| Hosting | Vercel |
| Cron jobs | Supabase Edge Functions |

Removed from chess-tournaments: Next.js, React, Prisma, Neon, Framer Motion, shadcn/ui, base-ui.

---

## 12. Public Landing Page (`/`)

When the user is **not logged in**, `/` renders a public landing page (not a redirect to `/login`):

- Hero section: app name + one-line pitch ("Your FIDE rating, standings, and local tournaments — in one place")
- "Upcoming tournaments" teaser: 3 nearest upcoming tournaments (same data as `/tournaments`, no filters)
- CTA buttons: "Browse all tournaments" → `/tournaments` and "Sign in to see your stats" → `/login`

When the user **is logged in**, `/` renders the personal dashboard (§4).

The route `src/routes/+page.svelte` checks `locals.session` in `+page.server.ts` and returns either `{ loggedIn: true, ...dashboardData }` or `{ loggedIn: false, upcomingTournaments: [...] }`. The Svelte component renders conditionally.

---

## 13. Implementation Phases

This is an umbrella spec covering three independently deployable workstreams. **Three separate implementation plans will be written**, one per phase, each with its own plan file. This spec is the shared design reference for all three. The reviewer tool flags this as "too broad for a single plan" — that is correct and intentional; the plans will be phase-scoped.

**Phase 1 — Tournament migration (chess-tournaments → mychess)**
- Port scraper (cheerio), DB migration `0008_tournaments.sql`, API route `/api/tournaments/scrape`
- Supabase Edge Function `tournaments-scrape` (6h cron)
- Svelte tournament UI: list, filters, calendar, detail page (`/tournaments/[id]`), player list
- Public landing page (§12) update to show upcoming tournaments widget
- Retire chess-tournaments repo once verified in production

*Acceptance criteria:* `/tournaments` lists tournaments with working filters and calendar view; `/tournaments/[id]` shows the player list; `POST /api/tournaments/scrape` with valid `CRON_SECRET` triggers a scrape and returns a success summary; `npm test` passes; `npm run check` passes; chess-tournaments repo is archived/deleted.

**Phase 2 — FIDE dashboard**
- `profiles` table migration: add `fide_id`, `fide_name`, `federation`, `birth_year`
- FIDE scraper module: `src/lib/fide/scraper.ts` (profile + history parsing)
- API routes `/api/fide/refresh` and `/api/fide/batch-refresh`; DB tables `fide_cache` + `fide_rating_history`
- Dashboard page `/`: rating widget + sparkline + standings widget (logged-in view)
- FIDE rating list sync: Edge Function `fide-rating-list-sync`, `fide_players` table, monthly cron
- Profile setup page `/profile`: FIDE ID entry + validation

*Acceptance criteria:* Logged-in user with a valid FIDE ID sees their current rating, 12-month sparkline, and country/age-group rank on `/`; `/profile` accepts and validates a FIDE ID; `POST /api/fide/batch-refresh` with valid `CRON_SECRET` refreshes all users; standings show correct rank within LTU/LAT federation using `fide_players` data; `npm test` passes; `npm run check` passes.

**Phase 3 — Training de-gamification and re-routing**

Route/file changes:

| Old path | New path | Action |
|---|---|---|
| `src/routes/(kid)/+page.*` | deleted | home page replaced by `/` dashboard |
| `src/routes/(kid)/learn/**` | deleted | `learn` route removed (merged into drill) |
| `src/routes/(kid)/drill/**` | `src/routes/train/drill/**` | renamed |
| `src/routes/(kid)/practice/**` | `src/routes/train/practice/**` | renamed |
| `src/routes/(kid)/time-trial/**` | `src/routes/train/time-trial/**` | renamed |
| `src/routes/(kid)/repertoires/**` | `src/routes/train/repertoires/**` | renamed |
| `src/routes/(kid)/settings/**` | `src/routes/profile/**` | merged into profile |
| `src/routes/(kid)/badges/**` | deleted | badge system removed |
| `src/routes/(kid)/cosmetics/**` | deleted | cosmetics removed |
| `src/routes/(coach)/**` | deleted | all coach routes removed |
| `src/routes/welcome/**` | deleted | replaced by `/` landing |
| `src/routes/join/[token]/**` | deleted | invite flow removed |
| `src/routes/(kid)/+layout.*` | `src/routes/train/+layout.*` | new training layout, no gamification |
| `src/routes/(coach)/+layout.*` | deleted | |

Files deleted from `src/lib/`:
`badges/`, `quests/`, `cosmetics.ts`, `sounds.ts`,  
`components/SirKnight.svelte`, `components/XpBar.svelte`, `components/StreakBadge.svelte`,  
`components/DailyGoalRing.svelte`, `components/LeaderboardPodium.svelte`

DB migration `0009_drop_gamification.sql` drops:
- Tables: `kid_stats`, `daily_quests`, `quest_completions`, `badges`, `earned_badges`, `cosmetics`, `owned_cosmetics`, `equipped_cosmetics`, `invites`, `coach_assignments`, `coach_notes`
- Columns from `profiles`: `role`, `coach_id`, `xp`, `level`, `streak_days`, `last_active_date`, `avatar_cosmetic_id`

Acceptance criteria for Phase 3: all training routes respond at `/train/**`, no kid/coach references remain in routes or lib, `npm test` passes, `npm run check` passes.

Each phase is independently deployable. Phase 1 can go live before phases 2 and 3.

---

## 14. Out of Scope (v1)

- FIDE federations beyond Lithuania and Latvia
- Online game tracking (chess.com / lichess integration kept for training only, not for rating)
- Arbiters / organizer tools
- Mobile native app
- Multiple languages (UI in English)
- Player vs player comparison tool
