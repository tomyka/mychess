import { describe, expect, it } from 'vitest';
import {
  CHAPTER_NAME_MAX,
  COMMENT_MAX,
  PERSONAL_NOTE_MAX,
  REPERTOIRE_ISSUES,
  REPERTOIRE_NAME_MAX,
  REPERTOIRE_REFUSALS,
  canEditRepertoire,
  canViewRepertoire,
  chapterNameSchema,
  commentSchema,
  personalNoteSchema,
  repertoireNameSchema,
  repertoireSchema,
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
