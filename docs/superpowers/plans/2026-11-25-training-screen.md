# Training screen (#381 part 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the training screen (`/training`) to Ocean and fix the audit's findings: a fixed move counter (R-223), a header naming the session and the item (R-224), the typed-move field behind a Type button on phones, softer move badges, longer feedback with the wrong move held, a Done state with one primary next step, and a "Nothing due" hero card.

**Architecture:** Chess changes the review session's size to count first asks and its progress to count finished moves (R-223) and gains `positionAfterMove`. The server adds each entry's chapter titles to `TrainingData`. On the web, a pure `sessionHeader` builds the top bar's title and context line from the scope and the item the drill reports (`FrameParts.item`); the frame, panel, Done and empty states are restyled with shared button and card classes; a new `MoveEntry` puts the field behind a Type button below `lg`; the wrong move is held on the board through the flash (`Flash.after`).

**Tech Stack:** TypeScript, Next.js App Router, next-intl, Tailwind tokens, chessground, Vitest + Testing Library + fast-check, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-25-training-screen-design.md`. Rulings R-223, R-224.

**Commands** (from the repo root unless stated):
- chess tests: `pnpm --filter @mychess/chess exec vitest run <file>`
- web tests: `pnpm --filter @mychess/web exec vitest run <file>`
- typecheck: `pnpm -r typecheck`
- E2E (Docker and the local stack): `pnpm --filter @mychess/web exec playwright test <spec>`
- before each commit: format, lint, typecheck and the changed packages' tests (CLAUDE.md). Never edit gate configuration. No `any`, no `!`, no suppression comments; functions stay under complexity 10.

---

## File map

| File | Change |
| --- | --- |
| `packages/chess/src/training/review-session.ts` | size counts first asks; `reviewProgress` counts finished moves of a fixed total (R-223) |
| `packages/chess/src/training/review-repeats.test.ts` | expectations to R-223; new property test |
| `packages/chess/src/legal-moves.ts` (+ test), `packages/chess/src/index.ts` | `positionAfterMove` |
| `apps/web/src/server/chapter-names.ts` (+ test) | `chapterTitlesOf` |
| `apps/web/src/lib/training-data.ts`, `apps/web/src/server/training.ts` (+ test) | each entry's `chapterTitles` |
| `apps/web/src/app/training/session-header.ts` (+ test) | new: `sessionHeader` |
| `apps/web/src/app/training/drill.ts` | `FrameParts.item` replaces `title` |
| `apps/web/src/app/training/drill-board.ts` (+ test) | `item` from the drilled entry and chapter; the wrong move held |
| `apps/web/src/app/training/training-screen.tsx`, `training-frame.tsx`, `frame-classes.ts` (+ tests) | header, icon Back, counter, track, centring, board cap, empty-state strip |
| `apps/web/src/app/buttons.ts`, `apps/web/src/app/today/today-hero.tsx`, `today/repertoire-rows.tsx` | `TONAL_BUTTON`, `QUIET_ACTION`, `HERO_PRIMARY_BUTTON`, `HERO_SECONDARY_BUTTON` |
| `apps/web/src/app/board/move-input.tsx` | `inputRef` |
| `apps/web/src/app/training/move-entry.tsx` (+ test) | new: the Type button and the field |
| `apps/web/src/app/training/drill-panel.tsx` (+ test), `phone-line.ts` (+ test) | dot colours, status pills, phone line, move list columns |
| `apps/web/src/app/training/review-drill.tsx`, `learn-drill.tsx`, `coach-note.tsx`, `two-answers-notice.tsx` | panel restyle, Hint tonal, End session quiet |
| `apps/web/src/app/training/review-drill-state.ts`, `learn-drill-state.ts`, `drill-input.ts` (+ tests) | 700ms; wrong move held; input locked meanwhile |
| `apps/web/src/app/tokens.css`, `tokens.test.ts`, `board/board.css`, `board/board-config.ts` (+ test) | badges, flash, coordinates, arrow, side dot tokens |
| `apps/web/src/app/training/done-summary.tsx` (+ test) | card, labels, learn line, `primaryAction` |
| `apps/web/src/app/training/empty-panel.tsx`, `error.tsx` | hero card, plain cards |
| `apps/web/src/i18n/messages/en.json` | keys added, changed, removed |
| `apps/web/e2e/support/training.ts`, `home.spec.ts`, `training-know.spec.ts`, `training-review.spec.ts`, `training-layout.spec.ts`, `support/training-cast.ts` | updated |
| `docs/design/training-screen.md` | updated to the spec |

---

### Task 1: The session size counts moves; the counter counts finished moves (chess, chess-dev)

R-223 amends R-78: repeats no longer use the session size, so a lapse never pushes a move out, and the counter's total is fixed.

**Files:**
- Modify: `packages/chess/src/training/review-session.ts`
- Test: `packages/chess/src/training/review-repeats.test.ts`

- [ ] **Step 1: Change the existing expectations to R-223**

In `review-repeats.test.ts`:

1. In `outOfTime`, the room check becomes the new rule:

```ts
  const room = s.size - s.outcomes.size > 0;
```

2. In `'owes the repeat from the answer on, before the session moves on'`:

```ts
    expect(reviewProgress(lapse)).toEqual({ done: 0, total: 2 });
    const hint = hintReview(d.s, clockOf(d, at(0))).state;
    expect(reviewProgress(hint)).toEqual({ done: 0, total: 2 });
    const pass = answerReview(d.s, 'e4', clockOf(d, at(0))).state;
    expect(pass.repeats).toEqual([]);
    expect(reviewProgress(pass)).toEqual({ done: 1, total: 2 });
```

3. In `'emits each answer of a repeat; the counts keep each move by its first'` and `'a move that sticks does not come back; the session then ends'`: `expect(reviewProgress(...)).toEqual({ done: 2, total: 2 });`

4. Replace `'counts repeats toward the session size, leaving later moves for "continue" (R-62)'` with:

```ts
  it('asks the size in moves, repeats on top, leaving later moves for "continue" (R-62, R-223)', () => {
    const d = answer(
      start([item('e4'), item('c3'), item('d3')], 2),
      at(0),
      true,
    );
    // The lapse took no slot: the second move is still asked.
    expect(currentSan(d)).toBe('c3');
    expect(reviewProgress(d.s)).toEqual({ done: 0, total: 2 });
    const second = answer(d, at(0));
    // No first ask is left: the repeat is asked early.
    expect(currentSan(second)).toBe('e4');
    expect(second.s.current?.repeat).toBe(true);
    expect(reviewProgress(second.s)).toEqual({ done: 1, total: 2 });
    const end = answer(second, at(30));
    expect(end.s.current).toBeNull();
    expect(reviewProgress(end.s)).toEqual({ done: 2, total: 2 });
    expect(end.s.outcomes.has(item('d3').key)).toBe(false);
  });
```

5. Replace the body of `'does not chain past the session size'` with a size of one:

```ts
    const d = answer(
      start([item('e4'), item('Nf3'), item('c3')], 1),
      at(0),
      true,
    );
    expect(currentSan(d)).toBe('e4');
    expect(d.s.current?.repeat).toBe(true);
```

- [ ] **Step 2: Add the R-223 property test** (inside the same `describe`)

```ts
  it('keeps the total fixed and the done count rising to it, whatever the answers (R-223)', () => {
    const items = ['e4', 'Nf3', 'Bc4', 'c3', 'd3'].map(item);
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.boolean(), fc.integer({ min: 0, max: 15 })), {
          maxLength: 30,
        }),
        fc.integer({ min: 1, max: 8 }),
        (answers, size) => {
          let d = start(items, size);
          const total = Math.min(size, items.length);
          let minutes = 0;
          let last = 0;
          for (let step = 0; d.s.current !== null && step < 200; step += 1) {
            const [wrong, wait] = answers[step] ?? [false, 15];
            const now = at(minutes);
            minutes += wait;
            d = answer(d, now, wrong, at(minutes));
            const progress = reviewProgress(d.s);
            expect(progress.total).toBe(total);
            expect(progress.done).toBeGreaterThanOrEqual(last);
            last = progress.done;
          }
          expect(reviewProgress(d.s)).toEqual({ done: total, total });
          // No first ask was dropped for a repeat.
          expect(d.s.outcomes.size).toBe(total);
        },
      ),
    );
  });
```

- [ ] **Step 3: Run, expect FAIL**

Run: `pnpm --filter @mychess/chess exec vitest run src/training/review-repeats.test.ts`
Expected: the changed expectations and the new property fail (totals 3, `currentSan` `e4`).

- [ ] **Step 4: Implement** in `review-session.ts`

Header comment, last sentence: replace "and counts toward the session size from the moment it is answered." with "on top of the session size, which counts moves (R-223)."

`ReviewBounds.size` doc:

```ts
  /** R-62, R-223: the moves the session asks; repeats (R-78) come on top. */
  readonly size: number;
```

`room`:

```ts
/** Room left for first asks: the size less the moves answered (R-223). */
const room = (s: Asks): number => s.size - s.outcomes.size;
```

`reviewProgress`:

```ts
/** The keys still owed an answer: the repeats, and a repeat being asked. */
function owedKeys(s: ReviewSessionState): Set<string> {
  const owed = new Set(s.repeats.map((r) => r.item.key));
  if (s.current?.repeat === true && !s.recorded) owed.add(s.current.item.key);
  return owed;
}

/**
 * The session's progress in moves (R-223): the moves answered with no
 * repeat owed, of the moves the session holds, a total fixed at its start.
 */
export function reviewProgress(s: ReviewSessionState): ReviewProgress {
  const owed = owedKeys(s);
  const done = [...s.outcomes.keys()].filter((k) => !owed.has(k)).length;
  return { done, total: Math.min(s.size, s.order.length) };
}
```

`ReviewProgress` doc: "Moves finished, of the moves the session holds (R-223)." `startReviewSession` doc: "it asks `size` moves, repeats on top (R-62, R-78, R-223)". Remove `asked` from the `Asks` pick only if nothing else reads it there (it is still set by `record`; keep the field on the state).

- [ ] **Step 5: Run, expect PASS**

Run: `pnpm --filter @mychess/chess exec vitest run src/training/`
Expected: PASS (the old `'every session ends…'` property still holds).

- [ ] **Step 6: Update the web state test to R-223**

In `apps/web/src/app/training/review-drill-state.test.ts`:
- `'asks a lapsed move again once its relearning step runs out'`: `expect(progress(repeat)).toEqual({ done: 1, total: 10 });`
- `'asks a lapsed move again at the end…'`: the comment becomes `// The repeat takes no slot (R-223): all ten moves are asked.`, `expect(progress(afterLapse)).toEqual({ done: 0, total: 10 });`, `sessionCounts(done)` is `{ kind: 'review', reviewed: 10, passed: 9, lapses: 1 }`, and the last two lines become `expect(asked).toBe(10); expect(total).toBe(10);`.
- `'asks a move missed again on its repeat once more'`: `toMatchObject({ reviewed: 10, lapses: 1 })`.

Run: `pnpm --filter @mychess/web exec vitest run src/app/training/review-drill-state.test.ts` — PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/chess/src/training apps/web/src/app/training/review-drill-state.test.ts
git commit -m "feat(chess): the review size counts moves, repeats on top; progress counts finished moves (#381, R-223)"
```

---

### Task 2: The position after a move (chess, chess-dev)

The board holds a wrong move for its flash, so the web needs the position it leads to.

**Files:**
- Modify: `packages/chess/src/legal-moves.ts`, `packages/chess/src/index.ts`
- Test: `packages/chess/src/legal-moves.test.ts` (create if absent; it is run by the chess vitest project)

- [ ] **Step 1: Failing test**

```ts
import { describe, expect, it } from 'vitest';
import { legalMoves, positionAfterMove } from './legal-moves';
import { positionKey, START_KEY } from './position-key';

describe('positionAfterMove', () => {
  it('is the key of the position the move leads to', () => {
    const e4 = legalMoves(START_KEY).find((m) => m.san === 'e4');
    expect(e4 && positionAfterMove(START_KEY, e4)).toBe(
      positionKey('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1'),
    );
  });
  it('promotes to the move’s piece', () => {
    const key = positionKey('8/P7/8/8/8/8/8/k6K w - - 0 1');
    const knight = legalMoves(key).find((m) => m.promotion === 'n');
    expect(knight && positionAfterMove(key, knight)).toBe(
      positionKey('N7/8/8/8/8/8/8/k6K b - - 0 1'),
    );
  });
});
```

Run: `pnpm --filter @mychess/chess exec vitest run src/legal-moves.test.ts` — FAIL (not exported).

- [ ] **Step 2: Implement** in `legal-moves.ts` (import `positionKey` from `./position-key`)

```ts
/**
 * The key of the position `move` leads to from `key`'s. The move is one of
 * `legalMoves(key)`: an illegal one is a programmer error and throws.
 */
export function positionAfterMove(key: string, move: BoardMove): string {
  const chess = new Chess(fenOf(key));
  chess.move({
    from: move.orig,
    to: move.dest,
    ...(move.promotion === null ? {} : { promotion: move.promotion }),
  });
  return positionKey(chess.fen());
}
```

Export it from `src/index.ts` next to `legalMoves`.

- [ ] **Step 3: Run, expect PASS; commit**

```bash
git add packages/chess/src
git commit -m "feat(chess): positionAfterMove (#381)"
```

---

### Task 3: Each training entry carries its chapter titles (web server, web-dev)

**Files:**
- Modify: `apps/web/src/server/chapter-names.ts`, `apps/web/src/lib/training-data.ts`, `apps/web/src/server/training.ts`
- Test: `apps/web/src/server/chapter-names.test.ts`, `apps/web/src/server/training.test.ts`

- [ ] **Step 1: Failing test** (append to `chapter-names.test.ts`; import `chapterTitlesOf` and `START_KEY`)

```ts
describe('chapterTitlesOf', () => {
  it('titles every chapter by id, as the repertoire page does', () => {
    const graph = {
      side: 'white' as const,
      chapters: [
        { id: 'c1', rootKey: START_KEY, intro: null, nameSource: { kind: 'custom' as const, name: 'Main line' } },
        { id: 'c2', rootKey: START_KEY, intro: null, nameSource: { kind: 'index' as const, number: 2 } },
      ],
      moves: [],
    };
    const label = chapterLabelOf(graph);
    expect(chapterTitlesOf(graph)).toEqual({
      c1: 'Main line',
      c2: label(graph.chapters[1] ?? graph.chapters[0]),
    });
  });
});
```

(If `graph.chapters[1]` reads awkwardly under `noUncheckedIndexedAccess`, take it out with a `const [, second] = graph.chapters` and `if (second === undefined) throw new Error('fixture')`.)

- [ ] **Step 2: Implement** in `chapter-names.ts`

```ts
/** Every chapter of `graph` titled as on its page (R-158, R-216), by id: for the training header (R-224). */
export function chapterTitlesOf(
  graph: RepertoireGraph,
): Readonly<Record<string, string>> {
  const label = chapterLabelOf(graph);
  return Object.fromEntries(graph.chapters.map((c) => [c.id, label(c)]));
}
```

In `training-data.ts`, `EntryBase` gains:

```ts
  /** Each chapter's title by id, for the header's context line (R-224). */
  readonly chapterTitles: Readonly<Record<string, string>>;
```

In `server/training.ts` `dataEntry`, `base` gains `chapterTitles: chapterTitlesOf(repertoire.graph),` (import from `./chapter-names`).

- [ ] **Step 3: Update `training.test.ts`**: in `'hands the page plain data in the learn order'` add `chapterTitles: chapterTitlesOf(TAIMANOV_GRAPH),` and `chapterTitles: chapterTitlesOf(LONDON_GRAPH),` to the two entries (import `chapterTitlesOf` from `./chapter-names`).

- [ ] **Step 4: Fix the fixtures**: `pnpm --filter @mychess/web typecheck` lists every `TrainingData` entry built in tests without `chapterTitles`; add `chapterTitles: {}` to each (or the shared fixture builder they use).

- [ ] **Step 5: Run and commit**

Run: `pnpm --filter @mychess/web exec vitest run src/server/ src/app/training/` — PASS.

```bash
git add apps/web/src
git commit -m "feat(web): training entries carry their chapter titles (#381, R-224)"
```

---

### Task 4: The header names the session and the item (web, web-dev)

**Files:**
- Create: `apps/web/src/app/training/session-header.ts`, `session-header.test.ts`
- Modify: `drill.ts`, `drill-board.ts`, `review-drill-state.ts`, `learn-drill-state.ts`, `use-review-drill.ts`, `use-learn-drill.ts`, `review-drill.tsx`, `learn-drill.tsx`, `training-screen.tsx`, `training-frame.tsx`, `frame-classes.ts`, `apps/web/src/i18n/messages/en.json`
- Test: `training-frame.test.tsx`, `training-screen.test.tsx`, `review-drill.test.tsx`, `learn-drill.test.tsx`
- E2E: `apps/web/e2e/support/training.ts`, `apps/web/e2e/home.spec.ts`, `apps/web/e2e/training-know.spec.ts`

- [ ] **Step 1: Failing test** `session-header.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { sessionHeader, type HeaderWord } from './session-header';

const WORDS: Record<HeaderWord, string> = {
  'title.review': "Today's review",
  'title.learn': 'Learn new moves',
  'side.white': 'White',
  'side.black': 'Black',
};
const word = (key: HeaderWord): string => WORDS[key];
const CARO = { name: 'Caro-Kann', side: 'black' as const, chapter: 'Main line' };

describe('sessionHeader (R-224)', () => {
  it('titles a session over every repertoire by its name, the item under it', () => {
    expect(sessionHeader({ mode: 'review', scopedName: null, item: CARO }, word)).toEqual({
      title: "Today's review",
      context: 'Caro-Kann (Black) · Main line',
    });
    expect(sessionHeader({ mode: 'learn', scopedName: null, item: CARO }, word).title).toBe('Learn new moves');
  });
  it('titles a scoped session by its repertoire, the side and chapter under it', () => {
    expect(sessionHeader({ mode: 'review', scopedName: 'Caro-Kann', item: CARO }, word)).toEqual({
      title: 'Caro-Kann',
      context: 'Black · Main line',
    });
  });
  it('has no context line without an item, and leaves out a missing chapter', () => {
    expect(sessionHeader({ mode: 'review', scopedName: null, item: undefined }, word)).toEqual({
      title: "Today's review",
      context: null,
    });
    expect(
      sessionHeader({ mode: 'review', scopedName: null, item: { ...CARO, chapter: null } }, word).context,
    ).toBe('Caro-Kann (Black)');
  });
});
```

Run: `pnpm --filter @mychess/web exec vitest run src/app/training/session-header.test.ts` — FAIL.

- [ ] **Step 2: Implement** `session-header.ts`

```ts
// The training top bar's words (R-224): the session's name as the title,
// and under it the item asked: its repertoire, side and chapter. Pure, so
// the rule is tested apart from the frame.
import type { Side, TrainingMode } from '@mychess/chess';

/** The item asked now, as the header names it. */
export interface HeaderItem {
  readonly name: string;
  readonly side: Side;
  /** The chapter's title; null when the entry has none for it. */
  readonly chapter: string | null;
}

export interface HeaderInput {
  readonly mode: TrainingMode;
  /** The repertoire a scoped session trains; null over every repertoire. */
  readonly scopedName: string | null;
  readonly item: HeaderItem | undefined;
}

export type HeaderWord =
  | 'title.review'
  | 'title.learn'
  | 'side.white'
  | 'side.black';

export interface SessionHeader {
  readonly title: string;
  readonly context: string | null;
}

const joined = (parts: readonly (string | null)[]): string | null => {
  const shown = parts.filter((p): p is string => p !== null && p !== '');
  return shown.length === 0 ? null : shown.join(' · ');
};

export function sessionHeader(
  { mode, scopedName, item }: HeaderInput,
  word: (key: HeaderWord) => string,
): SessionHeader {
  const title = scopedName ?? word(`title.${mode}`);
  if (item === undefined) return { title, context: null };
  const side = word(`side.${item.side}`);
  const repertoire = scopedName === null ? `${item.name} (${side})` : side;
  return { title, context: joined([repertoire, item.chapter]) };
}
```

- [ ] **Step 3: The drills report the item**

`drill.ts`: in `FrameParts` replace `title?` with

```ts
  /** The item asked now: the header names its repertoire and chapter (R-224). */
  readonly item?: HeaderItem | undefined;
```

`review-drill-state.ts` adds:

```ts
/** The chapter of the item on the board. */
export const chapterOf = (s: DrillState): string | undefined =>
  s.shown?.line.chapterId;
```

`learn-drill-state.ts` adds:

```ts
/** The chapter of the line on the board. */
export const chapterOf = (s: LearnDrillState): string | undefined =>
  s.session?.line.chapterId;
```

`drill-board.ts`: `BoardSource` gains `readonly chapterOf: (s: S) => string | undefined;`; `DrillBoard.titled` is replaced by `readonly item: HeaderItem | undefined;`; in `useDrillBoard`:

```ts
  const chapterId = source.chapterOf(state);
  const item =
    entry === undefined
      ? undefined
      : {
          name: entry.name,
          side: entry.side,
          chapter:
            chapterId === undefined
              ? null
              : (entry.chapterTitles[chapterId] ?? null),
        };
  return { view, legal, item };
```

`use-review-drill.ts` and `use-learn-drill.ts` pass `chapterOf` to `useDrillBoard`, return `item` where they returned `titled` (and the `ReviewDrill`/`LearnDrill` interfaces pick `'item'` instead of `'titled'`). In `review-drill.tsx` and `learn-drill.tsx`, `parts` becomes `{ item: drill.item, progress: … }`.

- [ ] **Step 4: The frame shows title, context and counter**

`training-screen.tsx`: remove `isMixed`, `mixedTitle` and the `defaultTitle`/`subtitle` props. In `frame`:

```tsx
  const header = (parts: FrameParts) =>
    sessionHeader(
      { mode: data.mode, scopedName: scoped?.name ?? null, item: parts.item },
      (key) => t(key),
    );
  const frame = (parts: FrameParts): JSX.Element => (
    <TrainingFrame
      {...parts}
      {...header(parts)}
      backHref={links.back}
      side={scoped?.side ?? 'white'}
      banner={/* unchanged */}
    />
  );
```

(`t` is `useTranslations('training')`; the `HeaderWord` keys exist under it after Step 6.)

`training-frame.tsx`: `TrainingFrameProps` drops `mode`, `defaultTitle`, `subtitle`; gains `readonly title: string; readonly context: string | null;`. Replace `BackLink` with a local icon button and `TopBar` with:

```tsx
/** The way back: an icon button at every width, as in the shell. */
function BackButton({ href, label }: { readonly href: string; readonly label: string }): JSX.Element {
  return (
    <Link
      href={href}
      aria-label={label}
      className="inline-flex min-h-touch min-w-touch shrink-0 items-center justify-center rounded-control text-accent hover:bg-accent-subtle"
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M15 6l-6 6 6 6" />
      </svg>
    </Link>
  );
}

function ProgressBar({ done, total }: { readonly done: number; readonly total: number }): JSX.Element {
  const share = total === 0 ? 0 : Math.min(1, done / total);
  return (
    <div aria-hidden="true" className="mx-gutter h-1.5 overflow-hidden rounded-pill bg-border lg:mx-0">
      <div className="h-full rounded-pill bg-accent" style={{ width: `${String(share * 100)}%` }} />
    </div>
  );
}

function TopBar({ backHref, title, context, progress }: TopBarProps): JSX.Element {
  const t = useTranslations('training');
  return (
    <div className={FRAME_HEAD}>
      <header className={FRAME_TOP}>
        <BackButton href={backHref} label={t('back')} />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold lg:text-xl">{title}</h1>
          {context === null ? null : (
            <p className="truncate text-sm text-fg-muted">{context}</p>
          )}
        </div>
        {progress === undefined ? null : (
          <p className="shrink-0 text-base font-semibold tabular-nums">
            {t('counter', progress)}
          </p>
        )}
      </header>
      {progress === undefined ? null : <ProgressBar {...progress} />}
    </div>
  );
}
```

`TopBarProps` is `{ backHref, title, context, progress }`. `TrainingFrame` passes `title={props.title} context={props.context}`. Import `Link` from `next/link`; drop the `BackLink` import.

`frame-classes.ts`:
- `FRAME_TOP`: `'flex min-h-14 items-center gap-2 px-gutter lg:min-h-0 lg:px-0'` (the top bar stays a row on desktop: Back, title, counter).
- `FRAME_MAIN`: in the `--board-edge` `min(...)`, `42.5rem` becomes `50rem`; replace `lg:max-w-6xl` with `lg:w-full lg:max-w-7xl`. Update the comment's "680px at most" to "800px at most".
- `loading.tsx` uses `FRAME_TOP`: its skeleton row needs no change.

- [ ] **Step 5: Catalogue** (`en.json`, `training`): `title.learn` becomes `"Learn new moves"`; remove `title.mixed` and `mode`; add `"side": { "white": "White", "black": "Black" }`.

- [ ] **Step 6: Update the frame and screen tests**

- `training-frame.test.tsx`: replace the two subtitle tests with: `'shows the context line under the title, outside the heading (R-224)'` rendering `title: "Today's review", context: 'Caro-Kann (Black) · Main line'` and asserting `title.nextElementSibling?.textContent` is the context; and `'shows the title alone without a context line'` with `context: null`. Update `renderFrame`'s props to `title`/`context` (no `mode`, `defaultTitle`, `subtitle`). Add: `it('labels the back link for screen readers, an icon on screen', …)` asserting `getByRole('link', { name: 'Back' })`.
- `training-screen.test.tsx`: the mixed-session test at lines ~310-340 now expects `heading level 1` named `T.title.review` and the context line `'review item (White)'` followed by the chapter title the fixture's graph gives (read it with `chapterTitlesOf` on the fixture graph, or give the fixture entry `chapterTitles: { [chapterId]: 'Main line' }` and expect `'review item (White) · Main line'`); delete the `queryByText(T.title.mixed)` assertion. The learn-scoped test at ~182 expects `T.title.learn`, which now reads "Learn new moves".
- `review-drill.test.tsx` (~216) and `learn-drill.test.tsx` (~204): these render a drill through a test `frame`; where they asserted the title from `titled`, assert the frame received `item.name` `'Londono sistema'` instead (the heading is the screen's job now).

Run: `pnpm --filter @mychess/web exec vitest run src/app/training/` — PASS.

- [ ] **Step 7: E2E helpers and specs**

`e2e/support/training.ts`, `itemRepertoire`:

```ts
/**
 * The repertoire of the item asked (R-224): the title of a scoped session,
 * else the context line under the session's name, without its side and
 * chapter.
 */
export async function itemRepertoire(page: Page, messages: Messages): Promise<string> {
  const title = page.getByRole('heading', { level: 1 });
  const text = (await title.textContent()) ?? '';
  const sessions = [messages.training.title.review, messages.training.title.learn];
  if (!sessions.includes(text)) return text;
  const context = (await title.locator('xpath=following-sibling::p').textContent()) ?? '';
  const { white, black } = messages.training.side;
  return context.replace(new RegExp(` \\((${white}|${black})\\)( · .*)?$`), '');
}
```

`home.spec.ts` (~73) and `training-know.spec.ts` (~123): the heading expectation becomes `toHaveText(en.training.title.review)`; update the comments to "titled as today's review, the item's under it (R-224)".

- [ ] **Step 8: Commit**

```bash
git add apps/web
git commit -m "feat(web): the training header names the session and the item asked (#381, R-224)"
```

---

### Task 5: Shared tonal, quiet and hero buttons (web, web-dev)

**Files:**
- Modify: `apps/web/src/app/buttons.ts`, `apps/web/src/app/today/today-hero.tsx`, `apps/web/src/app/today/repertoire-rows.tsx`, `apps/web/src/app/training/review-drill.tsx`, `learn-drill.tsx`

- [ ] **Step 1: Add to `buttons.ts`**

```ts
/**
 * An action that belongs to the content (Today's rows, the drill's Hint and
 * Type): tinted with the accent, not outlined. Unavailable, it fades to
 * half and says so to the pointer (aria-disabled).
 */
export const TONAL_BUTTON = `${BUTTON} bg-accent-subtle text-accent aria-disabled:cursor-not-allowed aria-disabled:opacity-50`;

/** A way out that must not compete with the page's work (End session, Done beside a next step). */
export const QUIET_ACTION = `${BUTTON} text-fg-muted hover:text-fg`;

// The buttons on an accent card (Today's hero, training's Nothing due): the
// main one inverted (surface on accent), the second outlined in the card's
// text colour. The focus ring takes the card's text colour, as the page's
// accent ring would vanish on the accent card.
const HERO_BUTTON = `${BUTTON} focus-visible:outline-accent-fg`;
export const HERO_PRIMARY_BUTTON = `${HERO_BUTTON} bg-surface text-accent`;
export const HERO_SECONDARY_BUTTON = `${HERO_BUTTON} border border-accent-fg text-accent-fg`;
```

- [ ] **Step 2: Use them**

- `today-hero.tsx`: delete the local `HERO_BUTTON`, `HERO_PRIMARY`, `HERO_SECONDARY` and their comment; import `HERO_PRIMARY_BUTTON`, `HERO_SECONDARY_BUTTON` and use them where the locals were.
- `repertoire-rows.tsx`: `const ROW_BUTTON = \`${TONAL_BUTTON} shrink-0\`;`
- `review-drill.tsx`: the Hint button's class becomes `TONAL_BUTTON` (the `self-start aria-disabled:opacity-60` goes); both drills' End session `Link` uses `QUIET_ACTION` instead of `SECONDARY_BUTTON`.

- [ ] **Step 3: Test** (append to `review-drill.test.tsx`)

```ts
  it('fades a used Hint and marks it unavailable (R-61)', async () => {
    // Render a review drill as the file's other tests do, then press Hint.
    const hint = screen.getByRole('button', { name: T.review.hint });
    await user.click(hint);
    expect(hint).toHaveAttribute('aria-disabled', 'true');
    expect(hint.className).toContain('aria-disabled:opacity-50');
  });
```

(Use the file's existing render helper and `user` setup.) Run the web training and today tests — PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app
git commit -m "feat(web): tonal, quiet and hero buttons shared; Hint tonal, End session quiet (#381)"
```

---

### Task 6: The typed move behind a Type button on phones (web, web-dev)

**Files:**
- Create: `apps/web/src/app/training/move-entry.tsx`, `move-entry.test.tsx`
- Modify: `apps/web/src/app/board/move-input.tsx`, `apps/web/src/app/training/drill-panel.tsx`, `review-drill.tsx`, `en.json`
- E2E: `apps/web/e2e/support/training.ts`, `apps/web/e2e/training-know.spec.ts`, `apps/web/e2e/training-layout.spec.ts`

- [ ] **Step 1: `MoveInput` takes a ref to its field**: add `readonly inputRef?: Ref<HTMLInputElement>;` to `MoveInputProps` and `ref={inputRef}` on the `<input>` (import `type Ref` from `react`).

- [ ] **Step 2: Failing test** `move-entry.test.tsx`

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithMessages } from '../../test/render'; // the helper other training tests use
import { MoveEntry } from './move-entry';

const FIELD = 'Type a move';
const TYPE = 'Type';

describe('MoveEntry', () => {
  it('opens the field from Type and puts the focus in it', async () => {
    const user = userEvent.setup();
    renderWithMessages(<MoveEntry onTyped={() => true} />);
    const toggle = screen.getByRole('button', { name: TYPE });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText(FIELD)).toHaveFocus();
  });
  it('closes after a taken move and gives the focus back to Type', async () => {
    const user = userEvent.setup();
    const onTyped = vi.fn(() => true);
    renderWithMessages(<MoveEntry onTyped={onTyped} />);
    await user.click(screen.getByRole('button', { name: TYPE }));
    await user.keyboard('e4{Enter}');
    expect(onTyped).toHaveBeenCalledWith('e4');
    expect(screen.getByRole('button', { name: TYPE })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: TYPE })).toHaveFocus();
  });
  it('stays open after a refused move, and closes on Escape', async () => {
    const user = userEvent.setup();
    renderWithMessages(<MoveEntry onTyped={() => false} />);
    const toggle = screen.getByRole('button', { name: TYPE });
    await user.click(toggle);
    await user.keyboard('Zz9{Enter}');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard('{Escape}');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveFocus();
  });
  it('shows the buttons it is given beside Type', () => {
    renderWithMessages(<MoveEntry onTyped={() => true}><button type="button">Hint</button></MoveEntry>);
    expect(screen.getByRole('button', { name: 'Hint' })).toBeInTheDocument();
  });
});
```

(Use whichever render-with-catalogue helper the neighbouring tests use; `render` from Testing Library is imported only if that helper wraps it.)

Run — FAIL.

- [ ] **Step 3: Implement** `move-entry.tsx`

```tsx
'use client';

// The typed move (docs/design/training-screen.md, owner 2026-11-25): below
// `lg` the field waits behind a Type button, so it neither takes the
// panel's room nor opens the keyboard over the board; at `lg` and up it is
// always shown. The field stays mounted while closed (hidden by CSS), so a
// taken move clears it as on desktop.
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type JSX, type KeyboardEvent, type ReactNode } from 'react';
import { MoveInput } from '../board/move-input';
import { TONAL_BUTTON } from '../buttons';

export interface MoveEntryProps {
  /** As `MoveInput`'s: whether the drill took the typed move. */
  readonly onTyped: (text: string) => boolean;
  /** Buttons beside Type (the review's Hint). */
  readonly children?: ReactNode;
}

function KeyboardIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="6" width="18" height="12" rx="2" />
      <path d="M7 10h.01M11 10h.01M15 10h.01M7 14h10" />
    </svg>
  );
}

export function MoveEntry({ onTyped, children }: MoveEntryProps): JSX.Element {
  const t = useTranslations('training.drill');
  const [open, setOpen] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open) field.current?.focus();
  }, [open]);
  const close = (): void => {
    if (!open) return;
    setOpen(false);
    toggle.current?.focus();
  };
  const typed = (text: string): boolean => {
    const taken = onTyped(text);
    if (taken) close();
    return taken;
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') close();
  };
  return (
    <div className="flex flex-col gap-3">
      <div onKeyDown={onKeyDown} className={open ? 'flex' : 'flex max-lg:hidden'}>
        <MoveInput onTyped={typed} inputRef={field} />
      </div>
      <div className="flex flex-wrap gap-2">
        {children}
        <button
          ref={toggle}
          type="button"
          aria-expanded={open}
          onClick={() => {
            setOpen(true);
          }}
          className={`${TONAL_BUTTON} gap-2 lg:hidden`}
        >
          <KeyboardIcon />
          {t('type')}
        </button>
      </div>
    </div>
  );
}
```

Catalogue: `training.drill.type`: `"Type"`.

- [ ] **Step 4: Use it**: in `drill-panel.tsx`, `MoveRow` takes `children?: ReactNode` and renders `<MoveEntry onTyped={input.onTyped}>{children}</MoveEntry>` instead of the `MoveInput` row (the promotion branch is unchanged). In `review-drill.tsx`, the Hint button moves inside `<MoveRow …>`; the separate Hint block goes.

Run: `pnpm --filter @mychess/web exec vitest run src/app/training/ src/app/board/` — PASS.

- [ ] **Step 5: E2E**

`e2e/support/training.ts`:

```ts
/** The typed-move field, opened from Type where a phone keeps it closed. */
export async function openMoveField(page: Page, messages: Messages): Promise<Locator> {
  const field = moveField(page, messages);
  if (!(await field.isVisible()))
    await page.getByRole('button', { name: messages.training.drill.type, exact: true }).click();
  return field;
}
```

`typed` starts with `const field = await openMoveField(d.page, d.messages);`. In `training-know.spec.ts`, replace the fixed `field` with `const field = await openMoveField(page, en);` inside the loop before `field.fill` (import it).

`training-layout.spec.ts`: below 1024px wide the Type button is what must be in view. In `measure`, take a `compact` flag and find the target as `compact ? [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === typeLabel) : document.querySelector(\`input[placeholder="${label}"]\`)` (pass `en.training.drill.type` in); the visibility assertion uses `page.getByRole('button', { name: en.training.drill.type, exact: true })` when `viewport.width < 1024`. Rename `field` to `entry` in the box checks.

- [ ] **Step 6: Commit**

```bash
git add apps/web
git commit -m "feat(web): on a phone the typed move waits behind a Type button (#381)"
```

---

### Task 7: The panel: side dot, status pills, phone line, move list, notes (web, web-dev)

**Files:**
- Create: `apps/web/src/app/training/phone-line.ts`, `phone-line.test.ts`
- Modify: `apps/web/src/app/tokens.css`, `drill-panel.tsx`, `review-drill.tsx`, `learn-drill.tsx`, `coach-note.tsx`, `two-answers-notice.tsx`
- Test: `drill-panel.test.tsx`; E2E `e2e/support/training.ts`

- [ ] **Step 1: Failing test** `phone-line.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { phoneLine } from './phone-line';

const SANS = 'e4 c6 d4 d5 Nc3 dxe4 Nxe4 Bf5 Ng3 Bg6 h4 h6 Nf3 Nd7'.split(' ');

describe('phoneLine', () => {
  it('writes a short line whole', () => {
    expect(phoneLine(SANS.slice(0, 4), true)).toBe('1. e4 c6 2. d4 d5');
  });
  it('keeps the last six full moves, from a move number, after an ellipsis', () => {
    expect(phoneLine(SANS, true)).toBe(
      '… 2. d4 d5 3. Nc3 dxe4 4. Nxe4 Bf5 5. Ng3 Bg6 6. h4 h6 7. Nf3 Nd7',
    );
  });
  it('starts a Black-first line with its number and dots', () => {
    expect(phoneLine(['c6', 'd4'], false)).toBe('1... c6 2. d4');
  });
  it('is empty for no moves', () => {
    expect(phoneLine([], true)).toBe('');
  });
});
```

(If `lineText` writes the number and move with a no-break space, compare with `.replace(/ /g, ' ')` on both sides, or build the expectations with the same separator `phoneLine` uses.)

- [ ] **Step 2: Implement** `phone-line.ts`

```ts
// The line so far as a phone shows it (#381): it wraps, so it keeps only
// the last few full moves, starting at a move number after "…", never
// mid-move. The whole line stays in the accessible text.
import { lineText, moveNumber } from '@mychess/chess';

/** Full moves a phone shows. */
export const PHONE_MOVES = 6;

export function phoneLine(
  sans: readonly string[],
  whiteFirst: boolean,
  keep = PHONE_MOVES,
): string {
  const offset = whiteFirst ? 0 : 1;
  const lastMove = Math.floor((sans.length - 1 + offset) / 2);
  const cut = 2 * Math.max(0, lastMove - keep + 1) - offset;
  if (sans.length === 0 || cut <= 0) return lineText([...sans], whiteFirst);
  const words = sans.slice(cut).flatMap((san, i) =>
    (cut + i + offset) % 2 === 0 ? [moveNumber(cut + i, whiteFirst), san] : [san],
  );
  return ['…', ...words].join(' ');
}
```

(Check `lineText`'s parameter type; pass `sans` directly if it takes a readonly array.)

Run its test — PASS.

- [ ] **Step 3: Side dot tokens** (`tokens.css`, the static board group, after `--color-board-hint-edge`):

```css
  /* The side-to-move dot by the prompt: a white and a black disc, the same
     in both themes, ringed so either shows on either page colour. */
  --color-side-white: #ffffff;
  --color-side-black: #141a26;
  --color-side-ring: #7d8597;
```

`ToMove` in `drill-panel.tsx`: the dot's class becomes `size-3 rounded-full border border-side-ring ${color === 'white' ? 'bg-side-white' : 'bg-side-black'}`.

- [ ] **Step 4: Status pills** (`drill-panel.tsx`):

```tsx
export type StatusTone = 'prompt' | 'success' | 'error' | 'due';

const PILL = 'flex items-center gap-2 self-start rounded-control px-3 py-2 text-base font-semibold';
const STATUS_CLASS: Record<StatusTone, string> = {
  prompt: 'text-lg font-bold',
  success: `${PILL} bg-success-subtle text-success`,
  error: `${PILL} bg-error-subtle text-error`,
  due: `${PILL} bg-due-subtle text-due`,
};
const ICON: Record<StatusTone, string | null> = {
  prompt: null,
  success: 'M5 12l5 5 9-10',
  error: 'M6 6l12 12M18 6L6 18',
  due: 'M12 8v5M12 16h.01',
};

/** The prompt, or an answer's result as a tinted pill with its icon. */
export function StatusLine({ tone, text }: { readonly tone: StatusTone; readonly text: string }): JSX.Element {
  const path = ICON[tone];
  return (
    <p className={STATUS_CLASS[tone]}>
      {path === null ? null : (
        <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <path d={path} />
        </svg>
      )}
      {text}
    </p>
  );
}
```

In `review-drill.tsx`, `TONES` becomes `Record<StatusKey, StatusTone>` = `{ correct: 'success', lapse: 'error', hinted: 'due', again: 'due', prompt: 'prompt' }` and the status `<p>` becomes `<StatusLine tone={TONES[status]} text={t(\`training.review.${status}\`)} />`. In `learn-drill.tsx`, `TONES` is `{ correct: 'success', wrong: 'error', known: 'prompt', arrows: 'prompt', blind: 'prompt', recall: 'prompt' }` and the prompt renders through `StatusLine`. The E2E `asking` locator matches by text, so it still finds the pill.

- [ ] **Step 5: Line so far** (`LineSoFar` in `drill-panel.tsx`): `Layouts` gains `phone: string` (`phoneLine(moves.map(shownSan), whiteFirst)`). Replace the scrolling row `<p ref={row} …>` with two paragraphs, the whole line first:

```tsx
          <p className="sr-only lg:hidden">{layouts.text}</p>
          <p aria-hidden="true" className="text-sm leading-relaxed text-fg-muted tabular-nums lg:hidden">
            {layouts.phone}
          </p>
```

Drop the `row` ref and its `scrollLeft` line. The `<ol>`'s columns: `lg:grid-cols-[2.5rem_5rem_5rem]` replaces `grid-cols-[auto_1fr_1fr]` at `lg` (keep the `tall:` columns).

In `e2e/support/training.ts`, `lineSans` reads `following-sibling::p[1]` (the whole line).

- [ ] **Step 6: Notes as soft cards**

`coach-note.tsx`, the `section`: `className="flex flex-col gap-2 rounded-card bg-accent-subtle p-4"`, with a first child `<p className="text-xs font-bold tracking-wide text-accent uppercase">{t('training.drill.coachNote')}</p>`.

`two-answers-notice.tsx`, the `div`: `className="rounded-card bg-accent-subtle px-4 py-3 text-sm text-fg"`.

- [ ] **Step 7: Tests** (append to `drill-panel.test.tsx`)

```tsx
  it('shows the whole line to screen readers and the phone its last moves', () => {
    // render LineSoFar with a 14-ply line as the file's other tests build one
    expect(screen.getByText(/^1\. e4 c6 2\. d4/)).toHaveClass('sr-only');
    expect(screen.getByText(/^… 2\. d4/)).toHaveAttribute('aria-hidden', 'true');
  });
  it('draws a result as a tinted pill', () => {
    renderWithMessages(<StatusLine tone="error" text="Not that move." />);
    expect(screen.getByText('Not that move.')).toHaveClass('bg-error-subtle');
  });
```

Run the training tests — PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web
git commit -m "feat(web): training panel; result pills, the side dot alike in both themes, the phone line from a move number, notes as soft cards (#381)"
```

---

### Task 8: Softer move badges, coordinates and a stronger arrow (web, ux-designer review)

**Files:**
- Modify: `apps/web/src/app/tokens.css`, `apps/web/src/app/tokens.test.ts`, `apps/web/src/app/board/board.css`, `apps/web/src/app/board/board-config.ts`, `board-config.test.ts`

- [ ] **Step 1: Failing contrast test**: in `tokens.test.ts` `PAIRS`, add

```ts
  // The move badges' white glyph (owner choice D, #381): a graphic, 3:1.
  ['board-badge-glyph', 'board-badge-correct', UI],
  ['board-badge-glyph', 'board-badge-wrong', UI],
```

It passes with today's colours too; it guards the new ones.

- [ ] **Step 2: Tokens** (`tokens.css`):

```css
  --color-board-arrow: rgb(21 120 27 / 0.95); /* Learn pass and lapse arrows */
  --color-board-correct: rgb(39 146 87 / 0.3); /* square flash, success */
  --color-board-wrong: rgb(214 90 80 / 0.3); /* square flash, lapse */
  /* The check and cross badges in a flashed square's corner (owner choice
     D, #381): lichess's shape in Ocean-tuned colours, the same in both
     themes, a white glyph at 3.9:1 on each, lifted by a soft shadow. */
  --color-board-badge-correct: #279257;
  --color-board-badge-wrong: #d65a50;
```

- [ ] **Step 3: Badges and coordinates** (`board.css`)

The shared badge rule:

```css
.cg-wrap cg-board square.correct::after,
.cg-wrap cg-board square.wrong::after {
  content: '';
  position: absolute;
  top: 2%;
  right: 2%;
  width: 38%;
  height: 38%;
  border-radius: 50%;
  box-shadow: 0 1px 3px rgb(0 0 0 / 0.45);
  pointer-events: none;
  background:
    var(--icon) center / 72% no-repeat,
    var(--tone);
}
```

The two icons, filled (lichess's check from `chessground/src/glyph.ts`, a heavier cross):

```css
.cg-wrap cg-board square.correct::after {
  --tone: var(--color-board-badge-correct);
  --icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Cpath fill='white' d='M87 32.8q0 2-1.4 3.2L51 70.6 44.6 77q-1.7 1.3-3.4 1.3-1.8 0-3.1-1.3L14.3 53.3Q13 52 13 50q0-2 1.3-3.2l6.4-6.5Q22.4 39 24 39q1.9 0 3.2 1.3l14 14L72.7 23q1.3-1.3 3.2-1.3 1.6 0 3.3 1.3l6.4 6.5q1.3 1.4 1.3 3.4z'/%3E%3C/svg%3E");
}

.cg-wrap cg-board square.wrong::after {
  --tone: var(--color-board-badge-wrong);
  --icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='5' stroke-linecap='round'%3E%3Cpath d='M6.5 6.5l11 11M17.5 6.5l-11 11'/%3E%3C/svg%3E");
}
```

Update the comment above them ("no ring: a shadow parts them from any square").

Coordinates: `.cg-wrap coords` gets `font-size: 0.625rem; font-weight: 600;`; `.cg-wrap coords.ranks coord` padding `1px 2px 0 0`; `.cg-wrap coords.files coord` padding `0 0 1px 2px`.

- [ ] **Step 4: The arrow's width** (`board-config.ts`): `brush` takes `lineWidth = 10` as a third parameter; `arrow: brush('a', read('--color-board-arrow'), 15)`. In `board-config.test.ts` the `arrow` brush expects `lineWidth: 15`.

- [ ] **Step 5: Run and commit**

Run: `pnpm --filter @mychess/web exec vitest run src/app/tokens.test.ts src/app/board/` — PASS.

```bash
git add apps/web/src/app
git commit -m "feat(web): move badges in Ocean tones, smaller coordinates, a stronger arrow (#381)"
```

---

### Task 9: Feedback holds 700ms, the wrong move stays on the board (web, web-dev)

**Files:**
- Modify: `apps/web/src/app/tokens.css`, `drill-input.ts`, `drill-board.ts`, `review-drill-state.ts`, `learn-drill-state.ts`
- Test: `drill-board.test.ts`, `review-drill-state.test.ts`, and the learn drill state test file (`learn-drill.test.tsx` if no `learn-drill-state.test.ts` exists)

- [ ] **Step 1: Failing tests**

`drill-board.test.ts`:

```ts
  it('holds a wrong move on the board for its flash, without the arrow or moves', () => {
    const after = positionAfterMove(START_KEY, { orig: 'a2', dest: 'a3', san: 'a3', promotion: null });
    const view = drillBoard(
      {
        key: START_KEY,
        last: undefined,
        playable: true,
        arrow: 'e2e4',
        flash: { square: 'a3', kind: 'wrong', after: { key: after, uci: 'a2a3' } },
        revision: 1,
      },
      'white',
      legalMoves(START_KEY),
    );
    expect(view.fen).toBe(fenOf(after));
    expect(view.lastMove).toEqual(['a2', 'a3']);
    expect(view.autoShapes).toEqual([]);
    expect(view.dests.size).toBe(0);
  });
```

`review-drill-state.test.ts`:

```ts
  it('holds a wrong move for the flash and takes no move meanwhile (#381)', () => {
    const start = drill(10);
    const wrong = play(start, 'wrong');
    expect(wrong.flash?.after?.key).not.toBe(shownKey(start));
    expect(canType(wrong)).toBe(false);
    const unflashed = { ...wrong, flash: null };
    expect(canType(unflashed)).toBe(true);
    expect(positionOf(unflashed).arrow).toBeDefined();
  });
```

(Import `canType`, `positionOf`, `shownKey` if the file does not.) Add the same for the learn state: after a wrong `afterPlay`, `flash.after` is set and `canType` is false.

Run — FAIL.

- [ ] **Step 2: Implement**

`tokens.css`: `--duration-feedback: 700ms; /* correct/wrong flash and the wrong move's hold */`.

`drill-input.ts`:

```ts
/** The `duration-feedback` token (tokens.css): an answer's flash, and a wrong move's hold. */
export const FEEDBACK_MS = 700;

/** A square's answer flash (docs/design/training-screen.md, Move feedback). */
export interface Flash {
  readonly square: string;
  readonly kind: 'correct' | 'wrong';
  /** A wrong move, held on the board while its flash shows (#381). */
  readonly after?: { readonly key: string; readonly uci: string };
}

/** Is a wrong move held on the board now? No move is taken meanwhile. */
export const holdsWrong = (flash: Flash | null): boolean =>
  flash?.kind === 'wrong' && flash.after !== undefined;

/** The flash of the player's `move` from `key`: a wrong one holds its position. */
export function answerFlash(key: string, move: BoardMove, right: boolean): Flash {
  if (right) return { square: move.dest, kind: 'correct' };
  const uci = `${move.orig}${move.dest}${move.promotion ?? ''}`;
  return { square: move.dest, kind: 'wrong', after: { key: positionAfterMove(key, move), uci } };
}
```

(import `positionAfterMove` from `@mychess/chess`.)

`drill-board.ts` `drillBoard`:

```ts
/** `p` as the board shows it: a held wrong move in place of the asked position. */
function shownPosition(p: DrillPosition): DrillPosition {
  const held = p.flash?.kind === 'wrong' ? p.flash.after : undefined;
  if (held === undefined) return p;
  return { ...p, key: held.key, last: held.uci, playable: false, arrow: undefined, hint: undefined };
}
```

and `drillBoard` starts with `const shown = shownPosition(p);` and reads `shown` everywhere it read `p` (the `legal` passed in is the asked position's; with `playable` false no dests are drawn).

`review-drill-state.ts` `afterAnswer`: `flash: answerFlash(shownKey(s), move, right),`; `canType`:

```ts
export const canType = (s: DrillState): boolean =>
  !isDone(s) && s.session.phase !== 'correct' && !holdsWrong(s.flash);
```

`learn-drill-state.ts` `afterPlay`: `flash: answerFlash(shownKey(s), move, correct),`; `canType`:

```ts
export const canType = (s: LearnDrillState): boolean =>
  !holdsWrong(s.flash) && canPlay(answering(s));
```

The existing unflash timer (`useUnflash`, `FEEDBACK_MS`) ends the hold: the flash clears, the board returns to the asked position and the arrow shows (R-59).

- [ ] **Step 3: Run**: `pnpm --filter @mychess/web exec vitest run src/app/training/` — PASS. Tests that advance fake timers by 400 use `FEEDBACK_MS`; any literal `400` left in a training test becomes `FEEDBACK_MS`.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app
git commit -m "feat(web): feedback holds 700ms; a wrong move stays on the board for its flash (#381)"
```

---

### Task 10: Done reads as an ending, with one next step (web, web-dev)

**Files:**
- Modify: `apps/web/src/app/training/done-summary.tsx`, `en.json`
- Test: `done-summary.test.tsx`; E2E: any `stat(page, en.training.done.correct)` (none today; check with grep)

- [ ] **Step 1: Failing tests** (`done-summary.test.tsx`)

```tsx
describe('primaryAction', () => {
  it('picks the first next step that applies', () => {
    const go = (): void => undefined;
    expect(primaryAction({ onContinue: go, reviewHref: '/r', learnHref: '/l' })).toBe('continue');
    expect(primaryAction({ reviewHref: '/r', learnHref: '/l' })).toBe('review');
    expect(primaryAction({ learnHref: '/l' })).toBe('learn');
    expect(primaryAction({})).toBe('done');
  });
});
```

Replace `'puts Done first and new moves last, Continue between them'` with:

```tsx
  it('puts the one next step first and Done last, quiet beside it', () => {
    renderActions({ onContinue: vi.fn(), learnHref: '/l', doneHref: '/' });
    const names = screen.getAllByRole(/button|link/).map((e) => e.textContent);
    expect(names).toEqual([T.done.continue, T.done.learn, T.done.done]);
    expect(screen.getByRole('button', { name: T.done.continue }).className).toContain('bg-accent');
    expect(screen.getByRole('link', { name: T.done.done }).className).toContain('text-fg-muted');
  });
  it('makes Done the main button when nothing else is offered', () => {
    renderActions({ doneHref: '/' });
    expect(screen.getByRole('link', { name: T.done.done }).className).toContain('bg-accent');
  });
```

and add:

```tsx
  it('does not call a learn pass the end of today’s review', () => {
    // render DoneSummary with counts { kind: 'learn', learned: 3 } and a dayDone standing
    expect(screen.queryByText(T.done.dayDone)).toBeNull();
  });
  it('counts a review’s first-try answers', () => {
    // render DoneSummary with review counts
    expect(screen.getByText(T.done.firstTry)).toBeInTheDocument();
  });
```

(Use the file's existing render helpers; `renderActions` is whatever helper the current action tests use.)

Run — FAIL.

- [ ] **Step 2: Implement** (`done-summary.tsx`)

```ts
/** The Done state's next steps, the first that applies taking the main button. */
export type DoneStep = 'continue' | 'review' | 'learn' | 'done';

export function primaryAction(
  p: Pick<DoneActionsProps, 'onContinue' | 'learnHref' | 'reviewHref'>,
): DoneStep {
  if (p.onContinue !== undefined) return 'continue';
  if (p.reviewHref !== undefined) return 'review';
  if (p.learnHref !== undefined) return 'learn';
  return 'done';
}
```

`DoneActions` renders the offered steps in the order continue, review, learn, then Done; the primary uses `${PRIMARY_BUTTON} grow basis-full lg:basis-auto`, other steps `${TONAL_BUTTON} grow`, Done `QUIET_ACTION` unless it is the primary. Keep each step's element (`button` for Continue, `Link` for the rest). Split into a small `stepClass(step, primary)` helper to keep complexity low.

`DayLine` takes `kind: SessionCounts['kind']`; the `dayDone` paragraph renders only when `kind === 'review'`. `Standing` and `DoneSummary` pass `counts.kind` through.

`DoneSummary`'s `section` becomes a card: `className={\`${CARD} flex flex-col gap-6 p-6\`}` (import `CARD` from `../surfaces`), with a first child:

```tsx
      <span aria-hidden="true" className="mx-auto flex size-12 items-center justify-center rounded-full bg-success-subtle text-success">
        <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12l5 5 9-10" />
        </svg>
      </span>
```

The review stat label key `correct` becomes `firstTry`. Catalogue: `training.done.correct` is replaced by `"firstTry": "first try"`.

- [ ] **Step 3: Run, commit**

Run: `pnpm --filter @mychess/web exec vitest run src/app/training/` — PASS. `grep -rn "done.correct" apps/web` finds nothing.

```bash
git add apps/web
git commit -m "feat(web): Done as a card with one next step; first-try count; learn Done without review wording (#381)"
```

---

### Task 11: Nothing due as Today's hero; plain cards for the other empty states and the error (web, web-dev)

**Files:**
- Modify: `apps/web/src/app/training/empty-panel.tsx`, `training-frame.tsx`, `error.tsx`
- Test: the empty-panel tests in `training-screen.test.tsx`

- [ ] **Step 1: Failing test** (in `training-screen.test.tsx`, beside the nothing-due test)

```tsx
  it('shows nothing due as an accent card with the learn button inverted', () => {
    // render the nothing-due state as the existing test does
    const heading = screen.getByRole('heading', { name: T.empty.nothingDue.title });
    expect(heading.closest('section')?.className).toContain('bg-accent');
    expect(screen.getByRole('link', { name: /Learn/ }).className).toContain('bg-surface');
  });
```

Run — FAIL.

- [ ] **Step 2: Implement** (`empty-panel.tsx`)

`Empty` takes `tone: 'hero' | 'plain' = 'plain'`:

```tsx
const EMPTY_CLASS = {
  hero: 'flex flex-col gap-3 rounded-card bg-accent p-5 text-accent-fg shadow-card',
  plain: `${CARD} flex flex-col gap-3 p-5`,
} as const;
```

The section uses `EMPTY_CLASS[tone]` (the `lg:border-t` divider goes); the heading is `text-xl font-semibold`. `NothingDue` passes `tone="hero"`; its next-review line is `text-accent-fg` (not muted) and its learn link `${HERO_PRIMARY_BUTTON} self-start`. The other states stay `plain` with their buttons as they are.

`training-frame.tsx` `boardClass`: an empty state's still board (`!live && !finished`) shows as a strip on a phone:

```ts
const boardClass = (live: boolean, finished: boolean): string => {
  if (live) return FRAME_BOARD;
  const still = finished ? 'max-lg:hidden' : 'max-lg:aspect-[5/2] max-lg:overflow-hidden';
  return `${FRAME_BOARD} opacity-60 ${still}`;
};
```

`error.tsx`: wrap the panel's two children (the message row and the buttons) in `<div className={\`${CARD} flex flex-col gap-3 p-5\`}>`.

- [ ] **Step 3: Run, commit**

Run the training tests — PASS.

```bash
git add apps/web/src/app/training
git commit -m "feat(web): nothing due as Today's hero card; the still board a strip on a phone; plain cards for the rest (#381)"
```

---

### Task 12: E2E for the counter and the phone, then the design note (qa, then lead)

**Files:**
- Modify: `apps/web/e2e/training-review.spec.ts`, `docs/design/training-screen.md`, `docs/superpowers/specs/2026-11-25-training-screen-design.md` (only if the build departed from it)

- [ ] **Step 1: The counter stays fixed across a hint** (`training-review.spec.ts`, the R-61 part):

```ts
  await answer(drill);
  // R-223: the hinted move is owed its repeat, so it is not finished yet,
  // and the session still holds 20 moves.
  expect(await counter(page)).toEqual({ done: 0, total: 20 });
```

- [ ] **Step 2: Run the training E2E on both projects**

Run: `pnpm --filter @mychess/web exec playwright test e2e/training-*.spec.ts e2e/home.spec.ts e2e/today.spec.ts e2e/shell.spec.ts`
Expected: PASS on desktop and Pixel 7 (`@mobile`). Fix helpers, not assertions, where only the DOM moved.

- [ ] **Step 3: The design note** `docs/design/training-screen.md`: update the phone and desktop sketches (title and context line, "3 / 9", 6px track, Hint and Type tonal, End session quiet, the phone line from a move number), the Move feedback table (700ms, the wrong move held, pills, badge style D and its colours), Done (card, one primary, first try), Empty (hero card, strip), and the Keyboard section (the Type button, focus back to it after a move). Mention R-223 and R-224 in "Behaviour decided by the owner".

- [ ] **Step 4: Commit**

```bash
git add apps/web/e2e docs
git commit -m "test(e2e): the counter holds its total across a hint; docs(design): the training screen after #381"
```

- [ ] **Step 5: Gate and sign-off**: `node quality/gate.mjs check` (grep its log for PASSED), push, wait for CI green, then ux-designer signs off at 390x844, 375x667, 1280x800 and 1440x900 in light and dark: review waiting, correct, lapse (the wrong move held), hint, a coach note, Done (review and learn), nothing due, loading. Then `mp-code-review`, `improve-codebase-architecture`, and close part 3 on #381 with the commit range.
