# S3 Repertoires Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A player can create a repertoire, import PGN into a new or an existing repertoire (with the R-64 summary), browse it on a chessground board with comments, arrows, chapter intros and private personal notes, build and edit it on the board (add and remove moves, chapters, arrows, circles, comments), and download it as PGN that re-imports to the same tree. Only the owner can read or change a repertoire.

**Architecture:** `packages/chess` stays the only place chess rules live: it gains move comments in the graph, PGN round-tripping of them, `mergeInto`, `editComment`, `removeChapter`, `addChapter`, `renameChapter`, a repertoire summary and the legal-move helpers the board needs. `packages/domain` adds the name, comment and note schemas and the access rules `canViewRepertoire` / `canEditRepertoire`. `packages/db` stores a repertoire as one row per move (`repertoire_moves`) with its chapters (`chapters`, `move_chapters`), so S5 and S6 can attach foreign keys to moves; every write goes through one diff writer (`saveRepertoireEdit`, version-checked), and `createRepertoire` is the same writer from an empty graph. `apps/web` wraps chessground in one client component, and the repertoire page holds the graph in client state: every edit is a server action that loads, calls the chess function that decides, saves the minimal diff and returns the new graph and version.

**Tech Stack:** chessground 9.2.1 (GPL-3.0-or-later), chess.js 1.4.0, Next.js 16.3.6 App Router, React 19.3.0 (`useEffectEvent`), next-intl 4.14.9, Drizzle 0.45.3 on Postgres 18, zod 4.6.5, vitest 4.1.11 (feature suite on Testcontainers), fast-check 4.10.2, Playwright 1.64.1.

**Spec:** `docs/superpowers/specs/2026-10-17-s3-repertoires-design.md`. **Issue:** #253 (epic #250). **Rulings:** R-4, R-19, R-21, R-53, R-54, R-63 to R-66, R-79, R-82, R-96, R-97, R-101, R-102. **Blocked on:** nothing (S1 and S2 are done). Owner questions in Task 1 do not block Tasks 2 to 10.

**Roles:** each task names its role. `- SECURITY` tasks go through `security-reviewer`; `- UX` tasks go through `ux-designer` and `i18n-content`. Every task then goes developer -> `qa` -> `architect` (`mp-code-review` on the task's diff) -> the lead commits (`docs/agent-team.md`, Pipeline step 5).

**Rules for every task** (CLAUDE.md): test first; no suppression comments, no `any`, no `!`; functions small (cyclomatic complexity <= 10, CRAP <= 30); rules in `packages/chess` / `packages/domain`, never in pages or actions; every user-visible string through `apps/web/src/i18n/messages/{lt,en}.json` (LT first); refusals are `Result` values whose `reason` is a catalogue key; parse every request body, query result and external response with zod. Never edit gate configuration (CLAUDE.md list). Every new test file below falls under an existing vitest project (chess `src/**/*.test.ts`, domain `src/**/*.test.ts`, db `test/**/*.test.ts`, web component `src/**/*.test.{ts,tsx}`, web feature `test/feature/**/*.test.ts`), and E2E files are under `apps/web/e2e/**`, already listed in `testsOutsideGate`; so `quality/quality.config.json` needs no change. After each task: `node quality/gate.mjs check` (needs Docker). Workers report the files they changed and the commands they ran with their results; the lead commits.

Commands used below:

| What | Command |
| --- | --- |
| chess unit tests | `pnpm --filter @mychess/chess test` (one file: `pnpm --filter @mychess/chess exec vitest run src/pgn/import-pgn.test.ts`) |
| domain unit tests | `pnpm --filter @mychess/domain test` |
| db tests (Testcontainers) | `pnpm --filter @mychess/db test` |
| migration | `pnpm --filter @mychess/db db:generate` |
| web component tests | `pnpm --filter @mychess/web test:component` |
| web feature tests | `pnpm --filter @mychess/web test:feature` |
| E2E | `docker compose -f infra/compose.yaml up -d`, `pnpm --filter @mychess/db build && pnpm --filter @mychess/db migrate`, `pnpm --filter @mychess/web test:e2e` |
| the gate | `node quality/gate.mjs check` |

---

## Verified library API

Read from the published package on 2026-10-17 (`npm pack chessground` -> `chessground-9.2.1.tgz`, `dist/*.d.ts`, `src/*.ts`, `assets/`), not from memory. Pin it exactly: `chessground@9.2.1`.

- **Version and licence:** 9.2.1 is `latest` (last publish 2025-10-05). `"license": "GPL-3.0-or-later"`; the README says a site using it may be distributed only under the GPL and must release its source to its users (R-97: the repository stays public). No dependencies. ESM only (`"type": "module"`).
- **Entry points** (`package.json` `exports`): `chessground` -> `dist/chessground.js` (types beside it); `chessground/<name>` -> `dist/<name>.js` (so types import as `chessground/api`, `chessground/config`, `chessground/types`, `chessground/draw`); `chessground/assets/*` -> the CSS files.
- **Constructor:** `Chessground(element: HTMLElement, config?: Config): Api`. It adds the class `cg-wrap` to `element` and renders inside it. `defaults()` reads `window` (`'ontouchstart' in window`), so it must only run in the browser; no module touches `window` or `document` at import time, so importing it in a client component that is also server-rendered is safe.
- **`Api`:** `set(config: Config): void`, `state: State`, `getFen(): FEN`, `toggleOrientation()`, `move(orig, dest)`, `setPieces(diff)`, `selectSquare(key: Key | null, force?: boolean)`, `newPiece`, `playPremove`, `cancelPremove`, `cancelMove()`, `stop()`, `explode`, `setShapes(shapes: DrawShape[])`, `setAutoShapes(shapes: DrawShape[])`, `getKeyAtDomPos(pos)`, `redrawAll()`, `dragNewPiece`, `destroy(): void` (unbinds the document listeners; call it on unmount).
- **`Config` fields we use:** `fen?: string`, `orientation?: 'white' | 'black'`, `turnColor?: 'white' | 'black'`, `check?: Color | boolean`, `lastMove?: Key[]`, `coordinates?: boolean`, `highlight?: { lastMove?: boolean; check?: boolean; custom?: Map<Key, string> }` (custom adds the class to that square), `animation?: { enabled?: boolean; duration?: number }`, `movable?: { free?: boolean; color?: Color | 'both'; dests?: Map<Key, Key[]>; showDests?: boolean; events?: { after?: (orig: Key, dest: Key, metadata: MoveMetadata) => void }; rookCastle?: boolean }`, `premovable?: { enabled?: boolean }`, `draggable?: { enabled?: boolean; showGhost?: boolean }`, `selectable?: { enabled?: boolean }`, `events?: { select?: (key: Key) => void; move?: ... ; change?: () => void }`, `drawable?: { enabled?: boolean; visible?: boolean; eraseOnClick?: boolean; defaultSnapToValidMove?: boolean; shapes?: DrawShape[]; autoShapes?: DrawShape[]; onChange?: (shapes: DrawShape[]) => void }`, `viewOnly?: boolean`.
- **Defaults that bite:** `movable.free` is **true** and `movable.color` is `'both'` (any piece anywhere): always set `free: false`. `premovable.enabled` is true: set it false. `drawable.eraseOnClick` is true (a left click clears the user's shapes): set it false in the builder. `viewOnly` binds no listeners at mount and is not re-read by `set`, so never toggle it; to stop moves, pass an empty `dests` map (`free: false` then refuses every move).
- **`set` semantics** (`config.ts` `configure`): a passed `movable.dests` and `drawable.autoShapes` replace the old ones; a passed `fen` replaces the pieces **and resets `drawable.shapes` to the passed shapes or `[]`**; `lastMove: []` clears the highlight (passing `undefined` is impossible under `exactOptionalPropertyTypes`, and `[]` works).
- **Events are asynchronous:** `callUserFunction` runs every user callback in `setTimeout(..., 1)`. `movable.events.after` fires after a legal user move (drag or tap-tap or `selectSquare` pairs); `events.select` fires on every square press (`drag.start` -> `selectSquare`) and on `api.selectSquare(key)`.
- **Only trusted input moves pieces:** `drag.start` returns unless `e.isTrusted` (or `trustAllEvents`). Synthetic DOM events in jsdom do nothing, so component tests mock the `chessground` module; Playwright's mouse and touchscreen events are trusted.
- **Drawing:** a shape is drawn by right-button drag, or left button with Shift; brush by modifier (none: green; Shift/Ctrl + right: red; Alt/Meta: blue; both: yellow). There is no touch drawing, so phones need our own draw mode (Task 13). Brushes `green`, `red`, `blue`, `yellow` exist by default. `DrawShape` is `{ orig: Key; dest?: Key; brush?: string; ... }` (no `dest` = a circle). `addShape` toggles a shape drawn twice. `onChange` fires only for user drawing, never for `set`.
- **Castling:** `autoCastle` (default true) moves the rook when the king lands on g1/c1; chess.js gives the king's two-square move as the dest, which is what we pass.
- **CSS:** `chessground/assets/chessground.base.css` (layout: `.cg-wrap`, `cg-container`, `cg-board`, `square`, `piece`, coords) is required. `chessground.brown.css` colours the board and squares with fixed hex values, so we do not import it (tokens rule, `docs/design/README.md`); `apps/web/src/app/board/board.css` styles the same selectors (`cg-board`, `square.last-move`, `square.selected`, `square.move-dest`, `square.move-dest.oc`, `square.check`) with the board tokens. `chessground.cburnett.css` holds the piece images (embedded SVG) and is imported.
- **Legal destinations:** chess.js 1.4.0 `new Chess(fen).moves({ verbose: true })` returns `Move[]` with `from`, `to` (squares), `san`, `promotion?: PieceSymbol`; `inCheck()` says whether the side to move is in check. `@mychess/chess` wraps these (Task 5) so `apps/web` never imports chess.js.
- **React 19 / Next 16:** a client component (`'use client'`) creates the board in `useEffect` on a `ref`'d `<div>` and calls `api.destroy()` in the cleanup; React's Strict Mode (on: `reactStrictMode: true`) mounts, cleans up and mounts again in development, which this handles. A second effect calls `api.set(config)` when the memoised config changes. Callbacks are wrapped with `useEffectEvent` (exported by React 19.3.0, known to `eslint-plugin-react-hooks` 7.1.1), so the board is created once and still calls the latest handler. App Router allows importing a package's global CSS from any component (`next/dist/docs/01-app/01-getting-started/*css*`: "Global styles can be imported into any layout, page, or component"). Server actions accept 1 MB by default; `experimental.serverActions.bodySizeLimit` raises it (`next/dist/server/config-shared.d.ts`, Next 16.3.6).

---

## Decisions taken while planning

None of these is a product rule; the ones marked **(owner)** are put to the owner in Task 1 and the plan proceeds with the stated default meanwhile.

1. **Routes.** `/repertuarai` (Mano repertuarai: the list and "new repertoire"), `/repertuarai/[id]` (one repertoire: browse and builder on one page; the builder is a client mode, not a route), `/repertuarai/importuoti` (the import flow; `?i=<id>` preselects "add to this repertoire"). Lithuanian page paths follow `/prisijungti`, `/pradzia`, `/nustatymai`; the import page takes the verb, as `/prisijungti` does and as the glossary's **importuoti** does ("importas" reads as trade imports). The download is `/api/repertoires/[id]/export`, beside S1's `/api/account/export` (API paths stay English). All in `ROUTES`.
2. **Comments are stored in the form PGN carries** (owner, as confirmation): one paragraph, whitespace collapsed, no `}` and no embedded `[%...]` command. `normalizeComment` in chess does this; `editComment` and the domain's `commentSchema` apply it. Without it a comment with a line break or a `}` would not survive export and re-import, which the spec requires.
3. **One file, one comment per move:** when two games of one upload carry a comment on the same move, the first is kept (the same "existing wins" rule the spec gives `mergeInto`). Several comments after one move inside one game are joined with a space. Marks inside one file still merge as in S2.
4. **The 2,000-character limit is for typed comments and notes.** Imported comments are kept whole (the 2 MB upload cap bounds them); the database reads comments with a plain string schema.
5. **`mergeInto(existing, imported)` takes the `ImportedRepertoire`**, which gains `games` (chapter id -> 1-based game number), so a move the existing repertoire already answers differently (R-54) is reported like an in-file second answer: `{ game, reason: 'pgn.secondAnswer', san, move }`, and it and the moves only it reached are left out. Imported "Chapter N" names are renumbered to follow the existing chapters. Chapter ids continue the existing ones (`c<n>`).
6. **Add-to-existing is previewed against the chosen repertoire** before confirming: the preview carries that repertoire's version, and the confirm refuses a stale one (`repertoire.stale`). `importIntoRepertoire` in the spec is realised as `saveRepertoireEdit(before = current graph, after = merged graph)`, one transaction; `createRepertoire` writes the whole graph through the same diff writer from an empty graph, one transaction.
7. **Builder chapters:** chess gains `addChapter` (from the standard start position, named "Chapter N") and `renameChapter` (a custom name). A built chapter is not named from the taxonomy automatically; R-63 names imported games. **(owner)**
8. **`editComment(graph, moveKey, text)`** as the spec writes it: a comment belongs to the move, which all its chapters share; `setMarks` stays per chapter as in S2.
9. **Storage identities:** `repertoires.id` is a uuid; a chapter keeps the graph's id (`c1`, ...), unique within its repertoire (composite key); a move row has a uuid and is unique on (repertoire, from key, san). `ord` columns keep insertion order, which decides the main line (R-79). A move's chapters are a set; loading orders them by chapter order.
10. **Version:** graph edits (moves, chapters, comments, marks, imports) bump `version`; renaming the repertoire does not.
11. **Personal notes are keyed by move key** without a foreign key to the move row: a removed move's note stays and shows again if the move comes back, like dormant review state (R-44). Notes go with their repertoire and their account.
12. **Access:** a missing repertoire and another account's repertoire give the same refusal, `repertoire.notFound` (404 on pages and routes), so ids reveal nothing. Queries also filter by owner (CLAUDE.md: decided in the domain, enforced again in queries).
13. **The PGN download needs no fresh session.** R-95 covers the full data export; security-reviewer confirms in Task 22.
14. **Export names chapters by their display name in the account's language** (`exportPgn(graph, { title })`); the data export does the same. Re-import still classifies by moves first (R-63), so names do not affect the tree.
15. **Upload transport:** the browser reads the file and posts its text to a server action; `bodySizeLimit` is raised to `3mb` (2 MB of PGN plus form overhead). The server re-checks every R-66 limit through `importPgn`.
16. **Board styling** uses the board tokens; pieces are chessground's cburnett set. Touch and keyboard drawing use a "draw" mode in the builder (tap or Enter a square, then another: an arrow; the same square twice: a circle), because chessground draws only with the mouse.
17. **Client bundle:** the client imports `@mychess/chess` for legal moves, walks and the remove preview. `packages/chess/package.json` gets `"sideEffects": false` so the bundler can drop the ECO tables, and the client never calls `classify`/`chapterName`: the page passes the ECO names it needs.
18. **A new, empty repertoire opens in builder mode.** The remove-move and delete-chapter confirmations sit in the panel, never over the board (`docs/design/training-screen.md`: nothing overlays the board). Deleting a repertoire is a two-step confirm without typing its name.
19. **Import summary numbers** (`summarize` in chess): chapters; lines = line ends per chapter (a move whose position has no further move in that chapter); positions = distinct positions; transpositions = positions reached by two or more moves; moves.
20. **Licence (R-97)** **(owner):** the repository has no `LICENSE` file and no `license` field. Chessground is GPL-3.0-or-later; the lead adds the licence the owner picks (Task 1) before the board lands on `main`.
21. **Account deletion** now also removes repertoires; the delete section's "what will be deleted" list (R-82) gains an item, and the S1 data export gains `repertoires` (PGN per repertoire) and `personalNotes`.

## File structure

| File | Responsibility |
| --- | --- |
| `packages/chess/src/repertoire/graph.ts` | `RepertoireMove.comment`; `nextChapterId`, `nextChapterNumber` |
| `packages/chess/src/repertoire/moves.ts` | `DraftMove.comment` |
| `packages/chess/src/repertoire/comment.ts` | `normalizeComment` |
| `packages/chess/src/repertoire/edit.ts` | + `editComment`, `removeChapter`, `addChapter`, `renameChapter` |
| `packages/chess/src/repertoire/merge.ts` | `mergeInto`, `MergedRepertoire`, `MergeRefusal` |
| `packages/chess/src/repertoire/summary.ts` | `summarize`, `RepertoireSummary` |
| `packages/chess/src/repertoire/walk.ts` | + `chapterChildren`, `chapterTree` |
| `packages/chess/src/repertoire/schema.ts` | zod: `sideSchema`, `arrowSchema`, `circleSchema`, `marksInputSchema`, `chapterNameSourceSchema` |
| `packages/chess/src/legal-moves.ts` | `legalMoves`, `findLegalMove`, `inCheck`, `BoardMove` |
| `packages/chess/src/pgn/replay.ts`, `import-pgn.ts`, `export-pgn.ts` | comments in and out; `games`; `title` option |
| `packages/domain/src/repertoire.ts` | name/comment/note schemas, `repertoireSchema`, refusals, `canViewRepertoire`, `canEditRepertoire` |
| `packages/db/src/schema.ts` | tables `repertoires`, `chapters`, `repertoireMoves`, `moveChapters`, `personalNotes` |
| `packages/db/migrations/0002_*.sql` | generated |
| `packages/db/src/repertoires/diff.ts` | `diffRepertoire` (pure) |
| `packages/db/src/repertoires/rows.ts` | row schemas, `graphOf` |
| `packages/db/src/repertoires/write.ts` | `writeDiff` |
| `packages/db/src/repertoires/repository.ts` | `createRepertoire`, `loadRepertoire`, `listRepertoires`, `renameRepertoire`, `deleteRepertoire`, `saveRepertoireEdit` |
| `packages/db/src/personal-notes.ts` | `setPersonalNote`, `listPersonalNotes` |
| `packages/db/src/accounts.ts` | `exportAccount` + repertoires and notes |
| `docs/design/repertoire-screen.md` | the screen note (ux-designer) |
| `apps/web/src/app/board/*` | `Board` (chessground wrapper), `board-config.ts`, `squares.ts`, `shapes.ts`, `cursor.ts`, `move-input.tsx`, `promotion-picker.tsx`, `board.css` |
| `apps/web/src/server/repertoires.ts` | `ownRepertoire` (load + access) |
| `apps/web/src/server/repertoire-edit.ts` | `editRequestSchema`, `applyEdit` |
| `apps/web/src/server/chapter-names.ts` | `chapterTitle`, `ecoNamesOf` |
| `apps/web/src/server/pgn-download.ts` | `pgnFileName`, `pgnResponse` |
| `apps/web/src/app/repertuarai/` | list page, create form, actions |
| `apps/web/src/app/repertuarai/[id]/` | page, `repertoire-screen.tsx`, `screen-state.ts`, panels, actions |
| `apps/web/src/app/repertuarai/importuoti/` | page, `import-flow.tsx`, actions |
| `apps/web/src/app/api/repertoires/[id]/export/route.ts` | the PGN download |
| `apps/web/test/feature/repertoire-*.test.ts` | feature tests |
| `apps/web/e2e/repertoires.spec.ts`, `e2e/support/board.ts`, `e2e/fixtures/taimanov.pgn` | E2E |

Order: Tasks 2 to 5 (chess) first; Task 6 (domain) needs Task 2's `normalizeComment` and Task 5's `sideSchema`; Tasks 7 to 10 (db) need 2 to 6; Task 11 (screen note) can run beside the chess and db tasks; Tasks 12 to 19 (web) need everything before; 20 to 24 close the slice.

---

### Task 1: Owner questions, licence and the domain term (lead)

**Files:** `LICENSE` (new, as the owner picks), `package.json` and each workspace `package.json` (`"license"`), `docs/CONTEXT.md`, `docs/owner-rulings.md`.

- [ ] **Step 1:** Put to the owner, one at a time, and record each answer as the next R-number in `docs/owner-rulings.md`:
  1. **Licence (R-97):** chessground is GPL-3.0-or-later. Which licence goes in `LICENSE`: GPL-3.0-or-later for the whole repository (simplest), or another GPL-compatible one? Until answered, the board task (Task 13) may be built but not pushed.
  2. **Comment form (decision 2):** comments are one paragraph (line breaks become spaces) so PGN export and re-import give the same text. Acceptable?
  3. **Built chapters (decision 7):** a chapter made in the builder is "Skyrius N" until renamed. Should it instead take its opening name from the taxonomy as moves are added?
  4. **"Comment" in Lithuanian:** R-102 makes move comments part of the repertoire, but the glossary keeps **komentaras** for comment threads (`docs/glossary-lt.md`, Personal note row). i18n-content proposes the word in Task 20; the owner approves it.
  5. **Persona seeds (R-32):** the personas' own repertoires (Rokas's London, Gabija's Taimanov) are not in the S3 spec as staging seeds. File a follow-up issue, or add them to S3?
- [ ] **Step 2:** Add the licence file and the `"license"` field to the root and each workspace `package.json` as answered.
- [ ] **Step 3:** With the `domain-modeling` skill, add **Comment** to `docs/CONTEXT.md` under Repertoires: "Text on a Move of a Repertoire, from PGN or written in the builder; it belongs to the Repertoire, is exported with it and is seen by whoever may see the Repertoire (R-102). On a Coach's Repertoire it is a Coach note. _Avoid_: annotation, note (a Personal note is private)". Adjust the Personal note and Coach note "Avoid" lines so they no longer say "a Comment is a Thread" (a move comment thread stays a Thread).

### Task 2: Move comments through PGN (chess-dev)

**Files:** Modify `packages/chess/src/repertoire/graph.ts`, `repertoire/moves.ts`, `pgn/replay.ts`, `pgn/import-pgn.ts`, `pgn/export-pgn.ts`, `src/index.ts`, `pgn/import-pgn.test.ts`, `pgn/export-pgn.test.ts`, and every test that builds a `RepertoireMove` literal (the typecheck lists them). Create `repertoire/comment.ts`, `repertoire/comment.test.ts`.

- [ ] **Step 1: Write the failing tests.** `repertoire/comment.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { normalizeComment } from './comment';

describe('normalizeComment', () => {
  it.each([
    ['  Best   by\ntest ', 'Best by test'],
    ['Close } early', 'Close early'],
    ['Plan [%cal Ge2e4] here', 'Plan here'],
    ['Kodėl ne 5...Qc7?', 'Kodėl ne 5...Qc7?'],
  ])('keeps %j as %j, the text PGN carries', (typed, kept) => {
    expect(normalizeComment(typed)).toBe(kept);
  });

  it.each([[''], ['   '], ['}'], ['[%csl Gd4]']])('makes %j no comment', (typed) => {
    expect(normalizeComment(typed)).toBeNull();
  });
});
```

Add to `pgn/import-pgn.test.ts` (inside the existing top-level `describe`):

```ts
describe('move comments (R-102)', () => {
  const commentOf = (text: string, san: string) =>
    must(imported(text).graph.moves.find((m) => m.san === san)).comment;

  it('keeps the comment after a move, without its marks', () => {
    const text = '1. e4 { Best by test } e5 { Solid [%cal Gg1f3] } 2. Nf3 *';
    expect(commentOf(text, 'e4')).toBe('Best by test');
    expect(commentOf(text, 'e5')).toBe('Solid');
    expect(commentOf(text, 'Nf3')).toBeNull();
  });

  it('joins several comments after one move', () => {
    expect(commentOf('1. e4 { Best } { by test } *', 'e4')).toBe('Best by test');
  });

  it('gives a variation move its comment', () => {
    expect(commentOf('1. e4 e5 (1... c5 { Sicilian }) 2. Nf3 *', 'c5')).toBe('Sicilian');
  });

  it('keeps the chapter intro apart from the first move comment', () => {
    const { graph } = imported('{ Intro } 1. e4 { After } *');
    expect(must(graph.chapters[0]).intro).toBe('Intro');
    expect(must(graph.moves[0]).comment).toBe('After');
  });

  it('keeps the first comment when two games share a move (decision 3)', () => {
    const text = '[Event "A"]\n\n1. e4 { first } e5 *\n\n[Event "B"]\n\n1. e4 { second } c5 *';
    expect(commentOf(text, 'e4')).toBe('first');
  });

  it('names the game of each chapter', () => {
    const r = imported('[Event "A"]\n\n1. e4 *\n\n[Event "B"]\n\n1. e4 Qxe2 *\n\n[Event "C"]\n\n1. d4 *');
    expect(r.games).toEqual({ c1: 1, c2: 3 });
  });
});
```

Add to `pgn/export-pgn.test.ts`:

```ts
it('writes a comment before the marks in one brace comment', () => {
  const graph = graphOf('1. e4 { Best [%cal Gg1f3] } e5 { Solid } *');
  expect(exportPgn(graph)).toContain('1. e4 { Best [%cal Gg1f3] } e5 { Solid } *');
});

it('names chapters through the title option', () => {
  const graph = graphOf('1. e4 e5 *');
  expect(exportPgn(graph, { title: () => 'Atvirasis debiutas' })).toContain(
    '[Event "Atvirasis debiutas"]',
  );
});
```

In the same file, extend both round-trip properties to cover comments:
  - `normalise` and `canonical` include `m.comment` in the JSON tuple.
  - In `round-trips random branching repertoires with marks`, after `setMarks`, when `mark` is 1, 3 or 5, apply `editComment(graph, moveKey(from, move.san), COMMENTS[mark % 3])` (import `editComment` from `../repertoire/edit` and `moveKey` from `../repertoire/graph`) with `const COMMENTS = ['Idea: d4', 'Kodėl ne?', 'Plan { braces } [%cal Ge2e4] gone'] as const;`. `editComment` arrives in Task 3: until then, write the comment directly (`graph = { ...graph, moves: graph.moves.map((m) => m.from === from && m.san === move.san ? { ...m, comment: normalizeComment(text) } : m) }`) and switch to `editComment` in Task 3.

- [ ] **Step 2:** `pnpm --filter @mychess/chess test`. Expected: FAIL (`./comment` not found; `comment` missing on moves; `games` undefined).
- [ ] **Step 3: Implement.** `repertoire/comment.ts`:

```ts
/**
 * A move comment in the one form PGN carries unchanged (decision 2): one
 * paragraph, whitespace collapsed, no `}` (it would end the brace comment)
 * and no embedded `[%...]` command (it would come back as marks). What
 * export writes is then exactly what import reads back.
 */
import { parseMarks } from '../pgn/marks';

export function normalizeComment(text: string): string | null {
  const kept = parseMarks(text.replace(/\}/g, ' ')).text;
  return kept === '' ? null : kept;
}
```

`repertoire/graph.ts`: add to `RepertoireMove` (after `circles`):

```ts
  /** The move's comment (R-102): part of the repertoire, exported with it. */
  readonly comment: string | null;
```

`repertoire/moves.ts`: `DraftMove` gains a mutable `comment: string | null;` (no `readonly`, so the import and the merge can set it once); `draftOf` takes `Pick<RepertoireMove, 'arrows' | 'circles' | 'chapters' | 'comment'>` and copies `comment: rest.comment`; the new-move draft in `put` passes `comment: null`.

`pgn/replay.ts`: a move's pending annotation now carries text.

```ts
/** What PGN comments add to a move: arrows, circles and prose. */
interface Annotation extends Marks {
  readonly comment: string | null;
}

const noAnnotation: Annotation = { arrows: [], circles: [], comment: null };

/** `kept` and `more` joined by a space; blank text adds nothing. */
const joinText = (kept: string | null, more: string): string | null =>
  more === '' ? kept : kept === null ? more : `${kept} ${more}`;

/** `target` with a comment's marks and prose added. */
const annotated = <T extends Annotation>(target: T, add: CommentMarks): T => ({
  ...target,
  arrows: [...target.arrows, ...add.arrows],
  circles: [...target.circles, ...add.circles],
  comment: joinText(target.comment, add.text),
});
```

  - `ReplayedMove extends Annotation` (was `Marks`); `Branch.pending: Annotation`; `newBranch` and `play` reset `pending` to `noAnnotation`; `annotate(marks: CommentMarks)` uses `annotated` in both branches; `withMarks` and `noMarks` go. Update the class comment: "The marks and prose of a comment attach to the move it follows, or to the branch's first move when it comes before it. Comments before the game's first move are its intro instead; marks there have no move and are dropped. NAGs are not kept."

`pgn/import-pgn.ts`:
  - `ImportedRepertoire` gains `readonly games: Readonly<Record<string, number>>;` with the doc comment "Each chapter's game: its 1-based number among the file's games (R-64)."
  - `RepertoireBuilder` gains `readonly games: Record<string, number> = {};`; `addGame` sets `this.games[chapter.id] = game.game` when it pushes the chapter; `build` returns `{ graph: builder.freeze(), skipped: builder.skipped, games: builder.games }`.
  - In `put`, after the two `addMarks` calls: `put.value.comment ??= move.comment;` (decision 3: the first comment stays).

`pgn/export-pgn.ts`:

```ts
/** A move's comment and marks as one brace comment, or nothing. */
function annotation(move: RepertoireMove): string[] {
  const parts = [
    ...(move.comment === null ? [] : [move.comment]),
    ...(move.arrows.length > 0
      ? [`[%cal ${move.arrows.map((a) => a.color + a.from + a.to).join(',')}]`]
      : []),
    ...(move.circles.length > 0
      ? [`[%csl ${move.circles.map((c) => c.color + c.square).join(',')}]`]
      : []),
  ];
  return parts.length > 0 ? [comment(parts.join(' '))] : [];
}

/** How export names a chapter's game; the default is the name source itself. */
export interface ExportOptions {
  readonly title?: (chapter: Chapter) => string;
}
```

  - `moveText` returns `[san, ...annotation(move)]` (the old `marks` function goes).
  - `headers(chapter, title)` writes `[Event "${tagValue(title(chapter))}"]`; `game(walk, chapter, title)` passes it on; `exportPgn(graph: RepertoireGraph, options: ExportOptions = {})` uses `options.title ?? chapterName`. Update the file's doc comment: "...with its intro before the first move, each move's comment and its arrows and circles in one brace comment, ...".

`src/index.ts`: export `normalizeComment` and `type ExportOptions`.

- [ ] **Step 4:** Fix every `RepertoireMove` literal the typecheck reports (`pnpm --filter @mychess/chess typecheck`) by adding `comment: null`. Keep the assertions.
- [ ] **Step 5:** `pnpm --filter @mychess/chess test`. Expected: PASS, including both round-trip properties with comments.
- [ ] **Step 6:** `node quality/gate.mjs check`. Expected: PASS.

### Task 3: Builder edits: comment, chapters (chess-dev)

**Files:** Modify `packages/chess/src/repertoire/edit.ts`, `repertoire/graph.ts`, `repertoire/edit.test.ts`, `src/index.ts`, `pgn/export-pgn.test.ts` (switch the property to `editComment`).

- [ ] **Step 1: Write the failing tests** in `edit.test.ts` (reuse its `build`, `withC2`, `mustAdd`, `START`, `chapter` helpers):

```ts
describe('editComment', () => {
  const g = build('e4', 'e5');
  const e4 = moveKey(START, 'e4');

  it('sets a move comment in the form PGN carries', () => {
    const edited = mustAdd(editComment(g, e4, '  Best\nby test '));
    expect(edited.moves.find((m) => m.san === 'e4')?.comment).toBe('Best by test');
    expect(edited.moves.find((m) => m.san === 'e5')).toBe(g.moves.find((m) => m.san === 'e5'));
  });

  it('clears the comment with blank text', () => {
    const commented = mustAdd(editComment(g, e4, 'Best'));
    expect(mustAdd(editComment(commented, e4, '  ')).moves[0]?.comment).toBeNull();
  });

  it('refuses a move the repertoire does not have', () => {
    expect(editComment(g, moveKey(START, 'd4'), 'x')).toEqual({
      ok: false,
      refusal: { reason: 'repertoire.unknownMove' },
    });
  });
});

describe('removeChapter', () => {
  it('removes the chapter and the moves only it used', () => {
    let g = withC2(build('e4', 'e5', 'Nf3'));
    g = mustAdd(addMove(g, 'c2', START, 'e4'));
    const after = mustAdd(removeChapter(g, 'c1'));
    expect(after.chapters.map((c) => c.id)).toEqual(['c2']);
    expect(after.moves.map((m) => [m.san, m.chapters])).toEqual([['e4', ['c2']]]);
  });

  it('refuses an unknown chapter', () => {
    expect(removeChapter(build('e4'), 'c9')).toEqual(unknownChapter);
  });
});

describe('addChapter', () => {
  it('adds an empty chapter from a position with the next free id and number', () => {
    const { graph, chapterId } = addChapter(withC2(empty), START);
    expect(chapterId).toBe('c3');
    expect(graph.chapters.at(-1)).toEqual({
      id: 'c3',
      rootKey: START,
      intro: null,
      nameSource: { kind: 'index', number: 3 },
    });
  });

  it('never repeats a number after a chapter was removed', () => {
    const g = mustAdd(removeChapter(withC2(empty), 'c1'));
    expect(addChapter(g, START).graph.chapters.at(-1)?.nameSource).toEqual({
      kind: 'index',
      number: 3,
    });
  });
});

describe('renameChapter', () => {
  it('gives the chapter a custom name', () => {
    const g = mustAdd(renameChapter(empty, 'c1', 'Londono sistema'));
    expect(g.chapters[0]?.nameSource).toEqual({ kind: 'custom', name: 'Londono sistema' });
  });

  it('refuses an unknown chapter', () => {
    expect(renameChapter(empty, 'c9', 'x')).toEqual(unknownChapter);
  });
});
```

Add `import { moveKey } from './graph';` and the four new functions to the test's imports.

- [ ] **Step 2:** `pnpm --filter @mychess/chess test`. Expected: FAIL (functions not exported).
- [ ] **Step 3: Implement.** `graph.ts`:

```ts
const CHAPTER_ID = /^c(\d+)$/;

/** A chapter id no chapter of `chapters` has: `c` and the next number. */
export function nextChapterId(chapters: readonly Pick<Chapter, 'id'>[]): string {
  const used = chapters.map((c) => Number(CHAPTER_ID.exec(c.id)?.[1] ?? 0));
  return `c${String(Math.max(0, ...used) + 1)}`;
}

/** The number a new "Chapter N" takes: past every chapter and every number used. */
export function nextChapterNumber(chapters: readonly Chapter[]): number {
  const numbers = chapters.flatMap((c) =>
    c.nameSource.kind === 'index' ? [c.nameSource.number] : [],
  );
  return Math.max(chapters.length, ...numbers) + 1;
}
```

`edit.ts` (beside `setMarks`; reuse `refuse`, `withoutChapter`, `EditResult`):

```ts
/**
 * Sets the comment of a move (R-102), in the form PGN carries
 * (`normalizeComment`); blank text removes it. The comment belongs to the
 * move, so every chapter holding the move shows it.
 */
export function editComment(
  graph: RepertoireGraph,
  key: string,
  text: string,
): EditResult {
  const target = graph.moves.find((m) => moveKey(m.from, m.san) === key);
  if (target === undefined) return refuse('repertoire.unknownMove');
  const comment = normalizeComment(text);
  const moves = graph.moves.map((m) => (m === target ? { ...m, comment } : m));
  return { ok: true, value: { ...graph, moves } };
}

/**
 * Removes a chapter and every move only it used. A move another chapter
 * holds stays; that chapter's moves are still reachable from its own root.
 */
export function removeChapter(
  graph: RepertoireGraph,
  chapterId: string,
): EditResult {
  if (chapterOf(graph, chapterId) === undefined)
    return refuse('repertoire.unknownChapter');
  const moves = graph.moves
    .map((m) => (m.chapters.includes(chapterId) ? withoutChapter(m, chapterId) : m))
    .filter((m) => m.chapters.length > 0);
  const chapters = graph.chapters.filter((c) => c.id !== chapterId);
  return { ok: true, value: { ...graph, chapters, moves } };
}

/** Adds an empty chapter starting at `rootKey`, named "Chapter N" (decision 7). */
export function addChapter(
  graph: RepertoireGraph,
  rootKey: string,
): { readonly graph: RepertoireGraph; readonly chapterId: string } {
  const chapterId = nextChapterId(graph.chapters);
  const chapter: Chapter = {
    id: chapterId,
    rootKey,
    intro: null,
    nameSource: { kind: 'index', number: nextChapterNumber(graph.chapters) },
  };
  return { graph: { ...graph, chapters: [...graph.chapters, chapter] }, chapterId };
}

/** Names a chapter as its owner typed it; the domain checked the name. */
export function renameChapter(
  graph: RepertoireGraph,
  chapterId: string,
  name: string,
): EditResult {
  if (chapterOf(graph, chapterId) === undefined)
    return refuse('repertoire.unknownChapter');
  const chapters = graph.chapters.map((c) =>
    c.id === chapterId ? { ...c, nameSource: { kind: 'custom', name } as const } : c,
  );
  return { ok: true, value: { ...graph, chapters } };
}
```

Imports to add in `edit.ts`: `moveKey`, `nextChapterId`, `nextChapterNumber` from `./graph`; `normalizeComment` from `./comment`. `src/index.ts`: export `addChapter`, `editComment`, `removeChapter`, `renameChapter` (`nextChapterId` and `nextChapterNumber` stay internal: knip flags an export nobody imports).

- [ ] **Step 4:** In `export-pgn.test.ts`, replace the direct comment write of Task 2 with `editComment`.
- [ ] **Step 5:** `pnpm --filter @mychess/chess test`, then `node quality/gate.mjs check`. Expected: PASS.

### Task 4: `mergeInto` (chess-dev)

**Files:** Create `packages/chess/src/repertoire/merge.ts`, `repertoire/merge.test.ts`. Modify `repertoire/walk.ts` (export `chapterChildren`), `src/index.ts`.

- [ ] **Step 1: Write the failing tests** `merge.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { imported, must, START } from '../pgn/test-support';
import { lines, mainLine } from './walk';
import { mergeInto } from './merge';
import type { RepertoireGraph } from './graph';

const graphOf = (text: string, side: 'white' | 'black' = 'white') =>
  imported(text, side).graph;

function merged(existing: RepertoireGraph, text: string, side: 'white' | 'black' = 'white') {
  const r = mergeInto(existing, imported(text, side));
  if (!r.ok) throw new Error(r.refusal.reason);
  return r.value;
}

describe('mergeInto (R-101)', () => {
  it('adds the imported games as new chapters after the existing ones', () => {
    const existing = graphOf('[Event "Italian"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bc4 *');
    const { graph, skipped } = merged(existing, '[Event "Scotch"]\n\n1. e4 e5 2. Nf3 Nc6 3. d4 *');
    expect(skipped).toEqual([]);
    expect(graph.chapters.map((c) => c.id)).toEqual(['c1', 'c2']);
    expect(lines(graph, 'c2').map((l) => l.map((m) => m.san))).toEqual([
      ['e4', 'e5', 'Nf3', 'Nc6', 'd4'],
    ]);
  });

  it('merges positions: a shared move is stored once and gains the new chapter', () => {
    const existing = graphOf('1. e4 e5 2. Nf3 *');
    const { graph } = merged(existing, '1. e4 e5 2. Nf3 Nc6 *');
    const e4 = must(graph.moves.find((m) => m.san === 'e4'));
    expect(e4.chapters).toEqual(['c1', 'c2']);
    expect(graph.moves).toHaveLength(4);
  });

  it('merges a transposition into the existing position', () => {
    const existing = graphOf('1. d4 Nf6 2. c4 e6 *', 'black');
    const { graph } = merged(existing, '1. c4 e6 2. d4 Nf6 *', 'black');
    const keys = new Set(graph.moves.map((m) => m.to));
    expect(keys.size).toBe(graph.moves.length - 1);
  });

  it('keeps the existing comment and marks, and fills in what the existing move lacks', () => {
    const existing = graphOf('1. e4 { Mine [%cal Gg1f3] } e5 *');
    const { graph } = merged(existing, '1. e4 { Theirs [%cal Rd2d4] } e5 { New } *');
    const e4 = must(graph.moves.find((m) => m.san === 'e4'));
    expect([e4.comment, e4.arrows]).toEqual(['Mine', [{ from: 'g1', to: 'f3', color: 'G' }]]);
    expect(graph.moves.find((m) => m.san === 'e5')?.comment).toBe('New');
  });

  it('leaves out a second answer with the moves only it reached, naming the game and move (R-54)', () => {
    const existing = graphOf('1. e4 e5 2. Nf3 *');
    const r = merged(existing, '[Event "A"]\n\n1. e4 e5 2. Bc4 Nf6 3. d3 *\n\n[Event "B"]\n\n1. d4 d5 *');
    expect(r.skipped).toEqual([{ game: 1, reason: 'pgn.secondAnswer', san: 'Bc4', move: 2 }]);
    expect(r.graph.moves.some((m) => m.san === 'Nf6')).toBe(false);
    // Game A kept 1. e4 e5, so it is a chapter; game B is the next.
    expect(r.graph.chapters.map((c) => c.id)).toEqual(['c1', 'c2', 'c3']);
  });

  it('keeps the existing main line at a shared position (R-79)', () => {
    const existing = graphOf('1. e4 e5 2. Nf3 *');
    const { graph } = merged(existing, '1. e4 c5 2. Nf3 *');
    expect(mainLine(graph, 'c1').map((m) => m.san)).toEqual(['e4', 'e5', 'Nf3']);
  });

  it('numbers imported untitled chapters after the existing chapters', () => {
    const existing = graphOf('1. a3 *');
    const { graph } = merged(existing, '1. a3 a6 2. h3 *');
    expect(graph.chapters.map((c) => c.nameSource)).toEqual([
      { kind: 'index', number: 1 },
      { kind: 'index', number: 2 },
    ]);
  });

  it('refuses a repertoire of the other side', () => {
    expect(mergeInto(graphOf('1. e4 *'), imported('1. e4 *', 'black'))).toEqual({
      ok: false,
      refusal: { reason: 'repertoire.sideMismatch' },
    });
  });

  it('does not change the existing graph', () => {
    const existing = graphOf('1. e4 e5 *');
    const before = JSON.stringify(existing);
    merged(existing, '1. e4 { x } c5 *');
    expect(JSON.stringify(existing)).toBe(before);
  });
});
```

Add a property test in the same file: for random legal lines (reuse the `line` arbitrary pattern of `export-pgn.test.ts`), `mergeInto(graphOf(pgnA), imported(pgnB))` gives a graph whose moves are exactly the union of the moves of A and of B (by `from|san`) minus the skipped ones and the moves only they reached, and every chapter's moves are reachable from its root (`lines(graph, c.id).flat()` covers every move holding `c.id`). Keep `numRuns: 25`.

- [ ] **Step 2:** `pnpm --filter @mychess/chess test`. Expected: FAIL (`./merge` not found).
- [ ] **Step 3: Implement.** In `walk.ts`, export:

```ts
/**
 * A chapter's children of each position, in insertion order, with the
 * position index built once for the whole repertoire.
 */
export function chapterChildren(
  graph: RepertoireGraph,
): (chapterId: string) => (key: string) => readonly RepertoireMove[] {
  const index = indexByPosition(graph);
  return (chapterId) => childrenIn(index, chapterId);
}
```

`merge.ts`:

```ts
/**
 * Adding an imported repertoire to an existing one of the same side (R-101):
 * each imported chapter becomes a new chapter, and its moves go through the
 * existing repertoire's own move store, so positions merge (a move already
 * there gains the chapter) and the player keeps one answer per position
 * (R-54). The existing repertoire wins: a shared move keeps its comment and
 * marks, and gets the imported ones only where it has none.
 */
import type { ImportedRepertoire, Skipped } from '../pgn/import-pgn';
import { sideToMove } from '../position-key';
import type { Result } from '../result';
import {
  nextChapterId,
  type Chapter,
  type RepertoireGraph,
  type RepertoireMove,
  type Side,
} from './graph';
import { RepertoireMoves, type DraftMove } from './moves';
import { chapterChildren } from './walk';

export interface MergedRepertoire {
  readonly graph: RepertoireGraph;
  /** Imported second answers, left out with every move only they reached. */
  readonly skipped: readonly Skipped[];
}

export interface MergeRefusal {
  readonly reason: 'repertoire.sideMismatch';
}

type Children = (key: string) => readonly RepertoireMove[];

/** A position to take the chapter's moves from, and its half-move count. */
interface Visit {
  readonly key: string;
  readonly ply: number;
}

const firstPly = (rootKey: string): number => (sideToMove(rootKey) === 'b' ? 1 : 0);

/** Gives a stored move the imported comment and marks where it has none. */
function fillIn(draft: DraftMove, imported: RepertoireMove): void {
  draft.comment ??= imported.comment;
  if (draft.arrows.length === 0 && draft.circles.length === 0) {
    draft.arrows.push(...imported.arrows);
    draft.circles.push(...imported.circles);
  }
}

class Merge {
  readonly skipped: Skipped[] = [];
  private readonly side: Side;
  private readonly moves: RepertoireMoves;
  private readonly chapters: Chapter[];

  constructor(existing: RepertoireGraph) {
    this.side = existing.side;
    this.moves = new RepertoireMoves(existing.side, existing.moves);
    this.chapters = [...existing.chapters];
  }

  /**
   * Adds one imported chapter, position by position from its root (each
   * position once, its moves in their imported order), so a refused move's
   * continuation is reached only if another kept move leads there. A
   * chapter none of whose moves fit is not added.
   */
  add(source: Chapter, children: Children, game: number): void {
    const chapter = this.renamed(source);
    const queue: Visit[] = [{ key: source.rootKey, ply: firstPly(source.rootKey) }];
    const seen = new Set([source.rootKey]);
    let kept = 0;
    for (const visit of queue) {
      for (const move of children(visit.key)) {
        if (!this.put(move, chapter.id, game, visit.ply)) continue;
        kept += 1;
        if (seen.has(move.to)) continue;
        seen.add(move.to);
        queue.push({ key: move.to, ply: visit.ply + 1 });
      }
    }
    if (kept > 0) this.chapters.push(chapter);
  }

  result(): MergedRepertoire {
    return {
      graph: { side: this.side, chapters: this.chapters, moves: this.moves.list() },
      skipped: this.skipped,
    };
  }

  /** A new id after the existing chapters; "Chapter N" renumbered to follow them. */
  private renamed(source: Chapter): Chapter {
    const nameSource =
      source.nameSource.kind === 'index'
        ? ({ kind: 'index', number: this.chapters.length + 1 } as const)
        : source.nameSource;
    return { ...source, id: nextChapterId(this.chapters), nameSource };
  }

  private put(move: RepertoireMove, chapterId: string, game: number, ply: number): boolean {
    const put = this.moves.put(move, chapterId);
    if (!put.ok) {
      const number = 1 + Math.floor(ply / 2);
      this.skipped.push({ game, reason: 'pgn.secondAnswer', san: move.san, move: number });
      return false;
    }
    fillIn(put.value, move);
    return true;
  }
}

/** Adds `imported` to `existing` (R-101); `existing` is not changed. */
export function mergeInto(
  existing: RepertoireGraph,
  imported: ImportedRepertoire,
): Result<MergedRepertoire, MergeRefusal> {
  if (existing.side !== imported.graph.side)
    return { ok: false, refusal: { reason: 'repertoire.sideMismatch' } };
  const merge = new Merge(existing);
  const childrenOf = chapterChildren(imported.graph);
  for (const chapter of imported.graph.chapters)
    merge.add(chapter, childrenOf(chapter.id), imported.games[chapter.id] ?? 0);
  return { ok: true, value: merge.result() };
}
```

  `RepertoireMoves`' constructor copies the existing moves (`draftOf`), so `fillIn` never changes `existing`. `for (const visit of queue)` walks the array while it grows: the array iterator re-reads the length each step, so this is a linear breadth-first walk. `src/index.ts`: export `mergeInto`, `type MergedRepertoire`, `type MergeRefusal`.

- [ ] **Step 4:** `pnpm --filter @mychess/chess test`, then `node quality/gate.mjs check`. Expected: PASS.

### Task 5: Summary, board helpers, walks and schemas (chess-dev)

**Files:** Create `packages/chess/src/repertoire/summary.ts`, `summary.test.ts`, `src/legal-moves.ts`, `legal-moves.test.ts`, `repertoire/schema.ts`, `schema.test.ts`. Modify `repertoire/walk.ts` (`chapterTree`), `src/index.ts`, `packages/chess/package.json`.

- [ ] **Step 1: Write the failing tests.** `summary.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { imported } from '../pgn/test-support';
import { summarize } from './summary';

describe('summarize (the import summary, R-64)', () => {
  it('counts chapters, lines, moves, positions and transpositions', () => {
    const { graph } = imported(
      '[Event "A"]\n\n1. d4 Nf6 2. c4 e6 (2. Nf3 e6) *\n\n[Event "B"]\n\n1. c4 e6 2. d4 Nf6 *',
      'black',
    );
    expect(summarize(graph)).toEqual({
      chapters: 2,
      lines: 3,
      moves: 10,
      positions: 10,
      transpositions: 1,
    });
  });
});
```

(The hand count: chapter A has two line ends (`2. c4 e6` and `2. Nf3 e6`; the alternative is White's, so it is no second answer), chapter B one; A has six distinct moves and B four (its moves leave other positions); the positions are the start and the ten moves' targets, of which the position after 1.d4 Nf6 2.c4 e6 is reached twice, so 10 positions and 1 transposition. Correct the literal if the run disagrees, and say why in the report.)

`legal-moves.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { positionKey } from './position-key';
import { findLegalMove, inCheck, legalMoves } from './legal-moves';

const START = positionKey('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
const PROMOTE = positionKey('8/P7/8/8/8/8/8/k6K w - - 0 1');
const CASTLE = positionKey('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');

describe('legalMoves', () => {
  it('gives the 20 opening moves with squares and SAN', () => {
    const moves = legalMoves(START);
    expect(moves).toHaveLength(20);
    expect(moves).toContainEqual({ orig: 'g1', dest: 'f3', san: 'Nf3', promotion: null });
  });

  it('gives each promotion piece its own move', () => {
    expect(legalMoves(PROMOTE).filter((m) => m.orig === 'a7').map((m) => m.promotion).sort()).toEqual(['b', 'n', 'q', 'r']);
  });

  it('gives castling as the king moving two squares', () => {
    expect(legalMoves(CASTLE)).toContainEqual({ orig: 'e1', dest: 'g1', san: 'O-O', promotion: null });
  });
});

describe('findLegalMove (the typed move)', () => {
  it.each([['Nf3'], ['Nf3+'], ['g1f3'], [' G1F3 ']])('finds %j', (typed) => {
    expect(findLegalMove(START, typed)?.san).toBe('Nf3');
  });

  it('reads 0-0 as O-O', () => {
    expect(findLegalMove(CASTLE, '0-0')?.san).toBe('O-O');
  });

  it.each([[''], ['Nf6'], ['e5'], ['zz']])('finds nothing for %j', (typed) => {
    expect(findLegalMove(START, typed)).toBeNull();
  });
});

describe('inCheck', () => {
  it('says whether the side to move is in check', () => {
    expect(inCheck(START)).toBe(false);
    expect(inCheck(positionKey('4k3/8/8/8/8/8/8/4K2r w - - 0 1'))).toBe(true);
  });
});
```

`schema.test.ts`: `chapterNameSourceSchema` accepts each of the four kinds and refuses `{ kind: 'index', number: 0 }`; `arrowSchema` refuses `{ from: 'i9', to: 'e4', color: 'G' }` and `{ ..., color: 'X' }`; `marksInputSchema` refuses 65 arrows.

- [ ] **Step 2:** `pnpm --filter @mychess/chess test`. Expected: FAIL.
- [ ] **Step 3: Implement.** `summary.ts`:

```ts
import type { RepertoireGraph } from './graph';
import { chapterChildren, chapterWalks } from './walk';

/** What an import or a repertoire holds, as the import summary shows it (R-64). */
export interface RepertoireSummary {
  readonly chapters: number;
  /** Line ends: moves after which their chapter has no further move. */
  readonly lines: number;
  readonly moves: number;
  readonly positions: number;
  /** Positions two or more moves reach. */
  readonly transpositions: number;
}

/** Linear in the repertoire's size (it never enumerates every line). */
export function summarize(graph: RepertoireGraph): RepertoireSummary {
  const walks = chapterWalks(graph);
  const childrenOf = chapterChildren(graph);
  const positions = new Set(graph.chapters.map((c) => c.rootKey));
  const reaching = new Map<string, number>();
  for (const move of graph.moves) {
    positions.add(move.to);
    reaching.set(move.to, (reaching.get(move.to) ?? 0) + 1);
  }
  const lines = graph.chapters.reduce((sum, chapter) => {
    const children = childrenOf(chapter.id);
    return sum + walks(chapter.id).moves().filter((m) => children(m.to).length === 0).length;
  }, 0);
  return {
    chapters: graph.chapters.length,
    lines,
    moves: graph.moves.length,
    positions: positions.size,
    transpositions: [...reaching.values()].filter((n) => n > 1).length,
  };
}
```

`legal-moves.ts`:

```ts
/**
 * Legal moves as a board needs them: the two squares, the SAN, and the
 * promotion piece. The web board takes its destinations from here, so no
 * other package needs chess.js.
 */
import { Chess, type PieceSymbol } from 'chess.js';
import { fenOf } from './position-key';

export type Promotion = 'q' | 'r' | 'b' | 'n';

export interface BoardMove {
  readonly orig: string;
  readonly dest: string;
  readonly san: string;
  readonly promotion: Promotion | null;
}

const promotionOf = (piece: PieceSymbol | undefined): Promotion | null =>
  piece === 'q' || piece === 'r' || piece === 'b' || piece === 'n' ? piece : null;

/** Every legal move in a position key's position. */
export function legalMoves(key: string): BoardMove[] {
  return new Chess(fenOf(key)).moves({ verbose: true }).map((m) => ({
    orig: m.from,
    dest: m.to,
    san: m.san,
    promotion: promotionOf(m.promotion),
  }));
}

/** Is the side to move in check? */
export function inCheck(key: string): boolean {
  return new Chess(fenOf(key)).inCheck();
}

/** SAN without check marks or glyphs, with 0-0 read as O-O. */
const loose = (san: string): string => san.replace(/[+#!?]/g, '').replace(/0/g, 'O');

const uciOf = (move: BoardMove): string => move.orig + move.dest + (move.promotion ?? '');

/** The legal move typed as SAN (`Nf3`, `Nf3+`, `0-0`) or coordinates (`g1f3`), or null. */
export function findLegalMove(key: string, typed: string): BoardMove | null {
  const text = typed.trim();
  if (text === '') return null;
  const san = loose(text);
  const uci = text.toLowerCase();
  return legalMoves(key).find((m) => loose(m.san) === san || uciOf(m) === uci) ?? null;
}
```

`walk.ts`: `export function chapterTree(graph: RepertoireGraph, chapterId: string): WalkedMove[] { return chapterWalks(graph)(chapterId).tree(); }` with a one-line doc ("The move list's shape: see `ChapterWalk.tree`").

`schema.ts`:

```ts
/** The repertoire's shapes as zod schemas, for parsing at the edges (db rows, edit requests). */
import { z } from 'zod';

export const SIDES = ['white', 'black'] as const;
export const sideSchema = z.enum(SIDES);
export const markColorSchema = z.enum(['G', 'R', 'Y', 'B']);

const square = z.string().regex(/^[a-h][1-8]$/);

export const arrowSchema = z.object({ from: square, to: square, color: markColorSchema });
export const circleSchema = z.object({ square, color: markColorSchema });

/** The most arrows or circles one builder edit may draw on a move. */
export const MARKS_MAX = 64;

export const marksInputSchema = z.object({
  arrows: z.array(arrowSchema).max(MARKS_MAX),
  circles: z.array(circleSchema).max(MARKS_MAX),
});

export const chapterNameSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('custom'), name: z.string() }),
  z.object({ kind: z.literal('eco'), eco: z.string() }),
  z.object({ kind: z.literal('header'), name: z.string() }),
  z.object({ kind: z.literal('index'), number: z.number().int().positive() }),
]);
```

`position-key.ts`: add `export const START_KEY = positionKey(DEFAULT_POSITION);` (import `DEFAULT_POSITION` from chess.js) with the doc "The standard start position's key: where builder chapters start."; `import-pgn.ts` and `export-pgn.ts` use it instead of their private `START`.

`src/index.ts`: export `START_KEY`, `summarize`, `type RepertoireSummary`, `legalMoves`, `findLegalMove`, `inCheck`, `type BoardMove`, `type Promotion`, `chapterChildren`, `chapterTree`, `type WalkedMove`, `SIDES`, `sideSchema`, `arrowSchema`, `circleSchema`, `marksInputSchema`, `chapterNameSourceSchema` (only what another package imports; `markColorSchema` and `MARKS_MAX` stay internal).

`packages/chess/package.json`: add `"sideEffects": false` (decision 17). The package's modules only build constants at load (the ECO index is built from a constant table and has no outside effect), so this is true.

- [ ] **Step 4:** `pnpm --filter @mychess/chess test`, then `node quality/gate.mjs check`. Expected: PASS. Knip may flag exports that only the web app uses from Task 12 on; report them, do not delete them.

### Task 6: Repertoire rules in the domain (backend-dev) - SECURITY

**Files:** Create `packages/domain/src/repertoire.ts`, `repertoire.test.ts`. Modify `packages/domain/src/index.ts`.

- [ ] **Step 1: Write the failing tests** `repertoire.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  canEditRepertoire,
  canViewRepertoire,
  chapterNameSchema,
  commentSchema,
  personalNoteSchema,
  repertoireNameSchema,
  REPERTOIRE_ISSUES,
} from './repertoire';

const issue = (r: { success: boolean; error?: { issues: { message: string }[] } }) =>
  r.success ? null : r.error?.issues[0]?.message;

describe('repertoireNameSchema and chapterNameSchema', () => {
  it('trims a name', () => {
    expect(repertoireNameSchema.parse('  Londono sistema ')).toBe('Londono sistema');
  });

  it.each([
    [repertoireNameSchema, '   ', REPERTOIRE_ISSUES.nameBlank],
    [repertoireNameSchema, 'x'.repeat(81), REPERTOIRE_ISSUES.nameTooLong],
    [chapterNameSchema, '', REPERTOIRE_ISSUES.chapterNameBlank],
    [chapterNameSchema, 'x'.repeat(81), REPERTOIRE_ISSUES.chapterNameTooLong],
  ])('refuses with a catalogue key', (schema, value, key) => {
    expect(issue(schema.safeParse(value))).toBe(key);
  });

  it('takes 80 characters', () => {
    expect(repertoireNameSchema.parse('x'.repeat(80))).toHaveLength(80);
  });
});

describe('commentSchema', () => {
  it('keeps the form PGN carries; blank means none', () => {
    expect(commentSchema.parse(' Idea:\n d4 ')).toBe('Idea: d4');
    expect(commentSchema.parse('  ')).toBe('');
  });

  it('refuses more than 2,000 characters after normalising', () => {
    expect(commentSchema.parse(`${'x'.repeat(2000)}   `)).toHaveLength(2000);
    expect(issue(commentSchema.safeParse('x'.repeat(2001)))).toBe(REPERTOIRE_ISSUES.commentTooLong);
  });
});

describe('personalNoteSchema', () => {
  it('keeps line breaks and trims', () => {
    expect(personalNoteSchema.parse(' jei 9.Na4,\ntai Be7 ')).toBe('jei 9.Na4,\ntai Be7');
  });

  it('refuses more than 2,000 characters', () => {
    expect(issue(personalNoteSchema.safeParse('x'.repeat(2001)))).toBe(REPERTOIRE_ISSUES.personalNoteTooLong);
  });
});

describe('canViewRepertoire and canEditRepertoire (S3: the owner only)', () => {
  const repertoire = { ownerId: 'rokas' };

  it.each([canViewRepertoire, canEditRepertoire])('lets the owner in', (rule) => {
    expect(rule({ id: 'rokas' }, repertoire)).toEqual({ ok: true, value: undefined });
  });

  it.each([canViewRepertoire, canEditRepertoire])('refuses anyone else as not found', (rule) => {
    expect(rule({ id: 'rimantas' }, repertoire)).toEqual({
      ok: false,
      refusal: { reason: 'repertoire.notFound' },
    });
  });
});
```

- [ ] **Step 2:** `pnpm --filter @mychess/domain test`. Expected: FAIL.
- [ ] **Step 3: Implement** `repertoire.ts`:

```ts
import { normalizeComment, sideSchema, type Result } from '@mychess/chess';
import { z } from 'zod';
import type { Account } from './account';

export const REPERTOIRE_NAME_MAX = 80;
export const CHAPTER_NAME_MAX = 80;
export const COMMENT_MAX = 2000;
export const PERSONAL_NOTE_MAX = 2000;

/** Message-catalogue keys for invalid repertoire input. */
export const REPERTOIRE_ISSUES = {
  nameBlank: 'repertoire.nameBlank',
  nameTooLong: 'repertoire.nameTooLong',
  chapterNameBlank: 'chapter.nameBlank',
  chapterNameTooLong: 'chapter.nameTooLong',
  commentTooLong: 'comment.tooLong',
  personalNoteTooLong: 'personalNote.tooLong',
} as const;

const boundedName = (max: number, blank: string, tooLong: string) =>
  z.string().trim().min(1, blank).max(max, tooLong);

export const repertoireNameSchema = boundedName(
  REPERTOIRE_NAME_MAX,
  REPERTOIRE_ISSUES.nameBlank,
  REPERTOIRE_ISSUES.nameTooLong,
);

export const chapterNameSchema = boundedName(
  CHAPTER_NAME_MAX,
  REPERTOIRE_ISSUES.chapterNameBlank,
  REPERTOIRE_ISSUES.chapterNameTooLong,
);

/** A typed move comment in the form PGN carries; '' removes it (R-102, decision 2). */
export const commentSchema = z
  .string()
  .transform((text) => normalizeComment(text) ?? '')
  .pipe(z.string().max(COMMENT_MAX, REPERTOIRE_ISSUES.commentTooLong));

/** A private Personal note (R-21); '' removes it. */
export const personalNoteSchema = z
  .string()
  .trim()
  .max(PERSONAL_NOTE_MAX, REPERTOIRE_ISSUES.personalNoteTooLong);

/** A repertoire's own facts, as the database hands them over (parsed at the edge). */
export const repertoireSchema = z.object({
  id: z.uuid(),
  ownerId: z.string().min(1),
  side: sideSchema,
  name: z.string(),
  version: z.number().int().positive(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type Repertoire = z.infer<typeof repertoireSchema>;

export const REPERTOIRE_REFUSALS = {
  notFound: 'repertoire.notFound',
  stale: 'repertoire.stale',
} as const;

/** A missing repertoire and someone else's read the same (decision 12). */
export interface RepertoireAccessRefusal {
  readonly reason: typeof REPERTOIRE_REFUSALS.notFound;
}

type Access = Result<undefined, RepertoireAccessRefusal>;

const ALLOWED: Access = { ok: true, value: undefined };
const NOT_FOUND: Access = { ok: false, refusal: { reason: REPERTOIRE_REFUSALS.notFound } };

const owns = (viewer: Pick<Account, 'id'>, repertoire: Pick<Repertoire, 'ownerId'>) =>
  viewer.id === repertoire.ownerId;

/**
 * Who may see a repertoire. S3: its owner only (R-39: own repertoires are
 * private). S4 adds a coach it is shared with; S5 adds assigned ones.
 */
export function canViewRepertoire(
  viewer: Pick<Account, 'id'>,
  repertoire: Pick<Repertoire, 'ownerId'>,
): Access {
  return owns(viewer, repertoire) ? ALLOWED : NOT_FOUND;
}

/** Who may change a repertoire's moves, chapters and comments. S3: its owner only. */
export function canEditRepertoire(
  viewer: Pick<Account, 'id'>,
  repertoire: Pick<Repertoire, 'ownerId'>,
): Access {
  return owns(viewer, repertoire) ? ALLOWED : NOT_FOUND;
}
```

Export all of these from `src/index.ts`, plus `export type { Side } from '@mychess/chess';` next to the `Result` re-export.

- [ ] **Step 4:** `pnpm --filter @mychess/domain test`, then `node quality/gate.mjs check`. Expected: PASS.

### Task 7: Repertoire tables and migration (backend-dev) - SECURITY

**Files:** Modify `packages/db/src/schema.ts`, `packages/db/test/schema.test.ts`. Create `packages/db/migrations/0002_*.sql` and its snapshot (generated).

- [ ] **Step 1: Write the failing tests** in `test/schema.test.ts` (new `describe`; reuse its raw-SQL style):

```ts
describe('the repertoire tables', () => {
  const account = (id: string) =>
    client.query(
      `insert into accounts (id, email, display_name, created_at, updated_at)
       values ($1, $1 || '@example.lt', $1, now(), now())`,
      [id],
    );
  const repertoire = async (owner: string): Promise<string> =>
    (
      await client.query<{ id: string }>(
        `insert into repertoires (owner_account_id, side, name, created_at, updated_at)
         values ($1, 'white', 'London', now(), now()) returning id`,
        [owner],
      )
    ).rows[0]?.id ?? '';
  const chapter = (rep: string) =>
    client.query(
      `insert into chapters (repertoire_id, chapter_id, root_key, name_source, ord)
       values ($1, 'c1', 'start', '{"kind":"index","number":1}', 0)`,
      [rep],
    );
  const move = async (rep: string, san: string): Promise<string> =>
    (
      await client.query<{ id: string }>(
        `insert into repertoire_moves (repertoire_id, from_key, san, to_key, uci, ord)
         values ($1, 'start', $2, 'after', 'e2e4', 0) returning id`,
        [rep, san],
      )
    ).rows[0]?.id ?? '';

  it('starts a repertoire at version 1 and refuses an unknown side', async () => {
    await account('a1');
    const id = await repertoire('a1');
    expect((await client.query('select version from repertoires where id = $1', [id])).rows).toEqual([{ version: 1 }]);
    await expect(
      client.query(
        `insert into repertoires (owner_account_id, side, name, created_at, updated_at)
         values ('a1', 'red', 'x', now(), now())`,
      ),
    ).rejects.toThrow(/check/);
  });

  it('stores a move once per position and SAN in a repertoire', async () => {
    await account('a1');
    const rep = await repertoire('a1');
    await move(rep, 'e4');
    await expect(move(rep, 'e4')).rejects.toThrow(/unique/);
  });

  it('removes every repertoire row with the account (S1 hard delete)', async () => {
    await account('a1');
    const rep = await repertoire('a1');
    await chapter(rep);
    const moveId = await move(rep, 'e4');
    await client.query(
      `insert into move_chapters (move_id, repertoire_id, chapter_id) values ($1, $2, 'c1')`,
      [moveId, rep],
    );
    await client.query(
      `insert into personal_notes (player_account_id, repertoire_id, move_key, text, updated_at)
       values ('a1', $1, 'start|e4', 'note', now())`,
      [rep],
    );
    await client.query(`delete from accounts where id = 'a1'`);
    const { rows } = await client.query(`select
      (select count(*) from repertoires)::int as r, (select count(*) from chapters)::int as c,
      (select count(*) from repertoire_moves)::int as m, (select count(*) from move_chapters)::int as l,
      (select count(*) from personal_notes)::int as n`);
    expect(rows).toEqual([{ r: 0, c: 0, m: 0, l: 0, n: 0 }]);
  });

  it('removes a chapter link with its chapter, and keeps the move', async () => {
    await account('a1');
    const rep = await repertoire('a1');
    await chapter(rep);
    const moveId = await move(rep, 'e4');
    await client.query(
      `insert into move_chapters (move_id, repertoire_id, chapter_id) values ($1, $2, 'c1')`,
      [moveId, rep],
    );
    await client.query(`delete from chapters where repertoire_id = $1`, [rep]);
    const { rows } = await client.query(`select
      (select count(*) from move_chapters)::int as l, (select count(*) from repertoire_moves)::int as m`);
    expect(rows).toEqual([{ l: 0, m: 1 }]);
  });
});
```

- [ ] **Step 2:** `pnpm --filter @mychess/db test`. Expected: FAIL (relation "repertoires" does not exist).
- [ ] **Step 3: Add the tables** to `src/schema.ts` (after `adminAudit`; add `foreignKey`, `jsonb`, `primaryKey`, `uuid` to the `drizzle-orm/pg-core` import; `SIDES` and the mark/name types from `@mychess/chess`, which db may import):

```ts
/** A Player's (later also a Coach's) repertoire for one side (R-19). */
export const repertoires = pgTable(
  'repertoires',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerAccountId: text('owner_account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    side: text('side', { enum: SIDES }).notNull(),
    name: text('name').notNull(),
    /** Bumped by every graph edit; a save names the version it started from. */
    version: integer('version').notNull().default(1),
    createdAt: at('created_at').notNull(),
    updatedAt: at('updated_at').notNull(),
  },
  (t) => [
    index('repertoires_owner_idx').on(t.ownerAccountId),
    check('repertoires_side_check', oneOf(t.side, SIDES)),
  ],
);

/** A repertoire's chapters; `chapter_id` is the graph's id, unique per repertoire. */
export const chapters = pgTable(
  'chapters',
  {
    repertoireId: uuid('repertoire_id')
      .notNull()
      .references(() => repertoires.id, { onDelete: 'cascade' }),
    chapterId: text('chapter_id').notNull(),
    rootKey: text('root_key').notNull(),
    nameSource: jsonb('name_source').$type<ChapterNameSource>().notNull(),
    intro: text('intro'),
    /** The chapter's place in the repertoire's chapter list. */
    ord: integer('ord').notNull(),
  },
  (t) => [primaryKey({ columns: [t.repertoireId, t.chapterId] })],
);

/**
 * One move of a repertoire's position-keyed graph (Q27): stored once per
 * position and SAN, so S5 assignments and S6 training state can point at it.
 * `ord` is insertion order, which makes the main line (R-79).
 */
export const repertoireMoves = pgTable(
  'repertoire_moves',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    repertoireId: uuid('repertoire_id')
      .notNull()
      .references(() => repertoires.id, { onDelete: 'cascade' }),
    fromKey: text('from_key').notNull(),
    san: text('san').notNull(),
    toKey: text('to_key').notNull(),
    uci: text('uci').notNull(),
    arrows: jsonb('arrows').$type<readonly Arrow[]>().notNull().default([]),
    circles: jsonb('circles').$type<readonly Circle[]>().notNull().default([]),
    comment: text('comment'),
    ord: integer('ord').notNull(),
  },
  (t) => [
    uniqueIndex('repertoire_moves_position_idx').on(t.repertoireId, t.fromKey, t.san),
  ],
);

/** Which chapters hold a move (a move may be in several). */
export const moveChapters = pgTable(
  'move_chapters',
  {
    moveId: uuid('move_id')
      .notNull()
      .references(() => repertoireMoves.id, { onDelete: 'cascade' }),
    repertoireId: uuid('repertoire_id').notNull(),
    chapterId: text('chapter_id').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.moveId, t.chapterId] }),
    foreignKey({
      name: 'move_chapters_chapter_fk',
      columns: [t.repertoireId, t.chapterId],
      foreignColumns: [chapters.repertoireId, chapters.chapterId],
    }).onDelete('cascade'),
    index('move_chapters_repertoire_idx').on(t.repertoireId),
  ],
);

/** A Player's private note on a move (R-21); keyed by move key (decision 11). */
export const personalNotes = pgTable(
  'personal_notes',
  {
    playerAccountId: text('player_account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    repertoireId: uuid('repertoire_id')
      .notNull()
      .references(() => repertoires.id, { onDelete: 'cascade' }),
    moveKey: text('move_key').notNull(),
    text: text('text').notNull(),
    updatedAt: at('updated_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.playerAccountId, t.repertoireId, t.moveKey] })],
);
```

Import `SIDES, type Arrow, type ChapterNameSource, type Circle` from `@mychess/chess`. If drizzle-kit refuses `.default([])` on `jsonb`, use `.default(sql\`'[]'::jsonb\`)` and report it.

- [ ] **Step 4:** `pnpm --filter @mychess/db db:generate`. Review the SQL: five tables, the `repertoires_side_check`, the unique `repertoire_moves_position_idx`, cascades on `owner_account_id`, every `repertoire_id`, `move_chapters.move_id`, `move_chapters_chapter_fk` and `personal_notes.player_account_id`; uuid defaults `gen_random_uuid()`. It must be `0002_<generated name>.sql` (after `0001_admin_audit_append_only`). Commit it unedited.
- [ ] **Step 5:** `pnpm --filter @mychess/db test`, then `node quality/gate.mjs check`. Expected: PASS.

### Task 8: The diff between two graphs (backend-dev)

**Files:** Create `packages/db/src/repertoires/diff.ts`, `packages/db/test/repertoire-diff.test.ts`.

- [ ] **Step 1: Write the failing tests** `test/repertoire-diff.test.ts` (pure: no database):

```ts
import { addMove, editComment, importPgn, moveKey, removeChapter, removeMove, renameChapter, setMarks, type RepertoireGraph } from '@mychess/chess';
import { describe, expect, it } from 'vitest';
import { diffRepertoire } from '../src/repertoires/diff';

function graphOf(text: string): RepertoireGraph {
  const r = importPgn(text, 'white');
  if (!r.ok) throw new Error(r.refusal.reason);
  return r.value.graph;
}
function ok(r: { ok: true; value: RepertoireGraph } | { ok: false; refusal: { reason: string } }): RepertoireGraph {
  if (!r.ok) throw new Error(r.refusal.reason);
  return r.value;
}

const base = graphOf('[Event "A"]\n\n1. e4 e5 2. Nf3 *\n\n[Event "B"]\n\n1. e4 c5 *');
const START = base.chapters[0]?.rootKey ?? '';
const keyOf = (san: string) => {
  const m = base.moves.find((x) => x.san === san);
  if (m === undefined) throw new Error(san);
  return moveKey(m.from, m.san);
};

const EMPTY = {
  addedChapters: [], removedChapterIds: [], changedChapters: [],
  addedMoves: [], removedMoveKeys: [], changedMoves: [], addedLinks: [], removedLinks: [],
};

describe('diffRepertoire', () => {
  it('finds nothing between a graph and itself', () => {
    expect(diffRepertoire(base, base)).toEqual(EMPTY);
  });

  it('finds an added move with its chapters', () => {
    const e5 = base.moves.find((m) => m.san === 'e5');
    const after = ok(addMove(base, 'c1', e5?.to ?? '', 'Nc3'));
    const d = diffRepertoire(base, after);
    expect(d.addedMoves.map((m) => [m.san, m.chapters])).toEqual([['Nc3', ['c1']]]);
    expect({ ...d, addedMoves: [] }).toEqual(EMPTY);
  });

  it('finds a changed comment and changed marks, nothing else', () => {
    let after = ok(editComment(base, keyOf('e4'), 'Best'));
    after = ok(setMarks(after, 'c1', { from: START, san: 'e4' }, { arrows: [{ from: 'g1', to: 'f3', color: 'G' }], circles: [] }));
    const d = diffRepertoire(base, after);
    expect(d.changedMoves.map((m) => [m.san, m.comment, m.arrows.length])).toEqual([['e4', 'Best', 1]]);
    expect({ ...d, changedMoves: [] }).toEqual(EMPTY);
  });

  it('finds a removed move, and a link removed from a move another chapter keeps', () => {
    const after = ok(removeMove(base, 'c2', START, 'e4'));
    const d = diffRepertoire(base, after);
    expect(d.removedMoveKeys).toEqual([keyOf('c5')]);
    expect(d.removedLinks).toEqual([{ moveKey: keyOf('e4'), chapterId: 'c2' }]);
  });

  it('finds a removed chapter without listing the links its removal cascades', () => {
    const d = diffRepertoire(base, ok(removeChapter(base, 'c2')));
    expect(d.removedChapterIds).toEqual(['c2']);
    expect(d.removedMoveKeys).toEqual([keyOf('c5')]);
    expect(d.removedLinks).toEqual([]);
  });

  it('finds a renamed chapter', () => {
    const d = diffRepertoire(base, ok(renameChapter(base, 'c1', 'Open')));
    expect(d.changedChapters.map((c) => c.nameSource)).toEqual([{ kind: 'custom', name: 'Open' }]);
  });

  it('finds a link added to an existing move', () => {
    const withC3 = { ...base, chapters: [...base.chapters, { id: 'c3', rootKey: START, intro: null, nameSource: { kind: 'index', number: 3 } as const }] };
    const after = ok(addMove(withC3, 'c3', START, 'e4'));
    const d = diffRepertoire(withC3, after);
    expect(d.addedLinks).toEqual([{ moveKey: keyOf('e4'), chapterId: 'c3' }]);
  });
});
```

- [ ] **Step 2:** `pnpm --filter @mychess/db test`. Expected: FAIL.
- [ ] **Step 3: Implement** `src/repertoires/diff.ts`:

```ts
/**
 * The rows an edit changes (spec: "writes only the moves, chapters and
 * comments that changed"). Pure, so it is tested without a database. A move
 * is identified by its move key; its `to` and `uci` follow from that key, so
 * only its comment and marks can change. A move's chapters are a set.
 */
import { moveKey, type Chapter, type RepertoireGraph, type RepertoireMove } from '@mychess/chess';

/** One move in one chapter: a `move_chapters` row. */
export interface MoveLink {
  readonly moveKey: string;
  readonly chapterId: string;
}

export interface RepertoireDiff {
  readonly addedChapters: readonly Chapter[];
  readonly removedChapterIds: readonly string[];
  /** Kept chapters whose name or intro changed. */
  readonly changedChapters: readonly Chapter[];
  /** New moves; their links are their `chapters`. */
  readonly addedMoves: readonly RepertoireMove[];
  readonly removedMoveKeys: readonly string[];
  /** Kept moves whose comment or marks changed. */
  readonly changedMoves: readonly RepertoireMove[];
  /** Links added to kept moves. */
  readonly addedLinks: readonly MoveLink[];
  /** Links removed from kept moves of kept chapters (others go by cascade). */
  readonly removedLinks: readonly MoveLink[];
}

const keyOf = (m: RepertoireMove): string => moveKey(m.from, m.san);
const annotationOf = (m: RepertoireMove): string => JSON.stringify([m.comment, m.arrows, m.circles]);
const faceOf = (c: Chapter): string => JSON.stringify([c.nameSource, c.intro]);

/** The links of `move` whose chapter `other` lacks and `keep` accepts. */
function linksBeyond(
  move: RepertoireMove,
  other: RepertoireMove,
  keep: (chapterId: string) => boolean,
): MoveLink[] {
  return move.chapters
    .filter((c) => !other.chapters.includes(c) && keep(c))
    .map((chapterId) => ({ moveKey: keyOf(move), chapterId }));
}

interface Pair {
  readonly before: RepertoireMove;
  readonly after: RepertoireMove;
}

function keptPairs(before: RepertoireGraph, after: RepertoireGraph): Pair[] {
  const old = new Map(before.moves.map((m) => [keyOf(m), m]));
  return after.moves.flatMap((m) => {
    const was = old.get(keyOf(m));
    return was === undefined ? [] : [{ before: was, after: m }];
  });
}

function chapterDiff(before: RepertoireGraph, after: RepertoireGraph) {
  const old = new Map(before.chapters.map((c) => [c.id, c]));
  const now = new Set(after.chapters.map((c) => c.id));
  return {
    addedChapters: after.chapters.filter((c) => !old.has(c.id)),
    removedChapterIds: before.chapters.filter((c) => !now.has(c.id)).map((c) => c.id),
    changedChapters: after.chapters.filter((c) => {
      const was = old.get(c.id);
      return was !== undefined && faceOf(was) !== faceOf(c);
    }),
  };
}

function moveDiff(before: RepertoireGraph, after: RepertoireGraph) {
  const oldKeys = new Set(before.moves.map(keyOf));
  const newKeys = new Set(after.moves.map(keyOf));
  const kept = keptPairs(before, after);
  const stillThere = new Set(after.chapters.map((c) => c.id));
  return {
    addedMoves: after.moves.filter((m) => !oldKeys.has(keyOf(m))),
    removedMoveKeys: before.moves.filter((m) => !newKeys.has(keyOf(m))).map(keyOf),
    changedMoves: kept.filter((p) => annotationOf(p.before) !== annotationOf(p.after)).map((p) => p.after),
    addedLinks: kept.flatMap((p) => linksBeyond(p.after, p.before, () => true)),
    removedLinks: kept.flatMap((p) => linksBeyond(p.before, p.after, (c) => stillThere.has(c))),
  };
}

export function diffRepertoire(before: RepertoireGraph, after: RepertoireGraph): RepertoireDiff {
  return { ...chapterDiff(before, after), ...moveDiff(before, after) };
}
```

- [ ] **Step 4:** `pnpm --filter @mychess/db test`, then `node quality/gate.mjs check`. Expected: PASS.

### Task 9: Repertoire repositories (backend-dev) - SECURITY

**Files:** Create `packages/db/src/repertoires/rows.ts`, `repertoires/write.ts`, `repertoires/repository.ts`, `packages/db/test/repertoires.test.ts`, `packages/db/test/support/repertoires.ts`. Modify `packages/db/src/index.ts`.

- [ ] **Step 1:** `test/support/repertoires.ts`:

```ts
import { importPgn, type RepertoireGraph, type Side } from '@mychess/chess';

export const T0 = new Date('2026-10-17T08:00:00Z');
export const T1 = new Date('2026-10-17T09:00:00Z');

/** The graph `text` imports to, or a thrown error. */
export function graphOf(text: string, side: Side = 'white'): RepertoireGraph {
  const r = importPgn(text, side);
  if (!r.ok) throw new Error(r.refusal.reason);
  return r.value.graph;
}

/** `graph` with each move's chapters sorted, for comparing as sets. */
export function canonical(graph: RepertoireGraph): RepertoireGraph {
  return { ...graph, moves: graph.moves.map((m) => ({ ...m, chapters: [...m.chapters].sort() })) };
}

export const LONDON = [
  '[Event "London vs ...d5"]',
  '',
  '{ The London } 1. d4 { Solid [%cal Gc1f4] } d5 2. Bf4 Nf6 3. e3 e6 (3... c5 4. c3) 4. Nf3 *',
  '',
  '[Event "London vs KID"]',
  '',
  '1. d4 Nf6 2. Bf4 g6 3. e3 Bg7 4. Nf3 *',
].join('\n');
```

- [ ] **Step 2: Write the failing tests** `test/repertoires.test.ts`:

```ts
import { addMove, editComment, moveKey, removeMove } from '@mychess/chess';
import { describe, expect, it } from 'vitest';
import {
  createRepertoire,
  deleteAccount,
  deleteRepertoire,
  listRepertoires,
  loadRepertoire,
  renameRepertoire,
  saveRepertoireEdit,
} from '../src';
import { useTestDatabase } from '../src/testing';
import { seedAccount } from './support/accounts';
import { canonical, graphOf, LONDON, T0, T1 } from './support/repertoires';

const { db, client } = useTestDatabase();

async function london(owner = 'rokas'): Promise<string> {
  return createRepertoire(db, { ownerId: owner, side: 'white', name: 'Londono sistema', graph: graphOf(LONDON), now: T0 });
}

/** Every repertoire row with its transaction id: a row an edit did not write keeps its xmin. */
async function rowVersions(): Promise<Map<string, string>> {
  const { rows } = await client.query<{ row: string; v: string }>(`
    select 'move ' || from_key || '|' || san as row, xmin::text as v from repertoire_moves
    union all select 'chapter ' || chapter_id, xmin::text from chapters
    union all select 'link ' || move_id || ' ' || chapter_id, xmin::text from move_chapters`);
  return new Map(rows.map((r) => [r.row, r.v]));
}

describe('createRepertoire and loadRepertoire', () => {
  it('stores a graph and loads it back the same, comments, marks and order included', async () => {
    await seedAccount(db, 'rokas', 'rokas@example.lt');
    const id = await london();
    const loaded = await loadRepertoire(db, id, 'rokas');
    expect(loaded?.repertoire).toMatchObject({ id, ownerId: 'rokas', side: 'white', name: 'Londono sistema', version: 1 });
    expect(canonical(loaded?.graph ?? graphOf('1. e4 *'))).toEqual(canonical(graphOf(LONDON)));
  });

  it('loads nothing for another account (the query filters by owner)', async () => {
    await seedAccount(db, 'rokas', 'rokas@example.lt');
    await seedAccount(db, 'rimantas', 'rimantas@example.lt');
    const id = await london();
    expect(await loadRepertoire(db, id, 'rimantas')).toBeUndefined();
  });
});

describe('saveRepertoireEdit', () => {
  it('writes only the rows that changed, and bumps the version', async () => {
    await seedAccount(db, 'rokas', 'rokas@example.lt');
    const id = await london();
    const before = (await loadRepertoire(db, id, 'rokas'))?.graph ?? graphOf('1. e4 *');
    const d4 = before.moves.find((m) => m.san === 'd4');
    const key = moveKey(d4?.from ?? '', 'd4');
    const edited = editComment(before, key, 'Best');
    if (!edited.ok) throw new Error(edited.refusal.reason);
    const versions = await rowVersions();
    const saved = await saveRepertoireEdit(db, { id, ownerId: 'rokas', expectedVersion: 1, before, after: edited.value, now: T1 });
    expect(saved).toEqual({ ok: true, value: { version: 2 } });
    const after = await rowVersions();
    const changed = [...after].filter(([row, v]) => versions.get(row) !== v).map(([row]) => row);
    expect(changed).toEqual([`move ${key}`]);
  });

  it('adds and removes moves and links', async () => {
    await seedAccount(db, 'rokas', 'rokas@example.lt');
    const id = await london();
    const before = (await loadRepertoire(db, id, 'rokas'))?.graph ?? graphOf('1. e4 *');
    const bf4 = before.moves.find((m) => m.san === 'Bf4' && m.chapters.includes('c1'));
    let after = removeMove(before, 'c1', bf4?.from ?? '', 'Bf4');
    if (!after.ok) throw new Error(after.refusal.reason);
    after = addMove(after.value, 'c1', bf4?.from ?? '', 'c4');
    if (!after.ok) throw new Error(after.refusal.reason);
    await saveRepertoireEdit(db, { id, ownerId: 'rokas', expectedVersion: 1, before, after: after.value, now: T1 });
    expect(canonical((await loadRepertoire(db, id, 'rokas'))?.graph ?? before)).toEqual(canonical(after.value));
  });

  it('refuses a stale version and changes nothing', async () => {
    await seedAccount(db, 'rokas', 'rokas@example.lt');
    const id = await london();
    const before = (await loadRepertoire(db, id, 'rokas'))?.graph ?? graphOf('1. e4 *');
    const edited = editComment(before, moveKey(before.moves[0]?.from ?? '', 'd4'), 'x');
    if (!edited.ok) throw new Error('edit');
    await saveRepertoireEdit(db, { id, ownerId: 'rokas', expectedVersion: 1, before, after: edited.value, now: T1 });
    const again = await saveRepertoireEdit(db, { id, ownerId: 'rokas', expectedVersion: 1, before, after: before, now: T1 });
    expect(again).toEqual({ ok: false, refusal: { reason: 'repertoire.stale' } });
    expect((await loadRepertoire(db, id, 'rokas'))?.repertoire.version).toBe(2);
  });

  it("refuses another account's repertoire as stale and writes nothing", async () => {
    await seedAccount(db, 'rokas', 'rokas@example.lt');
    await seedAccount(db, 'rimantas', 'rimantas@example.lt');
    const id = await london();
    const before = (await loadRepertoire(db, id, 'rokas'))?.graph ?? graphOf('1. e4 *');
    const saved = await saveRepertoireEdit(db, { id, ownerId: 'rimantas', expectedVersion: 1, before, after: { ...before, moves: [] }, now: T1 });
    expect(saved.ok).toBe(false);
    expect((await loadRepertoire(db, id, 'rokas'))?.graph.moves).toHaveLength(before.moves.length);
  });
});

describe('listRepertoires, renameRepertoire, deleteRepertoire', () => {
  it("lists only the owner's repertoires with chapter and move counts", async () => {
    await seedAccount(db, 'rokas', 'rokas@example.lt');
    await seedAccount(db, 'rimantas', 'rimantas@example.lt');
    const id = await london();
    await london('rimantas');
    expect(await listRepertoires(db, 'rokas')).toEqual([
      { id, side: 'white', name: 'Londono sistema', chapters: 2, moves: graphOf(LONDON).moves.length, updatedAt: T0 },
    ]);
  });

  it('renames and deletes only for the owner', async () => {
    await seedAccount(db, 'rokas', 'rokas@example.lt');
    await seedAccount(db, 'rimantas', 'rimantas@example.lt');
    const id = await london();
    expect(await renameRepertoire(db, { id, ownerId: 'rimantas', name: 'x', now: T1 })).toBe(false);
    expect(await deleteRepertoire(db, id, 'rimantas')).toBe(false);
    expect(await renameRepertoire(db, { id, ownerId: 'rokas', name: 'London', now: T1 })).toBe(true);
    expect((await loadRepertoire(db, id, 'rokas'))?.repertoire).toMatchObject({ name: 'London', version: 1 });
    expect(await deleteRepertoire(db, id, 'rokas')).toBe(true);
    expect(await client.query('select count(*)::int as n from repertoire_moves')).toMatchObject({ rows: [{ n: 0 }] });
  });

  it('leaves no repertoire row when the account is deleted (S1 hard delete)', async () => {
    await seedAccount(db, 'rokas', 'rokas@example.lt');
    await london();
    await deleteAccount(db, 'rokas');
    const { rows } = await client.query(`select
      (select count(*) from repertoires)::int + (select count(*) from chapters)::int +
      (select count(*) from repertoire_moves)::int + (select count(*) from move_chapters)::int as n`);
    expect(rows).toEqual([{ n: 0 }]);
  });
});
```

- [ ] **Step 3:** `pnpm --filter @mychess/db test`. Expected: FAIL.
- [ ] **Step 4: Implement** `src/repertoires/rows.ts`:

```ts
/** The repertoire rows as zod parses them (parse at the edge), and the graph they make. */
import {
  arrowSchema,
  chapterNameSourceSchema,
  circleSchema,
  type RepertoireGraph,
  type Side,
} from '@mychess/chess';
import { z } from 'zod';

export const chapterRowsSchema = z.array(
  z.object({
    chapterId: z.string().min(1),
    rootKey: z.string().min(1),
    nameSource: chapterNameSourceSchema,
    intro: z.string().nullable(),
  }),
);

// Imported comments may be longer than a typed one (decision 4): no max here.
export const moveRowsSchema = z.array(
  z.object({
    id: z.uuid(),
    fromKey: z.string().min(1),
    san: z.string().min(1),
    toKey: z.string().min(1),
    uci: z.string().min(4),
    arrows: z.array(arrowSchema),
    circles: z.array(circleSchema),
    comment: z.string().nullable(),
  }),
);

export const linkRowsSchema = z.array(z.object({ moveId: z.uuid(), chapterId: z.string().min(1) }));

type ChapterRow = z.infer<typeof chapterRowsSchema>[number];
type MoveRow = z.infer<typeof moveRowsSchema>[number];
type LinkRow = z.infer<typeof linkRowsSchema>[number];

/** The graph the rows hold: chapters and moves in `ord` order; a move's chapters in chapter order. */
export function graphOf(
  side: Side,
  chapterRows: readonly ChapterRow[],
  moveRows: readonly MoveRow[],
  links: readonly LinkRow[],
): RepertoireGraph {
  const place = new Map(chapterRows.map((c, i) => [c.chapterId, i]));
  const held = new Map<string, string[]>();
  for (const link of links) held.set(link.moveId, [...(held.get(link.moveId) ?? []), link.chapterId]);
  const inOrder = (ids: readonly string[]) =>
    ids.toSorted((a, b) => (place.get(a) ?? 0) - (place.get(b) ?? 0));
  return {
    side,
    chapters: chapterRows.map((c) => ({
      id: c.chapterId,
      rootKey: c.rootKey,
      intro: c.intro,
      nameSource: c.nameSource,
    })),
    moves: moveRows.map((m) => ({
      from: m.fromKey,
      to: m.toKey,
      san: m.san,
      uci: m.uci,
      arrows: m.arrows,
      circles: m.circles,
      comment: m.comment,
      chapters: inOrder(held.get(m.id) ?? []),
    })),
  };
}
```

`src/repertoires/write.ts` (each function small; batches keep every statement far under Postgres's 65,535 parameters):

```ts
/** Writes a RepertoireDiff for one repertoire. Call it inside a transaction. */
import { moveKey, type Chapter, type RepertoireMove } from '@mychess/chess';
import { and, eq, inArray, max, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Executor } from '../client';
import { chapters, moveChapters, repertoireMoves } from '../schema';
import type { MoveLink, RepertoireDiff } from './diff';

const BATCH = 500;

function batches<T>(items: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += BATCH) out.push(items.slice(i, i + BATCH));
  return out;
}

/** A row's move key, as SQL: position keys and SAN never contain `|`. */
const keyColumn = sql<string>`${repertoireMoves.fromKey} || '|' || ${repertoireMoves.san}`;
const ofRepertoire = (id: string) => eq(repertoireMoves.repertoireId, id);
const topSchema = z.array(z.object({ top: z.number().nullable() }));
const idRowsSchema = z.array(z.object({ id: z.uuid(), fromKey: z.string(), san: z.string() }));

async function nextChapterOrd(tx: Executor, repertoireId: string): Promise<number> {
  const rows = await tx.select({ top: max(chapters.ord) }).from(chapters).where(eq(chapters.repertoireId, repertoireId));
  return (topSchema.parse(rows)[0]?.top ?? -1) + 1;
}

async function nextMoveOrd(tx: Executor, repertoireId: string): Promise<number> {
  const rows = await tx.select({ top: max(repertoireMoves.ord) }).from(repertoireMoves).where(ofRepertoire(repertoireId));
  return (topSchema.parse(rows)[0]?.top ?? -1) + 1;
}

async function deleteMoves(tx: Executor, repertoireId: string, keys: readonly string[]): Promise<void> {
  for (const batch of batches(keys))
    await tx.delete(repertoireMoves).where(and(ofRepertoire(repertoireId), inArray(keyColumn, batch)));
}

async function moveIds(tx: Executor, repertoireId: string, keys: readonly string[]): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (const batch of batches([...new Set(keys)])) {
    const rows = await tx
      .select({ id: repertoireMoves.id, fromKey: repertoireMoves.fromKey, san: repertoireMoves.san })
      .from(repertoireMoves)
      .where(and(ofRepertoire(repertoireId), inArray(keyColumn, batch)));
    for (const row of idRowsSchema.parse(rows)) ids.set(moveKey(row.fromKey, row.san), row.id);
  }
  return ids;
}

async function deleteLinks(tx: Executor, repertoireId: string, links: readonly MoveLink[]): Promise<void> {
  const ids = await moveIds(tx, repertoireId, links.map((l) => l.moveKey));
  for (const link of links) {
    const moveId = ids.get(link.moveKey);
    if (moveId !== undefined)
      await tx.delete(moveChapters).where(and(eq(moveChapters.moveId, moveId), eq(moveChapters.chapterId, link.chapterId)));
  }
}

async function insertChapters(tx: Executor, repertoireId: string, added: readonly Chapter[]): Promise<void> {
  if (added.length === 0) return;
  const first = await nextChapterOrd(tx, repertoireId);
  await tx.insert(chapters).values(
    added.map((c, i) => ({ repertoireId, chapterId: c.id, rootKey: c.rootKey, nameSource: c.nameSource, intro: c.intro, ord: first + i })),
  );
}

async function updateChapters(tx: Executor, repertoireId: string, changed: readonly Chapter[]): Promise<void> {
  for (const c of changed)
    await tx
      .update(chapters)
      .set({ nameSource: c.nameSource, intro: c.intro })
      .where(and(eq(chapters.repertoireId, repertoireId), eq(chapters.chapterId, c.id)));
}

const moveRow = (repertoireId: string, m: RepertoireMove, ord: number) => ({
  repertoireId, fromKey: m.from, san: m.san, toKey: m.to, uci: m.uci,
  arrows: m.arrows, circles: m.circles, comment: m.comment, ord,
});

async function insertMoves(tx: Executor, repertoireId: string, added: readonly RepertoireMove[]): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  let ord = await nextMoveOrd(tx, repertoireId);
  for (const batch of batches(added)) {
    const rows = await tx
      .insert(repertoireMoves)
      .values(batch.map((m, i) => moveRow(repertoireId, m, ord + i)))
      .returning({ id: repertoireMoves.id, fromKey: repertoireMoves.fromKey, san: repertoireMoves.san });
    for (const row of idRowsSchema.parse(rows)) ids.set(moveKey(row.fromKey, row.san), row.id);
    ord += batch.length;
  }
  return ids;
}

async function updateMoves(tx: Executor, repertoireId: string, changed: readonly RepertoireMove[]): Promise<void> {
  for (const m of changed)
    await tx
      .update(repertoireMoves)
      .set({ arrows: m.arrows, circles: m.circles, comment: m.comment })
      .where(and(ofRepertoire(repertoireId), eq(repertoireMoves.fromKey, m.from), eq(repertoireMoves.san, m.san)));
}

async function insertLinks(tx: Executor, repertoireId: string, links: readonly MoveLink[], ids: ReadonlyMap<string, string>): Promise<void> {
  const rows = links.flatMap((l) => {
    const moveId = ids.get(l.moveKey);
    return moveId === undefined ? [] : [{ moveId, repertoireId, chapterId: l.chapterId }];
  });
  for (const batch of batches(rows)) await tx.insert(moveChapters).values(batch);
}

const linksOf = (moves: readonly RepertoireMove[]): MoveLink[] =>
  moves.flatMap((m) => m.chapters.map((chapterId) => ({ moveKey: moveKey(m.from, m.san), chapterId })));

/**
 * Deletes first (moves, then the links of kept moves, then chapters, whose
 * links cascade), then inserts chapters before the moves and links that
 * point at them.
 */
export async function writeDiff(tx: Executor, repertoireId: string, diff: RepertoireDiff): Promise<void> {
  await deleteMoves(tx, repertoireId, diff.removedMoveKeys);
  await deleteLinks(tx, repertoireId, diff.removedLinks);
  if (diff.removedChapterIds.length > 0)
    await tx.delete(chapters).where(and(eq(chapters.repertoireId, repertoireId), inArray(chapters.chapterId, [...diff.removedChapterIds])));
  await insertChapters(tx, repertoireId, diff.addedChapters);
  await updateChapters(tx, repertoireId, diff.changedChapters);
  const newIds = await insertMoves(tx, repertoireId, diff.addedMoves);
  await updateMoves(tx, repertoireId, diff.changedMoves);
  const keptIds = await moveIds(tx, repertoireId, diff.addedLinks.map((l) => l.moveKey));
  await insertLinks(tx, repertoireId, [...linksOf(diff.addedMoves), ...diff.addedLinks], new Map([...newIds, ...keptIds]));
}
```

If `max()` maps the integer column to a string in drizzle 0.45 (it maps `max` of an integer to `number | null`; check the inferred type), keep `z.coerce.number().nullable()` instead and say so.

`src/repertoires/repository.ts`:

```ts
import type { RepertoireGraph, Side } from '@mychess/chess';
import { repertoireSchema, type Repertoire, type Result } from '@mychess/domain';
import { and, asc, count, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Executor } from '../client';
import { chapters, moveChapters, repertoireMoves, repertoires } from '../schema';
import { diffRepertoire } from './diff';
import { chapterRowsSchema, graphOf, linkRowsSchema, moveRowsSchema } from './rows';
import { writeDiff } from './write';

export interface LoadedRepertoire {
  readonly repertoire: Repertoire;
  readonly graph: RepertoireGraph;
}

const metaColumns = {
  id: repertoires.id,
  ownerId: repertoires.ownerAccountId,
  side: repertoires.side,
  name: repertoires.name,
  version: repertoires.version,
  createdAt: repertoires.createdAt,
  updatedAt: repertoires.updatedAt,
};

const ownedBy = (id: string, ownerId: string) =>
  and(eq(repertoires.id, id), eq(repertoires.ownerAccountId, ownerId));

const emptyGraph = (side: Side): RepertoireGraph => ({ side, chapters: [], moves: [] });

export interface NewRepertoire {
  readonly ownerId: string;
  readonly side: Side;
  /** Already checked by the domain's repertoireNameSchema. */
  readonly name: string;
  readonly graph: RepertoireGraph;
  readonly now: Date;
}

/** A new repertoire with its whole graph, in one transaction; returns its id. */
export async function createRepertoire(db: Executor, input: NewRepertoire): Promise<string> {
  return db.transaction(async (tx) => {
    const [row] = z.array(z.object({ id: z.uuid() })).parse(
      await tx
        .insert(repertoires)
        .values({ ownerAccountId: input.ownerId, side: input.side, name: input.name, createdAt: input.now, updatedAt: input.now })
        .returning({ id: repertoires.id }),
    );
    if (row === undefined) throw new Error('createRepertoire: no row returned');
    await writeDiff(tx, row.id, diffRepertoire(emptyGraph(input.side), input.graph));
    return row.id;
  });
}

/**
 * The repertoire `id` of `ownerId` with its graph, read in one snapshot, or
 * undefined (missing or someone else's: the query filters by owner, as the
 * domain's access rule does). `id` must be a uuid (parse it first).
 */
export async function loadRepertoire(db: Executor, id: string, ownerId: string): Promise<LoadedRepertoire | undefined> {
  return db.transaction(
    async (tx) => {
      const [row] = await tx.select(metaColumns).from(repertoires).where(ownedBy(id, ownerId)).limit(1);
      if (row === undefined) return undefined;
      const repertoire = repertoireSchema.parse(row);
      const chapterRows = chapterRowsSchema.parse(
        await tx.select({ chapterId: chapters.chapterId, rootKey: chapters.rootKey, nameSource: chapters.nameSource, intro: chapters.intro })
          .from(chapters).where(eq(chapters.repertoireId, id)).orderBy(asc(chapters.ord)),
      );
      const moveRows = moveRowsSchema.parse(
        await tx.select({ id: repertoireMoves.id, fromKey: repertoireMoves.fromKey, san: repertoireMoves.san, toKey: repertoireMoves.toKey, uci: repertoireMoves.uci, arrows: repertoireMoves.arrows, circles: repertoireMoves.circles, comment: repertoireMoves.comment })
          .from(repertoireMoves).where(eq(repertoireMoves.repertoireId, id)).orderBy(asc(repertoireMoves.ord)),
      );
      const links = linkRowsSchema.parse(
        await tx.select({ moveId: moveChapters.moveId, chapterId: moveChapters.chapterId }).from(moveChapters).where(eq(moveChapters.repertoireId, id)),
      );
      return { repertoire, graph: graphOf(repertoire.side, chapterRows, moveRows, links) };
    },
    { isolationLevel: 'repeatable read' },
  );
}

export interface RepertoireEdit {
  readonly id: string;
  readonly ownerId: string;
  /** The version `before` was loaded at. */
  readonly expectedVersion: number;
  readonly before: RepertoireGraph;
  readonly after: RepertoireGraph;
  readonly now: Date;
}

/**
 * Saves an edit (a builder edit or an import into the repertoire, decision
 * 6): bumps the version only from `expectedVersion`, then writes the
 * minimal diff, in one transaction. A stale version (or a repertoire not
 * this owner's) is refused and nothing is written.
 */
export async function saveRepertoireEdit(
  db: Executor,
  edit: RepertoireEdit,
): Promise<Result<{ version: number }, { reason: 'repertoire.stale' }>> {
  return db.transaction(async (tx) => {
    const bumped = z.array(z.object({ version: z.number().int() })).parse(
      await tx
        .update(repertoires)
        .set({ version: sql`${repertoires.version} + 1`, updatedAt: edit.now })
        .where(and(ownedBy(edit.id, edit.ownerId), eq(repertoires.version, edit.expectedVersion)))
        .returning({ version: repertoires.version }),
    );
    const [row] = bumped;
    if (row === undefined) return { ok: false, refusal: { reason: 'repertoire.stale' } };
    await writeDiff(tx, edit.id, diffRepertoire(edit.before, edit.after));
    return { ok: true, value: { version: row.version } };
  });
}
```

  Also in `repository.ts`, small functions with the same owner filter:
  - `listRepertoires(db, ownerId): Promise<RepertoireListItem[]>` where `RepertoireListItem = { id, side, name, chapters: number, moves: number, updatedAt: Date }`: one select of `repertoires` for the owner ordered by `createdAt` then `id`, with `chapters` and `moves` as correlated `count(*)` subqueries (`sql<number>\`(select count(*)::int from chapters c where c.repertoire_id = ${repertoires.id})\``), parsed with zod.
  - `renameRepertoire(db, { id, ownerId, name, now }): Promise<boolean>`: `update repertoires set name, updated_at where id and owner returning id`; true when a row came back. No version bump (decision 10).
  - `deleteRepertoire(db, id, ownerId): Promise<boolean>`: `delete ... where id and owner returning id`; cascades remove the rest.

Export from `src/index.ts`: `createRepertoire, deleteRepertoire, listRepertoires, loadRepertoire, renameRepertoire, saveRepertoireEdit, type LoadedRepertoire, type NewRepertoire, type RepertoireEdit, type RepertoireListItem`. `deleteAccount` needs no change (cascade); update its doc comment to list repertoires among what goes.

- [ ] **Step 5:** `pnpm --filter @mychess/db test`. Expected: PASS. If `xmin` shows a link row changed by the comment edit, the writer touched it: fix the writer, not the test.
- [ ] **Step 6:** `node quality/gate.mjs check`. Expected: PASS.

### Task 10: Personal notes and the data export (backend-dev) - SECURITY

**Files:** Create `packages/db/src/personal-notes.ts`, `packages/db/test/personal-notes.test.ts`. Modify `packages/db/src/accounts.ts`, `packages/db/test/accounts.test.ts`, `packages/db/src/index.ts`.

- [ ] **Step 1: Write the failing tests.** `personal-notes.test.ts`:
  - `setPersonalNote(db, { playerId: 'rokas', repertoireId, moveKey, text: 'Nepamiršti d3', now: T0 })` then `listPersonalNotes(db, 'rokas', repertoireId)` gives `{ [moveKey]: 'Nepamiršti d3' }`; setting again replaces it (one row; `updated_at` is the new time); `text: ''` deletes it.
  - Another player's notes on the same repertoire and move are not listed (`listPersonalNotes(db, 'rimantas', id)` is `{}` after Rokas's note), and Rokas's note survives Rimantas setting one.
  - A note stays when its move is removed from the repertoire (decision 11), and goes with the repertoire on `deleteRepertoire`.

  In `accounts.test.ts`, extend the `exportAccount` test: after `createRepertoire` (the `LONDON` graph) and a personal note, `exportAccount(db, 'a1', NOW, { chapterTitle: (c) => c.id })` includes

```ts
{
  repertoires: [{ name: 'Londono sistema', side: 'white', createdAt: '2026-10-17T08:00:00.000Z', pgn: expect.stringContaining('[Event "c1"]') }],
  personalNotes: [{ repertoire: 'Londono sistema', position: expect.any(String), san: 'd4', text: 'Nepamiršti', updatedAt: '2026-10-17T08:00:00.000Z' }],
}
```

  and the exported PGN imports back (`importPgn(pgn, 'white')`) to the stored graph's moves and comments. Another account's repertoire is never in it.
- [ ] **Step 2:** `pnpm --filter @mychess/db test`. Expected: FAIL.
- [ ] **Step 3: Implement** `personal-notes.ts`:

```ts
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Executor } from './client';
import { personalNotes } from './schema';

export interface PersonalNoteInput {
  readonly playerId: string;
  readonly repertoireId: string;
  readonly moveKey: string;
  /** Checked by the domain's personalNoteSchema; '' deletes the note. */
  readonly text: string;
  readonly now: Date;
}

const notePk = (n: Pick<PersonalNoteInput, 'playerId' | 'repertoireId' | 'moveKey'>) =>
  and(eq(personalNotes.playerAccountId, n.playerId), eq(personalNotes.repertoireId, n.repertoireId), eq(personalNotes.moveKey, n.moveKey));

/** Sets or removes one player's private note on a move (R-21). The caller checked access. */
export async function setPersonalNote(db: Executor, note: PersonalNoteInput): Promise<void> {
  if (note.text === '') {
    await db.delete(personalNotes).where(notePk(note));
    return;
  }
  await db
    .insert(personalNotes)
    .values({ playerAccountId: note.playerId, repertoireId: note.repertoireId, moveKey: note.moveKey, text: note.text, updatedAt: note.now })
    .onConflictDoUpdate({
      target: [personalNotes.playerAccountId, personalNotes.repertoireId, personalNotes.moveKey],
      set: { text: note.text, updatedAt: note.now },
    });
}

const noteRowsSchema = z.array(z.object({ moveKey: z.string(), text: z.string() }));

/** One player's notes on one repertoire, by move key; never anyone else's. */
export async function listPersonalNotes(db: Executor, playerId: string, repertoireId: string): Promise<Record<string, string>> {
  const rows = noteRowsSchema.parse(
    await db.select({ moveKey: personalNotes.moveKey, text: personalNotes.text }).from(personalNotes)
      .where(and(eq(personalNotes.playerAccountId, playerId), eq(personalNotes.repertoireId, repertoireId))),
  );
  return Object.fromEntries(rows.map((r) => [r.moveKey, r.text]));
}
```

`accounts.ts`: `AccountExport` gains

```ts
  /** The account's repertoires, each as PGN (R-40), oldest first. */
  readonly repertoires: readonly {
    readonly name: string;
    readonly side: Side;
    readonly createdAt: string;
    readonly pgn: string;
  }[];
  /** The account's personal notes (R-21), by repertoire name and move. */
  readonly personalNotes: readonly {
    readonly repertoire: string;
    /** The position the move is played from, as a FEN (fenOf). */
    readonly position: string;
    readonly san: string;
    readonly text: string;
    readonly updatedAt: string;
  }[];
```

  `exportAccount(db, id, now, options: { chapterTitle?: (chapter: Chapter) => string } = {})` builds them with two helpers, each parsed with zod: `exportedRepertoires` (`listRepertoires` + `loadRepertoire` per item + `exportPgn(graph, options.chapterTitle === undefined ? {} : { title: options.chapterTitle })`) and `exportedNotes` (a join of `personal_notes` with `repertoires` on the player id, ordered by repertoire `created_at` then `move_key`; `position` is `fenOf` of the key's part before the last `|`, `san` the part after). The S1 callers keep working (the options are optional).
- [ ] **Step 4:** `pnpm --filter @mychess/db test`, then `node quality/gate.mjs check`. Expected: PASS.

### Task 11: The repertoire screen note (ux-designer) - UX

**Files:** Create `docs/design/repertoire-screen.md`. Modify `docs/design/README.md` (list it).

- [ ] **Step 1:** Write the screen note in the style of `training-screen.md`, at 390px first and then 1280px, for:
  - **Mano repertuarai** (`/repertuarai`): the list grouped by side (Baltaisiais / Juodaisiais), each item with its name, chapter and move counts and last change; "new repertoire" (name, side) and "Import PGN"; the empty state.
  - **The repertoire page** (`/repertuarai/[id]`): header (name, rename, download PGN, add from PGN, delete); the chapter list (select, rename, delete, add in builder mode); the board (flipped for Black); under it (phone) or beside it (desktop panel) the move list (main line and variations, the current move marked), back and forward buttons, the typed-move field, and the panel with the chapter intro (at the root), the move's comment and the player's personal note (marked private); a browse/builder switch. Builder: playing a move adds it; "remove this move" with an inline confirmation naming how many moves go; draw mode with four colours; comment editing. The promotion choice in the panel. The stale-version message with "reload". Nothing overlays the board.
  - **Import** (`/repertuarai/importuoti`): file and side, then the summary (chapters with names, lines, positions, transpositions, moves, and the skipped games list with game number and reason), then the target (new with a name, or an existing repertoire of that side, whose merged summary replaces the first), then confirm; refusals (too large, too many games, too deep, no valid game) shown in the panel naming the limit.
  - Keyboard: the board is one tab stop (arrows move the cursor, Enter/Space picks and drops, Escape cancels), the typed-move field follows it, then the panel in visual order; the cursor square and each result are announced politely.
- [ ] **Step 2:** Report the note to the lead; web-dev builds Tasks 13 to 19 from it.

### Task 12: Dependencies and configuration (web-dev)

**Files:** Modify `apps/web/package.json`, `pnpm-lock.yaml`, `apps/web/next.config.ts`, `apps/web/src/lib/routes.ts`.

- [ ] **Step 1:** `pnpm --filter @mychess/web add chessground@9.2.1 @mychess/chess@workspace:* --save-exact`. Confirm `node_modules/chessground/package.json` says `9.2.1` and `GPL-3.0-or-later`.
- [ ] **Step 2:** `next.config.ts`: add to `config` (decision 15):

```ts
  // A PGN upload is posted as text to a server action: up to 2 MB (R-66)
  // plus the form's own overhead. The action re-checks every limit.
  experimental: { serverActions: { bodySizeLimit: '3mb' } },
```

- [ ] **Step 3:** `routes.ts`:

```ts
export const ROUTES = {
  home: '/',
  signIn: '/prisijungti',
  onboarding: '/pradzia',
  settings: '/nustatymai',
  repertoires: '/repertuarai',
  repertoireImport: '/repertuarai/importuoti',
} as const;

/** One repertoire's page (browse and builder). */
export const repertoireRoute = (id: string): string => `${ROUTES.repertoires}/${id}`;

/** One repertoire's PGN download. */
export const repertoireExportRoute = (id: string): string => `/api/repertoires/${id}/export`;

/** The import page with an existing repertoire chosen as the target. */
export const importIntoRoute = (id: string): string =>
  `${ROUTES.repertoireImport}?i=${encodeURIComponent(id)}`;
```

- [ ] **Step 4:** `node quality/gate.mjs check`. Expected: PASS, apart from knip reporting `chessground` and the new route helpers as unused; Tasks 13 to 19 use them. Report it.

### Task 13: The board component (web-dev) - UX

**Files:** Create in `apps/web/src/app/board/`: `board.tsx`, `board.test.tsx`, `board-config.ts`, `board-config.test.ts`, `squares.ts`, `squares.test.ts`, `shapes.ts`, `shapes.test.ts`, `cursor.ts`, `cursor.test.ts`, `move-input.tsx`, `move-input.test.tsx`, `promotion-picker.tsx`, `promotion-picker.test.tsx`, `board.css`. Modify both catalogues.

- [ ] **Step 1: Write the failing pure tests.**
  - `squares.test.ts`: `isKey('e4')` true, `isKey('i9')`/`isKey('e44')` false; `squaresOf('e2e4')` is `['e2', 'e4']`, `squaresOf('e7e8q')` is `['e7', 'e8']`, `squaresOf('')` is `[]`; `destsOf([{ orig: 'g1', dest: 'f3', ... }, { orig: 'g1', dest: 'h3', ... }])` is `new Map([['g1', ['f3', 'h3']]])`.
  - `cursor.test.ts`: from `e4` with White at the bottom, `ArrowUp` -> `e5`, `ArrowRight` -> `f4`; with Black at the bottom, `ArrowUp` -> `e3`, `ArrowRight` -> `d4`; at `h8` with White, `ArrowUp` and `ArrowRight` stay `h8`; `Tab` -> null (not a cursor key).
  - `shapes.test.ts`: `shapesOf({ arrows: [{ from: 'g1', to: 'f3', color: 'G' }], circles: [{ square: 'd4', color: 'R' }] })` is `[{ orig: 'g1', dest: 'f3', brush: 'green' }, { orig: 'd4', brush: 'red' }]`; `marksOf` reverses it; `toggleMark(marks, 'g1', 'f3', 'G')` removes an existing green arrow, `toggleMark(marks, 'g1', 'f3', 'B')` recolours it, `toggleMark(marks, 'd4', 'd4', 'Y')` adds or toggles a circle.
  - `board-config.test.ts`: `boardConfig(view)` sets `movable.free` false, `premovable.enabled` false, `movable.dests` to the view's dests, `lastMove` to `[]` when the view has none, `highlight.custom` to `new Map([['e4', 'cursor']])` for a cursor at `e4`, `drawable.eraseOnClick` false, and `drawable.shapes`/`autoShapes` from the view.
- [ ] **Step 2: Implement the pure modules.** `squares.ts`:

```ts
import type { BoardMove } from '@mychess/chess';
import type { Key } from 'chessground/types';

const SQUARE = /^[a-h][1-8]$/;

/** Is `value` a board square chessground knows? */
export function isKey(value: string): value is Key {
  return SQUARE.test(value);
}

/** The two squares of a UCI move, or none for anything else. */
export function squaresOf(uci: string): Key[] {
  const orig = uci.slice(0, 2);
  const dest = uci.slice(2, 4);
  return isKey(orig) && isKey(dest) ? [orig, dest] : [];
}

/** Chessground's destinations map from the position's legal moves. */
export function destsOf(moves: readonly BoardMove[]): Map<Key, Key[]> {
  const dests = new Map<Key, Key[]>();
  for (const { orig, dest } of moves) {
    if (!isKey(orig) || !isKey(dest)) continue;
    const list = dests.get(orig) ?? [];
    if (!list.includes(dest)) list.push(dest);
    dests.set(orig, list);
  }
  return dests;
}
```

`cursor.ts`:

```ts
import type { Key } from 'chessground/types';
import { isKey } from './squares';

const FILES = 'abcdefgh';

/** File and rank steps per arrow key, as seen with White at the bottom. */
function stepFor(key: string): readonly [number, number] | null {
  switch (key) {
    case 'ArrowUp': return [0, 1];
    case 'ArrowDown': return [0, -1];
    case 'ArrowLeft': return [-1, 0];
    case 'ArrowRight': return [1, 0];
    default: return null;
  }
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/** The square the keyboard cursor moves to, or null for a key that is not an arrow. */
export function stepCursor(from: Key, key: string, orientation: 'white' | 'black'): Key | null {
  const step = stepFor(key);
  if (step === null) return null;
  const sign = orientation === 'white' ? 1 : -1;
  const file = clamp(FILES.indexOf(from.charAt(0)) + step[0] * sign, 0, 7);
  const rank = clamp(Number(from.charAt(1)) + step[1] * sign, 1, 8);
  const next = `${FILES.charAt(file)}${String(rank)}`;
  return isKey(next) ? next : from;
}

/** Where the cursor starts: the bottom-left square. */
export const cursorStart = (orientation: 'white' | 'black'): Key => (orientation === 'white' ? 'a1' : 'h8');
```

`shapes.ts`:

```ts
import type { Arrow, Circle, MarkColor, Marks } from '@mychess/chess';
import type { DrawShape } from 'chessground/draw';
import { isKey } from './squares';

const BRUSHES: Record<MarkColor, string> = { G: 'green', R: 'red', Y: 'yellow', B: 'blue' };
const COLORS: ReadonlyMap<string, MarkColor> = new Map([['green', 'G'], ['red', 'R'], ['yellow', 'Y'], ['blue', 'B']]);

/** A move's arrows and circles as chessground shapes. */
export function shapesOf({ arrows, circles }: Marks): DrawShape[] {
  const lines = arrows.flatMap((a): DrawShape[] =>
    isKey(a.from) && isKey(a.to) ? [{ orig: a.from, dest: a.to, brush: BRUSHES[a.color] }] : [],
  );
  const rings = circles.flatMap((c): DrawShape[] =>
    isKey(c.square) ? [{ orig: c.square, brush: BRUSHES[c.color] }] : [],
  );
  return [...lines, ...rings];
}

/** The shapes drawn with the mouse, as marks; a brush we do not use is skipped. */
export function marksOf(shapes: readonly DrawShape[]): Marks {
  const arrows: Arrow[] = [];
  const circles: Circle[] = [];
  for (const shape of shapes) {
    const color = COLORS.get(shape.brush ?? '');
    if (color === undefined) continue;
    if (shape.dest === undefined || shape.dest === shape.orig) circles.push({ square: shape.orig, color });
    else arrows.push({ from: shape.orig, to: shape.dest, color });
  }
  return { arrows, circles };
}

/**
 * Draw mode's tap (decision 16): the same square twice toggles a circle,
 * two squares toggle an arrow. The same colour again removes the mark; another
 * colour recolours it.
 */
export function toggleMark(marks: Marks, orig: string, dest: string, color: MarkColor): Marks {
  if (orig === dest) {
    const other = marks.circles.filter((c) => c.square !== orig);
    const same = marks.circles.some((c) => c.square === orig && c.color === color);
    return { ...marks, circles: same ? other : [...other, { square: orig, color }] };
  }
  const other = marks.arrows.filter((a) => a.from !== orig || a.to !== dest);
  const same = marks.arrows.some((a) => a.from === orig && a.to === dest && a.color === color);
  return { ...marks, arrows: same ? other : [...other, { from: orig, to: dest, color }] };
}
```

`board-config.ts`:

```ts
import type { Config } from 'chessground/config';
import type { DrawShape } from 'chessground/draw';
import type { Key } from 'chessground/types';

/** Everything the board shows, as plain data the page computes. */
export interface BoardView {
  readonly fen: string;
  readonly orientation: 'white' | 'black';
  readonly turnColor: 'white' | 'black';
  readonly check: boolean;
  readonly lastMove: readonly Key[];
  /** The legal destinations; empty while saving, in draw mode, or read-only. */
  readonly dests: ReadonlyMap<Key, readonly Key[]>;
  /** Shapes the person may change with the mouse (builder). */
  readonly shapes: readonly DrawShape[];
  /** Shapes shown only (browsing). */
  readonly autoShapes: readonly DrawShape[];
  /** Mouse drawing on (builder). */
  readonly drawing: boolean;
  /** Bumped to put the pieces back after a move the page did not take. */
  readonly revision: number;
}

/** Chessground's configuration for a view and the keyboard cursor (Verified library API). */
export function boardConfig(view: BoardView, cursor: Key | null): Config {
  return {
    fen: view.fen,
    orientation: view.orientation,
    turnColor: view.turnColor,
    check: view.check,
    lastMove: [...view.lastMove],
    coordinates: true,
    highlight: { lastMove: true, check: true, custom: new Map(cursor === null ? [] : [[cursor, 'cursor']]) },
    movable: { free: false, color: view.turnColor, showDests: true, dests: new Map([...view.dests].map(([k, v]) => [k, [...v]])) },
    premovable: { enabled: false },
    draggable: { enabled: true, showGhost: true },
    drawable: {
      enabled: view.drawing,
      visible: true,
      eraseOnClick: false,
      defaultSnapToValidMove: false,
      shapes: [...view.shapes],
      autoShapes: [...view.autoShapes],
    },
  };
}
```

- [ ] **Step 3: Write the failing component test** `board.test.tsx`. Mock chessground and capture the configuration:

```tsx
import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ground = vi.hoisted(() => ({
  created: [] as { config: Record<string, unknown> }[],
  set: vi.fn(),
  selectSquare: vi.fn(),
  destroy: vi.fn(),
}));

vi.mock('chessground', () => ({
  Chessground: (_el: HTMLElement, config: Record<string, unknown>) => {
    ground.created.push({ config });
    return { set: ground.set, selectSquare: ground.selectSquare, destroy: ground.destroy, state: { pieces: new Map() } };
  },
}));
vi.mock('chessground/assets/chessground.base.css', () => ({}));
vi.mock('chessground/assets/chessground.cburnett.css', () => ({}));
```

  Cases:
  - mounting creates one board whose config has `movable.free === false` and the view's `fen`; unmounting calls `destroy` once;
  - a new view with another `fen` calls `set` with that `fen` (the board is not re-created);
  - calling the captured `movable.events.after('e2', 'e4')` inside `act` calls `onMove('e2', 'e4')`, also after a re-render with a new `onMove` (the latest handler, `useEffectEvent`);
  - the captured `events.select('d4')` calls `onSquare('d4')`; the captured `drawable.onChange([...])` calls `onShapes`;
  - keyboard: focus the board (`screen.getByRole('application', { name: ... })`), press ArrowUp from the start: the next `set` call has `highlight.custom` `Map { 'a2' => 'cursor' }` and the live region reads the `describe('a2')` text; Enter calls `selectSquare('a2')`; Escape calls `selectSquare(null)`.
- [ ] **Step 4: Implement** `board.tsx`:

```tsx
'use client';

import { Chessground } from 'chessground';
import type { Api } from 'chessground/api';
import type { DrawShape } from 'chessground/draw';
import type { Key } from 'chessground/types';
import 'chessground/assets/chessground.base.css';
import 'chessground/assets/chessground.cburnett.css';
import './board.css';
import {
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent,
} from 'react';
import { boardConfig, type BoardView } from './board-config';
import { cursorStart, stepCursor } from './cursor';

export interface BoardProps {
  readonly view: BoardView;
  /** The accessible name of the board (a catalogue text). */
  readonly label: string;
  /** What to announce for the cursor square: square, then piece or empty. */
  readonly describe: (square: Key) => string;
  readonly onMove: (orig: Key, dest: Key) => void;
  /** Every square pressed or chosen with Enter (draw mode uses it). */
  readonly onSquare?: (square: Key) => void;
  /** The shapes drawn with the mouse (builder). */
  readonly onShapes?: (shapes: DrawShape[]) => void;
}

/**
 * The chessground board (R-97): created once on mount, reconfigured when the
 * view changes, destroyed on unmount. One tab stop: the arrow keys move a
 * cursor, Enter or Space picks up and drops, Escape cancels
 * (docs/design/training-screen.md, Keyboard).
 */
export function Board({ view, label, describe, onMove, onSquare, onShapes }: BoardProps): JSX.Element {
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);
  const [cursor, setCursor] = useState<Key | null>(null);
  const [said, setSaid] = useState('');
  const config = useMemo(() => boardConfig(view, cursor), [view, cursor]);
  const first = useRef(config);

  const moved = useEffectEvent((orig: Key, dest: Key) => { onMove(orig, dest); });
  const pressed = useEffectEvent((square: Key) => { onSquare?.(square); });
  const drawn = useEffectEvent((shapes: DrawShape[]) => { onShapes?.(shapes); });

  useEffect(() => {
    const element = host.current;
    if (element === null) return undefined;
    const ground = Chessground(element, {
      ...first.current,
      movable: { ...first.current.movable, events: { after: (orig, dest) => { moved(orig, dest); } } },
      events: { select: (square) => { pressed(square); } },
      drawable: { ...first.current.drawable, onChange: (shapes) => { drawn(shapes); } },
    });
    api.current = ground;
    return () => {
      ground.destroy();
      api.current = null;
    };
  }, []);

  useEffect(() => {
    api.current?.set(config);
  }, [config]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const at = cursor ?? cursorStart(view.orientation);
    const next = stepCursor(at, event.key, view.orientation);
    if (next !== null) {
      event.preventDefault();
      setCursor(next);
      setSaid(describe(next));
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setCursor(at);
      api.current?.selectSquare(at);
    } else if (event.key === 'Escape') {
      api.current?.selectSquare(null);
    }
  }

  return (
    <div className="flex flex-col">
      <div
        ref={host}
        role="application"
        aria-label={label}
        tabIndex={0}
        onKeyDown={onKeyDown}
        className="aspect-square w-full rounded-board focus-visible:outline-board-focus"
      />
      <p aria-live="polite" className="sr-only">{said}</p>
    </div>
  );
}
```

  If the lint run says an effect event is referenced outside an effect, keep it inside the mount effect's closures as above; do not add a suppression. If `Chessground`'s parameter types reject the spread (`events` of `movable`), build the mount config with a small typed helper `withEvents(config, handlers): Config` in `board-config.ts` and test it there.

`board.css` (tokens only, decision 16):

```css
/* The board in the design tokens (docs/design/README.md, "Board").
   chessground.base.css lays the board out; its brown theme is not imported,
   so the squares are coloured here. */
cg-board {
  background: conic-gradient(
      var(--color-board-dark) 25%,
      var(--color-board-light) 0 50%,
      var(--color-board-dark) 0 75%,
      var(--color-board-light) 0
    )
    0 0 / 25% 25%;
}
cg-board square.last-move { background-color: var(--color-board-last-move); }
cg-board square.selected { background-color: var(--color-board-selected); }
cg-board square.move-dest { background: radial-gradient(var(--color-board-target) 22%, transparent 23%); }
cg-board square.move-dest.oc { background: radial-gradient(transparent 79%, var(--color-board-target) 80%); }
cg-board square.check { background: radial-gradient(ellipse at center, var(--color-board-check) 0%, transparent 89%); }
/* The keyboard cursor, inset so it stays inside its square. */
cg-board square.cursor { box-shadow: inset 0 0 0 3px var(--color-board-focus); }
.cg-wrap coords { font-size: var(--text-xs); }
```

  Check the light square sits at a8 (top left with White below); if not, swap the two colours and note it.

`move-input.tsx` (client): a labelled text field (`board.moveInput.label`) and a submit button (`board.moveInput.submit`); on submit it calls `onTyped(text)` and clears the field; `submitByHand`-style handler (no reset on refusal). Test: typing `Nf3` and pressing Enter calls `onTyped('Nf3')`.

`promotion-picker.tsx` (client): four buttons (queen, rook, bishop, knight, labels `board.promotion.q` ...) in a `role="group"` labelled `board.promotion.title`; `onPick('q' | 'r' | 'b' | 'n')`, `onCancel`. Test: clicking the knight calls `onPick('n')`.

Catalogue keys under `board` (both languages, LT first, plain drafts for i18n-content): `label` ("Šachmatų lenta"), `cursor` ("{square}: {piece}"), `empty` ("tuščias"), `pieces.white.{king,queen,rook,bishop,knight,pawn}`, `pieces.black.{...}`, `moveInput.label`, `moveInput.submit`, `moveInput.unknown` ("Tokio ėjimo šioje padėtyje nėra."), `promotion.title`, `promotion.{q,r,b,n}`.
- [ ] **Step 5:** `pnpm --filter @mychess/web test:component`, then `node quality/gate.mjs check`. Expected: PASS.

### Task 14: Server plumbing and access (web-dev) - SECURITY

**Files:** Create `apps/web/src/server/repertoires.ts`, `apps/web/src/server/repertoire-edit.ts`, `apps/web/src/server/repertoire-edit.test.ts`, `apps/web/src/server/chapter-names.ts`, `apps/web/src/server/chapter-names.test.ts`, `apps/web/test/feature/support/repertoires.ts`. Modify `apps/web/test/feature/support/request.ts` (`notFound`).

- [ ] **Step 1: Write the failing tests.**
  - `repertoire-edit.test.ts` (pure): `editRequestSchema` accepts each op kind with valid fields and refuses: an unknown `kind`, a non-uuid `repertoireId`, `version: 0`, 65 arrows, a 2,001-character comment (issue `comment.tooLong`), a blank chapter name (`chapter.nameBlank`). `applyEdit(graph, op)` for each kind gives the same result as calling the chess function directly (`addMove`, `removeMove`, `setMarks`, `editComment`, `addChapter` from the standard start, `renameChapter`, `removeChapter`), and passes chess refusals through (`repertoire.illegalMove` for `{ kind: 'addMove', san: 'Ke2' }` at the start).
  - `chapter-names.test.ts`: `chapterTitle(t, 'lt')` gives an ECO chapter its Lithuanian name (`ecoName`), a custom or header chapter its name, and an index chapter the catalogue text `chapter.untitled` with its number; `ecoNamesOf(graph, 'en')` maps exactly the ECO codes the graph's chapters use to their English names.
- [ ] **Step 2: Implement** `repertoire-edit.ts`:

```ts
import {
  addChapter,
  addMove,
  editComment,
  marksInputSchema,
  removeChapter,
  removeMove,
  renameChapter,
  setMarks,
  START_KEY,
  type EditRefusal,
  type RepertoireGraph,
  type Result,
} from '@mychess/chess';
import { chapterNameSchema, commentSchema } from '@mychess/domain';
import { z } from 'zod';

const chapterId = z.string().min(1).max(20);
const from = z.string().min(1).max(100);
const san = z.string().min(1).max(10);

/** One builder edit, as the client sends it (parsed at the edge). */
export const editOpSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('addMove'), chapterId, from, san }),
  z.object({ kind: z.literal('removeMove'), chapterId, from, san }),
  z.object({ kind: z.literal('setMarks'), chapterId, from, san, marks: marksInputSchema }),
  z.object({ kind: z.literal('editComment'), moveKey: z.string().min(1).max(120), comment: commentSchema }),
  z.object({ kind: z.literal('addChapter') }),
  z.object({ kind: z.literal('renameChapter'), chapterId, name: chapterNameSchema }),
  z.object({ kind: z.literal('removeChapter'), chapterId }),
]);
export type EditOp = z.infer<typeof editOpSchema>;

export const editRequestSchema = z.object({
  repertoireId: z.uuid(),
  version: z.number().int().positive(),
  op: editOpSchema,
});

/** The chess function that decides each edit (the action only routes to it). */
export function applyEdit(graph: RepertoireGraph, op: EditOp): Result<RepertoireGraph, EditRefusal> {
  switch (op.kind) {
    case 'addMove': return addMove(graph, op.chapterId, op.from, op.san);
    case 'removeMove': return removeMove(graph, op.chapterId, op.from, op.san);
    case 'setMarks': return setMarks(graph, op.chapterId, { from: op.from, san: op.san }, op.marks);
    case 'editComment': return editComment(graph, op.moveKey, op.comment);
    case 'addChapter': return { ok: true, value: addChapter(graph, START_KEY).graph };
    case 'renameChapter': return renameChapter(graph, op.chapterId, op.name);
    case 'removeChapter': return removeChapter(graph, op.chapterId);
  }
}
```

`repertoires.ts`:

```ts
import { loadRepertoire, type LoadedRepertoire } from '@mychess/db';
import {
  canEditRepertoire,
  canViewRepertoire,
  REPERTOIRE_REFUSALS,
  type Account,
  type RepertoireAccessRefusal,
  type Result,
} from '@mychess/domain';
import { z } from 'zod';
import { getDb } from './db';

type Own = Result<LoadedRepertoire, RepertoireAccessRefusal>;

const NOT_FOUND: Own = { ok: false, refusal: { reason: REPERTOIRE_REFUSALS.notFound } };

/**
 * The repertoire `id` if `account` may view (or edit) it: the id is parsed,
 * the query filters by owner, and the domain rule decides (CLAUDE.md:
 * decided in the domain, enforced again in the query). A missing and a
 * foreign repertoire read the same (decision 12).
 */
export async function ownRepertoire(account: Account, id: string, purpose: 'view' | 'edit'): Promise<Own> {
  const parsed = z.uuid().safeParse(id);
  if (!parsed.success) return NOT_FOUND;
  const loaded = await loadRepertoire(getDb(), parsed.data, account.id);
  if (loaded === undefined) return NOT_FOUND;
  const rule = purpose === 'edit' ? canEditRepertoire : canViewRepertoire;
  const allowed = rule(account, loaded.repertoire);
  return allowed.ok ? { ok: true, value: loaded } : allowed;
}
```

`chapter-names.ts`:

```ts
import { chapterName, ecoName, type Chapter, type RepertoireGraph } from '@mychess/chess';
import type { Locale } from '@mychess/domain';

/** The translator part chapter names need (next-intl's `t`). */
export type ChapterTranslator = (key: 'chapter.untitled', values: { number: number }) => string;

/** What to call a chapter in `locale`: its name, its opening, or "Chapter N". */
export function chapterTitle(t: ChapterTranslator, locale: Locale): (chapter: Chapter) => string {
  return (chapter) => {
    const name = chapterName(chapter.nameSource, locale);
    return name.kind === 'text' ? name.text : t(name.key, { number: name.number });
  };
}

/** The opening names the client needs for this graph's ECO chapters (decision 17). */
export function ecoNamesOf(graph: RepertoireGraph, locale: Locale): Record<string, string> {
  const codes = graph.chapters.flatMap((c) => (c.nameSource.kind === 'eco' ? [c.nameSource.eco] : []));
  return Object.fromEntries(codes.map((code) => [code, ecoName(code, locale)]));
}
```

  The translator for routes and the data export comes from `createTranslator({ locale, messages: MESSAGES[locale] })` (as `src/server/mail.ts` does), so it needs no request.
- [ ] **Step 3:** Feature-test support. In `support/request.ts` add:

```ts
/** The error the mocked `notFound` throws. */
export class NotFound extends Error {
  constructor() {
    super('not found');
  }
}
```

  `nextNavigation()` returns `{ redirect, notFound: () => { throw new NotFound(); } }` (its return type gains `notFound: () => never`), and `outcomeOf` maps a `NotFound` to `{ notFound: true }`. Create `support/repertoires.ts` with `LONDON` and `TAIMANOV` PGN strings (copy the persona lines from `docs/personas/u1400.md` and `1400-2000.md`, the Taimanov with two comments and one nested variation), and `seedRepertoire(db, ownerEmail, pgn, side)` that imports and calls `createRepertoire`, returning the id.
- [ ] **Step 4:** `pnpm --filter @mychess/web test:component`, `pnpm --filter @mychess/web test:feature` (existing suites still pass with the extended mock), then `node quality/gate.mjs check`. Expected: PASS.

### Task 15: Mano repertuarai: the list and new repertoire (web-dev) - UX

**Files:** Create `apps/web/src/app/repertuarai/page.tsx`, `page.test.tsx`, `repertoire-list.tsx`, `repertoire-list.test.tsx`, `create-form.tsx`, `create-form.test.tsx`, `actions.ts`, `apps/web/src/server/repertoire-input.ts`, `repertoire-input.test.ts`, `apps/web/test/feature/repertoires.test.ts`. Modify `apps/web/src/app/home-view.tsx` (a link), both catalogues.

- [ ] **Step 1: Write the failing tests.**
  - `repertoire-input.test.ts`: `parseNewRepertoire(form)` returns `{ ok: true, value: { name: 'Londono sistema', side: 'white' } }` for a trimmed name and `white`; refuses a blank name (`repertoire.nameBlank`), 81 characters (`repertoire.nameTooLong`), and side `red` (`repertoire.sideInvalid`; add this key to `REPERTOIRE_ISSUES` in the domain through backend-dev, and `z.enum(SIDES, REPERTOIRE_ISSUES.sideInvalid)` in the parser).
  - Feature `repertoires.test.ts` (mocks as in `onboarding.test.ts`, plus `next/cache`):
    - `createRepertoireAction({}, form('Londono sistema', 'white'))` for an onboarded account redirects to `/repertuarai/<uuid>`, and the row exists with version 1 and no chapters;
    - a blank name returns `{ refusal: 'repertoire.nameBlank' }` and creates nothing;
    - signed out, it redirects to `/prisijungti` and creates nothing;
    - `listRepertoires` behind the page shows only the account's own repertoires (seed one for another account).
  - `repertoire-list.test.tsx`: renders two groups (`repertoires.list.white`, `repertoires.list.black`), items sorted by name with `Intl.Collator(locale)`, each a link to `repertoireRoute(id)` with the counts (`repertoires.list.meta` with `{chapters}` and `{moves}` plurals); the empty state when there are none.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3: Implement.** `actions.ts` (`'use server'`):

```ts
export interface CreateState {
  readonly refusal?: NewRepertoireRefusalKey;
}

/** Creates an empty repertoire (name and side) and opens it in builder mode (decision 18). */
export async function createRepertoireAction(_previous: CreateState, form: FormData): Promise<CreateState> {
  const account = await requireOnboarded();
  const input = parseNewRepertoire(form);
  if (!input.ok) return { refusal: input.refusal.reason };
  const id = await createRepertoire(getDb(), {
    ownerId: account.id,
    side: input.value.side,
    name: input.value.name,
    graph: { side: input.value.side, chapters: [], moves: [] },
    now: new Date(),
  });
  redirect(repertoireRoute(id));
}
```

  `page.tsx` (server): `requireOnboarded()`, `listRepertoires(getDb(), account.id)`, renders the header (`repertoires.list.title` "Mano repertuarai", a link back home), `<RepertoireList>`, `<CreateForm>` (name field, side radio group, submit; `useActionState`, `submitByHand`, `StatusLine` for refusals) and a link to `ROUTES.repertoireImport` (`repertoires.list.import`). `home-view.tsx` gains a link to `ROUTES.repertoires` (`app.repertoires`). Layout and classes per `docs/design/repertoire-screen.md`; buttons from `buttons.ts`.

  Catalogue keys (draft LT, then EN): `app.repertoires`; `repertoires.list.{title, intro, white, black, empty, meta, import, home}`; `repertoires.create.{title, name, side, white, black, submit}`; `repertoire.{nameBlank, nameTooLong, sideInvalid}`.
- [ ] **Step 4:** Tests pass; `node quality/gate.mjs check` passes. Report screenshots at 390px and 1280px, LT and EN, light and dark, for ux-designer.

### Task 16: The repertoire page: browsing (web-dev) - UX

**Files:** Create in `apps/web/src/app/repertuarai/[id]/`: `page.tsx`, `page.test.tsx`, `screen-state.ts`, `screen-state.test.ts`, `repertoire-screen.tsx`, `repertoire-screen.test.tsx`, `chapter-list.tsx`, `chapter-list.test.tsx`, `move-list.tsx`, `move-list.test.tsx`, `move-panel.tsx`, `move-panel.test.tsx`, `repertoire-header.tsx`, `repertoire-header.test.tsx`, `actions.ts`. Create `apps/web/test/feature/repertoire-page.test.ts`. Modify both catalogues.

- [ ] **Step 1: Write the failing tests.**
  - `screen-state.test.ts` (pure reducer, the heart of the page):

```ts
// With the LONDON graph (support file of Task 14, imported with importPgn):
// - initial state: first chapter selected, path [], mode 'browse' (or 'build' for a graph without chapters);
// - { type: 'goto', path } then { type: 'back' } drops the last move; 'back' at the root stays;
// - { type: 'forward' } follows the chapter's first child (the main line, R-79); at a leaf it stays;
// - { type: 'chapter', chapterId } resets the path;
// - { type: 'saved', graph, version } keeps the longest prefix of the path still in the chapter
//   (keepPath), with the moves replaced by the new objects (a new comment shows), bumps nothing else;
// - { type: 'refused', reason } sets the message to that key in the error tone; 'repertoire.stale' also sets `stale: true`;
// - { type: 'reset' } bumps `revision` (the board puts the pieces back).
```

    Write each bullet as an `it` with concrete moves (`d4`, `d5`, `Bf4`).
  - `move-list.test.tsx`: renders the chapter tree (`chapterTree`) with move numbers (`1. d4 d5 2. Bf4`, a variation in parentheses `(3... c5 4. c3)`), every move a button; the current move has `aria-current="true"`; clicking `c5` calls `onGoto` with the path `[d4, d5, Bf4, Nf6, e3, c5]` (the moves from the root).
  - `move-panel.test.tsx`: at the root shows the chapter intro; on a move shows its comment (or `repertoires.panel.noComment`) and the personal note field labelled `repertoires.note.label` with the hint `repertoires.note.private`; saving calls `onSaveNote(text)`.
  - `chapter-list.test.tsx`: lists the chapters by `chapterTitle` (an ECO name from `ecoNames`, a custom name, `chapter.untitled` with its number); selecting calls `onSelect`; rename and delete appear only in builder mode (Task 17 adds them).
  - Feature `repertoire-page.test.ts`: the page for the owner renders (call the default export and check it returns an element); for another account's id and for `not-a-uuid` it calls `notFound()` (`{ notFound: true }`); signed out it redirects to sign-in. `savePersonalNoteAction` stores a note for the owner, deletes it with `''`, refuses a 2,001-character note (`personalNote.tooLong`), and refuses another account's repertoire with `repertoire.notFound` without writing. `renameRepertoireAction` and `deleteRepertoireAction` work for the owner, return `repertoire.notFound` for a foreign id, and delete redirects to `/repertuarai`.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3: Implement.** `screen-state.ts`:

```ts
import { chapterChildren, moveKey, type MarkColor, type RepertoireGraph, type RepertoireMove } from '@mychess/chess';

export interface ScreenMessage {
  readonly key: string;
  readonly tone: 'success' | 'error' | 'info';
  readonly values?: Readonly<Record<string, string | number>>;
}

export interface ScreenState {
  readonly graph: RepertoireGraph;
  readonly version: number;
  readonly chapterId: string | null;
  /** The moves from the chapter's root to the shown position. */
  readonly path: readonly RepertoireMove[];
  readonly mode: 'browse' | 'build';
  readonly drawMode: boolean;
  readonly drawColor: MarkColor;
  /** Draw mode's first tapped square, waiting for the second. */
  readonly drawFrom: string | null;
  readonly saving: boolean;
  readonly stale: boolean;
  readonly message: ScreenMessage | null;
  readonly revision: number;
}

export type ScreenAction =
  | { readonly type: 'chapter'; readonly chapterId: string }
  | { readonly type: 'goto'; readonly path: readonly RepertoireMove[] }
  | { readonly type: 'back' }
  | { readonly type: 'forward' }
  | { readonly type: 'mode'; readonly mode: 'browse' | 'build' }
  | { readonly type: 'saving' }
  | { readonly type: 'saved'; readonly graph: RepertoireGraph; readonly version: number; readonly path?: readonly RepertoireMove[]; readonly chapterId?: string }
  | { readonly type: 'refused'; readonly reason: string; readonly values?: Readonly<Record<string, string | number>> }
  | { readonly type: 'say'; readonly message: ScreenMessage | null }
  | { readonly type: 'reset' }
  | { readonly type: 'draw'; readonly on: boolean }
  | { readonly type: 'drawColor'; readonly color: MarkColor }
  | { readonly type: 'drawFrom'; readonly square: string | null };

/** The longest start of `path` still in the chapter, with today's move objects. */
export function keepPath(graph: RepertoireGraph, chapterId: string | null, path: readonly RepertoireMove[]): RepertoireMove[] {
  if (chapterId === null) return [];
  const held = new Map(graph.moves.filter((m) => m.chapters.includes(chapterId)).map((m) => [moveKey(m.from, m.san), m]));
  const kept: RepertoireMove[] = [];
  for (const move of path) {
    const now = held.get(moveKey(move.from, move.san));
    if (now === undefined) break;
    kept.push(now);
  }
  return kept;
}

/** The position the screen shows: after the path, or the chapter's root. */
export function currentKey(state: ScreenState): string | null {
  const last = state.path.at(-1);
  if (last !== undefined) return last.to;
  return state.graph.chapters.find((c) => c.id === state.chapterId)?.rootKey ?? null;
}

export function initialState(graph: RepertoireGraph, version: number): ScreenState { /* first chapter, browse unless no chapters */ }
export function screenReducer(state: ScreenState, action: ScreenAction): ScreenState { /* one small case per action; split helpers to keep complexity <= 10 */ }
```

  `forward` uses `chapterChildren(state.graph)(chapterId)(currentKey)` and takes the first.

  `page.tsx` (server):

```tsx
export default async function RepertoirePage({ params }: { readonly params: Promise<{ id: string }> }): Promise<JSX.Element> {
  const account = await requireOnboarded();
  const own = await ownRepertoire(account, (await params).id, 'view');
  if (!own.ok) notFound();
  const { repertoire, graph } = own.value;
  const notes = await listPersonalNotes(getDb(), account.id, repertoire.id);
  return (
    <RepertoireScreen
      key={repertoire.version}
      repertoire={{ id: repertoire.id, name: repertoire.name, side: repertoire.side, version: repertoire.version }}
      graph={graph}
      notes={notes}
      ecoNames={ecoNamesOf(graph, account.locale)}
    />
  );
}
```

  `key={repertoire.version}` makes a reload after a stale save (`router.refresh()`) start the client state afresh.

  `repertoire-screen.tsx` (client) holds `useReducer(screenReducer, ...)` and composes: `RepertoireHeader` (name with rename form, `repertoireExportRoute(id)` download link `repertoires.header.download`, `importIntoRoute(id)` link, delete with a two-step confirm), `ChapterList`, `Board` (view from the state: `fenOf(key)`, orientation = side, `turnColor` from `sideToMove`, `check: inCheck(key)`, `lastMove: squaresOf(last.uci)`, `dests: destsOf(legalMoves(key))` memoised on `key` and empty while `saving`, `autoShapes: shapesOf(last)` when browsing), the back and forward buttons (`repertoires.nav.back`, `repertoires.nav.forward`), `MoveInput`, `MoveList`, `MovePanel`, and a `StatusLine` for `state.message` (with a "reload" button calling `router.refresh()` when `stale`). Board moves while browsing: the SAN (via `legalMoves` and, when several promotions match, `PromotionPicker`) of a move the chapter has at this position navigates to it; any other move says `repertoires.board.notInRepertoire` and dispatches `reset`. The typed move goes the same way (`findLegalMove`; none -> `board.moveInput.unknown`). The board's `describe` uses `board.cursor` with the piece from `chess.js`-free data: pass `describe` a lookup built from `fenOf(key)` by a tiny pure parser `pieceAt(fen, square)` in `board/squares.ts` (test it).

  `actions.ts` (`'use server'`): `savePersonalNoteAction(input: unknown)`, `renameRepertoireAction(_prev, form)`, `deleteRepertoireAction(_prev, form)`; each: `requireOnboarded()`, parse with zod (`personalNoteSchema`, `repertoireNameSchema`, uuid ids, `moveKey` max 120), `ownRepertoire(account, id, 'view')` for the note (R-21: a viewer's own note) and `'edit'` for rename and delete, then the repository call. Return `{ ok: true } | { ok: false, refusal }`; delete redirects to `ROUTES.repertoires`.

  Catalogue keys: `repertoires.header.{rename, renameSubmit, download, importInto, delete, deleteConfirm, deleteCancel, deleted}`, `repertoires.chapters.{title, empty}`, `repertoires.nav.{back, forward, start}`, `repertoires.panel.{intro, comment, noComment}`, `repertoires.note.{label, private, save, saved}`, `repertoires.board.notInRepertoire`, `repertoires.stale.{text, reload}`, `repertoire.{notFound, stale}`, `personalNote.tooLong`, `chapter.untitled` ("{number} skyrius" / "Chapter {number}").
- [ ] **Step 4:** Tests pass; gate passes; screenshots as in Task 15.

### Task 17: Builder mode (web-dev) - UX - SECURITY

**Files:** Modify `apps/web/src/app/repertuarai/[id]/actions.ts`, `repertoire-screen.tsx`, `chapter-list.tsx`, `move-panel.tsx`, `screen-state.ts` and their tests. Create `builder-bar.tsx`, `builder-bar.test.tsx`, `apps/web/test/feature/repertoire-edit.test.ts`. Modify both catalogues.

- [ ] **Step 1: Write the failing feature tests** `repertoire-edit.test.ts` (Rokas onboarded; `seedRepertoire` with an empty chapterless repertoire and with `LONDON`):
  - `addChapter` on an empty repertoire returns `{ ok: true, version: 2, graph }` with one chapter `c1` "Chapter 1"; then `addMove` `d4` from the start returns version 3 and the stored graph has the move;
  - an illegal move returns `{ ok: false, refusal: 'repertoire.illegalMove' }` and the version stays;
  - a second answer returns `repertoire.secondAnswer`;
  - `removeMove` of `Bf4` in the London's first chapter removes the moves only it reached and keeps the KID chapter's `Bf4` (`2. Bf4` is a different position there: check by `from`);
  - `setMarks` and `editComment` store marks and the normalised comment; a comment of 2,001 characters returns `comment.tooLong`;
  - `renameChapter` stores a custom name; `removeChapter` removes the chapter and its only-its moves;
  - a request with the version before the last save returns `repertoire.stale` and changes nothing;
  - Rimantas (another onboarded account) editing Rokas's repertoire id returns `repertoire.notFound` and changes nothing; a malformed request (`{ op: { kind: 'dropTable' } }`) returns a refusal without touching the database;
  - signed out: redirect to sign-in.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3: Implement** `editRepertoireAction` in `actions.ts`:

```ts
export type EditOutcome =
  | { readonly ok: true; readonly graph: RepertoireGraph; readonly version: number }
  | { readonly ok: false; readonly refusal: string };

const refused = (refusal: string): EditOutcome => ({ ok: false, refusal });

/** The catalogue key of a request's first issue; anything unexpected reads as illegal input. */
const issueKey = (error: z.ZodError): string => {
  const message = error.issues[0]?.message ?? '';
  return message.includes('.') ? message : 'repertoire.invalidEdit';
};

/**
 * One builder edit (spec: authenticate, load, call the chess function that
 * decides, save). The graph is reloaded at the client's version: an older
 * version is refused before anything is computed, and the save refuses a
 * race in its own transaction.
 */
export async function editRepertoireAction(input: unknown): Promise<EditOutcome> {
  const account = await requireOnboarded();
  const request = editRequestSchema.safeParse(input);
  if (!request.success) return refused(issueKey(request.error));
  const own = await ownRepertoire(account, request.data.repertoireId, 'edit');
  if (!own.ok) return refused(own.refusal.reason);
  const { repertoire, graph } = own.value;
  if (repertoire.version !== request.data.version) return refused(REPERTOIRE_REFUSALS.stale);
  const edited = applyEdit(graph, request.data.op);
  if (!edited.ok) return refused(edited.refusal.reason);
  const saved = await saveRepertoireEdit(getDb(), {
    id: repertoire.id,
    ownerId: account.id,
    expectedVersion: repertoire.version,
    before: graph,
    after: edited.value,
    now: new Date(),
  });
  return saved.ok ? { ok: true, graph: edited.value, version: saved.value.version } : refused(saved.refusal.reason);
}
```

  Add `repertoire.invalidEdit` to both catalogues (zod's own messages have no dot, so they become this key).

  Client (`repertoire-screen.tsx`), builder mode (`mode: 'build'`, switched by a `role="switch"` button `repertoires.mode.build`):
  - a board move or typed move not in the chapter dispatches `saving`, calls `editRepertoireAction({ repertoireId, version, op: { kind: 'addMove', chapterId, from: key, san } })` in `startTransition`, then `saved` with the path extended by the new move (found in the returned graph by `from` and `san`), or `refused` and `reset`;
  - `builder-bar.tsx`: "remove this move" (on a move only): first press shows the inline confirmation `repertoires.builder.removeConfirm` with `{san}` and `{count}` = moves the chess `removeMove` preview drops (`graph.moves.length - preview.moves.length`, computed client-side), then confirm sends `removeMove`; "draw" toggle (`aria-pressed`) with the four colour buttons (`repertoires.builder.colors.{G,R,Y,B}`, each with its colour and its name); draw mode empties the board's dests, and `onSquare` taps go `drawFrom` -> `toggleMark` -> `setMarks`; mouse drawing (`view.drawing` true, `shapes = shapesOf(last)`) sends `setMarks` with `marksOf(shapes)`; at the chapter root draw is disabled (no move to hold marks);
  - `move-panel.tsx` in builder mode: the comment becomes a textarea with save (`editComment` op, `moveKey(last.from, last.san)`);
  - `chapter-list.tsx` in builder mode: "add chapter" (`addChapter`; select the new last chapter after `saved`), rename inline (`renameChapter`), delete with an inline two-step confirm (`removeChapter`);
  - the board is not movable while `saving`; every refusal shows in the status line; `repertoire.stale` shows the reload button.

  Catalogue keys: `repertoires.mode.{browse, build}`, `repertoires.builder.{remove, removeConfirm, removeCancel, removeDone, draw, colors.G, colors.R, colors.Y, colors.B, drawAtRoot, commentLabel, commentSave, commentSaved}`, `repertoires.chapters.{add, rename, renameSubmit, delete, deleteConfirm, deleteCancel}`, `repertoire.{unknownChapter, illegalMove, unknownPosition, secondAnswer, unknownMove, invalidEdit}`, `chapter.{nameBlank, nameTooLong}`, `comment.tooLong`.
- [ ] **Step 4:** Component tests for `builder-bar.tsx` (the confirmation names the count; draw toggle and colours have accessible names and `aria-pressed`), and for the screen with `editRepertoireAction` mocked (a board move in builder mode sends `addMove` with the current key; a refusal shows its catalogue text and resets the board). Feature tests pass; gate passes; screenshots as in Task 15, including draw mode and the removal confirmation.

### Task 18: PGN download, data export and deletion text (web-dev) - SECURITY

**Files:** Create `apps/web/src/app/api/repertoires/[id]/export/route.ts`, `apps/web/src/server/pgn-download.ts`, `pgn-download.test.ts`, `apps/web/test/feature/repertoire-export.test.ts`. Modify `apps/web/src/app/api/account/export/route.ts`, `apps/web/test/feature/export.test.ts`, `apps/web/src/app/nustatymai/delete-section.tsx` (and its test), both catalogues.

- [ ] **Step 1: Write the failing tests.**
  - `pgn-download.test.ts`: `pgnFileName('Sicilijos gynyba, Taimanovo variantas')` is `sicilijos-gynyba-taimanovo-variantas.pgn`; `pgnFileName('„Šach“ #1')` is `sach-1.pgn`; `pgnFileName('???')` is `repertuaras.pgn`; `contentDisposition('Ąžuolas')` is `attachment; filename="azuolas.pgn"; filename*=UTF-8''%C4%84%C5%BEuolas.pgn`.
  - Feature `repertoire-export.test.ts` (mock `next/headers`, `server/db`, `server/auth`):
    - `GET` signed out: 401, `cache-control: no-store`;
    - Rokas's repertoire id as Rimantas, a random uuid, and `not-a-uuid`: 404 each, no body;
    - Rokas's own Taimanov: 200, `content-type: application/x-chess-pgn; charset=utf-8`, the disposition from `contentDisposition(name)`, and the body re-imports (`importPgn(body, 'black')`) to the stored graph: same moves (`from`, `san`), comments, arrows, circles and chapter membership, compared as in `export-pgn.test.ts`'s `canonical` with comments (G-M1-6); chapter titles in the body are the account's language (`[Event "Sicilijos gynyba..."]` for `lt`).
  - `export.test.ts`: the account data export now has `repertoires` (with `pgn`) and `personalNotes`, only the requester's; the chapter titles are in the account's language.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3: Implement** `pgn-download.ts`:

```ts
/** The download's file name: ASCII, lower case, hyphens; a fallback when nothing is left. */
export function pgnFileName(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${slug === '' ? 'repertuaras' : slug}.pgn`;
}

/** An attachment header that is safe to send: ASCII name, and the real name per RFC 6266. */
export function contentDisposition(name: string): string {
  return `attachment; filename="${pgnFileName(name)}"; filename*=UTF-8''${encodeURIComponent(name)}.pgn`;
}
```

  `route.ts`:

```ts
import { exportPgn } from '@mychess/chess';
import { createTranslator } from 'next-intl';
import { MESSAGES } from '../../../../../i18n/locales';
import { chapterTitle } from '../../../../../server/chapter-names';
import { contentDisposition } from '../../../../../server/pgn-download';
import { ownRepertoire } from '../../../../../server/repertoires';
import { getAccount } from '../../../../../server/session';

const NO_STORE = { 'cache-control': 'no-store' };

/** One repertoire as PGN (spec, R-96): its owner only; no fresh sign-in needed (decision 13). */
export async function GET(
  _request: Request,
  { params }: { readonly params: Promise<{ id: string }> },
): Promise<Response> {
  const account = await getAccount();
  if (account === null) return new Response(null, { status: 401, headers: NO_STORE });
  const own = await ownRepertoire(account, (await params).id, 'view');
  if (!own.ok) return new Response(null, { status: 404, headers: NO_STORE });
  const t = createTranslator({ locale: account.locale, messages: MESSAGES[account.locale] });
  const pgn = exportPgn(own.value.graph, { title: chapterTitle(t, account.locale) });
  return new Response(pgn, {
    headers: {
      ...NO_STORE,
      'content-type': 'application/x-chess-pgn; charset=utf-8',
      'content-disposition': contentDisposition(own.value.repertoire.name),
    },
  });
}
```

  If `createTranslator`'s `t` does not fit `ChapterTranslator` as typed, wrap it: `(key, values) => t(key, values)`. The account export route passes `{ chapterTitle: chapterTitle(t, account.locale) }` to `exportAccount`. The delete section's list gains `repertoires` (`settings.delete.items.repertoires`: "repertuarai, jų skyriai, ėjimai, komentarai ir asmeninės pastabos;" draft) and its test checks the item.
- [ ] **Step 4:** Tests pass; gate passes.

### Task 19: PGN import (web-dev) - UX - SECURITY

**Files:** Create in `apps/web/src/app/repertuarai/importuoti/`: `page.tsx`, `page.test.tsx`, `import-flow.tsx`, `import-flow.test.tsx`, `import-summary.tsx`, `import-summary.test.tsx`, `actions.ts`. Create `apps/web/src/server/import-preview.ts`, `apps/web/test/feature/repertoire-import.test.ts`. Modify both catalogues.

- [ ] **Step 1: Write the failing feature tests** `repertoire-import.test.ts`:
  - `previewImportAction({ text: TAIMANOV_WITH_BROKEN, side: 'black' })` returns `{ ok: true, preview }` with `preview.summary` (`chapters: 6`, `lines: 6`, `transpositions` >= 1, the counts from `summarize`), `preview.chapters` names, and `preview.skipped` `[{ game: 7, reason: 'pgn.illegalMove', san: ... }]`; `preview.target` null;
  - with `into` Gabija's existing Black repertoire, the preview's `target` names it with its version and `added` counts (chapters and moves the merge adds), and second answers against it appear in `skipped`;
  - `into` a White repertoire for a Black upload: `repertoire.sideMismatch`; `into` another account's id: `repertoire.notFound`;
  - limits name the limit: 2 MB + 1 byte -> `{ ok: false, refusal: 'pgn.tooLarge', limit: 2097152 }`; 201 `[Event` games -> `pgn.tooManyGames`, 200; 65 nested parentheses -> `pgn.tooDeep`, 64; a file with only broken games -> `pgn.noValidGames`;
  - `confirmImportAction({ text, side, target: { kind: 'new', name: 'Taimanovas' } })` redirects to the new repertoire, which loads to the imported graph; a blank name refuses `repertoire.nameBlank` and creates nothing;
  - `confirmImportAction` with `{ kind: 'existing', id, version }` merges (chapters added after the existing ones) and redirects; with a version older than the stored one: `repertoire.stale`, nothing written;
  - signed out: redirect to sign-in.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3: Implement** `import-preview.ts` (server helper, used by both actions):

```ts
import {
  chapterName,
  importPgn,
  mergeInto,
  summarize,
  type ChapterName,
  type ImportedRepertoire,
  type RepertoireGraph,
  type RepertoireSummary,
  type Side,
  type Skipped,
} from '@mychess/chess';

export interface ImportPreview {
  readonly summary: RepertoireSummary;
  readonly chapters: readonly ChapterName[];
  readonly skipped: readonly Skipped[];
  readonly target: null | {
    readonly id: string;
    readonly name: string;
    readonly version: number;
    readonly added: { readonly chapters: number; readonly moves: number };
  };
}

export type ImportRefusalKey = string;
export interface ImportRefused {
  readonly ok: false;
  readonly refusal: ImportRefusalKey;
  readonly limit?: number;
}
```

  `previewImportAction(input: unknown)` (`'use server'` in `actions.ts`): `requireOnboarded()`; parse `{ text: z.string(), side: sideSchema, into: z.uuid().optional() }`; `importPgn(text, side)` (refusals carry `limit` for the three limit keys); without `into`: preview of the import (`summarize(imported.graph)`, `chapters` = `chapterName(c.nameSource, account.locale)` for each, `skipped`); with `into`: `ownRepertoire(account, into, 'edit')`, `mergeInto(loaded.graph, imported)` (refusal `repertoire.sideMismatch`), `summary` of the merged graph, `skipped` = import skips plus merge skips, `target` with `added = { chapters: merged.chapters.length - loaded.chapters.length, moves: merged.moves.length - loaded.moves.length }`.

  `confirmImportAction(input: unknown)`: parse `{ text, side, target: z.discriminatedUnion('kind', [{ kind: 'new', name: repertoireNameSchema }, { kind: 'existing', id: z.uuid(), version: z.number().int().positive() }]) }`; re-import (never trust the preview); new -> `createRepertoire` with the imported graph; existing -> `ownRepertoire(..., 'edit')`, version check, `mergeInto`, `saveRepertoireEdit(before = loaded, after = merged)` (decision 6); then `redirect(repertoireRoute(id))`.

  `page.tsx`: `requireOnboarded()`, `listRepertoires` (for the existing-target choices, by side), the `?i=` id preselected when it is one of the account's repertoires. `import-flow.tsx` (client), steps in one panel:
  1. file input (`accept=".pgn,application/x-chess-pgn,text/plain"`, label `repertoires.import.file`) and side radio; on submit: a file over 2 MB is refused at once with `pgn.tooLarge` (the server checks again); else `await file.text()` and `previewImportAction`;
  2. `import-summary.tsx`: chapters (names, translating `{ kind: 'key' }` names with `chapter.untitled`), the five counts (`repertoires.import.summary.*` with plurals), and the skipped list (`repertoires.import.skippedItem`: "{game} partija: {reason}" with the reason translated from `pgn.*`, plus `{san}` and the move number when present);
  3. target: "new repertoire" with a name field (prefilled with nothing) or "add to" a select of the account's repertoires of the chosen side (none: the option is disabled with `repertoires.import.noneOfSide`); choosing an existing one re-runs the preview with `into` and shows its merged summary and `added`;
  4. confirm (`repertoires.import.confirm`), disabled while pending.
  Every refusal shows in the `StatusLine`, with `{limit}` filled (bytes shown as MB: `limit / 1048576`).

  Catalogue keys: `repertoires.import.{title, intro, file, side, preview, summaryTitle, summary.chapters, summary.lines, summary.positions, summary.transpositions, summary.moves, skippedTitle, skippedNone, skippedItem, skippedMove, targetTitle, targetNew, targetExisting, noneOfSide, name, added, confirm, back}`; `pgn.{unreadable, illegalMove, unbalancedVariation, variationWithoutMove, invalidFen, noMoves, secondAnswer, tooLarge, tooManyGames, tooDeep, noValidGames}`; `repertoire.sideMismatch`.
- [ ] **Step 4:** Component tests: the flow shows the summary from a mocked `previewImportAction`; a file over 2 MB is refused without calling the action; the target switch re-runs the preview with `into`. Feature tests pass; gate passes; screenshots as in Task 15 (upload, summary with skipped games, add-to-existing).

### Task 20: Lithuanian and English review (i18n-content) - UX

**Files:** Modify `apps/web/src/i18n/messages/{lt,en}.json`, `docs/glossary-lt.md`. Create `apps/web/src/i18n/refusals.test.ts`.

- [ ] **Step 1:** Review every key added in Tasks 13 to 19 for correct, natural Lithuanian and plain English, using the glossary: repertuaras, skyrius, ėjimas, variantas (Line), padėtis, ėjimų perstatymas, baltaisiais / juodaisiais, asmeninė pastaba, lenta, importuoti, PGN. Plurals carry `one`, `few` and `many` (glossary rule). Quotation marks „...“.
- [ ] **Step 2:** Propose the glossary rows the slice needs, marked **proposed**: Comment (decision of Task 1, question 4; candidates: **komentaras** if the owner moves threads to another word, or **paaiškinimas**), Builder (e.g. **kūrimo režimas**), Arrow (**rodyklė**), Circle (**apskritimas** or **žymė**), Chapter intro (**skyriaus įžanga**), Draw mode, Import summary, Skipped game (**praleista partija**), Download PGN (**atsisiųsti PGN**, not "eksportuoti", as for the data export).
- [ ] **Step 3:** Write `refusals.test.ts`: every refusal key the server can return is in both catalogues. List them explicitly (chess `EditRefusal` reasons, `SkipReason`, `LimitRefusal` reasons, `pgn.noValidGames`, `repertoire.sideMismatch`, every `REPERTOIRE_ISSUES` and `REPERTOIRE_REFUSALS` value, `repertoire.invalidEdit`, `chapter.untitled`), so a new reason without text fails.
- [ ] **Step 4:** `pnpm --filter @mychess/web test:component`, then `node quality/gate.mjs check`. Report every changed key with the reason.

### Task 21: E2E journeys (qa)

**Files:** Create `apps/web/e2e/support/board.ts`, `apps/web/e2e/fixtures/taimanov.pgn`, `apps/web/e2e/repertoires.spec.ts`.

- [ ] **Step 1:** `fixtures/taimanov.pgn`: Gabija's six Taimanov lines from `docs/personas/1400-2000.md`, one game per line with an `[Event]` tag per line label, a chapter intro on the first, at least three move comments (one Lithuanian with diacritics, e.g. "jei 9.Na4, tai Be7"), one `[%cal]` arrow, one nested variation (two levels), and a seventh game with an illegal move (to show a skipped game). Check it with a quick unit run before using it (`importPgn` gives six chapters and one skip).
- [ ] **Step 2:** `support/board.ts`:

```ts
import type { Page } from '@playwright/test';

/** The centre of `square` on the page's board, with `orientation` at the bottom. */
async function squareCentre(page: Page, square: string, orientation: 'white' | 'black'): Promise<{ x: number; y: number }> {
  const box = await page.locator('cg-board').boundingBox();
  if (box === null) throw new Error('no board on the page');
  const file = 'abcdefgh'.indexOf(square.charAt(0));
  const rank = Number(square.charAt(1)) - 1;
  const column = orientation === 'white' ? file : 7 - file;
  const row = orientation === 'white' ? 7 - rank : rank;
  const size = box.width / 8;
  return { x: box.x + (column + 0.5) * size, y: box.y + (row + 0.5) * size };
}

/** Plays a move by tapping (phone) or clicking (desktop) its two squares: chessground's tap-tap. */
export async function playOnBoard(page: Page, isMobile: boolean, orig: string, dest: string, orientation: 'white' | 'black' = 'white'): Promise<void> {
  for (const square of [orig, dest]) {
    const { x, y } = await squareCentre(page, square, orientation);
    if (isMobile) await page.touchscreen.tap(x, y);
    else await page.mouse.click(x, y);
  }
}
```

- [ ] **Step 3:** `repertoires.spec.ts` (both projects, phone and desktop; fresh accounts via `newOnboardedAccount`; names include the journey IDs):
  - **U1-M1-5 (own part): Rokas builds the London on a phone.** From home open Mano repertuarai, create "Londono sistema" (White); the page opens in builder mode; add a chapter; play `1. d4` and `1... d5` and `2. Bf4` on the board by tapping (`playOnBoard`), the rest of the first London line by the typed-move field; go back to the root, play `1... Nf6` and the KID line by typing; add a comment on `2. Bf4` and a green arrow in draw mode; reload: both lines are in the move list, the comment and the arrow are there; the repertoire is listed with its counts. In both LT and EN (EN via the account language set in settings).
  - **G-M1-2: Gabija imports the Taimanov on desktop.** Import page: choose the fixture and Black, see the summary: six chapters, six lines, at least one transposition, and "7 partija" skipped with the illegal-move reason; choose "new repertoire", name it, confirm; the repertoire page shows six chapters with Lithuanian opening names, the intro, and the comments on their moves (open the move, read the panel).
  - **G-M1-6: export re-imports to the same tree.** On the Taimanov page download the PGN (`page.waitForEvent('download')`), read it, then import that file as a new repertoire: the summary numbers equal the first import's minus the skipped game, and the same comments show on the same moves.
  - **Add to existing (R-101):** import a second small Black PGN into the Taimanov: the merged summary shows the added chapters; after confirm the repertoire has them after the first six.
  - **Keyboard:** on the London page, focus the board with Tab, move the cursor with the arrow keys to d2, Enter, to d4, Enter: in builder mode the move is added (desktop project only).
  - **Not someone else's:** a second account opening the first account's `/repertuarai/<id>` gets the not-found page, and `/api/repertoires/<id>/export` answers 404.
- [ ] **Step 4:** Locally: the E2E commands from the table at the top. Expected: all pass in both projects. Report the run's output.
- [ ] **Step 5:** Walk U1-M1-5 (own part), G-M1-2 and G-M1-6 against the spec's "Done means" and report any gap.

### Task 22: Security review (security-reviewer) - SECURITY

- [ ] **Step 1:** Review the slice's diff, in particular:
  - every page, action and route that takes a repertoire id goes through `ownRepertoire` (domain rule) and a query filtered by owner; a foreign id and a missing id are indistinguishable (status, body, timing within reason);
  - `saveRepertoireEdit`, `renameRepertoire`, `deleteRepertoire` and `setPersonalNote` callers cannot write another account's rows (owner in the `where`, access checked before the note write);
  - personal notes are never returned for another player (`listPersonalNotes` filters by player; the export holds only the requester's);
  - every action input is parsed with zod; `editRequestSchema` bounds strings and mark counts; no raw input reaches SQL (`keyColumn` and `inArray` are parameterised);
  - upload limits (R-66) are enforced server-side whatever the client does; the 3 MB body limit; a hostile PGN stays linear (S2's guarantees; `mergeInto` and `summarize` are linear);
  - the download's `content-disposition` cannot be broken by a repertoire name (quotes, CR/LF, non-ASCII); `no-store` on both downloads; decision 13 (no fresh sign-in for one repertoire's PGN) is acceptable or not;
  - account deletion removes every repertoire row (cascade test) and the data export holds the requester's repertoires and notes only.
- [ ] **Step 2:** Report findings as blocking or advisory. The lead routes blocking ones back to the owning task's role.

### Task 23: Visual sign-off (ux-designer) - UX

- [ ] **Step 1:** Screenshots of the list, the repertoire page (browse, builder, draw mode, removal confirmation, stale message) and the import flow (upload, summary with a skipped game, add to existing) at 390px and 1280px, LT and EN, light and dark; a keyboard pass (board cursor, typed move, panel order) and a 200% zoom check (`docs/design/README.md`, Sign-off).
- [ ] **Step 2:** Report what matches `docs/design/repertoire-screen.md`, what does not, and the fix; web-dev applies the fixes through the lead.

### Task 24: Close the slice (lead)

- [ ] **Step 1:** `node quality/gate.mjs check`, push. Expected: CI's check, mutation (changed files) and e2e jobs are green.
- [ ] **Step 2:** Bundle check (decision 17): after `pnpm --filter @mychess/web build`, `grep -rl "Sicilian Defense" apps/web/.next/static` finds nothing. If it does, the ECO table reached the client: report the size to the owner and file a follow-up rather than blocking.
- [ ] **Step 3:** The architect runs `mp-code-review` on the slice's diff since `3da8af6` (Standards and Spec axes) and `improve-codebase-architecture` on the slice's new files and what they touched; the lead routes "breaks a written rule" findings to their owners and presents the "could be better" candidates to the owner, who picks the "deepen" issues.
- [ ] **Step 4:** Run the `retro`.
- [ ] **Step 5:** Comment on #253 with the commit range, the CI run, and the owner answers from Task 1; close #253.

---

## Self-review against the spec

- **Chess:** comment on `RepertoireMove`, `importPgn` keeps comments, `exportPgn` writes them, export/import identical with comments (Task 2, property tests); `mergeInto` with transpositions, duplicate chapters, conflicting comments (Task 4); `editComment` (Task 3, signature as the spec writes it, decision 8); `removeChapter` (Task 3). Added beyond the spec, all needed by the spec's builder and import summary: `addChapter`, `renameChapter`, `summarize`, legal-move helpers, walks, schemas (decisions 7, 19).
- **Domain:** `repertoireNameSchema`, `chapterNameSchema` (trimmed, never blank, 80), `commentSchema`, `personalNoteSchema` (2,000), `canViewRepertoire`, `canEditRepertoire` (owner only) (Task 6).
- **Database:** the five tables, cascades from repertoire and from account (Task 7); `loadRepertoire` parsed with zod, `saveRepertoireEdit` minimal diff with version check, `createRepertoire` one transaction, import into existing as one transaction (decision 6), `listRepertoires`, rename, delete (Tasks 8, 9); personal notes upsert/delete and the data export with repertoires as PGN and notes (Task 10).
- **Web:** the board (tap-tap, drag, arrows and circles, flipped for Black, last move, keyboard) (Task 13); "Mano repertuarai" (Task 15); the repertoire page with chapters (rename, delete), browsing, comment, intro, personal note, PGN download (Tasks 16, 18); builder mode (Task 17); PGN import with summary, skipped games, new or existing, confirm (Task 19); server actions authenticate, load, call the deciding function, save (Tasks 15 to 19).
- **Testing:** chess unit and property tests (Tasks 2 to 5); db round trips, stale refusal, cascade, rows touched (Tasks 7, 9, 10); feature tests for create, import new and add, edit, delete, foreign ids refused, limits naming the limit (Tasks 15 to 19); E2E U1-M1-5 (own part), G-M1-2, G-M1-6 in LT and EN on phone and desktop (Task 21); UX and i18n reviews (Tasks 20, 23); security review (Task 22).
- **Done means:** Task 24, with the owner answers of Task 1.
