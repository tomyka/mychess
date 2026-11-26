# Repertoire screens (#381 part 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle My repertoires, the repertoire page (browse and builder), the assigned repertoire and PGN import to Ocean and fix the audit's 20 findings: progress on cards, chapter rows and assignee rows (R-225), the repertoire's actions on their own Repertoire screen (R-226), one "I know this" control (R-227), a pinned comment strip, a two-column move list, a header inside the board block, and a calmer import preview.

**Architecture:** Chess exports the day's tracked Reviews so the server can run the existing `progressOf` for one repertoire; the repertoire page's training gains its standing and per-chapter standings, and My repertoires reads each repertoire's standing from the request-cached Today list. A shared `StandingLine` (bar, "N% learned", due, Mastered/New) serves Today, the list, the chapter rows and the coach's assignee rows. The repertoire-view shell gets a `RepertoireTopBar` slot that renders as the phone top bar and as the first row of the desktop panel, a `CommentStrip` between the board row and the scroller, and a `TrainHere` block replacing `KnowSection`, the chapter rows' menus and Learn links. Rename, download, add from PGN, share, assign, pause, copy and delete move to new `/manage` pages.

**Tech Stack:** TypeScript, Next.js App Router, next-intl, Tailwind tokens, chessground, Vitest + Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-26-repertoire-screens-design.md`. Rulings R-225, R-226, R-227.

**Commands** (from the repo root):
- chess tests: `pnpm --filter @mychess/chess exec vitest run <file>`
- web tests: `pnpm --filter @mychess/web exec vitest run <file>`
- typecheck: `pnpm -r typecheck`
- E2E (Docker and the local stack): `pnpm --filter @mychess/web exec playwright test <spec>`
- before each commit: format, lint, typecheck and the changed packages' tests (CLAUDE.md). Never edit gate configuration. No `any`, no `!`, no suppression comments; functions stay under complexity 10. Every user-visible string is a key in `apps/web/src/i18n/messages/en.json`.

**Conventions for every task:** components are `'use client'` only when they hold state or handlers; tests are written first and assert what a user sees (role, name, text), not class names, except where a layout rule is the behaviour (then assert the one class that carries it, as the existing `repertoire-shell.test.tsx` does). A task's catalogue keys are added in the same commit as the code that uses them; a key no longer used is removed (knip and the catalogue test catch leftovers).

---

## File map

| File | Change |
| --- | --- |
| `packages/chess/src/training/today-rows.ts`, `packages/chess/src/index.ts` (+ test) | export `trackedReviews(day)` |
| `apps/web/src/server/training.ts` (+ test) | `RepertoireTraining.standing`, `.chapters`; `trainedStandings(account)` |
| `apps/web/src/server/coach-assignments.ts` (+ test) | each assigned player's standing |
| `apps/web/src/app/standing-line.tsx` (+ test) | new: bar + text, moved from Today |
| `apps/web/src/app/today/repertoire-rows.tsx`, `today/learned-bar.tsx` | use `StandingLine`; `learned-bar.tsx` moves to `app/` |
| `apps/web/src/app/side-king.tsx` (+ test) | new: fixed-colour kings |
| `apps/web/src/app/repertoires/(list)/page.tsx`, `repertoire-list.tsx`, `new-repertoire.tsx` (+ tests) | one card, tags, standing, New/Import in the header |
| `apps/web/src/lib/routes.ts` | `repertoireManageRoute`, `assignedManageRoute` |
| `apps/web/src/app/repertoires/[id]/manage/page.tsx`, `manage-screen.tsx`, `assignee-rows.tsx` (+ tests) | new: own Repertoire screen |
| `apps/web/src/app/repertoires/assigned/[id]/manage/page.tsx`, `assigned-manage.tsx` (+ tests) | new: assigned Repertoire screen |
| `apps/web/src/app/repertoire-view/top-bar.tsx`, `summary-line.tsx` (+ tests) | new: header, summary, status strip |
| `apps/web/src/app/repertoire-view/repertoire-shell.tsx` (+ test) | top bar slot, comment strip slot, board sizing, panel scroll |
| `apps/web/src/app/repertoire-view/comment-strip.tsx` (+ test) | new |
| `apps/web/src/app/repertoire-view/position-body.tsx`, `comment.tsx` | browse comment leaves the scroller; builder field stays |
| `apps/web/src/app/repertoire-view/chapter-list.tsx`, `chapter-row.tsx` (+ tests) | closed by default, one line, progress rows, edits in the selected row |
| `apps/web/src/app/repertoire-view/move-list.tsx` (+ test) | numbered two-column rows, inline variations, compact desktop chips |
| `apps/web/src/app/repertoire-view/train-here.tsx` (+ test) | new: Learn this line/chapter + I know this (R-227) |
| `apps/web/src/app/repertoire-view/know-this-menu.tsx`, `know-section.tsx`, `train-buttons.tsx`, `learn-link.tsx` | menu becomes a labelled choice row; `KnowSection` and `TrainButtons` removed |
| `apps/web/src/app/repertoires/[id]/repertoire-screen.tsx`, `repertoire-header.tsx`, `mode-switch.tsx` | new header, actions gone from the panel, empty state |
| `apps/web/src/app/repertoires/assigned/[id]/assigned-view.tsx` | new header with status strip, actions gone |
| `apps/web/src/app/coach/players/[playerId]/repertoires/[repertoireId]/shared-repertoire-view.tsx` | adopts `RepertoireTopBar` (no More, no Edit) |
| `apps/web/src/app/repertoires/[id]/builder-bar.tsx` | swatch outline |
| `apps/web/src/app/board/board.css` | coordinates 0.75rem |
| `apps/web/src/app/repertoires/import/import-summary.tsx`, `use-import-flow.ts`, `target-step.tsx`, `apps/web/src/server/import-preview.ts` (+ tests) | stats line, name prefill, summary in "existing" |
| `apps/web/src/app/buttons.ts` | disabled primary muted |
| `apps/web/src/i18n/messages/en.json` | keys added, changed, removed |
| `apps/web/e2e/repertoires.spec.ts`, `assignments.spec.ts`, `sharing.spec.ts`, `training-know.spec.ts`, `coaching.spec.ts` | journeys through `/manage`, comment strip on phone |
| `docs/design/repertoire-screen.md`, `docs/design/README.md` | updated |

---

### Task 1: Chess exports the day's tracked Reviews (chess-dev)

`progressOf(graph, reviews, now)` needs the `TrackedReview` map `todayRows` already builds privately (`trackedOf`). Export it so the server computes one repertoire's chapter standings without duplicating it.

**Files:**
- Modify: `packages/chess/src/training/today-rows.ts`, `packages/chess/src/index.ts`
- Test: `packages/chess/src/training/today-rows.test.ts`

- [ ] **Step 1: Write the failing test** (append to `today-rows.test.ts`, reusing its existing day builders)

```ts
describe('trackedReviews', () => {
  it('pairs each Review with whether it entered by "I know this"', () => {
    const day = dayWith({ reviews: ['a', 'b'], knownWithoutLearning: ['b'] });
    const tracked = trackedReviews(day);
    expect([...tracked.keys()]).toEqual(['a', 'b']);
    expect(tracked.get('a')?.knownWithoutLearning).toBe(false);
    expect(tracked.get('b')?.knownWithoutLearning).toBe(true);
    expect(tracked.get('a')?.review).toBe(day.reviews.get('a'));
  });
});
```

If the test file has no `dayWith`-style helper, build the `Pick<TrainingDay, 'reviews' | 'knownWithoutLearning'>` inline from the file's existing review fixture.

- [ ] **Step 2: Run it:** `pnpm --filter @mychess/chess exec vitest run src/training/today-rows.test.ts`. Expected: FAIL, `trackedReviews` is not exported.

- [ ] **Step 3: Rename and export** in `today-rows.ts`:

```ts
/** The day's Reviews with how each entered training ("I know this" or not). */
export const trackedReviews = (
  day: Pick<TrainingDay, 'reviews' | 'knownWithoutLearning'>,
): Map<string, TrackedReview> =>
  new Map(
    [...day.reviews].map(([key, review]) => [
      key,
      { review, knownWithoutLearning: day.knownWithoutLearning.has(key) },
    ]),
  );
```

Replace the one use in `todayRows` (`const tracked = trackedReviews(day);`) and add `trackedReviews` to the `today-rows` export list in `packages/chess/src/index.ts`, next to `todayRows`.

- [ ] **Step 4: Run the chess tests:** same command, then `pnpm --filter @mychess/chess exec vitest run`. Expected: PASS.

- [ ] **Step 5: Commit:** `feat(chess): export the day's tracked Reviews (#381)`

---

### Task 2: The server reads standings for the repertoire page and the list (web-dev)

**Files:**
- Modify: `apps/web/src/server/training.ts`
- Test: `apps/web/src/server/training.test.ts`

- [ ] **Step 1: Write the failing tests** in `training.test.ts`, using the file's existing snapshot fakes:
  1. `repertoireTraining` returns `standing` equal to `progressOf(graph, trackedReviews(day), now)`'s counts and mastered, and `chapters` keyed by chapter id with each chapter's `{ counts, mastered }`, for a repertoire with two chapters where one own move has a Review.
  2. `trainedStandings(account)` returns a `Map` from repertoire id to `{ standing, due }` for every row of the Today list (own and assigned), and an empty map when the account trains nothing.

- [ ] **Step 2: Run:** `pnpm --filter @mychess/web exec vitest run src/server/training.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement.** In `training.ts`:

```ts
import { progressOf, trackedReviews, type Standing } from '@mychess/chess';

export interface RepertoireTraining {
  readonly counts: TrainingCounts;
  readonly learn: LearnScope;
  readonly limitReached: boolean;
  /** The repertoire's R-151 standing (R-225). */
  readonly standing: Standing;
  /** Each chapter's standing by chapter id (R-225). */
  readonly chapters: Readonly<Record<string, Standing>>;
}
```

In `repertoireTraining`, after `const day = snapshotDay(read.snapshot);`:

```ts
  const progress = progressOf(
    entry.repertoire.graph,
    trackedReviews(day),
    read.now,
  );
  // ...existing fields, then:
    standing: { counts: progress.counts, mastered: progress.mastered },
    chapters: Object.fromEntries(
      progress.chapters.map(({ chapter, counts, mastered }) => [
        chapter.id,
        { counts, mastered },
      ]),
    ),
```

Add, under `todayList`:

```ts
/** A trained repertoire's standing and due count, for My repertoires (R-225). */
export interface TrainedStanding {
  readonly standing: Standing;
  readonly due: number;
}

/**
 * Every repertoire the session account trains, by id: the same
 * request-cached read as Today's list, so My repertoires adds no query.
 */
export async function trainedStandings(
  account: Account,
): Promise<ReadonlyMap<string, TrainedStanding>> {
  const rows = await todayList(account);
  return new Map(
    rows.map((row) => [
      row.repertoireId,
      { standing: row.standing, due: row.due },
    ]),
  );
}
```

`PanelTraining` (`repertoire-view/train-buttons.tsx`) spreads `RepertoireTraining`, so its type gains the two fields; update its interface to extend `RepertoireTraining` plus `repertoireId` (import the type from `../../server/training`, a type-only import as `assigned-view.tsx` already does). Fix any test fixture that builds a `PanelTraining` by adding `standing` and `chapters: {}`; put one shared fixture in `apps/web/src/app/repertoire-view/test-training.ts` (exported `panelTraining(overrides)`), and list it in `testsOutsideGate` only if knip flags it (it is imported by tests, so it should not be).

- [ ] **Step 4: Run** the server tests and `pnpm -r typecheck`. Expected: PASS.

- [ ] **Step 5: Commit:** `feat(web): standings for the repertoire page and My repertoires (#381)`

---

### Task 3: One standing line for Today, cards, chapters and assignees (web-dev)

**Files:**
- Move: `apps/web/src/app/today/learned-bar.tsx` -> `apps/web/src/app/learned-bar.tsx` (update imports)
- Create: `apps/web/src/app/standing-line.tsx`, `apps/web/src/app/standing-line.test.tsx`
- Modify: `apps/web/src/app/today/repertoire-rows.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { withIntl } from '../test/intl'; // the helper the other component tests use
import { StandingLine } from './standing-line';

const counts = (learned: number, due: number, notStarted: number) => ({
  learned,
  due,
  notStarted,
  skipped: 0,
});

describe('StandingLine', () => {
  it('says the learned share and the due count', () => {
    render(withIntl(<StandingLine standing={{ counts: counts(6, 3, 1), mastered: false }} due={3} />));
    expect(screen.getByText('60% learned · 3 due')).toBeVisible();
  });
  it('says New when nothing is learned or due', () => {
    render(withIntl(<StandingLine standing={{ counts: counts(0, 0, 18), mastered: false }} due={0} />));
    expect(screen.getByText('New · 18 moves')).toBeVisible();
  });
  it('says Mastered instead of the share', () => {
    render(withIntl(<StandingLine standing={{ counts: counts(5, 0, 0), mastered: true }} due={0} />));
    expect(screen.getByText('Mastered')).toBeVisible();
  });
  it('shows nothing without own moves', () => {
    const { container } = render(withIntl(<StandingLine standing={{ counts: counts(0, 0, 0), mastered: false }} due={0} />));
    expect(container).toBeEmptyDOMElement();
  });
});
```

Use the intl helper the neighbouring tests use (`today/repertoire-rows.test.tsx` shows its name and import path); adjust the import accordingly.

- [ ] **Step 2: Run:** `pnpm --filter @mychess/web exec vitest run src/app/standing-line.test.tsx`. Expected: FAIL.

- [ ] **Step 3: Implement** `standing-line.tsx`:

```tsx
import { percentLearned, totalMoves, type Standing } from '@mychess/chess';
import { useTranslations } from 'next-intl';
import type { JSX } from 'react';
import { LearnedBar } from './learned-bar';

/** What the line says: Mastered, New with the size, or the share and due. */
function useStandingText(standing: Standing, due: number): string | null {
  const t = useTranslations('standing');
  const percent = percentLearned(standing.counts);
  if (percent === null) return null;
  if (standing.mastered) return t('mastered');
  if (percent === 0 && due === 0)
    return t('new', { count: totalMoves(standing.counts) });
  return due > 0 ? t('learnedDue', { percent, due }) : t('learned', { percent });
}

/**
 * A repertoire's, chapter's or player's progress (R-225, R-177): the bar,
 * then one muted line. Nothing for a set without own moves.
 */
export function StandingLine({
  standing,
  due,
}: {
  readonly standing: Standing;
  readonly due: number;
}): JSX.Element | null {
  const text = useStandingText(standing, due);
  const percent = percentLearned(standing.counts);
  if (text === null || percent === null) return null;
  return (
    <span className="flex flex-col gap-1">
      <LearnedBar percent={percent} />
      <span className="text-sm text-fg-muted">{text}</span>
    </span>
  );
}
```

Catalogue (`en.json`), new top-level `standing`:

```json
"standing": {
  "learned": "{percent}% learned",
  "learnedDue": "{percent}% learned · {due} due",
  "new": "New · {count, plural, one {# move} other {# moves}}",
  "mastered": "Mastered"
}
```

- [ ] **Step 4: Today keeps its look.** Today shows the Mastered badge beside the percent, not instead of it (R-221). Leave Today's `Progress` as it is, only importing `LearnedBar` from its new path. Run `today/repertoire-rows.test.tsx`: PASS unchanged.

- [ ] **Step 5: Run** the new and Today tests, typecheck. **Commit:** `feat(web): one standing line for the repertoire screens (#381)`

---

### Task 4: My repertoires: one card, fixed kings, New and Import in the header (web-dev)

**Files:**
- Create: `apps/web/src/app/side-king.tsx` (+ test), `apps/web/src/app/repertoires/new-repertoire.tsx` (+ test)
- Modify: `apps/web/src/app/repertoires/repertoire-list.tsx` (+ test), `apps/web/src/app/repertoires/(list)/page.tsx`, `apps/web/src/server/repertoires.ts` (the `RepertoireCard` source, if `assignedPlayers` is added there), `en.json`

- [ ] **Step 1: Failing tests** in `repertoire-list.test.tsx` (extend the existing ones):
  1. An own card reads its name, "2 chapters · 148 moves · changed 12 Oct" and "82% learned · 3 due" when `standings` has its id.
  2. An assigned card shows the tag "Assigned", "Rimantas V. · due 30 Nov · 4 chapters · 96 moves" and its standing; Overdue and Paused pills still show (from `AssignmentBadges`).
  3. A fork card shows "Own copy" and "Copy of Rimantas V.'s repertoire" on its meta line.
  4. A coach's own card with `assignedTo: 3` adds "Assigned to 3".
  5. A repertoire missing from `standings` shows no standing line.

  In `side-king.test.tsx`: the White king's fill is `#ffffff` with stroke `#141a26`, the Black king's fill `#141a26` with stroke `#cfd5df`, regardless of theme (assert the `fill`/`stroke` attributes).

  In `new-repertoire.test.tsx`: the header shows **New** (button, `aria-expanded=false`) and **Import PGN** (link to `/repertoires/import`); New opens the create form under the header with its fields; Cancel closes it and returns focus to New; with `startOpen` the form is open on render.

- [ ] **Step 2: Run** the three test files. Expected: FAIL.

- [ ] **Step 3: `side-king.tsx`** (the `King` path from `repertoire-list.tsx`, fixed colours as the training dot, spec "My repertoires"):

```tsx
import type { Side } from '@mychess/chess';
import type { JSX } from 'react';

const COLOURS = {
  white: { fill: '#ffffff', stroke: '#141a26' },
  black: { fill: '#141a26', stroke: '#cfd5df' },
} as const;

/** A side's king in the side's own colours, the same in both themes. */
export function SideKing({ side }: { readonly side: Side }): JSX.Element {
  const { fill, stroke } = COLOURS[side];
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-6 shrink-0" fill={fill} stroke={stroke} strokeWidth="1.5" strokeLinejoin="round">
      <path d="M12 2.5v4M10 4.5h4" fill="none" />
      <path d="M12 8.5c-2-2.5-7-2-7 2.5 0 2.5 2 4 2 6.5h10c0-2.5 2-4 2-6.5 0-4.5-5-5-7-2.5z" />
      <path d="M6.5 17.5h11v3.5h-11z" />
    </svg>
  );
}
```

Remove `King` from `repertoire-list.tsx` and use `SideKing`. If `piece-outline` is then unused, remove its token from `tokens.css` and `tokens.test.ts`.

- [ ] **Step 4: One card.** In `repertoire-list.tsx`, replace `Card` and `AssignedCard` with one `RepertoireCardLink` taking a `CardView`:

```ts
interface CardView {
  readonly href: string;
  readonly name: string;
  readonly tag: 'assigned' | 'fork' | null;
  /** The facts line, already worded. */
  readonly meta: string;
  /** Pills after the name (Overdue, Paused, Updated), or null. */
  readonly badges: ReactNode;
  readonly progress: TrainedStanding | undefined;
}
```

Two small pure helpers build it: `ownView(item, now, standings, t, format)` and `assignedView(item, standings, t, date)`. Name: `text-base font-semibold line-clamp-2`; tag as a pill (`rounded-pill bg-accent-subtle text-accent text-xs px-2` for Assigned, `bg-sunken text-fg-muted` for Own copy); meta `text-sm text-fg-muted`; then `<StandingLine standing due />` when `progress` is defined. Keep the whole card one link with `aria-labelledby` (name) and `aria-describedby` (meta + standing). The `RepertoireList` props gain `standings: ReadonlyMap<string, TrainedStanding>`; `RepertoireCard` gains `assignedTo: number` (0 when none).

For `assignedTo`, extend `myRepertoires()` in `server/repertoires.ts`: for a coach account, read `assignedPlayerCount` per repertoire (the existing db function `coachAssignData` uses) in parallel; 0 for a non-coach without a read. Add a server test for both cases.

Catalogue under `repertoires.list`: `"metaOwn": "{chapters, plural, one {# chapter} other {# chapters}} · {moves, plural, one {# move} other {# moves}} · changed {date}"`, `"metaAssigned": "{coach} · {deadline} · {chapters, plural, ...} · {moves, plural, ...}"`, `"noDeadline": "no deadline"`, `"due": "due {date}"`, `"tagAssigned": "Assigned"`, `"tagFork": "Own copy"`, `"forkOf": "Copy of {coach}'s repertoire"`, `"assignedTo": "Assigned to {count}"`. Remove `meta`, `changed` and keys no longer used. If `AssignedListItem` lacks chapter and move counts, add them in `server/assignment-pages.ts` (`myAssignedRepertoires`) from the graph the query already loads, with a test.

- [ ] **Step 5: `new-repertoire.tsx`** (client): a header row of `PageHeader` title with **Import PGN** (`SECONDARY_BUTTON` link) and **New** (`PRIMARY_BUTTON` button with `aria-expanded`, `aria-controls`); when open, the existing `CreateForm` inside a `SECTION` card with a **Cancel** `QUIET_ACTION`. Props: `startOpen: boolean`. `PageHeader` takes no actions slot, so render the title row here: `<div className="flex flex-wrap items-center gap-3"><PageHeader title=.../><div className="ml-auto flex gap-2">…</div></div>` and keep the intro line under it.

- [ ] **Step 6: The page.** `(list)/page.tsx` loads `trainedStandings(await requireOnboarded())` with the lists, renders `NewRepertoire startOpen={items.length + assigned.length === 0}`, the deleted notice, then `RepertoireList`. Delete `CreateSection` and `ImportSection`.

- [ ] **Step 7: Run** the tests and typecheck. **Commit:** `feat(web): My repertoires, one card with progress and New in the header (#381)`

---

### Task 5: The Repertoire screen for an own repertoire (web-dev, security-reviewer on the assignee read)

**Files:**
- Modify: `apps/web/src/lib/routes.ts`, `apps/web/src/server/coach-assignments.ts` (+ test)
- Create: `apps/web/src/app/repertoires/[id]/manage/page.tsx`, `manage-screen.tsx`, `assignee-rows.tsx`, `loading.tsx` (+ `manage-screen.test.tsx`, `assignee-rows.test.tsx`, `page.test.tsx`)
- Modify: `apps/web/src/app/repertoires/[id]/repertoire-actions.tsx`, `assign-panel.tsx`, `assignment-row.tsx`, `share-with-coach.tsx`

- [ ] **Step 1: Routes.**

```ts
/** The repertoire's own actions (R-226). */
export const repertoireManageRoute = (id: string): string =>
  `${repertoireRoute(id)}/manage`;

/** An assigned repertoire's actions (R-226). */
export const assignedManageRoute = (id: string): string =>
  `${assignedRepertoirePath(id)}/manage`;
```

- [ ] **Step 2: Assignee standings (failing test first).** In `coach-assignments.test.ts`: `coachAssignData` in Coach mode returns `panel.standings` as a map from player id to `Standing | null`, `null` for a player whose read is `undefined` (a fork, R-155). Implement in `panelOf`:

```ts
  const playerIds = [
    ...new Set(assignments.flatMap((a) => a.players.map((p) => p.playerId))),
  ];
  const standings = new Map(
    await Promise.all(
      playerIds.map(async (playerId) => {
        const view = await coachRepertoireProgress(
          db,
          { coachId, playerId, repertoireId },
          now,
        );
        return [
          playerId,
          view === undefined
            ? null
            : { counts: view.progress.counts, mastered: view.progress.mastered },
        ] as const;
      }),
    ),
  );
```

`AssignPanelData` gains `readonly standings: ReadonlyMap<string, Standing | null>`. This reuses the access-checked read the coach progress page uses (Q26, R-156); no new SQL.

- [ ] **Step 3: Assignee rows (failing test first).** `assignee-rows.test.tsx`: one row per player: name, `StandingLine`, the deadline ("due 30 Nov" or "No deadline"), and a **Change** button (`aria-expanded`) that opens the existing `DeadlineForms` and `Unassign` inline in that row; a forked player shows the Own copy pill and no standing; a group assignment shows the group's name as a muted line on each of its players' rows. Implement `assignee-rows.tsx` from `assignment-row.tsx`'s parts (`DeadlineForms`, `Unassign`, `AssignmentBadges`), flattening each `CoachAssignment` to its players. A row is `flex flex-col gap-1 border-t border-border py-3`; the name and standing share the first line from `sm` up. Remove `AssignmentRow` and its `GroupPlayer`/`Reached` if nothing else uses them; `assign-panel.tsx` renders `AssigneeRows` then the existing assign form (`assign-new.tsx`).

- [ ] **Step 4: The screen (failing test first).** `manage-screen.test.tsx`:
  1. Title is the repertoire's name, with a back link "Back to <name>" to `/repertoires/<id>`.
  2. Sections in order: Rename (the field opens inline on **Rename**), Download PGN (link to the export route), Add from PGN (link to `importIntoRoute`), Share with a coach (status as plain text, not a field), Assigned to (Coach mode only), then a danger section headed "Delete repertoire" whose button uses the error tone and opens the existing two-step confirmation.
  3. After a rename the status line says "Renamed".

  Implement `manage-screen.tsx` with `PageHeader` (`back={{ href: repertoireRoute(id), parent: name }}`), `SECTION` cards and `SECTION_TITLE`s. Reuse `RenameForm`, `DeleteConfirm` and `ShareWithCoach` as they are. Change `ShareWithCoach`'s status from its boxed element to `<p className="text-fg-muted">`. The Delete button is `${SECONDARY_BUTTON} border-error text-error`; the confirmation keeps `DANGER_BUTTON`. `repertoire-actions.tsx` keeps only what the screen still uses (`useReturnFocus` and the step type); delete `ActionButtons` and `RepertoireActions` once Task 7 has removed their last users. Do it in Task 7's commit if they are still imported here.

  `page.tsx` loads `repertoirePageData(id)` (404 as the page does) and `coachAssignData(id)`, and renders `ManageScreen`. Add `loading.tsx` with `PageHeader` skeleton lines (`SKELETON_LINE`). `page.test.tsx`: a malformed id is a 404, and an assigned repertoire's id is a 404 here (it belongs to `/assigned`).

- [ ] **Step 5: Run** the tests and typecheck. **Commit:** `feat(web): the Repertoire screen with assignee progress (#381)`

---

### Task 6: The Repertoire screen for an assigned repertoire (web-dev)

**Files:**
- Create: `apps/web/src/app/repertoires/assigned/[id]/manage/page.tsx`, `assigned-manage.tsx`, `loading.tsx` (+ tests)
- Modify: `pause-control.tsx`, `fork-copy.tsx` only if a prop must change

- [ ] **Step 1: Failing test** `assigned-manage.test.tsx`: title is the name, back to the assigned page; three sections, each with one muted explanation: **Pause** ("Stops new moves and reviews from this repertoire until you resume."), **Download PGN** ("Your coach's moves and comments as a PGN file."), **Make my own copy** ("A copy you can change; your progress comes with it."); pausing shows Resume; the fork question opens inline as it does today. With `?fork=1` the fork question starts open.

- [ ] **Step 2: Implement** with `PauseControl`/`usePause`, the download link and `ForkCopy` moved from `assigned-view.tsx` (`AssignmentActions`, `DownloadLink`). `page.tsx` loads what `assigned/[id]/page.tsx` loads for these (the same server function, `assignedRepertoirePage` or as named there) and the fork server action. Catalogue keys under `assignment.manage`: `title`, `pauseIntro`, `downloadIntro`, `forkIntro`.

- [ ] **Step 3: Run** tests, typecheck. **Commit:** `feat(web): the assigned Repertoire screen (#381)`

---

### Task 7: The top bar and summary line; the shell puts them in the panel on desktop (web-dev, ux-designer review)

**Files:**
- Create: `apps/web/src/app/repertoire-view/top-bar.tsx`, `summary-line.tsx` (+ tests)
- Modify: `repertoire-shell.tsx` (+ test), `repertoire-view/index.ts`, `view-header.tsx`, `loading-shell.tsx`
- Modify: `apps/web/src/app/repertoires/[id]/repertoire-screen.tsx`, `mode-switch.tsx`, delete `repertoire-header.tsx` (+ test)
- Modify: `apps/web/src/app/repertoires/assigned/[id]/assigned-view.tsx`, `apps/web/src/app/coach/players/[playerId]/repertoires/[repertoireId]/shared-repertoire-view.tsx`
- Delete: `repertoire-view/train-buttons.tsx`'s `TrainButtons` (keep `PanelTraining`; move it to `repertoire-view/panel-training.ts`)

- [ ] **Step 1: Failing tests.**

`top-bar.test.tsx`:
1. Renders back (link named "Back to Repertoires"), the name as `h1` without a one-line clamp (assert `line-clamp-2`, the rule that carries finding 5), the `edit` slot and a **More** link named "Repertoire options" to the `moreHref`.
2. Without `moreHref` and `edit` (coach's shared view) only back and the name.

`summary-line.test.tsx`:
1. Own: "Black · 6 chapters · 64% learned", then **Review 4** and **Learn 9 today** links to `trainingPath('review'|'learn', id)`.
2. A zero count's button is not rendered; both zero: no buttons.
3. `limitReached`: Learn gives way to the existing limit line with its settings link.
4. Assigned status strip: "Rimantas V. · due 30 Nov · in 4 days"; "due today" on the day; the Overdue pill when overdue; the Paused pill when paused, and no buttons while paused.
5. No training (`training` undefined): only side and chapters.

`repertoire-shell.test.tsx` (update): the `topBar` renders in a `lg:hidden` wrapper before the board and in a `hidden lg:block` wrapper first inside the element with `data-panel` (the panel column); the board's container has the class that sizes it to the viewport (`lg:w-[min(...)]` per Step 4).

- [ ] **Step 2: Run.** Expected: FAIL.

- [ ] **Step 3: Implement `top-bar.tsx`:**

```tsx
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import type { JSX, ReactNode } from 'react';
import { BACK_BUTTON } from '../buttons';
import { BACK_ICON, Icon } from '../line-icon';
import { PhoneAccountMenu } from '../shell/account-menu';

const MORE_ICON = 'M12 5h.01M12 12h.01M12 19h.01';

export interface TopBarProps {
  readonly back: { readonly href: string; readonly parent: string };
  readonly name: string;
  /** The Edit switch (the owner's page only). */
  readonly edit?: ReactNode;
  /** The Repertoire screen (R-226); absent where the viewer has none. */
  readonly moreHref?: string;
  /** The summary line and status strip under the name. */
  readonly children?: ReactNode;
}

/**
 * The repertoire's header (spec, Header): back, the name on up to two
 * lines, Edit and More. The phone's top bar; the first row of the desktop
 * panel, level with the board's top edge.
 */
export function RepertoireTopBar({ back, name, edit, moreHref, children }: TopBarProps): JSX.Element {
  const t = useTranslations();
  return (
    <header className="flex flex-col gap-2 px-gutter py-1 lg:px-0 lg:py-0">
      <div className="flex items-center gap-2">
        <Link href={back.href} aria-label={t('nav.back', { parent: back.parent })} className={BACK_BUTTON}>
          <Icon path={BACK_ICON} className="size-6" />
        </Link>
        <h1 title={name} className="min-w-0 flex-1 line-clamp-2 break-words text-base font-semibold lg:text-xl">
          {name}
        </h1>
        {edit}
        {moreHref === undefined ? null : (
          <Link href={moreHref} aria-label={t('repertoires.more')} title={t('repertoires.more')} className={BACK_BUTTON}>
            <Icon path={MORE_ICON} className="size-6" />
          </Link>
        )}
        <span className="lg:hidden">
          <PhoneAccountMenu />
        </span>
      </div>
      {children}
    </header>
  );
}
```

If `Icon` draws with a stroke that makes the dots invisible, draw the three dots as `<circle r="1.5">` in a local SVG instead. `BACK_BUTTON` has `-ml-2`; for More add `-mr-2` by not reusing it (`flex size-touch shrink-0 items-center justify-center rounded-control text-fg-muted hover:bg-sunken -mr-2`).

**`summary-line.tsx`:** `SummaryLine({ side, chapters, training, assignment })` where `assignment?: { coachName; deadline: string | null; overdue; paused }`. The facts line: `t('repertoires.summary.facts', { side, chapters, percent })` (percent omitted with no training: `factsNoProgress`). Buttons: `TONAL_BUTTON` links, each only when its count > 0; Learn's label `t('repertoires.summary.learnToday', { count: counts.toLearn })`; the limit line as `TrainButtons` had it. The status strip: coach name, then the deadline as `t('repertoires.summary.dueIn', { date, days })` using `vilniusDay` difference (`days === 0` gives `dueToday`), the `AssignmentBadges` for overdue and paused. Keep each helper under complexity 10.

**ModeSwitch:** make it one labelled control: the visible word "Edit" inside the switch's `label`, so on a phone it is not a bare toggle (finding 9). Keep its `role="switch"` and test.

- [ ] **Step 4: The shell.** `RepertoireShell` props: replace `header` with `topBar: ReactNode`; add `commentStrip?: ReactNode` (Task 8 fills it). Layout:

```tsx
<main className="flex h-[calc(100dvh-var(--shell-chrome,0px))] flex-col lg:mx-auto lg:h-auto lg:max-w-[calc(var(--board-max)+var(--panel-width)+2rem)] lg:flex-row lg:items-start lg:justify-center lg:gap-8 lg:px-gutter-wide lg:py-6">
  <div className="shrink-0 lg:hidden">{topBar}</div>
  <div className="shrink-0 lg:sticky lg:top-[calc(var(--shell-chrome,0px)+1.5rem)] lg:w-[min(calc(100dvh-3rem-var(--shell-chrome,0px)),46rem)]">
    <Board … />
  </div>
  <div data-panel="" className="flex min-h-0 flex-1 flex-col lg:w-panel lg:flex-none lg:gap-3 lg:rounded-card lg:bg-surface lg:p-4 lg:shadow-card">
    <div className="hidden lg:block">{topBar}</div>
    <BoardRow … />
    {toolbar}
    <PanelStatus … />
    {commentStrip}
    <RepertoirePanel … />
  </div>
  …
</main>
```

`topBar` renders twice, once per breakpoint: the phone copy in a `lg:hidden` wrapper, the desktop copy in a `hidden lg:block` wrapper. `display: none` takes the hidden copy out of the accessibility tree and the tab order, so a user meets exactly one `h1` and one Edit switch (both copies read the same state). jsdom does not apply CSS, so the shell test asserts the two wrappers and their classes, not the heading count. If `--board-max` and `--panel-width` tokens do not exist, use the literal widths (`46rem`, the panel's `w-panel` value) and do not add tokens.

At 1280x800 the board must be at least 640px: `100dvh - 3rem - shell chrome (the 56px app bar)` = 800 - 48 - 56 = 696px, capped at 46rem (736px). Check in the ux-designer review.

On a phone the board container is `w-full` (finding 7's 6px strip): find what leaves the strip in `board/board.tsx` or `board.css` (a fixed rem width or a border) and make the phone board `aspect-square w-full`.

The panel's scroller on desktop scrolls with the page today (#331). Keep that, but make move clicks scroll only the move list: in `move-list.tsx`, `scrollIntoView({ block: 'nearest' })` scrolls ancestors too. Replace it with a scroll of the nearest scrollable ancestor only:

```ts
/** Scrolls `chip` into its own scroller's view, never the page (finding 8). */
function revealInScroller(chip: HTMLElement): void {
  const scroller = chip.closest<HTMLElement>('[data-scroller]');
  if (scroller === null) return;
  const top = chip.offsetTop - scroller.offsetTop;
  if (top < scroller.scrollTop) scroller.scrollTop = top;
  else if (top + chip.offsetHeight > scroller.scrollTop + scroller.clientHeight)
    scroller.scrollTop = top + chip.offsetHeight - scroller.clientHeight;
}
```

Mark the panel's phone scroller and the desktop move-list box (`lg:max-h-[50dvh] lg:overflow-y-auto`) with `data-scroller` (on desktop the move-list box is the nearest; on a phone the panel). Test it in `move-list.test.tsx` with a stubbed scroller (`scrollTop` set, `window.scrollTo` never called).

- [ ] **Step 5: The three views adopt the top bar.**
- `repertoire-screen.tsx`: `topBar={<RepertoireTopBar back={{ href: ROUTES.repertoires, parent: t('nav.repertoires') }} name={name} edit={<ModeSwitch …/>} moreHref={repertoireManageRoute(id)}><SummaryLine side chapters={graph.chapters.length} training={props.training ?? undefined} /></RepertoireTopBar>}`. In builder mode pass no `SummaryLine` progress (`training` undefined) (spec, Builder). Remove `PhoneActions`, the `footer` (actions, assign panel, share), the `assignPanel`, `sharing` and `assignedPlayers` props; remove those reads from `[id]/page.tsx` (`coachAssignData` moves to the manage page). Delete `repertoire-header.tsx`, `repertoire-header-types.ts` if unused, and their tests; delete `RepertoireActions`/`ActionButtons` (Task 5 left them).
- `assigned-view.tsx`: `RepertoireTopBar` with `moreHref={assignedManageRoute(id)}`, `SummaryLine` with `assignment={{ coachName, deadline, overdue, paused }}`. Delete `AssignedHeader`, `AssignmentActions`, `DownloadLink`, the fork state; the `statusAction` for `NOT_IN_CHAPTER` becomes a `SECONDARY_BUTTON` link "Make my own copy" to `${assignedManageRoute(id)}?fork=1`.
- `shared-repertoire-view.tsx` (coach): `RepertoireTopBar` with its back target and name only; its existing lead line stays in the panel.
- `loading-shell.tsx` and `view-header.tsx`: the skeleton uses the new top bar's shape; delete `HeaderFrame`/`BackLink` exports when unused.

- [ ] **Step 6: Run** the repertoire-view, repertoires and coach view tests, typecheck. **Commit:** `feat(web): the repertoire header in the board block, summary line and status strip (#381)`

---

### Task 8: The comment strip (web-dev)

**Files:**
- Create: `apps/web/src/app/repertoire-view/comment-strip.tsx` (+ test)
- Modify: `position-body.tsx`, `comment.tsx`, `repertoire-panel.tsx`, `repertoire-shell.tsx`, the three views

- [ ] **Step 1: Failing test** `comment-strip.test.tsx`:
1. On a move with a comment: "5... Qc7" in bold, then the comment text, in a region named "Comment" (or the view's `commentLabel`, e.g. "Coach note by Rimantas V.").
2. At the root with an intro: the intro, named "Chapter intro".
3. Nothing rendered on a move without a comment, or at a root without an intro.
4. A comment longer than two lines is clamped (`line-clamp-2`) with a **More** button (`aria-expanded=false`); More removes the clamp and says **Less**. A new move resets it to clamped (key by move).
5. The marks text (`MarksText`) stays for screen readers.

- [ ] **Step 2: Run.** FAIL.

- [ ] **Step 3: Implement** `CommentStrip({ intro, move, path, whiteFirst, label })`: the move label via `moveNumber(path.length - 1, whiteFirst)` + `annotatedSan`, as `know-section.tsx`'s `moveLabel` does (move that helper to `repertoire-view/move-label.ts` and use it in both). Classes: `shrink-0 bg-accent-subtle px-gutter py-2 text-sm lg:rounded-control lg:px-3`. Whether to show More: always render More when the text is over 140 characters (a pure, testable rule; no layout measuring).

In browse mode, `PositionBody` stops rendering the comment (the strip does) and keeps the notes (`renderNotes`) and, in builder mode, the `CommentField`. The shell gets `commentStrip` from the view: `RepertoireShell` builds it itself from `view.state` (the chapter's intro, `state.path.at(-1)`) when `state.mode === 'browse'`, so the views only pass `commentLabel` (already in `PanelContent`).

- [ ] **Step 4: Run** the strip, position-body, panel and view tests (update the ones that found the comment in the panel). **Commit:** `feat(web): the current move's comment pinned under the board row (#381)`

---

### Task 9: The chapter line and progress rows (web-dev)

**Files:**
- Modify: `apps/web/src/app/repertoire-view/chapter-list.tsx`, `chapter-row.tsx` (+ tests), `repertoire-panel.tsx`

- [ ] **Step 1: Failing tests** (`chapter-list.test.tsx`, `chapter-row.test.tsx`):
1. Closed by default at every width (remove the `isWide` test and `matchMedia` stub): the trigger reads "Ch 2/6 · <label>" on one line (`truncate`), its accessible name has the full label.
2. Open: no inner scroller (no `max-h-72`/`overflow-y-auto` on the list); each row shows the title wrapped in full and, when `standings[chapter.id]` is given, its `StandingLine` with the chapter's due count.
3. Browse rows have no icon buttons (no "I know this" toggle, no Learn link).
4. Builder: only the current chapter's row shows Rename and Delete, as labelled `SECONDARY_BUTTON`s under its title ("Rename chapter", "Delete chapter"), not 44px icons beside it; Add chapter stays.

- [ ] **Step 2: Run.** FAIL.

- [ ] **Step 3: Implement.** `ChapterListProps`: replace `training` and `graph` with `standings?: Readonly<Record<string, Standing>>`; a row's due count is `standing.counts.due`. `useDisclosure` loses `isWide` and the effect. `ChapterRow`: delete `RowLine`, `ChapterLearn`; `RowEdits` renders labelled buttons and only when `current`. The panel passes `standings={state.mode === 'browse' ? content.training?.chapters : undefined}`.

Catalogue: `repertoires.chapters.line` "Ch {index}/{count} · {title}", `repertoires.chapters.renameShort` "Rename chapter", `deleteShort` "Delete chapter"; remove `position` if unused.

- [ ] **Step 4: Run** the tests. **Commit:** `feat(web): chapter line closed by default, chapter rows with progress (#381)`

---

### Task 10: The two-column move list (web-dev, chess-dev review of the numbering)

**Files:**
- Modify: `apps/web/src/app/repertoire-view/move-list.tsx` (+ test)

- [ ] **Step 1: Failing tests** in `move-list.test.tsx`:
1. Main line `1. e4 c5 2. Nf3 e6`: two rows, each a number then White's chip then Black's chip (assert per row: `within(row).getAllByRole('button')` names in order).
2. A chapter whose root has Black to move: the first row is "5. …" with an empty White cell, then Black's move.
3. A variation after White's 6th move: the row "6. f4" stops; the variation block "6. f4 a6 7. Nxc6 bxc6" is inline in one wrapping block; the main line resumes on a new row "6. … a6" (Black's main move, with "…").
4. Own-side moves stay bold; the current chip has `aria-current`; the comment glyph stays.
5. Chips on desktop are compact: the chip class has `lg:min-h-7` and `min-h-touch` below `lg`.

- [ ] **Step 2: Run.** FAIL.

- [ ] **Step 3: Implement.** Keep `lineTokens` (the tree walk), and add a pure `rowsOf(tokens): Row[]` that groups the main line into rows:

```ts
type Row =
  | { readonly kind: 'moves'; readonly number: string; readonly white: MoveToken | null; readonly black: MoveToken | null }
  | { readonly kind: 'variations'; readonly blocks: readonly Token[][] };
```

A White move opens a row; the Black move after it fills the row; a `variations` token closes the current row and becomes its own row; a Black move that starts a row (after variations, or at a Black-first root) gets `white: null`. Render `moves` rows as `grid grid-cols-[2.5rem_1fr_1fr] items-center gap-x-1`, the number `text-fg-muted tabular-nums`, an empty White cell as "…". Variation rows render as today's `Tokens` inside the indented block (inline, wrapping), unchanged. Unit-test `rowsOf` directly (it is pure) in addition to the render tests. `MoveChip`: `min-h-touch min-w-touch lg:min-h-7 lg:min-w-0 lg:px-1.5`; replace `scrollIntoView` with `revealInScroller` from Task 7.

- [ ] **Step 4: Run** the tests. **Commit:** `feat(web): numbered two-column move list (#381)`

---

### Task 11: Train here and one "I know this" (R-227) (web-dev)

**Files:**
- Create: `apps/web/src/app/repertoire-view/train-here.tsx` (+ test)
- Modify: `know-this-menu.tsx` (+ test), `learn-link.tsx`, `repertoire-panel.tsx`
- Delete: `know-section.tsx` (+ test)

- [ ] **Step 1: Failing test** `train-here.test.tsx` (stub the know actions as `know-this-menu.test.tsx` does):
1. On an own-side move inside a chapter with new moves: **Learn this line (3)** and **Learn this chapter (9)** links to `learnPath` with the line/chapter focus; a zero count's link is absent.
2. **I know this** button (`aria-expanded=false`); opened, three rows: "This move, 5... Qc7", "This line", "This chapter", each counted on open (the existing `knowCountAction` per scope) with **Mark known** and, when it has known moves, **Learn again (n)**.
3. On an opponent move: no "This move" row. At the chapter root: only "This chapter".
4. Mark known on the line asks the R-147 question with the count before acting; on the move it acts at once (existing behaviour).
5. Paused or untrained (`training` undefined): nothing rendered.

- [ ] **Step 2: Run.** FAIL.

- [ ] **Step 3: Implement.** Refactor `KnowThisMenu` into `KnowChoice({ fields, subject })`: no toggle of its own; it counts on mount (the parent mounts the choices only when open) and renders a row `flex flex-wrap items-center justify-between gap-2` with `subject` and the existing `KnowBody` (whose buttons become `TONAL_BUTTON`; Learn again stays `SECONDARY_BUTTON`). The "Mark known" label replaces "I know this" on the action (`training.know.markKnown`), the R-147 confirmation keeps its words.

`TrainHere({ training, graph, chapterId, path })`:

```tsx
export function TrainHere({ training, graph, chapterId, path }: TrainHereProps): JSX.Element {
  const t = useTranslations('training.know');
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const choices = knowChoices(graph, chapterId, path, training.repertoireId, t);
  return (
    <section aria-label={t('section')} className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <LearnLink training={training} graph={graph} focus={lineFocus(graph, chapterId, path)} />
        <LearnLink training={training} graph={graph} focus={{ chapterId }} subject={t('chapterSubject')} />
        <button type="button" aria-expanded={open} aria-controls={bodyId} onClick={() => { setOpen(!open); }} className={SECONDARY_BUTTON}>
          {t('iKnowThis')} <Icon path={CHEVRON} className={`size-4 ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>
      {open ? (
        <div id={bodyId} className="flex flex-col gap-2 border-l border-border pl-3">
          {choices.map((choice) => <KnowChoice key={choice.key} fields={choice.fields} subject={choice.subject} />)}
        </div>
      ) : null}
    </section>
  );
}
```

`knowChoices` (pure, tested): the move choice when `path.at(-1)` is an own move (`isPlayerMove`), the line choice when `currentLineIndex` is not null, the chapter choice always; keys include the scope so a new position resets counts. `lineFocus` returns `{ chapterId, lineIndex }` or `{ chapterId }` at the root; at the root render no line Learn. `LearnLink`'s label becomes "Learn this line ({count})" / "Learn this chapter ({count})" (`training.repertoire.learnThisLine`, `learnThisChapter`), class `TONAL_BUTTON`; delete `COMPACT_BUTTON`.

`RepertoirePanel`: remove `TrainButtons` and `KnowSection`; after the move list render `{content.training === undefined || state.mode !== 'browse' || chapter === undefined ? null : <TrainHere … />}` then the notes stay where `PositionBody` renders them. Order in the scroller: chapter line, (builder: comment field), move list, Train here, notes, footer.

- [ ] **Step 4: Run** the tests; delete `know-section.tsx` and its test; run knip (`node quality/gate.mjs check` is the full gate; for a quick check `pnpm knip` if the repo has the script). **Commit:** `feat(web): Train here with one "I know this" for move, line or chapter (#381)`

---

### Task 12: Empty repertoire, swatches, coordinates (web-dev, ux-designer review)

**Files:**
- Modify: `apps/web/src/app/repertoires/[id]/repertoire-screen.tsx` (`EmptyRepertoire`), `builder-bar.tsx` (+ test), `apps/web/src/app/board/board.css`

- [ ] **Step 1: Empty (failing test in `repertoire-screen.test.tsx`).** A repertoire without chapters in browse mode shows the empty message, **Add from PGN** (link) and **Start building** (switches to Edit); no Review, Learn or Download (the summary line has no buttons because the counts are 0; Download is on the Repertoire screen). Implement by showing both actions in `EmptyRepertoire` browse mode.

- [ ] **Step 2: Swatches.** The builder's colour swatches get `ring-1 ring-inset ring-border-strong` so the dark red and blue stand out from the dark panel without changing the board's arrow colours (spec, Builder: the contrast goal; ux-designer measures it and records it in `docs/design/README.md`). Test: each swatch button keeps its accessible name and check mark (existing tests); no new assertion on colour.

- [ ] **Step 3: Coordinates.** In `board.css`, `.cg-wrap coords { font-size: 0.75rem; }` (was 0.625rem) and `font-weight: 700`. This is shared with the training board, so the ux-designer checks both boards at 390 and 1280 in both themes.

- [ ] **Step 4: Run** tests. **Commit:** `fix(web): empty repertoire actions, swatch outline, larger coordinates (#381)`

---

### Task 13: Import: one stats line, the name from the file, the summary when adding (web-dev)

**Files:**
- Modify: `apps/web/src/app/repertoires/import/import-summary.tsx` (+ test), `use-import-flow.ts` (+ test), `target-step.tsx` (+ test), `apps/web/src/server/import-preview.ts` (+ test) if the preview lacks the Event tags, `apps/web/src/app/buttons.ts`

- [ ] **Step 1: Failing tests.**
1. `import-summary.test.tsx`: the stats read as one line "6 chapters · 13 lines · 123 moves · 1 transposition" (a `<p>`), no list of tiles; positions are not shown; zero transpositions are left out.
2. `use-import-flow.test.ts`: after a preview whose games all share `Event "Taimanov prep"`, `state.name` is "Taimanov prep"; with mixed or missing Event tags, the file name without extension ("taimanov.pgn" gives "taimanov"); pasted text with no Event gives ''; a name the player already typed is never overwritten.
3. `target-step.test.tsx`: with target "existing", step 2's file summary is visible.
4. `buttons` (a small test in `buttons.test.ts` if one exists, else assert in `import-summary.test.tsx`): a disabled primary button has `disabled:opacity-50`.

- [ ] **Step 2: Run.** FAIL.

- [ ] **Step 3: Implement.**
- Stats: replace the tile `ul` with `<p className="text-fg-muted">{parts.join(' · ')}</p>` built from catalogue plurals (`repertoires.import.stats.chapters`, `.lines`, `.moves`, `.transpositions`); drop `positions` from the stat keys.
- Name (as built: the rule moved to `packages/chess` `suggestedRepertoireName` after review; the preview returns one `suggestedName` from the file text and an optional `fileName` in the request, and the hook keeps only the "follow the suggestion while untouched" state; the original plan text follows): the preview response needs `events: readonly (string | null)[]` (each game's Event tag). If `import-preview.ts` does not return it, add it in the parsed preview (zod schema on the response too) with a test. In `use-import-flow.ts`, a pure `suggestedName(events, fileName): string` (tested alone), applied when the preview arrives and only if `state.name === ''`. Ignore the placeholder Event "?" as missing.
- Summary in "existing": render the same summary component in both target modes.
- `buttons.ts`: the comment above `BUTTON` says disabled buttons fade to 85% because pending labels must keep 4.5:1. Keep that for SECONDARY; for `PRIMARY_BUTTON` add `disabled:bg-sunken disabled:text-fg-muted disabled:opacity-100`, so a disabled primary is visibly muted and still readable (ux-designer records the contrast). A pending primary shows "Adding…" in muted text on sunken; that is acceptable and readable.

- [ ] **Step 4: Run** the import tests. **Commit:** `feat(web): import preview as one line, name from the file (#381)`

---

### Task 14: E2E through the Repertoire screen (qa)

**Files:**
- Modify: `apps/web/e2e/repertoires.spec.ts`, `assignments.spec.ts`, `sharing.spec.ts`, `training-know.spec.ts`, `coaching.spec.ts`, `coach-progress.spec.ts` and `e2e/support/*` helpers that click the old header or panel actions

- [ ] **Step 1:** Run the affected specs against the branch to see what broke: `pnpm --filter @mychess/web exec playwright test repertoires assignments sharing training-know coaching coach-progress`.
- [ ] **Step 2:** Update journeys: rename, download, add from PGN, delete, share, assign, change deadline, unassign go through **More** -> the Repertoire screen; pause and make my own copy through the assigned Repertoire screen; "I know this" through **I know this** -> the scope's **Mark known**; My repertoires' create through **New**.
- [ ] **Step 3:** Add `@mobile` checks: on Pixel 7, stepping forward with the board row keeps the comment strip visible (its text in the viewport after three steps); the chapter line is closed on load.
- [ ] **Step 4:** Add a desktop check: clicking the last move of a long chapter does not change `window.scrollY`.
- [ ] **Step 5:** Run all E2E (desktop and Pixel 7). **Commit:** `test(e2e): repertoire journeys through the Repertoire screen (#381)`

---

### Task 15: Design note, sign-off and close (ux-designer, then lead)

- [ ] **Step 1:** ux-designer: screenshots of My repertoires, the repertoire page (browse, builder, empty), the assigned page, both Repertoire screens and import at 390x844, 375x667, 1280x800, 1440x900 in light and dark, with the persona seeds. Check each audit finding (spec list 1-20) is answered; at 1280x800 the board is at least 640px; the header's top lines up with the board's. Record contrast for the swatch outline, the disabled primary and the coordinates in `docs/design/README.md`.
- [ ] **Step 2:** ux-designer: rewrite `docs/design/repertoire-screen.md` sections 1-3 to the new layout (sketches at 390 and 1280), and note the Repertoire screen.
- [ ] **Step 3:** lead: `node quality/gate.mjs check` green; push; CI green (gate, E2E desktop and Pixel 7, deploy). Comment on #381 with the commit range, CI result and "Next: part 5, coach". Run `mp-code-review` on the range and `improve-codebase-architecture` on the touched files, then `retro`.
- [ ] **Step 4:** **Commit:** `docs(design): repertoire screens after sign-off (#381)`
