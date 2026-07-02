# FIDE Lithuania Rank Importer — Design Spec

**Date:** 2026-07-02
**Status:** Approved for planning
**Scope:** Lithuania (FED = LTU) only.

## Problem

The dashboard shows "Country rank" and "Age group rank" tiles (`StatsRow.svelte`), both
hardcoded to `––`. FIDE does not expose a per-country ranking API — the ranking pages are
JS-rendered and return an empty shell to a plain fetch. FIDE *does* publish the full monthly
rating list as a downloadable archive. We download it, filter to Lithuania, compute ranks
ourselves, and surface each player's country and age-group rank on the dashboard.

## Goals

- Populate the "Country rank" and "Age group rank" tiles for signed-in users who have a FIDE ID.
- Refresh monthly from FIDE's official rating-list export.
- Store the full Lithuanian rated population so ranks can be recomputed and reused (e.g. future leaderboards).

## Non-goals

- Any federation other than Lithuania.
- Live/on-demand FIDE scraping for ranks (only single-profile name scraping already exists in `fide.ts`).
- Rapid/blitz-based ranking. We store all three ratings but rank on **standard** only.
- Historical rank tracking over time (only the latest list is retained per player).

## Data source

FIDE combined monthly list: `https://ratings.fide.com/download/players_list.zip` (~41 MB zipped).
One fixed-width TXT file containing every rated player with all three ratings and birth year.
Updated monthly (1st of month), so the job runs monthly.

Downloading the global list is unavoidable — FIDE offers no per-country file. We filter to
`FED === LTU` during parsing and discard the rest.

## Architecture

Mirrors the existing tournaments scrape pipeline (`scrape-job.ts` + `/api/tournaments/scrape`
+ `scrape_logs` + `CRON_SECRET`).

```
cron (monthly) ─▶ POST /api/fide/import  (Bearer CRON_SECRET)
                        │
                        ▼
                 runFideImport(url, serviceKey)
                        │  log start → fide_import_logs
                        ├─ download players_list.zip
                        ├─ unzip (fflate) → TXT string
                        ├─ parseFidePlayers(txt)        [pure]
                        ├─ filter FED === LTU
                        ├─ computeRanks(players, year)  [pure]
                        ├─ upsert fide_players (service-role client)
                        └─ log result → fide_import_logs
```

### Modules

| Module | Purpose | Depends on | Tested |
|---|---|---|---|
| `src/lib/fide/parse.ts` | `parseFidePlayers(txt: string): FidePlayer[]` — header-driven fixed-width parse | none (pure) | unit, fixture |
| `src/lib/fide/rank.ts` | `ageBracket(birthYear, currentYear)`, `computeRanks(players, currentYear)` | none (pure) | unit |
| `src/lib/fide/download.ts` | `downloadPlayersList(url): Promise<string>` — fetch zip, inflate | `fflate` | thin, not unit-tested |
| `src/lib/fide/import-job.ts` | `runFideImport(supabaseUrl, serviceKey)` — orchestrates | above + supabase-js | integration only |
| `src/routes/api/fide/import/+server.ts` | POST endpoint, `CRON_SECRET` Bearer + timing-safe compare | import-job | — |
| `scripts/import-fide.ts` | manual/cron runner reading env | import-job | — |

## Parsing detail

FIDE TXT is fixed-width with a header row. Column values (notably Name) contain spaces, so we
cannot split on whitespace. Instead:

1. Read the header line.
2. Locate the start offset of each needed column by its header label
   (`ID Number`, `Name`, `Fed`, `SRtng`, `RRtng`, `BRtng`, `B-day`).
3. For each data line, slice `[offset[col], offset[nextCol])` and trim.

This tolerates names with spaces and minor column-width drift between monthly releases.

Extracted `FidePlayer`:

```ts
interface FidePlayer {
  fideId: string;
  name: string;
  federation: string;      // e.g. "LTU"
  sex: string | null;
  birthYear: number | null;
  stdRating: number | null;
  rapidRating: number | null;
  blitzRating: number | null;
}
```

Ratings absent/blank → `null`. Birth year `0`/blank → `null`.

## Ranking detail

`ageBracket(birthYear, currentYear)` — `age = currentYear - birthYear`:

| Condition (checked in order) | Bracket |
|---|---|
| birthYear null | `null` |
| age ≤ 8 | `U8` |
| age ≤ 10 | `U10` |
| age ≤ 12 | `U12` |
| age ≤ 14 | `U14` |
| age ≤ 16 | `U16` |
| age ≤ 18 | `U18` |
| age ≤ 20 | `U20` |
| age ≥ 65 | `65+` |
| age ≥ 50 | `50+` |
| otherwise | `open` |

`computeRanks(players, currentYear)`:

- **Country rank:** take players with a non-null `stdRating`, sort by `stdRating` desc, assign
  1-based rank by position. Players without a standard rating get `countryRank = null`.
- **Age-group rank:** group the same standard-rated players by `ageBracket`; within each bracket,
  sort by `stdRating` desc and assign 1-based rank. Unrated or bracket-null → `ageGroupRank = null`.
- Ties: stable order (equal ratings keep input order → sequential distinct ranks). Simplicity over
  competition-style tie handling; acceptable for a dashboard stat.

## Storage — migration `0013_fide_players.sql`

```sql
create table public.fide_players (
  fide_id        text primary key,
  name           text,
  federation     text not null,
  sex            text,
  birth_year     integer,
  std_rating     integer,
  rapid_rating   integer,
  blitz_rating   integer,
  country_rank   integer,
  age_bracket    text,
  age_group_rank integer,
  list_date      date,
  updated_at     timestamptz not null default now()
);

alter table public.fide_players enable row level security;
create policy "fide_players public read" on public.fide_players for select using (true);
-- No insert/update/delete policies: only the service-role key (which bypasses RLS) writes.

create table public.fide_import_logs (
  id               uuid primary key default gen_random_uuid(),
  started_at       timestamptz not null default now(),
  finished_at      timestamptz,
  status           text not null default 'running',   -- running | success | partial | error
  message          text,
  players_imported integer,
  list_date        date
);
alter table public.fide_import_logs enable row level security;
-- No policies: service-role only.
```

Upsert on `fide_id`. Rows for players who leave the LTU list are not pruned in v1 (stale but
harmless; a future cleanup can delete rows whose `updated_at` predates the latest `list_date`).

## Trigger

- **Endpoint:** `POST /api/fide/import` — copies `/api/tournaments/scrape`: reads
  `CRON_SECRET` + `SUPABASE_SERVICE_ROLE_KEY` from private env and `PUBLIC_SUPABASE_URL`,
  requires `Authorization: Bearer <CRON_SECRET>`, timing-safe compares, calls `runFideImport`,
  returns JSON result.
- **Manual/cron runner:** `scripts/import-fide.ts` reads env and calls `runFideImport` directly.
  npm script `fide:import`. Intended to be invoked monthly by an external scheduler
  (e.g. GitHub Action cron) hitting the endpoint, or run manually.
- **Sample pg_cron migration** `0014_fide_cron.sql`, marked **DO NOT AUTO-APPLY** (mirrors
  `0009_cron_schedule.sql`), monthly (`0 3 1 * *`).

## UI wiring

`src/routes/(kid)/+page.server.ts` load:

- If `profile.fide_id` present, `select country_rank, age_group_rank, age_bracket from fide_players
  where fide_id = profile.fide_id`.
- Pass `countryRank`, `ageGroupRank`, `ageBracket` into the page data.

`src/lib/components/StatsRow.svelte`:

- New props `countryRank?`, `ageGroupRank?`, `ageBracket?` (in addition to `streakDays`).
- Render the rank number when present; `––` when null/absent (no FIDE ID, not in LTU list, or unrated).
- Age-group tile label reflects the bracket when known (e.g. "U12 rank"); otherwise "Age group rank".

## Dependencies

- Add `fflate` (small, pure-JS zip inflate; no native deps) for unzipping the download.

## Testing

- `parse.test.ts` — small fixture TXT (header + a handful of rows incl. LTU and non-LTU, a
  name with spaces, a rated and an unrated player); asserts field extraction and typing.
- `rank.test.ts` — `ageBracket` boundaries (8/9/10/…/18/20/49/50/64/65, null birth year);
  `computeRanks` for ordering, unrated → null, per-bracket independence, tie ordering.
- Download, job orchestration, endpoint auth: covered by manual/integration run, not unit tests.

## Error handling

- Download failure / non-200 / timeout → job throws, logs `status = error` with message, endpoint returns 500.
- Malformed line (missing fide_id or unparseable) → skip the row, continue; count skipped in log message.
- Partial upsert errors → collect, log `status = partial`, still return what succeeded.
```
