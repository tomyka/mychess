# Opening Taxonomy + Auto-Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every repertoire a curated opening — derived from its ECO code and colour, overridable by its owner — and show that instead of the filename.

**Architecture:** A hand-authored taxonomy module holds one entry per `(opening, side)`, each owning explicit ECO codes. `resolveOpening` is the single accessor: it returns a stored override if present, otherwise derives from `(eco_code, color)`. A new picker writes the override; both repertoire lists render the resolved name in place of the ECO line, falling back to the ECO line when nothing resolves.

**Tech Stack:** TypeScript, SvelteKit 2 / Svelte 5 runes, vitest + @testing-library/svelte, Paraglide (`getLocale`, `overwriteGetLocale` in tests), Supabase/Postgres.

**Spec:** `docs/superpowers/specs/2026-09-09-opening-taxonomy-design.md`

**Working directory:** all `npm` commands run from `mychess/`.

**File structure:**

| file | responsibility |
| --- | --- |
| `src/lib/openings/taxonomy.ts` | the hand-authored list + its types. Data only, no logic. |
| `src/lib/openings/taxonomy.test.ts` | authoring guards: disjoint codes per side, unique ids, non-empty `nameLt` |
| `src/lib/openings/resolve.ts` | `resolveOpening` (override-or-derive) and `curatedOpeningName` (locale) |
| `src/lib/openings/resolve.test.ts` | resolution and locale behaviour |
| `src/lib/components/CuratedOpeningPicker.svelte` | posts `opening_id`; distinct from `OpeningPicker.svelte`, which posts `eco_code` |
| `supabase/migrations/0078_repertoires_opening_id.sql` | one nullable column |

---

### Task 1: Taxonomy module and its authoring guards

The list ships with a small starter set. Its **contents are the maintainer's to write** (spec Non-Goals); these three entries exist so the guards and resolver have something real to work against, and they are deliberately chosen to exercise the interesting case — the same ECO family split differently per side.

**Files:**
- Create: `mychess/src/lib/openings/taxonomy.ts`
- Create: `mychess/src/lib/openings/taxonomy.test.ts`

- [ ] **Step 1: Write the failing test**

Create `mychess/src/lib/openings/taxonomy.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { CURATED_OPENINGS } from './taxonomy';

describe('curated opening taxonomy', () => {
  it('gives every entry a unique id', () => {
    const ids = CURATED_OPENINGS.map((o) => o.id);
    expect(ids).toEqual([...new Set(ids)]);
  });

  // Two entries claiming the same code for the same side would make
  // resolveOpening's answer depend on array order, which is silent and
  // arbitrary. This is the authoring mistake most likely to happen as the
  // list grows.
  it('never lets two entries of the same side claim one ECO code', () => {
    const seen = new Map<string, string>();
    const clashes: string[] = [];
    for (const opening of CURATED_OPENINGS) {
      for (const code of opening.ecoCodes) {
        const key = `${code}/${opening.side}`;
        const owner = seen.get(key);
        if (owner) clashes.push(`${key} claimed by both ${owner} and ${opening.id}`);
        else seen.set(key, opening.id);
      }
    }
    expect(clashes).toEqual([]);
  });

  it('gives every entry a Lithuanian name', () => {
    expect(CURATED_OPENINGS.filter((o) => !o.nameLt.trim()).map((o) => o.id)).toEqual([]);
  });

  it('gives every entry at least one ECO code', () => {
    expect(CURATED_OPENINGS.filter((o) => o.ecoCodes.length === 0).map((o) => o.id)).toEqual([]);
  });

  it('uses only white or black as the side', () => {
    expect(CURATED_OPENINGS.filter((o) => o.side !== 'white' && o.side !== 'black')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/openings/taxonomy.test.ts`
Expected: FAIL — `Failed to resolve import "./taxonomy"`.

- [ ] **Step 3: Write the taxonomy module**

Create `mychess/src/lib/openings/taxonomy.ts`:

```ts
// mychess/src/lib/openings/taxonomy.ts
//
// The curated opening taxonomy (GitHub issue #201, epic #119) — what a coach
// prepares, as opposed to what ECO catalogues.
//
// Hand-authored on purpose. ECO groups by move order rather than by
// preparation: A00 lumps unrelated irregular openings together, while the
// Sicilian's 80 codes are plausibly ONE prep item for Black and SEVERAL for
// White (Open, Alapin and Closed are different preparation). No derived list
// survives that unedited, so this one is written, not generated.
//
// One entry per (opening, side), because the two sides need different
// granularity and ECO codes already carry the distinction (B22 Alapin vs B90
// Najdorf).
//
// `id` is a stable slug because #202 stores it: renaming a display name must
// not orphan a student's mapping.
//
// `ecoCodes` are explicit rather than ranges — ranges read compactly but hide
// gaps, and ECO decades are not contiguous by theme.
//
// Guarded by taxonomy.test.ts: unique ids, no two same-side entries claiming
// one code, every entry carrying a Lithuanian name.

export type OpeningSide = 'white' | 'black';

export type CuratedOpening = {
  id: string;
  name: string;
  nameLt: string;
  side: OpeningSide;
  ecoCodes: string[];
};

/**
 * A starter set, not the finished taxonomy — the list's contents are the
 * maintainer's to author (see the spec's Non-Goals). These three exercise the
 * case the structure exists for: B22 and B90 both belong to ECO's "Sicilian
 * Defense" family, but White prepares them as two separate things while Black
 * has one Najdorf entry.
 */
export const CURATED_OPENINGS: CuratedOpening[] = [
  {
    id: 'sicilian-najdorf-black',
    name: 'Sicilian: Najdorf',
    nameLt: 'Siciliška: Naidorfo variantas',
    side: 'black',
    ecoCodes: ['B90', 'B91', 'B92', 'B93', 'B94', 'B95', 'B96', 'B97', 'B98', 'B99']
  },
  {
    id: 'anti-sicilian-alapin-white',
    name: 'Anti-Sicilian: Alapin',
    nameLt: 'Prieš siciliškąją: Alapino variantas',
    side: 'white',
    ecoCodes: ['B22']
  },
  {
    id: 'open-sicilian-white',
    name: 'Open Sicilian',
    nameLt: 'Atviroji siciliška',
    side: 'white',
    ecoCodes: ['B90', 'B91', 'B92', 'B93', 'B94', 'B95', 'B96', 'B97', 'B98', 'B99']
  }
];
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/openings/taxonomy.test.ts`
Expected: PASS, 5 tests. Note `B90` appearing under both a black and a white entry is intended and must NOT fail — the clash test keys on `code/side`.

- [ ] **Step 5: Commit**

```bash
git add mychess/src/lib/openings/taxonomy.ts mychess/src/lib/openings/taxonomy.test.ts
git commit -m "feat(openings): curated opening taxonomy with authoring guards (GitHub issue #201)"
```

---

### Task 2: `resolveOpening` and `curatedOpeningName`

**Files:**
- Create: `mychess/src/lib/openings/resolve.ts`
- Create: `mychess/src/lib/openings/resolve.test.ts`

- [ ] **Step 1: Write the failing test**

Create `mychess/src/lib/openings/resolve.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { resolveOpening, curatedOpeningName } from './resolve';
import type { CuratedOpening } from './taxonomy';

const TAXONOMY: CuratedOpening[] = [
  { id: 'najdorf-black', name: 'Sicilian: Najdorf', nameLt: 'Naidorfo variantas', side: 'black', ecoCodes: ['B90'] },
  { id: 'open-sicilian-white', name: 'Open Sicilian', nameLt: 'Atviroji siciliška', side: 'white', ecoCodes: ['B90'] },
  { id: 'alapin-white', name: 'Anti-Sicilian: Alapin', nameLt: 'Alapino variantas', side: 'white', ecoCodes: ['B22'] }
];

describe('resolveOpening', () => {
  it('derives from the ECO code and colour when there is no override', () => {
    expect(resolveOpening({ eco_code: 'B22', color: 'white', opening_id: null }, TAXONOMY)?.id).toBe('alapin-white');
  });

  // The whole reason entries are per-side: one code, two sides, two answers.
  it('picks the entry matching the colour when one code serves both sides', () => {
    expect(resolveOpening({ eco_code: 'B90', color: 'black', opening_id: null }, TAXONOMY)?.id).toBe('najdorf-black');
    expect(resolveOpening({ eco_code: 'B90', color: 'white', opening_id: null }, TAXONOMY)?.id).toBe('open-sicilian-white');
  });

  it('lets a stored override win over derivation', () => {
    expect(
      resolveOpening({ eco_code: 'B22', color: 'white', opening_id: 'open-sicilian-white' }, TAXONOMY)?.id
    ).toBe('open-sicilian-white');
  });

  it('returns null for an override naming an entry that no longer exists', () => {
    expect(resolveOpening({ eco_code: 'B22', color: 'white', opening_id: 'deleted-entry' }, TAXONOMY)).toBeNull();
  });

  it('returns null when the repertoire has no ECO code', () => {
    expect(resolveOpening({ eco_code: null, color: 'white', opening_id: null }, TAXONOMY)).toBeNull();
  });

  it('returns null when no entry claims the code for that colour', () => {
    expect(resolveOpening({ eco_code: 'B22', color: 'black', opening_id: null }, TAXONOMY)).toBeNull();
    expect(resolveOpening({ eco_code: 'A00', color: 'white', opening_id: null }, TAXONOMY)).toBeNull();
  });
});

describe('curatedOpeningName', () => {
  it('returns the Lithuanian name under the lt locale', () => {
    expect(curatedOpeningName(TAXONOMY[0], 'lt')).toBe('Naidorfo variantas');
  });

  it('returns the English name otherwise', () => {
    expect(curatedOpeningName(TAXONOMY[0], 'en')).toBe('Sicilian: Najdorf');
  });

  it('returns null when there is no opening', () => {
    expect(curatedOpeningName(null, 'lt')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/openings/resolve.test.ts`
Expected: FAIL — `Failed to resolve import "./resolve"`.

- [ ] **Step 3: Write the resolver**

Create `mychess/src/lib/openings/resolve.ts`:

```ts
// mychess/src/lib/openings/resolve.ts
import { CURATED_OPENINGS, type CuratedOpening } from './taxonomy';
import type { Locale } from '$lib/paraglide/runtime';

/**
 * Which curated opening a repertoire prepares (GitHub issue #201).
 *
 * THE ONLY WAY ANYTHING SHOULD ASK THIS. `repertoires.opening_id` holds only a
 * coach's explicit correction, so it is null on almost every row — a call site
 * reading the column directly sees nothing and renders blank, silently. That is
 * why resolution lives here and why `resolve.test.ts` pins the null-column case
 * to derivation rather than to null.
 *
 * Deriving rather than storing at import is deliberate: the taxonomy is still
 * being authored, and a stored answer would freeze each repertoire at whatever
 * the list said on its import day, needing a data migration per revision.
 * Editing the list instead re-answers for every repertoire at once.
 *
 * An override naming a since-deleted entry resolves to null rather than
 * falling back to derivation: the coach's stated answer is gone, and quietly
 * substituting a different opening would be worse than showing the ECO line.
 */
export function resolveOpening(
  repertoire: { eco_code: string | null; color: string | null; opening_id: string | null },
  taxonomy: CuratedOpening[] = CURATED_OPENINGS
): CuratedOpening | null {
  if (repertoire.opening_id) {
    return taxonomy.find((opening) => opening.id === repertoire.opening_id) ?? null;
  }
  if (!repertoire.eco_code) return null;
  return (
    taxonomy.find(
      (opening) => opening.side === repertoire.color && opening.ecoCodes.includes(repertoire.eco_code as string)
    ) ?? null
  );
}

/** The display name for a resolved opening, in the active locale. */
export function curatedOpeningName(opening: CuratedOpening | null, locale: Locale): string | null {
  if (!opening) return null;
  return locale === 'lt' ? opening.nameLt : opening.name;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/openings/resolve.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add mychess/src/lib/openings/resolve.ts mychess/src/lib/openings/resolve.test.ts
git commit -m "feat(openings): resolve a repertoire's opening, override or derived (GitHub issue #201)"
```

---

### Task 3: Migration and its schema probe

**Files:**
- Create: `mychess/supabase/migrations/0078_repertoires_opening_id.sql`
- Modify: `mychess/scripts/schema-check.ts:38-39`

- [ ] **Step 1: Write the migration**

Create `mychess/supabase/migrations/0078_repertoires_opening_id.sql`:

```sql
-- mychess/supabase/migrations/0078_repertoires_opening_id.sql
--
-- #201 (epic #119): which curated opening a repertoire prepares.
--
-- Holds ONLY a coach's explicit correction. The usual answer is derived at read
-- time from (eco_code, color) via src/lib/openings/taxonomy.ts — see
-- resolveOpening's comment for why deriving beats storing while the taxonomy is
-- still being authored. So this column is null on almost every row, by design.
--
-- Deliberately no foreign key: the taxonomy is a TypeScript module, not a
-- table, because every migration in this project is applied by hand and the
-- list will churn. Integrity is a test instead — taxonomy.test.ts keeps ids
-- unique, and resolveOpening returns null for an id the list no longer has.
-- Same trade already made by variation_chapter_practice_exclusions.chapter_name.

alter table public.repertoires
  add column opening_id text;
```

- [ ] **Step 2: Add the schema probe**

In `mychess/scripts/schema-check.ts`, change the end of the `PROBES` array (line 38-39) from:

```ts
  { migration: '0072', table: 'chapter_completed', select: 'id,player_id,repertoire_id,chapter_name,reached_at' }
];
```

to:

```ts
  { migration: '0072', table: 'chapter_completed', select: 'id,player_id,repertoire_id,chapter_name,reached_at' },
  { migration: '0078', table: 'repertoires', select: 'id,opening_id' }
];
```

- [ ] **Step 3: Hand the SQL to the maintainer**

This environment has no linked Supabase CLI, so the migration cannot be applied from here. Paste the file's contents into the Supabase dashboard SQL editor, then confirm:

Run: `npm run schema:check`
Expected: a `✓ 0078  repertoires (id,opening_id)` line among the probes, and `All probes passed`.

Until it is applied that probe FAILS, which is correct — do not treat a red `schema:check` here as a code defect, and do not proceed to Task 4 until it is green, because the picker writes to this column.

- [ ] **Step 4: Commit**

```bash
git add mychess/supabase/migrations/0078_repertoires_opening_id.sql mychess/scripts/schema-check.ts
git commit -m "feat(db): repertoires.opening_id for a coach's opening override (GitHub issue #201)"
```

---

### Task 4: The correction picker and its action

**Files:**
- Create: `mychess/src/lib/components/CuratedOpeningPicker.svelte`
- Modify: `mychess/src/routes/(coach)/coach/repertoires/+page.server.ts` (add an action beside `updateOpening`, which ends at line 121)
- Modify: `mychess/src/routes/(coach)/coach/repertoires/+page.svelte` (mount the picker; `openingModalRepId` state already exists for the ECO one)
- Modify: `mychess/messages/en.json`, `mychess/messages/lt.json`

- [ ] **Step 1: Add the message keys**

To `mychess/messages/en.json`:

```json
	"coach_repertoires_prep_change_button": "Prep",
	"curated_opening_picker_heading": "Which opening is this preparation for?",
	"curated_opening_picker_auto": "Auto — from the ECO code",
	"curated_opening_picker_none_for_colour": "No openings listed for this colour yet.",
	"curated_opening_picker_close_label": "Close",
```

To `mychess/messages/lt.json`:

```json
	"coach_repertoires_prep_change_button": "Ruošimas",
	"curated_opening_picker_heading": "Kuriam debiutui šis ruošimas?",
	"curated_opening_picker_auto": "Automatiškai — pagal ECO kodą",
	"curated_opening_picker_none_for_colour": "Šiai spalvai debiutų dar nėra.",
	"curated_opening_picker_close_label": "Uždaryti",
```

- [ ] **Step 2: Write the picker component**

Create `mychess/src/lib/components/CuratedOpeningPicker.svelte`:

```svelte
<!-- mychess/src/lib/components/CuratedOpeningPicker.svelte -->
<!--
	Sets `repertoires.opening_id` — a coach's explicit answer to "which prep item
	is this file for" (GitHub issue #201).

	Deliberately NOT a mode of `OpeningPicker.svelte`. That one searches 500 ECO
	entries and posts `eco_code`/`eco_name`, classifying the repertoire; this one
	lists a few dozen curated openings and posts `opening_id`. They are different
	questions that happen to be linked, and one component serving both is how a
	coach ends up changing an ECO code to move a file between prep categories.

	Only entries matching the repertoire's own colour are offered — a white file
	cannot be preparation for Black's side of anything.
-->
<script lang="ts">
  import { enhance } from '$app/forms';
  import { getLocale } from '$lib/paraglide/runtime';
  import { m } from '$lib/paraglide/messages';
  import { CURATED_OPENINGS } from '$lib/openings/taxonomy';
  import { curatedOpeningName } from '$lib/openings/resolve';

  let {
    repId,
    color,
    onclose
  }: { repId: string; color: string | null; onclose: () => void } = $props();

  const choices = $derived(CURATED_OPENINGS.filter((opening) => opening.side === color));

  function handleSubmit() {
    return async ({ update }: { update: () => Promise<void> }) => {
      await update();
      onclose();
    };
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" onclick={onclose}>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="bg-(--color-surface) rounded-xl shadow-lg max-w-sm w-full max-h-[80vh] overflow-y-auto"
    onclick={(e) => e.stopPropagation()}
  >
    <div class="flex items-center justify-between p-4 border-b border-gray-100">
      <h2 class="font-semibold text-(--color-text)">{m.curated_opening_picker_heading()}</h2>
      <button
        type="button"
        onclick={onclose}
        aria-label={m.curated_opening_picker_close_label()}
        class="text-(--color-muted) hover:text-gray-600 dark:hover:text-gray-400 text-xl leading-none"
      >
        &times;
      </button>
    </div>

    <div class="p-4 space-y-1">
      <form method="POST" action="?/updateRepertoireOpening" use:enhance={handleSubmit}>
        <input type="hidden" name="rep_id" value={repId} />
        <input type="hidden" name="opening_id" value="" />
        <button class="w-full text-left text-sm text-(--color-muted) hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg px-3 py-2">
          {m.curated_opening_picker_auto()}
        </button>
      </form>

      {#if choices.length === 0}
        <p class="text-sm text-(--color-muted) px-1">{m.curated_opening_picker_none_for_colour()}</p>
      {/if}

      {#each choices as opening (opening.id)}
        <form method="POST" action="?/updateRepertoireOpening" use:enhance={handleSubmit}>
          <input type="hidden" name="rep_id" value={repId} />
          <input type="hidden" name="opening_id" value={opening.id} />
          <button class="w-full text-left text-sm rounded-lg px-3 py-2 hover:bg-indigo-50 text-(--color-text)">
            {curatedOpeningName(opening, getLocale())}
          </button>
        </form>
      {/each}
    </div>
  </div>
</div>
```

- [ ] **Step 3: Add the server action**

In `mychess/src/routes/(coach)/coach/repertoires/+page.server.ts`, immediately after the closing brace of `updateOpening`, add:

```ts
	,
	// GitHub issue #201. Distinct from `updateOpening` above, which sets the ECO
	// code: this one records which curated opening the repertoire prepares. An
	// empty value clears the override and returns the repertoire to derivation.
	updateRepertoireOpening: async ({ request, locals }) => {
		const { user } = await requireAccount(locals);
		const supabase = locals.supabase;
		const fd = await request.formData();
		const repId = fd.get('rep_id') as string;
		const openingId = (fd.get('opening_id') as string) || null;
		if (!repId) return fail(400, { error: 'No repertoire selected' });

		const { error } = await supabase
			.from('repertoires')
			.update({ opening_id: openingId })
			.eq('id', repId)
			.eq('player_id', user!.id);
		if (error) return fail(500, { error: error.message });

		return { success: true };
	}
```

Note the leading comma: `updateOpening` is currently the last entry in the `actions` object.

- [ ] **Step 4: Mount the picker on the coach list**

In `mychess/src/routes/(coach)/coach/repertoires/+page.svelte`, add to the imports:

```ts
  import CuratedOpeningPicker from '$lib/components/CuratedOpeningPicker.svelte';
```

Add state beside the existing `openingModalRepId`:

```ts
  let prepModalRepId = $state<string | null>(null);
  const prepModalRep = $derived(
    prepModalRepId ? data.repertoires.find((r: any) => r.id === prepModalRepId) ?? null : null
  );
```

Add a trigger immediately after the existing ECO "Change" button:

```svelte
                  <button type="button" onclick={() => (prepModalRepId = rep.id)}
                          class="text-(--color-muted) hover:text-indigo-600 hover:underline ml-1">
                    {m.coach_repertoires_prep_change_button()}
                  </button>
```

And at the end of the file, beside the other modals:

```svelte
{#if prepModalRep}
  <CuratedOpeningPicker
    repId={prepModalRep.id}
    color={prepModalRep.color}
    onclose={() => (prepModalRepId = null)}
  />
{/if}
```

- [ ] **Step 5: Verify the suite is still green**

Run: `npm run check && npm run lint && npm test`
Expected: check 0 errors, lint 0 errors, all tests pass. No new tests yet — the action is server code, which this repo verifies manually rather than by unit test.

- [ ] **Step 6: Commit**

```bash
git add mychess/src/lib/components/CuratedOpeningPicker.svelte "mychess/src/routes/(coach)/coach/repertoires/+page.server.ts" "mychess/src/routes/(coach)/coach/repertoires/+page.svelte" mychess/messages/en.json mychess/messages/lt.json
git commit -m "feat(coach): pick which opening a repertoire prepares (GitHub issue #201)"
```

---

### Task 5: Display cascade in both repertoire lists

**Files:**
- Modify: `mychess/src/routes/(coach)/coach/repertoires/+page.svelte:89-96`
- Modify: `mychess/src/routes/(player)/repertoires/+page.svelte:39-46`
- Modify: `mychess/src/routes/(coach)/coach/repertoires/repertoires.test.ts`
- Modify: `mychess/src/routes/(player)/repertoires/repertoires.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `mychess/src/routes/(coach)/coach/repertoires/repertoires.test.ts`, inside the existing `describe('coach repertoires page', …)` block:

```ts
  // GitHub issue #201. B22 + white resolves to the Alapin entry, so the prep
  // name replaces the ECO line rather than sitting beside it.
  it('shows the resolved opening instead of the ECO name', () => {
    render(Page, {
      props: {
        data: {
          repertoires: [
            { ...REPERTOIRES[0], eco_code: 'B22', eco_name: 'Sicilian Defense: Alapin Variation', opening_id: null }
          ],
          players: []
        },
        form: null
      }
    });
    expect(screen.getByText(/Anti-Sicilian: Alapin/)).toBeTruthy();
    expect(screen.queryByText(/Sicilian Defense: Alapin Variation/)).toBeNull();
  });

  it('falls back to the ECO line when no opening resolves', () => {
    render(Page, {
      props: {
        data: {
          repertoires: [{ ...REPERTOIRES[0], eco_code: 'A00', eco_name: 'Amar Opening', opening_id: null }],
          players: []
        },
        form: null
      }
    });
    expect(screen.getByText(/Amar Opening/)).toBeTruthy();
    expect(screen.getByText('A00')).toBeTruthy();
  });

  it('honours a stored override over the ECO code', () => {
    render(Page, {
      props: {
        data: {
          repertoires: [
            { ...REPERTOIRES[0], eco_code: 'B22', eco_name: 'Sicilian Defense: Alapin Variation', opening_id: 'open-sicilian-white' }
          ],
          players: []
        },
        form: null
      }
    });
    expect(screen.getByText(/Open Sicilian/)).toBeTruthy();
  });
```

Add the same three to `mychess/src/routes/(player)/repertoires/repertoires.test.ts`, adjusted to that page's props shape — read the top of the file for how it builds `data`, and reuse its existing fixture spread the way the coach version reuses `REPERTOIRES[0]`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run "src/routes/(coach)/coach/repertoires/repertoires.test.ts"`
Expected: FAIL — the pages still render the ECO name, so `Anti-Sicilian: Alapin` is not found.

- [ ] **Step 3: Update the coach list**

In `mychess/src/routes/(coach)/coach/repertoires/+page.svelte`, add to the imports:

```ts
  import { resolveOpening, curatedOpeningName } from '$lib/openings/resolve';
```

Replace the `<p class="text-xs mt-0.5">` block's ECO branch so the resolved opening takes precedence:

```svelte
                <p class="text-xs mt-0.5">
                  {#if curatedOpeningName(resolveOpening(rep), getLocale())}
                    <span class="text-(--color-accent) font-medium">
                      {curatedOpeningName(resolveOpening(rep), getLocale())}
                    </span>
                  {:else if rep.eco_code}
                    <span class="text-(--color-accent) font-medium">{rep.eco_code}</span>
                    <span class="text-(--color-muted)">
                      — {localizedOpeningName({
                        code: rep.eco_code,
                        englishName: rep.eco_name,
                        locale: getLocale()
                      })}
                    </span>
                  {:else}
                    <span class="text-(--color-muted)">{m.coach_repertoires_unclassified()}</span>
                  {/if}
```

Keep the rest of that paragraph — the ECO "Change" button and the new "Prep" button — unchanged.

- [ ] **Step 4: Update the player list**

In `mychess/src/routes/(player)/repertoires/+page.svelte`, add the same import, then replace the `{#if rep.eco_code}` block with:

```svelte
                {#if curatedOpeningName(resolveOpening(rep), getLocale())}
                  <p class="text-xs text-indigo-500">{curatedOpeningName(resolveOpening(rep), getLocale())}</p>
                {:else if rep.eco_code}
                  <p class="text-xs text-indigo-500">
                    {rep.eco_code} — {localizedOpeningName({
                      code: rep.eco_code,
                      englishName: rep.eco_name,
                      locale: getLocale()
                    })}
                  </p>
                {/if}
```

- [ ] **Step 5: Run the full suite**

Run: `npm run check && npm run lint && npm test`
Expected: check 0 errors, lint 0 errors, all tests pass including the 6 new display tests.

- [ ] **Step 6: Commit**

```bash
git add "mychess/src/routes/(coach)/coach/repertoires/+page.svelte" "mychess/src/routes/(player)/repertoires/+page.svelte" "mychess/src/routes/(coach)/coach/repertoires/repertoires.test.ts" "mychess/src/routes/(player)/repertoires/repertoires.test.ts"
git commit -m "feat(openings): show the curated opening in place of the ECO line (GitHub issue #201)"
```

---

## Manual verification

- [ ] **The override round-trip.** As a coach, open "Prep" on a repertoire, choose an opening, confirm the list shows it. Choose "Auto", confirm it reverts to the derived value (or the ECO line if nothing derives).
- [ ] **Colour filtering.** Open "Prep" on a white repertoire and confirm no black-side entries are offered.
- [ ] **The fallback.** Confirm a repertoire whose code no entry claims still shows its ECO line rather than blank — with the starter taxonomy that is most of them, which is the expected early state.
- [ ] **Locale.** Switch to `lt` and confirm the opening name switches too.

## Before this is done

- [ ] **Author the real taxonomy.** The three starter entries exist so the guards and resolver have something to work against; the list's contents are the maintainer's to write (spec Non-Goals). The guard tests are what make an authoring mistake fail loudly rather than silently mislabel a repertoire.
