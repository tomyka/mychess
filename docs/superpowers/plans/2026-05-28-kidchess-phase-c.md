# KidChess Phase C Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete KidChess with badge granting, badge trophy room, Chess.com/Lichess game import, settings page, streak freeze UI, sound effects, and PWA manifest.

**Architecture:** Phase C closes the gaps left after Phase B: badges are checked but never granted, platform integrations are missing, and the app is not installable. Each task is self-contained. Badge granting is triggered server-side after sessions. Platform imports reuse the existing PGN parser. PWA manifest makes the app installable on mobile.

**Tech Stack:** SvelteKit 5 (runes), Supabase, ts-fsrs, chess.js, Web Audio API, chess.com public API, lichess.org public API, Tailwind CSS.

---

## File Map

**New files:**
- `supabase/migrations/0007_phase_c.sql` — add chesscom_username/lichess_username to profiles
- `src/lib/badges/grant.ts` — collect stats, call checkBadgeEligibility, insert badges_earned, grant XP
- `src/lib/sounds.ts` — Web Audio API tone generator (correct/wrong/level-up)
- `src/routes/(kid)/badges/+page.server.ts` — load all badges + earned status
- `src/routes/(kid)/badges/+page.svelte` — trophy room grid
- `src/routes/(kid)/settings/+page.server.ts` — load + save chesscom/lichess usernames
- `src/routes/(kid)/settings/+page.svelte` — settings form + import buttons
- `src/routes/api/import/chesscom/+server.ts` — fetch chess.com public API → PGN → repertoire
- `src/routes/api/import/lichess/+server.ts` — fetch lichess public API → PGN → repertoire
- `static/manifest.json` — PWA manifest

**Modified files:**
- `src/routes/api/review/+server.ts` — call grantNewBadges after review
- `src/routes/api/drill/+server.ts` — call grantNewBadges after drill
- `src/routes/api/time-trial/+server.ts` — call grantNewBadges after time trial
- `src/routes/(kid)/+page.svelte` — show streak_freeze count; add link to /badges and /settings
- `src/app.html` — add PWA manifest link

---

## Task c01: Badge Granting Pipeline

**Files:**
- Create: `src/lib/badges/grant.ts`
- Create: `src/lib/badges/grant.test.ts`
- Modify: `src/routes/api/review/+server.ts`
- Modify: `src/routes/api/drill/+server.ts`
- Modify: `src/routes/api/time-trial/+server.ts`

- [ ] **Step 1: Write failing tests for grantNewBadges**

Create `src/lib/badges/grant.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { buildBadgeStats } from './grant';

describe('buildBadgeStats', () => {
  it('maps DB rows to BadgeStats correctly', () => {
    const stats = buildBadgeStats({
      totalReviews: 10,
      totalCorrect: 8,
      movesLearned: 5,
      streakDays: 3,
      level: 2,
      sessionCount: 4,
      repertoireCount: 1,
      drillStreak: 0,
      ttBestScore: 0,
      questsCompleted: 0,
      hasUploaded: true,
      earnedIds: new Set(['first_move'])
    });
    expect(stats.totalReviews).toBe(10);
    expect(stats.hasUploaded).toBe(true);
    expect(stats.earnedIds.has('first_move')).toBe(true);
  });

  it('handles zero values without throwing', () => {
    const stats = buildBadgeStats({
      totalReviews: 0,
      totalCorrect: 0,
      movesLearned: 0,
      streakDays: 0,
      level: 1,
      sessionCount: 0,
      repertoireCount: 0,
      drillStreak: 0,
      ttBestScore: 0,
      questsCompleted: 0,
      hasUploaded: false,
      earnedIds: new Set()
    });
    expect(stats.level).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd kidchess && npx vitest run src/lib/badges/grant.test.ts
```

Expected: FAIL — `buildBadgeStats` not defined.

- [ ] **Step 3: Implement `src/lib/badges/grant.ts`**

```typescript
import type { SupabaseClient } from '@supabase/supabase-js';
import type { BadgeStats } from './recalc';
import { checkBadgeEligibility } from './recalc';

export interface BadgeStatsInput {
  totalReviews: number;
  totalCorrect: number;
  movesLearned: number;
  streakDays: number;
  level: number;
  sessionCount: number;
  repertoireCount: number;
  drillStreak: number;
  ttBestScore: number;
  questsCompleted: number;
  hasUploaded: boolean;
  earnedIds: Set<string>;
}

/** Identity helper — lets tests verify the mapping without mocking Supabase. */
export function buildBadgeStats(input: BadgeStatsInput): BadgeStats {
  return input;
}

/**
 * Collect stats from DB, run eligibility check, insert new badges, grant XP.
 * Returns the IDs of newly granted badges (empty if none).
 */
export async function grantNewBadges(
  supabase: SupabaseClient,
  kidId: string,
  overrides: Partial<BadgeStatsInput> = {}
): Promise<string[]> {
  // Fetch stats in parallel
  const [profileRes, kidStatsRes, sessionRes, repRes, questRes, earnedRes] =
    await Promise.all([
      supabase.from('profiles').select('xp, level, streak_days').eq('id', kidId).single(),
      supabase.from('kid_stats').select('total_reviews, total_correct, moves_learned, new_cards_today').eq('kid_id', kidId).single(),
      supabase.from('sessions').select('id, mode').eq('kid_id', kidId),
      supabase.from('repertoires').select('id').eq('kid_id', kidId),
      supabase.from('quests').select('id').eq('kid_id', kidId).eq('completed', true),
      supabase.from('badges_earned').select('badge_id').eq('kid_id', kidId)
    ]);

  const p = profileRes.data;
  const ks = kidStatsRes.data;
  const sessions = sessionRes.data ?? [];
  const drillSessions = sessions.filter((s: any) => s.mode === 'drill');
  const ttSessions = sessions.filter((s: any) => s.mode === 'time_trial');

  const earnedIds = new Set((earnedRes.data ?? []).map((r: any) => r.badge_id as string));

  const stats: BadgeStats = buildBadgeStats({
    totalReviews: ks?.total_reviews ?? 0,
    totalCorrect: ks?.total_correct ?? 0,
    movesLearned: ks?.moves_learned ?? 0,
    streakDays: p?.streak_days ?? 0,
    level: p?.level ?? 1,
    sessionCount: sessions.length,
    repertoireCount: (repRes.data ?? []).length,
    drillStreak: overrides.drillStreak ?? 0,
    ttBestScore: overrides.ttBestScore ?? 0,
    questsCompleted: (questRes.data ?? []).length,
    hasUploaded: (repRes.data ?? []).length > 0,
    earnedIds,
    ...overrides
  });

  const newBadgeIds = checkBadgeEligibility(stats);
  if (newBadgeIds.length === 0) return [];

  // Insert new earned badges
  const rows = newBadgeIds.map(id => ({ kid_id: kidId, badge_id: id }));
  await supabase.from('badges_earned').insert(rows);

  // Grant XP for each badge
  const { data: badgeDefs } = await supabase
    .from('badges')
    .select('id, xp_reward')
    .in('id', newBadgeIds);

  const totalXp = (badgeDefs ?? []).reduce((sum: number, b: any) => sum + (b.xp_reward ?? 0), 0);
  if (totalXp > 0) {
    await supabase.rpc('update_xp_and_level', { p_user_id: kidId, p_xp_delta: totalXp });
  }

  return newBadgeIds;
}
```

- [ ] **Step 4: Run tests**

```bash
cd kidchess && npx vitest run src/lib/badges/grant.test.ts
```

Expected: 2 tests pass.

- [ ] **Step 5: Wire into review API**

Edit `src/routes/api/review/+server.ts` — add badge grant call at the end of POST:

```typescript
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { grantNewBadges } from '$lib/badges/grant';

export const POST: RequestHandler = async ({ request, locals: { supabase, safeGetSession } }) => {
  const { user } = await safeGetSession();
  if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

  const { moveId, rating, xp } = await request.json();

  const now = new Date().toISOString();
  await supabase.from('reviews').upsert(
    { kid_id: user.id, move_id: moveId, last_review: now },
    { onConflict: 'kid_id,move_id' }
  );

  if (xp !== 0) {
    await supabase.rpc('update_xp_and_level', { p_user_id: user.id, p_xp_delta: xp });
  }

  // Non-blocking badge check (fire-and-forget is fine; badges are idempotent)
  grantNewBadges(supabase, user.id).catch(() => {});

  return json({ ok: true });
};
```

- [ ] **Step 6: Wire into drill API**

In `src/routes/api/drill/+server.ts`, add after the streak call:

```typescript
import { grantNewBadges } from '$lib/badges/grant';

// at the end of the POST handler, before return json({ ok: true }):
grantNewBadges(supabase, user.id, { drillStreak: bestChain }).catch(() => {});
```

- [ ] **Step 7: Wire into time-trial API**

In `src/routes/api/time-trial/+server.ts`, add after the streak call:

```typescript
import { grantNewBadges } from '$lib/badges/grant';

// at the end of the POST handler, before return json({ ok: true }):
grantNewBadges(supabase, user.id, { ttBestScore: correct }).catch(() => {});
```

- [ ] **Step 8: Type check**

```bash
cd kidchess && npm run check
```

Expected: 0 errors.

- [ ] **Step 9: Commit**

```bash
cd kidchess
git add src/lib/badges/grant.ts src/lib/badges/grant.test.ts src/routes/api/review/+server.ts src/routes/api/drill/+server.ts src/routes/api/time-trial/+server.ts
git commit -m "feat(badges): badge granting pipeline wired to review/drill/time-trial sessions"
```

---

## Task c02: Badges Trophy Room Page

**Files:**
- Create: `src/routes/(kid)/badges/+page.server.ts`
- Create: `src/routes/(kid)/badges/+page.svelte`

- [ ] **Step 1: Write the server loader**

Create `src/routes/(kid)/badges/+page.server.ts`:

```typescript
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals: { supabase, safeGetSession } }) => {
  const { user, session, profile } = await safeGetSession();
  if (!user) throw redirect(303, '/login');

  const [allRes, earnedRes] = await Promise.all([
    supabase.from('badges').select('id, name, description, icon_url, xp_reward').order('xp_reward', { ascending: true }),
    supabase.from('badges_earned').select('badge_id, earned_at').eq('kid_id', user.id)
  ]);

  const earnedMap = new Map((earnedRes.data ?? []).map((e: any) => [e.badge_id, e.earned_at]));

  const badges = (allRes.data ?? []).map((b: any) => ({
    ...b,
    earned: earnedMap.has(b.id),
    earned_at: earnedMap.get(b.id) ?? null
  }));

  return { session, profile, badges };
};
```

- [ ] **Step 2: Write the trophy room page**

Create `src/routes/(kid)/badges/+page.svelte`:

```svelte
<script lang="ts">
  let { data } = $props<{ data: any }>();

  const badges: any[] = (data as any).badges ?? [];
  const earnedCount = $derived(badges.filter((b: any) => b.earned).length);
</script>

<div class="min-h-screen bg-gradient-to-b from-yellow-50 to-amber-100 p-4">
  <div class="max-w-lg mx-auto">
    <div class="flex items-center gap-3 mb-6">
      <a href="/" class="text-2xl">⬅️</a>
      <div>
        <h1 class="text-2xl font-bold text-amber-800">🏆 Trophy Room</h1>
        <p class="text-sm text-amber-600">{earnedCount} / {badges.length} badges earned</p>
      </div>
    </div>

    <!-- Progress bar -->
    <div class="bg-amber-200 rounded-full h-3 mb-6 overflow-hidden">
      <div
        class="h-full bg-amber-500 rounded-full transition-all"
        style="width: {Math.round((earnedCount / Math.max(badges.length, 1)) * 100)}%"
      ></div>
    </div>

    <div class="grid grid-cols-3 gap-3">
      {#each badges as badge}
        <div
          class="rounded-2xl p-3 text-center transition-all
                 {badge.earned
                   ? 'bg-white shadow-md border-2 border-amber-300'
                   : 'bg-gray-100 opacity-40 grayscale'}"
        >
          <div class="text-3xl mb-1">
            {badge.earned ? '🏅' : '🔒'}
          </div>
          <p class="text-xs font-bold leading-tight text-gray-800">{badge.name}</p>
          <p class="text-xs text-gray-500 mt-0.5 leading-tight">{badge.description}</p>
          {#if badge.earned}
            <p class="text-xs text-amber-600 font-bold mt-1">+{badge.xp_reward} XP</p>
          {/if}
        </div>
      {/each}
    </div>
  </div>
</div>
```

- [ ] **Step 3: Type check**

```bash
cd kidchess && npm run check
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
cd kidchess
git add 'src/routes/(kid)/badges/'
git commit -m "feat(badges): trophy room page showing all 30 badges earned/locked"
```

---

## Task c03: DB Migration + Settings Page

**Files:**
- Create: `supabase/migrations/0007_phase_c.sql`
- Create: `src/routes/(kid)/settings/+page.server.ts`
- Create: `src/routes/(kid)/settings/+page.svelte`

- [ ] **Step 1: Write migration**

Create `supabase/migrations/0007_phase_c.sql`:

```sql
-- Add platform usernames for Chess.com and Lichess integration
alter table public.profiles
  add column if not exists chesscom_username text,
  add column if not exists lichess_username  text;
```

- [ ] **Step 2: Write settings server**

Create `src/routes/(kid)/settings/+page.server.ts`:

```typescript
import { redirect, fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';

export const load: PageServerLoad = async ({ locals: { supabase, safeGetSession } }) => {
  const { user, session, profile } = await safeGetSession();
  if (!user) throw redirect(303, '/login');

  const { data: p } = await supabase
    .from('profiles')
    .select('display_name, chesscom_username, lichess_username')
    .eq('id', user.id)
    .single();

  return {
    session,
    profile,
    displayName: p?.display_name ?? '',
    chesscomUsername: p?.chesscom_username ?? '',
    lichessUsername: p?.lichess_username ?? ''
  };
};

export const actions: Actions = {
  save: async ({ request, locals: { supabase, safeGetSession } }) => {
    const { user } = await safeGetSession();
    if (!user) return fail(401, { error: 'Unauthorized' });

    const fd = await request.formData();
    const chesscomUsername = (fd.get('chesscom_username') as string ?? '').trim();
    const lichessUsername = (fd.get('lichess_username') as string ?? '').trim();

    const { error } = await supabase
      .from('profiles')
      .update({ chesscom_username: chesscomUsername || null, lichess_username: lichessUsername || null })
      .eq('id', user.id);

    if (error) return fail(500, { error: error.message });
    return { success: true };
  }
};
```

- [ ] **Step 3: Write settings page**

Create `src/routes/(kid)/settings/+page.svelte`:

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
        importResult = `✅ Imported ${body.count} game(s) as a new repertoire!`;
      } else {
        importResult = `❌ ${body.error ?? 'Import failed'}`;
      }
    } catch {
      importResult = '❌ Network error';
    } finally {
      importing = null;
    }
  }
</script>

<div class="min-h-screen bg-slate-900 text-white p-4 max-w-lg mx-auto">
  <div class="flex items-center gap-3 mb-6">
    <a href="/" class="text-2xl">⬅️</a>
    <h1 class="text-2xl font-bold">⚙️ Settings</h1>
  </div>

  <!-- Platform Usernames -->
  <section class="bg-slate-800 rounded-2xl p-5 mb-5">
    <h2 class="font-bold text-lg mb-4 text-yellow-400">🔗 Connect Platforms</h2>
    <form method="POST" action="?/save" use:enhance class="space-y-4">
      <div>
        <label class="block text-sm text-slate-400 mb-1" for="chesscom">Chess.com username</label>
        <input
          id="chesscom"
          name="chesscom_username"
          type="text"
          value={d.chesscomUsername}
          placeholder="e.g. MagnusCarlsen"
          class="w-full bg-slate-700 rounded-xl px-4 py-2 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-yellow-400"
        />
      </div>
      <div>
        <label class="block text-sm text-slate-400 mb-1" for="lichess">Lichess username</label>
        <input
          id="lichess"
          name="lichess_username"
          type="text"
          value={d.lichessUsername}
          placeholder="e.g. DrNykterstein"
          class="w-full bg-slate-700 rounded-xl px-4 py-2 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-yellow-400"
        />
      </div>
      <button class="w-full bg-yellow-400 text-slate-900 py-2 rounded-xl font-bold hover:bg-yellow-300 transition">
        Save
      </button>
      {#if form?.success}
        <p class="text-green-400 text-sm">✅ Saved!</p>
      {/if}
    </form>
  </section>

  <!-- Import Buttons -->
  <section class="bg-slate-800 rounded-2xl p-5 mb-5">
    <h2 class="font-bold text-lg mb-1 text-yellow-400">📥 Import Recent Games</h2>
    <p class="text-slate-400 text-xs mb-4">Import your last 20 games as a repertoire study set.</p>

    <div class="flex flex-col gap-3">
      <button
        onclick={() => importGames('chesscom')}
        disabled={!d.chesscomUsername || importing !== null}
        class="w-full bg-green-600 py-3 rounded-xl font-bold hover:bg-green-500 transition disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {importing === 'chesscom' ? 'Importing...' : 'Import from Chess.com'}
      </button>
      <button
        onclick={() => importGames('lichess')}
        disabled={!d.lichessUsername || importing !== null}
        class="w-full bg-blue-600 py-3 rounded-xl font-bold hover:bg-blue-500 transition disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {importing === 'lichess' ? 'Importing...' : 'Import from Lichess'}
      </button>
    </div>

    {#if importResult}
      <p class="text-sm mt-3 {importResult.startsWith('✅') ? 'text-green-400' : 'text-red-400'}">{importResult}</p>
    {/if}
  </section>
</div>
```

- [ ] **Step 4: Type check**

```bash
cd kidchess && npm run check
```

Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
cd kidchess
git add supabase/migrations/0007_phase_c.sql 'src/routes/(kid)/settings/'
git commit -m "feat(settings): platform username settings page + chess.com/lichess username storage migration"
```

---

## Task c04: Chess.com Game Import API

**Files:**
- Create: `src/routes/api/import/chesscom/+server.ts`

The chess.com public API endpoint is:
`https://api.chess.com/pub/player/{username}/games/{year}/{month}`
Returns JSON: `{ games: [{ pgn: string, ... }] }`. No auth required.

- [ ] **Step 1: Write the import handler**

Create `src/routes/api/import/chesscom/+server.ts`:

```typescript
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { parsePgn } from '$lib/pgn/parser';

export const POST: RequestHandler = async ({ locals }) => {
  const { supabase } = locals;
  const { user } = await locals.safeGetSession();
  if (!user) throw error(401, 'Unauthorized');

  // Get stored chess.com username
  const { data: profile } = await supabase
    .from('profiles')
    .select('chesscom_username')
    .eq('id', user.id)
    .single();

  const username = profile?.chesscom_username;
  if (!username) throw error(400, 'No chess.com username saved. Go to Settings first.');

  // Fetch current month's games from chess.com public API
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const url = `https://api.chess.com/pub/player/${encodeURIComponent(username)}/games/${year}/${month}`;

  let chessGames: any[];
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'KidChess/1.0' } });
    if (!res.ok) throw error(502, `Chess.com returned ${res.status}. Check your username.`);
    const body = await res.json();
    chessGames = body.games ?? [];
  } catch (e: any) {
    if (e.status) throw e;
    throw error(502, 'Failed to reach chess.com. Try again later.');
  }

  if (chessGames.length === 0) {
    return json({ count: 0, message: 'No games found for this month.' });
  }

  // Take last 20 games, parse PGN
  const recent = chessGames.slice(-20);
  const combinedPgn = recent.map((g: any) => g.pgn ?? '').filter(Boolean).join('\n\n');
  const parsed = parsePgn(combinedPgn);

  if (parsed.length === 0) return json({ count: 0, message: 'Could not parse any games.' });

  // Create repertoire
  const repName = `Chess.com Import ${year}-${month}`;
  const { data: rep } = await supabase
    .from('repertoires')
    .insert({ kid_id: user.id, name: repName, color: '#4ade80' })
    .select()
    .single();

  if (!rep) throw error(500, 'Failed to create repertoire.');

  // Upsert positions and moves using the same logic as coach PGN upload
  const allFens = new Set<string>();
  for (const game of parsed) {
    allFens.add(game.root_fen);
    for (const m of game.moves) { allFens.add(m.fen); allFens.add(m.parentFen); }
  }

  const posRows = [...allFens].map(fen => ({ fen }));
  await supabase.from('positions').upsert(posRows, { onConflict: 'fen', ignoreDuplicates: true });

  const { data: positions } = await supabase.from('positions').select('id, fen').in('fen', [...allFens]);
  const fenToId = new Map((positions ?? []).map((p: any) => [p.fen, p.id]));

  const moveRows: any[] = [];
  for (const game of parsed) {
    for (const m of game.moves) {
      const fromId = fenToId.get(m.parentFen);
      const toId = fenToId.get(m.fen);
      if (!fromId || !toId) continue;
      moveRows.push({
        repertoire_id: rep.id,
        from_position: fromId,
        to_position: toId,
        san: m.san,
        color: m.color,
        move_number: Math.ceil(m.ply / 2)
      });
    }
  }

  if (moveRows.length > 0) {
    await supabase.from('moves').upsert(moveRows, { onConflict: 'repertoire_id,from_position,san', ignoreDuplicates: true });
  }

  return json({ count: parsed.length });
};
```

- [ ] **Step 2: Type check**

```bash
cd kidchess && npm run check
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
cd kidchess
git add src/routes/api/import/chesscom/
git commit -m "feat(import): Chess.com game import from public API"
```

---

## Task c05: Lichess Game Import API

**Files:**
- Create: `src/routes/api/import/lichess/+server.ts`

The lichess public API endpoint is:
`https://lichess.org/api/games/user/{username}?max=20&pgnInJson=false`
Returns PGN text directly (Content-Type: application/x-chess-pgn). No auth required.

- [ ] **Step 1: Write the import handler**

Create `src/routes/api/import/lichess/+server.ts`:

```typescript
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { parsePgn } from '$lib/pgn/parser';

export const POST: RequestHandler = async ({ locals }) => {
  const { supabase } = locals;
  const { user } = await locals.safeGetSession();
  if (!user) throw error(401, 'Unauthorized');

  const { data: profile } = await supabase
    .from('profiles')
    .select('lichess_username')
    .eq('id', user.id)
    .single();

  const username = profile?.lichess_username;
  if (!username) throw error(400, 'No Lichess username saved. Go to Settings first.');

  const url = `https://lichess.org/api/games/user/${encodeURIComponent(username)}?max=20&pgnInJson=false`;

  let pgn: string;
  try {
    const res = await fetch(url, { headers: { 'Accept': 'application/x-chess-pgn', 'User-Agent': 'KidChess/1.0' } });
    if (!res.ok) throw error(502, `Lichess returned ${res.status}. Check your username.`);
    pgn = await res.text();
  } catch (e: any) {
    if (e.status) throw e;
    throw error(502, 'Failed to reach Lichess. Try again later.');
  }

  const parsed = parsePgn(pgn);
  if (parsed.length === 0) return json({ count: 0, message: 'No games found or could not parse.' });

  const now = new Date();
  const repName = `Lichess Import ${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const { data: rep } = await supabase
    .from('repertoires')
    .insert({ kid_id: user.id, name: repName, color: '#60a5fa' })
    .select()
    .single();

  if (!rep) throw error(500, 'Failed to create repertoire.');

  const allFens = new Set<string>();
  for (const game of parsed) {
    allFens.add(game.root_fen);
    for (const m of game.moves) { allFens.add(m.fen); allFens.add(m.parentFen); }
  }

  const posRows = [...allFens].map(fen => ({ fen }));
  await supabase.from('positions').upsert(posRows, { onConflict: 'fen', ignoreDuplicates: true });

  const { data: positions } = await supabase.from('positions').select('id, fen').in('fen', [...allFens]);
  const fenToId = new Map((positions ?? []).map((p: any) => [p.fen, p.id]));

  const moveRows: any[] = [];
  for (const game of parsed) {
    for (const m of game.moves) {
      const fromId = fenToId.get(m.parentFen);
      const toId = fenToId.get(m.fen);
      if (!fromId || !toId) continue;
      moveRows.push({
        repertoire_id: rep.id,
        from_position: fromId,
        to_position: toId,
        san: m.san,
        color: m.color,
        move_number: Math.ceil(m.ply / 2)
      });
    }
  }

  if (moveRows.length > 0) {
    await supabase.from('moves').upsert(moveRows, { onConflict: 'repertoire_id,from_position,san', ignoreDuplicates: true });
  }

  return json({ count: parsed.length });
};
```

- [ ] **Step 2: Type check**

```bash
cd kidchess && npm run check
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
cd kidchess
git add src/routes/api/import/lichess/
git commit -m "feat(import): Lichess game import from public API"
```

---

## Task c06: Sound Effects

**Files:**
- Create: `src/lib/sounds.ts`
- Modify: `src/routes/(kid)/learn/+page.svelte` — call sounds
- Modify: `src/routes/(kid)/drill/+page.svelte` — call sounds
- Modify: `src/routes/(kid)/time-trial/+page.svelte` — call sounds

Uses the Web Audio API oscillator — no audio files needed, works offline.

- [ ] **Step 1: Write `src/lib/sounds.ts`**

```typescript
/** Web Audio API sound effects. All functions are no-ops if AudioContext is unavailable. */

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    try { ctx = new AudioContext(); } catch { return null; }
  }
  return ctx;
}

function tone(frequency: number, durationMs: number, type: OscillatorType = 'sine', gain = 0.3) {
  const c = getCtx();
  if (!c) return;
  const osc = c.createOscillator();
  const vol = c.createGain();
  osc.connect(vol);
  vol.connect(c.destination);
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, c.currentTime);
  vol.gain.setValueAtTime(gain, c.currentTime);
  vol.gain.exponentialRampToValueAtTime(0.001, c.currentTime + durationMs / 1000);
  osc.start(c.currentTime);
  osc.stop(c.currentTime + durationMs / 1000);
}

/** Pleasant ding for correct move */
export function playCorrect() {
  tone(880, 120, 'sine');
  setTimeout(() => tone(1100, 100, 'sine'), 100);
}

/** Low buzz for wrong move */
export function playWrong() {
  tone(220, 250, 'sawtooth', 0.2);
}

/** Triumphant fanfare for level-up or 10-chain */
export function playLevelUp() {
  tone(523, 100, 'sine');
  setTimeout(() => tone(659, 100, 'sine'), 110);
  setTimeout(() => tone(784, 150, 'sine'), 220);
  setTimeout(() => tone(1047, 300, 'sine'), 380);
}
```

- [ ] **Step 2: Add sounds to learn page**

In `src/routes/(kid)/learn/+page.svelte`, add import and calls:

```svelte
<script lang="ts">
  import { playCorrect, playWrong } from '$lib/sounds';
  // ... existing imports

  function handleMove(detail: { from: Key; to: Key; san: string }) {
    if (phase !== 'guess') return;
    const targetSan = current?.move?.san;
    const elapsed = Date.now() - startTime;

    if (detail.san === targetSan) {
      playCorrect();         // ADD THIS
      wrongMove = false;
      // ... rest unchanged
    } else {
      playWrong();           // ADD THIS
      wrongMove = true;
      incorrect++;
    }
  }
```

- [ ] **Step 3: Add sounds to drill page**

In `src/routes/(kid)/drill/+page.svelte`:

```svelte
<script lang="ts">
  import { playCorrect, playWrong, playLevelUp } from '$lib/sounds';

  function handleMove(detail: { from: Key; to: Key; san: string }) {
    if (failed || finished) return;
    const targetSan = current?.san;

    if (detail.san === targetSan) {
      playCorrect();         // ADD THIS
      // ...
      if (chain === 10) {
        playLevelUp();       // ADD THIS
        sessionXp += 50;
        mood = 'party';
      }
      // ...
    } else {
      playWrong();           // ADD THIS
      // ...
    }
  }
```

- [ ] **Step 4: Add sounds to time-trial page**

In `src/routes/(kid)/time-trial/+page.svelte`:

```svelte
<script lang="ts">
  import { playCorrect, playWrong } from '$lib/sounds';

  function handleMove(detail: { from: Key; to: Key; san: string }) {
    if (!started || finished) return;
    const targetSan = current?.san;

    if (detail.san === targetSan) {
      playCorrect();         // ADD THIS
      // ...
    } else {
      playWrong();           // ADD THIS
      // ...
    }
  }
```

- [ ] **Step 5: Type check**

```bash
cd kidchess && npm run check
```

Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
cd kidchess
git add src/lib/sounds.ts 'src/routes/(kid)/learn/+page.svelte' 'src/routes/(kid)/drill/+page.svelte' 'src/routes/(kid)/time-trial/+page.svelte'
git commit -m "feat(sounds): Web Audio API sound effects for correct/wrong/level-up"
```

---

## Task c07: Home Screen Polish + PWA Manifest

**Files:**
- Create: `static/manifest.json`
- Modify: `src/app.html` — add manifest link and theme-color
- Modify: `src/routes/(kid)/+page.svelte` — add streak freeze display + badges/settings links

- [ ] **Step 1: Write PWA manifest**

Create `static/manifest.json`:

```json
{
  "name": "KidChess",
  "short_name": "KidChess",
  "description": "Learn chess openings with spaced repetition and fun!",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#0f172a",
  "theme_color": "#facc15",
  "orientation": "portrait",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any maskable" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable" }
  ]
}
```

- [ ] **Step 2: Add manifest link to app.html**

Edit `src/app.html` — inside `<head>`, add:

```html
<link rel="manifest" href="/manifest.json" />
<meta name="theme-color" content="#facc15" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
<meta name="apple-mobile-web-app-title" content="KidChess" />
```

- [ ] **Step 3: Add streak freeze display + nav links to home**

In `src/routes/(kid)/+page.svelte`, upgrade the header section to show streak freeze count and add links to `/badges` and `/settings`:

```svelte
<!-- Replace the existing streak card with this upgraded version -->
<div class="bg-slate-800 rounded-2xl p-4 mb-4 flex items-center justify-between">
  <div class="flex items-center gap-3">
    <span class="text-3xl">🔥</span>
    <div>
      <p class="font-bold">{stats.streak_days ?? 0} day streak</p>
      <p class="text-slate-400 text-xs">Keep training daily!</p>
    </div>
  </div>
  {#if (profile as any)?.streak_freeze > 0}
    <div class="flex items-center gap-1 bg-blue-900/40 rounded-xl px-3 py-1">
      <span class="text-lg">🧊</span>
      <span class="text-sm text-blue-300 font-bold">×{(profile as any)?.streak_freeze}</span>
    </div>
  {/if}
</div>

<!-- Add these two nav buttons below the main grid, before leaderboard -->
<div class="flex gap-3 mb-4">
  <a href="/badges" class="flex-1 bg-slate-800 rounded-2xl p-3 text-center hover:bg-slate-700 transition">
    <p class="text-xl">🏆</p>
    <p class="text-xs font-medium mt-0.5">Badges</p>
  </a>
  <a href="/settings" class="flex-1 bg-slate-800 rounded-2xl p-3 text-center hover:bg-slate-700 transition">
    <p class="text-xl">⚙️</p>
    <p class="text-xs font-medium mt-0.5">Settings</p>
  </a>
</div>
```

Also extend the home server loader to include `streak_freeze` from profile:

In `src/routes/(kid)/+page.server.ts`, the `profile` object already contains all profile fields including `streak_freeze` — no server change needed since it is forwarded in the `profile` key. The page template accesses it via `(profile as any)?.streak_freeze`.

- [ ] **Step 4: Type check**

```bash
cd kidchess && npm run check
```

Expected: 0 errors.

- [ ] **Step 5: Run all tests**

```bash
cd kidchess && npx vitest run
```

Expected: all tests pass (≥47).

- [ ] **Step 6: Commit and push**

```bash
cd kidchess
git add static/manifest.json src/app.html 'src/routes/(kid)/+page.svelte'
git commit -m "feat(pwa): web app manifest + streak freeze display + badges/settings nav"
git push origin phase-b
```

---

## Self-Review Checklist

### Spec Coverage

| Requirement | Task |
|-------------|------|
| Badge granting (not just eligibility) | c01 |
| Badge display page | c02 |
| Chess.com game sync | c04 |
| Lichess game sync | c05 |
| Platform username storage | c03 |
| Streak freeze visible to kids | c07 |
| Sound feedback for kids | c06 |
| PWA installable on mobile | c07 |
| Settings page | c03 |

### Type Consistency

- `grantNewBadges(supabase, kidId, overrides)` — `overrides.drillStreak` matches `BadgeStats.drillStreak`, `overrides.ttBestScore` matches `BadgeStats.ttBestScore`
- Chess.com and Lichess import use identical position/move upsert pattern
- `parsePgn` returns `ParsedGame[]` — used correctly in both import handlers
- `playCorrect`, `playWrong`, `playLevelUp` — all exported from `src/lib/sounds.ts` and imported by name in pages

### No Placeholders

Scanned — all code blocks are complete. No TBD, no "implement later", no "similar to above".

---

*End of Phase C Implementation Plan*
