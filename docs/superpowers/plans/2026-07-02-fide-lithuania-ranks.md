# FIDE Lithuania Rank Importer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Populate the dashboard's "Country rank" and "Age group rank" tiles for Lithuanian players from FIDE's monthly rating-list export.

**Architecture:** A monthly job downloads FIDE's global XML rating list, unzips it, parses players via regex, filters to `country === 'LTU'`, computes country and age-group ranks (by standard rating), and upserts them into a `fide_players` table. The dashboard load reads the signed-in user's row by `fide_id`. Mirrors the existing tournaments scrape pipeline (`scrape-job.ts` + `/api/tournaments/scrape` + `scrape_logs` + `CRON_SECRET`).

**Tech Stack:** SvelteKit 2, Svelte 5 (runes), TypeScript, Supabase (Postgres + service-role client), Vitest, `fflate` (unzip), `tsx` (script runner).

**Working directory:** All paths are relative to the repo root. The SvelteKit app and its `package.json` live in `mychess/`. Run all `npm`/`npx` commands from inside `mychess/`.

**Spec:** `docs/superpowers/specs/2026-07-02-fide-lithuania-ranks-design.md`

---

## Task 1: Add dependencies and install

**Files:**
- Modify: `mychess/package.json`

- [ ] **Step 1: Add dependencies**

From `mychess/`:

```bash
npm install fflate
npm install -D tsx
```

This also refreshes the stale `node_modules` (adds already-declared `jsdom`).

- [ ] **Step 2: Add the import npm script**

In `mychess/package.json`, add to `"scripts"`:

```json
"fide:import": "tsx scripts/import-fide.ts"
```

- [ ] **Step 3: Verify the toolchain works**

Run (from `mychess/`): `npm test`
Expected: existing suite passes (115+ tests), and the previous `Cannot find package 'jsdom'` error is gone.

- [ ] **Step 4: Commit**

```bash
git add mychess/package.json mychess/package-lock.json
git commit -m "chore: add fflate and tsx for FIDE rank importer"
```

---

## Task 2: Age bracket helper

**Files:**
- Create: `mychess/src/lib/fide/rank.ts`
- Test: `mychess/src/lib/fide/rank.test.ts`

- [ ] **Step 1: Write the failing test**

Create `mychess/src/lib/fide/rank.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ageBracket } from './rank';

describe('ageBracket', () => {
  const YEAR = 2026;

  it('returns null when birth year is null', () => {
    expect(ageBracket(null, YEAR)).toBeNull();
  });

  it('classifies juniors by upper bound of each bracket', () => {
    expect(ageBracket(2019, YEAR)).toBe('U8');   // age 7
    expect(ageBracket(2018, YEAR)).toBe('U8');   // age 8
    expect(ageBracket(2017, YEAR)).toBe('U10');  // age 9
    expect(ageBracket(2016, YEAR)).toBe('U10');  // age 10
    expect(ageBracket(2014, YEAR)).toBe('U12');  // age 12
    expect(ageBracket(2012, YEAR)).toBe('U14');  // age 14
    expect(ageBracket(2010, YEAR)).toBe('U16');  // age 16
    expect(ageBracket(2008, YEAR)).toBe('U18');  // age 18
    expect(ageBracket(2006, YEAR)).toBe('U20');  // age 20
  });

  it('classifies adults between U20 and senior as open', () => {
    expect(ageBracket(2005, YEAR)).toBe('open'); // age 21
    expect(ageBracket(1977, YEAR)).toBe('open'); // age 49
  });

  it('classifies seniors, checking 65+ before 50+', () => {
    expect(ageBracket(1976, YEAR)).toBe('50+'); // age 50
    expect(ageBracket(1962, YEAR)).toBe('50+'); // age 64
    expect(ageBracket(1961, YEAR)).toBe('65+'); // age 65
    expect(ageBracket(1950, YEAR)).toBe('65+'); // age 76
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `mychess/`): `npx vitest run src/lib/fide/rank.test.ts`
Expected: FAIL — cannot resolve `./rank`.

- [ ] **Step 3: Write minimal implementation**

Create `mychess/src/lib/fide/rank.ts`:

```ts
export type AgeBracket = 'U8' | 'U10' | 'U12' | 'U14' | 'U16' | 'U18' | 'U20' | '50+' | '65+' | 'open';

export function ageBracket(birthYear: number | null, currentYear: number): AgeBracket | null {
  if (birthYear == null) return null;
  const age = currentYear - birthYear;
  if (age <= 8) return 'U8';
  if (age <= 10) return 'U10';
  if (age <= 12) return 'U12';
  if (age <= 14) return 'U14';
  if (age <= 16) return 'U16';
  if (age <= 18) return 'U18';
  if (age <= 20) return 'U20';
  if (age >= 65) return '65+';
  if (age >= 50) return '50+';
  return 'open';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `mychess/`): `npx vitest run src/lib/fide/rank.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mychess/src/lib/fide/rank.ts mychess/src/lib/fide/rank.test.ts
git commit -m "feat: add FIDE age bracket classifier"
```

---

## Task 3: computeRanks

**Files:**
- Create: `mychess/src/lib/fide/parse.ts` (type only, in this task)
- Modify: `mychess/src/lib/fide/rank.ts`
- Modify: `mychess/src/lib/fide/rank.test.ts`

Note: `computeRanks` consumes `FidePlayer`. Define that interface now in `parse.ts` so both tasks share it; Task 4 adds the parser function to the same file.

- [ ] **Step 1: Create the shared FidePlayer type**

Create `mychess/src/lib/fide/parse.ts`:

```ts
export interface FidePlayer {
  fideId: string;
  name: string;
  federation: string;
  sex: string | null;
  birthYear: number | null;
  stdRating: number | null;
  rapidRating: number | null;
  blitzRating: number | null;
}
```

- [ ] **Step 2: Write the failing test**

Append to `mychess/src/lib/fide/rank.test.ts`:

```ts
import { computeRanks } from './rank';
import type { FidePlayer } from './parse';

function player(overrides: Partial<FidePlayer>): FidePlayer {
  return {
    fideId: '1', name: 'X', federation: 'LTU', sex: 'M',
    birthYear: 1990, stdRating: 2000, rapidRating: null, blitzRating: null,
    ...overrides,
  };
}

describe('computeRanks', () => {
  const YEAR = 2026;

  it('ranks standard-rated players by rating descending', () => {
    const ranked = computeRanks([
      player({ fideId: 'a', stdRating: 1800 }),
      player({ fideId: 'b', stdRating: 2200 }),
      player({ fideId: 'c', stdRating: 2000 }),
    ], YEAR);
    const byId = Object.fromEntries(ranked.map(r => [r.fideId, r.countryRank]));
    expect(byId).toEqual({ b: 1, c: 2, a: 3 });
  });

  it('gives players without a standard rating a null country rank', () => {
    const ranked = computeRanks([
      player({ fideId: 'a', stdRating: 1800 }),
      player({ fideId: 'b', stdRating: null }),
    ], YEAR);
    const byId = Object.fromEntries(ranked.map(r => [r.fideId, r.countryRank]));
    expect(byId).toEqual({ a: 1, b: null });
  });

  it('ranks within age brackets independently', () => {
    const ranked = computeRanks([
      player({ fideId: 'kid1', birthYear: 2016, stdRating: 1200 }), // U10
      player({ fideId: 'kid2', birthYear: 2016, stdRating: 1400 }), // U10
      player({ fideId: 'adult', birthYear: 1990, stdRating: 2000 }), // open
    ], YEAR);
    const byId = Object.fromEntries(ranked.map(r => [r.fideId, r.ageGroupRank]));
    expect(byId).toEqual({ kid2: 1, kid1: 2, adult: 1 });
  });

  it('gives unrated or bracketless players a null age-group rank', () => {
    const ranked = computeRanks([
      player({ fideId: 'a', birthYear: null, stdRating: 2000 }),
      player({ fideId: 'b', birthYear: 2016, stdRating: null }),
    ], YEAR);
    const byId = Object.fromEntries(ranked.map(r => [r.fideId, r.ageGroupRank]));
    expect(byId).toEqual({ a: null, b: null });
  });

  it('breaks ties by preserving input order (distinct sequential ranks)', () => {
    const ranked = computeRanks([
      player({ fideId: 'a', stdRating: 2000 }),
      player({ fideId: 'b', stdRating: 2000 }),
    ], YEAR);
    const byId = Object.fromEntries(ranked.map(r => [r.fideId, r.countryRank]));
    expect(byId).toEqual({ a: 1, b: 2 });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run (from `mychess/`): `npx vitest run src/lib/fide/rank.test.ts`
Expected: FAIL — `computeRanks` is not exported.

- [ ] **Step 4: Write minimal implementation**

Append to `mychess/src/lib/fide/rank.ts`:

```ts
import type { FidePlayer } from './parse';

export interface RankedPlayer extends FidePlayer {
  countryRank: number | null;
  ageBracket: AgeBracket | null;
  ageGroupRank: number | null;
}

export function computeRanks(players: FidePlayer[], currentYear: number): RankedPlayer[] {
  // Stable sort of standard-rated players by rating descending.
  const rated = players
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.stdRating != null)
    .sort((x, y) => (y.p.stdRating! - x.p.stdRating!) || (x.i - y.i));

  const countryRankById = new Map<string, number>();
  rated.forEach(({ p }, idx) => countryRankById.set(p.fideId, idx + 1));

  // Age-group rank: rated players grouped by bracket, ranked within group.
  const ageGroupRankById = new Map<string, number>();
  const perBracketCount = new Map<AgeBracket, number>();
  for (const { p } of rated) {
    const bracket = ageBracket(p.birthYear, currentYear);
    if (!bracket) continue;
    const next = (perBracketCount.get(bracket) ?? 0) + 1;
    perBracketCount.set(bracket, next);
    ageGroupRankById.set(p.fideId, next);
  }

  return players.map((p) => ({
    ...p,
    countryRank: countryRankById.get(p.fideId) ?? null,
    ageBracket: ageBracket(p.birthYear, currentYear),
    ageGroupRank: ageGroupRankById.get(p.fideId) ?? null,
  }));
}
```

- [ ] **Step 5: Run test to verify it passes**

Run (from `mychess/`): `npx vitest run src/lib/fide/rank.test.ts`
Expected: PASS (all `ageBracket` and `computeRanks` tests).

- [ ] **Step 6: Commit**

```bash
git add mychess/src/lib/fide/rank.ts mychess/src/lib/fide/rank.test.ts mychess/src/lib/fide/parse.ts
git commit -m "feat: add FIDE country and age-group rank computation"
```

---

## Task 4: parseFidePlayers

**Files:**
- Modify: `mychess/src/lib/fide/parse.ts`
- Test: `mychess/src/lib/fide/parse.test.ts`

- [ ] **Step 1: Write the failing test**

Create `mychess/src/lib/fide/parse.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseFidePlayers } from './parse';

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<playerslist>
<player>
<fideid>12865168</fideid>
<name>Konovalovas, Tomas</name>
<country>LTU</country>
<sex>M</sex>
<title></title>
<rating>0</rating>
<rapid_rating>1663</rapid_rating>
<blitz_rating>1530</blitz_rating>
<birthday>1978</birthday>
</player>
<player>
<fideid>1503014</fideid>
<name>Carlsen, Magnus</name>
<country>NOR</country>
<sex>M</sex>
<rating>2839</rating>
<rapid_rating>2828</rapid_rating>
<blitz_rating>2887</blitz_rating>
<birthday>1990</birthday>
</player>
<player>
<fideid>99999</fideid>
<name>Junior, Lietuvis</name>
<country>LTU</country>
<sex>F</sex>
<rating>1400</rating>
<birthday></birthday>
</player>
<player>
<fideid></fideid>
<name>No Id</name>
<country>LTU</country>
</player>
</playerslist>`;

describe('parseFidePlayers', () => {
  it('extracts every player with a numeric fideid', () => {
    const players = parseFidePlayers(XML);
    expect(players.map(p => p.fideId)).toEqual(['12865168', '1503014', '99999']);
  });

  it('maps tags to typed fields', () => {
    const p = parseFidePlayers(XML)[0];
    expect(p).toEqual({
      fideId: '12865168',
      name: 'Konovalovas, Tomas',
      federation: 'LTU',
      sex: 'M',
      birthYear: 1978,
      stdRating: null,       // <rating>0</rating> → null
      rapidRating: 1663,
      blitzRating: 1530,
    });
  });

  it('treats blank/missing numeric tags as null', () => {
    const junior = parseFidePlayers(XML)[2];
    expect(junior.birthYear).toBeNull();      // empty <birthday>
    expect(junior.rapidRating).toBeNull();    // tag absent
    expect(junior.blitzRating).toBeNull();
    expect(junior.stdRating).toBe(1400);
  });

  it('skips players with a missing or non-numeric fideid', () => {
    const players = parseFidePlayers(XML);
    expect(players.find(p => p.name === 'No Id')).toBeUndefined();
  });

  it('returns an empty array for empty input', () => {
    expect(parseFidePlayers('')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `mychess/`): `npx vitest run src/lib/fide/parse.test.ts`
Expected: FAIL — `parseFidePlayers` is not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `mychess/src/lib/fide/parse.ts` (below the `FidePlayer` interface):

```ts
function tagValue(chunk: string, tag: string): string | null {
  const m = chunk.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
  const v = m ? m[1].trim() : '';
  return v || null;
}

function tagNumber(chunk: string, tag: string): number | null {
  const v = tagValue(chunk, tag);
  if (v == null) return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function parseFidePlayers(xml: string): FidePlayer[] {
  const players: FidePlayer[] = [];
  for (const m of xml.matchAll(/<player\b[^>]*>([\s\S]*?)<\/player>/g)) {
    const chunk = m[1];
    const fideId = tagValue(chunk, 'fideid');
    if (!fideId || !/^\d+$/.test(fideId)) continue;
    players.push({
      fideId,
      name: tagValue(chunk, 'name') ?? '',
      federation: tagValue(chunk, 'country') ?? '',
      sex: tagValue(chunk, 'sex'),
      birthYear: tagNumber(chunk, 'birthday'),
      stdRating: tagNumber(chunk, 'rating'),
      rapidRating: tagNumber(chunk, 'rapid_rating'),
      blitzRating: tagNumber(chunk, 'blitz_rating'),
    });
  }
  return players;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `mychess/`): `npx vitest run src/lib/fide/parse.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mychess/src/lib/fide/parse.ts mychess/src/lib/fide/parse.test.ts
git commit -m "feat: add FIDE XML player-list parser"
```

---

## Task 5: Download + unzip module

**Files:**
- Create: `mychess/src/lib/fide/download.ts`

This module is thin IO (network + unzip); no unit test (per spec). It is exercised by the real import run in Task 10's verification.

- [ ] **Step 1: Write the implementation**

Create `mychess/src/lib/fide/download.ts`:

```ts
import { unzipSync, strFromU8 } from 'fflate';

const DEFAULT_URL = 'https://ratings.fide.com/download/players_list_xml.zip';

/**
 * Downloads FIDE's monthly combined rating list (XML variant), unzips it in
 * memory, and returns the XML file's contents as a string.
 */
export async function downloadPlayersList(url: string = DEFAULT_URL): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`FIDE download failed: ${res.status} ${res.statusText}`);

  const zipped = new Uint8Array(await res.arrayBuffer());
  const files = unzipSync(zipped);
  const names = Object.keys(files);
  const xmlName = names.find((n) => n.toLowerCase().endsWith('.xml')) ?? names[0];
  if (!xmlName) throw new Error('FIDE zip archive is empty');

  return strFromU8(files[xmlName]);
}
```

- [ ] **Step 2: Verify it type-checks**

Run (from `mychess/`): `npm run check`
Expected: no new errors in `src/lib/fide/download.ts`. (Pre-existing errors in `src/routes/auth/**` are unrelated.)

- [ ] **Step 3: Commit**

```bash
git add mychess/src/lib/fide/download.ts
git commit -m "feat: add FIDE rating-list download and unzip helper"
```

---

## Task 6: Database migration

**Files:**
- Create: `mychess/supabase/migrations/0013_fide_players.sql`

- [ ] **Step 1: Write the migration**

Create `mychess/supabase/migrations/0013_fide_players.sql`:

```sql
-- FIDE Lithuania rank importer: player rating/rank cache + import audit log.

create table if not exists public.fide_players (
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

-- Ranks are public information: anyone (incl. anonymous guests) may read them.
drop policy if exists "fide_players public read" on public.fide_players;
create policy "fide_players public read"
  on public.fide_players for select using (true);
-- No insert/update/delete policies: only the service-role key (bypasses RLS) writes.

create table if not exists public.fide_import_logs (
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

- [ ] **Step 2: Apply the migration**

Apply via your normal workflow (Supabase SQL editor, or `supabase db push` if the CLI is configured). Confirm the `fide_players` and `fide_import_logs` tables exist.

Expected: both tables created; `select * from fide_players limit 1;` returns 0 rows without error.

- [ ] **Step 3: Commit**

```bash
git add mychess/supabase/migrations/0013_fide_players.sql
git commit -m "feat: add fide_players and fide_import_logs tables"
```

---

## Task 7: Import job orchestration

**Files:**
- Create: `mychess/src/lib/fide/import-job.ts`

Mirrors `src/lib/tournaments/scrape-job.ts`: takes `(supabaseUrl, serviceKey)`, uses a service-role client, logs start/finish to `fide_import_logs`. No `$lib` imports (so the Task 9 script can import it directly via a relative path). Not unit-tested; exercised by the real run in Task 10.

- [ ] **Step 1: Write the implementation**

Create `mychess/src/lib/fide/import-job.ts`:

```ts
import { createClient } from '@supabase/supabase-js';
import { downloadPlayersList } from './download';
import { parseFidePlayers } from './parse';
import { computeRanks } from './rank';

export interface FideImportResult {
  total: number;      // players parsed from the global list
  ltu: number;        // Lithuanian players found
  imported: number;   // rows upserted
  listDate: string;   // YYYY-MM-01
  errors: string[];
}

const CHUNK = 500;

/**
 * Full monthly FIDE import for Lithuania.
 * @param supabaseUrl PUBLIC_SUPABASE_URL
 * @param serviceKey  SUPABASE_SERVICE_ROLE_KEY (write access, bypasses RLS)
 */
export async function runFideImport(
  supabaseUrl: string,
  serviceKey: string,
  now: Date = new Date()
): Promise<FideImportResult> {
  const db = createClient(supabaseUrl, serviceKey);
  const currentYear = now.getFullYear();
  const listDate = `${currentYear}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const errors: string[] = [];

  const { data: log } = await db
    .from('fide_import_logs')
    .insert({ status: 'running', list_date: listDate })
    .select('id')
    .single();
  const logId = log?.id as string | undefined;

  const result: FideImportResult = { total: 0, ltu: 0, imported: 0, listDate, errors };

  try {
    const xml = await downloadPlayersList();
    const all = parseFidePlayers(xml);
    result.total = all.length;

    const ltu = all.filter((p) => p.federation === 'LTU');
    result.ltu = ltu.length;

    const ranked = computeRanks(ltu, currentYear);
    const nowIso = now.toISOString();

    for (let i = 0; i < ranked.length; i += CHUNK) {
      const rows = ranked.slice(i, i + CHUNK).map((p) => ({
        fide_id: p.fideId,
        name: p.name,
        federation: p.federation,
        sex: p.sex,
        birth_year: p.birthYear,
        std_rating: p.stdRating,
        rapid_rating: p.rapidRating,
        blitz_rating: p.blitzRating,
        country_rank: p.countryRank,
        age_bracket: p.ageBracket,
        age_group_rank: p.ageGroupRank,
        list_date: listDate,
        updated_at: nowIso,
      }));
      const { error } = await db.from('fide_players').upsert(rows, { onConflict: 'fide_id' });
      if (error) errors.push(`Upsert chunk ${i}: ${error.message}`);
      else result.imported += rows.length;
    }

    if (logId) {
      await db.from('fide_import_logs').update({
        finished_at: new Date().toISOString(),
        status: errors.length === 0 ? 'success' : 'partial',
        message: errors.length > 0 ? errors.slice(0, 5).join('; ') : null,
        players_imported: result.imported,
      }).eq('id', logId);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    errors.push(msg);
    if (logId) {
      await db.from('fide_import_logs').update({
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

- [ ] **Step 2: Verify it type-checks**

Run (from `mychess/`): `npm run check`
Expected: no new errors in `src/lib/fide/import-job.ts`.

- [ ] **Step 3: Commit**

```bash
git add mychess/src/lib/fide/import-job.ts
git commit -m "feat: add FIDE import job orchestration"
```

---

## Task 8: API endpoint

**Files:**
- Create: `mychess/src/routes/api/fide/import/+server.ts`

Copies the auth pattern of `src/routes/api/tournaments/scrape/+server.ts` exactly.

- [ ] **Step 1: Write the endpoint**

Create `mychess/src/routes/api/fide/import/+server.ts`:

```ts
import { timingSafeEqual, createHmac } from 'crypto';
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { runFideImport } from '$lib/fide/import-job';
import { env } from '$env/dynamic/private';
import { env as pubEnv } from '$env/dynamic/public';

const HMAC_KEY = Buffer.from('timing-safe-compare');

function safeCompare(a: string, b: string): boolean {
  const ha = createHmac('sha256', HMAC_KEY).update(a).digest();
  const hb = createHmac('sha256', HMAC_KEY).update(b).digest();
  return timingSafeEqual(ha, hb);
}

// NOTE: This download+parse job is heavy (~47 MB download, ~200 MB decompressed,
// thousands of upserts) and may exceed serverless time/memory limits. Prefer the
// GitHub Action runner (npm run fide:import). This endpoint is for manual/on-demand use.
export const POST: RequestHandler = async ({ request }) => {
  const { CRON_SECRET, SUPABASE_SERVICE_ROLE_KEY } = env;
  const { PUBLIC_SUPABASE_URL } = pubEnv;
  const auth = request.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';

  if (!CRON_SECRET || !safeCompare(token, CRON_SECRET)) {
    throw error(401, 'Unauthorized');
  }

  try {
    const result = await runFideImport(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    return json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw error(500, `FIDE import failed: ${msg}`);
  }
};
```

- [ ] **Step 2: Verify it type-checks**

Run (from `mychess/`): `npm run check`
Expected: no new errors in the new endpoint file.

- [ ] **Step 3: Commit**

```bash
git add mychess/src/routes/api/fide/import/+server.ts
git commit -m "feat: add FIDE import API endpoint (CRON_SECRET guarded)"
```

---

## Task 9: Manual runner script, GitHub Action, sample pg_cron

**Files:**
- Create: `mychess/scripts/import-fide.ts`
- Create: `.github/workflows/fide-import.yml`
- Create: `mychess/supabase/migrations/0014_fide_cron.sql`

- [ ] **Step 1: Write the runner script**

Create `mychess/scripts/import-fide.ts`:

```ts
import { runFideImport } from '../src/lib/fide/import-job';

const url = process.env.PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error('Missing PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

runFideImport(url, key)
  .then((r) => {
    console.log('FIDE import complete:', JSON.stringify(r, null, 2));
    process.exit(r.errors.length > 0 ? 1 : 0);
  })
  .catch((e) => {
    console.error('FIDE import failed:', e);
    process.exit(1);
  });
```

- [ ] **Step 2: Verify the script runs (dry auth check)**

Run (from `mychess/`, with no env set): `npm run fide:import`
Expected: prints `Missing PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY` and exits non-zero. (A full run with real env is done in Task 10.)

- [ ] **Step 3: Write the GitHub Action**

Create `.github/workflows/fide-import.yml`:

```yaml
name: FIDE monthly import

on:
  schedule:
    - cron: '0 3 1 * *' # 03:00 UTC on the 1st of each month
  workflow_dispatch: {}

jobs:
  import:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: mychess
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: npm run fide:import
        env:
          PUBLIC_SUPABASE_URL: ${{ secrets.PUBLIC_SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
```

- [ ] **Step 4: Write the sample pg_cron migration**

Create `mychess/supabase/migrations/0014_fide_cron.sql`:

```sql
-- OPTIONAL: schedule the FIDE import monthly via Supabase Cron (pg_cron), for teams
-- preferring Supabase-side scheduling over the GitHub Action.
--
-- ⚠️  DO NOT AUTO-APPLY: replace <PROJECT_REF> with your Supabase project ref and
--     <CRON_SECRET> with the value of your CRON_SECRET env var before running.
--
-- Requires the pg_net extension. Idempotent: unschedule skips if the job is absent.

select cron.unschedule('fide-import') from cron.job where jobname = 'fide-import';

select cron.schedule(
  'fide-import',
  '0 3 1 * *',
  $$
  select net.http_post(
    url    => 'https://<PROJECT_REF>.vercel.app/api/fide/import',
    headers => '{"Content-Type": "application/json", "Authorization": "Bearer <CRON_SECRET>"}'::jsonb
  );
  $$
);
```

- [ ] **Step 5: Commit**

```bash
git add mychess/scripts/import-fide.ts .github/workflows/fide-import.yml mychess/supabase/migrations/0014_fide_cron.sql
git commit -m "feat: add FIDE import runner script, GitHub Action, sample pg_cron"
```

---

## Task 10: Dashboard UI wiring

**Files:**
- Modify: `mychess/src/lib/components/StatsRow.svelte`
- Test: `mychess/src/lib/components/StatsRow.test.ts`
- Modify: `mychess/src/routes/(kid)/+page.server.ts`
- Modify: `mychess/src/routes/(kid)/+page.svelte`

- [ ] **Step 1: Write the failing component test**

Create `mychess/src/lib/components/StatsRow.test.ts` (mirrors the jsdom setup of `LichessStatsCard.test.ts` — note the `@vitest-environment jsdom` directive, `screen`, and `cleanup`):

```ts
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import StatsRow from './StatsRow.svelte';

afterEach(() => cleanup());

describe('StatsRow', () => {
  it('shows the country rank number when provided', () => {
    render(StatsRow, { props: { countryRank: 42 } });
    expect(screen.getByText('42')).toBeTruthy();
    expect(screen.getByText('Country rank')).toBeTruthy();
  });

  it('shows a dash for country rank when null', () => {
    render(StatsRow, { props: { countryRank: null } });
    expect(screen.getAllByText('––').length).toBeGreaterThan(0);
  });

  it('labels the age-group tile with the bracket when known', () => {
    render(StatsRow, { props: { ageGroupRank: 3, ageBracket: 'U12' } });
    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.getByText('U12 rank')).toBeTruthy();
  });

  it('uses a generic label for the open bracket', () => {
    render(StatsRow, { props: { ageGroupRank: 5, ageBracket: 'open' } });
    expect(screen.getByText('Age group rank')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `mychess/`): `npx vitest run src/lib/components/StatsRow.test.ts`
Expected: FAIL — component doesn't accept these props / renders `––` where a number is expected.

- [ ] **Step 3: Update StatsRow**

Replace the contents of `mychess/src/lib/components/StatsRow.svelte` with:

```svelte
<!-- MyChess/src/lib/components/StatsRow.svelte -->
<script lang="ts">
  let {
    streakDays = 0,
    countryRank = null,
    ageGroupRank = null,
    ageBracket = null,
  } = $props<{
    streakDays?: number;
    countryRank?: number | null;
    ageGroupRank?: number | null;
    ageBracket?: string | null;
  }>();

  const ageLabel = $derived(
    ageBracket && ageBracket !== 'open' ? `${ageBracket} rank` : 'Age group rank'
  );
</script>

<div class="grid grid-cols-3 gap-3">
  <!-- Country rank (FIDE standard, Lithuania) -->
  <div class="bg-white rounded-xl border border-gray-200 shadow-sm p-3 text-center">
    <p class="text-xl font-bold {countryRank != null ? 'text-gray-900' : 'text-gray-400'}">
      {countryRank ?? '––'}
    </p>
    <p class="text-xs text-gray-400 mt-0.5">Country rank</p>
  </div>

  <!-- Age group rank -->
  <div class="bg-white rounded-xl border border-gray-200 shadow-sm p-3 text-center">
    <p class="text-xl font-bold {ageGroupRank != null ? 'text-gray-900' : 'text-gray-400'}">
      {ageGroupRank ?? '––'}
    </p>
    <p class="text-xs text-gray-400 mt-0.5">{ageLabel}</p>
  </div>

  <!-- Streak -->
  <div class="bg-white rounded-xl border border-gray-200 shadow-sm p-3 text-center">
    <p class="text-xl font-bold {streakDays > 0 ? 'text-orange-500' : 'text-gray-300'}">
      {streakDays > 0 ? `🔥 ${streakDays}` : '–'}
    </p>
    <p class="text-xs text-gray-400 mt-0.5">Day streak</p>
  </div>
</div>
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `mychess/`): `npx vitest run src/lib/components/StatsRow.test.ts`
Expected: PASS.

- [ ] **Step 5: Load the ranks in the dashboard server load**

In `mychess/src/routes/(kid)/+page.server.ts`, after the block that computes `lichessUsername` (around line 31) and before the `Promise.all`, add a FIDE-rank lookup. Insert:

```ts
  // FIDE Lithuania rank (from the monthly imported list), keyed by the player's FIDE ID.
  let countryRank: number | null = null;
  let ageGroupRank: number | null = null;
  let ageBracket: string | null = null;
  if (p?.fide_id) {
    const { data: fide } = await supabase
      .from('fide_players')
      .select('country_rank, age_group_rank, age_bracket')
      .eq('fide_id', p.fide_id)
      .single();
    countryRank = (fide as any)?.country_rank ?? null;
    ageGroupRank = (fide as any)?.age_group_rank ?? null;
    ageBracket = (fide as any)?.age_bracket ?? null;
  }
```

Then add these three fields to the returned object (in the final `return { ... }`, alongside `avatarId`):

```ts
    countryRank,
    ageGroupRank,
    ageBracket,
```

- [ ] **Step 6: Pass the ranks into StatsRow**

In `mychess/src/routes/(kid)/+page.svelte`, replace the existing StatsRow usage:

```svelte
      <StatsRow streakDays={stats.streak_days ?? 0} />
```

with:

```svelte
      <StatsRow
        streakDays={stats.streak_days ?? 0}
        countryRank={d.countryRank ?? null}
        ageGroupRank={d.ageGroupRank ?? null}
        ageBracket={d.ageBracket ?? null}
      />
```

- [ ] **Step 7: Run the full test suite and type-check**

Run (from `mychess/`): `npm test`
Expected: all tests pass, including the new StatsRow tests.

Run (from `mychess/`): `npm run check`
Expected: no new errors in the modified files.

- [ ] **Step 8: End-to-end verification of the import**

With real env vars set (`PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`), run the actual import once:

Run (from `mychess/`): `npm run fide:import`
Expected: prints a result like `{ total: <~1.4M>, ltu: <a few thousand>, imported: <same as ltu>, listDate: "YYYY-MM-01", errors: [] }` and exits 0.

Then verify the target FIDE ID resolved (using the FIDE ID on your profile, e.g. `12865168`):
`select fide_id, country_rank, age_bracket, age_group_rank from fide_players where fide_id = '12865168';`
Expected: a row with a non-null `country_rank` (that player has no standard rating in the sample above — if `std_rating` is null, `country_rank` will be null by design; pick a standard-rated LTU FIDE ID to confirm a real rank).

Finally, load the dashboard signed in as a user whose profile `fide_id` is in the list and confirm the "Country rank" / age-group tiles show numbers.

- [ ] **Step 9: Commit**

```bash
git add mychess/src/lib/components/StatsRow.svelte mychess/src/lib/components/StatsRow.test.ts "mychess/src/routes/(kid)/+page.server.ts" "mychess/src/routes/(kid)/+page.svelte"
git commit -m "feat: show FIDE country and age-group rank on the dashboard"
```

---

## Self-Review Notes

- **Spec coverage:** data source (Task 5), parse (Task 4), rank + age brackets (Tasks 2–3), storage + RLS (Task 6), job (Task 7), endpoint (Task 8), runner/GA/pg_cron (Task 9), UI wiring (Task 10). All spec sections mapped.
- **Type consistency:** `FidePlayer` defined in Task 3 Step 1 (`parse.ts`), consumed by `computeRanks` (Task 3) and produced by `parseFidePlayers` (Task 4); `RankedPlayer` fields (`countryRank`, `ageBracket`, `ageGroupRank`) match the DB columns (Task 6) and the upsert mapping (Task 7) and the StatsRow props (Task 10).
- **Lithuania-only:** enforced by the single `federation === 'LTU'` filter in `runFideImport` (Task 7).
