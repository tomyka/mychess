# Per-Student Active Repertoire Mapping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record which repertoire is a student's current preparation for each curated opening, with "exactly one per (student, opening)" enforced by the database.

**Architecture:** One new table, `active_opening_repertoires`, whose primary key `(player_id, opening_id)` *is* the constraint — row existence means "active", so no flag and no partial index. Non-active candidates are not stored: `resolveOpening` already derives which opening a repertoire prepares, and part A (#201) deliberately refused to store that fact. Which opening a repertoire belongs to is therefore always computed in application code, never in SQL.

**Tech Stack:** SvelteKit 2 + Svelte 5 runes, Supabase (Postgres + RLS), vitest, Paraglide (en/lt), Tailwind 4.

**Spec:** `docs/superpowers/specs/2026-09-10-per-student-active-repertoire-design.md`

**Issue:** #202, part B of epic #119.

---

## Before you start

All `npm` commands run from `mychess/`, not the repo root. If this is a fresh checkout, run `npm run setup` first — a bare `npm install` leaves vitest unable to start on this project's dev machines.

Work on the branch `feat/active-opening-mapping`, which already exists and holds the spec commit.

**You cannot apply the migration.** There is no local Postgres and no linked Supabase CLI. Task 1 writes the SQL file; a human pastes it into the Supabase dashboard. Everything after Task 1 is written against a schema that does not exist yet in the database, which is expected — the unit tests do not touch Postgres.

## File Structure

| File | Responsibility |
| --- | --- |
| `supabase/migrations/0079_active_opening_repertoires.sql` | The table, its RLS, the two `security definer` helpers, the unassign trigger. |
| `src/lib/openings/active.ts` | Pure: staleness rule, the opening→repertoire map, and the column list `resolveOpening` needs. |
| `src/lib/openings/active.test.ts` | Its tests. |
| `src/lib/server/active-openings.ts` | Supabase I/O: write the active choice, read it back. |
| `src/lib/server/pgn-import.ts` | Modified: a newly created repertoire auto-activates for its owner. |
| `src/routes/(coach)/coach/players/[player_id]/+page.server.ts` | Modified: load the active set, auto-activate on assignment, add the `setActive` action. |
| `src/routes/(coach)/coach/players/[player_id]/+page.svelte` | Modified: opening name, "Active" marker, "Make active" button. |
| `src/routes/(coach)/coach/players/[player_id]/player.test.ts` | Component test for that control. |
| `messages/en.json`, `messages/lt.json` | Two new strings. |
| `scripts/backfill-active-openings.ts` | One-off: apply the auto-activation rule to everything that already exists. |

---

### Task 1: The migration

**Files:**
- Create: `supabase/migrations/0079_active_opening_repertoires.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0079_active_opening_repertoires.sql` with exactly this content:

```sql
-- mychess/supabase/migrations/0079_active_opening_repertoires.sql
--
-- #202 (epic #119): which repertoire is a student's CURRENT preparation for a
-- given curated opening.
--
-- Row existence is what "active" means, so the primary key (player_id,
-- opening_id) IS the acceptance criterion — exactly one active repertoire per
-- (student, opening), enforced here rather than by application code. There is
-- deliberately no `is_active` flag and no partial unique index over one.
--
-- Non-active candidates are NOT stored. Which opening a repertoire prepares is
-- derived by resolveOpening (src/lib/openings/resolve.ts) from (eco_code,
-- color); storing a second copy per candidate is exactly what #201 declined to
-- do. Only the CHOICE is written down, because only the choice cannot be
-- derived.
--
-- No foreign key on opening_id: the taxonomy is a TypeScript module, not a
-- table (see 0078's header for why). Integrity is taxonomy.test.ts, plus the
-- read-time staleness rule in src/lib/openings/active.ts.
--
-- No unique on (player_id, repertoire_id): a repertoire resolves to exactly
-- one opening, so it cannot be active for two.
--
-- set_by is written and not yet read. It is here because two writers exist by
-- design (the student, and an active coach), "was this the coach holding me
-- back, or me?" is the first question #203's coach view asks, and every
-- migration on this project is a hand-pasted dashboard step — the column is
-- nearly free now and costs a whole round trip later. Null means the backfill
-- script wrote it; nobody chose.

create table public.active_opening_repertoires (
  player_id     uuid not null references public.profiles(id) on delete cascade,
  opening_id    text not null,
  repertoire_id uuid not null references public.repertoires(id) on delete cascade,
  set_by        uuid references public.profiles(id) on delete set null,
  updated_at    timestamptz not null default now(),
  primary key (player_id, opening_id)
);

-- Postgres does not index the referencing side of a foreign key. Deleting a
-- repertoire is a real user action here (the delete-repertoire feature), and
-- its cascade would otherwise scan this whole table.
create index active_opening_repertoires_repertoire_idx
  on public.active_opening_repertoires (repertoire_id);

alter table public.active_opening_repertoires enable row level security;

-- Supabase's default grant to `anon` is not removed by granting to
-- `authenticated`, so revoke it explicitly.
revoke all on public.active_opening_repertoires from anon, public;
grant select, insert, update, delete on public.active_opening_repertoires to authenticated;

-- "May this repertoire be the active one for this student?" — they own it, or
-- it is assigned to them. One function, called by both the RLS policies below
-- and by src/lib/server/active-openings.ts, so the two cannot drift apart.
--
-- security definer is not decoration. 0040 established that a plain correlated
-- subquery against `repertoires` from inside a policy re-enters repertoires'
-- own RLS, which queries assigned_repertoires back, and Postgres refuses to
-- expand the cycle rather than resolving it. A security definer function is
-- never inlined by the planner, so the cycle never forms.
create or replace function public.repertoire_available_to(p_repertoire_id uuid, p_player_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.repertoires r
    where r.id = p_repertoire_id and r.player_id = p_player_id
  ) or exists (
    select 1 from public.assigned_repertoires a
    where a.repertoire_id = p_repertoire_id and a.player_id = p_player_id
  );
$$;

revoke all on function public.repertoire_available_to(uuid, uuid) from public;
grant execute on function public.repertoire_available_to(uuid, uuid) to authenticated;

-- "May the caller decide this student's active openings?" — the student
-- themselves, or a coach with an active relationship. Extracted for the same
-- reason: four policies below need the identical test, and a copy that drifts
-- is a silent authorisation hole.
create or replace function public.manages_openings_for(p_player_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select p_player_id = auth.uid()
      or exists (
        select 1 from public.coach_players cp
        where cp.coach_id = auth.uid()
          and cp.player_id = p_player_id
          and cp.status = 'active'
      );
$$;

revoke all on function public.manages_openings_for(uuid) from public;
grant execute on function public.manages_openings_for(uuid) to authenticated;

-- Single-operation policies, never `for all`: Postgres ORs permissive policies
-- for the same operation together, so a broad one silently defeats a narrow
-- one added beside it.
create policy active_opening_repertoires_read on public.active_opening_repertoires
  for select using (public.manages_openings_for(player_id));

create policy active_opening_repertoires_insert on public.active_opening_repertoires
  for insert with check (
    public.manages_openings_for(player_id)
    and public.repertoire_available_to(repertoire_id, player_id)
  );

create policy active_opening_repertoires_update on public.active_opening_repertoires
  for update using (public.manages_openings_for(player_id))
  with check (
    public.manages_openings_for(player_id)
    and public.repertoire_available_to(repertoire_id, player_id)
  );

create policy active_opening_repertoires_delete on public.active_opening_repertoires
  for delete using (public.manages_openings_for(player_id));

-- Unassigning the active repertoire leaves that opening with NO active
-- mapping. Nothing is promoted in its place — a gap is the honest answer and
-- is what #203 surfaces.
--
-- A trigger rather than a line in the unassign action, so the mapping cannot
-- outlive its repertoire under any write path, including a raw one. It needs
-- no "unless the student owns it anyway" guard: 0030 requires an assigned
-- repertoire to belong to the assigning coach, so an assigned repertoire is
-- never the student's own. Deleting the repertoire itself is already handled
-- by the foreign key's cascade.
create or replace function public.clear_active_opening_on_unassign()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.active_opening_repertoires
   where player_id = old.player_id
     and repertoire_id = old.repertoire_id;
  return old;
end;
$$;

create trigger clear_active_opening_on_unassign
  after delete on public.assigned_repertoires
  for each row execute function public.clear_active_opening_on_unassign();
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/0079_active_opening_repertoires.sql
git commit -m "feat(openings): migration for per-student active repertoire mapping (GitHub issue #202)"
```

- [ ] **Step 3: Hand the SQL to the user**

Print the file's contents and ask them to run it in the Supabase dashboard SQL editor. Do not wait on it — the remaining tasks do not need it applied. Do not claim the feature works until they confirm.

---

### Task 2: The pure layer

**Files:**
- Create: `src/lib/openings/active.ts`
- Test: `src/lib/openings/active.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/openings/active.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { activeByOpening, isActiveRowStale, REPERTOIRE_OPENING_COLUMNS } from './active';
import type { CuratedOpening } from './taxonomy';

const TAXONOMY: CuratedOpening[] = [
  { id: 'najdorf-black', name: 'Sicilian: Najdorf', nameLt: 'Naidorfo variantas', side: 'black', ecoCodes: ['B90'] },
  { id: 'alapin-white', name: 'Anti-Sicilian: Alapin', nameLt: 'Alapino variantas', side: 'white', ecoCodes: ['B22'] }
];

const ALAPIN = { id: 'rep-alapin', eco_code: 'B22', color: 'white' as const, opening_id: null };
const NAJDORF = { id: 'rep-najdorf', eco_code: 'B90', color: 'black' as const, opening_id: null };
const UNCLASSIFIED = { id: 'rep-none', eco_code: 'A00', color: 'white' as const, opening_id: null };

describe('isActiveRowStale', () => {
  it('is false while the repertoire still resolves to the row it was written for', () => {
    expect(isActiveRowStale({ opening_id: 'alapin-white', repertoire_id: 'rep-alapin' }, ALAPIN, TAXONOMY)).toBe(false);
  });

  // The taxonomy is hand-edited and will churn. A row written when this
  // repertoire meant one opening must not keep claiming that opening after an
  // edit moves it — showing the wrong preparation is worse than showing none.
  it('is true once the repertoire resolves somewhere else', () => {
    expect(isActiveRowStale({ opening_id: 'najdorf-black', repertoire_id: 'rep-alapin' }, ALAPIN, TAXONOMY)).toBe(true);
  });

  it('is true when the repertoire resolves to no curated opening at all', () => {
    expect(isActiveRowStale({ opening_id: 'alapin-white', repertoire_id: 'rep-none' }, UNCLASSIFIED, TAXONOMY)).toBe(true);
  });

  // A coach reading a student's rows cannot read a repertoire the student
  // uploaded themselves, so the embed comes back null. Unverifiable is treated
  // as stale rather than trusted.
  it('is true when the repertoire is not readable', () => {
    expect(isActiveRowStale({ opening_id: 'alapin-white', repertoire_id: 'rep-alapin' }, undefined, TAXONOMY)).toBe(true);
  });
});

describe('activeByOpening', () => {
  it('keys the active repertoire by its opening', () => {
    const map = activeByOpening(
      [ALAPIN, NAJDORF],
      [
        { opening_id: 'alapin-white', repertoire_id: 'rep-alapin' },
        { opening_id: 'najdorf-black', repertoire_id: 'rep-najdorf' }
      ],
      TAXONOMY
    );

    expect(map.get('alapin-white')?.id).toBe('rep-alapin');
    expect(map.get('najdorf-black')?.id).toBe('rep-najdorf');
  });

  it('drops a stale row instead of reporting the wrong repertoire', () => {
    const map = activeByOpening([ALAPIN], [{ opening_id: 'najdorf-black', repertoire_id: 'rep-alapin' }], TAXONOMY);

    expect(map.size).toBe(0);
  });

  it('drops a row whose repertoire is missing from the list', () => {
    const map = activeByOpening([ALAPIN], [{ opening_id: 'najdorf-black', repertoire_id: 'rep-gone' }], TAXONOMY);

    expect(map.size).toBe(0);
  });

  // Callers pass their own richer rows (a name, a colour dot) and read them
  // back out of the map, so the generic must not flatten them.
  it('returns the caller’s own objects, not a narrowed copy', () => {
    const map = activeByOpening(
      [{ ...ALAPIN, name: 'My Alapin' }],
      [{ opening_id: 'alapin-white', repertoire_id: 'rep-alapin' }],
      TAXONOMY
    );

    expect(map.get('alapin-white')?.name).toBe('My Alapin');
  });
});

describe('REPERTOIRE_OPENING_COLUMNS', () => {
  // The silent failure this guards: drop eco_code from a select and every
  // opening resolves to null, so the whole control vanishes with no error.
  it('names every column resolveOpening reads', () => {
    expect(REPERTOIRE_OPENING_COLUMNS.split(', ').sort()).toEqual(['color', 'eco_code', 'id', 'opening_id']);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/openings/active.test.ts`
Expected: FAIL — `Failed to resolve import "./active"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/openings/active.ts`:

```ts
// mychess/src/lib/openings/active.ts
//
// Which repertoire is a student's current preparation for an opening (GitHub
// issue #202, part B of epic #119). Pure — the Supabase side is
// src/lib/server/active-openings.ts.
import { resolveOpening } from './resolve';
import { CURATED_OPENINGS, type CuratedOpening, type OpeningSide } from './taxonomy';

/** One row of `active_opening_repertoires`, as far as this layer cares. */
export type ActiveOpeningRow = { opening_id: string; repertoire_id: string };

/** The repertoire columns `resolveOpening` reads, plus the id to match rows on. */
export type ResolvableRepertoire = {
  id: string;
  eco_code: string | null;
  color: OpeningSide | null;
  opening_id: string | null;
};

// Derived from the type rather than typed out beside it: adding a field to
// ResolvableRepertoire without adding it here is a compile error, so a select
// can never silently omit a column resolveOpening needs.
const REQUIRED_COLUMNS: Record<keyof ResolvableRepertoire, true> = {
  id: true,
  eco_code: true,
  color: true,
  opening_id: true
};

/** PostgREST select list for a repertoire this layer must resolve. */
export const REPERTOIRE_OPENING_COLUMNS = Object.keys(REQUIRED_COLUMNS).join(', ');

/**
 * Has this stored choice stopped matching its repertoire?
 *
 * The taxonomy is hand-edited, so a row written when repertoire R resolved to
 * one opening keeps naming that opening after an edit moves R elsewhere. A
 * stale row is ignored at read time and NOT deleted — same rule part A applies
 * to an override naming a since-deleted entry, and a reverted taxonomy edit
 * then simply works again instead of having destroyed data on the way through.
 *
 * An unreadable repertoire (`undefined`) counts as stale: a coach cannot read a
 * repertoire their student uploaded, so the embed comes back null, and
 * unverifiable must not read as confirmed.
 */
export function isActiveRowStale(
  row: ActiveOpeningRow,
  repertoire: ResolvableRepertoire | undefined,
  taxonomy: CuratedOpening[] = CURATED_OPENINGS
): boolean {
  if (!repertoire) return true;
  return resolveOpening(repertoire, taxonomy)?.id !== row.opening_id;
}

/** The student's active repertoire per opening, stale rows dropped. */
export function activeByOpening<T extends ResolvableRepertoire>(
  repertoires: T[],
  rows: ActiveOpeningRow[],
  taxonomy: CuratedOpening[] = CURATED_OPENINGS
): Map<string, T> {
  const byId = new Map(repertoires.map((repertoire) => [repertoire.id, repertoire]));
  const active = new Map<string, T>();
  for (const row of rows) {
    const repertoire = byId.get(row.repertoire_id);
    if (!repertoire || isActiveRowStale(row, repertoire, taxonomy)) continue;
    active.set(row.opening_id, repertoire);
  }
  return active;
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run src/lib/openings/active.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/openings/active.ts src/lib/openings/active.test.ts
git commit -m "feat(openings): staleness rule and active-by-opening map (GitHub issue #202)"
```

---

### Task 3: The Supabase layer

**Files:**
- Create: `src/lib/server/active-openings.ts`

Per this repo's convention, `src/lib/server/*` wrappers are not unit-tested directly — the logic they wrap is already covered by Task 2, and the query itself is exercised through Task 5's page and verified against production.

The spec calls these three functions `setActive`, `activateIfUnset` and `loadActive`; they are exported as `setActiveOpening`, `activateOpeningIfUnset` and `loadActiveOpenings` so they read unambiguously at call sites, one of which already has an action named `setActive`. Use the names below.

- [ ] **Step 1: Write it**

Create `src/lib/server/active-openings.ts`:

```ts
// mychess/src/lib/server/active-openings.ts
//
// Reading and writing `active_opening_repertoires` (GitHub issue #202). The
// derivation lives in src/lib/openings/active.ts; this file is the I/O.
import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveOpening } from '$lib/openings/resolve';
import {
  activeByOpening,
  REPERTOIRE_OPENING_COLUMNS,
  type ActiveOpeningRow,
  type ResolvableRepertoire
} from '$lib/openings/active';

type ActivationParams = { playerId: string; repertoireId: string; setBy: string };
type ActivationResult = { error: string | null };

/**
 * Which opening a repertoire prepares is resolved HERE, in application code,
 * and never in SQL. `repertoires.opening_id` holds only a coach's explicit
 * override and is null on almost every row, so a `where opening_id = ...`
 * would silently miss the majority (see the note on issue #202).
 */
async function writeActive(
  supabase: SupabaseClient,
  params: ActivationParams,
  ignoreDuplicates: boolean
): Promise<ActivationResult> {
  const { data: repertoire } = await supabase
    .from('repertoires')
    .select(REPERTOIRE_OPENING_COLUMNS)
    .eq('id', params.repertoireId)
    .maybeSingle();
  if (!repertoire) return { error: 'Repertoire not found' };

  const opening = resolveOpening(repertoire as unknown as ResolvableRepertoire);
  if (!opening) return { error: 'That repertoire has no curated opening' };

  const { error } = await supabase.from('active_opening_repertoires').upsert(
    {
      player_id: params.playerId,
      opening_id: opening.id,
      repertoire_id: params.repertoireId,
      set_by: params.setBy,
      updated_at: new Date().toISOString()
    },
    // Explicit, per this project's upsert rule: a bare upsert targets the
    // primary key, which happens to be these columns today but would stop
    // being true the moment the key changes.
    { onConflict: 'player_id,opening_id', ignoreDuplicates }
  );

  return { error: error?.message ?? null };
}

/** Make this repertoire the student's active preparation, displacing any other. */
export function setActiveOpening(supabase: SupabaseClient, params: ActivationParams): Promise<ActivationResult> {
  return writeActive(supabase, params, false);
}

/**
 * Make it active only if that opening has no active repertoire yet.
 *
 * "Does not displace an existing choice" is `ignoreDuplicates`, i.e. a database
 * no-op, rather than a read-then-write that two coaches could race.
 */
export function activateOpeningIfUnset(
  supabase: SupabaseClient,
  params: ActivationParams
): Promise<ActivationResult> {
  return writeActive(supabase, params, true);
}

/**
 * The student's active repertoire per opening. Rows whose repertoire the caller
 * cannot read come back with a null embed and are dropped as stale, which is
 * what a coach sees for a repertoire their student uploaded themselves.
 */
export async function loadActiveOpenings(
  supabase: SupabaseClient,
  playerId: string
): Promise<Map<string, ResolvableRepertoire>> {
  const { data } = await supabase
    .from('active_opening_repertoires')
    .select(`opening_id, repertoire_id, repertoire:repertoire_id(${REPERTOIRE_OPENING_COLUMNS})`)
    .eq('player_id', playerId);

  const rows = (data ?? []) as unknown as (ActiveOpeningRow & { repertoire: ResolvableRepertoire | null })[];
  return activeByOpening(
    rows.map((row) => row.repertoire).filter((repertoire): repertoire is ResolvableRepertoire => !!repertoire),
    rows.map((row) => ({ opening_id: row.opening_id, repertoire_id: row.repertoire_id }))
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npm run check`
Expected: 0 errors. (Warnings from unrelated files are fine; errors are not.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/server/active-openings.ts
git commit -m "feat(openings): read and write the active opening mapping (GitHub issue #202)"
```

---

### Task 4: A new repertoire auto-activates for its owner

**Files:**
- Modify: `src/lib/server/pgn-import.ts` (the `isNewRepertoire` branch of `writeMoves`, around line 138)

`writeMoves` is the single place a `repertoires` row is created — a multi-chapter import calls it once per chapter but only the first call takes this branch, and `eco_code` is written at insert and never changed afterwards, so the opening is resolvable right here.

- [ ] **Step 1: Add the import**

At the top of `src/lib/server/pgn-import.ts`, alongside the existing imports, add:

```ts
import { activateOpeningIfUnset } from './active-openings';
```

- [ ] **Step 2: Activate after the insert**

Find this in `writeMoves`:

```ts
    const { data: rep, error: repErr } = await supabase.from('repertoires').insert(insertColumns).select().single();
    if (repErr) return { repertoireId: null, error: repErr.message };
    repId = rep.id;
  }
```

Replace it with:

```ts
    const { data: rep, error: repErr } = await supabase.from('repertoires').insert(insertColumns).select().single();
    if (repErr) return { repertoireId: null, error: repErr.message };
    repId = rep.id;

    // The first repertoire an owner has for an opening becomes their active
    // preparation for it (GitHub issue #202); a later one never displaces it.
    // Deliberately non-fatal: the repertoire row is already written, and
    // failing the whole import over a mapping would be a far worse outcome
    // than an opening nobody has marked yet.
    const activation = await activateOpeningIfUnset(supabase, {
      playerId: params.playerId,
      repertoireId: repId,
      setBy: params.playerId
    });
    if (activation.error) {
      console.error(`Failed to set the active opening for repertoire ${repId}:`, activation.error);
    }
  }
```

- [ ] **Step 3: Check nothing regressed**

Run: `npm test`
Expected: PASS. The import tests stub Supabase, so an unknown table is a no-op error that this code logs and moves past.

- [ ] **Step 4: Commit**

```bash
git add src/lib/server/pgn-import.ts
git commit -m "feat(openings): a new repertoire becomes its owner's active prep (GitHub issue #202)"
```

---

### Task 5: The coach's control

**Files:**
- Modify: `src/routes/(coach)/coach/players/[player_id]/+page.server.ts`
- Modify: `src/routes/(coach)/coach/players/[player_id]/+page.svelte:79-85`
- Modify: `messages/en.json`, `messages/lt.json`
- Test: `src/routes/(coach)/coach/players/[player_id]/player.test.ts`

- [ ] **Step 1: Add the two messages**

In `messages/en.json`, next to the other `coach_player_*` keys:

```json
	"coach_player_opening_active": "Active",
	"coach_player_opening_make_active": "Make active",
```

In `messages/lt.json`, at the matching place:

```json
	"coach_player_opening_active": "Aktyvus",
	"coach_player_opening_make_active": "Nustatyti aktyviu",
```

Do not run `paraglide-js compile` by hand — bare invocation writes to the wrong directory and strategy. `npm test` and `npm run check` regenerate `src/lib/paraglide/` correctly through the Vite plugin.

- [ ] **Step 2: Load the active set**

In `src/routes/(coach)/coach/players/[player_id]/+page.server.ts`, add to the imports:

```ts
import { activateOpeningIfUnset, loadActiveOpenings, setActiveOpening } from '$lib/server/active-openings';
import { REPERTOIRE_OPENING_COLUMNS } from '$lib/openings/active';
```

Change the destructuring and the last two entries of the `Promise.all`:

```ts
  const [playerRes, statsRes, notesRes, coachRepsRes, assignedRes, activeOpenings] = await Promise.all([
    supabase.from('profiles').select('id, display_name').eq('id', params.player_id).single(),
    supabase.from('player_stats').select('*').eq('player_id', params.player_id).single(),
    supabase.from('coach_notes').select('id, note, created_at').eq('player_id', params.player_id).order('created_at', { ascending: false }).limit(5),
    supabase.from('repertoires').select('id, name, color').eq('player_id', user.id),
    supabase
      .from('assigned_repertoires')
      .select(`id, repertoire:repertoire_id(name, ${REPERTOIRE_OPENING_COLUMNS})`)
      .eq('coach_id', user.id)
      .eq('player_id', params.player_id),
    loadActiveOpenings(supabase, params.player_id)
  ]);
```

Then add one field to the returned object, beside `assignedReps`:

```ts
    activeRepertoireIds: [...activeOpenings.values()].map((repertoire) => repertoire.id),
```

- [ ] **Step 3: Auto-activate on assignment**

In the same file's `assignRep` action, find the upsert and its error check:

```ts
    const { error } = await supabase
      .from('assigned_repertoires')
      .upsert(
        { player_id: params.player_id, coach_id: user.id, repertoire_id: repId },
        { onConflict: 'player_id,repertoire_id' }
      );

    if (error) return fail(500, { error: error.message });
    return { success: true };
```

Replace it with:

```ts
    const { error } = await supabase
      .from('assigned_repertoires')
      .upsert(
        { player_id: params.player_id, coach_id: user.id, repertoire_id: repId },
        { onConflict: 'player_id,repertoire_id' }
      );

    if (error) return fail(500, { error: error.message });

    // The first repertoire a student has for an opening becomes their active
    // preparation for it (GitHub issue #202); a later one never displaces it,
    // so a coach holding one student on last season's file keeps them there.
    // Non-fatal for the same reason as the import path: the assignment itself
    // succeeded, and failing it over the mapping would be the worse outcome.
    const activation = await activateOpeningIfUnset(supabase, {
      playerId: params.player_id,
      repertoireId: repId,
      setBy: user.id
    });
    if (activation.error) {
      console.error(`Failed to set the active opening for repertoire ${repId}:`, activation.error);
    }

    return { success: true };
```

- [ ] **Step 4: Add the action**

Add to the `actions` object in the same file, after `unassignRep`:

```ts
  setActive: async ({ params, request, locals: { supabase, safeGetSession } }) => {
    const { user } = await safeGetSession();
    if (!user) return fail(401, { error: 'Unauthorized' });

    const fd = await request.formData();
    const repId = fd.get('rep_id') as string;
    if (!repId) return fail(400, { error: 'No repertoire selected' });

    // A repertoire resolving to no curated opening has nothing to be active
    // for, and RLS independently refuses a repertoire this student cannot see.
    const { error } = await setActiveOpening(supabase, {
      playerId: params.player_id,
      repertoireId: repId,
      setBy: user.id
    });
    if (error) return fail(400, { error });
    return { success: true };
  },
```

- [ ] **Step 5: Render the control**

In `src/routes/(coach)/coach/players/[player_id]/+page.svelte`, add to the imports in `<script>`:

```ts
  import { resolveOpening, curatedOpeningName } from '$lib/openings/resolve';
  import { getLocale } from '$lib/paraglide/runtime';
```

Replace the assigned-repertoire list item (currently lines 79-85):

```svelte
          {#each data.assignedReps as a (a.id)}
            <li class="flex items-center gap-3 bg-(--color-bg) rounded-lg p-3">
              <span class="w-3 h-3 rounded-full shrink-0"
                    style="background:{a.repertoire?.color === 'black' ? '#1f2937' : '#e5e7eb'}"></span>
              <span class="text-sm text-(--color-text)">{a.repertoire?.name}</span>
            </li>
          {/each}
```

with:

```svelte
          {#each data.assignedReps as a (a.id)}
            {@const opening = a.repertoire ? resolveOpening(a.repertoire) : null}
            {@const isActive = !!a.repertoire && data.activeRepertoireIds.includes(a.repertoire.id)}
            <li class="flex items-center gap-3 bg-(--color-bg) rounded-lg p-3">
              <span class="w-3 h-3 rounded-full shrink-0"
                    style="background:{a.repertoire?.color === 'black' ? '#1f2937' : '#e5e7eb'}"></span>
              <span class="text-sm text-(--color-text)">{a.repertoire?.name}</span>
              {#if opening}
                <span class="text-xs text-(--color-muted)">{curatedOpeningName(opening, getLocale())}</span>
                {#if isActive}
                  <span
                    class="ml-auto text-[0.65rem] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full border border-[#6FCF73]/40 bg-[#6FCF73]/10 text-[#4b9e50] dark:text-[#6FCF73]"
                    >{m.coach_player_opening_active()}</span
                  >
                {:else}
                  <form method="POST" action="?/setActive" use:enhance class="ml-auto">
                    <input type="hidden" name="rep_id" value={a.repertoire.id} />
                    <button type="submit" class="text-xs text-(--color-accent) hover:underline"
                      >{m.coach_player_opening_make_active()}</button
                    >
                  </form>
                {/if}
              {/if}
            </li>
          {/each}
```

A repertoire that resolves to no curated opening gets neither the name nor the button — never a control whose action would fail. The list is deliberately not regrouped by opening; #203 designs that view.

- [ ] **Step 6: Write the component test**

Create `src/routes/(coach)/coach/players/[player_id]/player.test.ts`:

```ts
// mychess/src/routes/(coach)/coach/players/[player_id]/player.test.ts
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import Page from './+page.svelte';

afterEach(cleanup);

// B22 + white resolves to the curated Alapin entry; C60 (Ruy Lopez) is not in
// the taxonomy, so it stands for a repertoire with no curated opening.
const ALAPIN = { id: 'rep-alapin', name: 'Alapin 2025', color: 'white', eco_code: 'B22', opening_id: null };
const OLD_ALAPIN = { id: 'rep-alapin-old', name: 'Alapin 2024', color: 'white', eco_code: 'B22', opening_id: null };
const UNCLASSIFIED = { id: 'rep-ruy', name: 'Ruy Lopez notes', color: 'white', eco_code: 'C60', opening_id: null };

function renderPage(assigned: unknown[], activeRepertoireIds: string[]) {
  render(Page, {
    props: {
      data: {
        player: { id: 'p1', display_name: 'Student' },
        stats: null,
        notes: [],
        coachReps: [],
        assignedReps: assigned.map((repertoire, i) => ({ id: `a${i}`, repertoire })),
        practiceReports: [],
        activeRepertoireIds,
        range: '30d',
        playerId: 'p1'
      },
      form: null
    }
  });
}

describe('the active-opening control', () => {
  it('marks the active repertoire and offers the other one', () => {
    renderPage([ALAPIN, OLD_ALAPIN], ['rep-alapin']);

    expect(screen.getByText('Active')).toBeTruthy();
    expect(screen.getAllByText('Make active')).toHaveLength(1);
  });

  it('shows the resolved opening name beside the repertoire', () => {
    renderPage([ALAPIN], ['rep-alapin']);

    expect(screen.getByText('Anti-Sicilian: Alapin')).toBeTruthy();
  });

  // Otherwise the coach gets a button whose action can only fail.
  it('offers nothing for a repertoire with no curated opening', () => {
    renderPage([UNCLASSIFIED], []);

    expect(screen.queryByText('Make active')).toBeNull();
    expect(screen.queryByText('Active')).toBeNull();
  });
});
```

- [ ] **Step 7: Run it**

Run: `npx vitest run "src/routes/(coach)/coach/players/[player_id]/player.test.ts"`
Expected: PASS, 3 tests. If `Anti-Sicilian: Alapin` does not match, read the current display name out of `src/lib/openings/taxonomy.ts` and use that string — the taxonomy is hand-edited and may have moved on.

- [ ] **Step 8: Commit**

```bash
git add "src/routes/(coach)/coach/players/[player_id]" messages/en.json messages/lt.json
git commit -m "feat(openings): let a coach mark a student's active repertoire (GitHub issue #202)"
```

---

### Task 6: Backfill what already exists

**Files:**
- Create: `scripts/backfill-active-openings.ts`
- Modify: `package.json` (one script entry)

Without this, #203's "no active preparation for this opening" means "nobody has tagged this yet" for every pre-existing student — the wrong answer to the question that view exists to ask.

- [ ] **Step 1: Write the script**

Create `scripts/backfill-active-openings.ts`:

```ts
// mychess/scripts/backfill-active-openings.ts
//
// One-off (GitHub issue #202): applies the auto-activation rule retroactively —
// the OLDEST repertoire a player can see for a curated opening becomes their
// active preparation for it, unless they already have one.
//
// Ordering is explicit (assigned_at for assignments, created_at for a player's
// own uploads, both ascending) so the result does not depend on the order
// PostgREST happens to return rows in.
//
// Reads the taxonomy through the REAL resolveOpening via a relative import —
// `$lib` aliases do not resolve outside SvelteKit's Vite context, and its only
// non-relative import is `import type`, which tsx erases.
//
// Dry run by default; pass --apply to write.
//
//   npm run openings:backfill-active
//   npm run openings:backfill-active -- --apply
import { resolveOpening } from '../src/lib/openings/resolve';
import type { ResolvableRepertoire } from '../src/lib/openings/active';

const SUPABASE_URL = process.env.PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
	console.error('PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (run via npm run openings:backfill-active).');
	process.exit(1);
}

const apply = process.argv.includes('--apply');
const headers = { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` };

// PostgREST caps an unbounded select at max_rows (1000 here) and truncates
// SILENTLY, so every read pages explicitly rather than trusting one call.
const PAGE = 1000;

async function fetchAll<T>(path: string): Promise<T[]> {
	const out: T[] = [];
	for (let offset = 0; ; offset += PAGE) {
		const url = `${SUPABASE_URL}${path}&limit=${PAGE}&offset=${offset}`;
		const res = await fetch(url, { headers });
		if (!res.ok) throw new Error(`${path} -> ${res.status}: ${await res.text()}`);
		const page = (await res.json()) as T[];
		out.push(...page);
		if (page.length < PAGE) return out;
	}
}

type RepertoireRow = ResolvableRepertoire & { player_id: string; created_at: string };
type AssignmentRow = { player_id: string; repertoire_id: string; assigned_at: string };
type ActiveRow = { player_id: string; opening_id: string };

const repertoires = await fetchAll<RepertoireRow>(
	'/rest/v1/repertoires?select=id,player_id,eco_code,color,opening_id,created_at'
);
const assignments = await fetchAll<AssignmentRow>(
	'/rest/v1/assigned_repertoires?select=player_id,repertoire_id,assigned_at'
);
const existing = await fetchAll<ActiveRow>('/rest/v1/active_opening_repertoires?select=player_id,opening_id');

const repertoireById = new Map(repertoires.map((r) => [r.id, r]));

// Every (player, repertoire) pair the player can see, with the timestamp that
// decides which is oldest.
const candidates = [
	...repertoires.map((r) => ({ playerId: r.player_id, repertoireId: r.id, at: r.created_at })),
	...assignments.map((a) => ({ playerId: a.player_id, repertoireId: a.repertoire_id, at: a.assigned_at }))
].sort((a, b) => a.at.localeCompare(b.at));

const taken = new Set(existing.map((row) => `${row.player_id}::${row.opening_id}`));
const toWrite: { player_id: string; opening_id: string; repertoire_id: string }[] = [];

for (const candidate of candidates) {
	const repertoire = repertoireById.get(candidate.repertoireId);
	if (!repertoire) continue;
	const opening = resolveOpening(repertoire);
	if (!opening) continue;
	const key = `${candidate.playerId}::${opening.id}`;
	if (taken.has(key)) continue;
	taken.add(key);
	// set_by is left null on purpose: the backfill is not a person's choice.
	toWrite.push({ player_id: candidate.playerId, opening_id: opening.id, repertoire_id: candidate.repertoireId });
}

console.log(`${repertoires.length} repertoires, ${assignments.length} assignments, ${existing.length} already mapped.`);
console.log(`${toWrite.length} mappings to create.`);

if (!apply) {
	console.log('Dry run — pass --apply to write them.');
	process.exit(0);
}

for (let i = 0; i < toWrite.length; i += 500) {
	const chunk = toWrite.slice(i, i + 500);
	const res = await fetch(`${SUPABASE_URL}/rest/v1/active_opening_repertoires`, {
		method: 'POST',
		headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates' },
		body: JSON.stringify(chunk)
	});
	if (!res.ok) throw new Error(`insert -> ${res.status}: ${await res.text()}`);
	console.log(`wrote ${Math.min(i + chunk.length, toWrite.length)}/${toWrite.length}`);
}

console.log('Done.');
```

- [ ] **Step 2: Add the npm script**

In `package.json`, after the `"schema:check"` entry:

```json
		"openings:backfill-active": "tsx --env-file=.env scripts/backfill-active-openings.ts",
```

- [ ] **Step 3: Type-check the script**

Run: `npm run check`
Expected: 0 errors. (`check` runs `tsc -p tsconfig.scripts.json`, which covers `scripts/`.)

- [ ] **Step 4: Commit**

```bash
git add scripts/backfill-active-openings.ts package.json
git commit -m "feat(openings): backfill script for existing repertoires (GitHub issue #202)"
```

- [ ] **Step 5: Run it, once the migration is applied**

If the user has confirmed migration 0079 is live:

```bash
npm run openings:backfill-active
```

Report the dry-run counts, then run it again with `-- --apply` and report what was written. If the migration is not applied yet, say so and stop here — the script will 404 on a table that does not exist.

---

### Task 7: Gate, push, PR

- [ ] **Step 1: Run the full gate**

```bash
npm test
npm run check
npm run lint
```

Expected: tests pass, `check` reports 0 errors, `lint` reports 0 errors. Warnings are not errors and are not a baseline to clear. Fix anything red before continuing — do not weaken a test to get green.

- [ ] **Step 2: Push**

```bash
git push
```

- [ ] **Step 3: Open the PR**

```bash
gh pr create --title "Per-student active repertoire mapping (#202)" --body "..."
```

The body must reference `#202` **without** a closing keyword, and must say that migration `0079_active_opening_repertoires.sql` has to be applied in the Supabase dashboard before the feature works, and that `npm run openings:backfill-active -- --apply` should be run afterwards. #105 is why: a closing keyword on work with an unapplied migration behind it auto-closed an issue whose feature did not work.

End the body with:

```
🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

- [ ] **Step 4: Verify against production, after the migration lands**

Once the user confirms 0079 is applied, check the constraint actually holds — with the service-role key, insert two rows with the same `(player_id, opening_id)` and confirm the second is rejected by the primary key, then delete the test rows. Report the result. Do not claim the acceptance criteria are met before this.
