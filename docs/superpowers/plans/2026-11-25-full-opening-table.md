# Full opening table Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Name taxonomy chapters from every named lichess-org/chess-openings line, derived when titles are built (#377, R-216, spec `docs/superpowers/specs/2026-11-25-full-opening-table-design.md`).

**Architecture:** The generator keeps every TSV row and stores each line's final position key. `classify.ts` matches position keys against the full table; a chapter's opening is read from its main line's `to` keys (no chess.js replay). `taxonomyNames(graph, locale)` gives each taxonomy-named chapter its derived name, and every title path (web labels, R-158 distinctions, PGN and data export) uses it. Nothing new is stored.

**Tech Stack:** TypeScript, chess.js, vitest, Next.js (apps/web), pnpm workspace.

**Run tests:** `pnpm --filter @mychess/chess exec vitest run <file>`; web: `pnpm --filter @mychess/web exec vitest run --config vitest.component.config.ts <file>`. Never edit gate configs.

---

### Task 1: The full table with position keys

**Files:**
- Modify: `packages/chess/src/openings/eco-tsv.ts`, `packages/chess/src/openings/eco-tsv.test.ts`
- Modify: `packages/chess/src/openings/data/eco.ts`, `packages/chess/scripts/generate-eco.mjs`
- Regenerate: `packages/chess/src/openings/data/eco.json`
- Modify: `packages/chess/src/openings/eco-coverage.test.ts`, `packages/chess/src/openings/eco-lt-piece-letters.test.ts`

- [ ] **Step 1: Failing test for `withPositionKeys`** (append to `eco-tsv.test.ts`, import it)

```ts
describe('withPositionKeys', () => {
  it('adds the key of the position each line ends in', () => {
    const [entry] = withPositionKeys([
      { code: 'B00', name: "King's Pawn Game", moves: ['e4'] },
    ]);
    expect(entry?.key).toBe(
      'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -',
    );
  });

  it('throws at an illegal move: the source data is broken', () => {
    expect(() =>
      withPositionKeys([{ code: 'X99', name: 'Bad', moves: ['e4', 'Ke3'] }]),
    ).toThrow('ECO X99: illegal move Ke3');
  });
});
```

- [ ] **Step 2: Run, expect FAIL** (`withPositionKeys` not exported).

- [ ] **Step 3: Implement** in `eco-tsv.ts`: parse into `EcoLine` (an entry without `key`), add `withPositionKeys`, make `oneEntryPerCode` generic. Update the header comment: the pure half of the generator, which now keeps every line.

```ts
import { Chess } from 'chess.js';
import { positionKey } from '../position-key';
import type { EcoEntry } from './data/eco';

/** A TSV row before its position key is computed. */
export type EcoLine = Omit<EcoEntry, 'key'>;

// parseRow and parseEcoTsv return EcoLine / EcoLine[] (bodies unchanged).

/**
 * Each line with the key of the position it ends in (R-216: lines are
 * matched by position). An illegal move means the source data is broken,
 * so it throws, naming the line.
 */
export function withPositionKeys(lines: readonly EcoLine[]): EcoEntry[] {
  return lines.map((line) => {
    const chess = new Chess();
    for (const san of line.moves) {
      try {
        chess.move(san);
      } catch {
        throw new Error(`ECO ${line.code}: illegal move ${san}`);
      }
    }
    return { ...line, key: positionKey(chess.fen()) };
  });
}

/** (doc unchanged: one entry per code, shortest line, first on a tie, sorted by code) */
export function oneEntryPerCode<T extends EcoLine>(entries: readonly T[]): T[] {
  // body unchanged, typed over T
}
```

- [ ] **Step 4: `data/eco.ts`**

```ts
// Every named line of lichess-org/chess-openings (CC0 1.0 Universal), with
// the key of the position it ends in (R-216). The data is `eco.json`, written
// by `scripts/generate-eco.mjs`; do not edit it by hand.
import { oneEntryPerCode } from '../eco-tsv';
import data from './eco.json' with { type: 'json' };

export interface EcoEntry {
  /** ECO code, `A00` to `E99`. */
  readonly code: string;
  /** English name, as lichess spells it. */
  readonly name: string;
  /** The line from the standard start position, in SAN. */
  readonly moves: readonly string[];
  /** The key of the position the line ends in, computed by the generator. */
  readonly key: string;
}

/** Every named line, in lichess order (later lines win a shared position). */
export const ECO: readonly EcoEntry[] = data;

/** Each code's family line: its shortest, the first on a tie. */
export const ECO_FAMILIES: readonly EcoEntry[] = oneEntryPerCode(ECO);
```

- [ ] **Step 5: Generator**: in `generate-eco.mjs` import `withPositionKeys` instead of `oneEntryPerCode`; `const entries = withPositionKeys(all);` and update its header comment ("every named line, with its final position key"). Run from `packages/chess`: `node scripts/generate-eco.mjs`. Expected: `Wrote ~3870 openings`.

- [ ] **Step 6: Coverage test**: in `eco-coverage.test.ts` turn `illegalLines` into `replayedKeys(lines): (string | null)[]` (the key after each line's last move, `null` when a move is illegal; same tree walk, recording `positionKey(game.fen())` at each node's `ends`). Tests:
  - "has a family line for every code from A00 to E99, in order": over `ECO_FAMILIES`.
  - "gives every entry an English name and stores the key its line reaches": `ECO.filter((e, i) => keys[i] !== e.key || e.name.trim() === '' || e.moves.length === 0)` is `[]`. Keep the `REPLAYING_THE_ECO_TREE` budget; update its comment's numbers after measuring.
  - "keeps known entries": `ECO.find(e => e.code === 'B90' && e.moves.length === 10)` equals the B90 object plus its `key`.
  - Lithuanian coverage tests: over `ECO_FAMILIES` codes.
  In `eco-lt-piece-letters.test.ts` use `ECO_FAMILIES` instead of `ECO`.

- [ ] **Step 7: Run** `pnpm --filter @mychess/chess exec vitest run src/openings` . Expected: eco-tsv and coverage pass; `classify.test.ts` may fail (Task 2).

- [ ] **Step 8: Commit** `feat(chess): the opening table keeps every named Lichess line with its position key (#377)`.

### Task 2: Classification over the full table

**Files:** Modify `packages/chess/src/openings/classify.ts`, `classify.test.ts`, `packages/chess/src/index.ts`

- [ ] **Step 1: Failing tests** (add to `classify.test.ts`)

```ts
describe('classify over every named line (R-216, #326)', () => {
  it('names the Open Catalan reached by the closed move order', () => {
    const line = ['d4', 'Nf6', 'c4', 'e6', 'g3', 'd5', 'Bg2', 'Be7', 'Nf3', 'O-O', 'O-O', 'dxc4'];
    expect(classify(line)?.name).toBe('Catalan Opening: Open Defense, Classical Line');
  });
  it('names the Caro-Kann Advance', () => {
    expect(classify(['e4', 'c6', 'd4', 'd5', 'e5'])?.name).toBe('Caro-Kann Defense: Advance Variation');
  });
  it('names the Smith-Morra Gambit', () => {
    expect(classify(['e4', 'c5', 'd4', 'cxd4', 'c3'])?.name).toBe('Sicilian Defense: Smith-Morra Gambit');
  });
  it('keeps the Moscow Variation', () => {
    expect(classify(['e4', 'c5', 'Nf3', 'd6', 'Bb5+'])?.name).toBe('Sicilian Defense: Moscow Variation');
  });
});

describe('classifyKeys', () => {
  it('takes the deepest named key, ignoring a key already passed', () => {
    const keyAfter = (sans: string[]) => withPositionKeys([{ code: 'X', name: 'X', moves: sans }])[0]?.key ?? '';
    const nf3 = keyAfter(['Nf3']);
    const nf3nf6 = keyAfter(['Nf3', 'Nf6']);
    expect(classifyKeys([nf3, nf3nf6, 'none', nf3])?.code).toBe('A05');
    expect(classifyKeys([])).toBeNull();
  });
});

describe('openingName', () => {
  it('is the line name in English and its code name in Lithuanian', () => {
    const entry = classify(['e4', 'c6', 'd4', 'd5', 'e5']);
    expect(entry && openingName(entry, 'en')).toBe('Caro-Kann Defense: Advance Variation');
    expect(entry && openingName(entry, 'lt')).toBe(ecoName('B12', 'lt'));
  });
});
```

Replace the `indexByPosition` tests: it indexes by `entry.key`, the later entry winning (two entries with the same `key`, expect only the second's code); the illegal-move case now lives in `withPositionKeys`.

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement** in `classify.ts`:

```ts
import { ECO, ECO_FAMILIES, type EcoEntry } from './data/eco';

/** Each named line's final position to its entry; a later line wins a shared position. */
export function indexByPosition(entries: readonly EcoEntry[]): ReadonlyMap<string, EcoEntry> {
  return new Map(entries.map((entry) => [entry.key, entry] as const));
}

const BY_POSITION = indexByPosition(ECO);
const FAMILY_BY_CODE: ReadonlyMap<string, EcoEntry> = new Map(
  ECO_FAMILIES.map((entry) => [entry.code, entry] as const),
);

/**
 * The deepest named line among `keys`, the positions a line passes through
 * in order. A position already passed (a repetition) is not a new match.
 */
export function classifyKeys(keys: readonly string[]): EcoEntry | null {
  const reached = new Set<string>();
  let found: EcoEntry | null = null;
  for (const key of keys) {
    if (!reached.has(key)) found = BY_POSITION.get(key) ?? found;
    reached.add(key);
  }
  return found;
}

/** (existing doc) */
export function classify(sans: readonly string[]): EcoEntry | null {
  const chess = new Chess();
  const keys: string[] = [];
  for (const san of sans) {
    if (!play(chess, san)) break;
    keys.push(positionKey(chess.fen()));
  }
  return classifyKeys(keys);
}

/** An ECO code's family name (its shortest line) ... (existing doc, lookup in FAMILY_BY_CODE). */
export function ecoName(eco: string, locale: Locale): string { /* BY_CODE -> FAMILY_BY_CODE */ }

/** A named line's name: English as lichess names the line; Lithuanian by its ECO code (R-216). */
export function openingName(entry: EcoEntry, locale: Locale): string {
  return locale === 'lt' ? (ECO_LT[entry.code] ?? entry.name) : entry.name;
}
```

Export `classifyKeys` and `openingName` from `src/index.ts` next to `classify`. Remove `ECO`'s module-load replay comment ("broken ECO data fails at startup"): the coverage test checks it.

- [ ] **Step 4: Run** `pnpm --filter @mychess/chess exec vitest run src/openings`. Existing expectations that assert a code may move to a deeper line of the same or a related code (e.g. the D37 transposition, C50). For each, check the line's name in `eco.json`; update the expected code only when the new answer is the deeper named line (say so in the test), never to make a wrong answer pass.

- [ ] **Step 5: Commit** `feat(chess): classify against every named line; openingName (#377)`.

### Task 3: Chapter opening, taxonomy names, distinctions

**Files:** Modify `packages/chess/src/repertoire/naming.ts`, `distinctions.ts`, their tests, `src/index.ts`

- [ ] **Step 1: Failing tests** in `naming.test.ts` (build graphs the way the existing tests there do, e.g. via `importPgn` or the builder helpers already used in that file):

```ts
describe('taxonomyNames (R-216)', () => {
  it('names an ECO chapter by the deepest named line of its main line', () => {
    const graph = graphOf('1. e4 c6 2. d4 d5 3. e5 Bf5'); // one chapter, stored { kind: 'eco', eco: 'B12' }
    expect([...taxonomyNames(graph, 'en').values()]).toEqual(['Caro-Kann Defense: Advance Variation']);
  });
  it('falls back to the stored code when the main line reaches no named line', () => {
    const graph = withNameSource(graphOf('1. a3 a6'), { kind: 'eco', eco: 'B12' });
    expect([...taxonomyNames(graph, 'en').values()]).toEqual([ecoName('B12', 'en')]);
  });
  it('leaves custom, header and numbered chapters out', () => {
    const graph = withNameSource(graphOf('1. e4 c6'), { kind: 'custom', name: 'Mine' });
    expect(taxonomyNames(graph, 'en').size).toBe(0);
  });
});
```

In `distinctions.test.ts`: a chapter stored as `E06` whose main line is the Open Catalan transposition (Task 2's line) has distinction `eco: 'E05'`.

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement** in `naming.ts`:

```ts
import { classifyKeys, ecoName, openingName, type Locale } from '../openings/classify';
import type { EcoEntry } from '../openings/data/eco';

/**
 * The named line a chapter's main line reaches (R-216), read from the
 * graph's position keys; null when the chapter does not start from the
 * standard start or reaches none.
 */
export function chapterOpening(chapter: Chapter, mainLine: readonly RepertoireMove[]): EcoEntry | null {
  if (chapter.rootKey !== START_KEY) return null;
  return classifyKeys(mainLine.map((move) => move.to));
}

// taxonomyNamed: `const entry = chapterOpening(chapter, mainLine);` (drop the
// rootKey check and the classify import); stores { kind: 'eco', eco: entry.code }.

/**
 * Each taxonomy-named chapter's opening name in `locale`, by chapter id:
 * the named line its main line reaches, else its stored code's family name.
 * Derived whenever titles are built, so nothing is stored (R-216).
 */
export function taxonomyNames(graph: RepertoireGraph, locale: Locale): ReadonlyMap<string, string> {
  const walks = chapterWalks(graph);
  return new Map(
    graph.chapters.flatMap((chapter) => {
      const source = chapter.nameSource;
      if (source.kind !== 'eco') return [];
      const entry = chapterOpening(chapter, walks(chapter.id).mainLine());
      const name = entry === null ? ecoName(source.eco, locale) : openingName(entry, locale);
      return [[chapter.id, name] as const];
    }),
  );
}
```

In `distinctions.ts` replace `ecoOf`:

```ts
/** The chapter's ECO code: its main line's named line's, else its stored taxonomy code, else none. */
function ecoOf(chapter: Chapter, line: readonly RepertoireMove[]): string | null {
  const code = chapterOpening(chapter, line)?.code;
  if (code !== undefined) return code;
  return chapter.nameSource.kind === 'eco' ? chapter.nameSource.eco : null;
}
```

Export `chapterOpening` and `taxonomyNames` from `src/index.ts`. Update the naming.ts header comment: lines from lichess-org/chess-openings (R-216), Lithuanian by code.

- [ ] **Step 4: Run** `pnpm --filter @mychess/chess exec vitest run`. Expected: all pass (fix any name expectations per Task 2 Step 4's rule).

- [ ] **Step 5: Commit** `feat(chess): chapters are named from their main line's named line, derived not stored (#377)`.

### Task 4: Export titles take the graph

**Files:** Modify `packages/chess/src/pgn/export-pgn.ts` (+ test), `packages/db/src/account-export.ts`

- [ ] **Step 1: Failing test** in `export-pgn.test.ts`: `exportPgn(graph, { title: (g) => (c) => \`${c.id}/${g.chapters.length}\` })` writes `[Event "<id>/<n>"]` for each chapter.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement**: `ExportOptions.title?: (graph: RepertoireGraph) => (chapter: Chapter) => string`, doc "How export names a chapter's game, given the repertoire (names are derived from it, R-216)"; inside `exportPgn`: `const title = options.title?.(graph) ?? chapterName;`. In `account-export.ts`, `chapterTitle?: (graph: RepertoireGraph) => (chapter: Chapter) => string` (import the type from `@mychess/chess`); pass-through unchanged.
- [ ] **Step 4: Run** chess and db typecheck: `pnpm --filter @mychess/chess exec tsc --noEmit -p .` and `pnpm --filter @mychess/db exec tsc --noEmit -p .`; chess tests pass.
- [ ] **Step 5: Commit** `refactor(chess): an export title is built from the graph (#377)`.

### Task 5: Web titles from taxonomy names

**Files:** Modify `apps/web/src/lib/chapter-label.ts` (+ test), `apps/web/src/server/chapter-names.ts` (+ test)

- [ ] **Step 1: Failing tests**: in `chapter-label.test.ts`, `plainChapterLabel(EN, { taxonomyNames: { c1: 'Caro-Kann Defense: Advance Variation' }, distinctions: {} })` names chapter `c1` (stored `eco: 'B12'`) that, and a chapter `c2` with no entry by its code `B12`. In `chapter-names.test.ts`, `chapterNamesOf(graphOf('1. e4 c6 2. d4 d5 3. e5'), 'en').taxonomyNames` holds that chapter's id to `'Caro-Kann Defense: Advance Variation'`, and `plainChapterTitleIn('en')(graph)(chapter)` returns the same.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement**

`chapter-label.ts`:
```ts
/** A taxonomy-named chapter's opening name, by its id and stored code. */
export type TaxonomyNameOf = (chapterId: string, eco: string) => string;

export interface ChapterNames {
  /** Each taxonomy-named chapter's opening name, by chapter id (R-216). */
  readonly taxonomyNames: Readonly<Record<string, string>>;
  readonly distinctions: Readonly<Record<string, ChapterDistinction>>;
}

export function baseTitle(t: ChapterTranslator, taxonomyNameOf: TaxonomyNameOf): (chapter: Chapter) => string {
  return ({ id, nameSource }) => {
    switch (nameSource.kind) {
      case 'custom':
      case 'header':
        return nameSource.name;
      case 'eco':
        return taxonomyNameOf(id, nameSource.eco);
      case 'index':
        return t('chapter.untitled', { number: nameSource.number });
    }
  };
}

/** ... a chapter the server sent no name for is called by its code, as `ecoName` does. */
export function plainChapterLabel(t: ChapterTranslator, names: ChapterNames): (chapter: Chapter) => string {
  return baseTitle(t, (id, eco) => names.taxonomyNames[id] ?? eco);
}
```
Remove `EcoNameOf`.

`chapter-names.ts`:
```ts
/** `baseTitle` over `graph`'s taxonomy names, in `locale`. */
function baseTitleIn(t: ChapterTranslator, graph: RepertoireGraph, locale: Locale): (chapter: Chapter) => string {
  const names = taxonomyNames(graph, locale);
  return baseTitle(t, (id, eco) => names.get(id) ?? ecoName(eco, locale));
}

/** What to call a repertoire's chapters in `locale` with no distinction, for the PGN download and the data export. */
export function plainChapterTitleIn(wanted: Locale): (graph: RepertoireGraph) => (chapter: Chapter) => string {
  const locale = resolveLocale(wanted);
  const t = translatorIn(locale);
  return (graph) => baseTitleIn(t, graph, locale);
}
```
`chapterLabelIn`: `const plain = baseTitleIn(t, graph, locale);`. `chapterNamesOf`: `taxonomyNames: Object.fromEntries(taxonomyNames(graph, resolveLocale(wanted)))`; delete `ecoNamesOf`. The two export routes keep `plainChapterTitleIn(account.locale)` (now the curried form `exportPgn` expects).

- [ ] **Step 4: Run** `pnpm --filter @mychess/web typecheck` and the web component tests for `src/lib` and `src/server`. Fix fixtures that build `ChapterNames` with `ecoNames` (grep `ecoNames` in `apps/web`).
- [ ] **Step 5: Commit** `feat(web): chapter titles use each chapter's derived opening name (#377)`.

### Task 6: Sweep, bundle check, gate

- [ ] **Step 1:** `grep -rn "ecoNames\|EcoNameOf" apps packages --include=*.ts --include=*.tsx` returns nothing outside node_modules.
- [ ] **Step 2:** Name expectations: run web component and feature tests (`node quality/gate.mjs check` covers them) and grep E2E specs for chapter titles that could change (`grep -rn "Defense\|Opening\|Gambit\|Game" apps/web/e2e/*.spec.ts`). Update an expectation only where the new name is the deeper named line of the same moves.
- [ ] **Step 3: Bundle check:** `pnpm --filter @mychess/web build`, then `grep -rl "Smith-Morra" apps/web/.next/static` returns nothing (the table stays server-side).
- [ ] **Step 4: Gate:** `node quality/gate.mjs check > log`; grep the log for `QUALITY GATE PASSED`.
- [ ] **Step 5: Docs:** `docs/CONTEXT.md` entry for the opening taxonomy / chapter name (if present): English names come from every named Lichess line by position, derived when titles are built (R-216).
- [ ] **Step 6: Commit, push, close #377** citing the commits and the gate result; comment on #326 that its English chess-correctness part is done in #377.
