import { describe, expect, it } from 'vitest';
import { FIDE_ID_REFUSALS, fideId, fideIdSchema } from './fide-id';

describe('FIDE ID refusals (#316, spec decision 5)', () => {
  it('keys its refusals by message-catalogue key', () => {
    expect(FIDE_ID_REFUSALS).toEqual({
      blank: 'fide.idBlank',
      invalid: 'fide.idInvalid',
      tooLong: 'fide.idTooLong',
    });
  });
});

describe('fideId (#316, spec decision 5)', () => {
  it.each([
    ['1', 1],
    ['9', 9],
    ['12345678', 12345678],
    ['999999999', 999999999],
    [' 4100018 ', 4100018],
  ])('reads %j as the FIDE ID %d', (raw, id) => {
    expect(fideId(raw)).toEqual({ ok: true, value: id });
  });

  it.each(['', '   '])('refuses the blank %j', (raw) => {
    expect(fideId(raw)).toEqual({
      ok: false,
      refusal: { reason: 'fide.idBlank' },
    });
  });

  it.each(['1234567890', '0000000001'])(
    'refuses %j, more than nine digits',
    (raw) => {
      expect(fideId(raw)).toEqual({
        ok: false,
        refusal: { reason: 'fide.idTooLong' },
      });
    },
  );

  it.each([
    '0',
    '00',
    '0123',
    '-1',
    '+1',
    '1.5',
    '1e3',
    '12 34',
    'abc',
    '12a',
    '١٢', // Arabic-Indic digits are not ASCII digits
  ])('refuses %j, not a positive whole number in digits', (raw) => {
    expect(fideId(raw)).toEqual({
      ok: false,
      refusal: { reason: 'fide.idInvalid' },
    });
  });
});

describe('fideIdSchema (#316, security M3)', () => {
  it.each([1, 999_999_999])('accepts %d', (id) => {
    expect(fideIdSchema.parse(id)).toBe(id);
  });

  it.each([0, -1, 1.5, 1_000_000_000, Number.NaN])('refuses %d', (id) => {
    const parsed = fideIdSchema.safeParse(id);
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((issue) => issue.message)).toContain(
      'fide.idInvalid',
    );
  });
});
