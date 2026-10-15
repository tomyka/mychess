# S2 Chess core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `packages/chess` everything M1 needs from chess: the repertoire graph with builder edits, a lenient PGN import and an exporter, opening classification with Lithuanian names, FSRS scheduling, the learn pass, the daily queue, and progress maths.

**Architecture:** Approach A from the spec: plain readonly values plus pure functions; time is passed in. Each module lives in its own folder under `packages/chess/src/` and is exported from `src/index.ts`. Refusals are `Result` values whose `reason` is a catalogue key.

**Tech Stack:** TypeScript 6 (strict), chess.js 1.4.0, ts-fsrs 5.4.x, zod, vitest 4.1.11, fast-check 4.10.x (dev).

**Spec:** `docs/superpowers/specs/2026-10-16-s2-chess-core-design.md`. **Issue:** #252. **Blocked on:** nothing.

**Roles:** every task is `chess-dev` unless marked. Task 8 is `chess-dev` with an `i18n-content` check. Task 14 is `qa`. Task 15 is the lead.

**Rules for every task** (CLAUDE.md): test first; only chess.js, ts-fsrs and zod at runtime; no suppression comments, `any` or `!`; functions small (complexity <= 10). After each task run `node quality/gate.mjs check`. The lead commits; workers report files and results. The test code below uses `!` and `as` for brevity. Where the lint config forbids them in tests, replace them with a small `must(value)` helper that throws on `undefined`; keep the assertions the same.

---

## Decisions taken while planning

- A move's identity is `moveKey(fromKey, san)`, the string `${fromKey}|${san}`. A `ReviewKey` is the same string for a player move.
- A FEN for a position key is `${key} 0 1`. Counters do not matter for legality, so graphs store keys only.
- Chapter membership lives on each move (`chapters: readonly string[]`), as `PgnMove.games` does today. `lines` walks only the moves of one chapter from its root.
- The "main line" of a chapter, used for classification, takes the first-inserted child at each position.
- Dates are `Date` objects in memory; S3 serialises them.

## File structure

| File | Responsibility |
| --- | --- |
| `src/repertoire/graph.ts` | Types `Side`, `Arrow`, `Circle`, `RepertoireMove`, `Chapter`, `RepertoireGraph`; `moveKey`, `fenOf`, `isPlayerMove`, `playerKeys`, `lines`, `mainLine` |
| `src/repertoire/edit.ts` | `addMove`, `removeMove`, `setMarks` |
| `src/pgn/limits.ts` | `checkLimits(text)` |
| `src/pgn/marks.ts` | `parseMarks(comment)`: `[%cal]` / `[%csl]` to arrows and circles, plus the comment without them |
| `src/pgn/import-pgn.ts` | `importPgn(text, side)`: per-game lenient import into a `RepertoireGraph` with a `skipped` report |
| `src/pgn/export-pgn.ts` | `exportPgn(graph)` |
| `src/openings/data/eco.ts` | Generated ECO table (port of v1 `eco-data.ts`) |
| `src/openings/data/eco-lt.ts` | Generated Lithuanian names (port of v1 `eco-data-lt.ts`) |
| `scripts/generate-eco.ts`, `scripts/generate-eco-lt.ts`, `src/openings/eco-lt-parse.ts` | Generators (port of v1) |
| `src/openings/classify.ts` | `classify(sanLine)`, `ecoName(eco, locale)`, `chapterName(chapter, locale)` |
| `src/training/schedule.ts` | `ReviewCard`, `startReview`, `grade`, `retrievability` |
| `src/training/learn.ts` | `LearnState`, `startLearn`, `learnStep` |
| `src/training/queue.ts` | `buildQueue` |
| `src/training/progress.ts` | `mastered`, `weakSpots`, `reconcile` |

The existing `src/pgn/{tokenize,split-games,replay,game-names,parse-pgn}.ts` stay. `importPgn` reuses `tokenize`, `splitGames`, `replay` and `gameNames` per game. `parsePgn` stays as the strict whole-file parser used by tests and by `importPgn`'s per-game path. If it ends up unused, knip will say so; delete it then.

---

### Task 1: Dependencies

**Files:** Modify `packages/chess/package.json`, `pnpm-lock.yaml`.

- [ ] **Step 1:** `pnpm --filter @mychess/chess add ts-fsrs@5.4.2 --save-exact` and `pnpm --filter @mychess/chess add -D fast-check@4.10.2 --save-exact`.
- [ ] **Step 2:** Read `node_modules/ts-fsrs/dist/index.d.ts` and note the exact names of `fsrs`, `generatorParameters`, `createEmptyCard`, `Rating`, the next-state call (`next` or `repeat`) and the retrievability call (`get_retrievability`). Task 10 uses them; adjust Task 10's code to the installed names.
- [ ] **Step 3:** `node quality/gate.mjs check`. Expected: PASS. If knip flags the unused new dependencies, carry on: Task 7 and Task 10 use them.

### Task 2: Repertoire graph values

**Files:** Create `src/repertoire/graph.ts` and `src/repertoire/graph.test.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { positionKey } from '../position-key';
import {
  fenOf, isPlayerMove, lines, mainLine, moveKey, playerKeys,
  type RepertoireGraph,
} from './graph';

const START = positionKey('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
const AFTER_E4 = positionKey('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1');
const AFTER_E5 = positionKey('rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2');
const AFTER_C5 = positionKey('rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2');

const move = (from: string, to: string, san: string, uci: string) => ({
  from, to, san, uci, arrows: [], circles: [], chapters: ['c1'],
});

const graph: RepertoireGraph = {
  side: 'white',
  chapters: [{ id: 'c1', rootKey: START, intro: null, nameSource: { kind: 'index', n: 1 } }],
  moves: [
    move(START, AFTER_E4, 'e4', 'e2e4'),
    move(AFTER_E4, AFTER_E5, 'e5', 'e7e5'),
    move(AFTER_E4, AFTER_C5, 'c5', 'c7c5'),
  ],
};

describe('repertoire graph', () => {
  it('keys a move by its position and SAN', () => {
    expect(moveKey(START, 'e4')).toBe(`${START}|e4`);
  });

  it('turns a position key into a FEN chess.js accepts', () => {
    expect(fenOf(START)).toBe(`${START} 0 1`);
  });

  it('knows which moves are the player\'s', () => {
    expect(isPlayerMove(graph, graph.moves[0]!)).toBe(true);
    expect(isPlayerMove(graph, graph.moves[1]!)).toBe(false);
    expect(isPlayerMove({ ...graph, side: 'black' }, graph.moves[1]!)).toBe(true);
  });

  it('lists the review keys of the player\'s moves only', () => {
    expect(playerKeys(graph)).toEqual([moveKey(START, 'e4')]);
  });

  it('enumerates every start-to-leaf line of a chapter', () => {
    expect(lines(graph, 'c1').map((l) => l.map((m) => m.san))).toEqual([
      ['e4', 'e5'],
      ['e4', 'c5'],
    ]);
  });

  it('takes the first-inserted child for the main line', () => {
    expect(mainLine(graph, 'c1').map((m) => m.san)).toEqual(['e4', 'e5']);
  });

  it('returns no lines for an unknown chapter', () => {
    expect(lines(graph, 'nope')).toEqual([]);
  });
});
```

- [ ] **Step 2:** `pnpm vitest run packages/chess/src/repertoire/graph.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement**

```ts
export type Side = 'white' | 'black';
export type MarkColor = 'G' | 'R' | 'Y' | 'B';
export interface Arrow { readonly from: string; readonly to: string; readonly color: MarkColor }
export interface Circle { readonly square: string; readonly color: MarkColor }

export type ChapterNameSource =
  | { readonly kind: 'custom'; readonly name: string }
  | { readonly kind: 'eco'; readonly eco: string }
  | { readonly kind: 'header'; readonly name: string }
  | { readonly kind: 'index'; readonly n: number };

export interface Chapter {
  readonly id: string;
  readonly rootKey: string;
  readonly intro: string | null;
  readonly nameSource: ChapterNameSource;
}

export interface RepertoireMove {
  readonly from: string;
  readonly to: string;
  readonly san: string;
  readonly uci: string;
  readonly arrows: readonly Arrow[];
  readonly circles: readonly Circle[];
  readonly chapters: readonly string[];
}

export interface RepertoireGraph {
  readonly side: Side;
  readonly chapters: readonly Chapter[];
  readonly moves: readonly RepertoireMove[];
}

export const moveKey = (fromKey: string, san: string): string => `${fromKey}|${san}`;
export const fenOf = (key: string): string => `${key} 0 1`;

export function isPlayerMove(graph: RepertoireGraph, move: RepertoireMove): boolean {
  const toMove = move.from.split(' ')[1];
  return (toMove === 'w') === (graph.side === 'white');
}

export function playerKeys(graph: RepertoireGraph): string[] {
  return graph.moves.filter((m) => isPlayerMove(graph, m)).map((m) => moveKey(m.from, m.san));
}

function children(graph: RepertoireGraph, chapterId: string, key: string): RepertoireMove[] {
  return graph.moves.filter((m) => m.from === key && m.chapters.includes(chapterId));
}

export function lines(graph: RepertoireGraph, chapterId: string): RepertoireMove[][] {
  const chapter = graph.chapters.find((c) => c.id === chapterId);
  if (chapter === undefined) return [];
  const out: RepertoireMove[][] = [];
  const stack: { key: string; path: RepertoireMove[]; seen: Set<string> }[] = [
    { key: chapter.rootKey, path: [], seen: new Set([chapter.rootKey]) },
  ];
  while (stack.length > 0) {
    const { key, path, seen } = stack.pop() as (typeof stack)[number];
    const next = children(graph, chapterId, key).filter((m) => !seen.has(m.to));
    if (next.length === 0) {
      if (path.length > 0) out.push(path);
      continue;
    }
    for (const m of [...next].reverse()) {
      stack.push({ key: m.to, path: [...path, m], seen: new Set([...seen, m.to]) });
    }
  }
  return out;
}

export function mainLine(graph: RepertoireGraph, chapterId: string): RepertoireMove[] {
  return lines(graph, chapterId)[0] ?? [];
}
```

The `seen` set stops a repetition cycle (a move back to an earlier position) from looping forever. If the gate's lint rejects the `as` cast, replace the `pop` with an index loop.

- [ ] **Step 4:** Run the test again. Expected: PASS. Then run `node quality/gate.mjs check`.
- [ ] **Step 5:** Report to the lead: files, results.

### Task 3: Builder edits

**Files:** Create `src/repertoire/edit.ts` and `src/repertoire/edit.test.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { positionKey } from '../position-key';
import { addMove, removeMove, setMarks } from './edit';
import { lines, moveKey, type RepertoireGraph } from './graph';

const START = positionKey('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
const empty: RepertoireGraph = {
  side: 'white',
  chapters: [{ id: 'c1', rootKey: START, intro: null, nameSource: { kind: 'index', n: 1 } }],
  moves: [],
};

function build(...sans: string[]): RepertoireGraph {
  let g = empty;
  let key = START;
  for (const san of sans) {
    const r = addMove(g, 'c1', key, san);
    if (!r.ok) throw new Error(r.refusal.reason);
    g = r.value;
    key = g.moves.find((m) => m.from === key && m.san === san)?.to ?? key;
  }
  return g;
}

describe('addMove', () => {
  it('adds a legal move with canonical SAN and UCI', () => {
    const g = build('e4');
    expect(g.moves).toEqual([
      expect.objectContaining({ from: START, san: 'e4', uci: 'e2e4', chapters: ['c1'] }),
    ]);
  });

  it('refuses an illegal move', () => {
    expect(addMove(empty, 'c1', START, 'e5')).toEqual({
      ok: false, refusal: { reason: 'repertoire.illegalMove' },
    });
  });

  it('refuses a position the chapter does not reach', () => {
    const elsewhere = positionKey('8/8/8/8/8/8/8/K6k w - - 0 1');
    expect(addMove(empty, 'c1', elsewhere, 'Kb1')).toEqual({
      ok: false, refusal: { reason: 'repertoire.unknownPosition' },
    });
  });

  it('refuses a second answer for the player in one position', () => {
    const g = build('e4');
    expect(addMove(g, 'c1', START, 'd4')).toEqual({
      ok: false, refusal: { reason: 'repertoire.secondAnswer' },
    });
  });

  it('allows several opponent moves in one position', () => {
    const g = build('e4', 'e5');
    const afterE4 = g.moves[0]!.to;
    const r = addMove(g, 'c1', afterE4, 'c5');
    expect(r.ok && r.value.moves.filter((m) => m.from === afterE4)).toHaveLength(2);
  });

  it('adds the chapter to an existing move instead of duplicating it', () => {
    const g: RepertoireGraph = {
      ...build('e4'),
      chapters: [...empty.chapters, { id: 'c2', rootKey: START, intro: null, nameSource: { kind: 'index', n: 2 } }],
    };
    const r = addMove(g, 'c2', START, 'e4');
    expect(r.ok && r.value.moves).toEqual([expect.objectContaining({ chapters: ['c1', 'c2'] })]);
  });
});

describe('removeMove', () => {
  it('removes the move and every move only it reached', () => {
    const g = removeMove(build('e4', 'e5', 'Nf3'), 'c1', START, 'e4');
    expect(g.moves).toEqual([]);
  });

  it('keeps moves still reachable another way (transposition)', () => {
    // 1.d4 Nf6 2.c4 e6 3.Nc3 and 1.d4 e6 2.c4 Nf6 reach the same position.
    let g = build('d4', 'Nf6', 'c4', 'e6', 'Nc3');
    const afterD4 = g.moves[0]!.to;
    for (const [from, san] of [[afterD4, 'e6']] as const) {
      const r = addMove(g, 'c1', from, san);
      if (!r.ok) throw new Error(r.refusal.reason);
      g = r.value;
    }
    const afterE6 = g.moves.find((m) => m.from === afterD4 && m.san === 'e6')!.to;
    let r = addMove(g, 'c1', afterE6, 'c4');
    if (!r.ok) throw new Error(r.refusal.reason);
    g = r.value;
    const afterC4 = g.moves.find((m) => m.from === afterE6 && m.san === 'c4')!.to;
    r = addMove(g, 'c1', afterC4, 'Nf6');
    if (!r.ok) throw new Error(r.refusal.reason);
    g = r.value;
    // Removing 1...Nf6 must keep 3.Nc3: the 1...e6 order still reaches it.
    g = removeMove(g, 'c1', afterD4, 'Nf6');
    expect(g.moves.some((m) => m.san === 'Nc3')).toBe(true);
    expect(g.moves.some((m) => m.san === 'Nf6' && m.from === afterD4)).toBe(false);
    expect(lines(g, 'c1').map((l) => l.map((m) => m.san))).toEqual([['d4', 'e6', 'c4', 'Nf6', 'Nc3']]);
  });
});

describe('setMarks', () => {
  it('sets arrows and circles on a move', () => {
    const r = setMarks(build('e4'), START, 'e4', [{ from: 'e2', to: 'e4', color: 'G' }], [{ square: 'd5', color: 'R' }]);
    expect(r.ok && r.value.moves[0]).toEqual(expect.objectContaining({
      arrows: [{ from: 'e2', to: 'e4', color: 'G' }], circles: [{ square: 'd5', color: 'R' }],
    }));
  });

  it('refuses marks on a move that does not exist', () => {
    expect(setMarks(build('e4'), START, 'd4', [], [])).toEqual({
      ok: false, refusal: { reason: 'repertoire.unknownMove' },
    });
    expect(moveKey(START, 'd4')).toContain('|d4');
  });
});
```

- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3: Implement** `src/repertoire/edit.ts`:
  - `export type EditRefusal = { reason: 'repertoire.illegalMove' } | { reason: 'repertoire.unknownPosition' } | { reason: 'repertoire.secondAnswer' } | { reason: 'repertoire.unknownMove' };`
  - `addMove(graph, chapterId, fromKey, san): Result<RepertoireGraph, EditRefusal>`:
    1. The chapter's root and the `to` of its moves are the reachable keys. If `fromKey` is not one of them, return `unknownPosition`.
    2. `new Chess(fenOf(fromKey))` and `chess.move(san)` in try/catch. On a throw, return `illegalMove`. Otherwise take `result.san`, `result.from + result.to + (result.promotion ?? '')` and `positionKey(chess.fen())`.
    3. Find the move with the same `(from, san)`. If it exists, add `chapterId` to its `chapters` (when it isn't there yet) and return.
    4. If the move is the player's (`isPlayerMove`) and another player move from `fromKey` is in this chapter, return `secondAnswer`.
    5. Append the new move with empty arrows and circles and `chapters: [chapterId]`.
  - `removeMove(graph, chapterId, fromKey, san): RepertoireGraph`:
    1. Drop `chapterId` from that move's `chapters`.
    2. Walk from the chapter root over the chapter's moves, and drop `chapterId` from every move the walk does not reach.
    3. Drop moves left with no chapters.
  - `setMarks(graph, fromKey, san, arrows, circles): Result<RepertoireGraph, EditRefusal>` replaces the marks on the matching move; `unknownMove` if there is none.
  - Keep each function under complexity 10. Extract `reachableKeys(graph, chapterId)` and `prune(graph, chapterId)` helpers.
- [ ] **Step 4:** Run the tests and the gate. Expected: PASS.
- [ ] **Step 5:** Report.

### Task 4: Upload limits

**Files:** Create `src/pgn/limits.ts` and `src/pgn/limits.test.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { checkLimits, PGN_LIMITS } from './limits';

describe('checkLimits', () => {
  it('accepts a small file', () => {
    expect(checkLimits('1. e4 e5 *')).toEqual({ ok: true, value: undefined });
  });

  it('refuses a file over 2 MB', () => {
    const text = 'a'.repeat(PGN_LIMITS.bytes + 1);
    expect(checkLimits(text)).toEqual({ ok: false, refusal: { reason: 'pgn.tooLarge', limit: PGN_LIMITS.bytes } });
  });

  it('counts bytes, not characters (Lithuanian letters are two bytes)', () => {
    const text = 'ž'.repeat(PGN_LIMITS.bytes / 2 + 1);
    expect(checkLimits(text).ok).toBe(false);
  });

  it('refuses more than 200 games', () => {
    const text = Array.from({ length: 201 }, () => '[Event "x"]\n\n1. e4 *').join('\n\n');
    expect(checkLimits(text)).toEqual({ ok: false, refusal: { reason: 'pgn.tooManyGames', limit: 200 } });
  });

  it('refuses variations nested deeper than 64', () => {
    const text = `1. e4 ${'( 1. d4 '.repeat(65)}${')'.repeat(65)} *`;
    expect(checkLimits(text)).toEqual({ ok: false, refusal: { reason: 'pgn.tooDeep', limit: 64 } });
  });

  it('ignores parentheses inside comments', () => {
    const text = `1. e4 {${'('.repeat(100)}} e5 *`;
    expect(checkLimits(text).ok).toBe(true);
  });
});
```

- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3: Implement**

```ts
import type { Result } from '../result';

export const PGN_LIMITS = { bytes: 2 * 1024 * 1024, games: 200, depth: 64 } as const;

export type LimitRefusal =
  | { reason: 'pgn.tooLarge'; limit: number }
  | { reason: 'pgn.tooManyGames'; limit: number }
  | { reason: 'pgn.tooDeep'; limit: number };

function countGames(text: string): number {
  return (text.match(/^\s*\[Event\s/gm) ?? []).length;
}

function maxDepth(text: string): number {
  let depth = 0;
  let max = 0;
  let inComment = false;
  for (const ch of text) {
    if (inComment) { inComment = ch !== '}'; continue; }
    if (ch === '{') inComment = true;
    else if (ch === '(') max = Math.max(max, ++depth);
    else if (ch === ')') depth = Math.max(0, depth - 1);
  }
  return max;
}

export function checkLimits(text: string): Result<undefined, LimitRefusal> {
  if (new TextEncoder().encode(text).length > PGN_LIMITS.bytes) {
    return { ok: false, refusal: { reason: 'pgn.tooLarge', limit: PGN_LIMITS.bytes } };
  }
  if (countGames(text) > PGN_LIMITS.games) {
    return { ok: false, refusal: { reason: 'pgn.tooManyGames', limit: PGN_LIMITS.games } };
  }
  if (maxDepth(text) > PGN_LIMITS.depth) {
    return { ok: false, refusal: { reason: 'pgn.tooDeep', limit: PGN_LIMITS.depth } };
  }
  return { ok: true, value: undefined };
}
```

  Counting games by `[Event` is a fast pre-check. Task 5 counts the real games after splitting and applies the same limit, so a file without Event tags is still capped.
- [ ] **Step 4:** Run the tests and the gate. Expected: PASS.
- [ ] **Step 5:** Report.

### Task 5: Arrows, circles and the chapter intro in PGN comments

**Files:** Create `src/pgn/marks.ts` and `src/pgn/marks.test.ts`. Modify `src/pgn/replay.ts` (keep marks instead of stripping them; keep a comment that comes before a game's first move).

- [ ] **Step 1: Write the failing tests** (`marks.test.ts`)

```ts
import { describe, expect, it } from 'vitest';
import { parseMarks } from './marks';

describe('parseMarks', () => {
  it('reads arrows and circles and returns the rest of the comment', () => {
    expect(parseMarks('Main idea [%cal Ge2e4,Rd7d5] [%csl Yd4] here')).toEqual({
      text: 'Main idea here',
      arrows: [{ from: 'e2', to: 'e4', color: 'G' }, { from: 'd7', to: 'd5', color: 'R' }],
      circles: [{ square: 'd4', color: 'Y' }],
    });
  });

  it('drops other commands such as clocks', () => {
    expect(parseMarks('[%clk 0:03:00] ok')).toEqual({ text: 'ok', arrows: [], circles: [] });
  });

  it('ignores malformed entries', () => {
    expect(parseMarks('[%cal Xe2e4,Ge2] [%csl Gz9]')).toEqual({ text: '', arrows: [], circles: [] });
  });
});
```

  Add to `replay.test.ts` (or `parse-pgn.test.ts`, wherever replay is covered):

```ts
it('keeps arrows on the move they follow', () => {
  const r = parsePgn('1. e4 { [%cal Gg1f3] } e5 *');
  expect(r.ok && r.value.moves[0]).toEqual(expect.objectContaining({
    san: 'e4', arrows: [{ from: 'g1', to: 'f3', color: 'G' }], circles: [],
  }));
});

it('keeps a comment before the first move as the game intro', () => {
  const r = parsePgn('{ The Italian } 1. e4 e5 *');
  expect(r.ok && r.value.games[0]?.intro).toBe('The Italian');
  expect(r.ok && r.value.moves[0]?.pgnComments).toEqual([]);
});
```

- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3: Implement**
  - `parseMarks(comment): { text: string; arrows: Arrow[]; circles: Circle[] }`:
    - match `/\[%cal\s+([^\]]*)\]/g` and `/\[%csl\s+([^\]]*)\]/g`;
    - split the entries on `,`;
    - keep entries matching `^[GRYB][a-h][1-8][a-h][1-8]$` (arrows) or `^[GRYB][a-h][1-8]$` (circles);
    - remove every `\[%[^\]]*\]`, then collapse whitespace and trim.
  - In `replay.ts`, run each comment through `parseMarks`:
    - append the arrows and circles to the move's `arrows` and `circles`, as new fields on `MoveOccurrence`;
    - store `text` in `pgnComments` only when it is not empty.
  - A comment that comes before the first move of the game's main line becomes `intro`. Add `intro: string | null` to `PgnGame` in `parse-pgn.ts`. Also update the module doc comment, which said marks are dropped.
  - When `parse-pgn.ts` merges occurrences, merge arrows and circles without repeats, as it already does for comments.
- [ ] **Step 4:** Run the tests and the gate. Expected: PASS. The existing parse-pgn tests must still pass. Where they asserted marks being stripped, update them to the new behaviour; that is a deliberate change (R-65), so say so in the report.
- [ ] **Step 5:** Report.

### Task 6: Lenient import into a repertoire graph

**Files:** Create `src/pgn/import-pgn.ts` and `src/pgn/import-pgn.test.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { importPgn } from './import-pgn';

const two = `[Event "Italian"]

1. e4 e5 2. Nf3 Nc6 3. Bc4 *

[Event "Broken"]

1. e4 e5 2. Ke3?? Nc6 *

[Event "Scotch"]

1. e4 e5 2. Nf3 Nc6 3. d4 *`;

describe('importPgn', () => {
  it('imports the valid games and lists the broken ones (1-based)', () => {
    const r = importPgn(two, 'white');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.graph.chapters.map((c) => c.nameSource)).toEqual([
      { kind: 'header', name: 'Italian' },
      { kind: 'header', name: 'Scotch' },
    ]);
    expect(r.value.skipped).toEqual([
      { game: 2, reason: 'pgn.illegalMove', san: 'Ke3' },
    ]);
  });

  it('reports a second player answer and keeps the first', () => {
    const r = importPgn('1. e4 (1. d4) e5 *', 'white');
    expect(r.ok && r.value.graph.moves.map((m) => m.san)).toEqual(['e4', 'e5']);
    expect(r.ok && r.value.skipped).toEqual([{ game: 1, reason: 'pgn.secondAnswer', san: 'd4' }]);
  });

  it('keeps several opponent replies', () => {
    const r = importPgn('1. e4 e5 (1... c5 2. Nf3) 2. Nf3 *', 'white');
    expect(r.ok && r.value.skipped).toEqual([]);
    expect(r.ok && r.value.graph.moves).toHaveLength(5);
  });

  it('refuses a file with no valid game', () => {
    expect(importPgn('1. e4 e5 2. Ke3 *', 'white')).toEqual({
      ok: false, refusal: { reason: 'pgn.noValidGames' },
    });
  });

  it('refuses a file over the limits before parsing', () => {
    expect(importPgn('a'.repeat(3 * 1024 * 1024), 'white')).toEqual({
      ok: false, refusal: { reason: 'pgn.tooLarge', limit: 2 * 1024 * 1024 },
    });
  });

  it('uses the chapter intro and a FEN start', () => {
    const r = importPgn('[FEN "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1"]\n\n{ From e4 } 1... c5 2. Nf3 *', 'white');
    expect(r.ok && r.value.graph.chapters[0]).toEqual(expect.objectContaining({ intro: 'From e4' }));
  });
});
```

- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3: Implement** `importPgn(text, side): Result<{ graph: RepertoireGraph; skipped: Skipped[] }, ImportRefusal>`:
  - `Skipped = { game: number; reason: string; san?: string }`. `ImportRefusal = LimitRefusal | { reason: 'pgn.noValidGames' }`.
  1. `checkLimits(text)`; return its refusal.
  2. Split the text into game chunks before tokenizing: a chunk starts at a line beginning with `[` that follows movetext, or at the text start. Tokenize, split and replay each chunk on its own, reusing the existing functions. A chunk that fails becomes a `skipped` entry, with `game` 1-based by chunk order, the refusal's `reason`, and the `san` when there is one. Apply the 200-game cap to the real chunk count and refuse with `pgn.tooManyGames`.
  3. For each good game, create a chapter:
     - id `c${n}` (1-based over the good games);
     - `rootKey` from the game's root;
     - `intro` from Task 5;
     - `nameSource: { kind: 'header', name }` when `gameNames` gives a name, else `{ kind: 'index', n }`.

     Task 9 replaces the name with an ECO classification where one matches.
  4. Add the game's moves to the graph in file order with a helper that shares Task 3's logic (`addMove`). Pass the already-known SAN, and carry arrows and circles over with `setMarks`. When `addMove` refuses with `secondAnswer`, record `{ game, reason: 'pgn.secondAnswer', san }` and skip that move and everything below it in that game.
  5. If no game produced a chapter, return `pgn.noValidGames`.
- [ ] **Step 4:** Run the tests and the gate. Expected: PASS.
- [ ] **Step 5:** Report.

### Task 7: Export and the round-trip property

**Files:** Create `src/pgn/export-pgn.ts` and `src/pgn/export-pgn.test.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
import fc from 'fast-check';
import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import { exportPgn } from './export-pgn';
import { importPgn } from './import-pgn';

const normalise = (g: { moves: readonly { from: string; san: string; arrows: unknown; circles: unknown }[] }) =>
  g.moves.map((m) => [m.from, m.san, m.arrows, m.circles]).sort();

describe('exportPgn', () => {
  it('writes one game per chapter with intro, marks and variations', () => {
    const r = importPgn('[Event "Italian"]\n\n{ Intro } 1. e4 { [%cal Gg1f3] } e5 (1... c5 2. Nf3) 2. Nf3 *', 'white');
    if (!r.ok) throw new Error('import failed');
    const pgn = exportPgn(r.value.graph);
    expect(pgn).toContain('[Event "Italian"]');
    expect(pgn).toContain('{ Intro }');
    expect(pgn).toContain('[%cal Gg1f3]');
    expect(pgn).toContain('(1... c5 2. Nf3)');
  });

  it('round-trips random legal repertoires', () => {
    const line = fc.array(fc.nat(40), { minLength: 1, maxLength: 12 }).map((choices) => {
      const chess = new Chess();
      const sans: string[] = [];
      for (const c of choices) {
        const legal = chess.moves();
        if (legal.length === 0) break;
        const san = legal[c % legal.length] as string;
        chess.move(san);
        sans.push(san);
      }
      return sans;
    });
    fc.assert(fc.property(line, (sans) => {
      const pgn = sans.map((s, i) => (i % 2 === 0 ? `${i / 2 + 1}. ${s}` : s)).join(' ') + ' *';
      const first = importPgn(pgn, 'white');
      if (!first.ok) return false;
      const again = importPgn(exportPgn(first.value.graph), 'white');
      return again.ok && JSON.stringify(normalise(again.value.graph)) === JSON.stringify(normalise(first.value.graph));
    }));
  });
});
```

- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3: Implement** `exportPgn(graph): string`. For each chapter:
  - headers: `[Event "<name>"]`, where the name is the custom or header name, or `Chapter <n>` for index sources, or the ECO code for eco sources. Add `[SetUp "1"]` and `[FEN "<fenOf(rootKey)>"]` when the root is not the start position, and `[Result "*"]`.
  - the intro as `{ ... }` before the first move.
  - movetext: depth-first from the root over the chapter's moves.
    - The first child continues the line; the other children are written as `( ... )` variations.
    - Move numbers go before White moves, and as `N...` at the start of a variation or after a variation when Black is to move. The number comes from the FEN fullmove field, using a chess.js instance kept along the walk.
    - Marks go after the move as `{ [%cal ...] [%csl ...] }`.
  - end with `*`, and separate games by a blank line.
- [ ] **Step 4:** Run the tests and the gate. Expected: PASS. If the property finds a counterexample, fix the exporter, never the property.
- [ ] **Step 5:** Report.

### Task 8: Opening data port (chess-dev; i18n-content checks)

**Files:**
- Create `packages/chess/scripts/generate-eco.ts`, `packages/chess/scripts/generate-eco-lt.ts`, `packages/chess/src/openings/eco-lt-parse.ts` (and test).
- Create `packages/chess/src/openings/data/eco.ts` and `packages/chess/src/openings/data/eco-lt.ts` (generated).
- Create `packages/chess/src/openings/eco-coverage.test.ts`.

- [ ] **Step 1:** Read the v1 sources: `archive/v1/mychess/scripts/generate-eco-data.ts`, `generate-eco-data-lt.ts`, `archive/v1/mychess/src/lib/openings/eco-lt-parse.ts` (and its test), `eco-coverage.test.ts`.
- [ ] **Step 2:** Port `eco-lt-parse.test.ts` first, unchanged except for imports. Run it. Expected: FAIL.
- [ ] **Step 3:** Port `eco-lt-parse.ts`. Run it. Expected: PASS.
- [ ] **Step 4:** Port the two generators so they write to `src/openings/data/`. Rather than refetching, copy v1's generated `eco-data.ts` and `eco-data-lt.ts` content into the new data files: the sources are unchanged, and the generators stay for refreshes. The data exports:

```ts
export interface EcoEntry { readonly eco: string; readonly name: string; readonly san: readonly string[] }
export const ECO: readonly EcoEntry[] = [ /* generated */ ];
// eco-lt.ts
export const ECO_LT: Readonly<Record<string, string>> = { /* generated: eco code -> Lithuanian name */ };
```

  If v1's shapes differ, keep v1's field names and adapt Task 9 to them instead.
- [ ] **Step 5:** Port `eco-coverage.test.ts` (every ECO code has a Lithuanian name). Run it. Expected: PASS.
- [ ] **Step 6:** Add `packages/chess/src/openings/data/` to knip and coverage only if the gate complains about generated data; that config is protected, so report it to the lead rather than editing it. Run the gate.
- [ ] **Step 7 (i18n-content):** Spot-check 20 Lithuanian names across A-E against `docs/glossary-lt.md`'s conventions. Report anything that reads wrong. Do not edit the generated file; a fix goes into the generator input.
- [ ] **Step 8:** Report.

### Task 9: Classification and chapter names

**Files:** Create `src/openings/classify.ts` and `src/openings/classify.test.ts`. Modify `src/pgn/import-pgn.ts` (set `nameSource: { kind: 'eco', eco }` when a game classifies).

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { chapterName, classify, ecoName } from './classify';

describe('classify', () => {
  it('finds the deepest ECO match along the line', () => {
    expect(classify(['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6'])?.eco).toBe('B90');
  });

  it('recognises a transposition by position', () => {
    // Queen's Gambit Declined reached via 1.Nf3
    expect(classify(['Nf3', 'd5', 'd4', 'Nf6', 'c4', 'e6'])?.eco).toMatch(/^D3/);
  });

  it('returns null for a line no entry matches', () => {
    expect(classify([])).toBeNull();
  });
});

describe('chapter names', () => {
  it('prefers a custom name', () => {
    expect(chapterName({ kind: 'custom', name: 'Mano' }, 'lt')).toEqual({ kind: 'text', text: 'Mano' });
  });

  it('uses the ECO name in the locale', () => {
    expect(chapterName({ kind: 'eco', eco: 'B90' }, 'en')).toEqual({ kind: 'text', text: ecoName('B90', 'en') });
    expect(chapterName({ kind: 'eco', eco: 'B90' }, 'lt')).toEqual({ kind: 'text', text: ecoName('B90', 'lt') });
    expect(ecoName('B90', 'lt')).not.toBe(ecoName('B90', 'en'));
  });

  it('falls back to the header name, then a numbered key', () => {
    expect(chapterName({ kind: 'header', name: 'Italian' }, 'lt')).toEqual({ kind: 'text', text: 'Italian' });
    expect(chapterName({ kind: 'index', n: 3 }, 'lt')).toEqual({ kind: 'key', key: 'chapter.untitled', n: 3 });
  });
});
```

- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3: Implement**
  - Build a module-level `Map<positionKey, EcoEntry>` once, by replaying each entry's SAN from the start position with chess.js. When two entries reach the same position, the later (more specific) one wins.
  - `classify(sans)` replays the line and keeps the last position found in the map.
  - `ecoName(eco, locale)` returns the Lithuanian name for `lt` (falling back to English), and the English name otherwise.
  - `chapterName(source, locale)` returns `{ kind: 'text', text } | { kind: 'key', key: 'chapter.untitled', n }`.
  - In `importPgn`, classify each chapter's `mainLine` SANs (when the chapter starts at the standard position). Use `{ kind: 'eco', eco }` when a match exists, otherwise keep the header or index source (R-63: taxonomy first).
- [ ] **Step 4:** Run the tests and the gate. The Task 6 tests whose expected name source changes to eco are updated deliberately; say so in the report.
- [ ] **Step 5:** Report.

### Task 10: FSRS schedule

**Files:** Create `src/training/schedule.ts` and `src/training/schedule.test.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { grade, retrievability, startReview } from './schedule';

const DAY = 86_400_000;
const now = new Date('2026-10-16T08:00:00Z');

describe('schedule', () => {
  it('starts a review due the next day', () => {
    const card = startReview('k', now);
    expect(card.key).toBe('k');
    expect(card.fsrs.due.getTime()).toBe(now.getTime() + DAY);
    expect(card.lapses).toEqual([]);
  });

  it('pushes a correct answer further out', () => {
    const card = startReview('k', now);
    const at = new Date(card.fsrs.due);
    const next = grade(card, 'correct', at);
    expect(next.fsrs.due.getTime()).toBeGreaterThan(at.getTime() + DAY);
  });

  it('counts a lapse and a hint the same way and records the time', () => {
    const card = startReview('k', now);
    const at = new Date(card.fsrs.due);
    const lapse = grade(card, 'lapse', at);
    const hint = grade(card, 'hint', at);
    expect(lapse.fsrs.due).toEqual(hint.fsrs.due);
    expect(lapse.lapses).toEqual([at]);
  });

  it('predicts lower recall as time passes', () => {
    const card = startReview('k', now);
    expect(retrievability(card, new Date(now.getTime() + 2 * DAY)))
      .toBeGreaterThan(retrievability(card, new Date(now.getTime() + 60 * DAY)));
  });

  it('always schedules after the grading time', () => {
    fc.assert(fc.property(fc.array(fc.constantFrom('correct', 'lapse', 'hint'), { maxLength: 15 }), (outcomes) => {
      let card = startReview('k', now);
      for (const o of outcomes) {
        const at = new Date(card.fsrs.due);
        card = grade(card, o, at);
        if (card.fsrs.due.getTime() <= at.getTime()) return false;
      }
      return true;
    }));
  });
});
```

- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3: Implement.** Use the ts-fsrs names noted in Task 1.

```ts
import { createEmptyCard, fsrs, generatorParameters, Rating, type Card } from 'ts-fsrs';

export const TARGET_RETENTION = 0.9; // R-76
const scheduler = fsrs(generatorParameters({ request_retention: TARGET_RETENTION, enable_fuzz: false }));
const DAY = 86_400_000;

export type Outcome = 'correct' | 'lapse' | 'hint';

export interface ReviewCard {
  readonly key: string;
  readonly fsrs: Card;
  readonly lapses: readonly Date[];
}

export function startReview(key: string, now: Date): ReviewCard {
  const first = scheduler.next(createEmptyCard(now), now, Rating.Good).card;
  return { key, fsrs: { ...first, due: new Date(now.getTime() + DAY) }, lapses: [] };
}

export function grade(card: ReviewCard, outcome: Outcome, now: Date): ReviewCard {
  const rating = outcome === 'correct' ? Rating.Good : Rating.Again;
  const next = scheduler.next(card.fsrs, now, rating).card;
  return { key: card.key, fsrs: next, lapses: outcome === 'correct' ? card.lapses : [...card.lapses, now] };
}

export function retrievability(card: ReviewCard, now: Date): number {
  return scheduler.get_retrievability(card.fsrs, now, false);
}
```

  Fuzz is off so that tests and reviews are deterministic.
- [ ] **Step 4:** Run the tests and the gate. Expected: PASS.
- [ ] **Step 5:** Report.

### Task 11: Learn pass

**Files:** Create `src/training/learn.ts` and `src/training/learn.test.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { learnStep, startLearn } from './learn';

describe('learn pass', () => {
  it('shows, then asks blind, then is learned on a correct answer', () => {
    let s = startLearn('k');
    expect(s.step).toBe('shown');
    s = learnStep(s, 'seen');
    expect(s.step).toBe('asked');
    s = learnStep(s, 'correct');
    expect(s.step).toBe('learned');
  });

  it('goes back to the arrow after a wrong blind answer', () => {
    const s = learnStep(learnStep(startLearn('k'), 'seen'), 'wrong');
    expect(s.step).toBe('shown');
  });

  it('ignores events that do not apply to the step', () => {
    const shown = startLearn('k');
    expect(learnStep(shown, 'correct')).toEqual(shown);
    const learned = learnStep(learnStep(shown, 'seen'), 'correct');
    expect(learnStep(learned, 'wrong')).toEqual(learned);
  });
});
```

- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3: Implement**

```ts
export type LearnStepName = 'shown' | 'asked' | 'learned';
export type LearnEvent = 'seen' | 'correct' | 'wrong';
export interface LearnState { readonly key: string; readonly step: LearnStepName }

const NEXT: Readonly<Record<LearnStepName, Partial<Record<LearnEvent, LearnStepName>>>> = {
  shown: { seen: 'asked' },
  asked: { correct: 'learned', wrong: 'shown' },
  learned: {},
};

export const startLearn = (key: string): LearnState => ({ key, step: 'shown' });

export function learnStep(state: LearnState, event: LearnEvent): LearnState {
  const step = NEXT[state.step][event];
  return step === undefined ? state : { key: state.key, step };
}
```

- [ ] **Step 4:** Run the tests and the gate. Expected: PASS.
- [ ] **Step 5:** Report.

### Task 12: Daily queue

**Files:** Create `src/training/queue.ts` and `src/training/queue.test.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { importPgn } from '../pgn/import-pgn';
import { moveKey, type RepertoireGraph } from '../repertoire/graph';
import { buildQueue, QUEUE_LIMITS } from './queue';
import { startReview } from './schedule';

const now = new Date('2026-10-16T08:00:00Z');
function graph(pgn: string, side: 'white' | 'black'): RepertoireGraph {
  const r = importPgn(pgn, side);
  if (!r.ok) throw new Error(r.refusal.reason);
  return r.value.graph;
}
const white = graph('1. e4 e5 2. Nf3 Nc6 3. Bc4 *', 'white');
const black = graph('1. e4 c6 2. d4 d5 *', 'black');

describe('buildQueue', () => {
  it('offers the player moves without a card as new moves, in line order', () => {
    const q = buildQueue({ repertoires: [{ id: 'r1', graph: white, paused: false }], cards: new Map(), learnedToday: 0 }, now);
    expect(q.newMoves.map((i) => i.san)).toEqual(['e4', 'Nf3', 'Bc4']);
    expect(q.reviews).toEqual([]);
  });

  it('offers due cards as reviews, tagged with their repertoire', () => {
    const key = moveKey(white.moves[0]!.from, 'e4');
    const card = { ...startReview(key, new Date(now.getTime() - 2 * 86_400_000)) };
    const q = buildQueue({ repertoires: [{ id: 'r1', graph: white, paused: false }], cards: new Map([[key, card]]), learnedToday: 0 }, now);
    expect(q.reviews).toEqual([expect.objectContaining({ key, repertoireId: 'r1', san: 'e4' })]);
  });

  it('skips paused repertoires', () => {
    const q = buildQueue({ repertoires: [{ id: 'r1', graph: white, paused: true }], cards: new Map(), learnedToday: 0 }, now);
    expect(q.newMoves).toEqual([]);
  });

  it('subtracts moves already learned today from the new-move allowance', () => {
    const q = buildQueue({ repertoires: [{ id: 'r1', graph: white, paused: false }], cards: new Map(), learnedToday: QUEUE_LIMITS.newPerDay - 1 }, now);
    expect(q.newMoves).toHaveLength(1);
  });

  it('shows the same review key once even if two repertoires hold it', () => {
    const q = buildQueue({ repertoires: [{ id: 'a', graph: white, paused: false }, { id: 'b', graph: white, paused: false }], cards: new Map(), learnedToday: 0 }, now);
    expect(q.newMoves.map((i) => i.repertoireId)).toEqual(['a', 'a', 'a']);
  });

  it('keeps answers from different sides apart', () => {
    const q = buildQueue({ repertoires: [{ id: 'w', graph: white, paused: false }, { id: 'b', graph: black, paused: false }], cards: new Map(), learnedToday: 0 }, now);
    expect(q.newMoves.map((i) => `${i.repertoireId}:${i.san}`)).toEqual(['w:e4', 'w:Nf3', 'w:Bc4', 'b:c6', 'b:d5']);
  });

  it('never exceeds its limits', () => {
    fc.assert(fc.property(fc.nat(30), (learnedToday) => {
      const q = buildQueue({ repertoires: [{ id: 'r1', graph: white, paused: false }], cards: new Map(), learnedToday }, now);
      return q.newMoves.length <= Math.max(0, QUEUE_LIMITS.newPerDay - learnedToday) && q.reviews.length <= QUEUE_LIMITS.reviews;
    }));
  });
});
```

- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3: Implement** `buildQueue(input, now)`:
  - `QUEUE_LIMITS = { reviews: 20, newPerDay: 10 } as const` (R-62).
  - `QueueItem = { key, repertoireId, fromKey, san }`.
  - For each non-paused repertoire in input order, walk each chapter's `lines` in order and take each player move once. Skip a key already seen in this call (R-53: one card). If the key has a card with `fsrs.due <= now`, it is a review; if it has no card, it is a new move.
  - Sort reviews by due date, earliest first, and take `QUEUE_LIMITS.reviews`. Take `max(0, newPerDay - learnedToday)` new moves.
- [ ] **Step 4:** Run the tests and the gate. Expected: PASS.
- [ ] **Step 5:** Report.

### Task 13: Progress and reconciliation

**Files:** Create `src/training/progress.ts` and `src/training/progress.test.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { mastered, reconcile, weakSpots } from './progress';
import { grade, startReview, type ReviewCard } from './schedule';

const DAY = 86_400_000;
const now = new Date('2026-10-16T08:00:00Z');
const fresh = (key: string): ReviewCard => startReview(key, new Date(now.getTime() - DAY / 2));

describe('mastered', () => {
  it('needs a card for every key with recall of at least 0.9', () => {
    const cards = new Map([['a', fresh('a')], ['b', fresh('b')]]);
    expect(mastered(['a', 'b'], cards, now)).toBe(true);
    expect(mastered(['a', 'b', 'c'], cards, now)).toBe(false);
    expect(mastered(['a'], cards, new Date(now.getTime() + 400 * DAY))).toBe(false);
  });
});

describe('weakSpots', () => {
  it('ranks keys with two or more lapses in 30 days', () => {
    let a = fresh('a');
    a = grade(a, 'lapse', new Date(now.getTime() - 5 * DAY));
    a = grade(a, 'lapse', new Date(now.getTime() - 2 * DAY));
    let b = fresh('b');
    b = grade(b, 'lapse', new Date(now.getTime() - 40 * DAY));
    b = grade(b, 'lapse', new Date(now.getTime() - 35 * DAY));
    const spots = weakSpots(new Map([['a', a], ['b', b]]), now);
    expect(spots.map((s) => s.key)).toContain('a');
    expect(spots.find((s) => s.key === 'a')?.recentLapses).toBe(2);
  });
});

describe('reconcile', () => {
  it('keeps, queues and parks keys', () => {
    const cards = new Map([['a', fresh('a')], ['gone', fresh('gone')]]);
    expect(reconcile(new Set(['a', 'new']), cards)).toEqual({
      kept: ['a'], toLearn: ['new'], dormant: ['gone'],
    });
  });

  it('never drops a card whose key still exists', () => {
    fc.assert(fc.property(fc.uniqueArray(fc.string()), fc.uniqueArray(fc.string()), (current, carded) => {
      const cards = new Map(carded.map((k) => [k, fresh(k)]));
      const r = reconcile(new Set(current), cards);
      return carded.filter((k) => current.includes(k)).every((k) => r.kept.includes(k));
    }));
  });
});
```

- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3: Implement**
  - `MASTERY_RETENTION = 0.9`, `WEAK_RETENTION = 0.7`, `WEAK_LAPSES = 2`, `WEAK_WINDOW_DAYS = 30` (R-56). Each is an exported constant.
  - `mastered(keys, cards, now)`: every key has a card, and `retrievability >= MASTERY_RETENTION`.
  - `weakSpots(cards, now)`: return `{ key, recentLapses, recall }` for each card with `recentLapses >= 2` or `recall < 0.7`. Sort by `recentLapses` descending, then by `recall` ascending.
  - `reconcile(currentKeys, cards)`:
    - `kept` = keys that are current and have a card;
    - `toLearn` = current keys without a card;
    - `dormant` = carded keys that are not current.

    Each list is sorted for determinism. The spec's `previousKeys` parameter is not needed: the cards already say what was there before.
- [ ] **Step 4:** Run the tests and the gate. Expected: PASS.
- [ ] **Step 5:** Report.

### Task 14: Persona repertoires import (qa)

**Files:** Create `packages/chess/src/personas.test.ts`. qa owns test files.

- [ ] **Step 1:** For each persona doc in `docs/personas/{u1400,1400-2000,2000plus,coach}.md`, copy each repertoire's lines into the test as PGN strings, one `it` per repertoire, with the side the doc gives.
- [ ] **Step 2:** Each test asserts that:
  - `importPgn(pgn, side)` is `ok`;
  - `skipped` is empty;
  - the number of player moves equals the doc's count, where the doc gives one;
  - the main line classifies to an ECO code in the family the doc names. For example, Rokas's Italian must give a C5x code: `expect(classify(sans)?.eco).toMatch(/^C5/)`.
- [ ] **Step 3:** Run it. Any failure is a finding:
  - an illegal line means the persona doc is wrong; report it to the lead;
  - a wrong classification means Task 9 has a bug; report it to chess-dev.
- [ ] **Step 4:** Report per persona: met or not met.

### Task 15: Finish (lead)

- [ ] **Step 1:** Update the role docs' `data/openings/` paths to `packages/chess/src/openings/data/`: `.claude/agents/chess-dev.md`, `.claude/agents/i18n-content.md`, `docs/agent-team.md`, `CLAUDE.md` if it mentions them.
- [ ] **Step 2:** Export everything new from `packages/chess/src/index.ts` (if workers have not), and run `node quality/gate.mjs check` and `node quality/gate.mjs mutation --branch --base <S2 start commit>`.
- [ ] **Step 3:** The architect runs `mp-code-review` on the S2 diff; fix the findings through chess-dev.
- [ ] **Step 4:** Commit and push, then close #252 with the commit range and the CI result.
