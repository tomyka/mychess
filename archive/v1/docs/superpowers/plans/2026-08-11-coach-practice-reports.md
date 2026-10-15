# Coach Practice Reports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Log every move a player makes during Practice (correct and wrong), then give coaches a report — per-student overview plus a per-repertoire drill-in with accuracy trend, mastery, activity, and mistake hotspots.

**Architecture:** A new `move_attempts` table logs one row per move resolution in `handleMove()`, fire-and-forget, alongside (not replacing) the existing `level_progress`/attempt-report flow. A pure aggregation module (`src/lib/practice-report.ts`) turns raw rows into report data; a thin server module (`src/lib/server/practice-report.ts`) fetches rows/labels and calls it. Two coach-facing pages consume it: a new roster overview (`/coach/reports`) and a new section on the existing per-student page (`/coach/players/[player_id]`). Charts are hand-rolled inline SVG — no new dependency.

**Tech Stack:** SvelteKit 2 (Svelte 5 runes), Supabase Postgres/RLS, Vitest for pure-logic unit tests.

Design doc: `docs/superpowers/specs/2026-08-11-coach-practice-reports-design.md`

---

### Task 1: Migration — `move_attempts` table + a missing coach-read policy on `level_progress`

**Files:**
- Create: `mychess/supabase/migrations/0039_move_attempts.sql`

There's no local Postgres and no working service-role key in this environment (per `mychess/CLAUDE.md`) — this migration cannot be applied or tested by the agent. Write the file, then the user runs it manually in the Supabase dashboard SQL editor.

This migration does one thing beyond what the design doc specifies: it also adds a coach-read policy to the existing `level_progress` table. `level_progress` (`0028_level_progress.sql`) only ever granted `level_progress_player_all` (`for all using (player_id = auth.uid())`) — no coach-read policy exists today. Task 6 needs a coach to read a student's `level_progress.level` (for the mastery display) and today that query would silently return nothing under RLS. The new policy is additive (a second permissive `for select` policy ORs with the existing `for all`, it doesn't narrow it — see `mychess/CLAUDE.md`'s note on permissive-policy ORing) and mirrors `reviews_coach_read` (`0019_coach_players.sql`) exactly, just against `level_progress` instead of `reviews`.

- [ ] **Step 1: Write the migration file**

```sql
-- mychess/supabase/migrations/0039_move_attempts.sql
-- Per-move attempt log for Practice, powering the coach-facing practice
-- report (see docs/superpowers/specs/2026-08-11-coach-practice-reports-design.md).
-- Practice previously persisted only an aggregate run-state row
-- (level_progress) — no individual move was ever recorded anywhere.
create table public.move_attempts (
  id            uuid primary key default gen_random_uuid(),
  player_id     uuid not null references public.profiles(id) on delete cascade,
  repertoire_id uuid not null references public.repertoires(id) on delete cascade,
  move_id       uuid not null references public.moves(id) on delete cascade,
  played_san    text not null,
  is_correct    boolean not null,
  level         smallint not null,
  created_at    timestamptz not null default now()
);

create index move_attempts_player_repertoire_created_idx
  on public.move_attempts (player_id, repertoire_id, created_at);
create index move_attempts_move_idx on public.move_attempts (move_id);

alter table public.move_attempts enable row level security;

create policy move_attempts_player_insert on public.move_attempts for insert
  with check (player_id = auth.uid());

create policy move_attempts_player_read on public.move_attempts for select
  using (player_id = auth.uid());

create policy move_attempts_coach_read on public.move_attempts for select using (
  exists (
    select 1 from public.coach_players cp
    where cp.player_id = move_attempts.player_id
      and cp.coach_id = auth.uid()
      and cp.status = 'active'
  )
);

revoke all on public.move_attempts from anon, public;

-- level_progress (0028_level_progress.sql) only ever granted the owning
-- player read/write access ("level_progress_player_all") — no coach-read
-- policy exists. The practice report's per-repertoire mastery display needs
-- a coach to read an active student's level_progress row, the same way
-- reviews_coach_read (0019_coach_players.sql) already does for the legacy
-- reviews table.
create policy level_progress_coach_read on public.level_progress for select using (
  exists (
    select 1 from public.coach_players cp
    where cp.player_id = level_progress.player_id
      and cp.coach_id = auth.uid()
      and cp.status = 'active'
  )
);
```

- [ ] **Step 2: Hand the migration to the user to run**

Paste the migration file's contents for the user and ask them to run it in the Supabase dashboard SQL editor (or trigger `migrate.yml` if they prefer). Do not proceed to manual end-to-end testing in Task 8 until they confirm it ran successfully.

- [ ] **Step 3: Commit**

```bash
git add mychess/supabase/migrations/0039_move_attempts.sql
git commit -m "feat: add move_attempts log table and level_progress coach-read policy"
```

---

### Task 2: Pure — carry `moveId` on `Alternative`

**Files:**
- Modify: `mychess/src/lib/mastery/practice.ts`
- Modify: `mychess/src/lib/mastery/practice.test.ts`

Every `QuizStep` already carries `moveId` (it extends `VariationStep`), but `Alternative` — the "player took a different-but-still-book move" case — doesn't. Task 3's logging needs a `moveId` for that case too (a wrong-vs-alternative distinction the log has to make), so this adds the one missing field before any capture code depends on it.

- [ ] **Step 1: Update the failing tests first**

In `mychess/src/lib/mastery/practice.test.ts`, add `moveId` to the six `alternatives` object literals that currently omit it (the `moveId` value is the branch step's own `moveId` — the same one already used to construct that step in each fixture):

Line 169-171, change:
```ts
			expect(branchStep.alternatives).toEqual([
				{ san: 'Bc4', toFen: 'b-end', kind: 'completes', taskKey: taskKey(b, 1) }
			]);
```
to:
```ts
			expect(branchStep.alternatives).toEqual([
				{ san: 'Bc4', toFen: 'b-end', moveId: 'b-p2', kind: 'completes', taskKey: taskKey(b, 1) }
			]);
```

Line 198-200, change:
```ts
			expect(branchStep.alternatives).toEqual([
				{ san: 'Bc4', toFen: 'b-mid', kind: 'continue', variationKey: b.variationKey }
			]);
```
to:
```ts
			expect(branchStep.alternatives).toEqual([
				{ san: 'Bc4', toFen: 'b-mid', moveId: 'b-p2', kind: 'continue', variationKey: b.variationKey }
			]);
```

Line 239, change:
```ts
		expect(branchStep.alternatives).toEqual([{ san: 'Bc4', toFen: 'b-end', kind: 'dead-end' }]);
```
to:
```ts
		expect(branchStep.alternatives).toEqual([{ san: 'Bc4', toFen: 'b-end', moveId: 'b-p2', kind: 'dead-end' }]);
```

Line 275-277, change:
```ts
		expect(branchStep.alternatives).toEqual([
			{ san: 'Bc4', toFen: 'b-mid', kind: 'completes', taskKey: taskKey(b1, 1) }
		]);
```
to:
```ts
		expect(branchStep.alternatives).toEqual([
			{ san: 'Bc4', toFen: 'b-mid', moveId: 'b1-p2', kind: 'completes', taskKey: taskKey(b1, 1) }
		]);
```

Line 330-332, change:
```ts
		expect(branchStep.alternatives).toEqual([
			{ san: 'Bc4', toFen: 'd-end', kind: 'continue', variationKey: e.variationKey }
		]);
```
to:
```ts
		expect(branchStep.alternatives).toEqual([
			{ san: 'Bc4', toFen: 'd-end', moveId: 'd-p2', kind: 'continue', variationKey: e.variationKey }
		]);
```

Line 559-561, change:
```ts
		expect(nested.alternatives).toEqual([
			{ san: 'Bb5', toFen: 'f-end', kind: 'completes', taskKey: taskKey(f, 1) }
		]);
```
to:
```ts
		expect(nested.alternatives).toEqual([
			{ san: 'Bb5', toFen: 'f-end', moveId: 'f-p3', kind: 'completes', taskKey: taskKey(f, 1) }
		]);
```

(The other alternatives-related tests — length-0 checks, the `continue`/`continue` tie-break that only asserts `kind`/`san`/`variationKey` — don't assert the full object shape and need no change.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd mychess && npx vitest run src/lib/mastery/practice.test.ts`
Expected: FAIL on the 6 updated assertions — actual objects are missing `moveId` until Step 3 lands.

- [ ] **Step 3: Add `moveId` to the `Alternative` type and its construction**

In `mychess/src/lib/mastery/practice.ts`, change the type:

```ts
export type Alternative =
	| { san: string; toFen: string; moveId: string; kind: 'completes'; taskKey: string }
	| { san: string; toFen: string; moveId: string; kind: 'continue'; variationKey: string }
	| { san: string; toFen: string; moveId: string; kind: 'dead-end' };
```

And in `alternativesAt`, add `moveId: step.moveId` to each of the three `found.set(...)` calls:

```ts
function alternativesAt(
	variations: Variation[],
	level: Level,
	playerMoveIndex: number,
	fromFen: string,
	canonicalSan: string
): Alternative[] {
	const found = new Map<string, Alternative>();
	for (const variation of variations) {
		const step = nthPlayerStep(variation.path, playerMoveIndex);
		if (!step || step.fromFen !== fromFen || step.san === canonicalSan) continue;
		const existing = found.get(step.san);
		if (existing?.kind === 'completes') continue; // already the best possible classification

		if (!hasContentAtLevel(variation, level)) {
			if (!existing) found.set(step.san, { san: step.san, toFen: step.toFen, moveId: step.moveId, kind: 'dead-end' });
			continue;
		}

		if (playerMoveIndex === targetDepth(variation, level)) {
			found.set(step.san, {
				san: step.san,
				toFen: step.toFen,
				moveId: step.moveId,
				kind: 'completes',
				taskKey: taskKey(variation, level)
			});
			continue;
		}

		if (existing?.kind !== 'continue') {
			found.set(step.san, {
				san: step.san,
				toFen: step.toFen,
				moveId: step.moveId,
				kind: 'continue',
				variationKey: variation.variationKey
			});
		}
	}
	return [...found.values()];
}
```

(Only the three object literals inside the function body change — its signature, the loop structure, and every comment stay exactly as they are.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd mychess && npx vitest run src/lib/mastery/practice.test.ts`
Expected: PASS (all tests in the file).

- [ ] **Step 5: Type-check**

Run: `cd mychess && npm run check`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add mychess/src/lib/mastery/practice.ts mychess/src/lib/mastery/practice.test.ts
git commit -m "feat: carry moveId on practice Alternative"
```

---

### Task 3: Capture — log every move during Practice

**Files:**
- Create: `mychess/src/routes/api/practice/move-log/+server.ts`
- Modify: `mychess/src/routes/(player)/practice/[repertoire_id]/+page.svelte`

No unit test for the new endpoint (thin Supabase I/O wrapper, matching the untested precedent of its siblings `api/practice/attempt`/`api/practice/mistake` — see `mychess/CLAUDE.md`'s pure-logic-vs-I/O split). No test for the `+page.svelte` change either — `logMove` is a fire-and-forget side effect with nothing user-visible to assert (the existing component has no test file for the same reason). Both are covered by Task 8's manual verification.

- [ ] **Step 1: Add the `/api/practice/move-log` endpoint**

```ts
// mychess/src/routes/api/practice/move-log/+server.ts
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireApiUser } from '$lib/server/auth';

/**
 * Fire-and-forget log of a single move resolution during Practice (correct
 * or wrong, including during review) — every move, not just ones that
 * affect level_progress. Purely additive: doesn't touch level_progress or
 * either of its sibling endpoints (api/practice/attempt, api/practice/mistake).
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const { supabase } = locals;
	const user = await requireApiUser(locals);

	const body = await request.json();
	const { repertoireId, moveId, playedSan, isCorrect, level } = body ?? {};
	if (
		typeof repertoireId !== 'string' ||
		typeof moveId !== 'string' ||
		typeof playedSan !== 'string' ||
		typeof isCorrect !== 'boolean' ||
		typeof level !== 'number'
	) {
		throw error(400, 'Invalid request');
	}

	const { error: insertError } = await supabase.from('move_attempts').insert({
		player_id: user.id,
		repertoire_id: repertoireId,
		move_id: moveId,
		played_san: playedSan,
		is_correct: isCorrect,
		level
	});
	if (insertError) throw error(500, insertError.message);

	return json({ ok: true });
};
```

- [ ] **Step 2: Add the `logMove` helper to the practice page**

In `mychess/src/routes/(player)/practice/[repertoire_id]/+page.svelte`, add this function right after `reportPreviousLevelMistake` (after its closing `}`, currently ending the `<script>` block around line 468):

```ts
	// Fire-and-forget log of a single move resolution — every correct and
	// wrong move, including during review (unlike reportAttempt/
	// reportPreviousLevelMistake, which are skipped in review since neither
	// touches level_progress there — this log isn't gated the same way,
	// since it doesn't affect progress and a fuller activity picture is the
	// whole point). A dropped log row has no effect on the board or on
	// progress, so this never blocks or retries.
	function logMove(moveId: string, playedSan: string, isCorrect: boolean, level: number) {
		fetch('/api/practice/move-log', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ repertoireId, moveId, playedSan, isCorrect, level })
		}).catch(() => {});
	}
```

- [ ] **Step 3: Call it from the three move-resolution points in `handleMove`**

In the correct-pinned-move branch, change:
```ts
		if (detail.san === step.san) {
			playCorrect();
			locked = true;
			wrongCount = 0;
			hintRequested = false;
			// Whether THIS move is the last one in the attempt — decided now,
```
to:
```ts
		if (detail.san === step.san) {
			playCorrect();
			locked = true;
			wrongCount = 0;
			hintRequested = false;
			logMove(step.moveId, detail.san, true, currentLevel);
			// Whether THIS move is the last one in the attempt — decided now,
```

In the accepted-alternative branch, change:
```ts
		if (alt) {
			playCorrect();
			locked = true;
			wrongCount = 0;
			hintRequested = false;

			if (alt.kind === 'completes') {
```
to:
```ts
		if (alt) {
			playCorrect();
			locked = true;
			wrongCount = 0;
			hintRequested = false;
			logMove(alt.moveId, detail.san, true, currentLevel);

			if (alt.kind === 'completes') {
```

In the wrong-move branch, change:
```ts
		playWrong();
		wrongCount++;
		if (currentReviewLevel === null) {
			attemptHadMistake = true;
			if (step.band === 'previous') reportPreviousLevelMistake();
		}
```
to:
```ts
		playWrong();
		wrongCount++;
		logMove(step.moveId, detail.san, false, currentLevel);
		if (currentReviewLevel === null) {
			attemptHadMistake = true;
			if (step.band === 'previous') reportPreviousLevelMistake();
		}
```

- [ ] **Step 4: Type-check**

Run: `cd mychess && npm run check`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add mychess/src/routes/api/practice/move-log/+server.ts "mychess/src/routes/(player)/practice/[repertoire_id]/+page.svelte"
git commit -m "feat: log every practice move attempt"
```

---

### Task 4: Pure — `practice-report.ts` aggregation module

**Files:**
- Create: `mychess/src/lib/practice-report.ts`
- Create: `mychess/src/lib/practice-report.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// mychess/src/lib/practice-report.test.ts
import { describe, it, expect } from 'vitest';
import { accuracyTrend, mistakeHotspots, activityStats, formatMoveLabel } from './practice-report';

function row(moveId: string, isCorrect: boolean, createdAt: string) {
	return { moveId, isCorrect, createdAt };
}

describe('formatMoveLabel', () => {
	it('formats a white move as "N.san"', () => {
		expect(formatMoveLabel(11, 'Nf3')).toBe('6.Nf3');
	});

	it('formats a black move as "N...san"', () => {
		expect(formatMoveLabel(12, 'e5')).toBe('6...e5');
	});
});

describe('accuracyTrend', () => {
	it('buckets by day when rangeDays is at or under 60', () => {
		const rows = [
			row('m1', true, '2026-08-01T10:00:00Z'),
			row('m2', false, '2026-08-01T11:00:00Z'),
			row('m3', true, '2026-08-02T09:00:00Z')
		];
		expect(accuracyTrend(rows, 30)).toEqual([
			{ bucket: '2026-08-01', correct: 1, wrong: 1 },
			{ bucket: '2026-08-02', correct: 1, wrong: 0 }
		]);
	});

	it('buckets by ISO week (Monday start) when rangeDays exceeds 60 or is null (all-time)', () => {
		// 2026-08-01 is a Saturday and 2026-08-02 the following Sunday — both
		// fall in the week starting Monday 2026-07-27.
		const rows = [row('m1', true, '2026-08-01T10:00:00Z'), row('m2', true, '2026-08-02T09:00:00Z')];
		expect(accuracyTrend(rows, null)).toEqual([{ bucket: '2026-07-27', correct: 2, wrong: 0 }]);
	});

	it('returns an empty array for no rows', () => {
		expect(accuracyTrend([], 30)).toEqual([]);
	});
});

describe('mistakeHotspots', () => {
	const labels = new Map([
		['m1', { san: 'e5', moveNumber: 12 }],
		['m2', { san: 'Nf3', moveNumber: 11 }]
	]);

	it('ranks by miss count descending', () => {
		const rows = [
			row('m1', false, '2026-08-01T00:00:00Z'),
			row('m1', false, '2026-08-02T00:00:00Z'),
			row('m2', false, '2026-08-01T00:00:00Z')
		];
		expect(mistakeHotspots(rows, labels, 10)).toEqual([
			{ moveId: 'm1', missCount: 2, attemptCount: 2, label: '6...e5' },
			{ moveId: 'm2', missCount: 1, attemptCount: 1, label: '6.Nf3' }
		]);
	});

	it('excludes moves with zero misses (all-correct)', () => {
		const rows = [row('m2', true, '2026-08-01T00:00:00Z')];
		expect(mistakeHotspots(rows, labels, 10)).toEqual([]);
	});

	it('respects the limit', () => {
		const rows = [row('m1', false, '2026-08-01T00:00:00Z'), row('m2', false, '2026-08-01T00:00:00Z')];
		expect(mistakeHotspots(rows, labels, 1)).toHaveLength(1);
	});

	it('skips a moveId with no matching label instead of crashing', () => {
		const rows = [row('unknown', false, '2026-08-01T00:00:00Z')];
		expect(mistakeHotspots(rows, labels, 10)).toEqual([]);
	});
});

describe('activityStats', () => {
	it('returns zeroed stats for no rows', () => {
		expect(activityStats([], new Date('2026-08-11T12:00:00Z'))).toEqual({
			sessionCount: 0,
			lastPracticedAt: null,
			streakDays: 0
		});
	});

	it('counts distinct practiced days as sessions and finds the latest timestamp', () => {
		const rows = [
			row('m1', true, '2026-08-01T10:00:00Z'),
			row('m2', true, '2026-08-01T18:00:00Z'),
			row('m3', true, '2026-08-02T09:00:00Z')
		];
		const stats = activityStats(rows, new Date('2026-08-02T20:00:00Z'));
		expect(stats.sessionCount).toBe(2);
		expect(stats.lastPracticedAt).toBe('2026-08-02T09:00:00Z');
	});

	it('computes a streak of consecutive practiced days ending today', () => {
		const rows = [
			row('m1', true, '2026-08-08T10:00:00Z'),
			row('m2', true, '2026-08-09T10:00:00Z'),
			row('m3', true, '2026-08-10T10:00:00Z')
		];
		expect(activityStats(rows, new Date('2026-08-10T20:00:00Z')).streakDays).toBe(3);
	});

	it('still counts an active streak on a day not yet practiced, using yesterday as the anchor', () => {
		const rows = [row('m1', true, '2026-08-09T10:00:00Z'), row('m2', true, '2026-08-10T10:00:00Z')];
		expect(activityStats(rows, new Date('2026-08-11T08:00:00Z')).streakDays).toBe(2);
	});

	it('breaks the streak on a gap day', () => {
		const rows = [row('m1', true, '2026-08-05T10:00:00Z'), row('m2', true, '2026-08-10T10:00:00Z')];
		expect(activityStats(rows, new Date('2026-08-10T20:00:00Z')).streakDays).toBe(1);
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd mychess && npx vitest run src/lib/practice-report.test.ts`
Expected: FAIL — `./practice-report` doesn't exist yet.

- [ ] **Step 3: Write the module**

```ts
// mychess/src/lib/practice-report.ts

export type MoveAttemptRow = { moveId: string; isCorrect: boolean; createdAt: string };
export type MoveLabel = { san: string; moveNumber: number };
export type AccuracyPoint = { bucket: string; correct: number; wrong: number };
export type Hotspot = { moveId: string; label: string; missCount: number; attemptCount: number };
export type ActivityStats = { sessionCount: number; lastPracticedAt: string | null; streakDays: number };

/** The UTC calendar date ("YYYY-MM-DD") a timestamp falls on. */
function dateKey(iso: string): string {
	return iso.slice(0, 10);
}

/** The Monday (UTC) of the ISO week a "YYYY-MM-DD" date falls in. */
function weekStart(dateIso: string): string {
	const d = new Date(`${dateIso}T00:00:00Z`);
	const day = d.getUTCDay(); // 0 = Sunday .. 6 = Saturday
	const sinceMonday = day === 0 ? 6 : day - 1;
	d.setUTCDate(d.getUTCDate() - sinceMonday);
	return d.toISOString().slice(0, 10);
}

/**
 * Buckets attempts by day (`rangeDays` at or under 60) or by ISO week (wider
 * ranges, including "all time", where `rangeDays` is null) — an all-time
 * chart bucketed by day would need one bar per day since the player
 * started, unreadable well before it's useful. Buckets with zero attempts
 * are omitted — the chart only plots days/weeks the player actually
 * practiced, not a padded fixed-length range.
 */
export function accuracyTrend(rows: Array<{ isCorrect: boolean; createdAt: string }>, rangeDays: number | null): AccuracyPoint[] {
	const granularity = rangeDays !== null && rangeDays <= 60 ? 'day' : 'week';
	const buckets = new Map<string, { correct: number; wrong: number }>();
	for (const row of rows) {
		const day = dateKey(row.createdAt);
		const key = granularity === 'day' ? day : weekStart(day);
		const bucket = buckets.get(key) ?? { correct: 0, wrong: 0 };
		if (row.isCorrect) bucket.correct++;
		else bucket.wrong++;
		buckets.set(key, bucket);
	}
	return [...buckets.entries()]
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
		.map(([bucket, counts]) => ({ bucket, ...counts }));
}

/** Formats a move as PGN-style notation, e.g. `6.Nf3` (white) or `6...e5` (black). `moveNumber` is a ply count (1 = white's 1st move, 2 = black's 1st move, ...). */
export function formatMoveLabel(moveNumber: number, san: string): string {
	const fullMove = Math.ceil(moveNumber / 2);
	const isWhite = moveNumber % 2 === 1;
	return `${fullMove}${isWhite ? '.' : '...'}${san}`;
}

/**
 * Ranks moves by wrong-attempt count, descending; ties break by total
 * attempt count, then by `moveId` for a stable order. `labels` supplies the
 * human-readable san/moveNumber for each `moveId` — one missing from it
 * (shouldn't happen; every attempt logs a real move) is skipped rather than
 * shown with a blank label.
 */
export function mistakeHotspots(
	rows: Array<{ moveId: string; isCorrect: boolean }>,
	labels: Map<string, MoveLabel>,
	limit: number
): Hotspot[] {
	const counts = new Map<string, { missCount: number; attemptCount: number }>();
	for (const row of rows) {
		const entry = counts.get(row.moveId) ?? { missCount: 0, attemptCount: 0 };
		entry.attemptCount++;
		if (!row.isCorrect) entry.missCount++;
		counts.set(row.moveId, entry);
	}

	const ranked = [...counts.entries()]
		.filter(([, c]) => c.missCount > 0)
		.sort(([aId, a], [bId, b]) => b.missCount - a.missCount || b.attemptCount - a.attemptCount || (aId < bId ? -1 : 1))
		.slice(0, limit);

	const hotspots: Hotspot[] = [];
	for (const [moveId, c] of ranked) {
		const label = labels.get(moveId);
		if (!label) continue;
		hotspots.push({ moveId, missCount: c.missCount, attemptCount: c.attemptCount, label: formatMoveLabel(label.moveNumber, label.san) });
	}
	return hotspots;
}

/**
 * Session/streak activity derived from attempt timestamps — a "session" is
 * approximated as one calendar day with at least one attempt (Practice has
 * no discrete session-start/end concept to draw on instead). The streak
 * anchors on today if the player has already practiced today, otherwise on
 * yesterday (so a streak doesn't read as broken just because today hasn't
 * happened yet). `now` is injected for testability, same convention as
 * `reviewFreshness` in `src/lib/mastery/levelProgress.ts`.
 */
export function activityStats(rows: Array<{ createdAt: string }>, now: Date): ActivityStats {
	if (rows.length === 0) return { sessionCount: 0, lastPracticedAt: null, streakDays: 0 };

	const days = new Set(rows.map((r) => dateKey(r.createdAt)));
	const lastPracticedAt = rows.reduce((max, r) => (r.createdAt > max ? r.createdAt : max), rows[0].createdAt);

	const cursor = new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
	if (!days.has(cursor.toISOString().slice(0, 10))) {
		cursor.setUTCDate(cursor.getUTCDate() - 1);
	}
	let streakDays = 0;
	while (days.has(cursor.toISOString().slice(0, 10))) {
		streakDays++;
		cursor.setUTCDate(cursor.getUTCDate() - 1);
	}

	return { sessionCount: days.size, lastPracticedAt, streakDays };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd mychess && npx vitest run src/lib/practice-report.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Type-check**

Run: `cd mychess && npm run check`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add mychess/src/lib/practice-report.ts mychess/src/lib/practice-report.test.ts
git commit -m "feat: add pure practice-report aggregation module"
```

---

### Task 5: Server — `practice-report.ts` Supabase queries

**Files:**
- Create: `mychess/src/lib/server/practice-report.ts`

Thin I/O wrapper around Task 4's pure module — following `mychess/CLAUDE.md`'s established convention, this isn't unit-tested directly; it's exercised via Task 8's manual verification once real data exists.

- [ ] **Step 1: Write the module**

```ts
// mychess/src/lib/server/practice-report.ts
import type { SupabaseClient } from '@supabase/supabase-js';
import {
	accuracyTrend,
	mistakeHotspots,
	activityStats,
	type AccuracyPoint,
	type Hotspot,
	type ActivityStats
} from '$lib/practice-report';

export type RepertoireReport = { accuracy: AccuracyPoint[]; hotspots: Hotspot[]; activity: ActivityStats };

const HOTSPOT_LIMIT = 10;

/**
 * Loads and aggregates one player's move_attempts for one repertoire.
 * `sinceIso` null means all-time; otherwise only attempts at or after it are
 * included. `now` is passed through to `activityStats` for its streak calc.
 */
export async function loadRepertoireReport(
	supabase: SupabaseClient,
	playerId: string,
	repertoireId: string,
	sinceIso: string | null,
	now: Date
): Promise<RepertoireReport> {
	let query = supabase
		.from('move_attempts')
		.select('move_id, is_correct, created_at')
		.eq('player_id', playerId)
		.eq('repertoire_id', repertoireId);
	if (sinceIso) query = query.gte('created_at', sinceIso);
	const { data } = await query;

	const rows = (data ?? []).map((r: any) => ({
		moveId: r.move_id as string,
		isCorrect: r.is_correct as boolean,
		createdAt: r.created_at as string
	}));

	const rangeDays = sinceIso ? Math.round((now.getTime() - new Date(sinceIso).getTime()) / (24 * 60 * 60 * 1000)) : null;

	const distinctMoveIds = [...new Set(rows.map((r) => r.moveId))];
	const { data: moveRows } = distinctMoveIds.length
		? await supabase.from('moves').select('id, san, move_number').in('id', distinctMoveIds)
		: { data: [] as any[] };
	const labels = new Map((moveRows ?? []).map((m: any) => [m.id as string, { san: m.san as string, moveNumber: m.move_number as number }]));

	return {
		accuracy: accuracyTrend(rows, rangeDays),
		hotspots: mistakeHotspots(rows, labels, HOTSPOT_LIMIT),
		activity: activityStats(rows, now)
	};
}

export type StudentSummary = {
	accuracyPct: number | null;
	sessionCount: number;
	lastPracticedAt: string | null;
	avgLevel: number | null;
};

/**
 * A roster-row summary for one student: accuracy/activity across ALL of
 * their move_attempts since `sinceIso` (matching how the existing
 * player_stats numbers on the student page are already global, not scoped
 * to this one coach's assignments), but mastery level averaged only across
 * repertoires THIS coach has assigned them (a level on a repertoire this
 * coach never assigned isn't this coach's business).
 */
export async function loadStudentSummary(
	supabase: SupabaseClient,
	coachId: string,
	playerId: string,
	sinceIso: string,
	now: Date
): Promise<StudentSummary> {
	const [{ data: assigned }, { data: attemptRows }] = await Promise.all([
		supabase.from('assigned_repertoires').select('repertoire_id').eq('coach_id', coachId).eq('player_id', playerId),
		supabase.from('move_attempts').select('is_correct, created_at').eq('player_id', playerId).gte('created_at', sinceIso)
	]);

	const repertoireIds = (assigned ?? []).map((a: any) => a.repertoire_id as string);
	const { data: levelRows } = repertoireIds.length
		? await supabase.from('level_progress').select('level').eq('player_id', playerId).in('repertoire_id', repertoireIds)
		: { data: [] as any[] };

	const rows = (attemptRows ?? []).map((r: any) => ({ isCorrect: r.is_correct as boolean, createdAt: r.created_at as string }));
	const total = rows.length;
	const correct = rows.filter((r) => r.isCorrect).length;
	const activity = activityStats(rows, now);
	const levels = (levelRows ?? []).map((r: any) => r.level as number);

	return {
		accuracyPct: total > 0 ? Math.round((correct / total) * 100) : null,
		sessionCount: activity.sessionCount,
		lastPracticedAt: activity.lastPracticedAt,
		avgLevel: levels.length > 0 ? Math.round((levels.reduce((s, l) => s + l, 0) / levels.length) * 10) / 10 : null
	};
}
```

- [ ] **Step 2: Type-check**

Run: `cd mychess && npm run check`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add mychess/src/lib/server/practice-report.ts
git commit -m "feat: add practice-report server queries"
```

---

### Task 6: Coach drill-in — Practice Report section on the student page

**Files:**
- Modify: `mychess/src/routes/(coach)/coach/players/[player_id]/+page.server.ts`
- Modify: `mychess/src/routes/(coach)/coach/players/[player_id]/+page.svelte`
- Modify: `mychess/src/routes/(coach)/coach/players/[player_id]/player-detail.test.ts`

- [ ] **Step 1: Write the failing component tests**

Add to `mychess/src/routes/(coach)/coach/players/[player_id]/player-detail.test.ts`, inside the existing `describe('coach student detail page', ...)` block (keep every existing test and the `baseData` object as-is, but add `practiceReports: []` and `range: '30d'` to `baseData` so the existing tests still render without the new section throwing on undefined data):

Change:
```ts
const baseData = {
  player: { id: 'p1', display_name: 'Paulius Konovalovas' },
  stats: { total_reviews: 40, moves_learned: 12 },
  notes: [],
  coachReps: [],
  assignedReps: [],
  playerId: 'p1'
};
```
to:
```ts
const baseData = {
  player: { id: 'p1', display_name: 'Paulius Konovalovas' },
  stats: { total_reviews: 40, moves_learned: 12 },
  notes: [],
  coachReps: [],
  assignedReps: [],
  practiceReports: [],
  range: '30d',
  playerId: 'p1'
};
```

Then add these two tests at the end of the `describe` block, right before its closing `});`:

```ts
  it('shows a Practice Report section with mastery level and mistake hotspots per repertoire', () => {
    render(PlayerDetail, {
      props: {
        data: {
          ...baseData,
          practiceReports: [
            {
              repertoireId: 'r1',
              repertoireName: 'Sicilian Defense',
              level: 2,
              report: {
                accuracy: [{ bucket: '2026-08-01', correct: 3, wrong: 1 }],
                hotspots: [{ moveId: 'm1', label: '6...e5', missCount: 4, attemptCount: 7 }],
                activity: { sessionCount: 5, lastPracticedAt: '2026-08-10T10:00:00Z', streakDays: 2 }
              }
            }
          ]
        },
        form: null
      }
    });
    expect(screen.getByText('Practice Report')).toBeTruthy();
    expect(screen.getByText('Sicilian Defense')).toBeTruthy();
    expect(screen.getByText(/Level 2/)).toBeTruthy();
    expect(screen.getByText(/6\.\.\.e5/)).toBeTruthy();
    expect(screen.getByText(/wrong 4\/7/)).toBeTruthy();
  });

  it('shows a no-activity message for a repertoire with no logged attempts in range', () => {
    render(PlayerDetail, {
      props: {
        data: {
          ...baseData,
          practiceReports: [
            {
              repertoireId: 'r1',
              repertoireName: 'Sicilian Defense',
              level: null,
              report: { accuracy: [], hotspots: [], activity: { sessionCount: 0, lastPracticedAt: null, streakDays: 0 } }
            }
          ]
        },
        form: null
      }
    });
    expect(screen.getByText('No practice activity in this range.')).toBeTruthy();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd mychess && npx vitest run "src/routes/(coach)/coach/players/[player_id]/player-detail.test.ts"`
Expected: FAIL — no "Practice Report" text exists in the rendered page yet.

- [ ] **Step 3: Extend the load function**

In `mychess/src/routes/(coach)/coach/players/[player_id]/+page.server.ts`, add the range/report loading. Full resulting file:

```ts
import { redirect, fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { loadRepertoireReport } from '$lib/server/practice-report';

const RANGE_DAYS = 30;

export const load: PageServerLoad = async ({ params, url, locals: { supabase, safeGetSession } }) => {
  const { user } = await safeGetSession();
  if (!user) throw redirect(303, '/login');

  const range = url.searchParams.get('range') === 'all' ? 'all' : '30d';
  const now = new Date();
  const sinceIso = range === 'all' ? null : new Date(now.getTime() - RANGE_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const [playerRes, statsRes, notesRes, coachRepsRes, assignedRes] = await Promise.all([
    supabase.from('profiles').select('id, display_name').eq('id', params.player_id).single(),
    supabase.from('player_stats').select('*').eq('player_id', params.player_id).single(),
    supabase.from('coach_notes').select('id, note, created_at').eq('player_id', params.player_id).order('created_at', { ascending: false }).limit(5),
    supabase.from('repertoires').select('id, name, color').eq('player_id', user.id),
    supabase
      .from('assigned_repertoires')
      .select('id, repertoire:repertoire_id(id, name, color)')
      .eq('coach_id', user.id)
      .eq('player_id', params.player_id)
  ]);

  const assignedReps = assignedRes.data ?? [];
  const practiceReports = await Promise.all(
    assignedReps.map(async (a: any) => {
      if (!a.repertoire?.id) return { repertoireId: null, repertoireName: a.repertoire?.name ?? 'Repertoire', level: null, report: null };
      const [levelRes, report] = await Promise.all([
        supabase.from('level_progress').select('level').eq('player_id', params.player_id).eq('repertoire_id', a.repertoire.id).maybeSingle(),
        loadRepertoireReport(supabase, params.player_id, a.repertoire.id, sinceIso, now)
      ]);
      return { repertoireId: a.repertoire.id, repertoireName: a.repertoire.name, level: levelRes.data?.level ?? null, report };
    })
  );

  return {
    player: playerRes.data,
    stats: statsRes.data,
    notes: notesRes.data ?? [],
    coachReps: coachRepsRes.data ?? [],
    assignedReps,
    practiceReports,
    range,
    playerId: params.player_id
  };
};

export const actions: Actions = {
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

  assignRep: async ({ params, request, locals: { supabase, safeGetSession } }) => {
    const { user } = await safeGetSession();
    if (!user) return fail(401, { error: 'Unauthorized' });

    const fd = await request.formData();
    const repId = fd.get('rep_id') as string;
    if (!repId) return fail(400, { error: 'No repertoire selected' });

    const { data: ownedRep } = await supabase
      .from('repertoires')
      .select('id')
      .eq('id', repId)
      .eq('player_id', user.id)
      .maybeSingle();
    if (!ownedRep) return fail(400, { error: 'Repertoire not found' });

    const { error } = await supabase
      .from('assigned_repertoires')
      .upsert(
        { player_id: params.player_id, coach_id: user.id, repertoire_id: repId },
        { onConflict: 'player_id,repertoire_id' }
      );

    if (error) return fail(500, { error: error.message });
    return { success: true };
  },

  unassignRep: async ({ params, request, locals: { supabase, safeGetSession } }) => {
    const { user } = await safeGetSession();
    if (!user) return fail(401, { error: 'Unauthorized' });

    const fd = await request.formData();
    const repId = fd.get('rep_id') as string;
    if (!repId) return fail(400, { error: 'No repertoire selected' });

    const { error } = await supabase
      .from('assigned_repertoires')
      .delete()
      .eq('coach_id', user.id)
      .eq('player_id', params.player_id)
      .eq('repertoire_id', repId);

    if (error) return fail(500, { error: error.message });
    return { success: true };
  }
};
```

(Only `load` changes — the `actions` export is copied verbatim, unchanged.)

- [ ] **Step 4: Add the Practice Report section to the page**

In `mychess/src/routes/(coach)/coach/players/[player_id]/+page.svelte`, insert this new `<section>` right after the existing "Repertoires" `</section>` and before the "Notes" `<section>`:

```svelte
    <section class="bg-white border border-gray-200 rounded-xl shadow-sm p-5">
      <div class="flex items-center justify-between mb-3">
        <h2 class="font-semibold text-gray-900">Practice Report</h2>
        <div class="flex gap-1 text-xs">
          <a href="?range=30d" class="px-2 py-1 rounded-full {data.range === '30d' ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-500'}">30d</a>
          <a href="?range=all" class="px-2 py-1 rounded-full {data.range === 'all' ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-500'}">All time</a>
        </div>
      </div>

      {#if data.practiceReports.length === 0}
        <p class="text-gray-400 text-sm">No repertoires assigned yet.</p>
      {:else}
        <div class="space-y-4">
          {#each data.practiceReports as pr (pr.repertoireId ?? pr.repertoireName)}
            <div class="bg-gray-50 rounded-lg p-4">
              <h3 class="font-medium text-gray-900 text-sm mb-3">
                {pr.repertoireName}
                <span class="text-gray-400 font-normal">— Level {pr.level ?? '—'}</span>
              </h3>

              {#if !pr.report || pr.report.accuracy.length === 0}
                <p class="text-gray-400 text-xs">No practice activity in this range.</p>
              {:else}
                <div class="grid grid-cols-3 gap-2 text-center text-sm mb-3">
                  <div>
                    <p class="font-bold text-gray-900">{pr.report.activity.sessionCount}</p>
                    <p class="text-xs text-gray-400">Sessions</p>
                  </div>
                  <div>
                    <p class="font-bold text-gray-900">{pr.report.activity.streakDays}</p>
                    <p class="text-xs text-gray-400">Day streak</p>
                  </div>
                  <div>
                    <p class="font-bold text-gray-900">
                      {pr.report.activity.lastPracticedAt ? new Date(pr.report.activity.lastPracticedAt).toLocaleDateString() : '—'}
                    </p>
                    <p class="text-xs text-gray-400">Last practiced</p>
                  </div>
                </div>

                <svg viewBox="0 0 {pr.report.accuracy.length * 14} 60" class="w-full h-16 mb-1" role="img"
                     aria-label="Accuracy over time for {pr.repertoireName}">
                  {#each pr.report.accuracy as point, i}
                    {@const total = point.correct + point.wrong}
                    {@const wrongH = total === 0 ? 0 : (point.wrong / total) * 46}
                    {@const correctH = total === 0 ? 0 : (point.correct / total) * 46}
                    {@const gap = wrongH > 0 && correctH > 0 ? 2 : 0}
                    <g transform="translate({i * 14}, 0)">
                      <title>{point.bucket}: {point.correct}/{total} correct</title>
                      <rect x="2" y={56 - wrongH} width="10" height={wrongH} rx="2" fill="#f87171" />
                      <rect x="2" y={56 - wrongH - gap - correctH} width="10" height={correctH} rx="2" fill="#4ade80" />
                    </g>
                  {/each}
                </svg>
                <div class="flex gap-3 text-xs text-gray-400 mb-3">
                  <span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-green-400"></span>Correct</span>
                  <span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-red-400"></span>Wrong</span>
                </div>

                {#if pr.report.hotspots.length > 0}
                  <p class="text-xs font-medium text-gray-500 mb-1">Mistake hotspots</p>
                  <ul class="text-xs text-gray-700 space-y-0.5">
                    {#each pr.report.hotspots as h (h.moveId)}
                      <li>{h.label} — wrong {h.missCount}/{h.attemptCount}</li>
                    {/each}
                  </ul>
                {/if}
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </section>

```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd mychess && npx vitest run "src/routes/(coach)/coach/players/[player_id]/player-detail.test.ts"`
Expected: PASS (all tests, existing + 2 new).

- [ ] **Step 6: Type-check**

Run: `cd mychess && npm run check`
Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add "mychess/src/routes/(coach)/coach/players/[player_id]/+page.server.ts" "mychess/src/routes/(coach)/coach/players/[player_id]/+page.svelte" "mychess/src/routes/(coach)/coach/players/[player_id]/player-detail.test.ts"
git commit -m "feat: add Practice Report section to coach student page"
```

---

### Task 7: Coach overview — `/coach/reports` roster page

**Files:**
- Create: `mychess/src/routes/(coach)/coach/reports/+page.server.ts`
- Create: `mychess/src/routes/(coach)/coach/reports/+page.svelte`
- Create: `mychess/src/routes/(coach)/coach/reports/reports.test.ts`
- Modify: `mychess/src/routes/(coach)/coach/+page.svelte`

- [ ] **Step 1: Write the failing component tests**

```ts
// mychess/src/routes/(coach)/coach/reports/reports.test.ts
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import Reports from './+page.svelte';

afterEach(() => cleanup());

describe('coach practice reports overview', () => {
  it('shows an empty state with no students', () => {
    render(Reports, { props: { data: { students: [] } } });
    expect(screen.getByText('No students yet')).toBeTruthy();
  });

  it('lists each student with their accuracy, session count, average level, and last-practiced date', () => {
    render(Reports, {
      props: {
        data: {
          students: [
            {
              player: { id: 'p1', display_name: 'Paulius Konovalovas' },
              summary: { accuracyPct: 82, sessionCount: 5, lastPracticedAt: '2026-08-10T10:00:00Z', avgLevel: 2.5 }
            }
          ]
        }
      }
    });
    expect(screen.getByText('Paulius Konovalovas')).toBeTruthy();
    expect(screen.getByText('82%')).toBeTruthy();
    expect(screen.getByText('5')).toBeTruthy();
    expect(screen.getByText('2.5')).toBeTruthy();
  });

  it('shows a dash for a student with no attempts logged yet', () => {
    render(Reports, {
      props: {
        data: {
          students: [
            {
              player: { id: 'p1', display_name: 'New Student' },
              summary: { accuracyPct: null, sessionCount: 0, lastPracticedAt: null, avgLevel: null }
            }
          ]
        }
      }
    });
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd mychess && npx vitest run "src/routes/(coach)/coach/reports/reports.test.ts"`
Expected: FAIL — `./+page.svelte` doesn't exist yet.

- [ ] **Step 3: Write the load function**

```ts
// mychess/src/routes/(coach)/coach/reports/+page.server.ts
import type { PageServerLoad } from './$types';
import { listRelationshipsForCoach } from '$lib/server/coach-players';
import { loadStudentSummary } from '$lib/server/practice-report';

const RANGE_DAYS = 30;

export const load: PageServerLoad = async ({ locals: { supabase, safeGetSession } }) => {
	const { user } = await safeGetSession();
	const { active } = await listRelationshipsForCoach(supabase, user!.id);

	const now = new Date();
	const sinceIso = new Date(now.getTime() - RANGE_DAYS * 24 * 60 * 60 * 1000).toISOString();

	const students = await Promise.all(
		active.map(async (r) => ({
			player: r.other,
			summary: await loadStudentSummary(supabase, user!.id, r.other.id, sinceIso, now)
		}))
	);

	return { students };
};
```

- [ ] **Step 4: Write the page**

```svelte
<!-- mychess/src/routes/(coach)/coach/reports/+page.svelte -->
<script lang="ts">
	let { data } = $props<{ data: any }>();
	const students = $derived<any[]>(data.students ?? []);
</script>

<svelte:head>
	<title>Practice Reports — MyChess</title>
</svelte:head>

<main class="min-h-screen bg-gray-50">
	<div class="max-w-2xl mx-auto px-4 py-6 space-y-6">
		<a href="/coach" class="text-gray-400 text-sm hover:text-gray-600 block">← Back to Dashboard</a>
		<div>
			<h1 class="text-2xl font-bold text-gray-900">Practice Reports</h1>
			<p class="text-gray-500 text-sm">Last 30 days</p>
		</div>

		{#if students.length === 0}
			<div class="bg-white border border-gray-200 rounded-xl p-8 text-center text-gray-400">
				<p class="font-medium text-gray-500">No students yet</p>
			</div>
		{:else}
			<ul class="space-y-2">
				{#each students as s (s.player.id)}
					<li>
						<a href="/coach/players/{s.player.id}"
						   class="block bg-white border border-gray-200 rounded-xl shadow-sm p-4 hover:shadow-md transition-shadow">
							<div class="flex items-center justify-between mb-2">
								<span class="font-medium text-gray-900">{s.player.display_name}</span>
								<span class="text-gray-400 text-sm">→</span>
							</div>
							<div class="grid grid-cols-4 gap-2 text-center text-sm">
								<div>
									<p class="font-bold text-gray-900">{s.summary.accuracyPct !== null ? `${s.summary.accuracyPct}%` : '—'}</p>
									<p class="text-xs text-gray-400">Accuracy</p>
								</div>
								<div>
									<p class="font-bold text-gray-900">{s.summary.sessionCount}</p>
									<p class="text-xs text-gray-400">Sessions</p>
								</div>
								<div>
									<p class="font-bold text-gray-900">{s.summary.avgLevel ?? '—'}</p>
									<p class="text-xs text-gray-400">Avg level</p>
								</div>
								<div>
									<p class="font-bold text-gray-900">
										{s.summary.lastPracticedAt ? new Date(s.summary.lastPracticedAt).toLocaleDateString() : '—'}
									</p>
									<p class="text-xs text-gray-400">Last practiced</p>
								</div>
							</div>
						</a>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</main>
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd mychess && npx vitest run "src/routes/(coach)/coach/reports/reports.test.ts"`
Expected: PASS (all 3 tests).

- [ ] **Step 6: Add a nav link from the coach dashboard**

In `mychess/src/routes/(coach)/coach/+page.svelte`, change the two-tile grid:
```svelte
    <div class="grid grid-cols-2 gap-4 mb-6">
      <a href="/coach/students"
         class="bg-white border border-gray-200 rounded-xl p-5 hover:shadow-md transition-shadow">
        <p class="text-2xl mb-2">👥</p>
        <p class="font-semibold text-gray-900">Find Players</p>
        <p class="text-sm text-gray-400">Browse and request students</p>
      </a>
      <a href="/coach/invite"
         class="bg-white border border-gray-200 rounded-xl p-5 hover:shadow-md transition-shadow">
        <p class="text-2xl mb-2">🔗</p>
        <p class="font-semibold text-gray-900">Invite Links</p>
        <p class="text-sm text-gray-400">Invite students to join</p>
      </a>
    </div>
```
to:
```svelte
    <div class="grid grid-cols-2 gap-4 mb-6">
      <a href="/coach/students"
         class="bg-white border border-gray-200 rounded-xl p-5 hover:shadow-md transition-shadow">
        <p class="text-2xl mb-2">👥</p>
        <p class="font-semibold text-gray-900">Find Players</p>
        <p class="text-sm text-gray-400">Browse and request students</p>
      </a>
      <a href="/coach/invite"
         class="bg-white border border-gray-200 rounded-xl p-5 hover:shadow-md transition-shadow">
        <p class="text-2xl mb-2">🔗</p>
        <p class="font-semibold text-gray-900">Invite Links</p>
        <p class="text-sm text-gray-400">Invite students to join</p>
      </a>
      <a href="/coach/reports"
         class="bg-white border border-gray-200 rounded-xl p-5 hover:shadow-md transition-shadow">
        <p class="text-2xl mb-2">📊</p>
        <p class="font-semibold text-gray-900">Practice Reports</p>
        <p class="text-sm text-gray-400">See how students are practicing</p>
      </a>
    </div>
```

- [ ] **Step 7: Type-check**

Run: `cd mychess && npm run check`
Expected: 0 errors.

- [ ] **Step 8: Commit**

```bash
git add "mychess/src/routes/(coach)/coach/reports" "mychess/src/routes/(coach)/coach/+page.svelte"
git commit -m "feat: add coach practice reports overview page"
```

---

### Task 8: Full verification and push

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `cd mychess && npm test`
Expected: all tests pass, including every new one from Tasks 2, 4, 6, 7.

- [ ] **Step 2: Run the full type/svelte check**

Run: `cd mychess && npm run check`
Expected: 0 errors (per `mychess/CLAUDE.md`, this must be clean before pushing to `main`).

- [ ] **Step 3: Confirm the migration ran**

Confirm with the user that they've run `0039_move_attempts.sql` from Task 1 against the live Supabase database (per `mychess/CLAUDE.md`, never assume a migration took effect without explicit confirmation) — both the new table and the `level_progress_coach_read` policy.

- [ ] **Step 4: Manual end-to-end check via dev server**

Run: `cd mychess && npm run dev`, then in the browser:
1. Log in as a player with a coach-assigned repertoire, go to `/practice/<repertoire_id>`, and play through a few attempts — get at least one move right and one wrong.
2. Log in as that player's coach (or open a second browser profile), go to `/coach/reports` — confirm the student row shows non-dash accuracy/session/last-practiced values.
3. Click into the student, confirm the new "Practice Report" section shows the repertoire's level, the accuracy bar chart (hover a bar to see its `<title>` tooltip), and — if any move was missed — a mistake hotspot line.
4. Click "All time" and back to "30d" — confirm the section content updates and the active toggle button highlights correctly.
5. Confirm a student with no assigned repertoires (or no practice history yet) shows the "No repertoires assigned yet." / "No practice activity in this range." messages instead of erroring.

- [ ] **Step 5: Push to origin**

```bash
git push
```
