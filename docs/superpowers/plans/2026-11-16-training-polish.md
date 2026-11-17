# Training polish (#330) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix every bullet of #330: a learn-arrows setting (R-205), learning one chapter or line (R-206), the per-repertoire backlog on home (R-207), separate preview and confirm import limits (R-208), pasted PGN (R-209), and the lead decisions 1-11 of the spec.

**Architecture:** Rules land in `packages/chess` (learn session option, learn plan focus, queued-learned catch-up, due per repertoire, the PGN player side) and `packages/domain` (the setting, the preview rate rule); `packages/db` stores the setting; `apps/web` only reads, wires and draws. Lower layers land first; web tasks run in waves that never touch the same file at once.

**Tech Stack:** TypeScript, zod 4, Drizzle (Postgres), Next.js 16 App Router, next-intl 4, Vitest, Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-16-training-polish-design.md`. Rulings R-53, R-54, R-59, R-62, R-66, R-119, R-142, R-144, R-146, R-147, R-148, R-174, R-180, R-205 to R-209 (`docs/owner-rulings.md`).

**Working tree:** other agents are editing `apps/web/src/app/repertuarai/repertoire-list.tsx` and the PGN export (#328) and `packages/chess/src/training/queue.ts` / `review-session.ts` (#338). Tasks here avoid those files except Task 16, which edits `repertoire-list.tsx` and must run after #328 lands. Tasks 1-5 add exports to `packages/chess/src/training/training.ts` and `packages/chess/src/index.ts`; if #338 also edits those barrels, rebase onto it before editing.

---

## Spec corrections

1. **Decision 1 (arrows off):** starting the learn session in the `blind` round is not enough. Each new move's learn state starts at `shown` (`startLearn`), and `blindNew` answers a right move on a `shown` state by asking it again, not by learning it, so every move would be asked twice. With `arrows: false` the session must also start each new key at `asked` (a new `askLearn` in `learn.ts`). A wrong blind answer then goes to `shown` with the arrow, as the spec says (Task 1).
2. **Decision 3 (naming a line):** the spec names a line by `<chapterId>:<moveKey of its last move>`. The repertoire page already names the current line by its index in `lines(graph, chapterId)` for "I know this" (`currentLineIndex`, the domain's `know-scope.ts` `lineIndex`). A last-move key is not unique (two lines that transpose into the same leaf share it) and puts a FEN in the URL. This plan uses `&chapter=<chapterId>&line=<lineIndex>`, the same index "I know this" uses. `LearnFocus` is `{ repertoireId, chapterId, lineIndex? }`.
3. **Decision 6 (time zone):** there is no per-account time zone (`apps/web/src/lib/time-zone.ts`: "there is no per-account time zone yet"). Dates use `DISPLAY_TIME_ZONE` (Europe/Vilnius), as today.
4. **Decision 6 (next-intl `formats`):** named next-intl formats would have to be passed to every `NextIntlClientProvider` in the component tests (dozens of files render one with only `locale` and `messages`), or each test using a time would throw on a missing format. The one shared config is a module of option objects, `apps/web/src/lib/date-format.ts`, imported by `review-time.ts` and `repertoire-list.tsx` (the two call sites that show a clock time). Same single source, no provider plumbing.
5. **Decision 9 (where the limit lives):** `IMPORT_RATE_LIMIT` is defined in `packages/domain/src/rate-limit.ts`, not in `packages/db/src/rate-limits.ts`; the db file only lists each rule's window for counter retention. `IMPORT_PREVIEW_RATE_LIMIT` and `importPreviewRateKey` go in the domain file (Task 6); the db file adds its window to `REQUEST_COUNTER_RETENTION_MS` (Task 7). The "31st preview refused, previews do not use the confirm allowance" round trip is the web feature test against the real database (`apps/web/test/feature/repertoire-import.test.ts`, Task 17), where the existing R-119 round trip already lives.
6. **Decision 10 (server reads paste and file):** the browser already reads the file and posts its text; the server's `previewRequestSchema`/`confirmRequestSchema` take `text` either way. Pasted text goes through the same field, schema and limits with no server change. "Exactly one of the two" is kept in the browser: choosing a file clears the pasted text and typing clears the file (Task 18).
7. **Decision 2 (cause):** see Task 3 and Task 10. The chess learn plan already treats every tracked key as known, including keys tracked through another repertoire (`learn-plan.test.ts` "treats tracked keys as known"), and the snapshot's tracked set is every held Review across all training repertoires (`packages/db/src/training/snapshot.ts`). The cause found in the code is that the training page's snapshot is read from the database while the browser may still hold `learned` results it has not posted (in flight, or left by a failed post; `use-result-sync.ts` flushes only after the page has rendered). The new page plans from the snapshot alone, so those moves are taught again with arrows. Second hypothesis, to be ruled out by qa on the persona stack (Task 19): the 2000+ tester's Black repertoire imported as White (decision 8's default), whose line then teaches the White moves of a line he had just reviewed as Black.

## Lead answers (2026-11-16)

1. **R-148 and the two-answers wording (decision 4).** Keep R-148's Lithuanian lead-in "Kituose jūsų repertuaruose čia žaidžiamas kitas ėjimas:" in the new sentence; the English is decision 4's. Confirmed.
2. **R-54 and the mixed header (decision 5).** A mixed session is titled "Several repertoires" with the current item's repertoire name as a subtitle, so R-54 still holds. Confirmed.
4. **Learn on the current line (Task 13, added 2026-11-17).** The line's Learn button uses its own key `training.repertoire.learnLine` ("Learn # new moves in this line"); `training.repertoire.learnIn` with `{subject}` is for chapter rows only.
3. **Coach notes with arrows off (R-174, R-205).** Overruled: with arrows off a blind learn ask is treated like a review ask, so the coach note and the two-answers notice show once the move is answered, right or wrong (as in review, R-174), and also when a wrong answer brings the arrow. A player who answers right must still see the note. Tasks 11 and 14 implement this.

---

## File map

| File | Task | Change |
| --- | --- | --- |
| `packages/chess/src/training/learn.ts` | 1 | `askLearn` |
| `packages/chess/src/training/learn-session.ts` (+test) | 1 | `startLearnSession(line, { arrows })` |
| `packages/chess/src/training/learn-plan.ts` (+test) | 2 | `LearnFocus`, `learnPlan(..., focus?)` |
| `packages/chess/src/training/training-day.ts` (+test) | 2, 3, 4 | `TrainingDay.focus`, `learnStart`, `withLearned`, `dueByRepertoire` |
| `packages/chess/src/pgn/player-side.ts` (+test) | 5 | `playerSide(text, names)` |
| `packages/chess/src/training/training.ts`, `packages/chess/src/index.ts` | 1-5 | exports |
| `packages/domain/src/training.ts` (+test) | 6 | `learnArrows` |
| `packages/domain/src/rate-limit.ts` (+test), `index.ts` | 6 | `IMPORT_PREVIEW_RATE_LIMIT`, `importPreviewRateKey` |
| `packages/db/src/schema/accounts.ts`, `migrations/0019_*.sql` | 7 | `learn_arrows` column |
| `packages/db/src/training/settings.ts`, `packages/db/src/rate-limits.ts` | 7 | read/write, retention |
| `packages/db/test/training-reads.test.ts`, `training-snapshot.test.ts` | 7 | round trip |
| `apps/web/src/i18n/messages/{en,lt}.json` | 8 | every new or changed text |
| `apps/web/src/app/nustatymai/{actions.ts,training-form.tsx}` (+tests) | 9 | arrows toggle |
| `apps/web` test fixtures holding `settings: {…}` | 9 | `learnArrows: true` |
| `apps/web/src/app/treniruote/{result-queue.ts,use-result-sync.ts,training-screen.tsx}`, `apps/web/src/lib/{training-data.ts,training-day.ts}` | 10 | queued learned moves |
| `apps/web/src/app/treniruote/{learn-drill-state.ts,use-learn-drill.ts,learn-drill.tsx}` (+test) | 11 | arrows option, `recall` prompt |
| `apps/web/src/server/training.ts`, `apps/web/src/app/treniruote/page.tsx`, `apps/web/src/lib/routes.ts` | 12 | `&chapter=`, `&line=` |
| `apps/web/src/lib/learn-budget.ts`, `apps/web/src/app/repertoire-view/{learn-link.tsx,train-buttons.tsx,chapter-row.tsx,chapter-list.tsx,know-section.tsx,repertoire-panel.tsx}`, both repertoire pages, `server/training.ts` | 13 | Learn links, daily limit notice |
| `apps/web/src/app/treniruote/{two-answers-notice.tsx,review-drill.tsx,learn-drill.tsx}` (+tests) | 14 | notice after the answer, in learn |
| `apps/web/src/app/today-block.tsx`, `server/training.ts`, `treniruote/{training-screen.tsx,training-frame.tsx}` | 15 | due per repertoire, mixed header |
| `apps/web/src/lib/date-format.ts` (+test), `treniruote/review-time.ts`, `repertuarai/repertoire-list.tsx` | 16 | 24-hour clock, year |
| `apps/web/src/server/import-preview.ts`, `apps/web/test/feature/repertoire-import.test.ts` | 17 | preview limit |
| `apps/web/src/app/repertuarai/importuoti/*`, `apps/web/src/server/provider-links.ts` | 18 | paste, side default |
| `apps/web/e2e/*` | 19 | journeys |

## Waves (who runs in parallel)

- **Wave A:** chess-dev Tasks 1 -> 2 -> 3 -> 4 -> 5 (one agent, in order: they share `training-day.ts` and the barrels); backend-dev Tasks 6 -> 7; i18n-content Task 8. Three agents, disjoint folders.
- **Wave B (after A):** web-dev Task 9 (the lead commits Tasks 6, 7 and 9 together: the new required `learnArrows` breaks the web typecheck until Task 9's fixtures land); web-dev Task 16 (after #328 has landed); web-dev Task 17.
- **Wave C:** Task 10 and Task 18.
- **Wave D:** Task 11 and Task 12.
- **Wave E:** Task 13 and Task 14.
- **Wave F:** Task 15.
- **Wave G:** qa Task 19.

Commands used throughout (from the repo root):

- chess: `pnpm --filter @mychess/chess test -- <file>`, `pnpm --filter @mychess/chess typecheck`
- domain: `pnpm --filter @mychess/domain test -- <file>`, `pnpm --filter @mychess/domain typecheck`
- db (needs Docker): `pnpm --filter @mychess/db test -- <file>`, `pnpm --filter @mychess/db typecheck`
- web: `pnpm --filter @mychess/web test:component -- <file>`, `pnpm --filter @mychess/web test:feature -- <file>` (Docker), `pnpm --filter @mychess/web typecheck`
- lint: `pnpm exec eslint --max-warnings=0 <files>`; format: `pnpm exec prettier --write <files>` (the edit hook also runs both)

---

### Task 1: The learn session without arrows (R-205, decision 1) - chess-dev

**Files:**
- Modify: `packages/chess/src/training/learn.ts`
- Modify: `packages/chess/src/training/learn-session.ts`
- Modify: `packages/chess/src/training/training.ts`, `packages/chess/src/index.ts` (export `LearnSessionOptions`)
- Test: `packages/chess/src/training/learn-session.test.ts`

- [ ] **Step 1: Write the failing tests** (append to `learn-session.test.ts`; `first`, `keyOf`, `stepOf`, `runRound`, `now` are the file's own helpers)

```ts
describe('learnSession without arrows (R-205)', () => {
  const noArrows = { arrows: false } as const;
  const newKeys = first.steps.filter((x) => x.kind === 'new').map((x) => x.key);

  it('starts in the blind round at the first step, no arrow, each new move asked', () => {
    const s = startLearnSession(first, noArrows);
    expect(s).toMatchObject({ round: 'blind', index: 0, arrow: false, done: false });
    expect(stepOf(s, 'e4')).toBe('asked');
  });
  it('learns a new move at its first right answer', () => {
    const t = playLearn(startLearnSession(first, noArrows), 'e4', now);
    expect(t.correct).toBe(true);
    expect(t.emit).toEqual({ kind: 'learned', key: keyOf(first, 'e4') });
    expect(t.state.index).toBe(1);
  });
  it('shows the arrow after a wrong answer; the arrow move then asks it blind again (R-59)', () => {
    const wrong = playLearn(startLearnSession(first, noArrows), 'd4', now);
    expect(wrong.correct).toBe(false);
    expect(wrong.state.arrow).toBe(true);
    expect(stepOf(wrong.state, 'e4')).toBe('shown');
    const seen = playLearn(wrong.state, 'e4', now);
    expect(seen.emit).toBeNull();
    expect(seen.state.arrow).toBe(false);
    expect(seen.state.index).toBe(0);
    const learned = playLearn(seen.state, 'e4', now);
    expect(learned.emit).toEqual({ kind: 'learned', key: keyOf(first, 'e4') });
  });
  it('ends after its one round, each new move learned once', () => {
    const { state, emits } = runRound(startLearnSession(first, noArrows));
    expect(state.done).toBe(true);
    expect(emits.map((e) => e.key)).toEqual(newKeys);
  });
  it('keeps the arrows round by default (R-144)', () => {
    expect(startLearnSession(first)).toEqual(
      startLearnSession(first, { arrows: true }),
    );
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @mychess/chess test -- src/training/learn-session.test.ts`
Expected: FAIL (the new cases: `round` is `'arrows'`, `stepOf` is `'shown'`).

- [ ] **Step 3: Implement**

In `learn.ts`, after `startLearn`:

```ts
/**
 * R-205: the pass without its arrow, asked blind first. A wrong answer goes
 * to `shown`, so the arrow appears as after a lapse (R-59).
 */
export const askLearn = (key: string): LearnState => ({ key, step: 'asked' });
```

In `learn-session.ts`, import `askLearn` beside `learnStep, startLearn`, update the module comment ("...played twice from its start; with the player's arrows setting off (R-205), once, blind"), and replace `startLearnSession`:

```ts
/** How the player learns (R-205). */
export interface LearnSessionOptions {
  /** False skips the arrows round: each new move is asked blind first. */
  readonly arrows: boolean;
}

const WITH_ARROWS: LearnSessionOptions = { arrows: true };

export function startLearnSession(
  line: LearnLine,
  options: LearnSessionOptions = WITH_ARROWS,
): LearnSessionState {
  const round: LearnRound = options.arrows ? 'arrows' : 'blind';
  const start = options.arrows ? startLearn : askLearn;
  const states = new Map<string, LearnState>();
  for (const step of line.steps) {
    if (step.kind === 'new') states.set(step.key, start(step.key));
  }
  return {
    line,
    round,
    index: 0,
    arrow: arrowAt(line, round, 0),
    states,
    done: line.steps.length === 0,
  };
}
```

`moveOn` already ends the session after the blind round. Add `LearnSessionOptions` to the `export type { ... } from './learn-session'` block in `training.ts` and the type list in `packages/chess/src/index.ts`.

- [ ] **Step 4: Run the tests and typecheck**

Run: `pnpm --filter @mychess/chess test -- src/training/learn-session.test.ts` then `pnpm --filter @mychess/chess typecheck`
Expected: PASS; no type errors.

- [ ] **Step 5: Lint**

Run: `pnpm exec eslint --max-warnings=0 packages/chess/src/training/learn.ts packages/chess/src/training/learn-session.ts packages/chess/src/training/learn-session.test.ts`
Expected: no output.

- [ ] **Step 6: Report to the lead**

---

### Task 2: Learn one chapter or one line (R-206, decisions 3 and 11) - chess-dev

**Files:**
- Modify: `packages/chess/src/training/learn-plan.ts`
- Modify: `packages/chess/src/training/training-day.ts`
- Modify: `packages/chess/src/training/training.ts`, `packages/chess/src/index.ts`
- Test: `packages/chess/src/training/learn-plan.test.ts`, `packages/chess/src/training/training-day.test.ts`

- [ ] **Step 1: Write the failing learn plan tests** (append to `learn-plan.test.ts`; `graph`, `rep`, `steps`, `keyOf`, `italian` are the file's helpers)

```ts
describe('learnPlan with a focus (R-206)', () => {
  const [one, two] = italian.chapters;
  const chapterOne = one?.id ?? '';
  const chapterTwo = two?.id ?? '';

  it('plans only the focused chapter, its shared moves new when untracked', () => {
    const plan = learnPlan([rep('r', italian)], new Set(), 10, {
      repertoireId: 'r',
      chapterId: chapterTwo,
    });
    expect(plan.map((l) => l.chapterId)).toEqual([chapterTwo]);
    expect(steps(plan[0])).toEqual([
      'new:e4',
      'opponent:e5',
      'new:Nf3',
      'opponent:Nc6',
      'new:Bc4',
      'opponent:Nf6',
      'new:d3',
    ]);
  });
  it('keeps the daily allowance (R-62)', () => {
    const plan = learnPlan([rep('r', italian)], new Set(), 2, {
      repertoireId: 'r',
      chapterId: chapterTwo,
    });
    expect(steps(plan[0])).toEqual(['new:e4', 'opponent:e5', 'new:Nf3']);
  });
  it('plans one line of a chapter, by its index in the chapter’s lines', () => {
    const g = graph('1. e4 e5 (1... c5 2. Nf3) 2. Nc3 *');
    const chapterId = g.chapters[0]?.id ?? '';
    const plan = learnPlan([rep('r', g)], new Set(), 10, {
      repertoireId: 'r',
      chapterId,
      lineIndex: 1,
    });
    expect(plan.map(steps)).toEqual([['new:e4', 'opponent:c5', 'new:Nf3']]);
  });
  it('plans nothing for a line, chapter or repertoire it does not hold', () => {
    const plan = (focus: Parameters<typeof learnPlan>[3]) =>
      learnPlan([rep('r', italian)], new Set(), 10, focus);
    expect(plan({ repertoireId: 'r', chapterId: chapterOne, lineIndex: 5 })).toEqual([]);
    expect(plan({ repertoireId: 'r', chapterId: 'nope' })).toEqual([]);
    expect(plan({ repertoireId: 'other', chapterId: chapterOne })).toEqual([]);
  });
  it('plans nothing in a paused repertoire, focused or not (R-46)', () => {
    expect(
      learnPlan([rep('r', italian, false)], new Set(), 10, {
        repertoireId: 'r',
        chapterId: chapterOne,
      }),
    ).toEqual([]);
  });
  it('treats moves tracked through another repertoire as known (R-53)', () => {
    const tracked = new Set([keyOf(italian, 'e4'), keyOf(italian, 'Nf3')]);
    const plan = learnPlan([rep('r', italian)], tracked, 10, {
      repertoireId: 'r',
      chapterId: chapterTwo,
    });
    expect(steps(plan[0])?.slice(0, 3)).toEqual([
      'known:e4',
      'opponent:e5',
      'known:Nf3',
    ]);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @mychess/chess test -- src/training/learn-plan.test.ts`
Expected: FAIL (`learnPlan` ignores the fourth argument: every chapter is planned).

- [ ] **Step 3: Implement the focus in `learn-plan.ts`**

Import `lines` from `'../repertoire/walk'` beside `chapterWalks`. Add after the `Candidate` interface, and replace `candidateLines` and `learnPlan`:

```ts
/**
 * One chapter, or one line of it, to learn instead of the learn order
 * (R-206). `lineIndex` is the line's index in `lines(graph, chapterId)`,
 * as the repertoire page names a line for "I know this" (R-58).
 */
export interface LearnFocus {
  readonly repertoireId: string;
  readonly chapterId: string;
  readonly lineIndex?: number;
}

/** Is `chapter` of `repertoire` one the focus allows? Any, without one. */
const inFocus = (
  repertoire: TrainingRepertoire,
  chapter: Chapter,
  focus: LearnFocus | undefined,
): boolean =>
  focus === undefined ||
  (repertoire.id === focus.repertoireId && chapter.id === focus.chapterId);

/** The chapter's candidate paths: its walk's paths, or the one focused line. */
function pathsOf(
  repertoire: TrainingRepertoire,
  chapter: Chapter,
  focus: LearnFocus | undefined,
): readonly (readonly RepertoireMove[])[] {
  const index = focus?.lineIndex;
  if (index === undefined)
    return chapterWalks(repertoire.graph)(chapter.id).paths();
  const line = lines(repertoire.graph, chapter.id)[index];
  return line === undefined ? [] : [line];
}

function* candidateLines(
  repertoires: readonly TrainingRepertoire[],
  focus: LearnFocus | undefined,
): Generator<Candidate> {
  for (const repertoire of repertoires.filter((r) => r.active)) {
    for (const chapter of repertoire.graph.chapters) {
      if (!inFocus(repertoire, chapter, focus)) continue;
      for (const path of pathsOf(repertoire, chapter, focus))
        yield { repertoire, chapter, path };
    }
  }
}

/**
 * The lines to learn, at most `limit` new moves in all, over the active
 * repertoires in the given order, or only the `focus` chapter or line
 * (R-206). Keys in `tracked` are never planned again.
 */
export function learnPlan(
  repertoires: readonly TrainingRepertoire[],
  tracked: ReadonlySet<string>,
  limit: number,
  focus?: LearnFocus,
): LearnLine[] {
  const planner: Planner = { planned: new Set(tracked), left: limit };
  const plan: LearnLine[] = [];
  for (const { repertoire, chapter, path } of candidateLines(
    repertoires,
    focus,
  )) {
    if (planner.left <= 0) break;
    const steps = planPath(repertoire.graph, path, planner);
    if (steps.length > 0)
      plan.push({
        repertoireId: repertoire.id,
        chapterId: chapter.id,
        rootKey: chapter.rootKey,
        steps,
      });
  }
  return plan;
}
```

`chapterWalks(graph)` was hoisted once per repertoire before; `pathsOf` calls it per chapter, which builds the same per-chapter walk (`chapterWalks` returns a function of the chapter id). If the CRAP or performance check complains, pass the repertoire's `walks` into `pathsOf` instead.

- [ ] **Step 4: Run the learn plan tests**

Run: `pnpm --filter @mychess/chess test -- src/training/learn-plan.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing training day tests** (append to `training-day.test.ts`; `day`, `repertoire`, `white`, `E4`, `NF3`, `BC4`, `C3`, `NOW` are the file's helpers; add `learnStart` to the import list)

```ts
describe('a focused training day (R-206)', () => {
  const chapterId = white.chapters[0]?.id ?? '';
  const focus = { repertoireId: 'r1', chapterId };
  const other = graph('1. d4 d5 2. c4 *', 'white');

  it('teaches only the focus, within the allowance', () => {
    const focused = day({
      repertoires: [repertoire(other, 'r0'), repertoire(white)],
      focus,
      limits: { reviews: 20, newPerDay: 3 },
    });
    expect(learnLines(focused).map((l) => l.repertoireId)).toEqual(['r1']);
    expect(newKeys(learnLines(focused))).toEqual([E4, NF3, BC4]);
    expect(toLearnCount(focused)).toBe(3);
  });
  it('has nothing left when the focus is learned, whatever else is not', () => {
    const focused = day({
      repertoires: [repertoire(other, 'r0'), repertoire(white)],
      tracked: new Set([E4, NF3, BC4, C3]),
      focus,
    });
    expect(learnStart(focused)).toEqual({ kind: 'nothingLeft' });
    expect(startState(focused, 'learn', NOW)).toEqual({ kind: 'nothingLeft' });
  });
});

describe('learnStart (decision 11)', () => {
  it('says the limit is reached while moves are left but the allowance is used', () => {
    expect(learnStart(day({ learnedToday: 10 }))).toEqual({ kind: 'limitReached' });
    expect(learnStart(day())).toEqual({ kind: 'drill' });
    expect(
      learnStart(day({ tracked: new Set([E4, NF3, BC4, C3]), learnedToday: 10 })),
    ).toEqual({ kind: 'nothingLeft' });
  });
});
```

- [ ] **Step 6: Run them to see them fail**

Run: `pnpm --filter @mychess/chess test -- src/training/training-day.test.ts`
Expected: FAIL (`learnStart` is not exported; `focus` is not a `TrainingDay` field).

- [ ] **Step 7: Implement in `training-day.ts`**

Import `type LearnFocus` from `'./learn-plan'`. Add to `TrainingDay`:

```ts
  /** One chapter or line to learn instead of the learn order (R-206). */
  readonly focus?: LearnFocus;
```

Replace `learnLines` and `learnStart`:

```ts
/**
 * The lines a learn session teaches (R-144, R-145), in the repertoires'
 * learn order or only the day's focus (R-206), up to what is left of
 * today's allowance.
 */
export const learnLines = (day: Omit<TrainingDay, 'reviews'>): LearnLine[] =>
  learnPlan(day.repertoires, day.tracked, allowance(day), day.focus);

/** Are any moves left to learn: in the focus, or held by the active repertoires? */
function movesLeft(day: Omit<TrainingDay, 'reviews'>): boolean {
  if (day.focus !== undefined)
    return (
      learnPlan(
        day.repertoires,
        day.tracked,
        Number.POSITIVE_INFINITY,
        day.focus,
      ).length > 0
    );
  return heldMoveKeys(day.repertoires).some((key) => !day.tracked.has(key));
}

/**
 * Where learning stands (decision 11): moves left and allowed, moves left
 * but today's allowance used, or nothing left.
 */
export function learnStart(day: Omit<TrainingDay, 'reviews'>): StartState {
  if (!movesLeft(day)) return { kind: 'nothingLeft' };
  return allowance(day) === 0 ? { kind: 'limitReached' } : { kind: 'drill' };
}
```

Export `learnStart` from `training.ts` (the training-day block) and `packages/chess/src/index.ts`; export `type LearnFocus` from both (the learn-plan type block).

- [ ] **Step 8: Run the tests and typecheck**

Run: `pnpm --filter @mychess/chess test -- src/training` then `pnpm --filter @mychess/chess typecheck`
Expected: PASS.

- [ ] **Step 9: Lint**

Run: `pnpm exec eslint --max-warnings=0 packages/chess/src/training packages/chess/src/index.ts`

- [ ] **Step 10: Report to the lead**

---

### Task 3: Moves learned in the browser are not taught again (decision 2) - chess-dev

Hypothesis (see Spec corrections 7): the learn plan itself is right; the training page plans from a snapshot that misses `learned` results the browser still holds. Chess gets the rule that catches a day up with such moves; Task 10 wires it.

**Files:**
- Modify: `packages/chess/src/training/training-day.ts`
- Modify: `packages/chess/src/training/training.ts`, `packages/chess/src/index.ts`
- Test: `packages/chess/src/training/training-day.test.ts`, `packages/chess/src/training/learn-plan.test.ts`

- [ ] **Step 1: Write the characterization test** (append to the `learnPlan` describe in `learn-plan.test.ts`; it is expected to PASS and pins that the plan is not the cause)

```ts
  it('treats a key reviewed through another repertoire as known (R-53, decision 2)', () => {
    const london = graph('1. e4 e5 2. Nf3 Nf6 3. d3 *');
    const reviewed = new Set([keyOf(italian, 'e4'), keyOf(italian, 'Nf3')]);
    const [first] = learnPlan([rep('l', london), rep('r', italian)], reviewed, 10);
    expect(steps(first)).toEqual([
      'known:e4',
      'opponent:e5',
      'known:Nf3',
      'opponent:Nf6',
      'new:d3',
    ]);
  });
```

- [ ] **Step 2: Run it**

Run: `pnpm --filter @mychess/chess test -- src/training/learn-plan.test.ts`
Expected: PASS. If it fails, stop: the cause is in the learn plan after all; report to the lead with the failure before going on.

- [ ] **Step 3: Write the failing reproduction** (append to `training-day.test.ts`; add `withLearned` to the import list)

```ts
describe('withLearned (decision 2)', () => {
  /** Midnight in Vilnius on 25 October 2026 (UTC+3 until 04:00 local). */
  const DAY_START = new Date('2026-10-24T21:00:00Z');

  it('a move learned in the browser is tracked, so no learn plan teaches it again', () => {
    expect(newKeys(learnLines(day()))).toContain(E4);
    const caught = withLearned(day(), [{ key: E4, at: NOW }], DAY_START);
    expect(caught.tracked.has(E4)).toBe(true);
    expect(caught.reviews.get(E4)).toEqual(startReview(E4, NOW));
    expect(newKeys(learnLines(caught))).not.toContain(E4);
  });
  it('counts toward today’s allowance only when learned today', () => {
    expect(
      withLearned(day(), [{ key: E4, at: NOW }], DAY_START).learnedToday,
    ).toBe(1);
    const yesterday = new Date(DAY_START.getTime() - 1);
    expect(
      withLearned(day(), [{ key: E4, at: yesterday }], DAY_START).learnedToday,
    ).toBe(0);
  });
  it('leaves a move the snapshot already tracks, and takes a key once', () => {
    const known = day({
      reviews: new Map([[E4, startReview(E4, NOW)]]),
      tracked: new Set([E4]),
      learnedToday: 1,
    });
    expect(withLearned(known, [{ key: E4, at: NOW }], DAY_START)).toBe(known);
    const twice = withLearned(
      day(),
      [
        { key: NF3, at: NOW },
        { key: NF3, at: new Date(NOW.getTime() + 1000) },
      ],
      DAY_START,
    );
    expect(twice.learnedToday).toBe(1);
    expect(twice.reviews.get(NF3)).toEqual(startReview(NF3, NOW));
  });
});
```

- [ ] **Step 4: Run it to see it fail**

Run: `pnpm --filter @mychess/chess test -- src/training/training-day.test.ts`
Expected: FAIL with "withLearned is not a function" (or an import error).

- [ ] **Step 5: Implement in `training-day.ts`**

Import `startReview` from `'./schedule'` beside `isDue`. Add:

```ts
/** A move learned in the browser whose result the snapshot may not hold yet. */
export interface LearnedMove {
  readonly key: string;
  /** When it was learned: its Review starts then. */
  readonly at: Date;
}

/** `learned` without the keys `tracked` holds, each key once, first kept. */
function untracked(
  learned: readonly LearnedMove[],
  tracked: ReadonlySet<string>,
): LearnedMove[] {
  const byKey = new Map<string, LearnedMove>();
  for (const move of learned) {
    if (!tracked.has(move.key) && !byKey.has(move.key))
      byKey.set(move.key, move);
  }
  return [...byKey.values()];
}

/**
 * `day` caught up with moves learned since its snapshot was read (decision
 * 2): each is tracked, its Review started when it was learned, and it
 * counts toward today's allowance when learned at or after `dayStart`
 * (R-146). A move the snapshot already tracks changes nothing; with none
 * left, `day` itself is returned.
 */
export function withLearned(
  day: TrainingDay,
  learned: readonly LearnedMove[],
  dayStart: Date,
): TrainingDay {
  const fresh = untracked(learned, day.tracked);
  if (fresh.length === 0) return day;
  const reviews = new Map(day.reviews);
  for (const { key, at } of fresh) reviews.set(key, startReview(key, at));
  const today = fresh.filter((m) => m.at.getTime() >= dayStart.getTime());
  return {
    ...day,
    reviews,
    tracked: new Set([...day.tracked, ...fresh.map((m) => m.key)]),
    learnedToday: day.learnedToday + today.length,
  };
}
```

Export `withLearned` and `type LearnedMove` from `training.ts` and `packages/chess/src/index.ts`. Update the `training.ts` module comment's training-day sentence to mention "and catches a day up with moves learned in the browser (`withLearned`)".

- [ ] **Step 6: Run the tests and typecheck**

Run: `pnpm --filter @mychess/chess test -- src/training/training-day.test.ts` then `pnpm --filter @mychess/chess typecheck`
Expected: PASS.

- [ ] **Step 7: Lint**

Run: `pnpm exec eslint --max-warnings=0 packages/chess/src/training packages/chess/src/index.ts`

- [ ] **Step 8: Report to the lead** (say whether Step 2 passed: it confirms the plan is not the cause)

---

### Task 4: Due moves per repertoire (R-207, decision 5) - chess-dev

**Files:**
- Modify: `packages/chess/src/training/training-day.ts`
- Modify: `packages/chess/src/training/training.ts`, `packages/chess/src/index.ts`
- Test: `packages/chess/src/training/training-day.test.ts`

- [ ] **Step 1: Write the failing tests** (append; add `dueByRepertoire` to the imports; `black`, `BLACK_KEYS`, `transposing`, `transposed`, `NC3`, `DAY_MS` are the file's)

```ts
describe('dueByRepertoire (R-207)', () => {
  /** A Review learned `days` before NOW: due since a day after that. */
  const learnedAgo = (key: string, days: number): ReviewState =>
    startReview(key, new Date(NOW.getTime() - days * DAY_MS));
  const [C6 = '', D5 = ''] = BLACK_KEYS;

  it('lists each repertoire with due moves, its own count, the most urgent first', () => {
    const d = day({
      repertoires: [repertoire(white, 'w'), repertoire(black, 'b')],
      reviews: new Map([
        [E4, learnedAgo(E4, 2)],
        [C6, learnedAgo(C6, 3)],
        [D5, learnedAgo(D5, 2)],
      ]),
    });
    expect(dueByRepertoire(d, NOW)).toEqual([
      { repertoireId: 'b', due: 2 },
      { repertoireId: 'w', due: 1 },
    ]);
  });
  it('counts a shared move in each repertoire that holds it, as each one’s review asks it', () => {
    const d = day({
      repertoires: [repertoire(transposing, 'a'), repertoire(transposed, 'b')],
      reviews: new Map([[NC3, learnedAgo(NC3, 2)]]),
    });
    expect(dueByRepertoire(d, NOW)).toEqual([
      { repertoireId: 'a', due: 1 },
      { repertoireId: 'b', due: 1 },
    ]);
  });
  it('leaves out paused repertoires and those with nothing due', () => {
    const d = day({
      repertoires: [repertoire(white, 'w', false), repertoire(black, 'b')],
      reviews: new Map([
        [E4, learnedAgo(E4, 2)],
        [C6, learnedAgo(C6, 0)],
      ]),
    });
    expect(dueByRepertoire(d, NOW)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @mychess/chess test -- src/training/training-day.test.ts`
Expected: FAIL (`dueByRepertoire` is not exported).

- [ ] **Step 3: Implement in `training-day.ts`** (after `nextDue`)

```ts
/** One repertoire's Reviews due now, as home lists them (R-207). */
export interface RepertoireDue {
  readonly repertoireId: string;
  /** What a review of it alone asks before its session cap: shared moves count in each. */
  readonly due: number;
}

/**
 * The active repertoires with Reviews due at `now`, each counted as a
 * review of it alone counts them (R-142, R-207), the most urgent first: by
 * its earliest due Review, as the session orders them, then learn order.
 */
export function dueByRepertoire(day: Held, now: Date): RepertoireDue[] {
  return day.repertoires
    .map((repertoire, order) => {
      const due = heldReviews({
        repertoires: [repertoire],
        reviews: day.reviews,
      }).filter((r) => isDue(r, now));
      const first = Math.min(...due.map((r) => r.fsrs.due.getTime()));
      return { repertoireId: repertoire.id, due: due.length, first, order };
    })
    .filter((r) => r.due > 0)
    .sort((a, b) => a.first - b.first || a.order - b.order)
    .map(({ repertoireId, due }) => ({ repertoireId, due }));
}
```

Export `dueByRepertoire` and `type RepertoireDue` from `training.ts` and `packages/chess/src/index.ts`.

- [ ] **Step 4: Run the tests and typecheck**

Run: `pnpm --filter @mychess/chess test -- src/training/training-day.test.ts` then `pnpm --filter @mychess/chess typecheck`
Expected: PASS.

- [ ] **Step 5: Lint** `pnpm exec eslint --max-warnings=0 packages/chess/src/training packages/chess/src/index.ts`

- [ ] **Step 6: Report to the lead**

---

### Task 5: The side a PGN's players name (decision 8) - chess-dev

**Files:**
- Create: `packages/chess/src/pgn/player-side.ts`
- Create: `packages/chess/src/pgn/player-side.test.ts`
- Modify: `packages/chess/src/index.ts` (export `playerSide`)

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { playerSide } from './player-side';

const game = (white: string, black: string, moves = '1. e4 c5 *') =>
  `[White "${white}"]\n[Black "${black}"]\n\n${moves}\n`;

describe('playerSide (decision 8)', () => {
  it('gives the colour every game names the player in', () => {
    const text = game('Someone', 'Dovydas Jankauskas') + game('Other', 'Dovydas Jankauskas');
    expect(playerSide(text, ['Dovydas Jankauskas'])).toBe('black');
    expect(playerSide(game('Dovydas Jankauskas', 'X'), ['Dovydas Jankauskas'])).toBe('white');
  });
  it('matches a Lichess username without case or surrounding spaces', () => {
    expect(playerSide(game('X', ' DovydasJ '), ['Dovydas', 'dovydasj'])).toBe('black');
  });
  it('gives null when the games disagree, a game names neither side, or both', () => {
    const name = ['Rokas'];
    expect(playerSide(game('Rokas', 'X') + game('X', 'Rokas'), name)).toBeNull();
    expect(playerSide(game('Rokas', 'X') + game('A', 'B'), name)).toBeNull();
    expect(playerSide(game('Rokas', 'Rokas'), name)).toBeNull();
  });
  it('gives null with no names, no games, or text it cannot read', () => {
    expect(playerSide(game('Rokas', 'X'), [])).toBeNull();
    expect(playerSide(game('Rokas', 'X'), ['  '])).toBeNull();
    expect(playerSide('', ['Rokas'])).toBeNull();
    expect(playerSide('[White "Rokas"', ['Rokas'])).toBeNull();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @mychess/chess test -- src/pgn/player-side.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `player-side.ts`**

```ts
/**
 * The side a PGN file is a repertoire for, read from its players (#330
 * decision 8): the importing account's names in the [White] or [Black]
 * header. The import page uses it as the side's default only; the player
 * still chooses.
 */
import type { Side } from '../repertoire/graph';
import { splitGames, type PgnHeaders } from './split-games';
import { tokenize } from './tokenize';

/** A name as compared: trimmed, without case. */
const fold = (name: string): string => name.trim().toLocaleLowerCase();

/** The colour one game names the player in; null for neither or both. */
function sideIn(headers: PgnHeaders, names: ReadonlySet<string>): Side | null {
  const white = names.has(fold(headers['White'] ?? ''));
  const black = names.has(fold(headers['Black'] ?? ''));
  if (white === black) return null;
  return white ? 'white' : 'black';
}

/**
 * The colour every game of `text` names one of `names` in, compared without
 * case or surrounding spaces; null when a game names none of them or both
 * sides, the games disagree, there are none, or the text cannot be read.
 */
export function playerSide(text: string, names: readonly string[]): Side | null {
  const wanted = new Set(names.map(fold).filter((n) => n !== ''));
  if (wanted.size === 0) return null;
  const tokens = tokenize(text);
  if (!tokens.ok) return null;
  const sides = new Set(
    splitGames(tokens.value).map((g) => sideIn(g.headers, wanted)),
  );
  const [only = null] = sides;
  return sides.size === 1 ? only : null;
}
```

If `tokenize` accepts the unterminated tag of the last case without a refusal, the split yields a game with no `White` header and the result is still null; keep the case. Add `export { playerSide } from './pgn/player-side';` to `packages/chess/src/index.ts` beside the other `pgn/` exports.

- [ ] **Step 4: Run the tests and typecheck**

Run: `pnpm --filter @mychess/chess test -- src/pgn/player-side.test.ts` then `pnpm --filter @mychess/chess typecheck`
Expected: PASS.

- [ ] **Step 5: Lint** `pnpm exec eslint --max-warnings=0 packages/chess/src/pgn/player-side.ts packages/chess/src/pgn/player-side.test.ts packages/chess/src/index.ts`

- [ ] **Step 6: Report to the lead**

---

### Task 6: The arrows setting and the preview limit in the domain (R-205, R-208) - backend-dev - SECURITY

**Files:**
- Modify: `packages/domain/src/training.ts`
- Modify: `packages/domain/src/rate-limit.ts`, `packages/domain/src/index.ts`
- Test: `packages/domain/src/training.test.ts`, `packages/domain/src/rate-limit.test.ts`

- [ ] **Step 1: Write the failing tests**

In `training.test.ts`, change every `trainingSettingsSchema.parse({ sessionSize, newPerDay: ... })` input and expected value to carry `learnArrows: true` (the existing cases keep their meaning), replace the defaults case, and add:

```ts
  it('defaults to 20 a session, 10 new a day and arrows on, within the limits', () => {
    expect(DEFAULT_TRAINING_SETTINGS).toEqual({
      sessionSize: 20,
      newPerDay: 10,
      learnArrows: true,
    });
    expect(trainingSettingsSchema.parse(DEFAULT_TRAINING_SETTINGS)).toEqual(
      DEFAULT_TRAINING_SETTINGS,
    );
  });

  it.each([true, false])('takes arrows %s (R-205)', (learnArrows) => {
    expect(
      trainingSettingsSchema.parse({ sessionSize: 20, newPerDay: 10, learnArrows }),
    ).toEqual({ sessionSize: 20, newPerDay: 10, learnArrows });
  });

  it.each(['on', 1, undefined])('refuses arrows given as %s', (learnArrows) => {
    expect(issuesOf({ sessionSize: 20, newPerDay: 10, learnArrows })).toEqual([
      'training.settings.learnArrows',
    ]);
  });
```

In `rate-limit.test.ts`, replace the `the import limit (R-119)` describe:

```ts
describe('the import limits (R-119, R-208)', () => {
  it('allows ten confirms a minute, refused as too many imports', () => {
    expect(IMPORT_RATE_LIMIT).toEqual({
      windowMs: 60_000,
      max: 10,
      reason: 'pgn.tooManyImports',
    });
  });

  it('allows thirty previews a minute, refused as too many previews', () => {
    expect(IMPORT_PREVIEW_RATE_LIMIT).toEqual({
      windowMs: 60_000,
      max: 30,
      reason: 'pgn.tooManyPreviews',
    });
  });

  it('counts previews and confirms apart, per account', () => {
    expect(importRateKey('acc-1')).toBe('pgn-import:acc-1');
    expect(importPreviewRateKey('acc-1')).toBe('pgn-preview:acc-1');
    expect(importPreviewRateKey('acc-2')).not.toBe(importPreviewRateKey('acc-1'));
    expect(importPreviewRateKey('acc-1')).not.toBe(importRateKey('acc-1'));
  });
});
```

(add `IMPORT_PREVIEW_RATE_LIMIT` and `importPreviewRateKey` to the file's import list).

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @mychess/domain test -- src/training.test.ts src/rate-limit.test.ts`
Expected: FAIL (`learnArrows` stripped from the output; `IMPORT_PREVIEW_RATE_LIMIT` undefined).

- [ ] **Step 3: Implement**

`training.ts`:

```ts
export const TRAINING_ISSUES = {
  sessionSize: 'training.settings.sessionSize',
  newPerDay: 'training.settings.newPerDay',
  learnArrows: 'training.settings.learnArrows',
} as const;

/** R-62: moves in a session; R-146: new moves a day; R-205: learn arrows. */
export const trainingSettingsSchema = z.object({
  sessionSize: wholeNumber(10, 100, TRAINING_ISSUES.sessionSize),
  newPerDay: wholeNumber(0, 50, TRAINING_ISSUES.newPerDay),
  learnArrows: z.boolean({ error: TRAINING_ISSUES.learnArrows }),
});
export type TrainingSettings = z.infer<typeof trainingSettingsSchema>;
/** R-62's and R-205's defaults, the limits as the chess queue keeps them. */
export const DEFAULT_TRAINING_SETTINGS: TrainingSettings = {
  sessionSize: QUEUE_LIMITS.reviews,
  newPerDay: QUEUE_LIMITS.newPerDay,
  learnArrows: true,
};
```

`rate-limit.ts`: change the `IMPORT_RATE_LIMIT` comment to "An account runs at most ten import confirms a minute (R-119, R-208)." and `importRateKey`'s to "The counter of an account's confirms (R-119)." Add after `IMPORT_RATE_LIMIT`:

```ts
/** An account runs at most thirty import previews a minute (R-208). */
export const IMPORT_PREVIEW_RATE_LIMIT = {
  windowMs: 60_000,
  max: 30,
  reason: 'pgn.tooManyPreviews',
} as const satisfies RateRule;
```

and after `importRateKey`:

```ts
/** The counter of an account's previews, apart from its confirms (R-208). */
export const importPreviewRateKey = (accountId: string): string =>
  `pgn-preview:${accountId}`;
```

Export both from `packages/domain/src/index.ts` in the rate-limit block.

- [ ] **Step 4: Run the tests and typecheck**

Run: `pnpm --filter @mychess/domain test -- src/training.test.ts src/rate-limit.test.ts` then `pnpm --filter @mychess/domain typecheck`
Expected: PASS. (`packages/db` and `apps/web` typechecks now fail on `learnArrows`; Tasks 7 and 9 fix them before the lead commits.)

- [ ] **Step 5: Lint** `pnpm exec eslint --max-warnings=0 packages/domain/src/training.ts packages/domain/src/rate-limit.ts packages/domain/src/index.ts packages/domain/src/training.test.ts packages/domain/src/rate-limit.test.ts`

- [ ] **Step 6: Report to the lead** (security-reviewer: the preview limit's key and value)

---

### Task 7: Store the arrows setting; retain the preview counter (R-205, R-208) - backend-dev

**Files:**
- Modify: `packages/db/src/schema/accounts.ts`
- Create (generated): `packages/db/migrations/0019_account_learn_arrows.sql` and the updated `packages/db/migrations/meta/*`
- Modify: `packages/db/src/training/settings.ts`, `packages/db/src/rate-limits.ts`
- Modify: `packages/db/src/testing/personas/seed.ts` only if its build fails on the new field (it reads `DEFAULT_TRAINING_SETTINGS.sessionSize` only, so it should not)
- Test: `packages/db/test/training-reads.test.ts`, `packages/db/test/training-snapshot.test.ts`

- [ ] **Step 1: Write the failing tests**

In `training-reads.test.ts`, `describe('trainingSettings')`, replace the round-trip and own-settings cases:

```ts
  it('reads back what setTrainingSettings wrote, and stamps the account', async () => {
    const settings = { sessionSize: 40, newPerDay: 0, learnArrows: false };
    await setTrainingSettings(db, 'p', settings, NOW);
    expect(await trainingSettings(db, 'p')).toEqual(settings);
    expect(await accountRow('p')).toEqual({ updated_at: NOW });
  });

  it('turns arrows back on (R-205)', async () => {
    await setTrainingSettings(db, 'p', { sessionSize: 20, newPerDay: 10, learnArrows: false }, NOW);
    await setTrainingSettings(db, 'p', { sessionSize: 20, newPerDay: 10, learnArrows: true }, LATER);
    expect((await trainingSettings(db, 'p')).learnArrows).toBe(true);
  });

  it("writes only the player's own settings", async () => {
    await seedPlayer(db, 'q', 'q@example.lt');
    await setTrainingSettings(db, 'p', { sessionSize: 40, newPerDay: 0, learnArrows: false }, NOW);
    expect(await trainingSettings(db, 'q')).toEqual(DEFAULT_TRAINING_SETTINGS);
  });
```

In `training-snapshot.test.ts` (around line 85), write and expect `{ sessionSize: 30, newPerDay: 5, learnArrows: false }`.

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @mychess/db test -- test/training-reads.test.ts test/training-snapshot.test.ts`
Expected: FAIL (`learnArrows` is not read back).

- [ ] **Step 3: Change the schema and generate the migration**

In `accounts.ts`, after `newPerDay`:

```ts
    /** R-205: show arrows when learning new moves. */
    learnArrows: boolean('learn_arrows').notNull().default(true),
```

and extend the comment above `sessionSize` to "R-62, R-146, R-205: ...". Then run:

`pnpm --filter @mychess/db db:generate --name account_learn_arrows`

Expected: `packages/db/migrations/0019_account_learn_arrows.sql` with exactly

```sql
ALTER TABLE "accounts" ADD COLUMN "learn_arrows" boolean DEFAULT true NOT NULL;
```

and an updated `meta/_journal.json` plus a new `meta/0019_snapshot.json`. Review the SQL; never hand-edit it. If the name prefix is not 0019, keep what drizzle-kit gave.

- [ ] **Step 4: Read and write the column**

`settings.ts`: add `learnArrows: accounts.learnArrows` to the select and `learnArrows: settings.learnArrows` to the update's `set`; change the module comment to "A player's training settings (R-62, R-146, R-205)".

`rate-limits.ts`: import `IMPORT_PREVIEW_RATE_LIMIT` and add `IMPORT_PREVIEW_RATE_LIMIT.windowMs,` to `REQUEST_COUNTER_RETENTION_MS` after `IMPORT_RATE_LIMIT.windowMs`; mention "the PGN import's previews and confirms (R-119, R-208)" in the module comment.

- [ ] **Step 5: Run the tests and typecheck**

Run: `pnpm --filter @mychess/db test -- test/training-reads.test.ts test/training-snapshot.test.ts test/rate-limits-prune.test.ts` then `pnpm --filter @mychess/db typecheck`
Expected: PASS (`rate-limits-prune` still expects 3,600,000: the magic-link window is the longest).

- [ ] **Step 6: Lint** `pnpm exec eslint --max-warnings=0 packages/db/src/schema/accounts.ts packages/db/src/training/settings.ts packages/db/src/rate-limits.ts packages/db/test/training-reads.test.ts packages/db/test/training-snapshot.test.ts`

- [ ] **Step 7: Report to the lead** (the generated SQL in full)

---

### Task 8: Every new and changed text, English and Lithuanian - i18n-content - UX

The web tasks read these keys; this task lands first so their tests can. Lithuanian follows `docs/glossary-lt.md` and R-148's terms; English is shown under R-180, Lithuanian is kept complete.

**Files:**
- Modify: `apps/web/src/i18n/messages/en.json`, `apps/web/src/i18n/messages/lt.json`
- Modify: `docs/glossary-lt.md` if a new term is added

- [ ] **Step 1: Add or change these keys (English given; write the Lithuanian)**

| Key | English | Task |
| --- | --- | --- |
| `training.settings.learnArrowsLabel` | Show arrows when learning new moves | 9 |
| `training.settings.learnArrowsHint` | Off, a new move is asked without its arrow; a wrong move shows it. | 9 |
| `training.settings.learnArrows` | Choose whether to show arrows. | 6 (zod issue) |
| `training.learn.recall` | Play the new move | 11 |
| `training.title.mixed` | Several repertoires | 15 |
| `training.twoAnswers.other` | Your other repertoire {name} plays {move} here. | 14 |
| `training.today.repertoireDue` | {name} · {side} · {count} due | 15 |
| `training.repertoire.learnIn` | {count, plural, one {Learn # new move} other {Learn # new moves}} in {subject} | 13 (the Learn link's accessible name) |
| `training.repertoire.limitReached` | Daily limit reached: {count, plural, one {# new move} other {# new moves}} a day. | 13 |
| `training.repertoire.limitSettings` | Change the limit | 13 |
| `repertoire.secondAnswer` (changed) | This repertoire already has a move here. To play another move, put it in a different repertoire. | decision 7 |
| `pgn.tooManyPreviews` | Too many previews: at most {limit} a minute. Wait a minute and try again. | 17 |
| `repertoires.import.noFile` (changed) | Choose a PGN file or paste PGN. | 18 |
| `repertoires.import.paste` | Or paste PGN | 18 |
| `repertoires.import.pasted` | Pasted PGN | 18 |
| `repertoires.import.fileTitle` (changed) | PGN and side | 18 |

For `training.twoAnswers.other` in Lithuanian, keep R-148's term as the lead-in unless the owner rules otherwise (open question 1), for example "Kituose jūsų repertuaruose čia žaidžiamas kitas ėjimas: {name} – {move}." Keep `training.review.twoAnswers.title` and `.item` until Task 14 has removed their last use, then delete them in Task 14's step.

- [ ] **Step 2: Run the catalogue tests**

Run: `pnpm --filter @mychess/web test:component -- src/i18n`
Expected: PASS (both catalogues have the same keys and every ICU message parses).

- [ ] **Step 3: Report to the lead**

---

### Task 9: The arrows toggle in settings, and the settings fixtures (R-205, decision 1) - web-dev - UX

Lands in the same commit as Tasks 6 and 7.

**Files:**
- Modify: `apps/web/src/app/nustatymai/actions.ts`, `apps/web/src/app/nustatymai/training-form.tsx`
- Test: `apps/web/src/app/nustatymai/training-form.test.tsx`, `apps/web/src/app/nustatymai/actions.test.ts`
- Modify (fixtures): every `apps/web` test that builds `TrainingSettings` (find them with `rg -l "newPerDay: \d" apps/web/src apps/web/test`): at least `nustatymai/{training-form,actions,page}.test.tsx?`, `treniruote/{drill-board,learn-drill,review-drill,review-drill-state,training-screen}.test.ts(x)`, `lib/training-day.test.ts`, `server/training.test.ts`

- [ ] **Step 1: Update the fixtures**

Add `learnArrows: true` beside every `newPerDay: <n>` inside a `settings: { ... }` (or `TrainingSettings`-typed) literal. Run `pnpm --filter @mychess/web typecheck`; expected: only `training-form.tsx`/`actions.ts` errors remain, if any.

- [ ] **Step 2: Write the failing form tests** (in `training-form.test.tsx`; render with `settings={{ sessionSize: 20, newPerDay: 10, learnArrows: true }}`)

```ts
const arrowsBox = () =>
  screen.getByRole<HTMLInputElement>('checkbox', { name: lt.learnArrowsLabel });

  it('shows the arrows setting, on by default (R-205)', () => {
    renderForm();
    expect(arrowsBox().checked).toBe(true);
    expect(arrowsBox().getAttribute('aria-describedby')).toContain(
      screen.getByText(lt.learnArrowsHint).id,
    );
  });

  it('sends the arrows setting with the limits', async () => {
    renderForm();
    fireEvent.click(arrowsBox());
    save('20', '10');
    await waitFor(() => {
      expect(status().textContent).toBe(lt.saved);
    });
    expect(submitted()).not.toHaveProperty('learnArrows');
  });
```

and in `actions.test.ts`, following its existing pattern for `updateTrainingSettingsAction`, assert that a form with `learnArrows=on` stores `learnArrows: true` and one without it stores `learnArrows: false` (the mocked `setTrainingSettings` receives `{ sessionSize: 20, newPerDay: 10, learnArrows: false }`).

- [ ] **Step 3: Run them to see them fail**

Run: `pnpm --filter @mychess/web test:component -- src/app/nustatymai`
Expected: FAIL (no checkbox; the action passes no `learnArrows`).

- [ ] **Step 4: Implement**

`actions.ts`, in `updateTrainingSettingsAction`:

```ts
  const settings = trainingSettingsSchema.safeParse({
    sessionSize: typed(form.get('sessionSize')),
    newPerDay: typed(form.get('newPerDay')),
    // A checkbox is sent only when ticked (R-205).
    learnArrows: form.get('learnArrows') === 'on',
  });
```

and the doc comment: "Saves the session account's training settings (R-62, R-146, R-205)...". `type Field = keyof TrainingSettings` in the form now includes `learnArrows`; narrow `LimitField`'s `name` to `'sessionSize' | 'newPerDay'`. Add before the submit button in `TrainingForm`:

```tsx
        <ArrowsField initial={settings.learnArrows} />
```

with, above `TrainingForm`:

```tsx
/** R-205: whether the learn pass shows arrows on new moves. */
function ArrowsField({ initial }: { readonly initial: boolean }): JSX.Element {
  const t = useTranslations('training.settings');
  const fieldId = useId();
  const hintId = useId();
  return (
    <div className="flex flex-col gap-1">
      <div className="flex min-h-touch items-center gap-3">
        <input
          id={fieldId}
          name="learnArrows"
          type="checkbox"
          defaultChecked={initial}
          aria-describedby={hintId}
          className="size-5 accent-accent"
        />
        <label htmlFor={fieldId} className="font-semibold">
          {t('learnArrowsLabel')}
        </label>
      </div>
      <p id={hintId} className="text-sm text-fg-muted">
        {t('learnArrowsHint')}
      </p>
    </div>
  );
}
```

Give the section `id={TRAINING_SETTINGS_ID}` (export `const TRAINING_SETTINGS_ID = 'treniruote';` from `training-form.tsx`) and add `trainingSettings: '/nustatymai#treniruote'` to `ROUTES` in `apps/web/src/lib/routes.ts` (Task 13 links to it).

- [ ] **Step 5: Run the tests and typecheck**

Run: `pnpm --filter @mychess/web test:component -- src/app/nustatymai src/app/treniruote src/lib src/server/training.test.ts` then `pnpm --filter @mychess/web typecheck`
Expected: PASS.

- [ ] **Step 6: Lint** `pnpm exec eslint --max-warnings=0 apps/web/src/app/nustatymai apps/web/src/lib/routes.ts`

- [ ] **Step 7: Report to the lead** (ux-designer: the toggle at phone and desktop width, both themes)

---

### Task 10: Learned moves still queued are not taught again (decision 2) - web-dev

**Files:**
- Modify: `apps/web/src/app/treniruote/result-queue.ts` (+ `result-queue.test.ts`)
- Modify: `apps/web/src/app/treniruote/use-result-sync.ts`
- Modify: `apps/web/src/lib/training-data.ts`, `apps/web/src/lib/training-day.ts` (+ `training-day.test.ts`)
- Modify: `apps/web/src/app/treniruote/training-screen.tsx` (+ `training-screen.test.tsx`)

- [ ] **Step 1: Write the failing reproduction** (in `apps/web/src/lib/training-day.test.ts`; add `withLearned`-free imports only, the test goes through `dayOf`)

```ts
describe('a snapshot caught up with the browser’s queue (decision 2)', () => {
  it('does not teach again a move learned on an earlier page whose result is still queued', () => {
    const fresh = data({ mode: 'learn' });
    expect(newKeys(learnLines(dayOf(fresh)))).toContain(D4);
    const caught = dayOf({ ...fresh, queued: [{ key: D4, at: NOW }] });
    expect(caught.tracked.has(D4)).toBe(true);
    expect(newKeys(learnLines(caught))).not.toContain(D4);
    expect(caught.learnedToday).toBe(1);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @mychess/web test:component -- src/lib/training-day.test.ts`
Expected: FAIL (`queued` is not a `TrainingData` field / D4 is planned again).

- [ ] **Step 3: Implement the day**

`training-data.ts`, in `TrainingData` (add `type LearnedMove` to its `@mychess/chess` import):

```ts
  /**
   * Moves this browser learned whose results it still queues (decision 2),
   * set by the training screen once mounted: the snapshot may have been
   * read before they reached the server. Never sent by the server.
   */
  readonly queued?: readonly LearnedMove[];
```

`training-day.ts`:

```ts
import { withLearned, type TrainingDay } from '@mychess/chess';
import { dayStart } from '@mychess/domain';
import type { TrainingData } from './training-data';

/** The training day `data` holds, caught up with the moves still queued. */
export function dayOf(data: TrainingData): TrainingDay {
  const day: TrainingDay = {
    repertoires: data.entries.map(({ id, graph, active }) => ({
      id,
      graph,
      active,
    })),
    reviews: new Map(data.reviews.map((r) => [r.key, r])),
    tracked: new Set(data.tracked),
    learnedToday: data.learnedToday,
    limits: {
      reviews: data.settings.sessionSize,
      newPerDay: data.settings.newPerDay,
    },
  };
  return data.queued === undefined
    ? day
    : withLearned(day, data.queued, dayStart(data.now));
}
```

(keep the file's header comment; add "and the moves the browser still queues").

- [ ] **Step 4: Run it**

Run: `pnpm --filter @mychess/web test:component -- src/lib/training-day.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing queue and screen tests**

In `result-queue.test.ts`:

```ts
describe('learnedIn (decision 2)', () => {
  it('gives the learned results as moves, graded ones left out', () => {
    const at = new Date('2026-10-25T08:00:00Z');
    const result = (kind: TrainingResult['kind'], moveKey: string) => ({
      resultId: '00000000-0000-4000-8000-000000000001',
      kind,
      moveKey,
      repertoireId: '7d1f8f3e-5b8a-4c3e-9a51-2f0e6b7c9d10',
      answeredAt: at,
    });
    expect(learnedIn([result('learned', 'a|e4'), result('pass', 'a|d4')])).toEqual([
      { key: 'a|e4', at },
    ]);
  });
});
```

In `training-screen.test.tsx`, extend the hoisted `sync` with `queued: null as readonly { key: string; at: Date }[] | null`, reset it to `null` in `beforeEach`, and the mock:

```ts
vi.mock('./use-result-sync', () => ({
  useResultSync: (accountId: string) => {
    sync.accounts.push(accountId);
    return { unsynced: sync.unsynced, record: sync.record, retry: sync.retry };
  },
  useQueuedLearned: () => sync.queued,
}));
```

Change the hoisted learn drill to print what it was handed: `panel: <p>{`${name} drill, ${data.mode}, back to ${links.back}, ${String(data.queued?.length ?? 0)} queued`}</p>`, then add:

```ts
describe('the training screen and the results still queued (decision 2)', () => {
  it('hands the learn drill the moves the browser still queues', () => {
    sync.queued = [{ key: D4, at: NOW }];
    renderScreen(data({ mode: 'learn' }));
    expect(screen.getByText(/learn drill, learn, .*, 1 queued/)).toBeDefined();
  });
  it('says every move is learned when the queue holds the last one', () => {
    const graph = graphOf('1. d4 *');
    sync.queued = [{ key: D4, at: NOW }];
    renderScreen(
      data({
        mode: 'learn',
        entries: [{ id: ID, name: 'd4', side: 'white', kind: 'own', active: true, graph }],
      }),
    );
    expect(heading(T.empty.nothingLeft.title)).toBeDefined();
  });
});
```

- [ ] **Step 6: Run them to see them fail**

Run: `pnpm --filter @mychess/web test:component -- src/app/treniruote/result-queue.test.ts src/app/treniruote/training-screen.test.tsx`
Expected: FAIL (`learnedIn` not exported; the screen ignores the queue).

- [ ] **Step 7: Implement the queue read and the screen**

`result-queue.ts`:

```ts
/** The learned results among `results`, as moves the training day takes (decision 2). */
export const learnedIn = (results: readonly TrainingResult[]): LearnedMove[] =>
  results
    .filter((r) => r.kind === 'learned')
    .map((r) => ({ key: r.moveKey, at: r.answeredAt }));
```

(import `type LearnedMove` from `@mychess/chess`).

`use-result-sync.ts` (import `useSyncExternalStore` and `learnedIn`, `type LearnedMove`):

```ts
const unchanging = (): (() => void) => () => undefined;
const notYet = (): null => null;

/**
 * The moves this browser learned for the account whose results it still
 * queued when the page opened (decision 2): the page's snapshot may have
 * been read before they reached the server. Null on the server and while
 * the page hydrates, so the first render matches the server's; read once.
 */
export function useQueuedLearned(
  accountId: string,
): readonly LearnedMove[] | null {
  const read = useMemo(() => {
    const store = browserStore(queueKey(accountId), () => window.localStorage);
    let once: readonly LearnedMove[] | undefined;
    return () => (once ??= learnedIn(pending(store)));
  }, [accountId]);
  return useSyncExternalStore(unchanging, read, notYet);
}
```

`training-screen.tsx`:

```tsx
  const sync = useResultSync(accountId);
  const queued = useQueuedLearned(accountId);
  // The snapshot, caught up once the browser's queue is read (decision 2).
  const caught = useMemo(
    () => (queued === null ? data : { ...data, queued }),
    [data, queued],
  );
  const day = useMemo(() => dayOf(caught), [caught]);
  // Decided from the snapshot, and again once the queue is read: a drill
  // that empties its queue shows its done summary, not an empty state.
  const start = useMemo(
    () => startState(day, caught.mode, caught.now),
    [day, caught],
  );
```

replace the `useState` start; pass `data={caught}` and `key={queued === null ? 'snapshot' : 'caught-up'}` to `<Drill ...>` so the drill starts again from the caught-up day, and use `caught` wherever the component read `data` after this point. Update the header comment ("...It owns the result queue, and catches the snapshot up with the moves it still queues").

- [ ] **Step 8: Run the tests and typecheck**

Run: `pnpm --filter @mychess/web test:component -- src/app/treniruote src/lib` then `pnpm --filter @mychess/web typecheck`
Expected: PASS.

- [ ] **Step 9: Lint** `pnpm exec eslint --max-warnings=0 apps/web/src/app/treniruote apps/web/src/lib`

- [ ] **Step 10: Report to the lead**

---

### Task 11: The learn drill without arrows (R-205, decision 1) - web-dev - UX

**Files:**
- Modify: `apps/web/src/app/treniruote/learn-drill-state.ts`, `use-learn-drill.ts`, `learn-drill.tsx`
- Test: `apps/web/src/app/treniruote/learn-drill.test.tsx`

**Lead answer 3 applies:** with arrows off, the coach note (and, from Task 14, the two-answers notice) shows once the blind move is answered, right or wrong, never before. Add a test that a right blind answer with arrows off shows the move's coach note, and that the note is absent before the answer. `taughtAt` in Task 14 must cover the answered blind move, not only the arrow's move.

- [ ] **Step 1: Write the failing tests** (append; `data`, `renderDrill`, `type`, `play`, `wait`, `arrows`, `panel`, `recorded`, `D4`, `T` are the file's)

```ts
describe('the learn drill with arrows off (R-205)', () => {
  const noArrows = () =>
    data({ settings: { sessionSize: 20, newPerDay: 10, learnArrows: false } });

  it('asks the first new move without its arrow', () => {
    renderDrill(noArrows());
    expect(arrows()).toEqual([]);
    expect(panel()).toContain(T.learn.recall);
  });
  it('records a move learned at its first right answer', () => {
    renderDrill(noArrows());
    play('d4');
    expect(recorded.map((r) => [r.kind, r.moveKey])).toEqual([['learned', D4]]);
  });
  it('shows the arrow after a wrong move, as after a lapse (R-59)', () => {
    renderDrill(noArrows());
    type('e4');
    wait(400);
    expect(arrows()).toEqual(['d2d4']);
    expect(panel()).toContain(T.learn.wrong);
    expect(recorded).toEqual([]);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @mychess/web test:component -- src/app/treniruote/learn-drill.test.tsx`
Expected: FAIL (the arrow shows; the prompt is `arrows`).

- [ ] **Step 3: Implement**

`learn-drill-state.ts`: import `type LearnSessionOptions` from `@mychess/chess`; add to `LearnDrillState`:

```ts
  /** How each line's session starts (R-205): with its arrows round or blind. */
  readonly options: LearnSessionOptions;
```

and change `startLearnDrill` and `released`:

```ts
/** A drill over `lines`, from the player's `reviews`, learned as `options` says. */
export function startLearnDrill(
  lines: readonly LearnLine[],
  reviews: ReadonlyMap<string, ReviewState>,
  options: LearnSessionOptions,
): LearnDrillState {
  const [first] = lines;
  return {
    lines,
    at: 0,
    session: first === undefined ? null : startLearnSession(first, options),
    options,
    hold: null,
    wrong: false,
    flash: null,
    revision: 0,
    unknownTyped: false,
    learned: [],
    reviews,
  };
}
```

and in `released`: `...(ended ? { at: s.at + 1, session: startLearnSession(next, s.options) } : {})`.

`use-learn-drill.ts`:

```ts
  const [state, setState] = useState(() =>
    startLearnDrill(learnLines(day), day.reviews, {
      arrows: data.settings.learnArrows,
    }),
  );
```

`learn-drill.tsx`: `type PromptKey = 'correct' | 'wrong' | 'known' | 'arrows' | 'blind' | 'recall';`, `TONES.recall = 'text-fg'`, and the last line of `promptOf`:

```ts
  if (state.session?.round !== 'blind') return 'arrows';
  return state.options.arrows ? 'blind' : 'recall';
```

Fix any other `startLearnDrill(` call (tests in `learn-drill.test.tsx` that call it directly pass `{ arrows: true }`).

- [ ] **Step 4: Run the tests and typecheck**

Run: `pnpm --filter @mychess/web test:component -- src/app/treniruote/learn-drill.test.tsx` then `pnpm --filter @mychess/web typecheck`
Expected: PASS.

- [ ] **Step 5: Lint** `pnpm exec eslint --max-warnings=0 apps/web/src/app/treniruote`

- [ ] **Step 6: Report to the lead** (ux-designer: the blind-first prompt)

---

### Task 12: The training page learns one chapter or one line (R-206, decision 3) - web-dev

**Files:**
- Modify: `apps/web/src/server/training.ts` (+ `training.test.ts`)
- Modify: `apps/web/src/app/treniruote/page.tsx` (+ `page.test.tsx`)
- Modify: `apps/web/src/lib/training-data.ts`, `apps/web/src/lib/training-day.ts` (+ test)
- Modify: `apps/web/src/lib/routes.ts` (+ `routes.test.ts`)

- [ ] **Step 1: Write the failing tests**

`server/training.test.ts` (beside the existing `parseTrainingSearch` cases):

```ts
describe('parseTrainingSearch with a focus (R-206)', () => {
  const R = '7d1f8f3e-5b8a-4c3e-9a51-2f0e6b7c9d10';
  it('reads a chapter and a line to learn, with r=', () => {
    expect(parseTrainingSearch({ mode: 'learn', r: R, chapter: 'c1', line: '2' }).focus).toEqual({
      repertoireId: R,
      chapterId: 'c1',
      lineIndex: 2,
    });
    expect(parseTrainingSearch({ mode: 'learn', r: R, chapter: 'c1' }).focus).toEqual({
      repertoireId: R,
      chapterId: 'c1',
    });
  });
  it('drops the focus outside learn, without r=, or malformed', () => {
    expect(parseTrainingSearch({ mode: 'review', r: R, chapter: 'c1' }).focus).toBeNull();
    expect(parseTrainingSearch({ mode: 'learn', chapter: 'c1' }).focus).toBeNull();
    expect(parseTrainingSearch({ mode: 'learn', r: R, chapter: 'x'.repeat(21) }).focus).toBeNull();
    expect(
      parseTrainingSearch({ mode: 'learn', r: R, chapter: 'c1', line: '-1' }).focus,
    ).toEqual({ repertoireId: R, chapterId: 'c1' });
  });
});
```

`lib/routes.test.ts`:

```ts
it('builds a learn path for one chapter or one line (R-206)', () => {
  expect(learnPath('r1', { chapterId: 'c 1' })).toBe(
    '/treniruote?mode=learn&r=r1&chapter=c%201',
  );
  expect(learnPath('r1', { chapterId: 'c1', lineIndex: 3 })).toBe(
    '/treniruote?mode=learn&r=r1&chapter=c1&line=3',
  );
});
```

`lib/training-day.test.ts`:

```ts
it('learns only the focus the page names (R-206)', () => {
  const chapterId = london.chapters[0]?.id ?? '';
  const day = dayOf(data({ mode: 'learn', focus: { repertoireId: 'r1', chapterId } }));
  expect(new Set(learnLines(day).map((l) => l.repertoireId))).toEqual(new Set(['r1']));
});
```

`treniruote/page.test.tsx`: following its existing mocks of `loadTraining`, assert that `?mode=learn&r=<id>&chapter=c1&line=0` calls `loadTraining(account, 'learn', { kind: 'repertoire', repertoireId: <id> }, { repertoireId: <id>, chapterId: 'c1', lineIndex: 0 })`.

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @mychess/web test:component -- src/server/training.test.ts src/lib src/app/treniruote/page.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

`training-data.ts`: import `type LearnFocus`; add to `TrainingData`:

```ts
  /** The one chapter or line a learn session teaches (R-206), if the URL names one. */
  readonly focus?: LearnFocus;
```

`lib/training-day.ts`: in `dayOf`'s `day` literal add `...(data.focus === undefined ? {} : { focus: data.focus }),`.

`routes.ts`:

```ts
/** The learn pass over one chapter, or one line of it (R-206). */
export const learnPath = (
  repertoireId: string,
  focus: { readonly chapterId: string; readonly lineIndex?: number },
): string =>
  `${trainingPath('learn', repertoireId)}&chapter=${encodeURIComponent(focus.chapterId)}${focus.lineIndex === undefined ? '' : `&line=${String(focus.lineIndex)}`}`;
```

`server/training.ts`:

```ts
const searchSchema = z.object({
  mode: z.enum(['review', 'learn']).catch('review'),
  r: z.uuid().optional().catch(undefined),
  /** A chapter id, as the repertoire page's `?chapter=` takes one. */
  chapter: z.string().min(1).max(20).optional().catch(undefined),
  line: z.coerce.number().int().min(0).optional().catch(undefined),
});

/** The page's search params (R-142, R-206): an unknown mode is a review, a bad `r`, chapter or line is dropped. */
export function parseTrainingSearch(
  params: Readonly<Record<string, string | string[] | undefined>>,
): {
  readonly mode: TrainingMode;
  readonly scope: TrainingScope;
  readonly focus: LearnFocus | null;
} {
  const { mode, r, chapter, line } = searchSchema.parse(params);
  return {
    mode,
    scope:
      r === undefined ? { kind: 'all' } : { kind: 'repertoire', repertoireId: r },
    focus:
      mode === 'learn' && r !== undefined && chapter !== undefined
        ? { repertoireId: r, chapterId: chapter, ...(line === undefined ? {} : { lineIndex: line }) }
        : null,
  };
}
```

`loadTraining(account, mode, scope, focus: LearnFocus | null = null)` adds `...(focus === null ? {} : { focus })` to the returned data. `page.tsx`: `const { mode, scope, focus } = parseTrainingSearch(...)`; `loadTraining(account, mode, scope, focus)`; comment "`?mode=review|learn`, `&r=` to train one repertoire (R-142), and with learn `&chapter=` and `&line=` to learn one chapter or line of it (R-206)". A chapter or line the repertoire does not have plans nothing: the screen says every move is learned there.

- [ ] **Step 4: Run the tests and typecheck**

Run: `pnpm --filter @mychess/web test:component -- src/server/training.test.ts src/lib src/app/treniruote` then `pnpm --filter @mychess/web typecheck`
Expected: PASS.

- [ ] **Step 5: Lint** `pnpm exec eslint --max-warnings=0 apps/web/src/server/training.ts apps/web/src/lib apps/web/src/app/treniruote/page.tsx`

- [ ] **Step 6: Report to the lead**

---

### Task 13: Learn on chapter rows and the current line; the daily limit notice (R-206, decisions 3 and 11) - web-dev - UX

**Files:**
- Create: `apps/web/src/lib/learn-budget.ts` (+ `learn-budget.test.ts`)
- Create: `apps/web/src/app/repertoire-view/learn-link.tsx` (+ `learn-link.test.tsx`)
- Modify: `apps/web/src/server/training.ts` (`repertoireTraining`, + test)
- Modify: `apps/web/src/app/repertoire-view/{train-buttons.tsx,chapter-row.tsx,chapter-list.tsx,know-section.tsx,repertoire-panel.tsx}` (+ `train-buttons.test.tsx`, `chapter-list.test.tsx`, `know-section.test.tsx`)
- Modify: `apps/web/src/app/repertuarai/[id]/page.tsx`, `apps/web/src/app/repertuarai/priskirti/[id]/{page.tsx,assigned-view.tsx}`

- [ ] **Step 1: Write the failing budget test** (`apps/web/src/lib/learn-budget.test.ts`)

```ts
import { toLearnCount } from '@mychess/chess';
import { describe, expect, it } from 'vitest';
import { graphOf, LONDON } from '../../test/fixtures/repertoires';
import { learnDayOf, type LearnBudget } from './learn-budget';

const london = graphOf(LONDON);
const budget: LearnBudget = {
  tracked: [],
  learnedToday: 0,
  limits: { reviews: 20, newPerDay: 2 },
};

describe('learnDayOf (R-206)', () => {
  it('counts what learning the repertoire, a chapter or a line teaches today', () => {
    const chapterId = london.chapters[0]?.id ?? '';
    expect(toLearnCount(learnDayOf('r', london, budget))).toBe(2);
    expect(toLearnCount(learnDayOf('r', london, budget, { chapterId }))).toBe(2);
    expect(toLearnCount(learnDayOf('r', london, budget, { chapterId, lineIndex: 99 }))).toBe(0);
    expect(toLearnCount(learnDayOf('r', london, { ...budget, learnedToday: 2 }, { chapterId }))).toBe(0);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @mychess/web test:component -- src/lib/learn-budget.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `learn-budget.ts`**

```ts
// What a repertoire page needs to count the new moves learning one chapter
// or line would teach today (R-206), sent by the server as plain data; the
// count itself is chess's learn plan, over this repertoire alone.
import type {
  QueueLimits,
  RepertoireGraph,
  TrainingDay,
} from '@mychess/chess';

export interface LearnBudget {
  /** This repertoire's own moves the player already tracks (R-181). */
  readonly tracked: readonly string[];
  readonly learnedToday: number;
  readonly limits: QueueLimits;
}

/** The learn day of one repertoire, its whole or one chapter or line of it. */
export function learnDayOf(
  repertoireId: string,
  graph: RepertoireGraph,
  budget: LearnBudget,
  focus?: { readonly chapterId: string; readonly lineIndex?: number },
): Omit<TrainingDay, 'reviews'> {
  return {
    repertoires: [{ id: repertoireId, graph, active: true }],
    tracked: new Set(budget.tracked),
    learnedToday: budget.learnedToday,
    limits: budget.limits,
    ...(focus === undefined ? {} : { focus: { repertoireId, ...focus } }),
  };
}
```

- [ ] **Step 4: Write the failing server and component tests**

`server/training.test.ts`, for `repertoireTraining` (following the file's mocked `trainingSnapshot`): with a snapshot of one London entry, `tracked` holding D4 and another repertoire's key `x|y`, `learnedToday: 3`, `settings: { sessionSize: 20, newPerDay: 3, learnArrows: true }`, expect

```ts
expect(await repertoireTraining(account, ID)).toEqual({
  counts: { due: 0, toLearn: 0 },
  learn: { tracked: [D4], learnedToday: 3, limits: { reviews: 20, newPerDay: 3 } },
  limitReached: true,
});
```

`train-buttons.test.tsx` (its `training` fixture gains `learn` and `limitReached`):

```ts
it('says the daily limit is reached instead of “Learn (0)” (decision 11)', () => {
  renderButtons({ ...training, counts: { due: 0, toLearn: 0 }, limitReached: true,
    learn: { tracked: [], learnedToday: 10, limits: { reviews: 20, newPerDay: 10 } } });
  expect(screen.queryByRole('link', { name: /Learn \(0\)/ })).toBeNull();
  expect(screen.getByText(/Daily limit reached: 10 new moves a day\./)).toBeDefined();
  expect(screen.getByRole('link', { name: en.training.repertoire.limitSettings }).getAttribute('href'))
    .toBe('/nustatymai#treniruote');
});
```

(render in `en` for these strings, or read `MESSAGES.lt` as the file does.)

`learn-link.test.tsx`:

```tsx
const london = graphOf(LONDON);
const chapterId = london.chapters[0]?.id ?? '';
const budget = { tracked: [], learnedToday: 0, limits: { reviews: 20, newPerDay: 2 } };
const training = (learnedToday: number): PanelTraining => ({
  repertoireId: 'r1',
  counts: { due: 0, toLearn: 2 },
  learn: { ...budget, learnedToday },
  limitReached: false,
});
const renderLink = (learnedToday: number) =>
  render(
    <NextIntlClientProvider locale="en" messages={MESSAGES.en}>
      <LearnLink training={training(learnedToday)} graph={london} focus={{ chapterId }} subject="Main" />
    </NextIntlClientProvider>,
  );

it('links to learning the chapter, with its count (R-206)', () => {
  renderLink(0);
  const link = screen.getByRole('link', { name: 'Learn 2 new moves in Main' });
  expect(link.getAttribute('href')).toBe(`/treniruote?mode=learn&r=r1&chapter=${chapterId}`);
  expect(link.textContent).toBe('Learn (2)');
});

it('is hidden when learning it would teach nothing today', () => {
  renderLink(2);
  expect(screen.queryByRole('link')).toBeNull();
});
```

`chapter-list.test.tsx` and `know-section.test.tsx`: with a `training` that has new moves, each chapter row and the current line show a Learn link whose `href` ends `&chapter=<id>` and `&chapter=<id>&line=<index>`.

- [ ] **Step 5: Run them to see them fail**

Run: `pnpm --filter @mychess/web test:component -- src/server/training.test.ts src/app/repertoire-view`
Expected: FAIL.

- [ ] **Step 6: Implement**

`server/training.ts`:

```ts
/** A repertoire page's training: its counts, its learn budget (R-206), and whether today's limit stops learning (decision 11). */
export interface RepertoireTraining {
  readonly counts: TrainingCounts;
  readonly learn: LearnBudget;
  readonly limitReached: boolean;
}

export async function repertoireTraining(
  account: Account,
  repertoireId: string,
): Promise<RepertoireTraining | null> {
  const data = await loadTraining(account, 'review', {
    kind: 'repertoire',
    repertoireId,
  });
  const entry = data?.entries[0];
  if (data === undefined || entry === undefined) return null;
  const own = new Set(playerKeys(entry.graph));
  const day = dayOf(data);
  const learn: LearnBudget = {
    tracked: data.tracked.filter((key) => own.has(key)),
    learnedToday: data.learnedToday,
    limits: day.limits,
  };
  return {
    counts: trainingCounts(day, data.now),
    learn,
    limitReached:
      learnStart(learnDayOf(entry.id, entry.graph, learn)).kind === 'limitReached',
  };
}
```

`train-buttons.tsx`: `PanelTraining` becomes

```ts
export interface PanelTraining {
  readonly repertoireId: string;
  /** Due now and to learn today, as the page loaded. */
  readonly counts: TrainingCounts;
  /** What learning a chapter or line would teach today (R-206). */
  readonly learn: LearnBudget;
  /** Moves are left but today's new moves are used (decision 11). */
  readonly limitReached: boolean;
}
```

and the Learn link is replaced, when `training.limitReached`, by

```tsx
<p className="text-fg-muted">
  {t('limitReached', { count: training.learn.limits.newPerDay })}{' '}
  <Link href={ROUTES.trainingSettings} className={TEXT_LINK}>
    {t('limitSettings')}
  </Link>
</p>
```

`learn-link.tsx`:

```tsx
'use client';

import { toLearnCount, type RepertoireGraph } from '@mychess/chess';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useMemo, type JSX } from 'react';
import { learnDayOf } from '../../lib/learn-budget';
import { learnPath } from '../../lib/routes';
import { SECONDARY_BUTTON } from '../buttons';
import type { PanelTraining } from './train-buttons';

/**
 * "Learn (n)" for one chapter or one line (R-206): the new moves learning
 * it would teach today, within the daily limit; nothing when that is 0.
 */
export function LearnLink({
  training,
  graph,
  focus,
  subject,
}: {
  readonly training: PanelTraining;
  readonly graph: RepertoireGraph;
  readonly focus: { readonly chapterId: string; readonly lineIndex?: number };
  /** The chapter's title or "This line", for the accessible name. */
  readonly subject: string;
}): JSX.Element | null {
  const t = useTranslations('training.repertoire');
  const { repertoireId, learn } = training;
  const count = useMemo(
    () => toLearnCount(learnDayOf(repertoireId, graph, learn, focus)),
    [repertoireId, graph, learn, focus],
  );
  if (count === 0) return null;
  return (
    <Link
      href={learnPath(repertoireId, focus)}
      aria-label={t('learnIn', { count, subject })}
      className={SECONDARY_BUTTON}
    >
      {t('learn', { count })}
    </Link>
  );
}
```

Pass `graph={state.graph}` from `RepertoirePanel` into `ChapterList`, `ChapterRows` and `ChapterRow` (new optional prop `graph?: RepertoireGraph | undefined`); in `ChapterRow`'s `row` fragment, after the title button, render `{training === undefined || graph === undefined ? null : <LearnLink training={training} graph={graph} focus={{ chapterId: chapter.id }} subject={title} />}`. In `KnowSection`, after the line's `KnowThisMenu`, render `<LearnLink training={training} graph={graph} focus={{ chapterId, lineIndex: line }} subject={t('line')} />`. Memoise the `focus` objects (`useMemo`) so `LearnLink`'s memo holds.

Pages: `repertuarai/[id]/page.tsx` builds `training={training === null ? null : { repertoireId: repertoire.id, ...training }}`; `assigned-view.tsx` takes `training: RepertoireTraining | null` and builds `{ repertoireId: data.repertoire.id, ...training }`.

- [ ] **Step 7: Run the tests and typecheck**

Run: `pnpm --filter @mychess/web test:component -- src/lib src/server/training.test.ts src/app/repertoire-view src/app/repertuarai` then `pnpm --filter @mychess/web typecheck`
Expected: PASS.

- [ ] **Step 8: Lint** `pnpm exec eslint --max-warnings=0 apps/web/src/lib apps/web/src/server/training.ts apps/web/src/app/repertoire-view apps/web/src/app/repertuarai`

- [ ] **Step 9: Report to the lead** (ux-designer: a chapter row and the Training section with Learn, phone and desktop, both themes; the limit notice)

---

### Task 14: The two-answers notice after the answer, written once, in learn too (R-54, R-174, decision 4) - web-dev - UX

**Files:**
- Modify: `apps/web/src/app/treniruote/two-answers-notice.tsx`, `review-drill.tsx`, `learn-drill.tsx`
- Test: `apps/web/src/app/treniruote/review-drill.test.tsx`, `learn-drill.test.tsx`
- Modify: `apps/web/src/i18n/messages/{en,lt}.json` (remove `training.review.twoAnswers` once unused; the lead routes this edit through i18n-content)

- [ ] **Step 1: Write the failing tests**

`review-drill.test.tsx`:

```ts
describe('the two-answers notice (R-54, decision 4)', () => {
  const other = {
    id: '0b9e7c1e-3f4a-4c5b-8d6e-7f8091a2b3c4',
    name: 'Anglų pradžia',
    side: 'white' as const,
    graph: graphOf('1. c4 *'),
  };
  it('says nothing before the answer, so it cannot hint', () => {
    renderDrill(data({ others: [other] }));
    expect(screen.queryByRole('note')).toBeNull();
  });
  it('names the other repertoire and its move once, after the answer', () => {
    renderDrill(data({ others: [other] }));
    type('d4');
    const note = screen.getByRole('note').textContent ?? '';
    expect(note).toContain('Anglų pradžia');
    expect(note).toContain('c4');
    expect(note.match(/c4/g)).toHaveLength(1);
  });
});
```

`learn-drill.test.tsx`:

```ts
describe('the two-answers notice in learn (decision 4)', () => {
  const other = {
    id: '0b9e7c1e-3f4a-4c5b-8d6e-7f8091a2b3c4',
    name: 'Anglų pradžia',
    side: 'white' as const,
    graph: graphOf('1. c4 *'),
  };
  it('shows on the new move’s step, with its arrow', () => {
    renderDrill(data({ others: [other] }));
    expect(screen.getByRole('note').textContent).toContain('Anglų pradžia');
  });
  it('is not shown on the blind ask', () => {
    renderDrill(data({ others: [other] }));
    play('d4');
    play('Bf4');
    expect(screen.queryByRole('note')).toBeNull();
  });
});
```

(`graphOf` is imported from `../../../test/fixtures/repertoires` in both files; in the learn file SHORT is `1. d4 d5 2. Bf4`, so after `d4`, the reply and `Bf4` the blind round asks `d4` again.)

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @mychess/web test:component -- src/app/treniruote/review-drill.test.tsx src/app/treniruote/learn-drill.test.tsx`
Expected: FAIL (the review notice shows before the answer; learn shows none).

- [ ] **Step 3: Implement**

`two-answers-notice.tsx`:

```tsx
/** The move a notice is about: its position, its move and its repertoire. */
export interface AskedMove {
  readonly fromKey: string;
  readonly san: string;
  readonly repertoireId: string;
}

export interface TwoAnswersNoticeProps {
  /** The move just answered (review) or taught (learn); none, no notice. */
  readonly at: AskedMove | undefined;
  /** Every repertoire the player trains, in the session or not. */
  readonly repertoires: readonly NamedRepertoire[];
}

/** Every repertoire the player trains, by name: the session's and the others. */
export const namedOf = (data: TrainingData): NamedRepertoire[] =>
  [...data.entries, ...data.others].map(({ id, name, graph }) => ({ id, name, graph }));

/**
 * R-54: each other repertoire that plays another move here, one sentence
 * each. Shown only once the move is answered or taught (decision 4, R-174),
 * so it never hints; it only informs, nothing waits on it.
 */
export function TwoAnswersNotice({ at, repertoires }: TwoAnswersNoticeProps): JSX.Element | null {
  const t = useTranslations('training.twoAnswers');
  if (at === undefined) return null;
  const others = twoAnswers(at.fromKey, at.san, repertoires).filter(
    (a) => a.repertoireId !== at.repertoireId,
  );
  if (others.length === 0) return null;
  const nameOf = (id: string): string => repertoires.find((r) => r.id === id)?.name ?? '';
  return (
    <div role="note" className="rounded-control bg-sunken px-3 py-2 text-sm text-fg-muted">
      {others.map((a) => (
        <p key={a.repertoireId}>{t('other', { name: nameOf(a.repertoireId), move: a.san })}</p>
      ))}
    </div>
  );
}
```

`review-drill.tsx`: drop the local `namedOf` (import it), and in `ReviewPanel` replace the notice with

```tsx
      <TwoAnswersNotice
        at={answeredMove(drill.state) === undefined ? undefined : item}
        repertoires={named}
      />
```

placed right after `<DrillCoachNote text={drill.note} />` (import `answeredMove` from `./review-drill-state`; `QueueItem` has `fromKey`, `san`, `repertoireId`).

`learn-drill.tsx` (its coach note is being changed in the working tree to `<DrillCoachNote notes={coachNotesFor(data, ...)} />`; work from the file as it stands): `LearnPanel` takes `named: readonly NamedRepertoire[]`; after `DrillCoachNote`:

```tsx
      <TwoAnswersNotice at={taughtAt(state)} repertoires={named} />
```

with, above `LearnPanel`:

```ts
/** The move the arrow teaches now, as the notice takes it. */
const taughtAt = (state: LearnDrillState): AskedMove | undefined => {
  const move = taughtMove(state);
  const repertoireId = repertoireOf(state);
  return move === undefined || repertoireId === undefined
    ? undefined
    : { fromKey: move.from, san: move.san, repertoireId };
};
```

and `LearnDrill` passes `named={useMemo(() => namedOf(data), [data])}`.

- [ ] **Step 4: Run the tests and typecheck**

Run: `pnpm --filter @mychess/web test:component -- src/app/treniruote` then `pnpm --filter @mychess/web typecheck`
Expected: PASS.

- [ ] **Step 5: Lint** `pnpm exec eslint --max-warnings=0 apps/web/src/app/treniruote`

- [ ] **Step 6: Report to the lead** (ask i18n-content to delete `training.review.twoAnswers.title`/`.item`; qa updates `e2e/training-know.spec.ts` D-M1-7 in Task 19)

---

### Task 15: Home lists due moves per repertoire; a mixed session's header (R-207, decision 5) - web-dev - UX

**Files:**
- Modify: `apps/web/src/server/training.ts` (`todaySummary`, + test)
- Modify: `apps/web/src/app/today-block.tsx` (+ `today-block.test.tsx`)
- Modify: `apps/web/src/app/treniruote/training-screen.tsx`, `training-frame.tsx`, `drill.ts` (+ `training-screen.test.tsx`, `training-frame.test.tsx`)

- [ ] **Step 1: Write the failing tests**

`server/training.test.ts`, `todaySummary`: with two entries (London `r1` white, Taimanov `r2` black) and one due Review in each, the Taimanov's earlier, expect

```ts
expect((await todaySummary(account)).repertoires).toEqual([
  { id: 'r2', name: 'Taimanov', side: 'black', due: 1 },
  { id: 'r1', name: 'London', side: 'white', due: 1 },
]);
```

`today-block.test.tsx`:

```ts
it('lists each repertoire with due moves, each linking to its own review (R-207)', () => {
  renderBlock({ ...summary, due: 3, repertoires: [
    { id: 'r2', name: 'Taimanov', side: 'black', due: 2 },
    { id: 'r1', name: 'London', side: 'white', due: 1 },
  ] });
  const links = within(screen.getByRole('list')).getAllByRole('link');
  expect(links.map((l) => l.getAttribute('href'))).toEqual([
    '/treniruote?mode=review&r=r2',
    '/treniruote?mode=review&r=r1',
  ]);
  expect(links[0]?.textContent).toContain('Taimanov');
  expect(links[0]?.textContent).toContain('2');
});
```

`training-screen.test.tsx`:

```ts
it('titles a session over several repertoires as such, naming the item’s below (R-207, R-54)', () => {
  const second = { ...data().entries[0], id: 'r2', name: 'Kita' } as TrainingData['entries'][number];
  renderScreen(data({ entries: [...data().entries, second] }), null);
  expect(screen.getByRole('heading', { level: 1, name: T.title.mixed })).toBeDefined();
  expect(screen.getByText('review item')).toBeDefined();
});
it('names the repertoire when the session trains only it', () => {
  renderScreen(data(), ID);
  expect(screen.getByRole('heading', { level: 1, name: 'review item' })).toBeDefined();
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @mychess/web test:component -- src/server/training.test.ts src/app/today-block.test.tsx src/app/treniruote/training-screen.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

`server/training.ts`:

```ts
/** One repertoire on home's list of due moves (R-207). */
export interface TodayRepertoire {
  readonly id: string;
  readonly name: string;
  readonly side: Side;
  readonly due: number;
}

export interface TodaySummary extends TrainingCounts {
  readonly minutes: number;
  readonly nextDue: Date | null;
  /** The repertoires with due moves, most urgent first (R-207). */
  readonly repertoires: readonly TodayRepertoire[];
}
```

In `todaySummary`, return `repertoires: []` when there is no data, else

```ts
    repertoires: dueByRepertoire(day, data.now).flatMap(({ repertoireId, due }) => {
      const entry = data.entries.find((e) => e.id === repertoireId);
      return entry === undefined ? [] : [{ id: entry.id, name: entry.name, side: entry.side, due }];
    }),
```

`today-block.tsx`, after `<DueLine summary={summary} />`:

```tsx
      {summary.repertoires.length === 0 ? null : (
        <ul className="flex flex-col gap-1">
          {summary.repertoires.map((r) => (
            <li key={r.id}>
              <Link href={trainingPath('review', r.id)} className={TEXT_LINK}>
                {t('repertoireDue', { name: r.name, side: sideWord(r.side), count: r.due })}
              </Link>
            </li>
          ))}
        </ul>
      )}
```

with `const tr = useTranslations('repertoires'); const sideWord = (side: Side) => tr(`create.${side}`);` and `TEXT_LINK` from `./nustatymai/styles`.

`drill.ts`, `FrameParts`: add

```ts
  /** Under the title: the item's repertoire when the title names several (R-54, R-207). */
  readonly subtitle?: string;
```

`training-frame.tsx`: `TopBarProps` gains `subtitle: string | undefined`; inside the `h1`'s place render

```tsx
        <div className="min-w-0 flex-1 lg:w-full lg:flex-none">
          <h1 className="truncate text-lg font-semibold lg:text-xl">{title}</h1>
          {subtitle === undefined ? null : (
            <p className="truncate text-sm text-fg-muted">{subtitle}</p>
          )}
        </div>
```

and `TrainingFrame` passes `subtitle={props.subtitle}`.

`training-screen.tsx`, in `frame`:

```tsx
  // R-207: a session over several repertoires is not titled by one; the
  // item's repertoire still shows, under the title (R-54).
  const mixed = repertoireId === null && caught.entries.length > 1;
  const frame = (parts: FrameParts): JSX.Element => (
    <TrainingFrame
      {...parts}
      {...(mixed
        ? {
            title: t('title.mixed'),
            ...(parts.title === undefined ? {} : { subtitle: parts.title }),
          }
        : {})}
      ...
```

- [ ] **Step 4: Run the tests and typecheck**

Run: `pnpm --filter @mychess/web test:component -- src/server src/app/today-block.test.tsx src/app/page.test.tsx src/app/treniruote` then `pnpm --filter @mychess/web typecheck`
Expected: PASS (fix any `TodaySummary` fixture that now needs `repertoires: []`).

- [ ] **Step 5: Lint** `pnpm exec eslint --max-warnings=0 apps/web/src/server/training.ts apps/web/src/app/today-block.tsx apps/web/src/app/treniruote`

- [ ] **Step 6: Report to the lead** (ux-designer: home's list and the two-line header, phone and desktop, both themes)

---

### Task 16: Dates on a 24-hour clock with the year (decision 6) - web-dev - UX

Run after #328 has landed (it edits `repertoire-list.tsx`).

**Files:**
- Create: `apps/web/src/lib/date-format.ts` (+ `date-format.test.ts`)
- Modify: `apps/web/src/app/treniruote/review-time.ts`
- Modify: `apps/web/src/app/repertuarai/repertoire-list.tsx`

- [ ] **Step 1: Write the failing tests** (`apps/web/src/lib/date-format.test.ts`)

```ts
import { createFormatter } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { CLOCK, dateTimeFormat } from './date-format';

/** 16:18 in Vilnius on 16 October 2026 (summer time, UTC+3). */
const AFTERNOON = new Date('2026-10-16T13:18:00Z');
const NOW = new Date('2026-10-10T09:00:00Z');

describe('the shared date formats (decision 6)', () => {
  it.each(['en', 'lt'] as const)('writes a clock time on a 24-hour clock in %s', (locale) => {
    const text = createFormatter({ locale }).dateTime(AFTERNOON, CLOCK);
    expect(text).toBe('16:18');
  });
  it('gives a date this year without the year, in Vilnius time', () => {
    const text = createFormatter({ locale: 'en' }).dateTime(AFTERNOON, dateTimeFormat(AFTERNOON, NOW));
    expect(text).toContain('16:18');
    expect(text).toContain('October');
    expect(text).not.toContain('2026');
    expect(text).not.toMatch(/AM|PM/);
  });
  it('adds the year to a date in another year', () => {
    const later = new Date('2027-01-05T10:00:00Z');
    const text = createFormatter({ locale: 'en' }).dateTime(later, dateTimeFormat(later, NOW));
    expect(text).toContain('2027');
    expect(text).toContain('12:00');
  });
});
```

(If `createFormatter` is not exported from `next-intl` 4.14 in this setup, import it from `use-intl`; check `node_modules/next-intl/dist/types` first.)

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @mychess/web test:component -- src/lib/date-format.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `date-format.ts`**

```ts
// The one place date-times are given their shape (#330 decision 6): a
// 24-hour clock in every locale, in the display time zone, and the year
// only when it is not the current one.
import type { DateTimeFormatOptions } from 'next-intl';
import { DISPLAY_TIME_ZONE } from './time-zone';

/** A clock time, 24-hour in every locale. */
export const CLOCK: DateTimeFormatOptions = {
  timeZone: DISPLAY_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
};

/** The calendar year of `date` in the display time zone. */
const yearOf = (date: Date): string =>
  date.toLocaleDateString('en-CA', { timeZone: DISPLAY_TIME_ZONE }).slice(0, 4);

/** A date with its clock time, seen at `now`: the year only when it differs. */
export function dateTimeFormat(when: Date, now: Date): DateTimeFormatOptions {
  return {
    ...CLOCK,
    month: 'long',
    day: 'numeric',
    ...(yearOf(when) === yearOf(now) ? {} : { year: 'numeric' }),
  };
}
```

`review-time.ts`: delete its `CLOCK`; import `CLOCK, dateTimeFormat` from `'../../lib/date-format'`; the `later` case returns `format.dateTime(when, dateTimeFormat(when, new Date(now ?? when.getTime())))` (while hydrating, `now` is null and the year is left out, as the server rendered it). Remove the now-unused `DISPLAY_TIME_ZONE` import if lint says so.

`repertoire-list.tsx`: in `changedFormat`, the same-day branch returns `CLOCK` (imported from `../../lib/date-format`); the call site keeps `timeZone: DISPLAY_TIME_ZONE`.

- [ ] **Step 4: Run the tests and typecheck**

Run: `pnpm --filter @mychess/web test:component -- src/lib src/app/treniruote src/app/repertuarai src/app/today-block.test.tsx` then `pnpm --filter @mychess/web typecheck`
Expected: PASS; fix any existing test that expected a 12-hour English time (for example "04:18 PM" becomes "16:18").

- [ ] **Step 5: Lint** `pnpm exec eslint --max-warnings=0 apps/web/src/lib apps/web/src/app/treniruote/review-time.ts apps/web/src/app/repertuarai/repertoire-list.tsx`

- [ ] **Step 6: Report to the lead**

---

### Task 17: Previews have their own limit (R-208, decision 9) - web-dev - SECURITY

**Files:**
- Modify: `apps/web/src/server/import-preview.ts`
- Test: `apps/web/test/feature/repertoire-import.test.ts`

- [ ] **Step 1: Write the failing feature tests** (replace `describe('the import rate limit (R-119)', ...)`; keep its `preview`, `confirm`, fake-timer set-up)

```ts
describe('the import rate limits (R-119, R-208)', () => {
  const T0 = new Date('2026-10-19T08:00:00Z');
  const preview = () => previewImportAction({ text: TAIMANOV, side: 'black' });
  const confirm = (name: string) =>
    outcomeOf(confirmImportAction({ text: TAIMANOV, side: 'black', target: { kind: 'new', name } }));
  const TOO_MANY_IMPORTS = { ok: false, refusal: { reason: 'pgn.tooManyImports', limit: 10 } };
  const TOO_MANY_PREVIEWS = { ok: false, refusal: { reason: 'pgn.tooManyPreviews', limit: 30 } };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('refuses the 31st preview in a minute', async () => {
    actAs((await cast()).gabija);
    for (let i = 0; i < 30; i++) expect((await preview()).ok).toBe(true);
    expect(await preview()).toEqual(TOO_MANY_PREVIEWS);
  });

  it('counts previews apart from confirms: thirty previews leave ten confirms', async () => {
    const { gabija } = await cast();
    actAs(gabija);
    for (let i = 0; i < 30; i++) await preview();
    const before = await repertoireCount();
    for (let i = 0; i < 10; i++) await confirm(`Importas ${String(i)}`);
    expect(await repertoireCount()).toBe(before + 10);
    expect(await confirm('Vienuoliktas')).toEqual(TOO_MANY_IMPORTS);
    expect(await repertoireCount()).toBe(before + 10);
  });

  it('counts each account on its own', async () => {
    actAs((await cast()).gabija);
    for (let i = 0; i < 30; i++) await preview();
    expect(await preview()).toEqual(TOO_MANY_PREVIEWS);
    actAs(await person(sql, 'ona@example.lt', 'Ona'));
    expect((await preview()).ok).toBe(true);
  });

  it('allows previews again a minute after the minute opened', async () => {
    actAs((await cast()).gabija);
    await preview();
    vi.setSystemTime(new Date(T0.getTime() + 59_000));
    for (let i = 0; i < 29; i++) await preview();
    vi.setSystemTime(new Date(T0.getTime() + 60_000));
    expect((await preview()).ok).toBe(true);
  });
});
```

If 10 new repertoires plus the cast's own pass the R-162 repertoire limit, use `target: { kind: 'existing', ... }` confirms instead; the cast holds 3 today (`repertoireCount()` was 3 + 5 = 8 in the old test).

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @mychess/web test:feature -- test/feature/repertoire-import.test.ts`
Expected: FAIL (the 11th preview is refused as `pgn.tooManyImports`).

- [ ] **Step 3: Implement** (`import-preview.ts`)

Import `IMPORT_PREVIEW_RATE_LIMIT`, `importPreviewRateKey`, and `type RateRule`. Add `| typeof IMPORT_PREVIEW_RATE_LIMIT.reason` to `ImportRefusalKey` and to `LimitKey`, and `| RateRefusal<typeof IMPORT_PREVIEW_RATE_LIMIT.reason>` to `ImportRefusal`. Replace `withinRateLimit`:

```ts
/** A preview's or a confirm's counter: apart, as R-208 limits them apart. */
const PREVIEWS = { rule: IMPORT_PREVIEW_RATE_LIMIT, key: importPreviewRateKey };
const CONFIRMS = { rule: IMPORT_RATE_LIMIT, key: importRateKey };

/** Counts one preview (R-208) or confirm (R-119) of `account`; refused over its limit. */
async function withinRateLimit(
  account: Account,
  counter: typeof PREVIEWS | typeof CONFIRMS,
  now: Date,
): Promise<ImportRefused | null> {
  const counted = await countRateLimited(
    getDb(),
    counter.key(account.id),
    counter.rule,
    now,
  );
  return counted.ok ? null : refused(counted.refusal);
}
```

`previewImport` calls `withinRateLimit(account, PREVIEWS, now)`, `confirmImport` `withinRateLimit(account, CONFIRMS, now)`. In the module's header comment replace "An account runs at most ten previews or confirms a minute between them (R-119)" with "An account runs at most thirty previews (R-208) and ten confirms (R-119) a minute, counted apart". If the union parameter type upsets `countRateLimited`'s generic, give `withinRateLimit` a generic `<R extends string>(account, rule: RateRule<R>, key: string, now)` signature instead.

- [ ] **Step 4: Run the tests and typecheck**

Run: `pnpm --filter @mychess/web test:feature -- test/feature/repertoire-import.test.ts`, `pnpm --filter @mychess/web test:component -- src/server/import-preview.test.ts src/app/repertuarai/importuoti`, `pnpm --filter @mychess/web typecheck`
Expected: PASS.

- [ ] **Step 5: Lint** `pnpm exec eslint --max-warnings=0 apps/web/src/server/import-preview.ts apps/web/test/feature/repertoire-import.test.ts`

- [ ] **Step 6: Report to the lead** (security-reviewer: the two counters and keys)

---

### Task 18: Paste PGN, and the side the file's players name (R-209, decisions 8 and 10) - web-dev - SECURITY - UX

The Lichess username is the session account's own provider id (`provider_accounts.provider_account_id`, the lower-case Lichess username, `server/oauth/lichess.ts` maps `id`). It is read through Better Auth's `listUserAccounts` for the session only, and sent to that account's own browser.

**Files:**
- Modify: `apps/web/src/server/provider-links.ts` (+ new `provider-links.test.ts` if none covers it)
- Modify: `apps/web/src/app/repertuarai/importuoti/{page.tsx,import-flow.tsx,use-import-flow.ts,file-step.tsx}`
- Test: `apps/web/src/app/repertuarai/importuoti/import-flow.test.tsx`, `page.test.tsx`

- [ ] **Step 1: Spike the Better Auth row shape**

Read `node_modules/better-auth/dist/**/*.d.ts` for `listUserAccounts`' return type and confirm each row carries `accountId` (the provider's id for the person). If it does not, stop and report to the lead.

- [ ] **Step 2: Write the failing tests**

`import-flow.test.tsx` (follow the file's render helper; it renders `ImportFlow` with `options` and `preselected`, and mocks the actions):

```ts
describe('pasted PGN (R-209)', () => {
  it('previews pasted text as it previews a file', async () => {
    renderFlow();
    fireEvent.change(screen.getByLabelText(en.repertoires.import.paste), {
      target: { value: '1. d4 d5 *' },
    });
    fireEvent.click(screen.getByRole('button', { name: en.repertoires.import.preview }));
    await waitFor(() => {
      expect(server.preview).toHaveBeenCalledWith({ text: '1. d4 d5 *', side: 'white', into: undefined });
    });
  });
  it('sends one of the two: a file chosen clears the pasted text', async () => {
    renderFlow();
    const paste = screen.getByLabelText<HTMLTextAreaElement>(en.repertoires.import.paste);
    fireEvent.change(paste, { target: { value: '1. d4 *' } });
    chooseFile(new File(['1. e4 *'], 'a.pgn'));
    expect(paste.value).toBe('');
  });
  it('refuses pasted text over 2 MB before sending it (R-66)', () => {
    renderFlow();
    fireEvent.change(screen.getByLabelText(en.repertoires.import.paste), {
      target: { value: 'x'.repeat(2 * 1024 * 1024 + 1) },
    });
    fireEvent.click(screen.getByRole('button', { name: en.repertoires.import.preview }));
    expect(server.preview).not.toHaveBeenCalled();
  });
});

describe('the side the file’s players name (decision 8)', () => {
  it('defaults to Black when every game names the account as Black', async () => {
    renderFlow({ names: ['Dovydas Jankauskas', 'dovydasj'] });
    fireEvent.change(screen.getByLabelText(en.repertoires.import.paste), {
      target: { value: '[White "X"]\n[Black "DovydasJ"]\n\n1. e4 c5 *' },
    });
    expect(screen.getByRole<HTMLInputElement>('radio', { name: en.repertoires.create.black }).checked).toBe(true);
  });
  it('keeps the side the player chose', () => {
    renderFlow({ names: ['Rokas'] });
    fireEvent.click(screen.getByRole('radio', { name: en.repertoires.create.black }));
    fireEvent.change(screen.getByLabelText(en.repertoires.import.paste), {
      target: { value: '[White "Rokas"]\n[Black "X"]\n\n1. e4 *' },
    });
    expect(screen.getByRole<HTMLInputElement>('radio', { name: en.repertoires.create.black }).checked).toBe(true);
  });
});
```

(`chooseFile` fires `change` on the hidden file input with `{ target: { files: [file] } }`; add `names` to `renderFlow`'s props, default `[]`.)

`page.test.tsx`: the page passes `names={[account.displayName, '<lichess id>']}` when Lichess is linked, `[account.displayName]` when not (mock `lichessUsername`).

- [ ] **Step 3: Run them to see them fail**

Run: `pnpm --filter @mychess/web test:component -- src/app/repertuarai/importuoti`
Expected: FAIL (no paste field; no `names` prop).

- [ ] **Step 4: Implement**

`provider-links.ts`: extend `linkRowsSchema`'s object with `accountId: z.string()` and add

```ts
/**
 * The session account's Lichess username as Lichess ids it (lower case),
 * or null when Lichess is not linked: the import page's side default
 * (#330 decision 8). Sent only to the account's own browser.
 */
export async function lichessUsername(): Promise<string | null> {
  const requestHeaders = await headers();
  const session = await getAuth().api.getSession({ headers: requestHeaders });
  if (session === null) return null;
  const rows = linkRowsSchema.parse(
    await getAuth().api.listUserAccounts({ headers: requestHeaders }),
  );
  return rows.find((row) => row.providerId === 'lichess')?.accountId ?? null;
}
```

`page.tsx`: `const account = await requireOnboarded(); const lichess = await lichessUsername();` and pass `names={lichess === null ? [account.displayName] : [account.displayName, lichess]}` to `ImportFlow`, which hands it to `useImportFlow(options, preselected, names)`.

`use-import-flow.ts`:

- `FlowState` gains `readonly pasted: string;` and `readonly sideChosen: boolean;` (initial `''` and `false`); `Upload.name` becomes `string | null` (null for pasted text).
- `Patch` adds `'pasted'`; a new event `{ type: 'source'; file: File | null; pasted: string; side: Side | null }` sets `file`, `pasted` and, when `side !== null && !state.sideChosen`, `side` (through `patched`, so the target resets when the side changes). `chooseSide` (used by `onSide`) dispatches `set` with `{ side }` and marks `sideChosen: true`.
- `onFile(file)`: dispatch `source` with `{ file, pasted: '', side: null }`, then read `file.text()` and dispatch `source` again with `side: sideFixed ? null : playerSide(text, names)`, ignoring the result if a newer source was chosen meanwhile (compare the file in state).
- `onPaste(text)`: dispatch `source` with `{ file: null, pasted: text, side: sideFixed ? null : playerSide(text, names) }`.
- `fileRefusal` becomes `sourceRefusal(file, pasted)`: neither -> `repertoires.import.noFile`; pasted over `PGN_LIMITS.bytes` (`new TextEncoder().encode(pasted).length`) -> `{ key: 'pgn.tooLarge', limit: PGN_LIMITS.bytes }`; a file as today.
- `submitFile` reads `pasted` when it is not blank (`{ text: pasted, name: null, side }`), else the file.

`file-step.tsx`: under `FileField`, a labelled textarea:

```tsx
function PasteField({ pasted, onPaste }: { readonly pasted: string; readonly onPaste: (text: string) => void }): JSX.Element {
  const t = useTranslations('repertoires.import');
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="font-medium">{t('paste')}</label>
      <textarea
        id={id}
        value={pasted}
        rows={6}
        spellCheck={false}
        onChange={(event) => { onPaste(event.currentTarget.value); }}
        className={`${FIELD} min-h-32 font-mono text-sm`}
      />
    </div>
  );
}
```

`ChosenFile` shows `name ?? t('import.pasted')`. Typing in the textarea clears the chosen file (the `source` event), so exactly one is sent.

- [ ] **Step 5: Run the tests and typecheck**

Run: `pnpm --filter @mychess/web test:component -- src/app/repertuarai/importuoti src/server` then `pnpm --filter @mychess/web typecheck`
Expected: PASS.

- [ ] **Step 6: Lint** `pnpm exec eslint --max-warnings=0 apps/web/src/app/repertuarai/importuoti apps/web/src/server/provider-links.ts`

- [ ] **Step 7: Report to the lead** (security-reviewer: `lichessUsername` reads only the session's own links and nothing is logged; ux-designer: step 1 with the paste field, phone and desktop, both themes)

---

### Task 19: Journeys end to end, and the persona check - qa

**Files:**
- Modify: `apps/web/e2e/training-learn.spec.ts`, `apps/web/e2e/training-know.spec.ts`, `apps/web/e2e/training-review.spec.ts`, `apps/web/e2e/home.spec.ts`, `apps/web/e2e/repertoires.spec.ts`
- Modify: `apps/web/e2e/support/training.ts` (`setTrainingLimits` takes `learnArrows?: boolean`)

- [ ] **Step 1: Extend the support helper**

```ts
export async function setTrainingLimits(
  page: Page,
  messages: Messages,
  limits: { sessionSize?: number; newPerDay?: number; learnArrows?: boolean },
): Promise<void> {
  const t = messages.training.settings;
  await page.goto('/nustatymai');
  const section = page.getByRole('region', { name: t.title });
  if (limits.sessionSize !== undefined)
    await section.getByLabel(t.sessionSizeLabel, { exact: true }).fill(String(limits.sessionSize));
  if (limits.newPerDay !== undefined)
    await section.getByLabel(t.newPerDayLabel, { exact: true }).fill(String(limits.newPerDay));
  if (limits.learnArrows !== undefined)
    await section.getByRole('checkbox', { name: t.learnArrowsLabel }).setChecked(limits.learnArrows);
  await section.getByRole('button', { name: t.submit }).click();
  await expect(section.getByText(t.saved, { exact: true })).toBeVisible();
}
```

- [ ] **Step 2: Write the journeys** (in `training-learn.spec.ts`, with the file's helpers)

1. **U1-M1-2 learn one line (R-206):** Rokas with his Italian opens the repertoire page, goes to the Pianissimo line's last move, clicks the Training section's Learn link; the counter shows only that line's new moves; the done summary's learned count equals it; the stored Reviews are exactly those keys.
2. **D-M1 arrows off (R-205):** a 2000+ account sets `learnArrows: false`, starts learning; no arrow on the first new move and the prompt is `en.training.learn.recall`; a right move is recorded learned at once; a wrong move shows one arrow.
3. **Decision 2:** learn a line, then block the results endpoint (`page.route('**/api/training/results', r => r.abort())`), learn the next line, go to the training page again with the endpoint still blocked: none of the moves just learned is asked as new; unblock and check the Reviews land.
4. **Decision 11:** with `newPerDay: 1` and one move learned today, the repertoire page shows the "Daily limit reached" text and a link to the settings section, no "Learn (0)".

In `home.spec.ts`: **R-207** two repertoires with due moves list on home, most urgent first, each link opens a review of that repertoire alone; a session from "Start review" has the `en.training.title.mixed` heading.

In `repertoires.spec.ts`: **R-209/decision 8** paste a Black PGN naming the account in `[Black]`: the side defaults to Black; previewing 31 times in a minute is refused with `pgn.tooManyPreviews` (or keep that to the feature test if too slow).

- [ ] **Step 3: Update the existing journeys**

`training-know.spec.ts` D-M1-7: the notice is absent before the answer; after answering, it contains one sentence `format(en.training.twoAnswers.other, { name, move })`; the repertoire name is read from the header's subtitle, not the h1 (mixed session). Any spec asserting 12-hour times or the old import step title follows the new text.

- [ ] **Step 4: Run them**

Run: `pnpm --filter @mychess/web test:e2e -- training-learn.spec.ts training-know.spec.ts home.spec.ts repertoires.spec.ts`
Expected: PASS.

- [ ] **Step 5: Persona check on the local persona stack**

Run the U1-M1-2 and the 2000+ learn journeys by hand on the persona stack (`pnpm --filter @mychess/db seed:personas`). Reproduce the tester's "moves just reviewed are taught again with arrows": review Dovydas's due moves, then learn. Record which hypothesis (Spec corrections 7) it was: unsynced results, or a Black repertoire imported as White. If neither reproduces it on main before this slice, say so.

- [ ] **Step 6: Report to the lead** (criteria met per #330 bullet, and the persona check's finding)

---

## Self-review against the spec

- Decision 1 -> Tasks 1, 9, 11 (with correction 1). Decision 2 -> Tasks 3, 10, 19 step 5. Decision 3 -> Tasks 2, 12, 13 (correction 2). Decision 4 -> Tasks 8, 14. Decision 5 -> Tasks 4, 15. Decision 6 -> Task 16 (corrections 3, 4). Decision 7 -> Task 8. Decision 8 -> Tasks 5, 18. Decision 9 -> Tasks 6, 7, 17 (correction 5). Decision 10 -> Task 18 (correction 6). Decision 11 -> Tasks 2, 13.
- Testing section: learn session blind start and wrong-shows-arrow (Task 1); focus within allowance (Task 2); reviewed key known (Tasks 2, 3); settings schema default (Task 6); db round trip of the setting (Task 7); the two limits round trip (Task 17, real database); web tests per visible change (Tasks 9-18); E2E U1-M1-2 one line and D-M1 arrows off (Task 19).
