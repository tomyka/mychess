# Coach screens (#381 part 5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the coach area to Ocean and fix the audit's findings: a dashboard led by Needs attention (R-229), compact progress rows with the four-state bar and a Done pill (R-231), invites split by kind (R-232), one card per repertoire on the player page, a group page that starts with progress, a readable progress drill-down, the coach note beside the comment, a clearer assignment panel, and a coach's assigned repertoires off their own Today (R-230).

**Architecture:** The coach progress reads gain each assignment's full status (deadline, overdue, paused, done, forked) next to the badges. A new batched db read, `coachDashboard`, gives every linked player's rows in one snapshot, through the same domain access step as the player page. Two pure domain functions (`attentionOf`, `playerSummary`) decide Needs attention and each player's summary line. The training snapshot leaves teaching material out of the `all` scope, and a domain predicate decides what counts as teaching material. On the web side, shared `StateBar` (two sizes), `ProgressCounts` and `AssignmentStatusLine` components serve every coach page. The pages themselves are rebuilt on part 1's cards and `PageHeader`.

**Tech Stack:** TypeScript, Next.js App Router, next-intl, Tailwind tokens, Drizzle + Postgres (Testcontainers), Vitest + Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-27-coach-screens-design.md`. Rulings R-229 to R-232.

**Commands** (from the repo root):
- domain tests: `pnpm --filter @mychess/domain exec vitest run <file>`
- db tests (Docker): `pnpm --filter @mychess/db exec vitest run <file>`
- web tests: `pnpm --filter @mychess/web exec vitest run <file>`
- typecheck: `pnpm -r typecheck`
- E2E (Docker and the local stack): `pnpm --filter @mychess/web exec playwright test <spec>`
- before each commit: format, lint, typecheck and the changed packages' tests (CLAUDE.md). Never edit gate configuration. No `any`, no `!`, no suppression comments; functions stay under complexity 10. Every user-visible string is a key in `apps/web/src/i18n/messages/en.json`.

**Conventions for every task:** components are `'use client'` only when they hold state or handlers. Tests are written first and assert what a user sees (role, name, text), not class names; the exception is where a layout rule is the behaviour, and then the test asserts the one class that carries it. A task's catalogue keys are added in the same commit as the code that uses them, and a key no longer used is removed (knip and the catalogue test catch leftovers). Commit messages end with `(#381)`.

**Pipeline per task** (`docs/agent-team.md`): developer (test first), then `qa`, then `architect` (`mp-code-review` on the task's diff), then `security-reviewer` for `- SECURITY` tasks, then `ux-designer` for `- UX` tasks, then the lead commits.

---

## File map

| File | Change |
| --- | --- |
| `packages/domain/src/coach-attention.ts` (+ test), `index.ts` | new: `attentionOf`, `playerSummary`, thresholds |
| `packages/domain/src/teaching.ts` (+ test), `index.ts` | new: `isTeachingMaterial` |
| `packages/domain/src/assignment.ts` (+ test) | `assignableTargets` marks players who have it through a group |
| `packages/db/src/assignments/badges.ts` | `coachStatus` beside `coachBadges` |
| `packages/db/src/progress/view.ts` | `EntryRead.status` |
| `packages/db/src/progress/coach-progress.ts` (+ test) | `ProgressRow.status`, `GroupProgressCell.status`; `rowOf` exported to the package |
| `packages/db/src/progress/dashboard.ts` (+ test), `pages.ts`, `index.ts` | new `coachDashboard`; `coachHomePlayers` and `deadlineReads` removed |
| `packages/domain/src/home-deadlines.ts` (+ test) | removed (replaced by `playerSummary`) |
| `packages/db/src/groups.ts` (+ test) | `coachGroups` adds each group's assignments |
| `packages/db/src/invites.ts` (+ test) | `CoachInvite.groupId`; `openGroupInvite` |
| `packages/db/src/training/snapshot.ts`, `entries.ts` (+ test) | `all` leaves out teaching material |
| `apps/web/src/server/coach-pages.ts` (+ test) | dashboard, player, group loaders reshaped |
| `apps/web/src/app/coach/state-bar.tsx` (+ test) | `size` prop; counts move to `ProgressCounts` |
| `apps/web/src/app/coach/progress-counts.tsx` (+ test) | new: counts without zeros |
| `apps/web/src/app/coach/assignment-status-line.tsx` (+ test) | new |
| `apps/web/src/app/coach/last-trained.tsx` (+ test) | short form + `LastTrainedNote` footnote |
| `apps/web/src/app/coach/needs-attention.tsx` (+ test) | new |
| `apps/web/src/app/coach/players-list.tsx` (+ test) | compact rows, desktop table, no Unlink |
| `apps/web/src/app/coach/groups-section.tsx` (+ test) | cards, New group inline |
| `apps/web/src/app/coach/invite-sheet.tsx` (+ test) | new: Invite a player |
| `apps/web/src/app/coach/invites-section.tsx` (+ test) | removed (its parts move to the sheet and the group page) |
| `apps/web/src/app/coach/page.tsx` (+ test) | the new dashboard |
| `apps/web/src/app/coach/players/[playerId]/player-view.tsx`, `progress-section.tsx` → `repertoire-cards.tsx` (+ tests) | one card per repertoire |
| `apps/web/src/app/coach/groups/[groupId]/group-view.tsx`, `progress-grid.tsx`, `rename-group-form.tsx`, `group-invite-link.tsx` (new) (+ tests) | progress first, inline rename, invite link |
| `apps/web/src/app/coach/players/[playerId]/progress/[repertoireId]/progress-view.tsx`, `line-text.ts` (new) (+ tests) | header, closed chapters, lines from the trunk |
| `apps/web/src/app/coach/players/[playerId]/repertoires/[repertoireId]/shared-repertoire-view.tsx`, `coach-note-form.tsx`, `coach-note-strip.tsx` (new) (+ tests) | note beside the comment, phone sheet |
| `apps/web/src/app/repertoires/[id]/assign-panel.tsx`, `assignee-row.tsx` (new) (+ tests) | rows, Change panel, picker label |
| `apps/web/src/app/repertoires/repertoire-list.tsx` (+ test), `apps/web/src/server/repertoires.ts` | teaching card without own bar |
| `apps/web/src/app/radio-card.tsx` or its current home (+ test) | dark selected fill |
| `apps/web/src/i18n/messages/en.json` | keys added, changed, removed |
| `apps/web/e2e/coaching.spec.ts`, `coach-progress.spec.ts`, `assignments.spec.ts`, `assignee-rows.spec.ts`, `sharing.spec.ts` | journeys through the new places |
| `docs/design/coach-shared-repertoire.md`, `docs/design/README.md` | updated |

---

### Task 0: Height budget before code (ux-designer) - UX

The pipeline requires this for layout tasks (`docs/agent-team.md`, step 4).

- [ ] **Step 1:** For the shared repertoire page (Task 13) and the group page on a phone (Task 11), write the height budget at 375x667 and 390x844 into `docs/design/coach-shared-repertoire.md` under a new "Height budget (#381 part 5)" heading. Cover what sits above the board, the board itself, the comment strip plus the one-line coach note strip, and the move rows left visible above the tab bar. For the group page, give the y position where Progress starts (target: under 160px at 390x844).
- [ ] **Step 2:** Name the board cap (container-query value) that keeps at least two move rows visible at 375x667 with both strips present. Tasks 11 and 13 build to these numbers.
- [ ] **Step 3: Commit:** `docs(design): coach screens height budget (#381)`

---

### Task 1: Needs attention and the player summary in the domain (backend-dev)

**Files:**
- Create: `packages/domain/src/coach-attention.ts`, `packages/domain/src/coach-attention.test.ts`
- Modify: `packages/domain/src/index.ts`

- [ ] **Step 1: Write the failing tests** in `coach-attention.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { ProgressCounts } from '@mychess/chess';
import {
  attentionOf,
  playerSummary,
  type AttentionInput,
  type CoachRowFacts,
} from './coach-attention';

const NOW = new Date('2026-11-27T10:00:00Z'); // Vilnius 27 Nov
const counts = (c: Partial<ProgressCounts>): ProgressCounts => ({
  notStarted: 0, skipped: 0, due: 0, learned: 0, ...c,
});
const assigned = (over: Partial<CoachRowFacts> = {}): CoachRowFacts => ({
  name: 'Slav',
  status: { deadline: null, overdue: false, paused: false, done: false, forked: false },
  counts: counts({ notStarted: 10 }),
  ...over,
});
const status = (s: Partial<NonNullable<CoachRowFacts['status']>>) => ({
  deadline: null, overdue: false, paused: false, done: false, forked: false, ...s,
});
const input = (over: Partial<AttentionInput>): AttentionInput => ({
  rows: [], lastTrained: NOW, linkedAt: new Date('2026-10-01T10:00:00Z'), ...over,
});

describe('attentionOf (R-229)', () => {
  it('is null for a player with nothing to flag', () => {
    expect(attentionOf(input({ rows: [assigned()] }), NOW)).toBeNull();
  });
  it('flags an overdue assignment first, paused ones too (R-132)', () => {
    const rows = [
      assigned({ name: 'Italian', status: status({ overdue: true, paused: true, deadline: '2026-11-25' }) }),
      assigned({ name: 'Slav', status: status({ deadline: '2026-11-28' }), counts: counts({ learned: 1, notStarted: 9 }) }),
    ];
    expect(attentionOf(input({ rows }), NOW)).toEqual({
      kind: 'overdue', repertoires: ['Italian'], days: 2,
    });
  });
  it('flags a deadline within 3 days under 80% learned, not done', () => {
    const rows = [assigned({ status: status({ deadline: '2026-11-30' }), counts: counts({ learned: 3, notStarted: 97 }) })];
    expect(attentionOf(input({ rows }), NOW)).toEqual({
      kind: 'deadlineNear', repertoire: 'Slav', days: 3, percent: 3,
    });
  });
  it('does not flag a deadline 4 days away, or one at 80%, or a done one', () => {
    const far = assigned({ status: status({ deadline: '2026-12-01' }) });
    const at80 = assigned({ status: status({ deadline: '2026-11-28' }), counts: counts({ learned: 8, notStarted: 2 }) });
    const done = assigned({ status: status({ deadline: '2026-11-28', done: true }) });
    for (const row of [far, at80, done])
      expect(attentionOf(input({ rows: [row] }), NOW)).toBeNull();
  });
  it('flags 30 or more due moves across what the coach sees', () => {
    const rows = [
      assigned({ counts: counts({ due: 20, learned: 5 }) }),
      { name: 'Taimanov', status: null, counts: counts({ due: 10 }) },
    ];
    expect(attentionOf(input({ rows }), NOW)).toEqual({ kind: 'duePile', due: 30 });
    expect(attentionOf(input({ rows: rows.slice(0, 1) }), NOW)).toBeNull();
  });
  it('flags 7 days idle with an unfinished, unpaused assignment', () => {
    const rows = [assigned()];
    const lastTrained = new Date('2026-11-20T10:00:00Z');
    expect(attentionOf(input({ rows, lastTrained }), NOW)).toEqual({ kind: 'idle', days: 7 });
    expect(attentionOf(input({ rows, lastTrained: new Date('2026-11-21T10:00:00Z') }), NOW)).toBeNull();
    const paused = [assigned({ status: status({ paused: true }) })];
    expect(attentionOf(input({ rows: paused, lastTrained }), NOW)).toBeNull();
  });
  it('counts a never-trained player from the link day', () => {
    const rows = [assigned()];
    expect(attentionOf(input({ rows, lastTrained: null, linkedAt: new Date('2026-11-20T10:00:00Z') }), NOW))
      .toEqual({ kind: 'idle', days: 7 });
    expect(attentionOf(input({ rows, lastTrained: null, linkedAt: new Date('2026-11-25T10:00:00Z') }), NOW))
      .toBeNull();
  });
  it('never flags a forked assignment (R-155)', () => {
    const rows = [assigned({ status: status({ forked: true, deadline: '2026-11-20' }), counts: null })];
    expect(attentionOf(input({ rows, lastTrained: null }), NOW)).toBeNull();
  });
});

describe('playerSummary', () => {
  it('sums the counts it may see, the earliest open deadline, and all done', () => {
    const rows = [
      assigned({ status: status({ deadline: '2026-12-20' }), counts: counts({ learned: 5, due: 5 }) }),
      assigned({ status: status({ deadline: '2026-11-30', done: true }), counts: counts({ learned: 10 }) }),
      { name: 'Taimanov', status: null, counts: counts({ notStarted: 10 }) },
    ];
    expect(playerSummary(rows)).toEqual({
      counts: counts({ learned: 15, due: 5, notStarted: 10 }),
      nextDeadline: '2026-12-20',
      allDone: false,
    });
  });
  it('is all done when every live assignment is done', () => {
    const rows = [assigned({ status: status({ done: true }) })];
    expect(playerSummary(rows).allDone).toBe(true);
  });
  it('has no counts when nothing is visible', () => {
    expect(playerSummary([])).toEqual({ counts: null, nextDeadline: null, allDone: false });
  });
});
```

- [ ] **Step 2: Run:** `pnpm --filter @mychess/domain exec vitest run src/coach-attention.test.ts`. Expected: FAIL, the module does not exist.

- [ ] **Step 3: Implement** `coach-attention.ts`:

```ts
/**
 * What the coach dashboard says of one player (R-229, R-231): the most
 * urgent reason they need attention, or none, and their summary line.
 * Pure: the reads give each row's status and counts (R-151, R-155).
 */
import { percentLearned, type ProgressCounts } from '@mychess/chess';
import type { AssignmentStatus } from './assignment';
import { daysBetween, vilniusDay } from './calendar';

/** A deadline this many Vilnius days away or fewer is near. */
export const NEAR_DEADLINE_DAYS = 3;
/** Under this share learned, a near deadline needs attention. */
export const NEAR_DEADLINE_PERCENT = 80;
/** This many due moves or more is a pile-up. */
export const DUE_PILE = 30;
/** This many Vilnius days without training is idle. */
export const IDLE_DAYS = 7;

/** One repertoire the coach may see: an assignment (status) or a share (null). */
export interface CoachRowFacts {
  readonly name: string;
  readonly status: (AssignmentStatus & { readonly deadline: string | null }) | null;
  /** Its counts where granted; null for a forked assignment (R-155). */
  readonly counts: ProgressCounts | null;
}

export interface AttentionInput {
  readonly rows: readonly CoachRowFacts[];
  readonly lastTrained: Date | null;
  readonly linkedAt: Date;
}

export type Attention =
  | { readonly kind: 'overdue'; readonly repertoires: readonly string[]; readonly days: number }
  | { readonly kind: 'deadlineNear'; readonly repertoire: string; readonly days: number; readonly percent: number }
  | { readonly kind: 'duePile'; readonly due: number }
  | { readonly kind: 'idle'; readonly days: number };

/** Whole Vilnius days from today to `day` (`YYYY-MM-DD`), negative when past. */
const daysUntil = (day: string, now: Date): number =>
  daysBetween(new Date(`${vilniusDay(now)}T12:00:00Z`), new Date(`${day}T12:00:00Z`), 'UTC');

/** A live (not forked) assignment's row. */
const live = (rows: readonly CoachRowFacts[]) =>
  rows.flatMap((row) =>
    row.status !== null && !row.status.forked ? [{ ...row, status: row.status }] : [],
  );

function overdue(rows: readonly CoachRowFacts[], now: Date): Attention | null {
  const late = live(rows).filter((row) => row.status.overdue);
  if (late.length === 0) return null;
  const days = Math.max(
    ...late.map((row) => (row.status.deadline === null ? 0 : -daysUntil(row.status.deadline, now))),
  );
  return { kind: 'overdue', repertoires: late.map((row) => row.name), days };
}

function deadlineNear(rows: readonly CoachRowFacts[], now: Date): Attention | null {
  const near = live(rows)
    .filter((row) => !row.status.done && row.status.deadline !== null && row.counts !== null)
    .map((row) => ({
      row,
      days: daysUntil(row.status.deadline ?? '', now),
      percent: percentLearned(row.counts ?? { notStarted: 0, skipped: 0, due: 0, learned: 0 }) ?? 100,
    }))
    .filter(({ days, percent }) => days >= 0 && days <= NEAR_DEADLINE_DAYS && percent < NEAR_DEADLINE_PERCENT)
    .sort((a, b) => a.days - b.days)[0];
  return near === undefined
    ? null
    : { kind: 'deadlineNear', repertoire: near.row.name, days: near.days, percent: near.percent };
}

function duePile(rows: readonly CoachRowFacts[]): Attention | null {
  const due = rows.reduce((sum, row) => sum + (row.counts?.due ?? 0), 0);
  return due >= DUE_PILE ? { kind: 'duePile', due } : null;
}

function idle(input: AttentionInput, now: Date): Attention | null {
  const unfinished = live(input.rows).some((row) => !row.status.done && !row.status.paused);
  if (!unfinished) return null;
  const days = daysBetween(input.lastTrained ?? input.linkedAt, now);
  return days >= IDLE_DAYS ? { kind: 'idle', days } : null;
}

/** The most urgent reason the player needs attention (R-229), or null. */
export function attentionOf(input: AttentionInput, now: Date): Attention | null {
  return (
    overdue(input.rows, now) ??
    deadlineNear(input.rows, now) ??
    duePile(input.rows) ??
    idle(input, now)
  );
}

/** A player's line on the dashboard (R-231). */
export interface PlayerSummary {
  /** Summed over every row with counts; null when none has any. */
  readonly counts: ProgressCounts | null;
  /** The earliest deadline of a live assignment not done. */
  readonly nextDeadline: string | null;
  /** There is a live assignment and every one is done. */
  readonly allDone: boolean;
}

const add = (a: ProgressCounts, b: ProgressCounts): ProgressCounts => ({
  notStarted: a.notStarted + b.notStarted,
  skipped: a.skipped + b.skipped,
  due: a.due + b.due,
  learned: a.learned + b.learned,
});

export function playerSummary(rows: readonly CoachRowFacts[]): PlayerSummary {
  const withCounts = rows.flatMap((row) => (row.counts === null ? [] : [row.counts]));
  const assignments = live(rows);
  return {
    counts: withCounts.length === 0 ? null : withCounts.reduce(add),
    nextDeadline:
      assignments
        .filter((row) => !row.status.done)
        .flatMap((row) => (row.status.deadline === null ? [] : [row.status.deadline]))
        .toSorted()[0] ?? null,
    allDone: assignments.length > 0 && assignments.every((row) => row.status.done),
  };
}
```

Check `daysBetween`'s signature in `calendar.ts` (`(from, to, timeZone)`). If a `'UTC'` zone argument reads poorly against the gate's CRAP or lint rules, add a small `dayDistance(a: string, b: string)` helper to `calendar.ts` with its own test instead. Then export from `index.ts`: `attentionOf`, `playerSummary`, the four constants, and the types `Attention`, `AttentionInput`, `CoachRowFacts`, `PlayerSummary`.

- [ ] **Step 4: Run** the test and `pnpm --filter @mychess/domain exec vitest run`. Expected: PASS. Split any function the CRAP report flags.
- [ ] **Step 5: Commit:** `feat(domain): who needs the coach's attention and a player's summary (R-229, R-231, #381)`

---

### Task 2: Each coach progress row carries its assignment's status (backend-dev) - SECURITY

The player page, the grid and the dashboard need the deadline and the done state, not just the badges.

**Files:**
- Modify: `packages/db/src/assignments/badges.ts`, `packages/db/src/progress/view.ts`, `packages/db/src/progress/coach-progress.ts`
- Test: `packages/db/src/progress/coach-progress.test.ts`

- [ ] **Step 1: Write the failing tests** in `coach-progress.test.ts`, reusing its seeded coach, player and assignment helpers:
  1. `coachPlayerProgress` gives an assigned row `status: { deadline: '<the row's deadline>', overdue: false, paused: false, done: false, forked: false }`. A shared row gives `status: null`.
  2. When every player move of the assignment has a Review, `status.done` is `true`.
  3. A forked assignment's row has `status.forked: true` and keeps `view.kind: 'forked'`.
  4. `coachGroupPage`'s grid cell for a member carries the same `status` as that member's player-page row.
- [ ] **Step 2: Run:** `pnpm --filter @mychess/db exec vitest run src/progress/coach-progress.test.ts`. Expected: FAIL, `status` is undefined.
- [ ] **Step 3: Implement.**

In `badges.ts`, next to `coachBadges`:

```ts
import { assignmentStatusOf, type AssignmentStatus } from '@mychess/domain';

/** The coach's full status of one player's assignment: badges plus deadline and done (R-129). */
export type CoachStatus = AssignmentStatus & { readonly deadline: string | null };

export const coachStatus = (
  facts: AssignmentFacts,
  graph: RepertoireGraph,
  tracked: ReadonlyMap<string, TrackedReview>,
  now: Date,
): CoachStatus =>
  assignmentStatusOf(facts, { graph, tracked: new Set(tracked.keys()), now });
```

In `view.ts`, add `status` to `EntryRead`:

```ts
  /** The assignment's full status; null for a shared one. */
  readonly status: (reviewed: Reviewed) => CoachStatus | null;
```

and in `entryRead`:

```ts
    status: ({ graph, tracked, now }) =>
      assignment === null ? null : coachStatus(assignment, graph, tracked, now),
```

In `coach-progress.ts`, add `readonly status: CoachStatus | null;` to `ProgressRow` and `readonly status: CoachStatus;` to `GroupProgressCell`. `rowOf` sets `status: read.status(reviewed)`. In `cellOf`, set `status` from `read.status(reviewed)`, returning null for the cell when it is null, as `badges` is handled. Export `CoachStatus` from `packages/db/src/index.ts`.

- [ ] **Step 4: Run** the db progress tests: `pnpm --filter @mychess/db exec vitest run src/progress`. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(db): coach progress rows carry the assignment's deadline and done state (#381)`

---

### Task 3: The coach dashboard read (backend-dev) - SECURITY

One snapshot for every linked player's rows. The statement count is fixed in the number of players, plus 4 per distinct repertoire and scope.

**Files:**
- Create: `packages/db/src/progress/dashboard.ts`, `packages/db/src/progress/dashboard.test.ts`
- Modify: `packages/db/src/progress/pages.ts` (remove `coachHomePlayers`, `deadlineReads`, `HomePlayer`), `packages/db/src/progress/coach-progress.ts` (export `rowOf`, `Shown` and `byNameWithinSource` within the package), `packages/db/src/index.ts`
- Remove: `packages/domain/src/home-deadlines.ts` and its test, plus their exports, once nothing imports them (knip confirms)

- [ ] **Step 1: Write the failing tests** in `dashboard.test.ts`, with the seeding helpers the progress tests use:
  1. With two linked players, one assigned a repertoire (deadline set) and one sharing a repertoire, `coachDashboard(db, coachId, now)` returns both players by display name. Each has `linkedAt`, `groups`, `lastTrained`, and `rows` equal to what `coachPlayerProgress` returns for that player (same repertoires, sources, status and view).
  2. A player who unlinked is absent. A repertoire shared with another coach is absent (Q26).
  3. A forked assignment gives a row with `view.kind: 'forked'` and no standing (R-155).
  4. Statement budget: with 5 players assigned the same repertoire, the read runs the same number of statements as with 1 player. Use the existing statement-counting helper from the #385 test (`assignee-standings.test.ts`).
- [ ] **Step 2: Run:** `pnpm --filter @mychess/db exec vitest run src/progress/dashboard.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `dashboard.ts`:

```ts
/**
 * The coach dashboard's one read (R-229, #381): every linked player with
 * the rows the player page would show them (coachPlayerProgress), read in
 * one repeatable-read snapshot. The domain decides (isCoachLinked,
 * progressRepertoires), each entry loads through its scope (entryRead,
 * Q26), and each repertoire loads once per scope. Statements: fixed in
 * players, plus 4 per distinct repertoire and scope.
 */
import type { TrackedReview } from '@mychess/chess';
import { isCoachLinked, progressRepertoires, scopeKey } from '@mychess/domain';
import { REPEATABLE_READ, type Db, type Executor } from '../client';
import { coachPlayers, type LinkedAccount } from '../coaching';
import { trackedReviews } from '../training/reviews';
import { byNameWithinSource, rowOf, type ProgressRow, type Shown } from './coach-progress';
import { coachProgressFacts, lastTrained } from './facts';
import { entryRead, keysOf, loadVisible, type LoadedGraph } from './view';

export interface DashboardPlayer extends LinkedAccount {
  readonly lastTrained: Date | null;
  readonly rows: readonly ProgressRow[];
}

/** Loads each (scope, repertoire) once for the whole read. */
function graphCache(tx: Executor) {
  const cache = new Map<string, Promise<LoadedGraph | undefined>>();
  return (scope: Parameters<typeof loadVisible>[1], id: string) => {
    const key = `${scopeKey(scope)}:${id}`;
    const hit = cache.get(key) ?? loadVisible(tx, scope, id);
    cache.set(key, hit);
    return hit;
  };
}

export function coachDashboard(db: Db, coachId: string, now: Date): Promise<DashboardPlayer[]> {
  return db.transaction(async (tx) => {
    const players = await coachPlayers(tx, coachId);
    const facts = await coachProgressFacts(tx, coachId, players.map((p) => p.id));
    const load = graphCache(tx);
    const shownBy = new Map<string, Shown[]>();
    for (const [playerId, one] of facts) {
      if (!isCoachLinked(coachId, playerId, one)) continue;
      const viewer = { coachId, playerId, facts: one };
      const shown: Shown[] = [];
      for (const entry of progressRepertoires(coachId, playerId, one)) {
        const read = entryRead(entry, viewer);
        const loaded = await load(read.scope, entry.repertoireId);
        if (loaded !== undefined) shown.push({ loaded, read });
      }
      shownBy.set(playerId, byNameWithinSource(shown));
    }
    const graphs = [...new Set([...shownBy.values()].flat().map((s) => s.loaded.graph))];
    const tracked = await trackedReviews(tx, [...shownBy.keys()], keysOf(graphs));
    const last = await lastTrained(tx, coachId, facts);
    const none: ReadonlyMap<string, TrackedReview> = new Map();
    return players.flatMap((player) => {
      const shown = shownBy.get(player.id);
      if (shown === undefined) return [];
      const reviews = tracked.get(player.id) ?? none;
      return [{
        ...player,
        lastTrained: last.get(player.id) ?? null,
        rows: shown.map((one) => rowOf(one, reviews, now)),
      }];
    });
  }, REPEATABLE_READ);
}
```

Split the per-player loop into a `shownOf(load, viewer)` helper if complexity goes over 10. Export `coachDashboard` and `DashboardPlayer` from `index.ts`, and remove `coachHomePlayers` and `HomePlayer`. Delete `home-deadlines.ts` and its exports from `packages/domain/src/index.ts` once nothing imports them.

- [ ] **Step 4: Keep the tree green.** `coachHomeData` (web) imports `coachHomePlayers`. In this task, switch it to `coachDashboard` with the smallest change: map each player to the old `{ nearestDeadline, overdue }` shape through `playerSummary` and the rows' `status.overdue`. Task 8 reshapes it fully.
- [ ] **Step 5: Run** `pnpm --filter @mychess/db exec vitest run src/progress`, `pnpm --filter @mychess/domain exec vitest run`, `pnpm --filter @mychess/web exec vitest run src/server/coach-pages.test.ts` and `pnpm -r typecheck`. Expected: PASS.
- [ ] **Step 6: Commit:** `feat(db): one batched read for the coach dashboard (R-229, #381)`

---

### Task 4: Groups list their assignments; the open group invite (backend-dev) - SECURITY

**Files:**
- Modify: `packages/db/src/groups.ts` (`CoachGroupSummary.assignments`), `packages/db/src/invites.ts` (`CoachInvite.groupId`, `openGroupInvite`), `packages/db/src/progress/pages.ts` (`GroupPage.invite`)
- Test: `packages/db/src/groups.test.ts`, `packages/db/src/invites.test.ts`, `packages/db/src/progress/pages.test.ts`

- [ ] **Step 1: Failing tests:**
  1. `coachGroups(db, coachId)` gives each group `assignments: [{ repertoireId, name, deadline }]` by repertoire name, holding only this coach's assignments to that group. A group with none has `[]`.
  2. `coachInvites` rows carry `groupId` (null for a personal invite).
  3. `openGroupInvite(db, coachId, groupId, now)` gives the newest open group invite's `{ id, expiresAt }`. It gives undefined after a revoke, after expiry, and for another coach's group. It never returns a token or its hash.
  4. `coachGroupPage` returns `invite` equal to `openGroupInvite`'s result, or null.
- [ ] **Step 2: Run** each file. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `coachGroups`: one extra statement joining `assignments` (where `coachId` and `groupId` are set) to `repertoires` for the name. Group the rows in TypeScript by group id. Parse them with zod as the existing `summaryRowsSchema` does.
  - `openGroupInvite`: `namedInviteQuery(db, and(openInvitesOf(coachId, now), eq(invites.groupId, groupId)))`, ordered newest first, limit 1.
  - Add `groupId: row.groupId` to the `coachInvites` mapping, extending `namedInvitesSchema` if it lacks the column.
- [ ] **Step 4: Run** the three test files. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(db): a group's assignments and its open invite (R-232, #381)`

---

### Task 5: Teaching material leaves the coach's Today (backend-dev)

**Files:**
- Create: `packages/domain/src/teaching.ts` (+ test)
- Modify: `packages/domain/src/index.ts`, `packages/db/src/training/snapshot.ts`, `packages/db/src/training/entries.ts`
- Test: `packages/db/src/training/snapshot.test.ts`

- [ ] **Step 1: Failing domain test** in `teaching.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isTeachingMaterial } from './teaching';

describe('isTeachingMaterial (R-230)', () => {
  it('is an own repertoire assigned to at least one player or group', () => {
    const assigned = new Set(['r1']);
    expect(isTeachingMaterial({ kind: 'own', repertoireId: 'r1' }, assigned)).toBe(true);
    expect(isTeachingMaterial({ kind: 'own', repertoireId: 'r2' }, assigned)).toBe(false);
    expect(isTeachingMaterial({ kind: 'assigned', repertoireId: 'r1' }, assigned)).toBe(false);
  });
});
```

Implementation:

```ts
/** A coach's own repertoire they assigned to anyone is teaching material, not their training (R-230). */
export const isTeachingMaterial = (
  entry: { readonly kind: 'own' | 'assigned'; readonly repertoireId: string },
  assignedByMe: ReadonlySet<string>,
): boolean => entry.kind === 'own' && assignedByMe.has(entry.repertoireId);
```

- [ ] **Step 2: Failing db tests** in `snapshot.test.ts`:
  1. A coach owns R1 (assigned to a group with no members) and R2 (not assigned). `trainingSnapshot(db, coachId, { kind: 'all' }, now)` gives entries `[R2]` and `others` containing R1.
  2. `trainingSnapshot(db, coachId, { kind: 'repertoire', repertoireId: R1 }, now)` still returns R1, so Train here works.
  3. After unassigning R1 from everyone, the `all` scope has R1 again.
- [ ] **Step 3: Implement.** In `entries.ts`, add `assignedByMe(tx, playerId): Promise<Set<string>>`, which selects distinct `assignments.repertoireId` where `coachId = playerId`, parsed with zod. In `snapshot.ts`, `scoped` for `kind: 'all'` keeps only entries where `!isTeachingMaterial({ kind: e.kind, repertoireId: e.repertoire.id }, assigned)`. `othersOf` then lists the teaching ones as others, so their keys stay held.
- [ ] **Step 4: Run** `pnpm --filter @mychess/domain exec vitest run src/teaching.test.ts` and `pnpm --filter @mychess/db exec vitest run src/training`. Expected: PASS. The web Today tests (`apps/web/src/server/training.test.ts`) use fakes, so run them to confirm they still pass.
- [ ] **Step 5: Commit:** `feat: a coach's assigned repertoires leave their own Today (R-230, #381)`

---

### Task 6: The picker says who has it through a group (backend-dev)

**Files:**
- Modify: `packages/domain/src/assignment.ts` (`assignableTargets`)
- Test: `packages/domain/src/assignment.test.ts`

- [ ] **Step 1: Failing test:** players `p1` and `p2`, group `g1` assigned and holding `p1`. `assignableTargets` returns `p1` with `viaGroups: ['U1600']` and `p2` with `viaGroups: []`, both still offered (R-134).
- [ ] **Step 2: Implement:** add an optional fourth argument `reachedBy: ReadonlyMap<string, readonly string[]>` (player id to the names of the groups this repertoire reaches them through), and map each offered player to `{ ...player, viaGroups: reachedBy.get(player.id) ?? [] }`. Update `AssignableTargets` so `players` is `readonly (P & { readonly viaGroups: readonly string[] })[]`. In `apps/web/src/server/coach-assignments.ts`, build `reachedBy` from `assignments` (each group-target assignment's `players`) and pass it.
- [ ] **Step 3: Run** the domain test and `pnpm --filter @mychess/web exec vitest run src/server/coach-assignments.test.ts`. Expected: PASS.
- [ ] **Step 4: Commit:** `feat(domain): the assign picker knows who has a repertoire through a group (#381)`

---

### Task 7: Shared progress pieces (web-dev) - UX

**Files:**
- Modify: `apps/web/src/app/coach/state-bar.tsx`, `apps/web/src/app/coach/last-trained.tsx`
- Create: `apps/web/src/app/coach/progress-counts.tsx`, `apps/web/src/app/coach/assignment-status-line.tsx`
- Test: `state-bar.test.tsx`, `progress-counts.test.tsx`, `assignment-status-line.test.tsx`, `last-trained.test.tsx`
- Modify: `apps/web/src/i18n/messages/en.json`

- [ ] **Step 1: Failing tests:**
  - `StateBar` renders only the bar (`aria-hidden`). `size="row"` carries `h-1.5` and `size="header"` carries `h-2`: this is the layout rule, so assert the class.
  - `ProgressCounts` with counts `{ learned: 1, due: 43, skipped: 0, notStarted: 28 }` reads "1 learned · 43 due · 28 to learn", with no "0 marked as known". With all zero except `notStarted: 12` it reads "Not started · 12 moves". When mastered it shows the Mastered pill. The due part is in the `text-due` tone: assert that one class.
  - `AssignmentStatusLine`:
    - deadline `2026-11-30` on 27 Nov reads "Due 30 Nov · in 3 days" in the due tone;
    - on the day it reads "due today";
    - `overdue` shows the Overdue pill;
    - `paused` shows the Paused pill;
    - `done` shows the Done pill;
    - no deadline reads "No deadline";
    - `wording="deadline"` reads "deadline 30 Nov";
    - the tone is not amber when more than 3 days away or done.
  - `LastTrained` short form: "today", "yesterday", "5 days ago", "never". `LastTrainedNote` renders the footnote "Last trained counts only the repertoires you can see."
- [ ] **Step 2: Run** the four files. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `StateBar({ counts, size })` keeps today's three segments and the `nothing` case. The counts text moves out to `ProgressCounts`.
  - `ProgressCounts({ counts, mastered })` builds the parts from `coach.progress.part.{learned,due,skipped,notStarted}` keys, keeps the non-zero ones and joins them with " · ". It uses `coach.progress.notStarted` when only `notStarted` is non-zero.
  - `AssignmentStatusLine({ status, now, wording })` takes `CoachStatus` and a `now` string (today's Vilnius day from the loader, so server and browser match). It formats dates with `MEDIUM_DATE` and uses `NEAR_DEADLINE_DAYS` from `@mychess/domain` for the tone.
  - Catalogue keys go under `coach.progress` and `coach.status` (new). Remove `coach.progress.counts`, `today`, `yesterday`, `daysAgo` and `neverTrained` once nothing uses them (Tasks 8 to 12). Leave the old keys until then; the last task that drops a use removes the key.
- [ ] **Step 4: Run** the four test files. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(web): shared coach progress pieces: bar sizes, counts without zeros, status line (R-231, #381)`

---

### Task 8: The dashboard (web-dev) - UX

**Files:**
- Modify: `apps/web/src/server/coach-pages.ts` (+ test), `apps/web/src/app/coach/page.tsx` (+ test), `players-list.tsx` (+ test), `groups-section.tsx` (+ test)
- Create: `apps/web/src/app/coach/needs-attention.tsx` (+ test)

- [ ] **Step 1: Loader (failing test first).** `coachHomeData` returns `{ attention, players, groups, today }`, where:
  - `players[i]` is `{ id, displayName, lastTrainedDays, summary }` (`summary` from `playerSummary`);
  - `attention` is `[{ player: { id, displayName }, reason }]`, built by `attentionOf` for every player with a reason and ordered by reason kind (overdue, deadlineNear, duePile, idle), then by name;
  - `groups` is `coachGroups` with assignments;
  - `today` is `vilniusDay(now)`;
  - `invites` leaves the dashboard; the sheet loads them (Task 9).

  Convert each `ProgressRow` to `CoachRowFacts` with `{ name: row.repertoire.name, status: row.status, counts: row.view.kind === 'granted' ? row.view.standing.counts : null }`. Test with the file's existing db fakes: two players, one overdue, which comes first in `attention`.
- [ ] **Step 2: `NeedsAttention` (failing tests):** given one reason of each kind, it renders the heading "Needs attention · 4". Each card is a link named by the player, with the reason text:
  - "Italian is 2 days overdue"; with two repertoires, "2 repertoires overdue";
  - "Slav due in 3 days · 3% learned";
  - "52 moves due";
  - "Has not trained for 12 days".

  An empty list renders nothing. Tone classes per reason (the 3px left edge: `border-l-error`, `border-l-due`, `border-l-border-strong`): assert one.
- [ ] **Step 3: `PlayersList` (failing tests):**
  - one link row per player with name, last trained (short form), `StateBar` row size, "% learned", due (when above zero), and "next deadline 30 Nov" or the Done pill;
  - "Nothing assigned or shared" when `summary.counts` is null;
  - no Unlink button anywhere;
  - `LastTrainedNote` once under the list;
  - desktop: the same list renders as a `table` from `md` (headers Player, Progress, Due, Next deadline, Last trained). Render both a list for phones (`md:hidden`) and the table (`hidden md:table`), and assert both carry the rows' names.
- [ ] **Step 4: `GroupsSection` (failing tests):**
  - group cards linking to the group page, with "6 players" and each assignment "Slav Defence · due 30 Nov";
  - a **New group** button reveals the existing create form inline, and Cancel hides it again;
  - after creating, the fresh link shows, as today (R-204).
- [ ] **Step 5: Page:** `PageHeader` with title "Coach" and an `actions` slot holding the **Invite a player** button (Task 9 wires the sheet; until then the button is not rendered). The layout is `NeedsAttention`, `PlayersList`, `GroupsSection` in one column; from `lg` it becomes a `grid-cols-[2fr_1fr]` with groups in the side column. Empty state: no players gives one line on how to invite.
- [ ] **Step 6: Run** the coach folder's tests: `pnpm --filter @mychess/web exec vitest run src/app/coach src/server/coach-pages.test.ts`. Expected: PASS. Remove the catalogue keys no longer used (`coach.players.unlink*` stays because the player page uses it).
- [ ] **Step 7: Commit:** `feat(web): coach dashboard leads with who needs attention (R-229, R-231, #381)`

---

### Task 9: Invite a player sheet (web-dev) - UX, SECURITY

**Files:**
- Create: `apps/web/src/app/coach/invite-sheet.tsx` (+ test)
- Modify: `apps/web/src/app/coach/page.tsx`, `apps/web/src/server/coach-pages.ts` (`personalInvites`)
- Remove: `apps/web/src/app/coach/invites-section.tsx` (+ test), once the group link (Task 11) has taken its group part

- [ ] **Step 1: Failing tests:**
  - The **Invite a player** button opens a dialog named "Invite a player", with one explanatory sentence and **Create link**.
  - Creating calls the existing personal-invite action (from `actions.ts`, the one `InvitesSection` uses with kind `personal`). The created link then shows in a read-only textbox with **Copy** and "This link is shown once and works for one player until <date>".
  - Open personal invites list "made 20 Nov · expires 4 Dec", each with **Revoke**, which confirms before revoking.
  - A refusal (invite limit, Coach mode off) shows in the dialog's status line.
  - Escape closes the dialog and returns focus to the button.
- [ ] **Step 2: Implement** with the app's existing dialog/sheet primitive (the one the part-4 Repertoire screen or the training screen uses; find it with `rg "role=\"dialog\"|<dialog" apps/web/src/app`). It is a bottom sheet under `md` and a centred dialog from `md`. Reuse `FreshLink` for the shown-once link. The loader adds `personalInvites` (from `coachInvites`, `kind === 'personal'`) to `coachHomeData`.
- [ ] **Step 3: Run** the tests. Expected: PASS.
- [ ] **Step 4: Commit:** `feat(web): invite a player from a sheet; group invites move to the group (R-232, #381)`

---

### Task 10: The player page (web-dev) - UX

**Files:**
- Modify: `apps/web/src/app/coach/players/[playerId]/player-view.tsx` (+ test), `apps/web/src/server/coach-pages.ts` (+ test)
- Create: `apps/web/src/app/coach/players/[playerId]/repertoire-cards.tsx` (+ test)
- Remove: `progress-section.tsx` (+ test)

- [ ] **Step 1: Loader (failing test):** `coachPlayerData` returns `{ id, displayName, linkedAt, groups, lastTrainedDays, today, cards }`. `cards` is one entry per row, merging a forked assignment with its shared fork: when a row has `view.kind === 'forked'` and `view.sharedForkId` names a shared row, the two become one card. That card has `tag: 'ownCopy'`, the shared row's standing and links, and the shared row is dropped. Order the cards: overdue first, then by deadline (soonest first, none last), then shared ones by name. Test with a fake read holding an assignment, a forked assignment whose fork is shared, and a plain share: 3 rows become 2 cards in that order.
- [ ] **Step 2: `RepertoireCards` (failing tests):**
  - an assigned card shows the name, the "Assigned" tag, `AssignmentStatusLine`, `StateBar` and `ProgressCounts`, a **Progress** link to `coachProgressPath` and an **Open repertoire** link to the coach's `repertoireRoute(id)`;
  - a shared card shows "Shared with you" and **Open & add notes** to `coachSharedRepertoirePath`;
  - an own-copy card shows "Gabija's own copy", with progress when shared. When not shared it shows "Your progress view ended when Gabija made their own copy." and has no links;
  - cards are in a list (`ul`): one column, and `md:grid-cols-2`.
- [ ] **Step 3: `PlayerView`:** `PageHeader` with back to Coach. Under the name, one meta line: last trained (short form), "linked since 12 Oct", and the groups as links. Then `RepertoireCards`, then `LastTrainedNote`. **Unlink <name>** goes in the error tone with the existing `ConfirmedAction`: in the header's `actions` from `md`, and at the bottom under `md` (render one, placed by a container class; assert there is exactly one Unlink button). The Shared repertoires and Groups sections are removed.
- [ ] **Step 4: Run** the folder's tests. Expected: PASS. Remove the unused catalogue keys (`coach.shared.*` that only the old section used, `coach.player.groupsTitle`, `coach.progress.forkedNote` and similar).
- [ ] **Step 5: Commit:** `feat(web): one card per repertoire on the coach's player page (R-231, #381)`

---

### Task 11: The group page (web-dev) - UX, SECURITY

**Files:**
- Modify: `apps/web/src/app/coach/groups/[groupId]/group-view.tsx`, `progress-grid.tsx`, `rename-group-form.tsx` (+ tests), `apps/web/src/server/coach-pages.ts` (`coachGroupData` adds `invite`, `assignments`, `today`)
- Create: `apps/web/src/app/coach/groups/[groupId]/group-invite-link.tsx` (+ test)

- [ ] **Step 1: Failing tests:**
  - Header: the group name as `h1` with a **Rename** button. Pressing it replaces the title with the rename form (Save, Cancel). Cancel restores the title and returns focus to Rename. The meta line reads "6 players · Slav Defence due 30 Nov".
  - Progress comes before every other section in document order (assert the heading order).
  - Phone list (`md:hidden`): one card per member with name and last trained, and one line per group repertoire with `StateBar` row size, %, due, or a Done / Not started / Overdue / Paused pill.
  - Grid (`hidden md:table`): the player column's header is "Player", and each repertoire is a column with Last trained last. Each cell links to the member's progress on it. The "Last trained … on the repertoires you can see" sentence is gone from the cells, and `LastTrainedNote` shows once.
  - **Assigned to this group:** each repertoire with "due 30 Nov" and "1 done of 6" (count of cells with `status.done`), linking to `repertoireManageRoute(id)`.
  - `GroupInviteLink`:
    - with an open invite it reads "An open link expires 10 Dec"; with none, "No open link";
    - it always shows the hint "Links are shown once; make a new one to share again.";
    - **New link** calls the existing group-invite action and shows the link with Copy inline.
  - **Players:** members with **Remove** (error tone, confirmed) and **Add a player** (the existing picker, inline). **Delete group** is in the error tone, confirmed.
  - With Coach mode off (R-113), Rename, Remove, Add, New link and Delete are not rendered, and one line says why.
- [ ] **Step 2: Implement** to the Task 0 height budget: Progress starts under 160px at 390x844. Desktop layout is `lg:grid-cols-[2fr_1fr]`, with the grid on the left and assignments, invite link and players on the right.
- [ ] **Step 3: Run** the folder's tests and `src/server/coach-pages.test.ts`. Expected: PASS. Delete `invites-section.tsx` (+ test) now that both invite kinds have moved, and remove its catalogue keys.
- [ ] **Step 4: Commit:** `feat(web): the group page starts with progress; its invite link lives here (R-231, R-232, #381)`

---

### Task 12: The progress drill-down (web-dev) - UX

**Files:**
- Modify: `apps/web/src/app/coach/players/[playerId]/progress/[repertoireId]/progress-view.tsx` (+ test), `apps/web/src/server/coach-progress.ts` (+ test, adds `status`, `tag`, `today`)
- Create: `.../progress/[repertoireId]/line-text.ts` (+ test)

- [ ] **Step 1: Failing tests for `lineTexts`** (pure):

```ts
import { describe, expect, it } from 'vitest';
import { lineTexts } from './line-text';

describe('lineTexts', () => {
  it('writes each line from where it leaves the chapter trunk', () => {
    const lines = [
      ['d4', 'd5', 'c4', 'c6', 'Nf3', 'Nf6', 'Nc3', 'dxc4', 'a4', 'Bf5'],
      ['d4', 'd5', 'c4', 'c6', 'Nf3', 'Nf6', 'Nc3', 'dxc4', 'e4', 'b5'],
    ];
    expect(lineTexts(lines, true)).toEqual(['… 5. a4 Bf5', '… 5. e4 b5']);
  });
  it('numbers a Black move after the trunk with an ellipsis', () => {
    const lines = [['e4', 'c5', 'Nf3', 'e6'], ['e4', 'c5', 'Nf3', 'd6']];
    expect(lineTexts(lines, true)).toEqual(['… 2... e6', '… 2... d6']);
  });
  it('writes a one-line chapter in full', () => {
    expect(lineTexts([['e4', 'e5']], true)).toEqual(['1. e4 e5']);
  });
  it('numbers a Black-first chapter from 1...', () => {
    // 1... e5 2. Nf3 is the trunk; the lines part at Black's second move.
    expect(lineTexts([['e5', 'Nf3', 'Nc6'], ['e5', 'Nf3', 'd6']], false)).toEqual(['… 2... Nc6', '… 2... d6']);
  });
  it('writes a line that ends inside the trunk from its last move', () => {
    expect(lineTexts([['e4', 'e5'], ['e4', 'e5', 'Nf3']], true)).toEqual(['… 1... e5', '… 1... e5 2. Nf3']);
  });
});
```

Number moves with `move-list.tsx`'s numbering helper: reuse it if it is exported, and export it if not, rather than writing a second one.

- [ ] **Step 2: Implement** `lineTexts(lines: readonly (readonly string[])[], whiteFirst: boolean): string[]`: compute the common prefix length across the lines, cap it at `min(length) - 1`, and use 0 for a single line. Number from the root as the repertoire page does, prefixing "… " when the prefix is non-empty.
- [ ] **Step 3: Failing view tests:**
  - The header shows back to the player, the name ("Gabija's own copy of Najdorf" for a fork), the tag, `AssignmentStatusLine`, `StateBar` header size, `ProgressCounts`, and **Open repertoire** or **Open & add notes**.
  - Chapters are `details` elements closed by default, each summary showing the full title, `StateBar`, %, and due or "Not started · N moves" or Mastered.
  - Each line inside shows `lineTexts` output with its state on the right ("4 due", "Not started", Mastered, "N% learned").
- [ ] **Step 4: Run** the folder's tests and `src/server/coach-progress.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(web): a readable progress drill-down; lines from where they leave the trunk (#381)`

---

### Task 13: The coach note beside the comment (web-dev) - UX

**Files:**
- Modify: `.../repertoires/[repertoireId]/shared-repertoire-view.tsx`, `coach-note-form.tsx` (+ tests)
- Create: `.../repertoires/[repertoireId]/coach-note-strip.tsx` (+ test)
- Modify: `docs/design/coach-shared-repertoire.md`

- [ ] **Step 1: Failing tests:**
  - **Header row:** back to the player and **Progress** links sit in one row. The name is shown, with the tag "Shared with you · read-only". The old "Read-only…" sentence is gone.
  - **Desktop (`hidden md:block` card in the comment strip slot, under the comment):** the heading is "My coach note on 5... Qc7 · you and Gabija see this", followed by the note text and **Edit** / **Delete**. Without a note it shows **Add a note**. Edit swaps in the textarea with Save and Cancel; Save calls the existing note action and shows the new text.
  - **Phone (`md:hidden` strip):** the pen glyph, the note on one line (`line-clamp-1`: the layout rule, assert it) and **Edit** (or **Add a note**). Edit opens a dialog named "Coach note" with the textarea, Save and Delete. Closing it returns focus to Edit.
  - The move list's pen mark is unchanged: run the existing `move-list` coach-mark test.
  - The note is no longer rendered after the move list (assert the order).
- [ ] **Step 2: Implement.** Use the part-4 shell's comment strip slot (`RepertoireShell`'s `commentStrip` prop). Pass a fragment holding the `CommentStrip` and the new note card or strip. Use the same dialog primitive as Task 9. Build to Task 0's board cap at 375x667.
- [ ] **Step 3:** Update `docs/design/coach-shared-repertoire.md`. In "Coach's view", the note now sits with the comment strip, as a card on desktop and a strip plus sheet on a phone. The note form's text moves there.
- [ ] **Step 4: Run** the folder's tests. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(web): the coach note sits with the comment, a sheet on a phone (#381)`

---

### Task 14: Assignments on the Repertoire screen (web-dev) - UX

**Files:**
- Modify: `apps/web/src/app/repertoires/[id]/assign-panel.tsx` (+ test)
- Create: `apps/web/src/app/repertoires/[id]/assignee-row.tsx` (+ test)
- Modify: `apps/web/src/server/coach-assignments.ts` (`today`, statuses) if the panel lacks them

- [ ] **Step 1: Failing tests:**
  - A player row shows the name, `StateBar` row size, "% learned", due (amber), "deadline 20 Dec" (never "due 20 Dec"), and the Overdue / Paused / Done pill from the row's badges and standing. A fork row shows "Own copy" and no bar.
  - A group row shows the group name and "deadline 20 Dec".
  - **Change** opens an inline panel with:
    - a date input labelled "Deadline", with "Fri, 20 Dec" shown beside it (`MEDIUM_DATE`);
    - **Save deadline** (primary) and **Clear deadline** (a text button);
    - **Unassign**, set apart, in the error tone, which asks to confirm and says what happens (R-130).
  - In the picker, a player with `viaGroups: ['U1600']` is still offered, labelled "has it via U1600 · assigning sets their own deadline".
  - **Assign** is a primary button.
- [ ] **Step 2: Implement.** The Done pill needs the domain's done rule (every own move tracked, R-129), which the standing alone does not give. Extend `coachAssigneeStandings` to return `{ standing, status }` per player, using `read.status` from Task 2 in the same snapshot. `coachAssignData` passes both to the panel. Add a db test case to `assignee-standings.test.ts` for the status, keeping its statement budget.
- [ ] **Step 3: Run** `pnpm --filter @mychess/web exec vitest run src/app/repertoires/[id]` and the db file. Expected: PASS.
- [ ] **Step 4: Commit:** `feat: clearer assignment rows and deadline changes on the Repertoire screen (R-231, #381)`

---

### Task 15: My repertoires shows teaching material as such (web-dev) - UX

**Files:**
- Modify: `apps/web/src/server/repertoires.ts` (+ test), `apps/web/src/app/repertoires/repertoire-list.tsx` (+ test)

- [ ] **Step 1: Failing test:** an own repertoire with `assignedTo: 3` renders "Assigned to 3" in its meta line, with no `LearnedBar` and no "% learned" or due text. An own repertoire with `assignedTo: 0` keeps its standing line.
- [ ] **Step 2: Implement:** the card skips `StandingLine` when `assignedTo > 0` for an own repertoire. The standing is absent anyway, since Today no longer lists it (Task 5); make the card's branch explicit so an empty standing never shows "New".
- [ ] **Step 3: Run** the two files. Expected: PASS.
- [ ] **Step 4: Commit:** `feat(web): a coach's assigned repertoire shows its assignees, not their own bar (R-230, #381)`

---

### Task 16: The selected radio card in dark (web-dev) - UX

**Files:** find the radio card with `rg "has-\[:checked\]|peer-checked" apps/web/src/app --glob '*.tsx'` and modify it, plus its test.

- [ ] **Step 1: Failing test:** the selected card carries `bg-accent-subtle` and `ring-accent` in both themes (the token classes; assert them), and no `dark:bg-*` override that darkens it.
- [ ] **Step 2: Implement** and run the file. Expected: PASS.
- [ ] **Step 3: Commit:** `fix(web): the selected radio card is a tint, not a hole, in dark (#381)`

---

### Task 17: E2E journeys (qa)

**Files:** `apps/web/e2e/coaching.spec.ts`, `coach-progress.spec.ts`, `assignments.spec.ts`, `assignee-rows.spec.ts`, `sharing.spec.ts`; persona seeds only if a journey lacks data (`docs/personas/`).

- [ ] **Step 1:** Update the journeys to the new places:
  - invite a player through the sheet;
  - create a group and its link from Groups, and make a new link on the group page;
  - unlink from the player page;
  - rename a group inline;
  - change a deadline, clear it and unassign on the Repertoire screen;
  - write, edit and delete a coach note (desktop card).
- [ ] **Step 2:** Add a dashboard journey: the persona seed's overdue player is first under Needs attention with "overdue". Tag it `@mobile`.
- [ ] **Step 3:** Add a phone journey (`@mobile`): on the shared repertoire, step to a move with the coach's note. The note strip is visible without scrolling, and Edit opens the sheet.
- [ ] **Step 4:** Add a journey for the coach's Today: the coach persona's assigned repertoires are not listed.
- [ ] **Step 5: Run** each spec: `pnpm --filter @mychess/web exec playwright test <spec>`. Expected: PASS on desktop and Pixel 7.
- [ ] **Step 6: Commit:** `test(e2e): coach journeys through the part 5 screens (#381)`

---

### Task 18: Sign-off (ux-designer, lead)

- [ ] **Step 1:** ux-designer screenshots every route from the spec at 390x844, 375x667, 1280x800 and 1440x900 in light and dark, and checks each audit finding against the spec. Contrast notes go in `docs/design/README.md`.
- [ ] **Step 2:** Lead: `node quality/gate.mjs check` and grep its log for PASSED; push; CI green including E2E.
- [ ] **Step 3:** After the slice: `mp-code-review` on the slice diff, `improve-codebase-architecture` on its files, `retro`. Comment the commit range and CI result on #381. #381 stays open until part 6.
