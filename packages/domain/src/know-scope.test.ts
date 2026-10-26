import {
  importPgn,
  isPlayerMove,
  lines,
  moveKey,
  ok,
  playerKeys,
  refuse,
  type RepertoireGraph,
  type TrainingRepertoire,
} from '@mychess/chess';
import { describe, expect, it } from 'vitest';
import { canMarkKnown, knowScopeSchema, type KnowScope } from './know-scope';
import { TRAINING_REFUSALS } from './training';

function graphOf(pgn: string): RepertoireGraph {
  const imported = importPgn(pgn, 'white');
  if (!imported.ok) throw new Error(imported.refusal.reason);
  return imported.value.graph;
}

const GRAPH = graphOf('1. d4 d5 (1... Nf6 2. c4) 2. Bf4 Nf6 3. e3 *');
const ID = '6f1c1c3e-2b7a-4d4e-9f43-0b5e3c1d2a10';
const [CHAPTER = ''] = GRAPH.chapters.map((c) => c.id);
const KEYS = playerKeys(GRAPH);
const [D4 = ''] = KEYS;
const NOT_TRAINED = refuse(TRAINING_REFUSALS.notTrained);

const trains = (active = true): TrainingRepertoire[] => [
  { id: 'other', graph: graphOf('1. e4 *'), active: true },
  { id: ID, graph: GRAPH, active },
];

const move = (key: string): KnowScope => ({
  kind: 'move',
  repertoireId: ID,
  moveKey: key,
});
const line = (lineIndex: number, chapterId = CHAPTER): KnowScope => ({
  kind: 'line',
  repertoireId: ID,
  chapterId,
  lineIndex,
});
const chapter = (chapterId = CHAPTER, repertoireId = ID): KnowScope => ({
  kind: 'chapter',
  repertoireId,
  chapterId,
});

describe('canMarkKnown (R-46, R-58, R-147)', () => {
  it('resolves a player move to that move, with every player move of the repertoire', () => {
    expect(canMarkKnown(trains(), move(D4))).toEqual(
      ok({ scope: { kind: 'moves', keys: [D4] }, keys: KEYS }),
    );
  });

  it('resolves a line of a chapter to that line', () => {
    const second = lines(GRAPH, CHAPTER)[1];
    expect(second).toBeDefined();
    expect(canMarkKnown(trains(), line(1))).toEqual(
      ok({ scope: { kind: 'line', graph: GRAPH, line: second }, keys: KEYS }),
    );
  });

  it('resolves a chapter to that chapter', () => {
    expect(canMarkKnown(trains(), chapter())).toEqual(
      ok({
        scope: { kind: 'chapter', graph: GRAPH, chapterId: CHAPTER },
        keys: KEYS,
      }),
    );
  });

  it('refuses an opponent move or a move the repertoire lacks', () => {
    const opponent = GRAPH.moves.find((m) => !isPlayerMove(GRAPH, m));
    if (opponent === undefined) throw new Error('expected an opponent move');
    expect(
      canMarkKnown(trains(), move(moveKey(opponent.from, opponent.san))),
    ).toEqual(NOT_TRAINED);
    const [e4 = ''] = playerKeys(graphOf('1. e4 *'));
    expect(canMarkKnown(trains(), move(e4))).toEqual(NOT_TRAINED);
  });

  it('refuses a line or a chapter the repertoire lacks', () => {
    for (const scope of [line(9), line(-1), line(0, 'nope'), chapter('nope')])
      expect(canMarkKnown(trains(), scope)).toEqual(NOT_TRAINED);
  });

  it('refuses a repertoire the player does not train', () => {
    expect(canMarkKnown(trains(), chapter(CHAPTER, 'missing'))).toEqual(
      NOT_TRAINED,
    );
    expect(canMarkKnown([], move(D4))).toEqual(NOT_TRAINED);
  });

  it('refuses a paused assignment (R-46)', () => {
    expect(canMarkKnown(trains(false), chapter())).toEqual(NOT_TRAINED);
    expect(canMarkKnown(trains(false), move(D4))).toEqual(NOT_TRAINED);
  });
});

describe('knowScopeSchema', () => {
  const issuesOf = (input: unknown): string[] => {
    const parsed = knowScopeSchema.safeParse(input);
    return parsed.success ? [] : parsed.error.issues.map((i) => i.message);
  };

  it('parses a move, a line and a chapter from form strings', () => {
    expect(
      knowScopeSchema.parse({ kind: 'move', repertoireId: ID, moveKey: D4 }),
    ).toEqual(move(D4));
    expect(
      knowScopeSchema.parse({
        kind: 'line',
        repertoireId: ID,
        chapterId: CHAPTER,
        lineIndex: '12',
      }),
    ).toEqual(line(12));
    expect(
      knowScopeSchema.parse({
        kind: 'chapter',
        repertoireId: ID,
        chapterId: CHAPTER,
        extra: 'dropped',
      }),
    ).toEqual(chapter());
  });

  it.each(['', '1.5', '-1', '1e3', '1234567', ' 1'])(
    'refuses the line index %j',
    (lineIndex) => {
      expect(
        issuesOf({
          kind: 'line',
          repertoireId: ID,
          chapterId: CHAPTER,
          lineIndex,
        }),
      ).toEqual([TRAINING_REFUSALS.notTrained]);
    },
  );

  it.each([
    ['an unknown kind', { kind: 'game', repertoireId: ID, chapterId: CHAPTER }],
    ['a repertoire id that is not a uuid', chapter(CHAPTER, 'not-an-id')],
    ['an empty chapter id', chapter('')],
    ['a chapter id over 20 characters', chapter('x'.repeat(21))],
    ['a move key under 3 characters', { ...move('ab') }],
    ['a move key over 200 characters', { ...move('x'.repeat(201)) }],
    ['a missing field', { kind: 'chapter', repertoireId: ID }],
    ['a non-object', 'chapter'],
  ])('refuses %s with the notTrained key', (_name, input) => {
    const issues = issuesOf(input);
    expect(issues.length).toBeGreaterThan(0);
    expect(new Set(issues)).toEqual(new Set([TRAINING_REFUSALS.notTrained]));
  });

  it('accepts the bounds of each field', () => {
    for (const input of [
      chapter('x'),
      chapter('x'.repeat(20)),
      move('abc'),
      move('x'.repeat(200)),
      {
        kind: 'line',
        repertoireId: ID,
        chapterId: CHAPTER,
        lineIndex: '999999',
      },
    ])
      expect(issuesOf(input)).toEqual([]);
  });
});
