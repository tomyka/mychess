import { moveKey } from '@mychess/chess';
import { describe, expect, it } from 'vitest';
import type { AssignmentFacts } from './assignment';
import {
  CHAPTER_NAME_MAX,
  COMMENT_MAX,
  PERSONAL_NOTE_MAX,
  REPERTOIRE_ISSUES,
  REPERTOIRE_NAME_MAX,
  REPERTOIRE_REFUSALS,
  canAddRepertoire,
  canEditRepertoire,
  canEditRepertoireAt,
  canHoldMoves,
  isRepertoireLimitRefusal,
  canKeepPersonalNotes,
  canUseScope,
  canViewRepertoire,
  assignedScope,
  canWritePersonalNote,
  chapterNameSchema,
  commentSchema,
  ownScope,
  personalNoteSchema,
  repertoireNameSchema,
  repertoireSchema,
  sharedScope,
  type RepertoireScope,
} from './repertoire';

const issue = (r: {
  success: boolean;
  error?: { issues: { message: string }[] };
}) => (r.success ? null : r.error?.issues[0]?.message);

describe('the limits', () => {
  it('are the spec numbers', () => {
    expect([
      REPERTOIRE_NAME_MAX,
      CHAPTER_NAME_MAX,
      COMMENT_MAX,
      PERSONAL_NOTE_MAX,
    ]).toEqual([80, 80, 2000, 2000]);
  });

  it('refusal and issue keys are catalogue keys', () => {
    expect(REPERTOIRE_ISSUES).toEqual({
      nameBlank: 'repertoire.nameBlank',
      nameTooLong: 'repertoire.nameTooLong',
      chapterNameBlank: 'chapter.nameBlank',
      chapterNameTooLong: 'chapter.nameTooLong',
      commentTooLong: 'comment.tooLong',
      personalNoteTooLong: 'personalNote.tooLong',
      sideInvalid: 'repertoire.sideInvalid',
    });
    expect(REPERTOIRE_REFUSALS).toEqual({
      notFound: 'repertoire.notFound',
      stale: 'repertoire.stale',
      limit: 'repertoire.limit',
      tooManyMoves: 'repertoire.tooManyMoves',
    });
  });
});

describe('repertoireNameSchema and chapterNameSchema', () => {
  it.each([repertoireNameSchema, chapterNameSchema])(
    'trims a name',
    (schema) => {
      expect(schema.parse('  Londono sistema ')).toBe('Londono sistema');
    },
  );

  it.each([
    [repertoireNameSchema, '   ', REPERTOIRE_ISSUES.nameBlank],
    [repertoireNameSchema, '', REPERTOIRE_ISSUES.nameBlank],
    [repertoireNameSchema, 'x'.repeat(81), REPERTOIRE_ISSUES.nameTooLong],
    [chapterNameSchema, '', REPERTOIRE_ISSUES.chapterNameBlank],
    [chapterNameSchema, ' \t ', REPERTOIRE_ISSUES.chapterNameBlank],
    [chapterNameSchema, 'x'.repeat(81), REPERTOIRE_ISSUES.chapterNameTooLong],
  ])('refuses with a catalogue key', (schema, value, key) => {
    expect(issue(schema.safeParse(value))).toBe(key);
  });

  it.each([repertoireNameSchema, chapterNameSchema])(
    'takes one to 80 characters, counted after trimming',
    (schema) => {
      expect(schema.parse('x')).toBe('x');
      expect(schema.parse(` ${'x'.repeat(80)} `)).toHaveLength(80);
    },
  );

  it('refuses what is not a string', () => {
    expect(repertoireNameSchema.safeParse(42).success).toBe(false);
    expect(chapterNameSchema.safeParse(null).success).toBe(false);
  });
});

describe('commentSchema', () => {
  it('keeps the form PGN carries; blank means none', () => {
    expect(commentSchema.parse(' Idea:\n d4 ')).toBe('Idea: d4');
    expect(commentSchema.parse('  ')).toBe('');
    expect(commentSchema.parse('')).toBe('');
  });

  it('drops what would not survive export and re-import', () => {
    expect(commentSchema.parse('a } b [%csl Ge4] c')).toBe('a b c');
  });

  it('refuses more than 2,000 characters after normalising', () => {
    expect(commentSchema.parse(`${'x'.repeat(2000)}   `)).toHaveLength(2000);
    expect(issue(commentSchema.safeParse('x'.repeat(2001)))).toBe(
      REPERTOIRE_ISSUES.commentTooLong,
    );
  });

  it('refuses what is not a string', () => {
    expect(commentSchema.safeParse(undefined).success).toBe(false);
  });
});

describe('personalNoteSchema', () => {
  it('keeps line breaks and trims', () => {
    expect(personalNoteSchema.parse(' jei 9.Na4,\ntai Be7 ')).toBe(
      'jei 9.Na4,\ntai Be7',
    );
  });

  it('blank means none', () => {
    expect(personalNoteSchema.parse(' \n ')).toBe('');
  });

  it('takes 2,000 characters and refuses more', () => {
    expect(personalNoteSchema.parse(` ${'x'.repeat(2000)} `)).toHaveLength(
      2000,
    );
    expect(issue(personalNoteSchema.safeParse('x'.repeat(2001)))).toBe(
      REPERTOIRE_ISSUES.personalNoteTooLong,
    );
  });
});

describe('repertoireSchema', () => {
  const row = {
    id: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b',
    ownerId: 'rokas',
    side: 'white',
    name: 'Londono sistema',
    version: 1,
    createdAt: new Date('2026-10-17T10:00:00Z'),
    updatedAt: new Date('2026-10-17T11:00:00Z'),
  };

  it('parses a repertoire row', () => {
    expect(repertoireSchema.parse(row)).toEqual(row);
    expect(repertoireSchema.parse({ ...row, side: 'black' }).side).toBe(
      'black',
    );
  });

  it.each([
    ['a non-uuid id', { id: 'r1' }],
    ['an empty owner', { ownerId: '' }],
    ['an unknown side', { side: 'both' }],
    ['a zero version', { version: 0 }],
    ['a fractional version', { version: 1.5 }],
    ['a string date', { createdAt: '2026-10-17' }],
    ['a missing updatedAt', { updatedAt: undefined }],
    ['a non-string name', { name: 7 }],
  ])('refuses %s', (_label, change) => {
    expect(repertoireSchema.safeParse({ ...row, ...change }).success).toBe(
      false,
    );
  });
});

describe('canViewRepertoire and canEditRepertoire (S3: the owner only)', () => {
  const repertoire = { ownerId: 'rokas' };

  it.each([canViewRepertoire, canEditRepertoire])(
    'lets the owner in',
    (rule) => {
      expect(rule({ id: 'rokas' }, repertoire)).toEqual({
        ok: true,
        value: undefined,
      });
    },
  );

  it.each([canViewRepertoire, canEditRepertoire])(
    'refuses anyone else as not found',
    (rule) => {
      expect(rule({ id: 'rimantas' }, repertoire)).toEqual({
        ok: false,
        refusal: { reason: 'repertoire.notFound' },
      });
    },
  );

  it.each([canViewRepertoire, canEditRepertoire])(
    'compares ids exactly',
    (rule) => {
      expect(rule({ id: 'Rokas' }, repertoire).ok).toBe(false);
      expect(rule({ id: '' }, { ownerId: '' }).ok).toBe(true);
    },
  );
});

describe('canEditRepertoireAt (#276: the owner first, then the version)', () => {
  const repertoire = { ownerId: 'rokas', version: 3 };
  const stale = { ok: false, refusal: { reason: 'repertoire.stale' } };
  const notFound = { ok: false, refusal: { reason: 'repertoire.notFound' } };

  it.each([
    ['the owner at the version', 'rokas', 3, { ok: true, value: undefined }],
    ['the owner at an older version', 'rokas', 2, stale],
    ['the owner at a newer version', 'rokas', 4, stale],
    ['another account at the version', 'rimantas', 3, notFound],
    [
      'another account at a wrong version (no version leaks)',
      'rimantas',
      2,
      notFound,
    ],
  ])('%s', (_case, viewer, expectedVersion, expected) => {
    expect(
      canEditRepertoireAt({ id: viewer }, repertoire, expectedVersion),
    ).toEqual(expected);
  });
});

describe('the scope builders (#278: one spelling per scope)', () => {
  it('build each kind from its ids', () => {
    expect(ownScope('gabija')).toEqual({ kind: 'own', ownerId: 'gabija' });
    expect(sharedScope('rimantas', 'gabija')).toEqual({
      kind: 'shared',
      coachId: 'rimantas',
      playerId: 'gabija',
    });
    expect(assignedScope('rokas')).toEqual({
      kind: 'assigned',
      playerId: 'rokas',
    });
  });
});

describe('canUseScope (#278: view through any scope, edit only as the owner)', () => {
  const own: RepertoireScope = { kind: 'own', ownerId: 'gabija' };
  const shared: RepertoireScope = {
    kind: 'shared',
    coachId: 'rimantas',
    playerId: 'gabija',
  };
  const assigned: RepertoireScope = { kind: 'assigned', playerId: 'rokas' };

  it.each([own, shared, assigned])('lets $kind view', (scope) => {
    expect(canUseScope(scope, 'view')).toEqual({ ok: true, value: undefined });
  });

  it('lets the owner edit', () => {
    expect(canUseScope(own, 'edit')).toEqual({ ok: true, value: undefined });
  });

  it.each([shared, assigned])(
    'refuses editing through $kind as not found (R-42; S5: read-only)',
    (scope) => {
      expect(canUseScope(scope, 'edit')).toEqual({
        ok: false,
        refusal: { reason: 'repertoire.notFound' },
      });
    },
  );
});

describe('canViewRepertoire and canEditRepertoire are the own scope only', () => {
  it.each([canViewRepertoire, canEditRepertoire])(
    'refuse a coach it is shared with and a player it is assigned to',
    (rule) => {
      const repertoire = { ownerId: 'gabija' };
      expect(rule({ id: 'rimantas' }, repertoire).ok).toBe(false);
      expect(rule({ id: 'rokas' }, repertoire).ok).toBe(false);
    },
  );
});

describe('canWritePersonalNote (R-21, decision 11)', () => {
  const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -';
  const graph = { moves: [{ from: START, san: 'd4' }] };
  const D4 = moveKey(START, 'd4');

  it('lets a note be written on a move of the repertoire', () => {
    expect(canWritePersonalNote(graph, D4, 'Mano planas')).toEqual({
      ok: true,
      value: undefined,
    });
  });

  it('refuses writing a note on a key that is not a move of it', () => {
    for (const key of [moveKey(START, 'e4'), 'x', `${D4}|e5`]) {
      expect(canWritePersonalNote(graph, key, 'Mano planas')).toEqual({
        ok: false,
        refusal: { reason: 'repertoire.notFound' },
      });
    }
  });

  it('lets a note be removed from any key, a removed move included', () => {
    expect(canWritePersonalNote(graph, moveKey(START, 'e4'), '').ok).toBe(true);
    expect(canWritePersonalNote({ moves: [] }, 'x', '').ok).toBe(true);
  });
});

describe('canKeepPersonalNotes (R-21)', () => {
  const repertoire = { ownerId: 'coach' };
  const none = undefined;
  const live: AssignmentFacts = {
    playerId: 'rokas',
    repertoireId: 'r',
    coachId: 'coach',
    reaches: [
      { assignmentId: 'a', deadline: null, assignedVersion: 1, joinedAt: null },
    ],
    pausedAt: null,
    seenVersion: null,
    forkedAt: null,
  };
  const forked = { ...live, forkedAt: new Date('2026-10-20T09:00:00Z') };
  const notFound = { ok: false, refusal: { reason: 'repertoire.notFound' } };

  it.each([
    ['their own repertoire', 'coach', none, { ok: true, value: undefined }],
    [
      'one assigned to them live',
      'rokas',
      live,
      { ok: true, value: undefined },
    ],
    ['not one assigned to others', 'rokas', none, notFound],
    ['not one they forked (R-128)', 'rokas', forked, notFound],
  ] as const)('lets a player keep notes on %s', (_, id, hold, expected) => {
    expect(canKeepPersonalNotes({ id }, repertoire, hold)).toStrictEqual(
      expected,
    );
  });
});

describe('canAddRepertoire (R-162)', () => {
  const owner = { entitlement: 'free' } as const;

  it('allows a 50th repertoire', () => {
    expect(canAddRepertoire(owner, 49)).toStrictEqual({
      ok: true,
      value: undefined,
    });
  });

  it.each([50, 51])('refuses one more at %i, naming the limit', (count) => {
    expect(canAddRepertoire(owner, count)).toStrictEqual({
      ok: false,
      refusal: { reason: 'repertoire.limit', limit: 50 },
    });
  });
});

describe('isRepertoireLimitRefusal (R-162)', () => {
  it('is true for the two limit reasons only', () => {
    expect(
      isRepertoireLimitRefusal({ reason: REPERTOIRE_REFUSALS.limit }),
    ).toBe(true);
    expect(
      isRepertoireLimitRefusal({ reason: REPERTOIRE_REFUSALS.tooManyMoves }),
    ).toBe(true);
    expect(
      isRepertoireLimitRefusal({ reason: REPERTOIRE_REFUSALS.notFound }),
    ).toBe(false);
  });
});

describe('canHoldMoves (R-162)', () => {
  const owner = { entitlement: 'free' } as const;
  const tooMany = {
    ok: false,
    refusal: { reason: 'repertoire.tooManyMoves', limit: 5000 },
  };

  it('allows a repertoire of 5,000 moves', () => {
    expect(canHoldMoves(owner, { before: 0, after: 5000 })).toStrictEqual({
      ok: true,
      value: undefined,
    });
  });

  it.each([
    { before: 0, after: 5001 },
    { before: 5000, after: 5001 },
    { before: 5001, after: 5002 },
  ])(
    'refuses growing to $after moves from $before, naming the limit',
    (moves) => {
      expect(canHoldMoves(owner, moves)).toStrictEqual(tooMany);
    },
  );

  it.each([
    { before: 5002, after: 5001 },
    { before: 5001, after: 5001 },
  ])(
    'allows an edit that does not grow an over-limit one: $before to $after',
    (moves) => {
      expect(canHoldMoves(owner, moves).ok).toBe(true);
    },
  );
});
