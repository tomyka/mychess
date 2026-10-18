import {
  addChapter,
  addMove,
  editComment,
  moveKey,
  removeChapter,
  removeMove,
  renameChapter,
  setMarks,
  START_KEY,
  type Arrow,
  type Circle,
  type RepertoireGraph,
} from '@mychess/chess';
import { describe, expect, it } from 'vitest';
import { graphOf, LONDON } from '../../test/fixtures/repertoires';
import { applyEdit, editRequestSchema, type EditOp } from './repertoire-edit';

const ID = '7d1f8f3e-5b8a-4c3e-9a51-2f0e6b7c9d10';
const LONDON_GRAPH = graphOf(LONDON);
const AFTER_D4 = LONDON_GRAPH.moves[0]?.to ?? '';

const request = (op: unknown, over: Record<string, unknown> = {}) => ({
  repertoireId: ID,
  version: 3,
  op,
  ...over,
});

const VALID_OPS: readonly EditOp[] = [
  { kind: 'addMove', chapterId: 'c1', from: START_KEY, san: 'd4' },
  { kind: 'addMove', chapterId: null, from: START_KEY, san: 'd4' },
  { kind: 'removeMove', chapterId: 'c1', from: START_KEY, san: 'd4' },
  {
    kind: 'setMarks',
    chapterId: 'c1',
    from: START_KEY,
    san: 'd4',
    marks: {
      arrows: [{ from: 'c1', to: 'f4', color: 'G' }],
      circles: [{ square: 'd4', color: 'R' }],
    },
  },
  { kind: 'editComment', moveKey: moveKey(START_KEY, 'd4'), comment: 'Solid' },
  { kind: 'addChapter' },
  { kind: 'renameChapter', chapterId: 'c1', name: 'Londonas' },
  { kind: 'removeChapter', chapterId: 'c1' },
];

/** The first issue's message of a refused request. */
function issueOf(input: unknown): string | undefined {
  const parsed = editRequestSchema.safeParse(input);
  return parsed.success ? 'accepted' : parsed.error.issues[0]?.message;
}

describe('editRequestSchema', () => {
  it.each(VALID_OPS)('accepts a $kind edit', (op) => {
    expect(editRequestSchema.parse(request(op))).toEqual(request(op));
  });

  it('refuses an unknown kind, a bad id and a version below 1', () => {
    expect(
      editRequestSchema.safeParse(request({ kind: 'dropTable' })).success,
    ).toBe(false);
    expect(
      editRequestSchema.safeParse(
        request({ kind: 'addChapter' }, { repertoireId: 'x' }),
      ).success,
    ).toBe(false);
    expect(
      editRequestSchema.safeParse(
        request({ kind: 'addChapter' }, { version: 0 }),
      ).success,
    ).toBe(false);
  });

  it('refuses 65 arrows on one move', () => {
    const arrows = Array.from({ length: 65 }, () => ({
      from: 'a1',
      to: 'a2',
      color: 'G',
    }));
    const op = {
      kind: 'setMarks',
      chapterId: 'c1',
      from: START_KEY,
      san: 'd4',
      marks: { arrows, circles: [] },
    };
    expect(editRequestSchema.safeParse(request(op)).success).toBe(false);
    expect(
      editRequestSchema.safeParse(
        request({ ...op, marks: { arrows: arrows.slice(1), circles: [] } }),
      ).success,
    ).toBe(true);
  });

  it('refuses a comment of 2,001 characters with its catalogue key', () => {
    const op = {
      kind: 'editComment',
      moveKey: 'k|d4',
      comment: 'a'.repeat(2001),
    };
    expect(issueOf(request(op))).toBe('comment.tooLong');
    expect(issueOf(request({ ...op, comment: 'a'.repeat(2000) }))).toBe(
      'accepted',
    );
  });

  it('refuses a blank chapter name with its catalogue key', () => {
    expect(
      issueOf(request({ kind: 'renameChapter', chapterId: 'c1', name: '   ' })),
    ).toBe('chapter.nameBlank');
  });

  it('normalises the comment and trims the chapter name', () => {
    const parsed = editRequestSchema.parse(
      request({
        kind: 'editComment',
        moveKey: 'k|d4',
        comment: ' Solid\nmove ',
      }),
    );
    expect(parsed.op).toEqual({
      kind: 'editComment',
      moveKey: 'k|d4',
      comment: 'Solid move',
    });
    expect(
      editRequestSchema.parse(
        request({ kind: 'renameChapter', chapterId: 'c1', name: ' Londonas ' }),
      ).op,
    ).toEqual({ kind: 'renameChapter', chapterId: 'c1', name: 'Londonas' });
  });
});

const value = <T>(result: { ok: true; value: T } | { ok: false }): T => {
  if (!result.ok) throw new Error('refused');
  return result.value;
};

describe('applyEdit', () => {
  const g: RepertoireGraph = LONDON_GRAPH;
  const marks: { arrows: Arrow[]; circles: Circle[] } = {
    arrows: [{ from: 'c1', to: 'f4', color: 'G' }],
    circles: [{ square: 'd4', color: 'R' }],
  };

  it('routes each edit to the chess function that decides it', () => {
    expect(applyEdit(g, VALID_OPS[0] ?? { kind: 'addChapter' })).toEqual(
      addMove(g, 'c1', START_KEY, 'd4'),
    );
    expect(
      applyEdit(g, {
        kind: 'addMove',
        chapterId: 'c1',
        from: AFTER_D4,
        san: 'c5',
      }),
    ).toEqual(addMove(g, 'c1', AFTER_D4, 'c5'));
    expect(
      applyEdit(g, {
        kind: 'removeMove',
        chapterId: 'c1',
        from: AFTER_D4,
        san: 'd5',
      }),
    ).toEqual(removeMove(g, 'c1', AFTER_D4, 'd5'));
    expect(
      applyEdit(g, {
        kind: 'setMarks',
        chapterId: 'c2',
        from: START_KEY,
        san: 'd4',
        marks,
      }),
    ).toEqual(setMarks(g, 'c2', { from: START_KEY, san: 'd4' }, marks));
    expect(
      applyEdit(g, {
        kind: 'editComment',
        moveKey: moveKey(START_KEY, 'd4'),
        comment: 'New',
      }),
    ).toEqual(editComment(g, moveKey(START_KEY, 'd4'), 'New'));
    expect(
      applyEdit(g, { kind: 'renameChapter', chapterId: 'c2', name: 'KID' }),
    ).toEqual(renameChapter(g, 'c2', 'KID'));
    expect(applyEdit(g, { kind: 'removeChapter', chapterId: 'c2' })).toEqual(
      removeChapter(g, 'c2'),
    );
  });

  it('adds a chapter from the standard start', () => {
    const added = value(applyEdit(g, { kind: 'addChapter' }));
    expect(added).toEqual(addChapter(g, START_KEY).graph);
    expect(added.chapters.at(-1)?.rootKey).toBe(START_KEY);
  });

  it('starts chapter one with the first move of an empty repertoire (R-111)', () => {
    const empty: RepertoireGraph = { side: 'black', chapters: [], moves: [] };
    const started = addChapter(empty, START_KEY);
    const first = applyEdit(empty, {
      kind: 'addMove',
      chapterId: null,
      from: START_KEY,
      san: 'e4',
    });
    expect(first).toEqual(
      addMove(started.graph, started.chapterId, START_KEY, 'e4'),
    );
    expect(value(first).chapters.map((c) => c.id)).toEqual(['c1']);
  });

  it('refuses a move without a chapter where there are chapters, and an illegal first move', () => {
    expect(
      applyEdit(g, {
        kind: 'addMove',
        chapterId: null,
        from: START_KEY,
        san: 'e4',
      }),
    ).toEqual({ ok: false, refusal: { reason: 'repertoire.unknownChapter' } });
    expect(
      applyEdit(
        { side: 'white', chapters: [], moves: [] },
        { kind: 'addMove', chapterId: null, from: START_KEY, san: 'e5' },
      ),
    ).toEqual({ ok: false, refusal: { reason: 'repertoire.illegalMove' } });
  });

  it('passes the chess refusals through', () => {
    expect(
      applyEdit(g, {
        kind: 'addMove',
        chapterId: 'c1',
        from: START_KEY,
        san: 'Ke2',
      }),
    ).toEqual({ ok: false, refusal: { reason: 'repertoire.illegalMove' } });
    expect(applyEdit(g, { kind: 'removeChapter', chapterId: 'c9' })).toEqual({
      ok: false,
      refusal: { reason: 'repertoire.unknownChapter' },
    });
  });
});
