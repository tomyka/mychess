# Coach Repertoire Library, Assignment, and Student Notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate repertoire ownership from assignment (uploads always go to the coach's own library; sharing happens through a proper assign action), fix the completely-broken "leave a note for a student" feature, and build the missing UI for the coach's per-student detail page.

**Architecture:** Three independent fixes to existing, already-scaffolded backend logic — no new tables, no new RLS, no new server helpers. Task 1 fixes a column-name mismatch in three files for the notes feature. Task 2 simplifies the Upload PGN tool. Task 3 builds the first-ever template for a page whose server logic (`load`, `assignRep`, `addNote`) already exists.

**Tech Stack:** SvelteKit 2 / Svelte 5 (runes), `@supabase/ssr`.

Spec: `docs/superpowers/specs/2026-07-06-coach-student-management-design.md`

**One RLS gap found during Task 3's code-quality review, fixed via a new migration:** `coach_notes`' original RLS policy (`coach_notes_coach_all`, a single `for all` with no explicit insert check) let any coach insert a note attached to *any* player, not just a connected student — invisible until Task 3's new "leave a note" form made it reachable through the UI for the first time. Fixed the same way `assigned_repertoires` was tightened earlier in this project: split the policy by operation so select/update/delete stay as permissive as before (preserving access to notes for since-unlinked students), but insert now requires an active `coach_players` relationship. See migration `0021_coach_notes_insert_check.sql`.

---

### Task 1: Fix the `coach_notes` column mismatch

**Files:**
- Modify: `mychess/src/routes/(coach)/coach/players/[player_id]/+page.server.ts` (only the `addNote` action)
- Modify: `mychess/src/routes/(player)/+page.server.ts` (only the `coach_notes` query)
- Modify: `mychess/src/lib/components/CoachNoteBanner.svelte`

**Context:** Verified directly against the live production database: `coach_notes`' real column is `note`, not `message`. All three of these files currently reference `message`, so the entire "leave a note for a student" feature has never worked — the write fails (nonexistent column), and the read fails too, so a player has never actually seen a coach's note.

- [ ] **Step 1: Fix the write side**

In `mychess/src/routes/(coach)/coach/players/[player_id]/+page.server.ts`, change:

```ts
	addNote: async ({ params, request, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) return fail(401, { error: 'Unauthorized' });

		const fd = await request.formData();
		const message = (fd.get('message') as string ?? '').trim();
		if (!message) return fail(400, { error: 'Note cannot be empty' });

		const { error } = await supabase
			.from('coach_notes')
			.insert({ player_id: params.player_id, coach_id: user.id, message });

		if (error) return fail(500, { error: error.message });
		return { success: true };
	},
```

to:

```ts
	addNote: async ({ params, request, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) return fail(401, { error: 'Unauthorized' });

		const fd = await request.formData();
		const note = ((fd.get('note') as string) ?? '').trim();
		if (!note) return fail(400, { error: 'Note cannot be empty' });

		const { error } = await supabase
			.from('coach_notes')
			.insert({ player_id: params.player_id, coach_id: user.id, note });

		if (error) return fail(500, { error: error.message });
		return { success: true };
	},
```

(The form field is renamed from `message` to `note` to match — this is a brand-new template being built in Task 3, so there's no other consumer of the old field name to keep in sync.)

- [ ] **Step 2: Fix the read side**

In `mychess/src/routes/(player)/+page.server.ts`, change:

```ts
    supabase
      .from('coach_notes')
      .select('id, message, created_at')
      .eq('player_id', user.id)
      .is('read_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .single(),
```

to:

```ts
    supabase
      .from('coach_notes')
      .select('id, note, created_at')
      .eq('player_id', user.id)
      .is('read_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .single(),
```

Nothing else in this file changes — `unreadNote: noteRes.data ?? null` further down already just passes through whatever shape the query returns, no edit needed there.

- [ ] **Step 3: Fix the display component**

Replace the full contents of `mychess/src/lib/components/CoachNoteBanner.svelte` with:

```svelte
<!-- MyChess/src/lib/components/CoachNoteBanner.svelte -->
<script lang="ts">
  let { note, ondismiss } = $props<{ note: { id: string; note: string }; ondismiss: () => void }>();
</script>

<div class="bg-indigo-50 border-l-4 border-indigo-400 rounded-r-xl p-4 flex items-start gap-3">
  <div class="flex-1">
    <p class="text-indigo-700 font-semibold text-sm">Coach note</p>
    <p class="text-gray-700 text-sm mt-0.5">{note.note}</p>
  </div>
  <button
    onclick={ondismiss}
    class="text-gray-400 hover:text-gray-600 text-sm mt-0.5 shrink-0"
    aria-label="Dismiss"
  >✕</button>
</div>
```

- [ ] **Step 4: Type-check**

Run: `npm run check` (from `mychess/`)
Expected: no new errors attributable to these three files. (This project has ~12 pre-existing, unrelated type errors elsewhere in OAuth callback routes — not your concern.)

- [ ] **Step 5: Commit**

```bash
git add "mychess/src/routes/(coach)/coach/players/[player_id]/+page.server.ts" "mychess/src/routes/(player)/+page.server.ts" mychess/src/lib/components/CoachNoteBanner.svelte
git commit -m "fix: coach_notes column mismatch breaking the note-leaving feature"
```

---

### Task 2: Simplify Upload PGN — remove direct-to-student assignment

**Files:**
- Modify: `mychess/src/routes/(coach)/coach/pgn/+page.server.ts`
- Modify: `mychess/src/routes/(coach)/coach/pgn/+page.svelte`

**Context:** Uploading a repertoire while a specific student is selected in "Assign to player" creates the repertoire directly under that student's `player_id` — bypassing the proper `assigned_repertoires` mechanism entirely (the student never sees it under "Assigned by your coach," and the coach loses the ability to un-assign it later). From now on, every upload goes into the coach's own library; Task 3 builds the proper way to share a repertoire with a specific student.

- [ ] **Step 1: Simplify the server file**

Replace the full contents of `mychess/src/routes/(coach)/coach/pgn/+page.server.ts` with:

```ts
import { fail } from '@sveltejs/kit';
import type { Actions } from './$types';
import { importPgn } from '$lib/server/pgn-import';

export const actions: Actions = {
	upload: async ({ request, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) return fail(401);

		const data = await request.formData();
		const name = data.get('name') as string;
		const pgnText = data.get('pgn_text') as string;
		const color = data.get('color') as string;

		if (!name || !pgnText) return fail(400, { error: 'Name and PGN required' });
		if (color !== 'white' && color !== 'black') return fail(400, { error: 'Please select a color' });

		const { repertoireId, gameCount, error } = await importPgn(supabase, {
			playerId: user.id,
			name,
			color,
			pgnText
		});
		if (error) return fail(400, { error });

		return { success: true, gameCount, repId: repertoireId };
	}
};
```

(No `load` export at all — the page needs no server-fetched data anymore, and no `PageServerLoad` import either.)

- [ ] **Step 2: Remove the assign dropdown from the form**

In `mychess/src/routes/(coach)/coach/pgn/+page.svelte`, change:

```svelte
<script lang="ts">
  import { enhance } from '$app/forms';

  let { data, form } = $props<{ data: { players: any[] }; form: any }>();
  let color = $state<'white' | 'black'>('white');
```

to:

```svelte
<script lang="ts">
  import { enhance } from '$app/forms';

  let { form } = $props<{ form: any }>();
  let color = $state<'white' | 'black'>('white');
```

Then, remove this whole block entirely:

```svelte
      {#if data.players.length > 0}
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1" for="player_id">Assign to player</label>
          <select id="player_id" name="player_id"
                  class="w-full rounded-lg px-4 py-2.5 border border-gray-300 text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500">
            <option value="">Myself</option>
            {#each data.players as player}
              <option value={player.id}>{player.display_name}</option>
            {/each}
          </select>
        </div>
      {/if}

```

(i.e. delete it, including its surrounding blank lines, so the "Color" block is immediately followed by the "Paste PGN text" block.)

- [ ] **Step 3: Type-check**

Run: `npm run check` (from `mychess/`)
Expected: no new errors attributable to these two files.

- [ ] **Step 4: Commit**

```bash
git add "mychess/src/routes/(coach)/coach/pgn/+page.server.ts" "mychess/src/routes/(coach)/coach/pgn/+page.svelte"
git commit -m "refactor: Upload PGN always stores to the coach's own library"
```

---

### Task 3: Build the student-detail page

**Files:**
- Modify: `mychess/src/routes/(coach)/coach/players/[player_id]/+page.server.ts` (only the `load` function — `addNote`, `assignRep`, `setGoal` are untouched from Task 1)
- Create (replacing empty file): `mychess/src/routes/(coach)/coach/players/[player_id]/+page.svelte`
- Test: `mychess/src/routes/(coach)/coach/players/[player_id]/player-detail.test.ts`

**Context:** This route's actions already work (`assignRep` upserts into `assigned_repertoires`; `addNote` was just fixed in Task 1). `+page.svelte` is a completely empty file — nothing has ever rendered here. `load` currently fetches the student's own repertoires (no longer the right thing to show, now that assignment is separate from ownership) and doesn't fetch what's already been assigned — this task reshapes it.

- [ ] **Step 1: Reshape the `load` function**

In `mychess/src/routes/(coach)/coach/players/[player_id]/+page.server.ts`, change:

```ts
export const load: PageServerLoad = async ({ params, locals: { supabase, safeGetSession } }) => {
  const { user } = await safeGetSession();
  if (!user) throw redirect(303, '/login');

  const [playerRes, statsRes, repsRes, notesRes] = await Promise.all([
    supabase.from('profiles').select('id, display_name, weekly_xp_goal').eq('id', params.player_id).single(),
    supabase.from('player_stats').select('*').eq('player_id', params.player_id).single(),
    supabase.from('repertoires').select('id, name, color').eq('player_id', params.player_id),
    supabase.from('coach_notes').select('*').eq('player_id', params.player_id).order('created_at', { ascending: false }).limit(5)
  ]);

  // Coach's own repertoires for assignment
  const { data: coachReps } = await supabase
    .from('repertoires')
    .select('id, name, color')
    .eq('player_id', user.id);

  const totalXp = statsRes.data?.total_xp ?? 0;
  const levelInfo = levelFromXp(totalXp);

  return {
    player: playerRes.data,
    stats: { ...statsRes.data, ...levelInfo },
    repertoires: repsRes.data ?? [],
    coachReps: coachReps ?? [],
    notes: notesRes.data ?? [],
    playerId: params.player_id
  };
};
```

to:

```ts
export const load: PageServerLoad = async ({ params, locals: { supabase, safeGetSession } }) => {
  const { user } = await safeGetSession();
  if (!user) throw redirect(303, '/login');

  const [playerRes, statsRes, notesRes, coachRepsRes, assignedRes] = await Promise.all([
    supabase.from('profiles').select('id, display_name, weekly_xp_goal').eq('id', params.player_id).single(),
    supabase.from('player_stats').select('*').eq('player_id', params.player_id).single(),
    supabase.from('coach_notes').select('id, note, created_at').eq('player_id', params.player_id).order('created_at', { ascending: false }).limit(5),
    supabase.from('repertoires').select('id, name, color').eq('player_id', user.id),
    supabase
      .from('assigned_repertoires')
      .select('id, repertoire:repertoire_id(id, name, color)')
      .eq('coach_id', user.id)
      .eq('player_id', params.player_id)
  ]);

  const totalXp = statsRes.data?.total_xp ?? 0;
  const levelInfo = levelFromXp(totalXp);

  return {
    player: playerRes.data,
    stats: { ...statsRes.data, ...levelInfo },
    notes: notesRes.data ?? [],
    coachReps: coachRepsRes.data ?? [],
    assignedReps: assignedRes.data ?? [],
    playerId: params.player_id
  };
};
```

(`setGoal` and `assignRep` in the `actions` block below this are unchanged — don't touch them. `addNote` was already fixed in Task 1.)

- [ ] **Step 2: Write the page template**

Replace the full (empty) contents of `mychess/src/routes/(coach)/coach/players/[player_id]/+page.svelte` with:

```svelte
<script lang="ts">
  import { enhance } from '$app/forms';

  let { data, form } = $props<{ data: any; form: any }>();
</script>

<svelte:head>
  <title>{data.player?.display_name ?? 'Student'} — MyChess</title>
</svelte:head>

<main class="min-h-screen bg-gray-50">
  <div class="max-w-2xl mx-auto px-4 py-6 space-y-8">
    <a href="/coach" class="text-gray-400 text-sm hover:text-gray-600 block">← Back to Dashboard</a>
    <h1 class="text-2xl font-bold text-gray-900">{data.player?.display_name ?? 'Student'}</h1>

    {#if form?.error}
      <p class="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{form.error}</p>
    {/if}

    <section class="bg-white border border-gray-200 rounded-xl shadow-sm p-5">
      <h2 class="font-semibold text-gray-900 mb-3">Stats</h2>
      <div class="grid grid-cols-3 gap-4 text-center">
        <div>
          <p class="text-2xl font-bold text-indigo-600">{data.stats?.level ?? 0}</p>
          <p class="text-xs text-gray-400">Level</p>
        </div>
        <div>
          <p class="text-2xl font-bold text-gray-900">{data.stats?.total_reviews ?? 0}</p>
          <p class="text-xs text-gray-400">Reviews</p>
        </div>
        <div>
          <p class="text-2xl font-bold text-gray-900">{data.stats?.moves_learned ?? 0}</p>
          <p class="text-xs text-gray-400">Moves learned</p>
        </div>
      </div>
    </section>

    <section class="bg-white border border-gray-200 rounded-xl shadow-sm p-5">
      <h2 class="font-semibold text-gray-900 mb-3">Assign a Repertoire</h2>
      {#if data.coachReps.length === 0}
        <p class="text-gray-400 text-sm">
          You haven't uploaded any repertoires yet.
          <a href="/coach/pgn" class="text-indigo-600 hover:underline">Upload one</a> first.
        </p>
      {:else}
        <form method="POST" action="?/assignRep" use:enhance class="flex gap-2">
          <select name="rep_id"
                  class="flex-1 rounded-lg px-4 py-2.5 border border-gray-300 text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500">
            {#each data.coachReps as rep}
              <option value={rep.id}>{rep.name}</option>
            {/each}
          </select>
          <button class="bg-indigo-600 text-white px-4 py-2.5 rounded-lg font-medium hover:bg-indigo-700 transition-colors">
            Assign
          </button>
        </form>
      {/if}

      <h3 class="text-sm font-medium text-gray-700 mt-5 mb-2">Already assigned</h3>
      {#if data.assignedReps.length === 0}
        <p class="text-gray-400 text-sm">Nothing assigned yet.</p>
      {:else}
        <ul class="space-y-2">
          {#each data.assignedReps as a}
            <li class="flex items-center gap-3 bg-gray-50 rounded-lg p-3">
              <span class="w-3 h-3 rounded-full shrink-0"
                    style="background:{a.repertoire?.color === 'black' ? '#1f2937' : '#e5e7eb'}"></span>
              <span class="text-sm text-gray-900">{a.repertoire?.name}</span>
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <section class="bg-white border border-gray-200 rounded-xl shadow-sm p-5">
      <h2 class="font-semibold text-gray-900 mb-3">Notes</h2>
      <form method="POST" action="?/addNote" use:enhance class="flex gap-2 mb-4">
        <input name="note" placeholder="Leave a note for this student…"
               class="flex-1 rounded-lg px-4 py-2.5 border border-gray-300 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        <button class="bg-indigo-600 text-white px-4 py-2.5 rounded-lg font-medium hover:bg-indigo-700 transition-colors">
          Add
        </button>
      </form>
      {#if data.notes.length === 0}
        <p class="text-gray-400 text-sm">No notes yet.</p>
      {:else}
        <ul class="space-y-2">
          {#each data.notes as note}
            <li class="bg-gray-50 rounded-lg p-3">
              <p class="text-sm text-gray-900">{note.note}</p>
              <p class="text-xs text-gray-400 mt-1">{new Date(note.created_at).toLocaleDateString()}</p>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  </div>
</main>
```

- [ ] **Step 3: Write a component test**

```ts
// mychess/src/routes/(coach)/coach/players/[player_id]/player-detail.test.ts
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import PlayerDetail from './+page.svelte';

afterEach(() => cleanup());

const baseData = {
  player: { id: 'p1', display_name: 'Paulius Konovalovas' },
  stats: { level: 3, total_reviews: 40, moves_learned: 12 },
  notes: [],
  coachReps: [],
  assignedReps: [],
  playerId: 'p1'
};

describe('coach student detail page', () => {
  it('shows the student name and stats', () => {
    render(PlayerDetail, { props: { data: baseData, form: null } });
    expect(screen.getByText('Paulius Konovalovas')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.getByText('40')).toBeTruthy();
  });

  it('shows a link to Upload PGN when the coach has no repertoires yet', () => {
    render(PlayerDetail, { props: { data: baseData, form: null } });
    expect(screen.getByRole('link', { name: 'Upload one' })).toBeTruthy();
  });

  it('shows the assign dropdown when the coach has repertoires', () => {
    render(PlayerDetail, {
      props: {
        data: { ...baseData, coachReps: [{ id: 'r1', name: 'Sicilian Defense', color: 'white' }] },
        form: null
      }
    });
    expect(screen.getByRole('option', { name: 'Sicilian Defense' })).toBeTruthy();
  });

  it('shows already-assigned repertoires', () => {
    render(PlayerDetail, {
      props: {
        data: {
          ...baseData,
          assignedReps: [{ id: 'a1', repertoire: { id: 'r1', name: 'Sicilian Defense', color: 'white' } }]
        },
        form: null
      }
    });
    expect(screen.getByText('Sicilian Defense')).toBeTruthy();
  });

  it('shows existing notes', () => {
    render(PlayerDetail, {
      props: {
        data: { ...baseData, notes: [{ id: 'n1', note: 'Great progress this week!', created_at: '2026-01-01' }] },
        form: null
      }
    });
    expect(screen.getByText('Great progress this week!')).toBeTruthy();
  });

  it('shows a form error message when present', () => {
    render(PlayerDetail, { props: { data: baseData, form: { error: 'Note cannot be empty' } } });
    expect(screen.getByText('Note cannot be empty')).toBeTruthy();
  });
});
```

- [ ] **Step 4: Run the tests**

Run (needs the Node 22 PATH override for jsdom — this project's established workaround): `PATH="/c/Users/tomyk/.config/herd/bin/nvm/v22.22.3:$PATH" npx vitest run "src/routes/(coach)/coach/players/[player_id]/player-detail.test.ts"`
Expected: PASS (6/6).

- [ ] **Step 5: Type-check**

Run: `npm run check` (from `mychess/`)
Expected: no new errors attributable to these files.

- [ ] **Step 6: Commit**

```bash
git add "mychess/src/routes/(coach)/coach/players/[player_id]"
git commit -m "feat: build the coach's student-detail page (stats, notes, repertoire assignment)"
```

---

### Task 4: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `PATH="/c/Users/tomyk/.config/herd/bin/nvm/v22.22.3:$PATH" npx vitest run` (from `mychess/`)
Expected: PASS — no regressions, plus the 6 new tests from Task 3.

- [ ] **Step 2: Run the full type-check**

Run: `npm run check` (from `mychess/`)
Expected: no new errors beyond this project's pre-existing baseline.

- [ ] **Step 3: Grep for stragglers**

Run: `grep -rn "coach_notes\|\.message\b" mychess/src/routes/\(coach\)/coach/players mychess/src/routes/\(player\)/+page.server.ts mychess/src/lib/components/CoachNoteBanner.svelte`
Expected: no remaining reference to a `message` field/column anywhere in these files — only `note`.

Run: `grep -rn "player_id.*name=\"player_id\"\|Assign to player" mychess/src/routes/\(coach\)/coach/pgn`
Expected: no matches — confirms the old assign-at-upload dropdown is fully gone.

- [ ] **Step 4: Manual verification on production**

Since local dev testing has been deprioritized in favor of testing directly on the deployed site — after this is merged and deployed:
- As a coach, upload a new repertoire — confirm there's no "Assign to player" option anymore, and the repertoire lands in your own library (check `/repertoires`... actually coaches don't have that page; check it doesn't error and shows the success message).
- Visit a connected student's detail page (`/coach/players/[id]`, reached via `/coach/students`) — confirm it now renders (previously blank), showing their level/stats.
- Assign one of your repertoires to them from that page — confirm it appears under "Already assigned," and confirm the student now sees it under "Assigned by your coach" on their own `/repertoires` page.
- Leave a note for that student — confirm it appears in the notes list on this page, and confirm the student sees the note banner on their own dashboard (`/`).

No commit for this task — it's verification only. If any step surfaces a bug, fix it as part of the task where the bug was introduced and re-run this task's steps.
