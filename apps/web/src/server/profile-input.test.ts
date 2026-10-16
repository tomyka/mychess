import { describe, expect, it } from 'vitest';
import { parseProfileInput } from './profile-input';

function form(fields: Record<string, string | Blob>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

const refusalOf = (data: FormData): string | undefined => {
  const parsed = parseProfileInput(data);
  return parsed.ok ? undefined : parsed.refusal.reason;
};

describe('parseProfileInput', () => {
  it('reads a trimmed display name and the language', () => {
    expect(
      parseProfileInput(form({ displayName: '  Rūta ', locale: 'en' })),
    ).toEqual({ ok: true, value: { displayName: 'Rūta', locale: 'en' } });
  });

  it('reads Lithuanian', () => {
    expect(
      parseProfileInput(form({ displayName: 'Rūta', locale: 'lt' })),
    ).toEqual({ ok: true, value: { displayName: 'Rūta', locale: 'lt' } });
  });

  it('keeps a name of exactly 50 characters', () => {
    const name = 'ą'.repeat(50);
    expect(
      parseProfileInput(form({ displayName: name, locale: 'lt' })),
    ).toEqual({ ok: true, value: { displayName: name, locale: 'lt' } });
  });

  it('refuses a blank name', () => {
    expect(refusalOf(form({ displayName: '   ', locale: 'lt' }))).toBe(
      'displayName.blank',
    );
  });

  it('refuses a 51-character name', () => {
    expect(refusalOf(form({ displayName: 'a'.repeat(51), locale: 'lt' }))).toBe(
      'displayName.tooLong',
    );
  });

  it('refuses a language the site does not have', () => {
    expect(refusalOf(form({ displayName: 'Rūta', locale: 'de' }))).toBe(
      'account.localeInvalid',
    );
  });

  it('refuses a missing language', () => {
    expect(refusalOf(form({ displayName: 'Rūta' }))).toBe(
      'account.localeInvalid',
    );
  });

  it('reads a missing name as blank', () => {
    expect(refusalOf(form({ locale: 'lt' }))).toBe('displayName.blank');
  });

  it('reads a file sent as the name as blank', () => {
    expect(
      refusalOf(form({ displayName: new Blob(['Rūta']), locale: 'lt' })),
    ).toBe('displayName.blank');
  });

  it('names the name refusal first when both fields are wrong', () => {
    expect(refusalOf(form({ displayName: '', locale: 'de' }))).toBe(
      'displayName.blank',
    );
  });
});
