# Name Fields + FIDE Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add First Name / Last Name fields to the kid settings page and validate them against fide.com when a FIDE ID is entered.

**Architecture:** New DB migration adds `first_name`/`last_name` to `profiles`. A server-only helper scrapes the FIDE profile page using `cheerio` (already installed). The settings server action validates names against FIDE before saving.

**Tech Stack:** SvelteKit (server actions), Supabase, cheerio (HTML parsing), Vitest (unit tests).

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `mychess/supabase/migrations/0012_name_fields.sql` | Create | Add `first_name`, `last_name` columns to `profiles` |
| `mychess/src/lib/server/fide.ts` | Create | Fetch + parse FIDE profile page, return name |
| `mychess/src/lib/server/fide.test.ts` | Create | Vitest unit tests for the FIDE helper |
| `mychess/src/routes/(kid)/settings/+page.server.ts` | Modify | Load + save `first_name`/`last_name`; validate against FIDE |
| `mychess/src/routes/(kid)/settings/+page.svelte` | Modify | Add First Name and Last Name inputs |

---

### Task 1: DB Migration

**Files:**
- Create: `mychess/supabase/migrations/0012_name_fields.sql`

- [ ] **Step 1: Create migration file**

```sql
-- mychess/supabase/migrations/0012_name_fields.sql
alter table profiles add column if not exists first_name text;
alter table profiles add column if not exists last_name  text;
```

- [ ] **Step 2: Commit**

```bash
cd mychess
git add supabase/migrations/0012_name_fields.sql
git commit -m "feat: add first_name and last_name to profiles"
```

---

### Task 2: FIDE Scrape Helper — Tests First

**Files:**
- Create: `mychess/src/lib/server/fide.test.ts`
- Create: `mychess/src/lib/server/fide.ts`

- [ ] **Step 1: Write failing tests**

Create `mychess/src/lib/server/fide.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchFideName } from './fide';

const VALID_HTML = `
<html><body>
  <h1 class="player-title">Carlsen, Magnus</h1>
</body></html>
`;

const MULTI_WORD_SURNAME_HTML = `
<html><body>
  <h1 class="player-title">Van Foreest, Jorden</h1>
</body></html>
`;

const MISSING_TITLE_HTML = `<html><body><h1>Nothing here</h1></body></html>`;

function mockFetch(html: string, status = 200) {
  return vi.spyOn(global, 'fetch').mockResolvedValue(
    new Response(html, { status })
  );
}

describe('fetchFideName', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns firstName and lastName for a valid profile', async () => {
    mockFetch(VALID_HTML);
    const result = await fetchFideName('1503014');
    expect(result).toEqual({ firstName: 'Magnus', lastName: 'Carlsen' });
  });

  it('handles multi-word surnames', async () => {
    mockFetch(MULTI_WORD_SURNAME_HTML);
    const result = await fetchFideName('24116068');
    expect(result).toEqual({ firstName: 'Jorden', lastName: 'Van Foreest' });
  });

  it('returns null when FIDE page has no player-title h1', async () => {
    mockFetch(MISSING_TITLE_HTML);
    const result = await fetchFideName('9999999');
    expect(result).toBeNull();
  });

  it('returns null on non-200 response', async () => {
    mockFetch('', 404);
    const result = await fetchFideName('0');
    expect(result).toBeNull();
  });

  it('returns null when fetch throws', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('Network error'));
    const result = await fetchFideName('1503014');
    expect(result).toBeNull();
  });

  it('fetches the correct FIDE URL', async () => {
    const spy = mockFetch(VALID_HTML);
    await fetchFideName('1503014');
    expect(spy).toHaveBeenCalledWith(
      'https://ratings.fide.com/profile/1503014',
      expect.objectContaining({ headers: expect.any(Object) })
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd mychess
npm test -- --reporter=verbose 2>&1 | grep -E "FAIL|PASS|fide|Error"
```

Expected: FAIL — `Cannot find module './fide'`

- [ ] **Step 3: Create the FIDE helper**

Create `mychess/src/lib/server/fide.ts`:

```ts
import * as cheerio from 'cheerio';

export async function fetchFideName(
  fideId: string
): Promise<{ firstName: string; lastName: string } | null> {
  try {
    const res = await fetch(`https://ratings.fide.com/profile/${fideId}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    if (!res.ok) return null;

    const html = await res.text();
    const $ = cheerio.load(html);
    const title = $('h1.player-title').first().text().trim();
    if (!title) return null;

    // FIDE format: "Surname, Firstname"
    const commaIdx = title.indexOf(', ');
    if (commaIdx === -1) return null;

    const lastName = title.slice(0, commaIdx).trim();
    const firstName = title.slice(commaIdx + 2).trim();
    if (!lastName || !firstName) return null;

    return { firstName, lastName };
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd mychess
npm test -- --reporter=verbose 2>&1 | grep -E "FAIL|PASS|✓|✗|fide"
```

Expected: All 6 fide tests PASS.

- [ ] **Step 5: Run type-check**

```bash
cd mychess
npm run check 2>&1 | tail -5
```

Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
cd mychess
git add src/lib/server/fide.ts src/lib/server/fide.test.ts
git commit -m "feat: add FIDE profile scrape helper with tests"
```

---

### Task 3: Update Settings Server Action

**Files:**
- Modify: `mychess/src/routes/(kid)/settings/+page.server.ts`

- [ ] **Step 1: Replace file contents**

Replace the entire file `mychess/src/routes/(kid)/settings/+page.server.ts` with:

```ts
import { redirect, fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { fetchFideName } from '$lib/server/fide';

export const load: PageServerLoad = async ({ locals: { supabase, safeGetSession } }) => {
  const { user, session, profile } = await safeGetSession();
  if (!user) throw redirect(303, '/login');

  const { data: p } = await supabase
    .from('profiles')
    .select('display_name, first_name, last_name, chesscom_username, lichess_username, fide_id')
    .eq('id', user.id)
    .single();

  return {
    session,
    profile,
    displayName: p?.display_name ?? '',
    firstName: (p as any)?.first_name ?? '',
    lastName: (p as any)?.last_name ?? '',
    chesscomUsername: (p as any)?.chesscom_username ?? '',
    lichessUsername: (p as any)?.lichess_username ?? '',
    fideId: (p as any)?.fide_id ?? ''
  };
};

export const actions: Actions = {
  save: async ({ request, locals: { supabase, safeGetSession } }) => {
    const { user } = await safeGetSession();
    if (!user) return fail(401, { error: 'Unauthorized' });

    const fd = await request.formData();
    const firstName = (fd.get('first_name') as string ?? '').trim();
    const lastName = (fd.get('last_name') as string ?? '').trim();
    const fideId = (fd.get('fide_id') as string ?? '').trim();
    const chesscomUsername = (fd.get('chesscom_username') as string ?? '').trim();
    const lichessUsername = (fd.get('lichess_username') as string ?? '').trim();

    if (fideId) {
      if (!firstName || !lastName) {
        return fail(400, { error: 'First and last name are required when a FIDE ID is set.' });
      }

      const fideName = await fetchFideName(fideId);
      if (!fideName) {
        return fail(400, { error: 'Could not look up FIDE profile. Check your FIDE ID.' });
      }

      const normalize = (s: string) => s.trim().toLowerCase();
      if (
        normalize(firstName) !== normalize(fideName.firstName) ||
        normalize(lastName) !== normalize(fideName.lastName)
      ) {
        return fail(400, {
          error: `Name does not match FIDE profile. Expected: ${fideName.firstName} ${fideName.lastName}.`
        });
      }
    }

    const { error } = await supabase
      .from('profiles')
      .update({
        first_name: firstName || null,
        last_name: lastName || null,
        chesscom_username: chesscomUsername || null,
        lichess_username: lichessUsername || null,
        fide_id: fideId || null
      } as any)
      .eq('id', user.id);

    if (error) return fail(500, { error: error.message });
    return { success: true };
  }
};
```

- [ ] **Step 2: Run type-check**

```bash
cd mychess
npm run check 2>&1 | tail -10
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
cd mychess
git add src/routes/\(kid\)/settings/+page.server.ts
git commit -m "feat: validate name against FIDE profile on save"
```

---

### Task 4: Update Settings UI

**Files:**
- Modify: `mychess/src/routes/(kid)/settings/+page.svelte`

- [ ] **Step 1: Replace file contents**

Replace the entire file `mychess/src/routes/(kid)/settings/+page.svelte` with:

```svelte
<script lang="ts">
  import { enhance } from '$app/forms';

  let { data, form } = $props<{ data: any; form: any }>();

  const d = $derived(data as any);
  let importing = $state<'chesscom' | 'lichess' | null>(null);
  let importResult = $state<string | null>(null);

  async function importGames(platform: 'chesscom' | 'lichess') {
    importing = platform;
    importResult = null;
    try {
      const res = await fetch(`/api/import/${platform}`, { method: 'POST' });
      const body = await res.json();
      if (body.count !== undefined) {
        importResult = `Imported ${body.count} game(s) as a new repertoire.`;
      } else {
        importResult = body.error ?? 'Import failed';
      }
    } catch {
      importResult = 'Network error';
    } finally {
      importing = null;
    }
  }
</script>

<svelte:head>
  <title>Settings — MyChess</title>
</svelte:head>

<div class="min-h-screen bg-gray-50">
  <div class="max-w-2xl mx-auto px-4 py-6 space-y-5">
    <h1 class="text-2xl font-bold text-gray-900">Settings</h1>

    {#if form?.success}
      <p class="text-green-700 bg-green-50 border border-green-200 rounded-lg px-4 py-2 text-sm">
        Saved successfully.
      </p>
    {/if}
    {#if form?.error}
      <p class="text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-sm">
        {form.error}
      </p>
    {/if}

    <section class="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
      <h2 class="font-semibold text-gray-900 mb-4">Connected accounts</h2>
      <form method="POST" action="?/save" use:enhance class="space-y-4">

        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1" for="first_name">First Name</label>
            <input
              id="first_name"
              name="first_name"
              type="text"
              value={d.firstName}
              placeholder="e.g. Magnus"
              class="w-full bg-white border border-gray-300 rounded-lg px-4 py-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1" for="last_name">Last Name</label>
            <input
              id="last_name"
              name="last_name"
              type="text"
              value={d.lastName}
              placeholder="e.g. Carlsen"
              class="w-full bg-white border border-gray-300 rounded-lg px-4 py-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1" for="fide_id">FIDE ID</label>
          <input
            id="fide_id"
            name="fide_id"
            type="text"
            value={d.fideId}
            placeholder="e.g. 1503014"
            class="w-full bg-white border border-gray-300 rounded-lg px-4 py-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          />
          <p class="text-xs text-gray-400 mt-1">
            Your FIDE ID number (find it at ratings.fide.com). First and last name must match your FIDE profile.
          </p>
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1" for="chesscom">Chess.com username</label>
          <input
            id="chesscom"
            name="chesscom_username"
            type="text"
            value={d.chesscomUsername}
            placeholder="e.g. MagnusCarlsen"
            class="w-full bg-white border border-gray-300 rounded-lg px-4 py-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          />
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1" for="lichess">Lichess username</label>
          <input
            id="lichess"
            name="lichess_username"
            type="text"
            value={d.lichessUsername}
            placeholder="e.g. DrNykterstein"
            class="w-full bg-white border border-gray-300 rounded-lg px-4 py-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          />
        </div>

        <button
          type="submit"
          class="bg-indigo-600 text-white px-5 py-2.5 rounded-lg font-medium hover:bg-indigo-700 transition-colors">
          Save
        </button>
      </form>
    </section>

    <section class="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
      <h2 class="font-semibold text-gray-900 mb-4">Import games</h2>
      <p class="text-sm text-gray-500 mb-4">
        Import your recent games as a new repertoire. Connect your platform usernames above first.
      </p>

      {#if importResult}
        <p class="text-sm text-gray-700 bg-gray-50 border border-gray-200 rounded-lg px-4 py-2 mb-4">
          {importResult}
        </p>
      {/if}

      <div class="flex gap-3">
        <button
          onclick={() => importGames('chesscom')}
          disabled={importing !== null}
          class="flex-1 border border-gray-300 text-gray-700 px-4 py-2.5 rounded-lg font-medium hover:bg-gray-50 disabled:opacity-50 transition-colors text-sm">
          {importing === 'chesscom' ? 'Importing…' : 'Import from Chess.com'}
        </button>
        <button
          onclick={() => importGames('lichess')}
          disabled={importing !== null}
          class="flex-1 border border-gray-300 text-gray-700 px-4 py-2.5 rounded-lg font-medium hover:bg-gray-50 disabled:opacity-50 transition-colors text-sm">
          {importing === 'lichess' ? 'Importing…' : 'Import from Lichess'}
        </button>
      </div>
    </section>
  </div>
</div>
```

- [ ] **Step 2: Run type-check and tests**

```bash
cd mychess
npm run check 2>&1 | tail -5 && npm test 2>&1 | tail -10
```

Expected: 0 type errors, all tests PASS.

- [ ] **Step 3: Commit**

```bash
cd mychess
git add src/routes/\(kid\)/settings/+page.svelte
git commit -m "feat: add first/last name fields to settings UI"
```
