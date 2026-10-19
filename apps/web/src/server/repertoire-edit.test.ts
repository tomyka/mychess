import { moveKey, START_KEY, type EditOp } from '@mychess/chess';
import { describe, expect, it } from 'vitest';
import { editRequestSchema } from './repertoire-edit';

const ID = '7d1f8f3e-5b8a-4c3e-9a51-2f0e6b7c9d10';

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
