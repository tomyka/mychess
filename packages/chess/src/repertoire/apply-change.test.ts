import { describe, expect, expectTypeOf, it } from 'vitest';
import { imported, must, START } from '../pgn/test-support';
import { positionKey } from '../position-key';
import type { Result } from '../result';
import {
  applyChange,
  type AppliedChange,
  type ChangeRefusal,
  type RepertoireChange,
} from './apply-change';
import { applyEdit, type EditOp, type EditRefusal } from './edit';
import { emptyGraph, moveKey, type RepertoireGraph } from './graph';
import { mergeInto, type MergeRefusal, type NothingToAdd } from './merge';

/** A White London: 1. d4 d5 2. Bf4, one chapter `c1`. */
const london = imported('1. d4 d5 2. Bf4 *').graph;

/** Where `san` from `from` lands in `graph`. */
const after = (graph: RepertoireGraph, from: string, san: string): string =>
  must(graph.moves.find((m) => m.from === from && m.san === san)).to;

const AFTER_D4 = after(london, START, 'd4');
const AFTER_D5 = after(london, AFTER_D4, 'd5');
const AFTER_BF4 = after(london, AFTER_D5, 'Bf4');
const AFTER_E4 = positionKey(
  'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
);

/** The graph `applyEdit` makes of `graph` with `op`; it must not refuse. */
function edited(graph: RepertoireGraph, op: EditOp): RepertoireGraph {
  const r = applyEdit(graph, op);
  if (!r.ok) throw new Error(r.refusal.reason);
  return r.value;
}

describe('applyChange: a builder edit', () => {
  const cases: readonly (readonly [string, RepertoireGraph, EditOp])[] = [
    [
      'adds a move to a chapter',
      london,
      { kind: 'addMove', chapterId: 'c1', from: AFTER_BF4, san: 'Nf6' },
    ],
    [
      'adds the first move of a repertoire without chapters (R-111)',
      emptyGraph('white'),
      { kind: 'addMove', chapterId: null, from: START, san: 'e4' },
    ],
    [
      'removes a move',
      london,
      { kind: 'removeMove', chapterId: 'c1', from: AFTER_D4, san: 'd5' },
    ],
    [
      'sets the marks of a move',
      london,
      {
        kind: 'setMarks',
        chapterId: 'c1',
        from: START,
        san: 'd4',
        marks: {
          arrows: [{ from: 'd2', to: 'd4', color: 'G' }],
          circles: [{ square: 'd5', color: 'R' }],
        },
      },
    ],
    [
      'edits the comment of a move',
      london,
      { kind: 'editComment', moveKey: moveKey(START, 'd4'), comment: 'Mine' },
    ],
    ['adds a chapter', london, { kind: 'addChapter' }],
    [
      'renames a chapter',
      london,
      { kind: 'renameChapter', chapterId: 'c1', name: 'London' },
    ],
    ['removes a chapter', london, { kind: 'removeChapter', chapterId: 'c1' }],
  ];

  it.each(cases)(
    '%s: the graph applyEdit makes, opening no chapter',
    (_, graph, op) => {
      const expected = edited(graph, op);
      expect(expected).not.toEqual(graph);
      expect(applyChange(graph, { kind: 'edit', op })).toEqual({
        ok: true,
        value: { graph: expected, firstChapterId: null },
      });
    },
  );

  const refusals: readonly (readonly [EditRefusal['reason'], EditOp])[] = [
    ['repertoire.unknownChapter', { kind: 'removeChapter', chapterId: 'c9' }],
    [
      'repertoire.illegalMove',
      { kind: 'addMove', chapterId: 'c1', from: START, san: 'e5' },
    ],
    [
      'repertoire.unknownPosition',
      { kind: 'addMove', chapterId: 'c1', from: AFTER_E4, san: 'e5' },
    ],
    [
      'repertoire.secondAnswer',
      { kind: 'addMove', chapterId: 'c1', from: START, san: 'e4' },
    ],
    [
      'repertoire.unknownMove',
      { kind: 'editComment', moveKey: moveKey(START, 'e4'), comment: 'x' },
    ],
  ];

  it.each(refusals)('refuses %s as applyEdit does', (reason, op) => {
    expect(applyChange(london, { kind: 'edit', op })).toEqual({
      ok: false,
      refusal: { reason },
    });
  });
});

describe('applyChange: an import (R-101)', () => {
  it('gives the merged graph and opens on the first chapter it adds', () => {
    const file = imported('1. d4 Nf6 2. Bf4 *\n\n1. d4 e6 2. Bf4 *');
    const merged = mergeInto(london, file);
    if (!merged.ok) throw new Error(merged.refusal.reason);
    expect(merged.value.graph.chapters).toHaveLength(3);
    expect(applyChange(london, { kind: 'import', imported: file })).toEqual({
      ok: true,
      value: { graph: merged.value.graph, firstChapterId: 'c2' },
    });
  });

  it('refuses a file of the other side', () => {
    const file = imported('1. d4 d5 2. Bf4 *', 'black');
    expect(applyChange(london, { kind: 'import', imported: file })).toEqual({
      ok: false,
      refusal: { reason: 'repertoire.sideMismatch' },
    });
  });

  const nothing: readonly (readonly [string, string, string])[] = [
    [
      'every game is refused against the repertoire (R-115)',
      '1. d4 d5 2. Bf4 *',
      '1. e4 e5 *\n\n1. c4 e5 *',
    ],
    [
      'every game is already there (R-117)',
      '1. e4 e5 2. Nf3 *',
      '1. e4 { Theirs [%cal Gd2d4] } e5 *',
    ],
    [
      'each game is within the repertoire or a game before it (R-122)',
      '1. e4 e5 2. Nf3 Nc6 3. Bc4 *',
      '1. e4 e5 2. Nf3 *\n\n1. e4 e5 *',
    ],
  ];

  it.each(nothing)(
    'refuses with nothing to add when %s',
    (_, existing, text) => {
      expect(
        applyChange(imported(existing).graph, {
          kind: 'import',
          imported: imported(text),
        }),
      ).toEqual({ ok: false, refusal: { reason: 'pgn.nothingToAdd' } });
    },
  );
});

describe('applyChange: purity', () => {
  it('leaves the graph it edits unchanged', () => {
    const before = structuredClone(london);
    applyChange(london, {
      kind: 'edit',
      op: { kind: 'addMove', chapterId: 'c1', from: AFTER_BF4, san: 'Nf6' },
    });
    expect(london).toEqual(before);
  });

  it('leaves the graph it imports into unchanged', () => {
    const before = structuredClone(london);
    applyChange(london, {
      kind: 'import',
      imported: imported('1. d4 Nf6 2. Bf4 *'),
    });
    expect(london).toEqual(before);
  });
});

describe('applyChange: the refusal narrows by the kind of change', () => {
  it('an edit refuses only as an edit, an import only as an import', () => {
    const op: EditOp = { kind: 'addChapter' };
    expectTypeOf(applyChange(london, { kind: 'edit', op })).toEqualTypeOf<
      Result<AppliedChange, EditRefusal>
    >();
    expectTypeOf(
      applyChange(london, { kind: 'import', imported: imported('1. d4 *') }),
    ).toEqualTypeOf<Result<AppliedChange, MergeRefusal | NothingToAdd>>();
    expectTypeOf<ChangeRefusal>().toEqualTypeOf<
      EditRefusal | MergeRefusal | NothingToAdd
    >();
  });

  it('a change of either kind refuses as either, and a generic caller keeps its kind', () => {
    const either = (c: RepertoireChange) => applyChange(london, c);
    expectTypeOf(either).returns.toEqualTypeOf<
      Result<AppliedChange, EditRefusal | MergeRefusal | NothingToAdd>
    >();
    const decide = <C extends RepertoireChange>(c: C) => applyChange(london, c);
    expectTypeOf(
      decide<Extract<RepertoireChange, { kind: 'edit' }>>,
    ).returns.toEqualTypeOf<Result<AppliedChange, EditRefusal>>();
    expectTypeOf(
      decide<Extract<RepertoireChange, { kind: 'import' }>>,
    ).returns.toEqualTypeOf<
      Result<AppliedChange, MergeRefusal | NothingToAdd>
    >();
  });
});
