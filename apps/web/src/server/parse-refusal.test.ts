import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { refusalAt, refusalOf, refusalState } from './parse-refusal';

/** The error `schema` comes to on `input`; the test inputs never parse. */
function errorOf(schema: z.ZodType, input: unknown): z.ZodError {
  const parsed = schema.safeParse(input);
  if (parsed.success) throw new Error('the input parsed');
  return parsed.error;
}

const BLANK = 'repertoire.nameBlank';
const TOO_LONG = 'repertoire.nameTooLong';
const NOT_FOUND = 'repertoire.notFound';

const nameSchema = z.object({
  name: z.string().trim().min(1, BLANK).max(5, TOO_LONG),
  id: z.uuid('repertoire.stale'),
});

describe('refusalOf', () => {
  it("reads the first issue's message when it is a known key", () => {
    const error = errorOf(nameSchema, { name: '  ', id: 'x' });
    expect(refusalOf(error, [BLANK, TOO_LONG], NOT_FOUND)).toBe(BLANK);
  });

  it('reads only the first issue', () => {
    const error = errorOf(nameSchema, { name: 'longer', id: 'x' });
    expect(
      refusalOf(error, [BLANK, TOO_LONG, 'repertoire.stale'], NOT_FOUND),
    ).toBe(TOO_LONG);
  });

  it('falls back when the message is not a known key', () => {
    const error = errorOf(nameSchema, { name: 'ok', id: 'x' });
    expect(refusalOf(error, [BLANK, TOO_LONG], NOT_FOUND)).toBe(NOT_FOUND);
  });

  it("falls back on zod's own message", () => {
    const error = errorOf(nameSchema, { name: 3, id: 'x' });
    expect(refusalOf(error, [BLANK, TOO_LONG], NOT_FOUND)).toBe(NOT_FOUND);
  });
});

const NOT_LINKED = 'share.notLinked';
const NOT_OWNER = 'share.notOwner';
const GROUP_NOT_FOUND = 'assignment.groupNotFound';

const formSchema = z.object({
  coachIds: z.array(z.string().min(1)),
  target: z.object({ groupId: z.uuid(), playerId: z.string().min(1) }),
  name: z.string().min(1, BLANK).max(5, TOO_LONG),
});

const valid = {
  coachIds: ['c-1'],
  target: { groupId: '7d1f8f3e-5b8a-4c3e-9a51-2f0e6b7c9d10', playerId: 'p' },
  name: 'name',
};

describe('refusalAt', () => {
  const fields = {
    coachIds: NOT_LINKED,
    'target.groupId': GROUP_NOT_FOUND,
    target: NOT_FOUND,
    name: (error: z.ZodError) => refusalOf(error, [TOO_LONG], BLANK),
  } as const;

  it.each([
    ['a field', { ...valid, coachIds: 'c-1' }, NOT_LINKED],
    ['an element of a field', { ...valid, coachIds: [''] }, NOT_LINKED],
    [
      'the longest field path named',
      { ...valid, target: { ...valid.target, groupId: 'x' } },
      GROUP_NOT_FOUND,
    ],
    [
      'a shorter field path',
      { ...valid, target: { ...valid.target, playerId: '' } },
      NOT_FOUND,
    ],
    ['what its function reads', { ...valid, name: 'longer' }, TOO_LONG],
    ['what its function falls back to', { ...valid, name: '' }, BLANK],
    ['the fallback with no path', 'not an object', NOT_OWNER],
  ])('reads the first issue as %s', (_, input, reason) => {
    expect(refusalAt(errorOf(formSchema, input), fields, NOT_OWNER)).toBe(
      reason,
    );
  });

  it('falls back for a field it does not name', () => {
    const schema = z.object({ other: z.string() });
    expect(refusalAt(errorOf(schema, {}), fields, NOT_OWNER)).toBe(NOT_OWNER);
  });

  it('does not read a field named after an object property', () => {
    const schema = z.object({ constructor: z.string() });
    expect(refusalAt(errorOf(schema, {}), fields, NOT_OWNER)).toBe(NOT_OWNER);
  });
});

describe('refusalState', () => {
  it('is empty for a success', () => {
    expect(refusalState({ ok: true, value: undefined })).toEqual({});
  });

  it('carries the reason of a refusal', () => {
    expect(
      refusalState({ ok: false, refusal: { reason: NOT_LINKED } }),
    ).toEqual({ refusal: NOT_LINKED });
  });
});
