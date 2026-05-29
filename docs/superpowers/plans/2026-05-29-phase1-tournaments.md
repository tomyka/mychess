# Phase 1: Tournament Migration Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate all tournament functionality from the chess-tournaments repo (Next.js/Prisma/Neon) into mychess (SvelteKit/Supabase), retire the standalone repo.

**Architecture:** A cheerio-based scraper fetches Lithuanian and Latvian OTB tournament data from chess-results.com; results are stored in Supabase Postgres. A SvelteKit API route (`POST /api/tournaments/scrape`) drives the scrape job, called by a Supabase Edge Function cron every 6 hours. The tournament UI is server-rendered SvelteKit pages with Svelte components for filtering and calendar view.

**Tech Stack:** SvelteKit 2, TypeScript, Tailwind CSS 4, Supabase (Postgres + service role client), cheerio, vitest

**Spec:** `docs/superpowers/specs/2026-05-29-mychess-redesign-design.md` §5

---

## Chunk 1: Database + Scraper Library

### Task 1: Add cheerio dependency

**Files:**
- Modify: `mychess/package.json`

- [ ] **Step 1: Install cheerio**

```bash
cd mychess && npm install cheerio
```

Expected: `cheerio` appears in `package.json` dependencies.

- [ ] **Step 2: Commit**

```bash
git add mychess/package.json mychess/package-lock.json
git commit -m "deps: add cheerio for tournament scraping"
```

---

### Task 2: Supabase migration — tournaments tables

**Files:**
- Create: `mychess/supabase/migrations/0008_tournaments.sql`

- [ ] **Step 1: Write the migration**

Create `mychess/supabase/migrations/0008_tournaments.sql`:

```sql
-- Tournaments
create table if not exists tournaments (
  id               text primary key default gen_random_uuid()::text,
  chess_results_id text unique not null,
  name             text not null,
  country          text not null default 'Lithuania',
  city             text,
  start_date       timestamptz,
  end_date         timestamptz,
  time_control     text not null default 'UNKNOWN',
  status           text not null default 'NOT_STARTED',
  player_count     int,
  average_rating   int,
  round_count      int,
  chief_arbiter    text,
  organizer        text,
  url              text not null,
  last_scraped_at  timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists idx_tournaments_start_date on tournaments (start_date);
create index if not exists idx_tournaments_status     on tournaments (status);
create index if not exists idx_tournaments_time_ctrl  on tournaments (time_control);
create index if not exists idx_tournaments_country    on tournaments (country);

-- Tournament players
create table if not exists tournament_players (
  id            text primary key default gen_random_uuid()::text,
  tournament_id text not null references tournaments(id) on delete cascade,
  name          text not null,
  fide_id       text,
  rating        int,
  federation    text,
  title         text,
  rank          int,
  points        numeric(4,1),
  -- fide_id-based dedup: PostgreSQL UNIQUE allows multiple NULLs by default,
  -- so two players with fide_id = NULL do NOT conflict.
  unique (tournament_id, fide_id),
  -- name+rank fallback for players without fide_id
  unique (tournament_id, name, rank)
);

create index if not exists idx_tp_tournament_id on tournament_players (tournament_id);
create index if not exists idx_tp_fide_id       on tournament_players (fide_id);

-- Scrape log
create table if not exists scrape_logs (
  id                   text primary key default gen_random_uuid()::text,
  started_at           timestamptz not null default now(),
  finished_at          timestamptz,
  status               text not null default 'running',
  message              text,
  tournaments_found    int not null default 0,
  tournaments_updated  int not null default 0
);

-- RLS: tournaments and tournament_players are public read
alter table tournaments       enable row level security;
alter table tournament_players enable row level security;
alter table scrape_logs        enable row level security;

create policy "public read tournaments"
  on tournaments for select using (true);

create policy "public read tournament_players"
  on tournament_players for select using (true);

-- scrape_logs: no public access (service role writes only)
-- No SELECT policy = no anon/user access

-- updated_at trigger
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger tournaments_updated_at
  before update on tournaments
  for each row execute function set_updated_at();
```

- [ ] **Step 2: Push migration to local Supabase (if running) or note it for deployment**

```bash
cd mychess && npx supabase db push
```

Expected: migration applies without errors. If local Supabase isn't running, skip — migration will be applied on deploy.

- [ ] **Step 3: Commit**

```bash
git add mychess/supabase/migrations/0008_tournaments.sql
git commit -m "db: add tournaments, tournament_players, scrape_logs tables"
```

---

### Task 3: Scraper utilities module

**Files:**
- Create: `mychess/src/lib/tournaments/scraper-utils.ts`
- Create: `mychess/src/lib/tournaments/scraper-utils.test.ts`

- [ ] **Step 1: Write failing tests** (ported from chess-tournaments with Estonia removed)

Create `mychess/src/lib/tournaments/scraper-utils.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  parseTimeControl,
  parseStatusFromClass,
  deriveStatus,
  parseTournamentDetailField,
  SUPPORTED_FEDERATIONS,
} from './scraper-utils';

describe('parseTimeControl', () => {
  it('parses Standard time control', () => {
    expect(parseTimeControl('St')).toBe('STANDARD');
  });
  it('parses Rapid time control', () => {
    expect(parseTimeControl('Rp')).toBe('RAPID');
  });
  it('parses Blitz time control', () => {
    expect(parseTimeControl('Bz')).toBe('BLITZ');
  });
  it('returns UNKNOWN for unrecognized codes', () => {
    expect(parseTimeControl('XX')).toBe('UNKNOWN');
    expect(parseTimeControl('')).toBe('UNKNOWN');
  });
});

describe('parseStatusFromClass', () => {
  it('returns FINISHED for p_18', () => {
    expect(parseStatusFromClass('p_18')).toBe('FINISHED');
  });
  it('returns IN_PROGRESS for p_17', () => {
    expect(parseStatusFromClass('p_17')).toBe('IN_PROGRESS');
  });
  it('returns NOT_STARTED for p_5', () => {
    expect(parseStatusFromClass('p_5')).toBe('NOT_STARTED');
  });
  it('returns NOT_STARTED for unknown class', () => {
    expect(parseStatusFromClass('')).toBe('NOT_STARTED');
  });
});

describe('deriveStatus', () => {
  const daysAgo = (n: number) => {
    const d = new Date();
    d.setDate(d.getDate() - n);
    d.setHours(0, 0, 0, 0);
    return d;
  };
  const daysFromNow = (n: number) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    d.setHours(0, 0, 0, 0);
    return d;
  };

  it('keeps FINISHED regardless of date', () => {
    expect(deriveStatus('FINISHED', daysAgo(1))).toBe('FINISHED');
    expect(deriveStatus('FINISHED', null)).toBe('FINISHED');
  });
  it('overrides NOT_STARTED to FINISHED when start date has passed', () => {
    expect(deriveStatus('NOT_STARTED', daysAgo(1))).toBe('FINISHED');
  });
  it('keeps NOT_STARTED when start date is today or future', () => {
    expect(deriveStatus('NOT_STARTED', daysFromNow(0))).toBe('NOT_STARTED');
    expect(deriveStatus('NOT_STARTED', daysFromNow(3))).toBe('NOT_STARTED');
  });
  it('keeps IN_PROGRESS when endDate is in the future', () => {
    expect(deriveStatus('IN_PROGRESS', daysAgo(2), daysFromNow(3))).toBe('IN_PROGRESS');
  });
  it('overrides to FINISHED when endDate has passed', () => {
    expect(deriveStatus('NOT_STARTED', daysAgo(5), daysAgo(1))).toBe('FINISHED');
  });
  it('keeps scraped status when startDate is null', () => {
    expect(deriveStatus('NOT_STARTED', null)).toBe('NOT_STARTED');
  });
});

describe('parseTournamentDetailField', () => {
  it('parses single date', () => {
    const r = parseTournamentDetailField('date', '2026/06/07');
    expect(r.startDate).toEqual(new Date('2026-06-07'));
    expect(r.endDate).toBeUndefined();
  });
  it('parses date range', () => {
    const r = parseTournamentDetailField('date', '2026/06/07 - 2026/06/10');
    expect(r.startDate).toEqual(new Date('2026-06-07'));
    expect(r.endDate).toEqual(new Date('2026-06-10'));
  });
  it('parses average rating', () => {
    const r = parseTournamentDetailField('rating-ø / average age', '1783 / 12.5');
    expect(r.averageRating).toBe(1783);
  });
  it('parses number of rounds', () => {
    const r = parseTournamentDetailField('number of rounds', '7');
    expect(r.roundCount).toBe(7);
  });
  it('parses chief arbiter', () => {
    const r = parseTournamentDetailField('chief arbiter', 'Jonas Jonaitis');
    expect(r.chiefArbiter).toBe('Jonas Jonaitis');
  });
  it('parses organizer trimming after comma', () => {
    const r = parseTournamentDetailField('organizer', 'Chess Club, Vilnius');
    expect(r.organizer).toBe('Chess Club');
  });
  it('ignores unrecognized labels', () => {
    const r = parseTournamentDetailField('tournament name', 'Vilnius Open');
    expect(Object.keys(r)).toHaveLength(0);
  });
});

describe('SUPPORTED_FEDERATIONS', () => {
  it('includes Lithuania and Latvia only', () => {
    expect(SUPPORTED_FEDERATIONS.map(f => f.code)).toEqual(['LTU', 'LAT']);
  });
  it('does not include Estonia (out of scope for mychess)', () => {
    expect(SUPPORTED_FEDERATIONS.map(f => f.code)).not.toContain('EST');
  });
});
```

- [ ] **Step 2: Run tests — expect failures**

```bash
cd mychess && npm test -- --reporter=verbose src/lib/tournaments/scraper-utils.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement scraper-utils**

Create `mychess/src/lib/tournaments/scraper-utils.ts`:

```typescript
export type TimeControl = 'STANDARD' | 'RAPID' | 'BLITZ' | 'UNKNOWN';
export type TournamentStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'FINISHED';

export const SUPPORTED_FEDERATIONS = [
  { code: 'LTU', name: 'Lithuania' },
  { code: 'LAT', name: 'Latvia' },
] as const;

export type FederationCode = (typeof SUPPORTED_FEDERATIONS)[number]['code'];

export interface ScrapedTournamentDetails {
  startDate?: Date;
  endDate?: Date;
  averageRating?: number;
  chiefArbiter?: string;
  organizer?: string;
  roundCount?: number;
  playerCount?: number;
}

export function parseTimeControl(code: string): TimeControl {
  switch (code.trim().toLowerCase()) {
    case 'st': return 'STANDARD';
    case 'rp': return 'RAPID';
    case 'bz': return 'BLITZ';
    default:   return 'UNKNOWN';
  }
}

export function parseStatusFromClass(divClass: string): TournamentStatus {
  if (divClass.includes('p_18')) return 'FINISHED';
  if (divClass.includes('p_17')) return 'IN_PROGRESS';
  return 'NOT_STARTED';
}

export function deriveStatus(
  scraped: TournamentStatus,
  startDate: Date | null | undefined,
  endDate?: Date | null
): TournamentStatus {
  if (scraped === 'FINISHED') return 'FINISHED';
  const effectiveEnd = endDate ?? startDate;
  if (!effectiveEnd) return scraped;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return effectiveEnd < today ? 'FINISHED' : scraped;
}

export function parseTournamentDetailField(
  label: string,
  value: string
): Partial<ScrapedTournamentDetails> {
  const result: Partial<ScrapedTournamentDetails> = {};

  if (label.includes('date') && value.match(/\d{4}\/\d{2}\/\d{2}/)) {
    const matches = value.match(/(\d{4})\/(\d{2})\/(\d{2})/g);
    if (matches) {
      const d = new Date(matches[0].replace(/\//g, '-'));
      if (!isNaN(d.getTime())) result.startDate = d;
      if (matches.length > 1) {
        const e = new Date(matches[1].replace(/\//g, '-'));
        if (!isNaN(e.getTime())) result.endDate = e;
      }
    }
  }

  if (label.includes('rating') && value.match(/\d+/)) {
    const m = value.match(/(\d+)/);
    if (m) result.averageRating = parseInt(m[1], 10);
  }

  if (label.includes('chief arbiter')) result.chiefArbiter = value;

  if (label.includes('organizer')) result.organizer = value.split(',')[0].trim();

  if (label.includes('number of rounds')) {
    const m = value.match(/(\d+)/);
    if (m) result.roundCount = parseInt(m[1], 10);
  }

  return result;
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
cd mychess && npm test -- --reporter=verbose src/lib/tournaments/scraper-utils.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add mychess/src/lib/tournaments/scraper-utils.ts mychess/src/lib/tournaments/scraper-utils.test.ts
git commit -m "feat(tournaments): add scraper-utils module with tests"
```

---

### Task 4: Tournament types

**Files:**
- Create: `mychess/src/lib/tournaments/types.ts`

- [ ] **Step 1: Write types file**

Create `mychess/src/lib/tournaments/types.ts`:

```typescript
import type { TimeControl, TournamentStatus } from './scraper-utils';

export interface ScrapedTournament {
  chessResultsId: string;
  name: string;
  country: string;
  city?: string;
  startDate?: Date;
  endDate?: Date;
  timeControl: TimeControl;
  status: TournamentStatus;
  url: string;
  playerCount?: number;
  averageRating?: number;
  roundCount?: number;
  chiefArbiter?: string;
  organizer?: string;
}

export interface ScrapedPlayer {
  name: string;
  fideId?: string;
  rating?: number;
  federation?: string;
  title?: string;
  rank?: number;
  points?: number;
}

export interface DbTournament {
  id: string;
  chess_results_id: string;
  name: string;
  country: string;
  city: string | null;
  start_date: string | null;
  end_date: string | null;
  time_control: string;
  status: string;
  player_count: number | null;
  average_rating: number | null;
  round_count: number | null;
  chief_arbiter: string | null;
  organizer: string | null;
  url: string;
  last_scraped_at: string;
  created_at: string;
  updated_at: string;
}

export interface DbTournamentPlayer {
  id: string;
  tournament_id: string;
  name: string;
  fide_id: string | null;
  rating: number | null;
  federation: string | null;
  title: string | null;
  rank: number | null;
  points: number | null;
}

export interface TournamentFilters {
  status: TournamentStatus[];
  timeControl: TimeControl[];
  country: string[];
  dateStart?: string;
  dateEnd?: string;
  page: number;
  pageSize: number;
}
```

- [ ] **Step 2: Commit**

```bash
git add mychess/src/lib/tournaments/types.ts
git commit -m "feat(tournaments): add tournament types"
```

---

### Task 5: Scraper module

**Files:**
- Create: `mychess/src/lib/tournaments/scraper.ts`

- [ ] **Step 1: Write the scraper**

Create `mychess/src/lib/tournaments/scraper.ts`:

```typescript
import * as cheerio from 'cheerio';
import {
  parseTimeControl,
  parseStatusFromClass,
  parseTournamentDetailField,
  SUPPORTED_FEDERATIONS,
} from './scraper-utils';
import type { ScrapedTournament, ScrapedPlayer, ScrapedTournamentDetails } from './types';

// Re-export for convenience
export type { ScrapedTournamentDetails };

const BASE_URL = 'https://chess-results.com';
const USER_AGENT = 'mychess/1.0 (https://github.com/tomyka/mychess)';

function parseDateFromName(name: string): { city?: string; startDate?: Date } {
  const cityPatterns = [
    /\(([A-Za-zÀ-žĀ-ž\s]+),/,
    /(?:^|\s)(Vilnius|Kaunas|Klaipėda|Šiauliai|Panevėžys|Druskininkai|Visaginas|Alytus|Riga|Daugavpils)/i,
  ];
  let city: string | undefined;
  for (const p of cityPatterns) {
    const m = name.match(p);
    if (m) { city = m[1].trim(); break; }
  }

  let startDate: Date | undefined;

  const isoMatch = name.match(/(\d{4}-\d{2}-\d{2})/);
  if (isoMatch) {
    const d = new Date(isoMatch[1]);
    if (!isNaN(d.getTime())) startDate = d;
  }

  if (!startDate) {
    const shortDateMatch = name.match(/,\s*(\d{2}-\d{2})\s*\)/);
    if (shortDateMatch) {
      const d = new Date(`${new Date().getFullYear()}-${shortDateMatch[1]}`);
      if (!isNaN(d.getTime())) startDate = d;
    }
  }

  if (!startDate) {
    const dayMatch = name.match(/\((\d{2})\s+(\d{2})-\d{2}\)/);
    if (dayMatch) {
      const d = new Date(`${new Date().getFullYear()}-${dayMatch[1]}-${dayMatch[2]}`);
      if (!isNaN(d.getTime())) startDate = d;
    }
  }

  return { city, startDate };
}

/** Scrape the federation list page for LTU and LAT. */
export async function scrapeTournamentList(): Promise<ScrapedTournament[]> {
  const all: ScrapedTournament[] = [];

  for (const fed of SUPPORTED_FEDERATIONS) {
    const fedUrl = `${BASE_URL}/fed.aspx?lan=1&fed=${fed.code}`;
    const res = await fetch(fedUrl, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) {
      console.error(`Failed to fetch ${fed.name} (${res.status})`);
      continue;
    }

    const html = await res.text();
    const $ = cheerio.load(html);

    $(`table.CRs2 tr.${fed.code}`).each((_, row) => {
      const cells = $(row).find('td');
      if (cells.length < 3) return;

      const link = $(cells[1]).find('a');
      if (!link.length) return;

      const name = link.text().trim();
      const href = link.attr('href');
      if (!name || !href) return;

      const idMatch = href.match(/tnr(\d+)/);
      if (!idMatch) return;

      const chessResultsId = `tnr${idMatch[1]}`;
      const url = href.startsWith('http') ? href : `${BASE_URL}${href}`;

      let tcText = $(cells[2]).find('small').first().text().trim();
      if (!tcText) tcText = $(cells[2]).text().trim().split(/\s+/)[0] ?? '';
      const timeControl = parseTimeControl(tcText);

      const statusDivClass = $(cells[2]).find('div').first().attr('class') ?? '';
      const status = parseStatusFromClass(statusDivClass);

      const { city, startDate } = parseDateFromName(name);

      all.push({ chessResultsId, name, country: fed.name, city, startDate, timeControl, status, url });
    });

    console.log(`Scraped ${fed.name}: ${all.filter(t => t.country === fed.name).length} tournaments`);
  }

  return all;
}

/** Scrape metadata (dates, rating, arbiter) from a tournament detail page. */
export async function scrapeTournamentDetails(url: string): Promise<Partial<ScrapedTournament>> {
  const detailUrl = url.includes('turdet=') ? url : `${url}${url.includes('?') ? '&' : '?'}turdet=YES`;
  const res = await fetch(detailUrl, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${detailUrl}`);

  const html = await res.text();
  const $ = cheerio.load(html);
  const details: Partial<ScrapedTournament> = {};

  $('tr').each((_, row) => {
    const cells = $(row).find('td');
    if (cells.length < 2) return;
    const label = $(cells[0]).text().trim().toLowerCase();
    const value = $(cells[1]).text().trim();
    Object.assign(details, parseTournamentDetailField(label, value));
  });

  // Player count from standings table
  const playerRows = $('tr.CRg1, tr.CRg2');
  if (playerRows.length > 0) {
    details.playerCount = playerRows.length;
  } else {
    let count = 0;
    $('table.CRs1 tr').each((_, row) => { if (!$(row).hasClass('CRng1b')) count++; });
    if (count > 0) details.playerCount = count;
  }

  return details;
}

/** Scrape player list from a tournament page. Returns empty array on failure. */
export async function scrapePlayers(url: string): Promise<ScrapedPlayer[]> {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) return [];

  const html = await res.text();
  const $ = cheerio.load(html);
  const players: ScrapedPlayer[] = [];

  // chess-results.com player tables use alternating tr.CRg1/CRg2 rows.
  // Column order varies: detect column positions from the header row first,
  // then extract data by index. This is more robust than cell-by-cell heuristics.
  const playerRows = $('tr.CRg1, tr.CRg2');
  if (playerRows.length === 0) return [];

  // Find the header row immediately preceding the first player row.
  // Header cells have class "CRg0b" or are th elements.
  const firstRow = playerRows.first();
  const headerRow = firstRow.prev('tr');
  const colMap: Record<string, number> = {};

  const headerCells = headerRow.find('td, th');
  headerCells.each((i, cell) => {
    const text = $(cell).text().trim().toLowerCase();
    if (/^no\.?$|^rank$|^rk$/.test(text))     colMap.rank = i;
    else if (/^name$/.test(text))               colMap.name = i;
    else if (/^tit(le)?$/.test(text))           colMap.title = i;
    else if (/^fed(eration)?$/.test(text))      colMap.federation = i;
    else if (/^fide.?id$|^fideid$/.test(text))  colMap.fideId = i;
    else if (/^rtg$|^rating$|^elo$/.test(text)) colMap.rating = i;
    else if (/^pts$|^points?$|^score$/.test(text)) colMap.points = i;
  });

  // Fallback column positions when no header detected (common layout for LTU/LAT pages):
  // Rank(0) | Name(1) | Title(2) | Fed(3) | FIDE ID(4) | Rating(5) | Points(6)
  const getCol = (key: string, fallback: number) =>
    colMap[key] !== undefined ? colMap[key] : fallback;

  playerRows.each((_, row) => {
    const cells = $(row).find('td');
    if (cells.length < 4) return;

    const getText = (i: number) => $(cells[i])?.text().trim() ?? '';

    const rankText  = getText(getCol('rank', 0));
    const name      = getText(getCol('name', 1));
    const title     = getText(getCol('title', 2)) || undefined;
    const federation = getText(getCol('federation', 3)) || undefined;
    const fideIdText = getText(getCol('fideId', 4));
    const ratingText = getText(getCol('rating', 5));
    const pointsText = getText(getCol('points', 6));

    if (!name || name.length < 2) return;

    const rank    = rankText && /^\d+$/.test(rankText) ? parseInt(rankText, 10) : undefined;
    const fideId  = /^\d{7,9}$/.test(fideIdText) ? fideIdText : undefined;
    const rating  = /^\d{3,4}$/.test(ratingText) ? parseInt(ratingText, 10) : undefined;
    const points  = /^\d+(\.\d)?$/.test(pointsText) ? parseFloat(pointsText) : undefined;

    players.push({ name, fideId, rating, federation, title, rank, points });
  });

  return players;
}
```

- [ ] **Step 2: Confirm the module compiles**

```bash
cd mychess && npm run check 2>&1 | head -30
```

Expected: No errors related to `src/lib/tournaments/scraper.ts`.

- [ ] **Step 3: Commit**

```bash
git add mychess/src/lib/tournaments/scraper.ts
git commit -m "feat(tournaments): add cheerio scraper (federation list, details, players)"
```

---

### Task 6: Scrape job (Supabase orchestrator)

**Files:**
- Create: `mychess/src/lib/tournaments/scrape-job.ts`

- [ ] **Step 1: Write the scrape job**

Create `mychess/src/lib/tournaments/scrape-job.ts`:

```typescript
import { createClient } from '@supabase/supabase-js';
import { scrapeTournamentList, scrapeTournamentDetails, scrapePlayers } from './scraper';
import { deriveStatus } from './scraper-utils';
import type { ScrapedTournament } from './types';

export interface ScrapeJobResult {
  found: number;
  updated: number;
  detailsUpdated: number;
  playersUpdated: number;
  errors: string[];
}

/**
 * Run a full scrape job.
 * @param supabaseUrl  - SUPABASE_URL env var
 * @param serviceKey   - SUPABASE_SERVICE_ROLE_KEY env var (write access)
 */
export async function runScrapeJob(
  supabaseUrl: string,
  serviceKey: string
): Promise<ScrapeJobResult> {
  const db = createClient(supabaseUrl, serviceKey);
  const errors: string[] = [];

  // --- Log job start ---
  const { data: log } = await db.from('scrape_logs').insert({ status: 'running' }).select('id').single();
  const logId = log?.id as string | undefined;

  const result: ScrapeJobResult = { found: 0, updated: 0, detailsUpdated: 0, playersUpdated: 0, errors };

  try {
    // 1. Scrape federation list pages (LTU + LAT)
    const tournaments = await scrapeTournamentList();
    result.found = tournaments.length;

    // 2. Upsert list-level data
    for (const t of tournaments) {
      const { error } = await db.from('tournaments').upsert(
        {
          chess_results_id: t.chessResultsId,
          name: t.name,
          country: t.country,
          city: t.city ?? null,
          start_date: t.startDate?.toISOString() ?? null,
          time_control: t.timeControl,
          status: t.status,
          url: t.url,
          player_count: t.playerCount ?? null,
          last_scraped_at: new Date().toISOString(),
        },
        { onConflict: 'chess_results_id' }
      );
      if (error) errors.push(`Upsert ${t.chessResultsId}: ${error.message}`);
      else result.updated++;
    }

    // 3. Fetch details for tournaments missing start_date + a batch of stale ones
    const { data: missingDetails } = await db
      .from('tournaments')
      .select('id, chess_results_id, url')
      .is('start_date', null)
      .limit(50);

    const { data: staleDetails } = await db
      .from('tournaments')
      .select('id, chess_results_id, url')
      .not('start_date', 'is', null)
      .order('last_scraped_at', { ascending: true })
      .limit(20);

    const toDetail = [...(missingDetails ?? []), ...(staleDetails ?? [])];

    const BATCH = 5;
    for (let i = 0; i < toDetail.length; i += BATCH) {
      await Promise.all(
        toDetail.slice(i, i + BATCH).map(async (row) => {
          try {
            const details = await scrapeTournamentDetails(row.url);
            if (!details.startDate && !details.averageRating) return;

            await db.from('tournaments').update({
              start_date: details.startDate?.toISOString() ?? null,
              end_date: details.endDate?.toISOString() ?? null,
              round_count: details.roundCount ?? null,
              organizer: details.organizer ?? null,
              chief_arbiter: details.chiefArbiter ?? null,
              average_rating: details.averageRating ?? null,
              player_count: details.playerCount ?? null,
              last_scraped_at: new Date().toISOString(),
            }).eq('id', row.id);

            result.detailsUpdated++;
          } catch (e) {
            errors.push(`Details ${row.chess_results_id}: ${String(e)}`);
          }
        })
      );
    }

    // 4. Status override: mark FINISHED based on dates
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    await db.from('tournaments').update({ status: 'FINISHED' }).neq('status', 'FINISHED').or(
      `end_date.lt.${today.toISOString()},and(end_date.is.null,start_date.lt.${today.toISOString()})`
    );

    // 5. Scrape player lists for tournaments without players yet
    // Two-step anti-join: fetch tournament_ids that already have players,
    // then exclude them (PostgREST does not support inline subqueries).
    const { data: withPlayersRows } = await db
      .from('tournament_players')
      .select('tournament_id');
    const withPlayers = new Set((withPlayersRows ?? []).map(r => r.tournament_id));

    const { data: allTournaments } = await db
      .from('tournaments')
      .select('id, url')
      .order('last_scraped_at', { ascending: true })
      .limit(50);

    const noPlayers = (allTournaments ?? [])
      .filter(t => !withPlayers.has(t.id))
      .slice(0, 10);

    for (const row of noPlayers ?? []) {
      try {
        const players = await scrapePlayers(row.url);
        if (players.length === 0) continue;

        // Two-pass upsert: players with fideId first, then those without
        const withFide = players.filter(p => p.fideId);
        const withoutFide = players.filter(p => !p.fideId);

        if (withFide.length > 0) {
          await db.from('tournament_players').upsert(
            withFide.map(p => ({
              tournament_id: row.id, name: p.name, fide_id: p.fideId,
              rating: p.rating ?? null, federation: p.federation ?? null,
              title: p.title ?? null, rank: p.rank ?? null, points: p.points ?? null,
            })),
            { onConflict: 'tournament_id,fide_id', ignoreDuplicates: false }
          );
        }

        if (withoutFide.length > 0) {
          await db.from('tournament_players').upsert(
            withoutFide.map(p => ({
              tournament_id: row.id, name: p.name, fide_id: null,
              rating: p.rating ?? null, federation: p.federation ?? null,
              title: p.title ?? null, rank: p.rank ?? null, points: p.points ?? null,
            })),
            { onConflict: 'tournament_id,name,rank', ignoreDuplicates: false }
          );
        }

        result.playersUpdated++;
      } catch (e) {
        errors.push(`Players ${row.id}: ${String(e)}`);
      }
    }

    // --- Log job success ---
    if (logId) {
      await db.from('scrape_logs').update({
        finished_at: new Date().toISOString(),
        status: errors.length === 0 ? 'success' : 'partial',
        message: errors.length > 0 ? errors.slice(0, 5).join('; ') : null,
        tournaments_found: result.found,
        tournaments_updated: result.updated,
      }).eq('id', logId);
    }
  } catch (e) {
    const msg = String(e);
    errors.push(msg);
    if (logId) {
      await db.from('scrape_logs').update({
        finished_at: new Date().toISOString(),
        status: 'error',
        message: msg,
      }).eq('id', logId);
    }
    throw e;
  }

  return result;
}
```

- [ ] **Step 2: Verify TypeScript compilation**

```bash
cd mychess && npm run check 2>&1 | head -30
```

Expected: No errors in `scrape-job.ts`.

- [ ] **Step 3: Commit**

```bash
git add mychess/src/lib/tournaments/scrape-job.ts
git commit -m "feat(tournaments): add Supabase scrape-job orchestrator"
```

---

### Task 7: Tournament query helpers

**Files:**
- Create: `mychess/src/lib/tournaments/query.ts`
- Create: `mychess/src/lib/tournaments/query.test.ts`

- [ ] **Step 1: Write failing tests**

Create `mychess/src/lib/tournaments/query.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { buildTournamentFilters, DEFAULT_PAGE_SIZE } from './query';

describe('buildTournamentFilters', () => {
  it('defaults: all statuses, all time controls, both countries, page 1', () => {
    const f = buildTournamentFilters({});
    expect(f.status).toEqual(['NOT_STARTED', 'IN_PROGRESS', 'FINISHED']);
    expect(f.timeControl).toEqual(['STANDARD', 'RAPID', 'BLITZ', 'UNKNOWN']);
    expect(f.country).toEqual(['Lithuania', 'Latvia']);
    expect(f.page).toBe(1);
    expect(f.pageSize).toBe(DEFAULT_PAGE_SIZE);
  });

  it('parses status filter', () => {
    const f = buildTournamentFilters({ status: 'NOT_STARTED,IN_PROGRESS' });
    expect(f.status).toEqual(['NOT_STARTED', 'IN_PROGRESS']);
  });

  it('parses country filter', () => {
    const f = buildTournamentFilters({ country: 'Lithuania' });
    expect(f.country).toEqual(['Lithuania']);
  });

  it('parses page number', () => {
    const f = buildTournamentFilters({ page: '3' });
    expect(f.page).toBe(3);
  });

  it('clamps invalid page to 1', () => {
    const f = buildTournamentFilters({ page: '-1' });
    expect(f.page).toBe(1);
    const f2 = buildTournamentFilters({ page: 'abc' });
    expect(f2.page).toBe(1);
  });

  it('accepts date range', () => {
    const f = buildTournamentFilters({ dateStart: '2026-06-01', dateEnd: '2026-08-31' });
    expect(f.dateStart).toBe('2026-06-01');
    expect(f.dateEnd).toBe('2026-08-31');
  });
});
```

- [ ] **Step 2: Run tests — expect failures**

```bash
cd mychess && npm test -- --reporter=verbose src/lib/tournaments/query.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement query helpers**

Create `mychess/src/lib/tournaments/query.ts`:

```typescript
import type { TournamentFilters } from './types';
import type { TimeControl, TournamentStatus } from './scraper-utils';

export const DEFAULT_PAGE_SIZE = 20;

const ALL_STATUSES: TournamentStatus[] = ['NOT_STARTED', 'IN_PROGRESS', 'FINISHED'];
const ALL_TIME_CONTROLS: TimeControl[] = ['STANDARD', 'RAPID', 'BLITZ', 'UNKNOWN'];
const ALL_COUNTRIES = ['Lithuania', 'Latvia'];

export function buildTournamentFilters(
  params: Partial<Record<string, string>>
): TournamentFilters {
  const status = params.status
    ? (params.status.split(',') as TournamentStatus[])
    : ALL_STATUSES;

  const timeControl = params.timeControl
    ? (params.timeControl.split(',') as TimeControl[])
    : ALL_TIME_CONTROLS;

  const country = params.country
    ? params.country.split(',')
    : ALL_COUNTRIES;

  const rawPage = parseInt(params.page ?? '1', 10);
  const page = isNaN(rawPage) || rawPage < 1 ? 1 : rawPage;

  return {
    status,
    timeControl,
    country,
    dateStart: params.dateStart,
    dateEnd: params.dateEnd,
    page,
    pageSize: DEFAULT_PAGE_SIZE,
  };
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
cd mychess && npm test -- --reporter=verbose src/lib/tournaments/query.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Run full test suite to confirm no regressions**

```bash
cd mychess && npm test
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add mychess/src/lib/tournaments/query.ts mychess/src/lib/tournaments/query.test.ts
git commit -m "feat(tournaments): add query filter builder with tests"
```

---

## Chunk 2: API Route + Tournament UI

### Task 8: Scrape API endpoint

**Files:**
- Create: `mychess/src/routes/api/tournaments/scrape/+server.ts`

- [ ] **Step 1: Write the endpoint**

Create `mychess/src/routes/api/tournaments/scrape/+server.ts`:

```typescript
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { runScrapeJob } from '$lib/tournaments/scrape-job';
import { CRON_SECRET, SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private';
import { PUBLIC_SUPABASE_URL } from '$env/static/public';

export const POST: RequestHandler = async ({ request }) => {
  const auth = request.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';

  if (!CRON_SECRET || token !== CRON_SECRET) {
    throw error(401, 'Unauthorized');
  }

  try {
    const result = await runScrapeJob(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    return json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw error(500, `Scrape failed: ${msg}`);
  }
};
```

- [ ] **Step 2: Add `PRIVATE_CRON_SECRET` to `.env.example`**

Open `mychess/.env.example` and add:

```
CRON_SECRET=your-random-secret-here
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

- [ ] **Step 3: Verify TypeScript compilation**

```bash
cd mychess && npm run check 2>&1 | head -30
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add mychess/src/routes/api/tournaments/scrape/+server.ts mychess/.env.example
git commit -m "feat(tournaments): add POST /api/tournaments/scrape endpoint"
```

---

### Task 9: Tournament list page — server

**Files:**
- Create: `mychess/src/routes/tournaments/+page.server.ts`

- [ ] **Step 1: Write the server load function**

Create `mychess/src/routes/tournaments/+page.server.ts`:

```typescript
import type { PageServerLoad } from './$types';
import { buildTournamentFilters } from '$lib/tournaments/query';

export const load: PageServerLoad = async ({ url, locals }) => {
  const params = Object.fromEntries(url.searchParams.entries());
  const filters = buildTournamentFilters(params);
  const isCalendar = params.view === 'calendar';

  const { supabase } = locals;

  let query = supabase
    .from('tournaments')
    .select('*', { count: 'exact' })
    .in('status', filters.status)
    .in('time_control', filters.timeControl)
    .in('country', filters.country)
    .order('start_date', { ascending: true, nullsFirst: false });

  // Calendar view loads all matching (up to 500); list view uses pagination.
  if (isCalendar) {
    query = query.limit(500);
  } else {
    query = query.range((filters.page - 1) * filters.pageSize, filters.page * filters.pageSize - 1);
  }

  if (filters.dateStart) query = query.gte('start_date', filters.dateStart);
  if (filters.dateEnd) {
    // Include the full end day: use start of the next day as exclusive upper bound
    const nextDay = new Date(filters.dateEnd);
    nextDay.setDate(nextDay.getDate() + 1);
    query = query.lt('start_date', nextDay.toISOString().slice(0, 10));
  }

  const { data: tournaments, count, error } = await query;

  // Check for stale data banner
  const { data: latestScrape } = await supabase
    .from('tournaments')
    .select('last_scraped_at')
    .order('last_scraped_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const lastScrapedAt = latestScrape?.last_scraped_at ?? null;
  const isStale = lastScrapedAt
    ? Date.now() - new Date(lastScrapedAt).getTime() > 12 * 60 * 60 * 1000
    : false;

  return {
    tournaments: tournaments ?? [],
    total: count ?? 0,
    filters,
    isCalendar,
    lastScrapedAt,
    isStale,
    error: error?.message ?? null,
  };
};
```

- [ ] **Step 2: Verify TypeScript compilation**

```bash
cd mychess && npm run check 2>&1 | grep -i error | head -20
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add mychess/src/routes/tournaments/+page.server.ts
git commit -m "feat(tournaments): add tournament list page server load"
```

---

### Task 10: Tournament card component

**Files:**
- Create: `mychess/src/lib/components/tournaments/TournamentCard.svelte`

- [ ] **Step 1: Write the component**

Create `mychess/src/lib/components/tournaments/TournamentCard.svelte`:

```svelte
<script lang="ts">
  import type { DbTournament } from '$lib/tournaments/types';

  export let tournament: DbTournament;

  const statusLabel: Record<string, string> = {
    NOT_STARTED: 'Upcoming',
    IN_PROGRESS: 'Live',
    FINISHED: 'Finished',
  };

  const statusClass: Record<string, string> = {
    NOT_STARTED: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
    IN_PROGRESS: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
    FINISHED: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  };

  const tcLabel: Record<string, string> = {
    STANDARD: 'Classical',
    RAPID: 'Rapid',
    BLITZ: 'Blitz',
    UNKNOWN: '',
  };

  function formatDate(iso: string | null) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  $: dateRange = tournament.end_date && tournament.end_date !== tournament.start_date
    ? `${formatDate(tournament.start_date)} – ${formatDate(tournament.end_date)}`
    : formatDate(tournament.start_date);
</script>

<a
  href="/tournaments/{tournament.id}"
  class="block rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4 hover:shadow-md transition-shadow"
>
  <div class="flex items-start justify-between gap-2 mb-2">
    <h3 class="font-semibold text-gray-900 dark:text-gray-100 text-sm leading-snug">{tournament.name}</h3>
    <span class="shrink-0 text-xs font-medium px-2 py-0.5 rounded-full {statusClass[tournament.status]}">
      {statusLabel[tournament.status] ?? tournament.status}
    </span>
  </div>

  <div class="text-xs text-gray-500 dark:text-gray-400 space-y-0.5">
    <div>{dateRange}</div>
    {#if tournament.city}
      <div>{tournament.city}, {tournament.country}</div>
    {:else}
      <div>{tournament.country}</div>
    {/if}
    <div class="flex gap-3 mt-1.5">
      {#if tournament.time_control !== 'UNKNOWN'}
        <span class="font-medium text-gray-700 dark:text-gray-300">{tcLabel[tournament.time_control]}</span>
      {/if}
      {#if tournament.player_count}
        <span>{tournament.player_count} players</span>
      {/if}
      {#if tournament.average_rating}
        <span>Avg {tournament.average_rating}</span>
      {/if}
    </div>
  </div>

  <div class="mt-2 text-xs text-blue-600 dark:text-blue-400 truncate hover:underline">
    chess-results.com ↗
  </div>
</a>
```

- [ ] **Step 2: Commit**

```bash
git add mychess/src/lib/components/tournaments/TournamentCard.svelte
git commit -m "feat(tournaments): add TournamentCard component"
```

---

### Task 11: Tournament filters component

**Files:**
- Create: `mychess/src/lib/components/tournaments/TournamentFilters.svelte`

- [ ] **Step 1: Write the component**

Create `mychess/src/lib/components/tournaments/TournamentFilters.svelte`:

```svelte
<script lang="ts">
  import type { TournamentFilters } from '$lib/tournaments/types';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';

  export let filters: TournamentFilters;
  export let total: number;

  const statusOptions = [
    { value: 'NOT_STARTED', label: 'Upcoming' },
    { value: 'IN_PROGRESS', label: 'Live' },
    { value: 'FINISHED', label: 'Finished' },
  ];
  const tcOptions = [
    { value: 'STANDARD', label: 'Classical' },
    { value: 'RAPID', label: 'Rapid' },
    { value: 'BLITZ', label: 'Blitz' },
  ];
  const countryOptions = ['Lithuania', 'Latvia'];

  function applyFilters() {
    const sp = new URLSearchParams($page.url.searchParams);
    sp.set('status', filters.status.join(','));
    sp.set('timeControl', filters.timeControl.filter(tc => tc !== 'UNKNOWN').join(','));
    sp.set('country', filters.country.join(','));
    if (filters.dateStart) sp.set('dateStart', filters.dateStart);
    else sp.delete('dateStart');
    if (filters.dateEnd) sp.set('dateEnd', filters.dateEnd);
    else sp.delete('dateEnd');
    sp.set('page', '1');
    goto(`?${sp.toString()}`, { keepFocus: true });
  }

  function toggleStatus(val: string) {
    if (filters.status.includes(val as never)) {
      filters = { ...filters, status: filters.status.filter(s => s !== val) as never };
    } else {
      filters = { ...filters, status: [...filters.status, val as never] };
    }
    applyFilters();
  }

  function toggleTc(val: string) {
    if (filters.timeControl.includes(val as never)) {
      filters = { ...filters, timeControl: filters.timeControl.filter(t => t !== val) as never };
    } else {
      filters = { ...filters, timeControl: [...filters.timeControl, val as never] };
    }
    applyFilters();
  }

  function toggleCountry(val: string) {
    if (filters.country.includes(val)) {
      filters = { ...filters, country: filters.country.filter(c => c !== val) };
    } else {
      filters = { ...filters, country: [...filters.country, val] };
    }
    applyFilters();
  }

  function clearAll() {
    goto('/tournaments', { keepFocus: true });
  }

  $: activeCount =
    (filters.status.length < 3 ? 1 : 0) +
    (filters.timeControl.filter(t => t !== 'UNKNOWN').length < 3 ? 1 : 0) +
    (filters.country.length < 2 ? 1 : 0) +
    (filters.dateStart || filters.dateEnd ? 1 : 0);
</script>

<div class="space-y-4">
  <div class="flex items-center justify-between">
    <p class="text-sm text-gray-500 dark:text-gray-400">{total} tournament{total !== 1 ? 's' : ''}</p>
    {#if activeCount > 0}
      <button on:click={clearAll} class="text-xs text-blue-600 dark:text-blue-400 hover:underline">
        Clear filters
      </button>
    {/if}
  </div>

  <!-- Status -->
  <div>
    <p class="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1.5">Status</p>
    <div class="flex flex-wrap gap-2">
      {#each statusOptions as opt}
        <button
          on:click={() => toggleStatus(opt.value)}
          class="px-3 py-1 rounded-full text-xs border transition-colors
            {filters.status.includes(opt.value as never)
              ? 'bg-blue-600 text-white border-blue-600'
              : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-blue-400'}"
        >{opt.label}</button>
      {/each}
    </div>
  </div>

  <!-- Time control -->
  <div>
    <p class="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1.5">Time Control</p>
    <div class="flex flex-wrap gap-2">
      {#each tcOptions as opt}
        <button
          on:click={() => toggleTc(opt.value)}
          class="px-3 py-1 rounded-full text-xs border transition-colors
            {filters.timeControl.includes(opt.value as never)
              ? 'bg-blue-600 text-white border-blue-600'
              : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-blue-400'}"
        >{opt.label}</button>
      {/each}
    </div>
  </div>

  <!-- Country -->
  <div>
    <p class="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1.5">Country</p>
    <div class="flex flex-wrap gap-2">
      {#each countryOptions as country}
        <button
          on:click={() => toggleCountry(country)}
          class="px-3 py-1 rounded-full text-xs border transition-colors
            {filters.country.includes(country)
              ? 'bg-blue-600 text-white border-blue-600'
              : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-blue-400'}"
        >{country}</button>
      {/each}
    </div>
  </div>

  <!-- Date range -->
  <div>
    <p class="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1.5">Date Range</p>
    <div class="flex gap-2 items-center">
      <input
        type="date"
        bind:value={filters.dateStart}
        on:change={applyFilters}
        class="text-xs border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200"
      />
      <span class="text-gray-400 text-xs">to</span>
      <input
        type="date"
        bind:value={filters.dateEnd}
        on:change={applyFilters}
        class="text-xs border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200"
      />
    </div>
  </div>
</div>
```

- [ ] **Step 2: Commit**

```bash
git add mychess/src/lib/components/tournaments/TournamentFilters.svelte
git commit -m "feat(tournaments): add TournamentFilters component"
```

---

### Task 12: Tournament list page — UI

**Files:**
- Create: `mychess/src/routes/tournaments/+page.svelte`

- [ ] **Step 1: Write the page**

Create `mychess/src/routes/tournaments/+page.svelte`:

```svelte
<script lang="ts">
  import type { PageData } from './$types';
  import TournamentCard from '$lib/components/tournaments/TournamentCard.svelte';
  import TournamentFilters from '$lib/components/tournaments/TournamentFilters.svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';

  export let data: PageData;

  $: ({ tournaments, total, filters, isCalendar, lastScrapedAt, isStale, error } = data);

  function setView(mode: 'list' | 'calendar') {
    const sp = new URLSearchParams($page.url.searchParams);
    if (mode === 'calendar') sp.set('view', 'calendar');
    else sp.delete('view');
    sp.set('page', '1');
    goto(`?${sp.toString()}`, { keepFocus: true });
  }

  function buildPageUrl(targetPage: number): string {
    const sp = new URLSearchParams();
    if (filters.status.length < 3)           sp.set('status', filters.status.join(','));
    if (filters.timeControl.some(tc => tc !== 'UNKNOWN' && filters.timeControl.length < 4))
      sp.set('timeControl', filters.timeControl.join(','));
    if (filters.country.length < 2)          sp.set('country', filters.country.join(','));
    if (filters.dateStart)                   sp.set('dateStart', filters.dateStart);
    if (filters.dateEnd)                     sp.set('dateEnd', filters.dateEnd);
    sp.set('page', String(targetPage));
    return `?${sp.toString()}`;
  }

  // Group tournaments by month — ES-compatible reduce, no Object.groupBy
  $: byMonth = tournaments
    .filter(t => t.start_date)
    .reduce<Record<string, typeof tournaments>>((acc, t) => {
      const key = t.start_date!.slice(0, 7);
      if (!acc[key]) acc[key] = [];
      acc[key].push(t);
      return acc;
    }, {});

  $: totalPages = Math.ceil(total / filters.pageSize);
</script>

<svelte:head>
  <title>OTB Tournaments — mychess</title>
</svelte:head>

<div class="max-w-6xl mx-auto px-4 py-6">
  <div class="flex items-center justify-between mb-6">
    <h1 class="text-2xl font-bold text-gray-900 dark:text-gray-100">Tournaments</h1>
    <div class="flex gap-1 text-sm">
      <button
        on:click={() => setView('list')}
        class="px-3 py-1.5 rounded {!isCalendar ? 'bg-blue-600 text-white' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'}"
      >List</button>
      <button
        on:click={() => setView('calendar')}
        class="px-3 py-1.5 rounded {isCalendar ? 'bg-blue-600 text-white' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'}"
      >Calendar</button>
    </div>
  </div>

  {#if isStale}
    <div class="mb-4 px-4 py-2 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 rounded-lg text-sm text-amber-700 dark:text-amber-300">
      ⚠️ Data may be outdated. Last updated: {lastScrapedAt ? new Date(lastScrapedAt).toLocaleString() : 'unknown'}
    </div>
  {/if}

  {#if error}
    <div class="mb-4 px-4 py-2 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 rounded-lg text-sm text-red-700 dark:text-red-300">
      Error loading tournaments: {error}
    </div>
  {/if}

  <div class="flex flex-col md:flex-row gap-6">
    <!-- Sidebar filters -->
    <aside class="md:w-56 shrink-0">
      <TournamentFilters {filters} {total} />
    </aside>

    <!-- Tournament list/calendar -->
    <main class="flex-1 min-w-0">
      {#if !isCalendar}
        {#if tournaments.length === 0}
          <div class="text-center py-16 text-gray-400 dark:text-gray-500">
            <p class="text-4xl mb-3">♟</p>
            <p class="font-medium">No tournaments found</p>
            <p class="text-sm mt-1">Try adjusting your filters</p>
          </div>
        {:else}
          <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {#each tournaments as tournament (tournament.id)}
              <TournamentCard {tournament} />
            {/each}
          </div>

          <!-- Pagination -->
          {#if totalPages > 1}
            <div class="flex justify-center gap-2 mt-8">
              {#if filters.page > 1}
                <a href={buildPageUrl(filters.page - 1)}
                   class="px-4 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-800"
                >← Previous</a>
              {/if}
              <span class="px-4 py-2 text-sm text-gray-500 dark:text-gray-400">
                Page {filters.page} of {totalPages}
              </span>
              {#if filters.page < totalPages}
                <a href={buildPageUrl(filters.page + 1)}
                   class="px-4 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-800"
                >Next →</a>
              {/if}
            </div>
          {/if}
        {/if}
      {:else}
        <!-- Calendar view — grouped by month, server fetches up to 500 (no pagination) -->
        <div class="space-y-6">
          {#each Object.entries(byMonth) as [month, monthTourneys]}
            <div>
              <h2 class="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
                {new Date(month + '-02').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}
              </h2>
              <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {#each monthTourneys as tournament (tournament.id)}
                  <TournamentCard {tournament} />
                {/each}
              </div>
            </div>
          {/each}
          {#if Object.keys(byMonth).length === 0}
            <div class="text-center py-16 text-gray-400 dark:text-gray-500">
              <p>No tournaments with dates in this range</p>
            </div>
          {/if}
        </div>
      {/if}
    </main>
  </div>
</div>
```

- [ ] **Step 2: Verify TypeScript compilation**

```bash
cd mychess && npm run check 2>&1 | grep -i error | head -20
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add mychess/src/routes/tournaments/+page.svelte
git commit -m "feat(tournaments): add tournament list page with filters and calendar view"
```

---

### Task 13: Tournament detail page

**Files:**
- Create: `mychess/src/routes/tournaments/[id]/+page.server.ts`
- Create: `mychess/src/routes/tournaments/[id]/+page.svelte`

- [ ] **Step 1: Write the server load function**

Create `mychess/src/routes/tournaments/[id]/+page.server.ts`:

```typescript
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
  const { supabase } = locals;

  const { data: tournament, error: tErr } = await supabase
    .from('tournaments')
    .select('*')
    .eq('id', params.id)
    .single();

  if (tErr || !tournament) {
    throw error(404, 'Tournament not found');
  }

  const { data: players } = await supabase
    .from('tournament_players')
    .select('*')
    .eq('tournament_id', params.id)
    .order('rank', { ascending: true, nullsFirst: false });

  return { tournament, players: players ?? [] };
};
```

- [ ] **Step 2: Write the detail page**

Create `mychess/src/routes/tournaments/[id]/+page.svelte`:

```svelte
<script lang="ts">
  import type { PageData } from './$types';

  export let data: PageData;
  $: ({ tournament, players } = data);

  function formatDate(iso: string | null) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  $: dateRange = tournament.end_date && tournament.end_date !== tournament.start_date
    ? `${formatDate(tournament.start_date)} – ${formatDate(tournament.end_date)}`
    : formatDate(tournament.start_date);

  const tcLabel: Record<string, string> = {
    STANDARD: 'Classical', RAPID: 'Rapid', BLITZ: 'Blitz', UNKNOWN: '',
  };
  const statusLabel: Record<string, string> = {
    NOT_STARTED: 'Upcoming', IN_PROGRESS: 'Live', FINISHED: 'Finished',
  };
</script>

<svelte:head>
  <title>{tournament.name} — mychess</title>
</svelte:head>

<div class="max-w-4xl mx-auto px-4 py-6">
  <a href="/tournaments" class="text-sm text-blue-600 dark:text-blue-400 hover:underline mb-4 inline-block">
    ← All tournaments
  </a>

  <h1 class="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-1">{tournament.name}</h1>

  <div class="flex flex-wrap gap-2 mb-6">
    <span class="text-sm px-2.5 py-0.5 rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 font-medium">
      {statusLabel[tournament.status] ?? tournament.status}
    </span>
    {#if tournament.time_control !== 'UNKNOWN'}
      <span class="text-sm px-2.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300">
        {tcLabel[tournament.time_control]}
      </span>
    {/if}
  </div>

  <dl class="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-8 text-sm">
    <div>
      <dt class="text-gray-400 text-xs uppercase tracking-wide">Dates</dt>
      <dd class="text-gray-900 dark:text-gray-100 font-medium mt-0.5">{dateRange}</dd>
    </div>
    <div>
      <dt class="text-gray-400 text-xs uppercase tracking-wide">Location</dt>
      <dd class="text-gray-900 dark:text-gray-100 font-medium mt-0.5">
        {tournament.city ? `${tournament.city}, ` : ''}{tournament.country}
      </dd>
    </div>
    {#if tournament.player_count}
      <div>
        <dt class="text-gray-400 text-xs uppercase tracking-wide">Players</dt>
        <dd class="text-gray-900 dark:text-gray-100 font-medium mt-0.5">{tournament.player_count}</dd>
      </div>
    {/if}
    {#if tournament.average_rating}
      <div>
        <dt class="text-gray-400 text-xs uppercase tracking-wide">Avg Rating</dt>
        <dd class="text-gray-900 dark:text-gray-100 font-medium mt-0.5">{tournament.average_rating}</dd>
      </div>
    {/if}
    {#if tournament.round_count}
      <div>
        <dt class="text-gray-400 text-xs uppercase tracking-wide">Rounds</dt>
        <dd class="text-gray-900 dark:text-gray-100 font-medium mt-0.5">{tournament.round_count}</dd>
      </div>
    {/if}
    {#if tournament.chief_arbiter}
      <div>
        <dt class="text-gray-400 text-xs uppercase tracking-wide">Chief Arbiter</dt>
        <dd class="text-gray-900 dark:text-gray-100 font-medium mt-0.5">{tournament.chief_arbiter}</dd>
      </div>
    {/if}
    {#if tournament.organizer}
      <div>
        <dt class="text-gray-400 text-xs uppercase tracking-wide">Organizer</dt>
        <dd class="text-gray-900 dark:text-gray-100 font-medium mt-0.5">{tournament.organizer}</dd>
      </div>
    {/if}
  </dl>

  <div class="mb-4 flex items-center justify-between">
    <h2 class="text-lg font-semibold text-gray-900 dark:text-gray-100">Players</h2>
    <a href={tournament.url} target="_blank" rel="noopener noreferrer"
       class="text-xs text-blue-600 dark:text-blue-400 hover:underline">
      View on chess-results.com ↗
    </a>
  </div>

  {#if players.length === 0}
    <p class="text-sm text-gray-400 dark:text-gray-500 py-8 text-center">
      Player list not yet available
    </p>
  {:else}
    <div class="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
            <th class="px-3 py-2 text-left text-xs text-gray-500 dark:text-gray-400 font-medium w-10">#</th>
            <th class="px-3 py-2 text-left text-xs text-gray-500 dark:text-gray-400 font-medium">Name</th>
            <th class="px-3 py-2 text-left text-xs text-gray-500 dark:text-gray-400 font-medium">Title</th>
            <th class="px-3 py-2 text-left text-xs text-gray-500 dark:text-gray-400 font-medium">Fed</th>
            <th class="px-3 py-2 text-right text-xs text-gray-500 dark:text-gray-400 font-medium">Rating</th>
            <th class="px-3 py-2 text-right text-xs text-gray-500 dark:text-gray-400 font-medium">Pts</th>
          </tr>
        </thead>
        <tbody>
          {#each players as player, i}
            <tr class="border-b border-gray-100 dark:border-gray-800 {i % 2 === 0 ? '' : 'bg-gray-50/50 dark:bg-gray-800/30'}">
              <td class="px-3 py-2 text-gray-400 dark:text-gray-500">{player.rank ?? i + 1}</td>
              <td class="px-3 py-2 font-medium text-gray-900 dark:text-gray-100">
                {#if player.fide_id}
                  <a href="https://ratings.fide.com/profile/{player.fide_id}" target="_blank" rel="noopener noreferrer"
                     class="hover:underline text-blue-700 dark:text-blue-300">{player.name}</a>
                {:else}
                  {player.name}
                {/if}
              </td>
              <td class="px-3 py-2 text-gray-500 dark:text-gray-400">{player.title ?? ''}</td>
              <td class="px-3 py-2 text-gray-500 dark:text-gray-400">{player.federation ?? ''}</td>
              <td class="px-3 py-2 text-right text-gray-700 dark:text-gray-300">{player.rating ?? '—'}</td>
              <td class="px-3 py-2 text-right text-gray-700 dark:text-gray-300">{player.points ?? '—'}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>
```

- [ ] **Step 3: Verify TypeScript compilation**

```bash
cd mychess && npm run check 2>&1 | grep -i error | head -20
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add mychess/src/routes/tournaments/[id]/+page.server.ts mychess/src/routes/tournaments/[id]/+page.svelte
git commit -m "feat(tournaments): add tournament detail page with player list"
```

---

## Chunk 3: Landing Page + Cron + Cleanup

### Task 14: Update navigation shell

**Files:**
- Modify: `mychess/src/routes/(kid)/+page.svelte`

> **Note on navigation:** The root `+layout.svelte` (`src/routes/+layout.svelte`) contains no navigation — it only wraps content with `QueryClientProvider`. The `(kid)/+layout.svelte` shows only the guest banner. The Tournaments link should be placed in the main page content (e.g., top of the logged-in dashboard, or accessible via the home page landing section added in Task 15). No separate nav shell change is needed — the landing page (Task 15) will already include a "Browse tournaments" CTA for guests, and the logged-in dashboard can link from there. Skip this task if the (kid) page already has navigation links added during Task 15.

---

### Task 15: Update landing page with upcoming tournaments widget

**Files:**
- Modify: `mychess/src/routes/(kid)/+page.server.ts`
- Modify: `mychess/src/routes/(kid)/+page.svelte`

> **Important:** The root `/` route resolves to `(kid)/+page.svelte`. The server load in `(kid)/+page.server.ts` has an **early return** for unauthenticated users (`if (!user) return { session: null, profile: null }`). The `upcomingTournaments` query must be fetched **before** this early return so the landing page can display it.

- [ ] **Step 1: Add upcoming tournaments query to the server load**

Open `mychess/src/routes/(kid)/+page.server.ts`. The file currently starts with:

```typescript
const { user, session, profile } = await safeGetSession();
if (!user) return { session: null, profile: null };
```

Add the tournament query **before** the early return and include it in the early return shape:

```typescript
const { user, session, profile } = await safeGetSession();

// Fetch upcoming tournaments for all visitors (guest landing page + logged-in widget)
const today = new Date().toISOString();
const { data: upcomingTournaments } = await supabase
  .from('tournaments')
  .select('id, name, city, country, start_date, time_control, status')
  .in('status', ['NOT_STARTED', 'IN_PROGRESS'])
  .gte('start_date', today)
  .order('start_date', { ascending: true })
  .limit(3);

if (!user) return { session: null, profile: null, upcomingTournaments: upcomingTournaments ?? [] };
```

Also add `upcomingTournaments` to the existing `return { ... }` at the end of the function:

```typescript
return {
  session,
  profile,
  // ... all existing fields ...
  upcomingTournaments: upcomingTournaments ?? [],
};
```

- [ ] **Step 2: Add landing page HTML for unauthenticated visitors**

Open `mychess/src/routes/(kid)/+page.svelte`. Find the block that handles the case when `data.session` is null (or when there's no authenticated user) — currently this probably shows nothing or redirects. Replace/add a landing section for guests. The page currently uses `$props()` Svelte 5 syntax.

Add a guest landing section like this (adapting to the existing Svelte 5 runes syntax in the file):

```svelte
{#if !data.session}
  <!-- Guest landing page -->
  <div class="max-w-3xl mx-auto px-4 py-12 text-center">
    <h1 class="text-3xl font-bold text-gray-900 dark:text-gray-100 mb-3">
      Your chess, in one place
    </h1>
    <p class="text-gray-500 dark:text-gray-400 mb-8">
      FIDE rating, national standings, and local OTB tournaments — all on your daily dashboard.
    </p>
    <div class="flex justify-center gap-3 mb-12">
      <a href="/tournaments" class="px-5 py-2.5 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700">
        Browse tournaments
      </a>
      <a href="/login" class="px-5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 font-medium hover:bg-gray-50 dark:hover:bg-gray-800">
        Sign in
      </a>
    </div>

    {#if data.upcomingTournaments?.length > 0}
      <h2 class="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4 text-left">Upcoming tournaments</h2>
      <div class="grid gap-3 sm:grid-cols-3 text-left">
        {#each data.upcomingTournaments as t}
          <a href="/tournaments/{t.id}"
             class="rounded-xl border border-gray-200 dark:border-gray-700 p-4 hover:shadow-md transition-shadow block">
            <p class="font-medium text-sm text-gray-900 dark:text-gray-100 mb-1">{t.name}</p>
            <p class="text-xs text-gray-500">
              {t.start_date ? new Date(t.start_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : ''}
              {t.city ? ` · ${t.city}` : ''}
            </p>
          </a>
        {/each}
      </div>
      <a href="/tournaments" class="text-sm text-blue-600 dark:text-blue-400 hover:underline mt-4 inline-block">
        View all tournaments →
      </a>
    {/if}
  </div>
{:else}
  <!-- Logged-in dashboard — keep ALL existing content here unchanged -->
{/if}
```

Preserve all existing dashboard content inside the `{:else}` block.

- [ ] **Step 3: Verify compilation**

```bash
cd mychess && npm run check 2>&1 | grep -i error | head -20
```

Expected: No errors.

- [ ] **Step 4: Run tests**

```bash
cd mychess && npm test
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add mychess/src/routes/'(kid)'/+page.server.ts mychess/src/routes/'(kid)'/+page.svelte
git commit -m "feat(tournaments): add upcoming tournaments widget to landing page"
```

---

### Task 16: Supabase Edge Function for cron

**Files:**
- Create: `mychess/supabase/functions/tournaments-scrape/index.ts`
- Modify: `mychess/supabase/config.toml`
- Create: `mychess/supabase/migrations/0009_cron_schedule.sql`

> **Important:** Supabase does **not** support `[functions.<name>.cron]` blocks in `config.toml`. Cron scheduling is done via **Supabase Cron** (pg_cron), either via the Dashboard or via a SQL migration using `cron.schedule(...)`. Use a migration file so it's reproducible.

- [ ] **Step 1: Create the Edge Function**

```bash
mkdir -p mychess/supabase/functions/tournaments-scrape
```

Create `mychess/supabase/functions/tournaments-scrape/index.ts`:

```typescript
// Supabase Edge Function: tournaments-scrape
// Called every 6 hours by Supabase Cron (pg_cron) via net.http_post.
// Environment variables required:
//   APP_URL      - The deployed app URL, e.g. https://mychess.vercel.app
//   CRON_SECRET  - Shared secret matching CRON_SECRET in the SvelteKit app

const appUrl = Deno.env.get('APP_URL') ?? '';
const cronSecret = Deno.env.get('CRON_SECRET') ?? '';

Deno.serve(async (_req) => {
  if (!appUrl || !cronSecret) {
    return new Response(
      JSON.stringify({ error: 'APP_URL and CRON_SECRET must be set' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const res = await fetch(`${appUrl}/api/tournaments/scrape`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cronSecret}` },
  });

  const body = await res.json().catch(() => ({}));
  return new Response(JSON.stringify({ status: res.status, ...body }), {
    status: res.ok ? 200 : 502,
    headers: { 'Content-Type': 'application/json' },
  });
});
```

- [ ] **Step 2: Register the function in `config.toml`** (disable JWT verification — it's called by pg_cron)

Open `mychess/supabase/config.toml`. Add at the bottom:

```toml
[functions.tournaments-scrape]
verify_jwt = false
```

- [ ] **Step 3: Schedule via pg_cron SQL migration**

Create `mychess/supabase/migrations/0009_cron_schedule.sql`:

```sql
-- Schedule the tournaments-scrape Edge Function every 6 hours via Supabase Cron (pg_cron).
-- Requires the pg_net extension and your Edge Function URL.
-- Replace <PROJECT_REF> with your actual Supabase project reference.
-- This migration is idempotent: cron.unschedule skips if the job doesn't exist.

select cron.unschedule('tournaments-scrape') from cron.job where jobname = 'tournaments-scrape';

select cron.schedule(
  'tournaments-scrape',
  '0 */6 * * *',
  $$
  select net.http_post(
    url    => 'https://<PROJECT_REF>.supabase.co/functions/v1/tournaments-scrape',
    headers => '{"Content-Type": "application/json"}'::jsonb
  );
  $$
);
```

> **Note:** Replace `<PROJECT_REF>` with the actual Supabase project reference from `mychess/supabase/.temp/linked-project.json` before running this migration. The `net.http_post` call invokes the Edge Function, which in turn calls the SvelteKit `/api/tournaments/scrape` endpoint. The Edge Function carries the `APP_URL` and `CRON_SECRET` environment variables (set via Supabase Dashboard → Edge Functions → Manage secrets).

> **Alternative:** Schedule manually via the Supabase Dashboard → Database → Cron Jobs if pg_net is not available.

- [ ] **Step 4: Commit**

```bash
git add mychess/supabase/functions/tournaments-scrape/index.ts mychess/supabase/config.toml mychess/supabase/migrations/0009_cron_schedule.sql
git commit -m "feat(tournaments): add Edge Function + pg_cron schedule (every 6h)"
```

---

### Task 17: Final verification

- [ ] **Step 1: Run full test suite**

```bash
cd mychess && npm test
```

Expected: all tests PASS.

- [ ] **Step 2: Run type check**

```bash
cd mychess && npm run check
```

Expected: 0 errors.

- [ ] **Step 3: Commit any remaining changes**

```bash
git status
# If there are uncommitted changes, stage and commit them:
git add -A
git commit -m "chore(tournaments): final cleanup"
```

---

### Task 18: Retire chess-tournaments repo

Once the tournament section is verified working in the mychess app (tournaments visible at `/tournaments`, detail pages loading, scrape endpoint responding):

- [ ] **Step 1: Archive the chess-tournaments repo on GitHub**

```bash
gh repo archive tomyka/chess-tournaments --yes
```

Expected: `tomyka/chess-tournaments` is archived (read-only, not deleted — preserves history).

- [ ] **Step 2: Final commit**

```bash
git add -A
git commit -m "chore: chess-tournaments migrated to mychess — repo archived"
```

---

## Summary

After completing all tasks in this plan:

- `/tournaments` — public tournament list with filters (status, time control, country, date range) and calendar view
- `/tournaments/[id]` — tournament detail with player list
- `/api/tournaments/scrape` — cron-protected scrape endpoint
- Supabase tables: `tournaments`, `tournament_players`, `scrape_logs`
- Supabase Edge Function `tournaments-scrape` running every 6 hours
- Landing page (`/`) includes upcoming tournaments widget for public visitors
- chess-tournaments repo archived

**Next phase:** `docs/superpowers/plans/2026-05-29-phase2-fide-dashboard.md`
